'use client';

/**
 * TasksTab — AI 社媒主页列表（canonical AssetCard 卡片网格）
 *
 * 对齐全站主页（Research/Writing/Library/Playground）：搜索框（无过滤 chip）+
 * AssetCard 标准模板（icon 渐变 + badges 含状态 + 描述 + stats + 时间戳 + hover 操作）
 * + dashed CreateCard。卡片配置与 playground MissionGallery View 的 MissionCard 同构。
 *
 * 数据源：useSocialTasks（GET /ai-social/tasks 轮询 5s）；点卡片 → /ai-social/mission/{id}
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Inbox,
  BookMarked,
  Compass,
  FlaskConical,
  PenLine,
  FileText,
  Lightbulb,
  Bot,
  Radar,
  Link2,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import {
  AssetCard,
  type AssetCardBadge,
  type AssetCardStat,
} from '@/components/ui/cards/asset-card';
import { CreateCard } from '@/components/ui/cards/CreateCard';
import type { BadgeTone } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui/states';
import { ErrorInline } from '@/components/ui/states/ErrorState';
import { useTranslation } from '@/lib/i18n';
import {
  useSocialTasks,
  cancelTaskAndRefresh,
} from '@/hooks/domain/useSocialTasks';
import { renameSocialTask } from '@/services/ai-social/task-api';
import type {
  SocialContentTask,
  SocialContentTaskStatus,
} from '@/services/ai-social/task-types';
import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';

// 任务状态 → 状态徽章（icon/文案/色调）
const STATUS_META: Record<
  SocialContentTaskStatus,
  { tone: BadgeTone; icon: LucideIcon; label: string; spin?: boolean }
> = {
  PENDING: { tone: 'neutral', icon: Inbox, label: '待启动' },
  GENERATING: { tone: 'running', icon: Loader2, label: '生成中', spin: true },
  DRAFT_READY: { tone: 'success', icon: CheckCircle2, label: '草稿就绪' },
  PUBLISHING: { tone: 'warning', icon: Loader2, label: '发布中', spin: true },
  PUBLISHED: { tone: 'success', icon: CheckCircle2, label: '已发布' },
  PARTIAL_PUBLISHED: {
    tone: 'warning',
    icon: AlertTriangle,
    label: '部分发布',
  },
  FAILED: { tone: 'danger', icon: XCircle, label: '失败' },
  CANCELLED: { tone: 'neutral', icon: XCircle, label: '已取消' },
};

// 状态色调 → AssetCardBadge className（与 playground MissionGalleryView 同款，走 badge API）
const TONE_BADGE: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  running: 'bg-blue-50 text-blue-700',
  danger: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-700',
  info: 'bg-violet-50 text-violet-700',
  neutral: 'bg-gray-100 text-gray-600',
};

// 后端 data source 的 sourceType → 友好显示
const SOURCE_TYPE_META: Record<string, { label: string; Icon: LucideIcon }> = {
  AI_LIBRARY: { label: '我的知识库', Icon: BookMarked },
  AI_EXPLORE: { label: 'AI 探索', Icon: Compass },
  AI_RESEARCH: { label: 'AI 研究', Icon: FlaskConical },
  AI_WRITING: { label: 'AI 写作', Icon: PenLine },
  AI_OFFICE: { label: 'AI Office', Icon: FileText },
  AI_TOPIC_INSIGHTS: { label: '专题洞察', Icon: Lightbulb },
  AI_PLAYGROUND: { label: 'AI 洞察', Icon: Bot },
  AI_RADAR: { label: 'AI 雷达', Icon: Radar },
};
function getSourceMeta(sourceType: string) {
  return SOURCE_TYPE_META[sourceType] ?? { label: sourceType, Icon: FileText };
}

// 卡片图标渐变（按 id hash 取色，与全站 getProjectGradient 同款，避免整页 rose 单色）
const CARD_GRADIENTS = [
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-amber-500 to-orange-600',
  'from-emerald-500 to-teal-600',
  'from-fuchsia-500 to-pink-600',
  'from-indigo-500 to-blue-600',
  'from-sky-500 to-indigo-600',
];
function getCardGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return CARD_GRADIENTS[Math.abs(hash) % CARD_GRADIENTS.length];
}

function platformLabelOf(task: SocialContentTask): string {
  return task.platforms
    .map((p) =>
      p === 'WECHAT_MP' || p === 'WECHAT_ARTICLE'
        ? '微信公众号'
        : p === 'XIAOHONGSHU' || p === 'XIAOHONGSHU_NOTE'
          ? '小红书'
          : p
    )
    .join(' · ');
}

function taskTitleOf(task: SocialContentTask): string {
  const autoTitle = task.title?.trim();
  const generatedTitle = task.versions?.[0]?.title?.trim();
  const promptTitle = task.prompt?.trim().slice(0, 60);
  return (
    autoTitle ||
    generatedTitle ||
    promptTitle ||
    (task.status === 'GENERATING' || task.status === 'PENDING'
      ? '生成中…'
      : task.status === 'FAILED'
        ? '未生成（任务失败）'
        : task.status === 'CANCELLED'
          ? '已取消'
          : '未命名任务')
  );
}

function taskDescriptionOf(task: SocialContentTask): string {
  const digest = task.versions?.[0]?.digest?.trim();
  return (
    task.errorMessage?.trim() ||
    digest ||
    task.prompt?.trim() ||
    (task.status === 'GENERATING' || task.status === 'PENDING'
      ? '内容生成中…'
      : '暂无摘要')
  );
}

export default function TasksTab({
  search,
  onCreate,
}: {
  search: string;
  onCreate: () => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const { tasks, isLoading, error, refresh } = useSocialTasks({
    refreshIntervalMs: 5000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (tk) =>
        taskTitleOf(tk).toLowerCase().includes(q) ||
        taskDescriptionOf(tk).toLowerCase().includes(q)
    );
  }, [tasks, search]);

  const handleCancel = async (task: SocialContentTask) => {
    const canCancel = task.status === 'PENDING' || task.status === 'GENERATING';
    const ok = await confirm({
      title: canCancel
        ? `取消任务「${taskTitleOf(task)}」？`
        : `删除任务「${taskTitleOf(task)}」？`,
      description: canCancel ? '任务将停止，记录保留。' : '此操作不可恢复。',
      type: 'danger',
    });
    if (!ok) return;
    void cancelTaskAndRefresh(task.id, refresh).catch((err: unknown) => {
      logger.warn('[TasksTab] cancel failed:', err);
    });
  };

  const handleRename = async (task: SocialContentTask) => {
    // eslint-disable-next-line no-alert
    const next = window.prompt('重命名任务：', taskTitleOf(task));
    const trimmed = next?.trim();
    if (!trimmed || trimmed === taskTitleOf(task)) return;
    try {
      await renameSocialTask(task.id, trimmed);
      refresh();
    } catch (err) {
      logger.warn('[TasksTab] rename failed:', err);
    }
  };

  const renderCard = (task: SocialContentTask) => {
    const meta = STATUS_META[task.status];
    const sources = task.sources ?? [];
    const urlCount = task.externalUrls.length;

    // badges：平台 + 状态（状态作为标准 badge，与 playground MissionCard 一致）
    const badges: AssetCardBadge[] = [
      {
        key: 'platform',
        label: platformLabelOf(task),
        className: 'bg-gray-100 text-gray-600',
      },
      {
        key: 'status',
        label: meta.label,
        className: TONE_BADGE[meta.tone],
        icon: (
          <meta.icon className={`h-3 w-3 ${meta.spin ? 'animate-spin' : ''}`} />
        ),
      },
    ];

    // stats：来源 / 外链 / 版本（带图标，与标准卡 stats 行一致）
    const stats: AssetCardStat[] = [];
    if (sources.length > 0) {
      const sm = getSourceMeta(sources[0].sourceType);
      stats.push({
        key: 'src',
        icon: <sm.Icon className="h-3.5 w-3.5" />,
        text:
          sources.length > 1 ? `${sm.label} +${sources.length - 1}` : sm.label,
      });
    }
    if (urlCount > 0) {
      stats.push({
        key: 'url',
        icon: <Link2 className="h-3.5 w-3.5" />,
        text: `${urlCount} 外链`,
      });
    }
    if (task.versions && task.versions.length > 0) {
      stats.push({
        key: 'ver',
        icon: <Layers className="h-3.5 w-3.5" />,
        text: `${task.versions.length} 版本`,
      });
    }

    const canCancel = task.status === 'PENDING' || task.status === 'GENERATING';

    return (
      <AssetCard
        key={task.id}
        title={taskTitleOf(task)}
        description={taskDescriptionOf(task)}
        icon={<FileText className="h-6 w-6 text-white" />}
        gradient={getCardGradient(task.id)}
        badges={badges}
        isOwner
        onEdit={() => void handleRename(task)}
        onDelete={() => void handleCancel(task)}
        labels={{ edit: '重命名', delete: canCancel ? '取消任务' : '删除任务' }}
        onClick={() => router.push(`/ai-social/mission/${task.id}`)}
        stats={stats}
        timestamp={task.createdAt}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* 计数行（对齐 playground MissionGalleryView）*/}
      {!isLoading && tasks.length > 0 && (
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {search ? '搜索结果' : '我的任务'}
          </h2>
          <span className="text-xs text-gray-500">共 {filtered.length} 个</span>
        </div>
      )}

      {error && (
        <ErrorInline
          message={String(error instanceof Error ? error.message : error)}
        />
      )}

      {isLoading && tasks.length === 0 ? (
        <LoadingState text={t('aiSocial.loading')} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-12 w-12" />}
          title={t('aiSocial.tasks.empty')}
          action={{
            label: t('aiSocial.tasks.create'),
            onClick: onCreate,
          }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          type="search"
          title="没有匹配的任务"
          description="换个关键词试试"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(renderCard)}
          <CreateCard title={t('aiSocial.tasks.create')} onClick={onCreate} />
        </div>
      )}
    </div>
  );
}
