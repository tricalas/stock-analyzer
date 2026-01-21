'use client';

import React, { useState, useMemo } from 'react';
import { Stock } from '@/lib/api';
import StockItem from './StockItem';
import { ChevronUp, ChevronDown } from 'lucide-react';

type SortField = 'market_cap_rank' | 'name' | 'current_price' | 'change_amount' | 'change_percent' | 'market_cap' | 'trading_volume' | 'foreign_ratio' | 'per' | 'roe' | 'exchange' | 'history_records_count' | 'ma90_percentage' | 'is_favorite' | 'is_dislike';
type SortDirection = 'asc' | 'desc';

interface StockTableProps {
  stocks: Stock[];
  onStockClick?: (stock: Stock) => void;
  onShowChart?: (stock: Stock) => void;
  onStockDeleted?: (stockId: number) => void;
  onFavoriteChanged?: (stockId: number, isFavorite: boolean) => void;
  onDislikeChanged?: (stockId: number, isDislike: boolean) => void;
}

const StockTable = React.memo<StockTableProps>(({ stocks, onStockClick, onShowChart, onStockDeleted, onFavoriteChanged, onDislikeChanged }) => {
  const [sortField, setSortField] = useState<SortField>('market_cap');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedStocks = useMemo(() => {
    const sorted = [...stocks].sort((a, b) => {
      let aValue = a[sortField] || (a as any)[`latest_${sortField.replace('current_price', 'price').replace('change_amount', 'change').replace('trading_volume', 'volume')}`] || 0;
      let bValue = b[sortField] || (b as any)[`latest_${sortField.replace('current_price', 'price').replace('change_amount', 'change').replace('trading_volume', 'volume')}`] || 0;

      // 문자열 필드 처리
      if (sortField === 'name' || sortField === 'exchange') {
        aValue = String(aValue || '');
        bValue = String(bValue || '');
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // 불린 필드 처리 (즐겨찾기, 싫어요)
      if (sortField === 'is_favorite' || sortField === 'is_dislike') {
        aValue = Boolean(aValue);
        bValue = Boolean(bValue);
        return sortDirection === 'asc'
          ? (aValue === bValue ? 0 : aValue ? 1 : -1)
          : (aValue === bValue ? 0 : aValue ? -1 : 1);
      }

      // 숫자 필드 처리
      aValue = Number(aValue) || 0;
      bValue = Number(bValue) || 0;

      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    });

    return sorted;
  }, [stocks, sortField, sortDirection]);

  const SortableHeader = ({ field, children, align = 'left' }: {
    field: SortField;
    children: React.ReactNode;
    align?: 'left' | 'center' | 'right';
  }) => {
    const isActive = sortField === field;
    const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';

    return (
      <th
        className={`px-3 py-3 ${alignClass} text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors`}
        onClick={() => handleSort(field)}
      >
        <div className={`flex items-center ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'} space-x-1`}>
          <span>{children}</span>
          <div className="flex flex-col">
            <ChevronUp className={`h-3 w-3 ${isActive && sortDirection === 'asc' ? 'text-blue-600' : 'text-gray-300'}`} />
            <ChevronDown className={`h-3 w-3 -mt-1 ${isActive && sortDirection === 'desc' ? 'text-blue-600' : 'text-gray-300'}`} />
          </div>
        </div>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <SortableHeader field="market_cap_rank" align="center">순위</SortableHeader>
            <SortableHeader field="is_favorite" align="center">⭐</SortableHeader>
            <SortableHeader field="name" align="left">종목명</SortableHeader>
            <SortableHeader field="current_price" align="right">현재가</SortableHeader>
            <SortableHeader field="change_amount" align="right">전일비</SortableHeader>
            <SortableHeader field="change_percent" align="right">등락률</SortableHeader>
            <SortableHeader field="market_cap" align="right">시가총액</SortableHeader>
            <SortableHeader field="trading_volume" align="right">거래량</SortableHeader>
            <SortableHeader field="foreign_ratio" align="right">외국인비율</SortableHeader>
            <SortableHeader field="per" align="right">PER</SortableHeader>
            <SortableHeader field="roe" align="right">ROE</SortableHeader>
            <SortableHeader field="ma90_percentage" align="right">90일선</SortableHeader>
            <SortableHeader field="exchange" align="center">거래소</SortableHeader>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sortedStocks.map((stock, index) => (
            <StockItem
              key={stock.id}
              stock={stock}
              rank={index + 1}
              onStockClick={onStockClick}
              onShowChart={onShowChart}
              onStockDeleted={onStockDeleted}
              onFavoriteChanged={onFavoriteChanged}
              onDislikeChanged={onDislikeChanged}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

StockTable.displayName = 'StockTable';

export default StockTable;