'use client';

/**
 * AI Office 工作区布局组件
 * Tab：Slides (可用) / Docs (开发中) / Excel (开发中)
 * 注意：左侧菜单使用系统全局Sidebar
 */

import React, { useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Presentation, FileText, Table } from 'lucide-react';
import { Tabs } from '@/components/ui/tabs';
import CommandPalette, {
  useCommandPalette,
} from '@/components/ai-research/discussion/CommandPalette';
import { SlidesTab } from '../slides';
import { useTranslation } from '@/lib/i18n';

import { logger } from '@/lib/utils/logger';
// 工作模式类型
type WorkspaceTab = 'slides' | 'docs' | 'excel';

interface WorkspaceLayoutProps {
  children?: React.ReactNode;
}

// Valid tab values
const VALID_TABS: WorkspaceTab[] = ['slides', 'docs', 'excel'];

// 开发中的 Tab 占位组件
function ComingSoonPlaceholder({ feature }: { feature: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-200">
          <svg
            className="h-8 w-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-700">{feature}</h3>
        <p className="mt-2 text-sm text-gray-500">
          {t('aiOffice.comingSoon.description')}
        </p>
        <div className="mt-4 inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
          <svg
            className="mr-1.5 h-4 w-4"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
              clipRule="evenodd"
            />
          </svg>
          {t('aiOffice.comingSoon.badge')}
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceLayout({
  children: _children,
}: WorkspaceLayoutProps) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Derive active tab directly from URL (source of truth)
  const tabParam = searchParams?.get('tab') as WorkspaceTab | null;
  const activeTab: WorkspaceTab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'slides';

  const containerRef = useRef<HTMLDivElement>(null);
  const commandPalette = useCommandPalette();

  // Update URL when tab changes
  const handleTabChange = (tab: WorkspaceTab) => {
    router.push(`/ai-office?tab=${tab}`, { scroll: false });
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col overflow-hidden bg-gray-50"
    >
      {/* Tab 切换导航 */}
      <div className="flex-shrink-0 bg-white px-6">
        <Tabs
          value={activeTab}
          onChange={(k) => handleTabChange(k as WorkspaceTab)}
          items={[
            {
              key: 'slides',
              label: t('aiOffice.tabs.slides'),
              icon: Presentation,
            },
            {
              key: 'docs',
              icon: FileText,
              label: (
                <span className="flex items-center gap-1">
                  {t('aiOffice.tabs.docs')}
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    {t('aiOffice.comingSoon.badge')}
                  </span>
                </span>
              ),
            },
            {
              key: 'excel',
              icon: Table,
              label: (
                <span className="flex items-center gap-1">
                  {t('aiOffice.tabs.excel')}
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                    {t('aiOffice.comingSoon.badge')}
                  </span>
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* 内容区域 - 根据 Tab 显示不同内容 */}
      <div className="flex flex-1 overflow-hidden">
        {activeTab === 'slides' && (
          <div className="flex-1 overflow-hidden">
            <SlidesTab />
          </div>
        )}

        {activeTab === 'docs' && (
          <div className="flex-1 overflow-hidden">
            <ComingSoonPlaceholder feature={t('aiOffice.tabs.docs')} />
          </div>
        )}

        {activeTab === 'excel' && (
          <div className="flex-1 overflow-hidden">
            <ComingSoonPlaceholder feature={t('aiOffice.tabs.excel')} />
          </div>
        )}
      </div>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        onExecuteCommand={(cmd) => {
          logger.debug('Execute command:', cmd.id);
        }}
      />
    </div>
  );
}
