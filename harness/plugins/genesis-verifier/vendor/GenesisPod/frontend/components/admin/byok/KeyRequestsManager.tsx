'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import {
  type KeyRequestView,
  useAdminKeyRequests,
} from '@/hooks/features/useByokAdmin';
import { useApiGet } from '@/hooks/core';
import { Modal } from '@/components/ui/dialogs/Modal';

/**
 * 2026-05-08 v5（drop_distributable_keys）:
 *   审批 modal 从"选 DistributableKey 池"改为"选 AIModel 行"。
 *   admin 看用户申请的 provider，从该 provider 下 enabled 的 AIModel 选具体一行授权。
 */

interface ActiveModel {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
  modelType: string;
  isEnabled: boolean;
}

const STATUS_TABS = [
  { value: 'PENDING', label: '待处理' },
  { value: 'APPROVED', label: '已批准' },
  { value: 'REJECTED', label: '已拒绝' },
];

export function KeyRequestsManager() {
  const [status, setStatus] = useState('PENDING');
  const { requests, loading, error, approve, reject } = useAdminKeyRequests({
    status,
  });
  const [approving, setApproving] = useState<KeyRequestView | null>(null);
  const [rejecting, setRejecting] = useState<KeyRequestView | null>(null);

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
      {!loading && requests.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {status === 'PENDING' ? '没有待处理的申请' : '暂无记录'}
        </div>
      )}

      <div className="space-y-2">
        {requests.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            onApprove={() => setApproving(r)}
            onReject={() => setRejecting(r)}
          />
        ))}
      </div>

      {approving && (
        <ApproveModal
          request={approving}
          onClose={() => setApproving(null)}
          onConfirm={async (input) => {
            const ok = await approve(approving.id, input);
            if (ok) setApproving(null);
          }}
        />
      )}
      {rejecting && (
        <RejectModal
          request={rejecting}
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            const ok = await reject(rejecting.id, reason);
            if (ok) setRejecting(null);
          }}
        />
      )}
    </div>
  );
}

function RequestRow({
  request,
  onApprove,
  onReject,
}: {
  request: KeyRequestView;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-700">
              user: {request.userId}
            </span>
            <StatusBadge status={request.status} />
          </div>
          {request.reason && (
            <div className="text-sm text-gray-700">
              <span className="text-xs text-gray-500">理由：</span>
              {request.reason}
            </div>
          )}
          <div className="text-xs text-gray-500">
            预计用量：{request.estimatedUsage ?? '未填'} · 提交于{' '}
            {new Date(request.createdAt).toLocaleString()}
          </div>
          {request.rejectionReason && (
            <div className="text-xs text-red-600">
              拒绝理由：{request.rejectionReason}
            </div>
          )}
        </div>
        {request.status === 'PENDING' && (
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
            >
              <XCircle className="h-3.5 w-3.5" /> 拒绝
            </button>
            <button
              onClick={onApprove}
              className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> 批准并授权
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: KeyRequestView['status'] }) {
  const color = {
    PENDING: 'bg-amber-50 text-amber-700',
    APPROVED: 'bg-emerald-50 text-emerald-700',
    REJECTED: 'bg-red-50 text-red-700',
    CANCELLED: 'bg-gray-50 text-gray-600',
  }[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>
      {status}
    </span>
  );
}

// ─── Approve Modal ───────────────────────────────────────────────────────────

function ApproveModal({
  request,
  onClose,
  onConfirm,
}: {
  request: KeyRequestView;
  onClose: () => void;
  onConfirm: (input: {
    modelDbId: string;
    userQuotaCents?: number | null;
    expiresAt?: string | null;
    note?: string;
  }) => Promise<void>;
}) {
  // 后端 GET /admin/ai-models 直接返回数组
  const { data: modelsData, loading } = useApiGet<ActiveModel[]>(
    '/admin/ai-models',
    { immediate: true }
  );
  // 2026-05-08: 用户提交时不再选 provider，admin 看所有 enabled AIModel 自由选授权
  const candidates = useMemo(
    () => (modelsData || []).filter((m) => m.isEnabled),
    [modelsData]
  );
  const [selectedModelDbId, setSelectedModelDbId] = useState<string | null>(
    null
  );
  const [quota, setQuota] = useState('10');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="批准申请"
      subtitle="从所有可用模型中选一个授权给该用户（按 provider 分组）"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            disabled={saving || !selectedModelDbId}
            onClick={async () => {
              if (!selectedModelDbId) return;
              setSaving(true);
              await onConfirm({
                modelDbId: selectedModelDbId,
                userQuotaCents: quota
                  ? Math.round(parseFloat(quota) * 100)
                  : null,
                expiresAt: expiresAt || null,
                note: note || undefined,
              });
              setSaving(false);
            }}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '处理中...' : '确认批准并授权'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-xs font-medium text-gray-700">
            选择具体模型
          </label>
          {loading ? (
            <div className="text-sm text-gray-500">加载中...</div>
          ) : candidates.length === 0 ? (
            <div className="rounded-md border border-dashed border-red-300 bg-red-50 p-3 text-sm text-red-700">
              暂无可用模型。请先去「Admin → AI →
              Models」启用并配置至少一个模型。
            </div>
          ) : (
            <ModelPicker
              candidates={candidates}
              selectedModelDbId={selectedModelDbId}
              onSelect={setSelectedModelDbId}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              用户配额（USD，空=无限）
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              有效期（可选）
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            备注（可选）
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
    </Modal>
  );
}

// ─── Reject Modal ────────────────────────────────────────────────────────────

function RejectModal({
  request,
  onClose,
  onConfirm,
}: {
  request: KeyRequestView;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="拒绝申请"
      subtitle="拒绝理由会展示给申请用户"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            disabled={saving || !reason.trim()}
            onClick={async () => {
              setSaving(true);
              await onConfirm(reason.trim());
              setSaving(false);
            }}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? '处理中...' : '确认拒绝'}
          </button>
        </div>
      }
    >
      <textarea
        rows={4}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="例如：用量过大，请自行配置 Key"
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </Modal>
  );
}

// ─── ModelPicker 子组件（按 provider 分组） ─────────────────────────────────

function ModelPicker({
  candidates,
  selectedModelDbId,
  onSelect,
}: {
  candidates: ActiveModel[];
  selectedModelDbId: string | null;
  onSelect: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, ActiveModel[]>();
    for (const m of candidates) {
      const p = (m.provider || 'unknown').toLowerCase();
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(m);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [candidates]);

  return (
    <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-gray-200 p-3">
      {grouped.map(([provider, models]) => (
        <div key={provider}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {provider}
          </div>
          <div className="space-y-1.5">
            {models.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md border p-2.5 ${
                  selectedModelDbId === m.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  checked={selectedModelDbId === m.id}
                  onChange={() => onSelect(m.id)}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{m.displayName}</div>
                  <div className="font-mono text-xs text-gray-500">
                    {m.modelId} · {m.modelType}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
