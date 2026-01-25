import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from app.crawlers.crawler_manager import CrawlerManager
from app.crawlers.kis_history_crawler import kis_history_crawler
from app.config import settings
from datetime import datetime
import pytz

logger = logging.getLogger(__name__)

class StockScheduler:
    def __init__(self):
        self.scheduler = BackgroundScheduler()
        self.crawler_manager = CrawlerManager()
        self._setup_jobs()

    def _setup_jobs(self):
        """스케줄 작업 설정"""
        # 한국 시간대 설정
        kst = pytz.timezone('Asia/Seoul')

        if settings.ENABLE_AUTO_HISTORY_COLLECTION:
            logger.info("✅ Auto history collection ENABLED")

            # 평일 오후 4시 10분: 한국 장 마감 후 히스토리 수집
            self.scheduler.add_job(
                func=self._collect_tagged_stocks_history,
                trigger=CronTrigger(hour=16, minute=10, day_of_week='mon-fri', timezone=kst),
                id='kr_market_history_collection',
                name='Korean Market History Collection (After Close)',
                replace_existing=True
            )
            logger.info("📅 Scheduled: Korean market history collection (Mon-Fri 16:10 KST)")

            # 평일 오전 6시 10분 (KST): 미국 장 마감 후 히스토리 수집
            # 미국 시간 기준 전날 오후 5시 마감 (EST: UTC-5) → KST 오전 7시
            # 약간 여유를 둬서 오전 6시 10분에 수집
            self.scheduler.add_job(
                func=self._collect_tagged_stocks_history,
                trigger=CronTrigger(hour=6, minute=10, day_of_week='tue-sat', timezone=kst),
                id='us_market_history_collection',
                name='US Market History Collection (After Close)',
                replace_existing=True
            )
            logger.info("📅 Scheduled: US market history collection (Tue-Sat 06:10 KST)")

        else:
            logger.info("⚠️ Auto history collection DISABLED - using manual updates only")
            logger.info("💡 To enable: Set ENABLE_AUTO_HISTORY_COLLECTION=true in .env")

    def _crawl_all_stocks(self):
        """모든 주식 데이터 크롤링"""
        try:
            logger.info("Starting scheduled stock crawling...")
            result = self.crawler_manager.update_stock_list("ALL")
            logger.info(f"Scheduled crawling completed: {result['success']}/{result['total']} stocks")
            return result
        except Exception as e:
            logger.error(f"Error in scheduled stock crawling: {str(e)}")
            return {"success": 0, "failed": 0, "total": 0, "error": str(e)}

    def _collect_tagged_stocks_history(self):
        """히스토리 수집 (KIS API 사용) - 모드에 따라 다르게 동작"""
        try:
            mode = settings.HISTORY_COLLECTION_MODE.lower()
            logger.info(f"🚀 Starting scheduled history collection (mode: {mode})...")

            if mode == "tagged":
                # 태그가 있는 종목만
                result = kis_history_crawler.collect_history_for_tagged_stocks(
                    days=settings.HISTORY_COLLECTION_DAYS
                )
            elif mode == "top":
                # 시총 상위 N개 종목
                result = kis_history_crawler.collect_history_for_all_stocks(
                    days=settings.HISTORY_COLLECTION_DAYS,
                    limit=settings.HISTORY_COLLECTION_LIMIT
                )
            else:  # "all" 또는 기타
                # 모든 활성 종목
                result = kis_history_crawler.collect_history_for_all_stocks(
                    days=settings.HISTORY_COLLECTION_DAYS,
                    limit=None
                )

            if result.get("success_count", 0) > 0:
                logger.info(
                    f"✅ History collection completed ({mode} mode): "
                    f"{result['success_count']}/{result['total_stocks']} stocks, "
                    f"{result['total_records']} records saved"
                )
            else:
                logger.warning(
                    f"⚠️ History collection completed with errors ({mode} mode): "
                    f"{result.get('success_count', 0)}/{result.get('total_stocks', 0)} stocks"
                )

            return result
        except Exception as e:
            logger.error(f"❌ Error in scheduled history collection: {str(e)}")
            return {"success_count": 0, "total_stocks": 0, "total_records": 0, "error": str(e)}

    def start(self):
        """스케줄러 시작"""
        if not self.scheduler.running:
            self.scheduler.start()
            logger.info("Stock scheduler started")

    def stop(self):
        """스케줄러 중지"""
        if self.scheduler.running:
            self.scheduler.shutdown()
            logger.info("Stock scheduler stopped")

    def get_jobs(self):
        """현재 등록된 작업 목록 반환"""
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                'id': job.id,
                'name': job.name,
                'next_run_time': job.next_run_time.isoformat() if job.next_run_time else None,
                'trigger': str(job.trigger)
            })
        return jobs

    def trigger_manual_crawl(self):
        """수동으로 크롤링 실행"""
        logger.info("Manual stock crawling triggered")
        return self._crawl_all_stocks()

# 전역 스케줄러 인스턴스
stock_scheduler = StockScheduler()