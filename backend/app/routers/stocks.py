from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime, date, timedelta
import logging
import hashlib
import orjson

from app.database import get_db
from app.models import Stock, StockPrice, StockDailyData, StockPriceHistory, StockTag, StockTagAssignment, User, StockSignal
from app import schemas
from app.constants import ETF_KEYWORDS
from app.auth import get_current_user, get_admin_user

from app.freshness import cache_epoch
from app.cache import get_cache, set_cache
logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/api/stocks/search", response_model=schemas.StockListResponse)
def search_stocks(
    q: str = Query(..., min_length=1, description="Search query (name or symbol)"),
    market: Optional[str] = Query(None, description="Filter by market (KR, US)"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """종목 검색 API - 종목명 또는 심볼로 검색 (자동완성용)"""
    # 캐시 키 생성
    user_token = current_user.user_token if current_user else "anonymous"
    cache_key_data = {
        "freshness_epoch": cache_epoch(),
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
            _tag_date = latest_tag_dates.get(stock.id)
            latest_tag_date = _tag_date.isoformat() if _tag_date else None
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
                        "is_active": tag_obj.is_active,
                        "user_token": tag_obj.user_token,
                        "created_at": tag_obj.created_at.isoformat() if tag_obj.created_at else None,
                        "updated_at": tag_obj.updated_at.isoformat() if tag_obj.updated_at else None,
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
            "history_precision_version": stock.history_precision_version,
            "freshness": stock.freshness,
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


@router.get("/api/stocks/ma90-screener")
def get_ma90_screener_stocks(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """90일선 스크리너: MA90 근접 종목"""
    from sqlalchemy import and_

    # 캐시 키 생성
    user_token = current_user.user_token if current_user else "anonymous"
    cache_key_data = {
        "freshness_epoch": cache_epoch(),
        "endpoint": "ma90-screener",
        "user": user_token,
        "skip": skip,
        "limit": limit
    }
    cache_key = hashlib.md5(orjson.dumps(cache_key_data, option=orjson.OPT_SORT_KEYS)).hexdigest()

    cached_data = get_cache(cache_key)
    if cached_data:
        return cached_data

    query = db.query(Stock).filter(
        Stock.is_active == True,
        Stock.market == "US",
        Stock.history_precision_version >= 1,
        Stock.current_price.isnot(None),
        Stock.ma90_price.isnot(None),
        Stock.ma90_price > 0,
    )

    # 조건: MA90 대비 -2% ~ +2%
    ma90_pct = (Stock.current_price - Stock.ma90_price) / Stock.ma90_price * 100
    query = query.filter(ma90_pct.between(-2, 2))

    # dislike/error 태그 제외
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

    # 정렬: 시가총액 내림차순
    query = query.order_by(Stock.market_cap.desc().nullslast(), Stock.id.asc())

    # COUNT 최적화
    if skip == 0:
        total = query.count()
    else:
        count_cache_key = f"count:{hashlib.md5(orjson.dumps({**cache_key_data, 'skip': 0}, option=orjson.OPT_SORT_KEYS)).hexdigest()}"
        cached_first_page = get_cache(count_cache_key)
        if cached_first_page and 'total' in cached_first_page:
            total = cached_first_page['total']
        else:
            total = query.count()

    stocks = query.offset(skip).limit(limit).all()

    # 태그 정보 일괄 조회
    tags_map = {}
    tags_by_id = {}
    if current_user and stocks:
        stock_ids = [s.id for s in stocks]
        tag_assignments = db.query(StockTagAssignment).filter(
            and_(
                StockTagAssignment.stock_id.in_(stock_ids),
                StockTagAssignment.user_token == current_user.user_token
            )
        ).all()
        for ta in tag_assignments:
            if ta.stock_id not in tags_map:
                tags_map[ta.stock_id] = []
            tags_map[ta.stock_id].append(ta)
        tag_ids = list(set(ta.tag_id for ta in tag_assignments))
        if tag_ids:
            tags_by_id = {tag.id: tag for tag in db.query(StockTag).filter(StockTag.id.in_(tag_ids)).all()}

    # 응답 구성
    stock_list = []
    for stock in stocks:
        ma90_percentage = ((stock.current_price - stock.ma90_price) / stock.ma90_price) * 100

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
                        "is_active": tag_obj.is_active,
                        "user_token": tag_obj.user_token,
                        "created_at": tag_obj.created_at.isoformat() if tag_obj.created_at else None,
                        "updated_at": tag_obj.updated_at.isoformat() if tag_obj.updated_at else None,
                    })

        stock_list.append({
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
            "ma90_percentage": round(ma90_percentage, 2),
            "tags": tags,
            "latest_tag_date": None,
            "history_records_count": stock.history_records_count or 0,
            "history_precision_version": stock.history_precision_version,
            "freshness": stock.freshness,
            "has_history_data": (stock.history_records_count or 0) > 0,
            "latest_price": stock.current_price,
            "latest_change": stock.change_amount,
            "latest_change_percent": stock.change_percent,
            "latest_volume": stock.trading_volume,
        })

    result = {
        "total": total,
        "stocks": stock_list,
        "page": skip // limit + 1,
        "page_size": limit
    }
    set_cache(cache_key, result, ttl=300)
    return result


@router.get("/api/stocks/no-history")
def get_stocks_without_history(
    page: int = Query(1, ge=1, description="페이지 번호"),
    limit: int = Query(50, ge=1, le=200, description="페이지당 항목 수"),
    db: Session = Depends(get_db)
):
    """히스토리가 없는 종목 목록 조회 (최적화된 단일 쿼리 + 페이징)"""
    from sqlalchemy import or_, func

    # 전체 개수 조회
    total_count = db.query(func.count(Stock.id)).filter(
        or_(
            Stock.history_records_count == 0,
            Stock.history_records_count == None
        )
    ).scalar()

    # 페이징 적용하여 종목과 시그널/태그 카운트를 함께 조회
    offset = (page - 1) * limit
    query = db.query(
        Stock.id,
        Stock.symbol,
        Stock.name,
        Stock.market,
        func.count(func.distinct(StockSignal.id)).label('signal_count'),
        func.count(func.distinct(StockTagAssignment.id)).label('tag_count')
    ).outerjoin(
        StockSignal, Stock.id == StockSignal.stock_id
    ).outerjoin(
        StockTagAssignment, Stock.id == StockTagAssignment.stock_id
    ).filter(
        or_(
            Stock.history_records_count == 0,
            Stock.history_records_count == None
        )
    ).group_by(
        Stock.id, Stock.symbol, Stock.name, Stock.market
    ).order_by(
        Stock.name
    ).offset(offset).limit(limit).all()

    result = [{
        "id": row.id,
        "symbol": row.symbol,
        "name": row.name,
        "market": row.market,
        "signal_count": row.signal_count,
        "tag_count": row.tag_count
    } for row in query]

    total_pages = (total_count + limit - 1) // limit

    return {
        "total_count": total_count,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
        "stocks": result
    }


@router.get("/api/stocks", response_model=schemas.StockListResponse)
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
    current_user: User = Depends(get_current_user)
):
    # 캐시 키 생성 (유저별, 조건별로 구분)
    user_token = current_user.user_token if current_user else "anonymous"
    cache_key_data = {
        "freshness_epoch": cache_epoch(),
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
            _tag_date = latest_tag_dates.get(stock.id)
            latest_tag_date = _tag_date.isoformat() if _tag_date else None
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
                        "is_active": tag_obj.is_active,
                        "user_token": tag_obj.user_token,
                        "created_at": tag_obj.created_at.isoformat() if tag_obj.created_at else None,
                        "updated_at": tag_obj.updated_at.isoformat() if tag_obj.updated_at else None,
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
            "history_precision_version": stock.history_precision_version,
            "freshness": stock.freshness,
            "has_history_data": (stock.history_records_count or 0) > 0,

            # 호환성을 위한 최소 필드만 유지
            "latest_price": stock.current_price,
            "latest_change": stock.change_amount,
            "latest_change_percent": stock.change_percent,
            "latest_volume": stock.trading_volume,
        }
        stock_list.append(stock_data)

    # DB 전체 종목 수 (첫 페이지에서만 계산)
    total_in_db = None
    market_counts = None
    if skip == 0:
        total_in_db = db.query(Stock).filter(Stock.is_active == True).count()
        # 마켓별 종목 수
        from sqlalchemy import func
        market_count_query = db.query(
            Stock.market, func.count(Stock.id)
        ).filter(Stock.is_active == True).group_by(Stock.market).all()
        market_counts = {m: c for m, c in market_count_query}

    # 결과 생성 및 캐시에 저장
    result = {
        "total": total,
        "total_in_db": total_in_db,
        "market_counts": market_counts,
        "stocks": stock_list,
        "page": skip // limit + 1,
        "page_size": limit
    }
    set_cache(cache_key, result, ttl=300)  # 5분 캐시
    return result


@router.get("/api/stocks/{stock_id}/prices", response_model=List[schemas.StockPrice])
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


@router.get("/api/stocks/{stock_id}/daily-data", response_model=List[schemas.StockDailyData])
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


@router.get("/api/stocks/{stock_id}/price-history", response_model=List[schemas.StockPriceHistory])
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


@router.get("/api/stocks/{stock_id}/history-status")
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


@router.post("/api/stocks/{stock_id}/sync-history", dependencies=[Depends(get_admin_user)])
def sync_stock_history(
    stock_id: int,
    days: int = Query(100, ge=1, le=365, description="수집할 일수 (전체 수집 시)"),
    db: Session = Depends(get_db)
):
    """Synchronize all markets through the same precision-aware history writer."""
    from app.crawlers.kis_history_crawler import kis_history_crawler
    stock = db.get(Stock, stock_id)
    if stock is None:
        raise HTTPException(status_code=404, detail="Stock not found")
    if kis_history_crawler.kis_client is None:
        raise HTTPException(status_code=503, detail="KIS API not configured")
    should_collect, mode, last_date = kis_history_crawler._should_collect_history(stock, db)
    result = {"records_saved": 0}
    if should_collect:
        result = kis_history_crawler.collect_history_for_stock(stock, days=days,
            start_date=last_date + timedelta(days=1) if mode == "incremental" else None, db=db)
        if not result.get("success"):
            raise HTTPException(status_code=502, detail=result.get("error", "History provider unavailable"))
    latest = db.query(StockPriceHistory.date).filter(StockPriceHistory.stock_id == stock_id).order_by(StockPriceHistory.date.desc()).first()
    count = db.query(StockPriceHistory).filter(StockPriceHistory.stock_id == stock_id).count()
    return {"success": True, "mode": mode, "message": f"{mode} 수집 완료", "stock_id": stock_id,
        "symbol": stock.symbol, "name": stock.name, "records_count": count,
        "last_date": str(latest[0]) if latest else None, "records_added": result.get("records_saved", 0)}


@router.post("/api/stocks/{stock_id}/analyze", dependencies=[Depends(get_admin_user)])
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


@router.get("/api/stocks/{stock_id}/history")
def get_stock_price_history(
    stock_id: int,
    days: int = Query(120, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
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


@router.get("/api/stocks/{stock_id}", response_model=schemas.Stock)
def get_stock(stock_id: int, db: Session = Depends(get_db)):
    stock = db.query(Stock).filter(Stock.id == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Stock not found")
    return stock
