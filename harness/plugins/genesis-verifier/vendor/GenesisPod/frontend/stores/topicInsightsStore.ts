/**
 * Topic Insights Zustand Store
 *
 * 专题洞察模块的状态管理
 */

import { create } from 'zustand';
import type {
  ResearchTopic,
  TopicDimension,
  TopicReport,
  TopicEvidence,
  TopicSchedule,
  TopicRefreshLog,
  TopicStats,
  ResearchTemplate,
  RefreshStatusResponse,
  ReportComparisonResult,
  CreateTopicDto,
  UpdateTopicDto,
  ListTopicsDto,
  TriggerRefreshDto,
  AddDimensionDto,
  UpdateDimensionDto,
  ReorderDimensionsDto,
  ExportReportDto,
  CompareReportsDto,
  ListEvidenceDto,
  UpdateScheduleDto,
  ListLogsDto,
  ResearchTopicType,
  ResearchTodo,
  TodoSummary,
  ResearchTodoStatus,
} from '@/lib/types/topic-insights';
import * as api from '@/services/topic-insights/api';
import { logger } from '@/lib/utils/logger';
import type {
  MissionStatus,
  TeamInfo,
  ResearchMission,
  TeamMessage,
  AgentActivity,
} from '@/services/topic-insights/api';

interface TopicInsightsState {
  // Topics
  topics: ResearchTopic[];
  topicsTotal: number;
  hasMoreTopics: boolean;
  isLoadingMoreTopics: boolean;
  currentTopic: ResearchTopic | null;
  isLoadingTopics: boolean;

  // Dimensions
  dimensions: TopicDimension[];
  isLoadingDimensions: boolean;

  // Reports
  reports: TopicReport[];
  currentReport: TopicReport | null;
  isLoadingReports: boolean;
  hasMoreReports: boolean;
  reportsCursor: string | null;

  // Evidence
  evidence: TopicEvidence[];
  isLoadingEvidence: boolean;
  evidenceTotal: number;

  // Refresh
  refreshStatus: RefreshStatusResponse | null;
  isRefreshing: boolean;
  refreshProgress: {
    phase: string;
    progress: number;
    message: string;
    currentDimension?: string;
    completedDimensions: number;
    totalDimensions: number;
  } | null;
  refreshStream: { close: () => void } | null;

  // Leader/Mission
  currentMission: ResearchMission | null;
  missionStatus: MissionStatus | null;
  teamInfo: TeamInfo | null;
  isLoadingMission: boolean;
  missionPollingInterval: NodeJS.Timeout | null;

  // Team Messages & Agent Activities (persisted)
  teamMessages: TeamMessage[];
  agentActivities: AgentActivity[];
  isLoadingTeamData: boolean;

  // Schedule & Logs
  schedule: TopicSchedule | null;
  logs: TopicRefreshLog[];
  isLoadingLogs: boolean;

  // Stats
  stats: TopicStats | null;

  // Templates
  templates: ResearchTemplate[];
  isLoadingTemplates: boolean;

  // Comparison
  comparisonResult: ReportComparisonResult | null;

  // TODOs
  todos: ResearchTodo[];
  todosSummary: TodoSummary | null;
  selectedTodoId: string | null;
  isLoadingTodos: boolean;

  // Error
  error: string | null;

  // Actions - Topics
  fetchTopics: (options?: ListTopicsDto) => Promise<void>;
  loadMoreTopics: (options?: ListTopicsDto) => Promise<void>;
  fetchTopic: (topicId: string) => Promise<void>;
  createTopic: (dto: CreateTopicDto) => Promise<ResearchTopic>;
  updateTopic: (topicId: string, dto: UpdateTopicDto) => Promise<ResearchTopic>;
  patchTopic: (topicId: string, patch: Partial<ResearchTopic>) => void;
  deleteTopic: (topicId: string) => Promise<void>;
  setCurrentTopic: (topic: ResearchTopic | null) => void;

  // Actions - Dimensions
  fetchDimensions: (topicId: string) => Promise<void>;
  addDimension: (topicId: string, dto: AddDimensionDto) => Promise<void>;
  updateDimension: (
    topicId: string,
    dimensionId: string,
    dto: UpdateDimensionDto
  ) => Promise<void>;
  deleteDimension: (topicId: string, dimensionId: string) => Promise<void>;
  refreshDimension: (topicId: string, dimensionId: string) => Promise<void>;
  reorderDimensions: (
    topicId: string,
    dto: ReorderDimensionsDto
  ) => Promise<void>;

