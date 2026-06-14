import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Socket } from 'socket.io-client';

// Must mock socket.io-client BEFORE importing the store
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
    engine: {
      on: mockEngineOn,
      transport: { name: 'websocket' },
    },
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
  getAuthTokens: vi.fn().mockReturnValue({ accessToken: 'test-access-token' }),
}));

import { io } from 'socket.io-client';
import { useAiGroupStore } from '../index';

describe('websocketSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketOn.mockClear();
    mockSocketEmit.mockClear();
    mockSocketDisconnect.mockClear();
    mockManagerOn.mockClear();
    useAiGroupStore.getState().resetStore();
  });

  // ==================== Initial State ====================

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAiGroupStore.getState();
      expect(state.socket).toBeNull();
      expect(state.isConnected).toBe(false);
      expect(state.currentUserId).toBeNull();
      expect(state.onlineUsers).toBeInstanceOf(Set);
      expect(state.onlineUsers.size).toBe(0);
    });
  });

  // ==================== connectSocket ====================

  describe('connectSocket', () => {
    it('should create socket and store it in state', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      expect(io).toHaveBeenCalledWith(
        expect.stringContaining('/ai-teams'),
        expect.objectContaining({
          auth: expect.objectContaining({ userId: 'user-1' }),
        })
      );
      expect(useAiGroupStore.getState().socket).not.toBeNull();
    });

    it('should store currentUserId in state', () => {
      useAiGroupStore.getState().connectSocket('user-1');
      expect(useAiGroupStore.getState().currentUserId).toBe('user-1');
    });

    it('should pass auth token to socket', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({ token: 'test-access-token' }),
        })
      );
    });

    it('should not create new socket if already connected', () => {
      // Simulate already connected socket
      const connectedSocket = createMockSocket(true);
      useAiGroupStore.setState({
        socket: connectedSocket as unknown as Socket,
      });

      useAiGroupStore.getState().connectSocket('user-1');

      // io() should not have been called again
      expect(io).not.toHaveBeenCalled();
    });

    it('should register connect event handler', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      const connectCallArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'connect'
      );
      expect(connectCallArgs).toBeDefined();
    });

    it('should register disconnect event handler', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      const disconnectCallArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'disconnect'
      );
      expect(disconnectCallArgs).toBeDefined();
    });

    it('should register member:online event handler', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      const onlineCallArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'member:online'
      );
      expect(onlineCallArgs).toBeDefined();
    });

    it('should register member:offline event handler', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      const offlineCallArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'member:offline'
      );
      expect(offlineCallArgs).toBeDefined();
    });

    it('connect handler should set isConnected to true', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      const connectArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'connect'
      );
      const connectHandler = connectArgs?.[1] as () => void;
      connectHandler();

      expect(useAiGroupStore.getState().isConnected).toBe(true);
    });

    it('disconnect handler should set isConnected to false and clear onlineUsers', () => {
      useAiGroupStore.setState({
        isConnected: true,
        onlineUsers: new Set(['user-2']),
      });
      useAiGroupStore.getState().connectSocket('user-1');

      const disconnectArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'disconnect'
      );
      const disconnectHandler = disconnectArgs?.[1] as (reason: string) => void;
      disconnectHandler('transport close');

      const state = useAiGroupStore.getState();
      expect(state.isConnected).toBe(false);
      expect(state.onlineUsers.size).toBe(0);
    });

    it('member:online handler should add user to onlineUsers', () => {
      useAiGroupStore.getState().connectSocket('user-1');

      const onlineArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'member:online'
      );
      const onlineHandler = onlineArgs?.[1] as (data: {
        userId: string;
      }) => void;
      onlineHandler({ userId: 'user-2' });

      expect(useAiGroupStore.getState().onlineUsers.has('user-2')).toBe(true);
    });

    it('member:offline handler should remove user from onlineUsers', () => {
      useAiGroupStore.setState({ onlineUsers: new Set(['user-2', 'user-3']) });
      useAiGroupStore.getState().connectSocket('user-1');

      const offlineArgs = mockSocketOn.mock.calls.find(
        ([event]) => event === 'member:offline'
      );
      const offlineHandler = offlineArgs?.[1] as (data: {
        userId: string;
      }) => void;
      offlineHandler({ userId: 'user-2' });

      const onlineUsers = useAiGroupStore.getState().onlineUsers;
      expect(onlineUsers.has('user-2')).toBe(false);
      expect(onlineUsers.has('user-3')).toBe(true);
    });
  });

  // ==================== disconnectSocket ====================

  describe('disconnectSocket', () => {
    it('should call socket.disconnect and clear all socket state', () => {
      const mockSocket = createMockSocket(true);
      useAiGroupStore.setState({
        socket: mockSocket as unknown as Socket,
        isConnected: true,
        currentUserId: 'user-1',
        onlineUsers: new Set(['user-2']),
      });

      useAiGroupStore.getState().disconnectSocket();

      expect(mockSocket.disconnect).toHaveBeenCalled();

      const state = useAiGroupStore.getState();
      expect(state.socket).toBeNull();
      expect(state.isConnected).toBe(false);
      expect(state.currentUserId).toBeNull();
      expect(state.onlineUsers.size).toBe(0);
    });

    it('should do nothing if no socket exists', () => {
      useAiGroupStore.setState({ socket: null });
      expect(() => useAiGroupStore.getState().disconnectSocket()).not.toThrow();
    });
  });

  // ==================== joinTopicRoom ====================

  describe('joinTopicRoom', () => {
    it('should emit topic:join when socket is connected', () => {
      const mockSocket = createMockSocket(true);
      useAiGroupStore.setState({ socket: mockSocket as unknown as Socket });

      useAiGroupStore.getState().joinTopicRoom('topic-1');

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'topic:join',
        { topicId: 'topic-1' },
        expect.any(Function)
      );
    });

    it('should not emit when socket is not connected', () => {
      const mockSocket = createMockSocket(false);
      useAiGroupStore.setState({ socket: mockSocket as unknown as Socket });

      // Should not throw, but will schedule retry instead
      expect(() =>
        useAiGroupStore.getState().joinTopicRoom('topic-1')
      ).not.toThrow();
    });

    it('join response handler should update onlineUsers on success', () => {
      const mockSocket = createMockSocket(true);
      useAiGroupStore.setState({ socket: mockSocket as unknown as Socket });

      useAiGroupStore.getState().joinTopicRoom('topic-1');

      // Find and invoke the emit callback
      const emitArgs = mockSocket.emit.mock.calls.find(
        ([event]) => event === 'topic:join'
      );
      const callback = emitArgs?.[2] as (res: {
        success: boolean;
        onlineUsers: string[];
      }) => void;
      callback({ success: true, onlineUsers: ['user-1', 'user-2'] });

      const onlineUsers = useAiGroupStore.getState().onlineUsers;
      expect(onlineUsers.has('user-1')).toBe(true);
      expect(onlineUsers.has('user-2')).toBe(true);
    });
  });

  // ==================== leaveTopicRoom ====================

  describe('leaveTopicRoom', () => {
    it('should emit topic:leave when socket is connected', () => {
      const mockSocket = createMockSocket(true);
      useAiGroupStore.setState({ socket: mockSocket as unknown as Socket });

      useAiGroupStore.getState().leaveTopicRoom('topic-1');

      expect(mockSocket.emit).toHaveBeenCalledWith('topic:leave', {
        topicId: 'topic-1',
      });
    });

    it('should not emit when socket is not connected', () => {
      const mockSocket = createMockSocket(false);
      useAiGroupStore.setState({ socket: mockSocket as unknown as Socket });

      useAiGroupStore.getState().leaveTopicRoom('topic-1');

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should do nothing when no socket', () => {
      useAiGroupStore.setState({ socket: null });
      expect(() =>
        useAiGroupStore.getState().leaveTopicRoom('topic-1')
      ).not.toThrow();
    });
  });

  // ==================== sendTyping ====================

  describe('sendTyping', () => {
    it('should emit message:typing when socket is connected', () => {
      const mockSocket = createMockSocket(true);
      useAiGroupStore.setState({ socket: mockSocket as unknown as Socket });

      useAiGroupStore.getState().sendTyping('topic-1');

      expect(mockSocket.emit).toHaveBeenCalledWith('message:typing', {
        topicId: 'topic-1',
      });
    });

    it('should not emit when socket is not connected', () => {
      const mockSocket = createMockSocket(false);
      useAiGroupStore.setState({ socket: mockSocket as unknown as Socket });

      useAiGroupStore.getState().sendTyping('topic-1');

      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should do nothing when no socket', () => {
      useAiGroupStore.setState({ socket: null });
      expect(() =>
        useAiGroupStore.getState().sendTyping('topic-1')
      ).not.toThrow();
    });
  });

  // ==================== resetStore ====================

  describe('resetStore', () => {
    it('should disconnect socket and reset all state', () => {
      const mockSocket = createMockSocket(true);
      useAiGroupStore.setState({
        socket: mockSocket as unknown as Socket,
        isConnected: true,
        currentUserId: 'user-1',
        onlineUsers: new Set(['user-2']),
      });

      useAiGroupStore.getState().resetStore();

      expect(mockSocket.disconnect).toHaveBeenCalled();

      const state = useAiGroupStore.getState();
      expect(state.socket).toBeNull();
      expect(state.isConnected).toBe(false);
      expect(state.currentUserId).toBeNull();
      expect(state.onlineUsers.size).toBe(0);
    });
  });
});
