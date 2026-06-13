'use client';

/**
 * StageProcessPanel — 渲染 backend canonical view 上 stage.processTrace 字段
 *
 * T75 落地：系统级 stage (Reconciler / Analyst / Writer-Outline / Writer-Draft
 * 等) 的 Drawer 直接从 canonical view.stages[X].processTrace 取过程数据，
 * 不再依赖 agentId-linking 间接命中。
 *
 * 数据源：harness MissionViewBaseStage.processTrace + playground
 * stage-view.projector 派生（agent:thought/action/observation/reflection/error +
 * reconciliation:completed → outputPeek 等业务事件）。
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { StageProcessTrace } from '@/lib/features/agent-playground/mission-presentation.types';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { cn } from '@/lib/utils/common';

interface Props {
  processTrace: StageProcessTrace;
  stageLabel?: string;
}

function fmtMs(ms: number | undefined): string {
  if (ms == null || ms === 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function fmtTokens(n: number | undefined): string {
  if (n == null || n === 0) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtUsd(n: number | undefined): string {
  if (n == null) return '—';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const KIND_LABEL: Record<
  NonNullable<StageProcessTrace['reactTrace']>[number]['kind'],
  string
> = {
  thought: '思考',
  action: '调用',
  observation: '返回',
  reflection: '反思',
  error: '错误',
};

const KIND_DOT: Record<
  NonNullable<StageProcessTrace['reactTrace']>[number]['kind'],
  string
> = {
  thought: 'bg-blue-400',
  action: 'bg-violet-400',
  observation: 'bg-emerald-400',
  reflection: 'bg-amber-400',
  error: 'bg-red-500',
};

export function StageProcessPanel({ processTrace, stageLabel }: Props) {
  const [traceOpen, setTraceOpen] = useState(false);

  const {
    inputs,
    llmCalls,
    outputPeek,
    reactTrace,
    totalTokens,
    totalDurationMs,
    stepCount,
  } = processTrace;

  const hasAny =
    (inputs?.length ?? 0) > 0 ||
    (llmCalls?.length ?? 0) > 0 ||
    outputPeek != null ||
    (reactTrace?.length ?? 0) > 0 ||
    totalTokens != null ||
    totalDurationMs != null ||
    stepCount != null;

  if (!hasAny) return null;

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          阶段过程 · stage process
        </h4>
        {stageLabel && (
          <span className="text-[11px] text-gray-400">{stageLabel}</span>
        )}
      </div>

      {/* 概览 stat chips */}
      {(stepCount != null ||
        totalTokens != null ||
        totalDurationMs != null) && (
        <div className="flex flex-wrap gap-1.5">
          {stepCount != null && (
            <StatChip label="步数" value={String(stepCount)} />
          )}
          {totalTokens != null && (
            <StatChip label="Tokens" value={fmtTokens(totalTokens)} />
          )}
          {totalDurationMs != null && (
            <StatChip label="耗时" value={fmtMs(totalDurationMs)} />
          )}
        </div>
      )}

      {/* 输入 */}
      {inputs && inputs.length > 0 && (
        <Section title="输入">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            {inputs.map((it, i) => (
              <React.Fragment key={i}>
                <dt className="truncate text-gray-500">{it.label}</dt>
                <dd className="font-mono truncate text-right text-gray-800">
                  {String(it.value)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </Section>
      )}

      {/* LLM 调用 */}
      {llmCalls && llmCalls.length > 0 && (
        <Section title="LLM 调用">
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <Table className="w-full text-[11px]">
              <THead className="bg-gray-50 text-gray-500">
                <Tr>
                  <Th className="whitespace-nowrap px-2 py-1 text-left font-medium">
                    模型
                  </Th>
                  <Th className="whitespace-nowrap px-2 py-1 text-right font-medium">
                    入
                  </Th>
                  <Th className="whitespace-nowrap px-2 py-1 text-right font-medium">
                    出
                  </Th>
                  <Th className="whitespace-nowrap px-2 py-1 text-right font-medium">
                    耗时
                  </Th>
                  <Th className="whitespace-nowrap px-2 py-1 text-right font-medium">
                    成本
                  </Th>
                </Tr>
              </THead>
              <TBody className="divide-y divide-gray-100">
                {llmCalls.map((c, i) => (
                  <Tr key={i}>
                    <Td className="font-mono px-2 py-1 text-gray-700">
                      {c.modelId ?? '—'}
                    </Td>
                    <Td className="font-mono px-2 py-1 text-right tabular-nums text-gray-700">
                      {fmtTokens(c.tokensIn)}
                    </Td>
                    <Td className="font-mono px-2 py-1 text-right tabular-nums text-gray-700">
                      {fmtTokens(c.tokensOut)}
                    </Td>
                    <Td className="font-mono px-2 py-1 text-right tabular-nums text-gray-700">
                      {fmtMs(c.durationMs)}
                    </Td>
                    <Td className="font-mono px-2 py-1 text-right tabular-nums text-gray-700">
                      {fmtUsd(c.costUsd)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </Section>
      )}

      {/* 输出概览 */}
      {outputPeek && Object.keys(outputPeek).length > 0 && (
        <Section title="输出概览">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            {Object.entries(outputPeek).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="truncate text-gray-500">{k}</dt>
                <dd className="font-mono text-right text-gray-800">
                  {String(v)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </Section>
      )}

      {/* ReAct timeline */}
      {reactTrace && reactTrace.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setTraceOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            {traceOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <span>ReAct 过程</span>
            <span className="text-[11px] text-gray-400">
              · {reactTrace.length} 条
            </span>
          </button>
          {traceOpen && (
            <ol className="mt-2 space-y-1.5 border-l border-gray-200 pl-3">
              {reactTrace.map((t, i) => (
                <li key={i} className="relative flex gap-2 text-[12px]">
                  <span
                    className={cn(
                      'absolute -left-[15px] top-1.5 h-2 w-2 rounded-full ring-2 ring-white',
                      KIND_DOT[t.kind]
                    )}
                  />
                  <span className="min-w-[40px] text-gray-400">
                    {KIND_LABEL[t.kind]}
                  </span>
                  <span className="flex-1">
                    {t.kind === 'thought' && (
                      <span className="italic text-gray-600">
                        {/* ★ 用 truthy 判断而非 ??：推理模型 thinking 常是空串(""),
                            ?? 只兜 null/undefined → 空串直接渲染成空白行（大量空）。 */}
                        {t.text && t.text.trim() ? t.text : '（无推理文本）'}
                      </span>
                    )}
                    {t.kind === 'action' &&
                      // Screenshot_62/63 修复：单 LLM stage（outline-planner / critic 等）
                      //   走 structured output 而非 tool_call，toolId 永远缺失。早先
                      //   显示"调用工具 —"误导用户。toolId 缺失时改显 LLM reasoning text。
                      (t.toolId ? (
                        <span className="text-gray-700">
                          调用工具{' '}
                          <code className="rounded bg-violet-50 px-1 text-violet-700">
                            {t.toolId}
                          </code>
                        </span>
                      ) : t.text ? (
                        <span className="text-gray-700">
                          <span className="rounded bg-violet-50 px-1 text-[10px] text-violet-700">
                            LLM 推理
                          </span>{' '}
                          <span className="italic text-gray-600">
                            {t.text.length > 240
                              ? t.text.slice(0, 240) + '…'
                              : t.text}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">
                          结构化输出（无 tool_call）
                        </span>
                      ))}
                    {t.kind === 'observation' && (
                      <span className="text-gray-700">
                        {t.toolId ? (
                          <>
                            返回{' '}
                            <code className="rounded bg-emerald-50 px-1 text-emerald-700">
                              {t.toolId}
                            </code>
                          </>
                        ) : (
                          // 同上：单 LLM stage 没 toolId，显示 output snippet 替代空"返回"
                          <>
                            <span className="rounded bg-emerald-50 px-1 text-[10px] text-emerald-700">
                              LLM 产出
                            </span>{' '}
                            {t.output ? (
                              <span className="text-gray-600">
                                {t.output.length > 240
                                  ? t.output.slice(0, 240) + '…'
                                  : t.output}
                              </span>
                            ) : (
                              <span className="text-[11px] text-gray-400">
                                完成
                              </span>
                            )}
                          </>
                        )}{' '}
                        {t.latencyMs != null && (
                          <span className="text-[10px] text-gray-400">
                            ({fmtMs(t.latencyMs)})
                          </span>
                        )}
                        {t.tokensUsed != null && (
                          <span className="text-[10px] text-gray-400">
                            {' · '}
                            {fmtTokens(t.tokensUsed)} tk
                          </span>
                        )}
                        {t.error && (
                          <span className="ml-1 text-red-600">⚠ {t.error}</span>
                        )}
                      </span>
                    )}
                    {t.kind === 'reflection' && (
                      <span className="text-amber-700">
                        {t.text && t.text.trim() ? t.text : '（无总结）'}
                      </span>
                    )}
                    {t.kind === 'error' && (
                      <span className="text-red-600">
                        {t.error && t.error.trim() ? t.error : '（错误未详）'}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </h5>
      {children}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-violet-50 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-violet-500">
        {label}
      </span>
      <span className="font-mono text-[11px] font-semibold text-violet-900">
        {value}
      </span>
    </div>
  );
}
