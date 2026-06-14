'use client';

import { AlertCircle } from 'lucide-react';

import { useTranslation } from '@/lib/i18n';

export interface RadarBriefingErrorStateProps {
  error?: string;
  onRetry?: () => void;
}

export function RadarBriefingErrorState({
  error,
  onRetry,
}: RadarBriefingErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-6"
    >
      <p className="inline-flex items-center gap-1.5 font-semibold text-red-700">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        {t('radar.detail.briefingFailed')}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {onRetry && (
        <button
          onClick={onRetry}
          className="w-fit rounded-md border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          {t('radar.detail.retry')}
        </button>
      )}
    </div>
  );
}
