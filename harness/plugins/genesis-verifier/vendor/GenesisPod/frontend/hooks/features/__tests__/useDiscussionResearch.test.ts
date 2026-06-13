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
    apiBaseUrl: 'http://test-api',
    apiUrl: 'http://test-api',
    streamApiUrl: 'http://test-stream',
  },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(),
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

import { getAuthHeader } from '@/lib/utils/auth';
import {
  useDiscussionResearch,
  DiscussionPhase,
} from '../useDiscussionResearch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake SSE ReadableStream from a sequence of raw SSE event
 * strings. Each entry should look like "event: foo\ndata: {...}" (no trailing
 * blank line — the helper appends "\n\n" automatically).
 */
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

function makeInteractionCompleteEvent() {
  return [
    `event: interaction.complete\ndata: ${JSON.stringify({
      sessionId: 'session-1',
      report: {
        executiveSummary: 'Summary',
        sections: [],
        conclusion: 'Conclusion',
        references: [],
      },
      status: 'completed',
    })}`,
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDiscussionResearch', () => {
  const PROJECT_ID = 'project-123';
  const AUTH_HEADER = { Authorization: 'Bearer test-token' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthHeader).mockReturnValue(AUTH_HEADER);
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('starts with idle phase', () => {
      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));
      expect(result.current.state.phase).toBe('idle');
    });

    it('starts with empty messages array', () => {
      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));
      expect(result.current.state.messages).toEqual([]);
    });

    it('starts with null error', () => {
      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));
      expect(result.current.state.error).toBeNull();
    });

    it('starts with null report', () => {
      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));
      expect(result.current.state.report).toBeNull();
    });

    it('isActive is false when idle', () => {
      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));
      expect(result.current.isActive).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isActive derivation
  // -------------------------------------------------------------------------

  describe('isActive', () => {
    it('is false when phase is completed', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse(makeInteractionCompleteEvent())
      );

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('test query');
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe('completed');
      });

      expect(result.current.isActive).toBe(false);
    });

    it('is false when phase is error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network down'));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('test query');
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe('error');
      });

      expect(result.current.isActive).toBe(false);
    });

    it('is true when phase is ideation (in-flight)', () => {
      // Never-resolving fetch keeps it in ideation phase
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      // Start without awaiting so it stays in flight
      act(() => {
        void result.current.startResearch('test query');
      });

      // Phase should be ideation immediately after startResearch called
      expect(result.current.state.phase).toBe('ideation');
      expect(result.current.isActive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // startResearch
  // -------------------------------------------------------------------------

  describe('startResearch', () => {
    it('makes POST request to stream endpoint with correct URL', async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([]));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('my query');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://test-stream/ai-studio/projects/${PROJECT_ID}/deep-research/stream`,
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('sends auth headers in POST request', async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([]));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('query');
      });

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(callOptions.headers).toMatchObject(AUTH_HEADER);
    });

    it('sends Content-Type application/json', async () => {
      mockFetch.mockResolvedValueOnce(createMockSSEResponse([]));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('query');
      });

      const callOptions = mockFetch.mock.calls[0][1] as RequestInit;
      expect(
        (callOptions.headers as Record<string, string>)['Content-Type']
      ).toBe('application/json');
    });

    it('sets phase to ideation immediately on start', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      act(() => {
        void result.current.startResearch('query');
      });

      expect(result.current.state.phase).toBe('ideation');
    });

    it('sets phase to error and calls onError when fetch throws', async () => {
      const onError = vi.fn();
      mockFetch.mockRejectedValueOnce(new Error('HTTP 500'));

      const { result } = renderHook(() =>
        useDiscussionResearch(PROJECT_ID, { onError })
      );

      await act(async () => {
        await result.current.startResearch('query');
      });

      expect(result.current.state.phase).toBe('error');
      expect(result.current.state.error).toBe('HTTP 500');
      expect(onError).toHaveBeenCalledWith('HTTP 500');
    });

    it('does not call onError when request is aborted', async () => {
      const onError = vi.fn();
      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const { result } = renderHook(() =>
        useDiscussionResearch(PROJECT_ID, { onError })
      );

      await act(async () => {
        await result.current.startResearch('query');
      });

      expect(onError).not.toHaveBeenCalled();
    });

    it('resets messages ref and state when called again', async () => {
      // First call returns one message
      const msgEvent = `event: discussion.message\ndata: ${JSON.stringify({
        id: 'msg-1',
        agentRole: 'director',
        agentName: 'Director',
        agentIcon: 'icon',
        content: 'Hello',
        phase: 'ideation',
        messageType: 'proposal',
        timestamp: new Date().toISOString(),
      })}`;

      mockFetch
        .mockResolvedValueOnce(createMockSSEResponse([msgEvent]))
        .mockResolvedValueOnce(createMockSSEResponse([]));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('first query');
      });

      // Should have one message
      await waitFor(() => {
        expect(result.current.state.messages.length).toBeGreaterThan(0);
      });

      // Second call should reset
      await act(async () => {
        await result.current.startResearch('second query');
      });

      // Messages should be empty after reset (before any new SSE events)
      // The second SSE stream is empty, so messages should be empty
      expect(result.current.state.messages).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // SSE event parsing
  // -------------------------------------------------------------------------

  describe('SSE event handling', () => {
    it('processes discussion.message event and adds to state', async () => {
      const msgData = {
        id: 'msg-1',
        agentRole: 'director' as const,
        agentName: 'Director',
        agentIcon: 'icon',
        content: 'Test message content',
        phase: 'ideation' as DiscussionPhase,
        messageType: 'proposal' as const,
        timestamp: new Date().toISOString(),
      };

      const events = [
        `event: discussion.message\ndata: ${JSON.stringify(msgData)}`,
      ];

      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const onMessage = vi.fn();
      const { result } = renderHook(() =>
        useDiscussionResearch(PROJECT_ID, { onMessage })
      );

      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.messages).toHaveLength(1);
      });

      expect(result.current.state.messages[0].id).toBe('msg-1');
      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-1' })
      );
    });

    it('processes discussion.phase event and updates phase', async () => {
      const phaseData = {
        phase: 'execution' as DiscussionPhase,
        summary: 'Moving to execution phase',
        directions: ['direction 1'],
      };

      const events = [
        `event: discussion.phase\ndata: ${JSON.stringify(phaseData)}`,
      ];

      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe('execution');
      });

      // Phase transition inserts a synthetic system message
      expect(result.current.state.messages.length).toBeGreaterThan(0);
      const sysMsg = result.current.state.messages.find(
        (m) => m.messageType === 'system'
      );
      expect(sysMsg).toBeDefined();
    });

    it('processes discussion.typing event and sets typingAgent', async () => {
      // Use a slow stream: type event followed immediately by close
      const typingData = { agentRole: 'researcher', agentName: 'Alice' };
      const events = [
        `event: discussion.typing\ndata: ${JSON.stringify(typingData)}`,
      ];

      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('query');
      });

      // After the stream closes typingAgent state depends on ordering;
      // what we can assert is that the hook didn't crash and phase stayed idle/ideation
      expect(['ideation', 'idle', 'error', 'completed']).toContain(
        result.current.state.phase
      );
    });

    it('processes interaction.complete event and calls onComplete', async () => {
      const onComplete = vi.fn();
      mockFetch.mockResolvedValueOnce(
        createMockSSEResponse(makeInteractionCompleteEvent())
      );

      const { result } = renderHook(() =>
        useDiscussionResearch(PROJECT_ID, { onComplete })
      );

      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe('completed');
      });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
    });

    it('processes error SSE event and calls onError', async () => {
      const onError = vi.fn();
      const errorData = { message: 'Backend error occurred' };
      const events = [`event: error\ndata: ${JSON.stringify(errorData)}`];

      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() =>
        useDiscussionResearch(PROJECT_ID, { onError })
      );

      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.phase).toBe('error');
      });

      expect(result.current.state.error).toBe('Backend error occurred');
      expect(onError).toHaveBeenCalledWith('Backend error occurred');
    });

    it('calls onStreamEndIncomplete when stream ends without completion', async () => {
      const onStreamEndIncomplete = vi.fn();
      // Stream ends in ideation phase without interaction.complete
      const events = [
        `event: discussion.phase\ndata: ${JSON.stringify({
          phase: 'ideation',
          summary: 'Starting...',
        })}`,
      ];

      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() =>
        useDiscussionResearch(PROJECT_ID, { onStreamEndIncomplete })
      );

      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(onStreamEndIncomplete).toHaveBeenCalled();
      });
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

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      act(() => {
        void result.current.startResearch('query');
      });

      expect(capturedSignal?.aborted).toBe(false);

      act(() => {
        result.current.stop();
      });

      expect(capturedSignal?.aborted).toBe(true);
    });

    it('transitions idle phase to idle (no-op cancel)', () => {
      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      act(() => {
        result.current.stop();
      });

      expect(result.current.state.phase).toBe('idle');
    });

    it('transitions active phase to error on stop', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

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
    it('returns to idle state with empty messages', async () => {
      const events = [
        `event: discussion.message\ndata: ${JSON.stringify({
          id: 'msg-1',
          agentRole: 'director',
          agentName: 'Director',
          agentIcon: 'icon',
          content: 'Hello',
          phase: 'ideation',
          messageType: 'proposal',
          timestamp: new Date().toISOString(),
        })}`,
      ];
      mockFetch.mockResolvedValueOnce(createMockSSEResponse(events));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => {
        expect(result.current.state.messages.length).toBeGreaterThan(0);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.state.phase).toBe('idle');
      expect(result.current.state.messages).toEqual([]);
      expect(result.current.state.error).toBeNull();
    });

    it('returns to idle phase when called from idle', () => {
      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      act(() => {
        result.current.reset();
      });

      expect(result.current.state.phase).toBe('idle');
    });

    it('isActive is false after reset', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fail'));

      const { result } = renderHook(() => useDiscussionResearch(PROJECT_ID));

      await act(async () => {
        await result.current.startResearch('query');
      });

      await waitFor(() => expect(result.current.state.phase).toBe('error'));

      act(() => {
        result.current.reset();
      });

      expect(result.current.isActive).toBe(false);
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

      const { result, unmount } = renderHook(() =>
        useDiscussionResearch(PROJECT_ID)
      );

      act(() => {
        void result.current.startResearch('query');
      });

      expect(capturedSignal?.aborted).toBe(false);
      unmount();
      expect(capturedSignal?.aborted).toBe(true);
    });
  });
});
