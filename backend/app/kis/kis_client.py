"""
한국투자증권 Open API 클라이언트

참고: https://apiportal.koreainvestment.com/apiservice/
"""

import httpx
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime, date, timedelta
import hashlib
import json

logger = logging.getLogger(__name__)


class KISClient:
    """한국투자증권 Open API 클라이언트"""

    # API Base URLs
    REAL_BASE_URL = "https://openapi.koreainvestment.com:9443"  # 실전투자
    MOCK_BASE_URL = "https://openapivts.koreainvestment.com:29443"  # 모의투자

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        account_number: str = "",
        account_code: str = "",
        is_mock: bool = True
    ):
        """
        Args:
            app_key: 앱 키
            app_secret: 앱 시크릿
            account_number: 계좌번호 (8자리)
            account_code: 계좌상품코드 (2자리)
            is_mock: 모의투자 여부 (True: 모의투자, False: 실전투자)
        """
        self.app_key = app_key
        self.app_secret = app_secret
        self.account_number = account_number
        self.account_code = account_code
        self.is_mock = is_mock

        self.base_url = self.MOCK_BASE_URL if is_mock else self.REAL_BASE_URL
        self.access_token: Optional[str] = None
        self.token_expired_at: Optional[datetime] = None

        # HTTP 클라이언트
        self.client = httpx.Client(timeout=30.0)

        # 캐시된 토큰 로드 시도
        self._load_cached_token()

    def __del__(self):
        """클라이언트 종료 시 리소스 정리"""
        self.client.close()

    # ==================== 인증 ====================

    def _get_cache_key(self) -> str:
        """앱키 기반 캐시 키 생성 (여러 계정 구분용)"""
        return hashlib.md5(f"{self.app_key}:{self.is_mock}".encode()).hexdigest()[:8]

    def _load_cached_token(self, rejected_token=None) -> bool:
        from app.database import SessionLocal
        from app.models import ApiTokenCache
        try:
            with SessionLocal() as db:
                cached = db.query(ApiTokenCache).filter_by(provider='kis', cache_key=self._get_cache_key()).first()
                if not cached or cached.access_token == rejected_token:
                    return False
                if datetime.utcnow() >= cached.expired_at - timedelta(seconds=30):
                    return False
                self.access_token = cached.access_token
                self.token_expired_at = cached.expired_at
                return True
        except Exception:
            logger.warning('KIS shared token cache unavailable')
            return False

    def _save_token_cache(self) -> None:
        from app.database import SessionLocal
        from app.models import ApiTokenCache
        with SessionLocal() as db:
            cached = db.query(ApiTokenCache).filter_by(provider='kis', cache_key=self._get_cache_key()).first()
            if cached is None:
                cached = ApiTokenCache(provider='kis', cache_key=self._get_cache_key())
                db.add(cached)
            cached.access_token = self.access_token
            cached.expired_at = self.token_expired_at
            db.commit()

    def _ensure_token(self) -> None:
        if self.access_token is None or self._is_token_expired():
            self._issue_token()

    def _is_token_expired(self) -> bool:
        return self.token_expired_at is None or datetime.utcnow() >= self.token_expired_at - timedelta(seconds=30)

    def _issue_token(self, rejected_token=None) -> None:
        from app.kis.token_refresh import refresh_token
        refresh_token(self, rejected_token=rejected_token)

    def _request_new_token(self) -> None:
        from zoneinfo import ZoneInfo
        from datetime import timezone
        from app.kis.token_refresh import KISTokenRetry
        import re
        # Official KIS personal-client samples use tokenP for both real and paper servers.
        try:
            response = self.client.post(self.base_url + '/oauth2/tokenP',
                headers={'content-type':'application/json'},
                json={'grant_type':'client_credentials','appkey':self.app_key,'appsecret':self.app_secret})
        except httpx.RequestError:
            raise KISTokenRetry('KIS token refresh network failure; retry later') from None
        try:
            result = response.json()
        except ValueError:
            result = {}
        code = str(result.get('error_code') or result.get('msg_cd') or 'unknown')
        code = code if re.fullmatch(r'[A-Za-z0-9_]{1,40}', code) else 'unknown'
        if response.status_code != 200 or not isinstance(result.get('access_token'), str) or not result['access_token']:
            raise KISTokenRetry(f'KIS token refresh rejected (HTTP {response.status_code}, code {code}); retry later')
        try:
            expires = datetime.utcnow() + timedelta(seconds=min(int(result.get('expires_in',86400)),172800))
            if result.get('access_token_token_expired'):
                reported = datetime.fromisoformat(result['access_token_token_expired'])
                if reported.tzinfo is None:
                    reported = reported.replace(tzinfo=ZoneInfo('Asia/Seoul'))
                expires = min(expires, reported.astimezone(timezone.utc).replace(tzinfo=None))
            if expires <= datetime.utcnow() + timedelta(seconds=30):
                raise ValueError('expired response')
        except (ValueError,TypeError,OverflowError):
            raise KISTokenRetry('KIS token refresh returned invalid expiry; retry later') from None
        self.access_token = result['access_token']
        self.token_expired_at = expires
        logger.info('KIS shared token renewed; expires at %s UTC', expires)

    def _get_market_response(self, url, tr_id, params):
        """Retry a rejected bearer token once; do not turn auth failures into empty history."""
        from app.kis.token_refresh import KISTokenRetry
        headers = self._get_headers(tr_id)
        response = self.client.get(url, headers=headers, params=params)
        try:
            code = response.json().get('msg_cd')
        except ValueError:
            code = None
        if response.status_code == 401 or code in ('EGW00121','EGW00123'):
            rejected = self.access_token
            self.access_token = None
            self.token_expired_at = None
            self._issue_token(rejected_token=rejected)
            response = self.client.get(url, headers=self._get_headers(tr_id), params=params)
            try:
                code = response.json().get('msg_cd')
            except ValueError:
                code = None
            if response.status_code == 401 or code in ('EGW00121','EGW00123'):
                raise KISTokenRetry('KIS token rejected after refresh; retry later')
        return response

    def _get_headers(self, tr_id: str, tr_cont: str = "") -> Dict[str, str]:
        """공통 헤더 생성"""
        self._ensure_token()

        headers = {
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {self.access_token}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "tr_id": tr_id,
        }

        if tr_cont:
            headers["tr_cont"] = tr_cont

        return headers

    # ==================== 국내 주식 시세 ====================

    def get_kr_stock_price(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        국내 주식 현재가 시세 조회

        Args:
            symbol: 종목코드 (6자리, 예: "005930")

        Returns:
            시세 정보 딕셔너리
        """
        url = f"{self.base_url}/uapi/domestic-stock/v1/quotations/inquire-price"

        # TR_ID: 실전투자=FHKST01010100, 모의투자=FHKST01010100 (동일)
        tr_id = "FHKST01010100"

        params = {
            "FID_COND_MRKT_DIV_CODE": "J",  # 시장 구분 (J: 주식)
            "FID_INPUT_ISCD": symbol
        }

        headers = self._get_headers(tr_id)

        try:
            response = self.client.get(url, headers=headers, params=params)
            response.raise_for_status()

            result = response.json()

            if result.get("rt_cd") == "0":  # 성공
                return result.get("output")
            else:
                logger.error(f"Failed to get KR stock price: {result.get('msg1')}")
                return None

        except Exception as e:
            logger.error(f"Error getting KR stock price for {symbol}: {str(e)}")
            return None

    def get_kr_stock_ohlcv(
        self,
        symbol: str,
        start_date: str = "",
        end_date: str = "",
        period: str = "D"
    ) -> List[Dict[str, Any]]:
        """
        국내 주식 기간별 시세 조회 (일/주/월)

        Args:
            symbol: 종목코드 (6자리)
            start_date: 조회 시작일 (YYYYMMDD, 빈 문자열이면 오늘부터 100일)
            end_date: 조회 종료일 (YYYYMMDD, 빈 문자열이면 오늘)
            period: D(일), W(주), M(월)

        Returns:
            OHLCV 데이터 리스트
        """
        url = f"{self.base_url}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"

        # 날짜 기본값 설정
        if not end_date:
            end_date = datetime.now().strftime("%Y%m%d")
        if not start_date:
            start_date = (datetime.now() - timedelta(days=100)).strftime("%Y%m%d")

        # TR_ID
        tr_id = "FHKST03010100"

        params = {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": symbol,
            "FID_INPUT_DATE_1": start_date,
            "FID_INPUT_DATE_2": end_date,
            "FID_PERIOD_DIV_CODE": period,  # D: 일, W: 주, M: 월
            "FID_ORG_ADJ_PRC": "0"  # 0: 수정주가 반영 안함, 1: 수정주가 반영
        }

        headers = self._get_headers(tr_id)

        try:
            response = self.client.get(url, headers=headers, params=params)
            response.raise_for_status()

            result = response.json()

            if result.get("rt_cd") == "0":
                output = result.get("output2", [])
                logger.info(f"Fetched {len(output)} OHLCV records for {symbol}")
                return output
            else:
                logger.error(f"Failed to get KR stock OHLCV: {result.get('msg1')}")
                return []

        except Exception as e:
            logger.error(f"Error getting KR stock OHLCV for {symbol}: {str(e)}")
            return []

    # ==================== 해외 주식 시세 ====================

    def get_us_stock_price(self, symbol: str, exchange: str = "NAS") -> Optional[Dict[str, Any]]:
        """
        해외 주식 현재가 조회

        Args:
            symbol: 종목코드 (예: "AAPL")
            exchange: 거래소 코드 (NAS: 나스닥, NYS: 뉴욕, AMS: 아멕스)

        Returns:
            시세 정보 딕셔너리
        """
        url = f"{self.base_url}/uapi/overseas-price/v1/quotations/price"

        # TR_ID
        tr_id = "HHDFS00000300"

        params = {
            "AUTH": "",
            "EXCD": exchange,  # 거래소 코드
            "SYMB": symbol  # 종목코드
        }

        headers = self._get_headers(tr_id)

        try:
            response = self.client.get(url, headers=headers, params=params)
            response.raise_for_status()

            result = response.json()

            if result.get("rt_cd") == "0":
                return result.get("output")
            else:
                logger.error(f"Failed to get US stock price: {result.get('msg1')}")
                return None

        except Exception as e:
            logger.error(f"Error getting US stock price for {symbol}: {str(e)}")
            return None

    def get_us_stock_ohlcv(
        self,
        symbol: str,
        exchange: str = "NAS",
        period: str = "D",
        end_date: str = "",
        adjusted: bool = False
    ) -> List[Dict[str, Any]]:
        """
        해외 주식 기간별 시세 조회

        Args:
            symbol: 종목코드 (예: "AAPL")
            exchange: 거래소 코드 (NAS, NYS, AMS 등)
            period: D(일), W(주), M(월)

        Returns:
            OHLCV 데이터 리스트
        """
        url = f"{self.base_url}/uapi/overseas-price/v1/quotations/dailyprice"

        # KIS uses a slash for US share classes (BRK.B / BRK B -> BRK/B).
        import re
        symbol = re.sub(r"^([A-Z0-9]+)[ .]PR?[ .]?([A-Z])$", r"\1/\2", symbol.strip().upper())
        symbol = re.sub(r"^([A-Z0-9]+)[ .]([A-Z])$", r"\1/\2", symbol)

        # TR_ID
        tr_id = "HHDFS76240000"

        params = {
            "AUTH": "",
            "EXCD": exchange,
            "SYMB": symbol,
            "GUBN": {"D": "0", "W": "1", "M": "2"}.get(period, period),  # 0: 일, 1: 주, 2: 월
            "BYMD": end_date,  # 조회 기준일 (YYYYMMDD, 공백: 당일)
            "MODP": "1" if adjusted else "0"  # Keep raw and adjusted requests explicit
        }

        try:
            response = self._get_market_response(url, tr_id, params)
            response.raise_for_status()

            result = response.json()

            if result.get("rt_cd") == "0":
                output = result.get("output2", [])
                logger.info(f"Fetched {len(output)} OHLCV records for {symbol} ({exchange})")
                return output
            else:
                raise RuntimeError(f"KIS history request failed: {result.get('msg1')}")

        except Exception as e:
            logger.error(f"Error getting US stock OHLCV for {symbol}: {str(e)}")
            raise

    # ==================== 주문 (추후 구현) ====================

    def order_kr_stock(
        self,
        symbol: str,
        quantity: int,
        price: int,
        order_type: str = "buy"
    ) -> Optional[Dict[str, Any]]:
        """
        국내 주식 주문 (추후 Phase 6에서 구현)

        Args:
            symbol: 종목코드
            quantity: 수량
            price: 가격 (0: 시장가)
            order_type: buy(매수) or sell(매도)
        """
        # TODO: Phase 6에서 구현
        logger.warning("Order functionality not implemented yet")
        return None

    def order_us_stock(
        self,
        symbol: str,
        exchange: str,
        quantity: int,
        price: float,
        order_type: str = "buy"
    ) -> Optional[Dict[str, Any]]:
        """
        해외 주식 주문 (추후 Phase 6에서 구현)

        Args:
            symbol: 종목코드
            exchange: 거래소 코드
            quantity: 수량
            price: 가격 (0: 시장가)
            order_type: buy(매수) or sell(매도)
        """
        # TODO: Phase 6에서 구현
        logger.warning("Order functionality not implemented yet")
        return None


# 전역 클라이언트 인스턴스 (환경변수로부터 초기화)
_kis_client: Optional[KISClient] = None


def get_kis_client() -> Optional[KISClient]:
    """전역 KIS 클라이언트 인스턴스 가져오기"""
    global _kis_client

    if _kis_client is None:
        from app.config import settings

        # API 키가 설정되어 있는지 확인
        if not settings.KIS_APP_KEY or not settings.KIS_APP_SECRET:
            logger.warning("KIS API keys not configured")
            return None

        _kis_client = KISClient(
            app_key=settings.KIS_APP_KEY,
            app_secret=settings.KIS_APP_SECRET,
            account_number=settings.KIS_ACCOUNT_NUMBER,
            account_code=settings.KIS_ACCOUNT_CODE,
            is_mock=settings.KIS_IS_MOCK
        )

    return _kis_client
