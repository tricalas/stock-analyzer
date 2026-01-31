#!/usr/bin/env python3
"""
모든 종목의 MA90 일괄 업데이트 스크립트

기존 StockPriceHistory 데이터를 사용하여 Stock.ma90_price를 계산/업데이트합니다.
히스토리를 새로 수집하지 않고 DB에 있는 데이터만 사용합니다.

사용법:
    cd backend
    source venv/bin/activate
    python scripts/update_all_ma90.py
"""

import sys
import os

# 프로젝트 루트를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal
from app.models import Stock, StockPriceHistory


def update_all_ma90():
    """모든 종목의 MA90 일괄 업데이트"""
    db = SessionLocal()

    try:
        # 60일 이상 히스토리가 있는 활성 종목들 조회
        stocks = db.query(Stock).filter(
            Stock.is_active == True,
            Stock.history_records_count >= 60
        ).all()

        total = len(stocks)
        print(f"📊 MA90 업데이트 대상: {total}개 종목")
        print("-" * 50)

        updated_count = 0
        skipped_count = 0

        for i, stock in enumerate(stocks, 1):
            # 최근 90일 종가 조회
            prices = db.query(StockPriceHistory.close_price).filter(
                StockPriceHistory.stock_id == stock.id
            ).order_by(StockPriceHistory.date.desc()).limit(90).all()

            if len(prices) < 60:
                skipped_count += 1
                continue

            # 평균 계산
            close_prices = [p.close_price for p in prices if p.close_price is not None]
            if not close_prices:
                skipped_count += 1
                continue

            ma90 = sum(close_prices) / len(close_prices)
            old_ma90 = stock.ma90_price

            # Stock 테이블 업데이트
            db.query(Stock).filter(Stock.id == stock.id).update(
                {"ma90_price": ma90},
                synchronize_session=False
            )
            updated_count += 1

            # 진행 상황 출력 (10개마다)
            if i % 10 == 0 or i == total:
                print(f"[{i}/{total}] 처리 중... (업데이트: {updated_count}, 스킵: {skipped_count})")

        db.commit()

        print("-" * 50)
        print(f"✅ 완료!")
        print(f"   - 업데이트: {updated_count}개")
        print(f"   - 스킵: {skipped_count}개")

        return updated_count, skipped_count

    except Exception as e:
        print(f"❌ 오류 발생: {str(e)}")
        db.rollback()
        raise

    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 50)
    print("MA90 일괄 업데이트 스크립트")
    print("=" * 50)
    update_all_ma90()
