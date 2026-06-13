'use client';

import { cn } from '@/lib/utils/common';
import type { ForesightOverview } from '@/services/foresight/api';
import { EmptyState } from '@/components/ui/states/EmptyState';

interface ConclusionsTabProps {
  overview: ForesightOverview;
  impactedKeys: Set<string>;
  onSelectCardKey: (cardKey: string) => void;
}

/** 洞察结论 —— 决策级输出：量化依据 + 编号决策建议 + 重估触发条件 */
export function ConclusionsTab({
  overview,
  impactedKeys,
  onSelectCardKey,
}: ConclusionsTabProps) {
  const { conclusions } = overview;

  if (conclusions.length === 0) {
    return (
      <EmptyState
        title="暂无洞察结论"
        description="结论由假设推导得出 — 上游假设被信号冲击时，依赖它的结论自动标记待复核。"
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {conclusions.map((cc) => {
        const hit = impactedKeys.has(cc.conclKey);
        return (
          <div
            key={cc.id}
            className={cn(
              'flex flex-col gap-2.5 border bg-white p-4 shadow-sm',
              hit ? 'border-amber-500 bg-amber-50' : 'border-gray-300'
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-600">{cc.conclKey}</span>
              <span
                className={cn(
                  'font-mono border px-2 py-0.5 text-xs',
                  hit
                    ? 'border-amber-500 bg-amber-500 font-semibold text-white'
                    : 'border-emerald-400 bg-emerald-50 text-emerald-700'
                )}
              >
                {hit ? '受冲击 · 待复核' : '稳固'}
              </span>
            </div>
            <h3 className="text-base font-bold leading-snug text-gray-900">
              {cc.title}
            </h3>
            <p className="flex-1 text-xs leading-relaxed text-gray-600">
              {cc.body}
            </p>
            <div className="border-l-2 border-amber-500 bg-gray-50 p-2.5">
              <p className="font-mono mb-1 text-xs uppercase tracking-widest text-amber-700">
                决策建议 Decisions
              </p>
              <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-gray-800">
                {cc.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ol>
            </div>
            <p className="border border-dashed border-red-300 bg-white px-2.5 py-1.5 text-xs leading-relaxed text-gray-500">
              重估触发：{cc.trigger}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {cc.upstreamKeys.map((k) => (
                <button
                  key={k}
                  onClick={() => onSelectCardKey(k)}
                  className="font-mono border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-500 hover:border-gray-500"
                >
                  {k}
                </button>
              ))}
              <span className="font-mono ml-auto text-xs text-gray-400">
                CONF {cc.conf.toFixed(2)} · H·{cc.horizon}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
