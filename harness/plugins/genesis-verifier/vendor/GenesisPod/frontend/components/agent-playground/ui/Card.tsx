'use client';

/**
 * Card —— 标准容器
 *
 * 统一所有 playground panel/section 的卡片样式，禁止再裸写 rounded-2xl
 * border border-gray-100 bg-white shadow-sm。
 */

import React from 'react';
import { cn } from '@/lib/utils/common';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** 是否带边框（默认 true） */
  bordered?: boolean;
  /** 是否带阴影（默认 true） */
  elevated?: boolean;
  /** 圆角尺寸（默认 lg = 12px） */
  radius?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}

export function Card({
  children,
  className,
  bordered = true,
  elevated = true,
  radius = 'lg',
  onClick,
}: CardProps) {
  const radiusCls =
    radius === 'sm'
      ? 'rounded-md'
      : radius === 'md'
        ? 'rounded-lg'
        : 'rounded-xl';
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white',
        bordered && 'border border-gray-200',
        elevated && 'shadow-sm',
        radiusCls,
        onClick && 'cursor-pointer transition-colors hover:bg-gray-50',
        className
      )}
    >
      {children}
    </div>
  );
}
