'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import MASignalChart from '@/components/MASignalChart';
import { ArrowLeft, TrendingUp, TrendingDown, Activity, ExternalLink, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getNaverChartUrl, getNaverInfoUrl } from '@/lib/naverStock';

interface MAAnalysisResponse {
  stock_id: number;
  symbol: string;
  name: string;
  current_price: number | null;
  ma_values: Record<number, number>;
  alignment: 'bullish' | 'bearish' | 'neutral';
  chart_data: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number;
    ma_20: number | null;
    ma_50: number | null;
    ma_200: number | null;
  }>;
  recent_signals: Array<{
    id: number;
    signal_type: string;
    signal_date: string;
    signal_price: number;
    strategy_name: string;
    return_percent: number | null;
    details: Record<string, unknown>;
  }>;
}

export default function StockMAAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const stockId = Number(params.stockId);

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock-ma-analysis', stockId],
    queryFn: async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/stocks/${stockId}/ma-analysis?days=180`
      );
      if (!response.ok) throw new Error('Failed to fetch MA analysis');
      return response.json() as Promise<MAAnalysisResponse>;
    },
    enabled: !!stockId,
  });

  const formatPrice = (price: number | null) => {
    if (price === null) return '-';
    return `$${price.toLocaleString()}`;
  };

  const getAlignmentBadge = (alignment: string) => {
    if (alignment === 'bullish') {
      return (
        <Badge className="bg-teal-500/20 text-teal-600 dark:text-teal-400">
          정배열 (강세)
        </Badge>
      );
    }
    if (alignment === 'bearish') {
      return (
        <Badge className="bg-red-500/20 text-red-600 dark:text-red-400">
          역배열 (약세)
        </Badge>
      );
    }
    return (
      <Badge className="bg-gray-500/20 text-gray-600 dark:text-gray-400">
        중립
      </Badge>
    );
  };

  const getSignalBadge = (strategyName: string) => {
    const badges: Record<string, { className: string; label: string }> = {
      golden_cross: { className: 'bg-amber-500/20 text-amber-600', label: '골든' },
      death_cross: { className: 'bg-slate-500/20 text-slate-600', label: '데드' },
      ma_support: { className: 'bg-blue-500/20 text-blue-600', label: '지지' },
      ma_resistance: { className: 'bg-orange-500/20 text-orange-600', label: '저항' },
      ma_breakout_up: { className: 'bg-emerald-500/20 text-emerald-600', label: '상향돌파' },
      ma_breakout_down: { className: 'bg-rose-500/20 text-rose-600', label: '하향돌파' },
      ma_bullish_alignment: { className: 'bg-teal-500/20 text-teal-600', label: '정배열' },
      ma_bearish_alignment: { className: 'bg-red-500/20 text-red-600', label: '역배열' },
    };
    const badge = badges[strategyName] || { className: 'bg-gray-500/20 text-gray-600', label: strategyName };
    return <Badge className={badge.className}>{badge.label}</Badge>;
  };

  if (!stockId) {
    return (
      <AppLayout>
        <div className="p-6 text-center text-destructive">잘못된 종목 ID</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          {data && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold truncate">{data.name}</h1>
                <span className="text-muted-foreground">{data.symbol}</span>
                {getAlignmentBadge(data.alignment)}
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{formatPrice(data.current_price)}</span>
                <a
                  href={getNaverInfoUrl({ symbol: data.symbol, market: 'US' })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  네이버
                </a>
                <a
                  href={getNaverChartUrl({ symbol: data.symbol, market: 'US' })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  차트
                </a>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
            <p className="mt-4 text-sm text-muted-foreground">MA 분석 데이터 로딩 중...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4">
              <Activity className="w-6 h-6 text-destructive" />
            </div>
            <p className="text-destructive font-medium">데이터 로드 실패</p>
            <p className="text-sm text-muted-foreground mt-1">
              200일 이상의 가격 히스토리가 필요합니다
            </p>
          </div>
        ) : data ? (
          <>
            {/* MA Values Cards */}
            <div className="grid grid-cols-3 gap-3">
              {[20, 50, 200].map((period) => {
                const maValue = data.ma_values[period];
                const currentPrice = data.current_price;
                const diff = maValue && currentPrice ? ((currentPrice - maValue) / maValue) * 100 : null;

                return (
                  <Card key={period}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-muted-foreground">
                        MA {period}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-lg font-bold font-mono">
                        {formatPrice(maValue ?? null)}
                      </div>
                      {diff !== null && (
                        <div
                          className={cn(
                            'text-xs mt-1',
                            diff >= 0 ? 'text-green-600' : 'text-red-600'
                          )}
                        >
                          {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">가격 차트 (180일)</CardTitle>
              </CardHeader>
              <CardContent>
                <MASignalChart
                  chartData={data.chart_data}
                  signals={data.recent_signals}
                  showMA20={true}
                  showMA50={true}
                  showMA200={true}
                  height={400}
                />
              </CardContent>
            </Card>

            {/* Recent Signals */}
            {data.recent_signals.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">최근 시그널 (30일)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.recent_signals.map((signal) => (
                      <div
                        key={signal.id}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-8 h-8 rounded-full flex items-center justify-center',
                              signal.signal_type === 'buy'
                                ? 'bg-green-500/10'
                                : 'bg-red-500/10'
                            )}
                          >
                            {signal.signal_type === 'buy' ? (
                              <TrendingUp className="h-4 w-4 text-green-600" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-red-600" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              {getSignalBadge(signal.strategy_name)}
                              <span className="text-sm text-muted-foreground">
                                {signal.signal_date}
                              </span>
                            </div>
                            <div className="text-sm font-mono mt-0.5">
                              {formatPrice(signal.signal_price)}
                            </div>
                          </div>
                        </div>
                        {signal.return_percent !== null && (
                          <div
                            className={cn(
                              'text-sm font-bold',
                              signal.return_percent >= 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            )}
                          >
                            {signal.return_percent >= 0 ? '+' : ''}
                            {signal.return_percent.toFixed(2)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
