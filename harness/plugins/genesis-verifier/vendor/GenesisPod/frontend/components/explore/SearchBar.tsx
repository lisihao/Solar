'use client';

import React, { useRef } from 'react';
import type { SearchSuggestion } from './utils/types';
import { useI18n } from '@/lib/i18n/i18n-context';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearch: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  showSuggestions: boolean;
  searchSuggestions: SearchSuggestion[];
  selectedSuggestionIndex: number;
  onSuggestionClick: (suggestion: SearchSuggestion) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  acceptedFileTypes?: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  onSearch,
  onFocus,
  showSuggestions,
  searchSuggestions,
  selectedSuggestionIndex,
  onSuggestionClick,
  fileInputRef,
  acceptedFileTypes = '*',
  onFileChange,
}: SearchBarProps) {
  const { t } = useI18n();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  return (
    <div className="mb-4">
      <div className="relative rounded-lg border border-gray-300 bg-white shadow-sm">
        <div className="flex items-center">
          {/* Search Icon */}
          <div className="flex items-center px-4 py-3">
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Search Input */}
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('explore.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearch}
            onFocus={onFocus}
            className="flex-1 border-none px-4 py-3 text-sm focus:outline-none focus:ring-0"
          />

          {/* Action Buttons */}
          <div className="flex items-center gap-2 px-4">
            {/* File Upload Button */}
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedFileTypes}
              onChange={onFileChange}
              className="hidden"
            />
          </div>
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
                onClick={() => onSuggestionClick(suggestion)}
                className={`cursor-pointer border-b border-gray-100 px-4 py-3 transition-colors last:border-b-0 ${
                  index === selectedSuggestionIndex
                    ? 'border-l-4 border-l-red-500 bg-red-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Type Icon */}
                  <div className="mt-1 flex-shrink-0">
                    {suggestion.type === 'PAPER' && (
                      <svg
                        className="h-5 w-5 text-blue-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    )}
                    {suggestion.type === 'BLOG' && (
                      <svg
                        className="h-5 w-5 text-green-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                    )}
                    {suggestion.type === 'REPORT' && (
                      <svg
                        className="h-5 w-5 text-purple-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    )}
                    {(suggestion.type === 'YOUTUBE' ||
                      suggestion.type === 'YOUTUBE_VIDEO') && (
                      <svg
                        className="h-5 w-5 text-red-500"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                    )}
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
  );
}
