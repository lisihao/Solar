'use client';

/**
 * DeepInsightMissionDetail（L4）— 深度洞察能力的唯一对外成品入口。
 *
 * ★ 蓝本 = PLAYGROUND 真实详情页（app/agent-playground/team/[missionId]/page.tsx）：
 *   - 外壳：canonical MissionDetailFrame。
 *   - 左栏：TeamRosterPanel（SVG 阵型图 + 任务进度 + 共识质量 + 研究维度 + 运行配置卡 +
 *     开始/更新/取消按钮）。
 *   - 右侧 6 tab：tasks→MissionTodoBoard · collab→MissionFlowView · report→ArtifactReader ·
 *     references→ReferencesPanel · graph→MissionGraphTab · cost→ComputeUsagePanel(+
 *     CapabilityMeters + MemoryIndexPanel)。
 *
 * 视觉/结构与 playground 详情页一致：这些 playground 面板按 §22 「kit import 复用、不
 * 物理迁出」直接 import，由 L4 把归一契约 DeepInsightMissionView 喂进各面板（运行态
 * 强耦合字段 events / canonical view / graph API 在 company 无 live 数据时合理降级）。
 *
 * 本组件**只吃 DeepInsightMissionView 契约**（唯一对外入口）。契约的 DI* 运行态镜像
 * 类型与 playground `mission-presentation.types` 结构兼容，喂面板时做结构化窄化转换
 * （数组 → Map、unknown[] → PlaygroundEvent[]、reportArtifact 富对象判定）。
 */

import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Coins,
  Database,
  FileText,
  Layers,
  ListChecks,
  Network,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { MissionDetailFrame } from '@/components/common/mission-detail';
import {
  CapabilityMeters,
  ComputeUsagePanel,
  MemoryIndexPanel,
  MissionFlowView,
  MissionTodoBoard,
  ReferencesPanel,
  TeamRosterPanel,
  TodoDetailDrawer,
} from '@/components/agent-playground';
import { MissionGraphTab } from '@/components/agent-playground/MissionGraphTab';
import {
  ArtifactReader,
  ArtifactMarkdown,
} from '@/components/agent-playground/artifact';
import {
  isReportArtifact,
  type ArtifactCitation,
  type ReportArtifact,
} from '@/lib/features/agent-playground/report-artifact.types';
import type {
  AgentLiveState,
  CostState,
  DimensionPipelineState,
  MemoryIndexState,
  StageState,
  VerifierVerdict,
} from '@/lib/features/agent-playground/mission-presentation.types';
import type { MissionTodo } from '@/lib/features/agent-playground/mission-todo.types';
import type { MissionDetailView } from '@/services/agent-playground/api';
import type { PlaygroundEvent } from '@/hooks/features/useAgentPlaygroundStream';
import { MODULE_THEMES } from '@/lib/design/module-themes';
import type { DeepInsightMissionView, MissionStep } from './contract';

type TabKey = 'tasks' | 'collab' | 'report' | 'references' | 'graph' | 'cost';

const ALL_TABS: { key: TabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'tasks', label: '任务列表', Icon: ListChecks },
  { key: 'collab', label: '协作动态', Icon: Activity },
  { key: 'report', label: '输出报告', Icon: FileText },
  { key: 'references', label: '参考文献', Icon: Layers },
  { key: 'graph', label: '图谱分析', Icon: Network },
  { key: 'cost', label: '算力消耗', Icon: Coins },
];

// Deep-insight brand icon — 沿用 playground 的 ClipboardList（文档/任务感）
const BrandIcon = ClipboardList;

const EMPTY_COST: CostState = { tokensUsed: 0, costUsd: 0, byStage: [] };

/** URL → 裸域名（去协议/www）。 */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return (url.replace(/^https?:\/\//, '').split('/')[0] ?? url) || url;
  }
}

/** 域名 → ArtifactCitation.sourceType（粗分类，给 ReferencesPanel 的来源分组/筛选）。 */
function sourceTypeOf(domain: string): ArtifactCitation['sourceType'] {
  const d = domain.toLowerCase();
  if (/(\.gov)|congress|whitehouse|federal/.test(d)) return 'gov';
  if (/arxiv|semanticscholar|pubmed|openalex|scholar|(\.edu)/.test(d))
    return 'academic';
  if (/github|hackernews|news\.ycombinator|reddit|stackoverflow/.test(d))
    return 'community';
  if (/news|times|reuters|bloomberg|techcrunch|verge/.test(d)) return 'news';
  return 'other';
}

