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

      toast.success(`${stock.name} 분석 완료!`, {
        description: `새 데이터: ${result.stats.new_records}건, 중복: ${result.stats.duplicate_records}건${result.latest_update_date ? `, 최신: ${result.latest_update_date}` : ''}`
      });
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
            {/* 분석 버튼 */}
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed cursor-pointer"
              title="단일 종목 분석"
            >
              {isAnalyzing ? (
                <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent mr-1"></div>
              ) : (
                <TrendingUp className="h-3 w-3 mr-1" />
              )}
              분석
            </button>
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

      {/* 외국인비율 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-500">
        {stock.foreign_ratio ? `${formatDecimal(stock.foreign_ratio)}%` : '-'}
      </td>

      {/* PER */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-500">
        {formatDecimal(stock.per)}
      </td>

      {/* ROE */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-gray-500">
        {stock.roe ? `${formatDecimal(stock.roe)}%` : '-'}
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
    </tr>
  );
});

StockItem.displayName = 'StockItem';

export default StockItem;