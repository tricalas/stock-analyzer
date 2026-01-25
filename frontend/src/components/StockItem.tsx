'use client';

import React, { useState, useEffect } from 'react';
import { Stock, stockApi, Tag } from '@/lib/api';
import { ArrowUpIcon, ArrowDownIcon, BarChart3, TrendingUp, LineChart, Trash2, Star, ThumbsDown, ShoppingCart, ThumbsUp, Eye, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTags } from '@/contexts/TagContext';
import { useQueryClient } from '@tanstack/react-query';
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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const { tags: availableTags } = useTags();
  const [stockTags, setStockTags] = useState<Tag[]>(stock.tags || []);
  const [togglingTags, setTogglingTags] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  // Sync stock tags when stock.tags changes
  useEffect(() => {
    setStockTags(stock.tags || []);
  }, [stock.tags]);

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

  const handleToggleTag = async (e: React.MouseEvent, tag: Tag) => {
    e.stopPropagation();

    // Check if this tag is already being toggled
    if (togglingTags.has(tag.id)) {
      return;
    }

    const hasTag = stockTags.some(t => t.id === tag.id);

    // Add to toggling set
    setTogglingTags(prev => new Set(prev).add(tag.id));

    try {
      if (hasTag) {
        await stockApi.removeTagFromStock(stock.id, tag.id);
        setStockTags(prev => prev.filter(t => t.id !== tag.id));
        // Invalidate tag-based queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['stocks', 'TAG'] });
        toast.success(`${tag.display_name} 태그 제거 완료!`);
      } else {
        await stockApi.addTagToStock(stock.id, tag.id);
        setStockTags(prev => [...prev, tag]);
        // Invalidate tag-based queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['stocks', 'TAG'] });
        toast.success(`${tag.display_name} 태그 추가 완료!`);
      }
    } catch (error) {
      console.error(`Error toggling tag ${tag.name} for ${stock.symbol}:`, error);
      toast.error(`${tag.display_name} 태그 ${hasTag ? '제거' : '추가'} 실패`, {
        description: '요청 중 오류가 발생했습니다.'
      });
    } finally {
      // Remove from toggling set
      setTogglingTags(prev => {
        const next = new Set(prev);
        next.delete(tag.id);
        return next;
      });
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

  const getTagIcon = (iconName?: string) => {
    const iconProps = { className: "h-3.5 w-3.5" };
    switch (iconName) {
      case 'Star':
        return <Star {...iconProps} />;
      case 'ThumbsDown':
        return <ThumbsDown {...iconProps} />;
      case 'ShoppingCart':
        return <ShoppingCart {...iconProps} />;
      case 'ThumbsUp':
        return <ThumbsUp {...iconProps} />;
      case 'Eye':
        return <Eye {...iconProps} />;
      case 'TrendingUp':
        return <TrendingUp {...iconProps} />;
      case 'AlertCircle':
        return <AlertCircle {...iconProps} />;
      case 'Trash2':
        return <Trash2 {...iconProps} />;
      default:
        return null;
    }
  };

  const getTagColorClass = (color?: string, isActive?: boolean) => {
    // 기본 버튼 스타일 (선택 안 됨) - 흰색
    if (!isActive) {
      return 'bg-card text-foreground border-border hover:bg-muted/50';
    }
    // 선택됨 - 보라색
    return 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700';
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
    if (!changePercent) return 'text-foreground';

    if (changePercent >= 3) {
      return 'bg-gain text-gain-foreground px-2 py-0.5 rounded font-bold';
    } else if (changePercent <= -3) {
      return 'bg-loss text-loss-foreground px-2 py-0.5 rounded font-bold';
    } else if (changePercent > 0) {
      return 'text-gain font-semibold';
    } else if (changePercent < 0) {
      return 'text-loss font-semibold';
    }
    return 'text-foreground';
  };

  const getChangeColorClass = (changeValue?: number, changePercent?: number) => {
    if (!changeValue && !changePercent) return 'text-muted-foreground';

    const percent = changePercent || 0;
    if (percent >= 3) {
      return 'bg-gain text-gain-foreground px-2 py-0.5 rounded font-bold';
    } else if (percent <= -3) {
      return 'bg-loss text-loss-foreground px-2 py-0.5 rounded font-bold';
    } else if (percent > 0) {
      return 'text-gain font-semibold';
    } else if (percent < 0) {
      return 'text-loss font-semibold';
    }
    return 'text-muted-foreground';
  };

  return (
    <>
      <tr
        className="hover:bg-muted/50 cursor-pointer transition-colors duration-150 group"
        onClick={() => onStockClick?.(stock)}
      >
      {/* 종목명 */}
      <td className="px-6 py-4 whitespace-nowrap">
        <div>
          <div className="text-sm font-medium flex items-center space-x-2">
            <a
              href={stock.market === 'US'
                ? `https://m.stock.naver.com/worldstock/stock/${stock.exchange === 'NASDAQ' ? stock.symbol + '.O' : stock.symbol}/total`
                : `https://m.stock.naver.com/domestic/stock/${stock.symbol}/total`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground font-bold hover:text-primary hover:underline cursor-pointer transition-colors"
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
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer transition-colors"
              onClick={(e) => e.stopPropagation()}
              title="차트 보기"
            >
              <BarChart3 className="h-3 w-3 mr-1" />
              차트
            </a>
          </div>
          <div className="text-xs text-muted-foreground">
            {stock.symbol}
            {stock.history_latest_date && (
              <span className="ml-2 text-muted-foreground/60">
                | 최신: {new Date(stock.history_latest_date).toLocaleDateString('ko-KR')}
              </span>
            )}
            {stock.latest_tag_date && (
              <span className="ml-2 text-primary/70 text-[10px]">
                | 📌 {new Date(stock.latest_tag_date).toLocaleDateString('ko-KR', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            )}
          </div>
        </div>
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

      {/* 시총 */}
      <td className="px-3 py-4 whitespace-nowrap text-sm text-right text-foreground font-mono">
        {formatMarketCap(stock.market_cap)}
      </td>

      {/* 거래소 */}
      <td className="px-3 py-4 whitespace-nowrap text-center">
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          stock.exchange === 'KOSPI'
            ? 'bg-primary/10 text-primary'
            : stock.exchange === 'KOSDAQ'
            ? 'bg-gain/10 text-gain'
            : stock.market === 'US'
            ? 'bg-secondary text-secondary-foreground'
            : 'bg-muted text-muted-foreground'
        }`}>
          {stock.exchange || stock.market}
        </span>
      </td>

      {/* 태그 */}
      <td className="px-3 py-4 text-center">
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center">
            {availableTags.map((tag) => {
              const hasTag = stockTags.some(t => t.id === tag.id);
              const isToggling = togglingTags.has(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={(e) => handleToggleTag(e, tag)}
                  disabled={isToggling}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${getTagColorClass(tag.color, hasTag)}`}
                  title={hasTag ? `${tag.display_name} 제거` : `${tag.display_name} 추가`}
                >
                  {isToggling ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                  ) : (
                    getTagIcon(tag.icon)
                  )}
                  <span>{tag.display_name}</span>
                </button>
              );
            })}
          </div>
        )}
      </td>
    </tr>

    {/* 분석 결과 모달 */}
    {showAnalysisModal && analysisResult && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowAnalysisModal(false)}>
        <div className="bg-card border border-border rounded-xl shadow-2xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          {/* 헤더 */}
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground">{stock.name} ({stock.symbol})</h2>
              <p className="text-sm text-muted-foreground mt-1">분석 결과</p>
            </div>
            <button
              onClick={() => setShowAnalysisModal(false)}
              className="text-muted-foreground hover:text-foreground text-2xl leading-none transition-colors"
            >
              ×
            </button>
          </div>

          {/* 통계 요약 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <p className="text-sm text-primary font-semibold">새로운 데이터</p>
              <p className="text-3xl font-bold text-primary mt-1 font-mono">{analysisResult.stats.new_records}건</p>
            </div>
            <div className="bg-muted/50 border border-border rounded-lg p-4">
              <p className="text-sm text-muted-foreground font-semibold">중복 데이터</p>
              <p className="text-3xl font-bold text-foreground mt-1 font-mono">{analysisResult.stats.duplicate_records}건</p>
            </div>
            <div className="bg-gain/10 border border-gain/20 rounded-lg p-4">
              <p className="text-sm text-gain font-semibold">전체 레코드</p>
              <p className="text-3xl font-bold text-gain mt-1 font-mono">{analysisResult.total_records}건</p>
            </div>
          </div>

          {/* 상세 정보 */}
          <div className="border-t border-border pt-4">
            <h3 className="text-lg font-semibold text-foreground mb-3">상세 정보</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">종목 코드</span>
                <span className="font-semibold text-foreground font-mono">{analysisResult.symbol}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">최신 업데이트</span>
                <span className="font-medium text-foreground">
                  {analysisResult.latest_update_date ? new Date(analysisResult.latest_update_date).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  }) : '-'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">현재가</span>
                <span className="font-semibold text-foreground font-mono">{stock.current_price ? `$${formatNumber(stock.current_price)}` : '-'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">변동률</span>
                <span className={`font-semibold font-mono ${
                  (stock.change_percent || 0) > 0 ? 'text-gain' :
                  (stock.change_percent || 0) < 0 ? 'text-loss' :
                  'text-muted-foreground'
                }`}>
                  {stock.change_percent ? `${stock.change_percent > 0 ? '+' : ''}${stock.change_percent.toFixed(2)}%` : '-'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">시총</span>
                <span className="font-semibold text-foreground font-mono">
                  {stock.market_cap ? `$${formatNumber(Math.round(stock.market_cap / 1000))}B` : '-'}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">거래소</span>
                <span className="font-medium text-foreground">{stock.exchange || '-'}</span>
              </div>
            </div>
          </div>

          {/* 메시지 */}
          {analysisResult.message && (
            <div className="mt-6 bg-muted/50 border border-border rounded-lg p-4">
              <p className="text-sm text-foreground">{analysisResult.message}</p>
            </div>
          )}

          {/* 닫기 버튼 */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => setShowAnalysisModal(false)}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all duration-200 font-medium"
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