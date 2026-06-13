import type {
  Citation,
  ParsedMessage,
  MessageSegment,
  CitationParseOptions,
  SourceReference,
} from './types';

/**
 * Default citation pattern: matches [1], [2], [1,2], [1, 2, 3], etc.
 */
const DEFAULT_CITATION_PATTERN = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * Parse a message and extract citations
 */
export function parseCitations(
  content: string,
  options: CitationParseOptions
): ParsedMessage {
  const { sources, pattern = DEFAULT_CITATION_PATTERN } = options;
  const citations: Citation[] = [];
  const segments: MessageSegment[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset pattern lastIndex
  pattern.lastIndex = 0;

  while ((match = pattern.exec(content)) !== null) {
    // Add text before the citation
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: content.slice(lastIndex, match.index),
      });
    }

    // Parse citation indices (handles [1], [1,2], [1, 2, 3], etc.)
    const indicesStr = match[1];
    const indices = indicesStr.split(/\s*,\s*/).map((s) => parseInt(s, 10));

    // Create citations for each index
    for (const sourceIndex of indices) {
      const source = sources[sourceIndex - 1]; // Convert to 0-based
      if (source) {
        const citation: Citation = {
          id: `cite-${Date.now()}-${sourceIndex}`,
          sourceIndex,
          sourceId: source.id,
          sourceTitle: source.title,
        };
        citations.push(citation);
        segments.push({
          type: 'citation',
          citation,
        });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    segments.push({
      type: 'text',
      content: content.slice(lastIndex),
    });
  }

  return {
    originalContent: content,
    segments,
    citations,
  };
}

/**
 * Extract all unique source IDs from citations
 */
export function getUniqueSourceIds(citations: Citation[]): string[] {
  return [...new Set(citations.map((c) => c.sourceId))];
}

/**
 * Group citations by source
 */
export function groupCitationsBySource(
  citations: Citation[]
): Map<string, Citation[]> {
  const map = new Map<string, Citation[]>();
  for (const citation of citations) {
    const existing = map.get(citation.sourceId) || [];
    existing.push(citation);
    map.set(citation.sourceId, existing);
  }
  return map;
}

/**
 * Find relevant passage in source content based on context
 * This is a simple implementation - could be enhanced with semantic search
 */
export function findRelevantPassage(
  sourceContent: string,
  contextBefore: string,
  maxLength: number = 200
): { quote: string; startOffset: number; endOffset: number } | null {
  if (!sourceContent || !contextBefore) {
    return null;
  }

  // Extract key terms from context (simple word extraction)
  const contextWords = contextBefore
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(-10); // Last 10 significant words

  if (contextWords.length === 0) {
    return null;
  }

  const contentLower = sourceContent.toLowerCase();
  let bestMatch = { score: 0, start: 0, end: 0 };

  // Sliding window search for best matching passage
  const windowSize = maxLength;
  for (let i = 0; i < sourceContent.length - windowSize; i += 50) {
    const window = contentLower.slice(i, i + windowSize);
    let score = 0;
    for (const word of contextWords) {
      if (window.includes(word)) {
        score++;
      }
    }
    if (score > bestMatch.score) {
      bestMatch = { score, start: i, end: i + windowSize };
    }
  }

  if (bestMatch.score < 2) {
    return null;
  }

  // Expand to sentence boundaries
  let start = bestMatch.start;
  let end = bestMatch.end;

  // Find sentence start
  while (start > 0 && !/[.!?。！？]/.test(sourceContent[start - 1])) {
    start--;
    if (bestMatch.start - start > 100) break;
  }

  // Find sentence end
  while (
    end < sourceContent.length &&
    !/[.!?。！？]/.test(sourceContent[end])
  ) {
    end++;
    if (end - bestMatch.end > 100) break;
  }

  return {
    quote: sourceContent.slice(start, end + 1).trim(),
    startOffset: start,
    endOffset: end + 1,
  };
}

/**
 * Create a citation reference map from sources
 */
export function createSourceReferenceMap(
  sources: SourceReference[]
): Map<string, SourceReference> {
  return new Map(sources.map((s) => [s.id, s]));
}

/**
 * Format citation for display (e.g., [1], [2])
 */
export function formatCitationDisplay(sourceIndex: number): string {
  return `[${sourceIndex}]`;
}

/**
 * Format multiple citations (e.g., [1, 2, 3])
 */
export function formatMultipleCitations(sourceIndices: number[]): string {
  return `[${sourceIndices.join(', ')}]`;
}
