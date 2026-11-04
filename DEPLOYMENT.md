# Production deployment

The public application is served at https://www.tricalas.com (Vercel project `stock-analyzer`, root directory `frontend`). The API is hosted on Railway at https://victorious-determination-production-dafc.up.railway.app.

## Services

- Railway API: `API (FastAPI)`, application root `/backend`, `APP_ROLE=api`.
- Railway workers: `stock-analyzer` and `Worker (Celery)`, `APP_ROLE=worker`.
- PostgreSQL stores application data. Redis provides the Celery broker/result backend and shared API cache.
- `start-service.sh` selects the role. Both web and worker startup run `python -m app.migrate`; a failed migration prevents startup.
- Automatic history collection and analysis run only in the API process. Scheduling uses `America/New_York`, including daylight saving time.

## Required environment

```env
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>
REDIS_URL=redis://:<password>@<host>:6379
ENVIRONMENT=production
SECRET_KEY=<unique-random-value-at-least-32-characters>
SUPER_PIN=
CORS_ORIGINS=https://tricalas.com,https://www.tricalas.com,https://stock-analyzer-tricalas.vercel.app
APP_ROLE=api
ENABLE_AUTO_HISTORY_COLLECTION=true
HISTORY_COLLECTION_DAYS=180
HISTORY_COLLECTION_MODE=all
KIS_APP_KEY=<configured-in-Railway>
KIS_APP_SECRET=<configured-in-Railway>
KIS_IS_MOCK=true
```

Generate `SECRET_KEY` with `python -c 'import secrets; print(secrets.token_urlsafe(48))'`. Never commit generated keys, PINs, database dumps, or service credentials. Rotating the JWT key requires users to sign in again. `SUPER_PIN` is disabled when empty. Existing users and their PIN hashes are preserved.

Worker services use `APP_ROLE=worker` and `ENABLE_AUTO_HISTORY_COLLECTION=false`. Keep JWT, database, Redis and KIS settings consistent across services. The frontend needs `NEXT_PUBLIC_API_URL` set to the API URL above in Vercel.

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
3. Stage Railway variables and deploy the API and both worker services. Use explicit service IDs so the database and Redis services are never redeployed accidentally.
4. Verify API `/health`, login and authenticated stock/tag/task endpoints. Anonymous shared-data writes must return 401; non-admin writes must return 403.
5. Deploy the Vercel `stock-analyzer` project from the repository root (`vercel --prod`), since the project root setting is `frontend`. Verify both public domain aliases.
6. Run `python -m app.recover_history` in the deployed backend. This fetches US price history again and rebuilds both signal strategies. The KIS credentials and API mode must be valid. Recovery stops with an error if any stock cannot be recovered; inspect per-stock logs and retry.

The first migration preserves existing rows and tags, upgrades OHLC columns to floating point, and adds separate MA analysis state and MA-period signal identity. Old US prices already lost their decimals, so their MA90 values and active signals are invalidated until recovery. `history_precision_version=0` identifies pending repairs. MA90 requires 90 complete valid sessions.

After rollout, check the recovery count, history freshness, fractional prices, MA90 results and both signal categories. `TaskProgress` and per-stock logs retain progress and failures. Jobs older than the worker timeout are reconciled at API startup.

Schema rollback is forward-only: restore the PostgreSQL backup together with the previous application version. Restoring a backup discards subsequent changes; do not do this automatically after the new application has accepted writes.
