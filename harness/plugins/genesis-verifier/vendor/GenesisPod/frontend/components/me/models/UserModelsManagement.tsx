'use client';

import { useMemo, useState } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import { StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { getProviderBrand } from '@/lib/constants/ai-provider-logos';
import {
  Brain,
  Check,
  ChevronDown,
  Clock,
  Edit,
  Loader2,
  Plug,
  Plus,
  Search,
  Send,
  Shield,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  USER_MODEL_TYPE_OPTIONS,
  useUserModelConfigs,
  type UserModelConfig,
  type UserModelType,
  type ModelImportance,
} from '@/hooks/features/useUserModelConfigs';
import { useUserApiKeys } from '@/hooks/features/useUserApiKeys';
import {
  useMyKeyAssignments,
  useMyKeyRequests,
  type MyKeyRequest,
  type UserAssignmentView,
} from '@/hooks/features/useByokUser';
import { apiClient } from '@/lib/api/client';
import { confirm, toast } from '@/stores';
import { Modal } from '@/components/ui/dialogs/Modal';
import { SettingsSectionCard } from '@/components/ui/cards/SettingsSectionCard';
import { Alert } from '@/components/ui/feedback/Alert';
import { UserModelConfigModal } from './UserModelConfigModal';
import { UserModelsAutoConfigureButton } from './UserModelsAutoConfigureButton';

interface TestResult {
  success: boolean;
  message: string;
  latency?: number;
}

const TYPE_BADGE_CLASS: Record<UserModelType, string> = {
  CHAT: 'bg-blue-100 text-blue-700',
  CHAT_FAST: 'bg-sky-100 text-sky-700',
  CODE: 'bg-purple-100 text-purple-700',
  MULTIMODAL: 'bg-violet-100 text-violet-700',
  IMAGE_GENERATION: 'bg-green-100 text-green-700',
  IMAGE_EDITING: 'bg-orange-100 text-orange-700',
  EMBEDDING: 'bg-indigo-100 text-indigo-700',
  RERANK: 'bg-pink-100 text-pink-700',
  EVALUATOR: 'bg-amber-100 text-amber-700',
};

function typeLabel(t: UserModelType): string {
  return USER_MODEL_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

// 统一的"模型行"展示模型（虚拟），把两条来源链路并到同一张表里：
//   - SOURCE='PERSONAL'：用户在 UserModelConfig 表里自己配的模型（可编辑/删除/启停）
//   - SOURCE='SYSTEM'  ：admin 通过 KeyAssignment 授权的 AIModel（只读，由 admin 管控）
type ModelSource = 'PERSONAL' | 'SYSTEM';

interface UnifiedModelRow {
  source: ModelSource;
  // 共有字段
  rowKey: string; // table 唯一 key
  provider: string;
  modelId: string;
  displayName: string;
  modelType: UserModelType;
  isReasoning: boolean;
  maxTokens: number;
  supportsTemperature: boolean;
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  isEnabled: boolean;
  isDefault: boolean;
  apiFormat: string;
  priority: number;
  temperature: number;
  // 仅 PERSONAL 来源会有完整原始记录（编辑用）
  personal?: UserModelConfig;
  // 仅 SYSTEM 来源会有 assignment（展示配额、过期等）
  assignment?: UserAssignmentView;
}

function toRow(c: UserModelConfig): UnifiedModelRow {
  return {
    source: 'PERSONAL',
    rowKey: `personal-${c.id}`,
    provider: c.provider,
    modelId: c.modelId,
    displayName: c.displayName,
    modelType: c.modelType,
    isReasoning: c.isReasoning,
    maxTokens: c.maxTokens,
    supportsTemperature: c.supportsTemperature,
    supportsStreaming: c.supportsStreaming,
    supportsFunctionCalling: c.supportsFunctionCalling,
    supportsVision: c.supportsVision,
    isEnabled: c.isEnabled,
    isDefault: c.isDefault,
    apiFormat: c.apiFormat,
    priority: c.priority,
    temperature: c.temperature,
    personal: c,
  };
}

function assignmentToRow(a: UserAssignmentView): UnifiedModelRow {
  // 仅 ACTIVE 视为"可用"。其余状态 isEnabled=false（行变灰）。
  const isUsable = a.status === 'ACTIVE' && a.modelEnabled;
  return {
    source: 'SYSTEM',
    rowKey: `system-${a.id}`,
    provider: a.provider,
    modelId: a.modelId,
    displayName: a.modelDisplayName,
    modelType: (a.modelType as UserModelType) ?? 'CHAT',
    isReasoning: a.modelIsReasoning,
    maxTokens: a.modelMaxTokens,
    supportsTemperature: a.modelSupportsTemperature,
    supportsStreaming: a.modelSupportsStreaming,
    supportsFunctionCalling: a.modelSupportsFunctionCalling,
    supportsVision: a.modelSupportsVision,
    isEnabled: isUsable,
    isDefault: false,
    apiFormat: '—',
    priority: 0,
    temperature: 0,
    assignment: a,
  };
}

/**
 * 用户自己的模型管理页 — 布局和字段与管理员 /admin/ai/models 完全一致。
 * 列：MODEL / MODEL ID / TYPE / SOURCE / API KEY / STATUS / CAPABILITIES / ACTIONS
 *
 * 2026-05-08：把"系统授权"也合并进来：
 *   - SOURCE 列区分 PERSONAL（你自配）vs SYSTEM（admin 授权）
 *   - SYSTEM 行只读，编辑/删除/启停按钮全部禁用，行尾显示配额条
 *   - Provider 过滤下拉同时考虑 personal keys 和 assignment providers
 */
export function UserModelsManagement() {
  const { items, loading, update, remove, setDefault, refresh } =
    useUserModelConfigs();
  const { keys: apiKeys } = useUserApiKeys();
  const { assignments } = useMyKeyAssignments();
  const {
    requests: myRequests,
    submit: submitKeyRequest,
    cancel: cancelKeyRequest,
  } = useMyKeyRequests();
  const pendingRequest = useMemo(
    () => myRequests.find((r) => r.status === 'PENDING') ?? null,
    [myRequests]
  );

  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<UserModelConfig | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {}
  );
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState(false);
  const [overviewCollapsed, setOverviewCollapsed] = useState(true);

  const handleCancelPending = async () => {
    if (!pendingRequest) return;
    if (
      !(await confirm({
        title: '确定撤销当前待审批的申请吗？',
        description: '撤销后可重新提交。',
        type: 'warning',
      }))
    )
      return;
    setCancellingRequest(true);
    try {
      await cancelKeyRequest(pendingRequest.id);
    } finally {
      setCancellingRequest(false);
    }
  };

  const runTest = async (m: UserModelConfig) => {
    setTesting(m.id);
    try {
      const res = await apiClient.post<TestResult>(
        `/user/model-configs/${m.id}/test`,
        {}
      );
      setTestResults((prev) => ({ ...prev, [m.id]: res }));
      if (res.success) {
        toast.success(
          `${m.displayName}: ${res.message}${res.latency ? ` (${res.latency}ms)` : ''}`
        );
      } else {
        toast.error(`${m.displayName}: ${res.message}`);
      }
    } catch (e) {
      const msg = (e as Error).message || '测试失败';
      setTestResults((prev) => ({
        ...prev,
        [m.id]: { success: false, message: msg },
      }));
      toast.error(`${m.displayName}: ${msg}`);
    } finally {
      setTesting(null);
    }
  };

  // Provider 过滤下拉：personal keys ∪ personal model configs ∪ assignment providers
  const availableProviders = useMemo(() => {
    const set = new Set(apiKeys.map((k) => k.provider));
    items.forEach((m) => set.add(m.provider));
    assignments.forEach((a) => set.add(a.provider));
    return [...set].sort();
  }, [apiKeys, items, assignments]);

  // 合并 PERSONAL 配置 + SYSTEM 授权为统一展示行，状态 ACTIVE 的 SYSTEM 排在前面
  const rows = useMemo<UnifiedModelRow[]>(() => {
    const sysRows = assignments.map(assignmentToRow);
    const personalRows = items.map(toRow);
    return [...sysRows, ...personalRows];
  }, [items, assignments]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((m) => {
      if (providerFilter && m.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        m.displayName.toLowerCase().includes(q) ||
        m.modelId.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    });
  }, [rows, search, providerFilter]);

  // 新增 Modal 的 provider：从第一个已配 Key 的 provider 取，否则 openai
  const addProvider = availableProviders[0] ?? 'openai';
  const addApiKeyHint = apiKeys.find((k) => k.provider === addProvider);

  // ★ 需求概览：每个 modelType 是否已有一个可用模型（personal 启用 OR 系统授权 ACTIVE）；没有则提示用户
  const coverage = useMemo(() => {
    const map = new Map<
      UserModelType,
      { hasEnabled: boolean; hasDefault: boolean; count: number }
    >();
    for (const opt of USER_MODEL_TYPE_OPTIONS) {
      map.set(opt.value, { hasEnabled: false, hasDefault: false, count: 0 });
    }
    for (const m of rows) {
      const entry = map.get(m.modelType);
      if (!entry) continue;
      entry.count += 1;
      if (m.isEnabled) entry.hasEnabled = true;
      if (m.isEnabled && m.isDefault) entry.hasDefault = true;
    }
    return map;
  }, [rows]);

  const missingRequired = USER_MODEL_TYPE_OPTIONS.filter(
    (o) => o.importance === 'required' && !coverage.get(o.value)?.hasEnabled
  );

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <UserModelsAutoConfigureButton
          disabled={apiKeys.length === 0}
          onDone={() => void refresh()}
        />
        <button
          onClick={() => setShowRequestModal(true)}
          disabled={!!pendingRequest}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
          title={
            pendingRequest
              ? '你已有 1 条待审批的申请，请先撤销或等待管理员处理'
              : '向管理员申请授权一个系统模型（无需自己配 Key）'
          }
        >
          <Send className="h-4 w-4" /> 申请系统模型
        </button>
        <button
          onClick={() => setShowAdd(true)}
          disabled={apiKeys.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          title={
            apiKeys.length === 0
              ? '请先在 API Keys Tab 配置至少一个 Provider 的 Key'
              : undefined
          }
        >
          <Plus className="h-4 w-4" /> Add Model
        </button>
      </div>

      {pendingRequest && (
        <PendingRequestBanner
          request={pendingRequest}
          onCancel={handleCancelPending}
          cancelling={cancellingRequest}
        />
      )}

      {/* 需求概览 —— 告诉用户 Topic Insights / Research / RAG 等功能依赖哪些 modelType，
          以及当前缺什么。一键定位到 Add Modal 并预选缺失类型。 */}
      <SettingsSectionCard
        title="模型需求概览"
        description="不同功能（AI 问答 / Topic Insights / 知识库 RAG）依赖不同类型的模型； 建议至少配置标记为「必需」的类型。"
        action={
          <div className="flex items-center gap-2">
            {missingRequired.length > 0 && (
              <div className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                缺 {missingRequired.length} 类必需模型
              </div>
            )}
            <button
              type="button"
              onClick={() => setOverviewCollapsed((v) => !v)}
              aria-expanded={!overviewCollapsed}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100"
            >
              {overviewCollapsed ? '展开' : '收起'}
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  overviewCollapsed ? '' : 'rotate-180'
                }`}
              />
            </button>
          </div>
        }
      >
        {!overviewCollapsed && (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
            {USER_MODEL_TYPE_OPTIONS.map((opt) => {
              const c = coverage.get(opt.value)!;
              return (
                <CoverageCard
                  key={opt.value}
                  label={opt.label}
                  description={opt.description}
                  usedBy={opt.usedBy}
                  importance={opt.importance}
                  count={c.count}
                  hasEnabled={c.hasEnabled}
                  hasDefault={c.hasDefault}
                  onAdd={() => setShowAdd(true)}
                />
              );
            })}
          </div>
        )}
      </SettingsSectionCard>

      {/* Search + Filter — 对齐管理员 */}
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search 模型名称、Model ID、Provider..."
            className="w-full rounded-md border border-gray-200 bg-white py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Providers ({availableProviders.length})</option>
          {availableProviders.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* 表格 — MODEL / MODEL ID / TYPE / SOURCE / API KEY / STATUS / CAPABILITIES / ACTIONS
          SOURCE 列让用户能区分自配 vs 系统授权；SYSTEM 行编辑/启停/删除按钮 disable */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <Table className="w-full table-fixed">
          {/* 固定列宽：table-fixed + w-full 钉死表宽=容器宽，杜绝横向滚动；
              身份列(MODEL/MODEL ID)吃挤压并截断，徽章/操作列留足够宽度恒可见 */}
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[17%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[6%]" />
            <col className="w-[13%]" />
            <col className="w-[19%]" />
          </colgroup>
          <THead className="bg-gray-50">
            <Tr>
              <Th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Provider
              </Th>
              <Th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Model ID
              </Th>
              <Th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Type
              </Th>
              <Th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Source
              </Th>
              <Th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                API Key
              </Th>
              <Th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </Th>
              <Th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Capabilities
              </Th>
              <Th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </Th>
            </Tr>
          </THead>
          <TBody className="divide-y divide-gray-200">
            {loading && (
              <Tr>
                <Td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  加载中...
                </Td>
              </Tr>
            )}
            {!loading && filtered.length === 0 && (
              <Tr>
                <Td colSpan={8}>
                  {rows.length === 0 ? (
                    <EmptyState
                      size="sm"
                      title="还没有可用模型"
                      description="点击右上角「Add Model」自配，或先在「API Keys」tab 申请系统授权"
                    />
                  ) : (
                    <EmptyState
                      size="sm"
                      type="search"
                      title="没有匹配的模型"
                    />
                  )}
                </Td>
              </Tr>
            )}
            {filtered.map((m) => {
              const isSystem = m.source === 'SYSTEM';
              // PERSONAL 行的 hasKey = 用户自配过该 provider 的 active key
              // SYSTEM 行的"key" 由 admin 提供，行尾 SOURCE 列显示「Granted」
              const hasKey =
                isSystem ||
                apiKeys.some((k) => k.provider === m.provider && k.isActive);
              const personal = m.personal;
              const a = m.assignment;
              const usedDollars = a
                ? (a.userSpendCents / 100).toFixed(2)
                : null;
              const quotaDollars =
                a && a.userQuotaCents !== null
                  ? (a.userQuotaCents / 100).toFixed(2)
                  : null;
              return (
                <Tr
                  key={m.rowKey}
                  className={`hover:bg-gray-50 ${!m.isEnabled ? 'opacity-60' : ''}`}
                >
                  {/* PROVIDER —— 真实 provider：官方 logo + 正式名 */}
                  <Td className="px-4 py-2.5">
                    {(() => {
                      const brand = getProviderBrand(m.provider);
                      return (
                        <div className="flex items-center gap-2">
                          {brand.logo ? (
                            <img
                              src={brand.logo}
                              alt={brand.name}
                              className="h-5 w-5 shrink-0"
                            />
                          ) : (
                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-100 text-[10px] font-semibold text-gray-500">
                              {m.provider.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <TruncatedCell
                            className="min-w-0 text-sm font-medium text-gray-900"
                            tooltip={m.displayName}
                          >
                            {brand.name}
                          </TruncatedCell>
                        </div>
                      );
                    })()}
                  </Td>

                  {/* MODEL ID —— 模型标识 + 默认(★)/推理 符号挂在模型上 */}
                  <Td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <code
                        className="font-mono min-w-0 truncate rounded bg-gray-100 px-2 py-1 text-xs"
                        title={m.modelId}
                      >
                        {m.modelId}
                      </code>
                      {m.isDefault && (
                        <span title="默认模型" className="shrink-0">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        </span>
                      )}
                      {m.isReasoning && (
                        <span title="推理模型" className="shrink-0">
                          <Brain className="h-3.5 w-3.5 text-violet-500" />
                        </span>
                      )}
                    </div>
                  </Td>

                  {/* TYPE */}
                  <Td className="whitespace-nowrap px-4 py-2.5">
                    <span
                      title={!isSystem ? `API 格式：${m.apiFormat}` : undefined}
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        TYPE_BADGE_CLASS[m.modelType] ??
                        'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {typeLabel(m.modelType)}
                    </span>
                  </Td>

                  {/* SOURCE */}
                  <Td className="whitespace-nowrap px-4 py-2.5">
                    {isSystem ? (
                      <span
                        title={
                          usedDollars
                            ? quotaDollars
                              ? `管理员授权 · 已用 $${usedDollars} / $${quotaDollars}`
                              : `管理员授权 · 已用 $${usedDollars} · 无上限`
                            : '管理员授权（KeyAssignment）'
                        }
                      >
                        <StatusBadge
                          tone="success"
                          icon={Shield}
                          label="系统授权"
                        />
                      </span>
                    ) : (
                      <span title="你自己配置的模型">
                        <StatusBadge tone="info" icon={Edit} label="个人" />
                      </span>
                    )}
                  </Td>

                  {/* API KEY */}
                  <Td className="whitespace-nowrap px-4 py-2.5">
                    {isSystem ? (
                      <span title="managed by admin">
                        <StatusBadge
                          tone="success"
                          icon={Check}
                          label="Granted"
                        />
                      </span>
                    ) : (
                      <span title={`via your ${m.provider} key`}>
                        <StatusBadge
                          tone={hasKey ? 'success' : 'danger'}
                          label={hasKey ? 'Configured' : 'Missing'}
                        />
                      </span>
                    )}
                  </Td>

                  {/* STATUS toggle / state */}
                  <Td className="px-4 py-2.5 text-center">
                    {isSystem ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          a?.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                        title={
                          a?.status === 'ACTIVE'
                            ? '由管理员管控，可直接在业务中使用'
                            : `当前状态：${a?.status ?? '—'}`
                        }
                      >
                        {a?.status ?? 'UNKNOWN'}
                      </span>
                    ) : (
                      <button
                        onClick={() =>
                          personal &&
                          update(personal.id, { isEnabled: !m.isEnabled }).then(
                            () => refresh()
                          )
                        }
                        className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
                          m.isEnabled ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                            m.isEnabled ? 'left-[22px]' : 'left-0.5'
                          }`}
                        />
                      </button>
                    )}
                  </Td>

                  {/* CAPABILITIES */}
                  <Td className="px-4 py-2.5">
                    <div
                      className="flex items-center gap-1"
                      title={
                        isSystem
                          ? `${m.maxTokens} tokens`
                          : `优先级 ${m.priority} · 温度 ${m.temperature} · ${m.maxTokens} tokens`
                      }
                    >
                      {m.supportsTemperature && (
                        <span
                          title="支持 temperature"
                          className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700"
                        >
                          T
                        </span>
                      )}
                      {m.supportsStreaming && (
                        <span
                          title="支持流式"
                          className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"
                        >
                          S
                        </span>
                      )}
                      {m.supportsFunctionCalling && (
                        <span
                          title="支持函数调用"
                          className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700"
                        >
                          F
                        </span>
                      )}
                      {m.supportsVision && (
                        <span
                          title="支持视觉"
                          className="rounded bg-pink-100 px-1.5 py-0.5 text-xs text-pink-700"
                        >
                          V
                        </span>
                      )}
                    </div>
                  </Td>

                  {/* ACTIONS */}
                  <Td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isSystem ? (
                        <span
                          className="text-xs text-gray-400"
                          title="系统授权由管理员管理，无需用户操作"
                        >
                          管理员管控
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => personal && void runTest(personal)}
                            disabled={
                              !personal || testing === personal.id || !hasKey
                            }
                            title={
                              !hasKey
                                ? '先在 API Keys Tab 配置该 provider 的 Key'
                                : '测试连接（用你的 Key 实际调一次 provider）'
                            }
                            className={`rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              personal &&
                              testResults[personal.id]?.success === true
                                ? 'text-green-600 hover:bg-green-50'
                                : personal &&
                                    testResults[personal.id]?.success === false
                                  ? 'text-red-600 hover:bg-red-50'
                                  : 'text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            {personal && testing === personal.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Plug className="h-4 w-4" />
                            )}
                          </button>
                          {personal && !m.isDefault && m.isEnabled && (
                            <button
                              onClick={() => setDefault(personal.id)}
                              title="设为该类型默认"
                              className="rounded p-1.5 text-amber-600 hover:bg-amber-50"
                            >
                              <Star className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => personal && setEditing(personal)}
                            title="编辑"
                            className="rounded p-1.5 text-blue-600 hover:bg-blue-50"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (personal) {
                                void (async () => {
                                  if (
                                    await confirm({
                                      title: `确定删除模型 ${m.displayName}（${m.modelId}）吗？`,
                                      type: 'danger',
                                    })
                                  ) {
                                    void remove(personal.id);
                                  }
                                })();
                              }
                            }}
                            title="删除"
                            className="rounded p-1.5 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>

      {/* Add / Edit Modal — 字段完全对齐管理员 AIModelSettings */}
      {(showAdd || editing) && (
        <UserModelConfigModal
          key={editing?.id ?? 'new'}
          provider={editing?.provider ?? addProvider}
          apiKey=""
          apiEndpoint={addApiKeyHint?.apiEndpoint ?? undefined}
          initial={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowAdd(false);
            setEditing(null);
            void refresh();
          }}
        />
      )}

      {showRequestModal && (
        <RequestKeyModal
          onClose={() => setShowRequestModal(false)}
          submit={submitKeyRequest}
        />
      )}
    </div>
  );
}

// Re-export icons that the IDE sometimes trims from tree-shake analysis
export { Check, X };

function CoverageCard({
  label,
  description,
  usedBy,
  importance,
  count,
  hasEnabled,
  hasDefault,
  onAdd,
}: {
  label: string;
  description: string;
  usedBy: string[];
  importance: ModelImportance;
  count: number;
  hasEnabled: boolean;
  hasDefault: boolean;
  onAdd: () => void;
}) {
  const importanceBadge = {
    required: {
      text: '必需',
      className: 'bg-red-50 text-red-700',
    },
    recommended: {
      text: '推荐',
      className: 'bg-amber-50 text-amber-700',
    },
    optional: {
      text: '可选',
      className: 'bg-gray-50 text-gray-600',
    },
  }[importance];

  const status = hasDefault
    ? { text: '✓ 已配默认', className: 'text-green-600' }
    : hasEnabled
      ? { text: '● 已配置（未设默认）', className: 'text-blue-600' }
      : { text: '✗ 未配置', className: 'text-red-500' };

  return (
    <div
      className={`rounded-md border p-3 transition-colors ${
        !hasEnabled && importance === 'required'
          ? 'border-red-200 bg-red-50/40'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] ${importanceBadge.className}`}
          >
            {importanceBadge.text}
          </span>
        </div>
        <span className={`text-xs font-medium ${status.className}`}>
          {status.text}
        </span>
      </div>
      <div className="text-xs text-gray-600">{description}</div>
      <div className="mt-1 text-[11px] text-gray-400">
        用于：{usedBy.join(' · ')}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-gray-500">{count} 个已配置</span>
        {!hasEnabled && (
          <button
            onClick={onAdd}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            立即添加 →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── 待审批申请状态横幅 ─────────────────────────────────────────────────────
//
// 后端策略「每用户全局只能有 1 条 PENDING」(see key-requests.service.ts:87-95)。
// 前端必须在用户点击「申请系统模型」**之前**就把这条 PENDING 暴露出来，
// 并提供撤销入口，否则用户会反复撞 409。
function PendingRequestBanner({
  request,
  onCancel,
  cancelling,
}: {
  request: MyKeyRequest;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const usageLabel: Record<
    NonNullable<MyKeyRequest['estimatedUsage']>,
    string
  > = {
    LIGHT: '轻度 < $5',
    MEDIUM: '中度 $5-20',
    HEAVY: '重度 > $20',
  };
  const submittedAt = new Date(request.createdAt).toLocaleString();

  return (
    <Alert
      tone="warn"
      title="你有 1 条待管理员处理的系统模型申请"
      icon={<Clock className="h-4 w-4" />}
      action={
        <button
          onClick={onCancel}
          disabled={cancelling}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          {cancelling ? '撤销中...' : '撤销申请'}
        </button>
      }
    >
      <div className="space-y-1 text-xs">
        <div>提交时间：{submittedAt}</div>
        {request.estimatedUsage && (
          <div>预计用量：{usageLabel[request.estimatedUsage]}</div>
        )}
        {request.reason && (
          <div className="truncate" title={request.reason}>
            使用目的：{request.reason}
          </div>
        )}
        <p className="mt-1">
          提交新申请前，请等待管理员处理或先撤销当前申请。审批通过后会出现在下方表格中（标识为「系统授权」）。
        </p>
      </div>
    </Alert>
  );
}

// ─── 申请系统模型 Modal（内嵌，不跳页） ─────────────────────────────────────
//
// 用户**不**指定 provider/model。理由：admin 未必有该 provider 可用模型，
// 强选 provider 反而把申请卡死；同时 provider 列表是动态的（admin 在
// /admin/ai/models 随时启停 AIModel），前端 hardcode 难以同步。
// admin 在审批界面根据当前可用 AIModel 自由决定授权。
function RequestKeyModal({
  onClose,
  submit,
}: {
  onClose: () => void;
  submit: ReturnType<typeof useMyKeyRequests>['submit'];
}) {
  const [reason, setReason] = useState('');
  const [estimated, setEstimated] = useState<'LIGHT' | 'MEDIUM' | 'HEAVY'>(
    'MEDIUM'
  );
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      closeOnOverlayClick={false}
      size="lg"
      title="申请系统模型"
      subtitle="提交后管理员将根据当前可用模型为你授权，通常 24 小时内处理。审批通过后模型会出现在「我的模型」表格里，标识为「系统授权」。"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            disabled={submitting || !reason.trim()}
            onClick={async () => {
              setSubmitting(true);
              const r = await submit({
                reason: reason.trim() || undefined,
                estimatedUsage: estimated,
                note: note.trim() || undefined,
              });
              setSubmitting(false);
              if (r) onClose();
            }}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {submitting ? '提交中...' : '提交申请'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            使用目的 *
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：毕业设计需要使用 GPT-4o 做文献综述"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            预计月度用量 *
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { v: 'LIGHT', label: '轻度 < $5' },
                { v: 'MEDIUM', label: '中度 $5-20' },
                { v: 'HEAVY', label: '重度 > $20' },
              ] as const
            ).map((o) => (
              <label
                key={o.v}
                className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm ${
                  estimated === o.v
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={estimated === o.v}
                  onChange={() => setEstimated(o.v)}
                />
                {o.label}
              </label>
            ))}
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
