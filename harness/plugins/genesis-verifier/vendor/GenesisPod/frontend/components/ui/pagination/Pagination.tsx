'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/common';

/**
 * Pagination — 统一分页 primitive（上一页/下一页 + 页码 + 省略号）。
 * 受控：page(1-based) / pageCount / onPageChange。
 */
export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** 页码窗口半径（当前页两侧各显示几个），默认 1 */
  siblingCount?: number;
  className?: string;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  className,
}: PaginationProps) {
  if (pageCount <= 1) return null;

  const left = Math.max(2, page - siblingCount);
  const right = Math.min(pageCount - 1, page + siblingCount);
  const items: (number | 'ellipsis-l' | 'ellipsis-r')[] = [1];
  if (left > 2) items.push('ellipsis-l');
  items.push(...range(left, right));
  if (right < pageCount - 1) items.push('ellipsis-r');
  if (pageCount > 1) items.push(pageCount);

  const btn =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav
      className={cn('flex items-center gap-1', className)}
      aria-label="Pagination"
    >
      <button
        type="button"
        className={cn(btn, 'text-gray-600 hover:bg-gray-100')}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {items.map((it, idx) =>
        typeof it === 'number' ? (
          <button
            key={it}
            type="button"
            onClick={() => onPageChange(it)}
            aria-current={it === page ? 'page' : undefined}
            className={cn(
              btn,
              it === page
                ? 'bg-primary text-primary-foreground'
                : 'text-gray-700 hover:bg-gray-100'
            )}
          >
            {it}
          </button>
        ) : (
          <span key={`${it}-${idx}`} className="px-1 text-gray-400">
            …
          </span>
        )
      )}

      <button
        type="button"
        className={cn(btn, 'text-gray-600 hover:bg-gray-100')}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
