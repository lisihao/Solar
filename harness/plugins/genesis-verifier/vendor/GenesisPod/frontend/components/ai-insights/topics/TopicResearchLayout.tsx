'use client';

/**
 * Topic Research Layout - 专题研究主布局组件
 *
 * 采用左右分栏布局:
 * - 左侧: 紧凑型研究团队 Canvas (固定宽度 ~360px)
 * - 右侧: Tab 内容区 (可伸缩)
 *
 * 设计参考 AI Writing 布局模式
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  ResearchTopic,
  TopicDimension,
  TopicReport,
  TopicEvidence,
} from '@/lib/types/topic-insights';
import type { MissionStatus, TeamInfo } from '@/services/topic-insights/api';
import { checkEditPermission } from '@/services/topic-insights/api';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/lib/i18n';
import { TopicTeamPanel } from './TopicTeamPanel';
import { TopicContentPanel } from './TopicContentPanel';
import { ResearchSettingsModal } from '../research-control/ResearchSettingsModal';

// 简化的刷新进度类型
interface SimpleRefreshProgress {
  phase: string;
  progress: number;
  message: string;
  currentDimension?: string;
  completedDimensions: number;
  totalDimensions: number;
}

// WebSocket 事件类型
interface WsEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

// Report revision for version history
// ★ 使用 string | Date 避免 hydration 错误
interface ReportRevision {
  id: string;
  version: number;
  createdAt: string | Date;
  summary?: string;
  wordCount?: number;
  totalSources?: number;
}

interface TopicResearchLayoutProps {
  topic: ResearchTopic;
  dimensions: TopicDimension[];
  report: TopicReport | null;
  evidence: TopicEvidence[];
  revisions?: ReportRevision[];
  isRefreshing: boolean;
  refreshProgress: SimpleRefreshProgress | null;
  missionStatus?: MissionStatus | null;
  teamInfo?: TeamInfo | null;
  isLoadingReport: boolean;
  isLoadingEvidence: boolean;
  onStartRefresh: () => void;
  onContinueRefresh?: () => void;
  onCancelRefresh: () => void;
  onExportReport: () => void;
  onBack: () => void;
  onSendLeaderInstruction?: (instruction: string) => void;
  onRollbackVersion?: (revisionId: string) => void;
  // WebSocket 实时事件
  wsEvents?: WsEvent[];
  wsConnected?: boolean;
  onClearWsEvents?: () => void;
  /** 错误信息 */
  error?: string | null;
  /** Callback to delete the current report */
  onDeleteReport?: (reportId: string) => Promise<void>;
  /** ★ 初始视图（用于分享链接直接跳转到报告） */
  initialView?: string | null;
  /** V5: 研究深度 */
  researchDepth?: 'quick' | 'standard' | 'thorough';
  onResearchDepthChange?: (depth: 'quick' | 'standard' | 'thorough') => void;
  /** AI Quality Review toggle */
  enableAiQualityReview?: boolean;
  onEnableAiQualityReviewChange?: (enabled: boolean) => void;
}

// Icons
const ArrowLeftIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 19l-7-7m0 0l7-7m-7 7h18"
    />
  </svg>
);

const SettingsIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

const ExpandIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
    />
  </svg>
);

const CollapseIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 9V5m0 0H5m4 0L4 10m11-1V5m0 0h4m-4 0l5 5M9 15v4m0 0H5m4 0l-5-5m11 5l5-5m-5 5v-4m0 4h4"
    />
  </svg>
);

// Topic type gradient
const topicTypeGradients: Record<string, string> = {
  MACRO: 'from-blue-500 to-cyan-600',
  TECHNOLOGY: 'from-purple-500 to-pink-600',
  COMPANY: 'from-emerald-500 to-teal-600',
};

