'use client';

/**
 * RoleChip —— Agent 角色徽章（Leader / Researcher / ...）。
 * 使用 Lucide 图标（禁止 emoji）。
 */

import React from 'react';
import {
  Brain,
  Search,
  GitBranch,
  PenLine,
  Gavel,
  ScanSearch,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { roleToken, type RoleKey } from '@/lib/design/tokens';

const ROLE_ICON: Record<RoleKey, typeof Brain> = {
  leader: Brain,
  researcher: Search,
  analyst: GitBranch,
  writer: PenLine,
  reviewer: Gavel,
  critic: ShieldAlert,
  reconciler: ScanSearch,
  mission: Sparkles,
};

interface RoleChipProps {
  role: RoleKey | string;
  /** 角色后跟的实例 id（researcher#3） */
  agentId?: string;
  /** 仅显示图标（icon-only） */
  iconOnly?: boolean;
  size?: 'xs' | 'sm';
}

export function RoleChip({
  role,
  agentId,
  iconOnly = false,
  size = 'sm',
}: RoleChipProps) {
  const safeRole =
    (role as RoleKey) in roleToken ? (role as RoleKey) : 'mission';
  const token = roleToken[safeRole];
  const Icon = ROLE_ICON[safeRole];
  const sizeCls =
    size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  const iconSizeCls = size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3';
  const display = agentId ?? token.label;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md font-medium ring-1',
        token.text,
        token.bg,
        token.ring,
        sizeCls
      )}
      title={agentId ? `${token.label} · ${agentId}` : token.label}
    >
      <Icon className={iconSizeCls} />
      {!iconOnly && display}
    </span>
  );
}
