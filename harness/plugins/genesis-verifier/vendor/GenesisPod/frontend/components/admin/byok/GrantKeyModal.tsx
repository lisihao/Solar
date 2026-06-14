'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, KeyRound, RefreshCw, Trash2, X } from 'lucide-react';
import { useApiGet } from '@/hooks/core';
import { apiClient } from '@/lib/api/client';
import { toast, confirm } from '@/stores';
import { Modal } from '@/components/ui/dialogs/Modal';

// ─── Types ───────────────────────────────────────────────────────────────────

type ValidityType = 'ONE_TIME' | 'RECURRING';
type RecurrenceUnit = 'WEEK' | 'MONTH' | 'YEAR';

interface ActiveModel {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
  modelType: string;
  isEnabled: boolean;
}

interface GrantBatchResponse {
  succeeded: Array<{ id: string; modelId: string; provider: string }>;
  failed: Array<{ modelDbId: string; reason: string }>;
}

interface ExistingAssignment {
  id: string;
  modelDbId: string;
  provider: string;
  modelId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'REVOKED' | 'STALE';
  userQuotaCents: number | null;
  userSpendCents: number;
  validityType: 'ONE_TIME' | 'RECURRING';
  expiresAt: string | null;
  assignedAt: string;
}

interface SelectedModel {
  modelDbId: string; // AIModel.id（v5 重构后用 db id 而非字符串 modelId）
  modelId: string; // 字符串 modelId 仅用于 UI 显示和错误信息
  userQuotaCents: string; // string for input control
}

