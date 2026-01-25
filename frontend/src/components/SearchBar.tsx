'use client';

import React, { useState, useEffect, useRef } from 'react';
import { stockApi, Stock } from '@/lib/api';
import { Search, X, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

interface SearchBarProps {
  onStockSelect?: (stock: Stock) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ onStockSelect }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Stock[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

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
    if (!query || query.trim().length === 0) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await stockApi.searchStocks({
        q: query.trim(),
        limit: 10,
      });
      setSearchResults(response.stocks);
      setShowResults(true);
      setSelectedIndex(-1);
    } catch (error) {
      console.error('Search error:', error);
      toast.error('검색 중 오류가 발생했습니다.');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // 디바운싱 처리
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (searchQuery.trim().length === 0) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300); // 300ms 디바운싱

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
          handleStockSelect(searchResults[selectedIndex]);
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
  const handleClear = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  // 가격 변동 포맷
  const formatChange = (changePercent?: number) => {
    if (!changePercent) return '';
    const sign = changePercent > 0 ? '+' : '';
    return `${sign}${changePercent.toFixed(2)}%`;
  };

  // 가격 변동 색상
  const getChangeColor = (changePercent?: number) => {
    if (!changePercent) return 'text-muted-foreground';
    if (changePercent > 0) return 'text-gain';
    if (changePercent < 0) return 'text-loss';
    return 'text-muted-foreground';
  };

  // 시가총액 포맷
  const formatMarketCap = (num?: number) => {
    if (!num) return '';
    if (num >= 1e12) return `${(num / 1e12).toFixed(0)}조`;
    if (num >= 1e8) return `${(num / 1e8).toFixed(0)}억`;
    return '';
  };

  return (
    <div ref={searchRef} className="relative w-full max-w-2xl">
      {/* 검색 입력창 */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <input
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
          className="w-full pl-12 pr-12 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        />
        {searchQuery && (
          <button
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        {isSearching && (
          <div className="absolute right-12 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          </div>
        )}
      </div>

      {/* 검색 결과 드롭다운 */}
      {showResults && searchResults.length > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-card border border-border rounded-lg shadow-2xl max-h-[500px] overflow-y-auto">
          {searchResults.map((stock, index) => (
            <div
              key={stock.id}
              onClick={() => handleStockSelect(stock)}
              className={`px-4 py-3 cursor-pointer border-b border-border/50 last:border-b-0 transition-colors ${
                index === selectedIndex
                  ? 'bg-primary/10'
                  : 'hover:bg-muted/50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  {/* 종목명 & 심볼 */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-foreground truncate">
                      {stock.name}
                    </span>
                    <span className="text-sm text-muted-foreground font-mono">
                      {stock.symbol}
                    </span>
                  </div>

                  {/* 거래소 & 시가총액 */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      stock.exchange === 'KOSPI'
                        ? 'bg-primary/10 text-primary'
                        : stock.exchange === 'KOSDAQ'
                        ? 'bg-gain/10 text-gain'
                        : 'bg-secondary/10 text-secondary-foreground'
                    }`}>
                      {stock.exchange || stock.market}
                    </span>
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
                </div>

                {/* 가격 정보 */}
                <div className="flex flex-col items-end ml-4">
                  {stock.current_price && (
                    <span className="font-mono font-semibold text-foreground">
                      {stock.current_price.toLocaleString()}
                      {stock.market === 'KR' ? '원' : '$'}
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
          ))}
        </div>
      )}

      {/* 검색 결과 없음 */}
      {showResults && !isSearching && searchQuery && searchResults.length === 0 && (
        <div className="absolute z-50 w-full mt-2 bg-card border border-border rounded-lg shadow-2xl px-4 py-8 text-center">
          <p className="text-muted-foreground">
            '<span className="font-semibold">{searchQuery}</span>' 검색 결과가 없습니다.
          </p>
        </div>
      )}
    </div>
  );
};

export default SearchBar;
