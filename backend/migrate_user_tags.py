"""
SQLite '신신' 유저의 태그 데이터를 PostgreSQL 'shin' 유저로 마이그레이션
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

# SQLite와 PostgreSQL 유저 토큰
SQLITE_USER_TOKEN = "60d25367-ace2-40da-b251-83e97df5030a"  # 신신
POSTGRES_USER_TOKEN = "9267ba3d-2729-4c1b-89ba-bbab093dbb88"  # shin

print(f"🔄 '신신' 유저 태그 데이터 마이그레이션 시작...")
print(f"   SQLite: {SQLITE_USER_TOKEN} (신신)")
print(f"   PostgreSQL: {POSTGRES_USER_TOKEN} (shin)\n")

# 연결
sqlite_conn = sqlite3.connect(SQLITE_DB)
sqlite_cursor = sqlite_conn.cursor()
pg_engine = create_engine(POSTGRES_URL)

def migrate_tag_assignments():
    """태그 할당 마이그레이션"""
    print("📋 태그 할당 마이그레이션...")

    # SQLite에서 '신신' 유저의 태그 할당 읽기
    sqlite_cursor.execute("""
        SELECT id, stock_id, tag_id, created_at, user_token
        FROM stock_tag_assignments
        WHERE user_token = ?
    """, (SQLITE_USER_TOKEN,))
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
                # PostgreSQL에 shin 유저 토큰으로 삽입 (id는 자동 생성)
                result = conn.execute(text("""
                    INSERT INTO stock_tag_assignments (stock_id, tag_id, created_at, user_token)
                    VALUES (:stock_id, :tag_id, :created_at, :user_token)
                    ON CONFLICT (stock_id, tag_id, user_token) DO NOTHING
                    RETURNING id
                """), {
                    "stock_id": row[1],
                    "tag_id": row[2],
                    "created_at": row[3],
                    "user_token": POSTGRES_USER_TOKEN  # shin 유저 토큰 사용
                })

                # 실제로 삽입되었는지 확인
                if result.rowcount > 0:
                    migrated += 1

                    if migrated % 20 == 0:
                        print(f"   ⏳ {migrated}개 처리 중...")

            except Exception as e:
                print(f"   ⚠️ 건너뜀")
                skipped += 1
                conn.rollback()  # 트랜잭션 롤백

        conn.commit()
        print(f"   ✅ {migrated}개 완료 (건너뜀: {skipped})\n")

def verify_data():
    """데이터 확인"""
    print("="*60)
    print("📊 PostgreSQL 데이터 확인")
    print("="*60)

    with pg_engine.connect() as conn:
        result = conn.execute(text("""
            SELECT COUNT(*)
            FROM stock_tag_assignments
            WHERE user_token = :user_token
        """), {"user_token": POSTGRES_USER_TOKEN})
        count = result.scalar()
        print(f"   shin 유저 태그 할당: {count}개")

        # 태그별 통계
        result = conn.execute(text("""
            SELECT st.name, st.display_name, COUNT(*)
            FROM stock_tag_assignments sta
            JOIN stock_tags st ON sta.tag_id = st.id
            WHERE sta.user_token = :user_token
            GROUP BY st.name, st.display_name
            ORDER BY COUNT(*) DESC
        """), {"user_token": POSTGRES_USER_TOKEN})

        print("\n   📊 태그별 통계:")
        for row in result:
            print(f"      {row[1]} ({row[0]}): {row[2]}개")

if __name__ == "__main__":
    try:
        migrate_tag_assignments()
        verify_data()

        print("\n✅ 마이그레이션 완료!")
        print("\n💡 다음 단계:")
        print("   1. https://tricalas.com 에서 shin 유저로 로그인")
        print("   2. 태그가 정상적으로 표시되는지 확인")

    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
    finally:
        sqlite_conn.close()
