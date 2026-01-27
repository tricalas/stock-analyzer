'use client';

import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { TrendingUp, TrendingDown, Activity, Clock, Star, ChevronDown, BarChart3 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { getNaverChartUrl, getNaverInfoUrl, openNaverChartPopup } from '@/lib/naverStock';
import { stockApi } from '@/lib/api';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
  details?: string;
  is_active: boolean;
  analyzed_at: string;
  updated_at: string;
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

type SignalFilter = 'all' | 'breakout' | 'approaching' | 'pullback';
type ReturnFilter = 'all' | 'positive' | 'negative';

const PAGE_SIZE = 30;

export default function SignalsPage() {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [returnFilter, setReturnFilter] = useState<ReturnFilter>('all');
  const { formatShortDate, formatShortDateTime } = useTimezone();

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['stored-signals-infinite'],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/signals?skip=${pageParam}&limit=${PAGE_SIZE}`
      );
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
    if (signalFilter !== 'all') {
      if (signalFilter === 'breakout' && signal.strategy_name !== 'trendline_breakout') return false;
      if (signalFilter === 'approaching' && signal.strategy_name !== 'approaching_breakout') return false;
      if (signalFilter === 'pullback' && signal.strategy_name !== 'pullback_buy') return false;
    }
    if (returnFilter !== 'all') {
      if (returnFilter === 'positive' && (signal.return_percent ?? 0) < 0) return false;
      if (returnFilter === 'negative' && (signal.return_percent ?? 0) >= 0) return false;
    }
    return true;
  });

  const getSignalBadge = (strategyName: string) => {
    if (strategyName === 'approaching_breakout') {
      return <Badge className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30">임박</Badge>;
    }
    if (strategyName === 'pullback_buy') {
      return <Badge className="bg-purple-500/20 text-purple-600 dark:text-purple-400 hover:bg-purple-500/30">되돌림</Badge>;
    }
    return <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 hover:bg-green-500/30">돌파</Badge>;
  };

  const handleAddToFavorites = async (e: React.MouseEvent, signal: StockSignal) => {
    e.stopPropagation();
    if (signal.stock_id) {
      try {
        await stockApi.addToFavorites(signal.stock_id);
        toast.success(`${signal.stock?.name || '종목'} 관심종목 추가`);
      } catch {
        toast.error('추가 실패');
      }
    }
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-4">
        {/* Header */}
        <div className="sticky top-0 lg:top-0 z-20 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 bg-background/95 backdrop-blur-sm border-b">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            {/* Filters */}
            <div className="flex items-center gap-2 flex-1">
              <Select value={signalFilter} onValueChange={(v) => setSignalFilter(v as SignalFilter)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 시그널</SelectItem>
                  <SelectItem value="breakout">돌파</SelectItem>
                  <SelectItem value="approaching">임박</SelectItem>
                  <SelectItem value="pullback">되돌림</SelectItem>
                </SelectContent>
              </Select>

              <Select value={returnFilter} onValueChange={(v) => setReturnFilter(v as ReturnFilter)}>
                <SelectTrigger className="w-[120px]">
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
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="h-4 w-4" />
                  <span>총 {stats.total_signals || 0}</span>
                </div>
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <TrendingUp className="h-4 w-4" />
                  <span>{stats.positive_returns || 0}</span>
                </div>
                <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <TrendingDown className="h-4 w-4" />
                  <span>{stats.negative_returns || 0}</span>
                </div>
                {analyzedAt && (
                  <div className="text-muted-foreground hidden lg:flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatShortDateTime(analyzedAt)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
              <p className="mt-4 text-sm text-muted-foreground">시그널 로딩 중...</p>
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4">
                <TrendingUp className="w-6 h-6 text-destructive" />
              </div>
              <p className="text-destructive font-medium">로드 실패</p>
            </CardContent>
          </Card>
        ) : filteredSignals.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              {/* Desktop Table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="h-12 px-4 text-center text-xs font-medium text-muted-foreground uppercase">시그널일</th>
                      <th className="h-12 px-4 text-left text-xs font-medium text-muted-foreground uppercase">종목</th>
                      <th className="h-12 px-4 text-right text-xs font-medium text-muted-foreground uppercase">시그널가</th>
                      <th className="h-12 px-4 text-right text-xs font-medium text-muted-foreground uppercase">90일선</th>
                      <th className="h-12 px-4 text-right text-xs font-medium text-muted-foreground uppercase">현재가</th>
                      <th className="h-12 px-4 text-right text-xs font-medium text-muted-foreground uppercase">수익률</th>
                      <th className="h-12 px-4 text-center text-xs font-medium text-muted-foreground uppercase">거래소</th>
                      <th className="h-12 px-4 text-center text-xs font-medium text-muted-foreground uppercase">관심</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredSignals.map((signal) => {
                      const stockInfo = signal.stock ? {
                        symbol: signal.stock.symbol,
                        market: signal.stock.market,
                        exchange: signal.stock.exchange
                      } : null;

                      let ma90Diff: number | null = null;
                      try {
                        const details = signal.details ? JSON.parse(signal.details) : null;
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
                              {signal.stock?.name || '종목명 없음'}
                            </a>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                              <span>{signal.stock?.symbol}</span>
                              <Button variant="ghost" size="sm" asChild className="h-5 px-1.5" onClick={(e) => e.stopPropagation()}>
                                <a href={stockInfo ? getNaverChartUrl(stockInfo) : '#'} target="_blank" rel="noopener noreferrer">
                                  차트
                                </a>
                              </Button>
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
                            <Badge variant="secondary">{signal.stock?.exchange || signal.stock?.market}</Badge>
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

              {/* Mobile Card View */}
              <div className="lg:hidden divide-y">
                {filteredSignals.map((signal) => {
                  const stockInfo = signal.stock ? {
                    symbol: signal.stock.symbol,
                    market: signal.stock.market,
                    exchange: signal.stock.exchange
                  } : null;

                  let ma90Diff: number | null = null;
                  try {
                    const details = signal.details ? JSON.parse(signal.details) : null;
                    if (details?.sma_90_ratio) ma90Diff = details.sma_90_ratio - 100;
                  } catch {}

                  return (
                    <div
                      key={signal.id}
                      className="p-4 hover:bg-muted/50 cursor-pointer"
                      onClick={() => stockInfo && openNaverChartPopup(stockInfo)}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <a
                              href={stockInfo ? getNaverInfoUrl(stockInfo) : '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold hover:text-primary truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {signal.stock?.name || '종목명 없음'}
                            </a>
                            {getSignalBadge(signal.strategy_name)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{signal.stock?.symbol}</span>
                            <span>{formatShortDate(signal.signal_date)}</span>
                            <Badge variant="secondary" className="text-[10px] h-5">{signal.stock?.exchange}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          {signal.return_percent != null ? (
                            <div className={cn(
                              "text-lg font-bold",
                              signal.return_percent >= 0 ? "text-green-600" : "text-red-600"
                            )}>
                              {signal.return_percent >= 0 ? '+' : ''}{signal.return_percent.toFixed(1)}%
                            </div>
                          ) : (
                            <div className="text-muted-foreground">-</div>
                          )}
                        </div>
                      </div>

                      {/* Price Info */}
                      <div className="flex items-center gap-4 py-2 px-3 rounded-lg bg-muted/50 mb-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">시그널가</span>
                          <span className="ml-1.5 font-mono">{formatPrice(signal.signal_price)}</span>
                        </div>
                        <span className="text-muted-foreground">→</span>
                        <div>
                          <span className="text-muted-foreground text-xs">현재가</span>
                          <span className="ml-1.5 font-mono">{signal.current_price ? formatPrice(signal.current_price) : '-'}</span>
                        </div>
                        {ma90Diff !== null && (
                          <div className="ml-auto">
                            <span className="text-muted-foreground text-xs">90일선</span>
                            <span className={cn("ml-1.5 font-medium", ma90Diff >= 0 ? "text-green-600" : "text-red-600")}>
                              {ma90Diff >= 0 ? '+' : ''}{ma90Diff.toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" asChild className="flex-1" onClick={(e) => e.stopPropagation()}>
                          <a href={stockInfo ? getNaverChartUrl(stockInfo) : '#'} target="_blank" rel="noopener noreferrer">
                            <BarChart3 className="h-4 w-4 mr-1.5" />
                            차트 보기
                          </a>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={(e) => handleAddToFavorites(e, signal)} className="h-9 w-9 bg-yellow-500/10">
                          <Star className="h-4 w-4 text-yellow-500" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More */}
              <div ref={loadMoreRef} className="py-4 text-center">
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
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
                <TrendingUp className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="font-medium">
                {signalFilter !== 'all' || returnFilter !== 'all' ? '필터 조건에 맞는 시그널이 없습니다' : '시그널이 없습니다'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {signalFilter !== 'all' || returnFilter !== 'all' ? '다른 필터를 선택해보세요' : '설정에서 시그널 분석을 실행하세요'}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <ScrollToTopButton />
      <Toaster position="top-center" richColors />
    </AppLayout>
  );
}
