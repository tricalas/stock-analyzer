import requests
from typing import Dict, List, Optional
from datetime import datetime
import logging
import time
from app.crawlers.base_crawler import BaseCrawler
from app.utils.smart_crawler import smart_crawler

logger = logging.getLogger(__name__)

class NaverUSStockCrawler(BaseCrawler):
    """네이버 미국 주식 API 크롤러"""

    def __init__(self):
        super().__init__()
        self.api_base_url = "https://api.stock.naver.com"

    def _parse_number(self, value) -> float:
        """숫자 파싱 (콤마 제거 및 null 처리)"""
        if value is None or value == "" or value == "N/A":
            return 0.0

        if isinstance(value, (int, float)):
            return float(value)

        # 문자열인 경우 콤마 제거
        try:
            clean_value = str(value).replace(',', '')
            return float(clean_value)
        except (ValueError, AttributeError):
            return 0.0

    def _parse_market_value(self, market_value_str: str) -> float:
        """
        시가총액 파싱
        예: "4,492,098,000" -> 4492098000.0 (백만 USD)
        네이버는 이미 천 단위로 제공하므로 그대로 사용
        """
        return self._parse_number(market_value_str)

    def fetch_us_stocks(self, exchange: str = "NASDAQ", max_pages: int = 10) -> List[Dict]:
        """
        미국 주식 정보 크롤링

        Args:
            exchange: "NASDAQ" 또는 "NYSE"
            max_pages: 크롤링할 최대 페이지 수

        Returns:
            주식 정보 리스트
        """
        stocks = []
        page = 1
        page_size = 50

        while page <= max_pages:
            url = f"{self.api_base_url}/stock/exchange/{exchange}/marketValue?page={page}&pageSize={page_size}"

            try:
                logger.info(f"Crawling {exchange} page {page}/{max_pages}")

                # API 요청
                response = smart_crawler.safe_request(url)

                if not response:
                    logger.warning(f"Failed to get response for {exchange} page {page}")
                    break

                # JSON 파싱
                data = response.json()

                if not data or "stocks" not in data:
                    logger.warning(f"No stocks data in response for {exchange} page {page}")
                    break

                stocks_data = data["stocks"]

                if not stocks_data:
                    logger.info(f"No more stocks on {exchange} page {page}")
                    break

                # 각 주식 정보 파싱
                for stock_data in stocks_data:
                    try:
                        stock_info = self._parse_stock_data(stock_data, exchange)
                        if stock_info:
                            stocks.append(stock_info)
                    except Exception as e:
                        logger.error(f"Error parsing stock data: {e}")
                        continue

                logger.info(f"Fetched {len(stocks_data)} stocks from {exchange} page {page}")

                # 페이지네이션 체크
                total_count = data.get("totalCount", 0)
                if page * page_size >= total_count:
                    logger.info(f"Reached end of {exchange} stocks (total: {total_count})")
                    break

                page += 1
                time.sleep(0.5)  # API 부하 방지

            except Exception as e:
                logger.error(f"Error fetching {exchange} page {page}: {e}")
                break

        logger.info(f"Total {len(stocks)} stocks fetched from {exchange}")
        return stocks

    def _parse_stock_data(self, stock_data: Dict, exchange: str) -> Optional[Dict]:
        """
        네이버 API 응답 데이터를 내부 포맷으로 변환
        """
        try:
            symbol = stock_data.get("symbolCode", "")
            reuters_code = stock_data.get("reutersCode", symbol)
            if not symbol:
                return None

            # 가격 정보
            close_price = self._parse_number(stock_data.get("closePrice", 0))
            open_price = self._parse_number(stock_data.get("openPrice", 0))
            high_price = self._parse_number(stock_data.get("highPrice", 0))
            low_price = self._parse_number(stock_data.get("lowPrice", 0))

            # 전일대비
            compare_price = self._parse_number(stock_data.get("compareToPreviousClosePrice", 0))
            fluctuation_ratio = self._parse_number(stock_data.get("fluctuationsRatio", 0))

            # 거래량 및 거래대금
            volume = self._parse_number(stock_data.get("accumulatedTradingVolume", 0))

            # 시가총액 (천 USD 단위)
            market_value = self._parse_market_value(stock_data.get("marketValue", 0))

            # 배당금
            dividend = self._parse_number(stock_data.get("dividend", 0))

            # 이름
            stock_name_kor = stock_data.get("stockName", "")
            stock_name_eng = stock_data.get("stockNameEng", "")

            # 거래소 정보
            exchange_info = stock_data.get("stockExchangeType", {})
            exchange_name = exchange_info.get("name", exchange)

            # 산업 정보
            industry_info = stock_data.get("industryCodeType", {})
            industry = industry_info.get("industryGroupKor", "")

            stock_info = {
                "symbol": symbol,
                "name": stock_name_kor or stock_name_eng,
                "market": "US",
                "exchange": exchange_name,
                "sector": reuters_code,  # 로이터 코드를 sector 필드에 저장
                "current_price": close_price,
                "previous_close": close_price - compare_price if close_price else 0,
                "change_amount": compare_price,
                "change_percent": fluctuation_ratio,
                "trading_volume": volume,
                "market_cap": market_value,  # 천 USD 단위
                "industry": industry,
                "updated_at": datetime.now()
            }

            return stock_info

        except Exception as e:
            logger.error(f"Error parsing stock {stock_data.get('symbolCode', 'unknown')}: {e}")
            return None

    def fetch_all_us_stocks(self, nasdaq_pages: int = 10, nyse_pages: int = 10) -> List[Dict]:
        """
        NASDAQ과 NYSE 주식을 모두 크롤링

        Args:
            nasdaq_pages: NASDAQ에서 가져올 페이지 수
            nyse_pages: NYSE에서 가져올 페이지 수

        Returns:
            전체 미국 주식 리스트
        """
        all_stocks = []

        # NASDAQ 크롤링
        logger.info("Fetching NASDAQ stocks...")
        nasdaq_stocks = self.fetch_us_stocks("NASDAQ", max_pages=nasdaq_pages)
        all_stocks.extend(nasdaq_stocks)

        # NYSE 크롤링
        logger.info("Fetching NYSE stocks...")
        nyse_stocks = self.fetch_us_stocks("NYSE", max_pages=nyse_pages)
        all_stocks.extend(nyse_stocks)

        logger.info(f"Total {len(all_stocks)} US stocks fetched")
        return all_stocks

    # BaseCrawler 추상 메서드 구현
    def fetch_stock_list(self) -> List[Dict]:
        """BaseCrawler 인터페이스 구현: 전체 주식 리스트 반환"""
        return self.fetch_all_us_stocks(nasdaq_pages=10, nyse_pages=10)

    def fetch_stock_info(self, symbol: str) -> Dict:
        """
        BaseCrawler 인터페이스 구현: 특정 주식 정보 반환
        (현재 미국 주식은 개별 조회를 지원하지 않으므로 빈 딕셔너리 반환)
        """
        logger.warning(f"Individual stock info fetch not supported for US stocks: {symbol}")
        return {}

    def analyze_single_stock(self, symbol: str) -> Dict:
        """
        단일 종목 분석: 네이버 모바일 페이지에서 상세 정보 및 일별 가격 크롤링

        Args:
            symbol: 종목 심볼 (예: NVDA.O, AAPL.O)

        Returns:
            분석 결과 딕셔너리 {
                'success': bool,
                'overview': Dict,  # 기본 정보
                'price_history': List[Dict],  # 일별 가격 데이터
                'message': str
            }
        """
        try:
            result = {
                'success': False,
                'overview': {},
                'price_history': [],
                'message': ''
            }

            # Overview 정보 크롤링
            overview_url = f"https://api.stock.naver.com/stock/{symbol}/basic"
            logger.info(f"Fetching overview for {symbol} from {overview_url}")

            overview_response = smart_crawler.safe_request(overview_url)
            if overview_response:
                overview_data = overview_response.json()
                result['overview'] = self._parse_overview_data(overview_data, symbol)
                logger.info(f"Successfully fetched overview for {symbol}")

            # 가격 히스토리 크롤링
            price_url = f"https://api.stock.naver.com/stock/{symbol}/price"
            logger.info(f"Fetching price history for {symbol} from {price_url}")

            price_response = smart_crawler.safe_request(price_url)
            if price_response:
                price_data_list = price_response.json()  # API returns list directly
                result['price_history'] = self._parse_price_history(price_data_list, symbol)
                logger.info(f"Successfully fetched {len(result['price_history'])} price records for {symbol}")

            if result['overview'] or result['price_history']:
                result['success'] = True
                result['message'] = f"Successfully analyzed {symbol}"
            else:
                result['message'] = f"No data found for {symbol}"

            return result

        except Exception as e:
            logger.error(f"Error analyzing stock {symbol}: {e}")
            return {
                'success': False,
                'overview': {},
                'price_history': [],
                'message': f"Error: {str(e)}"
            }

    def _parse_overview_data(self, data: Dict, symbol: str) -> Dict:
        """네이버 API overview 데이터 파싱"""
        try:
            if not data:
                return {}

            stock_name = data.get('stockName', '')
            stock_name_eng = data.get('stockNameEng', '')
            close_price = self._parse_number(data.get('closePrice', 0))
            compare_price = self._parse_number(data.get('compareToPreviousClosePrice', 0))
            fluctuation_ratio = self._parse_number(data.get('fluctuationsRatio', 0))

            overview = {
                'symbol': symbol,
                'name': stock_name or stock_name_eng,
                'name_eng': stock_name_eng,
                'current_price': close_price,
                'change_amount': compare_price,
                'change_percent': fluctuation_ratio,
                'previous_close': close_price - compare_price if close_price else 0,
                'market_cap': self._parse_number(data.get('marketValue', 0)),
                'volume': self._parse_number(data.get('accumulatedTradingVolume', 0)),
                'market': 'US',
                'exchange': data.get('stockExchangeType', {}).get('name', ''),
                'industry': data.get('industryCodeType', {}).get('industryGroupKor', ''),
            }

            return overview

        except Exception as e:
            logger.error(f"Error parsing overview data for {symbol}: {e}")
            return {}

    def _parse_price_history(self, data: List[Dict], symbol: str) -> List[Dict]:
        """네이버 API price 데이터 파싱"""
        try:
            if not data or not isinstance(data, list):
                return []

            price_list = []
            for item in data:
                try:
                    # localTradedAt: "2026-01-21T16:00:00-05:00" -> "20260121"
                    date_str = item.get('localTradedAt', '')
                    if not date_str:
                        continue

                    # Parse ISO date and convert to YYYYMMDD format
                    from datetime import datetime
                    date_obj = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    date_formatted = date_obj.strftime('%Y%m%d')

                    price_record = {
                        'date': date_formatted,
                        'open_price': int(self._parse_number(item.get('openPrice', 0))),
                        'high_price': int(self._parse_number(item.get('highPrice', 0))),
                        'low_price': int(self._parse_number(item.get('lowPrice', 0))),
                        'close_price': int(self._parse_number(item.get('closePrice', 0))),
                        'volume': 0,  # Volume not available in this API endpoint
                    }
                    price_list.append(price_record)
                except Exception as e:
                    logger.error(f"Error parsing price record: {e}")
                    continue

            return price_list

        except Exception as e:
            logger.error(f"Error parsing price history for {symbol}: {e}")
            return []
