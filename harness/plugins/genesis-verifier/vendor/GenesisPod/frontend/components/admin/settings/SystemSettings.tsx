'use client';

import { useState, useEffect } from 'react';
import {
  Server,
  Database,
  Bell,
  Mail,
  Globe,
  Save,
  Search,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import EmailSettings from './EmailSettings';
import { getAuthTokens } from '@/lib/utils/auth';
import { toast } from '@/stores';
import { logger } from '@/lib/utils/logger';
interface SearchConfig {
  provider: string;
  enabled: boolean;
  tavily: { apiKey: string | null; hasApiKey: boolean };
  serper: { apiKey: string | null; hasApiKey: boolean };
}

export default function SystemSettings() {
  const [settings, setSettings] = useState({
    apiCacheEnabled: true,
    apiCacheDuration: 3600,
    maxConcurrentCrawlers: 10,
    crawlerTimeout: 300,
    emailNotifications: true,
    notificationEmail: 'admin@example.com',
    webhookUrl: '',
    defaultLanguage: 'en',
  });

  // Search API config
  const [searchConfig, setSearchConfig] = useState<SearchConfig>({
    provider: 'tavily',
    enabled: true,
    tavily: { apiKey: null, hasApiKey: false },
    serper: { apiKey: null, hasApiKey: false },
  });
  const [tavilyApiKey, setTavilyApiKey] = useState('');
  const [serperApiKey, setSerperApiKey] = useState('');
  const [searchSaving, setSearchSaving] = useState(false);
  const [searchTesting, setSearchTesting] = useState<string | null>(null);
  const [searchTestResult, setSearchTestResult] = useState<{
    provider: string;
    success: boolean;
    message: string;
  } | null>(null);

  // Load search config on mount
  useEffect(() => {
    loadSearchConfig();
  }, []);

  const loadSearchConfig = async () => {
    try {
      const token = getAuthTokens()?.accessToken;
      const res = await fetch('/api/v1/admin/search-config', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setSearchConfig(data);
      }
    } catch (error) {
      logger.error('Failed to load search config:', error);
    }
  };

  const handleSaveSearchConfig = async () => {
    setSearchSaving(true);
    try {
      const token = getAuthTokens()?.accessToken;
      const res = await fetch('/api/v1/admin/search-config', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: searchConfig.provider,
          enabled: searchConfig.enabled,
          tavilyApiKey: tavilyApiKey || undefined,
          serperApiKey: serperApiKey || undefined,
        }),
      });

      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setSearchConfig(data);
        setTavilyApiKey('');
        setSerperApiKey('');
        toast.success('保存成功', '搜索配置已保存');
      } else {
        toast.error('保存失败', '无法保存搜索配置');
      }
    } catch (error) {
      logger.error('Failed to save search config:', error);
      toast.error('保存失败', '无法保存搜索配置');
    } finally {
      setSearchSaving(false);
    }
  };

  const handleTestSearchApi = async (provider: string) => {
    setSearchTesting(provider);
    setSearchTestResult(null);

    try {
      const token = getAuthTokens()?.accessToken;
      const apiKey =
        provider === 'tavily'
          ? tavilyApiKey ||
            (searchConfig.tavily.hasApiKey ? '***use-saved***' : '')
          : serperApiKey ||
            (searchConfig.serper.hasApiKey ? '***use-saved***' : '');

      if (!apiKey) {
        setSearchTestResult({
          provider,
          success: false,
          message: 'Please enter an API key first',
        });
        return;
      }

      // If using saved key, we need to test differently
      if (apiKey === '***use-saved***') {
        setSearchTestResult({
          provider,
          success: true,
          message: 'API key is configured (saved in database)',
        });
        return;
      }

      const res = await fetch('/api/v1/admin/search-config/test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider, apiKey }),
      });

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;
      setSearchTestResult({ provider, ...data });
    } catch (error) {
      setSearchTestResult({
        provider,
        success: false,
        message: (error as Error).message || 'Test failed',
      });
    } finally {
      setSearchTesting(null);
    }
  };

  const handleSave = async () => {
    // TODO: Implement save logic
    logger.debug('Saving settings:', settings);
  };

  return (
    <div className="space-y-6 p-8">
      {/* API Settings */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-blue-100 p-2">
            <Server className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">API Settings</h3>
            <p className="text-sm text-gray-500">
              Configure API behavior and caching
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium text-gray-700">
                Enable Caching
              </label>
              <p className="text-sm text-gray-500">
                Cache API responses to improve performance
              </p>
            </div>
            <button
              onClick={() =>
                setSettings({
                  ...settings,
                  apiCacheEnabled: !settings.apiCacheEnabled,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.apiCacheEnabled ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.apiCacheEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Cache Duration (seconds)
            </label>
            <input
              type="number"
              value={settings.apiCacheDuration}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  apiCacheDuration: parseInt(e.target.value),
                })
              }
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Search API Settings */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-purple-100 p-2">
            <Search className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Search API</h3>
            <p className="text-sm text-gray-500">
              Configure web search for AI real-time information
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Enable/Disable Search */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium text-gray-700">Enable Search</label>
              <p className="text-sm text-gray-500">
                Allow AI to search the web for real-time information
              </p>
            </div>
            <button
              onClick={() =>
                setSearchConfig({
                  ...searchConfig,
                  enabled: !searchConfig.enabled,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                searchConfig.enabled ? 'bg-purple-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  searchConfig.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Provider Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Search Provider
            </label>
            <select
              value={searchConfig.provider}
              onChange={(e) =>
                setSearchConfig({ ...searchConfig, provider: e.target.value })
              }
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              <option value="tavily">Tavily (Recommended)</option>
              <option value="serper">Serper (Google Search)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Tavily is optimized for AI search. Serper provides Google results.
            </p>
          </div>

          {/* Tavily API Key */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Tavily API Key
                </label>
                <p className="text-xs text-gray-500">
                  Get your API key from{' '}
                  <a
                    href="https://tavily.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 hover:underline"
                  >
                    tavily.com
                  </a>
                </p>
              </div>
              {searchConfig.tavily.hasApiKey && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle className="h-3 w-3" />
                  Configured
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                value={tavilyApiKey}
                onChange={(e) => setTavilyApiKey(e.target.value)}
                placeholder={
                  searchConfig.tavily.hasApiKey
                    ? '••••••••••••••••'
                    : 'Enter Tavily API key'
                }
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <button
                onClick={() => handleTestSearchApi('tavily')}
                disabled={
                  searchTesting === 'tavily' ||
                  (!tavilyApiKey && !searchConfig.tavily.hasApiKey)
                }
                className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {searchTesting === 'tavily' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Test'
                )}
              </button>
            </div>
            {searchTestResult?.provider === 'tavily' && (
              <div
                className={`mt-2 flex items-center gap-1 text-xs ${
                  searchTestResult.success ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {searchTestResult.success ? (
                  <CheckCircle className="h-3 w-3" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                {searchTestResult.message}
              </div>
            )}
          </div>

          {/* Serper API Key */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Serper API Key
                </label>
                <p className="text-xs text-gray-500">
                  Get your API key from{' '}
                  <a
                    href="https://serper.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 hover:underline"
                  >
                    serper.dev
                  </a>
                </p>
              </div>
              {searchConfig.serper.hasApiKey && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle className="h-3 w-3" />
                  Configured
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                value={serperApiKey}
                onChange={(e) => setSerperApiKey(e.target.value)}
                placeholder={
                  searchConfig.serper.hasApiKey
                    ? '••••••••••••••••'
                    : 'Enter Serper API key'
                }
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <button
                onClick={() => handleTestSearchApi('serper')}
                disabled={
                  searchTesting === 'serper' ||
                  (!serperApiKey && !searchConfig.serper.hasApiKey)
                }
                className="rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {searchTesting === 'serper' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Test'
                )}
              </button>
            </div>
            {searchTestResult?.provider === 'serper' && (
              <div
                className={`mt-2 flex items-center gap-1 text-xs ${
                  searchTestResult.success ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {searchTestResult.success ? (
                  <CheckCircle className="h-3 w-3" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                {searchTestResult.message}
              </div>
            )}
          </div>

          {/* Save Search Config Button */}
          <div className="flex justify-end">
            <button
              onClick={handleSaveSearchConfig}
              disabled={searchSaving}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition-all hover:bg-purple-700 disabled:opacity-50"
            >
              {searchSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Search Config
            </button>
          </div>
        </div>
      </div>

      {/* Email Settings */}
      <EmailSettings />

      {/* Crawler Settings */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-emerald-100 p-2">
            <Database className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Crawler Settings</h3>
            <p className="text-sm text-gray-500">
              Configure crawler behavior and limits
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Max Concurrent Crawlers
            </label>
            <input
              type="number"
              value={settings.maxConcurrentCrawlers}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  maxConcurrentCrawlers: parseInt(e.target.value),
                })
              }
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Maximum number of crawlers that can run simultaneously
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Default Timeout (seconds)
            </label>
            <input
              type="number"
              value={settings.crawlerTimeout}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  crawlerTimeout: parseInt(e.target.value),
                })
              }
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Timeout for crawler requests
            </p>
          </div>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-violet-100 p-2">
            <Bell className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Notifications</h3>
            <p className="text-sm text-gray-500">
              Configure notification preferences
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium text-gray-700">
                Email Notifications
              </label>
              <p className="text-sm text-gray-500">
                Receive email alerts for important events
              </p>
            </div>
            <button
              onClick={() =>
                setSettings({
                  ...settings,
                  emailNotifications: !settings.emailNotifications,
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.emailNotifications ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.emailNotifications
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              <Mail className="mb-1 inline h-4 w-4" /> Notification Email
            </label>
            <input
              type="email"
              value={settings.notificationEmail}
              onChange={(e) =>
                setSettings({ ...settings, notificationEmail: e.target.value })
              }
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Webhook URL (Optional)
            </label>
            <input
              type="url"
              value={settings.webhookUrl}
              onChange={(e) =>
                setSettings({ ...settings, webhookUrl: e.target.value })
              }
              placeholder="https://example.com/webhook"
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Receive webhook notifications for events
            </p>
          </div>
        </div>
      </div>

      {/* General Settings */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-amber-100 p-2">
            <Globe className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">General</h3>
            <p className="text-sm text-gray-500">General system preferences</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Default Language
            </label>
            <select
              value={settings.defaultLanguage}
              onChange={(e) =>
                setSettings({ ...settings, defaultLanguage: e.target.value })
              }
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="en">English</option>
              <option value="zh">Chinese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
            </select>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-500/30"
        >
          <Save className="h-4 w-4" />
          Save Settings
        </button>
      </div>
    </div>
  );
}
