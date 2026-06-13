/**
 * AI Writing Store
 *
 * Zustand store for AI Writing module
 * Following AI Teams store pattern
 */

import { create } from 'zustand';
import * as api from '@/services/ai-writing/api';
import { ApiError } from '@/services/ai-writing/api';
import { logger } from '@/lib/utils/logger';
import type {
  WritingProject,
  Volume,
  Chapter,
  StoryBible,
  Character,
  CreateProjectDto,
  UpdateProjectDto,
  StartMissionDto,
  ConversationMessage,
} from '@/services/ai-writing/api';

interface AIWritingState {
  // Projects
  projects: WritingProject[];
  currentProject: WritingProject | null;
  isLoadingProjects: boolean;

  // Volumes & Chapters
  volumes: Volume[];
  currentChapter: Chapter | null;
  isLoadingVolumes: boolean;

  // Story Bible & Characters
  storyBible: StoryBible | null;
  characters: Character[];
  isLoadingBible: boolean;

  // AI Mission
  isMissionRunning: boolean;
  currentMissionId: string | null;
  missionProgress: number;
  missionMessage: string;
  missionCompleted: boolean;
  activeAgentIds: string[]; // IDs of currently active agents (supports parallel)
  isStuckMission: boolean; // 任务卡住（后台重启等情况）
  stuckMissionId: string | null; // 卡住的任务ID

  // Multi-turn Conversation (Agent 多轮对话)
  conversationHistory: ConversationMessage[];

  // Error handling
  error: string | null;

  // Actions - Projects
  fetchProjects: () => Promise<void>;
  fetchProject: (id: string, silent?: boolean) => Promise<void>;
  createProject: (dto: CreateProjectDto) => Promise<WritingProject>;
  updateProject: (id: string, dto: UpdateProjectDto) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setCurrentProject: (project: WritingProject | null) => void;

  // Actions - Volumes & Chapters
  fetchVolumes: (projectId: string, silent?: boolean) => Promise<void>;
  createVolume: (
    projectId: string,
    dto: { title: string; volumeNumber: number }
  ) => Promise<Volume>;
  fetchChapter: (id: string) => Promise<void>;
  updateChapter: (id: string, content: string) => Promise<void>;
  createChapter: (
    volumeId: string,
    dto: { title: string; chapterNumber: number }
  ) => Promise<Chapter>;
  setCurrentChapter: (chapter: Chapter | null) => void;

  // Actions - Story Bible
  fetchStoryBible: (projectId: string) => Promise<void>;
  updateStoryBible: (
    projectId: string,
    dto: Partial<StoryBible>
  ) => Promise<void>;

  // Actions - Characters
  fetchCharacters: (projectId: string) => Promise<void>;
  createCharacter: (
    projectId: string,
    dto: Omit<Character, 'id' | 'projectId'>
  ) => Promise<Character>;
  deleteCharacter: (projectId: string, characterId: string) => Promise<void>;

  // Actions - AI Mission
  startMission: (projectId: string, dto: StartMissionDto) => Promise<void>;
  cancelMission: (projectId: string) => Promise<void>;
  checkRunningMission: (projectId: string) => Promise<void>;
  clearStuckMission: () => void; // 清除卡住状态，允许继续创作

  // Actions - Conversation History (多轮对话)
  addToConversationHistory: (message: ConversationMessage) => void;
  clearConversationHistory: () => void;

  // Actions - Utility
  clearError: () => void;
  reset: () => void;
  clearCurrentProjectData: () => void;
}

// Module-level variable to control active polling
let activePollController: AbortController | null = null;

const initialState = {
  projects: [],
  currentProject: null,
  isLoadingProjects: false,
  volumes: [],
  currentChapter: null,
  isLoadingVolumes: false,
  storyBible: null,
  characters: [],
  isLoadingBible: false,
  isMissionRunning: false,
  currentMissionId: null as string | null,
  missionProgress: 0,
  missionMessage: '',
  missionCompleted: false,
  activeAgentIds: [],
  isStuckMission: false,
  stuckMissionId: null as string | null,
  conversationHistory: [] as ConversationMessage[],
  error: null,
};

