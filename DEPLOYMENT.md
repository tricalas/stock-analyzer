# Production deployment

The public application is served at https://www.tricalas.com (Vercel project `stock-analyzer`, root directory `frontend`). The API is hosted on Railway at https://victorious-determination-production-dafc.up.railway.app.

## Services

- Railway API: `API (FastAPI)`, application root `/backend`, `APP_ROLE=api`.
- Railway scheduler/monitor: `stock-analyzer`, `APP_ROLE=scheduler`.
- Railway worker: `Worker (Celery)`, `APP_ROLE=worker`.
- PostgreSQL stores application data. Redis provides the Celery broker/result backend and shared API cache.
- `start-service.sh` selects the API, worker or scheduler role. All roles run `python -m app.migrate`; a failed migration prevents startup.
- The dedicated scheduler dispatches automatic collection and analysis. NYSE sessions determine the expected date, including daylight saving time, holidays and early closes.

## Required environment

```env
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>
REDIS_URL=redis://:<password>@<host>:6379
ENVIRONMENT=production
SECRET_KEY=<unique-random-value-at-least-32-characters>
SUPER_PIN=
CORS_ORIGINS=https://tricalas.com,https://www.tricalas.com,https://stock-analyzer-tricalas.vercel.app
APP_ROLE=api
ENABLE_AUTO_HISTORY_COLLECTION=false
HISTORY_COLLECTION_DAYS=180
HISTORY_COLLECTION_MODE=all
KIS_APP_KEY=<configured-in-Railway>
KIS_APP_SECRET=<configured-in-Railway>
KIS_IS_MOCK=true
```

Generate `SECRET_KEY` with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`. Never commit generated keys, PINs, database dumps, or service credentials. Rotating the JWT key requires users to sign in again. `SUPER_PIN` is disabled when empty. Existing users and their PIN hashes are preserved.

The worker uses `APP_ROLE=worker` and `ENABLE_AUTO_HISTORY_COLLECTION=false`. The scheduler uses `APP_ROLE=scheduler`, `ENABLE_AUTO_HISTORY_COLLECTION=true` and `API_PUBLIC_URL` set to the API URL. Keep JWT, database, Redis and KIS settings consistent across services. The frontend needs `NEXT_PUBLIC_API_URL` set to the API URL above in Vercel.

## Validate before deployment

Python 3.11+ and Node 24 are supported. Use npm with the committed `package-lock.json`; existing Yarn files are not used by the deployment.

```sh
cd backend
pip install -r requirements.txt
python -B -m unittest discover -s tests -v
cd ../frontend
npm ci
npm test
npm run typecheck
npm run build
npm audit
```

Tests use temporary databases and mocked market APIs. A clean Linux install is also verified by the Vercel build. Local build output uses `.next-build`; Vercel uses `.next`.

## Rollout and recovery

1. Create a PostgreSQL custom-format backup with `pg_dump -Fc`. Store the download outside version control (`.backups/` is ignored).
2. Restore the backup into a temporary database and test `python -m app.migrate` twice. Check row preservation, fractional OHLC types and the four-column signal key.
3. Stage Railway variables and deploy the API, worker and dedicated scheduler services. Use explicit service IDs so the database and Redis services are never redeployed accidentally.
4. Verify API `/health`, login and authenticated stock/tag/task endpoints. Anonymous shared-data writes must return 401; non-admin writes must return 403.
5. Deploy the Vercel `stock-analyzer` project from the repository root (`vercel --prod`), since the project root setting is `frontend`. Verify both public domain aliases.
6. Use `/settings/operations` for durable routine collection and recovery. For a one-time legacy repair, run `python -m app.recover_history` in the deployed backend. This fetches US price history again and rebuilds both signal strategies. The KIS credentials and API mode must be valid. Recovery stops with an error if any stock cannot be recovered; inspect per-stock logs and retry.

The first migration preserves existing rows and tags, upgrades OHLC columns to floating point, and adds separate MA analysis state and MA-period signal identity. Old US prices already lost their decimals, so their MA90 values and active signals are invalidated until recovery. `history_precision_version=0` identifies pending repairs. MA90 requires 90 complete valid sessions.

After rollout, check the recovery count, history freshness, fractional prices, MA90 results and both signal categories. `TaskProgress` and per-stock logs retain progress and failures. Legacy analysis jobs older than the worker timeout are reconciled at API startup. Durable pipelines and queued quote refreshes are recovered by the independent scheduler.

Schema rollback is forward-only: restore the PostgreSQL backup together with the previous application version. Restoring a backup discards subsequent changes; do not do this automatically after the new application has accepted writes.

## Durable operations (November 2026)

- `stock-analyzer` now runs with `APP_ROLE=scheduler`, `ENABLE_AUTO_HISTORY_COLLECTION=true`, and `API_PUBLIC_URL` pointing to the public API. It probes API/Redis/worker health and dispatches due work every minute, independently of the web process and worker queue.
- `Worker (Celery)` keeps `APP_ROLE=worker`. The API uses `APP_ROLE=api`, `ENABLE_AUTO_HISTORY_COLLECTION=false`. Co-locate all three with PostgreSQL and Redis.
- NYSE calendar sessions (holidays, DST and early closes) determine the expected trading date. A daily run becomes eligible 20 minutes after its session closes; a restart catches up the most recent eligible session once.
- The durable flow is quotes → per-stock history and MA90 → trend signals → MA signals. Each Celery message processes a bounded unit (240-second soft / 270-second hard deadline). A six-minute DB lease excludes duplicate execution. Saved stage results survive broker loss or worker replacement; the independent scheduler redispatches expired leases. Per-stock attempts are capped at three, including process deaths.
- A failed stock is excluded from downstream analysis. Other stocks continue. A partial run reports failures rather than claiming full success. Quote-stage failure stops downstream stages and can be resumed by an administrator.
- Administrators manage runs, incidents and recovery at `/settings/operations`. Provider symbol/exchange overrides preserve the original ticker, stock ID, tags and history. Changing an override invalidates analysis until prices have been recollected. Unsupported or unavailable symbols are never automatically labelled as delisted or deleted.
- Alerts are delivered inside the administrator UI and persisted in PostgreSQL. Three consecutive failed dependency probes open an incident; recovery resolves it automatically. Data delay is checked two hours after the expected session close. The UI flags a scheduler heartbeat older than three minutes. External email/chat delivery is not configured.
- Before upgrading, take a fresh `pg_dump -Fc` backup and test migration `0002_durable_operations` against a restored copy. This migration adds provider overrides and operational tables without rewriting price history or account data.

References: [Celery task acknowledgement and worker-loss behavior](https://docs.celeryq.dev/en/stable/userguide/tasks.html), [exchange-calendars](https://pypi.org/project/exchange_calendars/).
