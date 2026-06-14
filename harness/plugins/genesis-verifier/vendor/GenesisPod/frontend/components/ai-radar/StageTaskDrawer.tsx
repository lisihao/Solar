'use client';

/**
 * StageTaskDrawer —— 单个 Stage Task 的「完整故事」抽屉
 *
 * 由 mission 详情页表格行点击触发，展示某个 Agent 在本次 Mission 中的任务执行
 * 细节。信息架构参考 agent-playground TodoDetailDrawer：
 *
 *   Header        : Agent badge + 任务名 + 状态 chip
 *   Agent profile : 角色名 / 描述 / 是否调 LLM
 *   Task config   : Loop / 模型 / 阶段范围 / 输入数据
 *   产出 metrics  : 该 stage 对应的 metric 子集
 *   Failure       : 失败原因（仅当本 stage 是 mission 中断点时）
 */

import { useMemo } from 'react';
import {
  AlertCircle,
  Check,
  Database,
  Loader2,
  Radar,
  Sparkles,
  Wand2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { SideDrawer } from '@/components/common/drawers/SideDrawer';
import { StatCard } from '@/components/ui/cards';
import type { RadarDroppedItem, RadarRun } from '@/services/ai-radar/types';
import type { RadarStreamEvent } from '@/services/ai-radar/api';
import {
  agentRoleTone,
  stageGroupStatus,
  stageStateTone,
  type StageGroup,
  type StageState,
} from './run-helpers';

const AGENT_ICON: Record<string, LucideIcon> = {
  collector: Radar,
  deduper: Database,
  scorer: Sparkles,
  enricher: Wand2,
  persister: Check,
};

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

interface Props {
  run: RadarRun;
  stage: StageGroup | null;
  /** 仅 mission 仍在 running 时来自 WS 的实时 stage 名 */
  currentStage: string | null;
  /** useRadarStream 累积的事件流 —— collect stage 渲染采集实时明细 */
  events?: RadarStreamEvent[];
  onClose: () => void;
}

export function StageTaskDrawer({
  run,
  stage,
  currentStage,
  events,
  onClose,
}: Props) {
  const state: StageState | null = useMemo(
    () => (stage ? stageGroupStatus(run, stage, currentStage) : null),
    [stage, run, currentStage]
  );

  // 采集实时明细：从事件流提取 source-progress（按 sourceId 去重保最新）
  const sourceProgress = useMemo(() => {
    type SrcItem = { title: string | null; url: string | null };
    const out = new Map<
      string,
      {
        sourceId: string;
        sourceLabel: string;
        items: number;
        durationMs: number;
        error: string | null;
        sample: SrcItem[];
      }
    >();
    for (const e of events ?? []) {
      if (e.type !== 'ai-radar.run.source-progress') continue;
      const p = (e.payload ?? {}) as {
        sourceId?: string;
        sourceLabel?: string;
        items?: number;
        durationMs?: number;
        error?: string | null;
        sample?: SrcItem[];
      };
      if (!p.sourceId) continue;
      out.set(p.sourceId, {
        sourceId: p.sourceId,
        sourceLabel: p.sourceLabel ?? p.sourceId,
        items: p.items ?? 0,
        durationMs: p.durationMs ?? 0,
        error: p.error ?? null,
        sample: p.sample ?? [],
      });
    }
    return [...out.values()];
  }, [events]);

  if (!stage || !state) return null;

  const tone = agentRoleTone(stage.agent.role);
  const stTone = stageStateTone(state);
  const Icon = AGENT_ICON[stage.agent.role] ?? Sparkles;

  const isFailureStage = state === 'failed';
  const isCancelledStage = state === 'cancelled';
  const metricVal =
    stage.metricKey != null ? (run.metrics?.[stage.metricKey] ?? null) : null;

  // 该 stage 在 mission 的相关 sourceErrors（仅 collect / dedupe / 类似阶段相关）
  const sourceErrors =
    stage.id === 'collect' ? (run.metrics?.sourceErrors ?? []) : [];

  return (
    <SideDrawer open onClose={onClose} title="Stage 任务详情" widthPx={560}>
      <div className="flex flex-col gap-4">
        {/* Header — Agent badge + 任务名 + 状态 */}
        <header className="flex items-start gap-3">
          <span
            className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${tone.bg} ${tone.ring}`}
          >
            <Icon className={`h-5 w-5 ${tone.text}`} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="text-base font-semibold text-gray-900">
                {stage.label}
              </h3>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ${stTone.bg} ${stTone.text} ${stTone.ring}`}
              >
                {state === 'running' && (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                )}
                {state === 'completed' && <Check className="h-2.5 w-2.5" />}
                {state === 'failed' && <X className="h-2.5 w-2.5" />}
                {state === 'cancelled' && <XCircle className="h-2.5 w-2.5" />}
                {stTone.label}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">
              {stage.hint}
            </p>
          </div>
        </header>

        {/* Agent profile */}
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            负责 Agent
          </h4>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ${tone.bg} ${tone.text} ${tone.ring}`}
              >
                <Icon className="h-3 w-3" />
                {stage.agent.name}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-gray-600">
              {stage.agent.description}
            </p>
          </div>
        </section>

        {/* Task config */}
        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            任务配置
          </h4>
          <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-gray-500">阶段范围</dt>
            <dd className="font-mono text-gray-800">
              stage {stage.stageNumStart}
              {stage.stageNumEnd !== stage.stageNumStart && (
                <>-{stage.stageNumEnd}</>
              )}
              {' / 8'}
            </dd>
            <dt className="text-gray-500">原子 stage</dt>
            <dd className="font-mono text-[11px] text-gray-800">
              {stage.stages.join(' → ')}
            </dd>
            <dt className="text-gray-500">是否调 LLM</dt>
            <dd
              className={
                stage.agent.usesLLM ? 'text-violet-700' : 'text-gray-600'
              }
            >
              {stage.agent.usesLLM
                ? '是 · CHAT 模型（按 TaskProfile 路由）'
                : '否'}
            </dd>
            {state === 'running' && currentStage && (
              <>
                <dt className="text-gray-500">实时阶段</dt>
                <dd className="font-mono text-violet-700">{currentStage}</dd>
              </>
            )}
          </dl>
        </section>

        {/* 产出 metrics（如果该 stage 有专属指标） */}
        {metricVal != null && stage.metricLabel && (
          <StatCard
            label="本 stage 产出"
            value={metricVal}
            hint={stage.metricLabel}
            tone="emerald"
          />
        )}

        {/* R10 2026-05-19: 流失归因 —— 仅 scorer / persister 显示。
            scorer 是评分决策点，persister 是最终入选过滤点，都关心淘汰原因。 */}
        {(stage.agent.role === 'scorer' ||
          stage.agent.role === 'persister') && (
          <DropAttributionSection run={run} />
        )}

        {/* Failure details — 仅本 stage 是 mission 失败/取消点 */}
        {(isFailureStage || isCancelledStage) && run.error && (
          <section
            className={`rounded-md border p-3 ${
              isFailureStage
                ? 'border-red-200 bg-red-50'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <h4
              className={`mb-1 inline-flex items-center gap-1.5 text-xs font-semibold ${
                isFailureStage ? 'text-red-700' : 'text-slate-700'
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {isFailureStage ? '中断点：失败原因' : '中断点：取消原因'}
            </h4>
            <p
              className={`text-xs leading-relaxed ${
                isFailureStage ? 'text-red-700' : 'text-slate-700'
              }`}
            >
              {run.error}
            </p>
            <p className="mt-1.5 text-[11px] text-gray-500">
              Mission 在 stage {(run.lastCompletedStage ?? 0) + 1} 处中断 ——
              本任务正好落在中断阶段
            </p>
          </section>
        )}

        {/* 采集实时明细（collect stage 特有，来自事件流）—— 逐源 条数/耗时/错误，
            采集进行中实时点亮，直接回答"哪个源慢、抓了什么" */}
        {stage.id === 'collect' && sourceProgress.length > 0 && (
          <section className="rounded-lg border border-gray-200 bg-white p-3">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              采集实时明细（{sourceProgress.length} 源）
            </h4>
            <ul className="flex flex-col gap-1">
              {sourceProgress.map((s) => (
                <li
                  key={s.sourceId}
                  className="rounded-md border border-gray-100 bg-gray-50/40 px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-gray-800">
                      {s.sourceLabel}
                    </span>
                    {s.error ? (
                      <span className="whitespace-nowrap text-amber-700">
                        {s.error.slice(0, 40)} · {fmtMs(s.durationMs)}
                      </span>
                    ) : (
                      <span className="whitespace-nowrap text-gray-500">
                        <span
                          className={
                            s.items > 0
                              ? 'font-semibold text-emerald-700'
                              : 'text-gray-500'
                          }
                        >
                          {s.items} 条
                        </span>
                        {' · '}
                        {fmtMs(s.durationMs)}
                      </span>
                    )}
                  </div>
                  {/* 抓到的具体文章（标题可点击追溯原文） */}
                  {s.sample.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5 border-l border-gray-200 pl-2">
                      {s.sample.map((it, i) => (
                        <li
                          key={it.url ?? `${s.sourceId}-${i}`}
                          className="truncate"
                        >
                          {it.url ? (
                            <a
                              href={it.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-violet-700 hover:underline"
                              title={it.title ?? it.url}
                            >
                              {it.title || it.url}
                            </a>
                          ) : (
                            <span className="text-gray-600">
                              {it.title || '(无标题)'}
                            </span>
                          )}
                        </li>
                      ))}
                      {s.items > s.sample.length && (
                        <li className="text-[10px] text-gray-400">
                          …还有 {s.items - s.sample.length} 条
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 源级错误（collect stage 特有） */}
        {sourceErrors.length > 0 && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
            <h4 className="mb-1.5 text-xs font-semibold text-amber-800">
              源级错误（{sourceErrors.length} 个）
            </h4>
            <ul className="flex flex-col gap-1">
              {sourceErrors.slice(0, 20).map((e, i) => (
                <li
                  key={`${e.sourceId}-${i}`}
                  className="text-xs text-amber-700"
                >
                  <span className="font-mono">
                    {e.sourceId?.slice(0, 8) ?? '(unknown)'}
                  </span>
                  {' — '}
                  {e.error}
                </li>
              ))}
              {sourceErrors.length > 20 && (
                <li className="text-xs text-amber-600">
                  …还有 {sourceErrors.length - 20} 个，请查看后端日志
                </li>
              )}
            </ul>
          </section>
        )}

        {/* Pending hint */}
        {state === 'pending' && (
          <section className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            该阶段尚未启动。等待前置 stage 完成后 framework 会自动调度本 Agent。
          </section>
        )}
      </div>
    </SideDrawer>
  );
}

// ──────────────────────────────────────────────────────────────────────
// DropAttributionSection — 单条 item 流失诊断（R10 2026-05-19 新增）
//
// 用户痛点："数据 1 → 0 中间没有任何原因就丢了"。S8 写 metrics 时把每个被
// 淘汰 item 的 rel/qual 分 + 阈值 + 原因落 droppedItems[]，本组件直接展示。
// ──────────────────────────────────────────────────────────────────────

function DropAttributionSection({ run }: { run: RadarRun }) {
  const m = run.metrics;
  const dropped = m?.droppedItems ?? [];
  const thresholds = m?.thresholds;
  const droppedAtRelevance = m?.droppedAtRelevance ?? 0;
  const droppedAtQuality = m?.droppedAtQuality ?? 0;
  const totalDropped = droppedAtRelevance + droppedAtQuality;
  // R10.5 2026-05-19: 区分"没有任何 item 进入评分"vs"评分阶段无淘汰"
  // 用户痛点：抓 1 → 重复 1 → 入库 0，drawer 错误显示"无 item 被淘汰"
  // 但视觉上明明丢了 1 条。区分历史去重 vs 评分淘汰，给两种不同提示文案。
  const fetched = m?.itemsFetched ?? 0;
  const removedAsDup = m?.itemsDeduped ?? 0;
  const enteredScoring =
    m?.itemsInserted ?? Math.max(0, fetched - removedAsDup);

  if (
    !thresholds &&
    dropped.length === 0 &&
    totalDropped === 0 &&
    fetched === 0
  ) {
    return null;
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        流失归因
      </h4>

      {/* Thresholds 阈值快照 */}
      {thresholds && (
        <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
          <ThresholdChip
            label="相关性门槛"
            value={thresholds.relevanceMin}
            tip={`< ${thresholds.relevanceGate} 不进质量评分；< ${thresholds.relevanceMin} 不入选`}
          />
          <ThresholdChip
            label="质量分门槛"
            value={thresholds.qualityMin}
            tip={`质量分 < ${thresholds.qualityMin} 不入选`}
          />
          <ThresholdChip
            label="累计淘汰"
            value={totalDropped}
            danger={totalDropped > 0}
            tip={`相关性 ${droppedAtRelevance} · 质量 ${droppedAtQuality}`}
          />
        </div>
      )}

      {/* 流失 item 清单 */}
      {dropped.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {dropped.map((item) => (
            <DroppedItemRow key={item.id} item={item} />
          ))}
          {totalDropped > dropped.length && (
            <li className="px-1 text-[11px] text-gray-500">
              …另有 {totalDropped - dropped.length} 条按相关性排序后被截断
            </li>
          )}
        </ul>
      ) : totalDropped === 0 ? (
        enteredScoring === 0 && removedAsDup > 0 ? (
          <p className="text-xs leading-relaxed text-gray-600">
            本次抓取的 {removedAsDup} 条内容全部是历史已存在的旧 item，
            没有新内容进入评分阶段，评分阶段无淘汰发生。
          </p>
        ) : (
          <p className="text-xs text-gray-500">
            评分阶段无 item 被淘汰（全部通过相关性 + 质量门槛）。
          </p>
        )
      ) : (
        <p className="text-xs text-gray-500">
          淘汰计数已记录但清单为空（旧版 run，请等下一次刷新）。
        </p>
      )}
    </section>
  );
}

function ThresholdChip({
  label,
  value,
  tip,
  danger,
}: {
  label: string;
  value: number;
  tip: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-md border px-2 py-1 ${
        danger ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50/50'
      }`}
      title={tip}
    >
      <div className="text-[10px] text-gray-500">{label}</div>
      <div
        className={`text-sm font-semibold ${
          danger ? 'text-red-700' : 'text-gray-800'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DroppedItemRow({ item }: { item: RadarDroppedItem }) {
  const stageTone =
    item.stage === 'relevance'
      ? 'text-amber-700 bg-amber-50 ring-amber-200'
      : item.stage === 'quality'
        ? 'text-orange-700 bg-orange-50 ring-orange-200'
        : 'text-gray-700 bg-gray-50 ring-gray-200';
  return (
    <li className="rounded-md border border-gray-100 bg-gray-50/40 px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              className="line-clamp-1 text-xs font-medium text-gray-900 hover:text-violet-700 hover:underline"
              title={item.title}
            >
              {item.title}
            </a>
          ) : (
            <span className="line-clamp-1 text-xs font-medium text-gray-900">
              {item.title}
            </span>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-gray-500">
            <span className="truncate">{item.sourceLabel}</span>
            <span>·</span>
            <span>
              相关性{' '}
              <span className="font-mono">{item.relevanceScore ?? '—'}</span>
            </span>
            {item.qualityScore != null && (
              <>
                <span>·</span>
                <span>
                  质量 <span className="font-mono">{item.qualityScore}</span>
                </span>
              </>
            )}
          </div>
        </div>
        <span
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${stageTone}`}
          title={item.reason}
        >
          {item.reason}
        </span>
      </div>
    </li>
  );
}
