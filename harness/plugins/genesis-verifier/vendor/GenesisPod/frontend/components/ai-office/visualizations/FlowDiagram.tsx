'use client';

/**
 * 流程图组件
 * 使用 SVG 渲染简洁专业的流程图
 */

import React from 'react';
import type { FlowStep } from '@/lib/features/ai-office/markdown-parser';
import type { PPTTemplate } from '@/lib/features/ai-office/ppt-templates';

interface FlowDiagramProps {
  steps: FlowStep[];
  template: PPTTemplate;
  className?: string;
}

export default function FlowDiagram({
  steps,
  template,
  className = '',
}: FlowDiagramProps) {
  if (steps.length === 0) return null;

  // 计算布局
  const stepWidth = 180;
  const stepHeight = 80;
  const gap = 60;
  const arrowWidth = 40;

  // 根据步骤数量决定布局方向
  const isVertical = steps.length > 4;
  const totalWidth = isVertical
    ? stepWidth + 60
    : steps.length * stepWidth + (steps.length - 1) * gap;
  const totalHeight = isVertical
    ? steps.length * stepHeight + (steps.length - 1) * gap
    : stepHeight + 60;

  return (
    <div className={`flex w-full items-center justify-center ${className}`}>
      <svg
        width={totalWidth}
        height={totalHeight}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
        className="h-auto max-w-full"
      >
        <defs>
          {/* 箭头定义 */}
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3, 0 6"
              fill={template.colors.decorative || template.colors.primary}
            />
          </marker>

          {/* 渐变背景 */}
          <linearGradient id="stepGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop
              offset="0%"
              stopColor={template.colors.primary}
              stopOpacity="0.1"
            />
            <stop
              offset="100%"
              stopColor={template.colors.primary}
              stopOpacity="0.05"
            />
          </linearGradient>
        </defs>

        {steps.map((step, index) => {
          const x = isVertical ? 30 : index * (stepWidth + gap);
          const y = isVertical ? index * (stepHeight + gap) : 30;

          return (
            <g key={step.id}>
              {/* 步骤框 */}
              <rect
                x={x}
                y={y}
                width={stepWidth}
                height={stepHeight}
                rx="8"
                fill="url(#stepGradient)"
                stroke={template.colors.decorative || template.colors.primary}
                strokeWidth="2"
              />

              {/* 步骤编号 */}
              <circle
                cx={x + 20}
                cy={y + 20}
                r="16"
                fill={template.colors.decorative || template.colors.primary}
              />
              <text
                x={x + 20}
                y={y + 20}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize={template.typography.caption}
                fontWeight="bold"
                fontFamily={template.fonts.heading}
              >
                {index + 1}
              </text>

              {/* 步骤标题 */}
              <text
                x={x + stepWidth / 2}
                y={y + 30}
                textAnchor="middle"
                fill={
                  template.style.layoutStyle === 'dark'
                    ? template.colors.textLight
                    : template.colors.text
                }
                fontSize={template.typography.body - 2}
                fontWeight="600"
                fontFamily={template.fonts.heading}
              >
                {truncateText(step.label, 15)}
              </text>

              {/* 步骤描述 */}
              {step.description && (
                <foreignObject
                  x={x + 10}
                  y={y + 45}
                  width={stepWidth - 20}
                  height={30}
                >
                  <div
                    style={{
                      fontSize: `${template.typography.caption}px`,
                      color:
                        template.style.layoutStyle === 'dark'
                          ? template.colors.textLight
                          : template.colors.textSecondary,
                      fontFamily: template.fonts.body,
                      lineHeight: '1.3',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {step.description}
                  </div>
                </foreignObject>
              )}

              {/* 箭头连接线 */}
              {index < steps.length - 1 && (
                <>
                  {isVertical ? (
                    <line
                      x1={x + stepWidth / 2}
                      y1={y + stepHeight}
                      x2={x + stepWidth / 2}
                      y2={y + stepHeight + gap}
                      stroke={
                        template.colors.decorative || template.colors.primary
                      }
                      strokeWidth="2"
                      markerEnd="url(#arrowhead)"
                    />
                  ) : (
                    <line
                      x1={x + stepWidth}
                      y1={y + stepHeight / 2}
                      x2={x + stepWidth + gap}
                      y2={y + stepHeight / 2}
                      stroke={
                        template.colors.decorative || template.colors.primary
                      }
                      strokeWidth="2"
                      markerEnd="url(#arrowhead)"
                    />
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 1) + '...';
}
