'use client';

import React, { useState, useEffect } from 'react';
import { Stock, stockApi, Tag } from '@/lib/api';
import { ArrowUpIcon, ArrowDownIcon, BarChart3, TrendingUp, TrendingDown, Trash2, Star, ThumbsDown, ShoppingCart, ThumbsUp, Eye, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { getNaverChartUrl, getNaverInfoUrl } from '@/lib/naverStock';
import { toast } from 'sonner';
import { useTags } from '@/contexts/TagContext';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';

interface StockItemProps {
  stock: Stock;
  rank?: number;
  onStockClick?: (stock: Stock) => void;
  onShowChart?: (stock: Stock) => void;
  onStockDeleted?: (stockId: number) => void;
  onFavoriteChanged?: (stockId: number, isFavorite: boolean) => void;
  onDislikeChanged?: (stockId: number, isDislike: boolean) => void;
  ma90Price?: number | null;
  viewMode?: 'table' | 'card';
}

const StockItem = React.memo<StockItemProps>(({
  stock,
  rank,
  onStockClick,
  onShowChart,
  onStockDeleted,
  onFavoriteChanged,
  onDislikeChanged,
  viewMode = 'table'
}) => {
  const { formatShortDateTime, formatShortDate } = useTimezone();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'none' | 'partial' | 'synced'>(() => {
    const count = stock.history_records_count || 0;
    if (count === 0) return 'none';
    if (count < 60) return 'partial';
    return 'synced';
  });
  const [recordsCount, setRecordsCount] = useState(stock.history_records_count || 0);
  const { tags: availableTags } = useTags();
  const [stockTags, setStockTags] = useState<Tag[]>(stock.tags || []);
  const [togglingTags, setTogglingTags] = useState<Set<number>>(new Set());
  const [showTags, setShowTags] = useState(false);
  const queryClient = useQueryClient();

  const { data: signalData } = useQuery({
    queryKey: ['stock-signals', stock.id],
    queryFn: () => stockApi.getStockSignals(stock.id, 120),
    enabled: !!stock.history_records_count && stock.history_records_count >= 60,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    setStockTags(stock.tags || []);
  }, [stock.tags]);

  const handleDeleteStock = async () => {
    setIsDeleting(true);
    try {
      const result = await stockApi.deleteStock(stock.id);
      toast.success(`${stock.name} 삭제 완료`);
      onStockDeleted?.(stock.id);
    } catch (error) {
      toast.error(`삭제 실패`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleTag = async (e: React.MouseEvent, tag: Tag) => {
    e.stopPropagation();
    if (togglingTags.has(tag.id)) return;

    const hasTag = stockTags.some(t => t.id === tag.id);
    setTogglingTags(prev => new Set(prev).add(tag.id));

    try {
      if (hasTag) {
        await stockApi.removeTagFromStock(stock.id, tag.id);
        setStockTags(prev => prev.filter(t => t.id !== tag.id));
        queryClient.invalidateQueries({ queryKey: ['stocks', 'TAG'] });
        toast.success(`${tag.display_name} 제거`);
      } else {
        await stockApi.addTagToStock(stock.id, tag.id);
        setStockTags(prev => [...prev, tag]);
        queryClient.invalidateQueries({ queryKey: ['stocks', 'TAG'] });
        toast.success(`${tag.display_name} 추가`);
      }
    } catch (error) {
      toast.error(`태그 변경 실패`);
    } finally {
      setTogglingTags(prev => {
        const next = new Set(prev);
        next.delete(tag.id);
        return next;
      });
    }
  };

  const handleSyncHistory = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSyncing(true);
    try {
      const result = await stockApi.syncStockHistory(stock.id, 100);
      setRecordsCount(result.records_count);
      if (result.records_count >= 60) setSyncStatus('synced');
      else if (result.records_count > 0) setSyncStatus('partial');

      if (result.mode === 'skip') {
        toast.info(`이미 최신 상태`);
      } else {
        toast.success(`${result.records_added}건 동기화 완료`);
      }
      queryClient.invalidateQueries({ queryKey: ['stock-signals', stock.id] });
    } catch (error: any) {
      toast.error(`동기화 실패`);
    } finally {
      setIsSyncing(false);
    }
  };

  const getTagIcon = (iconName?: string) => {
    const props = { className: "h-3 w-3" };
    switch (iconName) {
      case 'Star': return <Star {...props} />;
      case 'ThumbsDown': return <ThumbsDown {...props} />;
      case 'ShoppingCart': return <ShoppingCart {...props} />;
      case 'ThumbsUp': return <ThumbsUp {...props} />;
      case 'Eye': return <Eye {...props} />;
      case 'TrendingUp': return <TrendingUp {...props} />;
      case 'AlertCircle': return <AlertCircle {...props} />;
      case 'Trash2': return <Trash2 {...props} />;
      default: return null;
    }
  };

  const formatNumber = (num?: number) => num ? num.toLocaleString() : '-';
  const formatPercent = (num?: number) => num ? `${num > 0 ? '+' : ''}${num.toFixed(2)}%` : '-';
  const formatMarketCap = (num?: number) => {
    if (!num) return '-';
    if (num >= 1e12) return `${(num / 1e12).toFixed(1)}조`;
    if (num >= 1e8) return `${(num / 1e8).toFixed(0)}억`;
    return num.toLocaleString();
  };

  const changePercent = stock.change_percent || stock.latest_change_percent || 0;
  const changeAmount = stock.change_amount || stock.latest_change || 0;

  const getTextColor = (percent: number) => {
    if (percent > 0) return 'text-green-600 dark:text-green-400';
    if (percent < 0) return 'text-red-600 dark:text-red-400';
    return 'text-muted-foreground';
  };

  // Mobile List View - Clean & Flat
  if (viewMode === 'card') {
    const activeTags = stockTags.filter(t => availableTags.some(at => at.id === t.id));

    return (
      <div className="active:bg-muted/50 transition-colors">
        {/* Main Row */}
        <div
          className="flex items-center gap-3 py-3 px-4"
          onClick={() => onStockClick?.(stock)}
        >
          {/* Left: Stock Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-[15px] truncate">{stock.name}</span>
              {activeTags.length > 0 && (
                <div className="flex gap-1">
                  {activeTags.slice(0, 2).map(tag => (
                    <span
                      key={tag.id}
                      className="w-1.5 h-1.5 rounded-full bg-purple-500"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{stock.symbol}</span>
              <span className="text-muted-foreground/50">·</span>
              <span>{stock.exchange || stock.market}</span>
              <span className="text-muted-foreground/50">·</span>
              <span>{formatMarketCap(stock.market_cap)}</span>
            </div>
          </div>

          {/* Right: Price Info */}
          <div className="text-right shrink-0">
            <div className={cn("text-[15px] font-semibold tabular-nums", getTextColor(changePercent))}>
              {formatPercent(changePercent)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              90일 {stock.ma90_percentage != null ? (
                <span className={getTextColor(stock.ma90_percentage)}>
                  {formatPercent(stock.ma90_percentage)}
                </span>
              ) : '-'}
            </div>
          </div>

          {/* Signal Badge */}
          {signalData?.signals?.length > 0 && (
            <div className={cn(
              "shrink-0 text-xs font-medium px-2 py-1 rounded",
              signalData.latest_return_pct >= 0
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            )}>
              {signalData.latest_return_pct >= 0 ? '+' : ''}{signalData.latest_return_pct.toFixed(1)}%
            </div>
          )}

          <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
        </div>

        {/* Quick Actions Row */}
        <div className="flex items-center gap-1 px-4 pb-3 overflow-x-auto scrollbar-none">
          {/* Sync Button */}
          <button
            onClick={handleSyncHistory}
            disabled={isSyncing}
            className={cn(
              "shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors",
              syncStatus === 'synced' && "border-green-500/30 text-green-600 dark:text-green-400",
              syncStatus === 'partial' && "border-yellow-500/30 text-yellow-600 dark:text-yellow-400",
              syncStatus === 'none' && "border-red-500/30 text-red-600 dark:text-red-400"
            )}
          >
            {isSyncing ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <span>{syncStatus === 'synced' ? '✓' : syncStatus === 'partial' ? '⚠' : '○'} {recordsCount}일</span>
            )}
          </button>

          {/* Chart Link */}
          <a
            href={getNaverChartUrl(stock)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <BarChart3 className="h-3 w-3" />
            차트
          </a>

          {/* Tag Buttons */}
          {availableTags.map((tag) => {
            const hasTag = stockTags.some(t => t.id === tag.id);
            const isToggling = togglingTags.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={(e) => handleToggleTag(e, tag)}
                disabled={isToggling}
                className={cn(
                  "shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors",
                  hasTag
                    ? "border-purple-500 bg-purple-500 text-white"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {isToggling ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  getTagIcon(tag.icon)
                )}
                {tag.display_name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop Table View
  return (
    <tr
      className="hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={() => onStockClick?.(stock)}
    >
      <td className="px-4 py-3 whitespace-nowrap">
        <div>
          <div className="flex items-center gap-2">
            <a
              href={getNaverInfoUrl(stock)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold hover:text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {stock.name}
            </a>
            <a
              href={getNaverChartUrl(stock)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              <BarChart3 className="h-3 w-3" />
              차트
            </a>
            {signalData?.signals?.length > 0 && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  signalData.latest_return_pct >= 0
                    ? "border-green-500/50 text-green-600"
                    : "border-red-500/50 text-red-600"
                )}
              >
                {signalData.latest_return_pct >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                {signalData.latest_return_pct >= 0 ? '+' : ''}{signalData.latest_return_pct.toFixed(1)}%
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>{stock.symbol}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSyncHistory}
              disabled={isSyncing}
              className={cn(
                "h-5 px-1.5 text-[10px]",
                syncStatus === 'synced' && "text-green-600",
                syncStatus === 'partial' && "text-yellow-600",
                syncStatus === 'none' && "text-red-600"
              )}
            >
              {isSyncing ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <span>{syncStatus === 'synced' ? '✓' : syncStatus === 'partial' ? '⚠' : '○'} {recordsCount}일</span>
              )}
            </Button>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-right">
        <span className={cn("inline-flex items-center text-sm", getTextColor(changePercent))}>
          {changeAmount >= 0 ? <ArrowUpIcon className="w-3 h-3 mr-1" /> : <ArrowDownIcon className="w-3 h-3 mr-1" />}
          {formatNumber(Math.abs(changeAmount))}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-right">
        <span className={cn("text-sm font-medium", getTextColor(changePercent))}>
          {formatPercent(changePercent)}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-right">
        <span className={cn("text-sm", getTextColor(stock.ma90_percentage || 0))}>
          {stock.ma90_percentage != null ? formatPercent(stock.ma90_percentage) : '-'}
        </span>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-right text-sm tabular-nums">
        {formatMarketCap(stock.market_cap)}
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-center">
        <span className="text-xs text-muted-foreground">{stock.exchange || stock.market}</span>
      </td>

      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1 justify-center">
          {availableTags.map((tag) => {
            const hasTag = stockTags.some(t => t.id === tag.id);
            const isToggling = togglingTags.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={(e) => handleToggleTag(e, tag)}
                disabled={isToggling}
                className={cn(
                  "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors",
                  hasTag
                    ? "border-purple-500 bg-purple-500 text-white"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/50"
                )}
              >
                {isToggling ? <RefreshCw className="h-3 w-3 animate-spin" /> : getTagIcon(tag.icon)}
                {tag.display_name}
              </button>
            );
          })}
        </div>
      </td>

      <td className="px-2 py-3 text-center">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => e.stopPropagation()}
              disabled={isDeleting}
              className="opacity-0 group-hover:opacity-100 h-8 w-8 text-muted-foreground hover:text-destructive"
            >
              {isDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>종목 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-semibold">{stock.name} ({stock.symbol})</span>을(를) 삭제하시겠습니까?
                <br /><br />
                이 작업은 되돌릴 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteStock} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  );
});

StockItem.displayName = 'StockItem';

export default StockItem;
