'use client';

/**
 * Mission Detail Page — 完全照搬 Topic Insights TopicResearchLayout 视觉结构
 *
 * Header: ← back · 🎯 gradient icon · title + meta · status pill + actions
 * Main: 360px collapsible left team + flex-1 right tabbed content
 * Tabs: Live Collab / Report / Verify / Sources / Cost & Memory / Raw Events
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast, confirm } from '@/stores';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Coins,
  Database,
  FileText,
  Gavel,
  Layers,
  ListChecks,
  Network,
  RefreshCw,
  X as XIcon,
} from 'lucide-react';
import { MissionDetailFrame } from '@/components/common/mission-detail';
import {
  CapabilityMeters,
  ComputeUsagePanel,
  LeaderChatModal,
  MemoryIndexPanel,
  MissionFlowView,
  MissionTodoBoard,
  ReferencesPanel,
  TeamMissionModal,
  TeamRosterPanel,
  TodoDetailDrawer,
} from '@/components/agent-playground';
import { MissionGraphTab } from '@/components/agent-playground/MissionGraphTab';
// W7 cutover: deriveTodoLedger 已删除，todoLedger 由 canonical missionView.todoBoard.items 直接消费。
import type { MissionTodo } from '@/lib/features/agent-playground/mission-todo.types';
import { cn } from '@/lib/utils/common';
import { KnowledgeBaseSelector } from '@/components/common/selectors';
// 注：tab 切换由 MissionDetailFrame 内部用 canonical <Tabs> 渲染；这里保留导入
// 是为了让 audit-ui-discipline R7 知道本页用的是 canonical Tab 体系（不是自写 strip）。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Tabs as _CanonicalTabsForAudit } from '@/components/ui/tabs';
import { ArtifactReader } from '@/components/agent-playground/artifact';
import { BudgetAndTimeLimitPanel } from '@/components/agent-playground/panels/BudgetAndTimeLimitPanel';
import { useBudgetTiers, pickTier } from '@/hooks/features/useBudgetTiers';
import {
  isReportArtifact,
  type ReportArtifact,
} from '@/lib/features/agent-playground/report-artifact.types';
// ★ B4-3 cutover：移除 ensureRenderableArtifact import (§B5-2 lint enforced)。
//   canonical view.reportArtifact 已由 backend ArtifactComposer (§B3-2) 完成
//   v1->v2 normalize；frontend 仅做空态 placeholder fallback。
import { setCitationClickCallback } from '@/components/common/citations/citationNavigation';
import {
  useAgentPlaygroundStream,
  type PlaygroundEvent,
} from '@/hooks/features/useAgentPlaygroundStream';
// ★ W8 cutover (B5-2): canonical mission truth 单轨；shim 文件已删除。
//   truth 唯一来源：useMissionDetailView；legacy DerivedView 形状适配走
//   useMissionLegacyView hook（显式命名 "Legacy" 标识为过渡 adapter，
//   component-level cutover 完成后即可退役）。
import { useMissionDetailView } from '@/hooks/features/useMissionDetailView';
import { useMissionLegacyView } from '@/hooks/features/useMissionLegacyView';
// DerivedView 仅作为 MissionSettingsModal / ComputeUsagePanel 等内嵌子组件的 prop type，
// 没有调用 derive truth 函数（已删除）。component-level cutover 完成后此 import 即可移除。
import type { DerivedView } from '@/lib/features/agent-playground/mission-presentation.types';

/**
 * ★ B4-3：buildEmptyArtifactPlaceholder —— 不带 v1→v2 normalize 的最小空态 placeholder。
 *
 * 与旧 ensureRenderableArtifact 的区别：本 helper 只构造 ReportArtifact schema-complete
 * 空骨架，**不消费任何 raw v1 字段**（v1→v2 normalize 已在 backend §B3-2 完成）。
 * §7.2 "local presentation-only fallbacks such as empty-state chrome" 允许此 UI-only 行为。
 */
function buildEmptyArtifactPlaceholder(
  title: string,
  emptyMessage: string
): ReportArtifact {
  const md = `# ${title}\n\n${emptyMessage}\n`;
  return {
    content: { fullMarkdown: md, fullReportSize: md.length },
    sections: [],
    citations: [],
    figures: [],
    factTable: [],
    metadata: {
      topic: title,
      // ★ Hydration safety: 用空字符串而非 new Date().toISOString()，避免
      //   SSR/CSR 渲染时戳不同导致 React #418；placeholder 不展示 generatedAt。
      generatedAt: '',
      generationTimeMs: 0,
      version: 1,
      isIncremental: false,
      dimensionCount: 0,
      sourceCount: 0,
      factCount: 0,
      figureCount: 0,
      wordCount: md.length,
      readingTimeMinutes: 1,
      styleProfile: 'executive',
      lengthProfile: 'standard',
      audienceProfile: 'domain-expert',
      language: 'zh-CN',
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
      modelTrail: [],
    },
    quality: {
      overall: 0,
      dimensions: {
        traceability: 0,
        factualConsistency: 0,
        novelty: 0,
        coverage: 0,
        redundancy: 0,
        formatCorrectness: 0,
        citationDensity: 0,
        styleConformance: 0,
        lengthAccuracy: 0,
        chapterBalance: 0,
      },
      hardGateViolations: [],
      warnings: [],
      qualityTrace: [],
    },
    quickView: {
      executiveSummary: {
        markdown: emptyMessage,
        wordCount: emptyMessage.length,
      },
      topHighlights: [],
      topTrends: [],
      keyRisks: [],
      topRecommendations: [],
      keyCitations: [],
      keyFigures: [],
      estimatedReadingTime: 1,
      whatYouWillLearn: [],
      riskMatrix: [],
      keyFindingsByDimension: [],
    },
  };
}
import {
  cancelMission,
  getReportVersion,
  listReportVersions,
  rerunMission,
  runTeam,
  type BudgetTier,
  type MissionDetail,
  type MissionDetailView,
  type ReportVersionListItem,
} from '@/services/agent-playground/api';
import type { ReportVersionMeta } from '@/components/agent-playground/artifact/ArtifactReader';
import { Modal } from '@/components/ui/dialogs/Modal';

type TabKey = 'tasks' | 'collab' | 'report' | 'references' | 'cost' | 'graph';

const TABS: { key: TabKey; label: string; Icon: typeof Activity }[] = [
  { key: 'tasks', label: '任务列表', Icon: ListChecks },
  { key: 'collab', label: '协作动态', Icon: Activity },
  { key: 'report', label: '输出报告', Icon: FileText },
  { key: 'references', label: '参考文献', Icon: Layers },
  { key: 'graph', label: '图谱分析', Icon: Network },
  { key: 'cost', label: '算力消耗', Icon: Coins },
];

// Mission brand icon — playground 沿用 Lucide ClipboardList（文档/任务感）
const PlaygroundBrandIcon = ClipboardList;

/**
 * Phase 4.1: Mission DAG nodeId → todoLedger todo.id 的映射。
 *   - research-dim 节点(s3-researcher-collect::dimId) → 'dim:{dimId}'
 *   - macro stage 节点 → 'system:{frontend SystemStageId}',注意后端 stepId 与前端
 *     SystemStageId 有几个名字不对齐(s3/s8/s9/s9b/s10),用 BACKEND_TO_FRONTEND_STEP 映射。
 * 找不到匹配返回 null(调用方决定是否打开抽屉)。
 */
const BACKEND_TO_FRONTEND_STEP: Record<string, string> = {
  's1-budget': 's1-budget',
  's2-leader-plan': 's2-leader-plan',
  's3-researcher-collect': 's3-researchers',
  's4-leader-assess': 's4-leader-assess',
  's5-reconciler': 's5-reconciler',
  's6-analyst': 's6-analyst',
  's7-writer-outline': 's7-writer-outline',
  's8-writer': 's8-writer-draft',
  's8b-quality-enhancement': 's8b-quality-enhancement',
  's9-critic': 's9-critic-l4',
  's9b-objective-eval': 's9b-objective-evaluation',
  's10-leader-foreword-signoff': 's10-leader-signoff',
  's11-persist': 's11-persist',
};
function dagNodeIdToTodoId(nodeId: string): string | null {
  if (nodeId.startsWith('s3-researcher-collect::')) {
    return `dim:${nodeId.slice('s3-researcher-collect::'.length)}`;
  }
  const fe = BACKEND_TO_FRONTEND_STEP[nodeId];
  return fe ? `system:${fe}` : null;
}

