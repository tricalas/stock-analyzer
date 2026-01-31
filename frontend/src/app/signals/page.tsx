'use client';

import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { TrendingUp, TrendingDown, Activity, Clock, Star, BarChart3, ChevronRight } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { getNaverChartUrl, getNaverInfoUrl, openNaverChartPopup } from '@/lib/naverStock';
import { stockApi } from '@/lib/api';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface Stock {
  id: number;
  symbol: string;
  name: string;
  market: string;
  exchange?: string;
  current_price?: number;
}

interface StockSignal {
  id: number;
  stock_id: number;
  signal_type: string;
  signal_date: string;
  signal_price: number;
  strategy_name: string;
  current_price?: number;
  return_percent?: number;
  details?: string | Record<string, unknown>;
  is_active: boolean;
  analyzed_at: string;
  updated_at: string;
  // MA API returns flat structure
  symbol?: string;
  name?: string;
  exchange?: string;
  // Trendline API returns nested stock object
  stock?: Stock;
}

interface SignalListResponse {
  total: number;
  signals: StockSignal[];
  analyzed_at?: string;
  stats?: {
    total_signals: number;
    positive_returns: number;
    negative_returns: number;
    avg_return: number;
  };
}

type SignalCategory = 'trendline' | 'ma';
type SignalFilter = 'all' | 'breakout' | 'approaching' | 'pullback' | 'golden_cross' | 'death_cross' | 'ma_support' | 'ma_resistance' | 'ma_breakout_up' | 'ma_breakout_down' | 'ma_bullish_alignment' | 'ma_bearish_alignment';
type ReturnFilter = 'all' | 'positive' | 'negative';

// 전략명 매핑
const TRENDLINE_STRATEGIES = ['descending_trendline_breakout', 'approaching_breakout', 'pullback_buy', 'doji_star'];
const MA_STRATEGIES = ['golden_cross', 'death_cross', 'ma_support', 'ma_resistance', 'ma_breakout_up', 'ma_breakout_down', 'ma_bullish_alignment', 'ma_bearish_alignment'];

const PAGE_SIZE = 30;

