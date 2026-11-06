"""NYSE sessions include holidays, DST and early closes."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import exchange_calendars as calendars
import pandas as pd


@lru_cache(maxsize=1)
def calendar():
    return calendars.get_calendar("XNYS")


def latest_session(now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cal = calendar()
    session = cal.date_to_session(pd.Timestamp(now.date()), direction="previous")
    close = cal.session_close(session).to_pydatetime()
    if now < close + timedelta(minutes=20):
        session = cal.previous_session(session)
        close = cal.session_close(session).to_pydatetime()
    return session.date(), close.replace(tzinfo=None)
