'use client';

import {
  Bot,
  Sparkles,
  Wrench,
  Workflow,
  Users,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { MARKET_KIND_GRADIENTS } from '@/lib/design/tokens';
import type { ListingKind } from './marketplace.types';

/** 各货架的图标 + 名称 + 强调色（渐变走 design 层色板，feature 不写死）。 */
export const KIND_META: Record<
  ListingKind,
  {
    label: string;
    Icon: LucideIcon;
    gradient: string;
    soft: string;
    text: string;
  }
> = {
  team: {
    label: '团队',
    Icon: Users,
    gradient: MARKET_KIND_GRADIENTS.team,
    soft: 'bg-rose-50',
    text: 'text-rose-700',
  },
  agent: {
    label: 'Agent',
    Icon: Bot,
    gradient: MARKET_KIND_GRADIENTS.agent,
    soft: 'bg-green-50',
    text: 'text-green-700',
  },
  skill: {
    label: '技能',
    Icon: Sparkles,
    gradient: MARKET_KIND_GRADIENTS.skill,
    soft: 'bg-amber-50',
    text: 'text-amber-700',
  },
  tool: {
    label: '工具',
    Icon: Wrench,
    gradient: MARKET_KIND_GRADIENTS.tool,
    soft: 'bg-blue-50',
    text: 'text-blue-700',
  },
  workflow: {
    label: '工作流',
    Icon: Workflow,
    gradient: MARKET_KIND_GRADIENTS.workflow,
    soft: 'bg-violet-50',
    text: 'text-violet-700',
  },
};

/** 紧凑评分 + 采用数。rating 与 installs 均为 0 时不渲染（后端暂无统计时隐藏）。 */
export function RatingMeta({
  rating,
  installs,
}: {
  rating: number;
  installs: number;
}) {
  const hasStats = rating > 0 || installs > 0;
  if (!hasStats) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-gray-500">
      {rating > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {rating.toFixed(1)}
        </span>
      )}
      {installs > 0 && <span>{installs.toLocaleString()} 采用</span>}
    </div>
  );
}
