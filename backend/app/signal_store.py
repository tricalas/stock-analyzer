"""Idempotent signal persistence; callers own the surrounding transaction."""
import orjson
from datetime import datetime
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.models import StockSignal


def save_signals(db, stock_id, signals, default_strategy=None):
    records = {}
    for signal in signals:
        details = signal.get("details") or {}
        period = int(details.get("ma_period", 0))
        strategy = signal.get("strategy_name") or default_strategy
        key = (stock_id, signal["signal_date"], strategy, period)
        records[key] = dict(stock_id=stock_id, signal_date=signal["signal_date"],
            strategy_name=strategy, ma_period=period, signal_type=signal.get("signal_type", "buy"),
            signal_price=float(signal["signal_price"]), current_price=float(signal["current_price"]) if signal.get("current_price") is not None else None,
            return_percent=float(signal["return_percent"]) if signal.get("return_percent") is not None else None, details=orjson.dumps(details, option=orjson.OPT_SERIALIZE_NUMPY).decode(),
            is_active=True, analyzed_at=datetime.utcnow(), updated_at=datetime.utcnow())
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    if records:
        stmt = insert(StockSignal).values(list(records.values()))
        updates = {key:getattr(stmt.excluded, key) for key in ("signal_type","signal_price","current_price","return_percent","details","is_active","analyzed_at","updated_at")}
        db.execute(stmt.on_conflict_do_update(index_elements=["stock_id", "signal_date", "strategy_name", "ma_period"], set_=updates))
    return len(records)
