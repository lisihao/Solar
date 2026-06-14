'use client';

import { useState, useEffect } from 'react';
import {
  Mail,
  Save,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { getAuthTokens } from '@/lib/utils/auth';
import { config as CONFIG } from '@/lib/utils/config';

import { logger } from '@/lib/utils/logger';
interface EmailConfig {
  provider: 'smtp' | 'resend';
  enabled: boolean;
  from: string;
  adminEmail: string | null;
  host: string | null;
  port: number;
  user: string | null;
  hasPassword: boolean;
  hasResendKey: boolean;
}

export default function EmailSettings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<EmailConfig>({
    provider: 'smtp',
    enabled: false,
    from: CONFIG.brand.emailFrom,
    adminEmail: '',
    host: '',
    port: 587,
    user: '',
    hasPassword: false,
    hasResendKey: false,
  });

  const [smtpPassword, setSmtpPassword] = useState('');
  const [resendApiKey, setResendApiKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    loadEmailConfig();
  }, []);

  const loadEmailConfig = async () => {
    try {
      const token = getAuthTokens()?.accessToken;
      const res = await fetch('/api/v1/admin/settings/email', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setConfig(data);
      }
    } catch (error) {
      logger.error('Failed to load email config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const token = getAuthTokens()?.accessToken;
      const payload: Record<string, unknown> = {
        provider: config.provider,
        enabled: config.enabled,
        from: config.from,
        adminEmail: config.adminEmail,
      };

      if (config.provider === 'smtp') {
        payload.host = config.host;
        payload.port = config.port;
        payload.user = config.user;
        if (smtpPassword) {
          payload.pass = smtpPassword;
        }
      } else {
        if (resendApiKey) {
          payload.resendApiKey = resendApiKey;
        }
      }

      const res = await fetch('/api/v1/admin/settings/email', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setConfig(data);
        setSmtpPassword('');
        setResendApiKey('');
        setTestResult({
          success: true,
          message: 'Email settings saved successfully!',
        });
      } else {
        const err = await res.json();
        setTestResult({
          success: false,
          message: err.message || 'Failed to save',
        });
      }
    } catch (error: unknown) {
      setTestResult({
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const token = getAuthTokens()?.accessToken;
      const res = await fetch('/api/v1/admin/settings/email/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;
      setTestResult(data);
    } catch (error: unknown) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleReinitialize = async () => {
    try {
      const token = getAuthTokens()?.accessToken;
      await fetch('/api/v1/feedback/email/reinitialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setTestResult({ success: true, message: 'Email service reinitialized' });
    } catch (error) {
      logger.error('Failed to reinitialize:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-lg bg-pink-100 p-2">
          <Mail className="h-5 w-5 text-pink-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">
            {t('admin.email.title')}
          </h3>
          <p className="text-sm text-gray-500">
            {t('admin.email.description')}
          </p>
        </div>
      </div>

      {/* Status Alert */}
      {!config.enabled && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <span className="text-sm text-amber-800">
            {t('admin.email.disabledWarning')}
          </span>
        </div>
      )}

      <div className="space-y-4">
        {/* Enable/Disable */}
        <div className="flex items-center justify-between">
          <div>
            <label className="font-medium text-gray-700">
              {t('admin.email.enabled')}
            </label>
            <p className="text-sm text-gray-500">
              {t('admin.email.enabledDescription')}
            </p>
          </div>
          <button
            onClick={() => setConfig({ ...config, enabled: !config.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.enabled ? 'bg-pink-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                config.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Provider Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('admin.email.provider')}
          </label>
          <select
            value={config.provider}
            onChange={(e) =>
              setConfig({
                ...config,
                provider: e.target.value as 'smtp' | 'resend',
              })
            }
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
          >
            <option value="smtp">SMTP (Gmail, Outlook, etc.)</option>
            <option value="resend">Resend (API-based)</option>
          </select>
        </div>

        {/* Admin Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('admin.email.adminEmail')}
          </label>
          <input
            type="email"
            value={config.adminEmail || ''}
            onChange={(e) =>
              setConfig({ ...config, adminEmail: e.target.value })
            }
            placeholder="admin@example.com"
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            {t('admin.email.adminEmailHint')}
          </p>
        </div>

        {/* From Address */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('admin.email.fromAddress')}
          </label>
          <input
            type="text"
            value={config.from}
            onChange={(e) => setConfig({ ...config, from: e.target.value })}
            placeholder={CONFIG.brand.emailFrom}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
          />
        </div>

        {/* SMTP Settings */}
        {config.provider === 'smtp' && (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="font-medium text-gray-700">
              {t('admin.email.smtpConfig')}
            </h4>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('admin.email.smtpHost')}
                </label>
                <input
                  type="text"
                  value={config.host || ''}
                  onChange={(e) =>
                    setConfig({ ...config, host: e.target.value })
                  }
                  placeholder="smtp.gmail.com"
                  className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('admin.email.smtpPort')}
                </label>
                <input
                  type="number"
                  value={config.port}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      port: parseInt(e.target.value) || 587,
                    })
                  }
                  placeholder="587"
                  className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                {t('admin.email.smtpUser')}
              </label>
              <input
                type="text"
                value={config.user || ''}
                onChange={(e) => setConfig({ ...config, user: e.target.value })}
                placeholder="your-email@gmail.com"
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                  {t('admin.email.smtpPassword')}
                </label>
                {config.hasPassword && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle className="h-3 w-3" />
                    {t('admin.email.configured')}
                  </span>
                )}
              </div>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={
                    config.hasPassword ? '••••••••••••' : 'Enter password'
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t('admin.email.smtpPasswordHint')}{' '}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pink-600 hover:underline"
                >
                  App Password
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Resend Settings */}
        {config.provider === 'resend' && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('admin.email.resendApiKey')}
                </label>
                <p className="text-xs text-gray-500">
                  {t('admin.email.resendHint')}{' '}
                  <a
                    href="https://resend.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-pink-600 hover:underline"
                  >
                    resend.com
                  </a>
                </p>
              </div>
              {config.hasResendKey && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle className="h-3 w-3" />
                  {t('admin.email.configured')}
                </span>
              )}
            </div>
            <input
              type="password"
              value={resendApiKey}
              onChange={(e) => setResendApiKey(e.target.value)}
              placeholder={
                config.hasResendKey ? '••••••••••••' : 'Enter Resend API key'
              }
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div
            className={`flex items-center gap-2 rounded-lg px-4 py-3 ${
              testResult.success
                ? 'border border-green-200 bg-green-50'
                : 'border border-red-200 bg-red-50'
            }`}
          >
            {testResult.success ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            <span
              className={`text-sm ${
                testResult.success ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {testResult.message}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-2">
          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={testing || !config.enabled}
              className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t('admin.email.testEmail')}
            </button>
            <button
              onClick={handleReinitialize}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              {t('admin.email.reinitialize')}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-pink-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-pink-500/25 transition-all hover:bg-pink-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t('admin.email.saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
}
