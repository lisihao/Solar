'use client';

import { Database, Tag, AlertCircle } from 'lucide-react';
import type { MemoryIndexState } from '@/lib/features/agent-playground/mission-presentation.types';
import { Card } from '@/components/agent-playground/ui';

type MissionPhase =
  | 'running'
  | 'completed-success'
  | 'completed-noindex'
  | 'aborted';

export function MemoryIndexPanel({
  memory,
  missionPhase = 'running',
}: {
  memory: MemoryIndexState | null;
  /** 控制空态文案语义：running / 完成-索引成功 / 完成-未发事件 / 取消失败 */
  missionPhase?: MissionPhase;
}) {
  return (
    <Card className="p-5" bordered>
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-semibold text-gray-900">记忆自动索引</h3>
      </div>
      {memory == null ? (
        // ★ 2026-05-27 Screenshot_53 修复：根据 missionPhase 区分空态文案
        //   - aborted（取消/失败）→ 中性提示，不是 backend bug
        //   - completed-noindex（成功但没收到事件）→ amber 警告，可能 backend 待补
        //   - running → 中性"运行中…"
        missionPhase === 'aborted' ? (
          <p className="rounded-lg bg-gray-50 px-3 py-3 text-[12px] text-gray-500">
            Mission 已中止，未生成记忆索引（trajectory indexing 仅在 S8
            完成后运行）
          </p>
        ) : missionPhase === 'completed-noindex' ? (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-[12px] text-amber-700">
              memory:indexed 事件未发出 — backend 待补数据
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-gray-50 px-3 py-3 text-[12px] text-gray-500">
            Mission 运行中，trajectory 将在 S8（撰写完成）后自动向量化入用户记忆
          </p>
        )
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-600">
              {memory.chunks}
            </span>
            <span className="text-xs text-gray-500">chunks 已索引</span>
          </div>
          {memory.namespace && (
            <p className="font-mono mt-2 text-[11px] text-gray-500">
              namespace ·{' '}
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
                {memory.namespace}
              </span>
            </p>
          )}
          {memory.tags && memory.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Tag className="h-3 w-3 text-gray-400" />
              {memory.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
