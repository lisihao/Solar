'use client';

/**
 * Dreaming Dashboard — 持续反思可视化
 *
 * 后端接通：/api/v1/admin/dreaming/{overview,runs,rules,config,runs/trigger}
 *
 * 4 个 tab：
 *   - Overview stat 卡（rules / runs / tokens / 成功率 / 最近 run / 手动触发）
 *   - History runs 时间线（点击展开详情 drawer）
 *   - Rules 列表（点击展开详情 + 启用/禁用/硬删除）
 *   - Config 编辑（cron / sampleSize / sampleWindowHours / tokenBudget / enabled）
 */

import { useState } from 'react';
import {
  Brain,
  History as HistoryIcon,
  ListChecks,
  Settings as SettingsIcon,
  Play,
  Power,
  Trash2,
  TrendingUp,
  Clock,
  Zap,
} from 'lucide-react';
import { AdminPageLayout } from '@/components/admin/layout';
import { Tabs } from '@/components/ui/tabs';
import { confirm } from '@/stores';
import {
  useApiGet,
  useApiPost,
  useApiDelete,
  useApiMutation,
} from '@/hooks/core';

type TabKey = 'history' | 'rules' | 'config';

interface RunListItem {
  id: string;
  triggeredAt: string;
  triggerKind: 'cron' | 'failure_threshold' | 'manual';
  sampleSize: number;
  newRulesCount: number;
  rejectedCandidates: number;
  tokensUsed: number;
  durationMs: number;
  status: 'success' | 'failed';
}

interface RuleListItem {
  id: string;
  pattern: string;
  mitigation: string;
  failureCodes: string[];
  confidence: number;
  applicationCount: number;
  successCount: number;
  disabled: boolean;
  createdAt: string;
  effectiveConfidence: number;
  successRate: number;
}

interface DreamingOverview {
  totalRules: number;
  activeRules: number;
  recentRunsCount: number;
  totalTokensSpent: number;
  averageSuccessRate: number;
  lastRunAt: string | null;
}

interface DreamingConfig {
  cronExpression: string;
  sampleWindowHours: number;
  sampleSize: number;
  tokenBudget: number;
  enabled: boolean;
}

