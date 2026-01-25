'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { TrendingUp, TrendingDown, Calendar, DollarSign, Activity } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';

interface SignalStock {
  stock_id: number;
  symbol: string;
  name: string;
  market: string;
  latest_signal_date: string;
  signal_price: number;
  current_price: number;
  price_change_pct: number;
  signal_count: number;
}

interface SignalScanResponse {
  total_scanned: number;
  total_with_signals: number;
  stocks_with_signals: SignalStock[];
  scanned_at: string;
}

export default function SignalsPage() {
  const { data, isLoading, error, refetch } = useQuery<SignalScanResponse>({
    queryKey: ['signals-scan'],
    queryFn: async () => {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/signals/scan`);
      if (!response.ok) throw new Error('Failed to fetch signals');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5분 캐싱
  });

  const formatPrice = (price: number, market: string) => {
    if (market === 'KR') {
      return `${price.toLocaleString()}원`;
    }
    return `$${price.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-primary" />
              매매 신호
            </h1>
            <p className="text-muted-foreground mt-2">
              추세선 돌파 + 되돌림 전략으로 발견된 매수 신호
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            새로고침
          </button>
        </div>

        {/* Stats */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-sm text-muted-foreground">스캔된 종목</p>
                  <p className="text-2xl font-bold text-foreground">{data.total_scanned}개</p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-sm text-muted-foreground">매수 신호 발견</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {data.total_with_signals}개
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-3">
                <Calendar className="h-8 w-8 text-purple-500" />
                <div>
                  <p className="text-sm text-muted-foreground">마지막 스캔</p>
                  <p className="text-sm font-medium text-foreground">
                    {new Date(data.scanned_at).toLocaleString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="relative">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 border border-primary/20"></div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground font-medium">신호 스캔 중...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-24">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4">
              <TrendingDown className="w-8 h-8 text-destructive" />
            </div>
            <p className="text-destructive font-semibold text-lg">신호 조회 실패</p>
            <p className="text-sm text-muted-foreground mt-2">다시 시도해주세요</p>
          </div>
        )}

        {/* Signal Cards */}
        {data && data.stocks_with_signals.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.stocks_with_signals.map((stock) => (
              <div
                key={stock.stock_id}
                className="bg-card border border-border rounded-xl p-6 hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer"
                onClick={() => {
                  const width = Math.floor(window.screen.width * 0.7);
                  const height = window.screen.height;
                  const left = Math.floor(window.screen.width * 0.3);
                  const top = 0;

                  const naverSymbol = stock.market === 'US' && stock.symbol.includes('NASDAQ')
                    ? `${stock.symbol}.O`
                    : stock.symbol;

                  const url = stock.market === 'US'
                    ? `https://m.stock.naver.com/fchart/foreign/stock/${naverSymbol}`
                    : `https://m.stock.naver.com/fchart/domestic/stock/${stock.symbol}`;

                  window.open(
                    url,
                    '_blank',
                    `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
                  );
                }}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{stock.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {stock.symbol} • {stock.market}
                    </p>
                  </div>
                  <div className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium">
                    {stock.signal_count}개 신호
                  </div>
                </div>

                {/* Signal Info */}
                <div className="space-y-3">
                  {/* 최근 신호 날짜 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">최근 신호:</span>
                    <span className="font-medium text-foreground">
                      {formatDate(stock.latest_signal_date)}
                    </span>
                  </div>

                  {/* 신호 가격 */}
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">신호 가격:</span>
                    <span className="font-medium text-foreground">
                      {formatPrice(stock.signal_price, stock.market)}
                    </span>
                  </div>

                  {/* 현재가 */}
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">현재가:</span>
                    <span className="font-medium text-foreground">
                      {formatPrice(stock.current_price, stock.market)}
                    </span>
                  </div>

                  {/* 수익률 */}
                  <div className="pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">신호 대비 수익률</span>
                      <div className="flex items-center gap-1">
                        {stock.price_change_pct >= 0 ? (
                          <>
                            <TrendingUp className="h-4 w-4 text-green-500" />
                            <span className="text-lg font-bold text-green-600 dark:text-green-400">
                              +{stock.price_change_pct.toFixed(2)}%
                            </span>
                          </>
                        ) : (
                          <>
                            <TrendingDown className="h-4 w-4 text-red-500" />
                            <span className="text-lg font-bold text-red-600 dark:text-red-400">
                              {stock.price_change_pct.toFixed(2)}%
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          !isLoading && !error && (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                <TrendingUp className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-foreground font-semibold text-lg">매수 신호가 없습니다</p>
              <p className="text-sm text-muted-foreground mt-2">
                관심 종목에 태그를 추가하고 히스토리 데이터를 수집하세요
              </p>
            </div>
          )
        )}
      </div>

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