/**
 * company 的归一 Reference（source/title/snippet/publishedAt）→ 富 ArtifactCitation，
 * 让 ReferencesPanel 渲染与 playground 一致的富卡片（标题 + 摘要 + 来源类型），
 * 而不是裸 URL 兜底列表。
 */
function citationFromReference(
  r: { source: string; title?: string; snippet?: string; publishedAt?: string },
  i: number
): ArtifactCitation {
  const url = r.source;
  const domain = domainOf(url);
  return {
    index: i + 1,
    uuid: `ref-${i}`,
    title: r.title || domain,
    url,
    domain,
    snippet: r.snippet,
    publishedAt: r.publishedAt,
    accessedAt: '',
    sourceType: sourceTypeOf(domain),
    credibilityScore: 0,
    occurrences: [],
  };
}

export interface DeepInsightMissionDetailProps {
  data: DeepInsightMissionView;
  onBack?: () => void;
  /** 「开始/重新下发」—— 透传给左栏 TeamRosterPanel 的按钮区（与 playground 一致）。 */
  onRerun?: () => void;
  onDelete?: () => void;
  /**
   * 「更新/继续上次」—— 用相同 topic 进入新建表单（编辑配置后再跑）。
   * 对应 TeamRosterPanel.onUpdate。isResumable=true 时按钮 label 变"继续上次"。
   */
  onUpdate?: () => void;
  /** 「取消」—— 取消运行中的 mission。 */
  onCancel?: () => void;
  /**
   * 点击 Leader 节点时触发（可打开 LeaderChatModal 或其他交互）。
   * 不传时 TeamRosterPanel 仍渲染节点，只是没有点击反馈。
   */
  onLeaderClick?: () => void;
  /**
   * 点击 Research Team 节点时触发（展开 group 内部 micro-pipeline）。
   * 不传时同上。
   */
  onResearchTeamClick?: () => void;
  /** WebSocket 连接状态（'connected'|'disconnected'|'reconnecting'）；用于 topBanner 提示。 */
  connState?: 'connected' | 'disconnected' | 'reconnecting';
  /** WS 或运行期错误消息；有值时 topBanner 显示错误提示。 */
  wsError?: string;
  /**
   * 点击 header 右上角设置（cog）按钮时触发。
   * 不传时不渲染 cog 按钮（诚实降级，不留空壳）。
   */
  onSettings?: () => void;
}