// ==================== Step-to-phase mapping (shared) ====================

const stepToPhase: Record<string, { agents: string[]; message: string }> = {
  'world-building': {
    agents: ['keeper'],
    message: '设定守护者正在建立世界观...',
  },
  plan: {
    agents: ['architect'],
    message: '故事架构师正在基于世界观规划章节...',
  },
  'context-injection': {
    agents: ['keeper'],
    message: '设定守护者正在准备上下文...',
  },
  write: {
    agents: ['writer-1', 'writer-2', 'writer-3'],
    message: '作家团队正在并行创作内容...',
  },
  check: {
    agents: ['checker-1', 'checker-2'],
    message: '检查员团队正在校验一致性...',
  },
  edit: { agents: ['editor'], message: '润色编辑正在打磨文字...' },
  review: {
    agents: ['architect'],
    message: '故事架构师正在最终审核...',
  },
};

// ==================== Shared polling options ====================

interface PollMissionStatusOptions {
  /** The mission ID to poll. */
  missionId: string;
  /** The project ID (used for data refresh calls). */
  projectId: string;
  /** AbortSignal to stop polling when a newer poll starts. */
  signal: AbortSignal;
  /**
   * Whether to apply the rich stepToPhase orchestrator UI updates.
   * true  → startMission behaviour (updates activeAgentIds, fetches StoryBible on steps, etc.)
   * false → checkRunningMission behaviour (simple progress update only)
   */
  richOrchestratorUpdates: boolean;
  /**
   * How often (in poll ticks) to silently refresh volumes + project.
   * startMission uses 2 (every 4 s), checkRunningMission uses 5 (every 10 s).
   */
  refreshEveryNPolls: number;
  /** Message to set when the mission completes successfully. */
  completedMessage: string;
  /** Fallback error message when FAILED and no structured error is available. */
  failedFallbackMessage: string;
  /** Zustand set function (passed in because the helper lives outside the store). */
  set: (partial: Partial<AIWritingState>) => void;
  /** Zustand get function. */
  get: () => AIWritingState;
}

/**
 * Shared polling loop used by both startMission and checkRunningMission.
 *
 * Polls getMissionStatus every 2 s for up to 15 minutes.
 * Stops when: mission COMPLETED, mission FAILED, 404 (deleted), aborted,
 * stuck detection (3 min without progress change), or max polls reached.
 */
