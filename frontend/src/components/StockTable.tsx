'use client';

import React from 'react';
import { Stock } from '@/lib/api';
import StockItem from './StockItem';

interface StockTableProps {
  stocks: Stock[];
  onStockClick?: (stock: Stock) => void;
  onShowChart?: (stock: Stock) => void;
  onStockDeleted?: (stockId: number) => void;
  onFavoriteChanged?: (stockId: number, isFavorite: boolean) => void;
  onDislikeChanged?: (stockId: number, isDislike: boolean) => void;
}

const StockTable = React.memo<StockTableProps>(({ stocks, onStockClick, onShowChart, onStockDeleted, onFavoriteChanged, onDislikeChanged }) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/30 backdrop-blur-sm">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              종목명
            </th>
            <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              전일비
            </th>
            <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              등락률
            </th>
            <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              90일선
            </th>
            <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              시총
            </th>
            <th className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              거래소
            </th>
            <th className="px-3 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
              태그
            </th>
            <th className="w-10 px-2 py-3">
              {/* 삭제 버튼 컬럼 (헤더 비움) */}
            </th>
          </tr>
        </thead>
        <tbody className="bg-card divide-y divide-border/50">
          {stocks.map((stock) => (
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