export function DeepInsightMissionDetail({
  data,
  onBack,
  onRerun,
  onUpdate,
  onCancel,
  onLeaderClick,
  onResearchTeamClick,
  connState,
  wsError,
  onSettings,
}: DeepInsightMissionDetailProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('tasks');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);

  // ── 契约 DI* 镜像 → playground 面板原生类型（结构兼容，仅做窄化 cast）──
  const agents = data.agents as unknown as AgentLiveState[];
  const stages = data.stages as unknown as StageState[];
  const cost: CostState = data.cost
    ? (data.cost as unknown as CostState)
    : EMPTY_COST;

  // dimensionPipelines：契约是数组 → 面板要 Map<string, ...>
  const dimensionPipelines = useMemo<
    Map<string, DimensionPipelineState>
  >(() => {
    const m = new Map<string, DimensionPipelineState>();
    for (const p of data.dimensionPipelines) {
      m.set(p.dimension, p as unknown as DimensionPipelineState);
    }
    return m;
  }, [data.dimensionPipelines]);

  // events：契约是 unknown[]（company 无 → 空数组）→ collab tab 用 PlaygroundEvent[]
  const events = data.events as unknown as PlaygroundEvent[];
  const hasEvents = events.length > 0;

  // memory：契约 DIMemoryIndexState | undefined → 面板要 MemoryIndexState | null
  const memory = (data.memory as MemoryIndexState | undefined) ?? null;

  // 真实运行耗时：终态用 completedAt-createdAt；运行中用 now-createdAt；无时间戳才 0。
  // 不再写死假 0s（CapabilityMeters.wallTimeMs 必填，故给真实/估算值而非伪 0）。
  const wallTimeMs = useMemo(() => {
    if (data.createdAt == null) return 0;
    const end =
      data.completedAt ??
      (data.missionStatus === 'running' ? Date.now() : data.createdAt);
    return Math.max(0, end - data.createdAt);
  }, [data.createdAt, data.completedAt, data.missionStatus]);

  // missionTerminal：missionStatus 非 running 即终态
  const missionTerminal = data.missionStatus !== 'running';

  // ── tasks：MissionTodoBoard 需 MissionTodo[]；company 仅有 steps → 派生最小子集 ──
  const todos = useMemo<MissionTodo[]>(
    () => buildTodosFromSteps(data.steps),
    [data.steps]
  );

  // ── report：富 ReportArtifact 判定（有 → ArtifactReader 三视图；无 → markdown 兜底）──
  const reportArtifact: ReportArtifact | null = useMemo(() => {
    const raw = data.reportArtifact;
    if (raw && typeof raw === 'object' && isReportArtifact(raw)) {
      return raw;
    }
    return null;
  }, [data.reportArtifact]);

  // ── references：富 citations 优先（来自 reportArtifact），缺则 references.source 兜底 ──
  const richCitations = useMemo<readonly ArtifactCitation[] | undefined>(() => {
    const raw = data.reportArtifact;
    if (
      raw &&
      typeof raw === 'object' &&
      isReportArtifact(raw) &&
      Array.isArray(raw.citations) &&
      raw.citations.length > 0
    ) {
      return raw.citations as readonly ArtifactCitation[];
    }
    // company：无 reportArtifact，但 references 自带 title/snippet → 映成富卡片
    if (data.references.length > 0) {
      return data.references.map((r, i) => citationFromReference(r, i));
    }
    return undefined;
  }, [data.reportArtifact, data.references]);
  const fallbackSources = useMemo<string[]>(
    () => data.references.map((r) => r.source).filter((s) => !!s),
    [data.references]
  );

  // ── canonical view（collab / CapabilityMeters 需要；company 无 → undefined）──
  // company 侧 fromCompanyMissionResult 不产出 canonical view；playground 侧 adapter
  // 可在 reportArtifact / events 之外携带原始 view。契约未直接承载 MissionDetailView，
  // collab/CapabilityMeters 仅在 events 存在（= playground live）时才有意义 → 用 events
  // 有无作为 live 闸门，无 live 数据时这两处降级隐藏。
  const canonicalView = data.reportArtifact as MissionDetailView | undefined;

  // ── CapabilityMeters 最小 fake view（company 无 canonical view 也能渲染 cost tab）──
  // CapabilityMeters 只读 view.mission.{finalScore/status/startedAt/finishedAt} + view.verdicts
  // 和 view.memoryIndex，构造最小兼容 shape，不产生 any。
  const capabilityFakeView = useMemo<MissionDetailView>(() => {
    const playgroundVerdicts: VerifierVerdict[] = data.verdicts.map(
      (v): VerifierVerdict => ({
        verifierId: v.verifierId,
        score: v.score,
        critique: v.critique,
        criteria: v.criteria,
        modelId: v.modelId,
      })
    );
    return {
      mission: {
        id: data.id,
        // idle は 'starting' に写像（MissionViewStatus に 'idle' がない）
        status:
          data.missionStatus === 'completed'
            ? 'completed'
            : data.missionStatus === 'failed'
              ? 'failed'
              : data.missionStatus === 'cancelled'
                ? 'cancelled'
                : data.missionStatus === 'idle'
                  ? 'starting'
                  : 'running',
        resumable: false,
        canCancel: data.missionStatus === 'running',
        rerunnableStages: [],
        finalScore: data.finalScore,
        // startedAt / finishedAt: epoch ms → ISO string
        startedAt:
          data.createdAt != null
            ? new Date(data.createdAt).toISOString()
            : undefined,
        finishedAt:
          data.missionStatus === 'completed' || data.missionStatus === 'failed'
            ? new Date().toISOString()
            : undefined,
      },
      stages: [],
      agents: [],
      verdicts: playgroundVerdicts,
      memoryIndex: data.memory
        ? {
            chunks: data.memory.chunks,
            namespace: data.memory.namespace,
            tags: data.memory.tags,
          }
        : null,
      references: [],
      reportVersions: [],
      timelineVersion: 0,
      snapshotVersion: 0,
    };
  }, [
    data.id,
    data.missionStatus,
    data.finalScore,
    data.createdAt,
    data.verdicts,
    data.memory,
  ]);

  // ── 全部 6 个 tab 都显示（与 playground 完全一致）；无 live 数据的 collab/graph 走空态 ──
  const tabs = ALL_TABS;

  // 当前 tab 不在可见集合（数据降级）→ 落回 tasks
  const safeActiveTab = tabs.some((t) => t.key === activeTab)
    ? activeTab
    : 'tasks';

  // ── 左栏 TeamRosterPanel（吃 DeepInsightMissionView）──
  const leftPanel = (
    <TeamRosterPanel
      agents={agents}
      stages={stages}
      finalScore={data.finalScore}
      topic={data.topic}
      dimensions={data.dimensionDetails}
      taskProgress={data.taskProgress}
      missionStatus={data.missionStatus}
      depth={data.depth}
      language={data.language}
      maxCredits={data.maxCredits}
      isResumable={data.isResumable}
      onRerun={onRerun}
      onUpdate={onUpdate}
      onCancel={onCancel}
      onLeaderClick={onLeaderClick}
      onResearchTeamClick={onResearchTeamClick}
      onCollapse={() => setLeftCollapsed(true)}
    />
  );

  // ── 折叠态左栏装饰（playground 特色：垂直 Team 文字 + running pulse）──
  const collapsedLeftView = (
    <div className="flex h-full flex-col items-center py-4">
      <button
        type="button"
        onClick={() => setLeftCollapsed(false)}
        className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        title="展开团队面板"
        aria-label="展开团队面板"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
      <div className="mt-4 flex flex-col items-center gap-2">
        {data.missionStatus === 'running' && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        )}
        <span
          className="text-xs uppercase tracking-wide text-gray-500"
          style={{ writingMode: 'vertical-rl' }}
        >
          Team
        </span>
      </div>
    </div>
  );

  // ── Header status pill ──
  const statusPill = <StatusPill view={data} />;

  const subtitle = (
    <>
      {data.depth && <span>{data.depth}</span>}
      {data.language && (
        <>
          <span>·</span>
          <span>{data.language}</span>
        </>
      )}
      {/* 仅在真有数据时显示，不渲染 "0 维度 · 0 引用" 假壳 */}
      {data.dimensions.length > 0 && (
        <>
          <span>·</span>
          <span>{data.dimensions.length} 维度</span>
        </>
      )}
      {data.references.length > 0 && (
        <>
          <span>·</span>
          <span>{data.references.length} 引用</span>
        </>
      )}
    </>
  );

  // ── topBanner：WS 失联 / 运行失败提示（playground 风格）──
  const topBanner = (() => {
    if (wsError) {
      return (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{wsError}</span>
        </div>
      );
    }
    if (connState === 'disconnected') {
      return (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>实时连接已断开，正在重连…</span>
        </div>
      );
    }
    if (connState === 'reconnecting') {
      return (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          <span>实时连接重连中…</span>
        </div>
      );
    }
    if (data.missionStatus === 'failed' && data.failedMessage) {
      return (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="line-clamp-1">{data.failedMessage}</span>
        </div>
      );
    }
    return null;
  })();

  // ── tabBarTrailing：精简版算力指标（CompactMeters）──
  const tabBarTrailing =
    cost.tokensUsed > 0 || cost.costUsd > 0 ? (
      <div className="flex items-center gap-2 text-[11px] text-gray-500">
        <span className="font-mono">{fmtTokensShort(cost.tokensUsed)} tok</span>
        {cost.costUsd > 0 && (
          <span className="font-mono text-amber-600">
            ${cost.costUsd.toFixed(3)}
          </span>
        )}
        {data.finalScore != null && (
          <span className="font-mono font-semibold text-emerald-600">
            {data.finalScore}/100
          </span>
        )}
      </div>
    ) : null;

  // selectedTodo（TodoDetailDrawer 用）
  const selectedTodo = selectedTaskKey
    ? todos.find((t) => t.id === selectedTaskKey)
    : undefined;

  // ── headerActions：只有 onSettings 提供时才渲染 cog 按钮（不提供 = 不渲染，诚实降级）──
  const headerActions = onSettings ? (
    <button
      type="button"
      onClick={onSettings}
      className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
      title="任务配置"
      aria-label="任务配置"
    >
      <Settings className="h-4 w-4" />
    </button>
  ) : null;

  return (
    <MissionDetailFrame<TabKey>
      onBack={() => onBack?.()}
      backTitle="返回 Mission 列表"
      brandGradient={MODULE_THEMES.ask.gradient}
      HeaderIcon={BrandIcon}
      title={
        <span title={typeof data.title === 'string' ? data.title : undefined}>
          {data.title}
        </span>
      }
      subtitle={subtitle}
      statusPill={statusPill}
      headerActions={headerActions}
      tabs={tabs}
      activeTab={safeActiveTab}
      onTabChange={(k) => setActiveTab(k as TabKey)}
      leftPanel={leftPanel}
      leftCollapsed={leftCollapsed}
      onLeftCollapseToggle={() => setLeftCollapsed((v) => !v)}
      leftCollapsedView={collapsedLeftView}
      topBanner={topBanner}
      tabBarTrailing={tabBarTrailing}
    >
      {/* TodoDetailDrawer：tasks tab 点击行展开详情（与 playground 一致）*/}
      <TodoDetailDrawer
        todo={selectedTodo}
        agents={agents}
        stages={stages}
        events={events}
        dimensionPipelines={dimensionPipelines}
        allTodos={todos}
        onClose={() => setSelectedTaskKey(null)}
        missionId={data.id}
        missionTerminal={missionTerminal}
      />

      <div className="px-6 py-5">
        {safeActiveTab === 'tasks' && (
          <MissionTodoBoard
            todos={todos}
            themeSummary={data.themeSummary}
            selectedKey={selectedTaskKey}
            onSelect={(id) => setSelectedTaskKey(id)}
            missionFailed={data.missionStatus === 'failed'}
            missionFailedMessage={data.failedMessage}
            missionCancelled={data.missionStatus === 'cancelled'}
            missionQualityFailed={data.statusDetail === 'quality-failed'}
            agents={agents}
            dimensionPipelines={dimensionPipelines}
            missionId={data.id}
            missionTerminal={missionTerminal}
          />
        )}

        {safeActiveTab === 'collab' &&
          (hasEvents ? (
            <MissionFlowView
              view={canonicalView ?? capabilityFakeView}
              events={events}
              todoLedger={todos}
            />
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
              暂无协作动态（本任务无实时事件流）
            </div>
          ))}

        {safeActiveTab === 'report' && (
          <div className="space-y-4">
            {reportArtifact ? (
              <ArtifactReader
                artifact={reportArtifact}
                missionId={data.id}
                defaultView="continuous"
                reconciliationReport={
                  data.reconciliationReport as Parameters<
                    typeof ArtifactReader
                  >[0]['reconciliationReport']
                }
                dimensionPipelines={
                  data.missionStatus === 'running'
                    ? dimensionPipelines
                    : new Map()
                }
              />
            ) : data.report ? (
              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <ArtifactMarkdown
                  markdown={data.report}
                  citations={[]}
                  figures={[]}
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
                暂无报告内容
              </div>
            )}
          </div>
        )}

        {safeActiveTab === 'references' && (
          <ReferencesPanel
            citations={richCitations}
            fallbackSources={fallbackSources}
          />
        )}

        {safeActiveTab === 'graph' &&
          (data.hasGraph ? (
            <MissionGraphTab
              missionId={data.id}
              basePath={data.graphBasePath}
            />
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-500 shadow-sm">
              暂无图谱数据
            </div>
          ))}

        {safeActiveTab === 'cost' && (
          <div className="space-y-4">
            {/* CapabilityMeters 始终渲染：company 无 canonical view 时用 capabilityFakeView 兜底 */}
            <CapabilityMeters
              view={canonicalView ?? capabilityFakeView}
              wallTimeMs={wallTimeMs}
              cost={cost}
              memory={memory}
            />
            <ComputeUsagePanel
              cost={cost}
              agents={agents}
              todos={todos}
              dimensionPipelines={dimensionPipelines}
            />
            <MemoryIndexPanel
              memory={memory}
              missionPhase={
                data.missionStatus === 'failed' ||
                data.missionStatus === 'cancelled'
                  ? 'aborted'
                  : data.missionStatus === 'completed'
                    ? 'completed-noindex'
                    : 'running'
              }
            />
          </div>
        )}
      </div>
    </MissionDetailFrame>
  );
}

