'use client';

/**
 * 矩阵布局组件
 * 用于展示2x2矩阵、四象限分析等
 */

import React from 'react';
import type { MatrixItem } from '@/lib/features/ai-office/markdown-parser';
import type { PPTTemplate } from '@/lib/features/ai-office/ppt-templates';

interface MatrixLayoutProps {
  items: MatrixItem[];
  template: PPTTemplate;
  className?: string;
}

const QUADRANT_CONFIG = {
  'top-left': {
    label: '象限1',
    color: '#10B981', // green
    position: 'left-1/2 top-1/2',
  },
  'top-right': {
    label: '象限2',
    color: '#3B82F6', // blue
    position: 'right-1/2 top-1/2',
  },
  'bottom-left': {
    label: '象限3',
    color: '#F59E0B', // amber
    position: 'left-1/2 bottom-1/2',
  },
  'bottom-right': {
    label: '象限4',
    color: '#EF4444', // red
    position: 'right-1/2 bottom-1/2',
  },
};

export default function MatrixLayout({
  items,
  template,
  className = '',
}: MatrixLayoutProps) {
  if (items.length === 0) return null;

  return (
    <div
      className={`flex h-full w-full items-center justify-center p-8 ${className}`}
    >
      <div className="relative aspect-square w-full max-w-4xl">
        {/* 矩阵网格 */}
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-4">
          {/* 顶部左象限 */}
          {renderQuadrant(
            items.find((item) => item.quadrant === 'top-left'),
            'top-left',
            template
          )}

          {/* 顶部右象限 */}
          {renderQuadrant(
            items.find((item) => item.quadrant === 'top-right'),
            'top-right',
            template
          )}

          {/* 底部左象限 */}
          {renderQuadrant(
            items.find((item) => item.quadrant === 'bottom-left'),
            'bottom-left',
            template
          )}

          {/* 底部右象限 */}
          {renderQuadrant(
            items.find((item) => item.quadrant === 'bottom-right'),
            'bottom-right',
            template
          )}
        </div>

        {/* 中心十字线 */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="absolute h-0.5 w-full"
            style={{
              backgroundColor: `${template.colors.decorative || template.colors.primary}40`,
            }}
          />
          <div
            className="absolute h-full w-0.5"
            style={{
              backgroundColor: `${template.colors.decorative || template.colors.primary}40`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function renderQuadrant(
  item: MatrixItem | undefined,
  quadrant: MatrixItem['quadrant'],
  template: PPTTemplate
) {
  const config = QUADRANT_CONFIG[quadrant];

  if (!item) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border-2 border-dashed p-6"
        style={{
          borderColor: `${template.colors.textSecondary}40`,
          backgroundColor: `${template.colors.background}80`,
        }}
      >
        <p
          className="text-center opacity-50"
          style={{
            fontSize: `${template.typography.body}px`,
            color: template.colors.textSecondary,
            fontFamily: template.fonts.body,
          }}
        >
          {config.label}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded-lg border-2 p-6 transition-all hover:shadow-lg"
      style={{
        borderColor: config.color,
        backgroundColor: `${config.color}10`,
      }}
    >
      {/* 象限标题 */}
      <div className="mb-3 flex items-center">
        <div
          className="mr-2 h-3 w-3 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <h3
          className="font-bold"
          style={{
            fontSize: `${template.typography.subtitle}px`,
            color:
              template.style.layoutStyle === 'dark'
                ? template.colors.textLight
                : template.colors.text,
            fontFamily: template.fonts.heading,
          }}
        >
          {item.label}
        </h3>
      </div>

      {/* 象限描述 */}
      <p
        className="leading-relaxed"
        style={{
          fontSize: `${template.typography.body - 2}px`,
          color:
            template.style.layoutStyle === 'dark'
              ? template.colors.textLight
              : template.colors.textSecondary,
          fontFamily: template.fonts.body,
        }}
      >
        {item.description}
      </p>
    </div>
  );
}
