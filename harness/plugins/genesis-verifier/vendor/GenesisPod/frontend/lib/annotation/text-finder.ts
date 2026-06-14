/**
 * Text Finder - Core algorithm for finding text ranges in DOM
 *
 * This module provides functions to find text across multiple DOM elements,
 * which is essential for cross-paragraph annotation highlighting.
 *
 * Key features:
 * - Traverses all text nodes in a container
 * - Normalizes whitespace for matching (handles newlines, multiple spaces)
 * - Supports context-based matching with prefix/suffix
 * - Returns DOM Range objects that can span multiple elements
 */

import { logger } from '@/lib/utils/logger';

export interface TextSelector {
  /** The exact text to find */
  exact: string;
  /** Optional context before the selection (improves accuracy) */
  prefix?: string;
  /** Optional context after the selection (improves accuracy) */
  suffix?: string;
}

interface TextNodeInfo {
  node: Text;
  /** Start position in the full text string */
  start: number;
  /** End position in the full text string */
  end: number;
}

/**
 * Normalize whitespace in text for matching purposes
 * - Converts all whitespace (newlines, tabs, multiple spaces) to single spaces
 * - Removes zero-width and invisible characters
 * - Normalizes quotes and punctuation for better matching
 * - Trims leading/trailing whitespace
 */
export function normalizeWhitespace(text: string): string {
  return (
    text
      // Remove zero-width characters and other invisible characters
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
      // Normalize all whitespace to single space
      .replace(/\s+/g, ' ')
      // Normalize different quote styles (helps with copy-paste issues)
      .replace(/[""「」『』]/g, '"')
      .replace(/['']/g, "'")
      // Normalize different dash styles
      .replace(/[–—―]/g, '-')
      // Normalize ellipsis
      .replace(/…/g, '...')
      // Trim
      .trim()
  );
}

/**
 * Build a map of all text nodes with their positions in the full text
 * IMPORTANT: Adds space between block elements to match user selection behavior
 */
