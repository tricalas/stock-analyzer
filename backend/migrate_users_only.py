"""
사용자와 태그 할당만 마이그레이션
(태그는 이미 Railway에서 생성됨)
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
    exit(1)

if POSTGRES_URL.startswith("postgres://"):
    POSTGRES_URL = POSTGRES_URL.replace("postgres://", "postgresql://", 1)

print("🔄 사용자 데이터 마이그레이션 시작...\n")

sqlite_conn = sqlite3.connect(SQLITE_DB)
sqlite_cursor = sqlite_conn.cursor()
pg_engine = create_engine(POSTGRES_URL)

def migrate_users():
    """사용자 마이그레이션"""
    print("📋 사용자 마이그레이션...")

    sqlite_cursor.execute("""
        SELECT id, user_token, nickname, pin_hash, created_at, last_login, is_admin
        FROM users
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  사용자 데이터 없음\n")
        return

    print(f"   📊 {len(rows)}명 발견")

    with pg_engine.connect() as conn:
        migrated = 0
        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO users (id, user_token, nickname, pin_hash, created_at, last_login, is_admin)
                    VALUES (:id, :user_token, :nickname, :pin_hash, :created_at, :last_login, :is_admin)
                    ON CONFLICT (user_token) DO UPDATE SET
                        nickname = EXCLUDED.nickname,
                        pin_hash = EXCLUDED.pin_hash,
                        is_admin = EXCLUDED.is_admin
                """), {
                    "id": row[0],
                    "user_token": row[1],
                    "nickname": row[2],
                    "pin_hash": row[3],
                    "created_at": row[4],
                    "last_login": row[5],
                    "is_admin": bool(row[6])
                })
                migrated += 1
            except Exception as e:
                print(f"   ❌ 오류: {e}")

        conn.commit()
        print(f"   ✅ {migrated}명 완료\n")

def migrate_stocks():
    """주식 마이그레이션 (tag assignments에 필요)"""
    print("📋 주식 데이터 마이그레이션...")

    # stock_tag_assignments에서 참조하는 stock만 마이그레이션
    sqlite_cursor.execute("""
        SELECT DISTINCT s.id, s.symbol, s.name, s.market
        FROM stocks s
        INNER JOIN stock_tag_assignments sta ON s.id = sta.stock_id
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  주식 데이터 없음\n")
        return

    print(f"   📊 {len(rows)}개 발견")

    with pg_engine.connect() as conn:
        migrated = 0
        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO stocks (id, symbol, name, market)
                    VALUES (:id, :symbol, :name, :market)
                    ON CONFLICT (symbol) DO UPDATE SET
                        name = EXCLUDED.name,
                        market = EXCLUDED.market
                """), {
                    "id": row[0],
                    "symbol": row[1],
                    "name": row[2],
                    "market": row[3]
                })
                migrated += 1
            except Exception as e:
                print(f"   ❌ 오류: {e}")

        conn.commit()
        print(f"   ✅ {migrated}개 완료\n")

def migrate_tag_assignments():
    """태그 할당 마이그레이션"""
    print("📋 태그 할당 마이그레이션...")

    sqlite_cursor.execute("""
        SELECT id, stock_id, tag_id, created_at, user_token
        FROM stock_tag_assignments
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  태그 할당 데이터 없음\n")
        return

    print(f"   📊 {len(rows)}개 발견")

    with pg_engine.connect() as conn:
        migrated = 0
        skipped = 0

        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO stock_tag_assignments (id, stock_id, tag_id, created_at, user_token)
                    VALUES (:id, :stock_id, :tag_id, :created_at, :user_token)
                    ON CONFLICT (stock_id, tag_id, user_token) DO NOTHING
                """), {
                    "id": row[0],
                    "stock_id": row[1],
                    "tag_id": row[2],
                    "created_at": row[3],
                    "user_token": row[4]
                })
                migrated += 1
            except Exception as e:
                skipped += 1
                # 외래키 제약 위반 등은 무시

        conn.commit()
        print(f"   ✅ {migrated}개 완료 (건너뜀: {skipped})\n")

def verify_data():
    """데이터 확인"""
    print("="*60)
    print("📊 PostgreSQL 데이터 확인")
    print("="*60)

    with pg_engine.connect() as conn:
        tables = ["users", "stock_tags", "stocks", "stock_tag_assignments"]
        for table in tables:
            try:
                result = conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
                count = result.scalar()
                print(f"   {table}: {count}개")
            except Exception as e:
                print(f"   {table}: 오류")

if __name__ == "__main__":
    try:
        migrate_users()
        migrate_stocks()
        migrate_tag_assignments()
        verify_data()

        print("\n✅ 마이그레이션 완료!")
        print("\n다음 단계:")
        print("1. tricalas.com에 접속")
        print("2. SUPER_PIN(999999)으로 로그인")
        print("3. 데이터 확인")

    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
    finally:
        sqlite_conn.close()