export function TopicResearchLayout({
  topic,
  dimensions,
  report,
  evidence,
  revisions = [],
  isRefreshing,
  refreshProgress,
  missionStatus,
  teamInfo,
  isLoadingReport,
  isLoadingEvidence,
  onStartRefresh,
  onContinueRefresh,
  onCancelRefresh,
  onExportReport,
  onBack,
  onSendLeaderInstruction,
  onRollbackVersion,
  wsEvents,
  wsConnected,
  onClearWsEvents,
  error,
  onDeleteReport,
  initialView,
  researchDepth,
  onResearchDepthChange,
  enableAiQualityReview,
  onEnableAiQualityReviewChange,
}: TopicResearchLayoutProps) {
  const { t } = useI18n();
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const { user } = useAuth();

  const gradient = topicTypeGradients[topic.type] || topicTypeGradients.MACRO;

  // ★ 权限检查：所有者或 EDITOR/ADMIN 协作者可以运行任务
  useEffect(() => {
    if (!user?.id) {
      setCanEdit(false);
      return;
    }

    // 先做本地快速检查：如果是所有者，立即设置权限
    const ownerId = topic.userId || topic.createdById;
    if (ownerId === user.id) {
      setCanEdit(true);
      return;
    }

    // ★ 根据可见性决定是否需要检查协作者权限
    const visibility = topic.visibility;

    // PRIVATE: 非所有者不可能有权限访问（能看到说明已经是所有者）
    // PUBLIC: 非所有者只有查看权限，没有编辑权限
    if (visibility === 'PRIVATE' || visibility === 'PUBLIC') {
      setCanEdit(false);
      return;
    }

    // SHARED: 需要检查协作者权限（可能是 EDITOR 或 ADMIN）
    if (visibility === 'SHARED') {
      checkEditPermission(topic.id, user.id)
        .then((hasPermission) => setCanEdit(hasPermission))
        .catch(() => setCanEdit(false));
      return;
    }

    // 未知可见性，默认无权限（避免不必要的 API 调用）
    setCanEdit(false);
  }, [user?.id, topic.id, topic.userId, topic.createdById, topic.visibility]);

  const handleExport = useCallback(() => {
    onExportReport();
  }, [onExportReport]);

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title={t('topicResearch.layout.backToList')}
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-md`}
            >
              <svg
                className="h-5 w-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{topic.name}</h1>
              {topic.description && (
                <p className="max-w-md truncate text-sm text-gray-500">
                  {topic.description
                    .replace(/#{1,6}\s|[*_~`>|]|\[([^\]]*)\]\([^)]*\)/g, '$1')
                    .replace(/^\s*[-\d.]+\s+/gm, '')
                    .replace(/\n+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 120)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 状态指示 */}
          {isRefreshing && (
            <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></span>
              <span className="text-sm font-medium text-blue-700">
                {refreshProgress?.message ||
                  t('topicResearch.layout.researching')}
              </span>
            </div>
          )}

          {/* 设置按钮 */}
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            title={t('topicResearch.layout.settings')}
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Team Canvas */}
        <div
          className={`flex-shrink-0 border-r border-gray-200 bg-white transition-all duration-300 ${
            leftPanelCollapsed ? 'w-12' : 'w-[360px]'
          }`}
        >
          {leftPanelCollapsed ? (
            // 收起状态
            <div className="flex h-full flex-col items-center py-4">
              <button
                onClick={() => setLeftPanelCollapsed(false)}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title={t('topicResearch.layout.expandTeamPanel')}
              >
                <ExpandIcon className="h-5 w-5" />
              </button>

              {/* 垂直状态指示 */}
              <div className="mt-4 flex flex-col items-center gap-2">
                {isRefreshing && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></span>
                )}
                <span
                  className="writing-mode-vertical text-xs text-gray-500"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {t('topicResearch.teamPanel.title')}
                </span>
              </div>
            </div>
          ) : (
            // 展开状态
            <div className="flex h-full flex-col">
              {/* 面板头部 */}
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t('topicResearch.teamPanel.title')}
                </span>
                <button
                  onClick={() => setLeftPanelCollapsed(true)}
                  className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title={t('topicResearch.layout.collapsePanel')}
                >
                  <CollapseIcon className="h-4 w-4" />
                </button>
              </div>

              {/* 团队面板内容 */}
              <div className="flex-1 overflow-hidden">
                <TopicTeamPanel
                  topicId={topic.id}
                  topicName={topic.name}
                  missionStatus={missionStatus}
                  isRefreshing={isRefreshing}
                  refreshProgress={refreshProgress}
                  onStartRefresh={onStartRefresh}
                  onContinueRefresh={onContinueRefresh}
                  onCancelRefresh={onCancelRefresh}
                  error={error}
                  canEdit={canEdit}
                  teamInfo={teamInfo}
                  researchDepth={researchDepth}
                  onResearchDepthChange={onResearchDepthChange}
                  enableAiQualityReview={enableAiQualityReview}
                  onEnableAiQualityReviewChange={onEnableAiQualityReviewChange}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Content Area */}
        <div className="flex-1 overflow-hidden">
          <TopicContentPanel
            topicId={topic.id}
            topicName={topic.name}
            report={report}
            dimensions={dimensions}
            evidence={evidence}
            revisions={revisions}
            isLoadingReport={isLoadingReport}
            isLoadingEvidence={isLoadingEvidence}
            onExportReport={handleExport}
            onRollbackVersion={onRollbackVersion}
            onSendLeaderInstruction={onSendLeaderInstruction}
            isRefreshing={isRefreshing}
            wsEvents={wsEvents}
            wsConnected={wsConnected}
            onClearWsEvents={onClearWsEvents}
            missionStatus={missionStatus}
            onDeleteReport={onDeleteReport}
            initialView={initialView}
            canEdit={canEdit}
          />
        </div>
      </div>

      {/* 设置弹窗 */}
      <ResearchSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        topicId={topic.id}
      />
    </div>
  );
}
