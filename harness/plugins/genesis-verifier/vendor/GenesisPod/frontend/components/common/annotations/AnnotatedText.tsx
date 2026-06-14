'use client';

/**
 * AnnotatedText Component
 *
 * A React-controlled component for rendering text with annotation highlights.
 * Unlike the previous DOM-based approach, this component renders highlights
 * directly as React elements, avoiding DOM manipulation conflicts.
 *
 * Features:
 * - Renders annotation highlights inline with text
 * - Supports click-to-navigate functionality
 * - Shows highlighted state for focused annotations
 * - Smooth pulse animation when scrolling to annotation
 */

import { useEffect, useRef, memo, useCallback } from 'react';
import type {
  AnnotatedSegment,
  AnnotationColor,
} from '@/lib/annotation/annotation-preprocessor';

// Color classes mapping
const colorClasses: Record<AnnotationColor, string> = {
  yellow: 'bg-yellow-200/70 hover:bg-yellow-300/70',
  green: 'bg-green-200/70 hover:bg-green-300/70',
  blue: 'bg-blue-200/70 hover:bg-blue-300/70',
  pink: 'bg-pink-200/70 hover:bg-pink-300/70',
  purple: 'bg-purple-200/70 hover:bg-purple-300/70',
};

// Data attribute for annotation identification
const ANNOTATION_ATTR = 'data-annotation-id';

interface AnnotatedTextProps {
  /** Segments to render (from annotation-preprocessor) */
  segments: AnnotatedSegment[];
  /** ID of the currently highlighted annotation (for scroll/focus) */
  highlightedId?: string | null;
  /** Callback when user clicks on an annotation highlight */
  onAnnotationClick?: (annotationId: string) => void;
  /** Additional className for the container */
  className?: string;
  /** Optional function to render text content (e.g., for processing citations) */
  renderText?: (text: string) => React.ReactNode;
}

/**
 * Single annotation mark component
 */
const AnnotationMark = memo(function AnnotationMark({
  segment,
  isHighlighted,
  onClick,
  renderText,
}: {
  segment: AnnotatedSegment;
  isHighlighted: boolean;
  onClick?: () => void;
  renderText?: (text: string) => React.ReactNode;
}) {
  const markRef = useRef<HTMLElement>(null);

  // Scroll into view and animate when highlighted
  useEffect(() => {
    if (isHighlighted && markRef.current) {
      // Scroll to the element
      markRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });

      // Add pulse animation class
      markRef.current.classList.add('annotation-pulse');

      // Remove animation class after it completes
      const timer = setTimeout(() => {
        markRef.current?.classList.remove('annotation-pulse');
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [isHighlighted]);

  const colorClass = colorClasses[segment.color || 'yellow'];

  return (
    <mark
      ref={markRef}
      {...{ [ANNOTATION_ATTR]: segment.annotationId }}
      className={`
        cursor-pointer rounded px-0.5 transition-all duration-200
        ${colorClass}
        ${isHighlighted ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
      `}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-label={`Annotation: ${segment.text?.slice(0, 50)}...`}
    >
      {renderText ? renderText(segment.text) : segment.text}
    </mark>
  );
});

/**
 * AnnotatedText component renders segments with annotation highlights
 */
export const AnnotatedText = memo(function AnnotatedText({
  segments,
  highlightedId,
  onAnnotationClick,
  className,
  renderText,
}: AnnotatedTextProps) {
  const handleClick = useCallback(
    (annotationId: string) => {
      onAnnotationClick?.(annotationId);
    },
    [onAnnotationClick]
  );

  if (!segments || segments.length === 0) {
    return null;
  }

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.annotationId) {
          return (
            <AnnotationMark
              key={`${segment.annotationId}-${index}`}
              segment={segment}
              isHighlighted={highlightedId === segment.annotationId}
              onClick={() => handleClick(segment.annotationId!)}
              renderText={renderText}
            />
          );
        }
        // Non-annotated text - also process with renderText if provided
        return (
          <span key={`text-${index}`}>
            {renderText ? renderText(segment.text) : segment.text}
          </span>
        );
      })}
    </span>
  );
});

/**
 * Hook to scroll to an annotation by ID
 * Can be used outside of AnnotatedText for external navigation
 */
export function useScrollToAnnotation() {
  return useCallback((annotationId: string, container?: HTMLElement) => {
    const searchContainer = container || document;
    const mark = searchContainer.querySelector(
      `[${ANNOTATION_ATTR}="${annotationId}"]`
    );

    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('annotation-pulse');
      setTimeout(() => {
        mark.classList.remove('annotation-pulse');
      }, 1500);
      return true;
    }
    return false;
  }, []);
}

/**
 * Utility function to find an annotation mark element by ID
 */
export function findAnnotationMark(
  annotationId: string,
  container?: HTMLElement
): HTMLElement | null {
  const searchContainer = container || document;
  return searchContainer.querySelector(
    `[${ANNOTATION_ATTR}="${annotationId}"]`
  );
}

/**
 * CSS for pulse animation - should be added to global styles
 * This is also defined in the design doc for consistency
 */
export const annotationPulseCSS = `
@keyframes annotation-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
  50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5); }
}
.annotation-pulse {
  animation: annotation-pulse 0.5s ease-in-out 3;
}
`;

export default AnnotatedText;
