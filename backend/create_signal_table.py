#!/usr/bin/env python3
"""
StockSignal 테이블 생성 스크립트
"""
import sys
import os

# 프로젝트 루트를 Python path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import engine, Base
from app.models import StockSignal
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_signal_table():
    """StockSignal 테이블 생성"""
    try:
        logger.info("Creating StockSignal table...")

        # 테이블 생성
        Base.metadata.create_all(bind=engine, tables=[StockSignal.__table__])

        logger.info("✅ StockSignal table created successfully!")

        # 테이블 확인
        from sqlalchemy import inspect
        inspector = inspect(engine)
        if 'stock_signals' in inspector.get_table_names():
            logger.info("✅ Table 'stock_signals' verified in database")

            # 컬럼 확인
            columns = inspector.get_columns('stock_signals')
            logger.info(f"📊 Columns: {[col['name'] for col in columns]}")

            # 인덱스 확인
            indexes = inspector.get_indexes('stock_signals')
            logger.info(f"🔍 Indexes: {[idx['name'] for idx in indexes]}")
        else:
            logger.error("❌ Table 'stock_signals' not found!")

    except Exception as e:
        logger.error(f"❌ Error creating table: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    create_signal_table()
