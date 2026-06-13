'use client';

/**
 * MaturityModelSlide - 成熟度模型页模板
 *
 * 功能：
 * - 多维度评估（3-5个维度）
 * - 雷达图展示
 * - 当前状态 vs 目标状态对比
 * - 建议行动
 */

import React from 'react';
import type { MaturityModelSlideContent } from '@/lib/types/slides';
import '../styles/slide-tokens.css';

export interface MaturityModelSlideProps {
  content: MaturityModelSlideContent;
  className?: string;
}

// 简化雷达图组件
function RadarChart({
  dimensions,
  currentValues,
  targetValues,
  maxLevel,
}: {
  dimensions: Array<{ id: string; name: string }>;
  currentValues: Record<string, number>;
  targetValues?: Record<string, number>;
  maxLevel: number;
}) {
  const size = 200;
  const center = size / 2;
  const radius = size * 0.4;
  const angleStep = (2 * Math.PI) / dimensions.length;

  // 计算多边形点
  const getPolygonPoints = (values: Record<string, number>) => {
    return dimensions
      .map((dim, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const value = (values[dim.id] || 0) / maxLevel;
        const x = center + radius * value * Math.cos(angle);
        const y = center + radius * value * Math.sin(angle);
        return `${x},${y}`;
      })
      .join(' ');
  };

  // 计算标签位置
  const getLabelPosition = (index: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const x = center + (radius + 30) * Math.cos(angle);
    const y = center + (radius + 30) * Math.sin(angle);
    return { x, y };
  };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* 背景网格 */}
      {[0.2, 0.4, 0.6, 0.8, 1].map((scale, i) => (
        <polygon
          key={i}
          points={dimensions
            .map((_, index) => {
              const angle = index * angleStep - Math.PI / 2;
              const x = center + radius * scale * Math.cos(angle);
              const y = center + radius * scale * Math.sin(angle);
              return `${x},${y}`;
            })
            .join(' ')}
          fill="none"
          stroke="var(--slide-border-color)"
          strokeWidth={1}
          opacity={0.5}
        />
      ))}

      {/* 轴线 */}
      {dimensions.map((_, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        return (
          <line
            key={index}
            x1={center}
            y1={center}
            x2={x}
            y2={y}
            stroke="var(--slide-border-color)"
            strokeWidth={1}
            opacity={0.5}
          />
        );
      })}

      {/* 目标状态 */}
      {targetValues && (
        <polygon
          points={getPolygonPoints(targetValues)}
          fill="var(--slide-accent-gold)"
          fillOpacity={0.1}
          stroke="var(--slide-accent-gold)"
          strokeWidth={2}
          strokeDasharray="5,5"
        />
      )}

      {/* 当前状态 */}
      <polygon
        points={getPolygonPoints(currentValues)}
        fill="var(--slide-accent-primary)"
        fillOpacity={0.3}
        stroke="var(--slide-accent-primary)"
        strokeWidth={2}
      />

      {/* 数据点 */}
      {dimensions.map((dim, index) => {
        const angle = index * angleStep - Math.PI / 2;
        const value = (currentValues[dim.id] || 0) / maxLevel;
        const x = center + radius * value * Math.cos(angle);
        const y = center + radius * value * Math.sin(angle);
        return (
          <circle
            key={dim.id}
            cx={x}
            cy={y}
            r={4}
            fill="var(--slide-accent-primary)"
            stroke="white"
            strokeWidth={2}
          />
        );
      })}

      {/* 标签 */}
      {dimensions.map((dim, index) => {
        const pos = getLabelPosition(index);
        return (
          <text
            key={dim.id}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="10"
            fill="var(--slide-text-secondary)"
          >
            {dim.name}
          </text>
        );
      })}
    </svg>
  );
}

// 等级颜色
function getLevelColor(level: number, maxLevel: number): string {
  const ratio = level / maxLevel;
  if (ratio >= 0.8) return 'var(--slide-status-up)';
  if (ratio >= 0.6) return 'var(--slide-accent-gold)';
  if (ratio >= 0.4) return 'var(--slide-accent-primary)';
  return 'var(--slide-status-down)';
}

