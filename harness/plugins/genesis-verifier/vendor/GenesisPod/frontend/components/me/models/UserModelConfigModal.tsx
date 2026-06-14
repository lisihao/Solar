'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { UserModelIdSelector } from './UserModelIdSelector';
import {
  type UserModelConfig,
  type UserModelType,
  USER_MODEL_TYPE_OPTIONS,
  useUserModelConfigs,
  type CreateUserModelConfigInput,
} from '@/hooks/features/useUserModelConfigs';
import { useUserApiKeys } from '@/hooks/features/useUserApiKeys';

interface Props {
  provider: string;
  /** 表单里当前 API Key（从外层传入，用于「获取可用模型」按钮实时调 provider） */
  apiKey: string;
  apiEndpoint?: string;
  /** 传入则编辑，否则新增 */
  initial?: UserModelConfig | null;
  onClose: () => void;
  onSaved?: () => void;
}

const API_FORMAT_OPTIONS = [
  {
    value: 'openai',
    label: 'OpenAI 兼容 (默认，适合 OpenAI/DeepSeek/xAI/Groq…)',
  },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'cohere', label: 'Cohere' },
];

const TOKEN_PARAM_OPTIONS = [
  { value: 'max_tokens', label: 'max_tokens (多数模型)' },
  {
    value: 'max_completion_tokens',
    label: 'max_completion_tokens (o1/gpt-5 推理系列)',
  },
];
const CUSTOM_SLUG = '__custom__';

/** 把任意字符串规整成合法 provider slug（后端要求 /^[a-z0-9-]+$/）。 */
function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 归一化 API Endpoint 存成干净 base：剥掉用户常误填的尾部 path
 * （/models 列表端点、/chat/completions、/messages、/embeddings）和尾斜杠，
 * 让下游 ensure*Path 各自拼正确路径，避免 .../v1/models/chat/completions 这种 404。
 */
function normalizeEndpointBase(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(models|chat\/completions|messages|embeddings)$/, '');
}

/** 从 API Endpoint 主机名推导自定义 provider slug，如 https://api.tokenmix.ai/v1 → tokenmix。 */
function deriveSlugFromEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    const host = u.hostname
      .toLowerCase()
      .replace(/^(api|gateway|gw|llm|chat|openai)\./, '');
    return sanitizeSlug(host.split('.')[0] ?? '');
  } catch {
    return '';
  }
}

