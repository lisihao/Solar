'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useCreditsStore } from '@/stores';
import { useTranslation } from '@/lib/i18n';
import Modal from '@/components/ui/dialogs/Modal';

/**
 * 余额不足弹窗
 */
export default function InsufficientCreditsModal() {
  const { t } = useTranslation();
  const {
    insufficientModalOpen,
    insufficientData,
    hideInsufficientModal,
    checkinStatus,
    performCheckin,
    isCheckingIn,
    showCheckinModal,
  } = useCreditsStore();

  // ESC 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideInsufficientModal();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [hideInsufficientModal]);

  if (!insufficientModalOpen || !insufficientData) return null;

  const { required, available, deficit } = insufficientData;
  const canCheckin = checkinStatus?.canCheckin ?? false;

  // 处理签到
  const handleCheckin = async () => {
    await performCheckin();
    hideInsufficientModal();
    showCheckinModal();
  };

  return (
    <Modal
      open={insufficientModalOpen}
      onClose={hideInsufficientModal}
      title={t('credits.insufficientBalance')}
    >
      <div className="p-6">
        {/* 警告图标 */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-red-400 to-orange-500">
          <svg
            className="h-8 w-8 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* 标题 */}
        <h3 className="mb-2 text-center text-xl font-bold text-gray-900">
          {t('credits.insufficientCredits')}
        </h3>

        {/* 描述 */}
        <p className="mb-6 text-center text-gray-600">
          {t('credits.insufficientDescription')}
        </p>

        {/* 积分信息 */}
        <div className="mb-6 rounded-lg bg-gray-50 p-4">
          <div className="flex items-center justify-between border-b border-gray-200 pb-2">
            <span className="text-gray-600">{t('credits.required')}</span>
            <span className="font-semibold text-gray-900">
              {required.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-gray-200 py-2">
            <span className="text-gray-600">{t('credits.available')}</span>
            <span className="font-semibold text-red-600">
              {available.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-gray-600">{t('credits.deficit')}</span>
            <span className="font-bold text-red-600">
              -{deficit.toLocaleString()}
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="space-y-3">
          {/* 签到获取积分 */}
          {canCheckin && (
            <button
              onClick={handleCheckin}
              disabled={isCheckingIn}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-2.5 font-medium text-white transition-all hover:from-green-600 hover:to-emerald-600 disabled:opacity-50"
            >
              {isCheckingIn ? (
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
              {t('credits.checkinToGetCredits')}
            </button>
          )}

          {/* 前往积分中心 */}
          <Link
            href="/me/billing"
            onClick={hideInsufficientModal}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2.5 font-medium text-white transition-all hover:from-blue-600 hover:to-purple-600"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="8" strokeWidth={2} />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6v12M9 9h6M9 15h6"
              />
            </svg>
            {t('credits.viewCreditsCenter')}
          </Link>

          {/* 关闭按钮 */}
          <button
            onClick={hideInsufficientModal}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
