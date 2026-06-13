import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStream, useProgress } from '../useStream';
import {
  apiClient,
  SSEProgressEvent,
  SSECompleteEvent,
  SSEErrorEvent,
} from '@/lib/api/client';

// Mock the apiClient
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    createSSEStream: vi.fn(),
    postSSEStream: vi.fn(),
  },
}));

describe('useStream', () => {
  let mockClose: ReturnType<typeof vi.fn>;
  let mockEventSource: { close: () => void };
  let capturedHandlers: {
    onProgress?: (event: SSEProgressEvent) => void;
    onComplete?: (event: SSECompleteEvent<unknown>) => void;
    onError?: (event: SSEErrorEvent) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClose = vi.fn();
    mockEventSource = { close: mockClose as unknown as () => void };

    vi.mocked(apiClient.createSSEStream).mockImplementation(
      (_path, handlers) => {
        capturedHandlers = handlers;
        return {
          eventSource: mockEventSource as unknown as EventSource,
          close: mockClose as unknown as () => void,
        };
      }
    );

    vi.mocked(apiClient.postSSEStream).mockImplementation(
      async (_path, _body, handlers) => {
        capturedHandlers = handlers;
        return { close: mockClose as unknown as () => void };
      }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with default state', () => {
      const { result } = renderHook(() => useStream());

      expect(result.current.state.streaming).toBe(false);
      expect(result.current.state.progress).toBe(0);
      expect(result.current.state.phase).toBe('');
      expect(result.current.state.message).toBe('');
      expect(result.current.state.result).toBeUndefined();
      expect(result.current.state.error).toBeNull();
    });
  });

  describe('start (GET stream)', () => {
    it('should set streaming state when started', () => {
      const { result } = renderHook(() => useStream());

      act(() => {
        result.current.start('/api/stream');
      });

      expect(result.current.state.streaming).toBe(true);
      expect(result.current.state.phase).toBe('initializing');
      expect(apiClient.createSSEStream).toHaveBeenCalledWith(
        '/api/stream',
        expect.any(Object)
      );
    });

    it('should close existing connection when starting new one', () => {
      const { result } = renderHook(() => useStream());

      act(() => {
        result.current.start('/api/stream1');
      });

      act(() => {
        result.current.start('/api/stream2');
      });

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('startPost (POST stream)', () => {
    it('should start POST stream with body', async () => {
      const { result } = renderHook(() => useStream());
      const body = { data: 'test' };

      await act(async () => {
        await result.current.startPost('/api/stream', body);
      });

      expect(result.current.state.streaming).toBe(true);
      expect(apiClient.postSSEStream).toHaveBeenCalledWith(
        '/api/stream',
        body,
        expect.any(Object)
      );
    });
  });

  describe('progress events', () => {
    it('should update state on progress event', () => {
      const onProgress = vi.fn();
      const { result } = renderHook(() => useStream({ onProgress }));

      act(() => {
        result.current.start('/api/stream');
      });

      const progressEvent: SSEProgressEvent = {
        type: 'progress',
        phase: 'processing',
        progress: 50,
        message: 'Processing...',
        current: 5,
        total: 10,
      };

      act(() => {
        capturedHandlers.onProgress?.(progressEvent);
      });

      expect(result.current.state.progress).toBe(50);
      expect(result.current.state.phase).toBe('processing');
      expect(result.current.state.message).toBe('Processing...');
      expect(result.current.state.current).toBe(5);
      expect(result.current.state.total).toBe(10);
      expect(onProgress).toHaveBeenCalledWith(progressEvent);
    });
  });

  describe('complete events', () => {
    it('should update state on complete event', () => {
      const onComplete = vi.fn();
      const { result } = renderHook(() => useStream({ onComplete }));

      act(() => {
        result.current.start('/api/stream');
      });

      const completeEvent: SSECompleteEvent<{ data: string }> = {
        type: 'complete',
        result: { data: 'success' },
        totalTime: 1000,
      };

      act(() => {
        capturedHandlers.onComplete?.(completeEvent);
      });

      expect(result.current.state.streaming).toBe(false);
      expect(result.current.state.progress).toBe(100);
      expect(result.current.state.result).toEqual({ data: 'success' });
      expect(onComplete).toHaveBeenCalledWith({ data: 'success' });
    });
  });

  describe('error events', () => {
    it('should update state on error event', () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useStream({ onError }));

      act(() => {
        result.current.start('/api/stream');
      });

      const errorEvent: SSEErrorEvent = {
        type: 'error',
        error: 'Connection failed',
        code: 'CONNECTION_ERROR',
        recoverable: false,
      };

      act(() => {
        capturedHandlers.onError?.(errorEvent);
      });

      expect(result.current.state.streaming).toBe(false);
      expect(result.current.state.error).toBe('Connection failed');
      expect(onError).toHaveBeenCalledWith('Connection failed');
    });

    it('should attempt reconnect on recoverable error when autoReconnect is enabled', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useStream({
          autoReconnect: true,
          reconnectAttempts: 3,
          reconnectInterval: 100,
        })
      );

      act(() => {
        result.current.start('/api/stream');
      });

      const initialCallCount = vi.mocked(apiClient.createSSEStream).mock.calls
        .length;

      const errorEvent: SSEErrorEvent = {
        type: 'error',
        error: 'Temporary error',
        recoverable: true,
      };

      act(() => {
        capturedHandlers.onError?.(errorEvent);
      });

      // Fast-forward past reconnect delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // Should have attempted to reconnect
      expect(
        vi.mocked(apiClient.createSSEStream).mock.calls.length
      ).toBeGreaterThan(initialCallCount);

      vi.useRealTimers();
    });

    it('should not reconnect when autoReconnect is disabled', () => {
      const { result } = renderHook(() => useStream({ autoReconnect: false }));

      act(() => {
        result.current.start('/api/stream');
      });

      const initialCallCount = vi.mocked(apiClient.createSSEStream).mock.calls
        .length;

      const errorEvent: SSEErrorEvent = {
        type: 'error',
        error: 'Error',
        recoverable: true,
      };

      act(() => {
        capturedHandlers.onError?.(errorEvent);
      });

      expect(vi.mocked(apiClient.createSSEStream).mock.calls.length).toBe(
        initialCallCount
      );
    });
  });

  describe('stop', () => {
    it('should close connection and update state', () => {
      const { result } = renderHook(() => useStream());

      act(() => {
        result.current.start('/api/stream');
      });

      expect(result.current.state.streaming).toBe(true);

      act(() => {
        result.current.stop();
      });

      expect(mockClose).toHaveBeenCalled();
      expect(result.current.state.streaming).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const { result } = renderHook(() => useStream());

      act(() => {
        result.current.start('/api/stream');
      });

      // Simulate some progress
      act(() => {
        capturedHandlers.onProgress?.({
          type: 'progress',
          phase: 'working',
          progress: 75,
          message: 'Working...',
        });
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.state.streaming).toBe(false);
      expect(result.current.state.progress).toBe(0);
      expect(result.current.state.phase).toBe('');
      expect(result.current.state.message).toBe('');
      expect(result.current.state.error).toBeNull();
    });
  });
});

