import type { Freshness } from './freshness';
export type SignalCategory = 'ma' | 'trendline';
export interface FeedFilters { category: SignalCategory; strategy: string; returnFilter: string; search: string; days: number; sort: string }
export interface FeedSignal {
  id: number; stock_id: number; symbol: string; name: string; market: string; exchange?: string | null;
  signal_type: string; signal_date: string; signal_price: number; strategy_name: string; ma_period: number;
  current_price: number | null; return_percent: number | null; analyzed_at: string; price_as_of: string;
  freshness: Freshness; details?: string | Record<string, unknown> | null;
}
export interface SignalFeed {
  total: number; signals: FeedSignal[]; analyzed_at: string | null; excluded_stale: number;
  expected_sessions: Record<string, string>; next_skip: number | null; category: SignalCategory; days: number;
  stats: { total_signals: number; stock_count: number; positive_returns: number; negative_returns: number;
    flat_returns: number; unknown_returns: number; avg_return: number | null };
}
export const strategies: Record<SignalCategory, Record<string, string>> = {
  ma: { golden_cross: '골든크로스', death_cross: '데드크로스', ma_support: '지지', ma_resistance: '저항',
    ma_breakout_up: '상향돌파', ma_breakout_down: '하향돌파', ma_bullish_alignment: '정배열 전환', ma_bearish_alignment: '역배열 전환' },
  trendline: { descending_trendline_breakout: '추세선 돌파', approaching_breakout: '돌파 접근', pullback_buy: '돌파 후 되돌림', doji_star: '도지 패턴' },
};
export function signalFeedPath(filters: FeedFilters, skip = 0) {
  const params = new URLSearchParams({ skip: String(skip), limit: '30', days: String(filters.days), sort: filters.sort,
    return_filter: filters.returnFilter, search: filters.search.trim() });
  if (filters.strategy !== 'all') params.set('strategy', filters.strategy);
  return `/api/signals${filters.category === 'ma' ? '/ma' : ''}?${params}`;
}
export function signalLabel(signal: Pick<FeedSignal, 'strategy_name' | 'ma_period'>) {
  const label = strategies.ma[signal.strategy_name] || strategies.trendline[signal.strategy_name] || signal.strategy_name;
  if (signal.strategy_name === 'golden_cross' || signal.strategy_name === 'death_cross') return `MA20/60 ${label}`;
  if (signal.strategy_name.includes('alignment')) return `MA20·60·90 ${label}`;
  return signal.ma_period > 0 ? `MA${signal.ma_period} ${label}` : label;
}
export function ma90Distance(details: FeedSignal['details']): number | null {
  try {
    const value = typeof details === 'string' ? JSON.parse(details) : details;
    const ratio = value?.sma_90_ratio;
    return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio - 100 : null;
  } catch { return null; }
}
