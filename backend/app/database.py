from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

# SQLite specific configuration
if settings.DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={
            "check_same_thread": False,
            "timeout": 20
        },
        pool_pre_ping=True,
        echo=False
    )
else:
    # PostgreSQL 연결 풀 최적화
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=20,              # 연결 풀 크기 증가
        max_overflow=40,           # 추가 연결 허용
        pool_pre_ping=True,        # 연결 유효성 검사
        pool_recycle=3600,         # 1시간마다 연결 재생성
        echo=False
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()