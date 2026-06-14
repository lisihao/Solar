'use client';

/**
 * MissionActionGroup — 左 panel 底部按钮组（playground 标杆样式）
 *
 * 视觉规范完全 mirror playground TeamRosterPanel 内的"开始 / 更新 / 取消"3
 * 按钮组：grid-cols-N + rounded-lg + px-3 py-2.5 + 主色（blue/green/red）+
 * disabled 态。
 *
 * 用法：各 domain 传 buttons 数组，按钮自动按 N 列 grid 排版。
 * - playground: ▶开始(primary) / 🔄更新(secondary) / ⏹取消(danger)
 * - social:     ↻重试(primary) / 📤发布(secondary) / ⏹取消(danger)
 * - radar:      🔄重新拉取(primary) / ⏹取消(danger)
 *
 * 每个 button:
 *   - variant: primary | secondary | danger
 *   - emoji?: 单字 emoji 图标（保留 playground 视觉特色）
 *   - label: 按钮文字
 *   - title?: hover 提示
 *   - disabled?: 是否禁用
 *   - onClick: 回调
 *
 * 不在 group 里的小按钮（如 ⋯ menu / 单图标按钮）请用 MissionActionIconButton。
 */

import { cn } from '@/lib/utils/common';

export type MissionActionVariant = 'primary' | 'secondary' | 'danger';

export interface MissionActionButtonSpec {
  variant: MissionActionVariant;
  emoji?: string;
  label: string;
  title?: string;
  disabled?: boolean;
  /** 高亮强调（用 ring-2 ring-violet-200，playground 的 isResumable 态）*/
  emphasized?: boolean;
  onClick: () => void;
}

interface MissionActionGroupProps {
  buttons: MissionActionButtonSpec[];
  className?: string;
}

const VARIANT_CLASSES: Record<
  MissionActionVariant,
  { active: string; emphasizedActive?: string; disabled: string }
> = {
  primary: {
    active: 'bg-blue-600 text-white shadow-sm hover:bg-blue-700',
    disabled:
      'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400',
  },
  secondary: {
    active: 'bg-green-600 text-white shadow-sm hover:bg-green-700',
    emphasizedActive:
      'bg-violet-600 text-white shadow-sm ring-2 ring-violet-200 hover:bg-violet-700',
    disabled:
      'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400',
  },
  danger: {
    active: 'border border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
    disabled:
      'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400',
  },
};

const COLS_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

export function MissionActionGroup({
  buttons,
  className,
}: MissionActionGroupProps) {
  if (!buttons.length) return null;
  const cols = Math.min(buttons.length, 4);

  return (
    <div className={cn('grid gap-2', COLS_CLASS[cols], className)}>
      {buttons.map((btn, i) => {
        const palette = VARIANT_CLASSES[btn.variant];
        const activeClass =
          btn.emphasized && palette.emphasizedActive
            ? palette.emphasizedActive
            : palette.active;
        return (
          <button
            key={i}
            type="button"
            onClick={btn.onClick}
            disabled={btn.disabled}
            title={btn.title}
            className={cn(
              'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
              btn.disabled ? palette.disabled : activeClass
            )}
          >
            {btn.emoji && <span>{btn.emoji}</span>}
            {btn.label}
          </button>
        );
      })}
    </div>
  );
}
