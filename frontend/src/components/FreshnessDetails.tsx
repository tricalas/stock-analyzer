'use client';
import { Freshness, freshnessLabel, sessionLabel } from '@/lib/freshness';
import { useTimezone } from '@/hooks/useTimezone';
export default function FreshnessDetails({ value }: { value?: Freshness | null }) {
  const { formatShortDateTime } = useTimezone();
  const timestamp = (v?: string | null) => v ? formatShortDateTime(v) : '미확인';
  const good = value?.history_status === 'current' && value.trend_current && value.ma_current;
  return <details className="text-[11px] mt-1 max-w-full" onClick={e=>e.stopPropagation()}>
    <summary className={`cursor-pointer select-none ${good ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
      {freshnessLabel(value)} · 일봉 {sessionLabel(value?.history_session)}
    </summary>
    <dl className="mt-2 rounded-md border bg-muted/30 p-2 space-y-1 text-muted-foreground whitespace-normal min-w-48">
      <div>기준 거래일: {value?.expected_session || '미확인'}</div>
      <div>현재가 수집: {timestamp(value?.quote_collected_at)}</div>
      <div>확정 일봉: {value?.history_session || '미확인'} · 수집 {timestamp(value?.history_collected_at)}</div>
      <div>추세 분석: {value?.trend_session || '미확인'} · {timestamp(value?.trend_analyzed_at)}</div>
      <div>MA 분석: {value?.ma_status==='insufficient_history' ? '90거래일 미만 · ' : ''}{value?.ma_session || '미확인'} · {timestamp(value?.ma_analyzed_at)}</div>
      <div>{value?.automatic_collection ? '미국 장 마감 후 자동 수집' : '자동 수집 대상 아님'}</div>
      <div>원본 일봉 기준 · 수집 시각은 실시간 시세를 보장하지 않습니다.</div>
    </dl>
  </details>;
}
