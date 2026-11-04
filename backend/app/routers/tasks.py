from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, case
from typing import List, Optional
from datetime import datetime
import logging

from app.database import get_db
from app.models import Stock, User, TaskProgress, HistoryCollectionLog, StockCrawlLog
from app import schemas
from app.auth import get_current_user, get_admin_user
from app.tasks import collect_history_task, analyze_signals_task, retry_failed_stocks_task
from app.celery_app import celery_app
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_admin_user)])


@router.get("/api/tasks/running", response_model=List[schemas.TaskProgress])
def get_running_tasks(db: Session = Depends(get_db)):
    """
    현재 실행 중인 모든 작업 조회

    Returns:
        실행 중인 TaskProgress 객체 리스트
    """
    tasks = db.query(TaskProgress).filter(
        TaskProgress.status == "running"
    ).order_by(desc(TaskProgress.started_at)).all()

    return tasks


@router.get("/api/history-logs", response_model=List[schemas.HistoryCollectionSummary])
def get_history_collection_summaries(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    수집 히스토리 요약 목록 조회 (task_id별 그룹화)

    Args:
        limit: 조회할 최대 개수 (기본 20, 최대 100)

    Returns:
        HistoryCollectionSummary 객체 리스트
    """
    from app.models import HistoryCollectionLog
    from sqlalchemy import func

    # task_id별 그룹화하여 요약 정보 조회
    subquery = db.query(
        HistoryCollectionLog.task_id,
        func.min(HistoryCollectionLog.started_at).label('started_at'),
        func.max(HistoryCollectionLog.completed_at).label('completed_at'),
        func.count(HistoryCollectionLog.id).label('total_count'),
        func.sum(case((HistoryCollectionLog.status == 'success', 1), else_=0)).label('success_count'),
        func.sum(case((HistoryCollectionLog.status == 'failed', 1), else_=0)).label('failed_count'),
        func.sum(HistoryCollectionLog.records_saved).label('total_records_saved')
    ).group_by(
        HistoryCollectionLog.task_id
    ).order_by(
        func.min(HistoryCollectionLog.started_at).desc()
    ).limit(limit).all()

    return [
        schemas.HistoryCollectionSummary(
            task_id=row.task_id,
            started_at=row.started_at,
            completed_at=row.completed_at,
            total_count=row.total_count,
            success_count=row.success_count or 0,
            failed_count=row.failed_count or 0,
            total_records_saved=row.total_records_saved or 0
        )
        for row in subquery
    ]


@router.get("/api/tasks/latest/{task_type}", response_model=schemas.TaskProgress)
def get_latest_task_by_type(
    task_type: str,
    db: Session = Depends(get_db)
):
    """
    특정 작업 타입의 최신 진행 상황 조회

    Args:
        task_type: 작업 타입 (history_collection, signal_analysis)

    Returns:
        최신 TaskProgress 객체
    """
    task = db.query(TaskProgress).filter(
        TaskProgress.task_type == task_type
    ).order_by(desc(TaskProgress.started_at)).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"No task found for type: {task_type}")

    return task


@router.post("/api/tasks/{task_id}/cancel")
def cancel_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    실행 중인 작업 취소

    Celery 워커에서 실행 중인 작업을 강제로 종료합니다.

    Args:
        task_id: 작업 ID (UUID)

    Returns:
        취소 결과 메시지
    """
    # DB에서 작업 조회
    task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if task.status != "running":
        return {
            "success": False,
            "message": f"작업이 실행 중이 아닙니다. (현재 상태: {task.status})"
        }

    # Celery 태스크 취소 (terminate=True: 강제 종료)
    celery_app.control.revoke(task_id, terminate=True, signal='SIGTERM')

    # DB 상태 업데이트
    task.status = "cancelled"
    task.message = "사용자에 의해 취소됨"
    task.completed_at = datetime.utcnow()

    # StockCrawlLog도 업데이트 (stock_crawl 타입인 경우)
    if task.task_type == "stock_crawl":
        db.query(StockCrawlLog).filter(StockCrawlLog.task_id == task_id).update({
            "status": "cancelled",
            "completed_at": datetime.utcnow()
        })

    db.commit()

    logger.info(f"🛑 Task {task_id} cancelled by user")

    return {
        "success": True,
        "message": "작업이 취소되었습니다",
        "task_id": task_id
    }


@router.post("/api/tasks/{task_id}/restart")
def restart_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    실패하거나 취소된 작업 재시작

    동일한 설정으로 새로운 작업을 시작합니다.

    Args:
        task_id: 재시작할 원본 작업 ID

    Returns:
        새로운 task_id와 함께 재시작 결과
    """
    # DB에서 원본 작업 조회
    task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if task.status == "running":
        return {
            "success": False,
            "message": "작업이 아직 실행 중입니다. 취소 후 재시작하세요."
        }

    # 새 task_id 생성
    new_task_id = str(uuid.uuid4())

    # 작업 타입에 따라 재시작
    if task.task_type == "history_collection":
        # 기본 설정으로 재시작 (tagged 모드, 100일)
        collect_history_task.apply_async(
            kwargs={
                "days": 100,
                "task_id": new_task_id,
                "mode": "tagged",
                "max_workers": 5
            },
            task_id=new_task_id
        )
        logger.info(f"🔄 History collection restarted: {task_id} -> {new_task_id}")

    elif task.task_type == "signal_analysis":
        analyze_signals_task.apply_async(
            kwargs={
                "task_id": new_task_id,
                "mode": "tagged",
                "limit": 500,
                "days": 120,
                "force_full": False
            },
            task_id=new_task_id
        )
        logger.info(f"🔄 Signal analysis restarted: {task_id} -> {new_task_id}")

    else:
        raise HTTPException(
            status_code=400,
            detail=f"알 수 없는 작업 타입: {task.task_type}"
        )

    return {
        "success": True,
        "message": "작업이 재시작되었습니다",
        "original_task_id": task_id,
        "new_task_id": new_task_id
    }


@router.get("/api/tasks/{task_id}/logs", response_model=List[schemas.HistoryCollectionLog])
def get_task_logs(
    task_id: str,
    status: Optional[str] = Query(None, pattern="^(success|failed)$"),
    db: Session = Depends(get_db)
):
    """
    특정 작업의 개별 종목별 로그 조회

    Args:
        task_id: TaskProgress의 task_id
        status: 필터링할 상태 (success, failed, 없으면 전체)

    Returns:
        HistoryCollectionLog 객체 리스트
    """
    from app.models import HistoryCollectionLog

    query = db.query(HistoryCollectionLog).filter(
        HistoryCollectionLog.task_id == task_id
    )

    if status:
        query = query.filter(HistoryCollectionLog.status == status)

    logs = query.order_by(HistoryCollectionLog.started_at).all()
    return logs


@router.post("/api/tasks/{task_id}/retry-failed")
def retry_failed_stocks(
    task_id: str,
    days: int = Query(120, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    특정 작업에서 실패한 종목들만 재시도 (Celery 백그라운드 작업)

    브라우저를 닫아도 작업이 계속 실행됩니다.

    Args:
        task_id: 재시도할 TaskProgress의 task_id
        days: 수집할 일수

    Returns:
        재시도 작업 정보
    """
    from app.models import HistoryCollectionLog

    # 실패한 종목 조회
    failed_logs = db.query(HistoryCollectionLog).filter(
        HistoryCollectionLog.task_id == task_id,
        HistoryCollectionLog.status == "failed"
    ).all()

    if not failed_logs:
        return {
            "success": False,
            "message": "재시도할 실패 종목이 없습니다.",
            "failed_count": 0
        }

    # 실패한 종목 ID 추출
    failed_stock_ids = [log.stock_id for log in failed_logs]

    # 활성 종목만 확인
    active_stocks = db.query(Stock).filter(
        Stock.id.in_(failed_stock_ids),
        Stock.is_active == True
    ).all()

    if not active_stocks:
        return {
            "success": False,
            "message": "재시도 가능한 종목이 없습니다.",
            "failed_count": len(failed_logs)
        }

    # 새 task_id 생성
    new_task_id = str(uuid.uuid4())

    # Celery 태스크 비동기 실행
    retry_failed_stocks_task.apply_async(
        kwargs={
            "task_id": new_task_id,
            "stock_ids": [s.id for s in active_stocks],
            "days": days,
            "max_workers": 5
        },
        task_id=new_task_id
    )

    logger.info(f"🔄 Retrying {len(active_stocks)} failed stocks with Celery task: {new_task_id}")

    return {
        "success": True,
        "message": f"{len(active_stocks)}개 실패 종목 재시도가 시작되었습니다.",
        "task_id": new_task_id,
        "retry_count": len(active_stocks),
        "original_failed_count": len(failed_logs),
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다."
    }


@router.get("/api/tasks/{task_id}", response_model=schemas.TaskProgress)
def get_task_progress(
    task_id: str,
    db: Session = Depends(get_db)
):
    """
    특정 작업의 진행 상황 조회

    Args:
        task_id: 작업 ID (UUID)

    Returns:
        TaskProgress 객체
    """
    task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    return task
