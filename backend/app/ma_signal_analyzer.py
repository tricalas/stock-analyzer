"""
이동평균(MA) 기반 시그널 분석 모듈

전략:
1. 골든크로스 / 데드크로스 (20일/60일 MA 교차)
2. 이평선 지지/저항 (20, 60, 90일 MA에서 반등/저항)
3. 이평선 돌파 (MA 상향/하향 돌파)
4. 이평선 배열 (정배열/역배열) - 20, 60, 90일 사용
"""
import logging
import json
import uuid
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Tuple
import pandas as pd
import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_, func

from app.models import Stock, StockPriceHistory, StockSignal, TaskProgress, StockTagAssignment
from app.database import get_db, SessionLocal

logger = logging.getLogger(__name__)


class MASignalAnalyzer:
    """이동평균 기반 시그널 분석기"""

    # MA 기간 설정
    MA_PERIODS = [20, 60, 90]

    # 지지/저항 감지 허용 오차 (%)
    SUPPORT_RESISTANCE_THRESHOLD = 2.0

    # 시그널 타입별 전략명
    STRATEGY_NAMES = [
        'golden_cross',
        'death_cross',
        'ma_support',
        'ma_resistance',
        'ma_breakout_up',
        'ma_breakout_down',
        'ma_bullish_alignment',
        'ma_bearish_alignment'
    ]

    def analyze_and_store_signals(
        self,
        mode: str = "all",
        limit: Optional[int] = None,
        days: int = 150,  # MA 90일 계산을 위한 기간
        db: Optional[Session] = None,
        force_full: bool = False,
        task_id: Optional[str] = None
    ) -> Dict:
        """
        MA 시그널 분석 및 DB 저장

        Args:
            mode: 분석 모드 ("tagged", "all", "top")
            limit: top 모드일 때 상위 몇 개 종목
            days: 분석할 일수 (MA 90일 계산에 최소 90일 필요)
            db: DB 세션 (없으면 자동 생성)
            force_full: True면 델타 무시하고 전체 스캔
            task_id: TaskProgress에 사용할 task_id

        Returns:
            분석 결과 통계
        """
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        if task_id is None:
            task_id = str(uuid.uuid4())
        task_progress = None

        try:
            # 분석할 종목 선택
            delta_only = not force_full
            stock_ids = self._get_stock_ids_by_mode(mode, limit, db, delta_only=delta_only)

            logger.info(f"🔍 Starting MA signal analysis for {len(stock_ids)} stocks (mode: {mode})...")

            # TaskProgress 생성
            from app.task_progress import start_task
            task_progress = start_task(db, task_id, "ma_signal_analysis", len(stock_ids),
                                       f"MA 시그널 분석 시작 ({mode} 모드, {len(stock_ids)}개 종목)")

            total_stocks = len(stock_ids)
            signals_found = 0
            stocks_with_signals = 0
            total_signals_saved = 0

            for idx, stock_id in enumerate(stock_ids, 1):
                try:
                    # 취소 확인
                    db.refresh(task_progress)
                    if task_progress.status == "cancelled":
                        logger.info(f"🛑 Task cancelled by user")
                        break

                    stock = db.query(Stock).filter(Stock.id == stock_id).first()
                    stock_name = stock.name if stock else f"ID: {stock_id}"

                    # TaskProgress 업데이트
                    task_progress.current_item = idx
                    task_progress.current_stock_name = stock_name
                    task_progress.message = f"{idx}/{total_stocks} 종목 분석 중: {stock_name}"
                    db.commit()

                    result = self._analyze_stock(stock_id, days, db)

                    if result['signals_count'] > 0:
                        stocks_with_signals += 1
                        signals_found += result['signals_count']
                        total_signals_saved += result['saved_count']

                    task_progress.success_count += 1
                    db.commit()

                except Exception as e:
                    logger.error(f"❌ Error analyzing stock {stock_id}: {str(e)}")
                    import traceback
                    logger.error(traceback.format_exc())
                    db.rollback()
                    task_progress.failed_count += 1
                    db.commit()
                    continue

            # TaskProgress 완료 처리
            if task_progress.status != "cancelled":
                task_progress.status = "completed"
            task_progress.current_item = task_progress.success_count + task_progress.failed_count
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
                f"✅ MA signal analysis completed: "
                f"{stocks_with_signals}/{total_stocks} stocks with signals, "
                f"{total_signals_saved} signals saved"
            )

            return stats

        except Exception as e:
            logger.error(f"❌ Error in MA signal analysis: {str(e)}")

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
        """모드에 따라 분석할 종목 ID 목록 가져오기 (US 마켓만)"""

        if mode == "tagged":
            tagged_stocks = db.query(StockTagAssignment.stock_id).join(
                Stock, Stock.id == StockTagAssignment.stock_id
            ).filter(Stock.market == 'US', Stock.history_precision_version >= 1).distinct().all()
            stock_ids = set(sid[0] for sid in tagged_stocks)

        elif mode == "top":
            top_stocks = db.query(Stock.id).filter(
                Stock.is_active == True,
                Stock.market == 'US',
                Stock.history_precision_version >= 1
            ).order_by(Stock.market_cap.desc().nullslast()).limit(limit or 500).all()
            stock_ids = set(s.id for s in top_stocks)

        else:  # "all"
            all_stocks = db.query(Stock.id).filter(
                Stock.is_active == True,
                Stock.market == 'US',
                Stock.history_precision_version >= 1
            ).all()
            stock_ids = set(s.id for s in all_stocks)

        # MA 90일 계산을 위해 최소 90일 히스토리 필요
        history_counts = db.query(
            StockPriceHistory.stock_id
        ).group_by(StockPriceHistory.stock_id).having(
            func.count(StockPriceHistory.id) >= 90
        ).all()
        stocks_with_history = set(row.stock_id for row in history_counts)

        filtered_ids = list(stock_ids & stocks_with_history)
        total_with_history = len(filtered_ids)

        logger.info(f"Mode: {mode}, Total stocks: {len(stock_ids)}, With 90+ history: {total_with_history}")

        # MA 분석은 기존 추세선 분석과 독립적으로 추적합니다.
        if delta_only and filtered_ids:
            delta_stocks = db.query(Stock.id).filter(
                Stock.id.in_(filtered_ids),
                or_(
                    Stock.ma_signal_analyzed_at == None,
                    Stock.history_updated_at > Stock.ma_signal_analyzed_at
                )
            ).all()
            filtered_ids = [s.id for s in delta_stocks]
            logger.info(f"Delta filter: {len(filtered_ids)} stocks need re-analysis")

        return filtered_ids

    def _analyze_stock(self, stock_id: int, days: int, db: Session, end_date: date = None) -> Dict:
        # Serialize competing analyses for this stock and replace signals atomically.
        stock = db.query(Stock).filter(Stock.id == stock_id).with_for_update().first()
        if stock is None:
            return {"signals_count": 0, "saved_count": 0}
        from datetime import timedelta
        from app.market_clock import latest_session
        completed = latest_session(market=stock.market)[0]
        end_date = min(end_date, completed) if end_date else completed
        history = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id,
            StockPriceHistory.date >= end_date - timedelta(days=days),
            StockPriceHistory.date <= end_date
        ).order_by(StockPriceHistory.date.asc()).all()
        if len(history) < 90:
            db.commit()
            return {"signals_count": 0, "saved_count": 0}
        signals = self._run_signal_analysis(history, stock.current_price)
        db.query(StockSignal).filter(
            StockSignal.stock_id == stock_id,
            StockSignal.strategy_name.in_(self.STRATEGY_NAMES)
        ).delete(synchronize_session=False)
        saved_count = self._save_signals(stock_id, signals, db)
        stock.ma_signal_analyzed_at = datetime.utcnow()
        stock.ma_signal_as_of_date = history[-1].date
        db.commit()
        return {"signals_count": len(signals), "saved_count": saved_count}

    def _run_signal_analysis(
        self,
        price_history: List[StockPriceHistory],
        current_price: Optional[float]
    ) -> List[Dict]:
        """MA 시그널 분석 로직"""
        try:
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

            # MA 계산
            df = self._calculate_moving_averages(df)

            signals = []

            # 1. 골든크로스 / 데드크로스
            cross_signals = self._detect_golden_death_cross(df, current_price)
            signals.extend(cross_signals)

            # 2. 이평선 지지/저항
            sr_signals = self._detect_ma_support_resistance(df, current_price)
            signals.extend(sr_signals)

            # 3. 이평선 돌파
            breakout_signals = self._detect_ma_breakouts(df, current_price)
            signals.extend(breakout_signals)

            # 4. 이평선 배열
            alignment_signals = self._detect_ma_alignment(df, current_price)
            signals.extend(alignment_signals)

            return signals

        except Exception as e:
            logger.error(f"Error in MA signal analysis: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    def _calculate_moving_averages(self, df: pd.DataFrame) -> pd.DataFrame:
        """이동평균 계산"""
        for period in self.MA_PERIODS:
            df[f'ma_{period}'] = df['close'].rolling(window=period, min_periods=period).mean()
        return df

    def _detect_golden_death_cross(
        self,
        df: pd.DataFrame,
        current_price: Optional[float]
    ) -> List[Dict]:
        """골든크로스 / 데드크로스 감지 (20일/60일 교차)"""
        signals = []
        today = date.today()

        # MA 20, 60 필요
        if 'ma_20' not in df.columns or 'ma_60' not in df.columns:
            return signals

        # NaN이 아닌 데이터만
        valid_df = df.dropna(subset=['ma_20', 'ma_60'])
        if len(valid_df) < 2:
            return signals

        # 최근 10일만 검사 (오래된 시그널은 제외)
        recent_dates = valid_df.index[-10:] if len(valid_df) >= 10 else valid_df.index

        for i in range(1, len(valid_df)):
            idx = valid_df.index[i]
            signal_date = idx if isinstance(idx, date) else idx.date()

            # 최근 10일만
            if idx not in recent_dates:
                continue

            prev_idx = valid_df.index[i - 1]

            ma20_prev = valid_df.loc[prev_idx, 'ma_20']
            ma60_prev = valid_df.loc[prev_idx, 'ma_60']
            ma20_curr = valid_df.loc[idx, 'ma_20']
            ma60_curr = valid_df.loc[idx, 'ma_60']

            signal_price = float(valid_df.loc[idx, 'close'])
            return_pct = 0.0
            if current_price and signal_price > 0:
                return_pct = ((current_price - signal_price) / signal_price) * 100

            # 골든크로스: 20일선이 60일선 위로 교차
            if ma20_prev < ma60_prev and ma20_curr > ma60_curr:
                signals.append({
                    'signal_type': 'buy',
                    'strategy_name': 'golden_cross',
                    'signal_date': signal_date,
                    'signal_price': signal_price,
                    'current_price': float(current_price) if current_price else None,
                    'return_percent': float(round(return_pct, 2)),
                    'details': {
                        'ma_20': float(round(ma20_curr, 2)),
                        'ma_60': float(round(ma60_curr, 2)),
                        'cross_type': 'golden'
                    }
                })

            # 데드크로스: 20일선이 60일선 아래로 교차
            elif ma20_prev > ma60_prev and ma20_curr < ma60_curr:
                signals.append({
                    'signal_type': 'sell',
                    'strategy_name': 'death_cross',
                    'signal_date': signal_date,
                    'signal_price': signal_price,
                    'current_price': float(current_price) if current_price else None,
                    'return_percent': float(round(return_pct, 2)),
                    'details': {
                        'ma_20': float(round(ma20_curr, 2)),
                        'ma_60': float(round(ma60_curr, 2)),
                        'cross_type': 'death'
                    }
                })

        return signals

    def _detect_ma_support_resistance(
        self,
        df: pd.DataFrame,
        current_price: Optional[float]
    ) -> List[Dict]:
        """이평선 지지/저항 감지"""
        signals = []
        today = date.today()
        threshold = self.SUPPORT_RESISTANCE_THRESHOLD / 100

        # 최근 5일만 검사
        recent_df = df.tail(5).copy()
        if len(recent_df) < 2:
            return signals

        for ma_period in self.MA_PERIODS:
            ma_col = f'ma_{ma_period}'
            if ma_col not in df.columns:
                continue

            for i in range(1, len(recent_df)):
                idx = recent_df.index[i]
                signal_date = idx if isinstance(idx, date) else idx.date()

                row = recent_df.iloc[i]
                prev_row = recent_df.iloc[i - 1]

                ma_value = row.get(ma_col)
                if pd.isna(ma_value) or ma_value <= 0:
                    continue

                low = row['low']
                high = row['high']
                close = row['close']
                open_price = row['open']

                signal_price = float(close)
                return_pct = 0.0
                if current_price and signal_price > 0:
                    return_pct = ((current_price - signal_price) / signal_price) * 100

                # 지지: 저가가 MA 근처(2% 이내)까지 하락 후 종가가 MA 위에서 마감 + 양봉
                distance_low = abs(low - ma_value) / ma_value
                if distance_low <= threshold and close > ma_value and close > open_price:
                    signals.append({
                        'signal_type': 'buy',
                        'strategy_name': 'ma_support',
                        'signal_date': signal_date,
                        'signal_price': signal_price,
                        'current_price': float(current_price) if current_price else None,
                        'return_percent': float(round(return_pct, 2)),
                        'details': {
                            'ma_period': ma_period,
                            'ma_value': float(round(ma_value, 2)),
                            'distance_pct': float(round(distance_low * 100, 2)),
                            'bounce_type': 'support'
                        }
                    })

                # 저항: 고가가 MA 근처(2% 이내)까지 상승 후 종가가 MA 아래에서 마감 + 음봉
                distance_high = abs(high - ma_value) / ma_value
                if distance_high <= threshold and close < ma_value and close < open_price:
                    signals.append({
                        'signal_type': 'sell',
                        'strategy_name': 'ma_resistance',
                        'signal_date': signal_date,
                        'signal_price': signal_price,
                        'current_price': float(current_price) if current_price else None,
                        'return_percent': float(round(return_pct, 2)),
                        'details': {
                            'ma_period': ma_period,
                            'ma_value': float(round(ma_value, 2)),
                            'distance_pct': float(round(distance_high * 100, 2)),
                            'bounce_type': 'resistance'
                        }
                    })

        return signals

    def _detect_ma_breakouts(
        self,
        df: pd.DataFrame,
        current_price: Optional[float]
    ) -> List[Dict]:
        """이평선 돌파 감지"""
        signals = []

        # 최근 5일만 검사
        recent_df = df.tail(6).copy()  # 비교를 위해 6일
        if len(recent_df) < 2:
            return signals

        for ma_period in self.MA_PERIODS:
            ma_col = f'ma_{ma_period}'
            if ma_col not in df.columns:
                continue

            for i in range(1, len(recent_df)):
                idx = recent_df.index[i]
                signal_date = idx if isinstance(idx, date) else idx.date()

                prev_idx = recent_df.index[i - 1]

                ma_prev = recent_df.loc[prev_idx, ma_col]
                ma_curr = recent_df.loc[idx, ma_col]
                close_prev = recent_df.loc[prev_idx, 'close']
                close_curr = recent_df.loc[idx, 'close']

                if pd.isna(ma_prev) or pd.isna(ma_curr):
                    continue

                signal_price = float(close_curr)
                return_pct = 0.0
                if current_price and signal_price > 0:
                    return_pct = ((current_price - signal_price) / signal_price) * 100

                # 상향 돌파: 전날 종가 < MA, 오늘 종가 > MA
                if close_prev < ma_prev and close_curr > ma_curr:
                    signals.append({
                        'signal_type': 'buy',
                        'strategy_name': 'ma_breakout_up',
                        'signal_date': signal_date,
                        'signal_price': signal_price,
                        'current_price': float(current_price) if current_price else None,
                        'return_percent': float(round(return_pct, 2)),
                        'details': {
                            'ma_period': ma_period,
                            'ma_value': float(round(ma_curr, 2)),
                            'breakout_direction': 'up'
                        }
                    })

                # 하향 돌파: 전날 종가 > MA, 오늘 종가 < MA
                elif close_prev > ma_prev and close_curr < ma_curr:
                    signals.append({
                        'signal_type': 'sell',
                        'strategy_name': 'ma_breakout_down',
                        'signal_date': signal_date,
                        'signal_price': signal_price,
                        'current_price': float(current_price) if current_price else None,
                        'return_percent': float(round(return_pct, 2)),
                        'details': {
                            'ma_period': ma_period,
                            'ma_value': float(round(ma_curr, 2)),
                            'breakout_direction': 'down'
                        }
                    })

        return signals

    def _detect_ma_alignment(
        self,
        df: pd.DataFrame,
        current_price: Optional[float]
    ) -> List[Dict]:
        """이평선 배열 (정배열/역배열) 전환 감지 (20/60/90일)"""
        signals = []

        # 최근 5일만 검사
        recent_df = df.tail(6).copy()
        if len(recent_df) < 2:
            return signals

        # MA 20, 60, 90 모두 필요
        required_cols = ['ma_20', 'ma_60', 'ma_90']
        if not all(col in df.columns for col in required_cols):
            return signals

        for i in range(1, len(recent_df)):
            idx = recent_df.index[i]
            signal_date = idx if isinstance(idx, date) else idx.date()

            prev_idx = recent_df.index[i - 1]

            # 현재와 이전 MA 값
            ma20_curr = recent_df.loc[idx, 'ma_20']
            ma60_curr = recent_df.loc[idx, 'ma_60']
            ma90_curr = recent_df.loc[idx, 'ma_90']

            ma20_prev = recent_df.loc[prev_idx, 'ma_20']
            ma60_prev = recent_df.loc[prev_idx, 'ma_60']
            ma90_prev = recent_df.loc[prev_idx, 'ma_90']

            if any(pd.isna([ma20_curr, ma60_curr, ma90_curr, ma20_prev, ma60_prev, ma90_prev])):
                continue

            # 배열 상태 판단
            is_bullish_now = (ma20_curr > ma60_curr > ma90_curr)
            is_bearish_now = (ma90_curr > ma60_curr > ma20_curr)

            is_bullish_prev = (ma20_prev > ma60_prev > ma90_prev)
            is_bearish_prev = (ma90_prev > ma60_prev > ma20_prev)

            signal_price = float(recent_df.loc[idx, 'close'])
            return_pct = 0.0
            if current_price and signal_price > 0:
                return_pct = ((current_price - signal_price) / signal_price) * 100

            # 정배열 전환: 이전에 정배열이 아니었는데 오늘 정배열
            if is_bullish_now and not is_bullish_prev:
                signals.append({
                    'signal_type': 'buy',
                    'strategy_name': 'ma_bullish_alignment',
                    'signal_date': signal_date,
                    'signal_price': signal_price,
                    'current_price': float(current_price) if current_price else None,
                    'return_percent': float(round(return_pct, 2)),
                    'details': {
                        'ma_20': float(round(ma20_curr, 2)),
                        'ma_60': float(round(ma60_curr, 2)),
                        'ma_90': float(round(ma90_curr, 2)),
                        'alignment': 'bullish'
                    }
                })

            # 역배열 전환: 이전에 역배열이 아니었는데 오늘 역배열
            if is_bearish_now and not is_bearish_prev:
                signals.append({
                    'signal_type': 'sell',
                    'strategy_name': 'ma_bearish_alignment',
                    'signal_date': signal_date,
                    'signal_price': signal_price,
                    'current_price': float(current_price) if current_price else None,
                    'return_percent': float(round(return_pct, 2)),
                    'details': {
                        'ma_20': float(round(ma20_curr, 2)),
                        'ma_60': float(round(ma60_curr, 2)),
                        'ma_90': float(round(ma90_curr, 2)),
                        'alignment': 'bearish'
                    }
                })

        return signals

    def _save_signals(self, stock_id: int, signals: List[Dict], db: Session) -> int:
        from app.signal_store import save_signals
        return save_signals(db, stock_id, signals, None)

    def get_stock_ma_analysis(
        self,
        stock_id: int,
        days: int = 180,
        db: Optional[Session] = None
    ) -> Optional[Dict]:
        """개별 종목 MA 분석 데이터 반환 (차트용)"""
        close_db = False
        if db is None:
            db = SessionLocal()
            close_db = True

        try:
            stock = db.query(Stock).filter(Stock.id == stock_id).first()
            if not stock:
                return None

            from app.market_clock import latest_session
            as_of = latest_session()[0]
            start_date = as_of - timedelta(days=days + 90)  # MA 계산용 추가 데이터

            price_history = db.query(StockPriceHistory).filter(
                StockPriceHistory.stock_id == stock_id,
                StockPriceHistory.date >= start_date,
                StockPriceHistory.date <= as_of
            ).order_by(StockPriceHistory.date.asc()).all()

            if len(price_history) < 90:
                return None

            # DataFrame 생성 및 MA 계산
            data = []
            for ph in price_history:
                data.append({
                    'date': ph.date.isoformat(),
                    'open': ph.open_price,
                    'high': ph.high_price,
                    'low': ph.low_price,
                    'close': ph.close_price,
                    'volume': ph.volume or 0
                })

            df = pd.DataFrame(data)
            df['date_obj'] = pd.to_datetime(df['date'])
            df.set_index('date_obj', inplace=True)

            # MA 계산
            for period in self.MA_PERIODS:
                df[f'ma_{period}'] = df['close'].rolling(window=period, min_periods=period).mean()

            # 최근 days일만 반환
            display_df = df.tail(days).copy()

            # 현재 MA 값
            latest = display_df.iloc[-1]
            ma_values = {}
            for period in self.MA_PERIODS:
                val = latest.get(f'ma_{period}')
                if pd.notna(val):
                    ma_values[period] = float(round(val, 2))

            # 배열 상태 판단
            alignment = 'neutral'
            if all(period in ma_values for period in [20, 60, 90]):
                if ma_values[20] > ma_values[60] > ma_values[90]:
                    alignment = 'bullish'
                elif ma_values[90] > ma_values[60] > ma_values[20]:
                    alignment = 'bearish'

            # 차트 데이터
            chart_data = []
            for idx, row in display_df.iterrows():
                item = {
                    'date': row['date'],
                    'open': float(row['open']) if pd.notna(row['open']) else None,
                    'high': float(row['high']) if pd.notna(row['high']) else None,
                    'low': float(row['low']) if pd.notna(row['low']) else None,
                    'close': float(row['close']) if pd.notna(row['close']) else None,
                    'volume': int(row['volume']) if pd.notna(row['volume']) else 0,
                }
                for period in self.MA_PERIODS:
                    val = row.get(f'ma_{period}')
                    item[f'ma_{period}'] = float(round(val, 2)) if pd.notna(val) else None
                chart_data.append(item)

            # 최근 시그널 조회
            recent_signals = db.query(StockSignal).filter(
                StockSignal.stock_id == stock_id,
                StockSignal.strategy_name.in_(self.STRATEGY_NAMES),
                StockSignal.signal_date >= date.today() - timedelta(days=30)
            ).order_by(StockSignal.signal_date.desc()).limit(10).all()

            return {
                'freshness': stock.freshness,
                'stock_id': stock.id,
                'symbol': stock.symbol,
                'name': stock.name,
                'current_price': float(stock.current_price) if stock.current_price else None,
                'ma_values': ma_values,
                'alignment': alignment,
                'chart_data': chart_data,
                'recent_signals': [
                    {
                        'id': s.id,
                        'signal_type': s.signal_type,
                        'signal_date': s.signal_date.isoformat(),
                        'signal_price': s.signal_price,
                        'strategy_name': s.strategy_name,
                        'return_percent': s.return_percent,
                        'details': json.loads(s.details) if s.details else {}
                    }
                    for s in recent_signals
                ]
            }

        finally:
            if close_db:
                db.close()


# 전역 인스턴스
ma_signal_analyzer = MASignalAnalyzer()
