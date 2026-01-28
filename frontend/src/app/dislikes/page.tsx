'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import AppLayout from '@/components/AppLayout';
import { TrendingUp } from 'lucide-react';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { Toaster } from '@/components/ui/sonner';

export default function Dislikes() {
  const queryClient = useQueryClient();
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stocks', 'DISLIKES'],
    queryFn: () => stockApi.getDislikes(),
  });

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
    queryClient.invalidateQueries({ queryKey: ['stocks', 'FAVORITES'] });
  };

  const handleDislikeChanged = async (stockId: number, isDislike: boolean) => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks'] });
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground">관심 없음</h2>
        </div>

        {/* Stocks Table */}
        <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
              <p className="mt-4 text-sm text-muted-foreground">종목을 불러오는 중...</p>
            </div>
          ) : error ? (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
                <svg className="w-8 h-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-destructive font-semibold text-lg">불러오기 실패</p>
              <p className="text-sm text-muted-foreground mt-2">잠시 후 다시 시도해주세요</p>
            </div>
          ) : data && data.stocks.length > 0 ? (
            <StockTable
              stocks={data.stocks}
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
              <p className="text-foreground font-semibold text-lg">관심 없는 종목이 없습니다</p>
              <p className="text-sm text-muted-foreground mt-2">피하고 싶은 종목을 표시하세요</p>
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
