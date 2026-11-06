"""Administrator operations: durable runs, data recovery and incident acknowledgement."""
from datetime import datetime, timedelta
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.auth import get_admin_user
from app.database import get_db
from app.models import (PipelineRun, PipelineItem, TaskProgress, RecoveryIssue, OperationalAlert,
                        ServiceCheck, Stock, StockSignal)
from app.workflow import create_run, dispatch_run, seed_issues
from app.market_clock import latest_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/operations', dependencies=[Depends(get_admin_user)])


def serialize(row):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns}


def enqueue(run):
    try:
        dispatch_run(run.id)
    except Exception:
        logger.exception('Run %s saved; scheduler will dispatch when broker recovers', run.id)
    return {'success': True, 'task_id': run.id, 'run_id': run.id, 'status': run.status}


class RunRequest(BaseModel):
    scope: Literal['all', 'tagged', 'retry'] = 'all'
    days: int = Field(default=180, ge=180, le=500)
    stock_ids: list[int] | None = Field(default=None, max_length=500)


class MappingRequest(BaseModel):
    provider_symbol: str | None = Field(default=None, max_length=20, pattern=r'^[A-Z0-9./-]+$')
    provider_exchange: Literal['NAS', 'NYS', 'AMS'] | None = None
    notes: str = Field(default='', max_length=1000)


@router.get('/overview')
def overview(db: Session = Depends(get_db)):
    checks = db.query(ServiceCheck).order_by(ServiceCheck.name).all()
    scheduler = next((check for check in checks if check.name == 'Scheduler'), None)
    open_alerts = db.query(OperationalAlert).filter_by(status='open').order_by(OperationalAlert.first_seen_at.desc()).all()
    runs = db.query(PipelineRun).order_by(PipelineRun.created_at.desc()).limit(20).all()
    return {'session_date': latest_session()[0], 'checks': [serialize(c) for c in checks],
            'monitoring_stale': scheduler is None or scheduler.checked_at < datetime.utcnow()-timedelta(minutes=3),
            'alerts': [serialize(a) for a in open_alerts],
            'unacknowledged_alerts': sum(a.acknowledged_at is None for a in open_alerts),
            'recovery_count': db.query(RecoveryIssue).filter_by(status='open').count(),
            'runs': [{**serialize(run), 'progress': serialize(db.query(TaskProgress).filter_by(task_id=run.id).one())} for run in runs]}


@router.get('/alerts')
def alerts(db: Session = Depends(get_db)):
    return [serialize(a) for a in db.query(OperationalAlert).order_by(OperationalAlert.last_seen_at.desc()).limit(100)]


@router.post('/alerts/{key}/acknowledge')
def acknowledge(key: str, db: Session = Depends(get_db)):
    row = db.get(OperationalAlert, key)
    if row is None:
        raise HTTPException(404, '알림을 찾을 수 없습니다.')
    row.acknowledged_at = datetime.utcnow()
    db.commit()
    return {'success': True}


@router.post('/runs')
def start_run(request: RunRequest, db: Session = Depends(get_db)):
    if request.stock_ids is not None and request.scope != 'retry':
        raise HTTPException(422, '종목 선택은 재시도 모드에서 사용해주세요.')
    run = create_run(db, request.scope, request.days, stock_ids=request.stock_ids)
    return enqueue(run)


@router.post('/runs/{run_id}/resume')
def resume_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(PipelineRun, run_id)
    if run is None:
        raise HTTPException(404, '작업을 찾을 수 없습니다.')
    if run.status in ('completed', 'partial'):
        raise HTTPException(409, '완료된 작업의 실패 종목은 재시도 메뉴를 이용해주세요.')
    if run.lease_until and run.lease_until > datetime.utcnow():
        return enqueue(run)
    other = db.query(PipelineRun).filter(PipelineRun.active_key == 'US', PipelineRun.id != run_id).first()
    if other:
        raise HTTPException(409, '다른 수집·분석 작업이 실행 중입니다.')
    run.status = 'queued'
    run.cancel_requested = False
    run.active_key = 'US'
    run.next_attempt_at = None
    run.error_message = None
    run.completed_at = None
    progress = db.query(TaskProgress).filter_by(task_id=run.id).one()
    progress.status = 'queued'
    progress.error_message = None
    progress.completed_at = None
    db.commit()
    return enqueue(run)


@router.get('/recovery')
def recovery(reason: str | None = None, search: str = '', skip: int = Query(0, ge=0),
             limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    query = db.query(RecoveryIssue, Stock).join(Stock, Stock.id == RecoveryIssue.stock_id).filter(RecoveryIssue.status == 'open')
    if reason:
        query = query.filter(RecoveryIssue.reason == reason)
    if search:
        query = query.filter(Stock.symbol.ilike('%'+search+'%') | Stock.name.ilike('%'+search+'%'))
    total = query.count()
    rows = query.order_by(Stock.symbol).offset(skip).limit(limit).all()
    return {'total': total, 'items': [{**serialize(issue), 'symbol': stock.symbol, 'name': stock.name,
             'exchange': stock.exchange, 'provider_symbol': stock.provider_symbol,
             'provider_exchange': stock.provider_exchange} for issue, stock in rows]}


@router.patch('/recovery/{stock_id}')
def update_mapping(stock_id: int, request: MappingRequest, db: Session = Depends(get_db)):
    stock = db.get(Stock, stock_id)
    issue = db.get(RecoveryIssue, stock_id)
    if stock is None or issue is None or stock.market != 'US':
        raise HTTPException(404, '복구 대상 종목을 찾을 수 없습니다.')
    if db.query(PipelineRun).filter_by(active_key='US').first():
        raise HTTPException(409, '수집·분석 작업 종료 후 공급사 코드를 수정해주세요.')
    changed = (stock.provider_symbol, stock.provider_exchange) != (request.provider_symbol, request.provider_exchange)
    stock.provider_symbol = request.provider_symbol
    stock.provider_exchange = request.provider_exchange
    issue.notes = request.notes
    if changed:
        stock.history_precision_version = 0
        stock.ma90_price = None
        stock.signal_analyzed_at = None
        stock.ma_signal_analyzed_at = None
        issue.status = 'open'
        issue.reason = 'symbol_review'
        issue.message = '공급사 코드가 수정되었습니다. 재수집 후 분석에 반영됩니다.'
        issue.resolved_at = None
        db.query(StockSignal).filter_by(stock_id=stock_id).update({'is_active': False})
    db.commit()
    from app.cache import invalidate_cache
    invalidate_cache()
    return {'success': True}
