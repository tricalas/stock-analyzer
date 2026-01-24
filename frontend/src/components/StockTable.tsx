'use client';

import React, { useState, useMemo } from 'react';
import { Stock } from '@/lib/api';
import StockItem from './StockItem';
import { ChevronUp, ChevronDown } from 'lucide-react';

type SortField = 'market_cap_rank' | 'name' | 'current_price' | 'change_amount' | 'change_percent' | 'market_cap' | 'trading_volume' | 'exchange' | 'history_records_count' | 'ma90_percentage' | 'is_favorite' | 'is_dislike';
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
        className={`px-3 py-3 ${alignClass} text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50 transition-all duration-200 ${isActive ? 'text-primary' : ''}`}
        onClick={() => handleSort(field)}
      >
        <div className={`flex items-center ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'} space-x-1`}>
          <span>{children}</span>
          <div className="flex flex-col">
            <ChevronUp className={`h-3 w-3 transition-colors ${isActive && sortDirection === 'asc' ? 'text-primary' : 'text-muted-foreground/30'}`} />
            <ChevronDown className={`h-3 w-3 -mt-1 transition-colors ${isActive && sortDirection === 'desc' ? 'text-primary' : 'text-muted-foreground/30'}`} />
          </div>
        </div>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/30 backdrop-blur-sm">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50 transition-all duration-200">
              <div className="flex items-center justify-start space-x-1">
                <span>종목명</span>
              </div>
            </th>
            <SortableHeader field="change_amount" align="right">전일비</SortableHeader>
            <SortableHeader field="change_percent" align="right">등락률</SortableHeader>
            <SortableHeader field="market_cap" align="right">시총</SortableHeader>
            <SortableHeader field="exchange" align="center">거래소</SortableHeader>
            <th className="px-3 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">태그</th>
          </tr>
        </thead>
        <tbody className="bg-card divide-y divide-border/50">
          {sortedStocks.map((stock) => (
            <StockItem
              key={stock.id}
              stock={stock}
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