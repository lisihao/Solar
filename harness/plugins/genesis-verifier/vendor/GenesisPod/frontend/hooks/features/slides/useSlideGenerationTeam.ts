/**
 * Slides Engine - Team SSE 生成 Hook
 *
 * 处理 Team 协作模式的幻灯片生成流程：
 * - POST-based SSE 流式生成
 * - Agent 状态追踪
 * - 实时进度展示
 */

import { useCallback, useRef, useState } from 'react';
import { useSlidesStore, calculateOverallProgress } from '@/stores';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import type {
  GenerateTeamRequest,
  SlidesTeamEvent,
  SlidesTeamEventType,
  SlidesAgentRole,
  AgentState,
  TeamExecutionState,
  ExecutionStartedData,
  ExecutionCompletedData,
  ExecutionFailedData,
  PhaseStartedData,
  PhaseProgressData,
  PhaseCompletedData,
  PhaseRetryData,
  AgentThinkingData,
  AgentWorkingData,
  AgentCompletedData,
  AgentHandoffData,
  AgentSwitchedData,
  SlideGeneratingData,
  SlideGeneratedData,
  ReviewIssueData,
  ReviewFixedData,
  ReviewScoringData,
  ReviewRejectedData,
  ReviewMaxRetriesData,
  ReviewDiagnosticsData,
  SLIDES_TEAM_AGENTS,
} from '@/lib/types/slides-team';
import type { PageState, GenerationProgress } from '@/lib/types/slides';

import { logger } from '@/lib/utils/logger';
// 使用前端 API 代理，避免 CORS 问题
const API_BASE = '/api';

// ============================================================================
// 初始 Agent 状态
// ============================================================================

function createInitialAgentStates(): Record<SlidesAgentRole, AgentState> {
  return {
    leader: { role: 'leader', name: 'Slides Architect', status: 'idle' },
    analyst: { role: 'analyst', name: 'Content Analyst', status: 'idle' },
    strategist: {
      role: 'strategist',
      name: 'Visual Strategist',
      status: 'idle',
    },
    writer: { role: 'writer', name: 'Content Writer', status: 'idle' },
    reviewer: { role: 'reviewer', name: 'Quality Reviewer', status: 'idle' },
  };
}

// ============================================================================
// Hook Options
// ============================================================================

interface UseSlideGenerationTeamOptions {
  onExecutionStarted?: (sessionId: string) => void;
  onPhaseStarted?: (phase: string, agent: SlidesAgentRole) => void;
  onAgentThinking?: (agent: SlidesAgentRole, thought: string) => void;
  onAgentWorking?: (agent: SlidesAgentRole, task: string) => void;
  onAgentCompleted?: (agent: SlidesAgentRole, result: string) => void;
  onHandoff?: (from: SlidesAgentRole, to: SlidesAgentRole) => void;
  onSlideGenerated?: (pageNumber: number, html?: string) => void;
  onComplete?: (result: {
    sessionId: string;
    checkpointId: string;
    totalPages: number;
  }) => void;
  onError?: (error: string) => void;
}

// ============================================================================
// Main Hook
// ============================================================================

