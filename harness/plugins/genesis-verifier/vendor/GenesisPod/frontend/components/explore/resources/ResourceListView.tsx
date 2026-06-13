'use client';

import React from 'react';
import { ResourceCard } from './ResourceCard';
import { getSourceName } from '../utils/resourceHelpers';
import type { Resource } from '../utils/types';
import { EmptyState } from '@/components/ui/states/EmptyState';

interface ResourceListViewProps {
  resources: Resource[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMoreTriggerRef: React.RefObject<HTMLDivElement>;
  selectedSources: string[];
  isBookmarked: (resourceId: string) => boolean;
  hasUpvoted: (resourceId: string) => boolean;
  onResourceClick: (resource: Resource) => void;
  onToggleBookmark: (resourceId: string, e: React.MouseEvent) => void;
  onToggleUpvote: (resourceId: string, e: React.MouseEvent) => void;
  onCommentClick: (resource: Resource, e: React.MouseEvent) => void;
  onDeleteResource?: (resourceId: string, e: React.MouseEvent) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  isAdmin?: boolean;
}

export function ResourceListView({
  resources,
  loading,
  loadingMore,
  hasMore,
  loadMoreTriggerRef,
  selectedSources,
  isBookmarked,
  hasUpvoted,
  onResourceClick,
  onToggleBookmark,
  onToggleUpvote,
  onCommentClick,
  onDeleteResource,
  onToast,
  isAdmin = false,
}: ResourceListViewProps) {
  // Filter resources
  const filteredResources = resources.filter((resource) => {
    // Filter out invalid resources
    if (!resource.title || resource.title.trim() === '') return false;

    // Apply source filter if any sources are selected
    if (selectedSources.length === 0) return true;

    const sourceName = getSourceName(resource);
    if (!sourceName) return false;

    // Check if any selected source matches
    return selectedSources.some(
      (selected) =>
        sourceName.toLowerCase().includes(selected.toLowerCase()) ||
        selected.toLowerCase().includes(sourceName.toLowerCase())
    );
  });

  return (
    <>
      {/* Loading State */}
      {loading && (
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
      )}

      {/* Resource Cards */}
      {!loading && filteredResources.length > 0 && (
        <div className="space-y-5">
          {filteredResources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              isBookmarked={isBookmarked(resource.id)}
              hasUpvoted={hasUpvoted(resource.id)}
              onResourceClick={onResourceClick}
              onToggleBookmark={onToggleBookmark}
              onToggleUpvote={onToggleUpvote}
              onCommentClick={onCommentClick}
              onDeleteResource={onDeleteResource}
              onToast={onToast}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Infinite Scroll Trigger */}
      {!loading && filteredResources.length > 0 && hasMore && (
        <div ref={loadMoreTriggerRef} className="mt-6 flex justify-center py-4">
          {loadingMore && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg
                className="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              加载中...
            </div>
          )}
        </div>
      )}

      {/* No More Results */}
      {!loading && filteredResources.length > 0 && !hasMore && (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">— 已加载全部内容 —</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredResources.length === 0 && (
        <EmptyState
          title="No content available"
          description="Try running the data crawler first"
        />
      )}
    </>
  );
}
