"""
새로운 사용자를 추가하는 스크립트
"""

import os
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from app.auth import get_pin_hash
import uuid

load_dotenv()

POSTGRES_URL = os.getenv("DATABASE_URL")

if not POSTGRES_URL:
    print("❌ DATABASE_URL 환경 변수가 설정되지 않았습니다.")
    exit(1)

if POSTGRES_URL.startswith("postgres://"):
    POSTGRES_URL = POSTGRES_URL.replace("postgres://", "postgresql://", 1)

# PostgreSQL 연결
pg_engine = create_engine(POSTGRES_URL)

def add_user(nickname: str, pin: str, is_admin: bool = False):
    """새로운 사용자 추가"""

    print(f"\n👤 사용자 추가 중...")
    print(f"   닉네임: {nickname}")
    print(f"   PIN: {'*' * len(pin)}")
    print(f"   관리자: {is_admin}")

    # PIN 해시화
    pin_hash = get_pin_hash(pin)
    user_token = str(uuid.uuid4())

    with pg_engine.connect() as conn:
        try:
            # 중복 확인
            result = conn.execute(text("""
                SELECT COUNT(*) FROM users WHERE nickname = :nickname
            """), {"nickname": nickname})

            if result.scalar() > 0:
                print(f"\n⚠️  '{nickname}' 닉네임이 이미 존재합니다.")

                # 업데이트할지 물어보기
                response = input("   PIN과 정보를 업데이트하시겠습니까? (y/n): ")
                if response.lower() != 'y':
                    print("   ❌ 취소되었습니다.")
                    return

                # 업데이트
                conn.execute(text("""
                    UPDATE users
                    SET pin_hash = :pin_hash, is_admin = :is_admin
                    WHERE nickname = :nickname
                """), {
                    "pin_hash": pin_hash,
                    "is_admin": is_admin,
                    "nickname": nickname
                })
                conn.commit()
                print(f"\n   ✅ 사용자 '{nickname}' 정보가 업데이트되었습니다!")
            else:
                # 새로 추가
                conn.execute(text("""
                    INSERT INTO users (user_token, nickname, pin_hash, is_admin, created_at)
                    VALUES (:user_token, :nickname, :pin_hash, :is_admin, NOW())
                """), {
                    "user_token": user_token,
                    "nickname": nickname,
                    "pin_hash": pin_hash,
                    "is_admin": is_admin
                })
                conn.commit()
                print(f"\n   ✅ 사용자 '{nickname}'가 추가되었습니다!")
                print(f"   🔑 User Token: {user_token}")

        except Exception as e:
            print(f"\n   ❌ 오류: {e}")
            import traceback
            traceback.print_exc()

def list_users():
    """모든 사용자 목록 표시"""
    print("\n📋 현재 사용자 목록:")
    print("="*60)

    with pg_engine.connect() as conn:
        result = conn.execute(text("""
            SELECT nickname, is_admin, created_at
            FROM users
            ORDER BY created_at
        """))

        users = result.fetchall()
        if not users:
            print("   (사용자 없음)")
        else:
            for idx, user in enumerate(users, 1):
                admin_badge = " [관리자]" if user[1] else ""
                print(f"   {idx}. {user[0]}{admin_badge} (생성일: {user[2]})")

if __name__ == "__main__":
    # 명령행 인자로 닉네임/PIN 받기
    if len(sys.argv) >= 2:
        user_input = sys.argv[1]
        if '/' in user_input:
            nickname, pin = user_input.split('/', 1)
            is_admin = len(sys.argv) >= 3 and sys.argv[2] == '--admin'
            add_user(nickname, pin, is_admin)
        else:
            print("❌ 형식: python add_user.py nickname/pin [--admin]")
            print("   예시: python add_user.py moon/131313")
    else:
        print("❌ 형식: python add_user.py nickname/pin [--admin]")
        print("   예시: python add_user.py moon/131313")
        print("   예시: python add_user.py admin/999999 --admin")

    # 사용자 목록 표시
    list_users()
