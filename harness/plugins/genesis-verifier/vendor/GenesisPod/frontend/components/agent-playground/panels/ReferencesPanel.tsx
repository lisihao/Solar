'use client';

/**
 * ReferencesPanel —— 参考文献（对标 Topic Insights，叠加多维分组）
 *
 * 在 TI 单一域名分组的基础上叠加：
 *   - 类型分组（gov / academic / industry / news / blog / community / other）
 *   - 时效分组（按发布年份）
 *   - 权威度分组（高 / 中 / 低，按 credibilityScore）
 *   - 域名分组（兼容 TI）
 *
 * 当 ReportArtifact 提供结构化 citations 时，渲染富信息条目（title + snippet + 类型 + 时间 + 评分）；
 * 否则降级到 URL 列表（裸 sources）。
 *
 * 全程使用 playground-ui primitives。
 */

import React, { useMemo, useState } from 'react';
import {
  Layers,
  Globe,
  Calendar,
  ShieldCheck,
  ListTree,
  ExternalLink,
  Building2,
  GraduationCap,
  Newspaper,
  Megaphone,
  Users,
  Star,
  Search,
  X as XIcon,
  ArrowUpDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { EmptyState } from '@/components/ui/states/EmptyState';
import type { ArtifactCitation } from '@/lib/features/agent-playground/report-artifact.types';
import { Card } from '@/components/agent-playground/ui';

interface Props {
  /** 结构化 citations（来自 ReportArtifact） —— 优先用 */
  citations?: readonly ArtifactCitation[];
  /** 裸 URL fallback —— 仅 citations 缺失时使用 */
  fallbackSources?: readonly string[];
}

type GroupKey = 'type' | 'year' | 'credibility' | 'domain';
type SortKey =
  | 'index'
  | 'credibility-desc'
  | 'credibility-asc'
  | 'date-desc'
  | 'date-asc'
  | 'occurrences-desc'
  | 'domain-asc';
type SourceTypeFilter = ArtifactCitation['sourceType'] | 'all';
type CredibilityFilter = 'all' | 'high' | 'medium' | 'low';
type TimeFilter = 'all' | '7d' | '30d' | '180d' | '365d' | 'older' | 'undated';

const SOURCE_TYPE_META: Record<
  ArtifactCitation['sourceType'],
  { label: string; Icon: LucideIcon; tone: string }
> = {
  gov: {
    label: '官方 / 政府',
    Icon: Building2,
    tone: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  academic: {
    label: '学术 / 论文',
    Icon: GraduationCap,
    tone: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  industry: {
    label: '行业 / 智库',
    Icon: Megaphone,
    tone: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  news: {
    label: '新闻媒体',
    Icon: Newspaper,
    tone: 'bg-blue-50 text-blue-700 ring-blue-200',
  },
  blog: {
    label: '博客 / 个人',
    Icon: Users,
    tone: 'bg-gray-50 text-gray-700 ring-gray-200',
  },
  community: {
    label: '社区 / 论坛',
    Icon: Users,
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  other: {
    label: '其它',
    Icon: Globe,
    tone: 'bg-gray-50 text-gray-600 ring-gray-200',
  },
};

/**
 * Backend 输出 0-100 整数 scale (gov=95, arxiv=92, default=65, blog=50)
 * 阈值与 TI ReferencePanel 对齐：≥70 高 / ≥40 中 / <40 低
 */
function credibilityBucket(score: number): {
  key: 'high' | 'medium' | 'low';
  label: string;
  tone: string;
} {
  if (score >= 70)
    return {
      key: 'high',
      label: '高权威 (≥ 70)',
      tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    };
  if (score >= 40)
    return {
      key: 'medium',
      label: '中权威 (40 ~ 70)',
      tone: 'bg-amber-50 text-amber-700 ring-amber-200',
    };
  return {
    key: 'low',
    label: '低权威 (< 40)',
    tone: 'bg-rose-50 text-rose-700 ring-rose-200',
  };
}

function yearOf(c: ArtifactCitation): string {
  if (!c.publishedAt) return '未标注年份';
  const m = c.publishedAt.match(/^(\d{4})/);
  return m ? m[1] : '未标注年份';
}

// ─── Citation 卡片 ─────────────────────────────────
function CitationCard({ c }: { c: ArtifactCitation }) {
  const meta = SOURCE_TYPE_META[c.sourceType] ?? SOURCE_TYPE_META.other;
  const Icon = meta.Icon;
  const safeUrl = /^https?:\/\//i.test(c.url) ? c.url : null;
  const cred = credibilityBucket(c.credibilityScore);
  const occ = c.occurrences?.length ?? 0;
  return (
    <li
      // ★ 锚点 id 用 index（数字），与公共 CitationBadge.scrollToRef 的 selector 对齐
      //   data-cite-uuid 仍保留供 page.tsx 的 setCitationClickCallback 跨面板跳转回查
      id={`ref-${c.index}`}
      data-cite-uuid={c.uuid}
      className="scroll-mt-4 rounded-md border border-gray-200 bg-white px-3 py-2 transition-all hover:border-violet-200 hover:bg-violet-50/30"
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1',
            meta.tone
          )}
          title={meta.label}
        >
          <Icon className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono inline-block flex-shrink-0 text-[10px] font-bold text-violet-700">
              [{c.index}]
            </span>
            <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-gray-900">
              {c.title || c.url}
            </p>
          </div>
          {c.snippet && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-600">
              {c.snippet}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ring-1',
                meta.tone
              )}
            >
              {meta.label}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 ring-1',
                cred.tone
              )}
            >
              <Star className="h-2.5 w-2.5" />
              {Math.round(c.credibilityScore)}
            </span>
            <span className="font-mono text-gray-500">{c.domain}</span>
            {c.publishedAt && (
              <span className="font-mono text-gray-500">
                <Calendar className="mr-0.5 inline-block h-2.5 w-2.5" />
                {c.publishedAt}
              </span>
            )}
            {occ > 0 && <span className="text-gray-500">引用 {occ} 处</span>}
            {safeUrl && (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-0.5 text-violet-600 hover:text-violet-700"
                title={safeUrl}
              >
                打开 <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ─── 分组 helpers ───────────────────────────────────
function groupCitations(
  citations: readonly ArtifactCitation[],
  groupBy: GroupKey
): { label: string; tone?: string; items: ArtifactCitation[] }[] {
  const map = new Map<string, ArtifactCitation[]>();
  for (const c of citations) {
    let key: string;
    if (groupBy === 'type') {
      key = SOURCE_TYPE_META[c.sourceType]?.label ?? '其它';
    } else if (groupBy === 'year') {
      key = yearOf(c);
    } else if (groupBy === 'credibility') {
      key = credibilityBucket(c.credibilityScore).label;
    } else {
      key = c.domain || '(no domain)';
    }
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

// ─── Group Header chip ──────────────────────────────
function GroupTabs({
  active,
  onChange,
}: {
  active: GroupKey;
  onChange: (k: GroupKey) => void;
}) {
  const tabs: { key: GroupKey; label: string; Icon: LucideIcon }[] = [
    { key: 'type', label: '按类型', Icon: ListTree },
    { key: 'credibility', label: '按权威度', Icon: ShieldCheck },
    { key: 'year', label: '按年份', Icon: Calendar },
    { key: 'domain', label: '按域名', Icon: Globe },
  ];
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-[11px]">
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors',
              isActive
                ? 'bg-white text-violet-700 shadow-sm ring-1 ring-violet-200'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            <t.Icon className="h-3 w-3" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── 总览 stat row ──────────────────────────────────
function StatRow({ citations }: { citations: readonly ArtifactCitation[] }) {
  const byType: Record<string, number> = {};
  let highCred = 0;
  let withDate = 0;
  for (const c of citations) {
    byType[c.sourceType] = (byType[c.sourceType] ?? 0) + 1;
    if (c.credibilityScore >= 70) highCred += 1;
    if (c.publishedAt) withDate += 1;
  }
  const domains = new Set(citations.map((c) => c.domain)).size;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {[
        { label: '总引用', value: citations.length, sub: `${domains} 个域名` },
        {
          label: '高权威',
          value: highCred,
          sub:
            citations.length > 0
              ? `${Math.round((highCred / citations.length) * 100)}%`
              : '—',
        },
        {
          label: '官方 / 学术',
          value: (byType['gov'] ?? 0) + (byType['academic'] ?? 0),
          sub: (byType['gov'] ?? 0) + (byType['academic'] ?? 0) + ' 条',
        },
        {
          label: '有日期',
          value: withDate,
          sub:
            citations.length > 0
              ? `${Math.round((withDate / citations.length) * 100)}%`
              : '—',
        },
      ].map((c) => (
        <Card key={c.label} className="px-3 py-2.5" bordered>
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            {c.label}
          </p>
          <p className="mt-0.5 text-xl font-bold text-gray-900">{c.value}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{c.sub}</p>
        </Card>
      ))}
    </div>
  );
}

// ─── Filter / Sort 工具 ─────────────────────────────
function publishedAgeMs(c: ArtifactCitation): number | null {
  if (!c.publishedAt) return null;
  const t = Date.parse(c.publishedAt);
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

function passesTimeFilter(c: ArtifactCitation, f: TimeFilter): boolean {
  if (f === 'all') return true;
  const ageMs = publishedAgeMs(c);
  if (f === 'undated') return ageMs == null;
  if (ageMs == null) return false;
  const day = 86_400_000;
  if (f === '7d') return ageMs <= 7 * day;
  if (f === '30d') return ageMs <= 30 * day;
  if (f === '180d') return ageMs <= 180 * day;
  if (f === '365d') return ageMs <= 365 * day;
  if (f === 'older') return ageMs > 365 * day;
  return true;
}

function passesCredibilityFilter(
  c: ArtifactCitation,
  f: CredibilityFilter
): boolean {
  if (f === 'all') return true;
  if (f === 'high') return c.credibilityScore >= 70;
  if (f === 'medium')
    return c.credibilityScore >= 40 && c.credibilityScore < 70;
  return c.credibilityScore < 40;
}

function applySearch(c: ArtifactCitation, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (c.title ?? '').toLowerCase().includes(needle) ||
    (c.snippet ?? '').toLowerCase().includes(needle) ||
    (c.url ?? '').toLowerCase().includes(needle) ||
    (c.domain ?? '').toLowerCase().includes(needle)
  );
}

function sortCitations(
  list: readonly ArtifactCitation[],
  by: SortKey
): ArtifactCitation[] {
  const arr = list.slice();
  switch (by) {
    case 'index':
      return arr.sort((a, b) => a.index - b.index);
    case 'credibility-desc':
      return arr.sort(
        (a, b) => (b.credibilityScore ?? 0) - (a.credibilityScore ?? 0)
      );
    case 'credibility-asc':
      return arr.sort(
        (a, b) => (a.credibilityScore ?? 0) - (b.credibilityScore ?? 0)
      );
    case 'date-desc':
      return arr.sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : -Infinity;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : -Infinity;
        return tb - ta;
      });
    case 'date-asc':
      return arr.sort((a, b) => {
        const ta = a.publishedAt ? Date.parse(a.publishedAt) : Infinity;
        const tb = b.publishedAt ? Date.parse(b.publishedAt) : Infinity;
        return ta - tb;
      });
    case 'occurrences-desc':
      return arr.sort(
        (a, b) => (b.occurrences?.length ?? 0) - (a.occurrences?.length ?? 0)
      );
    case 'domain-asc':
      return arr.sort((a, b) => (a.domain ?? '').localeCompare(b.domain ?? ''));
    default:
      return arr;
  }
}

// ─── 主组件 ──────────────────────────────────────────
export function ReferencesPanel({ citations, fallbackSources }: Props) {
  const [groupBy, setGroupBy] = useState<GroupKey>('type');
  const [sortBy, setSortBy] = useState<SortKey>('index');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<SourceTypeFilter>('all');
  const [credFilter, setCredFilter] = useState<CredibilityFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  const list = useMemo(() => citations ?? [], [citations]);

  // 1) 过滤 → 2) 搜索 → 3) 排序
  const filtered = useMemo(() => {
    return list.filter(
      (c) =>
        (typeFilter === 'all' || c.sourceType === typeFilter) &&
        passesCredibilityFilter(c, credFilter) &&
        passesTimeFilter(c, timeFilter) &&
        applySearch(c, search.trim())
    );
  }, [list, typeFilter, credFilter, timeFilter, search]);

  const sorted = useMemo(
    () => sortCitations(filtered, sortBy),
    [filtered, sortBy]
  );
  const grouped = useMemo(
    () => groupCitations(sorted, groupBy),
    [sorted, groupBy]
  );

  // 仅在当前 list 中实际出现的 sourceType 才进过滤下拉
  const presentTypes = useMemo(() => {
    const s = new Set<ArtifactCitation['sourceType']>();
    for (const c of list) s.add(c.sourceType);
    return Array.from(s);
  }, [list]);

  const hasActiveFilter =
    typeFilter !== 'all' ||
    credFilter !== 'all' ||
    timeFilter !== 'all' ||
    !!search.trim();

  const resetFilters = () => {
    setTypeFilter('all');
    setCredFilter('all');
    setTimeFilter('all');
    setSearch('');
  };

  // ─── 降级路径：没有结构化 citations，只有裸 URL ───
  if (list.length === 0) {
    const sources = fallbackSources ?? [];
    if (sources.length === 0) {
      return (
        <Card className="px-4 py-10 text-center" bordered>
          <Layers className="mx-auto mb-2 h-7 w-7 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">暂无引用来源</p>
          <p className="mt-1 text-[11px] text-gray-500">
            Researcher / Writer 在报告中引用 URL 后会自动收集到这里
          </p>
        </Card>
      );
    }
    // URL fallback —— 按域名分组
    const byHost = new Map<string, string[]>();
    for (const u of sources) {
      let host = '其它';
      try {
        host = new URL(u).hostname.replace(/^www\./, '');
      } catch {
        // ignore
      }
      const arr = byHost.get(host) ?? [];
      arr.push(u);
      byHost.set(host, arr);
    }
    const hostList = [...byHost.entries()].sort(
      (a, b) => b[1].length - a[1].length
    );
    return (
      <Card className="p-4" bordered>
        <div className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">参考文献</h3>
          <span className="ml-auto text-[11px] text-gray-500">
            {sources.length} 条 · {hostList.length} 域名
          </span>
        </div>
        <div className="space-y-3">
          {hostList.map(([host, urls]) => (
            <div
              key={host}
              className="rounded-lg border border-gray-100 bg-gray-50/30"
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5">
                <span className="font-mono text-[11px] font-semibold text-gray-700">
                  {host}
                </span>
                <span className="text-[10px] text-gray-500">
                  {urls.length} 条
                </span>
              </div>
              <ul className="space-y-0.5 p-2">
                {urls.map((u, i) => {
                  const safe = /^https?:\/\//i.test(u) ? u : null;
                  return (
                    <li key={`${u}-${i}`}>
                      {safe ? (
                        <a
                          href={safe}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 break-all rounded-md px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-50 hover:underline"
                        >
                          {safe}
                        </a>
                      ) : (
                        <span className="line-clamp-2 break-all px-2 py-1 text-[11px] text-gray-400">
                          {u}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-gray-400">
          报告暂未提供结构化引用元数据；当前仅按域名展示 URL。
        </p>
      </Card>
    );
  }

  // ─── 结构化路径：完整富信息 ───
  return (
    <div className="space-y-4">
      <StatRow citations={list} />
      <Card className="overflow-hidden" bordered>
        {/* Header: title + group tabs */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-semibold text-gray-900">参考文献</h3>
            <span className="text-xs text-gray-500">
              · 共 {list.length} 条
              {hasActiveFilter && filtered.length !== list.length && (
                <span className="ml-1 text-violet-600">
                  / 筛后 {filtered.length}
                </span>
              )}
            </span>
          </div>
          <div className="ml-auto">
            <GroupTabs active={groupBy} onChange={setGroupBy} />
          </div>
        </div>

        {/* 过滤 + 排序 + 搜索 row（对齐 TI ReferencePanel） */}
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/40 px-4 py-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 标题 / 摘要 / 域名"
              className="w-56 rounded-md border border-gray-200 bg-white py-1 pl-7 pr-7 text-[11px] text-gray-700 placeholder:text-gray-400 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-200"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="清空搜索"
              >
                <XIcon className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* 来源类型过滤 */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as SourceTypeFilter)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-200"
            title="按来源类型过滤"
          >
            <option value="all">全部类型</option>
            {presentTypes.map((tk) => (
              <option key={tk} value={tk}>
                {SOURCE_TYPE_META[tk]?.label ?? tk}
              </option>
            ))}
          </select>

          {/* 可信度过滤 */}
          <select
            value={credFilter}
            onChange={(e) => setCredFilter(e.target.value as CredibilityFilter)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-200"
            title="按可信度过滤"
          >
            <option value="all">全部权威度</option>
            <option value="high">高 (≥ 70)</option>
            <option value="medium">中 (40 ~ 70)</option>
            <option value="low">低 (&lt; 40)</option>
          </select>

          {/* 时间窗过滤 */}
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-200"
            title="按发布时间过滤"
          >
            <option value="all">全部时间</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
            <option value="180d">近 6 月</option>
            <option value="365d">近 1 年</option>
            <option value="older">1 年前</option>
            <option value="undated">未标日期</option>
          </select>

          {/* 排序 */}
          <div className="ml-auto flex items-center gap-1">
            <ArrowUpDown className="h-3 w-3 text-gray-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-200"
              title="排序方式"
            >
              <option value="index">按原序号</option>
              <option value="credibility-desc">可信度 ↓</option>
              <option value="credibility-asc">可信度 ↑</option>
              <option value="date-desc">日期 ↓ 新</option>
              <option value="date-asc">日期 ↑ 旧</option>
              <option value="occurrences-desc">引用次数 ↓</option>
              <option value="domain-asc">域名 A→Z</option>
            </select>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                title="清除所有过滤 / 搜索"
              >
                重置
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4 p-4">
          {filtered.length === 0 ? (
            <EmptyState
              type="search"
              title="未匹配到引用"
              description="试着调整搜索词或过滤条件"
              action={{ label: '重置过滤', onClick: resetFilters }}
            />
          ) : (
            grouped.map((g) => (
              <section key={g.label}>
                <header className="mb-2 flex items-center gap-2">
                  <h4 className="text-[12.5px] font-semibold text-gray-800">
                    {g.label}
                  </h4>
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                    {g.items.length}
                  </span>
                </header>
                <ul className="space-y-1.5">
                  {g.items.map((c) => (
                    <CitationCard key={`${c.uuid}-${c.index}`} c={c} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
