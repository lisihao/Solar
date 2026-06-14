'use client';

import { Trash2, Send, X, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface BatchActionBarProps {
  selectedCount: number;
  totalCount: number;
  onClearSelection: () => void;
  onBatchDelete: () => void;
  onBatchPublish?: () => void;
  isDeleting?: boolean;
  isPublishing?: boolean;
  showPublishAction?: boolean;
}

export function BatchActionBar({
  selectedCount,
  totalCount,
  onClearSelection,
  onBatchDelete,
  onBatchPublish,
  isDeleting = false,
  isPublishing = false,
  showPublishAction = false,
}: BatchActionBarProps) {
  const { t } = useTranslation();

  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transform">
      <div className="flex items-center gap-4 rounded-full border border-gray-200 bg-white px-6 py-3 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">
            {t('aiSocial.batch.selected', {
              count: selectedCount,
              total: totalCount,
            })}
          </span>
        </div>

        <div className="h-4 w-px bg-gray-300" />

        <div className="flex items-center gap-2">
          {showPublishAction && (
            <button
              onClick={onBatchPublish}
              disabled={isPublishing || isDeleting}
              className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t('aiSocial.batch.publish')}
            >
              {isPublishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('aiSocial.batch.publishing')}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {t('aiSocial.batch.publish')}
                </>
              )}
            </button>
          )}

          <button
            onClick={onBatchDelete}
            disabled={isDeleting || isPublishing}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('aiSocial.batch.delete')}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('aiSocial.batch.deleting')}
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                {t('aiSocial.batch.delete')}
              </>
            )}
          </button>

          <button
            onClick={onClearSelection}
            disabled={isDeleting || isPublishing}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('common.cancel')}
          >
            <X className="h-4 w-4" />
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
