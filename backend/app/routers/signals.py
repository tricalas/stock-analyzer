from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional
from datetime import datetime, date, timedelta
import logging
import hashlib
import json
import orjson

from app.database import get_db
from app.models import Stock, StockPriceHistory, StockTagAssignment, User, StockSignal
from app import schemas
from app.auth import get_current_user, get_admin_user
from app.signal_analyzer import signal_analyzer
from app.ma_signal_analyzer import ma_signal_analyzer
from app.tasks import analyze_signals_task, analyze_ma_signals_task
import uuid

from app.cache import get_cache, set_cache
logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.post("/api/signals/ma/refresh", dependencies=[Depends(get_admin_user)])
def refresh_ma_signals(
    mode: str = Query("all", pattern="^(tagged|all|top)$"),
    limit: int = Query(500, ge=10, le=2000),
    days: int = Query(150, ge=90, le=500),
    force_full: bool = Query(False, description="True면 델타 무시하고 전체 스캔"),
    current_user: User = Depends(get_current_user)
):
    """
    MA 기반 시그널 분석 (Celery 백그라운드 작업)

    골든크로스, 이평선 지지/저항, 이평선 돌파, 이평선 배열 시그널 분석

    Args:
        mode: 분석 모드 (tagged, all, top)
        limit: top 모드일 때 상위 몇 개
        days: 분석할 일수 (MA 90일 계산에 최소 90일 필요)
        force_full: True면 델타 무시하고 전체 스캔

    Returns:
        작업 시작 메시지와 task_id
    """
    import threading

    task_id = str(uuid.uuid4())

    try:
        analyze_ma_signals_task.apply_async(
            kwargs={
                "task_id": task_id,
                "mode": mode,
                "limit": limit,
                "days": days,
                "force_full": force_full
            },
            task_id=task_id
        )
        execution_mode = "celery"
        logger.info(f"✅ MA signal analysis queued via Celery (task_id: {task_id})")
    except Exception as e:
        logger.warning(f"⚠️ Celery unavailable ({e}), falling back to thread")

        def run_analysis():
            try:
                ma_signal_analyzer.analyze_and_store_signals(
                    mode=mode,
                    limit=limit,
                    days=days,
                    force_full=force_full,
                    task_id=task_id
                )
            except Exception as ex:
                logger.error(f"MA signal analysis failed: {ex}")

        thread = threading.Thread(target=run_analysis, daemon=True)
        thread.start()
        execution_mode = "thread"

    delta_msg = "전체 스캔" if force_full else "델타 분석 (변경된 종목만)"
    return {
        "success": True,
        "message": f"MA 시그널 분석 작업이 시작되었습니다 (mode: {mode}, {delta_msg})",
        "mode": mode,
        "days": days,
        "force_full": force_full,
        "task_id": task_id,
        "execution_mode": execution_mode,
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다. GET /api/tasks/{task_id}로 진행 상황을 확인하세요."
    }


@router.post("/api/signals/refresh", dependencies=[Depends(get_admin_user)])
def refresh_signals(
    mode: str = Query("all", pattern="^(tagged|all|top)$"),
    limit: int = Query(500, ge=10, le=2000),
    days: int = Query(120, ge=60, le=365),
    force_full: bool = Query(False, description="True면 델타 무시하고 전체 스캔"),
    current_user: User = Depends(get_current_user)
):
    """
    매매 시그널 재분석 (Celery 백그라운드 작업)

    브라우저를 닫아도 작업이 계속 실행됩니다.
    서버가 재시작되어도 Redis 큐에서 작업이 유지됩니다.

    Args:
        mode: 분석 모드 (tagged, all, top)
        limit: top 모드일 때 상위 몇 개
        days: 분석할 일수
        force_full: True면 델타 무시하고 전체 스캔 (기본: False = 변경된 종목만)

    Returns:
        작업 시작 메시지와 task_id
    """
    import threading

    # task_id 생성
    task_id = str(uuid.uuid4())

    # Celery 태스크 시도, 실패 시 스레드로 폴백
    try:
        analyze_signals_task.apply_async(
            kwargs={
                "task_id": task_id,
                "mode": mode,
                "limit": limit,
                "days": days,
                "force_full": force_full
            },
            task_id=task_id
        )
        execution_mode = "celery"
        logger.info(f"✅ Signal analysis queued via Celery (task_id: {task_id})")
    except Exception as e:
        logger.warning(f"⚠️ Celery unavailable ({e}), falling back to thread")

        # 스레드로 폴백 실행
        def run_analysis():
            try:
                signal_analyzer.analyze_and_store_signals(
                    mode=mode,
                    limit=limit,
                    days=days,
                    force_full=force_full,
                    task_id=task_id
                )
            except Exception as ex:
                logger.error(f"Signal analysis failed: {ex}")

        thread = threading.Thread(target=run_analysis, daemon=True)
        thread.start()
        execution_mode = "thread"

    delta_msg = "전체 스캔" if force_full else "델타 분석 (변경된 종목만)"
    return {
        "success": True,
        "message": f"시그널 분석 작업이 시작되었습니다 (mode: {mode}, {delta_msg})",
        "mode": mode,
        "days": days,
        "force_full": force_full,
        "task_id": task_id,
        "execution_mode": execution_mode,
        "note": "브라우저를 닫아도 작업이 계속 실행됩니다. GET /api/tasks/{task_id}로 진행 상황을 확인하세요."
    }


