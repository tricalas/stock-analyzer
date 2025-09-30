from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, ForeignKey, Date, BigInteger, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

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

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    price_data = relationship("StockPrice", back_populates="stock", cascade="all, delete-orphan")
    daily_data = relationship("StockDailyData", back_populates="stock", cascade="all, delete-orphan")
    price_history = relationship("StockPriceHistory", back_populates="stock", cascade="all, delete-orphan")
    favorites = relationship("StockFavorite", back_populates="stock", cascade="all, delete-orphan")
    dislikes = relationship("StockDislike", back_populates="stock", cascade="all, delete-orphan")

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

class StockFavorite(Base):
    __tablename__ = "stock_favorites"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # 관계 설정
    stock = relationship("Stock", back_populates="favorites")

    __table_args__ = (
        UniqueConstraint('stock_id', name='unique_favorite_stock'),
        {'extend_existing': True}
    )

class StockDislike(Base):
    __tablename__ = "stock_dislikes"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # 관계 설정
    stock = relationship("Stock", back_populates="dislikes")

    __table_args__ = (
        UniqueConstraint('stock_id', name='unique_dislike_stock'),
        {'extend_existing': True}
    )