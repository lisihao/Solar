'use client';

/**
 * SocialMissionPage — AI Social 任务详情主容器（PR-V7）
 *
 * 布局：
 *   Header: [← 返回] [icon] 任务标题 + meta  [状态 pill] [发布到草稿箱] [取消/删除]
 *   Body:   左 360px 可折叠 TeamRosterPanel + 右 flex-1 tabbed content
 *   Tabs:   任务列表 / 协作动态 / 输出报告 / 参考文献 / 算力消耗 / 发布
 *
 * 复用 agent-playground 组件，不修改任何 playground 文件。
 * 如 prop 签名不兼容，用最小适配层（props 转换）而非改原组件。
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  Crown,
  Download,
  ExternalLink,
  FileText,
  Monitor,
  Smartphone,
  Image as ImageIcon,
  Layers,
  ListChecks,
  PenTool,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import {
  MissionDetailFrame,
  MissionActionGroup,
  MissionControlCard,
  MissionTaskList,
  RoleCard,
  type MissionActionButtonSpec,
} from '@/components/common/mission-detail';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';
import { StatusBadge, type BadgeTone } from '@/components/ui/badges';
import {
  TeamTopologyCanvas,
  type TeamTopologyNode,
  type TeamTopologyConnection,
  type TeamNodeStatus,
} from '@/components/common/team-topology';
import {
  AgentInspector,
  type AgentInspectorAgent,
} from '@/components/common/agent-inspector';
import { cn } from '@/lib/utils/common';
import {
  deriveSocialView,
  socialAgentByRole,
  socialRoleLabel,
  latestThought,
  agentTools,
  type SocialStageStatus,
  type SocialStageView,
  type SocialMissionView,
  type SocialRoleStatus,
  type SocialTraceItem,
} from '@/lib/features/ai-social/derive-social';
import {
  sourceTypeLabel,
  internalSourceRoute,
} from '@/lib/features/ai-social/source-links';
import { SocialComputePanel } from './SocialComputePanel';
import { SocialFlowView } from './SocialFlowView';
import { statusToken } from '@/lib/design/tokens';
import { toast } from '@/stores';
import { isSafeHttpUrl } from '@/lib/utils/url';
import { Modal } from '@/components/ui/dialogs/Modal';
import DOMPurify from 'isomorphic-dompurify';
import { useSocialMissionStream } from '@/hooks/features/useSocialMissionStream';
import { useSocialTask } from '@/hooks/domain/useSocialTasks';
import {
  cancelSocialTask,
  retrySocialTask,
  getSocialMissionSnapshot,
} from '@/services/ai-social/task-api';
import { RefreshCw } from 'lucide-react';
import { SocialPublishPanel } from './SocialPublishPanel';
import {
  deriveSocialStages,
  deriveSocialStagesFromView,
} from '@/lib/features/ai-social/derive-social-stages';
import type {
  SocialContentTaskStatus,
  SocialMissionSnapshot,
} from '@/services/ai-social/task-types';
import { LoadingSkeleton } from '@/components/ui/states/LoadingState';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { ErrorState, ErrorInline } from '@/components/ui/states/ErrorState';
import { Tabs } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/feedback/Alert';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'tasks' | 'collab' | 'report' | 'references' | 'cost';

const TABS: { key: TabKey; label: string; Icon: typeof Activity }[] = [
  { key: 'tasks', label: '任务列表', Icon: ListChecks },
  { key: 'collab', label: '协作动态', Icon: Activity },
  { key: 'report', label: '输出报告', Icon: FileText },
  { key: 'references', label: '参考文献', Icon: Layers },
  { key: 'cost', label: '算力消耗', Icon: Coins },
];

// ─── Status pill config ───────────────────────────────────────────────────────

interface StatusConfig {
  label: string;
  dotClass: string;
  pillClass: string;
}

const STATUS_CONFIG: Record<SocialContentTaskStatus, StatusConfig> = {
  PENDING: {
    label: '等待中',
    dotClass: 'bg-gray-400',
    pillClass: 'bg-gray-100 text-gray-700',
  },
  GENERATING: {
    label: '生成中',
    dotClass: 'bg-blue-500 animate-pulse',
    pillClass: 'bg-blue-50 text-blue-700',
  },
  DRAFT_READY: {
    label: '草稿就绪',
    dotClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-50 text-emerald-700',
  },
  PUBLISHING: {
    label: '发布中',
    dotClass: 'bg-amber-500 animate-pulse',
    pillClass: 'bg-amber-50 text-amber-700',
  },
  PUBLISHED: {
    label: '已发布',
    dotClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-50 text-emerald-700',
  },
  PARTIAL_PUBLISHED: {
    label: '部分发布',
    dotClass: 'bg-amber-500',
    pillClass: 'bg-amber-50 text-amber-700',
  },
  FAILED: {
    label: '失败',
    dotClass: 'bg-red-500',
    pillClass: 'bg-red-50 text-red-700',
  },
  CANCELLED: {
    label: '已取消',
    dotClass: 'bg-gray-400',
    pillClass: 'bg-gray-100 text-gray-600',
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface SocialMissionPageProps {
  taskId: string;
}

// ─── Report sub-tab (WeChat / 小红书) ─────────────────────────────────────────

/** social 阶段状态 → 样式（任务列表 / roster 共用；animate-pulse 合规，非 spin） */
/** social 阶段状态 → canonical StatusBadge 的 tone + 文案（视觉 SSOT 在 StatusBadge）*/
const SOCIAL_STATUS_TONE: Record<
  SocialStageStatus,
  { tone: BadgeTone; label: string }
