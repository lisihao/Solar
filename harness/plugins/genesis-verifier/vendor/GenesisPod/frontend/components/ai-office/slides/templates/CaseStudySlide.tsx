'use client';

/**
 * CaseStudySlide - 案例研究页模板
 *
 * 功能：
 * - 公司信息展示（logo、行业）
 * - 挑战 → 方案 → 成果结构
 * - 成果指标展示
 * - 客户证言
 */

import React from 'react';
import type { CaseStudySlideContent } from '@/lib/types/slides';
import { KpiCard } from '../base';
import '../styles/slide-tokens.css';

export interface CaseStudySlideProps {
  content: CaseStudySlideContent;
  className?: string;
}

export function CaseStudySlide({
  content,
  className = '',
}: CaseStudySlideProps) {
  return (
    <div
      className={`case-study-slide ${className}`}
      style={{
        width: '100%',
        height: '100%',
        background:
          'linear-gradient(135deg, var(--slide-bg-primary) 0%, var(--slide-bg-secondary) 100%)',
        padding: 'var(--slide-space-2xl)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 头部：公司信息 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--slide-space-lg)',
          marginBottom: 'var(--slide-space-xl)',
        }}
      >
        {/* Logo */}
        {content.logo ? (
          <img
            src={content.logo}
            alt={content.company}
            style={{
              width: '60px',
              height: '60px',
              objectFit: 'contain',
              borderRadius: 'var(--slide-radius-md)',
              background: 'white',
              padding: 'var(--slide-space-xs)',
            }}
          />
        ) : (
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: 'var(--slide-radius-md)',
              background: 'var(--slide-accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--slide-font-h2)',
              fontWeight: 'var(--slide-font-weight-bold)',
              color: 'white',
            }}
          >
            {content.company.charAt(0)}
          </div>
        )}

        {/* 公司和标题信息 */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--slide-space-sm)',
              marginBottom: 'var(--slide-space-xs)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--slide-font-body)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-accent-primary)',
              }}
            >
              {content.company}
            </span>
            {content.industry && (
              <span
                style={{
                  fontSize: 'var(--slide-font-small)',
                  padding: '2px 8px',
                  background: 'transparent',
                  border: '1px solid var(--slide-border-color)',
                  borderRadius: 'var(--slide-radius-full)',
                  color: 'var(--slide-text-tertiary)',
                }}
              >
                {content.industry}
              </span>
            )}
          </div>
          <h2
            style={{
              fontSize: 'var(--slide-font-h2)',
              fontWeight: 'var(--slide-font-weight-bold)',
              color: 'var(--slide-text-primary)',
              margin: 0,
            }}
          >
            {content.title}
          </h2>
        </div>

        {/* 标签 */}
        {content.tags && content.tags.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--slide-space-xs)',
              flexWrap: 'wrap',
            }}
          >
            {content.tags.map((tag, index) => (
              <span
                key={index}
                style={{
                  fontSize: 'var(--slide-font-small)',
                  padding: '2px 8px',
                  background: 'var(--slide-accent-primary)20',
                  border: '1px solid var(--slide-accent-primary)40',
                  borderRadius: 'var(--slide-radius-full)',
                  color: 'var(--slide-accent-primary)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 主体内容：挑战 - 方案 - 成果 */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 'var(--slide-space-lg)',
          overflow: 'hidden',
        }}
      >
        {/* 挑战 */}
        <div
          style={{
            background: 'var(--slide-bg-card)',
            borderRadius: 'var(--slide-radius-lg)',
            padding: 'var(--slide-space-lg)',
            border: '1px solid var(--slide-status-down)20',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--slide-space-sm)',
              marginBottom: 'var(--slide-space-md)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--slide-font-h3)',
                color: 'var(--slide-status-down)',
              }}
            >
              ⚠️
            </span>
            <h3
              style={{
                fontSize: 'var(--slide-font-h4)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-status-down)',
                margin: 0,
              }}
            >
              {content.challenge.title || '挑战'}
            </h3>
          </div>
          <p
            style={{
              fontSize: 'var(--slide-font-body)',
              color: 'var(--slide-text-secondary)',
              lineHeight: 'var(--slide-line-height-relaxed)',
              marginBottom: content.challenge.painPoints
                ? 'var(--slide-space-md)'
                : 0,
            }}
          >
            {content.challenge.description}
          </p>
          {content.challenge.painPoints &&
            content.challenge.painPoints.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 'var(--slide-space-md)',
                  flex: 1,
                }}
              >
                {content.challenge.painPoints.map((point, index) => (
                  <li
                    key={index}
                    style={{
                      fontSize: 'var(--slide-font-small)',
                      color: 'var(--slide-text-tertiary)',
                      marginBottom: 'var(--slide-space-xs)',
                    }}
                  >
                    {point}
                  </li>
                ))}
              </ul>
            )}
        </div>

        {/* 方案 */}
        <div
          style={{
            background: 'var(--slide-bg-card)',
            borderRadius: 'var(--slide-radius-lg)',
            padding: 'var(--slide-space-lg)',
            border: '1px solid var(--slide-accent-primary)20',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--slide-space-sm)',
              marginBottom: 'var(--slide-space-md)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--slide-font-h3)',
                color: 'var(--slide-accent-primary)',
              }}
            >
              💡
            </span>
            <h3
              style={{
                fontSize: 'var(--slide-font-h4)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-accent-primary)',
                margin: 0,
              }}
            >
              {content.solution.title || '解决方案'}
            </h3>
          </div>
          <p
            style={{
              fontSize: 'var(--slide-font-body)',
              color: 'var(--slide-text-secondary)',
              lineHeight: 'var(--slide-line-height-relaxed)',
              marginBottom: content.solution.highlights
                ? 'var(--slide-space-md)'
                : 0,
            }}
          >
            {content.solution.description}
          </p>
          {content.solution.highlights &&
            content.solution.highlights.length > 0 && (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 'var(--slide-space-md)',
                  flex: 1,
                }}
              >
                {content.solution.highlights.map((highlight, index) => (
                  <li
                    key={index}
                    style={{
                      fontSize: 'var(--slide-font-small)',
                      color: 'var(--slide-text-tertiary)',
                      marginBottom: 'var(--slide-space-xs)',
                    }}
                  >
                    {highlight}
                  </li>
                ))}
              </ul>
            )}
        </div>

        {/* 成果 */}
        <div
          style={{
            background: 'var(--slide-bg-card)',
            borderRadius: 'var(--slide-radius-lg)',
            padding: 'var(--slide-space-lg)',
            border: '1px solid var(--slide-status-up)20',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--slide-space-sm)',
              marginBottom: 'var(--slide-space-md)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--slide-font-h3)',
                color: 'var(--slide-status-up)',
              }}
            >
              🎯
            </span>
            <h3
              style={{
                fontSize: 'var(--slide-font-h4)',
                fontWeight: 'var(--slide-font-weight-semibold)',
                color: 'var(--slide-status-up)',
                margin: 0,
              }}
            >
              成果
            </h3>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--slide-space-sm)',
              flex: 1,
            }}
          >
            {content.results.map((result, index) => (
              <KpiCard
                key={index}
                label={result.metric}
                value={result.value}
                trend={result.improvement ? 'up' : undefined}
                trendValue={result.improvement}
                size="small"
                icon={result.icon}
                color={result.color}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 底部：客户证言 */}
      {content.testimonial && (
        <div
          style={{
            marginTop: 'var(--slide-space-lg)',
            padding: 'var(--slide-space-lg)',
            background: 'var(--slide-bg-card)',
            borderRadius: 'var(--slide-radius-lg)',
            borderLeft: '4px solid var(--slide-accent-gold)',
          }}
        >
          <blockquote
            style={{
              fontSize: 'var(--slide-font-body)',
              fontStyle: 'italic',
              color: 'var(--slide-text-secondary)',
              margin: 0,
              marginBottom: 'var(--slide-space-sm)',
              lineHeight: 'var(--slide-line-height-relaxed)',
            }}
          >
            &ldquo;{content.testimonial.quote}&rdquo;
          </blockquote>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--slide-space-sm)',
            }}
          >
            {content.testimonial.avatar ? (
              <img
                src={content.testimonial.avatar}
                alt={content.testimonial.author}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'var(--slide-accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--slide-font-small)',
                  fontWeight: 'var(--slide-font-weight-bold)',
                  color: 'white',
                }}
              >
                {content.testimonial.author.charAt(0)}
              </div>
            )}
            <div>
              <div
                style={{
                  fontSize: 'var(--slide-font-body)',
                  fontWeight: 'var(--slide-font-weight-semibold)',
                  color: 'var(--slide-text-primary)',
                }}
              >
                {content.testimonial.author}
              </div>
              <div
                style={{
                  fontSize: 'var(--slide-font-small)',
                  color: 'var(--slide-text-tertiary)',
                }}
              >
                {content.testimonial.title}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CaseStudySlide;
