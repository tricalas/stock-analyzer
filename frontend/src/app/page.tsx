'use client';

import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import AppLayout from '@/components/AppLayout';
import SearchBar from '@/components/SearchBar';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { getNaverChartUrl } from '@/lib/naverStock';
import SimpleButton from '@/components/atoms/SimpleButton';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import SortDropdown, { SortField, SortDirection } from '@/components/SortDropdown';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'ALL' | 'US' | 'KR' | 'FAVORITES' | 'DISLIKES'>('US');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('market_cap');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Load last update time from localStorage
  useEffect(() => {
    const savedTime = localStorage.getItem('lastStockUpdate');
    if (savedTime) {
      setLastUpdateTime(savedTime);
    }

    // Listen for storage changes (for multi-tab synchronization)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'lastStockUpdate' && e.newValue) {
        console.log('Storage changed, updating lastUpdateTime to:', e.newValue);
        setLastUpdateTime(e.newValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['stocks', activeTab, sortField, sortDirection],
    queryFn: ({ pageParam = 0 }) => {
      if (activeTab === 'FAVORITES') {
        return stockApi.getFavorites();
      }
      if (activeTab === 'DISLIKES') {
        return stockApi.getDislikes();
      }
      return stockApi.getStocks({
        market: activeTab === 'ALL' ? undefined : activeTab,
        skip: pageParam,
        limit: 20,
        order_by: sortField,
        order_dir: sortDirection,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (activeTab === 'FAVORITES' || activeTab === 'DISLIKES') {
        return undefined; // 즐겨찾기/싫어요는 페이징 안함
      }
      const loadedCount = allPages.reduce((sum, page) => sum + (page.stocks?.length || 0), 0);
      return loadedCount < (lastPage.total || 0) ? loadedCount : undefined;
    },
    initialPageParam: 0,
  });

  // Infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefreshStocks = async () => {
    setIsRefreshing(true);
    toast.info('데이터를 가져오는 중입니다... (약 20초 소요)');
    try {
      console.log('Starting crawl with market:', activeTab);
      const result = await stockApi.crawlStocks(activeTab);
      console.log('Crawl result:', result);

      // 백그라운드 작업이므로 즉시 응답받음
      toast.success('크롤링 작업이 시작되었습니다!', {
        description: '완료까지 약 20초 소요됩니다.'
      });

      // 25초 후 자동으로 데이터 새로고침
      setTimeout(async () => {
        await refetch();

        // 마지막 업데이트 시간 저장
        const now = new Date().toISOString();
        console.log('Updating lastStockUpdate to:', now);
        localStorage.setItem('lastStockUpdate', now);
        setLastUpdateTime(now);

        toast.success('데이터 업데이트 완료!', {
          description: '최신 종목 데이터를 불러왔습니다.'
        });
        console.log('Successfully updated lastUpdateTime');

        setIsRefreshing(false);
      }, 25000); // 25초 후

    } catch (error: any) {
      console.error('Failed to refresh stocks:', error);
      console.error('Error response:', error.response);

      setIsRefreshing(false);

      // 쿨타임 에러 처리
      if (error.response?.status === 429) {
        toast.error('쿨타임 중입니다', {
          description: error.response?.data?.detail || '잠시 후 다시 시도해주세요.'
        });
      } else {
        toast.error('데이터 업데이트 실패', {
          description: error.message || '오류가 발생했습니다.'
        });
      }
    }
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
    // 종목이 삭제되면 데이터를 다시 불러옴
    await refetch();
  };

  const handleFavoriteChanged = async (stockId: number, isFavorite: boolean) => {
    // 즐겨찾기 상태가 변경되면 현재 탭과 즐겨찾기 탭 데이터를 다시 불러옴
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks', 'FAVORITES'] });
  };

  const handleDislikeChanged = async (stockId: number, isDislike: boolean) => {
    // 싫어요 상태가 변경되면 현재 탭과 싫어요 탭 데이터를 다시 불러옴
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks', 'DISLIKES'] });
  };

  const handleSortChange = (field: SortField, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
  };

  const handleStockClick = (stock: Stock) => {
    window.open(getNaverChartUrl(stock), '_blank');
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* Controls - Sticky Header */}
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-8 px-4 lg:px-8 py-4 bg-background/95 backdrop-blur-sm border-b border-border mb-6">
          <div className="flex items-center justify-between gap-4">
            <SortDropdown
              sortField={sortField}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
            />

            {/* 검색바 */}
            <div className="flex-1 max-w-2xl">
              <SearchBar onStockSelect={handleShowChart} />
            </div>

            <div className="flex items-center gap-4">
            {lastUpdateTime && (
              <div key={lastUpdateTime} className="text-sm text-muted-foreground">
                <span className="font-medium">최근:</span>{' '}
                <span className="text-foreground">
                  {new Date(lastUpdateTime).toLocaleString('ko-KR', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            )}
            <button
              onClick={handleRefreshStocks}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer bg-muted hover:bg-muted/80 text-foreground border border-border hover:border-primary/50"
            >
              {isRefreshing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>가져오는 중...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  <span>최신 데이터</span>
                </>
              )}
            </button>
          </div>
        </div>
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
          ) : data && data.pages && data.pages.flatMap(page => page.stocks || []).length > 0 ? (
            <>
              <StockTable
                stocks={data.pages.flatMap(page => page.stocks || [])}
                onStockClick={handleStockClick}
                onShowChart={handleShowChart}
                onStockDeleted={handleStockDeleted}
                onFavoriteChanged={handleFavoriteChanged}
                onDislikeChanged={handleDislikeChanged}
              />

              {/* Infinite scroll trigger */}
              <div ref={loadMoreRef} className="py-4 text-center">
                {isFetchingNextPage && (
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                    <span>Loading more...</span>
                  </div>
                )}
                {!hasNextPage && !isFetchingNextPage && (
                  <span className="text-muted-foreground text-sm">All stocks loaded</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <TrendingUp className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-foreground font-semibold text-lg">No stocks available</p>
              <p className="text-sm text-muted-foreground mt-2">Click "Refresh Data" to get started</p>
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