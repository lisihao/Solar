import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ============================================================================
// Mocks (must come before imports of mocked modules)
// ============================================================================

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'http://test-api',
    apiBaseUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock store actions
const mockSetSession = vi.fn();
const mockSetGenerating = vi.fn();
const mockSetProgress = vi.fn();
const mockSetPages = vi.fn();
const mockUpdatePage = vi.fn();
const mockSetError = vi.fn();
const mockClearStreamEvents = vi.fn();

const mockStoreState = {
  session: null as { id: string } | null,
  generating: false,
  progress: null as unknown,
  pages: [] as unknown[],
  error: null as string | null,
  setSession: mockSetSession,
  setGenerating: mockSetGenerating,
  setProgress: mockSetProgress,
  setPages: mockSetPages,
  updatePage: mockUpdatePage,
  setError: mockSetError,
  clearStreamEvents: mockClearStreamEvents,
};

vi.mock('@/stores', () => ({
  useSlidesStore: Object.assign(
    vi.fn(() => mockStoreState),
    {
      getState: vi.fn(() => ({
        ...mockStoreState,
        pages: [],
      })),
    }
  ),
  calculateOverallProgress: vi.fn((pages: unknown[]) => 0),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useAuth } from '@/contexts/AuthContext';
import { useSlidesStore } from '@/stores';

// ============================================================================
// SSE helper
// ============================================================================

function makeSseStream(
  events: Array<{ type: string; data?: object; executionId?: string }>
) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = events.map((e) => {
    const json = JSON.stringify({
      type: e.type,
      data: e.data ?? {},
      executionId: e.executionId ?? 'exec-1',
    });
    return encoder.encode(`data: ${json}\n\n`);
  });

  let idx = 0;
  const reader = {
    read: vi.fn(async () => {
      if (idx < chunks.length) {
        return { done: false, value: chunks[idx++] };
      }
      return { done: true, value: undefined };
    }),
  };

  return {
    ok: true,
    body: { getReader: () => reader },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('useSlideGenerationTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store mock state
    mockStoreState.session = null;
    mockStoreState.generating = false;
    mockStoreState.progress = null;
    mockStoreState.pages = [];
    mockStoreState.error = null;

    const mockedStore = vi.mocked(useSlidesStore);
    mockedStore.mockReturnValue(
      mockStoreState as ReturnType<typeof useSlidesStore>
    );
    // vitest 4.1: vi.mocked 属性类型收紧为 MockInstance 交叉型，cast 目标
    // 必须取 mocked 实例自身的 getState 类型而非原 store 的
    mockedStore.getState = vi.fn(() => ({
      ...mockStoreState,
      pages: [],
    })) as unknown as (typeof mockedStore)['getState'];

    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'user-1',
        email: 'test@test.com',
        username: 'test',
        createdAt: '',
      },
      accessToken: 'token-123',
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
      isAuthenticated: true,
    } as unknown as ReturnType<typeof useAuth>);
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('returns initial state with null teamState and empty teamEvents', async () => {
    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    expect(result.current.teamState).toBeNull();
    expect(result.current.teamEvents).toEqual([]);
    expect(result.current.generating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes generateWithTeam and cancel functions', async () => {
    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    expect(typeof result.current.generateWithTeam).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
  });

  // -----------------------------------------------------------------------
  // generateWithTeam - initial state setup
  // -----------------------------------------------------------------------

  it('sets generating to true and clears state at start', async () => {
    mockFetch.mockResolvedValueOnce(makeSseStream([]));

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({
        topic: 'AI',
        pageCount: 5,
        language: 'zh',
      } as never);
    });

    expect(mockClearStreamEvents).toHaveBeenCalled();
    expect(mockSetGenerating).toHaveBeenCalledWith(true);
    expect(mockSetError).toHaveBeenCalledWith(null);
    expect(mockSetProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'task_decomposition',
        overallProgress: 0,
      })
    );
  });

  it('sends POST request to correct URL with auth header', async () => {
    mockFetch.mockResolvedValueOnce(makeSseStream([]));

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({
        topic: 'AI',
        pageCount: 5,
      } as never);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai-office/slides/team/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('handles HTTP error response gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, body: null });

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onError = vi.fn();
    const { result } = renderHook(() => useSlideGenerationTeam({ onError }));

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockSetError).toHaveBeenCalledWith(expect.stringContaining('500'));
    expect(mockSetGenerating).toHaveBeenCalledWith(false);
  });

  it('handles missing response body gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, body: null });

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockSetError).toHaveBeenCalledWith('No response body');
    expect(mockSetGenerating).toHaveBeenCalledWith(false);
  });

  // -----------------------------------------------------------------------
  // SSE event: execution:started
  // -----------------------------------------------------------------------

  it('processes execution:started event and sets session', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-abc' } },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onExecutionStarted = vi.fn();
    const { result } = renderHook(() =>
      useSlideGenerationTeam({ onExecutionStarted })
    );

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockSetSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess-abc', status: 'active' })
    );
    expect(onExecutionStarted).toHaveBeenCalledWith('sess-abc');
    expect(result.current.teamState).not.toBeNull();
    expect(result.current.teamState?.phase).toBe('initializing');
  });

  it('initializes all 5 agents in idle status on execution:started', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    const agents = result.current.teamState?.agents;
    expect(agents?.leader.status).toBe('idle');
    expect(agents?.analyst.status).toBe('idle');
    expect(agents?.strategist.status).toBe('idle');
    expect(agents?.writer.status).toBe('idle');
    expect(agents?.reviewer.status).toBe('idle');
  });

  // -----------------------------------------------------------------------
  // SSE event: phase:started
  // -----------------------------------------------------------------------

  it('processes phase:started event and updates progress', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'phase:started',
          data: {
            phase: 'planning',
            agent: 'analyst',
            description: '规划中...',
          },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onPhaseStarted = vi.fn();
    const { result } = renderHook(() =>
      useSlideGenerationTeam({ onPhaseStarted })
    );

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(onPhaseStarted).toHaveBeenCalledWith('planning', 'analyst');
    expect(mockSetProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'outline_planning' })
    );
  });

  // -----------------------------------------------------------------------
  // SSE event: agent:thinking
  // -----------------------------------------------------------------------

  it('processes agent:thinking event and calls onAgentThinking callback', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'agent:thinking',
          data: { agent: 'analyst', thought: 'Analyzing...' },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onAgentThinking = vi.fn();
    const { result } = renderHook(() =>
      useSlideGenerationTeam({ onAgentThinking })
    );

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(onAgentThinking).toHaveBeenCalledWith('analyst', 'Analyzing...');
  });

  // -----------------------------------------------------------------------
  // SSE event: agent:working
  // -----------------------------------------------------------------------

  it('processes agent:working event and calls onAgentWorking callback', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'agent:working',
          data: { agent: 'writer', task: 'Writing slide 1', progress: 25 },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onAgentWorking = vi.fn();
    const { result } = renderHook(() =>
      useSlideGenerationTeam({ onAgentWorking })
    );

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(onAgentWorking).toHaveBeenCalledWith('writer', 'Writing slide 1');
  });

  // -----------------------------------------------------------------------
  // SSE event: agent:completed
  // -----------------------------------------------------------------------

  it('processes agent:completed event and calls onAgentCompleted callback', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'agent:completed',
          data: { agent: 'analyst', result: 'Done', duration: 100 },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onAgentCompleted = vi.fn();
    const { result } = renderHook(() =>
      useSlideGenerationTeam({ onAgentCompleted })
    );

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(onAgentCompleted).toHaveBeenCalledWith('analyst', 'Done');
  });

  // -----------------------------------------------------------------------
  // SSE event: agent:handoff
  // -----------------------------------------------------------------------

  it('processes agent:handoff event and calls onHandoff callback', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'agent:handoff',
          data: {
            fromAgent: 'analyst',
            toAgent: 'writer',
            reason: 'Done analyzing',
          },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onHandoff = vi.fn();
    const { result } = renderHook(() => useSlideGenerationTeam({ onHandoff }));

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(onHandoff).toHaveBeenCalledWith('analyst', 'writer');
  });

  // -----------------------------------------------------------------------
  // SSE event: slide:generating
  // -----------------------------------------------------------------------

  it('processes slide:generating event and calls updatePage', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'slide:generating',
          data: { pageNumber: 2, totalPages: 5, title: 'Slide 2' },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockUpdatePage).toHaveBeenCalledWith(2, { status: 'generating' });
    expect(mockSetProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentPage: 2, totalPages: 5 })
    );
  });

  // -----------------------------------------------------------------------
  // SSE event: slide:generated
  // -----------------------------------------------------------------------

  it('processes slide:generated event and calls onSlideGenerated callback', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'slide:generated',
          data: {
            pageNumber: 1,
            title: 'Title Slide',
            html: '<div>slide</div>',
            keyPoints: ['p1'],
          },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onSlideGenerated = vi.fn();
    const { result } = renderHook(() =>
      useSlideGenerationTeam({ onSlideGenerated })
    );

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockUpdatePage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'completed', html: '<div>slide</div>' })
    );
    expect(onSlideGenerated).toHaveBeenCalledWith(1, '<div>slide</div>');
  });

  // -----------------------------------------------------------------------
  // SSE event: execution:completed
  // -----------------------------------------------------------------------

  it('processes execution:completed event and calls onComplete', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-exec' } },
        {
          type: 'execution:completed',
          data: { totalPages: 5, totalTime: 30000, checkpointId: 'cp-99' },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSlideGenerationTeam({ onComplete }));

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockSetGenerating).toHaveBeenCalledWith(false);
    expect(mockSetProgress).toHaveBeenCalledWith(
      expect.objectContaining({ overallProgress: 100, phase: 'quality_review' })
    );
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointId: 'cp-99', totalPages: 5 })
    );
  });

  // -----------------------------------------------------------------------
  // SSE event: execution:failed
  // -----------------------------------------------------------------------

  it('processes execution:failed event and calls onError', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        { type: 'execution:failed', data: { error: 'LLM timeout' } },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onError = vi.fn();
    const { result } = renderHook(() => useSlideGenerationTeam({ onError }));

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockSetError).toHaveBeenCalledWith('LLM timeout');
    expect(mockSetGenerating).toHaveBeenCalledWith(false);
    expect(onError).toHaveBeenCalledWith('LLM timeout');
  });

  // -----------------------------------------------------------------------
  // SSE event: phase:completed with planning result
  // -----------------------------------------------------------------------

  it('processes phase:completed for planning and calls setPages', async () => {
    const pageOutlines = [
      { pageNumber: 1, title: 'Cover', templateType: 'cover' },
      { pageNumber: 2, title: 'Intro', templateType: 'content' },
    ];

    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'phase:completed',
          data: {
            phase: 'planning',
            duration: 5000,
            result: { totalPages: 2, pageOutlines },
          },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockSetPages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pageNumber: 1, status: 'pending' }),
        expect.objectContaining({ pageNumber: 2, status: 'pending' }),
      ])
    );
  });

  // -----------------------------------------------------------------------
  // SSE event: review events
  // -----------------------------------------------------------------------

  it('processes review:issue_found event and adds to teamState issues', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'review:issue_found',
          data: { type: 'layout', pageNumber: 2, description: 'Layout issue' },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(result.current.teamState?.issues).toHaveLength(1);
  });

  it('processes review:auto_fixed event and adds to teamState fixes', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'review:auto_fixed',
          data: { issueType: 'layout', pageNumber: 2 },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(result.current.teamState?.fixes).toHaveLength(1);
  });

  it('processes review:scoring event and adds to scoringHistory', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'review:scoring',
          data: {
            agent: 'reviewer',
            phase: 'generating',
            score: 0.85,
            threshold: 0.8,
            passed: true,
          },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(result.current.teamState?.scoringHistory).toHaveLength(1);
  });

  it('processes review:rejected event and adds to rejections', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'review:rejected',
          data: { phase: 'generating', attempt: 1, score: 0.5, threshold: 0.8 },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(result.current.teamState?.rejections).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // SSE event: heartbeat (silent)
  // -----------------------------------------------------------------------

  it('ignores heartbeat events without error', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        { type: 'heartbeat', data: {} },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    // No error should have been set
    expect(mockSetError).not.toHaveBeenCalledWith(expect.any(String));
  });

  // -----------------------------------------------------------------------
  // SSE event: invalid JSON is silently skipped
  // -----------------------------------------------------------------------

  it('skips invalid SSE JSON lines without crashing', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: INVALID_JSON\n\n'),
      encoder.encode(
        `data: ${JSON.stringify({ type: 'heartbeat', data: {} })}\n\n`
      ),
    ];
    let idx = 0;
    const reader = {
      read: vi.fn(async () =>
        idx < chunks.length
          ? { done: false, value: chunks[idx++] }
          : { done: true, value: undefined }
      ),
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: { getReader: () => reader },
    });

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    // Stream completed without calling setError for generation failure
    expect(mockSetGenerating).toHaveBeenCalledWith(true);
  });

  // -----------------------------------------------------------------------
  // cancel()
  // -----------------------------------------------------------------------

  it('cancel() calls setGenerating(false) and resets progress/teamState', async () => {
    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      result.current.cancel();
    });

    expect(mockSetGenerating).toHaveBeenCalledWith(false);
    expect(mockSetProgress).toHaveBeenCalledWith(null);
  });

  // -----------------------------------------------------------------------
  // AbortError handled gracefully
  // -----------------------------------------------------------------------

  it('handles AbortError without calling onError', async () => {
    // Use a plain Error with name='AbortError' so that `err instanceof Error`
    // is true in all vitest pool environments (vmThreads and forks).
    // DOMException does not extend Error in some Node.js / jsdom configurations.
    const abortError = Object.assign(new Error('aborted'), {
      name: 'AbortError',
    });
    mockFetch.mockRejectedValueOnce(abortError);

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onError = vi.fn();
    const { result } = renderHook(() => useSlideGenerationTeam({ onError }));

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(mockSetError).not.toHaveBeenCalledWith(expect.any(String));
  });

  // -----------------------------------------------------------------------
  // Network error
  // -----------------------------------------------------------------------

  it('handles network error and calls onError with message', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const onError = vi.fn();
    const { result } = renderHook(() => useSlideGenerationTeam({ onError }));

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(onError).toHaveBeenCalledWith('Network failure');
    expect(mockSetError).toHaveBeenCalledWith('Network failure');
    expect(mockSetGenerating).toHaveBeenCalledWith(false);
  });

  // -----------------------------------------------------------------------
  // agent:switched event
  // -----------------------------------------------------------------------

  it('processes agent:switched event and adds to agentSwitches', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'agent:switched',
          data: {
            originalAgent: 'writer',
            newAgent: 'writer-v2',
            reason: 'fallback',
          },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(result.current.teamState?.agentSwitches).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // teamEvents accumulate
  // -----------------------------------------------------------------------

  it('accumulates all events in teamEvents array', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        { type: 'heartbeat', data: {} },
        { type: 'heartbeat', data: {} },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(result.current.teamEvents).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // slide:generated with design data
  // -----------------------------------------------------------------------

  it('maps design.reasoning to rawResponse in pageUpdate', async () => {
    mockFetch.mockResolvedValueOnce(
      makeSseStream([
        { type: 'execution:started', data: { sessionId: 'sess-1' } },
        {
          type: 'slide:generated',
          data: {
            pageNumber: 1,
            title: 'Slide 1',
            html: '<div></div>',
            design: {
              step1_drafting: 'draft',
              step2_refiningLayout: 'refine',
              step3_planningVisuals: 'plan',
              step4_formulatingHTML: 'html',
              reasoning: 'The reasoning here',
            },
          },
        },
      ])
    );

    const { useSlideGenerationTeam } =
      await import('../useSlideGenerationTeam');
    const { result } = renderHook(() => useSlideGenerationTeam());

    await act(async () => {
      await result.current.generateWithTeam({ topic: 'AI' } as never);
    });

    expect(mockUpdatePage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        design: expect.objectContaining({ rawResponse: 'The reasoning here' }),
      })
    );
  });
});
