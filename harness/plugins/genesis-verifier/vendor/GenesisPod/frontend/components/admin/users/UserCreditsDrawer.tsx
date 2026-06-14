'use client';

import { useEffect, useState } from 'react';
import {
  Coins,
  TrendingUp,
  TrendingDown,
  Wallet,
  Lock,
  Unlock,
  Plus,
  Receipt,
} from 'lucide-react';
import {
  AdminDrawer,
  AdminStatsCards,
  AdminStatusBadge,
  AdminEmptyState,
  type AdminStatCard,
} from '@/components/admin/shared';
import { useTranslation } from '@/lib/i18n';
import { toast } from '@/stores';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import ClientDate from '@/components/common/ClientDate';
import type { User } from '@/hooks/domain';

interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  moduleType?: string;
  operationType?: string;
  createdAt: string;
}

interface UserCreditsDrawerProps {
  user: User | null;
  onClose: () => void;
  onGrant: (userId: string, amount: number, reason: string) => Promise<void>;
  onToggleFreeze: (userId: string, currentlyFrozen: boolean) => void;
  isLoading: boolean;
}

/**
 * UserCreditsDrawer — 用户积分 Drawer（5 行内按钮之一: [积分]）
 *
 * 完整呈现:
 * - 顶部 4 卡: balance / 累计获得 / 累计消耗 / 状态
 * - 发放积分 (表单)
 * - 冻结/解冻 (切换)
 * - 交易记录列表 (最近 N 条, /admin/credits/transactions/:userId)
 */
export default function UserCreditsDrawer({
  user,
  onClose,
  onGrant,
  onToggleFreeze,
  isLoading,
}: UserCreditsDrawerProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('');
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setTransactions([]);
      return;
    }
    let cancelled = false;
    const fetchTx = async () => {
      setLoadingTx(true);
      try {
        const res = await fetch(
          `${config.apiUrl}/admin/credits/transactions/${userId}?limit=20`,
          { headers: getAuthHeader() }
        );
        if (!res.ok) throw new Error('Failed to fetch transactions');
        const json = (await res.json()) as {
          data?: { transactions?: CreditTransaction[] };
          transactions?: CreditTransaction[];
        };
        const list = json?.data?.transactions ?? json?.transactions ?? [];
        if (!cancelled) setTransactions(list);
      } catch (err) {
        logger.error('Failed to fetch transactions:', err);
        if (!cancelled) setTransactions([]);
      } finally {
        if (!cancelled) setLoadingTx(false);
      }
    };
    void fetchTx();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!user) {
    return null;
  }

  const balance = user.credits?.balance ?? 0;
  const totalEarned = user.credits?.totalEarned ?? 0;
  const totalSpent = user.credits?.totalSpent ?? 0;
  const isFrozen = user.credits?.isFrozen ?? false;

  const stats: AdminStatCard[] = [
    {
      label: t('admin.users.credits.stats.balance'),
      value: balance.toLocaleString(),
      icon: Coins,
      semantic: 'amber',
    },
    {
      label: t('admin.users.credits.stats.earned'),
      value: totalEarned.toLocaleString(),
      icon: TrendingUp,
      semantic: 'emerald',
    },
    {
      label: t('admin.users.credits.stats.spent'),
      value: totalSpent.toLocaleString(),
      icon: TrendingDown,
      semantic: 'blue',
    },
    {
      label: t('admin.users.credits.stats.status'),
      value: isFrozen
        ? t('admin.users.credits.frozen')
        : t('admin.users.credits.active'),
      icon: Wallet,
      semantic: isFrozen ? 'red' : 'emerald',
    },
  ];

  const handleGrant = async () => {
    const n = parseInt(amount, 10) || 0;
    if (n <= 0) {
      toast.error(t('admin.users.credits.invalidAmount'));
      return;
    }
    try {
      await onGrant(user.id, n, reason);
      toast.success(t('admin.users.credits.grantSuccess', { amount: n }));
      setAmount('100');
      setReason('');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t('admin.users.credits.grantFailed');
      toast.error(msg);
    }
  };

  return (
    <AdminDrawer
      open={!!user}
      onClose={onClose}
      title={t('admin.users.credits.title')}
      description={user.email ?? user.username ?? user.id}
      size="lg"
    >
      <div className="space-y-6">
        {/* 顶部 4 卡 (drawer ≤640px → 2x2 防数字 wrap) */}
        <AdminStatsCards cards={stats} columns={2} />

        {/* 发放积分 */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.credits.grantSection')}
          </h4>
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                {t('admin.users.credits.amountLabel')}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700">
                {t('admin.users.credits.reasonLabel')}
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('admin.users.credits.reasonPlaceholder')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handleGrant}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {isLoading
                ? t('common.processing')
                : t('admin.users.credits.grantAction')}
            </button>
          </div>
        </section>

        {/* 账户状态切换 */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.credits.statusSection')}
          </h4>
          <button
            onClick={() => onToggleFreeze(user.id, isFrozen)}
            disabled={isLoading}
            className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              isFrozen
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            {isFrozen ? (
              <>
                <Unlock className="h-4 w-4" />
                {t('admin.users.credits.unfreezeAction')}
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" />
                {t('admin.users.credits.freezeAction')}
              </>
            )}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            {isFrozen
              ? t('admin.users.credits.frozenHint')
              : t('admin.users.credits.activeHint')}
          </p>
        </section>

        {/* 交易记录 */}
        <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Receipt className="h-4 w-4 text-gray-400" />
            {t('admin.users.credits.transactionsSection')}
            {!loadingTx && transactions.length > 0 && (
              <span className="text-xs font-normal text-gray-400">
                ({transactions.length})
              </span>
            )}
          </h4>
          {loadingTx ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-lg border border-gray-200 bg-white"
                />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <AdminEmptyState
              icon={Receipt}
              title={t('admin.users.credits.noTransactions')}
            />
          ) : (
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {transactions.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminDrawer>
  );
}

function TransactionRow({ tx }: { tx: CreditTransaction }) {
  const isCredit = tx.amount > 0;
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              isCredit
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {tx.type.replace(/_/g, ' ')}
          </span>
          {tx.moduleType && (
            <span className="font-mono text-[10px] text-gray-400">
              {tx.moduleType}
              {tx.operationType ? ` / ${tx.operationType}` : ''}
            </span>
          )}
        </div>
        {tx.description && (
          <p className="mt-1 truncate text-xs text-gray-500">
            {tx.description}
          </p>
        )}
      </div>
      <div className="ml-3 text-right">
        <div
          className={`text-sm font-semibold ${
            isCredit ? 'text-emerald-700' : 'text-amber-700'
          }`}
        >
          {isCredit ? '+' : ''}
          {tx.amount.toLocaleString()}
        </div>
        <div className="mt-0.5 text-[10px] text-gray-400">
          <ClientDate date={tx.createdAt} format="datetime" />
        </div>
      </div>
    </div>
  );
}
