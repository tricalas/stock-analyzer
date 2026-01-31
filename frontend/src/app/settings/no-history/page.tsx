'use client';

import { useState } from 'react';
import { Trash2, AlertTriangle, RefreshCw, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

interface NoHistoryResponse {
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
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
  const [page, setPage] = useState(1);
  const limit = 50;
  const queryClient = useQueryClient();

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // 데이터 없는 종목 목록 조회
  const { data, isLoading, refetch } = useQuery<NoHistoryResponse>({
    queryKey: ['stocks-no-history', page, limit],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/api/stocks/no-history?page=${page}&limit=${limit}`, {
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

      // 첫 페이지로 이동 및 새로고침
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['stocks-no-history'] });
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
  const totalCount = data?.total_count || 0;
  const totalPages = data?.total_pages || 1;

  const filteredStocks = searchQuery
    ? stocks.filter(stock =>
        stock.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        stock.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : stocks;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">데이터 없는 종목</h1>
          <p className="text-sm text-muted-foreground mt-1">
            히스토리 데이터가 수집되지 않은 종목 목록입니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
          {totalCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isDeleting}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  전체 삭제 ({totalCount}개)
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                    전체 삭제 확인
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <span className="font-semibold text-foreground">{totalCount}개</span> 종목을 모두 삭제하시겠습니까?
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
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">총 종목 수</p>
            <p className="text-2xl font-bold text-foreground">{totalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">현재 페이지</p>
            <p className="text-2xl font-bold text-foreground">{page} / {totalPages}</p>
          </CardContent>
        </Card>
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="현재 페이지에서 검색..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* 종목 목록 */}
      <Card>
        <CardContent className="p-0">
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
                        <Badge variant="secondary">{stock.market}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {stock.signal_count > 0 ? (
                          <Badge variant="outline" className="bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30">
                            {stock.signal_count}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {stock.tag_count > 0 ? (
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30">
                            {stock.tag_count}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
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
        </CardContent>
      </Card>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            이전
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={page === pageNum ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPage(pageNum)}
                  className="w-10"
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            다음
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
