"""Compatibility facade. Dedicated monitoring process owns scheduling."""
from app.config import settings


class StockScheduler:
    def start(self):
        pass

    def stop(self):
        pass

    def get_jobs(self):
        return [{'id': 'durable_us_pipeline', 'name': '미국 장 마감 20분 후 수집·분석 / 중단 시 이어서 실행',
                 'interval_seconds': 60, 'enabled': settings.ENABLE_AUTO_HISTORY_COLLECTION}]

    def trigger_manual_crawl(self):
        from app.database import SessionLocal
        from app.workflow import create_run, dispatch_run
        with SessionLocal() as db:
            run = create_run(db, days=max(180, settings.HISTORY_COLLECTION_DAYS))
            run_id = run.id
        try:
            dispatch_run(run_id)
        except Exception:
            pass  # Scheduler retries the durable queue, including broker outages.
        return {'success': True, 'task_id': run_id, 'message': '수집·분석 작업이 등록되었습니다.'}

    def trigger_manual_history_collection(self, days=None, max_workers=None):
        return self.trigger_manual_crawl()


stock_scheduler = StockScheduler()
