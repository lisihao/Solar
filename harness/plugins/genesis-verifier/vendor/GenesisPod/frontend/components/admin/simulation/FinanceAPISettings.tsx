'use client';

import { APISettingsForm } from '../settings/APISettingsForm';
import { config } from '@/lib/utils/config';

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

interface FinanceAPISettingsProps {
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

const FINANCE_TEMPLATES = [
  {
    name: 'SEC EDGAR',
    description: 'SEC公开财报数据，完全免费无需Key',
    baseUrl: 'https://data.sec.gov/submissions/CIK0001045810.json',
    apiKeyUrl: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany',
    apiKeyPlaceholder: '无需API Key',
    headers: `{"User-Agent": "${config.brand.userAgent}"}`,
    freeQuota: '免费：无限制（需设置User-Agent）',
  },
  {
    name: 'Financial Modeling Prep (Filings)',
    description: '公司财报、资产负债表、现金流',
    baseUrl:
      'https://financialmodelingprep.com/api/v3/income-statement/NVDA?apikey=',
    apiKeyUrl: 'https://site.financialmodelingprep.com/developer/docs',
    apiKeyPlaceholder: 'YOUR_FMP_KEY',
    freeQuota: '免费：250次/天',
  },
  {
    name: 'Polygon.io',
    description: '股票、期权、加密货币市场数据',
    baseUrl: 'https://api.polygon.io/v3/reference/tickers/NVDA?apiKey=',
    apiKeyUrl: 'https://polygon.io/dashboard/signup',
    apiKeyPlaceholder: 'YOUR_POLYGON_KEY',
    freeQuota: '免费：5次/分钟',
  },
];

export function FinanceAPISettings({
  providers,
  onAddProvider,
  onUpdateProvider,
  onRemoveProvider,
  onTestProvider,
  testResults,
  testing,
}: FinanceAPISettingsProps) {
  return (
    <APISettingsForm
      categoryId="finance"
      categoryName="财经与公告 (Finance & Filings)"
      categoryDescription="财报、投融资、公告、专利/备案等公司公开信息"
      iconGradient={{ from: 'green-500', to: 'emerald-500' }}
      providers={providers}
      templates={FINANCE_TEMPLATES}
      onAddProvider={onAddProvider}
      onUpdateProvider={onUpdateProvider}
      onRemoveProvider={onRemoveProvider}
      onTestProvider={onTestProvider}
      testResults={testResults}
      testing={testing}
    />
  );
}
