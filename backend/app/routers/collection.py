from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import logging

from app.config import settings
from app.database import get_db
from app.models import Stock, StockPriceHistory, User, TaskProgress, StockCrawlLog
from app import schemas
from app.crawlers.crawler_manager import CrawlerManager
from app.crawlers.price_history_crawler import price_history_crawler
from app.scheduler import stock_scheduler
from app.auth import get_current_user, get_admin_user
from app.tasks import collect_history_task
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
    """태그된 종목 히스토리 수집 (Celery 백그라운드 작업)"""
    task_id = str(uuid.uuid4())
    collect_history_task.apply_async(
        kwargs={
            "days": days,
            "task_id": task_id,
            "mode": "tagged",
            "max_workers": workers
        },
        task_id=task_id
    )
    return {
        "success": True,
        "message": f"히스토리 수집 작업이 시작되었습니다. (태그된 종목, {days}일치 데이터, 워커 {workers}개)",
        "days": days,
        "mode": "tagged",
        "workers": workers,
        "task_id": task_id,
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다."
    }


@router.post("/api/crawl/stocks")
def crawl_stock_list(
    background_tasks: BackgroundTasks,
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
        status="running",
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
    background_tasks.add_task(run_background_crawl, market, task_id)

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
        jobs = stock_scheduler.get_jobs()
        return {
            "running": stock_scheduler.scheduler.running,
            "jobs": jobs,
            "message": "Scheduler is running" if stock_scheduler.scheduler.running else "Scheduler is stopped"
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
    background_tasks: BackgroundTasks,
    days: int = Query(100, ge=1, le=365, description="Number of days to collect")
):
    """수동으로 히스토리 수집 실행 (백그라운드 작업)"""
    def run_collection():
        try:
            logger.info(f"🚀 Background history collection started ({days} days)...")
            result = stock_scheduler.trigger_manual_history_collection(days=days)
            logger.info(f"✅ Background history collection completed: {result}")
        except Exception as e:
            logger.error(f"❌ Error in background history collection: {str(e)}")

    background_tasks.add_task(run_collection)

    return {
        "success": True,
        "message": f"히스토리 수집 작업이 시작되었습니다 ({days}일치 데이터)",
        "days": days,
        "mode": settings.HISTORY_COLLECTION_MODE,
        "note": "Check Railway logs for progress"
    }


@router.post("/api/stocks/collect-history")
def collect_history_for_stocks(
    days: int = Query(120, ge=1, le=365),
    mode: str = Query("all", pattern="^(all|tagged)$"),
    workers: int = Query(5, ge=1, le=20, description="병렬 워커 수 (1~20, 기본 5)"),
    current_user: User = Depends(get_current_user)
):
    """
    종목들의 히스토리 데이터 수집 (백그라운드 작업)

    브라우저를 닫아도 작업이 계속 실행됩니다.
    """
    import threading
    from app.crawlers.kis_history_crawler import kis_history_crawler

    task_id = str(uuid.uuid4())

    # Celery 태스크 시도, 실패 시 스레드로 폴백
    try:
        collect_history_task.apply_async(
            kwargs={
                "days": days,
                "task_id": task_id,
                "mode": mode,
                "max_workers": workers
            },
            task_id=task_id
        )
        execution_mode = "celery"
        logger.info(f"✅ History collection queued via Celery (task_id: {task_id})")
    except Exception as e:
        logger.warning(f"⚠️ Celery unavailable ({e}), falling back to thread")

        # 스레드로 폴백 실행
        def run_collection():
            try:
                if mode == "tagged":
                    kis_history_crawler.collect_history_for_tagged_stocks(
                        days=days, task_id=task_id, max_workers=workers
                    )
                else:
                    kis_history_crawler.collect_history_for_all_stocks(
                        days=days, task_id=task_id, max_workers=workers
                    )
            except Exception as ex:
                logger.error(f"History collection failed: {ex}")

        thread = threading.Thread(target=run_collection, daemon=True)
        thread.start()
        execution_mode = "thread"

    mode_text = "전체 종목" if mode == "all" else "태그된 종목"
    return {
        "success": True,
        "message": f"히스토리 수집 작업이 시작되었습니다. ({mode_text}, {days}일치 데이터, 워커 {workers}개)",
        "days": days,
        "mode": mode,
        "workers": workers,
        "task_id": task_id,
        "execution_mode": execution_mode,
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다."
    }


def run_background_crawl(market: str, task_id: str = None):
    """백그라운드에서 실행될 크롤링 작업 (진행 상황 추적 포함)"""
    db = SessionLocal()
    try:
        logger.info(f"Starting background crawl for market: {market}, task_id: {task_id}")

        # TaskProgress 업데이트: 시작
        if task_id:
            db.query(TaskProgress).filter(TaskProgress.task_id == task_id).update({
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

        logger.info(f"Starting price history crawling for stock {stock.symbol}")

        # 기존 데이터 확인
        latest_record = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id
        ).order_by(StockPriceHistory.date.desc()).first()

        # 크롤링 실행
        price_data = price_history_crawler.fetch_price_history(stock.symbol, days)

        if not price_data:
            return {
                "success": 0,
                "failed": 1,
                "total": 1,
                "message": f"No price data found for {stock.symbol}"
            }

        # 데이터베이스에 저장
        success_count = 0
        failed_count = 0

        for data in price_data:
            try:
                # 기존 데이터 확인 (중복 방지)
                existing = db.query(StockPriceHistory).filter(
                    StockPriceHistory.stock_id == stock_id,
                    StockPriceHistory.date == data['date']
                ).first()

                if existing:
                    # 기존 데이터 업데이트
                    existing.open_price = data['open_price']
                    existing.high_price = data['high_price']
                    existing.low_price = data['low_price']
                    existing.close_price = data['close_price']
                    existing.volume = data['volume']
                    existing.updated_at = datetime.utcnow()
                else:
                    # 새 데이터 추가
                    new_record = StockPriceHistory(
                        stock_id=stock_id,
                        **data
                    )
                    db.add(new_record)

                success_count += 1

            except Exception as e:
                logger.error(f"Error saving price data for {data['date']}: {str(e)}")
                failed_count += 1
                continue

        # 커밋
        db.commit()

        logger.info(f"Price history crawling completed for {stock.symbol}: {success_count} success, {failed_count} failed")

        return {
            "success": success_count,
            "failed": failed_count,
            "total": len(price_data),
            "message": f"Successfully crawled {success_count} price records for {stock.symbol}"
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Error crawling price history for stock {stock_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
