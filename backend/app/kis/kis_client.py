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

    def _load_cached_token(self) -> bool:
        """DB에서 캐시된 토큰 로드"""
        try:
            from app.database import SessionLocal
            from app.models import ApiTokenCache

            db = SessionLocal()
            try:
                cache_key = self._get_cache_key()
                logger.info(f"Loading KIS token from DB (cache_key: {cache_key})")

                cached = db.query(ApiTokenCache).filter(
                    ApiTokenCache.provider == 'kis',
                    ApiTokenCache.cache_key == cache_key
                ).first()

                if not cached:
                    logger.info("No cached token in DB, will issue new one")
                    return False

                # 만료 5분 전까지만 유효하게 처리
                time_until_expiry = cached.expired_at - datetime.now()
                logger.info(f"Token expires at {cached.expired_at}, time until expiry: {time_until_expiry}")

                if datetime.now() >= (cached.expired_at - timedelta(minutes=5)):
                    logger.info("Cached token is expired or expiring soon, will issue new one")
                    return False

                self.access_token = cached.access_token
                self.token_expired_at = cached.expired_at

                logger.info(f"SUCCESS: Loaded cached KIS token from DB (expires at {self.token_expired_at})")
                return True

            finally:
                db.close()

        except Exception as e:
            logger.warning(f"Failed to load cached token from DB: {str(e)}")
            return False

    def _save_token_cache(self) -> None:
        """토큰을 DB에 캐시"""
        try:
            from app.database import SessionLocal
            from app.models import ApiTokenCache

            db = SessionLocal()
            try:
                cache_key = self._get_cache_key()
                logger.info(f"Saving KIS token to DB (cache_key: {cache_key})")

                # 기존 캐시 확인
                cached = db.query(ApiTokenCache).filter(
                    ApiTokenCache.provider == 'kis',
                    ApiTokenCache.cache_key == cache_key
                ).first()

                if cached:
                    # 업데이트
                    cached.access_token = self.access_token
                    cached.expired_at = self.token_expired_at
                    cached.updated_at = datetime.now()
                else:
                    # 새로 생성
                    cached = ApiTokenCache(
                        provider='kis',
                        cache_key=cache_key,
                        access_token=self.access_token,
                        expired_at=self.token_expired_at
                    )
                    db.add(cached)

                db.commit()
                logger.info(f"SUCCESS: Saved KIS token to DB (expires at {self.token_expired_at})")

            finally:
                db.close()

        except Exception as e:
            logger.error(f"Failed to save token to DB: {str(e)}")

    def _ensure_token(self) -> None:
        """토큰이 유효한지 확인하고, 필요 시 갱신"""
        if self.access_token is None or self._is_token_expired():
            self._issue_token()

    def _is_token_expired(self) -> bool:
        """토큰 만료 여부 확인"""
        if self.token_expired_at is None:
            return True
        # 만료 5분 전에 미리 갱신
        return datetime.now() >= (self.token_expired_at - timedelta(minutes=5))

    def _issue_token(self) -> None:
        """접근 토큰 발급"""
        # 모의투자: tokenP, 실전투자: token
        endpoint = "/oauth2/tokenP" if self.is_mock else "/oauth2/token"
        url = f"{self.base_url}{endpoint}"

        headers = {
            "content-type": "application/json"
        }

        data = {
            "grant_type": "client_credentials",
            "appkey": self.app_key,
            "appsecret": self.app_secret
        }

        try:
            response = self.client.post(url, headers=headers, json=data)
            response.raise_for_status()

            result = response.json()
            self.access_token = result["access_token"]

            # 토큰 만료 시간 설정 (24시간)
            expires_in = int(result.get("expires_in", 86400))  # 기본 24시간
            self.token_expired_at = datetime.now() + timedelta(seconds=expires_in)

            logger.info(f"KIS API token issued successfully (expires at {self.token_expired_at})")

            # 토큰 캐시 저장
            self._save_token_cache()

        except Exception as e:
            logger.error(f"Failed to issue KIS API token: {str(e)}")
            raise

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
        period: str = "D"
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

        # TR_ID
        tr_id = "HHDFS76240000"

        params = {
            "AUTH": "",
            "EXCD": exchange,
            "SYMB": symbol,
            "GUBN": period,  # 0: 일, 1: 주, 2: 월
            "BYMD": "",  # 조회 기준일 (YYYYMMDD, 공백: 당일)
            "MODP": "0"  # 0: 수정주가 미반영, 1: 수정주가 반영
        }

        headers = self._get_headers(tr_id)

        try:
            response = self.client.get(url, headers=headers, params=params)
            response.raise_for_status()

            result = response.json()

            if result.get("rt_cd") == "0":
                output = result.get("output2", [])
                logger.info(f"Fetched {len(output)} OHLCV records for {symbol} ({exchange})")
                return output
            else:
                logger.error(f"Failed to get US stock OHLCV: {result.get('msg1')}")
                return []

        except Exception as e:
            logger.error(f"Error getting US stock OHLCV for {symbol}: {str(e)}")
            return []

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
