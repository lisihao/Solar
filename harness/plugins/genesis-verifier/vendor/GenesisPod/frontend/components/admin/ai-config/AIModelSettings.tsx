'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Brain,
  Eye,
  EyeOff,
  Search,
  RefreshCw,
  Loader2,
  Zap,
  Star,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { useAdminSecrets } from '@/hooks/domain/useAdminSecrets';
import { TruncatedCell } from '@/components/common/tables';
import { getProviderBrand } from '@/lib/constants/ai-provider-logos';

import { logger } from '@/lib/utils/logger';
import { ClientDate } from '@/components/common/ClientDate';
import { StructuredOutputCapabilitySection } from './StructuredOutputCapabilitySection';
import { useAdminAIProviders } from '@/hooks/domain/useAdminAIProviders';
import { ModelEndpointWarning } from './ModelEndpointWarning';
import { confirm } from '@/stores';
// AI模型类型枚举 - 支持 Tier 分级
type AIModelType =
  | 'CHAT'
  | 'CHAT_FAST'
  | 'CODE'
  | 'IMAGE_GENERATION'
  | 'IMAGE_EDITING'
  | 'MULTIMODAL'
  | 'EMBEDDING'
  | 'RERANK'
  | 'EVALUATOR';

// 模型类型选项 - 按 Tier 分组
const MODEL_TYPE_OPTIONS = [
  // === 文本聊天 Tier ===
  {
    value: 'CHAT',
    label: '标准聊天',
    description: 'GPT-4, Claude, Gemini Pro 等 - 用于复杂对话和深度分析',
    tier: 'text',
  },
  {
    value: 'CHAT_FAST',
    label: '快速聊天',
    description:
      'GPT-4o-mini, Claude Haiku, Gemini Flash 等 - 用于分类、翻译、摘要等低成本任务',
    tier: 'text',
  },
  // === 代码 Tier ===
  {
    value: 'CODE',
    label: '代码生成',
    description:
      'Claude Sonnet, GPT-4o, Codestral, DeepSeek Coder 等 - 用于代码生成、补全和分析',
    tier: 'text',
  },
  // === 图片处理 Tier ===
  {
    value: 'IMAGE_GENERATION',
    label: '图片生成',
    description: 'DALL-E 3, Imagen 4, Midjourney 等',
    tier: 'image',
  },
  {
    value: 'IMAGE_EDITING',
    label: '图片编辑',
    description: 'Imagen 3, DALL-E 2 edit 等',
    tier: 'image',
  },
  // === 多模态 Tier ===
  {
    value: 'MULTIMODAL',
    label: '多模态',
    description: 'Gemini 2.0 Flash - 同时支持文本和图片',
    tier: 'multimodal',
  },
  // === 向量和检索 Tier ===
  {
    value: 'EMBEDDING',
    label: '向量嵌入',
    description: 'text-embedding-3-small/large - 用于知识库向量化',
    tier: 'embedding',
  },
  {
    value: 'RERANK',
    label: '重排序',
    description: 'Cohere rerank - 用于搜索结果重排序',
    tier: 'embedding',
  },
  // === 评估 Tier ===
  {
    value: 'EVALUATOR',
    label: '报告评审',
    description: '报告质量 10 维评审专用 - 确保跨报告评分一致性',
    tier: 'text',
  },
];

interface AIModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  modelType: AIModelType;
  displayName: string;
  icon: string;
  color: string;
  apiEndpoint: string;
  apiKey: string | null;
  secretKey: string | null; // 引用 Secret Manager 中的密钥名称
  hasApiKey: boolean;
  isEnabled: boolean;
  isDefault: boolean;
  isReasoning: boolean; // 是否为推理模型 (o1, o3, gpt-5, deepseek-r1)
  maxTokens: number;
  temperature: number;
  description: string | null;
  // Embedding 模型专用参数
  embeddingDimensions?: number;
  maxInputTokens?: number;
  // ★ 模型能力配置 - 消除硬编码，完全由数据库驱动
  apiFormat?: string; // openai | anthropic | google | xai | cohere
  supportsTemperature?: boolean;
  supportsStreaming?: boolean;
  supportsFunctionCalling?: boolean;
  supportsVision?: boolean;
  tokenParamName?: string; // max_tokens | max_completion_tokens
  defaultTimeoutMs?: number;
  priceInputPerMillion?: number;
  priceOutputPerMillion?: number;
  priority?: number;
  // ★ Structured Output capability matrix (2026-05-06)
  structuredOutputStrategy?: string | null;
  fallbackStrategies?: string[];
  supportsJsonSchemaStrict?: boolean;
  supportsJsonSchema?: boolean;
  supportsToolUse?: boolean;
  supportsJsonMode?: boolean;
  supportsGbnfGrammar?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TestResult {
  success: boolean;
  message: string;
  latency?: number;
}

interface DiagnoseResult {
  timestamp: string;
  models: Array<{
    id: string;
    name: string;
    displayName: string;
    provider: string;
    modelId: string;
    apiEndpoint: string;
    isEnabled: boolean;
    isDefault: boolean;
    hasApiKey: boolean;
    apiKeyLength: number;
    apiKeyPrefix: string | null;
    maxTokens: number;
    temperature: number;
    updatedAt: string;
  }>;
  summary: {
    total: number;
    enabled: number;
    withApiKey: number;
    ready: number;
  };
}

// Map model names to their icon URLs
const MODEL_ICONS: Record<string, string> = {
  grok: '/icons/ai/grok.svg',
  'gpt-4': '/icons/ai/openai.svg',
  claude: '/icons/ai/claude.svg',
  gemini: '/icons/ai/gemini.svg',
  groq: '/icons/ai/groq.svg',
  openrouter: '/icons/ai/openrouter.svg',
  minimax: '/icons/ai/minimax.svg',
  deepseek: '/icons/ai/deepseek.svg',
  qwen: '/icons/ai/qwen.svg',
  doubao: '/icons/ai/doubao.svg',
  zhipu: '/icons/ai/zhipu.svg',
  kimi: '/icons/ai/kimi.svg',
};

