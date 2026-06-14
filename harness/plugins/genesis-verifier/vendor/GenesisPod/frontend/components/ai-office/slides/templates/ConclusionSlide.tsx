'use client';

/**
 * ConclusionSlide - 结论页模板
 *
 * 功能：
 * - 总结关键要点
 * - 支持行动号召
 * - 支持下一步建议
 */

import React from 'react';
import type { ConclusionSlideContent } from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface ConclusionSlideProps {
  content: ConclusionSlideContent;
  className?: string;
}

export function ConclusionSlide({
  content,
  className = '',
}: ConclusionSlideProps) {
  return (
    <div
      className={`conclusion-slide ${className}`}
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
          textAlign: 'center',
        }}
      >
        {content.title}
      </h2>

      {/* 关键要点 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--slide-space-lg)',
          marginBottom: 'var(--slide-space-xl)',
        }}
      >
        {content.keyTakeaways.map((takeaway, index) => {
          const emphasisColor =
            takeaway.emphasis === 'high'
              ? 'var(--slide-accent-gold)'
              : takeaway.emphasis === 'medium'
                ? 'var(--slide-accent-blue)'
                : 'var(--slide-accent-cyan)';

          return (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--slide-space-md)',
                padding: 'var(--slide-space-lg)',
                background:
                  takeaway.emphasis === 'high'
                    ? `${emphasisColor}15`
                    : 'var(--slide-bg-card)',
                border: `1px solid ${emphasisColor}40`,
                borderRadius: 'var(--slide-radius-lg)',
                backdropFilter: 'blur(10px)',
              }}
            >
              {/* 图标或编号 */}
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background:
                    takeaway.emphasis === 'high'
                      ? emphasisColor
                      : `${emphasisColor}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {takeaway.icon ? (
                  <span
                    style={{
                      fontSize: '24px',
                      color:
                        takeaway.emphasis === 'high' ? 'white' : emphasisColor,
                    }}
                  >
                    {takeaway.icon}
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 'var(--slide-font-h2)',
                      fontWeight: 'var(--slide-font-weight-bold)',
                      color:
                        takeaway.emphasis === 'high' ? 'white' : emphasisColor,
                    }}
                  >
                    {index + 1}
                  </span>
                )}
              </div>

              {/* 文本 */}
              <div
                style={{
                  flex: 1,
                  fontSize: 'var(--slide-font-h3)',
                  fontWeight:
                    takeaway.emphasis === 'high'
                      ? 'var(--slide-font-weight-semibold)'
                      : 'var(--slide-font-weight-normal)',
                  color:
                    takeaway.emphasis === 'high'
                      ? 'var(--slide-text-primary)'
                      : 'var(--slide-text-secondary)',
                  lineHeight: 'var(--slide-line-height-relaxed)',
                }}
              >
                {takeaway.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* 行动号召 */}
      {content.callToAction && (
        <div
          style={{
            padding: 'var(--slide-space-xl)',
            background: 'var(--slide-gradient-primary)',
            borderRadius: 'var(--slide-radius-lg)',
            textAlign: 'center',
            marginBottom: content.nextSteps ? 'var(--slide-space-lg)' : 0,
          }}
        >
          <div
            style={{
              fontSize: 'var(--slide-font-h2)',
              fontWeight: 'var(--slide-font-weight-bold)',
              color: 'white',
              lineHeight: 'var(--slide-line-height-normal)',
            }}
          >
            {content.callToAction}
          </div>
        </div>
      )}

      {/* 下一步 */}
      {content.nextSteps && content.nextSteps.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--slide-space-md)',
            justifyContent: 'center',
          }}
        >
          {content.nextSteps.map((step, index) => (
            <div
              key={index}
              style={{
                flex: 1,
                padding: 'var(--slide-space-md)',
                background: 'var(--slide-bg-card)',
                border: '1px solid var(--slide-border-color)',
                borderRadius: 'var(--slide-radius-md)',
                textAlign: 'center',
                fontSize: 'var(--slide-font-body)',
                color: 'var(--slide-text-secondary)',
              }}
            >
              {step}
            </div>
          ))}
        </div>
      )}

      {/* 结束语 */}
      {content.closingMessage && (
        <div
          style={{
            marginTop: 'var(--slide-space-lg)',
            textAlign: 'center',
            fontSize: 'var(--slide-font-h3)',
            color: 'var(--slide-text-tertiary)',
            fontStyle: 'italic',
          }}
        >
          {content.closingMessage}
        </div>
      )}
    </div>
  );
}

export default ConclusionSlide;
