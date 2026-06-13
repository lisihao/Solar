'use client';

/**
 * 幻灯片装饰元素组件
 * 提供高级视觉效果：光晕、渐变条、角落装饰、几何图形
 */

import React from 'react';
import type { PPTTemplate } from '@/lib/features/ai-office/ppt-templates';

interface SlideDecorationsProps {
  template: PPTTemplate;
}

/**
 * 角落光晕效果
 */
function CornerGlow({
  position,
  color,
  size,
  opacity,
}: {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  color: string;
  size: string;
  opacity: number;
}) {
  const positionClasses = {
    'top-left': 'top-0 left-0 -translate-x-1/3 -translate-y-1/3',
    'top-right': 'top-0 right-0 translate-x-1/3 -translate-y-1/3',
    'bottom-left': 'bottom-0 left-0 -translate-x-1/3 translate-y-1/3',
    'bottom-right': 'bottom-0 right-0 translate-x-1/3 translate-y-1/3',
  };

  return (
    <div
      className={`pointer-events-none absolute rounded-full blur-3xl ${positionClasses[position]}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        opacity,
      }}
    />
  );
}

/**
 * 渐变顶部条
 */
function GradientTopBar({
  height,
  primaryColor,
  secondaryColor,
}: {
  height: string;
  primaryColor: string;
  secondaryColor?: string;
}) {
  return (
    <div
      className="absolute left-0 right-0 top-0"
      style={{
        height,
        background: secondaryColor
          ? `linear-gradient(90deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
          : primaryColor,
      }}
    />
  );
}

/**
 * 渐变底部条
 */