// Standard model configurations with defaults
const STANDARD_MODEL_CONFIGS = [
  {
    id: 'grok',
    name: 'Grok (xAI)',
    provider: 'xAI',
    defaultModelId: 'grok-3-latest',
    defaultEndpoint: 'https://api.x.ai/v1/chat/completions',
    icon: '/icons/ai/grok.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'gpt-4',
    name: 'ChatGPT (OpenAI)',
    provider: 'OpenAI',
    defaultModelId: 'gpt-4-turbo',
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    icon: '/icons/ai/openai.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    provider: 'Anthropic',
    defaultModelId: 'claude-sonnet-4-20250514',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    icon: '/icons/ai/claude.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    provider: 'Google',
    defaultModelId: 'gemini-2.0-flash',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    icon: '/icons/ai/gemini.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'groq',
    name: 'Groq',
    provider: 'Groq',
    defaultModelId: 'llama-3.3-70b-versatile',
    defaultEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    icon: '/icons/ai/groq.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'OpenRouter',
    defaultModelId: '',
    defaultEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    icon: '/icons/ai/openrouter.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'minimax',
    name: 'MiniMax (稀宇科技)',
    provider: 'MiniMax',
    defaultModelId: 'MiniMax-Text-01',
    defaultEndpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2',
    icon: '/icons/ai/minimax.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek (深度求索)',
    provider: 'DeepSeek',
    defaultModelId: 'deepseek-chat',
    defaultEndpoint: 'https://api.deepseek.com/chat/completions',
    icon: '/icons/ai/deepseek.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'qwen',
    name: 'Qwen (通义千问)',
    provider: 'Alibaba',
    defaultModelId: 'qwen-plus',
    defaultEndpoint:
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    icon: '/icons/ai/qwen.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'doubao',
    name: 'Doubao (豆包)',
    provider: 'ByteDance',
    defaultModelId: '',
    defaultEndpoint:
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    icon: '/icons/ai/doubao.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'zhipu',
    name: 'GLM (智谱)',
    provider: 'Zhipu',
    defaultModelId: 'glm-4-plus',
    defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    icon: '/icons/ai/zhipu.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'kimi',
    name: 'Kimi (月之暗面)',
    provider: 'Moonshot',
    defaultModelId: 'moonshot-v1-128k',
    defaultEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
    icon: '/icons/ai/kimi.svg',
    defaultType: 'CHAT',
  },
  {
    id: 'embedding',
    name: 'OpenAI Embedding',
    provider: 'OpenAI',
    defaultModelId: 'text-embedding-3-small',
    defaultEndpoint: 'https://api.openai.com/v1/embeddings',
    icon: '/icons/ai/openai.svg',
    defaultType: 'EMBEDDING',
  },
  {
    id: 'google-embedding',
    name: 'Google Embedding',
    provider: 'Google',
    defaultModelId: 'text-embedding-004',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    icon: '/icons/ai/gemini.svg',
    defaultType: 'EMBEDDING',
  },
  {
    id: 'rerank',
    name: 'Cohere Rerank',
    provider: 'Cohere',
    defaultModelId: 'rerank-v3.5',
    defaultEndpoint: 'https://api.cohere.com/v2/rerank',
    icon: '',
    defaultType: 'RERANK',
  },
] as const;

type ModelConfig = (typeof STANDARD_MODEL_CONFIGS)[number];

function getModelIdPlaceholder(modelName: string): string | undefined {
  const config = STANDARD_MODEL_CONFIGS.find((m) => m.id === modelName);
  return (config as (ModelConfig & { modelIdPlaceholder?: string }) | undefined)
    ?.modelIdPlaceholder;
}