  // Actions - Refresh
  triggerRefresh: (topicId: string, dto?: TriggerRefreshDto) => Promise<void>;
  cancelRefresh: (topicId: string, jobId: string) => Promise<void>;
  fetchRefreshStatus: (topicId: string) => Promise<void>;
  startRefreshProgressStream: (topicId: string) => void;
  stopRefreshProgressStream: () => void;

  // Actions - Leader/Mission
  startLeaderPlan: (
    topicId: string,
    userPrompt?: string,
    mode?: 'fresh' | 'incremental',
    researchDepth?: 'quick' | 'standard' | 'thorough'
  ) => Promise<void>;
  fetchMissionStatus: (topicId: string) => Promise<void>;
  fetchTeamInfo: (topicId: string) => Promise<void>;
  sendLeaderInstruction: (
    topicId: string,
    instruction: string
  ) => Promise<void>;
  approveMissionPlan: (topicId: string) => Promise<void>;
  retryMission: (topicId: string, taskIds?: string[]) => Promise<void>;
  cancelMission: (topicId: string) => Promise<void>;
  stopMissionPolling: () => void;
  startMissionPolling: (topicId: string) => void;

  // Actions - Team Messages & Agent Activities
  fetchTeamMessages: (topicId: string) => Promise<void>;
  fetchAgentActivities: (topicId: string) => Promise<void>;
  fetchTeamData: (topicId: string) => Promise<void>;

  // Actions - Reports
  fetchReports: (topicId: string, loadMore?: boolean) => Promise<void>;
  fetchLatestReport: (topicId: string) => Promise<void>;
  fetchReport: (topicId: string, reportId: string) => Promise<void>;
  deleteReport: (topicId: string, reportId: string) => Promise<void>;
  exportReport: (
    topicId: string,
    reportId: string,
    dto: ExportReportDto
  ) => Promise<string>;
  compareReports: (topicId: string, dto: CompareReportsDto) => Promise<void>;
  setCurrentReport: (report: TopicReport | null) => void;
  rollbackReport: (
    topicId: string,
    reportId: string,
    revisionNumber: number
  ) => Promise<void>;

  // Actions - Evidence
  fetchEvidence: (
    topicId: string,
    reportId: string,
    options?: ListEvidenceDto
  ) => Promise<void>;

  // Actions - Schedule
  fetchSchedule: (topicId: string) => Promise<void>;
  updateSchedule: (topicId: string, dto: UpdateScheduleDto) => Promise<void>;

  // Actions - Logs
  fetchLogs: (topicId: string, options?: ListLogsDto) => Promise<void>;

  // Actions - Stats
  fetchStats: (topicId: string) => Promise<void>;

  // Actions - Templates
  fetchTemplates: (type: ResearchTopicType) => Promise<void>;
  createFromTemplate: (
    templateId: string,
    overrides?: Partial<CreateTopicDto>
  ) => Promise<ResearchTopic>;

  // Actions - TODOs
  fetchTodos: (topicId: string, missionId?: string) => Promise<void>;
  pauseTodo: (topicId: string, todoId: string) => Promise<void>;
  resumeTodo: (topicId: string, todoId: string) => Promise<void>;
  cancelTodo: (
    topicId: string,
    todoId: string,
    reason?: string
  ) => Promise<void>;
  retryTodo: (topicId: string, todoId: string) => Promise<void>;
  prioritizeTodo: (
    topicId: string,
    todoId: string,
    priority: 'high' | 'normal' | 'low'
  ) => Promise<void>;
  selectTodo: (todoId: string | null) => void;
  updateTodoFromWs: (todo: ResearchTodo) => void;
  createUserRequestTodo: (
    topicId: string,
    missionId: string,
    title: string,
    description?: string
  ) => Promise<void>;

  // Actions - UI
  clearError: () => void;
  resetStore: () => void;
  /** ★ 重置当前专题相关数据（切换专题时调用，保留 topics 列表）*/
  resetTopicData: () => void;
}

/**
 * ★ 辅助函数：检查错误是否为 "Report not found" 类型
 * 对于新专题，没有报告是正常情况，不应显示为错误
 */
function isReportNotFoundError(error: unknown): boolean {
  const errorMessage =
    error instanceof Error ? error.message : String(error || '');
  return (
    errorMessage.includes('No reports found') ||
    errorMessage.includes('Report not found') ||
    errorMessage.includes('404') ||
    errorMessage.includes('No active mission')
  );
}

