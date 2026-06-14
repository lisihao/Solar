'use client';

/**
 * AIProvidersSettings —— admin 维护 ai_providers 表的 UI
 *
 * 2026-05-11 P6 (BYOK 数据驱动重构)：让 admin 在 UI 添加任意新 provider，
 * 不必改代码。Provider 表是"分组标签 + 兜底 endpoint"，AIModel 行的
 * apiEndpoint 优先生效。
 *
 * 风格约束（CLAUDE.md）：light-only（不加 dark: 变体）+ Lucide 图标 +
 * 与现有 admin/ai-config 视觉一致（同样的 rounded-lg / border-gray-300）。
 */

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Save, Loader2 } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';
import { TruncatedCell } from '@/components/common/tables';

interface AIProvider {
  id: string;
  slug: string;
  name: string;
  endpoint: string;
  apiFormat: string;
  testModel: string;
  capabilities: string[];
  iconUrl: string | null;
  description: string | null;
  docUrl: string | null;
  freeTierNote: string | null;
  displayOrder: number;
  isEnabled: boolean;
  scope: string;
}

interface ProviderFormData {
  slug: string;
  name: string;
  endpoint: string;
  apiFormat: string;
  testModel: string;
  capabilities: string[];
  iconUrl: string;
  description: string;
  docUrl: string;
  freeTierNote: string;
  displayOrder: number;
  isEnabled: boolean;
}

const EMPTY_FORM: ProviderFormData = {
  slug: '',
  name: '',
  endpoint: '',
  apiFormat: 'openai',
  testModel: '',
  capabilities: ['CHAT'],
  iconUrl: '',
  description: '',
  docUrl: '',
  freeTierNote: '',
  displayOrder: 100,
  isEnabled: true,
};

const CAPABILITY_OPTIONS = [
  'CHAT',
  'CHAT_FAST',
  'CODE',
  'MULTIMODAL',
  'EMBEDDING',
  'RERANK',
  'IMAGE_GENERATION',
  'IMAGE_EDITING',
  'EVALUATOR',
  'TTS',
  'AUDIO',
];

