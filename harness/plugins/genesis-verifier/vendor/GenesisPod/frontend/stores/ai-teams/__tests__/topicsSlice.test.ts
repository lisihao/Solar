import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/ai-teams/api', () => ({
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

const makeTopic = (
  overrides: Partial<{
    id: string;
    name: string;
    type: string;
    members: unknown[];
    aiMembers: unknown[];
  }> = {}
) => ({
  id: 'topic-1',
  name: 'Test Topic',
  type: 'GENERAL',
  members: [],
  aiMembers: [],
  ...overrides,
});

describe('topicsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiGroupStore.getState().resetStore();
  });

  // ==================== Initial State ====================

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAiGroupStore.getState();
      expect(state.topics).toEqual([]);
      expect(state.currentTopic).toBeNull();
      expect(state.isLoadingTopics).toBe(false);
    });
  });

  // ==================== fetchTopics ====================

  describe('fetchTopics', () => {
    it('should set topics and clear loading on success', async () => {
      const mockTopics = [makeTopic({ id: 't1' }), makeTopic({ id: 't2' })];
      vi.mocked(api.getTopics).mockResolvedValueOnce(mockTopics as never);

      await useAiGroupStore.getState().fetchTopics();

      const state = useAiGroupStore.getState();
      expect(state.topics).toEqual(mockTopics);
      expect(state.isLoadingTopics).toBe(false);
    });

    it('should set isLoadingTopics true during fetch', async () => {
      let resolve: (v: unknown) => void;
      const promise = new Promise((r) => {
        resolve = r;
      });
      vi.mocked(api.getTopics).mockReturnValueOnce(promise as never);

      const fetchPromise = useAiGroupStore.getState().fetchTopics();
      expect(useAiGroupStore.getState().isLoadingTopics).toBe(true);

      resolve!([]);
      await fetchPromise;
    });

    it('should pass options to api.getTopics', async () => {
      vi.mocked(api.getTopics).mockResolvedValueOnce([] as never);

      await useAiGroupStore
        .getState()
        .fetchTopics({ type: 'GENERAL' as never });

      expect(vi.mocked(api.getTopics)).toHaveBeenCalledWith({
        type: 'GENERAL',
      });
    });

    it('should clear loading on error without throwing', async () => {
      vi.mocked(api.getTopics).mockRejectedValueOnce(new Error('Fetch failed'));

      await useAiGroupStore.getState().fetchTopics();

      expect(useAiGroupStore.getState().isLoadingTopics).toBe(false);
    });
  });

  // ==================== fetchTopic ====================

  describe('fetchTopic', () => {
    it('should set currentTopic and update topics list', async () => {
      const existing = makeTopic({ id: 't1', name: 'Old' });
      const updated = makeTopic({ id: 't1', name: 'Updated' });
      useAiGroupStore.setState({ topics: [existing as never] });
      vi.mocked(api.getTopicById).mockResolvedValueOnce(updated as never);

      await useAiGroupStore.getState().fetchTopic('t1');

      const state = useAiGroupStore.getState();
      expect(state.currentTopic).toEqual(updated);
      expect(state.topics[0]).toEqual(updated);
    });

    it('should handle error without throwing', async () => {
      vi.mocked(api.getTopicById).mockRejectedValueOnce(new Error('Not found'));

      await useAiGroupStore.getState().fetchTopic('t1');
      // Should not throw
    });
  });

  // ==================== createTopic ====================

  describe('createTopic', () => {
    it('should prepend topic and return it', async () => {
      const existing = makeTopic({ id: 't1' });
      const newTopic = makeTopic({ id: 't2', name: 'New Topic' });
      useAiGroupStore.setState({ topics: [existing as never] });
      vi.mocked(api.createTopic).mockResolvedValueOnce(newTopic as never);

      const result = await useAiGroupStore
        .getState()
        .createTopic({ name: 'New Topic' } as never);

      expect(result).toEqual(newTopic);
      const topics = useAiGroupStore.getState().topics;
      expect(topics[0]).toEqual(newTopic);
      expect(topics).toHaveLength(2);
    });
  });

  // ==================== updateTopic ====================

  describe('updateTopic', () => {
    it('should update topic in list', async () => {
      const existing = makeTopic({ id: 't1', name: 'Old name' });
      const updatedData = { name: 'New name' };
      useAiGroupStore.setState({ topics: [existing as never] });
      vi.mocked(api.updateTopic).mockResolvedValueOnce(updatedData as never);

      await useAiGroupStore
        .getState()
        .updateTopic('t1', { name: 'New name' } as never);

      const topic = useAiGroupStore.getState().topics[0];
      expect(topic.name).toBe('New name');
    });

    it('should update currentTopic if id matches', async () => {
      const existing = makeTopic({ id: 't1', name: 'Old' });
      useAiGroupStore.setState({
        topics: [existing as never],
        currentTopic: existing as never,
      });
      vi.mocked(api.updateTopic).mockResolvedValueOnce({
        name: 'Updated',
      } as never);

      await useAiGroupStore
        .getState()
        .updateTopic('t1', { name: 'Updated' } as never);

      expect(useAiGroupStore.getState().currentTopic?.name).toBe('Updated');
    });

    it('should not update currentTopic if id does not match', async () => {
      const t1 = makeTopic({ id: 't1' });
      const t2 = makeTopic({ id: 't2', name: 'Other' });
      useAiGroupStore.setState({
        topics: [t1 as never],
        currentTopic: t2 as never,
      });
      vi.mocked(api.updateTopic).mockResolvedValueOnce({
        name: 'Updated t1',
      } as never);

      await useAiGroupStore
        .getState()
        .updateTopic('t1', { name: 'Updated t1' } as never);

      expect(useAiGroupStore.getState().currentTopic?.name).toBe('Other');
    });
  });

  // ==================== deleteTopic ====================

  describe('deleteTopic', () => {
    it('should remove topic from list', async () => {
      const t1 = makeTopic({ id: 't1' });
      const t2 = makeTopic({ id: 't2' });
      useAiGroupStore.setState({ topics: [t1, t2] as never[] });
      vi.mocked(api.deleteTopic).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().deleteTopic('t1');

      const topics = useAiGroupStore.getState().topics;
      expect(topics).toHaveLength(1);
      expect(topics[0].id).toBe('t2');
    });

    it('should clear currentTopic if it matches deleted id', async () => {
      const t1 = makeTopic({ id: 't1' });
      useAiGroupStore.setState({
        topics: [t1 as never],
        currentTopic: t1 as never,
      });
      vi.mocked(api.deleteTopic).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().deleteTopic('t1');

      expect(useAiGroupStore.getState().currentTopic).toBeNull();
    });

    it('should not clear currentTopic if a different id is deleted', async () => {
      const t1 = makeTopic({ id: 't1' });
      const t2 = makeTopic({ id: 't2' });
      useAiGroupStore.setState({
        topics: [t1, t2] as never[],
        currentTopic: t2 as never,
      });
      vi.mocked(api.deleteTopic).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().deleteTopic('t1');

      expect(useAiGroupStore.getState().currentTopic?.id).toBe('t2');
    });
  });

  // ==================== setCurrentTopic ====================

  describe('setCurrentTopic', () => {
    it('should set currentTopic', () => {
      const topic = makeTopic({ id: 't1' });
      useAiGroupStore.getState().setCurrentTopic(topic as never);
      expect(useAiGroupStore.getState().currentTopic).toEqual(topic);
    });

    it('should set currentTopic to null', () => {
      useAiGroupStore.setState({ currentTopic: makeTopic() as never });
      useAiGroupStore.getState().setCurrentTopic(null);
      expect(useAiGroupStore.getState().currentTopic).toBeNull();
    });
  });

  // ==================== addMember ====================

  describe('addMember', () => {
    it('should call api.addMember for non-email user', async () => {
      vi.mocked(api.addMember).mockResolvedValueOnce(undefined as never);
      vi.mocked(api.getTopicById).mockResolvedValueOnce(makeTopic() as never);

      await useAiGroupStore.getState().addMember('t1', 'user-id-123');

      expect(vi.mocked(api.addMember)).toHaveBeenCalledWith('t1', {
        userId: 'user-id-123',
        role: undefined,
      });
    });

    it('should call api.addMemberByEmail for email input', async () => {
      vi.mocked(api.addMemberByEmail).mockResolvedValueOnce(undefined as never);
      vi.mocked(api.getTopicById).mockResolvedValueOnce(makeTopic() as never);

      await useAiGroupStore
        .getState()
        .addMember('t1', 'user@example.com', 'ADMIN' as never);

      expect(vi.mocked(api.addMemberByEmail)).toHaveBeenCalledWith(
        't1',
        'user@example.com',
        'ADMIN'
      );
    });
  });

  // ==================== removeMember ====================

  describe('removeMember', () => {
    it('should call api.removeMember and then fetchTopic', async () => {
      vi.mocked(api.removeMember).mockResolvedValueOnce(undefined as never);
      vi.mocked(api.getTopicById).mockResolvedValueOnce(makeTopic() as never);

      await useAiGroupStore.getState().removeMember('t1', 'member-1');

      expect(vi.mocked(api.removeMember)).toHaveBeenCalledWith(
        't1',
        'member-1'
      );
      expect(vi.mocked(api.getTopicById)).toHaveBeenCalledWith('t1');
    });
  });

  // ==================== leaveTopicAsMember ====================

  describe('leaveTopicAsMember', () => {
    it('should remove topic from list and clear currentTopic', async () => {
      const t1 = makeTopic({ id: 't1' });
      const t2 = makeTopic({ id: 't2' });
      useAiGroupStore.setState({
        topics: [t1, t2] as never[],
        currentTopic: t1 as never,
      });
      vi.mocked(api.leaveTopic).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().leaveTopicAsMember('t1');

      expect(vi.mocked(api.leaveTopic)).toHaveBeenCalledWith('t1');
      const state = useAiGroupStore.getState();
      expect(state.topics).toHaveLength(1);
      expect(state.currentTopic).toBeNull();
    });
  });

  // ==================== AI Member actions ====================

  describe('addAIMember', () => {
    it('should call api.addAIMember and refresh topic', async () => {
      vi.mocked(api.addAIMember).mockResolvedValueOnce(undefined as never);
      vi.mocked(api.getTopicById).mockResolvedValueOnce(makeTopic() as never);

      await useAiGroupStore
        .getState()
        .addAIMember('t1', { aiMemberId: 'ai-1' } as never);

      expect(vi.mocked(api.addAIMember)).toHaveBeenCalledWith('t1', {
        aiMemberId: 'ai-1',
      });
      expect(vi.mocked(api.getTopicById)).toHaveBeenCalledWith('t1');
    });
  });

  describe('updateAIMember', () => {
    it('should call api.updateAIMember and refresh topic', async () => {
      vi.mocked(api.updateAIMember).mockResolvedValueOnce(undefined as never);
      vi.mocked(api.getTopicById).mockResolvedValueOnce(makeTopic() as never);

      await useAiGroupStore
        .getState()
        .updateAIMember('t1', 'ai-1', { role: 'MEMBER' } as never);

      expect(vi.mocked(api.updateAIMember)).toHaveBeenCalledWith('t1', 'ai-1', {
        role: 'MEMBER',
      });
    });
  });

  describe('removeAIMember', () => {
    it('should call api.removeAIMember and refresh topic', async () => {
      vi.mocked(api.removeAIMember).mockResolvedValueOnce(undefined as never);
      vi.mocked(api.getTopicById).mockResolvedValueOnce(makeTopic() as never);

      await useAiGroupStore.getState().removeAIMember('t1', 'ai-1');

      expect(vi.mocked(api.removeAIMember)).toHaveBeenCalledWith('t1', 'ai-1');
    });
  });
});
