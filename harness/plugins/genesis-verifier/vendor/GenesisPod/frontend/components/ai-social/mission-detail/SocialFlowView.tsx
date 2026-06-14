'use client';

/**
 * SocialFlowView —— AI 社媒「协作动态」tab。
 *
 * 不复用 playground MissionFlowView：后者 Mission Pulse / 活跃 agent 读 research
 * 形状的 DerivedView（社媒喂进去是空的）。本组件吃社媒自己的 derive 产物
 * （SocialMissionView.agents 轨迹 + roles 状态）+ 原始 narrative 事件，织成统一时间线。
 *
 *   顶部 Pulse —— mission 状态 + 进度 + 进行中角色
 *   中部 StageStepper —— 社媒 12 阶段（canonical 组件）
 *   主体 时间线 —— narrative + 各 agent thought/action/observation/reflection，按 ts 排序
 */

import { useMemo } from 'react';
import {
  Activity,
  MessageSquare,
  Wrench,
  Eye,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  StageStepper,
  type StageStepperItem,
} from '@/components/common/mission-detail/StageStepper';
import { cn } from '@/lib/utils/common';
import {
  socialRoleLabel,
  type SocialMissionView,
  type SocialMissionStatus,
} from '@/lib/features/ai-social/derive-social';
import type { MissionEvent } from '@/hooks/features/useMissionStream';

type FlowKind =
  | 'narrative'
  | 'thought'
  | 'action'
  | 'observation'
  | 'reflection'
  | 'error';

interface FlowItem {
  ts: number;
  role?: string;
  kind: FlowKind;
  text: string;
  tone?: 'info' | 'success' | 'warn' | 'error';
}

function stripNs(t: string): string {
  const i = t.indexOf('.');
  return i >= 0 ? t.slice(i + 1) : t;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

const KIND_ICON: Record<FlowKind, LucideIcon> = {
  narrative: Activity,
  thought: MessageSquare,
  action: Wrench,
  observation: Eye,
  reflection: Sparkles,
  error: AlertTriangle,
};
const KIND_CLASS: Record<FlowKind, string> = {
  narrative: 'bg-gray-100 text-gray-600',
  thought: 'bg-violet-50 text-violet-600',
  action: 'bg-sky-50 text-sky-600',
  observation: 'bg-emerald-50 text-emerald-600',
  reflection: 'bg-amber-50 text-amber-600',
  error: 'bg-red-50 text-red-600',
};

const STATUS_TEXT: Record<SocialMissionStatus, string> = {
  idle: '待启动',
  running: '执行中',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
};

export function SocialFlowView({
  view,
  events,
  stepperStages,
}: {
  view: SocialMissionView;
  events: MissionEvent[];
  stepperStages: StageStepperItem[];
}) {
  const flow = useMemo<FlowItem[]>(() => {
    const out: FlowItem[] = [];
    // narrative 事件（社媒高频，最人类可读）
    for (const ev of events) {
      if (stripNs(ev.type ?? '') !== 'agent:narrative') continue;
      const p = (ev.payload ?? {}) as Record<string, unknown>;
      const text = typeof p.text === 'string' ? p.text : '';
      if (!text) continue;
      const tag = typeof p.tag === 'string' ? p.tag : 'info';
      const tone: FlowItem['tone'] =
        tag === 'success'
          ? 'success'
          : tag === 'error'
            ? 'error'
            : tag === 'warning' || tag === 'warn'
              ? 'warn'
              : 'info';
      out.push({
        ts: ev.timestamp,
        role: typeof p.role === 'string' ? p.role : undefined,
        kind: 'narrative',
        text,
        tone,
      });
    }
    // agent 轨迹（思考/行动/观察）
    for (const a of view.agents) {
      for (const it of a.trace) {
        const text =
          it.text ??
          it.toolId ??
          it.error ??
          (it.tokensUsed != null ? `${it.tokensUsed} tokens` : '');
        if (!text) continue;
        out.push({ ts: it.ts, role: a.role, kind: it.kind, text });
      }
    }
    out.sort((x, y) => x.ts - y.ts);
    return out;
  }, [events, view.agents]);

  const running = view.roles.filter((r) => r.status === 'working');

  if (flow.length === 0 && stepperStages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState
          icon={<Activity className="h-12 w-12" />}
          title="协作动态"
          description="任务执行时，团队的思考、工具调用与阶段进展会实时编织成时间线。"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-auto p-4">
      {/* Pulse */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {view.status === 'running' ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            ) : view.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : view.status === 'failed' ? (
              <XCircle className="h-4 w-4 text-red-500" />
            ) : (
              <Activity className="h-4 w-4 text-gray-400" />
            )}
            <span className="text-sm font-semibold text-gray-900">
              {STATUS_TEXT[view.status]}
            </span>
          </div>
          <span className="font-mono text-xs text-gray-500">
            {view.progress.done}/{view.progress.total} 阶段
          </span>
        </div>
        {running.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {running.map((r) => (
              <span
                key={r.role}
                className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
              >
                {r.label} 进行中
              </span>
            ))}
          </div>
        )}
      </div>

      <StageStepper stages={stepperStages} heading="社媒阶段" />

      {/* 时间线 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">实时动态</h3>
        {flow.length === 0 ? (
          <p className="text-xs text-gray-400">等待团队产出动态…</p>
        ) : (
          <ol className="space-y-2.5">
            {flow.map((f, i) => {
              const Icon = KIND_ICON[f.kind];
              return (
                <li key={`${f.ts}-${i}`} className="flex gap-2.5">
                  <span
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
                      KIND_CLASS[f.kind]
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      {f.role && (
                        <span className="text-xs font-medium text-gray-700">
                          {socialRoleLabel(f.role)}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-gray-400">
                        {fmtTime(f.ts)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        'break-words text-xs leading-relaxed',
                        f.tone === 'error'
                          ? 'text-red-600'
                          : f.tone === 'success'
                            ? 'text-emerald-700'
                            : f.tone === 'warn'
                              ? 'text-amber-700'
                              : 'text-gray-600'
                      )}
                    >
                      {f.text}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
