'use client';

import { useState } from 'react';
import { Bookmark, ThumbsUp, Share2, ExternalLink } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { useExplore } from './ExploreContext';

import { logger } from '@/lib/utils/logger';
export default function ExploreActions() {
  const {
    selectedResource,
    isBookmarked,
    toggleBookmark,
    upvotes,
    setUpvotes,
    accessToken,
    setToast,
  } = useExplore();

  const [isUpvoting, setIsUpvoting] = useState(false);

  if (!selectedResource) return null;

  const hasUpvoted = upvotes.has(selectedResource.id);

  // Handle upvote
  const handleUpvote = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!accessToken || isUpvoting) return;

    try {
      setIsUpvoting(true);
      const response = await fetch(
        `${config.apiUrl}/resources/${selectedResource.id}/upvote`,
        {
          method: hasUpvoted ? 'DELETE' : 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.ok) {
        setUpvotes((prev) => {
          const newSet = new Set(prev);
          if (hasUpvoted) {
            newSet.delete(selectedResource.id);
          } else {
            newSet.add(selectedResource.id);
          }
          return newSet;
        });

        setToast({
          message: hasUpvoted ? 'Upvote removed' : 'Upvoted successfully',
          type: 'success',
        });
      }
    } catch (error) {
      logger.error('Failed to upvote:', error);
      setToast({
        message: 'Failed to upvote',
        type: 'error',
      });
    } finally {
      setIsUpvoting(false);
    }
  };

  // Handle bookmark
  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!accessToken) {
      setToast({
        message: 'Please login to bookmark',
        type: 'error',
      });
      return;
    }

    try {
      await toggleBookmark(selectedResource.id);
      setToast({
        message: isBookmarked(selectedResource.id)
          ? 'Bookmark removed'
          : 'Bookmarked successfully',
        type: 'success',
      });
    } catch (error) {
      logger.error('Failed to bookmark:', error);
      setToast({
        message: 'Failed to bookmark',
        type: 'error',
      });
    }
  };

  // Handle share
  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();

    const url = `${window.location.origin}/explore?id=${selectedResource.id}&tab=${selectedResource.type.toLowerCase()}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: selectedResource.title,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setToast({
          message: 'Link copied to clipboard',
          type: 'success',
        });
      }
    } catch (error) {
      logger.error('Failed to share:', error);
    }
  };

  // Open in new tab
  const handleOpenInNewTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedResource.sourceUrl) {
      window.open(selectedResource.sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Upvote */}
      <button
        onClick={handleUpvote}
        disabled={!accessToken || isUpvoting}
        className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
          hasUpvoted
            ? 'bg-red-100 text-red-700 hover:bg-red-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        title={hasUpvoted ? 'Remove upvote' : 'Upvote'}
      >
        <ThumbsUp
          className={`h-3.5 w-3.5 ${hasUpvoted ? 'fill-current' : ''}`}
        />
        <span>{selectedResource.upvoteCount || 0}</span>
      </button>

      {/* Bookmark */}
      <button
        onClick={handleBookmark}
        disabled={!accessToken}
        className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
          isBookmarked(selectedResource.id)
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        } disabled:cursor-not-allowed disabled:opacity-50`}
        title={
          isBookmarked(selectedResource.id) ? 'Remove bookmark' : 'Bookmark'
        }
      >
        <Bookmark
          className={`h-3.5 w-3.5 ${isBookmarked(selectedResource.id) ? 'fill-current' : ''}`}
        />
      </button>

      {/* Share */}
      <button
        onClick={handleShare}
        className="flex h-8 items-center gap-1.5 rounded-md bg-gray-100 px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
        title="Share"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>

      {/* Open in new tab */}
      {selectedResource.sourceUrl && (
        <button
          onClick={handleOpenInNewTab}
          className="flex h-8 items-center gap-1.5 rounded-md bg-gray-100 px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
          title="Open in new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
