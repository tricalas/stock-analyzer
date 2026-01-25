from pydantic_settings import BaseSettings
from typing import List, Union, Optional
from pydantic import field_validator
import os

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stock_analyzer.db"
    # Railway uses REDIS_PRIVATE_URL or REDIS_URL
    REDIS_URL: str = os.environ.get("REDIS_PRIVATE_URL") or os.environ.get("REDIS_URL") or "redis://localhost:6379"
    SECRET_KEY: str = "your-secret-key-here"
    SUPER_PIN: str = "999999"  # 슈퍼 관리자 PIN
    CORS_ORIGINS: Union[List[str], str] = "http://localhost:3000"

    # 한국투자증권 Open API 설정
    KIS_APP_KEY: str = ""
    KIS_APP_SECRET: str = ""
    KIS_ACCOUNT_NUMBER: str = ""  # 계좌번호 8자리
    KIS_ACCOUNT_CODE: str = ""  # 계좌상품코드 2자리
    KIS_IS_MOCK: bool = True  # True: 모의투자, False: 실전투자

    # 스케줄러 설정
    ENABLE_AUTO_HISTORY_COLLECTION: bool = False  # 자동 히스토리 수집 활성화 여부
    HISTORY_COLLECTION_DAYS: int = 100  # 수집할 히스토리 일수 (기본: 100일)
    HISTORY_COLLECTION_MODE: str = "all"  # "tagged": 태그 종목만, "all": 모든 활성 종목, "top": 시총 상위
    HISTORY_COLLECTION_LIMIT: int = 500  # "top" 모드일 때 상위 몇 개 종목만 수집할지 (시총 기준)
    HISTORY_COLLECTION_WORKERS: int = 5  # 병렬 수집 워커 수 (1~20, 기본 5)

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