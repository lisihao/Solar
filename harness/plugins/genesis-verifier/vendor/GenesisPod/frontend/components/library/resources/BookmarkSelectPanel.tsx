'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Bookmark,
  Search,
  Loader2,
  Check,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { getAuthHeader } from '@/lib/utils/auth';
import { formatDateSafe } from '@/lib/utils/date';

interface AvailableBookmark {
  id: string;
  title: string;
  url: string;
  type: string;
  savedAt: string;
  tags?: string[];
}

interface BookmarkSelectPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
  disabled?: boolean;
}

/**
 * Bookmark Select Panel
 * Allows users to select and import their saved bookmarks to knowledge base
 */
export default function BookmarkSelectPanel({
  knowledgeBaseId,
  onImportComplete,
  disabled = false,
}: BookmarkSelectPanelProps) {
  const [bookmarks, setBookmarks] = useState<AvailableBookmark[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
  } | null>(null);

  const limit = 20;

  // Fetch available bookmarks
  const fetchBookmarks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', page.toString());
      params.set('limit', limit.toString());

      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/available-bookmarks?${params}`,
        {
          headers: getAuthHeader(),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch bookmarks');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      setBookmarks(data.bookmarks || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bookmarks');
    } finally {
      setLoading(false);
    }
  }, [knowledgeBaseId, searchQuery, page]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  // Toggle selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select/deselect all
  const toggleSelectAll = () => {
    if (selectedIds.size === bookmarks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bookmarks.map((b) => b.id)));
    }
  };

  // Import selected bookmarks
  const handleImport = async () => {
    if (selectedIds.size === 0 || importing) return;

    setImporting(true);
    setImportResult(null);

    try {
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/import-bookmarks`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ bookmarkIds: Array.from(selectedIds) }),
        }
      );

      if (!response.ok) {
        throw new Error('Import failed');
      }

      const apiResult = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const result = apiResult?.data ?? apiResult;
      setImportResult({
        success: result.success,
        failed: result.failed?.length || 0,
      });

      // Clear selection for successfully imported
      if (result.documentIds) {
        const importedSet = new Set(result.documentIds);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          // Mark imported ones
          return next;
        });
      }

      onImportComplete?.(result.success);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return formatDateSafe(dateString, 'date');
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          placeholder="搜索书签..."
          disabled={disabled || loading}
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
        />
      </div>

      {/* Select All */}
      {bookmarks.length > 0 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={disabled || loading}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                selectedIds.size === bookmarks.length
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-gray-300'
              }`}
            >
              {selectedIds.size === bookmarks.length && (
                <Check className="h-3 w-3 text-white" />
              )}
            </div>
            {selectedIds.size === bookmarks.length ? '取消全选' : '全选'}
          </button>
          <span className="text-xs text-gray-500">
            已选择 {selectedIds.size} / {total} 个书签
          </span>
        </div>
      )}

      {/* Bookmark List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 py-8 text-red-500">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">{error}</span>
        </div>
      ) : bookmarks.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Bookmark className="h-8 w-8" />}
          title="暂无可导入的书签"
          description="在 Explore 中点赞的资源会出现在这里"
        />
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2">
          {bookmarks.map((bookmark) => {
            const isSelected = selectedIds.has(bookmark.id);
            return (
              <div
                key={bookmark.id}
                onClick={() => toggleSelect(bookmark.id)}
                className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors ${
                  isSelected
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : 'bg-gray-50 hover:bg-gray-100'
                }`}
              >
                {/* Checkbox */}
                <div
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300 bg-white'
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </div>

                {/* Bookmark Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Bookmark
                      className={`h-4 w-4 flex-shrink-0 ${
                        isSelected ? 'text-blue-600' : 'text-orange-500'
                      }`}
                    />
                    <p className="truncate text-sm font-medium text-gray-900">
                      {bookmark.title}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {bookmark.url}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                      {bookmark.type}
                    </span>
                    <span className="text-xs text-gray-400">
                      保存于 {formatDate(bookmark.savedAt)}
                    </span>
                  </div>
                </div>

                {/* External Link */}
                <a
                  href={bookmark.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex-shrink-0 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-gray-500">
            {page} / {Math.ceil(total / limit)}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / limit) || loading}
            className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}

      {/* Import Button */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-end border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={handleImport}
            disabled={disabled || importing}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                导入 {selectedIds.size} 个书签
              </>
            )}
          </button>
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div
          className={`rounded-lg p-3 ${
            importResult.failed > 0
              ? 'bg-amber-50 text-amber-800'
              : 'bg-green-50 text-green-800'
          }`}
        >
          <p className="text-sm">
            导入完成：成功 {importResult.success} 个
            {importResult.failed > 0 && `，失败 ${importResult.failed} 个`}
          </p>
        </div>
      )}
    </div>
  );
}
