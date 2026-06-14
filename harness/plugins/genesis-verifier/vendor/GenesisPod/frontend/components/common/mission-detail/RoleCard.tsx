'use client';

/**
 * RoleCard — mission 团队「角色卡」内容无关 canonical（下沉自 playground TeamRosterPanel）。
 *
 * 平台定风格（卡片 / 状态点 / 完成度 / 点击），业务定内容（哪些角色、图标、描述）。
 * playground(leader/researcher/…) 与 ai-social(平台探测/撰稿/…) 共用。
 */

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export type RoleCardStatus = 'idle' | 'running' | 'completed' | 'failed';

const STATUS_DOT: Record<RoleCardStatus, string> = {
  idle: 'bg-gray-300',
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export interface RoleCardProps {
  label: string;
  icon: LucideIcon;
  /** 图标底色（业务主题色，如 'bg-violet-50 text-violet-600'） */
  iconClass?: string;
  status?: RoleCardStatus;
  /** 完成度 done/total（可选） */
  completedCount?: number;
  totalCount?: number;
  /** 一行说明 / 最后思考（可选，line-clamp-1） */
  caption?: string;
  onClick?: () => void;
  className?: string;
}

export function RoleCard({
  label,
  icon: Icon,
  iconClass = 'bg-gray-50 text-gray-600',
  status = 'idle',
  completedCount,
  totalCount,
  caption,
  onClick,
  className,
}: RoleCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors',
        onClick && 'cursor-pointer hover:border-gray-300 hover:bg-gray-50',
        !onClick && 'cursor-default',
        className
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          iconClass
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">
            {label}
          </span>
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_DOT[status])}
          />
        </div>
        {caption && (
          <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{caption}</p>
        )}
      </div>
      {typeof completedCount === 'number' && typeof totalCount === 'number' && (
        <span className="font-mono shrink-0 text-xs text-gray-500">
          {completedCount}/{totalCount}
        </span>
      )}
    </button>
  );
}
