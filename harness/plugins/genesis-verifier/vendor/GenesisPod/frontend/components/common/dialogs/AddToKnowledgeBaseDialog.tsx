'use client';

import { useState } from 'react';
import {
  X,
  Database,
  Plus,
  Loader2,
  Check,
  AlertCircle,
  FileText,
} from 'lucide-react';
import {
  useKnowledgeBase,
  type KnowledgeBase,
} from '@/hooks/domain/useKnowledgeBase';
import Link from 'next/link';
import { apiClient } from '@/lib/api/client';

export interface ResourceToAdd {
  id: string;
  name: string;
  type: 'google_drive' | 'notion' | 'url' | 'bookmark' | 'note';
  mimeType?: string;
  url?: string;
}

export interface AddToKnowledgeBaseDialogProps {
  /** Resources to add */
  resources: ResourceToAdd[];
  /** Source type for the knowledge base */
  sourceType: 'GOOGLE_DRIVE' | 'NOTION' | 'URL' | 'BOOKMARK' | 'NOTE';
  /** Close dialog callback */
  onClose: () => void;
  /** Callback when resources are added successfully */
  onSuccess?: (knowledgeBaseId: string, count: number) => void;
}

/**
 * Dialog for adding resources to a knowledge base
 */
export default function AddToKnowledgeBaseDialog({
  resources,
  sourceType,
  onClose,
  onSuccess,
}: AddToKnowledgeBaseDialogProps) {
  const { knowledgeBases, loading: loadingKBs } = useKnowledgeBase();
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Filter knowledge bases that match the source type or are MANUAL type (can accept any source)
  // Also check sourceTypes array for multi-source knowledge bases
  const compatibleKBs = knowledgeBases.filter(
    (kb) =>
      kb.sourceType === sourceType ||
      kb.sourceType === 'MANUAL' ||
      kb.sourceTypes?.includes(sourceType)
  );

  const handleAdd = async () => {
    if (!selectedKbId || resources.length === 0) return;

    setIsAdding(true);
    setError(null);

    try {
      // Call API to add resources to knowledge base
      await apiClient.post(
        `/rag/knowledge-bases/${selectedKbId}/add-resources`,
        {
          resources: resources.map((r) => ({
            sourceId: r.id,
            title: r.name,
            sourceType: r.type,
            mimeType: r.mimeType,
            sourceUrl: r.url,
          })),
        }
      );

      setSuccess(true);
      onSuccess?.(selectedKbId, resources.length);

      // Auto close after success
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to add resources';
      setError(errorMessage);
    } finally {
      setIsAdding(false);
    }
  };

  const getSourceIcon = (type: ResourceToAdd['type']) => {
    switch (type) {
      case 'google_drive':
        return '📁';
      case 'notion':
        return '📝';
      case 'url':
        return '🔗';
      case 'bookmark':
        return '🔖';
      case 'note':
        return '✍️';
      default:
        return '📄';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
              <Database className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Add to Knowledge Base
              </h2>
              <p className="text-sm text-gray-500">
                {resources.length} item{resources.length !== 1 ? 's' : ''}{' '}
                selected
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto px-6 py-4">
          {/* Success State */}
          {success && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <p className="mt-4 text-lg font-medium text-gray-900">
                Successfully Added!
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {resources.length} item{resources.length !== 1 ? 's' : ''} added
                to knowledge base
              </p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
              <div>
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-sm text-red-600">{error}</p>
              </div>
            </div>
          )}

          {/* Main Content */}
          {!success && (
            <>
              {/* Selected Resources Preview */}
              <div className="mb-4">
                <h3 className="mb-2 text-sm font-medium text-gray-700">
                  Selected Items
                </h3>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                  {resources.slice(0, 5).map((resource) => (
                    <div
                      key={resource.id}
                      className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-sm"
                    >
                      <span>{getSourceIcon(resource.type)}</span>
                      <span className="truncate text-gray-700">
                        {resource.name}
                      </span>
                    </div>
                  ))}
                  {resources.length > 5 && (
                    <p className="px-2 py-1 text-xs text-gray-500">
                      +{resources.length - 5} more items...
                    </p>
                  )}
                </div>
              </div>

              {/* Knowledge Base Selection */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-gray-700">
                  Select Knowledge Base
                </h3>

                {loadingKBs ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : compatibleKBs.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed border-gray-300 py-8 text-center">
                    <FileText className="mx-auto h-10 w-10 text-gray-300" />
                    <p className="mt-2 text-sm text-gray-500">
                      No compatible knowledge bases found
                    </p>
                    <Link
                      href="/library?tab=personal-kb"
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Plus className="h-4 w-4" />
                      Create Knowledge Base
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {compatibleKBs.map((kb) => (
                      <button
                        key={kb.id}
                        onClick={() => setSelectedKbId(kb.id)}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                          selectedKbId === kb.id
                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                            selectedKbId === kb.id
                              ? 'bg-blue-100'
                              : 'bg-gray-100'
                          }`}
                        >
                          <Database
                            className={`h-5 w-5 ${
                              selectedKbId === kb.id
                                ? 'text-blue-600'
                                : 'text-gray-500'
                            }`}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate font-medium ${
                              selectedKbId === kb.id
                                ? 'text-blue-900'
                                : 'text-gray-900'
                            }`}
                          >
                            {kb.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {kb._count?.documents ?? 0} documents
                          </p>
                        </div>
                        {selectedKbId === kb.id && (
                          <Check className="h-5 w-5 flex-shrink-0 text-blue-600" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
            <Link
              href="/library?tab=personal-kb"
              className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              <Plus className="h-4 w-4" />
              New Knowledge Base
            </Link>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!selectedKbId || isAdding}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
                Add to Knowledge Base
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
