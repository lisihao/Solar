'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  Check,
  RefreshCw,
  ExternalLink,
  Link2,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import {
  getPages,
  getConnections,
  type NotionPage,
} from '@/services/notion/api';
import { formatDateSafe } from '@/lib/utils/date';
import { EmptyState } from '@/components/ui/states/EmptyState';

interface NotionImportPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
}

/**
 * NotionImportPanel - Select Notion pages to import to KB
 */
export default function NotionImportPanel({
  knowledgeBaseId,
  onImportComplete,
}: NotionImportPanelProps) {
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    count: number;
    message: string;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isConnected, setIsConnected] = useState(false);

  // Check connection and fetch pages
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Check if Notion is connected
      const connResult = await getConnections();
      const hasConnection =
        connResult.connections && connResult.connections.length > 0;
      setIsConnected(hasConnection);

      if (hasConnection) {
        // Fetch pages
        const pagesResult = await getPages({
          page: 1,
          limit: 50,
          search: searchQuery || undefined,
        });
        setPages(pagesResult.pages || []);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load Notion data'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Handle search with debounce
  useEffect(() => {
    if (!isConnected) return;
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === pages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pages.map((p) => p.id)));
    }
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) {
      setError('Please select at least one page');
      return;
    }

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      // Build resources array for the API
      const selectedPages = pages.filter((p) => selectedIds.has(p.id));
      const resourceData = selectedPages.map((p) => ({
        sourceType: 'notion',
        sourceId: p.notionPageId,
        title: p.title,
        sourceUrl: p.url,
        mimeType: 'text/plain',
      }));

      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/add-resources`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({ resources: resourceData }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Import failed');
      }

      setSuccess({
        count: selectedIds.size,
        message: `Successfully imported ${selectedIds.size} Notion pages`,
      });

      // Clear selection
      setSelectedIds(new Set());
      onImportComplete?.(selectedIds.size);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return formatDateSafe(dateStr, 'datetime-short');
  };

  // Not connected state
  if (!loading && !isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
          <FileText className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="mt-4 text-base font-medium text-gray-900">
          Notion Not Connected
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Connect your Notion workspace to import pages
        </p>
        <a
          href="/me/integrations"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Link2 className="h-4 w-4" />
          Connect Notion
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Controls */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search Notion pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Page List */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span className="ml-2 text-sm text-gray-500">Loading...</span>
          </div>
        ) : pages.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="No Notion pages found"
            size="sm"
          />
        ) : (
          <>
            {/* Select All Header */}
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
              <button
                onClick={selectAll}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    selectedIds.size === pages.length
                      ? 'border-blue-600 bg-blue-600'
                      : 'border-gray-300'
                  }`}
                >
                  {selectedIds.size === pages.length && (
                    <Check className="h-3 w-3 text-white" />
                  )}
                </div>
                Select All ({pages.length})
              </button>
              <span className="text-xs text-gray-500">
                {selectedIds.size} selected
              </span>
            </div>

            {/* Page Items */}
            <div className="divide-y divide-gray-100">
              {pages.map((page) => (
                <div
                  key={page.id}
                  onClick={() => toggleSelect(page.id)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 ${
                    selectedIds.has(page.id) ? 'bg-blue-50' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                      selectedIds.has(page.id)
                        ? 'border-blue-600 bg-blue-600'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedIds.has(page.id) && (
                      <Check className="h-3.5 w-3.5 text-white" />
                    )}
                  </div>

                  {/* Icon */}
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-lg">
                    {page.icon || '📄'}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-gray-900">
                      {page.title || 'Untitled'}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {page.connection?.workspaceName && (
                        <span>{page.connection.workspaceName}</span>
                      )}
                      <span>-</span>
                      <span>{formatDate(page.notionUpdatedAt)}</span>
                    </div>
                  </div>

                  {/* External link */}
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">{success.message}</span>
        </div>
      )}

      {/* Import Button */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleImport}
          disabled={selectedIds.size === 0 || importing}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {importing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" />
              Import {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
