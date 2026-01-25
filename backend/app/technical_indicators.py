"""
추세선 돌파 + 되돌림 매수 전략

핵심 전략:
1. 상승 추세선 또는 저항선 식별
2. 가격이 추세선을 돌파 (거래량 급증 동반)
3. 돌파 후 되돌림(Pullback) 발생
4. 되돌림에서 지지 확인 시 매수

필요한 기술:
- Swing High/Low 인식
- 추세선 그리기
- 돌파 감지 (가격 + 거래량)
- 되돌림 패턴 인식
- 매수 신호 생성
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta


def calculate_sma(prices: pd.Series, period: int) -> pd.Series:
    """
    단순 이동평균 (Simple Moving Average) 계산

    Args:
        prices: 가격 데이터 (Series)
        period: 기간 (일)

    Returns:
        SMA 값 (Series)
    """
    return prices.rolling(window=period, min_periods=period).mean()


def calculate_ema(prices: pd.Series, period: int) -> pd.Series:
    """
    지수 이동평균 (Exponential Moving Average) 계산

    Args:
        prices: 가격 데이터 (Series)
        period: 기간 (일)

    Returns:
        EMA 값 (Series)
    """
    return prices.ewm(span=period, adjust=False, min_periods=period).mean()


def calculate_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    """
    RSI (Relative Strength Index) 계산

    Args:
        prices: 종가 데이터 (Series)
        period: 기간 (기본 14일)

    Returns:
        RSI 값 (Series, 0-100)

    해석:
        RSI > 70: 과매수 (매도 신호)
        RSI < 30: 과매도 (매수 신호)
    """
    # 가격 변화 계산
    delta = prices.diff()

    # 상승/하락 분리
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)

    # 평균 상승/하락 계산
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()

    # RS (Relative Strength) 계산
    rs = avg_gain / avg_loss

    # RSI 계산
    rsi = 100 - (100 / (1 + rs))

    return rsi


def calculate_macd(
    prices: pd.Series,
    fast_period: int = 12,
    slow_period: int = 26,
    signal_period: int = 9
) -> Dict[str, pd.Series]:
    """
    MACD (Moving Average Convergence Divergence) 계산

    Args:
        prices: 종가 데이터 (Series)
        fast_period: 빠른 EMA 기간 (기본 12일)
        slow_period: 느린 EMA 기간 (기본 26일)
        signal_period: 시그널 EMA 기간 (기본 9일)

    Returns:
        dict: {
            'macd': MACD 라인,
            'signal': Signal 라인,
            'histogram': MACD 히스토그램
        }

    해석:
        MACD > Signal: 매수 신호
        MACD < Signal: 매도 신호
        히스토그램이 커질수록 추세가 강함
    """
    # EMA 계산
    ema_fast = calculate_ema(prices, fast_period)
    ema_slow = calculate_ema(prices, slow_period)

    # MACD 라인 = 빠른 EMA - 느린 EMA
    macd_line = ema_fast - ema_slow

    # Signal 라인 = MACD의 EMA
    signal_line = calculate_ema(macd_line, signal_period)

    # Histogram = MACD - Signal
    histogram = macd_line - signal_line

    return {
        'macd': macd_line,
        'signal': signal_line,
        'histogram': histogram
    }


def calculate_bollinger_bands(
    prices: pd.Series,
    period: int = 20,
    std_dev: float = 2.0
) -> Dict[str, pd.Series]:
    """
    볼린저 밴드 (Bollinger Bands) 계산

    Args:
        prices: 종가 데이터 (Series)
        period: 기간 (기본 20일)
        std_dev: 표준편차 배수 (기본 2.0)

    Returns:
        dict: {
            'upper': 상단 밴드,
            'middle': 중간 밴드 (SMA),
            'lower': 하단 밴드
        }

    해석:
        가격이 하단 밴드에 근접: 매수 신호
        가격이 상단 밴드에 근접: 매도 신호
        밴드 폭이 좁아짐: 변동성 축소 (큰 움직임 예고)
    """
    # 중간 밴드 (SMA)
    middle_band = calculate_sma(prices, period)

    # 표준편차 계산
    std = prices.rolling(window=period, min_periods=period).std()

    # 상단/하단 밴드
    upper_band = middle_band + (std * std_dev)
    lower_band = middle_band - (std * std_dev)

    return {
        'upper': upper_band,
        'middle': middle_band,
        'lower': lower_band
    }


def calculate_obv(prices: pd.Series, volume: pd.Series) -> pd.Series:
    """
    OBV (On-Balance Volume) 계산

    Args:
        prices: 종가 데이터 (Series)
        volume: 거래량 데이터 (Series)

    Returns:
        OBV 값 (Series)

    해석:
        OBV 상승: 매수세 강함
        OBV 하락: 매도세 강함
        가격과 OBV 추세가 일치해야 신뢰도 높음
    """
    # 가격 변화 방향
    price_direction = np.sign(prices.diff())

    # OBV = 누적(volume * price_direction)
    obv = (volume * price_direction).cumsum()

    return obv


def calculate_all_indicators(
    df: pd.DataFrame,
    price_col: str = 'close',
    volume_col: str = 'volume'
) -> pd.DataFrame:
    """
    모든 기술적 지표를 한번에 계산

    Args:
        df: OHLCV 데이터프레임
        price_col: 종가 컬럼명
        volume_col: 거래량 컬럼명

    Returns:
        지표가 추가된 데이터프레임
    """
    result = df.copy()
    prices = df[price_col]

    # 이동평균
    result['sma_5'] = calculate_sma(prices, 5)
    result['sma_20'] = calculate_sma(prices, 20)
    result['sma_60'] = calculate_sma(prices, 60)
    result['sma_120'] = calculate_sma(prices, 120)

    result['ema_12'] = calculate_ema(prices, 12)
    result['ema_26'] = calculate_ema(prices, 26)

    # RSI
    result['rsi_14'] = calculate_rsi(prices, 14)

    # MACD
    macd = calculate_macd(prices)
    result['macd'] = macd['macd']
    result['macd_signal'] = macd['signal']
    result['macd_histogram'] = macd['histogram']

    # 볼린저 밴드
    bb = calculate_bollinger_bands(prices)
    result['bb_upper'] = bb['upper']
    result['bb_middle'] = bb['middle']
    result['bb_lower'] = bb['lower']

    # OBV (거래량 컬럼이 있는 경우)
    if volume_col in df.columns:
        result['obv'] = calculate_obv(prices, df[volume_col])

    return result


def find_swing_highs_lows(
    df: pd.DataFrame,
    high_col: str = 'high',
    low_col: str = 'low',
    window: int = 5
) -> Dict[str, List[Tuple[int, float]]]:
    """
    스윙 고점(Swing High)과 저점(Swing Low) 찾기

    Args:
        df: OHLCV 데이터프레임
        high_col: 고가 컬럼명
        low_col: 저가 컬럼명
        window: 양옆으로 비교할 봉의 개수

    Returns:
        dict: {
            'swing_highs': [(index, price), ...],
            'swing_lows': [(index, price), ...]
        }
    """
    swing_highs = []
    swing_lows = []

    for i in range(window, len(df) - window):
        # 현재 고가가 양옆 window 범위 내에서 최고가인지 확인
        is_swing_high = True
        for j in range(i - window, i + window + 1):
            if j != i and df[high_col].iloc[j] >= df[high_col].iloc[i]:
                is_swing_high = False
                break

        if is_swing_high:
            swing_highs.append((i, df[high_col].iloc[i]))

        # 현재 저가가 양옆 window 범위 내에서 최저가인지 확인
        is_swing_low = True
        for j in range(i - window, i + window + 1):
            if j != i and df[low_col].iloc[j] <= df[low_col].iloc[i]:
                is_swing_low = False
                break

        if is_swing_low:
            swing_lows.append((i, df[low_col].iloc[i]))

    return {
        'swing_highs': swing_highs,
        'swing_lows': swing_lows
    }


def calculate_trendline(
    points: List[Tuple[int, float]],
    start_idx: int = 0
) -> Optional[Tuple[float, float]]:
    """
    최근 N개 포인트를 이용해 추세선 계산

    Args:
        points: [(index, price), ...] 형태의 포인트 리스트
        start_idx: 최근 몇 개 포인트를 사용할지 (0이면 모두 사용)

    Returns:
        (slope, intercept) 또는 None
        y = slope * x + intercept
    """
    if len(points) < 2:
        return None

    # 최근 포인트만 사용
    if start_idx > 0:
        points = points[-start_idx:]

    x = np.array([p[0] for p in points])
    y = np.array([p[1] for p in points])

    # 선형 회귀
    slope, intercept = np.polyfit(x, y, 1)

    return (slope, intercept)


def detect_breakout(
    df: pd.DataFrame,
    trendline: Tuple[float, float],
    volume_threshold: float = 1.5,
    price_col: str = 'close',
    volume_col: str = 'volume'
) -> pd.Series:
    """
    추세선 돌파 감지

    Args:
        df: OHLCV 데이터프레임
        trendline: (slope, intercept)
        volume_threshold: 평균 거래량 대비 배수
        price_col: 가격 컬럼명
        volume_col: 거래량 컬럼명

    Returns:
        돌파 여부 (True/False) Series
    """
    slope, intercept = trendline
    breakouts = []

    # 평균 거래량 계산 (최근 20일)
    avg_volume = df[volume_col].rolling(window=20, min_periods=10).mean()

    for i in range(len(df)):
        # 추세선 값 계산
        trendline_value = slope * i + intercept

        # 가격이 추세선을 돌파했는지 확인
        price_breakout = df[price_col].iloc[i] > trendline_value

        # 거래량이 평균의 threshold 배 이상인지 확인
        volume_surge = False
        if pd.notna(avg_volume.iloc[i]):
            volume_surge = df[volume_col].iloc[i] > (avg_volume.iloc[i] * volume_threshold)

        # 돌파 = 가격 돌파 + 거래량 급증
        breakouts.append(price_breakout and volume_surge)

    return pd.Series(breakouts, index=df.index)


def detect_pullback(
    df: pd.DataFrame,
    breakout_idx: int,
    lookback: int = 10,
    pullback_threshold: float = 0.02,  # 2% 되돌림
    price_col: str = 'close'
) -> Optional[int]:
    """
    돌파 후 되돌림(Pullback) 감지

    Args:
        df: OHLCV 데이터프레임
        breakout_idx: 돌파가 발생한 인덱스
        lookback: 돌파 후 몇 일까지 되돌림을 찾을지
        pullback_threshold: 되돌림 비율 (예: 0.02 = 2%)
        price_col: 가격 컬럼명

    Returns:
        되돌림 발생 인덱스 또는 None
    """
    if breakout_idx >= len(df) - 1:
        return None

    # 돌파 시점의 가격
    breakout_price = df[price_col].iloc[breakout_idx]

    # 돌파 후 lookback 일간 확인
    end_idx = min(breakout_idx + lookback, len(df))

    for i in range(breakout_idx + 1, end_idx):
        current_price = df[price_col].iloc[i]

        # 되돌림 = 돌파가 대비 하락
        pullback_ratio = (breakout_price - current_price) / breakout_price

        # 되돌림이 threshold 이상이고, 다시 상승하기 시작했는지 확인
        if pullback_ratio >= pullback_threshold:
            # 다음 봉이 상승했는지 확인
            if i < len(df) - 1:
                next_price = df[price_col].iloc[i + 1]
                if next_price > current_price:
                    return i

    return None


def generate_breakout_pullback_signals(
    df: pd.DataFrame,
    swing_window: int = 5,
    trendline_points: int = 3,
    volume_threshold: float = 1.5,
    pullback_threshold: float = 0.02
) -> pd.DataFrame:
    """
    추세선 돌파 + 되돌림 매수 신호 생성

    Args:
        df: OHLCV 데이터프레임
        swing_window: 스윙 고저점 인식 윈도우
        trendline_points: 추세선 그릴 때 사용할 최근 포인트 개수
        volume_threshold: 거래량 급증 기준 (평균 대비 배수)
        pullback_threshold: 되돌림 비율

    Returns:
        신호가 추가된 데이터프레임

    추가 컬럼:
        - breakout: 돌파 발생 여부
        - pullback: 되돌림 발생 여부
        - buy_signal: 매수 신호 (0 or 1)
    """
    result = df.copy()

    # 1. 스윙 고점/저점 찾기
    swings = find_swing_highs_lows(df, window=swing_window)

    # 2. 저항선 계산 (스윙 고점 연결)
    resistance_line = None
    if len(swings['swing_highs']) >= 2:
        resistance_line = calculate_trendline(
            swings['swing_highs'],
            start_idx=trendline_points
        )

    # 3. 돌파 감지
    breakouts = [False] * len(df)
    if resistance_line:
        breakout_series = detect_breakout(
            df,
            resistance_line,
            volume_threshold=volume_threshold
        )
        breakouts = breakout_series.tolist()

    result['breakout'] = breakouts

    # 4. 되돌림 및 매수 신호 생성
    pullbacks = [False] * len(df)
    buy_signals = [0] * len(df)

    for i, is_breakout in enumerate(breakouts):
        if is_breakout:
            # 돌파 후 되돌림 찾기
            pullback_idx = detect_pullback(
                df,
                i,
                pullback_threshold=pullback_threshold
            )

            if pullback_idx is not None:
                pullbacks[pullback_idx] = True
                buy_signals[pullback_idx] = 1  # 매수 신호

    result['pullback'] = pullbacks
    result['buy_signal'] = buy_signals

    return result


def find_lower_highs(
    swing_highs: List[Tuple[int, float]],
    min_count: int = 3
) -> List[Tuple[int, float]]:
    """
    Lower High 패턴 찾기 (점점 낮아지는 고점들)
    가장 긴 Lower High 시퀀스를 반환

    Args:
        swing_highs: [(index, price), ...] 형태의 스윙 고점 리스트
        min_count: 최소 필요 Lower High 개수

    Returns:
        Lower High 리스트 [(index, price), ...]
    """
    if len(swing_highs) < min_count:
        return []

    # 가장 긴 Lower High 시퀀스 찾기
    best_sequence = []

    for start in range(len(swing_highs)):
        current_sequence = [swing_highs[start]]

        for j in range(start + 1, len(swing_highs)):
            if swing_highs[j][1] < current_sequence[-1][1]:
                current_sequence.append(swing_highs[j])

        if len(current_sequence) > len(best_sequence):
            best_sequence = current_sequence

    return best_sequence if len(best_sequence) >= min_count else []


def generate_descending_trendline_breakout_signals(
    df: pd.DataFrame,
    swing_window: int = 5,
    min_touches: int = 3
) -> pd.DataFrame:
    """
    하락 추세선 돌파 매수 신호 생성 (순수 차트 패턴)

    전략:
    1. 스윙 고점(Swing High) 찾기
    2. Lower High 패턴 (점점 낮아지는 고점) 찾기
    3. Lower High들을 연결한 하락 추세선 계산
    4. 추세선 상향 돌파 시 매수 신호 생성

    Args:
        df: OHLCV 데이터프레임
        swing_window: 스윙 고저점 인식 윈도우
        min_touches: 추세선에 필요한 최소 터치 포인트

    Returns:
        신호가 추가된 데이터프레임

    추가 컬럼:
        - buy_signal: 매수 신호 (0 or 1)
        - trendline_slope: 추세선 기울기
        - trendline_intercept: 추세선 절편
    """
    result = df.copy()
    buy_signals = [0] * len(df)

    # 1. 스윙 고점 찾기
    swings = find_swing_highs_lows(df, window=swing_window)
    swing_highs = swings['swing_highs']

    if len(swing_highs) < min_touches:
        result['buy_signal'] = buy_signals
        result['trendline_slope'] = 0.0
        result['trendline_intercept'] = 0.0
        return result

    # 2. Lower High 패턴 찾기
    lower_highs = find_lower_highs(swing_highs, min_count=min_touches)

    if len(lower_highs) < min_touches:
        result['buy_signal'] = buy_signals
        result['trendline_slope'] = 0.0
        result['trendline_intercept'] = 0.0
        return result

    # 3. 하락 추세선 계산
    trendline = calculate_trendline(lower_highs)

    if trendline is None:
        result['buy_signal'] = buy_signals
        result['trendline_slope'] = 0.0
        result['trendline_intercept'] = 0.0
        return result

    slope, intercept = trendline

    if slope >= 0:  # 하락 추세 아님 (기울기가 양수면 상승 추세)
        result['buy_signal'] = buy_signals
        result['trendline_slope'] = slope
        result['trendline_intercept'] = intercept
        return result

    # 4. 돌파 감지 (순수 차트 패턴만 사용)
    last_lower_high_idx = lower_highs[-1][0]

    for i in range(last_lower_high_idx + 1, len(df)):
        trendline_value = slope * i + intercept
        prev_trendline = slope * (i - 1) + intercept

        # 조건 1: 이전 봉은 추세선 아래
        prev_below = df['close'].iloc[i - 1] <= prev_trendline

        # 조건 2: 현재 봉이 추세선 돌파
        current_above = df['close'].iloc[i] > trendline_value

        if prev_below and current_above:
            buy_signals[i] = 1

    result['buy_signal'] = buy_signals
    result['trendline_slope'] = slope
    result['trendline_intercept'] = intercept

    return result


def generate_approaching_breakout_signals(
    df: pd.DataFrame,
    swing_window: int = 5,
    min_touches: int = 3,
    approach_threshold: float = 3.0
) -> pd.DataFrame:
    """
    하락 추세선 돌파 임박 신호 생성

    전략:
    1. 하락 추세선 계산 (Lower High 연결)
    2. 가격이 추세선의 approach_threshold% 이내로 접근 시 신호 발생
    3. 양봉일 때만 신호 발생 (상승 모멘텀 확인)

    Args:
        df: OHLCV 데이터프레임
        swing_window: 스윙 고저점 인식 윈도우
        min_touches: 추세선에 필요한 최소 터치 포인트
        approach_threshold: 추세선 접근 임계값 (%, 기본 3%)

    Returns:
        신호가 추가된 데이터프레임

    추가 컬럼:
        - approaching_signal: 돌파 임박 신호 (0 or 1)
        - distance_to_trendline: 추세선까지 거리 (%)
        - trendline_slope: 추세선 기울기
        - trendline_intercept: 추세선 절편
    """
    result = df.copy()
    approaching_signals = [0] * len(df)
    distances = [None] * len(df)

    # 1. 스윙 고점 찾기
    swings = find_swing_highs_lows(df, window=swing_window)
    swing_highs = swings['swing_highs']

    if len(swing_highs) < min_touches:
        result['approaching_signal'] = approaching_signals
        result['distance_to_trendline'] = distances
        result['trendline_slope'] = 0.0
        result['trendline_intercept'] = 0.0
        return result

    # 2. Lower High 패턴 찾기
    lower_highs = find_lower_highs(swing_highs, min_count=min_touches)

    if len(lower_highs) < min_touches:
        result['approaching_signal'] = approaching_signals
        result['distance_to_trendline'] = distances
        result['trendline_slope'] = 0.0
        result['trendline_intercept'] = 0.0
        return result

    # 3. 하락 추세선 계산
    trendline = calculate_trendline(lower_highs)

    if trendline is None:
        result['approaching_signal'] = approaching_signals
        result['distance_to_trendline'] = distances
        result['trendline_slope'] = 0.0
        result['trendline_intercept'] = 0.0
        return result

    slope, intercept = trendline

    if slope >= 0:  # 하락 추세 아님
        result['approaching_signal'] = approaching_signals
        result['distance_to_trendline'] = distances
        result['trendline_slope'] = slope
        result['trendline_intercept'] = intercept
        return result

    # 4. 돌파 임박 감지
    last_lower_high_idx = lower_highs[-1][0]

    for i in range(last_lower_high_idx + 1, len(df)):
        trendline_value = slope * i + intercept
        close_price = df['close'].iloc[i]
        open_price = df['open'].iloc[i]

        # 추세선까지 거리 계산 (%)
        if close_price > 0:
            distance = (trendline_value - close_price) / close_price * 100
            distances[i] = distance

            # 조건 1: 추세선 아래에 있음 (아직 돌파 안함)
            below_trendline = close_price < trendline_value

            # 조건 2: 추세선에 가까움 (threshold% 이내)
            close_to_trendline = 0 < distance <= approach_threshold

            # 조건 3: 양봉 (상승 모멘텀)
            is_bullish = close_price > open_price

            if below_trendline and close_to_trendline and is_bullish:
                approaching_signals[i] = 1

    result['approaching_signal'] = approaching_signals
    result['distance_to_trendline'] = distances
    result['trendline_slope'] = slope
    result['trendline_intercept'] = intercept

    return result


def generate_trading_signals(df: pd.DataFrame) -> pd.DataFrame:
    """
    [DEPRECATED] 기존 복합 지표 기반 신호 생성

    추세선 돌파 전략을 사용하려면 generate_breakout_pullback_signals() 사용
    """
    result = df.copy()
    signals = []

    for idx in range(len(df)):
        signal = 0.0

        # RSI 신호
        if 'rsi_14' in df.columns:
            rsi = df['rsi_14'].iloc[idx]
            if pd.notna(rsi):
                if rsi < 30:
                    signal += 0.5
                elif rsi > 70:
                    signal -= 0.5

        # MACD 신호
        if 'macd' in df.columns and 'macd_signal' in df.columns:
            macd = df['macd'].iloc[idx]
            macd_signal = df['macd_signal'].iloc[idx]
            if pd.notna(macd) and pd.notna(macd_signal):
                if macd > macd_signal:
                    signal += 0.3
                else:
                    signal -= 0.3

        signals.append(signal)

    result['signal'] = signals
    result['signal'] = result['signal'].clip(-1, 1)

    return result
