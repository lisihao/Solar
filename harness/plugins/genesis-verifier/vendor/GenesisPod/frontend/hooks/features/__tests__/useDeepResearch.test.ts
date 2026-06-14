import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

// jsdom does not expose ReadableStream — polyfill from Node built-ins
if (typeof globalThis.ReadableStream === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ReadableStream = NodeReadableStream;
}

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'http://test-api',
    apiBaseUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useDeepResearch } from '../useDeepResearch';
import type { DeepResearchReport } from '../useDeepResearch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSSEResponse(events: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event + '\n\n'));
      }
      controller.close();
    },
  });
  return {
    ok: true,
    body: stream,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  };
}

function makeReport(
  overrides: Partial<DeepResearchReport> = {}
): DeepResearchReport {
  return {
    executiveSummary: 'Test summary',
    sections: [{ title: 'Section 1', content: 'Content', citations: [] }],
    conclusion: 'Test conclusion',
    references: [
      {
        id: 1,
        title: 'Ref 1',
        url: 'https://example.com',
        snippet: 'snippet',
        accessedAt: new Date(),
      },
    ],
    metadata: {
      totalSources: 5,
      totalTokens: 1000,
      duration: 30,
      searchRounds: 3,
    },
    ...overrides,
  };
}

function makeCompleteEvent(
  sessionId = 'session-1',
  report?: DeepResearchReport
) {
  return `event: interaction.complete\ndata: ${JSON.stringify({
    sessionId,
    report: report ?? makeReport(),
    status: 'success',
  })}`;
}

