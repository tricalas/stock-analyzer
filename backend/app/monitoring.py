"""Independent scheduler probes and persistent, deduplicated in-app incidents."""
from datetime import datetime, timedelta
import logging
import httpx
from sqlalchemy import func, or_, text
from app.config import settings
from app.database import SessionLocal
from app.models import ServiceCheck, OperationalAlert, PipelineRun, RecoveryIssue, Stock, StockPriceHistory
from app.market_clock import latest_session
from app.workflow import create_run, dispatch_run, seed_issues

logger = logging.getLogger(__name__)


def alert(db, key, title, detail, active, severity='warning'):
    row = db.get(OperationalAlert, key)
    now = datetime.utcnow()
    if not active:
        if row and row.status == 'open':
            row.status = 'resolved'
            row.resolved_at = now
        return
    if row is None:
        row = OperationalAlert(key=key, title=title, severity=severity)
        db.add(row)
    elif row.status == 'resolved':
        row.first_seen_at = now
        row.acknowledged_at = None
    row.status = 'open'
    row.title = title
    row.detail = detail
    row.severity = severity
    row.last_seen_at = now
    row.resolved_at = None


def check_result(db, name, healthy, detail, now=None):
    now = now or datetime.utcnow()
    check = db.get(ServiceCheck, name)
    if check is None:
        check = ServiceCheck(name=name, failures=0)
        db.add(check)
    check.healthy = healthy
    check.failures = 0 if healthy else check.failures+1
    check.checked_at = now
    check.detail = detail
    if healthy:
        check.last_success_at = now
    alert(db, 'service:'+name, f'{name} 연결 장애', detail,
          check.failures >= settings.MONITOR_FAILURE_THRESHOLD, 'critical')


def probes():
    """Outside API and Celery's work queue, so their outages remain visible."""
    result = []
    if settings.API_PUBLIC_URL:
        try:
            response = httpx.get(settings.API_PUBLIC_URL.rstrip('/')+'/health', timeout=5, follow_redirects=False)
            healthy = response.status_code == 200 and response.json().get('status') == 'ok'
            result.append(('API', healthy, '정상' if healthy else 'API 상태 점검 실패'))
        except Exception:
            result.append(('API', False, 'API 응답을 받지 못했습니다.'))
    try:
        from app.cache import _redis
        _redis.ping()
        result.append(('Redis', True, '정상'))
    except Exception:
        result.extend([('Redis', False, '브로커·캐시 연결 실패'), ('Worker', False, '작업 서버 상태 확인 실패')])
        return result
    try:
        from app.celery_app import celery_app
        replies = celery_app.control.ping(timeout=3)
        result.append(('Worker', bool(replies), f'{len(replies)}개 작업 서버 응답'))
    except Exception:
        result.append(('Worker', False, '작업 서버 상태 확인 실패'))
    return result


def evaluate_data(db, now=None):
    now = now or datetime.utcnow()
    session, close = latest_session(now)
    latest = db.query(StockPriceHistory.stock_id, func.max(StockPriceHistory.date).label('date')).group_by(StockPriceHistory.stock_id).subquery()
    stale = db.query(Stock).outerjoin(latest, latest.c.stock_id == Stock.id).filter(
        Stock.market == 'US', Stock.is_active == True, Stock.history_precision_version >= 1,
        or_(Stock.history_completed_date == None, Stock.history_completed_date < session)).count()
    due = now >= close+timedelta(minutes=settings.DATA_DELAY_MINUTES)
    alert(db, 'data:stale', '가격 데이터 갱신 지연', f'{session} 기준 {stale}개 종목의 가격이 늦게 수집되고 있습니다.', due and stale > 0)
    pending = db.query(RecoveryIssue).filter_by(status='open').count()
    alert(db, 'data:recovery', '수집 실패 종목 확인 필요', f'{pending}개 종목의 실패 원인을 확인하고 재시도해주세요.', pending > 0)
    active = db.query(PipelineRun).filter(PipelineRun.active_key == 'US').first()
    stalled = active is not None and active.updated_at < now-timedelta(minutes=3)
    alert(db, 'pipeline:stalled', '수집·분석 작업 지연', '작업 응답을 기다리는 중입니다. 실행 기한이 지나면 저장된 단계부터 자동으로 이어집니다.', stalled)
    last = db.query(PipelineRun).order_by(PipelineRun.created_at.desc()).first()
    alert(db, 'pipeline:failed', '수집·분석 작업 중단', last.error_message if last else '', last is not None and last.status == 'failed', 'critical')
    alert(db, 'pipeline:partial', '수집·분석 일부 종목 실패', last.error_message if last else '', last is not None and last.status == 'partial')
    return {'session_date': session.isoformat(), 'stale_stocks': stale, 'recovery_stocks': pending}


