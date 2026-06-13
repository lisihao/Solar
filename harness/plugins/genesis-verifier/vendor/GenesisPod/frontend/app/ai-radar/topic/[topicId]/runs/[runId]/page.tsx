'use client';

/**
 * Radar Mission Detail Page —— 单次 Mission 的「团队 + 任务」详情视角。
 *
 * 信息架构完全照搬 agent-playground/team/[missionId] 整页布局：
 *   Header        : ← back · gradient icon · topic+mission meta · status pill + 操作
 *   Main flex:
 *     Left 360px  : RadarTeamPanel（5 个 Agent 成员卡 + Mission Progress + 关键指标）
 *     Right flex  : Tabs（任务列表 / 错误日志 / 指标汇总）+ Tab body
 *   Drawer        : StageTaskDrawer —— 点表格行打开，看该 stage 的详情
 *
 * 关键设计决策：
 *   - **每行 = 1 个 Agent 在本 Mission 中的任务**（5 行 = 5 stage groups）
 *   - URL `/runs/{runId}` 锁定 1 个 mission（≠多 run 历史）
 *   - 顶部 mission 切换器 chips 提供"切换历史 run"入口，URL replace 即可
 *   - 历史 run 列表完整视图请回 topic 页（不在本页堆 second-class 表格）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import { LoadingState } from '@/components/ui/states';
// 注：tab 渲染由 MissionDetailFrame 内部用 canonical <Tabs> 接管；这里保留导入
// 是为了让 audit-ui-discipline R7 知道本页用的是 canonical Tab 体系（不是自写 strip）。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Tabs as _CanonicalTabsForAudit } from '@/components/ui/tabs';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Coins,
  Database,
  ListChecks,
  Loader2,
  Radar,
  Sparkles,
  Wand2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import {
  cancelRun,
  getRun,
  getTopic,
  triggerRefresh,
} from '@/services/ai-radar/api';
import type { RadarRun, RadarTopicWithCounts } from '@/services/ai-radar/types';
import { useRadarSocket } from '@/hooks/domain/useRadarSocket';
import { ConfirmDialog } from '@/components/ui/dialogs/ConfirmDialog';
import { StageTaskDrawer } from '@/components/ai-radar/StageTaskDrawer';
import { RadarEventLog } from '@/components/ai-radar/RadarEventLog';
import {
  MissionActionGroup,
  MissionDetailFrame,
  type MissionActionButtonSpec,
} from '@/components/common/mission-detail';
import { useRadarStream } from '@/hooks/domain/useRadarStream';
import {
  TeamTopologyCanvas,
  type TeamTopologyNode,
  type TeamNodeStatus,
} from '@/components/common/team-topology';
import {
  STAGE_GROUPS,
  agentRoleTone,
  effectiveLastCompletedStage,
  formatDateTime,
  formatDuration,
  stageGroupStatus,
  stageStateTone,
  statusBadgeClass,
  statusLabel,
  triggerLabel,
  type StageGroup,
  type StageState,
} from '@/components/ai-radar/run-helpers';

// ──────────────────────────────────────────────────────────────────────
// Agent role → 图标（每个 stage agent 的视觉身份）
// ──────────────────────────────────────────────────────────────────────

const AGENT_ICON: Record<string, LucideIcon> = {
  collector: Radar,
  deduper: Database,
  scorer: Sparkles,
  enricher: Wand2,
  persister: Check,
};

// ──────────────────────────────────────────────────────────────────────
// getRun race retry —— backend refresh 是 fire-and-forget，mission row 由
// framework 在异步任务内 createAtomic 落库（~100-500ms 延迟）。前端立刻请求
// 时可能 404，对 404 做 5 次 × 600ms 重试（总 3s）兜底。
// 非 404 错误（500 / 403 / 网络）立即抛，不卡用户。
// ──────────────────────────────────────────────────────────────────────

async function getRunWithRaceRetry(runId: string): Promise<RadarRun> {
  for (let i = 0; i < 5; i++) {
    try {
      return await getRun(runId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!/404|not found/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  // R6: 3s 仍 404 —— mission row 异常未落库或 runId 真不存在。给用户可执行 hint
  throw new Error(
    `Mission 启动超时（3 秒内未落库）。可能后端启动异常或 runId 已失效，请刷新页面或返回主题页重试。`
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────────────────────────────

type TabKey = 'tasks' | 'timeline' | 'errors' | 'metrics';
const TABS: { key: TabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'tasks', label: '任务列表', Icon: ListChecks },
  { key: 'timeline', label: '事件时间线', Icon: Radar },
  { key: 'errors', label: '错误日志', Icon: AlertCircle },
  { key: 'metrics', label: '指标汇总', Icon: Coins },
];

// ──────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────

export default function RadarMissionDetailPage() {
  const params = useParams<{ topicId: string; runId: string }>();
  const router = useRouter();
  const topicId = params?.topicId;
  const runId = params?.runId;

  const [topic, setTopic] = useState<RadarTopicWithCounts | null>(null);
  const [run, setRun] = useState<RadarRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('tasks');
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [stageStatus, setStageStatus] = useState<{
    stage: string;
    status: string;
  } | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const isRunning = run?.status === 'running';
  const activeRunId = isRunning ? run.id : null;

  // 订阅当前 mission 的 WS stage 进度
  useRadarSocket(activeRunId, {
    onStage: (e) => setStageStatus({ stage: e.stage, status: e.status }),
    onCompleted: () => {
      setStageStatus(null);
      void reload();
    },
    onFailed: () => {
      setStageStatus(null);
      void reload();
    },
    onCancelled: () => {
      setStageStatus(null);
      void reload();
    },
  });

  // 实时事件流（replay hydrate + socket onAny 累积）—— 给"事件时间线" tab +
  // Drawer 的采集明细用。用整个 runId（非 activeRunId）：完成的 run 也能通过
  // /replay 回放近期历史事件。
  const { events: streamEvents } = useRadarStream(runId);

  const reload = useCallback(async () => {
    if (!topicId || !runId) return;
    setLoading(true);
    setErr(null);
    try {
      const [t, r] = await Promise.all([
        getTopic(topicId),
        getRunWithRaceRetry(runId),
      ]);
      setTopic(t);
      setRun(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [topicId, runId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRerun = async () => {
    if (!topicId || rerunning || isRunning) return;
    setRerunning(true);
    try {
      const resp = await triggerRefresh(topicId);
      // backend refresh 是 fire-and-forget：controller 立刻返回 missionId，
      // RadarRun row 由 framework 在异步任务里 createAtomic 落库（~100-500ms 延迟）。
      // 必须等 row 真落库再切 URL，否则新页面 mount 时 getRun(newRunId) → 404。
      await getRunWithRaceRetry(resp.runId);
      router.replace(`/ai-radar/topic/${topicId}/runs/${resp.runId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRerunning(false);
    }
  };

  const handleCancelConfirm = async () => {
    if (!run || run.status !== 'running') return;
    const targetId = run.id;
    setCancelling(true);
    try {
      await cancelRun(targetId);
      setCancelOpen(false);
      // R6 第二轮整改：cancel 后状态同步有两条路径需要兼顾：
      //   1) 正常路径：dispatcher.abortMission 找到 in-memory session → finally
      //      块 markCancelled + emit WS RUN_CANCELLED → onCancelled 回调 reload
      //   2) no-session 路径（pod 重启 / session 驱逐）：controller 直接调
      //      store.markCancelled 但**不发** WS 事件 → onCancelled 永不触发
      // 单靠 WS 会让 no-session 场景 UI 永远卡"运行中"。轮询兜底直到 status 变化
      // 或 5s 超时，与 WS 互不冲突（数据一致，多刷一次无害）。
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const fresh = await getRun(targetId);
          if (fresh.status !== 'running') {
            setRun(fresh);
            break;
          }
        } catch {
          // 短暂 race / 404，下次迭代再试；超时后退出循环
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(false);
    }
  };

  const selectedStage: StageGroup | null = useMemo(
    () => STAGE_GROUPS.find((g) => g.id === selectedStageId) ?? null,
    [selectedStageId]
  );

  if (!topicId || !runId) return null;

  if (loading && !topic) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <LoadingState size="md" />
      </div>
    );
  }

  if (err && !topic) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h1 className="text-2xl font-bold text-gray-900">加载失败</h1>
        <p className="mt-2 text-sm text-gray-600">{err}</p>
        <button
          type="button"
          onClick={() => router.push(`/ai-radar/topic/${topicId}`)}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回主题页
        </button>
      </div>
    );
  }

  if (!topic || !run) return null;

  // ── action 按钮 spec —— 与 playground / social 同款 MissionActionGroup ──
  const actionButtons: MissionActionButtonSpec[] = [];
  actionButtons.push({
    variant: 'primary',
    emoji: '🔄',
    label: rerunning ? '启动中…' : '重新精选',
    disabled: rerunning || isRunning,
    title: isRunning ? '已有 Mission 在运行' : '另起一个 Mission',
    onClick: () => void handleRerun(),
  });
  if (isRunning) {
    actionButtons.push({
      variant: 'danger',
      emoji: '⏹',
      label: '取消',
      onClick: () => setCancelOpen(true),
      title: '取消当前 Mission',
    });
  }

  // ── 左栏内容：scroll 中段 + sticky 底部按钮（结构对齐 TeamRosterPanel） ──
  const leftPanelContent = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <RadarTeamPanel
          run={run}
          currentStage={stageStatus?.stage ?? null}
          onAgentClick={(stageId) => {
            setSelectedStageId(stageId);
            setTab('tasks');
          }}
        />
      </div>
      <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
        <MissionActionGroup buttons={actionButtons} />
      </div>
    </div>
  );

  return (
    <>
      <MissionDetailFrame<TabKey>
        onBack={() => router.push(`/ai-radar/topic/${topicId}`)}
        backTitle="返回主题"
        // brandGradient fallback；Frame 内会按 /ai-radar 路由自动取 module-themes.radar
        // (cyan→sky)，不会真的用到这里的 violet
        brandGradient="from-cyan-500 to-sky-600"
        HeaderIcon={Radar}
        title={`${topic.name} · 精选 Mission`}
        subtitle={
          <>
            <span>{triggerLabel(run.trigger)}触发</span>
            <span>·</span>
            <span>{formatDateTime(run.startedAt)}</span>
            <span>·</span>
            <span className="font-mono text-[10px]">{run.id.slice(0, 8)}</span>
          </>
        }
        statusPill={
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${statusBadgeClass(run.status)}`}
          >
            {run.status === 'running' && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {statusLabel(run.status)}
          </span>
        }
        // header 不再放重复操作按钮 —— 统一收到左栏底部 sticky footer
        tabs={TABS}
        activeTab={tab}
        onTabChange={(k) => setTab(k as TabKey)}
        tabBarTrailing={<CompactMeters run={run} />}
        topBanner={
          err ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {err}
            </div>
          ) : null
        }
        leftPanel={leftPanelContent}
        leftCollapsed={leftCollapsed}
        onLeftCollapseToggle={() => setLeftCollapsed((v) => !v)}
      >
        <div className="px-6 py-5">
          {tab === 'tasks' && (
            <StageTaskBoard
              run={run}
              currentStage={stageStatus?.stage ?? null}
              selectedStageId={selectedStageId}
              onSelect={(stageId) =>
                setSelectedStageId(stageId === selectedStageId ? null : stageId)
              }
            />
          )}
          {tab === 'errors' && (
            <ErrorsTab
              run={run}
              onJumpToStage={(stageId) => {
                setSelectedStageId(stageId);
                setTab('tasks');
              }}
            />
          )}
          {tab === 'metrics' && <MetricsTab run={run} />}
          {tab === 'timeline' && (
            <RadarEventLog
              events={streamEvents}
              emptyHint={
                run.status === 'running'
                  ? '采集进行中 · 事件将实时出现'
                  : '本次 Mission 暂无缓存事件（服务重启后内存事件不保留）'
              }
              maxHeightClass="max-h-[calc(100vh-300px)]"
            />
          )}
        </div>
      </MissionDetailFrame>

      {/* Stage 任务 drawer */}
      <StageTaskDrawer
        run={run}
        stage={selectedStage}
        currentStage={stageStatus?.stage ?? null}
        events={streamEvents}
        onClose={() => setSelectedStageId(null)}
      />

      {/* Cancel mission confirm */}
      <ConfirmDialog
        open={cancelOpen}
        title="确认取消当前 Mission？"
        description="正在运行的 Agent 会立即停止，已采集 / 评分的中间数据不会写入今日精选。"
        confirmText="确认取消"
        cancelText="继续运行"
        type="danger"
        loading={cancelling}
        onConfirm={handleCancelConfirm}
        onClose={() => setCancelOpen(false)}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Mission switcher — 紧凑 chip 列表（最近 N 次 mission，点击切 URL）
