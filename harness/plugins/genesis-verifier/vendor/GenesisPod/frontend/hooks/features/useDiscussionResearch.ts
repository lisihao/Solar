/**
 * useDiscussionResearch - Discussion-driven Research SSE Hook
 *
 * 讨论驱动型研究的状态管理和 SSE 事件处理
 * 替代 useDeepResearch 用于新的群聊讨论 UI
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import type {
  DeepResearchReport,
  ReportReference,
  SearchSource,
} from './useDeepResearch';

// ==================== Discussion Types ====================

export type DiscussionPhase =
  | 'idle'
  | 'ideation'
  | 'execution'
  | 'findings'
  | 'synthesis'
  | 'completed'
  | 'error';

export type DiscussionRole =
  | 'director'
  | 'researcher'
  | 'analyst'
  | 'writer'
  | 'reviewer'
  | 'user';

export type DiscussionMessageType =
  | 'proposal'
  | 'idea'
  | 'critique'
  | 'status'
  | 'findings'
  | 'cross_check'
  | 'synthesis'
  | 'draft'
  | 'review'
  | 'system'
  | 'user';

export interface DiscussionMessage {
  id: string;
  agentRole: DiscussionRole;
  agentName: string;
  agentIcon: string;
  content: string;
  phase: DiscussionPhase;
  messageType: DiscussionMessageType;
  metadata?: {
    searchResults?: SearchSource[];
    directions?: string[];
    citations?: number[];
  };
  timestamp: Date | string;
}

// ==================== Hook State ====================

export interface DiscussionResearchState {
  phase: DiscussionPhase;
  messages: DiscussionMessage[];
  typingAgent: { role: string; name: string } | null;
  directions: string[];
  searchProgress: {
    currentRound: number;
    totalRounds: number;
    query: string;
    resultsCount: number;
    message: string;
  } | null;
  reportContent: Record<string, string>;
  report: DeepResearchReport | null;
  sessionId: string | null;
  error: string | null;
}

export interface DiscussionCompleteData {
  report: DeepResearchReport;
  sessionId: string;
  messages: DiscussionMessage[];
  directions: string[];
}

export interface UseDiscussionResearchOptions {
  onComplete?: (data: DiscussionCompleteData) => void;
  onError?: (error: string) => void;
  onMessage?: (message: DiscussionMessage) => void;
  /** Called when the SSE stream ends without receiving interaction.complete (e.g. server timeout) */
  onStreamEndIncomplete?: () => void;
}

export interface DiscussionResearchOptions {
  maxRounds?: number;
  includeAcademic?: boolean;
  language?: string;
  depth?: 'quick' | 'standard' | 'thorough';
  previousReport?: DeepResearchReport;
  isFollowUp?: boolean;
}

export interface UseDiscussionResearchResult {
  state: DiscussionResearchState;
  startResearch: (
    query: string,
    options?: DiscussionResearchOptions
  ) => Promise<void>;
  stop: () => void;
  reset: () => void;
  skipPhase: () => Promise<void>;
  isActive: boolean;
}

// ==================== Initial State ====================

const initialState: DiscussionResearchState = {
  phase: 'idle',
  messages: [],
  typingAgent: null,
  directions: [],
  searchProgress: null,
  reportContent: {},
  report: null,
  sessionId: null,
  error: null,
};

// ==================== Hook ====================

