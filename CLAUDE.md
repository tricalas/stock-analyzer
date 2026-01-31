# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/claude-code) when working with code in this repository.

## Project Overview

Stock Analyzer (오스카투자) is a web application for tracking and analyzing US stock market data. It collects real-time stock information from Naver Finance API and Korea Investment & Securities (KIS) API, providing features like favorites, tags, technical signals, and 90-day moving average analysis.

## Tech Stack

### Backend (Python 3.11+)
- **FastAPI 0.128.0** - Web framework
- **SQLAlchemy 2.0** - ORM with PostgreSQL (production) / SQLite (local)
- **APScheduler** - Background job scheduling
- **Celery + Redis** - Async task processing
- **BeautifulSoup4 / lxml** - Web scraping
- **httpx** - Async HTTP client

### Frontend (Node.js 18+)
- **Next.js 16.1.1** (App Router with Turbopack)
- **React 19.2.3** with TypeScript
- **TailwindCSS 4** - Styling
- **shadcn/ui** - UI components
- **React Query** - Server state management
- **Recharts** - Chart visualization

## Project Structure

```
stock-analyzer/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI app and all routes
│   │   ├── models.py         # SQLAlchemy models
│   │   ├── schemas.py        # Pydantic schemas
│   │   ├── database.py       # Database connection
│   │   ├── config.py         # Environment configuration
│   │   ├── auth.py           # JWT authentication
│   │   ├── scheduler.py      # APScheduler jobs
│   │   ├── tasks.py          # Celery tasks
│   │   ├── signal_analyzer.py # Technical signal analysis
│   │   ├── crawlers/         # Stock data crawlers
│   │   │   ├── naver_us_crawler.py    # Naver Finance US stocks
│   │   │   ├── kis_history_crawler.py # KIS price history
│   │   │   └── crawler_manager.py     # Crawler orchestration
│   │   └── kis/              # Korea Investment & Securities API
│   │       └── kis_client.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/              # Next.js App Router pages
│   │   ├── components/       # React components
│   │   ├── contexts/         # React contexts (Auth, Tag)
│   │   ├── hooks/            # Custom hooks
│   │   └── lib/
│   │       └── api.ts        # Axios API client
│   └── package.json
└── start-local.sh            # Local development startup script
```

## Common Commands

### Backend Development
```bash
# Start backend server (from project root)
cd backend && source venv/bin/activate && python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Or use the startup script
./start-local.sh
```

### Frontend Development
```bash
cd frontend && npm run dev    # Development with Turbopack
cd frontend && npm run build  # Production build
```

### Database
- Local: SQLite at `backend/stock_analyzer.db`
- Production: PostgreSQL (configured via DATABASE_URL)

## Key Models

- **Stock** - Stock information with prices, market cap, technical indicators
- **StockPriceHistory** - Daily OHLCV price data
- **StockTag / StockTagAssignment** - User-defined tags for categorizing stocks
- **StockSignal** - Technical trading signals (buy/sell/hold)
- **User** - User authentication with PIN-based login
- **TaskProgress / HistoryCollectionLog** - Background task tracking

## API Structure

All API routes are defined in `backend/app/main.py`:
- `/stocks/*` - Stock CRUD and listing
- `/tags/*` - Tag management
- `/signals/*` - Trading signal endpoints
- `/crawl/*` - Data collection triggers
- `/auth/*` - Authentication endpoints
- `/users/*` - User management
- `/scheduler/*` - Background job control

## Environment Variables

### Backend (.env)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis for Celery
- `SECRET_KEY` - JWT secret
- `CORS_ORIGINS` - Allowed CORS origins
- `KIS_APP_KEY`, `KIS_APP_SECRET` - Korea Investment API credentials

### Frontend (.env.local)
- `NEXT_PUBLIC_API_URL` - Backend API URL

## Architecture Notes

1. **Price History Collection**: Uses KIS API for US stock daily prices. Optimized with batch processing and delta updates (tracks `history_updated_at` per stock).

2. **Signal Analysis**: Breakout-pullback strategy implemented in `signal_analyzer.py`. Signals are stored with performance tracking.

3. **User System**: Token-based authentication with PIN verification. Each user has their own tags and favorites.

4. **Caching**: API token caching in `ApiTokenCache` table for KIS API access tokens.

## Development Notes

- The codebase uses Korean comments extensively
- Main.py is large (~1500+ lines) - all routes in one file
- Frontend uses Korean UI text throughout
- Stock symbols are US-focused (NASDAQ, NYSE) despite Naver Finance source
