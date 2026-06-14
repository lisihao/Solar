'use client';

/**
 * Chapterized Report View Component
 *
 * 章节化报告视图 - 参考 AI Writing 样式:
 * - 每个维度作为独立章节卡片
 * - 点击卡片进入编辑面板
 * - 显示章节状态、摘要预览、字数
 * - 便于分工协作
 * - 支持引用链接 [1], [2] 可点击跳转到参考文献
 */

import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { MarkdownChartSplitViewer } from '@/components/common/markdown-viewer';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { ArrowLeft, Check, Eye, Pencil } from 'lucide-react';
import { TextSelectionContextMenu } from '../panels/TextSelectionContextMenu';
import {
  splitTextIntoSegments,
  type Annotation as PreprocessorAnnotation,
} from '@/lib/annotation';
import {
  AnnotatedText,
  useScrollToAnnotation,
} from '@/components/common/annotations/AnnotatedText';
import type { AIEditOperation } from '../types';
import type {
  TopicReport,
  TopicDimension,
  TopicEvidence,
  ReportChart,
} from '@/lib/types/topic-insights';
import {
  FigureRenderer,
  FigureGallery,
  type FigureEvidenceInfo,
} from '@/components/common/chart-viewer';
import { markdownToHtml, turndownService } from '@/lib/markdown/markdownToHtml';
import { useReportTextProcessor } from '@/lib/markdown/useReportTextProcessor';
import { preprocessLatex } from '@/lib/markdown/preprocessLatex';
import { stripProseBullets } from '@/lib/markdown/stripProseBullets';
import { countWords } from '@/lib/markdown/countWords';
import { injectChartPlaceholders } from '@/lib/markdown/injectChartPlaceholders';
import { normalizeReportSection } from '@/lib/markdown/normalizeReportSection';
import {
  splitFullReportIntoChapters,
  type ChapterType as ParsedChapterType,
} from '@/lib/markdown/splitFullReportIntoChapters';
import { TipTapToolbar } from '../editor/TipTapToolbar';
import { ViewModeToggle } from '../editor/ViewModeToggle';
import { useI18n } from '@/lib/i18n';
import { LoadingState } from '@/components/ui/states';

// Annotation type for highlighting
interface ReportAnnotation {
  id: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  color: 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
  status?: 'active' | 'resolved' | 'archived';
  /** Context before the selection for reliable matching */
  selectorPrefix?: string;
  /** Context after the selection for reliable matching */
  selectorSuffix?: string;
}

interface ChapterizedReportViewProps {
  report: TopicReport | null;
  dimensions: TopicDimension[];
  evidence?: TopicEvidence[];
  isLoading?: boolean;
  onEditChapter?: (chapterId: string, content: string) => void;
  onAIEditChapter?: (chapterId: string, operation: string) => Promise<void>;
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
   * Legacy AI edit callback for selected text (right-click menu)
   * @deprecated Use onOpenAIEdit instead
   */
  onAIEdit?: (
    operation: AIEditOperation,
    selectedText: string
  ) => Promise<string>;
  /** Add annotation callback */
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
   * Default: true (show highlights)
   */
  showAnnotationHighlights?: boolean;
}

// Chapter status type
type ChapterStatus = 'pending' | 'in_progress' | 'completed' | 'needs_review';

// Chapter data structure
interface Chapter {
  id: string;
  chapterNumber: number;
  title: string;
  dimensionId?: string;
  /** Semantic type — matches ParsedChapterType plus legacy 'references' */
  type: ParsedChapterType | 'references';
  status: ChapterStatus;
  outline: string; // Brief description/outline
  content: string; // Full content
  wordCount: number;
  /** ★ v3.0: 该章节关联的图表 */
  charts?: ReportChart[];
  /** ★ Key findings for takeaways card */
  keyFindings?: Array<{ finding: string; significance: string }>;
}

/**
 * Strip leaked CHARTS--- JSON blocks from dimension content.
 * Uses brace counting to handle JSON with nested braces in string values.
 */
