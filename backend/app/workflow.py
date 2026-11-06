"""One leased, bounded unit at a time; database checkpoints survive broker/process loss."""
from datetime import datetime, timedelta
import logging
import uuid
from sqlalchemy import or_, and_, func, case
from sqlalchemy.exc import IntegrityError
from app.database import SessionLocal
from app.models import (PipelineRun, PipelineItem, TaskProgress, Stock, StockPriceHistory,
                        StockTagAssignment, RecoveryIssue, HistoryCollectionLog)
from app.market_clock import latest_session

logger = logging.getLogger(__name__)
STAGES = ("history", "signals", "ma")
TERMINAL = ("completed", "partial", "failed", "cancelled")


def classify_error(message):
    value = message.lower()
    if "omitted" in value or "incomplete" in value:
        return "missing_history"
    if "no data" in value:
        return "provider_unavailable"
    if "stale" in value:
        return "stale_history"
    if "429" in value or "rate" in value or "초당" in value or "timeout" in value or "connection" in value:
        return "temporary_error"
    return "collection_error"


def record_issue(db, stock_id, message):
    issue = db.get(RecoveryIssue, stock_id)
    if issue is None:
        issue = RecoveryIssue(stock_id=stock_id, attempts=0)
        db.add(issue)
    issue.reason = classify_error(message)
    issue.message = message[:1000]
    issue.status = "open"
    issue.resolved_at = None
    issue.last_seen_at = datetime.utcnow()
    issue.attempts += 1
    return issue


def seed_issues(db):
    """Import legacy failures once without labelling an unavailable stock as delisted."""
    latest = db.query(HistoryCollectionLog.stock_id, func.max(HistoryCollectionLog.id).label('id')).group_by(HistoryCollectionLog.stock_id).subquery()
    rows = db.query(Stock.id, HistoryCollectionLog.error_message).outerjoin(
        latest, latest.c.stock_id == Stock.id).outerjoin(HistoryCollectionLog, HistoryCollectionLog.id == latest.c.id).outerjoin(
        RecoveryIssue, RecoveryIssue.stock_id == Stock.id).filter(
        Stock.market == 'US', Stock.is_active == True, Stock.history_precision_version < 1,
        RecoveryIssue.stock_id == None).all()
    for stock_id, error in rows:
        record_issue(db, stock_id, error or "No data: price precision recovery required")
    db.commit()


def _add_items(db, run, stock_ids=None):
    query = db.query(Stock.id).filter(Stock.market == 'US', Stock.is_active == True)
    if stock_ids is not None:
        query = query.filter(Stock.id.in_(stock_ids))
    elif run.scope == 'tagged':
        query = query.filter(Stock.id.in_(db.query(StockTagAssignment.stock_id)))
    elif run.scope == 'retry':
        query = query.filter(Stock.id.in_(db.query(RecoveryIssue.stock_id).filter(RecoveryIssue.status == 'open')))
    for (stock_id,) in query.order_by(Stock.id).all():
        db.add(PipelineItem(run_id=run.id, stock_id=stock_id))


def create_run(db, scope='all', days=180, daily_key=None, stock_ids=None):
    if daily_key:
        existing = db.query(PipelineRun).filter_by(daily_key=daily_key).first()
        if existing:
            return existing
    active = db.query(PipelineRun).filter_by(active_key='US').first()
    if active:
        return active
    run = PipelineRun(id=str(uuid.uuid4()), active_key='US', daily_key=daily_key,
                      scope=scope, days=days, session_date=latest_session()[0],
                      stage='history' if scope == 'retry' else 'quotes')
    db.add(run)
    try:
        db.flush()
        db.add(TaskProgress(task_id=run.id, task_type='pipeline', status='queued',
                            message='자동 수집·분석 대기 중', total_items=0, current_item=0,
                            success_count=0, failed_count=0))
        if scope == 'retry':
            _add_items(db, run, stock_ids)
        db.commit()
    except IntegrityError:
        db.rollback()
        run = db.query(PipelineRun).filter_by(active_key='US').first()
        if run is None and daily_key:
            run = db.query(PipelineRun).filter_by(daily_key=daily_key).first()
        if run is None:
            raise
    return run


