import { StateCreator } from 'zustand';
import {
  TeamMission,
  CreateMissionDto,
  UpdateAIMemberTeamRoleDto,
  TopicAIMemberWithTeamRole,
  MissionStatus,
  AgentTask,
  AgentTaskStatus,
} from '@/lib/types/ai-teams';
import * as api from '@/services/ai-teams/api';

import { logger } from '@/lib/utils/logger';
export interface MissionsSlice {
  // State
  missions: TeamMission[];
  currentMission: TeamMission | null;
  isLoadingMissions: boolean;
  teamMembers: TopicAIMemberWithTeamRole[];
  isLoadingTeamMembers: boolean;

  // Actions - Team Mission
  fetchMissions: (
    topicId: string,
    options?: { status?: MissionStatus }
  ) => Promise<void>;
  fetchMission: (topicId: string, missionId: string) => Promise<void>;
  createMission: (
    topicId: string,
    dto: CreateMissionDto
  ) => Promise<TeamMission>;
  cancelMission: (topicId: string, missionId: string) => Promise<void>;
  deleteMission: (topicId: string, missionId: string) => Promise<void>;
  pauseMission: (topicId: string, missionId: string) => Promise<void>;
  resumeMission: (topicId: string, missionId: string) => Promise<void>;
  retryMission: (
    topicId: string,
    missionId: string,
    options?: { mode?: 'full' | 'continue' }
  ) => Promise<void>;
  setCurrentMission: (mission: TeamMission | null) => void;

  // Actions - Team Role
  fetchTeamMembers: (topicId: string) => Promise<void>;
  setTeamLeader: (topicId: string, aiMemberId: string) => Promise<void>;
  updateTeamRole: (
    topicId: string,
    aiMemberId: string,
    dto: UpdateAIMemberTeamRoleDto
  ) => Promise<void>;

  // Internal - WebSocket mission handlers
  handleMissionCreated: (mission: TeamMission) => void;
  handleMissionStatusChanged: (
    missionId: string,
    status: MissionStatus,
    totalTasks?: number,
    tasks?: AgentTask[]
  ) => void;
  handleMissionProgressUpdated: (
    missionId: string,
    completedTasks: number,
    totalTasks: number,
    progressPercent: number
  ) => void;
  handleTaskCompleted: (
    missionId: string,
    taskId: string,
    agentId: string
  ) => void;
  handleTaskStatusUpdate: (
    missionId: string,
    taskId: string,
    status: AgentTaskStatus,
    result?: string,
    leaderFeedback?: string
  ) => void;
  handleMissionAgentWorking: (missionId: string, agentId: string) => void;
  handleMissionAgentDone: (missionId: string, agentId: string) => void;
  handleMissionCompleted: (
    missionId: string,
    finalResult: string,
    summary: string,
    participantAIIds?: string[]
  ) => void;
  handleMissionFailed: (missionId: string) => void;
}

export const createMissionsSlice: StateCreator<
  MissionsSlice,
  [],
  [],
  MissionsSlice
