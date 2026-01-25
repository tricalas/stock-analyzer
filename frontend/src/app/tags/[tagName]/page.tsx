'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock, Tag } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import AppLayout from '@/components/AppLayout';
import { TrendingUp } from 'lucide-react';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { getNaverChartUrl } from '@/lib/naverStock';
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
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['stocks', 'TAG', tagName],
    queryFn: ({ pageParam = 0 }) =>
      stockApi.getStocksByTag(tagName, {
        skip: pageParam,
        limit: 20,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const totalLoaded = allPages.reduce((sum, page) => sum + page.stocks.length, 0);
      return totalLoaded < lastPage.total ? totalLoaded : undefined;
    },
    initialPageParam: 0,
  });

  // Infinite scroll observer
  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Flatten all pages into a single stocks array
  const allStocks = data?.pages.flatMap((page) => page.stocks) ?? [];

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
          ) : allStocks.length > 0 ? (
            <>
              <StockTable
                stocks={allStocks}
                onStockClick={handleStockClick}
                onShowChart={handleShowChart}
                onStockDeleted={handleStockDeleted}
                onFavoriteChanged={handleFavoriteChanged}
                onDislikeChanged={handleDislikeChanged}
              />

              {/* Infinite scroll trigger */}
              <div ref={loadMoreRef} className="py-4">
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <p className="ml-3 text-sm text-muted-foreground">Loading more...</p>
                  </div>
                )}
                {!hasNextPage && allStocks.length > 0 && (
                  <p className="text-center text-sm text-muted-foreground">
                    All {allStocks.length} stocks loaded
                  </p>
                )}
              </div>
            </>
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
