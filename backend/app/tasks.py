"""
Celery 태스크 정의
브라우저 닫아도 계속 실행되는 백그라운드 작업
"""
import logging
from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="collect_history_task")
def collect_history_task(self, days: int, task_id: str, mode: str = "all", max_workers: int = 5):
    """
    히스토리 수집 Celery 태스크

    Args:
        days: 수집할 일수
        task_id: TaskProgress에 사용할 task_id
        mode: "all" 또는 "tagged"
        max_workers: 병렬 워커 수

    Returns:
        수집 결과 딕셔너리
    """
    from app.crawlers.kis_history_crawler import kis_history_crawler

    try:
        logger.info(f"[Celery] Starting history collection: task_id={task_id}, days={days}, mode={mode}, workers={max_workers}")

        if mode == "tagged":
            result = kis_history_crawler.collect_history_for_tagged_stocks(
                days=days,
                task_id=task_id,
                max_workers=max_workers
            )
        else:  # "all"
            result = kis_history_crawler.collect_history_for_all_stocks(
                days=days,
                task_id=task_id,
                max_workers=max_workers
            )

        logger.info(f"[Celery] History collection completed: {result}")
        return result

    except SoftTimeLimitExceeded:
        logger.warning(f"[Celery] Task {task_id} soft time limit exceeded, cleaning up...")
        _mark_task_failed(task_id, "작업 시간 초과 (59분)")
        raise
    except Exception as e:
        logger.error(f"[Celery] Error during history collection: {str(e)}")
        _mark_task_failed(task_id, str(e))
        raise


@shared_task(bind=True, name="analyze_signals_task")
def analyze_signals_task(
    self,
    task_id: str,
    mode: str = "all",
    limit: int = 500,
    days: int = 120,
    force_full: bool = False
):
    """
    시그널 분석 Celery 태스크

    Args:
        task_id: TaskProgress에 사용할 task_id
        mode: 분석 모드 ("tagged", "all", "top")
        limit: top 모드일 때 상위 몇 개
        days: 분석할 일수
        force_full: True면 델타 무시하고 전체 스캔

    Returns:
        분석 결과 딕셔너리
    """
    from app.signal_analyzer import signal_analyzer

    try:
        logger.info(f"[Celery] Starting signal analysis: task_id={task_id}, mode={mode}, force_full={force_full}")

        result = signal_analyzer.analyze_and_store_signals(
            mode=mode,
            limit=limit,
            days=days,
            force_full=force_full,
            task_id=task_id  # task_id 전달
        )

        logger.info(f"[Celery] Signal analysis completed: {result}")
        return result

    except SoftTimeLimitExceeded:
        logger.warning(f"[Celery] Task {task_id} soft time limit exceeded, cleaning up...")
        _mark_task_failed(task_id, "작업 시간 초과 (59분)")
        raise
    except Exception as e:
        logger.error(f"[Celery] Error during signal analysis: {str(e)}")
        _mark_task_failed(task_id, str(e))
        raise


@shared_task(bind=True, name="retry_failed_stocks_task")
def retry_failed_stocks_task(self, task_id: str, stock_ids: list, days: int = 120, max_workers: int = 5):
    """
    실패한 종목만 재시도하는 Celery 태스크

    Args:
        task_id: TaskProgress에 사용할 task_id
        stock_ids: 재시도할 종목 ID 리스트
        days: 수집할 일수
        max_workers: 병렬 워커 수

    Returns:
        수집 결과 딕셔너리
    """
    from app.crawlers.kis_history_crawler import kis_history_crawler
    from app.database import SessionLocal
    from app.models import Stock

    db = SessionLocal()
    try:
        logger.info(f"[Celery] Retrying {len(stock_ids)} failed stocks: task_id={task_id}")

        # Stock 객체 조회
        stocks = db.query(Stock).filter(
            Stock.id.in_(stock_ids),
            Stock.is_active == True
        ).all()

        if not stocks:
            logger.warning(f"[Celery] No active stocks found for retry")
            return {"success": False, "message": "No active stocks found"}

        result = kis_history_crawler._collect_history_for_stocks(
            stocks,
            days,
            db,
            task_id=task_id,
            max_workers=max_workers
        )

        logger.info(f"[Celery] Retry completed: {result}")
        return result

    except SoftTimeLimitExceeded:
        logger.warning(f"[Celery] Task {task_id} soft time limit exceeded")
        _mark_task_failed(task_id, "작업 시간 초과 (59분)")
        raise
    except Exception as e:
        logger.error(f"[Celery] Error during retry: {str(e)}")
        _mark_task_failed(task_id, str(e))
        raise
    finally:
        db.close()


def _mark_task_failed(task_id: str, error_message: str):
    """TaskProgress를 실패 상태로 업데이트"""
    from app.database import SessionLocal
    from app.models import TaskProgress
    from datetime import datetime

    db = SessionLocal()
    try:
        task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()
        if task and task.status == "running":
            task.status = "failed"
            task.error_message = error_message
            task.completed_at = datetime.utcnow()
            db.commit()
            logger.info(f"[Celery] Task {task_id} marked as failed: {error_message}")
    except Exception as e:
        logger.error(f"[Celery] Error updating task status: {e}")
    finally:
        db.close()
