#!/bin/bash

# FastAPI 서버 실행 (API 전용)
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
