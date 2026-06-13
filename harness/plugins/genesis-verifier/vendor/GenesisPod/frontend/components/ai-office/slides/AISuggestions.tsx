'use client';

/**
 * AI Slides V5.0 - AI Suggestions
 *
 * Displays smart suggestions based on current presentation:
 * - Add data visualizations
 * - Create executive summary
 * - Add trend charts
 */

import React, { useState, useCallback } from 'react';
import {
  Lightbulb,
  BarChart3,
  FileText,
  TrendingUp,
  Sparkles,
  ChevronRight,
  Loader2,
  Layout,
  Image,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface Suggestion {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  action: string;
}

interface AISuggestionsProps {
  suggestions?: Suggestion[];
  onExecute?: (suggestion: Suggestion) => Promise<void>;
  className?: string;
  disabled?: boolean;
}

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  {
    id: 'add-charts',
    icon: BarChart3,
    title: '为数据页添加可视化图表',
    description: '自动识别数据并生成图表',
    action: 'add-charts',
  },
  {
    id: 'executive-summary',
    icon: FileText,
    title: '创建高管精简版',
    description: '提取核心内容生成摘要版',
    action: 'create-summary',
  },
  {
    id: 'add-trends',
    icon: TrendingUp,
    title: '添加趋势分析图',
    description: '基于数据生成趋势预测',
    action: 'add-trends',
  },
  {
    id: 'optimize-layout',
    icon: Layout,
    title: '优化页面布局',
    description: '自动调整间距和对齐',
    action: 'optimize-layout',
  },
  {
    id: 'add-images',
    icon: Image,
    title: '添加相关配图',
    description: '为内容配置合适的图片',
    action: 'add-images',
  },
];

export function AISuggestions({
  suggestions = DEFAULT_SUGGESTIONS,
  onExecute,
  className,
  disabled = false,
}: AISuggestionsProps) {
  const [executingId, setExecutingId] = useState<string | null>(null);

  const handleExecute = useCallback(
    async (suggestion: Suggestion) => {
      if (!onExecute || disabled || executingId) return;

      setExecutingId(suggestion.id);
      try {
        await onExecute(suggestion);
      } finally {
        setExecutingId(null);
      }
    },
    [onExecute, disabled, executingId]
  );

  // Only show first 3 suggestions
  const displaySuggestions = suggestions.slice(0, 3);

  return (
    <div
      className={cn('rounded-lg border border-slate-200 bg-white', className)}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium text-slate-700">智能建议</span>
      </div>

      <div className="p-2">
        {displaySuggestions.map((suggestion) => {
          const Icon = suggestion.icon;
          const isExecuting = executingId === suggestion.id;

          return (
            <button
              key={suggestion.id}
              onClick={() => handleExecute(suggestion)}
              disabled={disabled || isExecuting || executingId !== null}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-all',
                disabled || executingId !== null
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:bg-orange-50'
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                  isExecuting ? 'bg-orange-100' : 'bg-slate-100'
                )}
              >
                {isExecuting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
                ) : (
                  <Icon className="h-4 w-4 text-slate-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-800">
                  {suggestion.title}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default AISuggestions;
