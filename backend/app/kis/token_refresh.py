"""Coordinate KIS refreshes across threads and PostgreSQL worker processes."""
from contextlib import contextmanager
from datetime import datetime, timedelta
from threading import RLock
import hashlib
from sqlalchemy import text

_LOCKS = {}
_REGISTRY_LOCK = RLock()
COOLDOWN_SECONDS = 65


class KISTokenRetry(RuntimeError):
    """Safe diagnostic text; never includes credentials or token response bodies."""


@contextmanager
def refresh_lock(client):
    from app.database import engine
    identity = hashlib.sha256(f'kis:{client.app_key}:{client.is_mock}'.encode()).digest()
    with _REGISTRY_LOCK:
        lock = _LOCKS.setdefault(identity, RLock())
    with lock:
        connection = None
        acquired = False
        key = int.from_bytes(identity[:8], 'big', signed=True)
        try:
            if engine.dialect.name == 'postgresql':
                connection = engine.connect()
                acquired = connection.execute(text('SELECT pg_try_advisory_lock(:key)'), {'key': key}).scalar()
                connection.commit()
                if not acquired:
                    raise KISTokenRetry('KIS token refresh in progress; retry after cooldown')
            yield identity.hex()
        finally:
            if connection is not None:
                try:
                    if acquired:
                        connection.execute(text('SELECT pg_advisory_unlock(:key)'), {'key': key})
                        connection.commit()
                except Exception:
                    # Never return a connection with a session advisory lock to the pool.
                    connection.invalidate()
                finally:
                    connection.close()


def refresh_token(client, rejected_token=None):
    from app.database import SessionLocal
    from app.models import TokenRefreshState
    try:
        # Re-read the shared cache before issuing: another process may have renewed it.
        if client._load_cached_token(rejected_token=rejected_token):
            return
        with refresh_lock(client) as identity:
            if client._load_cached_token(rejected_token=rejected_token):
                return
            now = datetime.utcnow()
            with SessionLocal() as db:
                state = db.get(TokenRefreshState, identity)
                if state and state.next_attempt_at and state.next_attempt_at > now:
                    raise KISTokenRetry('KIS token refresh cooldown; retry later')
                if state is None:
                    state = TokenRefreshState(key=identity)
                    db.add(state)
                # Commit BEFORE HTTP: a crash must not allow an immediate duplicate issue.
                state.next_attempt_at = now + timedelta(seconds=COOLDOWN_SECONDS)
                db.commit()
            client._request_new_token()
            client._save_token_cache()
    except KISTokenRetry:
        raise
    except Exception:
        client.access_token = None
        client.token_expired_at = None
        # Fail closed if coordination/storage is unavailable. SQL errors can contain tokens.
        raise KISTokenRetry('KIS token refresh coordination unavailable; retry later') from None
