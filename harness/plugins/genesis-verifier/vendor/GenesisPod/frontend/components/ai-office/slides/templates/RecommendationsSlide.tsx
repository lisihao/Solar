'use client';

/**
 * RecommendationsSlide - 建议页模板
 *
 * 功能：
 * - 展示行动建议
 * - 支持优先级标记
 * - 支持时间线展示
 */

import React from 'react';
import type { RecommendationsSlideContent } from '@/lib/types/slides';
import { SlideTag } from '../base';
import '../styles/slide-tokens.css';

export interface RecommendationsSlideProps {
  content: RecommendationsSlideContent;
  className?: string;
}

export function RecommendationsSlide({
  content,
  className = '',
}: RecommendationsSlideProps) {
  // 优先级颜色映射
  const getPriorityColor = (
    priority: 'critical' | 'high' | 'medium' | 'low'
  ) => {
    switch (priority) {
      case 'critical':
        return 'var(--slide-priority-critical)';
      case 'high':
        return 'var(--slide-priority-high)';
      case 'medium':
        return 'var(--slide-priority-medium)';
      case 'low':
        return 'var(--slide-priority-low)';
    }
  };

  return (
    <div
      className={`recommendations-slide ${className}`}
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

      {/* 总结 */}
      {content.summary && (
        <div
          style={{
            marginBottom: 'var(--slide-space-lg)',
            padding: 'var(--slide-space-md)',
            background: 'var(--slide-bg-card)',
            border: '1px solid var(--slide-border-color)',
            borderRadius: 'var(--slide-radius-md)',
            fontSize: 'var(--slide-font-body)',
            color: 'var(--slide-text-secondary)',
            lineHeight: 'var(--slide-line-height-relaxed)',
          }}
        >
          {content.summary}
        </div>
      )}

      {/* 建议列表 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--slide-space-md)',
          overflowY: 'auto',
        }}
      >
        {content.recommendations.map((rec) => {
          const priorityColor = getPriorityColor(rec.priority);

          return (
            <div
              key={rec.id}
              style={{
                display: 'flex',
                gap: 'var(--slide-space-md)',
                padding: 'var(--slide-space-lg)',
                background:
                  rec.priority === 'critical'
                    ? `${priorityColor}15`
                    : 'var(--slide-bg-card)',
                border: `1px solid ${rec.priority === 'critical' ? priorityColor : 'var(--slide-border-color)'}`,
                borderLeft: `4px solid ${priorityColor}`,
                borderRadius: 'var(--slide-radius-md)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {/* 编号或图标 */}
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: `${priorityColor}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {rec.icon ? (
                  <span style={{ fontSize: '20px', color: priorityColor }}>
                    {rec.icon}
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 'var(--slide-font-h3)',
                      fontWeight: 'var(--slide-font-weight-bold)',
                      color: priorityColor,
                    }}
                  >
                    {rec.number || ''}
                  </span>
                )}
              </div>

              {/* 内容 */}
              <div style={{ flex: 1 }}>
                {/* 标题行 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--slide-space-sm)',
                    marginBottom: 'var(--slide-space-sm)',
                    flexWrap: 'wrap',
                  }}
                >
                  <h4
                    style={{
                      margin: 0,
                      fontSize: 'var(--slide-font-h3)',
                      fontWeight: 'var(--slide-font-weight-semibold)',
                      color: 'var(--slide-text-primary)',
                    }}
                  >
                    {rec.title}
                  </h4>

                  {/* 标签 */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <SlideTag
                      variant={
                        rec.priority === 'critical'
                          ? 'red'
                          : rec.priority === 'high'
                            ? 'gold'
                            : rec.priority === 'medium'
                              ? 'primary'
                              : 'gray'
                      }
                      size="small"
                    >
                      {rec.priority}
                    </SlideTag>

                    {rec.timeframe && (
                      <SlideTag variant="cyan" size="small">
                        {rec.timeframe}
                      </SlideTag>
                    )}

                    {rec.effort && (
                      <SlideTag variant="purple" size="small">
                        {rec.effort} effort
                      </SlideTag>
                    )}
                  </div>
                </div>

                {/* 描述 */}
                <p
                  style={{
                    margin: 0,
                    fontSize: 'var(--slide-font-body)',
                    color: 'var(--slide-text-secondary)',
                    lineHeight: 'var(--slide-line-height-relaxed)',
                  }}
                >
                  {rec.description}
                </p>

                {/* 元信息 */}
                {(rec.owner || rec.category) && (
                  <div
                    style={{
                      marginTop: 'var(--slide-space-sm)',
                      fontSize: 'var(--slide-font-caption)',
                      color: 'var(--slide-text-tertiary)',
                    }}
                  >
                    {rec.category && <span>分类: {rec.category}</span>}
                    {rec.owner && (
                      <span style={{ marginLeft: '12px' }}>
                        负责人: {rec.owner}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 行动号召 */}
      {content.callToAction && (
        <div
          style={{
            marginTop: 'var(--slide-space-lg)',
            textAlign: 'center',
            padding: 'var(--slide-space-lg)',
            background: 'var(--slide-gradient-primary)',
            borderRadius: 'var(--slide-radius-md)',
            fontSize: 'var(--slide-font-h3)',
            fontWeight: 'var(--slide-font-weight-semibold)',
            color: 'white',
          }}
        >
          {content.callToAction}
        </div>
      )}
    </div>
  );
}

export default RecommendationsSlide;
