"""Bound PIN guesses by account and client; Redis shares limits across workers."""
import hashlib
from threading import Lock
from cachetools import TTLCache
from fastapi import HTTPException
import redis
from app import cache

_attempts = TTLCache(maxsize=10000, ttl=600)
_lock = Lock()


def check_login_attempt(nickname, host):
    key = 'auth:attempts:' + hashlib.sha256(f'{nickname}:{host}'.encode()).hexdigest()
    try:
        count = cache._redis.eval(
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],600) end; return n", 1, key)
    except redis.RedisError:
        with _lock:
            count = _attempts.get(key, 0) + 1
            _attempts[key] = count
    if count > 10:
        raise HTTPException(status_code=429, detail='Too many login attempts. Try again in 10 minutes.', headers={'Retry-After':'600'})
