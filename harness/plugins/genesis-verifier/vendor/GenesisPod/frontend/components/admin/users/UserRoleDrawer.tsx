'use client';

import { ShieldCheck, ShieldOff, User as UserIcon, Info } from 'lucide-react';
import { AdminDrawer, AdminStatusBadge } from '@/components/admin/shared';
import { useTranslation } from '@/lib/i18n';
import { toast } from '@/stores';
import type { User } from '@/hooks/domain';

interface UserRoleDrawerProps {
  user: User | null;
  onClose: () => void;
  onRoleChange: (userId: string, newRole: 'USER' | 'ADMIN') => Promise<void>;
  isLoading: boolean;
}

/**
 * UserRoleDrawer — 用户角色 Drawer（5 行内按钮之一: [角色]）
 *
 * 纯粹的 USER ↔ ADMIN 角色切换。
 * 模型授权（KeyAssignment）不在这里，走 [模型] Drawer；
 * BYOK 申请审批不在这里，走 [模型] Drawer 内的 PendingRequests 区。
 */
export default function UserRoleDrawer({
  user,
  onClose,
  onRoleChange,
  isLoading,
}: UserRoleDrawerProps) {
  const { t } = useTranslation();

  if (!user) {
    return null;
  }

  const isAdmin = (user.role || '').toUpperCase() === 'ADMIN';

  const handleToggle = async () => {
    const newRole: 'USER' | 'ADMIN' = isAdmin ? 'USER' : 'ADMIN';
    try {
      await onRoleChange(user.id, newRole);
      toast.success(
        isAdmin
          ? t('admin.users.role.demoteSuccess')
          : t('admin.users.role.promoteSuccess')
      );
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('admin.users.role.changeFailed');
      toast.error(msg);
    }
  };

  return (
    <AdminDrawer
      open={!!user}
      onClose={onClose}
      title={t('admin.users.role.title')}
      description={user.email ?? user.username ?? user.id}
      size="md"
    >
      <div className="space-y-6">
        {/* 当前角色 hero */}
        <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('admin.users.role.currentRole')}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <ShieldCheck
                  className={`h-7 w-7 ${isAdmin ? 'text-blue-600' : 'text-gray-400'}`}
                />
                <span className="text-2xl font-bold text-gray-900">
                  {isAdmin
                    ? t('admin.users.role.admin')
                    : t('admin.users.role.user')}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-600">
                {isAdmin
                  ? t('admin.users.role.adminDesc')
                  : t('admin.users.role.userDesc')}
              </p>
            </div>
            <AdminStatusBadge
              status={isAdmin ? 'active' : 'inactive'}
              label={isAdmin ? 'ADMIN' : 'USER'}
              dot
            />
          </div>
        </div>

        {/* 操作 */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.role.actions')}
          </h4>
          {isAdmin ? (
            <button
              onClick={handleToggle}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
            >
              <ShieldOff className="h-4 w-4" />
              {isLoading
                ? t('common.processing')
                : t('admin.users.role.demoteAction')}
            </button>
          ) : (
            <button
              onClick={handleToggle}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              {isLoading
                ? t('common.processing')
                : t('admin.users.role.promoteAction')}
            </button>
          )}
        </section>

        {/* 角色影响说明 */}
        <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex gap-3">
            <Info className="h-4 w-4 flex-shrink-0 text-gray-400" />
            <div className="space-y-2 text-xs text-gray-600">
              <p className="font-medium text-gray-900">
                {t('admin.users.role.impactTitle')}
              </p>
              <ul className="space-y-1 text-gray-500">
                <li className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3 w-3 text-blue-600" />
                  <span>{t('admin.users.role.impactAdmin1')}</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3 w-3 text-blue-600" />
                  <span>{t('admin.users.role.impactAdmin2')}</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <UserIcon className="mt-0.5 h-3 w-3 text-gray-400" />
                  <span>{t('admin.users.role.impactUser')}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 关联区块: 模型授权 / 积分 / 计费的导航提示 */}
        <section className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
          <p className="text-xs text-gray-500">
            {t('admin.users.role.relatedHint')}
          </p>
        </section>
      </div>
    </AdminDrawer>
  );
}