export default DeepInsightMissionDetail;

// ── helpers ────────────────────────────────────────────────────────────

/** token 数紧凑格式（tabBarTrailing 用，不引入 formatters 以免循环）。 */
function fmtTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/**
 * Header 状态 pill（对齐 playground statusPill 的色彩语义）。
 * running=blue · completed=emerald · failed=red · cancelled=gray ·
 * quality-failed(statusDetail)=amber。
 */
function StatusPill({ view }: { view: DeepInsightMissionView }) {
  if (view.missionStatus === 'running') {
    return (
      <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
        <span className="text-sm font-medium text-blue-700">研究中</span>
      </div>
    );
  }
  if (view.missionStatus === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-gray-500" />
        <span className="text-sm font-medium text-gray-700">已取消</span>
      </div>
    );
  }
  if (view.missionStatus === 'failed') {
    return (
      <div className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-sm font-medium text-red-700">已失败</span>
      </div>
    );
  }
  if (view.statusDetail === 'quality-failed') {
    return (
      <div className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span
          className="text-sm font-medium text-amber-700"
          title="Leader 拒签，但报告仍可阅读"
        >
          质量未达标
        </span>
      </div>
    );
  }
  if (view.missionStatus === 'completed') {
    return (
      <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="text-sm font-medium text-emerald-700">已完成</span>
      </div>
    );
  }
  return null;
}

