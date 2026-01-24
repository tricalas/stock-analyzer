"""
성능 최적화를 위한 데이터베이스 인덱스 추가
"""

import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # .env에 DATABASE_URL이 없으면 기본값 사용
    DATABASE_URL = "sqlite:///stock_analyzer.db"
    print("⚠️  DATABASE_URL not found, using SQLite")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

print(f"🔗 Connecting to database...")
engine = create_engine(DATABASE_URL)

# 추가할 인덱스 목록
indexes = [
    # Stocks 테이블 기본 인덱스
    ("idx_stocks_market", "CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market)"),
    ("idx_stocks_exchange", "CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks(exchange)"),
    ("idx_stocks_sector", "CREATE INDEX IF NOT EXISTS idx_stocks_sector ON stocks(sector)"),
    ("idx_stocks_is_active", "CREATE INDEX IF NOT EXISTS idx_stocks_is_active ON stocks(is_active)"),

    # 정렬 최적화
    ("idx_stocks_market_cap", "CREATE INDEX IF NOT EXISTS idx_stocks_market_cap ON stocks(market_cap DESC NULLS LAST)"),

    # 복합 인덱스 (필터링 + 정렬)
    ("idx_stocks_active_market_cap",
     "CREATE INDEX IF NOT EXISTS idx_stocks_active_market_cap ON stocks(is_active, market, market_cap DESC NULLS LAST, id)"),

    ("idx_stocks_active_exchange_cap",
     "CREATE INDEX IF NOT EXISTS idx_stocks_active_exchange_cap ON stocks(is_active, exchange, market_cap DESC NULLS LAST)"),

    ("idx_stocks_active_sector_cap",
     "CREATE INDEX IF NOT EXISTS idx_stocks_active_sector_cap ON stocks(is_active, sector, market_cap DESC NULLS LAST)"),

    # Stock Tag Assignments 최적화
    ("idx_sta_stock_tag_user",
     "CREATE INDEX IF NOT EXISTS idx_sta_stock_tag_user ON stock_tag_assignments(stock_id, tag_id, user_token)"),

    ("idx_sta_user_tag",
     "CREATE INDEX IF NOT EXISTS idx_sta_user_tag ON stock_tag_assignments(user_token, tag_id)"),

    ("idx_sta_tag_user_stock",
     "CREATE INDEX IF NOT EXISTS idx_sta_tag_user_stock ON stock_tag_assignments(tag_id, user_token, stock_id)"),

    # Stock Price History 최적화
    ("idx_sph_stock_date",
     "CREATE INDEX IF NOT EXISTS idx_sph_stock_date ON stock_price_history(stock_id, date DESC)"),
]

print(f"\n📊 Adding {len(indexes)} indexes...\n")

with engine.connect() as conn:
    created_count = 0
    skipped_count = 0

    for idx_name, idx_sql in indexes:
        try:
            print(f"⏳ Creating {idx_name}...")
            conn.execute(text(idx_sql))
            conn.commit()
            print(f"   ✅ Created {idx_name}")
            created_count += 1
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate" in str(e).lower():
                print(f"   ⚪ Skipped {idx_name} (already exists)")
                skipped_count += 1
            else:
                print(f"   ❌ Error creating {idx_name}: {e}")

    # VACUUM ANALYZE (PostgreSQL만)
    if "postgresql" in DATABASE_URL:
        print(f"\n🔧 Running VACUUM ANALYZE...")
        try:
            conn.execute(text("VACUUM ANALYZE stocks"))
            conn.execute(text("VACUUM ANALYZE stock_tag_assignments"))
            conn.execute(text("VACUUM ANALYZE stock_price_history"))
            print(f"   ✅ VACUUM ANALYZE completed")
        except Exception as e:
            print(f"   ⚠️  VACUUM ANALYZE failed: {e}")

print(f"\n" + "="*60)
print(f"📊 Index Creation Summary")
print(f"="*60)
print(f"   ✅ Created: {created_count}")
print(f"   ⚪ Skipped (already exists): {skipped_count}")
print(f"   Total: {len(indexes)}")
print(f"\n✅ Done!")
