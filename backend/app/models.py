from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey, Date, BigInteger, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
import uuid

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    user_token = Column(String(255), unique=True, index=True, nullable=False, default=lambda: str(uuid.uuid4()))
    nickname = Column(String(50), nullable=False)
    pin_hash = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)

    __table_args__ = (
        {'extend_existing': True}
    )

class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    market = Column(String(10), nullable=False)  # KR, US
    exchange = Column(String(50))  # KOSPI, KOSDAQ, NASDAQ, NYSE
    sector = Column(String(100))
    industry = Column(String(100))

    # 기본 가격 정보
    current_price = Column(Float)
    previous_close = Column(Float)
    change_amount = Column(Float)
    change_percent = Column(Float)

    # 기업 정보
    face_value = Column(Float)  # 액면가
    market_cap = Column(Float)  # 시가총액
    shares_outstanding = Column(Float)  # 상장주식수
    foreign_ratio = Column(Float)  # 외국인비율
    trading_volume = Column(Float)  # 거래량

    # 재무 지표
    per = Column(Float)  # PER
    roe = Column(Float)  # ROE

    # 순위 정보
    market_cap_rank = Column(Integer)  # 시가총액 순위

    # 기술적 지표
    ma90_price = Column(Float)  # 90일 이동평균가

    # 히스토리 데이터 캐시 (조인 없이 빠른 조회용)
    history_records_count = Column(Integer, default=0)  # 수집된 히스토리 레코드 수

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    price_data = relationship("StockPrice", back_populates="stock", cascade="all, delete-orphan")
    daily_data = relationship("StockDailyData", back_populates="stock", cascade="all, delete-orphan")
    price_history = relationship("StockPriceHistory", back_populates="stock", cascade="all, delete-orphan")

class StockPrice(Base):
    __tablename__ = "stock_prices"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float, nullable=False)
    volume = Column(Float)
    change = Column(Float)
    change_percent = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)

    stock = relationship("Stock", back_populates="price_data")

    __table_args__ = (
        {'extend_existing': True}
    )

class StockDailyData(Base):
    __tablename__ = "stock_daily_data"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)

    # 재무 지표
    per = Column(Float)  # Price to Earnings Ratio
    pbr = Column(Float)  # Price to Book Ratio
    roe = Column(Float)  # Return on Equity
    eps = Column(Float)  # Earnings Per Share
    dividend_yield = Column(Float)

    # 기술적 지표
    ma5 = Column(Float)   # 5일 이동평균
    ma20 = Column(Float)  # 20일 이동평균
    ma60 = Column(Float)  # 60일 이동평균
    ma120 = Column(Float) # 120일 이동평균
    rsi = Column(Float)   # Relative Strength Index

    # 추가 정보
    foreign_ownership = Column(Float)  # 외국인 보유율 (한국 주식)
    institution_ownership = Column(Float)  # 기관 보유율

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    stock = relationship("Stock", back_populates="daily_data")

    __table_args__ = (
        {'extend_existing': True}
    )

class StockPriceHistory(Base):
    __tablename__ = "stock_price_history"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)

    # 가격 정보
    open_price = Column(Integer)  # 시가
    high_price = Column(Integer)  # 고가
    low_price = Column(Integer)   # 저가
    close_price = Column(Integer) # 종가
    volume = Column(BigInteger)   # 거래량

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 관계 설정
    stock = relationship("Stock", back_populates="price_history")

    __table_args__ = (
        UniqueConstraint('stock_id', 'date', name='unique_stock_date'),
        Index('idx_stock_date', 'stock_id', 'date'),
        {'extend_existing': True}
    )

class CrawlingLog(Base):
    __tablename__ = "crawling_logs"

    id = Column(Integer, primary_key=True, index=True)
    stock_symbol = Column(String(20))
    market = Column(String(10))
    status = Column(String(20))  # SUCCESS, FAILED, PARTIAL
    message = Column(Text)
    crawled_at = Column(DateTime, default=datetime.utcnow)
    duration_seconds = Column(Float)


class StockTag(Base):
    __tablename__ = "stock_tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False, index=True)  # owned, recommended, watching, near_ma90
    display_name = Column(String(100), nullable=False)  # 보유중, 추천종목, 관찰종목, 90일선 근처
    color = Column(String(20))  # primary, gain, loss, muted
    icon = Column(String(50))  # lucide icon 이름
    order = Column(Integer, default=0)  # 표시 순서
    is_active = Column(Boolean, default=True)
    user_token = Column(String(255), nullable=True, index=True)  # 사용자 토큰 (NULL이면 시스템 태그)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 관계 설정
    assignments = relationship("StockTagAssignment", back_populates="tag", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('name', 'user_token', name='unique_tag_per_user'),
        {'extend_existing': True}
    )