def dispatch_run(run_id):
    from app.tasks import pipeline_unit_task
    pipeline_unit_task.apply_async(args=[run_id], expires=600)


def claim_run(db, run_id, now=None):
    now = now or datetime.utcnow()
    token = str(uuid.uuid4())
    count = db.query(PipelineRun).filter(
        PipelineRun.id == run_id, PipelineRun.status.in_(['queued', 'running']),
        or_(PipelineRun.lease_until == None, PipelineRun.lease_until < now),
        or_(PipelineRun.next_attempt_at == None, PipelineRun.next_attempt_at <= now)).update({
            'lease_token': token, 'lease_until': now + timedelta(minutes=6),
            'status': 'running', 'updated_at': now}, synchronize_session=False)
    db.commit()
    return token if count else None


def sync_progress(db, run):
    db.flush()
    columns = [getattr(PipelineItem, stage+'_status') for stage in STAGES]
    total, finished, failed, succeeded = db.query(
        func.count(PipelineItem.id),
        func.coalesce(func.sum(sum(case((column != 'pending', 1), else_=0) for column in columns)), 0),
        func.coalesce(func.sum(case((or_(*(column == 'failed' for column in columns)), 1), else_=0)), 0),
        func.coalesce(func.sum(case((and_(*(column.in_(['success', 'skipped']) for column in columns)), 1), else_=0)), 0)
    ).filter(PipelineItem.run_id == run.id).one()
    progress = db.query(TaskProgress).filter_by(task_id=run.id).one()
    progress.total_items = total * 3 + 1
    progress.current_item = int(run.stage != 'quotes') + finished
    progress.failed_count = failed
    progress.success_count = succeeded
    progress.message = f'{run.stage}: {progress.current_item}/{progress.total_items} 단계 처리'
    progress.status = 'completed' if run.status in ('completed', 'partial') else run.status
    progress.error_message = run.error_message
    if run.status in TERMINAL:
        progress.completed_at = run.completed_at
    run.updated_at = datetime.utcnow()


def _collect(db, run, item, stock):
    from app.crawlers.kis_history_crawler import kis_history_crawler as crawler
    quoted_at = stock.updated_at
    should, mode, last_date = crawler._should_collect_history(stock, db)
    if should:
        result = crawler.collect_history_for_stock(stock, days=run.days,
                    start_date=last_date + timedelta(days=1) if mode == 'incremental' else None, db=db)
        if not result.get('success'):
            raise RuntimeError(result.get('error', 'Collection failed'))
    latest = db.query(func.max(StockPriceHistory.date)).filter(StockPriceHistory.stock_id == stock.id, StockPriceHistory.date <= run.session_date).scalar()
    if latest is None or latest < run.session_date:
        raise RuntimeError(f'Stale history: last session {latest}, expected {run.session_date}')
    from app.market_clock import calendar
    close = calendar().session_close(str(run.session_date)).to_pydatetime().replace(tzinfo=None)
    if quoted_at is None or quoted_at < close:
        prices = db.query(StockPriceHistory).filter(StockPriceHistory.stock_id == stock.id, StockPriceHistory.date <= run.session_date).order_by(StockPriceHistory.date.desc()).limit(2).all()
        stock.current_price = prices[0].close_price
        stock.trading_volume = prices[0].volume
        if len(prices) == 2 and prices[1].close_price:
            stock.previous_close = prices[1].close_price
            stock.change_amount = stock.current_price-stock.previous_close
            stock.change_percent = stock.change_amount/stock.previous_close*100
    issue = db.get(RecoveryIssue, stock.id)
    if issue:
        issue.status = 'resolved'
        issue.resolved_at = datetime.utcnow()
    return 'success' if should else 'skipped'


