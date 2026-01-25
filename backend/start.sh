#!/bin/bash

# Celery 워커를 백그라운드에서 실행
celery -A app.celery_app worker --loglevel=info --concurrency=2 &

# FastAPI 서버 실행 (foreground)
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
