'use client';

/**
 * Topic Content Panel - 专题研究内容面板
 *
 * 设计参考 AI Writing 实现:
 * 1. 洞察报告 - Markdown 文档视图 + 大纲导航
 * 2. 团队互动 - Agent 对话历史、Leader 决策过程
 * 3. Agent思考架构 - 每个 Agent 的推理链路
 * 4. 参考文献 - 引用管理
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { confirm } from '@/stores';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { KATEX_OPTIONS } from '@/lib/markdown/katexOptions';
import { preprocessLatex } from '@/lib/markdown/preprocessLatex';
import { MarkdownViewer } from '@/components/common/markdown-viewer';
import { useReportRevisions } from '@/hooks/domain/useReportRevisions';
import { countWords } from '@/lib/markdown/countWords';
import {
  Shield,
  Maximize2,
  X,
  RefreshCw,
  Zap,
  Link2,
  CheckCircle2,
  Search,
  Loader2,
  Brain,
  ShieldCheck,
  FileText,
  PartyPopper,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { QuickViewReport } from '../reports/QuickViewReport';
import { ClientDate } from '@/components/common/ClientDate';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import type {
  TopicReport,
  TopicDimension,
  TopicEvidence,
} from '@/lib/types/topic-insights';
import type { MissionStatus } from '@/services/topic-insights/api';
import {
  getAnnotations,
  createAnnotation,
  updateAnnotation as updateAnnotationApi,
  deleteAnnotation as deleteAnnotationApi,
  resolveAnnotation as resolveAnnotationApi,
  aiEditReport,
  updateTopicVisibility,
  regenerateReportContent,
  getReport,
  type ReportAnnotation as ApiReportAnnotation,
  type AIEditOperation as AIEditOperationType,
} from '@/services/topic-insights/api';
import { ReportEditPanel } from '../reports/ReportEditPanel';
import { ChapterizedReportView } from '../reports/ChapterizedReportView';
import { ReportRevisionHistory } from '../reports/ReportRevisionHistory';
import { GenerateSlidesButton } from './GenerateSlidesButton';
import { ReportAnnotations } from '@/components/common/annotations/ReportAnnotations';
import { useTopicInsightsStore } from '@/stores/topicInsightsStore';
// AI Edit 优化组件
import { useAIEdit } from '@/components/common/ai-text-edit/useAIEdit';
import { AIEditInputModal } from '@/components/common/ai-text-edit/AIEditInputModal';
import { AIEditPreviewModal } from '@/components/common/ai-text-edit/AIEditPreviewModal';
// Phase 1-3 优化组件
import { CredibilityPanel } from '../panels/CredibilityPanel';
// Phase TODO UX 优化组件 - 新的研究协作面板（合并原 thinking/history/collaboration）
import { ResearchCollaborationPanel } from '../collaboration/ResearchCollaborationPanel';
// 洞察历史组件 - 简化版，显示会话列表 + 对比功能
import { ResearchTimeline } from '../collaboration/ResearchTimeline';
// ★ v5: 质量探针面板 — 已集成到 CredibilityPanel 中，不再单独渲染
// ★ v8: Pipeline 阶段指示器
import {
  PipelinePhaseIndicator,
  derivePipelinePhase,
} from '../collaboration/PipelinePhaseIndicator';
// 算力消耗 Tab - 显示 LLM 调用、Token 消耗、积分记录
import { ComputeUsageTab } from './ComputeUsageTab';
// 反馈API - 用于将批注提交为反馈（统一使用 Core Feedback）
import { apiClient } from '@/lib/api/client';
// ★ 使用共享模块的引用导航回调
import {
  setCitationClickCallback,
  triggerCitationClick,
} from '@/components/common/citations/citationNavigation';
import { safeString } from '@/lib/utils/common';
import { Tabs } from '@/components/ui/tabs';
import { Modal } from '@/components/ui/dialogs/Modal';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';

// 报告视图模式
type ReportViewMode = 'continuous' | 'chapter' | 'quick';

import { logger } from '@/lib/utils/logger';
// Tab 类型定义
type TabType =
  | 'report'
  | 'collaboration'
  | 'references'
  | 'credibility'
  | 'research_collab'
  | 'history'
  | 'compute_usage';

// 研究事件类型
export interface ResearchEvent {
  id: string;
  timestamp: Date;
  agentType: 'leader' | 'researcher' | 'reviewer' | 'synthesizer';
  agentName: string;
  eventType: 'start' | 'progress' | 'complete' | 'error' | 'decision';
  dimensionName?: string;
  message: string;
  details?: string;
}

// Agent 思考记录
export interface AgentThinking {
  id: string;
  agentType: 'leader' | 'researcher' | 'reviewer' | 'synthesizer';
  agentName: string;
  timestamp: Date;
  phase: string;
  thinking: string;
  decision?: string;
  reasoning?: string;
}

// Report revision for version history
interface ReportRevision {
  id: string;
  version: number;
  // ★ 使用字符串类型避免 Date 对象导致的 hydration 错误
  createdAt: string | Date;
  summary?: string;
  wordCount?: number;
  totalSources?: number;
  author?: string;
}

// WebSocket 事件类型
interface WsEvent {
  type: string;
  data: unknown;
  timestamp: string;
}

// ★ AI Writing 模式：消息详情类型（用于展开预览）
interface MessageDetail {
  type:
    | 'dimension_content'
    | 'report_preview'
    | 'leader_plan'
    | 'agent_analysis'
    | 'text';
  data: string | Record<string, unknown>;
}

// ★ AI Writing 模式：转换后的 UI 消息
interface UIMessage {
  id: string;
  type: 'system' | 'agent' | 'progress' | 'leader' | 'phase_separator';
  agent?: string;
  agentIcon?: string;
  agentColor?: string;
  agentBgColor?: string;
  agentType?: string; // for click-to-show-details
  content: string;
  timestamp: Date;
  detail?: MessageDetail; // ★ 可展开的详情
  progress?: number; // 0-100 进度
  status?: 'success' | 'error' | 'in_progress' | 'pending'; // ★ 消息状态，用于时间线颜色
  dimensionName?: string; // ★ 研究维度名称，用于按任务过滤
  /** ★ v8: 额外元数据（模型、搜索结果、审核评分等） */
  metadata?: Record<string, unknown>;
  /** ★ v8: 阶段分隔符的阶段名 */
  phaseName?: string;
}

interface TopicContentPanelProps {
  report: TopicReport | null;
  dimensions: TopicDimension[];
  evidence: TopicEvidence[];
  isLoadingReport: boolean;
  isLoadingEvidence: boolean;
  onExportReport?: () => void;
  researchEvents?: ResearchEvent[];
  agentThinkings?: AgentThinking[];
  /** Report revisions for version selection */
  revisions?: ReportRevision[];
  /** Callback to rollback to a specific version */
  onRollbackVersion?: (revisionId: string) => void;
  /** @Leader input callback */
  onSendLeaderInstruction?: (instruction: string) => void;
  /** Whether research is in progress */
  isRefreshing?: boolean;
  /** WebSocket events for real-time updates */
  wsEvents?: WsEvent[];
  /** WebSocket connection status */
  wsConnected?: boolean;
  /** Clear WebSocket events */
  onClearWsEvents?: () => void;
  /** Mission status from backend */
  missionStatus?: MissionStatus | null;
  /** Topic ID for TODO integration */
  topicId?: string;
  /** Callback to delete the current report */
  onDeleteReport?: (reportId: string) => Promise<void>;
  /** ★ 初始视图（用于分享链接直接跳转到报告） */
  initialView?: string | null;
  /** ★ 是否有编辑权限（所有者或 EDITOR/ADMIN 协作者） */
  canEdit?: boolean;
  /** 专题名称，用于相关研究 Tab 搜索 */
  topicName?: string;
}

// Icons
const DocumentIcon = ({ className }: { className?: string }) => (
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
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  </svg>
);

const LinkIcon = ({ className }: { className?: string }) => (
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
      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
    />
  </svg>
);

const DownloadIcon = ({ className }: { className?: string }) => (
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
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
    />
  </svg>
);