export function useSlideGenerationTeam(
  options: UseSlideGenerationTeamOptions = {}
) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const { user, accessToken } = useAuth();

  // Team 状态
  const [teamState, setTeamState] = useState<TeamExecutionState | null>(null);
  const [teamEvents, setTeamEvents] = useState<SlidesTeamEvent[]>([]);

  // Store 状态
  const {
    session,
    generating,
    progress,
    pages,
    error,
    setSession,
    setGenerating,
    setProgress,
    setPages,
    updatePage,
    setError,
    clearStreamEvents,
  } = useSlidesStore();

  // ============================================================================
  // 更新 Agent 状态
  // ============================================================================

  const updateAgentState = useCallback(
    (
      role: SlidesAgentRole,
      updates: Partial<AgentState>,
      pageNumber?: number
    ) => {
      setTeamState((prev) => {
        if (!prev) return prev;

        const currentAgent = prev.agents[role];
        const newTaskHistory = [...(currentAgent.taskHistory || [])];

        // ★ 修复：任何有意义的内容都添加到历史记录
        // 包括：currentTask、thought、result
        const hasNewContent =
          updates.currentTask || updates.thought || updates.result;

        if (hasNewContent) {
          const newTask =
            updates.currentTask ||
            (updates.result ? `✅ ${updates.result}` : '') ||
            currentAgent.currentTask ||
            '';
          const newThought = updates.thought || '';

          // 检查是否与最后一条记录完全相同（避免重复）
          const lastItem = newTaskHistory[newTaskHistory.length - 1];
          const isDuplicate =
            lastItem &&
            lastItem.task === newTask &&
            lastItem.thought === newThought &&
            lastItem.pageNumber === pageNumber;

          if (!isDuplicate && (newTask || newThought)) {
            newTaskHistory.push({
              timestamp: Date.now(),
              task: newTask,
              thought: newThought,
              pageNumber,
              phase: prev.phase,
            });

            // 限制历史记录数量，防止内存溢出
            if (newTaskHistory.length > 100) {
              newTaskHistory.shift();
            }
          }
        }

        return {
          ...prev,
          agents: {
            ...prev.agents,
            [role]: {
              ...currentAgent,
              ...updates,
              taskHistory: newTaskHistory,
            },
          },
        };
      });
    },
    []
  );

  // ============================================================================
  // 处理 Team 事件
  // ============================================================================

  const handleTeamEvent = useCallback(
    (event: SlidesTeamEvent) => {
      // 防御性检查：确保 event 有效
      if (!event || !event.type) {
        logger.warn('[Team SSE] Invalid event received:', event);
        return;
      }

      // ★★★ 关键诊断日志 ★★★
      logger.debug(
        `[Team SSE] ★ Event received: type=${event.type}, data keys=${Object.keys(event.data || {}).join(',')}`
      );
      if (event.type === 'slide:generated') {
        const slideData = event.data as { pageNumber?: number; html?: string };
        logger.debug(
          `[Team SSE] ★★★ SLIDE:GENERATED ★★★ pageNumber=${slideData.pageNumber}, htmlLength=${slideData.html?.length || 0}`
        );
      }

      setTeamEvents((prev) => [...prev, event]);

      // 使用 try-catch 包装所有事件处理，确保单个事件错误不会影响整体流程
      try {
        switch (event.type) {
          case 'execution:started': {
            const data = (event.data || {}) as Partial<ExecutionStartedData>;
            const sessionId = data.sessionId || `session-${Date.now()}`;
            logger.debug('[Team SSE] Execution started:', sessionId);

            // 初始化 Team 状态
            setTeamState({
              executionId: event.executionId || `exec-${Date.now()}`,
              sessionId: sessionId,
              phase: 'initializing',
              phaseProgress: 0,
              overallProgress: 0,
              agents: createInitialAgentStates(),
              handoffs: [],
              issues: [],
              fixes: [],
              scoringHistory: [],
              rejections: [],
              agentSwitches: [],
            });

            setSession({
              id: sessionId,
              userId: user?.id || 'anonymous',
              title: '演示文稿',
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            options.onExecutionStarted?.(sessionId);
            break;
          }

          case 'phase:started': {
            const data = (event.data || {}) as Partial<PhaseStartedData>;
            const phase = data.phase || 'generating';
            const agent = data.agent || 'writer';
            logger.debug('[Team SSE] Phase started:', { phase, agent });

            setTeamState((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                phase: phase,
                currentAgent: agent,
                phaseProgress: 0,
              };
            });

            // 更新进度显示
            setProgress({
              phase: mapPhaseToProgress(phase),
              phaseProgress: 0,
              overallProgress: calculateTeamProgress(phase, 0),
              message: data.description || '处理中...',
            });

            options.onPhaseStarted?.(phase, agent);
            break;
          }

          case 'phase:progress': {
            const data = (event.data || {}) as Partial<PhaseProgressData>;
            const progress = data.progress ?? 0;
            const phase = data.phase || 'generating';

            setTeamState((prev) => {
              if (!prev) return prev;
              return { ...prev, phaseProgress: progress };
            });

            const currentProgress = useSlidesStore.getState().progress;
            setProgress({
              phase: currentProgress?.phase || mapPhaseToProgress(phase),
              phaseProgress: progress,
              overallProgress: calculateTeamProgress(phase, progress),
              message: data.message || '处理中...',
            });
            break;
          }

          case 'phase:completed': {
            const data = (event.data || {}) as Partial<PhaseCompletedData>;
            const phase = data.phase || 'generating';
            logger.debug('[Team SSE] Phase completed:', {
              phase,
              duration: data.duration ?? 0,
            });

            // ★ 修复：阶段完成时更新进度到 100%
            setProgress({
              phase: mapPhaseToProgress(phase),
              phaseProgress: 100,
              overallProgress: calculateTeamProgress(phase, 100),
              message: `${getPhaseDisplayName(phase)}完成`,
            });

            // 如果是 planning 阶段完成，初始化页面
            if (phase === 'planning' && data.result) {
              const planResult = data.result as {
                totalPages?: number;
                pageOutlines?: Array<{
                  pageNumber: number;
                  title: string;
                  templateType: string;
                }>;
              };
              // 安全检查：确保 pageOutlines 存在
              if (
                planResult.pageOutlines &&
                Array.isArray(planResult.pageOutlines)
              ) {
                const initialPages: PageState[] = planResult.pageOutlines.map(
                  (outline) => ({
                    pageNumber: outline.pageNumber || 1,
                    outline: {
                      pageNumber: outline.pageNumber || 1,
                      title: outline.title || '未命名页面',
                      templateType:
                        (outline.templateType as PageState['outline']['templateType']) ||
                        'content',
                      purpose: '',
                      keyPoints: [],
                    },
                    status: 'pending',
                  })
                );
                setPages(initialPages);
              }
            }
            break;
          }

          case 'agent:thinking': {
            const data = (event.data || {}) as Partial<AgentThinkingData>;
            if (data.agent) {
              updateAgentState(data.agent, {
                status: 'thinking',
                thought: data.thought || '',
              });
              options.onAgentThinking?.(data.agent, data.thought || '');
            }
            break;
          }

          case 'agent:working': {
            const data = (event.data || {}) as Partial<AgentWorkingData>;
            if (data.agent) {
              updateAgentState(data.agent, {
                status: 'working',
                currentTask: data.task || '处理中...',
                progress: data.progress ?? 0,
              });
              options.onAgentWorking?.(data.agent, data.task || '');
            }
            break;
          }

          case 'agent:completed': {
            const data = (event.data || {}) as Partial<AgentCompletedData>;
            if (data.agent) {
              updateAgentState(data.agent, {
                status: 'completed',
                result: data.result || '完成',
                duration: data.duration ?? 0,
              });
              options.onAgentCompleted?.(data.agent, data.result || '');
            }
            break;
          }

          case 'agent:handoff': {
            const data = (event.data || {}) as Partial<AgentHandoffData>;
            if (data.fromAgent && data.toAgent) {
              logger.debug('[Team SSE] Handoff:', {
                from: data.fromAgent,
                to: data.toAgent,
              });

              setTeamState((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  currentAgent: data.toAgent,
                  handoffs: [...prev.handoffs, data as AgentHandoffData],
                };
              });

              // 重置 toAgent 状态
              updateAgentState(data.toAgent, { status: 'idle' });
              options.onHandoff?.(data.fromAgent, data.toAgent);
            }
            break;
          }

          case 'slide:generating': {
            const data = (event.data || {}) as Partial<SlideGeneratingData>;
            const pageNumber = data.pageNumber ?? 1;
            const totalPages = data.totalPages ?? 1;
            logger.debug('[Team SSE] Slide generating:', {
              pageNumber,
              totalPages,
            });

            updatePage(pageNumber, { status: 'generating' });

            // 更新 writer agent 状态，包含页码信息
            updateAgentState(
              'writer',
              {
                status: 'working',
                currentTask: `正在生成第 ${pageNumber} 页: ${data.title || ''}`,
              },
              pageNumber
            );

            // ★ 修复：基于当前页数/总页数计算进度
            const phaseProgress = Math.round(
              ((pageNumber - 1) / totalPages) * 100
            );
            setProgress({
              phase: 'page_rendering',
              phaseProgress,
              overallProgress: calculateTeamProgress(
                'generating',
                phaseProgress
              ),
              currentPage: pageNumber,
              totalPages: totalPages,
              message: `正在生成第 ${pageNumber}/${totalPages} 页: ${data.title || ''}`,
            });
            break;
          }

          case 'slide:generated': {
            const data = (event.data || {}) as Partial<SlideGeneratedData>;
            const pageNumber = data.pageNumber ?? 1;
            const title = data.title || `第 ${pageNumber} 页`;

            // ★★★ 关键诊断日志 ★★★
            logger.debug(
              `[Team SSE] ★★★ PROCESSING slide:generated ★★★ pageNumber=${pageNumber}, title=${title}, htmlLength=${data.html?.length || 0}, hasDesign=${!!data.design}`
            );

            // ★ 将 PageDesignThinking 转换为 PageDesign 格式
            const design = data.design
              ? {
                  step1_drafting: data.design.step1_drafting,
                  step2_refiningLayout: data.design.step2_refiningLayout,
                  step3_planningVisuals: data.design.step3_planningVisuals,
                  step4_formulatingHTML: data.design.step4_formulatingHTML,
                  // 将 reasoning 存储在 rawResponse 字段中
                  rawResponse: data.design.reasoning,
                }
              : undefined;

            // ★ 修复：传递完整的页面信息，包括 outline 和 design
            const pageUpdate = {
              status: 'completed' as const,
              html: data.html || '',
              outline: {
                pageNumber,
                title,
                templateType: 'pillars' as const,
                purpose: '',
                keyPoints: data.keyPoints || [],
              },
              // ★ 新增：包含设计思考数据，同步到 Thinking TAB
              design,
            };

            logger.debug(
              `[Team SSE] ★★★ CALLING updatePage(${pageNumber}, ...) with design=${!!design} ★★★`
            );
            updatePage(pageNumber, pageUpdate);

            // ★ 验证更新后的状态
            const currentPages = useSlidesStore.getState().pages;
            logger.debug(
              `[Team SSE] ★★★ AFTER updatePage: pages.length=${currentPages.length}, pageNumbers=${currentPages.map((p) => p.pageNumber).join(',')} ★★★`
            );

            // 记录页面完成到 writer 的任务历史
            updateAgentState(
              'writer',
              {
                currentTask: `✅ 第 ${pageNumber} 页完成: ${title}`,
              },
              pageNumber
            );

            // ★ 修复：基于完成页数计算进度
            const completedCount = currentPages.filter(
              (p) => p.status === 'completed'
            ).length;
            const totalPagesCount = currentPages.length || 1;
            const generatedPhaseProgress = Math.round(
              (completedCount / totalPagesCount) * 100
            );
            setProgress({
              phase: 'page_rendering',
              phaseProgress: generatedPhaseProgress,
              overallProgress: calculateTeamProgress(
                'generating',
                generatedPhaseProgress
              ),
              currentPage: pageNumber,
              totalPages: totalPagesCount,
              message: `已完成第 ${pageNumber} 页 (${completedCount}/${totalPagesCount})`,
            });

            options.onSlideGenerated?.(pageNumber, data.html);
            break;
          }

          case 'review:issue_found': {
            const data = (event.data || {}) as Partial<ReviewIssueData>;
            logger.debug('[Team SSE] Issue found:', {
              type: data.type,
              pageNumber: data.pageNumber,
            });

            if (data.type && data.pageNumber) {
              setTeamState((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  issues: [...prev.issues, data as ReviewIssueData],
                };
              });
            }
            break;
          }

          case 'review:auto_fixed': {
            const data = (event.data || {}) as Partial<ReviewFixedData>;
            logger.debug('[Team SSE] Issue fixed:', {
              issueType: data.issueType,
              pageNumber: data.pageNumber,
            });

            if (data.issueType && data.pageNumber) {
              setTeamState((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  fixes: [...prev.fixes, data as ReviewFixedData],
                };
              });
            }
            break;
          }

          case 'review:scoring': {
            const data = (event.data || {}) as Partial<ReviewScoringData>;
            logger.debug('[Team SSE] Review scoring:', {
              phase: data.phase,
              score: data.score,
              threshold: data.threshold,
              passed: data.passed,
            });

            if (data.agent) {
              setTeamState((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  scoringHistory: [
                    ...prev.scoringHistory,
                    data as ReviewScoringData,
                  ],
                };
              });

              // 更新对应 Agent 的评分
              updateAgentState(data.agent, {
                lastScore: data.score,
                scoreDimensions: data.dimensions,
              });
            }
            break;
          }

          case 'review:rejected': {
            const data = (event.data || {}) as Partial<ReviewRejectedData>;
            logger.debug('[Team SSE] Review rejected:', {
              phase: data.phase,
              attempt: data.attempt,
              score: data.score,
            });

            if (data.phase) {
              setTeamState((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  rejections: [...prev.rejections, data as ReviewRejectedData],
                };
              });
            }
            break;
          }

          case 'review:max_retries_reached': {
            const data = (event.data || {}) as Partial<ReviewMaxRetriesData>;
            logger.debug('[Team SSE] Max retries reached:', {
              phase: data.phase,
              action: data.action,
            });
            break;
          }

          case 'review:diagnostics': {
            // v3.2: 接收诊断信息
            const data = (event.data || {}) as Partial<ReviewDiagnosticsData>;
            if (data.diagnostics && Array.isArray(data.diagnostics)) {
              logger.debug('[Team SSE] Diagnostics received:', {
                pages: data.diagnostics.length,
                fixRate: `${data.overallFixRate ?? 0}%`,
              });

              setTeamState((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  diagnostics: data.diagnostics,
                };
              });
            }
            break;
          }

          case 'phase:retry': {
            const data = (event.data || {}) as Partial<PhaseRetryData>;
            logger.debug('[Team SSE] Phase retry:', {
              phase: data.phase,
              attempt: data.attempt,
              maxAttempts: data.maxAttempts,
            });

            // 更新当前 Agent 的重试次数
            const currentAgent = teamState?.currentAgent;
            if (currentAgent && data.attempt !== undefined) {
              updateAgentState(currentAgent, {
                retryCount: data.attempt,
              });
            }
            break;
          }

          case 'agent:switched': {
            const data = (event.data || {}) as Partial<AgentSwitchedData>;
            if (data.originalAgent && data.newAgent) {
              logger.debug('[Team SSE] Agent switched:', {
                from: data.originalAgent,
                to: data.newAgent,
              });

              setTeamState((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  agentSwitches: [
                    ...prev.agentSwitches,
                    data as AgentSwitchedData,
                  ],
                };
              });

              // 更新 Agent 变体信息
              updateAgentState(data.originalAgent, {
                variant: data.newAgent,
                retryCount: 0, // 重置重试次数
              });
            }
            break;
          }

          case 'execution:completed': {
            const data = (event.data || {}) as Partial<ExecutionCompletedData>;
            const totalPages = data.totalPages ?? 0;
            const totalTime = data.totalTime ?? 0;
            logger.debug('[Team SSE] Execution completed:', {
              totalPages,
              totalTime,
            });

            setTeamState((prev) => {
              if (!prev) return prev;
              return { ...prev, phase: 'completed', overallProgress: 100 };
            });

            setProgress({
              phase: 'quality_review',
              phaseProgress: 100,
              overallProgress: 100,
              totalPages: totalPages,
              message: '生成完成！',
            });

            setGenerating(false);
            options.onComplete?.({
              sessionId: teamState?.sessionId || '',
              checkpointId: data.checkpointId || '',
              totalPages: totalPages,
            });
            break;
          }

          case 'execution:failed': {
            const data = (event.data || {}) as Partial<ExecutionFailedData>;
            const errorMsg = data.error || '未知错误';
            logger.error('[Team SSE] Execution failed:', errorMsg);

            setTeamState((prev) => {
              if (!prev) return prev;
              return { ...prev, phase: 'failed' };
            });

            setError(errorMsg);
            setGenerating(false);
            options.onError?.(errorMsg);
            break;
          }

          case 'heartbeat': {
            // 心跳事件，保持连接
            break;
          }

          default:
            logger.debug('[Team SSE] Unknown event:', event.type);
        }
      } catch (err) {
        // 捕获事件处理中的任何错误，确保不会中断整体流程
        logger.error('[Team SSE] Error handling event:', event.type, err);
      }
    },
    [
      user?.id,
      teamState?.sessionId,
      setSession,
      setProgress,
      setPages,
      updatePage,
      setError,
      setGenerating,
      updateAgentState,
      options,
    ]
  );

  // ============================================================================
  // 开始 Team 生成
  // ============================================================================

  const generateWithTeam = useCallback(
    async (request: GenerateTeamRequest) => {
      logger.debug('[Team SSE] Starting Team generation');

      // 清理状态
      clearStreamEvents();
      setTeamEvents([]);
      setTeamState(null);
      setError(null);
      setGenerating(true);
      setProgress({
        phase: 'task_decomposition',
        phaseProgress: 0,
        overallProgress: 0,
        message: '正在初始化 AI 团队...',
      });

      // 创建 AbortController
      abortControllerRef.current = new AbortController();

      try {
        const url = `${API_BASE}/ai-office/slides/team/generate`;
        logger.debug('[Team SSE] Connecting to:', url);

        // 使用 fetch 发送 POST 请求并处理 SSE 流
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
          },
          body: JSON.stringify(request),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let eventCount = 0;

        logger.debug('[Team SSE] ★★★ Starting stream read loop ★★★');

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            logger.debug(
              `[Team SSE] ★★★ Stream ended. Total events received: ${eventCount} ★★★`
            );
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // ★ 诊断：显示接收的数据块
          if (chunk.includes('slide:generated')) {
            logger.debug(
              `[Team SSE] ★★★ CHUNK contains slide:generated ★★★ chunkLength=${chunk.length}`
            );
          }

          // 解析 SSE 事件
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // 保留最后一行（可能不完整）

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr) {
                try {
                  const event: SlidesTeamEvent = JSON.parse(jsonStr);
                  eventCount++;
                  logger.debug(
                    `[Team SSE] ★ Parsed event #${eventCount}: ${event.type}`
                  );
                  handleTeamEvent(event);
                } catch (e) {
                  logger.error('[Team SSE] ★★★ PARSE ERROR ★★★', {
                    error: e,
                    dataLength: jsonStr.length,
                    preview: jsonStr.substring(0, 200),
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          logger.debug('[Team SSE] Aborted by user');
          return;
        }

        logger.error('[Team SSE] Error:', err);
        const errorMessage = err instanceof Error ? err.message : '生成失败';
        setError(errorMessage);
        setGenerating(false);
        options.onError?.(errorMessage);
      }
    },
    [
      user?.id,
      accessToken,
      clearStreamEvents,
      setError,
      setGenerating,
      setProgress,
      handleTeamEvent,
      options,
    ]
  );

  // ============================================================================
  // 取消生成
  // ============================================================================

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setGenerating(false);
    setProgress(null);
    setTeamState(null);
  }, [setGenerating, setProgress]);

  // ============================================================================
  // 返回值
  // ============================================================================

  return {
    // Store 状态
    session,
    generating,
    progress,
    pages,
    error,

    // Team 特有状态
    teamState,
    teamEvents,

    // 操作
    generateWithTeam,
    cancel,
  };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 映射 Team Phase 到 GenerationProgress Phase
 */