def operational_tick():
    with SessionLocal() as db:
        postgres = db.bind.dialect.name == 'postgresql'
        lock_connection = db.bind.connect() if postgres else None
        locked = False
        try:
            if postgres:
                locked = lock_connection.execute(text('SELECT pg_try_advisory_lock(813452902)')).scalar()
                lock_connection.commit()
                if not locked:
                    return
            for name, healthy, detail in probes():
                check_result(db, name, healthy, detail)
            check_result(db, 'Scheduler', True, '1분 간격 상태 점검·중단 작업 복구')
            seed_issues(db)
            if settings.ENABLE_AUTO_HISTORY_COLLECTION:
                session, _ = latest_session()
                create_run(db, daily_key='daily:'+session.isoformat(), days=max(180, settings.HISTORY_COLLECTION_DAYS))
            from app.models import TaskProgress, StockCrawlLog
            from app.tasks import refresh_quotes_task
            quotes = db.query(TaskProgress, StockCrawlLog).join(StockCrawlLog, StockCrawlLog.task_id == TaskProgress.task_id).filter(
                TaskProgress.task_type == 'stock_crawl',
                or_(TaskProgress.status == 'queued', (TaskProgress.status == 'running') & (TaskProgress.updated_at < datetime.utcnow()-timedelta(minutes=6)))).all()
            for progress, log in quotes:
                if progress.updated_at and progress.updated_at > datetime.utcnow()-timedelta(seconds=45):
                    continue
                progress.status = 'queued'
                progress.updated_at = datetime.utcnow()
                db.commit()
                try:
                    refresh_quotes_task.apply_async(args=[log.market, progress.task_id])
                except Exception:
                    logger.warning('Quote refresh remains queued')
            evaluate_data(db)
            db.commit()
            now = datetime.utcnow()
            runs = db.query(PipelineRun).filter(PipelineRun.status.in_(['queued', 'running']),
                or_(PipelineRun.lease_until == None, PipelineRun.lease_until < now),
                or_(PipelineRun.next_attempt_at == None, PipelineRun.next_attempt_at <= now),
                or_(PipelineRun.last_dispatched_at == None, PipelineRun.last_dispatched_at < now-timedelta(seconds=45))).all()
            for run in runs:
                run.last_dispatched_at = now
                db.commit()
                try:
                    dispatch_run(run.id)
                except Exception:
                    logger.exception('Broker unavailable; durable run remains queued: %s', run.id)
        finally:
            if lock_connection is not None:
                if locked:
                    lock_connection.execute(text('SELECT pg_advisory_unlock(813452902)'))
                    lock_connection.commit()
                lock_connection.close()


if __name__ == '__main__':
    from apscheduler.schedulers.blocking import BlockingScheduler
    logging.basicConfig(level=logging.INFO)
    scheduler = BlockingScheduler(timezone='UTC')
    scheduler.add_job(operational_tick, 'interval', seconds=60, id='operations',
                      max_instances=1, coalesce=True, next_run_time=datetime.utcnow())
    scheduler.start()