export default function DreamingDashboardContent({
  embedded,
}: { embedded?: boolean } = {}) {
  const [activeTab, setActiveTab] = useState<TabKey>('history');

  const overviewQ = useApiGet<DreamingOverview>('/admin/dreaming/overview');
  const runsQ = useApiGet<RunListItem[]>('/admin/dreaming/runs');
  const rulesQ = useApiGet<RuleListItem[]>('/admin/dreaming/rules');
  const configQ = useApiGet<DreamingConfig>('/admin/dreaming/config');

  const triggerRun = useApiPost<unknown>('/admin/dreaming/runs/trigger');

  const overview = overviewQ.data ?? {
    totalRules: 0,
    activeRules: 0,
    recentRunsCount: 0,
    totalTokensSpent: 0,
    averageSuccessRate: 0,
    lastRunAt: null,
  };
  const runs = runsQ.data ?? [];
  const rules = rulesQ.data ?? [];

  const handleTrigger = async () => {
    await triggerRun.execute();
    await runsQ.refresh();
    await overviewQ.refresh();
    await rulesQ.refresh();
  };

  const refreshAll = async () => {
    await Promise.all([overviewQ.refresh(), runsQ.refresh(), rulesQ.refresh()]);
  };

  const body = (
    <>
      {/* Overview stat 卡 */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          icon={ListChecks}
          label="规则总数"
          value={overview.totalRules}
          hint={`活跃 ${overview.activeRules}`}
        />
        <StatCard
          icon={HistoryIcon}
          label="近 7 天 runs"
          value={overview.recentRunsCount}
          hint={
            overview.lastRunAt
              ? `最近 ${formatRelative(overview.lastRunAt)}`
              : '暂无'
          }
        />
        <StatCard
          icon={Zap}
          label="总 token 消耗"
          value={formatTokens(overview.totalTokensSpent)}
        />
        <StatCard
          icon={TrendingUp}
          label="平均成功率"
          value={`${Math.round(overview.averageSuccessRate * 100)}%`}
          hint="规则应用后 mission 改善比例"
        />
        <button
          type="button"
          disabled={triggerRun.loading}
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-600 transition hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
          onClick={handleTrigger}
        >
          <Play className="mb-1 h-5 w-5" />
          {triggerRun.loading ? '运行中...' : '手动触发反思'}
        </button>
      </div>

      {/* Tabs */}
      <Tabs
        className="mb-4"
        value={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
        items={[
          {
            key: 'history',
            iconNode: <HistoryIcon className="h-4 w-4" />,
            label: '历史',
          },
          {
            key: 'rules',
            iconNode: <ListChecks className="h-4 w-4" />,
            label: '规则',
          },
          {
            key: 'config',
            iconNode: <SettingsIcon className="h-4 w-4" />,
            label: '配置',
          },
        ]}
      />

      {/* Tab content */}
      {activeTab === 'history' && (
        <HistoryTab runs={runs} loading={runsQ.loading} />
      )}
      {activeTab === 'rules' && (
        <RulesTab
          rules={rules}
          loading={rulesQ.loading}
          onChange={refreshAll}
        />
      )}
      {activeTab === 'config' && (
        <ConfigTab config={configQ.data} onSaved={() => configQ.refresh()} />
      )}
    </>
  );

  // ★ embedded 模式：跳过外层 AdminPageLayout（供 /admin/ai/harness?tab=dreaming 内嵌）
  if (embedded) return body;

  return (
    <AdminPageLayout
      title="Dreaming · 持续反思"
      description="跨 mission 周期反思失败规律，归纳通用规则注入下轮 mission。Anthropic Managed Agent 同款元学习机制。"
      icon={Brain}
    >
      {body}
    </AdminPageLayout>
  );
}

// ─── Tab: History（持续反思时间线）────────────────────────────────────────

function HistoryTab({
  runs,
  loading,
}: {
  runs: RunListItem[];
  loading: boolean;
}) {
  if (loading) return <SkeletonRows />;
  if (runs.length === 0) {
    return (
      <EmptyState
        title="暂无反思历史"
        description="按 cron 调度的反思 run 会在此呈现。也可点击右上手动触发反思立即跑一轮。"
      />
    );
  }
  return (
    <ul className="space-y-2">
      {runs.map((run) => (
        <li
          key={run.id}
          className="rounded-lg border border-gray-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/30"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">
              {formatTime(run.triggeredAt)} · {triggerLabel(run.triggerKind)}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                run.status === 'success'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {run.status === 'success' ? '成功' : '失败'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs text-gray-500">
            <span>抽样 {run.sampleSize} 个 mission</span>
            <span>
              新规则 {run.newRulesCount} / 拒 {run.rejectedCandidates}
            </span>
            <span>{formatTokens(run.tokensUsed)} token</span>
            <span>{Math.round(run.durationMs / 1000)}s</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Tab: Rules（规则详情）────────────────────────────────────────────────

function RulesTab({
  rules,
  loading,
  onChange,
}: {
  rules: RuleListItem[];
  loading: boolean;
  onChange: () => Promise<void>;
}) {
  if (loading) return <SkeletonRows />;
  if (rules.length === 0) {
    return (
      <EmptyState
        title="暂无规则"
        description="反思 mission 归纳产生的规则会在此列出。每条含 pattern / mitigation / 来源 mission / 应用统计与衰减置信度。"
      />
    );
  }
  return (
    <ul className="space-y-2">
      {rules.map((rule) => (
        <RuleItem key={rule.id} rule={rule} onChange={onChange} />
      ))}
    </ul>
  );
}

function RuleItem({
  rule,
  onChange,
}: {
  rule: RuleListItem;
  onChange: () => Promise<void>;
}) {
  const disable = useApiMutation<{ ok: true }>(
    'patch',
    `/admin/dreaming/rules/${rule.id}/disable`
  );
  const enable = useApiMutation<{ ok: true }>(
    'patch',
    `/admin/dreaming/rules/${rule.id}/enable`
  );
  const remove = useApiDelete<{ ok: true }>(`/admin/dreaming/rules/${rule.id}`);

  const toggle = async () => {
    if (rule.disabled) await enable.execute();
    else await disable.execute();
    await onChange();
  };

  const hardDelete = async () => {
    if (
      !(await confirm({
        title: '确认硬删除？保留历史请用"禁用"',
        description: rule.pattern,
        type: 'danger',
      }))
    )
      return;
    await remove.execute();
    await onChange();
  };

  return (
    <li
      className={`rounded-lg border p-3 transition hover:border-blue-300 ${
        rule.disabled
          ? 'border-gray-200 bg-gray-50 opacity-60'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1">
          <p className="mb-1 text-sm font-medium text-gray-900">
            {rule.pattern}
          </p>
          <p className="text-xs text-gray-600">{rule.mitigation}</p>
        </div>
        <div className="ml-2 flex gap-1">
          <button
            type="button"
            onClick={toggle}
            disabled={disable.loading || enable.loading}
            className={`rounded border px-2 py-1 text-xs ${
              rule.disabled
                ? 'border-green-300 text-green-700 hover:bg-green-50'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <Power className="mr-1 inline h-3 w-3" />
            {rule.disabled ? '启用' : '禁用'}
          </button>
          <button
            type="button"
            onClick={hardDelete}
            disabled={remove.loading}
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            title="硬删除"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" /> {formatRelative(rule.createdAt)}
        </span>
        <span>
          应用 {rule.applicationCount} · 成功 {rule.successCount}
          {rule.applicationCount > 0 && (
            <span className="ml-1">
              （{Math.round(rule.successRate * 100)}%）
            </span>
          )}
        </span>
        <span>置信度 {Math.round(rule.confidence * 100)}%</span>
        <span>有效 {Math.round(rule.effectiveConfidence * 100)}%</span>
        {rule.failureCodes.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {rule.failureCodes.slice(0, 3).map((code) => (
              <span key={code} className="rounded bg-gray-100 px-1.5 py-0.5">
                {code}
              </span>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

// ─── Tab: Config ──────────────────────────────────────────────────────────

function ConfigTab({
  config,
  onSaved,
}: {
  config: DreamingConfig | undefined;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<DreamingConfig | undefined>(config);
  const save = useApiMutation<DreamingConfig, Partial<DreamingConfig>>(
    'patch',
    '/admin/dreaming/config'
  );

  if (!config) return <SkeletonRows />;
  const current = draft ?? config;

  const handleSave = async () => {
    await save.execute(current);
    await onSaved();
  };

  return (
    <div className="max-w-2xl rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-4 text-sm text-gray-600">
        Dreaming 调度配置。保存后立即生效（cron 重新注册）。
      </p>
      <div className="space-y-3 text-sm">
        <ConfigEditRow label="Cron 表达式" hint="如 '0 */6 * * *' = 每 6 小时">
          <input
            type="text"
            value={current.cronExpression}
            onChange={(e) =>
              setDraft({ ...current, cronExpression: e.target.value })
            }
            className="font-mono w-48 rounded border border-gray-300 px-2 py-1 text-right text-xs"
          />
        </ConfigEditRow>
        <ConfigEditRow label="抽样窗口（小时）" hint="1-168">
          <input
            type="number"
            min={1}
            max={168}
            value={current.sampleWindowHours}
            onChange={(e) =>
              setDraft({
                ...current,
                sampleWindowHours: parseInt(e.target.value, 10) || 24,
              })
            }
            className="w-24 rounded border border-gray-300 px-2 py-1 text-right"
          />
        </ConfigEditRow>
        <ConfigEditRow label="抽样上限" hint="1-100">
          <input
            type="number"
            min={1}
            max={100}
            value={current.sampleSize}
            onChange={(e) =>
              setDraft({
                ...current,
                sampleSize: parseInt(e.target.value, 10) || 20,
              })
            }
            className="w-24 rounded border border-gray-300 px-2 py-1 text-right"
          />
        </ConfigEditRow>
        <ConfigEditRow label="单轮 token 预算" hint="1000-500000">
          <input
            type="number"
            min={1000}
            max={500000}
            value={current.tokenBudget}
            onChange={(e) =>
              setDraft({
                ...current,
                tokenBudget: parseInt(e.target.value, 10) || 50000,
              })
            }
            className="w-32 rounded border border-gray-300 px-2 py-1 text-right"
          />
        </ConfigEditRow>
        <ConfigEditRow label="启用" hint="关闭则停 cron">
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(e) =>
              setDraft({ ...current, enabled: e.target.checked })
            }
            className="h-4 w-4"
          />
        </ConfigEditRow>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setDraft(config)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          重置
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={save.loading}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {save.loading ? '保存中...' : '保存'}
        </button>
      </div>
      {save.error && (
        <p className="mt-2 text-xs text-red-600">
          保存失败：{save.error.message ?? '未知错误'}
        </p>
      )}
    </div>
  );
}

// ─── Reusable bits ─────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Brain;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="text-xl font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
      <Brain className="mx-auto mb-2 h-10 w-10 text-gray-300" />
      <p className="mb-1 text-sm font-medium text-gray-700">{title}</p>
      <p className="mx-auto max-w-md text-xs text-gray-500">{description}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-16 animate-pulse rounded-lg border border-gray-100 bg-gray-50"
        />
      ))}
    </ul>
  );
}

function ConfigEditRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-gray-100 pb-2">
      <div className="min-w-[180px] text-gray-600">
        {label}
        {hint && <span className="ml-2 text-xs text-gray-400">{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─── Formatters ────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours}h 前`;
  return `${Math.floor(hours / 24)}d 前`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function triggerLabel(kind: 'cron' | 'failure_threshold' | 'manual'): string {
  if (kind === 'cron') return '定时';
  if (kind === 'failure_threshold') return '失败触发';
  return '手动';
}
