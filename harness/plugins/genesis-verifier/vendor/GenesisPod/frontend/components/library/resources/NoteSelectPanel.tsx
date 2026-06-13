'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  StickyNote,
  Search,
  Loader2,
  Check,
  FileText,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { getAuthHeader } from '@/lib/utils/auth';
import { formatDateSafe } from '@/lib/utils/date';

interface AvailableNote {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  contentPreview: string;
  resourceId?: string;
  resourceTitle?: string;
}

interface NoteSelectPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
  disabled?: boolean;
}

/**
 * Note Select Panel
 * Allows users to select and import their notes to knowledge base
 */
export default function NoteSelectPanel({
  knowledgeBaseId,
  onImportComplete,
  disabled = false,
}: NoteSelectPanelProps) {
  const [notes, setNotes] = useState<AvailableNote[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [autoSync, setAutoSync] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
  } | null>(null);

  const limit = 20;

  // Fetch available notes
  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', page.toString());
      params.set('limit', limit.toString());

      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/available-notes?${params}`,
        {
          headers: getAuthHeader(),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch notes');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      setNotes(data.notes || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [knowledgeBaseId, searchQuery, page]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

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
    if (selectedIds.size === notes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notes.map((n) => n.id)));
    }
  };

  // Import selected notes
  const handleImport = async () => {
    if (selectedIds.size === 0 || importing) return;

    setImporting(true);
    setImportResult(null);

    try {
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/import-notes`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            noteIds: Array.from(selectedIds),
            autoSync,
          }),
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
          placeholder="搜索笔记..."
          disabled={disabled || loading}
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
        />
      </div>

      {/* Select All and Auto Sync */}
      {notes.length > 0 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={toggleSelectAll}
            disabled={disabled || loading}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                selectedIds.size === notes.length
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-gray-300'
              }`}
            >
              {selectedIds.size === notes.length && (
                <Check className="h-3 w-3 text-white" />
              )}
            </div>
            {selectedIds.size === notes.length ? '取消全选' : '全选'}
          </button>
          <span className="text-xs text-gray-500">
            已选择 {selectedIds.size} / {total} 个笔记
          </span>
        </div>
      )}

      {/* Note List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 py-8 text-red-500">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">{error}</span>
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<StickyNote className="h-8 w-8" />}
          title="暂无可导入的笔记"
          description="在阅读资源时创建的笔记会出现在这里"
        />
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-2">
          {notes.map((note) => {
            const isSelected = selectedIds.has(note.id);
            return (
              <div
                key={note.id}
                onClick={() => toggleSelect(note.id)}
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

                {/* Note Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StickyNote
                      className={`h-4 w-4 flex-shrink-0 ${
                        isSelected ? 'text-blue-600' : 'text-yellow-500'
                      }`}
                    />
                    <p className="truncate text-sm font-medium text-gray-900">
                      {note.title}
                    </p>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                    {note.contentPreview}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    {note.resourceTitle && (
                      <span className="flex items-center gap-1 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                        <FileText className="h-3 w-3" />
                        {note.resourceTitle.length > 20
                          ? note.resourceTitle.slice(0, 20) + '...'
                          : note.resourceTitle}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      更新于 {formatDate(note.updatedAt)}
                    </span>
                  </div>
                </div>
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

      {/* Auto Sync Option */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 p-3">
          <button
            type="button"
            onClick={() => setAutoSync(!autoSync)}
            className="flex items-center gap-2 text-sm text-gray-700"
          >
            <div
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                autoSync
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-gray-300 bg-white'
              }`}
            >
              {autoSync && <Check className="h-3 w-3 text-white" />}
            </div>
            <RefreshCw
              className={`h-4 w-4 ${autoSync ? 'text-blue-500' : 'text-gray-400'}`}
            />
            自动同步
          </button>
          <span className="text-xs text-gray-500">
            笔记更新时自动更新知识库内容
          </span>
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
                导入 {selectedIds.size} 个笔记
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
