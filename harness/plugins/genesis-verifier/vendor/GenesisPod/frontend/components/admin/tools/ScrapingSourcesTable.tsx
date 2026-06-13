'use client';

/**
 * ScrapingSourcesTable —— 工具管理 Tab 3: 第三方工具（抓取源）
 *
 * 2026-05-11 W3r: 去掉 sub-tab，直接表格呈现 industry-report 的 config.sources
 *
 * 数据：GET /admin/ai/tools → 找 toolId='industry-report' → config.sources[]
 *   每行：name / domain / category / 可信度 / 话题类型 / 启用
 * 行点击 → 抽屉编辑（含删除）；顶部"添加来源"→ 抽屉新建
 *
 * 持久化：PATCH /admin/ai/tools/industry-report { config: {...prev, sources } }
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, Plus, Trash2, Globe } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { DrawerShell, PaginationBar, Th } from '../_shared/admin-tables';
import { TruncatedCell } from '@/components/common/tables';
import { confirm } from '@/stores';

interface ToolRow {
  toolId: string;
  config: Record<string, unknown> | null;
}

interface ToolsResponse {
  tools: ToolRow[];
}

interface IndustryReportSource {
  id: string;
  name: string;
  domain: string;
  category: string;
  credibilityScore: number;
  enabled: boolean;
  topicTypes: string[];
}

// 2026-05-12: PR-S0a dedup 后 alias 'industry-report' 在 admin list 被隐藏，
//   canonical registry id 是 'industry-report-search'。backend
//   resolveEffectiveConfig 自动回填 alias 的 config.sources。
const TOOL_ID = 'industry-report-search';
const TOOL_ID_LEGACY_ALIAS = 'industry-report';
const PAGE_SIZE = 50;

const SOURCE_CATEGORIES = [
  '科技报告',
  '金融研究',
  '行业分析',
  '咨询机构',
  '政策研究',
  '学术研究',
  '新闻媒体',
  '其他',
];

const TOPIC_TYPES = [
  { value: 'TECHNOLOGY', label: '科技' },
  { value: 'COMPANY', label: '公司' },
  { value: 'MACRO', label: '宏观' },
  { value: 'EVENT', label: '事件' },
];

export function ScrapingSourcesTable() {
  const [toolConfig, setToolConfig] = useState<Record<string, unknown> | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai/tools`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const data: ToolsResponse = raw?.data ?? raw;
      const list = data.tools ?? [];
      const tool =
        list.find((t) => t.toolId === TOOL_ID) ??
        list.find((t) => t.toolId === TOOL_ID_LEGACY_ALIAS);
      setToolConfig(tool?.config ?? null);
    } catch (e) {
      setError((e as Error).message);
      logger.error('[ScrapingSourcesTable] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sources = useMemo<IndustryReportSource[]>(() => {
    if (!toolConfig) return [];
    const arr = toolConfig.sources;
    return Array.isArray(arr) ? (arr as IndustryReportSource[]) : [];
  }, [toolConfig]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sources.filter((s) => {
      if (categoryFilter && s.category !== categoryFilter) return false;
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.domain.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [sources, search, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const persist = async (updated: IndustryReportSource[]): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai/tools/${TOOL_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({
          config: { ...(toolConfig ?? {}), sources: updated },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      logger.error('[ScrapingSourcesTable] persist failed', e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (data: IndustryReportSource) => {
    const exists = sources.some((s) => s.id === data.id);
    const updated = exists
      ? sources.map((s) => (s.id === data.id ? data : s))
      : [...sources, data];
    const ok = await persist(updated);
    if (ok) {
      setShowCreate(false);
      setSelectedId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const source = sources.find((s) => s.id === id);
    if (!source) return;
    if (
      !(await confirm({
        title: `确认删除来源「${source.name}」？`,
        type: 'danger',
      }))
    )
      return;
    const updated = sources.filter((s) => s.id !== id);
    const ok = await persist(updated);
    if (ok && selectedId === id) setSelectedId(null);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const updated = sources.map((s) => (s.id === id ? { ...s, enabled } : s));
    await persist(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            name={`scraping-search-${Math.random().toString(36).slice(2, 10)}`}
            autoComplete="new-password"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="搜索 name / domain..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">全部分类</option>
          {SOURCE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          添加来源
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
        <span className="text-xs text-gray-500">
          {filtered.length} / {sources.length}
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          错误：{error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        {/* 2026-05-12: 与 BuiltinToolsTable / APIServicesTable colgroup 配方一致 */}
        <table className="min-w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <Th>名称</Th>
              <Th>域名</Th>
              <Th>分类</Th>
              <Th className="text-right">可信度</Th>
              <Th>话题类型</Th>
              <Th>启用</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {pageItems.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  暂无抓取源
                </td>
              </tr>
            ) : (
              pageItems.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <TruncatedCell className="max-w-[220px]">
                      {s.name}
                    </TruncatedCell>
                  </td>
                  <td className="font-mono px-4 py-3 text-xs text-gray-600">
                    <TruncatedCell className="max-w-[220px]">
                      {s.domain}
                    </TruncatedCell>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    {s.category}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs tabular-nums text-gray-700">
                    {s.credibilityScore.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    <TruncatedCell
                      className="max-w-[220px]"
                      tooltip={s.topicTypes.join(', ')}
                    >
                      {s.topicTypes.length === 0
                        ? '—'
                        : s.topicTypes.join(', ')}
                    </TruncatedCell>
                  </td>
                  <td
                    className="whitespace-nowrap px-4 py-3 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => void handleToggle(s.id, !s.enabled)}
                      disabled={saving}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        s.enabled ? 'bg-blue-600' : 'bg-gray-300'
                      } disabled:opacity-50`}
                      aria-label={s.enabled ? '禁用' : '启用'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          s.enabled ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        loading={loading}
        onChange={(p) => setPage(p)}
      />

      {(showCreate || selectedId) && (
        <SourceEditorDrawer
          initial={
            selectedId
              ? (sources.find((s) => s.id === selectedId) ?? null)
              : null
          }
          saving={saving}
          onClose={() => {
            setShowCreate(false);
            setSelectedId(null);
          }}
          onSave={handleSave}
          onDelete={selectedId ? () => handleDelete(selectedId) : undefined}
        />
      )}
    </div>
  );
}

function generateSourceId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `source-${Date.now()}`;
}

function SourceEditorDrawer({
  initial,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  initial: IndustryReportSource | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: IndustryReportSource) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<IndustryReportSource>(
    initial ?? {
      id: '',
      name: '',
      domain: '',
      category: '',
      credibilityScore: 0.8,
      enabled: true,
      topicTypes: [],
    }
  );

  const toggleTopic = (t: string) => {
    setForm((prev) => ({
      ...prev,
      topicTypes: prev.topicTypes.includes(t)
        ? prev.topicTypes.filter((x) => x !== t)
        : [...prev.topicTypes, t],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalId = form.id || generateSourceId(form.name);
    void onSave({ ...form, id: finalId });
  };

  return (
    <DrawerShell
      title={initial ? `编辑：${initial.name}` : '添加抓取源'}
      subtitle={initial ? initial.domain : '配置新的行业报告抓取来源'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">
            名称 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="例如 SemiAnalysis"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">
            域名 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              required
              value={form.domain}
              onChange={(e) =>
                setForm((p) => ({ ...p, domain: e.target.value }))
              }
              placeholder="例如 semianalysis.com"
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">
            分类 <span className="text-red-500">*</span>
          </label>
          <select
            required
            value={form.category}
            onChange={(e) =>
              setForm((p) => ({ ...p, category: e.target.value }))
            }
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">选择分类</option>
            {SOURCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">
            可信度（0.0 - 1.0）
          </label>
          <input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={form.credibilityScore}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                credibilityScore: Math.max(
                  0,
                  Math.min(1, parseFloat(e.target.value) || 0)
                ),
              }))
            }
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-gray-700">话题类型</label>
          <div className="flex flex-wrap gap-2">
            {TOPIC_TYPES.map((tt) => {
              const on = form.topicTypes.includes(tt.value);
              return (
                <button
                  type="button"
                  key={tt.value}
                  onClick={() => toggleTopic(tt.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    on
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {tt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="source-enabled"
            checked={form.enabled}
            onChange={(e) =>
              setForm((p) => ({ ...p, enabled: e.target.checked }))
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="source-enabled" className="text-sm text-gray-700">
            启用
          </label>
        </div>

        <div className="flex items-center justify-between pt-4">
          {onDelete ? (
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存
            </button>
          </div>
        </div>
      </form>
    </DrawerShell>
  );
}