const PROJECT_ID = 'project-test-123';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDeepResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('starts in idle phase', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.state.phase).toBe('idle');
    });

    it('starts with empty thinkingChain', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.state.thinkingChain).toEqual([]);
    });

    it('starts with null plan', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.state.plan).toBeNull();
    });

    it('starts with null searchProgress', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.state.searchProgress).toBeNull();
    });

    it('starts with empty reflections array', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.state.reflections).toEqual([]);
    });

    it('starts with null report', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.state.report).toBeNull();
    });

    it('starts with null error', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.state.error).toBeNull();
    });

    it('isSearching is false when idle', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      expect(result.current.isSearching).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isSearching derivation
  // -------------------------------------------------------------------------

  describe('isSearching', () => {
    it('is true when phase is planning', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {}));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      act(() => {
        void result.current.startResearch('test query');
      });
      expect(result.current.state.phase).toBe('planning');
      expect(result.current.isSearching).toBe(true);
    });

    it('is false when phase is completed', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([makeCompleteEvent()])
      );
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('test query');
      });
      await waitFor(() => {
        expect(result.current.state.phase).toBe('completed');
      });
      expect(result.current.isSearching).toBe(false);
    });

    it('is false when phase is error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('test query');
      });
      expect(result.current.state.phase).toBe('error');
      expect(result.current.isSearching).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // startResearch
  // -------------------------------------------------------------------------

  describe('startResearch', () => {
    it('makes POST request to the correct stream URL', async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([]));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('my query');
      });
      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-stream/ai-studio/projects/${PROJECT_ID}/deep-research/stream`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('sends the query in the request body', async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([]));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('my research query');
      });
      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callOptions.body as string);
      expect(body.query).toBe('my research query');
    });

    it('sets phase to planning immediately on start', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {}));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      act(() => {
        void result.current.startResearch('query');
      });
      expect(result.current.state.phase).toBe('planning');
    });

    it('sets phase to error when fetch throws a non-abort error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('HTTP 500'));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('query');
      });
      expect(result.current.state.phase).toBe('error');
      expect(result.current.state.error).toBe('HTTP 500');
    });

    it('calls onError callback when fetch fails', async () => {
      const onError = vi.fn();
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      const { result } = renderHook(() =>
        useDeepResearch(PROJECT_ID, { onError })
      );
      await act(async () => {
        await result.current.startResearch('query');
      });
      expect(onError).toHaveBeenCalledWith('Connection refused');
    });

    it('does not call onError when request is aborted', async () => {
      const onError = vi.fn();
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);
      const { result } = renderHook(() =>
        useDeepResearch(PROJECT_ID, { onError })
      );
      await act(async () => {
        await result.current.startResearch('query');
      });
      expect(onError).not.toHaveBeenCalled();
    });

    it('sends follow-up context when isFollowUp is true', async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([]));
      const previousReport = makeReport();
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('follow up query', {
          isFollowUp: true,
          previousReport,
        });
      });
      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(callOptions.body as string);
      expect(body.isFollowUp).toBe(true);
      expect(body.previousContext).toBeDefined();
      expect(body.previousContext.executiveSummary).toBe('Test summary');
    });

    it('resets state on second call', async () => {
      const firstEvents = [
        `event: thought_summary\ndata: ${JSON.stringify({ step: 'analyzing_query', content: 'thinking...', timestamp: new Date().toISOString() })}`,
      ];
      mockFetch
        .mockResolvedValueOnce(createMockSSEResponse(firstEvents))
        .mockResolvedValueOnce(createMockSSEResponse([]));

      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('first query');
      });

      await waitFor(() => {
        expect(result.current.state.thinkingChain.length).toBeGreaterThan(0);
      });

      await act(async () => {
        await result.current.startResearch('second query');
      });

      // After reset, thinkingChain should be empty since second stream has no events
      expect(result.current.state.thinkingChain).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // SSE event handling
  // -------------------------------------------------------------------------

  describe('SSE event handling', () => {
    it('processes thought_summary event and adds to thinkingChain', async () => {
      const stepData = {
        step: 'analyzing_query',
        content: 'Analyzing the research query...',
        timestamp: new Date().toISOString(),
      };
      const events = [
        `event: thought_summary\ndata: ${JSON.stringify(stepData)}`,
      ];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const onThinking = vi.fn();
      const { result } = renderHook(() =>
        useDeepResearch(PROJECT_ID, { onThinking })
      );
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.thinkingChain).toHaveLength(1);
      });
      expect(result.current.state.thinkingChain[0].step).toBe(
        'analyzing_query'
      );
      expect(onThinking).toHaveBeenCalled();
    });

    it('processes plan_ready event and sets plan + searching phase', async () => {
      const planData = {
        plan: {
          objective: 'Research AI topics',
          approach: 'Multi-step approach',
          steps: [
            {
              id: 'step-1',
              type: 'initial_search',
              query: 'AI overview',
              rationale: 'Start broad',
              estimatedSources: 5,
            },
          ],
          estimatedTime: 300,
        },
      };
      const events = [`event: plan_ready\ndata: ${JSON.stringify(planData)}`];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.plan).not.toBeNull();
      });
      expect(result.current.state.phase).toBe('searching');
      expect(result.current.state.plan?.objective).toBe('Research AI topics');
    });

    it('processes search_progress event and updates searchProgress', async () => {
      const progressData = {
        round: 2,
        totalRounds: 5,
        query: 'deep learning basics',
        resultsCount: 10,
        message: 'Searching round 2',
      };
      const events = [
        `event: search_progress\ndata: ${JSON.stringify(progressData)}`,
      ];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const onSearchProgress = vi.fn();
      const { result } = renderHook(() =>
        useDeepResearch(PROJECT_ID, { onSearchProgress })
      );
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.searchProgress).not.toBeNull();
      });
      expect(result.current.state.searchProgress?.currentRound).toBe(2);
      expect(result.current.state.searchProgress?.totalRounds).toBe(5);
      expect(result.current.state.phase).toBe('searching');
      expect(onSearchProgress).toHaveBeenCalledWith(progressData);
    });

    it('processes reflection event and adds to reflections array', async () => {
      const reflectionData = {
        assessment: 'Good progress so far',
        decision: 'continue',
        reasoning: 'More sources needed',
      };
      const events = [
        `event: reflection\ndata: ${JSON.stringify(reflectionData)}`,
      ];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.reflections).toHaveLength(1);
      });
      expect(result.current.state.phase).toBe('reflecting');
      expect(result.current.state.reflections[0].decision).toBe('continue');
      expect(result.current.state.reflections[0].assessment).toBe(
        'Good progress so far'
      );
    });

    it('processes content.delta event and accumulates report content', async () => {
      const delta1 = { section: 'introduction', delta: 'Hello ' };
      const delta2 = { section: 'introduction', delta: 'World' };
      const events = [
        `event: content.delta\ndata: ${JSON.stringify(delta1)}`,
        `event: content.delta\ndata: ${JSON.stringify(delta2)}`,
      ];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.reportContent['introduction']).toBe(
          'Hello World'
        );
      });
      expect(result.current.state.phase).toBe('synthesizing');
    });

    it('processes interaction.complete event and calls onComplete', async () => {
      const onComplete = vi.fn();
      const report = makeReport();
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse([makeCompleteEvent('session-42', report)])
      );

      const { result } = renderHook(() =>
        useDeepResearch(PROJECT_ID, { onComplete })
      );
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe('completed');
      });
      expect(result.current.state.sessionId).toBe('session-42');
      expect(result.current.state.report).not.toBeNull();
      expect(onComplete).toHaveBeenCalled();
    });

    it('processes error SSE event and calls onError', async () => {
      const onError = vi.fn();
      const errorData = {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded',
        recoverable: false,
      };
      const events = [`event: error\ndata: ${JSON.stringify(errorData)}`];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() =>
        useDeepResearch(PROJECT_ID, { onError })
      );
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe('error');
      });
      expect(result.current.state.error).toBe('Rate limit exceeded');
      expect(onError).toHaveBeenCalledWith('Rate limit exceeded');
    });
  });

  // -------------------------------------------------------------------------
  // stop
  // -------------------------------------------------------------------------

  describe('stop', () => {
    it('aborts in-flight fetch when stop is called', () => {
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
        capturedSignal = opts.signal as AbortSignal;
        return new Promise(() => {});
      });

      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      act(() => {
        void result.current.startResearch('query');
      });

      expect(capturedSignal?.aborted).toBe(false);
      act(() => {
        result.current.stop();
      });
      expect(capturedSignal?.aborted).toBe(true);
    });

    it('transitions idle phase to idle (no-op)', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      act(() => {
        result.current.stop();
      });
      expect(result.current.state.phase).toBe('idle');
    });

    it('transitions active phase to error on stop', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {}));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      act(() => {
        void result.current.startResearch('query');
      });
      act(() => {
        result.current.stop();
      });
      expect(result.current.state.phase).toBe('error');
      expect(result.current.state.error).toBe('研究已取消');
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe('reset', () => {
    it('returns to idle state and clears all data', async () => {
      const events = [
        `event: thought_summary\ndata: ${JSON.stringify({ step: 'analyzing_query', content: 'Thinking', timestamp: new Date().toISOString() })}`,
      ];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.thinkingChain.length).toBeGreaterThan(0);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.state.phase).toBe('idle');
      expect(result.current.state.thinkingChain).toEqual([]);
      expect(result.current.state.reflections).toEqual([]);
      expect(result.current.state.plan).toBeNull();
      expect(result.current.state.error).toBeNull();
    });

    it('isSearching is false after reset', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      await act(async () => {
        await result.current.startResearch('query');
      });
      await waitFor(() => expect(result.current.state.phase).toBe('error'));

      act(() => {
        result.current.reset();
      });
      expect(result.current.isSearching).toBe(false);
    });

    it('resets from idle phase without error', () => {
      const { result } = renderHook(() => useDeepResearch(PROJECT_ID));
      act(() => {
        result.current.reset();
      });
      expect(result.current.state.phase).toBe('idle');
    });
  });

  // -------------------------------------------------------------------------
  // Unmount cleanup
  // -------------------------------------------------------------------------

  describe('unmount cleanup', () => {
    it('aborts in-flight request on unmount', () => {
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
        capturedSignal = opts.signal as AbortSignal;
        return new Promise(() => {});
      });

      const { result, unmount } = renderHook(() => useDeepResearch(PROJECT_ID));
      act(() => {
        void result.current.startResearch('query');
      });

      expect(capturedSignal?.aborted).toBe(false);
      unmount();
      expect(capturedSignal?.aborted).toBe(true);
    });
  });
});
