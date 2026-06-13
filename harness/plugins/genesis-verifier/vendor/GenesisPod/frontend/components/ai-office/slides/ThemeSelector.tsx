'use client';

import { cn } from '@/lib/utils/common';

/**
 * 可用主题配置
 */
export const SLIDE_THEMES = [
  {
    id: 'genspark-dark',
    name: '深邃蓝',
    description: '专业深色主题',
    preview: {
      bg: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
      accent: '#F97316',
      text: '#F8FAFC',
    },
  },
  {
    id: 'tech-purple',
    name: '科技紫',
    description: '科技感主题',
    preview: {
      bg: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
      accent: '#A78BFA',
      text: '#F8FAFC',
    },
  },
  {
    id: 'executive-white',
    name: '商务白',
    description: '简洁商务主题',
    preview: {
      bg: 'linear-gradient(135deg, #FFFFFF 0%, #F1F5F9 100%)',
      accent: '#0EA5E9',
      text: '#1E293B',
    },
  },
  {
    id: 'nature-green',
    name: '自然绿',
    description: '清新自然主题',
    preview: {
      bg: 'linear-gradient(135deg, #064E3B 0%, #065F46 100%)',
      accent: '#34D399',
      text: '#F8FAFC',
    },
  },
  {
    id: 'warm-sunset',
    name: '暖阳橙',
    description: '温暖活力主题',
    preview: {
      bg: 'linear-gradient(135deg, #7C2D12 0%, #9A3412 100%)',
      accent: '#FB923C',
      text: '#F8FAFC',
    },
  },
] as const;

export type SlideThemeId = (typeof SLIDE_THEMES)[number]['id'];

// 内部统一主题项接口
interface ThemeItem {
  id: string;
  name: string;
  description: string;
  preview: string; // CSS gradient 字符串
  colors: {
    primary: string;
    accent: string;
    text: string;
  };
}

// 将 SLIDE_THEMES 转换为 ThemeItem 格式（供默认使用）
const DEFAULT_THEMES: ThemeItem[] = SLIDE_THEMES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  preview: t.preview.bg,
  colors: {
    primary: t.preview.bg,
    accent: t.preview.accent,
    text: t.preview.text,
  },
}));

interface ThemeSelectorProps {
  value: string;
  onChange: (themeId: string) => void;
  className?: string;
  compact?: boolean;
  themes?: ThemeItem[];
}

/**
 * 主题选择器组件
 * 用于在幻灯片生成时选择主题风格
 */
export function ThemeSelector({
  value,
  onChange,
  className,
  compact = false,
  themes,
}: ThemeSelectorProps) {
  const displayThemes = themes && themes.length > 0 ? themes : DEFAULT_THEMES;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {!compact && (
        <label className="text-xs font-medium text-slate-500">主题风格</label>
      )}
      <div
        className={cn(
          'grid gap-2',
          compact ? 'grid-cols-5' : 'grid-cols-3 sm:grid-cols-5'
        )}
      >
        {displayThemes.map((theme) => {
          const isSelected = value === theme.id;
          return (
            <button
              key={theme.id}
              onClick={() => onChange(theme.id)}
              className={cn(
                'group relative flex flex-col overflow-hidden rounded-lg border-2 transition-all hover:scale-105',
                isSelected
                  ? 'border-2'
                  : 'border-slate-200 hover:border-slate-400'
              )}
              style={
                isSelected
                  ? {
                      borderColor: theme.colors.accent,
                      boxShadow: `0 0 0 3px ${theme.colors.accent}33`,
                    }
                  : undefined
              }
              title={theme.description}
            >
              {/* 预览区域 */}
              <div
                className={cn(
                  'relative aspect-[16/9] w-full',
                  compact ? 'min-h-[40px]' : 'min-h-[60px]'
                )}
                style={{ background: theme.preview }}
              >
                {/* 模拟内容 */}
                <div className="absolute inset-2 flex flex-col gap-1">
                  <div
                    className="h-1 w-3/4 rounded-full"
                    style={{ background: theme.colors.text, opacity: 0.9 }}
                  />
                  <div
                    className="h-0.5 w-1/2 rounded-full"
                    style={{ background: theme.colors.text, opacity: 0.5 }}
                  />
                  <div className="mt-auto flex gap-1">
                    <div
                      className="h-2 w-2 rounded-sm"
                      style={{ background: theme.colors.accent }}
                    />
                    <div
                      className="h-2 w-2 rounded-sm"
                      style={{ background: theme.colors.accent, opacity: 0.6 }}
                    />
                  </div>
                </div>

                {/* 选中标记 */}
                {isSelected && (
                  <div
                    className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ background: theme.colors.accent }}
                  >
                    <svg
                      className="h-2.5 w-2.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                )}
              </div>

              {/* 名称 - 浅色风格 */}
              {!compact && (
                <div className="bg-gray-50 px-2 py-1 text-center">
                  <span className="text-[10px] font-medium text-gray-700">
                    {theme.name}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 获取主题信息
 */
export function getThemeInfo(themeId: SlideThemeId) {
  return SLIDE_THEMES.find((t) => t.id === themeId) || SLIDE_THEMES[0];
}
