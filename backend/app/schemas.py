from pydantic import BaseModel
from datetime import datetime, date
from typing import Optional, List

class StockBase(BaseModel):
    symbol: str
    name: str
    market: str
    exchange: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None

    # 기본 가격 정보
    current_price: Optional[float] = None
    previous_close: Optional[float] = None
    change_amount: Optional[float] = None
    change_percent: Optional[float] = None

    # 기업 정보
    face_value: Optional[float] = None
    market_cap: Optional[float] = None
    shares_outstanding: Optional[float] = None
    foreign_ratio: Optional[float] = None
    trading_volume: Optional[float] = None

    # 재무 지표
    per: Optional[float] = None
    roe: Optional[float] = None

    # 순위 정보
    market_cap_rank: Optional[int] = None

class StockCreate(StockBase):
    pass

class Stock(StockBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class StockPriceBase(BaseModel):
    date: date
    open: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    close: float
    volume: Optional[float] = None
    change: Optional[float] = None
    change_percent: Optional[float] = None

class StockPrice(StockPriceBase):
    id: int
    stock_id: int
    created_at: datetime

    class Config:
        from_attributes = True

class StockDailyDataBase(BaseModel):
    date: date
    per: Optional[float] = None
    pbr: Optional[float] = None
    roe: Optional[float] = None
    eps: Optional[float] = None
    dividend_yield: Optional[float] = None
    ma5: Optional[float] = None
    ma20: Optional[float] = None
    ma60: Optional[float] = None
    ma120: Optional[float] = None
    rsi: Optional[float] = None
    foreign_ownership: Optional[float] = None
    institution_ownership: Optional[float] = None

class StockDailyData(StockDailyDataBase):
    id: int
    stock_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class StockWithLatestPrice(Stock):
    latest_price: Optional[float] = None
    latest_change: Optional[float] = None
    latest_change_percent: Optional[float] = None
    latest_volume: Optional[float] = None

    # 히스토리 데이터 상태
    history_records_count: Optional[int] = None
    history_latest_date: Optional[str] = None
    history_oldest_date: Optional[str] = None
    has_history_data: Optional[bool] = None
    ma90_price: Optional[float] = None
    ma90_percentage: Optional[float] = None

    # 즐겨찾기/싫어요 상태
    is_favorite: Optional[bool] = None
    is_dislike: Optional[bool] = None

class StockPriceHistoryBase(BaseModel):
    date: date
    open_price: Optional[int] = None
    high_price: Optional[int] = None
    low_price: Optional[int] = None
    close_price: Optional[int] = None
    volume: Optional[int] = None

class StockPriceHistory(StockPriceHistoryBase):
    id: int
    stock_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class CrawlingStatus(BaseModel):
    success: int
    failed: int
    total: int
    message: Optional[str] = None

class PaginationParams(BaseModel):
    skip: int = 0
    limit: int = 50

class StockListResponse(BaseModel):
    total: int
    stocks: List[StockWithLatestPrice]
    page: int
    page_size: int