'use client';

import { useMemo } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sparkles,
  TrendingUp,
  AlertCircle,
  Lightbulb,
  Clock,
  ExternalLink,
  Target,
  Compass,
  Radar,
} from 'lucide-react';
import type { ReportArtifact } from '@/lib/features/agent-playground/report-artifact.types';

/**
 * 清洗快速视图纯文本字段（按 TI cleanQuickViewText）：
 * 移除 [N] 引用 / 字数计数 / markdown 加粗符号 等噪声。
 */
function cleanText(text: string): string {
  if (!text) return text;
  let cleaned = text;
  cleaned = cleaned.replace(/(?:\[\d+\])+/g, ''); // [N] / [N][M]
  cleaned = cleaned.replace(/[（(][^）)]*约?\d+字[）)]/g, ''); // (约 N 字)
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1'); // bold
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1'); // italic
  cleaned = cleaned.replace(/^[-*]\s+/gm, ''); // bullets
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  return cleaned.trim();
}

/** 保留 markdown 结构（执行摘要专用），仅清 [N] / 字数 */
function stripCitationsAndWordCount(text: string): string {
  if (!text) return text;
  return text
    .replace(/(?:\[\d+\])+/g, '')
    .replace(/[（(][^）)]*约?\d+字[）)]/g, '')
    .replace(/ {2,}/g, ' ');
}

interface Props {
  artifact: ReportArtifact;
  onSwitchToFull?: () => void;
}

const DIRECTION_LABEL: Record<string, string> = {
  increasing: '↑',
  decreasing: '↓',
  stable: '→',
  emerging: '✦',
};

// ★ Foresight L1：前瞻判断的展示标签
const CONFIDENCE_LABEL: Record<string, string> = {
  low: '置信度低',
  moderate: '置信度中',
  high: '置信度高',
};
const HORIZON_LABEL: Record<string, string> = {
  '0-6m': '0-6 个月',
  '6-18m': '6-18 个月',
  '18m-3y': '18 个月-3 年',
  '3y+': '3 年以上',
};
const SCENARIO_META: Record<
  string,
  { label: string; tone: string; bar: string }
> = {
  bull: {
    label: '乐观',
    tone: 'border-emerald-200 bg-emerald-50/50 text-emerald-700',
    bar: 'bg-emerald-500',
  },
  base: {
    label: '基准',
    tone: 'border-blue-200 bg-blue-50/50 text-blue-700',
    bar: 'bg-blue-500',
  },
  bear: {
    label: '悲观',
    tone: 'border-rose-200 bg-rose-50/50 text-rose-700',
    bar: 'bg-rose-500',
  },
};

/**
 * ★ 2026-05-09 PR-quickview-parity：完整复刻 Topic Insight QuickViewReport 数据结构。
 *
 * 数据来源（全部从 artifact.quickView，由 backend StructuralReportAssembler 派生）：
 *   - executiveSummary.markdown          → 执行摘要
 *   - keyFindingsByDimension[]           → 维度核心发现（结构化，含 significance）
 *   - topTrends[]                        → 关键趋势（带 direction / timeframe）
 *   - riskMatrix[]                       → 风险矩阵表格（TI 同款 prob / impact / timeframe）
 *   - recommendationsByAudience          → 战略建议按 forEnterprise / forInvestors 分组
 *   - whatYouWillLearn[]                 → 头部"读完你将了解"
 *   - keyCitations + citations           → 重点引用
 *
 * v1 → v2 删除：「关键图表」section（用户决定快速视图不展示图）。
 * 兼容：keyFigures 字段保留在 dto，但前端不再 render。
 */
