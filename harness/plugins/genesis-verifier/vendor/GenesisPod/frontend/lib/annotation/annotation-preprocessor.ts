/**
 * Annotation Preprocessor
 *
 * Core module for the React-controlled annotation highlighting approach.
 * This preprocessor transforms raw text and annotations into annotated segments
 * that can be directly rendered by React components.
 *
 * Key benefits:
 * - No DOM manipulation after React renders
 * - No React reconciliation conflicts
 * - Simpler, more maintainable code
 */

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Annotation {
  id: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  selectorPrefix?: string;
  selectorSuffix?: string;
  color: AnnotationColor;
  status?: 'active' | 'resolved' | 'archived';
}

export interface AnnotatedSegment {
  /** The text content of this segment */
  text: string;
  /** If this segment is annotated, the annotation ID */
  annotationId?: string;
  /** If annotated, the highlight color */
  color?: AnnotationColor;
  /** For cross-paragraph annotations, indicates if this is start/middle/end */
  position?: 'start' | 'middle' | 'end' | 'full';
}

export interface AnnotationMatch {
  annotationId: string;
  color: AnnotationColor;
  startIndex: number;
  endIndex: number;
}

/**
 * Normalize whitespace in text for matching purposes
 * - Converts all whitespace (newlines, tabs, multiple spaces) to single spaces
 * - Removes zero-width and invisible characters
 * - Normalizes quotes and punctuation for better matching
 */
