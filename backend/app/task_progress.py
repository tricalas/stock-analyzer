"""Keep task progress stable across Celery retries and redelivery."""
from datetime import datetime
from app.models import TaskProgress


def start_task(db, task_id, task_type, total_items, message):
    task = db.query(TaskProgress).filter(TaskProgress.task_id == task_id).first()
    if task is None:
        task = TaskProgress(task_id=task_id, task_type=task_type)
        db.add(task)
    elif task.task_type != task_type:
        raise ValueError("Task ID belongs to a different task type")
    task.status = "running"
    task.total_items = total_items
    task.current_item = 0
    task.success_count = 0
    task.failed_count = 0
    task.current_stock_name = None
    task.error_message = None
    task.message = message
    task.started_at = datetime.utcnow()
    task.completed_at = None
    db.commit()
    return task
