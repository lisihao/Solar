'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Key,
  Eye,
  Trash2,
  Edit,
  History,
  GitBranch,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { TruncatedCell } from '@/components/common/tables';
import {
  useAdminSecrets,
  Secret,
  SecretCategory,
  CreateSecretDto,
  UpdateSecretDto,
} from '@/hooks/domain/useAdminSecrets';
import { SecretForm } from './SecretForm';
import { SecretAccessLogs } from './SecretAccessLogs';
import { SecretVersions } from './SecretVersions';
import { SecretValueModal } from './SecretValueModal';
import { SecretKeysDrawer } from './SecretKeysDrawer';
import { useTranslation } from '@/lib/i18n';
import ClientDate from '@/components/common/ClientDate';
import { AdminStatusBadge } from '@/components/admin/shared';
import { confirm } from '@/stores';
import type { StatusType } from '@/lib/features/admin/styles';

const CATEGORY_OPTIONS: {
  value: SecretCategory;
  label: string;
  color: string;
}[] = [
  { value: 'AI_MODEL', label: 'AI Model', color: 'bg-blue-100 text-blue-800' },
  { value: 'SEARCH', label: 'Search', color: 'bg-green-100 text-green-800' },
  {
    value: 'EXTRACTION',
    label: 'Content Extraction',
    color: 'bg-purple-100 text-purple-800',
  },
  { value: 'YOUTUBE', label: 'YouTube', color: 'bg-red-100 text-red-800' },
  {
    value: 'TTS',
    label: 'Text-to-Speech',
    color: 'bg-yellow-100 text-yellow-800',
  },
  {
    value: 'SKILLSMP',
    label: 'SkillsMP',
    color: 'bg-indigo-100 text-indigo-800',
  },
  {
    value: 'POLICY',
    label: 'Policy Research',
    color: 'bg-teal-100 text-teal-800',
  },
  {
    value: 'FINANCE',
    label: 'Finance Data',
    color: 'bg-emerald-100 text-emerald-800',
  },
  {
    value: 'ACADEMIC',
    label: 'Academic Research',
    color: 'bg-violet-100 text-violet-800',
  },
  {
    value: 'WEATHER',
    label: 'Weather Data',
    color: 'bg-sky-100 text-sky-800',
  },
  {
    value: 'IMAGE_SEARCH',
    label: 'Image Search',
    color: 'bg-rose-100 text-rose-800',
  },
  {
    value: 'DEV_TOOLS',
    label: 'Dev Tools',
    color: 'bg-orange-100 text-orange-800',
  },
  {
    value: 'MCP',
    label: 'MCP Server',
    color: 'bg-cyan-100 text-cyan-800',
  },
  { value: 'OTHER', label: 'Other', color: 'bg-gray-100 text-gray-800' },
];

interface SecretsManagerProps {
  showAddModal: boolean;
  setShowAddModal: (show: boolean) => void;
}

