/**
 * AI Studio Citation System Types
 *
 * Implements NotebookLM-style citations with:
 * - Numbered references [1], [2], etc.
 * - Click to jump to source
 * - Highlight relevant passage
 */

// Citation reference in AI response
export interface Citation {
  // Unique citation ID
  id: string;
  // Source index (1-based, for display as [1], [2], etc.)
  sourceIndex: number;
  // Source ID (for linking)
  sourceId: string;
  // Source title
  sourceTitle: string;
  // Quoted/referenced passage from source
  quote?: string;
  // Start position in source content (for highlighting)
  startOffset?: number;
  // End position in source content
  endOffset?: number;
}

// Parsed message with citations
export interface ParsedMessage {
  // Original message content
  originalContent: string;
  // Message content with citation markers replaced by components
  segments: MessageSegment[];
  // All citations found in the message
  citations: Citation[];
}

// A segment of the message (either text or citation)
export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'citation'; citation: Citation };

// Source with highlight state
export interface HighlightedSource {
  sourceId: string;
  quote?: string;
  startOffset?: number;
  endOffset?: number;
}

// Citation context for the provider
export interface CitationContextValue {
  // Currently highlighted source
  highlightedSource: HighlightedSource | null;
  // Set highlighted source (when citation is clicked)
  setHighlightedSource: (source: HighlightedSource | null) => void;
  // Scroll to source in the sources panel
  scrollToSource: (sourceId: string) => void;
  // All sources for reference
  sources: SourceReference[];
}

// Minimal source reference for citations
export interface SourceReference {
  id: string;
  title: string;
  content?: string | null;
  abstract?: string | null;
}

// Citation parsing options
export interface CitationParseOptions {
  // Pattern to match citations in text (default: /\[(\d+)\]/g)
  pattern?: RegExp;
  // Sources to map indices to
  sources: SourceReference[];
}
