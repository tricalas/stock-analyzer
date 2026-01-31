import time
import random
import logging
from typing import Optional, List
from datetime import datetime, timedelta
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

class SmartCrawler:
    """인간적인 패턴을 모방하는 스마트 크롤러"""

    def __init__(self):
        self.session = self._create_session()
        self.last_request_time = 0
        self.request_count = 0
        self.daily_request_count = 0
        self.last_reset_date = datetime.now().date()

        # 다양한 User-Agent 리스트 (실제 브라우저들)
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36'
        ]

        # 리퍼러 리스트 (네이버 내부 페이지들)
        self.referrers = [
            'https://finance.naver.com/',
            'https://m.stock.naver.com/',
            'https://finance.naver.com/sise/',
            'https://m.stock.naver.com/domestic/stock/',
            'https://finance.naver.com/item/main.naver'
        ]

    def _create_session(self):
        """안정적인 세션 생성"""
        session = requests.Session()

        # 재시도 전략 설정
        retry_strategy = Retry(
            total=3,
            backoff_factor=2,
            status_forcelist=[429, 500, 502, 503, 504],
            respect_retry_after_header=True
        )

        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)

        return session

    def _get_random_headers(self):
        """랜덤한 헤더 생성"""
        return {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': random.choice(self.referrers),
            'Cache-Control': 'max-age=0',
            'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1'
        }

    def _smart_delay(self):
        """인간적인 지연 패턴 (최적화)"""
        current_time = time.time()

        # 최소 간격 확보 (0.3-0.8초)
        min_interval = random.uniform(0.3, 0.8)
        time_since_last = current_time - self.last_request_time

        if time_since_last < min_interval:
            sleep_time = min_interval - time_since_last
            time.sleep(sleep_time)

        # 요청 횟수에 따른 추가 지연
        if self.request_count > 0:
            if self.request_count % 20 == 0:
                # 20회마다 짧은 휴식 (2-4초)
                short_break = random.uniform(2.0, 4.0)
                logger.info(f"Taking a short break: {short_break:.1f}s after {self.request_count} requests")
                time.sleep(short_break)

        self.last_request_time = time.time()

    def _reset_daily_counter(self):
        """일일 카운터 리셋"""
        today = datetime.now().date()
        if today != self.last_reset_date:
            self.daily_request_count = 0
            self.last_reset_date = today
            logger.info("Daily request counter reset")

    def _check_rate_limits(self):
        """요청 제한 확인"""
        self._reset_daily_counter()

        # 일일 요청 제한 (안전하게 500회로 제한)
        if self.daily_request_count >= 500:
            logger.warning("Daily request limit reached. Stopping for today.")
            raise Exception("Daily request limit exceeded")

        # 연속 요청 제한 (100회 후 짧은 휴식)
        if self.request_count >= 100:
            logger.info("Taking short break after 100 continuous requests")
            time.sleep(random.uniform(10, 20))  # 10-20초 휴식
            self.request_count = 0

    def safe_request(self, url: str, timeout: int = 10) -> Optional[requests.Response]:
        """안전한 HTTP 요청"""
        try:
            # 속도 제한 확인
            self._check_rate_limits()

            # 인간적인 지연
            self._smart_delay()

            # 랜덤 헤더로 요청
            headers = self._get_random_headers()

            logger.debug(f"Making request to: {url}")
            response = self.session.get(url, headers=headers, timeout=timeout)

            # 카운터 증가
            self.request_count += 1
            self.daily_request_count += 1

            # 응답 상태 확인
            if response.status_code == 429:
                logger.warning("Rate limited. Taking short break.")
                time.sleep(random.uniform(10, 20))  # 10-20초 대기
                return None

            response.raise_for_status()

            # 성공 로그
            logger.debug(f"Request successful: {response.status_code}")
            return response

        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed for {url}: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error during request: {str(e)}")
            return None

    def batch_crawl(self, urls: List[str], batch_size: int = 5) -> List[Optional[requests.Response]]:
        """배치 크롤링 (인간적인 패턴으로)"""
        results = []

        # URL을 배치로 나누기
        for i in range(0, len(urls), batch_size):
            batch = urls[i:i + batch_size]
            batch_results = []

            logger.info(f"Processing batch {i//batch_size + 1}/{(len(urls)-1)//batch_size + 1}")

            for url in batch:
                response = self.safe_request(url)
                batch_results.append(response)

                # 배치 내에서도 랜덤 지연
                if len(batch_results) < len(batch):
                    time.sleep(random.uniform(0.5, 2.0))

            results.extend(batch_results)

            # 배치 간 짧은 휴식
            if i + batch_size < len(urls):
                batch_break = random.uniform(2.0, 5.0)
                logger.info(f"Taking batch break: {batch_break:.1f}s")
                time.sleep(batch_break)

        return results

    def close(self):
        """세션 정리"""
        if self.session:
            self.session.close()
            logger.info("Smart crawler session closed")

# 전역 인스턴스
smart_crawler = SmartCrawler()