'use client';

/**
 * TocSlide - 目录页模板
 *
 * 功能：
 * - 展示目录结构
 * - 支持编号/图标/卡片样式
 * - 支持当前项高亮
 */

import React from 'react';
import type { TocSlideContent } from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface TocSlideProps {
  content: TocSlideContent;
  className?: string;
}

export function TocSlide({ content, className = '' }: TocSlideProps) {
  const style = content.style || 'numbered';

  return (
    <div
      className={`toc-slide ${className}`}
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

      {/* 目录项 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap:
            style === 'cards'
              ? 'var(--slide-space-lg)'
              : 'var(--slide-space-md)',
        }}
      >
        {content.items.map((item) => {
          if (style === 'cards') {
            return (
              <div
                key={item.number}
                style={{
                  background: item.isActive
                    ? 'var(--slide-accent-blue)15'
                    : 'var(--slide-bg-card)',
                  border: `1px solid ${item.isActive ? 'var(--slide-accent-blue)' : 'var(--slide-border-color)'}`,
                  borderRadius: 'var(--slide-radius-lg)',
                  padding: 'var(--slide-space-lg)',
                  backdropFilter: 'blur(10px)',
                  transition: 'all var(--slide-transition-normal)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--slide-space-md)',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: item.isActive
                        ? 'var(--slide-accent-blue)'
                        : 'var(--slide-bg-tertiary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--slide-font-h3)',
                      fontWeight: 'var(--slide-font-weight-bold)',
                      color: item.isActive
                        ? 'white'
                        : 'var(--slide-text-tertiary)',
                      flexShrink: 0,
                    }}
                  >
                    {item.number}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 'var(--slide-font-h3)',
                        fontWeight: 'var(--slide-font-weight-semibold)',
                        color: item.isActive
                          ? 'var(--slide-accent-blue)'
                          : 'var(--slide-text-primary)',
                        marginBottom: item.subtitle
                          ? 'var(--slide-space-xs)'
                          : 0,
                      }}
                    >
                      {item.title}
                    </div>
                    {item.subtitle && (
                      <div
                        style={{
                          fontSize: 'var(--slide-font-body)',
                          color: 'var(--slide-text-tertiary)',
                        }}
                      >
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          // numbered 或 icons 样式
          return (
            <div
              key={item.number}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--slide-space-md)',
                padding: 'var(--slide-space-md)',
                borderLeft: item.isActive
                  ? '4px solid var(--slide-accent-blue)'
                  : '4px solid transparent',
                background: item.isActive
                  ? 'var(--slide-accent-blue)10'
                  : 'transparent',
                borderRadius: 'var(--slide-radius-md)',
                transition: 'all var(--slide-transition-normal)',
              }}
            >
              <div
                style={{
                  fontSize: 'var(--slide-font-h2)',
                  fontWeight: 'var(--slide-font-weight-bold)',
                  color: item.isActive
                    ? 'var(--slide-accent-blue)'
                    : 'var(--slide-text-tertiary)',
                  minWidth: '32px',
                }}
              >
                {item.number}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 'var(--slide-font-h3)',
                    fontWeight: 'var(--slide-font-weight-semibold)',
                    color: item.isActive
                      ? 'var(--slide-text-primary)'
                      : 'var(--slide-text-secondary)',
                    marginBottom: item.subtitle ? 'var(--slide-space-xs)' : 0,
                  }}
                >
                  {item.title}
                </div>
                {item.subtitle && (
                  <div
                    style={{
                      fontSize: 'var(--slide-font-body)',
                      color: 'var(--slide-text-tertiary)',
                    }}
                  >
                    {item.subtitle}
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

export default TocSlide;
