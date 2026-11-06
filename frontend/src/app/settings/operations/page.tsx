'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Play, Pencil, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { OperationsOverview, Recovery, operationsRequest, reasons, stages, statuses } from '@/lib/operations';

function time(value?: string | null) {
  return value ? new Date(value.endsWith('Z') ? value : value+'Z').toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음';
}

export default function OperationsPage() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Recovery | null>(null);
  const [symbol, setSymbol] = useState('');
  const [exchange, setExchange] = useState('');
  const [notes, setNotes] = useState('');
  const { data, error, isLoading } = useQuery({
    queryKey: ['operations', user?.id], enabled: !!user?.is_admin,
    queryFn: () => operationsRequest<OperationsOverview>('/overview'), refetchInterval: 15000,
  });
  const recovery = useQuery({
    queryKey: ['operations-recovery', user?.id, reason, search, page], enabled: !!user?.is_admin,
    queryFn: () => operationsRequest<{ total: number; items: Recovery[] }>(`/recovery?reason=${encodeURIComponent(reason)}&search=${encodeURIComponent(search)}&skip=${page*50}&limit=50`),
    refetchInterval: 30000,
  });
  const incidents = useQuery({
    queryKey: ['operations-alerts', user?.id], enabled: !!user?.is_admin,
    queryFn: () => operationsRequest<OperationsOverview['alerts']>('/alerts'), refetchInterval: 30000,
  });
  async function action(path: string, body?: object, method = 'POST') {
    setBusy(true);
    try {
      await operationsRequest(path, { method, body: body ? JSON.stringify(body) : undefined });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['operations'] }),
        client.invalidateQueries({ queryKey: ['operations-recovery'] }),
        client.invalidateQueries({ queryKey: ['operations-alerts'] }),
      ]);
      toast.success('요청을 반영했습니다. 진행 상황은 아래에서 확인할 수 있습니다.');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '요청 실패');
      return false;
    } finally { setBusy(false); }
  }
  if (!user?.is_admin) return null;
  if (isLoading) return <p className="p-6 text-muted-foreground">운영 상태를 확인하고 있습니다…</p>;
  if (error || !data) return <div role="alert" className="rounded-xl border border-destructive p-5">운영 서버에 연결할 수 없습니다. 잠시 후 자동으로 다시 확인합니다.</div>;
  const running = data.runs.some(r => r.status === 'running' || r.status === 'queued');
  return <div className="space-y-7 max-w-6xl mx-auto">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold flex items-center gap-2"><Activity className="h-6 w-6"/>운영 상태</h1>
        <p className="text-sm text-muted-foreground mt-2">기준 거래일 {data.session_date} · 한국 시간 표시 · 15초마다 상태 갱신</p></div>
      <Button disabled={busy || running} onClick={() => action('/runs', { scope: 'all' })}><Play className="w-4 h-4 mr-2"/>{running ? '수집·분석 실행 중' : '전체 수집·분석'}</Button>
    </div>
    {data.monitoring_stale && <div role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4"><strong>상태 점검 서버의 응답이 늦습니다.</strong><p className="text-sm mt-1">마지막 점검이 3분을 넘었거나 아직 연결되지 않았습니다. 아래 상태는 최신이 아닐 수 있습니다.</p></div>}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{data.checks.map(check => <div key={check.name} className="rounded-xl border p-4">
      <div className="flex items-center justify-between"><strong>{check.name}</strong>{check.healthy ? <CheckCircle2 className="h-4 w-4 text-green-600"/> : <AlertTriangle className="h-4 w-4 text-destructive"/>}</div>
      <p className="text-sm mt-2">{check.detail}</p><p className="text-xs text-muted-foreground mt-2">{time(check.checked_at)}</p>
    </div>)}</div>
    <section className="space-y-3"><h2 className="text-lg font-semibold">확인할 알림 <span className="text-muted-foreground">{data.alerts.length}</span></h2>
      {!data.alerts.length && <p className="text-sm text-muted-foreground">현재 발생한 장애·데이터 지연 알림이 없습니다.</p>}
      {data.alerts.map(a => <div key={a.key} role="alert" className={`rounded-xl border p-4 ${a.severity === 'critical' ? 'border-destructive/50 bg-destructive/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
        <div className="flex flex-wrap justify-between gap-2"><strong>{a.title}</strong><Button size="sm" variant="outline" disabled={busy || !!a.acknowledged_at} onClick={() => action(`/alerts/${encodeURIComponent(a.key)}/acknowledge`)}>{a.acknowledged_at ? '확인함' : '확인 표시'}</Button></div>
        <p className="text-sm mt-1">{a.detail}</p><p className="text-xs text-muted-foreground mt-2">최초 발생 {time(a.first_seen_at)} · 최근 확인 {time(a.last_seen_at)}</p>
      </div>)}
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">수집·분석 실행 기록</h2>
      <p className="text-xs text-muted-foreground">현재가 → 가격 수집·MA90 → 추세 시그널 → 이동평균 시그널 순서로 실행합니다. 중단된 단계는 이어서 처리합니다.</p>
      {!data.runs.length && <p className="text-sm text-muted-foreground">아직 실행 기록이 없습니다. 장 마감 후 자동 실행되며, 위 버튼으로 직접 시작할 수 있습니다.</p>}
      {data.runs.map(run => <div key={run.id} className="rounded-xl border p-4 space-y-2">
        <div className="flex flex-wrap justify-between gap-2"><strong>{statuses[run.status] || run.status} · {stages[run.stage] || run.stage}</strong><span className="text-xs text-muted-foreground">{time(run.created_at)}</span></div>
        <progress className="w-full h-2 accent-primary" max={run.progress.total_items || 1} value={run.progress.current_item || 0}/>
        <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{run.progress.current_item}/{run.progress.total_items} 단계 · 완료 {run.progress.success_count}종목 · 실패 {run.progress.failed_count}종목</span>
          {(run.status === 'failed' || run.status === 'cancelled') && <Button size="sm" variant="outline" disabled={busy || running} onClick={() => action(`/runs/${run.id}/resume`)}>이어서 실행</Button>}</div>
        {run.error_message && <p className="text-sm text-destructive">{run.error_message}</p>}
      </div>)}
    </section>
    <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">수집 실패 종목 <span className="text-muted-foreground">{recovery.data?.total ?? data.recovery_count}</span></h2>
      <Button variant="outline" disabled={busy || running || !data.recovery_count} onClick={() => action('/runs', { scope: 'retry' })}><RefreshCw className="h-4 w-4 mr-2"/>실패 종목 전체 재시도</Button></div>
      <p className="text-xs text-muted-foreground">원래 종목코드·태그·과거 기록은 보존됩니다. 공급사 코드 변경은 확인된 값으로 수정하고 재수집해주세요.</p>
      <div className="flex flex-wrap gap-2"><Input aria-label="종목 검색" className="max-w-xs" value={search} placeholder="종목코드·이름 검색" onChange={e => {setSearch(e.target.value);setPage(0);}}/>
        <select aria-label="실패 원인" className="rounded-md border bg-background px-3 text-sm h-10 max-w-full" value={reason} onChange={e => {setReason(e.target.value);setPage(0);}}><option value="">모든 원인</option>{Object.entries(reasons).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      {recovery.error && <p role="alert" className="text-sm text-destructive">실패 종목을 불러오지 못했습니다.</p>}
      {recovery.data?.items.map(stock => <div key={stock.stock_id} className="rounded-xl border p-4 space-y-2">
        <div className="flex flex-wrap justify-between gap-3"><div><strong>{stock.symbol}</strong><span className="ml-2 text-sm text-muted-foreground">{stock.name}</span><p className="text-sm mt-1">{reasons[stock.reason] || stock.reason} · 시도 {stock.attempts}회</p></div>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || running} onClick={() => {setEdit(stock);setSymbol(stock.provider_symbol || '');setExchange(stock.provider_exchange || '');setNotes(stock.notes || '');}}><Pencil className="h-3 w-3 mr-1"/>코드·메모</Button>
            <Button size="sm" disabled={busy || running} onClick={() => action('/runs', {scope:'retry',stock_ids:[stock.stock_id]})}>재시도</Button></div></div>
        <p className="text-xs text-muted-foreground break-words">{stock.message}</p>
        {stock.provider_symbol && <p className="text-xs">공급사 코드: {stock.provider_symbol} · {stock.provider_exchange || stock.exchange}</p>}
        {stock.notes && <p className="text-sm">메모: {stock.notes}</p>}
        <p className="text-xs text-muted-foreground">최근 실패 {time(stock.last_seen_at)}</p>
      </div>)}
      {recovery.data?.total === 0 && <p className="text-sm text-muted-foreground">조건에 맞는 실패 종목이 없습니다.</p>}
      {recovery.data && recovery.data.total > 50 && <div className="flex justify-between"><Button variant="outline" disabled={page===0} onClick={() => setPage(p=>p-1)}>이전</Button><span className="text-sm">{page+1} / {Math.ceil(recovery.data.total/50)}</span><Button variant="outline" disabled={(page+1)*50>=recovery.data.total} onClick={() => setPage(p=>p+1)}>다음</Button></div>}
    </section>
    <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-medium">최근 알림 이력</summary><div className="space-y-3 mt-3">{incidents.data?.map(a => <p className="text-sm" key={a.key}><span className={a.status==='resolved' ? 'text-green-600' : 'text-amber-600'}>{a.status==='resolved' ? '해결' : '발생'}</span> · {a.title} · {time(a.last_seen_at)}</p>)}</div></details>
    {edit && <div role="dialog" aria-modal="true" aria-label="공급사 코드·메모 수정" className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><form className="rounded-xl bg-background border p-6 w-full max-w-md space-y-4" onSubmit={async e => {e.preventDefault();if (await action(`/recovery/${edit.stock_id}`,{provider_symbol:symbol.trim().toUpperCase() || null,provider_exchange:exchange || null,notes},'PATCH')) setEdit(null);}}>
      <div className="flex justify-between items-center"><h2 className="font-semibold">{edit.symbol} 공급사 코드·메모</h2><Button type="button" size="icon" variant="ghost" aria-label="닫기" onClick={()=>setEdit(null)}><X className="w-4 h-4"/></Button></div>
      <p className="text-xs text-muted-foreground">코드를 바꾸면 가격 재수집 전까지 분석에서 제외됩니다. 비워두면 원래 종목코드를 사용합니다.</p>
      <label className="block text-sm">공급사 종목코드<Input value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())} placeholder={edit.symbol} maxLength={20}/></label>
      <label className="block text-sm">공급사 거래소<select className="block border rounded-md w-full h-10 bg-background px-2" value={exchange} onChange={e=>setExchange(e.target.value)}><option value="">기존 거래소 사용 ({edit.exchange})</option><option value="NAS">NASDAQ</option><option value="NYS">NYSE</option><option value="AMS">AMEX</option></select></label>
      <label className="block text-sm">확인 내용·메모<textarea className="block border rounded-md w-full p-2 bg-background" rows={3} value={notes} maxLength={1000} onChange={e=>setNotes(e.target.value)}/></label>
      <Button className="w-full" disabled={busy || running}>저장</Button>
    </form></div>}
  </div>;
}
