'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

interface ChartDataPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  ma_20: number | null;
  ma_60: number | null;
  ma_90: number | null;
}

interface Signal {
  id: number;
  signal_type: string;
  signal_date: string;
  signal_price: number;
  strategy_name: string;
  return_percent: number | null;
  details: Record<string, unknown>;
}

interface MASignalChartProps {
  chartData: ChartDataPoint[];
  signals?: Signal[];
  showMA20?: boolean;
  showMA60?: boolean;
  showMA90?: boolean;
  height?: number;
}

const COLORS = {
  price: '#3b82f6',      // blue
  ma20: '#f59e0b',       // amber
  ma60: '#10b981',       // emerald
  ma90: '#ef4444',       // red
  buySignal: '#22c55e',  // green
  sellSignal: '#ef4444', // red
};

export default function MASignalChart({
  chartData,
  signals = [],
  showMA20 = true,
  showMA60 = true,
  showMA90 = true,
  height = 400,
}: MASignalChartProps) {
  // 시그널을 날짜별로 매핑
  const signalsByDate = useMemo(() => {
    const map: Record<string, Signal[]> = {};
    signals.forEach((sig) => {
      const dateKey = sig.signal_date.split('T')[0];
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(sig);
    });
    return map;
  }, [signals]);

  // Y축 범위 계산
  const yDomain = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    chartData.forEach((d) => {
      const values = [d.close, d.ma_20, d.ma_60, d.ma_90].filter(
        (v) => v !== null && v !== undefined
      ) as number[];
      values.forEach((v) => {
        if (v < min) min = v;
        if (v > max) max = v;
      });
    });
    const padding = (max - min) * 0.05;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  // 시그널 마커용 데이터 포인트
  const signalMarkers = useMemo(() => {
    return signals.map((sig) => {
      const dateKey = sig.signal_date.split('T')[0];
      const dataPoint = chartData.find((d) => d.date === dateKey);
      return {
        ...sig,
        x: dateKey,
        y: dataPoint?.close ?? sig.signal_price,
      };
    });
  }, [signals, chartData]);

  const formatPrice = (value: number) => {
    if (value >= 1000) return `$${(value / 1).toLocaleString()}`;
    return `$${value.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
    if (!active || !payload || !label) return null;

    const dateSignals = signalsByDate[label] || [];

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
        <div className="font-medium mb-2">{label}</div>
        <div className="space-y-1">
          {payload.map((entry, idx) => (
            <div key={idx} className="flex items-center justify-between gap-4">
              <span style={{ color: entry.color }}>{entry.name}</span>
              <span className="font-mono">{formatPrice(entry.value)}</span>
            </div>
          ))}
        </div>
        {dateSignals.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border">
            {dateSignals.map((sig, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    sig.signal_type === 'buy' ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
                <span className="text-xs">
                  {sig.strategy_name.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={yDomain}
            tickFormatter={formatPrice}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            height={36}
            formatter={(value) => (
              <span className="text-xs text-muted-foreground">{value}</span>
            )}
          />

          {/* 종가 라인 */}
          <Line
            type="monotone"
            dataKey="close"
            name="종가"
            stroke={COLORS.price}
            strokeWidth={2}
            dot={false}
            connectNulls
          />

          {/* MA 라인들 */}
          {showMA20 && (
            <Line
              type="monotone"
              dataKey="ma_20"
              name="MA 20"
              stroke={COLORS.ma20}
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="5 5"
              connectNulls
            />
          )}
          {showMA60 && (
            <Line
              type="monotone"
              dataKey="ma_60"
              name="MA 60"
              stroke={COLORS.ma60}
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="5 5"
              connectNulls
            />
          )}
          {showMA90 && (
            <Line
              type="monotone"
              dataKey="ma_90"
              name="MA 90"
              stroke={COLORS.ma90}
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="5 5"
              connectNulls
            />
          )}

          {/* 시그널 마커 */}
          {signalMarkers.map((marker, idx) => (
            <ReferenceDot
              key={idx}
              x={marker.x}
              y={marker.y}
              r={6}
              fill={marker.signal_type === 'buy' ? COLORS.buySignal : COLORS.sellSignal}
              stroke="white"
              strokeWidth={2}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
