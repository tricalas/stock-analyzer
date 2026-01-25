'use client';

import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { TrendingUp, TrendingDown, Activity, Clock, Star, ChevronDown } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { getNaverChartUrl, getNaverInfoUrl, openNaverChartPopup } from '@/lib/naverStock';
import { stockApi } from '@/lib/api';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';

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

  // 무한 스크롤로 시그널 조회
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
      if (loadedCount < lastPage.total) {
        return loadedCount;
      }
      return undefined;
    },
    initialPageParam: 0,
    refetchInterval: 60000, // 1분마다 자동 갱신
  });

  // Infinite scroll with IntersectionObserver
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

  // 모든 페이지의 시그널을 하나의 배열로 합치기
  const allSignals = data?.pages.flatMap(page => page.signals) || [];
  const stats = data?.pages[0]?.stats;
  const analyzedAt = data?.pages[0]?.analyzed_at;
  const total = data?.pages[0]?.total || 0;

  const formatPrice = (price: number, market: string) => {
    if (market === 'KR') {
      return `${price.toLocaleString()}원`;
    }
    return `$${price.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 필터링된 시그널
  const filteredSignals = allSignals.filter(signal => {
    // 시그널 타입 필터
    if (signalFilter !== 'all') {
      if (signalFilter === 'breakout' && signal.strategy_name !== 'trendline_breakout') return false;
      if (signalFilter === 'approaching' && signal.strategy_name !== 'approaching_breakout') return false;
      if (signalFilter === 'pullback' && signal.strategy_name !== 'pullback_buy') return false;
    }
    // 수익률 필터
    if (returnFilter !== 'all') {
      if (returnFilter === 'positive' && (signal.return_percent ?? 0) < 0) return false;
      if (returnFilter === 'negative' && (signal.return_percent ?? 0) >= 0) return false;
    }
    return true;
  });

  return (
    <AppLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* Controls - Sticky Header */}
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-8 px-4 lg:px-8 py-4 bg-background/95 backdrop-blur-sm border-b border-border mb-6">
          <div className="flex items-center justify-between gap-4">
            {/* 필터 드롭다운 */}
            <div className="flex items-center gap-2">
              {/* 시그널 타입 필터 */}
              <div className="relative">
                <select
                  value={signalFilter}
                  onChange={(e) => setSignalFilter(e.target.value as SignalFilter)}
                  className="appearance-none bg-muted hover:bg-muted/80 border border-border rounded-lg px-3 py-2 pr-8 text-sm font-medium text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">전체 시그널</option>
                  <option value="breakout">돌파</option>
                  <option value="approaching">임박</option>
                  <option value="pullback">되돌림</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>

              {/* 수익률 필터 */}
              <div className="relative">
                <select
                  value={returnFilter}
                  onChange={(e) => setReturnFilter(e.target.value as ReturnFilter)}
                  className="appearance-none bg-muted hover:bg-muted/80 border border-border rounded-lg px-3 py-2 pr-8 text-sm font-medium text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">전체 수익</option>
                  <option value="positive">수익 중</option>
                  <option value="negative">손실 중</option>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* 통계 정보 (우측) */}
            <div className="flex items-center gap-4">
              {stats && (
                <div className="hidden md:flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">총</span>
                    <span className="font-medium text-foreground">{stats.total_signals || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-green-500" />
                    <span className="font-medium text-green-600 dark:text-green-400">{stats.positive_returns || 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingDown className="h-4 w-4 text-red-500" />
                    <span className="font-medium text-red-600 dark:text-red-400">{stats.negative_returns || 0}</span>
                  </div>
                </div>
              )}
              {analyzedAt && (
                <div className="text-sm text-muted-foreground">
                  <Clock className="inline h-3.5 w-3.5 mr-1" />
                  {formatDateTime(analyzedAt)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Loading (initial) */}
        {isLoading && (
          <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
            <div className="flex flex-col items-center justify-center py-24">
              <div className="relative">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 border border-primary/20"></div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground font-medium">Loading signals...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
                <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-destructive font-semibold text-lg">Failed to load signals</p>
              <p className="text-sm text-muted-foreground mt-2">Please try again later</p>
            </div>
          </div>
        )}

        {/* Signal Table */}
        {filteredSignals.length > 0 ? (
          <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">시그널일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">종목</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">시그널이</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">90일선</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">현재가</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">수익률</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">거래소</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">관심</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredSignals.map((signal) => {
                    const stockInfo = signal.stock ? {
                      symbol: signal.stock.symbol,
                      market: signal.stock.market,
                      exchange: signal.stock.exchange
                    } : null;

                    return (
                      <tr
                        key={signal.id}
                        className="hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => {
                          if (stockInfo) {
                            openNaverChartPopup(stockInfo);
                          }
                        }}
                      >
                        {/* 시그널일 */}
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-sm text-foreground">
                              {formatDate(signal.signal_date)}
                            </span>
                            {/* 시그널 타입 배지 */}
                            {(() => {
                              if (signal.strategy_name === 'approaching_breakout') {
                                return (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">
                                    임박
                                  </span>
                                );
                              }
                              if (signal.strategy_name === 'pullback_buy') {
                                return (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-600 dark:text-purple-400">
                                    되돌림
                                  </span>
                                );
                              }
                              return (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-600 dark:text-green-400">
                                  돌파
                                </span>
                              );
                            })()}
                          </div>
                        </td>

                        {/* 종목명 */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div>
                              <a
                                href={stockInfo ? getNaverInfoUrl(stockInfo) : '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-bold text-foreground hover:text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {signal.stock?.name || '종목명 없음'}
                              </a>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                {signal.stock?.symbol || 'N/A'}
                                <a
                                  href={stockInfo ? getNaverChartUrl(stockInfo) : '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  차트
                                </a>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 시그널이 */}
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <span className="text-sm font-mono text-foreground">
                            {formatPrice(signal.signal_price, signal.stock?.market || 'KR')}
                          </span>
                        </td>

                        {/* 90일선 대비 */}
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          {(() => {
                            try {
                              const details = signal.details ? JSON.parse(signal.details) : null;
                              const ratio = details?.sma_90_ratio;
                              if (ratio) {
                                const diff = ratio - 100;
                                return (
                                  <span className={`text-sm font-medium ${
                                    diff >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                                  }`}>
                                    {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                                  </span>
                                );
                              }
                              return <span className="text-sm text-muted-foreground">-</span>;
                            } catch {
                              return <span className="text-sm text-muted-foreground">-</span>;
                            }
                          })()}
                        </td>

                        {/* 현재가 */}
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <span className="text-sm font-mono text-foreground">
                            {signal.current_price ? formatPrice(signal.current_price, signal.stock?.market || 'KR') : '-'}
                          </span>
                        </td>

                        {/* 수익률 */}
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          {signal.return_percent !== undefined && signal.return_percent !== null ? (
                            <span className={`inline-flex items-center gap-1 text-sm font-bold ${
                              signal.return_percent >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}>
                              {signal.return_percent >= 0 ? (
                                <TrendingUp className="h-3.5 w-3.5" />
                              ) : (
                                <TrendingDown className="h-3.5 w-3.5" />
                              )}
                              {signal.return_percent >= 0 ? '+' : ''}{signal.return_percent.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </td>

                        {/* 거래소 */}
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            signal.stock?.exchange === 'KOSPI'
                              ? 'bg-primary/10 text-primary'
                              : signal.stock?.exchange === 'KOSDAQ'
                              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                              : signal.stock?.market === 'US'
                              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {signal.stock?.exchange || signal.stock?.market || 'N/A'}
                          </span>
                        </td>

                        {/* 관심종목 추가 */}
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (signal.stock_id) {
                                stockApi.addToFavorites(signal.stock_id)
                                  .then(() => {
                                    toast.success('관심종목 추가', {
                                      description: `${signal.stock?.name || '종목'}이(가) 관심종목에 추가되었습니다`,
                                    });
                                  })
                                  .catch(() => {
                                    toast.error('추가 실패', {
                                      description: '이미 관심종목이거나 로그인이 필요합니다',
                                    });
                                  });
                              }
                            }}
                            className="p-1.5 rounded-lg hover:bg-yellow-500/20 transition-colors group"
                            title="관심종목 추가"
                          >
                            <Star className="h-4 w-4 text-muted-foreground group-hover:text-yellow-500 group-hover:fill-yellow-500" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Load More Trigger & Loading indicator */}
            <div ref={loadMoreRef} className="py-4 text-center">
              {isFetchingNextPage ? (
                <div className="inline-flex items-center gap-2 text-muted-foreground">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                  <span>Loading more...</span>
                </div>
              ) : hasNextPage ? (
                <span className="text-muted-foreground text-sm">
                  스크롤하여 더 보기 ({allSignals.length} / {total})
                </span>
              ) : (
                <span className="text-muted-foreground text-sm">
                  {signalFilter !== 'all' || returnFilter !== 'all'
                    ? `필터 결과: ${filteredSignals.length}개`
                    : `All signals loaded (${total})`}
                </span>
              )}
            </div>
          </div>
        ) : (
          !isLoading && !error && (
            <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
              <div className="text-center py-24">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                  <TrendingUp className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-foreground font-semibold text-lg">
                  {signalFilter !== 'all' || returnFilter !== 'all'
                    ? '필터 조건에 맞는 시그널이 없습니다'
                    : '매수 시그널이 없습니다'}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  {signalFilter !== 'all' || returnFilter !== 'all'
                    ? '다른 필터 조건을 선택해보세요'
                    : '설정 > 시그널 분석에서 분석을 실행하세요'}
                </p>
              </div>
            </div>
          )
        )}
      </div>

      {/* 위로가기 버튼 */}
      <ScrollToTopButton />

      <Toaster position="top-center" richColors />
    </AppLayout>
  );
}
