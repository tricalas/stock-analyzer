from pydantic_settings import BaseSettings
from typing import List, Union, Optional
from pydantic import field_validator, model_validator
import secrets
import os

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stock_analyzer.db"
    # Railway uses REDIS_PRIVATE_URL or REDIS_URL
    REDIS_URL: str = os.environ.get("REDIS_PRIVATE_URL") or os.environ.get("REDIS_URL") or "redis://localhost:6379"
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = ""
    SUPER_PIN: str = ""  # Disabled unless explicitly configured
    CORS_ORIGINS: Union[List[str], str] = "http://localhost:3000"

    @model_validator(mode="after")
    def validate_security(self):
        weak_key = not self.SECRET_KEY or self.SECRET_KEY.startswith("your-secret")
        if self.ENVIRONMENT == "production":
            if weak_key or len(self.SECRET_KEY) < 32:
                raise ValueError("Production requires a unique SECRET_KEY of at least 32 characters")
            if self.SUPER_PIN == "999999":
                raise ValueError("The default SUPER_PIN is not allowed in production; clear it to disable")
            if "*" in self.CORS_ORIGINS:
                raise ValueError("Production requires explicit CORS origins")
        elif weak_key:
            self.SECRET_KEY = secrets.token_urlsafe(48)
        return self

    # 한국투자증권 Open API 설정
    KIS_APP_KEY: str = ""
    KIS_APP_SECRET: str = ""
    KIS_ACCOUNT_NUMBER: str = ""  # 계좌번호 8자리
    KIS_ACCOUNT_CODE: str = ""  # 계좌상품코드 2자리
    KIS_IS_MOCK: bool = True  # True: 모의투자, False: 실전투자

    # 스케줄러 설정
    ENABLE_AUTO_HISTORY_COLLECTION: bool = False  # 자동 히스토리 수집 활성화 여부
    API_PUBLIC_URL: str = ""
    MONITOR_FAILURE_THRESHOLD: int = 3
    DATA_DELAY_MINUTES: int = 120
    HISTORY_COLLECTION_DAYS: int = 100  # 수집할 히스토리 일수 (기본: 100일)
    HISTORY_COLLECTION_MODE: str = "all"  # "tagged": 태그 종목만, "all": 모든 활성 종목, "top": 시총 상위
    HISTORY_COLLECTION_LIMIT: int = 500  # "top" 모드일 때 상위 몇 개 종목만 수집할지 (시총 기준)
    HISTORY_COLLECTION_WORKERS: int = 5  # 병렬 수집 워커 수 (1~20, 기본 5)

    # 종목 크롤링 설정
    US_STOCK_CRAWL_LIMIT: int = 1000  # 미국 주식 크롤링 시 시총 상위 몇 개까지 (기본: 1000, 0=전체)

    @field_validator('CORS_ORIGINS', mode='before')
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            # Split by comma if it's a comma-separated string
            return [origin.strip() for origin in v.split(',')]
        return v

    class Config:
        env_file = ".env"

settings = Settings()