export const useTopicInsightsStore = create<TopicInsightsState>((set, get) => ({
  // Initial state
  topics: [],
  topicsTotal: 0,
  hasMoreTopics: false,
  isLoadingMoreTopics: false,
  currentTopic: null,
  isLoadingTopics: false,
  dimensions: [],
  isLoadingDimensions: false,
  reports: [],
  currentReport: null,
  isLoadingReports: false,
  hasMoreReports: false,
  reportsCursor: null,
  evidence: [],
  isLoadingEvidence: false,
  evidenceTotal: 0,
  refreshStatus: null,
  isRefreshing: false,
  refreshProgress: null,
  refreshStream: null,
  currentMission: null,
  missionStatus: null,
  teamInfo: null,
  isLoadingMission: false,
  missionPollingInterval: null,
  teamMessages: [],
  agentActivities: [],
  isLoadingTeamData: false,
  schedule: null,
  logs: [],
  isLoadingLogs: false,
  stats: null,
  templates: [],
  isLoadingTemplates: false,
  comparisonResult: null,
  todos: [],
  todosSummary: null,
  selectedTodoId: null,
  isLoadingTodos: false,
  error: null,

  // ==================== Topics ====================

  fetchTopics: async (options) => {
    set({ isLoadingTopics: true, error: null });
    try {
      const PAGE_SIZE = 20;
      const response = await api.getTopics({
        ...options,
        skip: 0,
        take: PAGE_SIZE,
      });
      set({
        topics: response.topics,
        topicsTotal: response.total,
        hasMoreTopics: response.topics.length < response.total,
        isLoadingTopics: false,
      });
    } catch (error) {
      set({
        isLoadingTopics: false,
        error:
          error instanceof Error ? error.message : 'Failed to fetch topics',
      });
      throw error;
    }
  },

  loadMoreTopics: async (options) => {
    const { topics, hasMoreTopics, isLoadingMoreTopics } = get();
    if (!hasMoreTopics || isLoadingMoreTopics) return;

    set({ isLoadingMoreTopics: true });
    try {
      const PAGE_SIZE = 20;
      const response = await api.getTopics({
        ...options,
        skip: topics.length,
        take: PAGE_SIZE,
      });
      set((state) => ({
        topics: [...state.topics, ...response.topics],
        topicsTotal: response.total,
        hasMoreTopics:
          state.topics.length + response.topics.length < response.total,
        isLoadingMoreTopics: false,
      }));
    } catch (error) {
      set({ isLoadingMoreTopics: false });
      throw error;
    }
  },

  fetchTopic: async (topicId) => {
    try {
      const topic = await api.getTopic(topicId);
      set({ currentTopic: topic });
      // Update topics list
      set((state) => ({
        topics: state.topics.map((t) => (t.id === topicId ? topic : t)),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch topic',
      });
      throw error;
    }
  },

  createTopic: async (dto) => {
    const topic = await api.createTopic(dto);
    set((state) => ({ topics: [topic, ...state.topics] }));
    return topic;
  },

  updateTopic: async (topicId, dto) => {
    const topic = await api.updateTopic(topicId, dto);
    set((state) => ({
      topics: state.topics.map((t) => (t.id === topicId ? topic : t)),
      currentTopic:
        state.currentTopic?.id === topicId ? topic : state.currentTopic,
    }));
    return topic; // ★ 返回更新后的专题
  },

  // ★ 无 API 调用的本地 patch，用于 modal 等组件在自行完成 API 调用后同步 store
  patchTopic: (topicId, patch) => {
    set((state) => ({
      topics: state.topics.map((t) =>
        t.id === topicId ? { ...t, ...patch } : t
      ),
      currentTopic:
        state.currentTopic?.id === topicId
          ? { ...state.currentTopic, ...patch }
          : state.currentTopic,
    }));
  },

  deleteTopic: async (topicId) => {
    await api.deleteTopic(topicId);
    set((state) => ({
      topics: state.topics.filter((t) => t.id !== topicId),
      currentTopic:
        state.currentTopic?.id === topicId ? null : state.currentTopic,
    }));
  },

  setCurrentTopic: (topic) => {
    set({ currentTopic: topic });
  },

  // ==================== Dimensions ====================

  fetchDimensions: async (topicId) => {
    set({ isLoadingDimensions: true, error: null });
    try {
      const dimensions = await api.getDimensions(topicId);
      set({ dimensions, isLoadingDimensions: false });
    } catch (error) {
      set({
        isLoadingDimensions: false,
        error:
          error instanceof Error ? error.message : 'Failed to fetch dimensions',
      });
      throw error;
    }
  },

  addDimension: async (topicId, dto) => {
    const dimension = await api.addDimension(topicId, dto);
    set((state) => ({ dimensions: [...state.dimensions, dimension] }));
  },

  updateDimension: async (topicId, dimensionId, dto) => {
    const dimension = await api.updateDimension(topicId, dimensionId, dto);
    set((state) => ({
      dimensions: state.dimensions.map((d) =>
        d.id === dimensionId ? dimension : d
      ),
    }));
  },

  deleteDimension: async (topicId, dimensionId) => {
    await api.deleteDimension(topicId, dimensionId);
    set((state) => ({
      dimensions: state.dimensions.filter((d) => d.id !== dimensionId),
    }));
  },

  refreshDimension: async (topicId, dimensionId) => {
    await api.refreshDimension(topicId, dimensionId);
    // Refresh dimensions to get updated status
    await get().fetchDimensions(topicId);
  },

  reorderDimensions: async (topicId, dto) => {
    const dimensions = await api.reorderDimensions(topicId, dto);
    set({ dimensions });
  },

  // ==================== Refresh ====================

  triggerRefresh: async (topicId, dto) => {
    set({ isRefreshing: true, error: null });
    try {
      await api.triggerRefresh(topicId, dto);
      // Start listening to progress
      get().startRefreshProgressStream(topicId);
    } catch (error) {
      set({
        isRefreshing: false,
        error:
          error instanceof Error ? error.message : 'Failed to trigger refresh',
      });
      throw error;
    }
  },

  cancelRefresh: async (topicId, jobId) => {
    try {
      await api.cancelRefresh(topicId, jobId);
      get().stopRefreshProgressStream();
      set({ isRefreshing: false, refreshProgress: null });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to cancel refresh',
      });
      throw error;
    }
  },

  fetchRefreshStatus: async (topicId) => {
    try {
      const status = await api.getRefreshStatus(topicId);
      set({ refreshStatus: status, isRefreshing: status.isRunning });
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch refresh status',
      });
      throw error;
    }
  },

  startRefreshProgressStream: (topicId) => {
    // Close existing stream
    get().stopRefreshProgressStream();

    const stream = api.createRefreshProgressStream(topicId, {
      onProgress: (event) => {
        set({ refreshProgress: event });
      },
      onComplete: async (event) => {
        set({
          isRefreshing: false,
          refreshProgress: null,
        });
        get().stopRefreshProgressStream();
        // Refresh topic and report data
        await get().fetchTopic(topicId);
        await get().fetchLatestReport(topicId);
      },
      onError: (event) => {
        set({
          isRefreshing: false,
          refreshProgress: null,
          error: event.error,
        });
        get().stopRefreshProgressStream();
      },
    });

    set({ refreshStream: stream });
  },

  stopRefreshProgressStream: () => {
    const { refreshStream } = get();
    if (refreshStream) {
      refreshStream.close();
      set({ refreshStream: null });
    }
  },

  // ==================== Leader/Mission ====================

  stopMissionPolling: () => {
    const { missionPollingInterval } = get();
    if (missionPollingInterval) {
      clearInterval(missionPollingInterval);
      set({ missionPollingInterval: null });
    }
  },

  startMissionPolling: (topicId: string) => {
    // Stop any existing polling first
    get().stopMissionPolling();

    // ★ Counter for team data polling (every 5th poll = every 25 seconds)
    let pollCount = 0;

    // Start polling every 5 seconds (reduced from 2s to lower server load)
    const interval = setInterval(async () => {
      pollCount++;

      try {
        const status = await api.getMission(topicId);
        set({ missionStatus: status });

        if (status) {
          const isActive = [
            'PLANNING',
            'PLAN_READY',
            'EXECUTING',
            'REVIEWING',
          ].includes(status.status);
          set({
            isRefreshing: isActive,
            refreshProgress: isActive
              ? {
                  phase: status.currentPhase,
                  progress: status.progress,
                  message: `${status.completedTasks}/${status.totalTasks} 任务完成`,
                  completedDimensions: status.completedTasks,
                  totalDimensions: status.totalTasks,
                }
              : null,
          });

          // ★ Poll team data every 25 seconds (every 5th poll) during active mission
          // This ensures Activities panel shows real-time team collaboration
          if (isActive && pollCount % 5 === 0) {
            try {
              const [messages, activities] = await Promise.all([
                api.getTeamMessages(topicId, {
                  limit: 100,
                  missionId: status.id,
                }),
                api.getAgentActivities(topicId, {
                  limit: 200,
                  missionId: status.id,
                }),
              ]);
              set({ teamMessages: messages, agentActivities: activities });
            } catch (teamError) {
              logger.debug('Team data polling error:', teamError);
            }
          }

          // ★ Health check: detect stuck missions (first poll + every 6th = ~30s interval)
          if (isActive && (pollCount === 1 || pollCount % 6 === 0)) {
            try {
              const healthResult = await api.getMissionHealth(topicId);
              if (healthResult.health && !healthResult.health.isHealthy) {
                // Mission is unhealthy - log issues and stop polling
                logger.warn(
                  'Mission health issues detected:',
                  healthResult.health.issues
                );
                // The backend will auto-mark it as failed, so we'll pick up the new status in next poll
              }
            } catch (healthError) {
              // Health check failed, continue with normal polling
              logger.debug('Health check failed:', healthError);
            }
          }

          // Stop polling if mission is done
          if (!isActive) {
            get().stopMissionPolling();

            // ★ Final fetch of team data on mission completion
            try {
              const [messages, activities] = await Promise.all([
                api.getTeamMessages(topicId, { limit: 100 }),
                api.getAgentActivities(topicId, { limit: 200 }),
              ]);
              set({ teamMessages: messages, agentActivities: activities });
            } catch (teamError) {
              logger.debug('Final team data fetch error:', teamError);
            }

            // If completed, fetch the latest report
            if (status.status === 'COMPLETED') {
              void get().fetchLatestReport(topicId);
            }
          }
        }
      } catch (error) {
        // ★ 401 时停止轮询，避免日志刷屏
        if (
          error instanceof Error &&
          (error.name === 'UnauthorizedError' ||
            error.message.includes('401') ||
            error.message.includes('Session expired'))
        ) {
          logger.warn('Mission polling stopped: session expired');
          get().stopMissionPolling();
          return;
        }
        logger.error('Mission polling error:', error);
      }
    }, 5000);

    set({ missionPollingInterval: interval });
  },

  // ==================== Team Messages & Agent Activities ====================

  fetchTeamMessages: async (topicId) => {
    try {
      const messages = await api.getTeamMessages(topicId, { limit: 100 });
      set({ teamMessages: messages });
    } catch (error) {
      logger.error('Failed to fetch team messages:', error);
    }
  },

  fetchAgentActivities: async (topicId) => {
    try {
      const activities = await api.getAgentActivities(topicId, { limit: 100 });
      set({ agentActivities: activities });
    } catch (error) {
      logger.error('Failed to fetch agent activities:', error);
    }
  },

  fetchTeamData: async (topicId) => {
    set({ isLoadingTeamData: true });
    try {
      const [messages, activities] = await Promise.all([
        api.getTeamMessages(topicId, { limit: 100 }),
        api.getAgentActivities(topicId, { limit: 100 }),
      ]);
      set({
        teamMessages: messages,
        agentActivities: activities,
        isLoadingTeamData: false,
      });
    } catch (error) {
      logger.error('Failed to fetch team data:', error);
      set({ isLoadingTeamData: false });
    }
  },

  startLeaderPlan: async (
    topicId,
    userPrompt,
    mode = 'fresh',
    researchDepth
  ) => {
    // ★ Reset missionStatus to prevent showing stale progress from previous mission
    set({
      isRefreshing: true,
      isLoadingMission: true,
      error: null,
      missionStatus: null,
      refreshProgress: null,
    });
    try {
      const mission = await api.leaderPlan(topicId, {
        userPrompt,
        mode,
        researchDepth,
      });
      set({ currentMission: mission, isLoadingMission: false });
      // Start polling for mission status
      get().fetchMissionStatus(topicId);
      // Start continuous polling
      get().startMissionPolling(topicId);
    } catch (error) {
      set({
        isRefreshing: false,
        isLoadingMission: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start leader plan',
      });
      throw error;
    }
  },

  fetchMissionStatus: async (topicId) => {
    try {
      const status = await api.getMission(topicId);
      set({ missionStatus: status });

      // Update refresh state based on mission status
      if (status) {
        const isActive = [
          'PLANNING',
          'PLAN_READY',
          'EXECUTING',
          'REVIEWING',
        ].includes(status.status);
        set({
          isRefreshing: isActive,
          refreshProgress: isActive
            ? {
                phase: status.currentPhase,
                progress: status.progress,
                message: `${status.completedTasks}/${status.totalTasks} 任务完成`,
                completedDimensions: status.completedTasks,
                totalDimensions: status.totalTasks,
              }
            : null,
        });

        // ★ Auto-start polling if mission is active (e.g., page load with running research)
        // Without this, navigating to a topic with an already-running mission
        // would show a stale status because polling only started from startLeaderPlan()
        if (isActive && !get().missionPollingInterval) {
          get().startMissionPolling(topicId);
        }

        // If completed, fetch the latest report
        if (status.status === 'COMPLETED') {
          get().fetchLatestReport(topicId);
        }
      }
    } catch (error) {
      // ★ 新专题没有 mission 是正常情况，不设置 error
      if (!isReportNotFoundError(error)) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch mission status',
        });
      }
    }
  },

  fetchTeamInfo: async (topicId) => {
    try {
      const teamInfo = await api.getTeam(topicId);
      set({ teamInfo });
    } catch (error) {
      // ★ 新专题没有 team 是正常情况，不设置 error
      if (!isReportNotFoundError(error)) {
        set({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to fetch team info',
        });
      }
    }
  },

  sendLeaderInstruction: async (topicId, instruction) => {
    try {
      await api.sendLeaderMessage(topicId, instruction);
      // Refresh mission status after sending instruction
      get().fetchMissionStatus(topicId);
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to send leader instruction',
      });
      throw error;
    }
  },

  approveMissionPlan: async (topicId) => {
    try {
      await api.approveMissionPlan(topicId);
      // Refresh mission status - it should now be EXECUTING
      await get().fetchMissionStatus(topicId);
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to approve mission plan',
      });
      throw error;
    }
  },

  retryMission: async (topicId, taskIds) => {
    set({ isRefreshing: true, error: null });
    try {
      await api.retryMission(topicId, taskIds);
      // Refresh mission status and start polling
      await get().fetchMissionStatus(topicId);
      get().startMissionPolling(topicId);
    } catch (error) {
      set({
        isRefreshing: false,
        error:
          error instanceof Error ? error.message : 'Failed to retry mission',
      });
      throw error;
    }
  },

  cancelMission: async (topicId) => {
    try {
      await api.cancelMission(topicId);
      // Stop polling and reset refresh state
      get().stopMissionPolling();
      set({
        isRefreshing: false,
        refreshProgress: null,
        currentMission: null,
        // ★ Don't set missionStatus: null - re-fetch instead to enable Update button
      });
      // ★ Re-fetch to get the cancelled mission status
      await get().fetchMissionStatus(topicId);
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to cancel mission',
      });
      throw error;
    }
  },

  // ==================== Reports ====================

  fetchReports: async (topicId, loadMore = false) => {
    set({ isLoadingReports: true, error: null });
    try {
      const cursor = loadMore ? (get().reportsCursor ?? undefined) : undefined;
      const response = await api.getReports(topicId, { cursor, limit: 10 });

      set((state) => ({
        reports: loadMore
          ? [...state.reports, ...response.reports]
          : response.reports,
        hasMoreReports: response.hasMore,
        reportsCursor: response.nextCursor || null,
        isLoadingReports: false,
      }));
    } catch (error) {
      // ★ 即使获取报告列表失败，也不应该因为 "Report not found" 类型错误显示"启动失败"
      set({
        isLoadingReports: false,
        ...(isReportNotFoundError(error)
          ? {}
          : {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to fetch reports',
            }),
      });
      if (!isReportNotFoundError(error)) {
        throw error;
      }
    }
  },

  fetchLatestReport: async (topicId) => {
    try {
      const report = await api.getLatestReport(topicId);
      set({ currentReport: report });
      // ★ 报告加载成功后立即拉取 evidence，确保 topicId 与 reportId 一致
      // 消除 TopicDetail useEffect 竞态：切换 topic 时旧 reportId 污染新 topic 的请求
      if (report?.id) {
        get().fetchEvidence(topicId, report.id, { pageSize: 500 });
      }
    } catch (error) {
      // ★ 新专题没有报告是正常情况，不应设置 error 状态
      set({
        currentReport: null,
        // ★ 使用辅助函数过滤 "Report not found" 类型错误
        ...(isReportNotFoundError(error)
          ? {}
          : {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to fetch latest report',
            }),
      });
      // Don't throw here as missing report is not critical
    }
  },

  fetchReport: async (topicId, reportId) => {
    try {
      const report = await api.getReport(topicId, reportId);
      set({ currentReport: report });
    } catch (error) {
      // ★ 报告不存在时不应设置 error 状态为"启动失败"
      set({
        ...(isReportNotFoundError(error)
          ? {}
          : {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to fetch report',
            }),
      });
      if (!isReportNotFoundError(error)) {
        throw error;
      }
    }
  },

  deleteReport: async (topicId, reportId) => {
    try {
      await api.deleteReport(topicId, reportId);
      // 从列表中移除已删除的报告
      set((state) => ({
        reports: state.reports.filter((r) => r.id !== reportId),
        // 如果删除的是当前报告，清空它
        currentReport:
          state.currentReport?.id === reportId ? null : state.currentReport,
      }));
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to delete report',
      });
      throw error;
    }
  },

  exportReport: async (topicId, reportId, dto) => {
    // 使用轮询等待导出完成
    const downloadUrl = await api.waitForExportCompletion(
      topicId,
      reportId,
      dto
    );
    return downloadUrl;
  },

  compareReports: async (topicId, dto) => {
    try {
      const result = await api.compareReports(topicId, dto);
      set({ comparisonResult: result });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to compare reports',
      });
      throw error;
    }
  },

  setCurrentReport: (report) => {
    set({ currentReport: report });
  },

  rollbackReport: async (topicId, reportId, revisionNumber) => {
    try {
      const result = await api.rollbackReport(
        topicId,
        reportId,
        revisionNumber
      );
      // Update current report with the rolled back content
      set({ currentReport: result.report });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to rollback report',
      });
      throw error;
    }
  },

  // ==================== Evidence ====================

  fetchEvidence: async (topicId, reportId, options) => {
    set({ isLoadingEvidence: true, error: null });
    try {
      const pageSize = options?.pageSize ?? 500;
      const firstPage = await api.getEvidence(topicId, reportId, {
        ...options,
        pageSize,
        page: 1,
      });
      let allEvidence = firstPage?.evidence ?? [];
      const total = firstPage?.total ?? 0;

      // ★ 自动加载剩余页，确保 500+ 条证据时引用链接不失效
      if (total > pageSize) {
        const totalPages = Math.ceil(total / pageSize);
        const remainingPages = Array.from(
          { length: totalPages - 1 },
          (_, i) => i + 2
        );
        const results = await Promise.all(
          remainingPages.map((page) =>
            api.getEvidence(topicId, reportId, {
              ...options,
              pageSize,
              page,
            })
          )
        );
        for (const r of results) {
          if (r?.evidence) {
            allEvidence = allEvidence.concat(r.evidence);
          }
        }
      }

      set({
        evidence: allEvidence,
        evidenceTotal: total,
        isLoadingEvidence: false,
      });
    } catch (error) {
      // ★ 报告不存在时不应设置 error 状态（新专题或报告被删除）
      set({
        isLoadingEvidence: false,
        ...(isReportNotFoundError(error)
          ? {}
          : {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to fetch evidence',
            }),
      });
      if (!isReportNotFoundError(error)) {
        throw error;
      }
    }
  },

  // ==================== Schedule ====================

  fetchSchedule: async (topicId) => {
    try {
      const schedule = await api.getSchedule(topicId);
      set({ schedule });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to fetch schedule',
      });
      throw error;
    }
  },

  updateSchedule: async (topicId, dto) => {
    const schedule = await api.updateSchedule(topicId, dto);
    set({ schedule });
  },

  // ==================== Logs ====================

  fetchLogs: async (topicId, options) => {
    set({ isLoadingLogs: true, error: null });
    try {
      const logs = await api.getLogs(topicId, options);
      set({ logs, isLoadingLogs: false });
    } catch (error) {
      set({
        isLoadingLogs: false,
        error: error instanceof Error ? error.message : 'Failed to fetch logs',
      });
      throw error;
    }
  },

  // ==================== Stats ====================

  fetchStats: async (topicId) => {
    try {
      const stats = await api.getStats(topicId);
      set({ stats });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch stats',
      });
      throw error;
    }
  },

  // ==================== Templates ====================

  fetchTemplates: async (type) => {
    set({ isLoadingTemplates: true, error: null });
    try {
      const templates = await api.getTemplates(type);
      set({ templates, isLoadingTemplates: false });
    } catch (error) {
      set({
        isLoadingTemplates: false,
        error:
          error instanceof Error ? error.message : 'Failed to fetch templates',
      });
      throw error;
    }
  },

  createFromTemplate: async (templateId, overrides) => {
    const topic = await api.createFromTemplate(templateId, overrides);
    set((state) => ({ topics: [topic, ...state.topics] }));
    return topic;
  },

  // ==================== TODOs ====================

  fetchTodos: async (topicId, missionId) => {
    set({ isLoadingTodos: true, error: null });
    try {
      const response = await api.getTodos(topicId, { missionId });
      set({
        todos: response.todos,
        todosSummary: response.summary,
        isLoadingTodos: false,
      });
    } catch (error) {
      set({
        isLoadingTodos: false,
        error: error instanceof Error ? error.message : 'Failed to fetch todos',
      });
      throw error;
    }
  },

  pauseTodo: async (topicId, todoId) => {
    try {
      const response = await api.pauseTodo(topicId, todoId);
      set((state) => ({
        todos: state.todos.map((t) => (t.id === todoId ? response.todo : t)),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to pause todo',
      });
      throw error;
    }
  },

  resumeTodo: async (topicId, todoId) => {
    try {
      const response = await api.resumeTodo(topicId, todoId);
      set((state) => ({
        todos: state.todos.map((t) => (t.id === todoId ? response.todo : t)),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to resume todo',
      });
      throw error;
    }
  },

  cancelTodo: async (topicId, todoId, reason) => {
    try {
      const response = await api.cancelTodo(topicId, todoId, reason);
      set((state) => ({
        todos: state.todos.map((t) => (t.id === todoId ? response.todo : t)),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to cancel todo',
      });
      throw error;
    }
  },

  retryTodo: async (topicId, todoId) => {
    try {
      const response = await api.retryTodo(topicId, todoId);
      set((state) => ({
        todos: state.todos.map((t) => (t.id === todoId ? response.todo : t)),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to retry todo',
      });
      throw error;
    }
  },

  prioritizeTodo: async (topicId, todoId, priority) => {
    try {
      const response = await api.prioritizeTodo(topicId, todoId, priority);
      set((state) => ({
        todos: state.todos.map((t) => (t.id === todoId ? response.todo : t)),
      }));
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to prioritize todo',
      });
      throw error;
    }
  },

  selectTodo: (todoId) => {
    set({ selectedTodoId: todoId });
  },

  updateTodoFromWs: (todo) => {
    set((state) => {
      const existingIndex = state.todos.findIndex((t) => t.id === todo.id);
      if (existingIndex >= 0) {
        // Update existing todo
        const newTodos = [...state.todos];
        newTodos[existingIndex] = todo;
        return { todos: newTodos };
      } else {
        // Add new todo
        return { todos: [todo, ...state.todos] };
      }
    });
  },

  createUserRequestTodo: async (topicId, missionId, title, description) => {
    try {
      const response = await api.createUserRequestTodo(
        topicId,
        missionId,
        title,
        description
      );
      set((state) => ({
        todos: [response.todo, ...state.todos],
      }));
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create user request todo',
      });
      throw error;
    }
  },

  // ==================== UI ====================

  clearError: () => {
    set({ error: null });
  },

  resetStore: () => {
    get().stopRefreshProgressStream();
    get().stopMissionPolling();
    set({
      topics: [],
      topicsTotal: 0,
      hasMoreTopics: false,
      isLoadingMoreTopics: false,
      currentTopic: null,
      isLoadingTopics: false,
      dimensions: [],
      isLoadingDimensions: false,
      reports: [],
      currentReport: null,
      isLoadingReports: false,
      hasMoreReports: false,
      reportsCursor: null,
      evidence: [],
      isLoadingEvidence: false,
      evidenceTotal: 0,
      refreshStatus: null,
      isRefreshing: false,
      refreshProgress: null,
      refreshStream: null,
      currentMission: null,
      missionStatus: null,
      teamInfo: null,
      isLoadingMission: false,
      missionPollingInterval: null,
      teamMessages: [],
      agentActivities: [],
      isLoadingTeamData: false,
      schedule: null,
      logs: [],
      isLoadingLogs: false,
      stats: null,
      templates: [],
      isLoadingTemplates: false,
      comparisonResult: null,
      todos: [],
      todosSummary: null,
      selectedTodoId: null,
      isLoadingTodos: false,
      error: null,
    });
  },

  /**
   * ★ 重置当前专题相关数据（切换专题时调用）
   * 保留 topics 列表和 templates，只清空当前专题的详情数据
   * 解决切换专题时显示旧数据的问题
   */
  resetTopicData: () => {
    get().stopRefreshProgressStream();
    get().stopMissionPolling();
    set({
      // 保留 topics、currentTopic、isLoadingTopics（由外层管理）
      // 保留 templates、isLoadingTemplates（全局共享）
      // 清空当前专题相关数据
      dimensions: [],
      isLoadingDimensions: false,
      reports: [],
      currentReport: null,
      isLoadingReports: false,
      hasMoreReports: false,
      reportsCursor: null,
      evidence: [],
      isLoadingEvidence: false,
      evidenceTotal: 0,
      refreshStatus: null,
      isRefreshing: false,
      refreshProgress: null,
      refreshStream: null,
      currentMission: null,
      missionStatus: null,
      teamInfo: null,
      isLoadingMission: false,
      missionPollingInterval: null,
      teamMessages: [],
      agentActivities: [],
      isLoadingTeamData: false,
      schedule: null,
      logs: [],
      isLoadingLogs: false,
      stats: null,
      comparisonResult: null,
      todos: [],
      todosSummary: null,
      selectedTodoId: null,
      isLoadingTodos: false,
      error: null,
    });
  },
}));
