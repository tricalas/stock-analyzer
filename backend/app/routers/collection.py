from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import logging

from app.config import settings
from app.database import get_db, SessionLocal
from app.models import Stock, StockPriceHistory, User, TaskProgress, StockCrawlLog
from app import schemas
from app.crawlers.crawler_manager import CrawlerManager
from app.scheduler import stock_scheduler
from app.auth import get_current_user, get_admin_user
from app.tasks import refresh_quotes_task
import uuid

from app.cache import invalidate_cache
logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_admin_user)])
crawler_manager = CrawlerManager()
last_crawl_time = None
CRAWL_COOLDOWN_MINUTES = 10


@router.post("/api/stocks/tagged/collect-history")
def collect_history_for_tagged_stocks_api(
    days: int = Query(120, ge=1, le=365),
    workers: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user)
):
    from app.workflow import create_run
    from app.routers.operations import enqueue
    with SessionLocal() as db:
        return enqueue(create_run(db, scope='tagged', days=max(180, days)))


@router.post("/api/crawl/stocks")
def crawl_stock_list(
    market: str = Query("ALL", pattern="^(ALL|KR|US)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """주식 데이터 크롤링 - 10분 쿨타임 (백그라운드 처리, 진행 상황 추적)"""
    global last_crawl_time

    # 쿨타임 체크
    if last_crawl_time:
        elapsed_time = datetime.utcnow() - last_crawl_time
        remaining_seconds = (CRAWL_COOLDOWN_MINUTES * 60) - elapsed_time.total_seconds()

        if remaining_seconds > 0:
            remaining_minutes = int(remaining_seconds // 60)
            remaining_secs = int(remaining_seconds % 60)
            raise HTTPException(
                status_code=429,
                detail=f"크롤링 쿨타임입니다. {remaining_minutes}분 {remaining_secs}초 후에 다시 시도해주세요."
            )

    # 쿨타임 업데이트
    last_crawl_time = datetime.utcnow()

    # TaskProgress 및 StockCrawlLog 생성
    task_id = str(uuid.uuid4())

    task_progress = TaskProgress(
        task_id=task_id,
        task_type="stock_crawl",
        status="queued",
        total_items=0,
        current_item=0,
        success_count=0,
        failed_count=0,
        message="크롤링 시작 중..."
    )
    db.add(task_progress)

    crawl_log = StockCrawlLog(
        task_id=task_id,
        status="running",
        market=market
    )
    db.add(crawl_log)
    db.commit()

    # 백그라운드 작업 추가 (task_id 포함)
    try:
        refresh_quotes_task.apply_async(args=[market, task_id], task_id=task_id)
    except Exception:
        logger.warning("Quote refresh saved; scheduler will enqueue after broker recovery")

    # 즉시 응답 반환 (task_id 포함)
    return {
        "success": True,
        "task_id": task_id,
        "message": f"크롤링 작업이 시작되었습니다."
    }


@router.get("/api/crawl/logs", response_model=List[schemas.StockCrawlLog])
def get_crawl_logs(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """크롤링 히스토리 조회"""
    logs = db.query(StockCrawlLog).order_by(
        StockCrawlLog.started_at.desc()
    ).limit(limit).all()
    return logs


@router.get("/api/scheduler/status")
def get_scheduler_status():
    """스케줄러 상태 및 등록된 작업 목록 조회"""
    try:
        from app.models import ServiceCheck
        with SessionLocal() as db:
            check = db.get(ServiceCheck, 'Scheduler')
            running = bool(check and (datetime.utcnow()-check.checked_at).total_seconds() < 180)
        jobs = stock_scheduler.get_jobs()
        return {
            "running": running,
            "jobs": jobs,
            "message": "Scheduler is running" if running else "Scheduler heartbeat missing"
        }
    except Exception as e:
        logger.error(f"Error getting scheduler status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/scheduler/trigger")
def trigger_manual_crawl():
    """수동으로 주식 데이터 크롤링 실행"""
    try:
        result = stock_scheduler.trigger_manual_crawl()
        return {
            "message": "Manual crawling completed successfully",
            "result": result
        }
    except Exception as e:
        logger.error(f"Error in manual crawling: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/scheduler/trigger-history")
def trigger_manual_history_collection(
    days: int = Query(100, ge=1, le=365, description="Number of days to collect")
):
    """종료된 단계부터 이어지는 영속 수집·분석 작업."""
    return stock_scheduler.trigger_manual_history_collection(days=days)


@router.post("/api/stocks/collect-history")
def collect_history_for_stocks(
    days: int = Query(120, ge=1, le=365),
    mode: str = Query("all", pattern="^(all|tagged)$"),
    workers: int = Query(5, ge=1, le=20, description="병렬 워커 수 (1~20, 기본 5)"),
    current_user: User = Depends(get_current_user)
):
    """수집 완료 후 두 시그널 전략을 순서대로 실행합니다."""
    from app.workflow import create_run
    from app.routers.operations import enqueue
    with SessionLocal() as db:
        run = create_run(db, scope=mode, days=max(180, days))
        return {**enqueue(run), 'execution_mode': 'celery', 'mode': mode, 'days': max(180, days)}


def run_background_crawl(market: str, task_id: str = None):
    """백그라운드에서 실행될 크롤링 작업 (진행 상황 추적 포함)"""
    db = SessionLocal()
    try:
        logger.info(f"Starting background crawl for market: {market}, task_id: {task_id}")

        # TaskProgress 업데이트: 시작
        if task_id:
            db.query(TaskProgress).filter(TaskProgress.task_id == task_id).update({
                "status": "running",
                "message": f"Naver Finance API에서 {market} 종목 가져오는 중... (약 20초 소요)",
                "current_item": 0,
                "total_items": 100  # 예상치
            })
            db.commit()

        result = crawler_manager.update_stock_list(market)

        # 처리 완료 후
        if task_id:
            db.query(TaskProgress).filter(TaskProgress.task_id == task_id).update({
                "message": "데이터베이스 저장 중...",
                "current_item": 50,
                "total_items": 100
            })
            db.commit()

        # ETF 필터링 정보 포함한 메시지 생성
        etf_info = ""
        if result.get('skipped_etf', 0) > 0:
            etf_info = f" ({result['skipped_etf']} ETF/지수 제외)"

        logger.info(f"Background crawl completed: {result['success']} out of {result['total']} stocks{etf_info}")

        # TaskProgress 및 StockCrawlLog 업데이트: 완료
        if task_id:
            db.query(TaskProgress).filter(TaskProgress.task_id == task_id).update({
                "status": "completed",
                "total_items": result.get('total', 0),
                "current_item": result.get('total', 0),
                "success_count": result.get('success', 0),
                "failed_count": result.get('failed', 0),
                "message": f"크롤링 완료: {result['success']}개 종목{etf_info}",
                "completed_at": datetime.utcnow()
            })
            db.query(StockCrawlLog).filter(StockCrawlLog.task_id == task_id).update({
                "status": "completed",
                "total_count": result.get('total', 0),
                "success_count": result.get('success', 0),
                "failed_count": result.get('failed', 0),
                "completed_at": datetime.utcnow()
            })
            db.commit()

        # 캐시 무효화
        invalidate_cache()

    except Exception as e:
        logger.error(f"Error during background stock list crawling: {str(e)}")
        # TaskProgress 및 StockCrawlLog 업데이트: 실패
        if task_id:
            try:
                db.query(TaskProgress).filter(TaskProgress.task_id == task_id).update({
                    "status": "failed",
                    "error_message": str(e),
                    "completed_at": datetime.utcnow()
                })
                db.query(StockCrawlLog).filter(StockCrawlLog.task_id == task_id).update({
                    "status": "failed",
                    "completed_at": datetime.utcnow()
                })
                db.commit()
            except Exception:
                pass
    finally:
        db.close()


@router.post("/api/crawl/indicators/{stock_id}")
def calculate_indicators(stock_id: int, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    try:
        crawler_manager.calculate_technical_indicators(stock_id)
        return {"message": f"Successfully calculated indicators for {stock.symbol}"}
    except Exception as e:
        logger.error(f"Error calculating indicators: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/stocks/{stock_id}/crawl-history")
def crawl_stock_price_history(
    stock_id: int,
    days: int = Query(100, ge=1, le=365, description="Number of days to crawl"),
    db: Session = Depends(get_db)
):
    """개별 종목의 가격 히스토리 크롤링"""
    try:
        # 종목 존재 확인
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        from app.crawlers.kis_history_crawler import kis_history_crawler
        result = kis_history_crawler.collect_history_for_stock(stock, days=days, db=db)
        if not result.get("success"):
            raise HTTPException(status_code=502, detail=result.get("error", "History collection failed"))
        count = result.get("records_saved", 0)
        return {"success": count, "failed": 0, "total": count,
                "message": f"Successfully crawled {count} price records for {stock.symbol}"}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error crawling price history for stock {stock_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
