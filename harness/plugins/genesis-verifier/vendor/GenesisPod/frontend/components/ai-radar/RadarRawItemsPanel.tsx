'use client';

/**
 * RadarRawItemsPanel
 *
 * Renders the full raw-items list for a topic + date.
 * Derived from RadarFeedList (which is being deleted in F15) —
 * strips the Tabs wrapper, accepts a `date` filter, and shows a count in the header.
 */

import { useEffect, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { listFeed } from '@/services/ai-radar/api';
import type { RadarItem, RadarSourceType } from '@/services/ai-radar/types';

interface Props {
  topicId: string;
  /** YYYY-MM-DD — if undefined, lists all available items */
  date?: string;
  onCountChange?: (count: number) => void;
}

const TYPE_LABEL: Record<RadarSourceType, string> = {
  X: 'X',
  YOUTUBE: 'YT',
  RSS: 'RSS',
  CUSTOM: 'Web',
};

const TYPE_COLOR: Record<RadarSourceType, string> = {
  X: 'bg-gray-100 text-gray-700',
  YOUTUBE: 'bg-red-50 text-red-700',
  RSS: 'bg-orange-50 text-orange-700',
  CUSTOM: 'bg-indigo-50 text-indigo-700',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function RadarRawItemsPanel({ topicId, date, onCountChange }: Props) {
  const [items, setItems] = useState<RadarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Build since/until from date if provided
    const opts: Parameters<typeof listFeed>[1] = { limit: 200 };
    if (date) {
      opts.since = `${date}T00:00:00.000Z`;
    }

    listFeed(topicId, opts)
      .then((res) => {
        if (!cancelled) {
          // Filter client-side to the day if date provided
          const filtered = date
            ? res.items.filter((item) => item.publishedAt.startsWith(date))
            : res.items;
          setItems(filtered);
          onCountChange?.(filtered.length);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [topicId, date, onCountChange]);

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        加载失败：{error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        当日没有原始信号。
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {items.map((item) => (
        <li key={item.id} className="px-4 py-3 transition hover:bg-cyan-50/30">
          <div className="flex items-start gap-2">
            <span
              className={`flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${
                item.source
                  ? TYPE_COLOR[item.source.type]
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {item.source ? TYPE_LABEL[item.source.type] : '?'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">
                  {fmtDate(item.publishedAt)}
                </span>
                {item.author && (
                  <span className="text-xs text-gray-500">{item.author}</span>
                )}
                {item.relevanceScore != null && (
                  <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-xs text-cyan-700">
                    相关 {item.relevanceScore}
                  </span>
                )}
                {item.qualityScore != null && (
                  <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                    质量 {item.qualityScore}
                  </span>
                )}
                {item.accepted && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                    <Check className="h-2.5 w-2.5" />
                    入选
                  </span>
                )}
              </div>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-sm font-medium text-gray-900 hover:text-cyan-700"
                >
                  {item.title || '(无标题)'}
                  <ExternalLink className="ml-1 inline h-3 w-3 opacity-50" />
                </a>
              ) : (
                <h4 className="mt-1 text-sm font-medium text-gray-900">
                  {item.title || '(无标题)'}
                </h4>
              )}
              {item.aiSummary ? (
                <p className="mt-1 text-xs text-gray-600">{item.aiSummary}</p>
              ) : item.content ? (
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                  {item.content}
                </p>
              ) : null}
              {(() => {
                const entities = Array.isArray(item.entities)
                  ? item.entities.filter(
                      (e): e is NonNullable<typeof e> =>
                        !!e && typeof e === 'object'
                    )
                  : [];
                return entities.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {entities.slice(0, 5).map((e, idx) => (
                      <span
                        key={`${e.type}-${e.name}-${idx}`}
                        className="rounded bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600"
                      >
                        {e.normalizedName}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
