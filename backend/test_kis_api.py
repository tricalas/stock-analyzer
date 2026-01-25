"""
한국투자증권 API 연결 테스트 스크립트
"""

import sys
import os

# app 모듈을 import하기 위해 경로 추가
sys.path.insert(0, os.path.dirname(__file__))

from app.kis.kis_client import get_kis_client

def test_kis_connection():
    """KIS API 연결 테스트"""
    print("=" * 60)
    print("한국투자증권 API 연결 테스트")
    print("=" * 60)

    # KIS 클라이언트 가져오기
    client = get_kis_client()

    if client is None:
        print("❌ KIS API 클라이언트 초기화 실패")
        print("   .env 파일에 API 키가 설정되어 있는지 확인하세요.")
        return False

    print(f"✅ KIS API 클라이언트 초기화 성공")
    print(f"   - 모의투자 여부: {client.is_mock}")
    print(f"   - Base URL: {client.base_url}")
    print()

    # 토큰 발급 테스트
    print("토큰 발급 테스트...")
    try:
        client._issue_token()
        print(f"✅ 토큰 발급 성공")
        print(f"   - Access Token: {client.access_token[:20]}...")
        print(f"   - 만료 시간: {client.token_expired_at}")
        print()
    except Exception as e:
        print(f"❌ 토큰 발급 실패: {str(e)}")
        return False

    # 국내 주식 시세 조회 테스트
    print("국내 주식 시세 조회 테스트 (삼성전자: 005930)...")
    try:
        price_data = client.get_kr_stock_price("005930")
        if price_data:
            print(f"✅ 국내 주식 시세 조회 성공")
            print(f"   - 종목명: {price_data.get('prdt_name', 'N/A')}")
            print(f"   - 현재가: {price_data.get('stck_prpr', 'N/A')}원")
            print(f"   - 전일대비: {price_data.get('prdy_vrss', 'N/A')}원 ({price_data.get('prdy_ctrt', 'N/A')}%)")
            print()
        else:
            print(f"⚠️  국내 주식 시세 조회 실패 (응답 없음)")
            print()
    except Exception as e:
        print(f"❌ 국내 주식 시세 조회 실패: {str(e)}")
        print()

    # 미국 주식 시세 조회 테스트
    print("미국 주식 시세 조회 테스트 (Apple: AAPL)...")
    try:
        us_price_data = client.get_us_stock_price("AAPL", "NAS")
        if us_price_data:
            print(f"✅ 미국 주식 시세 조회 성공")
            print(f"   - 현재가: ${us_price_data.get('last', 'N/A')}")
            print(f"   - 전일대비: ${us_price_data.get('diff', 'N/A')} ({us_price_data.get('rate', 'N/A')}%)")
            print()
        else:
            print(f"⚠️  미국 주식 시세 조회 실패 (응답 없음)")
            print()
    except Exception as e:
        print(f"❌ 미국 주식 시세 조회 실패: {str(e)}")
        print()

    # 국내 주식 히스토리 조회 테스트
    print("국내 주식 히스토리 조회 테스트 (삼성전자, 최근 10일)...")
    try:
        from datetime import datetime, timedelta
        end_date = datetime.now().strftime("%Y%m%d")
        start_date = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d")

        history_data = client.get_kr_stock_ohlcv("005930", start_date, end_date, "D")
        if history_data:
            print(f"✅ 국내 주식 히스토리 조회 성공")
            print(f"   - 조회된 데이터: {len(history_data)}일")
            if len(history_data) > 0:
                latest = history_data[0]
                print(f"   - 최근 일자: {latest.get('stck_bsop_date', 'N/A')}")
                print(f"   - 종가: {latest.get('stck_clpr', 'N/A')}원")
            print()
        else:
            print(f"⚠️  국내 주식 히스토리 조회 실패 (응답 없음)")
            print()
    except Exception as e:
        print(f"❌ 국내 주식 히스토리 조회 실패: {str(e)}")
        print()

    print("=" * 60)
    print("테스트 완료!")
    print("=" * 60)

    return True

if __name__ == "__main__":
    test_kis_connection()
