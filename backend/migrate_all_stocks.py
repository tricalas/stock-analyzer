"""
모든 주식 데이터를 SQLite → PostgreSQL로 마이그레이션
"""

import sqlite3
import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

SQLITE_DB = "stock_analyzer.db"
POSTGRES_URL = os.getenv("DATABASE_URL")

if not POSTGRES_URL:
    print("❌ DATABASE_URL 환경 변수가 설정되지 않았습니다.")
    print("   .env 파일에 Railway PostgreSQL URL을 추가하세요:")
    print("   DATABASE_URL=postgresql://postgres:...@...railway.app:5432/railway")
    exit(1)

if POSTGRES_URL.startswith("postgres://"):
    POSTGRES_URL = POSTGRES_URL.replace("postgres://", "postgresql://", 1)

print(f"🔄 모든 주식 데이터 마이그레이션 시작...")
print(f"📁 SQLite: {SQLITE_DB}")
print(f"🐘 PostgreSQL: {POSTGRES_URL[:50]}...\n")

# 연결
sqlite_conn = sqlite3.connect(SQLITE_DB)
sqlite_cursor = sqlite_conn.cursor()
pg_engine = create_engine(POSTGRES_URL)

def migrate_all_stocks():
    """모든 주식 마이그레이션"""
    print("📋 주식 마이그레이션...")

    # SQLite에서 모든 주식 읽기
    sqlite_cursor.execute("""
        SELECT
            id, symbol, name, market, exchange, sector, industry,
            current_price, previous_close, change_amount, change_percent,
            face_value, market_cap, shares_outstanding, foreign_ratio, trading_volume,
            per, roe, market_cap_rank, is_active, created_at, updated_at, ma90_price
        FROM stocks
        ORDER BY id
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  데이터 없음\n")
        return

    print(f"   📊 {len(rows)}개 발견")

    # PostgreSQL에 삽입
    with pg_engine.connect() as conn:
        migrated = 0
        updated = 0
        skipped = 0

        for row in rows:
            try:
                # UPSERT (INSERT ... ON CONFLICT UPDATE)
                result = conn.execute(text("""
                    INSERT INTO stocks (
                        id, symbol, name, market, exchange, sector, industry,
                        current_price, previous_close, change_amount, change_percent,
                        face_value, market_cap, shares_outstanding, foreign_ratio, trading_volume,
                        per, roe, market_cap_rank, is_active, created_at, updated_at, ma90_price
                    )
                    VALUES (
                        :id, :symbol, :name, :market, :exchange, :sector, :industry,
                        :current_price, :previous_close, :change_amount, :change_percent,
                        :face_value, :market_cap, :shares_outstanding, :foreign_ratio, :trading_volume,
                        :per, :roe, :market_cap_rank, :is_active, :created_at, :updated_at, :ma90_price
                    )
                    ON CONFLICT (symbol) DO UPDATE SET
                        name = EXCLUDED.name,
                        market = EXCLUDED.market,
                        exchange = EXCLUDED.exchange,
                        sector = EXCLUDED.sector,
                        industry = EXCLUDED.industry,
                        current_price = EXCLUDED.current_price,
                        previous_close = EXCLUDED.previous_close,
                        change_amount = EXCLUDED.change_amount,
                        change_percent = EXCLUDED.change_percent,
                        face_value = EXCLUDED.face_value,
                        market_cap = EXCLUDED.market_cap,
                        shares_outstanding = EXCLUDED.shares_outstanding,
                        foreign_ratio = EXCLUDED.foreign_ratio,
                        trading_volume = EXCLUDED.trading_volume,
                        per = EXCLUDED.per,
                        roe = EXCLUDED.roe,
                        market_cap_rank = EXCLUDED.market_cap_rank,
                        is_active = EXCLUDED.is_active,
                        updated_at = EXCLUDED.updated_at,
                        ma90_price = EXCLUDED.ma90_price
                """), {
                    "id": row[0],
                    "symbol": row[1],
                    "name": row[2],
                    "market": row[3],
                    "exchange": row[4],
                    "sector": row[5],
                    "industry": row[6],
                    "current_price": row[7],
                    "previous_close": row[8],
                    "change_amount": row[9],
                    "change_percent": row[10],
                    "face_value": row[11],
                    "market_cap": row[12],
                    "shares_outstanding": row[13],
                    "foreign_ratio": row[14],
                    "trading_volume": row[15],
                    "per": row[16],
                    "roe": row[17],
                    "market_cap_rank": row[18],
                    "is_active": bool(row[19]) if row[19] is not None else True,
                    "created_at": row[20],
                    "updated_at": row[21],
                    "ma90_price": row[22]
                })
                migrated += 1

                # 진행 상황 표시
                if migrated % 100 == 0:
                    print(f"   ⏳ {migrated}개 처리 중...")

            except Exception as e:
                print(f"   ❌ 오류 ({row[1]}): {e}")
                skipped += 1

        conn.commit()
        print(f"   ✅ {migrated}개 완료 (건너뜀: {skipped})\n")

def verify_data():
    """데이터 확인"""
    print("="*60)
    print("📊 PostgreSQL 데이터 확인")
    print("="*60)

    with pg_engine.connect() as conn:
        # 전체 개수
        result = conn.execute(text("SELECT COUNT(*) FROM stocks"))
        total = result.scalar()
        print(f"   전체 주식: {total}개")

        # 시장별 개수
        result = conn.execute(text("""
            SELECT market, COUNT(*)
            FROM stocks
            GROUP BY market
            ORDER BY market
        """))
        print("\n   📊 시장별:")
        for row in result:
            print(f"      {row[0]}: {row[1]}개")

        # is_active 상태별
        result = conn.execute(text("""
            SELECT is_active, COUNT(*)
            FROM stocks
            GROUP BY is_active
        """))
        print("\n   📊 상태별:")
        for row in result:
            status = "활성" if row[0] else "비활성"
            print(f"      {status}: {row[1]}개")

if __name__ == "__main__":
    try:
        migrate_all_stocks()
        verify_data()

        print("\n✅ 마이그레이션 완료!")
        print("\n💡 다음 단계:")
        print("   1. Railway 대시보드에서 백엔드 서비스 확인")
        print("   2. API 테스트: https://victorious-determination-production-dafc.up.railway.app/api/stocks?market=US&limit=5")
        print("   3. 프론트엔드에서 주식 목록 확인")

    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
    finally:
        sqlite_conn.close()
