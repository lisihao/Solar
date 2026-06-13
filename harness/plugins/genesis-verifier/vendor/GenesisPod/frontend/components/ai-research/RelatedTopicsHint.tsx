'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';

interface TopicItem {
  id: string;
  name: string;
  type: string;
}

interface RelatedTopicsHintProps {
  keyword: string;
}

export function RelatedTopicsHint({ keyword }: RelatedTopicsHintProps) {
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [loading, setLoading] = useState(false);

  const searchTopics = useCallback(async (kw: string) => {
    if (kw.length < 3) {
      setTopics([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ search: kw, take: '5' });
      const resp = await fetch(
        `${config.apiBaseUrl}/api/v1/insight/topics?${params.toString()}`,
        { headers: getAuthHeader() }
      );
      if (!resp.ok) throw new Error('Failed to search topics');
      const data = (await resp.json()) as {
        data?: { topics?: TopicItem[] };
        topics?: TopicItem[];
      };
      const list = data.data?.topics ?? data.topics ?? [];
      setTopics(list);
    } catch (err) {
      logger.error('[RelatedTopicsHint] search error:', err);
      setTopics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void searchTopics(keyword);
    }, 300);
    return () => clearTimeout(timer);
  }, [keyword, searchTopics]);

  if (topics.length === 0 && !loading) return null;

  return (
    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-blue-700">
        <Search className="h-3.5 w-3.5" />
        <span>已有相关洞察专题：</span>
      </div>
      {loading ? (
        <div className="text-xs text-blue-500">搜索中...</div>
      ) : (
        <div className="space-y-1">
          {topics.map((topic) => (
            <a
              key={topic.id}
              href={`/ai-insights?topicId=${topic.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-700 hover:underline"
            >
              <ExternalLink className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{topic.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
