'use client';

import { useState, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Sparkles,
  Tag,
  FolderPlus,
  Link2,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  AlertCircle,
  Zap,
  FileText,
  Palette,
  LayoutGrid,
  Wand2,
  MessageSquare,
} from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { OrganizeChatMode } from './OrganizeChatMode';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { cn } from '@/lib/utils/common';
import { logger } from '@/lib/utils/logger';

interface Collection {
  id: string;
  name: string;
  itemCount?: number;
}

/** 仅 3 个真实子数据源——其余 tab 分支已废弃（2026-05-20 全面重构） */
type OrganizeTab = 'bookmarks' | 'notes' | 'images';

/** 数据源统一整理：tab → 精确源类型（驱动后端跨源整理工具流）。 */
const TAB_ITEM_TYPE: Record<OrganizeTab, 'BOOKMARK' | 'NOTE' | 'IMAGE'> = {
  bookmarks: 'BOOKMARK',
  notes: 'NOTE',
  images: 'IMAGE',
};

interface AIOrganizePanelProps {
  collections: Collection[];
  onRefresh: () => void;
  activeTab?: OrganizeTab;
}

type TaskType =
  | 'batch-tags'
  | 'smart-classify'
  | 'theme-cluster'
  | 'notes-keypoints'
  | 'notes-connections'
  | 'notes-summarize'
  | 'images-autotag'
  | 'images-style'
  | 'images-cluster';
type TaskStatus = 'idle' | 'running' | 'success' | 'error';

interface KeyPoint {
  insight?: string;
  title?: string;
  point?: string;
  source?: string;
}

interface Connection {
  from: string;
  to: string;
  reasoning: string;
  note1Title?: string;
  note2Title?: string;
  noteIds?: string[];
  note1?: string;
  note2?: string;
  relationship?: string;
  reason?: string;
  description?: string;
  theme?: string;
  strength?: 'strong' | 'moderate' | 'weak';
}

interface ImageTag {
  id: string;
  tags: string[];
  prompt?: string;
  title?: string;
}

interface Style {
  style: string;
  count: number;
  name?: string;
  description?: string;
  colors?: string[];
}

interface Cluster {
  name: string;
  count: number;
  theme?: string;
  description?: string;
  keywords?: string[];
  images?: unknown[];
}

interface TaskResults {
  clusters?: Cluster[];
  suggestions?: Array<{ resourceTitle: string; suggestedCollection: string }>;
  keyPoints?: Array<KeyPoint | string>;
  connections?: Connection[];
  images?: ImageTag[];
  styles?: Style[];
  summary?: string;
  topics?: string[];
  taggedCount?: number;
  [key: string]: unknown;
}

interface TaskState {
  status: TaskStatus;
  message: string;
  results?: TaskResults;
}

/** 单个动作的静态描述（运行逻辑由 buildActions 注入） */
interface ActionDef {
  id: TaskType;
  icon: LucideIcon;
  /** 中英双语标题，如 "Batch Tags / 批量标签" */
  title: string;
  /** 中文说明 */
  desc: string;
  /** 按钮文案（idle） */
  cta: string;
  /** 按钮文案（running） */
  running: string;
  run: () => Promise<void>;
  /** 是否有结果弹层（笔记 / 图片类） */
  hasResultsModal?: boolean;
}

function statusIcon(status: TaskStatus) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />;
    case 'success':
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
    case 'error':
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return null;
  }
}

/**
 * 单行 AI 动作（表格行）：图标+名称 / 说明 / 状态 / 一键运行。
 * 表格化呈现，空间利用更充分；统一紫色主题。
 */
function ActionRow({
  def,
  state,
  onViewResults,
}: {
  def: ActionDef;
  state: TaskState;
  onViewResults: () => void;
}) {
  const Icon = def.icon;
  const running = state.status === 'running';
  return (
    <Tr hoverable className="align-middle">
      <Td className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="whitespace-nowrap text-sm font-medium text-gray-900">
            {def.title}
          </span>
        </div>
      </Td>
      <Td className="hidden px-3 py-2.5 text-xs text-gray-500 sm:table-cell">
        {def.desc}
      </Td>
      <Td className="px-3 py-2.5">
        {state.message ? (
          <span
            className={cn(
              'flex items-center gap-1 text-xs',
              state.status === 'error'
                ? 'text-red-600'
                : state.status === 'success'
                  ? 'text-emerald-600'
                  : 'text-gray-500'
            )}
          >
            {statusIcon(state.status)}
            <span className="line-clamp-1">{state.message}</span>
          </span>
        ) : (
          <span className="text-xs text-gray-400">Ready / 就绪</span>
        )}
      </Td>
      <Td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-2">
          {def.hasResultsModal &&
            state.status === 'success' &&
            state.results && (
              <button
                onClick={onViewResults}
                className="whitespace-nowrap text-xs font-medium text-violet-600 transition-colors hover:text-violet-700"
              >
                查看
              </button>
            )}
          <button
            onClick={() => void def.run()}
            disabled={running}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {running ? def.running : def.cta}
          </button>
        </div>
      </Td>
    </Tr>
  );
}

