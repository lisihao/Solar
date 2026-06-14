'use client';

/**
 * @deprecated This component is deprecated and will be removed in a future version.
 *
 * AnnotationHighlighter uses DOM post-processing to add <mark> elements,
 * which causes conflicts with React's DOM reconciliation, leading to
 * React error #310 ("Failed to execute 'insertBefore' on 'Node'").
 *
 * **Use instead:**
 * - `AnnotatedText` component from `./AnnotatedText.tsx`
 * - `splitTextIntoSegments` from `@/lib/annotation/annotation-preprocessor`
 *
 * These use "React Controlled Highlighting" which renders annotations
 * inline during React's render cycle, avoiding DOM conflicts.
 *
 * ---
 *
 * Original Description:
 * AnnotationHighlighter Component - A React component that applies annotation
 * highlights to DOM content after it has been rendered.
 *
 * Features:
 * - Applies highlights after content renders (DOM-based approach)
 * - Handles cross-paragraph selections
 * - Supports scroll-to-annotation functionality
 * - Updates highlight state when selected annotation changes
 */

import { useEffect, useRef, type RefObject } from 'react';
import { logger } from '@/lib/utils/logger';
import {
  findTextRange,
  highlightRange,
  clearHighlights,
  scrollToAnnotation,
  updateHighlightedAnnotation,
} from '@/lib/annotation';

export interface Annotation {
  id: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  selectorPrefix?: string;
  selectorSuffix?: string;
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
  status?: 'active' | 'resolved' | 'archived';
}

interface AnnotationHighlighterProps {
  /** Ref to the container element containing the content to annotate */
  containerRef: RefObject<HTMLElement>;
  /** List of annotations to apply */
  annotations: Annotation[];
  /** ID of the currently highlighted annotation (for scroll/focus) */
  highlightedAnnotationId?: string | null;
  /** Content string - used to trigger re-highlighting when content changes */
  content?: string;
  /** Whether to only show active annotations */
  activeOnly?: boolean;
  /** Callback when user clicks on an annotation highlight */
  onAnnotationClick?: (annotationId: string) => void;
}

/**
 * CSS for pulse animation - should be added to global styles
 *
 * @keyframes annotation-pulse {
 *   0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
 *   50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5); }
 * }
 * .annotation-pulse {
 *   animation: annotation-pulse 0.5s ease-in-out 3;
 * }
 */

