'use client';

import React, { useMemo } from 'react';
import { CitationLink } from './CitationLink';
import { parseCitations } from './citationParser';
import type { SourceReference, ParsedMessage } from './types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface CitedContentProps {
  content: string;
  sources: SourceReference[];
  className?: string;
  // If true, render as markdown
  markdown?: boolean;
}

/**
 * Renders content with embedded citation links
 * Parses [1], [2], [1, 2] patterns and replaces with clickable links
 */
export function CitedContent({
  content,
  sources,
  className = '',
  markdown = false,
}: CitedContentProps) {
  const parsed = useMemo(() => {
    return parseCitations(content, { sources });
  }, [content, sources]);

  if (markdown) {
    return (
      <CitedMarkdown
        content={content}
        sources={sources}
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      {parsed.segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={index}>{segment.content}</span>;
        }
        return (
          <CitationLink
            key={index}
            citation={segment.citation}
            className="mx-0.5"
          />
        );
      })}
    </div>
  );
}

/**
 * Renders markdown content with embedded citations
 */
// Annotation type for highlighting
interface Annotation {
  id: string;
  selectedText: string;
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
}

interface CitedMarkdownProps {
  content: string;
  sources: SourceReference[];
  className?: string;
  /** Annotations for highlighting text */
  annotations?: Annotation[];
  /** Currently highlighted annotation ID (for navigation) */
  highlightedAnnotationId?: string | null;
}

