'use client';

import { useMemo, useState } from 'react';
import {
  Inbox,
  CheckCircle2,
  XCircle,
  Clock,
  User as UserIcon,
} from 'lucide-react';
import {
  AdminDrawer,
  AdminStatsCards,
  AdminEmptyState,
  type AdminStatCard,
} from '@/components/admin/shared';
import { useApiGet } from '@/hooks/core';
import {
  useAdminKeyRequests,
  type KeyRequestView,
} from '@/hooks/features/useByokAdmin';
import { useTranslation } from '@/lib/i18n';
import { toast } from '@/stores';
import ClientDate from '@/components/common/ClientDate';

interface ActiveModel {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
  isEnabled: boolean;
}

interface UserBrief {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
}

interface PendingApprovalDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * PendingApprovalDrawer — 全局"待处理模型请求"聚合视图
 *
 * 用户管理顶部 [待审批 N] 按钮触发, 列出所有 status=PENDING 的 KeyRequest,
 * 按提交时间倒序显示。每条可一键批准 (快速选 provider 下第一个 enabled model)
 * 或拒绝 (填理由)。
 *
 * 针对单个用户的详细审批仍走 UserModelsDrawer 的 [模型] 入口。
 */
export default function PendingApprovalDrawer({
  open,
  onClose,
}: PendingApprovalDrawerProps) {
  const { t } = useTranslation();

  const { requests, loading, approve, reject, refresh } = useAdminKeyRequests({
    status: 'PENDING',
  });

  const { data: modelsData } = useApiGet<ActiveModel[]>('/admin/ai-models', {
    immediate: open,
  });
  const models = useMemo(() => modelsData ?? [], [modelsData]);

  // 获取用户基础信息以便在列表显示 email/name (而非裸 userId)
  const { data: usersData } = useApiGet<{
    users?: UserBrief[];
    data?: { users?: UserBrief[] };
  }>('/admin/users?limit=200', { immediate: open });
  const userMap = useMemo(() => {
    const list =
      usersData?.users ?? usersData?.data?.users ?? ([] as UserBrief[]);
    return new Map(list.map((u) => [u.id, u]));
  }, [usersData]);

  const [actingId, setActingId] = useState<string | null>(null);

  const sortedRequests = useMemo(
    () =>
      [...requests].sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      ),
    [requests]
  );

  const stats: AdminStatCard[] = [
    {
      label: t('admin.users.pendingApproval.stats.total'),
      value: requests.length.toString(),
      icon: Inbox,
      semantic: requests.length > 0 ? 'amber' : 'slate',
    },
    {
      label: t('admin.users.pendingApproval.stats.uniqueUsers'),
      value: new Set(requests.map((r) => r.userId)).size.toString(),
      icon: UserIcon,
      semantic: 'blue',
    },
    {
      label: t('admin.users.pendingApproval.stats.uniqueProviders'),
      value: new Set(requests.map((r) => r.provider ?? 'any')).size.toString(),
      icon: CheckCircle2,
      semantic: 'violet',
    },
    {
      label: t('admin.users.pendingApproval.stats.oldest'),
      value:
        sortedRequests.length > 0
          ? formatRelative(sortedRequests[sortedRequests.length - 1].createdAt)
          : '-',
      icon: Clock,
      semantic: 'slate',
    },
  ];

  const handleApprove = async (req: KeyRequestView) => {
    if (!req.provider) {
      toast.error(t('admin.users.models.approveNeedsProvider'));
      return;
    }
    const target = models.find(
      (m) =>
        m.provider.toLowerCase() === req.provider!.toLowerCase() && m.isEnabled
    );
    if (!target) {
      toast.error(t('admin.users.models.noEnabledModel'));
      return;
    }
    setActingId(req.id);
    try {
      await approve(req.id, {
        modelDbId: target.id,
        userQuotaCents: null,
      });
      await refresh();
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (req: KeyRequestView) => {
    const reason = window.prompt(t('admin.users.models.rejectReasonPrompt'));
    if (!reason) return;
    setActingId(req.id);
    try {
      await reject(req.id, reason);
      await refresh();
    } finally {
      setActingId(null);
    }
  };

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      title={t('admin.users.pendingApproval.title')}
      description={t('admin.users.pendingApproval.subtitle')}
      size="lg"
    >
      <div className="space-y-6">
        <AdminStatsCards cards={stats} columns={2} />

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl border border-gray-200 bg-white"
              />
            ))}
          </div>
        ) : sortedRequests.length === 0 ? (
          <AdminEmptyState
            icon={CheckCircle2}
            title={t('admin.users.pendingApproval.empty')}
            description={t('admin.users.pendingApproval.emptyHint')}
          />
        ) : (
          <div className="space-y-2">
            {sortedRequests.map((req) => {
              const u = userMap.get(req.userId);
              return (
                <div
                  key={req.id}
                  className="rounded-xl border border-amber-200 bg-amber-50/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {u?.email ?? u?.username ?? req.userId}
                        </span>
                        <span className="text-gray-300">·</span>
                        <span className="font-mono text-xs text-gray-700">
                          {req.provider ?? t('admin.users.models.providerAny')}
                        </span>
                        {req.estimatedUsage && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            {req.estimatedUsage}
                          </span>
                        )}
                      </div>
                      {req.reason && (
                        <p className="mt-1 text-xs text-gray-600">
                          "{req.reason}"
                        </p>
                      )}
                      <div className="mt-1 text-[10px] text-gray-400">
                        <ClientDate date={req.createdAt} format="datetime" />
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleApprove(req)}
                        disabled={actingId === req.id}
                        className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        {t('admin.users.models.approveAction')}
                      </button>
                      <button
                        onClick={() => handleReject(req)}
                        disabled={actingId === req.id}
                        className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        <XCircle className="h-3 w-3" />
                        {t('admin.users.models.rejectAction')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminDrawer>
  );
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (days >= 1) return `${days}d`;
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(diffMs / (1000 * 60));
  return `${Math.max(mins, 0)}m`;
}
