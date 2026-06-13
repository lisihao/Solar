'use client';

/**
 * KpiCard - KPI 指标卡片
 *
 * 功能：
 * - 展示关键指标
 * - 支持趋势显示
 * - 支持单位和比较
 */

import React, { type ReactNode } from 'react';
import '../styles/slide-tokens.css';

export interface KpiCardProps {
  /** 指标标签 */
  label: string;
  /** 指标数值 */
  value: string | number;
  /** 单位 */
  unit?: string;
  /** 趋势方向 */
  trend?: 'up' | 'down' | 'stable';
  /** 趋势数值 */
  trendValue?: string;
  /** 图标 */
  icon?: ReactNode;
  /** 颜色 */
  color?: string;
  /** 大小 */
  size?: 'small' | 'medium' | 'large';
  /** 自定义类名 */
  className?: string;
}

export function KpiCard({
  label,
  value,
  unit,
  trend,
  trendValue,
  icon,
  color = 'var(--slide-accent-blue)',
  size = 'medium',
  className = '',
}: KpiCardProps) {
  // 趋势图标
  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ display: 'inline-block', marginLeft: '4px' }}
          >
            <path
              d="M8 3L13 8L11.59 9.41L9 6.83V13H7V6.83L4.41 9.41L3 8L8 3Z"
              fill="var(--slide-status-up)"
            />
          </svg>
        );
      case 'down':
        return (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ display: 'inline-block', marginLeft: '4px' }}
          >
            <path
              d="M8 13L3 8L4.41 6.59L7 9.17V3H9V9.17L11.59 6.59L13 8L8 13Z"
              fill="var(--slide-status-down)"
            />
          </svg>
        );
      case 'stable':
        return (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            style={{ display: 'inline-block', marginLeft: '4px' }}
          >
            <path d="M3 8H13V10H3V8Z" fill="var(--slide-status-stable)" />
          </svg>
        );
      default:
        return null;
    }
  };

  // 趋势颜色
  const getTrendColor = () => {
    switch (trend) {
      case 'up':
        return 'var(--slide-status-up)';
      case 'down':
        return 'var(--slide-status-down)';
      case 'stable':
        return 'var(--slide-status-stable)';
      default:
        return 'var(--slide-text-tertiary)';
    }
  };

  // 大小配置
  const sizeConfig = {
    small: {
      value: 'var(--slide-font-h2)',
      label: 'var(--slide-font-caption)',
      padding: 'var(--slide-space-md)',
    },
    medium: {
      value: 'var(--slide-font-h1)',
      label: 'var(--slide-font-body)',
      padding: 'var(--slide-space-lg)',
    },
    large: {
      value: 'var(--slide-font-display)',
      label: 'var(--slide-font-h3)',
      padding: 'var(--slide-space-xl)',
    },
  };

  const config = sizeConfig[size];

  return (
    <div
      className={`kpi-card ${className}`}
      style={{
        background: `linear-gradient(135deg, ${color}15 0%, var(--slide-bg-card) 100%)`,
        border: `var(--slide-border-width) solid ${color}40`,
        borderRadius: 'var(--slide-radius-lg)',
        padding: config.padding,
        backdropFilter: 'blur(10px)',
        transition: 'all var(--slide-transition-normal)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 背景装饰 */}
      <div
        style={{
          position: 'absolute',
          top: '-20px',
          right: '-20px',
          width: '80px',
          height: '80px',
          background: `radial-gradient(circle, ${color}10 0%, transparent 70%)`,
          borderRadius: '50%',
          pointerEvents: 'none',
        }}
      />

      {/* 图标 */}
      {icon && (
        <div
          style={{
            color: color,
            marginBottom: 'var(--slide-space-sm)',
            display: 'flex',
            alignItems: 'center',
            fontSize: size === 'large' ? '24px' : '20px',
          }}
        >
          {icon}
        </div>
      )}

      {/* 指标标签 */}
      <div
        style={{
          fontSize: config.label,
          color: 'var(--slide-text-tertiary)',
          marginBottom: 'var(--slide-space-xs)',
          fontWeight: 'var(--slide-font-weight-medium)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--slide-letter-spacing-wide)',
        }}
      >
        {label}
      </div>

      {/* 指标数值 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--slide-space-xs)',
        }}
      >
        <span
          style={{
            fontSize: config.value,
            fontWeight: 'var(--slide-font-weight-bold)',
            color: 'var(--slide-text-primary)',
            lineHeight: 'var(--slide-line-height-tight)',
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontSize: config.label,
              color: 'var(--slide-text-tertiary)',
              fontWeight: 'var(--slide-font-weight-normal)',
            }}
          >
            {unit}
          </span>
        )}
      </div>

      {/* 趋势信息 */}
      {(trend || trendValue) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginTop: 'var(--slide-space-sm)',
            fontSize: 'var(--slide-font-caption)',
            color: getTrendColor(),
            fontWeight: 'var(--slide-font-weight-medium)',
          }}
        >
          {trend && getTrendIcon()}
          {trendValue && (
            <span style={{ marginLeft: '4px' }}>{trendValue}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default KpiCard;
