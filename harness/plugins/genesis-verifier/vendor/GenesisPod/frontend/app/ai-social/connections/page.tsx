'use client';

/**
 * AI Social - 连接管理（PR-4: 拆独立路由）
 *
 * 旧版作为 ConnectionsTab 与 ContentsTab/MissionsTab 平铺在主页 tabs，
 * 但绑账号是低频元操作（首次配置 / 偶尔续期），不该和高频的内容管理 / 发布
 * 平铺。拆到 /ai-social/connections 独立路由，主页头部仅保留入口链接。
 *
 * 设计稿：docs/architecture/ai-app/social/ui-redesign-2026-05-17.md 候选 A §1.3 痛点 7
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ArrowLeft, Link2, ShieldAlert, LogIn, Share2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { SocialErrorFallback } from '@/components/ai-social/feedback/SocialErrorFallback';
import ConnectionsTab from '@/components/ai-social/tabs/ConnectionsTab';
import { LoadingState } from '@/components/ui/states';

export default function AISocialConnectionsPage() {
  const { user, isLoading, isAdmin } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  if (isLoading) {
    return <LoadingState fullScreen text={t('aiSocial.loading')} />;
  }

  if (!user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="mx-auto max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-lg shadow-rose-500/25">
              <Share2 className="h-10 w-10 text-white" />
            </div>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">
            {t('aiSocial.signIn.title')}
          </h1>
          <p className="mb-8 text-gray-500">
            {t('aiSocial.signIn.description')}
          </p>
          <button
            onClick={() => router.push('/login')}
            className="inline-flex items-center gap-3 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 px-8 py-4 text-lg font-semibold text-white shadow-lg shadow-rose-500/25 transition-all hover:shadow-xl hover:shadow-rose-500/30"
          >
            <LogIn className="h-5 w-5" />
            {t('aiSocial.signIn.button')}
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="mx-auto max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-gray-400 to-gray-500 shadow-lg shadow-gray-500/25">
              <ShieldAlert className="h-10 w-10 text-white" />
            </div>
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">
            {t('aiSocial.accessDenied.title')}
          </h1>
          <p className="mb-8 text-gray-500">
            {t('aiSocial.accessDenied.description')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <SocialErrorFallback
          onReset={() => window.location.reload()}
          onReload={() => window.location.reload()}
          onGoHome={() => (window.location.href = '/')}
        />
      }
    >
      <div className="flex-1 overflow-auto">
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/50 backdrop-blur-sm">
          <div className="px-8 py-6">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => router.push('/ai-social')}
                className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50"
                aria-label={t('aiSocial.connectionsPage.back')}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
                <Link2 className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {t('aiSocial.connectionsPage.title')}
                </h1>
                <p className="text-sm text-gray-500">
                  {t('aiSocial.connectionsPage.subtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8">
          <ConnectionsTab />
        </div>
      </div>
    </ErrorBoundary>
  );
}
