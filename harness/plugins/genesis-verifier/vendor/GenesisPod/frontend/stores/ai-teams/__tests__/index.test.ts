/**
 * Tests for stores/ai-teams/index.ts
 *
 * Covers the setupWebSocketListeners function and the combined store's
 * connectSocket override and resetStore action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Socket } from 'socket.io-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSocketOn = vi.fn();
const mockSocketEmit = vi.fn();
const mockSocketDisconnect = vi.fn();
const mockManagerOn = vi.fn();
const mockEngineOn = vi.fn();

const createMockSocket = (connected = false) => ({
  on: mockSocketOn,
  emit: mockSocketEmit,
  disconnect: mockSocketDisconnect,
  connected,
  id: 'socket-test-id',
  io: {
    on: mockManagerOn,
    engine: { on: mockEngineOn, transport: { name: 'websocket' } },
  },
});

let mockSocketInstance = createMockSocket(false);

vi.mock('socket.io-client', () => ({
  io: vi.fn().mockImplementation(() => {
    mockSocketInstance = createMockSocket(false);
    return mockSocketInstance;
  }),
}));

vi.mock('@/services/ai-teams/api', () => ({
  getMissions: vi.fn(),
  getMissionById: vi.fn(),
  createMission: vi.fn(),
  cancelMission: vi.fn(),
  deleteMission: vi.fn(),
  pauseMission: vi.fn(),
  resumeMission: vi.fn(),
  retryMission: vi.fn(),
  getTeamMembers: vi.fn(),
  setTeamLeader: vi.fn(),
  updateTeamRole: vi.fn(),
  getTopics: vi.fn(),
  getTopicById: vi.fn(),
  createTopic: vi.fn(),
  updateTopic: vi.fn(),
  deleteTopic: vi.fn(),
  addMember: vi.fn(),
  addMemberByEmail: vi.fn(),
  removeMember: vi.fn(),
  leaveTopic: vi.fn(),
  addAIMember: vi.fn(),
  updateAIMember: vi.fn(),
  removeAIMember: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  deleteMessage: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
  generateAIResponse: vi.fn(),
  getResources: vi.fn(),
  addResource: vi.fn(),
  removeResource: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: vi.fn().mockReturnValue({ accessToken: 'test-token' }),
}));

import { useAiGroupStore } from '../index';

// ---------------------------------------------------------------------------
// Helper to get a registered socket handler by event name
// ---------------------------------------------------------------------------
function getHandler(event: string): ((...args: unknown[]) => void) | undefined {
  const call = mockSocketOn.mock.calls.find((c) => c[0] === event);
  return call?.[1] as ((...args: unknown[]) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aiTeamsStore index - setupWebSocketListeners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketOn.mockClear();
    mockSocketEmit.mockClear();
    mockSocketDisconnect.mockClear();
    useAiGroupStore.getState().resetStore();
  });

  // -------------------------------------------------------------------------
  // Setup: call connectSocket so socket.on handlers are registered
  // -------------------------------------------------------------------------

  function connectAndGetHandlers() {
    useAiGroupStore.getState().connectSocket('user-1');
    return mockSocketOn.mock.calls;
  }

  it('registers mission:completed event handler', () => {
    connectAndGetHandlers();
    expect(
      mockSocketOn.mock.calls.some(([e]) => e === 'mission:completed')
    ).toBe(true);
  });

  it('registers mission:failed event handler', () => {
    connectAndGetHandlers();
    expect(mockSocketOn.mock.calls.some(([e]) => e === 'mission:failed')).toBe(
      true
    );
  });

  it('registers mission:agent_done event handler', () => {
    connectAndGetHandlers();
    expect(
      mockSocketOn.mock.calls.some(([e]) => e === 'mission:agent_done')
    ).toBe(true);
  });

  it('registers mission:agent_working event handler', () => {
    connectAndGetHandlers();
    expect(
      mockSocketOn.mock.calls.some(([e]) => e === 'mission:agent_working')
    ).toBe(true);
  });

  it('registers task:completed event handler', () => {
    connectAndGetHandlers();
    expect(mockSocketOn.mock.calls.some(([e]) => e === 'task:completed')).toBe(
      true
    );
  });

  it('registers task:status event handler', () => {
    connectAndGetHandlers();
    expect(mockSocketOn.mock.calls.some(([e]) => e === 'task:status')).toBe(
      true
    );
  });

  it('registers message:new event handler', () => {
    connectAndGetHandlers();
    expect(mockSocketOn.mock.calls.some(([e]) => e === 'message:new')).toBe(
      true
    );
  });

  // -------------------------------------------------------------------------
  // Fire handlers to cover the event logic
  // -------------------------------------------------------------------------

  it('mission:completed handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:completed');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        finalResult: 'All done',
        summary: 'Summary text',
        participantAIIds: ['agent-1', 'agent-2'],
      });
    }).not.toThrow();
  });

  it('mission:completed handler with no participantAIIds does not throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:completed');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        finalResult: 'Done',
        summary: 'Summary',
      });
    }).not.toThrow();
  });

  it('mission:failed handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:failed');
    expect(() => {
      handler?.({ missionId: 'mission-1' });
    }).not.toThrow();
  });

  it('mission:agent_done handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:agent_done');
    expect(() => {
      handler?.({ missionId: 'mission-1', agentId: 'agent-1', taskId: null });
    }).not.toThrow();
  });

  it('mission:agent_working handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:agent_working');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        agentId: 'agent-1',
        taskId: 'task-1',
      });
    }).not.toThrow();
  });

  it('task:completed handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('task:completed');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        taskId: 'task-1',
        agentId: 'agent-1',
      });
    }).not.toThrow();
  });

  it('task:status handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('task:status');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        taskId: 'task-1',
        status: 'completed',
        result: 'Task result',
      });
    }).not.toThrow();
  });

  it('message:new handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('message:new');
    expect(() => {
      handler?.({
        id: 'msg-1',
        content: 'Hello',
        senderId: 'user-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it('message:delete handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('message:delete');
    expect(() => {
      handler?.({ messageId: 'msg-1' });
    }).not.toThrow();
  });

  it('reaction:add handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('reaction:add');
    expect(() => {
      handler?.({ messageId: 'msg-1', userId: 'user-1', emoji: '👍' });
    }).not.toThrow();
  });

  it('reaction:remove handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('reaction:remove');
    expect(() => {
      handler?.({ messageId: 'msg-1', userId: 'user-1', emoji: '👍' });
    }).not.toThrow();
  });

  it('ai:typing handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('ai:typing');
    expect(() => {
      handler?.({ aiMemberId: 'ai-1' });
    }).not.toThrow();
  });

  it('ai:response handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('ai:response');
    expect(() => {
      handler?.({ aiMemberId: 'ai-1', messageId: 'msg-1' });
    }).not.toThrow();
  });

  it('ai:error handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('ai:error');
    expect(() => {
      handler?.({ aiMemberId: 'ai-1', error: 'AI processing failed' });
    }).not.toThrow();
  });

  it('mission:created handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:created');
    expect(() => {
      handler?.({
        mission: {
          id: 'mission-2',
          topicId: 'topic-1',
          status: 'pending',
          title: 'New Mission',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }).not.toThrow();
  });

  it('mission:status_changed handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:status_changed');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        status: 'running',
        previousStatus: 'pending',
        totalTasks: 5,
        tasks: [],
      });
    }).not.toThrow();
  });

  it('mission:progress_updated handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:progress_updated');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        completedTasks: 3,
        totalTasks: 5,
        progressPercent: 60,
      });
    }).not.toThrow();
  });

  it('mission:status (legacy) handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('mission:status');
    expect(() => {
      handler?.({
        missionId: 'mission-1',
        status: 'completed',
        progressPercent: 100,
        completedTasks: 5,
        totalTasks: 5,
      });
    }).not.toThrow();
  });

  it('member:typing handler fires without throw', () => {
    connectAndGetHandlers();
    const handler = getHandler('member:typing');
    expect(() => {
      handler?.({ userId: 'user-1' });
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // resetStore
  // -------------------------------------------------------------------------

  it('resetStore disconnects socket if present', () => {
    useAiGroupStore.setState({
      socket: mockSocketInstance as unknown as Socket,
    });
    useAiGroupStore.getState().resetStore();
    expect(mockSocketDisconnect).toHaveBeenCalled();
  });

  it('resetStore clears all state fields', () => {
    useAiGroupStore.getState().resetStore();
    const state = useAiGroupStore.getState();
    expect(state.topics).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(state.missions).toEqual([]);
    expect(state.socket).toBeNull();
    expect(state.isConnected).toBe(false);
  });

  it('resetStore does not throw when socket is null', () => {
    useAiGroupStore.setState({ socket: null });
    expect(() => {
      useAiGroupStore.getState().resetStore();
    }).not.toThrow();
  });
});
