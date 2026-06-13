'use client';

/**
 * DocumentTable —— 知识管理 Tab 2: 文档
 *
 * 跨 KB 的全局文档列表（admin 全局视角）。行点击 → 右侧抽屉展示文档详情：
 *   - 所属 KB / 拥有者 / sourceType
 *   - chunk 统计（parent / child / 已嵌入 / 未嵌入）
 *   - rawContent 预览（offloaded 标记）
 *   - 错误日志
 *
 * 数据来源：GET /admin/knowledge/documents（分页 + filter）
 * 详情：GET /admin/knowledge/documents/:id
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
  fmtBytes,
  fmtTime,
  statusBadgeClass,
} from '../_shared/admin-tables';
import { TruncatedCell } from '@/components/common/tables';

interface DocRow {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  status: string;
  chunkCount: number;
  rawContentSize: number | null;
  offloaded: boolean;
  knowledgeBaseId: string;
  knowledgeBaseName: string | null;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  hasError: boolean;
}

interface DocDetail {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  mimeType: string | null;
  status: string;
  knowledgeBase: {
    id: string;
    name: string;
    user: { id: string; email: string; fullName: string | null } | null;
  } | null;
  rawContent: string | null;
  rawContentSize: number | null;
  offloaded: boolean;
  rawContentUri: string | null;
  metadata: unknown;
  chunkStats: {
    parentChunks: number;
    childChunks: number;
    embeddedChildChunks: number;
    notEmbeddedChildChunks: number;
  };
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  lastError: string | null;
}

interface ListResponse {
  items: DocRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function DocumentTable() {
  const [items, setItems] = useState<DocRow[]>([]);
  const [pagination, setPagination] = useState<ListResponse['pagination']>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
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
        if (statusFilter) params.set('status', statusFilter);
        const res = await fetch(
          `${config.apiUrl}/admin/knowledge/documents?${params}`,
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
        logger.error('[DocumentTable] load failed', e);
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, pagination.pageSize]
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
      {/* Toolbar */}
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
            placeholder="搜索文档标题..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </form>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            void load(1);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">全部状态</option>
          <option value="PENDING">PENDING</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="ERROR">ERROR</option>
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
          {pagination.total} 个文档 · 第 {pagination.page}/
          {pagination.totalPages || 1} 页
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          加载失败：{error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[18%]" />
            <col className="w-[12%]" />
            <col className="w-[13%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <Th>标题</Th>
              <Th>所属 KB</Th>
              <Th>来源</Th>
              <Th>状态</Th>
              <Th className="text-right">Chunks</Th>
              <Th className="text-right">大小</Th>
              <Th>处理时间</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {items.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  暂无文档
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <TruncatedCell className="max-w-[280px] font-medium text-gray-900">
                        {d.title}
                      </TruncatedCell>
                      {d.hasError && (
                        <span className="inline-flex flex-shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                          ERR
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    <TruncatedCell
                      className="max-w-[180px] text-gray-600"
                      tooltip={d.knowledgeBaseName ?? d.knowledgeBaseId}
                    >
                      {d.knowledgeBaseName ?? d.knowledgeBaseId.slice(0, 8)}
                    </TruncatedCell>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    {d.sourceType}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(d.status)}`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                    {d.chunkCount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums text-gray-600">
                    {fmtBytes(d.rawContentSize)}
                    {d.offloaded && (
                      <span className="ml-1 text-[10px] text-gray-400">
                        (off)
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {fmtTime(d.processedAt ?? d.updatedAt)}
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
        <DocumentDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function DocumentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `${config.apiUrl}/admin/knowledge/documents/${id}`,
          { headers: getAuthHeader() }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        const data: DocDetail | null = raw?.data ?? raw;
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        logger.error('[DocumentDrawer] load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const previewContent = (raw: string | null): string => {
    if (!raw) return '';
    const max = 4000;
    return raw.length > max ? `${raw.slice(0, max)}\n... [truncated]` : raw;
  };

  return (
    <DrawerShell
      title={loading ? '加载中...' : (detail?.title ?? '—')}
      subtitle={
        detail
          ? `${detail.knowledgeBase?.name ?? '—'} · ${detail.sourceType}`
          : ''
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
              label="所属 KB"
              value={
                detail.knowledgeBase
                  ? `${detail.knowledgeBase.name} (${detail.knowledgeBase.user?.email ?? '—'})`
                  : '—'
              }
            />
            <Row label="来源" value={detail.sourceType} />
            {detail.sourceUrl && (
              <Row
                label="来源 URL"
                value={
                  <a
                    href={detail.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-xs text-blue-600 hover:underline"
                  >
                    {detail.sourceUrl}
                  </a>
                }
              />
            )}
            <Row label="MIME" value={detail.mimeType ?? '—'} />
            <Row
              label="状态"
              value={
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(detail.status)}`}
                >
                  {detail.status}
                </span>
              }
            />
            <Row label="创建时间" value={fmtTime(detail.createdAt)} />
            <Row label="更新时间" value={fmtTime(detail.updatedAt)} />
            <Row label="处理时间" value={fmtTime(detail.processedAt)} />
          </Section>

          <Section title="Chunk 统计">
            <StatGrid
              items={[
                { label: '父块', value: detail.chunkStats.parentChunks },
                { label: '子块', value: detail.chunkStats.childChunks },
                {
                  label: '已嵌入',
                  value: detail.chunkStats.embeddedChildChunks,
                },
                {
                  label: '未嵌入',
                  value: detail.chunkStats.notEmbeddedChildChunks,
                },
              ]}
            />
          </Section>

          <Section title="原文内容">
            <Row label="字节数" value={fmtBytes(detail.rawContentSize)} />
            <Row label="Offloaded" value={detail.offloaded ? '是' : '否'} />
            {detail.rawContentUri && (
              <Row
                label="存储 URI"
                value={
                  <code className="font-mono break-all text-xs">
                    {detail.rawContentUri}
                  </code>
                }
              />
            )}
            {detail.rawContent && (
              <div className="mt-2">
                <pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
                  {previewContent(detail.rawContent)}
                </pre>
              </div>
            )}
          </Section>

          {detail.lastError && (
            <Section title="最近错误">
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-red-50 p-3 text-xs text-red-700">
                {detail.lastError}
              </pre>
            </Section>
          )}
        </div>
      )}
    </DrawerShell>
  );
}
