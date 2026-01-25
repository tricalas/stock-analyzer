#!/usr/bin/env python3
"""
히스토리 수집 테스트 (모의투자 모드)
"""
import sys
import os

# 프로젝트 루트를 Python path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import Stock
from app.crawlers.kis_history_crawler import kis_history_crawler
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_history_collection():
    """태그된 종목 중 1개만 테스트"""
    db = SessionLocal()

    try:
        # 태그가 있는 미국 주식 1개만 조회
        from app.models import StockTagAssignment

        tagged_stock_ids = db.query(StockTagAssignment.stock_id).distinct().limit(5).all()
        tagged_stock_ids = [sid[0] for sid in tagged_stock_ids]

        stock = db.query(Stock).filter(
            Stock.id.in_(tagged_stock_ids),
            Stock.market == "US",
            Stock.is_active == True
        ).first()

        if not stock:
            print("❌ 테스트할 미국 주식이 없습니다.")
            return

        print(f"\n{'=' * 60}")
        print(f"히스토리 수집 테스트: {stock.name} ({stock.symbol})")
        print(f"{'=' * 60}\n")

        # 히스토리 수집
        result = kis_history_crawler.collect_history_for_stock(stock, days=120, db=db)

        print(f"\n{'=' * 60}")
        if result["success"]:
            print(f"✅ 수집 성공!")
            print(f"   종목: {result['symbol']}")
            print(f"   저장된 레코드: {result['records_saved']}건")
        else:
            print(f"❌ 수집 실패!")
            print(f"   에러: {result.get('error', 'Unknown error')}")
        print(f"{'=' * 60}\n")

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    test_history_collection()
