'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export type SortField = 'market_cap' | 'change_percent';
export type SortDirection = 'asc' | 'desc';

interface SortOption {
  id: SortField;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { id: 'market_cap', label: '시가총액순' },
  { id: 'change_percent', label: '등락률순' },
];

interface SortDropdownProps {
  sortField: SortField;
  sortDirection: SortDirection;
  onSortChange: (field: SortField, direction: SortDirection) => void;
}

export default function SortDropdown({
  sortField,
  sortDirection,
  onSortChange,
}: SortDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫힘 처리
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentOption = SORT_OPTIONS.find((opt) => opt.id === sortField);

  const handleOptionSelect = (option: SortOption) => {
    onSortChange(option.id, sortDirection);
    setIsOpen(false);
  };

  const handleDirectionToggle = () => {
    onSortChange(sortField, sortDirection === 'desc' ? 'asc' : 'desc');
  };

  return (
    <div className="flex items-center gap-1" ref={dropdownRef}>
      {/* 드롭다운 버튼 */}
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg border border-border transition-colors cursor-pointer"
        >
          <span>{currentOption?.label}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* 드롭다운 메뉴 */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-32 bg-popover border border-border rounded-lg shadow-lg z-50">
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => handleOptionSelect(option)}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors first:rounded-t-lg last:rounded-b-lg cursor-pointer ${
                  option.id === sortField
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 방향 토글 버튼 */}
      <button
        onClick={handleDirectionToggle}
        className="inline-flex items-center justify-center w-8 h-8 text-foreground bg-muted hover:bg-muted/80 rounded-lg border border-border transition-colors cursor-pointer"
        title={sortDirection === 'desc' ? '내림차순 (높은 값 먼저)' : '오름차순 (낮은 값 먼저)'}
      >
        {sortDirection === 'desc' ? (
          <ArrowDown className="h-4 w-4" />
        ) : (
          <ArrowUp className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
