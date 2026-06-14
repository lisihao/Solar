'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';
import WorkspaceLayout from '@/components/ai-office/layout/WorkspaceLayout';
import { SkillsModal } from '@/components/common/skills/SkillsModal';
import { LogIn, Sparkles } from 'lucide-react';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { useTranslation } from '@/lib/i18n';
import { LoadingState } from '@/components/ui/states/LoadingState';

/**
 * AI Reports 工作区页面
 * 整合资源管理、AI交互、报告生成的统一工作区
 * 支持生成 Word、Excel、PPT 等多种格式文档
 */
export default function AIOfficePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [showSkillsModal, setShowSkillsModal] = useState(false);

  // 加载中
  if (isLoading) {
    return <LoadingState fullScreen text={t('aiOffice.loading')} size="lg" />;
  }

  // 未登录
  if (!user) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center">
          <div className="mx-auto max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">
                <svg
                  className="h-10 w-10 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">
              {t('aiOffice.signIn.title')}
            </h1>
            <p className="mb-8 text-gray-500">
              {t('aiOffice.signIn.description')}
            </p>
            <button
              onClick={() => router.push('/login')}
              className="inline-flex items-center gap-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl hover:shadow-violet-500/30"
            >
              <LogIn className="h-5 w-5" />
              {t('aiOffice.signIn.button')}
            </button>
          </div>
        </main>
      </AppShell>
    );
  }

  // 已登录
  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/50 backdrop-blur-sm">
          <PageHeaderHero
            title={t('aiOffice.title')}
            subtitle={t('aiOffice.subtitle')}
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            }
            iconGradient="from-violet-500 to-purple-600"
            iconShadowClass="shadow-violet-500/25"
            actions={
              <>
                <button
                  onClick={() => setShowSkillsModal(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                  title={t('aiOffice.skills.title') || 'AI Office Skills'}
                >
                  <Sparkles className="h-4 w-4 text-violet-500" />
                </button>
                <span className="text-sm text-gray-500">
                  {t('aiOffice.header.selectResources')}
                </span>
              </>
            }
          />
        </div>

        {/* 内容区域 */}
        <div className="h-[calc(100vh-120px)]">
          <Suspense fallback={<LoadingState size="md" />}>
            <WorkspaceLayout />
          </Suspense>
        </div>
      </main>

      {/* Skills Modal */}
      <SkillsModal
        open={showSkillsModal}
        onClose={() => setShowSkillsModal(false)}
        domain="office"
        title={t('aiOffice.skills.title') || 'AI Office Skills'}
      />
    </AppShell>
  );
}