function stripChartJsonBlock(content: string): string {
  const separatorPattern = /(?:-+\s*CHARTS\s*-*|CHARTS\s*-+)/gi;
  let match: RegExpExecArray | null;
  let result = content;
  const matches: { index: number; length: number }[] = [];
  while ((match = separatorPattern.exec(content)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    const sep = matches[i];
    const afterSep = result.substring(sep.index + sep.length);
    const braceStart = afterSep.search(/\{/);
    if (braceStart === -1) continue;
    const jsonStart = sep.index + sep.length + braceStart;
    let depth = 0,
      inStr = false,
      esc = false,
      jsonEnd = -1;
    for (let j = jsonStart; j < result.length; j++) {
      const ch = result[j];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
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
    while (stripStart > 0 && '\n\r \t'.includes(result[stripStart - 1]))
      stripStart--;
    result =
      result.substring(0, stripStart) +
      result.substring(jsonEnd > 0 ? jsonEnd : sep.index + sep.length);
  }
  return result;
}

// View mode type (consistent with continuous view)
type ViewMode = 'preview' | 'edit';

/**
 * Custom comparison function for React.memo
 *
 * Prevents unnecessary re-renders when parent state changes (like sidePanelType)
 * but the actual content data hasn't changed.
 *
 * With React Controlled Highlighting, we now render annotations inline via React.
 * This means we need to compare:
 * - report, dimensions, evidence, isLoading - core data
 * - annotations - content for highlighting
 * - highlightedAnnotationId - for scroll-to and highlight state
 *
 * What we DON'T compare:
 * - Callback functions (onEditChapter, onAIEdit, etc.) - parent uses inline functions
 */
function arePropsEqual(
  prevProps: ChapterizedReportViewProps,
  nextProps: ChapterizedReportViewProps
): boolean {
  // Compare core data props
  if (prevProps.report !== nextProps.report) return false;
  if (prevProps.dimensions !== nextProps.dimensions) return false;
  if (prevProps.evidence !== nextProps.evidence) return false;
  if (prevProps.isLoading !== nextProps.isLoading) return false;

  // Compare highlightedAnnotationId (needed for React Controlled Highlighting)
  if (prevProps.highlightedAnnotationId !== nextProps.highlightedAnnotationId)
    return false;

  // Compare showAnnotationHighlights
  if (prevProps.showAnnotationHighlights !== nextProps.showAnnotationHighlights)
    return false;

  // Optimized annotations comparison using fingerprint
  // Instead of O(n) deep comparison, generate a lightweight fingerprint string
  const prevAnnotations = prevProps.annotations || [];
  const nextAnnotations = nextProps.annotations || [];

  // Quick length check first
  if (prevAnnotations.length !== nextAnnotations.length) return false;

  // Generate fingerprint: "id:color:status|id:color:status|..."
  // This is O(n) but with minimal operations per item
  const getFingerprint = (annotations: typeof prevAnnotations) =>
    annotations.map((a) => `${a.id}:${a.color}:${a.status || ''}`).join('|');

  if (getFingerprint(prevAnnotations) !== getFingerprint(nextAnnotations)) {
    return false;
  }

  // All data props are equal - skip re-render
  return true;
}

function ChapterizedReportViewInner({
  report,
  dimensions,
  evidence = [],
  isLoading = false,
  onEditChapter,
  onAIEditChapter,
  onOpenAIEdit,
  onAIEdit,
  onAddAnnotation,
  annotations = [],
  highlightedAnnotationId,
  showAnnotationHighlights = true,
}: ChapterizedReportViewProps) {
  const { t } = useI18n();
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [editContent, setEditContent] = useState('');
  const [isAIProcessing, setIsAIProcessing] = useState(false);

  // Ref for preview container (used by context menu and annotation highlighting)
  const previewRef = useRef<HTMLDivElement>(null);
  // Ref for edit container (used by context menu in edit mode)
  const editContainerRef = useRef<HTMLDivElement>(null);

  // Handle AI edit from context menu
  const handleAIEditFromMenu = useCallback(
    async (operation: AIEditOperation, selectedText: string) => {
      if (!onAIEdit) return;
      setIsAIProcessing(true);
      try {
        await onAIEdit(operation, selectedText);
      } finally {
        setIsAIProcessing(false);
      }
    },
    [onAIEdit]
  );

  // TipTap editor for rich text mode
  const tiptapEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: t('topicResearch.reportEditor.placeholder'),
      }),
      Typography,
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
        class: 'prose prose-gray max-w-none focus:outline-none min-h-full p-6',
      },
    },
  });

  // Update TipTap editor when switching to edit mode or when chapter changes
  useEffect(() => {
    if (viewMode === 'edit' && tiptapEditor && editContent) {
      const html = markdownToHtml(editContent);
      tiptapEditor.commands.setContent(html);
    }
  }, [viewMode, tiptapEditor, selectedChapter?.id]);

  // Convert ReportAnnotation to PreprocessorAnnotation for React Controlled Highlighting
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

  // Handle annotation click - dispatch event for annotation panel
  const handleAnnotationClick = useCallback((annotationId: string) => {
    window.dispatchEvent(
      new CustomEvent('annotation-click', { detail: { annotationId } })
    );
  }, []);

  const { processText, processTextWithCitations } = useReportTextProcessor({
    evidence,
    preprocessorAnnotations,
    highlightedAnnotationId: highlightedAnnotationId ?? null,
    onAnnotationClick: handleAnnotationClick,
  });

  // ★ Build evidence index map for citation formatting (consistent with ReportEditor)
  const evidenceMap = useMemo(() => {
    const map = new Map<string, number>();
    if (evidence && evidence.length > 0) {
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
  // Maps DB citationIndex → evidence info (title, url, snippet, domain)
  // Uses ev.citationIndex (global DB field) to match chart.evidenceCitationIndex
  const figureEvidenceMap = useMemo(() => {
    const map = new Map<number, FigureEvidenceInfo>();
    if (evidence && evidence.length > 0) {
      evidence.forEach((ev, idx) => {
        const key = ev.citationIndex ?? idx + 1; // fallback to position if citationIndex is null
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

  // ★ v3.0: Create charts map by sectionId for quick lookup
  const chartsBySectionId = useMemo(() => {
    const map = new Map<string, ReportChart[]>();
    if (report?.charts) {
      for (const chart of report.charts) {
        const sectionId = chart.sectionId || '';
        if (!map.has(sectionId)) {
          map.set(sectionId, []);
        }
        map.get(sectionId)!.push(chart);
      }
    }
    return map;
  }, [report?.charts]);

  // Build chapters from report (single source of truth: fullReport).
  //
  // ★ 2026-04-17 rewrite: Previously, chapters were rebuilt from
  // `dimensionAnalyses[]` + a few supplementary fields. This missed preface,
  // executiveSummary, and conclusion entirely, so the chapter view's total
  // word count diverged badly from the continuous view (which renders
  // `fullReport` directly). The new flow splits `fullReport` by H2 headings
  // so both views agree exactly on the set of chapters and their content.
  //
  // Dimension-specific metadata (status, per-chapter charts, top keyFindings)
  // is still pulled from `dimensionAnalyses[]`, matched by sectionNumber.
  // Fallback to the legacy dimensionAnalyses-based build only when fullReport
  // is missing/empty (old reports still in generation).
  const chapters = useMemo<Chapter[]>(() => {
    if (!report) return [];

    const formatContent = (raw: string): string => {
      // preprocessLatex first (generates new ** via promotePhaseListItems etc.)
      const withLatex = preprocessLatex(stripChartJsonBlock(raw));
      // Strip abused headings (### 一方面 / 另一方面 ...)
      const noAbused = withLatex.replace(
        /^#{1,4}\s+\*{0,2}(一方面|另一方面|此外|首先|其次|再次|最后|然而|因此|总之|综上|不过|尽管|虽然|同时|接着)\*{0,2}[，,：:。]?\s*$/gm,
        '\n$1'
      );
      // Strip prose bullets BEFORE bold conversion
      const noBullets = stripProseBullets(noAbused);
      // Convert **text** → <strong>text</strong> (CommonMark CJK bypass)
      return noBullets.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    };

    const parsed = splitFullReportIntoChapters(report.fullReport);
    const result: Chapter[] = [];

    // ── Primary path: split fullReport (authoritative) ────────────────────
    if (parsed.length > 0) {
      parsed.forEach((seg, idx) => {
        const chapterNumber = idx + 1;

        // Cross-reference dimensionAnalyses by section number for dimension
        // chapters — to inherit status, charts, and keyFindings.
        let status: ChapterStatus = 'completed';
        let dimensionId: string | undefined;
        let keyFindings: Chapter['keyFindings'];
        if (seg.type === 'dimension' && seg.sectionNumber) {
          const dimIdx = parseInt(seg.sectionNumber, 10) - 1;
          const analysis = report.dimensionAnalyses?.[dimIdx];
          if (analysis) {
            dimensionId = analysis.dimension?.id;
            const dim = dimensions.find((d) => d.id === dimensionId);
            if (dim?.status === 'RESEARCHING') status = 'in_progress';
            else if (dim?.status !== 'COMPLETED' && !seg.content.trim())
              status = 'pending';
            keyFindings = (analysis.keyFindings || [])
              .filter((f) => f.finding && f.finding.trim().length > 3)
              .slice(0, 3)
              .map((f) => ({
                finding: f.finding,
                significance: f.significance || 'medium',
              }));
          }
        }

        // ★ Charts are keyed by dimension section number only. Don't fall back
        //   to chapterNumber for supplementary chapters — that would leak
        //   unrelated charts into cross-dim / risk / strategy / conclusion.
        const chapterCharts = seg.sectionNumber
          ? chartsBySectionId.get(seg.sectionNumber) || []
          : [];
        let content = formatContent(seg.content);
        if (chapterCharts.length > 0 && !content.includes('<!-- chart:')) {
          content = injectChartPlaceholders(content, chapterCharts);
        }

        result.push({
          id: seg.id,
          chapterNumber,
          title: seg.title,
          dimensionId,
          type: seg.type,
          status,
          outline: seg.content.slice(0, 100),
          content,
          wordCount: countWords(content),
          charts: chapterCharts,
          keyFindings:
            keyFindings && keyFindings.length > 0 ? keyFindings : undefined,
        });
      });
      return result;
    }

    // ── Fallback path: legacy build from dimensionAnalyses ────────────────
    // Triggers only when fullReport is missing (report still generating).
    let chapterNum = 1;
    if (report.dimensionAnalyses && report.dimensionAnalyses.length > 0) {
      report.dimensionAnalyses.forEach((analysis) => {
        const dimName =
          analysis.dimension?.name ||
          `${t('topicResearch.reportEditor.dimension')} ${chapterNum}`;
        const dimId = analysis.dimension?.id || `dim-${chapterNum}`;
        const sectionNumber = String(chapterNum);
        const dimension = dimensions.find((d) => d.id === dimId);
        let status: ChapterStatus = 'pending';
        if (dimension?.status === 'COMPLETED') status = 'completed';
        else if (dimension?.status === 'RESEARCHING') status = 'in_progress';

        const parts: string[] = [];
        if (
          analysis.detailedContent &&
          analysis.detailedContent.trim().length > 100
        ) {
          parts.push('\n' + analysis.detailedContent);
        } else {
          if (analysis.summary && analysis.summary.trim().length > 5)
            parts.push(analysis.summary);
          if (analysis.keyFindings && analysis.keyFindings.length > 0) {
            const valid = analysis.keyFindings.filter(
              (f) => f.finding && f.finding.trim().length > 3
            );
            if (valid.length > 0) {
              parts.push(
                `\n### ${t('topicResearch.reportEditor.keyFindings')}\n`
              );
              valid.forEach((f, fIdx) => {
                parts.push(
                  `${fIdx + 1}. **${f.finding}**${formatCitations(f.evidenceIds)}`
                );
              });
            }
          }
          if (
            analysis.detailedContent &&
            analysis.detailedContent.trim().length > 5
          )
            parts.push('\n' + analysis.detailedContent);
        }

        const content = formatContent(parts.join('\n'));
        const chapterCharts = chartsBySectionId.get(sectionNumber) || [];
        let finalContent = content;
        if (chapterCharts.length > 0 && !content.includes('<!-- chart:'))
          finalContent = injectChartPlaceholders(content, chapterCharts);

        const topFindings = (analysis.keyFindings || [])
          .filter((f) => f.finding && f.finding.trim().length > 3)
          .slice(0, 3)
          .map((f) => ({
            finding: f.finding,
            significance: f.significance || 'medium',
          }));

        result.push({
          id: dimId,
          chapterNumber: chapterNum,
          title: dimName,
          dimensionId: dimId,
          type: 'dimension',
          status,
          outline: analysis.summary?.slice(0, 100) || dimName,
          content: finalContent,
          wordCount: countWords(finalContent),
          charts: chapterCharts,
          keyFindings: topFindings.length > 0 ? topFindings : undefined,
        });
        chapterNum++;
      });
    }

    // ★ Fallback also emits supplementary chapters so partial reports still
    //   show cross-dim / risk / strategy (matches pre-rewrite behavior).
    const supplementarySections: Array<{
      key: keyof TopicReport;
      titleKey: string;
      fallbackTitle: string;
      type: Chapter['type'];
    }> = [
      {
        key: 'crossDimensionAnalysis',
        titleKey: 'topicResearch.reportEditor.crossDimensionAnalysis',
        fallbackTitle: '跨维度关联分析',
        type: 'cross-dimension',
      },
      {
        key: 'riskAssessment',
        titleKey: 'topicResearch.reportEditor.riskAssessment',
        fallbackTitle: '风险评估',
        type: 'risk',
      },
      {
        key: 'strategicRecommendations',
        titleKey: 'topicResearch.reportEditor.strategicRecommendations',
        fallbackTitle: '战略建议',
        type: 'strategy',
      },
    ];
    for (const section of supplementarySections) {
      const fieldValue = report[section.key];
      const raw =
        fieldValue != null &&
        typeof fieldValue === 'object' &&
        'fullText' in fieldValue
          ? (fieldValue as { fullText: string }).fullText
          : undefined;
      if (raw && raw.trim().length > 10) {
        const formatted = formatContent(raw);
        result.push({
          id: section.key as string,
          chapterNumber: chapterNum,
          title: t(section.titleKey) || section.fallbackTitle,
          type: section.type,
          status: 'completed',
          outline: raw.slice(0, 100),
          content: formatted,
          wordCount: countWords(formatted),
          charts: [],
        });
        chapterNum++;
      }
    }

    return result;
  }, [report, dimensions, chartsBySectionId, formatCitations, t]);

  // ★ Navigate to highlighted annotation when it changes
  // Auto-select the chapter containing the annotation and switch to preview mode
  useEffect(() => {
    if (!highlightedAnnotationId) return;

    // Find the annotation
    const annotation = annotations.find(
      (a) => a.id === highlightedAnnotationId
    );
    if (!annotation) return;

    // Find which chapter contains this annotation text
    const chapterWithAnnotation = chapters.find((chapter) =>
      chapter.content.includes(annotation.selectedText)
    );

    // If found and different from current, select that chapter
    if (
      chapterWithAnnotation &&
      chapterWithAnnotation.id !== selectedChapter?.id
    ) {
      setSelectedChapter(chapterWithAnnotation);
    }

    // Switch to preview mode if in edit mode
    if (viewMode === 'edit') {
      setViewMode('preview');
    }
  }, [
    highlightedAnnotationId,
    chapters,
    annotations,
    selectedChapter?.id,
    viewMode,
  ]);

  // Handle scroll to annotation when highlightedAnnotationId changes (React Controlled)
  useEffect(() => {
    if (highlightedAnnotationId && previewRef.current) {
      const timer = setTimeout(() => {
        scrollToAnnotation(highlightedAnnotationId, previewRef.current!);
      }, 150); // Slightly longer delay to ensure chapter switch completes
      return () => clearTimeout(timer);
    }
  }, [highlightedAnnotationId, scrollToAnnotation]);

  // Open chapter for viewing/editing
  const openChapter = useCallback((chapter: Chapter) => {
    setSelectedChapter(chapter);
    setEditContent(chapter.content);
    setViewMode('preview');
  }, []);

  // Close chapter panel
  const closeChapter = useCallback(() => {
    setSelectedChapter(null);
    setViewMode('preview');
    setEditContent('');
  }, []);

  // Save edit
  const saveEdit = useCallback(() => {
    if (selectedChapter && onEditChapter) {
      onEditChapter(selectedChapter.id, editContent);
    }
    setViewMode('preview');
  }, [selectedChapter, editContent, onEditChapter]);

  // Cancel editing (reset content and return to preview)
  const cancelEdit = useCallback(() => {
    if (selectedChapter) {
      setEditContent(selectedChapter.content);
    }
    setViewMode('preview');
  }, [selectedChapter]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = chapters.length;
    const completed = chapters.filter((c) => c.status === 'completed').length;
    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    return { total, completed, totalWords };
  }, [chapters]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState text={t('topicResearch.reportEditor.loadingReport')} />
      </div>
    );
  }

  if (!report || chapters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Pencil className="mb-4 h-10 w-10 text-gray-400" />
          <p className="mt-2 text-gray-500">
            {t('topicResearch.reportEditor.noReportContent')}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {t('topicResearch.reportEditor.noReportHintChapter')}
          </p>
        </div>
      </div>
    );
  }

  // If a chapter is selected, show ONLY the chapter content (full screen)
  if (selectedChapter) {
    return (
      <div className="flex h-full flex-col bg-white">
        {/* Header: back + title */}
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
          <button
            onClick={closeChapter}
            className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            title={t('topicResearch.reportEditor.backToChapterList')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              selectedChapter.status === 'completed'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {selectedChapter.status === 'completed' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              selectedChapter.chapterNumber
            )}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
            {t('topicResearch.reportEditor.chapter')}{' '}
            {selectedChapter.chapterNumber}: {selectedChapter.title}
          </h3>
          <span className="shrink-0 text-xs text-gray-400">
            {selectedChapter.wordCount} {t('topicResearch.reportEditor.words')}
          </span>
        </div>

        {/* Toolbar: view mode + actions - excluded from export */}
        <div
          className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2"
          data-export-exclude
        >
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
            onModeChange={(mode) => setViewMode(mode as ViewMode)}
          />

          <div className="flex items-center gap-2">
            {viewMode === 'edit' && (
              <>
                <button
                  onClick={cancelEdit}
                  className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                >
                  {t('topicResearch.reportEditor.cancel')}
                </button>
                <button
                  onClick={saveEdit}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  {t('topicResearch.reportEditor.save')}
                </button>
              </>
            )}
          </div>
        </div>

        {/* TipTap toolbar (only in edit mode) */}
        {viewMode === 'edit' && tiptapEditor && (
          <TipTapToolbar editor={tiptapEditor} />
        )}

        {/* Chapter Content - Full Screen */}
        <div className="flex-1 overflow-auto">
          {viewMode === 'edit' ? (
            <div ref={editContainerRef} className="h-full bg-white p-6">
              {/* Apply same prose styling as preview mode for consistent appearance */}
              <EditorContent
                editor={tiptapEditor}
                className="prose prose-gray prose-strong:text-blue-600 dark:prose-strong:text-blue-400 prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-sm prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-code:text-purple-600 prose-code:bg-purple-50 prose-code:px-1 prose-code:rounded max-w-none"
              />
              {/* ★ 右键菜单 - 编辑模式 */}
              <TextSelectionContextMenu
                containerRef={editContainerRef}
                onOpenAIEdit={onOpenAIEdit}
                onAIEdit={onAIEdit ? handleAIEditFromMenu : undefined}
                onAddAnnotation={onAddAnnotation}
                isAIProcessing={isAIProcessing}
              />
            </div>
          ) : (
            // ★ Preview mode - 与连续视图（ReportEditor）完全一致的渲染管线
            //   现走平台 MarkdownChartSplitViewer：
            //   - 跨段共享 slugCounts + lastH2Text（mdComponents 内部维护）
            //   - chart 占位符自动 split + renderChart 回调
            //   - preprocess=false 保留旧行为（外部已 processText 不再二次预处理）
            <div ref={previewRef} className="p-6">
              <article className="prose prose-gray prose-strong:text-blue-600 dark:prose-strong:text-blue-400 max-w-none">
                <MarkdownChartSplitViewer
                  content={
                    selectedChapter.content ||
                    t('topicResearch.reportEditor.noContent')
                  }
                  charts={selectedChapter.charts || []}
                  getChartId={(c) => c.id}
                  processText={processText}
                  preprocess={false}
                  enableRawHtml
                  renderChart={(chart, key) => (
                    <div key={key} className="my-4">
                      <FigureRenderer
                        chart={chart}
                        evidenceInfo={
                          chart.evidenceCitationIndex
                            ? figureEvidenceMap.get(chart.evidenceCitationIndex)
                            : undefined
                        }
                      />
                    </div>
                  )}
                />
              </article>

              {/* References for this chapter */}
              {(() => {
                const citedIndices = new Set(
                  (selectedChapter.content.match(/\[(\d+)\]/g) || [])
                    .map((m) => parseInt(m.replace(/[[\]]/g, ''), 10))
                    .filter((n) => n > 0 && n <= 500)
                );
                if (citedIndices.size === 0) return null;

                const refs = Array.from(citedIndices)
                  .sort((a, b) => a - b)
                  .map((idx) => {
                    const ev = evidence.find((e) => e.citationIndex === idx);
                    return ev
                      ? { idx, title: ev.title, url: ev.url, domain: ev.domain }
                      : null;
                  })
                  .filter(Boolean);

                if (refs.length === 0) return null;

                return (
                  <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
                    <h4 className="mb-4 text-base font-semibold text-gray-700 dark:text-gray-300">
                      {t('topicResearch.reportEditor.references') || '参考文献'}
                    </h4>
                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                      {refs.map((ref) => (
                        <div
                          key={ref!.idx}
                          id={`ref-${ref!.idx}`}
                          className="flex gap-2.5 leading-relaxed"
                        >
                          <span className="font-mono shrink-0 text-xs text-gray-400 dark:text-gray-500">
                            [{ref!.idx}]
                          </span>
                          {ref!.url ? (
                            <a
                              href={ref!.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              {ref!.title || ref!.domain || ref!.url}
                            </a>
                          ) : (
                            <span className="text-gray-600 dark:text-gray-400">
                              {ref!.title || 'Unknown source'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ★ 右键菜单 - 与连续视图保持一致 */}
              <TextSelectionContextMenu
                containerRef={previewRef}
                onOpenAIEdit={onOpenAIEdit}
                onAIEdit={onAIEdit ? handleAIEditFromMenu : undefined}
                onAddAnnotation={onAddAnnotation}
                isAIProcessing={isAIProcessing}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Chapter List View (when no chapter is selected)
  return (
    <div className="flex h-full flex-col">
      {/* Stats Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
        <div className="text-base text-gray-600">
          {t('topicResearch.reportEditor.chapterListSummary', {
            total: stats.total,
            completed: stats.completed,
            words: stats.totalWords,
          })}
        </div>
      </div>

      {/* Chapter Cards */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {chapters.map((chapter) => (
            <button
              key={chapter.id}
              onClick={() => openChapter(chapter)}
              className="block w-full rounded-xl border border-gray-100 bg-white p-4 text-left transition-all hover:border-blue-200 hover:bg-blue-50/50"
            >
              <div className="flex items-start gap-3">
                {/* Status Icon */}
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                    chapter.status === 'completed'
                      ? 'bg-green-100 text-green-700'
                      : chapter.status === 'in_progress'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {chapter.status === 'completed' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    chapter.chapterNumber
                  )}
                </span>

                {/* Chapter Info */}
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium text-gray-800">
                    {t('topicResearch.reportEditor.chapter')}{' '}
                    {chapter.chapterNumber}: {chapter.title}
                  </div>

                  {/* Outline/Summary */}
                  {chapter.outline && chapter.outline !== chapter.title && (
                    <div className="mt-1 line-clamp-2 text-sm text-gray-400">
                      {chapter.outline}
                    </div>
                  )}

                  {/* Content Preview with annotation highlights */}
                  {chapter.content && (
                    <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-gray-500">
                      {processText(
                        chapter.content
                          .replace(/^#{1,6}\s+/gm, '')
                          .replace(/\*\*([^*]+)\*\*/g, '$1')
                          .slice(0, 200)
                      )}
                      {chapter.content.length > 200 ? '...' : ''}
                    </div>
                  )}
                </div>

                {/* Word Count Badge */}
                {chapter.wordCount > 0 && (
                  <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                    {chapter.wordCount} {t('topicResearch.reportEditor.words')}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized ChapterizedReportView
 *
 * Uses custom comparison to prevent unnecessary re-renders.
 * With React Controlled Highlighting, annotations are rendered inline via React,
 * eliminating DOM manipulation conflicts that caused React error #310.
 */
export const ChapterizedReportView = memo(
  ChapterizedReportViewInner,
  arePropsEqual
);
