'use client';

/**
 * PlanContentPanel - AI Planning right-side content panel
 *
 * Tab layout matching TopicContentPanel pattern:
 * 1. Tasks - 6-phase accordion with click-to-expand details
 * 2. Planning Report - Aggregated report markdown
 * 3. Activity Log - Timeline from real topic messages
 *
 * Bottom: Chat input (reusing AI Teams message API)
 */

import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { Table, THead, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  LayoutList,
  FileText,
  Clock,
  StickyNote,
  Download,
  ChevronDown,
  AlertTriangle,
  Link as LinkIcon,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import MermaidDiagram from '@/components/ui/viewers/MermaidDiagram';
import { cn } from '@/lib/utils/common';
import { useTranslation } from '@/lib/i18n';
import { toast } from '@/stores';
import { ModelBadge } from '@/components/common/badges/ModelBadge';
import type { PlanDetail, PlanReference } from '@/services/ai-planning/api';
import { PHASE_KEYS } from '@/lib/constants/ai-planning';
import {
  PLANNING_ROLES_CONFIG,
  PLANNING_WORKFLOW_CONFIG,
  AGENT_KEY_TO_INDEX,
} from '@/lib/constants/planning-roles';
import { getMessages, sendMessage } from '@/services/ai-teams/api';
import { Tabs } from '@/components/ui/tabs';
import type { TopicMessage } from '@/lib/types/ai-teams';
import { LoadingState } from '@/components/ui/states';

export type PlanContentTabType =
  | 'phases'
  | 'report'
  | 'references'
  | 'activity';

// Role icon mapping (shared with PlanTeamPanel)
const ROLE_ICON_MAP: Record<string, string> = {
  leader: '\u{1F451}',
  researcher: '\u{1F50D}',
  analyst: '\u{1F4CA}',
  copywriter: '\u{270D}\u{FE0F}',
  debaterPro: '\u{2694}\u{FE0F}',
  debaterCon: '\u{1F6E1}\u{FE0F}',
};

const PHASE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  skipped: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-100 text-red-700',
};

// ============================================
// Mermaid detection (ported from ai-ask)
// ============================================
const MERMAID_KEYWORDS = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
  'journey',
];

function isMermaidDiagram(code: string, language?: string): boolean {
  if (language === 'mermaid') return true;
  const trimmedCode = code.trim();
  return MERMAID_KEYWORDS.some((keyword) => trimmedCode.startsWith(keyword));
}

// ============================================
// Shared styled markdown components
// ============================================
const PLAN_MARKDOWN_COMPONENTS: React.ComponentPropsWithoutRef<
  typeof ReactMarkdown
>['components'] = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-4 border-b border-gray-200 pb-2 text-lg font-bold text-gray-900 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 flex items-center gap-2 text-base font-bold text-gray-900 first:mt-0">
      <span className="inline-block h-4 w-1 rounded-full bg-blue-500" />
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-sm font-semibold text-gray-800 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-2 text-sm font-medium text-gray-700 first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-sm leading-relaxed text-gray-700 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-1 space-y-1.5 text-gray-700 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-1 list-inside list-decimal space-y-1.5 text-gray-700 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="flex items-start gap-2 text-sm leading-relaxed">
      <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
      <span className="flex-1">{children}</span>
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
  em: ({ children }) => <em className="text-gray-600">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline decoration-1 underline-offset-2 hover:text-blue-700"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-4 border-t border-gray-200" />,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-4 border-blue-300 bg-blue-50/50 py-2 pl-4 italic text-gray-600 last:mb-0">
      {children}
    </blockquote>
  ),
  // Code blocks with mermaid support
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : undefined;
    const codeString = String(children).replace(/\n$/, '');
    const hasLanguage = !!match;
    const hasNewlines = codeString.includes('\n');
    const isInline = !hasLanguage && !hasNewlines;

    if (!isInline && isMermaidDiagram(codeString, language)) {
      return <MermaidDiagram chart={codeString} className="my-4" />;
    }

    if (isInline) {
      return (
        <code
          className="font-mono rounded bg-gray-100 px-1.5 py-0.5 text-xs text-blue-700"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="font-mono block overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-3 overflow-hidden rounded-lg last:mb-0">{children}</pre>
  ),
  // Table styling — allow wider-than-container tables with horizontal scroll
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-gray-200 last:mb-0">
      <Table className="w-max min-w-full text-sm text-gray-700">
        {children}
      </Table>
    </div>
  ),
  thead: ({ children }) => <THead className="bg-gray-50">{children}</THead>,
  th: ({ children, style }) => (
    <Th
      className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-gray-900"
      style={style}
    >
      {children}
    </Th>
  ),
  tr: ({ children }) => (
    <Tr className="border-t border-gray-100 even:bg-gray-50/50">{children}</Tr>
  ),
  td: ({ children, style }) => (
    <Td className="min-w-[100px] px-3 py-2 text-sm" style={style}>
      {children}
    </Td>
  ),
};

