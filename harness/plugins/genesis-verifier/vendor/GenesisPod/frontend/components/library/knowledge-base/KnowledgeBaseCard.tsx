'use client';

/**
 * KnowledgeBaseCard - thin wrapper around the platform AssetCard so that
 * personal / team KB grids match Wiki / Research / Topic Insight visually.
 *
 * The previous bespoke card (banner + 3-col stats grid + dropdown menu) has
 * been replaced by AssetCard so the whole library now speaks one card
 * language. Public props are unchanged — PersonalKnowledgeBaseTab and
 * TeamKnowledgeBaseTab don't need to migrate.
 *
 * Mapping:
 *   icon         = source-type primary icon (Cloud / BookOpen / Globe / ...)
 *   gradient     = pickGradient(kb.id) — same hash-driven palette as before
 *   badges       = visibility (私有 / 团队) + status dot (就绪 / 处理中 / ...)
 *   stats        = 文档 N · 数据源 label · 成员 N (team only)
 *   customSection= RAG embedding progress (when childChunkCount > 0)
 *   timestamp    = kb.updatedAt (relative via ClientDate)
 *   hover icons  = Edit / 成员管理 (team) / Delete (built into AssetCard)
 */

import {
  BookOpen,
  Bookmark,
  Cloud,
  Database,
  FileText,
  Globe,
  ImageIcon,
  Layers,
  Lock,
  NotebookPen,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useApiGet } from '@/hooks/core';
import {
  AssetCard,
  type AssetCardAction,
  type AssetCardBadge,
  type AssetCardStat,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import type {
  KnowledgeBase,
  KnowledgeBaseStats,
} from '@/hooks/domain/useKnowledgeBase';
import {
  KB_STATUS_TOKENS,
  pickGradient,
  type KnowledgeBaseStatus,
} from '../_design/tokens';

type SourceType = KnowledgeBase['sourceType'];

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

interface KnowledgeBaseCardProps {
  kb: KnowledgeBase;
  /** 'personal' | 'team' — drives status badge + 成员管理 action */
  variant: 'personal' | 'team';
  /** Whether to fetch RAG embedding stats (default true). */
  loadStats?: boolean;
  /** Pre-loaded stats from a parent batch fetch; preempts auto-fetch. */
  statsOverride?: KnowledgeBaseStats;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onManageMembers?: () => void;
  /** 多租户可见性切换（权限：私有/共享/公开）。 */
  onVisibilityChange?: (kb: KnowledgeBase, next: AssetVisibility) => void;
}

const SOURCE_ICON: Record<string, LucideIcon> = {
  GOOGLE_DRIVE: Cloud,
  MANUAL: BookOpen,
  URL: Globe,
  NOTION: Layers,
  BOOKMARK: Bookmark,
  NOTE: NotebookPen,
  IMAGE: ImageIcon,
};

const SOURCE_LABEL: Record<string, string> = {
  GOOGLE_DRIVE: 'Google Drive',
  MANUAL: '手动上传',
  URL: 'URL 抓取',
  NOTION: 'Notion',
  BOOKMARK: '书签',
  NOTE: '笔记',
  IMAGE: '图片',
};

function getSourceTypes(kb: KnowledgeBase): SourceType[] {
  return kb.sourceTypes?.length ? kb.sourceTypes : [kb.sourceType];
}

export default function KnowledgeBaseCard({
  kb,
  variant,
  loadStats = true,
  statsOverride,
  onOpen,
  onEdit,
  onDelete,
  onManageMembers,
  onVisibilityChange,
}: KnowledgeBaseCardProps) {
  const docCount = kb._count?.documents ?? 0;
  const shouldFetchStats = loadStats && !statsOverride && docCount > 0;

  const { data: fetchedStats } = useApiGet<KnowledgeBaseStats>(
    shouldFetchStats ? `/rag/knowledge-bases/${kb.id}/stats` : '',
    { immediate: shouldFetchStats, deps: [kb.id, shouldFetchStats] }
  );

  const stats = statsOverride ?? fetchedStats ?? undefined;

  const gradient = pickGradient(kb.id);
  const status =
    KB_STATUS_TOKENS[kb.status as KnowledgeBaseStatus] ??
    KB_STATUS_TOKENS.PENDING;
  const sourceTypes = getSourceTypes(kb);
  const PrimaryIcon = SOURCE_ICON[sourceTypes[0]] ?? Database;
  const memberCount = kb.members?.length ?? 0;
  const sourceLabel = sourceTypes.map((s) => SOURCE_LABEL[s] ?? s).join(' · ');

  const embeddingTotal = stats?.childChunkCount ?? 0;
  const embeddingReady = stats?.embeddingCount ?? 0;
  const embeddingPct =
    embeddingTotal > 0
      ? Math.min(100, Math.round((embeddingReady / embeddingTotal) * 100))
      : null;

  const badges: AssetCardBadge[] = [
    variant === 'team'
      ? {
          key: 'type',
          icon: <Users className="h-3 w-3" />,
          label: '团队',
          className: 'bg-blue-100 text-blue-700',
        }
      : {
          key: 'type',
          icon: <Lock className="h-3 w-3" />,
          label: '个人',
          className: 'bg-gray-100 text-gray-600',
        },
    {
      key: 'status',
      icon: <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />,
      label: status.label,
      className: `${status.bg} ${status.text}`,
    },
  ];

  const cardStats: AssetCardStat[] = [
    {
      key: 'docs',
      icon: <FileText className="h-3.5 w-3.5" />,
      text: `${docCount} 文档`,
    },
    {
      key: 'sources',
      icon: <Layers className="h-3.5 w-3.5" />,
      text: sourceLabel,
    },
  ];
  if (variant === 'team') {
    cardStats.push({
      key: 'members',
      icon: <Users className="h-3.5 w-3.5" />,
      text: `${memberCount} 成员`,
    });
  }

  const extraActions: AssetCardAction[] = [];
  if (variant === 'team' && onManageMembers) {
    extraActions.push({
      key: 'manage-members',
      icon: <UserPlus className="h-4 w-4" />,
      title: '成员管理',
      tone: 'info',
      onClick: onManageMembers,
    });
  }

  const customSection =
    embeddingPct !== null ? (
      <div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>RAG 嵌入</span>
          <span className="font-medium text-gray-700">
            {embeddingReady} / {embeddingTotal} · {embeddingPct}%
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full bg-gradient-to-r ${gradient.gradient} transition-all`}
            style={{ width: `${embeddingPct}%` }}
          />
        </div>
      </div>
    ) : undefined;

  return (
    <AssetCard
      title={kb.name}
      description={kb.description ?? '暂无描述'}
      icon={<PrimaryIcon className="h-6 w-6 text-white" strokeWidth={1.75} />}
      gradient={gradient.gradient}
      badges={badges}
      stats={cardStats}
      customSection={customSection}
      timestamp={kb.updatedAt}
      isOwner
      visibility={kb.visibility ?? 'PRIVATE'}
      visibilityOptions={VISIBILITY_OPTIONS}
      visibilityToggleCycle={['PRIVATE', 'SHARED', 'PUBLIC']}
      onVisibilityToggle={
        onVisibilityChange ? (next) => onVisibilityChange(kb, next) : undefined
      }
      onEdit={onEdit}
      onDelete={onDelete}
      extraActions={extraActions}
      onClick={onOpen}
      labels={{
        edit: '编辑',
        delete: '删除',
      }}
    />
  );
}
