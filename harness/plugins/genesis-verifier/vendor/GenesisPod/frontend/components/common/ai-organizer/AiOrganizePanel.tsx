'use client';

import { useState, useCallback } from 'react';
import {
  Sparkles,
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { AiSuggestionCard } from './AiSuggestionCard';
import { logger } from '@/lib/utils/logger';
import {
  analyzeFiles,
  applySuggestion,
  type FileInfo,
  type OrganizationSuggestion,
  type BatchOrganizationResult,
} from '@/services/ai-organizer/api';

interface AiOrganizePanelProps {
  files: FileInfo[];
  onClose: () => void;
  onApplied?: (fileId: string) => void;
  title?: string;
  className?: string;
}

type PanelState = 'idle' | 'analyzing' | 'results' | 'error';

export function AiOrganizePanel({
  files,
  onClose,
  onApplied,
  title = 'AI File Organization',
  className = '',
}: AiOrganizePanelProps) {
  const [state, setState] = useState<PanelState>('idle');
  const [result, setResult] = useState<BatchOrganizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    setState('analyzing');
    setError(null);

    try {
      const analyzeResult = await analyzeFiles(files);
      setResult(analyzeResult);
      setState('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze files');
      setState('error');
    }
  }, [files]);

  const handleApply = useCallback(
    async (suggestion: OrganizationSuggestion) => {
      setApplyingId(suggestion.fileId);

      try {
        await applySuggestion({
          resourceId: suggestion.fileId,
          suggestion,
        });

        setAppliedIds((prev) => new Set([...prev, suggestion.fileId]));
        onApplied?.(suggestion.fileId);
      } catch (err) {
        logger.error('Failed to apply suggestion:', err);
      } finally {
        setApplyingId(null);
      }
    },
    [onApplied]
  );

  const handleDismiss = useCallback((fileId: string) => {
    setDismissedIds((prev) => new Set([...prev, fileId]));
  }, []);

  const handleApplyAll = useCallback(async () => {
    if (!result) return;

    const unappliedSuggestions = result.suggestions.filter(
      (s) => !appliedIds.has(s.fileId) && !dismissedIds.has(s.fileId)
    );

    for (const suggestion of unappliedSuggestions) {
      await handleApply(suggestion);
    }
  }, [result, appliedIds, dismissedIds, handleApply]);

  const visibleSuggestions =
    result?.suggestions.filter(
      (s) => !appliedIds.has(s.fileId) && !dismissedIds.has(s.fileId)
    ) || [];

  const appliedCount = appliedIds.size;
  const totalCount = result?.suggestions.length || 0;

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 p-2">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500">
              {files.length} file{files.length !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/50 hover:text-gray-600"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {state === 'idle' && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="rounded-full bg-purple-100 p-4">
              <Sparkles className="h-8 w-8 text-purple-600" />
            </div>
            <h4 className="mt-4 text-lg font-medium text-gray-900">
              Ready to Analyze
            </h4>
            <p className="mt-2 text-center text-sm text-gray-500">
              AI will analyze your files and suggest categories, tags, and
              organization structure.
            </p>
            <button
              onClick={handleAnalyze}
              className="mt-6 flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:from-purple-600 hover:to-blue-600 hover:shadow-lg"
            >
              <Sparkles className="h-4 w-4" />
              Start Analysis
            </button>
          </div>
        )}

        {state === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
            <h4 className="mt-4 text-lg font-medium text-gray-900">
              Analyzing Files...
            </h4>
            <p className="mt-2 text-center text-sm text-gray-500">
              AI is processing your files. This may take a moment.
            </p>
            <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
            </div>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="rounded-full bg-red-100 p-4">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <h4 className="mt-4 text-lg font-medium text-gray-900">
              Analysis Failed
            </h4>
            <p className="mt-2 text-center text-sm text-red-600">{error}</p>
            <button
              onClick={handleAnalyze}
              className="mt-6 flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
          </div>
        )}

        {state === 'results' && result && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-500">
                  <span className="font-medium text-gray-900">
                    {result.processedFiles}
                  </span>{' '}
                  processed
                </span>
                {result.errors.length > 0 && (
                  <span className="text-red-600">
                    {result.errors.length} error
                    {result.errors.length !== 1 ? 's' : ''}
                  </span>
                )}
                {appliedCount > 0 && (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    {appliedCount} applied
                  </span>
                )}
              </div>
              {visibleSuggestions.length > 1 && (
                <button
                  onClick={handleApplyAll}
                  disabled={applyingId !== null}
                  className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  Apply All ({visibleSuggestions.length})
                </button>
              )}
            </div>

            {/* Suggestions */}
            {visibleSuggestions.length > 0 ? (
              <div className="space-y-3">
                {visibleSuggestions.map((suggestion) => (
                  <AiSuggestionCard
                    key={suggestion.fileId}
                    suggestion={suggestion}
                    onApply={handleApply}
                    onDismiss={handleDismiss}
                    isApplying={applyingId === suggestion.fileId}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8">
                <CheckCircle className="h-12 w-12 text-green-500" />
                <h4 className="mt-4 text-lg font-medium text-gray-900">
                  All Done!
                </h4>
                <p className="mt-2 text-center text-sm text-gray-500">
                  {appliedCount > 0
                    ? `${appliedCount} suggestion${appliedCount !== 1 ? 's' : ''} applied successfully.`
                    : 'No suggestions to show.'}
                </p>
                <button
                  onClick={onClose}
                  className="mt-4 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
                >
                  Close
                </button>
              </div>
            )}

            {/* Errors */}
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <h5 className="flex items-center gap-1.5 text-sm font-medium text-red-800">
                  <AlertCircle className="h-4 w-4" />
                  Analysis Errors
                </h5>
                <ul className="mt-2 space-y-1">
                  {result.errors.map((err, i) => (
                    <li key={i} className="text-xs text-red-700">
                      File {err.fileId}: {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
