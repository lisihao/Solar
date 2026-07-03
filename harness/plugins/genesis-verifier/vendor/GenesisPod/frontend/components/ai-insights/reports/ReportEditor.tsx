'use client';

/**
 * Report Editor Component
 *
 * v10.0 报告编辑器:
 * - 三种视图模式（预览/富文本编辑/源码编辑）
 * - 富文本编辑器（TipTap WYSIWYG）
 * - 右键上下文菜单支持（AI编辑、批注）
 * - Markdown 工具栏（源码模式）
 * - AI 浮动工具栏（选中文本时显示）
 *
 * 参考 PRD: docs/prd/topic-research-report-editing.md
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  memo,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { KATEX_OPTIONS } from '@/lib/markdown/katexOptions';
import rehypeRaw from 'rehype-raw';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import Highlight from '@tiptap/extension-highlight';
import type {
  TopicReport,
  TopicEvidence,
  ReportChart,
} from '@/lib/types/topic-insights';
import { TextSelectionContextMenu } from '../panels/TextSelectionContextMenu';
import {
  FigureRenderer,
  type FigureEvidenceInfo,
} from '@/components/common/chart-viewer';
import type { AIEditOperation } from '../types';
import { markdownToHtml, turndownService } from '@/lib/markdown/markdownToHtml';
import { injectChartPlaceholdersByChapter } from '@/lib/markdown/injectChartPlaceholders';
import { normalizeReportSection } from '@/lib/markdown/normalizeReportSection';
import { useReportTextProcessor } from '@/lib/markdown/useReportTextProcessor';
import { preprocessLatex } from '@/lib/markdown/preprocessLatex';
import { stripProseBullets } from '@/lib/markdown/stripProseBullets';
import { createMarkdownComponents } from '@/lib/markdown/createMarkdownComponents';
import { TipTapToolbar } from '../editor/TipTapToolbar';
import { ViewModeToggle } from '../editor/ViewModeToggle';
import {
  splitTextIntoSegments,
  findAnnotationMatches,
  normalizeWhitespace,
  type Annotation as PreprocessorAnnotation,
  type AnnotationColor,
} from '@/lib/annotation';
import {
  AnnotatedText,
  useScrollToAnnotation,
} from '@/components/common/annotations/AnnotatedText';
import { formatDateSafe } from '@/lib/utils/date';
import {
  Eye,
  Pencil,
  Brain,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Palette,
} from 'lucide-react';

import { logger } from '@/lib/utils/logger';
import { useI18n } from '@/lib/i18n';
import { LoadingState } from '@/components/ui/states';
// View modes: preview, edit (WYSIWYG)
type ViewMode = 'preview' | 'edit';

// Color mapping for annotation highlights (matches AnnotatedText component)
const ANNOTATION_COLOR_CLASSES: Record<AnnotationColor, string> = {
  yellow: 'bg-yellow-200',
  green: 'bg-green-200',
  blue: 'bg-blue-200',
  pink: 'bg-pink-200',
  purple: 'bg-purple-200',
};

/**
 * Apply annotation highlights to HTML content for TipTap editor
 * Uses the same matching algorithm as preview mode (splitTextIntoSegments)
 * to ensure consistent highlighting across modes.
 */
function applyAnnotationHighlightsToHtml(
  html: string,
  annotations: PreprocessorAnnotation[]
): string {
  if (!annotations || annotations.length === 0) {
    return html;
  }

  // SSR guard
  if (typeof document === 'undefined') return html;

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // Process each text node using the same algorithm as preview mode
  const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  // Process text nodes in reverse order to avoid offset issues when modifying DOM
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const textNode = textNodes[i];
    const text = textNode.textContent || '';
    if (!text.trim()) continue;

    // Use the same splitTextIntoSegments function as preview mode
    const segments = splitTextIntoSegments(text, annotations);

    // If no annotations found in this text node, skip
    if (segments.length === 1 && !segments[0].annotationId) {
      continue;
    }

    // Create a document fragment with the annotated segments
    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      if (segment.annotationId && segment.color) {
        // Annotated segment - wrap in <mark>
        const colorClass =
          ANNOTATION_COLOR_CLASSES[segment.color] || 'bg-yellow-200';
        const mark = document.createElement('mark');
        mark.className = `${colorClass} px-0.5 rounded annotation-highlight`;
        mark.setAttribute('data-annotation-id', segment.annotationId);
        mark.textContent = segment.text;
        fragment.appendChild(mark);
      } else {
        // Plain text segment
        fragment.appendChild(document.createTextNode(segment.text));
      }
    }

    // Replace the text node with the fragment
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return tempDiv.innerHTML;
}

// Annotation type for highlighting
interface ReportAnnotation {
  id: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
  status: 'active' | 'resolved' | 'archived';
  /** Context before the selection for reliable matching */
  selectorPrefix?: string;
  /** Context after the selection for reliable matching */
  selectorSuffix?: string;
}

