'use client';

import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { useI18n } from '@/lib/i18n/i18n-context';

interface AIInsight {
  title: string;
  description: string;
  importance: 'high' | 'medium' | 'low';
}

interface InsightBadgeProps {
  insights: AIInsight[];
  maxVisible?: number;
  className?: string;
}

const importanceColors = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-blue-50 text-blue-700 border-blue-200',
};

const importanceDots = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
};

export function InsightBadge({
  insights,
  maxVisible = 2,
  className = '',
}: InsightBadgeProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (!insights || insights.length === 0) {
    return null;
  }

  const visibleInsights = expanded ? insights : insights.slice(0, maxVisible);
  const hasMore = insights.length > maxVisible;

  return (
    <div
      className={`mt-2 rounded-lg border border-purple-100 bg-gradient-to-r from-purple-50/50 to-indigo-50/50 p-2 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-purple-500" />
        <span className="text-xs font-medium text-purple-700">
          {t('explore.insights.title')}
        </span>
        <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-xs text-purple-600">
          {insights.length}
        </span>
      </div>

      {/* Insights List */}
      <div className="space-y-1">
        {visibleInsights.map((insight, index) => (
          <div
            key={index}
            className="flex items-start gap-2 rounded-md bg-white/60 px-2 py-1.5"
          >
            <span
              className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${importanceDots[insight.importance]}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-gray-800">
                {insight.title}
              </p>
              {expanded && (
                <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">
                  {insight.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Expand/Collapse Button */}
      {hasMore && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md py-1 text-xs text-purple-600 transition-colors hover:bg-purple-100/50"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              {t('explore.insights.showLess')}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              {t('explore.insights.showMore')} ({insights.length - maxVisible})
            </>
          )}
        </button>
      )}
    </div>
  );
}

// Compact inline version for tight spaces
export function InsightChip({ insights }: { insights: AIInsight[] }) {
  const { t } = useI18n();

  if (!insights || insights.length === 0) {
    return null;
  }

  const highCount = insights.filter((i) => i.importance === 'high').length;

  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs">
      <Lightbulb className="h-3 w-3 text-purple-500" />
      <span className="text-purple-700">
        {insights.length} {t('explore.insights.moreInsights')}
      </span>
      {highCount > 0 && (
        <span className="rounded-full bg-red-100 px-1.5 text-red-600">
          {highCount} {t('explore.insights.keyInsight')}
        </span>
      )}
    </div>
  );
}

export default InsightBadge;
