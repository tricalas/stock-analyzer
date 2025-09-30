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
cd app
uvicorn main:app --reload --host 0.0.0.0 --port 8000
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