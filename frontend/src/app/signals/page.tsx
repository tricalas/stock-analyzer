'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { TrendingUp, TrendingDown, Calendar, DollarSign, Activity, RefreshCw } from 'lucide-react';
import { Toaster, toast } from 'sonner';

interface Stock {
  id: number;
  symbol: string;
  name: string;
  market: string;
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

interface TaskProgress {
  task_id: string;
  task_type: string;
  status: string;
  total_items: number;
  current_item: number;
  current_stock_name?: string;
  success_count: number;
  failed_count: number;
  message?: string;
  error_message?: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
}

export default function SignalsPage() {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  // 저장된 신호 조회 (빠름)
  const { data, isLoading, error } = useQuery<SignalListResponse>({
    queryKey: ['stored-signals'],
    queryFn: async () => {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/signals?limit=100`);
      if (!response.ok) throw new Error('Failed to fetch signals');
      return response.json();
    },
    refetchInterval: 30000, // 30초마다 자동 갱신
  });

  // 작업 진행 상황 조회
  const { data: progressData } = useQuery<TaskProgress>({
    queryKey: ['task-progress', currentTaskId],
    queryFn: async () => {
      if (!currentTaskId) return null;
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tasks/${currentTaskId}`);
      if (!response.ok) throw new Error('Failed to fetch task progress');
      return response.json();
    },
    enabled: !!currentTaskId && showProgress,
    refetchInterval: (query) => {
      // 작업이 완료되면 폴링 중지
      const data = query.state.data;
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      return 2000; // 2초마다 갱신
    },
  });

