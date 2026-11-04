"""Administrator-only, transactional stock maintenance."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.auth import get_admin_user
from app.database import get_db
from app.models import Stock, StockPrice, StockDailyData, StockPriceHistory, StockSignal, StockTagAssignment, HistoryCollectionLog
from app.constants import ETF_KEYWORDS
from app.cache import invalidate_cache

router = APIRouter(dependencies=[Depends(get_admin_user)])


def _delete(db, stocks):
    ids = [stock.id for stock in stocks]
    if not ids:
        return {"deleted_count":0, "deleted_history_count":0, "deleted_signal_count":0, "deleted_tag_count":0}
    result = {"deleted_count":len(ids)}
    try:
        for model, key in ((StockPriceHistory,'deleted_history_count'),(StockSignal,'deleted_signal_count'),
                           (StockTagAssignment,'deleted_tag_count'),(HistoryCollectionLog,'deleted_log_count'),
                           (StockPrice,'deleted_price_count'),(StockDailyData,'deleted_daily_count')):
            result[key] = db.query(model).filter(model.stock_id.in_(ids)).delete(synchronize_session=False)
        db.query(Stock).filter(Stock.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        raise
    invalidate_cache()
    return result


def _preview_or_delete(db, stocks, confirm):
    sample = [{"id":s.id,"symbol":s.symbol,"name":s.name,"market":s.market} for s in stocks[:50]]
    if not confirm:
        return {"mode":"preview","preview":True,"delete_count":len(stocks),"stocks":sample}
    result = _delete(db, stocks)
    return {"success":True,"mode":"deleted", "deleted_stocks":sample, **result}


@router.delete('/api/stocks/cleanup-etf')
def cleanup_etf_stocks(confirm: bool = Query(False), db: Session = Depends(get_db)):
    from sqlalchemy import or_
    stocks = db.query(Stock).filter(or_(*[Stock.name.ilike(f'%{word}%') for word in ETF_KEYWORDS])).all()
    return _preview_or_delete(db, stocks, confirm)


@router.delete('/api/stocks/cleanup-kr')
def cleanup_korean_stocks(confirm: bool = Query(False), db: Session = Depends(get_db)):
    return _preview_or_delete(db, db.query(Stock).filter(Stock.market == 'KR').all(), confirm)


@router.delete('/api/stocks/cleanup-low-cap')
def cleanup_low_market_cap_stocks(keep_top: int = Query(1000, ge=100, le=5000),
                                  confirm: bool = Query(False), db: Session = Depends(get_db)):
    keep = select(Stock.id).where(Stock.market == 'US', Stock.is_active == True).order_by(Stock.market_cap.desc().nullslast()).limit(keep_top)
    stocks = db.query(Stock).filter(Stock.market == 'US', ~Stock.id.in_(keep)).all()
    result = _preview_or_delete(db, stocks, confirm)
    result['kept_count'] = db.query(Stock).filter(Stock.market == 'US', Stock.is_active == True).count() if confirm else min(keep_top, db.query(Stock).filter(Stock.market == 'US', Stock.is_active == True).count())
    return result


@router.delete('/api/stocks/cleanup-no-history')
def cleanup_stocks_without_history(confirm: bool = Query(False), db: Session = Depends(get_db)):
    # Check the actual relation, since cached record counts can be stale.
    return _preview_or_delete(db, db.query(Stock).filter(~Stock.price_history.any()).all(), confirm)


@router.delete('/api/stocks/{stock_id}')
def delete_stock(stock_id: int, db: Session = Depends(get_db)):
    stock = db.get(Stock, stock_id)
    if stock is None:
        raise HTTPException(status_code=404, detail='Stock not found')
    name = stock.name
    result = _delete(db,[stock])
    return {"success":True,"message":f"{name} 삭제 완료", **result}
