'use client';

/**
 * MissionGalleryView (R-CA 2026-05-05)
 *
 * Playground 主页 + 每个 custom agent 主页共享的 mission 网格视图。
 * 抽自 frontend/app/agent-playground/page.tsx，让 /agent-playground 和
 * /custom-agents/:id 两个入口 UI 100% 一致，差别只在数据源 + header。
 *
 * 调用方传入：
 *   - 数据源（fetchMissions） + mission 操作 callbacks（rerun/cancel/edit/delete）
 *   - header 配置（icon gradient、title、subtitle、createButtonLabel + onCreate）
 *   - emptyState 文案（首次为空时引导）
 *
 * 内部封装：搜索 / 卡片网格 / dashed 占位卡 / 加载态 / 错误态。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Coins,
  Globe,
  Lock,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react';
import { ErrorState } from '@/components/ui/states/ErrorState';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states/LoadingState';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/form/Input';
import { CreateCard } from '@/components/ui/cards/CreateCard';
import {
  AssetCard,
  type AssetCardBadge,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import SignInPrompt from '@/components/common/SignInPrompt';
import { isAuthenticated } from '@/lib/utils/auth';
import type { MissionListItem } from '@/services/agent-playground/api';

// 把 fetch 抛出的错误归类为"未授权"——后端用 `Failed to list missions: 401`
// 这类字符串，旁路 isAuthError 的 sign-in/unauthorized 关键词检测。
function isUnauthorizedMessage(msg: string | null): boolean {
  if (!msg) return false;
  return (
    /\b401\b/.test(msg) || /unauthorized|not authenticated|sign in/i.test(msg)
  );
}

// ─── 共享 status / depth 视觉配置 ──────────────────────────────────────────
const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  completed: {
    label: '已完成',
    color: 'bg-emerald-50 text-emerald-700',
    icon: CheckCircle2,
  },
  failed: { label: '失败', color: 'bg-red-50 text-red-700', icon: XCircle },
  running: {
    label: '进行中',
    color: 'bg-blue-50 text-blue-700',
    icon: Loader2,
  },
  rejected: {
    label: '已拒绝',
    color: 'bg-amber-50 text-amber-700',
    icon: XCircle,
  },
  cancelled: {
    label: '已取消',
    color: 'bg-gray-100 text-gray-700',
    icon: XCircle,
  },
  'quality-failed': {
    label: '质量未达标',
    color: 'bg-amber-50 text-amber-700',
    icon: XCircle,
  },
};

const DEPTH_GRADIENT: Record<string, string> = {
  quick: 'from-emerald-500 to-teal-600',
  standard: 'from-violet-500 to-purple-600',
  deep: 'from-rose-500 to-pink-600',
};

const VISIBILITY_OPTIONS: Record<AssetVisibility, AssetVisibilityOption> = {
  PRIVATE: {
    value: 'PRIVATE',
    label: '私有',
    icon: <Lock className="h-3 w-3" />,
    className: 'bg-gray-100 text-gray-600',
  },
  SHARED: {
    value: 'SHARED',
    label: '共享',
    icon: <Users className="h-3 w-3" />,
    className: 'bg-blue-100 text-blue-600',
  },
  PUBLIC: {
    value: 'PUBLIC',
    label: '公开',
    icon: <Globe className="h-3 w-3" />,
    className: 'bg-green-100 text-green-600',
  },
};

// ─── MissionCard（抽自 PlaygroundIndexPage）────────────────────────────────
function MissionCard({
  mission,
  onClick,
  onEdit,
  onDelete,
  onVisibilityChange,
}: {
  mission: MissionListItem;
  onClick: () => void;
  onEdit: (mission: MissionListItem) => void;
  onDelete: (mission: MissionListItem) => void;
  onVisibilityChange?: (
    mission: MissionListItem,
    next: AssetVisibility
  ) => void;
}) {
  // ★ 2026-05-06: 后端字段可能为 null（DB 老数据 / mission 启动失败 partial）→ 防 toUpperCase / DEPTH_GRADIENT[null] 触发 ErrorBoundary
  const safeStatus = mission.status || 'running';
  const safeDepth = mission.depth || 'standard';
  const safeLanguage = mission.language || 'zh';
  const status = STATUS_CONFIG[safeStatus] ?? STATUS_CONFIG.running;
  const StatusIcon = status.icon;
  const gradient = DEPTH_GRADIENT[safeDepth] ?? DEPTH_GRADIENT.standard;

  const badges: AssetCardBadge[] = [
    {
      key: 'depth',
      label: safeDepth.toUpperCase(),
      className: 'bg-gray-100 text-gray-600 uppercase tracking-wide',
    },
    {
      key: 'language',
      label: safeLanguage,
      className: 'bg-gray-100 text-gray-600',
    },
    {
      key: 'status',
      label: status.label,
      className: status.color,
      icon: (
        <StatusIcon
          className={`h-3 w-3 ${safeStatus === 'running' ? 'animate-spin' : ''}`}
        />
      ),
    },
  ];
  // 2026-05-13 #67: 删除"可继续"徽章 —— 续跑入口迁到详情页的更新按钮

  const description = mission.reportSummary
    ? mission.reportSummary
    : mission.errorMessage
      ? mission.errorMessage
      : mission.status === 'running'
        ? 'Mission 进行中…'
        : '暂无报告';

  const stats = [];
  if (mission.tokensUsed != null && mission.tokensUsed > 0) {
    stats.push({
      key: 'tokens',
      icon: <Coins className="h-3.5 w-3.5" />,
      text:
        mission.tokensUsed >= 1000
          ? `${(mission.tokensUsed / 1000).toFixed(1)}k tk`
          : `${mission.tokensUsed} tk`,
    });
  }
  if (mission.finalScore != null) {
    stats.push({
      key: 'score',
      icon: <Trophy className="h-3.5 w-3.5" />,
      text: (
        <span
          className={
            mission.finalScore >= 80
              ? 'text-emerald-600'
              : mission.finalScore >= 60
                ? 'text-amber-600'
                : 'text-red-600'
          }
        >
          {mission.finalScore} / 100
        </span>
      ),
    });
  }
  if (mission.elapsedWallTimeMs != null) {
    stats.push({
      key: 'time',
      icon: <Activity className="h-3.5 w-3.5" />,
      text: `${(mission.elapsedWallTimeMs / 1000).toFixed(1)}s`,
    });
  }

  return (
    <AssetCard
      title={mission.topic}
      description={description}
      icon={<Sparkles className="h-6 w-6 text-white" />}
      gradient={gradient}
      badges={badges}
      isOwner
      visibility={mission.visibility}
      visibilityOptions={VISIBILITY_OPTIONS}
      visibilityToggleCycle={['PRIVATE', 'SHARED', 'PUBLIC']}
      onVisibilityToggle={
        onVisibilityChange
          ? (next) => onVisibilityChange(mission, next)
          : undefined
      }
      onEdit={() => onEdit(mission)}
      onDelete={() => onDelete(mission)}
      onClick={onClick}
      stats={stats}
      timestamp={mission.startedAt}
      labels={{ edit: '重命名', delete: '删除' }}
    />
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────────
export interface MissionGalleryViewProps {
  /** Header 标题（"Agent Playground" / agent.displayName） */
  title: string;
  /** Header 副标题 */
  subtitle: string;
  /** Header icon 渐变（默认 violet→purple） */
  iconGradient?: string;
  /** Header icon 方块阴影颜色（默认 violet/25，custom-agents 用 rose 时必传） */
  iconShadowClass?: string;
  /** "新建 Mission" 按钮文案 */
  createButtonLabel?: string;
  /** 点 "新建 Mission" 触发 */
  onCreateMission: () => void;
  /**
   * 可选「一键清理已结束」：传入则在 header 显示清理按钮（opt-in，不传不显示，
   * 故 Topic Insights / Custom Agents 等其它消费方默认不受影响）。
   * 由调用方负责确认弹层 + 结果 toast；组件只负责调用后刷新列表。
   */
  onCleanup?: () => Promise<void> | void;
  /** 清理按钮文案（默认"清理已结束"） */
  cleanupButtonLabel?: string;
  /** 数据源：返回 mission 列表 */
  fetchMissions: () => Promise<MissionListItem[]>;
  /** mission 卡片点击：跳详情 */
  onMissionClick: (mission: MissionListItem) => void;
  /** 重命名 / 删除 callback */
  onEdit: (mission: MissionListItem) => Promise<void> | void;
  onDelete: (mission: MissionListItem) => Promise<void> | void;
  /** 多租户可见性切换（权限：私有/共享/公开）。 */
  onVisibilityChange?: (
    mission: MissionListItem,
    next: AssetVisibility
  ) => Promise<void> | void;
  /** Empty state 文案 */
  emptyState?: {
    title: string;
    hint: string;
    ctaLabel: string;
  };
  /** 列表为空时显示给用户的 "用什么标签搜索" 占位（默认按 topic / 报告内容搜） */
  searchPlaceholder?: string;
  /** 强制 reload 触发器（外部 inc 后组件 re-fetch）*/
  reloadKey?: number;
  /** 列表区标题（默认"我的任务"；company 侧传"专家任务"）。 */
  listHeading?: string;
  /** 隐藏大页头（嵌入「我的团队」双 Tab 时用）：只保留搜索 + 新建工具条。 */
  hideHeader?: boolean;
}

