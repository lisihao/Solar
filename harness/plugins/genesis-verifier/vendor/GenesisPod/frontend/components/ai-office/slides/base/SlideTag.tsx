'use client';

/**
 * SlideTag - 标签组件
 *
 * 功能：
 * - 分类标记
 * - 状态显示
 * - 支持不同颜色和尺寸
 */

import React from 'react';
import '../styles/slide-tokens.css';

export interface SlideTagProps {
  /** 标签文本 */
  children: React.ReactNode;
  /** 颜色变体 */
  variant?: 'primary' | 'gold' | 'green' | 'red' | 'purple' | 'cyan' | 'gray';
  /** 大小 */
  size?: 'small' | 'medium' | 'large';
  /** 自定义类名 */
  className?: string;
}

export function SlideTag({
  children,
  variant = 'primary',
  size = 'medium',
  className = '',
}: SlideTagProps) {
  // 颜色映射
  const colorMap = {
    primary: 'var(--slide-accent-blue)',
    gold: 'var(--slide-accent-gold)',
    green: 'var(--slide-accent-green)',
    red: 'var(--slide-accent-red)',
    purple: 'var(--slide-accent-purple)',
    cyan: 'var(--slide-accent-cyan)',
    gray: 'var(--slide-text-tertiary)',
  };

  // 尺寸配置
  const sizeConfig = {
    small: {
      fontSize: 'var(--slide-font-tiny)',
      padding: '2px 8px',
    },
    medium: {
      fontSize: 'var(--slide-font-caption)',
      padding: '4px 12px',
    },
    large: {
      fontSize: 'var(--slide-font-body)',
      padding: '6px 16px',
    },
  };

  const color = colorMap[variant];
  const config = sizeConfig[size];

  return (
    <span
      className={`slide-tag ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: config.fontSize,
        fontWeight: 'var(--slide-font-weight-medium)',
        color: color,
        background: `${color}20`,
        border: `1px solid ${color}40`,
        borderRadius: 'var(--slide-radius-full)',
        padding: config.padding,
        textTransform: 'uppercase',
        letterSpacing: 'var(--slide-letter-spacing-wide)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export default SlideTag;
