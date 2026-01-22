'use client';

import React, { useState, useEffect } from 'react';
import { Stock, stockApi } from '@/lib/api';
import { ArrowUpIcon, ArrowDownIcon, BarChart3, TrendingUp, LineChart, Trash2, Star, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
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

interface StockItemProps {
  stock: Stock;
  rank?: number;
  onStockClick?: (stock: Stock) => void;
  onShowChart?: (stock: Stock) => void;
  onStockDeleted?: (stockId: number) => void;
  onFavoriteChanged?: (stockId: number, isFavorite: boolean) => void;
  onDislikeChanged?: (stockId: number, isDislike: boolean) => void;
  ma90Price?: number | null;
}

const StockItem = React.memo<StockItemProps>(({ stock, rank, onStockClick, onShowChart, onStockDeleted, onFavoriteChanged, onDislikeChanged }) => {
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFavoriting, setIsFavoriting] = useState(false);
  const [isFavorite, setIsFavorite] = useState(stock.is_favorite || false);
  const [isDisliking, setIsDisliking] = useState(false);
  const [isDislike, setIsDislike] = useState(stock.is_dislike || false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // stock.is_favorite prop이 변경될 때마다 상태 동기화
  useEffect(() => {
    setIsFavorite(stock.is_favorite || false);
  }, [stock.is_favorite]);

  // stock.is_dislike prop이 변경될 때마다 상태 동기화
  useEffect(() => {
    setIsDislike(stock.is_dislike || false);
  }, [stock.is_dislike]);

  const handleHistoryCrawl = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLoadingHistory(true);

    try {
      const result = await stockApi.crawlStockHistory(stock.id, 100);
      console.log(`History crawling completed for ${stock.symbol}:`, result);

      // 성공/실패 메시지 표시
      if (result.success > 0) {
        toast.success(`${stock.name} 히스토리 크롤링 완료!`, {
          description: `성공 ${result.success}건, 실패 ${result.failed}건`
        });
      } else {
        toast.error(`${stock.name} 히스토리 크롤링 실패`, {
          description: result.message
        });
      }
    } catch (error) {
      console.error(`Error crawling history for ${stock.symbol}:`, error);
      toast.error(`${stock.name} 히스토리 크롤링 오류`, {
        description: '크롤링 중 오류가 발생했습니다.'
      });
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleDeleteStock = async () => {
    setIsDeleting(true);

    try {
      const result = await stockApi.deleteStock(stock.id);
      console.log(`Stock deletion completed for ${stock.symbol}:`, result);

      toast.success(`${stock.name} 종목 삭제 완료!`, {
        description: result.message
      });

      // 부모 컴포넌트에 삭제 완료 알림
      onStockDeleted?.(stock.id);
    } catch (error) {
      console.error(`Error deleting stock ${stock.symbol}:`, error);
      toast.error(`${stock.name} 종목 삭제 실패`, {
        description: '삭제 중 오류가 발생했습니다.'
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFavoriting(true);

    try {
      let result;
      const newFavoriteStatus = !isFavorite;

      if (newFavoriteStatus) {
        result = await stockApi.addToFavorites(stock.id);
      } else {
        result = await stockApi.removeFromFavorites(stock.id);
      }

      setIsFavorite(newFavoriteStatus);
      onFavoriteChanged?.(stock.id, newFavoriteStatus);

      toast.success(result.message || `${stock.name} ${newFavoriteStatus ? '즐겨찾기 추가' : '즐겨찾기 제거'} 완료!`);
    } catch (error) {
      console.error(`Error toggling favorite for ${stock.symbol}:`, error);
      toast.error(`${stock.name} 즐겨찾기 ${isFavorite ? '제거' : '추가'} 실패`, {
        description: '요청 중 오류가 발생했습니다.'
      });
    } finally {
      setIsFavoriting(false);
    }
  };

  const handleToggleDislike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDisliking(true);

    try {
      let result;
      const newDislikeStatus = !isDislike;

      if (newDislikeStatus) {
        result = await stockApi.addToDislikes(stock.id);
      } else {
        result = await stockApi.removeFromDislikes(stock.id);
      }

      setIsDislike(newDislikeStatus);
      onDislikeChanged?.(stock.id, newDislikeStatus);

      toast.success(result.message || `${stock.name} ${newDislikeStatus ? '싫어요 추가' : '싫어요 제거'} 완료!`);
    } catch (error) {
      console.error(`Error toggling dislike for ${stock.symbol}:`, error);
      toast.error(`${stock.name} 싫어요 ${isDislike ? '제거' : '추가'} 실패`, {
        description: '요청 중 오류가 발생했습니다.'
      });
    } finally {
      setIsDisliking(false);
    }
  };

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsAnalyzing(true);

    try {
      const result = await stockApi.analyzeStock(stock.id);
      console.log(`Analysis completed for ${stock.symbol}:`, result);

      // 분석 결과를 저장하고 모달 열기
      setAnalysisResult(result);
      setShowAnalysisModal(true);

      toast.success(`${stock.name} 분석 완료!`);
    } catch (error) {
      console.error(`Error analyzing ${stock.symbol}:`, error);
      toast.error(`${stock.name} 분석 실패`, {
        description: '분석 중 오류가 발생했습니다.'
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatNumber = (num?: number) => {
    if (!num) return '-';
    return num.toLocaleString();
  };

  const formatPercent = (num?: number) => {
    if (!num) return '-';
    return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
  };

  const formatMarketCap = (num?: number) => {
    if (!num) return '-';
    if (num >= 1e12) {
      return `${(num / 1e12).toFixed(0)}조원`;
    }
    if (num >= 1e8) {
      return `${(num / 1e8).toFixed(0)}억원`;
    }
    if (num >= 1e6) {
      return `${(num / 1e6).toFixed(2)}M`;
    }
    return num.toLocaleString();
  };

  const formatDecimal = (num?: number, decimals: number = 2) => {
    if (!num) return '-';
    return num.toFixed(decimals);
  };

  const getPriceColorClass = (changePercent?: number) => {
    if (!changePercent) return 'text-gray-900';

    if (changePercent >= 3) {
      return 'bg-red-500 text-white px-1 rounded font-bold';
    } else if (changePercent <= -3) {
      return 'bg-blue-500 text-white px-1 rounded';
    } else if (changePercent > 0) {
      return 'text-red-500 font-bold';
    } else if (changePercent < 0) {
      return 'text-blue-600';
    }
    return 'text-gray-900';
  };

  const getChangeColorClass = (changeValue?: number, changePercent?: number) => {
    if (!changeValue && !changePercent) return 'text-gray-500';

    const percent = changePercent || 0;
    if (percent >= 3) {
      return 'bg-red-500 text-white px-1 rounded font-bold';
    } else if (percent <= -3) {
      return 'bg-blue-500 text-white px-1 rounded';
    } else if (percent > 0) {
      return 'text-red-500 font-bold';
    } else if (percent < 0) {
      return 'text-blue-600';
    }
    return 'text-gray-500';
  };

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => onStockClick?.(stock)}
      >
      {/* 순위 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-center text-gray-900 font-medium">
        {rank || '-'}
      </td>

      {/* 즐겨찾기 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-center">
        <button
          onClick={handleToggleFavorite}
          disabled={isFavoriting}
          className={`w-6 h-6 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            isFavorite
              ? 'text-yellow-500 hover:text-yellow-600'
              : 'text-gray-300 hover:text-gray-500'
          }`}
          title={isFavorite ? "즐겨찾기 제거" : "즐겨찾기 추가"}
        >
          {isFavoriting ? (
            <div className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent"></div>
          ) : (
            <Star className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
          )}
        </button>
      </td>

      {/* 종목명 */}
      <td className="px-3 py-4 whitespace-nowrap">
        <div>
          <div className="text-sm font-medium flex items-center space-x-2">
            <a
              href={stock.market === 'US'
                ? `https://m.stock.naver.com/worldstock/stock/${stock.exchange === 'NASDAQ' ? stock.symbol + '.O' : stock.symbol}/total`
                : `https://m.stock.naver.com/domestic/stock/${stock.symbol}/total`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-900 font-bold hover:text-gray-700 hover:underline cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              {stock.name}
            </a>
            <a
              href={stock.market === 'US'
                ? `https://m.stock.naver.com/fchart/foreign/stock/${stock.exchange === 'NASDAQ' ? stock.symbol + '.O' : stock.symbol}`
                : `https://m.stock.naver.com/fchart/domestic/stock/${stock.symbol}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              title="차트 보기"
            >
              <BarChart3 className="h-3 w-3 mr-1" />
              차트
            </a>
          </div>
          <div className="text-xs text-gray-500">
            {stock.symbol}
            {stock.history_latest_date && (
              <span className="ml-2 text-gray-400">
                | 최신: {new Date(stock.history_latest_date).toLocaleDateString('ko-KR')}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* 현재가 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right font-medium">
        <span className={getPriceColorClass(stock.change_percent || stock.latest_change_percent)}>
          {formatNumber(stock.current_price || stock.latest_price)}
        </span>
      </td>

      {/* 전일비 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right">
        <span className={`flex items-center justify-end ${getChangeColorClass(
          stock.change_amount || stock.latest_change,
          stock.change_percent || stock.latest_change_percent
        )}`}>
          {(stock.change_amount || stock.latest_change || 0) >= 0 ? (
            <ArrowUpIcon className="w-3 h-3 mr-1" />
          ) : (
            <ArrowDownIcon className="w-3 h-3 mr-1" />
          )}
          {formatNumber(Math.abs(stock.change_amount || stock.latest_change || 0))}
        </span>
      </td>

      {/* 등락률 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right">
        <span className={getChangeColorClass(
          stock.change_amount || stock.latest_change,
          stock.change_percent || stock.latest_change_percent
        )}>
          {formatPercent(stock.change_percent || stock.latest_change_percent)}
        </span>
      </td>

      {/* 시가총액 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-900">
        {formatMarketCap(stock.market_cap)}
      </td>

      {/* 거래량 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-500">
        {formatNumber(stock.trading_volume || stock.latest_volume)}
      </td>

      {/* 90일선 대비 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right">
        {stock.ma90_percentage !== undefined && stock.ma90_percentage !== null ? (
          <span className={`font-medium ${
            stock.ma90_percentage > 0 ? 'text-red-600' : stock.ma90_percentage < 0 ? 'text-blue-600' : 'text-gray-500'
          }`}>
            {stock.ma90_percentage > 0 ? '+' : ''}{stock.ma90_percentage.toFixed(1)}%
          </span>
        ) : (
          <span className="text-gray-400">-</span>
        )}
      </td>

      {/* 거래소 */}
      <td className="px-3 py-4 whitespace-nowrap text-center">
        <span className={`px-2 py-1 rounded-full text-xs ${
          stock.exchange === 'KOSPI'
            ? 'bg-blue-100 text-blue-800'
            : stock.exchange === 'KOSDAQ'
            ? 'bg-green-100 text-green-800'
            : stock.market === 'US'
            ? 'bg-purple-100 text-purple-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {stock.exchange || stock.market}
        </span>
      </td>

      {/* 분석 */}
      <td className="px-3 py-4 whitespace-nowrap text-center">
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed cursor-pointer"
          title="단일 종목 분석"
        >
          {isAnalyzing ? (
            <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"></div>
          ) : (
            <TrendingUp className="h-3 w-3" />
          )}
        </button>
      </td>
    </tr>

    {/* 분석 결과 모달 */}
    {showAnalysisModal && analysisResult && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowAnalysisModal(false)}>
        <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          {/* 헤더 */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{stock.name} ({stock.symbol})</h2>
              <p className="text-sm text-gray-500 mt-1">분석 결과</p>
            </div>
            <button
              onClick={() => setShowAnalysisModal(false)}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          {/* 통계 요약 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-sm text-blue-600 font-medium">새로운 데이터</p>
              <p className="text-3xl font-bold text-blue-900 mt-1">{analysisResult.stats.new_records}건</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600 font-medium">중복 데이터</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{analysisResult.stats.duplicate_records}건</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-sm text-green-600 font-medium">전체 레코드</p>
              <p className="text-3xl font-bold text-green-900 mt-1">{analysisResult.total_records}건</p>
            </div>
          </div>

          {/* 상세 정보 */}
          <div className="border-t pt-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">상세 정보</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">종목 코드</span>
                <span className="font-medium text-gray-900">{analysisResult.symbol}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">최신 업데이트</span>
                <span className="font-medium text-gray-900">
                  {analysisResult.latest_update_date ? new Date(analysisResult.latest_update_date).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  }) : '-'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">현재가</span>
                <span className="font-medium text-gray-900">{stock.current_price ? `$${formatNumber(stock.current_price)}` : '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">변동률</span>
                <span className={`font-medium ${
                  (stock.change_percent || 0) > 0 ? 'text-red-600' :
                  (stock.change_percent || 0) < 0 ? 'text-blue-600' :
                  'text-gray-600'
                }`}>
                  {stock.change_percent ? `${stock.change_percent > 0 ? '+' : ''}${stock.change_percent.toFixed(2)}%` : '-'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-gray-600">시가총액</span>
                <span className="font-medium text-gray-900">
                  {stock.market_cap ? `$${formatNumber(Math.round(stock.market_cap / 1000))}B` : '-'}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-600">거래소</span>
                <span className="font-medium text-gray-900">{stock.exchange || '-'}</span>
              </div>
            </div>
          </div>

          {/* 메시지 */}
          {analysisResult.message && (
            <div className="mt-6 bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-700">{analysisResult.message}</p>
            </div>
          )}

          {/* 닫기 버튼 */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setShowAnalysisModal(false)}
              className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              닫기
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
});

StockItem.displayName = 'StockItem';

export default StockItem;