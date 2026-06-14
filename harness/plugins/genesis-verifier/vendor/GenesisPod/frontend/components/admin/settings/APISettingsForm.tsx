'use client';

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

interface APIProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers?: string;
  enabled: boolean;
  isDefault: boolean;
}

interface APITemplate {
  name: string;
  description: string;
  baseUrl: string;
  apiKeyUrl: string;
  apiKeyPlaceholder: string;
  headers?: string;
  freeQuota?: string;
}

interface APISettingsFormProps {
  categoryId: string;
  categoryName: string;
  categoryDescription: string;
  iconGradient: { from: string; to: string };
  providers: APIProviderConfig[];
  templates: APITemplate[];
  onAddProvider: (template?: APITemplate) => void;
  onUpdateProvider: (
    providerId: string,
    updates: Partial<APIProviderConfig>
  ) => void;
  onRemoveProvider: (providerId: string) => void;
  onTestProvider: (
    categoryId: string,
    provider: APIProviderConfig
  ) => Promise<void>;
  testResults?: Record<string, { success: boolean; message: string }>;
  testing?: string | null;
}

export function APISettingsForm({
  categoryId,
  categoryName,
  categoryDescription,
  iconGradient,
  providers,
  templates,
  onAddProvider,
  onUpdateProvider,
  onRemoveProvider,
  onTestProvider,
  testResults = {},
  testing = null,
}: APISettingsFormProps) {
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>(
    {}
  );

  const toggleApiKeyVisibility = (providerId: string) => {
    setVisibleApiKeys((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const handleAddFromTemplate = (template: APITemplate) => {
    onAddProvider(template);
    setShowTemplateModal(false);
  };

  return (
    <div className="space-y-4">
      {/* Category Header */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {categoryName}
            </h3>
            <p className="mt-1 text-sm text-gray-600">{categoryDescription}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus className="h-4 w-4" />
              从模板添加
            </button>
            <button
              onClick={() => onAddProvider()}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              <Plus className="h-4 w-4" />
              自定义添加
            </button>
          </div>
        </div>
      </div>

      {/* Providers List */}
      {providers.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-sm text-gray-500">
            暂无配置的数据源，点击上方按钮添加
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => {
            const testResult = testResults[`${categoryId}-${provider.id}`];
            const isTesting = testing === `${categoryId}-${provider.id}`;

            return (
              <div
                key={provider.id}
                className={`rounded-xl border-2 p-5 transition-all ${
                  provider.isDefault
                    ? 'border-purple-400 bg-purple-50/50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {/* Provider Header */}
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={provider.name}
                        onChange={(e) =>
                          onUpdateProvider(provider.id, {
                            name: e.target.value,
                          })
                        }
                        placeholder="Provider Name"
                        className="border-0 border-b border-transparent bg-transparent px-0 py-1 text-lg font-semibold focus:border-purple-500 focus:outline-none focus:ring-0"
                      />
                      {provider.isDefault && (
                        <span className="rounded-full bg-purple-600 px-2 py-0.5 text-xs font-medium text-white">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={provider.enabled}
                          onChange={(e) =>
                            onUpdateProvider(provider.id, {
                              enabled: e.target.checked,
                            })
                          }
                          className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-600">启用</span>
                      </label>
                      {!provider.isDefault && (
                        <button
                          onClick={() =>
                            onUpdateProvider(provider.id, { isDefault: true })
                          }
                          className="text-xs text-purple-600 hover:underline"
                        >
                          设为默认
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveProvider(provider.id)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Provider Config */}
                <div className="space-y-3">
                  {/* Base URL */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">
                      Base URL
                    </label>
                    <input
                      type="text"
                      value={provider.baseUrl}
                      onChange={(e) =>
                        onUpdateProvider(provider.id, {
                          baseUrl: e.target.value,
                        })
                      }
                      placeholder="https://api.example.com/endpoint?query=..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  {/* API Key */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">
                      API Key (可选)
                    </label>
                    <div className="relative">
                      <input
                        type={visibleApiKeys[provider.id] ? 'text' : 'password'}
                        value={provider.apiKey}
                        onChange={(e) =>
                          onUpdateProvider(provider.id, {
                            apiKey: e.target.value,
                          })
                        }
                        placeholder="API Key (if required)"
                        className="font-mono w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => toggleApiKeyVisibility(provider.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                      >
                        {visibleApiKeys[provider.id] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Headers (Optional) */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">
                      Custom Headers (JSON, 可选)
                    </label>
                    <input
                      type="text"
                      value={provider.headers || ''}
                      onChange={(e) =>
                        onUpdateProvider(provider.id, {
                          headers: e.target.value,
                        })
                      }
                      placeholder='{"X-Custom-Header": "value"}'
                      className="font-mono w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  {/* Test Button & Result */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={() => onTestProvider(categoryId, provider)}
                      disabled={isTesting || !provider.baseUrl}
                      className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isTesting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="h-4 w-4" />
                      )}
                      测试连接
                    </button>
                    {testResult && (
                      <div
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                          testResult.success
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {testResult.success ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        <span>{testResult.message}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                选择 API 模板 - {categoryName}
              </h3>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {templates.map((template, idx) => (
                <div
                  key={idx}
                  className="cursor-pointer rounded-lg border border-gray-200 p-4 hover:border-purple-400 hover:bg-purple-50"
                  onClick={() => handleAddFromTemplate(template)}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900">
                        {template.name}
                      </h4>
                      <p className="mt-1 text-sm text-gray-600">
                        {template.description}
                      </p>
                    </div>
                    <a
                      href={template.apiKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-purple-600 hover:underline"
                    >
                      获取 API Key
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {template.freeQuota && (
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      {template.freeQuota}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
