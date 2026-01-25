#!/usr/bin/env python3
"""
Railway 환경에서 직접 실행하는 히스토리 수집 스크립트
Usage: railway run python3 trigger_collection.py
"""
import os
import sys

# 프로젝트 루트를 Python path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.config import settings
from app.crawlers.kis_history_crawler import kis_history_crawler

def main():
    print("🚀 Starting initial 100-day history collection...")
    print(f"📊 Collection mode: {settings.HISTORY_COLLECTION_MODE}")

    try:
        mode = settings.HISTORY_COLLECTION_MODE.lower()

        if mode == "tagged":
            print("📌 Collecting for tagged stocks only...")
            result = kis_history_crawler.collect_history_for_tagged_stocks(days=100)
        elif mode == "top":
            print(f"📈 Collecting for top {settings.HISTORY_COLLECTION_LIMIT} stocks...")
            result = kis_history_crawler.collect_history_for_all_stocks(
                days=100,
                limit=settings.HISTORY_COLLECTION_LIMIT
            )
        else:  # "all"
            print("🌐 Collecting for ALL active stocks...")
            result = kis_history_crawler.collect_history_for_all_stocks(
                days=100,
                limit=None
            )

        print("\n✅ Collection completed!")
        print(f"📊 Stats: {result}")
        print(f"   - Total stocks: {result.get('total_stocks', 0)}")
        print(f"   - Successful: {result.get('success_count', 0)}")
        print(f"   - Failed: {result.get('failed_count', 0)}")
        print(f"   - Records saved: {result.get('total_records', 0)}")

        print("\n🎯 Next steps:")
        print("1. Railway 환경변수 변경: HISTORY_COLLECTION_DAYS=1")
        print("2. 내일부터 스케줄러가 자동으로 1일치만 수집")

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
