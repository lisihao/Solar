import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Polyfill ReadableStream for jsdom environment
if (typeof ReadableStream === 'undefined') {
  const { ReadableStream: RSPolyfill } = await import('stream/web');
  globalThis.ReadableStream = RSPolyfill as typeof ReadableStream;
}

// Mocks must be declared before imports
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

// Mock the entire stores module
vi.mock('@/stores', () => {
  const mockStoreState = {
    session: null,
    generating: false,
    progress: null,
    pages: [],
    taskDecomposition: null,
    outlinePlan: null,
    qualityReport: null,
    error: null,
    setSession: vi.fn(),
    setGenerating: vi.fn(),
    setProgress: vi.fn(),
    setPages: vi.fn(),
    updatePage: vi.fn(),
    setTaskDecomposition: vi.fn(),
    setOutlinePlan: vi.fn(),
    setQualityReport: vi.fn(),
    addStreamEvent: vi.fn(),
    clearStreamEvents: vi.fn(),
    setError: vi.fn(),
    addCheckpoint: vi.fn(),
  };

  const store = Object.assign(
    vi.fn(() => mockStoreState),
    {
      getState: vi.fn(() => ({
        ...mockStoreState,
        pages: [],
        progress: null,
      })),
    }
  );

  return {
    useSlidesStore: store,
    calculateOverallProgress: vi.fn((phase: string, progress: number) => {
      const weights: Record<string, { start: number; end: number }> = {
        task_decomposition: { start: 0, end: 30 },
        outline_planning: { start: 30, end: 60 },
        page_rendering: { start: 60, end: 90 },
        quality_review: { start: 90, end: 100 },
      };
      const w = weights[phase] || { start: 0, end: 100 };
      return Math.round(w.start + (progress / 100) * (w.end - w.start));
    }),
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useAuth } from '@/contexts/AuthContext';
import { useSlidesStore, calculateOverallProgress } from '@/stores';

interface MockStoreState {
  session: null | Record<string, unknown>;
  generating: boolean;
  progress: null | number;
  pages: unknown[];
  taskDecomposition: null | Record<string, unknown>;
  outlinePlan: null | Record<string, unknown>;
  qualityReport: null | Record<string, unknown>;
  error: null | string;
  setSession: ReturnType<typeof vi.fn>;
  setGenerating: ReturnType<typeof vi.fn>;
  setProgress: ReturnType<typeof vi.fn>;
  setPages: ReturnType<typeof vi.fn>;
  updatePage: ReturnType<typeof vi.fn>;
  setTaskDecomposition: ReturnType<typeof vi.fn>;
  setOutlinePlan: ReturnType<typeof vi.fn>;
  setQualityReport: ReturnType<typeof vi.fn>;
  addStreamEvent: ReturnType<typeof vi.fn>;
  clearStreamEvents: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  addCheckpoint: ReturnType<typeof vi.fn>;
}
const getMockStore = () =>
  (vi.mocked(useSlidesStore) as unknown as () => MockStoreState)();

function makeReadableStream(chunks: string[]): ReadableStream {
  let index = 0;
  const encoder = new TextEncoder();
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
}

function makeSSEChunk(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe('useSlideGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'test-token',
      login: vi.fn(),
      logout: vi.fn(),
      loading: false,
    } as never);

    // Reset store mock state
    const store = getMockStore();
    Object.assign(store, {
      session: null,
      generating: false,
      progress: null,
      pages: [],
      taskDecomposition: null,
      outlinePlan: null,
      qualityReport: null,
      error: null,
    });

    (
      vi.mocked(useSlidesStore) as unknown as {
        getState: ReturnType<typeof vi.fn>;
      }
    ).getState = vi.fn(() => ({
      pages: [],
      progress: null,
    })) as never;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns initial state from store', async () => {
    const { useSlideGeneration } = await import('../useSlideGeneration');
    const { result } = renderHook(() => useSlideGeneration());

    expect(result.current.generating).toBe(false);
    expect(result.current.progress).toBeNull();
    expect(result.current.pages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.taskDecomposition).toBeNull();
    expect(result.current.outlinePlan).toBeNull();
    expect(result.current.qualityReport).toBeNull();
  });

  it('exposes generate and cancel functions', async () => {
    const { useSlideGeneration } = await import('../useSlideGeneration');
    const { result } = renderHook(() => useSlideGeneration());

    expect(typeof result.current.generate).toBe('function');
    expect(typeof result.current.cancel).toBe('function');
  });

  it('cancel sets generating to false and progress to null', async () => {
    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    act(() => {
      result.current.cancel();
    });

    expect(store.setGenerating).toHaveBeenCalledWith(false);
    expect(store.setProgress).toHaveBeenCalledWith(null);
  });

  it('generate aborts on AbortError and returns silently', async () => {
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error('Aborted'), { name: 'AbortError' })
    );

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test Presentation',
        sourceText: 'Some content',
        targetPages: 5,
      });
    });

    const store = getMockStore();
    // setError should only be called with null (to clear state), not with an error message
    const errorCalls = vi.mocked(store.setError).mock.calls;
    const errorMessageCalls = errorCalls.filter((call) => call[0] !== null);
    expect(errorMessageCalls).toHaveLength(0);
  });

  it('generate sets error and stops generating on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test Presentation',
        sourceText: 'Content',
        targetPages: 3,
      });
    });

    expect(store.setError).toHaveBeenCalledWith('Network error');
    expect(store.setGenerating).toHaveBeenCalledWith(false);
  });

  it('generate sets error when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: null,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setError).toHaveBeenCalledWith(expect.stringContaining('500'));
  });

  it('generate sets error when response body is null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setError).toHaveBeenCalledWith('Response body is null');
  });

  it('generate initializes progress at task_decomposition', async () => {
    // Return a stream that closes immediately
    const stream = makeReadableStream([]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setGenerating).toHaveBeenCalledWith(true);
    expect(store.setProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'task_decomposition',
        phaseProgress: 0,
        overallProgress: 0,
      })
    );
    expect(store.clearStreamEvents).toHaveBeenCalled();
    expect(store.setError).toHaveBeenCalledWith(null);
  });

  it('processes execution:started event', async () => {
    const event = {
      type: 'execution:started',
      data: { sessionId: 'session-abc' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onSessionCreated = vi.fn();
    const { result } = renderHook(() =>
      useSlideGeneration({ onSessionCreated })
    );

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session-abc',
        userId: 'user-1',
        title: 'PPT 生成',
        status: 'active',
      })
    );
    expect(onSessionCreated).toHaveBeenCalledWith('session-abc');
  });

  it('processes phase:started event and updates progress', async () => {
    const event = {
      type: 'phase:started',
      data: { phase: 'analyzing' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onPhaseStarted = vi.fn();
    const { result } = renderHook(() => useSlideGeneration({ onPhaseStarted }));

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseProgress: 0,
        overallProgress: 0,
      })
    );
    // onPhaseStarted called with mapped frontend phase
    expect(onPhaseStarted).toHaveBeenCalled();
  });

  it('processes phase:progress event', async () => {
    const event = {
      type: 'phase:progress',
      data: { phase: 'planning', progress: 50, message: 'Halfway done' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseProgress: 50,
        message: 'Halfway done',
      })
    );
  });

  it('processes slide:generated event and updates page', async () => {
    (
      vi.mocked(useSlidesStore) as unknown as {
        getState: ReturnType<typeof vi.fn>;
      }
    ).getState = vi.fn(() => ({
      pages: [
        {
          pageNumber: 1,
          outline: {
            pageNumber: 1,
            title: 'Page 1',
            templateType: 'multiColumn',
            purpose: '',
            keyPoints: [],
          },
          status: 'pending',
        },
        {
          pageNumber: 2,
          outline: {
            pageNumber: 2,
            title: 'Page 2',
            templateType: 'multiColumn',
            purpose: '',
            keyPoints: [],
          },
          status: 'pending',
        },
      ],
      progress: null,
    })) as never;

    const event = {
      type: 'slide:generated',
      data: {
        pageNumber: 1,
        totalPages: 2,
        html: '<div>Slide 1</div>',
        title: 'Introduction',
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onPageCompleted = vi.fn();
    const { result } = renderHook(() =>
      useSlideGeneration({ onPageCompleted })
    );

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 2,
      });
    });

    expect(store.updatePage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'completed',
        html: '<div>Slide 1</div>',
      })
    );
    expect(onPageCompleted).toHaveBeenCalledWith(1);
  });

  it('processes execution:completed event', async () => {
    const event = {
      type: 'execution:completed',
      sessionId: 'session-xyz',
      data: { totalPages: 5, checkpointId: 'cp-1' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSlideGeneration({ onComplete }));

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'quality_review',
        phaseProgress: 100,
        overallProgress: 100,
        message: '生成完成！',
      })
    );
    expect(store.setGenerating).toHaveBeenCalledWith(false);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointId: 'cp-1' })
    );
  });

  it('processes execution:failed event', async () => {
    const event = {
      type: 'execution:failed',
      data: { error: 'Server overloaded' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onError = vi.fn();
    const { result } = renderHook(() => useSlideGeneration({ onError }));

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setError).toHaveBeenCalledWith('Server overloaded');
    expect(store.setGenerating).toHaveBeenCalledWith(false);
    expect(onError).toHaveBeenCalledWith('Server overloaded');
  });

  it('processes legacy session_created event', async () => {
    const event = {
      type: 'session_created',
      data: {
        session: { id: 'legacy-session', title: 'My PPT' },
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onSessionCreated = vi.fn();
    const { result } = renderHook(() =>
      useSlideGeneration({ onSessionCreated })
    );

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-session',
        title: 'My PPT',
      })
    );
    expect(onSessionCreated).toHaveBeenCalledWith('legacy-session');
  });

  it('processes legacy error event', async () => {
    const event = {
      type: 'error',
      data: { error: 'Legacy error occurred' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onError = vi.fn();
    const { result } = renderHook(() => useSlideGeneration({ onError }));

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setError).toHaveBeenCalledWith('Legacy error occurred');
    expect(onError).toHaveBeenCalledWith('Legacy error occurred');
  });

  it('processes legacy complete event', async () => {
    const event = {
      type: 'complete',
      data: {
        sessionId: 'sess-1',
        checkpointId: 'cp-legacy',
        totalPages: 3,
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSlideGeneration({ onComplete }));

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 3,
      });
    });

    expect(store.setGenerating).toHaveBeenCalledWith(false);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ checkpointId: 'cp-legacy' })
    );
  });

  it('addStreamEvent is called for each parsed event', async () => {
    const event = {
      type: 'execution:started',
      data: { sessionId: 'sess-2' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.addStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'execution:started' })
    );
  });

  it('handles malformed JSON in SSE data gracefully', async () => {
    const stream = makeReadableStream(['data: {invalid json}\n\n']);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const { result } = renderHook(() => useSlideGeneration());

    // Should not throw
    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });
  });

  it('processes page_started legacy event', async () => {
    const event = {
      type: 'page_started',
      data: { pageNumber: 2, totalPages: 4 },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 4,
      });
    });

    expect(store.updatePage).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ status: 'generating' })
    );
  });

  it('processes legacy phase_started event', async () => {
    const event = {
      type: 'phase_started',
      data: { phase: 'outline_planning' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onPhaseStarted = vi.fn();
    const { result } = renderHook(() => useSlideGeneration({ onPhaseStarted }));

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setProgress).toHaveBeenCalledWith(
      expect.objectContaining({ phaseProgress: 0 })
    );
    expect(onPhaseStarted).toHaveBeenCalled();
  });

  it('processes legacy phase_completed event with task_decomposition phase', async () => {
    const taskData = { tasks: [{ id: 'task-1', title: 'Analyze' }] };
    const event = {
      type: 'phase_completed',
      data: { phase: 'task_decomposition', data: taskData },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onPhaseCompleted = vi.fn();
    const { result } = renderHook(() =>
      useSlideGeneration({ onPhaseCompleted })
    );

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setTaskDecomposition).toHaveBeenCalledWith(taskData);
    expect(onPhaseCompleted).toHaveBeenCalled();
  });

  it('processes legacy phase_completed event with outline_planning phase and initializes pages', async () => {
    const outlineData = {
      pages: [
        {
          pageNumber: 1,
          title: 'Intro',
          templateType: 'multiColumn',
          purpose: '',
          keyPoints: [],
        },
        {
          pageNumber: 2,
          title: 'Body',
          templateType: 'multiColumn',
          purpose: '',
          keyPoints: [],
        },
      ],
    };
    const event = {
      type: 'phase_completed',
      data: { phase: 'outline_planning', data: outlineData },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 2,
      });
    });

    expect(store.setOutlinePlan).toHaveBeenCalledWith(outlineData);
    expect(store.setPages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pageNumber: 1, status: 'pending' }),
        expect.objectContaining({ pageNumber: 2, status: 'pending' }),
      ])
    );
  });

  it('processes legacy phase_completed event with quality_review phase', async () => {
    const qualityData = { score: 95, issues: [] };
    const event = {
      type: 'phase_completed',
      data: { phase: 'quality_review', data: qualityData },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setQualityReport).toHaveBeenCalledWith(qualityData);
  });

  it('processes progress_update legacy event', async () => {
    const event = {
      type: 'progress_update',
      data: {
        phase: 'content_filling',
        current: 3,
        total: 10,
        percentage: 30,
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 10,
      });
    });

    expect(store.setProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phaseProgress: 30,
        currentPage: 3,
        totalPages: 10,
      })
    );
  });

  it('processes page_completed legacy event', async () => {
    const event = {
      type: 'page_completed',
      data: {
        pageNumber: 3,
        totalPages: 5,
        html: '<div>Slide 3</div>',
        content: { title: 'Slide 3' },
        design: { theme: 'blue' },
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onPageCompleted = vi.fn();
    const { result } = renderHook(() =>
      useSlideGeneration({ onPageCompleted })
    );

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.updatePage).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        status: 'completed',
        html: '<div>Slide 3</div>',
      })
    );
    expect(onPageCompleted).toHaveBeenCalledWith(3);
  });

  it('processes checkpoint_created legacy event without error', async () => {
    const event = {
      type: 'checkpoint_created',
      data: { name: 'mid-generation', type: 'AUTO' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    // Should not throw and should not call setError
    const errorCalls = vi
      .mocked(store.setError)
      .mock.calls.filter((c) => c[0] !== null);
    expect(errorCalls).toHaveLength(0);
  });

  it('processes agent:working event without error', async () => {
    const event = {
      type: 'agent:working',
      data: {
        agentName: 'ResearchAgent',
        task: 'Searching sources',
        progress: 50,
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    // agent:working is a no-op for UI - no error should be set
    const errorCalls = vi
      .mocked(store.setError)
      .mock.calls.filter((c) => c[0] !== null);
    expect(errorCalls).toHaveLength(0);
  });

  it('processes agent:completed event without error', async () => {
    const event = {
      type: 'agent:completed',
      data: { agentName: 'ResearchAgent', result: 'done' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    const errorCalls = vi
      .mocked(store.setError)
      .mock.calls.filter((c) => c[0] !== null);
    expect(errorCalls).toHaveLength(0);
  });

  it('handles unknown event type gracefully', async () => {
    const event = {
      type: 'unknown:event:xyz',
      data: { foo: 'bar' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    // No error should be set for unknown events
    const errorCalls = vi
      .mocked(store.setError)
      .mock.calls.filter((c) => c[0] !== null);
    expect(errorCalls).toHaveLength(0);
  });

  it('processes execution:started event using executionId fallback', async () => {
    const event = {
      type: 'execution:started',
      executionId: 'exec-fallback-id',
      data: {},
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onSessionCreated = vi.fn();
    const { result } = renderHook(() =>
      useSlideGeneration({ onSessionCreated })
    );

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'exec-fallback-id' })
    );
    expect(onSessionCreated).toHaveBeenCalledWith('exec-fallback-id');
  });

  it('slide:generated initializes pages array when currentPages is too small', async () => {
    // Set getState to return empty pages array so initialization branch is triggered
    (
      vi.mocked(useSlidesStore) as unknown as {
        getState: ReturnType<typeof vi.fn>;
      }
    ).getState = vi.fn(() => ({
      pages: [],
      progress: null,
    })) as never;

    const event = {
      type: 'slide:generated',
      data: {
        pageNumber: 1,
        totalPages: 3,
        html: '<div>Slide 1</div>',
        title: 'Intro',
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 3,
      });
    });

    // setPages should be called to initialize the pages array
    expect(store.setPages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pageNumber: 1 }),
        expect.objectContaining({ pageNumber: 2 }),
        expect.objectContaining({ pageNumber: 3 }),
      ])
    );
  });

  it('execution:completed uses store pages length when totalPages not in data', async () => {
    (
      vi.mocked(useSlidesStore) as unknown as {
        getState: ReturnType<typeof vi.fn>;
      }
    ).getState = vi.fn(() => ({
      pages: [{ pageNumber: 1 }, { pageNumber: 2 }],
      progress: null,
    })) as never;

    const event = {
      type: 'execution:completed',
      sessionId: 'sess-done',
      data: {},
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSlideGeneration({ onComplete }));

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 2,
      });
    });

    expect(store.setProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        totalPages: 2,
        phase: 'quality_review',
        overallProgress: 100,
      })
    );
  });

  it('generate handles non-Error thrown object', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setError).toHaveBeenCalledWith('生成失败');
  });

  it('execution:started uses sessionId from data when event.sessionId absent', async () => {
    const event = {
      type: 'execution:started',
      data: { sessionId: 'data-session-id' },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'data-session-id' })
    );
  });

  it('phase:started event with agent field logs agent info', async () => {
    const event = {
      type: 'phase:started',
      data: {
        phase: 'rendering',
        agent: 'RenderAgent',
        description: 'Starting render',
      },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    // The branch with agent field should execute without error
    const errorCalls = vi
      .mocked(store.setError)
      .mock.calls.filter((c) => c[0] !== null);
    expect(errorCalls).toHaveLength(0);
  });

  it('phase:completed triggers handlePhaseCompleted with task_decomposition', async () => {
    const taskData = { tasks: [{ id: 'td-1' }] };
    const event = {
      type: 'phase:completed',
      data: { phase: 'task_decomposition', result: taskData },
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    expect(store.setTaskDecomposition).toHaveBeenCalledWith(taskData);
  });

  it('session_created legacy event with no session data does nothing', async () => {
    const event = {
      type: 'session_created',
      data: {},
    };
    const stream = makeReadableStream([makeSSEChunk(event)]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    await act(async () => {
      await result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    // setSession should NOT be called when session data is missing
    expect(store.setSession).not.toHaveBeenCalled();
  });

  it('cancel aborts ongoing request via abortController', async () => {
    // Create a stream that doesn't end immediately
    let streamController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: stream,
    });

    const { useSlideGeneration } = await import('../useSlideGeneration');
    const store = getMockStore();
    const { result } = renderHook(() => useSlideGeneration());

    // Start generation without awaiting
    act(() => {
      void result.current.generate({
        title: 'Test',
        sourceText: 'Source',
        targetPages: 5,
      });
    });

    // Cancel immediately
    act(() => {
      result.current.cancel();
    });

    expect(store.setGenerating).toHaveBeenCalledWith(false);
    expect(store.setProgress).toHaveBeenCalledWith(null);

    // Clean up
    if (streamController) {
      (streamController as ReadableStreamDefaultController<Uint8Array>).close();
    }
  });
});
