'use client';

/**
 * ComparisonSlide - 对比分析页模板
 *
 * 功能：
 * - 多维度对比
 * - 支持表格/卡片/并列布局
 * - 支持获胜者标记
 */

import React from 'react';
import type {
  ComparisonSlideContent,
  ComparisonValue,
} from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface ComparisonSlideProps {
  content: ComparisonSlideContent;
  className?: string;
}

export function ComparisonSlide({
  content,
  className = '',
}: ComparisonSlideProps) {
  // 渲染比较值
  const renderValue = (value: ComparisonValue) => {
    if (typeof value === 'object' && 'text' in value) {
      return (
        <span
          style={{
            fontWeight: value.highlight
              ? 'var(--slide-font-weight-semibold)'
              : 'normal',
            color: value.highlight
              ? 'var(--slide-accent-gold)'
              : 'var(--slide-text-secondary)',
          }}
        >
          {value.text}
          {value.score !== undefined && (
            <span style={{ marginLeft: '4px', fontSize: '0.9em' }}>
              ({value.score}/10)
            </span>
          )}
        </span>
      );
    }
    if (typeof value === 'boolean') {
      return value ? (
        <span style={{ color: 'var(--slide-status-up)' }}>✓</span>
      ) : (
        <span style={{ color: 'var(--slide-status-down)' }}>✗</span>
      );
    }
    return <span>{String(value)}</span>;
  };

  if (content.layout === 'table') {
    return (
      <div
        className={`comparison-slide ${className}`}
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
              }}
            >
              {content.description}
            </p>
          )}
        </div>

        {/* 对比表格 */}
        <div
          style={{
            flex: 1,
            overflowX: 'auto',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    background: 'var(--slide-bg-tertiary)',
                    padding: 'var(--slide-space-md)',
                    textAlign: 'left',
                    fontSize: 'var(--slide-font-body)',
                    fontWeight: 'var(--slide-font-weight-semibold)',
                    color: 'var(--slide-text-primary)',
                    borderTopLeftRadius: 'var(--slide-radius-md)',
                  }}
                >
                  标准
                </th>
                {content.subjects.map((subject) => (
                  <th
                    key={subject.id}
                    style={{
                      background: subject.isWinner
                        ? 'var(--slide-accent-gold)20'
                        : 'var(--slide-bg-tertiary)',
                      padding: 'var(--slide-space-md)',
                      textAlign: 'center',
                      fontSize: 'var(--slide-font-body)',
                      fontWeight: 'var(--slide-font-weight-semibold)',
                      color: subject.isWinner
                        ? 'var(--slide-accent-gold)'
                        : 'var(--slide-text-primary)',
                      borderTop: subject.isWinner
                        ? '2px solid var(--slide-accent-gold)'
                        : 'none',
                    }}
                  >
                    {subject.name}
                    {subject.isWinner && (
                      <span style={{ marginLeft: '4px' }}>👑</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.criteria.map((criterion, index) => (
                <tr key={index}>
                  <td
                    style={{
                      background: 'var(--slide-bg-card)',
                      padding: 'var(--slide-space-md)',
                      borderBottom: '1px solid var(--slide-border-color)',
                      fontSize: 'var(--slide-font-body)',
                      color: 'var(--slide-text-secondary)',
                    }}
                  >
                    {criterion.icon && (
                      <span style={{ marginRight: '8px' }}>
                        {criterion.icon}
                      </span>
                    )}
                    {criterion.name}
                  </td>
                  {content.subjects.map((subject) => (
                    <td
                      key={subject.id}
                      style={{
                        background:
                          criterion.winner === subject.id
                            ? 'var(--slide-accent-green)15'
                            : 'var(--slide-bg-card)',
                        padding: 'var(--slide-space-md)',
                        borderBottom: '1px solid var(--slide-border-color)',
                        textAlign: 'center',
                        fontSize: 'var(--slide-font-body)',
                        color: 'var(--slide-text-secondary)',
                      }}
                    >
                      {renderValue(criterion.values[subject.id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 其他布局样式（卡片、并列）可以类似实现
  return (
    <div className={`comparison-slide ${className}`}>
      <p>其他对比布局待实现</p>
    </div>
  );
}

export default ComparisonSlide;
