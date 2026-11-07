"""NYSE sessions include holidays, DST and early closes."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import exchange_calendars as calendars
import pandas as pd


@lru_cache(maxsize=2)
def calendar(market='US'):
    return calendars.get_calendar("XKRX" if market == 'KR' else "XNYS")


def latest_session(now=None, market='US'):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cal = calendar(market)
    session = cal.date_to_session(pd.Timestamp(now.date()), direction="previous")
    close = cal.session_close(session).to_pydatetime()
    if now < close + timedelta(minutes=20):
        session = cal.previous_session(session)
        close = cal.session_close(session).to_pydatetime()
    return session.date(), close.replace(tzinfo=None)
