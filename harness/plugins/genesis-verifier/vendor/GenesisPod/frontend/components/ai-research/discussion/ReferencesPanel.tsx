'use client';

import { useState, useMemo } from 'react';
import { ExternalLink, Search, LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import type { ReportReference } from '@/hooks';

interface ReferencesPanelProps {
  references: ReportReference[];
  className?: string;
}

type SortKey = 'id' | 'title';

export function ReferencesPanel({
  references,
  className,
}: ReferencesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('id');

  const filtered = useMemo(() => {
    let result = [...references];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (ref) =>
          ref.title.toLowerCase().includes(q) ||
          ref.url.toLowerCase().includes(q) ||
          ref.snippet?.toLowerCase().includes(q)
      );
    }
    if (sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    }
    return result;
  }, [references, searchQuery, sortBy]);

  if (references.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-20',
          className
        )}
      >
        <LinkIcon className="mb-4 h-12 w-12 text-gray-300" />
        <p className="text-lg font-medium text-gray-500">暂无参考来源</p>
        <p className="mt-2 text-sm text-gray-400">
          完成研究后将在此显示所有引用来源
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">
            共 {references.length} 个来源
          </h3>
          {searchQuery && (
            <span className="text-xs text-gray-400">
              (显示 {filtered.length} 条)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索来源..."
              className="rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-100"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-blue-400 focus:outline-none"
          >
            <option value="id">按引用顺序</option>
            <option value="title">按标题排序</option>
          </select>
        </div>
      </div>

      {/* Reference Cards */}
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((ref) => {
          const domain = (() => {
            try {
              return new URL(ref.url).hostname.replace('www.', '');
            } catch {
              return ref.url;
            }
          })();

          return (
            <div
              key={ref.id}
              className="rounded-lg border border-gray-200 bg-white p-4 transition-colors hover:border-blue-200 hover:bg-blue-50/20"
            >
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 rounded bg-purple-600 px-2 py-0.5 text-xs font-bold text-white">
                  [{ref.id}]
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                  >
                    <span className="line-clamp-2">{ref.title}</span>
                    <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                  <p className="mt-0.5 text-xs text-gray-400">{domain}</p>
                  {ref.snippet && (
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-gray-600">
                      {ref.snippet}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
