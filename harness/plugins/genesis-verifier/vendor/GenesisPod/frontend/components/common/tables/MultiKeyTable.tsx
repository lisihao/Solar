'use client';

import { useState } from 'react';
import { confirm } from '@/stores';
import {
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  CircleHelp,
  CirclePause,
} from 'lucide-react';
import type {
  SecretKeyRow,
  AddKeyInput,
  UpdateKeyMetaInput,
} from '@/hooks/domain/useSecretKeys';

/**
 * 多 KEY 表格共享组件（admin /admin/access/secrets + 用户 /me/ai?tab=keys 共用）。
 *
 * 与设计文档 §4.5.4 对齐：
 * - 列：LABEL / VALUE(hint) / PRIORITY / STATUS / LAST USED / OPS
 * - OPS：Test / Replace / Edit / Delete
 * - 顶部 [+ Add Key]
 * - readOnly：只读模式（admin 分配 key 等场景；BYOK 用户对自己的 key 不读 only）
 */
export interface MultiKeyTableProps {
  keys: SecretKeyRow[];
  loading: boolean;
  actionLoading: boolean;
  onAdd: (input: AddKeyInput) => Promise<void>;
  onReplace: (keyId: string, value: string) => Promise<void>;
  onUpdate: (keyId: string, meta: UpdateKeyMetaInput) => Promise<void>;
  onDelete: (keyId: string) => Promise<void>;
  onTest: (keyId: string) => Promise<void>;
  readOnly?: boolean;
  /** BYOK 场景：UserApiKey 无 priority/isActive 字段，隐藏 Edit meta 按钮避免误操作 */
  hideEditMeta?: boolean;
  /** BYOK test endpoint 需要 plaintext key UI 拿不到，隐藏 Test 按钮 */
  hideTest?: boolean;
}

/**
 * ★ 2026-05-06: status badge 完全由"上次真实使用"驱动 —— testStatus 由
 *   ProviderProbeService 真上游探测 + 业务流量 markSuccess/markFailure 共写。
 *   失败时按 errorCode 出语义化文案（"未授权" / "限流" / 等），而不是模糊 "Failed"。
 */
const ERROR_CODE_LABEL: Record<
  string,
  { text: string; tone: 'red' | 'amber' | 'gray' }
> = {
  AUTH_FAILED: { text: '未授权', tone: 'red' },
  RATE_LIMIT_KEY: { text: '限流', tone: 'amber' },
  QUOTA_EXCEEDED: { text: '额度超', tone: 'red' },
  PROVIDER_DOWN: { text: '上游故障', tone: 'red' },
  TIMEOUT: { text: '超时', tone: 'amber' },
  NETWORK_ERROR: { text: '网络错误', tone: 'gray' },
  DECRYPTION_FAILED: { text: '解密失败', tone: 'red' },
  UNKNOWN: { text: '失败', tone: 'red' },
};
const TONE_CLASS: Record<'red' | 'amber' | 'gray', string> = {
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  gray: 'bg-gray-100 text-gray-700',
};

