"""Moving averages use complete trading sessions, never partial windows."""
import math
from app.models import Stock, StockPriceHistory


def update_ma90(stock_id, db):
    rows = db.query(StockPriceHistory.close_price).filter(
        StockPriceHistory.stock_id == stock_id
    ).order_by(StockPriceHistory.date.desc()).limit(90).all()
    prices = [r.close_price for r in rows]
    value = None
    if len(prices) == 90 and all(p is not None and math.isfinite(p) and p > 0 for p in prices):
        value = math.fsum(prices) / 90
    db.query(Stock).filter(Stock.id == stock_id).update({"ma90_price": value}, synchronize_session="fetch")
    return value
