import { apiFetch, API_BASE_URL } from './http';

export interface Run {
  id: string; scope: string; stage: string; status: string; session_date: string;
  created_at: string; updated_at: string; error_message?: string;
  progress: { current_item: number; total_items: number; success_count: number; failed_count: number };
}
export interface Incident {
  key: string; severity: string; title: string; detail: string; status: string;
  acknowledged_at: string | null; first_seen_at: string; last_seen_at: string;
}
export interface OperationsOverview {
  session_date: string; monitoring_stale: boolean; unacknowledged_alerts: number; recovery_count: number;
  checks: { name: string; healthy: boolean; checked_at: string; detail: string }[];
  alerts: Incident[]; runs: Run[];
}
export interface Recovery {
  stock_id: number; symbol: string; name: string; reason: string; message: string; notes: string;
  attempts: number; last_seen_at: string; exchange: string;
  provider_symbol: string | null; provider_exchange: string | null;
}
export const reasons: Record<string, string> = {
  provider_unavailable: '공급사 미응답·지원 여부 확인', missing_history: '과거 날짜 누락',
  stale_history: '최근 거래일 누락', temporary_error: '일시적 통신·요청 제한',
  symbol_review: '공급사 코드 확인', collection_error: '수집 오류',
};
export const stages: Record<string, string> = { quotes: '현재가 갱신', history: '가격 수집·MA90 계산', signals: '추세 시그널', ma: '이동평균 시그널', completed: '종료' };
export const statuses: Record<string, string> = { queued: '대기', running: '실행 중', completed: '완료', partial: '일부 실패', failed: '중단', cancelled: '취소' };
export async function operationsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}/api/operations${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
  return response.json();
}
