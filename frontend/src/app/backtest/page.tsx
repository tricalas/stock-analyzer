'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { apiFetch, API_BASE_URL } from '@/lib/http';
import { Stock, stockApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import FreshnessDetails from '@/components/FreshnessDetails';
import { ResponsiveContainer,LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid } from 'recharts';
interface Result {
  fee_bps:number;slippage_bps:number;holding_sessions:number;initial_cash:number;
  stock:{symbol:string;name:string};strategy:string;start_date:string;end_date:string;
  return_pct:number;gross_return_pct:number;cost_drag_pct:number;benchmark_return_pct:number;
  max_drawdown_pct:number;trade_count:number;win_rate_pct:number|null;final_equity:number;
  fees_paid:number;slippage_cost:number;data_fetched_at:string;warmup_sessions:number;
  assumptions:string[];equity:{date:string;equity:number}[];
  trades:{signal_date:string;entry_date:string;exit_date:string;entry_price:number;exit_price:number;return_pct:number;exit_reason:string;entry_fee:number;exit_fee:number}[];
}
export default function BacktestPage() {
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<Stock|null>(null);
  const [stockId,setStockId]=useState<number|null>(null);
  const [strategy,setStrategy]=useState('golden_cross');
  const [days,setDays]=useState(180);
  const [holding,setHolding]=useState(10);
  const [ma,setMa]=useState(90);
  const [fee,setFee]=useState('10');
  const [slip,setSlip]=useState('5');
  const [capital,setCapital]=useState('10000');
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{const id=Number(new URLSearchParams(window.location.search).get('stock_id'));if(id>0)setStockId(id);},[]);
  const stockQuery=useQuery({queryKey:['backtest-stock',stockId],enabled:!!stockId,queryFn:()=>stockApi.getStock(stockId!)});
  useEffect(()=>{if(stockQuery.data)setSelected(stockQuery.data);},[stockQuery.data]);
  const choices=useQuery({queryKey:['backtest-search',search],enabled:search.trim().length>=2,queryFn:()=>stockApi.searchStocks({q:search,market:'US',limit:8})});
  const selectClass='w-full h-10 rounded-md border bg-background px-2 text-sm';
  const price=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:n<1?6:2}).format(n);
  const pct=(n:number|null)=>n===null?'해당 없음':`${n.toFixed(2)}%`;
  async function run(e:React.FormEvent) {
    e.preventDefault();if(!selected)return;
    setBusy(true);setError('');setResult(null);
    try {
      const r=await apiFetch(`${API_BASE_URL}/api/backtests`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stock_id:selected.id,strategy,days,holding_sessions:holding,ma_period:ma,fee_bps:Number(fee),slippage_bps:Number(slip),initial_cash:Number(capital)})});
      const body=await r.json();if(!r.ok)throw new Error(typeof body.detail==='string'?body.detail:'입력값을 확인해주세요.');setResult(body);
    } catch(err){setError(err instanceof Error?err.message:'계산 실패');}finally{setBusy(false);}
  }
  return <AppLayout><div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
    <header><h1 className="text-2xl font-semibold">시그널 백테스트</h1><p className="text-sm text-muted-foreground mt-2">수정주가로 과거 신호를 순서대로 계산하고, 다음 거래일 시가에 수수료·슬리피지를 적용합니다.</p></header>
    <form onSubmit={run} className="rounded-xl border p-4 space-y-4">
      <label className="block text-sm font-medium">미국 종목 검색<Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="AAPL, 애플 등 2자 이상"/></label>
      {choices.data && search.length>=2 && <div className="flex flex-wrap gap-2">{choices.data.stocks.map(stock=><Button type="button" variant="outline" key={stock.id} onClick={()=>{setSelected(stock);setSearch('');setResult(null);}}>{stock.symbol} · {stock.name}</Button>)}</div>}
      {selected && <div className="rounded-lg bg-muted/30 p-3"><strong>{selected.symbol} · {selected.name}</strong><FreshnessDetails value={selected.freshness}/><p className="text-xs text-muted-foreground mt-2">아래 검증은 차트 원본과 분리된 KIS 수정주가를 요청합니다.</p></div>}
      {stockQuery.error && <p className="text-sm text-destructive">종목을 불러오지 못했습니다. 검색으로 선택해주세요.</p>}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="text-sm">전략<select className={selectClass} value={strategy} onChange={e=>setStrategy(e.target.value)}><option value="golden_cross">MA20/60 골든크로스</option><option value="ma_breakout_up">이동평균 상향 돌파</option><option value="descending_trendline_breakout">확인된 하락 추세선 돌파</option></select></label>
        <label className="text-sm">평가 기간<select className={selectClass} value={days} onChange={e=>setDays(Number(e.target.value))}><option value={90}>최근 90일</option><option value={180}>최근 180일</option><option value={365}>최근 1년</option><option value={730}>최근 2년</option></select></label>
        <label className="text-sm">보유 거래일<Input type="number" min={1} max={60} value={holding} onChange={e=>setHolding(Number(e.target.value))} required/></label>
        <label className="text-sm">초기 자금 (USD)<Input type="number" min={100} max={1000000000} value={capital} onChange={e=>setCapital(e.target.value)} required/></label>
        <label className="text-sm">편도 수수료 (bp)<Input type="number" min={0} max={500} step="0.1" value={fee} onChange={e=>setFee(e.target.value)} required/></label>
        <label className="text-sm">편도 슬리피지 (bp)<Input type="number" min={0} max={500} step="0.1" value={slip} onChange={e=>setSlip(e.target.value)} required/></label>
        {strategy==='ma_breakout_up' && <label className="text-sm">이동평균<select className={selectClass} value={ma} onChange={e=>setMa(Number(e.target.value))}>{[20,60,90].map(n=><option key={n} value={n}>{n}일</option>)}</select></label>}
      </div>
      <p className="text-xs text-muted-foreground">1bp = 0.01%. 기본값은 계산 예시이며 실제 거래 비용에 맞게 바꿔주세요. 과거 수익률은 향후 성과를 보장하지 않습니다.</p>
      <Button disabled={!selected || busy}>{busy?'수정주가 조회·계산 중…':'백테스트 실행'}</Button>
    </form>
    {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}</div>}
    {result && <section className="space-y-5" aria-live="polite">
      <div><h2 className="text-lg font-semibold">{result.stock.symbol} 검증 결과</h2><p className="text-xs text-muted-foreground mt-1">{result.start_date} ~ {result.end_date} · 준비 데이터 {result.warmup_sessions}거래일 · 수정주가 조회 {new Date(result.data_fetched_at).toLocaleString('ko-KR')}</p><p className="text-xs text-muted-foreground mt-1">실행 조건: {result.strategy} · 수수료 {result.fee_bps}bp · 슬리피지 {result.slippage_bps}bp · 보유 {result.holding_sessions}거래일 · 초기 {price(result.initial_cash)}</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[
        ['비용 차감 수익률',pct(result.return_pct)],['비용 미반영',pct(result.gross_return_pct)],
        ['최대 낙폭',pct(result.max_drawdown_pct)],['매수 후 보유',pct(result.benchmark_return_pct)],
        ['완료 거래',`${result.trade_count}회`],['승률 (비용 차감)',pct(result.win_rate_pct)],
        ['수수료 합계',`$${result.fees_paid.toFixed(2)}`],['슬리피지 추정',`$${result.slippage_cost.toFixed(2)}`],
      ].map(([label,value])=><div key={label} className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">{label}</p><strong className="block mt-2 text-lg">{value}</strong></div>)}</div>
      <div className="rounded-xl border p-4 h-72"><h3 className="text-sm font-medium mb-3">비용 차감 자산 추이 (USD)</h3><ResponsiveContainer width="100%" height="85%"><LineChart data={result.equity}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" tickFormatter={v=>String(v).slice(5)} minTickGap={40}/><YAxis domain={['auto','auto']} tickFormatter={v=>Number(v).toFixed(0)}/><Tooltip/><Line dataKey="equity" name="자산" stroke="#14b8a6" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
      <details className="rounded-xl border p-4" open><summary className="cursor-pointer text-sm font-medium">계산 가정·데이터 범위</summary><ul className="list-disc pl-5 mt-3 space-y-1 text-xs text-muted-foreground">{result.assumptions.map(a=><li key={a}>{a}</li>)}</ul></details>
      <div className="rounded-xl border overflow-x-auto"><table className="w-full text-xs whitespace-nowrap"><caption className="text-left p-4 font-semibold">거래 기록 · 원본 저장 시그널을 재사용하지 않고 당시 데이터로 재계산</caption><thead><tr className="border-b bg-muted/20">{['신호일','진입일','청산일','진입가','청산가','비용 차감 수익률','청산 사유'].map(h=><th className="p-3 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{result.trades.map((t,i)=><tr className="border-b" key={i}><td className="p-3">{t.signal_date}</td><td className="p-3">{t.entry_date}</td><td className="p-3">{t.exit_date}</td><td className="p-3">{price(t.entry_price)}</td><td className="p-3">{price(t.exit_price)}</td><td className="p-3">{pct(t.return_pct)}</td><td className="p-3">{t.exit_reason==='period_end'?'평가 종료':'보유 기간 종료'}</td></tr>)}{!result.trades.length && <tr><td colSpan={7} className="p-5 text-muted-foreground">조건에 맞는 진입 신호가 없어 현금을 유지했습니다.</td></tr>}</tbody></table></div>
    </section>}
  </div></AppLayout>;
}