export function UserModelConfigModal({
  provider: initialProvider,
  apiKey,
  apiEndpoint,
  initial,
  onClose,
  onSaved,
}: Props) {
  const { create, update, mutating } = useUserModelConfigs();
  const {
    keys: userKeys,
    providers,
    loading: providersLoading,
  } = useUserApiKeys();
  const isEdit = !!initial;

  // Provider 预设：单一数据源 = DB ai_providers（经 /user/api-keys 返回），
  // 取代此前硬编码的 KNOWN_PROVIDERS。新增内置 provider 走 seed catalog，前端自动出现。
  const knownProviders = useMemo(
    () =>
      providers.map((p) => ({
        slug: p.id,
        label: p.name,
        endpoint: p.endpoint,
        apiFormat: p.apiFormat || 'openai',
      })),
    [providers]
  );

  // Provider（新增时可选；编辑时固定为 initial.provider）
  const [provider, setProvider] = useState(
    initial?.provider ?? initialProvider
  );
  // 表单字段
  const [modelType, setModelType] = useState<UserModelType>(
    initial?.modelType ?? 'CHAT'
  );
  const [modelId, setModelId] = useState(initial?.modelId ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  // ★ 2026-06-11 修"编辑时 Endpoint 错误"：存量行 apiEndpoint 可能含完整路径
  //   （…/v1/chat/completions，下游 ensure*Path 会双拼成 404）。回显时归一化为干净
  //   base，与保存路径（normalizeEndpointBase）一致；保存即把坏值修正回 base。
  const [endpoint, setEndpoint] = useState(
    normalizeEndpointBase(initial?.apiEndpoint ?? '')
  );
  // 2026-05-27 BYOK：该模型运行时使用哪把用户 Key（UserApiKey.id），空 = provider 默认
  const [apiKeyId, setApiKeyId] = useState(initial?.apiKeyId ?? '');
  const [maxTokens, setMaxTokens] = useState(
    String(initial?.maxTokens ?? 4096)
  );
  const [temperature, setTemperature] = useState(
    String(initial?.temperature ?? 0.7)
  );
  const [apiFormat, setApiFormat] = useState(initial?.apiFormat ?? 'openai');
  const [isReasoning, setIsReasoning] = useState(initial?.isReasoning ?? false);
  const [supportsTemperature, setSupportsTemperature] = useState(
    initial?.supportsTemperature ?? true
  );
  const [supportsStreaming, setSupportsStreaming] = useState(
    initial?.supportsStreaming ?? true
  );
  const [supportsFunctionCalling, setSupportsFunctionCalling] = useState(
    initial?.supportsFunctionCalling ?? true
  );
  const [supportsVision, setSupportsVision] = useState(
    initial?.supportsVision ?? false
  );
  const [tokenParamName, setTokenParamName] = useState(
    initial?.tokenParamName ?? 'max_tokens'
  );
  const [priority, setPriority] = useState(String(initial?.priority ?? 50));
  const [isEnabled, setIsEnabled] = useState(initial?.isEnabled ?? true);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [rpmLimit, setRpmLimit] = useState(
    initial?.rpmLimit != null ? String(initial.rpmLimit) : ''
  );
  const [tpmLimit, setTpmLimit] = useState(
    initial?.tpmLimit != null ? String(initial.tpmLimit) : ''
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 用户是否手动动过能力字段；一旦动过就停止自动推断，尊重用户选择
  const [reasoningTouched, setReasoningTouched] = useState(false);

  // 自动推断：只在新建 + 用户还没手动改过能力字段时触发
  // 避免"改个 modelId 就把用户刚调好的设置重置"
  useEffect(() => {
    if (isEdit || reasoningTouched || !modelId) return;
    const lower = modelId.toLowerCase();
    const looksReasoning =
      lower.startsWith('o1') ||
      lower.startsWith('o3') ||
      lower.startsWith('o4') ||
      lower.includes('gpt-5') ||
      lower.includes('reasoner');
    if (looksReasoning) {
      setIsReasoning(true);
      setTokenParamName('max_completion_tokens');
      setSupportsTemperature(false);
    } else {
      // 如果用户一开始输了推理模型 ID，后来改成普通模型 ID，自动恢复默认
      setIsReasoning(false);
      setTokenParamName('max_tokens');
      setSupportsTemperature(true);
    }
  }, [modelId, isEdit, reasoningTouched]);

  // 新建时自动带出预设 endpoint + apiFormat。
  // 覆盖两种时机：① 初始挂载（provider 来自 initialProvider）② providers 异步加载完成。
  // 之前自动填只写在 select 的 onChange 里 → 初始 provider 不触发 → endpoint 空白
  // （需手动换一个再换回来才填上）。仅在 endpoint 为空时填，不覆盖用户手填/自定义。
  useEffect(() => {
    if (isEdit) return;
    const preset = knownProviders.find((p) => p.slug === provider);
    if (preset && !endpoint) {
      setEndpoint(preset.endpoint);
      setApiFormat(preset.apiFormat);
    }
  }, [knownProviders, provider, isEdit, endpoint]);

  const canSave = useMemo(
    () => !!(modelId.trim() && displayName.trim() && provider.trim()),
    [modelId, displayName, provider]
  );

  // Provider 下拉的「已知 / 自定义」判定 —— 必须考虑 providers 异步加载：
  // 加载未完成时不能把已知 provider（如 cohere）误判为「其它/自定义」而强制手填。
  const providerInList = knownProviders.some((p) => p.slug === provider);
  const treatProviderAsCustom =
    provider === '' ||
    (!providersLoading && knownProviders.length > 0 && !providerInList);
  const providerSelectValue = providerInList
    ? provider
    : treatProviderAsCustom
      ? CUSTOM_SLUG
      : provider;

  // 自定义供应商：slug 留空时从 API Endpoint 主机名自动推导（可编辑），
  // 否则保存会撞后端 /^[a-z0-9-]+$/ 校验报"provider must match"。仅新建 + 自定义 + 当前为空时填。
  useEffect(() => {
    if (isEdit) return;
    if (!treatProviderAsCustom) return;
    if (provider.trim()) return;
    const slug = deriveSlugFromEndpoint(endpoint);
    if (slug) setProvider(slug);
  }, [endpoint, treatProviderAsCustom, provider, isEdit]);

  const buildPayload = (): CreateUserModelConfigInput => ({
    provider,
    modelId: modelId.trim(),
    displayName: displayName.trim(),
    modelType,
    apiEndpoint: normalizeEndpointBase(endpoint) || null,
    apiKeyId: apiKeyId.trim() || null,
    maxTokens: Number(maxTokens) || 4096,
    temperature: Number(temperature) || 0.7,
    apiFormat,
    isReasoning,
    supportsTemperature,
    supportsStreaming,
    supportsFunctionCalling,
    supportsVision,
    tokenParamName,
    defaultTimeoutMs: initial?.defaultTimeoutMs ?? 120000,
    priority: Number(priority) || 50,
    isEnabled,
    isDefault,
    description: description.trim() || null,
    priceInputPerMillion: null,
    priceOutputPerMillion: null,
    embeddingDimensions: null,
    maxInputTokens: null,
    rpmLimit: rpmLimit.trim() ? Number(rpmLimit) || null : null,
    tpmLimit: tpmLimit.trim() ? Number(tpmLimit) || null : null,
  });

  const handleSave = async () => {
    const payload = buildPayload();
    const ok = isEdit
      ? await update(initial.id, payload)
      : !!(await create(payload));
    if (ok) {
      onSaved?.();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlayClick={false}
      size="2xl"
      title={isEdit ? '编辑模型配置' : '添加模型配置'}
      subtitle={`provider: ${provider}`}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            disabled={!canSave || mutating}
            onClick={handleSave}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {mutating ? '保存中...' : isEdit ? '保存' : '添加'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 1. 显示名 — 最顶部 */}
        <Field label="显示名" required>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例如：My GPT-4o mini"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>

        {/* 2. Provider — 预设 SELECT + 自定义输入 */}
        <Field label="Provider" required>
          {isEdit ? (
            <input
              value={provider}
              disabled
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
            />
          ) : (
            <>
              <select
                value={providerSelectValue}
                onChange={(e) => {
                  const slug = e.target.value;
                  if (slug === CUSTOM_SLUG) {
                    setProvider('');
                    setEndpoint('');
                    setApiFormat('openai');
                  } else {
                    const preset = knownProviders.find((p) => p.slug === slug);
                    if (preset) {
                      setProvider(preset.slug);
                      setEndpoint(preset.endpoint);
                      setApiFormat(preset.apiFormat);
                    }
                  }
                }}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  -- 选择供应商 --
                </option>
                {/* providers 还在加载、当前 provider 尚未进列表：补一个临时 option，
                    避免 select 落到空值/误显「其它/自定义」 */}
                {provider && !providerInList && !treatProviderAsCustom && (
                  <option value={provider}>{provider}</option>
                )}
                {knownProviders.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_SLUG}>其它 / 自定义...</option>
              </select>
              {treatProviderAsCustom && (
                <input
                  value={provider}
                  onChange={(e) => setProvider(sanitizeSlug(e.target.value))}
                  placeholder="自定义 slug（小写字母/数字/连字符），例如 tokenmix / my-proxy"
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              )}
            </>
          )}
        </Field>

        {/* 3. API Endpoint — 知名供应商自动填，自定义为空 */}
        <Field label="API Endpoint">
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="知名供应商自动填写；自定义时手动输入"
            className="font-mono w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>

        {/* 3b. 使用的 BYOK Key — 用户自己存的全部密钥（不限 provider）*/}
        <Field label="使用 Key（选择你的 BYOK 密钥）">
          {userKeys.filter((k) => k.isActive).length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <span>暂无已保存的密钥</span>
              <a
                href="/me/api-keys"
                className="font-medium underline hover:text-amber-900"
              >
                前往「我的 API Keys」添加
              </a>
            </div>
          ) : (
            <select
              value={apiKeyId}
              onChange={(e) => setApiKeyId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">-- 选择 BYOK 密钥 --</option>
              {userKeys
                .filter((k) => k.isActive)
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.provider} · {k.label}（{k.keyHint}）
                  </option>
                ))}
            </select>
          )}
        </Field>

        {/* 4. 模型类型 */}
        <Field label="模型类型" required>
          <select
            value={modelType}
            onChange={(e) => setModelType(e.target.value as UserModelType)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {USER_MODEL_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.description}
              </option>
            ))}
          </select>
        </Field>

        {/* 5. Model ID + 获取 */}
        <UserModelIdSelector
          provider={provider}
          apiKey={apiKey}
          apiKeyId={apiKeyId}
          apiEndpoint={endpoint || apiEndpoint}
          modelType={modelType}
          value={modelId}
          onChange={(v) => {
            setModelId(v);
            if (!displayName) setDisplayName(v);
          }}
        />

        {/* 6. Max Tokens + 推理模型（直接露出，常用）*/}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max Tokens">
            <input
              type="number"
              min={1}
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </Field>
          <div className="flex items-end pb-1">
            <Toggle
              label="推理模型"
              description="o1 / o3 / DeepSeek-R1 等"
              value={isReasoning}
              onChange={(v) => {
                setIsReasoning(v);
                setReasoningTouched(true);
              }}
            />
          </div>
        </div>

        {/* ▸ 高级设置折叠 */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          {showAdvanced ? '▾' : '▸'} 高级设置
        </button>

        {showAdvanced && (
          <div className="space-y-4 rounded-md bg-gray-50 p-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Temperature">
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  disabled={!supportsTemperature}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                />
              </Field>
              <Field label="优先级 (0–100)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Toggle
                label="作为该类型的默认模型"
                description="优先路由此模型"
                value={isDefault}
                onChange={setIsDefault}
              />
              <Toggle
                label="启用"
                description="关闭后不会被路由选中"
                value={isEnabled}
                onChange={setIsEnabled}
              />
              <Toggle
                label="支持 Temperature"
                description="推理系列通常不支持"
                value={supportsTemperature}
                onChange={(v) => {
                  setSupportsTemperature(v);
                  setReasoningTouched(true);
                }}
              />
              <Toggle
                label="支持流式输出"
                value={supportsStreaming}
                onChange={setSupportsStreaming}
              />
              <Toggle
                label="支持 Function Calling"
                value={supportsFunctionCalling}
                onChange={setSupportsFunctionCalling}
              />
              <Toggle
                label="支持视觉输入"
                description="可接收图片输入"
                value={supportsVision}
                onChange={setSupportsVision}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="API Format">
                <select
                  value={apiFormat}
                  onChange={(e) => setApiFormat(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  {API_FORMAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Token Param Name">
                <select
                  value={tokenParamName}
                  onChange={(e) => {
                    setTokenParamName(e.target.value);
                    setReasoningTouched(true);
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  {TOKEN_PARAM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="RPM (请求/分钟)">
                <input
                  type="number"
                  min={1}
                  value={rpmLimit}
                  onChange={(e) => setRpmLimit(e.target.value)}
                  placeholder="留空 = 启发式默认"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </Field>
              <Field label="TPM (Token/分钟)">
                <input
                  type="number"
                  min={1}
                  value={tpmLimit}
                  onChange={(e) => setTpmLimit(e.target.value)}
                  placeholder="留空 = 启发式默认"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </Field>
            </div>

            <Field label="描述（可选）">
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md bg-white p-2">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
      <div>
        <div className="text-sm text-gray-900">{label}</div>
        {description && (
          <div className="text-xs text-gray-500">{description}</div>
        )}
      </div>
    </label>
  );
}
