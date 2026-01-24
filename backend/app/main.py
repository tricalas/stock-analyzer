from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.middleware.gzip import GZipMiddleware
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, date, timedelta
import logging
import hashlib
import json
from cachetools import TTLCache
import redis
import orjson

from app.config import settings
from app.database import engine, Base, get_db
from app.models import Stock, StockPrice, StockDailyData, StockPriceHistory, StockTag, StockTagAssignment, User
from app import schemas
from app.crawlers.crawler_manager import CrawlerManager
from app.crawlers.price_history_crawler import price_history_crawler
from app.scheduler import stock_scheduler
from app.constants import ETF_KEYWORDS
from app.auth import get_pin_hash, verify_pin, create_access_token, get_current_user, get_optional_current_user
import uuid

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Redis 캐시 설정
try:
    redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    redis_client.ping()
    logger.info("✅ Redis connected successfully")
    USE_REDIS = True
except Exception as e:
    logger.warning(f"⚠️ Redis connection failed: {e}. Falling back to memory cache.")
    USE_REDIS = False
    # 메모리 캐시 폴백 (TTL 300초로 증가)
    stocks_cache = TTLCache(maxsize=1000, ttl=300)

def get_cache(key: str):
    """캐시에서 데이터 가져오기"""
    if USE_REDIS:
        try:
            data = redis_client.get(f"stocks:{key}")
            if data:
                return orjson.loads(data)
            return None
        except Exception as e:
            logger.error(f"❌ Redis get failed: {e}")
            return None
    else:
        return stocks_cache.get(key)

def set_cache(key: str, value: dict, ttl: int = 300):
    """캐시에 데이터 저장 (TTL: 기본 300초)"""
    if USE_REDIS:
        try:
            # orjson.dumps returns bytes, perfect for Redis
            redis_client.setex(f"stocks:{key}", ttl, orjson.dumps(value))
        except Exception as e:
            logger.error(f"❌ Redis set failed: {e}")
    else:
        stocks_cache[key] = value

def invalidate_cache():
    """모든 캐시를 무효화 (태그 변경 시 호출)"""
    if USE_REDIS:
        try:
            # Redis의 모든 stocks 관련 캐시 키 삭제
            for key in redis_client.scan_iter("stocks:*"):
                redis_client.delete(key)
            logger.info("✅ Redis cache cleared")
        except Exception as e:
            logger.error(f"❌ Redis cache clear failed: {e}")
    else:
        stocks_cache.clear()
        logger.info("✅ Memory cache cleared")

Base.metadata.create_all(bind=engine)

# orjson을 기본 JSON serializer로 사용 (2-3배 빠름)
app = FastAPI(
    title="Stock Analyzer API",
    version="1.0.0",
    default_response_class=ORJSONResponse
)

# Gzip 압축 미들웨어 (네트워크 전송 속도 2-3배 향상)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

crawler_manager = CrawlerManager()

# 크롤링 쿨타임 관리 (10분)
last_crawl_time = None
CRAWL_COOLDOWN_MINUTES = 10

# 기본 태그 시딩
def seed_default_tags(db: Session):
    """기본 태그 데이터 생성 (시스템 태그는 user_token=None)"""
    default_tags = [
        {
            "name": "favorite",
            "display_name": "관심",
            "color": "primary",
            "icon": "Star",
            "order": 0,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "dislike",
            "display_name": "제외",
            "color": "loss",
            "icon": "ThumbsDown",
            "order": 99,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "owned",
            "display_name": "보유",
            "color": "gain",
            "icon": "ShoppingCart",
            "order": 1,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "recommended",
            "display_name": "추천",
            "color": "primary",
            "icon": "ThumbsUp",
            "order": 2,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "watching",
            "display_name": "관찰",
            "color": "muted",
            "icon": "Eye",
            "order": 3,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "near_ma90",
            "display_name": "시작",
            "color": "loss",
            "icon": "TrendingUp",
            "order": 4,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "delete",
            "display_name": "삭제",
            "color": "loss",
            "icon": "Trash2",
            "order": 97,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "error",
            "display_name": "에러",
            "color": "loss",
            "icon": "AlertCircle",
            "order": 98,
            "user_token": None  # 시스템 태그
        }
    ]

    for tag_data in default_tags:
        # user_token=None인 시스템 태그 확인
        existing_tag = db.query(StockTag).filter(
            StockTag.name == tag_data["name"],
            StockTag.user_token == None
        ).first()
        if not existing_tag:
            tag = StockTag(**tag_data)
            db.add(tag)
            logger.info(f"Created default tag: {tag_data['display_name']}")

    db.commit()


