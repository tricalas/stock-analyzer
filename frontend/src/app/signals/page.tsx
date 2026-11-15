'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, ArrowUp, BarChart3, RefreshCw, Search, Star } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import FreshnessDetails from '@/components/FreshnessDetails';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTimezone } from '@/hooks/useTimezone';
import { apiFetch, API_BASE_URL } from '@/lib/http';
import { stockApi } from '@/lib/api';
import { getNaverChartUrl } from '@/lib/naverStock';
import { FeedSignal, SignalCategory, SignalFeed, ma90Distance, signalFeedPath, signalLabel, strategies } from '@/lib/signal-feed';
import { cn } from '@/lib/utils';

const fieldClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
function money(value: number | null, market: string) { return value == null ? '—' : market === 'KR' ? `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}` : `$${value.toFixed(2)}`; }
function Change({ value }: { value: number | null }) {
  return value == null ? <span className="text-muted-foreground">미확인</span> : <span className={cn('font-semibold tabular-nums', value > 0 ? 'text-green-600 dark:text-green-400' : value < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
    {value > 0 ? '+' : ''}{value.toFixed(2)}%
  </span>;
}
function SignalType({ signal }: { signal: FeedSignal }) {
  const sell = signal.signal_type === 'sell';
  return <Badge variant="outline" className={cn('text-xs whitespace-normal text-left', sell ? 'border-red-500/30 text-red-600 dark:text-red-400' : 'border-primary/30')}>
    {signalLabel(signal)}
  </Badge>;
}

export default function SignalsPage() {
  const [category, setCategory] = useState<SignalCategory>('ma');
  const [strategy, setStrategy] = useState('all');
  const [returnFilter, setReturnFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [days, setDays] = useState(10);
  const [sort, setSort] = useState('latest');
  const sentinel = useRef<HTMLDivElement>(null);
  const { formatShortDate, formatShortDateTime } = useTimezone();
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer); }, [search]);

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError,
    isRefetchError, isFetching, refetch } = useInfiniteQuery({
    queryKey: ['signal-feed-v2', category, strategy, returnFilter, debouncedSearch, days, sort],
    queryFn: async ({ pageParam = 0, signal }) => {
      const response = await apiFetch(API_BASE_URL + signalFeedPath({ category, strategy, returnFilter, search: debouncedSearch, days, sort }, pageParam), { signal });
      if (!response.ok) throw new Error('시그널을 불러오지 못했습니다.');
      const result = await response.json() as SignalFeed;
      if (result.category !== category || !result.expected_sessions) throw new Error('조회 서버 갱신 중입니다. 잠시 후 다시 시도해주세요.');
      return result;
    },
    getNextPageParam: last => last.next_skip ?? undefined,
    initialPageParam: 0,
    staleTime: 15000,
    refetchInterval: 60000,
  });
  useEffect(() => {
    if (!sentinel.current || !hasNextPage || isFetchNextPageError) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !isFetching) void fetchNextPage();
    }, { rootMargin: '200px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);

  const summary = data?.pages[0];
  // A refresh may overlap a page boundary; never render the same persisted ID twice.
  const signals = [...new Map((data?.pages.flatMap(page => page.signals) || []).map(signal => [signal.id, signal])).values()];
  const stats = summary?.stats;
  const reset = () => { setStrategy('all'); setReturnFilter('all'); setSearch(''); setDebouncedSearch(''); setDays(10); setSort('latest'); };
  const hasFilters = strategy !== 'all' || returnFilter !== 'all' || !!search || days !== 10 || sort !== 'latest';
  async function favorite(signal: FeedSignal) {
    try { await stockApi.addToFavorites(signal.stock_id); toast.success(`${signal.name} 관심종목 추가`); }
    catch { toast.error('관심종목 추가에 실패했습니다.'); }
  }
  const chart = (signal: FeedSignal) => signal.market === 'KR' ? `https://m.stock.naver.com/domestic/stock/${encodeURIComponent(signal.symbol)}/total` : getNaverChartUrl({ symbol: signal.symbol, market: signal.market, exchange: signal.exchange || undefined });
  const actions = (signal: FeedSignal) => <div className="flex items-center justify-end gap-1">
    <Button variant="ghost" size="icon" asChild className="h-8 w-8"><Link href={`/signals/${signal.stock_id}`} aria-label={`${signal.name} 분석 상세`}><Activity className="h-4 w-4"/></Link></Button>
    <Button variant="ghost" size="icon" asChild className="h-8 w-8"><a href={chart(signal)} target="_blank" rel="noopener noreferrer" aria-label={`${signal.name} 외부 차트`}><BarChart3 className="h-4 w-4"/></a></Button>
    <Button variant="ghost" size="icon" onClick={() => void favorite(signal)} className="h-8 w-8" aria-label={`${signal.name} 관심종목 추가`}><Star className="h-4 w-4"/></Button>
  </div>;

  return <AppLayout><div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
    <div className="flex items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold">시그널 탐색</h1><p className="mt-1 text-sm text-muted-foreground">확정 일봉과 최신 분석으로 확인된 신호를 찾아보세요.</p></div>
      <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} aria-label="시그널 새로고침"><RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')}/>새로고침</Button>
    </div>
    <div className="flex gap-2" role="group" aria-label="분석 종류">
      {(['ma','trendline'] as const).map(value => <Button key={value} variant={category === value ? 'default' : 'outline'} aria-pressed={category === value} onClick={() => { setCategory(value); setStrategy('all'); }}>{value === 'ma' ? '이동평균 MA' : '추세선·패턴'}</Button>)}
    </div>
    <section aria-label="신호 필터" className="rounded-xl border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <label className="col-span-2 text-xs text-muted-foreground space-y-1.5"><span>종목 검색</span><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4"/><input className={cn(fieldClass,'pl-9 text-foreground')} aria-label="종목 검색" placeholder="티커 또는 종목명" value={search} onChange={e => setSearch(e.target.value)} maxLength={50}/></div></label>
        <label className="text-xs text-muted-foreground space-y-1.5"><span>전략</span><select aria-label="전략" className={cn(fieldClass,'text-foreground')} value={strategy} onChange={e => setStrategy(e.target.value)}><option value="all">전체 전략</option>{Object.entries(strategies[category]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs text-muted-foreground space-y-1.5"><span>발생 기간</span><select aria-label="발생 기간" className={cn(fieldClass,'text-foreground')} value={days} onChange={e => setDays(Number(e.target.value))}>{[3,10,30].map(value => <option key={value} value={value}>최근 {value}일</option>)}</select></label>
        <label className="text-xs text-muted-foreground space-y-1.5"><span>발생 후 등락</span><select aria-label="발생 후 등락" className={cn(fieldClass,'text-foreground')} value={returnFilter} onChange={e => setReturnFilter(e.target.value)}><option value="all">전체 등락</option><option value="positive">상승 (&gt;0%)</option><option value="negative">하락 (&lt;0%)</option><option value="flat">보합 (=0%)</option><option value="unknown">등락 미확인</option></select></label>
        <label className="text-xs text-muted-foreground space-y-1.5"><span>정렬</span><select aria-label="정렬" className={cn(fieldClass,'text-foreground')} value={sort} onChange={e => setSort(e.target.value)}><option value="latest">최근 발생순</option><option value="return_desc">등락 높은순</option><option value="return_asc">등락 낮은순</option></select></label>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>기준 거래일까지 최근 {days}일 · 주말·공휴일을 포함한 날짜 범위</span><Button variant="ghost" size="sm" disabled={!hasFilters} onClick={reset}>필터 초기화</Button></div>
    </section>
    {summary && <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1" aria-live="polite">
      <p>기준 거래일: 미국 {summary.expected_sessions.US} · 한국 {summary.expected_sessions.KR} · 최신 일봉·{category === 'ma' ? 'MA' : '추세'} 분석 확인</p>
      <p>현재 조건에서 지연·미확인 분석 <strong className="text-foreground">{summary.excluded_stale.toLocaleString()}개</strong> 제외 · 최근 분석 {summary.analyzed_at ? formatShortDateTime(summary.analyzed_at) : '해당 신호 없음'}</p>
    </div>}
    {stats && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="전체 필터 결과 통계">
      <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">조건에 맞는 전체 신호</p><p className="text-xl font-semibold mt-1">{stats.total_signals.toLocaleString()}<span className="text-xs text-muted-foreground ml-2">{stats.stock_count.toLocaleString()}종목</span></p></div>
      <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUp className="h-3 w-3"/>상승 / 하락</p><p className="text-xl font-semibold mt-1"><span className="text-green-600 dark:text-green-400">{stats.positive_returns.toLocaleString()}</span> / <span className="text-red-600 dark:text-red-400">{stats.negative_returns.toLocaleString()}</span></p></div>
      <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">평균 등락률</p><p className="text-xl mt-1"><Change value={stats.avg_return}/></p></div>
      <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDown className="h-3 w-3"/>보합 / 미확인</p><p className="text-xl font-semibold mt-1">{stats.flat_returns.toLocaleString()} / {stats.unknown_returns.toLocaleString()}</p></div>
    </div>}
    <p className="text-xs text-muted-foreground">등락률은 신호일 종가 대비 분석 시점 가격의 변화입니다. 매도 신호도 같은 기준이며, 거래 비용은 별도입니다. <Link href="/backtest" className="underline underline-offset-2 text-foreground">비용을 반영한 백테스트</Link></p>
    {isRefetchError && <p role="alert" className="rounded-md border border-amber-500/30 p-3 text-sm text-amber-600">새로고침에 실패해 이전 조회 결과를 표시합니다. 다시 새로고침해주세요.</p>}
    <section className="rounded-xl border bg-card overflow-hidden" aria-label="시그널 목록" aria-busy={isLoading}>
      {isLoading ? <p className="py-16 text-center text-muted-foreground" role="status">시그널을 불러오는 중입니다…</p> : error && !summary ? <div className="py-16 text-center space-y-3" role="alert"><p>시그널을 불러오지 못했습니다.</p><Button variant="outline" onClick={() => void refetch()}>다시 시도</Button></div> : signals.length === 0 ? <div className="py-16 px-4 text-center space-y-2"><p className="font-medium">현재 조건에 맞는 최신 신호가 없습니다.</p><p className="text-sm text-muted-foreground">기간이나 필터를 바꿔보세요. 지연된 분석 신호는 제외됩니다.</p>{hasFilters && <Button variant="outline" onClick={reset}>필터 초기화</Button>}</div> : <>
        <div className="hidden lg:block overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">필터 조건과 최신성 검증을 통과한 신호</caption><thead className="bg-muted/50 border-b"><tr>{['발생일 / 전략','종목 / 분석 기준','신호일 종가','분석 시점 가격','발생 후 등락','상세·차트·관심'].map(label => <th key={label} className="px-4 py-3 text-left font-medium text-muted-foreground">{label}</th>)}</tr></thead><tbody className="divide-y">{signals.map(signal => <tr key={signal.id} className="hover:bg-muted/30">
          <td className="px-4 py-3 space-y-1"><div>{formatShortDate(signal.signal_date)}</div><SignalType signal={signal}/></td>
          <td className="px-4 py-3"><a className="font-semibold hover:underline" href={chart(signal)} target="_blank" rel="noopener noreferrer">{signal.name}</a><div className="text-xs text-muted-foreground mt-1">{signal.symbol} · {signal.exchange || signal.market}</div><FreshnessDetails value={signal.freshness} category={category}/></td>
          <td className="px-4 py-3 tabular-nums">{money(signal.signal_price, signal.market)}{ma90Distance(signal.details) != null && <div className="text-xs text-muted-foreground mt-1">당시 MA90 대비 <Change value={ma90Distance(signal.details)}/></div>}</td>
          <td className="px-4 py-3 tabular-nums">{money(signal.current_price, signal.market)}<div className="text-xs text-muted-foreground mt-1">{formatShortDateTime(signal.price_as_of)}</div></td>
          <td className="px-4 py-3"><Change value={signal.return_percent}/></td><td className="px-4 py-3">{actions(signal)}</td>
        </tr>)}</tbody></table></div>
        <div className="lg:hidden divide-y">{signals.map(signal => <article key={signal.id} className="p-4 space-y-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><a href={chart(signal)} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{signal.name}</a><p className="text-xs text-muted-foreground mt-1">{signal.symbol} · {signal.exchange || signal.market} · {formatShortDate(signal.signal_date)}</p></div><div className="text-right shrink-0"><Change value={signal.return_percent}/></div></div><SignalType signal={signal}/><div className="text-xs text-muted-foreground">신호일 {money(signal.signal_price, signal.market)} → 분석 시점 {money(signal.current_price, signal.market)}<span className="block mt-1">가격 기준 {formatShortDateTime(signal.price_as_of)}</span></div><FreshnessDetails value={signal.freshness} category={category}/>{actions(signal)}</article>)}</div>
        <div ref={sentinel} className="border-t p-4 text-center space-y-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">{signals.length.toLocaleString()} / {summary?.total.toLocaleString()}개 표시</p>
          {isFetchNextPageError ? <><p role="alert" className="text-sm text-destructive">다음 목록을 불러오지 못했습니다.</p><Button variant="outline" onClick={() => void fetchNextPage()}>다음 목록 다시 시도</Button></> : hasNextPage ? <Button variant="outline" disabled={isFetching} onClick={() => void fetchNextPage()}>{isFetchingNextPage ? '불러오는 중…' : '더 보기'}</Button> : <p className="text-xs text-muted-foreground">조건에 맞는 전체 신호를 확인했습니다.</p>}
        </div>
      </>}
    </section>
    <details className="rounded-lg border p-4 text-sm"><summary className="cursor-pointer font-medium">이 신호는 어떻게 계산하나요?</summary><div className="mt-3 space-y-2 text-muted-foreground">
      {category === 'ma' ? <><p>골든·데드크로스: MA20과 MA60이 교차한 날입니다.</p><p>지지·저항: MA20·60·90의 2% 이내에서 저가·고가가 닿고, 종가와 양봉·음봉 조건을 만족한 날입니다.</p><p>상향·하향돌파: 전일과 당일 종가가 이평선의 반대편으로 이동한 날입니다. 정배열·역배열은 MA20·60·90의 순서가 새로 바뀐 날입니다.</p></> : <><p>추세선: 이후 5개 봉으로 확정한 고점 3개 이상에서 하락선을 계산합니다. 고가가 선을 넘으면 돌파, 선 아래 3% 이내의 양봉이면 접근 신호입니다.</p><p>되돌림: 돌파 당시의 추세선을 유지하며 저가가 선 위 0~3% 범위, 종가가 선 위에 있는 경우입니다.</p><p>도지: 시가 대비 몸통 1% 이내, 위·아래 꼬리와 전일 대비 종가 상승 조건입니다. 추세선 신호에 거래량 확인 조건은 적용하지 않습니다.</p></>}
      <p>기간은 각 시장의 최신 완료 거래일까지 계산합니다. 화면은 60초마다 저장된 분석을 다시 조회합니다.</p>
    </div></details>
  </div><ScrollToTopButton/><Toaster position="top-center" richColors/></AppLayout>;
}
