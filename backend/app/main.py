from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date, timedelta
import logging

from app.config import settings
from app.database import engine, Base, get_db
from app.models import Stock, StockPrice, StockDailyData, StockPriceHistory, StockFavorite, StockDislike
from app import schemas
from app.crawlers.crawler_manager import CrawlerManager
from app.crawlers.price_history_crawler import price_history_crawler
from app.scheduler import stock_scheduler
from app.constants import ETF_KEYWORDS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Stock Analyzer API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

crawler_manager = CrawlerManager()

# 스케줄러 시작
@app.on_event("startup")
async def startup_event():
    stock_scheduler.start()
    logger.info("Stock scheduler started on application startup")

@app.on_event("shutdown")
async def shutdown_event():
    stock_scheduler.stop()
    logger.info("Stock scheduler stopped on application shutdown")

@app.get("/")
def read_root():
    return {"message": "Stock Analyzer API", "version": "1.0.0"}

@app.get("/api/stocks", response_model=schemas.StockListResponse)
def get_stocks(
    market: Optional[str] = Query(None, description="Filter by market (KR, US)"),
    exchange: Optional[str] = Query(None, description="Filter by exchange"),
    sector: Optional[str] = Query(None, description="Filter by sector"),
    exclude_etf: bool = Query(False, description="Exclude ETF and index funds"),
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=2000),
    db: Session = Depends(get_db)
):
    query = db.query(Stock).filter(Stock.is_active == True)

    # ETF 및 지수 종목 제외
    if exclude_etf:
        for keyword in ETF_KEYWORDS:
            query = query.filter(~Stock.name.ilike(f'%{keyword}%'))

    if market:
        query = query.filter(Stock.market == market)
    if exchange:
        query = query.filter(Stock.exchange == exchange)
    if sector:
        query = query.filter(Stock.sector == sector)

    total = query.count()
    stocks = query.offset(skip).limit(limit).all()

    stock_list = []
    for stock in stocks:
        latest_price = db.query(StockPrice).filter_by(stock_id=stock.id).order_by(StockPrice.date.desc()).first()

        # 히스토리 데이터 상태 확인
        history_count = db.query(StockPriceHistory).filter(StockPriceHistory.stock_id == stock.id).count()
        latest_history = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock.id
        ).order_by(StockPriceHistory.date.desc()).first()
        oldest_history = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock.id
        ).order_by(StockPriceHistory.date.asc()).first()

        # 90일 이동평균 계산 및 저장
        ma90_price = None
        if history_count >= 90:
            recent_90_days = db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock.id
            ).order_by(StockPriceHistory.date.desc()).limit(90).all()

            if len(recent_90_days) == 90:
                total_sum = sum(record.close_price for record in recent_90_days)
                ma90_price = total_sum / 90

                # DB에 저장
                if stock.ma90_price != ma90_price:
                    stock.ma90_price = ma90_price
                    db.commit()

        # 90일 이동평균 대비 현재가 비율 계산
        ma90_percentage = None
        if stock.ma90_price and stock.current_price:
            ma90_percentage = ((stock.current_price - stock.ma90_price) / stock.ma90_price) * 100

        # 즐겨찾기 상태 확인
        is_favorite = db.query(StockFavorite).filter(StockFavorite.stock_id == stock.id).first() is not None

        # 싫어요 상태 확인
        is_dislike = db.query(StockDislike).filter(StockDislike.stock_id == stock.id).first() is not None

        stock_data = {
            "symbol": stock.symbol,
            "name": stock.name,
            "market": stock.market,
            "exchange": stock.exchange,
            "sector": stock.sector,
            "industry": stock.industry,

            # 새로운 가격 정보 필드들
            "current_price": stock.current_price,
            "previous_close": stock.previous_close,
            "change_amount": stock.change_amount,
            "change_percent": stock.change_percent,

            # 기업 정보 필드들
            "face_value": stock.face_value,
            "market_cap": stock.market_cap,
            "shares_outstanding": stock.shares_outstanding,
            "foreign_ratio": stock.foreign_ratio,
            "trading_volume": stock.trading_volume,

            # 재무 지표 필드들
            "per": stock.per,
            "roe": stock.roe,

            # 순위 정보
            "market_cap_rank": stock.market_cap_rank,

            "id": stock.id,
            "is_active": stock.is_active,
            "created_at": stock.created_at,
            "updated_at": stock.updated_at,

            # 히스토리 데이터 상태
            "history_records_count": history_count,
            "history_latest_date": latest_history.date.isoformat() if latest_history else None,
            "history_oldest_date": oldest_history.date.isoformat() if oldest_history else None,
            "has_history_data": history_count > 0,
            "ma90_price": stock.ma90_price,
            "ma90_percentage": ma90_percentage,

            # 이전 버전 호환성을 위한 필드들
            "latest_price": latest_price.close if latest_price else stock.current_price,
            "latest_change": latest_price.change if latest_price else stock.change_amount,
            "latest_change_percent": latest_price.change_percent if latest_price else stock.change_percent,
            "latest_volume": latest_price.volume if latest_price else stock.trading_volume,

            # 즐겨찾기 상태
            "is_favorite": is_favorite,

            # 싫어요 상태
            "is_dislike": is_dislike,
        }
        stock_list.append(stock_data)

    return {
        "total": total,
        "stocks": stock_list,
        "page": skip // limit + 1,
        "page_size": limit
    }

