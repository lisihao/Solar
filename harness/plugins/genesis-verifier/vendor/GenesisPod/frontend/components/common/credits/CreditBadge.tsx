'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useCreditsStore } from '@/stores';
import { useTranslation } from '@/lib/i18n';

interface CreditBadgeProps {
  isCollapsed?: boolean;
  showCheckinButton?: boolean;
}

/**
 * 积分徽章组件
 * 显示用户当前积分余额，可选显示签到按钮
 */
export default function CreditBadge({
  isCollapsed = false,
  showCheckinButton = true,
}: CreditBadgeProps) {
  const { t } = useTranslation();
  const {
    account,
    checkinStatus,
    isCheckingIn,
    fetchBalance,
    fetchCheckinStatus,
    performCheckin,
    showCheckinModal,
  } = useCreditsStore();

  // 初始化加载
  useEffect(() => {
    fetchBalance();
    fetchCheckinStatus();
  }, [fetchBalance, fetchCheckinStatus]);

  const balance = account?.balance ?? 0;
  const isLow = account?.isLow ?? false;
  const isCritical = account?.isCritical ?? false;
  const canCheckin = checkinStatus?.canCheckin ?? false;

  // 格式化积分显示
  const formatCredits = (credits: number): string => {
    if (credits >= 10000) {
      return `${(credits / 1000).toFixed(1)}k`;
    }
    return credits.toLocaleString();
  };

  // 获取余额颜色
  const getBalanceColor = () => {
    if (isCritical) return 'text-red-600';
    if (isLow) return 'text-amber-600';
    return 'text-gray-700';
  };

  // 获取背景颜色
  const getBgColor = () => {
    if (isCritical) return 'bg-red-50 hover:bg-red-100';
    if (isLow) return 'bg-amber-50 hover:bg-amber-100';
    return 'bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100';
  };

  // 处理签到点击
  const handleCheckin = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!canCheckin || isCheckingIn) return;

    await performCheckin();
    showCheckinModal();
  };

  if (isCollapsed) {
    // 折叠模式：只显示图标和余额
    return (
      <Link
        href="/me/billing"
        className={`flex flex-col items-center justify-center rounded-lg p-2 ${getBgColor()} transition-colors`}
        title={`${t('credits.balance')}: ${balance.toLocaleString()}`}
      >
        {/* 硬币图标 */}
        <svg
          className={`h-5 w-5 ${getBalanceColor()}`}
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
        <span className={`mt-0.5 text-xs font-medium ${getBalanceColor()}`}>
          {formatCredits(balance)}
        </span>
        {/* 签到指示点 */}
        {canCheckin && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500" />
        )}
      </Link>
    );
  }

  // 展开模式：显示完整信息
  return (
    <div className={`rounded-lg p-2 ${getBgColor()} transition-colors`}>
      <Link
        href="/me/billing"
        className="flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          {/* 硬币图标 */}
          <div className="relative">
            <svg
              className={`h-5 w-5 ${getBalanceColor()}`}
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
          </div>
          <div className="flex flex-col">
            <span className={`text-sm font-semibold ${getBalanceColor()}`}>
              {balance.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">
              {t('credits.credits')}
            </span>
          </div>
        </div>

        {/* 签到按钮 */}
        {showCheckinButton && canCheckin && (
          <button
            onClick={handleCheckin}
            disabled={isCheckingIn}
            className="flex items-center gap-1 rounded-full bg-green-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-green-600 disabled:opacity-50"
          >
            {isCheckingIn ? (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
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
                className="h-3 w-3"
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
            {t('credits.checkin')}
          </button>
        )}

        {/* 低余额警告图标 */}
        {(isLow || isCritical) && !canCheckin && (
          <svg
            className={`h-4 w-4 ${isCritical ? 'text-red-500' : 'text-amber-500'}`}
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
        )}
      </Link>
    </div>
  );
}
