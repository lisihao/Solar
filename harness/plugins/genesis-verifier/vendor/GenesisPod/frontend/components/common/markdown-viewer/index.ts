export { MarkdownViewer } from './MarkdownViewer';
export type { MarkdownViewerProps } from './MarkdownViewer';
export { MarkdownChartSplitViewer } from './MarkdownChartSplitViewer';
export type { MarkdownChartSplitViewerProps } from './MarkdownChartSplitViewer';

// Re-export low-level utilities for advanced consumers that need
// to compose their own ReactMarkdown pipeline (e.g. ReportEditor TipTap).
export { createMarkdownComponents } from '@/lib/markdown/createMarkdownComponents';
export { preprocessLatex } from '@/lib/markdown/preprocessLatex';
export { stripProseBullets } from '@/lib/markdown/stripProseBullets';
export { KATEX_OPTIONS } from '@/lib/markdown/katexOptions';
