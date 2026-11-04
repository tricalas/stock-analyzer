from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
import logging

from app.database import get_db
from app.models import Stock, StockPriceHistory, StockTagAssignment, User
from app.auth import get_current_user, get_admin_user

from app.cache import invalidate_cache, cache_backend_available
logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_admin_user)])


@router.post("/api/admin/create-tables")
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

    # Schema changes are applied by the versioned deployment migration runner.
    from app.migrate import upgrade_database
    upgrade_database()
    return {"success": True, "message": "Schema is up to date"}


@router.post("/api/admin/clear-cache")
def clear_all_cache(current_user: User = Depends(get_current_user)):
    """캐시 전체 삭제 (관리자 전용)"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    invalidate_cache()
    logger.info("✅ All cache cleared by admin")
    return {"success": True, "message": "Cache cleared successfully", "use_redis": cache_backend_available()}


@router.get("/api/admin/check-history-counts")
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
        "use_redis": cache_backend_available()
    }


@router.get("/api/admin/signal-debug")
def debug_signal_analysis(
    mode: str = Query("all", description="Mode: tagged, top, all"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """시그널 분석 대상 종목 확인 (디버깅용) - signal_analyzer와 동일한 로직 (최적화됨)"""
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


@router.get("/api/admin/history-stats")
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


@router.post("/api/admin/sync-history-counts")
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


@router.post("/api/admin/update-all-ma90")
def update_all_ma90(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    모든 종목의 MA90 일괄 업데이트 (관리자 전용)

    90개 유효 거래일이 있고 정밀도 복구가 완료된 종목에 대해 MA90 계산 후 Stock.ma90_price 업데이트
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")

    from app.moving_averages import update_ma90
    stocks = db.query(Stock).filter(Stock.is_active == True).all()
    updated = sum(update_ma90(stock.id, db) is not None for stock in stocks)
    db.commit()
    invalidate_cache()
    return {"success": True, "updated_count": updated, "skipped_count": len(stocks) - updated}


@router.get("/api/admin/db-stats")
def get_db_stats(db: Session = Depends(get_db)):
    """DB 통계 조회 (인증 불필요 - 디버깅용)"""
    from sqlalchemy import func

    # 전체 종목 수
    total_stocks = db.query(func.count(Stock.id)).scalar()

    # 마켓별 종목 수
    us_stocks = db.query(func.count(Stock.id)).filter(Stock.market == 'US').scalar()
    kr_stocks = db.query(func.count(Stock.id)).filter(Stock.market == 'KR').scalar()

    # 활성 종목 수
    active_us = db.query(func.count(Stock.id)).filter(
        Stock.market == 'US',
        Stock.is_active == True
    ).scalar()

    # 히스토리 60일 이상 종목 수
    stocks_with_history = db.query(func.count(Stock.id)).filter(
        Stock.market == 'US',
        Stock.is_active == True,
        Stock.history_records_count >= 60
    ).scalar()

    # 히스토리 없는 종목 수
    stocks_no_history = db.query(func.count(Stock.id)).filter(
        Stock.market == 'US',
        Stock.is_active == True,
        (Stock.history_records_count == None) | (Stock.history_records_count == 0)
    ).scalar()

    # 중복 symbol 체크
    duplicate_symbols = db.query(
        Stock.symbol,
        func.count(Stock.id).label('count')
    ).group_by(Stock.symbol).having(func.count(Stock.id) > 1).all()

    # 거래소별 종목 수
    by_exchange = db.query(
        Stock.exchange,
        func.count(Stock.id)
    ).filter(Stock.market == 'US').group_by(Stock.exchange).all()

    return {
        "total_stocks": total_stocks,
        "us_stocks": us_stocks,
        "kr_stocks": kr_stocks,
        "active_us_stocks": active_us,
        "us_stocks_with_60_plus_history": stocks_with_history,
        "us_stocks_no_history": stocks_no_history,
        "duplicate_symbols_count": len(duplicate_symbols),
        "us_by_exchange": {ex or "unknown": cnt for ex, cnt in by_exchange}
    }
