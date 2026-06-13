'use client';

import { useMemo, useState } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  Database,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  Search,
} from 'lucide-react';
import type {
  ArtifactFactTriple,
  ArtifactCitation,
} from '@/lib/features/agent-playground/report-artifact.types';

interface Props {
  factTable: ArtifactFactTriple[];
  citations: ArtifactCitation[];
  missionId?: string;
}

/** Phase P1-14: 事实表展示 + 冲突高亮 + 多源支撑可视化 */
export function FactTablePanel({ factTable, citations }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [showOnlyConflicts, setShowOnlyConflicts] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'sources' | 'conflict'>(
    'default'
  );
  const filtered = useMemo(() => {
    let arr = [...factTable];
    if (showOnlyConflicts) arr = arr.filter((f) => f.conflict);
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      arr = arr.filter(
        (f) =>
          f.entity.toLowerCase().includes(q) ||
          f.attribute.toLowerCase().includes(q) ||
          f.value.toLowerCase().includes(q)
      );
    }
    if (sortBy === 'sources') {
      arr.sort((a, b) => b.sources.length - a.sources.length);
    } else if (sortBy === 'conflict') {
      arr.sort((a, b) => (a.conflict ? -1 : 1) - (b.conflict ? -1 : 1));
    }
    return arr;
  }, [factTable, filter, showOnlyConflicts, sortBy]);
  if (factTable.length === 0) return null;
  const conflicts = factTable.filter((f) => f.conflict);
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          // P45-2: 关闭面板时清搜索状态
          if (open) {
            setFilter('');
            setShowOnlyConflicts(false);
          }
        }}
        className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100">
            <Database className="h-4 w-4 text-blue-600" />
          </span>
          <div>
            <p className="text-sm font-bold text-gray-900">
              事实表（{factTable.length}）
              {conflicts.length > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {conflicts.length} 项冲突
                </span>
              )}
            </p>
            <p className="text-[11px] text-gray-500">
              所有事实可追溯到原始引用，冲突已标注处理方式
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
        <div className="overflow-x-auto border-t border-gray-100 p-4">
          {/* Phase P35-4 + P88-1: 统计 + 平均可信度 */}
          {(() => {
            const allCreds = factTable.flatMap((f) =>
              f.sources
                .map((idx) => citations.find((c) => c.index === idx))
                .filter((c): c is NonNullable<typeof c> => Boolean(c))
                .map((c) => c.credibilityScore)
            );
            const avgCred =
              allCreds.length > 0
                ? Math.round(
                    allCreds.reduce((a, b) => a + b, 0) / allCreds.length
                  )
                : 0;
            return (
              <div className="mb-2 text-[11px] text-gray-500">
                共 {factTable.length} 条事实
                {factTable.filter((f) => f.sources.length >= 2).length > 0 &&
                  ` · ${factTable.filter((f) => f.sources.length >= 2).length} 条多源印证`}
                {factTable.filter((f) => f.conflict).length > 0 &&
                  ` · ${factTable.filter((f) => f.conflict).length} 条冲突`}
                {avgCred > 0 && (
                  <span
                    className={`ml-1 ${avgCred >= 80 ? 'text-emerald-600' : avgCred >= 60 ? 'text-amber-600' : 'text-red-600'}`}
                  >
                    · 平均来源可信度 {avgCred}/100
                  </span>
                )}
                {filtered.length !== factTable.length &&
                  ` · 已过滤至 ${filtered.length} 条`}
              </div>
            );
          })()}
          {/* ★ 2026-05-25：工具栏防挤压换行。窄抽屉里各控件原先无 shrink-0，
              文字被挤成竖排（"仅冲突"→仅/冲突、"复制"→复/制）。给搜索框设最小宽 +
              其余控件 shrink-0 + whitespace-nowrap；整行 flex-wrap，放不下时整块
              控件换到下一行而非把文字拆断。 */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[140px] flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
              <Search className="h-3 w-3 shrink-0 text-gray-400" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜实体 / 属性 / 值"
                className="w-full flex-1 bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-violet-300"
                aria-label="搜索事实表"
              />
            </div>
            <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-gray-700">
              <input
                type="checkbox"
                checked={showOnlyConflicts}
                onChange={(e) => setShowOnlyConflicts(e.target.checked)}
                className="h-3 w-3 rounded border-gray-300 text-violet-600"
              />
              仅冲突
            </label>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as 'default' | 'sources' | 'conflict')
              }
              className="shrink-0 rounded border border-gray-200 bg-white px-2 py-1 text-xs"
            >
              <option value="default">默认</option>
              <option value="sources">来源数</option>
              <option value="conflict">冲突优先</option>
            </select>
            {/* Phase P34-3: 一键复制全表 TSV */}
            <button
              type="button"
              onClick={() => {
                const tsv = filtered
                  .map(
                    (f) =>
                      `${f.entity}\t${f.attribute}\t${f.value}\t[${f.sources.join(',')}]`
                  )
                  .join('\n');
                void navigator.clipboard?.writeText(tsv);
              }}
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              title="复制为 TSV"
            >
              <Copy className="h-3 w-3 shrink-0" />
              复制
            </button>
          </div>
          {/* ★ 2026-05-25：table-fixed + 列宽百分比，让 5 列在窄抽屉(480px)内自适应
              填满而非把表撑宽出横向滚动；单元格用 TruncatedCell(w-full) 截断 + 悬浮看
              全文。这是 TruncatedCell 文档约定的 canonical 用法（w-full + 父 table-fixed）。 */}
          <Table className="w-full table-fixed text-xs">
            <THead className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wider text-gray-500">
              <Tr>
                <Th className="w-[22%] pb-2 pr-3">实体</Th>
                <Th className="w-[16%] pb-2 pr-3">属性</Th>
                <Th className="w-[30%] pb-2 pr-3">值</Th>
                {/* P111-1: 表头点击切换 sort */}
                <Th
                  className="w-[18%] cursor-pointer select-none pb-2 pr-3 hover:text-violet-600"
                  onClick={() =>
                    setSortBy(sortBy === 'sources' ? 'default' : 'sources')
                  }
                  title="点击按来源数排序"
                >
                  来源{sortBy === 'sources' && ' ▼'}
                </Th>
                <Th
                  className="w-[14%] cursor-pointer select-none pb-2 hover:text-violet-600"
                  onClick={() =>
                    setSortBy(sortBy === 'conflict' ? 'default' : 'conflict')
                  }
                  title="点击优先显示冲突"
                >
                  冲突{sortBy === 'conflict' && ' ▼'}
                </Th>
              </Tr>
            </THead>
            {filtered.length === 0 && (
              <TBody>
                <Tr>
                  <Td colSpan={5}>
                    <EmptyState size="sm" type="search" title="无匹配事实" />
                  </Td>
                </Tr>
              </TBody>
            )}
            <TBody>
              {filtered.map((f) => (
                <Tr
                  key={f.id}
                  className={`border-b border-gray-50 hover:bg-violet-50/30 ${
                    f.conflict?.resolutionType === 'flagged-unresolved'
                      ? 'bg-red-50/60'
                      : f.conflict?.resolutionType === 'kept-both'
                        ? 'bg-amber-50/50'
                        : f.conflict?.resolutionType === 'preferred-one'
                          ? 'bg-emerald-50/40'
                          : ''
                  }`}
                >
                  <Td className="py-1.5 pr-3 font-medium text-gray-900">
                    <TruncatedCell
                      className="w-full"
                      tooltip={`${f.id} · ${f.entity}`}
                    >
                      {f.entity}
                    </TruncatedCell>
                  </Td>
                  <Td className="py-1.5 pr-3 text-gray-700">
                    <TruncatedCell className="w-full">
                      {f.attribute}
                    </TruncatedCell>
                  </Td>
                  <Td className="py-1.5 pr-3 text-gray-700">
                    {/* Phase P39-2: 数字 / 百分比加粗 */}
                    <TruncatedCell className="w-full" tooltip={f.value}>
                      {/^[\d.,$%]+/.test(f.value) ? (
                        <span className="font-semibold text-gray-900">
                          {f.value}
                        </span>
                      ) : (
                        f.value
                      )}
                    </TruncatedCell>
                  </Td>
                  <Td className="py-1.5 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {f.sources.map((idx) => {
                        const c = citations.find((cc) => cc.index === idx);
                        const tooltip = c
                          ? `${c.title}\n${c.domain} · 可信度 ${c.credibilityScore}/100`
                          : `[${idx}]`;
                        return (
                          <a
                            key={idx}
                            href={c?.url ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80 ${
                              c && c.credibilityScore >= 80
                                ? 'bg-emerald-100 text-emerald-700'
                                : c && c.credibilityScore >= 60
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-violet-100 text-violet-700'
                            }`}
                            title={tooltip}
                          >
                            [{idx}]
                          </a>
                        );
                      })}
                    </div>
                  </Td>
                  <Td className="py-1.5">
                    {f.conflict && (
                      <span
                        className={`inline-block max-w-full cursor-help truncate rounded px-1.5 py-0.5 align-middle text-[10px] font-medium ${
                          f.conflict.resolutionType === 'preferred-one'
                            ? 'bg-emerald-100 text-emerald-700'
                            : f.conflict.resolutionType === 'kept-both'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                        title={`${f.conflict.resolutionType}\n\n${f.conflict.rationale}`}
                      >
                        {f.conflict.resolutionType === 'preferred-one'
                          ? '择一'
                          : f.conflict.resolutionType === 'kept-both'
                            ? '两存'
                            : '未决'}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </section>
  );
}