@router.get("/api/signals/ma")
def get_ma_signals(
    skip: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    strategy: Optional[str] = Query(None, description="전략 필터 (golden_cross, death_cross, ma_support, ma_resistance, ma_breakout_up, ma_breakout_down, ma_bullish_alignment, ma_bearish_alignment)"),
    signal_type: Optional[str] = Query(None, pattern="^(buy|sell)$"),
    db: Session = Depends(get_db)
):
    """
    MA 기반 시그널 목록 조회

    Args:
        skip: 오프셋
        limit: 페이지 크기
        strategy: 전략 필터 (선택적)
        signal_type: buy/sell 필터 (선택적)

    Returns:
        시그널 목록과 통계
    """
    # MA 시그널 전략명 목록
    ma_strategies = [
        'golden_cross', 'death_cross',
        'ma_support', 'ma_resistance',
        'ma_breakout_up', 'ma_breakout_down',
        'ma_bullish_alignment', 'ma_bearish_alignment'
    ]

    # 최근 10일 시그널만
    ten_days_ago = date.today() - timedelta(days=10)

    query = db.query(StockSignal).filter(
        StockSignal.is_active == True,
        StockSignal.strategy_name.in_(ma_strategies),
        StockSignal.signal_date >= ten_days_ago
    )

    if strategy:
        query = query.filter(StockSignal.strategy_name == strategy)

    if signal_type:
        query = query.filter(StockSignal.signal_type == signal_type)

    # 전체 개수
    total = query.count()

    # 통계
    all_signals = query.all()
    positive_count = sum(1 for s in all_signals if s.return_percent and s.return_percent > 0)
    negative_count = sum(1 for s in all_signals if s.return_percent and s.return_percent < 0)
    returns = [s.return_percent for s in all_signals if s.return_percent is not None]
    avg_return = sum(returns) / len(returns) if returns else 0

    # 페이지네이션
    signals = query.order_by(desc(StockSignal.signal_date), desc(StockSignal.id)).offset(skip).limit(limit).all()

    # 종목 정보 조인
    result_signals = []
    for signal in signals:
        stock = db.query(Stock).filter(Stock.id == signal.stock_id).first()
        if stock:
            result_signals.append({
                "id": signal.id,
                "stock_id": signal.stock_id,
                "symbol": stock.symbol,
                "freshness": stock.freshness,
                "name": stock.name,
                "exchange": stock.exchange,
                "signal_type": signal.signal_type,
                "signal_date": signal.signal_date.isoformat(),
                "signal_price": signal.signal_price,
                "strategy_name": signal.strategy_name,
                "current_price": signal.current_price,
                "return_percent": signal.return_percent,
                "details": json.loads(signal.details) if signal.details else {},
                "analyzed_at": signal.analyzed_at.isoformat() if signal.analyzed_at else None
            })

    return {
        "signals": result_signals,
        "total": total,
        "stats": {
            "total_signals": total,
            "positive_returns": positive_count,
            "negative_returns": negative_count,
            "avg_return": round(avg_return, 2)
        },
        "analyzed_at": max((s.analyzed_at for s in all_signals if s.analyzed_at), default=None)
    }


