"""
최종 SQLite → PostgreSQL 마이그레이션 스크립트
실제 데이터베이스 스키마에 맞춰 작성됨
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

print(f"🔄 SQLite → PostgreSQL 마이그레이션 시작...")
print(f"📁 SQLite: {SQLITE_DB}")
print(f"🐘 PostgreSQL: {POSTGRES_URL[:50]}...\n")

# 연결
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
        print("   ⚠️  데이터 없음\n")
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

def migrate_tags():
    """태그 마이그레이션"""
    print("📋 태그 마이그레이션...")

    sqlite_cursor.execute("""
        SELECT id, name, display_name, color, icon, "order", is_active, created_at, updated_at, user_token
        FROM stock_tags
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  데이터 없음\n")
        return

    print(f"   📊 {len(rows)}개 발견")

    with pg_engine.connect() as conn:
        migrated = 0
        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO stock_tags (id, name, display_name, color, icon, "order", is_active, created_at, updated_at, user_token)
                    VALUES (:id, :name, :display_name, :color, :icon, :order, :is_active, :created_at, :updated_at, :user_token)
                    ON CONFLICT (name) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        color = EXCLUDED.color,
                        icon = EXCLUDED.icon,
                        user_token = EXCLUDED.user_token
                """), {
                    "id": row[0],
                    "name": row[1],
                    "display_name": row[2],
                    "color": row[3],
                    "icon": row[4],
                    "order": row[5],
                    "is_active": bool(row[6]) if row[6] is not None else True,
                    "created_at": row[7],
                    "updated_at": row[8],
                    "user_token": row[9]
                })
                migrated += 1
            except Exception as e:
                print(f"   ❌ 오류: {e}")

        conn.commit()
        print(f"   ✅ {migrated}개 완료\n")

def migrate_stocks():
    """주식 데이터 마이그레이션 (stock_tag_assignments에 필요)"""
    print("📋 주식 데이터 마이그레이션...")

    # stock_tag_assignments에서 참조하는 stock_id 찾기
    sqlite_cursor.execute("""
        SELECT DISTINCT s.id, s.code, s.market, s.name
        FROM stocks s
        INNER JOIN stock_tag_assignments sta ON s.id = sta.stock_id
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  데이터 없음\n")
        return

    print(f"   📊 {len(rows)}개 발견")

    with pg_engine.connect() as conn:
        migrated = 0
        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO stocks (id, code, market, name)
                    VALUES (:id, :code, :market, :name)
                    ON CONFLICT (code, market) DO UPDATE SET
                        name = EXCLUDED.name
                """), {
                    "id": row[0],
                    "code": row[1],
                    "market": row[2],
                    "name": row[3]
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
        print("   ⚠️  데이터 없음\n")
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
                print(f"   {table}: 오류 - {e}")

if __name__ == "__main__":
    try:
        migrate_users()
        migrate_tags()
        migrate_stocks()
        migrate_tag_assignments()
        verify_data()

        print("\n✅ 마이그레이션 완료!")

    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
    finally:
        sqlite_conn.close()
