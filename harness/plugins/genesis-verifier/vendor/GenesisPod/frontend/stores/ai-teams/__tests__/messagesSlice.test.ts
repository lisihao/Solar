import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/ai-teams/api', () => ({
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  deleteMessage: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
  generateAIResponse: vi.fn(),
  getResources: vi.fn(),
  addResource: vi.fn(),
  removeResource: vi.fn(),
  // Other slice stubs
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
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthTokens: vi.fn().mockReturnValue({ accessToken: 'test-token' }),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn().mockReturnValue({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    io: {
      on: vi.fn(),
      engine: { on: vi.fn(), transport: { name: 'websocket' } },
    },
  }),
}));

import * as apiModule from '@/services/ai-teams/api';
import { useAiGroupStore } from '../index';

const api = apiModule as ReturnType<typeof vi.mocked<typeof apiModule>>;

const makeMessage = (
  overrides: Partial<{
    id: string;
    content: string;
    topicId: string;
    senderId: string;
    aiMemberId: string | null;
    reactions: unknown[];
  }> = {}
) => ({
  id: 'msg-1',
  content: 'Hello',
  topicId: 'topic-1',
  senderId: 'user-1',
  aiMemberId: null,
  reactions: [],
  ...overrides,
});

describe('messagesSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useAiGroupStore.getState().resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ==================== Initial State ====================

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAiGroupStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.isLoadingMessages).toBe(false);
      expect(state.hasMoreMessages).toBe(false);
      expect(state.nextCursor).toBeNull();
      expect(state.resources).toEqual([]);
      expect(state.isLoadingResources).toBe(false);
      expect(state.typingUsers).toBeInstanceOf(Set);
      expect(state.typingUsers.size).toBe(0);
      expect(state.typingAIs).toBeInstanceOf(Set);
      expect(state.typingAIs.size).toBe(0);
    });
  });

  // ==================== fetchMessages ====================

  describe('fetchMessages', () => {
    it('should set messages and pagination state on initial load', async () => {
      const mockMessages = [
        makeMessage({ id: 'msg-1' }),
        makeMessage({ id: 'msg-2' }),
      ];
      vi.mocked(api.getMessages).mockResolvedValueOnce({
        messages: mockMessages,
        hasMore: true,
        nextCursor: 'cursor-1',
      } as never);

      await useAiGroupStore.getState().fetchMessages('topic-1');

      const state = useAiGroupStore.getState();
      expect(state.messages).toEqual(mockMessages);
      expect(state.hasMoreMessages).toBe(true);
      expect(state.nextCursor).toBe('cursor-1');
      expect(state.isLoadingMessages).toBe(false);
    });

    it('should prepend older messages when cursor is provided (load more)', async () => {
      const existing = [makeMessage({ id: 'new-msg' })];
      useAiGroupStore.setState({ messages: existing as never[] });

      const olderMessages = [makeMessage({ id: 'old-msg' })];
      vi.mocked(api.getMessages).mockResolvedValueOnce({
        messages: olderMessages,
        hasMore: false,
        nextCursor: null,
      } as never);

      await useAiGroupStore.getState().fetchMessages('topic-1', 'cursor-1');

      const messages = useAiGroupStore.getState().messages;
      // Older messages should be prepended (cursor-based loading fetches older messages)
      expect(messages[0].id).toBe('old-msg');
      expect(messages[1].id).toBe('new-msg');
    });

    it('should trim messages to MAX_MESSAGES_IN_MEMORY (200) on load more', async () => {
      // Create 195 existing messages
      const existing = Array.from({ length: 195 }, (_, i) =>
        makeMessage({ id: `existing-${i}` })
      );
      useAiGroupStore.setState({ messages: existing as never[] });

      // Fetch 10 more (total would be 205, exceeds 200)
      const newMessages = Array.from({ length: 10 }, (_, i) =>
        makeMessage({ id: `new-${i}` })
      );
      vi.mocked(api.getMessages).mockResolvedValueOnce({
        messages: newMessages,
        hasMore: false,
        nextCursor: null,
      } as never);

      await useAiGroupStore.getState().fetchMessages('topic-1', 'cursor-1');

      expect(useAiGroupStore.getState().messages).toHaveLength(200);
    });

    it('should clear loading on error', async () => {
      vi.mocked(api.getMessages).mockRejectedValueOnce(
        new Error('Fetch failed')
      );

      await useAiGroupStore.getState().fetchMessages('topic-1');

      expect(useAiGroupStore.getState().isLoadingMessages).toBe(false);
    });

    it('should replace messages when no cursor provided', async () => {
      useAiGroupStore.setState({
        messages: [makeMessage({ id: 'old' })] as never[],
      });

      vi.mocked(api.getMessages).mockResolvedValueOnce({
        messages: [makeMessage({ id: 'new' })],
        hasMore: false,
        nextCursor: null,
      } as never);

      await useAiGroupStore.getState().fetchMessages('topic-1');

      const messages = useAiGroupStore.getState().messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('new');
    });
  });

  // ==================== sendMessage ====================

  describe('sendMessage', () => {
    it('should call api.sendMessage and return message', async () => {
      const mockMessage = makeMessage({ id: 'msg-sent' });
      vi.mocked(api.sendMessage).mockResolvedValueOnce(mockMessage as never);

      const result = await useAiGroupStore
        .getState()
        .sendMessage('topic-1', { content: 'Hello' } as never);

      expect(result).toEqual(mockMessage);
      expect(vi.mocked(api.sendMessage)).toHaveBeenCalledWith('topic-1', {
        content: 'Hello',
      });
    });

    it('should not add message to state directly (WS handles it)', async () => {
      const mockMessage = makeMessage({ id: 'msg-sent' });
      vi.mocked(api.sendMessage).mockResolvedValueOnce(mockMessage as never);

      await useAiGroupStore
        .getState()
        .sendMessage('topic-1', { content: 'Hello' } as never);

      // Messages should remain empty since WS handles the state update
      expect(useAiGroupStore.getState().messages).toHaveLength(0);
    });
  });

  // ==================== deleteMessage ====================

  describe('deleteMessage', () => {
    it('should remove message from state', async () => {
      const msg1 = makeMessage({ id: 'msg-1' });
      const msg2 = makeMessage({ id: 'msg-2' });
      useAiGroupStore.setState({ messages: [msg1, msg2] as never[] });
      vi.mocked(api.deleteMessage).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().deleteMessage('topic-1', 'msg-1');

      const messages = useAiGroupStore.getState().messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-2');
    });
  });

  // ==================== generateAIResponse ====================

  describe('generateAIResponse', () => {
    it('should add AI to typingAIs before API call', async () => {
      let typingDuringCall = false;
      vi.mocked(api.generateAIResponse).mockImplementationOnce(async () => {
        typingDuringCall = useAiGroupStore.getState().typingAIs.has('ai-1');
        return makeMessage({ id: 'ai-msg' }) as never;
      });

      await useAiGroupStore.getState().generateAIResponse('topic-1', 'ai-1');

      expect(typingDuringCall).toBe(true);
    });

    it('should remove AI from typingAIs after response', async () => {
      vi.mocked(api.generateAIResponse).mockResolvedValueOnce(
        makeMessage({ id: 'ai-msg' }) as never
      );

      await useAiGroupStore.getState().generateAIResponse('topic-1', 'ai-1');

      expect(useAiGroupStore.getState().typingAIs.has('ai-1')).toBe(false);
    });

    it('should add AI message to state', async () => {
      const aiMessage = makeMessage({ id: 'ai-msg', aiMemberId: 'ai-1' });
      vi.mocked(api.generateAIResponse).mockResolvedValueOnce(
        aiMessage as never
      );

      await useAiGroupStore.getState().generateAIResponse('topic-1', 'ai-1');

      expect(useAiGroupStore.getState().messages).toContainEqual(aiMessage);
    });

    it('should remove AI from typingAIs even on error', async () => {
      vi.mocked(api.generateAIResponse).mockRejectedValueOnce(
        new Error('AI error')
      );

      await expect(
        useAiGroupStore.getState().generateAIResponse('topic-1', 'ai-1')
      ).rejects.toThrow('AI error');

      expect(useAiGroupStore.getState().typingAIs.has('ai-1')).toBe(false);
    });
  });

  // ==================== Resources ====================

  describe('fetchResources', () => {
    it('should set resources on success', async () => {
      const mockResources = [{ id: 'r1', title: 'Resource 1' }];
      vi.mocked(api.getResources).mockResolvedValueOnce(mockResources as never);

      await useAiGroupStore.getState().fetchResources('topic-1');

      expect(useAiGroupStore.getState().resources).toEqual(mockResources);
      expect(useAiGroupStore.getState().isLoadingResources).toBe(false);
    });

    it('should clear loading on error', async () => {
      vi.mocked(api.getResources).mockRejectedValueOnce(
        new Error('Fetch error')
      );

      await useAiGroupStore.getState().fetchResources('topic-1');

      expect(useAiGroupStore.getState().isLoadingResources).toBe(false);
    });
  });

  describe('addResource', () => {
    it('should prepend resource to state', async () => {
      const existing = { id: 'r1', title: 'Existing' };
      const newResource = { id: 'r2', title: 'New' };
      useAiGroupStore.setState({ resources: [existing as never] });
      vi.mocked(api.addResource).mockResolvedValueOnce(newResource as never);

      await useAiGroupStore
        .getState()
        .addResource('topic-1', { title: 'New' } as never);

      const resources = useAiGroupStore.getState().resources;
      expect(resources[0]).toEqual(newResource);
      expect(resources).toHaveLength(2);
    });
  });

  describe('removeResource', () => {
    it('should remove resource from state', async () => {
      const r1 = { id: 'r1' };
      const r2 = { id: 'r2' };
      useAiGroupStore.setState({ resources: [r1, r2] as never[] });
      vi.mocked(api.removeResource).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().removeResource('topic-1', 'r1');

      const resources = useAiGroupStore.getState().resources;
      expect(resources).toHaveLength(1);
      expect(resources[0].id).toBe('r2');
    });
  });

  // ==================== clearMessages ====================

  describe('clearMessages', () => {
    it('should clear messages, hasMore, and nextCursor', () => {
      useAiGroupStore.setState({
        messages: [makeMessage() as never],
        hasMoreMessages: true,
        nextCursor: 'cursor-1',
      });

      useAiGroupStore.getState().clearMessages();

      const state = useAiGroupStore.getState();
      expect(state.messages).toEqual([]);
      expect(state.hasMoreMessages).toBe(false);
      expect(state.nextCursor).toBeNull();
    });
  });

  // ==================== WebSocket Handlers ====================

  describe('handleMessageNew', () => {
    it('should append new message to state', () => {
      const msg = makeMessage({ id: 'new-msg' });
      useAiGroupStore.getState().handleMessageNew(msg as never);
      expect(useAiGroupStore.getState().messages).toContainEqual(msg);
    });

    it('should not duplicate messages with same id', () => {
      const msg = makeMessage({ id: 'msg-1' });
      useAiGroupStore.setState({ messages: [msg as never] });

      useAiGroupStore.getState().handleMessageNew(msg as never);

      expect(useAiGroupStore.getState().messages).toHaveLength(1);
    });

    it('should trim to MAX_MESSAGES_IN_MEMORY when limit exceeded', () => {
      const existing = Array.from({ length: 200 }, (_, i) =>
        makeMessage({ id: `msg-${i}` })
      );
      useAiGroupStore.setState({ messages: existing as never[] });

      const newMsg = makeMessage({ id: 'newest' });
      useAiGroupStore.getState().handleMessageNew(newMsg as never);

      expect(useAiGroupStore.getState().messages).toHaveLength(200);
      // Newest message should be retained
      expect(useAiGroupStore.getState().messages[199].id).toBe('newest');
    });
  });

  describe('handleMessageDelete', () => {
    it('should remove message from state', () => {
      const msg1 = makeMessage({ id: 'msg-1' });
      const msg2 = makeMessage({ id: 'msg-2' });
      useAiGroupStore.setState({ messages: [msg1, msg2] as never[] });

      useAiGroupStore.getState().handleMessageDelete('msg-1');

      const messages = useAiGroupStore.getState().messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-2');
    });
  });

  describe('handleReactionAdd', () => {
    it('should add reaction to message', () => {
      const msg = makeMessage({ id: 'msg-1', reactions: [] });
      useAiGroupStore.setState({ messages: [msg as never] });

      useAiGroupStore.getState().handleReactionAdd('msg-1', 'user-1', '');

      const reactions = useAiGroupStore.getState().messages[0].reactions;
      expect(reactions).toHaveLength(1);
      expect(reactions[0]).toMatchObject({
        messageId: 'msg-1',
        userId: 'user-1',
        emoji: '',
      });
    });

    it('should not add duplicate reactions', () => {
      const existingReaction = {
        id: 'r1',
        messageId: 'msg-1',
        userId: 'user-1',
        emoji: '',
        createdAt: '',
      };
      const msg = makeMessage({ id: 'msg-1', reactions: [existingReaction] });
      useAiGroupStore.setState({ messages: [msg as never] });

      useAiGroupStore.getState().handleReactionAdd('msg-1', 'user-1', '');

      expect(useAiGroupStore.getState().messages[0].reactions).toHaveLength(1);
    });
  });

  describe('handleReactionRemove', () => {
    it('should remove reaction from message', () => {
      const reaction = {
        id: 'r1',
        messageId: 'msg-1',
        userId: 'user-1',
        emoji: '',
        createdAt: '',
      };
      const msg = makeMessage({ id: 'msg-1', reactions: [reaction] });
      useAiGroupStore.setState({ messages: [msg as never] });

      useAiGroupStore.getState().handleReactionRemove('msg-1', 'user-1', '');

      expect(useAiGroupStore.getState().messages[0].reactions).toHaveLength(0);
    });

    it('should only remove matching reaction', () => {
      const r1 = {
        id: 'r1',
        messageId: 'msg-1',
        userId: 'user-1',
        emoji: '',
        createdAt: '',
      };
      const r2 = {
        id: 'r2',
        messageId: 'msg-1',
        userId: 'user-2',
        emoji: '',
        createdAt: '',
      };
      const msg = makeMessage({ id: 'msg-1', reactions: [r1, r2] });
      useAiGroupStore.setState({ messages: [msg as never] });

      useAiGroupStore.getState().handleReactionRemove('msg-1', 'user-1', '');

      expect(useAiGroupStore.getState().messages[0].reactions).toHaveLength(1);
      expect(useAiGroupStore.getState().messages[0].reactions[0]).toEqual(r2);
    });
  });

  describe('handleMemberTyping', () => {
    it('should add userId to typingUsers', () => {
      useAiGroupStore.getState().handleMemberTyping('user-1');
      expect(useAiGroupStore.getState().typingUsers.has('user-1')).toBe(true);
    });

    it('should auto-remove user from typingUsers after 3 seconds', () => {
      useAiGroupStore.getState().handleMemberTyping('user-1');
      expect(useAiGroupStore.getState().typingUsers.has('user-1')).toBe(true);

      vi.advanceTimersByTime(3000);

      expect(useAiGroupStore.getState().typingUsers.has('user-1')).toBe(false);
    });
  });

  describe('handleAITyping', () => {
    it('should add aiMemberId to typingAIs', () => {
      useAiGroupStore.getState().handleAITyping('ai-1');
      expect(useAiGroupStore.getState().typingAIs.has('ai-1')).toBe(true);
    });

    it('should not remove after timeout (unlike human typing)', () => {
      useAiGroupStore.getState().handleAITyping('ai-1');
      vi.advanceTimersByTime(10000);
      expect(useAiGroupStore.getState().typingAIs.has('ai-1')).toBe(true);
    });
  });

  describe('handleAIResponse', () => {
    it('should remove aiMemberId from typingAIs', () => {
      useAiGroupStore.setState({
        typingAIs: new Set(['ai-1', 'ai-2']),
      });

      useAiGroupStore.getState().handleAIResponse('ai-1');

      const typingAIs = useAiGroupStore.getState().typingAIs;
      expect(typingAIs.has('ai-1')).toBe(false);
      expect(typingAIs.has('ai-2')).toBe(true);
    });
  });

  describe('handleAIError', () => {
    it('should remove aiMemberId from typingAIs', () => {
      useAiGroupStore.setState({ typingAIs: new Set(['ai-1']) });

      useAiGroupStore.getState().handleAIError('ai-1');

      expect(useAiGroupStore.getState().typingAIs.has('ai-1')).toBe(false);
    });
  });
});