export function AIProvidersSettings() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [apiFormats, setApiFormats] = useState<
    Array<{ id: string; slug: string; name: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<AIProvider | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<ProviderFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const loadProviders = async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, fRes] = await Promise.all([
        fetch(`${config.apiUrl}/admin/ai-providers`, {
          headers: getAuthHeader(),
        }),
        fetch(`${config.apiUrl}/admin/api-formats`, {
          headers: getAuthHeader(),
        }),
      ]);
      if (!pRes.ok) throw new Error(`Load providers failed: ${pRes.status}`);
      if (!fRes.ok) throw new Error(`Load api-formats failed: ${fRes.status}`);
      // 后端全局 ResponseTransformInterceptor 包 { success, data, metadata }，解一层
      const pRaw = await pRes.json();
      const fRaw = await fRes.json();
      setProviders(
        Array.isArray(pRaw) ? pRaw : Array.isArray(pRaw?.data) ? pRaw.data : []
      );
      setApiFormats(
        Array.isArray(fRaw) ? fRaw : Array.isArray(fRaw?.data) ? fRaw.data : []
      );
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      logger.error('[AIProvidersSettings] load failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (p: AIProvider) => {
    setEditing(p);
    setFormData({
      slug: p.slug,
      name: p.name,
      endpoint: p.endpoint,
      apiFormat: p.apiFormat,
      testModel: p.testModel,
      capabilities: p.capabilities,
      iconUrl: p.iconUrl ?? '',
      description: p.description ?? '',
      docUrl: p.docUrl ?? '',
      freeTierNote: p.freeTierNote ?? '',
      displayOrder: p.displayOrder,
      isEnabled: p.isEnabled,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setFormData(EMPTY_FORM);
  };

  const toggleCapability = (cap: string) => {
    setFormData((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap],
    }));
  };

  const save = async () => {
    if (!formData.slug.trim() || !formData.name.trim()) {
      setError('slug 和 name 必填');
      return;
    }
    if (!formData.endpoint.trim()) {
      setError('endpoint 必填（AIModel 没填 apiEndpoint 时走兜底）');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const url = editing
        ? `${config.apiUrl}/admin/ai-providers/${editing.id}`
        : `${config.apiUrl}/admin/ai-providers`;
      const method = editing ? 'PATCH' : 'POST';
      const payload = {
        slug: formData.slug.trim(),
        name: formData.name.trim(),
        endpoint: formData.endpoint.trim(),
        apiFormat: formData.apiFormat,
        testModel: formData.testModel.trim(),
        capabilities: formData.capabilities,
        iconUrl: formData.iconUrl.trim() || undefined,
        description: formData.description.trim() || undefined,
        docUrl: formData.docUrl.trim() || undefined,
        freeTierNote: formData.freeTierNote.trim() || undefined,
        displayOrder: formData.displayOrder,
        isEnabled: formData.isEnabled,
      };
      const res = await fetch(url, {
        method,
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Save failed (${res.status}): ${body}`);
      }
      setSuccess(
        editing ? `已更新 ${formData.slug}` : `已添加 ${formData.slug}`
      );
      closeForm();
      await loadProviders();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: AIProvider) => {
    if (
      !(await confirm({
        title: `确认删除 Provider "${p.name}"（slug=${p.slug}）？`,
        type: 'danger',
      }))
    )
      return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai-providers/${p.id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Delete failed (${res.status}): ${body}`);
      }
      setSuccess(`已删除 ${p.slug}`);
      await loadProviders();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 p-4 text-sm text-green-600">
          {success}
        </div>
      )}

      {/* 2026-05-11: 删除冗余内页标题（drawer header + tab 已表达"字典管理 → AI Providers"），
          仅保留操作按钮。用户指令："保留必要的，不要事无巨细"。 */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          添加 Provider
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[14%]" />
            <col className="w-[26%]" />
            <col className="w-[11%]" />
            <col className="w-[20%]" />
            <col className="w-[8%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Slug
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                显示名
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                兜底 Endpoint
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                ApiFormat
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Capabilities
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                状态
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {providers.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  暂无 Provider。点击右上"添加 Provider"创建。
                </td>
              </tr>
            )}
            {/* 2026-05-11: 表格单行不换行规则 —— 每个 cell whitespace-nowrap；
                长内容列（endpoint / capabilities）用 truncate max-w + title 提示。
                用户："每一行还是每一行，超过用省略号，鼠标上去有提示"。 */}
            {providers.map((p) => {
              const caps = p.capabilities.join(', ');
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="font-mono whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                    <TruncatedCell className="max-w-[120px] text-gray-900">
                      {p.slug}
                    </TruncatedCell>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                    <TruncatedCell className="max-w-[160px] text-gray-900">
                      {p.name}
                    </TruncatedCell>
                  </td>
                  <td className="font-mono whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    <TruncatedCell
                      className="max-w-[240px] text-gray-600"
                      tooltip={p.endpoint}
                    >
                      {p.endpoint}
                    </TruncatedCell>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                    {p.apiFormat}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                    <TruncatedCell
                      className="max-w-[220px] text-gray-600"
                      tooltip={caps}
                    >
                      {caps}
                    </TruncatedCell>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {p.isEnabled ? (
                      <span className="inline-flex whitespace-nowrap rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                        启用
                      </span>
                    ) : (
                      <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        禁用
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="mr-2 inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil className="h-3 w-3" />
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editing ? `编辑 Provider: ${editing.slug}` : '添加 Provider'}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Slug <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({ ...formData, slug: e.target.value })
                    }
                    disabled={!!editing}
                    placeholder="together-ai"
                    className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    kebab-case 唯一标识，创建后不可改
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    显示名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Together AI"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  兜底 Endpoint <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.endpoint}
                  onChange={(e) =>
                    setFormData({ ...formData, endpoint: e.target.value })
                  }
                  placeholder="https://api.together.xyz/v1"
                  className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  AIModel 行的 apiEndpoint 优先生效，此处只作兜底
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    API Format
                  </label>
                  <select
                    value={formData.apiFormat}
                    onChange={(e) =>
                      setFormData({ ...formData, apiFormat: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {apiFormats.map((f) => (
                      <option key={f.slug} value={f.slug}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Test Model
                  </label>
                  <input
                    type="text"
                    value={formData.testModel}
                    onChange={(e) =>
                      setFormData({ ...formData, testModel: e.target.value })
                    }
                    placeholder="meta-llama/Llama-3-8b-chat-hf"
                    className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Capabilities
                </label>
                <div className="flex flex-wrap gap-2">
                  {CAPABILITY_OPTIONS.map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => toggleCapability(cap)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        formData.capabilities.includes(cap)
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {cap}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  描述（可选）
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Icon URL（可选）
                  </label>
                  <input
                    type="text"
                    value={formData.iconUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, iconUrl: e.target.value })
                    }
                    placeholder="/icons/ai/together.svg"
                    className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Doc URL（可选）
                  </label>
                  <input
                    type="text"
                    value={formData.docUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, docUrl: e.target.value })
                    }
                    placeholder="https://docs.together.ai"
                    className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Display Order
                  </label>
                  <input
                    type="number"
                    value={formData.displayOrder}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        displayOrder: parseInt(e.target.value, 10) || 100,
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={formData.isEnabled}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          isEnabled: e.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    启用
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {editing ? '保存修改' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
