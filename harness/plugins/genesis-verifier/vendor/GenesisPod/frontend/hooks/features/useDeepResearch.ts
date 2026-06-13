/**
 * useDeepResearch - Deep Research SSE Hook
 *
 * 提供深度研究功能的状态管理和 SSE 事件处理
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { config } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
// ==================== 类型定义 ====================

export type ResearchStepType =
  | 'initial_search'
  | 'deep_dive'
  | 'academic'
  | 'comparison'
  | 'verification';

export interface ResearchPlanStep {
  id: string;
  type: ResearchStepType;
  query: string;
  rationale: string;
  estimatedSources: number;
}

export interface ResearchPlan {
  objective: string;
  approach: string;
  steps: ResearchPlanStep[];
  estimatedTime: number;
}

export interface SearchSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string;
  relevanceScore: number;
}

export interface SearchRound {
  round: number;
  stepId: string;
  query: string;
  resultsCount: number;
  sources: SearchSource[];
  timestamp: Date;
}

export type ReflectionDecision = 'continue' | 'pivot' | 'complete';

export interface Reflection {
  round: number;
  assessment: string;
  gaps: string[];
  decision: ReflectionDecision;
  reasoning: string;
  nextSteps?: string[];
  timestamp: Date;
}

export type ThinkingStepType =
  | 'analyzing_query'
  | 'planning_research'
  | 'executing_search'
  | 'evaluating_results'
  | 'reflecting'
  | 'synthesizing'
  | 'formatting';

export interface ThinkingStep {
  step: ThinkingStepType;
  content: string;
  timestamp: string;
}

export interface ReportSection {
  title: string;
  content: string;
  citations: number[];
}

export interface ReportReference {
  id: number;
  title: string;
  url: string;
  snippet: string;
  accessedAt: Date;
}

export interface DeepResearchReport {
  executiveSummary: string;
  sections: ReportSection[];
  conclusion: string;
  references: ReportReference[];
  metadata: {
    totalSources: number;
    totalTokens: number;
    duration: number;
    searchRounds: number;
  };
}

// ==================== SSE 事件类型 ====================

export interface ThoughtSummaryEvent {
  type: 'thought_summary';
  data: {
    step: ThinkingStepType;
    content: string;
    timestamp: string;
  };
}

export interface PlanReadyEvent {
  type: 'plan_ready';
  data: {
    plan: ResearchPlan;
  };
}

export interface SearchProgressEvent {
  type: 'search_progress';
  data: {
    round: number;
    totalRounds: number;
    query: string;
    resultsCount: number;
    message: string;
  };
}

export interface ReflectionEvent {
  type: 'reflection';
  data: {
    assessment: string;
    decision: ReflectionDecision;
    reasoning: string;
  };
}

export interface ContentDeltaEvent {
  type: 'content.delta';
  data: {
    section: string;
    delta: string;
  };
}

export interface InteractionCompleteEvent {
  type: 'interaction.complete';
  data: {
    sessionId: string;
    report: DeepResearchReport;
    status: 'success' | 'partial' | 'failed';
  };
}

export interface ErrorEvent {
  type: 'error';
  data: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

export type DeepResearchSSEEvent =
  | ThoughtSummaryEvent
  | PlanReadyEvent
  | SearchProgressEvent
  | ReflectionEvent
  | ContentDeltaEvent
  | InteractionCompleteEvent
  | ErrorEvent;

// ==================== Hook 状态 ====================

export type DeepResearchPhase =
  | 'idle'
  | 'planning'
  | 'searching'
  | 'reflecting'
  | 'synthesizing'
  | 'completed'
  | 'error';

export interface DeepResearchState {
  phase: DeepResearchPhase;
  thinkingChain: ThinkingStep[];
  plan: ResearchPlan | null;
  searchProgress: {
    currentRound: number;
    totalRounds: number;
    query: string;
    resultsCount: number;
    message: string;
  } | null;
  reflections: Reflection[];
  reportContent: Record<string, string>;
  report: DeepResearchReport | null;
  sessionId: string | null;
  error: string | null;
}

export interface UseDeepResearchOptions {
  onComplete?: (report: DeepResearchReport) => void;
  onError?: (error: string) => void;
  onThinking?: (step: ThinkingStep) => void;
  onSearchProgress?: (progress: SearchProgressEvent['data']) => void;
}

export interface ResearchOptions {
  maxRounds?: number;
  includeAcademic?: boolean;
  language?: string;
  depth?: 'quick' | 'standard' | 'thorough';
  // 追问模式：传入之前的报告作为上下文
  previousReport?: DeepResearchReport;
  // 是否是追问模式
  isFollowUp?: boolean;
}

export interface UseDeepResearchResult {
  state: DeepResearchState;
  startResearch: (query: string, options?: ResearchOptions) => Promise<void>;
  stop: () => void;
  reset: () => void;
  isSearching: boolean;
}

// ==================== 初始状态 ====================

const initialState: DeepResearchState = {
  phase: 'idle',
  thinkingChain: [],
  plan: null,
  searchProgress: null,
  reflections: [],
  reportContent: {},
  report: null,
  sessionId: null,
  error: null,
};

// ==================== Hook 实现 ====================

export function useDeepResearch(
  projectId: string,
  options: UseDeepResearchOptions = {}
): UseDeepResearchResult {
  const { onComplete, onError, onThinking, onSearchProgress } = options;

  const [state, setState] = useState<DeepResearchState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 清理函数
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 处理 SSE 事件
  const handleEvent = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const eventType = event.type;

        switch (eventType) {
          case 'thought_summary':
            const thinkingStep: ThinkingStep = data;
            setState((prev) => ({
              ...prev,
              thinkingChain: [...prev.thinkingChain, thinkingStep],
            }));
            onThinking?.(thinkingStep);
            break;

          case 'plan_ready':
            setState((prev) => ({
              ...prev,
              phase: 'searching',
              plan: data.plan,
            }));
            break;

          case 'search_progress':
            setState((prev) => ({
              ...prev,
              phase: 'searching',
              searchProgress: {
                currentRound: data.round,
                totalRounds: data.totalRounds,
                query: data.query,
                resultsCount: data.resultsCount,
                message: data.message,
              },
            }));
            onSearchProgress?.(data);
            break;

          case 'reflection':
            const reflection: Reflection = {
              round: state.searchProgress?.currentRound || 0,
              assessment: data.assessment,
              gaps: [],
              decision: data.decision,
              reasoning: data.reasoning,
              timestamp: new Date(),
            };
            setState((prev) => ({
              ...prev,
              phase: 'reflecting',
              reflections: [...prev.reflections, reflection],
            }));
            break;

          case 'content.delta':
            setState((prev) => ({
              ...prev,
              phase: 'synthesizing',
              reportContent: {
                ...prev.reportContent,
                [data.section]:
                  (prev.reportContent[data.section] || '') + data.delta,
              },
            }));
            break;

          case 'interaction.complete':
            setState((prev) => ({
              ...prev,
              phase: 'completed',
              sessionId: data.sessionId,
              report: data.report,
            }));
            onComplete?.(data.report);
            cleanup();
            break;

          case 'error':
            setState((prev) => ({
              ...prev,
              phase: 'error',
              error: data.message,
            }));
            onError?.(data.message);
            cleanup();
            break;
        }
      } catch (error) {
        logger.error('Failed to parse SSE event:', error);
      }
    },
    [
      state.searchProgress,
      onThinking,
      onSearchProgress,
      onComplete,
      onError,
      cleanup,
    ]
  );

  // 启动研究
  const startResearch = useCallback(
    async (query: string, researchOptions?: ResearchOptions) => {
      // 清理之前的连接
      cleanup();

      // 重置状态
      setState({
        ...initialState,
        phase: 'planning',
      });

      try {
        // 使用 POST 创建 SSE 连接
        const url = `/ai-studio/projects/${projectId}/deep-research/stream`;

        // 构建请求体，包含追问上下文
        const body: {
          query: string;
          options?: Omit<ResearchOptions, 'previousReport' | 'isFollowUp'>;
          isFollowUp?: boolean;
          previousContext?: {
            executiveSummary: string;
            sections: { title: string; content: string }[];
            conclusion: string;
            references: { title: string; url: string }[];
          };
        } = {
          query,
          options: researchOptions
            ? {
                maxRounds: researchOptions.maxRounds,
                includeAcademic: researchOptions.includeAcademic,
                language: researchOptions.language,
                depth: researchOptions.depth,
              }
            : undefined,
        };

        // 如果是追问模式，添加之前报告的上下文
        if (researchOptions?.isFollowUp && researchOptions?.previousReport) {
          body.isFollowUp = true;
          body.previousContext = {
            executiveSummary: researchOptions.previousReport.executiveSummary,
            sections: researchOptions.previousReport.sections.map((s) => ({
              title: s.title,
              content: s.content,
            })),
            conclusion: researchOptions.previousReport.conclusion,
            references: researchOptions.previousReport.references.map((r) => ({
              title: r.title,
              url: r.url,
            })),
          };
        }

        // 创建 EventSource (需要特殊处理 POST)
        // 由于标准 EventSource 不支持 POST，使用 fetch + ReadableStream
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const response = await fetch(config.streamApiUrl + url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // 解析 SSE 事件
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          let currentData = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              currentData = line.slice(5).trim();
            } else if (line === '' && currentEvent && currentData) {
              // 触发事件处理
              const event = new MessageEvent(currentEvent, {
                data: currentData,
              });
              handleEvent(event);
              currentEvent = '';
              currentData = '';
            }
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          return; // 用户主动取消
        }
        const errorMessage =
          error instanceof Error ? error.message : '研究启动失败';
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: errorMessage,
        }));
        onError?.(errorMessage);
      }
    },
    [projectId, cleanup, handleEvent, onError]
  );

  // 停止研究
  const stop = useCallback(() => {
    cleanup();
    setState((prev) => ({
      ...prev,
      phase: prev.phase === 'idle' ? 'idle' : 'error',
      error: prev.phase !== 'idle' ? '研究已取消' : null,
    }));
  }, [cleanup]);

  // 重置状态
  const reset = useCallback(() => {
    cleanup();
    setState(initialState);
  }, [cleanup]);

  // 组件卸载时清理
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    state,
    startResearch,
    stop,
    reset,
    isSearching:
      state.phase !== 'idle' &&
      state.phase !== 'completed' &&
      state.phase !== 'error',
  };
}

export default useDeepResearch;