@app.get("/api/stocks/{stock_id}", response_model=schemas.Stock)
def get_stock(stock_id: int, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")
    return stock

@app.get("/api/stocks/{stock_id}/prices", response_model=List[schemas.StockPrice])
def get_stock_prices(
    stock_id: int,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(StockPrice).filter(StockPrice.stock_id == stock_id)

    if start_date:
        query = query.filter(StockPrice.date >= start_date)
    if end_date:
        query = query.filter(StockPrice.date <= end_date)

    prices = query.order_by(StockPrice.date.desc()).limit(500).all()
    return prices

@app.get("/api/stocks/{stock_id}/daily-data", response_model=List[schemas.StockDailyData])
def get_stock_daily_data(
    stock_id: int,
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(StockDailyData).filter(StockDailyData.stock_id == stock_id)

    if start_date:
        query = query.filter(StockDailyData.date >= start_date)
    if end_date:
        query = query.filter(StockDailyData.date <= end_date)

    daily_data = query.order_by(StockDailyData.date.desc()).limit(500).all()
    return daily_data

@app.post("/api/crawl/stocks", response_model=schemas.CrawlingStatus)
def crawl_stock_list(market: str = Query("ALL", regex="^(ALL|KR|US)$")):
    try:
        result = crawler_manager.update_stock_list(market)

        # ETF 필터링 정보 포함한 메시지 생성
        etf_info = ""
        if result.get('skipped_etf', 0) > 0:
            etf_info = f" ({result['skipped_etf']} ETF/Index stocks filtered out)"

        return {
            **result,
            "message": f"Successfully crawled {result['success']} out of {result['total']} stocks{etf_info}"
        }
    except Exception as e:
        logger.error(f"Error during stock list crawling: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/crawl/indicators/{stock_id}")
def calculate_indicators(stock_id: int, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    try:
        crawler_manager.calculate_technical_indicators(stock_id)
        return {"message": f"Successfully calculated indicators for {stock.symbol}"}
    except Exception as e:
        logger.error(f"Error calculating indicators: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/scheduler/status")
def get_scheduler_status():
    """스케줄러 상태 및 등록된 작업 목록 조회"""
    try:
        jobs = stock_scheduler.get_jobs()
        return {
            "running": stock_scheduler.scheduler.running,
            "jobs": jobs,
            "message": "Scheduler is running" if stock_scheduler.scheduler.running else "Scheduler is stopped"
        }
    except Exception as e:
        logger.error(f"Error getting scheduler status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/scheduler/trigger")
def trigger_manual_crawl():
    """수동으로 주식 데이터 크롤링 실행"""
    try:
        result = stock_scheduler.trigger_manual_crawl()
        return {
            "message": "Manual crawling completed successfully",
            "result": result
        }
    except Exception as e:
        logger.error(f"Error in manual crawling: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stocks/{stock_id}/price-history", response_model=List[schemas.StockPriceHistory])
def get_stock_price_history(
    stock_id: int,
    days: int = Query(30, ge=1, le=365, description="Number of days to retrieve"),
    db: Session = Depends(get_db)
):
    """특정 종목의 가격 히스토리 조회"""
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    # 최근 N일 데이터 조회
    from datetime import date, timedelta
    start_date = date.today() - timedelta(days=days)

    price_history = db.query(StockPriceHistory).filter(
        StockPriceHistory.stock_id == stock_id,
        StockPriceHistory.date >= start_date
    ).order_by(StockPriceHistory.date.desc()).all()

    return price_history

@app.post("/api/stocks/{stock_id}/crawl-history")
def crawl_stock_price_history(
    stock_id: int,
    days: int = Query(100, ge=1, le=365, description="Number of days to crawl"),
    db: Session = Depends(get_db)
):
    """개별 종목의 가격 히스토리 크롤링"""
    try:
        # 종목 존재 확인
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        logger.info(f"Starting price history crawling for stock {stock.symbol}")

        # 기존 데이터 확인
        latest_record = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id
        ).order_by(StockPriceHistory.date.desc()).first()

        # 크롤링 실행
        price_data = price_history_crawler.fetch_price_history(stock.symbol, days)

        if not price_data:
            return {
                "success": 0,
                "failed": 1,
                "total": 1,
                "message": f"No price data found for {stock.symbol}"
            }

        # 데이터베이스에 저장
        success_count = 0
        failed_count = 0

        for data in price_data:
            try:
                # 기존 데이터 확인 (중복 방지)
                existing = db.query(StockPriceHistory).filter(
                    StockPriceHistory.stock_id == stock_id,
                    StockPriceHistory.date == data['date']
                ).first()

                if existing:
                    # 기존 데이터 업데이트
                    existing.open_price = data['open_price']
                    existing.high_price = data['high_price']
                    existing.low_price = data['low_price']
                    existing.close_price = data['close_price']
                    existing.volume = data['volume']
                    existing.updated_at = datetime.utcnow()
                else:
                    # 새 데이터 추가
                    new_record = StockPriceHistory(
                        stock_id=stock_id,
                        **data
                    )
                    db.add(new_record)

                success_count += 1

            except Exception as e:
                logger.error(f"Error saving price data for {data['date']}: {str(e)}")
                failed_count += 1
                continue

        # 커밋
        db.commit()

        logger.info(f"Price history crawling completed for {stock.symbol}: {success_count} success, {failed_count} failed")

        return {
            "success": success_count,
            "failed": failed_count,
            "total": len(price_data),
            "message": f"Successfully crawled {success_count} price records for {stock.symbol}"
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Error crawling price history for stock {stock_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stocks/{stock_id}/history-status")
def get_stock_history_status(stock_id: int, db: Session = Depends(get_db)):
    """종목의 히스토리 데이터 상태 확인"""
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    # 히스토리 데이터 통계
    total_records = db.query(StockPriceHistory).filter(
        StockPriceHistory.stock_id == stock_id
    ).count()

    latest_record = db.query(StockPriceHistory).filter(
        StockPriceHistory.stock_id == stock_id
    ).order_by(StockPriceHistory.date.desc()).first()

    oldest_record = db.query(StockPriceHistory).filter(
        StockPriceHistory.stock_id == stock_id
    ).order_by(StockPriceHistory.date.asc()).first()

    return {
        "stock_symbol": stock.symbol,
        "stock_name": stock.name,
        "total_records": total_records,
        "latest_date": latest_record.date if latest_record else None,
        "oldest_date": oldest_record.date if oldest_record else None,
        "has_data": total_records > 0
    }

@app.delete("/api/stocks/cleanup-etf")
def cleanup_etf_stocks(db: Session = Depends(get_db)):
    """지수/ETF 종목들을 데이터베이스에서 완전히 삭제"""
    try:
        # 삭제할 종목들 찾기
        etf_stocks = []
        for keyword in ETF_KEYWORDS:
            stocks = db.query(Stock).filter(Stock.name.ilike(f'%{keyword}%')).all()
            etf_stocks.extend(stocks)

        # 중복 제거
        unique_etf_stocks = list({stock.id: stock for stock in etf_stocks}.values())

        logger.info(f"Found {len(unique_etf_stocks)} ETF/Index stocks to delete")

        deleted_count = 0
        deleted_stocks = []

        for stock in unique_etf_stocks:
            try:
                # 관련 데이터도 함께 삭제 (cascade로 자동 삭제됨)
                deleted_stocks.append({
                    "symbol": stock.symbol,
                    "name": stock.name
                })

                db.delete(stock)
                deleted_count += 1

            except Exception as e:
                logger.error(f"Error deleting stock {stock.symbol}: {str(e)}")
                continue

        # 커밋
        db.commit()

        logger.info(f"Successfully deleted {deleted_count} ETF/Index stocks")

        return {
            "deleted_count": deleted_count,
            "deleted_stocks": deleted_stocks,
            "message": f"Successfully deleted {deleted_count} ETF/Index stocks from database"
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Error during ETF cleanup: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/stocks/{stock_id}")
def delete_stock(stock_id: int, db: Session = Depends(get_db)):
    """
    종목과 관련된 모든 데이터를 완전 삭제
    """
    try:
        # 종목 존재 확인
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        # 해당 종목의 히스토리 데이터 삭제
        history_count = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id
        ).count()

        db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id
        ).delete()

        # 종목 데이터 삭제
        db.delete(stock)
        db.commit()

        logger.info(f"Deleted stock {stock.symbol} ({stock.name}) and {history_count} history records")

        return {
            "success": True,
            "message": f"종목 '{stock.name}({stock.symbol})'과 관련된 모든 데이터가 삭제되었습니다.",
            "deleted_history_count": history_count
        }

    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting stock {stock_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete stock: {str(e)}")

@app.post("/api/stocks/{stock_id}/favorite")
def add_to_favorites(stock_id: int, db: Session = Depends(get_db)):
    """
    종목을 즐겨찾기에 추가
    """
    try:
        # 종목 존재 확인
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        # 이미 즐겨찾기에 있는지 확인
        existing_favorite = db.query(StockFavorite).filter(StockFavorite.stock_id == stock_id).first()
        if existing_favorite:
            return {
                "success": True,
                "message": f"{stock.name} is already in favorites",
                "is_favorite": True
            }

        # 즐겨찾기 추가
        favorite = StockFavorite(stock_id=stock_id)
        db.add(favorite)
        db.commit()

        logger.info(f"Added stock {stock.symbol} ({stock.name}) to favorites")
        return {
            "success": True,
            "message": f"{stock.name} added to favorites successfully",
            "is_favorite": True
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Error adding stock {stock_id} to favorites: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add to favorites: {str(e)}")

@app.delete("/api/stocks/{stock_id}/favorite")
def remove_from_favorites(stock_id: int, db: Session = Depends(get_db)):
    """
    종목을 즐겨찾기에서 제거
    """
    try:
        # 종목 존재 확인
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        # 즐겨찾기에서 제거
        favorite = db.query(StockFavorite).filter(StockFavorite.stock_id == stock_id).first()
        if not favorite:
            return {
                "success": True,
                "message": f"{stock.name} is not in favorites",
                "is_favorite": False
            }

        db.delete(favorite)
        db.commit()

        logger.info(f"Removed stock {stock.symbol} ({stock.name}) from favorites")
        return {
            "success": True,
            "message": f"{stock.name} removed from favorites successfully",
            "is_favorite": False
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Error removing stock {stock_id} from favorites: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to remove from favorites: {str(e)}")

@app.get("/api/favorites")
def get_favorites(db: Session = Depends(get_db)):
    """
    즐겨찾기 목록 조회
    """
    try:
        favorites = db.query(StockFavorite).join(Stock).filter(Stock.is_active == True).order_by(StockFavorite.created_at.desc()).all()

        favorite_stocks = []
        for favorite in favorites:
            stock = favorite.stock

            # 히스토리 데이터 상태 확인
            history_count = db.query(StockPriceHistory).filter(StockPriceHistory.stock_id == stock.id).count()
            latest_history = db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock.id
            ).order_by(StockPriceHistory.date.desc()).first()

            # 90일 이동평균 대비 현재가 비율 계산
            ma90_percentage = None
            if stock.ma90_price and stock.current_price:
                ma90_percentage = ((stock.current_price - stock.ma90_price) / stock.ma90_price) * 100

            stock_data = {
                "id": stock.id,
                "symbol": stock.symbol,
                "name": stock.name,
                "market": stock.market,
                "exchange": stock.exchange,
                "current_price": stock.current_price,
                "change_amount": stock.change_amount,
                "change_percent": stock.change_percent,
                "market_cap": stock.market_cap,
                "trading_volume": stock.trading_volume,
                "foreign_ratio": stock.foreign_ratio,
                "per": stock.per,
                "roe": stock.roe,
                "market_cap_rank": stock.market_cap_rank,
                "history_records_count": history_count,
                "history_latest_date": latest_history.date.isoformat() if latest_history else None,
                "has_history_data": history_count > 0,
                "ma90_price": stock.ma90_price,
                "ma90_percentage": ma90_percentage,
                "is_favorite": True,
                "created_at": favorite.created_at,
                "favorited_at": favorite.created_at.isoformat()
            }
            favorite_stocks.append(stock_data)

        return {
            "total": len(favorite_stocks),
            "stocks": favorite_stocks
        }
    except Exception as e:
        logger.error(f"Error getting favorites: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get favorites: {str(e)}")

@app.post("/api/stocks/{stock_id}/dislike")
def add_to_dislikes(stock_id: int, db: Session = Depends(get_db)):
    """
    종목을 싫어요에 추가
    """
    try:
        # 종목 존재 확인
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        # 이미 싫어요에 있는지 확인
        existing_dislike = db.query(StockDislike).filter(StockDislike.stock_id == stock_id).first()
        if existing_dislike:
            return {
                "success": True,
                "message": f"{stock.name} is already in dislikes",
                "is_dislike": True
            }

        # 싫어요 추가
        dislike = StockDislike(stock_id=stock_id)
        db.add(dislike)
        db.commit()

        logger.info(f"Added stock {stock.symbol} ({stock.name}) to dislikes")
        return {
            "success": True,
            "message": f"{stock.name} added to dislikes successfully",
            "is_dislike": True
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Error adding stock {stock_id} to dislikes: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add to dislikes: {str(e)}")

@app.delete("/api/stocks/{stock_id}/dislike")
def remove_from_dislikes(stock_id: int, db: Session = Depends(get_db)):
    """
    종목을 싫어요에서 제거
    """
    try:
        # 종목 존재 확인
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        # 싫어요에서 제거
        dislike = db.query(StockDislike).filter(StockDislike.stock_id == stock_id).first()
        if not dislike:
            return {
                "success": True,
                "message": f"{stock.name} is not in dislikes",
                "is_dislike": False
            }

        db.delete(dislike)
        db.commit()

        logger.info(f"Removed stock {stock.symbol} ({stock.name}) from dislikes")
        return {
            "success": True,
            "message": f"{stock.name} removed from dislikes successfully",
            "is_dislike": False
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Error removing stock {stock_id} from dislikes: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to remove from dislikes: {str(e)}")

@app.get("/api/dislikes")
def get_dislikes(db: Session = Depends(get_db)):
    """
    싫어요 목록 조회
    """
    try:
        dislikes = db.query(StockDislike).join(Stock).filter(Stock.is_active == True).all()

        dislike_stocks = []
        for dislike in dislikes:
            stock = dislike.stock

            # 히스토리 데이터 상태 확인
            history_count = db.query(StockPriceHistory).filter(StockPriceHistory.stock_id == stock.id).count()
            latest_history = db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock.id
            ).order_by(StockPriceHistory.date.desc()).first()

            # 90일 이동평균 대비 현재가 비율 계산
            ma90_percentage = None
            if stock.ma90_price and stock.current_price:
                ma90_percentage = ((stock.current_price - stock.ma90_price) / stock.ma90_price) * 100

            stock_data = {
                "id": stock.id,
                "symbol": stock.symbol,
                "name": stock.name,
                "market": stock.market,
                "exchange": stock.exchange,
                "current_price": stock.current_price,
                "change_amount": stock.change_amount,
                "change_percent": stock.change_percent,
                "market_cap": stock.market_cap,
                "trading_volume": stock.trading_volume,
                "foreign_ratio": stock.foreign_ratio,
                "per": stock.per,
                "roe": stock.roe,
                "market_cap_rank": stock.market_cap_rank,
                "history_records_count": history_count,
                "history_latest_date": latest_history.date.isoformat() if latest_history else None,
                "has_history_data": history_count > 0,
                "ma90_price": stock.ma90_price,
                "ma90_percentage": ma90_percentage,
                "is_dislike": True,
                "created_at": dislike.created_at
            }
            dislike_stocks.append(stock_data)

        return {
            "total": len(dislike_stocks),
            "stocks": dislike_stocks
        }
    except Exception as e:
        logger.error(f"Error getting dislikes: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get dislikes: {str(e)}")

@app.post("/api/stocks/{stock_id}/analyze")
async def analyze_single_stock(
    stock_id: int,
    db: Session = Depends(get_db)
):
    """
    단일 종목 분석: 네이버에서 상세 정보 및 일별 가격 크롤링
    중복 데이터는 저장하지 않음
    """
    try:
        # 종목 조회
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        logger.info(f"Analyzing stock: {stock.symbol} ({stock.name})")

        # 크롤러 초기화
        from app.crawlers.naver_us_crawler import NaverUSStockCrawler
        crawler = NaverUSStockCrawler()

        # 종목 분석 실행
        # US 주식은 sector 필드에 reuters_code (예: NVDA.O)가 저장되어 있음
        symbol_to_use = stock.sector if stock.market == "US" and stock.sector else stock.symbol
        result = crawler.analyze_single_stock(symbol_to_use)

        if not result['success']:
            raise HTTPException(status_code=500, detail=result['message'])

        stats = {
            'new_records': 0,
            'duplicate_records': 0,
            'updated_overview': False
        }

        # Overview 정보 업데이트
        if result['overview']:
            overview = result['overview']
            stock.current_price = overview.get('current_price', stock.current_price)
            stock.change_amount = overview.get('change_amount', stock.change_amount)
            stock.change_percent = overview.get('change_percent', stock.change_percent)
            stock.previous_close = overview.get('previous_close', stock.previous_close)
            stock.market_cap = overview.get('market_cap', stock.market_cap)
            stock.trading_volume = overview.get('volume', stock.trading_volume)
            stock.updated_at = datetime.utcnow()
            stats['updated_overview'] = True
            logger.info(f"Updated overview for {stock.symbol}")

        # 가격 히스토리 저장 (중복 체크)
        if result['price_history']:
            for price_data in result['price_history']:
                try:
                    price_date = datetime.strptime(price_data['date'], '%Y%m%d').date()

                    # 중복 체크
                    existing_record = db.query(StockPriceHistory).filter(
                        StockPriceHistory.stock_id == stock.id,
                        StockPriceHistory.date == price_date
                    ).first()

                    if existing_record:
                        stats['duplicate_records'] += 1
                        continue

                    # 새 레코드 생성
                    price_history = StockPriceHistory(
                        stock_id=stock.id,
                        date=price_date,
                        open_price=price_data['open_price'],
                        high_price=price_data['high_price'],
                        low_price=price_data['low_price'],
                        close_price=price_data['close_price'],
                        volume=price_data['volume']
                    )
                    db.add(price_history)
                    stats['new_records'] += 1

                except Exception as e:
                    logger.error(f"Error saving price record: {e}")
                    continue

        db.commit()

        # 최신 갱신 날짜 조회
        latest_record = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock.id
        ).order_by(StockPriceHistory.date.desc()).first()

        return {
            "success": True,
            "stock_id": stock.id,
            "symbol": stock.symbol,
            "name": stock.name,
            "stats": stats,
            "latest_update_date": latest_record.date.isoformat() if latest_record else None,
            "total_records": db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock.id
            ).count(),
            "message": f"Successfully analyzed {stock.symbol}"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing stock {stock_id}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to analyze stock: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
