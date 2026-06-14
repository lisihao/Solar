'use client';

/**
 * EvolutionRoadmapSlide - 演进路线图页模板
 *
 * 功能：
 * - 阶段展示（3-5个阶段）
 * - 支持水平/垂直布局
 * - 当前阶段高亮
 * - 进度显示
 */

import React from 'react';
import type { EvolutionRoadmapSlideContent } from '@/lib/types/slides';
import { ProgressBar } from '../base';
import '../styles/slide-tokens.css';

export interface EvolutionRoadmapSlideProps {
  content: EvolutionRoadmapSlideContent;
  className?: string;
}

// 状态颜色映射
const STATUS_COLORS = {
  completed: 'var(--slide-status-up)',
  in_progress: 'var(--slide-accent-gold)',
  planned: 'var(--slide-accent-primary)',
  future: 'var(--slide-text-tertiary)',
};

// 状态图标映射
const STATUS_ICONS = {
  completed: '✓',
  in_progress: '●',
  planned: '○',
  future: '◌',
};

export function EvolutionRoadmapSlide({
  content,
  className = '',
}: EvolutionRoadmapSlideProps) {
  const isHorizontal = content.orientation === 'horizontal';
  const completedStages = content.stages.filter(
    (s) => s.status === 'completed'
  ).length;
  const progressPercent = (completedStages / content.stages.length) * 100;

  return (
    <div
      className={`evolution-roadmap-slide ${className}`}
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
      {/* 标题区域 */}
      <div style={{ marginBottom: 'var(--slide-space-xl)' }}>
        <h2
          style={{
            fontSize: 'var(--slide-font-h1)',
            fontWeight: 'var(--slide-font-weight-bold)',
            color: 'var(--slide-text-primary)',
            marginBottom: content.description ? 'var(--slide-space-sm)' : 0,
          }}
        >
          {content.title}
        </h2>
        {content.description && (
          <p
            style={{
              fontSize: 'var(--slide-font-body)',
              color: 'var(--slide-text-tertiary)',
              lineHeight: 'var(--slide-line-height-normal)',
            }}
          >
            {content.description}
          </p>
        )}
      </div>

      {/* 进度条 */}
      {content.showProgress && (
        <div style={{ marginBottom: 'var(--slide-space-lg)' }}>
          <ProgressBar
            value={progressPercent}
            label={`${completedStages}/${content.stages.length} 阶段完成`}
            showPercentage={true}
          />
        </div>
      )}

      {/* 路线图主体 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          gap: 'var(--slide-space-lg)',
          overflow: 'auto',
          alignItems: isHorizontal ? 'stretch' : 'stretch',
        }}
      >
        {content.stages.map((stage, index) => {
          const isCurrent = content.currentStage === index;
          const statusColor = stage.color || STATUS_COLORS[stage.status];

          return (
            <div
              key={stage.id}
              style={{
                flex: isHorizontal ? 1 : 'none',
                display: 'flex',
                flexDirection: isHorizontal ? 'column' : 'row',
                gap: 'var(--slide-space-md)',
                position: 'relative',
              }}
            >
              {/* 连接线 */}
              {index < content.stages.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    ...(isHorizontal
                      ? {
                          top: '20px',
                          left: '50%',
                          right: '-50%',
                          height: '2px',
                        }
                      : {
                          left: '20px',
                          top: '50px',
                          bottom: '-30px',
                          width: '2px',
                        }),
                    background:
                      stage.status === 'completed'
                        ? 'var(--slide-status-up)'
                        : 'var(--slide-border-color)',
                    zIndex: 0,
                  }}
                />
              )}

              {/* 阶段标记 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: isHorizontal ? 'column' : 'row',
                  alignItems: 'center',
                  gap: 'var(--slide-space-sm)',
                  zIndex: 1,
                }}
              >
                {/* 状态圆圈 */}
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: isCurrent
                      ? statusColor
                      : 'var(--slide-bg-card)',
                    border: `3px solid ${statusColor}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--slide-font-body)',
                    fontWeight: 'var(--slide-font-weight-bold)',
                    color: isCurrent ? 'white' : statusColor,
                    flexShrink: 0,
                    boxShadow: isCurrent
                      ? `0 0 0 4px ${statusColor}30`
                      : 'none',
                  }}
                >
                  {stage.icon || STATUS_ICONS[stage.status]}
                </div>

                {/* 阶段信息 */}
                <div
                  style={{
                    flex: 1,
                    textAlign: isHorizontal ? 'center' : 'left',
                  }}
                >
                  {stage.phase && (
                    <span
                      style={{
                        fontSize: 'var(--slide-font-small)',
                        color: statusColor,
                        fontWeight: 'var(--slide-font-weight-semibold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {stage.phase}
                    </span>
                  )}
                  <h4
                    style={{
                      fontSize: 'var(--slide-font-h4)',
                      fontWeight: 'var(--slide-font-weight-semibold)',
                      color: isCurrent
                        ? 'var(--slide-text-primary)'
                        : 'var(--slide-text-secondary)',
                      margin: 'var(--slide-space-xs) 0',
                    }}
                  >
                    {stage.title}
                  </h4>
                  {stage.timeframe && (
                    <span
                      style={{
                        fontSize: 'var(--slide-font-small)',
                        color: 'var(--slide-text-tertiary)',
                      }}
                    >
                      {stage.timeframe}
                    </span>
                  )}
                </div>
              </div>

              {/* 阶段详情卡片 */}
              <div
                style={{
                  background: isCurrent
                    ? `${statusColor}10`
                    : 'var(--slide-bg-card)',
                  borderRadius: 'var(--slide-radius-md)',
                  padding: 'var(--slide-space-md)',
                  border: isCurrent
                    ? `1px solid ${statusColor}40`
                    : '1px solid var(--slide-border-color)',
                  marginLeft: isHorizontal
                    ? 0
                    : 'calc(40px + var(--slide-space-md))',
                }}
              >
                <p
                  style={{
                    fontSize: 'var(--slide-font-body)',
                    color: 'var(--slide-text-secondary)',
                    lineHeight: 'var(--slide-line-height-normal)',
                    marginBottom:
                      stage.milestones?.length || stage.deliverables?.length
                        ? 'var(--slide-space-sm)'
                        : 0,
                  }}
                >
                  {stage.description}
                </p>

                {/* 里程碑 */}
                {stage.milestones && stage.milestones.length > 0 && (
                  <div style={{ marginTop: 'var(--slide-space-sm)' }}>
                    <span
                      style={{
                        fontSize: 'var(--slide-font-small)',
                        color: 'var(--slide-text-tertiary)',
                        fontWeight: 'var(--slide-font-weight-semibold)',
                      }}
                    >
                      里程碑:
                    </span>
                    <ul
                      style={{
                        margin: 'var(--slide-space-xs) 0 0',
                        paddingLeft: 'var(--slide-space-md)',
                      }}
                    >
                      {stage.milestones.map((m, i) => (
                        <li
                          key={i}
                          style={{
                            fontSize: 'var(--slide-font-small)',
                            color: 'var(--slide-text-tertiary)',
                          }}
                        >
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 交付物 */}
                {stage.deliverables && stage.deliverables.length > 0 && (
                  <div style={{ marginTop: 'var(--slide-space-sm)' }}>
                    <span
                      style={{
                        fontSize: 'var(--slide-font-small)',
                        color: 'var(--slide-text-tertiary)',
                        fontWeight: 'var(--slide-font-weight-semibold)',
                      }}
                    >
                      交付物:
                    </span>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'var(--slide-space-xs)',
                        marginTop: 'var(--slide-space-xs)',
                      }}
                    >
                      {stage.deliverables.map((d, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 'var(--slide-font-small)',
                            padding: '2px 8px',
                            background: 'var(--slide-bg-tertiary)',
                            borderRadius: 'var(--slide-radius-sm)',
                            color: 'var(--slide-text-tertiary)',
                          }}
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default EvolutionRoadmapSlide;
