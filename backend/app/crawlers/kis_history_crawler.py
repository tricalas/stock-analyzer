"""
한국투자증권 API를 사용한 히스토리 데이터 크롤러
"""

import logging
import uuid
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

    def collect_history_for_stock(
        self,
        stock: Stock,
        days: int = 120,
        db: Optional[Session] = None
    ) -> Dict[str, any]:
        """
        단일 종목의 히스토리 데이터 수집

        Args:
            stock: 종목 객체
            days: 수집할 일수 (기본 120일)
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
            logger.info(f"Collecting history for {stock.symbol} ({stock.name})")

            # 날짜 계산
            end_date = datetime.now().strftime("%Y%m%d")
            start_date = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")

            # 시장별로 API 호출
            if stock.market == "KR":
                ohlcv_data = self._collect_kr_stock_history(stock.symbol, start_date, end_date)
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

            logger.info(f"Saved {saved_count} records for {stock.symbol}")

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
        days: int = 120
    ) -> Dict[str, any]:
        """
        태그가 있는 모든 종목의 히스토리 수집

        Args:
            days: 수집할 일수

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
                    "message": "No tagged stocks to process"
                }

            stocks = db.query(Stock).filter(
                Stock.id.in_(tagged_stock_ids),
                Stock.is_active == True
            ).all()

            logger.info(f"Found {len(stocks)} tagged stocks to process")

            return self._collect_history_for_stocks(stocks, days, db)

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
        limit: int = None
    ) -> Dict[str, any]:
        """
        모든 활성 종목의 히스토리 수집 (시총 상위부터)

        Args:
            days: 수집할 일수
            limit: 수집할 종목 수 제한 (None이면 전체)

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

            logger.info(f"Found {len(stocks)} active stocks to process (limit: {limit or 'none'})")

            return self._collect_history_for_stocks(stocks, days, db)

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

    def _collect_history_for_stocks(
        self,
        stocks: List[Stock],
        days: int,
        db: Session
    ) -> Dict[str, any]:
        """
        주어진 종목 리스트의 히스토리 수집 (공통 로직)

        Args:
            stocks: 종목 리스트
            days: 수집할 일수
            db: DB 세션

        Returns:
            수집 결과 딕셔너리
        """
        total = len(stocks)
        success_count = 0
        failed_count = 0
        total_records = 0

        # TaskProgress 생성
        task_id = str(uuid.uuid4())
        task_progress = TaskProgress(
            task_id=task_id,
            task_type="history_collection",
            status="running",
            total_items=total,
            current_item=0,
            message=f"히스토리 수집 시작 ({total}개 종목, {days}일)"
        )
        db.add(task_progress)
        db.commit()

        try:
            for i, stock in enumerate(stocks, 1):
                # TaskProgress 업데이트
                task_progress.current_item = i
                task_progress.current_stock_name = stock.name
                task_progress.message = f"{i}/{total} 종목 수집 중: {stock.name} ({stock.symbol})"
                db.commit()

                result = self.collect_history_for_stock(stock, days=days, db=db)

                if result["success"]:
                    success_count += 1
                    total_records += result.get("records_saved", 0)
                    task_progress.success_count += 1
                else:
                    failed_count += 1
                    task_progress.failed_count += 1

                db.commit()

                # 진행상황 로그 (50개마다)
                if i % 50 == 0:
                    logger.info(f"Progress: {i}/{total} stocks processed ({success_count} success, {failed_count} failed)")

            # TaskProgress 완료 처리
            task_progress.status = "completed"
            task_progress.current_item = total
            task_progress.message = f"수집 완료: {success_count}/{total} 종목, {total_records}개 레코드 저장"
            task_progress.completed_at = datetime.utcnow()
            db.commit()

            logger.info(f"Collection complete: {success_count}/{total} stocks, {total_records} records saved")

            return {
                "success": True,
                "total_stocks": total,
                "success_count": success_count,
                "failed_count": failed_count,
                "total_records": total_records,
                "task_id": task_id
            }

        except Exception as e:
            # TaskProgress 실패 처리
            task_progress.status = "failed"
            task_progress.error_message = str(e)
            task_progress.completed_at = datetime.utcnow()
            db.commit()
            raise


# 전역 인스턴스
kis_history_crawler = KISHistoryCrawler()
