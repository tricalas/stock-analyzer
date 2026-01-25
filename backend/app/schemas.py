from pydantic import BaseModel, Field, field_validator
from datetime import datetime, date
from typing import Optional, List
import re

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

class StockTagBase(BaseModel):
    name: str
    display_name: str
    color: Optional[str] = None
    icon: Optional[str] = None
    order: Optional[int] = 0
    is_active: Optional[bool] = True
    user_token: Optional[str] = None

class StockTagCreate(StockTagBase):
    pass

class StockTag(StockTagBase):
    id: int
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

    # 태그 목록
    tags: Optional[List['StockTag']] = None

    # 최신 태그 활동 날짜
    latest_tag_date: Optional[datetime] = None

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

class TagAssignmentResponse(BaseModel):
    message: str
    tag: 'StockTag'

class TagListResponse(BaseModel):
    tags: List['StockTag']

# ===== User & Auth Schemas =====

class UserRegister(BaseModel):
    nickname: str = Field(..., min_length=2, max_length=50)
    pin: str = Field(..., min_length=6, max_length=6)

    @field_validator('pin')
    @classmethod
    def validate_pin(cls, v):
        if not re.match(r'^\d{6}$', v):
            raise ValueError('PIN must be exactly 6 digits')
        return v

class UserLogin(BaseModel):
    nickname: str = Field(..., min_length=2, max_length=50)
    pin: str = Field(..., min_length=6, max_length=6)

    @field_validator('pin')
    @classmethod
    def validate_pin(cls, v):
        if not re.match(r'^\d{6}$', v):
            raise ValueError('PIN must be exactly 6 digits')
        return v

class UserResponse(BaseModel):
    id: int
    user_token: str
    nickname: str
    is_admin: bool
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# ===== Signal Schemas =====

class StockSignalBase(BaseModel):
    stock_id: int
    signal_type: str  # "buy", "sell", "hold"
    signal_date: date
    signal_price: float
    strategy_name: str
    current_price: Optional[float] = None
    return_percent: Optional[float] = None
    details: Optional[str] = None  # JSON string

class StockSignalCreate(StockSignalBase):
    pass

class StockSignal(StockSignalBase):
    id: int
    is_active: bool
    analyzed_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class StockSignalWithStock(StockSignal):
    """종목 정보를 포함한 신호"""
    stock: Optional[Stock] = None

class SignalListResponse(BaseModel):
    """신호 목록 응답"""
    total: int
    signals: List[StockSignalWithStock]
    analyzed_at: Optional[datetime] = None  # 마지막 분석 시간
    stats: Optional[dict] = None  # 통계 정보

# ===== Task Progress Schemas =====

class TaskProgressBase(BaseModel):
    task_id: str
    task_type: str  # "history_collection", "signal_analysis"
    status: str  # "running", "completed", "failed"
    total_items: int
    current_item: int
    current_stock_name: Optional[str] = None
    success_count: int
    failed_count: int
    message: Optional[str] = None
    error_message: Optional[str] = None

class TaskProgress(TaskProgressBase):
    id: int
    started_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True