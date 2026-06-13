'use client';

import { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { formatDateSafe } from '@/lib/utils/date';

import { logger } from '@/lib/utils/logger';
interface SimilarResource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  aiSummary?: string;
  publishedAt: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  videoId?: string; // YouTube video ID
  categories?: string[];
  qualityScore?: string;
}

interface SimilarResourcesListProps {
  resourceId: string;
  onResourceClick?: (resource: SimilarResource) => void;
  limit?: number;
}

const typeLabels: Record<string, string> = {
  paper: '论文',
  github: 'GitHub',
  youtube: 'YouTube',
  article: '文章',
  news: '新闻',
  blog: '博客',
  report: '报告',
  podcast: '播客',
  video: '视频',
};

const typeAccent: Record<string, { bg: string; text: string; border: string }> =
  {
    paper: {
      bg: 'bg-purple-50',
      text: 'text-purple-600',
      border: 'border-purple-200',
    },
    github: {
      bg: 'bg-gray-900',
      text: 'text-white',
      border: 'border-gray-900',
    },
    youtube: {
      bg: 'bg-red-50',
      text: 'text-red-600',
      border: 'border-red-200',
    },
    article: {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      border: 'border-blue-200',
    },
    news: {
      bg: 'bg-amber-50',
      text: 'text-amber-600',
      border: 'border-amber-200',
    },
    blog: {
      bg: 'bg-teal-50',
      text: 'text-teal-600',
      border: 'border-teal-200',
    },
    report: {
      bg: 'bg-indigo-50',
      text: 'text-indigo-600',
      border: 'border-indigo-200',
    },
    podcast: {
      bg: 'bg-rose-50',
      text: 'text-rose-600',
      border: 'border-rose-200',
    },
    video: {
      bg: 'bg-red-50',
      text: 'text-red-600',
      border: 'border-red-200',
    },
  };

const typeIcons: Record<string, string> = {
  paper: 'PA',
  github: 'GH',
  youtube: 'YT',
  article: 'AR',
  news: 'NW',
  blog: 'BL',
  report: 'RP',
  podcast: 'PC',
  video: 'VD',
};

const getTypeAccent = (type: string) => {
  return (
    typeAccent[type] ?? {
      bg: 'bg-slate-100',
      text: 'text-slate-600',
      border: 'border-slate-200',
    }
  );
};

export default function SimilarResourcesList({
  resourceId,
  onResourceClick,
  limit = 6,
}: SimilarResourcesListProps) {
  const [resources, setResources] = useState<SimilarResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSimilar = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${config.apiBaseUrl}/api/v1/feed/related/${resourceId}?take=${limit}`
        );

        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: [...] }
          const data = result?.data ?? result;
          setResources(Array.isArray(data) ? data : []);
        } else {
          setError('Failed to load similar resources');
        }
      } catch (err) {
        logger.error('Failed to load similar resources:', err);
        setError('Error loading similar resources');
      } finally {
        setLoading(false);
      }
    };

    if (resourceId) {
      loadSimilar();
    }
  }, [resourceId, limit]);

  const formatDate = (dateString: string) => {
    return formatDateSafe(dateString, 'date');
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
        {error}
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="py-12 text-center">
        <svg
          className="mx-auto h-12 w-12 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">暂无相似内容</h3>
        <p className="mt-1 text-sm text-gray-500">未找到与当前资源相似的内容</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3">
        <h3 className="text-lg font-semibold text-gray-900">
          相似内容 ({resources.length})
        </h3>
      </div>

      {/* Resources Grid */}
      <div className="space-y-2">
        {resources.map((resource) => (
          <div
            key={resource.id}
            className="group flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-all hover:border-blue-200 hover:bg-blue-50/40"
            onClick={() => onResourceClick?.(resource)}
          >
            <div
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border text-xs font-semibold tracking-wide ${getTypeAccent(resource.type).bg} ${getTypeAccent(resource.type).border}`}
            >
              <span>{typeIcons[resource.type] || 'RES'}</span>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              {/* Type & Date */}
              <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${getTypeAccent(resource.type).bg} ${getTypeAccent(resource.type).text}`}
                >
                  {typeLabels[resource.type] || resource.type}
                </span>
                <span>{formatDate(resource.publishedAt)}</span>
              </div>

              {/* Title */}
              <h4 className="line-clamp-2 text-sm font-semibold text-gray-900 group-hover:text-blue-600">
                {resource.title}
              </h4>

              {/* Abstract */}
              {(resource.aiSummary || resource.abstract) && (
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                  {truncateText(
                    resource.aiSummary || resource.abstract || '',
                    90
                  )}
                </p>
              )}

              {/* Categories */}
              {resource.categories && resource.categories.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {resource.categories.slice(0, 2).map((cat, idx) => (
                    <span
                      key={idx}
                      className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600"
                    >
                      {cat}
                    </span>
                  ))}
                  {resource.categories.length > 2 && (
                    <span className="text-xs text-gray-400">
                      +{resource.categories.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