def execute_unit(run_id):
    """Atomic lease excludes duplicates. A killed worker leaves a recoverable lease."""
    with SessionLocal() as db:
        token = claim_run(db, run_id)
        if not token:
            return
        run = db.get(PipelineRun, run_id)
        try:
            if run.stage == 'quotes':
                from app.crawlers.crawler_manager import CrawlerManager
                result = CrawlerManager().update_stock_list('US')
                if result.get('success', 0) == 0:
                    raise RuntimeError('현재가 갱신에 실패해 다음 단계를 중단했습니다.')
                _add_items(db, run)
                run.stage = 'history'
            else:
                stage = run.stage
                item = db.query(PipelineItem).filter_by(run_id=run.id, **{stage+'_status': 'pending'}).order_by(PipelineItem.id).first()
                if item is None:
                    if stage == 'ma':
                        has_failures = db.query(PipelineItem).filter(PipelineItem.run_id == run.id,
                            or_(*(getattr(PipelineItem, s+'_status') == 'failed' for s in STAGES))).first() is not None
                        run.status = 'partial' if has_failures else 'completed'
                        if has_failures:
                            errors = db.query(PipelineItem.error_message).filter(
                                PipelineItem.run_id == run.id, PipelineItem.error_message != None).limit(3).all()
                            run.error_message = '일부 종목 처리 실패: ' + '; '.join(row[0] for row in errors)
                        run.stage = 'completed'
                        run.active_key = None
                        run.completed_at = datetime.utcnow()
                    else:
                        run.stage = STAGES[STAGES.index(stage)+1]
                else:
                    attempts_key = stage+'_attempts'
                    setattr(item, attempts_key, getattr(item, attempts_key) + 1)
                    db.commit()  # Persist attempts before work, including hard process loss.
                    stock = db.get(Stock, item.stock_id)
                    try:
                        if getattr(item, attempts_key) > 3:
                            raise RuntimeError('Worker repeatedly stopped while processing this stock')
                        if stock is None or not stock.is_active:
                            status = 'skipped'
                        elif stage == 'history':
                            status = _collect(db, run, item, stock)
                        elif item.history_status == 'failed' or stock.history_precision_version < 1:
                            status = 'skipped'
                        else:
                            if stage == 'ma':
                                from app.moving_averages import update_ma90
                                update_ma90(stock.id, db, as_of=run.session_date)
                            minimum = 60 if stage == 'signals' else 90
                            count = db.query(StockPriceHistory).filter(StockPriceHistory.stock_id == stock.id,
                                StockPriceHistory.date >= run.session_date-timedelta(days=run.days),
                                StockPriceHistory.date <= run.session_date).count()
                            if count < minimum:
                                status = 'skipped'
                            else:
                                if stage == 'signals':
                                    from app.signal_analyzer import signal_analyzer as analyzer
                                else:
                                    from app.ma_signal_analyzer import ma_signal_analyzer as analyzer
                                analyzer._analyze_stock(stock.id, run.days, db, end_date=run.session_date)
                                status = 'success'
                        setattr(item, stage+'_status', status)
                        run.next_attempt_at = None
                    except Exception as error:
                        db.rollback()
                        message = str(error)[:1000]
                        temporary = classify_error(message) == 'temporary_error'
                        if temporary and getattr(item, attempts_key) < 3:
                            run.next_attempt_at = datetime.utcnow()+timedelta(seconds=30*getattr(item, attempts_key))
                        else:
                            setattr(item, stage+'_status', 'failed')
                        item.error_message = message
                        if stage == 'history' and stock is not None:
                            record_issue(db, stock.id, message)
            db.refresh(run, attribute_names=['cancel_requested'])
            if run.cancel_requested:
                run.status = 'cancelled'
                run.active_key = None
                run.completed_at = datetime.utcnow()
            run.lease_token = None
            run.lease_until = None
            sync_progress(db, run)
            db.commit()
        except Exception as error:
            db.rollback()
            run = db.get(PipelineRun, run_id)
            run.status = 'failed'
            run.error_message = str(error)[:1000]
            run.lease_until = None
            run.lease_token = None
            run.active_key = None
            run.completed_at = datetime.utcnow()
            sync_progress(db, run)
            db.commit()
            logger.exception('Pipeline unit failed: %s', run_id)
        should_dispatch = run.status not in TERMINAL and run.next_attempt_at is None
        if run.status in ('completed', 'partial'):
            from app.cache import invalidate_cache
            invalidate_cache()
    if should_dispatch:
        try:
            dispatch_run(run_id)
        except Exception:
            logger.exception('Broker unavailable; scheduler will resume %s', run_id)
