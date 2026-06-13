'use client';

/**
 * CoverSlide - 封面页模板
 *
 * 功能：
 * - 展示标题、副标题
 * - 支持作者、机构信息
 * - 支持背景图片
 */

import React from 'react';
import type { CoverSlideContent } from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface CoverSlideProps {
  content: CoverSlideContent;
  className?: string;
}

export function CoverSlide({ content, className = '' }: CoverSlideProps) {
  return (
    <div
      className={`cover-slide ${className}`}
      style={{
        width: '100%',
        height: '100%',
        background: content.backgroundImage
          ? `linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(15, 23, 42, 0.7) 100%), url(${content.backgroundImage})`
          : 'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        padding: 'var(--slide-space-2xl)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 装饰光效 */}
      <div
        style={{
          position: 'absolute',
          top: '-50%',
          left: '-50%',
          width: '200%',
          height: '200%',
          background:
            'radial-gradient(circle, var(--slide-accent-blue)10 0%, transparent 50%)',
          pointerEvents: 'none',
        }}
      />

      {/* Logo */}
      {content.logo && (
        <div style={{ marginBottom: 'var(--slide-space-xl)' }}>
          <img
            src={content.logo}
            alt="Logo"
            style={{
              maxWidth: '120px',
              maxHeight: '60px',
              objectFit: 'contain',
            }}
          />
        </div>
      )}

      {/* 主标题 */}
      <h1
        className="slide-text-gradient"
        style={{
          fontSize: 'var(--slide-font-display)',
          fontWeight: 'var(--slide-font-weight-bold)',
          color: 'var(--slide-text-primary)',
          lineHeight: 'var(--slide-line-height-tight)',
          letterSpacing: 'var(--slide-letter-spacing-tight)',
          marginBottom: 'var(--slide-space-lg)',
          maxWidth: '80%',
          position: 'relative',
        }}
      >
        {content.title}
      </h1>

      {/* 副标题 */}
      {content.subtitle && (
        <p
          style={{
            fontSize: 'var(--slide-font-h1)',
            color: 'var(--slide-text-secondary)',
            lineHeight: 'var(--slide-line-height-normal)',
            marginBottom: 'var(--slide-space-xl)',
            maxWidth: '70%',
          }}
        >
          {content.subtitle}
        </p>
      )}

      {/* Tagline */}
      {content.tagline && (
        <div
          style={{
            fontSize: 'var(--slide-font-h3)',
            color: 'var(--slide-accent-blue)',
            fontWeight: 'var(--slide-font-weight-medium)',
            marginBottom: 'var(--slide-space-2xl)',
            padding: '8px 24px',
            border: '1px solid var(--slide-accent-blue)40',
            borderRadius: 'var(--slide-radius-full)',
            background: 'var(--slide-accent-blue)10',
          }}
        >
          {content.tagline}
        </div>
      )}

      {/* 元信息（作者、机构、日期） */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--slide-space-sm)',
          fontSize: 'var(--slide-font-body)',
          color: 'var(--slide-text-tertiary)',
          marginTop: 'auto',
        }}
      >
        {content.author && <div>{content.author}</div>}
        {content.organization && <div>{content.organization}</div>}
        {content.date && <div>{content.date}</div>}
      </div>
    </div>
  );
}

export default CoverSlide;
