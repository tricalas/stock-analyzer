from datetime import datetime,timedelta,date,timezone
import logging
from threading import Lock
from typing import Literal
from cachetools import TTLCache
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,Field
from sqlalchemy import func,and_,or_,case
from sqlalchemy.orm import Session
from app.auth import get_current_user
from app.database import get_db
from app.models import Stock,User,StockPriceHistory
from app.market_clock import latest_session,calendar
from app.backtesting import backtest
from app.cache import get_cache,set_cache

router=APIRouter(dependencies=[Depends(get_current_user)])
logger=logging.getLogger(__name__)
_limits=TTLCache(maxsize=1000,ttl=60)
_limit_lock=Lock()


@router.get('/api/data-status')
def data_status(db:Session=Depends(get_db)):
    markets=[]
    for market in ('US','KR'):
        expected,close=latest_session(market=market)
        valid=and_(Stock.history_completed_date>=expected,
                   or_(Stock.market!='US',Stock.history_precision_version>=1))
        trend=and_(valid,Stock.signal_as_of_date>=expected,Stock.signal_analyzed_at>=Stock.history_updated_at)
        ma=and_(valid,Stock.ma_signal_as_of_date>=expected,Stock.ma_signal_analyzed_at>=Stock.history_updated_at)
        counts=db.query(func.count(Stock.id),func.sum(case((valid,1),else_=0)),
                        func.sum(case((trend,1),else_=0)),func.sum(case((ma,1),else_=0)),
                        func.max(Stock.history_updated_at),func.max(Stock.quote_updated_at)).filter(
                            Stock.market==market,Stock.is_active==True).one()
        markets.append({'market':market,'expected_session':expected,'total':counts[0],
            'current_history':counts[1] or 0,'current_trend':counts[2] or 0,'current_ma':counts[3] or 0,
            'latest_collection_at':counts[4],'latest_quote_at':counts[5], 'automatic_collection':market=='US'})
    return {'checked_at':datetime.now(timezone.utc),'markets':markets}


class BacktestRequest(BaseModel):
    stock_id:int=Field(gt=0)
    strategy:Literal['golden_cross','ma_breakout_up','descending_trendline_breakout']='golden_cross'
    days:int=Field(default=180,ge=30,le=730)
    end_date:date|None=None
    initial_cash:float=Field(default=10000,ge=100,le=1000000000,allow_inf_nan=False)
    fee_bps:float=Field(default=10,ge=0,le=500,allow_inf_nan=False)
    slippage_bps:float=Field(default=5,ge=0,le=500,allow_inf_nan=False)
    holding_sessions:int=Field(default=10,ge=1,le=60)
    ma_period:Literal[20,60,90]=90


def rate_limit(user):
    from app.cache import _redis
    try:
        count=_redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,'backtest:'+user.user_token)
    except Exception:
        with _limit_lock:
            count=_limits.get(user.id,0)+1
            _limits[user.id]=count
    if int(count)>6:
        raise HTTPException(429,'1분에 6회까지 실행할 수 있습니다.',headers={'Retry-After':'60'})


@router.post('/api/backtests')
def run_backtest(request:BacktestRequest,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    stock=db.get(Stock,request.stock_id)
    if stock is None or not stock.is_active:
        raise HTTPException(404,'종목을 찾을 수 없습니다.')
    if stock.market!='US':
        raise HTTPException(422,'현재 백테스트는 미국 주식 수정주가를 지원합니다.')
    expected=latest_session()[0]
    end=request.end_date or expected
    if end < expected-timedelta(days=3650):
        raise HTTPException(422,'평가 종료일은 최근 10년 이내로 선택해주세요.')
    if end>expected:
        raise HTTPException(422,'완료되지 않은 거래일은 사용할 수 없습니다.')
    end=calendar().date_to_session(str(end),direction='previous').date()
    start=end-timedelta(days=request.days)
    cutoff=start-timedelta(days=180)
    rate_limit(user)
    key=f'backtest-adjusted:{stock.id}:{stock.provider_symbol}:{stock.provider_exchange}:{cutoff}:{end}:v1'
    cached=get_cache(key)
    if cached:
        bars=[{**b,'date':date.fromisoformat(b['date'])} for b in cached['bars']]
        fetched_at=cached['fetched_at']
    else:
        from app.crawlers.kis_history_crawler import kis_history_crawler as crawler
        if crawler.kis_client is None:
            raise HTTPException(503,'수정주가 공급사 연결이 설정되지 않았습니다.')
        try:
            bars=crawler._collect_us_stock_history(stock.provider_symbol or stock.symbol,
                stock.provider_exchange or crawler._get_us_exchange_code(stock.exchange),
                cutoff,end_date=end,adjusted=True)
        except Exception:
            logger.exception('Adjusted history unavailable for stock %s',stock.id)
            raise HTTPException(502,'공급사 수정주가를 받지 못했습니다. 원본 가격으로 대체하지 않았습니다.')
        fetched_at=datetime.now(timezone.utc).isoformat()
        if bars:
            set_cache(key,{'bars':[{**b,'date':b['date'].isoformat()} for b in bars],'fetched_at':fetched_at},ttl=300)
    if not bars or bars[-1]['date']!=end:
        raise HTTPException(422,'선택한 마지막 거래일의 수정주가가 없습니다. 공급사 지원 상태를 확인해주세요.')
    sessions={session.date() for session in calendar().sessions_in_range(str(max(start,bars[0]['date'])),str(end))}
    missing=sessions-{b['date'] for b in bars}
    if missing:
        raise HTTPException(422,f'평가 기간의 {len(missing)}개 거래일이 누락되어 계산하지 않았습니다.')
    try:
        result=backtest(bars,request.strategy,start,request.initial_cash,request.fee_bps,
                        request.slippage_bps,request.holding_sessions,request.ma_period)
    except ValueError as error:
        raise HTTPException(422,str(error))
    return {**result,'stock':{'id':stock.id,'symbol':stock.symbol,'name':stock.name},
            'price_source':'KIS MODP=1','price_basis':'provider_adjusted','data_fetched_at':fetched_at,
            'assumptions':['종가 확정 후 신호를 계산하고 다음 거래일 시가에 진입합니다.',
                '1종목·매수 전용·동시 1포지션·소수점 수량을 가정합니다.',
                '보유 기간 종료 다음 시가에 청산하며, 평가 마지막 날은 종가로 청산합니다.',
                '수수료와 슬리피지는 매수·매도 양쪽에 적용합니다.',
                '공급사 수정주가 기반 가격 수익률입니다. 배당 현금·세금·환율·시장 충격은 별도 반영하지 않습니다.',
                '현재 등록된 단일 종목의 과거 검증이며 당시 상장폐지 종목을 복원한 포트폴리오 검증이 아닙니다.']}
