from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
import logging
import hashlib
import orjson

from app.database import get_db
from app.models import Stock, StockTag, StockTagAssignment, User
from app import schemas
from app.auth import get_current_user, get_optional_current_user

from app.cache import get_cache, set_cache, invalidate_cache
logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/api/tags", response_model=schemas.TagListResponse)
def get_tags(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """모든 태그 목록 조회"""
    tags = db.query(StockTag).filter(StockTag.is_active == True, or_(StockTag.user_token == None, StockTag.user_token == current_user.user_token)).order_by(StockTag.order).all()
    return {"tags": tags}


@router.post("/api/tags", response_model=schemas.StockTag)
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
    invalidate_cache()
    return new_tag


@router.get("/api/stocks/by-tag/{tag_name}", response_model=schemas.StockListResponse)
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
    tag = db.query(StockTag).filter(StockTag.name == tag_name, or_(StockTag.user_token == None, StockTag.user_token == current_user.user_token)).order_by(StockTag.user_token.desc().nullslast()).first()
    if not tag or tag.user_token not in (None, current_user.user_token):
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


@router.put("/api/tags/{tag_id}", response_model=schemas.StockTag)
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
    invalidate_cache()
    return existing_tag


@router.delete("/api/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """태그 삭제 - 관리자만 가능"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can delete tags")

    tag = db.query(StockTag).filter(StockTag.id == tag_id).first()
    if not tag or tag.user_token not in (None, current_user.user_token):
        raise HTTPException(status_code=404, detail="Tag not found")

    # 할당된 태그도 모두 삭제 (cascade로 자동 처리됨)
    db.delete(tag)
    db.commit()

    invalidate_cache()
    return {"success": True, "message": f"Tag '{tag.display_name}' deleted successfully"}


@router.post("/api/stocks/{stock_id}/tags/{tag_id}", response_model=schemas.TagAssignmentResponse)
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
    if not tag or tag.user_token not in (None, current_user.user_token):
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


@router.delete("/api/stocks/{stock_id}/tags/{tag_id}")
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



# Compatibility endpoints share the same user-scoped tag implementation.
def _system_tag(db, name):
    tag = db.query(StockTag).filter(StockTag.name == name, StockTag.user_token == None).first()
    if tag is None:
        raise HTTPException(status_code=404, detail="System tag not found")
    return tag


@router.get("/api/favorites", response_model=schemas.StockListResponse)
def get_favorites(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100),
                  db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_stocks_by_tag("favorite", skip, limit, db, current_user)


@router.get("/api/dislikes", response_model=schemas.StockListResponse)
def get_dislikes(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100),
                 db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_stocks_by_tag("dislike", skip, limit, db, current_user)


@router.post("/api/stocks/{stock_id}/favorite")
def add_favorite(stock_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return add_tag_to_stock(stock_id, _system_tag(db, "favorite").id, db, current_user)


@router.delete("/api/stocks/{stock_id}/favorite")
def remove_favorite(stock_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return remove_tag_from_stock(stock_id, _system_tag(db, "favorite").id, db, current_user)


@router.post("/api/stocks/{stock_id}/dislike")
def add_dislike(stock_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return add_tag_to_stock(stock_id, _system_tag(db, "dislike").id, db, current_user)


@router.delete("/api/stocks/{stock_id}/dislike")
def remove_dislike(stock_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return remove_tag_from_stock(stock_id, _system_tag(db, "dislike").id, db, current_user)