export function AnnotationHighlighter({
  containerRef,
  annotations,
  highlightedAnnotationId,
  content,
  activeOnly = true,
  onAnnotationClick,
}: AnnotationHighlighterProps) {
  const lastHighlightedRef = useRef<string | null>(null);
  const isApplyingRef = useRef(false);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  // Track previous annotations to detect additions vs full rebuilds
  const prevAnnotationIdsRef = useRef<Set<string>>(new Set());
  const isInitialMountRef = useRef(true);

  // Apply highlights when annotations or content changes
  // Uses debounced setTimeout to ensure React has finished rendering before modifying DOM
  useEffect(() => {
    isMountedRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    // Cancel any pending highlight application
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    // Debug: Log container info
    logger.debug('[AnnotationHighlighter] Scheduling highlight application', {
      containerExists: !!container,
      containerTagName: container?.tagName,
      containerTextLength: container?.textContent?.length,
      annotationsCount: annotations.length,
      contentLength: content?.length,
    });

    // Detect what kind of change happened
    const currentIds = new Set(annotations.map((a) => a.id));
    const prevIds = prevAnnotationIdsRef.current;

    // Find new annotations (in current but not in previous)
    const newAnnotationIds = new Set<string>();
    currentIds.forEach((id) => {
      if (!prevIds.has(id)) newAnnotationIds.add(id);
    });

    // Find removed annotations (in previous but not in current)
    const removedAnnotationIds = new Set<string>();
    prevIds.forEach((id) => {
      if (!currentIds.has(id)) removedAnnotationIds.add(id);
    });

    // Update prev ref for next comparison
    prevAnnotationIdsRef.current = currentIds;

    // Determine if this is a simple addition (1 new annotation, no removals)
    const isSimpleAddition =
      !isInitialMountRef.current &&
      newAnnotationIds.size === 1 &&
      removedAnnotationIds.size === 0;

    // Mark as no longer initial mount
    isInitialMountRef.current = false;

    logger.debug('[AnnotationHighlighter] Change detection:', {
      isSimpleAddition,
      newCount: newAnnotationIds.size,
      removedCount: removedAnnotationIds.size,
      totalAnnotations: annotations.length,
    });

    // Determine delay based on change type
    // For simple additions, use a longer delay to let React fully stabilize
    // This prevents DOM conflicts while still applying the highlight
    const baseDelay = isSimpleAddition ? 300 : 50;

    logger.debug('[AnnotationHighlighter] Scheduling highlight with delay:', {
      isSimpleAddition,
      baseDelay,
    });

    // Use queueMicrotask + setTimeout + requestAnimationFrame to ensure React has FULLY finished
    // This triple-layer scheduling prevents "insertBefore" errors from DOM/React conflicts
    queueMicrotask(() => {
      if (!isMountedRef.current) return;

      timeoutIdRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;

        requestAnimationFrame(() => {
          // Check if still mounted and container exists
          if (!isMountedRef.current || !containerRef.current) {
            logger.warn(
              '[AnnotationHighlighter] Container ref became null or unmounted'
            );
            isApplyingRef.current = false;
            return;
          }

          // Skip if already applying (prevents concurrent modifications)
          if (isApplyingRef.current) {
            logger.debug('[AnnotationHighlighter] Skipping - already applying');
            return;
          }

          isApplyingRef.current = true;

          try {
            // Clear existing highlights - wrapped in try-catch for safety
            try {
              clearHighlights(containerRef.current);
            } catch (clearErr) {
              logger.warn(
                '[AnnotationHighlighter] Error clearing highlights, continuing:',
                clearErr
              );
            }

            // Filter annotations
            const annotationsToApply = activeOnly
              ? annotations.filter(
                  (a) => a.status !== 'resolved' && a.status !== 'archived'
                )
              : annotations;

            logger.debug('[AnnotationHighlighter] Annotations to apply:', {
              total: annotations.length,
              filtered: annotationsToApply.length,
              activeOnly,
            });

            // Apply each annotation
            let successCount = 0;
            let failCount = 0;

            annotationsToApply.forEach((annotation, index) => {
              // Check if still mounted before each operation
              if (!isMountedRef.current || !containerRef.current) return;

              // Debug: Log each annotation attempt
              logger.debug(
                `[AnnotationHighlighter] Processing annotation ${index + 1}/${annotationsToApply.length}:`,
                {
                  id: annotation.id,
                  selectedText:
                    annotation.selectedText?.slice(0, 50) +
                    (annotation.selectedText?.length > 50 ? '...' : ''),
                  selectedTextLength: annotation.selectedText?.length,
                  color: annotation.color,
                  hasPrefix: !!annotation.selectorPrefix,
                  hasSuffix: !!annotation.selectorSuffix,
                }
              );

              try {
                const range = findTextRange(containerRef.current, {
                  exact: annotation.selectedText,
                  prefix: annotation.selectorPrefix,
                  suffix: annotation.selectorSuffix,
                });

                if (range) {
                  logger.debug(
                    `[AnnotationHighlighter] ✓ Found range for annotation ${annotation.id}`
                  );
                  highlightRange(range, {
                    id: annotation.id,
                    color: annotation.color,
                    isHighlighted: annotation.id === highlightedAnnotationId,
                  });
                  successCount++;
                } else {
                  logger.warn(
                    `[AnnotationHighlighter] ✗ Could NOT find range for annotation ${annotation.id}`,
                    {
                      searchedText: annotation.selectedText?.slice(0, 100),
                      containerTextPreview:
                        containerRef.current?.textContent?.slice(0, 200),
                    }
                  );
                  failCount++;
                }
              } catch (err) {
                logger.warn(
                  `[AnnotationHighlighter] Error processing annotation ${annotation.id}:`,
                  err
                );
                failCount++;
              }
            });

            logger.debug(
              '[AnnotationHighlighter] Highlight application complete:',
              {
                success: successCount,
                failed: failCount,
                total: annotationsToApply.length,
              }
            );
          } catch (err) {
            logger.error(
              '[AnnotationHighlighter] Error applying highlights:',
              err
            );
          } finally {
            isApplyingRef.current = false;
          }
        }); // End requestAnimationFrame
      }, 0); // setTimeout with 0ms - defers to next event loop
    }); // End queueMicrotask

    // Cleanup function: cancel pending timeout
    // IMPORTANT: Do NOT clear highlights in cleanup - this conflicts with React's DOM reconciliation
    // When React is re-rendering, calling clearHighlights modifies the DOM structure,
    // causing "insertBefore" errors when React tries to reconcile the virtual DOM with actual DOM.
    // The next effect execution will naturally clear and re-apply highlights.
    return () => {
      isMountedRef.current = false;
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      isApplyingRef.current = false;
    };
    // Note: highlightedAnnotationId intentionally NOT included in dependencies
    // The second effect handles highlight state changes via CSS classes only
    // Including it here would cause unnecessary DOM rebuilds that conflict with React reconciliation
  }, [annotations, content, containerRef, activeOnly]);

  // Handle click events on annotation marks
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onAnnotationClick) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if clicked element is an annotation mark or inside one
      const mark = target.closest('[data-annotation-id]');
      if (mark) {
        const annotationId = mark.getAttribute('data-annotation-id');
        if (annotationId) {
          e.preventDefault();
          e.stopPropagation();
          onAnnotationClick(annotationId);
        }
      }
    };

    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [containerRef, onAnnotationClick]);

  // Handle highlighted annotation changes (scroll to annotation)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const currentHighlightedId = highlightedAnnotationId ?? null;

    // Only process if highlighted ID changed
    if (currentHighlightedId === lastHighlightedRef.current) return;
    lastHighlightedRef.current = currentHighlightedId;

    if (!highlightedAnnotationId) {
      // Clear highlight state
      try {
        updateHighlightedAnnotation(container, null);
      } catch (err) {
        logger.warn(
          '[AnnotationHighlighter] Error clearing highlight state:',
          err
        );
      }
      return;
    }

    // Wait for highlights to be applied, then scroll
    // Use retry mechanism since highlight application may take 50-300ms+
    let retryCount = 0;
    const maxRetries = 10;
    const retryDelay = 100; // 100ms between retries
    let timeoutId: NodeJS.Timeout | null = null;

    const attemptScroll = () => {
      if (!containerRef.current) return;

      try {
        // Update highlight state
        updateHighlightedAnnotation(
          containerRef.current,
          highlightedAnnotationId
        );

        // Try to scroll to the annotation
        const success = scrollToAnnotation(
          containerRef.current,
          highlightedAnnotationId
        );

        if (!success && retryCount < maxRetries) {
          // Mark element not found yet, retry after delay
          retryCount++;
          logger.debug(
            `[AnnotationHighlighter] Scroll retry ${retryCount}/${maxRetries} for ${highlightedAnnotationId}`
          );
          timeoutId = setTimeout(attemptScroll, retryDelay);
        } else if (!success) {
          logger.warn(
            `[AnnotationHighlighter] Failed to scroll after ${maxRetries} retries for ${highlightedAnnotationId}`
          );
        }
      } catch (err) {
        logger.warn(
          '[AnnotationHighlighter] Error scrolling to annotation:',
          err
        );
      }
    };

    // Start first attempt after a short delay to allow initial render
    timeoutId = setTimeout(attemptScroll, 50);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [highlightedAnnotationId, containerRef]);

  // This component doesn't render anything - it only applies side effects
  return null;
}

export default AnnotationHighlighter;
