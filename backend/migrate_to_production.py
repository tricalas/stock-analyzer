"""
로컬 SQLite DB 데이터를 프로덕션으로 마이그레이션하는 스크립트
"""
import sqlite3
import requests
import json
from datetime import datetime

# 로컬 DB 파일
LOCAL_DB = "stock_analyzer.db"

# 프로덕션 API URL
PROD_API = "https://victorious-determination-production-9f97.up.railway.app"

# SUPER_PIN으로 임시 관리자 로그인
SUPER_PIN = "999999"
NICKNAME = "admin"

def get_auth_token():
    """SUPER_PIN으로 로그인하여 토큰 얻기"""
    response = requests.post(
        f"{PROD_API}/api/auth/login",
        json={"nickname": NICKNAME, "pin": SUPER_PIN}
    )
    if response.status_code == 200:
        data = response.json()
        print(f"✅ 로그인 성공: {data['user']['nickname']}")
        return data['access_token']
    else:
        print(f"❌ 로그인 실패: {response.text}")
        return None

def migrate_users(conn, headers):
    """사용자 데이터 마이그레이션"""
    cursor = conn.cursor()
    cursor.execute("SELECT nickname, pin_hash, is_admin, user_token FROM users")
    users = cursor.fetchall()
    
    print(f"\n📤 사용자 {len(users)}명 마이그레이션 중...")
    
    for nickname, pin_hash, is_admin, user_token in users:
        # 프로덕션에 사용자 생성 API 호출
        response = requests.post(
            f"{PROD_API}/api/auth/users/create-direct",
            headers=headers,
            json={
                "nickname": nickname,
                "pin_hash": pin_hash,
                "is_admin": bool(is_admin),
                "user_token": user_token
            }
        )
        
        if response.status_code == 200:
            print(f"  ✅ {nickname}")
        else:
            print(f"  ❌ {nickname}: {response.text}")

def migrate_tags(conn, headers):
    """태그 데이터 마이그레이션"""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT name, display_name, color, icon, "order", is_active, user_token 
        FROM stock_tags
    """)
    tags = cursor.fetchall()
    
    print(f"\n📤 태그 {len(tags)}개 마이그레이션 중...")
    
    for name, display_name, color, icon, order, is_active, user_token in tags:
        response = requests.post(
            f"{PROD_API}/api/tags",
            headers=headers,
            json={
                "name": name,
                "display_name": display_name,
                "color": color,
                "icon": icon,
                "order": order or 0,
                "is_active": bool(is_active),
                "user_token": user_token
            }
        )
        
        if response.status_code in [200, 201]:
            print(f"  ✅ {display_name}")
        else:
            print(f"  ⚠️  {display_name}: {response.status_code}")

def main():
    print("=" * 60)
    print("로컬 DB → Railway 마이그레이션 시작")
    print("=" * 60)
    
    # 1. 프로덕션 로그인
    token = get_auth_token()
    if not token:
        print("\n❌ 로그인 실패. 종료합니다.")
        return
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. 로컬 DB 연결
    try:
        conn = sqlite3.connect(LOCAL_DB)
        print(f"✅ 로컬 DB 연결 성공: {LOCAL_DB}")
    except Exception as e:
        print(f"❌ 로컬 DB 연결 실패: {e}")
        return
    
    # 3. 데이터 마이그레이션
    try:
        migrate_users(conn, headers)
        migrate_tags(conn, headers)
        
        print("\n" + "=" * 60)
        print("✅ 마이그레이션 완료!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ 마이그레이션 중 오류: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()

if __name__ == "__main__":
    main()