> = (set, get) => ({
  // Initial state
  missions: [],
  currentMission: null,
  isLoadingMissions: false,
  teamMembers: [],
  isLoadingTeamMembers: false,

  // ==================== Team Mission ====================

  fetchMissions: async (topicId, options) => {
    // Only show loading spinner on initial load (when no data exists)
    const currentMissions = get().missions;
    if (!currentMissions || currentMissions.length === 0) {
      set({ isLoadingMissions: true });
    }
    try {
      const response = await api.getMissions(topicId, options);
      // Backend returns array directly, not { missions: [...] }
      const missions = Array.isArray(response)
        ? response
        : response?.missions || [];
      set({ missions, isLoadingMissions: false });
    } catch (error) {
      logger.error('Failed to fetch missions:', error);
      // On error during refresh, keep existing data instead of clearing
      if (!currentMissions || currentMissions.length === 0) {
        set({ missions: [], isLoadingMissions: false });
      } else {
        set({ isLoadingMissions: false });
      }
    }
  },

  fetchMission: async (topicId, missionId) => {
    try {
      const mission = await api.getMissionById(topicId, missionId);
      set({ currentMission: mission });
      // 更新missions列表中的对应项
      set((state) => ({
        missions: state.missions.map((m) => (m.id === missionId ? mission : m)),
      }));
    } catch (error) {
      logger.error('Failed to fetch mission:', error);
    }
  },

  createMission: async (topicId, dto) => {
    const mission = await api.createMission(topicId, dto);
    set((state) => ({
      missions: [mission, ...state.missions],
      currentMission: mission,
    }));
    return mission;
  },

  cancelMission: async (topicId, missionId) => {
    const mission = await api.cancelMission(topicId, missionId);
    set((state) => ({
      missions: state.missions.map((m) => (m.id === missionId ? mission : m)),
      currentMission:
        state.currentMission?.id === missionId ? mission : state.currentMission,
    }));
  },

  deleteMission: async (topicId, missionId) => {
    await api.deleteMission(topicId, missionId);
    // 从列表中移除已删除的任务
    set((state) => ({
      missions: state.missions.filter((m) => m.id !== missionId),
      currentMission:
        state.currentMission?.id === missionId ? null : state.currentMission,
    }));
  },

  pauseMission: async (topicId, missionId) => {
    await api.pauseMission(topicId, missionId);
    // 刷新任务列表以获取最新状态
    const response = await api.getMissions(topicId);
    const missions = response.missions || [];
    const pausedMission = missions.find((m: TeamMission) => m.id === missionId);
    set((state) => ({
      missions,
      currentMission:
        state.currentMission?.id === missionId
          ? pausedMission || state.currentMission
          : state.currentMission,
    }));
  },

  resumeMission: async (topicId, missionId) => {
    await api.resumeMission(topicId, missionId);
    // 刷新任务列表以获取最新状态
    const response = await api.getMissions(topicId);
    const missions = response.missions || [];
    const resumedMission = missions.find(
      (m: TeamMission) => m.id === missionId
    );
    set((state) => ({
      missions,
      currentMission:
        state.currentMission?.id === missionId
          ? resumedMission || state.currentMission
          : state.currentMission,
    }));
  },

  retryMission: async (topicId, missionId, options) => {
    await api.retryMission(topicId, missionId, options);
    // 刷新任务列表以获取最新状态
    const response = await api.getMissions(topicId);
    const missions = response.missions || [];
    const retriedMission = missions.find(
      (m: TeamMission) => m.id === missionId
    );
    set((state) => ({
      missions,
      currentMission:
        state.currentMission?.id === missionId
          ? retriedMission || state.currentMission
          : state.currentMission,
    }));
  },

  setCurrentMission: (mission) => {
    set({ currentMission: mission });
  },

  // ==================== Team Role ====================

  fetchTeamMembers: async (topicId) => {
    set({ isLoadingTeamMembers: true });
    try {
      const response = await api.getTeamMembers(topicId);
      // API returns { leader, members, all } - we need the 'all' array
      const teamMembers = response?.all || [];
      set({ teamMembers, isLoadingTeamMembers: false });
    } catch (error) {
      logger.error('Failed to fetch team members:', error);
      set({ teamMembers: [], isLoadingTeamMembers: false });
    }
  },

  setTeamLeader: async (topicId, aiMemberId) => {
    await api.setTeamLeader(topicId, aiMemberId);
    // 刷新团队成员列表
    await get().fetchTeamMembers(topicId);
  },

  updateTeamRole: async (topicId, aiMemberId, dto) => {
    await api.updateTeamRole(topicId, aiMemberId, dto);
    // 刷新团队成员列表
    await get().fetchTeamMembers(topicId);
  },

  // ==================== WebSocket Handlers ====================

  handleMissionCreated: (mission) => {
    logger.debug('[WS] Mission created:', mission.id);
    set((state) => ({
      missions: [mission, ...state.missions.filter((m) => m.id !== mission.id)],
    }));
  },

  handleMissionStatusChanged: (missionId, status, totalTasks, tasks) => {
    logger.debug('[WS] Mission status changed:', {
      missionId,
      status,
      totalTasks,
    });
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === missionId
          ? {
              ...m,
              status,
              ...(totalTasks !== undefined && { totalTasks }),
              ...(tasks && { tasks }),
            }
          : m
      ),
      currentMission:
        state.currentMission?.id === missionId
          ? {
              ...state.currentMission,
              status,
              ...(totalTasks !== undefined && { totalTasks }),
              ...(tasks && { tasks }),
            }
          : state.currentMission,
    }));
  },

  handleMissionProgressUpdated: (
    missionId,
    completedTasks,
    totalTasks,
    progressPercent
  ) => {
    logger.debug('[WS] Mission progress updated:', {
      missionId,
      completedTasks,
      totalTasks,
      progressPercent,
    });
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === missionId
          ? { ...m, completedTasks, totalTasks, progressPercent }
          : m
      ),
      currentMission:
        state.currentMission?.id === missionId
          ? {
              ...state.currentMission,
              completedTasks,
              totalTasks,
              progressPercent,
            }
          : state.currentMission,
    }));
  },

  handleTaskCompleted: (missionId, taskId, agentId) => {
    logger.debug('[WS] Task completed:', { missionId, taskId, agentId });
    set((state) => {
      const updateTasks = (tasks?: AgentTask[]) =>
        tasks?.map((t) =>
          t.id === taskId
            ? { ...t, status: 'AWAITING_REVIEW' as AgentTaskStatus }
            : t
        );

      return {
        missions: state.missions.map((m) =>
          m.id === missionId ? { ...m, tasks: updateTasks(m.tasks) } : m
        ),
        currentMission:
          state.currentMission?.id === missionId
            ? {
                ...state.currentMission,
                tasks: updateTasks(state.currentMission.tasks),
              }
            : state.currentMission,
      };
    });
  },

  handleTaskStatusUpdate: (
    missionId,
    taskId,
    status,
    result,
    leaderFeedback
  ) => {
    logger.debug('[WS] Task status update:', { missionId, taskId, status });
    set((state) => {
      const updateTasks = (tasks?: AgentTask[]) =>
        tasks?.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status,
                result: result ?? t.result,
                leaderFeedback: leaderFeedback ?? t.leaderFeedback,
              }
            : t
        );

      return {
        missions: state.missions.map((m) =>
          m.id === missionId ? { ...m, tasks: updateTasks(m.tasks) } : m
        ),
        currentMission:
          state.currentMission?.id === missionId
            ? {
                ...state.currentMission,
                tasks: updateTasks(state.currentMission.tasks),
              }
            : state.currentMission,
      };
    });
  },

  handleMissionAgentWorking: (missionId, agentId) => {
    logger.debug('[WS] Mission agent working:', { missionId, agentId });
    // This is handled by messagesSlice.handleAITyping
  },

  handleMissionAgentDone: (missionId, agentId) => {
    logger.debug('[WS] Mission agent done:', { missionId, agentId });
    // This is handled by messagesSlice.handleAIResponse
  },

  handleMissionCompleted: (
    missionId,
    finalResult,
    summary,
    participantAIIds
  ) => {
    logger.debug('[WS] Mission completed:', { missionId, participantAIIds });
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === missionId
          ? {
              ...m,
              status: 'COMPLETED' as MissionStatus,
              finalResult,
              summary,
              completedAt: new Date().toISOString(),
            }
          : m
      ),
      currentMission:
        state.currentMission?.id === missionId
          ? {
              ...state.currentMission,
              status: 'COMPLETED' as MissionStatus,
              finalResult,
              summary,
              completedAt: new Date().toISOString(),
            }
          : state.currentMission,
    }));
  },

  handleMissionFailed: (missionId) => {
    logger.error('[WS] Mission failed:', { missionId });
    set((state) => ({
      missions: state.missions.map((m) =>
        m.id === missionId ? { ...m, status: 'FAILED' as MissionStatus } : m
      ),
      currentMission:
        state.currentMission?.id === missionId
          ? { ...state.currentMission, status: 'FAILED' as MissionStatus }
          : state.currentMission,
    }));
  },
});
