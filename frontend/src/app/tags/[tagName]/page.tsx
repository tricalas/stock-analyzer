'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock, Tag } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import AppLayout from '@/components/AppLayout';
import { TrendingUp } from 'lucide-react';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { Toaster } from '@/components/ui/sonner';
import { useTags } from '@/contexts/TagContext';

export default function TagPage() {
  const params = useParams();
  const tagName = params.tagName as string;
  const queryClient = useQueryClient();
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const { tags } = useTags();
  const tagInfo = tags.find(t => t.name === tagName) || null;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stocks', 'TAG', tagName],
    queryFn: () => stockApi.getStocksByTag(tagName),
  });

  const handleStockClick = (stock: Stock) => {
    // 화면 오른쪽 70%에 전체 높이로 새 창 열기
    const width = Math.floor(window.screen.width * 0.7);
    const height = window.screen.height;
    const left = Math.floor(window.screen.width * 0.3);
    const top = 0;

    // NASDAQ 종목은 .O 접미사 추가
    const naverSymbol = stock.exchange === 'NASDAQ' ? `${stock.symbol}.O` : stock.symbol;
    const url = stock.market === 'US'
      ? `https://m.stock.naver.com/fchart/foreign/stock/${naverSymbol}`
      : `https://m.stock.naver.com/fchart/domestic/stock/${stock.symbol}`;

    window.open(
      url,
      '_blank',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  };

  const handleShowChart = (stock: Stock) => {
    setSelectedStock(stock);
    setIsChartModalOpen(true);
  };

  const handleCloseChart = () => {
    setIsChartModalOpen(false);
    setSelectedStock(null);
  };

  const handleStockDeleted = async (stockId: number) => {
    await refetch();
  };

  const handleFavoriteChanged = async (stockId: number, isFavorite: boolean) => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks'] });
  };

  const handleDislikeChanged = async (stockId: number, isDislike: boolean) => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks', 'DISLIKES'] });
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground">
            {tagInfo ? tagInfo.display_name : tagName}
          </h2>
        </div>

        {/* Stocks Table */}
        <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24">
              <div className="relative">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 border border-primary/20"></div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground font-medium">Loading stocks...</p>
            </div>
          ) : error ? (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
                <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-destructive font-semibold text-lg">Failed to load stocks</p>
              <p className="text-sm text-muted-foreground mt-2">Please try again later</p>
            </div>
          ) : data && data.stocks.length > 0 ? (
            <StockTable
              stocks={data.stocks}
              onStockClick={handleStockClick}
              onShowChart={handleShowChart}
              onStockDeleted={handleStockDeleted}
              onFavoriteChanged={handleFavoriteChanged}
              onDislikeChanged={handleDislikeChanged}
            />
          ) : (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <TrendingUp className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-foreground font-semibold text-lg">No stocks with this tag</p>
              <p className="text-sm text-muted-foreground mt-2">Add tags to stocks to see them here</p>
            </div>
          )}
        </div>
      </div>

      {/* 위로가기 버튼 */}
      <ScrollToTopButton />

      {/* 차트 모달 */}
      <StockChartModal
        stock={selectedStock}
        isOpen={isChartModalOpen}
        onClose={handleCloseChart}
      />

      {/* Toaster for notifications */}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            zIndex: 9999,
          },
        }}
      />
    </AppLayout>
  );
}
