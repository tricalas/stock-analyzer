"""Shared API cache used by both web processes and background workers."""
import logging
from threading import RLock
from cachetools import TTLCache
import orjson
import redis
from app.config import settings

logger = logging.getLogger(__name__)
_memory = TTLCache(maxsize=1000, ttl=300)
_lock = RLock()
_redis = redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)


def get_cache(key):
    try:
        value = _redis.get(f"stocks:{key}")
        return orjson.loads(value) if value else None
    except redis.RedisError:
        with _lock:
            return _memory.get(key)


def set_cache(key, value, ttl=300):
    try:
        _redis.setex(f"stocks:{key}", ttl, orjson.dumps(value, default=str))
    except redis.RedisError:
        with _lock:
            _memory[key] = value


def invalidate_cache():
    with _lock:
        _memory.clear()
    try:
        for key in _redis.scan_iter("stocks:*"):
            _redis.delete(key)
    except redis.RedisError:
        logger.debug("Redis unavailable; cleared process cache")


def cache_backend_available():
    try:
        return bool(_redis.ping())
    except redis.RedisError:
        return False
