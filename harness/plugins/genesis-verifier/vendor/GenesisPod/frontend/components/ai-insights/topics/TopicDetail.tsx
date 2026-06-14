'use client';

/**
 * Topic Detail Component
 *
 * 专题详情页面 - 使用新的左右分栏布局
 * v7.0: 支持 Leader 驱动的研究模式
 * v7.1: 集成 WebSocket 实时事件推送
 */

import { useEffect, useCallback, useMemo, useState } from 'react';
import type { ResearchTopic } from '@/lib/types/topic-insights';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
import { useResearchWebSocket } from '@/hooks/features/useResearchWebSocket';
import { TopicResearchLayout } from './TopicResearchLayout';
import { ExportDialog } from '@/components/common/dialogs/ExportDialog';
import { countWords } from '@/lib/markdown/countWords';

interface TopicDetailProps {
  topic: ResearchTopic;
  onBack: () => void;
  /** ★ 初始视图（用于分享链接直接跳转到报告） */
  initialView?: string | null;
}

export function TopicDetail({ topic, onBack, initialView }: TopicDetailProps) {
  const {
    dimensions,
    currentReport,
    reports,
    evidence,
    isRefreshing,
    refreshProgress,
    missionStatus,
    teamInfo,
    teamMessages,
    agentActivities,
    isLoadingReports,
    isLoadingEvidence,
    error,
    fetchDimensions,
    fetchLatestReport,
    fetchReports,
    fetchReport,
    fetchMissionStatus,
    fetchTeamInfo,
    fetchTeamData,
    startLeaderPlan,
    cancelMission,
    retryMission,
    exportReport,
    sendLeaderInstruction,
    deleteReport,
    resetTopicData,
    setCurrentTopic,
    updateTopic,
  } = useTopicInsightsStore();

  // ★ 同步 topic 到 store，确保 ResearchSettingsModal 等组件能读取到 currentTopic
  useEffect(() => {
    setCurrentTopic(topic);
    return () => {
      // 离开页面时清除 currentTopic
      setCurrentTopic(null);
    };
  }, [topic, setCurrentTopic]);

  // WebSocket 实时事件
  const {
    events: wsEvents,
    isConnected: wsConnected,
    clearEvents: clearWsEvents,
  } = useResearchWebSocket(topic.id, { enabled: true });

  // Export dialog state
  const [showExport, setShowExport] = useState(false);

  // Load initial data
  useEffect(() => {
    // ★ 切换专题时先清空旧数据，避免显示上一个专题的脏数据
    resetTopicData();

    // 加载新专题的数据
    fetchDimensions(topic.id);
    fetchLatestReport(topic.id);
    fetchReports(topic.id); // Load all report versions for version history
    fetchMissionStatus(topic.id);
    fetchTeamInfo(topic.id);
    fetchTeamData(topic.id); // Load persisted team messages and agent activities
  }, [
    topic.id,
    resetTopicData,
    fetchDimensions,
    fetchLatestReport,
    fetchReports,
    fetchMissionStatus,
    fetchTeamInfo,
    fetchTeamData,
  ]);

  // ★ Evidence 加载已移至 store.fetchLatestReport 内部链式调用，
  // 确保 topicId 与 reportId 始终一致，消除切换 topic 时的竞态条件。
  // 当 mission 完成后 fetchLatestReport 被再次调用时，evidence 也会自动刷新。

  // ★ H5: 轮询已由 store.startMissionPolling 统一管理（2s 间隔），
  // 此处仅在 isRefreshing 变化时获取一次 teamInfo
  useEffect(() => {
    if (isRefreshing) {
      fetchTeamInfo(topic.id);
    }
  }, [topic.id, isRefreshing, fetchTeamInfo]);

  // ★ 当任务完成时自动刷新报告和维度
  useEffect(() => {
    if (missionStatus?.status === 'COMPLETED') {
      // 任务完成后刷新报告数据
      fetchLatestReport(topic.id);
      // ★ 同时刷新维度状态，让章节视图显示完成标记
      fetchDimensions(topic.id);
    }
  }, [missionStatus?.status, topic.id, fetchLatestReport, fetchDimensions]);

  // ★ 监听 WebSocket 事件，当 TODO 完成时刷新维度列表和任务状态
  useEffect(() => {
    if (wsEvents.length === 0) return;

    // 检查最新的事件
    const latestEvent = wsEvents[wsEvents.length - 1];

    // 当有新维度创建时（TODO 完成且类型为 ADD_DIMENSION 或 DEEP_RESEARCH）
    if (latestEvent.type === 'todo:completed') {
      // 刷新维度列表以显示新创建的维度
      fetchDimensions(topic.id);
      // 刷新任务状态
      fetchMissionStatus(topic.id);
    }

    // 当有新任务创建时刷新任务状态
    if (latestEvent.type === 'todo:created') {
      fetchMissionStatus(topic.id);
    }
  }, [wsEvents, topic.id, fetchDimensions, fetchMissionStatus]);

  // Research depth state — load from topicConfig, sync from active mission
  const [researchDepth, setResearchDepth] = useState<
    'quick' | 'standard' | 'thorough'
  >(() => {
    // ★ 从 topicConfig 中恢复上次选择的深度
    const saved = (topic.topicConfig as Record<string, unknown> | undefined)
      ?.researchDepth as string | undefined;
    if (saved === 'quick' || saved === 'standard' || saved === 'thorough') {
      return saved;
    }
    return 'standard';
  });

  useEffect(() => {
    if (missionStatus?.researchDepth) {
      setResearchDepth(missionStatus.researchDepth);
    }
  }, [missionStatus?.researchDepth]);

  // AI quality review state — load from topicConfig
  const [enableAiQualityReview, setEnableAiQualityReview] = useState<boolean>(
    () => {
      const saved = (topic.topicConfig as Record<string, unknown> | undefined)
        ?.enableAiQualityReview;
      return saved === true;
    }
  );

  const handleEnableAiQualityReviewChange = useCallback(
    (enabled: boolean) => {
      setEnableAiQualityReview(enabled);
      const currentConfig = (topic.topicConfig || {}) as Record<
        string,
        unknown
      >;
      updateTopic(topic.id, {
        topicConfig: { ...currentConfig, enableAiQualityReview: enabled },
      }).catch(() => {});
    },
    [topic.id, topic.topicConfig, updateTopic]
  );

  // ★ 持久化深度选择到 topicConfig
  const handleResearchDepthChange = useCallback(
    (depth: 'quick' | 'standard' | 'thorough') => {
      setResearchDepth(depth);
      // 异步保存到后端，不阻塞 UI
      // 使用当前最新的 topic.topicConfig（从闭包外获取，避免 stale closure）
      const currentConfig = (topic.topicConfig || {}) as Record<
        string,
        unknown
      >;
      updateTopic(topic.id, {
        topicConfig: { ...currentConfig, researchDepth: depth },
      }).catch(() => {
        // 保存失败不影响本地状态
      });
    },
    [topic.id, topic.topicConfig, updateTopic]
  );

  // Start Leader-driven research
  const handleStartResearch = useCallback(() => {
    startLeaderPlan(topic.id, undefined, 'fresh', researchDepth);
  }, [topic.id, startLeaderPlan, researchDepth]);

  const handleCancelRefresh = useCallback(async () => {
    try {
      await cancelMission(topic.id);
    } catch {
      // Error is already handled in store
    }
  }, [topic.id, cancelMission]);

  // ★ "更新"按钮 - 启动增量更新研究
  // 使用 incremental 模式：保留已完成的任务，只研究未完成的维度
  const handleContinueResearch = useCallback(async () => {
    try {
      await startLeaderPlan(topic.id, undefined, 'incremental', researchDepth);
    } catch {
      // Error is already handled in store
    }
  }, [topic.id, startLeaderPlan]);

  const handleExport = useCallback(() => {
    setShowExport(true);
  }, []);

  const handleSendLeaderInstruction = useCallback(
    async (instruction: string) => {
      try {
        await sendLeaderInstruction(topic.id, instruction);
      } catch {
        // Error is already handled in store
      }
    },
    [topic.id, sendLeaderInstruction]
  );

  // Handle version rollback - load the selected report version
  const handleRollbackVersion = useCallback(
    async (reportId: string) => {
      try {
        await fetchReport(topic.id, reportId);
      } catch {
        // Error is already handled in store
      }
    },
    [topic.id, fetchReport]
  );

  // Handle delete report - delete and refresh the report list
  const handleDeleteReport = useCallback(
    async (reportId: string) => {
      try {
        await deleteReport(topic.id, reportId);
        // Refresh reports list and fetch the latest remaining report
        await fetchReports(topic.id);
        await fetchLatestReport(topic.id);
      } catch {
        // Error is already handled in store
      }
    },
    [topic.id, deleteReport, fetchReports, fetchLatestReport]
  );

  // ★ 安全处理：确保 reports 是数组，防止 undefined 报错
  const safeReports = Array.isArray(reports) ? reports : [];

  // Convert reports to revisions format (include all versions)
  // ★ 使用 useMemo 并避免 new Date() 以防止 hydration 错误
  const revisions = useMemo(
    () =>
      safeReports.map((r) => ({
        id: r.id,
        version: r.version,
        // 使用字符串而非 Date 对象，避免 SSR/客户端不一致
        createdAt: r.generatedAt || r.updatedAt || r.createdAt || '',
        summary: r.title || `v${r.version}`,
        wordCount: countWords(r.fullReport),
        totalSources: r.totalSources || 0,
      })),
    [safeReports, currentReport?.id]
  );

  return (
    <>
      <TopicResearchLayout
        topic={topic}
        dimensions={dimensions}
        report={currentReport}
        evidence={evidence}
        revisions={revisions}
        isRefreshing={isRefreshing}
        refreshProgress={refreshProgress}
        missionStatus={missionStatus}
        teamInfo={teamInfo}
        isLoadingReport={isLoadingReports}
        isLoadingEvidence={isLoadingEvidence}
        onStartRefresh={handleStartResearch}
        onContinueRefresh={handleContinueResearch}
        onCancelRefresh={handleCancelRefresh}
        researchDepth={researchDepth}
        onResearchDepthChange={handleResearchDepthChange}
        enableAiQualityReview={enableAiQualityReview}
        onEnableAiQualityReviewChange={handleEnableAiQualityReviewChange}
        onExportReport={handleExport}
        onBack={onBack}
        onSendLeaderInstruction={handleSendLeaderInstruction}
        onRollbackVersion={handleRollbackVersion}
        onDeleteReport={handleDeleteReport}
        wsEvents={wsEvents}
        wsConnected={wsConnected}
        onClearWsEvents={clearWsEvents}
        error={error}
        initialView={initialView}
      />
      <ExportDialog
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        contentSelector="[data-export-content='insights']"
        contentTitle={topic.name}
        moduleType="insights"
        sourceId={topic.id}
      />
    </>
  );
}