const TAB_SUBTITLE: Record<OrganizeTab, string> = {
  bookmarks:
    'Smart tagging, classification & themes / 智能打标签、分类与主题发现',
  notes: 'Extract insights & find connections / 分析笔记、提炼要点、发现关联',
  images: 'Auto-tag, style & visual themes / 图片打标签、风格分析与视觉主题',
};

const MODAL_META: Record<string, { title: string; subtitle: string }> = {
  'notes-keypoints': {
    title: 'Key Points / 关键要点',
    subtitle: 'Key insights extracted from your notes / 从笔记中提取的关键见解',
  },
  'notes-connections': {
    title: 'Connections / 笔记关联',
    subtitle: 'Hidden connections between notes / 笔记之间的隐藏关联',
  },
  'notes-summarize': {
    title: 'Summary / 总结摘要',
    subtitle: 'Comprehensive summary of all notes / 所有笔记的综合总结',
  },
  'images-autotag': {
    title: 'Auto Tags / 自动标签',
    subtitle: 'AI-generated tags for your images / AI 为图片生成的标签',
  },
  'images-style': {
    title: 'Style Analysis / 风格分析',
    subtitle: 'Art styles and themes detected / 检测到的艺术风格和主题',
  },
  'images-cluster': {
    title: 'Visual Themes / 视觉主题',
    subtitle: 'Images grouped by visual similarity / 按视觉相似度分组的图片',
  },
};

