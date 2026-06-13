'use client';

import React, { useEffect, useRef } from 'react';
import { useCitationOptional } from './CitationContext';

interface SourceHighlightProps {
  sourceId: string;
  content: string;
  className?: string;
}

/**
 * Component that displays source content with highlighted passages
 * When a citation is clicked, the relevant passage is highlighted
 */
export function SourceHighlight({
  sourceId,
  content,
  className = '',
}: SourceHighlightProps) {
  const citationContext = useCitationOptional();
  const highlightRef = useRef<HTMLSpanElement>(null);

  const isHighlighted =
    citationContext?.highlightedSource?.sourceId === sourceId;
  const highlight = citationContext?.highlightedSource;

  // Scroll to highlight when it becomes active
  useEffect(() => {
    if (isHighlighted && highlightRef.current) {
      highlightRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [isHighlighted]);

  // If no highlight or highlight has specific offsets, render with highlights
  if (
    isHighlighted &&
    highlight?.startOffset !== undefined &&
    highlight?.endOffset !== undefined
  ) {
    const before = content.slice(0, highlight.startOffset);
    const highlighted = content.slice(
      highlight.startOffset,
      highlight.endOffset
    );
    const after = content.slice(highlight.endOffset);

    return (
      <div className={className}>
        <span className="text-gray-700">{before}</span>
        <span
          ref={highlightRef}
          className="animate-pulse rounded bg-yellow-200 px-0.5 text-gray-900"
        >
          {highlighted}
        </span>
        <span className="text-gray-700">{after}</span>
      </div>
    );
  }

  // If highlighted but no specific offsets, highlight based on quote search
  if (isHighlighted && highlight?.quote) {
    const quoteIndex = content
      .toLowerCase()
      .indexOf(highlight.quote.toLowerCase());
    if (quoteIndex !== -1) {
      const before = content.slice(0, quoteIndex);
      const highlighted = content.slice(
        quoteIndex,
        quoteIndex + highlight.quote.length
      );
      const after = content.slice(quoteIndex + highlight.quote.length);

      return (
        <div className={className}>
          <span className="text-gray-700">{before}</span>
          <span
            ref={highlightRef}
            className="animate-pulse rounded bg-yellow-200 px-0.5 text-gray-900"
          >
            {highlighted}
          </span>
          <span className="text-gray-700">{after}</span>
        </div>
      );
    }
  }

  // No highlight - render normally with highlight indicator
  return (
    <div
      className={`${className} ${
        isHighlighted
          ? '-ml-3 border-l-4 border-yellow-400 bg-yellow-50 pl-3'
          : ''
      } transition-colors duration-300`}
    >
      {content}
    </div>
  );
}

/**
 * Source card wrapper that indicates if it's being referenced
 */
interface SourceCardHighlightProps {
  sourceId: string;
  children: React.ReactNode;
  className?: string;
}

export function SourceCardHighlight({
  sourceId,
  children,
  className = '',
}: SourceCardHighlightProps) {
  const citationContext = useCitationOptional();
  const cardRef = useRef<HTMLDivElement>(null);

  const isHighlighted =
    citationContext?.highlightedSource?.sourceId === sourceId;

  // Scroll to card when it becomes highlighted
  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [isHighlighted]);

  return (
    <div
      ref={cardRef}
      data-source-id={sourceId}
      className={`
        transition-all duration-300
        ${
          isHighlighted
            ? 'bg-purple-50 shadow-lg ring-2 ring-purple-500 ring-offset-2'
            : ''
        }
        ${className}
      `}
    >
      {children}
      {isHighlighted && (
        <div className="mt-2 flex items-center gap-2 text-xs text-purple-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-purple-600" />
          Referenced in response
        </div>
      )}
    </div>
  );
}

/**
 * Highlight indicator badge to show on source cards
 */
interface HighlightBadgeProps {
  sourceId: string;
  citationIndex?: number;
}

export function HighlightBadge({
  sourceId,
  citationIndex,
}: HighlightBadgeProps) {
  const citationContext = useCitationOptional();

  const isHighlighted =
    citationContext?.highlightedSource?.sourceId === sourceId;

  if (!isHighlighted) return null;

  return (
    <div className="absolute -right-2 -top-2 z-10">
      <span className="flex h-6 w-6 animate-bounce items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white shadow-lg">
        {citationIndex || '!'}
      </span>
    </div>
  );
}