/** Shared markdown renderer with GFM tables, styled components, and mermaid.
 *  When `references` is provided, [n] patterns are rendered as clickable CitationBadge. */
function PlanMarkdown({
  content,
  references,
}: {
  content: string;
  references?: PlanReference[];
}) {
  const components = useMemo(() => {
    if (references && references.length > 0) {
      return buildCitationMarkdownComponents(references);
    }
    return PLAN_MARKDOWN_COMPONENTS;
  }, [references]);

  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ============================================
// Citation rendering for report tab
// ============================================

/** Inline citation badge: renders [n] as purple sup badge with hover tooltip */
function CitationBadge({
  index,
  references,
}: {
  index: number;
  references: PlanReference[];
}) {
  const ref = references[index - 1];
  if (!ref) {
    return (
      <sup className="inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded bg-gray-200 px-1 text-[10px] font-bold text-gray-500">
        [{index}]
      </sup>
    );
  }

  return (
    <span className="group/cite relative inline-block">
      {ref.url ? (
        <a
          href={ref.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex"
        >
          <sup className="inline-flex h-4 min-w-[1.25rem] cursor-pointer items-center justify-center rounded bg-purple-100 px-1 text-[10px] font-bold text-purple-700 transition-colors hover:bg-purple-300">
            [{index}]
          </sup>
        </a>
      ) : (
        <sup className="inline-flex h-4 min-w-[1.25rem] cursor-help items-center justify-center rounded bg-purple-100 px-1 text-[10px] font-bold text-purple-700 transition-colors hover:bg-purple-200">
          [{index}]
        </sup>
      )}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-64 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-2.5 text-xs opacity-0 shadow-lg transition-opacity group-hover/cite:pointer-events-auto group-hover/cite:opacity-100">
        <span className="line-clamp-2 block font-medium text-gray-900">
          {ref.title}
        </span>
        <span className="mt-1 block text-gray-500">{ref.domain}</span>
        {ref.url && (
          <a
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-blue-600 hover:underline"
          >
            {ref.url}
          </a>
        )}
      </span>
    </span>
  );
}

/** Process text children to replace [n] patterns with CitationBadge components */
function processCitations(
  children: React.ReactNode,
  references: PlanReference[]
): React.ReactNode {
  if (!references || references.length === 0) return children;

  const processNode = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') {
      const parts: React.ReactNode[] = [];
      const regex = /\[(\d+)\](?!\()/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(node)) !== null) {
        if (match.index > lastIndex) {
          parts.push(node.slice(lastIndex, match.index));
        }
        const citationIndex = parseInt(match[1], 10);
        if (citationIndex >= 1 && citationIndex <= references.length) {
          parts.push(
            <CitationBadge
              key={`cite-${match.index}-${citationIndex}`}
              index={citationIndex}
              references={references}
            />
          );
        } else {
          parts.push(match[0]);
        }
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < node.length) {
        parts.push(node.slice(lastIndex));
      }

      return parts.length === 1 ? parts[0] : <>{parts}</>;
    }

    if (Array.isArray(node)) {
      return node.map((child, i) => (
        <React.Fragment key={i}>{processNode(child)}</React.Fragment>
      ));
    }

    return node;
  };

  return processNode(children);
}

/** Build markdown components that process citations within text */
function buildCitationMarkdownComponents(
  references: PlanReference[]
): React.ComponentPropsWithoutRef<typeof ReactMarkdown>['components'] {
  return {
    ...PLAN_MARKDOWN_COMPONENTS,
    p: ({ children }) => (
      <p className="mb-3 text-sm leading-relaxed text-gray-700 last:mb-0">
        {processCitations(children, references)}
      </p>
    ),
    li: ({ children }) => (
      <li className="flex items-start gap-2 text-sm leading-relaxed">
        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
        <span className="flex-1">{processCitations(children, references)}</span>
      </li>
    ),
    td: ({ children, style }) => (
      <Td className="min-w-[100px] px-3 py-2 text-sm" style={style}>
        {processCitations(children, references)}
      </Td>
    ),
    th: ({ children, style }) => (
      <Th
        className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-gray-900"
        style={style}
      >
        {processCitations(children, references)}
      </Th>
    ),
  };
}

