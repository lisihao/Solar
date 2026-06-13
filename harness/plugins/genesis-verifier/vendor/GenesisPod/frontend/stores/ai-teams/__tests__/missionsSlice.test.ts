import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  // Topics slice stubs
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
  // Messages slice stubs
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

const makeMission = (
  overrides: Partial<{
    id: string;
    status: string;
    tasks: unknown[];
    completedTasks: number;
    totalTasks: number;
    progressPercent: number;
  }> = {}
) => ({
  id: 'mission-1',
  status: 'PENDING',
  tasks: [],
  completedTasks: 0,
  totalTasks: 0,
  progressPercent: 0,
  ...overrides,
});

describe('missionsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiGroupStore.getState().resetStore();
  });

  // ==================== Initial State ====================

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAiGroupStore.getState();
      expect(state.missions).toEqual([]);
      expect(state.currentMission).toBeNull();
      expect(state.isLoadingMissions).toBe(false);
      expect(state.teamMembers).toEqual([]);
      expect(state.isLoadingTeamMembers).toBe(false);
    });
  });

  // ==================== fetchMissions ====================

  describe('fetchMissions', () => {
    it('should set missions from array response', async () => {
      const mockMissions = [
        makeMission({ id: 'm1' }),
        makeMission({ id: 'm2' }),
      ];
      vi.mocked(api.getMissions).mockResolvedValueOnce(mockMissions as never);

      await useAiGroupStore.getState().fetchMissions('topic-1');

      expect(useAiGroupStore.getState().missions).toEqual(mockMissions);
      expect(useAiGroupStore.getState().isLoadingMissions).toBe(false);
    });

    it('should set missions from response with missions property', async () => {
      const mockMissions = [makeMission({ id: 'm1' })];
      vi.mocked(api.getMissions).mockResolvedValueOnce({
        missions: mockMissions,
      } as never);

      await useAiGroupStore.getState().fetchMissions('topic-1');

      expect(useAiGroupStore.getState().missions).toEqual(mockMissions);
    });

    it('should show loading spinner only when no existing data', async () => {
      vi.mocked(api.getMissions).mockResolvedValueOnce([] as never);

      useAiGroupStore.setState({ missions: [] });
      const fetchPromise = useAiGroupStore.getState().fetchMissions('topic-1');
      expect(useAiGroupStore.getState().isLoadingMissions).toBe(true);
      await fetchPromise;
      expect(useAiGroupStore.getState().isLoadingMissions).toBe(false);
    });

    it('should not set loading when data already exists', async () => {
      useAiGroupStore.setState({ missions: [makeMission() as never] });
      vi.mocked(api.getMissions).mockResolvedValueOnce([
        makeMission(),
      ] as never);

      useAiGroupStore.getState().fetchMissions('topic-1');
      // Should not have set isLoadingMissions=true
      expect(useAiGroupStore.getState().isLoadingMissions).toBe(false);

      await vi.waitFor(() => {
        // just wait for fetch to complete
      });
    });

    it('should keep existing data on error', async () => {
      const existingMission = makeMission({ id: 'existing' });
      useAiGroupStore.setState({ missions: [existingMission as never] });
      vi.mocked(api.getMissions).mockRejectedValueOnce(
        new Error('Fetch failed')
      );

      await useAiGroupStore.getState().fetchMissions('topic-1');

      expect(useAiGroupStore.getState().missions).toEqual([existingMission]);
    });
  });

  // ==================== fetchMission ====================

  describe('fetchMission', () => {
    it('should set currentMission and update missions list', async () => {
      const existing = makeMission({ id: 'm1', status: 'PENDING' });
      const updated = makeMission({ id: 'm1', status: 'RUNNING' });
      useAiGroupStore.setState({ missions: [existing as never] });
      vi.mocked(api.getMissionById).mockResolvedValueOnce(updated as never);

      await useAiGroupStore.getState().fetchMission('topic-1', 'm1');

      const state = useAiGroupStore.getState();
      expect(state.currentMission).toEqual(updated);
      expect(state.missions[0]).toEqual(updated);
    });
  });

  // ==================== createMission ====================

  describe('createMission', () => {
    it('should prepend mission and set as currentMission', async () => {
      const existing = makeMission({ id: 'm1' });
      const newMission = makeMission({ id: 'm2', status: 'PENDING' });
      useAiGroupStore.setState({ missions: [existing as never] });
      vi.mocked(api.createMission).mockResolvedValueOnce(newMission as never);

      const result = await useAiGroupStore
        .getState()
        .createMission('topic-1', { title: 'New mission' } as never);

      expect(result).toEqual(newMission);
      const state = useAiGroupStore.getState();
      expect(state.missions[0]).toEqual(newMission);
      expect(state.currentMission).toEqual(newMission);
      expect(state.missions).toHaveLength(2);
    });
  });

  // ==================== cancelMission ====================

  describe('cancelMission', () => {
    it('should update mission status in list and currentMission', async () => {
      const original = makeMission({ id: 'm1', status: 'RUNNING' });
      const cancelled = makeMission({ id: 'm1', status: 'CANCELLED' });
      useAiGroupStore.setState({
        missions: [original as never],
        currentMission: original as never,
      });
      vi.mocked(api.cancelMission).mockResolvedValueOnce(cancelled as never);

      await useAiGroupStore.getState().cancelMission('topic-1', 'm1');

      const state = useAiGroupStore.getState();
      expect(state.missions[0]).toEqual(cancelled);
      expect(state.currentMission).toEqual(cancelled);
    });
  });

  // ==================== deleteMission ====================

  describe('deleteMission', () => {
    it('should remove mission from list', async () => {
      const m1 = makeMission({ id: 'm1' });
      const m2 = makeMission({ id: 'm2' });
      useAiGroupStore.setState({ missions: [m1, m2] as never[] });
      vi.mocked(api.deleteMission).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().deleteMission('topic-1', 'm1');

      const missions = useAiGroupStore.getState().missions;
      expect(missions).toHaveLength(1);
      expect(missions[0].id).toBe('m2');
    });

    it('should clear currentMission if it matches deleted id', async () => {
      const m1 = makeMission({ id: 'm1' });
      useAiGroupStore.setState({
        missions: [m1 as never],
        currentMission: m1 as never,
      });
      vi.mocked(api.deleteMission).mockResolvedValueOnce(undefined as never);

      await useAiGroupStore.getState().deleteMission('topic-1', 'm1');

      expect(useAiGroupStore.getState().currentMission).toBeNull();
    });
  });

  // ==================== setCurrentMission ====================

  describe('setCurrentMission', () => {
    it('should set currentMission', () => {
      const mission = makeMission({ id: 'm1' });
      useAiGroupStore.getState().setCurrentMission(mission as never);
      expect(useAiGroupStore.getState().currentMission).toEqual(mission);
    });

    it('should set currentMission to null', () => {
      useAiGroupStore.setState({ currentMission: makeMission() as never });
      useAiGroupStore.getState().setCurrentMission(null);
      expect(useAiGroupStore.getState().currentMission).toBeNull();
    });
  });

  // ==================== fetchTeamMembers ====================

  describe('fetchTeamMembers', () => {
    it('should set teamMembers from response.all', async () => {
      const members = [{ id: 'ai-1', name: 'Agent A' }];
      vi.mocked(api.getTeamMembers).mockResolvedValueOnce({
        all: members,
        leader: null,
        members: [],
      } as never);

      await useAiGroupStore.getState().fetchTeamMembers('topic-1');

      expect(useAiGroupStore.getState().teamMembers).toEqual(members);
      expect(useAiGroupStore.getState().isLoadingTeamMembers).toBe(false);
    });

    it('should set empty array on error', async () => {
      vi.mocked(api.getTeamMembers).mockRejectedValueOnce(
        new Error('Fetch error')
      );

      await useAiGroupStore.getState().fetchTeamMembers('topic-1');

      expect(useAiGroupStore.getState().teamMembers).toEqual([]);
      expect(useAiGroupStore.getState().isLoadingTeamMembers).toBe(false);
    });
  });

  // ==================== WebSocket Handlers ====================

  describe('handleMissionCreated', () => {
    it('should prepend mission to list, deduplicating by id', () => {
      const existing = makeMission({ id: 'm1' });
      useAiGroupStore.setState({ missions: [existing as never] });

      const newMission = makeMission({ id: 'm2', status: 'PENDING' });
      useAiGroupStore.getState().handleMissionCreated(newMission as never);

      const missions = useAiGroupStore.getState().missions;
      expect(missions[0]).toEqual(newMission);
      expect(missions).toHaveLength(2);
    });

    it('should deduplicate if mission id already exists', () => {
      const existing = makeMission({ id: 'm1', status: 'PENDING' });
      useAiGroupStore.setState({ missions: [existing as never] });

      const updated = makeMission({ id: 'm1', status: 'RUNNING' });
      useAiGroupStore.getState().handleMissionCreated(updated as never);

      const missions = useAiGroupStore.getState().missions;
      expect(missions).toHaveLength(1);
      expect(missions[0]).toEqual(updated);
    });
  });

  describe('handleMissionStatusChanged', () => {
    it('should update mission status in list', () => {
      const mission = makeMission({ id: 'm1', status: 'PENDING' });
      useAiGroupStore.setState({ missions: [mission as never] });

      useAiGroupStore
        .getState()
        .handleMissionStatusChanged('m1', 'RUNNING' as never);

      expect(useAiGroupStore.getState().missions[0].status).toBe('RUNNING');
    });

    it('should update totalTasks when provided', () => {
      const mission = makeMission({ id: 'm1', totalTasks: 0 });
      useAiGroupStore.setState({ missions: [mission as never] });

      useAiGroupStore
        .getState()
        .handleMissionStatusChanged('m1', 'RUNNING' as never, 5);

      expect(useAiGroupStore.getState().missions[0].totalTasks).toBe(5);
    });

    it('should update tasks when provided', () => {
      const mission = makeMission({ id: 'm1', tasks: [] });
      const tasks = [{ id: 't1', status: 'PENDING' }];
      useAiGroupStore.setState({ missions: [mission as never] });

      useAiGroupStore
        .getState()
        .handleMissionStatusChanged(
          'm1',
          'RUNNING' as never,
          undefined,
          tasks as never
        );

      expect(useAiGroupStore.getState().missions[0].tasks).toEqual(tasks);
    });

    it('should also update currentMission if id matches', () => {
      const mission = makeMission({ id: 'm1', status: 'PENDING' });
      useAiGroupStore.setState({
        missions: [mission as never],
        currentMission: mission as never,
      });

      useAiGroupStore
        .getState()
        .handleMissionStatusChanged('m1', 'COMPLETED' as never);

      expect(useAiGroupStore.getState().currentMission?.status).toBe(
        'COMPLETED'
      );
    });

    it('should not update currentMission if id does not match', () => {
      const mission = makeMission({ id: 'm1', status: 'PENDING' });
      const other = makeMission({ id: 'm2', status: 'PENDING' });
      useAiGroupStore.setState({
        missions: [mission as never],
        currentMission: other as never,
      });

      useAiGroupStore
        .getState()
        .handleMissionStatusChanged('m1', 'COMPLETED' as never);

      expect(useAiGroupStore.getState().currentMission?.status).toBe('PENDING');
    });
  });

  describe('handleMissionProgressUpdated', () => {
    it('should update completedTasks, totalTasks, and progressPercent', () => {
      const mission = makeMission({
        id: 'm1',
        completedTasks: 0,
        totalTasks: 5,
        progressPercent: 0,
      });
      useAiGroupStore.setState({
        missions: [mission as never],
        currentMission: mission as never,
      });

      useAiGroupStore.getState().handleMissionProgressUpdated('m1', 3, 5, 60);

      const state = useAiGroupStore.getState();
      expect(state.missions[0].completedTasks).toBe(3);
      expect(state.missions[0].totalTasks).toBe(5);
      expect(state.missions[0].progressPercent).toBe(60);
      expect(state.currentMission?.completedTasks).toBe(3);
    });
  });

  describe('handleTaskCompleted', () => {
    it('should update task status to AWAITING_REVIEW', () => {
      const task = { id: 't1', status: 'RUNNING' };
      const mission = makeMission({ id: 'm1', tasks: [task] });
      useAiGroupStore.setState({ missions: [mission as never] });

      useAiGroupStore.getState().handleTaskCompleted('m1', 't1', 'agent-1');

      const updatedTask = useAiGroupStore.getState().missions[0].tasks?.[0];
      expect(updatedTask?.status).toBe('AWAITING_REVIEW');
    });
  });

  describe('handleTaskStatusUpdate', () => {
    it('should update task status and result', () => {
      const task = {
        id: 't1',
        status: 'RUNNING',
        result: null,
        leaderFeedback: null,
      };
      const mission = makeMission({ id: 'm1', tasks: [task] });
      useAiGroupStore.setState({ missions: [mission as never] });

      useAiGroupStore
        .getState()
        .handleTaskStatusUpdate(
          'm1',
          't1',
          'COMPLETED' as never,
          'Task done',
          'Good work'
        );

      const updatedTask = useAiGroupStore.getState().missions[0].tasks?.[0];
      expect(updatedTask?.status).toBe('COMPLETED');
      expect(updatedTask?.result).toBe('Task done');
      expect(updatedTask?.leaderFeedback).toBe('Good work');
    });
  });

  describe('handleMissionCompleted', () => {
    it('should set mission status to COMPLETED with finalResult and summary', () => {
      const mission = makeMission({ id: 'm1', status: 'RUNNING' });
      useAiGroupStore.setState({
        missions: [mission as never],
        currentMission: mission as never,
      });

      useAiGroupStore
        .getState()
        .handleMissionCompleted(
          'm1',
          'Final analysis report',
          'Mission accomplished',
          ['ai-1', 'ai-2']
        );

      const state = useAiGroupStore.getState();
      const updated = state.missions[0];
      expect(updated.status).toBe('COMPLETED');
      expect((updated as never as { finalResult: string }).finalResult).toBe(
        'Final analysis report'
      );
      expect((updated as never as { summary: string }).summary).toBe(
        'Mission accomplished'
      );
      expect(state.currentMission?.status).toBe('COMPLETED');
    });
  });

  describe('handleMissionFailed', () => {
    it('should set mission status to FAILED', () => {
      const mission = makeMission({ id: 'm1', status: 'RUNNING' });
      useAiGroupStore.setState({
        missions: [mission as never],
        currentMission: mission as never,
      });

      useAiGroupStore.getState().handleMissionFailed('m1');

      expect(useAiGroupStore.getState().missions[0].status).toBe('FAILED');
      expect(useAiGroupStore.getState().currentMission?.status).toBe('FAILED');
    });

    it('should not change other missions', () => {
      const m1 = makeMission({ id: 'm1', status: 'RUNNING' });
      const m2 = makeMission({ id: 'm2', status: 'RUNNING' });
      useAiGroupStore.setState({ missions: [m1, m2] as never[] });

      useAiGroupStore.getState().handleMissionFailed('m1');

      expect(useAiGroupStore.getState().missions[1].status).toBe('RUNNING');
    });
  });
});
