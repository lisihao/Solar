'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ExternalLink, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import type { Citation } from './types';
import { useCitationOptional } from './CitationContext';
import { triggerCitationClick } from '@/components/common/citations/citationNavigation';
import { useI18n } from '@/lib/i18n';

interface CitationLinkProps {
  citation: Citation;
  className?: string;
  // Show source preview inline (NotebookLM style)
  showPreview?: boolean;
}

/**
 * Clickable citation link that highlights the source when clicked
 * Displays as [1], [2], etc. with hover tooltip and optional expanded preview
 */
export function CitationLink({
  citation,
  className = '',
  showPreview = false,
}: CitationLinkProps) {
  const { t } = useI18n();
  const citationContext = useCitationOptional();
  const [showTooltip, setShowTooltip] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<
    'center' | 'left' | 'right'
  >('center');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    cancelHideTimeout();
    setShowTooltip(true);
  }, [cancelHideTimeout]);

  const handleMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 150);
  }, []);

  // Get source content from context
  const source = citationContext?.sources.find(
    (s) => s.id === citation.sourceId
  );
  const sourceContent = source?.content || source?.abstract || '';

  // Calculate tooltip position to avoid edge overflow
  useEffect(() => {
    if (showTooltip && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipWidth = 384; // w-96 = 24rem = 384px
      const viewportWidth = window.innerWidth;

      // Check if tooltip would overflow on left
      if (rect.left - tooltipWidth / 2 < 16) {
        setTooltipPosition('left');
      }
      // Check if tooltip would overflow on right
      else if (rect.right + tooltipWidth / 2 > viewportWidth - 16) {
        setTooltipPosition('right');
      } else {
        setTooltipPosition('center');
      }
    }
  }, [showTooltip]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (citationContext) {
      // Set highlight and scroll to source via context
      citationContext.setHighlightedSource({
        sourceId: citation.sourceId,
        quote: citation.quote,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
      });
      citationContext.scrollToSource(citation.sourceId);
    } else {
      // Fallback: use shared navigation module
      triggerCitationClick(citation.sourceId);
    }
  };

  const handleExpand = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpanded(!expanded);
  };

  const isHighlighted =
    citationContext?.highlightedSource?.sourceId === citation.sourceId;

  // Get a preview of the source content - show more content
  const getPreview = () => {
    if (citation.quote) return citation.quote;
    if (!sourceContent) return null;
    // Return first 300 chars for more context
    return sourceContent.length > 300
      ? sourceContent.slice(0, 300) + '...'
      : sourceContent;
  };

  const preview = getPreview();

  // Handle click on tooltip to jump to source
  const handleTooltipClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowTooltip(false);

    if (citationContext) {
      citationContext.setHighlightedSource({
        sourceId: citation.sourceId,
        quote: citation.quote,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
      });
      citationContext.scrollToSource(citation.sourceId);
    } else {
      // Fallback: use shared navigation module
      triggerCitationClick(citation.sourceId);
    }
  };

  // Get tooltip position classes based on edge detection
  const getTooltipPositionClasses = () => {
    switch (tooltipPosition) {
      case 'left':
        return 'left-0'; // Align to left edge
      case 'right':
        return 'right-0'; // Align to right edge
      default:
        return 'left-1/2 -translate-x-1/2'; // Center (default)
    }
  };

  // Get arrow position classes
  const getArrowPositionClasses = () => {
    switch (tooltipPosition) {
      case 'left':
        return 'left-4';
      case 'right':
        return 'right-4';
      default:
        return 'left-1/2 -translate-x-1/2';
    }
  };

  return (
    <span className="relative inline">
      <sup
        ref={triggerRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`
          cursor-pointer rounded px-0.5
          font-medium
          transition-all duration-200
          ${
            isHighlighted
              ? 'bg-purple-600 text-white'
              : 'text-purple-600 hover:bg-purple-100 hover:text-purple-800'
          }
          ${className}
        `}
        title={t('topicResearch.deepResearch.citations.jumpToSource', {
          index: citation.sourceIndex,
        })}
      >
        [{citation.sourceIndex}]
      </sup>

      {/* Tooltip with source details - NotebookLM style */}
      {showTooltip && (
        <div
          ref={tooltipRef}
          className={`
            absolute bottom-full z-50 mb-2 w-96
            rounded-lg border border-gray-200 bg-white
            shadow-xl
            ${getTooltipPositionClasses()}
          `}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Header */}
          <div className="flex items-start gap-2 border-b border-gray-100 px-3 py-2">
            <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-purple-100">
              <FileText className="h-3.5 w-3.5 text-purple-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {citation.sourceIndex}
                </span>
                <span className="truncate text-sm font-medium text-gray-900">
                  {citation.sourceTitle}
                </span>
              </div>
            </div>
          </div>

          {/* Content Preview - show more content */}
          {preview && (
            <div className="max-h-48 overflow-y-auto px-3 py-2">
              <p className="text-xs leading-relaxed text-gray-600">
                {citation.quote ? (
                  <span className="italic">"{preview}"</span>
                ) : (
                  preview
                )}
              </p>
            </div>
          )}

          {/* Footer - clickable */}
          <button
            onClick={handleTooltipClick}
            className="flex w-full cursor-pointer items-center justify-between border-t border-gray-100 bg-gray-50 px-3 py-2 transition-colors hover:bg-purple-50"
          >
            <span className="text-xs font-medium text-purple-600">
              {t('topicResearch.deepResearch.citations.viewFullSource')}
            </span>
            <ExternalLink className="h-3.5 w-3.5 text-purple-600" />
          </button>

          {/* Arrow */}
          <div className={`absolute top-full ${getArrowPositionClasses()}`}>
            <div className="h-2 w-2 -translate-y-1 rotate-45 border-b border-r border-gray-200 bg-gray-50" />
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Inline citation with expandable source preview (NotebookLM style)
 */
interface InlineCitationCardProps {
  citation: Citation;
  sourceContent?: string | null;
  className?: string;
}

export function InlineCitationCard({
  citation,
  sourceContent,
  className = '',
}: InlineCitationCardProps) {
  const citationContext = useCitationOptional();
  const [expanded, setExpanded] = useState(false);

  const handleJumpToSource = () => {
    if (citationContext) {
      citationContext.setHighlightedSource({
        sourceId: citation.sourceId,
        quote: citation.quote,
      });
      citationContext.scrollToSource(citation.sourceId);
    }
  };

  const preview = citation.quote || sourceContent?.slice(0, 200);

  return (
    <div
      className={`my-2 overflow-hidden rounded-lg border border-purple-200 bg-purple-50 ${className}`}
    >
      {/* Header - always visible */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-purple-100"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-purple-600 text-[10px] font-bold text-white">
          {citation.sourceIndex}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-purple-900">
          {citation.sourceTitle}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-purple-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-purple-600" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && preview && (
        <div className="border-t border-purple-200 bg-white px-3 py-2">
          <p className="text-xs leading-relaxed text-gray-700">
            {citation.quote ? `"${preview}"` : preview}
            {sourceContent && sourceContent.length > 200 && '...'}
          </p>
          <button
            onClick={handleJumpToSource}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-800"
          >
            <ExternalLink className="h-3 w-3" />
            View full source
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Multiple citation links grouped together
 * Displays as [1, 2, 3] style
 */
interface CitationGroupProps {
  citations: Citation[];
  className?: string;
}

export function CitationGroup({
  citations,
  className = '',
}: CitationGroupProps) {
  if (citations.length === 0) return null;

  if (citations.length === 1) {
    return <CitationLink citation={citations[0]} className={className} />;
  }

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <span className="text-purple-600">[</span>
      {citations.map((citation, index) => (
        <span key={citation.id} className="inline-flex items-center">
          <CitationLink citation={citation} />
          {index < citations.length - 1 && (
            <span className="mx-0.5 text-purple-600">,</span>
          )}
        </span>
      ))}
      <span className="text-purple-600">]</span>
    </span>
  );
}