> = {
  pending: { tone: 'neutral', label: '待执行' },
  running: { tone: 'running', label: '进行中' },
  done: { tone: 'success', label: '已完成' },
  failed: { tone: 'danger', label: '失败' },
};

/** social 团队拓扑布局（playground 同款 canvas，业务定角色：Leader + 流水线工种） */
const SOCIAL_TEAM: {
  role: string;
  name: string;
  icon: LucideIcon;
  colorKey: string;
  row: number;
}[] = [
  { role: 'Leader', name: 'Leader', icon: Crown, colorKey: 'purple', row: 0 },
  { role: 'Steward', name: '预算管家', icon: Coins, colorKey: 'amber', row: 1 },
  { role: 'PlatformProbe', name: '平台探测', icon: Search, colorKey: 'blue', row: 1 }, // prettier-ignore
  { role: 'ContentTransformer', name: '内容转换', icon: Wand2, colorKey: 'indigo', row: 1 }, // prettier-ignore
  {
    role: 'CoverArtist',
    name: '封面',
    icon: ImageIcon,
    colorKey: 'pink',
    row: 1,
  },
  { role: 'Composer', name: '撰稿', icon: PenTool, colorKey: 'green', row: 1 },
  { role: 'PolishReviewer', name: '润色', icon: Sparkles, colorKey: 'rose', row: 2 }, // prettier-ignore
  { role: 'PublishExecutor', name: '发布', icon: Send, colorKey: 'emerald', row: 2 }, // prettier-ignore
  { role: 'PublishVerifier', name: '验证', icon: ShieldCheck, colorKey: 'blue', row: 2 }, // prettier-ignore
];

const SOCIAL_ROLE_NODE_STATUS: Record<string, TeamNodeStatus> = {
  idle: 'idle',
  working: 'working',
  done: 'completed',
  failed: 'failed',
};

/** 毫秒 → 人类可读耗时 */
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

/** 阶段耗时（startedAt→completedAt）；进行中/未开始给占位 */
function formatStageDuration(s: SocialStageView): string {
  if (s.startedAt != null && s.completedAt != null) {
    return formatDurationMs(s.completedAt - s.startedAt);
  }
  return s.status === 'running' ? '进行中' : '—';
}

/** social view → team-topology canvas（nodes/rows/connections），Leader 居顶 fan-out */
function buildSocialTopology(view: SocialMissionView): {
  nodes: TeamTopologyNode[];
  rows: string[][];
  connections: TeamTopologyConnection[];
} {
  const statusByRole = new Map(view.roles.map((r) => [r.role, r.status]));
  const nodes: TeamTopologyNode[] = SOCIAL_TEAM.map((m) => ({
    id: m.role,
    name: m.name,
    role: m.role,
    icon: m.icon,
    colorKey: m.colorKey,
    isLeader: m.role === 'Leader',
    status:
      SOCIAL_ROLE_NODE_STATUS[statusByRole.get(m.role) ?? 'idle'] ?? 'idle',
    statusLabel: statusByRole.get(m.role) === 'working' ? '进行中' : undefined,
  }));
  const rows: string[][] = [0, 1, 2].map((r) =>
    SOCIAL_TEAM.filter((m) => m.row === r).map((m) => m.role)
  );
  const connections: TeamTopologyConnection[] = SOCIAL_TEAM.filter(
    (m) => m.role !== 'Leader'
  ).map((m) => ({ from: 'Leader', to: m.role }));
  return { nodes, rows, connections };
}

