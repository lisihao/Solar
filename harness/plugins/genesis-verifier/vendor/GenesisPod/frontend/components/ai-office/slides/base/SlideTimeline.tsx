'use client';

/**
 * SlideTimeline - 时间线组件
 *
 * 功能：
 * - 水平/垂直时间线
 * - 支持状态标记
 * - 支持高亮当前项
 */

import React from 'react';
import '../styles/slide-tokens.css';

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  description?: string;
  status?: 'past' | 'current' | 'future';
  highlight?: boolean;
  color?: string;
}

export interface SlideTimelineProps {
  /** 时间线事件 */
  events: TimelineEvent[];
  /** 方向 */
  orientation?: 'horizontal' | 'vertical';
  /** 显示连接线 */
  showConnectors?: boolean;
  /** 自定义类名 */
  className?: string;
}

export function SlideTimeline({
  events,
  orientation = 'horizontal',
  showConnectors = true,
  className = '',
}: SlideTimelineProps) {
  // 获取事件状态颜色
  const getStatusColor = (event: TimelineEvent) => {
    if (event.color) return event.color;
    switch (event.status) {
      case 'past':
        return 'var(--slide-text-tertiary)';
      case 'current':
        return 'var(--slide-accent-blue)';
      case 'future':
        return 'var(--slide-text-muted)';
      default:
        return 'var(--slide-accent-blue)';
    }
  };

  if (orientation === 'horizontal') {
    return (
      <div
        className={`slide-timeline-horizontal ${className}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--slide-space-md)',
          width: '100%',
        }}
      >
        {events.map((event, index) => {
          const color = getStatusColor(event);
          const isLast = index === events.length - 1;

          return (
            <React.Fragment key={event.id}>
              {/* 事件节点 */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                  gap: 'var(--slide-space-sm)',
                }}
              >
                {/* 圆点 */}
                <div
                  style={{
                    width: event.highlight ? '16px' : '12px',
                    height: event.highlight ? '16px' : '12px',
                    borderRadius: '50%',
                    background: color,
                    border: `2px solid ${color}`,
                    boxShadow:
                      event.status === 'current'
                        ? `0 0 12px ${color}80`
                        : 'none',
                    transition: 'all var(--slide-transition-normal)',
                  }}
                />

                {/* 日期 */}
                <div
                  style={{
                    fontSize: 'var(--slide-font-caption)',
                    fontWeight: 'var(--slide-font-weight-semibold)',
                    color:
                      event.status === 'current'
                        ? color
                        : 'var(--slide-text-tertiary)',
                  }}
                >
                  {event.date}
                </div>

                {/* 标题 */}
                <div
                  style={{
                    fontSize: 'var(--slide-font-body)',
                    fontWeight:
                      event.status === 'current'
                        ? 'var(--slide-font-weight-semibold)'
                        : 'var(--slide-font-weight-normal)',
                    color:
                      event.status === 'current'
                        ? 'var(--slide-text-primary)'
                        : 'var(--slide-text-secondary)',
                  }}
                >
                  {event.title}
                </div>

                {/* 描述 */}
                {event.description && (
                  <div
                    style={{
                      fontSize: 'var(--slide-font-caption)',
                      color: 'var(--slide-text-tertiary)',
                      lineHeight: 'var(--slide-line-height-normal)',
                    }}
                  >
                    {event.description}
                  </div>
                )}
              </div>

              {/* 连接线 */}
              {showConnectors && !isLast && (
                <div
                  className="slide-timeline-connector"
                  style={{
                    flex: 0.5,
                    height: '2px',
                    background: 'var(--slide-border-color-strong)',
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  // 垂直时间线
  return (
    <div
      className={`slide-timeline-vertical ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--slide-space-lg)',
      }}
    >
      {events.map((event, index) => {
        const color = getStatusColor(event);
        const isLast = index === events.length - 1;

        return (
          <div
            key={event.id}
            style={{
              display: 'flex',
              gap: 'var(--slide-space-md)',
              position: 'relative',
            }}
          >
            {/* 左侧时间轴 */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--slide-space-xs)',
              }}
            >
              {/* 圆点 */}
              <div
                style={{
                  width: event.highlight ? '16px' : '12px',
                  height: event.highlight ? '16px' : '12px',
                  borderRadius: '50%',
                  background: color,
                  border: `2px solid ${color}`,
                  boxShadow:
                    event.status === 'current' ? `0 0 12px ${color}80` : 'none',
                  flexShrink: 0,
                }}
              />

              {/* 连接线 */}
              {showConnectors && !isLast && (
                <div
                  style={{
                    width: '2px',
                    flex: 1,
                    background: 'var(--slide-border-color-strong)',
                    minHeight: '40px',
                  }}
                />
              )}
            </div>

            {/* 右侧内容 */}
            <div style={{ flex: 1, paddingBottom: 'var(--slide-space-md)' }}>
              {/* 日期 */}
              <div
                style={{
                  fontSize: 'var(--slide-font-caption)',
                  fontWeight: 'var(--slide-font-weight-semibold)',
                  color:
                    event.status === 'current'
                      ? color
                      : 'var(--slide-text-tertiary)',
                  marginBottom: 'var(--slide-space-xs)',
                }}
              >
                {event.date}
              </div>

              {/* 标题 */}
              <div
                style={{
                  fontSize: 'var(--slide-font-h3)',
                  fontWeight:
                    event.status === 'current'
                      ? 'var(--slide-font-weight-semibold)'
                      : 'var(--slide-font-weight-normal)',
                  color:
                    event.status === 'current'
                      ? 'var(--slide-text-primary)'
                      : 'var(--slide-text-secondary)',
                  marginBottom: event.description ? 'var(--slide-space-xs)' : 0,
                }}
              >
                {event.title}
              </div>

              {/* 描述 */}
              {event.description && (
                <div
                  style={{
                    fontSize: 'var(--slide-font-body)',
                    color: 'var(--slide-text-tertiary)',
                    lineHeight: 'var(--slide-line-height-normal)',
                  }}
                >
                  {event.description}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SlideTimeline;