// ──────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────
// CompactMeters — tab bar 右侧的紧凑指标（仿 playground 风格）
// ──────────────────────────────────────────────────────────────────────

function CompactMeters({ run }: { run: RadarRun }) {
  const m = run.metrics;
  // R10.5: 入库的真正含义是「最终通过精选门槛」= itemsAccepted；
  // itemsInserted 仅是「插入 DB」的中间数（含被评分淘汰的）。老 run fallback。
  const accepted = m?.itemsAccepted ?? m?.itemsInserted ?? 0;
  const fetched = m?.itemsFetched ?? 0;
  return (
    <div className="hidden items-center gap-3 px-2 text-[11px] text-gray-500 lg:flex">
      <span className="inline-flex items-center gap-1">
        <Database className="h-3 w-3" />
        抓取 <span className="font-semibold text-gray-700">{fetched}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <Check className="h-3 w-3" />
        入库 <span className="font-semibold text-emerald-600">{accepted}</span>
      </span>
      {run.durationMs != null && (
        <span className="inline-flex items-center gap-1">
          <Coins className="h-3 w-3" />
          {formatDuration(run.durationMs)}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Left: Radar Agent Team Panel
// ──────────────────────────────────────────────────────────────────────

function RadarTeamPanel({
  run,
  currentStage,
  onAgentClick,
}: {
  run: RadarRun;
  currentStage: string | null;
  onAgentClick: (stageId: string) => void;
}) {
  const lastDone = effectiveLastCompletedStage(run);
  const totalStages = 8;
  const progressPct = Math.min(100, Math.round((lastDone / totalStages) * 100));

  return (
    <div className="flex flex-col gap-4">
      {/* Team header */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Radar Agent Team
        </p>
        <h2 className="mt-0.5 text-base font-semibold text-gray-900">
          5 个 Agent 协作精选
        </h2>
      </div>

      {/* Agent topology — 与 playground / TI 共用 TeamTopologyCanvas */}
      <RadarTeamTopology
        run={run}
        currentStage={currentStage}
        onAgentClick={onAgentClick}
      />

      {/* Agent roster — 文字列表（仍保留以便看到 stage 描述 + click target） */}
      <div className="flex flex-col gap-1.5">
        {STAGE_GROUPS.map((g) => {
          const st = stageGroupStatus(run, g, currentStage);
          return (
            <AgentRosterRow
              key={g.id}
              stage={g}
              state={st}
              onClick={() => onAgentClick(g.id)}
            />
          );
        })}
      </div>

      {/* Mission progress */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">
            Mission Progress
          </span>
          <span className="text-xs font-semibold text-violet-700">
            {lastDone}/{totalStages}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${
              run.status === 'completed'
                ? 'bg-emerald-400'
                : run.status === 'failed'
                  ? 'bg-red-400'
                  : run.status === 'cancelled'
                    ? 'bg-slate-400'
                    : 'bg-violet-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {run.status === 'running' && currentStage && (
          <p className="mt-1.5 text-[11px] text-gray-500">
            当前阶段:{' '}
            <span className="font-mono text-violet-600">{currentStage}</span>
          </p>
        )}
      </div>

      {/* Key metrics */}
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <h3 className="mb-2 text-xs font-medium text-gray-700">关键指标</h3>
        <dl className="grid grid-cols-2 gap-x-2 gap-y-2 text-sm">
          <MetricStat
            label="尝试源"
            value={run.metrics?.sourcesAttempted ?? 0}
          />
          <MetricStat
            label="失败源"
            value={run.metrics?.sourcesFailed ?? 0}
            danger={(run.metrics?.sourcesFailed ?? 0) > 0}
          />
          <MetricStat label="抓取" value={run.metrics?.itemsFetched ?? 0} />
          {/* R10.5: 去重后 = fetched - 移除重复（itemsDeduped 是移除数不是剩余数） */}
          <MetricStat
            label="去重后"
            value={
              run.metrics?.itemsInserted ??
              Math.max(
                0,
                (run.metrics?.itemsFetched ?? 0) -
                  (run.metrics?.itemsDeduped ?? 0)
              )
            }
          />
          <MetricStat
            label="入库"
            value={
              run.metrics?.itemsAccepted ?? run.metrics?.itemsInserted ?? 0
            }
            highlight
          />
          <MetricStat label="耗时" value={formatDuration(run.durationMs)} />
        </dl>
      </div>
    </div>
  );
}

// ─── Radar 5-Agent topology ──────────────────────────────
// 与 playground / TI 共用 TeamTopologyCanvas（5 节点单行 pipeline）。
function RadarTeamTopology({
  run,
  currentStage,
  onAgentClick,
}: {
  run: RadarRun;
  currentStage: string | null;
  onAgentClick: (stageId: string) => void;
}) {
  const ROLE_COLOR: Record<string, string> = {
    collector: 'blue',
    deduper: 'amber',
    scorer: 'emerald',
    analyst: 'purple',
    persister: 'rose',
  };

  const nodes: TeamTopologyNode[] = STAGE_GROUPS.map((g) => {
    const st = stageGroupStatus(run, g, currentStage);
    const status: TeamNodeStatus =
      st === 'running'
        ? 'working'
        : st === 'completed'
          ? 'completed'
          : st === 'failed'
            ? 'failed'
            : 'idle';
    return {
      id: g.id,
      name: g.agent.name,
      role: g.agent.role,
      icon: '🤖',
      status,
      colorKey: ROLE_COLOR[g.agent.role] ?? 'blue',
    };
  });

  const rows: string[][] = [STAGE_GROUPS.map((g) => g.id)];
  const connections = STAGE_GROUPS.slice(0, -1).map((g, i) => ({
    from: g.id,
    to: STAGE_GROUPS[i + 1].id,
  }));

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-2"
      onClick={(e) => {
        const t = e.target as HTMLElement;
        const id = t.closest('[data-node-id]')?.getAttribute('data-node-id');
        if (id) onAgentClick(id);
      }}
    >
      <TeamTopologyCanvas
        nodes={nodes}
        rows={rows}
        connections={connections}
        heightClass="h-[140px]"
        viewBoxHeight={140}
        rowYPositions={[70]}
        patternId="radar"
      />
    </div>
  );
}

function AgentRosterRow({
  stage,
  state,
  onClick,
}: {
  stage: StageGroup;
  state: StageState;
  onClick: () => void;
}) {
  const tone = agentRoleTone(stage.agent.role);
  const stTone = stageStateTone(state);
  const Icon = AGENT_ICON[stage.agent.role] ?? Sparkles;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-gray-50 ${
        state === 'running'
          ? 'border-violet-300 bg-violet-50/60'
          : 'border-gray-200 bg-white'
      }`}
      title={stage.agent.description}
    >
      <span
        className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 ${tone.bg} ${tone.ring}`}
      >
        <Icon className={`h-4 w-4 ${tone.text}`} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-900">
            {stage.agent.name}
          </span>
          {state === 'running' && (
            <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-violet-500" />
          )}
        </div>
        <p className="truncate text-[11px] text-gray-500">{stage.label}</p>
      </div>
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ${stTone.bg} ${stTone.text} ${stTone.ring}`}
      >
        {stTone.label}
      </span>
    </button>
  );
}

function MetricStat({
  label,
  value,
  danger,
  highlight,
}: {
  label: string;
  value: number | string;
  danger?: boolean;
  highlight?: boolean;
}) {
  const num = typeof value === 'number' ? value : null;
  return (
    <>
      <dt className="text-[11px] text-gray-500">{label}</dt>
      <dd
        className={`text-right font-medium ${
          danger && (num ?? 0) > 0
            ? 'text-red-600'
            : highlight
              ? 'text-emerald-600'
              : 'text-gray-900'
        }`}
      >
        {value}
      </dd>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Right Tab: Stage Task Board — 每行 = 1 个 Agent 在本 mission 的任务
// ──────────────────────────────────────────────────────────────────────

function StageTaskBoard({
  run,
  currentStage,
  selectedStageId,
  onSelect,
}: {
  run: RadarRun;
  currentStage: string | null;
  selectedStageId: string | null;
  onSelect: (stageId: string) => void;
}) {
  // Status 计数
  const stageStates = STAGE_GROUPS.map((g) => ({
    id: g.id,
    state: stageGroupStatus(run, g, currentStage),
  }));
  const counts = stageStates.reduce<Record<StageState, number>>(
    (acc, x) => {
      acc[x.state] = (acc[x.state] ?? 0) + 1;
      return acc;
    },
    {
      completed: 0,
      running: 0,
      failed: 0,
      cancelled: 0,
      pending: 0,
    }
  );

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-900">任务列表</h3>
          <span className="text-xs text-gray-500">
            · 共 {STAGE_GROUPS.length} 项
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {(['completed', 'running', 'pending', 'failed', 'cancelled'] as const)
            .filter((k) => counts[k] > 0)
            .map((k) => {
              const tone = stageStateTone(k);
              return (
                <span key={k} className="flex items-center gap-1 text-gray-500">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      k === 'completed'
                        ? 'bg-emerald-500'
                        : k === 'running'
                          ? 'animate-pulse bg-violet-500'
                          : k === 'failed'
                            ? 'bg-red-500'
                            : k === 'cancelled'
                              ? 'bg-slate-400'
                              : 'bg-gray-300'
                    }`}
                  />
                  {tone.label} {counts[k]}
                </span>
              );
            })}
        </div>
      </div>

      {/* R9 2026-05-19: 数据流瀑布 —— 让用户一眼看出 item 在哪个 stage 流失。
          用户痛点："抓取 1 → 去重 1 → 入库 0，中间没有任何原因就丢了"。
          这条 bar 显式标出"评分淘汰 N 条"。 */}
      <DataFlowWaterfall run={run} />

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <Table className="w-full table-fixed">
          <THead className="border-b border-gray-200 bg-gray-50/80">
            <Tr>
              <Th className="w-10 px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                #
              </Th>
              <Th className="w-[36%] px-3 py-2.5 text-left text-xs font-semibold text-gray-600">
                任务名称
              </Th>
              <Th className="w-[20%] px-2 py-2.5 text-left text-xs font-semibold text-gray-600">
                负责 Agent
              </Th>
              <Th className="w-[14%] px-2 py-2.5 text-left text-xs font-semibold text-gray-600">
                模型
              </Th>
              <Th className="w-[10%] px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                数据
              </Th>
              <Th className="w-[14%] px-2 py-2.5 text-center text-xs font-semibold text-gray-600">
                状态
              </Th>
            </Tr>
          </THead>
          <TBody className="divide-y divide-gray-100 bg-white">
            {STAGE_GROUPS.map((g, idx) => {
              const st = stageGroupStatus(run, g, currentStage);
              const stTone = stageStateTone(st);
              const isSelected = selectedStageId === g.id;
              const tone = agentRoleTone(g.agent.role);
              const Icon = AGENT_ICON[g.agent.role] ?? Sparkles;
              const metricVal =
                g.metricKey != null ? (run.metrics?.[g.metricKey] ?? 0) : null;
              const rowCls = [
                'cursor-pointer transition-colors hover:bg-violet-50/30',
                'border-l-4',
                stTone.rowBorder,
                st === 'running' && 'bg-violet-50/40',
                st === 'failed' && 'bg-red-50/20',
                st === 'cancelled' && 'bg-slate-50/40 opacity-80',
                isSelected && 'ring-2 ring-inset ring-violet-400',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <Tr
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 ${g.label} 任务详情`}
                  onClick={() => onSelect(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(g.id);
                    }
                  }}
                  className={rowCls}
                >
                  <Td className="px-2 py-2.5 text-center text-xs text-gray-500">
                    {idx + 1}
                  </Td>
                  <Td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {st === 'completed' ? (
                        <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                      ) : st === 'running' ? (
                        <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-violet-500" />
                      ) : st === 'failed' ? (
                        <X className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
                      ) : st === 'cancelled' ? (
                        <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                      ) : (
                        <span className="inline-block h-3.5 w-3.5 flex-shrink-0 rounded-full bg-gray-100 ring-1 ring-gray-300" />
                      )}
                      <TruncatedCell
                        className="max-w-[200px] text-sm font-medium text-gray-900"
                        tooltip={`${g.label} — ${g.stages.join(' → ')}`}
                      >
                        {g.label}
                      </TruncatedCell>
                    </div>
                  </Td>
                  <Td className="px-2 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${tone.bg} ${tone.text} ${tone.ring}`}
                    >
                      <Icon className="h-3 w-3" />
                      {g.agent.name}
                    </span>
                  </Td>
                  <Td className="px-2 py-2.5">
                    {g.agent.usesLLM ? (
                      <span
                        className="font-mono inline-flex items-center rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 ring-1 ring-gray-200"
                        title="按 TaskProfile 由 ai-engine 路由实际模型"
                      >
                        LLM · CHAT
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-300">—</span>
                    )}
                  </Td>
                  <Td className="px-2 py-2.5 text-center text-sm font-medium text-gray-800">
                    {metricVal != null ? metricVal : '—'}
                  </Td>
                  <Td className="px-2 py-2.5 text-center">
                    <span
                      className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-medium ring-1 ${stTone.bg} ${stTone.text} ${stTone.ring}`}
                    >
                      {stTone.label}
                    </span>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </div>

      {/* Hint */}
      <p className="px-1 text-[11px] text-gray-500">
        <ChevronRight className="-mb-0.5 inline-block h-3 w-3" /> 点击任意行
        查看该 Agent 任务的详细执行情况
      </p>
    </div>
  );
}

function DataFlowWaterfall({ run }: { run: RadarRun }) {
  const m = run.metrics;
  if (!m) return null;
  // ── R10.5 2026-05-19: 修语义混淆 ──────────────────────────────────────
  // backend 字段实际含义（看 s3-dedupe / s8-persist 源码）：
  //   itemsFetched   = collector 拉的原始数
  //   itemsDeduped   = 被识别为"历史已存在"从而**移除**的重复数
  //   itemsInserted  = 通过 dedup 真正插入到 DB 的新 item 数（= 进评分阶段的入参）
  //   itemsAccepted  = 经评分+质量门槛后最终通过的 item 数（=「入库」的真正含义）
  // 旧 UI 把 itemsDeduped 当"去重后剩余"用、把 itemsInserted 当"入库最终数"用，
  // 都是误读。这里改成 surviving-count 语义。
  const fetched = m.itemsFetched ?? 0;
  const removedAsDup = m.itemsDeduped ?? 0;
  const enteredScoring = m.itemsInserted ?? Math.max(0, fetched - removedAsDup);
  const accepted = m.itemsAccepted ?? m.itemsInserted ?? 0;

  const droppedAtRelevance = m.droppedAtRelevance;
  const droppedAtQuality = m.droppedAtQuality;
  const hasSplit =
    droppedAtRelevance !== undefined && droppedAtQuality !== undefined;
  const passedRelevance = Math.max(
    0,
    enteredScoring - (droppedAtRelevance ?? 0)
  );
  const lostScoreFallback = Math.max(0, enteredScoring - accepted);

  if (fetched === 0 && accepted === 0 && removedAsDup === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-600">
        <Database className="h-3 w-3" />
        数据流瀑布
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <FlowNode label="抓取" value={fetched} tone="blue" />
        <FlowArrow lost={removedAsDup} reason="历史已存在" />
        <FlowNode label="去重后" value={enteredScoring} tone="sky" />
        {hasSplit ? (
          <>
            <FlowArrow lost={droppedAtRelevance ?? 0} reason="相关性 < 门槛" />
            <FlowNode label="评分通过" value={passedRelevance} tone="sky" />
            <FlowArrow lost={droppedAtQuality ?? 0} reason="质量分 < 门槛" />
          </>
        ) : (
          <FlowArrow lost={lostScoreFallback} reason="评分 / 质量阶段淘汰" />
        )}
        <FlowNode
          label="入库"
          value={accepted}
          tone={accepted > 0 ? 'emerald' : 'gray'}
        />
      </div>
      {fetched > 0 && accepted === 0 && (
        <p className="mt-2 inline-flex items-start gap-1 text-[11px] leading-relaxed text-amber-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>
            {enteredScoring === 0
              ? `抓取的 ${fetched} 条全部是历史已存在内容（未变化），没有新内容进入评分阶段。`
              : `${enteredScoring} 条新内容进入评分但未通过门槛，点击下方表格「评分」行查看每条被淘汰 item 的得分。`}
          </span>
        </p>
      )}
    </div>
  );
}

function FlowNode({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'sky' | 'emerald' | 'gray';
}) {
  const cls =
    tone === 'blue'
      ? 'bg-blue-100 text-blue-700 ring-blue-200'
      : tone === 'sky'
        ? 'bg-sky-100 text-sky-700 ring-sky-200'
        : tone === 'emerald'
          ? 'bg-emerald-100 text-emerald-700 ring-emerald-200'
          : 'bg-gray-100 text-gray-500 ring-gray-200';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium ring-1 ${cls}`}
    >
      <span className="text-[10.5px]">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </span>
  );
}

