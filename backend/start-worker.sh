#!/bin/bash

# Celery 워커 실행 (Worker 전용)
celery -A app.celery_app worker --loglevel=info --concurrency=2
