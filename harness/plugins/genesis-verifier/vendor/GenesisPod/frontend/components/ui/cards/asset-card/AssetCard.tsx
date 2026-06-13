'use client';

/**
 * AssetCard - 通用资产卡片
 *
 * 设计目标：
 * - 抽出 TopicCard / WritingProjectCard / ResearchProjectCard 共用结构
 * - 主题色（gradient）、徽章文案、可见性级别由调用方注入，不在平台层硬编码
 * - 操作按钮通过 props 暴露（onEdit/onDelete/onVisibilityToggle 等），允许 extraActions 扩展
 * - 时间格式化通过 ClientDate 处理 hydration
 *
 * 两种模式：
 * - 默认：icon-first（h-12 w-12 渐变方块在顶部）
 * - media: 缩略图优先（aspect-video / aspect-square 大图覆盖顶部），用于 Slides / Image
 *
 * 不在平台层做的：
 * - 申请加入按钮（业务逻辑差异大，由 footerExtra slot 注入）
 * - 协作者列表（属于详情页/分享弹窗的职责）
 * - 翻译（labels prop 由调用方传入，避免与具体 i18n 命名空间耦合）
 */

import type { MouseEvent, ReactNode } from 'react';
import { ClientDate } from '@/components/common/ClientDate';
import { cn } from '@/lib/utils/common';
import {
  AssetDeleteIcon,
  AssetEditIcon,
  AssetGlobeIcon,
  AssetLockIcon,
  AssetShareIcon,
} from './icons';
import type {
  AssetCardAction,
  AssetCardBadge,
  AssetCardProps,
  AssetVisibility,
  AssetVisibilityOption,
} from './types';

const TONE_CLASSNAME: Record<NonNullable<AssetCardAction['tone']>, string> = {
  default: 'text-gray-400 hover:bg-gray-50 hover:text-gray-600',
  success: 'text-gray-400 hover:bg-green-50 hover:text-green-600',
  danger: 'text-gray-400 hover:bg-red-50 hover:text-red-600',
  info: 'text-gray-400 hover:bg-cyan-50 hover:text-cyan-600',
  warning: 'text-gray-400 hover:bg-amber-50 hover:text-amber-600',
};

const VISIBILITY_RING_CLASS: Record<AssetVisibility, string> = {
  PRIVATE: 'hover:ring-gray-300',
  SHARED: 'hover:ring-blue-300',
  PUBLIC: 'hover:ring-green-300',
};

function ActionButton({ action }: { action: AssetCardAction }) {
  const tone = action.tone ?? 'default';
  if (action.visible === false) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        // preventDefault：卡片可能被包在 <Link>/<a> 里（如书签卡），
        // 仅 stopPropagation 挡不住锚点的默认跳转，会变成"点按钮也跳源"。
        e.preventDefault();
        e.stopPropagation();
        action.onClick();
      }}
      className={cn(
        'rounded-lg bg-white p-1.5 shadow-sm transition-colors',
        TONE_CLASSNAME[tone]
      )}
      title={action.title}
      aria-label={action.title}
    >
      {action.icon}
    </button>
  );
}

function BadgesRow({
  badges,
  visibility,
  visibilityOption,
  isOwner,
  onVisibilityClick,
  clickVisibilityLabel,
}: {
  badges: AssetCardBadge[];
  visibility?: AssetVisibility;
  visibilityOption?: AssetVisibilityOption;
  isOwner: boolean;
  onVisibilityClick?: () => void;
  clickVisibilityLabel?: string;
}) {
  const hasContent = badges.length > 0 || visibilityOption;
  if (!hasContent) return null;

  const handleVisibilityBadgeClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isOwner || !onVisibilityClick) return;
    onVisibilityClick();
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            badge.className ?? 'bg-gray-100 text-gray-600'
          )}
        >
          {badge.icon}
          {badge.label}
        </span>
      ))}
      {visibilityOption &&
        visibility &&
        (isOwner && onVisibilityClick ? (
          <button
            type="button"
            onClick={handleVisibilityBadgeClick}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all hover:ring-2 hover:ring-offset-1',
              visibilityOption.className,
              VISIBILITY_RING_CLASS[visibility]
            )}
            title={clickVisibilityLabel ?? visibilityOption.label}
          >
            {visibilityOption.icon}
            {visibilityOption.label}
          </button>
        ) : (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              visibilityOption.className
            )}
          >
            {visibilityOption.icon}
            {visibilityOption.label}
          </span>
        ))}
    </div>
  );
}