class StockTagAssignment(Base):
    __tablename__ = "stock_tag_assignments"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    tag_id = Column(Integer, ForeignKey("stock_tags.id"), nullable=False, index=True)
    user_token = Column(String(255), nullable=True, index=True)  # 사용자 토큰
    created_at = Column(DateTime, default=datetime.utcnow)

    # 관계 설정
    stock = relationship("Stock")
    tag = relationship("StockTag", back_populates="assignments")

    __table_args__ = (
        UniqueConstraint('stock_id', 'tag_id', 'user_token', name='unique_stock_tag_user'),
        {'extend_existing': True}
    )

class StockSignal(Base):
    """매매 신호 분석 결과 저장"""
    __tablename__ = "stock_signals"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)

    # 신호 정보
    signal_type = Column(String(20), nullable=False)  # "buy", "sell", "hold"
    signal_date = Column(Date, nullable=False, index=True)  # 신호 발생 날짜
    signal_price = Column(Float, nullable=False)  # 신호 발생 시 가격

    # 전략 정보
    strategy_name = Column(String(50), nullable=False)  # "breakout_pullback"

    # 성과 정보
    current_price = Column(Float)  # 현재 가격
    return_percent = Column(Float)  # 수익률 (%)

    # 신호 세부 정보 (JSON)
    details = Column(Text)  # JSON 형태로 저장 (breakout_date, pullback_date 등)

    # 메타 정보
    is_active = Column(Boolean, default=True, nullable=False)  # 활성 신호 여부
    analyzed_at = Column(DateTime, default=datetime.utcnow, index=True)  # 분석 시간
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 관계 설정
    stock = relationship("Stock")

    __table_args__ = (
        # 같은 종목, 같은 날짜, 같은 전략에 대해서는 하나의 신호만 저장
        UniqueConstraint('stock_id', 'signal_date', 'strategy_name', name='unique_stock_signal'),
        # 분석 시간과 활성 상태로 검색을 위한 복합 인덱스
        Index('idx_signal_analyzed_active', 'analyzed_at', 'is_active'),
        # 신호 타입과 날짜로 검색을 위한 복합 인덱스
        Index('idx_signal_type_date', 'signal_type', 'signal_date'),
        {'extend_existing': True}
    )

class TaskProgress(Base):
    """백그라운드 작업 진행 상황 추적"""
    __tablename__ = "task_progress"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(100), unique=True, nullable=False, index=True)  # UUID
    task_type = Column(String(50), nullable=False)  # "history_collection", "signal_analysis"

    # 진행 상황
    status = Column(String(20), nullable=False)  # "running", "completed", "failed"
    total_items = Column(Integer, default=0)
    current_item = Column(Integer, default=0)
    current_stock_name = Column(String(255))  # 현재 처리 중인 종목

    # 결과
    success_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    message = Column(Text)  # 상태 메시지
    error_message = Column(Text)  # 에러 메시지

    # 시간
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime)

    __table_args__ = (
        # 최신 작업 조회를 위한 인덱스
        Index('idx_task_started', 'started_at'),
        Index('idx_task_status', 'status'),
        {'extend_existing': True}
    )


class HistoryCollectionLog(Base):
    """히스토리 수집 개별 종목 로그"""
    __tablename__ = "history_collection_logs"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String(100), nullable=False, index=True)  # TaskProgress의 task_id

    # 종목 정보
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    stock_symbol = Column(String(50), nullable=False)
    stock_name = Column(String(255), nullable=False)

    # 수집 결과
    status = Column(String(20), nullable=False)  # "success", "failed"
    records_saved = Column(Integer, default=0)
    error_message = Column(Text)

    # 시간
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime)

    # 관계
    stock = relationship("Stock", backref="collection_logs")

    __table_args__ = (
        Index('idx_log_task_id', 'task_id'),
        Index('idx_log_status', 'status'),
        Index('idx_log_task_status', 'task_id', 'status'),  # 실패 조회용
        {'extend_existing': True}
    )


class ApiTokenCache(Base):
    """API 토큰 캐시 (KIS 등 외부 API용)"""
    __tablename__ = "api_token_cache"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False)  # 'kis', 'naver' 등
    cache_key = Column(String(100), nullable=False)  # 앱키 기반 해시
    access_token = Column(Text, nullable=False)
    expired_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('provider', 'cache_key', name='uq_provider_cache_key'),
        {'extend_existing': True}
    )