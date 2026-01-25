"""
한국투자증권 API를 사용한 히스토리 데이터 크롤러
"""

import logging
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Optional
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session

from app.kis.kis_client import get_kis_client
from app.models import Stock, StockPriceHistory, TaskProgress
from app.database import SessionLocal

logger = logging.getLogger(__name__)


class KISHistoryCrawler:
    """한투 API를 사용한 히스토리 데이터 수집기"""

    def __init__(self):
        self.kis_client = get_kis_client()

    def _should_collect_history(
        self,
        stock: Stock,
        db: Session,
        min_records: int = 60
    ) -> tuple:
        """
        수집 필요 여부 판단 (하이브리드 전략)

        Args:
            stock: 종목 객체
            db: 데이터베이스 세션
            min_records: 최소 레코드 수 기준 (기본 60일)

        Returns:
            (should_collect, mode, last_date)
            - should_collect: 수집 필요 여부
            - mode: "full" | "incremental" | "skip"
            - last_date: 마지막 수집 날짜 (증분 수집용)
        """
        count = stock.history_records_count or 0

        # 데이터 없음 → 전체 수집
        if count == 0:
            return (True, "full", None)

        # 데이터 부족 → 전체 수집
        if count < min_records:
            return (True, "full", None)

        # 데이터 충분 → 마지막 날짜 확인
        last_record = db.query(StockPriceHistory.date).filter(
            StockPriceHistory.stock_id == stock.id
        ).order_by(StockPriceHistory.date.desc()).first()

        if last_record:
            last_date = last_record[0]
            days_since = (date.today() - last_date).days

            if days_since <= 1:  # 오늘 또는 어제 데이터 있음
                return (False, "skip", last_date)
            else:
                return (True, "incremental", last_date)

        # 레코드 카운트는 있지만 실제 데이터 없음 → 전체 수집
        return (True, "full", None)

    def collect_history_for_stock(
        self,
        stock: Stock,
        days: int = 120,
        start_date: date = None,
        db: Optional[Session] = None
    ) -> Dict[str, any]:
        """
        단일 종목의 히스토리 데이터 수집

        Args:
            stock: 종목 객체
            days: 수집할 일수 (기본 120일, start_date가 없을 때 사용)
            start_date: 시작 날짜 (증분 수집용, 지정하면 days 무시)
            db: 데이터베이스 세션

        Returns:
            수집 결과 딕셔너리
        """
        if self.kis_client is None:
            logger.error("KIS client not initialized. Check API keys in .env")
            return {"success": False, "error": "KIS API not configured"}

        should_close_db = False
        if db is None:
            db = SessionLocal()
            should_close_db = True

        try:
            # 날짜 계산
            end_date_str = datetime.now().strftime("%Y%m%d")

            if start_date:
                # 증분 수집: 지정된 start_date부터
                start_date_str = start_date.strftime("%Y%m%d")
                logger.info(f"Collecting history for {stock.symbol} ({stock.name}) [incremental: {start_date_str} ~ {end_date_str}]")
            else:
                # 전체 수집: days일 전부터
                start_date_str = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
                logger.info(f"Collecting history for {stock.symbol} ({stock.name}) [full: {days} days]")

            # 시장별로 API 호출
            if stock.market == "KR":
                ohlcv_data = self._collect_kr_stock_history(stock.symbol, start_date_str, end_date_str)
            elif stock.market == "US":
                exchange = self._get_us_exchange_code(stock.exchange)
                ohlcv_data = self._collect_us_stock_history(stock.symbol, exchange)
            else:
                logger.warning(f"Unknown market: {stock.market} for {stock.symbol}")
                return {"success": False, "error": f"Unknown market: {stock.market}"}

            if not ohlcv_data:
                logger.warning(f"No data received for {stock.symbol}")
                return {"success": False, "error": "No data received from API"}

            # 데이터 저장
            saved_count = self._save_price_history(stock.id, ohlcv_data, db)

            # Stock 테이블의 history_records_count 업데이트 (직접 UPDATE 쿼리 사용)
            total_records = db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock.id
            ).count()

            # 직접 UPDATE 쿼리로 확실하게 업데이트
            db.query(Stock).filter(Stock.id == stock.id).update(
                {"history_records_count": total_records},
                synchronize_session=False
            )
            db.commit()

            logger.info(f"Saved {saved_count} records for {stock.symbol} (total: {total_records}, count updated)")

            return {
                "success": True,
                "stock_id": stock.id,
                "symbol": stock.symbol,
                "records_saved": saved_count
            }

        except Exception as e:
            logger.error(f"Error collecting history for {stock.symbol}: {str(e)}")
            return {"success": False, "error": str(e)}

        finally:
            if should_close_db:
                db.close()

    def _collect_kr_stock_history(
        self,
        symbol: str,
        start_date: str,
        end_date: str
    ) -> List[Dict]:
        """
        국내 주식 히스토리 수집

        Returns:
            OHLCV 데이터 리스트
        """
        try:
            raw_data = self.kis_client.get_kr_stock_ohlcv(
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                period="D"  # 일봉
            )

            # 데이터 변환
            result = []
            for item in raw_data:
                try:
                    result.append({
                        "date": datetime.strptime(item["stck_bsop_date"], "%Y%m%d").date(),
                        "open_price": int(item.get("stck_oprc", 0)),
                        "high_price": int(item.get("stck_hgpr", 0)),
                        "low_price": int(item.get("stck_lwpr", 0)),
                        "close_price": int(item.get("stck_clpr", 0)),
                        "volume": int(item.get("acml_vol", 0))
                    })
                except (ValueError, KeyError) as e:
                    logger.warning(f"Error parsing KR data: {str(e)}, item: {item}")
                    continue

            return result

        except Exception as e:
            logger.error(f"Error fetching KR stock history: {str(e)}")
            return []

    def _collect_us_stock_history(
        self,
        symbol: str,
        exchange: str
    ) -> List[Dict]:
        """
        해외 주식 히스토리 수집

        Returns:
            OHLCV 데이터 리스트
        """
        try:
            raw_data = self.kis_client.get_us_stock_ohlcv(
                symbol=symbol,
                exchange=exchange,
                period="D"  # 일봉
            )

            # 데이터 변환
            result = []
            for item in raw_data:
                try:
                    result.append({
                        "date": datetime.strptime(item["xymd"], "%Y%m%d").date(),
                        "open_price": int(float(item.get("open", 0))),
                        "high_price": int(float(item.get("high", 0))),
                        "low_price": int(float(item.get("low", 0))),
                        "close_price": int(float(item.get("clos", 0))),
                        "volume": int(item.get("tvol", 0))
                    })
                except (ValueError, KeyError) as e:
                    logger.warning(f"Error parsing US data: {str(e)}, item: {item}")
                    continue

            return result

        except Exception as e:
            logger.error(f"Error fetching US stock history: {str(e)}")
            return []

    def _get_us_exchange_code(self, exchange: str) -> str:
        """
        거래소명을 한투 API 코드로 변환

        Args:
            exchange: 거래소명 (NASDAQ, NYSE, AMEX 등)

        Returns:
            한투 API 거래소 코드
        """
        exchange_map = {
            "NASDAQ": "NAS",
            "NYSE": "NYS",
            "AMEX": "AMS",
        }
        return exchange_map.get(exchange.upper(), "NAS")

    def _save_price_history(
        self,
        stock_id: int,
        ohlcv_data: List[Dict],
        db: Session
    ) -> int:
        """
        가격 히스토리 데이터를 DB에 저장

        Args:
            stock_id: 종목 ID
            ohlcv_data: OHLCV 데이터 리스트
            db: 데이터베이스 세션

        Returns:
            저장된 레코드 수
        """
        saved_count = 0

        for data in ohlcv_data:
            try:
                # 중복 체크
                existing = db.query(StockPriceHistory).filter_by(
                    stock_id=stock_id,
                    date=data["date"]
                ).first()

                if existing:
                    # 업데이트
                    existing.open_price = data["open_price"]
                    existing.high_price = data["high_price"]
                    existing.low_price = data["low_price"]
                    existing.close_price = data["close_price"]
                    existing.volume = data["volume"]
                    existing.updated_at = datetime.utcnow()
                else:
                    # 새로 추가
                    new_record = StockPriceHistory(
                        stock_id=stock_id,
                        date=data["date"],
                        open_price=data["open_price"],
                        high_price=data["high_price"],
                        low_price=data["low_price"],
                        close_price=data["close_price"],
                        volume=data["volume"]
                    )
                    db.add(new_record)

                saved_count += 1

            except Exception as e:
                logger.error(f"Error saving price history: {str(e)}")
                continue

        db.commit()
        return saved_count

    def collect_history_for_tagged_stocks(
        self,
        days: int = 120,
        task_id: Optional[str] = None,
        max_workers: int = 5
    ) -> Dict[str, any]:
        """
        태그가 있는 모든 종목의 히스토리 수집 (병렬 처리)

        Args:
            days: 수집할 일수
            task_id: TaskProgress에 사용할 task_id (선택적, 없으면 자동 생성)
            max_workers: 병렬 워커 수 (기본 5)

        Returns:
            수집 결과 딕셔너리
        """
        db = SessionLocal()

        try:
            # 태그가 있는 종목들 조회
            from app.models import StockTagAssignment

            tagged_stock_ids = db.query(StockTagAssignment.stock_id).distinct().all()
            tagged_stock_ids = [sid[0] for sid in tagged_stock_ids]

            if not tagged_stock_ids:
                logger.info("No tagged stocks found")
                return {
                    "success": True,
                    "total_stocks": 0,
                    "success_count": 0,
                    "failed_count": 0,
                    "total_records": 0,
                    "message": "No tagged stocks to process",
                    "task_id": task_id
                }

            stocks = db.query(Stock).filter(
                Stock.id.in_(tagged_stock_ids),
                Stock.is_active == True
            ).all()

            logger.info(f"Found {len(stocks)} tagged stocks to process (workers: {max_workers})")

            return self._collect_history_for_stocks(stocks, days, db, task_id=task_id, max_workers=max_workers)

        except Exception as e:
            logger.error(f"Error collecting history for tagged stocks: {str(e)}")
            return {
                "success": False,
                "total_stocks": 0,
                "success_count": 0,
                "failed_count": 0,
                "total_records": 0,
                "error": str(e)
            }

        finally:
            db.close()

    def collect_history_for_all_stocks(
        self,
        days: int = 120,
        limit: int = None,
        task_id: Optional[str] = None,
        max_workers: int = 5
    ) -> Dict[str, any]:
        """
        모든 활성 종목의 히스토리 수집 (시총 상위부터, 병렬 처리)

        Args:
            days: 수집할 일수
            limit: 수집할 종목 수 제한 (None이면 전체)
            task_id: TaskProgress에 사용할 task_id (선택적)
            max_workers: 병렬 워커 수 (기본 5)

        Returns:
            수집 결과 딕셔너리
        """
        db = SessionLocal()

        try:
            # 모든 활성 종목 조회 (시총 기준 내림차순)
            query = db.query(Stock).filter(
                Stock.is_active == True
            ).order_by(Stock.market_cap.desc().nullslast())

            if limit:
                query = query.limit(limit)

            stocks = query.all()

            logger.info(f"Found {len(stocks)} active stocks to process (limit: {limit or 'none'}, workers: {max_workers})")

            return self._collect_history_for_stocks(stocks, days, db, task_id=task_id, max_workers=max_workers)

        except Exception as e:
            logger.error(f"Error collecting history for all stocks: {str(e)}")
            return {
                "success": False,
                "total_stocks": 0,
                "success_count": 0,
                "failed_count": 0,
                "total_records": 0,
                "error": str(e)
            }

        finally:
            db.close()

    def _process_single_stock(
        self,
        stock_data: Dict,
        days: int,
        task_id: str,
        counters: Dict,
        lock: threading.Lock
    ) -> Dict:
        """
        단일 종목 처리 (워커 스레드에서 실행)

        Args:
            stock_data: 종목 정보 딕셔너리 (id, symbol, name, market, exchange, history_records_count)
            days: 수집할 일수
            task_id: 태스크 ID
            counters: 공유 카운터 딕셔너리
            lock: 스레드 동기화용 Lock

        Returns:
            처리 결과 딕셔너리
        """
        from app.models import HistoryCollectionLog

        # 워커 전용 DB 세션 생성
        db = SessionLocal()

        try:
            # Stock 객체 다시 조회 (세션 분리)
            stock = db.query(Stock).filter(Stock.id == stock_data["id"]).first()
            if not stock:
                return {"success": False, "mode": "error", "error": "Stock not found"}

            # 스마트 체크: 수집 필요 여부 판단
            should_collect, mode, last_date = self._should_collect_history(stock, db)

            if mode == "skip":
                logger.debug(f"Skip {stock.symbol}: already up to date (last: {last_date})")
                with lock:
                    counters["skipped"] += 1
                    counters["success"] += 1
                    counters["processed"] += 1
                return {"success": True, "mode": "skip", "records_saved": 0}

            # 종목별 로그 시작
            log_entry = HistoryCollectionLog(
                task_id=task_id,
                stock_id=stock.id,
                stock_symbol=stock.symbol,
                stock_name=stock.name,
                status="running",
                records_saved=0
            )
            db.add(log_entry)
            db.commit()

            # 모드에 따라 수집 실행
            if mode == "incremental":
                with lock:
                    counters["incremental"] += 1
                incremental_start = last_date + timedelta(days=1)
                result = self.collect_history_for_stock(
                    stock, start_date=incremental_start, db=db
                )
            else:
                with lock:
                    counters["full"] += 1
                result = self.collect_history_for_stock(stock, days=days, db=db)

            # 종목별 로그 업데이트
            log_entry.completed_at = datetime.utcnow()
            if result["success"]:
                with lock:
                    counters["success"] += 1
                    counters["records"] += result.get("records_saved", 0)
                    counters["processed"] += 1
                log_entry.status = "success"
                log_entry.records_saved = result.get("records_saved", 0)
            else:
                with lock:
                    counters["failed"] += 1
                    counters["processed"] += 1
                log_entry.status = "failed"
                log_entry.error_message = result.get("error", "Unknown error")

            db.commit()

            return {
                "success": result["success"],
                "mode": mode,
                "records_saved": result.get("records_saved", 0),
                "error": result.get("error")
            }

        except Exception as e:
            logger.error(f"Worker error for stock {stock_data['symbol']}: {str(e)}")
            with lock:
                counters["failed"] += 1
                counters["processed"] += 1
            return {"success": False, "mode": "error", "error": str(e)}

        finally:
            db.close()

    def _collect_history_for_stocks(
        self,
        stocks: List[Stock],
        days: int,
        db: Session,
        task_id: Optional[str] = None,
        max_workers: int = 5
    ) -> Dict[str, any]:
        """
        주어진 종목 리스트의 히스토리 수집 (병렬 처리, 하이브리드 전략)

        Args:
            stocks: 종목 리스트
            days: 수집할 일수
            db: DB 세션 (TaskProgress 업데이트용)
            task_id: TaskProgress에 사용할 task_id (선택적, 없으면 자동 생성)
            max_workers: 최대 워커 수 (기본 5, API rate limit 고려)

        Returns:
            수집 결과 딕셔너리 (skipped, incremental, full 카운트 포함)
        """
        total = len(stocks)

        # TaskProgress 생성
        if task_id is None:
            task_id = str(uuid.uuid4())

        task_progress = TaskProgress(
            task_id=task_id,
            task_type="history_collection",
            status="running",
            total_items=total,
            current_item=0,
            message=f"히스토리 수집 시작 ({total}개 종목, {days}일, 워커 {max_workers}개)"
        )
        db.add(task_progress)
        db.commit()

        # 공유 카운터 (Lock으로 동기화)
        counters = {
            "processed": 0,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "incremental": 0,
            "full": 0,
            "records": 0
        }
        lock = threading.Lock()

        # 종목 데이터를 딕셔너리로 변환 (세션 분리를 위해)
        stock_data_list = [
            {
                "id": s.id,
                "symbol": s.symbol,
                "name": s.name,
                "market": s.market,
                "exchange": s.exchange,
                "history_records_count": s.history_records_count
            }
            for s in stocks
        ]

        try:
            logger.info(f"Starting parallel collection with {max_workers} workers for {total} stocks")

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # 모든 작업 제출
                futures = {
                    executor.submit(
                        self._process_single_stock,
                        stock_data,
                        days,
                        task_id,
                        counters,
                        lock
                    ): stock_data
                    for stock_data in stock_data_list
                }

                # 완료되는 대로 처리
                for future in as_completed(futures):
                    stock_data = futures[future]

                    try:
                        result = future.result()
                    except Exception as e:
                        logger.error(f"Future error for {stock_data['symbol']}: {str(e)}")

                    # 진행상황 업데이트 (10개마다)
                    with lock:
                        processed = counters["processed"]

                    if processed % 10 == 0 or processed == total:
                        # TaskProgress 업데이트
                        task_progress.current_item = processed
                        task_progress.success_count = counters["success"]
                        task_progress.failed_count = counters["failed"]
                        task_progress.message = (
                            f"{processed}/{total} 종목 처리 완료 "
                            f"(스킵: {counters['skipped']}, 증분: {counters['incremental']}, "
                            f"전체: {counters['full']})"
                        )
                        db.commit()

                    # 콘솔 로그 (50개마다)
                    if processed % 50 == 0:
                        logger.info(
                            f"Progress: {processed}/{total} stocks "
                            f"(skip: {counters['skipped']}, inc: {counters['incremental']}, "
                            f"full: {counters['full']}, fail: {counters['failed']})"
                        )

            # TaskProgress 완료 처리
            task_progress.status = "completed"
            task_progress.current_item = total
            task_progress.success_count = counters["success"]
            task_progress.failed_count = counters["failed"]
            task_progress.message = (
                f"수집 완료: {counters['success']}/{total} 종목 "
                f"(스킵: {counters['skipped']}, 증분: {counters['incremental']}, 전체: {counters['full']}), "
                f"{counters['records']}개 레코드 저장"
            )
            task_progress.completed_at = datetime.utcnow()
            db.commit()

            logger.info(
                f"Collection complete: {counters['success']}/{total} stocks, "
                f"skipped: {counters['skipped']}, incremental: {counters['incremental']}, "
                f"full: {counters['full']}, {counters['records']} records saved"
            )

            return {
                "success": True,
                "total_stocks": total,
                "success_count": counters["success"],
                "failed_count": counters["failed"],
                "skipped": counters["skipped"],
                "incremental": counters["incremental"],
                "full_collected": counters["full"],
                "total_records": counters["records"],
                "task_id": task_id,
                "workers": max_workers
            }

        except Exception as e:
            # TaskProgress 실패 처리
            task_progress.status = "failed"
            task_progress.error_message = str(e)
            task_progress.completed_at = datetime.utcnow()
            db.commit()
            logger.error(f"Collection failed: {str(e)}")
            raise


# 전역 인스턴스
kis_history_crawler = KISHistoryCrawler()
