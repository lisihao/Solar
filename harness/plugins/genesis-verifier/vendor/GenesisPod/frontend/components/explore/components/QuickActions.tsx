'use client';

import { useI18n } from '@/lib/i18n/i18n-context';

interface QuickActionsProps {
  onQuickAction: (action: 'summary' | 'insights' | 'methodology') => void;
  aiLoading: boolean;
  isStreaming: boolean;
}

export default function QuickActions({
  onQuickAction,
  aiLoading,
  isStreaming,
}: QuickActionsProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium text-gray-500">
        {t('explore.quickActions.title')}
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => onQuickAction('summary')}
          disabled={aiLoading || isStreaming}
          className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] transition-colors hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className="h-3 w-3 flex-shrink-0 text-red-600"
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
          <span className="truncate text-gray-700">
            {t('explore.quickActions.summary')}
          </span>
        </button>
        <button
          onClick={() => onQuickAction('insights')}
          disabled={aiLoading || isStreaming}
          className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] transition-colors hover:border-orange-300 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className="h-3 w-3 flex-shrink-0 text-orange-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <span className="truncate text-gray-700">
            {t('explore.quickActions.insights')}
          </span>
        </button>
        <button
          onClick={() => onQuickAction('methodology')}
          disabled={aiLoading || isStreaming}
          className="flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            className="h-3 w-3 flex-shrink-0 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 008 10.586V5L7 4z"
            />
          </svg>
          <span className="truncate text-gray-700">
            {t('explore.quickActions.methods')}
          </span>
        </button>
      </div>
    </div>
  );
}