export function MissionGalleryView({
  title,
  subtitle,
  iconGradient = 'from-violet-500 to-purple-600',
  iconShadowClass,
  createButtonLabel = '新建 Mission',
  onCreateMission,
  onCleanup,
  cleanupButtonLabel = '清理已结束',
  fetchMissions,
  onMissionClick,
  onEdit,
  onDelete,
  onVisibilityChange,
  emptyState,
  searchPlaceholder = '按 topic 或报告内容搜索…',
  reloadKey = 0,
  listHeading = '我的任务',
  hideHeader = false,
}: MissionGalleryViewProps) {
  const [missions, setMissions] = useState<MissionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [internalReload, setInternalReload] = useState(0);
  // null = 客户端尚未挂载（SSR / 首屏），避免渲染期访问 localStorage 与服务端不一致。
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ok = isAuthenticated();
    setAuthed(ok);
    if (!ok) {
      setLoading(false);
      setError(null);
      setMissions([]);
      return;
    }
    setLoading(true);
    fetchMissions()
      .then((items) => {
        if (!cancelled) {
          setMissions(items);
          setError(null);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchMissions, reloadKey, internalReload]);

  // 未登录（首次访问） 或 token 过期被后端 401 → 都走登录引导而不是通用错误框。
  const showSignInPrompt = authed === false || isUnauthorizedMessage(error);

  // 2026-05-13 #67: 删除 resumable 列表抓取 —— 续跑入口迁到详情页

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return missions;
    const q = searchQuery.toLowerCase();
    return missions.filter(
      (m) =>
        m.topic?.toLowerCase().includes(q) ||
        m.reportSummary?.toLowerCase().includes(q) ||
        m.reportTitle?.toLowerCase().includes(q)
    );
  }, [missions, searchQuery]);

  const triggerReload = () => setInternalReload((n) => n + 1);

  const wrapAction =
    (fn: (m: MissionListItem) => Promise<void> | void) =>
    async (m: MissionListItem) => {
      await fn(m);
      triggerReload();
    };

  const handleEdit = wrapAction(onEdit);
  const handleDelete = wrapAction(onDelete);
  const handleCleanup = onCleanup
    ? async () => {
        await onCleanup();
        triggerReload();
      }
    : undefined;
  const handleVisibilityChange = onVisibilityChange
    ? async (m: MissionListItem, next: AssetVisibility) => {
        await onVisibilityChange(m, next);
        triggerReload();
      }
    : undefined;

  return (
    <div
      className={`h-full min-w-0 flex-1 overflow-auto ${hideHeader ? '' : 'bg-gray-50'}`}
    >
      {hideHeader ? (
        /* 嵌入模式：无大页头，只留搜索 + 新建工具条 */
        <div className="flex items-center gap-3 px-8 pt-5">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="rounded-xl py-3 pl-12"
            />
          </div>
          {!showSignInPrompt && handleCleanup && (
            <Button variant="outline" onClick={() => void handleCleanup()}>
              <Trash2 className="mr-2 h-5 w-5" />
              {cleanupButtonLabel}
            </Button>
          )}
          {!showSignInPrompt && (
            <Button onClick={onCreateMission}>
              <Plus className="mr-2 h-5 w-5" />
              {createButtonLabel}
            </Button>
          )}
        </div>
      ) : (
        /* Header — 走公共 PageHeaderHero */
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/50 backdrop-blur-sm">
          <PageHeaderHero
            title={title}
            subtitle={subtitle}
            icon={<Sparkles className="h-7 w-7 text-white" />}
            iconGradient={iconGradient}
            iconShadowClass={iconShadowClass}
            actions={
              showSignInPrompt ? null : (
                <div className="flex items-center gap-2">
                  {handleCleanup && (
                    <Button
                      variant="outline"
                      onClick={() => void handleCleanup()}
                    >
                      <Trash2 className="mr-2 h-5 w-5" />
                      {cleanupButtonLabel}
                    </Button>
                  )}
                  <Button onClick={onCreateMission}>
                    <Plus className="mr-2 h-5 w-5" />
                    {createButtonLabel}
                  </Button>
                </div>
              )
            }
          >
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="rounded-xl py-3 pl-12"
              />
            </div>
          </PageHeaderHero>
        </div>
      )}

      {/* Body */}
      <div className="px-8 py-6">
        {showSignInPrompt ? (
          <SignInPrompt
            title="登录后查看你的 Mission"
            description="登录或注册后即可启动多智能体研究 mission、查看历史记录与结果"
          />
        ) : loading ? (
          <LoadingState text="加载 mission 历史…" />
        ) : error ? (
          <ErrorState error={error} title="加载失败" onRetry={triggerReload} />
        ) : filtered.length === 0 ? (
          <EmptyState
            type="noData"
            icon={<Sparkles className="h-10 w-10 text-gray-300" />}
            title={
              missions.length === 0
                ? (emptyState?.title ?? '还没有 Mission')
                : '没有匹配项'
            }
            description={
              missions.length === 0
                ? (emptyState?.hint ??
                  '基于 Harness runtime 启动你的第一个研究 mission')
                : '换个关键字试试'
            }
            action={
              missions.length === 0
                ? {
                    label: emptyState?.ctaLabel ?? '启动研究 Mission',
                    onClick: onCreateMission,
                  }
                : undefined
            }
          />
        ) : (
          <>
            {/* 2026-05-13 #67: 删除"可继续 banner" —— 续跑入口迁到详情页 */}
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                {searchQuery ? '搜索结果' : listHeading}
              </h2>
              <span className="text-xs text-gray-500">
                共 {filtered.length} 个
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((m) => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  onClick={() => onMissionClick(m)}
                  onEdit={(mm) => void handleEdit(mm)}
                  onDelete={(mm) => void handleDelete(mm)}
                  onVisibilityChange={
                    handleVisibilityChange
                      ? (mm, next) => void handleVisibilityChange(mm, next)
                      : undefined
                  }
                />
              ))}
              <CreateCard title={createButtonLabel} onClick={onCreateMission} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
