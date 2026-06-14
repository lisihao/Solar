'use client';

/**
 * DashboardSlide - 仪表盘页模板
 *
 * 功能：
 * - KPI 指标展示
 * - 支持多种图表
 * - 响应式网格布局
 */

import React from 'react';
import type { DashboardSlideContent } from '@/lib/types/slides';
import { KpiCard } from '../base';
import '../styles/slide-tokens.css';

export interface DashboardSlideProps {
  content: DashboardSlideContent;
  className?: string;
}

export function DashboardSlide({
  content,
  className = '',
}: DashboardSlideProps) {
  return (
    <div
      className={`dashboard-slide ${className}`}
      style={{
        width: '100%',
        height: '100%',
        background:
          'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
        padding: 'var(--slide-space-2xl)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 标题 */}
      <div style={{ marginBottom: 'var(--slide-space-xl)' }}>
        <h2
          style={{
            fontSize: 'var(--slide-font-h1)',
            fontWeight: 'var(--slide-font-weight-bold)',
            color: 'var(--slide-text-primary)',
            marginBottom: content.subtitle ? 'var(--slide-space-sm)' : 0,
          }}
        >
          {content.title}
        </h2>
        {content.subtitle && (
          <p
            style={{
              fontSize: 'var(--slide-font-body)',
              color: 'var(--slide-text-tertiary)',
            }}
          >
            {content.subtitle}
          </p>
        )}
      </div>

      {/* 指标网格 */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns:
            content.layout === 'grid'
              ? 'repeat(auto-fit, minmax(200px, 1fr))'
              : '1fr',
          gap: 'var(--slide-space-lg)',
          alignContent: 'start',
        }}
      >
        {content.metrics.map((metric) => {
          // 图标映射（简化示例）
          const getIcon = () => {
            if (metric.icon) {
              return <span>{metric.icon}</span>;
            }
            return null;
          };

          return (
            <KpiCard
              key={metric.id}
              label={metric.label}
              value={metric.value}
              unit={metric.unit}
              trend={metric.trend}
              trendValue={metric.trendValue}
              icon={getIcon()}
              color={metric.color}
              size={metric.size || 'medium'}
            />
          );
        })}
      </div>

      {/* 总结 */}
      {content.summary && (
        <div
          style={{
            marginTop: 'var(--slide-space-lg)',
            padding: 'var(--slide-space-md)',
            background: 'var(--slide-bg-card)',
            border: '1px solid var(--slide-border-color)',
            borderRadius: 'var(--slide-radius-md)',
            fontSize: 'var(--slide-font-body)',
            color: 'var(--slide-text-tertiary)',
            textAlign: 'center',
          }}
        >
          {content.summary}
        </div>
      )}
    </div>
  );
}

export default DashboardSlide;
