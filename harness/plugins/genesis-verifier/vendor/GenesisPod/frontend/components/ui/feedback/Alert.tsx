'use client';

/**
 * Alert — 语义提示条 / banner（canonical，2026-05-22 提取）。
 *
 * 取代散落 31+ 文件的内联 `bg-{c}-50 + border-{c}-200 + 图标` 提示块
 * （失败/降级/成功/信息横幅）。配色走 design token 的语义 toneToken，
 * **固定语义色**（info=蓝/success=绿/warn=琥珀/error=红），不随模块识别色变。
 *
 * 用法：
 *   <Alert tone="error" title="Mission 失败">{msg}</Alert>
 *   <Alert tone="warn" onClose={...}>实时连接已降级为轮询</Alert>
 */

import type { ReactNode } from 'react';
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { toneToken, type ToneKey } from '@/lib/design/tokens';

export type AlertTone = ToneKey; // info | success | warn | error | neutral

const TONE_ICON: Record<AlertTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  neutral: Info,
};

export interface AlertProps {
  /** 语义色调，默认 info */
  tone?: AlertTone;
  /** 加粗标题行（可选） */
  title?: ReactNode;
  /** 正文/描述 */
  children?: ReactNode;
  /** 覆盖默认图标；传 null 不显示图标 */
  icon?: ReactNode;
  /** 传入则右上角显示关闭按钮 */
  onClose?: () => void;
  /** 正文下方操作区（按钮/链接等） */
  action?: ReactNode;
  /** 关闭按钮无障碍标签 */
  closeLabel?: string;
  className?: string;
}

export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  onClose,
  action,
  closeLabel = '关闭',
  className,
}: AlertProps) {
  const t = toneToken[tone];
  const Icon = TONE_ICON[tone];
  return (
    <div
      role="alert"
      className={cn(
        'relative flex items-start gap-2.5 rounded-lg p-3 text-sm ring-1',
        t.bg,
        t.text,
        t.ring,
        onClose && 'pr-9',
        className
      )}
    >
      {icon !== null && (
        <span className="mt-0.5 shrink-0">
          {icon ?? <Icon className="h-4 w-4" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && (
          <div
            className={cn(
              'break-words leading-relaxed',
              title && 'mt-0.5 opacity-90'
            )}
          >
            {children}
          </div>
        )}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-2 top-2 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
