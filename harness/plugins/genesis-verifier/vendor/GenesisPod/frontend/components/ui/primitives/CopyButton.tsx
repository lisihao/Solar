'use client';

/**
 * CopyButton — 复制到剪贴板按钮（canonical，2026-05-22 提取）。
 *
 * 取代散落 27+ 文件的 `navigator.clipboard.writeText(...)` + 自管"已复制"反馈。
 * 默认纯图标；传 label 则显示带文字按钮。复制成功短暂显示对勾 + copiedLabel。
 *
 * 用法：
 *   <CopyButton value={token} />                         // 图标按钮
 *   <CopyButton value={text} label="复制正文" />          // 带文字
 */

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils/common';

export interface CopyButtonProps {
  /** 要复制的文本 */
  value: string;
  /** 复制成功反馈持续时长（ms），默认 1500 */
  feedbackMs?: number;
  /** 图标尺寸 */
  size?: 'sm' | 'md';
  /** 传入则显示带文字按钮（如"复制"）；不传则纯图标 */
  label?: string;
  /** 复制成功后的文字，默认"已复制" */
  copiedLabel?: string;
  /** hover 提示 / aria-label */
  title?: string;
  /** 复制成功回调 */
  onCopied?: () => void;
  className?: string;
  disabled?: boolean;
}

export function CopyButton({
  value,
  feedbackMs = 1500,
  size = 'md',
  label,
  copiedLabel = '已复制',
  title,
  onCopied,
  className,
  disabled,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), feedbackMs);
    } catch {
      // clipboard 不可用（非 https / 权限拒绝）时静默——按钮无反馈即失败
    }
  }, [value, feedbackMs, onCopied]);

  const iconCls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const labelText = copied ? copiedLabel : (label ?? '复制');

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      disabled={disabled}
      title={title ?? labelText}
      aria-label={title ?? labelText}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        label
          ? 'border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50'
          : 'p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600',
        className
      )}
    >
      {copied ? (
        <Check className={cn(iconCls, 'text-emerald-600')} />
      ) : (
        <Copy className={iconCls} />
      )}
      {label && <span>{labelText}</span>}
    </button>
  );
}
