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

interface RegulationAPISettingsProps {
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

const REGULATION_TEMPLATES = [
  {
    name: 'Federal Register API',
    description: '美国联邦法规公告，完全免费',
    baseUrl:
      'https://www.federalregister.gov/api/v1/documents.json?conditions[term]=semiconductor',
    apiKeyUrl:
      'https://www.federalregister.gov/developers/documentation/api/v1',
    apiKeyPlaceholder: '无需API Key',
    freeQuota: '免费：无限制',
  },
  {
    name: 'BIS Export Administration',
    description: '美国出口管制条例',
    baseUrl:
      'https://www.bis.doc.gov/index.php/regulations/export-administration-regulations-ear',
    apiKeyUrl: 'https://www.bis.doc.gov',
    apiKeyPlaceholder: '网页数据源，无API',
    freeQuota: '公开数据',
  },
  {
    name: 'EU EUR-Lex',
    description: '欧盟法规数据库API',
    baseUrl: 'https://eur-lex.europa.eu/eurlex-ws/rest/search',
    apiKeyUrl:
      'https://eur-lex.europa.eu/content/help/eurlex-content/webservices.html',
    apiKeyPlaceholder: '无需API Key',
    freeQuota: '免费：有速率限制',
  },
];

export function RegulationAPISettings({
  providers,
  onAddProvider,
  onUpdateProvider,
  onRemoveProvider,
  onTestProvider,
  testResults,
  testing,
}: RegulationAPISettingsProps) {
  return (
    <APISettingsForm
      categoryId="regulation"
      categoryName="监管与政策 (Regulation & Policy)"
      categoryDescription="政策法规、出口管制、能耗标准、合规要求"
      iconGradient={{ from: 'red-500', to: 'pink-500' }}
      providers={providers}
      templates={REGULATION_TEMPLATES}
      onAddProvider={onAddProvider}
      onUpdateProvider={onUpdateProvider}
      onRemoveProvider={onRemoveProvider}
      onTestProvider={onTestProvider}
      testResults={testResults}
      testing={testing}
    />
  );
}
