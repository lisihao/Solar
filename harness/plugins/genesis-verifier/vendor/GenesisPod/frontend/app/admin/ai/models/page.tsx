'use client';

import { useState } from 'react';
import { Bot, Plus, Sparkles, Settings2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import AIModelSettings from '@/components/admin/ai-config/AIModelSettings';
import { ProviderDiscoverModal } from '@/components/admin/ai-config/ProviderDiscoverModal';
import { BYOKDictionaryModal } from '@/components/admin/ai-config/BYOKDictionaryModal';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';

export default function AIModelsPage() {
  const { t } = useTranslation();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [showDictionary, setShowDictionary] = useState(false);

  /**
   * 2026-05-11 一键 AI 配置完整闭环（覆盖 Provider + Model 参数）：
   * 1. upsert AIProvider 行（slug/name/endpoint/apiFormat/testModel/capabilities）
   * 2. 推断每个 modelType 的合理默认参数（maxTokens / temperature / supports*）
   * 3. 批量创建 AIModel 行（含 apiFormat / apiEndpoint / 参数）
   */
  const defaultsByModelType = (modelType: string): Record<string, unknown> => {
    if (modelType === 'EMBEDDING')
      return {
        maxTokens: 0,
        temperature: 0,
        embeddingDimensions: 1536,
        maxInputTokens: 8192,
        supportsTemperature: false,
        supportsStreaming: false,
        supportsFunctionCalling: false,
        supportsVision: false,
      };
    if (modelType === 'RERANK')
      return {
        maxTokens: 0,
        temperature: 0,
        supportsTemperature: false,
        supportsStreaming: false,
        supportsFunctionCalling: false,
        supportsVision: false,
      };
    if (modelType === 'IMAGE_GENERATION' || modelType === 'IMAGE_EDITING')
      return {
        maxTokens: 0,
        temperature: 0,
        supportsTemperature: false,
        supportsStreaming: false,
        supportsFunctionCalling: false,
        supportsVision: false,
      };
    if (modelType === 'TTS' || modelType === 'AUDIO')
      return {
        maxTokens: 0,
        temperature: 0,
        supportsTemperature: false,
        supportsStreaming: false,
        supportsFunctionCalling: false,
        supportsVision: false,
      };
    if (modelType === 'MULTIMODAL')
      return {
        maxTokens: 8192,
        temperature: 0.7,
        supportsTemperature: true,
        supportsStreaming: true,
        supportsFunctionCalling: true,
        supportsVision: true,
        tokenParamName: 'max_tokens',
      };
    // CHAT / CHAT_FAST / CODE / EVALUATOR 默认
    return {
      maxTokens: 4096,
      temperature: 0.7,
      supportsTemperature: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsVision: false,
      tokenParamName: 'max_tokens',
    };
  };

  const handleDiscoverConfirm = async (payload: {
    providerSlug: string;
    providerName: string;
    endpoint: string;
    apiKey: string;
    apiFormat: string;
    selected: Array<{ modelId: string; modelType: string }>;
  }) => {
    // 1) Upsert AIProvider 行（PATCH 现有 slug，POST 否则）
    const capabilities = Array.from(
      new Set(payload.selected.map((s) => s.modelType))
    );
    try {
      const listRes = await fetch(`${config.apiUrl}/admin/ai-providers`, {
        headers: getAuthHeader(),
      });
      // 后端全局 ResponseTransformInterceptor 包 { success, data, metadata }，解一层
      const listRaw = listRes.ok ? await listRes.json() : null;
      const existing: Array<{ id: string; slug: string }> = Array.isArray(
        listRaw
      )
        ? listRaw
        : Array.isArray(listRaw?.data)
          ? listRaw.data
          : [];
      const found = existing.find((p) => p.slug === payload.providerSlug);
      const providerPayload = {
        slug: payload.providerSlug,
        name: payload.providerName,
        endpoint: payload.endpoint,
        apiFormat: payload.apiFormat,
        testModel: payload.selected[0]?.modelId ?? '',
        capabilities,
        isEnabled: true,
      };
      const provUrl = found
        ? `${config.apiUrl}/admin/ai-providers/${found.id}`
        : `${config.apiUrl}/admin/ai-providers`;
      const provMethod = found ? 'PATCH' : 'POST';
      await fetch(provUrl, {
        method: provMethod,
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(providerPayload),
      });
    } catch (err) {
      logger.error('[discover] upsert provider failed', err);
    }

    // 2) 批量创建 AIModel 行（含 apiFormat + 按 modelType 推默认参数）
    for (const item of payload.selected) {
      try {
        await fetch(`${config.apiUrl}/admin/ai-models`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.modelId,
            provider: payload.providerSlug,
            modelId: item.modelId,
            modelType: item.modelType,
            displayName: item.modelId,
            apiEndpoint: payload.endpoint,
            apiFormat: payload.apiFormat,
            isEnabled: true,
            isDefault: false,
            ...defaultsByModelType(item.modelType),
          }),
        });
      } catch (err) {
        logger.error('[discover] create model failed', item.modelId, err);
      }
    }
    window.location.reload();
  };

  return (
    <AdminPageLayout
      title={t('admin.nav.models')}
      description={t('admin.tabDescriptions.aiModels')}
      icon={Bot}
      domain="ai"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDictionary(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            title="管理 BYOK 字典：AI Providers / API Formats / Model Types"
          >
            <Settings2 className="h-5 w-5" />
            字典管理
          </button>
          <button
            onClick={() => setShowDiscoverModal(true)}
            className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            <Sparkles className="h-5 w-5" />
            AI 一键配置
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus className="h-5 w-5" />
            Add Model
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 2026-05-11 UI 重构：移除 SystemModelInventoryPanel（按 type/provider 分布
            + 24h 调用指标）+ QuotaDashboard（API 配额监控）。统一聚焦"模型增删改"
            一件事，配额/分布从 admin overview 进入。 */}
        <AIModelSettings
          showAddModal={showAddModal}
          setShowAddModal={setShowAddModal}
        />

        {/* 2026-05-11: Modal render 条件化 — 若哪个 Modal hydration 时
            unmount/conditional bug，只在 open 时挂载避免 SSR hydrate mismatch */}
        {showDiscoverModal && (
          <ProviderDiscoverModal
            open
            onClose={() => setShowDiscoverModal(false)}
            onConfirm={handleDiscoverConfirm}
          />
        )}

        {showDictionary && (
          <BYOKDictionaryModal open onClose={() => setShowDictionary(false)} />
        )}
      </div>
    </AdminPageLayout>
  );
}
