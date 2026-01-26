'use client';

import { useState } from 'react';
import { Trash2, AlertTriangle, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface StockWithoutHistory {
  id: number;
  symbol: string;
  name: string;
  market: string;
  signal_count: number;
  tag_count: number;
}

interface CleanupPreviewResponse {
  mode: 'preview';
  message: string;
  stocks: StockWithoutHistory[];
}

interface CleanupDeleteResponse {
  mode: 'deleted';
  message: string;
  deleted_count: number;
  deleted_stocks: StockWithoutHistory[];
}

export default function NoHistoryStocksPage() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // 데이터 없는 종목 목록 조회
  const { data, isLoading, refetch } = useQuery<CleanupPreviewResponse>({
    queryKey: ['stocks-no-history'],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/api/stocks/cleanup-no-history`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch stocks without history');
      return response.json();
    },
  });

  // 전체 삭제 실행
  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/api/stocks/cleanup-no-history?confirm=true`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete stocks');

      const result: CleanupDeleteResponse = await response.json();
      toast.success(result.message);

      // 목록 새로고침
      refetch();
      // 종목 목록 캐시 무효화
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
    } catch (error) {
      console.error('Error deleting stocks:', error);
      toast.error('종목 삭제에 실패했습니다.');
    } finally {
      setIsDeleting(false);
    }
  };

  // 개별 종목 삭제
  const handleDeleteStock = async (stockId: number, stockName: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/api/stocks/${stockId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete stock');

      toast.success(`${stockName} 삭제 완료`);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['stocks'] });
    } catch (error) {
      console.error('Error deleting stock:', error);
      toast.error('종목 삭제에 실패했습니다.');
    }
  };

  const stocks = data?.stocks || [];
  const filteredStocks = stocks.filter(stock =>
    stock.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stock.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">데이터 없는 종목</h1>
            <p className="text-sm text-muted-foreground mt-1">
              히스토리 데이터가 수집되지 않은 종목 목록입니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            {stocks.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={isDeleting}
                    className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    전체 삭제 ({stocks.length}개)
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                      전체 삭제 확인
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <span className="font-semibold text-foreground">{stocks.length}개</span> 종목을 모두 삭제하시겠습니까?
                      <br /><br />
                      이 작업은 되돌릴 수 없으며, 다음 데이터가 함께 삭제됩니다:
                      <ul className="list-disc list-inside mt-2 text-sm">
                        <li>시그널 분석 데이터</li>
                        <li>태그 지정 내역</li>
                        <li>수집 로그</li>
                      </ul>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAll}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting ? '삭제 중...' : '전체 삭제'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* 통계 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">총 종목 수</p>
            <p className="text-2xl font-bold text-foreground">{stocks.length}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">시그널 있는 종목</p>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {stocks.filter(s => s.signal_count > 0).length}
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-sm text-muted-foreground">태그 있는 종목</p>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {stocks.filter(s => s.tag_count > 0).length}
            </p>
          </div>
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="종목명 또는 심볼로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* 종목 목록 */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredStocks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery ? '검색 결과가 없습니다.' : '데이터 없는 종목이 없습니다.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">종목명</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">심볼</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">마켓</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">시그널</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">태그</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">삭제</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredStocks.map((stock) => (
                    <tr key={stock.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">{stock.name}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground font-mono">
                        {stock.symbol}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                          {stock.market}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {stock.signal_count > 0 ? (
                          <span className="text-orange-600 dark:text-orange-400 font-medium">
                            {stock.signal_count}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {stock.tag_count > 0 ? (
                          <span className="text-purple-600 dark:text-purple-400 font-medium">
                            {stock.tag_count}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="삭제"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>종목 삭제</AlertDialogTitle>
                              <AlertDialogDescription>
                                <span className="font-semibold text-foreground">{stock.name} ({stock.symbol})</span>을(를) 삭제하시겠습니까?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>취소</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteStock(stock.id, stock.name)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                삭제
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
