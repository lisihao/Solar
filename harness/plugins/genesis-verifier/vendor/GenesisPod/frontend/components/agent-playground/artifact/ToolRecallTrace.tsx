'use client';

import { Wrench } from 'lucide-react';

interface ToolRecallEntry {
  agentId: string;
  role: string;
  recalledIds: readonly string[];
  categories: readonly string[];
  source: string;
  preferIds?: readonly string[];
}

interface Props {
  entries: ToolRecallEntry[];
}

/**
 * Phase P3-5 / P112-2: 展示每个 stage 的 Tool Recall 结果（trace 用）
 * 合并同 agentId 的多次召回（保留最后一次）
 */
export function ToolRecallTrace({ entries }: Props) {
  // dedup by agentId（保留最后一次）
  const dedupMap = new Map<string, ToolRecallEntry>();
  for (const e of entries) {
    dedupMap.set(e.agentId, e);
  }
  const dedupedEntries = Array.from(dedupMap.values());
  if (dedupedEntries.length === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900">
        <Wrench className="h-4 w-4 text-blue-500" />
        工具召回轨迹（{dedupedEntries.length} stage）
      </h3>
      <ul className="space-y-2">
        {dedupedEntries.map((e, i) => (
          <li
            key={i}
            className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700">
                {e.role}
              </span>
              <span className="text-gray-500">{e.agentId}</span>
              <span className="ml-auto rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                {e.source}
              </span>
            </div>
            {e.categories.length > 0 && (
              <p className="mt-1 text-[11px] text-gray-500">
                category: {e.categories.join(', ')}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {e.recalledIds.map((id) => (
                <span
                  key={id}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    e.preferIds?.includes(id)
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                  title={e.preferIds?.includes(id) ? 'recommended' : undefined}
                >
                  {e.preferIds?.includes(id) && '★ '}
                  {id}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