@router.delete("/api/signals/ma", dependencies=[Depends(get_admin_user)])
def delete_ma_signals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    모든 MA 시그널 삭제
    """
    ma_strategies = [
        'golden_cross', 'death_cross',
        'ma_support', 'ma_resistance',
        'ma_breakout_up', 'ma_breakout_down',
        'ma_bullish_alignment', 'ma_bearish_alignment'
    ]

    deleted_count = db.query(StockSignal).filter(
        StockSignal.strategy_name.in_(ma_strategies)
    ).delete(synchronize_session=False)

    db.commit()

    logger.info(f"Deleted {deleted_count} MA signals")

    return {
        "success": True,
        "message": f"{deleted_count}개 MA 시그널이 삭제되었습니다",
        "deleted_count": deleted_count
    }


@router.get("/api/signals/dashboard")
def get_signal_dashboard(
    db: Session = Depends(get_db)
):
    """
    시그널 대시보드 통계

    Returns:
        전략별 시그널 분포, 수익률 통계, 최근 시그널
    """
    # 모든 시그널 전략명
    all_strategies = [
        # 기존 추세선 전략
        'descending_trendline_breakout', 'approaching_breakout', 'pullback_buy', 'doji_star',
        # MA 전략
        'golden_cross', 'death_cross',
        'ma_support', 'ma_resistance',
        'ma_breakout_up', 'ma_breakout_down',
        'ma_bullish_alignment', 'ma_bearish_alignment'
    ]

    # 최근 10일 시그널
    ten_days_ago = date.today() - timedelta(days=10)

    signals = db.query(StockSignal).filter(
        StockSignal.is_active == True,
        StockSignal.signal_date >= ten_days_ago
    ).all()

    # 전략별 카운트
    signals_by_strategy = {}
    for strategy in all_strategies:
        count = sum(1 for s in signals if s.strategy_name == strategy)
        if count > 0:
            signals_by_strategy[strategy] = count

    # 타입별 카운트
    signals_by_type = {
        "buy": sum(1 for s in signals if s.signal_type == 'buy'),
        "sell": sum(1 for s in signals if s.signal_type == 'sell')
    }

    # 수익률 통계
    returns = [s.return_percent for s in signals if s.return_percent is not None]
    positive_count = sum(1 for r in returns if r > 0)
    negative_count = sum(1 for r in returns if r < 0)
    avg_return = sum(returns) / len(returns) if returns else 0

    # 최근 시그널 (10개)
    recent_signals = db.query(StockSignal).filter(
        StockSignal.is_active == True,
        StockSignal.signal_date >= ten_days_ago
    ).order_by(desc(StockSignal.signal_date), desc(StockSignal.id)).limit(10).all()

    recent_signals_data = []
    for signal in recent_signals:
        stock = db.query(Stock).filter(Stock.id == signal.stock_id).first()
        if stock:
            recent_signals_data.append({
                "id": signal.id,
                "symbol": stock.symbol,
                "freshness": stock.freshness,
                "name": stock.name,
                "signal_type": signal.signal_type,
                "signal_date": signal.signal_date.isoformat(),
                "strategy_name": signal.strategy_name,
                "return_percent": signal.return_percent
            })

    return {
        "total_signals": len(signals),
        "signals_by_strategy": signals_by_strategy,
        "signals_by_type": signals_by_type,
        "positive_count": positive_count,
        "negative_count": negative_count,
        "avg_return": round(avg_return, 2),
        "recent_signals": recent_signals_data
    }


@router.get("/api/signals/scan")
def scan_all_tagged_stocks(
    days: int = Query(120, ge=60, le=365),
    mode: str = Query("all", pattern="^(tagged|all|top)$"),
    limit: int = Query(500, ge=10, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    종목 스캔하여 매수 시그널이 있는 종목 찾기

    Args:
        days: 분석할 일수 (60~365일, 기본 120일)
        mode: 스캔 모드 (tagged: 태그 종목만, all: 모든 활성 종목, top: 시총 상위)
        limit: top 모드일 때 스캔할 종목 수 (10~2000, 기본 500)

    Returns:
        매수 시그널이 있는 종목 리스트
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

            # 매수 시그널 확인
            buy_signals = result_df[result_df['buy_signal'] == 1]

            if len(buy_signals) > 0:
                last_signal = buy_signals.iloc[-1]
                latest_price = df.iloc[-1]['close']

                stocks_with_signals.append({
                    "stock_id": stock.id,
                    "symbol": stock.symbol,
                "freshness": stock.freshness,
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

    # 최근 시그널 순으로 정렬
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


@router.get("/api/signals", response_model=schemas.SignalListResponse)
def get_stored_signals(
    signal_type: Optional[str] = Query(None, description="Signal type filter (buy, sell)"),
    skip: int = Query(0, ge=0, description="Number of records to skip (for pagination)"),
    limit: int = Query(30, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    저장된 매매 시그널 조회 (DB에서 읽기만 함 - 빠름, 페이지네이션 지원)

    Args:
        signal_type: 시그널 타입 필터
        skip: 건너뛸 레코드 수 (페이지네이션용)
        limit: 최대 조회 개수

    Returns:
        저장된 시그널 목록 (최근 10일 이내)
    """
    from datetime import timedelta

    # 최근 10일 이내 시그널만 조회
    ten_days_ago = date.today() - timedelta(days=10)

    # 활성 시그널 조회 (최근 10일)
    query = db.query(StockSignal).filter(
        StockSignal.is_active == True,
        StockSignal.signal_date >= ten_days_ago
    )

    if signal_type:
        query = query.filter(StockSignal.signal_type == signal_type)

    # 최신 시그널부터 정렬된 쿼리
    ordered_query = query.order_by(desc(StockSignal.signal_date))

    # 첫 페이지에서는 전체 조회 후 슬라이싱 (중복 쿼리 방지)
    if skip == 0:
        all_signals = ordered_query.all()
        total = len(all_signals)
        signals = all_signals[:limit]
        # 통계 계산 (전체 데이터 기준)
        stats = {
            "total_signals": total,
            "positive_returns": len([s for s in all_signals if s.return_percent and s.return_percent > 0]),
            "negative_returns": len([s for s in all_signals if s.return_percent and s.return_percent < 0]),
            "avg_return": sum([s.return_percent or 0 for s in all_signals]) / total if total > 0 else 0
        }
    else:
        # 이후 페이지에서는 개별 쿼리
        total = query.count()
        signals = ordered_query.offset(skip).limit(limit).all()
        stats = None

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


