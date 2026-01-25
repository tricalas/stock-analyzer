from fastapi import FastAPI, Depends, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.middleware.gzip import GZipMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc, case, text
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
from app.models import Stock, StockPrice, StockDailyData, StockPriceHistory, StockTag, StockTagAssignment, User, StockSignal, TaskProgress, HistoryCollectionLog
from app import schemas
from app.crawlers.crawler_manager import CrawlerManager
from app.crawlers.price_history_crawler import price_history_crawler
from app.scheduler import stock_scheduler
from app.constants import ETF_KEYWORDS
from app.auth import get_pin_hash, verify_pin, create_access_token, get_current_user, get_optional_current_user
from app.signal_analyzer import signal_analyzer
from app.tasks import collect_history_task, analyze_signals_task, retry_failed_stocks_task
from app.celery_app import celery_app
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
            # OPT_SERIALIZE_NUMPY handles numpy types, OPT_PASSTHROUGH_DATETIME handles datetime
            redis_client.setex(f"stocks:{key}", ttl, orjson.dumps(value, default=str))
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

# 서버 시작 시 캐시 클리어 (배포 후 새 데이터 반영)
@app.on_event("startup")
async def startup_event():
    invalidate_cache()
    logger.info("🚀 Server started, cache cleared")

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
            "name": "error",
            "display_name": "에러",
            "color": "loss",
            "icon": "AlertCircle",
            "order": 98,
            "user_token": None  # 시스템 태그
        }
    ]

    # 태그가 하나도 없을 때만 기본 태그 생성 (최초 1회)
    existing_tags_count = db.query(StockTag).count()
    if existing_tags_count > 0:
        logger.info(f"Tags already exist ({existing_tags_count}), skipping seed")
        return

    for tag_data in default_tags:
        tag = StockTag(**tag_data)
        db.add(tag)
        logger.info(f"Created default tag: {tag_data['display_name']}")

    db.commit()
    logger.info("Default tags seeded successfully")


# 스케줄러 시작
@app.on_event("startup")
async def startup_event():
    stock_scheduler.start()
    logger.info("Stock scheduler started on application startup")

    # DB 마이그레이션 (누락 컬럼 추가)
    db = next(get_db())
    try:
        from sqlalchemy import text
        db.execute(text('ALTER TABLE stocks ADD COLUMN IF NOT EXISTS history_updated_at TIMESTAMP'))
        db.execute(text('ALTER TABLE stocks ADD COLUMN IF NOT EXISTS signal_analyzed_at TIMESTAMP'))
        db.commit()
        logger.info("DB migration completed")
    except Exception as e:
        logger.warning(f"DB migration skipped: {e}")
        db.rollback()

    # 기본 태그 생성
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
    order_by: Optional[str] = Query("market_cap", description="Sort field (market_cap, change_percent)"),
    order_dir: Optional[str] = Query("desc", description="Sort direction (asc, desc)"),
    nocache: bool = Query(False, description="Skip cache and fetch fresh data"),
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
        "limit": limit,
        "order_by": order_by,
        "order_dir": order_dir
    }
    cache_key = hashlib.md5(orjson.dumps(cache_key_data, option=orjson.OPT_SORT_KEYS)).hexdigest()

    # 캐시 확인 (nocache=true면 스킵)
    if not nocache:
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

    # 동적 정렬: order_by, order_dir 파라미터 기반
    # 동일 값일 때 일관된 정렬을 위해 보조 키 추가
    if order_by == "change_percent":
        if order_dir == "asc":
            query = query.order_by(
                Stock.change_percent.asc().nullslast(),
                Stock.market_cap.desc().nullslast(),
                Stock.id.asc()
            )
        else:
            query = query.order_by(
                Stock.change_percent.desc().nullslast(),
                Stock.market_cap.desc().nullslast(),
                Stock.id.asc()
            )
    else:
        # 기본: 시가총액순
        if order_dir == "asc":
            query = query.order_by(
                Stock.market_cap.asc().nullslast(),
                Stock.id.asc()
            )
        else:
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
    tags_by_id = {}
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

        # 태그 목록 (이미 가져온 데이터 사용) - 딕셔너리로 변환
        tags = []
        latest_tag_date = None
        if current_user and stock.id in tags_map:
            latest_tag_date = latest_tag_dates.get(stock.id)
            for ta in tags_map[stock.id]:
                tag_obj = tags_by_id.get(ta.tag_id)
                if tag_obj:
                    tags.append({
                        "id": tag_obj.id,
                        "name": tag_obj.name,
                        "display_name": tag_obj.display_name,
                        "color": tag_obj.color,
                        "icon": tag_obj.icon,
                        "order": tag_obj.order,
                    })

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

            # 히스토리 데이터 상태
            "history_records_count": stock.history_records_count or 0,
            "has_history_data": (stock.history_records_count or 0) > 0,

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

