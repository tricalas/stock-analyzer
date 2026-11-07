"""FastAPI application composition and lifecycle."""
from contextlib import asynccontextmanager
import logging
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.middleware.gzip import GZipMiddleware
from sqlalchemy import text
from app.config import settings
from app.database import SessionLocal
from app.bootstrap import seed_default_tags, reconcile_stale_tasks
from app.cache import invalidate_cache
from app.scheduler import stock_scheduler
from app.routers import auth, tags, collection, maintenance, stocks, signals, tasks, admin, operations, research

logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app):
    with SessionLocal() as db:
        seed_default_tags(db)
        reconcile_stale_tasks(db)
    invalidate_cache()
    stock_scheduler.start()
    try:
        yield
    finally:
        stock_scheduler.stop()

app = FastAPI(title="Stock Analyzer API", version="1.1.0", default_response_class=ORJSONResponse, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])

@app.get("/")
def read_root():
    return {"message": "Stock Analyzer API", "version": "1.1.0", "revision": os.getenv("RAILWAY_GIT_COMMIT_SHA") or os.getenv("APP_REVISION", "local")}

@app.get("/health")
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok", "version": "1.1.0"}

for module in (auth, tags, collection, maintenance, stocks, signals, tasks, admin, operations, research):
    app.include_router(module.router)