export default function SignalsPage() {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [signalCategory, setSignalCategory] = useState<SignalCategory>('ma');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [returnFilter, setReturnFilter] = useState<ReturnFilter>('all');
  const { formatShortDate, formatShortDateTime } = useTimezone();

  // 카테고리 변경 시 필터 초기화
  const handleCategoryChange = (category: SignalCategory) => {
    setSignalCategory(category);
    setSignalFilter('all');
  };

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['stored-signals-infinite', signalCategory],
    queryFn: async ({ pageParam = 0 }) => {
      // MA 카테고리면 /api/signals/ma 사용, 아니면 기존 /api/signals 사용
      const endpoint = signalCategory === 'ma'
        ? `${process.env.NEXT_PUBLIC_API_URL}/api/signals/ma?skip=${pageParam}&limit=${PAGE_SIZE}`
        : `${process.env.NEXT_PUBLIC_API_URL}/api/signals?skip=${pageParam}&limit=${PAGE_SIZE}`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Failed to fetch signals');
      return response.json() as Promise<SignalListResponse>;
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.signals.length, 0);
      return loadedCount < lastPage.total ? loadedCount : undefined;
    },
    initialPageParam: 0,
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allSignals = data?.pages.flatMap(page => page.signals) || [];
  const stats = data?.pages[0]?.stats;
  const analyzedAt = data?.pages[0]?.analyzed_at;
  const total = data?.pages[0]?.total || 0;

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;

  const filteredSignals = allSignals.filter(signal => {
    // 시그널 필터
    if (signalFilter !== 'all') {
      // 기존 추세선 시그널 필터
      if (signalFilter === 'breakout' && signal.strategy_name !== 'descending_trendline_breakout') return false;
      if (signalFilter === 'approaching' && signal.strategy_name !== 'approaching_breakout') return false;
      if (signalFilter === 'pullback' && signal.strategy_name !== 'pullback_buy') return false;
      // MA 시그널 필터
      if (signalFilter === 'golden_cross' && signal.strategy_name !== 'golden_cross') return false;
      if (signalFilter === 'death_cross' && signal.strategy_name !== 'death_cross') return false;
      if (signalFilter === 'ma_support' && signal.strategy_name !== 'ma_support') return false;
      if (signalFilter === 'ma_resistance' && signal.strategy_name !== 'ma_resistance') return false;
      if (signalFilter === 'ma_breakout_up' && signal.strategy_name !== 'ma_breakout_up') return false;
      if (signalFilter === 'ma_breakout_down' && signal.strategy_name !== 'ma_breakout_down') return false;
      if (signalFilter === 'ma_bullish_alignment' && signal.strategy_name !== 'ma_bullish_alignment') return false;
      if (signalFilter === 'ma_bearish_alignment' && signal.strategy_name !== 'ma_bearish_alignment') return false;
    }
    // 수익률 필터
    if (returnFilter !== 'all') {
      if (returnFilter === 'positive' && (signal.return_percent ?? 0) < 0) return false;
      if (returnFilter === 'negative' && (signal.return_percent ?? 0) >= 0) return false;
    }
    return true;
  });

  const getSignalBadge = (strategyName: string) => {
    // 기존 추세선 시그널
    if (strategyName === 'approaching_breakout') {
      return <Badge className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30 text-[10px] px-1.5 h-5">임박</Badge>;
    }
    if (strategyName === 'pullback_buy') {
      return <Badge className="bg-purple-500/20 text-purple-600 dark:text-purple-400 hover:bg-purple-500/30 text-[10px] px-1.5 h-5">되돌림</Badge>;
    }
    if (strategyName === 'descending_trendline_breakout') {
      return <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-500/30 text-[10px] px-1.5 h-5">돌파</Badge>;
    }
    if (strategyName === 'doji_star') {
      return <Badge className="bg-pink-500/20 text-pink-600 dark:text-pink-400 hover:bg-pink-500/30 text-[10px] px-1.5 h-5">도지</Badge>;
    }
    // MA 시그널
    if (strategyName === 'golden_cross') {
      return <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30 text-[10px] px-1.5 h-5">골든</Badge>;
    }
    if (strategyName === 'death_cross') {
      return <Badge className="bg-slate-500/20 text-slate-600 dark:text-slate-400 hover:bg-slate-500/30 text-[10px] px-1.5 h-5">데드</Badge>;
    }
    if (strategyName === 'ma_support') {
      return <Badge className="bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/30 text-[10px] px-1.5 h-5">지지</Badge>;
    }
    if (strategyName === 'ma_resistance') {
      return <Badge className="bg-orange-500/20 text-orange-600 dark:text-orange-400 hover:bg-orange-500/30 text-[10px] px-1.5 h-5">저항</Badge>;
    }
    if (strategyName === 'ma_breakout_up') {
      return <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30 text-[10px] px-1.5 h-5">상향돌파</Badge>;
    }
    if (strategyName === 'ma_breakout_down') {
      return <Badge className="bg-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/30 text-[10px] px-1.5 h-5">하향돌파</Badge>;
    }
    if (strategyName === 'ma_bullish_alignment') {
      return <Badge className="bg-teal-500/20 text-teal-600 dark:text-teal-400 hover:bg-teal-500/30 text-[10px] px-1.5 h-5">정배열</Badge>;
    }
    if (strategyName === 'ma_bearish_alignment') {
      return <Badge className="bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/30 text-[10px] px-1.5 h-5">역배열</Badge>;
    }
    return <Badge className="bg-gray-500/20 text-gray-600 dark:text-gray-400 hover:bg-gray-500/30 text-[10px] px-1.5 h-5">{strategyName}</Badge>;
  };

  const handleAddToFavorites = async (e: React.MouseEvent, signal: StockSignal) => {
    e.stopPropagation();
    if (signal.stock_id) {
      try {
        await stockApi.addToFavorites(signal.stock_id);
        const stockName = signal.name || signal.stock?.name || '종목';
        toast.success(`${stockName} 관심종목 추가`);
      } catch {
        toast.error('추가 실패');
      }
    }
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {/* 카테고리 선택 */}
            <Select value={signalCategory} onValueChange={(v) => handleCategoryChange(v as SignalCategory)}>
              <SelectTrigger className="w-[100px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ma">MA 시그널</SelectItem>
                <SelectItem value="trendline">추세선</SelectItem>
              </SelectContent>
            </Select>

            {/* 시그널 타입 필터 - 카테고리에 따라 다른 옵션 */}
            <Select value={signalFilter} onValueChange={(v) => setSignalFilter(v as SignalFilter)}>
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {signalCategory === 'ma' ? (
                  <>
                    <SelectItem value="golden_cross">골든크로스</SelectItem>
                    <SelectItem value="death_cross">데드크로스</SelectItem>
                    <SelectItem value="ma_support">지지</SelectItem>
                    <SelectItem value="ma_resistance">저항</SelectItem>
                    <SelectItem value="ma_breakout_up">상향돌파</SelectItem>
                    <SelectItem value="ma_breakout_down">하향돌파</SelectItem>
                    <SelectItem value="ma_bullish_alignment">정배열</SelectItem>
                    <SelectItem value="ma_bearish_alignment">역배열</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="breakout">돌파</SelectItem>
                    <SelectItem value="approaching">임박</SelectItem>
                    <SelectItem value="pullback">되돌림</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>

            <Select value={returnFilter} onValueChange={(v) => setReturnFilter(v as ReturnFilter)}>
              <SelectTrigger className="w-[110px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 수익</SelectItem>
                <SelectItem value="positive">수익 중</SelectItem>
                <SelectItem value="negative">손실 중</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stats */}
          {stats && (
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Activity className="h-4 w-4" />
                <span>{stats.total_signals || 0}</span>
              </div>
              <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <TrendingUp className="h-4 w-4" />
                <span>{stats.positive_returns || 0}</span>
              </div>
              <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <TrendingDown className="h-4 w-4" />
                <span>{stats.negative_returns || 0}</span>
              </div>
              {analyzedAt && (
                <div className="text-muted-foreground hidden lg:flex items-center gap-1 text-xs">
                  <Clock className="h-3.5 w-3.5" />
                  {formatShortDateTime(analyzedAt)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
              <p className="mt-4 text-sm text-muted-foreground">시그널 로딩 중...</p>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4">
                <TrendingUp className="w-6 h-6 text-destructive" />
              </div>
              <p className="text-destructive font-medium">로드 실패</p>
            </div>
          ) : filteredSignals.length > 0 ? (
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="h-10 px-4 text-center text-xs font-medium text-muted-foreground uppercase">시그널일</th>
                      <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase">종목</th>
                      <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase">시그널가</th>
                      <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase">90일선</th>
                      <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase">현재가</th>
                      <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase">수익률</th>
                      <th className="h-10 px-4 text-center text-xs font-medium text-muted-foreground uppercase">거래소</th>
                      <th className="h-10 px-4 text-center text-xs font-medium text-muted-foreground uppercase">관심</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredSignals.map((signal) => {
                      // MA API는 flat structure, Trendline API는 nested stock object
                      const stockName = signal.name || signal.stock?.name || '종목명 없음';
                      const stockSymbol = signal.symbol || signal.stock?.symbol || '';
                      const stockExchange = signal.exchange || signal.stock?.exchange || signal.stock?.market || '';

                      const stockInfo = stockSymbol ? {
                        symbol: stockSymbol,
                        market: signal.stock?.market || 'US',
                        exchange: stockExchange
                      } : null;

                      let ma90Diff: number | null = null;
                      try {
                        const details = typeof signal.details === 'string' ? JSON.parse(signal.details) : signal.details;
                        if (details?.sma_90_ratio) ma90Diff = details.sma_90_ratio - 100;
                      } catch {}

                      return (
                        <tr
                          key={signal.id}
                          className="hover:bg-muted/50 cursor-pointer"
                          onClick={() => stockInfo && openNaverChartPopup(stockInfo)}
                        >
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-sm">{formatShortDate(signal.signal_date)}</span>
                              {getSignalBadge(signal.strategy_name)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <a
                              href={stockInfo ? getNaverInfoUrl(stockInfo) : '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold hover:text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {stockName}
                            </a>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                              <span>{stockSymbol}</span>
                              <a
                                href={stockInfo ? getNaverChartUrl(stockInfo) : '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <BarChart3 className="h-3 w-3" />
                                차트
                              </a>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">{formatPrice(signal.signal_price)}</td>
                          <td className="px-4 py-3 text-right">
                            {ma90Diff !== null ? (
                              <span className={cn("text-sm font-medium", ma90Diff >= 0 ? "text-green-600" : "text-red-600")}>
                                {ma90Diff >= 0 ? '+' : ''}{ma90Diff.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {signal.current_price ? formatPrice(signal.current_price) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {signal.return_percent != null ? (
                              <span className={cn(
                                "inline-flex items-center gap-1 text-sm font-bold",
                                signal.return_percent >= 0 ? "text-green-600" : "text-red-600"
                              )}>
                                {signal.return_percent >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                                {signal.return_percent >= 0 ? '+' : ''}{signal.return_percent.toFixed(2)}%
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-xs text-muted-foreground">{stockExchange}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Button variant="ghost" size="icon" onClick={(e) => handleAddToFavorites(e, signal)} className="h-8 w-8">
                              <Star className="h-4 w-4 text-muted-foreground hover:text-yellow-500 hover:fill-yellow-500" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile List View */}
              <div className="lg:hidden divide-y">
                {filteredSignals.map((signal) => {
                  // MA API는 flat structure, Trendline API는 nested stock object
                  const stockName = signal.name || signal.stock?.name || '종목명 없음';
                  const stockSymbol = signal.symbol || signal.stock?.symbol || '';
                  const stockExchange = signal.exchange || signal.stock?.exchange || signal.stock?.market || '';

                  const stockInfo = stockSymbol ? {
                    symbol: stockSymbol,
                    market: signal.stock?.market || 'US',
                    exchange: stockExchange
                  } : null;

                  let ma90Diff: number | null = null;
                  try {
                    const details = typeof signal.details === 'string' ? JSON.parse(signal.details) : signal.details;
                    if (details?.sma_90_ratio) ma90Diff = details.sma_90_ratio - 100;
                  } catch {}

                  return (
                    <div
                      key={signal.id}
                      className="active:bg-muted/50 transition-colors"
                    >
                      {/* Main Row */}
                      <div
                        className="flex items-center gap-3 py-3 px-4"
                        onClick={() => stockInfo && openNaverChartPopup(stockInfo)}
                      >
                        {/* Left: Signal Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold text-[15px] truncate">{stockName}</span>
                            {getSignalBadge(signal.strategy_name)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{stockSymbol}</span>
                            <span className="text-muted-foreground/50">·</span>
                            <span>{stockExchange}</span>
                            <span className="text-muted-foreground/50">·</span>
                            <span>{formatShortDate(signal.signal_date)}</span>
                          </div>
                        </div>

                        {/* Right: Return */}
                        <div className="text-right shrink-0">
                          {signal.return_percent != null ? (
                            <div className={cn(
                              "text-[15px] font-semibold tabular-nums",
                              signal.return_percent >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                            )}>
                              {signal.return_percent >= 0 ? '+' : ''}{signal.return_percent.toFixed(2)}%
                            </div>
                          ) : (
                            <div className="text-muted-foreground">-</div>
                          )}
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {formatPrice(signal.signal_price)} → {signal.current_price ? formatPrice(signal.current_price) : '-'}
                          </div>
                        </div>

                        <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                      </div>

                      {/* Quick Actions Row */}
                      <div className="flex items-center gap-1 px-4 pb-3 overflow-x-auto scrollbar-none">
                        {ma90Diff !== null && (
                          <span className={cn(
                            "shrink-0 text-xs px-2 py-1 rounded-full border",
                            ma90Diff >= 0
                              ? "border-green-500/30 text-green-600 dark:text-green-400"
                              : "border-red-500/30 text-red-600 dark:text-red-400"
                          )}>
                            90일선 {ma90Diff >= 0 ? '+' : ''}{ma90Diff.toFixed(1)}%
                          </span>
                        )}
                        <a
                          href={stockInfo ? getNaverChartUrl(stockInfo) : '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <BarChart3 className="h-3 w-3" />
                          차트
                        </a>
                        <button
                          onClick={(e) => handleAddToFavorites(e, signal)}
                          className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                        >
                          <Star className="h-3 w-3" />
                          관심
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More */}
              <div ref={loadMoreRef} className="py-4 text-center border-t">
                {isFetchingNextPage ? (
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
                    <span className="text-sm">더 불러오는 중...</span>
                  </div>
                ) : hasNextPage ? (
                  <span className="text-muted-foreground text-sm">스크롤하여 더 보기 ({allSignals.length} / {total})</span>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {signalFilter !== 'all' || returnFilter !== 'all'
                      ? `필터 결과: ${filteredSignals.length}개`
                      : `모든 시그널 로드 완료 (${total})`}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
                <TrendingUp className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="font-medium">
                {signalFilter !== 'all' || returnFilter !== 'all' ? '필터 조건에 맞는 시그널이 없습니다' : '시그널이 없습니다'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {signalFilter !== 'all' || returnFilter !== 'all' ? '다른 필터를 선택해보세요' : '설정에서 시그널 분석을 실행하세요'}
              </p>
            </div>
          )}
        </div>
      </div>

      <ScrollToTopButton />
      <Toaster position="top-center" richColors />
    </AppLayout>
  );
}
