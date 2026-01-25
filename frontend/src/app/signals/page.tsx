'use client';

import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { TrendingUp, TrendingDown, Activity, Calendar, Loader2, Star, Trash2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { getNaverChartUrl, getNaverInfoUrl, openNaverChartPopup } from '@/lib/naverStock';
import { stockApi } from '@/lib/api';

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

const PAGE_SIZE = 30;

export default function SignalsPage() {
  const queryClient = useQueryClient();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // 무한 스크롤로 신호 조회
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

  // 신호 삭제 뮤테이션
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/signals`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error('Failed to delete signals');
      return response.json();
    },
    onSuccess: (data) => {
      toast.success('신호 삭제 완료', {
        description: data.message || '모든 신호가 삭제되었습니다',
      });
      queryClient.invalidateQueries({ queryKey: ['stored-signals-infinite'] });
    },
    onError: () => {
      toast.error('삭제 실패', {
        description: '잠시 후 다시 시도해주세요',
      });
    },
  });

  // 모든 페이지의 신호를 하나의 배열로 합치기
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

  return (
    <AppLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-primary" />
              매매 신호
            </h1>
            {total > 0 && (
              <p className="text-muted-foreground mt-2">
                <span className="text-foreground font-medium">{total}개</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (confirm('모든 신호를 삭제하시겠습니까?')) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending || total === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              삭제
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-sm text-muted-foreground">총 신호</p>
                  <p className="text-2xl font-bold text-foreground">{stats.total_signals || 0}개</p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-sm text-muted-foreground">수익 중</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {stats.positive_returns || 0}개
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <TrendingDown className="h-8 w-8 text-red-500" />
                <div>
                  <p className="text-sm text-muted-foreground">손실 중</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {stats.negative_returns || 0}개
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <Calendar className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-sm text-muted-foreground">마지막 분석</p>
                  <p className="text-sm font-medium text-foreground">
                    {analyzedAt ? formatDateTime(analyzedAt) : '분석 대기중'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading (initial) */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="relative">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 border border-primary/20"></div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground font-medium">신호 로딩 중...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
              <TrendingDown className="w-8 h-8 text-destructive" />
            </div>
            <p className="text-destructive font-semibold text-lg">신호 조회 실패</p>
            <p className="text-sm text-muted-foreground mt-2">다시 시도해주세요</p>
          </div>
        )}

        {/* Signal Table */}
        {allSignals.length > 0 ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">신호일</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">종목</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">신호가</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">90일선</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">현재가</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">수익률</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">거래소</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">관심</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allSignals.map((signal) => {
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
                        {/* 신호일 */}
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-sm text-foreground">
                              {formatDate(signal.signal_date)}
                            </span>
                            {/* 신호 타입 배지 */}
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

                        {/* 신호가 */}
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
            <div ref={loadMoreRef} className="py-4">
              {isFetchingNextPage ? (
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">더 불러오는 중...</span>
                </div>
              ) : hasNextPage ? (
                <div className="flex items-center justify-center">
                  <span className="text-sm text-muted-foreground">
                    스크롤하여 더 보기 ({allSignals.length} / {total})
                  </span>
                </div>
              ) : allSignals.length > 0 ? (
                <div className="flex items-center justify-center">
                  <span className="text-sm text-muted-foreground">
                    모든 신호를 불러왔습니다 ({total}개)
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          !isLoading && !error && (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <TrendingUp className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-foreground font-semibold text-lg">매수 신호가 없습니다</p>
              <p className="text-sm text-muted-foreground mt-2">
                설정 &gt; 신호 분석에서 분석을 실행하세요
              </p>
            </div>
          )
        )}
      </div>

      <Toaster position="top-center" richColors />
    </AppLayout>
  );
}
