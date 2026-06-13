'use client';

import { cn } from '@/lib/utils/common';
import type { ForesightOverview } from '@/services/foresight/api';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { SENS_META } from './foresight-meta';

interface ReviewTabProps {
  overview: ForesightOverview;
  resolving: string | null;
  onResolve: (itemId: string, decision: 'adjust' | 'keep') => void;
  onSelectCard: (cardId: string) => void;
}

const FLOW_STEPS = [
  { t: '信号命中', d: '强信号过依据档案核验（阈值 + 多源确认）' },
  { t: '传播标记', d: '冲击度沿边权连乘衰减，超阈值入列' },
  { t: '认领裁定', d: '确认调整 / 维持原判' },
  { t: '状态落账', d: '置信度修订写入账本，标记解除' },
  { t: '结论复稳', d: '上游全部裁定后结论自动恢复' },
];

/** 复核工作流：冲击度降序待办 + 裁定（确认调整真实修订置信度并入账本） */
export function ReviewTab({
  overview,
  resolving,
  onResolve,
  onSelectCard,
}: ReviewTabProps) {
  const cardById = new Map(overview.cards.map((c) => [c.id, c]));
  const signalById = new Map(overview.signals.map((s) => [s.id, s]));
  const items = [...overview.reviewItems].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return (b.isSource ? 2 : b.impact) - (a.isSource ? 2 : a.impact);
  });
  const total = items.length;
  const done = items.filter((i) => i.status === 'resolved').length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-stretch gap-2 border border-gray-300 bg-white p-4 shadow-sm">
        {FLOW_STEPS.map((s, i) => (
          <div key={s.t} className="flex min-w-32 flex-1 flex-col gap-0.5">
            <span className="mb-1 flex h-6 w-6 items-center justify-center bg-amber-600 text-sm font-bold text-white">
              {i + 1}
            </span>
            <span className="text-sm font-bold">{s.t}</span>
            <span className="text-xs leading-snug text-gray-500">{s.d}</span>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-4">
        <span className="font-mono text-xs text-gray-500">
          {total === 0 ? '暂无待复核项' : `已裁定 ${done} / ${total}`}
        </span>
        <div className="h-1.5 min-w-48 flex-1 bg-gray-100">
          <span
            className="block h-full bg-emerald-500 transition-all"
            style={{ width: total === 0 ? '0%' : `${(done / total) * 100}%` }}
          />
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          title="复核队列为空"
          description="在工作台注入强信号后，受冲击假设按冲击度排序在此入列，逐项裁定。"
        />
      ) : (
        <div className="border border-gray-300 bg-white shadow-sm">
          {items.map((item) => {
            const c = cardById.get(item.cardId);
            const sig = signalById.get(item.signalId);
            if (!c) return null;
            const resolved = item.status === 'resolved';
            return (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-4 border-b border-dashed border-gray-200 px-4 py-3 last:border-b-0',
                  resolved && 'opacity-50'
                )}
              >
                <span
                  className={cn(
                    'w-9 shrink-0 border-r border-gray-200 text-center text-base font-bold',
                    item.isSource ? 'text-red-600' : 'text-gray-400'
                  )}
                >
                  {item.isSource ? '×' : `D${item.depth}`}
                </span>
                <button
                  onClick={() => onSelectCard(c.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="font-mono block text-xs text-gray-400">
                    {c.cardKey} · 由「{sig?.name ?? '信号'}」
                    {item.isSource ? '直接命中' : '传播标记'}
                  </span>
                  <span
                    className={cn(
                      'block text-sm font-semibold text-gray-900',
                      resolved && 'line-through decoration-gray-400'
                    )}
                  >
                    {c.title}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {item.isSource
                      ? '信号源假设 — 需确认置信度调整'
                      : '上游假设变动 — 需复核本假设是否仍成立'}
                  </span>
                </button>
                <span className="w-24 shrink-0">
                  <span className="block h-1 bg-gray-100">
                    <span
                      className="block h-full bg-amber-500"
                      style={{ width: `${item.impact * 100}%` }}
                    />
                  </span>
                  <span className="font-mono mt-0.5 block text-xs text-gray-500">
                    冲击 {item.impact.toFixed(2)}
                  </span>
                </span>
                <span
                  className={cn(
                    'font-mono shrink-0 border px-1.5 text-xs',
                    SENS_META[c.sens]?.cls
                  )}
                >
                  {SENS_META[c.sens]?.label}
                </span>
                {resolved ? (
                  <span
                    className={cn(
                      'font-mono shrink-0 border px-2 py-0.5 text-xs',
                      item.decision === 'adjust'
                        ? 'border-amber-400 bg-amber-50 text-amber-700'
                        : 'border-emerald-400 bg-emerald-50 text-emerald-700'
                    )}
                  >
                    {item.decision === 'adjust'
                      ? `已调整 ${item.confFrom?.toFixed(2)} → ${item.confTo?.toFixed(2)}`
                      : '维持原判'}
                  </span>
                ) : (
                  <span className="flex shrink-0 gap-2">
                    <button
                      onClick={() => onResolve(item.id, 'adjust')}
                      disabled={resolving === item.id}
                      className="bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      确认调整
                    </button>
                    <button
                      onClick={() => onResolve(item.id, 'keep')}
                      disabled={resolving === item.id}
                      className="border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-gray-500 disabled:opacity-50"
                    >
                      维持原判
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
