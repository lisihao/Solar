'use client';

import { Resource } from '../utils/types';
import { ThumbsUp } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/i18n-context';
import { ClientDate } from '@/components/common/ClientDate';

interface ResourceHeaderProps {
  selectedResource: Resource;
  htmlViewMode: 'reader' | 'original';
  setHtmlViewMode: (mode: 'reader' | 'original') => void;
  isHeaderCollapsed: boolean;
  setIsHeaderCollapsed: (collapsed: boolean) => void;
  onBackToList: () => void;
  onToggleBookmark: (resourceId: string, e?: React.MouseEvent) => void;
  onToggleUpvote: (resourceId: string, e: React.MouseEvent) => void;
  isBookmarked: (resourceId: string) => boolean;
  hasUpvoted: (resourceId: string) => boolean;
}

export default function ResourceHeader({
  selectedResource,
  htmlViewMode,
  setHtmlViewMode,
  isHeaderCollapsed,
  setIsHeaderCollapsed,
  onBackToList,
  onToggleBookmark,
  onToggleUpvote,
  isBookmarked,
  hasUpvoted,
}: ResourceHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-shrink-0 border-b border-gray-200 bg-white">
      {/* Top Toolbar */}
      <div className="flex h-12 items-center justify-between px-4">
        {/* Left: Back button + Breadcrumb */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToList}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title={t('explore.header.backToList') || 'Back to list'}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          {/* Breadcrumb Navigation */}
          <nav className="flex items-center text-sm">
            <span className="text-gray-400">
              {selectedResource.type === 'POLICY'
                ? t('explore.tabs.policy') || 'Policy'
                : selectedResource.type === 'PAPER'
                  ? t('explore.tabs.papers') || 'Papers'
                  : selectedResource.type}
            </span>
            <svg
              className="mx-2 h-4 w-4 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span
              className="max-w-[300px] truncate font-medium text-gray-700"
              title={selectedResource.title}
            >
              {selectedResource.title.length > 40
                ? selectedResource.title.substring(0, 40) + '...'
                : selectedResource.title}
            </span>
          </nav>
        </div>

        {/* Right: View toggle + Actions */}
        <div className="flex items-center gap-2">
          {/* View Mode Toggle - Only show for non-PDF/YouTube resources */}
          {selectedResource.type !== 'PAPER' &&
            selectedResource.type !== 'YOUTUBE' &&
            selectedResource.type !== 'YOUTUBE_VIDEO' &&
            selectedResource.sourceUrl && (
              <div className="flex h-8 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5">
                <button
                  onClick={() => setHtmlViewMode('reader')}
                  className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-all ${
                    htmlViewMode === 'reader'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                  </svg>
                  {t('explore.view.reader') || 'Reader'}
                </button>
                <button
                  onClick={() => setHtmlViewMode('original')}
                  className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-all ${
                    htmlViewMode === 'original'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                    />
                  </svg>
                  {t('explore.view.original') || 'Original'}
                </button>
              </div>
            )}

          {/* Expand/Collapse Info Button */}
          <button
            onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
            className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
              isHeaderCollapsed
                ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                : 'bg-gray-100 text-gray-700'
            }`}
            title={
              isHeaderCollapsed
                ? t('explore.header.showDetails') || 'Show details'
                : t('explore.header.hideDetails') || 'Hide details'
            }
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {t('explore.view.info') || 'Info'}
          </button>
        </div>
      </div>

      {/* Expanded Content - Metadata Panel */}
      {!isHeaderCollapsed && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Metadata */}
            <div className="flex items-center gap-4 text-sm text-gray-500">
              {/* Date */}
              <span className="flex items-center gap-1.5">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <ClientDate
                  date={selectedResource.publishedAt}
                  format="date"
                  locale="en-US"
                  dateOptions={{
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  }}
                />
              </span>

              {/* Categories */}
              {selectedResource.categories &&
                selectedResource.categories.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {selectedResource.categories.slice(0, 2).map((cat, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-gray-200/80 px-2 py-0.5 text-xs font-medium text-gray-600"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

              {/* Authors */}
              {selectedResource.authors &&
                selectedResource.authors.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    {selectedResource.authors
                      .slice(0, 2)
                      .map(
                        (a) =>
                          a.name ||
                          a.username ||
                          t('explore.card.unknown') ||
                          'Unknown'
                      )
                      .join(', ')}
                  </span>
                )}

              {/* View Count */}
              {selectedResource.viewCount !== undefined && (
                <span className="flex items-center gap-1">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                  {selectedResource.viewCount}
                </span>
              )}
            </div>

            {/* Right: Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Upvote */}
              {selectedResource.upvoteCount !== undefined && (
                <button
                  onClick={(e) => onToggleUpvote(selectedResource.id, e)}
                  className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                    hasUpvoted(selectedResource.id)
                      ? 'bg-blue-100 font-medium text-blue-600'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <ThumbsUp
                    className={`h-4 w-4 ${hasUpvoted(selectedResource.id) ? 'fill-current' : ''}`}
                  />
                  {selectedResource.upvoteCount}
                </button>
              )}

              {/* Bookmark */}
              <button
                onClick={() => onToggleBookmark(selectedResource.id)}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                  isBookmarked(selectedResource.id)
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill={
                    isBookmarked(selectedResource.id) ? 'currentColor' : 'none'
                  }
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                  />
                </svg>
                {t('explore.header.save') || 'Save'}
              </button>

              {/* External Link */}
              <a
                href={selectedResource.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm text-gray-600 transition-colors hover:bg-gray-100"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                {t('explore.header.open') || 'Open'}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
