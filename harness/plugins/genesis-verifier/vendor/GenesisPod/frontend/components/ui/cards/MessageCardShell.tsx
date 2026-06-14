'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/common';

export type MessageTone =
  | 'gray'
  | 'purple'
  | 'orange'
  | 'blue'
  | 'green'
  | 'amber'
  | 'yellow'
  | 'red';

const TONE: Record<MessageTone, string> = {
  gray: 'border-gray-200 bg-white',
  purple: 'border-purple-200 bg-purple-50',
  orange: 'border-orange-200 bg-orange-50',
  blue: 'border-blue-200 bg-blue-50',
  green: 'border-green-200 bg-green-50',
  amber: 'border-amber-200 bg-amber-50',
  yellow: 'border-yellow-200 bg-yellow-50',
  red: 'border-red-200 bg-red-50',
};

export interface MessageCardShellProps {
  /** 消息类型配色（边框 + 浅底） */
  tone?: MessageTone;
  /** 内边距（sm=p-3 / md=p-4） */
  padding?: 'sm' | 'md';
  children: ReactNode;
  className?: string;
}

/**
 * MessageCardShell — 话题对话流「消息卡」统一外壳 canonical。卡片设计系统第 3 类。
 * 抽自 message-cards/ 一族（GenericMessageCard/LeaderPlanCard/ReportCard/ReviewCard/
 * ResearchProgressCard/ResearchCompleteCard 等）重复的 `rounded-lg border border-X-200 bg-X-50 p-N` 外壳（2026-05-20）。
 * 只统一外壳（圆角/边框/浅底/内边距 + 类型配色）；消息正文由各卡在 children 中自渲染。
 */
export function MessageCardShell({
  tone = 'gray',
  padding = 'md',
  children,
  className,
}: MessageCardShellProps) {
  return (
    <div
      className={cn(
        'rounded-lg border',
        TONE[tone],
        padding === 'sm' ? 'p-3' : 'p-4',
        className
      )}
    >
      {children}
    </div>
  );
}
