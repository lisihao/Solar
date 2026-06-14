'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  Search,
  Coins,
  History,
  Monitor,
  Globe,
  Calendar,
  UserCog,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Inbox,
} from 'lucide-react';
import {
  AdminModal,
  AdminStatsCards,
  type AdminStatCard,
} from '@/components/admin/shared';
import {
  UserDetailDrawer,
  UserRoleDrawer,
  UserCreditsDrawer,
  UserModelsDrawer,
  UserBillingDrawer,
  PendingApprovalDrawer,
} from './users';
import {
  useAdminUsers,
  useUserStats,
  type User,
  type CreateUserData,
  type LoginHistoryItem,
} from '@/hooks/domain';
import { useTranslation } from '@/lib/i18n';
import { LoadingState, ErrorState, useConfirm } from '@/components/ui';
import ClientDate from '@/components/common/ClientDate';
import { TruncatedCell } from '@/components/common/tables';

// ─── Page-level action buttons (used by page.tsx via AdminPageLayout.actions) ─

export function UsersAddButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
    >
      <UserPlus className="h-5 w-5" />
      {t('admin.users.addUser')}
    </button>
  );
}

/**
 * UsersPendingApprovalButton — top-action button (与 UsersAddButton 同一位置/同样式)
 * 内嵌 PENDING 计数徽章。从 UsersSettings 内部位置迁移到 page-level actions
 * 是用户视觉反馈：审批按钮应与添加用户在同一区域。
 */