export function useDiscussionResearch(
  projectId: string,
  options: UseDiscussionResearchOptions = {}
): UseDiscussionResearchResult {
  const [state, setState] = useState<DiscussionResearchState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Use refs for callbacks + accumulated data to avoid stale closures in SSE loop
  const callbacksRef = useRef(options);
  callbacksRef.current = options;
  const messagesRef = useRef<DiscussionMessage[]>([]);
  const directionsRef = useRef<string[]>([]);

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // SSE event handler — uses refs to avoid stale closures
  const handleEvent = useCallback(
    (eventType: string, data: Record<string, unknown>) => {
      switch (eventType) {
        case 'discussion.message': {
          const msg = data as unknown as DiscussionMessage;
          messagesRef.current = [...messagesRef.current, msg];
          setState((prev) => ({
            ...prev,
            messages: messagesRef.current,
            typingAgent: null,
          }));
          callbacksRef.current.onMessage?.(msg);
          break;
        }

        case 'discussion.phase': {
          const phaseData = data as {
            phase: DiscussionPhase;
            summary: string;
            directions?: string[];
          };
          // Insert a system message for phase transition
          const systemMsg: DiscussionMessage = {
            id: `phase_${Date.now()}`,
            agentRole: 'director',
            agentName: 'System',
            agentIcon: 'info',
            content: phaseData.summary,
            phase: phaseData.phase,
            messageType: 'system',
            metadata: phaseData.directions
              ? { directions: phaseData.directions }
              : undefined,
            timestamp: new Date(),
          };
          messagesRef.current = [...messagesRef.current, systemMsg];
          if (phaseData.directions) {
            directionsRef.current = phaseData.directions;
          }
          setState((prev) => ({
            ...prev,
            phase: phaseData.phase,
            messages: messagesRef.current,
            directions: phaseData.directions || prev.directions,
            typingAgent: null,
          }));
          break;
        }

        case 'discussion.typing': {
          const typingData = data as { agentRole: string; agentName: string };
          setState((prev) => ({
            ...prev,
            typingAgent: {
              role: typingData.agentRole,
              name: typingData.agentName,
            },
          }));
          break;
        }

        case 'search_progress': {
          const progress = data as {
            round: number;
            totalRounds: number;
            query: string;
            resultsCount: number;
            message: string;
          };
          setState((prev) => ({
            ...prev,
            searchProgress: {
              currentRound: progress.round,
              totalRounds: progress.totalRounds,
              query: progress.query,
              resultsCount: progress.resultsCount,
              message: progress.message,
            },
          }));
          break;
        }

        case 'content.delta': {
          const delta = data as { section: string; delta: string };
          setState((prev) => ({
            ...prev,
            reportContent: {
              ...prev.reportContent,
              [delta.section]:
                (prev.reportContent[delta.section] || '') + delta.delta,
            },
          }));
          break;
        }

        case 'interaction.complete': {
          const completeData = data as {
            sessionId: string;
            report: DeepResearchReport;
            status: string;
          };
          setState((prev) => ({
            ...prev,
            phase: 'completed',
            sessionId: completeData.sessionId,
            report: completeData.report,
            typingAgent: null,
          }));
          // Pass accumulated messages/directions via refs (always fresh)
          callbacksRef.current.onComplete?.({
            report: completeData.report,
            sessionId: completeData.sessionId,
            messages: messagesRef.current,
            directions: directionsRef.current,
          });
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          break;
        }

        case 'error': {
          const errorData = data as { message: string };
          setState((prev) => ({
            ...prev,
            phase: 'error',
            error: errorData.message,
            typingAgent: null,
          }));
          callbacksRef.current.onError?.(errorData.message);
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          break;
        }
      }
    },
    [] // No deps — uses refs for all external values
  );

  // Start research
  const startResearch = useCallback(
    async (query: string, researchOptions?: DiscussionResearchOptions) => {
      cleanup();

      // Reset accumulated data refs
      messagesRef.current = [];
      directionsRef.current = [];

      setState({
        ...initialState,
        phase: 'ideation',
      });

      try {
        const url = `/ai-studio/projects/${projectId}/deep-research/stream`;

        const body: Record<string, unknown> = {
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

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const response = await fetch(config.streamApiUrl + url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...getAuthHeader(),
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
        let currentEvent = '';
        let currentData = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              currentData = line.slice(5).trim();
            } else if (line === '' && currentEvent && currentData) {
              try {
                const parsed = JSON.parse(currentData);
                handleEvent(currentEvent, parsed);
              } catch (e) {
                logger.error('Failed to parse SSE data:', e);
              }
              currentEvent = '';
              currentData = '';
            }
          }
        }

        // SSE stream ended - check if we got a complete response
        setState((currentState) => {
          if (
            currentState.phase !== 'completed' &&
            currentState.phase !== 'idle' &&
            currentState.phase !== 'error'
          ) {
            // Stream ended without completion - backend may still be processing
            logger.warn(
              `SSE stream ended in phase "${currentState.phase}" without completion. Backend may still be running.`
            );
            callbacksRef.current.onStreamEndIncomplete?.();
          }
          return currentState;
        });
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : '研究启动失败';
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: errorMessage,
        }));
        callbacksRef.current.onError?.(errorMessage);
      }
    },
    [projectId, cleanup, handleEvent]
  );

  const stop = useCallback(() => {
    cleanup();
    setState((prev) => ({
      ...prev,
      phase: prev.phase === 'idle' ? 'idle' : 'error',
      error: prev.phase !== 'idle' ? '研究已取消' : null,
      typingAgent: null,
    }));
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setState(initialState);
  }, [cleanup]);

  const skipPhase = useCallback(async () => {
    try {
      await fetch(
        `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/deep-research/skip-phase`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        }
      );
    } catch (err) {
      logger.error('Failed to skip phase:', err);
    }
  }, [projectId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  return {
    state,
    startResearch,
    stop,
    reset,
    skipPhase,
    isActive:
      state.phase !== 'idle' &&
      state.phase !== 'completed' &&
      state.phase !== 'error',
  };
}

export default useDiscussionResearch;
