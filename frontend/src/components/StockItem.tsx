'use client';

import React, { useState, useEffect } from 'react';
import { Stock, stockApi, Tag } from '@/lib/api';
import { ArrowUpIcon, ArrowDownIcon, BarChart3, TrendingUp, TrendingDown, Trash2, Star, ThumbsDown, ShoppingCart, ThumbsUp, Eye, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { getNaverChartUrl, getNaverInfoUrl } from '@/lib/naverStock';
import { toast } from 'sonner';
import { useTags } from '@/contexts/TagContext';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
    if (num >= 1e12) return `${(num / 1e12).toFixed(0)}조`;
    if (num >= 1e8) return `${(num / 1e8).toFixed(0)}억`;
    return num.toLocaleString();
  };

  const changePercent = stock.change_percent || stock.latest_change_percent || 0;
  const changeAmount = stock.change_amount || stock.latest_change || 0;

  const getPriceChangeColor = (percent: number) => {
    if (percent >= 3) return 'text-green-600 dark:text-green-400 bg-green-500/10';
    if (percent <= -3) return 'text-red-600 dark:text-red-400 bg-red-500/10';
    if (percent > 0) return 'text-green-600 dark:text-green-400';
    if (percent < 0) return 'text-red-600 dark:text-red-400';
    return 'text-muted-foreground';
  };

  // Mobile Card View
  if (viewMode === 'card') {
    return (
      <Card
        className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => onStockClick?.(stock)}
      >
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <a
                  href={getNaverInfoUrl(stock)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-base hover:text-primary hover:underline truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {stock.name}
                </a>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                  {stock.exchange || stock.market}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{stock.symbol}</span>
                {signalData?.signals?.length > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0 h-5",
                      signalData.latest_return_pct >= 0
                        ? "border-green-500/50 text-green-600 dark:text-green-400"
                        : "border-red-500/50 text-red-600 dark:text-red-400"
                    )}
                  >
                    {signalData.latest_return_pct >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                    {signalData.latest_return_pct >= 0 ? '+' : ''}{signalData.latest_return_pct.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className={cn("text-lg font-bold px-2 py-0.5 rounded", getPriceChangeColor(changePercent))}>
                {formatPercent(changePercent)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatMarketCap(stock.market_cap)}
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-4 py-2 px-3 rounded-lg bg-muted/50 mb-3 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">90일선</span>
              <span className={cn("font-medium", getPriceChangeColor(stock.ma90_percentage || 0))}>
                {stock.ma90_percentage != null ? formatPercent(stock.ma90_percentage) : '-'}
              </span>
            </div>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSyncHistory}
              disabled={isSyncing}
              className={cn(
                "h-7 px-2 text-xs",
                syncStatus === 'synced' && "text-green-600 dark:text-green-400",
                syncStatus === 'partial' && "text-yellow-600 dark:text-yellow-400",
                syncStatus === 'none' && "text-red-600 dark:text-red-400"
              )}
            >
              {isSyncing ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  {syncStatus === 'synced' && '✓'}
                  {syncStatus === 'partial' && '⚠'}
                  {syncStatus === 'none' && '○'}
                  <span className="ml-1">{recordsCount}일</span>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="h-7 px-2 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <a href={getNaverChartUrl(stock)} target="_blank" rel="noopener noreferrer">
                <BarChart3 className="h-3 w-3 mr-1" />
                차트
              </a>
            </Button>
          </div>

          {/* Tags */}
          {availableTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => {
                const hasTag = stockTags.some(t => t.id === tag.id);
                const isToggling = togglingTags.has(tag.id);
                return (
                  <Button
                    key={tag.id}
                    variant={hasTag ? "default" : "outline"}
                    size="sm"
                    onClick={(e) => handleToggleTag(e, tag)}
                    disabled={isToggling}
                    className={cn(
                      "h-8 px-2.5 text-xs gap-1.5",
                      hasTag && "bg-purple-600 hover:bg-purple-700"
                    )}
                  >
                    {isToggling ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      getTagIcon(tag.icon)
                    )}
                    {tag.display_name}
                  </Button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Desktop Table View
  return (
    <tr
      className="hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={() => onStockClick?.(stock)}
    >
      <td className="px-4 py-4 whitespace-nowrap">
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
            <Button variant="ghost" size="sm" asChild className="h-6 px-2" onClick={(e) => e.stopPropagation()}>
              <a href={getNaverChartUrl(stock)} target="_blank" rel="noopener noreferrer">
                <BarChart3 className="h-3 w-3 mr-1" />
                차트
              </a>
            </Button>
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

      <td className="px-4 py-4 whitespace-nowrap text-right">
        <span className={cn("inline-flex items-center text-sm", getPriceChangeColor(changePercent))}>
          {changeAmount >= 0 ? <ArrowUpIcon className="w-3 h-3 mr-1" /> : <ArrowDownIcon className="w-3 h-3 mr-1" />}
          {formatNumber(Math.abs(changeAmount))}
        </span>
      </td>

      <td className="px-4 py-4 whitespace-nowrap text-right">
        <span className={cn("text-sm font-medium px-2 py-0.5 rounded", getPriceChangeColor(changePercent))}>
          {formatPercent(changePercent)}
        </span>
      </td>

      <td className="px-4 py-4 whitespace-nowrap text-right">
        <span className={cn("text-sm", getPriceChangeColor(stock.ma90_percentage || 0))}>
          {stock.ma90_percentage != null ? formatPercent(stock.ma90_percentage) : '-'}
        </span>
      </td>

      <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-mono">
        {formatMarketCap(stock.market_cap)}
      </td>

      <td className="px-4 py-4 whitespace-nowrap text-center">
        <Badge variant="secondary">{stock.exchange || stock.market}</Badge>
      </td>

      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-1.5 justify-center">
          {availableTags.map((tag) => {
            const hasTag = stockTags.some(t => t.id === tag.id);
            const isToggling = togglingTags.has(tag.id);
            return (
              <Button
                key={tag.id}
                variant={hasTag ? "default" : "outline"}
                size="sm"
                onClick={(e) => handleToggleTag(e, tag)}
                disabled={isToggling}
                className={cn(
                  "h-7 px-2 text-xs gap-1",
                  hasTag && "bg-purple-600 hover:bg-purple-700"
                )}
              >
                {isToggling ? <RefreshCw className="h-3 w-3 animate-spin" /> : getTagIcon(tag.icon)}
                {tag.display_name}
              </Button>
            );
          })}
        </div>
      </td>

      <td className="px-2 py-4 text-center">
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