/** colorKey → icon 容器配色（Tailwind 需字面量，故静态映射） */
const SOCIAL_ICON_CLASS: Record<string, string> = {
  purple: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
  blue: 'bg-sky-50 text-sky-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  pink: 'bg-pink-50 text-pink-600',
  green: 'bg-green-50 text-green-600',
  rose: 'bg-rose-50 text-rose-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

const SOCIAL_ROLE_STATUS_META: Record<
  SocialRoleStatus,
  { label: string; color: string }
> = {
  working: {
    label: statusToken.running.label,
    color: statusToken.running.text,
  },
  done: { label: statusToken.done.label, color: statusToken.done.text },
  failed: { label: statusToken.failed.label, color: statusToken.failed.text },
  idle: { label: statusToken.pending.label, color: statusToken.pending.text },
};

const TRACE_KIND_LABEL: Record<SocialTraceItem['kind'], string> = {
  thought: '思考',
  action: '行动',
  observation: '观察',
  reflection: '反思',
  error: '错误',
};

/**
 * social 角色节点 → 标准 AgentInspector 卡片数据。
 * 真实派生数据：角色状态 + 负责阶段及耗时 + 该角色 agent 的真实模型/工具/迭代/最近思考。
 * 高危角色（publish-executor/platform-probe）的 thought 已在 derive 层剥离，不会外泄凭证。
 */
function buildSocialInspectorPayload(
  roleId: string,
  view: SocialMissionView
): AgentInspectorAgent {
  const meta = SOCIAL_TEAM.find((m) => m.role === roleId);
  const role = view.roles.find((r) => r.role === roleId);
  const stages = view.stages.filter((s) => s.role === roleId);
  const statusMeta = SOCIAL_ROLE_STATUS_META[role?.status ?? 'idle'];
  const agent = socialAgentByRole(view, roleId);

  const running = stages.filter((s) => s.status === 'running').length;
  const completed = stages.filter((s) => s.status === 'done').length;
  const failed = stages.filter((s) => s.status === 'failed').length;

  const descs = Array.from(
    new Set(stages.map((s) => s.desc).filter((d): d is string => !!d))
  );

  // 已完成/失败的阶段附真实耗时，进行中/未开始只给名字
  const stageChips = stages.map((s) =>
    s.status === 'done' || s.status === 'failed'
      ? `${s.label} · ${formatStageDuration(s)}`
      : s.label
  );

  const config: NonNullable<AgentInspectorAgent['config']> = [];
  if (stageChips.length > 0)
    config.push({ label: '负责阶段', chips: stageChips });
  if (agent?.modelId) config.push({ label: '模型', value: agent.modelId });
  const tools = agentTools(agent);
  if (tools.length > 0) config.push({ label: '工具', chips: tools });
  if (agent?.wallTimeMs != null)
    config.push({ label: '耗时', value: formatDurationMs(agent.wallTimeMs) });

  return {
    name: meta?.name ?? role?.label ?? roleId,
    description: descs.length > 0 ? descs.join('；') : undefined,
    icon: meta?.icon ?? Sparkles,
    iconClassName:
      SOCIAL_ICON_CLASS[meta?.colorKey ?? ''] ?? 'bg-violet-50 text-violet-600',
    statusLabel: statusMeta.label,
    statusColorClass: statusMeta.color,
    instanceCounts: {
      running,
      completed,
      failed,
      iterations: agent?.iterations,
    },
    config: config.length > 0 ? config : undefined,
    recentThought: latestThought(agent),
  };
}

function ReportTab({
  task,
  onPublished,
}: {
  task: NonNullable<ReturnType<typeof useSocialTask>['task']>;
  onPublished?: () => void;
}) {
  const platforms = task.platforms ?? [];
  const [activePlatform, setActivePlatform] = useState(platforms[0] ?? '');

  const PLATFORM_LABELS: Record<string, string> = {
    WECHAT_MP: '微信公众号',
    XIAOHONGSHU: '小红书',
  };

  const [publishOpen, setPublishOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'phone' | 'wide'>('phone');
  const version = task.versions?.find((v) => v.platform === activePlatform);

  if (platforms.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        暂无平台版本
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* header：平台子 tab（左）+ 发布按钮（右，参考 playground 导出位置）*/}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          {platforms.length > 1 && (
            <Tabs
              variant="pill"
              size="sm"
              value={activePlatform}
              onChange={setActivePlatform}
              items={platforms.map((p) => ({
                key: p,
                label: PLATFORM_LABELS[p] ?? p,
              }))}
            />
          )}
          {/* 手机真机 / 宽屏 预览切换 */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
            <button
              type="button"
              onClick={() => setPreviewMode('phone')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                previewMode === 'phone'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <Smartphone className="h-3.5 w-3.5" />
              手机
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode('wide')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                previewMode === 'wide'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <Monitor className="h-3.5 w-3.5" />
              宽屏
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {version?.content && (
            <button
              type="button"
              onClick={() => {
                const text = version.content
                  .replace(/<[^>]+>/g, '')
                  .replace(/\n{3,}/g, '\n\n')
                  .trim();
                void navigator.clipboard.writeText(text).then(
                  () => toast.success('正文已复制，可粘贴到公众号编辑器'),
                  () => toast.error('复制失败')
                );
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Copy className="h-4 w-4" />
              复制正文
            </button>
          )}
          {version?.content && (
            <button
              type="button"
              onClick={() => {
                const safeTitle = version.title
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
                const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body>${DOMPurify.sanitize(version.content)}</body></html>`;
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${(version.title || 'article').slice(0, 50)}.html`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success('已下载文章 HTML');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              下载
            </button>
          )}
          <button
            type="button"
            onClick={() => setPublishOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700"
          >
            <Send className="h-4 w-4" />
            发布
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-gray-50">
        {version ? (
          <article
            className={cn(
              'mx-auto my-6 space-y-5 overflow-hidden bg-white',
              previewMode === 'phone'
                ? 'w-[400px] max-w-full rounded-[2rem] border-[6px] border-gray-900 px-4 py-6 shadow-2xl'
                : 'max-w-2xl rounded-2xl px-6 py-8 shadow-sm sm:px-10'
            )}
          >
            {version.coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={version.coverImageUrl}
                alt={version.title}
                className="aspect-[16/9] w-full rounded-xl object-cover"
              />
            )}
            <header className="space-y-2">
              <h1 className="text-2xl font-bold leading-snug text-gray-900">
                {version.title}
              </h1>
              {version.digest && (
                <p className="text-sm leading-relaxed text-gray-500">
                  {version.digest}
                </p>
              )}
            </header>
            {version.content && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                <span>
                  正文{' '}
                  {
                    version.content.replace(/<[^>]+>/g, '').replace(/\s/g, '')
                      .length
                  }{' '}
                  字
                </span>
                <span
                  className={cn(version.title.length > 64 && 'text-amber-600')}
                >
                  标题 {version.title.length}/64
                </span>
                {version.coverImageUrl ? (
                  <span className="text-emerald-600">封面已就绪</span>
                ) : (
                  <span className="text-amber-600">无封面</span>
                )}
              </div>
            )}
            {((version.tags && version.tags.length > 0) ||
              version.externalUrl) && (
              <div className="flex flex-wrap items-center gap-1.5 border-y border-gray-100 py-2.5">
                {version.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                  >
                    #{tag}
                  </span>
                ))}
                {isSafeHttpUrl(version.externalUrl) && (
                  <a
                    href={version.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline"
                  >
                    查看已发布
                    <ChevronRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            )}
            {version.content ? (
              <div
                className="prose prose-sm max-w-none leading-relaxed text-gray-800 [&_img]:my-3 [&_img]:w-full [&_img]:rounded-lg"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(version.content),
                }}
              />
            ) : (
              <div className="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-400">
                {task.status === 'FAILED'
                  ? '正文生成失败'
                  : task.status === 'CANCELLED'
                    ? '任务已取消，无正文'
                    : '正文生成中…'}
              </div>
            )}
          </article>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title={`${PLATFORM_LABELS[activePlatform] ?? activePlatform} 版本生成中`}
              description="任务完成后，这里会显示可直接发布到平台的文章——封面、标题、正文一应俱全。"
            />
          </div>
        )}
      </div>

      {/* 发布弹层（原「发布」tab 内容收进此按钮，参考 playground 导出）*/}
      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title="发布到草稿箱"
        size="lg"
      >
        <SocialPublishPanel task={task} onAction={() => onPublished?.()} />
      </Modal>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SocialMissionPage({ taskId }: SocialMissionPageProps) {
  const router = useRouter();
  const { task, isLoading, refresh } = useSocialTask(taskId, {
    refreshIntervalMs: 3000,
  });

  const missionId = task?.missionId ?? null;

  // Stream — only subscribes when missionId is available
  const { events, connState } = useSocialMissionStream(missionId);

  // 历史兜底：mission 结束、内存事件 buffer 过期（1h TTL）后实时 events 为空，
  // 拉持久化快照（算力 + 终态）回填，让结束后仍能看到算力/阶段历史（对标 playground persisted）。
  const [snapshot, setSnapshot] = useState<SocialMissionSnapshot | null>(null);
  useEffect(() => {
    const status = task?.status;
    if (!missionId || !status) {
      setSnapshot(null);
      return;
    }
    const terminal: SocialContentTaskStatus[] = [
      'DRAFT_READY',
      'PUBLISHED',
      'PARTIAL_PUBLISHED',
      'FAILED',
      'CANCELLED',
    ];
    if (!terminal.includes(status)) {
      // 运行中（含 rerun 回到 PENDING/GENERATING）→ 清掉旧快照，避免上一轮算力残留
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    getSocialMissionSnapshot(taskId)
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch(() => {
        /* 快照非关键：失败则退回纯实时视图 */
      });
    return () => {
      cancelled = true;
    };
  }, [missionId, task?.status, taskId]);

  // social 自己的派生（13 阶段 + 角色 + agent 轨迹 + 成本），喂左栏/节点卡/协作动态/算力
  const socialView = useMemo(
    () => deriveSocialView(events, snapshot),
    [events, snapshot]
  );

  // 运行中 header 实时秒表（"活着"的反馈，对标 playground「研究中·43s」）
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (socialView.status !== 'running') return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [socialView.status]);
  const elapsedMs = socialView.startedAt ? nowTs - socialView.startedAt : 0;

  const [activeTab, setActiveTab] = useState<TabKey>('tasks');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const selectedStage =
    socialView.stages.find((s) => s.stepId === selectedStageId) ?? null;
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const selectedStageAgent = selectedStage?.role
    ? socialAgentByRole(socialView, selectedStage.role)
    : undefined;
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Header — task title
  const taskTitle = useMemo(() => {
    if (!task) return '加载中…';
    const firstVersion = task.versions?.[0];
    return (
      firstVersion?.title ||
      task.title ||
      task.prompt?.slice(0, 60) ||
      `任务 ${taskId.slice(0, 8)}`
    );
  }, [task, taskId]);

  const statusConfig = task?.status
    ? STATUS_CONFIG[task.status]
    : STATUS_CONFIG['PENDING'];

  const canCancel = task?.status === 'PENDING' || task?.status === 'GENERATING';

  const handleCancel = async () => {
    if (!task || cancelling) return;
    setCancelling(true);
    try {
      await cancelSocialTask(task.id);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消失败，请重试');
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    if (!task || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await retrySocialTask(task.id);
      refresh();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  if (!taskId) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <p className="text-lg font-medium text-gray-700">无效的任务 ID</p>
          <button
            type="button"
            onClick={() => router.push('/ai-social')}
            className="mt-4 text-sm text-rose-600 hover:underline"
          >
            返回 AI Social
          </button>
        </div>
      </div>
    );
  }

  // ── 左 panel 底部按钮组（agent teams 规范：运行 / 发布 / 取消 常驻） ──
  // 运行中（PENDING/GENERATING/PUBLISHING）= 只给「取消」；终态 = 给「运行」(fresh 重跑) +
  // 草稿就绪/已发布再给「发布」入口（同号可反复发）。按钮区在任何状态都不为空。
  const isRunning =
    task?.status === 'PENDING' ||
    task?.status === 'GENERATING' ||
    task?.status === 'PUBLISHING';
  const canPublish =
    task?.status === 'DRAFT_READY' ||
    task?.status === 'PUBLISHED' ||
    task?.status === 'PARTIAL_PUBLISHED';

  const actionButtons: MissionActionButtonSpec[] = [];
  if (task && !isRunning) {
    actionButtons.push({
      variant: 'primary',
      label: retrying ? '启动中…' : '运行',
      title: 'fresh 重跑：沿用原素材 / 平台从头生成（覆盖旧草稿）',
      disabled: retrying,
      onClick: () => void handleRetry(),
    });
  }
  if (canPublish) {
    actionButtons.push({
      variant: 'secondary',
      label: task?.status === 'DRAFT_READY' ? '发布' : '再次发布',
      title: '到「输出报告」预览并发布到公众号（可对同一公众号多轮发布）',
      onClick: () => setActiveTab('report'),
    });
  }
  if (canCancel) {
    actionButtons.push({
      variant: 'danger',
      label: cancelling ? '取消中…' : '取消',
      title: '取消运行中的任务',
      disabled: cancelling,
      onClick: () => void handleCancel(),
    });
  }

  return (
    <MissionDetailFrame
      onBack={() => router.push('/ai-social')}
      backTitle="返回 AI Social"
      brandGradient="from-rose-500 to-pink-600"
      HeaderIcon={Send}
      title={
        isLoading ? <LoadingSkeleton lines={1} className="w-48" /> : taskTitle
      }
      subtitle={
        <>
          <span className="font-mono text-[10px]">{taskId.slice(0, 8)}</span>
          {task?.platforms && task.platforms.length > 0 && (
            <>
              <span>·</span>
              <span>
                {task.platforms
                  .map((p) =>
                    p === 'WECHAT_MP'
                      ? '微信公众号'
                      : p === 'XIAOHONGSHU'
                        ? '小红书'
                        : p
                  )
                  .join(' / ')}
              </span>
            </>
          )}
        </>
      }
      statusPill={
        task ? (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1',
              statusConfig.pillClass
            )}
          >
            <span
              className={cn('h-2 w-2 rounded-full', statusConfig.dotClass)}
            />
            <span className="text-xs font-medium">{statusConfig.label}</span>
            {socialView.status === 'running' && socialView.startedAt && (
              <span className="font-mono text-[11px] opacity-80">
                {formatDurationMs(elapsedMs)}
              </span>
            )}
          </div>
        ) : null
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      leftCollapsed={leftCollapsed}
      onLeftCollapseToggle={() => setLeftCollapsed((v) => !v)}
      leftPanel={
        <div className="flex h-full flex-col">
          {missionId ? (
            <>
              {/* 固定顶部：组织阵型 + 进度（不随关键角色滚动） */}
              <div className="shrink-0 border-b border-gray-100 p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      SOCIAL TEAM
                    </p>
                    <button
                      type="button"
                      onClick={() => setLeftCollapsed(true)}
                      className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      title="收起"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                  </div>
                  {socialView.roles.length > 0 ? (
                    <TeamTopologyCanvas
                      {...buildSocialTopology(socialView)}
                      heightClass="h-[176px]"
                      renderDetail={(node, onClose) => (
                        <AgentInspector
                          open
                          onClose={onClose}
                          mode="modal"
                          agent={buildSocialInspectorPayload(
                            node.id,
                            socialView
                          )}
                        />
                      )}
                    />
                  ) : (
                    <p className="text-xs text-gray-400">
                      团队将在任务启动后展示
                    </p>
                  )}
                  <div className="space-y-1 pt-0.5">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>进度</span>
                      <span className="font-mono">
                        {socialView.progress.done}/{socialView.progress.total}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rose-400 to-pink-500 transition-all"
                        style={{
                          width: `${
                            socialView.progress.total > 0
                              ? Math.round(
                                  (socialView.progress.done /
                                    socialView.progress.total) *
                                    100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              {/* 滚动：关键角色 + 算力消耗 */}
              <div className="flex-1 divide-y divide-gray-100 overflow-y-auto">
                {socialView.roles.length > 0 && (
                  <div className="space-y-1.5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      关键角色
                    </p>
                    {socialView.roles.map((r) => {
                      const meta = SOCIAL_TEAM.find((m) => m.role === r.role);
                      const roleStages = socialView.stages.filter(
                        (s) => s.role === r.role
                      );
                      const doneStages = roleStages.filter(
                        (s) => s.status === 'done'
                      ).length;
                      const agent = socialAgentByRole(socialView, r.role);
                      const caption =
                        latestThought(agent) ??
                        roleStages.find((s) => s.status === 'running')?.desc ??
                        undefined;
                      return (
                        <RoleCard
                          key={r.role}
                          label={r.label}
                          icon={meta?.icon ?? Sparkles}
                          iconClass={
                            SOCIAL_ICON_CLASS[meta?.colorKey ?? ''] ??
                            'bg-gray-50 text-gray-600'
                          }
                          status={
                            r.status === 'working'
                              ? 'running'
                              : r.status === 'done'
                                ? 'completed'
                                : r.status === 'failed'
                                  ? 'failed'
                                  : 'idle'
                          }
                          completedCount={doneStages}
                          totalCount={roleStages.length}
                          caption={caption}
                          onClick={() => setSelectedRoleId(r.role)}
                        />
                      );
                    })}
                  </div>
                )}
                {(socialView.cost.tokensUsed > 0 ||
                  socialView.cost.costUsd > 0) && (
                  <div className="p-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      算力消耗
                    </p>
                    <div className="space-y-1 text-xs text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Tokens</span>
                        <span className="font-mono">
                          {socialView.cost.tokensUsed.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>费用</span>
                        <span className="font-mono">
                          ${socialView.cost.costUsd.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4">
              <EmptyState
                size="sm"
                title="任务尚未关联 Mission"
                description="生成开始后团队信息将在此展示"
              />
            </div>
          )}
          {/* Action buttons - sticky 底部（playground 标杆位置） */}
          {task && (
            <MissionControlCard
              title="任务配置"
              statusLabel={statusConfig.label}
              statusTone={
                task.status === 'FAILED'
                  ? 'red'
                  : task.status === 'CANCELLED'
                    ? 'gray'
                    : task.status === 'PUBLISHED' ||
                        task.status === 'PARTIAL_PUBLISHED'
                      ? 'green'
                      : socialView.status === 'running'
                        ? 'blue'
                        : 'violet'
              }
              className="mx-4 mb-4 mt-0"
            >
              <div className="space-y-3">
                {task.platforms && task.platforms.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-gray-500">
                      发布平台
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {task.platforms.map((platform) => (
                        <span
                          key={platform}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700"
                        >
                          {platform === 'WECHAT_MP'
                            ? '微信公众号'
                            : platform === 'XIAOHONGSHU'
                              ? '小红书'
                              : platform}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1 text-[11px] text-gray-600">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">来源数</span>
                    <span className="font-mono text-gray-500">
                      {task.sources?.length ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">版本数</span>
                    <span className="font-mono text-gray-500">
                      {task.versions?.length ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            </MissionControlCard>
          )}
          {actionButtons.length > 0 && (
            <div className="border-t border-gray-100 p-4">
              <MissionActionGroup buttons={actionButtons} />
            </div>
          )}
          {/* 关键角色点击 → 标准节点详情卡（与拓扑图点击同款） */}
          {selectedRoleId && (
            <AgentInspector
              open
              onClose={() => setSelectedRoleId(null)}
              mode="modal"
              agent={buildSocialInspectorPayload(selectedRoleId, socialView)}
            />
          )}
        </div>
      }
    >
      {/* 实时连接降级提示（断流静默 → 用户误判卡死，对标 playground connState banner）*/}
      {missionId &&
        socialView.status === 'running' &&
        (connState === 'polling' || connState === 'disconnected') && (
          <Alert tone="warn" className="mx-4 mt-3">
            {connState === 'polling'
              ? '实时连接已降级为轮询，进度更新可能有几秒延迟。'
              : '实时连接已断开，正在重连…进度可能暂停更新。'}
          </Alert>
        )}

      {/* === Tab content === */}
      {activeTab === 'tasks' && (
        <>
          {task?.status === 'FAILED' ? (
            <div className="flex h-full items-center justify-center p-8">
              <div className="w-full max-w-md space-y-3">
                <ErrorState
                  title="任务执行失败"
                  error={
                    task.errorMessage ??
                    'AI Teams 在生成过程中遇到错误，未能输出内容。'
                  }
                  onRetry={retrying ? undefined : () => void handleRetry()}
                />
                {retryError && (
                  <ErrorInline message={`重试失败：${retryError}`} />
                )}
              </div>
            </div>
          ) : missionId ? (
            <>
              <MissionTaskList<SocialStageView>
                items={socialView.stages}
                getRowKey={(s) => s.stepId}
                selectedKey={selectedStageId}
                onRowClick={(s) => setSelectedStageId(s.stepId)}
                getRowClassName={(s) =>
                  cn(
                    s.status === 'running' &&
                      'border-l-4 border-l-blue-400 bg-blue-50/40',
                    s.status === 'done' && 'border-l-4 border-l-emerald-400',
                    s.status === 'failed' &&
                      'border-l-4 border-l-red-400 bg-red-50/30',
                    s.status === 'pending' && 'border-l-4 border-l-transparent'
                  )
                }
                emptyTitle="等待任务启动"
                emptyDescription="任务刚被创建，协作管线正在初始化。各阶段会实时出现在此处。"
                columns={[
                  {
                    key: 'idx',
                    label: '#',
                    className: 'w-12 text-gray-400',
                    render: (_s, i) => i + 1,
                  },
                  {
                    key: 'stage',
                    label: '阶段',
                    render: (s) => {
                      const Icon =
                        SOCIAL_TEAM.find((m) => m.role === s.role)?.icon ??
                        Sparkles;
                      return (
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-gray-900">
                              {s.label}
                            </div>
                            {s.desc && (
                              <div className="truncate text-xs text-gray-400">
                                {s.desc}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    },
                  },
                  {
                    key: 'role',
                    label: '角色',
                    render: (s) =>
                      s.role ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {SOCIAL_TEAM.find((m) => m.role === s.role)?.name ??
                            socialRoleLabel(s.role)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      ),
                  },
                  {
                    key: 'model',
                    label: '模型',
                    className: 'w-36',
                    render: (s) => {
                      const a = s.role
                        ? socialAgentByRole(socialView, s.role)
                        : undefined;
                      return a?.modelId ? (
                        <span className="font-mono block truncate text-xs text-gray-600">
                          {a.modelId}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      );
                    },
                  },
                  {
                    key: 'tools',
                    label: '工具',
                    className: 'w-16 text-gray-500',
                    render: (s) => {
                      const a = s.role
                        ? socialAgentByRole(socialView, s.role)
                        : undefined;
                      const n = agentTools(a).length;
                      return n > 0 ? (
                        <span className="text-xs">{n} 个</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      );
                    },
                  },
                  {
                    key: 'iters',
                    label: '迭代',
                    className: 'w-14 text-right text-gray-500',
                    render: (s) => {
                      const a = s.role
                        ? socialAgentByRole(socialView, s.role)
                        : undefined;
                      return a?.iterations != null ? (
                        <span className="font-mono text-xs">
                          {a.iterations}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      );
                    },
                  },
                  {
                    key: 'status',
                    label: '状态',
                    className: 'w-28',
                    render: (s) => (
                      <StatusBadge
                        tone={SOCIAL_STATUS_TONE[s.status].tone}
                        label={SOCIAL_STATUS_TONE[s.status].label}
                        dot
                      />
                    ),
                  },
                  {
                    key: 'duration',
                    label: '耗时',
                    className: 'w-20 text-gray-500',
                    render: (s) => formatStageDuration(s),
                  },
                ]}
              />
              <SideDrawer
                open={selectedStage !== null}
                onClose={() => setSelectedStageId(null)}
                title={selectedStage?.label ?? '任务明细'}
              >
                {selectedStage && (
                  <div className="space-y-4">
                    {selectedStage.desc && (
                      <p className="text-sm leading-relaxed text-gray-600">
                        {selectedStage.desc}
                      </p>
                    )}
                    <dl className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <dt className="w-16 shrink-0 text-gray-500">角色</dt>
                        <dd className="font-medium text-gray-900">
                          {SOCIAL_TEAM.find(
                            (m) => m.role === selectedStage.role
                          )?.name ??
                            selectedStage.role ??
                            '—'}
                        </dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className="w-16 shrink-0 text-gray-500">状态</dt>
                        <dd>
                          <StatusBadge
                            tone={SOCIAL_STATUS_TONE[selectedStage.status].tone}
                            label={
                              SOCIAL_STATUS_TONE[selectedStage.status].label
                            }
                            dot
                          />
                        </dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className="w-16 shrink-0 text-gray-500">耗时</dt>
                        <dd className="font-mono text-gray-700">
                          {formatStageDuration(selectedStage)}
                        </dd>
                      </div>
                      {selectedStageAgent?.modelId && (
                        <div className="flex items-center gap-2">
                          <dt className="w-16 shrink-0 text-gray-500">模型</dt>
                          <dd className="font-mono text-gray-700">
                            {selectedStageAgent.modelId}
                          </dd>
                        </div>
                      )}
                      {selectedStageAgent?.iterations != null && (
                        <div className="flex items-center gap-2">
                          <dt className="w-16 shrink-0 text-gray-500">迭代</dt>
                          <dd className="font-mono text-gray-700">
                            {selectedStageAgent.iterations}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {agentTools(selectedStageAgent).length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          工具
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {agentTools(selectedStageAgent).map((t) => (
                            <span
                              key={t}
                              className="font-mono rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {latestThought(selectedStageAgent) && (
                      <div className="rounded-lg bg-amber-50/60 px-3 py-2">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          最近思考
                        </p>
                        <p className="break-words text-xs leading-relaxed text-amber-900">
                          {latestThought(selectedStageAgent)}
                        </p>
                      </div>
                    )}

                    {selectedStageAgent &&
                      selectedStageAgent.trace.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            执行轨迹
                          </p>
                          <ol className="space-y-1.5">
                            {selectedStageAgent.trace.map((it, i) => (
                              <li
                                key={`${it.kind}-${it.ts}-${i}`}
                                className="flex gap-2 text-xs"
                              >
                                <span
                                  className={cn(
                                    'mt-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium',
                                    it.kind === 'thought' &&
                                      'bg-violet-50 text-violet-600',
                                    it.kind === 'action' &&
                                      'bg-sky-50 text-sky-600',
                                    it.kind === 'observation' &&
                                      'bg-emerald-50 text-emerald-600',
                                    it.kind === 'reflection' &&
                                      'bg-amber-50 text-amber-600',
                                    it.kind === 'error' &&
                                      'bg-red-50 text-red-600'
                                  )}
                                >
                                  {TRACE_KIND_LABEL[it.kind]}
                                </span>
                                <span className="min-w-0 flex-1 break-words text-gray-600">
                                  {it.text ??
                                    it.toolId ??
                                    it.error ??
                                    (it.tokensUsed != null
                                      ? `${it.tokensUsed} tokens`
                                      : '—')}
                                  {it.latencyMs != null && (
                                    <span className="ml-1 text-gray-400">
                                      · {formatDurationMs(it.latencyMs)}
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                    {selectedStage.error && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {selectedStage.error}
                      </div>
                    )}
                  </div>
                )}
              </SideDrawer>
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState
                icon={<ListChecks className="h-12 w-12" />}
                title="等 Leader 拆完进度"
                description="任务刚被创建，协作管线正在初始化。拆解完成后，各阶段会实时出现在此处。"
              />
            </div>
          )}
        </>
      )}

      {activeTab === 'collab' && (
        <>
          {missionId ? (
            <SocialFlowView
              view={socialView}
              events={events}
              stepperStages={
                events.length > 0
                  ? deriveSocialStages(events)
                  : deriveSocialStagesFromView(socialView.stages)
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState
                icon={<Activity className="h-12 w-12" />}
                title="协作动态"
                description="任务执行时，团队的思考、工具调用与阶段进展会实时编织成时间线。"
              />
            </div>
          )}
        </>
      )}

      {activeTab === 'report' && task && (
        <ReportTab task={task} onPublished={refresh} />
      )}

      {activeTab === 'references' && (
        <div className="space-y-3 overflow-auto p-6">
          {task?.sources && task.sources.length > 0 ? (
            <>
              <p className="text-sm text-gray-600">
                本内容基于 {task.sources.length} 个来源生成
              </p>
              <ul className="space-y-2">
                {task.sources.map((s) => {
                  const internalHref = internalSourceRoute(
                    s.sourceType,
                    s.sourceId
                  );
                  const externalHref = isSafeHttpUrl(s.url) ? s.url : null;
                  return (
                    <li
                      key={s.id}
                      className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* 标题本身即链接：内链优先（站内详情），否则外链 */}
                        {internalHref ? (
                          <Link
                            href={internalHref}
                            className="block truncate text-sm font-medium text-gray-900 hover:text-rose-600 hover:underline"
                          >
                            {s.title || s.sourceId}
                          </Link>
                        ) : externalHref ? (
                          <a
                            href={externalHref}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-medium text-gray-900 hover:text-rose-600 hover:underline"
                          >
                            {s.title || s.sourceId}
                          </a>
                        ) : (
                          <div className="truncate text-sm font-medium text-gray-900">
                            {s.title || s.sourceId}
                          </div>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5">
                            {sourceTypeLabel(s.sourceType)}
                          </span>
                          {internalHref && (
                            <Link
                              href={internalHref}
                              className="inline-flex items-center gap-0.5 text-rose-600 hover:underline"
                            >
                              查看来源
                              <ChevronRight className="h-3 w-3" />
                            </Link>
                          )}
                          {externalHref && (
                            <a
                              href={externalHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-rose-600 hover:underline"
                            >
                              原文
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {!internalHref && !externalHref && (
                            <span className="text-gray-300">无可用链接</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <EmptyState
              size="sm"
              icon={<FileText className="h-8 w-8" />}
              title="本任务未关联外部来源"
            />
          )}
        </div>
      )}

      {activeTab === 'cost' && missionId && (
        <SocialComputePanel view={socialView} />
      )}

      {activeTab === 'cost' && !missionId && (
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            icon={<Coins className="h-12 w-12" />}
            title="算力消耗"
            description="任务执行后，token 消耗、模型与工具延迟会在此汇总。"
          />
        </div>
      )}
    </MissionDetailFrame>
  );
}
