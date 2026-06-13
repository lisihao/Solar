'use client';

import { useState } from 'react';
import { TrendingUp, Save, Loader2 } from 'lucide-react';
import { MarketAPISettings } from './MarketAPISettings';
import { FinanceAPISettings } from './FinanceAPISettings';
import { NewsAPISettings } from './NewsAPISettings';
import { RegulationAPISettings } from './RegulationAPISettings';

interface SimulationAPIProvider {
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

interface SimulationAPICategory {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  icon: string;
  gradientFrom: string;
  gradientTo: string;
  providers: SimulationAPIProvider[];
}

interface SimulationAPITabProps {
  categories: SimulationAPICategory[];
  onUpdateCategories: (categories: SimulationAPICategory[]) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  testResults: Record<string, { success: boolean; message: string }>;
  testing: string | null;
  onTestProvider: (
    categoryId: string,
    provider: SimulationAPIProvider
  ) => Promise<void>;
}

export function SimulationAPITab({
  categories,
  onUpdateCategories,
  onSave,
  saving,
  testResults,
  testing,
  onTestProvider,
}: SimulationAPITabProps) {
  const getCategoryProviders = (categoryId: string) => {
    return categories.find((c) => c.id === categoryId)?.providers || [];
  };

  const handleAddProvider = (categoryId: string, template?: APITemplate) => {
    onUpdateCategories(
      categories.map((cat) => {
        if (cat.id === categoryId) {
          const newProviderId = `${categoryId}-provider-${Date.now()}`;
          const newProvider: SimulationAPIProvider = template
            ? {
                id: newProviderId,
                name: template.name,
                baseUrl: template.baseUrl,
                apiKey: '',
                headers: template.headers || '',
                enabled: true,
                isDefault: cat.providers.length === 0,
              }
            : {
                id: newProviderId,
                name: `Provider ${cat.providers.length + 1}`,
                baseUrl: '',
                apiKey: '',
                enabled: false,
                isDefault: cat.providers.length === 0,
              };

          return {
            ...cat,
            providers: [...cat.providers, newProvider],
          };
        }
        return cat;
      })
    );
  };

  const handleUpdateProvider = (
    categoryId: string,
    providerId: string,
    updates: Partial<SimulationAPIProvider>
  ) => {
    onUpdateCategories(
      categories.map((cat) => {
        if (cat.id === categoryId) {
          return {
            ...cat,
            providers: cat.providers.map((provider) => {
              if (provider.id === providerId) {
                // If setting as default, unset others
                if (updates.isDefault) {
                  cat.providers.forEach((p) => (p.isDefault = false));
                }
                return { ...provider, ...updates };
              }
              return provider;
            }),
          };
        }
        return cat;
      })
    );
  };

  const handleRemoveProvider = (categoryId: string, providerId: string) => {
    onUpdateCategories(
      categories.map((cat) => {
        if (cat.id === categoryId) {
          const newProviders = cat.providers.filter((p) => p.id !== providerId);
          // If removed provider was default, set first provider as default
          if (
            newProviders.length > 0 &&
            !newProviders.some((p) => p.isDefault)
          ) {
            newProviders[0].isDefault = true;
          }
          return { ...cat, providers: newProviders };
        }
        return cat;
      })
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">推演数据源 API</h3>
              <p className="text-sm text-gray-600">
                为 AI Simulation 配置真实数据源，支持多 Provider 并设置默认值
              </p>
              <p className="mt-1 text-xs text-indigo-600">
                每个类别可配置多个 Provider，设置默认
                Provider，默认不可用时自动切换备用
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Category Settings */}
      <div className="space-y-6">
        <MarketAPISettings
          providers={getCategoryProviders('market')}
          onAddProvider={(template) => handleAddProvider('market', template)}
          onUpdateProvider={(providerId, updates) =>
            handleUpdateProvider('market', providerId, updates)
          }
          onRemoveProvider={(providerId) =>
            handleRemoveProvider('market', providerId)
          }
          onTestProvider={onTestProvider}
          testResults={testResults}
          testing={testing}
        />

        <FinanceAPISettings
          providers={getCategoryProviders('finance')}
          onAddProvider={(template) => handleAddProvider('finance', template)}
          onUpdateProvider={(providerId, updates) =>
            handleUpdateProvider('finance', providerId, updates)
          }
          onRemoveProvider={(providerId) =>
            handleRemoveProvider('finance', providerId)
          }
          onTestProvider={onTestProvider}
          testResults={testResults}
          testing={testing}
        />

        <NewsAPISettings
          providers={getCategoryProviders('news')}
          onAddProvider={(template) => handleAddProvider('news', template)}
          onUpdateProvider={(providerId, updates) =>
            handleUpdateProvider('news', providerId, updates)
          }
          onRemoveProvider={(providerId) =>
            handleRemoveProvider('news', providerId)
          }
          onTestProvider={onTestProvider}
          testResults={testResults}
          testing={testing}
        />

        <RegulationAPISettings
          providers={getCategoryProviders('regulation')}
          onAddProvider={(template) =>
            handleAddProvider('regulation', template)
          }
          onUpdateProvider={(providerId, updates) =>
            handleUpdateProvider('regulation', providerId, updates)
          }
          onRemoveProvider={(providerId) =>
            handleRemoveProvider('regulation', providerId)
          }
          onTestProvider={onTestProvider}
          testResults={testResults}
          testing={testing}
        />
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={() => void onSave()}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存推演数据源配置
        </button>
      </div>
    </div>
  );
}
