'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useReportWorkspace } from '@/hooks';
import { config } from '@/lib/utils/config';

export default function ReportWorkspace() {
  const { t } = useI18n();
  const router = useRouter();
  const { resources, removeResource, clearAll, maxResources } =
    useReportWorkspace();

  // Manually hydrate the store on client side
  useEffect(() => {
    useReportWorkspace.persist.rehydrate();
  }, []);

  if (resources.length === 0) return null;

  return (
    <>
      {/* Simple notification bar */}
      <div className="fixed left-0 right-0 top-0 z-40 bg-gradient-to-r from-red-500 to-pink-500 shadow-lg">
        <div className="mx-auto max-w-7xl px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-white">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white bg-opacity-20">
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
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <div className="font-semibold">
                  {t('topicResearch.reportPanels.workspace.selectedResources', {
                    count: resources.length,
                  })}
                </div>
                <div className="text-xs text-white text-opacity-90">
                  {resources.length >= 2
                    ? t('topicResearch.reportPanels.workspace.readyToStart')
                    : t('topicResearch.reportPanels.workspace.selectMore')}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/workspace')}
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-red-600 transition-all hover:bg-gray-100"
              >
                {t('topicResearch.reportPanels.workspace.enterWorkspace')}
              </button>
              <button
                onClick={clearAll}
                className="rounded-lg px-3 py-2 text-sm text-white transition-colors hover:bg-white hover:bg-opacity-20"
              >
                {t('topicResearch.reportPanels.workspace.clearAll')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer to prevent content from going under fixed bar */}
      <div className="h-14"></div>
    </>
  );
}
