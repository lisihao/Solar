'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import {
  DateRangePicker,
  DateRange,
} from '@/components/ui/primitives/DateRangePicker';
import type {
  SocialContentType,
  SocialContentSourceType,
  SocialReviewStatus,
} from '@/hooks/domain/useAISocial';

export interface AdvancedFilterValues {
  dateRange: DateRange;
  contentType: SocialContentType | 'ALL';
  sourceType: SocialContentSourceType | 'ALL';
  reviewStatus: SocialReviewStatus | 'ALL';
  hasConnection: boolean | null;
}

interface AdvancedFiltersProps {
  filters: AdvancedFilterValues;
  onChange: (filters: AdvancedFilterValues) => void;
  className?: string;
}

const CONTENT_TYPES: (SocialContentType | 'ALL')[] = [
  'ALL',
  'WECHAT_ARTICLE',
  'XIAOHONGSHU_NOTE',
];

const SOURCE_TYPES: (SocialContentSourceType | 'ALL')[] = [
  'ALL',
  'MANUAL',
  'EXTERNAL_URL',
  'AI_EXPLORE',
  'AI_RESEARCH',
  'AI_OFFICE',
  'AI_WRITING',
];

const REVIEW_STATUSES: (SocialReviewStatus | 'ALL')[] = [
  'ALL',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'REVISION_REQUESTED',
];

