'use client';

/**
 * AI Slides V5.0 - Page Navigator
 *
 * Simple page navigation with arrows:
 * ◀  4 / 46  ▶
 */

import React, { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface PageNavigatorProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  enableKeyboard?: boolean;
}

export function PageNavigator({
  currentPage,
  totalPages,
  onPageChange,
  className,
  enableKeyboard = true,
}: PageNavigatorProps) {
  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const goToPrev = useCallback(() => {
    if (canGoPrev) {
      onPageChange(currentPage - 1);
    }
  }, [canGoPrev, currentPage, onPageChange]);

  const goToNext = useCallback(() => {
    if (canGoNext) {
      onPageChange(currentPage + 1);
    }
  }, [canGoNext, currentPage, onPageChange]);

  // Keyboard navigation
  useEffect(() => {
    if (!enableKeyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboard, goToPrev, goToNext]);

  if (totalPages === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center justify-center gap-4', className)}>
      <button
        onClick={goToPrev}
        disabled={!canGoPrev}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-all',
          canGoPrev
            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            : 'cursor-not-allowed text-slate-300'
        )}
        title="上一页 (←)"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-1 text-sm">
        <span className="font-semibold text-slate-800">{currentPage}</span>
        <span className="text-slate-400">/</span>
        <span className="text-slate-500">{totalPages}</span>
      </div>

      <button
        onClick={goToNext}
        disabled={!canGoNext}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-all',
          canGoNext
            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            : 'cursor-not-allowed text-slate-300'
        )}
        title="下一页 (→)"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

export default PageNavigator;
