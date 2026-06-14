'use client';

import { useState, useCallback } from 'react';
import {
  Link as LinkIcon,
  Plus,
  X,
  Loader2,
  Check,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
interface UrlPreview {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  metadata: {
    author?: string;
    publishDate?: string;
    siteName?: string;
    description?: string;
  };
  status: 'pending' | 'loading' | 'success' | 'error';
  error?: string;
}

interface UrlImportPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
  disabled?: boolean;
}

/**
 * URL Import Panel
 * Allows users to input URLs, preview content, and import to knowledge base
 */
export default function UrlImportPanel({
  knowledgeBaseId,
  onImportComplete,
  disabled = false,
}: UrlImportPanelProps) {
  const [urls, setUrls] = useState<UrlPreview[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
  } | null>(null);

  // Add a single URL
  const addUrl = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;

    // Validate URL format
    try {
      new URL(trimmed);
    } catch {
      // Try adding https://
      try {
        new URL(`https://${trimmed}`);
        setUrls((prev) => [
          ...prev,
          {
            url: `https://${trimmed}`,
            title: '',
            content: '',
            wordCount: 0,
            metadata: {},
            status: 'pending',
          },
        ]);
        return;
      } catch {
        return; // Invalid URL
      }
    }

    // Check if URL already exists
    setUrls((prev) => {
      if (prev.some((u) => u.url === trimmed)) {
        return prev;
      }
      return [
        ...prev,
        {
          url: trimmed,
          title: '',
          content: '',
          wordCount: 0,
          metadata: {},
          status: 'pending',
        },
      ];
    });
  }, []);

  // Handle input submit (Enter or button click)
  const handleAddUrl = () => {
    addUrl(inputValue);
    setInputValue('');
  };

  // Handle batch input (paste multiple URLs)
  const handleBatchInput = (text: string) => {
    const lines = text.split(/[\n,]+/);
    lines.forEach((line) => addUrl(line));
    setInputValue('');
  };

  // Remove a URL from the list
  const removeUrl = (url: string) => {
    setUrls((prev) => prev.filter((u) => u.url !== url));
  };

  // Preview a single URL
  const previewUrl = async (url: string) => {
    setUrls((prev) =>
      prev.map((u) => (u.url === url ? { ...u, status: 'loading' } : u))
    );

    try {
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/fetch-url`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch URL');
      }

      const result = await response.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;
      setUrls((prev) =>
        prev.map((u) =>
          u.url === url
            ? {
                ...u,
                title: data.title,
                content: data.content,
                wordCount: data.wordCount,
                metadata: data.metadata,
                status: 'success',
              }
            : u
        )
      );
    } catch (error) {
      setUrls((prev) =>
        prev.map((u) =>
          u.url === url
            ? {
                ...u,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            : u
        )
      );
    }
  };

  // Import all URLs
  const handleImport = async () => {
    if (urls.length === 0 || importing) return;

    setImporting(true);
    setImportResult(null);

    try {
      const urlsToImport = urls.map((u) => u.url);
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/import-urls`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ urls: urlsToImport }),
        }
      );

      if (!response.ok) {
        throw new Error('Import failed');
      }

      const result = await response.json();
      setImportResult({
        success: result.success,
        failed: result.failed?.length || 0,
      });

      // Update URL statuses based on result
      if (result.failed && result.failed.length > 0) {
        const failedUrls = new Set(
          result.failed.map((f: { url: string; error?: string }) => f.url)
        );
        setUrls((prev) =>
          prev.map((u) => ({
            ...u,
            status: failedUrls.has(u.url) ? 'error' : 'success',
            error: result.failed.find(
              (f: { url: string; error?: string }) => f.url === u.url
            )?.error,
          }))
        );
      } else {
        setUrls((prev) => prev.map((u) => ({ ...u, status: 'success' })));
      }

      onImportComplete?.(result.success);
    } catch (error) {
      logger.error('Import error:', error);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* URL Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddUrl();
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (text.includes('\n') || text.includes(',')) {
              e.preventDefault();
              handleBatchInput(text);
            }
          }}
          placeholder="输入网页 URL，按 Enter 添加"
          disabled={disabled || importing}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
        />
        <button
          type="button"
          onClick={handleAddUrl}
          disabled={disabled || importing || !inputValue.trim()}
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          添加
        </button>
      </div>

      <p className="text-xs text-gray-500">
        支持批量粘贴多个 URL（每行一个或逗号分隔）
      </p>

      {/* URL List */}
      {urls.length > 0 && (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
          {urls.map((urlItem) => (
            <div
              key={urlItem.url}
              className="flex items-start gap-2 rounded-lg bg-gray-50 p-2"
            >
              {/* Status Icon */}
              <div className="flex-shrink-0 pt-1">
                {urlItem.status === 'pending' && (
                  <LinkIcon className="h-4 w-4 text-gray-400" />
                )}
                {urlItem.status === 'loading' && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                )}
                {urlItem.status === 'success' && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
                {urlItem.status === 'error' && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
              </div>

              {/* URL Info */}
              <div className="min-w-0 flex-1">
                {urlItem.title ? (
                  <p className="truncate text-sm font-medium text-gray-900">
                    {urlItem.title}
                  </p>
                ) : (
                  <p className="truncate text-sm text-gray-600">
                    {urlItem.url}
                  </p>
                )}
                {urlItem.metadata.description && (
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {urlItem.metadata.description}
                  </p>
                )}
                {urlItem.wordCount > 0 && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    约 {urlItem.wordCount.toLocaleString()} 字
                  </p>
                )}
                {urlItem.error && (
                  <p className="mt-0.5 text-xs text-red-500">{urlItem.error}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-shrink-0 items-center gap-1">
                {urlItem.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => previewUrl(urlItem.url)}
                    disabled={disabled || importing}
                    className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    title="预览内容"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeUrl(urlItem.url)}
                  disabled={importing}
                  className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-red-600"
                  title="移除"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import Button */}
      {urls.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">已添加 {urls.length} 个 URL</p>
          <button
            type="button"
            onClick={handleImport}
            disabled={disabled || importing || urls.length === 0}
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
                导入到知识库
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
