'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';

/**
 * VerticalNavMenu — 受控的竖向分组导航菜单（左侧二级菜单）。
 *
 * 只负责「菜单」本身（受控 value / onChange）；内容切换仍由调用方按
 * `value === key` 渲染，与 {@link Tabs} 一致、迁移零成本。
 * 顶部独立项（无分组标题）传一个省略 `title` 的 group 即可。
 */
export interface VerticalNavItem {
  key: string;
  label: React.ReactNode;
  /** Lucide 图标组件（渲染为 <Icon className="h-4 w-4" />） */
  icon?: LucideIcon;
  /** 右侧计数徽标 */
  count?: number;
  /** 右侧自定义节点（如状态点）；存在时覆盖 count */
  trailing?: React.ReactNode;
  disabled?: boolean;
}

export interface VerticalNavGroup {
  /** 分组标题；省略则该组无标题（如顶部独立项） */
  title?: string;
  items: VerticalNavItem[];
}

export interface VerticalNavMenuProps {
  groups: VerticalNavGroup[];
  value: string;
  onChange: (key: string) => void;
  /** 主题色，默认 violet（与知识库 / 品牌一致） */
  accent?: 'violet' | 'blue';
  className?: string;
}

const ACCENT = {
  violet: {
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    icon: 'text-violet-600',
  },
  blue: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    icon: 'text-blue-600',
  },
} as const;

export function VerticalNavMenu({
  groups,
  value,
  onChange,
  accent = 'violet',
  className,
}: VerticalNavMenuProps) {
  const a = ACCENT[accent];

  return (
    <nav className={cn('flex flex-col gap-5', className)}>
      {groups.map((group, gi) => (
        <div
          key={group.title ?? `group-${gi}`}
          className="flex flex-col gap-0.5"
        >
          {group.title && (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {group.title}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = item.key === value;
            return (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                onClick={() => onChange(item.key)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  active
                    ? cn(a.bg, a.text)
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                {Icon && (
                  <Icon
                    className={cn(
                      'h-4 w-4 flex-shrink-0',
                      active ? a.icon : 'text-gray-400'
                    )}
                  />
                )}
                <span className="flex-1 truncate text-left">{item.label}</span>
                {item.trailing ??
                  (item.count != null && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-xs tabular-nums',
                        active
                          ? 'bg-white/70 text-gray-700'
                          : 'bg-gray-100 text-gray-500'
                      )}
                    >
                      {item.count}
                    </span>
                  ))}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
