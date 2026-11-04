"""
매매 시그널 분석 및 저장 모듈
"""
import logging
import json
import uuid
from datetime import datetime, date
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models import Stock, StockPriceHistory, StockSignal, TaskProgress
from app.technical_indicators import generate_descending_trendline_breakout_signals, generate_approaching_breakout_signals, generate_pullback_signals
from app.database import get_db, SessionLocal

logger = logging.getLogger(__name__)


class SignalAnalyzer:
    """매매 시그널 분석 및 저장"""

    def __init__(self):
        self.strategy_name = "descending_trendline_breakout"

    def analyze_and_store_signals(
        self,
        mode: str = "all",
        limit: Optional[int] = None,
        days: int = 120,
        db: Optional[Session] = None,
        force_full: bool = False,
        task_id: Optional[str] = None
    ) -> Dict:
        """
        종목들의 시그널을 분석하고 DB에 저장

        Args:
            mode: 분석 모드 ("tagged", "all", "top")
            limit: top 모드일 때 상위 몇 개 종목
            days: 분석할 일수
            db: DB 세션 (없으면 자동 생성)
            force_full: True면 델타 무시하고 전체 스캔
            task_id: TaskProgress에 사용할 task_id (선택적, 없으면 자동 생성)

        Returns:
            분석 결과 통계
        """
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        # 작업 진행 상황 추적 생성 (task_id가 없으면 자동 생성)
        if task_id is None:
            task_id = str(uuid.uuid4())
        task_progress = None

        try:
            # 분석할 종목 선택 (delta_only: force_full이 아니면 델타만)
            delta_only = not force_full
            stock_ids = self._get_stock_ids_by_mode(mode, limit, db, delta_only=delta_only)

            logger.info(f"🔍 Starting signal analysis for {len(stock_ids)} stocks (mode: {mode})...")

            # TaskProgress 생성
            from app.task_progress import start_task
            task_progress = start_task(db, task_id, "signal_analysis", len(stock_ids),
                                       f"시그널 분석 시작 ({mode} 모드, {len(stock_ids)}개 종목)")

            total_stocks = len(stock_ids)
            signals_found = 0
            stocks_with_signals = 0
            total_signals_saved = 0

            for idx, stock_id in enumerate(stock_ids, 1):
                try:
                    # 종목 정보 조회 (진행 상황 표시용)
                    logger.info(f"📊 [{idx}/{total_stocks}] Starting analysis for stock_id={stock_id}")
                    stock = db.query(Stock).filter(Stock.id == stock_id).first()
                    stock_name = stock.name if stock else f"ID: {stock_id}"
                    logger.info(f"📊 [{idx}/{total_stocks}] Stock: {stock_name}")

                    # TaskProgress 업데이트
                    task_progress.current_item = idx
                    task_progress.current_stock_name = stock_name
                    task_progress.message = f"{idx}/{total_stocks} 종목 분석 중: {stock_name}"
                    db.commit()
                    logger.info(f"📊 [{idx}/{total_stocks}] TaskProgress updated")

                    result = self._analyze_stock(stock_id, days, db)
                    logger.info(f"📊 [{idx}/{total_stocks}] Analysis done: {result}")

                    if result['signals_count'] > 0:
                        stocks_with_signals += 1
                        signals_found += result['signals_count']
                        total_signals_saved += result['saved_count']
                        task_progress.success_count += 1
                    else:
                        task_progress.success_count += 1

                except Exception as e:
                    logger.error(f"❌ Error analyzing stock {stock_id}: {str(e)}")
                    import traceback
                    logger.error(traceback.format_exc())
                    db.rollback()
                    task_progress.failed_count += 1
                    db.commit()
                    continue

            # TaskProgress 완료 처리
            task_progress.status = "completed"
            task_progress.current_item = total_stocks
            task_progress.message = f"분석 완료: {stocks_with_signals}/{total_stocks} 종목에서 {total_signals_saved}개 시그널 발견"
            task_progress.completed_at = datetime.utcnow()
            db.commit()

            stats = {
                "total_stocks": total_stocks,
                "stocks_with_signals": stocks_with_signals,
                "total_signals_found": signals_found,
                "total_signals_saved": total_signals_saved,
                "analyzed_at": datetime.utcnow().isoformat(),
                "mode": mode,
                "task_id": task_id
            }

            logger.info(
                f"✅ Signal analysis completed: "
                f"{stocks_with_signals}/{total_stocks} stocks with signals, "
                f"{total_signals_saved} signals saved"
            )

            return stats

        except Exception as e:
            logger.error(f"❌ Error in signal analysis: {str(e)}")

            # TaskProgress 실패 처리
            db.rollback()
            if task_progress:
                task_progress.status = "failed"
                task_progress.error_message = str(e)
                task_progress.completed_at = datetime.utcnow()
                db.commit()

            db.rollback()
            raise
        finally:
            if close_db:
                db.close()

    def _get_stock_ids_by_mode(
        self,
        mode: str,
        limit: Optional[int],
        db: Session,
        delta_only: bool = True
    ) -> List[int]:
        """모드에 따라 분석할 종목 ID 목록 가져오기 (최적화됨, US 마켓만)"""
        from app.models import StockTagAssignment
        from sqlalchemy import func, or_

        if mode == "tagged":
            # 태그가 있는 US 종목만
            tagged_stocks = db.query(StockTagAssignment.stock_id).join(
                Stock, Stock.id == StockTagAssignment.stock_id
            ).filter(Stock.market == 'US', Stock.history_precision_version >= 1).distinct().all()
            stock_ids = set(sid[0] for sid in tagged_stocks)

        elif mode == "top":
            # 시총 상위 N개 (US만)
            top_stocks = db.query(Stock.id).filter(
                Stock.is_active == True,
                Stock.market == 'US',
                Stock.history_precision_version >= 1
            ).order_by(Stock.market_cap.desc().nullslast()).limit(limit or 500).all()
            stock_ids = set(s.id for s in top_stocks)

        else:  # "all"
            # 모든 활성 US 종목
            all_stocks = db.query(Stock.id).filter(
                Stock.is_active == True,
                Stock.market == 'US',
                Stock.history_precision_version >= 1
            ).all()
            stock_ids = set(s.id for s in all_stocks)

        # 히스토리 데이터가 60일 이상인 종목 한 번에 조회 (최적화)
        history_counts = db.query(
            StockPriceHistory.stock_id
        ).group_by(StockPriceHistory.stock_id).having(
            func.count(StockPriceHistory.id) >= 60
        ).all()
        stocks_with_history = set(row.stock_id for row in history_counts)

        # 교집합: 선택된 종목 중 히스토리가 60일 이상인 종목
        filtered_ids = list(stock_ids & stocks_with_history)
        total_with_history = len(filtered_ids)

        logger.info(f"Mode: {mode}, Total stocks: {len(stock_ids)}, With 60+ history: {total_with_history}")

        # 델타 필터링: 히스토리가 업데이트된 종목만 분석
        if delta_only and filtered_ids:
            delta_stocks = db.query(Stock.id).filter(
                Stock.id.in_(filtered_ids),
                or_(
                    Stock.signal_analyzed_at == None,
                    Stock.history_updated_at > Stock.signal_analyzed_at
                )
            ).all()
            filtered_ids = [s.id for s in delta_stocks]
            logger.info(f"Delta filter: {len(filtered_ids)} stocks need re-analysis (skipped: {total_with_history - len(filtered_ids)})")

        return filtered_ids

    def _analyze_stock(self, stock_id: int, days: int, db: Session) -> Dict:
        # Serialize competing analyses for this stock and replace signals atomically.
        stock = db.query(Stock).filter(Stock.id == stock_id).with_for_update().first()
        if stock is None:
            return {"signals_count": 0, "saved_count": 0}
        from datetime import timedelta
        history = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id,
            StockPriceHistory.date >= date.today() - timedelta(days=days)
        ).order_by(StockPriceHistory.date.asc()).all()
        if len(history) < 60:
            db.commit()
            return {"signals_count": 0, "saved_count": 0}
        signals = self._run_signal_analysis(history, stock.current_price)
        db.query(StockSignal).filter(
            StockSignal.stock_id == stock_id,
            StockSignal.strategy_name.in_(['descending_trendline_breakout', 'approaching_breakout', 'pullback_buy', 'doji_star'])
        ).delete(synchronize_session=False)
        saved_count = self._save_signals(stock_id, signals, db)
        stock.signal_analyzed_at = datetime.utcnow()
        db.commit()
        return {"signals_count": len(signals), "saved_count": saved_count}

    def _check_breakout_confirmation(
        self,
        stock_id: int,
        price_history: List[StockPriceHistory],
        db: Session
    ):
        """기존 '돌파 임박' 시그널의 실제 돌파 여부 확인 및 업데이트"""
        from datetime import timedelta

        # 최근 10일 내 "돌파 임박" 시그널 중 아직 확인되지 않은 것들
        recent_approaching = db.query(StockSignal).filter(
            StockSignal.stock_id == stock_id,
            StockSignal.strategy_name == "approaching_breakout",
            StockSignal.signal_date >= date.today() - timedelta(days=10)
        ).all()

        if not recent_approaching:
            return

        # 가격 데이터를 날짜로 인덱싱
        price_by_date = {ph.date: ph for ph in price_history}

        for signal in recent_approaching:
            try:
                details = json.loads(signal.details) if signal.details else {}

                # 이미 확인된 시그널는 스킵
                if details.get('breakout_confirmed') is not None:
                    continue

                signal_date = signal.signal_date
                slope = details.get('trendline_slope', 0)
                intercept = details.get('trendline_intercept', 0)

                if slope >= 0:  # 하락 추세가 아니면 스킵
                    continue

                # 시그널 발생 후 3일 내 돌파 확인
                breakout_confirmed = False
                breakout_date = None

                # 날짜 인덱스 찾기
                all_dates = sorted(price_by_date.keys())
                try:
                    signal_idx = all_dates.index(signal_date)
                except ValueError:
                    continue

                # 시그널 다음날부터 3일간 확인
                for i in range(signal_idx + 1, min(signal_idx + 4, len(all_dates))):
                    check_date = all_dates[i]
                    ph = price_by_date.get(check_date)
                    if not ph:
                        continue

                    # 해당 날짜의 추세선 값 계산
                    trendline_value = slope * i + intercept

                    # 돌파 확인 (고가가 추세선 위)
                    if ph.high_price > trendline_value:
                        breakout_confirmed = True
                        breakout_date = check_date
                        break

                # 시그널 업데이트
                details['breakout_confirmed'] = breakout_confirmed
                if breakout_date:
                    details['breakout_date'] = breakout_date.isoformat()
                details['checked_at'] = datetime.utcnow().isoformat()

                signal.details = json.dumps(details)
                signal.updated_at = datetime.utcnow()

            except Exception as e:
                logger.error(f"Error checking breakout confirmation: {str(e)}")
                continue

    def _run_signal_analysis(
        self,
        price_history: List[StockPriceHistory],
        current_price: Optional[float]
    ) -> List[Dict]:
        """실제 시그널 분석 로직 실행 (돌파 + 돌파 임박)"""
        try:
            import pandas as pd

            # DataFrame 생성
            data = []
            for ph in price_history:
                data.append({
                    'date': ph.date,
                    'open': ph.open_price,
                    'high': ph.high_price,
                    'low': ph.low_price,
                    'close': ph.close_price,
                    'volume': ph.volume or 0
                })

            df = pd.DataFrame(data)
            df.set_index('date', inplace=True)
            df.sort_index(inplace=True)

            signals = []

            # 90일 이동평균선 계산
            sma_90_series = df['close'].rolling(window=90, min_periods=60).mean()

            # 1. 실제 돌파 시그널
            breakout_df = generate_descending_trendline_breakout_signals(
                df,
                swing_window=5,
                min_touches=3
            )
            breakout_df['sma_90'] = sma_90_series

            # 돌파 인덱스 추출 (되돌림 시그널에서 사용)
            breakout_indices = []
            slope = breakout_df['trendline_slope'].iloc[0] if len(breakout_df) > 0 else 0
            intercept = breakout_df['trendline_intercept'].iloc[0] if len(breakout_df) > 0 else 0

            buy_signals = breakout_df[breakout_df['buy_signal'] == 1].copy()
            for idx, row in buy_signals.iterrows():
                # 정수 인덱스 저장 (되돌림 분석용)
                int_idx = df.index.get_loc(idx)
                breakout_indices.append(int_idx)

                signal_price = row.get('close', 0)
                sma_90 = row.get('sma_90', 0)
                return_pct = 0.0
                sma_90_ratio = 0.0

                if current_price and signal_price > 0:
                    return_pct = ((current_price - signal_price) / signal_price) * 100

                if sma_90 and sma_90 > 0:
                    sma_90_ratio = (signal_price / sma_90) * 100

                signal_info = {
                    'signal_type': 'buy',
                    'strategy_name': 'descending_trendline_breakout',
                    'signal_date': idx.date() if hasattr(idx, 'date') else idx,
                    'signal_price': float(signal_price),
                    'current_price': float(current_price) if current_price else None,
                    'return_percent': float(round(return_pct, 2)),
                    'details': {
                        'strategy': 'descending_trendline_breakout',
                        'trendline_slope': float(row.get('trendline_slope', 0)),
                        'trendline_intercept': float(row.get('trendline_intercept', 0)),
                        'sma_90': float(sma_90) if sma_90 else None,
                        'sma_90_ratio': float(round(sma_90_ratio, 1)) if sma_90_ratio else None
                    }
                }
                signals.append(signal_info)

            # 1.5. 되돌림(Pullback) 시그널 (돌파가 있는 경우에만)
            if breakout_indices and slope < 0:
                pullback_df = generate_pullback_signals(
                    df,
                    breakout_indices=breakout_indices,
                    slope=slope,
                    intercept=intercept,
                    pullback_threshold=3.0  # 추세선의 3% 이내
                )
                pullback_df['sma_90'] = sma_90_series

                # 최근 10일 데이터만 필터링 (최근 되돌림만)
                recent_dates = df.index[-10:] if len(df) >= 10 else df.index
                pullback_signals_df = pullback_df[
                    (pullback_df['pullback_signal'] == 1) &
                    (pullback_df.index.isin(recent_dates))
                ].copy()

                for idx, row in pullback_signals_df.iterrows():
                    signal_price = row.get('close', 0)
                    sma_90 = row.get('sma_90', 0)
                    distance = row.get('pullback_distance', 0)
                    return_pct = 0.0
                    sma_90_ratio = 0.0

                    if current_price and signal_price > 0:
                        return_pct = ((current_price - signal_price) / signal_price) * 100

                    if sma_90 and sma_90 > 0:
                        sma_90_ratio = (signal_price / sma_90) * 100

                    signal_info = {
                        'signal_type': 'pullback',
                        'strategy_name': 'pullback_buy',
                        'signal_date': idx.date() if hasattr(idx, 'date') else idx,
                        'signal_price': float(signal_price),
                        'current_price': float(current_price) if current_price else None,
                        'return_percent': float(round(return_pct, 2)),
                        'details': {
                            'strategy': 'pullback_buy',
                            'trendline_slope': float(slope),
                            'trendline_intercept': float(intercept),
                            'pullback_distance': float(round(distance, 2)) if distance else None,
                            'sma_90': float(sma_90) if sma_90 else None,
                            'sma_90_ratio': float(round(sma_90_ratio, 1)) if sma_90_ratio else None
                        }
                    }
                    signals.append(signal_info)

            # 2. 돌파 임박 시그널 (최근 5일만)
            approaching_df = generate_approaching_breakout_signals(
                df,
                swing_window=5,
                min_touches=3,
                approach_threshold=3.0  # 추세선 3% 이내 접근
            )
            approaching_df['sma_90'] = sma_90_series

            # 최근 5일 데이터만 필터링
            recent_dates = df.index[-5:] if len(df) >= 5 else df.index
            approaching_signals = approaching_df[
                (approaching_df['approaching_signal'] == 1) &
                (approaching_df.index.isin(recent_dates))
            ].copy()

            for idx, row in approaching_signals.iterrows():
                signal_price = row.get('close', 0)
                sma_90 = row.get('sma_90', 0)
                distance = row.get('distance_to_trendline', 0)
                return_pct = 0.0
                sma_90_ratio = 0.0

                if current_price and signal_price > 0:
                    return_pct = ((current_price - signal_price) / signal_price) * 100

                if sma_90 and sma_90 > 0:
                    sma_90_ratio = (signal_price / sma_90) * 100

                signal_info = {
                    'signal_type': 'approaching',
                    'strategy_name': 'approaching_breakout',
                    'signal_date': idx.date() if hasattr(idx, 'date') else idx,
                    'signal_price': float(signal_price),
                    'current_price': float(current_price) if current_price else None,
                    'return_percent': float(round(return_pct, 2)),
                    'details': {
                        'strategy': 'approaching_breakout',
                        'trendline_slope': float(row.get('trendline_slope', 0)),
                        'trendline_intercept': float(row.get('trendline_intercept', 0)),
                        'distance_to_trendline': float(round(distance, 2)) if distance else None,
                        'sma_90': float(sma_90) if sma_90 else None,
                        'sma_90_ratio': float(round(sma_90_ratio, 1)) if sma_90_ratio else None,
                        'breakout_confirmed': None,  # 아직 확인 안됨
                        'breakout_date': None
                    }
                }
                signals.append(signal_info)

            # 3. Doji(샛별형) 패턴 시그널
            doji_signals = self._detect_doji_pattern(df, current_price)
            signals.extend(doji_signals)

            return signals

        except Exception as e:
            logger.error(f"Error running signal analysis: {str(e)}")
            raise

    def _detect_doji_pattern(self, df, current_price: Optional[float]) -> List[Dict]:
        """
        납작한 봉(Doji-like) 패턴 감지

        조건:
        - 몸통 크기: |종가-시가|/시가 <= 1%
        - 위꼬리, 아래꼬리 모두 존재
        - 샛별봉 종가 > 전날 종가
        - 최근 3일 이내만 시그널로 기록
        """
        signals = []
        today = date.today()

        for i in range(1, len(df)):  # i=1부터 (전날 비교 필요)
            row = df.iloc[i]
            prev_row = df.iloc[i - 1]  # 전날
            signal_date = df.index[i].date() if hasattr(df.index[i], 'date') else df.index[i]

            # 최근 3일 이내만
            if (today - signal_date).days > 3:
                continue

            # 몸통 크기 계산
            body_size = abs(row['close'] - row['open'])
            body_ratio = body_size / row['open'] if row['open'] > 0 else 0

            # 꼬리 계산
            upper_wick = row['high'] - max(row['open'], row['close'])
            lower_wick = min(row['open'], row['close']) - row['low']

            # 조건: 작은 몸통(1% 이내) + 위아래 꼬리 존재 + 전날보다 종가 상승
            is_small_body = body_ratio <= 0.01
            has_both_wicks = upper_wick > 0 and lower_wick > 0
            is_higher_close = row['close'] > prev_row['close']

            if is_small_body and has_both_wicks and is_higher_close:
                signal_price = row['close']
                return_pct = 0.0
                if current_price and signal_price > 0:
                    return_pct = ((current_price - signal_price) / signal_price) * 100

                signals.append({
                    'signal_type': 'buy',
                    'strategy_name': 'doji_star',
                    'signal_date': signal_date,
                    'signal_price': float(signal_price),
                    'current_price': float(current_price) if current_price else None,
                    'return_percent': float(round(return_pct, 2)),
                    'details': {
                        'pattern': 'doji_star',
                        'body_ratio': round(body_ratio * 100, 3),
                        'upper_wick': round(upper_wick, 2),
                        'lower_wick': round(lower_wick, 2),
                        'open': row['open'],
                        'close': row['close'],
                        'high': row['high'],
                        'low': row['low'],
                        'prev_close': prev_row['close'],
                    }
                })

        return signals

    def _save_signals(self, stock_id: int, signals: List[Dict], db: Session) -> int:
        from app.signal_store import save_signals
        return save_signals(db, stock_id, signals, self.strategy_name)

    def get_active_signals(
        self,
        db: Session,
        signal_type: Optional[str] = None,
        limit: int = 100
    ) -> List[StockSignal]:
        """저장된 활성 시그널 조회"""
        query = db.query(StockSignal).filter(StockSignal.is_active == True)

        if signal_type:
            query = query.filter(StockSignal.signal_type == signal_type)

        # 최신 시그널부터
        signals = query.order_by(
            desc(StockSignal.signal_date)
        ).limit(limit).all()

        return signals


# 전역 인스턴스
signal_analyzer = SignalAnalyzer()
