'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';

/**
 * Tabs — 受控 tab 栏（取代全站 ~46 处自写 `activeTab` + 按钮行）。
 *
 * 只负责「tab 栏」本身（受控 value / onChange）；内容切换仍由调用方按
 * `value === key` 渲染，贴合既有写法、迁移零成本。两种视觉：underline / pill。
 */
export interface TabItem {
  key: string;
  label: React.ReactNode;
  /** Lucide 图标组件（渲染为 <Icon className="h-4 w-4" />） */
  icon?: LucideIcon;
  /** 预渲染图标节点（与 icon 二选一，iconNode 优先；用于非 Lucide / 已带 props 的图标） */
  iconNode?: React.ReactNode;
  /** 右上角计数徽标 */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  variant?: 'underline' | 'pill';
  size?: 'sm' | 'md';
  className?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  className,
}: TabsProps) {
  const pad = size === 'sm' ? 'px-3 py-2 text-sm' : 'px-4 py-2.5 text-sm';

  if (variant === 'pill') {
    return (
      <div className={cn('flex flex-wrap items-center gap-1', className)}>
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.key === value;
          return (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => onChange(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                pad,
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              {item.iconNode ?? (Icon && <Icon className="h-4 w-4" />)}
              {item.label}
              {item.count != null && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs',
                    active ? 'bg-white/20' : 'bg-gray-200 text-gray-600'
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-1 border-b border-gray-200',
        className
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              pad,
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            )}
          >
            {item.iconNode ?? (Icon && <Icon className="h-4 w-4" />)}
            {item.label}
            {item.count != null && (
              <span className="rounded-full bg-gray-100 px-1.5 text-xs text-gray-600">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
