'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import AppLayout from '@/components/AppLayout';
import { TrendingUp, Star } from 'lucide-react';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { getNaverChartUrl } from '@/lib/naverStock';
import { Toaster } from '@/components/ui/sonner';

export default function Favorites() {
  const queryClient = useQueryClient();
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stocks', 'FAVORITES'],
    queryFn: () => stockApi.getFavorites(),
  });

  const handleStockClick = (stock: Stock) => {
    window.open(getNaverChartUrl(stock), '_blank');
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

  const stocks = data?.stocks || [];

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-yellow-500" />
          <h2 className="text-lg font-bold">관심 종목</h2>
        </div>

        {/* Content */}
        <div className="bg-card rounded-xl overflow-hidden border border-border">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent"></div>
              <p className="mt-4 text-sm text-muted-foreground">로딩 중...</p>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 mb-4">
                <TrendingUp className="w-6 h-6 text-destructive" />
              </div>
              <p className="text-destructive font-medium">로드 실패</p>
              <p className="text-sm text-muted-foreground mt-1">잠시 후 다시 시도해주세요</p>
            </div>
          ) : stocks.length > 0 ? (
            <StockTable
              stocks={stocks}
              onStockClick={handleStockClick}
              onShowChart={handleShowChart}
              onStockDeleted={handleStockDeleted}
              onFavoriteChanged={handleFavoriteChanged}
              onDislikeChanged={handleDislikeChanged}
            />
          ) : (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
                <Star className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="font-medium">관심 종목이 없습니다</p>
              <p className="text-sm text-muted-foreground mt-1">종목에서 별 아이콘을 눌러 추가하세요</p>
            </div>
          )}
        </div>
      </div>

      <ScrollToTopButton />

      <StockChartModal
        stock={selectedStock}
        isOpen={isChartModalOpen}
        onClose={handleCloseChart}
      />

      <Toaster position="top-center" />
    </AppLayout>
  );
}
