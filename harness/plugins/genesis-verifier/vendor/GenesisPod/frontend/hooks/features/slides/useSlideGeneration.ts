/**
 * Slides Engine - 生成 Hook
 *
 * 处理幻灯片生成流程，包括：
 * - SSE 流式生成
 * - 进度追踪
 * - 错误处理
 */

import { useCallback, useRef } from 'react';
import { useSlidesStore, calculateOverallProgress } from '@/stores';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import type {
  GenerateRequest,
  StreamEvent,
  GenerationProgress,
  PageState,
  PageContent,
  PageDesign,
  TaskDecomposition,
  OutlinePlan,
  QualityReport,
} from '@/lib/types/slides';
import { PHASE_MAPPING } from '@/lib/types/slides';

import { logger } from '@/lib/utils/logger';
const API_BASE = config.apiUrl || '';

interface UseSlideGenerationOptions {
  onSessionCreated?: (sessionId: string) => void;
  onPhaseStarted?: (phase: string) => void;
  onPhaseCompleted?: (phase: string, data: unknown) => void;
  onPageCompleted?: (pageNumber: number) => void;
  onComplete?: (result: { sessionId: string; checkpointId: string }) => void;
  onError?: (error: string) => void;
}

export function useSlideGeneration(options: UseSlideGenerationOptions = {}) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const { user } = useAuth();

  const {
    session,
    generating,
    progress,
    pages,
    taskDecomposition,
    outlinePlan,
    qualityReport,
    error,
    setSession,
    setGenerating,
    setProgress,
    setPages,
    updatePage,
    setTaskDecomposition,
    setOutlinePlan,
    setQualityReport,
    addStreamEvent,
    clearStreamEvents,
    setError,
    addCheckpoint,
  } = useSlidesStore();

  /**
   * 处理阶段完成
   */
  const handlePhaseCompleted = useCallback(
    (phase: string, data: unknown) => {
      logger.debug('[SSE] Phase completed:', phase, data);
      switch (phase) {
        case 'task_decomposition':
          setTaskDecomposition(data as TaskDecomposition);
          break;
        case 'outline_planning':
          const outlineData = data as OutlinePlan;
          setOutlinePlan(outlineData);
          // 初始化页面状态
          const initialPages: PageState[] = outlineData.pages.map(
            (outline) => ({
              pageNumber: outline.pageNumber,
              outline,
              status: 'pending',
            })
          );
          setPages(initialPages);
          break;
        case 'quality_review':
          setQualityReport(data as QualityReport);
          break;
      }
    },
    [setTaskDecomposition, setOutlinePlan, setPages, setQualityReport]
  );

  /**
   * 映射后端阶段到前端阶段
   */
  const mapPhase = useCallback(
    (backendPhase: string): GenerationProgress['phase'] => {
      return PHASE_MAPPING[backendPhase] || 'page_rendering';
    },
    []
  );

  /**
   * 处理流事件 - 支持后端新协议和旧协议兼容
   */
  const handleStreamEvent = useCallback(
    (event: StreamEvent) => {
      logger.debug('[SSE] Received event:', event.type, event);
      const data = event.data as Record<string, unknown>;

      switch (event.type) {
        // ==================== 后端新协议事件 ====================

        // 执行开始
        case 'execution:started': {
          const sessionId =
            (data.sessionId as string) ||
            event.sessionId ||
            event.executionId ||
            '';
          logger.debug('[SSE] Execution started, sessionId:', sessionId);
          setSession({
            id: sessionId,
            userId: user?.id || 'anonymous',
            title: 'PPT 生成',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          options.onSessionCreated?.(sessionId);
          break;
        }

        // 阶段开始
        case 'phase:started': {
          const backendPhase = (data.phase as string) || '';
          const frontendPhase = mapPhase(backendPhase);
          const agent = data.agent as string | undefined;
          logger.debug('[SSE] Phase started:', { backendPhase, frontendPhase });

          setProgress({
            phase: frontendPhase,
            phaseProgress: 0,
            overallProgress: calculateOverallProgress(frontendPhase, 0),
            message: getPhaseMessage(frontendPhase, 'started'),
          });

          // Agent 状态更新（可选，通过 console 跟踪）
          if (agent) {
            logger.debug('[SSE] Agent started:', agent, data.description);
          }

          options.onPhaseStarted?.(frontendPhase);
          break;
        }

        // 阶段进度
        case 'phase:progress': {
          const backendPhase = (data.phase as string) || '';
          const frontendPhase = mapPhase(backendPhase);
          const progressValue = (data.progress as number) || 0;
          const message = (data.message as string) || '处理中...';

          setProgress({
            phase: frontendPhase,
            phaseProgress: progressValue,
            overallProgress: calculateOverallProgress(
              frontendPhase,
              progressValue
            ),
            message,
          });
          break;
        }

        // 阶段完成
        case 'phase:completed': {
          const backendPhase = (data.phase as string) || '';
          const frontendPhase = mapPhase(backendPhase);
          const result = data.result;
          logger.debug('[SSE] Phase completed:', {
            backendPhase,
            frontendPhase,
          });

          handlePhaseCompleted(frontendPhase, result);
          options.onPhaseCompleted?.(frontendPhase, result);
          break;
        }

        // Agent 工作中
        case 'agent:working': {
          const agentName = data.agentName as string;
          const task = data.task as string;
          const progressValue = data.progress as number;
          logger.debug('[SSE] Agent working:', {
            agentName,
            task,
            progress: progressValue,
          });
          // TODO: 可扩展为在 UI 显示 agent 状态
          break;
        }

        // Agent 完成
        case 'agent:completed': {
          const agentName = data.agentName as string;
          const result = data.result as string;
          logger.debug('[SSE] Agent completed:', agentName, result);
          // TODO: 可扩展为在 UI 显示 agent 状态
          break;
        }

        // 幻灯片生成完成（核心事件）
        case 'slide:generated': {
          const pageNumber = (data.pageNumber as number) || 1;
          const totalPages = (data.totalPages as number) || pageNumber;
          const html = data.html as string;
          const title = data.title as string;
          logger.debug('[SSE] Slide generated:', {
            pageNumber,
            totalPages,
            hasHtml: !!html,
          });

          // 确保页面数组已初始化
          const currentPages = useSlidesStore.getState().pages;
          if (currentPages.length < totalPages) {
            // 初始化页面数组
            const newPages: PageState[] = Array.from(
              { length: totalPages },
              (_, i) => ({
                pageNumber: i + 1,
                outline: {
                  pageNumber: i + 1,
                  title: `第 ${i + 1} 页`,
                  templateType: 'multiColumn',
                  purpose: '',
                  keyPoints: [],
                },
                status: 'pending',
              })
            );
            setPages(newPages);
          }

          // 更新页面
          updatePage(pageNumber, {
            status: 'completed',
            html,
            outline: {
              pageNumber,
              title: title || `第 ${pageNumber} 页`,
              templateType: 'multiColumn',
              purpose: '',
              keyPoints: [],
            },
          });

          // 更新进度
          const progressPercent = Math.round((pageNumber / totalPages) * 100);
          setProgress({
            phase: 'page_rendering',
            phaseProgress: progressPercent,
            overallProgress: calculateOverallProgress(
              'page_rendering',
              progressPercent
            ),
            currentPage: pageNumber,
            totalPages,
            message: `已生成第 ${pageNumber}/${totalPages} 页`,
          });

          options.onPageCompleted?.(pageNumber);
          break;
        }

        // 执行完成
        case 'execution:completed': {
          const totalPages =
            (data.totalPages as number) ||
            useSlidesStore.getState().pages.length;
          const checkpointId =
            (data.checkpointId as string) || event.sessionId || '';
          logger.debug('[SSE] Execution completed, totalPages:', totalPages);

          setProgress({
            phase: 'quality_review',
            phaseProgress: 100,
            overallProgress: 100,
            totalPages,
            message: '生成完成！',
          });
          setGenerating(false);

          options.onComplete?.({
            sessionId: event.sessionId || '',
            checkpointId,
          });
          break;
        }

        // 执行失败
        case 'execution:failed': {
          const errorMsg = (data.error as string) || '生成失败';
          logger.error('[SSE] Execution failed:', errorMsg);

          setError(errorMsg);
          setGenerating(false);
          options.onError?.(errorMsg);
          break;
        }

        // ==================== 旧协议兼容 ====================

        case 'session_created': {
          const sessionData = data as {
            session: { id: string; title: string };
          };
          logger.debug(
            '[SSE] Session created (legacy):',
            sessionData.session?.id
          );
          if (sessionData.session) {
            setSession({
              id: sessionData.session.id,
              userId: user?.id || 'anonymous',
              title: sessionData.session.title,
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            options.onSessionCreated?.(sessionData.session.id);
          }
          break;
        }

        case 'phase_started': {
          const phase = data.phase as string;
          logger.debug('[SSE] Phase started (legacy):', phase);
          const frontendPhase = mapPhase(phase);
          setProgress({
            phase: frontendPhase,
            phaseProgress: 0,
            overallProgress: calculateOverallProgress(frontendPhase, 0),
            message: getPhaseMessage(frontendPhase, 'started'),
          });
          options.onPhaseStarted?.(frontendPhase);
          break;
        }

        case 'phase_completed': {
          const phase = data.phase as string;
          const result = data.data;
          const frontendPhase = mapPhase(phase);
          handlePhaseCompleted(frontendPhase, result);
          options.onPhaseCompleted?.(frontendPhase, result);
          break;
        }

        case 'checkpoint_created': {
          logger.debug('[SSE] Checkpoint created:', data.name || data.type);
          break;
        }

        case 'page_started': {
          const pageNumber = data.pageNumber as number;
          const totalPages = data.totalPages as number;
          logger.debug('[SSE] Page started (legacy):', pageNumber);
          const currentProgress = useSlidesStore.getState().progress;
          setProgress({
            phase: currentProgress?.phase || 'page_rendering',
            phaseProgress: currentProgress?.phaseProgress || 0,
            overallProgress: currentProgress?.overallProgress || 0,
            currentPage: pageNumber,
            totalPages,
            message: `正在生成第 ${pageNumber} 页...`,
          });
          updatePage(pageNumber, { status: 'generating' });
          break;
        }

        case 'page_completed': {
          const pageNumber = data.pageNumber as number;
          const totalPages = data.totalPages as number;
          const html = data.html as string;
          logger.debug('[SSE] Page completed (legacy):', {
            pageNumber,
            hasHtml: !!html,
          });
          updatePage(pageNumber, {
            status: 'completed',
            html,
            content: data.content as PageContent,
            design: data.design as PageDesign,
          });
          options.onPageCompleted?.(pageNumber);
          break;
        }

        case 'progress_update': {
          const phase = data.phase as string;
          const current = data.current as number;
          const total = data.total as number;
          const percentage = data.percentage as number;
          const frontendPhase = mapPhase(phase);
          setProgress({
            phase: frontendPhase,
            phaseProgress: percentage,
            overallProgress: calculateOverallProgress(
              frontendPhase,
              percentage
            ),
            currentPage: current,
            totalPages: total,
            message: `正在生成第 ${current}/${total} 页...`,
          });
          break;
        }

        case 'error': {
          const errorMsg = data.error as string;
          logger.error('[SSE] Error (legacy):', errorMsg);
          setError(errorMsg);
          setGenerating(false);
          options.onError?.(errorMsg);
          break;
        }

        case 'complete': {
          const sessionId = data.sessionId as string;
          const checkpointId = data.checkpointId as string;
          const totalPages = data.totalPages as number;
          logger.debug('[SSE] Complete (legacy):', totalPages);
          setProgress({
            phase: 'quality_review',
            phaseProgress: 100,
            overallProgress: 100,
            totalPages,
            message: '生成完成！',
          });
          setGenerating(false);
          options.onComplete?.({ sessionId, checkpointId });
          break;
        }

        default:
          logger.debug('[SSE] Unknown event type:', event.type);
      }
    },
    [
      setSession,
      setProgress,
      setPages,
      updatePage,
      setError,
      setGenerating,
      handlePhaseCompleted,
      mapPhase,
      options,
      user?.id,
    ]
  );

  /**
   * 开始生成幻灯片
   * 使用 POST + fetch 代替 GET + EventSource，解决 URL 长度限制问题
   */
  const generate = useCallback(
    async (request: GenerateRequest) => {
      logger.debug('[SSE] Starting generation:', request.title);
      logger.debug(
        '[SSE] Source text length:',
        request.sourceText?.length || 0
      );

      // 清理之前的状态
      clearStreamEvents();
      setError(null);
      setGenerating(true);
      setProgress({
        phase: 'task_decomposition',
        phaseProgress: 0,
        overallProgress: 0,
        message: '正在分析素材...',
      });

      // 创建 AbortController
      abortControllerRef.current = new AbortController();

      try {
        // 使用 POST 请求，通过 body 传递数据（避免 URL 长度限制）
        const url = `${API_BASE}/ai-office/slides/generate?userId=${encodeURIComponent(user?.id || 'anonymous')}`;
        logger.debug('[SSE] Connecting via POST to:', url);

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            title: request.title,
            sourceText: request.sourceText,
            userRequirement: request.userRequirement,
            targetPages: request.targetPages,
            stylePreference: request.stylePreference,
            targetAudience: request.targetAudience,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        logger.debug('[SSE] Connection opened via POST');

        // 使用 ReadableStream 读取 SSE 流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                logger.debug('[SSE] Stream completed');
                break;
              }

              buffer += decoder.decode(value, { stream: true });

              // 解析 SSE 事件（格式: data: {...}\n\n）
              const lines = buffer.split('\n');
              buffer = lines.pop() || ''; // 保留不完整的行

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6).trim();
                  if (data) {
                    logger.debug(
                      '[SSE] Raw message received:',
                      data.substring(0, 200)
                    );
                    try {
                      const streamEvent: StreamEvent = JSON.parse(data);
                      addStreamEvent(streamEvent);
                      handleStreamEvent(streamEvent);
                    } catch (e) {
                      logger.error('[SSE] Failed to parse stream event:', {
                        error: e,
                        data,
                      });
                    }
                  }
                }
              }
            }
          } catch (err) {
            if ((err as Error).name === 'AbortError') {
              logger.debug('[SSE] Stream aborted by user');
            } else {
              throw err;
            }
          }
        };

        await processStream();
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          logger.debug('[SSE] Request aborted');
          return;
        }
        logger.error('[SSE] Error:', err);
        const errorMessage = err instanceof Error ? err.message : '生成失败';
        setError(errorMessage);
        setGenerating(false);
        options.onError?.(errorMessage);
      }
    },
    [
      clearStreamEvents,
      setError,
      setGenerating,
      setProgress,
      addStreamEvent,
      handleStreamEvent,
      options,
      user?.id,
    ]
  );

  /**
   * 取消生成
   */
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      // Type-safe access to eventSource
      const controller = abortControllerRef.current as unknown as {
        eventSource?: { close: () => void };
      };
      if (
        controller.eventSource &&
        typeof controller.eventSource.close === 'function'
      ) {
        controller.eventSource.close();
      }
    }
    setGenerating(false);
    setProgress(null);
  }, [setGenerating, setProgress]);

  return {
    // 状态
    session,
    generating,
    progress,
    pages,
    taskDecomposition,
    outlinePlan,
    qualityReport,
    error,

    // 操作
    generate,
    cancel,
  };
}