export default function AIOrganizePanel({
  collections,
  onRefresh,
  activeTab = 'bookmarks',
}: AIOrganizePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [resultsModal, setResultsModal] = useState<TaskType | null>(null);
  const [stats, setStats] = useState({
    untaggedCount: 0,
    unclassifiedCount: 0,
    totalCount: 0,
  });
  const [taskStates, setTaskStates] = useState<Record<TaskType, TaskState>>({
    'batch-tags': { status: 'idle', message: '' },
    'smart-classify': { status: 'idle', message: '' },
    'theme-cluster': { status: 'idle', message: '' },
    'notes-keypoints': { status: 'idle', message: '' },
    'notes-connections': { status: 'idle', message: '' },
    'notes-summarize': { status: 'idle', message: '' },
    'images-autotag': { status: 'idle', message: '' },
    'images-style': { status: 'idle', message: '' },
    'images-cluster': { status: 'idle', message: '' },
  });
  const [selectedCollection, setSelectedCollection] = useState<string>('all');

  // 展开时拉取书签统计
  useEffect(() => {
    if (isExpanded && activeTab === 'bookmarks') {
      void fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, activeTab]);

  const fetchStats = async () => {
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/collections/ai/stats`,
        { headers: getAuthHeader() }
      );
      if (response.ok) {
        const result = await response.json();
        const data = result?.data ?? result;
        setStats(data);
      }
    } catch (err) {
      logger.error('Failed to fetch stats:', err);
    }
  };

  const updateTaskState = (task: TaskType, updates: Partial<TaskState>) => {
    setTaskStates((prev) => ({
      ...prev,
      [task]: { ...prev[task], ...updates },
    }));
  };

  /** 统一的任务执行器：9 个动作只在 endpoint / body / 文案上不同 */
  const runTask =
    (
      task: TaskType,
      endpoint: string,
      opts: {
        body?: Record<string, unknown>;
        running: string;
        done: (r: TaskResults) => string;
        refresh?: boolean;
      }
    ) =>
    async () => {
      updateTaskState(task, { status: 'running', message: opts.running });
      try {
        const response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify(opts.body ?? {}),
        });
        if (!response.ok) throw new Error('请求失败 / Request failed');
        const apiResult = await response.json();
        const result = (apiResult?.data ?? apiResult) as TaskResults;
        updateTaskState(task, {
          status: 'success',
          message: opts.done(result),
          results: result,
        });
        if (opts.refresh) onRefresh();
      } catch (err: unknown) {
        updateTaskState(task, {
          status: 'error',
          message: err instanceof Error ? err.message : '操作失败 / Failed',
        });
      }
    };

  // 各子数据源的动作配置（替代原 9 块重复 JSX + 9 个 handler）
  const TAB_ACTIONS: Record<OrganizeTab, ActionDef[]> = {
    bookmarks: [
      {
        id: 'batch-tags',
        icon: Tag,
        title: 'Batch Tags / 批量标签',
        desc: '为缺少标签的资源自动生成相关标签',
        cta: '生成标签',
        running: '处理中…',
        run: runTask('batch-tags', '/api/v1/collections/ai/batch-tags', {
          body: {
            collectionId:
              selectedCollection === 'all' ? null : selectedCollection,
          },
          running: '正在分析资源并生成标签…',
          done: (r) => `已为 ${r.taggedCount ?? 0} 个资源打标签`,
          refresh: true,
        }),
      },
      {
        id: 'smart-classify',
        icon: FolderPlus,
        title: 'Smart Classify / 智能分类',
        desc: 'AI 建议每个资源应归入的合集',
        cta: '开始分类',
        running: '分析中…',
        run: runTask(
          'smart-classify',
          '/api/v1/collections/ai/smart-classify',
          {
            running: '正在分析并给出分类建议…',
            done: (r) => `已生成 ${r.suggestions?.length ?? 0} 条分类建议`,
            refresh: true,
          }
        ),
      },
      {
        id: 'theme-cluster',
        icon: Link2,
        title: 'Theme Clusters / 主题聚类',
        desc: '发现资源间隐藏的主题与规律',
        cta: '发现主题',
        running: '发现中…',
        run: runTask('theme-cluster', '/api/v1/collections/ai/theme-cluster', {
          running: '正在发现主题与规律…',
          done: (r) => `发现 ${r.clusters?.length ?? 0} 个主题簇`,
        }),
      },
    ],
    notes: [
      {
        id: 'notes-keypoints',
        icon: Sparkles,
        title: 'Key Points / 关键要点',
        desc: '从笔记中提取关键见解与主要观点',
        cta: '提取要点',
        running: '提取中…',
        hasResultsModal: true,
        run: runTask('notes-keypoints', '/api/v1/notes/ai/extract-keypoints', {
          running: '正在从笔记中提取关键见解…',
          done: (r) => `提取了 ${r.keyPoints?.length ?? 0} 条关键见解`,
          refresh: true,
        }),
      },
      {
        id: 'notes-connections',
        icon: Link2,
        title: 'Connections / 笔记关联',
        desc: '发现笔记之间的隐藏关联',
        cta: '分析关联',
        running: '分析中…',
        hasResultsModal: true,
        run: runTask('notes-connections', '/api/v1/notes/ai/find-connections', {
          running: '正在寻找笔记之间的关联…',
          done: (r) => `发现 ${r.connections?.length ?? 0} 条关联`,
        }),
      },
      {
        id: 'notes-summarize',
        icon: FileText,
        title: 'Summarize / 总结摘要',
        desc: '为所有笔记生成一份综合摘要',
        cta: '生成摘要',
        running: '总结中…',
        hasResultsModal: true,
        run: runTask('notes-summarize', '/api/v1/notes/ai/summarize', {
          running: '正在生成综合摘要…',
          done: () => '摘要生成成功',
        }),
      },
    ],
    images: [
      {
        id: 'images-autotag',
        icon: Tag,
        title: 'Auto Tag / 自动打标',
        desc: 'AI 识别内容并生成相关标签',
        cta: '标记图片',
        running: '标记中…',
        hasResultsModal: true,
        run: runTask('images-autotag', '/api/v1/ai-image/ai/auto-tag', {
          running: '正在分析图片并生成标签…',
          done: (r) =>
            `标记了 ${r.taggedCount ?? r.images?.length ?? 0} 张图片`,
          refresh: true,
        }),
      },
      {
        id: 'images-style',
        icon: Palette,
        title: 'Style Analysis / 风格分析',
        desc: '识别艺术风格、配色与主题',
        cta: '分析风格',
        running: '分析中…',
        hasResultsModal: true,
        run: runTask('images-style', '/api/v1/ai-image/ai/analyze-styles', {
          running: '正在分析艺术风格与配色…',
          done: (r) => `识别了 ${r.styles?.length ?? 0} 种风格`,
        }),
      },
      {
        id: 'images-cluster',
        icon: LayoutGrid,
        title: 'Visual Themes / 视觉主题',
        desc: '按视觉相似度将图片分组',
        cta: '聚类主题',
        running: '聚类中…',
        hasResultsModal: true,
        run: runTask('images-cluster', '/api/v1/ai-image/ai/cluster-themes', {
          running: '正在按视觉主题聚类…',
          done: (r) => `发现 ${r.clusters?.length ?? 0} 个视觉主题`,
        }),
      },
    ],
  };

  const actions = TAB_ACTIONS[activeTab];
  const anyRunning = actions.some(
    (def) => taskStates[def.id].status === 'running'
  );

  // 一键整理：展开并依次触发当前 tab 全部动作
  const runAll = () => {
    setIsExpanded(true);
    actions.forEach((def) => void def.run());
  };

  return (
    <div>
      {/* 头部栏：标题（点击折叠）+ 一键整理 + 折叠箭头 */}
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors',
          isExpanded
            ? 'border-violet-200 bg-violet-50/60'
            : 'border-gray-200 bg-white'
        )}
      >
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <div
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
              isExpanded ? 'bg-violet-100' : 'bg-gray-100'
            )}
          >
            <Sparkles
              className={cn(
                'h-4 w-4',
                isExpanded ? 'text-violet-600' : 'text-gray-500'
              )}
            />
          </div>
          <div className="min-w-0">
            <h3
              className={cn(
                'text-sm font-semibold',
                isExpanded ? 'text-violet-900' : 'text-gray-800'
              )}
            >
              AI Organize / AI 整理
            </h3>
            <p className="truncate text-xs text-gray-500">
              {TAB_SUBTITLE[activeTab]}
            </p>
          </div>
        </button>
        <div className="flex flex-shrink-0 items-center gap-1">
          {/* 数据源统一整理：书签/笔记/图片均可对话整理 */}
          <button
            onClick={() => setChatOpen(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50"
          >
            <MessageSquare className="h-4 w-4" />
            对话整理
          </button>
          <button
            onClick={runAll}
            disabled={anyRunning}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {anyRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            一键整理
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? '收起' : '展开'}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            {isExpanded ? (
              <ChevronUp className="h-5 w-5" />
            ) : (
              <ChevronDown className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="mt-2 overflow-hidden rounded-xl border border-violet-100 bg-white shadow-sm">
          {/* 书签工具条：统计 + 合集选择器 */}
          {activeTab === 'bookmarks' && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                <span>
                  <strong className="text-gray-900">{stats.totalCount}</strong>{' '}
                  资源
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-amber-600">
                  <strong>{stats.untaggedCount}</strong> 无标签
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-violet-600">
                  <strong>{stats.unclassifiedCount}</strong> 未分类
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">应用到</span>
                <select
                  value={selectedCollection}
                  onChange={(e) => setSelectedCollection(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                >
                  <option value="all">全部合集</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.itemCount || 0})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* 动作表格 */}
          <Table>
            <THead>
              <Tr className="border-b border-gray-100 bg-gray-50/50 text-[11px] uppercase tracking-wide text-gray-400">
                <Th className="px-3 py-2">Action / 动作</Th>
                <Th className="hidden px-3 py-2 sm:table-cell">
                  Description / 说明
                </Th>
                <Th className="px-3 py-2">Status / 状态</Th>
                <Th className="px-3 py-2 text-right">Run / 运行</Th>
              </Tr>
            </THead>
            <TBody className="divide-y divide-gray-100">
              {actions.map((def) => (
                <ActionRow
                  key={def.id}
                  def={def}
                  state={taskStates[def.id]}
                  onViewResults={() => setResultsModal(def.id)}
                />
              ))}
            </TBody>
          </Table>

          {/* 书签内联结果（主题簇 + 分类建议） */}
          {activeTab === 'bookmarks' && (
            <div className="space-y-3 px-3 pb-3 pt-3">
              {taskStates['theme-cluster'].status === 'success' &&
                taskStates['theme-cluster'].results?.clusters &&
                taskStates['theme-cluster'].results.clusters.length > 0 && (
                  <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-4">
                    <h4 className="mb-2 text-sm font-medium text-violet-900">
                      Discovered Themes / 发现的主题
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {taskStates['theme-cluster'].results.clusters.map(
                        (cluster, index) => (
                          <span
                            key={index}
                            className="rounded-full bg-violet-100 px-3 py-1 text-sm text-violet-700"
                          >
                            {cluster.name} ({cluster.count})
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

              {taskStates['smart-classify'].status === 'success' &&
                taskStates['smart-classify'].results?.suggestions &&
                taskStates['smart-classify'].results.suggestions.length > 0 && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <h4 className="mb-2 text-sm font-medium text-gray-900">
                      Classification Suggestions / 分类建议
                    </h4>
                    <div className="space-y-2">
                      {taskStates['smart-classify'].results.suggestions
                        .slice(0, 5)
                        .map((suggestion, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between rounded-lg bg-white p-2 text-sm shadow-sm"
                          >
                            <span className="truncate text-gray-700">
                              {suggestion.resourceTitle}
                            </span>
                            <span className="ml-2 flex-shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
                              → {suggestion.suggestedCollection}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {/* 对话整理浮层（canonical LeaderChatDock）：书签/笔记/图片统一入口 */}
      <OrganizeChatMode
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        itemType={TAB_ITEM_TYPE[activeTab]}
        onChanged={fetchStats}
      />

      {/* 结果弹层（笔记 / 图片类） */}
      <Modal
        open={!!(resultsModal && taskStates[resultsModal]?.results)}
        onClose={() => setResultsModal(null)}
        size="lg"
        title={resultsModal ? (MODAL_META[resultsModal]?.title ?? '') : ''}
        subtitle={resultsModal ? MODAL_META[resultsModal]?.subtitle : undefined}
        footer={
          <button
            onClick={() => setResultsModal(null)}
            className="w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Close / 关闭
          </button>
        }
      >
        {resultsModal && (
          <div>
            {/* 关键要点 */}
            {resultsModal === 'notes-keypoints' && (
              <div className="space-y-3">
                {taskStates[resultsModal].results?.keyPoints &&
                taskStates[resultsModal].results.keyPoints.length > 0 ? (
                  taskStates[resultsModal].results.keyPoints.map(
                    (point: KeyPoint | string, index: number) => {
                      const pointText =
                        typeof point === 'string'
                          ? point
                          : point.insight || point.title || point.point || '';
                      const source =
                        typeof point === 'object' ? point.source : undefined;
                      return (
                        <div
                          key={index}
                          className="rounded-lg border border-violet-100 bg-violet-50/60 p-4"
                        >
                          <div className="flex items-start gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500 text-xs font-bold text-white">
                              {index + 1}
                            </span>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900">
                                {pointText}
                              </p>
                              {source && (
                                <p className="mt-1 text-xs text-gray-500">
                                  Source / 来源: {source}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )
                ) : (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No key points found / 未找到关键要点
                  </p>
                )}
              </div>
            )}

            {/* 笔记关联 */}
            {resultsModal === 'notes-connections' && (
              <div className="space-y-3">
                {taskStates[resultsModal].results?.connections &&
                taskStates[resultsModal].results.connections.length > 0 ? (
                  taskStates[resultsModal].results.connections.map(
                    (conn: Connection, index: number) => {
                      const note1Display =
                        conn.note1Title ||
                        conn.noteIds?.[0] ||
                        conn.note1 ||
                        conn.from ||
                        'Unknown';
                      const note2Display =
                        conn.note2Title ||
                        conn.noteIds?.[1] ||
                        conn.note2 ||
                        conn.to ||
                        'Unknown';
                      const relationship =
                        conn.relationship || conn.reason || conn.description;
                      return (
                        <div
                          key={index}
                          className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Link2 className="h-4 w-4 text-violet-600" />
                              <span className="text-sm font-medium text-gray-900">
                                Connection #{index + 1} / 关联
                              </span>
                            </div>
                            {conn.strength && (
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-xs font-medium',
                                  conn.strength === 'strong'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : conn.strength === 'moderate'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-gray-200 text-gray-600'
                                )}
                              >
                                {conn.strength === 'strong'
                                  ? 'Strong / 强'
                                  : conn.strength === 'moderate'
                                    ? 'Moderate / 中'
                                    : 'Weak / 弱'}
                              </span>
                            )}
                          </div>
                          {relationship && (
                            <p className="mb-3 text-sm leading-relaxed text-gray-700">
                              {relationship}
                            </p>
                          )}
                          {conn.theme && (
                            <div className="mb-3">
                              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                                # {conn.theme}
                              </span>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-white p-2.5 shadow-sm">
                              <p className="mb-1 text-xs text-gray-400">
                                Note 1
                              </p>
                              <p className="line-clamp-2 text-sm font-medium text-gray-700">
                                {note1Display}
                              </p>
                            </div>
                            <div className="rounded-lg bg-white p-2.5 shadow-sm">
                              <p className="mb-1 text-xs text-gray-400">
                                Note 2
                              </p>
                              <p className="line-clamp-2 text-sm font-medium text-gray-700">
                                {note2Display}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )
                ) : (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No connections found / 未找到关联
                  </p>
                )}
              </div>
            )}

            {/* 总结摘要 */}
            {resultsModal === 'notes-summarize' && (
              <div>
                {taskStates[resultsModal].results?.summary ? (
                  <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                      {taskStates[resultsModal].results.summary}
                    </p>
                    {taskStates[resultsModal].results.topics &&
                      Array.isArray(taskStates[resultsModal].results.topics) &&
                      taskStates[resultsModal].results.topics.length > 0 && (
                        <div className="mt-4 border-t border-violet-200 pt-3">
                          <p className="mb-2 text-xs font-medium text-violet-700">
                            Main Topics / 主要主题
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {taskStates[resultsModal].results.topics.map(
                              (topic: string, i: number) => (
                                <span
                                  key={i}
                                  className="rounded-full bg-violet-100 px-3 py-1 text-xs text-violet-700"
                                >
                                  {topic}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No summary generated / 未生成摘要
                  </p>
                )}
              </div>
            )}

            {/* 图片自动标签 */}
            {resultsModal === 'images-autotag' && (
              <div className="space-y-3">
                {taskStates[resultsModal].results?.images &&
                taskStates[resultsModal].results.images.length > 0 ? (
                  taskStates[resultsModal].results.images.map(
                    (img: ImageTag, index: number) => (
                      <div
                        key={index}
                        className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                      >
                        <p className="mb-2 truncate text-sm font-medium text-gray-900">
                          {img.prompt?.substring(0, 50) ||
                            img.title ||
                            `Image #${index + 1}`}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(img.tags || []).map((tag: string, i: number) => (
                            <span
                              key={i}
                              className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  )
                ) : (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No images tagged / 未标记图片
                  </p>
                )}
              </div>
            )}

            {/* 图片风格分析 */}
            {resultsModal === 'images-style' && (
              <div className="space-y-3">
                {taskStates[resultsModal].results?.styles &&
                taskStates[resultsModal].results.styles.length > 0 ? (
                  taskStates[resultsModal].results.styles.map(
                    (style: Style, index: number) => (
                      <div
                        key={index}
                        className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            {style.name || style.style || `Style ${index + 1}`}
                          </span>
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
                            {style.count || 0} images / 张
                          </span>
                        </div>
                        {style.description && (
                          <p className="text-sm text-gray-600">
                            {style.description}
                          </p>
                        )}
                        {style.colors && (
                          <div className="mt-2 flex gap-1">
                            {style.colors.map((color: string, i: number) => (
                              <div
                                key={i}
                                className="h-6 w-6 rounded-full border border-white shadow-sm"
                                style={{ backgroundColor: color }}
                                title={color}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  )
                ) : (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No styles identified / 未识别到风格
                  </p>
                )}
              </div>
            )}

            {/* 图片视觉主题 */}
            {resultsModal === 'images-cluster' && (
              <div className="space-y-3">
                {taskStates[resultsModal].results?.clusters &&
                taskStates[resultsModal].results.clusters.length > 0 ? (
                  taskStates[resultsModal].results.clusters.map(
                    (cluster: Cluster, index: number) => (
                      <div
                        key={index}
                        className="rounded-lg border border-gray-100 bg-gray-50 p-4"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            {cluster.theme ||
                              cluster.name ||
                              `Theme ${index + 1}`}
                          </span>
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">
                            {cluster.count || cluster.images?.length || 0}{' '}
                            images / 张
                          </span>
                        </div>
                        {cluster.description && (
                          <p className="text-sm text-gray-600">
                            {cluster.description}
                          </p>
                        )}
                        {cluster.keywords && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {cluster.keywords.map((kw: string, i: number) => (
                              <span
                                key={i}
                                className="rounded bg-violet-100/70 px-1.5 py-0.5 text-xs text-violet-700"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  )
                ) : (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No visual themes found / 未找到视觉主题
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
