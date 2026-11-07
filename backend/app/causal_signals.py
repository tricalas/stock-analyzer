"""Confirmed swing points become available only after their right-hand window closes."""
import numpy as np
import pandas as pd


def trend_features(df, swing_window=5, min_touches=3, approach_threshold=3.0):
    from app.technical_indicators import find_lower_highs, calculate_trendline, _extend_trendline_with_touches
    result = df.copy()
    highs = df['high'].to_numpy(dtype=float)
    lows = df['low'].to_numpy(dtype=float)
    opens = df['open'].to_numpy(dtype=float)
    closes = df['close'].to_numpy(dtype=float)
    confirmed = []
    slope = intercept = 0.0
    active_breakout = None
    values = {name: [] for name in ('trendline_slope','trendline_intercept','buy_signal',
              'approaching_signal','distance_to_trendline','pullback_signal','pullback_distance',
              'pullback_slope','pullback_intercept')}
    for i in range(len(df)):
        candidate = i-swing_window
        if candidate >= swing_window:
            window = highs[candidate-swing_window:i+1]
            if np.count_nonzero(window >= highs[candidate]) == 1:
                confirmed.append((candidate, highs[candidate]))
                points = find_lower_highs(confirmed, min_count=min_touches)
                line = calculate_trendline(points) if len(points) >= min_touches else None
                if line is not None and line[0] < 0:
                    _, slope, intercept = _extend_trendline_with_touches(confirmed, points, *line)
                else:
                    slope = intercept = 0.0
        target = slope*i+intercept
        buy = bool(i and slope < 0 and target > 0 and highs[i-1] <= slope*(i-1)+intercept and highs[i] > target)
        distance = (target-highs[i])/highs[i]*100 if slope < 0 and highs[i] > 0 else None
        approaching = bool(distance is not None and 0 < distance <= approach_threshold and closes[i] > opens[i])
        pullback = False
        pull_distance = None
        pull_slope = pull_intercept = 0.0
        if active_breakout is not None and not buy:
            pull_slope, pull_intercept = active_breakout
            line_value = pull_slope*i+pull_intercept
            if line_value > 0 and closes[i] > line_value:
                pull_distance = (lows[i]-line_value)/line_value*100
                pullback = 0 <= pull_distance <= 3.0
        if buy:
            active_breakout = (slope, intercept)
        for name, value in zip(values, (slope,intercept,int(buy),int(approaching),distance,
                                       int(pullback),pull_distance,pull_slope,pull_intercept)):
            values[name].append(value)
    for name, value in values.items():
        result[name] = value
    return result
