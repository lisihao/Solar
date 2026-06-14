import React, { useCallback } from 'react';
import { CitationBadge } from '@/components/common/citations/CitationBadge';
import { CitationGroup } from '@/components/common/citations/CitationGroup';
import {
  splitTextIntoSegments,
  type Annotation as PreprocessorAnnotation,
} from '@/lib/annotation';
import { AnnotatedText } from '@/components/common/annotations/AnnotatedText';

interface EvidenceItem {
  id: string;
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  domain?: string | null;
  citationIndex?: number | null;
}

/**
 * Remove consecutive duplicate citations (e.g. [27][27] → [27]).
 * LLM output sometimes repeats the same citation index back-to-back.
 */
function deduplicateConsecutiveCitations(
  parts: React.ReactNode[]
): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastCitationIndex: number | null = null;

  for (const part of parts) {
    if (React.isValidElement(part) && part.type === CitationBadge) {
      const props = part.props as { index: number };
      if (props.index === lastCitationIndex) {
        // Skip duplicate consecutive citation
        continue;
      }
      lastCitationIndex = props.index;
    } else if (typeof part === 'string' && part.trim() !== '') {
      // Non-empty text resets duplicate tracking
      lastCitationIndex = null;
    }
    result.push(part);
  }

  return result;
}

/**
 * Detect runs of 3+ consecutive CitationBadge elements and replace with CitationGroup.
 * A "consecutive" run means CitationBadge elements with only empty/whitespace strings between them.
 */
function foldConsecutiveCitations(parts: React.ReactNode[]): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let currentRun: Array<{
    index: number;
    evidence: {
      id: string;
      title?: string | null;
      url?: string | null;
      snippet?: string | null;
      domain?: string | null;
    };
    key: string;
  }> = [];

  const flushRun = () => {
    if (currentRun.length >= 3) {
      result.push(
        React.createElement(CitationGroup, {
          key: `cg-${currentRun[0].key}`,
          citations: currentRun,
        })
      );
    } else {
      // Not enough to fold - push individual badges back
      currentRun.forEach((c) => {
        result.push(
          React.createElement(CitationBadge, {
            key: c.key,
            index: c.index,
            evidence: c.evidence,
          })
        );
      });
    }
    currentRun = [];
  };

  for (const part of parts) {
    // Check if this is a CitationBadge element
    if (React.isValidElement(part) && part.type === CitationBadge) {
      const props = part.props as {
        index: number;
        evidence: {
          id: string;
          title?: string | null;
          url?: string | null;
          snippet?: string | null;
          domain?: string | null;
        };
        key?: string;
      };
      currentRun.push({
        index: props.index,
        evidence: props.evidence,
        key: String(part.key || `cite-${props.index}`),
      });
      continue;
    }

    // Check if it's a whitespace-only string (allows space between consecutive badges)
    if (typeof part === 'string' && part.trim() === '') {
      // Keep accumulating - whitespace between badges is ok
      if (currentRun.length > 0) continue;
    }

    // Non-badge, non-whitespace: flush any accumulated run
    if (currentRun.length > 0) {
      flushRun();
    }
    result.push(part);
  }

  // Flush any remaining run
  if (currentRun.length > 0) {
    flushRun();
  }

  return result;
}

interface UseReportTextProcessorOptions {
  evidence: EvidenceItem[] | undefined;
  preprocessorAnnotations: PreprocessorAnnotation[];
  highlightedAnnotationId: string | null;
  onAnnotationClick: (annotationId: string) => void;
}

export function useReportTextProcessor({
  evidence,
  preprocessorAnnotations,
  highlightedAnnotationId,
  onAnnotationClick,
}: UseReportTextProcessorOptions) {
  const processTextWithCitations = useCallback(
    (text: string): React.ReactNode => {
      if (!text || !evidence?.length) return text;

      const evidenceIdMap = new Map<string, number>();
      // ★ Build citationIndex → array-position map for numeric citation lookup
      // Evidence items have a citationIndex field (global, possibly non-contiguous)
      // Report text uses these global citationIndex values like [142]
      const citationIndexMap = new Map<number, number>();
      evidence.forEach((ev, idx) => {
        evidenceIdMap.set(ev.id, idx + 1);
        const ci = ev.citationIndex;
        if (ci != null) {
          citationIndexMap.set(ci, idx);
        }
      });

      const citationPattern =
        /\[(\d+(?:\s*,\s*\d+)*)\]|\[(temp-\d+-\d+)\]|\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      citationPattern.lastIndex = 0;

      while ((match = citationPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
          parts.push(text.slice(lastIndex, match.index));
        }

        if (match[1]) {
          const indices = match[1].split(/\s*,\s*/).map((s) => parseInt(s, 10));
          // Skip numbers that are clearly not citation indices (e.g. years like [2026]).
          // Real citations are 1-based and never exceed a few hundred.
          const MAX_CITATION_INDEX = 500;
          if (indices.some((n) => n > MAX_CITATION_INDEX)) {
            parts.push(match[0]); // Render as plain text
            lastIndex = match.index + match[0].length;
            continue;
          }
          indices.forEach((idx, i) => {
            // ★ Unified citation path: always render CitationBadge (purple)
            // Priority: citationIndex map → array position fallback
            const mappedPos = citationIndexMap.get(idx);
            const evidenceItem =
              mappedPos != null ? evidence[mappedPos] : evidence[idx - 1];
            if (evidenceItem) {
              parts.push(
                React.createElement(CitationBadge, {
                  key: `cite-${match!.index}-${idx}-${i}`,
                  index: idx,
                  evidence: evidenceItem,
                })
              );
            } else {
              // Unresolved citation — render as plain text
              parts.push(
                React.createElement(
                  'sup',
                  {
                    key: `cite-${match!.index}-${idx}-${i}`,
                    className: 'text-gray-400 cursor-default',
                    title: `Citation [${idx}] not found`,
                  },
                  `[${idx}]`
                )
              );
            }
          });
        } else if (match[2] || match[3]) {
          const evidenceId = match[2] || match[3];
          const idx = evidenceIdMap.get(evidenceId);
          if (idx) {
            const evidenceItem = evidence[idx - 1];
            parts.push(
              React.createElement(CitationBadge, {
                key: `cite-${match.index}-${evidenceId}`,
                index: idx,
                evidence: evidenceItem,
              })
            );
          } else {
            parts.push(
              React.createElement(
                'sup',
                {
                  key: `cite-unknown-${match.index}`,
                  className:
                    'rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-500',
                  title: evidenceId,
                },
                '[?]'
              )
            );
          }
        }

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
      }

      // ★ Deduplicate consecutive identical citations (e.g. [27][27] → [27])
      const deduped = deduplicateConsecutiveCitations(parts);
      // ★ Post-process: fold consecutive 3+ citations into CitationGroup
      const folded = foldConsecutiveCitations(deduped);
      return folded.length === 1 ? folded[0] : folded;
    },
    [evidence]
  );

  const processText = useCallback(
    (text: string): React.ReactNode => {
      if (!text) return text;

      const segments = splitTextIntoSegments(text, preprocessorAnnotations);

      if (segments.length === 1 && !segments[0].annotationId) {
        return processTextWithCitations(text);
      }

      return React.createElement(AnnotatedText, {
        segments,
        highlightedId: highlightedAnnotationId,
        onAnnotationClick,
        renderText: processTextWithCitations,
      });
    },
    [
      preprocessorAnnotations,
      highlightedAnnotationId,
      onAnnotationClick,
      processTextWithCitations,
    ]
  );

  return { processText, processTextWithCitations };
}
