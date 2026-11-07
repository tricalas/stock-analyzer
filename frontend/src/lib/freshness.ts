export interface Freshness {
  expected_session: string; history_session: string | null; history_collected_at: string | null;
  quote_collected_at: string | null; trend_session: string | null; trend_analyzed_at: string | null;
  ma_session: string | null; ma_analyzed_at: string | null;
  history_status: 'current' | 'stale' | 'repair_required'; trend_current: boolean; ma_current: boolean;
  trend_status?: string; ma_status?: string;
  automatic_collection: boolean; price_basis: string;
}
export function sessionLabel(value?: string | null) { return value ? value.slice(5).replace('-', '/') : '미확인'; }
export function freshnessLabel(value?: Freshness | null) {
  if (!value) return '기준일 미확인';
  if (value.history_status === 'repair_required') return '가격 복구 필요';
  if (value.history_status !== 'current') return '확정 일봉 지연';
  if (value.ma_status==='insufficient_history') return '확정 일봉 최신 · MA 자료 부족';
  if (!value.trend_current || !value.ma_current) return '분석 갱신 필요';
  return '최신 확정·분석';
}