interface ReportEditorProps {
  report: TopicReport | null;
  /** Evidence data for citation display - if not provided, falls back to report.evidence */
  evidence?: TopicEvidence[];
  isLoading?: boolean;
  onSave?: (content: string) => Promise<void>;
  /**
   * New AI edit callback - opens modal for AI editing
   * (Preferred over onAIEdit)
   */
  onOpenAIEdit?: (selection: {
    text: string;
    startOffset: number;
    endOffset: number;
    selectorPrefix?: string;
    selectorSuffix?: string;
  }) => void;
  /**
   * Legacy AI edit callback
   * @deprecated Use onOpenAIEdit instead
   */
  onAIEdit?: (
    operation: AIEditOperation,
    selection?: string
  ) => Promise<string>;
  onAddAnnotation?: (data: {
    selectedText: string;
    startOffset: number;
    endOffset: number;
    color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
    /** Context before the selection for reliable matching */
    selectorPrefix?: string;
    /** Context after the selection for reliable matching */
    selectorSuffix?: string;
  }) => void;
  /** Annotations for highlighting in preview */
  annotations?: ReportAnnotation[];
  /** Currently highlighted annotation ID (for navigation) */
  highlightedAnnotationId?: string | null;
  /**
   * Whether to show annotation highlights in the content.
   * When false, annotations are still available for adding but not displayed as highlights.
   * This allows clean reading when annotation panel is closed.
   * Default: true (show highlights)
   */
  showAnnotationHighlights?: boolean;
}

/**
 * Custom comparison function for React.memo
 *
 * Prevents unnecessary re-renders when parent state changes (like sidePanelType)
 * but the actual content data hasn't changed.
 *
 * With React Controlled Highlighting, we now render annotations inline via React.
 * This means we need to compare:
 * - report, evidence, isLoading - core data
 * - annotations - content for highlighting
 * - highlightedAnnotationId - for scroll-to and highlight state
 *
 * What we DON'T compare:
 * - Callback functions (onSave, onAIEdit, onAddAnnotation) - parent may use inline functions
 */
function areReportEditorPropsEqual(
  prevProps: ReportEditorProps,
  nextProps: ReportEditorProps
): boolean {
  // Compare core data props
  if (prevProps.report !== nextProps.report) return false;
  if (prevProps.evidence !== nextProps.evidence) return false;
  if (prevProps.isLoading !== nextProps.isLoading) return false;

  // Compare highlightedAnnotationId (needed for React Controlled Highlighting)
  if (prevProps.highlightedAnnotationId !== nextProps.highlightedAnnotationId)
    return false;

  // Compare showAnnotationHighlights
  if (prevProps.showAnnotationHighlights !== nextProps.showAnnotationHighlights)
    return false;

  // Deep compare annotations
  const prevAnnotations = prevProps.annotations || [];
  const nextAnnotations = nextProps.annotations || [];
  if (prevAnnotations.length !== nextAnnotations.length) return false;

  for (let i = 0; i < prevAnnotations.length; i++) {
    const prev = prevAnnotations[i];
    const next = nextAnnotations[i];
    if (
      prev.id !== next.id ||
      prev.selectedText !== next.selectedText ||
      prev.color !== next.color ||
      prev.status !== next.status
    ) {
      return false;
    }
  }

  // All data props are equal - skip re-render
  return true;
}

/**
 * Extract markdown from a fullReport field that may contain embedded JSON.
 * Handles two cases:
 * - Entire string is JSON: parse and extract fullText
 * - JSON block embedded within markdown: find it, extract fullText, replace inline
 */
/**
 * Extract markdown from a JSON report embedded in content.
 *
 * Strategy:
 * 1. Try JSON.parse on the whole content if it starts with {
 * 2. Find embedded JSON by regex, try JSON.parse
 * 3. Fallback: regex-extract "fullText" value directly (handles invalid JSON)
 * 4. Last resort: strip the JSON-like block entirely
 */