export function normalizeWhitespace(text: string): string {
  return (
    text
      // Remove zero-width characters and other invisible characters
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
      // Normalize all whitespace to single space
      .replace(/\s+/g, ' ')
      // Normalize different quote styles
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
 * Remove citation markers from text for fuzzy matching
 * Handles: [1], [1, 2], [资料 1], etc.
 */
function removeCitationMarkers(text: string): string {
  return text
    .replace(/\[(\d+(?:\s*[,、]\s*\d+)*)\]/g, '')
    .replace(/\[资料\s*\d+(?:\s*[,、]\s*\d+)*\]/g, '')
    .replace(/__CITE_GROUP_[\d_]+__/g, '')
    .replace(/CITE_GROUP_\d+(?:_\d+)*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the position of annotation text within content
 * Uses multiple matching strategies for resilience
 */
function findAnnotationPosition(
  normalizedContent: string,
  annotation: Annotation
): { start: number; end: number } | null {
  const normalizedTarget = normalizeWhitespace(annotation.selectedText);

  if (!normalizedTarget) return null;

  // Strategy 1: Exact match
  const index = normalizedContent.indexOf(normalizedTarget);
  if (index !== -1) {
    return { start: index, end: index + normalizedTarget.length };
  }

  // Strategy 2: Match with citation markers removed
  const contentWithoutCitations = removeCitationMarkers(normalizedContent);
  const targetWithoutCitations = removeCitationMarkers(normalizedTarget);

  if (targetWithoutCitations.length > 10) {
    const citationFreeIndex = contentWithoutCitations.indexOf(
      targetWithoutCitations
    );
    if (citationFreeIndex !== -1) {
      // Find approximate position in original
      const firstWords = targetWithoutCitations
        .split(' ')
        .slice(0, 5)
        .join(' ');
      const originalIndex = normalizedContent.indexOf(firstWords);
      if (originalIndex !== -1) {
        return {
          start: originalIndex,
          end: originalIndex + normalizedTarget.length,
        };
      }
    }
  }

  // Strategy 3: First 50 characters match
  const shortTarget = normalizedTarget.slice(0, 50);
  if (shortTarget.length >= 20) {
    const shortIndex = normalizedContent.indexOf(shortTarget);
    if (shortIndex !== -1) {
      return { start: shortIndex, end: shortIndex + normalizedTarget.length };
    }
  }

  // Strategy 4: First 3 words match
  const words = normalizedTarget.split(' ');
  if (words.length >= 3) {
    const firstThreeWords = words.slice(0, 3).join(' ');
    if (firstThreeWords.length >= 10) {
      const wordIndex = normalizedContent.indexOf(firstThreeWords);
      if (wordIndex !== -1) {
        return { start: wordIndex, end: wordIndex + normalizedTarget.length };
      }
    }
  }

  // Strategy 5: Use prefix/suffix context if available
  if (annotation.selectorPrefix || annotation.selectorSuffix) {
    const normalizedPrefix = annotation.selectorPrefix
      ? normalizeWhitespace(annotation.selectorPrefix)
      : '';
    const normalizedSuffix = annotation.selectorSuffix
      ? normalizeWhitespace(annotation.selectorSuffix)
      : '';

    // Try to find by context
    if (normalizedPrefix) {
      const prefixIndex = normalizedContent.indexOf(normalizedPrefix);
      if (prefixIndex !== -1) {
        const searchStart = prefixIndex + normalizedPrefix.length;
        // Look for the first few words after prefix
        const firstTwoWords = words.slice(0, 2).join(' ');
        const afterPrefix = normalizedContent.slice(searchStart);
        const targetInAfter = afterPrefix.indexOf(firstTwoWords);
        if (targetInAfter !== -1 && targetInAfter < 20) {
          const actualStart = searchStart + targetInAfter;
          return {
            start: actualStart,
            end: Math.min(
              actualStart + normalizedTarget.length,
              normalizedContent.length
            ),
          };
        }
      }
    }
  }

  // Strategy 6: Last 50 characters match (for cross-paragraph annotations)
  if (normalizedTarget.length >= 50) {
    const lastPart = normalizedTarget.slice(-50);
    const lastIndex = normalizedContent.indexOf(lastPart);
    if (lastIndex !== -1) {
      // Calculate approximate start based on target length
      const estimatedStart = Math.max(
        0,
        lastIndex - (normalizedTarget.length - 50)
      );
      return {
        start: estimatedStart,
        end: lastIndex + lastPart.length,
      };
    }
  }

  // Strategy 7: Middle portion match (for annotations that may have been truncated)
  if (normalizedTarget.length >= 60) {
    const middleStart = Math.floor(normalizedTarget.length / 3);
    const middlePart = normalizedTarget.slice(middleStart, middleStart + 40);
    if (middlePart.length >= 30) {
      const middleIndex = normalizedContent.indexOf(middlePart);
      if (middleIndex !== -1) {
        const estimatedStart = Math.max(0, middleIndex - middleStart);
        return {
          start: estimatedStart,
          end: Math.min(
            estimatedStart + normalizedTarget.length,
            normalizedContent.length
          ),
        };
      }
    }
  }

  // Strategy 8: Match first line/sentence (for multi-line annotations)
  const firstLine = normalizedTarget
    .split(/[。\.\n]/)
    .find((s) => s.length > 10);
  if (firstLine && firstLine.length >= 15) {
    const firstLineNorm = normalizeWhitespace(firstLine);
    const lineIndex = normalizedContent.indexOf(firstLineNorm);
    if (lineIndex !== -1) {
      return {
        start: lineIndex,
        end: Math.min(
          lineIndex + normalizedTarget.length,
          normalizedContent.length
        ),
      };
    }
  }

  // Strategy 9: Match last line/sentence (for multi-line annotations)
  const sentences = normalizedTarget
    .split(/[。\.\n]/)
    .filter((s) => s.length > 10);
  if (sentences.length > 1) {
    const lastSentence = sentences[sentences.length - 1];
    if (lastSentence && lastSentence.length >= 15) {
      const lastSentenceNorm = normalizeWhitespace(lastSentence);
      const sentenceIndex = normalizedContent.indexOf(lastSentenceNorm);
      if (sentenceIndex !== -1) {
        const estimatedStart = Math.max(
          0,
          sentenceIndex - (normalizedTarget.length - lastSentence.length)
        );
        return {
          start: estimatedStart,
          end: sentenceIndex + lastSentenceNorm.length,
        };
      }
    }
  }

  // Strategy 10: Unique phrase match (find longest unique phrase)
  for (let phraseLen = 30; phraseLen >= 15; phraseLen -= 5) {
    for (
      let offset = 0;
      offset <= normalizedTarget.length - phraseLen;
      offset += 10
    ) {
      const phrase = normalizedTarget.slice(offset, offset + phraseLen);
      const firstOccurrence = normalizedContent.indexOf(phrase);
      if (firstOccurrence !== -1) {
        // Check if this is the only occurrence (unique)
        const secondOccurrence = normalizedContent.indexOf(
          phrase,
          firstOccurrence + 1
        );
        if (secondOccurrence === -1) {
          const estimatedStart = Math.max(0, firstOccurrence - offset);
          return {
            start: estimatedStart,
            end: Math.min(
              estimatedStart + normalizedTarget.length,
              normalizedContent.length
            ),
          };
        }
      }
    }
  }

  return null;
}

/**
 * Find all annotation matches in a text string
 */
export function findAnnotationMatches(
  text: string,
  annotations: Annotation[]
): AnnotationMatch[] {
  const normalizedText = normalizeWhitespace(text);
  const matches: AnnotationMatch[] = [];

  // Filter active annotations
  const activeAnnotations = annotations.filter(
    (a) => a.status !== 'resolved' && a.status !== 'archived'
  );

  for (const annotation of activeAnnotations) {
    const position = findAnnotationPosition(normalizedText, annotation);
    if (position) {
      matches.push({
        annotationId: annotation.id,
        color: annotation.color,
        startIndex: position.start,
        endIndex: position.end,
      });
    }
  }

  // Sort by start position for proper segment splitting
  matches.sort((a, b) => a.startIndex - b.startIndex);

  return matches;
}

/**
 * Build a mapping from normalized positions back to original positions
 */
function buildPositionMap(originalText: string): {
  normalizedText: string;
  toOriginal: number[];
  toNormalized: Map<number, number>;
} {
  const toOriginal: number[] = [];
  const toNormalized = new Map<number, number>();
  let normalizedText = '';
  let lastWasSpace = false;

  for (let i = 0; i < originalText.length; i++) {
    const char = originalText[i];
    const isSpace = /\s/.test(char);

    if (isSpace) {
      if (!lastWasSpace && normalizedText.length > 0) {
        toNormalized.set(i, normalizedText.length);
        toOriginal.push(i);
        normalizedText += ' ';
      }
      lastWasSpace = true;
    } else {
      toNormalized.set(i, normalizedText.length);
      toOriginal.push(i);
      normalizedText += char;
      lastWasSpace = false;
    }
  }

  // Trim trailing space
  if (normalizedText.endsWith(' ')) {
    normalizedText = normalizedText.slice(0, -1);
    toOriginal.pop();
  }

  return { normalizedText, toOriginal, toNormalized };
}

/**
 * Convert normalized position to original text position
 */
function normalizedToOriginal(
  normalizedPos: number,
  toOriginal: number[],
  originalLength: number
): number {
  if (normalizedPos >= toOriginal.length) {
    return originalLength;
  }
  return toOriginal[normalizedPos] ?? originalLength;
}

/**
 * Split text into annotated segments based on annotation matches
 */
export function splitTextIntoSegments(
  text: string,
  annotations: Annotation[]
): AnnotatedSegment[] {
  if (!text || annotations.length === 0) {
    return [{ text }];
  }

  // Build position mapping for accurate original positions
  const { normalizedText, toOriginal } = buildPositionMap(text);

  // Find matches in normalized text
  const matches = findAnnotationMatches(normalizedText, annotations);

  if (matches.length === 0) {
    return [{ text }];
  }

  const segments: AnnotatedSegment[] = [];
  let currentPos = 0;

  for (const match of matches) {
    // Convert normalized positions to original positions
    const originalStart = normalizedToOriginal(
      match.startIndex,
      toOriginal,
      text.length
    );
    const originalEnd = normalizedToOriginal(
      match.endIndex,
      toOriginal,
      text.length
    );

    // Skip if this match is completely within already processed text (overlapping annotation)
    if (originalEnd <= currentPos) {
      continue;
    }

    // Calculate effective start position to avoid duplicating text in overlaps
    const effectiveStart = Math.max(originalStart, currentPos);

    // Add non-annotated segment before this match (only if there's a gap)
    if (effectiveStart > currentPos) {
      const beforeText = text.slice(currentPos, effectiveStart);
      if (beforeText) {
        segments.push({ text: beforeText });
      }
    }

    // Add annotated segment (from effective start to avoid duplicates)
    const annotatedText = text.slice(effectiveStart, originalEnd);
    if (annotatedText) {
      segments.push({
        text: annotatedText,
        annotationId: match.annotationId,
        color: match.color,
        position: 'full',
      });
    }

    currentPos = originalEnd;
  }

  // Add remaining non-annotated text
  if (currentPos < text.length) {
    const remaining = text.slice(currentPos);
    if (remaining) {
      segments.push({ text: remaining });
    }
  }

  return segments;
}

/**
 * Process content for a single paragraph/block element
 */
export function processTextNode(
  text: string,
  annotations: Annotation[]
): AnnotatedSegment[] {
  return splitTextIntoSegments(text, annotations);
}

/**
 * Check if any annotation matches in the given text
 * Useful for quick checks before expensive processing
 */
export function hasAnnotationsInText(
  text: string,
  annotations: Annotation[]
): boolean {
  const matches = findAnnotationMatches(text, annotations);
  return matches.length > 0;
}

/**
 * Get annotation IDs that match in the given text
 */
export function getMatchingAnnotationIds(
  text: string,
  annotations: Annotation[]
): string[] {
  const matches = findAnnotationMatches(text, annotations);
  return matches.map((m) => m.annotationId);
}

/**
 * Merge overlapping segments (when multiple annotations overlap)
 * Currently returns segments as-is; can be enhanced for overlap handling
 */
export function mergeOverlappingSegments(
  segments: AnnotatedSegment[]
): AnnotatedSegment[] {
  // For now, just return as-is
  // Future enhancement: handle overlapping annotations
  return segments;
}