export function UsersPendingApprovalButton({
  onClick,
  count,
}: {
  onClick: () => void;
  count: number;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
    >
      <Inbox className="h-5 w-5" />
      {t('admin.users.pendingApproval.button')}
      {count > 0 && (
        <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-bold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

export function UsersSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        placeholder={t('admin.users.searchPlaceholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-12 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

interface UsersSettingsProps {
  searchQuery: string;
  showAddModal: boolean;
  setShowAddModal: (show: boolean) => void;
  showPendingApproval: boolean;
  setShowPendingApproval: (show: boolean) => void;
}

// ─── AddUserModal (Drawer 化暂不做，保持 Modal) ────────────────────────────────

function AddUserModal({
  isOpen,
  onClose,
  onCreate,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: CreateUserData) => Promise<void>;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<CreateUserData>({
    email: '',
    password: '',
    role: 'USER',
  });

  const handleSubmit = async () => {
    if (!formData.email) return;
    await onCreate(formData);
    setFormData({ email: '', password: '', role: 'USER' });
    onClose();
  };

  return (
    <AdminModal
      open={isOpen}
      onClose={onClose}
      title={t('admin.users.addUserModal.title')}
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!formData.email || !formData.password || isLoading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading
              ? t('admin.users.addUserModal.creating')
              : t('admin.users.addUserModal.create')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {t('admin.users.addUserModal.email')}{' '}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            placeholder="user@example.com"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {t('admin.users.addUserModal.password')}{' '}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            value={formData.password || ''}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
            placeholder={t('admin.users.addUserModal.passwordPlaceholder')}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {t('admin.users.addUserModal.role')}
          </label>
          <select
            value={formData.role}
            onChange={(e) =>
              setFormData({
                ...formData,
                role: e.target.value as 'USER' | 'ADMIN',
              })
            }
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="USER">{t('admin.users.role.user')}</option>
            <option value="ADMIN">{t('admin.users.role.admin')}</option>
          </select>
        </div>
      </div>
    </AdminModal>
  );
}

// ─── LoginHistoryModal (保留作为表格列 [查看历史] 触发) ─────────────────────────

function LoginHistoryModal({
  isOpen,
  onClose,
  history,
  userName,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  history: LoginHistoryItem[];
  userName: string;
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  return (
    <AdminModal
      open={isOpen}
      onClose={onClose}
      title={t('admin.users.loginHistory.title')}
      description={userName}
      size="lg"
      footer={
        <button
          onClick={onClose}
          className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          {t('common.close')}
        </button>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : history.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <History className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p>{t('admin.users.loginHistory.noHistory')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <Monitor className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                      {item.device ||
                        t('admin.users.loginHistory.unknownDevice')}
                      {item.browser && (
                        <span className="text-gray-500">- {item.browser}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {item.os && <span>{item.os}</span>}
                      {item.ipAddress && (
                        <span className="flex items-center gap-1">
                          <Globe className="h-3 w-3" />
                          {item.ipAddress}
                        </span>
                      )}
                      {item.location && <span>{item.location}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Calendar className="h-3.5 w-3.5" />
                  <ClientDate date={item.loginAt} format="datetime" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminModal>
  );
}

// ─── UserStatsCards (复用 AdminStatsCards) ────────────────────────────────────

function UserStatsCards() {
  const { t } = useTranslation();
  const { stats, loading } = useUserStats();

  const cards: AdminStatCard[] = stats
    ? [
        {
          label: t('admin.users.stats.totalUsers'),
          value: stats.totalUsers.toLocaleString(),
          icon: Users,
          semantic: 'blue',
        },
        {
          label: t('admin.users.stats.weeklyActive'),
          value: stats.weeklyActiveUsers.toLocaleString(),
          icon: TrendingUp,
          semantic: 'emerald',
        },
        {
          label: t('admin.users.stats.newThisMonth'),
          value: stats.newUsersThisMonth.toLocaleString(),
          icon: UserPlus,
          semantic: 'blue',
        },
        {
          label: t('admin.users.stats.adminCount'),
          value: stats.adminCount.toLocaleString(),
          icon: UserCog,
          semantic: 'amber',
        },
      ]
    : [];

  return <AdminStatsCards cards={cards} loading={loading} className="mb-6" />;
}

// ─── Main UsersSettings ───────────────────────────────────────────────────────

export default function UsersSettings({
  searchQuery,
  showAddModal,
  setShowAddModal,
  showPendingApproval,
  setShowPendingApproval,
}: UsersSettingsProps) {
  const { t } = useTranslation();
  const {
    users,
    loading,
    error,
    refreshUsers,
    createUser,
    updateUser,
    deleteUser,
    isCreating,
    isUpdating,
    isDeleting,
    grantCredits,
    toggleCreditFreeze,
    isCreditsLoading,
    fetchLoginHistory,
    pagination,
    page,
    goToPage,
    nextPage,
    prevPage,
  } = useAdminUsers();

  // 行内 5 Drawer state
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [roleUser, setRoleUser] = useState<User | null>(null);
  const [creditsUser, setCreditsUser] = useState<User | null>(null);
  const [modelsUser, setModelsUser] = useState<User | null>(null);
  const [billingUser, setBillingUser] = useState<User | null>(null);

  // Login history 表格列触发
  const [loginHistoryUser, setLoginHistoryUser] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const handleViewLoginHistory = async (user: User) => {
    setLoginHistoryUser({
      id: user.id,
      name: user.name || user.username || user.email || 'User',
    });
    setLoadingHistory(true);
    try {
      const history = await fetchLoginHistory(user.id, 5);
      setLoginHistory(history);
    } catch {
      setLoginHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const { confirm, dialog } = useConfirm({
    title: t('admin.users.deleteConfirm.title'),
    description: t('admin.users.deleteConfirm.description'),
    type: 'danger',
    confirmText: t('admin.users.deleteConfirm.confirm'),
  });

  const { confirm: confirmFreeze, dialog: freezeDialog } = useConfirm({
    title: t('admin.users.freezeConfirm.title'),
    description: t('admin.users.freezeConfirm.description'),
    type: 'warning',
    confirmText: t('admin.users.freezeConfirm.confirm'),
  });

  const filteredUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          (user.email || '')
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          (user.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (user.username || '')
            .toLowerCase()
            .includes(searchQuery.toLowerCase())
      ),
    [users, searchQuery]
  );

  const handleDeleteUser = (userId: string) => {
    confirm(async () => {
      await deleteUser(userId);
    });
  };

  const handleToggleFreeze = (userId: string, currentlyFrozen: boolean) => {
    if (!currentlyFrozen) {
      confirmFreeze(async () => {
        await toggleCreditFreeze(userId, true);
      });
    } else {
      toggleCreditFreeze(userId, false);
    }
  };

  if (loading) {
    return <LoadingState text={t('admin.users.loading')} />;
  }

  if (error) {
    return (
      <ErrorState
        error={error.message || t('admin.users.unknownError')}
        onRetry={refreshUsers}
        title={t('admin.users.loadFailed')}
      />
    );
  }

  return (
    <>
      {dialog}
      {freezeDialog}

      {/* 顶部 Modal/Drawer 挂载 */}
      <AddUserModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreate={async (data) => {
          await createUser(data);
        }}
        isLoading={isCreating}
      />

      <LoginHistoryModal
        isOpen={!!loginHistoryUser}
        onClose={() => {
          setLoginHistoryUser(null);
          setLoginHistory([]);
        }}
        history={loginHistory}
        userName={loginHistoryUser?.name || 'User'}
        isLoading={loadingHistory}
      />

      {/* 行内 5 Drawer */}
      <UserDetailDrawer
        user={detailUser}
        onClose={() => setDetailUser(null)}
        onSave={async (id, data) => {
          await updateUser(id, data);
        }}
        isLoading={isUpdating}
      />

      <UserRoleDrawer
        user={roleUser}
        onClose={() => setRoleUser(null)}
        onRoleChange={async (userId, newRole) => {
          await updateUser(userId, { role: newRole });
        }}
        isLoading={isUpdating}
      />

      <UserCreditsDrawer
        user={creditsUser}
        onClose={() => setCreditsUser(null)}
        onGrant={async (userId, amount, reason) => {
          await grantCredits(userId, amount, reason);
        }}
        onToggleFreeze={handleToggleFreeze}
        isLoading={isCreditsLoading}
      />

      <UserModelsDrawer user={modelsUser} onClose={() => setModelsUser(null)} />

      <UserBillingDrawer
        user={billingUser}
        onClose={() => setBillingUser(null)}
      />

      {/* 顶部全局聚合 Drawer */}
      <PendingApprovalDrawer
        open={showPendingApproval}
        onClose={() => setShowPendingApproval(false)}
      />

      <UserStatsCards />

      {/* Users Table */}
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('admin.users.table.user')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('admin.users.table.role')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('admin.users.table.status')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('admin.users.table.credits')}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('admin.users.loginHistory.title')}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('admin.users.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-12 text-center text-gray-500"
                >
                  <Users className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                  <p>{t('admin.users.noUsersFound')}</p>
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-2.5">
                    <div className="flex items-center">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
                        <span className="text-sm font-medium text-blue-600">
                          {(user.name || user.username || user.email || '?')
                            .charAt(0)
                            .toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4 min-w-0">
                        <TruncatedCell
                          className="max-w-[200px] text-sm font-medium text-gray-900"
                          tooltip={`${user.name || user.username || user.email || t('admin.users.unknownUser')} · ${user.email || ''}`}
                        >
                          {user.name ||
                            user.username ||
                            user.email ||
                            t('admin.users.unknownUser')}
                        </TruncatedCell>
                        <TruncatedCell className="max-w-[200px] text-sm text-gray-500">
                          {user.email || '-'}
                        </TruncatedCell>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${
                        (user.role || '').toLowerCase() === 'admin'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {user.role?.toLowerCase() || 'user'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-2.5">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${
                        user.status === 'active'
                          ? 'bg-emerald-100 text-emerald-700'
                          : user.status === 'banned'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {user.status || 'active'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-2.5">
                    {user.credits ? (
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
                            <Coins className="h-4 w-4 text-amber-500" />
                            {user.credits.balance.toLocaleString()}
                          </div>
                          {user.credits.isFrozen && (
                            <span className="text-xs text-red-600">
                              {t('admin.users.credits.frozen')}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-2.5">
                    <button
                      onClick={() => handleViewLoginHistory(user)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
                    >
                      <History className="h-4 w-4" />
                      <span>{t('admin.users.viewHistory')}</span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-2.5 text-right text-sm">
                    {/*
                      Wave 4 (2026-05-11): 行内 5 命名按钮 + Delete 兜底
                      - 详情 = UserDetailDrawer (综合身份视图)
                      - 角色 = UserRoleDrawer (USER↔ADMIN)
                      - 积分 = UserCreditsDrawer (balance + grant + freeze + 交易)
                      - 模型 = UserModelsDrawer (KeyAssignment + BYOK 请求)
                      - 计费 = UserBillingDrawer (订阅 + 累计)
                    */}
                    <div className="flex items-center justify-end gap-1.5">
                      <RowButton
                        onClick={() => setDetailUser(user)}
                        label={t('admin.users.actions.detail')}
                      />
                      <RowButton
                        onClick={() => setRoleUser(user)}
                        label={t('admin.users.actions.role')}
                      />
                      <RowButton
                        onClick={() => setCreditsUser(user)}
                        disabled={isCreditsLoading}
                        label={t('admin.users.actions.credits')}
                      />
                      <RowButton
                        onClick={() => setModelsUser(user)}
                        label={t('admin.users.actions.models')}
                      />
                      <RowButton
                        onClick={() => setBillingUser(user)}
                        label={t('admin.users.actions.billing')}
                      />
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        disabled={isDeleting}
                        className="ml-1 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        title={t('admin.users.actions.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {t('common.showing')} {(page - 1) * pagination.limit + 1}-
            {Math.min(page * pagination.limit, pagination.total)}{' '}
            {t('common.of')} {pagination.total}{' '}
            {t('admin.users.title').toLowerCase()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={prevPage}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              {t('common.previous')}
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === pagination.totalPages ||
                    Math.abs(p - page) <= 1
                )
                .map((p, idx, arr) => (
                  <span key={p} className="flex items-center">
                    {idx > 0 && arr[idx - 1] !== p - 1 && (
                      <span className="px-1 text-gray-400">...</span>
                    )}
                    <button
                      onClick={() => goToPage(p)}
                      className={`min-w-[32px] rounded-lg px-2 py-1 text-sm font-medium transition-colors ${
                        p === page
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {p}
                    </button>
                  </span>
                ))}
            </div>
            <button
              onClick={nextPage}
              disabled={page === pagination.totalPages}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common.next')}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Row action button (统一样式) ────────────────────────────────────────────

function RowButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
