'use client';

import { useState } from 'react';
import {
  Sparkles,
  Tag,
  FolderOpen,
  FileText,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import type {
  OrganizationSuggestion,
  CategorySuggestion,
  TagSuggestion,
} from '@/services/ai-organizer/api';

interface AiSuggestionCardProps {
  suggestion: OrganizationSuggestion;
  onApply: (suggestion: OrganizationSuggestion) => Promise<void>;
  onDismiss?: (fileId: string) => void;
  isApplying?: boolean;
  className?: string;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const getColor = () => {
    if (confidence >= 0.8) return 'bg-green-100 text-green-700';
    if (confidence >= 0.6) return 'bg-yellow-100 text-yellow-700';
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${getColor()}`}>
      {Math.round(confidence * 100)}%
    </span>
  );
}

function CategoryBadge({
  category,
  showReason,
}: {
  category: CategorySuggestion;
  showReason?: boolean;
}) {
  return (
    <div className="group relative">
      <div className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1">
        <span className="text-sm text-blue-700">{category.category}</span>
        <ConfidenceBadge confidence={category.confidence} />
      </div>
      {showReason && category.reason && (
        <div className="absolute left-0 top-full z-10 mt-1 hidden w-48 rounded bg-gray-800 p-2 text-xs text-white shadow-lg group-hover:block">
          {category.reason}
        </div>
      )}
    </div>
  );
}

function TagBadge({
  tag,
  showReason,
}: {
  tag: TagSuggestion;
  showReason?: boolean;
}) {
  return (
    <div className="group relative">
      <div className="flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5">
        <Tag className="h-3 w-3 text-purple-500" />
        <span className="text-sm text-purple-700">{tag.tag}</span>
        <ConfidenceBadge confidence={tag.confidence} />
      </div>
      {showReason && tag.reason && (
        <div className="absolute left-0 top-full z-10 mt-1 hidden w-48 rounded bg-gray-800 p-2 text-xs text-white shadow-lg group-hover:block">
          {tag.reason}
        </div>
      )}
    </div>
  );
}

export function AiSuggestionCard({
  suggestion,
  onApply,
  onDismiss,
  isApplying = false,
  className = '',
}: AiSuggestionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localApplying, setLocalApplying] = useState(false);

  const handleApply = async () => {
    setLocalApplying(true);
    try {
      await onApply(suggestion);
    } finally {
      setLocalApplying(false);
    }
  };

  const applying = isApplying || localApplying;
  const topCategories = suggestion.categories.slice(0, 2);
  const topTags = suggestion.tags.filter((t) => t.confidence > 0.7).slice(0, 4);

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-100 p-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 p-1.5">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h4 className="line-clamp-1 text-sm font-medium text-gray-900">
              {suggestion.fileName}
            </h4>
            <p className="text-xs text-gray-500">AI Organization Suggestion</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-1 rounded-md bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            {applying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Apply
          </button>
          {onDismiss && (
            <button
              onClick={() => onDismiss(suggestion.fileId)}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Summary */}
        {suggestion.summary && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <FileText className="h-3.5 w-3.5" />
              Summary
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-gray-700">
              {suggestion.summary}
            </p>
          </div>
        )}

        {/* Categories */}
        {topCategories.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <FolderOpen className="h-3.5 w-3.5" />
              Categories
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {topCategories.map((cat, i) => (
                <CategoryBadge key={i} category={cat} showReason={isExpanded} />
              ))}
              {suggestion.categories.length > 2 && !isExpanded && (
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                  +{suggestion.categories.length - 2} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tags */}
        {topTags.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <Tag className="h-3.5 w-3.5" />
              Tags
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {topTags.map((tag, i) => (
                <TagBadge key={i} tag={tag} showReason={isExpanded} />
              ))}
              {suggestion.tags.length > topTags.length && !isExpanded && (
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  +{suggestion.tags.length - topTags.length} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Suggested Folder */}
        {suggestion.suggestedFolder && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <FolderOpen className="h-3.5 w-3.5" />
              Suggested Folder
            </div>
            <div className="mt-1 flex items-center gap-2 rounded bg-gray-50 px-2 py-1.5">
              <span className="text-sm text-gray-700">
                {suggestion.suggestedFolder.folderPath}
              </span>
              <ConfidenceBadge
                confidence={suggestion.suggestedFolder.confidence}
              />
            </div>
          </div>
        )}
      </div>

      {/* Expand/Collapse */}
      {(suggestion.categories.length > 2 || suggestion.tags.length > 4) && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Show More
            </>
          )}
        </button>
      )}
    </div>
  );
}
