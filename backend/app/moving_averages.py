"""Moving averages use complete trading sessions, never partial windows."""
import math
from app.models import Stock, StockPriceHistory


def update_ma90(stock_id, db, as_of=None):
    stock = db.query(Stock.market, Stock.history_precision_version).filter(Stock.id == stock_id).first()
    repaired = stock is not None and (stock.market != "US" or stock.history_precision_version >= 1)
    query = db.query(StockPriceHistory.close_price).filter(StockPriceHistory.stock_id == stock_id)
    if as_of is not None:
        query = query.filter(StockPriceHistory.date <= as_of)
    rows = query.order_by(StockPriceHistory.date.desc()).limit(90).all()
    prices = [r.close_price for r in rows]
    value = None
    if repaired and len(prices) == 90 and all(p is not None and math.isfinite(p) and p > 0 for p in prices):
        value = math.fsum(prices) / 90
    db.query(Stock).filter(Stock.id == stock_id).update({"ma90_price": value}, synchronize_session="fetch")
    return value
