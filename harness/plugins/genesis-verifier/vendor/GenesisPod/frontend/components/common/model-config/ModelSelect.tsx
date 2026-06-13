/**
 * ModelSelect
 *
 * 替代原生 `<select>` 的模型下拉，支持 Lucide 图标识别 KEY 来源：
 *   - KeyRound (emerald)  → 我的 Key（BYOK）
 *   - Server   (slate)    → 系统 Key
 *
 * 原生 `<select>` 的 <option> 不能放 React 组件，导致只能用纯文本后缀
 * （`· 我的 Key` / `· 系统 Key`）。这个组件用 Radix DropdownMenu 替代，
 * 让 6 处模型选择器（explore / ai-image / admin/workspace / app/page /
 * explore/youtube / explore-content）有专业图标。
 *
 * 用法：
 *   <ModelSelect
 *     value={aiModel}
 *     onChange={setAiModel}
 *     models={aiModels}
 *     valueKey="modelId"  // 可选：以 modelId 为 value（默认 'modelId'）
 *   />
 */
'use client';

import * as React from 'react';
import { ChevronDown, KeyRound, Server, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/primitives/dropdown-menu';
import { cn } from '@/lib/utils/common';
import { useI18n } from '@/lib/i18n/i18n-context';

export interface ModelSelectItem {
  id: string;
  modelId: string;
  name: string;
  provider: string;
  isUserKey?: boolean;
  isMixture?: boolean;
  isSelfDriven?: boolean;
}

export interface ModelSelectProps<T extends ModelSelectItem = ModelSelectItem> {
  value: string;
  onChange: (next: string) => void;
  models: T[];
  /** 哪个字段当 value，默认 modelId（兼容原生 select.value 语义） */
  valueKey?: keyof T;
  disabled?: boolean;
  className?: string;
  /** 触发器尺寸 */
  size?: 'sm' | 'md';
  /** 自定义 placeholder（无可选模型时） */
  placeholder?: string;
}

function KeySourceIcon({
  isUserKey,
  size = 14,
}: {
  isUserKey?: boolean;
  size?: number;
}) {
  if (isUserKey) {
    return (
      <KeyRound size={size} className="shrink-0 text-emerald-600" aria-hidden />
    );
  }
  return <Server size={size} className="shrink-0 text-slate-500" aria-hidden />;
}

export function ModelSelect<T extends ModelSelectItem = ModelSelectItem>({
  value,
  onChange,
  models,
  valueKey,
  disabled,
  className,
  size = 'sm',
  placeholder,
}: ModelSelectProps<T>) {
  const { t } = useI18n();
  const key = (valueKey ?? 'modelId') as keyof T;

  const valueOf = React.useCallback(
    (m: T) => String(m[key] ?? m.modelId),
    [key]
  );

  const selected = React.useMemo(
    () => models.find((m) => valueOf(m) === value),
    [models, valueOf, value]
  );

  const myKeyLabel = t('common.modelKeyLabel.myKey');
  const sysKeyLabel = t('common.modelKeyLabel.systemKey');
  const fallbackPlaceholder = placeholder ?? '—';

  const triggerSize =
    size === 'sm' ? 'h-7 px-2 text-xs gap-1.5' : 'h-9 px-3 text-sm gap-2';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={disabled || models.length === 0}
        className={cn(
          'inline-flex w-full max-w-full cursor-pointer items-center justify-between rounded-lg border border-gray-300 bg-white font-medium text-gray-700 shadow-sm transition-all hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-50',
          triggerSize,
          className
        )}
        aria-label="Select AI model"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {selected ? (
            <>
              <KeySourceIcon
                isUserKey={selected.isUserKey}
                size={size === 'sm' ? 12 : 14}
              />
              <span className="truncate">
                {selected.name}
                <span className="text-gray-500"> ({selected.provider})</span>
              </span>
            </>
          ) : (
            <span className="text-gray-400">{fallbackPlaceholder}</span>
          )}
        </span>
        <ChevronDown
          size={size === 'sm' ? 14 : 16}
          className="shrink-0 text-gray-400"
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="max-h-72 min-w-[220px] overflow-y-auto"
      >
        {models.map((m) => {
          const v = valueOf(m);
          const isSelected = v === value;
          return (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => onChange(v)}
              className={cn(
                'flex items-center gap-2 px-2 py-2 text-sm',
                isSelected && 'bg-blue-50'
              )}
              data-selected={isSelected ? '' : undefined}
            >
              <KeySourceIcon isUserKey={m.isUserKey} size={14} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-gray-900">
                  {m.name}
                </span>
                <span className="truncate text-[11px] text-gray-500">
                  {m.provider} ·{' '}
                  <span
                    className={cn(
                      m.isUserKey ? 'text-emerald-600' : 'text-slate-500'
                    )}
                  >
                    {m.isUserKey ? myKeyLabel : sysKeyLabel}
                  </span>
                </span>
              </span>
              {isSelected && (
                <Check
                  size={14}
                  className="shrink-0 text-blue-600"
                  aria-hidden
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ModelSelect;
