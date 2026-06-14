'use client';

import {
  CreditCard,
  TrendingUp,
  TrendingDown,
  Wallet,
  Crown,
  Calendar,
  Info,
} from 'lucide-react';
import {
  AdminDrawer,
  AdminStatsCards,
  AdminStatusBadge,
  AdminEmptyState,
  type AdminStatCard,
} from '@/components/admin/shared';
import { useTranslation } from '@/lib/i18n';
import ClientDate from '@/components/common/ClientDate';
import type { User } from '@/hooks/domain';

interface UserBillingDrawerProps {
  user: User | null;
  onClose: () => void;
}

/**
 * UserBillingDrawer — 用户计费 Drawer（5 行内按钮之一: [计费]）
 *
 * 计费维度:
 * - 订阅档位 (subscriptionTier / expiresAt)  — 后端 list response 可能未返回
 * - 累计积分流水 (totalEarned / totalSpent / 净额)
 * - 真实账单列表 (后端尚未提供 endpoint, 显示 placeholder)
 *
 * 升降级订阅操作: 后端无 admin endpoint, 不在 admin UI 暴露 (用户自助走 /pricing)。
 */
export default function UserBillingDrawer({
  user,
  onClose,
}: UserBillingDrawerProps) {
  const { t } = useTranslation();

  if (!user) {
    return null;
  }

  const totalEarned = user.credits?.totalEarned ?? 0;
  const totalSpent = user.credits?.totalSpent ?? 0;
  const netCredits = totalEarned - totalSpent;
  const balance = user.credits?.balance ?? 0;

  // 订阅信息当前 User type 未包含 (后端字段存在但 list response 未返回)
  // 用占位显示, 等后端扩展
  const subscriptionTier = 'free';
  const subscriptionExpiresAt: string | null = null;

  const stats: AdminStatCard[] = [
    {
      label: t('admin.users.billing.stats.balance'),
      value: balance.toLocaleString(),
      icon: Wallet,
      semantic: 'blue',
    },
    {
      label: t('admin.users.billing.stats.earned'),
      value: totalEarned.toLocaleString(),
      icon: TrendingUp,
      semantic: 'emerald',
    },
    {
      label: t('admin.users.billing.stats.spent'),
      value: totalSpent.toLocaleString(),
      icon: TrendingDown,
      semantic: 'amber',
    },
    {
      label: t('admin.users.billing.stats.net'),
      value: netCredits.toLocaleString(),
      icon: CreditCard,
      semantic: netCredits >= 0 ? 'emerald' : 'red',
    },
  ];

  return (
    <AdminDrawer
      open={!!user}
      onClose={onClose}
      title={t('admin.users.billing.title')}
      description={user.email ?? user.username ?? user.id}
      size="lg"
    >
      <div className="space-y-6">
        {/* 顶部 4 卡 (drawer ≤640px → 2x2 防数字 wrap) */}
        <AdminStatsCards cards={stats} columns={2} />

        {/* 订阅档位卡 */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.billing.subscriptionSection')}
          </h4>
          <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-violet-50 to-purple-50 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Crown
                    className={`h-5 w-5 ${
                      subscriptionTier === 'free'
                        ? 'text-gray-400'
                        : 'text-violet-600'
                    }`}
                  />
                  <span className="text-xl font-bold uppercase text-gray-900">
                    {subscriptionTier}
                  </span>
                  <AdminStatusBadge
                    status={subscriptionTier === 'free' ? 'inactive' : 'active'}
                    label={
                      subscriptionTier === 'free'
                        ? t('admin.users.billing.tier.free')
                        : t('admin.users.billing.tier.paid')
                    }
                    dot
                  />
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                  <Calendar className="h-3.5 w-3.5" />
                  {subscriptionExpiresAt ? (
                    <>
                      {t('admin.users.billing.expiresAt')}{' '}
                      <ClientDate
                        date={subscriptionExpiresAt}
                        format="datetime"
                      />
                    </>
                  ) : (
                    <span>{t('admin.users.billing.noExpiry')}</span>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              {t('admin.users.billing.subscriptionHint')}
            </p>
          </div>
        </section>

        {/* 账单流水 placeholder */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.billing.invoicesSection')}
          </h4>
          <AdminEmptyState
            icon={CreditCard}
            title={t('admin.users.billing.invoicesUnavailable')}
            description={t('admin.users.billing.invoicesHint')}
          />
        </section>

        {/* 提示 */}
        <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex gap-3">
            <Info className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <p className="text-xs text-gray-500">
              {t('admin.users.billing.crossRefHint')}
            </p>
          </div>
        </section>
      </div>
    </AdminDrawer>
  );
}