const ChevronDownIcon = ({ className }: { className?: string }) => (
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
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

const SpinnerIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24">
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const TeamIcon = ({ className }: { className?: string }) => (
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
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
    />
  </svg>
);

const ThinkingIcon = ({ className }: { className?: string }) => (
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
      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
    />
  </svg>
);

const CredibilityIcon = ({ className }: { className?: string }) => (
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
      d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
    />
  </svg>
);

const HistoryIcon = ({ className }: { className?: string }) => (
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
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const AnnotationIcon = ({ className }: { className?: string }) => (
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
      d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
    />
  </svg>
);

const ListIcon = ({ className }: { className?: string }) => (
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
      d="M4 6h16M4 10h16M4 14h16M4 18h16"
    />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
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
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
);

export function TopicContentPanel({
  report,
  dimensions,
  evidence,
  isLoadingReport,
  isLoadingEvidence,
  onExportReport,
  researchEvents = [],
  agentThinkings = [],
  revisions = [],
  onRollbackVersion,
  onSendLeaderInstruction,
  isRefreshing = false,
  wsEvents = [],
  wsConnected = false,
  onClearWsEvents,
  missionStatus,
  topicId,
  onDeleteReport,
  initialView,
  canEdit = false,
  topicName,
}: TopicContentPanelProps) {
  const { t } = useI18n();
  const { user } = useAuth();

  // Get persisted team data from store
  const {
    teamMessages: persistedMessages,
    agentActivities: persistedActivities,
    resetTopicData,
    selectedTodoId,
  } = useTopicInsightsStore();

  // 组合清除函数：同时清除 WebSocket 消息和持久化消息
  const handleClearAllMessages = useCallback(() => {
    onClearWsEvents?.();
    resetTopicData();
  }, [onClearWsEvents, resetTopicData]);

  // ★ 使用固定初始值避免 hydration 错误（useSearchParams 在 SSR 时为空）
  const [activeTab, setActiveTab] = useState<TabType>('research_collab');

  // ★ 在客户端 hydration 后根据 initialView 切换 Tab
  useEffect(() => {
    if (initialView === 'report') {
      setActiveTab('report');
    }
  }, [initialView]);

  // ★ 当 store 中 selectedTodoId 被设置（如从 Leader 对话弹窗里点击 TODO 徽章），
  // 自动切到 research_collab tab 让 TodoDetailPanel 显示出来
  useEffect(() => {
    if (selectedTodoId && activeTab !== 'research_collab') {
      setActiveTab('research_collab');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTodoId]);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  // Toast 提示状态
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  // ★ 重新生成报告状态
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState('');

  // ★ 组件挂载状态 ref，防止 doRegenerate 轮询在组件卸载后继续执行
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ★ 重新生成报告处理函数（异步：后端立即返回 202，前端轮询等待完成）
  const doRegenerate = useCallback(
    async (feedback?: string) => {
      if (!topicId || !report?.id || isRegenerating) return;

      setIsRegenerating(true);
      setShowRegenerateDialog(false);
      try {
        const beforeGeneratedAt = report.generatedAt;
        await regenerateReportContent(
          topicId,
          report.id,
          feedback || undefined
        );
        setToast({
          message: t('topicResearch.contentPanel.toast.regenerating'),
          type: 'success',
        });
        // 轮询等待报告生成完成（generatedAt 变化表示完成）
        const maxAttempts = 40; // 最多等待 ~2 分钟
        for (let i = 0; i < maxAttempts; i++) {
          if (!isMountedRef.current) return;
          await new Promise((r) => setTimeout(r, 3000));
          if (!isMountedRef.current) return;
          try {
            const updated = await getReport(topicId, report.id);
            if (updated.generatedAt !== beforeGeneratedAt) {
              if (isMountedRef.current) {
                window.location.reload();
              }
              return;
            }
          } catch {
            // 忽略轮询错误，继续重试
          }
        }
        // 超时后也刷新（可能已完成）
        if (isMountedRef.current) {
          window.location.reload();
        }
      } catch (error) {
        logger.error('Failed to regenerate report:', error);
        setToast({
          message: t('topicResearch.contentPanel.toast.regenerateFailed'),
          type: 'error',
        });
        setIsRegenerating(false);
      }
    },
    [topicId, report?.id, report?.generatedAt, isRegenerating]
  );

  const handleRegenerateReport = useCallback(() => {
    setRegenerateFeedback('');
    setShowRegenerateDialog(true);
  }, []);

  // ★ AI Edit Hook - 业务方注入 TI 的 aiEditReport 调用，hook 本身不耦合 TI
  const aiEdit = useAIEdit({
    executeEdit: async (req) => {
      const tid = topicId || '';
      const rid = report?.id || '';
      if (!tid || !rid) {
        throw new Error('Topic / report not loaded');
      }
      const r = await aiEditReport(tid, rid, {
        operation: req.operation,
        selectedText: req.selectedText,
        context: req.instruction,
        fullContent: req.fullContent,
        selectorPrefix: req.selectorPrefix,
        selectorSuffix: req.selectorSuffix,
      });
      return { editedContent: r.editedContent || '' };
    },
    onSuccess: () => {
      setToast({
        message: t('topicResearch.contentPanel.toast.aiEditApplied'),
        type: 'success',
      });
      // TODO: 刷新报告内容
    },
    onError: (error) => {
      setToast({ message: error.message, type: 'error' });
    },
    fullContent: report?.fullReport,
  });

  // 复制分享链接 - 指向报告阅读页面（左侧目录+右侧内容布局）
  // ★ 会自动将专题设置为公开，使分享链接可访问
  const handleShareLink = useCallback(async () => {
    if (!report || !topicId) {
      setToast({
        message: t('topicResearch.contentPanel.toast.cannotGenerateShareLink'),
        type: 'error',
      });
      return;
    }

    // ★ 先确认：会将专题设为公开
    const shareUrl = `${window.location.origin}/share/topic/${topicId}`;
    const confirmed = await confirm({
      title:
        t('topicResearch.contentPanel.shareConfirm') ||
        '将生成公开分享链接，专题将设为公开可访问。是否继续？',
      type: 'warning',
    });
    if (!confirmed) return;

    try {
      // ★ 将专题设置为公开，确保分享链接可访问
      await updateTopicVisibility(topicId, 'PUBLIC');
      try {
        await navigator.clipboard.writeText(shareUrl);
        setToast({
          message: t('topicResearch.contentPanel.toast.shareLinkCopied'),
          type: 'success',
        });
      } catch {
        // 降级方案
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.value = shareUrl;
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        setToast({
          message: t('topicResearch.contentPanel.toast.shareLinkCopied'),
          type: 'success',
        });
      }
    } catch (err) {
      logger.error('Failed to set topic public:', err);
      setToast({
        message: t('topicResearch.contentPanel.toast.setPublicFailed'),
        type: 'error',
      });
    }
  }, [report, topicId]);

  // 自动隐藏 toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const [reportViewMode, setReportViewMode] =
    useState<ReportViewMode>('continuous');
  const [sidePanelType, setSidePanelType] = useState<
    null | 'history' | 'annotations'
  >(null);

  // ★ 计算版本列表 —— 走平台 useReportRevisions Hook
  // 幂等点：computeDelta=false 保留 TI 原行为（所有条目 wordCountDelta=0）
  // 旧 TI 用 fullReport.length 作 wordCount，hook 接 wordCount 字段，故映射时传入
  const allRevisions = useReportRevisions({
    current: report
      ? {
          id: report.id,
          version: report.version,
          totalSources: report.totalSources,
          wordCount: report.fullReport?.length ?? 0,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        }
      : null,
    revisions,
  });

  // ★ 最大化模式状态
  const [isMaximized, setIsMaximized] = useState(false);
  const scrollPositionRef = useRef(0);
  const reportContentRef = useRef<HTMLDivElement>(null);

  // ★ 进入最大化模式
  const enterMaximized = useCallback(() => {
    scrollPositionRef.current = reportContentRef.current?.scrollTop || 0;
    setIsMaximized(true);
  }, []);

  // ★ 退出最大化模式
  const exitMaximized = useCallback(() => {
    setIsMaximized(false);
    // 恢复滚动位置
    requestAnimationFrame(() => {
      reportContentRef.current?.scrollTo(0, scrollPositionRef.current);
    });
  }, []);

  // ★ 最大化快捷键支持
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框中触发
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      // F 键进入最大化（仅在报告 Tab 激活时）
      if (e.key === 'f' && !isMaximized && activeTab === 'report') {
        e.preventDefault();
        enterMaximized();
      }
      // Esc 键退出最大化
      if (e.key === 'Escape' && isMaximized) {
        e.preventDefault();
        exitMaximized();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMaximized, activeTab, enterMaximized, exitMaximized]);

  // Annotation state - now persisted to backend
  type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';
  type AnnotationStatus = 'active' | 'resolved' | 'archived';
  interface ReportAnnotation {
    id: string;
    reportId: string;
    userId: string;
    userName: string;
    userAvatar?: string;
    selectedText: string;
    content: string;
    startOffset: number;
    endOffset: number;
    sectionId?: string;
    color: AnnotationColor;
    status: AnnotationStatus;
    selectorPrefix?: string;
    selectorSuffix?: string;
    createdAt: string;
    updatedAt: string;
    replies?: Array<{
      id: string;
      userId: string;
      userName: string;
      userAvatar?: string;
      content: string;
      createdAt: string;
    }>;
  }

  const [annotations, setAnnotations] = useState<ReportAnnotation[]>([]);
  const [highlightedAnnotationId, setHighlightedAnnotationId] = useState<
    string | null
  >(null);
  const [isLoadingAnnotations, setIsLoadingAnnotations] = useState(false);

  // ★ Load annotations from backend when report changes
  // 公开专题的所有登录用户都可以查看和创建批注
  useEffect(() => {
    async function loadAnnotations() {
      if (!topicId || !report?.id) {
        setAnnotations([]);
        return;
      }

      setIsLoadingAnnotations(true);
      try {
        const apiAnnotations = await getAnnotations(topicId, report.id);
        // Convert API annotations to local format
        const localAnnotations: ReportAnnotation[] = apiAnnotations.map(
          (ann) => ({
            id: ann.id,
            reportId: ann.reportId,
            userId: ann.createdById,
            userName:
              ann.createdBy?.fullName ||
              ann.createdBy?.username ||
              t('topicResearch.contentPanel.user'),
            userAvatar: ann.createdBy?.avatarUrl,
            selectedText: ann.selectedText || '',
            content: ann.content,
            startOffset: ann.startOffset,
            endOffset: ann.endOffset,
            selectorPrefix: ann.selectorPrefix,
            selectorSuffix: ann.selectorSuffix,
            color: (ann.color || 'yellow') as AnnotationColor,
            status:
              ann.status === 'OPEN'
                ? 'active'
                : ann.status === 'RESOLVED'
                  ? 'resolved'
                  : 'archived',
            createdAt: ann.createdAt,
            updatedAt: ann.updatedAt,
            replies: [],
          })
        );
        setAnnotations(localAnnotations);
      } catch (error) {
        logger.error('Failed to load annotations:', error);
        setAnnotations([]);
      } finally {
        setIsLoadingAnnotations(false);
      }
    }

    loadAnnotations();
  }, [topicId, report?.id]);

  // ★ 用于自动展开证据卡片的 ID
  const [autoExpandEvidenceId, setAutoExpandEvidenceId] = useState<
    string | null
  >(null);

  // ★ 注册引用点击回调：切换到参考文献 tab 并滚动到指定来源
  useEffect(() => {
    const handleCitationClick = (evidenceId: string) => {
      // 切换到参考文献 tab
      setActiveTab('references');
      // 设置自动展开的 ID
      setAutoExpandEvidenceId(evidenceId);
      // 延迟滚动，等待 tab 切换完成
      setTimeout(() => {
        const element = document.getElementById(`evidence-${evidenceId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 添加高亮效果
          element.classList.add('ring-2', 'ring-purple-500', 'ring-offset-2');
          setTimeout(() => {
            element.classList.remove(
              'ring-2',
              'ring-purple-500',
              'ring-offset-2'
            );
          }, 2000);
        }
      }, 100);
    };
    setCitationClickCallback(handleCitationClick);
    return () => setCitationClickCallback(null);
  }, []);

  // Delete report state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Handle delete report with confirmation
  const handleDeleteReport = useCallback(async () => {
    if (!report?.id || !onDeleteReport) return;
    setIsDeleting(true);
    try {
      await onDeleteReport(report.id);
      setShowDeleteConfirm(false);
    } catch (error) {
      logger.error('Failed to delete report:', error);
    } finally {
      setIsDeleting(false);
    }
  }, [report?.id, onDeleteReport]);

  // Annotation handlers - now persisted to backend
  const handleAnnotationAdd = useCallback(
    async (
      annotation: Omit<
        ReportAnnotation,
        'id' | 'createdAt' | 'updatedAt' | 'replies'
      >
    ) => {
      if (!topicId || !report?.id) {
        logger.error('Cannot add annotation: missing topicId or reportId');
        return;
      }

      try {
        // Call backend API to create annotation
        // Note: selectorPrefix, selectorSuffix, color not yet in DB - saved locally only
        const created = await createAnnotation(topicId, report.id, {
          content: annotation.content || '',
          type: 'COMMENT',
          selectedText: annotation.selectedText,
          startOffset: annotation.startOffset,
          endOffset: annotation.endOffset,
        });

        // Convert API response to local format and add to state
        // Keep local fields (selectorPrefix, selectorSuffix, color) from input
        const newAnnotation: ReportAnnotation = {
          id: created.id,
          reportId: created.reportId,
          userId: created.createdById,
          userName:
            created.createdBy?.fullName ||
            created.createdBy?.username ||
            t('topicResearch.contentPanel.user'),
          userAvatar: created.createdBy?.avatarUrl,
          selectedText: created.selectedText || '',
          content: created.content,
          startOffset: created.startOffset,
          endOffset: created.endOffset,
          selectorPrefix: annotation.selectorPrefix,
          selectorSuffix: annotation.selectorSuffix,
          color: annotation.color || 'yellow',
          status: 'active',
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          replies: [],
        };
        setAnnotations((prev) => [...prev, newAnnotation]);
      } catch (error) {
        logger.error('Failed to create annotation:', error);
        // Fallback: create local-only annotation
        const newAnnotation: ReportAnnotation = {
          ...annotation,
          id: `ann-${Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          replies: [],
        };
        setAnnotations((prev) => [...prev, newAnnotation]);
      }
    },
    [topicId, report?.id]
  );

  const handleAnnotationUpdate = useCallback(
    async (annotationId: string, content: string) => {
      if (!topicId || !report?.id) return;

      try {
        await updateAnnotationApi(topicId, report.id, annotationId, {
          content,
        });
        setAnnotations((prev) =>
          prev.map((ann) =>
            ann.id === annotationId
              ? { ...ann, content, updatedAt: new Date().toISOString() }
              : ann
          )
        );
      } catch (error) {
        logger.error('Failed to update annotation:', error);
      }
    },
    [topicId, report?.id]
  );

  const handleAnnotationDelete = useCallback(
    async (annotationId: string) => {
      if (!topicId || !report?.id) return;

      try {
        await deleteAnnotationApi(topicId, report.id, annotationId);
        setAnnotations((prev) => prev.filter((ann) => ann.id !== annotationId));
      } catch (error) {
        logger.error('Failed to delete annotation:', error);
      }
    },
    [topicId, report?.id]
  );

  const handleAnnotationResolve = useCallback(
    async (annotationId: string) => {
      if (!topicId || !report?.id) return;

      try {
        await resolveAnnotationApi(topicId, report.id, annotationId);
        setAnnotations((prev) =>
          prev.map((ann) =>
            ann.id === annotationId
              ? {
                  ...ann,
                  status: 'resolved' as const,
                  updatedAt: new Date().toISOString(),
                }
              : ann
          )
        );
      } catch (error) {
        logger.error('Failed to resolve annotation:', error);
      }
    },
    [topicId, report?.id]
  );

  const handleAnnotationReply = useCallback(
    async (annotationId: string, content: string) => {
      // Note: Backend doesn't have reply functionality yet, so this is still local-only
      setAnnotations((prev) =>
        prev.map((ann) =>
          ann.id === annotationId
            ? {
                ...ann,
                replies: [
                  ...(ann.replies || []),
                  {
                    id: `reply-${Date.now()}`,
                    userId: user?.id || 'anonymous',
                    userName:
                      user?.username ||
                      user?.email ||
                      t('topicResearch.contentPanel.anonymousUser'),
                    content,
                    createdAt: new Date().toISOString(),
                  },
                ],
                updatedAt: new Date().toISOString(),
              }
            : ann
        )
      );
    },
    [user?.id, user?.username, user?.email]
  );

  // ★ 将批注提交为反馈 - 反馈闭环系统入口
  const handleSubmitFeedback = useCallback(async (annotationId: string) => {
    try {
      await apiClient.post(`/feedback/from-annotation/${annotationId}`);
      // 标记批注为已提交反馈（不改变 status）
      setAnnotations((prev) =>
        prev.map((ann) =>
          ann.id === annotationId
            ? {
                ...ann,
                feedbackSubmitted: true,
                updatedAt: new Date().toISOString(),
              }
            : ann
        )
      );
      setToast({
        message: t('topicResearch.contentPanel.toast.feedbackSubmitted'),
        type: 'success',
      });
    } catch (error) {
      logger.error('Failed to submit annotation as feedback:', error);
      setToast({
        message: t('topicResearch.contentPanel.toast.submitFeedbackFailed'),
        type: 'error',
      });
    }
  }, []);

  // Safe array fallbacks (★ 使用 Array.isArray 确保是数组)
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];
  const safeEvidence = Array.isArray(evidence) ? evidence : [];
  const safeEvents = Array.isArray(researchEvents) ? researchEvents : [];
  const safeThinkings = Array.isArray(agentThinkings) ? agentThinkings : [];

  // Tab 配置 - 顺序: TODO LIST → 协作动态 → 洞察报告 → 洞察历史 → 可信度 → 参考文献
  const tabs: {
    key: TabType;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    {
      key: 'research_collab',
      label: t('topicResearch.contentPanel.tabs.todoList'),
      icon: (
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
      ),
    },
    {
      key: 'collaboration',
      label: t('topicResearch.contentPanel.tabs.collaboration'),
      icon: <TeamIcon className="h-4 w-4" />,
      badge: safeEvents.length > 0 ? safeEvents.length : undefined,
    },
    {
      key: 'report',
      label: t('topicResearch.contentPanel.tabs.report'),
      icon: <DocumentIcon className="h-4 w-4" />,
    },
    {
      key: 'history',
      label: t('topicResearch.contentPanel.tabs.history'),
      icon: <HistoryIcon className="h-4 w-4" />,
    },
    {
      key: 'credibility',
      label: t('topicResearch.contentPanel.tabs.credibility'),
      icon: <CredibilityIcon className="h-4 w-4" />,
    },
    {
      key: 'references',
      label: t('topicResearch.contentPanel.tabs.references'),
      icon: <LinkIcon className="h-4 w-4" />,
      badge: report?.totalSources || safeEvidence.length,
    },
    {
      key: 'compute_usage',
      label: t('topicResearch.computeUsage.title'),
      icon: <Zap className="h-4 w-4" />,
    },
  ];

  return (
    <>
      {/* ★ 最大化视图 - 全屏覆盖层 */}
      {isMaximized && (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">
          {/* 顶部工具栏 */}
          <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
            {/* 左侧：返回按钮 + 视图切换 */}
            <div className="flex items-center gap-4">
              <button
                onClick={exitMaximized}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-gray-600 transition-colors hover:bg-gray-100"
                title={t('topicResearch.exitMaximize') + ' (Esc)'}
              >
                <X className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {t('topicResearch.exitMaximize')}
                </span>
              </button>

              {/* 视图模式切换 */}
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button
                  onClick={() => setReportViewMode('continuous')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    reportViewMode === 'continuous'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <ListIcon className="h-3.5 w-3.5" />
                  <span>{t('topicResearch.continuousView')}</span>
                </button>
                <button
                  onClick={() => setReportViewMode('chapter')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    reportViewMode === 'chapter'
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <DocumentIcon className="h-3.5 w-3.5" />
                  <span>{t('topicResearch.chapterView')}</span>
                </button>
                <button
                  onClick={() => setReportViewMode('quick')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    reportViewMode === 'quick'
                      ? 'bg-amber-50 text-amber-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  title="Quick View"
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>Quick</span>
                </button>
              </div>
            </div>

            {/* 中间：版本号 */}
            <div className="absolute left-1/2 -translate-x-1/2">
              {report && (
                <span className="text-sm font-medium text-gray-700">
                  v{report.version}
                </span>
              )}
            </div>

            {/* 右侧：操作按钮 - 图标形式 */}
            <div className="flex items-center gap-2">
              {/* 章节视图 → AI Slides 入口（带 executive-brief preset） */}
              {reportViewMode === 'chapter' && report && topicId && (
                <GenerateSlidesButton
                  topicId={topicId}
                  topicName={topicName}
                  preset="topic-insights.executive-brief"
                  label="转为 Slides"
                />
              )}

              {/* 重新生成按钮 */}
              <button
                onClick={handleRegenerateReport}
                disabled={isRegenerating}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={t('topicResearch.contentPanel.toolbar.regenerate')}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`}
                />
              </button>

              {/* 历史按钮 */}
              <button
                onClick={() =>
                  setSidePanelType(
                    sidePanelType === 'history' ? null : 'history'
                  )
                }
                className={`rounded-lg p-2 transition-colors ${
                  sidePanelType === 'history'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
                title={t('topicResearch.contentPanel.toolbar.history')}
              >
                <HistoryIcon className="h-4 w-4" />
              </button>

              {/* 批注按钮 */}
              <button
                onClick={() =>
                  setSidePanelType(
                    sidePanelType === 'annotations' ? null : 'annotations'
                  )
                }
                className={`relative rounded p-1.5 transition-colors ${
                  sidePanelType === 'annotations'
                    ? 'bg-purple-100 text-purple-600'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
                title={t('topicResearch.contentPanel.toolbar.annotations')}
              >
                <AnnotationIcon className="h-4 w-4" />
                {annotations.filter((a) => a.status === 'active').length >
                  0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                    {annotations.filter((a) => a.status === 'active').length}
                  </span>
                )}
              </button>
            </div>
          </header>

          {/* 内容区域 */}
          <main className="flex flex-1 overflow-hidden">
            {/* 报告内容 - 居中显示 */}
            <div
              ref={reportContentRef}
              className={`relative flex-1 overflow-auto ${sidePanelType ? 'border-r border-gray-200' : ''}`}
            >
              {/* ★ 重新生成报告遮罩 */}
              {isRegenerating && (
                <div className="sticky top-0 z-30 border-b border-blue-200 bg-blue-50 px-6 py-3">
                  <div className="mx-auto flex max-w-4xl items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-blue-800">
                        {t(
                          'topicResearch.contentPanel.regeneratingBanner.title'
                        )}
                      </p>
                      <p className="text-xs text-blue-600">
                        {t(
                          'topicResearch.contentPanel.regeneratingBanner.description'
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="mx-auto max-w-6xl px-8 py-6">
                <div
                  className={`rounded-lg bg-white p-8 shadow-sm ${isRegenerating ? 'pointer-events-none opacity-50' : ''}`}
                >
                  {reportViewMode === 'continuous' && report && (
                    <ReportEditPanel
                      report={report}
                      evidence={safeEvidence}
                      revisions={revisions}
                      annotations={annotations}
                      currentUserId={user?.id}
                      currentUserName={
                        user?.username ||
                        user?.email ||
                        t('topicResearch.contentPanel.user')
                      }
                      isLoading={isLoadingReport}
                      hideToolbar={true}
                      disableSidePanel={true}
                      sidePanelType={sidePanelType}
                      onSidePanelChange={setSidePanelType}
                      onOpenAIEdit={aiEdit.handleOpenEdit}
                      onAIEdit={async (operation, selection) => {
                        if (!topicId || !report?.id) return '';
                        try {
                          const result = await aiEditReport(
                            topicId,
                            report.id,
                            {
                              operation: operation as AIEditOperationType,
                              selectedText: selection?.text || undefined,
                            }
                          );
                          return result.editedContent || '';
                        } catch (error) {
                          logger.error('AI edit failed:', error);
                          return '';
                        }
                      }}
                      onRollback={
                        onRollbackVersion
                          ? async (revisionId: string) => {
                              onRollbackVersion(revisionId);
                            }
                          : undefined
                      }
                      onAnnotationAdd={handleAnnotationAdd}
                      onAnnotationUpdate={handleAnnotationUpdate}
                      onAnnotationDelete={handleAnnotationDelete}
                      onAnnotationResolve={handleAnnotationResolve}
                      onAnnotationReply={handleAnnotationReply}
                      onSubmitFeedback={handleSubmitFeedback}
                    />
                  )}
                  {reportViewMode === 'chapter' && report && (
                    <ChapterizedReportView
                      report={report}
                      dimensions={dimensions}
                      evidence={safeEvidence}
                      isLoading={isLoadingReport}
                      onOpenAIEdit={aiEdit.handleOpenEdit}
                      onAIEdit={async (operation, selection) => {
                        if (!topicId || !report?.id) return '';
                        try {
                          const result = await aiEditReport(
                            topicId,
                            report.id,
                            {
                              operation: operation as AIEditOperationType,
                              selectedText: selection || undefined,
                            }
                          );
                          return result.editedContent || '';
                        } catch (error) {
                          logger.error('AI edit failed:', error);
                          return '';
                        }
                      }}
                      onAddAnnotation={(data) => {
                        handleAnnotationAdd({
                          reportId: report?.id || '',
                          userId: user?.id || 'anonymous',
                          userName:
                            user?.username ||
                            user?.email ||
                            t('topicResearch.contentPanel.anonymousUser'),
                          selectedText: data.selectedText,
                          content: '',
                          startOffset: data.startOffset,
                          endOffset: data.endOffset,
                          color: data.color,
                          status: 'active',
                        });
                      }}
                      annotations={annotations.map((a) => ({
                        id: a.id,
                        selectedText: a.selectedText,
                        startOffset: a.startOffset,
                        endOffset: a.endOffset,
                        color: a.color,
                        status: a.status,
                        selectorPrefix: a.selectorPrefix,
                        selectorSuffix: a.selectorSuffix,
                      }))}
                      highlightedAnnotationId={highlightedAnnotationId}
                    />
                  )}
                  {reportViewMode === 'quick' && report && (
                    <QuickViewReport
                      report={report}
                      evidence={safeEvidence}
                      isLoading={isLoadingReport}
                    />
                  )}
                  {!report && (
                    <div className="py-20 text-center text-gray-500">
                      {t('topicResearch.noReport')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 侧边栏 - 历史/批注 */}
            {sidePanelType && (
              <div className="w-96 flex-shrink-0 overflow-hidden border-l border-gray-200 bg-white">
                {sidePanelType === 'history' && (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-gray-700">
                        {t('topicResearch.history')}
                      </h3>
                      <button
                        onClick={() => setSidePanelType(null)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-auto">
                      <ReportRevisionHistory
                        revisions={allRevisions}
                        currentVersion={report?.version || 1}
                        isLoading={false}
                        onRollback={
                          onRollbackVersion
                            ? async (revisionId: string) => {
                                onRollbackVersion(revisionId);
                              }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                )}
                {sidePanelType === 'annotations' && (
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-gray-700">
                        {t('topicResearch.annotations')}
                      </h3>
                      <button
                        onClick={() => setSidePanelType(null)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-auto">
                      <ReportAnnotations
                        annotations={annotations}
                        currentUserId={user?.id}
                        onUpdate={handleAnnotationUpdate}
                        onDelete={handleAnnotationDelete}
                        onResolve={handleAnnotationResolve}
                        onReply={handleAnnotationReply}
                        onSubmitFeedback={handleSubmitFeedback}
                        onNavigate={(annotationId: string) => {
                          setHighlightedAnnotationId(annotationId);
                          setTimeout(() => {
                            setHighlightedAnnotationId(null);
                          }, 3000);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {/* 常规视图 */}
      <div className="flex h-full flex-col bg-white">
        {/* Tab Header - 只包含 Tab，不包含工具栏 */}
        <Tabs
          className="overflow-x-auto px-4"
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            iconNode: tab.icon,
            count: tab.badge && tab.badge > 0 ? tab.badge : undefined,
          }))}
          value={activeTab}
          onChange={(k) => setActiveTab(k as TabType)}
        />

        {/* 报告工具栏 - 仅在报告 Tab 时显示，合并为一行 */}
        {activeTab === 'report' && (
          <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-2.5">
            {/* 左侧：视图切换 + 版本号 */}
            <div className="flex items-center gap-3">
              {/* 视图模式切换 */}
              <div className="flex rounded-md border border-gray-200 bg-white p-0.5">
                <button
                  onClick={() => setReportViewMode('continuous')}
                  className={`rounded p-1.5 transition-colors ${
                    reportViewMode === 'continuous'
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                  title={t('topicResearch.contentPanel.toolbar.continuousView')}
                >
                  <ListIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setReportViewMode('chapter')}
                  className={`rounded p-1.5 transition-colors ${
                    reportViewMode === 'chapter'
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                  title={t('topicResearch.contentPanel.toolbar.chapterView')}
                >
                  <DocumentIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setReportViewMode('quick')}
                  className={`rounded p-1.5 transition-colors ${
                    reportViewMode === 'quick'
                      ? 'bg-amber-50 text-amber-600'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                  }`}
                  title="Quick View"
                >
                  <Zap className="h-4 w-4" />
                </button>
              </div>

              {/* 版本号 */}
              {report && (
                <span className="text-sm font-medium text-gray-700">
                  v{report.version}
                </span>
              )}
            </div>

            {/* 右侧：操作按钮 - 只显示图标，悬停显示文字 */}
            <div className="flex items-center gap-2">
              {/* 重新生成按钮 */}
              <button
                onClick={handleRegenerateReport}
                disabled={isRegenerating}
                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={t(
                  'topicResearch.contentPanel.toolbar.regenerateTooltip'
                )}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`}
                />
              </button>

              {/* 历史按钮 */}
              <button
                onClick={() =>
                  setSidePanelType(
                    sidePanelType === 'history' ? null : 'history'
                  )
                }
                className={`relative rounded p-1.5 transition-colors ${
                  sidePanelType === 'history'
                    ? 'bg-blue-100 text-blue-600'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
                title={t('topicResearch.contentPanel.toolbar.historyTooltip')}
              >
                <HistoryIcon className="h-4 w-4" />
                {revisions.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-500 text-[10px] text-white">
                    {revisions.length}
                  </span>
                )}
              </button>

              {/* 批注按钮 */}
              <button
                onClick={() =>
                  setSidePanelType(
                    sidePanelType === 'annotations' ? null : 'annotations'
                  )
                }
                className={`relative rounded p-1.5 transition-colors ${
                  sidePanelType === 'annotations'
                    ? 'bg-purple-100 text-purple-600'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
                title={t(
                  'topicResearch.contentPanel.toolbar.annotationsTooltip'
                )}
              >
                <AnnotationIcon className="h-4 w-4" />
                {annotations.filter((a) => a.status === 'active').length >
                  0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                    {annotations.filter((a) => a.status === 'active').length}
                  </span>
                )}
              </button>

              {/* 分隔线 */}
              <div className="mx-1 h-5 w-px bg-gray-200" />

              {/* ★ 最大化按钮 */}
              <button
                onClick={enterMaximized}
                className="hidden rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 md:block"
                title={t('topicResearch.maximize') + ' (F)'}
              >
                <Maximize2 className="h-4 w-4" />
              </button>

              {/* 导出按钮 - 使用统一导出服务 */}
              {report && onExportReport && (
                <button
                  onClick={onExportReport}
                  className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  title={t('topicResearch.contentPanel.export')}
                >
                  <DownloadIcon className="h-4 w-4" />
                </button>
              )}

              {/* 分享链接按钮 */}
              {report && (
                <button
                  onClick={handleShareLink}
                  className="rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  title={t('topicResearch.contentPanel.copyShareLinkExport')}
                >
                  <Link2 className="h-4 w-4" />
                </button>
              )}

              {/* 删除报告按钮 */}
              {report && onDeleteReport && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="rounded p-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                  title={t('topicResearch.contentPanel.deleteReportButton')}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Delete confirmation modal */}
        <ConfirmDialog
          open={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteReport}
          title={t('topicResearch.contentPanel.confirmDeleteTitle')}
          description={t('topicResearch.contentPanel.deleteConfirmMessage')}
          type="danger"
          confirmText={t('topicResearch.contentPanel.confirmDeleteButtonText')}
          cancelText={t('topicResearch.contentPanel.cancelButton')}
          loading={isDeleting}
        />

        {/* Tab Content */}
        <div
          {...(activeTab === 'report'
            ? { 'data-export-content': 'insights' }
            : {})}
          className="relative flex-1 overflow-hidden"
        >
          {/* ★ 重新生成报告遮罩 */}
          {activeTab === 'report' && isRegenerating && (
            <div className="sticky top-0 z-30 border-b border-blue-200 bg-blue-50 px-6 py-3">
              <div className="mx-auto flex max-w-4xl items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-800">
                    {t('topicResearch.contentPanel.regeneratingBanner.title')}
                  </p>
                  <p className="text-xs text-blue-600">
                    {t(
                      'topicResearch.contentPanel.regeneratingBanner.description'
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'report' && reportViewMode === 'continuous' && (
            <div
              className={`h-full ${isRegenerating ? 'pointer-events-none opacity-50' : ''}`}
            >
              <ReportEditPanel
                report={report}
                evidence={safeEvidence}
                revisions={revisions}
                annotations={annotations}
                currentUserId={user?.id || 'anonymous'}
                currentUserName={
                  user?.username ||
                  user?.email ||
                  t('topicResearch.contentPanel.anonymousUser')
                }
                isLoading={isLoadingReport}
                hideToolbar={true}
                sidePanelType={sidePanelType}
                onSidePanelChange={setSidePanelType}
                onSave={async (content: string) => {
                  // TODO: Implement save functionality
                  logger.debug('Save report:', content);
                }}
                onOpenAIEdit={aiEdit.handleOpenEdit}
                onAIEdit={async (operation, selection) => {
                  if (!topicId || !report?.id) {
                    logger.error('Cannot AI edit: missing topicId or reportId');
                    return '';
                  }
                  try {
                    const result = await aiEditReport(topicId, report.id, {
                      operation: operation as AIEditOperationType,
                      selectedText: selection?.text || undefined,
                    });
                    return result.editedContent || '';
                  } catch (error) {
                    logger.error('AI edit failed:', error);
                    return '';
                  }
                }}
                onRollback={async (revisionId: string) => {
                  // Use existing rollback handler
                  onRollbackVersion?.(revisionId);
                }}
                onAnnotationAdd={handleAnnotationAdd}
                onAnnotationUpdate={handleAnnotationUpdate}
                onAnnotationDelete={handleAnnotationDelete}
                onAnnotationResolve={handleAnnotationResolve}
                onAnnotationReply={handleAnnotationReply}
                onSubmitFeedback={handleSubmitFeedback}
              />
            </div>
          )}
          {activeTab === 'report' && reportViewMode === 'chapter' && (
            <div
              className={`flex h-full flex-col ${isRegenerating ? 'pointer-events-none opacity-50' : ''}`}
            >
              {/* Main content area */}
              <div className="flex flex-1 overflow-hidden">
                {/* Main chapter view */}
                <div
                  className={`flex-1 overflow-hidden ${sidePanelType ? 'border-r border-gray-200' : ''}`}
                >
                  <ChapterizedReportView
                    report={report}
                    dimensions={dimensions}
                    evidence={safeEvidence}
                    isLoading={isLoadingReport}
                    onEditChapter={async (chapterId, content) => {
                      // TODO: Implement chapter save
                      logger.debug('Save chapter:', chapterId, content);
                    }}
                    onAIEditChapter={async (chapterId, operation) => {
                      // TODO: Implement AI edit for chapter
                      logger.debug('AI Edit chapter:', chapterId, operation);
                    }}
                    // ★ 右键菜单回调 - 与连续视图保持一致
                    onOpenAIEdit={aiEdit.handleOpenEdit}
                    onAIEdit={async (operation, selection) => {
                      if (!topicId || !report?.id) {
                        logger.error(
                          'Cannot AI edit: missing topicId or reportId'
                        );
                        return '';
                      }
                      try {
                        const result = await aiEditReport(topicId, report.id, {
                          operation: operation as AIEditOperationType,
                          selectedText: selection || undefined,
                        });
                        return result.editedContent || '';
                      } catch (error) {
                        logger.error('AI edit failed:', error);
                        return '';
                      }
                    }}
                    // ★ 添加批注回调
                    onAddAnnotation={(data) => {
                      handleAnnotationAdd({
                        reportId: report?.id || '',
                        userId: user?.id || 'anonymous',
                        userName:
                          user?.username ||
                          user?.email ||
                          t('topicResearch.contentPanel.anonymousUser'),
                        selectedText: data.selectedText,
                        content: '',
                        startOffset: data.startOffset,
                        endOffset: data.endOffset,
                        color: data.color,
                        status: 'active',
                      });
                    }}
                    // ★ 批注高亮
                    annotations={annotations.map((a) => ({
                      id: a.id,
                      selectedText: a.selectedText,
                      startOffset: a.startOffset,
                      endOffset: a.endOffset,
                      color: a.color,
                      status: a.status,
                      selectorPrefix: a.selectorPrefix,
                      selectorSuffix: a.selectorSuffix,
                    }))}
                    highlightedAnnotationId={highlightedAnnotationId}
                  />
                </div>

                {/* Side panel for history/annotations in chapter view */}
                {sidePanelType === 'history' && (
                  <div className="w-96 flex-shrink-0 overflow-hidden border-l border-gray-200 bg-white">
                    <div className="flex h-full flex-col">
                      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                        <h3 className="text-sm font-semibold text-gray-700">
                          {t(
                            'topicResearch.contentPanel.revisionHistory.title'
                          )}
                        </h3>
                        <button
                          onClick={() => setSidePanelType(null)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto">
                        <ReportRevisionHistory
                          revisions={allRevisions}
                          currentVersion={report?.version || 1}
                          isLoading={false}
                          onRollback={
                            onRollbackVersion
                              ? async (revisionId: string) => {
                                  onRollbackVersion(revisionId);
                                }
                              : undefined
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ★ Annotations side panel for chapter view */}
                {sidePanelType === 'annotations' && (
                  <div className="w-96 flex-shrink-0 overflow-hidden border-l border-gray-200 bg-white">
                    <div className="flex h-full flex-col">
                      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                        <h3 className="text-sm font-semibold text-gray-700">
                          {t('topicResearch.annotations')}
                        </h3>
                        <button
                          onClick={() => setSidePanelType(null)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto">
                        <ReportAnnotations
                          annotations={annotations}
                          currentUserId={user?.id}
                          isLoading={false}
                          onUpdate={handleAnnotationUpdate}
                          onDelete={handleAnnotationDelete}
                          onResolve={handleAnnotationResolve}
                          onReply={handleAnnotationReply}
                          onSubmitFeedback={handleSubmitFeedback}
                          onNavigate={(annotationId: string) => {
                            // ★ 设置高亮批注ID，触发滚动到原文
                            setHighlightedAnnotationId(annotationId);
                            // 3秒后取消高亮
                            setTimeout(() => {
                              setHighlightedAnnotationId(null);
                            }, 3000);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer - 简洁版本信息 */}
              <div className="border-t border-gray-200 bg-white px-4 py-1.5">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>v{report?.version || 0}</span>
                  <span>{t('topicResearch.contentPanel.ctrlHHistory')}</span>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'report' && reportViewMode === 'quick' && (
            <QuickViewReport
              report={report}
              evidence={safeEvidence}
              isLoading={isLoadingReport}
            />
          )}
          {activeTab === 'research_collab' && topicId && (
            <ResearchCollaborationPanel
              topicId={topicId}
              missionId={missionStatus?.id}
              missionStatus={missionStatus}
              wsEvents={wsEvents}
              className="h-full"
            />
          )}
          {activeTab === 'collaboration' && (
            <TeamInteractionTabContent
              events={safeEvents}
              wsEvents={wsEvents}
              wsConnected={wsConnected}
              onClearEvents={handleClearAllMessages}
              persistedMessages={persistedMessages}
              persistedActivities={persistedActivities}
              missionStatus={missionStatus}
              topicId={topicId}
              reportId={report?.id}
            />
          )}
          {activeTab === 'credibility' && (
            <div className="h-full overflow-y-auto p-4">
              {report ? (
                <CredibilityPanel topicId={topicId} reportId={report.id} />
              ) : (
                <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-8">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
                    <Shield className="h-10 w-10 text-gray-400" />
                  </div>
                  <h3 className="mt-4 text-lg font-medium text-gray-900">
                    {t('topicResearch.contentPanel.noCredibilityReport')}
                  </h3>
                  <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
                    {t('topicResearch.contentPanel.credibilityReportHint')}
                  </p>
                </div>
              )}
            </div>
          )}
          {activeTab === 'history' && topicId && (
            <div className="h-full overflow-y-auto p-4">
              <ResearchTimeline
                topicId={topicId}
                onSelectResearch={(history) => {
                  logger.debug('Selected research:', history);
                }}
                onCompareVersions={(from, to) => {
                  logger.debug('Compare versions:', String(from), String(to));
                }}
                onViewReport={(version) => {
                  logger.debug('View report version:', version);
                }}
              />
            </div>
          )}
          {activeTab === 'references' && (
            <EvidenceTabContent
              evidence={safeEvidence}
              report={report}
              dimensions={safeDimensions}
              isLoading={isLoadingEvidence}
              autoExpandId={autoExpandEvidenceId}
              onAutoExpandHandled={() => setAutoExpandEvidenceId(null)}
            />
          )}
          {activeTab === 'compute_usage' && (
            <div className="h-full overflow-y-auto">
              <ComputeUsageTab topicId={topicId || ''} />
            </div>
          )}
        </div>

        {/* Hidden export content: always rendered when report exists but tab is not active.
            This ensures document.querySelector('[data-export-content="insights"]') always
            finds the element for WYSIWYG HTML capture regardless of which tab is active. */}
        {activeTab !== 'report' && report?.fullReport && (
          <div className="hidden">
            <div data-export-content="insights">
              {/* 隐藏导出：原代码只做 preprocessLatex，不做 stripProseBullets。
                  细分 flag 显式控制，保证导出 HTML 字节级幂等 */}
              <MarkdownViewer
                content={report.fullReport}
                enableLatexPreprocess
                enableBulletStrip={false}
              />
            </div>
          </div>
        )}

        {/* Toast 提示 */}
        {toast && (
          <div
            className={`fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 shadow-lg ${
              toast.type === 'success'
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
            }`}
          >
            {toast.message}
          </div>
        )}

        {/* AI Edit Modals */}
        <AIEditInputModal
          isOpen={aiEdit.isInputModalOpen}
          onClose={aiEdit.closeInputModal}
          selectedText={aiEdit.selectedText}
          onSubmit={aiEdit.handleSubmitEdit}
          isLoading={aiEdit.isLoading}
          context={aiEdit.editContext || undefined}
        />
        <AIEditPreviewModal
          isOpen={aiEdit.isPreviewModalOpen}
          onClose={aiEdit.closePreviewModal}
          originalText={aiEdit.selectedText}
          editedText={aiEdit.editedText}
          isLoading={aiEdit.isLoading}
          error={aiEdit.error}
          onApply={aiEdit.handleApplyEdit}
          onRegenerate={aiEdit.handleRegenerate}
          onClearError={aiEdit.clearError}
          instruction={aiEdit.instruction}
        />
      </div>

      {/* Regenerate feedback dialog */}
      <Modal
        open={showRegenerateDialog}
        onClose={() => setShowRegenerateDialog(false)}
        title={t('topicResearch.contentPanel.regenerateReportTitle')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowRegenerateDialog(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              {t('topicResearch.contentPanel.cancelButton')}
            </button>
            <button
              onClick={() => doRegenerate(regenerateFeedback.trim())}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t('topicResearch.contentPanel.regenerateButton')}
            </button>
          </div>
        }
      >
        <div>
          <label className="text-sm text-gray-600">
            {t('topicResearch.contentPanel.optimizationDirectionLabel')}
          </label>
          <textarea
            autoFocus
            value={regenerateFeedback}
            onChange={(e) => setRegenerateFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                doRegenerate(regenerateFeedback.trim());
              }
            }}
            placeholder={t(
              'topicResearch.contentPanel.optimizationPlaceholder'
            )}
            className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            rows={3}
            maxLength={500}
          />
        </div>
      </Modal>
    </>
  );
}

// ==================== 报告 Tab ====================

// ==================== 内联引用 Tooltip 组件 ====================
// 参考 Fast Research 的引用呈现方式
interface CitationTooltipProps {
  citationId: string;
  citationIndex: number;
  evidence: TopicEvidence | null;
}

function CitationTooltip({ citationIndex, evidence }: CitationTooltipProps) {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);

  // ★ 点击引用标记，跳转到参考文献面板
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (evidence) {
      triggerCitationClick(evidence.id);
    }
  };

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Citation badge - 可点击跳转 */}
      <sup
        onClick={handleClick}
        className="cursor-pointer rounded bg-purple-100 px-1 py-0.5 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-200"
        title={t('topicResearch.contentPanel.clickToJumpToReferences')}
      >
        [{citationIndex}]
      </sup>

      {/* Tooltip - 引用正文预览 */}
      {isHovered && evidence && (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 w-96 -translate-x-1/2 rounded-lg border border-gray-200 bg-white shadow-xl"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Header */}
          <div className="flex items-start gap-2 border-b border-gray-100 p-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
              {citationIndex}
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="line-clamp-2 text-sm font-medium text-gray-900">
                {evidence.title ||
                  t('topicResearch.contentPanel.unknownSource')}
              </h4>
              {evidence.domain && (
                <span className="mt-0.5 inline-block text-xs text-gray-400">
                  {evidence.domain}
                </span>
              )}
            </div>
          </div>

          {/* Content - 引用正文预览（可滚动） */}
          {evidence.snippet && (
            <div className="max-h-48 overflow-y-auto p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {evidence.snippet}
              </p>
            </div>
          )}

          {/* Footer - 操作按钮 */}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-3 py-2">
            <button
              onClick={handleClick}
              className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-800"
            >
              {t('topicResearch.contentPanel.viewFullSource')}
            </button>
            {evidence.url && (
              <a
                href={evidence.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                onClick={(e) => e.stopPropagation()}
              >
                {t('topicResearch.contentPanel.openOriginal')}
              </a>
            )}
          </div>

          {/* Arrow */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-50" />
        </div>
      )}
    </span>
  );
}

/**
 * 将字符串内容中的引用标记替换为可交互的组件
 * 支持格式: [1], [2], [temp-1-1], [temp-2-3], [uuid] 等
 */
function renderTextWithCitations(
  text: string,
  evidence: TopicEvidence[],
  keyPrefix: string = ''
): React.ReactNode[] {
  // 匹配多种引用格式:
  // 1. [数字] - 如 [1], [2]
  // 2. [temp-数字-数字] - 如 [temp-1-1]
  // 3. [uuid] - 如 [3ce86537-fe31-4594-9b6e-72c93607fb4e]
  const citationPattern =
    /\[(\d+)\]|\[(temp-\d+-\d+)\]|\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  // 建立引用索引到证据的映射
  // ★ 使用 citationIndex（如果有），否则降级使用数组索引
  // 这样可以正确处理多维度研究中的连续引用编号（如 [11], [12]）
  const evidenceMap = new Map<
    string,
    { index: number; evidence: TopicEvidence }
  >();
  evidence.forEach((e, idx) => {
    // ★ 优先使用 citationIndex，它是后端分配的实际引用编号
    // 对于多维度研究，第二个维度的引用可能从 [11] 开始
    const citationNum = e.citationIndex ?? idx + 1;
    evidenceMap.set(String(citationNum), { index: citationNum, evidence: e });
    // 同时支持 UUID 格式映射到证据 ID
    evidenceMap.set(e.id, { index: citationNum, evidence: e });
  });

  while ((match = citationPattern.exec(text)) !== null) {
    // 添加引用前的文本
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    // 获取引用标识符（match[1]=数字, match[2]=temp-x-y, match[3]=uuid）
    const citationRef = match[1] || match[2] || match[3];
    const evidenceData = evidenceMap.get(citationRef);

    if (evidenceData) {
      parts.push(
        <CitationTooltip
          key={`${keyPrefix}citation-${match.index}`}
          citationId={citationRef}
          citationIndex={evidenceData.index}
          evidence={evidenceData.evidence}
        />
      );
    } else {
      // 未找到对应证据，保留原始文本但添加样式
      parts.push(
        <sup
          key={`${keyPrefix}citation-unknown-${match.index}`}
          className="rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-500"
        >
          [{citationRef}]
        </sup>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // 添加剩余文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

/**
 * 处理 React children，将其中的字符串内容替换为带引用的组件
 */
function processChildrenWithCitations(
  children: React.ReactNode,
  evidence: TopicEvidence[]
): React.ReactNode {
  if (!children) return children;

  // 如果是字符串，处理引用
  if (typeof children === 'string') {
    const parts = renderTextWithCitations(children, evidence);
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }

  // 如果是数组，递归处理每个元素
  if (Array.isArray(children)) {
    return children.map((child, idx) => {
      if (typeof child === 'string') {
        const parts = renderTextWithCitations(child, evidence, `arr-${idx}-`);
        return parts.length === 1 ? parts[0] : <span key={idx}>{parts}</span>;
      }
      return child;
    });
  }

  // 其他情况直接返回
  return children;
}

// Section card for chapter-like display (AI Writing pattern)
interface ReportSection {
  id: string;
  type: 'summary' | 'highlights' | 'dimension';
  title: string;
  summary: string;
  isCompleted: boolean;
  wordCount: number;
  content?: string;
}

function ReportTabContent({
  report,
  dimensions,
  evidence,
  isLoading,
}: {
  report: TopicReport | null;
  dimensions: TopicDimension[];
  evidence: TopicEvidence[];
  isLoading: boolean;
}) {
  const { t } = useI18n();
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Extract sections from report for card display
  const sections = useMemo<ReportSection[]>(() => {
    if (!report) return [];

    const result: ReportSection[] = [];

    // Summary section
    if (report.summary) {
      result.push({
        id: 'summary',
        type: 'summary',
        title: t('topicResearch.contentPanel.coreSummary'),
        summary:
          report.summary.slice(0, 100) +
          (report.summary.length > 100 ? '...' : ''),
        isCompleted: true,
        wordCount: countWords(report.summary),
        content: report.summary,
      });
    }

    // Highlights section - 添加序号
    if (report.highlights && report.highlights.length > 0) {
      // 过滤掉占位符内容
      const validHighlights = report.highlights.filter(
        (h) => h.content && h.content.trim().length > 20
      );
      if (validHighlights.length > 0) {
        const highlightsContent = validHighlights
          .map((h, idx) => `### ${idx + 1}. ${h.title}\n${h.content}`)
          .join('\n\n');
        result.push({
          id: 'highlights',
          type: 'highlights',
          title: t('topicResearch.contentPanel.export.keyFindings'),
          summary: `${validHighlights.length} ${t('topicResearch.contentPanel.keyInsights')}`,
          isCompleted: true,
          wordCount: countWords(highlightsContent),
          content: highlightsContent,
        });
      }
    }

    // Dimension analysis sections
    if (report.dimensionAnalyses && report.dimensionAnalyses.length > 0) {
      report.dimensionAnalyses.forEach((analysis, idx) => {
        const dimName =
          analysis.dimension?.name ||
          t('topicResearch.contentPanel.dimensionNumber', { number: idx + 1 });
        let content = analysis.summary || '';

        if (analysis.keyFindings && analysis.keyFindings.length > 0) {
          content +=
            `\n\n**${t('topicResearch.contentPanel.export.keyFindings')}:**\n` +
            analysis.keyFindings
              .map((f, fIdx) => `${fIdx + 1}. ${f.finding}`)
              .join('\n');
        }
        if (analysis.trends && analysis.trends.length > 0) {
          content +=
            `\n\n**${t('topicResearch.contentPanel.trends')}:**\n` +
            analysis.trends.map((t) => `- ${t.trend}`).join('\n');
        }
        if (analysis.detailedContent) {
          content += '\n\n' + analysis.detailedContent;
        }

        result.push({
          id: `dim-${idx}`,
          type: 'dimension',
          title: dimName,
          summary:
            analysis.summary?.slice(0, 80) ||
            t('topicResearch.contentPanel.analyzing'),
          isCompleted: !!analysis.summary,
          wordCount: countWords(content),
          content,
        });
      });
    }

    return result;
  }, [report, t]);

  // Get selected section content
  const selectedContent = useMemo(() => {
    if (!selectedSection) return null;
    return sections.find((s) => s.id === selectedSection);
  }, [selectedSection, sections]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <SpinnerIcon className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-500">
            {t('topicResearch.contentPanel.reportLoading')}
          </p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <DocumentIcon className="h-10 w-10 text-gray-400" />
        </div>
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          {t('topicResearch.contentPanel.noReportYet')}
        </h3>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {t('topicResearch.contentPanel.clickToStartResearch')}
        </p>
      </div>
    );
  }

  // If a section is selected, show its full content
  if (selectedContent) {
    return (
      <div className="flex h-full flex-col">
        {/* Section header */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <button
            onClick={() => setSelectedSection(null)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div className="flex-1">
            <h3 className="font-medium text-gray-900">
              {selectedContent.title}
            </h3>
            <p className="text-xs text-gray-500">
              {t('topicResearch.contentPanel.wordCount', {
                count: selectedContent.wordCount,
              })}
            </p>
          </div>
        </div>

        {/* Section content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-6">
            <article className="prose prose-sm prose-blue max-w-none">
              {/*
               * 严格幂等迁移自原 ReactMarkdown + processChildrenWithCitations 自定义：
               * - processText 槽 = renderTextWithCitations（旧函数）
               * - processHeadings + processBlockquote 让 h1-h4 / blockquote 也走
               *   完整递归（覆盖原代码自定义这 5 类元素的行为）
               * - processInlineElements={false} 关闭 strong/em 字符串处理，避免
               *   在原本不会渲染 CitationBadge 的 *emphasis* / **bold** 中误注入
               * - enableLatexPreprocess + enableBulletStrip=false 仅做 preprocessLatex
               *   （原代码语义），不做 stripProseBullets
               */}
              <MarkdownViewer
                content={selectedContent.content || ''}
                processText={(text) => (
                  <>{renderTextWithCitations(text, evidence)}</>
                )}
                processHeadings
                processBlockquote
                processInlineElements={false}
                enableLatexPreprocess
                enableBulletStrip={false}
              />
            </article>
          </div>
        </div>
      </div>
    );
  }

  // Section cards view (like AI Writing chapters)
  return (
    <div className="h-full overflow-y-auto">
      {/* Report header */}
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-xl font-semibold text-gray-900">{report.title}</h2>
        <div className="mt-2 flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <DocumentIcon className="h-4 w-4" />
            {t('topicResearch.contentPanel.sectionsCount', {
              count: sections.length,
            })}
          </span>
          <span className="flex items-center gap-1">
            <LinkIcon className="h-4 w-4" />
            {t('topicResearch.contentPanel.sourcesCount', {
              count: report.totalSources || 0,
            })}
          </span>
          <ClientDate
            date={report.generatedAt}
            format="datetime"
            fallback="-"
          />
        </div>
      </div>

      {/* Section cards */}
      <div className="p-4">
        <div className="grid gap-3">
          {sections.map((section, idx) => (
            <button
              key={section.id}
              onClick={() => setSelectedSection(section.id)}
              className="group flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-4 text-left transition-all hover:border-blue-300 hover:shadow-md"
            >
              {/* Completion indicator */}
              <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                  section.isCompleted
                    ? 'bg-green-100 text-green-600'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {section.isCompleted ? (
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <span className="text-sm font-medium text-gray-700">
                    {idx + 1}
                  </span>
                )}
              </div>

              {/* Section info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-gray-900 group-hover:text-blue-600">
                    {section.title}
                  </h4>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      section.type === 'summary'
                        ? 'bg-purple-100 text-purple-600'
                        : section.type === 'highlights'
                          ? 'bg-orange-100 text-orange-600'
                          : 'bg-blue-100 text-blue-600'
                    }`}
                  >
                    {section.type === 'summary'
                      ? t('topicResearch.contentPanel.summaryLabel')
                      : section.type === 'highlights'
                        ? t('topicResearch.contentPanel.insightLabel')
                        : t('topicResearch.contentPanel.dimension')}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                  {section.summary}
                </p>
                <div className="mt-2 text-xs text-gray-400">
                  {t('topicResearch.contentPanel.wordCount', {
                    count: section.wordCount,
                  })}
                </div>
              </div>

              {/* Arrow */}
              <svg
                className="h-5 w-5 flex-shrink-0 text-gray-300 transition-transform group-hover:translate-x-1 group-hover:text-blue-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== 团队互动 Tab ====================
// Leader plan structure for displaying task understanding
interface LeaderPlanDisplay {
  taskUnderstanding?: {
    topic: string;
    scope: string;
    objectives?: string[];
  };
  agentAssignments?: Array<{
    agentType: string;
    dimensionName: string;
    task: string;
  }>;
  researchStrategy?: string;
}

// Agent 详情配置类型
interface AgentDetailInfo {
  name: string;
  role: string;
  description: string;
  skills: string[];
  tools: string[];
  icon: string;
  color: string;
  bgColor: string;
  gradient: string;
}

// 研究团队 Agent 详情配置
function getResearchAgentDetails(
  t: (key: string) => string
): Record<string, AgentDetailInfo> {
  return {
    leader: {
      name: 'Research Leader',
      role: t('topicResearch.contentPanel.agents.leader.role'),
      description: t('topicResearch.contentPanel.agents.leader.description'),
      skills: t('topicResearch.contentPanel.agents.leader.skills').split(', '),
      tools: t('topicResearch.contentPanel.agents.leader.tools').split(', '),
      icon: '👑',
      color: 'text-purple-700',
      bgColor: 'bg-purple-100',
      gradient: 'from-purple-400 to-purple-600',
    },
    researcher: {
      name: 'Research Agent',
      role: t('topicResearch.contentPanel.agents.researcher.role'),
      description: t(
        'topicResearch.contentPanel.agents.researcher.description'
      ),
      skills: t('topicResearch.contentPanel.agents.researcher.skills').split(
        ', '
      ),
      tools: t('topicResearch.contentPanel.agents.researcher.tools').split(
        ', '
      ),
      icon: '🔍',
      color: 'text-blue-700',
      bgColor: 'bg-blue-100',
      gradient: 'from-blue-400 to-blue-600',
    },
    reviewer: {
      name: 'Quality Reviewer',
      role: t('topicResearch.contentPanel.agents.reviewer.role'),
      description: t('topicResearch.contentPanel.agents.reviewer.description'),
      skills: t('topicResearch.contentPanel.agents.reviewer.skills').split(
        ', '
      ),
      tools: t('topicResearch.contentPanel.agents.reviewer.tools').split(', '),
      icon: '✅',
      color: 'text-green-700',
      bgColor: 'bg-green-100',
      gradient: 'from-green-400 to-green-600',
    },
    synthesizer: {
      name: 'Report Synthesizer',
      role: t('topicResearch.contentPanel.agents.synthesizer.role'),
      description: t(
        'topicResearch.contentPanel.agents.synthesizer.description'
      ),
      skills: t('topicResearch.contentPanel.agents.synthesizer.skills').split(
        ', '
      ),
      tools: t('topicResearch.contentPanel.agents.synthesizer.tools').split(
        ', '
      ),
      icon: '📊',
      color: 'text-orange-700',
      bgColor: 'bg-orange-100',
      gradient: 'from-orange-400 to-orange-600',
    },
  };
}

// ★ 默认 Agent 详情（用于未知类型）
function getDefaultAgentDetails(t: (key: string) => string): AgentDetailInfo {
  return {
    name: 'Agent',
    role: t('topicResearch.contentPanel.agents.default.role'),
    description: t('topicResearch.contentPanel.agents.default.description'),
    skills: t('topicResearch.contentPanel.agents.default.skills').split(', '),
    tools: t('topicResearch.contentPanel.agents.default.tools').split(', '),
    icon: '🤖',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    gradient: 'from-gray-400 to-gray-600',
  };
}

// ★ 安全获取 Agent 详情（大小写不敏感）
function getAgentDetails(
  agentType: string,
  t: (key: string) => string
): AgentDetailInfo {
  const agentDetails = getResearchAgentDetails(t);
  const defaultDetails = getDefaultAgentDetails(t);
  if (!agentType) return defaultDetails;
  const key = agentType.toLowerCase();
  return agentDetails[key] || agentDetails[agentType] || defaultDetails;
}

/**
 * ★ 协作动态面板 v2.0 - 时间线消息流设计
 *
 * 重构要点：
 * 1. 从"按 Agent 分组的折叠树"改为"按时间排序的智能消息流"
 * 2. 顶部添加研究进度概览
 * 3. 关键发现直接显示，无需展开
 * 4. 不同消息类型使用语义化卡片
 */

// ==================== 进度概览组件 ====================
function ProgressOverview({
  messages,
  missionStatus,
}: {
  messages: UIMessage[];
  missionStatus?: MissionStatus | null;
}) {
  const { t } = useI18n();
  // 维度标签折叠状态 - 默认折叠
  const [dimensionsCollapsed, setDimensionsCollapsed] = useState(true);

  // 从消息中提取维度状态
  const dimensionStatus = useMemo(() => {
    const dimensions = new Map<
      string,
      { name: string; status: 'completed' | 'in_progress' | 'pending' }
    >();

    // ★ 验证维度名称是否有效（过滤掉 AI 错误返回的模型ID）
    const isValidDimensionName = (name: string | null | undefined): boolean => {
      if (!name || typeof name !== 'string') return false;
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.length > 100) return false;
      // 过滤掉明显是模型ID的名称（如 gemini-3..., gpt-4o..., claude-3..., grok-...）
      const modelIdPatterns = [
        /^gemini-/i,
        /^gpt-/i,
        /^claude-/i,
        /^grok-/i,
        /^deepseek/i,
        /^qwen/i,
        /^glm-/i,
        /^\[.*\]$/, // 数组序列化格式
      ];
      return !modelIdPatterns.some((pattern) => pattern.test(trimmed));
    };

    // 从 missionStatus 获取任务状态
    if (missionStatus?.tasks) {
      for (const task of missionStatus.tasks) {
        if (task.dimensionName && isValidDimensionName(task.dimensionName)) {
          const status =
            task.status === 'COMPLETED'
              ? 'completed'
              : ['EXECUTING', 'ASSIGNED'].includes(task.status)
                ? 'in_progress'
                : 'pending';
          dimensions.set(task.dimensionName, {
            name: task.dimensionName,
            status,
          });
        }
      }
    }

    // 从消息中补充
    for (const msg of messages) {
      if (msg.agentType === 'researcher' && msg.agent?.includes('研究员')) {
        const dimName = (msg.agent || '').replace('研究员', '').trim();
        if (dimName && !dimensions.has(dimName)) {
          const status = safeString(msg.content).includes('完成')
            ? 'completed'
            : 'in_progress';
          dimensions.set(dimName, { name: dimName, status });
        }
      }
    }

    return Array.from(dimensions.values());
  }, [messages, missionStatus]);

  const completedCount = dimensionStatus.filter(
    (d) => d.status === 'completed'
  ).length;
  const totalCount = dimensionStatus.length || missionStatus?.totalTasks || 0;
  const progress =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (dimensionStatus.length === 0 && !missionStatus) return null;

  return (
    <div className="rounded-lg border border-white/50 bg-white/60 p-3">
      {/* 标题行 + 进度条 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">
          {t('topicResearch.contentPanel.researchProgressTitle')}
        </span>
        <span className="text-sm text-gray-500">
          {t('topicResearch.contentPanel.dimensionsCompletedCount', {
            completed: completedCount,
            total: totalCount,
          })}
        </span>
      </div>

      {/* 进度条 */}
      <div className="my-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* 维度状态标签 - 可折叠 */}
      {dimensionStatus.length > 0 && (
        <div
          className="cursor-pointer"
          onClick={() => setDimensionsCollapsed(!dimensionsCollapsed)}
        >
          <div className="mb-1 flex items-center gap-1 text-xs text-gray-500">
            <span>{t('topicResearch.contentPanel.dimensionDetailsTitle')}</span>
            <svg
              className={`h-3 w-3 transition-transform ${dimensionsCollapsed ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
          {!dimensionsCollapsed && (
            <div className="flex flex-wrap gap-1.5">
              {dimensionStatus.map((dim) => (
                <span
                  key={dim.name}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    dim.status === 'completed'
                      ? 'bg-green-100 text-green-700'
                      : dim.status === 'in_progress'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {dim.status === 'completed' && '✓'}
                  {dim.status === 'in_progress' && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  )}
                  {dim.status === 'pending' && '○'}
                  <span className="max-w-[70px] truncate">{dim.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== 消息卡片组件 ====================

// ★ v8: 阶段分隔符卡片
function PhaseSeparatorCard({ msg }: { msg: UIMessage }) {
  const phaseConfig: Record<
    string,
    { icon: React.ElementType; color: string; bg: string }
  > = {
    planning: { icon: Brain, color: 'text-purple-700', bg: 'bg-purple-100' },
    researching: { icon: Search, color: 'text-blue-700', bg: 'bg-blue-100' },
    reviewing: {
      icon: ShieldCheck,
      color: 'text-green-700',
      bg: 'bg-green-100',
    },
    synthesizing: {
      icon: FileText,
      color: 'text-orange-700',
      bg: 'bg-orange-100',
    },
    completed: {
      icon: PartyPopper,
      color: 'text-emerald-700',
      bg: 'bg-emerald-100',
    },
  };
  const config = phaseConfig[msg.phaseName || ''] || phaseConfig.planning;
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-gray-300" />
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${config.color} ${config.bg}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {msg.content}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-gray-300" />
    </div>
  );
}

// Leader 规划卡片
function LeaderPlanCard({ msg }: { msg: UIMessage }) {
  const { t } = useI18n();
  const planData =
    msg.detail?.type === 'leader_plan'
      ? (msg.detail.data as Record<string, unknown>)
      : null;
  const dimensions =
    (planData?.dimensions as Array<{ name: string; description?: string }>) ||
    [];

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">📋</span>
        <span className="font-medium text-purple-800">
          {t('topicResearch.contentPanel.researchPlanComplete')}
        </span>
      </div>

      {msg.content && !safeString(msg.content).includes('规划完成') && (
        <p className="mb-3 text-sm text-purple-700">
          {safeString(msg.content)}
        </p>
      )}

      {dimensions.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-purple-600">
            {t('topicResearch.contentPanel.researchDimensions')}
          </span>
          <div className="flex flex-wrap gap-2">
            {dimensions.slice(0, 6).map((dim, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs shadow-sm"
              >
                <span className="text-blue-500">🔍</span>
                <span className="text-gray-700">{dim.name}</span>
              </span>
            ))}
            {dimensions.length > 6 && (
              <span className="text-xs text-purple-500">
                {t('topicResearch.contentPanel.dimensionsMore', {
                  count: dimensions.length - 6,
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 研究完成卡片（带关键发现）
function ResearchCompleteCard({ msg }: { msg: UIMessage }) {
  const { t } = useI18n();
  const [showMore, setShowMore] = useState(false);
  const dimData =
    msg.detail?.type === 'dimension_content'
      ? (msg.detail.data as {
          summary?: string;
          keyFindings?: string[];
          dimensionName?: string;
        })
      : null;

  const keyFindings = dimData?.keyFindings || [];
  const summary = dimData?.summary || '';
  const dimName =
    (msg.agent || '')
      .replace(t('topicResearch.contentPanel.researcherLabel'), '')
      .trim() ||
    dimData?.dimensionName ||
    '';

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <span className="font-medium text-green-800">
            {dimName
              ? t('topicResearch.contentPanel.researchCompletedFor', {
                  dimension: dimName,
                })
              : t('topicResearch.contentPanel.researchCompletedDefault')}
          </span>
        </div>
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-600">
          100%
        </span>
      </div>

      {/* 关键发现 - 默认展示前3条 */}
      {keyFindings.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-sm">💡</span>
            <span className="text-xs font-medium text-gray-600">
              {t('topicResearch.contentPanel.keyFindingsTitle')}
            </span>
          </div>
          <ul className="space-y-1.5">
            {keyFindings
              .slice(0, showMore ? keyFindings.length : 3)
              .map((finding, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-sm text-gray-700"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-500" />
                  <span>
                    {typeof finding === 'string'
                      ? finding
                      : safeString(finding)}
                  </span>
                </li>
              ))}
          </ul>
          {keyFindings.length > 3 && (
            <button
              onClick={() => setShowMore(!showMore)}
              className="mt-2 text-xs text-green-600 hover:text-green-700"
            >
              {showMore
                ? t('topicResearch.contentPanel.collapseAll')
                : t('topicResearch.contentPanel.expandAllCount', {
                    count: keyFindings.length,
                  })}
            </button>
          )}
        </div>
      )}

      {/* 摘要 - 如果没有关键发现则显示摘要 */}
      {!keyFindings.length && summary && (
        <p className="mt-2 line-clamp-3 text-sm text-gray-600">{summary}</p>
      )}
    </div>
  );
}

// 研究进行中卡片
function ResearchProgressCard({ msg }: { msg: UIMessage }) {
  const { t } = useI18n();
  const progress = msg.progress || 0;
  const dimName = (msg.agent || '')
    .replace(t('topicResearch.contentPanel.researcherLabel'), '')
    .trim();

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <span className="text-sm text-blue-700">
            {dimName
              ? t('topicResearch.contentPanel.researchingDimension', {
                  dimension: dimName,
                })
              : safeString(msg.content)}
          </span>
        </div>
        {progress > 0 && (
          <span className="text-xs text-blue-600">{progress}%</span>
        )}
      </div>
      {progress > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-200">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// 审核结果卡片
function ReviewCard({ msg }: { msg: UIMessage }) {
  const { t } = useI18n();
  // ★ 安全处理：确保 content 是字符串
  const safeContent = safeString(msg.content);
  const isPassed =
    safeContent.includes('通过') ||
    safeContent.includes('passed') ||
    safeContent.includes('excellent') ||
    safeContent.includes('good') ||
    safeContent.includes('优秀') ||
    safeContent.includes('良好') ||
    safeContent.includes('可接受') ||
    safeContent.includes('acceptable');

  return (
    <div
      className={`rounded-lg border p-4 ${
        isPassed
          ? 'border-green-200 bg-green-50'
          : 'border-yellow-200 bg-yellow-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{isPassed ? '✅' : '⚠️'}</span>
        <span
          className={`font-medium ${isPassed ? 'text-green-800' : 'text-yellow-800'}`}
        >
          {t('topicResearch.contentPanel.qualityReview')}
          {isPassed
            ? t('topicResearch.contentPanel.qualityReviewPassedLabel')
            : t('topicResearch.contentPanel.needsRevisionLabel')}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-600">{safeContent}</p>
    </div>
  );
}

// 报告完成卡片
function ReportCard({ msg }: { msg: UIMessage }) {
  const { t } = useI18n();
  const reportData =
    msg.detail?.type === 'report_preview'
      ? (msg.detail.data as { title?: string; summary?: string })
      : null;

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-lg">📊</span>
        <span className="font-medium text-orange-800">
          {t('topicResearch.contentPanel.reportWritingCompleted')}
        </span>
      </div>
      {reportData?.title && (
        <p className="text-sm font-medium text-gray-800">{reportData.title}</p>
      )}
      {reportData?.summary && (
        <p className="mt-2 line-clamp-2 text-sm text-gray-600">
          {reportData.summary}
        </p>
      )}
      <button className="mt-3 text-xs text-orange-600 hover:text-orange-700">
        {t('topicResearch.contentPanel.viewFullReport')}
      </button>
    </div>
  );
}

// 通用消息卡片
function GenericMessageCard({ msg }: { msg: UIMessage }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // ★ 安全处理：确保 content 是字符串
  const safeContent = safeString(msg.content);
  const hasLongContent = safeContent.length > 150 || msg.detail;
  const displayContent = expanded ? safeContent : safeContent.slice(0, 150);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-sm text-gray-700">
        {displayContent}
        {!expanded && safeContent.length > 150 && '...'}
      </p>
      {msg.progress !== undefined && msg.progress > 0 && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${msg.progress}%` }}
          />
        </div>
      )}
      {hasLongContent && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-gray-500 hover:text-gray-700"
        >
          {expanded
            ? t('topicResearch.contentPanel.collapseAll')
            : t('topicResearch.contentPanel.expandDetail')}
        </button>
      )}
    </div>
  );
}

// ==================== 消息流主组件 ====================

function TeamInteractionTabContent({
  events,
  leaderPlan,
  wsEvents = [],
  wsConnected = false,
  onClearEvents,
  persistedMessages = [],
  persistedActivities = [],
  missionStatus,
  topicId,
  reportId,
}: {
  events: ResearchEvent[];
  leaderPlan?: LeaderPlanDisplay | null;
  wsEvents?: WsEvent[];
  wsConnected?: boolean;
  onClearEvents?: () => void;
  persistedMessages?: Array<{
    id: string;
    messageType: string;
    senderRole: string;
    senderName: string;
    content: string;
    createdAt: string;
  }>;
  persistedActivities?: Array<{
    id: string;
    agentId?: string;
    agentName: string;
    agentRole: string;
    activityType: string;
    content: string;
    progress?: number;
    dimensionName?: string;
    createdAt: string;
  }>;
  missionStatus?: MissionStatus | null;
  topicId?: string;
  reportId?: string;
}) {
  const { t } = useI18n();
  // ★ 使用 Array.isArray 确保是数组
  const safeEvents = Array.isArray(events) ? events : [];
  const safeWsEvents = Array.isArray(wsEvents) ? wsEvents : [];
  const safePersistedMessages = Array.isArray(persistedMessages)
    ? persistedMessages
    : [];
  const safePersistedActivities = Array.isArray(persistedActivities)
    ? persistedActivities
    : [];

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  // 筛选器状态
  const [filter, setFilter] = useState<
    'all' | 'leader' | 'researcher' | 'reviewer' | 'synthesizer'
  >('all');
  // ★ 新增：搜索关键词
  const [searchQuery, setSearchQuery] = useState('');
  // ★ 新增：维度筛选（研究任务）
  const [dimensionFilter, setDimensionFilter] = useState<string>('all');
  // ★ 新增：消息列表折叠状态
  const [messagesCollapsed, setMessagesCollapsed] = useState(false);
  // ★ 新增：工具面板折叠状态（搜索+过滤+进度详情）
  const [toolsPanelCollapsed, setToolsPanelCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ★ v8: 缓存 pipeline 阶段推导结果，避免重复计算
  const pipelineState = useMemo(
    () => derivePipelinePhase(safeWsEvents, missionStatus),
    [safeWsEvents, missionStatus]
  );

  // ★ 阶段导航点击：滚动到对应阶段分隔符
  const handlePhaseClick = useCallback(
    (phase: string) => {
      // 展开消息列表（如果折叠了）
      setMessagesCollapsed(false);
      // 延迟一帧等 DOM 更新后再滚动
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(
          `[data-phase="${phase}"]`
        );
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    },
    [setMessagesCollapsed]
  );

  // ★ AI Writing 模式：将 WebSocket 事件和持久化消息转换为 UI 消息
  const uiMessages = useMemo<UIMessage[]>(() => {
    // Convert persisted messages to UI format
    // ★ 过滤掉用户消息 - 用户消息不应该出现在协作动态中
    const persistedUIMessages: UIMessage[] = safePersistedMessages
      .filter((msg) => msg.senderRole !== 'user')
      .map((msg) => {
        let agentIcon = '💬';
        let agentColor = 'text-gray-700';
        let agentBgColor = 'bg-gray-100';
        let msgType: UIMessage['type'] = 'system';

        if (msg.senderRole === 'leader') {
          agentIcon = '👑';
          agentColor = 'text-purple-700';
          agentBgColor = 'bg-purple-100';
          msgType = 'leader';
        }
        // ★ 用户消息已被过滤，无需处理

        return {
          id: `persisted-${msg.id}`,
          type: msgType,
          agent: msg.senderName,
          agentIcon,
          agentColor,
          agentBgColor,
          agentType: msg.senderRole,
          content: safeString(msg.content),
          timestamp: new Date(msg.createdAt),
          detail:
            safeString(msg.content).length > 150
              ? { type: 'text' as const, data: safeString(msg.content) }
              : undefined,
        };
      });

    // ★ Convert persisted agent activities to UI format
    const persistedActivityUIMessages: UIMessage[] =
      safePersistedActivities.map((activity) => {
        let agentIcon = '🔬';
        let agentColor = 'text-blue-700';
        let agentBgColor = 'bg-blue-100';
        let msgType: UIMessage['type'] = 'agent';

        // 根据角色设置图标和颜色
        if (activity.agentRole === 'leader') {
          agentIcon = '👑';
          agentColor = 'text-purple-700';
          agentBgColor = 'bg-purple-100';
          msgType = 'leader';
        } else if (activity.agentRole === 'reviewer') {
          agentIcon = '✅';
          agentColor = 'text-green-700';
          agentBgColor = 'bg-green-100';
        } else if (activity.agentRole === 'synthesizer') {
          agentIcon = '📝';
          agentColor = 'text-orange-700';
          agentBgColor = 'bg-orange-100';
        }

        // 根据活动类型设置状态
        let status: UIMessage['status'] = undefined;
        if (activity.activityType === 'COMPLETED') {
          status = 'success';
        } else if (activity.activityType === 'FAILED') {
          status = 'error';
        } else if (
          activity.activityType === 'RESEARCHING' ||
          activity.activityType === 'THINKING'
        ) {
          status = 'in_progress';
        }

        return {
          id: `activity-${activity.id}`,
          type: msgType,
          agent: activity.agentName,
          agentIcon,
          agentColor,
          agentBgColor,
          agentType: activity.agentRole,
          content: safeString(activity.content),
          timestamp: new Date(activity.createdAt),
          progress: activity.progress,
          status,
          dimensionName: activity.dimensionName,
          detail:
            safeString(activity.content).length > 150
              ? { type: 'text' as const, data: safeString(activity.content) }
              : undefined,
        };
      });

    // Convert WebSocket events to UI format
    const wsUIMessages: UIMessage[] = safeWsEvents.map((wsEvent, idx) => {
      const data = wsEvent.data as Record<string, unknown>;
      const eventType = wsEvent.type;
      const msgId = `ws-${idx}-${wsEvent.timestamp}`;

      let agent = t('topicResearch.contentPanel.aiTeam');
      let agentIcon = '📋';
      let agentColor = 'text-blue-700';
      let agentBgColor = 'bg-blue-100';
      let agentType: string | undefined;
      let msgType: UIMessage['type'] = 'system';
      let content = '';
      let detail: MessageDetail | undefined;
      let progress: number | undefined;
      let status: UIMessage['status'] = undefined; // ★ 消息状态
      const dimensionName: string | undefined =
        (data.dimensionName as string) || undefined; // ★ 研究维度名称

      // 根据事件类型解析
      if (eventType.startsWith('leader:')) {
        agent = 'Leader';
        agentIcon = '👑';
        agentColor = 'text-purple-700';
        agentBgColor = 'bg-purple-100';
        agentType = 'leader';
        msgType = 'leader';

        if (eventType === 'leader:thinking') {
          const phase = (data.phase as string) || '';
          const thinking = (data.content as string) || '';
          progress = (data.progress as number) || 0;
          content = `[${phase}] ${thinking}`;
          // ★ 添加思考详情
          if (thinking.length > 100) {
            detail = { type: 'text', data: thinking };
          }
        } else if (eventType === 'leader:planning') {
          content =
            safeString(data.message) ||
            t('topicResearch.contentPanel.leaderPlanning');
        } else if (eventType === 'leader:plan_ready') {
          const plan = data.plan as Record<string, unknown>;
          content = t(
            'topicResearch.contentPanel.leaderPlanReadyWithDimensions',
            { count: (plan?.dimensions as unknown[])?.length || 0 }
          );
          // ★ 添加规划详情
          if (plan) {
            detail = { type: 'leader_plan', data: plan };
          }
        } else if (eventType === 'leader:response') {
          // ★ Leader 响应用户 @Leader 消息
          const responseText =
            safeString(data.response) || safeString(data.message) || '';
          content = responseText;
          // 长响应添加详情折叠
          if (responseText.length > 150) {
            detail = { type: 'text', data: responseText };
          }
        } else {
          content =
            safeString(data.message) || safeString(data.content) || eventType;
        }
      } else if (eventType.startsWith('agent:')) {
        const role = (data.agentRole as string) || 'researcher';
        agent = (data.agentName as string) || 'Agent';
        agentType = role;
        msgType = 'agent';

        if (role === 'reviewer') {
          agentIcon = '✅';
          agentColor = 'text-green-700';
          agentBgColor = 'bg-green-100';
        } else if (role === 'synthesizer') {
          agentIcon = '📊';
          agentColor = 'text-orange-700';
          agentBgColor = 'bg-orange-100';
        } else {
          agentIcon = '🔍';
          agentColor = 'text-blue-700';
          agentBgColor = 'bg-blue-100';
        }

        // ★ v8: 构建更丰富的 content，展示模型、搜索结果、审核评分
        const rawContent =
          safeString(data.message) || safeString(data.status) || '';
        const modelId = safeString(data.modelId);
        const taskDesc = safeString(data.taskDescription);
        const searchResults = data.searchResults as
          | Record<string, unknown>
          | undefined;
        const reviewResult = data.reviewResult as
          | Record<string, unknown>
          | undefined;

        // 构建内容：优先用 message，补充元数据
        const contentParts: string[] = [];
        if (
          rawContent &&
          rawContent !== 'working' &&
          rawContent !== 'completed'
        ) {
          contentParts.push(rawContent);
        } else if (taskDesc) {
          contentParts.push(taskDesc);
        }
        // 模型信息
        if (modelId && !agent.includes(modelId)) {
          contentParts.push(`[${modelId}]`);
        }
        // 搜索结果摘要
        if (searchResults) {
          const total = searchResults.total as number;
          const filtered = searchResults.filtered as number;
          const query = safeString(searchResults.query);
          if (total > 0) {
            const searchInfo = query
              ? `${t('topicResearch.contentPanel.searchFound')} ${filtered}/${total} (${query})`
              : `${t('topicResearch.contentPanel.searchFound')} ${filtered}/${total}`;
            contentParts.push(searchInfo);
          }
        }
        // 审核评分
        if (reviewResult) {
          const score = reviewResult.overallScore as number;
          const rawLevel = safeString(reviewResult.qualityLevel);
          const levelLabel =
            rawLevel === 'excellent'
              ? t('topicResearch.contentPanel.excellent')
              : rawLevel === 'good'
                ? t('topicResearch.contentPanel.good')
                : rawLevel === 'acceptable'
                  ? t('topicResearch.contentPanel.qualified')
                  : rawLevel === 'needs_revision'
                    ? t('topicResearch.contentPanel.needsRevision')
                    : rawLevel === 'rejected'
                      ? t('topicResearch.contentPanel.fail')
                      : rawLevel;
          if (score) {
            contentParts.push(
              `${t('topicResearch.contentPanel.qualityScore')}: ${Math.round(score)}/100 (${levelLabel})`
            );
          }
        }

        content =
          contentParts.join(' | ') ||
          t('topicResearch.contentPanel.agentWorking', { agent });
      } else if (eventType.startsWith('task:')) {
        agentIcon = '📋';
        agentBgColor = 'bg-gray-100';
        agentColor = 'text-gray-700';
        msgType = 'progress';
        progress = (data.progress as number) || 0;
        content =
          safeString(data.message) ||
          t('topicResearch.contentPanel.taskLabel') +
            ' ' +
            eventType.split(':')[1];
      } else if (eventType.startsWith('dimension:')) {
        const dimName = (data.dimensionName as string) || '';
        // 使用维度名称作为研究员标识，避免所有研究员都显示相同名称
        agent = dimName
          ? `${dimName}${t('topicResearch.contentPanel.researcherLabel')}`
          : t('topicResearch.contentPanel.researcherLabel');
        agentIcon = '🔍';
        agentColor = 'text-blue-700';
        agentBgColor = 'bg-blue-100';
        agentType = 'researcher';
        msgType = 'agent';
        if (eventType === 'dimension:research_started') {
          content =
            safeString(data.message) ||
            t('topicResearch.contentPanel.startResearchingDot');
        } else if (eventType === 'dimension:research_progress') {
          progress = (data.progress as number) || 0;
          const currentStep = safeString(data.currentStep);
          content = currentStep
            ? `${t('topicResearch.contentPanel.researchProgressPercent', { progress })} - ${currentStep}`
            : t('topicResearch.contentPanel.researchProgressPercent', {
                progress,
              });
        } else if (eventType === 'dimension:research_completed') {
          const findingsCount = data.findingsCount as number;
          const wordCount = data.wordCount as number;
          content =
            safeString(data.message) ||
            (findingsCount
              ? `研究完成，发现 ${findingsCount} 个要点${wordCount ? `，${wordCount} 字` : ''}`
              : t('topicResearch.contentPanel.researchCompletedDefault'));
          // ★ 添加研究结果预览
          const summary = (data.summary as string) || '';
          const keyFindings = (data.keyFindings as string[]) || [];
          if (summary || keyFindings.length > 0) {
            detail = {
              type: 'dimension_content',
              data: { summary, keyFindings, dimensionName: dimName },
            };
          }
        } else {
          content = safeString(data.message) || eventType;
        }
      } else if (eventType.startsWith('report:')) {
        agent = t('topicResearch.contentPanel.writerAgent');
        agentIcon = '📊';
        agentColor = 'text-orange-700';
        agentBgColor = 'bg-orange-100';
        agentType = 'synthesizer';
        msgType = 'agent';

        if (eventType === 'report:synthesis_started') {
          content =
            safeString(data.message) ||
            t('topicResearch.contentPanel.startWritingResearchReport');
        } else if (eventType === 'report:synthesis_progress') {
          progress = (data.progress as number) || 0;
          content = safeString(data.message) || `报告撰写中 ${progress}%`;
        } else if (eventType === 'report:synthesis_completed') {
          const chapterCount = data.chapterCount as number;
          const totalWordCount = data.totalWordCount as number;
          content =
            safeString(data.message) ||
            (chapterCount
              ? `${t('topicResearch.contentPanel.researchReportWritingComplete')}，共 ${chapterCount} 章节${totalWordCount ? `，${totalWordCount} 字` : ''}`
              : t('topicResearch.contentPanel.researchReportWritingComplete'));
          // ★ 添加报告预览
          const reportTitle = safeString(data.title) || '';
          const summary = safeString(data.summary) || '';
          if (reportTitle || summary) {
            detail = {
              type: 'report_preview',
              data: { title: reportTitle, summary },
            };
          }
        } else {
          content = safeString(data.message) || eventType;
        }
      } else if (eventType.startsWith('mission:')) {
        agent = 'Leader';
        agentIcon = '🎯';
        agentColor = 'text-green-700';
        agentBgColor = 'bg-green-100';
        agentType = 'leader';
        msgType = 'system';
        progress = data.progress as number;
        // ★ v8: 更丰富的任务消息
        if (eventType === 'mission:started') {
          const leaderModel = safeString(data.leaderModel);
          content =
            safeString(data.message) ||
            t('topicResearch.contentPanel.missionStarted');
          if (leaderModel) {
            content += ` | ${t('topicResearch.contentPanel.leaderModel', { model: leaderModel })}`;
          }
          status = 'in_progress';
        } else if (eventType === 'mission:completed') {
          const completedTasks = data.completedTasks as number;
          const totalTasks = data.totalTasks as number;
          content =
            safeString(data.message) ||
            `${t('topicResearch.contentPanel.missionCompleted')} (${completedTasks}/${totalTasks})`;
          status = 'success';
        } else if (eventType === 'mission:failed') {
          content =
            safeString(data.message) ||
            t('topicResearch.contentPanel.missionFailed');
          status = 'error';
        } else if (eventType === 'mission:progress') {
          const phase = safeString(data.phase);
          const msg = safeString(data.message);
          content = phase
            ? `[${phase}] ${msg}`
            : msg || t('topicResearch.contentPanel.taskLabel');
        } else {
          content =
            safeString(data.message) ||
            t('topicResearch.contentPanel.taskLabel') +
              ' ' +
              eventType.split(':')[1];
        }
      } else {
        content =
          safeString(data.message) ||
          safeString(data.content) ||
          eventType.replace(/:/g, ' ');
      }

      // ★ 根据事件类型推断状态（如果尚未设置）
      if (!status) {
        if (
          eventType.includes('completed') ||
          eventType.includes('complete') ||
          eventType.includes('success') ||
          eventType.includes('plan_ready')
        ) {
          status = 'success';
        } else if (
          eventType.includes('failed') ||
          eventType.includes('error') ||
          eventType.includes('failure')
        ) {
          status = 'error';
        } else if (
          eventType.includes('started') ||
          eventType.includes('progress') ||
          eventType.includes('thinking') ||
          eventType.includes('planning')
        ) {
          status = 'in_progress';
        }
      }

      // ★ 从 data 中检测错误状态
      if (data.error || data.status === 'FAILED' || data.status === 'error') {
        status = 'error';
      }

      return {
        id: msgId,
        type: msgType,
        agent,
        agentIcon,
        agentColor,
        agentBgColor,
        agentType,
        content,
        timestamp: new Date(wsEvent.timestamp),
        detail,
        progress,
        status,
        dimensionName,
      };
    });

    // Combine and sort by timestamp (persisted first, then real-time)
    const allMessages = [
      ...persistedUIMessages,
      ...persistedActivityUIMessages,
      ...wsUIMessages,
    ];
    allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // ★ v8: 去噪 — 过滤纯 "completed"/"working" 等无意义消息（仅 WS 来源）
    const denoised = allMessages.filter((msg) => {
      const c = msg.content.trim().toLowerCase();
      // 保留非空内容
      if (!c) return false;
      // 只过滤 WS 来源的纯状态词（persisted 消息保留）
      const isWsMessage = msg.id.startsWith('ws-');
      if (
        isWsMessage &&
        (c === 'completed' || c === 'working' || c === 'started')
      )
        return false;
      return true;
    });

    // ★ v8: 插入阶段分隔符
    const phaseMap: Record<string, string> = {
      leader: 'planning',
      researcher: 'researching',
      reviewer: 'reviewing',
      synthesizer: 'synthesizing',
    };
    const phaseLabels: Record<string, string> = {
      planning: t('topicResearch.pipeline.planning'),
      researching: t('topicResearch.pipeline.researching'),
      reviewing: t('topicResearch.pipeline.reviewing'),
      synthesizing: t('topicResearch.pipeline.synthesizing'),
      completed: t('topicResearch.pipeline.completed'),
    };
    let lastPhase = '';
    const withSeparators: UIMessage[] = [];
    for (const msg of denoised) {
      // 推断消息所属阶段（优先使用消息自身携带的 metadata）
      let phase = '';
      if (msg.metadata?.phase && typeof msg.metadata.phase === 'string') {
        phase = msg.metadata.phase;
      } else if (
        msg.content.includes('研究任务已启动') ||
        msg.content.includes('mission started')
      ) {
        phase = 'planning';
      } else if (msg.agentType === 'leader') {
        // Leader 在 planning 和 researching 阶段都会发消息
        // 仅在还没进入 researching 阶段时归为 planning
        phase =
          lastPhase === 'researching' ||
          lastPhase === 'reviewing' ||
          lastPhase === 'synthesizing'
            ? lastPhase
            : 'planning';
      } else if (msg.agentType) {
        phase = phaseMap[msg.agentType] || '';
      }
      // mission:completed 事件
      if (
        msg.status === 'success' &&
        msg.agentType === 'leader' &&
        msg.content.includes('完成')
      ) {
        phase = 'completed';
      }

      if (phase && phase !== lastPhase) {
        withSeparators.push({
          id: `phase-sep-${phase}-${msg.timestamp.getTime()}`,
          type: 'phase_separator',
          content: phaseLabels[phase] || phase,
          timestamp: msg.timestamp,
          phaseName: phase,
        });
        lastPhase = phase;
      }
      withSeparators.push(msg);
    }

    return withSeparators;
  }, [safeWsEvents, safePersistedMessages, safePersistedActivities, t]);

  // ★ 收集所有可用的维度名称
  const availableDimensions = useMemo(() => {
    const dimensions = new Set<string>();
    uiMessages.forEach((msg) => {
      if (msg.dimensionName) {
        dimensions.add(msg.dimensionName);
      }
      // 也从 agent 名称中提取维度（例如 "技术趋势研究员"）
      if (msg.agent && msg.agent.includes('研究员')) {
        const dimName = msg.agent.replace('研究员', '').trim();
        if (dimName) {
          dimensions.add(dimName);
        }
      }
    });
    return Array.from(dimensions).sort();
  }, [uiMessages]);

  // ★ 筛选后的消息（支持 Agent 类型、搜索关键词、维度过滤）
  const filteredMessages = useMemo(() => {
    return uiMessages.filter((msg) => {
      // ★ v8: 阶段分隔符始终保留
      if (msg.type === 'phase_separator') return true;
      // Agent 类型过滤
      if (filter !== 'all' && msg.agentType !== filter) {
        return false;
      }
      // 维度过滤
      if (dimensionFilter !== 'all') {
        const msgDimension =
          msg.dimensionName ||
          (msg.agent?.includes('研究员')
            ? msg.agent.replace('研究员', '').trim()
            : null);
        if (msgDimension !== dimensionFilter) {
          return false;
        }
      }
      // 搜索关键词过滤
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const searchableText = [
          safeString(msg.content),
          msg.agent,
          msg.dimensionName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!searchableText.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [uiMessages, filter, dimensionFilter, searchQuery]);

  // ★ 判断消息类型，返回合适的卡片组件
  const getMessageCard = useCallback((msg: UIMessage) => {
    // ★ v8: 阶段分隔符
    if (msg.type === 'phase_separator') {
      return <PhaseSeparatorCard key={msg.id} msg={msg} />;
    }
    // ★ 安全获取 content 字符串用于条件判断
    const content = safeString(msg.content);
    // Leader 规划消息
    if (
      msg.agentType === 'leader' &&
      (msg.detail?.type === 'leader_plan' || content.includes('规划完成'))
    ) {
      return <LeaderPlanCard key={msg.id} msg={msg} />;
    }
    // 研究完成消息
    if (
      (msg.agentType === 'researcher' || msg.agent?.includes('研究员')) &&
      (content.includes('完成') || msg.detail?.type === 'dimension_content')
    ) {
      return <ResearchCompleteCard key={msg.id} msg={msg} />;
    }
    // 研究进行中消息
    if (
      (msg.agentType === 'researcher' || msg.agent?.includes('研究员')) &&
      (content.includes('研究中') ||
        content.includes('进度') ||
        msg.progress !== undefined)
    ) {
      return <ResearchProgressCard key={msg.id} msg={msg} />;
    }
    // 审核消息
    if (msg.agentType === 'reviewer' || content.includes('审核')) {
      return <ReviewCard key={msg.id} msg={msg} />;
    }
    // 报告完成消息
    if (
      (msg.agentType === 'synthesizer' || msg.agent?.includes('撰写')) &&
      (content.includes('完成') || msg.detail?.type === 'report_preview')
    ) {
      return <ReportCard key={msg.id} msg={msg} />;
    }
    // 通用消息
    return <GenericMessageCard key={msg.id} msg={msg} />;
  }, []);

  // ★ 自动滚动到底部
  useEffect(() => {
    if (uiMessages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [uiMessages.length]);

  // Agent 类型配置
  const agentConfig: Record<
    string,
    { icon: string; label: string; color: string; bgColor: string }
  > = {
    leader: {
      icon: '👑',
      label: 'Leader',
      color: 'text-purple-700',
      bgColor: 'bg-purple-100',
    },
    researcher: {
      icon: '🔍',
      label: t('topicResearch.contentPanel.agentLabels.researcher'),
      color: 'text-blue-700',
      bgColor: 'bg-blue-100',
    },
    reviewer: {
      icon: '✅',
      label: t('topicResearch.contentPanel.agentLabels.reviewer'),
      color: 'text-green-700',
      bgColor: 'bg-green-100',
    },
    synthesizer: {
      icon: '📊',
      label: t('topicResearch.contentPanel.agentLabels.synthesizer'),
      color: 'text-orange-700',
      bgColor: 'bg-orange-100',
    },
  };

  // ★ 默认 Agent 配置
  const defaultAgentConfig = {
    icon: '🤖',
    label: 'Agent',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  };

  // ★ 安全获取 Agent 配置
  const getAgentConfig = (agentType: string) => {
    const key = agentType.toLowerCase();
    return agentConfig[key] || agentConfig[agentType] || defaultAgentConfig;
  };

  // 事件类型配置
  const eventTypeConfig: Record<
    ResearchEvent['eventType'],
    { icon: string; label: string; color: string }
  > = {
    start: {
      icon: '▶️',
      label: t('topicResearch.contentPanel.status.start'),
      color: 'text-blue-600',
    },
    progress: {
      icon: '⏳',
      label: t('common.inProgress'),
      color: 'text-gray-600',
    },
    complete: {
      icon: '✅',
      label: t('common.completed'),
      color: 'text-green-600',
    },
    error: {
      icon: '❌',
      label: t('common.error'),
      color: 'text-red-600',
    },
    decision: {
      icon: '🎯',
      label: t('topicResearch.contentPanel.decision'),
      color: 'text-purple-600',
    },
  };

  // Render Leader plan section if available
  const renderLeaderPlanSection = () => {
    if (!leaderPlan) return null;

    return (
      <div className="mb-4 space-y-3">
        {/* Task Understanding */}
        {leaderPlan.taskUnderstanding && (
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">👑</span>
              <h4 className="font-medium text-purple-800">
                {t('topicResearch.contentPanel.taskUnderstanding')}
              </h4>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-purple-700">
                  {t('topicResearch.contentPanel.topic')}
                </span>
                <span className="text-purple-600">
                  {leaderPlan.taskUnderstanding.topic}
                </span>
              </div>
              <div>
                <span className="font-medium text-purple-700">
                  {t('topicResearch.contentPanel.scope')}
                </span>
                <span className="text-purple-600">
                  {leaderPlan.taskUnderstanding.scope}
                </span>
              </div>
              {leaderPlan.taskUnderstanding.objectives &&
                leaderPlan.taskUnderstanding.objectives.length > 0 && (
                  <div>
                    <span className="font-medium text-purple-700">
                      {t('topicResearch.contentPanel.objectives')}
                    </span>
                    <ul className="ml-4 mt-1 list-disc text-purple-600">
                      {leaderPlan.taskUnderstanding.objectives.map(
                        (obj, idx) => (
                          <li key={idx}>{obj}</li>
                        )
                      )}
                    </ul>
                  </div>
                )}
            </div>
          </div>
        )}

        {/* Research Strategy */}
        {leaderPlan.researchStrategy && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">🎯</span>
              <h4 className="font-medium text-indigo-800">
                {t('topicResearch.contentPanel.executionStrategy')}
              </h4>
            </div>
            <p className="text-sm text-indigo-600">
              {leaderPlan.researchStrategy}
            </p>
          </div>
        )}

        {/* Agent Assignments */}
        {leaderPlan.agentAssignments &&
          leaderPlan.agentAssignments.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-lg">📋</span>
                <h4 className="font-medium text-blue-800">
                  {t('topicResearch.contentPanel.agentAssignment')}
                </h4>
              </div>
              <div className="space-y-2">
                {leaderPlan.agentAssignments.map((assignment, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-lg bg-white p-2 text-sm"
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        assignment.agentType === 'researcher'
                          ? 'bg-blue-100 text-blue-600'
                          : assignment.agentType === 'reviewer'
                            ? 'bg-green-100 text-green-600'
                            : 'bg-orange-100 text-orange-600'
                      }`}
                    >
                      {assignment.agentType === 'researcher'
                        ? '🔍'
                        : assignment.agentType === 'reviewer'
                          ? '✅'
                          : '📊'}
                    </span>
                    <div className="flex-1">
                      <span className="font-medium text-gray-700">
                        {assignment.dimensionName}
                      </span>
                      <span className="mx-2 text-gray-400">→</span>
                      <span className="text-gray-600">{assignment.task}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
    );
  };

  // Show empty state only if no uiMessages and no legacy events
  if (safeEvents.length === 0 && uiMessages.length === 0 && !leaderPlan) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-100">
          <TeamIcon className="h-10 w-10 text-blue-500" />
        </div>
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          {t('topicResearch.contentPanel.waitForResearchStart')}
        </h3>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {t('topicResearch.contentPanel.teamCollaborationHint')}
        </p>
        {/* Connection status */}
        <div className="mt-4 flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-300'}`}
          />
          <span className="text-xs text-gray-400">
            {wsConnected
              ? t('topicResearch.contentPanel.realTimeConnected')
              : t('topicResearch.contentPanel.waitingForConnectionLabel')}
          </span>
        </div>
        <div className="mt-6 w-full max-w-md space-y-3">
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">👑</span>
              <div>
                <div className="font-medium text-gray-900">
                  {t('topicResearch.contentPanel.leaderCoordination')}
                </div>
                <p className="text-xs text-gray-500">
                  {t('topicResearch.contentPanel.analyzeTasksAndPlan')}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔍</span>
              <div>
                <div className="font-medium text-gray-900">
                  {t('topicResearch.contentPanel.researchersExecute')}
                </div>
                <p className="text-xs text-gray-500">
                  {t('topicResearch.contentPanel.searchAndAnalyze')}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-green-700" />
              <div>
                <div className="font-medium text-gray-900">
                  {t('topicResearch.contentPanel.reviewAndWrite')}
                </div>
                <p className="text-xs text-gray-500">
                  {t(
                    'topicResearch.contentPanel.qualityReviewReportingAndDelivery'
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ★ 固定工具栏：状态 + 搜索过滤（始终显示） */}
      <div className="shrink-0 border-b bg-white px-4 py-2">
        {/* 状态栏 */}
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${wsConnected ? 'animate-pulse bg-green-500' : 'bg-gray-300'}`}
              />
              <span className="text-xs text-gray-600">
                {wsConnected
                  ? t('topicResearch.contentPanel.realTimeUpdateActive')
                  : t('topicResearch.contentPanel.notConnected')}
              </span>
            </div>
            {uiMessages.length > 0 && (
              <span className="text-xs text-gray-500">
                {t('topicResearch.contentPanel.messagesCount', {
                  count: uiMessages.length,
                })}
              </span>
            )}
          </div>
          {uiMessages.length > 0 && onClearEvents && (
            <button
              onClick={onClearEvents}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {t('topicResearch.contentPanel.clearMessages')}
            </button>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative mb-2">
          <input
            type="text"
            placeholder={t('topicResearch.contentPanel.searchMessageContent')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-4 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <svg
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* 筛选器行 */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            ['all', 'leader', 'researcher', 'reviewer', 'synthesizer'] as const
          ).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all'
                ? t('topicResearch.contentPanel.all')
                : f === 'leader'
                  ? 'Leader'
                  : f === 'researcher'
                    ? t('topicResearch.contentPanel.researcherLabel')
                    : f === 'reviewer'
                      ? t('topicResearch.contentPanel.reviewerLabel')
                      : t('topicResearch.contentPanel.writerAgent')}
            </button>
          ))}
          {availableDimensions.length > 0 && (
            <>
              <div className="h-4 w-px bg-gray-300" />
              <select
                value={dimensionFilter}
                onChange={(e) => setDimensionFilter(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">
                  {t('topicResearch.contentPanel.allDimensions')}
                </option>
                {availableDimensions.map((dim) => (
                  <option key={dim} value={dim}>
                    {dim}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* 筛选结果提示 */}
        {(searchQuery || filter !== 'all' || dimensionFilter !== 'all') && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <span>
              {t('topicResearch.contentPanel.foundCount', {
                count: filteredMessages.length,
              })}
              {uiMessages.length !== filteredMessages.length && (
                <span className="text-gray-400">
                  {' '}
                  {t('topicResearch.contentPanel.totalCount', {
                    count: uiMessages.length,
                  })}
                </span>
              )}
            </span>
            <button
              onClick={() => {
                setSearchQuery('');
                setFilter('all');
                setDimensionFilter('all');
              }}
              className="text-blue-500 hover:text-blue-700"
            >
              {t('topicResearch.contentPanel.clear')}
            </button>
          </div>
        )}
      </div>

      {/* ★ v8: Pipeline 阶段指示器 + 研究进度 */}
      <div className="shrink-0 space-y-2 border-b bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2">
        <PipelinePhaseIndicator
          currentPhase={pipelineState.phase}
          isFailed={pipelineState.isFailed}
          onPhaseClick={handlePhaseClick}
        />
        <ProgressOverview messages={uiMessages} missionStatus={missionStatus} />
      </div>

      {/* ★ 可滚动区域：时间线消息流 */}
      <div className="flex-1 overflow-y-auto">
        {/* ★ 消息区域标题 - 可折叠 */}
        <div
          className="sticky top-0 z-10 flex cursor-pointer items-center justify-between border-b bg-gray-50 px-4 py-2"
          onClick={() => setMessagesCollapsed(!messagesCollapsed)}
        >
          <span className="text-sm font-medium text-gray-600">
            {t('topicResearch.contentPanel.collaborationMessages', {
              count: filteredMessages.length,
            })}
          </span>
          <svg
            className={`h-4 w-4 text-gray-500 transition-transform ${messagesCollapsed ? '' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>

        {/* ★ 垂直时间线消息流 */}
        {!messagesCollapsed && filteredMessages.length > 0 && (
          <div className="relative">
            {/* ★ 垂直时间线 */}
            <div className="absolute left-[29px] top-0 h-full w-0.5 bg-gray-200" />

            <div className="space-y-4 p-4">
              {filteredMessages.map((msg) => {
                // ★ v8: 阶段分隔符 — 全宽渲染，无时间线节点
                if (msg.type === 'phase_separator') {
                  return (
                    <div
                      key={msg.id}
                      className="relative -ml-6"
                      data-phase={msg.phaseName}
                    >
                      {getMessageCard(msg)}
                    </div>
                  );
                }

                // ★ 根据状态确定时间线节点颜色
                const getNodeColor = () => {
                  switch (msg.status) {
                    case 'error':
                      return 'bg-red-500 border-red-600';
                    case 'success':
                      return 'bg-green-500 border-green-600';
                    case 'in_progress':
                      return 'bg-blue-500 border-blue-600 animate-pulse';
                    default:
                      return 'bg-gray-400 border-gray-500';
                  }
                };

                // ★ 失败消息的卡片边框样式
                const getCardBorderClass = () => {
                  if (msg.status === 'error') {
                    return 'border-l-4 border-l-red-500';
                  }
                  if (msg.status === 'success') {
                    return 'border-l-4 border-l-green-500';
                  }
                  return '';
                };

                return (
                  <div key={msg.id} className="relative flex gap-4 pl-10">
                    {/* ★ 时间线节点 */}
                    <div
                      className={`absolute left-[13px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm ${getNodeColor()}`}
                      title={
                        msg.status === 'error'
                          ? t('common.failed')
                          : msg.status === 'success'
                            ? t('common.success')
                            : msg.status === 'in_progress'
                              ? t('common.inProgress')
                              : ''
                      }
                    />

                    {/* 消息内容 */}
                    <div className={`flex-1 ${getCardBorderClass()}`}>
                      {/* 时间戳和 Agent 标识 */}
                      <div className="mb-2 flex items-center gap-3">
                        <span className="text-xs text-gray-400">
                          <ClientDate date={msg.timestamp} format="time" />
                        </span>
                        <div className="h-px flex-1 bg-gray-100" />
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${msg.agentBgColor || 'bg-gray-100'}`}
                          >
                            {msg.agentIcon || '🤖'}
                          </span>
                          <span
                            className={`text-xs font-medium ${msg.agentColor || 'text-gray-600'}`}
                          >
                            {msg.agent || 'AI 团队'}
                          </span>
                          {/* ★ 失败状态标签 */}
                          {msg.status === 'error' && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              {t('common.failed')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 消息卡片 */}
                      {getMessageCard(msg)}
                    </div>
                  </div>
                );
              })}
              {/* 滚动锚点 */}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Legacy Events Header */}
        {safeEvents.length > 0 && (
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">
              研究过程 ({safeEvents.length} 条记录)
            </h4>
          </div>
        )}

        {/* Legacy 事件时间线 */}
        {safeEvents.length > 0 && (
          <div className="relative">
            <div className="absolute left-4 top-0 h-full w-px bg-gray-200" />

            <div className="space-y-4">
              {safeEvents.map((event) => {
                const agent = getAgentConfig(event.agentType);
                const eventType = eventTypeConfig[event.eventType];

                return (
                  <div key={event.id} className="relative flex gap-4 pl-10">
                    {/* 时间线节点 - Clickable */}
                    <button
                      onClick={() => setSelectedAgent(event.agentType)}
                      className={`absolute left-1 flex h-7 w-7 items-center justify-center rounded-full text-sm ${agent.bgColor} cursor-pointer transition-transform hover:scale-110`}
                      title={t('topicResearch.contentPanel.clickToViewDetails')}
                    >
                      {agent.icon}
                    </button>

                    {/* 事件卡片 */}
                    <div
                      className={`flex-1 rounded-lg border p-3 ${
                        event.eventType === 'error'
                          ? 'border-red-200 bg-red-50'
                          : event.eventType === 'complete'
                            ? 'border-green-200 bg-green-50'
                            : event.eventType === 'decision'
                              ? 'border-purple-200 bg-purple-50'
                              : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {/* Clickable Agent Label */}
                          <button
                            onClick={() => setSelectedAgent(event.agentType)}
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${agent.bgColor} ${agent.color} hover:opacity-80`}
                            title={t(
                              'topicResearch.contentPanel.clickToViewDetails'
                            )}
                          >
                            {event.agentName || agent.label}
                          </button>
                          <span className={`text-xs ${eventType.color}`}>
                            {eventType.icon} {eventType.label}
                          </span>
                          {event.dimensionName && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                              {event.dimensionName}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">
                          <ClientDate date={event.timestamp} format="time" />
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-gray-700">
                        {safeString(event.message)}
                      </p>
                      {event.details && (
                        <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-500">
                          {safeString(event.details)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Agent Details Modal - ★ 使用安全访问器 */}
      {(() => {
        const details = selectedAgent
          ? getAgentDetails(selectedAgent, t)
          : null;
        return (
          <Modal
            open={!!selectedAgent}
            onClose={() => setSelectedAgent(null)}
            size="sm"
            title={
              details ? (
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${details.gradient} text-xl text-white shadow-md`}
                  >
                    {details.icon}
                  </div>
                  <div>
                    <span className="text-lg font-bold text-gray-900">
                      {details.name}
                    </span>
                    <p className="text-sm text-gray-500">{details.role}</p>
                  </div>
                </div>
              ) : (
                ''
              )
            }
            footer={
              <div className="flex items-center justify-end">
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  关闭
                </button>
              </div>
            }
          >
            {details && (
              <div className="px-2">
                {/* Description */}
                <p className="text-sm leading-relaxed text-gray-600">
                  {details.description}
                </p>

                {/* Skills */}
                <div className="mt-4">
                  <h4 className="mb-2 text-sm font-semibold text-gray-800">
                    技能
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {details.skills.map((skill) => (
                      <span
                        key={skill}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${details.bgColor} ${details.color}`}
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Tools */}
                <div className="mt-4">
                  <h4 className="mb-2 text-sm font-semibold text-gray-800">
                    工具
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {details.tools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}

// ==================== Agent 思考架构 Tab ====================
function AgentThinkingTabContent({
  thinkings,
  missionStatus,
  wsEvents = [],
  persistedActivities = [],
}: {
  thinkings: AgentThinking[];
  missionStatus?: MissionStatus | null;
  wsEvents?: WsEvent[];
  persistedActivities?: Array<{
    id: string;
    agentName: string;
    agentRole: string;
    activityType: string;
    phase?: string;
    content: string;
    progress?: number;
    dimensionName?: string;
    createdAt: string;
  }>;
}) {
  // 折叠状态：按 Agent 类型折叠
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(
    new Set()
  );
  const { t } = useI18n();
  // 展开状态：单条记录详情
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // ★ 使用 Array.isArray 确保是数组
  const safeThinkings = Array.isArray(thinkings) ? thinkings : [];
  const safeWsEvents = Array.isArray(wsEvents) ? wsEvents : [];
  const safePersistedActivities = Array.isArray(persistedActivities)
    ? persistedActivities
    : [];

  const toggleAgentCollapse = (agentType: string) => {
    setCollapsedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentType)) {
        next.delete(agentType);
      } else {
        next.add(agentType);
      }
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 从 missionStatus 中提取 Leader 理解意图
  const leaderPlan = missionStatus?.leaderPlan;

  // 从 WebSocket 事件中提取所有 Agent 的活动
  const agentActivities = useMemo(() => {
    type AgentActivity = {
      id: string;
      agentType: 'leader' | 'researcher' | 'reviewer' | 'synthesizer';
      eventType: string;
      phase?: string;
      content: string;
      progress?: number;
      dimensionName?: string;
      agentName?: string;
      timestamp: Date;
      reviewResult?: {
        qualityLevel?: string;
        overallScore?: number;
        scores?: Record<string, number>;
        issueCount?: number;
        suggestions?: string[];
        needsReresearch?: boolean;
        type?: string;
        dimensionCount?: number;
        recommendations?: string[];
        dimensionsToReresearch?: string[];
      };
    };

    const activities: AgentActivity[] = [];

    safeWsEvents.forEach((e, idx) => {
      const data = e.data as Record<string, unknown>;

      // Leader 事件
      if (e.type === 'leader:thinking') {
        activities.push({
          id: `leader-thinking-${idx}`,
          agentType: 'leader',
          eventType: 'thinking',
          phase: (data.phase as string) || 'thinking',
          content: (data.content as string) || '',
          progress: data.progress as number,
          timestamp: new Date(e.timestamp),
        });
      } else if (e.type === 'leader:planning') {
        activities.push({
          id: `leader-planning-${idx}`,
          agentType: 'leader',
          eventType: 'planning',
          phase: 'planning',
          content:
            safeString(data.message) ||
            t('topicResearch.contentPanel.ws.planning'),
          progress: data.progress as number,
          timestamp: new Date(e.timestamp),
        });
      }
      // 研究员事件
      else if (e.type === 'dimension:research_started') {
        activities.push({
          id: `researcher-start-${idx}`,
          agentType: 'researcher',
          eventType: 'start',
          phase: 'researching',
          content: t('topicResearch.contentPanel.ws.startResearch', {
            dimension:
              safeString(data.dimensionName) ||
              t('topicResearch.contentPanel.ws.dimensionResearch'),
          }),
          dimensionName: safeString(data.dimensionName),
          agentName: safeString(data.agentName),
          timestamp: new Date(e.timestamp),
        });
      } else if (e.type === 'dimension:research_progress') {
        activities.push({
          id: `researcher-progress-${idx}`,
          agentType: 'researcher',
          eventType: 'progress',
          phase: safeString(data.phase) || 'researching',
          content:
            safeString(data.message) ||
            t('topicResearch.contentPanel.ws.researching'),
          progress: data.progress as number,
          dimensionName: safeString(data.dimensionName),
          agentName: safeString(data.agentName),
          timestamp: new Date(e.timestamp),
        });
      } else if (e.type === 'dimension:research_completed') {
        activities.push({
          id: `researcher-complete-${idx}`,
          agentType: 'researcher',
          eventType: 'complete',
          phase: 'completed',
          content: t('topicResearch.contentPanel.ws.completeResearch', {
            dimension:
              safeString(data.dimensionName) ||
              t('topicResearch.contentPanel.ws.dimensionResearch'),
          }),
          dimensionName: safeString(data.dimensionName),
          agentName: safeString(data.agentName),
          timestamp: new Date(e.timestamp),
        });
      }
      // Agent 工作事件
      else if (e.type === 'agent:working') {
        const role = safeString(data.agentRole) || 'researcher';
        activities.push({
          id: `agent-working-${idx}`,
          agentType: role as AgentActivity['agentType'],
          eventType: data.status === 'completed' ? 'complete' : 'working',
          phase: data.status === 'completed' ? 'completed' : 'working',
          content:
            safeString(data.taskDescription) ||
            `${safeString(data.agentName) || 'Agent'} 正在工作...`,
          progress: data.progress as number,
          dimensionName: safeString(data.dimensionName),
          agentName: safeString(data.agentName),
          timestamp: new Date(e.timestamp),
          reviewResult: data.reviewResult as AgentActivity['reviewResult'],
        });
      }
      // 报告撰写事件
      else if (e.type === 'report:synthesis_started') {
        activities.push({
          id: `synthesizer-start-${idx}`,
          agentType: 'synthesizer',
          eventType: 'start',
          phase: 'synthesizing',
          content: t('topicResearch.contentPanel.ws.startReport'),
          timestamp: new Date(e.timestamp),
        });
      } else if (e.type === 'report:synthesis_progress') {
        activities.push({
          id: `synthesizer-progress-${idx}`,
          agentType: 'synthesizer',
          eventType: 'progress',
          phase: safeString(data.phase) || 'synthesizing',
          content:
            safeString(data.message) ||
            t('topicResearch.contentPanel.ws.writingReport'),
          progress: data.progress as number,
          timestamp: new Date(e.timestamp),
        });
      } else if (e.type === 'report:synthesis_completed') {
        activities.push({
          id: `synthesizer-complete-${idx}`,
          agentType: 'synthesizer',
          eventType: 'complete',
          phase: 'completed',
          content: t('topicResearch.contentPanel.ws.reportComplete'),
          timestamp: new Date(e.timestamp),
        });
      }
      // 任务事件
      else if (e.type === 'task:progress') {
        const taskType = safeString(data.taskType);
        let agentType: AgentActivity['agentType'] = 'researcher';
        if (taskType === 'quality_review') agentType = 'reviewer';
        else if (taskType === 'report_synthesis') agentType = 'synthesizer';

        activities.push({
          id: `task-progress-${idx}`,
          agentType,
          eventType: 'progress',
          phase: safeString(data.status) || 'executing',
          content:
            safeString(data.message) ||
            safeString(data.title) ||
            t('topicResearch.contentPanel.ws.taskRunning'),
          progress: data.progress as number,
          dimensionName: safeString(data.dimensionName),
          timestamp: new Date(e.timestamp),
        });
      }
    });

    // Add persisted activities from database
    safePersistedActivities.forEach((pa) => {
      const agentRole = pa.agentRole as AgentActivity['agentType'];
      activities.push({
        id: `persisted-${pa.id}`,
        agentType: agentRole || 'researcher',
        eventType: pa.activityType.toLowerCase(),
        phase: pa.phase || pa.activityType.toLowerCase(),
        content: pa.content,
        progress: pa.progress,
        dimensionName: pa.dimensionName,
        agentName: pa.agentName,
        timestamp: new Date(pa.createdAt),
      });
    });

    // Sort by timestamp
    activities.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return activities;
  }, [safeWsEvents, safePersistedActivities, t]);

  // 按 Agent 类型分组活动（★ 大小写不敏感）
  const activitiesByAgent = useMemo(() => {
    const grouped: Record<string, typeof agentActivities> = {
      leader: [],
      researcher: [],
      reviewer: [],
      synthesizer: [],
    };

    agentActivities.forEach((activity) => {
      // ★ 安全处理：大小写不敏感匹配
      const key = activity.agentType?.toLowerCase() || 'researcher';
      if (grouped[key]) {
        grouped[key].push(activity);
      } else {
        // 未知类型归入 researcher
        grouped.researcher.push(activity);
      }
    });

    return grouped;
  }, [agentActivities]);

  // ★ 研究员按维度拆分（每个维度独立显示）
  const researchersByDimension = useMemo(() => {
    const grouped: Record<string, typeof agentActivities> = {};

    activitiesByAgent.researcher.forEach((activity) => {
      const dimKey =
        activity.dimensionName ||
        t('topicResearch.contentPanel.unknownDimension');
      if (!grouped[dimKey]) {
        grouped[dimKey] = [];
      }
      grouped[dimKey].push(activity);
    });

    // 按维度名称排序
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  }, [activitiesByAgent.researcher, t]);

  // Agent 类型配置
  const agentConfig: Record<
    string,
    {
      icon: string;
      label: string;
      color: string;
      bgColor: string;
      borderColor: string;
      headerBg: string;
    }
  > = useMemo(
    () => ({
      leader: {
        icon: '👑',
        label: 'Leader 决策',
        color: 'text-purple-700',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-200',
        headerBg: 'bg-purple-100',
      },
      researcher: {
        icon: '🔍',
        label: t('topicResearch.contentPanel.agentLabels.researcher'),
        color: 'text-blue-700',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-200',
        headerBg: 'bg-blue-100',
      },
      reviewer: {
        icon: '✅',
        label: t('topicResearch.contentPanel.agentLabels.reviewer'),
        color: 'text-green-700',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        headerBg: 'bg-green-100',
      },
      synthesizer: {
        icon: '📝',
        label: t('topicResearch.contentPanel.agentLabels.synthesizer'),
        color: 'text-orange-700',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-200',
        headerBg: 'bg-orange-100',
      },
    }),
    [t]
  );

  // ★ 默认 Agent 配置（用于 ThinkingTabContent）
  const defaultThinkingAgentConfig = {
    icon: '🤖',
    label: 'Agent',
    color: 'text-gray-700',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    headerBg: 'bg-gray-100',
  };

  // ★ 安全获取 Agent 配置（用于所有 Agent 展示）
  const getAgentConfigSafe = (agentType: string) => {
    const key = agentType?.toLowerCase() || 'researcher';
    return (
      agentConfig[key] || agentConfig[agentType] || defaultThinkingAgentConfig
    );
  };

  // 别名：用于 ThinkingTabContent
  const getThinkingAgentConfig = getAgentConfigSafe;

  // 判断是否有实际内容
  const hasContent =
    safeThinkings.length > 0 ||
    agentActivities.length > 0 ||
    leaderPlan?.taskUnderstanding;

  if (!hasContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-purple-100">
          <ThinkingIcon className="h-10 w-10 text-purple-500" />
        </div>
        <h3 className="mt-4 text-lg font-medium text-gray-900">
          Agent 思考架构
        </h3>
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          研究过程中，各 Agent 的推理链路、决策依据和思考过程将在此展示
        </p>
        <div className="mt-6 w-full max-w-md space-y-3">
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
              <span>👑</span> Leader 决策链
            </div>
            <p className="mt-2 text-xs text-purple-600">
              任务理解 → 维度规划 → Agent 分配 → 质量审核 → 报告整合
            </p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
              <Search className="h-4 w-4" /> 研究员推理链
            </div>
            <p className="mt-2 text-xs text-blue-600">
              信息检索 → 数据分析 → 关键发现 → 结论推导
            </p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700">
              <CheckCircle2 className="h-4 w-4" /> 审核反馈链
            </div>
            <p className="mt-2 text-xs text-green-600">
              质量评估 → 一致性检查 → 改进建议 → 通过/拒绝决定
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 有内容时 - 按 Agent 分组显示，支持折叠
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="space-y-3">
        {/* ==================== Leader 区块（可折叠）==================== */}
        {(leaderPlan?.taskUnderstanding ||
          activitiesByAgent.leader.length > 0) && (
          <AgentSection
            agentType="leader"
            config={getAgentConfigSafe('leader')}
            isCollapsed={collapsedAgents.has('leader')}
            onToggle={() => toggleAgentCollapse('leader')}
            itemCount={
              (leaderPlan?.taskUnderstanding ? 1 : 0) +
              activitiesByAgent.leader.length
            }
          >
            {/* Leader 任务理解 */}
            {leaderPlan?.taskUnderstanding && (
              <div className="rounded-lg bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-purple-700">
                  🎯 任务理解
                </div>
                <div className="space-y-2 text-sm">
                  <p>
                    <span className="text-gray-500">主题:</span>{' '}
                    {leaderPlan.taskUnderstanding.topic}
                  </p>
                  <p>
                    <span className="text-gray-500">范围:</span>{' '}
                    {leaderPlan.taskUnderstanding.scope}
                  </p>
                  {leaderPlan.taskUnderstanding.objectives?.length > 0 && (
                    <div>
                      <span className="text-gray-500">目标:</span>
                      <ul className="mt-1 list-inside list-disc text-gray-700">
                        {leaderPlan.taskUnderstanding.objectives.map(
                          (obj, i) => (
                            <li key={i}>{obj}</li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 执行策略 */}
            {leaderPlan?.executionStrategy && (
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="mb-2 text-sm font-semibold text-purple-700">
                  🧭 执行策略
                </div>
                <div className="space-y-1 text-xs text-gray-600">
                  <p>并行度: {leaderPlan.executionStrategy.parallelism}</p>
                  {leaderPlan.executionStrategy.estimatedTime && (
                    <p>预计: {leaderPlan.executionStrategy.estimatedTime}</p>
                  )}
                </div>
              </div>
            )}

            {/* 维度规划 */}
            {leaderPlan?.dimensions && leaderPlan.dimensions.length > 0 && (
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="mb-2 text-sm font-semibold text-purple-700">
                  📋 研究维度 ({leaderPlan.dimensions.length})
                </div>
                <div className="space-y-1">
                  {leaderPlan.dimensions.map((dim, idx) => (
                    <div
                      key={dim.id || idx}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                        {idx + 1}
                      </span>
                      <span className="text-gray-700">{dim.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agent 分配 */}
            {leaderPlan?.agentAssignments &&
              leaderPlan.agentAssignments.length > 0 && (
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <div className="mb-2 text-sm font-semibold text-purple-700">
                    👥 Agent 分配
                  </div>
                  <div className="space-y-1">
                    {leaderPlan.agentAssignments.map((a, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span>
                          {a.agentType === 'dimension_researcher'
                            ? '🔍'
                            : a.agentType === 'quality_reviewer'
                              ? '✅'
                              : '📝'}
                        </span>
                        <span className="text-gray-700">{a.role}</span>
                        {a.assignedDimensions &&
                          a.assignedDimensions.length > 0 && (
                            <span className="text-gray-400">
                              → {a.assignedDimensions.join(', ')}
                            </span>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Leader 思考活动 */}
            {activitiesByAgent.leader.length > 0 && (
              <div className="space-y-1">
                {activitiesByAgent.leader.map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} />
                ))}
              </div>
            )}
          </AgentSection>
        )}

        {/* ==================== 研究员区块（按维度拆分，每个维度独立折叠）==================== */}
        {researchersByDimension.map(([dimensionName, activities]) => {
          const sectionKey = `researcher-${dimensionName}`;
          const isCollapsed = collapsedAgents.has(sectionKey);
          // 动态配置：每个维度使用不同的颜色渐变
          const dimIndex = researchersByDimension.findIndex(
            ([d]) => d === dimensionName
          );
          const colorVariants = [
            {
              color: 'text-blue-700',
              bgColor: 'bg-blue-50',
              borderColor: 'border-blue-200',
              headerBg: 'bg-blue-100',
            },
            {
              color: 'text-indigo-700',
              bgColor: 'bg-indigo-50',
              borderColor: 'border-indigo-200',
              headerBg: 'bg-indigo-100',
            },
            {
              color: 'text-cyan-700',
              bgColor: 'bg-cyan-50',
              borderColor: 'border-cyan-200',
              headerBg: 'bg-cyan-100',
            },
            {
              color: 'text-teal-700',
              bgColor: 'bg-teal-50',
              borderColor: 'border-teal-200',
              headerBg: 'bg-teal-100',
            },
            {
              color: 'text-sky-700',
              bgColor: 'bg-sky-50',
              borderColor: 'border-sky-200',
              headerBg: 'bg-sky-100',
            },
            {
              color: 'text-violet-700',
              bgColor: 'bg-violet-50',
              borderColor: 'border-violet-200',
              headerBg: 'bg-violet-100',
            },
            {
              color: 'text-fuchsia-700',
              bgColor: 'bg-fuchsia-50',
              borderColor: 'border-fuchsia-200',
              headerBg: 'bg-fuchsia-100',
            },
          ];
          const variant = colorVariants[dimIndex % colorVariants.length];
          const dimConfig = {
            icon: '🔍',
            label: t('topicResearch.contentPanel.researcherDimension', {
              dimension: dimensionName,
            }),
            ...variant,
          };

          return (
            <AgentSection
              key={sectionKey}
              agentType="researcher"
              config={dimConfig}
              isCollapsed={isCollapsed}
              onToggle={() => toggleAgentCollapse(sectionKey)}
              itemCount={activities.length}
            >
              <div className="space-y-1">
                {activities.map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} />
                ))}
              </div>
            </AgentSection>
          );
        })}

        {/* ==================== 审核员区块（可折叠）==================== */}
        {activitiesByAgent.reviewer.length > 0 && (
          <AgentSection
            agentType="reviewer"
            config={getAgentConfigSafe('reviewer')}
            isCollapsed={collapsedAgents.has('reviewer')}
            onToggle={() => toggleAgentCollapse('reviewer')}
            itemCount={activitiesByAgent.reviewer.length}
          >
            <div className="space-y-1">
              {activitiesByAgent.reviewer.map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))}
            </div>
          </AgentSection>
        )}

        {/* ==================== 撰写员区块（可折叠）==================== */}
        {activitiesByAgent.synthesizer.length > 0 && (
          <AgentSection
            agentType="synthesizer"
            config={getAgentConfigSafe('synthesizer')}
            isCollapsed={collapsedAgents.has('synthesizer')}
            onToggle={() => toggleAgentCollapse('synthesizer')}
            itemCount={activitiesByAgent.synthesizer.length}
          >
            <div className="space-y-1">
              {activitiesByAgent.synthesizer.map((activity) => (
                <ActivityItem key={activity.id} activity={activity} />
              ))}
            </div>
          </AgentSection>
        )}

        {/* 原有的 Agent 思考记录（兼容旧数据） */}
        {safeThinkings.length > 0 &&
          Object.entries(
            safeThinkings.reduce(
              (acc, t) => {
                const key = t.agentType;
                if (!acc[key]) acc[key] = [];
                acc[key].push(t);
                return acc;
              },
              {} as Record<string, AgentThinking[]>
            )
          ).map(([agentType, thinkingList]) => {
            const config = getThinkingAgentConfig(agentType);
            const isCollapsed = collapsedAgents.has(`thinking-${agentType}`);

            return (
              <div
                key={`thinking-${agentType}`}
                className={`overflow-hidden rounded-lg border ${config.borderColor}`}
              >
                <button
                  onClick={() => toggleAgentCollapse(`thinking-${agentType}`)}
                  className={`flex w-full items-center justify-between px-4 py-3 ${config.headerBg}`}
                >
                  <div className="flex items-center gap-2">
                    <span>{config.icon}</span>
                    <span className={`font-medium ${config.color}`}>
                      {config.label} 思考记录
                    </span>
                    <span className="text-xs text-gray-500">
                      ({thinkingList.length})
                    </span>
                  </div>
                  <ChevronDownIcon
                    className={`h-4 w-4 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                  />
                </button>

                {!isCollapsed && (
                  <div className={`divide-y divide-gray-100 ${config.bgColor}`}>
                    {thinkingList.map((thinking) => {
                      const isExpanded = expandedIds.has(thinking.id);
                      return (
                        <div key={thinking.id} className="p-3">
                          <button
                            onClick={() => toggleExpand(thinking.id)}
                            className="flex w-full items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-white px-2 py-0.5 text-xs text-gray-600">
                                {thinking.phase}
                              </span>
                              <span className="line-clamp-1 text-sm text-gray-700">
                                {thinking.thinking.slice(0, 80)}...
                              </span>
                            </div>
                            <ChevronDownIcon
                              className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {isExpanded && (
                            <div className="mt-2 rounded-lg bg-white p-3 text-sm">
                              <p className="whitespace-pre-wrap text-gray-700">
                                {thinking.thinking}
                              </p>
                              {thinking.decision && (
                                <p className="mt-2 font-medium text-gray-800">
                                  决策: {thinking.decision}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// Agent 区块组件（可折叠）
function AgentSection({
  agentType,
  config,
  isCollapsed,
  onToggle,
  itemCount,
  children,
}: {
  agentType: string;
  config: {
    icon: string;
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    headerBg: string;
  };
  isCollapsed: boolean;
  onToggle: () => void;
  itemCount: number;
  children: React.ReactNode;
}) {
  return (
    <div className={`overflow-hidden rounded-lg border ${config.borderColor}`}>
      <button
        onClick={onToggle}
        className={`flex w-full items-center justify-between px-4 py-3 ${config.headerBg} hover:opacity-90`}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{config.icon}</span>
          <span className={`font-semibold ${config.color}`}>
            {config.label}
          </span>
          <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs text-gray-600">
            {itemCount} 条记录
          </span>
        </div>
        <ChevronDownIcon
          className={`h-5 w-5 ${config.color} transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
        />
      </button>
      {!isCollapsed && (
        <div className={`space-y-2 p-3 ${config.bgColor}`}>{children}</div>
      )}
    </div>
  );
}

// 活动项组件
function ActivityItem({
  activity,
}: {
  activity: {
    id: string;
    eventType: string;
    phase?: string;
    content: string;
    progress?: number;
    dimensionName?: string;
    agentName?: string;
    timestamp: Date;
    reviewResult?: {
      qualityLevel?: string;
      overallScore?: number;
      scores?: Record<string, number>;
      issueCount?: number;
      suggestions?: string[];
      needsReresearch?: boolean;
      type?: string;
      dimensionCount?: number;
      recommendations?: string[];
      dimensionsToReresearch?: string[];
    };
  };
}) {
  const { t } = useI18n();
  const eventTypeColors: Record<string, string> = {
    start: 'bg-green-100 text-green-700',
    progress: 'bg-blue-100 text-blue-700',
    complete: 'bg-emerald-100 text-emerald-700',
    thinking: 'bg-purple-100 text-purple-700',
    planning: 'bg-indigo-100 text-indigo-700',
    working: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="flex items-start gap-2 rounded-lg bg-white p-2.5 shadow-sm">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${eventTypeColors[activity.eventType] || 'bg-gray-100 text-gray-600'}`}
      >
        {activity.phase || activity.eventType}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-700">{activity.content}</p>

        {/* ★ 审核结果展示 */}
        {activity.reviewResult && (
          <div className="mt-1.5 rounded-md bg-gray-50 p-2">
            {activity.reviewResult.overallScore !== undefined && (
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    activity.reviewResult.qualityLevel === 'excellent'
                      ? 'bg-green-100 text-green-700'
                      : activity.reviewResult.qualityLevel === 'good'
                        ? 'bg-blue-100 text-blue-700'
                        : activity.reviewResult.qualityLevel === 'acceptable'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                  }`}
                >
                  {activity.reviewResult.qualityLevel === 'excellent'
                    ? t('topicResearch.contentPanel.excellent')
                    : activity.reviewResult.qualityLevel === 'good'
                      ? t('topicResearch.contentPanel.good')
                      : activity.reviewResult.qualityLevel === 'acceptable'
                        ? t('topicResearch.contentPanel.qualified')
                        : activity.reviewResult.qualityLevel ===
                            'needs_revision'
                          ? t('topicResearch.contentPanel.needsRevision')
                          : t('topicResearch.contentPanel.fail')}
                </span>
                <span className="text-xs font-semibold text-gray-700">
                  {activity.reviewResult.overallScore}分
                </span>
              </div>
            )}
            {activity.reviewResult.scores && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
                {Object.entries(activity.reviewResult.scores).map(
                  ([key, val]) => (
                    <span key={key}>
                      {key === 'breadth'
                        ? t('topicResearch.contentPanel.breadth')
                        : key === 'depth'
                          ? t('topicResearch.contentPanel.depth')
                          : key === 'evidence'
                            ? t('topicResearch.contentPanel.evidence')
                            : key === 'coherence'
                              ? t('topicResearch.contentPanel.coherence')
                              : key === 'currency'
                                ? t('topicResearch.contentPanel.timeliness')
                                : key}
                      : {val}
                    </span>
                  )
                )}
              </div>
            )}
            {activity.reviewResult.suggestions &&
              activity.reviewResult.suggestions.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {activity.reviewResult.suggestions.map((s, i) => (
                    <p key={i} className="text-[10px] text-gray-500">
                      • {s}
                    </p>
                  ))}
                </div>
              )}
            {activity.reviewResult.recommendations &&
              activity.reviewResult.recommendations.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {activity.reviewResult.recommendations.map((r, i) => (
                    <p key={i} className="text-[10px] text-gray-500">
                      • {r}
                    </p>
                  ))}
                </div>
              )}
            {activity.reviewResult.needsReresearch && (
              <p className="mt-1 text-[10px] font-medium text-orange-600">
                需要重新研究
                {activity.reviewResult.dimensionsToReresearch?.length
                  ? `：${activity.reviewResult.dimensionsToReresearch.join('、')}`
                  : ''}
              </p>
            )}
          </div>
        )}

        <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
          {activity.dimensionName && <span>{activity.dimensionName}</span>}
          {activity.agentName && <span>• {activity.agentName}</span>}
          {activity.progress !== undefined && (
            <span className="text-blue-500">{activity.progress}%</span>
          )}
          <span>
            <ClientDate
              date={activity.timestamp}
              format="time"
              timeOptions={{ hour: '2-digit', minute: '2-digit' }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

// ==================== 证据来源 Tab ====================
function EvidenceTabContent({
  evidence,
  report,
  dimensions,
  isLoading,
  autoExpandId,
  onAutoExpandHandled,
}: {
  evidence: TopicEvidence[];
  report: TopicReport | null;
  dimensions: TopicDimension[];
  isLoading: boolean;
  autoExpandId?: string | null;
  onAutoExpandHandled?: () => void;
}) {
  const { t } = useI18n();
  // ★ 使用 Array.isArray 确保是数组
  const safeEvidence = Array.isArray(evidence) ? evidence : [];
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>(
    'all'
  );
  const [sortBy, setSortBy] = useState<'credibility' | 'date'>('credibility');
  // ★ 跟踪展开的证据卡片
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ★ 自动展开从引用点击导航过来的证据卡片
  useEffect(() => {
    if (autoExpandId) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(autoExpandId);
        return next;
      });
      // 通知父组件已处理
      onAutoExpandHandled?.();
    }
  }, [autoExpandId, onAutoExpandHandled]);

  // 构建证据ID到引用位置的映射
  const citationLocations = useMemo(() => {
    const locations = new Map<
      string,
      { dimensionName: string; count: number }[]
    >();

    if (!report?.dimensionAnalyses) return locations;

    // 构建维度ID到名称的映射
    const dimensionNameMap = new Map<string, string>();
    dimensions.forEach((dim) => {
      dimensionNameMap.set(dim.id, dim.name);
    });

    // 构建证据ID到索引的映射 (用于匹配 [1], [2] 格式)
    const evidenceIndexMap = new Map<number, string>();
    safeEvidence.forEach((e, idx) => {
      evidenceIndexMap.set(idx + 1, e.id);
    });

    // 遍历每个维度分析，查找引用
    report.dimensionAnalyses.forEach((analysis) => {
      const dimName =
        dimensionNameMap.get(analysis.dimensionId) ||
        t('topicResearch.contentPanel.unknownDimension');
      const content =
        (analysis.detailedContent || '') + (analysis.summary || '');

      // 匹配多种引用格式: [1], [1, 2], [temp-x-y], [uuid]
      const citationPattern =
        /\[(\d+(?:\s*,\s*\d+)*)\]|\[(temp-\d+-\d+)\]|\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
      const foundEvidenceIds = new Set<string>();

      let match;
      while ((match = citationPattern.exec(content)) !== null) {
        if (match[1]) {
          // 数字格式 [1] 或 [1, 2]
          const indices = match[1].split(/\s*,\s*/).map((s) => parseInt(s, 10));
          indices.forEach((idx) => {
            const evidenceId = evidenceIndexMap.get(idx);
            if (evidenceId) foundEvidenceIds.add(evidenceId);
          });
        } else if (match[2]) {
          // temp-x-y 格式
          const evidenceId = match[2];
          // 检查是否在当前证据列表中
          if (safeEvidence.some((e) => e.id === evidenceId)) {
            foundEvidenceIds.add(evidenceId);
          }
        } else if (match[3]) {
          // UUID 格式
          const evidenceId = match[3];
          // 检查是否在当前证据列表中
          if (safeEvidence.some((e) => e.id === evidenceId)) {
            foundEvidenceIds.add(evidenceId);
          }
        }
      }

      // 更新每个证据的引用位置
      foundEvidenceIds.forEach((evidenceId) => {
        const existing = locations.get(evidenceId) || [];
        const dimEntry = existing.find((e) => e.dimensionName === dimName);
        if (dimEntry) {
          dimEntry.count++;
        } else {
          existing.push({ dimensionName: dimName, count: 1 });
        }
        locations.set(evidenceId, existing);
      });
    });

    return locations;
  }, [report, dimensions, safeEvidence]);

  // 筛选和排序
  const filteredEvidence = useMemo(() => {
    let result = [...safeEvidence];

    if (filter !== 'all') {
      result = result.filter((e) => {
        const score = e.credibilityScore || 0;
        if (filter === 'high') return score >= 70;
        if (filter === 'medium') return score >= 40 && score < 70;
        if (filter === 'low') return score < 40;
        return true;
      });
    }

    result.sort((a, b) => {
      if (sortBy === 'credibility') {
        return (b.credibilityScore || 0) - (a.credibilityScore || 0);
      }
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });

    return result;
  }, [safeEvidence, filter, sortBy]);

  // 统计
  const stats = useMemo(() => {
    const high = safeEvidence.filter(
      (e) => (e.credibilityScore || 0) >= 70
    ).length;
    const medium = safeEvidence.filter(
      (e) => (e.credibilityScore || 0) >= 40 && (e.credibilityScore || 0) < 70
    ).length;
    const low = safeEvidence.filter(
      (e) => (e.credibilityScore || 0) < 40
    ).length;
    return { total: safeEvidence.length, high, medium, low };
  }, [safeEvidence]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center px-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
          <SpinnerIcon className="h-10 w-10 animate-spin text-blue-600" />
        </div>
        <p className="mt-4 text-sm text-gray-500">
          {t('topicResearch.contentPanel.loadingEvidence')}
        </p>
      </div>
    );
  }

  if (safeEvidence.length === 0) {
    return (
      <EmptyState
        icon={<Link2 className="h-12 w-12" />}
        title={t('topicResearch.contentPanel.noEvidence')}
        description={t('topicResearch.contentPanel.noEvidenceHint')}
        size="md"
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {t('topicResearch.contentPanel.totalSources', {
              total: stats.total,
            })}
          </span>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-500"></span>
              {t('topicResearch.contentPanel.highCredibility')} {stats.high}
            </span>
            <span className="flex items-center gap-1 text-yellow-600">
              <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
              {t('topicResearch.contentPanel.mediumCredibility')} {stats.medium}
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <span className="h-2 w-2 rounded-full bg-red-500"></span>
              {t('topicResearch.contentPanel.lowCredibility')} {stats.low}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
          >
            <option value="all">
              {t('topicResearch.contentPanel.filterAll')}
            </option>
            <option value="high">
              {t('topicResearch.contentPanel.filterHigh')}
            </option>
            <option value="medium">
              {t('topicResearch.contentPanel.filterMedium')}
            </option>
            <option value="low">
              {t('topicResearch.contentPanel.filterLow')}
            </option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
          >
            <option value="credibility">
              {t('topicResearch.contentPanel.sortByCredibility')}
            </option>
            <option value="date">
              {t('topicResearch.contentPanel.sortByDate')}
            </option>
          </select>
        </div>
      </div>

      {/* 证据列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-4 md:grid-cols-2">
          {filteredEvidence.map((item) => {
            // 找到该证据在原始列表中的索引，用于显示引用编号 [1], [2]
            const citationIndex =
              safeEvidence.findIndex((e) => e.id === item.id) + 1;
            const isExpanded = expandedIds.has(item.id);
            return (
              <div
                key={item.id}
                id={`evidence-${item.id}`}
                className="group rounded-lg border border-gray-200 bg-white transition-all hover:border-blue-300 hover:shadow-md"
              >
                {/* Header - 可点击展开/收起 */}
                <div
                  className="cursor-pointer p-4"
                  onClick={() => toggleExpanded(item.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        {/* 引用编号标识 */}
                        <span className="flex-shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-bold text-purple-700">
                          [{citationIndex}]
                        </span>
                        <h4 className="font-medium text-gray-900">
                          {item.title}
                        </h4>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {item.domain}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.credibilityScore !== null && (
                        <span
                          className={`flex-shrink-0 rounded-full px-2 py-1 text-xs font-bold ${
                            item.credibilityScore >= 70
                              ? 'bg-green-100 text-green-700'
                              : item.credibilityScore >= 40
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {item.credibilityScore}%
                        </span>
                      )}
                      {/* 展开/收起图标 */}
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </div>
                  </div>

                  {/* 摘要预览（收起状态） */}
                  {!isExpanded && item.snippet && (
                    <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                      {item.snippet}
                    </p>
                  )}
                </div>

                {/* 展开内容 */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {/* 完整正文内容 */}
                    {item.snippet && (
                      <div className="max-h-64 overflow-y-auto bg-gray-50 p-4">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                          {item.snippet}
                        </p>
                      </div>
                    )}

                    {/* 引用位置 */}
                    {citationLocations.get(item.id) &&
                      citationLocations.get(item.id)!.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-3">
                          <span className="text-xs text-gray-500">
                            {t('topicResearch.contentPanel.citedIn')}
                          </span>
                          {citationLocations.get(item.id)!.map((loc, idx) => (
                            <span
                              key={idx}
                              className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600"
                              title={t(
                                'topicResearch.contentPanel.citedInDimension',
                                {
                                  dimension: loc.dimensionName,
                                  count: loc.count,
                                }
                              )}
                            >
                              {loc.dimensionName}
                              {loc.count > 1 && (
                                <span className="ml-0.5 opacity-70">
                                  ×{loc.count}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}

                    {/* Footer - 元数据和操作 */}
                    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5">
                          {item.sourceType ||
                            t('topicResearch.contentPanel.webpage')}
                        </span>
                        {item.publishedAt && (
                          <ClientDate date={item.publishedAt} format="date" />
                        )}
                      </div>
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t('topicResearch.contentPanel.openOriginal')} ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* 收起状态的底部信息 */}
                {!isExpanded && (
                  <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5">
                        {item.sourceType ||
                          t('topicResearch.contentPanel.webpage')}
                      </span>
                      {citationLocations.get(item.id) &&
                        citationLocations.get(item.id)!.length > 0 && (
                          <span className="text-blue-500">
                            {t('topicResearch.contentPanel.citedCount', {
                              count: citationLocations.get(item.id)!.length,
                            })}
                          </span>
                        )}
                    </div>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('topicResearch.contentPanel.openOriginal')} ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ==================== ★ AI Writing 风格：详情预览组件 ====================

/**
 * 维度研究内容预览
 * 显示研究摘要和关键发现
 */
function DimensionContentPreview({ data }: { data: Record<string, unknown> }) {
  const summary = (data.summary as string) || '';
  const keyFindings = (data.keyFindings as string[]) || [];
  const dimensionName = (data.dimensionName as string) || '';

  return (
    <div className="space-y-3">
      {dimensionName && (
        <div className="flex items-center gap-2">
          <span className="text-lg">🔍</span>
          <span className="font-medium text-blue-700">{dimensionName}</span>
        </div>
      )}

      {summary && (
        <div>
          <h5 className="mb-1 text-xs font-semibold text-gray-500">研究摘要</h5>
          <p className="text-sm leading-relaxed text-gray-700">{summary}</p>
        </div>
      )}

      {keyFindings.length > 0 && (
        <div>
          <h5 className="mb-2 text-xs font-semibold text-gray-500">关键发现</h5>
          <ul className="space-y-1.5">
            {keyFindings.slice(0, 5).map((finding, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-sm text-gray-600"
              >
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                <span>
                  {typeof finding === 'string'
                    ? finding
                    : JSON.stringify(finding)}
                </span>
              </li>
            ))}
            {keyFindings.length > 5 && (
              <li className="text-xs text-gray-400">
                还有 {keyFindings.length - 5} 条发现...
              </li>
            )}
          </ul>
        </div>
      )}

      {!summary && keyFindings.length === 0 && (
        <p className="text-sm text-gray-400">暂无详细内容</p>
      )}
    </div>
  );
}

/**
 * 报告预览
 * 显示报告标题和摘要
 */
function ReportPreview({ data }: { data: Record<string, unknown> }) {
  const title = (data.title as string) || '';
  const summary = (data.summary as string) || '';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">📊</span>
        <span className="font-medium text-orange-700">研究报告</span>
      </div>

      {title && (
        <h4 className="text-base font-semibold text-gray-900">{title}</h4>
      )}

      {summary && (
        <div>
          <h5 className="mb-1 text-xs font-semibold text-gray-500">核心摘要</h5>
          <p className="text-sm leading-relaxed text-gray-700">
            {summary.slice(0, 300)}
            {summary.length > 300 && '...'}
          </p>
        </div>
      )}

      {!title && !summary && (
        <p className="text-sm text-gray-400">报告内容正在生成中...</p>
      )}
    </div>
  );
}

/**
 * Leader 规划预览
 * 显示规划的维度和策略
 */
function LeaderPlanPreview({ data }: { data: Record<string, unknown> }) {
  const dimensions =
    (data.dimensions as Array<{ name: string; description?: string }>) || [];
  const strategy =
    (data.strategy as string) || (data.researchStrategy as string) || '';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">👑</span>
        <span className="font-medium text-purple-700">Leader 研究规划</span>
      </div>

      {strategy && (
        <div>
          <h5 className="mb-1 text-xs font-semibold text-gray-500">研究策略</h5>
          <p className="text-sm leading-relaxed text-gray-600">{strategy}</p>
        </div>
      )}

      {dimensions.length > 0 && (
        <div>
          <h5 className="mb-2 text-xs font-semibold text-gray-500">
            规划维度 ({dimensions.length})
          </h5>
          <div className="grid gap-2">
            {dimensions.map((dim, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-purple-100 bg-purple-50 p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-200 text-xs font-medium text-purple-700">
                    {idx + 1}
                  </span>
                  <span className="font-medium text-purple-800">
                    {dim.name}
                  </span>
                </div>
                {dim.description && (
                  <p className="mt-1 pl-7 text-xs text-purple-600">
                    {dim.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!strategy && dimensions.length === 0 && (
        <p className="text-sm text-gray-400">规划详情加载中...</p>
      )}
    </div>
  );
}
