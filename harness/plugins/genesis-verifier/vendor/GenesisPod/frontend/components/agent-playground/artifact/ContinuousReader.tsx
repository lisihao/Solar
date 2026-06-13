'use client';

import { useState, useEffect, useMemo } from 'react';
import type {
  ArtifactCitation,
  ReportArtifact,
} from '@/lib/features/agent-playground/report-artifact.types';
import { ArtifactMarkdown } from './ArtifactMarkdown';
import { ReferencePanel } from './ReferencePanel';
import { AlertTriangle } from 'lucide-react';

interface Props {
  artifact: ReportArtifact;
}

/**
 * ★ 2026-05-06 #87: 剥除末尾 "## 参考文献" / "## References" 段，避免与
 *   下方独立的 ReferencePanel 重复显示（两份参考文献）。
 *   后端 report-artifact-assembler.service.ts:195 追加 references section
 *   到 fullMarkdown 是为了导出 markdown 完整性；前端 reader 由 ReferencePanel
 *   接管参考文献渲染（含引用次数、来源类型、反向溯源），不需要 markdown 里的版本。
 */
function stripTrailingReferences(md: string): string {
  return md.replace(/\n+##\s*(参考文献|参考资料|References)[\s\S]*$/m, '\n');
}

/** 连续视图：整篇 markdown 一篇到底（对齐 TI preview 模式，无左 TOC） */
export function ContinuousReader({ artifact }: Props) {
  const [highlightedCite] = useState<number | null>(null);
  const [reverseHighlight, setReverseHighlight] = useState<number | null>(null);
  // ★ 2026-05-06 #87: 剥除 fullMarkdown 末尾参考文献段，由 ReferencePanel 独立渲染
  const bodyMarkdown = useMemo(
    () => stripTrailingReferences(artifact.content.fullMarkdown),
    [artifact.content.fullMarkdown]
  );

  // ★ 2026-05-07：从 sections 反查"真维度名"列表，传给 ArtifactMarkdown 让
  //   renumberHeadings fuzzy match 区分"## N. 维度名"（保编号）和"## N. 章节名"
  //   （老 reportAssembler 把章节误写成 H2 全局累加，需降为 H3 + N.M.）。
  const dimNames = useMemo(
    () =>
      artifact.sections
        .filter((s) => s.type === 'dimension')
        .map((s) => s.title),
    [artifact.sections]
  );

  // ★ Phase P1-12: 反向溯源 — 点击 ReferencePanel 引用条目 → 高亮文中所有位置
  const handleReverseHighlight = (citation: ArtifactCitation) => {
    setReverseHighlight(citation.index);
    setTimeout(() => setReverseHighlight(null), 4000);
    // 滚到第一个出现位置
    const firstSup = document.querySelector(
      `sup[data-cite="${citation.index}"]`
    );
    firstSup?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // 使用 effect 给文中所有 [N] 加临时高亮 class
  useEffect(() => {
    if (reverseHighlight == null) return;
    const sups = document.querySelectorAll(
      `sup[data-cite="${reverseHighlight}"]`
    );
    sups.forEach((el) =>
      el.classList.add('ring-2', 'ring-blue-400', 'rounded-md', 'bg-blue-200')
    );
    return () => {
      sups.forEach((el) =>
        el.classList.remove(
          'ring-2',
          'ring-blue-400',
          'rounded-md',
          'bg-blue-200'
        )
      );
    };
  }, [reverseHighlight]);

  return (
    <div data-export-content="playground-report">
      {/* 主体：连续 markdown（去掉左侧 TOC，对齐 TI ChapterizedReportView preview 模式） */}
      <main className="min-w-0">
        {/* ★ 2026-05-02 Screenshot 56: 原 single-line concat 拼接 dimension+message 在
            多 violation 时变成 raw 字符串堆，用户看不懂。改为结构化 bullet 列表 +
            friendly 类型标签（l4-critic→总体评判 / l4-blindspot→盲点 / l4-bias→偏见
            / l4-suggestion→建议）。 */}
        {artifact.quality.hardGateViolations.length > 0 && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                Critic 复审标记 {artifact.quality.hardGateViolations.length} 项
                {artifact.quality.hardGateViolations.some(
                  (v) => v.severity === 'error'
                )
                  ? '严重违规'
                  : '需关注事项'}
              </span>
            </div>
            <ul className="space-y-1 pl-4">
              {artifact.quality.hardGateViolations.slice(0, 5).map((v, i) => {
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
              {artifact.quality.hardGateViolations.length > 5 && (
                <li className="text-red-600/70">
                  …还有 {artifact.quality.hardGateViolations.length - 5} 项见
                  「质量评分」详情
                </li>
              )}
            </ul>
          </div>
        )}
        {/* TI 同款极简包裹：bg-white + p-6，无 card shadow，让 prose 自己掌握排版 */}
        <div className="bg-white p-6">
          <ArtifactMarkdown
            markdown={bodyMarkdown}
            citations={artifact.citations}
            figures={artifact.figures}
            dimNames={dimNames}
          />
        </div>
        <ReferencePanel
          citations={artifact.citations}
          highlightedIndex={highlightedCite}
          onClickReverseHighlight={handleReverseHighlight}
        />
      </main>
    </div>
  );
}