export function AdvancedFilters({
  filters,
  onChange,
  className = '',
}: AdvancedFiltersProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDateRangeChange = useCallback(
    (dateRange: DateRange) => {
      onChange({ ...filters, dateRange });
    },
    [filters, onChange]
  );

  const handleContentTypeChange = useCallback(
    (contentType: SocialContentType | 'ALL') => {
      onChange({ ...filters, contentType });
    },
    [filters, onChange]
  );

  const handleSourceTypeChange = useCallback(
    (sourceType: SocialContentSourceType | 'ALL') => {
      onChange({ ...filters, sourceType });
    },
    [filters, onChange]
  );

  const handleReviewStatusChange = useCallback(
    (reviewStatus: SocialReviewStatus | 'ALL') => {
      onChange({ ...filters, reviewStatus });
    },
    [filters, onChange]
  );

  const handleConnectionFilterChange = useCallback(
    (hasConnection: boolean | null) => {
      onChange({ ...filters, hasConnection });
    },
    [filters, onChange]
  );

  const handleClearAll = useCallback(() => {
    onChange({
      dateRange: { from: null, to: null },
      contentType: 'ALL',
      sourceType: 'ALL',
      reviewStatus: 'ALL',
      hasConnection: null,
    });
  }, [onChange]);

  // Check if any filters are active
  const hasActiveFilters =
    filters.dateRange.from ||
    filters.dateRange.to ||
    filters.contentType !== 'ALL' ||
    filters.sourceType !== 'ALL' ||
    filters.reviewStatus !== 'ALL' ||
    filters.hasConnection !== null;

  // Count active filters
  const activeFilterCount = [
    filters.dateRange.from || filters.dateRange.to ? 1 : 0,
    filters.contentType !== 'ALL' ? 1 : 0,
    filters.sourceType !== 'ALL' ? 1 : 0,
    filters.reviewStatus !== 'ALL' ? 1 : 0,
    filters.hasConnection !== null ? 1 : 0,
  ].reduce((sum, val) => sum + val, 0);

  return (
    <div className={`rounded-lg border border-gray-200 bg-white ${className}`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">
            {t('aiSocial.filters.advancedFilters')}
          </span>
          {activeFilterCount > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-xs font-medium text-rose-600">
              {activeFilterCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClearAll();
              }}
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              {t('aiSocial.filters.clearAll')}
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Filter Content */}
      {isExpanded && (
        <div className="space-y-4 border-t border-gray-200 px-4 py-4">
          {/* Date Range */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('aiSocial.filters.dateRange')}
            </label>
            <DateRangePicker
              value={filters.dateRange}
              onChange={handleDateRangeChange}
            />
          </div>

          {/* Content Type */}
          <div>
            <label
              htmlFor="filter-content-type"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t('aiSocial.filters.contentType')}
            </label>
            <select
              id="filter-content-type"
              value={filters.contentType}
              onChange={(e) =>
                handleContentTypeChange(
                  e.target.value as SocialContentType | 'ALL'
                )
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              {CONTENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'ALL'
                    ? t('common.all')
                    : t(`aiSocial.contentTypes.${type.toLowerCase()}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Source Type */}
          <div>
            <label
              htmlFor="filter-source-type"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t('aiSocial.filters.sourceType')}
            </label>
            <select
              id="filter-source-type"
              value={filters.sourceType}
              onChange={(e) =>
                handleSourceTypeChange(
                  e.target.value as SocialContentSourceType | 'ALL'
                )
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'ALL'
                    ? t('common.all')
                    : t(`aiSocial.sources.${type.toLowerCase()}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Review Status */}
          <div>
            <label
              htmlFor="filter-review-status"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              {t('aiSocial.filters.reviewStatus')}
            </label>
            <select
              id="filter-review-status"
              value={filters.reviewStatus}
              onChange={(e) =>
                handleReviewStatusChange(
                  e.target.value as SocialReviewStatus | 'ALL'
                )
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
            >
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status === 'ALL'
                    ? t('common.all')
                    : t(`aiSocial.reviewStatus.${status.toLowerCase()}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Platform Connection */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('aiSocial.filters.platformConnection')}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleConnectionFilterChange(null)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                  filters.hasConnection === null
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-gray-200 text-gray-700 hover:border-rose-300 hover:bg-rose-50'
                }`}
              >
                {t('common.all')}
              </button>
              <button
                type="button"
                onClick={() => handleConnectionFilterChange(true)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                  filters.hasConnection === true
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-gray-200 text-gray-700 hover:border-rose-300 hover:bg-rose-50'
                }`}
              >
                {t('aiSocial.filters.withConnection')}
              </button>
              <button
                type="button"
                onClick={() => handleConnectionFilterChange(false)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
                  filters.hasConnection === false
                    ? 'border-rose-500 bg-rose-50 text-rose-700'
                    : 'border-gray-200 text-gray-700 hover:border-rose-300 hover:bg-rose-50'
                }`}
              >
                {t('aiSocial.filters.withoutConnection')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Filters Tags (when collapsed) */}
      {!isExpanded && hasActiveFilters && (
        <div className="flex flex-wrap gap-2 border-t border-gray-200 px-4 py-3">
          {(filters.dateRange.from || filters.dateRange.to) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
              {t('aiSocial.filters.dateRange')}:{' '}
              {filters.dateRange.from || '...'} ~{' '}
              {filters.dateRange.to || '...'}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDateRangeChange({ from: null, to: null });
                }}
                className="rounded-full hover:bg-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filters.contentType !== 'ALL' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
              {t(`aiSocial.contentTypes.${filters.contentType.toLowerCase()}`)}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContentTypeChange('ALL');
                }}
                className="rounded-full hover:bg-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filters.sourceType !== 'ALL' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
              {t(`aiSocial.sources.${filters.sourceType.toLowerCase()}`)}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSourceTypeChange('ALL');
                }}
                className="rounded-full hover:bg-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filters.reviewStatus !== 'ALL' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
              {t(`aiSocial.reviewStatus.${filters.reviewStatus.toLowerCase()}`)}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReviewStatusChange('ALL');
                }}
                className="rounded-full hover:bg-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {filters.hasConnection !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700">
              {filters.hasConnection
                ? t('aiSocial.filters.withConnection')
                : t('aiSocial.filters.withoutConnection')}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleConnectionFilterChange(null);
                }}
                className="rounded-full hover:bg-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