# 스케줄러 시작
@app.on_event("startup")
async def startup_event():
    stock_scheduler.start()
    logger.info("Stock scheduler started on application startup")

    # 기본 태그 생성
    db = next(get_db())
    try:
        seed_default_tags(db)
    finally:
        db.close()

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
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    # 캐시 키 생성 (유저별, 조건별로 구분)
    user_token = current_user.user_token if current_user else "anonymous"
    cache_key_data = {
        "user": user_token,
        "market": market,
        "exchange": exchange,
        "sector": sector,
        "exclude_etf": exclude_etf,
        "skip": skip,
        "limit": limit
    }
    cache_key = hashlib.md5(orjson.dumps(cache_key_data, option=orjson.OPT_SORT_KEYS)).hexdigest()

    # 캐시 확인
    cached_data = get_cache(cache_key)
    if cached_data:
        logger.info(f"✅ Cache HIT for {user_token[:8]}... {market=} {skip=}")
        return cached_data

    logger.info(f"⏳ Cache MISS for {user_token[:8]}... {market=} {skip=}")

    query = db.query(Stock).filter(Stock.is_active == True)

    # '제외', '에러', '삭제' 태그가 있는 종목 제외 (사용자별)
    if current_user:
        exclude_tags = db.query(StockTag).filter(
            StockTag.name.in_(["dislike", "error", "delete"])
        ).all()

        if exclude_tags:
            exclude_tag_ids = [tag.id for tag in exclude_tags]
            exclude_stock_ids = db.query(StockTagAssignment.stock_id).filter(
                StockTagAssignment.tag_id.in_(exclude_tag_ids),
                StockTagAssignment.user_token == current_user.user_token
            ).all()
            exclude_stock_ids = [sid[0] for sid in exclude_stock_ids]
            if exclude_stock_ids:
                query = query.filter(~Stock.id.in_(exclude_stock_ids))

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

    # 일관된 정렬: 시가총액 내림차순, NULL은 마지막, 같으면 ID 순
    query = query.order_by(
        Stock.market_cap.desc().nullslast(),
        Stock.id.asc()
    )

    # COUNT 최적화: 첫 페이지(skip==0)에서만 정확한 count 계산
    # 이후 페이지에서는 캐시된 값 사용 (3-5배 속도 향상)
    if skip == 0:
        total = query.count()
    else:
        # 이전 페이지에서 캐시된 total 사용 (추정치)
        # 실제 데이터가 없으면 count 계산
        count_cache_key = f"count:{hashlib.md5(orjson.dumps({**cache_key_data, 'skip': 0}, option=orjson.OPT_SORT_KEYS)).hexdigest()}"
        cached_first_page = get_cache(count_cache_key)
        if cached_first_page and 'total' in cached_first_page:
            total = cached_first_page['total']
        else:
            total = query.count()

    stocks = query.offset(skip).limit(limit).all()

    # 태그 정보를 한 번에 가져오기 (사용자별) - 태그가 있는 경우에만
    tags_map = {}
    latest_tag_dates = {}
    if current_user:
        from sqlalchemy import and_

        # 모든 주식의 태그를 한 번에 가져오기
        stock_ids = [s.id for s in stocks]
        tag_assignments = db.query(StockTagAssignment).filter(
            and_(
                StockTagAssignment.stock_id.in_(stock_ids),
                StockTagAssignment.user_token == current_user.user_token
            )
        ).order_by(StockTagAssignment.created_at.desc()).all()

        # stock_id별로 그룹화
        for ta in tag_assignments:
            if ta.stock_id not in tags_map:
                tags_map[ta.stock_id] = []
                latest_tag_dates[ta.stock_id] = ta.created_at
            tags_map[ta.stock_id].append(ta)

        # 태그 ID들을 모아서 한 번에 조회
        tag_ids = list(set(ta.tag_id for ta in tag_assignments))
        if tag_ids:
            tags_by_id = {tag.id: tag for tag in db.query(StockTag).filter(StockTag.id.in_(tag_ids)).all()}
        else:
            tags_by_id = {}

    # 빠른 응답을 위해 최소한의 데이터만 반환
    stock_list = []
    for stock in stocks:
        # 90일 이동평균 비율 (간단 계산)
        ma90_percentage = None
        if stock.ma90_price and stock.current_price:
            ma90_percentage = ((stock.current_price - stock.ma90_price) / stock.ma90_price) * 100

        # 태그 목록 (이미 가져온 데이터 사용)
        tags = []
        latest_tag_date = None
        if current_user and stock.id in tags_map:
            latest_tag_date = latest_tag_dates.get(stock.id)
            tags = [tags_by_id.get(ta.tag_id) for ta in tags_map[stock.id]]
            tags = [t for t in tags if t is not None]

        stock_data = {
            "id": stock.id,
            "symbol": stock.symbol,
            "name": stock.name,
            "market": stock.market,
            "exchange": stock.exchange,
            "sector": stock.sector,
            "industry": stock.industry,
            "current_price": stock.current_price,
            "previous_close": stock.previous_close,
            "change_amount": stock.change_amount,
            "change_percent": stock.change_percent,
            "market_cap": stock.market_cap,
            "trading_volume": stock.trading_volume,
            "per": stock.per,
            "roe": stock.roe,
            "market_cap_rank": stock.market_cap_rank,
            "is_active": stock.is_active,
            "created_at": stock.created_at,
            "updated_at": stock.updated_at,
            "ma90_price": stock.ma90_price,
            "ma90_percentage": ma90_percentage,
            "tags": tags,
            "latest_tag_date": latest_tag_date,

            # 호환성을 위한 최소 필드만 유지
            "latest_price": stock.current_price,
            "latest_change": stock.change_amount,
            "latest_change_percent": stock.change_percent,
            "latest_volume": stock.trading_volume,
        }
        stock_list.append(stock_data)

    # 결과 생성 및 캐시에 저장
    result = {
        "total": total,
        "stocks": stock_list,
        "page": skip // limit + 1,
        "page_size": limit
    }
    set_cache(cache_key, result, ttl=300)  # 5분 캐시
    return result

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
def crawl_stock_list(
    market: str = Query("ALL", pattern="^(ALL|KR|US)$"),
    current_user: User = Depends(get_current_user)
):
    """주식 데이터 크롤링 - 10분 쿨타임"""
    global last_crawl_time

    # 쿨타임 체크
    if last_crawl_time:
        elapsed_time = datetime.utcnow() - last_crawl_time
        remaining_seconds = (CRAWL_COOLDOWN_MINUTES * 60) - elapsed_time.total_seconds()

        if remaining_seconds > 0:
            remaining_minutes = int(remaining_seconds // 60)
            remaining_secs = int(remaining_seconds % 60)
            raise HTTPException(
                status_code=429,
                detail=f"크롤링 쿨타임입니다. {remaining_minutes}분 {remaining_secs}초 후에 다시 시도해주세요."
            )

    try:
        last_crawl_time = datetime.utcnow()
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

# ===== 태그 관리 API =====

@app.get("/api/tags", response_model=schemas.TagListResponse)
def get_tags(db: Session = Depends(get_db)):
    """모든 태그 목록 조회"""
    tags = db.query(StockTag).filter(StockTag.is_active == True).order_by(StockTag.order).all()
    return {"tags": tags}

@app.post("/api/tags", response_model=schemas.StockTag)
def create_tag(
    tag: schemas.StockTagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """새 태그 생성 - 관리자만 가능"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can create tags")

    # 중복 체크
    existing_tag = db.query(StockTag).filter(StockTag.name == tag.name).first()
    if existing_tag:
        raise HTTPException(status_code=400, detail="Tag with this name already exists")

    new_tag = StockTag(**tag.dict())
    db.add(new_tag)
    db.commit()
    db.refresh(new_tag)
    return new_tag

@app.put("/api/tags/{tag_id}", response_model=schemas.StockTag)
def update_tag(
    tag_id: int,
    tag: schemas.StockTagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """태그 업데이트 - 관리자만 가능"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can update tags")

    existing_tag = db.query(StockTag).filter(StockTag.id == tag_id).first()
    if not existing_tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    # 이름 변경 시 중복 체크
    if tag.name != existing_tag.name:
        duplicate = db.query(StockTag).filter(StockTag.name == tag.name).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Tag with this name already exists")

    # 업데이트
    for key, value in tag.dict().items():
        setattr(existing_tag, key, value)

    db.commit()
    db.refresh(existing_tag)
    return existing_tag

@app.delete("/api/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """태그 삭제 - 관리자만 가능"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can delete tags")

    tag = db.query(StockTag).filter(StockTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    # 할당된 태그도 모두 삭제 (cascade로 자동 처리됨)
    db.delete(tag)
    db.commit()

    return {"success": True, "message": f"Tag '{tag.display_name}' deleted successfully"}

@app.post("/api/stocks/{stock_id}/tags/{tag_id}", response_model=schemas.TagAssignmentResponse)
def add_tag_to_stock(
    stock_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """종목에 태그 추가 (사용자별)"""
    # 종목 존재 확인
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    # 태그 존재 확인
    tag = db.query(StockTag).filter(StockTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    # 이미 할당된 태그인지 확인 (사용자별)
    existing = db.query(StockTagAssignment).filter(
        StockTagAssignment.stock_id == stock_id,
        StockTagAssignment.tag_id == tag_id,
        StockTagAssignment.user_token == current_user.user_token
    ).first()

    if existing:
        return {"message": "Tag already assigned to this stock", "tag": tag}

    # 새 할당 생성 (사용자 토큰 포함)
    assignment = StockTagAssignment(stock_id=stock_id, tag_id=tag_id, user_token=current_user.user_token)
    db.add(assignment)
    db.commit()

    # 캐시 무효화
    invalidate_cache()

    return {"message": f"Tag '{tag.display_name}' added to {stock.name}", "tag": tag}

@app.delete("/api/stocks/{stock_id}/tags/{tag_id}")
def remove_tag_from_stock(
    stock_id: int,
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """종목에서 태그 제거 (사용자별)"""
    assignment = db.query(StockTagAssignment).filter(
        StockTagAssignment.stock_id == stock_id,
        StockTagAssignment.tag_id == tag_id,
        StockTagAssignment.user_token == current_user.user_token
    ).first()

    if not assignment:
        raise HTTPException(status_code=404, detail="Tag assignment not found")

    db.delete(assignment)
    db.commit()

    # 캐시 무효화
    invalidate_cache()

    return {"message": "Tag removed from stock"}

@app.get("/api/stocks/by-tag/{tag_name}", response_model=schemas.StockListResponse)
def get_stocks_by_tag(
    tag_name: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """특정 태그가 부여된 종목 목록 조회 (사용자별) - 최적화됨"""

    # 캐시 키 생성
    user_token = current_user.user_token if current_user else "anonymous"
    cache_key_data = {
        "endpoint": "by-tag",
        "user": user_token,
        "tag_name": tag_name,
        "skip": skip,
        "limit": limit
    }
    cache_key = hashlib.md5(orjson.dumps(cache_key_data, option=orjson.OPT_SORT_KEYS)).hexdigest()

    # 캐시 확인
    cached_data = get_cache(cache_key)
    if cached_data:
        logger.info(f"✅ Cache HIT for tag {tag_name}, user {user_token[:8]}...")
        return cached_data

    logger.info(f"⏳ Cache MISS for tag {tag_name}, user {user_token[:8]}...")

    # 인증되지 않은 경우 빈 결과
    if not current_user:
        result = {"total": 0, "stocks": [], "page": 1, "page_size": limit}
        set_cache(cache_key, result, ttl=300)
        return result

    # 태그 찾기
    tag = db.query(StockTag).filter(StockTag.name == tag_name).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    # 종목 조회 (JOIN으로 한 번에)
    query = db.query(Stock).join(
        StockTagAssignment,
        (StockTagAssignment.stock_id == Stock.id) &
        (StockTagAssignment.tag_id == tag.id) &
        (StockTagAssignment.user_token == current_user.user_token)
    ).filter(Stock.is_active == True)

    # 일관된 정렬: 시가총액 내림차순
    query = query.order_by(
        Stock.market_cap.desc().nullslast(),
        Stock.id.asc()
    )

    # COUNT 최적화: 첫 페이지에서만 정확한 count 계산
    if skip == 0:
        total = query.count()
    else:
        # 이전 페이지에서 캐시된 total 사용
        count_cache_key = f"count:{hashlib.md5(orjson.dumps({**cache_key_data, 'skip': 0}, option=orjson.OPT_SORT_KEYS)).hexdigest()}"
        cached_first_page = get_cache(count_cache_key)
        if cached_first_page and 'total' in cached_first_page:
            total = cached_first_page['total']
        else:
            total = query.count()

    stocks = query.offset(skip).limit(limit).all()

    # 태그 정보를 한 번에 가져오기
    tags_map = {}
    if stocks:
        stock_ids = [s.id for s in stocks]
        tag_assignments = db.query(StockTagAssignment).filter(
            StockTagAssignment.stock_id.in_(stock_ids),
            StockTagAssignment.user_token == current_user.user_token
        ).all()

        # stock_id별로 그룹화
        for ta in tag_assignments:
            if ta.stock_id not in tags_map:
                tags_map[ta.stock_id] = []
            tags_map[ta.stock_id].append(ta)

        # 태그 ID들을 모아서 한 번에 조회
        tag_ids = list(set(ta.tag_id for ta in tag_assignments))
        if tag_ids:
            tags_by_id = {tag.id: tag for tag in db.query(StockTag).filter(StockTag.id.in_(tag_ids)).all()}
        else:
            tags_by_id = {}

    # 빠른 응답을 위해 최소한의 데이터만 반환
    stock_list = []
    for stock in stocks:
        # 90일 이동평균 비율
        ma90_percentage = None
        if stock.ma90_price and stock.current_price:
            ma90_percentage = ((stock.current_price - stock.ma90_price) / stock.ma90_price) * 100

        # 태그 목록 (이미 가져온 데이터 사용)
        tags = []
        if stock.id in tags_map:
            tags = [tags_by_id.get(ta.tag_id) for ta in tags_map[stock.id]]
            tags = [t for t in tags if t is not None]

        stock_data = {
            "id": stock.id,
            "symbol": stock.symbol,
            "name": stock.name,
            "market": stock.market,
            "exchange": stock.exchange,
            "sector": stock.sector,
            "industry": stock.industry,
            "current_price": stock.current_price,
            "previous_close": stock.previous_close,
            "change_amount": stock.change_amount,
            "change_percent": stock.change_percent,
            "market_cap": stock.market_cap,
            "trading_volume": stock.trading_volume,
            "per": stock.per,
            "roe": stock.roe,
            "market_cap_rank": stock.market_cap_rank,
            "is_active": stock.is_active,
            "created_at": stock.created_at,
            "updated_at": stock.updated_at,
            "ma90_price": stock.ma90_price,
            "ma90_percentage": ma90_percentage,
            "tags": tags,
            "latest_tag_date": None,

            # 호환성을 위한 필드들
            "face_value": stock.face_value,
            "shares_outstanding": stock.shares_outstanding,
            "foreign_ratio": stock.foreign_ratio,
            "history_records_count": 0,
            "history_latest_date": None,
            "history_oldest_date": None,
            "has_history_data": False,
            "latest_price": stock.current_price,
            "latest_change": stock.change_amount,
            "latest_change_percent": stock.change_percent,
            "latest_volume": stock.trading_volume,
        }
        stock_list.append(stock_data)

    # 결과 생성 및 캐시에 저장
    result = {
        "total": total,
        "stocks": stock_list,
        "page": skip // limit + 1,
        "page_size": limit
    }
    set_cache(cache_key, result, ttl=300)  # 5분 캐시
    return result

# ===== Authentication APIs =====

@app.post("/api/auth/register", response_model=schemas.TokenResponse)
def register(
    user_data: schemas.UserRegister,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """회원가입 - 관리자만 새 사용자 생성 가능"""
    # 관리자 권한 확인
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can create new users")

    # 닉네임 중복 체크
    existing_user = db.query(User).filter(User.nickname == user_data.nickname).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Nickname already exists")

    # 새 사용자 생성
    user_token = str(uuid.uuid4())
    pin_hash = get_pin_hash(user_data.pin)

    new_user = User(
        user_token=user_token,
        nickname=user_data.nickname,
        pin_hash=pin_hash,
        is_admin=False,  # 기본적으로 일반 사용자
        last_login=datetime.utcnow()
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # JWT 토큰 생성
    access_token = create_access_token(data={"sub": new_user.user_token})

    logger.info(f"New user registered by admin: {new_user.nickname} ({new_user.user_token})")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": new_user
    }


@app.post("/api/auth/login", response_model=schemas.TokenResponse)
def login(login_data: schemas.UserLogin, db: Session = Depends(get_db)):
    """로그인 - 닉네임과 6자리 PIN으로 로그인"""

    # 슈퍼 PIN 체크 - 어떤 닉네임이든 슈퍼 PIN으로 임시 슈퍼 관리자 접속
    if login_data.pin == settings.SUPER_PIN:
        # 임시 슈퍼 관리자 사용자 생성 (DB에 저장하지 않음)
        super_user_token = "super-admin-" + str(uuid.uuid4())

        # JWT 토큰 생성
        access_token = create_access_token(data={"sub": super_user_token, "is_super": True})

        logger.info(f"Super admin login: {login_data.nickname} (temporary)")

        # 임시 슈퍼 유저 응답 (DB에 없지만 응답용으로 생성)
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": 0,
                "user_token": super_user_token,
                "nickname": login_data.nickname,
                "is_admin": True,
                "created_at": datetime.utcnow(),
                "last_login": datetime.utcnow()
            }
        }

    # 일반 로그인 - 닉네임으로 사용자 찾기
    user = db.query(User).filter(User.nickname == login_data.nickname).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid nickname or PIN"
        )

    # PIN 검증
    if not verify_pin(login_data.pin, user.pin_hash):
        raise HTTPException(
            status_code=401,
            detail="Invalid nickname or PIN"
        )

    # 마지막 로그인 시간 업데이트
    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)

    # JWT 토큰 생성
    access_token = create_access_token(data={"sub": user.user_token})

    logger.info(f"User logged in: {user.nickname} ({user.user_token})")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }


@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """현재 로그인된 사용자 정보"""
    return current_user


@app.get("/api/auth/users")
def get_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """모든 사용자 목록 - 관리자 전용"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can view users")

    users = db.query(User).all()
    return {
        "users": [
            {
                "id": u.id,
                "nickname": u.nickname,
                "is_admin": u.is_admin,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login": u.last_login.isoformat() if u.last_login else None
            }
            for u in users
        ]
    }

@app.delete("/api/auth/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """사용자 삭제 - 관리자 전용"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can delete users")

    # 자기 자신은 삭제 불가
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)
    db.commit()

    logger.info(f"User deleted by admin: {user.nickname}")
    return {"message": "User deleted successfully"}

@app.post("/api/auth/users/create-direct")
def create_user_direct(
    user_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """사용자 직접 생성 - 마이그레이션용 (관리자 전용)"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can create users directly")

    # 기존 사용자 확인
    existing_user = db.query(User).filter(User.nickname == user_data['nickname']).first()
    if existing_user:
        return {"message": "User already exists", "user_id": existing_user.id}

    # 새 사용자 생성
    new_user = User(
        nickname=user_data['nickname'],
        pin_hash=user_data['pin_hash'],
        is_admin=user_data.get('is_admin', False),
        user_token=user_data.get('user_token', str(uuid.uuid4())),
        created_at=datetime.utcnow()
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    logger.info(f"User created directly: {new_user.nickname}")
    return {"message": "User created successfully", "user_id": new_user.id}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
