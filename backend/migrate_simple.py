"""
간단한 SQLite → PostgreSQL 마이그레이션 스크립트
컬럼 이름을 명시적으로 지정하여 데이터를 복사합니다
"""

import sqlite3
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# 환경 변수 로드
load_dotenv()

SQLITE_DB = "stock_analyzer.db"
POSTGRES_URL = os.getenv("DATABASE_URL")

if not POSTGRES_URL:
    print("❌ DATABASE_URL 환경 변수가 설정되지 않았습니다.")
    exit(1)

if POSTGRES_URL.startswith("postgres://"):
    POSTGRES_URL = POSTGRES_URL.replace("postgres://", "postgresql://", 1)

print(f"🔄 SQLite → PostgreSQL 마이그레이션 시작...")

# SQLite 연결
sqlite_conn = sqlite3.connect(SQLITE_DB)
sqlite_cursor = sqlite_conn.cursor()

# PostgreSQL 연결
pg_engine = create_engine(POSTGRES_URL)

def migrate_users():
    """사용자 데이터 마이그레이션"""
    print("\n📋 사용자 마이그레이션 중...")

    # SQLite에서 데이터 읽기
    sqlite_cursor.execute("""
        SELECT id, user_token, nickname, pin_hash, created_at, last_login, is_admin
        FROM users
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  사용자 데이터가 없습니다.")
        return

    print(f"   📊 {len(rows)}명의 사용자 발견")

    # PostgreSQL에 삽입
    with pg_engine.connect() as conn:
        migrated = 0
        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO users (id, user_token, nickname, pin_hash, created_at, last_login, is_admin)
                    VALUES (:id, :user_token, :nickname, :pin_hash, :created_at, :last_login, :is_admin)
                    ON CONFLICT (id) DO NOTHING
                """), {
                    "id": row[0],
                    "user_token": row[1],
                    "nickname": row[2],
                    "pin_hash": row[3],
                    "created_at": row[4],
                    "last_login": row[5],
                    "is_admin": row[6]
                })
                migrated += 1
            except Exception as e:
                print(f"   ⚠️  사용자 건너뜀: {e}")

        conn.commit()
        print(f"   ✅ {migrated}명 마이그레이션 완료")

def migrate_tags():
    """태그 데이터 마이그레이션"""
    print("\n📋 태그 마이그레이션 중...")

    # SQLite에서 데이터 읽기
    sqlite_cursor.execute("""
        SELECT id, user_id, name, color, icon
        FROM stock_tags
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  태그 데이터가 없습니다.")
        return

    print(f"   📊 {len(rows)}개의 태그 발견")

    # PostgreSQL에 삽입
    with pg_engine.connect() as conn:
        migrated = 0
        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO stock_tags (id, user_id, name, color, icon)
                    VALUES (:id, :user_id, :name, :color, :icon)
                    ON CONFLICT (id) DO NOTHING
                """), {
                    "id": row[0],
                    "user_id": row[1],
                    "name": row[2],
                    "color": row[3],
                    "icon": row[4]
                })
                migrated += 1
            except Exception as e:
                print(f"   ⚠️  태그 건너뜀: {e}")

        conn.commit()
        print(f"   ✅ {migrated}개 마이그레이션 완료")

def migrate_tag_assignments():
    """태그 할당 데이터 마이그레이션"""
    print("\n📋 태그 할당 마이그레이션 중...")

    # SQLite에서 데이터 읽기
    sqlite_cursor.execute("""
        SELECT id, stock_code, market, tag_id, user_id, created_at
        FROM stock_tag_assignments
    """)
    rows = sqlite_cursor.fetchall()

    if not rows:
        print("   ⚠️  태그 할당 데이터가 없습니다.")
        return

    print(f"   📊 {len(rows)}개의 할당 발견")

    # PostgreSQL에 삽입
    with pg_engine.connect() as conn:
        migrated = 0
        for row in rows:
            try:
                conn.execute(text("""
                    INSERT INTO stock_tag_assignments (id, stock_code, market, tag_id, user_id, created_at)
                    VALUES (:id, :stock_code, :market, :tag_id, :user_id, :created_at)
                    ON CONFLICT (id) DO NOTHING
                """), {
                    "id": row[0],
                    "stock_code": row[1],
                    "market": row[2],
                    "tag_id": row[3],
                    "user_id": row[4],
                    "created_at": row[5]
                })
                migrated += 1
            except Exception as e:
                print(f"   ⚠️  할당 건너뜀: {e}")

        conn.commit()
        print(f"   ✅ {migrated}개 마이그레이션 완료")

def verify_data():
    """마이그레이션 후 데이터 확인"""
    print("\n" + "="*60)
    print("📊 PostgreSQL 데이터 확인:")
    print("="*60)

    with pg_engine.connect() as conn:
        for table in ["users", "stock_tags", "stock_tag_assignments"]:
            result = conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = result.scalar()
            print(f"   {table}: {count}개")

if __name__ == "__main__":
    try:
        migrate_users()
        migrate_tags()
        migrate_tag_assignments()
        verify_data()

        print("\n✅ 마이그레이션 완료!")

    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
    finally:
        sqlite_conn.close()