@app.get("/api/stocks/search", response_model=schemas.StockListResponse)
def search_stocks(
    q: str = Query(..., min_length=1, description="Search query (name or symbol)"),
    market: Optional[str] = Query(None, description="Filter by market (KR, US)"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """종목 검색 API - 종목명 또는 심볼로 검색 (자동완성용)"""
    # 캐시 키 생성
    user_token = current_user.user_token if current_user else "anonymous"
    cache_key_data = {
        "endpoint": "search",
        "user": user_token,
        "q": q.lower(),
        "market": market,
        "limit": limit
    }
    cache_key = hashlib.md5(orjson.dumps(cache_key_data, option=orjson.OPT_SORT_KEYS)).hexdigest()

    # 캐시 확인
    cached_data = get_cache(cache_key)
    if cached_data:
        logger.info(f"✅ Search cache HIT for '{q}'")
        return cached_data

    logger.info(f"⏳ Search cache MISS for '{q}'")

    # 검색 쿼리 구성
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

    # 종목명 또는 심볼로 검색 (대소문자 구분 없음)
    search_filter = (
        Stock.name.ilike(f'%{q}%') |
        Stock.symbol.ilike(f'%{q}%')
    )
    query = query.filter(search_filter)

    # 마켓 필터
    if market:
        query = query.filter(Stock.market == market)

    # 시가총액 내림차순 정렬 (검색 결과에서도 큰 기업이 먼저)
    query = query.order_by(
        Stock.market_cap.desc().nullslast(),
        Stock.id.asc()
    )

    # 제한된 수만 가져오기 (자동완성용)
    stocks = query.limit(limit).all()
    total = len(stocks)

    # 태그 정보를 한 번에 가져오기 (사용자별)
    tags_map = {}
    tags_by_id = {}
    latest_tag_dates = {}
    if current_user and stocks:
        from sqlalchemy import and_

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

    # 검색 결과 구성
    stock_list = []
    for stock in stocks:
        # 90일 이동평균 비율
        ma90_percentage = None
        if stock.ma90_price and stock.current_price:
            ma90_percentage = ((stock.current_price - stock.ma90_price) / stock.ma90_price) * 100

        # 태그 목록 - 딕셔너리로 변환
        tags = []
        latest_tag_date = None
        if current_user and stock.id in tags_map:
            latest_tag_date = latest_tag_dates.get(stock.id)
            for ta in tags_map[stock.id]:
                tag_obj = tags_by_id.get(ta.tag_id)
                if tag_obj:
                    tags.append({
                        "id": tag_obj.id,
                        "name": tag_obj.name,
                        "display_name": tag_obj.display_name,
                        "color": tag_obj.color,
                        "icon": tag_obj.icon,
                        "order": tag_obj.order,
                    })

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

            # 히스토리 데이터 상태
            "history_records_count": stock.history_records_count or 0,
            "has_history_data": (stock.history_records_count or 0) > 0,

            # 호환성을 위한 최소 필드
            "latest_price": stock.current_price,
            "latest_change": stock.change_amount,
            "latest_change_percent": stock.change_percent,
            "latest_volume": stock.trading_volume,
        }
        stock_list.append(stock_data)

    # 결과 생성 및 캐시에 저장 (검색은 1분 캐시)
    result = {
        "total": total,
        "stocks": stock_list,
        "page": 1,
        "page_size": limit
    }
    set_cache(cache_key, result, ttl=60)  # 1분 캐시
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

def run_background_crawl(market: str):
    """백그라운드에서 실행될 크롤링 작업"""
    try:
        logger.info(f"Starting background crawl for market: {market}")
        result = crawler_manager.update_stock_list(market)

        # ETF 필터링 정보 포함한 메시지 생성
        etf_info = ""
        if result.get('skipped_etf', 0) > 0:
            etf_info = f" ({result['skipped_etf']} ETF/Index stocks filtered out)"

        logger.info(f"Background crawl completed: {result['success']} out of {result['total']} stocks{etf_info}")

        # 캐시 무효화
        if redis_client:
            try:
                # 모든 stocks 관련 캐시 삭제
                for key in redis_client.scan_iter("cache:*stocks*"):
                    redis_client.delete(key)
                logger.info("Cache invalidated after crawling")
            except Exception as e:
                logger.error(f"Failed to invalidate cache: {e}")

    except Exception as e:
        logger.error(f"Error during background stock list crawling: {str(e)}")


@app.post("/api/crawl/stocks", response_model=schemas.CrawlingStatus)
def crawl_stock_list(
    background_tasks: BackgroundTasks,
    market: str = Query("ALL", pattern="^(ALL|KR|US)$"),
    current_user: User = Depends(get_current_user)
):
    """주식 데이터 크롤링 - 10분 쿨타임 (백그라운드 처리)"""
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

    # 쿨타임 업데이트
    last_crawl_time = datetime.utcnow()

    # 백그라운드 작업 추가
    background_tasks.add_task(run_background_crawl, market)

    # 즉시 응답 반환
    return {
        "success": 0,
        "failed": 0,
        "total": 0,
        "skipped_etf": 0,
        "message": f"크롤링 작업이 시작되었습니다. 완료까지 약 20초 소요됩니다."
    }


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

@app.post("/api/scheduler/trigger-history")
def trigger_manual_history_collection(
    background_tasks: BackgroundTasks,
    days: int = Query(100, ge=1, le=365, description="Number of days to collect")
):
    """수동으로 히스토리 수집 실행 (백그라운드 작업)"""
    def run_collection():
        try:
            logger.info(f"🚀 Background history collection started ({days} days)...")
            result = stock_scheduler.trigger_manual_history_collection(days=days)
            logger.info(f"✅ Background history collection completed: {result}")
        except Exception as e:
            logger.error(f"❌ Error in background history collection: {str(e)}")

    background_tasks.add_task(run_collection)

    return {
        "success": True,
        "message": f"히스토리 수집 작업이 시작되었습니다 ({days}일치 데이터)",
        "days": days,
        "mode": settings.HISTORY_COLLECTION_MODE,
        "note": "Check Railway logs for progress"
    }

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

@app.post("/api/stocks/{stock_id}/sync-history")
def sync_stock_history(
    stock_id: int,
    days: int = Query(100, ge=1, le=365, description="수집할 일수 (전체 수집 시)"),
    db: Session = Depends(get_db)
):
    """
    개별 종목의 히스토리 데이터 동기화 (하이브리드 전략)

    - 데이터 없음/부족: 전체 수집 (full)
    - 최신 데이터 있음: 스킵 (skip)
    - 며칠 빠짐: 증분 수집 (incremental)
    """
    try:
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        # 시장별 처리
        if stock.market == 'KR':
            # 한국 주식: KIS API 사용
            from app.crawlers.kis_history_crawler import kis_history_crawler

            # 수집 필요 여부 확인 (하이브리드 전략)
            should_collect, mode, last_date = kis_history_crawler._should_collect_history(stock, db)

            if mode == "skip":
                return {
                    "success": True,
                    "mode": "skip",
                    "message": f"이미 최신 상태입니다 (마지막: {last_date})",
                    "stock_id": stock_id,
                    "symbol": stock.symbol,
                    "name": stock.name,
                    "records_count": stock.history_records_count,
                    "last_date": str(last_date) if last_date else None,
                    "records_added": 0
                }

            # 수집 실행
            if mode == "incremental":
                incremental_start = last_date + timedelta(days=1)
                result = kis_history_crawler.collect_history_for_stock(stock, start_date=incremental_start, db=db)
                logger.info(f"Incremental sync for {stock.symbol} from {incremental_start}")
            else:
                result = kis_history_crawler.collect_history_for_stock(stock, days=days, db=db)
                logger.info(f"Full sync for {stock.symbol} ({days} days)")

        elif stock.market == 'US':
            # 미국 주식: KIS API 사용
            from app.kis.kis_client import get_kis_client

            kis_client = get_kis_client()
            if not kis_client:
                raise HTTPException(status_code=500, detail="KIS API가 설정되지 않았습니다")

            # 거래소 코드 변환 (NASDAQ -> NAS, NYSE -> NYS)
            exchange_map = {
                'NASDAQ': 'NAS',
                'NYSE': 'NYS',
                'AMEX': 'AMS',
                'NAS': 'NAS',
                'NYS': 'NYS',
            }
            kis_exchange = exchange_map.get(stock.exchange, 'NAS')

            logger.info(f"Fetching US stock history for {stock.symbol} ({kis_exchange}) via KIS API")

            # KIS API로 OHLCV 데이터 가져오기
            ohlcv_data = kis_client.get_us_stock_ohlcv(stock.symbol, exchange=kis_exchange)

            if not ohlcv_data:
                return {
                    "success": False,
                    "mode": "full",
                    "message": "KIS API에서 데이터를 가져올 수 없습니다",
                    "stock_id": stock_id,
                    "symbol": stock.symbol,
                    "name": stock.name,
                    "records_count": stock.history_records_count or 0,
                    "last_date": None,
                    "records_added": 0
                }

            # 가격 데이터 저장
            records_added = 0
            for item in ohlcv_data:
                try:
                    # KIS API 응답 필드: xymd(날짜), open, high, low, clos, tvol
                    date_str = item.get('xymd', '')
                    if not date_str:
                        continue

                    price_date = datetime.strptime(date_str, '%Y%m%d').date()

                    # 중복 체크
                    existing = db.query(StockPriceHistory).filter(
                        StockPriceHistory.stock_id == stock_id,
                        StockPriceHistory.date == price_date
                    ).first()

                    if not existing:
                        history_record = StockPriceHistory(
                            stock_id=stock_id,
                            date=price_date,
                            open_price=float(item.get('open', 0)),
                            high_price=float(item.get('high', 0)),
                            low_price=float(item.get('low', 0)),
                            close_price=float(item.get('clos', 0)),
                            volume=int(item.get('tvol', 0))
                        )
                        db.add(history_record)
                        records_added += 1
                except Exception as e:
                    logger.error(f"Error saving US price data: {e}")
                    continue

            db.commit()
            mode = "full"
            result = {"success": True, "records_saved": records_added}
            logger.info(f"US stock sync for {stock.symbol}: {records_added} records added")

        else:
            raise HTTPException(status_code=400, detail=f"지원하지 않는 시장입니다: {stock.market}")

        # 업데이트된 레코드 수 조회
        updated_count = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id
        ).count()

        # Stock의 history_records_count 업데이트
        db.execute(
            text("UPDATE stocks SET history_records_count = :count WHERE id = :id"),
            {"count": updated_count, "id": stock_id}
        )
        db.commit()

        # 최신 날짜 조회
        latest = db.query(StockPriceHistory.date).filter(
            StockPriceHistory.stock_id == stock_id
        ).order_by(StockPriceHistory.date.desc()).first()

        return {
            "success": result.get("success", False),
            "mode": mode,
            "message": f"{mode} 수집 완료",
            "stock_id": stock_id,
            "symbol": stock.symbol,
            "name": stock.name,
            "records_count": updated_count,
            "last_date": str(latest[0]) if latest else None,
            "records_added": result.get("records_saved", 0)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error syncing history for stock {stock_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

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
    tags_by_id = {}
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

        # 태그 목록 (이미 가져온 데이터 사용) - 딕셔너리로 변환
        tags = []
        if stock.id in tags_map:
            for ta in tags_map[stock.id]:
                tag_obj = tags_by_id.get(ta.tag_id)
                if tag_obj:
                    tags.append({
                        "id": tag_obj.id,
                        "name": tag_obj.name,
                        "display_name": tag_obj.display_name,
                        "color": tag_obj.color,
                        "icon": tag_obj.icon,
                        "order": tag_obj.order,
                    })

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
            "history_records_count": stock.history_records_count or 0,
            "history_latest_date": None,
            "history_oldest_date": None,
            "has_history_data": (stock.history_records_count or 0) > 0,
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


# ==================== 히스토리 데이터 수집 (Celery 기반) ====================

@app.post("/api/stocks/collect-history")
def collect_history_for_stocks(
    days: int = Query(120, ge=1, le=365),
    mode: str = Query("all", pattern="^(all|tagged)$"),
    workers: int = Query(5, ge=1, le=20, description="병렬 워커 수 (1~20, 기본 5)"),
    current_user: User = Depends(get_current_user)
):
    """
    종목들의 히스토리 데이터 수집 (Celery 백그라운드 작업)

    브라우저를 닫아도 작업이 계속 실행됩니다.

    Args:
        days: 수집할 일수 (1~365일, 기본 120일)
        mode: 수집 모드 ("all": 전체 종목, "tagged": 태그된 종목만)
        workers: 병렬 워커 수 (1~20, 기본 5)

    Returns:
        수집 작업 시작 메시지 및 task_id
    """
    # task_id 생성
    task_id = str(uuid.uuid4())

    # Celery 태스크 비동기 실행 (task_id를 Celery task ID로도 사용)
    collect_history_task.apply_async(
        kwargs={
            "days": days,
            "task_id": task_id,
            "mode": mode,
            "max_workers": workers
        },
        task_id=task_id
    )

    mode_text = "전체 종목" if mode == "all" else "태그된 종목"
    return {
        "success": True,
        "message": f"히스토리 수집 작업이 시작되었습니다. ({mode_text}, {days}일치 데이터, 워커 {workers}개)",
        "days": days,
        "mode": mode,
        "workers": workers,
        "task_id": task_id,
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다."
    }


# 기존 API 호환성 유지
@app.post("/api/stocks/tagged/collect-history")
def collect_history_for_tagged_stocks_api(
    days: int = Query(120, ge=1, le=365),
    workers: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user)
):
    """태그된 종목 히스토리 수집 (Celery 백그라운드 작업)"""
    task_id = str(uuid.uuid4())
    collect_history_task.apply_async(
        kwargs={
            "days": days,
            "task_id": task_id,
            "mode": "tagged",
            "max_workers": workers
        },
        task_id=task_id
    )
    return {
        "success": True,
        "message": f"히스토리 수집 작업이 시작되었습니다. (태그된 종목, {days}일치 데이터, 워커 {workers}개)",
        "days": days,
        "mode": "tagged",
        "workers": workers,
        "task_id": task_id,
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다."
    }


@app.get("/api/stocks/{stock_id}/history")
def get_stock_price_history(
    stock_id: int,
    days: int = Query(120, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """
    특정 종목의 가격 히스토리 조회

    Args:
        stock_id: 종목 ID
        days: 조회할 일수 (기본 120일)

    Returns:
        OHLCV 히스토리 데이터
    """
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    # 날짜 범위 계산
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    # 히스토리 조회
    history = db.query(StockPriceHistory).filter(
        StockPriceHistory.stock_id == stock_id,
        StockPriceHistory.date >= start_date,
        StockPriceHistory.date <= end_date
    ).order_by(StockPriceHistory.date.asc()).all()

    return {
        "stock_id": stock_id,
        "symbol": stock.symbol,
        "name": stock.name,
        "data_count": len(history),
        "history": [
            {
                "date": h.date.isoformat(),
                "open": h.open_price,
                "high": h.high_price,
                "low": h.low_price,
                "close": h.close_price,
                "volume": h.volume
            }
            for h in history
        ]
    }


# ==================== 매매 신호 생성 ====================

@app.get("/api/stocks/{stock_id}/signals")
def get_trading_signals(
    stock_id: int,
    days: int = Query(120, ge=60, le=365),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """
    특정 종목의 추세선 돌파 + 되돌림 매매 신호 조회

    Args:
        stock_id: 종목 ID
        days: 분석할 일수 (60~365일, 기본 120일)

    Returns:
        매매 신호 및 전략 결과
    """
    import pandas as pd
    from app.technical_indicators import generate_breakout_pullback_signals

    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")

    # 날짜 범위 계산
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    # 히스토리 조회
    history = db.query(StockPriceHistory).filter(
        StockPriceHistory.stock_id == stock_id,
        StockPriceHistory.date >= start_date,
        StockPriceHistory.date <= end_date
    ).order_by(StockPriceHistory.date.asc()).all()

    if not history or len(history) < 60:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough historical data. Found {len(history)} days, need at least 60 days."
        )

    # DataFrame으로 변환
    df = pd.DataFrame([
        {
            'date': h.date,
            'open': float(h.open_price) if h.open_price else 0.0,
            'high': float(h.high_price) if h.high_price else 0.0,
            'low': float(h.low_price) if h.low_price else 0.0,
            'close': float(h.close_price) if h.close_price else 0.0,
            'volume': float(h.volume) if h.volume else 0.0
        }
        for h in history
    ])

    # 전략 적용
    try:
        result_df = generate_breakout_pullback_signals(
            df,
            swing_window=5,
            trendline_points=3,
            volume_threshold=1.5,
            pullback_threshold=0.02
        )
    except Exception as e:
        logger.error(f"Error generating signals for stock_id {stock_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Signal generation failed: {str(e)}")

    # 최근 매수 신호 찾기
    buy_signals = result_df[result_df['buy_signal'] == 1].tail(10)  # 최근 10개
    latest_signal = None
    signal_count = len(buy_signals)

    if signal_count > 0:
        last_signal_row = buy_signals.iloc[-1]
        latest_signal = {
            "date": last_signal_row['date'].strftime('%Y-%m-%d'),
            "price": float(last_signal_row['close']),
            "volume": int(last_signal_row['volume']),
            "signal_type": "buy",
            "reason": "추세선 돌파 후 되돌림 완료"
        }

    # 돌파 및 되돌림 정보
    breakouts = result_df[result_df['breakout'] == True].tail(5)
    pullbacks = result_df[result_df['pullback'] == True].tail(5)

    return {
        "stock_id": stock_id,
        "symbol": stock.symbol,
        "name": stock.name,
        "analyzed_days": len(history),
        "latest_signal": latest_signal,
        "signal_count": signal_count,
        "recent_breakouts": [
            {
                "date": row['date'].strftime('%Y-%m-%d'),
                "price": float(row['close'])
            }
            for _, row in breakouts.iterrows()
        ],
        "recent_pullbacks": [
            {
                "date": row['date'].strftime('%Y-%m-%d'),
                "price": float(row['close'])
            }
            for _, row in pullbacks.iterrows()
        ]
    }


@app.get("/api/signals", response_model=schemas.SignalListResponse)
def get_stored_signals(
    signal_type: Optional[str] = Query(None, description="Signal type filter (buy, sell)"),
    skip: int = Query(0, ge=0, description="Number of records to skip (for pagination)"),
    limit: int = Query(30, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """
    저장된 매매 신호 조회 (DB에서 읽기만 함 - 빠름, 페이지네이션 지원)

    Args:
        signal_type: 신호 타입 필터
        skip: 건너뛸 레코드 수 (페이지네이션용)
        limit: 최대 조회 개수

    Returns:
        저장된 신호 목록
    """
    # 활성 신호 조회
    query = db.query(StockSignal).filter(StockSignal.is_active == True)

    if signal_type:
        query = query.filter(StockSignal.signal_type == signal_type)

    # 전체 카운트 (페이지네이션용)
    total = query.count()

    # 최신 신호부터 (페이지네이션 적용)
    signals = query.order_by(
        desc(StockSignal.signal_date)
    ).offset(skip).limit(limit).all()

    # 종목 정보 로드
    stock_ids = [s.stock_id for s in signals]
    stocks_map = {}
    if stock_ids:
        stocks = db.query(Stock).filter(Stock.id.in_(stock_ids)).all()
        stocks_map = {s.id: s for s in stocks}

    # 응답 생성
    signal_responses = []
    for signal in signals:
        signal_dict = {
            "id": signal.id,
            "stock_id": signal.stock_id,
            "signal_type": signal.signal_type,
            "signal_date": signal.signal_date,
            "signal_price": signal.signal_price,
            "strategy_name": signal.strategy_name,
            "current_price": signal.current_price,
            "return_percent": signal.return_percent,
            "details": signal.details,
            "is_active": signal.is_active,
            "analyzed_at": signal.analyzed_at,
            "updated_at": signal.updated_at,
            "stock": stocks_map.get(signal.stock_id)
        }
        signal_responses.append(signal_dict)

    # 통계 계산 (전체 데이터 기준 - 첫 페이지에서만 계산)
    if skip == 0:
        all_signals = query.all()
        stats = {
            "total_signals": total,
            "positive_returns": len([s for s in all_signals if s.return_percent and s.return_percent > 0]),
            "negative_returns": len([s for s in all_signals if s.return_percent and s.return_percent < 0]),
            "avg_return": sum([s.return_percent or 0 for s in all_signals]) / total if total > 0 else 0
        }
    else:
        # 이후 페이지에서는 통계 생략
        stats = None

    # 마지막 분석 시간
    latest_analyzed = db.query(StockSignal).order_by(
        desc(StockSignal.analyzed_at)
    ).first()

    return {
        "total": total,
        "signals": signal_responses,
        "analyzed_at": latest_analyzed.analyzed_at if latest_analyzed else None,
        "stats": stats
    }


@app.delete("/api/signals")
def delete_all_signals(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """
    모든 신호 삭제

    Returns:
        삭제된 신호 수
    """
    deleted_count = db.query(StockSignal).delete()
    db.commit()

    logger.info(f"🗑️ Deleted {deleted_count} signals")

    return {
        "success": True,
        "deleted_count": deleted_count,
        "message": f"{deleted_count}개 신호가 삭제되었습니다"
    }


@app.post("/api/signals/refresh")
def refresh_signals(
    mode: str = Query("all", pattern="^(tagged|all|top)$"),
    limit: int = Query(500, ge=10, le=2000),
    days: int = Query(120, ge=60, le=365),
    force_full: bool = Query(False, description="True면 델타 무시하고 전체 스캔"),
    background_tasks: BackgroundTasks = None,
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """
    매매 신호 재분석 (백그라운드 작업)

    브라우저를 닫아도 작업이 계속 실행됩니다.

    Args:
        mode: 분석 모드 (tagged, all, top)
        limit: top 모드일 때 상위 몇 개
        days: 분석할 일수
        force_full: True면 델타 무시하고 전체 스캔 (기본: False = 변경된 종목만)

    Returns:
        작업 시작 메시지
    """
    import threading

    # task_id 생성
    task_id = str(uuid.uuid4())

    def run_analysis():
        try:
            signal_analyzer.analyze_and_store_signals(
                mode=mode,
                limit=limit,
                days=days,
                force_full=force_full,
                task_id=task_id
            )
        except Exception as e:
            logger.error(f"Signal analysis failed: {e}")

    # 백그라운드 스레드에서 실행
    thread = threading.Thread(target=run_analysis, daemon=True)
    thread.start()

    logger.info(f"🚀 Signal analysis background task launched (task_id: {task_id})")

    delta_msg = "전체 스캔" if force_full else "델타 분석 (변경된 종목만)"
    return {
        "success": True,
        "message": f"신호 분석 작업이 시작되었습니다 (mode: {mode}, {delta_msg})",
        "mode": mode,
        "days": days,
        "force_full": force_full,
        "task_id": task_id,
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다. GET /api/tasks/{task_id}로 진행 상황을 확인하세요."
    }


# ===== Task Progress Endpoints =====

@app.get("/api/tasks/{task_id}", response_model=schemas.TaskProgress)
def get_task_progress(
    task_id: str,
    db: Session = Depends(get_db)
):
    """
    특정 작업의 진행 상황 조회

    Args:
        task_id: 작업 ID (UUID)

    Returns:
        TaskProgress 객체
    """
    task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    return task


@app.get("/api/tasks/latest/{task_type}", response_model=schemas.TaskProgress)
def get_latest_task_by_type(
    task_type: str,
    db: Session = Depends(get_db)
):
    """
    특정 작업 타입의 최신 진행 상황 조회

    Args:
        task_type: 작업 타입 (history_collection, signal_analysis)

    Returns:
        최신 TaskProgress 객체
    """
    task = db.query(TaskProgress).filter(
        TaskProgress.task_type == task_type
    ).order_by(desc(TaskProgress.started_at)).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"No task found for type: {task_type}")

    return task


@app.get("/api/tasks/running", response_model=List[schemas.TaskProgress])
def get_running_tasks(db: Session = Depends(get_db)):
    """
    현재 실행 중인 모든 작업 조회

    Returns:
        실행 중인 TaskProgress 객체 리스트
    """
    tasks = db.query(TaskProgress).filter(
        TaskProgress.status == "running"
    ).order_by(desc(TaskProgress.started_at)).all()

    return tasks


@app.post("/api/tasks/{task_id}/cancel")
def cancel_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    실행 중인 작업 취소

    Celery 워커에서 실행 중인 작업을 강제로 종료합니다.

    Args:
        task_id: 작업 ID (UUID)

    Returns:
        취소 결과 메시지
    """
    # DB에서 작업 조회
    task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if task.status != "running":
        return {
            "success": False,
            "message": f"작업이 실행 중이 아닙니다. (현재 상태: {task.status})"
        }

    # Celery 태스크 취소 (terminate=True: 강제 종료)
    celery_app.control.revoke(task_id, terminate=True, signal='SIGTERM')

    # DB 상태 업데이트
    task.status = "cancelled"
    task.message = "사용자에 의해 취소됨"
    task.completed_at = datetime.utcnow()
    db.commit()

    logger.info(f"🛑 Task {task_id} cancelled by user")

    return {
        "success": True,
        "message": "작업이 취소되었습니다",
        "task_id": task_id
    }


@app.post("/api/tasks/{task_id}/restart")
def restart_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    실패하거나 취소된 작업 재시작

    동일한 설정으로 새로운 작업을 시작합니다.

    Args:
        task_id: 재시작할 원본 작업 ID

    Returns:
        새로운 task_id와 함께 재시작 결과
    """
    # DB에서 원본 작업 조회
    task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()

    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    if task.status == "running":
        return {
            "success": False,
            "message": "작업이 아직 실행 중입니다. 취소 후 재시작하세요."
        }

    # 새 task_id 생성
    new_task_id = str(uuid.uuid4())

    # 작업 타입에 따라 재시작
    if task.task_type == "history_collection":
        # 기본 설정으로 재시작 (tagged 모드, 100일)
        collect_history_task.apply_async(
            kwargs={
                "days": 100,
                "task_id": new_task_id,
                "mode": "tagged",
                "max_workers": 5
            },
            task_id=new_task_id
        )
        logger.info(f"🔄 History collection restarted: {task_id} -> {new_task_id}")

    elif task.task_type == "signal_analysis":
        analyze_signals_task.apply_async(
            kwargs={
                "task_id": new_task_id,
                "mode": "tagged",
                "limit": 500,
                "days": 120,
                "force_full": False
            },
            task_id=new_task_id
        )
        logger.info(f"🔄 Signal analysis restarted: {task_id} -> {new_task_id}")

    else:
        raise HTTPException(
            status_code=400,
            detail=f"알 수 없는 작업 타입: {task.task_type}"
        )

    return {
        "success": True,
        "message": "작업이 재시작되었습니다",
        "original_task_id": task_id,
        "new_task_id": new_task_id
    }


# ==================== 히스토리 수집 로그 ====================

@app.get("/api/history-logs", response_model=List[schemas.HistoryCollectionSummary])
def get_history_collection_summaries(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    수집 히스토리 요약 목록 조회 (task_id별 그룹화)

    Args:
        limit: 조회할 최대 개수 (기본 20, 최대 100)

    Returns:
        HistoryCollectionSummary 객체 리스트
    """
    from app.models import HistoryCollectionLog
    from sqlalchemy import func

    # task_id별 그룹화하여 요약 정보 조회
    subquery = db.query(
        HistoryCollectionLog.task_id,
        func.min(HistoryCollectionLog.started_at).label('started_at'),
        func.max(HistoryCollectionLog.completed_at).label('completed_at'),
        func.count(HistoryCollectionLog.id).label('total_count'),
        func.sum(case((HistoryCollectionLog.status == 'success', 1), else_=0)).label('success_count'),
        func.sum(case((HistoryCollectionLog.status == 'failed', 1), else_=0)).label('failed_count'),
        func.sum(HistoryCollectionLog.records_saved).label('total_records_saved')
    ).group_by(
        HistoryCollectionLog.task_id
    ).order_by(
        func.min(HistoryCollectionLog.started_at).desc()
    ).limit(limit).all()

    return [
        schemas.HistoryCollectionSummary(
            task_id=row.task_id,
            started_at=row.started_at,
            completed_at=row.completed_at,
            total_count=row.total_count,
            success_count=row.success_count or 0,
            failed_count=row.failed_count or 0,
            total_records_saved=row.total_records_saved or 0
        )
        for row in subquery
    ]


@app.get("/api/tasks/{task_id}/logs", response_model=List[schemas.HistoryCollectionLog])
def get_task_logs(
    task_id: str,
    status: Optional[str] = Query(None, pattern="^(success|failed)$"),
    db: Session = Depends(get_db)
):
    """
    특정 작업의 개별 종목별 로그 조회

    Args:
        task_id: TaskProgress의 task_id
        status: 필터링할 상태 (success, failed, 없으면 전체)

    Returns:
        HistoryCollectionLog 객체 리스트
    """
    from app.models import HistoryCollectionLog

    query = db.query(HistoryCollectionLog).filter(
        HistoryCollectionLog.task_id == task_id
    )

    if status:
        query = query.filter(HistoryCollectionLog.status == status)

    logs = query.order_by(HistoryCollectionLog.started_at).all()
    return logs


@app.post("/api/tasks/{task_id}/retry-failed")
def retry_failed_stocks(
    task_id: str,
    days: int = Query(120, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    특정 작업에서 실패한 종목들만 재시도 (Celery 백그라운드 작업)

    브라우저를 닫아도 작업이 계속 실행됩니다.

    Args:
        task_id: 재시도할 TaskProgress의 task_id
        days: 수집할 일수

    Returns:
        재시도 작업 정보
    """
    from app.models import HistoryCollectionLog

    # 실패한 종목 조회
    failed_logs = db.query(HistoryCollectionLog).filter(
        HistoryCollectionLog.task_id == task_id,
        HistoryCollectionLog.status == "failed"
    ).all()

    if not failed_logs:
        return {
            "success": False,
            "message": "재시도할 실패 종목이 없습니다.",
            "failed_count": 0
        }

    # 실패한 종목 ID 추출
    failed_stock_ids = [log.stock_id for log in failed_logs]

    # 활성 종목만 확인
    active_stocks = db.query(Stock).filter(
        Stock.id.in_(failed_stock_ids),
        Stock.is_active == True
    ).all()

    if not active_stocks:
        return {
            "success": False,
            "message": "재시도 가능한 종목이 없습니다.",
            "failed_count": len(failed_logs)
        }

    # 새 task_id 생성
    new_task_id = str(uuid.uuid4())

    # Celery 태스크 비동기 실행
    retry_failed_stocks_task.apply_async(
        kwargs={
            "task_id": new_task_id,
            "stock_ids": [s.id for s in active_stocks],
            "days": days,
            "max_workers": 5
        },
        task_id=new_task_id
    )

    logger.info(f"🔄 Retrying {len(active_stocks)} failed stocks with Celery task: {new_task_id}")

    return {
        "success": True,
        "message": f"{len(active_stocks)}개 실패 종목 재시도가 시작되었습니다.",
        "task_id": new_task_id,
        "retry_count": len(active_stocks),
        "original_failed_count": len(failed_logs),
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다."
    }


@app.get("/api/signals/scan")
def scan_all_tagged_stocks(
    days: int = Query(120, ge=60, le=365),
    mode: str = Query("all", pattern="^(tagged|all|top)$"),
    limit: int = Query(500, ge=10, le=2000),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user)
):
    """
    종목 스캔하여 매수 신호가 있는 종목 찾기

    Args:
        days: 분석할 일수 (60~365일, 기본 120일)
        mode: 스캔 모드 (tagged: 태그 종목만, all: 모든 활성 종목, top: 시총 상위)
        limit: top 모드일 때 스캔할 종목 수 (10~2000, 기본 500)

    Returns:
        매수 신호가 있는 종목 리스트
    """
    import pandas as pd
    from app.technical_indicators import generate_breakout_pullback_signals

    # 캐시 키 생성
    user_token = current_user.user_token if current_user else "anonymous"
    cache_key_data = {
        "endpoint": "signals_scan",
        "user": user_token,
        "days": days,
        "mode": mode,
        "limit": limit if mode == "top" else None
    }
    cache_key = hashlib.md5(orjson.dumps(cache_key_data, option=orjson.OPT_SORT_KEYS)).hexdigest()

    # 캐시 확인 (5분 TTL)
    cached_data = get_cache(cache_key)
    if cached_data:
        logger.info(f"✅ Signals scan cache HIT (mode: {mode})")
        return cached_data

    logger.info(f"⏳ Signals scan cache MISS - scanning stocks (mode: {mode})")

    # 모드에 따라 종목 선택
    if mode == "tagged":
        # 태그가 있는 종목들
        tagged_stock_ids = db.query(StockTagAssignment.stock_id).distinct().all()
        stock_ids = [sid[0] for sid in tagged_stock_ids]

        if not stock_ids:
            result = {
                "total_scanned": 0,
                "total_with_signals": 0,
                "stocks_with_signals": [],
                "scanned_at": datetime.now().isoformat(),
                "mode": mode,
                "message": "No tagged stocks found"
            }
            set_cache(cache_key, result, ttl=300)
            return result
    elif mode == "top":
        # 시총 상위 N개
        top_stocks = db.query(Stock.id).filter(
            Stock.is_active == True
        ).order_by(Stock.market_cap.desc().nullslast()).limit(limit).all()
        stock_ids = [s.id for s in top_stocks]
    else:  # "all"
        # 모든 활성 종목
        all_stocks = db.query(Stock.id).filter(
            Stock.is_active == True
        ).all()
        stock_ids = [s.id for s in all_stocks]

    # 날짜 범위
    end_date = date.today()
    start_date = end_date - timedelta(days=days)

    stocks_with_signals = []
    total_scanned = 0

    for stock_id in stock_ids:
        try:
            stock = db.query(Stock).filter(Stock.id == stock_id).first()
            if not stock or not stock.is_active:
                continue

            # 히스토리 조회
            history = db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock_id,
                StockPriceHistory.date >= start_date,
                StockPriceHistory.date <= end_date
            ).order_by(StockPriceHistory.date.asc()).all()

            if not history or len(history) < 60:
                continue

            total_scanned += 1

            # DataFrame 변환
            df = pd.DataFrame([
                {
                    'date': h.date,
                    'open': float(h.open_price) if h.open_price else 0.0,
                    'high': float(h.high_price) if h.high_price else 0.0,
                    'low': float(h.low_price) if h.low_price else 0.0,
                    'close': float(h.close_price) if h.close_price else 0.0,
                    'volume': float(h.volume) if h.volume else 0.0
                }
                for h in history
            ])

            # 전략 적용
            result_df = generate_breakout_pullback_signals(
                df,
                swing_window=5,
                trendline_points=3,
                volume_threshold=1.5,
                pullback_threshold=0.02
            )

            # 매수 신호 확인
            buy_signals = result_df[result_df['buy_signal'] == 1]

            if len(buy_signals) > 0:
                last_signal = buy_signals.iloc[-1]
                latest_price = df.iloc[-1]['close']

                stocks_with_signals.append({
                    "stock_id": stock.id,
                    "symbol": stock.symbol,
                    "name": stock.name,
                    "market": stock.market,
                    "latest_signal_date": last_signal['date'].strftime('%Y-%m-%d'),
                    "signal_price": float(last_signal['close']),
                    "current_price": float(latest_price),
                    "price_change_pct": ((latest_price - last_signal['close']) / last_signal['close']) * 100,
                    "signal_count": len(buy_signals)
                })

        except Exception as e:
            logger.error(f"Error scanning stock_id {stock_id}: {str(e)}")
            continue

    # 최근 신호 순으로 정렬
    stocks_with_signals.sort(key=lambda x: x['latest_signal_date'], reverse=True)

    result = {
        "total_scanned": total_scanned,
        "total_with_signals": len(stocks_with_signals),
        "stocks_with_signals": stocks_with_signals,
        "scanned_at": datetime.now().isoformat(),
        "mode": mode,
        "limit": limit if mode == "top" else None
    }

    # 캐시 저장 (5분)
    set_cache(cache_key, result, ttl=300)

    logger.info(f"✅ Scan completed ({mode} mode): {total_scanned} stocks scanned, {len(stocks_with_signals)} with signals")

    return result


# ==================== Admin: 테이블 생성 (일회성) ====================

@app.post("/api/admin/create-tables")
def create_missing_tables(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    누락된 테이블/컬럼 생성 (관리자 전용, 일회성)

    HistoryCollectionLog 등 새로 추가된 테이블과 컬럼을 생성합니다.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        from sqlalchemy import inspect, text

        inspector = inspect(engine)

        # 테이블 생성
        Base.metadata.create_all(bind=engine, tables=[HistoryCollectionLog.__table__])

        # Stock 테이블에 history_records_count 컬럼 추가 (없으면)
        stock_columns = [col['name'] for col in inspector.get_columns('stocks')]
        columns_added = []

        if 'history_records_count' not in stock_columns:
            db.execute(text("ALTER TABLE stocks ADD COLUMN history_records_count INTEGER DEFAULT 0"))
            db.commit()
            columns_added.append('history_records_count')

        # 확인
        tables = inspector.get_table_names()

        result = {
            "success": True,
            "message": "Tables and columns created successfully",
            "tables_exist": {
                "history_collection_logs": "history_collection_logs" in tables
            },
            "columns_added": columns_added
        }

        if "history_collection_logs" in tables:
            columns = inspector.get_columns('history_collection_logs')
            indexes = inspector.get_indexes('history_collection_logs')
            result["history_collection_logs"] = {
                "columns": [col['name'] for col in columns],
                "indexes": [idx['name'] for idx in indexes]
            }

        logger.info(f"✅ Tables/columns created: {result}")
        return result

    except Exception as e:
        logger.error(f"❌ Error creating tables/columns: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create tables/columns: {str(e)}")


@app.post("/api/admin/clear-cache")
def clear_all_cache(current_user: User = Depends(get_current_user)):
    """캐시 전체 삭제 (관리자 전용)"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    invalidate_cache()
    logger.info("✅ All cache cleared by admin")
    return {"success": True, "message": "Cache cleared successfully", "use_redis": USE_REDIS}


@app.get("/api/admin/check-history-counts")
def check_history_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """DB에서 직접 history_records_count 확인 (디버깅용)"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    # 히스토리가 있는 종목 샘플
    with_history = db.query(Stock).filter(Stock.history_records_count > 0).limit(5).all()
    # NULL인 종목 수
    null_count = db.query(Stock).filter(Stock.history_records_count == None).count()
    # 0인 종목 수
    zero_count = db.query(Stock).filter(Stock.history_records_count == 0).count()

    return {
        "with_history_sample": [{"name": s.name, "count": s.history_records_count} for s in with_history],
        "null_count": null_count,
        "zero_count": zero_count,
        "use_redis": USE_REDIS
    }


@app.get("/api/admin/signal-debug")
def debug_signal_analysis(
    mode: str = Query("all", description="Mode: tagged, top, all"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """신호 분석 대상 종목 확인 (디버깅용) - signal_analyzer와 동일한 로직 (최적화됨)"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from sqlalchemy import func
    from app.models import StockTagAssignment

    # Step 1: 모드별 종목 선택 (signal_analyzer와 동일)
    if mode == "tagged":
        tagged_stocks = db.query(StockTagAssignment.stock_id).distinct().all()
        stock_ids = set(sid[0] for sid in tagged_stocks)
        mode_desc = "태그가 있는 종목"
    elif mode == "top":
        top_stocks = db.query(Stock.id).filter(
            Stock.is_active == True
        ).order_by(Stock.market_cap.desc().nullslast()).limit(500).all()
        stock_ids = set(s.id for s in top_stocks)
        mode_desc = "시총 상위 500개"
    else:  # "all"
        all_stocks = db.query(Stock.id).filter(Stock.is_active == True).all()
        stock_ids = set(s.id for s in all_stocks)
        mode_desc = "모든 활성 종목"

    # Step 2: 히스토리 데이터 60일 이상인 종목 필터링 (최적화: 단일 쿼리)
    history_counts = db.query(
        StockPriceHistory.stock_id,
        func.count(StockPriceHistory.id).label('count')
    ).group_by(StockPriceHistory.stock_id).having(
        func.count(StockPriceHistory.id) >= 60
    ).all()

    # stock_ids와 교집합 (활성 종목 중 60일 이상 히스토리 있는 것)
    history_map = {row.stock_id: row.count for row in history_counts}
    filtered_ids = [sid for sid in stock_ids if sid in history_map]

    # 결과 상세 (상위 20개)
    stocks_detail = []
    for stock_id in filtered_ids[:20]:
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if stock:
            stocks_detail.append({
                "id": stock.id,
                "symbol": stock.symbol,
                "name": stock.name,
                "history_count": history_map.get(stock_id, 0)
            })

    return {
        "mode": mode,
        "mode_description": mode_desc,
        "step1_stock_ids_count": len(stock_ids),
        "step2_filtered_count": len(filtered_ids),
        "sample_stocks": stocks_detail
    }


@app.get("/api/admin/history-stats")
def get_history_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """종목별 히스토리 데이터 통계 조회 (디버깅용)"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from sqlalchemy import func

    # 종목별 히스토리 개수 조회
    history_counts = db.query(
        StockPriceHistory.stock_id,
        func.count(StockPriceHistory.id).label('count')
    ).group_by(StockPriceHistory.stock_id).all()

    # 통계 분석
    total_with_history = len(history_counts)
    count_60_or_more = sum(1 for row in history_counts if row.count >= 60)
    count_distribution = {}

    for row in history_counts:
        bucket = (row.count // 30) * 30  # 30일 단위로 그룹화
        bucket_key = f"{bucket}-{bucket+29}"
        count_distribution[bucket_key] = count_distribution.get(bucket_key, 0) + 1

    # 상세 내역 (60일 이상만)
    stocks_with_60_plus = []
    for row in sorted(history_counts, key=lambda x: x.count, reverse=True)[:20]:
        stock = db.query(Stock).filter(Stock.id == row.stock_id).first()
        if stock:
            stocks_with_60_plus.append({
                "id": stock.id,
                "symbol": stock.symbol,
                "name": stock.name,
                "history_count": row.count
            })

    return {
        "total_stocks_with_history": total_with_history,
        "stocks_with_60_plus_days": count_60_or_more,
        "count_distribution": count_distribution,
        "top_20_stocks": stocks_with_60_plus
    }


@app.post("/api/admin/sync-history-counts")
def sync_history_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    기존 데이터의 history_records_count를 동기화 (관리자 전용, 일회성)

    Stock 테이블에 새로 추가된 history_records_count 컬럼을 기존 데이터로 채웁니다.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        from sqlalchemy import func, text

        # 모든 종목의 히스토리 카운트를 한 번에 조회
        history_counts = db.query(
            StockPriceHistory.stock_id,
            func.count(StockPriceHistory.id).label('count')
        ).group_by(StockPriceHistory.stock_id).all()

        count_map = {row.stock_id: row.count for row in history_counts}

        # Stock 테이블 업데이트 - 직접 UPDATE 쿼리 사용
        total_stocks = db.query(Stock).count()
        updated = 0

        # 히스토리가 있는 종목들 업데이트
        for stock_id, count in count_map.items():
            result = db.query(Stock).filter(Stock.id == stock_id).update(
                {"history_records_count": count},
                synchronize_session=False
            )
            if result > 0:
                updated += result

        # 히스토리가 없는 종목들은 0으로 설정
        zero_updated = db.query(Stock).filter(
            ~Stock.id.in_(count_map.keys())
        ).update(
            {"history_records_count": 0},
            synchronize_session=False
        )
        updated += zero_updated

        db.commit()

        # 캐시 무효화
        invalidate_cache()

        logger.info(f"✅ History counts synced: {updated} stocks updated, cache cleared")
        return {
            "success": True,
            "message": f"History counts synced successfully",
            "total_stocks": total_stocks,
            "stocks_with_history": len(count_map),
            "updated": updated,
            "cache_cleared": True
        }

    except Exception as e:
        logger.error(f"❌ Error syncing history counts: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to sync: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
