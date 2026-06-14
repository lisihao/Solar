'use client';

import { isValidElement } from 'react';
import { Inbox, Search, FileX, Plus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { Button } from '../primitives/button';

type EmptyType = 'default' | 'search' | 'noData' | 'error';

type EmptyAction = { label: string; onClick: () => void };

interface EmptyStateProps {
  type?: EmptyType;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  /** 简单按钮 {label,onClick}；或自定义节点（带 loading / 多按钮等富交互） */
  action?: EmptyAction | React.ReactNode;
  /** md(默认)=满屏内容区空态；sm=紧凑面板/侧栏空态（无 min-h、小图标、小字号） */
  size?: 'sm' | 'md';
  className?: string;
}

function isActionConfig(a: EmptyStateProps['action']): a is EmptyAction {
  return (
    !!a &&
    typeof a === 'object' &&
    !isValidElement(a) &&
    'label' in a &&
    'onClick' in a
  );
}

const defaultConfig: Record<
  EmptyType,
  { Icon: LucideIcon; title: string; description: string }
> = {
  default: {
    Icon: Inbox,
    title: '暂无内容',
    description: '这里还没有任何内容',
  },
  search: {
    Icon: Search,
    title: '未找到结果',
    description: '尝试调整搜索条件或筛选器',
  },
  noData: {
    Icon: FileX,
    title: '暂无数据',
    description: '开始创建你的第一个项目',
  },
  error: {
    Icon: FileX,
    title: '加载失败',
    description: '请稍后重试',
  },
};

export function EmptyState({
  type = 'default',
  title,
  description,
  icon,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  const config = defaultConfig[type];
  const { Icon } = config;
  const sm = size === 'sm';
  // 给了 description 用之；给了自定义 title 但没 description = 有意 title-only；
  // title/description 都没给（纯 type 用法）才回落 config.description。
  const effectiveDescription =
    description ?? (title ? undefined : config.description);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sm ? 'gap-2 px-3 py-6' : 'min-h-[300px] gap-4 p-8',
        className
      )}
    >
      <div className="text-gray-300">
        {icon ?? <Icon className={sm ? 'h-8 w-8' : 'h-12 w-12'} />}
      </div>
      <div className="space-y-1">
        <h3 className={cn('font-medium text-gray-900', sm && 'text-sm')}>
          {title || config.title}
        </h3>
        {/* 自定义 title 但未给 description = 有意 title-only（紧凑空态常见），不补默认描述 */}
        {effectiveDescription && (
          <p className={cn('text-gray-500', sm ? 'text-xs' : 'text-sm')}>
            {effectiveDescription}
          </p>
        )}
      </div>
      {action &&
        (isActionConfig(action) ? (
          <Button size={sm ? 'sm' : undefined} onClick={action.onClick}>
            <Plus className="mr-2 h-4 w-4" />
            {action.label}
          </Button>
        ) : (
          (action as React.ReactNode)
        ))}
    </div>
  );
}
