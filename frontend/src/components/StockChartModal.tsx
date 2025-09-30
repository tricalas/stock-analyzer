'use client';

import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Calendar } from 'lucide-react';
// import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Stock, stockApi } from '@/lib/api';

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
            displayDate: new Date(item.date).toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            }),
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
    return price.toLocaleString() + '원';
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
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      ></div>

      {/* 모달 컨텐츠 */}
      <div className="relative bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto transform transition-all">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <TrendingUp className="h-6 w-6 text-blue-600" />
              <div>
                <h3 className="text-lg font-medium text-gray-900">
                  {stock.name} ({stock.symbol})
                </h3>
                <p className="text-sm text-gray-500">가격 역사</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="bg-white rounded-md text-gray-400 hover:text-gray-600 focus:outline-none p-2 hover:bg-gray-100 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4">

            {/* Period Selector */}
            <div className="flex items-center space-x-2 mb-4">
              <Calendar className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-600">기간:</span>
              {[7, 14, 30, 60, 90].map(period => (
                <button
                  key={period}
                  onClick={() => setDays(period)}
                  className={`px-3 py-1 text-xs rounded-full transition-colors ${
                    days === period
                      ? 'bg-blue-100 text-blue-800 font-medium'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-2 text-gray-600">데이터 로딩 중...</span>
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-red-600 mb-2">{error}</p>
                <button
                  onClick={fetchTableData}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  다시 시도
                </button>
              </div>
            ) : tableData.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">가격 데이터가 없습니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">날짜</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">시가</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">고가</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">저가</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">종가</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">전일비</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">등락률</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">거래량</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {tableData.map((row, index) => (
                      <tr key={row.date} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                          {row.displayDate}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right whitespace-nowrap">
                          {formatPrice(row.open_price)}
                        </td>
                        <td className="px-4 py-3 text-sm text-red-600 text-right whitespace-nowrap font-medium">
                          {formatPrice(row.high_price)}
                        </td>
                        <td className="px-4 py-3 text-sm text-blue-600 text-right whitespace-nowrap font-medium">
                          {formatPrice(row.low_price)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right whitespace-nowrap font-semibold">
                          {formatPrice(row.close_price)}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right whitespace-nowrap font-medium ${
                          row.change > 0 ? 'text-red-600' : row.change < 0 ? 'text-blue-600' : 'text-gray-500'
                        }`}>
                          {row.change > 0 ? '+' : ''}{formatPrice(Math.abs(row.change))}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right whitespace-nowrap font-medium ${
                          row.changePercent > 0 ? 'text-red-600' : row.changePercent < 0 ? 'text-blue-600' : 'text-gray-500'
                        }`}>
                          {row.changePercent > 0 ? '+' : ''}{row.changePercent.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right whitespace-nowrap">
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
            <div className={`grid ${tableData.length >= 90 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'} gap-4 bg-gray-50 p-4 rounded-lg`}>
              <div className="text-center">
                <p className="text-xs text-gray-500">최고가</p>
                <p className="text-sm font-medium">
                  {formatPrice(Math.max(...tableData.map(d => d.high_price)))}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">최저가</p>
                <p className="text-sm font-medium">
                  {formatPrice(Math.min(...tableData.map(d => d.low_price)))}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">데이터 기간</p>
                <p className="text-sm font-medium">{tableData.length}일</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">최신 종가</p>
                <p className="text-sm font-medium">
                  {tableData.length > 0 && formatPrice(tableData[0].close_price)}
                </p>
              </div>
              {tableData.length >= 90 && (
                <div className="text-center">
                  <p className="text-xs text-gray-500">90일 이평선</p>
                  <p className="text-sm font-medium text-blue-600">
                    {formatPrice(calculate90DayMA(tableData)!)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 flex justify-end">
          <button
            type="button"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
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