export default function MissionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const missionId = params?.missionId as string;
  const invalidId = !missionId || missionId === 'undefined';
  const { events, connState, error } = useAgentPlaygroundStream(
    invalidId ? null : missionId
  );

  // ★ Hydration safety (P3-a fix): useState 不在 initializer 用 Date.now()，
  //   否则 SSR 拿 server 时间，client hydration 拿 client 时间 → React #418 mismatch。
  //   初始 0，client effect 启动后立刻 setNow(Date.now())。
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // ★ W1 cutover (2026-05-26): page.tsx 不再调旧 getMissionDetail / listResumableMissions。
  // canonical missionView 已含 row + cost + verdicts + userProfile + reconciliationReport
  // 等全部字段；terminal-refetch 由 stream refreshHints 走 useMissionDetailView.refresh()。
  const {
    data: missionView,
    applyRefreshHints,
    refresh: refreshMissionView,
  } = useMissionDetailView(invalidId ? undefined : missionId, {
    // ★ 2026-05-29: WS 退化为 polling/disconnected 时 stream 事件不再带 refreshHints，
    //   canonical view 会停止 refetch。此时启用定时 refetch 兜底（hook 内部按
    //   mission 终态自停 + coalescing 去重）。
    shouldPoll: connState === 'polling' || connState === 'disconnected',
  });

  // persisted = MissionDetail-shape alias 从 canonical view 派生，保留 30+ usage 不变。
  // §6.4.1.a per-app 投影已在 backend 完成（rejected → quality-failed），此处仅形状映射。
  const persisted = useMemo<MissionDetail | null>(() => {
    if (!missionView) return null;
    const m = missionView.mission;
    return {
      id: missionId,
      topic: m.topic ?? '',
      depth: m.depth ?? '',
      language: m.language ?? '',
      maxCredits: m.maxCredits ?? null,
      status: m.status,
      // Hydration safety: empty string fallback 而非 new Date()，避免 SSR/CSR mismatch。
      //   missionView 加载后 m.startedAt 必有值（backend canonical view 投影保证），
      //   fallback 仅在罕见的 race window 命中。
      startedAt: m.startedAt ?? '',
      completedAt: m.finishedAt ?? null,
      themeSummary: m.themeSummary ?? null,
      dimensions: (m.dimensions ?? null) as MissionDetail['dimensions'],
      finalScore: m.finalScore ?? null,
      errorMessage: m.failureMessage ?? null,
      tokensUsed:
        missionView.cost?.tokensUsed != null
          ? Number(missionView.cost.tokensUsed)
          : 0,
      costUsd: missionView.cost?.costUsd ?? 0,
      trajectoryStored: missionView.cost?.trajectoryStored ?? null,
      verdicts: missionView.verdicts as MissionDetail['verdicts'],
      reportFull: null as unknown as MissionDetail['reportFull'],
      userProfile: m.userProfile,
      reconciliationReport: m.reconciliationReport,
    } as unknown as MissionDetail;
  }, [missionView, missionId]);

  // isResumable 取自 canonical view（backend ResumeRerunPolicyService 已决策）。
  const isResumable = missionView?.mission?.resumable ?? false;

  // ★ Terminal refetch: §6.7.3 refreshHints 后端已注入（socket-broadcast.adapter
  //   按 event.type suffix 派生 mission family hint），applyRefreshHints 会自动 refetch。
  //   保留三连拉（立即 + 800 + 2500）专门处理 S11 mission-persist 的 race condition：
  //   mission:completed 事件可能比 reportFull 写库早 800ms～2s 到达前端，单次 refetch
  //   可能拿到 reportFull=null。三连拉确保 race window 内能拿到最终态。
  const lastTerminalRef = useRef<string | null>(null);
  useEffect(() => {
    if (invalidId) return;
    const terminal = events.find((ev) =>
      [
        'playground.mission:completed',
        'playground.mission:failed',
        'playground.mission:cancelled',
        'playground.mission:rerun-completed',
        'playground.mission:rerun-failed',
        'playground.rerun:cascade-aborted',
        'playground.mission:postlude:completed',
      ].includes(ev.type)
    );
    if (!terminal) return;
    const sig = `${terminal.type}:${terminal.timestamp ?? ''}`;
    if (lastTerminalRef.current === sig) return;
    lastTerminalRef.current = sig;
    refreshMissionView();
    const t1 = setTimeout(refreshMissionView, 800);
    const t2 = setTimeout(refreshMissionView, 2500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [events, invalidId, refreshMissionView]);

  // ★ B4-3 桥接：把 stream 携带的 refreshHints 透传给 view fetcher（§6.7.3 multi-pod
  //   hint emission path）。stream 路径保持启用以满足 §6.7.2 immediacy 需求。
  useEffect(() => {
    const lastEvent = events[events.length - 1] as unknown as
      | { payload?: { refreshHints?: unknown[] } }
      | undefined;
    const hints = lastEvent?.payload?.refreshHints;
    if (Array.isArray(hints) && hints.length > 0) {
      applyRefreshHints(
        hints.filter(
          (h): h is { family: string; mode: string; id?: string } =>
            !!h && typeof h === 'object'
        ) as Parameters<typeof applyRefreshHints>[0]
      );
    }
  }, [events, applyRefreshHints]);

  const view = useMissionLegacyView(missionView, events);

  // ★ Bug fix: mission.startedAt 在 mission:started 事件没在 replay buffer 时
  //   会是 undefined（Railway recycle 后旧 mission 的常见情况）。优先用持久化 DB
  //   里的 started_at 兜底，避免顶部状态条永远显示 "研究中 · 0s"。
  const startedAtMs =
    view.mission.startedAt ??
    (persisted?.startedAt
      ? new Date(persisted.startedAt).getTime()
      : undefined);
  const finishedAt =
    view.mission.completedAt ??
    view.mission.failedAt ??
    view.mission.cancelledAt ??
    null;
  // now=0 在 SSR / 第一帧；guard 防显示负数 wallTime（1 帧后 effect 设真 now）
  const wallTimeMs =
    startedAtMs && now > 0 ? (finishedAt ?? now) - startedAtMs : 0;

  // 默认进入卡片始终落到任务列表（不自动跳转 report）
  const [activeTab, setActiveTab] = useState<TabKey>('tasks');

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [leaderChatOpen, setLeaderChatOpen] = useState(false);
  const [researchTeamOpen, setResearchTeamOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null);
  // 用户在左栏切换的"待生效"研究深度。点「开始」时若与原 mission depth
  // 不同 → 走 runTeam 用新 tier 起一个新 mission；相同 → 维持 rerunMission。
  const [pendingDepth, setPendingDepth] = useState<
    BudgetTier['depth'] | undefined
  >(undefined);
  useEffect(() => {
    setPendingDepth(view.mission.depth as BudgetTier['depth'] | undefined);
  }, [view.mission.depth]);
  // 后端 tier 表（runTeam 时按选中 depth 取预设 maxCredits/wallTimeMs 等）
  const { data: tierData } = useBudgetTiers();
  // ★ P1-UI-DISMISS-BANNER (2026-04-30): mission failed banner 支持手动关闭，
  //   按 missionId 分桶，避免不同 mission 共用同一个状态。
  const [dismissedFailedBanner, setDismissedFailedBanner] = useState<
    Record<string, boolean>
  >({});
  // 2026-05-09 (screenshot 47): WS 退化提示同样需要关闭按钮（之前一直挂在
  //   任务列表上方无法消除）。短期 dismiss 即可——下次 connState 再变非 live
  //   时（仍/又断）这个 key 会重置，让 banner 重新出现。
  const [dismissedWsBanner, setDismissedWsBanner] = useState<
    Record<string, boolean>
  >({});
  // connState 切回 live 时清掉 dismiss，让下次断开能再提示
  useEffect(() => {
    if (connState === 'live') {
      setDismissedWsBanner((prev) => {
        if (!prev[missionId]) return prev;
        const { [missionId]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      });
    }
  }, [connState, missionId]);

  const allSources = useMemo(() => {
    const set = new Set<string>();
    const r = view.finalReport;
    if (r?.sections) {
      for (const s of r.sections) {
        if (s.sources) for (const u of s.sources) set.add(u);
      }
    }
    if (r?.citations) for (const u of r.citations) set.add(u);
    return [...set];
  }, [view.finalReport]);

  // ★ 2026-05-06: 报告版本化 —— 拉版本列表（mission 终态后才拉），切换时拉指定版本 reportFull
  const [reportVersions, setReportVersions] = useState<
    ReportVersionListItem[] | null
  >(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [versionOverride, setVersionOverride] = useState<unknown | null>(null);
  const [versionSwitching, setVersionSwitching] = useState(false);

  useEffect(() => {
    if (invalidId) return;
    const status = persisted?.status;
    if (!status) return;
    const isTerminal =
      status === 'completed' ||
      status === 'quality-failed' ||
      status === 'failed' ||
      status === 'rejected' ||
      status === 'cancelled';
    if (!isTerminal) return;
    let cancelled = false;
    listReportVersions(missionId)
      .then((items) => {
        if (cancelled) return;
        setReportVersions(items);
        // 默认选最高版本（list 已 DESC 排序）
        const head = items[0]?.version;
        if (head != null) {
          setSelectedVersion((prev) => prev ?? head);
        }
      })
      .catch(() => {
        if (!cancelled) setReportVersions([]);
      });
    return () => {
      cancelled = true;
    };
    // dep 取 persisted?.status 而非 persisted 整体：版本列表只在 mission 首次
    // 进入 terminal 状态时拉一次。否则 /view 三连拉（race window）每次更新
    // persisted 引用 → 这个 effect 重跑 3 次 → /report-versions 多调 2 次。
  }, [missionId, invalidId, persisted?.status]);

  const handleSelectVersion = useCallback(
    async (version: number) => {
      if (version === selectedVersion) return;
      setVersionSwitching(true);
      try {
        const detail = await getReportVersion(missionId, version);
        setVersionOverride(detail.reportFull);
        setSelectedVersion(version);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('load report version failed', e);
      } finally {
        setVersionSwitching(false);
      }
    },
    [missionId, selectedVersion]
  );

  const reportVersionMeta: ReportVersionMeta[] | undefined = useMemo(() => {
    if (!reportVersions || reportVersions.length === 0) return undefined;
    return reportVersions.map((r) => ({
      version: r.version,
      versionLabel: r.versionLabel,
      triggerType: r.triggerType,
      generatedAt: r.generatedAt,
      finalScore: r.finalScore,
      leaderSigned: r.leaderSigned,
    }));
  }, [reportVersions]);

  // ★ 2026-04-30 (#50 修复图片一闪一闪): setNow 每 500ms 触发 page re-render，
  //   之前报告 tab IIFE 里 ensureRenderableArtifact / toolRecallEntries 每次都新建
  //   引用 → ArtifactReader → ContinuousReader → ArtifactMarkdown 整树重渲 →
  //   react-markdown 重新解析 → <img> 重新挂载导致闪烁。
  //   把这些计算挪到 useMemo，依赖具体内容字段（不包括 now / wallTimeMs），
  //   即使 setNow tick 也不会重算 artifact，markdown DOM 稳定不抖。
  // ★ B4-3 cutover (thinning plan §B4-3 / §3.4 single-track / §6.6 artifact semantics):
  //   reportArtifact truth source 优先级（descending）：
  //     1. versionOverride —— 用户切历史版本，来自 GET /report-versions/:version sibling 路由
  //     2. canonical view.reportArtifact —— B3-2 ArtifactComposer 已 normalize v1→v2
  //     3. persisted.reportFull —— GET /missions/:id sibling 路由，仅 v2 才直接渲染
  //     4. empty-state placeholder —— frontend allowed §7.2 "local presentation-only fallbacks"
  //
  //   旧 `ensureRenderableArtifact` 路径（前端 v1→v2 synthesize）已彻底移除（§B5-2 lint 阻止）。
  //   canonical view 的 reportArtifact 字段可能是 ReportArtifactV2 也可能是 EmptyArtifactSentinel；
  //   isReportArtifact type guard 同时识别这两种。
  const canonicalArtifact = missionView?.reportArtifact;
  const reportFullRef =
    versionOverride ?? persisted?.reportFull ?? view.finalReport;
  const reportArtifact = useMemo(() => {
    // 优先 versionOverride（用户主动切版本）
    if (
      versionOverride &&
      typeof versionOverride === 'object' &&
      isReportArtifact(versionOverride)
    ) {
      return versionOverride;
    }
    // canonical view artifact（v2，B3-2 normalize 后）
    if (
      canonicalArtifact &&
      typeof canonicalArtifact === 'object' &&
      isReportArtifact(canonicalArtifact)
    ) {
      return canonicalArtifact;
    }
    // sibling /missions/:id 兜底（mission row reportFull 已是 v2）
    if (
      reportFullRef &&
      typeof reportFullRef === 'object' &&
      isReportArtifact(reportFullRef)
    ) {
      return reportFullRef;
    }
    // empty-state placeholder（§7.2 presentation-only fallback；不调 ensureRenderableArtifact 函数式 synthesize）
    const emptyMessage = view.mission.failedAt
      ? `Mission 失败：${view.mission.failedMessage ?? '未知错误'}\n\n（请重新启动一个新 mission）`
      : view.mission.cancelledAt
        ? '已被用户取消\n\n（数据未持久化）'
        : view.mission.completedAt
          ? '报告生成中…\n\n（可能 S11 持久化未完成，稍后刷新页面）'
          : '报告生成中…\n\n（mission 仍在跑 S1-S10，写作完成后会显示草稿；mission 完成后会显示完整三视图）';
    const fallbackTitle = view.mission.topic ?? '研究报告';
    // 复用 backend canonical empty-state contract 替代前端 v1→v2 函数式 synthesize
    return buildEmptyArtifactPlaceholder(fallbackTitle, emptyMessage);
  }, [
    versionOverride,
    canonicalArtifact,
    reportFullRef,
    view.mission.failedAt,
    view.mission.cancelledAt,
    view.mission.completedAt,
    view.mission.failedMessage,
    view.mission.topic,
  ]);

  const reportDefaultView = useMemo(() => {
    const userProfile = (
      persisted as { userProfile?: { viewMode?: string } } | null
    )?.userProfile;
    return userProfile?.viewMode === 'chapter' ||
      userProfile?.viewMode === 'quick'
      ? userProfile.viewMode
      : ('continuous' as const);
  }, [persisted]);

  const reportReconciliationReport = useMemo(
    () =>
      (persisted as { reconciliationReport?: unknown } | null)
        ?.reconciliationReport,
    [persisted]
  );

  const reportToolRecallEntries = useMemo(() => {
    return events
      .filter((ev) => ev.type === 'playground.tools:recalled')
      .map((ev) => {
        const p = ev.payload as {
          agentId?: string;
          role?: string;
          recalledIds?: string[];
          categories?: string[];
          source?: string;
          preferIds?: string[];
        };
        return {
          agentId: p.agentId ?? '',
          role: p.role ?? '',
          recalledIds: p.recalledIds ?? [],
          categories: p.categories ?? [],
          source: p.source ?? 'spec',
          preferIds: p.preferIds ?? [],
        };
      })
      .slice(0, 12);
  }, [events]);

  // ★ 2026-05-29 fix: 运行态用权威 status 判定，绝不用 completedAt/finishedAt 时间戳。
  //   后者会在阶段完成时（如数据采集 done）就被 backend 设置，导致 mission 仍在跑时
  //   页头误显示"已完成" → 用户以为跑完、怕浪费钱而取消（实证致命 bug）。
  const isRunning =
    !view.mission.cancelledAt &&
    !view.mission.failedAt &&
    persisted?.status !== 'completed' &&
    persisted?.status !== 'quality-failed' &&
    persisted?.status !== 'failed' &&
    persisted?.status !== 'cancelled' &&
    persisted?.status !== 'rejected';

  // Cross-panel citation navigation：点报告中 [N] 角标 → 切到「参考文献」并定位
  useEffect(() => {
    setCitationClickCallback((evidenceId) => {
      setActiveTab('references');
      // 等 References tab 渲染完成（一帧）再滚动 / 高亮目标条目
      requestAnimationFrame(() => {
        const target =
          document.getElementById(`ref-${evidenceId}`) ??
          document.querySelector(`[data-cite-uuid="${evidenceId}"]`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('ring-2', 'ring-violet-400');
          setTimeout(() => {
            target.classList.remove('ring-2', 'ring-violet-400');
          }, 2000);
        }
      });
    });
    return () => setCitationClickCallback(null);
  }, []);

  // ★ P0-5 真切 (thinning plan §B4-3 + §3.4 single-track)：
  //   backend TodoBoardProjector 已 port ~95% deriveTodoLedger 行为
  //   （107 fixture-replay spec 锁定 9 类 fixture，覆盖 §6.8.1 + §6.8.1.b）。
  //   page 切回 canonical view truth source — backend missionView.todoBoard.items
  //   已含 narrativeLog / artifacts / assignee / retryPipelineKey 等完整字段。
  //
  //   未覆盖（drawer-derive 范畴，不直接进 todo board，UI 影响极小）：
  //   agent:lifecycle / action / observation / reflection / thought / error /
  //   validation-rejected — frontend useAgentPlaygroundStream 仍按 §6.7.2
  //   immediacy 路径展示。
  const todoLedger: MissionTodo[] = useMemo(() => {
    const board = missionView?.todoBoard as
      | {
          kind?: string;
          items?: Array<{
            id: string;
            parentId?: string;
            origin: string;
            createdBy: string;
            createdAt: number;
            reasonText: string;
            scope: string;
            title: string;
            assignee: {
              role: string;
              agentId?: string;
              dimensionName?: string;
            };
            status: string;
            startedAt?: number;
            endedAt?: number;
            artifacts: Array<{
              kind: string;
              label: string;
              value?: string | number;
            }>;
            narrativeLog: Array<{ ts: number; text: string; tone?: string }>;
            agentRefId?: string;
            dimensionRef?: string;
            systemStageId?: string;
            retryPipelineKey?: string;
          }>;
        }
      | undefined;
    const items = board?.items ?? [];
    // ★ Screenshot_80 修复 (2026-05-27 #110 续): mission 终态時, 个别
    //   todo.status 可能仍残留 'in_progress' / 'pending'（backend projector 漏扫
    //   或事件晚到），在前端 mapping 阶段做终态扫荡，单一源对齐三处。
    //
    // ★ Screenshot_102 修复 (2026-05-28): 只用 m.status 判断终态，
    //   不用 completedAt / finishedAt timestamp——这些字段可能在 mission 运行中
    //   就被设置（如阶段完成时），导致全部任务被误扫成"已完成"。
    const m = missionView?.mission;
    const missionTerminalSuccess = !!(
      m?.status === 'completed' || m?.status === 'quality-failed'
    );
    const missionTerminalFailure = !!(
      m?.status === 'failed' || m?.status === 'cancelled'
    );
    const missionTerminal = missionTerminalSuccess || missionTerminalFailure;
    const sweepStatus = (raw: MissionTodo['status']): MissionTodo['status'] => {
      if (!missionTerminal) return raw;
      if (raw === 'done' || raw === 'failed' || raw === 'cancelled') return raw;
      if (missionTerminalSuccess) return 'done';
      // ★ 2026-05-30：mission 被取消（含额度耗尽被判 cancelled）时，未抵达的 stage
      //   显示「已取消」（中性灰）而非「失败」（红），避免"额度没了也满屏红"的误导观感。
      //   真正 failed 的 mission 才把未结 stage 扫成红。
      return m?.status === 'cancelled'
        ? ('cancelled' as MissionTodo['status'])
        : ('failed' as MissionTodo['status']);
    };
    return items.map(
      (entry): MissionTodo => ({
        id: entry.id,
        parentId: entry.parentId,
        origin: entry.origin as MissionTodo['origin'],
        createdBy: entry.createdBy as MissionTodo['createdBy'],
        createdAt: entry.createdAt,
        reasonText: entry.reasonText,
        scope: entry.scope as MissionTodo['scope'],
        title: entry.title,
        assignee: entry.assignee as MissionTodo['assignee'],
        status: sweepStatus(entry.status as MissionTodo['status']),
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        artifacts: entry.artifacts as MissionTodo['artifacts'],
        narrativeLog: entry.narrativeLog as MissionTodo['narrativeLog'],
        agentRefId: entry.agentRefId,
        dimensionRef: entry.dimensionRef,
        systemStageId: entry.systemStageId as MissionTodo['systemStageId'],
        pipelineKey: entry.retryPipelineKey,
      })
    );
  }, [missionView]);
  const selectedTodo: MissionTodo | undefined = useMemo(
    () => todoLedger.find((t) => t.id === selectedTaskKey),
    [todoLedger, selectedTaskKey]
  );

  if (invalidId) {
    return (
      <div className="h-full overflow-auto bg-gray-50">
        <div className="mx-auto max-w-2xl px-8 py-16 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <h1 className="text-2xl font-bold text-gray-900">找不到该 Mission</h1>
          <button
            type="button"
            onClick={() => router.push('/agent-playground')}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-xl"
          >
            <RefreshCw className="h-4 w-4" />
            返回 Mission 列表
          </button>
        </div>
      </div>
    );
  }

  // ── Title & meta（canonical Frame 用，不用 useMemo —— 在 early return 后） ─
  const cleanedTopic = (() => {
    const raw = view.mission.topic ?? '';
    const cleaned = raw.split(/\n|\[Re-run focus\]/i)[0].trim();
    if (!cleaned) {
      const status = (view.mission as { status?: string }).status;
      return status === 'starting' ? '研究中…' : '未命名研究';
    }
    return cleaned;
  })();

  const metaRow = (
    <>
      {view.mission.depth && <span>{view.mission.depth}</span>}
      {view.mission.language && (
        <>
          <span>·</span>
          <span>{view.mission.language}</span>
        </>
      )}
      <span>·</span>
      <span className="font-mono text-[10px]">{missionId}</span>
    </>
  );

  // ── Status pill（canonical Frame 用） ─────────────────────────────
  const statusPill = (
    <>
      {isRunning ? (
        <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <span className="text-sm font-medium text-blue-700">
            研究中 · {Math.floor(wallTimeMs / 1000)}s
          </span>
        </div>
      ) : view.mission.cancelledAt ? (
        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-gray-500" />
          <span className="text-sm font-medium text-gray-700">已取消</span>
        </div>
      ) : view.mission.failedAt ? (
        <div className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-sm font-medium text-red-700">已失败</span>
        </div>
      ) : persisted?.status === 'quality-failed' ? (
        <div className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          <span
            className="text-sm font-medium text-amber-700"
            title="Leader 拒签，但报告仍可阅读"
          >
            质量未达标
          </span>
        </div>
      ) : persisted?.status === 'completed' ? (
        <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">已完成</span>
        </div>
      ) : null}
      {/* Connection state — small tertiary indicator */}
      {connState !== 'live' && connState !== 'connecting' && (
        <span
          title={`WebSocket: ${connState}`}
          className="inline-flex h-2 w-2 rounded-full bg-amber-400"
        />
      )}
    </>
  );

  // Header actions: settings 按钮
  const headerActions = (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
      title="Mission 设置"
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
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </button>
  );

  // 折叠态左栏装饰：running pulse + 垂直 "Team" 文字（playground 特色）
  const collapsedLeftView = (
    <div className="flex h-full flex-col items-center py-4">
      <button
        type="button"
        onClick={() => setLeftCollapsed(false)}
        className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        title="Expand team panel"
        aria-label="Expand team panel"
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
        {isRunning && (
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

  // Banner stack（WS 失联 + mission failed）— 之前内嵌 IIFE，现作为 Frame 的 topBanner slot
  const banners = (() => {
    const wsDismissed = !!dismissedWsBanner[missionId];
    const showWsError = !!(error && connState !== 'live') && !wsDismissed;
    const failedDismissed = !!dismissedFailedBanner[missionId];
    const showFailedBanner = !!view.mission.failedMessage && !failedDismissed;
    if (!showWsError && !showFailedBanner) return null;
    return (
      <div className="space-y-2 border-b border-gray-200 bg-white px-4 py-2">
        {showWsError && (
          <div className="relative flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 pr-8 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>WebSocket 不可用 · 已退化为 4s 轮询 /replay</p>
            <button
              type="button"
              aria-label="关闭"
              onClick={() =>
                setDismissedWsBanner((prev) => ({
                  ...prev,
                  [missionId]: true,
                }))
              }
              className="absolute right-1.5 top-1.5 rounded p-0.5 text-amber-700 hover:bg-amber-100"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {showFailedBanner &&
          (persisted?.status === 'quality-failed' ? (
            <div className="relative flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 pr-8 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  Leader 拒签 · 质量未达标但报告可阅读
                </p>
                <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-amber-900/90">
                  {view.mission.failedMessage}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('report')}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-300 hover:bg-amber-200"
                >
                  查看输出报告 →
                </button>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() =>
                  setDismissedFailedBanner((prev) => ({
                    ...prev,
                    [missionId]: true,
                  }))
                }
                className="absolute right-1.5 top-1.5 rounded p-0.5 text-amber-700 hover:bg-amber-100"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="relative flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 pr-8 text-xs text-red-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Mission 失败</p>
                <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-red-900/90">
                  {view.mission.failedMessage}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() =>
                  setDismissedFailedBanner((prev) => ({
                    ...prev,
                    [missionId]: true,
                  }))
                }
                className="absolute right-1.5 top-1.5 rounded p-0.5 text-red-700 hover:bg-red-100"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
      </div>
    );
  })();

  // ── 左 panel 内容 —— TeamRosterPanel feature 业务原样保留 ─────────
  const leftPanelContent = (
    <TeamRosterPanel
      agents={view.agents}
      stages={view.stages}
      finalScore={view.mission.finalScore}
      topic={view.mission.topic}
      dimensions={view.mission.dimensions}
      // ★ Screenshot_76 修复 (2026-05-27): 任务进度过滤规则必须与 MissionTodoBoard
      //   的 workTodos 一致 — 排除 chapter scope (聚合到 dim) + reconciler-gap origin。
      //   否则任务列表显"共 82 项"而进度条显"82/83",1 个隐藏 todo 让总数对不上。
      taskProgress={(() => {
        const visible = todoLedger.filter(
          (t) => t.scope !== 'chapter' && t.origin !== 'reconciler-gap'
        );
        return {
          completed: visible.filter((t) => t.status === 'done').length,
          total: visible.length,
        };
      })()}
      missionStatus={
        // ★ 取消按钮可用判定：只要不是终态（completed/failed/rejected/
        //   cancelled/quality-failed）就视为 running。这样初次加载 persisted
        //   还没回来 + 还没收到事件时也能取消（DB 已经创建了 running 行）。
        view.mission.cancelledAt || persisted?.status === 'cancelled'
          ? 'cancelled'
          : view.mission.failedAt ||
              persisted?.status === 'failed' ||
              persisted?.status === 'rejected'
            ? 'failed'
            : persisted?.status === 'completed' ||
                persisted?.status === 'quality-failed'
              ? 'completed'
              : 'running'
      }
      depth={
        view.mission.depth ?? (persisted as { depth?: string } | null)?.depth
      }
      language={
        view.mission.language ??
        (persisted as { language?: string } | null)?.language
      }
      maxCredits={
        view.mission.maxCredits ??
        (persisted as { maxCredits?: number } | null)?.maxCredits
      }
      onCollapse={() => setLeftCollapsed(true)}
      onLeaderClick={() => setLeaderChatOpen(true)}
      onResearchTeamClick={() => setResearchTeamOpen(true)}
      isResumable={isResumable}
      onRerun={() => {
        // "开始"按钮：
        //  - pendingDepth === 原 mission depth → fresh rerun（复用原 mission 配置）
        //  - pendingDepth 已被用户改动 → 以"原 mission topic/language/style 等
        //    全套 + 新 depth 的 tier 预设(maxCredits/wallTimeMs/dimensions)"
        //    通过 runTeam 起一个新 mission，让档位切换真实生效
        void (async () => {
          const sameDepth =
            !pendingDepth || pendingDepth === view.mission.depth;
          try {
            if (sameDepth) {
              const { missionId: newId } = await rerunMission(
                missionId,
                'fresh'
              );
              router.push(`/agent-playground/team/${newId}`);
              return;
            }
            // 取新 depth 对应 tier 预设；同时把 userProfile 里的其它字段
            // (lengthProfile/styleProfile/... 等) 一并继承
            const tier = pickTier(tierData, pendingDepth);
            const up =
              (persisted as { userProfile?: Record<string, unknown> } | null)
                ?.userProfile ?? {};
            const { missionId: newId } = await runTeam({
              topic: view.mission.topic ?? '',
              depth: pendingDepth,
              language: (view.mission.language as 'zh-CN' | 'en-US') ?? 'zh-CN',
              lengthProfile:
                (up.lengthProfile as
                  | 'brief'
                  | 'standard'
                  | 'deep'
                  | 'extended'
                  | 'epic'
                  | 'mega') ?? 'standard',
              styleProfile:
                (up.styleProfile as
                  | 'academic'
                  | 'executive'
                  | 'journalistic'
                  | 'technical') ?? 'executive',
              audienceProfile:
                (up.audienceProfile as
                  | 'executive'
                  | 'domain-expert'
                  | 'general-public') ?? 'domain-expert',
              auditLayers:
                (up.auditLayers as
                  | 'minimal'
                  | 'default'
                  | 'thorough'
                  | 'thorough+') ?? 'default',
              withFigures: (up.withFigures as boolean) ?? true,
              concurrency: (up.concurrency as number) ?? 3,
              searchTimeRange:
                (up.searchTimeRange as
                  | '30d'
                  | '90d'
                  | '180d'
                  | '365d'
                  | '730d'
                  | 'all') ?? '365d',
              // tier 预设优先于 mission 原值（用户切档位的核心目的）
              maxCredits: tier?.maxCredits ?? view.mission.maxCredits ?? 2000,
              budgetMultiplierOverride:
                tier?.budgetMultiplier ??
                (up.budgetMultiplierOverride as number) ??
                1.0,
              wallTimeCapMs: (tier?.wallTimeMinutes ?? 60) * 60_000,
              knowledgeBaseIds: Array.isArray(up.knowledgeBaseIds)
                ? (up.knowledgeBaseIds as string[])
                : undefined,
            });
            router.push(`/agent-playground/team/${newId}`);
          } catch (e) {
            toast.error('启动失败', e instanceof Error ? e.message : String(e));
          }
        })();
      }}
      onDepthChange={setPendingDepth}
      onUpdate={() => {
        // "更新"按钮 = incremental：clone checkpoint，跳过已完成 stage
        // 对齐 Topic Insight handleContinueResearch
        //   ('incremental' 模式：保留已完成任务，只跑未完成的维度)
        // 复用原 mission 全部 input 字段（不只 topic/depth/language 3 个）
        void (async () => {
          try {
            const { missionId: newId } = await rerunMission(
              missionId,
              'incremental'
            );
            router.push(`/agent-playground/team/${newId}`);
          } catch (e) {
            toast.error('更新失败', e instanceof Error ? e.message : String(e));
          }
        })();
      }}
      onCancel={() => {
        void (async () => {
          const ok = await confirm({
            title: '确认取消该 mission？',
            type: 'danger',
          });
          if (!ok) return;
          try {
            await cancelMission(missionId);
            window.location.reload();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // 通用 race：mission 已经在请求送达前完成 / 失败
            if (/not running|status is/i.test(msg) || /400/i.test(msg)) {
              toast.info(
                'Mission 已结束',
                'Mission 已经结束（或刚刚完成 / 失败），无需取消。页面将刷新展示最新状态。'
              );
              window.location.reload();
            } else {
              toast.error('取消失败', msg);
            }
          }
        })();
      }}
    />
  );

  // ── Tab bar trailing slot：CompactMeters（紧凑指标条） ─────────────
  // ★ Screenshot_58 修复：cost / maxCredits 从 DerivedView + persisted top-level 取，
  //   早先 maxCredits 路径错（userProfile.maxCredits 通常空 → 0% 假象）+ tokens 从
  //   canonical 取常 stale（"0% 0.0 1.0%" 怪显示）。对齐 CapabilityMeters。
  const tabBarTrailing = missionView ? (
    <CompactMeters
      view={missionView}
      wallTimeMs={wallTimeMs}
      cost={view.cost}
      maxCredits={persisted?.maxCredits ?? null}
    />
  ) : null;

  return (
    <>
      <MissionDetailFrame<TabKey>
        onBack={() => router.push('/agent-playground')}
        backTitle="返回 Mission 列表"
        brandGradient="from-violet-500 to-purple-600"
        HeaderIcon={PlaygroundBrandIcon}
        title={
          <span title={view.mission.topic ?? '研究中…'}>{cleanedTopic}</span>
        }
        subtitle={metaRow}
        statusPill={statusPill}
        headerActions={headerActions}
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(k) => setActiveTab(k as TabKey)}
        leftPanel={leftPanelContent}
        leftCollapsed={leftCollapsed}
        onLeftCollapseToggle={() => setLeftCollapsed((v) => !v)}
        leftCollapsedView={collapsedLeftView}
        topBanner={banners}
        tabBarTrailing={tabBarTrailing}
      >
        {/* Tab body —— feature 业务全部保留 */}
        <div className="px-6 py-5">
          {activeTab === 'tasks' && (
            <MissionTodoBoard
              todos={todoLedger}
              themeSummary={view.mission.themeSummary}
              selectedKey={selectedTaskKey}
              onSelect={(id) => setSelectedTaskKey(id)}
              missionFailed={!!view.mission.failedAt}
              missionFailedMessage={view.mission.failedMessage}
              missionCancelled={!!view.mission.cancelledAt}
              missionQualityFailed={persisted?.status === 'quality-failed'}
              agents={view.agents}
              dimensionPipelines={view.dimensionPipelines}
              missionId={missionId}
              missionTerminal={!isRunning}
            />
          )}

          {activeTab === 'collab' && missionView && (
            <MissionFlowView
              view={missionView}
              events={events}
              todoLedger={todoLedger}
            />
          )}

          {activeTab === 'report' && (
            <div className="space-y-4">
              {/* ★ 2026-04-30 (#51 报告极简化)：
                    主区只渲染纯报告（ArtifactReader 含视图切换 + 修订 banner + 正文）
                    LeadJournalPanel / VerifyConsensusPanel / 质量分数 / 元信息 /
                    事实表 / 对账 / 工具召回 全部移到 ArtifactReader 内部右侧 slide-over，
                    点击"报告分析"按钮打开。 */}
              <ArtifactReader
                artifact={reportArtifact}
                missionId={missionId}
                defaultView={reportDefaultView}
                reconciliationReport={
                  reportReconciliationReport as Parameters<
                    typeof ArtifactReader
                  >[0]['reconciliationReport']
                }
                toolRecallEntries={reportToolRecallEntries}
                dimensionPipelines={
                  // mission terminal 后不再传 live chapter pipeline，避免
                  // backend extractor 没把 chapter 状态收到 done 导致 banner
                  // 显示 "Revising N chapters" 的回归。
                  isRunning ? view.dimensionPipelines : new Map()
                }
                reportVersions={reportVersionMeta}
                currentVersion={selectedVersion ?? undefined}
                onSelectVersion={(v) => void handleSelectVersion(v)}
                versionSwitching={versionSwitching}
              />
            </div>
          )}

          {activeTab === 'references' &&
            (() => {
              // 优先取 canonical missionView.reportArtifact (ReportArtifactV2 with rich citations);
              // 不是 sentinel 时直接吃。否则 fallback 到 view.finalReport.citations (string list)。
              const canonicalArtifact = missionView?.reportArtifact;
              const canonicalIsRich =
                canonicalArtifact &&
                typeof canonicalArtifact === 'object' &&
                (canonicalArtifact as { kind?: string }).kind !==
                  'empty-artifact' &&
                Array.isArray(
                  (canonicalArtifact as { citations?: unknown }).citations
                );
              const richCitations = canonicalIsRich
                ? ((canonicalArtifact as { citations: unknown[] })
                    .citations as Parameters<
                    typeof ReferencesPanel
                  >[0]['citations'])
                : undefined;
              return (
                <ReferencesPanel
                  citations={richCitations}
                  fallbackSources={allSources}
                />
              );
            })()}

          {activeTab === 'graph' && <MissionGraphTab missionId={missionId} />}

          {activeTab === 'cost' && (
            <div className="space-y-4">
              {missionView && (
                <CapabilityMeters
                  view={missionView}
                  wallTimeMs={wallTimeMs}
                  cost={view.cost}
                  memory={view.memory}
                />
              )}
              <ComputeUsagePanel
                cost={view.cost}
                agents={view.agents}
                todos={todoLedger}
                dimensionPipelines={view.dimensionPipelines}
              />
              <MemoryIndexPanel
                memory={view.memory}
                missionPhase={(() => {
                  const aborted =
                    persisted?.status === 'failed' ||
                    persisted?.status === 'rejected' ||
                    persisted?.status === 'cancelled' ||
                    !!view.mission.cancelledAt ||
                    !!view.mission.failedAt;
                  const succeeded =
                    persisted?.status === 'completed' ||
                    persisted?.status === 'quality-failed' ||
                    !!view.mission.completedAt;
                  if (aborted) return 'aborted';
                  if (succeeded) return 'completed-noindex';
                  return 'running';
                })()}
              />
              <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold text-gray-900">
                    Trajectory 与向量记忆
                  </h3>
                </div>
                <p className="text-xs text-gray-600">
                  Mission 完成后，Writer envelope +
                  事件流会自动向量化进入用户记忆 namespace，未来同类 mission
                  可语义召回这些 chunks。
                </p>
              </div>
            </div>
          )}
        </div>
      </MissionDetailFrame>

      {/* Floating Leader chat modal — triggered by clicking Leader node */}
      <LeaderChatModal
        missionId={missionId}
        topic={view.mission.topic}
        open={leaderChatOpen}
        onClose={() => setLeaderChatOpen(false)}
        onDimensionsAppended={() => {
          // CREATE_TODO 成功 → 刷新 canonical view 把新 dimensions 拉进来。
          refreshMissionView();
        }}
      />

      {/* Mission DAG modal —— 2026-05-26 重构:完整自上而下执行图(后端 /dag 驱动)
          Phase 2:传 events.length 作 liveSignal,WS 增量事件 → 节流 1s 重拉 /dag
          Phase 4.1:节点点击 → 映射 DAG nodeId 到 todoLedger 里的 todo id → 打开
          已有 TodoDetailDrawer。research-dim 节点直接 dim:{id};macro stage 需要
          后端 stepId → 前端 SystemStageId 的小映射(几个名字不一致)。 */}
      <TeamMissionModal
        open={researchTeamOpen}
        onClose={() => setResearchTeamOpen(false)}
        missionId={missionId}
        liveSignal={events.length}
        onAgentClick={(nodeId) => {
          const todoId = dagNodeIdToTodoId(nodeId);
          setResearchTeamOpen(false);
          if (todoId) setSelectedTaskKey(todoId);
        }}
      />

      {/* Todo detail drawer (新版：narrativeLog 时间线 + 4 层架构面包屑 + chapter pipeline) */}
      <TodoDetailDrawer
        todo={selectedTodo}
        agents={view.agents}
        dimensionPipelines={view.dimensionPipelines}
        allTodos={todoLedger}
        stages={missionView?.stages}
        events={events}
        onClose={() => setSelectedTaskKey(null)}
        missionId={missionId}
        missionTerminal={!isRunning}
      />

      {/* Settings modal */}
      <MissionSettingsModal
        missionId={missionId}
        mission={view.mission}
        wallTimeMs={wallTimeMs}
        cost={view.cost}
        userProfile={
          (persisted as { userProfile?: Record<string, unknown> } | null)
            ?.userProfile ?? null
        }
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          // 2026-05-13 #66 / W1 cutover: 保存后刷新 canonical view，弹窗下次打开读到新值。
          refreshMissionView();
        }}
      />
    </>
  );
}

function MissionSettingsModal({
  missionId,
  mission,
  wallTimeMs,
  cost,
  userProfile,
  open,
  onClose,
  onSaved,
}: {
  missionId: string;
  mission: DerivedView['mission'];
  wallTimeMs: number;
  cost: DerivedView['cost'];
  userProfile: Record<string, unknown> | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
}) {
  // ★ 2026-04-30 (#52): 可编辑表单 —— 改完点"另存为新 mission"用新配置创建新 mission，
  //   原 mission 保留作对比。topic / language / depth / lengthProfile / styleProfile /
  //   audienceProfile / withFigures / auditLayers / concurrency / knowledgeBaseIds 全可改。
  type Depth = 'quick' | 'standard' | 'deep';
  type Lang = 'zh-CN' | 'en-US';
  type LP = 'brief' | 'standard' | 'deep' | 'extended' | 'epic' | 'mega';
  type SP = 'academic' | 'executive' | 'journalistic' | 'technical';
  type AP = 'executive' | 'domain-expert' | 'general-public';
  type AL = 'minimal' | 'default' | 'thorough' | 'thorough+';
  type STR = '30d' | '90d' | '180d' | '365d' | '730d' | 'all';

  const router = useRouter();
  // ★ 2026-05-22 ③J/K 单一源：档位数值来自后端，前端无镜像。
  const { data: budgetTierData } = useBudgetTiers();
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [depth, setDepth] = useState<Depth>('deep');
  const [language, setLanguage] = useState<Lang>('zh-CN');
  const [lengthProfile, setLengthProfile] = useState<LP>('standard');
  const [styleProfile, setStyleProfile] = useState<SP>('executive');
  const [audienceProfile, setAudienceProfile] = useState<AP>('domain-expert');
  const [auditLayers, setAuditLayers] = useState<AL>('default');
  const [withFigures, setWithFigures] = useState(true);
  const [concurrency, setConcurrency] = useState(3);
  const [searchTimeRange, setSearchTimeRange] = useState<STR>('365d');
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [maxCredits, setMaxCredits] = useState<number>(2000);
  const [budgetMultiplierOverride, setBudgetMultiplierOverride] =
    useState<number>(1.0);
  const [wallTimeMinutes, setWallTimeMinutes] = useState<number>(60);
  // ★ 2026-05-22 #25：精简设置弹窗——3 滑块"精细预算"默认折叠（档位卡片即够用），
  //   点开才显，避免"配置太复杂"。折叠不改保存逻辑（值照常随保存提交）。
  const [showAdvancedBudget, setShowAdvancedBudget] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 打开时初始化表单值（来自 mission + userProfile 快照）
  useEffect(() => {
    if (!open) return;
    setTopic(mission.topic ?? '');
    setDescription((userProfile?.description as string) ?? '');
    setDepth((mission.depth as Depth) ?? 'deep');
    setLanguage((mission.language as Lang) ?? 'zh-CN');
    setLengthProfile((userProfile?.lengthProfile as LP) ?? 'standard');
    setStyleProfile((userProfile?.styleProfile as SP) ?? 'executive');
    setAudienceProfile((userProfile?.audienceProfile as AP) ?? 'domain-expert');
    setAuditLayers((userProfile?.auditLayers as AL) ?? 'default');
    setWithFigures((userProfile?.withFigures as boolean) ?? true);
    setConcurrency((userProfile?.concurrency as number) ?? 3);
    setSearchTimeRange((userProfile?.searchTimeRange as STR) ?? '365d');
    const kbIds = userProfile?.knowledgeBaseIds as string[] | undefined;
    setKnowledgeBaseIds(Array.isArray(kbIds) ? kbIds : []);
    // 2026-05-13 #66 (修 c046213bd 半成品):
    //   - maxCredits 读 row 字段（runtime-shell 写入 row.maxCredits 是 cap）
    //   - wallTimeCapMs 读 userProfile JSON（runtime-shell 写到 userProfile.wallTimeCapMs，
    //     row.wallTimeMs 是 markCompleted 时记的执行时长，不是 cap，不能用！）
    //   - budgetMultiplierOverride 仍只在 userProfile JSON（无 row 字段）。
    const rowMax = (mission as { maxCredits?: number }).maxCredits;
    const profMax = (userProfile as { maxCredits?: number })?.maxCredits;
    setMaxCredits(rowMax ?? profMax ?? 2000);
    setBudgetMultiplierOverride(
      ((userProfile as { budgetMultiplierOverride?: number })
        ?.budgetMultiplierOverride as number) ?? 1.0
    );
    const profWall = (userProfile as { wallTimeCapMs?: number })?.wallTimeCapMs;
    setWallTimeMinutes(
      profWall && profWall > 0 ? Math.round(profWall / 60_000) : 60
    );
    setSaveError(null);
  }, [open, mission.topic, mission.depth, mission.language, userProfile]);

  if (!open) return null;

  const handleSaveAsNew = async () => {
    if (!topic.trim()) {
      setSaveError('主题不能为空');
      return;
    }
    setSaving(true);
    setSaveError(null);
    if (maxCredits < 10 || maxCredits > 100_000) {
      setSaveError('maxCredits 必须在 10 - 100000 之间');
      setSaving(false);
      return;
    }
    if (budgetMultiplierOverride < 0.3 || budgetMultiplierOverride > 10) {
      setSaveError('agent 倍率必须在 0.3 - 10 之间');
      setSaving(false);
      return;
    }
    if (wallTimeMinutes < 1 || wallTimeMinutes > 180) {
      setSaveError('时长上限必须在 1 - 180 分钟之间');
      setSaving(false);
      return;
    }
    try {
      const { runTeam } = await import('@/services/agent-playground/api');
      const { missionId: newId } = await runTeam({
        topic: topic.trim(),
        description: description.trim() || undefined,
        depth,
        language,
        lengthProfile,
        styleProfile,
        audienceProfile,
        auditLayers,
        withFigures,
        concurrency,
        searchTimeRange,
        maxCredits,
        budgetMultiplierOverride,
        wallTimeCapMs: wallTimeMinutes * 60_000,
        knowledgeBaseIds:
          knowledgeBaseIds.length > 0 ? knowledgeBaseIds : undefined,
      });
      router.push(`/agent-playground/team/${newId}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  // 2026-05-13: 非运行状态下保存修改（写回原 mission，下次重跑生效）。
  const isTerminal = !['running', 'queued', 'pending'].includes(
    (mission as { status?: string }).status ?? ''
  );
  const handleSaveInPlace = async () => {
    if (maxCredits < 10 || maxCredits > 100_000) {
      setSaveError('maxCredits 必须在 10 - 100000 之间');
      return;
    }
    if (budgetMultiplierOverride < 0.3 || budgetMultiplierOverride > 10) {
      setSaveError('agent 倍率必须在 0.3 - 10 之间');
      return;
    }
    if (wallTimeMinutes < 1 || wallTimeMinutes > 180) {
      setSaveError('时长上限必须在 1 - 180 分钟之间');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { updateMission } = await import('@/services/agent-playground/api');
      await updateMission(missionId, {
        maxCredits,
        budgetMultiplierOverride,
        wallTimeCapMs: wallTimeMinutes * 60_000,
      });
      // 2026-05-13 #66: trigger parent refetch so next open sees new values
      if (onSaved) await onSaved();
      setSaving(false);
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const settingsTitle = (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-600">
        Mission Settings
      </p>
      <h3 className="mt-1 text-lg font-semibold text-slate-950">
        Mission 设置
      </h3>
    </div>
  );

  const settingsFooter = (
    <div className="flex w-full justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={saving}
        className="rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-100 disabled:opacity-50"
      >
        关闭
      </button>
      {/* 2026-05-13: 非运行状态显示「保存修改」，写回原 mission，下次重跑生效 */}
      {isTerminal && (
        <button
          type="button"
          onClick={() => void handleSaveInPlace()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          title="把预算配置写回当前 mission，下次「重跑」会用新值"
        >
          {saving ? '保存中…' : '保存修改'}
        </button>
      )}
      <button
        type="button"
        onClick={() => void handleSaveAsNew()}
        disabled={saving || !topic.trim()}
        className="inline-flex items-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', saving && 'animate-spin')} />
        {saving ? '创建中…' : '另存为新 mission'}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={settingsTitle}
      size="xl"
      className="rounded-[28px] border border-slate-200 shadow-[0_30px_100px_-40px_rgba(15,23,42,0.45)]"
      contentClassName="px-5 py-5 text-sm"
      footerClassName="bg-slate-50/70"
      footer={settingsFooter}
    >
      <div className="space-y-3">
        {/* Compact stats row */}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 px-3 py-2">
          <div className="text-[11px]">
            <span className="text-slate-500">耗时</span>
            <span className="font-mono ml-2 font-semibold text-slate-900">
              {Math.floor(wallTimeMs / 1000)}s
            </span>
          </div>
          <div className="text-[11px]">
            <span className="text-slate-500">累计 token</span>
            <span className="font-mono ml-2 font-semibold text-slate-900">
              {(() => {
                const inheritedMax = (
                  userProfile as { maxCredits?: number } | null
                )?.maxCredits;
                const used =
                  cost.tokensUsed >= 1000
                    ? `${(cost.tokensUsed / 1000).toFixed(1)}k`
                    : String(cost.tokensUsed);
                if (inheritedMax) {
                  const capTokens = inheritedMax * 1000;
                  const ratio = Math.min(
                    100,
                    Math.round((cost.tokensUsed / capTokens) * 100)
                  );
                  const capLabel =
                    capTokens >= 1_000_000
                      ? `${(capTokens / 1_000_000).toFixed(1)}M`
                      : `${(capTokens / 1000).toFixed(0)}k`;
                  return `${used} / ${capLabel} · ${ratio}%`;
                }
                return used;
              })()}
            </span>
          </div>
        </div>

        {/* ── 内容定义 (主题 + 语言 + 深度) ─────────────────── */}
        <SettingsGroup title="内容定义">
          <FormField label="主题（必填）">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="例：系统洞察一下 Anthropic Managed Agent"
            />
          </FormField>
          <FormField label="研究描述（选填，背景 / 约束 / 关注角度 / 排除项）">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={10000}
              rows={4}
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              placeholder="补充你的研究意图：背景、必须覆盖的角度、约束条件、要排除的内容等。Leader 拆维度 + Researcher 搜证都会遵循。"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="语言">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Lang)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </FormField>
            <FormField label="深度">
              <select
                value={depth}
                onChange={(e) => {
                  // 改深度即联动预算到对应档位（来自后端单一源），避免 depth 与预算脱节。
                  const d = e.target.value as Depth;
                  setDepth(d);
                  const tier = pickTier(budgetTierData, d);
                  if (tier) {
                    setMaxCredits(tier.maxCredits);
                    setBudgetMultiplierOverride(tier.budgetMultiplier);
                    setWallTimeMinutes(tier.wallTimeMinutes);
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              >
                <option value="quick">quick · 快速</option>
                <option value="standard">standard · 标准</option>
                <option value="deep">deep · 深度</option>
              </select>
            </FormField>
          </div>
        </SettingsGroup>

        {/* ── 搜索 + 输出 ───────────────────────────────────── */}
        <SettingsGroup title="搜索 / 输出">
          <div className="grid grid-cols-2 gap-2">
            <FormField label="搜索时效">
              <select
                value={searchTimeRange}
                onChange={(e) => setSearchTimeRange(e.target.value as STR)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              >
                <option value="30d">1 个月</option>
                <option value="90d">3 个月</option>
                <option value="180d">6 个月</option>
                <option value="365d">12 个月</option>
                <option value="730d">24 个月</option>
                <option value="all">不限</option>
              </select>
            </FormField>
            <FormField label="长度档位">
              <select
                value={lengthProfile}
                onChange={(e) => setLengthProfile(e.target.value as LP)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              >
                <option value="brief">brief · 3K</option>
                <option value="standard">standard · 8K</option>
                <option value="deep">deep · 15K</option>
                <option value="extended">extended · 25K</option>
                <option value="epic">epic · 80K</option>
                <option value="mega">mega · 200K</option>
              </select>
            </FormField>
            <FormField label="受众">
              <select
                value={audienceProfile}
                onChange={(e) => setAudienceProfile(e.target.value as AP)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              >
                <option value="executive">executive · 高管</option>
                <option value="domain-expert">domain-expert · 专家</option>
                <option value="general-public">general-public · 大众</option>
              </select>
            </FormField>
            <FormField label="文风">
              <select
                value={styleProfile}
                onChange={(e) => setStyleProfile(e.target.value as SP)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              >
                <option value="executive">executive · 管理</option>
                <option value="academic">academic · 学术</option>
                <option value="journalistic">journalistic · 新闻</option>
                <option value="technical">technical · 技术</option>
              </select>
            </FormField>
          </div>
        </SettingsGroup>

        {/* ── 审核 + 并行 + 图文 ─────────────────────────────── */}
        <SettingsGroup title="审核 / 执行">
          <div className="grid grid-cols-3 gap-2">
            <FormField label="审核层">
              <select
                value={auditLayers}
                onChange={(e) => setAuditLayers(e.target.value as AL)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              >
                <option value="minimal">minimal</option>
                <option value="default">default</option>
                <option value="thorough">thorough</option>
                <option value="thorough+">thorough+</option>
              </select>
            </FormField>
            <FormField label="并行数">
              <input
                type="number"
                min={1}
                max={6}
                value={concurrency}
                onChange={(e) =>
                  setConcurrency(Math.max(1, Math.min(6, +e.target.value)))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-900"
              />
            </FormField>
            <FormField label="图文并茂">
              <label className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900">
                <input
                  type="checkbox"
                  checked={withFigures}
                  onChange={(e) => setWithFigures(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span>启用</span>
              </label>
            </FormField>
          </div>
        </SettingsGroup>

        {/* ── 知识库 ─────────────────────────────────────────── */}
        <SettingsGroup title="知识库（最多 10 个 · 留空走 web-search）">
          <KnowledgeBaseSelector
            selectedIds={knowledgeBaseIds}
            onSelectionChange={setKnowledgeBaseIds}
            maxSelections={10}
          />
        </SettingsGroup>

        {(() => {
          const m = mission as {
            status?: string;
            errorMessage?: string | null;
          };
          // ★ 2026-05-30：失败原因横幅此前只在 status==='failed' 渲染，导致 cancelled /
          //   quality-failed 终态（含"额度耗尽被判 cancelled"）完全不显示原因。改为所有
          //   非成功终态都展示，让用户看得到"为什么停了"。
          const isFailish =
            m.status === 'failed' ||
            m.status === 'cancelled' ||
            m.status === 'quality-failed';
          if (!isFailish || !m.errorMessage) return null;
          return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-relaxed text-amber-900">
              <p className="font-semibold">上次未成功原因</p>
              <p className="mt-0.5">{m.errorMessage}</p>
              <p className="mt-1 text-amber-700">
                如为预算 / 密钥额度耗尽，请充值对应
                Provider，或提高下方「调研规模」档位 / 自定义 Credits
                上限后重跑（修改后保存即生效）。
              </p>
            </div>
          );
        })()}

        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            调研规模（一键套用档位预算 · 修改后保存即在重跑生效）
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(['quick', 'standard', 'deep'] as const).map((t) => {
              const tier = pickTier(budgetTierData, t);
              const active =
                !!tier &&
                maxCredits === tier.maxCredits &&
                wallTimeMinutes === tier.wallTimeMinutes &&
                budgetMultiplierOverride === tier.budgetMultiplier;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!tier}
                  onClick={() => {
                    // 档位卡片 = 同时设深度 + 预算（来自后端单一源），与「深度」下拉一致。
                    if (!tier) return;
                    setDepth(t);
                    setMaxCredits(tier.maxCredits);
                    setBudgetMultiplierOverride(tier.budgetMultiplier);
                    setWallTimeMinutes(tier.wallTimeMinutes);
                  }}
                  className={`rounded-xl border px-3 py-2 text-left transition-all ${
                    active
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <span className="block text-sm font-medium text-slate-900">
                    {tier?.label ?? t}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {tier
                      ? `约 $${tier.capUsd} · ~${tier.wallTimeMinutes} 分钟`
                      : '加载中…'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ★ 2026-05-22 #25：精细预算（3 滑块）默认折叠，点开才显——档位卡片即够用，
            避免"设置太复杂"。当前值在收起态用一行摘要呈现，信息不丢。 */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAdvancedBudget((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-left transition-colors hover:border-blue-300"
          >
            <span className="text-[13px] font-medium text-slate-700">
              精细预算（Credits / 倍率 / 时长）
            </span>
            <span className="text-[11px] text-slate-500">
              {showAdvancedBudget
                ? '收起'
                : `${maxCredits} cr · ${budgetMultiplierOverride}× · ${wallTimeMinutes}m · 展开`}
            </span>
          </button>
          {showAdvancedBudget && (
            <BudgetAndTimeLimitPanel
              maxCredits={maxCredits}
              setMaxCredits={setMaxCredits}
              budgetMultiplierOverride={budgetMultiplierOverride}
              setBudgetMultiplierOverride={setBudgetMultiplierOverride}
              wallTimeMinutes={wallTimeMinutes}
              setWallTimeMinutes={setWallTimeMinutes}
            />
          )}
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] leading-relaxed text-blue-900">
          <p className="font-semibold">
            说明：「另存为新 mission」会用以上配置创建新 mission，原 mission
            保留作对比。
          </p>
          <p className="mt-0.5">
            （当前 mission 已经在跑或已完成，参数无法在原 mission 上
            mutate；这是有意设计，便于复盘和 A/B 对比）
          </p>
        </div>

        {saveError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[11px] leading-relaxed text-red-700">
            {saveError}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="font-mono mt-1 truncate text-sm text-slate-900">{value}</p>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Visually-grouped settings section with a compact header divider.
 *  Used by MissionSettingsModal to break the form into logical chunks
 *  (内容定义 / 搜索-输出 / 审核-执行 / 知识库) instead of one flat 2-col grid. */
function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <h4 className="border-b border-slate-100 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

// Compact inline meters in the tab bar (cost / score / wall / words)
function CompactMeters({
  view,
  wallTimeMs,
  cost,
  maxCredits,
}: {
  view: MissionDetailView;
  wallTimeMs: number;
  cost: { tokensUsed: number; costUsd: number };
  maxCredits: number | null;
}) {
  // ★ Screenshot_58 修复：把 ≥ 1M 单独显示成 X.YM，否则 "1910.0k" 这种怪显示。
  const fmtTokens = (n: number) =>
    n < 1000
      ? String(n)
      : n < 1_000_000
        ? `${(n / 1000).toFixed(1)}k`
        : `${(n / 1_000_000).toFixed(2)}M`;
  const fmtTime = (ms: number) =>
    ms < 60_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m`;

  // ★ 2026-05-29 fix: view.dimensionPipelines 是 Map（useMissionLegacyView 返回），
  //   原代码注释误标 Record + 用 Object.values(map) → 永远空数组 → totalWords 恒为 0。
  const totalWords = useMemo(() => {
    let sum = 0;
    const pipelines = view.dimensionPipelines as
      | Map<string, { chapters?: { wordCount?: number }[] }>
      | undefined;
    if (!pipelines || typeof pipelines.values !== 'function') return 0;
    for (const dim of pipelines.values()) {
      const chapters = dim.chapters;
      if (!Array.isArray(chapters)) continue;
      for (const ch of chapters) {
        if (ch.wordCount) sum += ch.wordCount;
      }
    }
    return sum;
  }, [view.dimensionPipelines]);

  // ★ Screenshot_58 修复：tokens 改读 DerivedView.cost（events-derived 稳定），
  //   不再读 canonical view.cost.tokensUsed（mission 刚完成时常 stale → "0.0 1.0%"）。
  const tokensUsed = cost.tokensUsed;

  // 预算使用率（tokensUsed / maxCredits）—— 100k 上限 = 100M tokens
  const maxTokens = maxCredits != null ? maxCredits * 1000 : null;
  const usageRatio =
    maxTokens && maxTokens > 0 ? Math.min(1, tokensUsed / maxTokens) : null;
  const usageColor =
    usageRatio == null
      ? 'text-amber-500'
      : usageRatio >= 1
        ? 'text-red-500'
        : usageRatio >= 0.9
          ? 'text-orange-500'
          : 'text-amber-500';

  return (
    <div className="font-mono hidden items-center gap-x-2 whitespace-nowrap text-[11px] text-gray-500 lg:flex">
      <span
        className="flex items-center gap-0.5"
        title={
          maxTokens != null
            ? `已用 ${tokensUsed.toLocaleString()} / 上限 ${maxTokens.toLocaleString()} tokens（maxCredits=${maxCredits}）`
            : `已用 ${tokensUsed.toLocaleString()} tokens`
        }
      >
        <Coins className={`h-3.5 w-3.5 ${usageColor}`} />
        {fmtTokens(tokensUsed)}
        {usageRatio != null && (
          <span
            className={cn(
              'ml-0.5 text-[10px]',
              usageRatio >= 1
                ? 'text-red-600'
                : usageRatio >= 0.9
                  ? 'text-orange-600'
                  : 'text-gray-400'
            )}
          >
            {(usageRatio * 100).toFixed(0)}%
          </span>
        )}
      </span>
      {totalWords > 0 && (
        <span className="flex items-center gap-0.5" title="累计已写章节字数">
          <FileText className="h-3.5 w-3.5 text-emerald-500" />
          {fmtTokens(totalWords)}
        </span>
      )}
      {view.mission.finalScore != null && (
        <span
          className="flex items-center gap-0.5"
          title={`共识质量评分 ${view.mission.finalScore} / 100`}
        >
          <Gavel className="h-3.5 w-3.5 text-violet-500" />
          {view.mission.finalScore}
        </span>
      )}
      <span className="flex items-center gap-0.5" title="已运行时长">
        <Activity className="h-3.5 w-3.5 text-sky-500" />
        {fmtTime(wallTimeMs)}
      </span>
    </div>
  );
}