interface Props {
  userId: string;
  userLabel: string; // "alice@x.com" 或 "Alice (alice@x.com)"
  onClose: () => void;
  onDone?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GrantKeyModal({ userId, userLabel, onClose, onDone }: Props) {
  // 后端 GET /admin/ai-models 直接返回数组（非 { models: [...] } envelope）
  // 见 admin.controller.ts:307-310 + admin.service.getAllAIModels
  const { data: modelsData, loading: modelsLoading } = useApiGet<ActiveModel[]>(
    '/admin/ai-models',
    { immediate: true }
  );

  // 该用户当前生效中的授权（status=ACTIVE 过滤，避免 REVOKED 历史记录被误渲染成可撤销项）
  const {
    data: existingData,
    loading: existingLoading,
    execute: refreshExisting,
  } = useApiGet<{ items: ExistingAssignment[] }>(
    `/admin/key-assignments?userId=${encodeURIComponent(userId)}&status=ACTIVE`,
    { immediate: true }
  );
  const existingAssignments = useMemo(
    () => existingData?.items ?? [],
    [existingData]
  );

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const handleRevoke = async (assignmentId: string, modelLabel: string) => {
    if (
      !(await confirm({
        title: `确定撤销 ${userLabel} 对模型「${modelLabel}」的授权吗？`,
        type: 'danger',
      }))
    ) {
      return;
    }
    setRevokingId(assignmentId);
    try {
      await apiClient.delete(`/admin/key-assignments/${assignmentId}`, {
        body: JSON.stringify({ reason: 'admin manual revoke' }),
        headers: { 'Content-Type': 'application/json' },
      });
      toast.success('授权已撤销');
      await refreshExisting();
      onDone?.();
    } catch (err) {
      toast.error((err as Error).message || '撤销失败');
    } finally {
      setRevokingId(null);
    }
  };

  // 仅显示 isEnabled=true 的模型；按 provider 分组。
  // 后端 grantBatch 也用 isEnabled=true 过滤，前端 filter 防止 admin 选了禁用
  // 模型后被后端拒（报"Model not found or inactive"）。
  const grouped = useMemo(() => {
    const list = (modelsData || []).filter((m) => m.isEnabled);
    const groups = new Map<string, ActiveModel[]>();
    for (const m of list) {
      const p = (m.provider || 'unknown').toLowerCase();
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(m);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [modelsData]);

  const [selected, setSelected] = useState<Map<string, SelectedModel>>(
    new Map()
  );
  const [validityType, setValidityType] = useState<ValidityType>('ONE_TIME');
  const [expiresAt, setExpiresAt] = useState('');
  const [recurrenceUnit, setRecurrenceUnit] = useState<RecurrenceUnit>('MONTH');
  const [recurrenceInterval, setRecurrenceInterval] = useState('1');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleModel = (model: ActiveModel) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(model.id)) {
        next.delete(model.id);
      } else {
        next.set(model.id, {
          modelDbId: model.id,
          modelId: model.modelId,
          userQuotaCents: '',
        });
      }
      return next;
    });
  };

  const updateQuota = (modelDbId: string, value: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const cur = next.get(modelDbId);
      if (cur) next.set(modelDbId, { ...cur, userQuotaCents: value });
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) {
      toast.error('请至少选择一个模型');
      return;
    }
    if (validityType === 'ONE_TIME' && !expiresAt) {
      toast.error('单次有效期必须填写到期日期');
      return;
    }
    if (validityType === 'RECURRING') {
      const n = parseInt(recurrenceInterval, 10);
      if (!n || n < 1) {
        toast.error('周期长度必须 >= 1');
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await apiClient.post<GrantBatchResponse>(
        '/admin/key-assignments/grant',
        {
          userId,
          models: Array.from(selected.values()).map((s) => ({
            modelDbId: s.modelDbId,
            userQuotaCents: s.userQuotaCents
              ? Math.round(parseFloat(s.userQuotaCents) * 100)
              : null,
          })),
          validityType,
          expiresAt: validityType === 'ONE_TIME' ? expiresAt : null,
          recurrenceUnit:
            validityType === 'RECURRING' ? recurrenceUnit : undefined,
          recurrenceInterval:
            validityType === 'RECURRING'
              ? parseInt(recurrenceInterval, 10)
              : undefined,
          note: note || undefined,
        }
      );
      if (result.failed.length === 0) {
        toast.success(`已成功授权 ${result.succeeded.length} 个模型`);
      } else {
        const failedMsg = result.failed
          .map((f) => `${f.modelDbId}: ${f.reason}`)
          .join('; ');
        toast.error(
          `部分失败 (${result.failed.length}/${selected.size}): ${failedMsg}`
        );
      }
      onDone?.();
      onClose();
    } catch (err) {
      toast.error((err as Error).message || '授权失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-blue-600" />
          <span>授权模型权益</span>
        </div>
      }
      subtitle={`给 ${userLabel} 分配可调用的 AI 模型`}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            已选 {selected.size} 个模型
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              disabled={submitting || selected.size === 0}
              onClick={handleSubmit}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {submitting ? '授权中...' : '确认授权'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* 已有授权列表（admin 可在此撤销） */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-900">
            当前授权
            <span className="ml-2 text-xs text-gray-500">
              （{existingAssignments.length} 项；可点撤销移除）
            </span>
          </h3>
          {existingLoading ? (
            <div className="text-sm text-gray-500">加载中...</div>
          ) : existingAssignments.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-3 text-center text-xs text-gray-500">
              该用户尚无任何授权
            </div>
          ) : (
            <div className="space-y-1.5">
              {existingAssignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-md border border-gray-200 bg-white p-2.5"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                      a.status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-700'
                        : a.status === 'STALE'
                          ? 'bg-orange-50 text-orange-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {a.status}
                  </span>
                  <div className="flex-1 text-sm">
                    <span className="font-medium text-gray-900">
                      {a.modelId}
                    </span>
                    <span className="ml-2 text-xs uppercase text-gray-500">
                      {a.provider}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {a.userQuotaCents === null
                      ? '无限'
                      : `$${(a.userSpendCents / 100).toFixed(2)} / $${(a.userQuotaCents / 100).toFixed(2)}`}
                    {a.expiresAt &&
                      ` · 到期 ${new Date(a.expiresAt).toLocaleDateString()}`}
                  </div>
                  {a.status === 'ACTIVE' ? (
                    <button
                      disabled={revokingId === a.id}
                      onClick={() => handleRevoke(a.id, a.modelId)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      title="撤销授权"
                    >
                      {revokingId === a.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      撤销
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-gray-200" />

        {/* 模型选择 */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-900">
            新增授权
            <span className="ml-2 text-xs text-gray-500">
              （可跨 Provider 多选）
            </span>
          </h3>
          {modelsLoading ? (
            <div className="text-sm text-gray-500">加载模型列表中...</div>
          ) : grouped.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4" />
              暂无可用模型。请先去「Admin → AI → Models」启用模型。
            </div>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-gray-200 p-3">
              {grouped.map(([provider, models]) => (
                <div key={provider}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    {provider}
                  </div>
                  <div className="space-y-1.5">
                    {models.map((m) => {
                      const isSelected = selected.has(m.id);
                      const quota = selected.get(m.id)?.userQuotaCents ?? '';
                      return (
                        <label
                          key={m.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 transition-colors ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleModel(m)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">
                              {m.displayName}
                            </div>
                            <div className="font-mono text-xs text-gray-500">
                              {m.modelId} · {m.modelType}
                            </div>
                          </div>
                          {isSelected && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-500">
                                配额 USD:
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={quota}
                                onChange={(e) =>
                                  updateQuota(m.id, e.target.value)
                                }
                                onClick={(e) => e.stopPropagation()}
                                placeholder="无限"
                                className="w-24 rounded border border-gray-300 px-2 py-1 text-xs"
                              />
                            </div>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 有效期 */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-900">有效期</h3>
          <div className="space-y-3 rounded-md border border-gray-200 p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                checked={validityType === 'ONE_TIME'}
                onChange={() => setValidityType('ONE_TIME')}
                className="h-4 w-4"
              />
              <span className="text-sm text-gray-900">单次有效期</span>
              <input
                type="date"
                value={expiresAt}
                disabled={validityType !== 'ONE_TIME'}
                onChange={(e) => setExpiresAt(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                checked={validityType === 'RECURRING'}
                onChange={() => setValidityType('RECURRING')}
                className="h-4 w-4"
              />
              <span className="text-sm text-gray-900">周期续期</span>
              <span className="text-sm text-gray-500">每</span>
              <input
                type="number"
                min="1"
                value={recurrenceInterval}
                disabled={validityType !== 'RECURRING'}
                onChange={(e) => setRecurrenceInterval(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-16 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              />
              <select
                value={recurrenceUnit}
                disabled={validityType !== 'RECURRING'}
                onChange={(e) =>
                  setRecurrenceUnit(e.target.value as RecurrenceUnit)
                }
                onClick={(e) => e.stopPropagation()}
                className="rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
              >
                <option value="WEEK">周</option>
                <option value="MONTH">月</option>
                <option value="YEAR">年</option>
              </select>
              <span className="text-sm text-gray-500">自动重置配额</span>
            </label>
          </div>
        </section>

        {/* 备注 */}
        <section>
          <label className="mb-1 block text-sm font-medium text-gray-900">
            备注（可选）
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：VIP 客户 / Q2 季度套餐"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </section>
      </div>
    </Modal>
  );
}
