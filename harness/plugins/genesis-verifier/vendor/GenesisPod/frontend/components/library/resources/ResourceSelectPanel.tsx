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
  FileImage,
  FileVideo,
  File,
  ExternalLink,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { formatDateSafe } from '@/lib/utils/date';

interface Resource {
  id: string;
  title: string;
  type: string;
  sourceUrl?: string;
  thumbnail?: string;
  status: string;
  createdAt: string;
}

interface ResourceSelectPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
}

/**
 * ResourceSelectPanel - Select resources from Explore to import to KB
 * Uses search-based discovery instead of pagination
 */
export default function ResourceSelectPanel({
  knowledgeBaseId,
  onImportComplete,
}: ResourceSelectPanelProps) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    count: number;
    message: string;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Resource type filters - matching AI Explore
  const TYPE_FILTERS = [
    { value: null, label: 'All', icon: '📚' },
    { value: 'YOUTUBE_VIDEO', label: 'YouTube', icon: '🎬' },
    { value: 'PAPER', label: 'Papers', icon: '📄' },
    { value: 'BLOG', label: 'Blog', icon: '✍️' },
    { value: 'NEWS', label: 'News', icon: '📰' },
    { value: 'REPORT', label: 'Reports', icon: '📊' },
    { value: 'POLICY', label: 'Policy', icon: '📜' },
    { value: 'PDF', label: 'PDF', icon: '📑' },
  ];

  // Fetch resources from Explore - search-based approach with type filter
  const fetchResources = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      // Fetch reasonable amount - user can search/filter for specific items
      params.set('take', '50');
      params.set('skip', '0');
      params.set('sortBy', 'createdAt');
      params.set('sortOrder', 'desc');

      if (searchQuery) {
        params.set('search', searchQuery);
      }

      if (selectedType) {
        params.set('type', selectedType);
      }

      const response = await fetch(`${config.apiUrl}/resources?${params}`, {
        headers: {
          ...getAuthHeader(),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch resources');
      }

      const result = await response.json();
      // Handle wrapped response { data: { data: [...], pagination } }
      const responseData = result?.data ?? result;
      const resourceList = Array.isArray(responseData)
        ? responseData
        : responseData?.data || [];
      setResources(resourceList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load resources');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, []);

  // Handle search and type filter with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchResources();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedType]);

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
    if (selectedIds.size === resources.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(resources.map((r) => r.id)));
    }
  };

  const handleImport = async () => {
    if (selectedIds.size === 0) {
      setError('Please select at least one resource');
      return;
    }

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      // Build resources array for the API
      const selectedResources = resources.filter((r) => selectedIds.has(r.id));
      const resourceData = selectedResources.map((r) => ({
        sourceType: 'platform_resource',
        sourceId: r.id,
        title: r.title,
        sourceUrl: r.sourceUrl || '',
        mimeType: getResourceMimeType(r.type),
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
        message: `Successfully imported ${selectedIds.size} resources`,
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

  const getResourceMimeType = (type: string): string => {
    const t = type?.toUpperCase();
    switch (t) {
      case 'PAPER':
      case 'PDF':
      case 'REPORT':
      case 'POLICY':
        return 'application/pdf';
      case 'YOUTUBE_VIDEO':
      case 'VIDEO':
        return 'video/mp4';
      case 'IMAGE':
        return 'image/png';
      default:
        return 'text/plain';
    }
  };

  const getResourceIcon = (type: string) => {
    const t = type?.toUpperCase();
    switch (t) {
      case 'PAPER':
      case 'PDF':
      case 'REPORT':
      case 'POLICY':
        return <FileText className="h-5 w-5 text-red-500" />;
      case 'YOUTUBE_VIDEO':
      case 'VIDEO':
        return <FileVideo className="h-5 w-5 text-purple-500" />;
      case 'IMAGE':
        return <FileImage className="h-5 w-5 text-green-500" />;
      case 'BLOG':
      case 'NEWS':
        return <FileText className="h-5 w-5 text-blue-500" />;
      default:
        return <File className="h-5 w-5 text-gray-500" />;
    }
  };

  const getTypeLabel = (type: string): string => {
    const t = type?.toUpperCase();
    switch (t) {
      case 'YOUTUBE_VIDEO':
        return 'YouTube';
      case 'PAPER':
        return 'Paper';
      case 'BLOG':
        return 'Blog';
      case 'REPORT':
        return 'Report';
      case 'POLICY':
        return 'Policy';
      case 'NEWS':
        return 'News';
      case 'PDF':
        return 'PDF';
      default:
        return type || 'Unknown';
    }
  };

  const formatDate = (dateStr: string) => {
    return formatDateSafe(dateStr, 'datetime-short');
  };

  return (
    <div className="space-y-4">
      {/* Type Filter Tags */}
      <div className="flex flex-wrap gap-2">
        {TYPE_FILTERS.map((filter) => (
          <button
            key={filter.label}
            onClick={() => setSelectedType(filter.value)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              selectedType === filter.value
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>{filter.icon}</span>
            {filter.label}
          </button>
        ))}
      </div>

      {/* Search and Controls */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by title or keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={fetchResources}
            disabled={loading}
            className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {/* Search hint */}
        <p className="text-xs text-gray-500">
          {selectedType
            ? `Filtering by ${TYPE_FILTERS.find((f) => f.value === selectedType)?.label || selectedType}`
            : searchQuery
              ? `Showing results for "${searchQuery}"`
              : 'Showing recent 50 resources. Use filters or search to find specific items.'}
        </p>
      </div>

      {/* Resource List */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span className="ml-2 text-sm text-gray-500">Loading...</span>
          </div>
        ) : resources.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="No resources found"
            size="sm"
            action={
              <a
                href="/explore"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
              >
                Go to Explore to add resources
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            }
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
                    selectedIds.size === resources.length
                      ? 'border-blue-600 bg-blue-600'
                      : 'border-gray-300'
                  }`}
                >
                  {selectedIds.size === resources.length && (
                    <Check className="h-3 w-3 text-white" />
                  )}
                </div>
                Select All ({resources.length})
              </button>
              <span className="text-xs text-gray-500">
                {selectedIds.size} selected
              </span>
            </div>

            {/* Resource Items */}
            <div className="divide-y divide-gray-100">
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  onClick={() => toggleSelect(resource.id)}
                  className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 ${
                    selectedIds.has(resource.id) ? 'bg-blue-50' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                      selectedIds.has(resource.id)
                        ? 'border-blue-600 bg-blue-600'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedIds.has(resource.id) && (
                      <Check className="h-3.5 w-3.5 text-white" />
                    )}
                  </div>

                  {/* Icon */}
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    {getResourceIcon(resource.type)}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium text-gray-900">
                      {resource.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                        {getTypeLabel(resource.type)}
                      </span>
                      <span>{formatDate(resource.createdAt)}</span>
                    </div>
                  </div>
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