function buildTextNodeMap(container: HTMLElement): {
  nodeMap: TextNodeInfo[];
  fullText: string;
} {
  const nodeMap: TextNodeInfo[] = [];
  let fullText = '';
  let lastNode: Text | null = null;

  const treeWalker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node: Text | null;
  while ((node = treeWalker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    if (text.length > 0) {
      // Check if we need to add a space between block elements
      // This ensures text from different paragraphs has separation
      if (lastNode && fullText.length > 0) {
        // Check if current node is in a different block element than last node
        const lastBlockParent = lastNode.parentElement?.closest(
          'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th'
        );
        const currentBlockParent = node.parentElement?.closest(
          'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th'
        );

        if (
          lastBlockParent &&
          currentBlockParent &&
          lastBlockParent !== currentBlockParent
        ) {
          // Different block elements - add a space if not already present
          if (!fullText.endsWith(' ') && !fullText.endsWith('\n')) {
            fullText += ' ';
          }
        }
      }

      const start = fullText.length;
      fullText += text;
      nodeMap.push({
        node,
        start,
        end: fullText.length,
      });
      lastNode = node;
    }
  }

  return { nodeMap, fullText };
}

/**
 * Find the position of normalized text in the original text
 * Returns the position mapping from normalized to original
 */
function buildPositionMap(originalText: string): {
  normalizedText: string;
  originalPositions: number[];
} {
  const originalPositions: number[] = [];
  let normalizedText = '';
  let lastWasSpace = false;

  for (let i = 0; i < originalText.length; i++) {
    const char = originalText[i];
    const isSpace = /\s/.test(char);

    if (isSpace) {
      if (!lastWasSpace && normalizedText.length > 0) {
        // Add a single space
        originalPositions.push(i);
        normalizedText += ' ';
      }
      lastWasSpace = true;
    } else {
      originalPositions.push(i);
      normalizedText += char;
      lastWasSpace = false;
    }
  }

  // Trim trailing space
  if (normalizedText.endsWith(' ')) {
    normalizedText = normalizedText.slice(0, -1);
    originalPositions.pop();
  }

  return { normalizedText, originalPositions };
}

/**
 * Convert a position in normalized text to original text position
 */
function normalizedToOriginalPosition(
  normalizedPos: number,
  originalPositions: number[],
  originalTextLength: number
): number {
  if (normalizedPos >= originalPositions.length) {
    return originalTextLength;
  }
  return originalPositions[normalizedPos] ?? originalTextLength;
}

/**
 * Remove citation markers from text for fuzzy matching
 * Handles: [1], [1, 2], [资料 1], __CITE_GROUP_1__, etc.
 */
function removeCitationMarkers(text: string): string {
  return (
    text
      // Remove citation markers like [1], [1, 2], [资料 1]
      .replace(/\[(\d+(?:\s*[,、]\s*\d+)*)\]/g, '')
      .replace(/\[资料\s*\d+(?:\s*[,、]\s*\d+)*\]/g, '')
      // Remove internal markers like __CITE_GROUP_1_2__
      .replace(/__CITE_GROUP_[\d_]+__/g, '')
      // Remove CITE_GROUP_1_2 format
      .replace(/CITE_GROUP_\d+(?:_\d+)*/g, '')
      // Clean up resulting double spaces
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Find text with context matching
 * Searches for the exact text, using prefix/suffix to disambiguate if multiple matches exist
 * Includes fuzzy matching fallback for better resilience
 */
function findTextWithContext(
  normalizedText: string,
  selector: TextSelector
): number {
  const normalizedExact = normalizeWhitespace(selector.exact);

  if (!normalizedExact) return -1;

  // Strategy 1: Try exact match
  const matches = findAllMatches(normalizedText, normalizedExact);

  // Strategy 2: If no matches, try with citation markers removed
  if (matches.length === 0) {
    const textWithoutCitations = removeCitationMarkers(normalizedText);
    const exactWithoutCitations = removeCitationMarkers(normalizedExact);

    if (exactWithoutCitations.length > 10) {
      // Only if meaningful text remains
      const citationFreeMatches = findAllMatches(
        textWithoutCitations,
        exactWithoutCitations
      );
      if (citationFreeMatches.length > 0) {
        logger.debug(
          '[findTextWithContext] Found match after removing citations'
        );
        // Map the position back to the original text (approximate)
        // Find the first words in the original text
        const firstWords = exactWithoutCitations
          .split(' ')
          .slice(0, 5)
          .join(' ');
        const originalIndex = normalizedText.indexOf(firstWords);
        if (originalIndex !== -1) {
          return originalIndex;
        }
        // Fallback: use the citation-free position (may be slightly off)
        return citationFreeMatches[0];
      }
    }
  }

  // Strategy 3: If still no matches, try fuzzy substring matching
  if (matches.length === 0) {
    // Try matching just the first 50 characters (enough to be unique)
    const shortExact = normalizedExact.slice(0, 50);
    if (shortExact.length >= 20) {
      const shortIndex = normalizedText.indexOf(shortExact);
      if (shortIndex !== -1) {
        logger.debug(
          '[findTextWithContext] Found partial match using first 50 chars'
        );
        return shortIndex;
      }
    }

    // Try matching first few words (at least 5 words or 30 chars)
    const words = normalizedExact.split(' ');
    if (words.length >= 3) {
      const firstThreeWords = words.slice(0, 3).join(' ');
      if (firstThreeWords.length >= 10) {
        const wordIndex = normalizedText.indexOf(firstThreeWords);
        if (wordIndex !== -1) {
          logger.debug(
            '[findTextWithContext] Found partial match using first 3 words'
          );
          return wordIndex;
        }
      }
    }
  }

  if (matches.length === 0) return -1;
  if (matches.length === 1) return matches[0];

  // Multiple matches - use context to disambiguate
  if (selector.prefix || selector.suffix) {
    const normalizedPrefix = selector.prefix
      ? normalizeWhitespace(selector.prefix)
      : '';
    const normalizedSuffix = selector.suffix
      ? normalizeWhitespace(selector.suffix)
      : '';

    // Score each match based on context
    let bestMatch = matches[0];
    let bestScore = 0;

    for (const matchIndex of matches) {
      let score = 0;

      // Check prefix
      if (normalizedPrefix) {
        const textBefore = normalizedText.slice(
          Math.max(0, matchIndex - normalizedPrefix.length - 10),
          matchIndex
        );
        if (textBefore.includes(normalizedPrefix)) {
          score += normalizedPrefix.length;
        }
      }

      // Check suffix
      if (normalizedSuffix) {
        const textAfter = normalizedText.slice(
          matchIndex + normalizedExact.length,
          matchIndex + normalizedExact.length + normalizedSuffix.length + 10
        );
        if (textAfter.includes(normalizedSuffix)) {
          score += normalizedSuffix.length;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = matchIndex;
      }
    }

    return bestMatch;
  }

  // No context provided, return first match
  return matches[0];
}

/**
 * Helper: Find all occurrences of a substring
 */
function findAllMatches(text: string, searchStr: string): number[] {
  const matches: number[] = [];
  let searchStart = 0;
  let index: number;

  while ((index = text.indexOf(searchStr, searchStart)) !== -1) {
    matches.push(index);
    searchStart = index + 1;
  }

  return matches;
}

/**
 * Create a DOM Range from text positions
 */
function createRangeFromPositions(
  nodeMap: TextNodeInfo[],
  startPos: number,
  endPos: number
): Range | null {
  if (nodeMap.length === 0) return null;

  const range = document.createRange();
  let startSet = false;
  let endSet = false;

  for (const nodeInfo of nodeMap) {
    // Find start node
    if (!startSet && startPos >= nodeInfo.start && startPos < nodeInfo.end) {
      const offset = startPos - nodeInfo.start;
      range.setStart(nodeInfo.node, offset);
      startSet = true;
    }

    // Find end node
    if (!endSet && endPos > nodeInfo.start && endPos <= nodeInfo.end) {
      const offset = endPos - nodeInfo.start;
      range.setEnd(nodeInfo.node, offset);
      endSet = true;
      break;
    }
  }

  // Handle edge case: end position is at the very end
  if (startSet && !endSet) {
    const lastNode = nodeMap[nodeMap.length - 1];
    range.setEnd(lastNode.node, lastNode.node.textContent?.length || 0);
  }

  return startSet ? range : null;
}

/**
 * Find a text range in a DOM container
 *
 * @param container The container element to search within
 * @param selector The text selector with exact text and optional context
 * @returns A DOM Range if found, null otherwise
 */
export function findTextRange(
  container: HTMLElement,
  selector: TextSelector
): Range | null {
  if (!container || !selector.exact) {
    logger.warn('[findTextRange] Invalid input:', {
      hasContainer: !!container,
      hasExact: !!selector.exact,
    });
    return null;
  }

  // Build map of all text nodes
  const { nodeMap, fullText } = buildTextNodeMap(container);

  if (!fullText || nodeMap.length === 0) {
    logger.warn('[findTextRange] No text content found in container:', {
      fullTextLength: fullText?.length,
      nodeMapLength: nodeMap.length,
      containerTagName: container.tagName,
      containerChildrenCount: container.children.length,
    });
    return null;
  }

  // Build position mapping for normalization
  const { normalizedText, originalPositions } = buildPositionMap(fullText);

  // Debug: Log normalization info
  logger.debug('[findTextRange] Text analysis:', {
    fullTextLength: fullText.length,
    normalizedTextLength: normalizedText.length,
    selectorExactLength: selector.exact.length,
    selectorExactPreview: selector.exact.slice(0, 50),
  });

  // Find the text
  const normalizedExact = normalizeWhitespace(selector.exact);
  const normalizedMatchIndex = findTextWithContext(normalizedText, selector);

  logger.debug('[findTextRange] Search result:', {
    normalizedExactLength: normalizedExact.length,
    normalizedExactPreview: normalizedExact.slice(0, 50),
    matchIndex: normalizedMatchIndex,
    found: normalizedMatchIndex !== -1,
  });

  if (normalizedMatchIndex === -1) {
    // Debug: Try to understand why the match failed
    const simpleIndex = normalizedText.indexOf(normalizedExact);
    logger.warn('[findTextRange] Text not found. Debug info:', {
      simpleSearchResult: simpleIndex,
      normalizedTextPreview: normalizedText.slice(0, 200),
      searchingFor: normalizedExact.slice(0, 100),
      // Check if there's a partial match
      firstWordsMatch: normalizedText.includes(
        normalizedExact.split(' ').slice(0, 3).join(' ')
      ),
    });
    return null;
  }

  // Convert positions back to original
  const originalStart = normalizedToOriginalPosition(
    normalizedMatchIndex,
    originalPositions,
    fullText.length
  );
  const originalEnd = normalizedToOriginalPosition(
    normalizedMatchIndex + normalizedExact.length,
    originalPositions,
    fullText.length
  );

  // Create the DOM Range
  const range = createRangeFromPositions(nodeMap, originalStart, originalEnd);

  if (!range) {
    logger.warn('[findTextRange] Failed to create range from positions:', {
      originalStart,
      originalEnd,
      nodeMapLength: nodeMap.length,
    });
  }

  return range;
}

/**
 * Extract context (prefix and suffix) around a selection
 *
 * @param container The container element
 * @param startOffset Start offset in the container's text
 * @param endOffset End offset in the container's text
 * @param contextLength How many characters of context to extract
 * @returns Object with prefix and suffix strings
 */
export function extractContext(
  container: HTMLElement,
  startOffset: number,
  endOffset: number,
  contextLength: number = 50
): { prefix: string; suffix: string } {
  const fullText = container.textContent || '';

  const prefix = fullText.slice(
    Math.max(0, startOffset - contextLength),
    startOffset
  );
  const suffix = fullText.slice(
    endOffset,
    Math.min(fullText.length, endOffset + contextLength)
  );

  return { prefix, suffix };
}

/**
 * Calculate offsets for a selection range within a container
 */
export function calculateOffsets(
  container: HTMLElement,
  range: Range
): { startOffset: number; endOffset: number } {
  // Create a range from container start to selection start
  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  const startOffset = preRange.toString().length;

  // Calculate end offset
  const endOffset = startOffset + range.toString().length;

  return { startOffset, endOffset };
}
