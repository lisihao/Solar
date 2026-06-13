'use client';

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { useAIWritingStore } from '@/stores';
import { useWritingStream } from '@/hooks/features/useWritingStream';
import { useWritingMissionView } from '@/hooks/features/useWritingMissionView';
import { useWritingDerivedView } from '@/hooks/features/useWritingDerivedView';
import {
  useWritingTimeline,
  type TimelineMessage,
} from '@/hooks/features/useWritingTimeline';
import type { Chapter, MissionLogItem } from '@/services/ai-writing/api';
import { getMissionLogs, getProjectMissions } from '@/services/ai-writing/api';
import { matchAgentByName } from '@/lib/features/ai-writing/agent-config';
import { WritingTeamPanel } from '@/components/ai-writing/WritingTeamPanel';
import CharacterRelationshipGraph from '@/components/ai-writing/CharacterRelationshipGraph';
import ChapterEditPanel from '@/components/ai-writing/ChapterEditPanel';
import ChapterImportModal from '@/components/ai-writing/ChapterImportModal';
import ClientDate from '@/components/common/ClientDate';
// DOME/SCORE Enhanced Components
import StoryAnalysisDashboard from '@/components/ai-writing/StoryAnalysisDashboard';
import HierarchicalSummaryTab from '@/components/ai-writing/HierarchicalSummaryTab';
import {
  FileText,
  BarChart3,
  Download,
  CheckCircle2,
  XCircle,
  Zap,
  Pencil,
  RefreshCw,
  Lightbulb,
  Globe,
  Paintbrush,
  Map,
  Building2,
  Users,
  User,
  Settings,
  Search,
  MessageSquare,
  MapPin,
  Link2,
  BookOpen,
  Library,
  MessagesSquare,
  Crown,
  AlertTriangle,
  Info,
  Pin,
  Calendar,
  Printer,
  ChevronDown,
  ChevronUp,
  FileCode,
  Swords,
  Check,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState, LoadingInline, ErrorState } from '@/components/ui';
import { ExportDialog } from '@/components/common/dialogs/ExportDialog';
import { useTranslation } from '@/lib/i18n';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Tabs } from '@/components/ui/tabs';

import { logger } from '@/lib/utils/logger';

// W4: terminal status helper (must match useWritingMissionView TERMINAL_STATUSES)
function isTerminalStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return [
    'completed',
    'failed',
    'cancelled',
    'quality-failed',
    'COMPLETED',
    'FAILED',
  ].includes(status);
}

// 根据后端返回的 agentName 匹配到前端配置（使用统一的匹配函数）
function getAgentConfig(agentName: string | undefined) {
  const config = matchAgentByName(agentName);
  return {
    icon: config.icon,
    color: config.color,
    gradient: config.gradient,
    name: config.nameCn,
    id: config.id,
  };
}

