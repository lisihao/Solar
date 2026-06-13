'use client';

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import {
  FileText,
  Copy,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  BookOpen,
  Download,
  Search,
  Clock,
  Sparkles,
  Brain,
  Lightbulb,
  RefreshCw,
  Compass,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils/common';
import { ExportDialog } from '@/components/common/dialogs/ExportDialog';
import { useTranslation } from '@/lib/i18n';
import type { DeepResearchReport, ReportReference } from '@/hooks';

// ==================== Types ====================

interface ReportPanelProps {
  report: DeepResearchReport | null;
  isStreaming?: boolean;
  streamingContent?: Record<string, string>;
  projectId: string;
  sessionId?: string | null;
  onNavigateToTab?: (tab: string) => void;
  className?: string;
}

// ==================== Main Component ====================

export function ReportPanel({
  report,
  isStreaming = false,
  streamingContent = {},
  projectId,
  sessionId,
  onNavigateToTab,
  className,
}: ReportPanelProps) {
  const { t } = useTranslation();
  const [showExport, setShowExport] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [expandedRefs, setExpandedRefs] = useState(true);
  const [highlightedRef, setHighlightedRef] = useState<number | null>(null);
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  const scheduleTimer = useCallback((fn: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== timer);
      fn();
    }, delay);
    timersRef.current.push(timer);
    return timer;
  }, []);

  const handleCopySection = useCallback(
    (content: string, section: string) => {
      navigator.clipboard.writeText(content);
      setCopiedSection(section);
      scheduleTimer(() => setCopiedSection(null), 2000);
    },
    [scheduleTimer]
  );

  const handleCitationClick = useCallback(
    (refId: number, surroundingContext?: string) => {
      if (!expandedRefs) {
        setExpandedRefs(true);
      }
      setHighlightedQuote(surroundingContext || null);
      scheduleTimer(
        () => {
          const refElement = document.getElementById(`ref-${refId}`);
          if (refElement) {
            refElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlightedRef(refId);
            scheduleTimer(() => {
              setHighlightedRef(null);
              setHighlightedQuote(null);
            }, 5000);
          }
        },
        expandedRefs ? 0 : 300
      );
    },
    [expandedRefs, scheduleTimer]
  );

  // Empty State
  if (!report && !isStreaming) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center',
          className
        )}
      >
        <div className="mb-4 rounded-2xl bg-purple-50 p-4">
          <FileText className="h-12 w-12 text-purple-500" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-gray-900">
          {t('aiResearch.deepResearch.report.noReport') || 'No report yet'}
        </h3>
        <p className="max-w-md text-center text-gray-500">
          {t('aiResearch.deepResearch.report.noReportDescription') ||
            'Start a research discussion to generate a comprehensive report'}
        </p>
      </div>
    );
  }

  // Streaming State
  if (isStreaming || !report) {
    const sections = Object.entries(streamingContent);

    if (sections.length === 0) {
      return (
        <div
          className={cn(
            'flex h-full flex-col items-center justify-center',
            className
          )}
        >
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-purple-500" />
          <p className="text-gray-500">
            {t('aiResearch.deepResearch.streaming.collecting') ||
              'Collecting information...'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {t('aiResearch.deepResearch.streaming.executing') ||
              'Research in progress'}
          </p>
        </div>
      );
    }

    return (
      <div className={cn('space-y-8', className)}>
        {sections.map(([section, content]) => (
          <div key={section} className="rounded-xl border bg-white p-6">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
              {getSectionIcon(section)}
              {getSectionTitle(section, t)}
            </h2>
            <div className="whitespace-pre-wrap leading-relaxed text-gray-700">
              {content}
              <span className="ml-1 inline-block h-5 w-2 animate-pulse bg-purple-500" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Completed Report View
  return (
    <div className={cn('space-y-8', className)} data-export-content="research">
      {/* Report Header */}
      <div className="overflow-hidden rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 p-6 text-white">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-3">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                {t('aiResearch.deepResearch.report.title') || 'Research Report'}
              </h1>
              <div className="mt-2 flex flex-wrap gap-4 text-sm text-purple-100">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {t('aiResearch.deepResearch.report.sourcesCount', {
                    count: report.metadata.totalSources,
                  }) || `${report.metadata.totalSources} sources`}
                </span>
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  {t('aiResearch.deepResearch.report.searchRounds', {
                    count: report.metadata.searchRounds,
                  }) || `${report.metadata.searchRounds} rounds`}
                </span>
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {t('aiResearch.deepResearch.report.duration', {
                    duration: report.metadata.duration.toFixed(1),
                  }) || `${report.metadata.duration.toFixed(1)}s`}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
          >
            <Download className="h-4 w-4" />
            {t('common.export') || 'Export'}
          </button>
        </div>
      </div>

      {/* Executive Summary */}
      <section className="rounded-xl border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <Sparkles className="h-5 w-5 text-purple-500" />
            {t('aiResearch.deepResearch.report.executiveSummary') ||
              'Executive Summary'}
          </h2>
          <CopyButton
            content={report.executiveSummary}
            section="summary"
            copied={copiedSection === 'summary'}
            onCopy={handleCopySection}
          />
        </div>
        <ReportMarkdown
          content={report.executiveSummary}
          references={report.references}
          onCitationClick={handleCitationClick}
        />
      </section>

      {/* Main Sections */}
      {report.sections.map((section, index) => (
        <section key={index} className="rounded-xl border bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">{section.title}</h2>
            <CopyButton
              content={section.content}
              section={`section-${index}`}
              copied={copiedSection === `section-${index}`}
              onCopy={handleCopySection}
            />
          </div>
          <ReportMarkdown
            content={section.content}
            references={report.references}
            onCitationClick={handleCitationClick}
          />
        </section>
      ))}

      {/* Conclusion */}
      <section className="rounded-xl border bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            {t('aiResearch.deepResearch.report.conclusion') || 'Conclusion'}
          </h2>
          <CopyButton
            content={report.conclusion}
            section="conclusion"
            copied={copiedSection === 'conclusion'}
            onCopy={handleCopySection}
          />
        </div>
        <ReportMarkdown
          content={report.conclusion}
          references={report.references}
          onCitationClick={handleCitationClick}
        />
      </section>

      {/* References */}
      <section className="rounded-xl bg-gray-50 p-6">
        <button
          onClick={() => setExpandedRefs(!expandedRefs)}
          className="flex w-full items-center justify-between"
        >
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <FileText className="h-5 w-5 text-gray-500" />
            {t('aiResearch.deepResearch.report.references') || 'References'} (
            {report.references.length})
          </h2>
          {expandedRefs ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </button>
        {expandedRefs && (
          <div className="mt-4 space-y-2">
            {report.references.map((ref) => {
              const isHighlighted = highlightedRef === ref.id;
              return (
                <div
                  key={ref.id}
                  id={`ref-${ref.id}`}
                  className={cn(
                    'rounded-lg border transition-all duration-300',
                    isHighlighted
                      ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-300 ring-offset-2'
                      : 'bg-white'
                  )}
                >
                  <div className="flex items-start gap-3 p-3">
                    <span className="flex-shrink-0 rounded bg-purple-600 px-2 py-0.5 text-xs font-bold text-white">
                      [{ref.id}]
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                      >
                        <span className="line-clamp-1">{ref.title}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
                      {ref.snippet && (
                        <div className="mt-2 text-xs leading-relaxed text-gray-600">
                          {isHighlighted && highlightedQuote ? (
                            <HighlightedSnippet
                              snippet={ref.snippet}
                              quote={highlightedQuote}
                            />
                          ) : (
                            <p className="line-clamp-6">{ref.snippet}</p>
                          )}
                        </div>
                      )}
                      {isHighlighted && ref.snippet && (
                        <div className="mt-2 border-t border-purple-200 pt-2">
                          <p className="text-xs italic text-purple-600">
                            {t('aiResearch.deepResearch.report.clickToJump') ||
                              'Click citation to jump here'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Next Steps */}
      {onNavigateToTab && (
        <section className="rounded-xl border border-dashed border-purple-200 bg-purple-50/50 p-6">
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
            <Compass className="h-5 w-5 text-purple-500" />
            {t('aiResearch.report.nextSteps') || '下一步建议'}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <NextStepCard
              icon={Brain}
              label={t('aiResearch.report.reviewInsights') || '查看观点荟萃'}
              description={
                t('aiResearch.report.reviewInsightsDesc') ||
                '收藏关键发现，归档次要信息'
              }
              onClick={() => onNavigateToTab('insights')}
            />
            <NextStepCard
              icon={Lightbulb}
              label={t('aiResearch.report.exploreIdeas') || '探索研究创意'}
              description={
                t('aiResearch.report.exploreIdeasDesc') ||
                '查看由研究启发的创意概念'
              }
              onClick={() => onNavigateToTab('ideas')}
            />
            <NextStepCard
              icon={Download}
              label={t('aiResearch.report.exportReport') || '导出报告'}
              description={
                t('aiResearch.report.exportDesc') ||
                '下载为 PDF、Word 或 Markdown'
              }
              onClick={() => setShowExport(true)}
            />
            <NextStepCard
              icon={RefreshCw}
              label={t('aiResearch.report.deeperResearch') || '迭代深入研究'}
              description={
                t('aiResearch.report.deeperDesc') ||
                '多轮优化，扩展和完善研究结论'
              }
              onClick={() => onNavigateToTab('discussion')}
            />
          </div>
        </section>
      )}

      {/* Export Dialog */}
      {sessionId && (
        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          contentSelector="[data-export-content='research']"
          contentTitle="Research Report"
          moduleType="research"
          sourceId={sessionId}
          availableFormats={['PDF', 'DOCX', 'PPTX', 'HTML']}
        />
      )}
    </div>
  );
}

// ==================== Sub Components ====================

function NextStepCard({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg border border-purple-100 bg-white p-3 text-left transition-all hover:border-purple-300 hover:shadow-sm"
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-purple-100">
        <Icon className="h-4 w-4 text-purple-600" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
    </button>
  );
}

function CopyButton({
  content,
  section,
  copied,
  onCopy,
}: {
  content: string;
  section: string;
  copied: boolean;
  onCopy: (content: string, section: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={() => onCopy(content, section)}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
    >
      {copied ? (
        <>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          {t('aiResearch.deepResearch.copy.copied') || 'Copied'}
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" />
          {t('aiResearch.deepResearch.copy.copy') || 'Copy'}
        </>
      )}
    </button>
  );
}

function HighlightedSnippet({
  snippet,
  quote,
}: {
  snippet: string;
  quote: string;
}) {
  const cleanQuote = quote
    .replace(/\[[\d,\s]+\]/g, '')
    .replace(/\[资料\s*[\d,、\s]+\]/g, '')
    .replace(/CITE_GROUP_\d+(?:_\d+)*/g, '')
    .trim()
    .slice(0, 50);

  const lowerSnippet = snippet.toLowerCase();
  const lowerQuote = cleanQuote.toLowerCase();
  const matchIndex = lowerSnippet.indexOf(lowerQuote);

  if (matchIndex === -1 || cleanQuote.length < 10) {
    return (
      <p className="animate-pulse rounded bg-yellow-100 px-1">{snippet}</p>
    );
  }

  const before = snippet.slice(0, matchIndex);
  const highlighted = snippet.slice(matchIndex, matchIndex + cleanQuote.length);
  const after = snippet.slice(matchIndex + cleanQuote.length);

  return (
    <p>
      {before}
      <span className="animate-pulse rounded bg-yellow-200 px-0.5 font-medium text-gray-900">
        {highlighted}
      </span>
      {after}
    </p>
  );
}

function DeepCitationLink({
  sourceIndex,
  sourceTitle,
  sourceSnippet,
  onClick,
}: {
  sourceIndex: number;
  sourceTitle?: string;
  sourceSnippet?: string;
  onClick?: () => void;
}) {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const preview = sourceSnippet
    ? sourceSnippet.length > 150
      ? sourceSnippet.slice(0, 150) + '...'
      : sourceSnippet
    : null;

  return (
    <span className="relative inline">
      <sup
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick?.();
        }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="mx-0.5 cursor-pointer rounded px-0.5 font-medium text-purple-600 transition-all hover:bg-purple-100 hover:text-purple-800"
        title={`${t('aiResearch.deepResearch.report.clickToJump') || 'Click to jump'} [${sourceIndex}]`}
      >
        [{sourceIndex}]
      </sup>

      {showTooltip && sourceTitle && (
        <div
          ref={tooltipRef}
          className="absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-lg border border-gray-200 bg-white shadow-xl"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <div className="flex items-start gap-2 border-b border-gray-100 px-3 py-2">
            <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-purple-100">
              <FileText className="h-3.5 w-3.5 text-purple-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {sourceIndex}
                </span>
                <span className="truncate text-sm font-medium text-gray-900">
                  {sourceTitle}
                </span>
              </div>
            </div>
          </div>

          {preview && (
            <div className="px-3 py-2">
              <p className="text-xs leading-relaxed text-gray-600">{preview}</p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-3 py-1.5">
            <span className="text-[10px] text-gray-400">
              {t('aiResearch.deepResearch.report.clickToView') ||
                'Click to view full'}
            </span>
            <ExternalLink className="h-3 w-3 text-gray-400" />
          </div>

          <div className="absolute left-1/2 top-full -translate-x-1/2">
            <div className="h-2 w-2 -translate-y-1 rotate-45 border-b border-r border-gray-200 bg-gray-50" />
          </div>
        </div>
      )}
    </span>
  );
}

// ==================== Report Markdown Renderer ====================

interface ReportMarkdownProps {
  content: string;
  references: ReportReference[];
  onCitationClick?: (refId: number, surroundingContext?: string) => void;
}

function ReportMarkdown({
  content,
  references,
  onCitationClick,
}: ReportMarkdownProps) {
  // Pre-process: convert citation patterns to markers that survive markdown parsing
  const processedContent = useMemo(() => {
    let text = content;
    // Remove stray underscores around citations
    text = text
      .replace(/_+(\[\d+(?:\s*,\s*\d+)*\])_+/g, '$1')
      .replace(/_+(\[\d+(?:\s*,\s*\d+)*\])/g, '$1')
      .replace(/(\[\d+(?:\s*,\s*\d+)*\])_+/g, '$1');
    // Convert CITE_GROUP_x_y to bracket format for uniform handling
    text = text.replace(/CITE_GROUP_(\d+(?:_\d+)*)/g, (_, indices) => {
      return `[${indices.split('_').join(', ')}]`;
    });
    // Convert [资料 1, 2] to bracket format
    text = text.replace(
      /\[资料\s*(\d+(?:\s*[,、]\s*\d+)*)\]/g,
      (_, indices) => {
        return `[${indices.replace(/、/g, ', ')}]`;
      }
    );
    // Convert citation brackets to text markers that survive markdown parsing
    text = text.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, indices) => {
      const nums = indices.split(/\s*,\s*/);
      return nums.map((n: string) => `\u200BCITEREF${n.trim()}\u200B`).join('');
    });
    return text;
  }, [content]);

  // Custom components for markdown rendering with citation support
  const components = useMemo<Components>(
    () => ({
      p: ({ children, ...props }) => (
        <p {...props}>
          {processCiteRefs(children, references, onCitationClick)}
        </p>
      ),
      li: ({ children, ...props }) => (
        <li {...props}>
          {processCiteRefs(children, references, onCitationClick)}
        </li>
      ),
      td: ({ children, ...props }) => (
        <td {...props}>
          {processCiteRefs(children, references, onCitationClick)}
        </td>
      ),
      blockquote: ({ children, ...props }) => (
        <blockquote {...props}>
          {processCiteRefs(children, references, onCitationClick)}
        </blockquote>
      ),
      strong: ({ children, ...props }) => (
        <strong {...props}>
          {processCiteRefs(children, references, onCitationClick)}
        </strong>
      ),
      em: ({ children, ...props }) => (
        <em {...props}>
          {processCiteRefs(children, references, onCitationClick)}
        </em>
      ),
    }),
    [references, onCitationClick]
  );

  return (
    <div
      className={`
      prose prose-sm prose-purple prose-headings:font-semibold
      prose-headings:text-gray-900 prose-h1:text-lg
      prose-h1:mt-4 prose-h1:mb-2 prose-h2:text-base
      prose-h2:mt-3 prose-h2:mb-2 prose-h3:text-sm
      prose-h3:mt-2 prose-h3:mb-1 prose-p:text-gray-700
      prose-p:leading-relaxed prose-p:my-2 prose-ul:my-2
      prose-ul:pl-4 prose-ol:my-2 prose-ol:pl-4 prose-li:my-1
      prose-li:text-gray-700 prose-strong:text-gray-900
      prose-strong:font-semibold prose-blockquote:border-l-purple-400
      prose-blockquote:bg-purple-50 prose-blockquote:py-1
      prose-blockquote:px-3 prose-blockquote:my-2 prose-blockquote:rounded-r
      prose-blockquote:text-gray-700 prose-code:text-purple-600
      prose-code:bg-purple-50 prose-code:px-1
      prose-code:rounded max-w-none
    `}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Process React children to replace cite-ref markers with clickable citation links
 */
function processCiteRefs(
  children: React.ReactNode,
  references: ReportReference[],
  onCitationClick?: (refId: number, surroundingContext?: string) => void
): React.ReactNode {
  if (!children) return children;

  if (typeof children === 'string') {
    return replaceCiteRefsInText(children, references, onCitationClick);
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        return (
          <React.Fragment key={i}>
            {replaceCiteRefsInText(child, references, onCitationClick)}
          </React.Fragment>
        );
      }
      if (React.isValidElement(child)) {
        const childProps = child.props as { children?: React.ReactNode };
        return React.cloneElement(
          child as React.ReactElement<{ children?: React.ReactNode }>,
          { key: i },
          processCiteRefs(childProps.children, references, onCitationClick)
        );
      }
      return child;
    });
  }

  if (React.isValidElement(children)) {
    const childProps = children.props as { children?: React.ReactNode };
    return React.cloneElement(
      children as React.ReactElement<{ children?: React.ReactNode }>,
      {},
      processCiteRefs(childProps.children, references, onCitationClick)
    );
  }

  return children;
}

/**
 * Replace CITEREF markers in text with citation components
 */
function replaceCiteRefsInText(
  text: string,
  references: ReportReference[],
  onCitationClick?: (refId: number, surroundingContext?: string) => void
): React.ReactNode {
  const pattern = /\u200BCITEREF(\d+)\u200B/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const refId = parseInt(match[1], 10);
    const reference = references.find((r) => r.id === refId);
    parts.push(
      <DeepCitationLink
        key={`cite-${match.index}-${refId}`}
        sourceIndex={refId}
        sourceTitle={reference?.title}
        sourceSnippet={reference?.snippet}
        onClick={() => onCitationClick?.(refId)}
      />
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 0 ? text : parts.length === 1 ? parts[0] : parts;
}

// ==================== Helpers ====================

type TranslateFunction = (
  key: string,
  params?: Record<string, string | number>
) => string;

function getSectionIcon(section: string) {
  if (section.includes('summary') || section.includes('摘要')) {
    return <Sparkles className="h-5 w-5 text-purple-500" />;
  }
  if (section.includes('conclusion') || section.includes('结论')) {
    return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  }
  return <FileText className="h-5 w-5 text-gray-400" />;
}

function getSectionTitle(section: string, t: TranslateFunction): string {
  if (section === 'executive_summary' || section.includes('摘要')) {
    return (
      t('aiResearch.deepResearch.report.executiveSummary') ||
      'Executive Summary'
    );
  }
  if (section === 'conclusion' || section.includes('结论')) {
    return t('aiResearch.deepResearch.report.conclusion') || 'Conclusion';
  }
  return section;
}