async function pollMissionStatus(
  opts: PollMissionStatusOptions
): Promise<void> {
  const {
    missionId,
    projectId,
    signal,
    richOrchestratorUpdates,
    refreshEveryNPolls,
    completedMessage,
    failedFallbackMessage,
    set,
    get,
  } = opts;

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 450; // 15 minutes (450 × 2 s)
  const STUCK_DURING_POLL_MS = 3 * 60 * 1000; // 3 minutes — unified threshold

  let pollCount = 0;
  let lastProgressUpdate = Date.now();
  let lastProgress = -1; // -1 so the first real value always triggers a reset

  while (pollCount < MAX_POLLS) {
    if (signal.aborted) return;

    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    pollCount++;

    if (signal.aborted) return;

    // Stuck-during-poll detection (no progress change for STUCK_DURING_POLL_MS)
    if (Date.now() - lastProgressUpdate > STUCK_DURING_POLL_MS) {
      logger.warn(
        `[pollMissionStatus] Mission ${missionId} appears stuck (no progress for ${Math.round((Date.now() - lastProgressUpdate) / 1000)}s)`
      );
      set({
        isStuckMission: true,
        stuckMissionId: missionId,
        isMissionRunning: false,
        missionMessage: '任务已卡住，请点击"继续创作"重新开始',
      });
      return;
    }

    try {
      const { fetchVolumes, fetchProject } = get();
      const status = await api.getMissionStatus(missionId);

      // ── COMPLETED ──────────────────────────────────────────────────────────
      if (status.status === 'COMPLETED') {
        set({
          isMissionRunning: false,
          missionProgress: 100,
          missionMessage: completedMessage,
          missionCompleted: true,
          activeAgentIds: [],
        });
        await fetchVolumes(projectId, true);
        await fetchProject(projectId);
        return;
      }

      // ── FAILED ─────────────────────────────────────────────────────────────
      if (status.status === 'FAILED') {
        const rawError = status.result?.error as
          | string
          | { message?: string }
          | undefined;
        const errorMsg =
          typeof rawError === 'string'
            ? rawError
            : typeof rawError === 'object' && rawError?.message
              ? rawError.message
              : failedFallbackMessage;

        const isCancelled =
          errorMsg.toLowerCase().includes('cancelled') ||
          errorMsg.includes('取消');
        set({
          isMissionRunning: false,
          missionProgress: 0,
          missionMessage: isCancelled ? '' : errorMsg,
          missionCompleted: false,
          activeAgentIds: [],
          error: isCancelled ? null : errorMsg,
        });
        return;
      }

      // ── IN PROGRESS: orchestrator state update ─────────────────────────────
      if (richOrchestratorUpdates && status.orchestratorState) {
        const { completedSteps, currentSteps, progress } =
          status.orchestratorState;

        let activeAgents: string[] = [];
        let message = '处理中...';

        if (currentSteps.length > 0) {
          const currentStep = currentSteps[0];
          const phaseInfo = stepToPhase[currentStep];
          if (phaseInfo) {
            activeAgents = phaseInfo.agents;
            message = phaseInfo.message;
          }
        } else if (completedSteps.length > 0) {
          const lastStep = completedSteps[completedSteps.length - 1];
          const phaseInfo = stepToPhase[lastStep];
          if (phaseInfo) {
            message = `${phaseInfo.message.replace('正在', '已完成')}`;
          }
        }

        // Refresh chapter list as soon as the plan step completes
        if (completedSteps.includes('plan')) {
          try {
            await fetchVolumes(projectId, true);
          } catch {
            // Ignore errors
          }
        }

        // Refresh StoryBible when world-building or context-injection completes
        if (
          completedSteps.includes('world-building') ||
          completedSteps.includes('context-injection')
        ) {
          try {
            await get().fetchStoryBible(projectId);
          } catch {
            // Ignore errors
          }
        }

        const currentProgress = Math.min(
          95,
          progress || (completedSteps.length / 6) * 100
        );
        if (currentProgress !== lastProgress) {
          lastProgress = currentProgress;
          lastProgressUpdate = Date.now();
        }

        set({
          activeAgentIds: activeAgents,
          missionProgress: currentProgress,
          missionMessage: message,
        });
      } else if (!richOrchestratorUpdates && status.orchestratorState) {
        // Simple progress update used by checkRunningMission
        const { progress, currentSteps } = status.orchestratorState;
        const currentProgress = progress || 0;

        if (currentProgress !== lastProgress) {
          lastProgress = currentProgress;
          lastProgressUpdate = Date.now();
        }

        set({
          missionProgress: currentProgress,
          missionMessage:
            status.result?.currentStep || currentSteps?.[0] || '处理中...',
        });
      } else if (status.result?.progress !== undefined) {
        // Fallback: progress from result field (startMission path)
        const currentProgress = Math.min(95, status.result.progress);
        if (currentProgress !== lastProgress) {
          lastProgress = currentProgress;
          lastProgressUpdate = Date.now();
        }
        set({
          missionProgress: currentProgress,
          missionMessage: status.result.currentStep || '处理中...',
        });
      }

      // Periodic silent refresh of volumes + project
      if (pollCount % refreshEveryNPolls === 0) {
        try {
          await fetchVolumes(projectId, true);
          await fetchProject(projectId, true);
        } catch {
          // Ignore errors during polling
        }
      }
    } catch (err) {
      // 404 means mission was deleted — stop polling cleanly
      if (err instanceof ApiError && err.status === 404) {
        set({
          isMissionRunning: false,
          missionProgress: 0,
          missionMessage: '',
          missionCompleted: false,
          activeAgentIds: [],
        });
        return;
      }
      logger.warn('[pollMissionStatus] Status check failed, continuing:', err);
      // Other errors: continue polling
    }
  }

  // Max polls reached — task may still be running in the background
  set({
    isMissionRunning: false,
    missionProgress: 0,
    missionMessage: '',
    missionCompleted: false,
    activeAgentIds: [],
    error:
      '前端轮询超时（15分钟），任务可能仍在后台运行。请稍后刷新页面查看结果。',
  });
}

