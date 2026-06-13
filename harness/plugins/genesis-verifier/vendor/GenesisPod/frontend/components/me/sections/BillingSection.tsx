'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Gift,
  TrendingUp,
  Bookmark,
  Eye,
  MessageSquare,
  Calendar,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { useCredits, useCreditsStats, useCheckinHistory } from '@/hooks/domain';
import { useCreditsTransactions } from '@/hooks/domain/useCredits';
import { config } from '@/lib/utils/config';
import ClientDate from '@/components/common/ClientDate';
import { logger } from '@/lib/utils/logger';

interface UserStats {
  memberSince: string;
  stats: {
    bookmarked: number;
    viewed: number;
    comments: number;
    notes: number;
    reports: number;
    chatSessions: number;
    topicsCreated: number;
    imagesGenerated: number;
  };
}

/**
 * 账单 /me/billing — 一镜到底重设计（2026-05-23）：
 *   焦点 = 积分余额 + 签到（渐变 hero 放大）；累计/消耗/今日等副指标压进 hero 底栏。
 *   签到 / 交易记录 / 用量统计 收进单一内容白卡（小标题分隔的连续流，非多卡堆叠）。
 */
export function BillingSection() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const {
    account,
    checkinStatus,
    isCheckingIn,
    performCheckin,
    showCheckinModal,
    refreshAccount,
    refreshCheckinStatus,
  } = useCredits();
  const { stats } = useCreditsStats();
  const { transactions } = useCreditsTransactions({ limit: 10 });
  const { history: checkinHistory } = useCheckinHistory(7);

  const [userStats, setUserStats] = useState<UserStats | null>(null);

  const safeCheckinHistory = Array.isArray(checkinHistory)
    ? checkinHistory
    : [];
  const safeTransactions = Array.isArray(transactions) ? transactions : [];

  const fetchUserStats = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${config.apiUrl}/auth/stats`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) {
        const result = (await response.json()) as
          | { data?: UserStats }
          | UserStats;
        const data = 'data' in result && result.data ? result.data : result;
        setUserStats(data as UserStats);
      }
    } catch (error) {
      logger.error('Failed to fetch user stats:', error);
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchUserStats();
  }, [fetchUserStats]);

  const handleCheckin = async () => {
    if (!checkinStatus?.canCheckin || isCheckingIn) return;
    await performCheckin();
    showCheckinModal();
    void refreshAccount();
    void refreshCheckinStatus();
  };

  const totalEarned = (
    stats?.totalEarned ??
    account?.totalEarned ??
    0
  ).toLocaleString();
  const totalSpent = (
    stats?.totalSpent ??
    account?.totalSpent ??
    0
  ).toLocaleString();

  return (
    <div className="space-y-5">
      {/* 焦点：余额 + 签到（渐变 hero，副指标压底栏） */}
      <div className="overflow-hidden rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 p-5 text-white shadow-sm md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider opacity-75">
              {t('credits.currentBalance')}
            </div>
            <div className="mt-1 text-4xl font-bold leading-none">
              {account?.balance?.toLocaleString() ?? 0}
            </div>
            <div className="mt-1.5 text-xs opacity-70">
              {t('credits.credits')}
            </div>
          </div>
          {checkinStatus?.canCheckin ? (
            <button
              onClick={handleCheckin}
              disabled={isCheckingIn}
              className="rounded-full bg-white/20 px-4 py-2 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-white/30 disabled:opacity-50"
            >
              {t('credits.checkin')}
            </button>
          ) : checkinStatus?.hasCheckedInToday ? (
            <span className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium">
              {t('credits.streakDays', { days: checkinStatus.streakDays })}
            </span>
          ) : null}
        </div>
        {/* 副指标：累计 / 消耗 / 今日·周·月 */}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-white/20 pt-3 text-sm">
          <HeroStat
            label={t('credits.totalEarned')}
            value={`+${totalEarned}`}
          />
          <HeroStat label={t('credits.totalSpent')} value={totalSpent} />
          <HeroStat
            label={t('credits.todaySpent')}
            value={`${stats?.todaySpent ?? account?.todaySpent ?? 0}`}
          />
          <HeroStat
            label={t('credits.weekSpent')}
            value={`${stats?.weekSpent ?? 0}`}
          />
          <HeroStat
            label={t('credits.monthSpent')}
            value={`${stats?.monthSpent ?? 0}`}
          />
        </div>
      </div>

      {/* 内容白卡：签到 / 交易 / 用量 收进单一连续面 */}
      <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 md:p-6">
        {/* 每日签到 — 紧凑 */}
        <section>
          <SectionLabel>{t('credits.dailyCheckin')}</SectionLabel>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-1.5">
              {safeCheckinHistory.map((day, idx) => (
                <div
                  key={idx}
                  className="flex h-9 w-9 flex-col items-center justify-center rounded-md bg-green-50 text-green-700 ring-1 ring-green-100"
                >
                  <Gift className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-medium leading-none">
                    {day.streakDays}
                  </span>
                </div>
              ))}
              {Array.from({
                length: Math.max(0, 7 - safeCheckinHistory.length),
              }).map((_, idx) => (
                <div
                  key={`empty-${idx}`}
                  className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-50 text-gray-300 ring-1 ring-gray-100"
                >
                  <Gift className="h-3.5 w-3.5" />
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500">
              {checkinStatus?.hasCheckedInToday
                ? t('credits.streakDays', { days: checkinStatus.streakDays })
                : checkinStatus?.message ||
                  t('credits.dailyCheckinDesc', { credits: 50 })}
            </p>
          </div>
        </section>

        {/* 交易记录 — 紧凑列表（卡内，无嵌套边框） */}
        <section>
          <SectionLabel>{t('credits.transactions')}</SectionLabel>
          {safeTransactions.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {safeTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-700">
                      {tx.description}
                    </p>
                    <p className="text-xs text-gray-400">
                      <ClientDate date={tx.createdAt} format="datetime" />
                    </p>
                  </div>
                  <span
                    className={`flex-shrink-0 text-sm font-semibold tabular-nums ${
                      tx.amount > 0 ? 'text-green-600' : 'text-gray-600'
                    }`}
                  >
                    {tx.amount > 0 ? '+' : ''}
                    {tx.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-gray-500">
              {t('credits.noTransactions')}
            </p>
          )}
        </section>

        {/* 用量统计 — 压一行（卡内） */}
        <section>
          <SectionLabel>{t('me.billing.usage')}</SectionLabel>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <UsageInline
              icon={<Bookmark className="h-4 w-4 text-violet-600" />}
              label={t('profile.stats.bookmarked')}
              value={userStats?.stats.bookmarked ?? 0}
            />
            <UsageInline
              icon={<Eye className="h-4 w-4 text-blue-600" />}
              label={t('profile.stats.resourcesViewed')}
              value={userStats?.stats.viewed ?? 0}
            />
            <UsageInline
              icon={<MessageSquare className="h-4 w-4 text-green-600" />}
              label={t('profile.stats.comments')}
              value={userStats?.stats.comments ?? 0}
            />
            <UsageInline
              icon={<TrendingUp className="h-4 w-4 text-amber-600" />}
              label={t('profile.stats.aiChats')}
              value={userStats?.stats.chatSessions ?? 0}
            />
            <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
              <Calendar className="h-3.5 w-3.5" />
              {t('profile.stats.memberSince')}:{' '}
              {userStats?.memberSince ? (
                <ClientDate
                  date={userStats.memberSince}
                  format="date"
                  dateOptions={{ year: 'numeric', month: 'long' }}
                />
              ) : (
                'N/A'
              )}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

/** 轻量 section 小标题（卡内连续流分隔） */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
      {children}
    </h3>
  );
}

/** hero 底栏副指标 */
function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-sm">
      <span className="opacity-70">{label} </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

/** 用量统计内联项 */
function UsageInline({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-gray-600">
      {icon}
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold tabular-nums text-gray-900">{value}</span>
    </span>
  );
}
