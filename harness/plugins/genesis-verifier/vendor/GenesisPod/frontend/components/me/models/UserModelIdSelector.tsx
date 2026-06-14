'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

interface DiscoveredModel {
  id: string;
  name?: string;
  description?: string;
}

interface Props {
  provider: string;
  /** 用户当前表单里输入的 API Key。留空时后端回退到 apiKeyId / Personal Key。 */
  apiKey: string;
  /** 「使用 Key」下拉选定的 BYOK 密钥 id；传给后端用同一把 key 拉列表，
   *  使预览与运行时实际用的 key 一致。 */
  apiKeyId?: string;
  apiEndpoint?: string;
  /** 过滤模型类型；默认 CHAT */
  modelType?: string;
  value: string;
  onChange: (modelId: string) => void;
}

/**
 * 用户端模型选择：点「获取可用模型」按钮，调 /user/api-keys/:provider/available-models，
 * 后端用当前输入的 API Key（或已保存的 Personal Key）去 provider 的 /v1/models 拉真实列表。
 *
 * 用法与管理员 AIModelSettings 的 ModelIdSelector 一致，只是 scope 到当前用户。
 */
export function UserModelIdSelector({
  provider,
  apiKey,
  apiKeyId,
  apiEndpoint,
  modelType = 'CHAT',
  value,
  onChange,
}: Props) {
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchModels = useCallback(async () => {
    // 自定义供应商靠 apiEndpoint 即可拉模型，无需 provider slug。
    // 但 available-models 路由需要一个路径段（空段会拼出 /user/api-keys//available-models
    // → "Cannot POST" 404），故 slug 缺失时回退 "custom"。仅当 provider 与 endpoint 都空才拦。
    if (!provider.trim() && !apiEndpoint?.trim()) {
      setError('请选择 Provider，或填写 API Endpoint（自定义供应商）');
      return;
    }
    const providerSlug = provider.trim() || 'custom';
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `${config.apiUrl}/user/api-keys/${providerSlug}/available-models`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({
            apiKey: apiKey || undefined,
            apiKeyId: apiKeyId || undefined,
            apiEndpoint: apiEndpoint || undefined,
            modelType,
          }),
        }
      );
      const json = await resp.json();
      const data = json?.data ?? json;
      if (!resp.ok) {
        setError(data?.message || '获取模型列表失败');
        return;
      }
      if (data?.success && Array.isArray(data.models)) {
        setModels(data.models);
        setHasFetched(true);
        if (data.models.length === 0) {
          setError(data.error || `该 Provider 未返回任何 ${modelType} 模型`);
        }
      } else if (Array.isArray(data?.models)) {
        setModels(data.models);
        setHasFetched(true);
      } else {
        setError(data?.error || '获取失败');
      }
    } catch (e) {
      setError((e as Error).message || '网络错误');
    } finally {
      setLoading(false);
    }
  }, [provider, apiKey, apiKeyId, apiEndpoint, modelType]);

  // 切换 provider / modelType / 选定 key 时清空已拉取结果
  useEffect(() => {
    setModels([]);
    setHasFetched(false);
    setError(null);
  }, [provider, modelType, apiKeyId]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        选用模型 (Model ID)
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例如：gpt-4o-mini / claude-3-5-sonnet-20241022"
          className="font-mono flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={fetchModels}
          disabled={loading || (!provider.trim() && !apiEndpoint?.trim())}
          className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          获取
        </button>
      </div>

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      {hasFetched && models.length > 0 && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-600">
            可用模型 ({models.length}) - 点击选择：
          </p>
          <div className="flex flex-wrap gap-2">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(m.id)}
                title={m.description || m.name}
                className={`font-mono rounded-md border px-2 py-1 text-xs transition-colors ${
                  value === m.id
                    ? 'border-blue-500 bg-blue-100 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                {m.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasFetched && !error && (
        <p className="mt-1 text-xs text-gray-500">
          输入上方 API Key 后点击「获取」，用你自己的 Key 从 Provider
          实时拉取可用模型列表
        </p>
      )}
    </div>
  );
}
