'use client';

import type { ReactNode } from 'react';
import { Coins, Trophy, Timer, Database } from 'lucide-react';
import { StatCard } from '@/components/ui/cards';
import type { MissionDetailView } from '@/services/agent-playground/api';
import type {
  CostState,
  MemoryIndexState,
} from '@/lib/features/agent-playground/mission-presentation.types';
import {
  fmtUsd,
  fmtTokens,
  fmtWallTime,
} from '@/lib/features/agent-playground/formatters';

interface Props {
  view: MissionDetailView;
  wallTimeMs: number;
  /**
   * DerivedView.cost — events-derived fallback when canonical view.cost is stale.
   * 优先于 view.cost 使用（screenshot #55: 顶部 stat 卡显示 $0 但 SummaryStrip 已有 $5.7）。
   */
  cost: CostState;
  /**
   * DerivedView.memory — events-derived fallback when canonical view.memoryIndex 未 populate。
   * 优先于 view.memoryIndex 使用（screenshot #64: 记忆卡显示空但下方 MemoryIndexPanel 已有 3 chunks）。
   */
  memory: MemoryIndexState | null;
}

type ToneKey = 'amber' | 'violet' | 'blue' | 'emerald';

interface Meter {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: ToneKey;
}

export function CapabilityMeters({ view, wallTimeMs, cost, memory }: Props) {
  const score = view.mission.finalScore;
  const verdicts = view.verdicts ?? [];
  // DerivedView.cost 是 events-derived 的稳定快照；canonical view.cost 在 mission
  //   刚完成时常 stale。下方 ComputeUsagePanel 也读 DerivedView.cost，对齐避免不一致。
  const tokensUsed = cost.tokensUsed ?? 0;
  const costUsd = cost.costUsd ?? 0;
  // 同理：memory 优先 DerivedView (event-derived)，view.memoryIndex 仅作后备。
  const memoryIndex = memory ?? view.memoryIndex ?? null;

  // ★ Screenshot_75 修复：mission 已终态 (有 completedAt/failedAt/cancelledAt)
  //   时"待评审"语义错误 — 此时报告已结束, 即便后端 verdicts 数组为空, 也已经
  //   过了 critic/leader-signoff 流程。改成显示 score 来源摘要或"评审完成"。
  const m = view.mission;
  const isTerminal = !!(
    (m as { completedAt?: number }).completedAt ??
    (m as { finishedAt?: number }).finishedAt ??
    (m as { failedAt?: number }).failedAt ??
    (m as { cancelledAt?: number }).cancelledAt
  );
  const qualitySub =
    verdicts.length > 0
      ? `${verdicts.length} 个评审`
      : score != null
        ? '评审完成'
        : isTerminal
          ? '未评审'
          : '待评审';

  const meters: Meter[] = [
    {
      icon: <Coins className="h-5 w-5" />,
      label: '消耗',
      value: fmtUsd(costUsd),
      sub: `${fmtTokens(tokensUsed)} tokens`,
      tone: 'amber',
    },
    {
      icon: <Trophy className="h-5 w-5" />,
      label: '质量评分',
      value: score != null ? String(score) : '—',
      sub: qualitySub,
      tone: 'violet',
    },
    {
      icon: <Timer className="h-5 w-5" />,
      label: '总耗时',
      value: fmtWallTime(wallTimeMs),
      sub:
        view.mission.status === 'completed'
          ? '已完成'
          : view.mission.finishedAt
            ? '已结束'
            : view.mission.startedAt
              ? '进行中'
              : '未启动',
      tone: 'blue',
    },
    {
      icon: <Database className="h-5 w-5" />,
      label: '记忆',
      value: memoryIndex != null ? `${memoryIndex.chunks}` : '—',
      sub: memoryIndex != null ? 'chunks 已索引' : '待索引',
      tone: 'emerald',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {meters.map((m) => (
        <StatCard
          key={m.label}
          label={m.label}
          value={m.value}
          hint={m.sub}
          icon={m.icon}
          tone={m.tone}
        />
      ))}
    </div>
  );
}
