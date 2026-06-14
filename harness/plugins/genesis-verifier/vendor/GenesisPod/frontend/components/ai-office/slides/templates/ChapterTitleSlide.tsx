'use client';

/**
 * ChapterTitleSlide - 章节标题页模板
 *
 * 功能：
 * - 章节过渡页
 * - 支持大号章节号
 * - 支持背景图片
 */

import React from 'react';
import type { ChapterTitleSlideContent } from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface ChapterTitleSlideProps {
  content: ChapterTitleSlideContent;
  className?: string;
}

export function ChapterTitleSlide({
  content,
  className = '',
}: ChapterTitleSlideProps) {
  return (
    <div
      className={`chapter-title-slide ${className}`}
      style={{
        width: '100%',
        height: '100%',
        background: content.backgroundImage
          ? `linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(30, 41, 59, 0.85) 100%), url(${content.backgroundImage})`
          : 'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 'var(--slide-space-2xl)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 大号章节号背景 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '10%',
          transform: 'translateY(-50%)',
          fontSize: '240px',
          fontWeight: 'var(--slide-font-weight-bold)',
          color: 'rgba(59, 130, 246, 0.08)',
          lineHeight: 1,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {content.chapterNumber.toString().padStart(2, '0')}
      </div>

      {/* 内容区 */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '70%' }}>
        {/* 章节号标签 */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--slide-space-sm)',
            marginBottom: 'var(--slide-space-lg)',
            padding: '8px 20px',
            background: 'var(--slide-accent-blue)20',
            border: '1px solid var(--slide-accent-blue)40',
            borderRadius: 'var(--slide-radius-full)',
          }}
        >
          {content.icon && (
            <span style={{ fontSize: '20px' }}>{content.icon}</span>
          )}
          <span
            style={{
              fontSize: 'var(--slide-font-body)',
              fontWeight: 'var(--slide-font-weight-semibold)',
              color: 'var(--slide-accent-blue)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--slide-letter-spacing-wide)',
            }}
          >
            第 {content.chapterNumber} 章
          </span>
        </div>

        {/* 章节标题 */}
        <h1
          style={{
            fontSize: 'var(--slide-font-display)',
            fontWeight: 'var(--slide-font-weight-bold)',
            color: 'var(--slide-text-primary)',
            lineHeight: 'var(--slide-line-height-tight)',
            letterSpacing: 'var(--slide-letter-spacing-tight)',
            marginBottom: content.subtitle
              ? 'var(--slide-space-lg)'
              : content.description
                ? 'var(--slide-space-xl)'
                : 0,
          }}
        >
          {content.title}
        </h1>

        {/* 副标题 */}
        {content.subtitle && (
          <p
            style={{
              fontSize: 'var(--slide-font-h2)',
              color: 'var(--slide-text-secondary)',
              lineHeight: 'var(--slide-line-height-normal)',
              marginBottom: content.description ? 'var(--slide-space-xl)' : 0,
            }}
          >
            {content.subtitle}
          </p>
        )}

        {/* 描述 */}
        {content.description && (
          <p
            style={{
              fontSize: 'var(--slide-font-body)',
              color: 'var(--slide-text-tertiary)',
              lineHeight: 'var(--slide-line-height-relaxed)',
              maxWidth: '90%',
            }}
          >
            {content.description}
          </p>
        )}

        {/* 装饰线 */}
        <div
          style={{
            width: '120px',
            height: '4px',
            background: 'var(--slide-gradient-primary)',
            borderRadius: 'var(--slide-radius-full)',
            marginTop: 'var(--slide-space-xl)',
          }}
        />
      </div>
    </div>
  );
}

export default ChapterTitleSlide;
