"""Causal single-stock, long-only simulation. Decisions at close; fills next open."""
from datetime import date
import math
import pandas as pd
from app.causal_signals import trend_features

STRATEGIES = ('golden_cross', 'ma_breakout_up', 'descending_trendline_breakout')


def validate_bars(bars):
    previous = None
    for bar in bars:
        if previous and bar['date'] <= previous['date']:
            raise ValueError('시세 날짜가 중복되거나 순서가 올바르지 않습니다.')
        values = [float(bar[k]) for k in ('open_price','high_price','low_price','close_price')]
        if not all(math.isfinite(v) and v > 0 for v in values):
            raise ValueError('0·결측·무한대 가격이 있어 계산할 수 없습니다.')
        opening, high, low, close = values
        if high+1e-6 < max(opening,close,low) or low-1e-6 > min(opening,close,high):
            raise ValueError('일봉의 시가·고가·저가·종가 관계가 올바르지 않습니다.')
        if previous and abs(opening/previous['close_price']-1) > .35:
            raise ValueError(f"{bar['date']}에 큰 가격 단절이 있습니다. 급등락·기업행사 및 수정주가를 확인해주세요.")
        previous = bar


def entry_signals(bars, strategy, ma_period=90):
    if strategy not in STRATEGIES:
        raise ValueError('지원하지 않는 전략입니다.')
    df = pd.DataFrame([{'date':b['date'],'open':b['open_price'],'high':b['high_price'],
                        'low':b['low_price'],'close':b['close_price'],'volume':b.get('volume',0)} for b in bars]).set_index('date')
    close = df['close']
    if strategy == 'golden_cross':
        short = close.rolling(20, min_periods=20).mean()
        long = close.rolling(60, min_periods=60).mean()
        return ((short.shift(1) < long.shift(1)) & (short > long)).tolist()
    if strategy == 'ma_breakout_up':
        ma = close.rolling(ma_period, min_periods=ma_period).mean()
        return ((close.shift(1) < ma.shift(1)) & (close > ma)).tolist()
    return trend_features(df)['buy_signal'].astype(bool).tolist()


def simulate(bars, signals, start, initial_cash, fee_bps, slippage_bps, holding_sessions, buy_hold=False):
    fee, slip = fee_bps/10000, slippage_bps/10000
    cash = float(initial_cash)
    position = None
    trades, equity = [], []
    fees = slippage = 0.0
    peak = cash
    max_drawdown = 0.0
    first = next((i for i,b in enumerate(bars) if b['date'] >= start), len(bars))
    for i in range(first, len(bars)):
        bar = bars[i]
        exited = False
        if position and i >= position['exit_index']:
            price = bar['open_price']*(1-slip)
            proceeds = position['shares']*price
            exit_fee = proceeds*fee
            cash = proceeds-exit_fee
            fees += exit_fee
            slippage += position['shares']*bar['open_price']*slip
            trades.append({**position, 'exit_date':bar['date'], 'exit_price':price,
                'exit_fee':exit_fee,'profit':cash-position['entry_cash'],
                'return_pct':(cash/position['entry_cash']-1)*100,'exit_reason':'holding_period'})
            position = None
            exited = True
        wants_entry = (buy_hold and i == first) or (not buy_hold and i > 0 and signals[i-1])
        # No last-day entry: a complete next-session observation must exist.
        if not position and not exited and wants_entry and i < len(bars)-1:
            price = bar['open_price']*(1+slip)
            shares = cash/(price*(1+fee))
            entry_fee = shares*price*fee
            fees += entry_fee
            slippage += shares*bar['open_price']*slip
            position = {'signal_date':bars[i-1]['date'] if not buy_hold else None,
                'entry_date':bar['date'],'entry_price':price,'entry_fee':entry_fee,
                'entry_cash':cash,'shares':shares,
                'exit_index':len(bars)+1 if buy_hold else i+holding_sessions}
            cash = 0.0
        # Period end is declared in advance. Both strategy and benchmark liquidate at its close.
        if position and i == len(bars)-1:
            price = bar['close_price']*(1-slip)
            proceeds = position['shares']*price
            exit_fee = proceeds*fee
            cash = proceeds-exit_fee
            fees += exit_fee
            slippage += position['shares']*bar['close_price']*slip
            trades.append({**position,'exit_date':bar['date'],'exit_price':price,
                'exit_fee':exit_fee,'profit':cash-position['entry_cash'],
                'return_pct':(cash/position['entry_cash']-1)*100,'exit_reason':'period_end'})
            position = None
        value = cash + (position['shares']*bar['close_price'] if position else 0)
        peak = max(peak,value)
        drawdown = (value/peak-1)*100
        max_drawdown = min(max_drawdown,drawdown)
        equity.append({'date':bar['date'],'equity':round(value,6),'drawdown_pct':round(drawdown,6)})
    return {'final_equity':round(cash,6),'return_pct':(cash/initial_cash-1)*100,
        'max_drawdown_pct':max_drawdown,'trade_count':len(trades),
        'win_rate_pct':sum(t['profit']>0 for t in trades)/len(trades)*100 if trades else None,
        'fees_paid':fees,'slippage_cost':slippage,'trades':trades,'equity':equity}


def backtest(bars, strategy, start, initial_cash=10000, fee_bps=10, slippage_bps=5, holding_sessions=10, ma_period=90):
    validate_bars(bars)
    first = next((i for i,b in enumerate(bars) if b['date']>=start),len(bars))
    if first < 90 or len(bars)-first < 2:
        raise ValueError('평가 시작 전 90거래일과 평가 기간 2거래일 이상의 수정주가가 필요합니다.')
    signals = entry_signals(bars,strategy,ma_period)
    result = simulate(bars,signals,start,initial_cash,fee_bps,slippage_bps,holding_sessions)
    gross = simulate(bars,signals,start,initial_cash,0,0,holding_sessions)
    benchmark = simulate(bars,signals,start,initial_cash,fee_bps,slippage_bps,holding_sessions,buy_hold=True)
    result.update({'gross_return_pct':gross['return_pct'],
        'cost_drag_pct':gross['return_pct']-result['return_pct'],
        'benchmark_return_pct':benchmark['return_pct'],
        'excess_return_pct':result['return_pct']-benchmark['return_pct'],
        'start_date':bars[first]['date'],'end_date':bars[-1]['date'],
        'evaluation_sessions':len(bars)-first,'warmup_sessions':first,
        'strategy':strategy,'ma_period':ma_period,'initial_cash':initial_cash,
        'fee_bps':fee_bps,'slippage_bps':slippage_bps,'holding_sessions':holding_sessions})
    return result
