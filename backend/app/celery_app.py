"""
Celery 설정 및 애플리케이션 생성
"""
from celery import Celery
from app.config import settings

celery_app = Celery(
    "stock_analyzer",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Seoul",
    task_track_started=True,
    task_time_limit=3600,  # 1시간 제한
    task_soft_time_limit=3540,  # 59분 soft 제한 (정리 시간 확보)
    worker_prefetch_multiplier=1,  # 한 번에 하나씩 가져오기 (긴 작업에 적합)
    task_acks_late=True,  # 작업 완료 후 ACK (안정성 향상)
)