@router.delete("/api/signals", dependencies=[Depends(get_admin_user)])
def delete_all_signals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    모든 시그널 삭제

    Returns:
        삭제된 시그널 수
    """
    deleted_count = db.query(StockSignal).delete()
    db.commit()

    logger.info(f"🗑️ Deleted {deleted_count} signals")

    return {
        "success": True,
        "deleted_count": deleted_count,
        "message": f"{deleted_count}개 시그널이 삭제되었습니다"
    }


@router.get("/api/stocks/{stock_id}/signals")
def get_trading_signals(
    stock_id: int,
    days: int = Query(120, ge=60, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    특정 종목의 추세선 돌파 + 되돌림 매매 시그널 조회

    Args:
        stock_id: 종목 ID
        days: 분석할 일수 (60~365일, 기본 120일)

    Returns:
        매매 시그널 및 전략 결과
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

    # 최근 매수 시그널 찾기
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
                "freshness": stock.freshness,
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


@router.get("/api/stocks/{stock_id}/ma-analysis")
def get_stock_ma_analysis(
    stock_id: int,
    days: int = Query(180, ge=30, le=365),
    db: Session = Depends(get_db)
):
    """
    개별 종목 MA 분석 데이터 (차트용)

    Args:
        stock_id: 종목 ID
        days: 조회 기간 (기본 180일)

    Returns:
        MA 값, 배열 상태, 차트 데이터, 최근 시그널
    """
    result = ma_signal_analyzer.get_stock_ma_analysis(stock_id, days, db)

    if not result:
        raise HTTPException(status_code=404, detail=f"Stock {stock_id} not found or insufficient price history")

    return result
