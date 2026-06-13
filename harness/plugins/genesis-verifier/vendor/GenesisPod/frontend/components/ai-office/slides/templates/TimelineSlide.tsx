'use client';

/**
 * TimelineSlide - 时间线页模板
 *
 * 功能：
 * - 水平/垂直时间线展示
 * - 支持事件状态
 * - 支持高亮当前事件
 */

import React from 'react';
import type { TimelineSlideContent } from '@/lib/types/slides';
import { SlideTimeline } from '../base';
import '../styles/slide-tokens.css';

export interface TimelineSlideProps {
  content: TimelineSlideContent;
  className?: string;
}

export function TimelineSlide({ content, className = '' }: TimelineSlideProps) {
  return (
    <div
      className={`timeline-slide ${className}`}
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

      {/* 时间线 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <SlideTimeline
          events={content.events}
          orientation={content.orientation}
          showConnectors={content.showConnectors}
        />
      </div>
    </div>
  );
}

export default TimelineSlide;
