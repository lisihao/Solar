'use client';

/**
 * ProviderDiscoverModal —— 2026-05-11 P9 (BYOK AI 一键配置)
 *
 * admin 填入 endpoint + apiKey + provider hint，调 POST /admin/ai-models/discover
 * 拿到候选模型列表（启发式推断 modelType），UI 勾选 + 手动覆盖 modelType 后
 * 由父组件批量创建 AIModel 行。
 *
 * 风格：light-only + Lucide + 与现有 admin/ai-config Modal 一致。
 */

import { useState } from 'react';
import { Sparkles, X, Loader2, Search, Check } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

interface DiscoveredModel {
  modelId: string;
  guessedModelType: string;
  category: string;
}

interface DiscoverPayload {
  /** Provider slug (kebab-case)。一键配置时 upsert ai_providers 行 */
  providerSlug: string;
  /** Provider 显示名 */
  providerName: string;
  endpoint: string;
  apiKey: string;
  apiFormat: string;
  /** admin 勾选并可手动改了 modelType 后的最终列表 */
  selected: Array<{ modelId: string; modelType: string }>;
}

const MODEL_TYPE_OPTIONS = [
  'CHAT',
  'CHAT_FAST',
  'CODE',
  'IMAGE_GENERATION',
  'IMAGE_EDITING',
  'MULTIMODAL',
  'EMBEDDING',
  'RERANK',
  'EVALUATOR',
  'TTS',
  'AUDIO',
];

export function ProviderDiscoverModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: DiscoverPayload) => Promise<void> | void;
}) {
  const [providerSlug, setProviderSlug] = useState('');
  const [providerName, setProviderName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiFormat, setApiFormat] = useState('openai');
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  if (!open) return null;

  const discover = async () => {
    if (!endpoint.trim() || !apiKey.trim()) {
      setError('endpoint 和 apiKey 必填');
      return;
    }
    setDiscovering(true);
    setError(null);
    setDiscovered([]);
    setSelected({});
    try {
      const res = await fetch(`${config.apiUrl}/admin/ai-models/discover`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          apiKey: apiKey.trim(),
          apiFormat,
        }),
      });
      const raw = await res.json();
      if (!res.ok) {
        throw new Error(raw?.message || `HTTP ${res.status}`);
      }
      // 后端全局 ResponseTransformInterceptor 包 { success, data, metadata }，解一层
      const payload = raw?.data ?? raw;
      if (payload?.warning) {
        setError(payload.warning);
      }
      const models: DiscoveredModel[] = Array.isArray(payload?.models)
        ? payload.models
        : [];
      setDiscovered(models);
      // 默认全选
      const init: Record<string, string> = {};
      for (const m of models) {
        init[m.modelId] = m.guessedModelType;
      }
      setSelected(init);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiscovering(false);
    }
  };

  const toggle = (modelId: string, modelType: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[modelId]) {
        delete next[modelId];
      } else {
        next[modelId] = modelType;
      }
      return next;
    });
  };

  const changeModelType = (modelId: string, modelType: string) => {
    setSelected((prev) => ({ ...prev, [modelId]: modelType }));
  };

  const confirm = async () => {
    if (!providerSlug.trim() || !providerName.trim()) {
      setError('Provider slug 和 显示名 必填（用于 upsert ai_providers 行）');
      return;
    }
    if (!/^[a-z0-9-]+$/.test(providerSlug.trim())) {
      setError('Provider slug 只允许小写字母、数字、连字符（kebab-case）');
      return;
    }
    const selectedList = Object.entries(selected).map(
      ([modelId, modelType]) => ({
        modelId,
        modelType,
      })
    );
    if (selectedList.length === 0) {
      setError('请至少选一个模型');
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      await onConfirm({
        providerSlug: providerSlug.trim(),
        providerName: providerName.trim(),
        endpoint: endpoint.trim(),
        apiKey: apiKey.trim(),
        apiFormat,
        selected: selectedList,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Sparkles className="h-5 w-5 text-blue-600" />
            AI 一键配置 Provider
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-600">
          填入 endpoint + apiKey，后端 GET <code>/v1/models</code> 拉模型列表 +
          按 name pattern 启发式推断 modelType，你确认后批量创建 AIModel 行。零
          LLM 调用成本。
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Input row */}
        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Provider Slug <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={providerSlug}
                onChange={(e) =>
                  setProviderSlug(e.target.value.toLowerCase().trim())
                }
                placeholder="together-ai"
                className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-0.5 text-[10px] text-gray-500">
                kebab-case 唯一标识，将 upsert 到 ai_providers
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Provider 显示名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="Together AI"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Endpoint Base URL <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.together.xyz/v1"
                className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                API Format
              </label>
              <select
                value={apiFormat}
                onChange={(e) => setApiFormat(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="google">google</option>
                <option value="cohere">cohere</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={discover}
              disabled={discovering || !endpoint.trim() || !apiKey.trim()}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {discovering ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              探测可用模型
            </button>
          </div>
        </div>

        {/* Discovered models */}
        {discovered.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">
                发现 {discovered.length} 个模型（已勾选{' '}
                {Object.keys(selected).length} 个）
              </h4>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const all: Record<string, string> = {};
                    for (const m of discovered)
                      all[m.modelId] = m.guessedModelType;
                    setSelected(all);
                  }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="text-xs text-gray-500 hover:underline"
                >
                  全清
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      勾选
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      Model ID
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                      Model Type（可手动改）
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {discovered.map((m) => (
                    <tr key={m.modelId} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => toggle(m.modelId, m.guessedModelType)}
                          className={`flex h-5 w-5 items-center justify-center rounded border ${
                            selected[m.modelId]
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-gray-300 bg-white'
                          }`}
                        >
                          {selected[m.modelId] && <Check className="h-3 w-3" />}
                        </button>
                      </td>
                      <td className="font-mono px-3 py-2 text-xs text-gray-900">
                        {m.modelId}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={selected[m.modelId] ?? m.guessedModelType}
                          onChange={(e) =>
                            changeModelType(m.modelId, e.target.value)
                          }
                          disabled={!selected[m.modelId]}
                          className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                        >
                          {MODEL_TYPE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          {discovered.length > 0 && (
            <button
              type="button"
              onClick={confirm}
              disabled={confirming || Object.keys(selected).length === 0}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {confirming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              批量创建 {Object.keys(selected).length} 个模型
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
