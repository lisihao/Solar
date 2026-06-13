/**
 * DOM Highlighter - Utilities for applying and managing DOM highlights
 *
 * This module provides functions to apply annotation highlights to DOM elements,
 * handling the complexity of ranges that span multiple elements.
 */

import { logger } from '@/lib/utils/logger';

export interface AnnotationData {
  id: string;
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
  isHighlighted?: boolean;
}

// Color mapping for annotation backgrounds
const colorClasses: Record<string, string> = {
  yellow: 'bg-yellow-200',
  green: 'bg-green-200',
  blue: 'bg-blue-200',
  pink: 'bg-pink-200',
  purple: 'bg-purple-200',
};

// Highlighted state class (when annotation is selected in panel)
const highlightedClass = 'ring-2 ring-blue-500 ring-offset-1';

// Data attribute for identifying annotation marks
const ANNOTATION_ATTR = 'data-annotation-id';
const ANNOTATION_MARK_CLASS = 'annotation-mark';

/**
 * Clear all annotation highlights from a container
 * Uses a safe approach that handles DOM inconsistencies
 */
export function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}`);

  // Convert NodeList to Array to avoid issues with live collections during DOM modification
  const marksArray = Array.from(marks);

  marksArray.forEach((mark) => {
    try {
      // Replace mark with its text content
      const parent = mark.parentNode;
      if (parent && parent.contains(mark)) {
        const textNode = document.createTextNode(mark.textContent || '');
        parent.replaceChild(textNode, mark);
        // Normalize to merge adjacent text nodes
        parent.normalize();
      }
    } catch (err) {
      // If DOM operation fails, just remove the mark element
      logger.warn(
        '[clearHighlights] Error replacing mark, attempting removal:',
        err
      );
      try {
        mark.remove();
      } catch {
        // Ignore - mark might already be removed
      }
    }
  });
}

/**
 * Create a mark element for annotation highlighting
 */
function createMarkElement(annotation: AnnotationData): HTMLElement {
  const mark = document.createElement('mark');
  mark.setAttribute(ANNOTATION_ATTR, annotation.id);
  mark.className = `${ANNOTATION_MARK_CLASS} ${colorClasses[annotation.color] || colorClasses.yellow} rounded px-0.5 cursor-pointer transition-all`;

  if (annotation.isHighlighted) {
    mark.className += ` ${highlightedClass}`;
  }

  mark.title = '点击查看批注';

  return mark;
}

/**
 * Check if a node is inside an annotation mark element
 */
function isInsideAnnotationMark(node: Node): boolean {
  let current: Node | null = node.parentNode;
  while (current) {
    if (
      current.nodeType === Node.ELEMENT_NODE &&
      (current as Element).classList?.contains(ANNOTATION_MARK_CLASS)
    ) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Highlight a range that is contained within a single text node
 */
function highlightSingleNodeRange(
  range: Range,
  annotation: AnnotationData
): HTMLElement | null {
  try {
    // Skip if already inside an annotation mark (avoid nested annotations)
    if (isInsideAnnotationMark(range.startContainer)) {
      logger.warn('Skipping highlight: text is already inside an annotation');
      return null;
    }

    const mark = createMarkElement(annotation);
    range.surroundContents(mark);
    return mark;
  } catch (e) {
    // surroundContents can fail if range partially selects non-text nodes
    logger.warn('surroundContents failed:', e);
    return null;
  }
}

/**
 * Safely wrap a text node portion in a mark element
 * Uses a technique that doesn't rely on Range.insertNode to avoid DOM mutation issues
 */
function wrapTextNodePortion(
  textNode: Text,
  startOffset: number,
  endOffset: number,
  annotation: AnnotationData
): HTMLElement | null {
  try {
    const parent = textNode.parentNode;
    if (!parent) return null;

    // Skip if already inside an annotation mark (avoid nested annotations)
    if (isInsideAnnotationMark(textNode)) {
      logger.warn('Skipping wrap: text node is already inside an annotation');
      return null;
    }

    const fullText = textNode.textContent || '';

    // Validate offsets
    if (
      startOffset < 0 ||
      endOffset > fullText.length ||
      startOffset >= endOffset
    ) {
      logger.warn('Invalid offsets for wrap:', {
        startOffset,
        endOffset,
        textLength: fullText.length,
      });
      return null;
    }

    const beforeText = fullText.slice(0, startOffset);
    const highlightText = fullText.slice(startOffset, endOffset);
    const afterText = fullText.slice(endOffset);

    // Create the mark element
    const mark = createMarkElement(annotation);
    mark.textContent = highlightText;

    // Create new text nodes for before/after
    const fragment = document.createDocumentFragment();

    if (beforeText) {
      fragment.appendChild(document.createTextNode(beforeText));
    }
    fragment.appendChild(mark);
    if (afterText) {
      fragment.appendChild(document.createTextNode(afterText));
    }

    // Replace the original text node with our fragment
    parent.replaceChild(fragment, textNode);

    return mark;
  } catch (e) {
    logger.warn('Failed to wrap text node:', e);
    return null;
  }
}

/**
 * Highlight a range that spans multiple nodes
 * This is more complex and requires splitting text nodes
 *
 * IMPORTANT: We process nodes in reverse order to avoid DOM mutation issues
 * when modifying earlier nodes would shift positions of later nodes.
 */
function highlightMultiNodeRange(
  range: Range,
  annotation: AnnotationData
): HTMLElement[] {
  const marks: HTMLElement[] = [];

  try {
    // Store boundary information before modifying DOM
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    // Validate containers
    if (!startContainer || !endContainer) {
      logger.warn('Invalid range containers');
      return marks;
    }

    // Get all text nodes in the range
    interface TextNodeInfo {
      node: Text;
      isStart: boolean;
      isEnd: boolean;
      highlightStart: number;
      highlightEnd: number;
    }

    const textNodeInfos: TextNodeInfo[] = [];

    // Get the common ancestor - if it doesn't exist, bail out
    const commonAncestor = range.commonAncestorContainer;
    if (!commonAncestor) {
      logger.warn('No common ancestor for range');
      return marks;
    }

    const treeWalker = document.createTreeWalker(
      commonAncestor,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip nodes that are already inside annotation marks
          if (isInsideAnnotationMark(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Check if node is within the range
          try {
            const nodeRange = document.createRange();
            nodeRange.selectNode(node);

            // Node is in range if it's not completely before or after
            const comparison1 = range.compareBoundaryPoints(
              Range.START_TO_END,
              nodeRange
            );
            const comparison2 = range.compareBoundaryPoints(
              Range.END_TO_START,
              nodeRange
            );

            if (comparison1 > 0 && comparison2 < 0) {
              return NodeFilter.FILTER_ACCEPT;
            }
          } catch {
            // Range comparison failed, skip this node
          }
          return NodeFilter.FILTER_REJECT;
        },
      }
    );

    let node: Text | null;
    while ((node = treeWalker.nextNode() as Text | null)) {
      const isStart = node === startContainer;
      const isEnd = node === endContainer;
      const textLength = node.textContent?.length || 0;

      textNodeInfos.push({
        node,
        isStart,
        isEnd,
        highlightStart: isStart ? startOffset : 0,
        highlightEnd: isEnd ? endOffset : textLength,
      });
    }

    // Process nodes in REVERSE order to avoid DOM mutation issues
    // When we modify a node, it doesn't affect the position of previous nodes
    for (let i = textNodeInfos.length - 1; i >= 0; i--) {
      const info = textNodeInfos[i];

      // Skip if nothing to highlight
      if (info.highlightStart >= info.highlightEnd) continue;

      // Check if node still has a parent (it might have been removed)
      if (!info.node.parentNode) continue;

      const mark = wrapTextNodePortion(
        info.node,
        info.highlightStart,
        info.highlightEnd,
        annotation
      );

      if (mark) {
        marks.unshift(mark); // Add to beginning to maintain order
      }
    }
  } catch (e) {
    logger.error('Error in highlightMultiNodeRange:', e);
  }

  return marks;
}

/**
 * Apply a highlight to a DOM Range
 *
 * @param range The DOM Range to highlight
 * @param annotation The annotation data
 * @returns Array of mark elements created
 */
export function highlightRange(
  range: Range,
  annotation: AnnotationData
): HTMLElement[] {
  try {
    if (range.collapsed) return [];

    // Validate range before proceeding
    if (!range.startContainer || !range.endContainer) {
      logger.warn('Invalid range: missing start or end container');
      return [];
    }

    // Check if start/end containers are still in the DOM
    if (!range.startContainer.parentNode || !range.endContainer.parentNode) {
      logger.warn('Range containers are not in DOM');
      return [];
    }

    // Check if range is within a single text node
    if (
      range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE
    ) {
      const mark = highlightSingleNodeRange(range, annotation);
      return mark ? [mark] : [];
    }

    // Range spans multiple nodes
    return highlightMultiNodeRange(range, annotation);
  } catch (e) {
    logger.error('Error highlighting range:', e);
    return [];
  }
}

/**
 * Scroll to an annotation mark with animation
 */
export function scrollToAnnotation(
  container: HTMLElement,
  annotationId: string
): boolean {
  const mark = container.querySelector(
    `[${ANNOTATION_ATTR}="${annotationId}"]`
  );

  if (!mark) return false;

  // Scroll into view
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Add pulse animation
  mark.classList.add('annotation-pulse');
  setTimeout(() => {
    mark.classList.remove('annotation-pulse');
  }, 2000);

  return true;
}

/**
 * Update the highlighted state of all annotations
 */
export function updateHighlightedAnnotation(
  container: HTMLElement,
  highlightedId: string | null
): void {
  const allMarks = container.querySelectorAll(`mark.${ANNOTATION_MARK_CLASS}`);

  allMarks.forEach((mark) => {
    const markId = mark.getAttribute(ANNOTATION_ATTR);
    const isHighlighted = markId === highlightedId;

    if (isHighlighted) {
      mark.classList.add(...highlightedClass.split(' '));
    } else {
      highlightedClass.split(' ').forEach((cls) => {
        mark.classList.remove(cls);
      });
    }
  });
}

/**
 * Get all annotation IDs present in a container
 */
export function getAnnotationIds(container: HTMLElement): string[] {
  const marks = container.querySelectorAll(`[${ANNOTATION_ATTR}]`);
  const ids: string[] = [];

  marks.forEach((mark) => {
    const id = mark.getAttribute(ANNOTATION_ATTR);
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  });

  return ids;
}
