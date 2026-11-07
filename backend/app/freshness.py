"""A dated candle is final only after it has been fetched after that session's close."""
from datetime import timezone
from functools import lru_cache
from app.market_clock import latest_session, calendar


@lru_cache(maxsize=2048)
def session_close(day, market='US'):
    cal = calendar(market)
    if not cal.is_session(str(day)):
        return None
    return cal.session_close(str(day)).to_pydatetime().replace(tzinfo=None)


def iso(value):
    if value is None:
        return None
    if hasattr(value, 'hour'):
        return value.replace(tzinfo=timezone.utc).isoformat()
    return value.isoformat()


def stock_freshness(stock):
    expected, _ = latest_session(market=stock.market)
    completed = stock.history_completed_date
    current = completed is not None and completed >= expected
    repaired = stock.market != 'US' or stock.history_precision_version >= 1
    def analysis_current(as_of, timestamp):
        return bool(current and repaired and as_of and as_of == expected and timestamp and
                    (stock.history_updated_at is None or timestamp >= stock.history_updated_at))
    return {
        'expected_session': iso(expected), 'history_session': iso(completed),
        'history_collected_at': iso(stock.history_updated_at), 'quote_collected_at': iso(stock.quote_updated_at),
        'trend_session': iso(stock.signal_as_of_date), 'trend_analyzed_at': iso(stock.signal_analyzed_at),
        'ma_session': iso(stock.ma_signal_as_of_date), 'ma_analyzed_at': iso(stock.ma_signal_analyzed_at),
        'history_status': 'repair_required' if not repaired else ('current' if current else 'stale'),
        'trend_current': analysis_current(stock.signal_as_of_date, stock.signal_analyzed_at),
        'ma_current': analysis_current(stock.ma_signal_as_of_date, stock.ma_signal_analyzed_at),
        'trend_status': 'insufficient_history' if (stock.history_records_count or 0)<60 else ('current' if analysis_current(stock.signal_as_of_date,stock.signal_analyzed_at) else 'pending'),
        'ma_status': 'insufficient_history' if (stock.history_records_count or 0)<90 else ('current' if analysis_current(stock.ma_signal_as_of_date,stock.ma_signal_analyzed_at) else 'pending'),
        'automatic_collection': stock.market == 'US',
        'price_basis': 'unadjusted' if stock.market == 'US' else 'unknown',
    }


def cache_epoch():
    return ':'.join(latest_session(market=market)[0].isoformat() for market in ('US', 'KR'))
