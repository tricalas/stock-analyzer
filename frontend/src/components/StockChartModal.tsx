'use client';

import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Calendar } from 'lucide-react';
// import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Stock, stockApi } from '@/lib/api';
import { useTimezone } from '@/hooks/useTimezone';

interface StockChartModalProps {
  stock: Stock | null;
  isOpen: boolean;
  onClose: () => void;
}

interface PriceHistoryData {
  id: number;
  stock_id: number;
  date: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  created_at: string;
  updated_at: string;
}

interface TableData {
  date: string;
  displayDate: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  change: number;
  changePercent: number;
}

const StockChartModal: React.FC<StockChartModalProps> = ({ stock, isOpen, onClose }) => {
  const { formatShortDate } = useTimezone();
  const [tableData, setTableData] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (isOpen && stock) {
      fetchTableData();
    }
  }, [isOpen, stock, days]);

  const fetchTableData = async () => {
    if (!stock) return;

    setLoading(true);
    setError(null);

    try {
      const data: PriceHistoryData[] = await stockApi.getStockPriceHistory(stock.id, days);

      const formattedData: TableData[] = data
        .map((item, index, array) => {
          const prevItem = array[index + 1]; // 이전 날짜 데이터 (날짜 순 정렬 후)
          const change = prevItem ? item.close_price - prevItem.close_price : 0;
          const changePercent = prevItem ? ((change / prevItem.close_price) * 100) : 0;

          return {
            date: item.date,
            displayDate: formatShortDate(item.date),
            open_price: item.open_price,
            high_price: item.high_price,
            low_price: item.low_price,
            close_price: item.close_price,
            volume: item.volume,
            change,
            changePercent
          };
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // 최신순 정렬

      setTableData(formattedData);
    } catch (err) {
      console.error('Error fetching table data:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 90일 이동평균 계산
  const calculate90DayMA = (data: TableData[]) => {
    if (data.length < 90) return null;

    // 최신 90일 데이터의 종가 평균 계산
    const recent90Days = data.slice(0, 90);
    const sum = recent90Days.reduce((acc, item) => acc + item.close_price, 0);
    return sum / 90;
  };

  const formatPrice = (price: number) => {
    return '$' + price.toLocaleString();
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1000000) {
      return (volume / 1000000).toFixed(1) + 'M';
    } else if (volume >= 1000) {
      return (volume / 1000).toFixed(1) + 'K';
    }
    return volume.toString();
  };

  if (!isOpen || !stock) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 배경 오버레이 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>

      {/* 모달 컨텐츠 */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto transform transition-all">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 z-10 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {stock.name} ({stock.symbol})
                </h3>
                <p className="text-sm text-muted-foreground">가격 역사</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="bg-muted rounded-lg text-muted-foreground hover:text-foreground focus:outline-none p-2 hover:bg-muted/80 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4">

            {/* Period Selector */}
            <div className="flex items-center space-x-2 mb-4">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground font-medium">기간:</span>
              {[7, 14, 30, 60, 90].map(period => (
                <button
                  key={period}
                  onClick={() => setDays(period)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                    days === period
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {period}일
                </button>
              ))}
            </div>

          {/* Price History Table */}
          <div className="mb-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <span className="ml-2 text-muted-foreground font-medium">데이터 로딩 중...</span>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-destructive mb-2 font-medium">{error}</p>
                <button
                  onClick={fetchTableData}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
                >
                  다시 시도
                </button>
              </div>
            ) : tableData.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">가격 데이터가 없습니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto border border-border rounded-lg">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/30 sticky top-0 backdrop-blur-sm">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">날짜</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">시가</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">고가</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">저가</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">종가</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">전일비</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">등락률</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">거래량</th>
                    </tr>
                  </thead>
                  <tbody className="bg-card divide-y divide-border/50">
                    {tableData.map((row, index) => (
                      <tr key={row.date} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">
                          {row.displayDate}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground text-right whitespace-nowrap font-mono">
                          {formatPrice(row.open_price)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gain text-right whitespace-nowrap font-medium font-mono">
                          {formatPrice(row.high_price)}
                        </td>
                        <td className="px-4 py-3 text-sm text-loss text-right whitespace-nowrap font-medium font-mono">
                          {formatPrice(row.low_price)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground text-right whitespace-nowrap font-semibold font-mono">
                          {formatPrice(row.close_price)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right whitespace-nowrap font-medium font-mono ${
                          row.change > 0 ? 'text-gain' : row.change < 0 ? 'text-loss' : 'text-muted-foreground'
                        }`}>
                          {row.change > 0 ? '+' : ''}{formatPrice(Math.abs(row.change))}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right whitespace-nowrap font-semibold font-mono ${
                          row.changePercent > 0 ? 'text-gain' : row.changePercent < 0 ? 'text-loss' : 'text-muted-foreground'
                        }`}>
                          {row.changePercent > 0 ? '+' : ''}{row.changePercent.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground text-right whitespace-nowrap font-mono">
                          {formatVolume(row.volume)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary Stats */}
          {tableData.length > 0 && (
            <div className={`grid ${tableData.length >= 90 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'} gap-4 bg-muted/30 p-4 rounded-lg border border-border`}>
              <div className="text-center">
                <p className="text-xs text-muted-foreground font-medium">최고가</p>
                <p className="text-sm font-semibold text-gain font-mono mt-1">
                  {formatPrice(Math.max(...tableData.map(d => d.high_price)))}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground font-medium">최저가</p>
                <p className="text-sm font-semibold text-loss font-mono mt-1">
                  {formatPrice(Math.min(...tableData.map(d => d.low_price)))}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground font-medium">데이터 기간</p>
                <p className="text-sm font-semibold text-foreground font-mono mt-1">{tableData.length}일</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground font-medium">최신 종가</p>
                <p className="text-sm font-semibold text-foreground font-mono mt-1">
                  {tableData.length > 0 && formatPrice(tableData[0].close_price)}
                </p>
              </div>
              {tableData.length >= 90 && (
                <div className="text-center">
                  <p className="text-xs text-muted-foreground font-medium">90일 이평선</p>
                  <p className="text-sm font-semibold text-primary font-mono mt-1">
                    {formatPrice(calculate90DayMA(tableData)!)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 flex justify-end backdrop-blur-sm">
          <button
            type="button"
            className="px-6 py-2 text-sm font-semibold text-foreground bg-muted border border-border rounded-lg hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-all"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockChartModal;