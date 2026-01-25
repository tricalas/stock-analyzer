#!/usr/bin/env python3
"""
HistoryCollectionLog 테이블 생성 스크립트
"""
import sys
import os

# 프로젝트 루트를 Python path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import engine, Base
from app.models import HistoryCollectionLog
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_history_log_table():
    """HistoryCollectionLog 테이블 생성"""
    try:
        logger.info("Creating HistoryCollectionLog table...")

        # 테이블 생성
        Base.metadata.create_all(bind=engine, tables=[HistoryCollectionLog.__table__])

        logger.info("✅ HistoryCollectionLog table created successfully!")

        # 테이블 확인
        from sqlalchemy import inspect
        inspector = inspect(engine)
        if 'history_collection_logs' in inspector.get_table_names():
            logger.info("✅ Table 'history_collection_logs' verified in database")

            # 컬럼 확인
            columns = inspector.get_columns('history_collection_logs')
            logger.info(f"📊 Columns: {[col['name'] for col in columns]}")

            # 인덱스 확인
            indexes = inspector.get_indexes('history_collection_logs')
            logger.info(f"🔍 Indexes: {[idx['name'] for idx in indexes]}")
        else:
            logger.error("❌ Table 'history_collection_logs' not found!")

    except Exception as e:
        logger.error(f"❌ Error creating table: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    create_history_log_table()
