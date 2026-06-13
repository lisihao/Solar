'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  Stethoscope,
  ChevronDown,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type {
  TableCategory,
  HealthStatus,
  TableListQuery,
} from '@/hooks/domain';

// Category options with labels
const CATEGORY_OPTIONS: { value: TableCategory; labelKey: string }[] = [
  { value: 'USER', labelKey: 'admin.tables.categories.USER' },
  { value: 'RESOURCE', labelKey: 'admin.tables.categories.RESOURCE' },
  { value: 'AI_SESSION', labelKey: 'admin.tables.categories.AI_SESSION' },
  { value: 'AI_CONFIG', labelKey: 'admin.tables.categories.AI_CONFIG' },
  { value: 'KNOWLEDGE', labelKey: 'admin.tables.categories.KNOWLEDGE' },
  { value: 'RESEARCH', labelKey: 'admin.tables.categories.RESEARCH' },
  { value: 'OFFICE', labelKey: 'admin.tables.categories.OFFICE' },
  { value: 'INGESTION', labelKey: 'admin.tables.categories.INGESTION' },
  { value: 'NOTIFICATION', labelKey: 'admin.tables.categories.NOTIFICATION' },
  { value: 'LOG', labelKey: 'admin.tables.categories.LOG' },
  { value: 'SYSTEM', labelKey: 'admin.tables.categories.SYSTEM' },
  { value: 'ANALYTICS', labelKey: 'admin.tables.categories.ANALYTICS' },
  { value: 'EXTERNAL', labelKey: 'admin.tables.categories.EXTERNAL' },
  { value: 'CACHE', labelKey: 'admin.tables.categories.CACHE' },
  { value: 'OTHER', labelKey: 'admin.tables.categories.OTHER' },
];

// Health status options
const HEALTH_OPTIONS: {
  value: HealthStatus;
  labelKey: string;
  color: string;
}[] = [
  {
    value: 'healthy',
    labelKey: 'admin.tables.health.healthy',
    color: 'bg-emerald-100 text-emerald-700',
  },
  {
    value: 'warning',
    labelKey: 'admin.tables.health.warning',
    color: 'bg-amber-100 text-amber-700',
  },
  {
    value: 'critical',
    labelKey: 'admin.tables.health.critical',
    color: 'bg-red-100 text-red-700',
  },
];

interface TableToolbarProps {
  query: TableListQuery;
  onSearchChange: (search: string) => void;
  onCategoryChange: (category: TableCategory | undefined) => void;
  onHealthStatusChange: (status: HealthStatus | undefined) => void;
  onRefresh: () => void;
  onBatchDiagnose: () => void;
  loading?: boolean;
  diagnosing?: boolean;
}

export default function TableToolbar({
  query,
  onSearchChange,
  onCategoryChange,
  onHealthStatusChange,
  onRefresh,
  onBatchDiagnose,
  loading,
  diagnosing,
}: TableToolbarProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState(query.search || '');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showHealthDropdown, setShowHealthDropdown] = useState(false);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== query.search) {
        onSearchChange(searchInput);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, query.search, onSearchChange]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.category-dropdown')) {
        setShowCategoryDropdown(false);
      }
      if (!target.closest('.health-dropdown')) {
        setShowHealthDropdown(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const selectedCategory = CATEGORY_OPTIONS.find(
    (c) => c.value === query.category
  );
  const selectedHealth = HEALTH_OPTIONS.find(
    (h) => h.value === query.healthStatus
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search Input */}
      <div className="relative min-w-[200px] max-w-md flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('admin.tables.search.placeholder')}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {/* Category Filter */}
      <div className="category-dropdown relative">
        <button
          onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Filter className="h-4 w-4 text-gray-400" />
          {selectedCategory
            ? t(selectedCategory.labelKey)
            : t('admin.tables.filter.category')}
          <ChevronDown className="h-4 w-4 text-gray-400" />
        </button>

        {showCategoryDropdown && (
          <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
                onCategoryChange(undefined);
                setShowCategoryDropdown(false);
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              {t('admin.tables.filter.allCategories')}
            </button>
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onCategoryChange(option.value);
                  setShowCategoryDropdown(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                  query.category === option.value
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-gray-700'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Health Status Filter */}
      <div className="health-dropdown relative">
        <button
          onClick={() => setShowHealthDropdown(!showHealthDropdown)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            selectedHealth
              ? `${selectedHealth.color} border-transparent`
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {selectedHealth
            ? t(selectedHealth.labelKey)
            : t('admin.tables.filter.health')}
          <ChevronDown className="h-4 w-4" />
        </button>

        {showHealthDropdown && (
          <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
                onHealthStatusChange(undefined);
                setShowHealthDropdown(false);
              }}
              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              {t('admin.tables.filter.allStatus')}
            </button>
            {HEALTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onHealthStatusChange(option.value);
                  setShowHealthDropdown(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${option.color}`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Action Buttons */}
      <button
        onClick={onBatchDiagnose}
        disabled={diagnosing}
        className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Stethoscope
          className={`h-4 w-4 ${diagnosing ? 'animate-pulse' : ''}`}
        />
        {t('admin.tables.actions.diagnoseAll')}
      </button>

      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {t('admin.tables.actions.refresh')}
      </button>
    </div>
  );
}
