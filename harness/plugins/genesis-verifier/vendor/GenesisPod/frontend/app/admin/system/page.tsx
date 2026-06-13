'use client';

import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  Settings,
  Activity,
  SlidersHorizontal,
  Bell,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { AdminTabs, type AdminTab } from '@/components/admin/shared';
import SystemSettings from '@/components/admin/settings/SystemSettings';
import EmailSettings from '@/components/admin/settings/EmailSettings';
import MonitoringPageContent from './monitoring/content';
import LogsPageContent from './logs/content';
import NotificationsPageContent from './notifications/content';
import MCPServerPageContent from './mcp-server/content';
import SecurityPageContent from '../access/security/content';
import FeedbackPageContent from '../feedback/content';

/**
 * 系统管理 Hub（L1 Infrastructure 4 卡之一）
 *
 * 2026-05-12 v2: 解决评审 P2 — ops/settings/messages 内不再"section 堆叠 +
 * border-t"，改用 sub-tab 切换避免三层横向 selector 同屏 / 千行滚动地狱。
 *
 * 4 Tabs:
 *   - ops:      监控 / 日志           (sub-tab)
 *   - settings: 站点 / 邮件 / MCP     (sub-tab)
 *   - messages: 通知 / 反馈           (sub-tab)
 *   - security: 单视图
 */

type SystemTabKey = 'ops' | 'settings' | 'messages' | 'security';
const DEFAULT_TAB: SystemTabKey = 'ops';
const VALID_TABS: readonly SystemTabKey[] = [
  'ops',
  'settings',
  'messages',
  'security',
] as const;

type SubTabConfig<K extends string> = {
  key: K;
  labelKey: string;
  render: () => React.ReactNode;
};

function SystemHubInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs: AdminTab[] = useMemo(
    () => [
      { key: 'ops', label: t('admin.system.tabs.ops'), icon: Activity },
      {
        key: 'settings',
        label: t('admin.system.tabs.settings'),
        icon: SlidersHorizontal,
      },
      { key: 'messages', label: t('admin.system.tabs.messages'), icon: Bell },
      {
        key: 'security',
        label: t('admin.system.tabs.security'),
        icon: ShieldCheck,
      },
    ],
    [t]
  );

  const rawTab = searchParams?.get('tab');
  const activeTab: SystemTabKey = (VALID_TABS as readonly string[]).includes(
    rawTab ?? ''
  )
    ? (rawTab as SystemTabKey)
    : DEFAULT_TAB;

  const opsSubTabs: SubTabConfig<'monitoring' | 'logs'>[] = [
    {
      key: 'monitoring',
      labelKey: 'admin.nav.monitoring',
      render: () => <MonitoringPageContent embedded />,
    },
    {
      key: 'logs',
      labelKey: 'admin.nav.logs',
      render: () => <LogsPageContent embedded />,
    },
  ];

  const settingsSubTabs: SubTabConfig<'site' | 'email' | 'mcpServer'>[] = [
    {
      key: 'site',
      labelKey: 'admin.nav.site',
      render: () => <SystemSettings />,
    },
    {
      key: 'email',
      labelKey: 'admin.nav.email',
      render: () => <EmailSettings />,
    },
    {
      key: 'mcpServer',
      labelKey: 'admin.nav.mcpServer',
      render: () => <MCPServerPageContent embedded />,
    },
  ];

  const messagesSubTabs: SubTabConfig<'notifications' | 'feedback'>[] = [
    {
      key: 'notifications',
      labelKey: 'admin.nav.notifications',
      render: () => <NotificationsPageContent embedded />,
    },
    {
      key: 'feedback',
      labelKey: 'admin.nav.feedback',
      render: () => <FeedbackPageContent embedded />,
    },
  ];

  const setSubParam = (key: string) => {
    if (!pathname) return;
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('sub', key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const renderSubTabbed = <K extends string>(subTabs: SubTabConfig<K>[]) => {
    const rawSub = searchParams?.get('sub');
    const active = (subTabs.find((s) => s.key === rawSub) ?? subTabs[0]).key;
    return (
      <div className="space-y-4">
        <AdminTabs
          tabs={subTabs.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
          activeKey={active}
          onChange={setSubParam}
          mode="controlled"
        />
        {(subTabs.find((s) => s.key === active) ?? subTabs[0]).render()}
      </div>
    );
  };

  return (
    <AdminPageLayout
      title={t('admin.nav.systemManagement')}
      description={t('admin.system.description')}
      icon={Settings}
      domain="system"
    >
      <div className="space-y-6">
        <AdminTabs tabs={tabs} mode="route" paramName="tab" />

        {activeTab === 'ops' && renderSubTabbed(opsSubTabs)}
        {activeTab === 'settings' && renderSubTabbed(settingsSubTabs)}
        {activeTab === 'messages' && renderSubTabbed(messagesSubTabs)}
        {activeTab === 'security' && <SecurityPageContent embedded />}
      </div>
    </AdminPageLayout>
  );
}

export default function SystemManagementPage() {
  return (
    <Suspense fallback={null}>
      <SystemHubInner />
    </Suspense>
  );
}
