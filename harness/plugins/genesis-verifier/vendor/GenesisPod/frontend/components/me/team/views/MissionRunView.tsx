'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/dialogs';
import { MissionDialogShell } from '@/components/common/dialogs/MissionDialogShell';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/form/Input';
import { MissionGalleryView } from '@/components/common/missions/MissionGalleryView';
import { KnowledgeBaseSelector } from '@/components/common/selectors';
import type {
  MissionListItem,
  StyleProfile,
  LengthProfile,
  AudienceProfile,
  AuditLayers,
} from '@/services/agent-playground/api';
import { MODULE_THEMES } from '@/lib/design/module-themes';
import {
  STYLE_PROFILE_OPTIONS,
  LENGTH_PROFILE_OPTIONS,
  AUDIENCE_PROFILE_OPTIONS,
  AUDIT_LAYERS_OPTIONS,
} from '@/lib/constants/mission-profile-options';
import { useCompanyStore } from '@/stores/company/companyStore';
import type { CompanyMission, Hero } from '@/stores/company/companyStore';
import { useCompanyMissionStream } from '@/hooks/features/useCompanyMissionStream';
import {
  DeepInsightMissionDetail,
  fromCompanyMissionResult,
  normalizeCompanyEvents,
  type MissionReportResultLike,
} from '@/components/missions/deep-insight';
import { toast } from '@/stores';

/** 运行中实时阶段三态（WS 事件驱动详情页 live rail；纯运行态，不入 kit 契约）。 */
type LiveStageStatus = 'pending' | 'active' | 'done';

/** 后端阶段 id → 进度百分比计算用。 */
const STAGE_LABELS: Record<string, string> = {
  planning: '规划',
  execution: '执行',
  review: '评审',
};

/** company mission 状态 → playground gallery 状态枚举。 */
const STATUS_MAP: Record<string, string> = {
  queued: 'running',
  running: 'running',
  review: 'running',
  done: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNestedString(
  value: unknown,
  path: readonly string[]
): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!(key in record)) return undefined;
    current = record[key];
  }
  return asString(current);
}

function extractCompanyMissionReportMarkdown(
  result: Record<string, unknown>
): string | undefined {
  const terminal = asRecord(result.__terminal);
  return (
    asString(result.summary) ??
    asString(result.report) ??
    readNestedString(result.reportArtifact, ['content', 'fullMarkdown']) ??
    asString(terminal.summary) ??
    asString(terminal.report) ??
    readNestedString(terminal.reportArtifact, ['content', 'fullMarkdown'])
  );
}

function hasFailedCompanyMissionStep(
  result: Record<string, unknown>
): boolean {
  const steps = Array.isArray(result.steps) ? result.steps : [];
  return steps.some((step) => {
    const status = asString(asRecord(step).status);
    return status === 'failed' || status === 'quality-failed';
  });
}

/** company mission → canonical MissionListItem（喂给 MissionGalleryView）。 */
function toListItem(m: CompanyMission): MissionListItem {
  const result = asRecord(m.result);
  const review = asRecord(result.review);
  const usage = asRecord(result.usage);
  const reportMarkdown = extractCompanyMissionReportMarkdown(result);
  const normalizedStatus = STATUS_MAP[m.status] ?? m.status;
  const missingReportMessage =
    normalizedStatus === 'completed' && !reportMarkdown
      ? '报告缺失：任务被标记完成，但未持久化报告正文。'
      : null;
  const displayStatus =
    missingReportMessage != null
      ? 'failed'
      : normalizedStatus === 'completed' && hasFailedCompanyMissionStep(result)
        ? 'degraded'
        : normalizedStatus;
  const iso = new Date(m.createdAt).toISOString();
  return {
    id: m.id,
    topic: m.title,
    depth: asString(result.depth) ?? 'deep',
    language: asString(result.language) ?? 'zh-CN',
    status: displayStatus,
    startedAt: iso,
    completedAt: m.status === 'done' ? iso : null,
    elapsedWallTimeMs: null,
    finalScore:
      typeof review.score === 'number' ? review.score : null,
    tokensUsed:
      typeof usage.totalTokens === 'number' ? usage.totalTokens : null,
    costUsd:
      typeof usage.totalCostCents === 'number'
        ? usage.totalCostCents / 100
        : null,
    reportTitle: m.title,
    reportSummary:
      reportMarkdown ?? asString(result.themeSummary) ?? null,
    errorMessage:
      missingReportMessage ??
      asString(result.errorMessage) ??
      asString(result.error) ??
      asString(result.latestError) ??
      null,
    visibility: 'PRIVATE',
  };
}

