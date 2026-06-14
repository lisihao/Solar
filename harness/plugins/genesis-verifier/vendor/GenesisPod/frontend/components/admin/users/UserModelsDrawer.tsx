'use client';

import { useMemo, useState } from 'react';
import {
  Bot,
  KeyRound,
  AlertCircle,
  RefreshCw,
  Trash2,
  Plus,
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import {
  AdminDrawer,
  AdminStatsCards,
  AdminEmptyState,
  AdminStatusBadge,
  type AdminStatCard,
} from '@/components/admin/shared';
import { useApiGet } from '@/hooks/core';
import {
  useAdminKeyRequests,
  formatCents,
  type AssignmentView,
  type KeyRequestView,
} from '@/hooks/features/useByokAdmin';
import { useTranslation } from '@/lib/i18n';
import { toast, confirm } from '@/stores';
import { apiClient } from '@/lib/api/client';
import ClientDate from '@/components/common/ClientDate';
import type { User } from '@/hooks/domain';

interface ActiveModel {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
  modelType: string;
  isEnabled: boolean;
}

interface UserModelsDrawerProps {
  user: User | null;
  onClose: () => void;
}

/**
 * UserModelsDrawer — 用户模型授权 Drawer（5 行内按钮之一: [模型]）
 *
 * 整合 BYOK 在该用户身上的所有视图与操作:
 * - 区块 1: 当前已授权的 KeyAssignment 列表 (filter by userId)
 * - 区块 2: 待审批的 BYOK 申请 (filter by userId, status=PENDING)
 * - 区块 3: 添加新授权 (inline 表单, 不再 modal-on-drawer)
 *
 * 后端: admin-key-assignments + admin-key-requests
 */
export default function UserModelsDrawer({
  user,
  onClose,
}: UserModelsDrawerProps) {
  const { t } = useTranslation();
  const userId = user?.id ?? '';

  // 当前用户的 active 授权 —— useAdminKeyAssignments hook 不支持 userId filter,
  // 直接用 useApiGet 拉带 userId 参数的 endpoint (后端 controller 支持)
  const {
    data: assignmentsData,
    loading: assignmentsLoading,
    execute: refreshAssignments,
  } = useApiGet<{ items: AssignmentView[] }>(
    `/admin/key-assignments?userId=${encodeURIComponent(userId || 'none')}&status=ACTIVE`,
    { immediate: !!userId }
  );
  const assignments = useMemo(
    () => assignmentsData?.items ?? [],
    [assignmentsData]
  );

  // 该用户的待审批申请 (hook 不支持 userId, 前端 filter)
  const {
    requests: allRequests,
    approve,
    reject,
  } = useAdminKeyRequests({ status: 'PENDING' });
  const userRequests = useMemo(
    () => allRequests.filter((r) => r.userId === userId),
    [allRequests, userId]
  );

  // 可用模型列表 (添加授权用)
  const { data: modelsData } = useApiGet<ActiveModel[]>('/admin/ai-models', {
    immediate: !!userId,
  });
  const models = useMemo(() => modelsData ?? [], [modelsData]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedModelDbId, setSelectedModelDbId] = useState('');
  const [quotaCents, setQuotaCents] = useState('');
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  if (!user) return null;

  // 已授权的 modelDbId 集合, 避免重复授权
  const grantedModelIds = new Set(assignments.map((a) => a.modelDbId));
  const availableModels = models.filter(
    (m) => m.isEnabled && !grantedModelIds.has(m.id)
  );

  const stats: AdminStatCard[] = [
    {
      label: t('admin.users.models.stats.active'),
      value: assignments.length.toString(),
      icon: KeyRound,
      semantic: 'emerald',
    },
    {
      label: t('admin.users.models.stats.pending'),
      value: userRequests.length.toString(),
      icon: Inbox,
      semantic: userRequests.length > 0 ? 'amber' : 'slate',
    },
    {
      label: t('admin.users.models.stats.available'),
      value: availableModels.length.toString(),
      icon: Bot,
      semantic: 'blue',
    },
    {
      label: t('admin.users.models.stats.totalSpend'),
      value: formatCents(
        assignments.reduce((sum, a) => sum + (a.userSpendCents ?? 0), 0)
      ),
      icon: AlertCircle,
      semantic: 'violet',
    },
  ];

  // Grant
  const handleGrant = async () => {
    if (!selectedModelDbId) return;
    setGranting(true);
    try {
      await apiClient.post('/admin/key-assignments/grant', {
        userId: user.id,
        models: [
          {
            modelDbId: selectedModelDbId,
            userQuotaCents: quotaCents ? Number(quotaCents) : null,
          },
        ],
        validityType: 'ONE_TIME',
      });
      toast.success(t('admin.users.models.grantSuccess'));
      setSelectedModelDbId('');
      setQuotaCents('');
      setShowAddForm(false);
      await refreshAssignments();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t('admin.users.models.grantFailed');
      toast.error(msg);
    } finally {
      setGranting(false);
    }
  };

  // Revoke
  const handleRevoke = async (assignment: AssignmentView) => {
    if (
      !(await confirm({
        title: t('admin.users.models.revokeConfirm').replace(
          '{model}',
          assignment.modelId
        ),
        type: 'danger',
      }))
    ) {
      return;
    }
    setRevokingId(assignment.id);
    try {
      await apiClient.delete(`/admin/key-assignments/${assignment.id}`);
      toast.success(t('admin.users.models.revokeSuccess'));
      await refreshAssignments();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t('admin.users.models.revokeFailed');
      toast.error(msg);
    } finally {
      setRevokingId(null);
    }
  };

  // Approve request
  const handleApprove = async (req: KeyRequestView) => {
    if (!req.provider) {
      toast.error(t('admin.users.models.approveNeedsProvider'));
      return;
    }
    // 找该 provider 下第一个 enabled model 作为快速批准
    const target = models.find(
      (m) =>
        m.provider.toLowerCase() === req.provider!.toLowerCase() && m.isEnabled
    );
    if (!target) {
      toast.error(t('admin.users.models.noEnabledModel'));
      return;
    }
    setApprovingId(req.id);
    try {
      await approve(req.id, {
        modelDbId: target.id,
        userQuotaCents: null,
      });
      toast.success(t('admin.users.models.approveSuccess'));
      await refreshAssignments();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t('admin.users.models.approveFailed');
      toast.error(msg);
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async (req: KeyRequestView) => {
    const reason = window.prompt(t('admin.users.models.rejectReasonPrompt'));
    if (!reason) return;
    try {
      await reject(req.id, reason);
      toast.success(t('admin.users.models.rejectSuccess'));
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : t('admin.users.models.rejectFailed');
      toast.error(msg);
    }
  };

  return (
    <AdminDrawer
      open={!!user}
      onClose={onClose}
      title={t('admin.users.models.title')}
      description={user.email ?? user.username ?? user.id}
      size="lg"
    >
      <div className="space-y-6">
        {/* 顶部 4 卡 (drawer ≤640px → 2x2 防数字 wrap) */}
        <AdminStatsCards cards={stats} columns={2} />

        {/* 区块 1: 当前授权 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <KeyRound className="h-4 w-4 text-gray-400" />
              {t('admin.users.models.assignmentsSection')}
            </h4>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              disabled={availableModels.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('admin.users.models.grantAction')}
            </button>
          </div>

          {/* 添加授权表单 (inline) */}
          {showAddForm && (
            <div className="mb-3 space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">
                  {t('admin.users.models.selectModel')}
                </label>
                <select
                  value={selectedModelDbId}
                  onChange={(e) => setSelectedModelDbId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">{t('admin.users.models.choose')}</option>
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.provider} / {m.displayName} ({m.modelId})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700">
                  {t('admin.users.models.quotaLabel')}
                </label>
                <input
                  type="number"
                  value={quotaCents}
                  onChange={(e) => setQuotaCents(e.target.value)}
                  placeholder={t('admin.users.models.quotaPlaceholder')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleGrant}
                  disabled={granting || !selectedModelDbId}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {granting
                    ? t('common.processing')
                    : t('admin.users.models.confirmGrant')}
                </button>
              </div>
            </div>
          )}

          {/* 授权列表 */}
          {assignmentsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-gray-200 bg-white"
                />
              ))}
            </div>
          ) : assignments.length === 0 ? (
            <AdminEmptyState
              icon={KeyRound}
              title={t('admin.users.models.noAssignments')}
            />
          ) : (
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {assignments.map((a) => (
                <AssignmentRow
                  key={a.id}
                  assignment={a}
                  onRevoke={() => handleRevoke(a)}
                  revoking={revokingId === a.id}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>

        {/* 区块 2: 待审批申请 */}
        <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Inbox className="h-4 w-4 text-gray-400" />
            {t('admin.users.models.requestsSection')}
            {userRequests.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {userRequests.length}
              </span>
            )}
          </h4>
          {userRequests.length === 0 ? (
            <AdminEmptyState
              icon={CheckCircle2}
              title={t('admin.users.models.noPending')}
            />
          ) : (
            <div className="space-y-2">
              {userRequests.map((req) => (
                <RequestRow
                  key={req.id}
                  request={req}
                  onApprove={() => handleApprove(req)}
                  onReject={() => handleReject(req)}
                  approving={approvingId === req.id}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminDrawer>
  );
}

// ─── Sub: AssignmentRow ──────────────────────────────────────────────────────

function AssignmentRow({
  assignment: a,
  onRevoke,
  revoking,
  t,
}: {
  assignment: AssignmentView;
  onRevoke: () => void;
  revoking: boolean;
  t: (k: string) => string;
}) {
  const statusType =
    a.status === 'ACTIVE'
      ? 'active'
      : a.status === 'EXPIRED' || a.status === 'STALE'
        ? 'pending'
        : 'inactive';

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-gray-900">
            {a.provider}
          </span>
          <span className="text-gray-300">/</span>
          <span className="font-mono text-sm text-gray-700">{a.modelId}</span>
          <AdminStatusBadge status={statusType} label={a.status} dot />
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
          <span>
            {t('admin.users.models.quotaUsed')}:{' '}
            <span className="font-mono">
              {formatCents(a.userSpendCents)}
              {' / '}
              {a.userQuotaCents !== null ? formatCents(a.userQuotaCents) : '∞'}
            </span>
          </span>
          {a.expiresAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <ClientDate date={a.expiresAt} format="date" />
            </span>
          )}
          {a.validityType === 'RECURRING' && (
            <span className="flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              {a.recurrenceInterval} {a.recurrenceUnit}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onRevoke}
        disabled={revoking}
        title={t('admin.users.models.revokeAction')}
        className="ml-3 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        {revoking ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

// ─── Sub: RequestRow ─────────────────────────────────────────────────────────

function RequestRow({
  request: req,
  onApprove,
  onReject,
  approving,
  t,
}: {
  request: KeyRequestView;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
  t: (k: string) => string;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              {req.provider ?? t('admin.users.models.providerAny')}
            </span>
            {req.estimatedUsage && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                {req.estimatedUsage}
              </span>
            )}
            <span className="text-xs text-gray-400">
              <ClientDate date={req.createdAt} format="datetime" />
            </span>
          </div>
          {req.reason && (
            <p className="mt-1 text-xs text-gray-600">"{req.reason}"</p>
          )}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onApprove}
            disabled={approving}
            className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3 w-3" />
            {approving
              ? t('common.processing')
              : t('admin.users.models.approveAction')}
          </button>
          <button
            onClick={onReject}
            disabled={approving}
            className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            <XCircle className="h-3 w-3" />
            {t('admin.users.models.rejectAction')}
          </button>
        </div>
      </div>
    </div>
  );
}
