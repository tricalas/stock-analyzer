#!/usr/bin/env python3
"""
KIS API 인증 테스트 스크립트
"""
import sys
import os

# 프로젝트 루트를 Python path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.kis.kis_client import KISClient
from app.config import settings
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_kis_auth():
    """KIS API 인증 테스트"""

    print("=" * 60)
    print("KIS API 인증 테스트")
    print("=" * 60)

    # 현재 설정 출력
    print(f"\n현재 설정:")
    print(f"  KIS_IS_MOCK: {settings.KIS_IS_MOCK}")
    print(f"  KIS_APP_KEY: {settings.KIS_APP_KEY[:10]}...")
    print(f"  KIS_APP_SECRET: {settings.KIS_APP_SECRET[:10]}...")

    # 1. 실전투자 모드로 테스트
    print(f"\n[테스트 1] 실전투자 모드 (KIS_IS_MOCK=False)")
    print("-" * 60)
    try:
        client_real = KISClient(
            app_key=settings.KIS_APP_KEY,
            app_secret=settings.KIS_APP_SECRET,
            account_number=settings.KIS_ACCOUNT_NUMBER,
            account_code=settings.KIS_ACCOUNT_CODE,
            is_mock=False
        )
        print(f"Base URL: {client_real.base_url}")
        client_real._issue_token()
        print(f"✅ 실전투자 토큰 발급 성공!")
        print(f"   Access Token: {client_real.access_token[:30]}...")
        print(f"   만료 시간: {client_real.token_expired_at}")
    except Exception as e:
        print(f"❌ 실전투자 토큰 발급 실패: {str(e)}")
        import traceback
        traceback.print_exc()

    # 2. 모의투자 모드로 테스트
    print(f"\n[테스트 2] 모의투자 모드 (KIS_IS_MOCK=True)")
    print("-" * 60)
    try:
        client_mock = KISClient(
            app_key=settings.KIS_APP_KEY,
            app_secret=settings.KIS_APP_SECRET,
            account_number=settings.KIS_ACCOUNT_NUMBER,
            account_code=settings.KIS_ACCOUNT_CODE,
            is_mock=True
        )
        print(f"Base URL: {client_mock.base_url}")
        client_mock._issue_token()
        print(f"✅ 모의투자 토큰 발급 성공!")
        print(f"   Access Token: {client_mock.access_token[:30]}...")
        print(f"   만료 시간: {client_mock.token_expired_at}")

        # 모의투자가 성공하면 US 주식 데이터도 테스트
        print(f"\n[추가 테스트] 모의투자로 US 주식 데이터 조회")
        print("-" * 60)
        data = client_mock.get_us_stock_ohlcv("AAPL", "NAS", "D")
        if data:
            print(f"✅ AAPL 데이터 조회 성공! ({len(data)}건)")
            if len(data) > 0:
                print(f"   최신 데이터: {data[0]}")
        else:
            print(f"❌ AAPL 데이터 조회 실패")

    except Exception as e:
        print(f"❌ 모의투자 토큰 발급 실패: {str(e)}")
        import traceback
        traceback.print_exc()

    print("\n" + "=" * 60)

if __name__ == "__main__":
    test_kis_auth()