export const useAIWritingStore = create<AIWritingState>((set, get) => ({
  ...initialState,

  // ==================== Projects ====================

  fetchProjects: async () => {
    set({ isLoadingProjects: true, error: null });
    try {
      const data = await api.getProjects();
      set({ projects: data.items || [], isLoadingProjects: false });
    } catch (err) {
      set({
        error: (err as Error).message,
        isLoadingProjects: false,
      });
    }
  },

  fetchProject: async (id: string, silent = false) => {
    // When silent=true (during polling), don't show loading state to avoid UI flicker
    if (!silent) {
      set({ isLoadingProjects: true, error: null });
    }
    try {
      const project = await api.getProject(id);
      set({ currentProject: project, isLoadingProjects: false });
    } catch (err) {
      if (!silent) {
        set({
          error: (err as Error).message,
          isLoadingProjects: false,
          currentProject: null,
        });
      }
    }
  },

  createProject: async (dto: CreateProjectDto) => {
    set({ error: null });
    try {
      const project = await api.createProject(dto);
      set((state) => ({
        projects: [project, ...state.projects],
      }));
      return project;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  updateProject: async (id: string, dto: UpdateProjectDto) => {
    set({ error: null });
    try {
      const updated = await api.updateProject(id, dto);
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? updated : p)),
        currentProject:
          state.currentProject?.id === id ? updated : state.currentProject,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  deleteProject: async (id: string) => {
    set({ error: null });
    try {
      await api.deleteProject(id);
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject:
          state.currentProject?.id === id ? null : state.currentProject,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  setCurrentProject: (project) => {
    set({ currentProject: project });
  },

  // ==================== Volumes & Chapters ====================

  fetchVolumes: async (projectId: string, silent = false) => {
    // When silent=true (during polling), don't show loading state to avoid UI flicker
    if (!silent) {
      set({ isLoadingVolumes: true, error: null });
    }
    try {
      const volumes = await api.getVolumes(projectId);
      set({ volumes, isLoadingVolumes: false });
    } catch (err) {
      if (!silent) {
        set({
          error: (err as Error).message,
          isLoadingVolumes: false,
        });
      }
    }
  },

  createVolume: async (projectId, dto) => {
    set({ error: null });
    try {
      const volume = await api.createVolume(projectId, dto);
      set((state) => ({
        volumes: [...state.volumes, volume],
      }));
      return volume;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  fetchChapter: async (id: string) => {
    set({ error: null });
    try {
      const chapter = await api.getChapter(id);
      set({ currentChapter: chapter });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  updateChapter: async (id: string, content: string) => {
    set({ error: null });
    try {
      const updated = await api.updateChapter(id, { content });
      set((state) => {
        // Update chapter in volumes
        const newVolumes = state.volumes.map((v) => ({
          ...v,
          chapters: v.chapters?.map((c) => (c.id === id ? updated : c)),
        }));
        return {
          volumes: newVolumes,
          currentChapter:
            state.currentChapter?.id === id ? updated : state.currentChapter,
        };
      });
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  createChapter: async (volumeId, dto) => {
    set({ error: null });
    try {
      const chapter = await api.createChapter(volumeId, dto);
      set((state) => ({
        volumes: state.volumes.map((v) =>
          v.id === volumeId
            ? { ...v, chapters: [...(v.chapters || []), chapter] }
            : v
        ),
      }));
      return chapter;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  setCurrentChapter: (chapter) => {
    set({ currentChapter: chapter });
  },

  // ==================== Story Bible ====================

  fetchStoryBible: async (projectId: string) => {
    set({ isLoadingBible: true, error: null });
    try {
      const bible = await api.getStoryBible(projectId);
      set({ storyBible: bible, isLoadingBible: false });
    } catch (err) {
      // Story Bible might not exist yet, that's OK
      set({ storyBible: null, isLoadingBible: false });
    }
  },

  updateStoryBible: async (projectId: string, dto: Partial<StoryBible>) => {
    set({ error: null });
    try {
      const updated = await api.updateStoryBible(projectId, dto);
      set({ storyBible: updated });
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  // ==================== Characters ====================

  fetchCharacters: async (projectId: string) => {
    set({ error: null });
    try {
      const characters = await api.getCharacters(projectId);
      set({ characters });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  createCharacter: async (projectId, dto) => {
    set({ error: null });
    try {
      const character = await api.createCharacter(projectId, dto);
      set((state) => ({
        characters: [...state.characters, character],
      }));
      return character;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  deleteCharacter: async (projectId: string, characterId: string) => {
    set({ error: null });
    try {
      await api.deleteCharacter(projectId, characterId);
      set((state) => ({
        characters: state.characters.filter((c) => c.id !== characterId),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  // ==================== AI Mission ====================

  startMission: async (projectId: string, dto: StartMissionDto) => {
    // Cancel any existing polling
    activePollController?.abort();
    activePollController = new AbortController();
    const signal = activePollController.signal;

    set({
      isMissionRunning: true,
      missionProgress: 0,
      missionMessage: '启动写作任务...',
      missionCompleted: false,
      activeAgentIds: ['architect'],
      error: null,
    });

    try {
      const response = await api.startMission(projectId, dto);
      const missionId = response.missionId;

      if (!missionId) {
        throw new Error('未获取到任务ID');
      }

      void pollMissionStatus({
        missionId,
        projectId,
        signal,
        richOrchestratorUpdates: true,
        refreshEveryNPolls: 2,
        completedMessage: '创作完成！',
        failedFallbackMessage: '任务执行失败',
        set: set as (partial: Partial<AIWritingState>) => void,
        get,
      });
    } catch (err) {
      set({
        error: (err as Error).message,
        isMissionRunning: false,
        missionMessage: '',
        missionCompleted: false,
        activeAgentIds: [],
      });
      throw err;
    }
  },

  // 取消当前任务（支持强制清理卡住的任务）
  cancelMission: async (projectId: string) => {
    const { currentMissionId, isStuckMission } = get();

    // 方式1: 如果有记录 missionId，先尝试正常取消
    const missionId = currentMissionId;
    let cancelSuccess = false;

    if (missionId) {
      try {
        await api.cancelMission(missionId);
        cancelSuccess = true;
        logger.debug(
          '[cancelMission] Normal cancel succeeded for mission:',
          missionId
        );
      } catch (err) {
        logger.debug('[cancelMission] Normal cancel failed:', err);
      }
    }

    // 方式2: 如果没有 missionId 或者正常取消失败，尝试从 API 获取并取消
    if (!cancelSuccess) {
      try {
        const { items } = await api.getProjectMissions(projectId);
        const runningMission = items.find(
          (m) =>
            m.status === 'running' ||
            m.status === 'pending' ||
            m.status === 'IN_PROGRESS'
        );
        if (runningMission && runningMission.id !== missionId) {
          try {
            await api.cancelMission(runningMission.id);
            cancelSuccess = true;
            logger.debug(
              '[cancelMission] Cancel succeeded for found mission:',
              runningMission.id
            );
          } catch (err) {
            logger.debug('[cancelMission] Cancel found mission failed:', err);
          }
        }
      } catch {
        // ignore
      }
    }

    // 方式3: 如果仍然失败或任务卡住，使用强制清理
    if (!cancelSuccess || isStuckMission) {
      try {
        const result = await api.forceCleanupStuckMissions(projectId);
        logger.debug('[cancelMission] Force cleanup result:', result);
        cancelSuccess = true;
      } catch (err) {
        logger.debug('[cancelMission] Force cleanup failed:', err);
      }
    }

    // 重置状态
    set({
      isMissionRunning: false,
      currentMissionId: null,
      missionProgress: 0,
      missionMessage: '',
      activeAgentIds: [],
      isStuckMission: false,
      stuckMissionId: null,
    });
  },

  // 清除卡住状态（允许用户强制继续创作）
  clearStuckMission: () => {
    set({
      isStuckMission: false,
      stuckMissionId: null,
      isMissionRunning: false,
      currentMissionId: null,
      missionProgress: 0,
      missionMessage: '',
    });
  },

  // 检查是否有正在运行的任务（页面加载时调用，同步多标签页状态）
  checkRunningMission: async (projectId: string) => {
    try {
      const { items } = await api.getProjectMissions(projectId);
      // 查找正在运行的任务（兼容不同状态格式）
      const runningMission = items.find(
        (m) =>
          m.status === 'running' ||
          m.status === 'pending' ||
          m.status === 'IN_PROGRESS'
      );

      if (runningMission) {
        // 检查任务是否卡住（超过3分钟没有更新）
        const STUCK_THRESHOLD_MS = 3 * 60 * 1000; // 3分钟
        const lastUpdateTime = runningMission.updatedAt
          ? new Date(runningMission.updatedAt).getTime()
          : runningMission.createdAt
            ? new Date(runningMission.createdAt).getTime()
            : Date.now();
        const timeSinceUpdate = Date.now() - lastUpdateTime;

        if (timeSinceUpdate > STUCK_THRESHOLD_MS) {
          // 任务卡住了（可能是后台重启导致）
          logger.warn(
            `[checkRunningMission] Mission ${runningMission.id} appears stuck (${Math.round(timeSinceUpdate / 1000)}s since last update)`
          );
          set({
            isStuckMission: true,
            stuckMissionId: runningMission.id,
            isMissionRunning: false, // 不阻塞继续创作
            currentMissionId: runningMission.id,
            missionProgress: runningMission.progress || 0,
            missionMessage: '任务已卡住，请点击"继续创作"重新开始',
            missionCompleted: false,
          });
          return; // 不启动轮询
        }

        // Cancel any existing polling before starting new one
        activePollController?.abort();
        activePollController = new AbortController();
        const signal = activePollController.signal;

        // 有正在运行的任务，同步状态
        set({
          isMissionRunning: true,
          currentMissionId: runningMission.id,
          missionProgress: runningMission.progress || 0,
          missionMessage: '任务进行中...',
          missionCompleted: false,
          isStuckMission: false,
          stuckMissionId: null,
        });

        void pollMissionStatus({
          missionId: runningMission.id,
          projectId,
          signal,
          richOrchestratorUpdates: false,
          refreshEveryNPolls: 5,
          completedMessage: '写作任务完成！',
          failedFallbackMessage: '写作任务失败',
          set: set as (partial: Partial<AIWritingState>) => void,
          get,
        });
      } else {
        // 检查是否有已完成的任务（兼容不同状态格式）
        const completedMission = items.find(
          (m) => m.status === 'completed' || m.status === 'COMPLETED'
        );
        if (completedMission) {
          set({
            isMissionRunning: false,
            missionCompleted: true,
            missionProgress: 100,
            missionMessage: '写作任务已完成',
          });
        }
      }
    } catch (err) {
      // 忽略检查错误，不影响页面加载
      logger.warn('Failed to check running mission:', err);
    }
  },

  // ==================== Conversation History (多轮对话) ====================

  addToConversationHistory: (message: ConversationMessage) => {
    set((state) => ({
      conversationHistory: [
        ...state.conversationHistory,
        {
          ...message,
          timestamp: message.timestamp || new Date().toISOString(),
        },
      ],
    }));
  },

  clearConversationHistory: () => {
    set({ conversationHistory: [] });
  },

  // ==================== Utility ====================

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set(initialState);
  },

  clearCurrentProjectData: () => {
    set({
      currentProject: null,
      volumes: [],
      currentChapter: null,
      storyBible: null,
      characters: [],
      isMissionRunning: false,
      currentMissionId: null,
      missionProgress: 0,
      missionMessage: '',
      missionCompleted: false,
      activeAgentIds: [],
      isStuckMission: false,
      stuckMissionId: null,
      conversationHistory: [],
    });
  },
}));
