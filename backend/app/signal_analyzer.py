"""
매매 신호 분석 및 저장 모듈
"""
import logging
import json
import uuid
from datetime import datetime, date
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models import Stock, StockPriceHistory, StockSignal, TaskProgress
from app.technical_indicators import generate_breakout_pullback_signals
from app.database import get_db

logger = logging.getLogger(__name__)


class SignalAnalyzer:
    """매매 신호 분석 및 저장"""

    def __init__(self):
        self.strategy_name = "breakout_pullback"

    def analyze_and_store_signals(
        self,
        mode: str = "all",
        limit: Optional[int] = None,
        days: int = 120,
        db: Optional[Session] = None
    ) -> Dict:
        """
        종목들의 신호를 분석하고 DB에 저장

        Args:
            mode: 분석 모드 ("tagged", "all", "top")
            limit: top 모드일 때 상위 몇 개 종목
            days: 분석할 일수
            db: DB 세션 (없으면 자동 생성)

        Returns:
            분석 결과 통계
        """
        close_db = False
        if db is None:
            db = next(get_db())
            close_db = True

        # 작업 진행 상황 추적 생성
        task_id = str(uuid.uuid4())
        task_progress = None

        try:
            # 분석할 종목 선택
            stock_ids = self._get_stock_ids_by_mode(mode, limit, db)

            logger.info(f"🔍 Starting signal analysis for {len(stock_ids)} stocks (mode: {mode})...")

            # TaskProgress 생성
            task_progress = TaskProgress(
                task_id=task_id,
                task_type="signal_analysis",
                status="running",
                total_items=len(stock_ids),
                current_item=0,
                message=f"신호 분석 시작 ({mode} 모드, {len(stock_ids)}개 종목)"
            )
            db.add(task_progress)
            db.commit()

            total_stocks = len(stock_ids)
            signals_found = 0
            stocks_with_signals = 0
            total_signals_saved = 0

            for idx, stock_id in enumerate(stock_ids, 1):
                try:
                    # 종목 정보 조회 (진행 상황 표시용)
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
                    else:
                        task_progress.success_count += 1

                except Exception as e:
                    logger.error(f"❌ Error analyzing stock {stock_id}: {str(e)}")
                    task_progress.failed_count += 1
                    db.commit()
                    continue

            # TaskProgress 완료 처리
            task_progress.status = "completed"
            task_progress.current_item = total_stocks
            task_progress.message = f"분석 완료: {stocks_with_signals}/{total_stocks} 종목에서 {total_signals_saved}개 신호 발견"
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
        db: Session
    ) -> List[int]:
        """모드에 따라 분석할 종목 ID 목록 가져오기 (최적화됨)"""
        from app.models import StockTagAssignment
        from sqlalchemy import func

        if mode == "tagged":
            # 태그가 있는 종목만
            tagged_stocks = db.query(StockTagAssignment.stock_id).distinct().all()
            stock_ids = set(sid[0] for sid in tagged_stocks)

        elif mode == "top":
            # 시총 상위 N개
            top_stocks = db.query(Stock.id).filter(
                Stock.is_active == True
            ).order_by(Stock.market_cap.desc().nullslast()).limit(limit or 500).all()
            stock_ids = set(s.id for s in top_stocks)

        else:  # "all"
            # 모든 활성 종목
            all_stocks = db.query(Stock.id).filter(Stock.is_active == True).all()
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

        logger.info(f"Mode: {mode}, Total stocks: {len(stock_ids)}, With 60+ history: {len(filtered_ids)}")

        return filtered_ids

    def _analyze_stock(self, stock_id: int, days: int, db: Session) -> Dict:
        """단일 종목 신호 분석 및 저장"""
        # 종목 정보 조회
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            return {"signals_count": 0, "saved_count": 0}

        # 가격 히스토리 조회
        from datetime import timedelta
        start_date = date.today() - timedelta(days=days)

        price_history = db.query(StockPriceHistory).filter(
            StockPriceHistory.stock_id == stock_id,
            StockPriceHistory.date >= start_date
        ).order_by(StockPriceHistory.date.asc()).all()

        if len(price_history) < 60:
            return {"signals_count": 0, "saved_count": 0}

        # 신호 분석
        signals = self._run_signal_analysis(price_history, stock.current_price)

        if not signals or len(signals) == 0:
            return {"signals_count": 0, "saved_count": 0}

        # 신호 저장
        saved_count = self._save_signals(stock_id, signals, db)

        return {
            "signals_count": len(signals),
            "saved_count": saved_count
        }

    def _run_signal_analysis(
        self,
        price_history: List[StockPriceHistory],
        current_price: Optional[float]
    ) -> List[Dict]:
        """실제 신호 분석 로직 실행"""
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

            # 신호 생성 (technical_indicators.py 사용)
            signals_df = generate_breakout_pullback_signals(
                df,
                swing_window=5,
                trendline_points=3,
                volume_threshold=1.5,
                pullback_threshold=0.02
            )

            # 매수 신호만 추출
            buy_signals = signals_df[signals_df['signal'] == 1].copy()

            if len(buy_signals) == 0:
                return []

            # 신호 리스트 생성
            signals = []
            for idx, row in buy_signals.iterrows():
                signal_price = row.get('close', 0)
                return_pct = 0.0

                if current_price and signal_price > 0:
                    return_pct = ((current_price - signal_price) / signal_price) * 100

                signal_info = {
                    'signal_date': idx.date() if hasattr(idx, 'date') else idx,
                    'signal_price': float(signal_price),
                    'current_price': current_price,
                    'return_percent': round(return_pct, 2),
                    'details': {
                        'breakout_idx': int(row.get('breakout_idx', -1)),
                        'pullback_idx': int(row.get('pullback_idx', -1)),
                        'trendline_slope': float(row.get('trendline_slope', 0)),
                        'trendline_intercept': float(row.get('trendline_intercept', 0))
                    }
                }
                signals.append(signal_info)

            return signals

        except Exception as e:
            logger.error(f"Error running signal analysis: {str(e)}")
            return []

    def _save_signals(self, stock_id: int, signals: List[Dict], db: Session) -> int:
        """신호를 DB에 저장 (중복 방지)"""
        saved_count = 0

        for signal_info in signals:
            try:
                # 기존 신호 확인 (같은 종목, 같은 날짜, 같은 전략)
                existing = db.query(StockSignal).filter(
                    StockSignal.stock_id == stock_id,
                    StockSignal.signal_date == signal_info['signal_date'],
                    StockSignal.strategy_name == self.strategy_name
                ).first()

                if existing:
                    # 기존 신호 업데이트 (현재 가격과 수익률만)
                    existing.current_price = signal_info['current_price']
                    existing.return_percent = signal_info['return_percent']
                    existing.updated_at = datetime.utcnow()
                else:
                    # 새 신호 생성
                    new_signal = StockSignal(
                        stock_id=stock_id,
                        signal_type="buy",
                        signal_date=signal_info['signal_date'],
                        signal_price=signal_info['signal_price'],
                        strategy_name=self.strategy_name,
                        current_price=signal_info['current_price'],
                        return_percent=signal_info['return_percent'],
                        details=json.dumps(signal_info['details']),
                        is_active=True,
                        analyzed_at=datetime.utcnow()
                    )
                    db.add(new_signal)
                    saved_count += 1

            except Exception as e:
                logger.error(f"Error saving signal: {str(e)}")
                continue

        return saved_count

    def get_active_signals(
        self,
        db: Session,
        signal_type: Optional[str] = None,
        limit: int = 100
    ) -> List[StockSignal]:
        """저장된 활성 신호 조회"""
        query = db.query(StockSignal).filter(StockSignal.is_active == True)

        if signal_type:
            query = query.filter(StockSignal.signal_type == signal_type)

        # 최신 신호부터
        signals = query.order_by(
            desc(StockSignal.signal_date)
        ).limit(limit).all()

        return signals


# 전역 인스턴스
signal_analyzer = SignalAnalyzer()
