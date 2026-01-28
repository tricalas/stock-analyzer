'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { stockApi, Stock, Tag } from '@/lib/api';
import { Search, X, TrendingUp, TrendingDown, Star, ThumbsDown, ShoppingCart, ThumbsUp, Eye, AlertCircle, Trash2, BarChart3, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTags } from '@/contexts/TagContext';
import { getNaverChartUrl } from '@/lib/naverStock';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  onStockSelect?: (stock: Stock) => void;
}

// Helper functions moved outside component (never recreated)
const formatChange = (changePercent?: number) => {
  if (!changePercent) return '';
  const sign = changePercent > 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(2)}%`;
};

const getChangeColor = (changePercent?: number) => {
  if (!changePercent) return 'text-muted-foreground';
  if (changePercent > 0) return 'text-gain';
  if (changePercent < 0) return 'text-loss';
  return 'text-muted-foreground';
};

const formatMarketCap = (num?: number) => {
  if (!num) return '';
  if (num >= 1e12) return `${(num / 1e12).toFixed(0)}조`;
  if (num >= 1e8) return `${(num / 1e8).toFixed(0)}억`;
  return '';
};

const getTagColorClass = (color?: string, isActive?: boolean) => {
  if (!isActive) {
    return 'bg-card text-foreground border-border hover:bg-muted/50';
  }
  return 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700';
};

const getTagIcon = (iconName?: string) => {
  const iconProps = { className: "h-3.5 w-3.5" };
  switch (iconName) {
    case 'Star': return <Star {...iconProps} />;
    case 'ThumbsDown': return <ThumbsDown {...iconProps} />;
    case 'ShoppingCart': return <ShoppingCart {...iconProps} />;
    case 'ThumbsUp': return <ThumbsUp {...iconProps} />;
    case 'Eye': return <Eye {...iconProps} />;
    case 'TrendingUp': return <TrendingUp {...iconProps} />;
    case 'AlertCircle': return <AlertCircle {...iconProps} />;
    case 'Trash2': return <Trash2 {...iconProps} />;
    default: return null;
  }
};

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SearchBar = React.memo<SearchBarProps>(({ onStockSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Stock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSearchQueryRef = useRef<string>(''); // 마지막 검색어 추적
  const { tags: availableTags } = useTags();
  const queryClient = useQueryClient();
  const [togglingTags, setTogglingTags] = useState<Map<number, Set<number>>>(new Map()); // Map<stockId, Set<tagId>>

  const MIN_SEARCH_LENGTH = 1; // 최소 검색 글자 수
  const DEBOUNCE_DELAY = 500; // 디바운싱 시간 (ms)

  // 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 검색 실행
  const performSearch = async (query: string) => {
    const trimmedQuery = query.trim();

    // 검색어가 비어있거나 최소 길이보다 짧으면 취소
    if (!trimmedQuery || trimmedQuery.length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      setShowResults(false);
      lastSearchQueryRef.current = '';
      return;
    }

    // 이전 검색어와 동일하면 API 호출 생략
    if (trimmedQuery === lastSearchQueryRef.current) {
      return;
    }

    setIsSearching(true);
    try {
      const response = await stockApi.searchStocks({
        q: trimmedQuery,
        limit: 10,
      });
      setSearchResults(response.stocks);
      setShowResults(true);
      setSelectedIndex(-1);
      lastSearchQueryRef.current = trimmedQuery;
    } catch (error) {
      console.error('Search error:', error);
      toast.error('검색 중 오류가 발생했습니다.');
      setSearchResults([]);
      lastSearchQueryRef.current = '';
    } finally {
      setIsSearching(false);
    }
  };

  // 디바운싱 처리
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmedQuery = searchQuery.trim();

    // 검색어가 비어있으면 결과 초기화
    if (trimmedQuery.length === 0) {
      setSearchResults([]);
      setShowResults(false);
      lastSearchQueryRef.current = '';
      return;
    }

    // 최소 길이 미만이면 검색 안 함
    if (trimmedQuery.length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, DEBOUNCE_DELAY);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  // 키보드 네비게이션
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults || searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < searchResults.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
          const stock = searchResults[selectedIndex];
          handleOpenChart(e as any, stock);
          setSearchQuery('');
          setShowResults(false);
          setSearchResults([]);
          setSelectedIndex(-1);
        }
        break;
      case 'Escape':
        setShowResults(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // 종목 선택
  const handleStockSelect = (stock: Stock) => {
    setSearchQuery('');
    setShowResults(false);
    setSearchResults([]);
    setSelectedIndex(-1);
    onStockSelect?.(stock);
  };

  // 검색 초기화
  const handleClear = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    setSelectedIndex(-1);
    lastSearchQueryRef.current = '';
    inputRef.current?.focus();
  }, []);

  // 태그 토글 핸들러
  const handleToggleTag = async (e: React.MouseEvent, stock: Stock, tag: Tag) => {
    e.stopPropagation();

    // Check if this tag is already being toggled for this stock
    const stockTogglingTags = togglingTags.get(stock.id);
    if (stockTogglingTags?.has(tag.id)) {
      return;
    }

    const hasTag = stock.tags?.some(t => t.id === tag.id) || false;

    // Add to toggling set
    setTogglingTags(prev => {
      const next = new Map(prev);
      const stockTags = next.get(stock.id) || new Set();
      stockTags.add(tag.id);
      next.set(stock.id, stockTags);
      return next;
    });

    try {
      if (hasTag) {
        await stockApi.removeTagFromStock(stock.id, tag.id);
        // Update local state
        setSearchResults(prev =>
          prev.map(s =>
            s.id === stock.id
              ? { ...s, tags: s.tags?.filter(t => t.id !== tag.id) || [] }
              : s
          )
        );
        queryClient.invalidateQueries({ queryKey: ['stocks'] });
        toast.success(`${tag.display_name} 태그 제거 완료!`);
      } else {
        await stockApi.addTagToStock(stock.id, tag.id);
        // Update local state
        setSearchResults(prev =>
          prev.map(s =>
            s.id === stock.id
              ? { ...s, tags: [...(s.tags || []), tag] }
              : s
          )
        );
        queryClient.invalidateQueries({ queryKey: ['stocks'] });
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
        const next = new Map(prev);
        const stockTags = next.get(stock.id);
        if (stockTags) {
          stockTags.delete(tag.id);
          if (stockTags.size === 0) {
            next.delete(stock.id);
          } else {
            next.set(stock.id, stockTags);
          }
        }
        return next;
      });
    }
  };

  // 네이버 차트 열기
  const handleOpenChart = useCallback((e: React.MouseEvent, stock: Stock) => {
    e.stopPropagation();
    window.open(getNaverChartUrl(stock), '_blank');
  }, []);

  // 검색어 하이라이트 처리 (useMemo로 캐싱)
  const highlightMatch = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return (text: string) => text;

    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return (text: string) => {
      const parts = text.split(regex);
      return parts.map((part, index) =>
        regex.test(part) ? (
          <mark key={index} className="bg-yellow-300/80 dark:bg-yellow-500/50 text-foreground px-0.5 rounded-sm">
            {part}
          </mark>
        ) : (
          part
        )
      );
    };
  }, [searchQuery]);

  return (
    <div ref={searchRef} className="relative w-full max-w-2xl">
      {/* 검색 입력창 */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (searchResults.length > 0) {
              setShowResults(true);
            }
          }}
          placeholder="종목명 또는 심볼 검색..."
          className="pl-12 pr-12 h-12"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        {isSearching && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* 검색 결과 드롭다운 */}
      {showResults && searchResults.length > 0 && (
        <Card className="absolute z-50 w-full mt-2 shadow-lg max-h-[600px] overflow-y-auto">
          {searchResults.map((stock, index) => {
            const stockTogglingTags = togglingTags.get(stock.id) || new Set();
            return (
              <div
                key={stock.id}
                className={cn(
                  "px-4 py-3 border-b border-border/50 last:border-b-0 transition-colors",
                  index === selectedIndex ? "bg-accent" : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* 종목명 & 심볼 & 차트 버튼 */}
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={(e) => handleOpenChart(e, stock)}
                        className="font-semibold text-foreground hover:text-primary hover:underline cursor-pointer transition-colors text-left truncate"
                      >
                        {highlightMatch(stock.name)}
                      </button>
                      <span className="text-sm text-muted-foreground font-mono flex-shrink-0">
                        {highlightMatch(stock.symbol)}
                      </span>
                      <button
                        onClick={(e) => handleOpenChart(e, stock)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border border-border text-muted-foreground hover:text-foreground cursor-pointer transition-colors flex-shrink-0"
                        title="차트 보기"
                      >
                        <BarChart3 className="h-3 w-3" />
                        차트
                      </button>
                    </div>

                    {/* 거래소 & 시가총액 */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <Badge variant="secondary" className="font-medium">
                        {stock.exchange || stock.market}
                      </Badge>
                      {stock.market_cap && (
                        <span className="font-mono">
                          시총 {formatMarketCap(stock.market_cap)}
                        </span>
                      )}
                      {stock.sector && (
                        <span className="truncate max-w-[200px]">
                          {stock.sector}
                        </span>
                      )}
                    </div>

                    {/* 태그 버튼 */}
                    {availableTags.length > 0 && (
                      <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                        {availableTags.map((tag) => {
                          const hasTag = stock.tags?.some(t => t.id === tag.id) || false;
                          const isToggling = stockTogglingTags.has(tag.id);
                          return (
                            <button
                              key={tag.id}
                              onClick={(e) => handleToggleTag(e, stock, tag)}
                              disabled={isToggling}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap flex-shrink-0 ${getTagColorClass(tag.color, hasTag)}`}
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
                  </div>

                  {/* 가격 정보 */}
                  <div className="flex flex-col items-end ml-4 flex-shrink-0">
                    {stock.current_price && (
                      <span className="font-mono font-semibold text-foreground">
                        ${stock.current_price.toLocaleString()}
                      </span>
                    )}
                    {stock.change_percent !== undefined && (
                      <div className={`flex items-center gap-1 text-sm font-semibold ${getChangeColor(stock.change_percent)}`}>
                        {stock.change_percent > 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : stock.change_percent < 0 ? (
                          <TrendingDown className="h-3 w-3" />
                        ) : null}
                        <span className="font-mono">
                          {formatChange(stock.change_percent)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {/* 검색 결과 없음 */}
      {showResults && !isSearching && searchQuery && searchResults.length === 0 && (
        <Card className="absolute z-50 w-full mt-2 shadow-lg px-4 py-8 text-center">
          <p className="text-muted-foreground">
            '<span className="font-semibold">{searchQuery}</span>' 검색 결과가 없습니다.
          </p>
        </Card>
      )}
    </div>
  );
});

SearchBar.displayName = 'SearchBar';

export default SearchBar;
