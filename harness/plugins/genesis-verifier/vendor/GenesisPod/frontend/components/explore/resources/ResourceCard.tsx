'use client';

import React from 'react';
import { ThumbsUp } from 'lucide-react';
import ResourceThumbnail from './ResourceThumbnail';
import { InsightChip } from '../InsightBadge';
import { getSourceName, getSourceBadgeColor } from '../utils/resourceHelpers';
import type { Resource } from '../utils/types';
import { useI18n } from '@/lib/i18n/i18n-context';
import { ClientDate } from '@/components/common/ClientDate';
import { FeedCard, type FeedCardAction } from '@/components/ui/cards/FeedCard';

interface ResourceCardProps {
  resource: Resource;
  isBookmarked: boolean;
  hasUpvoted: boolean;
  onResourceClick: (resource: Resource) => void;
  onToggleBookmark: (resourceId: string, e: React.MouseEvent) => void;
  onToggleUpvote: (resourceId: string, e: React.MouseEvent) => void;
  onCommentClick: (resource: Resource, e: React.MouseEvent) => void;
  onDeleteResource?: (resourceId: string, e: React.MouseEvent) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
  isAdmin?: boolean;
}

/**
 * explore 资源信息流卡 —— canonical FeedCard 的领域包装（横版 feed 卡型）。
 * 仅把 Resource 映射到 FeedCard 的 slot；外壳/布局/动作条由 FeedCard 统一。
 */
export function ResourceCard({
  resource,
  isBookmarked,
  hasUpvoted,
  onResourceClick,
  onToggleBookmark,
  onToggleUpvote,
  onCommentClick,
  onDeleteResource,
  isAdmin = false,
}: ResourceCardProps) {
  const { t } = useI18n();
  const sourceName = getSourceName(resource);

  const actions: FeedCardAction[] = [
    {
      key: 'bookmark',
      icon: (
        <svg
          className="h-4 w-4"
          fill={isBookmarked ? 'currentColor' : 'none'}
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
      ),
      label: isBookmarked
        ? t('explore.card.bookmarked')
        : t('explore.card.bookmark'),
      className: isBookmarked
        ? 'text-blue-600 hover:text-blue-700'
        : 'text-gray-600 hover:text-blue-600',
      onClick: (e) => onToggleBookmark(resource.id, e),
    },
  ];

  if (resource.upvoteCount !== undefined) {
    actions.push({
      key: 'upvote',
      icon: (
        <ThumbsUp className={`h-4 w-4 ${hasUpvoted ? 'fill-current' : ''}`} />
      ),
      count: resource.upvoteCount,
      className: hasUpvoted
        ? 'font-medium text-blue-600'
        : 'text-gray-600 hover:text-blue-600',
      onClick: (e) => onToggleUpvote(resource.id, e),
      title: '点赞',
    });
  }

  if (resource.commentCount !== undefined) {
    actions.push({
      key: 'comment',
      icon: (
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
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      ),
      count: resource.commentCount,
      className: 'text-gray-600 hover:text-green-600',
      onClick: (e) => onCommentClick(resource, e),
      title: '评论',
    });
  }

  if (isAdmin && onDeleteResource) {
    actions.push({
      key: 'delete',
      icon: (
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
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      ),
      label: t('explore.card.delete'),
      className: 'text-gray-400 hover:text-red-600',
      onClick: (e) => onDeleteResource(resource.id, e),
      title: 'Delete resource (Admin)',
    });
  }

  return (
    <FeedCard
      onClick={() => onResourceClick(resource)}
      thumbnail={
        <ResourceThumbnail resource={resource} className="h-full w-full" />
      }
      thumbnailWidthClassName={resource.type === 'PAPER' ? 'w-36' : 'w-64'}
      title={resource.title}
      titleTooltip={resource.title}
      titleClassName="text-red-600"
      meta={
        <>
          <ClientDate
            date={resource.publishedAt}
            format="date"
            locale="en-US"
            dateOptions={{ day: 'numeric', month: 'short', year: 'numeric' }}
          />

          {sourceName && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${getSourceBadgeColor(sourceName, resource.type)}`}
              title={`${t('explore.card.source')}: ${sourceName}`}
            >
              <span className="max-w-[120px] truncate">{sourceName}</span>
            </span>
          )}

          {resource.upvoteCount !== undefined && (
            <span className="flex items-center gap-1 text-gray-600">
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              </svg>
              {resource.upvoteCount}
            </span>
          )}

          {resource.categories &&
            resource.categories.slice(0, 2).map((cat, i) => (
              <span key={i} className="text-gray-600">
                {cat}
              </span>
            ))}

          {resource.keyInsights && resource.keyInsights.length > 0 && (
            <InsightChip insights={resource.keyInsights} />
          )}
        </>
      }
      description={
        resource.aiSummary ||
        resource.abstract || (
          <span className="text-gray-500">
            {resource.sourceUrl && (
              <>
                <span className="font-medium">{t('explore.card.source')}:</span>{' '}
                {new URL(resource.sourceUrl).hostname.replace('www.', '')}
              </>
            )}
            {resource.authors && resource.authors.length > 0 && (
              <>
                {resource.sourceUrl && ' • '}
                <span className="font-medium">
                  {t('explore.card.by')}:
                </span>{' '}
                {resource.authors
                  .slice(0, 3)
                  .map((a) => a.name || a.username || t('explore.card.unknown'))
                  .join(', ')}
                {resource.authors.length > 3 && ` ${t('explore.card.etAl')}`}
              </>
            )}
          </span>
        )
      }
      actions={actions}
    />
  );
}
