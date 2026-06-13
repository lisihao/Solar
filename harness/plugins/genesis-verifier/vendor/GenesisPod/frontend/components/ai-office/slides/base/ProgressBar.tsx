'use client';

/**
 * ProgressBar - 进度条组件
 *
 * 功能：
 * - 显示进度百分比
 * - 支持渐变效果
 * - 支持标签显示
 */

import React from 'react';
import '../styles/slide-tokens.css';

export interface ProgressBarProps {
  /** 进度值 (0-100) */
  value: number;
  /** 标签 */
  label?: string;
  /** 显示百分比文本 */
  showPercentage?: boolean;
  /** 颜色 */
  color?: string;
  /** 使用渐变 */
  gradient?: boolean;
  /** 高度 */
  height?: number;
  /** 自定义类名 */
  className?: string;
}

export function ProgressBar({
  value,
  label,
  showPercentage = true,
  color = 'var(--slide-accent-blue)',
  gradient = false,
  height = 8,
  className = '',
}: ProgressBarProps) {
  // 限制值在 0-100 之间
  const normalizedValue = Math.max(0, Math.min(100, value));

  // 渐变背景
  const fillBackground = gradient
    ? `linear-gradient(90deg, ${color} 0%, ${color}80 100%)`
    : color;

  return (
    <div className={`progress-bar ${className}`} style={{ width: '100%' }}>
      {/* 标签行 */}
      {(label || showPercentage) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--slide-space-xs)',
          }}
        >
          {label && (
            <span
              style={{
                fontSize: 'var(--slide-font-caption)',
                fontWeight: 'var(--slide-font-weight-medium)',
                color: 'var(--slide-text-secondary)',
              }}
            >
              {label}
            </span>
          )}
          {showPercentage && (
            <span
              style={{
                fontSize: 'var(--slide-font-caption)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-text-primary)',
              }}
            >
              {normalizedValue}%
            </span>
          )}
        </div>
      )}

      {/* 进度条容器 */}
      <div
        style={{
          width: '100%',
          height: `${height}px`,
          background: 'var(--slide-progress-bg)',
          borderRadius: 'var(--slide-radius-full)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* 进度条填充 */}
        <div
          style={{
            width: `${normalizedValue}%`,
            height: '100%',
            background: fillBackground,
            borderRadius: 'var(--slide-radius-full)',
            transition: 'width var(--slide-transition-slow)',
            position: 'relative',
          }}
        >
          {/* 光泽效果 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '50%',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)',
              borderRadius: 'var(--slide-radius-full)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default ProgressBar;