export function QuickReader({ artifact, onSwitchToFull }: Props) {
  const qv = artifact.quickView;

  // 维度核心发现：优先用 backend 派生的结构化 keyFindingsByDimension；
  // 缺失时回退到 topHighlights 按 sourceDimensionId 分组（兼容存量数据）。
  const dimensionFindings = useMemo(() => {
    if (qv.keyFindingsByDimension && qv.keyFindingsByDimension.length > 0) {
      return qv.keyFindingsByDimension.map((g) => ({
        dimId: g.dimensionId ?? g.dimensionName,
        dimName: g.dimensionName,
        items: g.findings.slice(0, 3),
      }));
    }
    // legacy fallback: 从 topHighlights 派生
    const map = new Map<
      string,
      {
        dimId: string;
        dimName: string;
        // ★ 2026-05-27 (#108): body 字段加进 legacy fallback shape, 与主 path 类型对齐。
        items: {
          finding: string;
          body?: string;
          significance: 'high' | 'medium' | 'low';
        }[];
      }
    >();
    for (const h of qv.topHighlights) {
      if (h.type !== 'finding' && h.type !== 'trend') continue;
      const dimId = h.sourceDimensionId;
      const dimSec = artifact.sections.find(
        (s) => s.sourceDimensionId === dimId
      );
      const dimName = dimSec?.title ?? dimId ?? '未分类';
      if (!map.has(dimId)) {
        map.set(dimId, { dimId, dimName, items: [] });
      }
      map.get(dimId)!.items.push({
        finding: h.title,
        significance: 'medium',
      });
    }
    return Array.from(map.values()).map((g) => ({
      ...g,
      items: g.items.slice(0, 3),
    }));
  }, [qv.keyFindingsByDimension, qv.topHighlights, artifact.sections]);

  const keyCites = qv.keyCitations
    .map((idx) => artifact.citations.find((c) => c.index === idx))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <div className="space-y-4">
      {/* Critic 复审标记（保留原行为） */}
      {artifact.quality.hardGateViolations.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>
              Critic 复审标记 {artifact.quality.hardGateViolations.length} 项
            </span>
          </div>
          <ul className="space-y-1 pl-4">
            {artifact.quality.hardGateViolations.slice(0, 3).map((v, i) => {
              const tag =
                v.dimension === 'l4-critic' || v.dimension === 'l4-fail'
                  ? '总体评判'
                  : v.dimension === 'l4-blindspot'
                    ? '盲点'
                    : v.dimension === 'l4-bias'
                      ? '偏见'
                      : v.dimension === 'l4-suggestion'
                        ? '建议'
                        : v.dimension;
              return (
                <li key={i} className="leading-snug">
                  <span className="mr-2 inline-block min-w-[3em] rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
                    {tag}
                  </span>
                  <span>{v.message}</span>
                </li>
              );
            })}
            {artifact.quality.hardGateViolations.length > 3 && (
              <li className="text-red-600/70">
                …还有 {artifact.quality.hardGateViolations.length - 3} 项见
                「质量评分」详情
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 标题 + 阅读时长 */}
      <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 to-purple-50 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">
              快速阅读
            </p>
            <h2 className="mt-1 text-lg font-bold text-gray-900">
              {artifact.metadata.topic}
            </h2>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
              <Clock className="h-3 w-3" />约 {qv.estimatedReadingTime} 分钟读完
              · {artifact.metadata.dimensionCount} 维度 ·{' '}
              {artifact.metadata.sourceCount} 条引用 ·{' '}
              <span
                className={
                  artifact.quality.overall >= 80
                    ? 'text-emerald-600'
                    : artifact.quality.overall >= 60
                      ? 'text-amber-600'
                      : 'text-red-600'
                }
              >
                质量 {artifact.quality.overall}/100
              </span>
            </p>
          </div>
          {onSwitchToFull && (
            <button
              type="button"
              onClick={onSwitchToFull}
              className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"
            >
              阅读全文
            </button>
          )}
        </div>
        {qv.whatYouWillLearn.length > 0 && (
          <div className="mt-3 grid gap-1.5 text-xs text-gray-700">
            {qv.whatYouWillLearn.map((it, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
                <span>{cleanText(it)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 执行摘要（ReactMarkdown 渲染，参考 TI QuickViewReport） */}
      {qv.executiveSummary.markdown && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <Sparkles className="h-4 w-4 text-violet-500" />
            执行摘要
          </h3>
          <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-5">
            <article className="prose prose-sm prose-gray prose-strong:text-violet-700 max-w-none leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {stripCitationsAndWordCount(qv.executiveSummary.markdown)}
              </ReactMarkdown>
            </article>
          </div>
        </section>
      )}

      {/* 维度核心发现（结构化 keyFindingsByDimension，含 significance 高/中/低） */}
      {/*
        ★ 2026-05-27 (Screenshot_11/12)：原 list 渲染太瘦，单条 finding 是 80-200
        字段落（参照 AI 洞察 reference 的丰富度），每条独立成段、左侧 significance
        色条 + 字号收口，避免拥挤。
      */}
      {dimensionFindings.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <Target className="h-4 w-4 text-blue-500" />
            维度核心发现
          </h3>
          <div className="space-y-3">
            {dimensionFindings.map((dim) => (
              <div
                key={dim.dimId}
                className="rounded-xl border border-gray-100 bg-white p-4"
              >
                <h4 className="mb-3 text-base font-bold text-gray-800">
                  {dim.dimName}
                </h4>
                <div className="space-y-2.5">
                  {dim.items.map((f, idx) => {
                    const tone =
                      f.significance === 'high'
                        ? 'border-red-300 bg-red-50/40'
                        : f.significance === 'medium'
                          ? 'border-amber-300 bg-amber-50/40'
                          : 'border-green-300 bg-green-50/40';
                    // ★ 2026-05-27 (#108): finding 标题 + body 解释段双层渲染,
                    //   参照 Topic Insight 快速视图。body optional, 缺时降级为单标题展示。
                    const body =
                      typeof (f as { body?: string }).body === 'string'
                        ? (f as { body?: string }).body
                        : undefined;
                    return (
                      <div
                        key={idx}
                        className={`rounded-md border-l-4 px-3 py-2 text-sm leading-relaxed text-gray-700 ${tone}`}
                      >
                        <div className="font-medium text-gray-800">
                          {cleanText(f.finding)}
                        </div>
                        {body && (
                          <p className="mt-1 text-xs leading-relaxed text-gray-600">
                            {cleanText(body)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 关键趋势（带方向 + 时间窗口） */}
      {qv.topTrends.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            关键趋势
          </h3>
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="space-y-2">
              {qv.topTrends.map((t, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 w-5 flex-shrink-0 text-center text-base">
                    {t.direction ? DIRECTION_LABEL[t.direction] : '→'}
                  </span>
                  <div className="leading-relaxed">
                    <span className="font-medium text-gray-800">
                      {cleanText(t.description || t.title)}
                    </span>
                    {t.timeframe && (
                      <span className="ml-1.5 text-xs text-gray-400">
                        · {t.timeframe}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 风险评估表（结构化 riskMatrix —— TI 同款 prob × impact × timeframe） */}
      {qv.riskMatrix && qv.riskMatrix.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <AlertCircle className="h-4 w-4 text-red-500" />
            风险评估
          </h3>
          <div className="overflow-x-auto rounded-xl border border-red-100">
            <Table className="w-full text-sm">
              <THead className="bg-red-50">
                <Tr>
                  <Th className="px-3 py-1.5 text-left font-medium text-red-700">
                    风险类型
                  </Th>
                  <Th className="px-3 py-1.5 text-center font-medium text-red-700">
                    概率
                  </Th>
                  <Th className="px-3 py-1.5 text-center font-medium text-red-700">
                    影响
                  </Th>
                  <Th className="px-3 py-1.5 text-center font-medium text-red-700">
                    时间窗口
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {qv.riskMatrix.map((risk, idx) => {
                  const probColor =
                    risk.probability === '高'
                      ? 'bg-red-100 text-red-700'
                      : risk.probability === '中'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-green-100 text-green-700';
                  const impactColor =
                    risk.impact === '高'
                      ? 'bg-red-100 text-red-700'
                      : risk.impact === '中'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-green-100 text-green-700';
                  return (
                    <Tr key={idx} className="border-t border-red-50">
                      <Td className="px-3 py-1.5 text-gray-700">
                        {risk.riskType}
                      </Td>
                      <Td className="px-3 py-1.5 text-center">
                        <span
                          className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${probColor}`}
                        >
                          {risk.probability}
                        </span>
                      </Td>
                      <Td className="px-3 py-1.5 text-center">
                        <span
                          className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${impactColor}`}
                        >
                          {risk.impact}
                        </span>
                      </Td>
                      <Td className="px-3 py-1.5 text-center text-gray-500">
                        {risk.timeframe}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </div>
        </section>
      )}

      {/* 未来推演（Foresight：基准判断 + 情景 + 早期信号） */}
      {qv.foresight && qv.foresight.baseCase.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center justify-between gap-1.5 text-sm font-bold text-gray-900">
            <span className="flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-indigo-500" />
              未来推演
            </span>
            {typeof qv.foresight.robustness === 'number' && (
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  qv.foresight.robustness >= 70
                    ? 'bg-emerald-100 text-emerald-700'
                    : qv.foresight.robustness >= 50
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-rose-100 text-rose-700'
                }`}
                title="Forecast 红队评定的前瞻判断韧性"
              >
                前瞻韧性 {qv.foresight.robustness}/100
              </span>
            )}
          </h3>
          <div className="space-y-3">
            {/* 基准判断：概率条 + 置信度 + 时间窗 + 裁决标准 */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
              <h4 className="mb-3 text-sm font-bold text-indigo-700">
                基准判断
              </h4>
              <div className="space-y-3">
                {qv.foresight.baseCase.map((b, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-gray-100 bg-gray-50/60 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium leading-relaxed text-gray-800">
                        {cleanText(b.judgment)}
                      </p>
                      <span className="flex-shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-700">
                        {Math.round(b.probability * 100)}%
                      </span>
                    </div>
                    {/* 概率条 */}
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{
                          width: `${Math.round(b.probability * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-600">
                        {CONFIDENCE_LABEL[b.confidence] ?? b.confidence}
                      </span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">
                        {HORIZON_LABEL[b.horizon] ?? b.horizon}
                      </span>
                    </div>
                    {b.baseRate && (
                      <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                        历史基准率：{cleanText(b.baseRate)}
                      </p>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">
                      裁决标准：{cleanText(b.resolutionCriteria)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* 情景分析：bull / base / bear */}
            {qv.foresight.scenarios.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {qv.foresight.scenarios.map((s, idx) => {
                  const meta = SCENARIO_META[s.kind] ?? SCENARIO_META.base;
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border p-3 ${meta.tone}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">{meta.label}</span>
                        <span className="text-xs font-bold">
                          {Math.round(s.probability * 100)}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/70">
                        <div
                          className={`h-full rounded-full ${meta.bar}`}
                          style={{
                            width: `${Math.round(s.probability * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-gray-700">
                        {cleanText(s.narrative)}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                        触发：{cleanText(s.trigger)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 预定元素 vs 关键不确定性 */}
            {(qv.foresight.predeterminedElements.length > 0 ||
              qv.foresight.criticalUncertainties.length > 0) && (
              <div className="grid gap-2 sm:grid-cols-2">
                {qv.foresight.predeterminedElements.length > 0 && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                    <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                      几乎确定
                    </h4>
                    <ul className="space-y-1">
                      {qv.foresight.predeterminedElements.map((e, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-1.5 text-sm leading-relaxed text-gray-600"
                        >
                          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-emerald-500" />
                          <span>{cleanText(e)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {qv.foresight.criticalUncertainties.length > 0 && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                    <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                      关键不确定性
                    </h4>
                    <ul className="space-y-1">
                      {qv.foresight.criticalUncertainties.map((u, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-1.5 text-sm leading-relaxed text-gray-600"
                        >
                          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-amber-500" />
                          <span>{cleanText(u)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* 值得跟踪的早期信号 */}
            {qv.foresight.leadingIndicators.length > 0 && (
              <div className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <Radar className="h-3.5 w-3.5 text-indigo-400" />
                  值得跟踪的早期信号
                </h4>
                <ul className="space-y-1.5">
                  {qv.foresight.leadingIndicators.map((ind, i) => (
                    <li
                      key={i}
                      className="text-sm leading-relaxed text-gray-700"
                    >
                      <span className="font-medium text-gray-800">
                        {cleanText(ind.signal)}
                      </span>
                      <span className="text-gray-500">
                        {' '}
                        —— {cleanText(ind.watchFor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 判断可能错在哪（Forecast 红队回灌的反指标） */}
            {qv.foresight.couldBeWrongIf &&
              qv.foresight.couldBeWrongIf.length > 0 && (
                <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3">
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-500">
                    <AlertCircle className="h-3.5 w-3.5" />
                    判断可能错在哪
                  </h4>
                  <ul className="space-y-1">
                    {qv.foresight.couldBeWrongIf.map((c, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-sm leading-relaxed text-gray-600"
                      >
                        <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-rose-400" />
                        <span>{cleanText(c)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        </section>
      )}

      {/* 战略建议（按受众分组 forEnterprise / forInvestors × shortTerm / midTerm） */}
      {qv.recommendationsByAudience &&
        (qv.recommendationsByAudience.forEnterprise ||
          qv.recommendationsByAudience.forInvestors) && (
          <section>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              战略建议
            </h3>
            <div className="space-y-2.5">
              {qv.recommendationsByAudience.forEnterprise && (
                <div className="rounded-xl border border-gray-100 bg-white p-3">
                  <h4 className="mb-2 text-sm font-bold text-indigo-700">
                    对企业决策者
                  </h4>
                  {qv.recommendationsByAudience.forEnterprise.shortTerm.length >
                    0 && (
                    <div className="mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        短期 (6-12月)
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {qv.recommendationsByAudience.forEnterprise.shortTerm.map(
                          (s, i) => (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-gray-600"
                            >
                              {cleanText(s)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                  {qv.recommendationsByAudience.forEnterprise.midTerm.length >
                    0 && (
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        中期 (1-3年)
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {qv.recommendationsByAudience.forEnterprise.midTerm.map(
                          (s, i) => (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-gray-600"
                            >
                              {cleanText(s)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {qv.recommendationsByAudience.forInvestors && (
                <div className="rounded-xl border border-gray-100 bg-white p-3">
                  <h4 className="mb-2 text-sm font-bold text-emerald-700">
                    对投资者
                  </h4>
                  {qv.recommendationsByAudience.forInvestors.shortTerm.length >
                    0 && (
                    <div className="mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        短期 (6-12月)
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {qv.recommendationsByAudience.forInvestors.shortTerm.map(
                          (s, i) => (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-gray-600"
                            >
                              {cleanText(s)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                  {qv.recommendationsByAudience.forInvestors.midTerm.length >
                    0 && (
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        中期 (1-3年)
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {qv.recommendationsByAudience.forInvestors.midTerm.map(
                          (s, i) => (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-gray-600"
                            >
                              {cleanText(s)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

      {/* Top Citations */}
      {keyCites.length > 0 && (
        <section>
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-gray-900">
            <ExternalLink className="h-4 w-4 text-violet-500" />
            重点引用
          </h3>
          <ol className="space-y-2 rounded-xl border border-gray-100 bg-white p-4 text-sm">
            {keyCites.map((c) => (
              <li
                key={c.index}
                className="flex items-start gap-2 text-gray-700"
              >
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                  [{c.index}]
                </span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-1 text-violet-700 hover:underline"
                >
                  {c.title}
                </a>
                <span className="ml-auto text-[11px] text-gray-500">
                  {c.credibilityScore}/100
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
