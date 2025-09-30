import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from app.crawlers.crawler_manager import CrawlerManager
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

        # 평일 오전 9시 1분에 주식 데이터 크롤링 (장 시작 후)
        self.scheduler.add_job(
            func=self._crawl_all_stocks,
            trigger=CronTrigger(hour=9, minute=1, day_of_week='mon-fri', timezone=kst),
            id='daily_stock_crawl',
            name='Daily Stock Data Crawling (Weekdays)',
            replace_existing=True
        )

        # 평일 오후 4시에 추가 크롤링 (장 마감 후)
        self.scheduler.add_job(
            func=self._crawl_all_stocks,
            trigger=CronTrigger(hour=16, minute=0, day_of_week='mon-fri', timezone=kst),
            id='afternoon_stock_crawl',
            name='Afternoon Stock Data Crawling (Weekdays)',
            replace_existing=True
        )

        logger.info("Stock crawling jobs scheduled:")
        logger.info("- Daily crawling at 09:01 KST (weekdays only, after market open)")
        logger.info("- Afternoon crawling at 16:00 KST (weekdays only, after market close)")

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