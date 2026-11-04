# Stock Analyzer - Backend

## Setup

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Copy `.env.example` to `.env` and update the configuration:
```bash
cp .env.example .env
```

3. Run the application:
```bash
python -m app.migrate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

- `GET /api/stocks` - List all stocks with filtering
- `GET /api/stocks/{id}` - Get specific stock details
- `GET /api/stocks/{id}/prices` - Get stock price history
- `POST /api/crawl/stocks` - Crawl and update stock list
- `POST /api/crawl/prices` - Update stock prices

## Initial Data Setup

1. Start the backend server
2. In the frontend, click "Fetch Stocks" to populate the stock database
3. Click "Update Prices" to fetch the latest price data

Schema migrations: `python -m app.migrate` (SQLite and PostgreSQL). Production startup: `sh start.sh`; worker: `sh start-worker.sh`.

Tests: `python -B -m unittest discover -s tests -v`. Tests use temporary databases and mock external services.

API routes live in `app/routers/`; authorization dependencies live in `app/auth.py`. Shared-data mutations and task controls require an administrator. Login and timezone discovery are public; data endpoints require a valid bearer token.

Price history recovery: `python -m app.recover_history`. See `../DEPLOYMENT.md` for the rollout sequence.