const DEPTH_OPTIONS = [
  { value: 'quick', label: '快速', hint: '~5 分钟' },
  { value: 'standard', label: '标准', hint: '~10 分钟' },
  { value: 'deep', label: '深度', hint: '~20 分钟' },
] as const;

function pickPreferredHero(heroes: Hero[]): Hero | null {
  return (
    heroes.find((h) => h.capabilityId === 'deep-insight-solar') ??
    heroes[0] ??
    null
  );
}

/** 下发任务表单字段壳（label + 选填提示 + 内容），对齐 playground 视觉。 */
function Field({
  label,
  required,
  hint,
  hintInline,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  hintInline?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
          {hintInline && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              {hintInline}
            </span>
          )}
        </label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function MissionRunView({
  embedded = false,
  initialHeroId = null,
  initialCapabilityId = null,
  initialReportMissionId = null,
  dispatchRequestKey = 0,
  onDetailOpenChange,
}: {
  embedded?: boolean;
  initialHeroId?: string | null;
  initialCapabilityId?: string | null;
  initialReportMissionId?: string | null;
  dispatchRequestKey?: number;
  /** 进入/退出任务详情态时上报父级（嵌「我的团队」时用于隐藏团队页头 + Tab）。 */
  onDetailOpenChange?: (open: boolean) => void;
} = {}) {
  const {
    heroes,
    missions,
    deleteMission,
    cancelMission,
    rerunMission,
    resumeMission,
    renameMission,
    setMissionProgress,
    loadMissions,
    loadCompany,
    loadHeroes,
    createHeroMission,
  } = useCompanyStore();

  const preferredInitialHero = pickPreferredHero(heroes);
  const [heroId, setHeroId] = useState<string>(preferredInitialHero?.id ?? '');
  const [expectedCapabilityId, setExpectedCapabilityId] = useState<
    string | null
  >(preferredInitialHero?.capabilityId ?? null);
  const [lockedDispatchHeroId, setLockedDispatchHeroId] = useState<
    string | null
  >(null);
  const [title, setTitle] = useState('');
  // 点开查看的任务详情
  const [reportMissionId, setReportMissionId] = useState<string | null>(null);
  // 下发任务弹窗
  const [dispatchOpen, setDispatchOpen] = useState(false);
  // 运行中实时阶段状态（驱动详情页 live rail；列表态不再内联展示）
  const [, setStageStatus] = useState<Record<string, LiveStageStatus>>({});
  const [running, setRunning] = useState(false);
  // 当前正在监听的 missionId（null = 未下达）
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const runningRef = useRef(false);
  // Fix 4: 运行中实时算力累积（company.cost:tick → totalTokens/totalCostCents）
  const [liveUsageByMission, setLiveUsageByMission] = useState<
    Record<string, { totalTokens: number; totalCostCents: number }>
  >({});
  // gallery 重载触发器：store missions 变化时 +1，让卡片随 WS 进度刷新
  const [galleryReload, setGalleryReload] = useState(0);
  // 重命名弹窗（替代 window.prompt）
  const [renameTarget, setRenameTarget] = useState<MissionListItem | null>(
    null
  );
  const [renameValue, setRenameValue] = useState('');
  // 下发任务富化输入（参考 playground）：描述 / 调研规模 / 语言
  const [description, setDescription] = useState('');
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('deep');
  const [language, setLanguage] = useState<'zh-CN' | 'en-US'>('zh-CN');
  const [withFigures, setWithFigures] = useState(false);
  const [searchTimeRange, setSearchTimeRange] = useState<
    '30d' | '90d' | '180d' | '365d' | '730d' | 'all'
  >('all');
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [styleProfile, setStyleProfile] = useState<StyleProfile>('executive');
  const [lengthProfile, setLengthProfile] = useState<LengthProfile>('standard');
  const [audienceProfile, setAudienceProfile] =
    useState<AudienceProfile>('domain-expert');
  const [auditLayers, setAuditLayers] = useState<AuditLayers>('default');

  const { events: wsEvents } = useCompanyMissionStream(activeMissionId);
  // 详情态第二路订阅：为当前打开的报告 mission 订阅实时事件（注入 collab tab）
  const { events: reportMissionEvents } =
    useCompanyMissionStream(reportMissionId);

  // 首次加载：公司快照（团队/成员）+ 已有任务 + 专家列表
  useEffect(() => {
    void loadCompany();
    void loadMissions();
    void loadHeroes();
  }, [loadCompany, loadMissions, loadHeroes]);

  // 详情态开关上报父级：进入任务详情（整屏 DeepInsightMissionDetail）时，
  // 让「我的团队」隐藏页头 + Tab，详情全屏接管。
  useEffect(() => {
    onDetailOpenChange?.(reportMissionId !== null);
  }, [reportMissionId, onDetailOpenChange]);

  // 运行中打开详情：每 3s 刷新该任务的持久化结果（后端实时落 result.steps/collab），
  // 让任务列表/协作动态逐个推进且持久化（刷新/重开仍在，非事后补）。
  useEffect(() => {
    if (!reportMissionId) return;
    const t = setInterval(() => {
      const m = useCompanyStore
        .getState()
        .missions.find((x) => x.id === reportMissionId);
      if (
        m &&
        (m.status === 'running' ||
          m.status === 'review' ||
          m.status === 'queued')
      ) {
        void loadMissions();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [reportMissionId, loadMissions]);

  // store missions 变化 → 通知 gallery 重新读取（含 WS 进度 / 新建 / 删除）
  useEffect(() => {
    setGalleryReload((n) => n + 1);
  }, [missions]);

  // 同步默认专家 id（避免初始渲染时 heroes 为空；默认优先 Solar 强模型线）
  useEffect(() => {
    if (heroes.length > 0 && !heroId) {
      const preferred = pickPreferredHero(heroes);
      if (!preferred) return;
      setHeroId(preferred.id);
      setExpectedCapabilityId(preferred.capabilityId);
    }
  }, [heroes, heroId]);

  const handledInitialReportMissionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialReportMissionId) return;
    if (handledInitialReportMissionRef.current === initialReportMissionId) {
      return;
    }
    if (!missions.some((m) => m.id === initialReportMissionId)) return;
    handledInitialReportMissionRef.current = initialReportMissionId;
    setReportMissionId(initialReportMissionId);
  }, [initialReportMissionId, missions]);

  const handledDispatchKeyRef = useRef(0);
  useEffect(() => {
    if (dispatchRequestKey <= 0) return;
    if (handledDispatchKeyRef.current === dispatchRequestKey) return;
    if (!initialHeroId && !initialCapabilityId) return;
    const selected =
      heroes.find(
        (h) =>
          h.id === initialHeroId &&
          (!initialCapabilityId || h.capabilityId === initialCapabilityId)
      ) ??
      (initialCapabilityId
        ? heroes.find((h) => h.capabilityId === initialCapabilityId)
        : null);
    if (!selected) return;
    handledDispatchKeyRef.current = dispatchRequestKey;
    setHeroId(selected.id);
    setExpectedCapabilityId(selected.capabilityId);
    setLockedDispatchHeroId(selected.id);
    setDispatchOpen(true);
  }, [heroes, initialHeroId, initialCapabilityId, dispatchRequestKey]);

  // 处理 WS 事件 → 更新 store 进度 + 阶段状态（详情页 live rail 用）
  const processedTsRef = useRef<number>(0);
  useEffect(() => {
    if (!activeMissionId) return;
    const newEvents = wsEvents.filter(
      (e) => e.timestamp > processedTsRef.current
    );
    if (!newEvents.length) return;
    processedTsRef.current = newEvents[newEvents.length - 1].timestamp;

    for (const e of newEvents) {
      if (e.type === 'company.mission:started') {
        setMissionProgress(activeMissionId, 0, 'running');
      } else if (e.type === 'company.stage:lifecycle') {
        const p = e.payload as { stage?: string; status?: string };
        if (p.stage) {
          setStageStatus((s) => ({
            ...s,
            [p.stage!]: p.status === 'completed' ? 'done' : 'active',
          }));
        }
        if (p.status === 'completed') {
          const stageIndex = Object.keys(STAGE_LABELS).indexOf(p.stage ?? '');
          const total = Object.keys(STAGE_LABELS).length;
          const progress =
            stageIndex >= 0
              ? Math.round(((stageIndex + 1) / total) * 100)
              : undefined;
          if (progress !== undefined) {
            setMissionProgress(activeMissionId, progress, 'running');
          }
        }
      } else if (e.type === 'company.mission:completed') {
        setStageStatus({ planning: 'done', execution: 'done', review: 'done' });
        setMissionProgress(activeMissionId, 100, 'done');
        if (runningRef.current) {
          setRunning(false);
          runningRef.current = false;
        }
      } else if (e.type === 'company.mission:failed') {
        setMissionProgress(activeMissionId, 0, 'failed');
        if (runningRef.current) {
          setRunning(false);
          runningRef.current = false;
        }
      } else if (e.type === 'company.cost:tick') {
        // Fix 4: accumulate live cost from delta ticks.
        const p = e.payload as {
          deltaTokens?: number;
          deltaCostUsd?: number;
        };
        const dt = typeof p.deltaTokens === 'number' ? p.deltaTokens : 0;
        const dc =
          typeof p.deltaCostUsd === 'number'
            ? Math.round(p.deltaCostUsd * 100)
            : 0;
        if (dt > 0 || dc > 0) {
          setLiveUsageByMission((prev) => {
            const cur = prev[activeMissionId] ?? {
              totalTokens: 0,
              totalCostCents: 0,
            };
            return {
              ...prev,
              [activeMissionId]: {
                totalTokens: cur.totalTokens + dt,
                totalCostCents: cur.totalCostCents + dc,
              },
            };
          });
        }
      }
    }
  }, [wsEvents, activeMissionId, setMissionProgress]);

  const activeHero = heroes.find((h) => h.id === heroId) ?? null;

  const dispatch = async () => {
    if (!activeHero || !title.trim() || running) return;
    if (
      expectedCapabilityId &&
      activeHero.capabilityId !== expectedCapabilityId
    ) {
      toast.error(
        '下发任务被阻止',
        `专家能力不匹配：期望 ${expectedCapabilityId}，实际 ${activeHero.capabilityId}`
      );
      return;
    }
    const taskTitle = title.trim();
    const taskDescription = description.trim();
    setTitle('');
    setDescription('');
    setKnowledgeBaseIds([]);
    setStageStatus({ planning: 'active' });
    setActiveMissionId(null);
    processedTsRef.current = 0;
    setRunning(true);
    runningRef.current = true;
    setDispatchOpen(false);

    const missionId = await createHeroMission(activeHero.id, taskTitle, {
      description: taskDescription || undefined,
      depth,
      language,
      withFigures,
      searchTimeRange,
      knowledgeBaseIds:
        knowledgeBaseIds.length > 0 ? knowledgeBaseIds : undefined,
      styleProfile,
      lengthProfile,
      audienceProfile,
      auditLayers,
      expectedCapabilityId: expectedCapabilityId ?? activeHero.capabilityId,
    });
    if (!missionId) {
      setRunning(false);
      runningRef.current = false;
      return;
    }
    setActiveMissionId(missionId);
    // 下发后直接进入该任务的详情卡（整屏 DeepInsightMissionDetail），实时看协作过程
    setReportMissionId(missionId);
  };

  // gallery 数据源：从 store 读取并映射为 canonical MissionListItem（稳定引用）
  const fetchMissions = useCallback(async () => {
    return useCompanyStore.getState().missions.map(toListItem);
  }, []);

  // 提交重命名（重命名弹窗确认 / 回车）
  const submitRename = () => {
    const next = renameValue.trim();
    if (renameTarget && next && next !== renameTarget.topic) {
      void renameMission(renameTarget.id, next);
    }
    setRenameTarget(null);
  };

  // ── 详情态：整页 DeepInsightMissionDetail（L4 kit，吃归一契约）─────────
  const reportMission = missions.find((m) => m.id === reportMissionId) ?? null;
  if (reportMission) {
    const reportResult = reportMission.result as
      | (MissionReportResultLike & { depth?: string; language?: string })
      | undefined;
    // 优先用 mission 自带的 heroId 精确还原原专家；缺失（旧数据 / 团队任务）才
    // 以第一个专家兜底；没有任何专家时优雅地隐藏「重新下发」入口。
    const rerunHeroId = reportMission.heroId ?? heroes[0]?.id ?? null;
    // Fix 3: normalize events to expand company.agent:trace → tagged narrative entries
    // so MissionFlowView can render ThinkingCard / ToolCallChip.
    const normalizedReportEvents = normalizeCompanyEvents(reportMissionEvents);
    const reportResultMeta =
      reportMission.result &&
      typeof reportMission.result === 'object' &&
      !Array.isArray(reportMission.result)
        ? (reportMission.result as Record<string, unknown>)
        : {};
    const checkpoint = reportResultMeta.__checkpoint as
      | { lastStepId?: unknown }
      | undefined;
    const dispatch = reportResultMeta.__dispatch as
      | { capabilityId?: unknown }
      | undefined;
    const canResume =
      reportMission.status === 'failed' &&
      typeof checkpoint?.lastStepId === 'string' &&
      checkpoint.lastStepId.length > 0 &&
      typeof dispatch?.capabilityId === 'string' &&
      dispatch.capabilityId.length > 0;
    const handleResume = () => {
      void resumeMission(reportMission.id).then((id) => {
        if (id) {
          setActiveMissionId(id);
          setReportMissionId(id);
        }
      });
    };
    const detailView = fromCompanyMissionResult({
      id: reportMission.id,
      title: reportMission.title,
      status: reportMission.status,
      createdAt: reportMission.createdAt,
      result: reportResult,
      depth: reportResult?.depth,
      language: reportResult?.language,
      events: normalizedReportEvents,
      // Fix 4: inject live cost while running (terminal uses result.usage from backend).
      liveUsage: liveUsageByMission[reportMission.id],
      actions: [
        ...(canResume
          ? [
              {
                variant: 'primary' as const,
                emoji: '↻',
                label: '继续上次',
                title: '从失败前保存的 checkpoint 继续同一 mission',
                onClick: handleResume,
              },
            ]
          : []),
        ...(rerunHeroId
          ? [
              {
                variant: canResume ? ('secondary' as const) : ('primary' as const),
                emoji: '▶',
                label: '复跑',
                title:
                  '用原任务的相同档位（深度/语言/知识库/图文）起一个新 mission',
                onClick: () => {
                  void rerunMission(reportMission.id).then((id) => {
                    if (id) setActiveMissionId(id);
                  });
                  setReportMissionId(null);
                },
              },
            ]
          : []),
        {
          variant: 'danger',
          emoji: '⏹',
          label: '删除',
          title: '删除该任务及其报告',
          onClick: () => {
            void deleteMission(reportMission.id);
            setReportMissionId(null);
          },
        },
      ],
    });

    const handleRerun = () => {
      // 复跑：后端用原任务保留的派发参数（__dispatch）创建全新 mission 重跑，保留全部档位。
      void rerunMission(reportMission.id).then((id) => {
        if (id) setActiveMissionId(id);
      });
      setReportMissionId(null);
    };

    return (
      <DeepInsightMissionDetail
        data={detailView}
        onBack={() => setReportMissionId(null)}
        onRerun={handleRerun}
        // onUpdate: 可恢复时继续同一 mission；否则回到旧逻辑，打开新建弹窗。
        onUpdate={
          canResume
            ? handleResume
            : () => {
                setTitle(reportMission.title);
                setReportMissionId(null);
                setDispatchOpen(true);
              }
        }
        // onSettings: 复用 onUpdate 流（预填 title 打开弹窗配置后再跑）
        onSettings={() => {
          setTitle(reportMission.title);
          setReportMissionId(null);
          setDispatchOpen(true);
        }}
        // onCancel: 运行中可取消（abort capability run + 置 cancelled）
        onCancel={
          reportMission.status === 'running' ||
          reportMission.status === 'review' ||
          reportMission.status === 'queued'
            ? () => {
                void cancelMission(reportMission.id);
              }
            : undefined
        }
        // onLeaderClick / onResearchTeamClick: 暂无弹窗
        onLeaderClick={undefined}
        onResearchTeamClick={undefined}
        onDelete={() => {
          void deleteMission(reportMission.id);
          setReportMissionId(null);
        }}
      />
    );
  }

  // ── 列表态：canonical MissionGalleryView（搜索 + 卡片网格 + 新建占位卡）──
  return (
    <>
      <MissionDialogShell
        isOpen={dispatchOpen}
        onClose={() => {
          setDispatchOpen(false);
          setLockedDispatchHeroId(null);
        }}
        title="下发任务"
        subtitle="选择专家、描述要做的事，交给专家执行"
        submitLabel="下发任务"
        submitting={running}
        submitDisabled={!title.trim() || heroes.length === 0}
        onSubmit={() => void dispatch()}
        advancedLabel="高级配置"
        primary={
          heroes.length === 0 ? (
            <EmptyState
              type="default"
              size="sm"
              title="还没有专家"
              description="还没有专家，先去专家市场收一个"
            />
          ) : (
            <>
              <Field label="派给哪个专家" required>
                <select
                  value={heroId}
                  disabled={lockedDispatchHeroId !== null}
                  onChange={(e) => {
                    const nextHero = heroes.find(
                      (h) => h.id === e.target.value
                    );
                    setHeroId(e.target.value);
                    setExpectedCapabilityId(nextHero?.capabilityId ?? null);
                  }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-50 disabled:text-gray-500"
                >
                  {heroes.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
                {lockedDispatchHeroId && activeHero && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    已按专家卡入口锁定：{activeHero.name}（
                    {activeHero.capabilityId}）
                  </p>
                )}
              </Field>

              <Field label="任务话题" required>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void dispatch();
                  }}
                  placeholder="例如：调研 Q3 竞品定价并给出建议"
                />
              </Field>

              <Field
                label="研究描述"
                hintInline="选填——背景 / 关注角度 / 约束，明显提升拆解质量"
              >
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="例如：聚焦头部 3 家厂商，时间窗口近 12 个月，重点对比定价策略与商业化打法。"
                  className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </Field>

              <Field label="调研规模" required>
                <div className="grid grid-cols-3 gap-1.5">
                  {DEPTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDepth(opt.value)}
                      className={`flex flex-col items-center rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                        depth === opt.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                      <span className="mt-0.5 text-xs font-normal text-gray-400">
                        {opt.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )
        }
        advanced={
          heroes.length === 0 ? undefined : (
            <>
              <Field label="输出语言">
                <select
                  value={language}
                  onChange={(e) =>
                    setLanguage(e.target.value as 'zh-CN' | 'en-US')
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </Field>

              <Field label="搜索时效" hint="限定取证的时间窗口">
                <select
                  value={searchTimeRange}
                  onChange={(e) =>
                    setSearchTimeRange(e.target.value as typeof searchTimeRange)
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">不限</option>
                  <option value="30d">近 30 天</option>
                  <option value="90d">近 90 天</option>
                  <option value="180d">近 180 天</option>
                  <option value="365d">近 1 年</option>
                  <option value="730d">近 2 年</option>
                </select>
              </Field>

              <Field label="图文并茂" hintInline="抓取配图，报告含图表">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={withFigures}
                    onChange={(e) => setWithFigures(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  开启图文抓取
                </label>
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="文风">
                  <select
                    value={styleProfile}
                    onChange={(e) =>
                      setStyleProfile(e.target.value as StyleProfile)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {STYLE_PROFILE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="长度档位">
                  <select
                    value={lengthProfile}
                    onChange={(e) =>
                      setLengthProfile(e.target.value as LengthProfile)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {LENGTH_PROFILE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="主要受众">
                  <select
                    value={audienceProfile}
                    onChange={(e) =>
                      setAudienceProfile(e.target.value as AudienceProfile)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {AUDIENCE_PROFILE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="审核层级">
                <div className="grid grid-cols-4 gap-1.5">
                  {AUDIT_LAYERS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAuditLayers(opt.value)}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                        auditLayers === opt.value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label="知识源"
                hintInline="不选则纯 web-search；选了则先 KB 召回再补 web"
              >
                <KnowledgeBaseSelector
                  selectedIds={knowledgeBaseIds}
                  onSelectionChange={(ids) => setKnowledgeBaseIds(ids)}
                  multiple
                  maxSelections={10}
                  filterType="ALL"
                  onlyReady
                />
              </Field>
            </>
          )
        }
      />

      <MissionGalleryView
        hideHeader={embedded}
        title="专家任务"
        subtitle="派专家执行任务，实时看协作过程，完成后查看完整研究报告"
        iconGradient={MODULE_THEMES.ask.gradient}
        createButtonLabel="下发任务"
        onCreateMission={() => setDispatchOpen(true)}
        fetchMissions={fetchMissions}
        onMissionClick={(m) => setReportMissionId(m.id)}
        onEdit={(m) => {
          setRenameTarget(m);
          setRenameValue(m.topic);
        }}
        onDelete={(m) => void deleteMission(m.id)}
        searchPlaceholder="搜索任务标题…"
        listHeading="专家任务"
        emptyState={{
          title: '还没有任务',
          hint: '派你的专家执行第一个任务，看它产出研究报告',
          ctaLabel: '下发任务',
        }}
        reloadKey={galleryReload}
      />

      {/* 重命名弹窗（canonical Modal + Input + Button，替代 window.prompt）*/}
      <Modal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="重命名任务"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={submitRename} disabled={!renameValue.trim()}>
              保存
            </Button>
          </>
        }
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitRename();
          }}
          placeholder="任务标题"
          autoFocus
        />
      </Modal>
    </>
  );
}