function GradientBottomBar({
  height,
  primaryColor,
  secondaryColor,
}: {
  height: string;
  primaryColor: string;
  secondaryColor?: string;
}) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0"
      style={{
        height,
        background: secondaryColor
          ? `linear-gradient(90deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
          : primaryColor,
      }}
    />
  );
}

/**
 * 几何装饰图形
 */
function GeometricShapes({
  color,
  opacity,
}: {
  color: string;
  opacity: number;
}) {
  return (
    <>
      {/* 右上角三角形 */}
      <div
        className="pointer-events-none absolute right-0 top-0"
        style={{
          width: '120px',
          height: '120px',
          background: `linear-gradient(135deg, transparent 50%, ${color} 50%)`,
          opacity: opacity * 0.3,
        }}
      />
      {/* 左下角装饰线 */}
      <div
        className="pointer-events-none absolute bottom-20 left-0 h-px w-32"
        style={{
          background: `linear-gradient(90deg, ${color}, transparent)`,
          opacity: opacity * 0.5,
        }}
      />
      {/* 右侧装饰点 */}
      <div
        className="pointer-events-none absolute right-8 top-1/2 h-2 w-2 rounded-full"
        style={{
          backgroundColor: color,
          opacity: opacity * 0.4,
        }}
      />
    </>
  );
}

/**
 * 玻璃态边框效果
 */
function GlassBorder({ color }: { color: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-2xl"
      style={{
        border: `1px solid ${color}`,
        boxShadow: `inset 0 1px 1px rgba(255, 255, 255, 0.1)`,
      }}
    />
  );
}

/**
 * 主装饰组件
 */
export default function SlideDecorations({ template }: SlideDecorationsProps) {
  const { decorations, colors } = template;
  const isPremium = template.category === 'premium';

  return (
    <>
      {/* 顶部装饰条 */}
      {decorations.showTopBar && (
        <GradientTopBar
          height={decorations.topBarHeight || '4px'}
          primaryColor={colors.accent}
          secondaryColor={
            decorations.enableGradientBars ? colors.accentSecondary : undefined
          }
        />
      )}

      {/* 底部装饰条 */}
      {decorations.showBottomBar && (
        <GradientBottomBar
          height={decorations.topBarHeight || '3px'}
          primaryColor={colors.decorative}
          secondaryColor={
            decorations.enableGradientBars ? colors.accentSecondary : undefined
          }
        />
      )}

      {/* 角落光晕效果 */}
      {decorations.enableGlowEffects && colors.glow && (
        <>
          <CornerGlow
            position="top-left"
            color={colors.glow}
            size={decorations.cornerGlowSize || '250px'}
            opacity={decorations.cornerGlowOpacity || 0.15}
          />
          <CornerGlow
            position="bottom-right"
            color={colors.accentSecondary || colors.glow}
            size={decorations.cornerGlowSize || '250px'}
            opacity={(decorations.cornerGlowOpacity || 0.15) * 0.8}
          />
        </>
      )}

      {/* 几何装饰图形 */}
      {decorations.enableGeometricShapes && (
        <GeometricShapes
          color={colors.accent}
          opacity={decorations.cornerGlowOpacity || 0.2}
        />
      )}

      {/* 玻璃态边框（仅高级主题） */}
      {isPremium && colors.border && <GlassBorder color={colors.border} />}
    </>
  );
}

/**
 * 标题装饰下划线（渐变版）
 */
export function TitleUnderline({
  template,
  width = '80px',
}: {
  template: PPTTemplate;
  width?: string;
}) {
  const { decorations, colors } = template;

  if (!decorations.showTitleUnderline) return null;

  const useGradient = decorations.enableGradientBars && colors.accentSecondary;

  return (
    <div
      className="mt-3 h-1 rounded-full"
      style={{
        width,
        background: useGradient
          ? `linear-gradient(90deg, ${colors.accent} 0%, ${colors.accentSecondary} 100%)`
          : colors.decorative,
      }}
    />
  );
}

/**
 * 卡片装饰边框
 */
export function CardBorder({
  template,
  children,
  className = '',
}: {
  template: PPTTemplate;
  children: React.ReactNode;
  className?: string;
}) {
  const { decorations, colors, style } = template;

  if (!decorations.useCardLayout) {
    return <div className={className}>{children}</div>;
  }

  const borderStyle = decorations.showCardBorder
    ? {
        borderLeft: `3px solid ${colors.decorative}`,
      }
    : {};

  return (
    <div
      className={`${className}`}
      style={{
        backgroundColor: colors.cardBackground || 'transparent',
        borderRadius: style.cardBorderRadius || style.borderRadius,
        boxShadow: style.cardShadow,
        padding: '20px 24px',
        ...borderStyle,
      }}
    >
      {children}
    </div>
  );
}

/**
 * 数字高亮组件（渐变文字）
 */
export function HighlightNumber({
  value,
  template,
  size = 'large',
}: {
  value: string | number;
  template: PPTTemplate;
  size?: 'small' | 'medium' | 'large';
}) {
  const { colors, fonts } = template;
  const useGradient = colors.accentSecondary;

  const sizeMap = {
    small: '32px',
    medium: '48px',
    large: '64px',
  };

  const style: React.CSSProperties = {
    fontSize: sizeMap[size],
    fontWeight: 700,
    fontFamily: fonts.mono || fonts.heading,
    letterSpacing: '-0.02em',
  };

  if (useGradient) {
    return (
      <span
        style={{
          ...style,
          background: `linear-gradient(135deg, ${colors.accent} 0%, ${colors.accentSecondary} 100%)`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {value}
      </span>
    );
  }

  return <span style={{ ...style, color: colors.accent }}>{value}</span>;
}

/**
 * 统计数据卡片
 */
export function StatCard({
  value,
  label,
  template,
}: {
  value: string | number;
  label: string;
  template: PPTTemplate;
}) {
  const { colors, style, fonts } = template;

  return (
    <div
      className="flex flex-col items-center justify-center p-6"
      style={{
        backgroundColor: colors.cardBackground || 'rgba(255, 255, 255, 0.05)',
        borderRadius: style.cardBorderRadius || '12px',
        boxShadow: style.cardShadow,
      }}
    >
      <HighlightNumber value={value} template={template} size="large" />
      <span
        className="mt-2 text-center"
        style={{
          fontSize: '14px',
          color: colors.textTertiary,
          fontFamily: fonts.body,
        }}
      >
        {label}
      </span>
    </div>
  );
}