export function AssetCard(props: AssetCardProps) {
  const {
    title,
    description,
    icon,
    gradient = 'from-[hsl(var(--primary))] to-[hsl(var(--primary)/0.7)]',
    media,
    badges = [],
    visibility,
    visibilityOptions,
    onVisibilityClick,
    onVisibilityToggle,
    visibilityToggleCycle = ['PRIVATE', 'PUBLIC'],
    isOwner = false,
    onEdit,
    onDelete,
    onShareToSocial,
    extraActions = [],
    onClick,
    stats = [],
    progress,
    customSection,
    timestampLabel,
    timestamp,
    footerExtra,
    className,
    labels,
  } = props;

  const visibilityOption =
    visibility && visibilityOptions ? visibilityOptions[visibility] : undefined;

  const handleVisibilityQuickToggle = () => {
    if (!onVisibilityToggle || !visibility) return;
    const idx = visibilityToggleCycle.indexOf(visibility);
    const next =
      visibilityToggleCycle[(idx + 1) % visibilityToggleCycle.length] ??
      visibilityToggleCycle[0];
    if (next) onVisibilityToggle(next);
  };

  // 装配右上角 hover 操作按钮
  const hoverActions: AssetCardAction[] = [];

  if (isOwner && onVisibilityToggle && visibility) {
    const isPublic = visibility === 'PUBLIC';
    hoverActions.push({
      key: 'visibility',
      title: isPublic
        ? (labels?.setPrivate ?? 'Set to private')
        : (labels?.setPublic ?? 'Set to public'),
      tone: isPublic ? 'success' : 'default',
      icon: isPublic ? (
        <AssetGlobeIcon className="h-4 w-4" />
      ) : (
        <AssetLockIcon className="h-4 w-4" />
      ),
      onClick: handleVisibilityQuickToggle,
    });
  }

  if (isOwner && onShareToSocial && visibility === 'PUBLIC') {
    hoverActions.push({
      key: 'share-social',
      title: labels?.shareToSocial ?? 'Share',
      tone: 'info',
      icon: <AssetShareIcon className="h-4 w-4" />,
      onClick: onShareToSocial,
    });
  }

  if (isOwner && onEdit) {
    hoverActions.push({
      key: 'edit',
      title: labels?.edit ?? 'Edit',
      tone: 'info',
      icon: <AssetEditIcon className="h-4 w-4" />,
      onClick: onEdit,
    });
  }

  hoverActions.push(...extraActions);

  if (isOwner && onDelete) {
    hoverActions.push({
      key: 'delete',
      title: labels?.delete ?? 'Delete',
      tone: 'danger',
      icon: <AssetDeleteIcon className="h-4 w-4" />,
      onClick: onDelete,
    });
  }

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, (progress.current / progress.total) * 100)
      : 0;

  const hasMedia = Boolean(media);

  const body: ReactNode = (
    <>
      <BadgesRow
        badges={badges}
        visibility={visibility}
        visibilityOption={visibilityOption}
        isOwner={isOwner}
        onVisibilityClick={onVisibilityClick}
        clickVisibilityLabel={labels?.clickVisibility}
      />

      <h3 className="line-clamp-1 font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 line-clamp-2 text-sm text-gray-500">{description}</p>
      )}

      {customSection && <div className="mt-3">{customSection}</div>}

      {stats.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
          {stats.map((stat) => (
            <div key={stat.key} className="flex items-center gap-1">
              {stat.icon}
              <span>{stat.text}</span>
            </div>
          ))}
        </div>
      )}

      {progress && progress.total > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{progress.current}</span>
            <span>
              {progress.current}/{progress.total}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={cn(
                'h-full rounded-full bg-gradient-to-r',
                progress.gradient ?? gradient
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {(timestamp !== undefined || footerExtra) && (
        <div className="mt-3 flex items-center justify-between">
          {timestamp !== undefined && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              {timestampLabel && <span>{timestampLabel}:</span>}
              <ClientDate date={timestamp} format="relative" fallback="—" />
            </div>
          )}
          {footerExtra && <div>{footerExtra}</div>}
        </div>
      )}
    </>
  );

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex h-full flex-col rounded-xl border border-gray-200 bg-white transition-all hover:border-[hsl(var(--primary)/0.45)] hover:shadow-lg',
        onClick && 'cursor-pointer',
        hasMedia ? 'overflow-hidden' : 'p-5',
        className
      )}
    >
      {hoverActions.length > 0 && (
        <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {hoverActions.map((action) => (
            <ActionButton key={action.key} action={action} />
          ))}
        </div>
      )}

      {hasMedia && <div className="relative">{media}</div>}

      {!hasMedia && icon && (
        <div
          className={cn(
            'mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br shadow-md',
            gradient
          )}
        >
          {icon}
        </div>
      )}

      {hasMedia ? <div className="p-4">{body}</div> : body}
    </div>
  );
}
