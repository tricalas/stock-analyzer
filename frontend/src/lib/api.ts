import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to all requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle 401 errors (unauthorized)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

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

  // 태그 목록
  tags?: Tag[];

  // 최신 태그 활동 날짜
  latest_tag_date?: string;
}

export interface Tag {
  id: number;
  name: string;
  display_name: string;
  color?: string;
  icon?: string;
  order?: number;
  is_active?: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockListResponse {
  total: number;
  total_in_db?: number;  // DB 전체 종목 수
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
    order_by?: string;
    order_dir?: string;
  }): Promise<StockListResponse> => {
    const response = await api.get('/api/stocks', { params });
    return response.data;
  },

  searchStocks: async (params: {
    q: string;
    market?: string;
    limit?: number;
  }): Promise<StockListResponse> => {
    const response = await api.get('/api/stocks/search', { params });
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

  // 단일 종목 히스토리 동기화 (하이브리드 전략)
  syncStockHistory: async (stockId: number, days: number = 100): Promise<{
    success: boolean;
    mode: 'skip' | 'incremental' | 'full';
    message: string;
    stock_id: number;
    symbol: string;
    name: string;
    records_count: number;
    last_date: string | null;
    records_added: number;
  }> => {
    const response = await api.post(`/api/stocks/${stockId}/sync-history`, null, {
      params: { days }
    });
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

  // 단일 종목 분석
  analyzeStock: async (stockId: number) => {
    const response = await api.post(`/api/stocks/${stockId}/analyze`);
    return response.data;
  },

  // 태그 관련 API
  getTags: async (): Promise<{ tags: Tag[] }> => {
    const response = await api.get('/api/tags');
    return response.data;
  },

  createTag: async (tag: Partial<Tag>): Promise<Tag> => {
    const response = await api.post('/api/tags', tag);
    return response.data;
  },

  updateTag: async (tagId: number, tag: Partial<Tag>): Promise<Tag> => {
    const response = await api.put(`/api/tags/${tagId}`, tag);
    return response.data;
  },

  deleteTag: async (tagId: number) => {
    const response = await api.delete(`/api/tags/${tagId}`);
    return response.data;
  },

  addTagToStock: async (stockId: number, tagId: number) => {
    const response = await api.post(`/api/stocks/${stockId}/tags/${tagId}`);
    return response.data;
  },

  removeTagFromStock: async (stockId: number, tagId: number) => {
    const response = await api.delete(`/api/stocks/${stockId}/tags/${tagId}`);
    return response.data;
  },

  getStocksByTag: async (tagName: string, params?: {
    skip?: number;
    limit?: number;
  }): Promise<StockListResponse> => {
    const response = await api.get(`/api/stocks/by-tag/${tagName}`, { params });
    return response.data;
  },

  // 시그널 관련 API
  getStockSignals: async (stockId: number, days: number = 120) => {
    const response = await api.get(`/api/stocks/${stockId}/signals`, { params: { days } });
    return response.data;
  },

  scanAllSignals: async (params?: {
    days?: number;
    mode?: 'tagged' | 'all' | 'top';
    limit?: number;
  }) => {
    const response = await api.get('/api/signals/scan', { params });
    return response.data;
  },

};

// 유저 관리 API
export const userApi = {
  getAllUsers: async () => {
    const response = await api.get('/api/auth/users');
    return response.data;
  },

  createUser: async (nickname: string, pin: string) => {
    const response = await api.post('/api/auth/register', { nickname, pin });
    return response.data;
  },

  deleteUser: async (userId: number) => {
    const response = await api.delete(`/api/auth/users/${userId}`);
    return response.data;
  },
};

export default api;