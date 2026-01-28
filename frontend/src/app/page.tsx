'use client';

import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import AppLayout from '@/components/AppLayout';
import SearchBar from '@/components/SearchBar';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { openNaverChartPopup } from '@/lib/naverStock';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import SortDropdown, { SortField, SortDirection } from '@/components/SortDropdown';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';

export default function Home() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { formatShortDateTime } = useTimezone();
  const [activeTab, setActiveTab] = useState<'US' | 'FAVORITES' | 'DISLIKES'>('US');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('market_cap');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    const savedTime = localStorage.getItem('lastStockUpdate');
    if (savedTime) setLastUpdateTime(savedTime);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'lastStockUpdate' && e.newValue) {
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
      if (activeTab === 'FAVORITES') return stockApi.getFavorites();
      if (activeTab === 'DISLIKES') return stockApi.getDislikes();
      return stockApi.getStocks({
        market: 'US',
        skip: pageParam,
        limit: 20,
        order_by: sortField,
        order_dir: sortDirection,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      if (activeTab === 'FAVORITES' || activeTab === 'DISLIKES') return undefined;
      const loadedCount = allPages.reduce((sum, page) => sum + (page.stocks?.length || 0), 0);
      return loadedCount < (lastPage.total || 0) ? loadedCount : undefined;
    },
    initialPageParam: 0,
  });

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
    toast.info('데이터를 가져오는 중입니다...');
    try {
      await stockApi.crawlStocks('US');
      toast.success('크롤링 시작됨');

      setTimeout(async () => {
        await refetch();
        const now = new Date().toISOString();
        localStorage.setItem('lastStockUpdate', now);
        setLastUpdateTime(now);
        toast.success('데이터 업데이트 완료');
        setIsRefreshing(false);
      }, 25000);
    } catch (error: any) {
      setIsRefreshing(false);
      if (error.response?.status === 429) {
        toast.error('잠시 후 다시 시도해주세요');
      } else {
        toast.error('업데이트 실패');
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

  const handleStockDeleted = async () => await refetch();

  const handleFavoriteChanged = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks', 'FAVORITES'] });
  };

  const handleDislikeChanged = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ['stocks', 'DISLIKES'] });
  };

  const handleSortChange = (field: SortField, direction: SortDirection) => {
    setSortField(field);
    setSortDirection(direction);
  };

  const handleStockClick = (stock: Stock) => openNaverChartPopup(stock);

  const stocks = data?.pages.flatMap(page => page.stocks || []) || [];

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {/* Desktop */}
          <div className="hidden lg:flex items-center gap-4 flex-1">
            <SortDropdown
              sortField={sortField}
              sortDirection={sortDirection}
              onSortChange={handleSortChange}
            />
            <div className="flex-1 max-w-xl">
              <SearchBar onStockSelect={handleShowChart} />
            </div>
            <div className="flex items-center gap-3">
              {lastUpdateTime && (
                <span className="text-sm text-muted-foreground">
                  최근: {formatShortDateTime(lastUpdateTime)}
                </span>
              )}
              <Button
                onClick={handleRefreshStocks}
                disabled={isRefreshing}
                variant="outline"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                최신 데이터
              </Button>
            </div>
          </div>

          {/* Mobile */}
          <div className="lg:hidden space-y-3">
            <SearchBar onStockSelect={handleShowChart} />
            <div className="flex items-center justify-between gap-2">
              <SortDropdown
                sortField={sortField}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
              />
              <div className="flex items-center gap-2">
                {lastUpdateTime && (
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {formatShortDateTime(lastUpdateTime)}
                  </span>
                )}
                <Button
                  onClick={handleRefreshStocks}
                  disabled={isRefreshing}
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
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
                <TrendingUp className="w-6 h-6 text-destructive" />
              </div>
              <p className="text-destructive font-medium">로드 실패</p>
              <p className="text-sm text-muted-foreground mt-1">잠시 후 다시 시도해주세요</p>
            </div>
          ) : stocks.length > 0 ? (
            <>
              <StockTable
                stocks={stocks}
                onStockClick={handleStockClick}
                onShowChart={handleShowChart}
                onStockDeleted={handleStockDeleted}
                onFavoriteChanged={handleFavoriteChanged}
                onDislikeChanged={handleDislikeChanged}
              />

              <div ref={loadMoreRef} className="py-4 text-center border-t">
                {isFetchingNextPage ? (
                  <div className="inline-flex items-center gap-2 text-muted-foreground">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
                    <span className="text-sm">더 불러오는 중...</span>
                  </div>
                ) : !hasNextPage && (
                  <span className="text-sm text-muted-foreground">모든 종목 로드 완료</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted mb-4">
                <TrendingUp className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="font-medium">종목이 없습니다</p>
              <p className="text-sm text-muted-foreground mt-1">"최신 데이터" 버튼을 클릭하세요</p>
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
