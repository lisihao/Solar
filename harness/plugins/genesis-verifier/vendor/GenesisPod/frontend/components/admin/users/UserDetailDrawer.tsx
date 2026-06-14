'use client';

import { useEffect, useState } from 'react';
import {
  User as UserIcon,
  Mail,
  AtSign,
  Calendar,
  Clock,
  Shield,
  CheckCircle2,
  XCircle,
  KeyRound,
  Save,
} from 'lucide-react';
import { AdminDrawer, AdminStatusBadge } from '@/components/admin/shared';
import { useTranslation } from '@/lib/i18n';
import { toast } from '@/stores';
import ClientDate from '@/components/common/ClientDate';
import type { User } from '@/hooks/domain';

interface UserDetailDrawerProps {
  user: User | null;
  onClose: () => void;
  onSave: (id: string, data: Partial<User>) => Promise<void>;
  isLoading: boolean;
}

/**
 * UserDetailDrawer — 用户详情 Drawer（5 行内按钮之一: [详情]）
 *
 * 综合身份视图: 基本资料 + 状态标志 + 元数据 + 可编辑字段。
 * 不包含角色切换 (走 [角色])、积分 (走 [积分])、模型授权 (走 [模型])、计费 (走 [计费])。
 *
 * 显示字段:
 * - email (只读)
 * - username (可编辑)
 * - name (可编辑, 对应后端 fullName)
 * - role / status (只读, 高亮)
 * - createdAt / lastLoginAt (只读)
 * - avatar / OAuth / isVerified (后端 list response 暂未返回, 显示占位)
 */
export default function UserDetailDrawer({
  user,
  onClose,
  onSave,
  isLoading,
}: UserDetailDrawerProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    if (user) {
      setUsername(user.username ?? '');
      setName(user.name ?? '');
    }
  }, [user]);

  if (!user) {
    return null;
  }

  const isAdmin = (user.role || '').toUpperCase() === 'ADMIN';
  const statusType =
    user.status === 'active'
      ? 'active'
      : user.status === 'banned'
        ? 'error'
        : 'inactive';

  const handleSave = async () => {
    const diff: Partial<User> = {};
    if (username !== (user.username ?? '')) diff.username = username || null;
    if (name !== (user.name ?? '')) diff.name = name || null;
    if (Object.keys(diff).length === 0) {
      onClose();
      return;
    }
    try {
      await onSave(user.id, diff);
      toast.success(t('admin.users.detail.saved'));
      onClose();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t('admin.users.detail.saveFailed');
      toast.error(msg);
    }
  };

  return (
    <AdminDrawer
      open={!!user}
      onClose={onClose}
      title={t('admin.users.detail.title')}
      description={user.email ?? user.id}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isLoading ? t('common.processing') : t('common.save')}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {/* 头部身份卡 */}
        <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
              <span className="text-xl font-bold">
                {(user.name ?? user.username ?? user.email ?? '?')
                  .charAt(0)
                  .toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-lg font-bold text-gray-900">
                  {user.name ?? user.username ?? user.email}
                </h3>
                <AdminStatusBadge
                  status={statusType}
                  label={t(`admin.users.status.${user.status ?? 'active'}`)}
                  dot
                />
              </div>
              <p className="mt-1 truncate text-sm text-gray-500">
                {user.email}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Shield
                  className={`h-4 w-4 ${isAdmin ? 'text-blue-600' : 'text-gray-400'}`}
                />
                <span className="text-xs font-medium text-gray-700">
                  {isAdmin
                    ? t('admin.users.role.admin')
                    : t('admin.users.role.user')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 基本信息编辑 */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.detail.sections.basic')}
          </h4>
          <div className="space-y-4">
            <FieldRow
              label={t('admin.users.detail.fields.email')}
              icon={Mail}
              readOnly
              value={user.email ?? '-'}
            />
            <FieldRow
              label={t('admin.users.detail.fields.username')}
              icon={AtSign}
              value={username}
              onChange={setUsername}
              placeholder="johndoe"
            />
            <FieldRow
              label={t('admin.users.detail.fields.name')}
              icon={UserIcon}
              value={name}
              onChange={setName}
              placeholder={t('admin.users.detail.fields.namePlaceholder')}
            />
          </div>
        </section>

        {/* 状态与权限 (只读, 操作在 [角色] Drawer) */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.detail.sections.statusRole')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <ReadCard
              label={t('admin.users.detail.fields.role')}
              value={
                isAdmin
                  ? t('admin.users.role.admin')
                  : t('admin.users.role.user')
              }
              icon={Shield}
              tone={isAdmin ? 'blue' : 'gray'}
            />
            <ReadCard
              label={t('admin.users.detail.fields.status')}
              value={t(`admin.users.status.${user.status ?? 'active'}`)}
              icon={user.status === 'active' ? CheckCircle2 : XCircle}
              tone={user.status === 'active' ? 'emerald' : 'gray'}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {t('admin.users.detail.hints.roleManagedHint')}
          </p>
        </section>

        {/* 元数据时间戳 */}
        <section>
          <h4 className="mb-3 text-sm font-semibold text-gray-900">
            {t('admin.users.detail.sections.metadata')}
          </h4>
          <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <MetaRow
              icon={Calendar}
              label={t('admin.users.detail.fields.createdAt')}
              value={
                user.createdAt ? (
                  <ClientDate date={user.createdAt} format="datetime" />
                ) : (
                  '-'
                )
              }
            />
            <MetaRow
              icon={Clock}
              label={t('admin.users.detail.fields.lastLoginAt')}
              value={
                user.lastLoginAt ? (
                  <ClientDate date={user.lastLoginAt} format="datetime" />
                ) : (
                  <span className="text-gray-400">
                    {t('admin.users.detail.neverLoggedIn')}
                  </span>
                )
              }
            />
            <MetaRow
              icon={KeyRound}
              label={t('admin.users.detail.fields.userId')}
              value={
                <span className="font-mono text-xs text-gray-500">
                  {user.id}
                </span>
              }
            />
          </div>
        </section>

        {/* 后端扩展字段提示 */}
        <section className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-xs text-gray-500">
            {t('admin.users.detail.hints.extendedFields')}
          </p>
        </section>
      </div>
    </AdminDrawer>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FieldRow({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string;
  icon: React.ElementType;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <Icon className="h-3.5 w-3.5 text-gray-400" />
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
          readOnly
            ? 'border-gray-200 bg-gray-50 text-gray-500'
            : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
        }`}
      />
    </div>
  );
}

function ReadCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone: 'blue' | 'emerald' | 'gray';
}) {
  const toneClasses = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    gray: 'bg-gray-100 text-gray-500',
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <div className={`rounded-lg p-1.5 ${toneClasses[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-sm text-gray-900">{value}</div>
    </div>
  );
}
