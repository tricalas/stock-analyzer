import logging
from sqlalchemy.orm import Session
from app.models import StockTag
logger = logging.getLogger(__name__)

def seed_default_tags(db: Session):
    """기본 태그 데이터 생성 (시스템 태그는 user_token=None)"""
    default_tags = [
        {
            "name": "favorite",
            "display_name": "관심",
            "color": "primary",
            "icon": "Star",
            "order": 0,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "dislike",
            "display_name": "제외",
            "color": "loss",
            "icon": "ThumbsDown",
            "order": 99,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "owned",
            "display_name": "보유",
            "color": "gain",
            "icon": "ShoppingCart",
            "order": 1,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "recommended",
            "display_name": "추천",
            "color": "primary",
            "icon": "ThumbsUp",
            "order": 2,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "watching",
            "display_name": "관찰",
            "color": "muted",
            "icon": "Eye",
            "order": 3,
            "user_token": None  # 시스템 태그
        },
        {
            "name": "error",
            "display_name": "에러",
            "color": "loss",
            "icon": "AlertCircle",
            "order": 98,
            "user_token": None  # 시스템 태그
        }
    ]

    for tag_data in default_tags:
        if db.query(StockTag).filter(StockTag.name == tag_data["name"], StockTag.user_token == None).first():
            continue
        tag = StockTag(**tag_data)
        db.add(tag)
        logger.info(f"Created default tag: {tag_data['display_name']}")

    db.commit()
    logger.info("Default tags seeded successfully")




def reconcile_stale_tasks(db):
    from datetime import datetime, timedelta
    from app.models import TaskProgress
    cutoff = datetime.utcnow() - timedelta(hours=2)
    db.query(TaskProgress).filter(TaskProgress.status == 'running', TaskProgress.updated_at < cutoff).update({
        'status':'failed', 'error_message':'Worker stopped before completion; retry this task.',
        'completed_at':datetime.utcnow()}, synchronize_session=False)
    db.commit()
