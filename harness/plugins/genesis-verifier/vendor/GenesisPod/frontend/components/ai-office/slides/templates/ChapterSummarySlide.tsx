'use client';

/**
 * ChapterSummarySlide - 章节摘要页模板
 *
 * 功能：
 * - 展示章节要点
 * - 支持图标
 * - 支持高亮要点
 */

import React from 'react';
import type { ChapterSummarySlideContent } from '@/lib/types/slides';
import { SlideCard } from '../base';
import '../styles/slide-tokens.css';

export interface ChapterSummarySlideProps {
  content: ChapterSummarySlideContent;
  className?: string;
}

export function ChapterSummarySlide({
  content,
  className = '',
}: ChapterSummarySlideProps) {
  return (
    <div
      className={`chapter-summary-slide ${className}`}
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
      <h2
        style={{
          fontSize: 'var(--slide-font-h1)',
          fontWeight: 'var(--slide-font-weight-bold)',
          color: 'var(--slide-text-primary)',
          marginBottom: 'var(--slide-space-xl)',
          paddingBottom: 'var(--slide-space-md)',
          borderBottom: '2px solid var(--slide-accent-blue)',
        }}
      >
        {content.title}
      </h2>

      {/* 要点列表 */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns:
            content.keyPoints.length > 4 ? 'repeat(2, 1fr)' : '1fr',
          gap: 'var(--slide-space-lg)',
        }}
      >
        {content.keyPoints.map((point, index) => (
          <SlideCard
            key={index}
            title={point.title}
            icon={
              point.icon ? (
                <span style={{ fontSize: '24px' }}>{point.icon}</span>
              ) : (
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: point.highlight
                      ? 'var(--slide-accent-gold)'
                      : 'var(--slide-accent-blue)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--slide-font-caption)',
                    fontWeight: 'var(--slide-font-weight-bold)',
                    color: 'white',
                  }}
                >
                  {index + 1}
                </div>
              )
            }
            highlight={point.highlight}
            highlightColor={
              point.highlight
                ? 'var(--slide-accent-gold)'
                : 'var(--slide-accent-blue)'
            }
          >
            <p
              style={{
                margin: 0,
                lineHeight: 'var(--slide-line-height-relaxed)',
              }}
            >
              {point.description}
            </p>
          </SlideCard>
        ))}
      </div>

      {/* 总结 */}
      {content.summary && (
        <div
          style={{
            marginTop: 'var(--slide-space-xl)',
            padding: 'var(--slide-space-lg)',
            background: 'var(--slide-accent-blue)10',
            border: '1px solid var(--slide-accent-blue)30',
            borderRadius: 'var(--slide-radius-lg)',
            fontSize: 'var(--slide-font-body)',
            color: 'var(--slide-text-secondary)',
            lineHeight: 'var(--slide-line-height-relaxed)',
          }}
        >
          {content.summary}
        </div>
      )}

      {/* 过渡文本 */}
      {content.transitionText && (
        <div
          style={{
            marginTop: 'var(--slide-space-md)',
            textAlign: 'center',
            fontSize: 'var(--slide-font-body)',
            color: 'var(--slide-text-tertiary)',
            fontStyle: 'italic',
          }}
        >
          {content.transitionText}
        </div>
      )}
    </div>
  );
}

export default ChapterSummarySlide;
