'use client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch, API_BASE_URL } from '@/lib/http';
import Link from 'next/link';
interface Status { market: string; expected_session: string; total: number; current_history: number; current_trend: number; current_ma: number; automatic_collection: boolean; }
export default function DataStatusBanner() {
  const { user } = useAuth();
  const query = useQuery({queryKey:['data-status',user?.id],enabled:!!user,
    queryFn:async()=>{const r=await apiFetch(`${API_BASE_URL}/api/data-status`);if(!r.ok)throw new Error('상태 조회 실패');return r.json() as Promise<{markets:Status[]}>;},refetchInterval:60000});
  if (!user) return null;
  const us=query.data?.markets.find(x=>x.market==='US');
  const kr=query.data?.markets.find(x=>x.market==='KR');
  return <div className="border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground space-y-1" aria-live="polite">
    {query.error ? <p className="text-amber-600">최신 데이터 상태를 확인하지 못했습니다. 이전 화면 값은 최신이 아닐 수 있습니다.</p> : us ?
      <p><strong className="text-foreground">미국 기준 {us.expected_session}</strong> · 확정 일봉 {us.current_history}/{us.total} · 추세 분석 {us.current_trend}/{us.total} · MA 분석 {us.current_ma}/{us.total}
        {us.current_history<us.total && <span className="text-amber-600"> · {us.total-us.current_history}종목 지연·복구 필요</span>}
        {user.is_admin && <Link className="underline ml-2" href="/settings/operations">상태·복구</Link>}</p> : <p>최신 데이터 상태 확인 중…</p>}
    {!!kr?.total && <p>한국 {kr.total}종목 · 자동 수집 대상 아님 · 확정 일봉 {kr.current_history}/{kr.total}</p>}
  </div>;
}
