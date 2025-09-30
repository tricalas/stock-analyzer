import xml.etree.ElementTree as ET
from typing import List, Dict, Optional
from datetime import datetime, date
import logging
import re
from app.utils.smart_crawler import smart_crawler

logger = logging.getLogger(__name__)

class PriceHistoryCrawler:
    """네이버 차트 API를 사용한 가격 히스토리 크롤러"""

    def __init__(self):
        self.chart_url = "https://fchart.stock.naver.com/sise.nhn"

    def fetch_price_history(self, symbol: str, days: int = 100) -> List[Dict]:
        """
        특정 종목의 가격 히스토리 데이터 가져오기

        Args:
            symbol: 종목 코드 (예: "196170")
            days: 가져올 데이터 일수 (기본: 100일)

        Returns:
            가격 데이터 리스트 [{"date": "20250926", "open": 454000, ...}, ...]
        """
        url = f"{self.chart_url}?symbol={symbol}&timeframe=day&count={days}&requestType=0"

        try:
            logger.info(f"Fetching price history for {symbol} ({days} days)")
            response = smart_crawler.safe_request(url)

            if not response:
                logger.error(f"Failed to fetch price history for {symbol}")
                return []

            # XML 응답 파싱
            price_data = self._parse_chart_xml(response.text)
            logger.info(f"Successfully fetched {len(price_data)} price records for {symbol}")

            return price_data

        except Exception as e:
            logger.error(f"Error fetching price history for {symbol}: {str(e)}")
            return []

    def _parse_chart_xml(self, xml_content: str) -> List[Dict]:
        """
        네이버 차트 XML 데이터 파싱

        XML 형태: <item data="20250926|454000|458500|445000|447000|355170" />
        데이터 형태: 날짜|시가|고가|저가|종가|거래량
        """
        price_data = []

        try:
            # XML 파싱
            root = ET.fromstring(xml_content)

            # chartdata 요소 찾기
            chartdata = root.find('.//chartdata')
            if chartdata is None:
                logger.warning("No chartdata found in XML response")
                return []

            # item 요소들 처리
            items = chartdata.findall('item')
            logger.debug(f"Found {len(items)} price data items")

            for item in items:
                data_attr = item.get('data')
                if not data_attr:
                    continue

                # 데이터 파싱: 날짜|시가|고가|저가|종가|거래량
                parts = data_attr.split('|')
                if len(parts) != 6:
                    logger.warning(f"Invalid data format: {data_attr}")
                    continue

                try:
                    price_record = {
                        'date': self._parse_date(parts[0]),
                        'open_price': int(parts[1]) if parts[1] else 0,
                        'high_price': int(parts[2]) if parts[2] else 0,
                        'low_price': int(parts[3]) if parts[3] else 0,
                        'close_price': int(parts[4]) if parts[4] else 0,
                        'volume': int(parts[5]) if parts[5] else 0
                    }

                    # 데이터 검증
                    if self._validate_price_data(price_record):
                        price_data.append(price_record)
                    else:
                        logger.warning(f"Invalid price data: {price_record}")

                except (ValueError, IndexError) as e:
                    logger.warning(f"Error parsing price data {data_attr}: {str(e)}")
                    continue

            # 날짜순 정렬 (오래된 것부터)
            price_data.sort(key=lambda x: x['date'])

            return price_data

        except ET.ParseError as e:
            logger.error(f"XML parsing error: {str(e)}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error parsing chart XML: {str(e)}")
            return []

    def _parse_date(self, date_str: str) -> date:
        """
        날짜 문자열을 date 객체로 변환

        Args:
            date_str: "20250926" 형태의 날짜 문자열

        Returns:
            date 객체
        """
        try:
            return datetime.strptime(date_str, '%Y%m%d').date()
        except ValueError:
            logger.error(f"Invalid date format: {date_str}")
            return date.today()

    def _validate_price_data(self, data: Dict) -> bool:
        """
        가격 데이터 유효성 검증

        Args:
            data: 가격 데이터 딕셔너리

        Returns:
            유효하면 True, 아니면 False
        """
        try:
            # 필수 필드 확인
            required_fields = ['date', 'open_price', 'high_price', 'low_price', 'close_price', 'volume']
            for field in required_fields:
                if field not in data:
                    return False

            # 가격 데이터 논리적 검증
            open_price = data['open_price']
            high_price = data['high_price']
            low_price = data['low_price']
            close_price = data['close_price']
            volume = data['volume']

            # 음수 검증
            if any(price < 0 for price in [open_price, high_price, low_price, close_price, volume]):
                return False

            # 고가가 다른 가격들보다 높거나 같아야 함
            if high_price < max(open_price, low_price, close_price):
                return False

            # 저가가 다른 가격들보다 낮거나 같아야 함
            if low_price > min(open_price, high_price, close_price):
                return False

            # 극단적인 가격 변동 체크 (일일 변동 1000% 이상은 오류로 간주)
            if high_price > 0 and low_price > 0:
                daily_change_ratio = (high_price - low_price) / low_price
                if daily_change_ratio > 10:  # 1000% 변동
                    return False

            return True

        except Exception as e:
            logger.error(f"Error validating price data: {str(e)}")
            return False

    def batch_fetch_price_histories(self, symbols: List[str], days: int = 30) -> Dict[str, List[Dict]]:
        """
        여러 종목의 가격 히스토리를 배치로 가져오기

        Args:
            symbols: 종목 코드 리스트
            days: 가져올 데이터 일수

        Returns:
            {symbol: price_data_list} 형태의 딕셔너리
        """
        results = {}

        logger.info(f"Batch fetching price histories for {len(symbols)} symbols")

        # 스마트 크롤러의 배치 처리 사용
        urls = [f"{self.chart_url}?symbol={symbol}&timeframe=day&count={days}&requestType=0"
                for symbol in symbols]

        responses = smart_crawler.batch_crawl(urls, batch_size=3)  # 작은 배치 사이즈로 안전하게

        for i, (symbol, response) in enumerate(zip(symbols, responses)):
            if response:
                try:
                    price_data = self._parse_chart_xml(response.text)
                    results[symbol] = price_data
                    logger.info(f"Fetched {len(price_data)} records for {symbol}")
                except Exception as e:
                    logger.error(f"Error processing {symbol}: {str(e)}")
                    results[symbol] = []
            else:
                logger.warning(f"No response for {symbol}")
                results[symbol] = []

        return results

# 전역 인스턴스
price_history_crawler = PriceHistoryCrawler()