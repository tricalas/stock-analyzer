"""One filtered, freshness-checked signal feed for the MA and trendline views."""
from datetime import timedelta
import json
from sqlalchemy import and_,or_,func,case,desc
from sqlalchemy.orm import joinedload
from fastapi import HTTPException
from app.models import Stock,StockSignal
from app.market_clock import latest_session
from app.freshness import iso

MA_STRATEGIES=('golden_cross','death_cross','ma_support','ma_resistance','ma_breakout_up',
               'ma_breakout_down','ma_bullish_alignment','ma_bearish_alignment')
TREND_STRATEGIES=('descending_trendline_breakout','approaching_breakout','pullback_buy','doji_star')


def signal_feed(db,category,skip=0,limit=30,strategy=None,signal_type=None,
                return_filter='all',search='',days=10,sort='latest'):
    strategies=MA_STRATEGIES if category=='ma' else TREND_STRATEGIES
    if strategy is not None and strategy not in strategies:
        raise HTTPException(422,'선택한 분석 종류에서 지원하지 않는 전략입니다.')
    expected={market:latest_session(market=market)[0] for market in ('US','KR')}
    as_of=Stock.ma_signal_as_of_date if category=='ma' else Stock.signal_as_of_date
    analyzed=Stock.ma_signal_analyzed_at if category=='ma' else Stock.signal_analyzed_at
    windows=[];fresh=[]
    for market,session in expected.items():
        windows.append(and_(Stock.market==market,StockSignal.signal_date>=session-timedelta(days=days-1),
                            StockSignal.signal_date<=session))
        fresh.append(and_(Stock.market==market,Stock.history_completed_date==session,as_of==session,
                          analyzed>=Stock.history_updated_at,
                          StockSignal.analyzed_at>=Stock.history_updated_at,
                          Stock.history_records_count >= (90 if category=='ma' else 60),
                          or_(Stock.market!='US',Stock.history_precision_version>=1)))
    query=db.query(StockSignal).join(Stock,Stock.id==StockSignal.stock_id).filter(
        StockSignal.is_active==True,Stock.is_active==True,
        ~Stock.recovery_issue.has(status='reviewed'),
        StockSignal.strategy_name.in_(strategies),or_(*windows))
    if strategy:query=query.filter(StockSignal.strategy_name==strategy)
    if signal_type:query=query.filter(StockSignal.signal_type==signal_type)
    if search.strip():
        term=search.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        query=query.filter(or_(Stock.symbol.ilike('%'+term+'%',escape='\\'),Stock.name.ilike('%'+term+'%',escape='\\')))
    if return_filter=='positive':query=query.filter(StockSignal.return_percent>0)
    elif return_filter=='negative':query=query.filter(StockSignal.return_percent<0)
    elif return_filter=='flat':query=query.filter(StockSignal.return_percent==0)
    elif return_filter=='unknown':query=query.filter(StockSignal.return_percent.is_(None))
    excluded=query.filter(or_(*fresh).is_not(True)).count()
    current=query.filter(or_(*fresh))
    count,stock_count,positive,negative,flat,unknown,average,last=current.with_entities(
        func.count(StockSignal.id),func.count(func.distinct(StockSignal.stock_id)),
        func.sum(case((StockSignal.return_percent>0,1),else_=0)),
        func.sum(case((StockSignal.return_percent<0,1),else_=0)),
        func.sum(case((StockSignal.return_percent==0,1),else_=0)),
        func.sum(case((StockSignal.return_percent.is_(None),1),else_=0)),
        func.avg(StockSignal.return_percent),func.max(StockSignal.analyzed_at)).one()
    ordering=[]
    if sort=='return_desc':ordering.append(StockSignal.return_percent.desc().nullslast())
    elif sort=='return_asc':ordering.append(StockSignal.return_percent.asc().nullslast())
    ordering.extend((desc(StockSignal.signal_date),desc(StockSignal.id)))
    rows=current.options(joinedload(StockSignal.stock)).order_by(*ordering).offset(skip).limit(limit).all()
    signals=[]
    for row in rows:
        stock=row.stock
        details=row.details
        if category=='ma' and details:
            try:details=json.loads(details)
            except (ValueError,TypeError):details={}
        signals.append({**{c.name:getattr(row,c.name) for c in row.__table__.columns},'details':details,
            'stock':stock,'symbol':stock.symbol,'name':stock.name,'market':stock.market,
            'exchange':stock.exchange,'freshness':stock.freshness,'price_as_of':iso(row.analyzed_at)})
    return {'total':count,'signals':signals,'analyzed_at':iso(last),
        'stats':{'total_signals':count,'stock_count':stock_count,'positive_returns':positive or 0,
                 'negative_returns':negative or 0,'flat_returns':flat or 0,'unknown_returns':unknown or 0,
                 'avg_return':round(average,2) if average is not None else None},
        'excluded_stale':excluded,'expected_sessions':{k:iso(v) for k,v in expected.items()},
        'next_skip':skip+len(rows) if rows and skip+len(rows)<count else None,
        'category':category,'days':days}
