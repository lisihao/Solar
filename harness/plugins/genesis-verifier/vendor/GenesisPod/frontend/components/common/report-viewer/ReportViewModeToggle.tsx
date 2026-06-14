'use client';

/**
 * ReportViewModeToggle - 报告三视图切换按钮组
 *
 * 视觉风格参考 Topic Insights 详情页 reportViewMode 切换 UI。
 * 数据驱动：modes 数组决定按钮顺序、文案、图标、disabled 态。
 */

import { cn } from '@/lib/utils/common';
import type { ReportViewModeToggleProps } from './types';

export function ReportViewModeToggle({
  modes,
  activeMode,
  onChange,
  className,
}: ReportViewModeToggleProps) {
  return (
    <div
      className={cn(
        'inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5',
        className
      )}
      role="group"
    >
      {modes.map((m) => {
        const isActive = m.mode === activeMode;
        return (
          <button
            key={m.mode}
            type="button"
            onClick={() => !m.disabled && onChange(m.mode)}
            disabled={m.disabled}
            title={m.disabled ? m.disabledReason : m.description}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              isActive
                ? 'bg-white text-violet-700 shadow-sm'
                : 'text-gray-600 hover:bg-white/60 hover:text-gray-900',
              m.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
            )}
            aria-pressed={isActive}
            aria-label={m.label}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
