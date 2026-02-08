'use client';

import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import AppLayout from '@/components/AppLayout';
import { Target } from 'lucide-react';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import { openNaverChartNewTab } from '@/lib/naverStock';
import { Toaster } from '@/components/ui/sonner';

export default function Ma90ScreenerPage() {
  const queryClient = useQueryClient();
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
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
    queryKey: ['stocks', 'MA90_SCREENER'],
    queryFn: ({ pageParam = 0 }) =>
      stockApi.getMa90Stocks({
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

  const allStocks = data?.pages.flatMap((page) => page.stocks) ?? [];
  const totalCount = data?.pages[0]?.total ?? 0;

  const handleStockClick = (stock: Stock) => {
    openNaverChartNewTab(stock);
  };

  const handleShowChart = (stock: Stock) => {
    setSelectedStock(stock);
    setIsChartModalOpen(true);
  };

  const handleCloseChart = () => {
    setIsChartModalOpen(false);
    setSelectedStock(null);
  };

  const handleStockDeleted = async () => {
    await refetch();
  };

  const handleFavoriteChanged = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks'] });
  };

  const handleDislikeChanged = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks', 'DISLIKES'] });
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">90일선 스크리너</h2>
              {!isLoading && totalCount > 0 && (
                <span className="text-sm font-medium text-primary">{totalCount}개</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              현재가가 90일 이동평균선 -5% ~ +5% 범위에 있는 미국 주식
            </p>
          </div>
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
                <Target className="w-6 h-6 text-destructive" />
              </div>
              <p className="text-destructive font-medium">로드 실패</p>
              <p className="text-sm text-muted-foreground mt-1">잠시 후 다시 시도해주세요</p>
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
              <div ref={loadMoreRef} className="py-4 text-center border-t">
                {isFetchingNextPage ? (
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
                    <span className="text-sm">더 불러오는 중...</span>
                  </div>
                ) : !hasNextPage && (
                  <span className="text-sm text-muted-foreground">
                    총 {allStocks.length}개 종목
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
                <Target className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="font-medium">조건에 맞는 종목이 없습니다</p>
              <p className="text-sm text-muted-foreground mt-1">
                90일선 근접(-5%~+5%) 종목이 없습니다
              </p>
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
