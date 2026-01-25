"""
관심 종목 매매 신호 분석 스크립트
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import Stock, StockPriceHistory, StockTag, StockTagAssignment
import pandas as pd
from app.technical_indicators import generate_breakout_pullback_signals
from datetime import datetime, timedelta

def analyze_interest_stocks():
    """관심 종목 매매 신호 분석"""
    db = SessionLocal()

    try:
        # 관심 태그가 있는 종목들 조회
        interest_tag = db.query(StockTag).filter(StockTag.display_name == '관심').first()

        if not interest_tag:
            print("❌ 관심 태그를 찾을 수 없습니다.")
            return

        stocks = db.query(Stock).join(
            StockTagAssignment,
            Stock.id == StockTagAssignment.stock_id
        ).filter(
            StockTagAssignment.tag_id == interest_tag.id,
            Stock.is_active == True
        ).all()

        print('=' * 70)
        print('관심 종목 매매 신호 분석')
        print('=' * 70)
        print()

        for stock in stocks:
            print(f'📊 {stock.name} ({stock.symbol}) - {stock.market}')
            print('-' * 70)

            # 히스토리 데이터 조회
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=120)

            history = db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock.id,
                StockPriceHistory.date >= start_date
            ).order_by(StockPriceHistory.date.asc()).all()

            print(f'히스토리 데이터: {len(history)}개')

            if len(history) >= 60:
                # DataFrame 변환
                df = pd.DataFrame([
                    {
                        'date': h.date,
                        'open': float(h.open_price),
                        'high': float(h.high_price),
                        'low': float(h.low_price),
                        'close': float(h.close_price),
                        'volume': float(h.volume)
                    }
                    for h in history
                ])

                # 전략 적용
                result_df = generate_breakout_pullback_signals(df)

                # 매수 신호 확인
                buy_signals = result_df[result_df['buy_signal'] == 1]

                print(f'매수 신호: {len(buy_signals)}개 발견')

                if len(buy_signals) > 0:
                    print()
                    print('최근 매수 신호:')
                    for idx, signal in buy_signals.tail(5).iterrows():
                        date_str = signal['date'].strftime('%Y-%m-%d')
                        price = signal['close']

                        # 현재가와 비교
                        latest_price = df.iloc[-1]['close']
                        change_pct = ((latest_price - price) / price) * 100

                        if stock.market == 'KR':
                            print(f'  • {date_str}: {price:,.0f}원 (현재 대비 {change_pct:+.2f}%)')
                        else:
                            print(f'  • {date_str}: ${price:.2f} (현재 대비 {change_pct:+.2f}%)')

                    # 최신 가격 정보
                    latest = df.iloc[-1]
                    print()
                    if stock.market == 'KR':
                        print(f'현재가: {latest["close"]:,.0f}원 (최근 일자: {latest["date"].strftime("%Y-%m-%d")})')
                    else:
                        print(f'현재가: ${latest["close"]:.2f} (최근 일자: {latest["date"].strftime("%Y-%m-%d")})')
                else:
                    print('현재 매수 신호가 없습니다.')

                # 돌파/되돌림 정보
                breakouts = result_df[result_df['breakout'] == True]
                pullbacks = result_df[result_df['pullback'] == True]

                print()
                print(f'최근 추세선 돌파: {len(breakouts.tail(5))}개')
                print(f'최근 되돌림: {len(pullbacks.tail(5))}개')

            else:
                print('⚠️ 데이터 부족 (최소 60일 필요)')

            print()
            print()

    finally:
        db.close()

if __name__ == "__main__":
    analyze_interest_stocks()
