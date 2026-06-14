'use client';

/**
 * ModelTypesSettings —— admin 维护 model_types 表的 UI
 *
 * 2026-05-11 P7 (BYOK 数据驱动重构)：内置 11 行（CHAT / EMBEDDING / RERANK / ...）
 * UI 显示但不可删/不可改 slug，可改 name/description/category 等。
 * admin 可加自定义类型（如 VIDEO_GENERATION / STT-realtime），不改代码。
 *
 * 风格：light-only + Lucide 图标 + admin/ai-config 视觉一致。
 */

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Save, Loader2 } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';
import { TruncatedCell } from '@/components/common/tables';

interface ModelType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  defaultApiFormat: string | null;
  isBuiltin: boolean;
  displayOrder: number;
  isEnabled: boolean;
  scope: string;
}

interface FormData {
  slug: string;
  name: string;
  description: string;
  category: string;
  defaultApiFormat: string;
  displayOrder: number;
  isEnabled: boolean;
}

const EMPTY_FORM: FormData = {
  slug: '',
  name: '',
  description: '',
  category: 'text',
  defaultApiFormat: 'openai',
  displayOrder: 100,
  isEnabled: true,
};

const CATEGORIES = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图像' },
  { value: 'embed', label: '向量/重排' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
  { value: 'other', label: '其它' },
];

export function ModelTypesSettings() {
  const [items, setItems] = useState<ModelType[]>([]);
  const [apiFormats, setApiFormats] = useState<
    Array<{ slug: string; name: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<ModelType | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, fRes] = await Promise.all([
        fetch(`${config.apiUrl}/admin/model-types`, {
          headers: getAuthHeader(),
        }),
        fetch(`${config.apiUrl}/admin/api-formats`, {
          headers: getAuthHeader(),
        }),
      ]);
      if (!tRes.ok) throw new Error(`Load model-types failed: ${tRes.status}`);
      if (!fRes.ok) throw new Error(`Load api-formats failed: ${fRes.status}`);
      // 后端全局 ResponseTransformInterceptor 包 { success, data, metadata }，解一层
      const tRaw = await tRes.json();
      const fRaw = await fRes.json();
      setItems(
        Array.isArray(tRaw) ? tRaw : Array.isArray(tRaw?.data) ? tRaw.data : []
      );
      setApiFormats(
        Array.isArray(fRaw) ? fRaw : Array.isArray(fRaw?.data) ? fRaw.data : []
      );
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      logger.error('[ModelTypesSettings] load failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (t: ModelType) => {
    setEditing(t);
    setFormData({
      slug: t.slug,
      name: t.name,
      description: t.description ?? '',
      category: t.category,
      defaultApiFormat: t.defaultApiFormat ?? '',
      displayOrder: t.displayOrder,
      isEnabled: t.isEnabled,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setFormData(EMPTY_FORM);
  };

  const save = async () => {
    if (!formData.slug.trim() || !formData.name.trim()) {
      setError('slug 和 name 必填');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const url = editing
        ? `${config.apiUrl}/admin/model-types/${editing.id}`
        : `${config.apiUrl}/admin/model-types`;
      const method = editing ? 'PATCH' : 'POST';
      const payload = {
        slug: formData.slug.trim(),
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        category: formData.category,
        defaultApiFormat: formData.defaultApiFormat.trim() || undefined,
        displayOrder: formData.displayOrder,
        isEnabled: formData.isEnabled,
      };
      const res = await fetch(url, {
        method,
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
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
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: ModelType) => {
    if (
      !(await confirm({
        title: `确认删除 ModelType "${t.name}"？`,
        type: 'danger',
      }))
    )
      return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${config.apiUrl}/admin/model-types/${t.id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Delete failed (${res.status}): ${body}`);
      }
      setSuccess(`已删除 ${t.slug}`);
      await load();
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

      {/* 2026-05-11: 删冗余内页标题（drawer + tab 已表达），仅保留操作按钮 */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          添加 ModelType
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[12%]" />
            <col className="w-[18%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Slug
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                名称
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                分类
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                默认 ApiFormat
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                类型
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {/* 2026-05-11: 单行不换行 + 长内容 truncate + title 提示 */}
            {items.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="font-mono whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                  <TruncatedCell className="max-w-[160px] text-gray-900">
                    {t.slug}
                  </TruncatedCell>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                  <TruncatedCell className="max-w-[160px] text-gray-900">
                    {t.name}
                  </TruncatedCell>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                  {t.category}
                </td>
                <td className="font-mono whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                  {t.defaultApiFormat ?? '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {t.isBuiltin ? (
                    <span className="inline-flex whitespace-nowrap rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                      内置
                    </span>
                  ) : (
                    <span className="inline-flex whitespace-nowrap rounded-full bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                      自定义
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    className="mr-2 inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </button>
                  {!t.isBuiltin && (
                    <button
                      type="button"
                      onClick={() => remove(t)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {editing ? `编辑 ModelType: ${editing.slug}` : '添加 ModelType'}
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
                    disabled={editing?.isBuiltin}
                    placeholder="VIDEO_GENERATION"
                    className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500">UPPER_SNAKE_CASE</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="视频生成"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    分类
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    默认 ApiFormat
                  </label>
                  <select
                    value={formData.defaultApiFormat}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        defaultApiFormat: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">（无）</option>
                    {apiFormats.map((f) => (
                      <option key={f.slug} value={f.slug}>
                        {f.name}
                      </option>
                    ))}
                  </select>
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