export function SecretsManager({
  showAddModal,
  setShowAddModal,
}: SecretsManagerProps) {
  const { t } = useTranslation();
  const {
    secrets,
    loading,
    error,
    refreshSecrets,
    createSecret,
    updateSecret,
    deleteSecret,
    getSecretValue,
    getAccessLogs,
    getVersions,
    getVersionValue,
    rollbackVersion,
    isCreating,
    isUpdating,
    isDeleting,
    isRollingBack,
  } = useAdminSecrets();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<SecretCategory | 'ALL'>(
    'ALL'
  );
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null);
  const [showLogsFor, setShowLogsFor] = useState<string | null>(null);
  const [showVersionsFor, setShowVersionsFor] = useState<string | null>(null);

  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [showValueFor, setShowValueFor] = useState<{
    name: string;
    displayName: string;
  } | null>(null);
  // ★ 多 KEY 管理抽屉（点击 Edit 图标触发；与 SecretForm 元信息编辑解耦）
  const [keysDrawerSecret, setKeysDrawerSecret] = useState<Secret | null>(null);

  // Reset editingSecret when modal is closed
  useEffect(() => {
    if (!showAddModal) {
      setEditingSecret(null);
    }
  }, [showAddModal]);

  // M5 Fix: Use useMemo for filteredSecrets to prevent recalculation on every render
  const filteredSecrets = useMemo(() => {
    return secrets.filter((secret) => {
      const matchesSearch =
        secret.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        secret.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        secret.provider?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory =
        categoryFilter === 'ALL' || secret.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [secrets, searchTerm, categoryFilter]);

  // 处理创建/更新
  const handleSubmit = async (data: CreateSecretDto | UpdateSecretDto) => {
    if (editingSecret) {
      await updateSecret(editingSecret.name, data as UpdateSecretDto);
    } else {
      await createSecret(data as CreateSecretDto);
    }
    setShowAddModal(false);
    setEditingSecret(null);
  };

  // H3 Fix: 处理Delete with try-finally for error recovery
  const handleDelete = async (name: string) => {
    if (
      await confirm({
        title: `确定要Delete密钥 "${name}" 吗？此Actions不可恢复。`,
        type: 'danger',
      })
    ) {
      setDeletingName(name);
      try {
        await deleteSecret(name);
      } catch {
        // Error is handled by the hook's error state
      } finally {
        setDeletingName(null);
      }
    }
  };

  const getCategoryBadge = (category: SecretCategory) => {
    const option = CATEGORY_OPTIONS.find((o) => o.value === category);
    return option ? (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${option.color}`}
      >
        {option.label}
      </span>
    ) : null;
  };

  if (loading && secrets.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-700">
            {typeof error === 'string'
              ? error
              : error?.message || 'An error occurred'}
          </span>
        </div>
      )}

      {/* ExpectedSecretsPanel 已迁出此 tab — 设计文档 v0.4 §4.5.0b 明确要求
          KEY 管理 tab 不显示 Platform Tool Keys 统计 / Apply / Configure /
          Setup guide 等引导杂物。如需 onboarding 进度，独立 onboarding 页承载。 */}

      {/* Search和过滤 */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search密钥Name、提供商..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            name="secrets-search"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 "
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as SecretCategory | 'ALL')
          }
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 "
        >
          <option value="ALL">All Categories</option>
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => refreshSecrets()}
          className="rounded-lg border border-gray-300 p-2 transition-colors hover:bg-gray-100 "
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 密钥列表 */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white ">
        <table className="w-full table-fixed">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[14%]" />
            <col className="w-[7%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead className="bg-gray-50 ">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ">
                {t('admin.secrets.table.name')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ">
                {t('admin.secrets.table.category')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ">
                {t('admin.secrets.table.value')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ">
                {t('admin.secrets.table.status')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ">
                {t('admin.secrets.table.usage')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ">
                {t('admin.secrets.table.expires')}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 ">
                {t('admin.secrets.table.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 ">
            {filteredSecrets.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {searchTerm || categoryFilter !== 'ALL'
                    ? t('admin.secrets.noMatching')
                    : t('admin.secrets.empty')}
                </td>
              </tr>
            ) : (
              filteredSecrets.map((secret) => (
                <tr key={secret.id} className="hover:bg-gray-50 ">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <Key className="h-5 w-5 flex-shrink-0 text-gray-400" />
                      <TruncatedCell
                        className="max-w-[220px] font-medium text-gray-900"
                        tooltip={`${secret.displayName} · ${secret.name}`}
                      >
                        {secret.displayName}
                      </TruncatedCell>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {getCategoryBadge(secret.category)}
                    {secret.provider && (
                      <span className="ml-2 text-sm text-gray-500">
                        {secret.provider}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <code className="font-mono rounded bg-gray-100 px-2 py-1 text-sm ">
                        {secret.maskedValue}
                      </code>
                      <button
                        onClick={() =>
                          setShowValueFor({
                            name: secret.name,
                            displayName: secret.displayName,
                          })
                        }
                        className="rounded p-1 hover:bg-gray-100 "
                        title="View Secret"
                      >
                        <Eye className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <SecretStatusCell secret={secret} t={t} />
                  </td>
                  <td className="px-4 py-2.5">
                    <SecretUsageCell secret={secret} t={t} />
                  </td>
                  <td className="px-4 py-2.5">
                    <SecretExpiresCell secret={secret} t={t} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setShowVersionsFor(secret.name)}
                        className="rounded p-1.5 hover:bg-gray-100 "
                        title="Version History"
                      >
                        <GitBranch className="h-4 w-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => setShowLogsFor(secret.name)}
                        className="rounded p-1.5 hover:bg-gray-100 "
                        title="Access Logs"
                      >
                        <History className="h-4 w-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => setKeysDrawerSecret(secret)}
                        className="rounded p-1.5 hover:bg-gray-100 "
                        title="Manage Keys"
                      >
                        <Edit className="h-4 w-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => handleDelete(secret.name)}
                        disabled={isDeleting && deletingName === secret.name}
                        className="rounded p-1.5 hover:bg-red-100 disabled:opacity-50 "
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 表单弹窗 */}
      {showAddModal && (
        <SecretForm
          secret={editingSecret}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowAddModal(false);
            setEditingSecret(null);
          }}
          isSubmitting={isCreating || isUpdating}
        />
      )}

      {/* Version History弹窗 */}
      {showVersionsFor && (
        <SecretVersions
          secretName={showVersionsFor}
          onClose={() => setShowVersionsFor(null)}
          getVersions={getVersions}
          getVersionValue={getVersionValue}
          rollbackVersion={rollbackVersion}
          isRollingBack={isRollingBack}
        />
      )}

      {/* Access Logs弹窗 */}
      {showLogsFor && (
        <SecretAccessLogs
          secretName={showLogsFor}
          onClose={() => setShowLogsFor(null)}
          getAccessLogs={getAccessLogs}
        />
      )}

      {/* Secret Value弹窗 */}
      {showValueFor && (
        <SecretValueModal
          secretName={showValueFor.name}
          displayName={showValueFor.displayName}
          onClose={() => setShowValueFor(null)}
          getSecretValue={getSecretValue}
        />
      )}

      {/* 多 KEY 管理抽屉 */}
      <SecretKeysDrawer
        secret={keysDrawerSecret}
        onClose={() => setKeysDrawerSecret(null)}
      />
    </div>
  );
}

// ─── Wave 4 (2026-05-11): Status / Usage / Expires 单元格组件 ───────────────
// 用 Secret schema 已有字段（aggregateStatus / activeKeys / totalKeys /
// accessCount / lastAccessedAt / expiresAt / lastRotatedAt）做单 Key 命中 + 统计 + 状态

function SecretStatusCell({
  secret,
  t,
}: {
  secret: Secret;
  t: (k: string, params?: Record<string, string | number>) => string;
}) {
  const aggregateStatus =
    secret.aggregateStatus ?? (secret.isActive ? 'unknown' : 'disabled');

  const statusMap: Record<string, { status: StatusType; label: string }> = {
    ok: { status: 'active', label: t('admin.secrets.status.ok') },
    failed: { status: 'error', label: t('admin.secrets.status.failed') },
    unknown: { status: 'pending', label: t('admin.secrets.status.unknown') },
    disabled: {
      status: 'inactive',
      label: t('admin.secrets.status.disabled'),
    },
  };
  const m = statusMap[aggregateStatus] ?? statusMap.unknown;

  const hasKeys =
    typeof secret.activeKeys === 'number' &&
    typeof secret.totalKeys === 'number';

  return (
    <div className="space-y-1">
      <AdminStatusBadge status={m.status} label={m.label} dot />
      {hasKeys && (
        <div className="text-[10px] text-gray-400">
          {t('admin.secrets.status.keys', {
            active: secret.activeKeys ?? 0,
            total: secret.totalKeys ?? 0,
          })}
        </div>
      )}
    </div>
  );
}

function SecretUsageCell({
  secret,
  t,
}: {
  secret: Secret;
  t: (k: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="space-y-0.5 text-sm">
      <div className="font-mono font-medium text-gray-900">
        {secret.accessCount.toLocaleString()}{' '}
        <span className="text-xs font-normal text-gray-400">
          {t('admin.secrets.usage.hits')}
        </span>
      </div>
      {secret.lastAccessedAt ? (
        <div className="text-[10px] text-gray-400">
          {t('admin.secrets.usage.lastAt')}{' '}
          <ClientDate date={secret.lastAccessedAt} format="datetime" />
        </div>
      ) : (
        <div className="text-[10px] text-gray-300">
          {t('admin.secrets.usage.neverUsed')}
        </div>
      )}
    </div>
  );
}

function SecretExpiresCell({
  secret,
  t,
}: {
  secret: Secret;
  t: (k: string, params?: Record<string, string | number>) => string;
}) {
  if (!secret.expiresAt && !secret.lastRotatedAt) {
    return (
      <span className="text-xs text-gray-400">
        {t('admin.secrets.expires.noExpiry')}
      </span>
    );
  }
  const expiresAtMs = secret.expiresAt
    ? new Date(secret.expiresAt).getTime()
    : null;
  const nowMs = Date.now();
  const daysLeft =
    expiresAtMs !== null
      ? Math.floor((expiresAtMs - nowMs) / (1000 * 60 * 60 * 24))
      : null;

  let warningLabel = '';
  let warningTone: StatusType | null = null;
  if (daysLeft !== null) {
    if (daysLeft < 0) {
      warningLabel = t('admin.secrets.expires.expired');
      warningTone = 'error';
    } else if (daysLeft <= 7) {
      warningLabel = t('admin.secrets.expires.expiringSoon').replace(
        '{days}',
        String(daysLeft)
      );
      warningTone = 'pending';
    }
  }

  return (
    <div className="space-y-0.5 text-xs">
      {secret.expiresAt && (
        <div>
          {warningTone ? (
            <AdminStatusBadge status={warningTone} label={warningLabel} dot />
          ) : (
            <span className="text-gray-600">
              <ClientDate date={secret.expiresAt} format="date" />
            </span>
          )}
        </div>
      )}
      {secret.lastRotatedAt && (
        <div className="text-[10px] text-gray-400">
          {t('admin.secrets.expires.rotatedAt')}{' '}
          <ClientDate date={secret.lastRotatedAt} format="date" />
        </div>
      )}
    </div>
  );
}
