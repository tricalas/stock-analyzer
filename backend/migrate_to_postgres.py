"""
SQLite에서 PostgreSQL로 데이터를 마이그레이션하는 스크립트

사용법:
1. Railway에서 PostgreSQL 데이터베이스 생성
2. DATABASE_URL 환경 변수 설정 (PostgreSQL URL)
3. python migrate_to_postgres.py 실행
"""

import sqlite3
import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

# 환경 변수 로드
load_dotenv()

# SQLite 데이터베이스 경로
SQLITE_DB = "stock_analyzer.db"

# PostgreSQL URL (Railway 환경 변수에서 가져옴)
POSTGRES_URL = os.getenv("DATABASE_URL")

if not POSTGRES_URL:
    print("❌ DATABASE_URL 환경 변수가 설정되지 않았습니다.")
    print("Railway PostgreSQL의 DATABASE_URL을 .env 파일에 추가해주세요.")
    exit(1)

# PostgreSQL URL이 postgres://로 시작하면 postgresql://로 변경 (SQLAlchemy 호환)
if POSTGRES_URL.startswith("postgres://"):
    POSTGRES_URL = POSTGRES_URL.replace("postgres://", "postgresql://", 1)

print(f"🔄 SQLite → PostgreSQL 마이그레이션 시작...")
print(f"📁 SQLite: {SQLITE_DB}")
print(f"🐘 PostgreSQL: {POSTGRES_URL[:30]}...")

# SQLite 연결
sqlite_conn = sqlite3.connect(SQLITE_DB)
sqlite_conn.row_factory = sqlite3.Row
sqlite_cursor = sqlite_conn.cursor()

# PostgreSQL 연결
pg_engine = create_engine(POSTGRES_URL)
Session = sessionmaker(bind=pg_engine)
pg_session = Session()

def migrate_table(table_name, columns):
    """테이블 데이터를 마이그레이션"""
    print(f"\n📋 {table_name} 마이그레이션 중...")

    # SQLite에서 데이터 읽기
    sqlite_cursor.execute(f"SELECT * FROM {table_name}")
    rows = sqlite_cursor.fetchall()

    if not rows:
        print(f"   ⚠️  {table_name} 테이블이 비어있습니다.")
        return

    print(f"   📊 {len(rows)}개의 레코드 발견")

    # PostgreSQL에 데이터 삽입
    migrated = 0
    skipped = 0

    for row in rows:
        try:
            # 컬럼 값 추출
            values = []
            placeholders = []
            for i, col in enumerate(columns):
                values.append(row[i])
                placeholders.append(f":{col}")

            # INSERT 쿼리 생성
            cols_str = ", ".join(columns)
            placeholders_str = ", ".join(placeholders)

            # ON CONFLICT를 사용하여 중복 방지 (id가 primary key인 경우)
            if 'id' in columns:
                query = text(f"""
                    INSERT INTO {table_name} ({cols_str})
                    VALUES ({placeholders_str})
                    ON CONFLICT (id) DO NOTHING
                """)
            else:
                query = text(f"""
                    INSERT INTO {table_name} ({cols_str})
                    VALUES ({placeholders_str})
                """)

            # 값을 딕셔너리로 변환
            params = {col: values[i] for i, col in enumerate(columns)}

            pg_session.execute(query, params)
            migrated += 1

        except Exception as e:
            print(f"   ⚠️  레코드 건너뜀: {e}")
            skipped += 1

    try:
        pg_session.commit()
        print(f"   ✅ {migrated}개 마이그레이션 완료 (건너뜀: {skipped})")
    except Exception as e:
        pg_session.rollback()
        print(f"   ❌ 커밋 실패: {e}")

def main():
    print("\n🚀 마이그레이션 시작\n")

    # 테이블 및 컬럼 정의 (현재 사용 중인 테이블만)
    tables = {
        "users": ["id", "nickname", "pin_hash", "is_admin", "user_token", "created_at"],
        "stock_tags": ["id", "name", "color", "user_id", "created_at"],
        "stock_tag_assignments": ["id", "stock_code", "market", "tag_id", "user_id", "created_at"],
    }

    # 각 테이블 마이그레이션
    for table_name, columns in tables.items():
        migrate_table(table_name, columns)

    # 연결 종료
    sqlite_conn.close()
    pg_session.close()

    print("\n" + "="*60)
    print("✅ 마이그레이션 완료!")
    print("="*60)

    # 마이그레이션 후 데이터 확인
    print("\n📊 PostgreSQL 데이터 확인:")
    for table_name in tables.keys():
        result = pg_session.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
        count = result.scalar()
        print(f"   {table_name}: {count}개")

if __name__ == "__main__":
    main()