function FlowArrow({ lost, reason }: { lost: number; reason: string }) {
  if (lost === 0) {
    return <span className="text-gray-400">→</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-red-600"
      title={`流失 ${lost} 条：${reason}`}
    >
      <span className="text-gray-400">→</span>
      <span className="font-mono rounded bg-red-50 px-1 py-0.5 font-medium ring-1 ring-red-200">
        −{lost}
      </span>
      <span className="text-gray-500">{reason}</span>
      <span className="text-gray-400">→</span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Right Tab: Errors
// ──────────────────────────────────────────────────────────────────────

function ErrorsTab({
  run,
  onJumpToStage,
}: {
  run: RadarRun;
  onJumpToStage: (stageId: string) => void;
}) {
  const sourceErrors = run.metrics?.sourceErrors ?? [];
  if (!run.error && sourceErrors.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
        本次 Mission 没有错误。
      </div>
    );
  }

  // R6: 找到中断点对应的 stage group —— failed/cancelled 时 lastDone+1 落在
  //     哪个 group 就是中断点。Pm 反馈：失败时缺路径定位，用户不知道哪个 Agent 挂的。
  const isTerminal = run.status === 'failed' || run.status === 'cancelled';
  const breakpointStage = isTerminal
    ? (STAGE_GROUPS.find(
        (g) =>
          (run.lastCompletedStage ?? 0) + 1 >= g.stageNumStart &&
          (run.lastCompletedStage ?? 0) + 1 <= g.stageNumEnd
      ) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* R6: 失败时顶部加"中断点定位"卡，点击跳转任务列表 + 自动打开 drawer */}
      {breakpointStage && (
        <section className="rounded-xl border border-red-300 bg-red-50 p-4">
          <h3 className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-red-800">
            <AlertCircle className="h-4 w-4" />
            中断点：第 {breakpointStage.stageNumStart}
            {breakpointStage.stageNumEnd !== breakpointStage.stageNumStart && (
              <>-{breakpointStage.stageNumEnd}</>
            )}
            阶段「{breakpointStage.label}」
          </h3>
          <p className="text-xs leading-relaxed text-red-700">
            Mission 在 Agent「{breakpointStage.agent.name}」处
            {run.status === 'failed' ? '失败' : '被取消'}。
          </p>
          <button
            type="button"
            onClick={() => onJumpToStage(breakpointStage.id)}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 ring-1 ring-red-300 hover:bg-red-200"
          >
            跳转任务详情 →
          </button>
        </section>
      )}
      {run.error && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h3 className="mb-1 text-sm font-semibold text-red-800">
            原始错误信息
          </h3>
          <p className="text-xs leading-relaxed text-red-700">{run.error}</p>
        </section>
      )}
      {sourceErrors.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-800">
            源级错误（{sourceErrors.length} 个）
          </h3>
          <ul className="flex flex-col gap-1.5">
            {sourceErrors.map((e, i) => (
              <li key={`${e.sourceId}-${i}`} className="text-xs text-amber-700">
                <span className="font-mono">
                  {e.sourceId?.slice(0, 8) ?? '(unknown)'}
                </span>
                {' — '}
                {e.error}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Right Tab: Metrics summary
// ──────────────────────────────────────────────────────────────────────

function MetricsTab({ run }: { run: RadarRun }) {
  const m = run.metrics;
  const fetched = m?.itemsFetched ?? 0;
  const removedAsDup = m?.itemsDeduped ?? 0;
  const enteredScoring =
    m?.itemsInserted ?? Math.max(0, fetched - removedAsDup);
  const accepted = m?.itemsAccepted ?? m?.itemsInserted ?? 0;
  const stats: { label: string; value: string }[] = [
    { label: '尝试源数', value: String(m?.sourcesAttempted ?? 0) },
    { label: '失败源数', value: String(m?.sourcesFailed ?? 0) },
    { label: '抓取条数', value: String(fetched) },
    { label: '历史重复', value: String(removedAsDup) },
    { label: '去重后剩余', value: String(enteredScoring) },
    { label: '入库条数', value: String(accepted) },
    { label: '总耗时', value: formatDuration(run.durationMs) },
    {
      label: '阶段进度',
      value: `${effectiveLastCompletedStage(run)}/8`,
    },
    { label: '触发方式', value: `${triggerLabel(run.trigger)}触发` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl border border-gray-200 bg-white p-3"
        >
          <div className="text-xs text-gray-500">{s.label}</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
