'use client';

import { APISettingsForm } from '../settings/APISettingsForm';

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

interface NewsAPISettingsProps {
  providers: SimulationAPIProvider[];
  onAddProvider: (template?: APITemplate) => void;
  onUpdateProvider: (
    providerId: string,
    updates: Partial<SimulationAPIProvider>
  ) => void;
  onRemoveProvider: (providerId: string) => void;
  onTestProvider: (
    categoryId: string,
    provider: SimulationAPIProvider
  ) => Promise<void>;
  testResults?: Record<string, { success: boolean; message: string }>;
  testing?: string | null;
}

const NEWS_TEMPLATES = [
  {
    name: 'NewsAPI',
    description: '全球新闻聚合API，支持关键词搜索',
    baseUrl: 'https://newsapi.org/v2/everything?q=NVIDIA&apiKey=',
    apiKeyUrl: 'https://newsapi.org/register',
    apiKeyPlaceholder: 'YOUR_NEWSAPI_KEY',
    freeQuota: '免费：100次/天（开发者版）',
  },
  {
    name: 'GNews',
    description: '新闻搜索API，支持多语言',
    baseUrl: 'https://gnews.io/api/v4/search?q=semiconductor&token=',
    apiKeyUrl: 'https://gnews.io/register',
    apiKeyPlaceholder: 'YOUR_GNEWS_TOKEN',
    freeQuota: '免费：100次/天',
  },
  {
    name: 'Finnhub',
    description: '财经新闻和市场情绪分析（日期会自动更新为最近一年）',
    baseUrl: (() => {
      const today = new Date();
      const oneYearAgo = new Date(today);
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      return `https://finnhub.io/api/v1/company-news?symbol=NVDA&from=${formatDate(oneYearAgo)}&to=${formatDate(today)}&token=`;
    })(),
    apiKeyUrl: 'https://finnhub.io/register',
    apiKeyPlaceholder: 'YOUR_FINNHUB_TOKEN',
    freeQuota: '免费：60次/分钟',
  },
];

export function NewsAPISettings({
  providers,
  onAddProvider,
  onUpdateProvider,
  onRemoveProvider,
  onTestProvider,
  testResults,
  testing,
}: NewsAPISettingsProps) {
  return (
    <APISettingsForm
      categoryId="news"
      categoryName="新闻与舆情 (News & Sentiment)"
      categoryDescription="行业新闻、媒体报道、社交媒体情绪"
      iconGradient={{ from: 'orange-500', to: 'amber-500' }}
      providers={providers}
      templates={NEWS_TEMPLATES}
      onAddProvider={onAddProvider}
      onUpdateProvider={onUpdateProvider}
      onRemoveProvider={onRemoveProvider}
      onTestProvider={onTestProvider}
      testResults={testResults}
      testing={testing}
    />
  );
}
