"""
관심 종목 히스토리 수집 스크립트
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import StockTagAssignment, Stock, StockTag
from app.crawlers.kis_history_crawler import kis_history_crawler

def collect_interest_stocks_history():
    """관심 태그가 있는 종목들의 히스토리 수집"""
    db = SessionLocal()

    try:
        # '관심' 태그 찾기
        interest_tag = db.query(StockTag).filter(StockTag.display_name == '관심').first()

        if not interest_tag:
            print("❌ 관심 태그를 찾을 수 없습니다.")
            return

        # 관심 태그가 있는 종목들 조회
        stocks = db.query(Stock).join(
            StockTagAssignment,
            Stock.id == StockTagAssignment.stock_id
        ).filter(
            StockTagAssignment.tag_id == interest_tag.id,
            Stock.is_active == True
        ).all()

        print("=" * 60)
        print(f"관심 종목 히스토리 수집 시작 ({len(stocks)}개)")
        print("=" * 60)
        print()

        results = []

        for i, stock in enumerate(stocks, 1):
            print(f"[{i}/{len(stocks)}] {stock.symbol} - {stock.name} ({stock.market})")
            print("-" * 60)

            result = kis_history_crawler.collect_history_for_stock(
                stock=stock,
                days=120,
                db=db
            )

            if result["success"]:
                print(f"✅ 성공: {result['records_saved']}개 레코드 저장")
            else:
                print(f"❌ 실패: {result.get('error', 'Unknown error')}")

            print()
            results.append(result)

        # 결과 요약
        print("=" * 60)
        print("수집 결과 요약")
        print("=" * 60)

        success_count = sum(1 for r in results if r["success"])
        total_records = sum(r.get("records_saved", 0) for r in results if r["success"])

        print(f"총 종목 수: {len(stocks)}개")
        print(f"성공: {success_count}개")
        print(f"실패: {len(stocks) - success_count}개")
        print(f"총 레코드 수: {total_records}개")
        print()

        # 상세 결과
        print("상세 결과:")
        for result in results:
            if result["success"]:
                print(f"  ✅ {result['symbol']}: {result['records_saved']}개")
            else:
                print(f"  ❌ {result.get('symbol', 'Unknown')}: {result.get('error', 'Error')}")

    finally:
        db.close()

if __name__ == "__main__":
    collect_interest_stocks_history()
