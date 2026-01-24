from pydantic_settings import BaseSettings
from typing import List, Union
from pydantic import field_validator

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stock_analyzer.db"
    REDIS_URL: str = "redis://localhost:6379"
    SECRET_KEY: str = "your-secret-key-here"
    SUPER_PIN: str = "999999"  # 슈퍼 관리자 PIN
    CORS_ORIGINS: Union[List[str], str] = "http://localhost:3000"

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