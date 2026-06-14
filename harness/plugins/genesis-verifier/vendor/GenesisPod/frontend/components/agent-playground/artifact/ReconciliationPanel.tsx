'use client';

import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { GitMerge, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

/**
 * 清洗 reconciler 输出的 markdown：
 * - 去掉 `[N]` / `[N][M]` 引用编号（这里没有 CitationBadge 反链，留着是干扰）
 * - 折叠多余空白
 */
function cleanReconcilerMarkdown(md: string): string {
  return md
    .replace(/(?:\[\d+\])+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

interface ReconciliationReport {
  factTable?: unknown[];
  conflicts?: {
    factIds: string[];
    resolutionType: 'kept-both' | 'preferred-one' | 'flagged-unresolved';
    rationale: string;
  }[];
  overlaps?: {
    dimensionPair?: [string, string];
    similarityScore?: number;
    overlappingClaim?: string;
    resolutionAction?: string;
  }[];
  gaps?: {
    dimensionId?: string;
    expectedAspects?: string[];
    severity?: 'critical' | 'minor';
  }[];
  reconciliationReport?: string;
  figureCandidates?: unknown[];
  deduplicationStats?: {
    duplicatesRemoved?: number;
    termVariantsUnified?: number;
    dataInconsistenciesFlagged?: number;
  };
  termGlossary?: { canonical: string; variants: string[] }[];
}

interface Props {
  report: ReconciliationReport;
}

/**
 * Phase P3-20: 展示 Reconciler [3.5] 节点产物
 * 让用户看到 mission 中识别的事实冲突 / 重叠 / 空白如何被处理
 */
export function ReconciliationPanel({ report }: Props) {
  const [open, setOpen] = useState(false);
  const factCount = report.factTable?.length ?? 0;
  const conflictCount = report.conflicts?.length ?? 0;
  const overlapCount = report.overlaps?.length ?? 0;
  const gapCount = report.gaps?.length ?? 0;
  if (factCount + conflictCount + overlapCount + gapCount === 0) return null;
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100">
            <GitMerge className="h-4 w-4 text-purple-600" />
          </span>
          <div>
            <p className="text-sm font-bold text-gray-900">对账总览</p>
            <p className="text-[11px] text-gray-500">
              {factCount} 事实 · {conflictCount} 冲突 · {overlapCount} 重叠 ·{' '}
              {gapCount} 空白
            </p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-100 p-4">
          {report.deduplicationStats && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-2 text-center">
                <p className="text-[10px] text-gray-500">去重</p>
                <p className="text-base font-bold text-purple-700">
                  {report.deduplicationStats.duplicatesRemoved ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-2 text-center">
                <p className="text-[10px] text-gray-500">术语统一</p>
                <p className="text-base font-bold text-purple-700">
                  {report.deduplicationStats.termVariantsUnified ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-2 text-center">
                <p className="text-[10px] text-gray-500">数据冲突</p>
                <p className="text-base font-bold text-purple-700">
                  {report.deduplicationStats.dataInconsistenciesFlagged ?? 0}
                </p>
              </div>
            </div>
          )}
          {report.reconciliationReport && (
            <ReconcilerMarkdownBlock raw={report.reconciliationReport} />
          )}
          {report.conflicts && report.conflicts.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
                <AlertTriangle className="h-3 w-3" />
                事实冲突（{report.conflicts.length}）
              </p>
              <ul className="space-y-1">
                {report.conflicts.map((c, i) => (
                  <li
                    key={i}
                    className="rounded border border-amber-100 bg-amber-50 p-2 text-[11px] text-amber-700"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        c.resolutionType === 'preferred-one'
                          ? 'bg-emerald-100 text-emerald-700'
                          : c.resolutionType === 'kept-both'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {c.resolutionType}
                    </span>
                    <span className="ml-2">
                      factIds: {c.factIds.join(', ')}
                    </span>
                    <p className="mt-0.5">{c.rationale}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Phase P82-1: 术语对照表 */}
          {report.termGlossary && report.termGlossary.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-blue-700">
                术语对照表（{report.termGlossary.length}）
              </p>
              <ul className="space-y-1">
                {report.termGlossary.map((g, i) => (
                  <li
                    key={i}
                    className="rounded border border-blue-100 bg-blue-50 p-2 text-[11px] text-blue-700"
                  >
                    <span className="font-semibold">{g.canonical}</span>
                    <span className="ml-2 text-gray-500">
                      ↔ {g.variants.join(' / ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Phase P40-1: gaps */}
          {report.gaps && report.gaps.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-orange-700">
                覆盖空白（{report.gaps.length}）
              </p>
              <ul className="space-y-1">
                {report.gaps.map((g, i) => (
                  <li
                    key={i}
                    className="rounded border border-orange-100 bg-orange-50 p-2 text-[11px] text-orange-700"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        g.severity === 'critical'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {g.severity ?? 'minor'}
                    </span>
                    {g.dimensionId && (
                      <span className="ml-2">dim: {g.dimensionId}</span>
                    )}
                    {g.expectedAspects && g.expectedAspects.length > 0 && (
                      <p className="mt-0.5">
                        缺失: {g.expectedAspects.join(' / ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Reconciler 总览 markdown 块：
 * 用 ReactMarkdown + remarkGfm 把 `**`/`-`/列表/表格按真实 markdown 渲染，
 * 取代之前 `<pre>` 直吐源码（Screenshot_11.png 的"格式不对"根因）。
 */
function ReconcilerMarkdownBlock({ raw }: { raw: string }) {
  const cleaned = useMemo(() => cleanReconcilerMarkdown(raw), [raw]);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-700">
        Reconciler 总览
      </p>
      <article className="prose prose-sm prose-gray prose-headings:text-gray-800 prose-p:my-1.5 prose-li:my-0.5 prose-strong:text-gray-900 max-w-none rounded bg-gray-50 p-3 text-[12px] leading-6 text-gray-700">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize]}
        >
          {cleaned}
        </ReactMarkdown>
      </article>
    </div>
  );
}
