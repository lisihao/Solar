'use client';

import { useState } from 'react';
import { Layers, ChevronDown, ChevronRight } from 'lucide-react';
import type { MissionState } from '@/lib/features/agent-playground/mission-presentation.types';
import { Card, ExpandableText } from '@/components/agent-playground/ui';

export function DimensionsPanel({ mission }: { mission: MissionState }) {
  const dims = mission.dimensions ?? [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);

  if (!mission.themeSummary && dims.length === 0) {
    return (
      <Card className="p-5" bordered>
        <div className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            研究维度（Research Dimensions）
          </h3>
        </div>
        <p className="rounded-lg bg-gray-50 px-3 py-3 text-[12px] text-gray-500">
          等 Leader 产出 theme summary 和维度规划
        </p>
      </Card>
    );
  }

  const toggle = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAll = () => {
    const next = !allExpanded;
    setAllExpanded(next);
    const all: Record<string, boolean> = {};
    for (const d of dims) all[d.id ?? d.name] = next;
    setExpanded(all);
  };

  return (
    <Card className="p-5" bordered>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            研究维度（Research Dimensions）
          </h3>
          {dims.length > 0 && (
            <span className="text-xs text-gray-500">· {dims.length}</span>
          )}
        </div>
        {dims.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] font-medium text-violet-600 hover:text-violet-800"
          >
            {allExpanded ? '全部收起' : '全部展开'}
          </button>
        )}
      </div>

      {mission.themeSummary && (
        <div className="mb-3 rounded-lg bg-violet-50/50 px-3 py-2 ring-1 ring-violet-100">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
            主题摘要
          </p>
          <ExpandableText
            text={mission.themeSummary}
            maxChars={280}
            className="text-[12px] leading-relaxed text-violet-900"
          />
        </div>
      )}

      <ol className="space-y-1.5">
        {dims.map((d, i) => {
          const key = d.id ?? d.name;
          const isOpen = expanded[key];
          return (
            <li
              key={key}
              className="rounded-lg border border-gray-100 transition-colors hover:border-violet-200"
            >
              <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-start gap-2.5 p-2.5 text-left"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[12px] font-medium text-gray-900">
                      {d.name}
                    </p>
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {isOpen ? '收起' : '展开'}
                    </span>
                  </div>
                  {!isOpen && d.rationale && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">
                      {d.rationale}
                    </p>
                  )}
                </div>
                {isOpen ? (
                  <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                ) : (
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                )}
              </button>
              {isOpen && d.rationale && (
                <div className="border-t border-violet-100 bg-violet-50/30 px-3 py-2.5">
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                    维度立项理由
                  </p>
                  <ExpandableText
                    text={d.rationale}
                    maxChars={400}
                    className="text-[12px] leading-relaxed text-gray-800"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
