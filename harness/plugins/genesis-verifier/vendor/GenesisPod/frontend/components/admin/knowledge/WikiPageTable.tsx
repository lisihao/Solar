'use client';

/**
 * WikiPageTable —— 知识管理 Tab 3: Wiki
 *
 * 跨 KB 的 Wiki 页面列表（admin 全局视角）。行点击 → 右侧抽屉展示页面详情：
 *   - 所属 KB / 拥有者 / 分类 / slug
 *   - markdown body 预览（不渲染，避免 admin 抽屉过重）
 *   - sources 列表（文档引用 + quote）
 *   - outboundLinks 列表（wikilink 目标）
 *
 * 数据来源：GET /admin/knowledge/wiki-pages（分页 + filter）
 * 详情：GET /admin/knowledge/wiki-pages/:id
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import {
  DrawerShell,
  PaginationBar,
  Row,
  Section,
  StatGrid,
  Th,
  fmtTime,
} from '../_shared/admin-tables';
import { TruncatedCell } from '@/components/common/tables';

interface WikiRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  oneLiner: string | null;
  lastEditedBy: string | null;
  knowledgeBaseId: string;
  knowledgeBaseName: string | null;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WikiSource {
  documentId: string;
  spanStart: number | null;
  spanEnd: number | null;
  quote: string | null;
  document: {
    id: string;
    title: string;
    sourceType: string;
    sourceUrl: string | null;
  } | null;
}

interface WikiDetail {
  id: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  oneLiner: string | null;
  lastEditedBy: string | null;
  contentHash: string | null;
  knowledgeBase: {
    id: string;
    name: string;
    user: { id: string; email: string; fullName: string | null } | null;
  } | null;
  sources: WikiSource[];
  outboundLinks: Array<{
    targetSlug: string;
    targetTitle?: string | null;
    [key: string]: unknown;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: WikiRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function WikiPageTable() {
  const [items, setItems] = useState<WikiRow[]>([]);
  const [pagination, setPagination] = useState<ListResponse['pagination']>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pagination.pageSize),
        });
        if (search.trim()) params.set('search', search.trim());
        if (categoryFilter) params.set('category', categoryFilter);
        const res = await fetch(
          `${config.apiUrl}/admin/knowledge/wiki-pages?${params}`,
          { headers: getAuthHeader() }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const data: ListResponse = raw?.data ?? raw;
        setItems(Array.isArray(data.items) ? data.items : []);
        setPagination(
          data.pagination ?? { page: 1, pageSize: 50, total: 0, totalPages: 0 }
        );
      } catch (e) {
        setError((e as Error).message);
        logger.error('[WikiPageTable] load failed', e);
      } finally {
        setLoading(false);
      }
    },
    [search, categoryFilter, pagination.pageSize]
  );

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void load(1);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={onSearchSubmit}
          className="relative min-w-[240px] flex-1"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 Wiki 标题或 slug..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </form>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            void load(1);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">全部分类</option>
          <option value="OVERVIEW">OVERVIEW</option>
          <option value="ENTITY">ENTITY</option>
          <option value="EVENT">EVENT</option>
          <option value="TIMELINE">TIMELINE</option>
          <option value="CHARACTER">CHARACTER</option>
          <option value="LOCATION">LOCATION</option>
          <option value="ORGANIZATION">ORGANIZATION</option>
          <option value="OTHER">OTHER</option>
        </select>
        <button
          type="button"
          onClick={() => void load(pagination.page)}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
        <span className="text-xs text-gray-500">
          {pagination.total} 个页面 · 第 {pagination.page}/
          {pagination.totalPages || 1} 页
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          加载失败：{error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <Th>标题</Th>
              <Th>Slug</Th>
              <Th>所属 KB</Th>
              <Th>分类</Th>
              <Th>最近编辑</Th>
              <Th>更新时间</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {items.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  暂无 Wiki 页面
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    <TruncatedCell className="max-w-[260px] font-medium text-gray-900">
                      {p.title}
                    </TruncatedCell>
                  </td>
                  <td className="font-mono whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    <TruncatedCell className="font-mono max-w-[160px] text-gray-600">
                      {p.slug}
                    </TruncatedCell>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    <TruncatedCell
                      className="max-w-[160px] text-gray-600"
                      tooltip={p.knowledgeBaseName ?? p.knowledgeBaseId}
                    >
                      {p.knowledgeBaseName ?? p.knowledgeBaseId.slice(0, 8)}
                    </TruncatedCell>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    <span className="inline-flex whitespace-nowrap rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {p.category}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    {p.lastEditedBy ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {fmtTime(p.updatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={pagination.page}
        totalPages={pagination.totalPages}
        loading={loading}
        onChange={(p) => void load(p)}
      />

      {selectedId && (
        <WikiPageDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function WikiPageDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<WikiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `${config.apiUrl}/admin/knowledge/wiki-pages/${id}`,
          { headers: getAuthHeader() }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const data: WikiDetail | null = raw?.data ?? raw;
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        logger.error('[WikiPageDrawer] load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const preview = (body: string): string => {
    const max = 6000;
    return body.length > max ? `${body.slice(0, max)}\n... [truncated]` : body;
  };

  return (
    <DrawerShell
      title={loading ? '加载中...' : (detail?.title ?? '—')}
      subtitle={
        detail ? `${detail.knowledgeBase?.name ?? '—'} · /${detail.slug}` : ''
      }
      onClose={onClose}
    >
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          加载失败：{error}
        </div>
      )}
      {detail && !loading && (
        <div className="space-y-5">
          <Section title="基本信息">
            <Row
              label="ID"
              value={<code className="font-mono text-xs">{detail.id}</code>}
            />
            <Row
              label="Slug"
              value={<code className="font-mono text-xs">{detail.slug}</code>}
            />
            <Row label="标题" value={detail.title} />
            <Row label="分类" value={detail.category} />
            <Row label="一句话" value={detail.oneLiner ?? '—'} />
            <Row
              label="所属 KB"
              value={
                detail.knowledgeBase
                  ? `${detail.knowledgeBase.name} (${detail.knowledgeBase.user?.email ?? '—'})`
                  : '—'
              }
            />
            <Row label="最近编辑" value={detail.lastEditedBy ?? '—'} />
            <Row
              label="contentHash"
              value={
                detail.contentHash ? (
                  <code className="font-mono text-xs">
                    {detail.contentHash.slice(0, 16)}…
                  </code>
                ) : (
                  '—'
                )
              }
            />
            <Row label="创建时间" value={fmtTime(detail.createdAt)} />
            <Row label="更新时间" value={fmtTime(detail.updatedAt)} />
          </Section>

          <Section title="资产计数">
            <StatGrid
              items={[
                { label: '引用源', value: detail.sources.length },
                { label: '出向链接', value: detail.outboundLinks.length },
                { label: '字数', value: detail.body.length },
              ]}
            />
          </Section>

          <Section title="Markdown 原文">
            <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
              {preview(detail.body)}
            </pre>
          </Section>

          {detail.sources.length > 0 && (
            <Section title={`引用源 (${detail.sources.length})`}>
              <div className="space-y-2">
                {detail.sources.map((s, i) => (
                  <div
                    key={`${s.documentId}-${i}`}
                    className="rounded-md border border-gray-200 bg-white px-3 py-2"
                  >
                    <div
                      className="truncate text-xs font-medium text-gray-900"
                      title={s.document?.title ?? s.documentId}
                    >
                      {s.document?.title ?? s.documentId.slice(0, 8)}
                    </div>
                    {s.quote && (
                      <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                        “{s.quote}”
                      </p>
                    )}
                    {s.document?.sourceUrl && (
                      <a
                        href={s.document.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block break-all text-[11px] text-blue-600 hover:underline"
                      >
                        {s.document.sourceUrl}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {detail.outboundLinks.length > 0 && (
            <Section title={`出向链接 (${detail.outboundLinks.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {detail.outboundLinks.map((l, i) => (
                  <span
                    key={`${l.targetSlug}-${i}`}
                    className="font-mono inline-flex whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                    title={l.targetTitle ?? undefined}
                  >
                    [[{l.targetSlug}]]
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </DrawerShell>
  );
}
