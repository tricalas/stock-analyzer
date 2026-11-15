export interface Freshness {
  expected_session: string; history_session: string | null; history_collected_at: string | null;
  quote_collected_at: string | null; trend_session: string | null; trend_analyzed_at: string | null;
  ma_session: string | null; ma_analyzed_at: string | null;
  history_status: 'current' | 'stale' | 'repair_required' | 'reviewed'; trend_current: boolean; ma_current: boolean;
  trend_status?: string; ma_status?: string;
  automatic_collection: boolean; price_basis: string;
}
export function sessionLabel(value?: string | null) { return value ? value.slice(5).replace('-', '/') : '미확인'; }
export function freshnessLabel(value?: Freshness | null, category?: 'ma' | 'trendline') {
  if (!value) return '기준일 미확인';
  if (value.history_status === 'reviewed') return '거래·코드 검토 완료 · 수집 중단';
  if (value.history_status === 'repair_required') return '가격 복구 필요';
  if (value.history_status !== 'current') return '확정 일봉 지연';
  if (category === 'ma') return value.ma_current ? 'MA 분석 최신' : (value.ma_status==='insufficient_history' ? 'MA 자료 부족' : 'MA 분석 갱신 필요');
  if (category === 'trendline') return value.trend_current ? '추세 분석 최신' : (value.trend_status==='insufficient_history' ? '추세 자료 부족' : '추세 분석 갱신 필요');
  if (value.ma_status==='insufficient_history') return '확정 일봉 최신 · MA 자료 부족';
  if (!value.trend_current || !value.ma_current) return '분석 갱신 필요';
  return '최신 확정·분석';
}
