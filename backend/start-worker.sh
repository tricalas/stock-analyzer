#!/bin/sh
set -eu
python -m app.migrate
exec celery -A app.celery_app worker --loglevel=info --concurrency=2
