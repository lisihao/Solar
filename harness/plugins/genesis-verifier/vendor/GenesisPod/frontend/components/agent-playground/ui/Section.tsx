'use client';

/**
 * Section —— 带标题 + 可选数字徽章 + 可选右侧 action 的折叠区块。
 *
 * 取代原先散落各处的 `<section><div border-b><p uppercase>...</p></div>...`。
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils/common';

interface SectionProps {
  title: string;
  /** 标题旁的数字徽章（可选） */
  count?: number | string;
  /** 区分主题色：default / accent（强调） */
  variant?: 'default' | 'accent';
  /** 右侧 action 按钮 */
  action?: React.ReactNode;
  /** 是否可折叠 */
  collapsible?: boolean;
  /** 默认是否打开（仅 collapsible 时） */
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Section({
  title,
  count,
  variant = 'default',
  action,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const showBody = !collapsible || open;
  const Header = collapsible ? 'button' : 'div';
  const HeaderProps = collapsible
    ? {
        type: 'button' as const,
        onClick: () => setOpen(!open),
        className:
          'flex w-full items-center justify-between border-b border-gray-100 px-4 py-2.5 transition-colors hover:bg-gray-50',
      }
    : {
        className:
          'flex items-center justify-between border-b border-gray-100 px-4 py-2.5',
      };

  const titleColor = variant === 'accent' ? 'text-violet-700' : 'text-gray-700';

  return (
    <section
      className={cn('rounded-xl border border-gray-200 bg-white', className)}
    >
      <Header {...HeaderProps}>
        <div className="flex items-center gap-2">
          {collapsible &&
            (open ? (
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
            ))}
          <h3
            className={cn(
              'text-[12px] font-semibold uppercase tracking-wide',
              titleColor
            )}
          >
            {title}
          </h3>
          {count !== undefined && count !== null && count !== '' && (
            <span className="font-mono rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
              {count}
            </span>
          )}
        </div>
        {action}
      </Header>
      {showBody && <div>{children}</div>}
    </section>
  );
}
