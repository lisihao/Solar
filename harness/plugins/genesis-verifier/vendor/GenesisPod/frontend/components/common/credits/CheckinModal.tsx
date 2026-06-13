'use client';

import { useEffect } from 'react';
import { useCreditsStore } from '@/stores';
import { useTranslation } from '@/lib/i18n';
import Modal from '@/components/ui/dialogs/Modal';

/**
 * 签到结果弹窗
 */
export default function CheckinModal() {
  const { t } = useTranslation();
  const { checkinModalOpen, checkinResult, hideCheckinModal, account } =
    useCreditsStore();

  // ESC 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hideCheckinModal();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [hideCheckinModal]);

  if (!checkinModalOpen || !checkinResult) return null;

  const {
    success,
    creditsEarned,
    streakDays,
    message,
    isStreakBonus,
    bonusType,
  } = checkinResult;

  return (
    <Modal
      open={checkinModalOpen}
      onClose={hideCheckinModal}
      title={
        success
          ? t('credits.checkin.successTitle')
          : t('credits.checkin.failedTitle')
      }
    >
      <div className="p-6 text-center">
        {/* 成功动画图标 */}
        {success ? (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-500">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        ) : (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M12 9v2m0 4h.01"
              />
            </svg>
          </div>
        )}

        {/* 标题 */}
        <h3 className="mb-2 text-xl font-bold text-gray-900">
          {success
            ? isStreakBonus
              ? t('credits.streakBonus')
              : t('credits.checkinSuccess')
            : t('credits.checkinFailed')}
        </h3>

        {/* 消息 */}
        <p className="mb-4 text-gray-600">{message}</p>

        {/* 成功时显示详情 */}
        {success && (
          <div className="mb-6 rounded-lg bg-gradient-to-br from-blue-50 to-purple-50 p-4">
            {/* 获得积分 */}
            <div className="mb-3 flex items-center justify-center gap-2">
              <span className="text-gray-600">+</span>
              <span className="text-3xl font-bold text-blue-600">
                {creditsEarned.toLocaleString()}
              </span>
              <span className="text-gray-600">{t('credits.credits')}</span>
            </div>

            {/* 连续签到天数 */}
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
              <svg
                className="h-4 w-4 text-orange-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <span>{t('credits.streakDays', { days: streakDays })}</span>
            </div>

            {/* 额外奖励提示 */}
            {isStreakBonus && bonusType && (
              <div className="mt-3 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 px-3 py-1 text-sm font-medium text-amber-700">
                {bonusType === 'streak7'
                  ? t('credits.streak7Bonus')
                  : t('credits.streak30Bonus')}
              </div>
            )}

            {/* 当前余额 */}
            <div className="mt-4 border-t border-gray-200 pt-3 text-sm text-gray-500">
              {t('credits.currentBalance')}:{' '}
              {account?.balance?.toLocaleString() ?? 0}
            </div>
          </div>
        )}

        {/* 关闭按钮 */}
        <button
          onClick={hideCheckinModal}
          className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 px-4 py-2.5 font-medium text-white transition-all hover:from-blue-600 hover:to-purple-600"
        >
          {t('common.confirm')}
        </button>
      </div>
    </Modal>
  );
}
