import requests
from bs4 import BeautifulSoup
from typing import Dict, List, Optional
from datetime import datetime, date, timedelta
import logging
import time
import re
from app.crawlers.base_crawler import BaseCrawler
from app.utils.smart_crawler import smart_crawler

logger = logging.getLogger(__name__)

class NaverStockCrawler(BaseCrawler):
    def __init__(self):
        super().__init__()
        self.base_url = "https://finance.naver.com"

    def _parse_number(self, text: str) -> float:
        """문자열에서 숫자 추출 (콤마 제거 등)"""
        if not text or text == 'N/A' or text == '-':
            return 0.0

        # 콤마 제거하고 숫자만 추출
        clean_text = re.sub(r'[^\d.-]', '', text)
        try:
            return float(clean_text)
        except ValueError:
            return 0.0

    def _parse_change_info(self, text: str) -> tuple:
        """전일비 정보 파싱 (상승/하락 금액과 퍼센트)"""
        if not text:
            return 0.0, 0.0

        # 상승/하락 여부 확인
        is_decline = '하락' in text

        # 숫자 추출
        numbers = re.findall(r'[0-9,]+', text)
        if len(numbers) >= 1:
            try:
                amount = float(numbers[0].replace(',', ''))
                if is_decline:
                    amount = -amount
                return amount, 0.0  # 퍼센트는 별도 컬럼에서 처리
            except ValueError:
                pass

        return 0.0, 0.0

    def _parse_percent(self, text: str) -> float:
        """퍼센트 문자열 파싱"""
        if not text:
            return 0.0

        # % 제거하고 숫자 추출
        clean_text = text.replace('%', '').replace(',', '')
        try:
            return float(clean_text)
        except ValueError:
            return 0.0

    def fetch_market_cap_stocks(self, sosok: int = 0, pages: int = 1) -> List[Dict]:
        """
        네이버 시가총액 페이지에서 주식 정보 크롤링
        sosok: 0=코스피, 1=코스닥
        pages: 크롤링할 페이지 수
        """
        stocks = []

        for page in range(1, pages + 1):
            url = f"{self.base_url}/sise/sise_market_sum.naver?sosok={sosok}&page={page}"

            try:
                logger.info(f"Crawling page {page}/{pages} for sosok={sosok}")
                response = smart_crawler.safe_request(url)

                if not response:
                    logger.warning(f"Failed to get response for page {page}")
                    continue

                soup = BeautifulSoup(response.content, 'html.parser')

                # 시가총액 테이블 찾기
                table = soup.select_one('table.type_2')
                if not table:
                    logger.warning(f"No table found on page {page}")
                    continue

                rows = table.select('tr')

                for row in rows:
                    cells = row.select('td')
                    if len(cells) < 12:  # 충분한 컬럼이 없으면 스킵
                        continue

                    try:
                        # 종목명 링크에서 종목코드 추출
                        stock_link = cells[1].select_one('a')
                        if not stock_link or not stock_link.get('href'):
                            continue

                        href = stock_link.get('href')
                        if 'code=' not in href:
                            continue

                        stock_code = href.split('code=')[1].split('&')[0]

                        # 각 컬럼 데이터 추출
                        rank_text = cells[0].get_text(strip=True)
                        stock_name = cells[1].get_text(strip=True)
                        current_price = self._parse_number(cells[2].get_text(strip=True))
                        change_text = cells[3].get_text(strip=True)
                        change_percent_text = cells[4].get_text(strip=True)
                        face_value = self._parse_number(cells[5].get_text(strip=True))
                        market_cap = self._parse_number(cells[6].get_text(strip=True))
                        shares_outstanding = self._parse_number(cells[7].get_text(strip=True))
                        foreign_ratio = self._parse_number(cells[8].get_text(strip=True))
                        trading_volume = self._parse_number(cells[9].get_text(strip=True))
                        per = self._parse_number(cells[10].get_text(strip=True))
                        roe = self._parse_number(cells[11].get_text(strip=True))

                        # 전일비 정보 파싱
                        change_amount, _ = self._parse_change_info(change_text)
                        change_percent = self._parse_percent(change_percent_text)

                        # 순위 정보
                        try:
                            market_cap_rank = int(rank_text) if rank_text.isdigit() else 0
                        except:
                            market_cap_rank = 0

                        stock_data = {
                            "symbol": stock_code,
                            "name": stock_name,
                            "market": "KR",
                            "exchange": "KOSPI" if sosok == 0 else "KOSDAQ",
                            "sector": "",
                            "industry": "",

                            # 가격 정보
                            "current_price": current_price,
                            "previous_close": current_price - change_amount if change_amount else current_price,
                            "change_amount": change_amount,
                            "change_percent": change_percent,

                            # 기업 정보
                            "face_value": face_value,
                            "market_cap": market_cap * 100000000,  # 억원 -> 원 단위 변환
                            "shares_outstanding": shares_outstanding,
                            "foreign_ratio": foreign_ratio,
                            "trading_volume": trading_volume,

                            # 재무 지표
                            "per": per,
                            "roe": roe,

                            # 순위
                            "market_cap_rank": market_cap_rank,
                        }

                        stocks.append(stock_data)
                        logger.info(f"Crawled {stock_code}: {stock_name} (Rank: {market_cap_rank})")

                    except Exception as e:
                        logger.error(f"Error parsing row: {str(e)}")
                        continue

                # 페이지 간 딜레이
                time.sleep(1)

            except Exception as e:
                logger.error(f"Error crawling page {page}/{pages} for sosok={sosok}: {str(e)}")
                # 개별 페이지 실패 시에도 다른 페이지 계속 처리
                continue

        logger.info(f"Successfully crawled {len(stocks)} stocks from Naver market cap pages")
        return stocks

    def _get_stock_info(self, stock_code: str) -> Dict:
        """네이버 금융에서 개별 주식 정보 가져오기"""
        url = f"{self.base_url}/item/main.naver?code={stock_code}"

        try:
            response = smart_crawler.safe_request(url)
            if not response:
                return {}

            soup = BeautifulSoup(response.content, 'html.parser')

            # 기본 정보 추출 - Stock 모델에 맞는 필드만 포함
            stock_info = {
                "symbol": stock_code,
                "name": "",  # 나중에 추출된 회사명으로 업데이트
                "market": "KR",
                "exchange": "KOSPI",  # 기본값, 나중에 정확히 구분
                "sector": "",
                "industry": "",
                "market_cap": 0,
            }

            # 회사명 추출
            company_name = soup.select_one('.wrap_company h2 a')
            if company_name:
                stock_info["name"] = company_name.get_text(strip=True)

            # Stock 모델에는 현재가, 전일대비, 거래량 정보를 저장하지 않음
            # 이런 데이터는 StockPrice 모델에서 관리

            # 시가총액 추출
            market_cap_element = soup.select_one('table.no_info tr:contains("시가총액") em')
            if market_cap_element:
                market_cap_text = market_cap_element.get_text(strip=True)
                # "1,234조 5,678억" 형태 파싱
                if '조' in market_cap_text:
                    numbers = re.findall(r'([0-9,]+)', market_cap_text)
                    if numbers:
                        try:
                            trillion = float(numbers[0].replace(',', '')) * 1e12
                            if len(numbers) > 1:
                                billion = float(numbers[1].replace(',', '')) * 1e8
                                stock_info["market_cap"] = trillion + billion
                            else:
                                stock_info["market_cap"] = trillion
                        except ValueError:
                            pass
                elif '억' in market_cap_text:
                    numbers = re.findall(r'([0-9,]+)', market_cap_text)
                    if numbers:
                        try:
                            billion = float(numbers[0].replace(',', '')) * 1e8
                            stock_info["market_cap"] = billion
                        except ValueError:
                            pass

            logger.info(f"Successfully crawled {stock_code}: {stock_info.get('name', 'Unknown')}")
            return stock_info

        except requests.RequestException as e:
            logger.error(f"Network error crawling {stock_code}: {str(e)}")
            return {}
        except Exception as e:
            logger.error(f"Error parsing {stock_code}: {str(e)}")
            return {}

    def fetch_stock_list(self) -> List[Dict]:
        """주식 목록 가져오기 - 시가총액 순위 페이지에서 크롤링"""
        # KOSPI 상위 400개 종목 크롤링 (8페이지, 50개/페이지)
        kospi_stocks = self.fetch_market_cap_stocks(sosok=0, pages=8)

        # KOSDAQ 상위 25개 종목 크롤링 (1페이지)
        kosdaq_stocks = self.fetch_market_cap_stocks(sosok=1, pages=1)

        all_stocks = kospi_stocks + kosdaq_stocks

        logger.info(f"Successfully crawled {len(all_stocks)} stocks from Naver (KOSPI: {len(kospi_stocks)}, KOSDAQ: {len(kosdaq_stocks)})")
        return all_stocks


    def fetch_stock_info(self, symbol: str) -> Dict:
        """개별 주식 정보 가져오기"""
        return self._get_stock_info(symbol)