'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockApi, Stock } from '@/lib/api';
import StockTable from '@/components/StockTable';
import StockChartModal from '@/components/StockChartModal';
import { Download, TrendingUp } from 'lucide-react';
import SimpleButton from '@/components/atoms/SimpleButton';
import ScrollToTopButton from '@/components/atoms/ScrollToTopButton';
import ScheduleStatus from '@/components/ScheduleStatus';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function Home() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'ALL' | 'US' | 'KR' | 'FAVORITES' | 'DISLIKES'>('US');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stocks', activeTab],
    queryFn: () => {
      if (activeTab === 'FAVORITES') {
        return stockApi.getFavorites();
      }
      if (activeTab === 'DISLIKES') {
        return stockApi.getDislikes();
      }
      return stockApi.getStocks({
        market: activeTab === 'ALL' ? undefined : activeTab,
        limit: 1000, // 충분히 큰 값으로 설정하여 모든 데이터를 가져옴
      });
    },
  });

  const handleRefreshStocks = async () => {
    setIsRefreshing(true);
    toast.info('데이터를 가져오는 중입니다... (약 20초 소요)');
    try {
      const result = await stockApi.crawlStocks(activeTab);
      await refetch();
      // 마지막 업데이트 시간 저장
      localStorage.setItem('lastStockUpdate', new Date().toISOString());
      toast.success(`성공적으로 ${result.success}개 종목 업데이트 완료!`);
    } catch (error) {
      console.error('Failed to refresh stocks:', error);
      toast.error('데이터 업데이트 실패');
    } finally {
      setIsRefreshing(false);
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


  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-1.5 rounded-full">
                <TrendingUp className="h-4 w-4 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">오스카투자</h1>
            </div>
            <div className="flex items-center space-x-2">
              <SimpleButton
                onClick={handleRefreshStocks}
                disabled={isRefreshing}
                icon={Download}
                loading={isRefreshing}
              >
                Fetch Stocks
              </SimpleButton>
            </div>
          </div>
        </div>
      </header>

      {/* Schedule Status */}
      <ScheduleStatus />

      <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
        {/* Market Tabs */}
        <div className="mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              {[
                { key: 'US', label: 'US Market', icon: '🇺🇸' },
                { key: 'FAVORITES', label: 'Favorites', icon: '⭐' },
                { key: 'DISLIKES', label: 'Dislikes', icon: '👎' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setActiveTab(tab.key as 'ALL' | 'US' | 'KR' | 'FAVORITES' | 'DISLIKES');
                  }}
                  className={`${
                    activeTab === tab.key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 cursor-pointer`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {data && activeTab === tab.key && (
                    <span className="ml-2 bg-gray-100 text-gray-900 rounded-full px-2.5 py-0.5 text-xs font-medium">
                      {data.total}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-500">Failed to load stocks</p>
            </div>
          ) : data && data.stocks.length > 0 ? (
            <StockTable stocks={data.stocks} onShowChart={handleShowChart} onStockDeleted={handleStockDeleted} onFavoriteChanged={handleFavoriteChanged} onDislikeChanged={handleDislikeChanged} />
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500">No stocks available. Click "Fetch Stocks" to get started.</p>
            </div>
          )}
        </div>
      </main>

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
    </div>
  );
}