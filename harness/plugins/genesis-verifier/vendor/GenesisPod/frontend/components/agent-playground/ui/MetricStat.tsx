'use client';

/**
 * MetricStat —— 标准指标格：上方 caption label、下方 mono 数值。
 * 用法：drawer 顶部的"状态 / 耗时 / Token / 工具调用"四格。
 */

import React from 'react';
import { cn } from '@/lib/utils/common';

interface MetricStatProps {
  label: string;
  /** 数值（已格式化好的字符串）—— 缺值传 null 显示 — */
  value: React.ReactNode | null;
  /** 是否强调（默认 false） */
  emphasis?: boolean;
  className?: string;
}

export function MetricStat({
  label,
  value,
  emphasis,
  className,
}: MetricStatProps) {
  return (
    <div
      className={cn(
        'rounded-lg bg-gray-50 px-2.5 py-2',
        emphasis && 'bg-violet-50 ring-1 ring-violet-100',
        className
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p
        className={cn(
          'font-mono mt-0.5 text-xs font-semibold',
          emphasis ? 'text-violet-900' : 'text-gray-900'
        )}
      >
        {value === null || value === undefined || value === '' ? '—' : value}
      </p>
    </div>
  );
}
