'use client';

import { useEffect, useRef } from 'react';
import { ThumbsUp } from 'lucide-react';
import ResourceThumbnail from '../resources/ResourceThumbnail';
import { InsightChip } from '../InsightBadge';
import { useExplore } from './ExploreContext';
import { getSourceName, getSourceBadgeColor } from '../utils/resourceHelpers';
import { ClientDate } from '@/components/common/ClientDate';

export default function ExploreList() {
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  const {
    resources,
    loading,
    loadingMore,
    hasMore,
    fetchResources,
    handleResourceClick,
    selectedSources,
  } = useExplore();

  // Infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          fetchResources(true);
        }
      },
      { threshold: 0.5 }
    );

    const trigger = loadMoreTriggerRef.current;
    if (trigger) {
      observer.observe(trigger);
    }

    return () => {
      if (trigger) {
        observer.unobserve(trigger);
      }
    };
  }, [hasMore, loadingMore, fetchResources]);

  // Filter resources
  const filteredResources = resources.filter((resource) => {
    // Filter out invalid resources
    if (!resource.title || resource.title.trim() === '') return false;

    // Apply source filter
    if (selectedSources.length === 0) return true;

    const sourceName = getSourceName(resource);
    if (!sourceName) return false;

    return selectedSources.some(
      (selected) =>
        sourceName.toLowerCase().includes(selected.toLowerCase()) ||
        selected.toLowerCase().includes(sourceName.toLowerCase())
    );
  });

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-8 pb-6">
        <div className="space-y-5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex animate-pulse items-start gap-4 rounded-xl border border-gray-200 bg-white p-6"
            >
              <div className="h-6 w-6 flex-shrink-0 rounded bg-gray-200"></div>
              <div className="flex-1">
                <div className="mb-3 h-3 w-48 rounded bg-gray-200"></div>
                <div className="mb-3 h-6 w-3/4 rounded bg-gray-200"></div>
                <div className="mb-2 h-4 w-full rounded bg-gray-200"></div>
                <div className="h-4 w-5/6 rounded bg-gray-200"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!loading && filteredResources.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-8 pb-6">
        <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50">
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
            <p className="mt-4 text-sm text-gray-500">No resources found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-8 pb-6">
      <div className="space-y-5">
        {filteredResources.map((resource) => (
          <article
            key={resource.id}
            onClick={() => handleResourceClick(resource)}
            className="group w-full cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:shadow-lg"
          >
            <div className="flex h-48 w-full overflow-hidden">
              {/* Thumbnail */}
              <div
                className={`relative h-48 flex-shrink-0 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 ${
                  resource.type === 'PAPER' ? 'w-36' : 'w-64'
                }`}
              >
                <ResourceThumbnail
                  resource={resource}
                  className="h-full w-full"
                />
              </div>

              {/* Content */}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-5">
                {/* Metadata */}
                <div className="mb-2 flex flex-shrink-0 flex-wrap items-center gap-2 text-xs text-gray-500">
                  <ClientDate
                    date={resource.publishedAt}
                    format="date"
                    locale="en-US"
                    dateOptions={{
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }}
                  />

                  {/* Source Badge */}
                  {(() => {
                    const sourceName = getSourceName(resource);
                    return sourceName ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${getSourceBadgeColor(sourceName, resource.type)}`}
                        title={`Source: ${sourceName}`}
                      >
                        <span className="max-w-[120px] truncate">
                          {sourceName}
                        </span>
                      </span>
                    ) : null;
                  })()}

                  {/* Upvote Count */}
                  {resource.upvoteCount !== undefined &&
                    resource.upvoteCount > 0 && (
                      <span className="flex items-center gap-1 text-gray-600">
                        <ThumbsUp className="h-3 w-3" />
                        {resource.upvoteCount}
                      </span>
                    )}

                  {/* Categories */}
                  {resource.categories &&
                    resource.categories.slice(0, 2).map((cat, i) => (
                      <span key={i} className="text-gray-600">
                        {cat}
                      </span>
                    ))}

                  {/* AI Insights Chip */}
                  {resource.keyInsights && resource.keyInsights.length > 0 && (
                    <InsightChip insights={resource.keyInsights} />
                  )}
                </div>

                {/* Title */}
                <h2
                  className="mb-2 flex-shrink-0 truncate text-xl font-semibold text-red-600 hover:underline"
                  title={resource.title}
                >
                  {resource.title}
                </h2>

                {/* Abstract */}
                <p
                  className="line-clamp-2 min-h-0 flex-shrink overflow-hidden text-ellipsis text-sm leading-relaxed text-gray-700"
                  title={resource.aiSummary || resource.abstract || ''}
                >
                  {resource.aiSummary || resource.abstract || (
                    <span className="text-gray-500">
                      {resource.sourceUrl && (
                        <>
                          <span className="font-medium">Source:</span>{' '}
                          {new URL(resource.sourceUrl).hostname.replace(
                            'www.',
                            ''
                          )}
                        </>
                      )}
                      {resource.authors && resource.authors.length > 0 && (
                        <>
                          {resource.sourceUrl && ' • '}
                          <span className="font-medium">By:</span>{' '}
                          {resource.authors
                            .slice(0, 3)
                            .map((a) => a.name || a.username || 'Unknown')
                            .join(', ')}
                        </>
                      )}
                    </span>
                  )}
                </p>
              </div>
            </div>
          </article>
        ))}

        {/* Infinite scroll trigger */}
        {hasMore && (
          <div ref={loadMoreTriggerRef} className="py-4 text-center">
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-red-500"></div>
                Loading more...
              </div>
            )}
          </div>
        )}

        {/* End of list indicator */}
        {!hasMore && filteredResources.length > 0 && (
          <div className="py-4 text-center text-sm text-gray-400">
            No more resources to load
          </div>
        )}
      </div>
    </div>
  );
}
