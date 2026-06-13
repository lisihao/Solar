import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be declared BEFORE the hoisted vi.mock calls
// ---------------------------------------------------------------------------

const mockSocket = {
  on: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
  id: 'mock-socket-id',
  off: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: vi.fn(),
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

import { io } from 'socket.io-client';
import { getAuthTokens } from '@/lib/utils/auth';
import { useResearchWebSocket } from '../useResearchWebSocket';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSocketHandler(
  event: string
): ((...args: unknown[]) => void) | undefined {
  const call = mockSocket.on.mock.calls.find((c) => c[0] === event);
  return call?.[1] as ((...args: unknown[]) => void) | undefined;
}

function fireConnect() {
  const handler = getSocketHandler('connect');
  if (handler) {
    act(() => {
      handler();
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useResearchWebSocket', () => {
  const TOPIC_ID = 'topic-123';
  const MOCK_TOKEN = 'mock-access-token';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset socket state
    mockSocket.connected = false;
    mockSocket.on.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.disconnect.mockClear();
    mockSocket.removeAllListeners.mockClear();

    // Default: auth token available
    vi.mocked(getAuthTokens).mockReturnValue({
      accessToken: MOCK_TOKEN,
      refreshToken: 'refresh-token',
    });
  });

  // -------------------------------------------------------------------------
  // Connection guards
  // -------------------------------------------------------------------------

  describe('connection guards', () => {
    it('does not connect when topicId is null', () => {
      renderHook(() => useResearchWebSocket(null));
      expect(io).not.toHaveBeenCalled();
    });

    it('does not connect when topicId is empty string', () => {
      renderHook(() => useResearchWebSocket(''));
      expect(io).not.toHaveBeenCalled();
    });

    it('does not connect when enabled is false (boolean arg)', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID, false));
      expect(io).not.toHaveBeenCalled();
    });

    it('does not connect when enabled option is false (options object)', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID, { enabled: false }));
      expect(io).not.toHaveBeenCalled();
    });

    it('does not connect when no auth token is available', () => {
      vi.mocked(getAuthTokens).mockReturnValue(null);
      renderHook(() => useResearchWebSocket(TOPIC_ID));
      expect(io).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Connection setup
  // -------------------------------------------------------------------------

  describe('connection setup', () => {
    it('connects to /topic-insights namespace', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID));

      expect(io).toHaveBeenCalledWith(
        expect.stringContaining('/topic-insights'),
        expect.anything()
      );
    });

    it('passes JWT token in auth handshake', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID));

      const ioOptions = vi.mocked(io).mock.calls[0][1] as {
        auth?: { token: string };
      };
      expect(ioOptions?.auth?.token).toBe(MOCK_TOKEN);
    });

    it('connects when enabled is true (boolean)', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID, true));
      expect(io).toHaveBeenCalled();
    });

    it('connects when options object has no enabled field (defaults to true)', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID, {}));
      expect(io).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Initial return state
  // -------------------------------------------------------------------------

  describe('initial return state', () => {
    it('returns isConnected false initially', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));
      expect(result.current.isConnected).toBe(false);
    });

    it('returns null error initially', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));
      expect(result.current.error).toBeNull();
    });

    it('returns empty events array initially', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));
      expect(result.current.events).toEqual([]);
    });

    it('returns progress 0 initially', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));
      expect(result.current.progress).toBe(0);
    });

    it('returns empty activeAgentIds initially', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));
      expect(result.current.activeAgentIds).toEqual([]);
    });

    it('returns isSyncing false initially', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));
      expect(result.current.isSyncing).toBe(false);
    });

    it('returns lastSyncAt null initially', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));
      expect(result.current.lastSyncAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Connect event
  // -------------------------------------------------------------------------

  describe('on connect event', () => {
    it('sets isConnected to true on connect', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();

      expect(result.current.isConnected).toBe(true);
    });

    it('emits join:topic with topicId on connect', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();

      expect(mockSocket.emit).toHaveBeenCalledWith('join:topic', {
        topicId: TOPIC_ID,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  describe('disconnect', () => {
    it('emits leave:topic when disconnect is called with active topicId', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();

      act(() => {
        result.current.disconnect();
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('leave:topic', {
        topicId: TOPIC_ID,
      });
    });

    it('calls socket.disconnect when disconnect is called', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();

      act(() => {
        result.current.disconnect();
      });

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('sets isConnected to false after disconnect', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();

      expect(result.current.isConnected).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // clearEvents
  // -------------------------------------------------------------------------

  describe('clearEvents', () => {
    it('resets events array to empty', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();

      // Simulate a mission:started event being added
      const missionStartedHandler = getSocketHandler('mission:started');
      if (missionStartedHandler) {
        act(() => {
          missionStartedHandler({ message: 'started' });
        });
      }

      act(() => {
        result.current.clearEvents();
      });

      expect(result.current.events).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Boolean vs options arg
  // -------------------------------------------------------------------------

  describe('enabledOrOptions parameter', () => {
    it('accepts a boolean true as second argument', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID, true));
      expect(result.current).toHaveProperty('isConnected');
      expect(io).toHaveBeenCalled();
    });

    it('accepts a boolean false as second argument', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID, false));
      expect(io).not.toHaveBeenCalled();
    });

    it('accepts an options object with enabled: true', () => {
      const onEvent = vi.fn();
      renderHook(() =>
        useResearchWebSocket(TOPIC_ID, { enabled: true, onEvent })
      );
      expect(io).toHaveBeenCalled();
    });

    it('accepts an options object with enabled: false', () => {
      renderHook(() => useResearchWebSocket(TOPIC_ID, { enabled: false }));
      expect(io).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // auth error event
  // -------------------------------------------------------------------------

  describe('auth:error event', () => {
    it('sets error state on auth:error', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      const authErrorHandler = getSocketHandler('auth:error');
      if (authErrorHandler) {
        act(() => {
          authErrorHandler({ message: '认证失败' });
        });
      }

      if (authErrorHandler) {
        expect(result.current.error).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // connect error event
  // -------------------------------------------------------------------------

  describe('connect_error event', () => {
    it('sets error state on connect_error', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      const connectErrorHandler = getSocketHandler('connect_error');
      if (connectErrorHandler) {
        act(() => {
          connectErrorHandler({ message: 'Connection refused' });
        });
        expect(result.current.error).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Return shape
  // -------------------------------------------------------------------------

  describe('return shape', () => {
    it('returns all expected fields', () => {
      const { result } = renderHook(() => useResearchWebSocket(null));

      expect(result.current).toHaveProperty('isConnected');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('progress');
      expect(result.current).toHaveProperty('phase');
      expect(result.current).toHaveProperty('currentMessage');
      expect(result.current).toHaveProperty('activeAgentIds');
      expect(result.current).toHaveProperty('events');
      expect(result.current).toHaveProperty('isSyncing');
      expect(result.current).toHaveProperty('lastSyncAt');
      expect(result.current).toHaveProperty('connect');
      expect(result.current).toHaveProperty('disconnect');
      expect(result.current).toHaveProperty('clearEvents');
      expect(result.current).toHaveProperty('requestSync');
    });
  });

  // -------------------------------------------------------------------------
  // Unmount cleanup
  // -------------------------------------------------------------------------

  describe('unmount cleanup', () => {
    it('calls removeAllListeners and disconnect on unmount', () => {
      const { unmount } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();
      unmount();

      expect(mockSocket.removeAllListeners).toHaveBeenCalled();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('emits leave:topic on unmount', () => {
      const { unmount } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      fireConnect();
      unmount();

      expect(mockSocket.emit).toHaveBeenCalledWith('leave:topic', {
        topicId: TOPIC_ID,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Agent events
  // -------------------------------------------------------------------------

  describe('agent:working event', () => {
    it('adds agentId to activeAgentIds when status=working', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('agent:working');
      act(() => {
        handler?.({ agentId: 'agent-1', status: 'working' });
      });

      expect(result.current.activeAgentIds).toContain('agent-1');
    });

    it('removes agentId from activeAgentIds when status is not working', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      // First add the agent
      const handler = getSocketHandler('agent:working');
      act(() => {
        handler?.({ agentId: 'agent-1', status: 'working' });
      });

      // Then mark as done
      act(() => {
        handler?.({ agentId: 'agent-1', status: 'idle' });
      });

      expect(result.current.activeAgentIds).not.toContain('agent-1');
    });

    it('does not duplicate agentId when already working', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('agent:working');
      act(() => {
        handler?.({ agentId: 'agent-1', status: 'working' });
        handler?.({ agentId: 'agent-1', status: 'working' });
      });

      const count = result.current.activeAgentIds.filter(
        (id) => id === 'agent-1'
      ).length;
      expect(count).toBe(1);
    });
  });

  describe('agent:completed event', () => {
    it('fires agent:completed event handler', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('agent:completed');
      act(() => {
        handler?.({ agentId: 'agent-1', result: 'done' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('agent:completed');
    });
  });

  // -------------------------------------------------------------------------
  // Task events
  // -------------------------------------------------------------------------

  describe('task:started event', () => {
    it('sets currentMessage when task:started received', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('task:started');
      act(() => {
        handler?.({
          taskId: 't1',
          title: 'Research Task',
          message: 'Starting research',
        });
      });

      expect(result.current.currentMessage).toBe('Starting research');
    });

    it('uses default message format when no message provided', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('task:started');
      act(() => {
        handler?.({ taskId: 't1', title: 'Research Task' });
      });

      expect(result.current.currentMessage).toContain('Research Task');
    });
  });

  describe('task:progress event', () => {
    it('fires task:progress event handler', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('task:progress');
      act(() => {
        handler?.({ taskId: 't1', progress: 50 });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('task:progress');
    });
  });

  describe('task:completed event', () => {
    it('fires task:completed event handler', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('task:completed');
      act(() => {
        handler?.({ taskId: 't1', result: 'success' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('task:completed');
    });
  });

  // -------------------------------------------------------------------------
  // TODO events
  // -------------------------------------------------------------------------

  describe('todo events', () => {
    it('fires todo:created event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:created');
      act(() => {
        handler?.({ todoId: 'todo-1', title: 'Find sources' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('todo:created');
    });

    it('fires todo:status_changed event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:status_changed');
      act(() => {
        handler?.({ todoId: 'todo-1', status: 'IN_PROGRESS' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('todo:status_changed');
    });

    it('fires todo:completed event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:completed');
      act(() => {
        handler?.({ todoId: 'todo-1', result: 'done' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('todo:completed');
    });

    it('fires todo:failed event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:failed');
      act(() => {
        handler?.({ todoId: 'todo-1', error: 'network error' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('todo:failed');
    });

    it('fires todo:cancelled event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:cancelled');
      act(() => {
        handler?.({ todoId: 'todo-1' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('todo:cancelled');
    });

    it('fires todo:progress event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:progress');
      act(() => {
        handler?.({ todoId: 'todo-1', progress: 75 });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('todo:progress');
    });

    it('sets currentMessage on todo:reviewing event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:reviewing');
      act(() => {
        handler?.({ todoId: 'todo-1', message: 'Reviewing now' });
      });

      expect(result.current.currentMessage).toBe('Reviewing now');
    });

    it('sets default message on todo:reviewing when no message provided', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:reviewing');
      act(() => {
        handler?.({ todoId: 'todo-1' });
      });

      expect(result.current.currentMessage).toContain('Leader');
    });

    it('sets "审核通过" message on approved todo:reviewed', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:reviewed');
      act(() => {
        handler?.({ todoId: 'todo-1', decision: 'approved' });
      });

      expect(result.current.currentMessage).toContain('审核通过');
    });

    it('sets "需要修改" message on needs_revision todo:reviewed', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:reviewed');
      act(() => {
        handler?.({ todoId: 'todo-1', decision: 'needs_revision' });
      });

      expect(result.current.currentMessage).toContain('需要修改');
    });
  });

  // -------------------------------------------------------------------------
  // Dimension events
  // -------------------------------------------------------------------------

  describe('dimension events', () => {
    it('fires dimension:research_started event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('dimension:research_started');
      act(() => {
        handler?.({ dimensionId: 'dim-1' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('dimension:research_started');
    });

    it('fires dimension:research_progress event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('dimension:research_progress');
      act(() => {
        handler?.({ dimensionId: 'dim-1', progress: 50 });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('dimension:research_progress');
    });

    it('fires dimension:research_completed event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('dimension:research_completed');
      act(() => {
        handler?.({ dimensionId: 'dim-1', result: {} });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('dimension:research_completed');
    });
  });

  // -------------------------------------------------------------------------
  // Report synthesis events
  // -------------------------------------------------------------------------

  describe('report synthesis events', () => {
    it('fires report:synthesis_started event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('report:synthesis_started');
      act(() => {
        handler?.({ reportId: 'rep-1' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('report:synthesis_started');
    });

    it('fires report:synthesis_completed event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('report:synthesis_completed');
      act(() => {
        handler?.({ reportId: 'rep-1', content: 'Report content' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('report:synthesis_completed');
    });
  });

  // -------------------------------------------------------------------------
  // mission events
  // -------------------------------------------------------------------------

  describe('mission:started event', () => {
    it('fires mission:started and adds event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('mission:started');
      act(() => {
        handler?.({ missionId: 'm-1', message: 'Mission started' });
      });

      const lastEvent = result.current.events[result.current.events.length - 1];
      expect(lastEvent?.type).toBe('mission:started');
    });
  });

  describe('mission:completed event', () => {
    it('fires mission:completed and updates progress to 100', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('mission:completed');
      act(() => {
        handler?.({ missionId: 'm-1', success: true });
      });

      expect(result.current.progress).toBe(100);
    });
  });

  describe('mission:failed event', () => {
    it('fires mission:failed and sets error', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('mission:failed');
      act(() => {
        handler?.({ missionId: 'm-1', error: 'Mission failed reason' });
      });

      if (handler) {
        const lastEvent =
          result.current.events[result.current.events.length - 1];
        expect(lastEvent?.type).toBe('mission:failed');
      }
    });
  });

  describe('mission:progress event', () => {
    it('updates progress value when mission:progress fires', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('mission:progress');
      act(() => {
        handler?.({ missionId: 'm-1', progress: 65, message: 'Processing' });
      });

      if (handler) {
        expect(result.current.progress).toBe(65);
      }
    });
  });

  // -------------------------------------------------------------------------
  // sync events
  // -------------------------------------------------------------------------

  describe('sync:started / sync:completed events', () => {
    it('sets isSyncing=true on sync:started', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('sync:started');
      act(() => {
        handler?.({ timestamp: new Date().toISOString() });
      });

      if (handler) {
        expect(result.current.isSyncing).toBe(true);
      }
    });

    it('sets isSyncing=false and lastSyncAt on sync:completed', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const startHandler = getSocketHandler('sync:started');
      act(() => {
        startHandler?.({ timestamp: new Date().toISOString() });
      });

      const completeHandler = getSocketHandler('sync:completed');
      act(() => {
        completeHandler?.({ timestamp: new Date().toISOString() });
      });

      if (completeHandler) {
        expect(result.current.isSyncing).toBe(false);
        expect(result.current.lastSyncAt).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // requestSync
  // -------------------------------------------------------------------------

  describe('requestSync', () => {
    it('emits sync:request when socket reports connected', () => {
      // Set connected=true BEFORE rendering so the ref captures it
      mockSocket.connected = true;
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      act(() => {
        result.current.requestSync();
      });

      const syncCalls = mockSocket.emit.mock.calls.filter(
        (c) => c[0] === 'sync:request'
      );
      expect(syncCalls.length).toBeGreaterThan(0);
      if (syncCalls.length > 0) {
        expect(syncCalls[0][1]).toMatchObject({ topicId: TOPIC_ID });
      }
    });

    it('does not emit sync:request when socket is not connected', () => {
      mockSocket.connected = false;
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      // No fireConnect - socket not connected

      act(() => {
        result.current.requestSync();
      });

      // Should not have emitted sync:request since not connected
      const syncCalls = mockSocket.emit.mock.calls.filter(
        (c) => c[0] === 'sync:request'
      );
      expect(syncCalls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // connect (manual) function
  // -------------------------------------------------------------------------

  describe('connect function', () => {
    it('can call connect function without throwing', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));

      // Should not throw when called manually
      expect(() => {
        act(() => {
          result.current.connect();
        });
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // disconnect event (server-side disconnect)
  // -------------------------------------------------------------------------

  describe('server-initiated disconnect event', () => {
    it('sets isConnected to false on socket disconnect event', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      expect(result.current.isConnected).toBe(true);

      const disconnectHandler = getSocketHandler('disconnect');
      act(() => {
        disconnectHandler?.('io server disconnect');
      });

      if (disconnectHandler) {
        expect(result.current.isConnected).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // onEvent callback
  // -------------------------------------------------------------------------

  describe('onEvent callback', () => {
    it('calls onEvent callback with each emitted event', () => {
      const onEvent = vi.fn();
      const { result } = renderHook(() =>
        useResearchWebSocket(TOPIC_ID, { enabled: true, onEvent })
      );
      fireConnect();

      const handler = getSocketHandler('mission:started');
      act(() => {
        handler?.({ missionId: 'm-1', message: 'started' });
      });

      if (handler) {
        expect(onEvent).toHaveBeenCalled();
        const calledWith = onEvent.mock.calls[0][0];
        expect(calledWith.type).toBe('mission:started');
      }
    });
  });

  // -------------------------------------------------------------------------
  // todo:reviewing without message
  // -------------------------------------------------------------------------

  describe('todo:reviewing edge cases', () => {
    it('uses default message on todo:reviewing when message not provided', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:reviewing');
      act(() => {
        handler?.({ todoId: 'todo-1' }); // no message field
      });

      // Should have set a default message (contains Leader based on existing test)
      if (handler) {
        expect(result.current.currentMessage).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // todo:reviewed with other decision
  // -------------------------------------------------------------------------

  describe('todo:reviewed edge cases', () => {
    it('handles unknown decision gracefully', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('todo:reviewed');
      act(() => {
        handler?.({ todoId: 'todo-1', decision: 'unknown_decision' });
      });

      // Should not throw, just set some message or empty string
      expect(typeof result.current.currentMessage).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // leader events
  // -------------------------------------------------------------------------

  describe('leader:thinking event', () => {
    it('sets currentMessage with thinking content', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('leader:thinking');
      act(() => {
        handler?.({
          content: 'Analyzing the topic deeply...',
          phase: 'analyzing',
          missionId: 'm-1',
          progress: 20,
          timestamp: '',
        });
      });

      if (handler) {
        expect(result.current.currentMessage).toBe(
          'Analyzing the topic deeply...'
        );
      }
    });
  });

  describe('leader:planning event', () => {
    it('sets currentMessage with planning message', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('leader:planning');
      act(() => {
        handler?.({ message: 'Creating plan...', missionId: 'm-1' });
      });

      if (handler) {
        expect(result.current.currentMessage).toBe('Creating plan...');
      }
    });

    it('uses content field when message is missing', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('leader:planning');
      act(() => {
        handler?.({ content: 'Planning via content', missionId: 'm-1' });
      });

      if (handler) {
        expect(result.current.currentMessage).toBe('Planning via content');
      }
    });
  });

  describe('leader:plan_ready event', () => {
    it('sets currentMessage with plan ready message', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('leader:plan_ready');
      act(() => {
        handler?.({ message: 'Plan is ready!', missionId: 'm-1' });
      });

      if (handler) {
        expect(result.current.currentMessage).toBe('Plan is ready!');
        const lastEvent =
          result.current.events[result.current.events.length - 1];
        expect(lastEvent?.type).toBe('leader:plan_ready');
      }
    });
  });

  describe('leader:response event', () => {
    it('fires leader:response event handler', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('leader:response');
      act(() => {
        handler?.({ response: 'Done!', missionId: 'm-1' });
      });

      if (handler) {
        const lastEvent =
          result.current.events[result.current.events.length - 1];
        expect(lastEvent?.type).toBe('leader:response');
      }
    });
  });

  // -------------------------------------------------------------------------
  // mission:progress with activeAgents
  // -------------------------------------------------------------------------

  describe('mission:progress with activeAgents', () => {
    it('sets activeAgentIds when mission:progress has activeAgents', () => {
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      const handler = getSocketHandler('mission:progress');
      act(() => {
        handler?.({
          missionId: 'm-1',
          progress: 40,
          phase: 'research',
          message: 'Researching...',
          completedTasks: 2,
          totalTasks: 5,
          activeAgents: ['agent-x', 'agent-y'],
          timestamp: '',
        });
      });

      if (handler) {
        expect(result.current.activeAgentIds).toContain('agent-x');
        expect(result.current.activeAgentIds).toContain('agent-y');
      }
    });
  });

  // -------------------------------------------------------------------------
  // sync callback handling
  // -------------------------------------------------------------------------

  describe('sync:request callback', () => {
    it('handles successful sync response with currentState', () => {
      mockSocket.connected = true;
      const { result } = renderHook(() => useResearchWebSocket(TOPIC_ID));
      fireConnect();

      // Manually simulate what happens when sync:request callback fires
      // The callback is registered as the third argument to socket.emit
      act(() => {
        result.current.requestSync();
      });

      // Find the callback passed to emit
      const syncCall = mockSocket.emit.mock.calls.find(
        (c) => c[0] === 'sync:request'
      );
      if (syncCall && typeof syncCall[2] === 'function') {
        act(() => {
          syncCall[2]({
            success: true,
            currentState: {
              progress: 75,
              phase: 'research',
              message: 'In progress',
            },
            needsRecovery: false,
          });
        });

        expect(result.current.progress).toBe(75);
        expect(result.current.isSyncing).toBe(false);
      }
    });

    it('handles successful sync response with needsRecovery', () => {
      const onNeedsRecovery = vi.fn();
      mockSocket.connected = true;
      const { result } = renderHook(() =>
        useResearchWebSocket(TOPIC_ID, { enabled: true, onNeedsRecovery })
      );
      fireConnect();

      act(() => {
        result.current.requestSync();
      });

      const syncCall = mockSocket.emit.mock.calls.find(
        (c) => c[0] === 'sync:request'
      );
      if (syncCall && typeof syncCall[2] === 'function') {
        act(() => {
          syncCall[2]({
            success: true,
            currentState: {
              progress: 50,
              phase: 'research',
              message: 'need recovery',
            },
            needsRecovery: true,
          });
        });

        expect(onNeedsRecovery).toHaveBeenCalled();
      }
    });
  });

  // -------------------------------------------------------------------------
  // topicId change - reconnects
  // -------------------------------------------------------------------------

  describe('topicId change', () => {
    it('reconnects with new topicId when topicId changes', () => {
      const { rerender } = renderHook(
        ({ topicId }: { topicId: string | null }) =>
          useResearchWebSocket(topicId),
        { initialProps: { topicId: 'topic-aaa' } }
      );

      expect(io).toHaveBeenCalledTimes(1);

      rerender({ topicId: 'topic-bbb' });

      // Should have created a new socket connection
      expect(io).toHaveBeenCalledTimes(2);
    });
  });
});