function mapPhaseToProgress(
  phase: string
):
  | 'task_decomposition'
  | 'outline_planning'
  | 'page_rendering'
  | 'quality_review' {
  switch (phase) {
    case 'initializing':
    case 'analyzing':
      return 'task_decomposition';
    case 'planning':
      return 'outline_planning';
    case 'generating':
    case 'rendering':
      return 'page_rendering';
    case 'reviewing':
    case 'completed':
      return 'quality_review';
    default:
      return 'task_decomposition';
  }
}

/**
 * 计算 Team 整体进度
 * ★ 调整权重分配，让前期阶段更加可见
 */
function calculateTeamProgress(phase: string, phaseProgress: number): number {
  // 前期阶段（0-30%）：initializing + analyzing + planning
  // 主要阶段（30-80%）：generating
  // 后期阶段（80-100%）：rendering + reviewing
  const phaseWeights: Record<string, { start: number; weight: number }> = {
    initializing: { start: 0, weight: 5 }, // 0-5%：初始化
    analyzing: { start: 5, weight: 10 }, // 5-15%：分析需求
    planning: { start: 15, weight: 15 }, // 15-30%：规划大纲
    generating: { start: 30, weight: 50 }, // 30-80%：生成内容
    rendering: { start: 80, weight: 12 }, // 80-92%：渲染页面
    reviewing: { start: 92, weight: 8 }, // 92-100%：质量审核
    completed: { start: 100, weight: 0 },
  };

  const config = phaseWeights[phase] || { start: 0, weight: 10 };
  return Math.min(100, config.start + (phaseProgress / 100) * config.weight);
}

/**
 * 获取阶段的中文显示名称
 */
function getPhaseDisplayName(phase: string): string {
  const phaseNames: Record<string, string> = {
    initializing: '初始化',
    analyzing: '内容分析',
    planning: '大纲规划',
    generating: '页面生成',
    rendering: '页面渲染',
    reviewing: '质量审核',
    completed: '生成',
  };
  return phaseNames[phase] || phase;
}

export default useSlideGenerationTeam;