  // 진행 상황이 완료되면 신호 목록 갱신
  useEffect(() => {
    if (progressData?.status === 'completed') {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['stored-signals'] });
        setShowProgress(false);
        setCurrentTaskId(null);
        setIsRefreshing(false);
        toast.success('신호 분석 완료', {
          description: progressData.message || '최신 매매 신호를 확인하세요',
        });
      }, 1000);
    } else if (progressData?.status === 'failed') {
      setShowProgress(false);
      setCurrentTaskId(null);
      setIsRefreshing(false);
      toast.error('분석 실패', {
        description: progressData.error_message || '잠시 후 다시 시도해주세요',
      });
    }
  }, [progressData?.status, progressData?.message, queryClient]);

  // 재분석 뮤테이션
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/signals/refresh?mode=top&limit=500&days=120`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error('Failed to refresh signals');
      return response.json();
    },
    onSuccess: (data) => {
      toast.success('신호 재분석을 시작했습니다', {
        description: '실시간으로 진행 상황을 확인할 수 있습니다',
      });

      // task_id로 진행 상황 추적 시작
      if (data.task_id) {
        setCurrentTaskId(data.task_id);
        setShowProgress(true);
        setIsRefreshing(true);
      }
    },
    onError: () => {
      toast.error('재분석 실패', {
        description: '잠시 후 다시 시도해주세요',
      });
      setIsRefreshing(false);
    },
  });

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
            <p className="text-muted-foreground mt-2">
              추세선 돌파 + 되돌림 전략으로 발견된 매수 신호
            </p>
          </div>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isRefreshing}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${(refreshMutation.isPending || isRefreshing) ? 'animate-spin' : ''}`} />
            {refreshMutation.isPending || isRefreshing ? '분석 중...' : '재분석'}
          </button>
        </div>

        {/* Progress Display */}
        {showProgress && progressData && (
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-6">
            <div className="space-y-4">
              {/* Progress Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 text-primary animate-spin" />
                  <div>
                    <h3 className="font-semibold text-foreground">신호 분석 진행 중</h3>
                    <p className="text-sm text-muted-foreground">{progressData.message}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">
                    {progressData.current_item} / {progressData.total_items}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round((progressData.current_item / progressData.total_items) * 100)}% 완료
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className="bg-primary rounded-full h-3 transition-all duration-300 ease-out"
                  style={{
                    width: `${(progressData.current_item / progressData.total_items) * 100}%`,
                  }}
                />
              </div>

              {/* Current Stock */}
              {progressData.current_stock_name && (
                <p className="text-sm text-muted-foreground">
                  현재 분석 중: <span className="font-medium text-foreground">{progressData.current_stock_name}</span>
                </p>
              )}

              {/* Stats */}
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 dark:text-green-400">
                  성공: {progressData.success_count}
                </span>
                {progressData.failed_count > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    실패: {progressData.failed_count}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-sm text-muted-foreground">총 신호</p>
                  <p className="text-2xl font-bold text-foreground">{data.stats?.total_signals || 0}개</p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-sm text-muted-foreground">수익 중</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {data.stats?.positive_returns || 0}개
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
                    {data.stats?.negative_returns || 0}개
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
                    {data.analyzed_at ? formatDateTime(data.analyzed_at) : '분석 대기중'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
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

        {/* Signal Cards */}
        {data && data.signals.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.signals.map((signal) => (
              <div
                key={signal.id}
                className="bg-card border border-border rounded-xl p-6 hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer"
                onClick={() => {
                  if (!signal.stock) return;

                  const width = Math.floor(window.screen.width * 0.7);
                  const height = window.screen.height;
                  const left = Math.floor(window.screen.width * 0.3);
                  const top = 0;

                  const naverSymbol = signal.stock.market === 'US' && signal.stock.symbol.includes('NASDAQ')
                    ? `${signal.stock.symbol}.O`
                    : signal.stock.symbol;

                  const url = signal.stock.market === 'US'
                    ? `https://m.stock.naver.com/fchart/foreign/stock/${naverSymbol}`
                    : `https://m.stock.naver.com/fchart/domestic/stock/${signal.stock.symbol}`;

                  window.open(
                    url,
                    '_blank',
                    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
                  );
                }}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{signal.stock?.name || '종목명 없음'}</h3>
                    <p className="text-sm text-muted-foreground">
                      {signal.stock?.symbol || 'N/A'} • {signal.stock?.market || 'N/A'}
                    </p>
                  </div>
                  <div className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                    {signal.signal_type.toUpperCase()}
                  </div>
                </div>

                {/* Signal Info */}
                <div className="space-y-3">
                  {/* 신호 날짜 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">신호 날짜:</span>
                    <span className="font-medium text-foreground">
                      {formatDate(signal.signal_date)}
                    </span>
                  </div>

                  {/* 신호 가격 */}
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">신호 가격:</span>
                    <span className="font-medium text-foreground">
                      {formatPrice(signal.signal_price, signal.stock?.market || 'KR')}
                    </span>
                  </div>

                  {/* 현재가 */}
                  {signal.current_price && (
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">현재가:</span>
                      <span className="font-medium text-foreground">
                        {formatPrice(signal.current_price, signal.stock?.market || 'KR')}
                      </span>
                    </div>
                  )}

                  {/* 수익률 */}
                  {signal.return_percent !== undefined && signal.return_percent !== null && (
                    <div className="pt-3 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">신호 대비 수익률</span>
                        <div className="flex items-center gap-1">
                          {signal.return_percent >= 0 ? (
                            <>
                              <TrendingUp className="h-4 w-4 text-green-500" />
                              <span className="text-lg font-bold text-green-600 dark:text-green-400">
                                +{signal.return_percent.toFixed(2)}%
                              </span>
                            </>
                          ) : (
                            <>
                              <TrendingDown className="h-4 w-4 text-red-500" />
                              <span className="text-lg font-bold text-red-600 dark:text-red-400">
                                {signal.return_percent.toFixed(2)}%
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          !isLoading && !error && (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <TrendingUp className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-foreground font-semibold text-lg">매수 신호가 없습니다</p>
              <p className="text-sm text-muted-foreground mt-2">
                "재분석" 버튼을 눌러 최신 신호를 분석하세요
              </p>
              <button
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending || isRefreshing}
                className="mt-4 px-6 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${(refreshMutation.isPending || isRefreshing) ? 'animate-spin' : ''}`} />
                {refreshMutation.isPending || isRefreshing ? '분석 중...' : '지금 분석하기'}
              </button>
            </div>
          )
        )}
      </div>

      <Toaster position="top-center" richColors />
    </AppLayout>
  );
}
