'use client';

/**
 * ToneCard —— 叙事语气卡片（info / success / warn / error / neutral）。
 * 用于 timeline 卡片、failure callout 等"带情绪"容器。
 */

import React from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { toneToken, type ToneKey } from '@/lib/design/tokens';

const TONE_ICON: Record<ToneKey, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: AlertCircle,
  neutral: Info,
};

interface ToneCardProps {
  tone: ToneKey;
  /** 顶部右侧 meta（时间戳等） */
  meta?: React.ReactNode;
  /** 顶部左侧标签 */
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function ToneCard({
  tone,
  meta,
  label,
  children,
  className,
}: ToneCardProps) {
  const token = toneToken[tone];
  const Icon = TONE_ICON[tone];
  return (
    <div className={cn('rounded-lg ring-1', token.bg, token.ring, className)}>
      {(label || meta) && (
        <div className="flex items-center gap-2 border-b border-black/5 px-3 py-1.5">
          {label && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                token.bg,
                token.text
              )}
            >
              <Icon className="h-2.5 w-2.5" />
              {label}
            </span>
          )}
          {meta && <span className="ml-auto">{meta}</span>}
        </div>
      )}
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