export function MaturityModelSlide({
  content,
  className = '',
}: MaturityModelSlideProps) {
  const maxLevel = content.levels.length;

  return (
    <div
      className={`maturity-model-slide ${className}`}
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
      {/* 标题区域 */}
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
        {content.modelName && (
          <span
            style={{
              fontSize: 'var(--slide-font-body)',
              color: 'var(--slide-accent-primary)',
              fontWeight: 'var(--slide-font-weight-semibold)',
            }}
          >
            {content.modelName}
          </span>
        )}
        {content.description && (
          <p
            style={{
              fontSize: 'var(--slide-font-body)',
              color: 'var(--slide-text-tertiary)',
              lineHeight: 'var(--slide-line-height-normal)',
              marginTop: 'var(--slide-space-xs)',
            }}
          >
            {content.description}
          </p>
        )}
      </div>

      {/* 主体内容 */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: content.showRadar ? '1fr 1fr' : '1fr',
          gap: 'var(--slide-space-xl)',
          overflow: 'hidden',
        }}
      >
        {/* 雷达图 */}
        {content.showRadar && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--slide-bg-card)',
              borderRadius: 'var(--slide-radius-lg)',
              padding: 'var(--slide-space-lg)',
            }}
          >
            <RadarChart
              dimensions={content.dimensions}
              currentValues={content.currentAssessment}
              targetValues={content.targetState}
              maxLevel={maxLevel}
            />

            {/* 图例 */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--slide-space-lg)',
                marginTop: 'var(--slide-space-md)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--slide-space-xs)',
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    background: 'var(--slide-accent-primary)',
                    borderRadius: '2px',
                  }}
                />
                <span
                  style={{
                    fontSize: 'var(--slide-font-small)',
                    color: 'var(--slide-text-tertiary)',
                  }}
                >
                  当前状态
                </span>
              </div>
              {content.targetState && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--slide-space-xs)',
                  }}
                >
                  <div
                    style={{
                      width: '12px',
                      height: '12px',
                      background: 'var(--slide-accent-gold)',
                      borderRadius: '2px',
                      opacity: 0.5,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 'var(--slide-font-small)',
                      color: 'var(--slide-text-tertiary)',
                    }}
                  >
                    目标状态
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 维度详情 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--slide-space-md)',
            overflow: 'auto',
          }}
        >
          {content.dimensions.map((dimension) => {
            const currentLevel = content.currentAssessment[dimension.id] || 0;
            const targetLevel = content.targetState?.[dimension.id];
            const currentLevelInfo = content.levels.find(
              (l) => l.level === currentLevel
            );

            return (
              <div
                key={dimension.id}
                style={{
                  background: 'var(--slide-bg-card)',
                  borderRadius: 'var(--slide-radius-md)',
                  padding: 'var(--slide-space-md)',
                  border: '1px solid var(--slide-border-color)',
                }}
              >
                {/* 维度标题 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 'var(--slide-space-sm)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--slide-space-sm)',
                    }}
                  >
                    {dimension.icon && (
                      <span style={{ fontSize: 'var(--slide-font-h4)' }}>
                        {dimension.icon}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 'var(--slide-font-body)',
                        fontWeight: 'var(--slide-font-weight-semibold)',
                        color: 'var(--slide-text-primary)',
                      }}
                    >
                      {dimension.name}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--slide-space-sm)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 'var(--slide-font-h3)',
                        fontWeight: 'var(--slide-font-weight-bold)',
                        color: getLevelColor(currentLevel, maxLevel),
                      }}
                    >
                      L{currentLevel}
                    </span>
                    {targetLevel && targetLevel !== currentLevel && (
                      <>
                        <span style={{ color: 'var(--slide-text-tertiary)' }}>
                          →
                        </span>
                        <span
                          style={{
                            fontSize: 'var(--slide-font-h3)',
                            fontWeight: 'var(--slide-font-weight-bold)',
                            color: 'var(--slide-accent-gold)',
                          }}
                        >
                          L{targetLevel}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* 进度条 */}
                {content.showProgress && (
                  <div
                    style={{
                      height: '6px',
                      background: 'var(--slide-bg-tertiary)',
                      borderRadius: 'var(--slide-radius-full)',
                      overflow: 'hidden',
                      marginBottom: 'var(--slide-space-xs)',
                    }}
                  >
                    <div
                      style={{
                        width: `${(currentLevel / maxLevel) * 100}%`,
                        height: '100%',
                        background: getLevelColor(currentLevel, maxLevel),
                        borderRadius: 'var(--slide-radius-full)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                )}

                {/* 当前等级描述 */}
                {currentLevelInfo && (
                  <p
                    style={{
                      fontSize: 'var(--slide-font-small)',
                      color: 'var(--slide-text-tertiary)',
                      margin: 0,
                    }}
                  >
                    {currentLevelInfo.name}: {currentLevelInfo.description}
                  </p>
                )}
              </div>
            );
          })}

          {/* 建议 */}
          {content.recommendations && content.recommendations.length > 0 && (
            <div
              style={{
                background: 'var(--slide-accent-primary)10',
                borderRadius: 'var(--slide-radius-md)',
                padding: 'var(--slide-space-md)',
                border: '1px solid var(--slide-accent-primary)30',
              }}
            >
              <h4
                style={{
                  fontSize: 'var(--slide-font-body)',
                  fontWeight: 'var(--slide-font-weight-semibold)',
                  color: 'var(--slide-accent-primary)',
                  margin: '0 0 var(--slide-space-sm) 0',
                }}
              >
                改进建议
              </h4>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 'var(--slide-space-md)',
                }}
              >
                {content.recommendations.map((rec, index) => (
                  <li
                    key={index}
                    style={{
                      fontSize: 'var(--slide-font-small)',
                      color: 'var(--slide-text-secondary)',
                      marginBottom: 'var(--slide-space-xs)',
                    }}
                  >
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MaturityModelSlide;
