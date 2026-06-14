'use client';

import { ArrowLeft, Calendar, User, Eye, Book, Globe } from 'lucide-react';
import PDFViewer from '@/components/ui/viewers/PDFViewer';
import HTMLViewer from '@/components/ui/viewers/HTMLViewer';
import ReaderView from '@/components/ui/viewers/ReaderView';
import { useExplore } from './ExploreContext';
import ExploreActions from './ExploreActions';
import { ClientDate } from '@/components/common/ClientDate';
import { getResourceDisplayMode } from '../utils';

export default function ExploreDetail() {
  const {
    selectedResource,
    handleBackToList,
    htmlViewMode,
    setHtmlViewMode,
    isHeaderCollapsed,
    setIsHeaderCollapsed,
    setArticleTextContent,
  } = useExplore();

  if (!selectedResource) {
    return null;
  }

  const displayMode = getResourceDisplayMode(selectedResource);
  const isPDF = displayMode === 'pdf';
  const isHTML = displayMode === 'html';

  return (
    <div className="flex h-full w-full flex-1 flex-col overflow-hidden">
      {/* Header Bar */}
      <div className="flex-shrink-0 border-b border-gray-200 bg-white shadow-sm">
        {/* Top Row - Breadcrumb and Actions */}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          {/* Left: Back Button + Title */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={handleBackToList}
              className="flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            <nav className="flex min-w-0 items-center gap-2 text-sm">
              <svg
                className="h-4 w-4 flex-shrink-0 text-gray-400"
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

          {/* Right: View Mode Toggle + Info Button */}
          <div className="flex items-center gap-2">
            {/* View Mode Toggle for HTML (YouTube already excluded via displayMode) */}
            {isHTML && (
              <div className="flex h-8 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5">
                <button
                  onClick={() => setHtmlViewMode('reader')}
                  className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-all ${
                    htmlViewMode === 'reader'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Book className="h-3.5 w-3.5" />
                  Reader
                </button>
                <button
                  onClick={() => setHtmlViewMode('original')}
                  className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-all ${
                    htmlViewMode === 'original'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  Original
                </button>
              </div>
            )}

            {/* Toggle Info Panel */}
            <button
              onClick={() => setIsHeaderCollapsed(!isHeaderCollapsed)}
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                isHeaderCollapsed
                  ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
              title={isHeaderCollapsed ? 'Show details' : 'Hide details'}
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
              Info
            </button>
          </div>
        </div>

        {/* Expanded Info Panel */}
        {!isHeaderCollapsed && (
          <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              {/* Left: Metadata */}
              <div className="flex items-center gap-4 text-sm text-gray-500">
                {/* Date */}
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
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
                      <User className="h-4 w-4" />
                      {selectedResource.authors
                        .slice(0, 2)
                        .map((a) => a.name || a.username || 'Unknown')
                        .join(', ')}
                    </span>
                  )}

                {/* View Count */}
                {selectedResource.viewCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <Eye className="h-4 w-4" />
                    {selectedResource.viewCount}
                  </span>
                )}
              </div>

              {/* Right: Action Buttons */}
              <ExploreActions />
            </div>
          </div>
        )}
      </div>

      {/* Content Area - Scrollable */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {isPDF && (
          <PDFViewer
            url={selectedResource.pdfUrl || selectedResource.sourceUrl}
            className="h-full w-full"
          />
        )}

        {isHTML && htmlViewMode === 'reader' && (
          <ReaderView
            url={selectedResource.sourceUrl}
            isImportedResource={true}
            fallbackContent={
              selectedResource.content || selectedResource.abstract
            }
            onArticleLoaded={(article) =>
              setArticleTextContent(article.textContent || '')
            }
          />
        )}

        {isHTML && htmlViewMode === 'original' && (
          <HTMLViewer url={selectedResource.sourceUrl} />
        )}

        {!isPDF && !isHTML && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
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
              <p className="mt-4 text-sm text-gray-500">
                No preview available for this resource
              </p>
              {selectedResource.sourceUrl && (
                <a
                  href={selectedResource.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-red-600 hover:underline"
                >
                  Open in new tab →
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
