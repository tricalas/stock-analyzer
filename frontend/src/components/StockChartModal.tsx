'use client';

import React, { useState, useEffect } from 'react';
import { TrendingUp, Calendar, Loader2 } from 'lucide-react';
import { Stock, stockApi } from '@/lib/api';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

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
          const prevItem = array[index + 1];
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
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setTableData(formattedData);
    } catch (err) {
      console.error('Error fetching table data:', err);
      setError('데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const calculate90DayMA = (data: TableData[]) => {
    if (data.length < 90) return null;
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

  if (!stock) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-lg font-semibold">
                {stock.name} ({stock.symbol})
              </div>
              <p className="text-sm text-muted-foreground font-normal">가격 역사</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Period Selector */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground font-medium">기간:</span>
            <div className="flex gap-1">
              {[7, 14, 30, 60, 90].map(period => (
                <Button
                  key={period}
                  variant={days === period ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDays(period)}
                  className="h-7 px-3"
                >
                  {period}일
                </Button>
              ))}
            </div>
          </div>

          {/* Price History Table */}
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground font-medium">데이터 로딩 중...</span>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-destructive mb-4 font-medium">{error}</p>
                <Button onClick={fetchTableData}>
                  다시 시도
                </Button>
              </div>
            ) : tableData.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">가격 데이터가 없습니다.</p>
              </div>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-muted/50 sticky top-0">
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
                    <tbody className="divide-y divide-border/50">
                      {tableData.map((row) => (
                        <tr key={row.date} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3 text-sm whitespace-nowrap">
                            {row.displayDate}
                          </td>
                          <td className="px-4 py-3 text-sm text-right whitespace-nowrap font-mono">
                            {formatPrice(row.open_price)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gain text-right whitespace-nowrap font-medium font-mono">
                            {formatPrice(row.high_price)}
                          </td>
                          <td className="px-4 py-3 text-sm text-loss text-right whitespace-nowrap font-medium font-mono">
                            {formatPrice(row.low_price)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right whitespace-nowrap font-semibold font-mono">
                            {formatPrice(row.close_price)}
                          </td>
                          <td className={cn(
                            "px-4 py-3 text-sm text-right whitespace-nowrap font-medium font-mono",
                            row.change > 0 ? 'text-gain' : row.change < 0 ? 'text-loss' : 'text-muted-foreground'
                          )}>
                            {row.change > 0 ? '+' : ''}{formatPrice(Math.abs(row.change))}
                          </td>
                          <td className={cn(
                            "px-4 py-3 text-sm text-right whitespace-nowrap font-semibold font-mono",
                            row.changePercent > 0 ? 'text-gain' : row.changePercent < 0 ? 'text-loss' : 'text-muted-foreground'
                          )}>
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
              </Card>
            )}
          </div>

          {/* Summary Stats */}
          {tableData.length > 0 && (
            <Card className="p-4">
              <div className={cn(
                "grid gap-4",
                tableData.length >= 90 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'
              )}>
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
                  <p className="text-sm font-semibold font-mono mt-1">{tableData.length}일</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground font-medium">최신 종가</p>
                  <p className="text-sm font-semibold font-mono mt-1">
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
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StockChartModal;
