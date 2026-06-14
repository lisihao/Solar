'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit,
  GripVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores';
import { TruncatedCell } from '@/components/common/tables';

type ModelType =
  | 'CHAT'
  | 'CHAT_FAST'
  | 'CODE'
  | 'MULTIMODAL'
  | 'IMAGE_GENERATION'
  | 'IMAGE_EDITING'
  | 'EMBEDDING'
  | 'RERANK'
  | 'EVALUATOR';

const ALL_MODEL_TYPES: ModelType[] = [
  'CHAT',
  'CHAT_FAST',
  'CODE',
  'MULTIMODAL',
  'IMAGE_GENERATION',
  'IMAGE_EDITING',
  'EMBEDDING',
  'RERANK',
  'EVALUATOR',
];

interface Recommendation {
  provider: string;
  modelType: ModelType;
  patterns: string[];
  priority: number;
  source: 'db' | 'default';
}

interface DbRecommendation {
  id: string;
  provider: string;
  modelType: ModelType;
  patterns: string[];
  priority: number;
  note: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPE_BADGE: Record<ModelType, string> = {
  CHAT: 'bg-blue-100 text-blue-700',
  CHAT_FAST: 'bg-sky-100 text-sky-700',
  CODE: 'bg-purple-100 text-purple-700',
  MULTIMODAL: 'bg-violet-100 text-violet-700',
  IMAGE_GENERATION: 'bg-green-100 text-green-700',
  IMAGE_EDITING: 'bg-orange-100 text-orange-700',
  EMBEDDING: 'bg-indigo-100 text-indigo-700',
  RERANK: 'bg-pink-100 text-pink-700',
  EVALUATOR: 'bg-amber-100 text-amber-700',
};

/**
 * 管理员：推荐矩阵编辑页
 *
 * 表格展示 (provider, modelType, patterns, priority, source)
 * 操作：
 *   - 编辑已有：打开 Modal 改 patterns[] / priority / note
 *   - 新增：填入 provider + modelType 一条
 *   - 删除：删除 DB 行（fallback 条目不可删；删除 DB 后若有默认会回落）
 *   - 补齐默认：插入"缺失的默认条目"（不覆盖已改过的）
 *   - 重置全部：清空 DB 并用硬编码默认重新 seed（危险操作，二次确认）
 */
export function ModelRecommendationsManagement() {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Recommendation | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ items: Recommendation[] }>(
        '/admin/model-recommendations'
      );
      setItems(res.items ?? []);
    } catch (e) {
      toast.error((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const providers = useMemo(() => {
    const s = new Set(items.map((i) => i.provider));
    return [...s].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) => {
      if (providerFilter && i.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        i.provider.toLowerCase().includes(q) ||
        i.modelType.toLowerCase().includes(q) ||
        i.patterns.some((p) => p.toLowerCase().includes(q))
      );
    });
  }, [items, search, providerFilter]);

  const seedMissing = async () => {
    setRunning(true);
    try {
      const res = await apiClient.post<{ seeded: number }>(
        '/admin/model-recommendations/seed',
        {}
      );
      toast.success(
        res.seeded > 0
          ? `已补齐 ${res.seeded} 条缺失默认`
          : '所有默认条目都已存在，无需补齐'
      );
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || '补齐失败');
    } finally {
      setRunning(false);
    }
  };

  const resetAll = async () => {
    setRunning(true);
    try {
      const res = await apiClient.post<{ seeded: number }>(
        '/admin/model-recommendations/reset',
        {}
      );
      toast.success(`已重置为 ${res.seeded} 条默认推荐`);
      setResetConfirm(false);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || '重置失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              推荐矩阵是什么？
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              一键 AI 配置在拿到 Provider 的 /v1/models 列表后，按
              <code className="mx-1 rounded bg-gray-100 px-1">
                (provider, modelType)
              </code>
              在这里查 patterns 正则列表， 按顺序走、第一个命中的 modelId
              即胜出。DB 行优先于硬编码默认； 删除 DB 行后自动回落到默认。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={seedMissing}
              disabled={running}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
              title="插入 DEFAULT 里缺失的条目（不覆盖已改过的）"
            >
              <Plus className="h-3.5 w-3.5" /> 补齐缺失默认
            </button>
            <button
              onClick={() => setResetConfirm(true)}
              disabled={running}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm transition-colors hover:bg-red-100 disabled:opacity-50"
              title="清空 DB 并重新 seed 硬编码默认（会丢失你的编辑）"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 重置全部
            </button>
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              />{' '}
              刷新
            </button>
          </div>
        </div>
      </div>

      {/* Search + Filter + Add */}
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 provider、modelType、pattern..."
            className="w-full rounded-md border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Providers ({providers.length})</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> 新增推荐
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[14%]" />
            <col className="w-[34%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Provider
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Model Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Patterns (按序匹配)
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Priority
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Source
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  加载中...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  没有匹配的推荐条目
                </td>
              </tr>
            )}
            {filtered.map((r, i) => (
              <tr
                key={`${r.provider}:${r.modelType}:${i}`}
                className="hover:bg-gray-50"
              >
                <td className="px-4 py-2.5">
                  <TruncatedCell className="max-w-[160px] text-sm font-medium text-gray-900">
                    {r.provider}
                  </TruncatedCell>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[r.modelType]}`}
                  >
                    {r.modelType}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <TruncatedCell
                    className="font-mono max-w-[280px] text-xs text-gray-700"
                    tooltip={r.patterns.join(' · ')}
                  >
                    {r.patterns.join(' · ')}
                  </TruncatedCell>
                </td>
                <td className="px-4 py-2.5 text-center text-sm text-gray-600">
                  {r.priority}
                </td>
                <td className="px-4 py-2.5 text-center text-xs">
                  {r.source === 'db' ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                      DB
                    </span>
                  ) : (
                    <span
                      className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600"
                      title="硬编码默认值，未在 DB 里持久化"
                    >
                      Default
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setEditing(r)}
                      title={
                        r.source === 'default'
                          ? '把默认条目持久化到 DB 并编辑'
                          : '编辑 patterns / priority / note'
                      }
                      className="rounded p-1.5 text-blue-600 transition-colors hover:bg-blue-50"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <RecommendationFormModal
          mode="add"
          initial={null}
          existingKeys={
            new Set(items.map((i) => `${i.provider}:${i.modelType}`))
          }
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            void refresh();
          }}
        />
      )}
      {editing && (
        <RecommendationFormModal
          mode={editing.source === 'db' ? 'edit' : 'materialize'}
          initial={editing}
          existingKeys={new Set()}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
      {resetConfirm && (
        <Modal
          open
          onClose={() => setResetConfirm(false)}
          size="md"
          title="重置推荐矩阵"
          subtitle="会清空 DB 里所有自定义条目，重新写入硬编码默认"
          footer={
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setResetConfirm(false)}
                disabled={running}
                className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={resetAll}
                disabled={running}
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" /> 确认重置
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm text-gray-700">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <div className="text-xs text-amber-800">
                这是不可恢复的操作。所有你对 patterns / priority
                的修改都会丢失。
                一般只在新版本上线后"同步最新默认矩阵"时才使用。
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Re-export for IDE tree-shake consistency
export { Check, X };

// ==================== Edit / Add Modal ====================

function RecommendationFormModal({
  mode,
  initial,
  existingKeys,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit' | 'materialize';
  initial: Recommendation | null;
  existingKeys: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState(initial?.provider ?? '');
  const [modelType, setModelType] = useState<ModelType>(
    initial?.modelType ?? 'CHAT'
  );
  const [patterns, setPatterns] = useState<string[]>(initial?.patterns ?? ['']);
  const [priority, setPriority] = useState<number>(initial?.priority ?? 50);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    // materialize 模式：把默认条目写入 DB，保留原始 patterns
    if (mode === 'materialize' && initial) {
      setProvider(initial.provider);
      setModelType(initial.modelType);
      setPatterns(initial.patterns);
      setPriority(initial.priority);
    }
  }, [mode, initial]);

  const validate = (): string | null => {
    if (!provider.trim()) return 'provider 不能为空';
    if (mode === 'add') {
      const key = `${provider.trim().toLowerCase()}:${modelType}`;
      if (existingKeys.has(key))
        return `已有 ${provider.trim()} / ${modelType} 的条目，请改用编辑`;
    }
    const cleaned = patterns.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length === 0) return '至少需要一个 regex pattern';
    for (const p of cleaned) {
      try {
        new RegExp(p);
      } catch (e) {
        return `pattern "${p}" 不是合法 regex: ${(e as Error).message}`;
      }
    }
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      setValidation(err);
      return;
    }
    setValidation(null);
    setSaving(true);
    try {
      const cleaned = patterns.map((p) => p.trim()).filter(Boolean);
      if (mode === 'edit' && initial) {
        // edit: use DB row id; but our Recommendation doesn't have id here - find by provider+modelType
        // server-side PATCH needs id. Fall back to create-over-delete via POST (upsert semantics).
        // Simpler: call POST (which errors on conflict), otherwise PATCH via /db list.
        // Here we pivot: look up the DB row id via /admin/model-recommendations/db, then PATCH.
        const dbRows = await apiClient.get<{ items: DbRecommendation[] }>(
          '/admin/model-recommendations/db'
        );
        const row = dbRows.items.find(
          (r) =>
            r.provider === initial.provider && r.modelType === initial.modelType
        );
        if (row) {
          await apiClient.patch(`/admin/model-recommendations/${row.id}`, {
            patterns: cleaned,
            priority,
            note: note || null,
          });
        } else {
          // DB 里不存在（不应该发生），回退到 create
          await apiClient.post('/admin/model-recommendations', {
            provider: provider.trim().toLowerCase(),
            modelType,
            patterns: cleaned,
            priority,
            note: note || undefined,
          });
        }
      } else {
        // add or materialize
        await apiClient.post('/admin/model-recommendations', {
          provider: provider.trim().toLowerCase(),
          modelType,
          patterns: cleaned,
          priority,
          note: note || undefined,
        });
      }
      toast.success('已保存');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const addPattern = () => setPatterns([...patterns, '']);
  const removePattern = (i: number) =>
    setPatterns(patterns.filter((_, idx) => idx !== i));
  const updatePattern = (i: number, v: string) =>
    setPatterns(patterns.map((p, idx) => (idx === i ? v : p)));
  const movePattern = (from: number, to: number) => {
    if (to < 0 || to >= patterns.length) return;
    const copy = [...patterns];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    setPatterns(copy);
  };

  const title =
    mode === 'add'
      ? '新增推荐条目'
      : mode === 'materialize'
        ? '把默认条目持久化到 DB'
        : `编辑 ${provider} / ${modelType}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={title}
      subtitle={
        mode === 'materialize'
          ? '这条目前是硬编码默认；保存后会写入 DB，之后可以继续编辑'
          : '按序匹配 /v1/models 返回的 modelId，第一个命中即胜出'
      }
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> 保存
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {validation && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {validation}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Provider
            </label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={mode !== 'add'}
              placeholder="openai, anthropic, ..."
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Model Type
            </label>
            <select
              value={modelType}
              onChange={(e) => setModelType(e.target.value as ModelType)}
              disabled={mode !== 'add'}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
            >
              {ALL_MODEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-700">
              Patterns (regex，按上到下顺序匹配)
            </label>
            <button
              onClick={addPattern}
              type="button"
              className="text-xs text-blue-600 transition-colors hover:text-blue-700"
            >
              + 添加 pattern
            </button>
          </div>
          <div className="space-y-1">
            {patterns.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => movePattern(i, i - 1)}
                    disabled={i === 0}
                    className="text-[10px] text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    title="上移"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => movePattern(i, i + 1)}
                    disabled={i === patterns.length - 1}
                    className="text-[10px] text-gray-400 hover:text-gray-700 disabled:opacity-30"
                    title="下移"
                  >
                    ▼
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-gray-300" />
                <span className="w-6 text-center text-xs text-gray-400">
                  {i + 1}
                </span>
                <input
                  type="text"
                  value={p}
                  onChange={(e) => updatePattern(i, e.target.value)}
                  placeholder="^gpt-4o(?!-mini)"
                  className="font-mono flex-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => removePattern(i)}
                  disabled={patterns.length === 1}
                  className="rounded p-1 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-30"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Priority（数字越小越靠前）
            </label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 50)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              备注 (可选)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='例如："2026-04 加入 gpt-5"'
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