function extractMarkdownFromJsonReport(content: string): string {
  // Case A: Entire content is JSON
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const ft =
        parsed.fullText ||
        parsed.executiveSummary?.fullText ||
        (typeof parsed.executiveSummary === 'string'
          ? parsed.executiveSummary
          : null);
      if (ft && typeof ft === 'string') return ft;
    } catch {
      // Not valid JSON as a whole
    }
  }

  // Case B: Find embedded JSON block
  const jsonStartPattern =
    /[\r\n]\s*\{[\s\r\n]*"(?:executiveSummary|fullText|preface|tableOfContents)"/;
  const match = jsonStartPattern.exec(content);
  if (!match || match.index === undefined) return content;

  const bracePos = content.indexOf('{', match.index);
  if (bracePos === -1) return content;

  // Find where the JSON block ends: look for the next markdown heading
  // after the JSON start (## something), which marks the end of the JSON block
  const afterBrace = content.slice(bracePos);

  // Strategy 1: Try JSON.parse with brace matching (handles well-formed JSON)
  try {
    // Find the JSON block boundary by looking for \n## after the opening {
    // The next markdown section header signals end of JSON
    const nextSectionMatch = afterBrace.match(/\n#{1,3}\s+\S/);
    if (nextSectionMatch && nextSectionMatch.index) {
      // Find the last } before the next section
      const jsonRegion = afterBrace.slice(0, nextSectionMatch.index);
      const lastBrace = jsonRegion.lastIndexOf('}');
      if (lastBrace > 0) {
        const jsonCandidate = jsonRegion.slice(0, lastBrace + 1);
        const parsed = JSON.parse(jsonCandidate);
        const ft =
          parsed.executiveSummary?.fullText ||
          parsed.fullText ||
          (typeof parsed.executiveSummary === 'string'
            ? parsed.executiveSummary
            : null);
        if (ft && typeof ft === 'string') {
          const endIdx = bracePos + lastBrace + 1;
          return content.slice(0, bracePos) + ft + content.slice(endIdx);
        }
      }
    }
  } catch {
    // JSON.parse failed, try regex extraction
  }

  // Strategy 2: Regex-extract "fullText" value directly (handles malformed JSON)
  // Match "fullText": "..." where the value may contain escaped characters
  const fullTextMatch = afterBrace.match(/"fullText"\s*:\s*"/);
  if (fullTextMatch && fullTextMatch.index !== undefined) {
    const valueStart = fullTextMatch.index + fullTextMatch[0].length;
    // Walk forward to find the unescaped closing quote
    let i = valueStart;
    while (i < afterBrace.length) {
      if (afterBrace[i] === '\\') {
        i += 2; // skip escaped character
        continue;
      }
      if (afterBrace[i] === '"') {
        // Found closing quote
        const rawValue = afterBrace.slice(valueStart, i);
        // Unescape JSON string escapes
        const unescaped = rawValue
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');

        if (unescaped.length > 50) {
          // Find end of the entire JSON block for replacement
          const nextSection = afterBrace.match(/\n#{1,3}\s+\S/);
          const jsonEndPos = nextSection?.index
            ? bracePos + nextSection.index
            : bracePos + afterBrace.indexOf('}', i) + 1;
          return (
            content.slice(0, bracePos) + unescaped + content.slice(jsonEndPos)
          );
        }
        break;
      }
      i++;
    }
  }

  // Strategy 3: Strip the JSON-looking block entirely (last resort)
  const nextSection = afterBrace.match(/\n#{1,3}\s+\S/);
  if (nextSection?.index) {
    return (
      content.slice(0, bracePos) + content.slice(bracePos + nextSection.index)
    );
  }

  return content;
}

/**
 * Strip raw chart JSON blocks (CHARTS--- {...} or bare {"generatedCharts":...})
 * that leaked into report body due to parseChartOutput separator mismatch.
 * ★ Requires at least one side to have dashes (prevents false positives)
 */
function stripChartJsonFromReport(content: string): string {
  const separatorPattern = /(?:-+\s*CHARTS\s*-*|CHARTS\s*-+)/gi;
  let match: RegExpExecArray | null;
  let result = content;

  const matches: { index: number; length: number }[] = [];
  while ((match = separatorPattern.exec(content)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
  }

  // Process from last to first to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const sep = matches[i];
    const afterSep = result.substring(sep.index + sep.length);
    const braceStart = afterSep.search(/\{/);
    if (braceStart === -1) continue;

    const jsonStart = sep.index + sep.length + braceStart;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let jsonEnd = -1;

    for (let j = jsonStart; j < result.length; j++) {
      const ch = result[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          jsonEnd = j + 1;
          break;
        }
      }
    }

    let stripStart = sep.index;
    while (stripStart > 0 && '\n\r \t'.includes(result[stripStart - 1])) {
      stripStart--;
    }
    const stripEnd = jsonEnd > 0 ? jsonEnd : result.length;
    result = result.substring(0, stripStart) + result.substring(stripEnd);
  }

  // Fallback: bare JSON block with generatedCharts at end
  const bareJsonPattern =
    /\n\s*\{\s*"(?:generatedCharts|figureReferences)"[\s\S]*$/;
  const m2 = result.match(bareJsonPattern);
  if (m2 && m2.index !== undefined) {
    const before = result.substring(0, m2.index).trim();
    if (before.length > 100) result = before;
  }

  // ★ Case A: Strip complete code-fenced chart JSON blocks (AI wraps JSON in ```json...```)
  // e.g. ```json\n{"generatedCharts":[...]}\n```
  result = result.replace(
    /\n?```json\s*\n\s*\{[\s\S]*?"(?:generatedCharts|figureReferences)"[\s\S]*?\n```/g,
    ''
  );

  // ★ Case B: Remove unclosed ```json opener followed by markdown content (not JSON object).
  // This fixes reports where parseChartOutput left an unclosed ```json at the end of a
  // dimension section (because inlineJsonPattern matched inside the code fence),
  // causing all subsequent content to render as a code block instead of markdown.
  result = result.replace(/\n```json\s*\n(?!\s*\{)/g, '\n');

  return result.trim();
}

function ReportEditorInner({
  report,
  evidence: evidenceProp,
  isLoading = false,
  onSave,
  onOpenAIEdit,
  onAIEdit,
  onAddAnnotation,
  annotations = [],
  highlightedAnnotationId,
  showAnnotationHighlights = true,
}: ReportEditorProps) {
  const { t } = useI18n();
  // Use passed evidence or fall back to report.evidence
  const evidence = evidenceProp || report?.evidence || [];
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [editContent, setEditContent] = useState('');
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const richTextRef = useRef<HTMLDivElement>(null);

  // AI Edit buttons config with i18n
  const aiEditButtons: {
    key: AIEditOperation;
    label: string;
    icon: React.ReactNode;
    description: string;
  }[] = [
    {
      key: 'rewrite' as AIEditOperation,
      label: t('topicResearch.reportEditor.aiEditOperations.rewrite'),
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      description: t('topicResearch.reportEditor.aiEditOperations.rewriteDesc'),
    },
    {
      key: 'polish' as AIEditOperation,
      label: t('topicResearch.reportEditor.aiEditOperations.polish'),
      icon: <Sparkles className="h-3.5 w-3.5" />,
      description: t('topicResearch.reportEditor.aiEditOperations.polishDesc'),
    },
    {
      key: 'expand' as AIEditOperation,
      label: t('topicResearch.reportEditor.aiEditOperations.expand'),
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      description: t('topicResearch.reportEditor.aiEditOperations.expandDesc'),
    },
    {
      key: 'compress' as AIEditOperation,
      label: t('topicResearch.reportEditor.aiEditOperations.compress'),
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      description: t(
        'topicResearch.reportEditor.aiEditOperations.compressDesc'
      ),
    },
    {
      key: 'style' as AIEditOperation,
      label: t('topicResearch.reportEditor.aiEditOperations.style'),
      icon: <Palette className="h-3.5 w-3.5" />,
      description: t('topicResearch.reportEditor.aiEditOperations.styleDesc'),
    },
  ];

  // TipTap editor for rich text mode
  const tiptapEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: t('topicResearch.reportEditor.placeholder'),
      }),
      Typography,
      Highlight.configure({
        multicolor: true,
        HTMLAttributes: {
          class: 'annotation-highlight',
        },
      }),
    ],
    content: '',
    editable: true,
    onUpdate: ({ editor }) => {
      // Convert HTML to Markdown and update editContent
      const html = editor.getHTML();
      const markdown = turndownService.turndown(html);
      setEditContent(markdown);
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-gray prose-strong:text-blue-600 dark:prose-strong:text-blue-400 max-w-none focus:outline-none min-h-full p-6',
      },
    },
  });

  // Build evidence map for citation lookup (evidenceId -> index)
  const evidenceMap = useMemo(() => {
    const map = new Map<string, number>();
    if (evidence.length > 0) {
      evidence.forEach((ev, idx) => {
        map.set(ev.id, idx + 1); // 1-based index for citations
      });
    }
    return map;
  }, [evidence]);

  // Helper to format citation references like [1][2][3]
  const formatCitations = useCallback(
    (evidenceIds: string[] | undefined) => {
      if (!evidenceIds || evidenceIds.length === 0) return '';
      const citations = evidenceIds
        .map((id) => evidenceMap.get(id))
        .filter((idx): idx is number => idx !== undefined)
        .map((idx) => `[${idx}]`)
        .join('');
      return citations ? ` ${citations}` : '';
    },
    [evidenceMap]
  );

  // ★ Build evidence info map for figure citation hover tooltips
  // Uses ev.citationIndex (global DB field) to match chart.evidenceCitationIndex
  const figureEvidenceMap = useMemo(() => {
    const map = new Map<number, FigureEvidenceInfo>();
    if (evidence.length > 0) {
      evidence.forEach((ev, idx) => {
        const key = ev.citationIndex ?? idx + 1;
        map.set(key, {
          id: ev.id,
          title: ev.title,
          url: ev.url,
          snippet: ev.snippet,
          domain: ev.domain,
        });
      });
    }
    return map;
  }, [evidence]);

  // Get markdown content from report - filter out placeholder text
  const markdownContent = useMemo(() => {
    if (!report) return '';

    // ★ Priority 0: Clean fullReport - extract markdown from JSON (pure or embedded)
    let resolvedFullReport = report.fullReport;
    if (resolvedFullReport) {
      resolvedFullReport = extractMarkdownFromJsonReport(resolvedFullReport);
      resolvedFullReport = stripChartJsonFromReport(resolvedFullReport);
      // ★ Strip word count annotations leaked from LLM (e.g. （78字）, （本维度约2500字）)
      resolvedFullReport = resolvedFullReport.replace(
        /[（(][^）)]*(?:约?\d+字|字数[：:]\d+)[）)]/g,
        ''
      );
      resolvedFullReport = preprocessLatex(resolvedFullReport);
      // ★ Fix CommonMark bold+CJK: Convert **text** to <strong>text</strong>
      // MUST run AFTER preprocessLatex (which generates new ** via promotePhaseListItems
      // and repairBrokenBoldMarkers). Direct HTML + rehypeRaw bypasses CommonMark issues.
      resolvedFullReport = resolvedFullReport.replace(
        /\*\*([^*\n]+?)\*\*/g,
        '<strong>$1</strong>'
      );
    }

    // ★ Priority 1: Use fullReport when valid and complete (preserves chart placeholders)
    // LaTeX issues in fullReport are handled by preprocessLatex() above (line 633).
    // fullReport contains <!-- chart:xxx --> placeholders essential for image rendering.
    const expectedDimCount = report.dimensionAnalyses?.length || 0;
    const actualH2Count = (resolvedFullReport?.match(/^## /gm) || []).length;
    const hasChartPlaceholders =
      resolvedFullReport?.includes('<!-- chart:') || false;
    const isFullReportComplete =
      expectedDimCount <= 1 ||
      actualH2Count >= expectedDimCount ||
      hasChartPlaceholders;

    if (
      resolvedFullReport &&
      resolvedFullReport.trim().length > 100 &&
      isFullReportComplete
    ) {
      const looksLikeMarkdown =
        resolvedFullReport.includes('#') || resolvedFullReport.includes('**');
      if (hasChartPlaceholders || looksLikeMarkdown) {
        const stripped = resolvedFullReport.replace(
          /\n*---\n*\n*##\s*(?:参考文献|References)\n[\s\S]*$/,
          ''
        );
        return stripProseBullets(stripped);
      }
    }

    // ★ Priority 1.5: Rebuild from dimensionAnalyses (fallback when fullReport missing/incomplete)
    // ★ 2026-04-17: extended to include preface / crossDim / risk / strategy / conclusion
    //   so word count doesn't collapse when fullReport is damaged/empty.
    const hasDimensionContent =
      report.dimensionAnalyses &&
      report.dimensionAnalyses.length > 0 &&
      report.dimensionAnalyses.some((da) => da.detailedContent);

    if (hasDimensionContent) {
      const parts: string[] = [];
      if (report.title) {
        parts.push(`# ${report.title}\n`);
      }
      // Executive summary (prefer structured v2 fullText if present)
      const execSummaryText =
        report.executiveSummaryV2?.fullText || report.executiveSummary || '';
      if (execSummaryText) {
        parts.push(
          `## ${t('topicResearch.reportEditor.summary')}\n\n${execSummaryText}\n`
        );
      }
      // Dimension chapters
      (report.dimensionAnalyses ?? []).forEach((da, idx) => {
        const dimName = da.dimension?.name || `Dimension ${idx + 1}`;
        const content = da.detailedContent || da.summary || '';
        if (content.trim()) {
          parts.push(`## ${idx + 1}. ${dimName}\n\n${content}\n`);
        }
      });
      // Cross-dimension analysis
      if (report.crossDimensionAnalysis?.fullText) {
        parts.push(
          `## ${t('topicResearch.reportEditor.crossDimensionAnalysis') || '跨维度关联分析'}\n\n${report.crossDimensionAnalysis.fullText}\n`
        );
      }
      // Risk assessment
      if (report.riskAssessment?.fullText) {
        parts.push(
          `## ${t('topicResearch.reportEditor.riskAssessment') || '风险评估'}\n\n${report.riskAssessment.fullText}\n`
        );
      }
      // Strategic recommendations
      if (report.strategicRecommendations?.fullText) {
        parts.push(
          `## ${t('topicResearch.reportEditor.strategicRecommendations') || '战略建议'}\n\n${report.strategicRecommendations.fullText}\n`
        );
      }
      const assembled = preprocessLatex(parts.join('\n'));
      const boldFixed = assembled.replace(
        /\*\*([^*\n]+?)\*\*/g,
        '<strong>$1</strong>'
      );
      return stripProseBullets(boldFixed);
    }

    // ★ Priority 2: Build markdown from report structure (default for old reports)
    const parts: string[] = [];

    // Title
    if (report.title) {
      parts.push(`# ${report.title}\n`);
    }

    // Helper to check if content is just a placeholder
    const isPlaceholder = (text: string | undefined | null): boolean => {
      if (!text) return true;
      const trimmed = text.trim();
      // Only filter if content is EXACTLY a placeholder or very short
      return (
        trimmed === t('topicResearch.reportEditor.viewDetails') ||
        trimmed === t('topicResearch.reportEditor.detailsPending') ||
        trimmed === '...' ||
        trimmed.length < 5
      );
    };

    // Summary - filter placeholder
    if (report.summary && !isPlaceholder(report.summary)) {
      parts.push(
        `## ${t('topicResearch.reportEditor.summary')}\n\n${report.summary}\n`
      );
    }

    // Highlights - filter placeholders (关键发现/核心洞察)
    if (report.highlights && report.highlights.length > 0) {
      const validHighlights = report.highlights.filter(
        (h) => h.content && !isPlaceholder(h.content)
      );
      if (validHighlights.length > 0) {
        parts.push(`## ${t('topicResearch.reportEditor.keyFindings')}\n\n`);
        validHighlights.forEach((h, idx) => {
          // 使用带序号的列表项，突出显示
          parts.push(`**${idx + 1}. ${h.title}**\n\n${h.content}\n\n`);
        });
      }
    }

    // Dimension analyses - filter placeholders
    if (report.dimensionAnalyses && report.dimensionAnalyses.length > 0) {
      report.dimensionAnalyses.forEach((analysis, idx) => {
        const dimName =
          analysis.dimension?.name ||
          `${t('topicResearch.reportEditor.dimension')} ${idx + 1}`;
        parts.push(`## ${dimName}\n`);

        if (analysis.summary && !isPlaceholder(analysis.summary)) {
          parts.push(`${analysis.summary}\n`);
        }

        if (analysis.keyFindings && analysis.keyFindings.length > 0) {
          const validFindings = analysis.keyFindings.filter(
            (f) => f.finding && !isPlaceholder(f.finding)
          );
          if (validFindings.length > 0) {
            parts.push(
              `### ${t('topicResearch.reportEditor.keyFindings')}\n\n`
            );
            validFindings.forEach((f, fIdx) => {
              const citations = formatCitations(f.evidenceIds);
              // 使用有序列表格式，确保正确渲染
              parts.push(`${fIdx + 1}. **${f.finding}**${citations}\n\n`);
            });
          }
        }

        // Add trends with citations
        if (analysis.trends && analysis.trends.length > 0) {
          parts.push(`### ${t('topicResearch.reportEditor.trends')}\n`);
          analysis.trends.forEach((trend, tIdx) => {
            const citations = formatCitations(trend.evidenceIds);
            const directionMap: Record<string, string> = {
              increasing: t('topicResearch.reportEditor.directions.increasing'),
              decreasing: t('topicResearch.reportEditor.directions.decreasing'),
              stable: t('topicResearch.reportEditor.directions.stable'),
              emerging: t('topicResearch.reportEditor.directions.emerging'),
            };
            const direction = directionMap[trend.direction] || trend.direction;
            parts.push(
              `${tIdx + 1}. **${direction}**: ${trend.trend} (${trend.timeframe})${citations}\n`
            );
          });
        }

        // Add challenges with citations
        if (analysis.challenges && analysis.challenges.length > 0) {
          parts.push(`### ${t('topicResearch.reportEditor.challenges')}\n`);
          analysis.challenges.forEach((c, cIdx) => {
            const citations = formatCitations(c.evidenceIds);
            parts.push(
              `${cIdx + 1}. **${c.challenge}** - ${c.impact}${citations}\n`
            );
          });
        }

        // Add opportunities with citations
        if (analysis.opportunities && analysis.opportunities.length > 0) {
          parts.push(`### ${t('topicResearch.reportEditor.opportunities')}\n`);
          analysis.opportunities.forEach((o, oIdx) => {
            const citations = formatCitations(o.evidenceIds);
            parts.push(
              `${oIdx + 1}. **${o.opportunity}** - ${o.potential}${citations}\n`
            );
          });
        }

        if (
          analysis.detailedContent &&
          !isPlaceholder(analysis.detailedContent)
        ) {
          parts.push(`\n${analysis.detailedContent}\n`);
        }
      });
    }

    // Add References section with rich information
    if (report.evidence && report.evidence.length > 0) {
      parts.push(
        `\n---\n\n## ${t('topicResearch.reportEditor.references')}\n\n`
      );
      report.evidence.forEach((ev, idx) => {
        let domain = ev.domain;
        if (!domain) {
          try {
            domain = new URL(ev.url).hostname;
          } catch {
            domain = t('topicResearch.reportEditor.source');
          }
        }
        const date = ev.publishedAt
          ? formatDateSafe(ev.publishedAt, 'date')
          : '';
        const dateStr = date && date !== '--' ? ` (${date})` : '';

        // Reference with sequence number, clickable title, source info
        parts.push(`**[${idx + 1}]** [${ev.title}](${ev.url})\n`);
        parts.push(`*${domain}*${dateStr}\n`);

        // Add snippet/quote if available
        if (ev.snippet) {
          parts.push(
            `> ${ev.snippet.slice(0, 200)}${ev.snippet.length > 200 ? '...' : ''}\n`
          );
        }

        parts.push(`\n`);
      });
    }

    const assembled = preprocessLatex(parts.join('\n'));
    const boldFixed = assembled.replace(
      /\*\*([^*\n]+?)\*\*/g,
      '<strong>$1</strong>'
    );
    return (
      stripProseBullets(boldFixed) ||
      t('topicResearch.reportEditor.noReportContent')
    );
  }, [report, formatCitations, t]);

  // Initialize edit content when report changes
  useEffect(() => {
    setEditContent(markdownContent);
  }, [markdownContent]);

  // Convert annotations to PreprocessorAnnotation format for TipTap highlighting
  // Only include annotations if showAnnotationHighlights is true
  const tiptapAnnotations: PreprocessorAnnotation[] = useMemo(
    () =>
      showAnnotationHighlights
        ? (annotations || []).map((a) => ({
            id: a.id,
            selectedText: a.selectedText,
            startOffset: a.startOffset,
            endOffset: a.endOffset,
            selectorPrefix: a.selectorPrefix,
            selectorSuffix: a.selectorSuffix,
            color: a.color,
            status: a.status,
          }))
        : [],
    [annotations, showAnnotationHighlights]
  );

  // Update TipTap editor when switching to richtext mode or annotations change
  // Note: editContent is intentionally excluded from deps to avoid re-render loops
  // (TipTap is the source of truth for content when in richtext mode)
  useEffect(() => {
    if (viewMode === 'edit' && tiptapEditor) {
      const html = markdownToHtml(editContent);
      // Apply annotation highlights to the HTML before setting content
      const highlightedHtml = applyAnnotationHighlightsToHtml(
        html,
        tiptapAnnotations
      );
      tiptapEditor.commands.setContent(highlightedHtml);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, tiptapEditor, tiptapAnnotations]);

  const isEditing = viewMode === 'edit';

  // Handle AI edit operation from context menu
  const handleAIEditFromMenu = useCallback(
    async (operation: AIEditOperation, selectedText: string) => {
      if (!onAIEdit) return;

      setIsAIProcessing(true);
      try {
        const result = await onAIEdit(operation, selectedText);
        if (viewMode === 'edit' && tiptapEditor) {
          tiptapEditor.commands.insertContent(result);
        }
      } catch (error) {
        logger.error('AI edit failed:', error);
      } finally {
        setIsAIProcessing(false);
      }
    },
    [onAIEdit, viewMode, editContent, tiptapEditor]
  );

  // Handle AI edit operation from panel
  const handleAIEdit = useCallback(
    async (operation: AIEditOperation) => {
      if (!onAIEdit) return;

      let selectedText = '';
      if (viewMode === 'edit' && tiptapEditor) {
        const { from, to } = tiptapEditor.state.selection;
        selectedText = tiptapEditor.state.doc.textBetween(from, to);
      }

      await handleAIEditFromMenu(operation, selectedText);
    },
    [onAIEdit, viewMode, editContent, tiptapEditor, handleAIEditFromMenu]
  );

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setIsSaving(true);
    try {
      await onSave(editContent);
    } catch (error) {
      logger.error('Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, editContent]);

  // Word count
  const wordCount = useMemo(() => {
    const content = isEditing ? editContent : markdownContent;
    // Count Chinese characters and English words
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }, [isEditing, editContent, markdownContent]);

  // Automatically switch to preview mode when highlighted annotation changes
  useEffect(() => {
    if (highlightedAnnotationId && viewMode !== 'preview') {
      setViewMode('preview');
    }
  }, [highlightedAnnotationId, viewMode]);

  // Convert ReportAnnotation to PreprocessorAnnotation
  // Only include annotations if showAnnotationHighlights is true
  const preprocessorAnnotations: PreprocessorAnnotation[] = useMemo(
    () =>
      showAnnotationHighlights
        ? (annotations || []).map((a) => ({
            id: a.id,
            selectedText: a.selectedText,
            startOffset: a.startOffset,
            endOffset: a.endOffset,
            selectorPrefix: a.selectorPrefix,
            selectorSuffix: a.selectorSuffix,
            color: a.color,
            status: a.status,
          }))
        : [],
    [annotations, showAnnotationHighlights]
  );

  // Hook for scrolling to annotations
  const scrollToAnnotation = useScrollToAnnotation();

  // Handle annotation click - scroll to annotation panel
  const handleAnnotationClick = useCallback((annotationId: string) => {
    // Dispatch custom event for annotation panel to handle
    window.dispatchEvent(
      new CustomEvent('annotation-click', { detail: { annotationId } })
    );
  }, []);

  // Use shared hook for text processing with citations and annotations
  const { processText, processTextWithCitations } = useReportTextProcessor({
    evidence,
    preprocessorAnnotations,
    highlightedAnnotationId: highlightedAnnotationId ?? null,
    onAnnotationClick: handleAnnotationClick,
  });

  // Handle scroll to annotation when highlightedAnnotationId changes
  useEffect(() => {
    if (highlightedAnnotationId && previewRef.current) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        scrollToAnnotation(highlightedAnnotationId, previewRef.current!);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [highlightedAnnotationId, scrollToAnnotation]);

  // ★ Parse markdown content and extract chart placeholders
  // Chart placeholders format: <!-- chart:chart-id -->
  const contentSegments = useMemo(() => {
    if (!markdownContent) return [];

    // ★ 自救：后端未 embed `<!-- chart:ID -->` 占位符时（mission 失败 /
    //   老报告 / 中断态 fullReport），调用平台公共函数按章节切片后逐章 inject。
    //   保留 inline 占位符路径（mission 成功态）走原渲染链，零侵入。
    const charts = report?.charts ?? [];
    const hasInlinePlaceholders = markdownContent.includes('<!-- chart:');
    const enrichedContent =
      !hasInlinePlaceholders && charts.length > 0
        ? injectChartPlaceholdersByChapter(markdownContent, charts, {
            // ★ 与章节视图（ChapterizedReportView.formatContent）同口径，
            //   保证 chart.position 计的段落与 inject 探测的段落一致。
            normalize: normalizeReportSection,
          })
        : markdownContent;

    // Split by chart placeholder pattern
    const chartPattern = /<!--\s*chart:([a-zA-Z0-9_-]+)\s*-->/g;
    const segments: Array<{ type: 'markdown' | 'chart'; content: string }> = [];

    let lastIndex = 0;
    let match;
    // ★ 防止同一 chart ID 被多次渲染
    const seenChartIds = new Set<string>();

    while ((match = chartPattern.exec(enrichedContent)) !== null) {
      // Add markdown segment before the chart
      if (match.index > lastIndex) {
        segments.push({
          type: 'markdown',
          content: enrichedContent.slice(lastIndex, match.index),
        });
      }

      const chartId = match[1];
      // ★ 同一 ID 只渲染第一次出现，后续跳过
      if (!seenChartIds.has(chartId)) {
        seenChartIds.add(chartId);
        segments.push({
          type: 'chart',
          content: chartId,
        });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining markdown content
    if (lastIndex < enrichedContent.length) {
      segments.push({
        type: 'markdown',
        content: enrichedContent.slice(lastIndex),
      });
    }

    return segments;
  }, [markdownContent, report?.charts]);

  // ★ Create charts map for quick lookup
  const chartsMap = useMemo(() => {
    const map = new Map<string, ReportChart>();
    if (report?.charts) {
      for (const chart of report.charts) {
        map.set(chart.id, chart);
      }
    }
    return map;
  }, [report?.charts]);

  // ★ ReactMarkdown component for rendering markdown segments
  const renderMarkdownSegment = useCallback(
    (content: string, key: string) => (
      <ReactMarkdown
        key={key}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, KATEX_OPTIONS]]}
        components={createMarkdownComponents(processText)}
      >
        {content}
      </ReactMarkdown>
    ),
    [processText]
  );

  // ★ ReactMarkdown content with React Controlled Highlighting and inline charts
  // Annotations are now rendered inline via processText → AnnotatedText component
  // This eliminates DOM manipulation conflicts that caused React error #310
  const memoizedMarkdownContent = useMemo(
    () => (
      <article className="prose prose-gray prose-strong:text-blue-600 dark:prose-strong:text-blue-400 max-w-none">
        {contentSegments.map((segment, index) => {
          if (segment.type === 'markdown') {
            return renderMarkdownSegment(segment.content, `md-${index}`);
          } else {
            // Render chart (supports both reference images and generated charts)
            const chart = chartsMap.get(segment.content);
            if (chart) {
              return (
                <div key={`chart-${index}`} className="my-6">
                  <FigureRenderer
                    chart={chart}
                    evidenceInfo={
                      chart.evidenceCitationIndex
                        ? figureEvidenceMap.get(chart.evidenceCitationIndex)
                        : undefined
                    }
                  />
                </div>
              );
            }
            // Chart not found, render placeholder
            return (
              <div
                key={`chart-missing-${index}`}
                className="my-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500"
              >
                {t('topicResearch.reportEditor.chartNotFound')}:{' '}
                {segment.content}
              </div>
            );
          }
        })}
      </article>
    ),
    [contentSegments, chartsMap, renderMarkdownSegment]
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState text={t('topicResearch.reportEditor.loadingReport')} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">
            {t('topicResearch.reportEditor.noReport')}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {t('topicResearch.reportEditor.noReportHint')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar - excluded from export */}
      <div
        className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2"
        data-export-exclude
      >
        {/* View mode toggle */}
        <ViewModeToggle
          modes={[
            {
              key: 'preview',
              label: t('topicResearch.reportEditor.preview'),
              icon: <Eye className="h-4 w-4" />,
            },
            {
              key: 'edit',
              label: t('topicResearch.reportEditor.edit'),
              icon: <Pencil className="h-4 w-4" />,
            },
          ]}
          activeMode={viewMode}
          onModeChange={(mode) => {
            if (mode === 'edit' && tiptapEditor) {
              const html = markdownToHtml(editContent);
              tiptapEditor.commands.setContent(html);
            }
            setViewMode(mode as ViewMode);
          }}
        />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {wordCount} {t('topicResearch.reportEditor.words')}
          </span>

          {isEditing && (
            <>
              <button
                onClick={() => setShowPreviewModal(true)}
                className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100"
                title={t('topicResearch.reportEditor.preview')}
              >
                <Eye className="h-4 w-4" />
              </button>

              <button
                onClick={() => setShowAIPanel(!showAIPanel)}
                className={`rounded-lg p-1.5 transition-colors ${
                  showAIPanel
                    ? 'bg-purple-100 text-purple-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                title={t('topicResearch.reportEditor.aiEdit')}
              >
                <Brain className="h-4 w-4" />
              </button>

              <button
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg bg-blue-600 p-1.5 text-white transition-colors hover:bg-blue-700 disabled:bg-blue-400"
                title={
                  isSaving
                    ? t('topicResearch.reportEditor.saving')
                    : t('topicResearch.reportEditor.save')
                }
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                  />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* TipTap toolbar (only in edit mode) */}
      {viewMode === 'edit' && tiptapEditor && (
        <TipTapToolbar editor={tiptapEditor} />
      )}

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {viewMode === 'preview' && (
          <div
            ref={previewRef}
            className="relative h-full overflow-y-auto overflow-x-hidden p-6"
          >
            {/* Mode indicator - excluded from export */}
            <div className="absolute right-6 top-6 z-10" data-export-exclude>
              <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">
                <Eye className="h-3 w-3" />
                {t('topicResearch.reportEditor.previewMode')}
              </span>
            </div>

            {/* Markdown content with React Controlled annotation highlighting */}
            {memoizedMarkdownContent}

            {/* ★ References section — rendered as React component to match chapter view style */}
            {evidence.length > 0 && (
              <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
                <h4 className="mb-4 text-base font-semibold text-gray-700 dark:text-gray-300">
                  {t('topicResearch.reportEditor.references') || '参考文献'}
                </h4>
                <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  {evidence
                    .filter((ev) => ev.citationIndex)
                    .sort(
                      (a, b) => (a.citationIndex || 0) - (b.citationIndex || 0)
                    )
                    .map((ev) => (
                      <div
                        key={ev.id}
                        id={`ref-${ev.citationIndex}`}
                        className="flex gap-2.5 leading-relaxed"
                      >
                        <span className="font-mono shrink-0 text-xs text-gray-400 dark:text-gray-500">
                          [{ev.citationIndex}]
                        </span>
                        {ev.url ? (
                          <a
                            href={ev.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                          >
                            {ev.title || ev.domain || ev.url}
                          </a>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">
                            {ev.title || 'Unknown source'}
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Context menu for preview mode */}
            <TextSelectionContextMenu
              containerRef={previewRef}
              onOpenAIEdit={onOpenAIEdit}
              onAIEdit={onAIEdit ? handleAIEditFromMenu : undefined}
              onAddAnnotation={onAddAnnotation}
              isAIProcessing={isAIProcessing}
            />
          </div>
        )}

        {viewMode === 'edit' && (
          <div
            ref={richTextRef}
            className="relative h-full overflow-auto border-l-4 border-amber-300 bg-amber-50/30 p-6"
          >
            {/* Mode indicator */}
            <div className="absolute right-6 top-6 z-10">
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700">
                <Pencil className="h-3 w-3" />
                {t('topicResearch.reportEditor.editMode')}
              </span>
            </div>

            {/* Apply same prose styling as preview mode for consistent appearance */}
            <EditorContent
              editor={tiptapEditor}
              className="prose prose-gray prose-strong:text-blue-600 dark:prose-strong:text-blue-400 prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-sm prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-code:text-purple-600 prose-code:bg-purple-50 prose-code:px-1 prose-code:rounded max-w-none"
            />

            {/* Context menu for richtext mode */}
            <TextSelectionContextMenu
              containerRef={richTextRef}
              onOpenAIEdit={onOpenAIEdit}
              onAIEdit={onAIEdit ? handleAIEditFromMenu : undefined}
              onAddAnnotation={onAddAnnotation}
              isAIProcessing={isAIProcessing}
            />
          </div>
        )}
      </div>

      {/* AI Edit Panel */}
      {showAIPanel && isEditing && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">
              {t('topicResearch.reportEditor.aiEditLabel')}
            </span>
            {aiEditButtons.map((btn) => (
              <button
                key={btn.key}
                onClick={() => handleAIEdit(btn.key)}
                disabled={isAIProcessing}
                title={btn.description}
                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50"
              >
                {btn.icon}
                {btn.label}
              </button>
            ))}
            {isAIProcessing && (
              <span className="ml-2 flex items-center gap-1 text-xs text-purple-600">
                <div className="h-3 w-3 animate-spin rounded-full border border-purple-600 border-t-transparent" />
                {t('topicResearch.reportEditor.aiProcessing')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Preview Modal (floating preview) */}
      {showPreviewModal && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setShowPreviewModal(false)}
          />
          <div className="fixed right-4 top-20 z-50 max-h-[80vh] w-[500px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
              <span className="text-sm font-medium text-gray-700">
                {t('topicResearch.reportEditor.preview')}
              </span>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="max-h-[calc(80vh-48px)] overflow-auto p-4">
              <article className="prose prose-gray prose-sm prose-strong:text-blue-600 dark:prose-strong:text-blue-400 max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeRaw, [rehypeKatex, KATEX_OPTIONS]]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {editContent}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Memoized ReportEditor
 *
 * Uses custom comparison to prevent re-renders when only highlightedAnnotationId
 * or callback references change. This is critical to avoid React DOM reconciliation
 * conflicts with AnnotationHighlighter's direct DOM manipulation.
 */
export const ReportEditor = memo(ReportEditorInner, areReportEditorPropsEqual);
