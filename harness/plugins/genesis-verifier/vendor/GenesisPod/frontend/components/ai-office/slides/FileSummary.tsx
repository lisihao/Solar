'use client';

/**
 * AI Slides V5.0 - File Summary
 *
 * Displays presentation file information:
 * - Page count
 * - File size
 * - Format
 */

import React, { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface FileSummaryProps {
  pageCount: number;
  fileSize?: string;
  format?: string;
  className?: string;
  collapsible?: boolean;
}

export function FileSummary({
  pageCount,
  fileSize = '—',
  format = 'PPTX',
  className,
  collapsible = true,
}: FileSummaryProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Calculate estimated file size based on page count if not provided
  const displaySize =
    fileSize !== '—' ? fileSize : `~${(pageCount * 0.05).toFixed(1)} MB`;

  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white transition-all',
        className
      )}
    >
      <button
        onClick={() => collapsible && setCollapsed(!collapsed)}
        className={cn(
          'flex w-full items-center justify-between p-3',
          collapsible && 'cursor-pointer hover:bg-slate-50'
        )}
        disabled={!collapsible}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100">
            <FileText className="h-5 w-5 text-orange-600" />
          </div>
          <div className="text-left">
            <div className="text-lg font-semibold text-slate-900">
              {pageCount} 页
            </div>
            {!collapsed && (
              <div className="text-sm text-slate-500">
                {displaySize} • {format}
              </div>
            )}
          </div>
        </div>
        {collapsible &&
          (collapsed ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ))}
      </button>
    </div>
  );
}

export default FileSummary;