/**
 * 获取阶段消息
 * 支持前端阶段名称和后端阶段名称
 */
function getPhaseMessage(
  phase: string,
  status: 'started' | 'completed'
): string {
  const messages: Record<string, { started: string; completed: string }> = {
    // 前端阶段名称
    task_decomposition: {
      started: '正在分析素材，规划任务...',
      completed: '任务分解完成',
    },
    outline_planning: {
      started: '正在规划大纲...',
      completed: '大纲规划完成',
    },
    page_rendering: {
      started: '正在生成页面...',
      completed: '页面生成完成',
    },
    quality_review: {
      started: '正在进行质量检查...',
      completed: '质量检查完成',
    },
    // 后端阶段名称（兼容）
    analyzing: {
      started: '正在分析素材...',
      completed: '内容分析完成',
    },
    planning: {
      started: '正在规划大纲...',
      completed: '大纲规划完成',
    },
    content_filling: {
      started: '正在填充内容...',
      completed: '内容填充完成',
    },
    image_generation: {
      started: '正在生成配图...',
      completed: '配图生成完成',
    },
    rendering: {
      started: '正在渲染页面...',
      completed: '页面渲染完成',
    },
    reviewing: {
      started: '正在进行质量审核...',
      completed: '质量审核完成',
    },
    completed: {
      started: '即将完成...',
      completed: 'PPT 生成完成！',
    },
  };

  return messages[phase]?.[status] || `${phase} ${status}`;
}

export default useSlideGeneration;
