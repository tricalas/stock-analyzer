'use client';

import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  PieChart,
  RefreshCw,
} from 'lucide-react';
import {
  PieChart as RechartsPie,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface DashboardResponse {
  total_signals: number;
  signals_by_strategy: Record<string, number>;
  signals_by_type: Record<string, number>;
  positive_count: number;
  negative_count: number;
  avg_return: number;
  recent_signals: Array<{
    id: number;
    symbol: string;
    name: string;
    signal_type: string;
    signal_date: string;
    strategy_name: string;
    return_percent: number | null;
  }>;
}

// 전략명 한글 매핑
const STRATEGY_LABELS: Record<string, string> = {
  descending_trendline_breakout: '추세선 돌파',
  approaching_breakout: '돌파 임박',
  pullback_buy: '되돌림',
  doji_star: '도지스타',
  golden_cross: '골든크로스',
  death_cross: '데드크로스',
  ma_support: 'MA 지지',
  ma_resistance: 'MA 저항',
  ma_breakout_up: 'MA 상향돌파',
  ma_breakout_down: 'MA 하향돌파',
  ma_bullish_alignment: '정배열',
  ma_bearish_alignment: '역배열',
};

// 전략별 색상
const STRATEGY_COLORS: Record<string, string> = {
  descending_trendline_breakout: '#22c55e',
  approaching_breakout: '#eab308',
  pullback_buy: '#a855f7',
  doji_star: '#ec4899',
  golden_cross: '#f59e0b',
  death_cross: '#64748b',
  ma_support: '#3b82f6',
  ma_resistance: '#f97316',
  ma_breakout_up: '#10b981',
  ma_breakout_down: '#f43f5e',
  ma_bullish_alignment: '#14b8a6',
  ma_bearish_alignment: '#ef4444',
};

export default function SignalDashboardPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['signal-dashboard'],
    queryFn: async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/signals/dashboard`
      );
      if (!response.ok) throw new Error('Failed to fetch dashboard');
      return response.json() as Promise<DashboardResponse>;
    },
    refetchInterval: 60000,
  });

  // 파이 차트 데이터
  const pieData = data
    ? Object.entries(data.signals_by_strategy).map(([key, value]) => ({
        name: STRATEGY_LABELS[key] || key,
        value,
        color: STRATEGY_COLORS[key] || '#94a3b8',
      }))
    : [];

  // 바 차트 데이터 (타입별)
  const barData = data
    ? [
        { name: '매수', count: data.signals_by_type.buy || 0, fill: '#22c55e' },
        { name: '매도', count: data.signals_by_type.sell || 0, fill: '#ef4444' },
      ]
    : [];

  const getSignalBadge = (strategyName: string) => {
    const colorClass = {
      golden_cross: 'bg-amber-500/20 text-amber-600',
      death_cross: 'bg-slate-500/20 text-slate-600',
      ma_support: 'bg-blue-500/20 text-blue-600',
      ma_resistance: 'bg-orange-500/20 text-orange-600',
      ma_breakout_up: 'bg-emerald-500/20 text-emerald-600',
      ma_breakout_down: 'bg-rose-500/20 text-rose-600',
      ma_bullish_alignment: 'bg-teal-500/20 text-teal-600',
      ma_bearish_alignment: 'bg-red-500/20 text-red-600',
      descending_trendline_breakout: 'bg-green-500/20 text-green-600',
      approaching_breakout: 'bg-yellow-500/20 text-yellow-600',
      pullback_buy: 'bg-purple-500/20 text-purple-600',
      doji_star: 'bg-pink-500/20 text-pink-600',
    }[strategyName] || 'bg-gray-500/20 text-gray-600';

    return (
      <Badge className={colorClass}>
        {STRATEGY_LABELS[strategyName] || strategyName}
      </Badge>
    );
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PieChart className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">시그널 대시보드</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} />
            새로고침
          </Button>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
            <p className="mt-4 text-sm text-muted-foreground">대시보드 로딩 중...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4">
              <Activity className="w-6 h-6 text-destructive" />
            </div>
            <p className="text-destructive font-medium">데이터 로드 실패</p>
          </div>
        ) : data ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    전체 시그널
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.total_signals}</div>
                  <div className="text-xs text-muted-foreground">최근 10일</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                    수익 시그널
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {data.positive_count}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {data.total_signals > 0
                      ? `${((data.positive_count / data.total_signals) * 100).toFixed(1)}%`
                      : '-'}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-red-600" />
                    손실 시그널
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    {data.negative_count}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {data.total_signals > 0
                      ? `${((data.negative_count / data.total_signals) * 100).toFixed(1)}%`
                      : '-'}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    평균 수익률
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className={cn(
                      'text-2xl font-bold',
                      data.avg_return >= 0 ? 'text-green-600' : 'text-red-600'
                    )}
                  >
                    {data.avg_return >= 0 ? '+' : ''}
                    {data.avg_return.toFixed(2)}%
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Strategy Distribution Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">전략별 분포</CardTitle>
                </CardHeader>
                <CardContent>
                  {pieData.length > 0 ? (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPie>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={2}
                            dataKey="value"
                            nameKey="name"
                            label={({ name, percent }) =>
                              `${name} ${(percent * 100).toFixed(0)}%`
                            }
                            labelLine={false}
                          >
                            {pieData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </RechartsPie>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      데이터 없음
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Buy/Sell Bar Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">매수/매도 분포</CardTitle>
                </CardHeader>
                <CardContent>
                  {barData.length > 0 ? (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={barData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="count" name="시그널 수">
                            {barData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      데이터 없음
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Recent Signals */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">최근 시그널</CardTitle>
                <Link href="/signals">
                  <Button variant="ghost" size="sm">
                    전체보기
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {data.recent_signals.length > 0 ? (
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
                            <div className="font-medium">{signal.name}</div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{signal.symbol}</span>
                              <span>·</span>
                              <span>{signal.signal_date}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {getSignalBadge(signal.strategy_name)}
                          {signal.return_percent !== null && (
                            <span
                              className={cn(
                                'text-sm font-bold tabular-nums',
                                signal.return_percent >= 0
                                  ? 'text-green-600'
                                  : 'text-red-600'
                              )}
                            >
                              {signal.return_percent >= 0 ? '+' : ''}
                              {signal.return_percent.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    최근 시그널이 없습니다
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