const STEP_STATUS_TO_TODO: Record<
  MissionStep['status'],
  MissionTodo['status']
> = {
  done: 'done',
  failed: 'failed',
  skipped: 'cancelled',
  running: 'in_progress',
};

/**
 * company 静态 steps → 最小 MissionTodo[]（无 live trace / narrativeLog）。
 * 供 MissionTodoBoard / ComputeUsagePanel 在 company 降级场景下渲染静态任务列表。
 * playground 侧 adapter 已直接携带富 todoBoard items（走 steps 投影），此 helper
 * 仅在 company 静态结果（无 todoBoard）下产生兜底。
 */
function buildTodosFromSteps(steps: MissionStep[]): MissionTodo[] {
  return steps.map((s, i) => ({
    id: `step-${i}`,
    origin: s.systemStageId ? 'system-stage' : 'leader-plan',
    createdBy: s.systemStageId ? 'system' : 'leader',
    createdAt: 0,
    reasonText: '',
    // systemStageId 锚定的步骤 scope=system，MissionFlowView 据 systemStageId 点亮 14-chip。
    scope: s.systemStageId ? 'system' : 'mission',
    title: s.label,
    assignee: { role: normalizeTodoRole(s.role) },
    status: STEP_STATUS_TO_TODO[s.status],
    artifacts: [],
    narrativeLog: [],
    dimensionRef: s.dimension,
    // W5：透传 systemStageId → MissionFlowView 的 systemTodoMap 据此点亮对应 chip。
    systemStageId: s.systemStageId,
  })) as unknown as MissionTodo[];
}

/** step.role 字符串 → MissionTodoAssignee.role（未知 → 'mission' 兜底）。 */
function normalizeTodoRole(role: string): MissionTodo['assignee']['role'] {
  const r = role.toLowerCase();
  if (r === 'leader') return 'leader';
  if (r === 'researcher') return 'researcher';
  if (r === 'analyst') return 'analyst';
  if (r === 'writer') return 'writer';
  if (r === 'reviewer') return 'reviewer';
  return 'mission';
}
