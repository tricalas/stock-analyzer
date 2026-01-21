from typing import List, Dict, Optional
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session
import logging
from app.crawlers.naver_crawler import NaverStockCrawler
from app.crawlers.naver_us_crawler import NaverUSStockCrawler
from app.models import Stock, StockPrice, StockDailyData, CrawlingLog
from app.database import SessionLocal
from app.constants import ETF_KEYWORDS
import time

logger = logging.getLogger(__name__)

class CrawlerManager:
    def __init__(self):
        self.naver_crawler = NaverStockCrawler()
        self.naver_us_crawler = NaverUSStockCrawler()

    def update_stock_list(self, market: str = "ALL") -> Dict:
        db = SessionLocal()
        results = {"success": 0, "failed": 0, "total": 0, "skipped_etf": 0}

        try:
            stocks_data = []

            if market in ["ALL", "KR"]:
                # 한국 주식 크롤링
                naver_stocks = self.naver_crawler.fetch_stock_list()

                # ETF 및 지수 종목 필터링
                filtered_stocks = []
                etf_count = 0

                for stock in naver_stocks:
                    # 종목 이름에 ETF 키워드가 포함되어 있는지 확인
                    is_etf = False
                    for keyword in ETF_KEYWORDS:
                        if keyword.upper() in stock.get('name', '').upper():
                            is_etf = True
                            etf_count += 1
                            logger.debug(f"Skipping ETF/Index stock: {stock.get('symbol')} - {stock.get('name')}")
                            break

                    if not is_etf:
                        filtered_stocks.append(stock)

                stocks_data.extend(filtered_stocks)
                results["skipped_etf"] = etf_count
                logger.info(f"Used Naver crawler: {len(naver_stocks)} stocks found, {etf_count} ETF/Index stocks filtered out, {len(filtered_stocks)} stocks to process")

            if market in ["ALL", "US"]:
                # 미국 주식 크롤링
                logger.info("Fetching US stocks from Naver API...")
                us_stocks = self.naver_us_crawler.fetch_all_us_stocks(nasdaq_pages=10, nyse_pages=10)
                stocks_data.extend(us_stocks)
                logger.info(f"Fetched {len(us_stocks)} US stocks")

            results["total"] = len(stocks_data)

            # 배치 처리를 위한 리스트
            updates = []
            inserts = []

            # 기존 종목들 한번에 조회
            existing_symbols = {stock.symbol: stock for stock in db.query(Stock).all()}

            for stock_data in stocks_data:
                if stock_data["symbol"] in existing_symbols:
                    # 업데이트 대상
                    existing_stock = existing_symbols[stock_data["symbol"]]
                    for key, value in stock_data.items():
                        if hasattr(existing_stock, key):
                            setattr(existing_stock, key, value)
                    existing_stock.updated_at = datetime.utcnow()
                    updates.append(existing_stock)
                else:
                    # 새로운 종목
                    new_stock = Stock(**stock_data)
                    inserts.append(new_stock)

            try:
                # 배치로 추가
                if inserts:
                    db.add_all(inserts)
                    logger.info(f"Added {len(inserts)} new stocks")

                # 배치 커밋
                db.commit()
                results["success"] = len(updates) + len(inserts)
                logger.info(f"Successfully processed {results['success']} stocks (Updated: {len(updates)}, Added: {len(inserts)})")

            except Exception as e:
                db.rollback()
                results["failed"] = len(stocks_data)
                results["success"] = 0
                logger.error(f"Batch processing failed: {str(e)}")

                # 실패 시 개별 처리로 폴백
                for stock_data in stocks_data:
                    try:
                        existing_stock = db.query(Stock).filter_by(symbol=stock_data["symbol"]).first()

                        if existing_stock:
                            for key, value in stock_data.items():
                                if hasattr(existing_stock, key):
                                    setattr(existing_stock, key, value)
                            existing_stock.updated_at = datetime.utcnow()
                        else:
                            new_stock = Stock(**stock_data)
                            db.add(new_stock)

                        db.commit()
                        results["success"] += 1
                        results["failed"] -= 1

                    except Exception as e:
                        db.rollback()
                        logger.error(f"Error updating stock {stock_data['symbol']}: {str(e)}")

        finally:
            db.close()

        return results


    def calculate_technical_indicators(self, stock_id: int) -> None:
        db = SessionLocal()
        try:
            prices = db.query(StockPrice).filter_by(stock_id=stock_id).order_by(StockPrice.date.desc()).limit(120).all()

            if len(prices) < 5:
                return

            prices = list(reversed(prices))
            closes = [p.close for p in prices]

            for i in range(len(prices)):
                daily_data = db.query(StockDailyData).filter_by(
                    stock_id=stock_id,
                    date=prices[i].date
                ).first()

                if not daily_data:
                    daily_data = StockDailyData(
                        stock_id=stock_id,
                        date=prices[i].date
                    )
                    db.add(daily_data)

                if i >= 4:
                    daily_data.ma5 = sum(closes[i-4:i+1]) / 5
                if i >= 19:
                    daily_data.ma20 = sum(closes[i-19:i+1]) / 20
                if i >= 59:
                    daily_data.ma60 = sum(closes[i-59:i+1]) / 60
                if i >= 119:
                    daily_data.ma120 = sum(closes[i-119:i+1]) / 120

                if i >= 14:
                    gains = []
                    losses = []
                    for j in range(i-13, i+1):
                        change = closes[j] - closes[j-1]
                        if change > 0:
                            gains.append(change)
                            losses.append(0)
                        else:
                            gains.append(0)
                            losses.append(abs(change))

                    avg_gain = sum(gains) / 14
                    avg_loss = sum(losses) / 14

                    if avg_loss != 0:
                        rs = avg_gain / avg_loss
                        daily_data.rsi = 100 - (100 / (1 + rs))
                    else:
                        daily_data.rsi = 100

            db.commit()
            logger.info(f"Calculated technical indicators for stock_id: {stock_id}")

        except Exception as e:
            db.rollback()
            logger.error(f"Error calculating indicators for stock_id {stock_id}: {str(e)}")
        finally:
            db.close()