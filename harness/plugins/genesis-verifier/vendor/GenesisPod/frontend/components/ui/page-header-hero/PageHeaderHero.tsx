'use client';

/**
 * PageHeaderHero
 *
 * AI App 主页统一的 hero 头部：圆角渐变 icon 方块 + 标题 + 副标题 + 右侧 actions slot。
 * 抽自 AI Insights / Playground (MissionGalleryView) / AI Radar 三处重复样式（2026-05-16）。
 * 2026-05-20：新增可选 onBack 返回按钮，使详情页（[id]/[topicId]）复用此 hero 而非自写头部。
 *
 * 设计原则：
 * - 只承担 header 视觉骨架；search bar、tabs、统计条由调用方在 children 中传入或放在组件下方
 * - 颜色主题（iconGradient）由调用方注入，平台不硬编码（紫色/青色等业务气质各异）
 * - 不带 sticky / backdrop / border 等容器样式 —— 由调用方决定容器（fixed 滚动 / 普通容器）
 */

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import {
  MODULE_THEMES,
  moduleFromPath,
  type ModuleKey,
} from '@/lib/design/module-themes';

export interface PageHeaderHeroProps {
  /** 主标题（"AI 雷达" / "AI 洞察" / "Agent Playground"） */
  title: string;
  /** 副标题，单行说明 */
  subtitle?: string;
  /**
   * Icon 节点（一般传 lucide 图标，h-7 w-7 + text-white）。
   * 不传则不渲染 icon 方块。
   */
  icon?: ReactNode;
  /**
   * Icon 方块的渐变 Tailwind 类（例 "from-violet-500 to-purple-600"）。
   * 默认 violet→purple，与 AI Insights 一致。
   */
  iconGradient?: string;
  /**
   * 阴影颜色 Tailwind 类（例 "shadow-violet-500/25"）。
   * 默认跟随 violet 主题。
   */
  iconShadowClass?: string;
  /**
   * 模块识别色：传入则按 module-themes 注册表上色（与侧边栏菜单一致）。
   * 不传时按当前路由自动匹配模块；都匹配不到才回退 iconGradient。
   */
  module?: ModuleKey;
  /** 右侧 actions slot（"新建"按钮 / Skills 按钮等） */
  actions?: ReactNode;
  /**
   * 返回回调。传入即在标题左侧渲染标准返回按钮（ChevronLeft），
   * 详情页（[id]/[topicId]）用它替代各页自写的返回按钮。不传则不渲染。
   */
  onBack?: () => void;
  /** 返回按钮无障碍标签（默认"返回"）。 */
  backLabel?: string;
  /** 额外 className，加在根容器上 */
  className?: string;
  /** 在 header 主体下方追加内容（一般是 search bar） */
  children?: ReactNode;
}

export function PageHeaderHero({
  title,
  subtitle,
  icon,
  iconGradient = 'from-violet-500 to-purple-600',
  iconShadowClass = 'shadow-violet-500/25',
  module,
  actions,
  onBack,
  backLabel = '返回',
  className,
  children,
}: PageHeaderHeroProps) {
  const pathname = usePathname();
  // 优先级：显式 module > 路由匹配的模块 > 调用方 iconGradient（默认紫）
  const themeKey = module ?? moduleFromPath(pathname);
  const effectiveGradient = themeKey
    ? MODULE_THEMES[themeKey].gradient
    : iconGradient;
  const effectiveShadow = themeKey ? 'shadow-gray-900/5' : iconShadowClass;
  return (
    <div className={cn('px-8 py-6', className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={backLabel}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {icon && (
            <div
              className={cn(
                'flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg',
                effectiveGradient,
                effectiveShadow
              )}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
