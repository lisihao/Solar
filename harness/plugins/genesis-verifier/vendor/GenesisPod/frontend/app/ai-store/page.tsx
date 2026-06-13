'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { Tabs } from '@/components/ui/tabs';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { useTranslation } from '@/lib/i18n';
import AIToolsTab from '@/components/ai-store/AIToolsTab';
import AISkillsTab from '@/components/ai-store/AISkillsTab';
import { LoadingState } from '@/components/ui/states';

type TabType = 'tools' | 'skills';

function AIStoreContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = (searchParams?.get('tab') as TabType) || 'tools';

  const setActiveTab = (tab: TabType) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('tab', tab);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <AppShell>
      <main className="flex-1 overflow-y-auto">
        {/* Header - Sticky */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
          <PageHeaderHero
            title={t('aiStore.title')}
            subtitle={t('aiStore.subtitle')}
            icon={
              <svg
                className="h-7 w-7 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            }
            iconGradient="from-cyan-500 to-blue-600"
            iconShadowClass="shadow-cyan-500/25"
          >
            <Tabs
              value={activeTab}
              onChange={(k) => setActiveTab(k as TabType)}
              items={[
                { key: 'tools', label: t('aiStore.tabs.tools') },
                { key: 'skills', label: t('aiStore.tabs.skills') },
              ]}
            />
          </PageHeaderHero>
        </div>

        {/* Tab Content */}
        <div className="flex-1">
          {activeTab === 'tools' && <AIToolsTab />}
          {activeTab === 'skills' && <AISkillsTab />}
        </div>
      </main>
    </AppShell>
  );
}

export default function AIStorePage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <LoadingState fullScreen />
        </AppShell>
      }
    >
      <AIStoreContent />
    </Suspense>
  );
}
