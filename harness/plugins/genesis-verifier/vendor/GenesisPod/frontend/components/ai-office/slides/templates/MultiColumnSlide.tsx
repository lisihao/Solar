'use client';

/**
 * MultiColumnSlide - 多栏布局页模板
 *
 * 功能：
 * - 2-4栏并列展示
 * - 支持图标
 * - 支持高亮栏
 */

import React from 'react';
import type { MultiColumnSlideContent } from '@/lib/types/slides';
import { SlideCard } from '../base';
import '../styles/slide-tokens.css';

export interface MultiColumnSlideProps {
  content: MultiColumnSlideContent;
  className?: string;
}

export function MultiColumnSlide({
  content,
  className = '',
}: MultiColumnSlideProps) {
  return (
    <div
      className={`multi-column-slide ${className}`}
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

      {/* 多栏网格 */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${content.columnCount}, 1fr)`,
          gap: 'var(--slide-space-lg)',
        }}
      >
        {content.columns.map((column, index) => (
          <SlideCard
            key={index}
            title={column.title}
            icon={
              column.icon ? (
                <span style={{ fontSize: '24px' }}>{column.icon}</span>
              ) : null
            }
            highlight={column.highlight}
            highlightColor={column.color || 'var(--slide-accent-blue)'}
          >
            {/* 内容文本 */}
            {column.content && (
              <p
                style={{
                  margin: 0,
                  marginBottom: column.items ? 'var(--slide-space-md)' : 0,
                  lineHeight: 'var(--slide-line-height-relaxed)',
                }}
              >
                {column.content}
              </p>
            )}

            {/* 列表项 */}
            {column.items && column.items.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--slide-space-xs)',
                }}
              >
                {column.items.map((item, itemIndex) => (
                  <li
                    key={itemIndex}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--slide-space-xs)',
                      fontSize: 'var(--slide-font-body)',
                      lineHeight: 'var(--slide-line-height-normal)',
                    }}
                  >
                    <span
                      style={{
                        color: column.color || 'var(--slide-accent-blue)',
                        flexShrink: 0,
                      }}
                    >
                      •
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </SlideCard>
        ))}
      </div>
    </div>
  );
}

export default MultiColumnSlide;