// 解析章节内容，提取 [设定]、[事件]、[关系] 等结构化数据
function parseChapterContent(content: string): {
  settings: string[];
  events: string[];
  relations: string[];
  other: string[];
} {
  const result = {
    settings: [] as string[],
    events: [] as string[],
    relations: [] as string[],
    other: [] as string[],
  };

  if (!content) return result;

  // 使用正则匹配 [类型] 内容 的模式
  const patterns = [
    { regex: /\[设定\]\s*([^[\n]+)/g, key: 'settings' as const },
    { regex: /\[事件\]\s*([^[\n]+)/g, key: 'events' as const },
    { regex: /\[关系\]\s*([^[\n]+)/g, key: 'relations' as const },
  ];

  let processedContent = content;

  for (const { regex, key } of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const item = match[1].trim().replace(/[。，、]+$/, '');
      if (item) {
        result[key].push(item);
        processedContent = processedContent.replace(match[0], '');
      }
    }
  }

  // 处理剩余未分类的内容
  const remaining = processedContent
    .replace(/\[设定\]|\[事件\]|\[关系\]/g, '')
    .split(/[。，]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  result.other = remaining;

  return result;
}

// 安全地将 description 转换为字符串（处理可能是对象的情况）
function safeStringifyDescription(
  description: string | Record<string, unknown> | unknown
): string {
  if (!description) return '';
  if (typeof description === 'string') return description;

  // 如果是对象，尝试提取有意义的内容
  if (typeof description === 'object' && description !== null) {
    const obj = description as Record<string, unknown>;

    // 尝试提取结构化内容
    const parts: string[] = [];

    // 处理常见的结构化字段
    if (obj.settings && Array.isArray(obj.settings)) {
      parts.push(
        ...obj.settings.map((s: unknown) =>
          typeof s === 'string' ? `[设定] ${s}` : ''
        )
      );
    }
    if (obj.events && Array.isArray(obj.events)) {
      parts.push(
        ...obj.events.map((e: unknown) =>
          typeof e === 'string' ? `[事件] ${e}` : ''
        )
      );
    }
    if (obj.relations && Array.isArray(obj.relations)) {
      parts.push(
        ...obj.relations.map((r: unknown) =>
          typeof r === 'string' ? `[关系] ${r}` : ''
        )
      );
    }

    // 如果提取到内容，返回格式化的字符串
    if (parts.filter((p) => p).length > 0) {
      return parts.filter((p) => p).join('\n');
    }

    // 如果有 content 或 text 字段，直接使用
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.description === 'string') return obj.description;

    // 最后尝试 JSON 字符串化
    try {
      return JSON.stringify(description, null, 2);
    } catch {
      return String(description);
    }
  }

  return String(description);
}

// 章节内容结构化显示组件
function ChapterContentStructured({
  content,
  chapterName,
}: {
  content: string;
  chapterName: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const parsed = parseChapterContent(content);

  const hasContent =
    parsed.settings.length > 0 ||
    parsed.events.length > 0 ||
    parsed.relations.length > 0;

  if (!hasContent) {
    // 如果解析不出结构，显示原文（截断）
    return (
      <div className="rounded-lg bg-gray-50 p-3">
        <div className="mb-2 font-medium text-gray-700">{chapterName}</div>
        <p className="line-clamp-3 text-sm text-gray-600">{content}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* 章节标题 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 transition-colors hover:bg-gray-50"
      >
        <span className="font-medium text-gray-800">{chapterName}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {parsed.settings.length}设定 · {parsed.events.length}事件 ·{' '}
            {parsed.relations.length}关系
          </span>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="space-y-3 border-t border-gray-100 p-3">
          {/* 设定 */}
          {parsed.settings.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-blue-600">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-100">
                  <MapPin className="h-3 w-3 text-blue-600" />
                </span>
                设定 ({parsed.settings.length})
              </div>
              <div className="space-y-1">
                {parsed.settings.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded bg-blue-50 px-2 py-1 text-xs text-gray-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 事件 */}
          {parsed.events.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-100">
                  <Zap className="h-3 w-3 text-amber-600" />
                </span>
                事件 ({parsed.events.length})
              </div>
              <div className="space-y-1">
                {parsed.events.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded bg-amber-50 px-2 py-1 text-xs text-gray-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关系 */}
          {parsed.relations.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-pink-600">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-pink-100">
                  <Link2 className="h-3 w-3 text-pink-600" />
                </span>
                关系 ({parsed.relations.length})
              </div>
              <div className="space-y-1">
                {parsed.relations.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded bg-pink-50 px-2 py-1 text-xs text-gray-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WritingProjectPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const { user, isLoading: authLoading } = useAuth();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    currentProject,
    isLoadingProjects,
    volumes,
    isLoadingVolumes,
    storyBible,
    error,
    fetchProject,
    fetchVolumes,
    fetchStoryBible,
    startMission,
    cancelMission,
    checkRunningMission,
    // [W4] Store real-time fields kept as fallback for isStuckMission/missionProgress (no new-system equivalent).
    // isMissionRunning/missionCompleted are now derived from missionView below; these store values serve as
    // offline fallback when canonical view hasn't loaded yet.
    isMissionRunning: isMissionRunningStore,
    missionProgress: missionProgressStore,
    missionMessage,
    missionCompleted: missionCompletedStore,
    // activeAgentIds: dead read — removed (replaced by agentViews from useWritingDerivedView)
    currentMissionId,
    isStuckMission,
    stuckMissionId,
    clearStuckMission,
    clearError,
    clearCurrentProjectData,
    // Multi-turn conversation
    conversationHistory,
    addToConversationHistory,
    clearConversationHistory,
  } = useAIWritingStore();

  // ── W4: New canonical data-source triple ──────────────────────────────────
  //轨 A (immediacy): WS event stream
  const { events: writingEvents, connState: wsConnState } = useWritingStream(
    currentMissionId ?? null
  );

  //轨 B (truth): canonical REST view.
  // shouldPoll is derived after useWritingDerivedView to avoid forward-ref; initial value false,
  // polling kicks in on next render once we know terminal state.
  const [shouldPoll, setShouldPoll] = useState(false);
  const { data: writingMissionViewData, refresh: refreshMissionView } =
    useWritingMissionView(currentMissionId ?? undefined, { shouldPoll });

  // Derived views: MissionView / StageView[] / AgentView[]
  const { missionView, stageViews, agentViews, isTerminal } =
    useWritingDerivedView(writingMissionViewData, writingEvents);

  // Sync shouldPoll: poll when WS is not live and mission is not terminal
  useEffect(() => {
    setShouldPoll(wsConnState !== 'live' && !isTerminal);
  }, [wsConnState, isTerminal]);

  // Derived booleans — canonical view wins over store fields when available
  const isMissionRunning = missionView
    ? missionView.status === 'running'
    : isMissionRunningStore;
  const missionCompleted = missionView
    ? isTerminal &&
      missionView.status !== 'failed' &&
      missionView.status !== 'cancelled'
    : missionCompletedStore;

  // missionProgress: no direct canonical field; derive from completed stageViews ratio
  // [W4-GAP] stageViews don't carry a numeric progress %; fall back to store value.
  const missionProgress: number = (() => {
    if (stageViews.length > 0) {
      const done = stageViews.filter(
        (s) => s.status === 'done' || s.status === 'skipped'
      ).length;
      return Math.round((done / stageViews.length) * 100);
    }
    return missionProgressStore;
  })();

  // Terminal-event 3-burst refetch: when WS signals completion, pull canonical view
  useEffect(() => {
    if (!isTerminal || !currentMissionId) return;
    // Burst-refresh canonical view 3×(0 / 1.5s / 4s) to catch any trailing writes
    refreshMissionView();
    const t1 = setTimeout(() => refreshMissionView(), 1500);
    const t2 = setTimeout(() => refreshMissionView(), 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isTerminal, currentMissionId, refreshMissionView]);

  // ── end W4 hooks ──────────────────────────────────────────────────────────

  const [userInput, setUserInput] = useState('');
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [isEditingChapter, setIsEditingChapter] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showLeaderMenu, setShowLeaderMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<
    | 'chapters'
    | 'worldview'
    | 'storyBible'
    | 'relationships'
    | 'taskDetails'
    | 'analysis'
    | 'summaries'
  >('chapters');

  // W4.6 timeline: consistencyIssues + taskMessages derived from writing.* event stream
  const {
    consistencyIssues,
    taskMessages,
    setTaskMessages,
    taskMessagesEndRef,
    resetProcessedCount,
  } = useWritingTimeline(writingEvents);
  // Track expanded message IDs for showing details
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set()
  );
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showConsistencyPanel, setShowConsistencyPanel] = useState(true);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const lastMissionMessageRef = useRef<string>('');
  const hasLoadedLogsRef = useRef<boolean>(false);

  // 处理输入变化，检测 @Leader 提及
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setUserInput(value);

    // 检测 @ 触发，只显示 Leader 选项
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      // 只有输入 @ 或 @l/@le/@lea/@lead/@leade/@leader 时显示
      if (query === '' || 'leader'.startsWith(query)) {
        setShowLeaderMenu(true);
      } else {
        setShowLeaderMenu(false);
      }
    } else {
      setShowLeaderMenu(false);
    }
  };

  // 选择 @Leader
  const handleSelectLeader = () => {
    const cursorPos = inputRef.current?.selectionStart || userInput.length;
    const textBeforeCursor = userInput.slice(0, cursorPos);
    const textAfterCursor = userInput.slice(cursorPos);

    // 替换 @query 为 @Leader
    const newTextBefore = textBeforeCursor.replace(/@\w*$/, '@Leader ');
    const newText = newTextBefore + textAfterCursor;
    const newCursorPos = newTextBefore.length; // 光标位置在 @Leader 之后

    setUserInput(newText);
    setShowLeaderMenu(false);

    // 聚焦输入框并设置光标位置到 @Leader 之后
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // Clear old project data when projectId changes to prevent data mixing
  useEffect(() => {
    // Clear old data immediately when projectId changes
    clearCurrentProjectData();
    // Also reset local states
    setSelectedChapter(null);
    setTaskMessages([]);
    hasLoadedLogsRef.current = false;
    lastMissionMessageRef.current = '';
    resetProcessedCount();
  }, [projectId, clearCurrentProjectData, resetProcessedCount]);

  // Load project data
  useEffect(() => {
    if (user && projectId) {
      void fetchProject(projectId);
      void fetchVolumes(projectId);
      void fetchStoryBible(projectId);
      // 检查是否有正在运行的任务（同步多标签页状态）
      void checkRunningMission(projectId);
    }
  }, [
    user,
    projectId,
    fetchProject,
    fetchVolumes,
    fetchStoryBible,
    checkRunningMission,
  ]);

  // Load mission logs from database when entering project
  // 加载该项目所有任务的日志，确保历史消息不丢失
  useEffect(() => {
    const loadMissionLogs = async () => {
      if (!user || !projectId) return;

      try {
        // 获取项目的任务列表
        const { items: missions } = await getProjectMissions(projectId);
        if (!missions || missions.length === 0) return;

        // 按时间排序任务（从旧到新）
        const sortedMissions = missions.sort((a, b) => {
          const dateA = new Date(a.createdAt || a.startedAt || 0).getTime();
          const dateB = new Date(b.createdAt || b.startedAt || 0).getTime();
          return dateA - dateB; // 旧的在前
        });

        // 从所有任务中加载日志（每个任务最多200条，总共不超过1000条）
        const allMessages: TimelineMessage[] = [];
        const maxLogsPerMission = 200;
        const maxTotalLogs = 1000;

        for (const mission of sortedMissions) {
          if (!mission.id) continue;
          if (allMessages.length >= maxTotalLogs) break;

          try {
            const { items: logs } = await getMissionLogs(
              mission.id,
              Math.min(maxLogsPerMission, maxTotalLogs - allMessages.length)
            );
            if (!logs || logs.length === 0) continue;

            const messages: TimelineMessage[] = logs.map(
              (log: MissionLogItem) => {
                const msgType = log.eventType.includes('system')
                  ? 'system'
                  : log.eventType.includes('progress')
                    ? 'progress'
                    : 'agent';

                // Ensure content is always a string
                const content =
                  typeof log.content === 'string'
                    ? log.content
                    : JSON.stringify(log.content);

                return {
                  id: log.id,
                  type: msgType as 'user' | 'system' | 'agent' | 'progress',
                  content,
                  agent: log.agentName,
                  timestamp: new Date(log.createdAt),
                  detail: log.detail
                    ? {
                        type: (log.detail as { type?: string }).type as
                          | 'chapter_content'
                          | 'issues'
                          | 'world_settings'
                          | 'text',
                        data: (log.detail as { data?: unknown }).data as
                          | string
                          | Record<string, unknown>,
                      }
                    : undefined,
                };
              }
            );

            allMessages.push(...messages);
          } catch {
            // 单个任务日志加载失败，继续加载其他任务
            continue;
          }
        }

        // 按时间排序所有消息
        allMessages.sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );

        // 加载历史日志 - 始终加载以确保日志不丢失
        if (allMessages.length > 0) {
          hasLoadedLogsRef.current = true;
          setTaskMessages((prev) => {
            // 如果当前没有消息，直接使用历史日志
            if (prev.length === 0) {
              return allMessages;
            }
            // 如果当前只有一条系统消息（任务开始），用历史日志替换
            if (
              prev.length === 1 &&
              prev[0].type === 'system' &&
              prev[0].content.includes('任务开始')
            ) {
              return allMessages;
            }
            // 否则合并：历史日志 + 当前消息（去重）
            const existingIds = new Set(prev.map((m) => m.id));
            const newMessages = allMessages.filter(
              (m) => !existingIds.has(m.id)
            );
            return [...newMessages, ...prev].sort(
              (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
            );
          });
        } else {
          hasLoadedLogsRef.current = true;
        }
      } catch (error) {
        logger.error('Failed to load mission logs:', error);
        hasLoadedLogsRef.current = true;
      }
    };

    void loadMissionLogs();
  }, [user, projectId]);

  // Keep selectedChapter in sync with volumes data (for content updates during mission)
  useEffect(() => {
    if (selectedChapter) {
      const updatedChapter = volumes
        .flatMap((v) => v.chapters || [])
        .find((c) => c.id === selectedChapter.id);
      if (
        updatedChapter &&
        updatedChapter.content !== selectedChapter.content
      ) {
        setSelectedChapter(updatedChapter);
      }
    }
  }, [volumes, selectedChapter]);

  // Track mission messages and add to task details
  useEffect(() => {
    if (missionMessage && missionMessage !== lastMissionMessageRef.current) {
      lastMissionMessageRef.current = missionMessage;

      // Determine agent from message content
      let agent = 'AI 团队';
      if (missionMessage.includes('架构') || missionMessage.includes('规划')) {
        agent = '架构师';
      } else if (
        missionMessage.includes('世界观') ||
        missionMessage.includes('设定')
      ) {
        agent = '守护者';
      } else if (
        missionMessage.includes('作家') ||
        missionMessage.includes('创作') ||
        missionMessage.includes('章节')
      ) {
        agent = '作家';
      } else if (
        missionMessage.includes('检查') ||
        missionMessage.includes('校验')
      ) {
        agent = '检查员';
      } else if (
        missionMessage.includes('编辑') ||
        missionMessage.includes('润色')
      ) {
        agent = '编辑';
      }

      setTaskMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          type: 'progress',
          content: missionMessage,
          agent,
          timestamp: new Date(),
        },
      ]);

      // Auto scroll to bottom
      setTimeout(() => {
        taskMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [missionMessage]);

  // Add system message when mission starts/completes
  useEffect(() => {
    if (isMissionRunning && taskMessages.length === 0) {
      setTaskMessages([
        {
          id: `msg-${Date.now()}`,
          type: 'system',
          content: '任务开始执行，AI 团队正在协作...',
          timestamp: new Date(),
        },
      ]);
    }
  }, [isMissionRunning, taskMessages.length]);

  useEffect(() => {
    if (missionCompleted && taskMessages.length > 0) {
      const lastMsg = taskMessages[taskMessages.length - 1];
      if (lastMsg.type !== 'system' || !lastMsg.content.includes('完成')) {
        setTaskMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}`,
            type: 'system',
            content: '任务已完成！',
            timestamp: new Date(),
          },
        ]);
      }
    }
  }, [missionCompleted, taskMessages]);

  // Click outside handler for export menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(event.target as Node)
      ) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu]);

  // Auto-clear toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ★★★ 提取通用的 prompt 获取函数，避免代码重复
  const MIN_PROMPT_LENGTH = 5;

  const getEffectivePrompt = useCallback(
    (customPrompt: string): string => {
      return (
        customPrompt.trim() ||
        currentProject?.description?.trim() ||
        currentProject?.name ||
        ''
      );
    },
    [currentProject]
  );

  const handleStartWriting = async () => {
    if (!currentProject) return;

    // ★★★ 修复：确保使用项目描述作为故事创意，避免 AI 生成不相关内容
    const storyPrompt = getEffectivePrompt(userInput);

    if (!storyPrompt || storyPrompt.length < MIN_PROMPT_LENGTH) {
      setToast({
        message: `请输入至少 ${MIN_PROMPT_LENGTH} 个字的故事创意，或在项目设置中添加描述`,
        type: 'error',
      });
      return;
    }

    logger.debug(
      '[handleStartWriting] Using prompt:',
      storyPrompt.slice(0, 100)
    );

    try {
      await startMission(projectId, {
        prompt: storyPrompt,
        missionType: 'full_story',
        targetWordCount: currentProject.targetWords,
      });
      setUserInput('');
    } catch {
      // Error handled by store
    }
  };

  const handleContinueWriting = async () => {
    if (!currentProject) return;

    // ★★★ 修复：允许在任务运行中时重新开始（处理后端重启等情况）
    // 如果任务正在运行或卡住，先尝试取消再重新开始
    if (isMissionRunning || isStuckMission) {
      logger.debug(
        '[handleContinueWriting] Mission running or stuck, attempting to restart:',
        { isMissionRunning, isStuckMission, stuckMissionId }
      );
      // 尝试取消当前任务（可能后端已经重启，任务已不存在）
      try {
        await cancelMission(projectId);
      } catch {
        // 忽略取消错误，任务可能已经不存在
        logger.debug(
          '[handleContinueWriting] Cancel failed, continuing anyway'
        );
      }
      if (isStuckMission) {
        clearStuckMission();
      }
      // 等待状态更新
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 计算剩余需要写的字数
    const remainingWords = Math.max(
      0,
      currentProject.targetWords - currentProject.currentWords
    );

    // 如果已经达到目标字数，提示用户
    if (remainingWords <= 0) {
      setToast({
        message: '已达到目标字数！如需继续创作，请增加目标字数。',
        type: 'error',
      });
      return;
    }

    try {
      // ★★★ 修复：使用通用函数确保 prompt 有效
      const continuePrompt = getEffectivePrompt(userInput);

      if (!continuePrompt || continuePrompt.length < MIN_PROMPT_LENGTH) {
        setToast({
          message: `请输入至少 ${MIN_PROMPT_LENGTH} 个字的续写指令，或确保项目有描述`,
          type: 'error',
        });
        return;
      }

      logger.debug(
        '[handleContinueWriting] Using prompt:',
        continuePrompt.slice(0, 100)
      );

      // 始终使用 full_story 类型，让后端持续创作直到达到目标字数
      // 后端会自动根据当前进度继续写作
      await startMission(projectId, {
        prompt: continuePrompt,
        missionType: 'full_story',
        targetWordCount: currentProject.targetWords,
        additionalInstructions: `当前已有 ${currentProject.currentWords.toLocaleString()} 字，请继续创作直到达到目标。保持与已有内容的风格和主题一致。`,
      });
      setUserInput('');
    } catch {
      // Error handled by store
    }
  };

  const handleCancelMission = async () => {
    if (!currentProject) return;
    try {
      await cancelMission(projectId);
    } catch {
      // Error handled by store
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim() || !currentProject || isMissionRunning) return;

    // 检测是否 @Leader
    const hasLeaderMention = /@Leader\b/i.test(userInput);

    // @Leader 时使用 edit 类型，否则使用 chapter
    const missionType = hasLeaderMention ? 'edit' : 'chapter';

    // 清理提示词中的 @Leader 标记
    const cleanPrompt = userInput.replace(/@Leader\s*/gi, '').trim();

    // Add user message to task details
    setTaskMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        type: 'user',
        content: userInput,
        timestamp: new Date(),
      },
    ]);

    // Add to conversation history for multi-turn dialogue (多轮对话)
    addToConversationHistory({
      role: 'user',
      content: userInput,
    });

    // Switch to task details tab to show the conversation
    setActiveTab('taskDetails');

    try {
      await startMission(projectId, {
        prompt: cleanPrompt || userInput,
        missionType,
        targetAgent: hasLeaderMention ? 'leader' : undefined,
        // Pass conversation history for multi-turn dialogue context
        conversationHistory: conversationHistory,
      });
      setUserInput('');
      setShowLeaderMenu(false);
    } catch {
      // Error handled by store
    }
  };

  // 生成世界观内容
  const generateWorldviewContent = (format: 'md' | 'txt' | 'html') => {
    if (!storyBible) return '';
    const sections: string[] = [];

    // 故事设定
    if (storyBible.premise || storyBible.theme || storyBible.tone) {
      if (format === 'html') {
        let content = '<div class="worldview-section"><h3>故事设定</h3><dl>';
        if (storyBible.premise)
          content += `<dt>故事前提</dt><dd>${storyBible.premise}</dd>`;
        if (storyBible.theme)
          content += `<dt>主题</dt><dd>${storyBible.theme}</dd>`;
        if (storyBible.tone)
          content += `<dt>基调</dt><dd>${storyBible.tone}</dd>`;
        if (storyBible.worldType)
          content += `<dt>世界类型</dt><dd>${storyBible.worldType}</dd>`;
        content += '</dl></div>';
        sections.push(content);
      } else {
        const title = format === 'md' ? '## 故事设定\n' : '【故事设定】\n';
        let content = title;
        if (storyBible.premise)
          content += `${format === 'md' ? '**' : ''}故事前提${format === 'md' ? '**' : ''}：${storyBible.premise}\n`;
        if (storyBible.theme)
          content += `${format === 'md' ? '**' : ''}主题${format === 'md' ? '**' : ''}：${storyBible.theme}\n`;
        if (storyBible.tone)
          content += `${format === 'md' ? '**' : ''}基调${format === 'md' ? '**' : ''}：${storyBible.tone}\n`;
        if (storyBible.worldType)
          content += `${format === 'md' ? '**' : ''}世界类型${format === 'md' ? '**' : ''}：${storyBible.worldType}\n`;
        sections.push(content);
      }
    }

    // 角色列表
    if (storyBible.characters && storyBible.characters.length > 0) {
      if (format === 'html') {
        let content =
          '<div class="worldview-section"><h3>角色设定</h3><div class="characters">';
        storyBible.characters.forEach((char) => {
          content += `<div class="character"><h4>${char.name}</h4><dl>`;
          if (char.role) content += `<dt>角色</dt><dd>${char.role}</dd>`;
          if (char.description)
            content += `<dt>描述</dt><dd>${char.description}</dd>`;
          if (char.personality) {
            // 处理 personality - 可能是字符串或对象
            let personalityStr: string;
            if (typeof char.personality === 'object') {
              if (Array.isArray(char.personality)) {
                personalityStr = (char.personality as string[]).join('、');
              } else {
                personalityStr = JSON.stringify(char.personality, null, 2);
              }
            } else {
              personalityStr = String(char.personality);
            }
            content += `<dt>性格</dt><dd>${personalityStr}</dd>`;
          }
          if (char.background)
            content += `<dt>背景</dt><dd>${char.background}</dd>`;
          content += '</dl></div>';
        });
        content += '</div></div>';
        sections.push(content);
      } else {
        const title = format === 'md' ? '## 角色设定\n' : '【角色设定】\n';
        let content = title;
        storyBible.characters.forEach((char) => {
          content +=
            format === 'md' ? `### ${char.name}\n` : `\n${char.name}：\n`;
          if (char.role) content += `角色：${char.role}\n`;
          if (char.description) content += `描述：${char.description}\n`;
          // 处理 personality - 可能是字符串或对象
          if (char.personality) {
            let personalityStr: string;
            if (typeof char.personality === 'object') {
              if (Array.isArray(char.personality)) {
                personalityStr = (char.personality as string[]).join('、');
              } else {
                personalityStr = JSON.stringify(char.personality, null, 2);
              }
            } else {
              personalityStr = String(char.personality);
            }
            content += `性格：${personalityStr}\n`;
          }
          if (char.background) content += `背景：${char.background}\n`;
        });
        sections.push(content);
      }
    }

    // 世界设定
    if (storyBible.worldSettings && storyBible.worldSettings.length > 0) {
      // 过滤出有效的设定（必须有 name 和 description，且 name 不是内部字段）
      const validSettings = storyBible.worldSettings.filter(
        (s) =>
          s &&
          typeof s.name === 'string' &&
          s.name &&
          !s.name.startsWith('_') &&
          typeof s.description === 'string' &&
          s.description
      );

      if (validSettings.length > 0) {
        // 按分类分组
        const grouped: Record<string, typeof validSettings> = {};
        validSettings.forEach((setting) => {
          const category = setting.category || '其他';
          if (!grouped[category]) grouped[category] = [];
          grouped[category].push(setting);
        });

        if (format === 'html') {
          let content = '<div class="worldview-section"><h3>世界观设定</h3>';
          Object.entries(grouped).forEach(([category, settings]) => {
            content += `<div class="setting-category"><h4>${category}</h4><ul>`;
            settings.forEach((s) => {
              content += `<li><strong>${s.name}</strong>：${s.description}</li>`;
            });
            content += '</ul></div>';
          });
          content += '</div>';
          sections.push(content);
        } else {
          const title =
            format === 'md' ? '## 世界观设定\n' : '【世界观设定】\n';
          let content = title;
          Object.entries(grouped).forEach(([category, settings]) => {
            content +=
              format === 'md' ? `### ${category}\n` : `\n【${category}】\n`;
            settings.forEach((s) => {
              content += `- ${s.name}：${s.description}\n`;
            });
          });
          sections.push(content);
        }
      }
    }

    return sections.join(format === 'html' ? '' : '\n');
  };

  // 导出为 Markdown
  const handleExportMarkdown = () => {
    if (!currentProject) return;

    // 世界观内容放在章节前面
    const worldviewContent = generateWorldviewContent('md');

    const allChapterContent = volumes
      .flatMap((v) => v.chapters || [])
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map((c) => `## ${c.title}\n\n${c.content || ''}`)
      .join('\n\n---\n\n');

    const parts = [`# ${currentProject.name}\n`];
    if (currentProject.description) parts.push(currentProject.description);
    parts.push(
      `\n**目标字数**: ${currentProject.targetWords?.toLocaleString() || '-'}`
    );
    parts.push(
      `**当前字数**: ${currentProject.currentWords?.toLocaleString() || 0}`
    );
    parts.push('\n---\n');
    if (worldviewContent) parts.push(worldviewContent, '\n---\n');
    parts.push('# 正文\n\n', allChapterContent);

    const content = parts.join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.name}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  // 导出为纯文本
  const handleExportTxt = () => {
    if (!currentProject) return;

    // 世界观内容放在章节前面
    const worldviewContent = generateWorldviewContent('txt');

    const allChapterContent = volumes
      .flatMap((v) => v.chapters || [])
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map((c) => `【${c.title}】\n\n${c.content || ''}`)
      .join('\n\n════════════════════════════════════════\n\n');

    const parts = [`《${currentProject.name}》\n`];
    if (currentProject.description) parts.push(currentProject.description);
    parts.push(
      `\n目标字数: ${currentProject.targetWords?.toLocaleString() || '-'}`
    );
    parts.push(
      `当前字数: ${currentProject.currentWords?.toLocaleString() || 0}`
    );
    parts.push('\n════════════════════════════════════════\n');
    if (worldviewContent)
      parts.push(
        worldviewContent,
        '\n════════════════════════════════════════\n'
      );
    parts.push(allChapterContent);

    const content = parts.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  // 导出为 HTML
  const handleExportHtml = () => {
    if (!currentProject) return;

    // 清理章节标题：移除 markdown 前缀和章节号前缀
    const cleanChapterTitle = (
      title: string,
      chapterNumber: number
    ): string => {
      if (!title) return `第${chapterNumber}章`;
      // 移除 markdown 标题前缀 (###, ##, #)
      let cleaned = title.replace(/^#{1,6}\s*/, '');
      // 移除章节号前缀 (第X章：, 第X章, Chapter X:)
      cleaned = cleaned.replace(
        /^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i,
        ''
      );
      cleaned = cleaned.replace(/^Chapter\s*\d+[：:\s]*/i, '');
      return cleaned.trim() || `第${chapterNumber}章`;
    };

    // 清理章节内容：移除占位符文本和章节标题行
    const cleanChapterContent = (content: string): string => {
      if (!content) return '';
      return (
        content
          // 移除占位符文本
          .replace(/【修复后的内容】/g, '')
          .replace(/【正文开始】/g, '')
          .replace(/【正文结束】/g, '')
          .replace(/【待创作】/g, '')
          .replace(/【内容待补充】/g, '')
          // 移除 markdown 章节标题行 (### 第X章 标题)
          .replace(
            /^#{1,6}\s*第[一二三四五六七八九十百千零〇\d]+[章回节][：:\s]*[^\n]*\n*/gm,
            ''
          )
          // 移除纯文本章节标题行 (第X章 标题)
          .replace(
            /^第[一二三四五六七八九十百千零〇\d]+[章回节][：:\s]*[^\n]*\n*/gm,
            ''
          )
          // 移除可能带有空格前缀的 markdown 标题
          .replace(
            /^\s+#{1,6}\s*第[一二三四五六七八九十百千零〇\d]+[章回节][^\n]*\n*/gm,
            ''
          )
          .trim()
      );
    };

    // 世界观内容放在章节前面（使用 HTML 格式）
    const worldviewHtml = generateWorldviewContent('html');

    const allChapterContent = volumes
      .flatMap((v) => v.chapters || [])
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map(
        (c) =>
          `<section class="chapter"><h2>第${c.chapterNumber}章 ${cleanChapterTitle(c.title, c.chapterNumber)}</h2><div class="content">${cleanChapterContent(c.content || '').replace(/\n/g, '<br/>')}</div></section>`
      )
      .join('\n');

    const worldviewSection = worldviewHtml
      ? `<section class="worldview"><h2>世界观设定</h2>${worldviewHtml}</section><hr/>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${currentProject.name}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.8;
      color: #1f2937;
      background: #fafafa;
    }
    .header { text-align: center; margin-bottom: 3rem; padding-bottom: 2rem; border-bottom: 2px solid #e5e7eb; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #111827; }
    .meta { color: #6b7280; font-size: 0.9rem; }
    .worldview { background: #f9fafb; padding: 1.5rem; border-radius: 12px; margin-bottom: 2rem; }
    .worldview > h2 { font-size: 1.2rem; color: #374151; margin-bottom: 1rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem; }
    .worldview-section { margin-bottom: 1.5rem; }
    .worldview-section h3 { font-size: 1rem; color: #4b5563; margin-bottom: 0.75rem; }
    .worldview-section h4 { font-size: 0.95rem; color: #6b7280; margin: 0.5rem 0; }
    .worldview-section dl { margin: 0; padding-left: 1rem; }
    .worldview-section dt { font-weight: 600; color: #374151; margin-top: 0.5rem; }
    .worldview-section dd { margin-left: 0; color: #4b5563; }
    .worldview-section ul { list-style: disc; margin: 0.5rem 0; padding-left: 1.5rem; }
    .worldview-section .desc { color: #9ca3af; font-size: 0.9rem; }
    .character { background: #fff; padding: 0.75rem; border-radius: 8px; margin-bottom: 0.5rem; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
    .chapter { margin-bottom: 3rem; }
    .chapter h2 { font-size: 1.5rem; color: #1f2937; border-left: 4px solid #f59e0b; padding-left: 1rem; margin-bottom: 1.5rem; }
    .chapter .content { text-indent: 2em; text-align: justify; }
    .toc { background: #fff; padding: 1.5rem; border-radius: 12px; margin-bottom: 2rem; border: 1px solid #e5e7eb; }
    .toc h3 { margin-bottom: 1rem; color: #374151; }
    .toc ul { list-style: none; padding: 0; margin: 0; }
    .toc li { padding: 0.5rem 0; border-bottom: 1px dashed #e5e7eb; }
    .toc li:last-child { border-bottom: none; }
    .toc a { color: #2563eb; text-decoration: none; }
    .toc a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header class="header">
    <h1>${currentProject.name}</h1>
    <p class="meta">${currentProject.description || ''}</p>
    <p class="meta">字数：${currentProject.currentWords?.toLocaleString() || 0} / ${currentProject.targetWords?.toLocaleString() || '-'}</p>
  </header>
  ${worldviewSection}
  <nav class="toc">
    <h3>目录</h3>
    <ul>
      ${volumes
        .flatMap((v) => v.chapters || [])
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(
          (c, i) =>
            `<li><a href="#chapter-${i + 1}">第${c.chapterNumber}章 ${cleanChapterTitle(c.title, c.chapterNumber)}</a></li>`
        )
        .join('\n')}
    </ul>
  </nav>
  <main>
    ${allChapterContent.replace(/<section class="chapter">/g, (_, i) => `<section class="chapter" id="chapter-${i + 1}">`)}
  </main>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject.name}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  // 打开打印预览（用于导出 PDF）
  const handleExportPdf = () => {
    if (!currentProject) return;
    // 在新窗口打开打印友好版本
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setToast({ message: '请允许弹出窗口以导出 PDF', type: 'error' });
      return;
    }

    // 世界观内容放在章节前面（使用 HTML 格式）
    const worldviewHtml = generateWorldviewContent('html');

    const allChapterContent = volumes
      .flatMap((v) => v.chapters || [])
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map(
        (c) =>
          `<h2 style="page-break-before: always; margin-top: 2rem;">${c.title}</h2><div style="white-space: pre-wrap; line-height: 1.8;">${c.content || ''}</div>`
      )
      .join('');

    const worldviewSection = worldviewHtml
      ? `<div class="worldview"><h2>世界观设定</h2>${worldviewHtml}</div><hr style="margin: 2rem 0;" />`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${currentProject.name}</title>
  <style>
    @media print {
      body { margin: 2cm; }
      h1 { page-break-after: avoid; }
      h2 { page-break-after: avoid; }
      .worldview { page-break-inside: avoid; }
    }
    body {
      font-family: "Noto Serif SC", "Source Han Serif CN", "Songti SC", serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.8;
    }
    h1 { text-align: center; margin-bottom: 1rem; }
    .meta { text-align: center; color: #666; margin-bottom: 2rem; }
    h2 { margin-top: 2rem; border-bottom: 1px solid #eee; padding-bottom: 0.5rem; }
    .worldview { margin-bottom: 2rem; padding: 1.5rem; background: #f9fafb; border-radius: 8px; }
    .worldview > h2 { margin-top: 0; font-size: 1.2rem; color: #374151; border-bottom: 1px solid #e5e7eb; }
    .worldview-section { margin-bottom: 1.5rem; }
    .worldview-section h3 { font-size: 1rem; color: #4b5563; margin-bottom: 0.5rem; border: none; }
    .worldview-section h4 { font-size: 0.95rem; color: #6b7280; margin: 0.5rem 0; font-weight: 500; }
    .worldview-section dl { margin: 0; padding-left: 1rem; }
    .worldview-section dt { font-weight: 600; color: #374151; margin-top: 0.5rem; display: inline; }
    .worldview-section dt::after { content: "："; }
    .worldview-section dd { display: inline; margin-left: 0; color: #4b5563; }
    .worldview-section dd::after { content: ""; display: block; }
    .worldview-section ul { list-style: disc; margin: 0.5rem 0; padding-left: 1.5rem; }
    .worldview-section .desc { color: #9ca3af; font-size: 0.9rem; }
    .character { background: #fff; padding: 0.75rem; border-radius: 6px; margin-bottom: 0.5rem; border: 1px solid #e5e7eb; }
    .print-btn {
      position: fixed;
      top: 1rem;
      right: 1rem;
      padding: 0.75rem 1.5rem;
      background: #f59e0b;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
    }
    .print-btn:hover { background: #d97706; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">打印 / 导出 PDF</button>
  <h1>${currentProject.name}</h1>
  <div class="meta">
    ${currentProject.description ? `<p>${currentProject.description}</p>` : ''}
    <p>字数：${currentProject.currentWords?.toLocaleString() || 0} / ${currentProject.targetWords?.toLocaleString() || '-'}</p>
  </div>
  <hr />
  ${worldviewSection}
  ${allChapterContent}
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    setShowExportMenu(false);
  };

  // 复制分享链接（公开阅读）
  const handleShareLink = async () => {
    if (!currentProject) return;
    // 生成公开分享链接
    const shareUrl = `${window.location.origin}/share/writing/${projectId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast({ message: '分享链接已复制到剪贴板', type: 'success' });
    } catch {
      // 降级方案
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setToast({ message: '分享链接已复制到剪贴板', type: 'success' });
    }
    setShowExportMenu(false);
  };

  // Get all chapters sorted
  const allChapters = volumes
    .flatMap((v) => v.chapters || [])
    .sort((a, b) => a.chapterNumber - b.chapterNumber);

  const getProgress = () => {
    if (!currentProject || !currentProject.targetWords) return 0;
    return Math.min(
      100,
      Math.round(
        (currentProject.currentWords / currentProject.targetWords) * 100
      )
    );
  };

  // Show loading when auth is loading, projects are loading, or when project ID doesn't match
  // This prevents "串台" (data mixing) when switching between projects
  if (
    authLoading ||
    isLoadingProjects ||
    (currentProject && currentProject.id !== projectId)
  ) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center">
          <LoadingState size="lg" />
        </main>
      </AppShell>
    );
  }

  if (!user) {
    router.push('/ai-writing');
    return null;
  }

  if (!currentProject) {
    return (
      <AppShell>
        <main className="flex flex-1 flex-col items-center justify-center p-8">
          <EmptyState
            icon={<BookOpen className="h-12 w-12" />}
            title="项目不存在"
            action={
              <button
                onClick={() => router.push('/ai-writing')}
                className="text-amber-600 hover:underline"
              >
                返回项目列表
              </button>
            }
          />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex h-full flex-1 flex-col overflow-hidden bg-gray-50">
        {/* Compact Header */}
        <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/ai-writing')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  {currentProject.name}
                </h1>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>
                    {currentProject.currentWords.toLocaleString()} /{' '}
                    {currentProject.targetWords.toLocaleString()} 字
                  </span>
                  <span className="font-medium text-amber-600">
                    ({getProgress()}%)
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Import Button */}
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                导入
              </button>
              {/* Export Dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
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
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  导出
                  <svg
                    className="h-3 w-3"
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
                </button>
                {showExportMenu && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    <button
                      onClick={() => {
                        setShowExportDialog(true);
                        setShowExportMenu(false);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-violet-600 hover:bg-violet-50"
                    >
                      <Download className="h-4 w-4" />
                      {t('common.export')}
                    </button>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={handleExportMarkdown}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <FileText className="h-4 w-4" />
                      Markdown (.md)
                    </button>
                    <button
                      onClick={handleExportTxt}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <FileCode className="h-4 w-4" />
                      纯文本 (.txt)
                    </button>
                    <button
                      onClick={handleExportHtml}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Globe className="h-4 w-4" />
                      网页 (.html)
                    </button>
                    <button
                      onClick={handleExportPdf}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Printer className="h-4 w-4" />
                      打印 / PDF
                    </button>
                    <div className="border-t border-gray-100" />
                    <button
                      onClick={handleShareLink}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Link2 className="h-4 w-4" />
                      复制分享链接
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
            <span>
              {typeof error === 'string'
                ? error
                : (error as { message?: string })?.message ||
                  JSON.stringify(error)}
            </span>
            <button
              onClick={clearError}
              className="text-red-500 hover:text-red-700"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Toast Notification */}
        {toast && (
          <div
            className={`fixed right-4 top-20 z-50 flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg transition-all ${
              toast.type === 'success'
                ? 'bg-green-50 text-green-800'
                : 'bg-red-50 text-red-800'
            }`}
          >
            <span className="text-lg">
              {toast.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
            </span>
            <span className="text-sm font-medium">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-2 text-gray-400 hover:text-gray-600"
            >
              <XCircle className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Main Content */}
        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          {/* Left: AI Team Panel */}
          {/* [W4] New props: missionView/stageViews/agentViews from useWritingDerivedView.
              missionProgress falls back to stageViews ratio (or store) — see derived value above.
              isStuckMission still from store (no new-system equivalent). */}
          <WritingTeamPanel
            missionView={missionView}
            stageViews={stageViews}
            agentViews={agentViews}
            missionProgress={missionProgress}
            isStuckMission={isStuckMission}
            chaptersCount={allChapters?.length || 0}
            onContinueWriting={handleContinueWriting}
            onCancelMission={handleCancelMission}
          />

          {/* Right: Content Area */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Tabbed Content */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              {/* Tab Header */}
              <Tabs
                className="px-4"
                variant="pill"
                size="sm"
                value={activeTab}
                onChange={(key) =>
                  setActiveTab(
                    key as
                      | 'chapters'
                      | 'worldview'
                      | 'storyBible'
                      | 'relationships'
                      | 'taskDetails'
                      | 'summaries'
                      | 'analysis'
                  )
                }
                items={[
                  {
                    key: 'chapters',
                    label: (
                      <>
                        <BookOpen className="mr-1 h-3.5 w-3.5" />
                        章节列表
                        <span className="ml-1 text-xs">
                          ({allChapters.length})
                        </span>
                      </>
                    ),
                  },
                  {
                    key: 'worldview',
                    label: (
                      <>
                        <Globe className="mr-1 h-3.5 w-3.5" />
                        世界观
                        {storyBible?.premise && (
                          <CheckCircle2 className="ml-1 h-3 w-3 text-green-500" />
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'storyBible',
                    label: (
                      <>
                        <Library className="mr-1 h-3.5 w-3.5" />
                        故事圣经
                        {storyBible?.characters &&
                          storyBible.characters.length > 0 && (
                            <span className="ml-1 text-xs text-emerald-500">
                              ({storyBible.characters.length})
                            </span>
                          )}
                      </>
                    ),
                  },
                  {
                    key: 'relationships',
                    label: (
                      <>
                        <Link2 className="mr-1 h-3.5 w-3.5" />
                        角色关系
                      </>
                    ),
                  },
                  {
                    key: 'taskDetails',
                    label: (
                      <>
                        <MessagesSquare className="mr-1 h-3.5 w-3.5" />
                        Team交互区
                        {taskMessages.length > 0 && (
                          <span className="ml-1 text-xs">
                            ({taskMessages.length})
                          </span>
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'summaries',
                    label: (
                      <>
                        <FileText className="h-4 w-4" />
                        层次摘要
                      </>
                    ),
                  },
                  {
                    key: 'analysis',
                    label: (
                      <>
                        <BarChart3 className="h-4 w-4" />
                        分析
                      </>
                    ),
                  },
                ]}
              />

              <div className="flex-1 overflow-auto p-4">
                {/* Chapters Tab */}
                {activeTab === 'chapters' && (
                  <>
                    {isLoadingVolumes ? (
                      <div className="flex h-full items-center justify-center">
                        <LoadingState size="lg" />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Mission Running Status Banner */}
                        {isMissionRunning && (
                          <div className="mb-4 rounded-xl bg-amber-50 p-3">
                            <LoadingInline
                              text={missionMessage || 'AI 团队正在创作中...'}
                              className="text-sm font-medium text-amber-700"
                            />
                          </div>
                        )}

                        {/* Chapter List */}
                        {allChapters.length > 0 ? (
                          <>
                            {allChapters.map((chapter) => (
                              <button
                                key={chapter.id}
                                onClick={() => setSelectedChapter(chapter)}
                                className="block w-full rounded-xl border border-gray-100 bg-white p-4 text-left transition-all hover:border-amber-200 hover:bg-amber-50"
                              >
                                <div className="flex items-start gap-3">
                                  <span
                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                                      chapter.content
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                  >
                                    {chapter.content ? (
                                      <Check className="h-4 w-4" />
                                    ) : (
                                      chapter.chapterNumber
                                    )}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-gray-800">
                                      第{chapter.chapterNumber}章{' '}
                                      {(chapter.title || '')
                                        .replace(
                                          /^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i,
                                          ''
                                        )
                                        .replace(/^待创作$/, '')}
                                    </div>
                                    {chapter.outline &&
                                      chapter.outline !== '待创作' && (
                                        <div className="mt-1 line-clamp-2 text-xs text-gray-400">
                                          {chapter.outline.replace(
                                            /^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i,
                                            ''
                                          )}
                                        </div>
                                      )}
                                    {/* Show content preview if available */}
                                    {chapter.content && (
                                      <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-gray-500">
                                        {chapter.content.slice(0, 200)}...
                                      </div>
                                    )}
                                  </div>
                                  {chapter.wordCount > 0 && (
                                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                                      {chapter.wordCount.toLocaleString()} 字
                                    </span>
                                  )}
                                </div>
                              </button>
                            ))}

                            {/* Continue Writing Button */}
                            {!isMissionRunning && (
                              <button
                                onClick={handleContinueWriting}
                                className="w-full rounded-xl border-2 border-dashed border-gray-200 py-4 text-gray-500 transition-all hover:border-amber-300 hover:text-amber-600"
                              >
                                + 继续写作下一章
                              </button>
                            )}
                          </>
                        ) : (
                          /* Empty State */
                          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                            {isMissionRunning ? (
                              <>
                                <div className="mx-auto mb-4 flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-amber-100">
                                  <Pencil className="h-6 w-6 text-amber-600" />
                                </div>
                                <p className="text-sm text-gray-500">
                                  AI 团队正在创作，章节内容将实时显示在这里...
                                </p>
                              </>
                            ) : missionCompleted ? (
                              <>
                                <CheckCircle2 className="mb-4 h-10 w-10 text-green-500" />
                                <h3 className="mb-2 text-lg font-semibold text-gray-800">
                                  创作任务已完成
                                </h3>
                                <button
                                  onClick={() => fetchVolumes(projectId)}
                                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600"
                                >
                                  <RefreshCw className="h-4 w-4" /> 刷新内容
                                </button>
                              </>
                            ) : (
                              <>
                                <FileText className="mb-4 h-10 w-10 text-gray-300" />
                                <h3 className="mb-2 text-lg font-semibold text-gray-800">
                                  开始你的创作
                                </h3>
                                <p className="mb-4 max-w-xs text-sm text-gray-500">
                                  {currentProject.description ||
                                    '点击左侧「开始创作」按钮，AI 团队将自动完成故事创作'}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Worldview Tab */}
                {activeTab === 'worldview' && (
                  <div className="space-y-4">
                    {/* Mission Running Banner */}
                    {isMissionRunning && (
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <LoadingInline
                          text="AI 守护者正在构建世界观设定..."
                          className="text-sm font-medium text-indigo-700"
                        />
                      </div>
                    )}

                    {/* Show content if storyBible exists with any content */}
                    {storyBible &&
                    (storyBible.premise ||
                      storyBible.theme ||
                      storyBible.worldType ||
                      storyBible.tone ||
                      (storyBible.worldSettings &&
                        storyBible.worldSettings.length > 0)) ? (
                      <>
                        {/* Premise */}
                        {storyBible.premise && (
                          <div className="rounded-xl bg-indigo-50 p-4">
                            <h3 className="mb-2 flex items-center gap-2 font-medium text-indigo-800">
                              <Lightbulb className="h-4 w-4" /> 核心概念
                            </h3>
                            <p className="whitespace-pre-wrap text-sm text-indigo-700">
                              {storyBible.premise}
                            </p>
                          </div>
                        )}

                        {/* Theme */}
                        {storyBible.theme && (
                          <div className="rounded-xl bg-purple-50 p-4">
                            <h3 className="mb-2 flex items-center gap-2 font-medium text-purple-800">
                              <FileText className="h-4 w-4" /> 主题
                            </h3>
                            <p className="whitespace-pre-wrap text-sm text-purple-700">
                              {storyBible.theme}
                            </p>
                          </div>
                        )}

                        {/* World Type */}
                        {storyBible.worldType && (
                          <div className="rounded-xl bg-blue-50 p-4">
                            <h3 className="mb-2 flex items-center gap-2 font-medium text-blue-800">
                              <Globe className="h-4 w-4" /> 世界类型
                            </h3>
                            <p className="whitespace-pre-wrap text-sm text-blue-700">
                              {storyBible.worldType}
                            </p>
                          </div>
                        )}

                        {/* Tone */}
                        {storyBible.tone && (
                          <div className="rounded-xl bg-amber-50 p-4">
                            <h3 className="mb-2 flex items-center gap-2 font-medium text-amber-800">
                              <Paintbrush className="h-4 w-4" /> 基调风格
                            </h3>
                            <p className="whitespace-pre-wrap text-sm text-amber-700">
                              {storyBible.tone}
                            </p>
                          </div>
                        )}

                        {/* World Settings - 结构化显示 */}
                        {storyBible.worldSettings &&
                          storyBible.worldSettings.filter(
                            (s) => s.name && s.description
                          ).length > 0 && (
                            <div className="rounded-xl bg-green-50 p-4">
                              <h3 className="mb-3 flex items-center gap-2 font-medium text-green-800">
                                <Map className="h-4 w-4" /> 世界设定
                              </h3>
                              <div className="space-y-3">
                                {storyBible.worldSettings
                                  .filter((s) => s.name && s.description)
                                  .map((setting) => {
                                    // ★ 智能解析：按"标签:"或"第X章:"分段
                                    const content = setting.description || '';
                                    // 匹配：时代:、地理:、第1章:、[设定]、[事件]、[关系] 等
                                    const segments = content
                                      .split(
                                        /(?=(?:时代|地理|社会|类型|第\d+章|【|\[(?:设定|事件|关系)\]))/g
                                      )
                                      .filter((s) => s.trim());

                                    return (
                                      <div
                                        key={setting.id}
                                        className="rounded-lg border border-green-200 bg-white/70 p-3"
                                      >
                                        <div className="mb-2 flex items-center gap-2">
                                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                            {setting.category || setting.name}
                                          </span>
                                        </div>
                                        <div className="space-y-2 text-sm leading-relaxed text-green-800">
                                          {segments.length > 1 ? (
                                            // 多段内容，每段独立显示
                                            segments.map((segment, idx) => {
                                              // 提取标签和内容
                                              const labelMatch = segment.match(
                                                /^(时代|地理|社会|类型|第\d+章)[：:]\s*/
                                              );
                                              const tagMatch =
                                                segment.match(
                                                  /^\[?(设定|事件|关系)\]?\s*/
                                                );
                                              if (labelMatch) {
                                                const label = labelMatch[1];
                                                const text = segment
                                                  .slice(labelMatch[0].length)
                                                  .trim();
                                                return (
                                                  <div
                                                    key={idx}
                                                    className="rounded bg-green-50/50 p-2"
                                                  >
                                                    <span className="mr-2 inline-block rounded bg-green-200 px-1.5 py-0.5 text-xs font-medium text-green-800">
                                                      {label}
                                                    </span>
                                                    <span className="text-gray-700">
                                                      {text}
                                                    </span>
                                                  </div>
                                                );
                                              } else if (tagMatch) {
                                                const tag = tagMatch[1];
                                                const text = segment
                                                  .slice(tagMatch[0].length)
                                                  .trim();
                                                const tagColors: Record<
                                                  string,
                                                  string
                                                > = {
                                                  设定: 'bg-blue-100 text-blue-700',
                                                  事件: 'bg-orange-100 text-orange-700',
                                                  关系: 'bg-purple-100 text-purple-700',
                                                };
                                                return (
                                                  <div
                                                    key={idx}
                                                    className="rounded bg-gray-50 p-2"
                                                  >
                                                    <span
                                                      className={`mr-2 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${tagColors[tag] || 'bg-gray-200 text-gray-700'}`}
                                                    >
                                                      {tag}
                                                    </span>
                                                    <span className="text-gray-700">
                                                      {text}
                                                    </span>
                                                  </div>
                                                );
                                              }
                                              return (
                                                <p
                                                  key={idx}
                                                  className="text-gray-700"
                                                >
                                                  {segment.trim()}
                                                </p>
                                              );
                                            })
                                          ) : (
                                            // 单段内容，保持原样
                                            <p className="whitespace-pre-wrap text-gray-700">
                                              {content}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          )}

                        {/* Timeline Events - 时间线事件 */}
                        {storyBible.timelineEvents &&
                          storyBible.timelineEvents.length > 0 && (
                            <div className="rounded-xl bg-orange-50 p-4">
                              <h3 className="mb-2 flex items-center gap-2 font-medium text-orange-800">
                                <Calendar className="h-4 w-4" /> 时间线事件
                                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs">
                                  {storyBible.timelineEvents.length} 个事件
                                </span>
                              </h3>
                              <div className="space-y-2">
                                {storyBible.timelineEvents
                                  .sort((a, b) => b.importance - a.importance)
                                  .map((event) => (
                                    <div
                                      key={event.id}
                                      className="rounded-lg bg-white/50 p-2 text-sm"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-orange-700">
                                          {event.storyTime}
                                        </span>
                                        {event.importance >= 4 && (
                                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-600">
                                            重要
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1 text-gray-700">
                                        <span className="font-medium">
                                          {event.eventName}
                                        </span>
                                        {event.description && (
                                          <span className="text-gray-500">
                                            {' '}
                                            - {event.description}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}

                        {/* Factions - 势力/组织 */}
                        {storyBible.factions &&
                          storyBible.factions.length > 0 && (
                            <div className="rounded-xl bg-rose-50 p-4">
                              <h3 className="mb-2 flex items-center gap-2 font-medium text-rose-800">
                                <Building2 className="h-4 w-4" /> 势力与组织
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs">
                                  {storyBible.factions.length} 个势力
                                </span>
                              </h3>
                              <div className="space-y-2">
                                {storyBible.factions.map((faction) => (
                                  <div
                                    key={faction.id}
                                    className="rounded-lg bg-white/50 p-2 text-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-rose-700">
                                        {faction.name}
                                      </span>
                                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-600">
                                        {faction.type}
                                      </span>
                                    </div>
                                    {faction.description && (
                                      <p className="mt-1 text-gray-600">
                                        {faction.description}
                                      </p>
                                    )}
                                    {faction.territory && (
                                      <p className="mt-1 text-xs text-gray-500">
                                        势力范围: {faction.territory}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        {/* Terminologies - 术语/专有名词 */}
                        {storyBible.terminologies &&
                          storyBible.terminologies.length > 0 && (
                            <div className="rounded-xl bg-cyan-50 p-4">
                              <h3 className="mb-2 flex items-center gap-2 font-medium text-cyan-800">
                                <BookOpen className="h-4 w-4" /> 术语与专有名词
                                <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs">
                                  {storyBible.terminologies.length} 个术语
                                </span>
                              </h3>
                              <div className="space-y-2">
                                {storyBible.terminologies.map((term) => (
                                  <div
                                    key={term.id}
                                    className="rounded-lg bg-white/50 p-2 text-sm"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-cyan-700">
                                        {term.term}
                                      </span>
                                      <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-xs text-cyan-600">
                                        {term.category}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-gray-600">
                                      {term.definition}
                                    </p>
                                    {term.variants &&
                                      term.variants.length > 0 && (
                                        <p className="mt-1 text-xs text-gray-500">
                                          别名: {term.variants.join('、')}
                                        </p>
                                      )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                      </>
                    ) : isMissionRunning ? (
                      /* Show building state during mission */
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100">
                          <Globe className="h-8 w-8 text-indigo-500" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold text-gray-800">
                          世界观构建中
                        </h3>
                        <p className="text-sm text-gray-500">
                          AI 守护者正在分析并建立故事的世界观设定...
                        </p>
                        <div className="mt-4 h-2 w-48 overflow-hidden rounded-full bg-gray-200">
                          <div className="h-full w-1/3 animate-pulse bg-indigo-500" />
                        </div>
                      </div>
                    ) : (
                      /* Empty state - no mission running, no content */
                      <EmptyState
                        icon={<Globe className="h-12 w-12" />}
                        title="暂无世界观设定"
                        description="开始创作后，AI 守护者将自动建立故事的世界观"
                      />
                    )}
                  </div>
                )}

                {/* Story Bible Tab - 完整故事圣经展示 */}
                {activeTab === 'storyBible' && (
                  <div className="space-y-4">
                    {/* Mission Running Banner */}
                    {isMissionRunning && (
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <LoadingInline
                          text="AI 团队正在更新故事圣经..."
                          className="text-sm font-medium text-emerald-700"
                        />
                      </div>
                    )}

                    {storyBible ? (
                      <>
                        {/* 角色设定 - 核心内容 */}
                        <div className="rounded-xl border border-emerald-200 bg-white p-4">
                          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-emerald-800">
                            <Users className="h-4 w-4" /> 角色设定
                            {storyBible.characters && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs">
                                {storyBible.characters.length} 位角色
                              </span>
                            )}
                          </h3>
                          {storyBible.characters &&
                          storyBible.characters.length > 0 ? (
                            <div className="space-y-3">
                              {storyBible.characters.map((char) => (
                                <div
                                  key={char.id}
                                  className="rounded-lg bg-gradient-to-r from-emerald-50 to-teal-50 p-3"
                                >
                                  <div className="flex items-start gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-lg text-white">
                                      {char.name.charAt(0)}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-gray-800">
                                          {char.name}
                                        </span>
                                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                                          {char.role}
                                        </span>
                                      </div>
                                      {char.description && (
                                        <p className="mt-1 text-sm text-gray-600">
                                          {char.description}
                                        </p>
                                      )}
                                      {/* 性格特征 */}
                                      {char.personality && (
                                        <div className="mt-2 space-y-1">
                                          {typeof char.personality ===
                                          'string' ? (
                                            <div>
                                              <span className="text-xs font-medium text-emerald-600">
                                                性格：
                                              </span>
                                              <span className="text-xs text-gray-600">
                                                {char.personality}
                                              </span>
                                            </div>
                                          ) : (
                                            (() => {
                                              const p = char.personality as {
                                                arc?: string;
                                                traits?: string[];
                                                motivation?: string;
                                                relationships?:
                                                  | string[]
                                                  | Record<string, string>;
                                                firstAppearance?: number;
                                              };
                                              return (
                                                <>
                                                  {/* 性格特征数组 */}
                                                  {p.traits &&
                                                    p.traits.length > 0 && (
                                                      <div className="flex flex-wrap gap-1">
                                                        <span className="text-xs font-medium text-emerald-600">
                                                          性格：
                                                        </span>
                                                        {p.traits.map(
                                                          (
                                                            trait: string,
                                                            i: number
                                                          ) => (
                                                            <span
                                                              key={i}
                                                              className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                                                            >
                                                              {trait}
                                                            </span>
                                                          )
                                                        )}
                                                      </div>
                                                    )}
                                                  {/* 角色弧线 */}
                                                  {p.arc && (
                                                    <div>
                                                      <span className="text-xs font-medium text-purple-600">
                                                        成长弧线：
                                                      </span>
                                                      <span className="text-xs text-gray-600">
                                                        {p.arc}
                                                      </span>
                                                    </div>
                                                  )}
                                                  {/* 动机 */}
                                                  {p.motivation && (
                                                    <div>
                                                      <span className="text-xs font-medium text-blue-600">
                                                        动机：
                                                      </span>
                                                      <span className="text-xs text-gray-600">
                                                        {p.motivation}
                                                      </span>
                                                    </div>
                                                  )}
                                                  {/* 关系 */}
                                                  {p.relationships && (
                                                    <div>
                                                      <span className="text-xs font-medium text-pink-600">
                                                        关系：
                                                      </span>
                                                      <span className="text-xs text-gray-600">
                                                        {Array.isArray(
                                                          p.relationships
                                                        )
                                                          ? p.relationships
                                                              .map(
                                                                (r: unknown) =>
                                                                  typeof r ===
                                                                  'string'
                                                                    ? r
                                                                    : typeof r ===
                                                                          'object' &&
                                                                        r !==
                                                                          null
                                                                      ? (
                                                                          r as Record<
                                                                            string,
                                                                            unknown
                                                                          >
                                                                        )
                                                                          .name ||
                                                                        (
                                                                          r as Record<
                                                                            string,
                                                                            unknown
                                                                          >
                                                                        )
                                                                          .type ||
                                                                        (
                                                                          r as Record<
                                                                            string,
                                                                            unknown
                                                                          >
                                                                        )
                                                                          .relation ||
                                                                        JSON.stringify(
                                                                          r
                                                                        )
                                                                      : String(
                                                                          r
                                                                        )
                                                              )
                                                              .join('、')
                                                          : typeof p.relationships ===
                                                              'object'
                                                            ? Object.entries(
                                                                p.relationships as Record<
                                                                  string,
                                                                  unknown
                                                                >
                                                              )
                                                                .map(
                                                                  ([
                                                                    name,
                                                                    rel,
                                                                  ]) => {
                                                                    const relObj =
                                                                      typeof rel ===
                                                                        'object' &&
                                                                      rel !==
                                                                        null
                                                                        ? (rel as Record<
                                                                            string,
                                                                            unknown
                                                                          >)
                                                                        : null;
                                                                    const relStr =
                                                                      typeof rel ===
                                                                      'string'
                                                                        ? rel
                                                                        : relObj
                                                                          ? String(
                                                                              relObj.type ||
                                                                                relObj.relation ||
                                                                                relObj.description ||
                                                                                ''
                                                                            )
                                                                          : String(
                                                                              rel
                                                                            );
                                                                    return relStr
                                                                      ? `${name}(${relStr})`
                                                                      : name;
                                                                  }
                                                                )
                                                                .join('、')
                                                            : String(
                                                                p.relationships
                                                              )}
                                                      </span>
                                                    </div>
                                                  )}
                                                  {/* 首次出现 */}
                                                  {p.firstAppearance && (
                                                    <div>
                                                      <span className="text-xs font-medium text-gray-500">
                                                        首次出现：
                                                      </span>
                                                      <span className="text-xs text-gray-600">
                                                        第{p.firstAppearance}章
                                                      </span>
                                                    </div>
                                                  )}
                                                </>
                                              );
                                            })()
                                          )}
                                        </div>
                                      )}
                                      {/* 背景故事 */}
                                      {char.background && (
                                        <div className="mt-1">
                                          <span className="text-xs font-medium text-amber-600">
                                            背景：
                                          </span>
                                          <span className="text-xs text-gray-600">
                                            {char.background}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">
                              暂无角色设定
                            </p>
                          )}
                        </div>

                        {/* 世界设定摘要 */}
                        <div className="rounded-xl border border-blue-200 bg-white p-4">
                          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-blue-800">
                            <Globe className="h-4 w-4" /> 世界设定摘要
                          </h3>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {storyBible.premise && (
                              <div className="rounded-lg bg-blue-50 p-3">
                                <div className="text-xs font-medium text-blue-600">
                                  核心概念
                                </div>
                                <div className="mt-1 text-sm text-gray-700">
                                  {storyBible.premise}
                                </div>
                              </div>
                            )}
                            {storyBible.theme && (
                              <div className="rounded-lg bg-purple-50 p-3">
                                <div className="text-xs font-medium text-purple-600">
                                  主题
                                </div>
                                <div className="mt-1 text-sm text-gray-700">
                                  {storyBible.theme}
                                </div>
                              </div>
                            )}
                            {storyBible.worldType && (
                              <div className="rounded-lg bg-indigo-50 p-3">
                                <div className="text-xs font-medium text-indigo-600">
                                  世界类型
                                </div>
                                <div className="mt-1 text-sm text-gray-700">
                                  {storyBible.worldType}
                                </div>
                              </div>
                            )}
                            {storyBible.tone && (
                              <div className="rounded-lg bg-amber-50 p-3">
                                <div className="text-xs font-medium text-amber-600">
                                  基调风格
                                </div>
                                <div className="mt-1 text-sm text-gray-700">
                                  {storyBible.tone}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 详细世界设定 */}
                        <div className="rounded-xl border border-green-200 bg-white p-4">
                          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-green-800">
                            <Map className="h-4 w-4" /> 详细设定
                          </h3>
                          {storyBible.worldSettings &&
                          storyBible.worldSettings.length > 0 ? (
                            <div className="space-y-3">
                              {/* 分离章节设定和通用设定 */}
                              {(() => {
                                // 提取章节号用于排序
                                const extractChapterNumber = (
                                  text: string
                                ): number => {
                                  const match = text.match(/第(\d+)章/);
                                  return match
                                    ? parseInt(match[1], 10)
                                    : Infinity;
                                };

                                const chapterSettings = storyBible.worldSettings
                                  .filter((s) =>
                                    /^第\d+章/.test(s.category || s.name || '')
                                  )
                                  .sort((a, b) => {
                                    const numA = extractChapterNumber(
                                      a.category || a.name || ''
                                    );
                                    const numB = extractChapterNumber(
                                      b.category || b.name || ''
                                    );
                                    return numA - numB;
                                  });
                                const generalSettings =
                                  storyBible.worldSettings.filter(
                                    (s) =>
                                      !/^第\d+章/.test(
                                        s.category || s.name || ''
                                      )
                                  );

                                return (
                                  <>
                                    {/* 通用设定 */}
                                    {generalSettings.length > 0 && (
                                      <div className="space-y-2">
                                        {generalSettings.map((setting) => (
                                          <div
                                            key={setting.id}
                                            className="flex items-start gap-2 rounded-lg bg-green-50 p-2 text-sm"
                                          >
                                            <span className="shrink-0 font-medium text-green-700">
                                              {setting.category ||
                                                setting.name ||
                                                '设定'}
                                              :
                                            </span>
                                            <span className="text-gray-600">
                                              {safeStringifyDescription(
                                                setting.description
                                              ) || setting.name}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* 章节情节设定 - 结构化显示 */}
                                    {chapterSettings.length > 0 && (
                                      <div className="mt-4">
                                        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                                          <BookOpen className="h-3.5 w-3.5" />{' '}
                                          章节情节记录
                                        </h4>
                                        <div className="space-y-2">
                                          {chapterSettings.map((setting) => (
                                            <ChapterContentStructured
                                              key={setting.id}
                                              chapterName={
                                                setting.category ||
                                                setting.name ||
                                                '章节'
                                              }
                                              content={
                                                safeStringifyDescription(
                                                  setting.description
                                                ) ||
                                                setting.name ||
                                                ''
                                              }
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">
                              详细设定将在故事生成过程中逐步完善...
                            </p>
                          )}
                        </div>
                      </>
                    ) : isMissionRunning ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                          <Library className="h-8 w-8 text-emerald-500" />
                        </div>
                        <h3 className="mb-2 text-lg font-semibold text-gray-800">
                          故事圣经构建中
                        </h3>
                        <p className="text-sm text-gray-500">
                          AI 团队正在建立角色和世界观设定...
                        </p>
                      </div>
                    ) : (
                      <EmptyState
                        icon={<Library className="h-12 w-12" />}
                        title="暂无故事圣经"
                        description="开始创作后，AI 团队将自动建立完整的故事圣经"
                      />
                    )}
                  </div>
                )}

                {/* Character Relationships Tab */}
                {activeTab === 'relationships' && (
                  <div className="h-full">
                    <CharacterRelationshipGraph projectId={projectId} />
                  </div>
                )}

                {/* Task Details Tab */}
                {activeTab === 'taskDetails' && (
                  <div className="flex h-full flex-col">
                    {taskMessages.length === 0 ? (
                      <EmptyState
                        icon={<MessageSquare className="h-12 w-12" />}
                        title="暂无交互记录"
                        description="开始创作后，这里将显示 AI 团队的协作交互详情"
                      />
                    ) : (
                      <div className="space-y-3">
                        {taskMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`rounded-xl p-3 ${
                              msg.type === 'user'
                                ? 'ml-8 bg-amber-50'
                                : msg.type === 'system'
                                  ? 'bg-gray-50'
                                  : msg.type === 'progress'
                                    ? 'bg-violet-50'
                                    : 'border border-gray-100 bg-white'
                            }`}
                          >
                            {/* Message Header */}
                            <div className="mb-1.5 flex items-center gap-2">
                              {(() => {
                                if (msg.type === 'user') {
                                  return (
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs text-white">
                                      <User className="h-3 w-3" />
                                    </span>
                                  );
                                }
                                if (msg.type === 'system') {
                                  return (
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-400 text-xs text-white">
                                      <Settings className="h-3 w-3" />
                                    </span>
                                  );
                                }
                                if (msg.type === 'progress') {
                                  return (
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-xs text-white">
                                      <BarChart3 className="h-3 w-3" />
                                    </span>
                                  );
                                }
                                // Agent type - use config
                                const agentCfg = getAgentConfig(msg.agent);
                                return (
                                  <span
                                    className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br ${agentCfg.gradient} text-xs text-white`}
                                  >
                                    {agentCfg.icon}
                                  </span>
                                );
                              })()}
                              <span
                                className={`text-xs font-medium ${
                                  msg.type === 'user'
                                    ? 'text-amber-700'
                                    : msg.type === 'system'
                                      ? 'text-gray-600'
                                      : msg.type === 'progress'
                                        ? 'text-violet-700'
                                        : 'text-gray-700'
                                }`}
                              >
                                {(() => {
                                  if (msg.type === 'user') return '你';
                                  if (msg.type === 'system') return '系统';
                                  if (msg.type === 'progress')
                                    return '任务进度';
                                  const agentCfg = getAgentConfig(msg.agent);
                                  return agentCfg.name;
                                })()}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                <ClientDate
                                  date={msg.timestamp}
                                  format="time"
                                  timeOptions={{
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  }}
                                />
                              </span>
                            </div>
                            {/* Message Content */}
                            <div
                              className={`cursor-pointer ${msg.detail ? '-mx-1 rounded-lg px-1 transition-colors hover:bg-gray-50' : ''}`}
                              onClick={() => {
                                if (msg.detail) {
                                  setExpandedMessages((prev) => {
                                    const newSet = new Set(prev);
                                    if (newSet.has(msg.id)) {
                                      newSet.delete(msg.id);
                                    } else {
                                      newSet.add(msg.id);
                                    }
                                    return newSet;
                                  });
                                }
                              }}
                            >
                              <p
                                className={`whitespace-pre-wrap text-sm ${
                                  msg.type === 'user'
                                    ? 'text-amber-800'
                                    : msg.type === 'system'
                                      ? 'text-gray-600'
                                      : msg.type === 'progress'
                                        ? 'text-violet-800'
                                        : 'text-gray-700'
                                }`}
                              >
                                {typeof msg.content === 'string'
                                  ? msg.content
                                  : JSON.stringify(msg.content)}
                                {msg.detail && (
                                  <span className="ml-2 text-xs text-violet-500">
                                    {expandedMessages.has(msg.id)
                                      ? '▼ 收起'
                                      : '▶ 展开详情'}
                                  </span>
                                )}
                              </p>

                              {/* Expandable Detail Section */}
                              {msg.detail && expandedMessages.has(msg.id) && (
                                <div className="mt-2 rounded-lg bg-gray-50 p-3 text-xs">
                                  {msg.detail.type === 'chapter_content' && (
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-1 font-medium text-gray-600">
                                        <BookOpen className="h-3 w-3" />{' '}
                                        内容预览：
                                      </div>
                                      <div className="whitespace-pre-wrap border-l-2 border-violet-300 pl-3 italic leading-relaxed text-gray-700">
                                        {typeof msg.detail.data === 'string'
                                          ? msg.detail.data
                                          : JSON.stringify(msg.detail.data)}
                                      </div>
                                    </div>
                                  )}
                                  {msg.detail.type === 'issues' && (
                                    <div className="space-y-2">
                                      <div className="font-medium text-gray-600">
                                        <Search className="mr-1 inline h-3 w-3" />{' '}
                                        发现的问题：
                                      </div>
                                      {(
                                        msg.detail.data as Array<{
                                          type: string;
                                          severity: string;
                                          description: string;
                                          suggestion?: string;
                                        }>
                                      ).map((issue, idx) => (
                                        <div
                                          key={idx}
                                          className={`rounded p-2 ${
                                            issue.severity === 'error'
                                              ? 'border-l-2 border-red-400 bg-red-50'
                                              : issue.severity === 'warning'
                                                ? 'border-l-2 border-yellow-400 bg-yellow-50'
                                                : 'border-l-2 border-blue-400 bg-blue-50'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span
                                              className={`rounded px-1.5 py-0.5 text-xs ${
                                                issue.severity === 'error'
                                                  ? 'bg-red-100 text-red-700'
                                                  : issue.severity === 'warning'
                                                    ? 'bg-yellow-100 text-yellow-700'
                                                    : 'bg-blue-100 text-blue-700'
                                              }`}
                                            >
                                              {issue.type}
                                            </span>
                                          </div>
                                          <div className="mt-1 text-gray-700">
                                            {issue.description}
                                          </div>
                                          {issue.suggestion && (
                                            <div className="mt-1 text-gray-500">
                                              <Lightbulb className="mr-1 inline h-3 w-3" />
                                              建议：{issue.suggestion}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {msg.detail.type === 'world_settings' && (
                                    <div className="space-y-3">
                                      {(() => {
                                        const data = msg.detail.data as Record<
                                          string,
                                          unknown
                                        >;
                                        const sectionConfig: Record<
                                          string,
                                          {
                                            icon: ReactNode;
                                            label: string;
                                            color: string;
                                          }
                                        > = {
                                          // 后端可能返回不同的 key，做兼容映射
                                          story_core: {
                                            icon: (
                                              <Lightbulb className="h-3.5 w-3.5" />
                                            ),
                                            label: '故事核心',
                                            color: 'purple',
                                          },
                                          core: {
                                            icon: (
                                              <Lightbulb className="h-3.5 w-3.5" />
                                            ),
                                            label: '故事核心',
                                            color: 'purple',
                                          },
                                          world: {
                                            icon: (
                                              <Globe className="h-3.5 w-3.5" />
                                            ),
                                            label: '世界背景',
                                            color: 'blue',
                                          },
                                          setting: {
                                            icon: (
                                              <Globe className="h-3.5 w-3.5" />
                                            ),
                                            label: '世界设定',
                                            color: 'blue',
                                          },
                                          characters: {
                                            icon: (
                                              <Users className="h-3.5 w-3.5" />
                                            ),
                                            label: '主要角色',
                                            color: 'amber',
                                          },
                                          character: {
                                            icon: (
                                              <Users className="h-3.5 w-3.5" />
                                            ),
                                            label: '角色设定',
                                            color: 'amber',
                                          },
                                          factions: {
                                            icon: (
                                              <Swords className="h-3.5 w-3.5" />
                                            ),
                                            label: '势力阵营',
                                            color: 'red',
                                          },
                                          faction: {
                                            icon: (
                                              <Swords className="h-3.5 w-3.5" />
                                            ),
                                            label: '势力阵营',
                                            color: 'red',
                                          },
                                          terminology: {
                                            icon: (
                                              <BookOpen className="h-3.5 w-3.5" />
                                            ),
                                            label: '专有名词',
                                            color: 'purple',
                                          },
                                          locations: {
                                            icon: (
                                              <MapPin className="h-3.5 w-3.5" />
                                            ),
                                            label: '重要地点',
                                            color: 'green',
                                          },
                                          location: {
                                            icon: (
                                              <MapPin className="h-3.5 w-3.5" />
                                            ),
                                            label: '重要地点',
                                            color: 'green',
                                          },
                                          timeline: {
                                            icon: (
                                              <Calendar className="h-3.5 w-3.5" />
                                            ),
                                            label: '时间线',
                                            color: 'indigo',
                                          },
                                        };
                                        // 嵌套字段名翻译映射
                                        const fieldLabelMap: Record<
                                          string,
                                          string
                                        > = {
                                          summary: '概要',
                                          genre: '类型',
                                          theme: '主题',
                                          type: '类型',
                                          era: '时代',
                                          geography: '地理',
                                          society: '社会',
                                          rules: '规则',
                                          name: '名称',
                                          role: '角色',
                                          appearance: '外貌',
                                          personality: '性格',
                                          background: '背景',
                                          motivation: '动机',
                                          arc: '成长线',
                                          description: '描述',
                                          relations: '关系',
                                          term: '术语',
                                          definition: '定义',
                                        };
                                        return Object.entries(data).map(
                                          ([key, value]) => {
                                            const config = sectionConfig[
                                              key
                                            ] || {
                                              icon: (
                                                <Pin className="h-3.5 w-3.5" />
                                              ),
                                              label: key,
                                              color: 'gray',
                                            };
                                            const colorClasses: Record<
                                              string,
                                              string
                                            > = {
                                              blue: 'bg-blue-50 border-blue-200 text-blue-800',
                                              amber:
                                                'bg-amber-50 border-amber-200 text-amber-800',
                                              red: 'bg-red-50 border-red-200 text-red-800',
                                              purple:
                                                'bg-purple-50 border-purple-200 text-purple-800',
                                              green:
                                                'bg-green-50 border-green-200 text-green-800',
                                              indigo:
                                                'bg-indigo-50 border-indigo-200 text-indigo-800',
                                              gray: 'bg-gray-50 border-gray-200 text-gray-800',
                                            };
                                            const cls =
                                              colorClasses[config.color];

                                            // 渲染值
                                            const renderValue = (
                                              val: unknown
                                            ): React.ReactNode => {
                                              if (typeof val === 'string') {
                                                return (
                                                  <p className="whitespace-pre-wrap text-sm text-gray-700">
                                                    {val}
                                                  </p>
                                                );
                                              }
                                              if (Array.isArray(val)) {
                                                return (
                                                  <ul className="space-y-2">
                                                    {val.map((item, i) => (
                                                      <li
                                                        key={i}
                                                        className="text-sm text-gray-700"
                                                      >
                                                        {typeof item ===
                                                          'object' &&
                                                        item !== null ? (
                                                          <div className="rounded bg-white/50 p-2">
                                                            {Object.entries(
                                                              item as Record<
                                                                string,
                                                                unknown
                                                              >
                                                            )
                                                              .filter(
                                                                ([, v]) => v
                                                              )
                                                              .map(([k, v]) => (
                                                                <div
                                                                  key={k}
                                                                  className="mb-1"
                                                                >
                                                                  <span className="font-medium">
                                                                    {fieldLabelMap[
                                                                      k
                                                                    ] || k}
                                                                    :
                                                                  </span>{' '}
                                                                  <span className="whitespace-pre-wrap">
                                                                    {typeof v ===
                                                                    'string'
                                                                      ? v
                                                                      : Array.isArray(
                                                                            v
                                                                          )
                                                                        ? (
                                                                            v as string[]
                                                                          ).join(
                                                                            '、'
                                                                          )
                                                                        : JSON.stringify(
                                                                            v
                                                                          )}
                                                                  </span>
                                                                </div>
                                                              ))}
                                                          </div>
                                                        ) : (
                                                          `• ${String(item)}`
                                                        )}
                                                      </li>
                                                    ))}
                                                  </ul>
                                                );
                                              }
                                              if (
                                                typeof val === 'object' &&
                                                val !== null
                                              ) {
                                                const obj = val as Record<
                                                  string,
                                                  unknown
                                                >;
                                                return (
                                                  <div className="space-y-1 text-sm text-gray-700">
                                                    {Object.entries(obj)
                                                      .filter(([, v]) => v)
                                                      .map(([k, v]) => (
                                                        <div key={k}>
                                                          <span className="font-medium">
                                                            {fieldLabelMap[k] ||
                                                              k}
                                                            :
                                                          </span>{' '}
                                                          <span className="whitespace-pre-wrap">
                                                            {typeof v ===
                                                            'string'
                                                              ? v
                                                              : Array.isArray(v)
                                                                ? (
                                                                    v as string[]
                                                                  ).join('、')
                                                                : JSON.stringify(
                                                                    v
                                                                  )}
                                                          </span>
                                                        </div>
                                                      ))}
                                                  </div>
                                                );
                                              }
                                              return (
                                                <span className="text-sm text-gray-700">
                                                  {String(val)}
                                                </span>
                                              );
                                            };

                                            return (
                                              <div
                                                key={key}
                                                className={`rounded-lg border p-3 ${cls}`}
                                              >
                                                <div className="mb-2 flex items-center gap-2 font-medium">
                                                  <span>{config.icon}</span>
                                                  <span>{config.label}</span>
                                                </div>
                                                {renderValue(value)}
                                              </div>
                                            );
                                          }
                                        );
                                      })()}
                                    </div>
                                  )}
                                  {msg.detail.type === 'text' && (
                                    <div className="whitespace-pre-wrap text-gray-700">
                                      {typeof msg.detail.data === 'string'
                                        ? msg.detail.data
                                        : JSON.stringify(msg.detail.data)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        <div ref={taskMessagesEndRef} />
                      </div>
                    )}
                  </div>
                )}

                {/* Summaries Tab - Hierarchical Summaries */}
                {activeTab === 'summaries' && (
                  <div className="h-full">
                    <HierarchicalSummaryTab
                      projectId={projectId}
                      currentChapter={selectedChapter?.chapterNumber}
                    />
                  </div>
                )}

                {/* Analysis Tab - Story Analysis Dashboard */}
                {activeTab === 'analysis' && (
                  <div className="h-full overflow-auto">
                    <StoryAnalysisDashboard
                      projectId={projectId}
                      onConflictClick={(conflict) => {
                        // Jump to the chapter with the conflict
                        if (conflict.sourceChapter) {
                          const chapter = allChapters.find(
                            (c) => c.chapterNumber === conflict.sourceChapter
                          );
                          if (chapter) {
                            setSelectedChapter(chapter);
                            setActiveTab('chapters');
                          }
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Input Area */}
            <div className="relative mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              {/* @Leader Dropdown - 只支持 Leader */}
              {showLeaderMenu && (
                <div className="absolute bottom-full left-4 z-50 mb-2 w-64 rounded-xl border border-gray-200 bg-white py-2 shadow-lg">
                  <div className="px-3 py-1.5 text-xs font-medium text-gray-400">
                    提及 Leader
                  </div>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault(); // 阻止 blur 事件
                      handleSelectLeader();
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-amber-50"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-violet-600 text-sm">
                      <Crown className="h-4 w-4 text-white" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-800">
                        @Leader
                      </div>
                      <div className="text-xs text-gray-400">
                        故事架构师 · 编辑调整内容
                      </div>
                    </div>
                  </button>
                </div>
              )}

              <div className="flex gap-3">
                <div className="relative flex-1">
                  <textarea
                    ref={inputRef}
                    value={userInput}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      // Handle Leader menu
                      if (showLeaderMenu) {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setShowLeaderMenu(false);
                        } else if (
                          e.key === 'Tab' ||
                          (e.key === 'Enter' && !e.shiftKey)
                        ) {
                          e.preventDefault();
                          handleSelectLeader();
                        }
                        return;
                      }
                      // Normal submit
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    onBlur={() => {
                      // Delay to allow click on menu
                      setTimeout(() => setShowLeaderMenu(false), 200);
                    }}
                    placeholder="输入 @Leader 让架构师编辑调整内容..."
                    rows={2}
                    className="w-full resize-none rounded-xl border border-gray-200 p-3 text-sm placeholder-gray-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                    disabled={isMissionRunning}
                  />
                  {/* Hint for @ */}
                  {!userInput && !isMissionRunning && (
                    <div className="pointer-events-none absolute bottom-2 right-3 text-xs text-gray-300">
                      @ 提及 Leader
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!userInput.trim() || isMissionRunning}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white transition-all hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
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
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Chapter Content Modal - Preview Mode */}
        <Modal
          open={!!selectedChapter && !isEditingChapter}
          onClose={() => setSelectedChapter(null)}
          title={
            selectedChapter ? (
              <div>
                <span>
                  第{selectedChapter.chapterNumber}章{' '}
                  {(selectedChapter.title || '').replace(
                    /^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i,
                    ''
                  )}
                </span>
                <div className="mt-1 flex items-center gap-3 text-sm font-normal text-gray-500">
                  {selectedChapter.wordCount > 0 && (
                    <span>{selectedChapter.wordCount.toLocaleString()} 字</span>
                  )}
                  {selectedChapter.outline && (
                    <span className="text-gray-400">
                      {selectedChapter.outline}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              ''
            )
          }
          size="xl"
          footerClassName="justify-between"
          footer={
            selectedChapter ? (
              <>
                <button
                  onClick={() => setIsEditingChapter(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
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
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                  编辑章节
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (!selectedChapter.content) return;
                      const blob = new Blob([selectedChapter.content], {
                        type: 'text/plain;charset=utf-8',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `第${selectedChapter.chapterNumber}章-${selectedChapter.title}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    disabled={!selectedChapter.content}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    下载
                  </button>
                  <button
                    onClick={() => setSelectedChapter(null)}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : null
          }
        >
          {selectedChapter &&
            (selectedChapter.content ? (
              <div className="prose prose-gray prose-headings:text-gray-800 prose-p:text-gray-700 prose-p:leading-relaxed prose-strong:text-gray-800 max-w-none">
                <ReactMarkdown>{selectedChapter.content}</ReactMarkdown>
              </div>
            ) : (
              <EmptyState
                icon={<FileText className="h-12 w-12" />}
                title="暂无内容"
                description="该章节尚未生成内容"
              />
            ))}
        </Modal>

        {/* Chapter Edit Panel - Full Screen Edit Mode */}
        {selectedChapter && isEditingChapter && (
          <div className="fixed inset-0 z-50 bg-white">
            <ChapterEditPanel
              chapter={selectedChapter}
              onUpdate={(updatedChapter) => {
                setSelectedChapter(updatedChapter);
                // Refresh volumes to get updated content
                fetchVolumes(projectId);
              }}
              onClose={() => {
                setIsEditingChapter(false);
              }}
            />
          </div>
        )}

        {/* 一致性检查浮动面板 - 可关闭/最小化 */}
        {consistencyIssues.length > 0 && (
          <div
            className={`fixed bottom-4 right-4 z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl transition-all duration-200 ${
              showConsistencyPanel ? 'max-h-96 w-80' : 'w-auto'
            }`}
          >
            <div
              className="flex cursor-pointer items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2"
              onClick={() => setShowConsistencyPanel(!showConsistencyPanel)}
            >
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-white" />
                <span className="text-sm font-semibold text-white">
                  一致性检查
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs text-white">
                  {consistencyIssues.reduce(
                    (acc, ci) => acc + ci.issues.length,
                    0
                  )}{' '}
                  个问题
                </span>
                <span className="text-white/80">
                  {showConsistencyPanel ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </span>
              </div>
            </div>
            {showConsistencyPanel && (
              <div className="max-h-72 space-y-2 overflow-y-auto p-3">
                {consistencyIssues.slice(-5).map((check, idx) => (
                  <div key={idx} className="rounded-lg bg-gray-50 p-2">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`text-xs font-medium ${check.passed ? 'text-green-600' : 'text-amber-600'}`}
                      >
                        第 {check.chapterNumber} 章
                      </span>
                      {check.passed ? (
                        <span className="flex items-center gap-0.5 text-xs text-green-500">
                          <Check className="h-3 w-3" /> 通过
                        </span>
                      ) : (
                        <span className="text-xs text-amber-500">
                          {check.issues.length} 个问题
                        </span>
                      )}
                    </div>
                    {!check.passed &&
                      check.issues.slice(0, 3).map((issue, iIdx) => (
                        <div
                          key={iIdx}
                          className={`mb-1 rounded p-1.5 text-xs ${
                            issue.severity === 'error'
                              ? 'bg-red-50 text-red-700'
                              : issue.severity === 'warning'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          <div className="flex items-start gap-1">
                            <span>
                              {issue.severity === 'error' ? (
                                <XCircle className="h-3 w-3 text-red-600" />
                              ) : issue.severity === 'warning' ? (
                                <AlertTriangle className="h-3 w-3 text-amber-600" />
                              ) : (
                                <Info className="h-3 w-3 text-blue-600" />
                              )}
                            </span>
                            <div>
                              <span className="font-medium">
                                [{issue.type}]
                              </span>{' '}
                              {issue.description}
                              {issue.suggestion && (
                                <div className="mt-0.5 flex items-center gap-1 text-gray-500">
                                  <Lightbulb className="h-3 w-3" />{' '}
                                  {issue.suggestion}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    {!check.passed && check.issues.length > 3 && (
                      <div className="text-center text-xs text-gray-400">
                        还有 {check.issues.length - 3} 个问题...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Import Modal */}
        {showImportModal && (
          <ChapterImportModal
            projectId={projectId}
            volumes={volumes.map((v) => ({
              id: v.id,
              title: v.title,
              volumeNumber: v.volumeNumber,
            }))}
            onSuccess={() => {
              fetchVolumes(projectId);
            }}
            onClose={() => setShowImportModal(false)}
          />
        )}

        {/* Export Dialog */}
        {currentProject && (
          <ExportDialog
            isOpen={showExportDialog}
            onClose={() => setShowExportDialog(false)}
            contentSelector="[data-export-content='writing']"
            contentTitle={currentProject.name}
            moduleType="writing"
            sourceId={projectId}
            availableFormats={['PDF', 'DOCX', 'PPTX', 'HTML']}
          />
        )}
      </main>
    </AppShell>
  );
}
