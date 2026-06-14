'use client';

/**
 * ResearchProjectLayout - Research project detail page layout
 *
 * Two-panel layout: Left TeamPanel (340px, collapsible) + Right Tab Content (flex-1)
 * Tabs: Discussion, Insights, Ideas, Demos, Report
 *
 * Manages: useDiscussionResearch SSE hook, session loading, tab state,
 * ideas/demos hooks, and coordination between all child components.
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import {
  ArrowLeft,
  MessageSquare,
  Brain,
  Lightbulb,
  Play,
  FileText,
  Maximize2,
  Minimize2,
  Loader2,
  RefreshCw,
  Link,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useTranslation } from '@/lib/i18n';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { toast } from '@/stores';
import { useDiscussionResearch } from '@/hooks';
import { useResearchIdeas } from '@/hooks/features/useResearchIdeas';
import { useResearchDemos } from '@/hooks/features/useResearchDemos';
import { useIterativeResearch } from '@/hooks/features/useIterativeResearch';
import type { ResearchSession } from './types';
import type { ResearchCreationOptions } from './research-creation-dialog';
import { AgentPanel } from './discussion/AgentPanel';
import { DiscussionChat } from './discussion/DiscussionChat';
import { InsightsPanel } from './discussion/InsightsPanel';
import { IdeasPanel } from './discussion/IdeasPanel';
import { DemosPanel } from './discussion/DemosPanel';
import { ReportPanel } from './discussion/ReportPanel';
import { ReferencesPanel } from './discussion/ReferencesPanel';
import { IterationTimeline } from './iteration/IterationTimeline';
import { Tabs } from '@/components/ui/tabs';

// ==================== Types ====================

interface ResearchProjectLayoutProps {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  onBack: () => void;
}

type TabKey =
  | 'discussion'
  | 'insights'
  | 'ideas'
  | 'demos'
  | 'iterations'
  | 'report'
  | 'references';

interface TabDefinition {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// ==================== Component ====================

export function ResearchProjectLayout({
  projectId,
  projectName,
  projectDescription,
  onBack,
}: ResearchProjectLayoutProps) {
  const { t, locale } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('discussion');
  const [tabBadges, setTabBadges] = useState<Partial<Record<TabKey, boolean>>>(
    {}
  );
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [viewingSession, setViewingSession] = useState<ResearchSession | null>(
    null
  );
  const [query, setQuery] = useState('');
  const queryRef = useRef(query);
  queryRef.current = query;
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [isExtractingInsights, setIsExtractingInsights] = useState(false);
  const [isExtractingIdeas, setIsExtractingIdeas] = useState(false);
  const [topicExpanded, setTopicExpanded] = useState(true);

  // Ref for recovery poll interval cleanup
  const recoveryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether background recovery has been initiated (prevent re-triggers)
  const backgroundRecoveryInitiatedRef = useRef(false);
  // State for background research indicator
  const [backgroundResearchSession, setBackgroundResearchSession] =
    useState<ResearchSession | null>(null);

  // Insights (INSIGHT type) & Ideas (CREATIVE_IDEA type) hooks
  const {
    ideas: insights,
    isLoading: insightsLoading,
    fetchIdeas: fetchInsights,
    updateIdea: updateInsight,
    extractIdeas: extractInsights,
  } = useResearchIdeas(projectId, 'INSIGHT');

  const {
    ideas: creativeIdeas,
    isLoading: ideasLoading,
    fetchIdeas: fetchCreativeIdeas,
    updateIdea: updateCreativeIdea,
    extractCreativeIdeas,
  } = useResearchIdeas(projectId, 'CREATIVE_IDEA');

  const {
    demos,
    isLoading: demosLoading,
    fetchDemos,
    deleteDemo,
    generateDemo,
  } = useResearchDemos(projectId);

  // Iterative research hook
  const {
    state: iterativeState,
    startResearch: startIterativeResearch,
    stop: stopIterative,
    isActive: isIterating,
    sendFeedback,
    extendFeedback,
  } = useIterativeResearch(projectId, {
    onComplete: ({ report, sessionId }) => {
      const newSession: ResearchSession = {
        id: sessionId,
        query: queryRef.current,
        status: 'COMPLETED',
        mode: 'iterative',
        report,
        discussion: [],
        directions: null,
        sourcesUsed: report.metadata.totalSources,
        tokensUsed: 0,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setViewingSession(newSession);
      setTabBadges((prev) => ({ ...prev, report: true }));
      toast.success(
        t('aiResearch.researchComplete') || '研究完成',
        t('aiResearch.researchCompleteDesc') || '报告已生成，点击报告 Tab 查看'
      );
      // Reload sessions to get the full data, then update viewingSession with server data
      void reloadSessions().then((reloaded) => {
        if (reloaded) {
          const fresh = reloaded.find((s) => s.id === sessionId);
          if (fresh) {
            setViewingSession(fresh);
          }
        }
      });
      // Auto-extract insights and creative ideas from the completed session
      setIsExtractingInsights(true);
      setIsExtractingIdeas(true);
      setTabBadges((prev) => ({ ...prev, insights: true, ideas: true }));
      void extractInsights(sessionId)
        .then(() => {
          setIsExtractingInsights(false);
          return extractCreativeIdeas();
        })
        .then(() => setIsExtractingIdeas(false))
        .catch((err) => {
          logger.error('Auto-extract failed:', err);
          setIsExtractingInsights(false);
          setIsExtractingIdeas(false);
          toast.error(
            t('aiResearch.extractFailed') || '提取失败',
            t('aiResearch.extractFailedDesc') ||
              '自动提取观点失败，可在观点 Tab 手动重试'
          );
        });
    },
    onError: (error) => {
      logger.error('Iterative Research error:', error);
    },
    onIterationUpdate: () => {
      // Don't auto-switch tabs - use badges instead (B4)
      setTabBadges((prev) => ({ ...prev, iterations: true }));
      // P0-2: Refetch ideas/demos data so other tabs auto-update during iteration
      void fetchInsights();
      void fetchCreativeIdeas();
      void fetchDemos();
    },
    onIterationExit: (data) => {
      logger.info(
        `Iterative research exited: ${data.reason}, score=${data.finalScore}`
      );
    },
    onStreamEndIncomplete: () => {
      logger.warn(
        'Iterative SSE stream ended without completion, starting recovery polling...'
      );
      if (recoveryPollRef.current) {
        clearInterval(recoveryPollRef.current);
      }
      let attempts = 0;
      const maxAttempts = 90;
      const pollInterval = setInterval(async () => {
        attempts++;
        const reloaded = await reloadSessions();
        if (reloaded) {
          const completed = reloaded.find(
            (s) => s.status === 'COMPLETED' && s.report
          );
          const failed = !completed
            ? reloaded.find(
                (s) =>
                  s.status === 'FAILED' &&
                  s.discussion &&
                  Array.isArray(s.discussion) &&
                  s.discussion.length > 0
              )
            : null;
          if (completed) {
            clearInterval(pollInterval);
            setViewingSession(completed);
            setActiveTab('report');
            logger.info(
              'Iterative recovery polling: found completed session',
              completed.id
            );
            return;
          }
          if (failed) {
            clearInterval(pollInterval);
            setViewingSession(failed);
            setActiveTab('discussion');
            logger.info(
              'Iterative recovery polling: found failed session with discussion data',
              failed.id
            );
            return;
          }
        }
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          logger.warn('Iterative recovery polling: gave up after max attempts');
        }
      }, 10000);
      recoveryPollRef.current = pollInterval;
    },
  });

  // Reusable session loader
  const reloadSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/deep-research/sessions`,
        { headers: { ...getAuthHeader() } }
      );
      if (res.ok) {
        const result = await res.json();
        const raw = result?.data ?? result;
        const list = Array.isArray(raw) ? raw : (raw?.data ?? []);
        setSessions(list);
        return list as ResearchSession[];
      }
    } catch (err) {
      logger.error('Failed to reload sessions:', err);
    }
    return null;
  }, [projectId]);

  // Discussion research hook
  const {
    state: discussionState,
    startResearch,
    stop,
    skipPhase,
    isActive: isSearching,
  } = useDiscussionResearch(projectId, {
    onComplete: ({ report, sessionId, messages, directions }) => {
      // Create a session from the completed research
      // Uses messages/directions passed directly from the hook (via refs, always fresh)
      const newSession: ResearchSession = {
        id: sessionId,
        query: query,
        status: 'COMPLETED',
        mode: 'single',
        report,
        discussion: messages.map((msg) => ({
          id: msg.id,
          agentRole: msg.agentRole,
          agentName: msg.agentName,
          agentIcon: msg.agentIcon,
          content: msg.content,
          phase: msg.phase,
          messageType: msg.messageType,
          metadata: msg.metadata,
          timestamp: msg.timestamp,
        })),
        directions:
          directions.length > 0
            ? {
                directions: directions.map((d) => ({
                  title: d,
                })),
              }
            : null,
        sourcesUsed: report.metadata.totalSources,
        tokensUsed: 0,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setViewingSession(newSession);
      setTabBadges((prev) => ({ ...prev, report: true }));
      toast.success(
        t('aiResearch.researchComplete') || '研究完成',
        t('aiResearch.researchCompleteDesc') || '报告已生成，点击报告 Tab 查看'
      );
      // Auto-extract insights and creative ideas from the completed session
      setIsExtractingInsights(true);
      setIsExtractingIdeas(true);
      setTabBadges((prev) => ({ ...prev, insights: true, ideas: true }));
      void extractInsights(sessionId)
        .then(() => {
          setIsExtractingInsights(false);
          return extractCreativeIdeas();
        })
        .then(() => setIsExtractingIdeas(false))
        .catch((err) => {
          logger.error('Auto-extract failed:', err);
          setIsExtractingInsights(false);
          setIsExtractingIdeas(false);
          toast.error(
            t('aiResearch.extractFailed') || '提取失败',
            t('aiResearch.extractFailedDesc') ||
              '自动提取观点失败，可在观点 Tab 手动重试'
          );
        });
    },
    onError: (error) => {
      logger.error('Discussion Research error:', error);
    },
    onStreamEndIncomplete: () => {
      // SSE stream ended without completion (server timeout or disconnect)
      // Backend may still be processing - poll for completed session
      logger.warn(
        'SSE stream ended without completion, starting recovery polling...'
      );
      // Clear any existing poll before starting a new one
      if (recoveryPollRef.current) {
        clearInterval(recoveryPollRef.current);
      }
      let attempts = 0;
      const maxAttempts = 90; // Poll for up to 15 minutes (10s * 90)
      const pollInterval = setInterval(async () => {
        attempts++;
        const reloaded = await reloadSessions();
        if (reloaded) {
          // Check if a new COMPLETED session appeared
          const completed = reloaded.find(
            (s) => s.status === 'COMPLETED' && s.report
          );
          const failed = !completed
            ? reloaded.find(
                (s) =>
                  s.status === 'FAILED' &&
                  s.discussion &&
                  Array.isArray(s.discussion) &&
                  s.discussion.length > 0
              )
            : null;
          if (completed) {
            clearInterval(pollInterval);
            setViewingSession(completed);
            setActiveTab('report');
            logger.info(
              'Recovery polling: found completed session',
              completed.id
            );
            return;
          }
          if (failed) {
            clearInterval(pollInterval);
            setViewingSession(failed);
            setActiveTab('discussion');
            logger.info(
              'Recovery polling: found failed session with discussion data',
              failed.id
            );
            return;
          }
        }
        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          logger.warn('Recovery polling: gave up after max attempts');
        }
      }, 10000);
      recoveryPollRef.current = pollInterval;
    },
  });

  // Load sessions from API on mount
  useEffect(() => {
    setLoadingSessions(true);
    reloadSessions().finally(() => setLoadingSessions(false));
  }, [reloadSessions]);

  // Cleanup recovery poll interval on unmount
  useEffect(() => {
    return () => {
      if (recoveryPollRef.current) {
        clearInterval(recoveryPollRef.current);
      }
    };
  }, []);

  // Auto-detect in-progress background sessions on mount and start recovery polling.
  // This handles the case where SSE disconnects, user navigates away, then comes back
  // — the research may still be running in the backend.
  const TERMINAL_STATUSES = useMemo(() => ['COMPLETED', 'FAILED'], []);
  const BACKGROUND_MAX_AGE_MS = 30 * 60 * 1000; // 30 min safety net

  useEffect(() => {
    if (loadingSessions || sessions.length === 0) return;
    if (isSearching || isIterating) return;
    if (backgroundRecoveryInitiatedRef.current) return;

    const inProgressSession = sessions.find(
      (s) =>
        !TERMINAL_STATUSES.includes(s.status) &&
        Date.now() - new Date(s.createdAt).getTime() < BACKGROUND_MAX_AGE_MS
    );

    if (!inProgressSession) return;

    backgroundRecoveryInitiatedRef.current = true;
    setBackgroundResearchSession(inProgressSession);
    logger.info(
      'Detected in-progress background session, starting recovery polling:',
      inProgressSession.id
    );

    // Clear any existing poll before starting a new one
    if (recoveryPollRef.current) {
      clearInterval(recoveryPollRef.current);
    }

    let attempts = 0;
    const maxAttempts = 90; // Poll for up to 15 minutes (10s * 90)
    const pollInterval = setInterval(async () => {
      attempts++;
      const reloaded = await reloadSessions();
      if (reloaded) {
        const updated = reloaded.find((s) => s.id === inProgressSession.id);
        if (updated && TERMINAL_STATUSES.includes(updated.status)) {
          clearInterval(pollInterval);
          recoveryPollRef.current = null;
          setBackgroundResearchSession(null);
          if (updated.status === 'COMPLETED' && updated.report) {
            setViewingSession(updated);
            setActiveTab('report');
            logger.info(
              'Background research completed, showing result:',
              updated.id
            );
          } else if (
            updated.status === 'FAILED' &&
            updated.discussion &&
            Array.isArray(updated.discussion) &&
            updated.discussion.length > 0
          ) {
            setViewingSession(updated);
            setActiveTab('discussion');
            logger.info(
              'Background research failed but has discussion data:',
              updated.id
            );
          }
          return;
        }
        // Session disappeared (deleted?) — stop polling
        if (!updated) {
          clearInterval(pollInterval);
          recoveryPollRef.current = null;
          setBackgroundResearchSession(null);
          return;
        }
      }
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        recoveryPollRef.current = null;
        setBackgroundResearchSession(null);
        logger.warn(
          'Background research recovery polling: gave up after max attempts'
        );
      }
    }, 10000);
    recoveryPollRef.current = pollInterval;
  }, [
    loadingSessions,
    sessions,
    isSearching,
    isIterating,
    TERMINAL_STATUSES,
    reloadSessions,
  ]);

  // Set tab badges based on iteration progress (B4)
  useEffect(() => {
    if (!isIterating || iterativeState.iterations.length === 0) return;
    const latest =
      iterativeState.iterations[iterativeState.iterations.length - 1];
    if (latest.ideas) {
      setTabBadges((prev) => ({ ...prev, ideas: true }));
    }
    if (latest.demo?.status === 'completed') {
      setTabBadges((prev) => ({ ...prev, demos: true }));
    }
  }, [iterativeState.iterations, isIterating]);

  // Handlers for DiscussionChat
  const researchLanguage = locale === 'zh' ? 'zh-CN' : 'en-US';

  const handleStartResearch = useCallback(
    (q: string, options?: ResearchCreationOptions) => {
      setQuery(q);
      // Reset background recovery tracking — new research supersedes any background detection
      backgroundRecoveryInitiatedRef.current = false;
      setBackgroundResearchSession(null);
      if (options?.mode === 'iterative') {
        startIterativeResearch(q, {
          mode: 'iterative',
          language: researchLanguage,
          depth: options.depth || 'standard',
          maxIterations: options.maxIterations,
          qualityThreshold: options.qualityThreshold,
          autoGenerateDemo: options.autoGenerateDemo,
          includeAcademic: options.includeAcademic,
        });
        // Stay on discussion tab so user can see the live conversation.
        // onIterationUpdate will switch to iterations tab after the first round.
        setActiveTab('discussion');
      } else {
        startResearch(q, {
          language: researchLanguage,
          depth: options?.depth,
          includeAcademic: options?.includeAcademic,
        });
      }
    },
    [startResearch, startIterativeResearch, researchLanguage]
  );

  const handleViewSession = useCallback((session: ResearchSession) => {
    setViewingSession(session);
  }, []);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/deep-research/sessions/${sessionId}`,
          { method: 'DELETE', headers: { ...getAuthHeader() } }
        );
        if (res.ok) {
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
          setViewingSession((prev) => (prev?.id === sessionId ? null : prev));
        }
      } catch (err) {
        logger.error('Failed to delete session:', err);
      }
    },
    [projectId]
  );

  const handleBackToList = useCallback(() => {
    setViewingSession(null);
  }, []);

  // Insights/Ideas/Demos handlers
  const handleUpdateInsight = useCallback(
    (
      ideaId: string,
      data: { status?: 'DISCOVERED' | 'STARRED' | 'ARCHIVED' }
    ) => {
      void updateInsight(ideaId, data);
    },
    [updateInsight]
  );

  const handleUpdateCreativeIdea = useCallback(
    (
      ideaId: string,
      data: { status?: 'DISCOVERED' | 'STARRED' | 'ARCHIVED' }
    ) => {
      void updateCreativeIdea(ideaId, data);
    },
    [updateCreativeIdea]
  );

  const handleDeleteDemo = useCallback(
    (demoId: string) => {
      void deleteDemo(demoId);
    },
    [deleteDemo]
  );

  const handleExtractInsights = useCallback(
    async (sessionId: string) => {
      setIsExtractingInsights(true);
      try {
        await extractInsights(sessionId);
      } catch (err) {
        logger.error('Failed to extract insights:', err);
      } finally {
        setIsExtractingInsights(false);
      }
    },
    [extractInsights]
  );

  const handleExtractCreativeIdeas = useCallback(async () => {
    setIsExtractingIdeas(true);
    try {
      await extractCreativeIdeas();
    } catch (err) {
      logger.error('Failed to extract creative ideas:', err);
    } finally {
      setIsExtractingIdeas(false);
    }
  }, [extractCreativeIdeas]);

  const [generatingIdeaId, setGeneratingIdeaId] = useState<string | null>(null);

  // Use ref to access latest demos without adding it to useCallback deps
  // (demos changes every 5s during polling, which would cause unnecessary re-renders)
  const demosRef = useRef(demos);
  useEffect(() => {
    demosRef.current = demos;
  }, [demos]);

  const handleGenerateDemo = useCallback(
    async (ideaId: string) => {
      // Prevent duplicate: check if there's already a PENDING/GENERATING demo for this idea
      const hasPending = demosRef.current.some(
        (d) =>
          d.ideaId === ideaId &&
          (d.status === 'PENDING' || d.status === 'GENERATING')
      );
      if (hasPending) {
        setActiveTab('demos');
        return;
      }

      setGeneratingIdeaId(ideaId);
      try {
        const demo = await generateDemo(ideaId);
        if (demo) {
          setActiveTab('demos');
        }
      } finally {
        setGeneratingIdeaId(null);
      }
    },
    [generateDemo, setActiveTab]
  );

  // Tab click handler - clears badge on click
  const handleTabClick = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    setTabBadges((prev) => ({ ...prev, [tab]: false }));
  }, []);

  // Toggle left panel
  const toggleLeftPanel = useCallback(() => {
    setLeftPanelCollapsed((prev) => !prev);
  }, []);

  // Get the active session for ideas extraction
  const activeSessionId =
    viewingSession?.id || (sessions.length > 0 ? sessions[0].id : null);

  // Get current report
  const currentReport = viewingSession?.report || null;
  const currentSessionId = viewingSession?.id || null;

  // Build ideaId → sessionId map for DemosPanel session filtering
  const ideaSessionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const idea of creativeIdeas) {
      if (idea.sessionId) {
        map.set(idea.id, idea.sessionId);
      }
    }
    for (const insight of insights) {
      if (insight.sessionId) {
        map.set(insight.id, insight.sessionId);
      }
    }
    return map;
  }, [creativeIdeas, insights]);

  // Tab definitions with conditional visibility
  const TABS: TabDefinition[] = [
    {
      key: 'discussion',
      label: t('aiResearch.tabs.discussion') || '讨论',
      icon: MessageSquare,
    },
    {
      key: 'insights',
      label: t('aiResearch.tabs.insights') || '观点荟萃',
      icon: Brain,
    },
    {
      key: 'ideas',
      label: t('aiResearch.tabs.ideas') || '研究创意',
      icon: Lightbulb,
    },
    {
      key: 'demos',
      label: t('aiResearch.tabs.demos') || '演示',
      icon: Play,
    },
    {
      key: 'iterations',
      label: t('aiResearch.tabs.iterations') || '迭代',
      icon: RefreshCw,
    },
    {
      key: 'report',
      label: t('aiResearch.tabs.report') || '报告',
      icon: FileText,
    },
    {
      key: 'references',
      label: t('aiResearch.tabs.references') || '参考来源',
      icon: Link,
    },
  ];

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <button
            onClick={onBack}
            className="flex-shrink-0 rounded-lg p-2 transition-colors hover:bg-gray-100"
            title={t('common.back') || '返回'}
          >
            <ArrowLeft className="h-5 w-5 text-gray-500" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-gray-900">
              {projectName}
            </h1>
            {projectDescription && (
              <p className="truncate text-sm text-gray-500">
                {projectDescription}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Research Topic Display (collapsible) */}
      {(query || viewingSession?.query) && (
        <div className="border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <button
            onClick={() => setTopicExpanded((prev) => !prev)}
            className="flex w-full items-center gap-3 px-6 py-2 text-left transition-colors hover:bg-blue-100/50"
          >
            <Search className="h-4 w-4 flex-shrink-0 text-blue-600" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
              {viewingSession?.query || query}
            </span>
            {topicExpanded ? (
              <ChevronUp className="h-4 w-4 flex-shrink-0 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
            )}
          </button>
          {topicExpanded && (
            <div className="px-6 pb-3">
              {/* Show full query only if it was truncated in the header */}
              {(viewingSession?.query || query || '').length > 80 && (
                <p className="mb-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                  {viewingSession?.query || query}
                </p>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-500">
                {viewingSession && (
                  <>
                    <span>
                      {viewingSession.mode === 'iterative'
                        ? '迭代研究'
                        : '单次研究'}
                    </span>
                    <span>
                      {new Date(viewingSession.createdAt).toLocaleDateString(
                        'zh-CN'
                      )}
                    </span>
                    {viewingSession.sourcesUsed > 0 && (
                      <span>{viewingSession.sourcesUsed} 个来源</span>
                    )}
                  </>
                )}
                {!viewingSession && (isSearching || isIterating) && (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    研究进行中...
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Background Research Banner */}
      {backgroundResearchSession && (
        <div className="flex items-center gap-3 border-b border-blue-200 bg-blue-50 px-6 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <span className="text-sm text-blue-800">
            {t('aiResearch.backgroundResearch') ||
              '研究在后台运行中，完成后将自动显示结果...'}
          </span>
          <span className="text-xs text-blue-500">
            {backgroundResearchSession.query?.slice(0, 40)}
            {(backgroundResearchSession.query?.length ?? 0) > 40 ? '...' : ''}
          </span>
        </div>
      )}

      {/* Main Content: Left Panel + Right Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Team (collapsible, AI Insights pattern) */}
        <div
          className={cn(
            'flex-shrink-0 border-r border-gray-200 bg-white transition-all duration-300',
            leftPanelCollapsed ? 'w-12' : 'w-[340px]'
          )}
        >
          {leftPanelCollapsed ? (
            <div className="flex h-full flex-col items-center py-4">
              <button
                onClick={toggleLeftPanel}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title={t('common.expand') || '展开'}
              >
                <Maximize2 className="h-5 w-5" />
              </button>
              <div className="mt-4 flex flex-col items-center gap-2">
                <span
                  className="text-xs text-gray-500"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {t('aiResearch.layout.researchTeam') || '研究团队'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('aiResearch.layout.researchTeam') || '研究团队'}
                </span>
                <button
                  onClick={toggleLeftPanel}
                  className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title={t('common.collapse') || '收起'}
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <AgentPanel
                  messages={
                    viewingSession?.discussion
                      ? (viewingSession.discussion as unknown as import('@/hooks').DiscussionMessage[])
                      : isIterating
                        ? iterativeState.discussion.messages
                        : discussionState.messages
                  }
                  typingAgent={
                    viewingSession
                      ? null
                      : isIterating
                        ? iterativeState.discussion.typingAgent
                        : discussionState.typingAgent
                  }
                  directions={
                    viewingSession?.directions?.directions
                      ? viewingSession.directions.directions.map(
                          (d: { title: string }) => d.title
                        )
                      : isIterating
                        ? iterativeState.discussion.directions
                        : discussionState.directions
                  }
                  currentPhase={
                    viewingSession
                      ? viewingSession.status === 'COMPLETED'
                        ? 'completed'
                        : 'idle'
                      : isIterating
                        ? iterativeState.discussion.phase
                        : discussionState.phase
                  }
                  isActive={isSearching || isIterating}
                  hasSession={sessions.length > 0 || !!viewingSession}
                  onStart={() => {
                    const q = query || projectName;
                    handleStartResearch(q);
                  }}
                  onContinue={() => {
                    const q = query || projectName;
                    handleStartResearch(q);
                  }}
                  onStop={isIterating ? stopIterative : stop}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab Bar */}
          <div className="bg-white px-6">
            <Tabs
              variant="underline"
              value={activeTab}
              onChange={(v) => handleTabClick(v as TabKey)}
              items={TABS.map((tab) => {
                const Icon = tab.icon;
                return {
                  key: tab.key,
                  iconNode: <Icon className="h-4 w-4" />,
                  label: (
                    <span className="relative">
                      {tab.label}
                      {tabBadges[tab.key] && activeTab !== tab.key && (
                        <span className="absolute -right-2 -top-1 flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                        </span>
                      )}
                    </span>
                  ),
                };
              })}
            />
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-hidden">
            {loadingSessions ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : (
              <>
                {/* Discussion Tab */}
                {activeTab === 'discussion' && (
                  <DiscussionChat
                    state={
                      isIterating ? iterativeState.discussion : discussionState
                    }
                    query={query}
                    isSearching={isSearching || isIterating}
                    isIterating={isIterating}
                    onSendFeedback={sendFeedback}
                    onExtendFeedback={extendFeedback}
                    onSkipPhase={skipPhase}
                    awaitingFeedback={
                      isIterating ? iterativeState.awaitingFeedback : null
                    }
                    sessions={sessions}
                    onStartResearch={handleStartResearch}
                    onStop={isIterating ? stopIterative : stop}
                    onRetry={() => handleStartResearch(query || projectName)}
                    onViewSession={handleViewSession}
                    onDeleteSession={handleDeleteSession}
                    viewingSession={viewingSession}
                    onBackToList={handleBackToList}
                    activeSessionId={
                      currentSessionId || backgroundResearchSession?.id || null
                    }
                    className="h-full"
                  />
                )}

                {/* Insights Tab */}
                {activeTab === 'insights' && (
                  <div className="h-full overflow-y-auto">
                    <div className="mx-auto max-w-4xl p-6">
                      <InsightsPanel
                        ideas={insights}
                        isLoading={insightsLoading}
                        isExtracting={isExtractingInsights}
                        onUpdateIdea={handleUpdateInsight}
                        onExtractIdeas={handleExtractInsights}
                        activeSessionId={activeSessionId}
                        defaultSessionFilter={activeSessionId}
                        sessions={sessions.map((s) => ({
                          id: s.id,
                          query: s.query,
                        }))}
                      />
                    </div>
                  </div>
                )}

                {/* Ideas Tab */}
                {activeTab === 'ideas' && (
                  <div className="h-full overflow-y-auto">
                    <div className="mx-auto max-w-4xl p-6">
                      <IdeasPanel
                        ideas={creativeIdeas}
                        isLoading={ideasLoading}
                        isExtracting={isExtractingIdeas}
                        onUpdateIdea={handleUpdateCreativeIdea}
                        onExtractCreativeIdeas={handleExtractCreativeIdeas}
                        onGenerateDemo={handleGenerateDemo}
                        generatingIdeaId={generatingIdeaId}
                        demos={demos}
                        defaultSessionFilter={activeSessionId}
                        sessions={sessions.map((s) => ({
                          id: s.id,
                          query: s.query,
                        }))}
                      />
                    </div>
                  </div>
                )}

                {/* Demos Tab */}
                {activeTab === 'demos' && (
                  <div className="h-full overflow-y-auto">
                    <div className="mx-auto max-w-4xl p-6">
                      <DemosPanel
                        projectId={projectId}
                        demos={demos}
                        onDeleteDemo={handleDeleteDemo}
                        isLoading={demosLoading}
                        defaultSessionFilter={activeSessionId}
                        sessions={sessions.map((s) => ({
                          id: s.id,
                          query: s.query,
                        }))}
                        ideaSessionMap={ideaSessionMap}
                      />
                    </div>
                  </div>
                )}

                {/* Iterations Tab */}
                {activeTab === 'iterations' && (
                  <div className="h-full overflow-y-auto">
                    <div className="mx-auto max-w-5xl p-6">
                      {(() => {
                        // Priority 1: Live/recent SSE-driven iterations (active or just completed/errored)
                        if (iterativeState.iterations.length > 0) {
                          return (
                            <IterationTimeline
                              iterations={iterativeState.iterations}
                              currentRound={iterativeState.currentRound}
                              exitReason={iterativeState.exitReason}
                              finalScore={iterativeState.finalScore}
                              isActive={isIterating}
                              maxIterations={iterativeState.maxIterations ?? 4}
                              qualityThreshold={iterativeState.qualityThreshold}
                              depth={iterativeState.depth}
                              awaitingFeedback={iterativeState.awaitingFeedback}
                              onSendFeedback={sendFeedback}
                            />
                          );
                        }

                        // Priority 2: Historical data from DB (viewing completed session)
                        const historySnapshots =
                          viewingSession?.directions?.iterationSnapshots;
                        const historyMeta =
                          viewingSession?.directions?.iterationMeta;
                        if (
                          historySnapshots &&
                          Array.isArray(historySnapshots) &&
                          historySnapshots.length > 0
                        ) {
                          const historyRecords =
                            viewingSession?.directions?.iterationRecords;
                          const snapshotsWithRecords = historySnapshots.map(
                            (snap, idx) => ({
                              ...snap,
                              record: historyRecords?.[idx] ?? snap.record,
                            })
                          );
                          const lastRound =
                            snapshotsWithRecords[
                              snapshotsWithRecords.length - 1
                            ].round;
                          return (
                            <IterationTimeline
                              iterations={snapshotsWithRecords}
                              currentRound={lastRound}
                              exitReason={
                                historyMeta?.exitReason ?? 'completed'
                              }
                              finalScore={historyMeta?.finalScore ?? null}
                              isActive={false}
                              maxIterations={historyMeta?.maxIterations}
                            />
                          );
                        }

                        // Priority 3: Check most recent iterative session in list
                        const latestIterativeSession = sessions.find(
                          (s) =>
                            s.mode === 'iterative' &&
                            s.directions?.iterationSnapshots &&
                            Array.isArray(s.directions.iterationSnapshots) &&
                            s.directions.iterationSnapshots.length > 0
                        );
                        if (latestIterativeSession) {
                          const snaps =
                            latestIterativeSession.directions!
                              .iterationSnapshots!;
                          const meta =
                            latestIterativeSession.directions!.iterationMeta;
                          const latestRecords =
                            latestIterativeSession.directions!.iterationRecords;
                          const snapsWithRecords = snaps.map((snap, idx) => ({
                            ...snap,
                            record: latestRecords?.[idx] ?? snap.record,
                          }));
                          const lastRound =
                            snapsWithRecords[snapsWithRecords.length - 1].round;
                          return (
                            <IterationTimeline
                              iterations={snapsWithRecords}
                              currentRound={lastRound}
                              exitReason={meta?.exitReason ?? 'completed'}
                              finalScore={meta?.finalScore ?? null}
                              isActive={false}
                              maxIterations={meta?.maxIterations}
                            />
                          );
                        }

                        // Fallback: empty state
                        return (
                          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                            <RefreshCw className="mb-4 h-12 w-12 text-gray-300" />
                            <p className="text-lg font-medium">
                              {t('aiResearch.iterations.empty') ||
                                '暂无迭代记录'}
                            </p>
                            <p className="mt-2 text-sm text-gray-400">
                              {t('aiResearch.iterations.emptyHint') ||
                                '使用迭代模式启动研究以查看自动优化过程'}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Report Tab */}
                {activeTab === 'report' && (
                  <div className="h-full overflow-y-auto">
                    <div className="mx-auto max-w-4xl p-6">
                      <ReportPanel
                        report={currentReport || null}
                        projectId={projectId}
                        sessionId={currentSessionId}
                        onNavigateToTab={(tab) => handleTabClick(tab as TabKey)}
                      />
                    </div>
                  </div>
                )}

                {/* References Tab */}
                {activeTab === 'references' && (
                  <div className="h-full overflow-y-auto">
                    <div className="mx-auto max-w-4xl p-6">
                      <ReferencesPanel
                        references={currentReport?.references || []}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResearchProjectLayout;
