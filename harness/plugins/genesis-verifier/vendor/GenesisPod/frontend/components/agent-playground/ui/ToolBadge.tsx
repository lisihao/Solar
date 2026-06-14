'use client';

/**
 * ToolBadge —— 工具徽章。统一映射 toolId → 中文名 + Lucide 图标 + 调用次数 chip。
 * 全面替换 emoji（🔍 / 🌐 / 🎓 等违反前端规范）。
 */

import React from 'react';
import {
  Search,
  Globe,
  GraduationCap,
  Github,
  BookOpen,
  ScrollText,
  Scale,
  Landmark,
  Newspaper,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';

const TOOL_META: Record<
  string,
  {
    label: string;
    Icon: LucideIcon;
    tone: 'web' | 'academic' | 'gov' | 'kb' | 'other';
  }
> = {
  'web-search': { label: '网络搜索', Icon: Search, tone: 'web' },
  'web-scraper': { label: '网页抓取', Icon: Globe, tone: 'web' },
  'arxiv-search': { label: 'arXiv', Icon: GraduationCap, tone: 'academic' },
  'github-search': { label: 'GitHub', Icon: Github, tone: 'web' },
  'knowledge-base': { label: '知识库', Icon: BookOpen, tone: 'kb' },
  'rag-search': { label: '知识库', Icon: BookOpen, tone: 'kb' },
  'federal-register': {
    label: '联邦公报',
    Icon: ScrollText,
    tone: 'gov',
  },
  'congress-gov': { label: '国会立法', Icon: Scale, tone: 'gov' },
  'whitehouse-news': { label: '白宫新闻', Icon: Landmark, tone: 'gov' },
  'academic-search': { label: '学术', Icon: GraduationCap, tone: 'academic' },
  hackernews: { label: 'HN', Icon: Newspaper, tone: 'web' },
};

const TONE_CLASSES: Record<
  'web' | 'academic' | 'gov' | 'kb' | 'other',
  string
> = {
  web: 'bg-blue-50 text-blue-700 ring-blue-200',
  academic: 'bg-violet-50 text-violet-700 ring-violet-200',
  gov: 'bg-amber-50 text-amber-700 ring-amber-200',
  kb: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  other: 'bg-gray-50 text-gray-700 ring-gray-200',
};

interface ToolBadgeProps {
  toolId: string;
  count?: number;
  size?: 'xs' | 'sm';
}

export function ToolBadge({ toolId, count, size = 'sm' }: ToolBadgeProps) {
  const meta = TOOL_META[toolId] ?? {
    label: toolId,
    Icon: Wrench,
    tone: 'other' as const,
  };
  const Icon = meta.Icon;
  const sizeCls =
    size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  const iconSizeCls = size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md font-medium ring-1',
        TONE_CLASSES[meta.tone],
        sizeCls
      )}
      title={`${meta.label} · ${toolId}`}
    >
      <Icon className={iconSizeCls} />
      <span>{meta.label}</span>
      {count !== undefined && count > 1 && (
        <span className="font-mono ml-0.5 rounded bg-white/70 px-1 text-[9px] font-semibold">
          ×{count}
        </span>
      )}
    </span>
  );
}
