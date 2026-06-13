'use client';

/**
 * SplitLayoutSlide - 分屏布局页模板
 *
 * 功能：
 * - 支持左右比例配置 (50-50, 60-40, 70-30等)
 * - 支持多种内容类型 (text, image, chart, list, quote, stats)
 * - 支持分割线样式
 */

import React from 'react';
import type {
  SplitLayoutSlideContent,
  SplitSectionContent,
} from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface SplitLayoutSlideProps {
  content: SplitLayoutSlideContent;
  className?: string;
}

// 解析比例字符串
function parseRatio(ratio: string): [number, number] {
  const parts = ratio.split('-').map(Number);
  return [parts[0], parts[1]];
}

// 渲染单侧内容
function SectionRenderer({ section }: { section: SplitSectionContent }) {
  const baseStyle: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--slide-space-md)',
  };

  switch (section.type) {
    case 'text':
      return (
        <div style={baseStyle}>
          {section.title && (
            <h3
              style={{
                fontSize: 'var(--slide-font-h3)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-text-primary)',
                marginBottom: 'var(--slide-space-sm)',
              }}
            >
              {section.title}
            </h3>
          )}
          {section.content && (
            <p
              style={{
                fontSize: 'var(--slide-font-body)',
                color: 'var(--slide-text-secondary)',
                lineHeight: 'var(--slide-line-height-relaxed)',
              }}
            >
              {section.content}
            </p>
          )}
        </div>
      );

    case 'image':
      return (
        <div
          style={{
            ...baseStyle,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {section.imageUrl ? (
            <img
              src={section.imageUrl}
              alt={section.title || 'Slide image'}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                borderRadius: 'var(--slide-radius-md)',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '200px',
                background: 'var(--slide-bg-tertiary)',
                borderRadius: 'var(--slide-radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--slide-text-tertiary)',
              }}
            >
              Image Placeholder
            </div>
          )}
        </div>
      );

    case 'list':
      return (
        <div style={baseStyle}>
          {section.title && (
            <h3
              style={{
                fontSize: 'var(--slide-font-h3)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-text-primary)',
              }}
            >
              {section.title}
            </h3>
          )}
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--slide-space-sm)',
            }}
          >
            {section.items?.map((item, index) => (
              <li
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--slide-space-sm)',
                  fontSize: 'var(--slide-font-body)',
                  color: 'var(--slide-text-secondary)',
                  lineHeight: 'var(--slide-line-height-normal)',
                }}
              >
                <span
                  style={{
                    color: 'var(--slide-accent-primary)',
                    fontWeight: 'var(--slide-font-weight-semibold)',
                  }}
                >
                  •
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      );

    case 'quote':
      return (
        <div
          style={{
            ...baseStyle,
            justifyContent: 'center',
            paddingLeft: 'var(--slide-space-lg)',
            borderLeft: '4px solid var(--slide-accent-primary)',
          }}
        >
          <blockquote
            style={{
              fontSize: 'var(--slide-font-h3)',
              fontStyle: 'italic',
              color: 'var(--slide-text-primary)',
              lineHeight: 'var(--slide-line-height-relaxed)',
              margin: 0,
            }}
          >
            &ldquo;{section.quote?.text}&rdquo;
          </blockquote>
          {section.quote?.author && (
            <cite
              style={{
                fontSize: 'var(--slide-font-body)',
                color: 'var(--slide-text-tertiary)',
                marginTop: 'var(--slide-space-md)',
                fontStyle: 'normal',
              }}
            >
              — {section.quote.author}
            </cite>
          )}
        </div>
      );

    case 'stats':
      return (
        <div
          style={{
            ...baseStyle,
            justifyContent: 'center',
          }}
        >
          {section.title && (
            <h3
              style={{
                fontSize: 'var(--slide-font-h3)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-text-primary)',
                marginBottom: 'var(--slide-space-md)',
              }}
            >
              {section.title}
            </h3>
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--slide-space-md)',
            }}
          >
            {section.stats?.map((stat, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--slide-space-md)',
                  padding: 'var(--slide-space-md)',
                  background: 'var(--slide-bg-card)',
                  borderRadius: 'var(--slide-radius-md)',
                }}
              >
                <span
                  style={{
                    fontSize: 'var(--slide-font-h2)',
                    fontWeight: 'var(--slide-font-weight-bold)',
                    color: 'var(--slide-accent-primary)',
                  }}
                >
                  {stat.value}
                </span>
                <span
                  style={{
                    fontSize: 'var(--slide-font-body)',
                    color: 'var(--slide-text-secondary)',
                  }}
                >
                  {stat.label}
                </span>
                {stat.trend && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      color:
                        stat.trend === 'up'
                          ? 'var(--slide-status-up)'
                          : stat.trend === 'down'
                            ? 'var(--slide-status-down)'
                            : 'var(--slide-text-tertiary)',
                    }}
                  >
                    {stat.trend === 'up'
                      ? '↑'
                      : stat.trend === 'down'
                        ? '↓'
                        : '→'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      );

    case 'chart':
      // 简化图表渲染
      return (
        <div
          style={{
            ...baseStyle,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {section.title && (
            <h3
              style={{
                fontSize: 'var(--slide-font-h3)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-text-primary)',
                marginBottom: 'var(--slide-space-md)',
                width: '100%',
              }}
            >
              {section.title}
            </h3>
          )}
          <div
            style={{
              width: '100%',
              height: '200px',
              background: 'var(--slide-bg-card)',
              borderRadius: 'var(--slide-radius-md)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-around',
              padding: 'var(--slide-space-md)',
              gap: 'var(--slide-space-sm)',
            }}
          >
            {section.chartData?.map((item, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 'var(--slide-space-xs)',
                }}
              >
                <div
                  style={{
                    width: '40px',
                    height: `${Math.min(150, Math.max(20, item.value * 1.5))}px`,
                    background: item.color || 'var(--slide-accent-primary)',
                    borderRadius:
                      'var(--slide-radius-sm) var(--slide-radius-sm) 0 0',
                  }}
                />
                <span
                  style={{
                    fontSize: 'var(--slide-font-small)',
                    color: 'var(--slide-text-tertiary)',
                  }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      );

    default:
      return null;
  }
}

export function SplitLayoutSlide({
  content,
  className = '',
}: SplitLayoutSlideProps) {
  const [leftRatio, rightRatio] = parseRatio(content.ratio);

  return (
    <div
      className={`split-layout-slide ${className}`}
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
          }}
        >
          {content.title}
        </h2>
      </div>

      {/* 分屏内容 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          gap:
            content.dividerStyle === 'none'
              ? 'var(--slide-space-xl)'
              : 'var(--slide-space-lg)',
          overflow: 'hidden',
        }}
      >
        {/* 左侧 */}
        <div
          style={{
            flex: leftRatio,
            minWidth: 0,
            overflow: 'auto',
          }}
        >
          <SectionRenderer section={content.left} />
        </div>

        {/* 分割线 */}
        {content.dividerStyle !== 'none' && (
          <div
            style={{
              width: content.dividerStyle === 'gradient' ? '4px' : '1px',
              background:
                content.dividerStyle === 'gradient'
                  ? 'linear-gradient(180deg, var(--slide-accent-primary) 0%, var(--slide-accent-secondary) 100%)'
                  : 'var(--slide-border-color)',
              flexShrink: 0,
            }}
          />
        )}

        {/* 右侧 */}
        <div
          style={{
            flex: rightRatio,
            minWidth: 0,
            overflow: 'auto',
          }}
        >
          <SectionRenderer section={content.right} />
        </div>
      </div>
    </div>
  );
}

export default SplitLayoutSlide;
