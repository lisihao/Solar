'use client';

/**
 * InsightBox - 洞察框组件
 *
 * 功能：
 * - 高亮显示关键洞察
 * - 支持图标
 * - 支持不同强调级别
 */

import React, { type ReactNode } from 'react';
import '../styles/slide-tokens.css';

export interface InsightBoxProps {
  /** 洞察内容 */
  children: ReactNode;
  /** 标题 */
  title?: string;
  /** 图标 */
  icon?: ReactNode;
  /** 强调级别 */
  emphasis?: 'high' | 'medium' | 'low';
  /** 自定义颜色 */
  color?: string;
  /** 自定义类名 */
  className?: string;
}

export function InsightBox({
  children,
  title,
  icon,
  emphasis = 'medium',
  color,
  className = '',
}: InsightBoxProps) {
  // 根据强调级别确定颜色
  const getColor = () => {
    if (color) return color;
    switch (emphasis) {
      case 'high':
        return 'var(--slide-accent-gold)';
      case 'medium':
        return 'var(--slide-accent-blue)';
      case 'low':
        return 'var(--slide-accent-cyan)';
      default:
        return 'var(--slide-accent-blue)';
    }
  };

  const emphasisColor = getColor();

  return (
    <div
      className={`slide-insight-box ${className}`}
      style={{
        borderLeft: `4px solid ${emphasisColor}`,
        background: 'var(--slide-bg-card)',
        backdropFilter: 'blur(10px)',
        borderRadius: 'var(--slide-radius-md)',
        padding: 'var(--slide-space-lg)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景光效 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: `linear-gradient(90deg, ${emphasisColor}05 0%, transparent 50%)`,
          pointerEvents: 'none',
        }}
      />

      {/* 内容区 */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* 标题行 */}
        {(title || icon) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--slide-space-sm)',
              marginBottom: 'var(--slide-space-md)',
            }}
          >
            {icon && (
              <div
                style={{
                  color: emphasisColor,
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '20px',
                }}
              >
                {icon}
              </div>
            )}
            {title && (
              <h4
                style={{
                  fontSize: 'var(--slide-font-h3)',
                  fontWeight: 'var(--slide-font-weight-semibold)',
                  color: 'var(--slide-text-primary)',
                  margin: 0,
                }}
              >
                {title}
              </h4>
            )}
          </div>
        )}

        {/* 洞察内容 */}
        <div
          style={{
            fontSize: 'var(--slide-font-body)',
            lineHeight: 'var(--slide-line-height-relaxed)',
            color: 'var(--slide-text-secondary)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default InsightBox;
