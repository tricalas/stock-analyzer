'use client';

import React from 'react';
import { Stock } from '@/lib/api';
import StockItem from './StockItem';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface StockTableProps {
  stocks: Stock[];
  onStockClick?: (stock: Stock) => void;
  onShowChart?: (stock: Stock) => void;
  onStockDeleted?: (stockId: number) => void;
  onFavoriteChanged?: (stockId: number, isFavorite: boolean) => void;
  onDislikeChanged?: (stockId: number, isDislike: boolean) => void;
}

const StockTable = React.memo<StockTableProps>(({
  stocks,
  onStockClick,
  onShowChart,
  onStockDeleted,
  onFavoriteChanged,
  onDislikeChanged
}) => {
  return (
    <>
      {/* Desktop Table View */}
      <div className="hidden lg:block">
        <ScrollArea className="w-full">
          <table className="w-full">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="border-b">
                <th className="h-10 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  종목명
                </th>
                <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  전일비
                </th>
                <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  등락률
                </th>
                <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  90일선
                </th>
                <th className="h-10 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  시총
                </th>
                <th className="h-10 px-4 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  거래소
                </th>
                <th className="h-10 px-4 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  태그
                </th>
                <th className="h-10 w-10 px-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stocks.map((stock) => (
                <StockItem
                  key={stock.id}
                  stock={stock}
                  onStockClick={onStockClick}
                  onShowChart={onShowChart}
                  onStockDeleted={onStockDeleted}
                  onFavoriteChanged={onFavoriteChanged}
                  onDislikeChanged={onDislikeChanged}
                  viewMode="table"
                />
              ))}
            </tbody>
          </table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Mobile List View */}
      <div className="lg:hidden divide-y">
        {stocks.map((stock) => (
          <StockItem
            key={stock.id}
            stock={stock}
            onStockClick={onStockClick}
            onShowChart={onShowChart}
            onStockDeleted={onStockDeleted}
            onFavoriteChanged={onFavoriteChanged}
            onDislikeChanged={onDislikeChanged}
            viewMode="card"
          />
        ))}
      </div>
    </>
  );
});

StockTable.displayName = 'StockTable';

export default StockTable;
