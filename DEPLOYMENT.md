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

## Freshness and research validation

Migration `0003_data_freshness` adds independent quote collection timestamps and closed-session/analysis dates. A candle is final only when it was fetched after its exchange session closed. Intraday rows are fetched again even if their date matches the expected session. The migration does not infer quote timestamps from general stock update times or invent missing analysis dates. US and Korean session calendars are evaluated separately; Korean stocks remain outside automatic collection.

The stock and signal views expose the confirmed trading date, collection time and both analysis dates. `/api/data-status` reports actual coverage instead of presenting a single maximum date as proof that every stock is current. Administrator operations also supports an explicit recent-seven-day refresh, which can repair earlier intraday snapshots before rebuilding derived signals.

Backtesting is available at `/backtest` and authenticated `POST /api/backtests`. It requests KIS `MODP=1` into a separate short-lived cache and never rewrites the raw chart database. Supported entries are MA20/60 golden cross, MA20/60/90 upward breakout and confirmed descending-trendline breakout. Swing highs are usable only after their confirmation window; appending future bars cannot rewrite previous decisions. Entry occurs at the next session open, costs apply on both sides, only one long fractional position is held, and both strategy and buy-and-hold benchmark liquidate at the declared period end. Signals stored by earlier analyzers are not used as historical backtest inputs.

Results include net/gross return, cost drag, benchmark return, maximum drawdown, equity curve and the trade ledger. Required dates, finite positive OHLC values and large discontinuities are checked. Missing adjusted data never falls back silently to raw prices. The calculation is a provider-adjusted price-return simulation: cash dividends, taxes, FX and market impact are not separately credited or charged; it is not a historical-universe portfolio study. Default fees/slippage are editable examples, not broker pricing.

Validate with backend regression tests, frontend transport/freshness tests, TypeScript/build checks and a restored PostgreSQL migration review. After rollout, use the recent-seven-day refresh and verify the expected completed session, post-close collection evidence and matching analysis dates on the live database.

Data parameter reference: [KIS overseas daily-price provider implementation](https://github.com/koreainvestment/open-trading-api/blob/main/backtester/kis_backtest/providers/kis/data.py).

## Shared KIS tokens and automatic recovery (November 15, 2026)

Migration `0004_token_refresh_state` preserves existing tokens and adds durable refresh cooldowns. Each client reloads the shared token cache before renewal. A PostgreSQL advisory lock serializes issuance per app/environment across processes; a thread lock covers in-process concurrency. A 65-second cooldown is committed before contacting KIS and survives worker loss. Both real and paper personal-client authentication use `/oauth2/tokenP`, following the [official KIS example](https://github.com/koreainvestment/open-trading-api/blob/main/examples_user/kis_auth.py). Provider-reported expiry is interpreted in Korea time and never extended beyond `expires_in`. Rejected bearer tokens are refreshed and replayed once for history reads. Diagnostics expose HTTP status and provider error code without logging token bodies or credentials.

Token/network failures remain pending for up to three per-item attempts. The scheduler creates at most three idempotent recovery runs per completed session, waiting 5, 15 and 60 minutes after the preceding run. Temporary/token/stale failures remain eligible; empty provider responses get one recovery round. Historical integrity failures and provider-symbol reviews remain visible for manual review. Successful recovery rebuilds both analysis categories and clears the stock's recovery issue. New daily runs remain independent of prior recovery rounds.

Collection checks the completed-session calendar over the recent 180-day range, including internal missing sessions even when a newer candle exists. It fetches from the earliest gap and rejects a response that still omits required sessions. Existing historical rows, account data and tags are preserved. Verify PostgreSQL migration idempotence, actual advisory-lock exclusion, shared cache reuse, cooldown persistence, bounded recovery and a live missing-session audit before declaring a backfill complete.

## Signal feed filtering and quality (November 15, 2026)

`GET /api/signals` contains only the four trendline/pattern strategies; `GET /api/signals/ma` contains only MA strategies. Both use `signal_feed.py` for server-side strategy, literal ticker/name search, calendar-day window, price-change filters and ordering. Search is bounded to 50 characters, windows to 1–30 days, and page sizes remain bounded. Pages sort by signal date and ID, with an optional price-change sort; `next_skip` is calculated after filtering. Aggregated counts, distinct stocks, positive/negative/zero/unknown changes, averages and last-analysis timestamps use the same filtered current records on every page. Unknown changes are excluded from averages and remain distinct from zero.

Eligibility requires an active stock and signal, verified precision for US prices, the latest completed exchange session for both candles and the selected analysis family, sufficient history, and stock/individual-signal analysis timestamps no older than the collected history. Windows end at the completed exchange session, not the API host's date. Delayed/unknown analysis is excluded and counted as `excluded_stale` within the requested filters. Historical signals are preserved in the database. Response metadata names the expected US/KR sessions and the price snapshot time; MA responses retain dictionary details and flat stock fields, while trendline responses retain nested stock data.

The signal page sends every filter to the API, keys pagination by the complete filter set, cancels superseded requests, and offers retry paths for both initial and later pages. MA periods, analysis snapshot prices, selected-family freshness, calculation explanations and a cost-aware backtest link clarify interpretation. The displayed change is price movement since the signal-day close, including for sell signals; it is not realized trade performance. There are no changes to signal generation algorithms, account data, tags or stored price history in this release.


## Verified listing reviews and venue transfers (November 15, 2026)

Recovery records distinguish `open` (needs recovery), `resolved` (a successful collection), and `reviewed` (verified reason to pause automatic collection). Administrators can inspect every state in Operations. A review requires a reason and an HTTPS evidence link in the notes. Reviewed stocks keep their IDs, original tickers, tags, history and audit records; they are excluded from routine collection, new quote updates, current signals and backtests. Reopening a review invalidates completion and forces a new collection. An empty API response alone never closes a review or establishes delisting.

Provider overrides normally invalidate historical precision. For an independently verified transfer of the same security, an administrator may explicitly preserve **already validated** historical prices and re-fetch the replacement provider's available history. Legacy precision-0 records cannot use this option. The workflow requires a newly returned candle for the latest completed session, checks internal session gaps, and rebuilds both analysis categories. Quotes for overridden tickers come from the provider's confirmed candles, avoiding stale or reused symbols in the stock-list feed. The status banner reports the active collection target and the reviewed exclusions separately.

For a ticker reassigned to another issuer, use the successor's identity and effective date when repairing historical rows, retain a verified database backup, and pause the old listing. Do not substitute the acquirer's prices for an acquired security. Current KIS master files are the authority for provider symbol syntax and supported venue codes; some TXSE listings use the provider's `AMS` code.
