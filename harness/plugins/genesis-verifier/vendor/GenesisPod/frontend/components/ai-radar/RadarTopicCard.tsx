'use client';

/**
 * RadarTopicCard
 *
 * 基于 `AssetCard` 平台组件实现（2026-05-16 重构）。
 * 本文件只负责将 RadarTopicWithCounts 业务数据映射成 AssetCard props，
 * 与 TopicCard / WritingProjectCard / Playground MissionCard 保持视觉骨架一致。
 *
 * 字段策略：
 *  - 不传 progress —— 持续运行无"完成度"概念
 *  - visibility 已接（多租户权限：私有/共享/公开，2026-05-20）
 *  - 卡片操作统一为 权限 + 编辑 + 删除（暂停/恢复/归档已删，2026-05-20）
 *  - stats 用 items/sources/runs counts（list API 经 _count 单次拿到，不会 N+1）
 *  - customSection 显示关键词 chips（雷达独有信息，AssetCard 默认布局不覆盖）
 */

import { useRouter } from 'next/navigation';
import {
  Activity,
  Database,
  Globe,
  Lock,
  Radar as RadarIcon,
  Rss,
  Users,
} from 'lucide-react';
import {
  AssetCard,
  type AssetCardBadge,
  type AssetVisibility,
  type AssetVisibilityOption,
} from '@/components/ui/cards/asset-card';
import { Switch } from '@/components/ui/primitives/switch';
import type {
  RadarTopic,
  RadarTopicWithCounts,
} from '@/services/ai-radar/types';

interface Props {
  topic: RadarTopicWithCounts;
  /** 永久删除。父级带确认弹层。 */
  onDelete?: (topic: RadarTopic) => void;
  /** 多租户可见性切换（权限：私有/共享/公开）。 */
  onVisibilityChange?: (topic: RadarTopic, next: AssetVisibility) => void;
  /**
   * 自动刷新开关：ACTIVE=开（调度器每分钟扫描）/ PAUSED=关。
   * 归档（ARCHIVED）状态不显示开关。切换中 disabled。
   */
  onToggleAutoRefresh?: (topic: RadarTopic, nextEnabled: boolean) => void;
  /** 该卡片是否正在切换（父级控制，防抖 + 防重复点击）。 */
  toggling?: boolean;
}

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

const STATUS_BADGE: Record<
  RadarTopic['status'],
  { label: string; className: string }
> = {
  ACTIVE: {
    label: '运行中',
    className: 'bg-cyan-50 text-cyan-700',
  },
  PAUSED: {
    label: '已暂停',
    className: 'bg-gray-100 text-gray-600',
  },
  ARCHIVED: {
    label: '已归档',
    className: 'bg-gray-100 text-gray-500',
  },
};

export function RadarTopicCard({
  topic,
  onDelete,
  onVisibilityChange,
  onToggleAutoRefresh,
  toggling,
}: Props) {
  const router = useRouter();
  const status = STATUS_BADGE[topic.status];

  const badges: AssetCardBadge[] = [
    {
      key: 'status',
      label: status.label,
      className: status.className,
    },
  ];

  // 2026-05-17 R3 P1：DB keywords 是 raw Json，理论上前端 type 写 string[]
  // 但任何一行 legacy / corrupted 数据（null / 非数组）原写法都让整页 .slice()
  // 崩。Array.isArray 守 + filter 非 string 元素后再切。
  const keywords = Array.isArray(topic.keywords)
    ? topic.keywords.filter((k): k is string => typeof k === 'string')
    : [];
  const keywordChips =
    keywords.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {keywords.slice(0, 5).map((kw) => (
          <span
            key={kw}
            className="rounded-md bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600"
          >
            {kw}
          </span>
        ))}
        {keywords.length > 5 && (
          <span className="text-xs text-gray-400">+{keywords.length - 5}</span>
        )}
      </div>
    ) : null;

  // 自动刷新开关（归档态不显示）。stopPropagation 防止点 toggle 触发卡片跳转。
  const autoRefreshToggle =
    topic.status !== 'ARCHIVED' && onToggleAutoRefresh ? (
      <div
        className="flex items-center gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <Switch
          checked={topic.status === 'ACTIVE'}
          disabled={toggling}
          onCheckedChange={(next) => onToggleAutoRefresh(topic, next)}
          aria-label="自动刷新"
        />
        <span className="text-xs text-gray-500">自动刷新</span>
      </div>
    ) : undefined;

  return (
    <AssetCard
      title={topic.name}
      description={topic.description}
      icon={<RadarIcon className="h-6 w-6 text-white" />}
      gradient="from-cyan-500 to-sky-600"
      badges={badges}
      footerExtra={autoRefreshToggle}
      isOwner
      visibility={topic.visibility}
      visibilityOptions={VISIBILITY_OPTIONS}
      visibilityToggleCycle={['PRIVATE', 'SHARED', 'PUBLIC']}
      onVisibilityToggle={
        onVisibilityChange
          ? (next) => onVisibilityChange(topic, next)
          : undefined
      }
      onEdit={() => router.push(`/ai-radar/topic/${topic.id}`)}
      onDelete={onDelete ? () => onDelete(topic) : undefined}
      onClick={() => router.push(`/ai-radar/topic/${topic.id}`)}
      customSection={keywordChips}
      stats={[
        {
          key: 'items',
          icon: <Database className="h-3.5 w-3.5" />,
          text: `${topic.counts.items} 条`,
        },
        {
          key: 'sources',
          icon: <Rss className="h-3.5 w-3.5" />,
          text: `${topic.counts.sources} 源`,
        },
        {
          key: 'runs',
          icon: <Activity className="h-3.5 w-3.5" />,
          text: `${topic.counts.runs} 次刷新`,
        },
      ]}
      timestampLabel="上次"
      timestamp={topic.lastRunAt}
    />
  );
}
