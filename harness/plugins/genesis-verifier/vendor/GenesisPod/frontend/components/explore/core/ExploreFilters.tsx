'use client';

import { useRef, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n/i18n-context';
import ResponsiveNav from '@/components/layout/ResponsiveNav';
import { useExplore } from './ExploreContext';
import type { SearchSuggestion } from '../utils/types';

export default function ExploreFilters() {
  const { t } = useI18n();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const {
    searchQuery,
    setSearchQuery,
    activeTab,
    setActiveTab,
    sortBy,
    setSortBy,
    showSuggestions,
    setShowSuggestions,
    searchSuggestions,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    fetchSearchSuggestions,
    handleSuggestionClick,
    setShowImportUrlDialog,
    setShowImportFileDialog,
    setShowFilterPanel,
    selectedCategories,
    selectedSources,
    dateRange,
    minQualityScore,
  } = useExplore();

  // Handle search input changes
  const handleSearchInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchQuery(value);

      if (value.length >= 2) {
        fetchSearchSuggestions(value);
      } else {
        setShowSuggestions(false);
      }
    },
    [setSearchQuery, fetchSearchSuggestions, setShowSuggestions]
  );

  // Handle keyboard navigation in search
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // Trigger search
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (showSuggestions && searchSuggestions.length > 0) {
          setSelectedSuggestionIndex((prev) =>
            prev < searchSuggestions.length - 1 ? prev + 1 : prev
          );
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (showSuggestions) {
          setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : -1));
        }
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
      }
    },
    [
      showSuggestions,
      searchSuggestions,
      setShowSuggestions,
      setSelectedSuggestionIndex,
    ]
  );

  // Handle focus on search input
  const handleSearchFocus = useCallback(() => {
    if (searchQuery.length >= 2) {
      setShowSuggestions(true);
    }
  }, [searchQuery, setShowSuggestions]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowSuggestions]);

  // Render suggestion type icon
  const renderSuggestionIcon = (type: string) => {
    const iconClass = 'h-5 w-5';
    const iconProps = {
      fill: 'none',
      stroke: 'currentColor',
      viewBox: '0 0 24 24',
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
      strokeWidth: 2,
    };

    const icons: Record<string, JSX.Element> = {
      PAPER: (
        <svg className={`${iconClass} text-blue-500`} {...iconProps}>
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      PROJECT: (
        <svg className={`${iconClass} text-green-500`} {...iconProps}>
          <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      ),
      NEWS: (
        <svg className={`${iconClass} text-orange-500`} {...iconProps}>
          <path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
      ),
      BLOG: (
        <svg className={`${iconClass} text-purple-500`} {...iconProps}>
          <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
      REPORT: (
        <svg className={`${iconClass} text-indigo-500`} {...iconProps}>
          <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      POLICY: (
        <svg className={`${iconClass} text-red-500`} {...iconProps}>
          <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      YOUTUBE_VIDEO: (
        <svg
          className={`${iconClass} text-red-600`}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      ),
    };

    return icons[type] || icons.PAPER;
  };

  const filterActive =
    selectedCategories.length > 0 ||
    selectedSources.length > 0 ||
    dateRange !== 'all' ||
    minQualityScore > 0;

  return (
    <div className="sticky top-0 z-10 bg-gray-50 pb-4 pt-6">
      <div className="mx-auto max-w-6xl px-8">
        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative rounded-lg border border-gray-300 bg-white shadow-sm">
            <div className="flex items-center">
              {/* Search Icon */}
              <div className="flex items-center px-4 py-3">
                <Search className="h-5 w-5 text-gray-400" />
              </div>

              {/* Search Input */}
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t('explore.searchPlaceholder')}
                value={searchQuery}
                onChange={handleSearchInput}
                onKeyDown={handleSearchKeyDown}
                onFocus={handleSearchFocus}
                className="flex-1 border-none px-4 py-3 text-sm focus:outline-none focus:ring-0"
              />
            </div>

            {/* Search Suggestions Dropdown */}
            {showSuggestions && searchSuggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute left-0 right-0 top-full z-20 mt-2 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
              >
                {searchSuggestions.map((suggestion, index) => (
                  <div
                    key={suggestion.id}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className={`cursor-pointer border-b border-gray-100 px-4 py-3 transition-colors last:border-b-0 ${
                      index === selectedSuggestionIndex
                        ? 'border-l-4 border-l-red-500 bg-red-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Type Icon */}
                      <div className="mt-1 flex-shrink-0">
                        {renderSuggestionIcon(suggestion.type)}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <h4 className="truncate text-sm font-medium text-gray-900">
                            {suggestion.title}
                          </h4>
                          <span className="flex-shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                            {suggestion.type.toLowerCase()}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-xs text-gray-600">
                          {suggestion.highlight}
                        </p>
                      </div>

                      {/* Arrow Icon */}
                      <div className="mt-1 flex-shrink-0">
                        <svg
                          className="h-4 w-4 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabs and Filters */}
        <ResponsiveNav
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onImportUrlClick={() => setShowImportUrlDialog(true)}
          onImportFileClick={() => setShowImportFileDialog(true)}
          onFilterClick={() => setShowFilterPanel(true)}
          filterActive={filterActive}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </div>
    </div>
  );
}
