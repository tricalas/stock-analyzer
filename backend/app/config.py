from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./stock_analyzer.db"
    REDIS_URL: str = "redis://localhost:6379"
    SECRET_KEY: str = "your-secret-key-here"
    CORS_ORIGINS: List[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"

settings = Settings()