export function CitedMarkdown({
  content,
  sources,
  className = '',
  annotations = [],
  highlightedAnnotationId,
}: CitedMarkdownProps) {
  // Pre-process content to replace citation patterns with placeholder markers
  // that won't be affected by markdown parsing
  // Supports: [1], [1, 2], CITE_GROUP_6_8
  const { processedContent, citationMap } = useMemo(() => {
    const map = new Map<
      string,
      { sourceIndex: number; sourceId: string; sourceTitle: string }
    >();
    let processed = content;

    // Pre-clean: remove underscores wrapping bracket citations
    // AI generates patterns like: __[8]__, _[8]_, _ [1], [8]_, "能力"_ [1]
    processed = processed
      // Underscores directly wrapping citations: _[8]_, __[8]__
      .replace(/_+(\[\d+(?:\s*,\s*\d+)*\])_+/g, '$1')
      .replace(/_+(\[\d+(?:\s*,\s*\d+)*\])/g, '$1')
      .replace(/(\[\d+(?:\s*,\s*\d+)*\])_+/g, '$1')
      // Underscores with space before citations: _ [1], __ [1]
      .replace(/_+\s*(\[\d+(?:\s*,\s*\d+)*\])/g, ' $1')
      // Underscores with space after citations: [1]_ , [1]__
      .replace(/(\[\d+(?:\s*,\s*\d+)*\])\s*_+/g, '$1')
      // Underscores between adjacent citations
      .replace(/\]_+\[/g, '][')
      .replace(/\]\s*_+\s*\[/g, '][');

    // First, handle CITE_GROUP_x_y format (AI output without delimiters)
    // Convert to internal __CITE_GROUP_x_y__ marker format directly
    const citeGroupPattern = /CITE_GROUP_(\d+(?:_\d+)*)/g;
    processed = processed.replace(citeGroupPattern, (match, indicesStr) => {
      const indices = indicesStr.split('_').map((s: string) => parseInt(s, 10));
      // Store citation info
      for (const sourceIndex of indices) {
        const source = sources[sourceIndex - 1];
        if (source) {
          map.set(`__CITE_GROUP_${indices.join('_')}___${sourceIndex}`, {
            sourceIndex,
            sourceId: source.id,
            sourceTitle: source.title,
          });
        }
      }
      // Convert CITE_GROUP_6_8 to __CITE_GROUP_6_8__ marker format
      return `__CITE_GROUP_${indices.join('_')}__`;
    });

    // Now handle standard [1], [1, 2] patterns - convert to marker format in one pass
    const bracketPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    processed = processed.replace(bracketPattern, (match, indicesStr) => {
      const indices = indicesStr
        .split(/\s*,\s*/)
        .map((s: string) => parseInt(s, 10));
      // Store citation info
      for (const sourceIndex of indices) {
        const source = sources[sourceIndex - 1];
        if (source) {
          map.set(`__CITE_GROUP_${indices.join('_')}___${sourceIndex}`, {
            sourceIndex,
            sourceId: source.id,
            sourceTitle: source.title,
          });
        }
      }
      // Convert [1, 2] to __CITE_GROUP_1_2__ marker format
      return `__CITE_GROUP_${indices.join('_')}__`;
    });

    // Remove ALL standalone underscores that aren't part of __CITE_GROUP__ markers.
    // After citation conversion, any remaining underscores are AI artifacts.
    // Strategy: temporarily protect markers, strip all underscores, restore markers.
    const markerPlaceholders: string[] = [];
    processed = processed.replace(/__CITE_GROUP_[\d_]+__/g, (marker) => {
      markerPlaceholders.push(marker);
      return `\x00MARKER_${markerPlaceholders.length - 1}\x00`;
    });
    // Remove all underscores (they are artifacts in AI-generated report text)
    processed = processed.replace(/_+/g, '');
    // Restore citation markers
    processed = processed.replace(/\x00MARKER_(\d+)\x00/g, (_, idx) => {
      return markerPlaceholders[parseInt(idx, 10)];
    });

    return { processedContent: processed, citationMap: map };
  }, [content, sources]);

  // Custom component to render citation markers and annotation highlights
  // Override all common markdown elements to ensure citations/annotations are processed everywhere
  const components = useMemo<Components>(
    () => ({
      // Block elements
      p: ({ children, ...props }) => {
        return (
          <p {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </p>
        );
      },
      li: ({ children, ...props }) => {
        return (
          <li {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </li>
        );
      },
      td: ({ children, ...props }) => {
        return (
          <td {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </td>
        );
      },
      th: ({ children, ...props }) => {
        return (
          <th {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </th>
        );
      },
      blockquote: ({ children, ...props }) => {
        return (
          <blockquote {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </blockquote>
        );
      },
      // Headings
      h1: ({ children, ...props }) => {
        return (
          <h1 {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </h1>
        );
      },
      h2: ({ children, ...props }) => {
        return (
          <h2 {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </h2>
        );
      },
      h3: ({ children, ...props }) => {
        return (
          <h3 {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </h3>
        );
      },
      h4: ({ children, ...props }) => {
        return (
          <h4 {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </h4>
        );
      },
      h5: ({ children, ...props }) => {
        return (
          <h5 {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </h5>
        );
      },
      h6: ({ children, ...props }) => {
        return (
          <h6 {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </h6>
        );
      },
      // Inline elements
      strong: ({ children, ...props }) => {
        return (
          <strong {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </strong>
        );
      },
      em: ({ children, ...props }) => {
        return (
          <em {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </em>
        );
      },
      a: ({ children, ...props }) => {
        return (
          <a {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </a>
        );
      },
      span: ({ children, ...props }) => {
        return (
          <span {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </span>
        );
      },
      code: ({ children, className, ...props }) => {
        // Detect inline code: no language class and no newlines
        const codeString = String(children).replace(/\n$/, '');
        const hasLanguage = /language-(\w+)/.test(className || '');
        const hasNewlines = codeString.includes('\n');
        const isInline = !hasLanguage && !hasNewlines;

        // Don't process citations in code blocks
        if (!isInline) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }
        return (
          <code className={className} {...props}>
            {processChildren(
              children,
              sources,
              annotations,
              highlightedAnnotationId
            )}
          </code>
        );
      },
    }),
    // Note: Only sources is used as dependency
    // annotations and highlightedAnnotationId are handled by AnnotationHighlighter via DOM post-processing
    [sources]
  );

  return (
    <div
      className={`
        prose prose-sm prose-headings:font-semibold
        prose-headings:text-gray-900 prose-h1:text-lg
        prose-h1:mt-4 prose-h1:mb-2 prose-h2:text-base
        prose-h2:mt-3 prose-h2:mb-2 prose-h3:text-sm
        prose-h3:mt-2 prose-h3:mb-1 prose-p:text-gray-700
        prose-p:leading-relaxed prose-p:my-2 prose-ul:my-2
        prose-ul:pl-4 prose-ol:my-2
        prose-ol:pl-4 prose-li:my-1
        prose-li:text-gray-700 prose-strong:text-gray-900
        prose-strong:font-semibold prose-blockquote:border-l-purple-400
        prose-blockquote:bg-purple-50 prose-blockquote:py-1
        prose-blockquote:px-3 prose-blockquote:my-2 prose-blockquote:rounded-r
        prose-blockquote:text-gray-700 prose-code:text-purple-600
        prose-code:bg-purple-50 prose-code:px-1 prose-code:rounded max-w-none
        ${className}
      `}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Process children to replace citation markers with CitationLink components
 * and apply annotation highlights
 * Recursively processes nested React elements to handle citations/annotations in any context
 */
function processChildren(
  children: React.ReactNode,
  sources: SourceReference[],
  annotations: Annotation[] = [],
  highlightedAnnotationId?: string | null
): React.ReactNode {
  if (!children) return children;

  if (typeof children === 'string') {
    return processText(children, sources, annotations, highlightedAnnotationId);
  }

  if (typeof children === 'number') {
    return children;
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => {
      if (typeof child === 'string') {
        return (
          <React.Fragment key={index}>
            {processText(child, sources, annotations, highlightedAnnotationId)}
          </React.Fragment>
        );
      }
      // Recursively process nested elements
      if (React.isValidElement(child)) {
        const childProps = child.props as { children?: React.ReactNode };
        return React.cloneElement(
          child as React.ReactElement<{ children?: React.ReactNode }>,
          { key: index },
          processChildren(
            childProps.children,
            sources,
            annotations,
            highlightedAnnotationId
          )
        );
      }
      return child;
    });
  }

  // Handle single React element - recursively process its children
  if (React.isValidElement(children)) {
    const childProps = children.props as { children?: React.ReactNode };
    return React.cloneElement(
      children as React.ReactElement<{ children?: React.ReactNode }>,
      {},
      processChildren(
        childProps.children,
        sources,
        annotations,
        highlightedAnnotationId
      )
    );
  }

  return children;
}

// ============================================================================
// Citation Processing - Refactored into smaller functions
// ============================================================================

/**
 * Citation pattern regex - matches multiple citation formats:
 * 1. __CITE_GROUP_1_2__ - internal marker with delimiters
 * 2. CITE_GROUP_6_8 - AI output format without delimiters
 * 3. [资料 1] or [资料 1, 2] - Chinese reference format
 * 4. [1] or [1, 2] - standard citation format
 * 5. [temp-X-Y] - evidence ID format
 * 6. [uuid] - UUID format
 */
const CITATION_PATTERN =
  /(__CITE_GROUP_[\d_]+__|CITE_GROUP_\d+(?:_\d+)*|\[资料\s*(\d+(?:\s*[,、]\s*\d+)*)\]|\[(temp-\d+-\d+)\]|\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]|\[(\d+(?:\s*,\s*\d+)*)\])/gi;

/**
 * Clean citation-related stray underscores from AI-generated text
 * Removes all underscores as they are artifacts in AI report output
 */
function cleanCitationMarkers(text: string): string {
  return text.replace(/_+/g, '');
}

/**
 * Build evidence ID to source index mapping
 */
function buildEvidenceIdMap(sources: SourceReference[]): Map<string, number> {
  const map = new Map<string, number>();
  sources.forEach((source, index) => {
    map.set(source.id, index + 1);
  });
  return map;
}

/**
 * Parse citation indices from regex match
 */
function parseIndicesFromMatch(
  match: RegExpExecArray,
  evidenceIdMap: Map<string, number>
): number[] {
  // __CITE_GROUP_1_2__ format
  if (match[0].startsWith('__CITE_GROUP_')) {
    const indicesStr = match[0].replace('__CITE_GROUP_', '').replace('__', '');
    return indicesStr.split('_').map((s) => parseInt(s, 10));
  }

  // CITE_GROUP_6_8 format (AI output)
  if (match[0].startsWith('CITE_GROUP_')) {
    const indicesStr = match[0].replace('CITE_GROUP_', '');
    return indicesStr.split('_').map((s) => parseInt(s, 10));
  }

  // [资料 1] or [资料 1, 2] format
  if (match[2]) {
    return match[2].split(/\s*[,、]\s*/).map((s) => parseInt(s, 10));
  }

  // [temp-X-Y] format
  if (match[3]) {
    const sourceIndex = evidenceIdMap.get(match[3]);
    return sourceIndex ? [sourceIndex] : [];
  }

  // [uuid] format
  if (match[4]) {
    const sourceIndex = evidenceIdMap.get(match[4]);
    return sourceIndex ? [sourceIndex] : [];
  }

  // [1] or [1, 2] format
  if (match[5]) {
    return match[5].split(/\s*,\s*/).map((s) => parseInt(s, 10));
  }

  return [];
}

/**
 * Extract quote context around a citation for highlighting
 */
function extractCitationContext(
  text: string,
  matchIndex: number,
  matchLength: number
): string {
  const contextStart = Math.max(0, matchIndex - 100);
  const contextEnd = Math.min(text.length, matchIndex + matchLength + 100);
  let context = text.slice(contextStart, contextEnd);

  // Remove all citation markers from context
  context = context
    .replace(/\[[\d,\s]+\]/g, '')
    .replace(/\[资料\s*[\d,、\s]+\]/g, '')
    .replace(/__CITE_GROUP_[\d_]+__/g, '')
    .replace(/CITE_GROUP_\d+(?:_\d+)*/g, '')
    .replace(/\[temp-\d+-\d+\]/g, '')
    .replace(
      /\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]/gi,
      ''
    )
    .trim();

  // Extract meaningful phrase between punctuation
  const sentenceMatch = context.match(/[^。！？.!?]*[^。！？.!?]/);
  return sentenceMatch ? sentenceMatch[0].trim() : context.slice(0, 80);
}

/**
 * Process text to replace citation markers with CitationLink components
 * and apply annotation highlighting
 */
function processText(
  text: string,
  sources: SourceReference[],
  annotations: Annotation[] = [],
  highlightedAnnotationId?: string | null
): React.ReactNode {
  // Step 1: Clean stray underscores
  const cleanedText = cleanCitationMarkers(text);

  // Step 2: Build evidence ID map
  const evidenceIdMap = buildEvidenceIdMap(sources);

  // Step 3: Extract citations and build parts array
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state for each call
  CITATION_PATTERN.lastIndex = 0;

  while ((match = CITATION_PATTERN.exec(cleanedText)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(cleanedText.slice(lastIndex, match.index));
    }

    // Parse citation indices
    const indices = parseIndicesFromMatch(match, evidenceIdMap);
    if (indices.length === 0) {
      lastIndex = match.index + match[0].length;
      continue;
    }

    // Extract context quote
    const quote = extractCitationContext(
      cleanedText,
      match.index,
      match[0].length
    );

    // Create citation links
    for (const sourceIndex of indices) {
      const source = sources[sourceIndex - 1];
      if (source) {
        parts.push(
          <CitationLink
            key={`${match.index}-${sourceIndex}`}
            citation={{
              id: `cite-${match.index}-${sourceIndex}`,
              sourceIndex,
              sourceId: source.id,
              sourceTitle: source.title,
              quote: quote.length > 10 ? quote : undefined,
            }}
            className="mx-0.5"
          />
        );
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < cleanedText.length) {
    parts.push(cleanedText.slice(lastIndex));
  }

  // Step 4: Apply annotation highlighting
  if (annotations.length > 0) {
    const highlightedParts: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part === 'string') {
        highlightedParts.push(
          ...applyAnnotationHighlights(
            part,
            annotations,
            highlightedAnnotationId,
            i
          )
        );
      } else {
        highlightedParts.push(part);
      }
    }
    return highlightedParts.length === 1
      ? highlightedParts[0]
      : highlightedParts;
  }

  return parts.length === 1 ? parts[0] : parts;
}

/**
 * Apply annotation highlights to text
 * Uses fuzzy matching to handle cross-paragraph selections
 */
function applyAnnotationHighlights(
  text: string,
  annotations: Annotation[],
  highlightedAnnotationId?: string | null,
  keyPrefix: number = 0
): React.ReactNode[] {
  if (!text || annotations.length === 0) {
    return [text];
  }

  // Normalize text for matching (collapse whitespace)
  const normalizeForMatch = (str: string) => str.replace(/\s+/g, ' ').trim();

  // Find all annotation matches in this text
  const matches: Array<{
    start: number;
    end: number;
    annotation: Annotation;
  }> = [];

  for (const annotation of annotations) {
    const normalizedTarget = normalizeForMatch(annotation.selectedText);
    const normalizedText = normalizeForMatch(text);

    // Try exact match first
    const matchIndex = normalizedText.indexOf(normalizedTarget);
    if (matchIndex !== -1) {
      // Map back to original text positions
      const originalStart = findOriginalPosition(text, matchIndex);
      const originalEnd = findOriginalPosition(
        text,
        matchIndex + normalizedTarget.length
      );
      matches.push({
        start: originalStart,
        end: originalEnd,
        annotation,
      });
      continue;
    }

    // For cross-paragraph annotations, try to match first/last parts
    // This handles cases where selectedText spans multiple paragraphs
    const lines = annotation.selectedText.split('\n');
    if (lines.length > 1) {
      // Try matching the first line (paragraph ending)
      const firstLine = normalizeForMatch(lines[0]);
      if (firstLine.length >= 15) {
        // Only try if substantial
        const firstLineIndex = normalizedText.indexOf(firstLine);
        if (
          firstLineIndex !== -1 &&
          normalizedText.indexOf(firstLine) ===
            normalizedText.lastIndexOf(firstLine)
        ) {
          const originalStart = findOriginalPosition(text, firstLineIndex);
          const originalEnd = findOriginalPosition(
            text,
            firstLineIndex + firstLine.length
          );
          matches.push({
            start: originalStart,
            end: originalEnd,
            annotation,
          });
          continue;
        }
      }

      // Try matching the last line (paragraph beginning)
      const lastLine = normalizeForMatch(lines[lines.length - 1]);
      if (lastLine.length >= 15) {
        const lastLineIndex = normalizedText.indexOf(lastLine);
        if (
          lastLineIndex !== -1 &&
          normalizedText.indexOf(lastLine) ===
            normalizedText.lastIndexOf(lastLine)
        ) {
          const originalStart = findOriginalPosition(text, lastLineIndex);
          const originalEnd = findOriginalPosition(
            text,
            lastLineIndex + lastLine.length
          );
          matches.push({
            start: originalStart,
            end: originalEnd,
            annotation,
          });
          continue;
        }
      }
    }

    // Try partial match (first 50 chars or first 3 words)
    const shortTarget = normalizedTarget.slice(0, 50);
    if (shortTarget.length >= 20) {
      const shortIndex = normalizedText.indexOf(shortTarget);
      if (shortIndex !== -1) {
        const originalStart = findOriginalPosition(text, shortIndex);
        // Try to find reasonable end
        const endTarget = normalizedTarget.slice(-30);
        const potentialEnd = normalizedText.indexOf(
          endTarget,
          shortIndex + shortTarget.length - 10
        );
        const originalEnd =
          potentialEnd !== -1
            ? findOriginalPosition(text, potentialEnd + endTarget.length)
            : Math.min(
                originalStart + annotation.selectedText.length,
                text.length
              );
        matches.push({
          start: originalStart,
          end: originalEnd,
          annotation,
        });
        continue;
      }
    }

    // Strategy: Last 50 characters match (for cross-paragraph annotations)
    if (normalizedTarget.length >= 50) {
      const lastPart = normalizedTarget.slice(-50);
      const lastIndex = normalizedText.indexOf(lastPart);
      if (lastIndex !== -1) {
        const estimatedNormStart = Math.max(
          0,
          lastIndex - (normalizedTarget.length - 50)
        );
        const originalStart = findOriginalPosition(text, estimatedNormStart);
        const originalEnd = findOriginalPosition(
          text,
          lastIndex + lastPart.length
        );
        matches.push({
          start: originalStart,
          end: originalEnd,
          annotation,
        });
        continue;
      }
    }

    // Strategy: Middle portion match (for annotations that may have been truncated)
    if (normalizedTarget.length >= 60) {
      const middleStart = Math.floor(normalizedTarget.length / 3);
      const middlePart = normalizedTarget.slice(middleStart, middleStart + 40);
      if (middlePart.length >= 30) {
        const middleIndex = normalizedText.indexOf(middlePart);
        if (middleIndex !== -1) {
          const estimatedNormStart = Math.max(0, middleIndex - middleStart);
          const originalStart = findOriginalPosition(text, estimatedNormStart);
          const originalEnd = findOriginalPosition(
            text,
            Math.min(
              estimatedNormStart + normalizedTarget.length,
              normalizedText.length
            )
          );
          matches.push({
            start: originalStart,
            end: originalEnd,
            annotation,
          });
          continue;
        }
      }
    }

    // Strategy: Unique phrase match (find longest unique phrase)
    for (let phraseLen = 30; phraseLen >= 15; phraseLen -= 5) {
      let found = false;
      for (
        let offset = 0;
        offset <= normalizedTarget.length - phraseLen && !found;
        offset += 10
      ) {
        const phrase = normalizedTarget.slice(offset, offset + phraseLen);
        const firstOccurrence = normalizedText.indexOf(phrase);
        if (firstOccurrence !== -1) {
          // Check if this is the only occurrence (unique)
          const secondOccurrence = normalizedText.indexOf(
            phrase,
            firstOccurrence + 1
          );
          if (secondOccurrence === -1) {
            const estimatedNormStart = Math.max(0, firstOccurrence - offset);
            const originalStart = findOriginalPosition(
              text,
              estimatedNormStart
            );
            const originalEnd = findOriginalPosition(
              text,
              Math.min(
                estimatedNormStart + normalizedTarget.length,
                normalizedText.length
              )
            );
            matches.push({
              start: originalStart,
              end: originalEnd,
              annotation,
            });
            found = true;
          }
        }
      }
      if (found) break;
    }
  }

  // Sort by start position
  matches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (keep first)
  const nonOverlapping = matches.filter((match, i) => {
    if (i === 0) return true;
    const prev = matches[i - 1];
    return match.start >= prev.end;
  });

  if (nonOverlapping.length === 0) {
    return [text];
  }

  // Build result with highlights
  const result: React.ReactNode[] = [];
  let currentPos = 0;

  for (const match of nonOverlapping) {
    // Add text before match
    if (match.start > currentPos) {
      result.push(text.slice(currentPos, match.start));
    }

    // Add highlighted text
    const highlightedText = text.slice(match.start, match.end);
    const isHighlighted = match.annotation.id === highlightedAnnotationId;
    const colorMap: Record<string, string> = {
      yellow: isHighlighted
        ? 'bg-yellow-300 ring-2 ring-yellow-500'
        : 'bg-yellow-100 hover:bg-yellow-200',
      green: isHighlighted
        ? 'bg-green-300 ring-2 ring-green-500'
        : 'bg-green-100 hover:bg-green-200',
      blue: isHighlighted
        ? 'bg-blue-300 ring-2 ring-blue-500'
        : 'bg-blue-100 hover:bg-blue-200',
      pink: isHighlighted
        ? 'bg-pink-300 ring-2 ring-pink-500'
        : 'bg-pink-100 hover:bg-pink-200',
      purple: isHighlighted
        ? 'bg-purple-300 ring-2 ring-purple-500'
        : 'bg-purple-100 hover:bg-purple-200',
    };

    result.push(
      <mark
        key={`${keyPrefix}-${match.annotation.id}-${match.start}`}
        data-annotation-id={match.annotation.id}
        className={`cursor-pointer rounded-sm px-0.5 transition-colors ${colorMap[match.annotation.color] || colorMap.yellow}`}
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent('annotation-click', {
              detail: { annotationId: match.annotation.id },
            })
          );
        }}
      >
        {highlightedText}
      </mark>
    );

    currentPos = match.end;
  }

  // Add remaining text
  if (currentPos < text.length) {
    result.push(text.slice(currentPos));
  }

  return result;
}

/**
 * Find position in original text that corresponds to normalized position
 */
function findOriginalPosition(
  originalText: string,
  normalizedPos: number
): number {
  let origPos = 0;
  let normPos = 0;
  let lastNonSpace = false;

  while (origPos < originalText.length && normPos < normalizedPos) {
    const char = originalText[origPos];
    const isSpace = /\s/.test(char);

    if (isSpace) {
      if (!lastNonSpace || normPos === 0) {
        // Skip leading/consecutive whitespace
        origPos++;
        continue;
      }
      normPos++;
      lastNonSpace = false;
    } else {
      normPos++;
      lastNonSpace = true;
    }
    origPos++;
  }

  return origPos;
}

/**
 * Inline citation that can be used anywhere
 */
interface InlineCitationProps {
  sourceIndex: number;
  sources: SourceReference[];
}

export function InlineCitation({ sourceIndex, sources }: InlineCitationProps) {
  const source = sources[sourceIndex - 1];
  if (!source) return null;

  return (
    <CitationLink
      citation={{
        id: `inline-cite-${sourceIndex}`,
        sourceIndex,
        sourceId: source.id,
        sourceTitle: source.title,
      }}
    />
  );
}