describe('useProgress', () => {
  let mockClose: ReturnType<typeof vi.fn>;
  let capturedHandlers: {
    onProgress?: (event: SSEProgressEvent) => void;
    onComplete?: (event: SSECompleteEvent<unknown>) => void;
    onError?: (event: SSEErrorEvent) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClose = vi.fn();

    vi.mocked(apiClient.createSSEStream).mockImplementation(
      (_path, handlers) => {
        capturedHandlers = handlers;
        return {
          eventSource: { close: mockClose } as unknown as EventSource,
          close: mockClose as unknown as () => void,
        };
      }
    );

    vi.mocked(apiClient.postSSEStream).mockImplementation(
      async (_path, _body, handlers) => {
        capturedHandlers = handlers;
        return { close: mockClose as unknown as () => void };
      }
    );
  });

  it('should track progress correctly', () => {
    const { result } = renderHook(() => useProgress());

    act(() => {
      result.current.start('/api/progress');
    });

    expect(result.current.isLoading).toBe(true);

    act(() => {
      capturedHandlers.onProgress?.({
        type: 'progress',
        phase: 'uploading',
        progress: 50,
        message: 'Uploading files...',
      });
    });

    expect(result.current.progress).toBe(50);
    expect(result.current.phase).toBe('uploading');
    expect(result.current.message).toBe('Uploading files...');
  });

  it('should call onComplete callback', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useProgress({ onComplete }));

    act(() => {
      result.current.start('/api/progress');
    });

    act(() => {
      capturedHandlers.onComplete?.({
        type: 'complete',
        result: { success: true },
      });
    });

    expect(result.current.isLoading).toBe(false);
    expect(onComplete).toHaveBeenCalled();
  });

  it('should handle errors', () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useProgress({ onError }));

    act(() => {
      result.current.start('/api/progress');
    });

    act(() => {
      capturedHandlers.onError?.({
        type: 'error',
        error: 'Upload failed',
        recoverable: false,
      });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('Upload failed');
    expect(onError).toHaveBeenCalledWith('Upload failed');
  });

  it('should reset progress', () => {
    const { result } = renderHook(() => useProgress());

    act(() => {
      result.current.start('/api/progress');
    });

    act(() => {
      capturedHandlers.onProgress?.({
        type: 'progress',
        phase: 'working',
        progress: 75,
        message: 'Working...',
      });
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.progress).toBe(0);
    expect(result.current.phase).toBe('');
    expect(result.current.message).toBe('');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should support startPost', async () => {
    const { result } = renderHook(() => useProgress());

    await act(async () => {
      await result.current.startPost('/api/progress', { data: 'test' });
    });

    expect(result.current.isLoading).toBe(true);
    expect(apiClient.postSSEStream).toHaveBeenCalled();
  });
});
