'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import ImageGenerator from '@/components/ai-image/ImageGenerator';
import AppShell from '@/components/layout/AppShell';
import SignInPrompt from '@/components/common/SignInPrompt';
import { useTranslation } from '@/lib/i18n';
import { LoadingState } from '@/components/ui/states';

function AIImageCreateContent() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const initialImageId = searchParams?.get('id') || undefined;

  if (isLoading) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center p-8">
          <SignInPrompt />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex h-full flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-100 bg-white">
          <div className="px-6 py-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/ai-image')}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title={t('aiImage.back')}
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 shadow-md shadow-pink-500/20">
                <svg
                  className="h-5 w-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">
                  {initialImageId
                    ? t('aiImage.editImage')
                    : t('aiImage.createNew')}
                </h1>
                <p className="text-xs text-gray-500">
                  {t('aiImage.createDescription')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-auto">
          <ImageGenerator initialImageId={initialImageId} />
        </div>
      </main>
    </AppShell>
  );
}

export default function AIImageCreatePage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <LoadingState />
        </AppShell>
      }
    >
      <AIImageCreateContent />
    </Suspense>
  );
}
