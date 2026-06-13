'use client';

import { ShieldCheck, Lock, KeyRound, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout, AdminPageSection } from '@/components/admin/layout';
import { AdminConfigCard } from '@/components/admin/shared';

export default function SecurityPageContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const { t } = useTranslation();

  const body = (
    <div className="space-y-6">
      <AdminPageSection>
        <AdminConfigCard
          title="Authentication Settings"
          description="Configure how users authenticate to the system"
          icon={Lock}
          status="configured"
          statusLabel="Active"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
              <div>
                <h4 className="text-sm font-medium text-gray-900">
                  Google OAuth
                </h4>
                <p className="text-sm text-gray-500">
                  Allow users to sign in with Google
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                Enabled
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
              <div>
                <h4 className="text-sm font-medium text-gray-900">
                  Email/Password
                </h4>
                <p className="text-sm text-gray-500">
                  Traditional email and password authentication
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                Enabled
              </span>
            </div>
          </div>
        </AdminConfigCard>
      </AdminPageSection>

      <AdminPageSection>
        <AdminConfigCard
          title="Session Management"
          description="Control user session duration and security"
          icon={KeyRound}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Session Timeout
                </label>
                <select className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <option value="1h">1 hour</option>
                  <option value="4h">4 hours</option>
                  <option value="8h" selected>
                    8 hours
                  </option>
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Max Sessions Per User
                </label>
                <select className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <option value="1">1 session</option>
                  <option value="3">3 sessions</option>
                  <option value="5" selected>
                    5 sessions
                  </option>
                  <option value="unlimited">Unlimited</option>
                </select>
              </div>
            </div>
          </div>
        </AdminConfigCard>
      </AdminPageSection>

      <AdminPageSection>
        <AdminConfigCard
          title="Security Alerts"
          description="Configure security notifications and alerts"
          icon={AlertTriangle}
          status="pending"
          statusLabel="Setup Required"
        >
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <h4 className="text-sm font-medium text-amber-800">
                  Configure Email Alerts
                </h4>
                <p className="mt-1 text-sm text-amber-700">
                  Email settings need to be configured before security alerts
                  can be sent. Visit the Email settings page to set up SMTP or
                  Resend integration.
                </p>
              </div>
            </div>
          </div>
        </AdminConfigCard>
      </AdminPageSection>
    </div>
  );

  // ★ 2026-05-12: 嵌入模式 (/admin/system?tab=security 内) 跳过外层 AdminPageLayout.
  if (embedded) return body;

  return (
    <AdminPageLayout
      title={t('admin.nav.security')}
      description={t('admin.tabDescriptions.security')}
      icon={ShieldCheck}
      domain="system"
    >
      {body}
    </AdminPageLayout>
  );
}
