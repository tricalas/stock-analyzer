'use client';

import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  const currentOption = SORT_OPTIONS.find((opt) => opt.id === sortField);

  const handleOptionSelect = (option: SortOption) => {
    onSortChange(option.id, sortDirection);
  };

  const handleDirectionToggle = () => {
    onSortChange(sortField, sortDirection === 'desc' ? 'asc' : 'desc');
  };

  return (
    <div className="flex items-center gap-1">
      {/* 드롭다운 버튼 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <span>{currentOption?.label}</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {SORT_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onClick={() => handleOptionSelect(option)}
              className={option.id === sortField ? 'bg-accent' : ''}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 방향 토글 버튼 */}
      <Button
        variant="outline"
        size="icon"
        onClick={handleDirectionToggle}
        className="h-8 w-8"
        title={sortDirection === 'desc' ? '내림차순 (높은 값 먼저)' : '오름차순 (낮은 값 먼저)'}
      >
        {sortDirection === 'desc' ? (
          <ArrowDown className="h-4 w-4" />
        ) : (
          <ArrowUp className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