function StatusBadge({ row }: { row: SecretKeyRow }) {
  if (!row.isActive) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
        <CirclePause className="h-3 w-3" /> 已禁用
      </span>
    );
  }
  if (row.testStatus === 'success') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
        title={
          row.accessCount > 0
            ? `上次成功命中 · 累计 ${row.accessCount} 次`
            : '上次成功（手动 probe 或业务调用）'
        }
      >
        <CheckCircle2 className="h-3 w-3" /> 正常
      </span>
    );
  }
  if (row.testStatus === 'failed') {
    const code = row.lastErrorCode ?? 'UNKNOWN';
    const def = ERROR_CODE_LABEL[code] ?? ERROR_CODE_LABEL.UNKNOWN;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[def.tone]}`}
        title={row.lastErrorMessage ? `${code}: ${row.lastErrorMessage}` : code}
      >
        <XCircle className="h-3 w-3" /> {def.text}
      </span>
    );
  }
  // testStatus 为 null = 健康状态未知（业务流量只累计 accessCount/lastUsedAt，
  // 不回写 testStatus）。但有命中或使用时间就说明"确实用过"，不能显示「未使用」——
  // 区分两种 null 态：用过但未做健康探测 vs 真的从未使用。
  const used = row.accessCount > 0 || !!row.lastUsedAt;
  if (used) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
        title={`已被业务调用${
          row.accessCount > 0 ? ` · 累计 ${row.accessCount} 次` : ''
        }，尚未做健康探测（点 Test 可验证 key 有效性）`}
      >
        <CircleHelp className="h-3 w-3" /> 已用·未测
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      <CircleHelp className="h-3 w-3" /> 未使用
    </span>
  );
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function MultiKeyTable({
  keys,
  loading,
  actionLoading,
  onAdd,
  onReplace,
  onUpdate,
  onDelete,
  onTest,
  readOnly = false,
  hideEditMeta = false,
  hideTest = false,
}: MultiKeyTableProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addValue, setAddValue] = useState('');
  const [addPriority, setAddPriority] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editPriority, setEditPriority] = useState(0);
  const [editActive, setEditActive] = useState(true);

  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [replaceValue, setReplaceValue] = useState('');

  const handleAdd = async () => {
    if (!addLabel.trim() || !addValue.trim()) return;
    await onAdd({
      label: addLabel.trim(),
      value: addValue,
      priority: addPriority,
    });
    setAddLabel('');
    setAddValue('');
    setAddPriority(0);
    setAddOpen(false);
  };

  const handleStartEdit = (row: SecretKeyRow) => {
    setEditingId(row.id);
    setEditLabel(row.label);
    setEditPriority(row.priority);
    setEditActive(row.isActive);
  };

  const handleSaveEdit = async (id: string) => {
    await onUpdate(id, {
      label: editLabel.trim(),
      priority: editPriority,
      isActive: editActive,
    });
    setEditingId(null);
  };

  const handleStartReplace = (row: SecretKeyRow) => {
    setReplacingId(row.id);
    setReplaceValue('');
  };

  const handleSaveReplace = async (id: string) => {
    if (!replaceValue.trim()) return;
    await onReplace(id, replaceValue);
    setReplacingId(null);
    setReplaceValue('');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {loading
            ? 'Loading…'
            : `${keys.length} key${keys.length === 1 ? '' : 's'} configured`}
        </div>
        {!readOnly && (
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Add Key
          </button>
        )}
      </div>

      {addOpen && !readOnly && (
        <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <input
              type="text"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              placeholder="label (e.g. backup-1)"
              name="secret-key-label"
              autoComplete="off"
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400"
            />
            {/* ★ autoComplete="new-password" + 唯一 name —— 阻止 Chrome 把
                 此 password 当成登录表单触发上方搜索框自动填充 */}
            <input
              type="password"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder="API key value"
              name="secret-key-add-value"
              autoComplete="new-password"
              spellCheck={false}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 md:col-span-2"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Priority:</label>
            <input
              type="number"
              min={0}
              max={999}
              value={addPriority}
              onChange={(e) => setAddPriority(parseInt(e.target.value) || 0)}
              className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
            />
            <button
              onClick={handleAdd}
              disabled={actionLoading || !addLabel.trim() || !addValue.trim()}
              className="ml-auto rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setAddOpen(false)}
              className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Value</th>
              <th className="px-3 py-2 text-left">Priority</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th
                className="px-3 py-2 text-right"
                title="累计命中次数（业务调用 markSuccess 累加；replace 后从 0 重新计）"
              >
                Hits
              </th>
              <th
                className="px-3 py-2 text-left"
                title="最近一次活动时间（手动测试 或 业务流量命中）"
              >
                Last Used
              </th>
              {!readOnly && <th className="px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {keys.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={readOnly ? 6 : 7}
                  className="px-3 py-6 text-center text-gray-400"
                >
                  No keys configured.{' '}
                  {!readOnly && 'Click "Add Key" to add one.'}
                </td>
              </tr>
            )}
            {keys.map((row) => {
              const isEditing = editingId === row.id;
              const isReplacing = replacingId === row.id;
              return (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="font-mono px-3 py-2 text-xs">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="w-32 rounded border px-1 py-0.5 text-sm"
                      />
                    ) : (
                      row.label
                    )}
                  </td>
                  <td className="font-mono px-3 py-2 text-xs text-gray-600">
                    {isReplacing ? (
                      <input
                        type="password"
                        value={replaceValue}
                        onChange={(e) => setReplaceValue(e.target.value)}
                        placeholder="new key value"
                        name={`secret-key-replace-${row.id}`}
                        autoComplete="new-password"
                        spellCheck={false}
                        className="w-48 rounded border px-1 py-0.5 text-sm"
                      />
                    ) : (
                      (row.keyHint ?? '••••••••')
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={editPriority}
                        onChange={(e) =>
                          setEditPriority(parseInt(e.target.value) || 0)
                        }
                        className="w-16 rounded border px-1 py-0.5 text-sm"
                      />
                    ) : (
                      row.priority
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <label className="inline-flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={editActive}
                          onChange={(e) => setEditActive(e.target.checked)}
                        />
                        Active
                      </label>
                    ) : (
                      <StatusBadge row={row} />
                    )}
                  </td>
                  <td
                    className="font-mono px-3 py-2 text-right text-xs"
                    title={
                      row.accessCount > 0
                        ? `累计 ${row.accessCount.toLocaleString()} 次命中`
                        : '尚未被业务流量命中'
                    }
                  >
                    {row.accessCount > 0 ? (
                      <span className="text-gray-700">
                        {row.accessCount.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {/* 2026-05-12 (C方案): LAST USED 唯一读 lastUsedAt
                        (业务流量 + 手动 Test 都写). lastTestedAt 已弃用. */}
                    {fmtRelative(row.lastUsedAt)}
                  </td>
                  {!readOnly && (
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => handleSaveEdit(row.id)}
                            disabled={actionLoading}
                            className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : isReplacing ? (
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => handleSaveReplace(row.id)}
                            disabled={actionLoading || !replaceValue.trim()}
                            className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
                          >
                            Replace
                          </button>
                          <button
                            onClick={() => setReplacingId(null)}
                            className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-1">
                          {!hideTest && (
                            <button
                              title="Test"
                              onClick={() => onTest(row.id)}
                              disabled={actionLoading}
                              className="rounded p-1 hover:bg-gray-100 disabled:opacity-50"
                            >
                              <RefreshCw className="h-4 w-4 text-gray-600" />
                            </button>
                          )}
                          <button
                            title="Replace value"
                            onClick={() => handleStartReplace(row)}
                            disabled={actionLoading}
                            className="rounded p-1 hover:bg-gray-100 disabled:opacity-50"
                          >
                            <RefreshCw className="h-4 w-4 text-blue-600" />
                          </button>
                          {!hideEditMeta && (
                            <button
                              title="Edit meta"
                              onClick={() => handleStartEdit(row)}
                              disabled={actionLoading}
                              className="rounded p-1 hover:bg-gray-100 disabled:opacity-50"
                            >
                              <Edit2 className="h-4 w-4 text-gray-600" />
                            </button>
                          )}
                          <button
                            title="Delete"
                            onClick={() => {
                              void (async () => {
                                if (
                                  await confirm({
                                    title: `Delete key "${row.label}"?`,
                                    description: 'This cannot be undone.',
                                    type: 'danger',
                                  })
                                )
                                  void onDelete(row.id);
                              })();
                            }}
                            disabled={actionLoading}
                            className="rounded p-1 hover:bg-gray-100 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
