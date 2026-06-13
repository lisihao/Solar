'use client';

import { useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import {
  type AssignmentView,
  formatCents,
  useAdminKeyAssignments,
} from '@/hooks/features/useByokAdmin';

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: 'ACTIVE', label: '活跃' },
  { value: 'SUSPENDED', label: '暂停' },
  { value: 'EXPIRED', label: '过期' },
  { value: 'REVOKED', label: '已撤销' },
];

export function KeyAssignmentsOverview() {
  const [status, setStatus] = useState<string>('ACTIVE');
  const { assignments, loading, error, revoke } = useAdminKeyAssignments({
    status,
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              status === t.value
                ? 'bg-blue-50 font-medium text-blue-700'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500">加载中...</div>}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" /> {error.message}
        </div>
      )}

      {!loading && assignments.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          没有符合条件的分配
        </div>
      )}

      <div className="space-y-2">
        {assignments.map((a) => (
          <AssignmentRow
            key={a.id}
            data={a}
            onRevoke={async () => {
              const reason =
                prompt('撤销原因（会存进审计日志）', '超配额 / 用户离职') ??
                undefined;
              if (reason !== undefined) {
                await revoke(a.id, reason);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

function AssignmentRow({
  data,
  onRevoke,
}: {
  data: AssignmentView;
  onRevoke: () => void;
}) {
  const usage =
    data.userQuotaCents && data.userQuotaCents > 0
      ? Math.round((data.userSpendCents / data.userQuotaCents) * 100)
      : null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs uppercase text-gray-600">
            {data.provider}
          </span>
          <span className="font-mono text-xs text-gray-700">
            user: {data.userId}
          </span>
          <StatusBadge status={data.status} />
        </div>
        <div className="text-xs text-gray-500">
          配额 {formatCents(data.userQuotaCents)} / 已用{' '}
          {formatCents(data.userSpendCents)}
          {usage !== null && ` · 使用率 ${usage}%`}
          {data.expiresAt &&
            ` · 到期 ${new Date(data.expiresAt).toLocaleDateString()}`}
          {data.note && ` · ${data.note}`}
        </div>
      </div>
      {data.status === 'ACTIVE' && (
        <button
          onClick={onRevoke}
          className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> 撤销
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AssignmentView['status'] }) {
  const color = {
    ACTIVE: 'bg-emerald-50 text-emerald-700',
    SUSPENDED: 'bg-amber-50 text-amber-700',
    EXPIRED: 'bg-gray-50 text-gray-600',
    REVOKED: 'bg-red-50 text-red-700',
    STALE: 'bg-orange-50 text-orange-700',
  }[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>
      {status}
    </span>
  );
}