/** Markdown renderer with citation support for the report tab */
function ReportMarkdown({
  content,
  references,
}: {
  content: string;
  references: PlanReference[];
}) {
  const components = useMemo(
    () => buildCitationMarkdownComponents(references),
    [references]
  );

  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ============================================
// Source type styling
// ============================================

const SOURCE_TYPE_COLORS: Record<string, string> = {
  academic: 'bg-blue-100 text-blue-700',
  official: 'bg-green-100 text-green-700',
  news: 'bg-yellow-100 text-yellow-700',
  report: 'bg-orange-100 text-orange-700',
  web: 'bg-gray-100 text-gray-600',
};

interface PlanContentPanelProps {
  plan: PlanDetail;
  planId: string;
  className?: string;
  activeTab?: PlanContentTabType;
  onTabChange?: (tab: PlanContentTabType) => void;
  /** Phase to auto-expand (from left panel click) */
  selectedPhase?: number | null;
  onPhaseDeselect?: () => void;
  onExport?: () => void;
  onRetryPhase?: (phase: number) => void;
}

export function PlanContentPanel({
  plan,
  planId,
  className,
  activeTab: controlledTab,
  onTabChange,
  selectedPhase,
  onPhaseDeselect,
  onExport,
  onRetryPhase,
}: PlanContentPanelProps) {
  const { t } = useTranslation();
  const [internalTab, setInternalTab] = useState<PlanContentTabType>('phases');
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<TopicMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (tab: PlanContentTabType) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalTab(tab);
    }
  };

  // Auto-expand phase when selected from left panel
  useEffect(() => {
    if (selectedPhase !== null && selectedPhase !== undefined) {
      setExpandedPhase(selectedPhase);
    }
  }, [selectedPhase]);

  // Fetch messages (only show loading spinner on initial load)
  const hasFetchedRef = useRef(false);
  const fetchMessages = useCallback(async () => {
    if (!planId) return;
    if (!hasFetchedRef.current) {
      setIsLoadingMessages(true);
    }
    try {
      const result = await getMessages(planId, { limit: 100 });
      setMessages(result.messages || []);
      hasFetchedRef.current = true;
    } catch {
      // Silently fail — messages may not exist yet
    } finally {
      setIsLoadingMessages(false);
    }
  }, [planId]);

  // Load messages on mount only
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Stable polling: poll messages whenever plan is in-progress (not just active phase).
  // Matches the broader polling condition in page.tsx to cover auto-advance gaps.
  const shouldPollMessages = (() => {
    if (plan.currentPhase === 0) return false;
    const statuses = Object.values(plan.phaseStatus);
    const completedOrSkipped = statuses.filter(
      (s) => s.status === 'completed' || s.status === 'skipped'
    ).length;
    if (completedOrSkipped >= plan.totalPhases) return false;
    const currentPhaseStatus = plan.phaseStatus[plan.currentPhase];
    if (currentPhaseStatus?.status === 'failed') return false;
    return true;
  })();

  useEffect(() => {
    if (!shouldPollMessages || activeTab !== 'activity') return;
    const interval = setInterval(() => {
      fetchMessages().catch(() => {
        // Silently retry on next interval
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [shouldPollMessages, fetchMessages, activeTab]);

  // Send chat message
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !planId || isSending) return;

    setIsSending(true);
    try {
      await sendMessage(planId, { content: chatInput.trim() });
      setChatInput('');
      await fetchMessages();
      toast.success(t('aiPlanning.content.noteSaved'));
      setActiveTab('activity');
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('aiPlanning.error.noteFailed')
      );
    } finally {
      setIsSending(false);
    }
  };

  // Count completed phases for badge
  const completedCount = Object.values(plan.phaseStatus).filter(
    (s) => s.status === 'completed'
  ).length;

  // Report content: Phase 6 (Delivery) only — the formal deliverable report.
  const reportContent = useMemo(() => {
    // Report tab shows ONLY Phase 6 (Delivery) — the formal report.
    // Phase 1-5 process details are viewable in the "Tasks" tab.
    const phase6 = plan.phaseStatus[6];
    if (phase6?.status === 'completed' && phase6.summary) {
      return phase6.summary;
    }
    return null;
  }, [plan]);

  // Tab config
  const tabs: Array<{
    key: PlanContentTabType;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      key: 'phases',
      label: t('aiPlanning.content.tasks'),
      icon: <LayoutList className="h-4 w-4" />,
      badge: completedCount > 0 ? completedCount : undefined,
    },
    {
      key: 'report',
      label: t('aiPlanning.content.planReport'),
      icon: <FileText className="h-4 w-4" />,
    },
    {
      key: 'references',
      label: t('aiPlanning.content.references'),
      icon: <LinkIcon className="h-4 w-4" />,
      badge: plan.references?.length > 0 ? plan.references.length : undefined,
    },
    {
      key: 'activity',
      label: t('aiPlanning.content.activityLog'),
      icon: <Clock className="h-4 w-4" />,
      badge: messages.length > 0 ? messages.length : undefined,
    },
  ];

  return (
    <div className={cn('flex h-full flex-col bg-white', className)}>
      {/* Tab Header */}
      <Tabs
        className="overflow-x-auto px-4"
        items={tabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          iconNode: tab.icon,
          count: tab.badge && tab.badge > 0 ? tab.badge : undefined,
        }))}
        value={activeTab}
        onChange={(k) => setActiveTab(k as PlanContentTabType)}
      />

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Tasks Tab */}
        {activeTab === 'phases' && (
          <div className="p-4">
            {plan.currentPhase === 0 ? (
              <TasksEmptyState />
            ) : (
              <div className="space-y-3">
                {PLANNING_WORKFLOW_CONFIG.map((wf) => (
                  <PhaseTaskCard
                    key={wf.phase}
                    plan={plan}
                    workflow={wf}
                    isExpanded={expandedPhase === wf.phase}
                    onToggle={() => {
                      setExpandedPhase(
                        expandedPhase === wf.phase ? null : wf.phase
                      );
                      if (expandedPhase === wf.phase) {
                        onPhaseDeselect?.();
                      }
                    }}
                    onRetryPhase={onRetryPhase}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Report Tab (visible) + Export content div (always rendered for WYSIWYG capture) */}
        {activeTab === 'report' && (
          <div className="p-4">
            {reportContent ? (
              <div className="prose prose-sm max-w-none">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900">
                    {plan.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                      {t('aiPlanning.report.deliveryReport')}
                    </span>
                    {onExport && (
                      <button
                        onClick={onExport}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t('aiPlanning.actions.exportReport')}
                      </button>
                    )}
                  </div>
                </div>
                {plan.goal && (
                  <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                    <p className="text-sm font-medium text-blue-800">
                      {t('aiPlanning.create.goal')}
                    </p>
                    <p className="mt-1 text-sm text-blue-700">{plan.goal}</p>
                  </div>
                )}
                <div
                  className="rounded-lg border border-gray-200 p-4"
                  data-export-content="planning"
                >
                  <ReportMarkdown
                    content={reportContent}
                    references={plan.references || []}
                  />
                </div>

                {/* References are already included in the AI-generated report markdown.
                   A dedicated References tab is available for detailed source browsing. */}
              </div>
            ) : (
              <ReportInProgressState
                plan={plan}
                completedCount={completedCount}
              />
            )}
          </div>
        )}

        {/* Hidden export content div: always rendered when report exists but tab is not active.
            This ensures document.querySelector('[data-export-content="planning"]') always
            finds the element for WYSIWYG HTML capture regardless of which tab is active. */}
        {activeTab !== 'report' && reportContent && (
          <div className="hidden">
            <div data-export-content="planning">
              <ReportMarkdown
                content={reportContent}
                references={plan.references || []}
              />
            </div>
          </div>
        )}

        {/* Hidden full export content: all completed phases for WYSIWYG capture */}
        {completedCount > 0 && (
          <div className="hidden">
            <div data-export-content="planning-full">
              <PlanFullExportRenderer plan={plan} />
            </div>
          </div>
        )}

        {/* References Tab */}
        {activeTab === 'references' && (
          <PlanReferencesTab references={plan.references || []} />
        )}

        {/* Activity Log Tab - Fix 6: Real messages from topic */}
        {activeTab === 'activity' && (
          <div className="p-4">
            {isLoadingMessages && messages.length === 0 ? (
              <LoadingState size="sm" />
            ) : messages.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Clock className="h-10 w-10" />}
                title={t('aiPlanning.content.noActivity')}
              />
            ) : (
              <div className="relative">
                <div className="absolute bottom-0 left-3 top-0 w-px bg-gray-200" />
                <div className="space-y-4">
                  {messages.map((msg) => {
                    const isAI = !!msg.aiMemberId;
                    const isUser = !!msg.senderId;

                    return (
                      <div key={msg.id} className="relative flex gap-3 pl-1">
                        <div
                          className={cn(
                            'relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white',
                            isAI
                              ? 'bg-blue-500'
                              : isUser
                                ? 'bg-green-500'
                                : 'bg-gray-400'
                          )}
                        />
                        <div className="flex-1 pb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">
                              {isAI
                                ? msg.aiMember?.displayName || 'AI'
                                : msg.sender?.fullName ||
                                  msg.sender?.username ||
                                  t('aiPlanning.content.user')}
                            </span>
                            {isAI && msg.modelUsed && (
                              <ModelBadge
                                modelId={msg.modelUsed}
                                variant="subtle"
                              />
                            )}
                          </div>
                          <div className="mt-1 text-sm text-gray-700">
                            <PlanMarkdown
                              content={
                                msg.content.length > 500
                                  ? `${msg.content.slice(0, 500)}...`
                                  : msg.content
                              }
                              references={plan.references}
                            />
                          </div>
                          <p className="mt-1 text-xs text-gray-400">
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom: Note input */}
      <div className="shrink-0 border-t border-gray-200 bg-gray-50/50 px-4 py-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <textarea
              rows={1}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={t('aiPlanning.content.inputPlaceholder')}
              className="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm leading-relaxed text-gray-700 placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <p className="mt-1.5 text-xs text-gray-400">
              {t('aiPlanning.content.noteHint')}
            </p>
          </div>
          <button
            onClick={handleSendMessage}
            disabled={!chatInput.trim() || isSending}
            className={cn(
              'shrink-0 self-end rounded-lg px-4 py-2.5 text-white transition-colors',
              chatInput.trim() && !isSending
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'cursor-not-allowed bg-blue-600 opacity-50'
            )}
          >
            {isSending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <StickyNote className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Tasks Empty State (matching AI Insights pattern)
// ============================================

function TasksEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center px-8 py-8">
      {/* Large circular icon */}
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-100">
        <LayoutList className="h-10 w-10 text-blue-500" />
      </div>

      <h3 className="mt-4 text-lg font-medium text-gray-900">
        {t('aiPlanning.content.waitingForStart')}
      </h3>
      <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
        {t('aiPlanning.content.clickStartHint')}
      </p>

      {/* Workflow step cards */}
      <div className="mt-6 w-full max-w-md space-y-2.5">
        {PLANNING_WORKFLOW_CONFIG.map((wf) => {
          const agents = wf.agentKeys
            .map((key) => {
              const role = PLANNING_ROLES_CONFIG.find((r) => r.key === key);
              return role
                ? {
                    icon: ROLE_ICON_MAP[key] || '',
                    name: t(`aiPlanning.roles.${role.nameKey}`),
                  }
                : null;
            })
            .filter(Boolean) as Array<{ icon: string; name: string }>;

          return (
            <div
              key={wf.phase}
              className="rounded-lg border border-dashed border-gray-200 p-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                  {wf.phase}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-700">
                    {t(`aiPlanning.phases.${wf.key}`)}
                  </div>
                  <p className="text-xs text-gray-500">
                    {agents.map((a) => `${a.icon} ${a.name}`).join(' + ')}
                  </p>
                </div>
                {wf.parallel && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">
                    {t('aiPlanning.settings.parallelHint')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// Report In-Progress State
// ============================================

function ReportInProgressState({
  plan,
  completedCount,
}: {
  plan: PlanDetail;
  completedCount: number;
}) {
  const { t } = useTranslation();
  const isNotStarted = plan.currentPhase === 0;
  const isInProgress = !isNotStarted && completedCount < plan.totalPhases;

  return (
    <div className="flex flex-col items-center justify-center px-8 py-12">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
        <FileText className="h-8 w-8 text-blue-400" />
      </div>

      {isNotStarted ? (
        <>
          <p className="mt-4 text-sm text-gray-500">
            {t('aiPlanning.report.notStarted')}
          </p>
        </>
      ) : isInProgress ? (
        <>
          <p className="mt-4 text-sm font-medium text-gray-700">
            {t('aiPlanning.report.currentProgress', {
              current: plan.currentPhase,
              total: plan.totalPhases,
            })}
          </p>
          <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
            {t('aiPlanning.report.reportGenerating')}
          </p>
          {/* Phase progress bar */}
          <div className="mt-5 w-full max-w-xs">
            <div className="flex justify-between text-xs text-gray-400">
              {PLANNING_WORKFLOW_CONFIG.map((wf) => {
                const s = plan.phaseStatus[wf.phase];
                const isCompleted = s?.status === 'completed';
                const isActive = s?.status === 'active';
                return (
                  <div
                    key={wf.phase}
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium',
                      isCompleted
                        ? 'bg-green-500 text-white'
                        : isActive
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                    )}
                  >
                    {isCompleted ? (
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      wf.phase
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all"
                style={{
                  width: `${(completedCount / plan.totalPhases) * 100}%`,
                }}
              />
            </div>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-500">
          {t('aiPlanning.content.noReport')}
        </p>
      )}
    </div>
  );
}

// ============================================
// Phase Task Card (accordion detail)
// ============================================

function PhaseTaskCard({
  plan,
  workflow,
  isExpanded,
  onToggle,
  onRetryPhase,
}: {
  plan: PlanDetail;
  workflow: (typeof PLANNING_WORKFLOW_CONFIG)[number];
  isExpanded: boolean;
  onToggle: () => void;
  onRetryPhase?: (phase: number) => void;
}) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const status = plan.phaseStatus[workflow.phase];

  // Auto-scroll to card when expanded
  useEffect(() => {
    if (isExpanded && cardRef.current) {
      // Small delay to let the content render before scrolling
      const timer = setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isExpanded]);
  const phaseKey = PHASE_KEYS[workflow.phase];
  const isActive = status?.status === 'active';
  const isCompleted = status?.status === 'completed';
  const isFailed = status?.status === 'failed';
  const isCurrent = workflow.phase === plan.currentPhase;

  // Build agent info (memoized to avoid recalculation on every render)
  const agents = useMemo(
    () =>
      workflow.agentKeys
        .map((key) => {
          const role = PLANNING_ROLES_CONFIG.find((r) => r.key === key);
          if (!role) return null;
          const memberIndex = AGENT_KEY_TO_INDEX[key];
          const member = plan.members?.[memberIndex];
          return {
            icon: ROLE_ICON_MAP[key] || '',
            name: t(`aiPlanning.roles.${role.nameKey}`),
            description: t(`aiPlanning.roles.${role.descriptionKey}`),
            skills: role.skills,
            tools: role.tools,
            model: member?.aiModel,
          };
        })
        .filter(Boolean) as Array<{
        icon: string;
        name: string;
        description: string;
        skills: string[];
        tools: string[];
        model?: string;
      }>,
    [workflow.agentKeys, plan.members, t]
  );

  return (
    <div
      ref={cardRef}
      className={cn(
        'rounded-lg border transition-colors',
        isActive
          ? 'border-blue-200 bg-blue-50/30'
          : isCompleted
            ? 'border-green-200 bg-green-50/30'
            : isFailed
              ? 'border-red-200 bg-red-50/30'
              : 'border-gray-100 bg-white'
      )}
    >
      {/* Header - clickable, sticky when expanded */}
      <div
        onClick={onToggle}
        className={cn(
          'flex cursor-pointer items-center gap-3 p-3',
          isExpanded &&
            (isActive
              ? 'sticky top-0 z-10 border-b border-blue-200 bg-blue-50 shadow-sm'
              : isCompleted
                ? 'sticky top-0 z-10 border-b border-green-200 bg-green-50 shadow-sm'
                : isFailed
                  ? 'sticky top-0 z-10 border-b border-red-200 bg-red-50 shadow-sm'
                  : 'sticky top-0 z-10 border-b border-gray-200 bg-white shadow-sm')
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium',
            isCompleted
              ? 'bg-green-500 text-white'
              : isActive
                ? 'bg-blue-500 text-white'
                : isFailed
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-200 text-gray-500'
          )}
        >
          {isCompleted ? (
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            workflow.phase
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800">
              {t(`aiPlanning.phases.${phaseKey}`)}
            </span>
            {isCurrent && isActive && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                {'\u25C0'} {t('aiPlanning.content.currentPhase')}
              </span>
            )}
            {workflow.parallel && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">
                {t('aiPlanning.settings.parallelHint')}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {agents.map((a) => `${a.icon} ${a.name}`).join(' + ')}
          </p>
        </div>

        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${PHASE_STATUS_COLORS[status?.status || 'pending']}`}
        >
          {t(`aiPlanning.phaseStatus.${status?.status || 'pending'}`)}
        </span>

        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform',
            isExpanded && 'rotate-180'
          )}
        />
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="space-y-3 border-t border-gray-100 p-3">
          {/* Phase description */}
          {agents.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">
                {t('aiPlanning.content.phaseDescription')}
              </div>
              <p className="text-sm text-gray-700">
                {agents.map((a) => a.description).join('; ')}
              </p>
            </div>
          )}

          {/* Participating agents */}
          <div>
            <div className="mb-1.5 text-xs font-medium text-gray-500">
              {'\u{1F465}'} {t('aiPlanning.content.participatingAgents')}
            </div>
            <div className="space-y-2">
              {agents.map((agent) => (
                <div key={agent.name} className="rounded-lg bg-gray-50 p-2.5">
                  <div className="flex items-center gap-2">
                    <span>{agent.icon}</span>
                    <span className="text-sm font-medium text-gray-800">
                      {agent.name}
                    </span>
                    {agent.model && (
                      <ModelBadge
                        modelId={agent.model}
                        variant="subtle"
                        className="ml-auto"
                      />
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {agent.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700"
                      >
                        {skill}
                      </span>
                    ))}
                    {agent.tools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-700"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Phase output (summary) */}
          {status?.summary && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">
                {'\u{1F4DD}'} {t('aiPlanning.content.phaseOutput')}
              </div>
              <div className="rounded-lg border border-gray-200 p-3">
                <PlanMarkdown
                  content={status.summary}
                  references={plan.references}
                />
              </div>
            </div>
          )}

          {/* Active indicator */}
          {isActive && !status?.summary && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              {t('aiPlanning.content.executing')}
            </div>
          )}

          {/* Failed indicator */}
          {isFailed && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-red-700">
                <AlertTriangle className="h-4 w-4" />
                <span>{t('aiPlanning.content.phaseFailed')}</span>
              </div>
              {status?.error && (
                <p className="mt-1 text-xs text-red-600">{status.error}</p>
              )}
            </div>
          )}

          {/* Completion time & retry */}
          {status?.completedAt && (
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-xs text-gray-400">
                {t('aiPlanning.content.completedAt')}:{' '}
                {formatTime(status.completedAt)}
              </span>
              {isCompleted && onRetryPhase && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryPhase(workflow.phase);
                  }}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {t('aiPlanning.actions.retryThisPhase')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// References Tab (matching AI Insights TopicReferencesPanel)
// ============================================

/** Get effective credibility score: prefer credibilityScore (20-100), fallback to score * 100 */
function getCredibilityScore(r: PlanReference): number {
  return r.credibilityScore ?? Math.round((r.score || 0) * 100);
}

function PlanReferencesTab({ references }: { references: PlanReference[] }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>(
    'all'
  );
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Filter and sort
  const filteredRefs = useMemo(() => {
    let result = [...references];

    if (filter !== 'all') {
      result = result.filter((r) => {
        const score = getCredibilityScore(r);
        if (filter === 'high') return score >= 70;
        if (filter === 'medium') return score >= 40 && score < 70;
        if (filter === 'low') return score < 40;
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortBy === 'score') {
        return getCredibilityScore(b) - getCredibilityScore(a);
      }
      const dateA = a.publishedDate ? new Date(a.publishedDate).getTime() : 0;
      const dateB = b.publishedDate ? new Date(b.publishedDate).getTime() : 0;
      return dateB - dateA;
    });

    return result;
  }, [references, filter, sortBy]);

  // Statistics
  const stats = useMemo(() => {
    const high = references.filter((r) => getCredibilityScore(r) >= 70).length;
    const medium = references.filter(
      (r) => getCredibilityScore(r) >= 40 && getCredibilityScore(r) < 70
    ).length;
    const low = references.filter((r) => getCredibilityScore(r) < 40).length;
    return { total: references.length, high, medium, low };
  }, [references]);

  if (references.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-8 py-16 text-gray-400">
        <LinkIcon className="mb-3 h-10 w-10 text-gray-300" />
        <h3 className="text-base font-medium text-gray-700">
          {t('aiPlanning.references.noReferences')}
        </h3>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {t('aiPlanning.references.noReferencesHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">
            {t('aiPlanning.references.totalSources', {
              total: stats.total,
            })}
          </span>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              {t('aiPlanning.references.highRelevance', {
                count: stats.high,
              })}
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {t('aiPlanning.references.mediumRelevance', {
                count: stats.medium,
              })}
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              {t('aiPlanning.references.lowRelevance', {
                count: stats.low,
              })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
          >
            <option value="all">{t('aiPlanning.references.filterAll')}</option>
            <option value="high">
              {t('aiPlanning.references.filterHigh')}
            </option>
            <option value="medium">
              {t('aiPlanning.references.filterMedium')}
            </option>
            <option value="low">{t('aiPlanning.references.filterLow')}</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
          >
            <option value="score">
              {t('aiPlanning.references.sortByRelevance')}
            </option>
            <option value="date">
              {t('aiPlanning.references.sortByDate')}
            </option>
          </select>
        </div>
      </div>

      {/* Reference list — single column, clean academic style */}
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-gray-100">
          {filteredRefs.map((item) => {
            const citationIndex =
              references.findIndex((r) => r.id === item.id) + 1;
            const isExpanded = expandedIds.has(item.id);
            const scorePercent = getCredibilityScore(item);
            const scoreColor =
              scorePercent >= 70
                ? 'text-green-600'
                : scorePercent >= 40
                  ? 'text-amber-600'
                  : 'text-red-500';
            const scoreBg =
              scorePercent >= 70
                ? 'bg-green-500'
                : scorePercent >= 40
                  ? 'bg-amber-500'
                  : 'bg-red-400';

            return (
              <div
                key={item.id}
                className="group transition-colors hover:bg-gray-50/80"
              >
                <div
                  className="flex cursor-pointer gap-3 px-4 py-3.5"
                  onClick={() => toggleExpanded(item.id)}
                >
                  {/* Citation number */}
                  <span className="mt-0.5 flex h-6 w-7 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-xs font-semibold text-gray-500 group-hover:bg-purple-50 group-hover:text-purple-600">
                    {citationIndex}
                  </span>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {/* Title — clickable to open source */}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="line-clamp-1 text-sm font-medium text-gray-900 hover:text-blue-600"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.title}
                    </a>

                    {/* Metadata line: source type · domain · date */}
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-400">
                      <span
                        className={cn(
                          'rounded px-1.5 py-px text-[10px] font-medium leading-4',
                          SOURCE_TYPE_COLORS[item.sourceType || 'web']
                        )}
                      >
                        {t(`aiPlanning.sourceType.${item.sourceType || 'web'}`)}
                      </span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">{item.domain}</span>
                      {item.publishedDate && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span>{formatTime(item.publishedDate)}</span>
                        </>
                      )}
                    </div>

                    {/* Snippet preview (collapsed) */}
                    {!isExpanded && item.snippet && (
                      <p className="mt-1.5 line-clamp-1 text-xs text-gray-400">
                        {item.snippet}
                      </p>
                    )}
                  </div>

                  {/* Score + expand indicator */}
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {scorePercent > 0 && (
                      <div className="flex items-center gap-1.5">
                        <div className="h-1 w-8 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={cn('h-full rounded-full', scoreBg)}
                            style={{ width: `${scorePercent}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            'w-7 text-right text-xs font-medium tabular-nums',
                            scoreColor
                          )}
                        >
                          {scorePercent}
                        </span>
                      </div>
                    )}
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-gray-300 transition-transform',
                        isExpanded && 'rotate-180'
                      )}
                    />
                  </div>
                </div>

                {/* Expanded snippet */}
                {isExpanded && item.snippet && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3 pl-14">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
                      {item.snippet}
                    </p>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      {t('aiPlanning.references.openOriginal')}
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Full export renderer: all completed phases for WYSIWYG capture */
function PlanFullExportRenderer({ plan }: { plan: PlanDetail }) {
  const { t } = useTranslation();
  const references = plan.references || [];

  return (
    <div className="prose prose-sm max-w-none bg-white p-6">
      {/* Cover */}
      <div className="mb-8 border-b-2 border-gray-300 pb-6">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">{plan.name}</h1>
        {plan.goal && (
          <p className="mb-3 text-sm text-gray-600">
            {t('aiPlanning.create.goal')}: {plan.goal}
          </p>
        )}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>
            {t('aiPlanning.export.depth')}:{' '}
            {t(`aiPlanning.depth.${plan.depth?.toLowerCase() || 'standard'}`)}
          </span>
          <span>
            {t('aiPlanning.export.exportDate')}:{' '}
            {new Date().toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Phase contents */}
      {PLANNING_WORKFLOW_CONFIG.map((wf) => {
        const status = plan.phaseStatus[wf.phase];
        if (status?.status !== 'completed' || !status.summary) return null;

        const phaseKey = PHASE_KEYS[wf.phase];
        const agents = wf.agentKeys
          .map((key) => {
            const role = PLANNING_ROLES_CONFIG.find((r) => r.key === key);
            return role ? t(`aiPlanning.roles.${role.nameKey}`) : null;
          })
          .filter(Boolean);

        return (
          <div key={wf.phase} className="mb-8">
            {/* Phase title */}
            <div className="mb-4 border-b border-gray-200 pb-2">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white">
                  {wf.phase}
                </span>
                {t(`aiPlanning.phases.${phaseKey}`)}
              </h2>
              <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                <span>
                  {t('aiPlanning.export.agents')}: {agents.join(', ')}
                </span>
                {status.completedAt && (
                  <span>
                    {t('aiPlanning.content.completedAt')}:{' '}
                    {formatTime(status.completedAt)}
                  </span>
                )}
              </div>
            </div>

            {/* Phase content */}
            <PlanMarkdown content={status.summary} references={references} />
          </div>
        );
      })}

      {/* References appendix */}
      {references.length > 0 && (
        <div className="mt-8 border-t-2 border-gray-300 pt-6">
          <h2 className="mb-4 text-lg font-bold text-gray-900">
            {t('aiPlanning.export.referencesAppendix')}
          </h2>
          <div className="space-y-2">
            {references.map((ref, idx) => (
              <div key={ref.id} className="text-sm text-gray-700">
                <span className="font-semibold text-gray-900">[{idx + 1}]</span>{' '}
                {ref.title}
                {ref.domain && (
                  <span className="text-gray-500"> — {ref.domain}</span>
                )}
                {ref.sourceType && (
                  <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                    {ref.sourceType}
                  </span>
                )}
                {ref.url && (
                  <span className="ml-1 text-xs text-blue-600">{ref.url}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Format ISO date string to localized time */
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export default PlanContentPanel;
