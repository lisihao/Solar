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

interface MarketAPISettingsProps {
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

const MARKET_TEMPLATES = [
  {
    name: 'Alpha Vantage',
    description: '免费股票/加密货币/商品数据API，每分钟5次请求',
    baseUrl:
      'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=NVDA&apikey=',
    apiKeyUrl: 'https://www.alphavantage.co/support/#api-key',
    apiKeyPlaceholder: 'YOUR_ALPHAVANTAGE_KEY',
    freeQuota: '免费：5次/分钟, 500次/天',
  },
  {
    name: 'Yahoo Finance (via RapidAPI)',
    description: '雅虎财经数据，需RapidAPI账号',
    baseUrl: 'https://yahoo-finance15.p.rapidapi.com/api/v1/markets/quote',
    apiKeyUrl: 'https://rapidapi.com/sparior/api/yahoo-finance15',
    apiKeyPlaceholder: 'YOUR_RAPIDAPI_KEY',
    headers: '{"X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com"}',
    freeQuota: '免费：100次/月',
  },
  {
    name: 'Financial Modeling Prep',
    description: '财务数据、实时报价、历史价格',
    baseUrl: 'https://financialmodelingprep.com/api/v3/quote/NVDA?apikey=',
    apiKeyUrl: 'https://site.financialmodelingprep.com/developer/docs',
    apiKeyPlaceholder: 'YOUR_FMP_KEY',
    freeQuota: '免费：250次/天',
  },
];

export function MarketAPISettings({
  providers,
  onAddProvider,
  onUpdateProvider,
  onRemoveProvider,
  onTestProvider,
  testResults,
  testing,
}: MarketAPISettingsProps) {
  return (
    <APISettingsForm
      categoryId="market"
      categoryName="市场与定价 (Market & Pricing)"
      categoryDescription="GPU/芯片/云算力价格、供需关系、交付周期"
      iconGradient={{ from: 'blue-500', to: 'cyan-500' }}
      providers={providers}
      templates={MARKET_TEMPLATES}
      onAddProvider={onAddProvider}
      onUpdateProvider={onUpdateProvider}
      onRemoveProvider={onRemoveProvider}
      onTestProvider={onTestProvider}
      testResults={testResults}
      testing={testing}
    />
  );
}
