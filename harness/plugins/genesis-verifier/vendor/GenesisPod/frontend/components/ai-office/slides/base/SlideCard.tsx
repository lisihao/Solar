'use client';

/**
 * SlideCard - 通用卡片组件
 *
 * 功能：
 * - 支持深色主题
 * - 支持高亮状态
 * - 支持图标
 * - 支持渐变背景
 */

import React, { type ReactNode } from 'react';
import '../styles/slide-tokens.css';

export interface SlideCardProps {
  /** 卡片标题 */
  title?: string;
  /** 卡片内容 */
  children: ReactNode;
  /** 图标 */
  icon?: ReactNode;
  /** 是否高亮 */
  highlight?: boolean;
  /** 高亮颜色 */
  highlightColor?: string;
  /** 自定义类名 */
  className?: string;
  /** 是否使用渐变背景 */
  gradient?: boolean;
  /** 点击事件 */
  onClick?: () => void;
}

export function SlideCard({
  title,
  children,
  icon,
  highlight = false,
  highlightColor = 'var(--slide-accent-blue)',
  className = '',
  gradient = false,
  onClick,
}: SlideCardProps) {
  return (
    <div
      className={`slide-card ${gradient ? 'slide-kpi-gradient' : ''} ${className}`}
      style={{
        background: gradient
          ? undefined
          : highlight
            ? `linear-gradient(135deg, ${highlightColor}15 0%, var(--slide-bg-card) 100%)`
            : 'var(--slide-bg-card)',
        border: `var(--slide-border-width) solid ${highlight ? highlightColor : 'var(--slide-border-color)'}`,
        borderRadius: 'var(--slide-radius-lg)',
        padding: 'var(--slide-space-lg)',
        backdropFilter: 'blur(10px)',
        transition: 'all var(--slide-transition-normal)',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = 'var(--slide-shadow-lg)';
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'var(--slide-shadow-sm)';
        }
      }}
    >
      {/* 标题栏 */}
      {(title || icon) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--slide-space-sm)',
            marginBottom: title ? 'var(--slide-space-md)' : 0,
          }}
        >
          {icon && (
            <div
              style={{
                color: highlight ? highlightColor : 'var(--slide-accent-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </div>
          )}
          {title && (
            <h3
              style={{
                fontSize: 'var(--slide-font-h3)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-text-primary)',
                margin: 0,
                lineHeight: 'var(--slide-line-height-tight)',
              }}
            >
              {title}
            </h3>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div
        style={{
          color: 'var(--slide-text-secondary)',
          fontSize: 'var(--slide-font-body)',
          lineHeight: 'var(--slide-line-height-normal)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default SlideCard;