function getModelIconUrl(modelName: string): string | null {
  const name = modelName.toLowerCase();
  // 直接匹配
  if (MODEL_ICONS[name]) {
    return MODEL_ICONS[name];
  }
  // 支持带后缀的名称匹配 (如 "gpt-4 #1" -> "gpt-4")
  const baseName = name.replace(/\s*#\d+$/, '').trim();
  if (MODEL_ICONS[baseName]) {
    return MODEL_ICONS[baseName];
  }
  // 模糊匹配 - 检查是否包含已知的模型名
  for (const key of Object.keys(MODEL_ICONS)) {
    if (name.includes(key)) {
      return MODEL_ICONS[key];
    }
  }
  return null;
}

// 根据提供商和模型类型获取对应的 API 端点
function getEndpointForModelType(
  provider: string,
  modelType: AIModelType
): string {
  if (provider === 'OpenAI') {
    switch (modelType) {
      case 'EMBEDDING':
        return 'https://api.openai.com/v1/embeddings';
      case 'IMAGE_GENERATION':
      case 'IMAGE_EDITING':
        return 'https://api.openai.com/v1/images/generations';
      default:
        return 'https://api.openai.com/v1/chat/completions';
    }
  }
  if (provider === 'xAI') {
    switch (modelType) {
      case 'EMBEDDING':
        return 'https://api.x.ai/v1/embeddings';
      default:
        return 'https://api.x.ai/v1/chat/completions';
    }
  }
  if (provider === 'Anthropic') {
    return 'https://api.anthropic.com/v1/messages';
  }
  if (provider === 'Google') {
    switch (modelType) {
      case 'EMBEDDING':
        return 'https://generativelanguage.googleapis.com/v1beta';
      default:
        return 'https://generativelanguage.googleapis.com/v1beta/models';
    }
  }
  if (provider === 'Cohere') {
    switch (modelType) {
      case 'RERANK':
        return 'https://api.cohere.com/v2/rerank';
      case 'EMBEDDING':
        return 'https://api.cohere.com/v1/embed';
      default:
        return 'https://api.cohere.com/v1/chat';
    }
  }
  return '';
}

// Model ID Selector with fetch capability
// Shows all available models in a grid layout (no dropdown, no scrollbar)
function ModelIdSelector({
  value,
  onChange,
  provider,
  apiKey,
  secretKey,
  modelType,
  apiEndpoint,
  placeholder,
}: {
  value: string;
  onChange: (modelId: string) => void;
  provider: string;
  apiKey: string;
  secretKey?: string | null;
  modelType: AIModelType;
  /** 2026-05-11: 自定义/未硬编码 provider 走 backend default 分支时必须传 endpoint */
  apiEndpoint?: string;
  placeholder?: string;
}) {
  const [availableModels, setAvailableModels] = useState<
    Array<{ id: string; name: string; description?: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const isDoubao =
    provider.toLowerCase() === 'bytedance' ||
    provider.toLowerCase() === 'doubao';

  const fetchModels = async () => {
    if (!apiKey && !secretKey) {
      setError('请先输入 API Key 或选择 Secret');
      return;
    }
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/ai-models/fetch-available`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          // 2026-05-11: 自定义/未硬编码 provider（如 Voyage/Cohere/Jina）必须传
          // apiEndpoint，否则后端 switch 走 default 分支报 "Unknown provider"。
          body: JSON.stringify({
            provider,
            apiKey,
            secretKey,
            modelType,
            apiEndpoint,
          }),
        }
      );
      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      if (data.success && data.models) {
        setAvailableModels(data.models);
        setHasFetched(true);
        if (data.models.length === 0) {
          // If success but empty, show error message as hint (not error)
          if (data.error) {
            setHint(data.error);
          } else {
            setError(`该提供商没有可用的 ${modelType} 类型模型`);
          }
        } else if (
          provider.toLowerCase() === 'bytedance' ||
          provider.toLowerCase() === 'doubao'
        ) {
          setHint(
            '火山引擎需使用推理接入点 ID（ep-xxx）作为 Model ID，请在控制台创建接入点后填入'
          );
        }
      } else if (data.models) {
        // Direct models array format
        setAvailableModels(data.models);
        setHasFetched(true);
      } else {
        setError(data.error || '获取模型列表失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 当 modelType 变化时，清空已获取的模型列表
  useEffect(() => {
    setAvailableModels([]);
    setHasFetched(false);
    setError(null);
    setHint(null);
  }, [modelType]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        Model ID <span className="text-red-500">*</span>
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || 'gpt-4-turbo'}
          className="font-mono flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={fetchModels}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          )}
          获取
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-amber-600">{hint}</p>}

      {/* Show all models in a grid - no dropdown, no scrollbar */}
      {hasFetched && availableModels.length > 0 && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-600">
            {isDoubao
              ? `可用模型 (${availableModels.length}) - 仅供参考，请在火山引擎控制台创建接入点后填入 ep-xxx:`
              : `可用模型 (${availableModels.length}) - 点击选择:`}
          </p>
          <div className="flex flex-wrap gap-2">
            {availableModels.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => !isDoubao && onChange(model.id)}
                disabled={isDoubao}
                className={`font-mono rounded-md border px-2 py-1 text-xs transition-colors ${
                  isDoubao
                    ? 'cursor-default border-gray-200 bg-gray-100 text-gray-500'
                    : value === model.id
                      ? 'border-blue-500 bg-blue-100 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}
                title={model.description || model.name}
              >
                {model.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasFetched && (
        <p className="mt-1 text-xs text-gray-500">
          输入 API Key 后点击"获取"按钮可获取可用模型列表
        </p>
      )}
    </div>
  );
}

// Props interface
interface AIModelSettingsProps {
  showAddModal?: boolean;
  setShowAddModal?: (show: boolean) => void;
  onDiagnose?: () => void;
  /** 外部触发刷新的 key（一键 AI 配置完成后 +1） */
  refreshKey?: number;
}

export default function AIModelSettings({
  showAddModal: externalShowAddModal,
  setShowAddModal: externalSetShowAddModal,
  onDiagnose,
  refreshKey = 0,
}: AIModelSettingsProps = {}) {
  const [models, setModels] = useState<AIModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingModel, setEditingModel] = useState<AIModel | null>(null);
  const [internalShowAddModal, setInternalShowAddModal] = useState(false);
  const showAddModal = externalShowAddModal ?? internalShowAddModal;
  const setShowAddModal = externalSetShowAddModal ?? setInternalShowAddModal;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {}
  );
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showDiagnose, setShowDiagnose] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(
    null
  );
  const [diagnosing, setDiagnosing] = useState(false);

  // Memoize provider options for dropdown
  const providerOptions = useMemo(() => {
    const providerCounts: Record<string, number> = {};
    for (const m of models) {
      providerCounts[m.provider] = (providerCounts[m.provider] || 0) + 1;
    }
    return Object.entries(providerCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, count]) => ({ provider, count }));
  }, [models]);

  // Memoize filtered models to prevent recalculation on every render
  const filteredModels = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return models.filter((m) => {
      const matchesProvider =
        providerFilter === 'all' || m.provider === providerFilter;
      const matchesSearch =
        !term ||
        m.displayName.toLowerCase().includes(term) ||
        m.modelId.toLowerCase().includes(term) ||
        m.provider.toLowerCase().includes(term) ||
        m.name.toLowerCase().includes(term);
      return matchesProvider && matchesSearch;
    });
  }, [models, providerFilter, searchTerm]);

  // Reset filter when selected provider no longer exists
  useEffect(() => {
    if (
      providerFilter !== 'all' &&
      models.length > 0 &&
      !models.some((m) => m.provider === providerFilter)
    ) {
      setProviderFilter('all');
    }
  }, [models, providerFilter]);

  // Fetch models from API (also triggers on refreshKey bump from 一键 AI 配置)
  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${config.apiUrl}/admin/ai-models`, {
        headers: { ...getAuthHeader() },
      });
      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: [...] }
        const data = result?.data ?? result;
        setModels(Array.isArray(data) ? data : []);
        setError(null);
      } else if (response.status === 401 || response.status === 403) {
        setError('Please sign in as an admin to manage AI models');
      } else {
        setError('Failed to fetch AI models');
      }
    } catch (err) {
      logger.error('Failed to fetch AI models:', err);
      setError('Failed to fetch AI models');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnabled = async (model: AIModel) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/ai-models/${model.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ isEnabled: !model.isEnabled }),
        }
      );

      if (response.ok) {
        const updateResult = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const updated = updateResult?.data ?? updateResult;
        setModels(models.map((m) => (m.id === model.id ? updated : m)));
        setSuccess(
          `${model.displayName} ${!model.isEnabled ? 'enabled' : 'disabled'}`
        );
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      logger.error('Failed to update model:', err);
      setError('Failed to update model');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleSetDefault = async (model: AIModel) => {
    try {
      // 使用类型化的 API 端点，只在同类型模型中设置默认
      const response = await fetch(
        `${config.apiUrl}/admin/ai-models/${model.id}/set-type-default`,
        {
          method: 'POST',
          headers: { ...getAuthHeader() },
        }
      );

      if (response.ok) {
        // Refresh models to get updated default status
        await fetchModels();
        const typeLabel =
          MODEL_TYPE_OPTIONS.find((o) => o.value === model.modelType)?.label ||
          model.modelType;
        setSuccess(`${model.displayName} 已设为 ${typeLabel} 类型的默认模型`);
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      logger.error('Failed to set default:', err);
      setError('Failed to set default');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleSaveModel = async (model: AIModel, newApiKey?: string) => {
    setSaving(true);
    try {
      const updateData: Record<string, unknown> = {
        displayName: model.displayName,
        provider: model.provider,
        modelId: model.modelId,
        modelType: model.modelType,
        icon: model.icon,
        color: model.color,
        apiEndpoint: model.apiEndpoint,
        maxTokens: model.maxTokens,
        temperature: model.temperature,
        description: model.description,
        isReasoning: model.isReasoning,
        // ★ 新增：模型能力配置字段
        apiFormat: model.apiFormat,
        supportsTemperature: model.supportsTemperature,
        supportsStreaming: model.supportsStreaming,
        supportsFunctionCalling: model.supportsFunctionCalling,
        supportsVision: model.supportsVision,
        tokenParamName: model.tokenParamName,
        defaultTimeoutMs: model.defaultTimeoutMs,
        priceInputPerMillion: model.priceInputPerMillion,
        priceOutputPerMillion: model.priceOutputPerMillion,
        priority: model.priority,
        // ★ 新增：Secret Manager 引用
        secretKey: model.secretKey,
        // ★ Structured Output capability matrix (2026-05-06)
        structuredOutputStrategy: model.structuredOutputStrategy,
        fallbackStrategies: model.fallbackStrategies,
        supportsJsonSchemaStrict: model.supportsJsonSchemaStrict,
        supportsJsonSchema: model.supportsJsonSchema,
        supportsToolUse: model.supportsToolUse,
        supportsJsonMode: model.supportsJsonMode,
        supportsGbnfGrammar: model.supportsGbnfGrammar,
      };

      // Only send apiKey if it was changed
      if (newApiKey !== undefined && newApiKey !== '***configured***') {
        updateData.apiKey = newApiKey;
      }

      const response = await fetch(
        `${config.apiUrl}/admin/ai-models/${model.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(updateData),
        }
      );

      if (response.ok) {
        const updateResult = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const updated = updateResult?.data ?? updateResult;
        setModels(models.map((m) => (m.id === model.id ? updated : m)));
        setEditingModel(null);
        setSuccess('Model settings saved');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      setError('Failed to save model settings');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleAddModel = async (
    model: Omit<AIModel, 'id' | 'createdAt' | 'updatedAt' | 'hasApiKey'>,
    workerCount: number = 1
  ) => {
    setSaving(true);
    try {
      const newModels: AIModel[] = [];
      const updatedModels: AIModel[] = [];

      // 批量创建 Worker
      for (let i = 1; i <= workerCount; i++) {
        const workerModel = {
          ...model,
          // 如果只创建1个，使用原始名称；否则添加编号后缀
          name: workerCount === 1 ? model.name : `${model.name} #${i}`,
          displayName:
            workerCount === 1
              ? model.displayName
              : `${model.displayName} #${i}`,
        };

        const response = await fetch(`${config.apiUrl}/admin/ai-models`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify(workerModel),
        });

        if (response.ok) {
          const addResult = await response.json();
          // Handle wrapped response { success: true, data: {...} }
          const result = addResult?.data ?? addResult;
          if (result.isUpdate) {
            updatedModels.push(result);
          } else {
            newModels.push(result);
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Failed to add Worker #${i}`);
        }
      }

      // 更新模型列表
      let updatedModelsList = [...models];
      // 先更新已存在的
      for (const updated of updatedModels) {
        updatedModelsList = updatedModelsList.map((m) =>
          m.id === updated.id ? updated : m
        );
      }
      // 再添加新的
      updatedModelsList = [...updatedModelsList, ...newModels];
      setModels(updatedModelsList);

      // 显示成功消息
      if (workerCount === 1) {
        setSuccess(
          newModels.length > 0
            ? `模型 ${newModels[0].displayName} 已添加`
            : `模型 ${updatedModels[0].displayName} 已更新`
        );
      } else {
        const addedCount = newModels.length;
        const updatedCount = updatedModels.length;
        const messages = [];
        if (addedCount > 0) messages.push(`新增 ${addedCount} 个`);
        if (updatedCount > 0) messages.push(`更新 ${updatedCount} 个`);
        setSuccess(`Worker 创建完成：${messages.join('，')}`);
      }

      setShowAddModal(false);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add model');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = async (model: AIModel) => {
    if (model.isDefault) {
      setError('Cannot delete the default model');
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (
      !(await confirm({
        title: `Are you sure you want to delete ${model.displayName}?`,
        type: 'danger',
      }))
    )
      return;

    try {
      const response = await fetch(
        `${config.apiUrl}/admin/ai-models/${model.id}`,
        {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        }
      );

      if (response.ok) {
        setModels(models.filter((m) => m.id !== model.id));
        setSuccess('Model deleted');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError('Failed to delete model');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleTestConnection = async (model: AIModel) => {
    setTestingModel(model.id);
    setTestResults((prev) => ({
      ...prev,
      [model.id]: { success: false, message: 'Testing...' },
    }));

    try {
      const response = await fetch(
        `${config.apiUrl}/admin/ai-models/${model.id}/test`,
        {
          method: 'POST',
          headers: { ...getAuthHeader() },
        }
      );

      if (response.ok) {
        const testResult = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const result = testResult?.data ?? testResult;
        setTestResults((prev) => ({
          ...prev,
          [model.id]: {
            success: result.success,
            message: result.message,
            latency: result.latency,
          },
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [model.id]: { success: false, message: 'Test request failed' },
        }));
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [model.id]: { success: false, message: 'Connection error' },
      }));
    } finally {
      setTestingModel(null);
    }
  };

  const handleDiagnose = async () => {
    setDiagnosing(true);
    try {
      const response = await fetch(
        `${config.apiUrl}/admin/ai-models/diagnose`,
        {
          headers: { ...getAuthHeader() },
        }
      );

      if (response.ok) {
        const diagResult = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const result = diagResult?.data ?? diagResult;
        setDiagnoseResult(result);
        setShowDiagnose(true);
      } else {
        setError('Failed to diagnose AI models');
        setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      setError('Network error during diagnosis');
      setTimeout(() => setError(null), 3000);
    } finally {
      setDiagnosing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notifications */}
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

      {/* 2026-05-11 UI 重构：手写 inline SVG → Lucide Search/RefreshCw（项目规范：
          禁止 emoji + 用 Lucide 图标）；删除 dark: 变体（项目 light-only） */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="搜索模型名称、Model ID、Provider..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="all">全部 Provider ({models.length})</option>
          {providerOptions.map(({ provider, count }) => (
            <option key={provider} value={provider}>
              {provider} ({count})
            </option>
          ))}
        </select>
        <button
          onClick={() => fetchModels()}
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-600 transition-colors hover:bg-gray-50"
          title="刷新"
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Models Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full table-fixed">
          {/* 固定列宽：table-fixed + w-full 钉死表宽=容器宽，杜绝横滚；
              窄内容列(Type/Status)给窄，身份列吃挤压截断，操作列留足恒可见 */}
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[20%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[8%]" />
            <col className="w-[16%]" />
            <col className="w-[19%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Provider
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Model ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                API Key
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Capabilities
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredModels.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {searchTerm || providerFilter !== 'all'
                    ? 'No matching models found'
                    : '暂无模型，点击"Add Model"创建'}
                </td>
              </tr>
            ) : (
              filteredModels.map((model) => (
                <tr
                  key={model.id}
                  className={`hover:bg-gray-50 ${!model.isEnabled ? 'opacity-60' : ''}`}
                >
                  {/* PROVIDER —— 真实 provider：官方 logo(按 provider 解析) + 正式名 */}
                  <td className="px-4 py-2.5">
                    {(() => {
                      const brand = getProviderBrand(model.provider);
                      const logo = brand.logo || getModelIconUrl(model.name);
                      return (
                        <div className="flex items-center gap-2">
                          {logo ? (
                            <img
                              src={logo}
                              alt={brand.name}
                              className="h-5 w-5 flex-shrink-0"
                            />
                          ) : (
                            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] font-semibold text-gray-500">
                              {model.provider.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <TruncatedCell
                            className="max-w-[180px] text-sm font-medium text-gray-900"
                            tooltip={model.displayName}
                          >
                            {brand.name}
                          </TruncatedCell>
                        </div>
                      );
                    })()}
                  </td>

                  {/* Model ID + 默认(★)/推理 符号挂在模型上 */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono inline-flex min-w-0 items-center rounded bg-gray-100 px-2 py-1 text-xs">
                        <TruncatedCell
                          className="max-w-[200px] text-gray-700"
                          tooltip={model.modelId}
                        >
                          {model.modelId}
                        </TruncatedCell>
                      </code>
                      {model.isDefault && (
                        <span title="默认模型" className="flex-shrink-0">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        </span>
                      )}
                      {model.isReasoning && (
                        <span title="推理模型" className="flex-shrink-0">
                          <Brain className="h-3.5 w-3.5 text-violet-500" />
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Type Badge */}
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        model.modelType === 'CHAT'
                          ? 'bg-blue-100 text-blue-700'
                          : model.modelType === 'CHAT_FAST'
                            ? 'bg-sky-100 text-sky-700'
                            : model.modelType === 'IMAGE_GENERATION'
                              ? 'bg-green-100 text-green-700'
                              : model.modelType === 'IMAGE_EDITING'
                                ? 'bg-orange-100 text-orange-700'
                                : model.modelType === 'EMBEDDING'
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : model.modelType === 'RERANK'
                                    ? 'bg-pink-100 text-pink-700'
                                    : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {MODEL_TYPE_OPTIONS.find(
                        (o) => o.value === model.modelType
                      )?.label || model.modelType}
                    </span>
                    <div className="mt-1 text-xs text-gray-400">
                      {model.apiFormat || 'openai'}
                    </div>
                  </td>

                  {/* API Key Status — Lucide 图标替代 ✓/✗ 字符 */}
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium ${model.hasApiKey ? 'text-green-600' : 'text-red-500'}`}
                      >
                        {model.hasApiKey ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        {model.hasApiKey ? '已配置' : '未配置'}
                      </span>
                      {model.secretKey && (
                        <TruncatedCell
                          className="max-w-[120px] text-xs text-gray-400"
                          tooltip={`via ${model.secretKey}`}
                        >
                          via {model.secretKey}
                        </TruncatedCell>
                      )}
                    </div>
                  </td>

                  {/* Status Toggle */}
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => handleToggleEnabled(model)}
                      className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
                        model.isEnabled ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                          model.isEnabled ? 'left-[22px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Capabilities */}
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {model.supportsTemperature !== false && (
                        <span
                          className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"
                          title="支持 temperature"
                        >
                          T
                        </span>
                      )}
                      {model.supportsStreaming !== false && (
                        <span
                          className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"
                          title="支持流式"
                        >
                          S
                        </span>
                      )}
                      {model.supportsFunctionCalling !== false && (
                        <span
                          className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700"
                          title="支持函数调用"
                        >
                          F
                        </span>
                      )}
                      {model.supportsVision && (
                        <span
                          className="rounded bg-pink-100 px-1.5 py-0.5 text-xs text-pink-700"
                          title="支持视觉"
                        >
                          V
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      P:{model.priority ?? 50} | T:{model.temperature} |{' '}
                      {model.maxTokens}tok
                    </div>
                    {/* Test Result inline */}
                    {testResults[model.id] && (
                      <div
                        className={`mt-1 text-xs font-medium ${testResults[model.id].success ? 'text-green-600' : 'text-red-500'}`}
                      >
                        {testResults[model.id].success ? '✓' : '✗'}{' '}
                        {testResults[model.id].message}
                        {testResults[model.id].latency &&
                          ` (${testResults[model.id].latency}ms)`}
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {/* 2026-05-11: 4 个 inline SVG → Lucide（Zap/Star/Pencil/Trash2 + Loader2） */}
                    <div className="inline-flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleTestConnection(model)}
                        disabled={testingModel === model.id || !model.isEnabled}
                        className="rounded p-1.5 text-green-600 hover:bg-green-50 disabled:opacity-40"
                        title="测试连接"
                      >
                        {testingModel === model.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </button>
                      {!model.isDefault && model.isEnabled && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(model)}
                          className="rounded p-1.5 text-blue-600 hover:bg-blue-50"
                          title="设为默认"
                        >
                          <Star className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditingModel(model)}
                        className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteModel(model)}
                        disabled={model.isDefault}
                        className="rounded p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editingModel && (
        <EditModelModal
          model={editingModel}
          onSave={handleSaveModel}
          onClose={() => setEditingModel(null)}
          saving={saving}
        />
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddModelModal
          onAdd={handleAddModel}
          onClose={() => setShowAddModal(false)}
          saving={saving}
        />
      )}

      {/* Diagnose Modal */}
      {showDiagnose && diagnoseResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                AI Models Diagnostic Report
              </h3>
              <button
                onClick={() => setShowDiagnose(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Summary */}
            <div className="mb-6 grid grid-cols-4 gap-4">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {diagnoseResult.summary.total}
                </div>
                <div className="text-xs text-gray-500">Total Models</div>
              </div>
              <div className="rounded-lg bg-green-50 p-3 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {diagnoseResult.summary.enabled}
                </div>
                <div className="text-xs text-gray-500">Enabled</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {diagnoseResult.summary.withApiKey}
                </div>
                <div className="text-xs text-gray-500">With API Key</div>
              </div>
              <div
                className={`rounded-lg p-3 text-center ${diagnoseResult.summary.ready > 0 ? 'bg-green-50' : 'bg-red-50'}`}
              >
                <div
                  className={`text-2xl font-bold ${diagnoseResult.summary.ready > 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {diagnoseResult.summary.ready}
                </div>
                <div className="text-xs text-gray-500">Ready to Use</div>
              </div>
            </div>

            {/* Timestamp */}
            <p className="mb-4 text-xs text-gray-500">
              Diagnosed at:{' '}
              <ClientDate date={diagnoseResult.timestamp} format="datetime" />
            </p>

            {/* Models Table */}
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">
                      Name
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">
                      Provider
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">
                      Model ID
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-700">
                      Enabled
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-700">
                      API Key
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">
                      Key Prefix
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-700">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diagnoseResult.models.map((model) => (
                    <tr
                      key={model.id}
                      className={
                        !model.isEnabled ? 'bg-gray-50 opacity-60' : ''
                      }
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium">{model.displayName}</div>
                        <div className="text-xs text-gray-500">
                          {model.name}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        {model.provider}
                      </td>
                      <td className="font-mono px-4 py-2 text-xs text-gray-600">
                        {model.modelId}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {model.isEnabled ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {model.hasApiKey ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            {model.apiKeyLength} chars
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            Missing
                          </span>
                        )}
                      </td>
                      <td className="font-mono px-4 py-2 text-xs text-gray-500">
                        {model.apiKeyPrefix || '-'}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {model.isEnabled && model.hasApiKey ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Ready
                          </span>
                        ) : !model.isEnabled ? (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Disabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            No Key
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Warning if no models ready */}
            {diagnoseResult.summary.ready === 0 && (
              <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                <strong>Warning:</strong> No AI models are ready to use. AI
                responses will fall back to mock data. Please configure at least
                one model with an API key and enable it.
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowDiagnose(false)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-05-11: 移除 QuotaDashboard（API 配额监控）— 已迁到 admin overview，
          主页面只保留"模型增删改"职责。 */}
    </div>
  );
}

// Edit Model Modal - 与 AddModelModal 使用相同界面风格
function EditModelModal({
  model,
  onSave,
  onClose,
  saving,
}: {
  model: AIModel;
  onSave: (model: AIModel, newApiKey?: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const inferApiFormatFromProvider = (provider: string): string => {
    const lower = provider.toLowerCase();
    if (lower === 'anthropic' || lower === 'claude') return 'anthropic';
    if (lower === 'google' || lower === 'gemini') return 'google';
    if (lower === 'xai' || lower === 'grok') return 'xai';
    return 'openai';
  };
  // Auto-correct apiFormat if it contradicts provider
  const correctedApiFormat =
    model.apiFormat === 'openai' &&
    inferApiFormatFromProvider(model.provider) !== 'openai'
      ? inferApiFormatFromProvider(model.provider)
      : model.apiFormat;
  const [formData, setFormData] = useState({
    ...model,
    apiFormat: correctedApiFormat,
  });
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isApiKeyModified, setIsApiKeyModified] = useState(false);
  const [loadingApiKey, setLoadingApiKey] = useState(true);
  const [keySourceMode, setKeySourceMode] = useState<'direct' | 'secret'>(
    model.secretKey ? 'secret' : 'direct'
  ); // 根据现有配置判断模式

  // 获取可用的密钥列表：AI_MODEL + active，再按当前 provider 收窄，
  // 保留 provider 未标注的旧密钥 + 当前已选中那把（避免误藏）；收窄后为空则回退全部，
  // 保证 admin 永不会被过滤到无可选。
  const { secrets } = useAdminSecrets();
  const aiModelSecretsBase =
    secrets?.filter((s) => s.category === 'AI_MODEL' && s.isActive) || [];
  const aiModelSecretsScoped = aiModelSecretsBase.filter(
    (s) =>
      !s.provider ||
      s.provider.toLowerCase() === (formData.provider || '').toLowerCase() ||
      s.name === formData.secretKey
  );
  const aiModelSecrets =
    aiModelSecretsScoped.length > 0 ? aiModelSecretsScoped : aiModelSecretsBase;

  // 打开编辑模态框时，获取完整的 API Key
  useEffect(() => {
    const fetchFullApiKey = async () => {
      try {
        const response = await fetch(
          `${config.apiUrl}/admin/ai-models/${model.id}?edit=true`,
          {
            headers: { ...getAuthHeader() },
          }
        );
        if (response.ok) {
          const result = await response.json();
          // Handle wrapped API response { success: true, data: T }
          const data = result?.data ?? result;
          setApiKey(data.apiKey || '');
        }
      } catch (err) {
        logger.error('Failed to fetch full API key:', err);
        setApiKey(model.apiKey || '');
      } finally {
        setLoadingApiKey(false);
      }
    };
    fetchFullApiKey();
  }, [model.id, model.apiKey]);

  // 记录原始加载的 API Key，用于判断是否修改
  const [originalApiKey, setOriginalApiKey] = useState('');

  // 更新 fetchFullApiKey 后设置原始值
  useEffect(() => {
    if (!loadingApiKey && apiKey) {
      setOriginalApiKey(apiKey);
    }
  }, [loadingApiKey, apiKey]);

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setIsApiKeyModified(value !== originalApiKey);
  };

  const colorOptions = [
    { value: 'from-blue-500 to-blue-600', label: 'Blue' },
    { value: 'from-green-500 to-green-600', label: 'Green' },
    { value: 'from-orange-500 to-orange-600', label: 'Orange' },
    { value: 'from-purple-500 to-purple-600', label: 'Purple' },
    { value: 'from-red-500 to-red-600', label: 'Red' },
    { value: 'from-pink-500 to-pink-600', label: 'Pink' },
    { value: 'from-indigo-500 to-indigo-600', label: 'Indigo' },
    { value: 'from-gray-500 to-gray-600', label: 'Gray' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* 2026-05-11: max-w-lg (512px) 太窄，表单字段挤；改 max-w-3xl (768px) 给两列布局喘息 */}
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          Edit {model.displayName}
        </h3>

        <div className="space-y-4">
          {/* Model Name - Read Only */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              模型标识
            </label>
            <input
              type="text"
              value={`${model.name} (${model.provider})`}
              readOnly
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            />
          </div>

          {/* Model Type (模型类型) - Editable */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              模型类型
            </label>
            <select
              value={formData.modelType}
              onChange={(e) => {
                const newModelType = e.target.value as AIModelType;
                // 根据新的模型类型自动更新 API 端点
                const newEndpoint = formData.provider
                  ? getEndpointForModelType(formData.provider, newModelType)
                  : formData.apiEndpoint;
                setFormData({
                  ...formData,
                  modelType: newModelType,
                  apiEndpoint: newEndpoint,
                });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {MODEL_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.description}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              切换类型会自动更新 API 端点
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Display Name
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData({ ...formData, displayName: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Provider <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.provider}
                onChange={(e) =>
                  setFormData({ ...formData, provider: e.target.value })
                }
                placeholder="voyage / together-ai / 任意自定义 slug"
                className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                可手填任意 provider slug，不必从上方下拉选。
              </p>
            </div>
          </div>

          {/* API Configuration Section - Same style as AddModelModal */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="mb-3 text-sm font-semibold text-blue-800">
              API 配置
              {model.hasApiKey && !isApiKeyModified && (
                <span className="ml-2 text-xs font-normal text-green-600">
                  (已配置)
                </span>
              )}
              {isApiKeyModified && (
                <span className="ml-2 text-xs font-normal text-orange-600">
                  (已修改)
                </span>
              )}
            </h4>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  API Endpoint <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.apiEndpoint}
                  onChange={(e) =>
                    setFormData({ ...formData, apiEndpoint: e.target.value })
                  }
                  className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  API Key 配置 <span className="text-red-500">*</span>
                </label>

                {/* Key Source Mode Toggle */}
                <div className="mb-3 inline-flex rounded-xl bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setKeySourceMode('direct');
                      setFormData({ ...formData, secretKey: null });
                    }}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                      keySourceMode === 'direct'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                      />
                    </svg>
                    直接输入
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKeySourceMode('secret');
                      setApiKey('');
                      setIsApiKeyModified(false);
                    }}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                      keySourceMode === 'secret'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                    引用 Secret Manager
                  </button>
                </div>

                {keySourceMode === 'direct' ? (
                  <div className="relative">
                    {loadingApiKey ? (
                      <div className="flex h-10 w-full items-center rounded-lg border border-gray-300 bg-gray-50 px-3">
                        <span className="text-sm text-gray-500">
                          Loading...
                        </span>
                      </div>
                    ) : (
                      <>
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => handleApiKeyChange(e.target.value)}
                          placeholder={model.hasApiKey ? '' : 'sk-...'}
                          className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          aria-label={showApiKey ? '隐藏密钥' : '显示密钥'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        >
                          {showApiKey ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div>
                    <select
                      value={formData.secretKey || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          secretKey: e.target.value || null,
                        })
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">选择密钥...</option>
                      {aiModelSecrets.map((secret) => (
                        <option key={secret.name} value={secret.name}>
                          {secret.provider ? `[${secret.provider}] ` : ''}
                          {secret.displayName} ({secret.name})
                        </option>
                      ))}
                    </select>
                    {aiModelSecrets.length === 0 && (
                      <p className="mt-1 text-xs text-amber-600">
                        暂无可用密钥，请先在 Secret Manager 中创建 AI_MODEL
                        类型的密钥
                      </p>
                    )}
                    {formData.secretKey && (
                      <p className="mt-1 text-xs text-green-600">
                        已选择密钥：{formData.secretKey}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <ModelIdSelector
                value={formData.modelId}
                onChange={(modelId) => setFormData({ ...formData, modelId })}
                provider={formData.provider}
                apiKey={keySourceMode === 'direct' ? apiKey : ''}
                secretKey={
                  keySourceMode === 'secret' ? formData.secretKey : null
                }
                modelType={formData.modelType}
                apiEndpoint={formData.apiEndpoint}
                placeholder={getModelIdPlaceholder(formData.name)}
              />
            </div>
          </div>

          {/* Display Settings - Collapsed */}
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              显示设置（可选）
            </summary>
            <div className="space-y-3 border-t border-gray-200 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Icon Path
                  </label>
                  <input
                    type="text"
                    value={formData.icon}
                    onChange={(e) =>
                      setFormData({ ...formData, icon: e.target.value })
                    }
                    placeholder="/icons/ai/grok.svg"
                    className="font-mono w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Color
                  </label>
                  <select
                    value={formData.color}
                    onChange={(e) =>
                      setFormData({ ...formData, color: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {colorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </details>

          {/* Advanced Settings - Collapsed */}
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              高级设置（可选）
            </summary>
            <div className="space-y-3 border-t border-gray-200 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        maxTokens: parseInt(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Temperature
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        temperature: parseFloat(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              {/* Reasoning Model Toggle */}
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div>
                  <label className="block text-sm font-medium text-amber-800">
                    推理模型
                  </label>
                  <p className="text-xs text-amber-600">
                    启用后将使用 reasoning_effort 参数（适用于
                    o1、o3、gpt-5、deepseek-r1 等）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      isReasoning: !formData.isReasoning,
                    })
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    formData.isReasoning ? 'bg-amber-500' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      formData.isReasoning ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </details>

          {/* ★ 模型能力配置 - 新增部分 */}
          <details className="rounded-lg border border-cyan-200 bg-cyan-50">
            <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100">
              能力配置（自适应参数）
            </summary>
            <div className="space-y-3 border-t border-cyan-200 p-4">
              {/* API 格式 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  API 格式
                </label>
                <select
                  value={formData.apiFormat || 'openai'}
                  onChange={(e) =>
                    setFormData({ ...formData, apiFormat: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="openai">OpenAI 格式</option>
                  <option value="anthropic">Anthropic 格式</option>
                  <option value="google">Google 格式</option>
                  <option value="xai">xAI 格式</option>
                  <option value="cohere">Cohere 格式</option>
                </select>
              </div>

              {/* Token 参数名称 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Token 参数名称
                </label>
                <select
                  value={formData.tokenParamName || 'max_tokens'}
                  onChange={(e) =>
                    setFormData({ ...formData, tokenParamName: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="max_tokens">max_tokens（标准模型）</option>
                  <option value="max_completion_tokens">
                    max_completion_tokens（推理模型）
                  </option>
                </select>
              </div>

              {/* 超时时间和优先级 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    超时时间 (ms)
                  </label>
                  <input
                    type="number"
                    value={formData.defaultTimeoutMs || 120000}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        defaultTimeoutMs: parseInt(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    优先级
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.priority ?? 50}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priority: parseInt(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* 能力开关 */}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsTemperature !== false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsTemperature: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持 Temperature</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsStreaming !== false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsStreaming: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持流式输出</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsFunctionCalling !== false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsFunctionCalling: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持函数调用</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsVision === true}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsVision: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持视觉/图像</span>
                </label>
              </div>

              {/* 价格配置 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    输入价格 ($/M tokens)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.priceInputPerMillion || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priceInputPerMillion: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="例: 2.50"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    输出价格 ($/M tokens)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.priceOutputPerMillion || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priceOutputPerMillion: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="例: 10.00"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </details>

          {/* ★ 2026-05-06 Structured Output Capability — 抽出到独立组件防 god-class 越线 */}
          <StructuredOutputCapabilitySection
            value={formData}
            onChange={(patch) => setFormData({ ...formData, ...patch })}
          />

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={() => {
                // 如果使用 Secret Manager 模式，清空直接输入的 apiKey
                const modelToSave =
                  keySourceMode === 'secret'
                    ? { ...formData, apiKey: null }
                    : formData;
                onSave(
                  modelToSave,
                  keySourceMode === 'direct' && isApiKeyModified
                    ? apiKey
                    : undefined
                );
              }}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存更改'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Add Model Modal
function AddModelModal({
  onAdd,
  onClose,
  saving,
}: {
  onAdd: (
    model: Omit<AIModel, 'id' | 'createdAt' | 'updatedAt' | 'hasApiKey'>,
    workerCount?: number
  ) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [formData, setFormData] = useState({
    name: '',
    provider: '',
    modelId: '',
    modelType: 'CHAT' as AIModelType,
    displayName: '',
    icon: '',
    color: 'from-gray-500 to-gray-600',
    apiEndpoint: '',
    apiKey: null as string | null,
    secretKey: null as string | null, // 引用 Secret Manager
    isEnabled: true,
    isDefault: false,
    isReasoning: false,
    maxTokens: 4096,
    temperature: 0.7,
    description: '',
    // ★ 新增：模型能力配置字段
    apiFormat: 'openai' as string,
    supportsTemperature: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsVision: false,
    tokenParamName: 'max_tokens' as string,
    defaultTimeoutMs: 120000,
    priceInputPerMillion: undefined as number | undefined,
    priceOutputPerMillion: undefined as number | undefined,
    priority: 50,
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [workerCount, setWorkerCount] = useState(1); // 默认创建1个
  const [keySourceMode, setKeySourceMode] = useState<'direct' | 'secret'>(
    'direct'
  ); // API Key 来源模式

  // 2026-05-11 P8: 数据驱动 provider 下拉走 useAdminAIProviders hook
  // （拆到 hooks/admin/，god-class guard 减负）
  const { providers: dynamicProviders } = useAdminAIProviders();

  // 获取可用的密钥列表：AI_MODEL + active，再按当前 provider 收窄，
  // 保留 provider 未标注的旧密钥 + 当前已选中那把（避免误藏）；收窄后为空则回退全部，
  // 保证 admin 永不会被过滤到无可选。
  const { secrets } = useAdminSecrets();
  const aiModelSecretsBase =
    secrets?.filter((s) => s.category === 'AI_MODEL' && s.isActive) || [];
  const aiModelSecretsScoped = aiModelSecretsBase.filter(
    (s) =>
      !s.provider ||
      s.provider.toLowerCase() === (formData.provider || '').toLowerCase() ||
      s.name === formData.secretKey
  );
  const aiModelSecrets =
    aiModelSecretsScoped.length > 0 ? aiModelSecretsScoped : aiModelSecretsBase;

  const colorOptions = [
    { value: 'from-blue-500 to-blue-600', label: 'Blue' },
    { value: 'from-green-500 to-green-600', label: 'Green' },
    { value: 'from-orange-500 to-orange-600', label: 'Orange' },
    { value: 'from-purple-500 to-purple-600', label: 'Purple' },
    { value: 'from-red-500 to-red-600', label: 'Red' },
    { value: 'from-pink-500 to-pink-600', label: 'Pink' },
    { value: 'from-indigo-500 to-indigo-600', label: 'Indigo' },
    { value: 'from-gray-500 to-gray-600', label: 'Gray' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* 2026-05-11: max-w-lg (512px) 太窄，表单字段挤；改 max-w-3xl (768px) 给两列布局喘息 */}
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          Add New AI Model
        </h3>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              模型提供商 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.name}
              onChange={(e) => {
                // 2026-05-11 P8: 优先匹配 DB provider；命中则按 DB endpoint/apiFormat 填，
                // 否则兜底匹配旧的 STANDARD_MODEL_CONFIGS（兼容期）。
                const dyn = dynamicProviders.find(
                  (p) => p.slug === e.target.value
                );
                if (dyn) {
                  // ★ 2026-05-11: provider 字段必须填 slug（小写 kebab-case），
                  //   不是 display name（"Voyage AI" 带空格 toLowerCase 后
                  //   "voyage ai" 匹配不上后端 switch 的 voyage / voyageai 分支）。
                  setFormData({
                    ...formData,
                    name: dyn.slug,
                    displayName: dyn.name,
                    provider: dyn.slug,
                    modelId: '',
                    apiEndpoint: dyn.endpoint,
                    icon: dyn.iconUrl ?? '',
                    apiFormat: dyn.apiFormat,
                  });
                  return;
                }
                const selected = STANDARD_MODEL_CONFIGS.find(
                  (m) => m.id === e.target.value
                );
                if (selected) {
                  const providerApiFormatMap: Record<string, string> = {
                    Anthropic: 'anthropic',
                    Google: 'google',
                    xAI: 'xai',
                    Cohere: 'cohere',
                  };
                  setFormData({
                    ...formData,
                    name: selected.id,
                    displayName: selected.name,
                    provider: selected.provider,
                    modelId: selected.defaultModelId,
                    apiEndpoint: selected.defaultEndpoint,
                    icon: selected.icon,
                    modelType: (selected.defaultType || 'CHAT') as AIModelType,
                    apiFormat:
                      providerApiFormatMap[selected.provider] || 'openai',
                  });
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">选择模型提供商...</option>
              {/* 2026-05-11: 删掉 STANDARD_MODEL_CONFIGS 退役 optgroup（双源 → DB 单源），
                  dedupe by slug 防止 P1 migration seed 跟旧硬编码同名重复。 */}
              {Array.from(
                new Map(dynamicProviders.map((p) => [p.slug, p])).values()
              ).map((p) => (
                <option key={`db-${p.slug}`} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              <strong>可跳过此下拉：</strong>下方 Provider / Endpoint / Model ID
              字段均可手填任意值，自定义新 provider 不必从下拉选。
            </p>
          </div>

          {/* 2026-05-11 P8 柔性提示：endpoint suffix 与 modelType 不匹配时显示
              黄色 warning（组件拆到 ./ModelEndpointWarning.tsx） */}
          <ModelEndpointWarning
            modelType={formData.modelType}
            apiEndpoint={formData.apiEndpoint}
          />

          {/* Model Type (模型类型) */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              模型类型 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.modelType}
              onChange={(e) => {
                const newModelType = e.target.value as AIModelType;
                // 2026-05-11 P8b: admin 已手填 endpoint 时不要覆盖（如自定义 provider
                // 'voyage' 不在 getEndpointForModelType 的 hardcoded 列表里，会被覆盖为 ''）。
                // 仅当 endpoint 为空时，按 provider 推荐默认值。
                const recommendedEndpoint = formData.provider
                  ? getEndpointForModelType(formData.provider, newModelType)
                  : '';
                const nextEndpoint =
                  formData.apiEndpoint && formData.apiEndpoint.trim().length > 0
                    ? formData.apiEndpoint
                    : recommendedEndpoint;
                setFormData({
                  ...formData,
                  modelType: newModelType,
                  apiEndpoint: nextEndpoint,
                  modelId: '', // 清空 model ID，需要重新获取
                });
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {MODEL_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.description}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              切换类型仅在 endpoint 为空时自动推荐默认值，已填则保留你的输入。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Display Name
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData({ ...formData, displayName: e.target.value })
                }
                placeholder="Auto-filled from model type"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Provider <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.provider}
                onChange={(e) =>
                  setFormData({ ...formData, provider: e.target.value })
                }
                placeholder="voyage / together-ai / 任意自定义 slug"
                className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                可手填任意 provider slug，不必从上方下拉选。
              </p>
            </div>
          </div>

          {/* API Configuration Section */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <h4 className="mb-3 text-sm font-semibold text-blue-800">
              API 配置
            </h4>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  API Endpoint <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.apiEndpoint}
                  onChange={(e) =>
                    setFormData({ ...formData, apiEndpoint: e.target.value })
                  }
                  placeholder="https://api.openai.com/v1/chat/completions"
                  className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  API Key 配置 <span className="text-red-500">*</span>
                </label>

                {/* Key Source Mode Toggle */}
                <div className="mb-3 inline-flex rounded-xl bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setKeySourceMode('direct');
                      setFormData({ ...formData, secretKey: null });
                    }}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                      keySourceMode === 'direct'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                      />
                    </svg>
                    直接输入
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKeySourceMode('secret');
                      setFormData({ ...formData, apiKey: null });
                    }}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                      keySourceMode === 'secret'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                      />
                    </svg>
                    引用 Secret Manager
                  </button>
                </div>

                {keySourceMode === 'direct' ? (
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={formData.apiKey || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          apiKey: e.target.value || null,
                        })
                      }
                      placeholder="sk-..."
                      className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showApiKey ? '🙈' : '👁️'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <select
                      value={formData.secretKey || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          secretKey: e.target.value || null,
                        })
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">选择密钥...</option>
                      {aiModelSecrets.map((secret) => (
                        <option key={secret.name} value={secret.name}>
                          {secret.provider ? `[${secret.provider}] ` : ''}
                          {secret.displayName} ({secret.name})
                        </option>
                      ))}
                    </select>
                    {aiModelSecrets.length === 0 && (
                      <p className="mt-1 text-xs text-amber-600">
                        暂无可用密钥，请先在 Secret Manager 中创建 AI_MODEL
                        类型的密钥
                      </p>
                    )}
                    {formData.secretKey && (
                      <p className="mt-1 text-xs text-green-600">
                        已选择密钥：{formData.secretKey}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <ModelIdSelector
                value={formData.modelId}
                onChange={(modelId) => setFormData({ ...formData, modelId })}
                provider={formData.provider}
                apiKey={keySourceMode === 'direct' ? formData.apiKey || '' : ''}
                secretKey={
                  keySourceMode === 'secret' ? formData.secretKey : null
                }
                modelType={formData.modelType}
                apiEndpoint={formData.apiEndpoint}
                placeholder={getModelIdPlaceholder(formData.name)}
              />
            </div>
          </div>

          {/* Display Settings - Collapsed */}
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              显示设置（可选）
            </summary>
            <div className="space-y-3 border-t border-gray-200 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Icon Path
                  </label>
                  <input
                    type="text"
                    value={formData.icon}
                    onChange={(e) =>
                      setFormData({ ...formData, icon: e.target.value })
                    }
                    placeholder="/icons/ai/grok.svg"
                    className="font-mono w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Color
                  </label>
                  <select
                    value={formData.color}
                    onChange={(e) =>
                      setFormData({ ...formData, color: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {colorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </details>

          {/* 横向扩展 - Worker 数量 */}
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-purple-800">
              <span>🚀</span> 横向扩展（可选）
            </h4>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Worker 数量
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={workerCount}
                  onChange={(e) => setWorkerCount(parseInt(e.target.value))}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-purple-200 accent-purple-600"
                />
                <span className="w-8 text-center text-lg font-bold text-purple-700">
                  {workerCount}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {workerCount === 1
                  ? '创建单个模型配置'
                  : `将创建 ${workerCount} 个相同配置的 Worker（名称后缀 #1, #2, ...）`}
              </p>
            </div>
          </div>

          {/* Advanced Settings - Collapsed */}
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              高级设置（可选）
            </summary>
            <div className="space-y-3 border-t border-gray-200 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        maxTokens: parseInt(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Temperature
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        temperature: parseFloat(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              {/* Reasoning Model Toggle */}
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div>
                  <label className="block text-sm font-medium text-amber-800">
                    推理模型
                  </label>
                  <p className="text-xs text-amber-600">
                    启用后将使用 reasoning_effort 参数（适用于
                    o1、o3、gpt-5、deepseek-r1 等）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      isReasoning: !formData.isReasoning,
                    })
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    formData.isReasoning ? 'bg-amber-500' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      formData.isReasoning ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </details>

          {/* ★ 模型能力配置 - 新增部分 */}
          <details className="rounded-lg border border-cyan-200 bg-cyan-50">
            <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-100">
              能力配置（自适应参数）
            </summary>
            <div className="space-y-3 border-t border-cyan-200 p-4">
              {/* API 格式 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  API 格式
                </label>
                <select
                  value={formData.apiFormat || 'openai'}
                  onChange={(e) =>
                    setFormData({ ...formData, apiFormat: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="openai">OpenAI 格式</option>
                  <option value="anthropic">Anthropic 格式</option>
                  <option value="google">Google 格式</option>
                  <option value="xai">xAI 格式</option>
                  <option value="cohere">Cohere 格式</option>
                </select>
              </div>

              {/* Token 参数名称 */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Token 参数名称
                </label>
                <select
                  value={formData.tokenParamName || 'max_tokens'}
                  onChange={(e) =>
                    setFormData({ ...formData, tokenParamName: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="max_tokens">max_tokens（标准模型）</option>
                  <option value="max_completion_tokens">
                    max_completion_tokens（推理模型）
                  </option>
                </select>
              </div>

              {/* 超时时间和优先级 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    超时时间 (ms)
                  </label>
                  <input
                    type="number"
                    value={formData.defaultTimeoutMs || 120000}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        defaultTimeoutMs: parseInt(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    优先级
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.priority ?? 50}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priority: parseInt(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* 能力开关 */}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsTemperature !== false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsTemperature: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持 Temperature</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsStreaming !== false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsStreaming: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持流式输出</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsFunctionCalling !== false}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsFunctionCalling: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持函数调用</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={formData.supportsVision === true}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        supportsVision: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm">支持视觉/图像</span>
                </label>
              </div>

              {/* 价格配置 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    输入价格 ($/M tokens)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.priceInputPerMillion || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priceInputPerMillion: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="例: 2.50"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    输出价格 ($/M tokens)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.priceOutputPerMillion || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        priceOutputPerMillion: e.target.value
                          ? parseFloat(e.target.value)
                          : undefined,
                      })
                    }
                    placeholder="例: 10.00"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={() =>
                onAdd(
                  {
                    ...formData,
                    apiKey: formData.apiKey || null,
                    secretKey: formData.secretKey || null,
                  },
                  workerCount
                )
              }
              disabled={
                saving ||
                !formData.name ||
                (!formData.apiKey && !formData.secretKey)
              }
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving
                ? '保存中...'
                : workerCount === 1
                  ? '添加模型'
                  : `添加 ${workerCount} 个 Worker`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
