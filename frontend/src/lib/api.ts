import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Stock {
  id: number;
  symbol: string;
  name: string;
  market: string;
  exchange?: string;
  sector?: string;
  industry?: string;

  // 기본 가격 정보
  current_price?: number;
  previous_close?: number;
  change_amount?: number;
  change_percent?: number;

  // 기업 정보
  face_value?: number;
  market_cap?: number;
  shares_outstanding?: number;
  foreign_ratio?: number;
  trading_volume?: number;

  // 재무 지표
  per?: number;
  roe?: number;

  // 순위 정보
  market_cap_rank?: number;

  is_active: boolean;
  created_at: string;
  updated_at: string;

  // 히스토리 데이터 상태
  history_records_count?: number;
  history_latest_date?: string;
  history_oldest_date?: string;
  has_history_data?: boolean;
  ma90_price?: number | null;
  ma90_percentage?: number | null;

  // 이전 버전 호환성을 위한 필드들
  latest_price?: number;
  latest_change?: number;
  latest_change_percent?: number;
  latest_volume?: number;

  // 즐겨찾기 상태
  is_favorite?: boolean;

  // 싫어요 상태
  is_dislike?: boolean;
}

export interface StockListResponse {
  total: number;
  stocks: Stock[];
  page: number;
  page_size: number;
}

export interface StockPrice {
  id: number;
  stock_id: number;
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
  change?: number;
  change_percent?: number;
  created_at: string;
}

export interface CrawlingStatus {
  success: number;
  failed: number;
  total: number;
  message?: string;
}

export const stockApi = {
  getStocks: async (params?: {
    market?: string;
    exchange?: string;
    sector?: string;
    skip?: number;
    limit?: number;
  }): Promise<StockListResponse> => {
    const response = await api.get('/api/stocks', { params });
    return response.data;
  },

  getStock: async (id: number): Promise<Stock> => {
    const response = await api.get(`/api/stocks/${id}`);
    return response.data;
  },

  getStockPrices: async (
    id: number,
    params?: { start_date?: string; end_date?: string }
  ): Promise<StockPrice[]> => {
    const response = await api.get(`/api/stocks/${id}/prices`, { params });
    return response.data;
  },

  crawlStocks: async (market: string = 'ALL'): Promise<CrawlingStatus> => {
    const response = await api.post('/api/crawl/stocks', null, {
      params: { market },
    });
    return response.data;
  },

  getSchedulerStatus: async () => {
    const response = await api.get('/api/scheduler/status');
    return response.data;
  },

  getStockPriceHistory: async (stockId: number, days: number = 30) => {
    const response = await api.get(`/api/stocks/${stockId}/price-history`, {
      params: { days }
    });
    return response.data;
  },

  crawlStockHistory: async (stockId: number, days: number = 100): Promise<CrawlingStatus> => {
    const response = await api.post(`/api/stocks/${stockId}/crawl-history`, null, {
      params: { days }
    });
    return response.data;
  },

  getStockHistoryStatus: async (stockId: number) => {
    const response = await api.get(`/api/stocks/${stockId}/history-status`);
    return response.data;
  },

  deleteStock: async (stockId: number) => {
    const response = await api.delete(`/api/stocks/${stockId}`);
    return response.data;
  },

  // 즐겨찾기 관련 API
  addToFavorites: async (stockId: number) => {
    const response = await api.post(`/api/stocks/${stockId}/favorite`);
    return response.data;
  },

  removeFromFavorites: async (stockId: number) => {
    const response = await api.delete(`/api/stocks/${stockId}/favorite`);
    return response.data;
  },

  getFavorites: async (): Promise<StockListResponse> => {
    const response = await api.get('/api/favorites');
    return response.data;
  },

  // 싫어요 관련 API
  addToDislikes: async (stockId: number) => {
    const response = await api.post(`/api/stocks/${stockId}/dislike`);
    return response.data;
  },

  removeFromDislikes: async (stockId: number) => {
    const response = await api.delete(`/api/stocks/${stockId}/dislike`);
    return response.data;
  },

  getDislikes: async (): Promise<StockListResponse> => {
    const response = await api.get('/api/dislikes');
    return response.data;
  },

};

export default api;