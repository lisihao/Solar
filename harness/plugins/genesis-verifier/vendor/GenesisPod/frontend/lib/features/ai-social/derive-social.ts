/**
 * deriveSocialView — social mission 事件 → social 视图（纯函数，可重放幂等）。
 *
 * social 不是 research：用它自己的 12-13 阶段流水线当任务分解（业务定内容），
 * 不复用 agent-playground 的 research 专属 deriveView（维度/researcher）。
 *
 * 2026-05-21 富化（Playground 对齐重构 W1）：后端早已发 social.agent:* + cost:tick，
 * 之前 social 页错用 research 形状的 deriveView 且被 KNOWN_AGENT_ROLES 角色锁丢弃。
 * 现在 deriveSocialView 自己消费 agent 轨迹 + 成本，产出社媒自己的 agents[] / cost。
 *
 * 消费事件（namespace 剥离后）：
 *   - stage:lifecycle  { stepId, status: started|completed|failed, primitive?, error? }
 *   - agent:lifecycle  { agentId, role, phase: started|completed|failed, wallTimeMs?, iterations?, error? }
 *   - agent:thought    { agentId, role, text?, modelId? }
 *   - agent:action     { agentId, role, toolId?/skillId?/kind?, input?, calls?[] }
 *   - agent:observation{ agentId, role, toolId?, output?, latencyMs?, tokensUsed?, error? }
 *   - agent:reflection { agentId, role, text?, verdict? }
 *   - agent:error      { agentId, role, message? }
 *   - cost:tick        { stage?, deltaTokens?, deltaCostUsd?, tokensUsed?, costUsd? }
 *   - mission:completed / mission:failed / mission:aborted
 *
 * 安全（defense-in-depth，配合后端 SocialEventRelay redact）：
 *   publish-executor / platform-probe 的 thought 文本与 action.input/observation.output
 *   原文一律不入 trace（可能含微信 token / cookie / session），只保留统计字段。
 */

import type { MissionEvent } from '@/hooks/features/useMissionStream';
import type { SocialMissionSnapshot } from '@/services/ai-social/task-types';

export type SocialStageStatus = 'pending' | 'running' | 'done' | 'failed';
export type SocialMissionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type SocialRoleStatus = 'idle' | 'working' | 'done' | 'failed';
export type SocialAgentPhase = 'pending' | 'running' | 'completed' | 'failed';

export interface SocialStageView {
  stepId: string;
  label: string;
  /** 一句说明（该阶段做什么）*/
  desc?: string;
  role?: string;
  status: SocialStageStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface SocialRoleView {
  role: string;
  label: string;
  status: SocialRoleStatus;
}

/** agent 轨迹单条（ReAct 中间态）——结构同 playground，跨 domain 同构 */
export interface SocialTraceItem {
  kind: 'thought' | 'action' | 'observation' | 'reflection' | 'error';
  ts: number;
  text?: string;
  toolId?: string;
  input?: unknown;
  output?: unknown;
  latencyMs?: number;
  tokensUsed?: number;
  error?: string;
}

/** 单个 social agent 实例的实时状态（每个角色一个 agent） */
export interface SocialAgentState {
  agentId: string;
  /** 归一化后的社媒角色 id（与 SOCIAL_TEAM 对齐，如 'Composer'） */
  role: string;
  /** 后端原始 role（kebab，如 'composer'），用于安全判定 */
  rawRole: string;
  phase: SocialAgentPhase;
  startedAt?: number;
  endedAt?: number;
  wallTimeMs?: number;
  iterations?: number;
  modelId?: string;
  failureMessage?: string;
  trace: SocialTraceItem[];
}

export interface SocialCostView {
  tokensUsed: number;
  costUsd: number;
  byStage: { stage: string; tokensUsed: number; costUsd: number }[];
}

export interface SocialMissionView {
  status: SocialMissionStatus;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  failedMessage?: string;
  cancelledAt?: number;
  progress: { done: number; total: number };
  stages: SocialStageView[];
  roles: SocialRoleView[];
  agents: SocialAgentState[];
  cost: SocialCostView;
}

/** stepId → 中文 label + 角色 + 一句说明（与后端 13 阶段对齐；未知 stepId 走 humanize 兜底） */
const STEP_META: Record<
  string,
  { label: string; role?: string; desc?: string }
> = {
  's1-mission-budget-eval': { label: '预算评估', role: 'Steward', desc: '评估预算与配额闸门' }, // prettier-ignore
  's2-platform-probe': { label: '平台探测', role: 'PlatformProbe', desc: '探测目标平台规则与限制' }, // prettier-ignore
  's3-content-transform': { label: '内容转换', role: 'ContentTransformer', desc: '把素材改写适配各平台' }, // prettier-ignore
  's4-leader-assess-transform': { label: 'Leader 评估', role: 'Leader', desc: 'Leader 审核转换结果' }, // prettier-ignore
  's5-cover-craft': {
    label: '封面制作',
    role: 'CoverArtist',
    desc: '生成封面图',
  },
  's6-body-compose': { label: '正文撰写', role: 'Composer', desc: '编排正文 HTML/排版' }, // prettier-ignore
  's7-polish-review': { label: '润色审核', role: 'PolishReviewer', desc: '润色 + 质量复审' }, // prettier-ignore
  's8-publish-execute': { label: '发布执行', role: 'PublishExecutor', desc: '推送到平台草稿箱' }, // prettier-ignore
  's8b-publish-retry': { label: '发布重试', role: 'PublishExecutor', desc: '发布失败后重试' }, // prettier-ignore
  's9-publish-verify': { label: '发布验证', role: 'PublishVerifier', desc: '验证发布结果' }, // prettier-ignore
  's10-leader-signoff': { label: 'Leader 签收', role: 'Leader', desc: 'Leader 终审签收' }, // prettier-ignore
  's11-mission-persist': { label: '结果持久化', desc: '落库归档轨迹' },
  's12-self-evolution': { label: '自进化复盘', desc: '复盘与自进化' },
};

const ROLE_LABEL: Record<string, string> = {
  Steward: '预算管家',
  PlatformProbe: '平台探测',
  ContentTransformer: '内容转换',
  Leader: 'Leader',
  CoverArtist: '封面师',
  Composer: '撰稿',
  PolishReviewer: '润色审核',
  PublishExecutor: '发布执行',
  PublishVerifier: '发布验证',
};

/** 后端 agent role（kebab）→ 前端 SOCIAL_TEAM 角色 id（Pascal） */
const SOCIAL_AGENT_ROLE_MAP: Record<string, string> = {
  leader: 'Leader',
  steward: 'Steward',
  'platform-probe': 'PlatformProbe',
  'content-transformer': 'ContentTransformer',
  'cover-artist': 'CoverArtist',
  composer: 'Composer',
  'polish-reviewer': 'PolishReviewer',
  'publish-executor': 'PublishExecutor',
  'publish-verifier': 'PublishVerifier',
};

/** 携带平台凭证、thought/io 原文绝不入前端的高危角色（与后端 redact 双保险） */
const SENSITIVE_RAW_ROLES = new Set(['publish-executor', 'platform-probe']);

function normalizeRole(rawRole: string): string {
  return (
    SOCIAL_AGENT_ROLE_MAP[rawRole] ??
    SOCIAL_AGENT_ROLE_MAP[rawRole.toLowerCase()] ??
    rawRole
  );
}

function stripNamespace(type: string): string {
  const i = type.indexOf('.');
  return i >= 0 ? type.slice(i + 1) : type;
}

function humanize(stepId: string): string {
  return (
    stepId
      .replace(/^s\d+[a-z]?-/i, '')
      .replace(/-/g, ' ')
      .trim() || stepId
  );
}

function roleStatusFromPhase(
  phase: SocialAgentPhase
): SocialRoleStatus | undefined {
  if (phase === 'running') return 'working';
  if (phase === 'completed') return 'done';
  if (phase === 'failed') return 'failed';
  return undefined;
}

export function deriveSocialView(
  events: MissionEvent[],
  persisted?: SocialMissionSnapshot | null
): SocialMissionView {
  const stageMap = new Map<string, SocialStageView>();

  // 预置全部阶段（pending）——任务列表一开始就是完整列表（而非只有已发事件的几行）；
  // 事件到来后在原位更新状态。
  for (const [stepId, meta] of Object.entries(STEP_META)) {
    stageMap.set(stepId, {
      stepId,
      label: meta.label,
      desc: meta.desc,
      role: meta.role,
      status: 'pending',
    });
  }

  let status: SocialMissionStatus = 'idle';
  let startedAt: number | undefined;
  let completedAt: number | undefined;
  let failedAt: number | undefined;
  let failedMessage: string | undefined;
  let cancelledAt: number | undefined;

  // ── agent 轨迹聚合 ──────────────────────────────────────────────────────────
  const agents = new Map<string, SocialAgentState>();
  const ensureAgent = (agentId: string, rawRole: string): SocialAgentState => {
    let cur = agents.get(agentId);
    if (!cur) {
      cur = {
        agentId,
        role: normalizeRole(rawRole),
        rawRole,
        phase: 'pending',
        trace: [],
      };
      agents.set(agentId, cur);
    }
    return cur;
  };

  // ── 成本聚合（同 playground 的 Math.max 防重放双计） ──────────────────────────
  let totalTokens = 0;
  let totalCost = 0;
  let summedDeltaTokens = 0;
  let summedDeltaCost = 0;
  const costByStage = new Map<
    string,
    { tokensUsed: number; costUsd: number }
  >();

  for (const ev of events) {
    const type = stripNamespace(ev.type ?? '');
    const p = (ev.payload ?? {}) as Record<string, unknown>;

    if (type === 'stage:lifecycle') {
      const stepId = String(p.stepId ?? p.stage ?? 'unknown');
      const meta = STEP_META[stepId];
      const primitive =
        typeof p.primitive === 'string' ? p.primitive : undefined;
      // 角色优先用 stepId 映射（语义明确：Steward/PlatformProbe…），
      // primitive 是后端泛值（如 'persist'），仅在无映射时兜底。
      const resolvedRole = meta?.role ?? primitive;
      const stage: SocialStageView = stageMap.get(stepId) ?? {
        stepId,
        label: meta?.label ?? humanize(stepId),
        desc: meta?.desc,
        role: resolvedRole,
        status: 'pending',
      };
      if (resolvedRole) stage.role = resolvedRole;

      const evStatus = String(p.status ?? '');
      if (evStatus === 'started') {
        if (stage.status !== 'done' && stage.status !== 'failed') {
          stage.status = 'running';
        }
        stage.startedAt = stage.startedAt ?? ev.timestamp;
      } else if (evStatus === 'completed') {
        stage.status = 'done';
        stage.completedAt = ev.timestamp;
      } else if (evStatus === 'failed') {
        stage.status = 'failed';
        stage.completedAt = ev.timestamp;
        stage.error = typeof p.error === 'string' ? p.error : undefined;
      }
      stageMap.set(stepId, stage);

      if (status === 'idle') status = 'running';
      startedAt = startedAt ?? ev.timestamp;
    } else if (type === 'agent:lifecycle') {
      const agentId = String(p.agentId ?? ev.agentId ?? '');
      const rawRole = typeof p.role === 'string' ? p.role : '';
      const phase = p.phase as 'started' | 'completed' | 'failed' | undefined;
      if (!agentId || !rawRole || !phase) continue;
      const cur = ensureAgent(agentId, rawRole);
      if (phase === 'started') {
        cur.phase = 'running';
        cur.startedAt = cur.startedAt ?? ev.timestamp;
      } else if (phase === 'completed' || phase === 'failed') {
        cur.phase = phase === 'completed' ? 'completed' : 'failed';
        cur.endedAt = ev.timestamp;
        cur.wallTimeMs =
          (typeof p.wallTimeMs === 'number' ? p.wallTimeMs : undefined) ??
          (cur.startedAt ? ev.timestamp - cur.startedAt : undefined);
        cur.iterations =
          (typeof p.iterations === 'number' ? p.iterations : undefined) ??
          cur.iterations;
        const failMsg =
          (typeof p.error === 'string' ? p.error : undefined) ??
          (typeof p.message === 'string' ? p.message : undefined);
        if (failMsg && phase === 'failed') cur.failureMessage = failMsg;
      }
      if (status === 'idle') status = 'running';
      startedAt = startedAt ?? ev.timestamp;
    } else if (
      type === 'agent:thought' ||
      type === 'agent:action' ||
      type === 'agent:observation' ||
      type === 'agent:reflection' ||
      type === 'agent:error'
    ) {
      const agentId = String(p.agentId ?? ev.agentId ?? '');
      const rawRole = typeof p.role === 'string' ? p.role : '';
      if (!agentId || !rawRole) continue;
      const cur = ensureAgent(agentId, rawRole);
      const sensitive = SENSITIVE_RAW_ROLES.has(rawRole.toLowerCase());
      const ts =
        (typeof p.originalTs === 'number' ? p.originalTs : undefined) ??
        ev.timestamp;

      if (type === 'agent:thought') {
        const modelId = typeof p.modelId === 'string' ? p.modelId : undefined;
        if (modelId) cur.modelId = modelId;
        // 高危角色 thought 文本不入前端（可能复述凭证）
        cur.trace.push({
          kind: 'thought',
          ts,
          text: sensitive
            ? undefined
            : typeof p.text === 'string'
              ? p.text
              : undefined,
        });
      } else if (type === 'agent:action') {
        const kind = typeof p.kind === 'string' ? p.kind : undefined;
        // parallel_tool_call 拍平，便于工具统计正确聚合
        if (kind === 'parallel_tool_call' && Array.isArray(p.calls)) {
          (p.calls as Record<string, unknown>[]).forEach((sub, i) => {
            cur.trace.push({
              kind: 'action',
              ts: ts + i * 0.001,
              toolId:
                (typeof sub?.toolId === 'string' ? sub.toolId : undefined) ??
                (typeof sub?.skillId === 'string' ? sub.skillId : undefined) ??
                (typeof sub?.kind === 'string' ? sub.kind : undefined),
              input: sensitive ? undefined : sub?.input,
            });
          });
        } else {
          cur.trace.push({
            kind: 'action',
            ts,
            toolId:
              (typeof p.toolId === 'string' ? p.toolId : undefined) ??
              (typeof p.skillId === 'string' ? p.skillId : undefined) ??
              (typeof p.kind === 'string' ? p.kind : undefined),
            input: sensitive ? undefined : p.input,
          });
        }
      } else if (type === 'agent:observation') {
        cur.trace.push({
          kind: 'observation',
          ts,
          toolId:
            (typeof p.toolId === 'string' ? p.toolId : undefined) ??
            (typeof p.kind === 'string' ? p.kind : undefined),
          // 高危角色 observation 原文不入前端（含平台 API 原始响应）
          output: sensitive ? undefined : p.output,
          latencyMs: typeof p.latencyMs === 'number' ? p.latencyMs : undefined,
          tokensUsed:
            typeof p.tokensUsed === 'number' ? p.tokensUsed : undefined,
          error: typeof p.error === 'string' ? p.error : undefined,
        });
      } else if (type === 'agent:reflection') {
        const text = typeof p.text === 'string' ? p.text : undefined;
        const verdict = typeof p.verdict === 'string' ? p.verdict : undefined;
        cur.trace.push({
          kind: 'reflection',
          ts,
          text: text ?? (verdict ? `[verdict: ${verdict}]` : undefined),
        });
      } else {
        cur.trace.push({
          kind: 'error',
          ts,
          error: typeof p.message === 'string' ? p.message : undefined,
        });
      }
      cur.trace.sort((a, b) => a.ts - b.ts);
    } else if (type === 'cost:tick') {
      const stage = typeof p.stage === 'string' ? p.stage : undefined;
      const deltaTokens = typeof p.deltaTokens === 'number' ? p.deltaTokens : 0;
      const deltaCostUsd =
        typeof p.deltaCostUsd === 'number' ? p.deltaCostUsd : 0;
      summedDeltaTokens += Math.max(0, deltaTokens);
      summedDeltaCost += Math.max(0, deltaCostUsd);
      totalTokens = Math.max(
        totalTokens,
        typeof p.tokensUsed === 'number' ? p.tokensUsed : 0,
        summedDeltaTokens
      );
      totalCost = Math.max(
        totalCost,
        typeof p.costUsd === 'number' ? p.costUsd : 0,
        summedDeltaCost
      );
      if (stage && (deltaTokens > 0 || deltaCostUsd > 0)) {
        const prev = costByStage.get(stage) ?? { tokensUsed: 0, costUsd: 0 };
        costByStage.set(stage, {
          tokensUsed: prev.tokensUsed + deltaTokens,
          costUsd: prev.costUsd + deltaCostUsd,
        });
      }
    } else if (type === 'mission:completed') {
      status = 'completed';
      completedAt = ev.timestamp;
    } else if (type === 'mission:failed') {
      status = 'failed';
      failedAt = ev.timestamp;
      failedMessage = typeof p.message === 'string' ? p.message : undefined;
    } else if (type === 'mission:aborted') {
      status = 'cancelled';
      cancelledAt = ev.timestamp;
    }
  }

  const stages = [...stageMap.values()];
  const done = stages.filter((s) => s.status === 'done').length;

  const roleMap = new Map<string, SocialRoleView>();
  for (const s of stages) {
    if (!s.role) continue;
    const role = roleMap.get(s.role) ?? {
      role: s.role,
      label: ROLE_LABEL[s.role] ?? s.role,
      status: 'idle' as SocialRoleStatus,
    };
    if (s.status === 'failed') role.status = 'failed';
    else if (s.status === 'running' && role.status !== 'failed')
      role.status = 'working';
    else if (s.status === 'done' && role.status === 'idle')
      role.status = 'done';
    roleMap.set(s.role, role);
  }

  // agent phase 兜底：后端 social 暂未发 agent:lifecycle（唯一真缺口，W3 补）。
  // 缺 lifecycle 时用「该角色的阶段状态」推断 phase，并用 trace 首末 ts 估 wallTime，
  // 让卡片/左栏立刻有真实状态，不必等后端。
  const agentList = [...agents.values()];
  for (const a of agentList) {
    if (a.phase === 'pending') {
      const roleStatus = roleMap.get(a.role)?.status;
      if (roleStatus === 'failed') a.phase = 'failed';
      else if (roleStatus === 'working') a.phase = 'running';
      else if (roleStatus === 'done') a.phase = 'completed';
    }
    if (a.trace.length > 0) {
      const first = a.trace[0].ts;
      const last = a.trace[a.trace.length - 1].ts;
      a.startedAt = a.startedAt ?? first;
      if (
        a.wallTimeMs == null &&
        (a.phase === 'completed' || a.phase === 'failed')
      ) {
        a.wallTimeMs = Math.max(0, Math.round(last - first));
      }
    }
  }

  // 把 agent 的 running/failed 状态回写角色（agent 信号比 stage 更精确）
  for (const a of agentList) {
    const rv = roleMap.get(a.role);
    if (!rv) continue;
    const fromAgent = roleStatusFromPhase(a.phase);
    if (fromAgent === 'failed') rv.status = 'failed';
    else if (fromAgent === 'working' && rv.status !== 'failed')
      rv.status = 'working';
  }

  const view: SocialMissionView = {
    status,
    startedAt,
    completedAt,
    failedAt,
    failedMessage,
    cancelledAt,
    progress: { done, total: stages.length },
    stages,
    roles: [...roleMap.values()],
    agents: agentList,
    cost: {
      tokensUsed: totalTokens,
      costUsd: totalCost,
      byStage: [...costByStage.entries()].map(([stage, v]) => ({
        stage,
        tokensUsed: v.tokensUsed,
        costUsd: v.costUsd,
      })),
    },
  };

  return persisted ? mergeSocialPersisted(view, persisted) : view;
}

/**
 * 历史兜底：mission 结束、实时事件 buffer 过期后，用持久化快照回填算力 + 终态 + 阶段骨架。
 * - 实时视图仍有数据（status !== 'idle'）：只把算力取较大值补上，状态以实时为准（实时优先）。
 * - 实时视图空（events 已过期）：用快照合成终态；completed 时把预置阶段/角色标为 done，
 *   让结束后的「任务列表 / 算力 / 协作动态」仍能看到历史骨架。
 * 注：逐条 thought/action 时间线无法还原（仅内存 1h），故只到阶段级骨架。
 */
function mergeSocialPersisted(
  view: SocialMissionView,
  snap: SocialMissionSnapshot
): SocialMissionView {
  const completedTs = snap.completedAt
    ? new Date(snap.completedAt).getTime()
    : undefined;

  // 算力取较大值（防快照旧于实时双计）
  const cost: SocialCostView = {
    ...view.cost,
    tokensUsed: Math.max(view.cost.tokensUsed, snap.tokensUsed),
    costUsd: Math.max(view.cost.costUsd, snap.costUsd),
  };

  // 实时视图有内容 → 只补算力，其余以实时为准
  if (view.status !== 'idle') {
    return { ...view, cost };
  }

  const isCompleted = snap.status === 'completed';
  const isFailed = snap.status === 'failed';
  const isCancelled = snap.status === 'cancelled' || snap.status === 'aborted';

  // completed 历史：预置阶段/角色全部标记 done（mission 已成功收尾）
  const stages = isCompleted
    ? view.stages.map((s) => ({ ...s, status: 'done' as const }))
    : view.stages;
  const roles = isCompleted
    ? view.roles.map((r) => ({ ...r, status: 'done' as const }))
    : view.roles;
  const done = stages.filter((s) => s.status === 'done').length;

  return {
    ...view,
    status: isCompleted
      ? 'completed'
      : isFailed
        ? 'failed'
        : isCancelled
          ? 'cancelled'
          : view.status,
    completedAt: isCompleted ? completedTs : view.completedAt,
    failedAt: isFailed ? completedTs : view.failedAt,
    failedMessage: isFailed
      ? (snap.errorMessage ?? view.failedMessage)
      : view.failedMessage,
    cancelledAt: isCancelled ? completedTs : view.cancelledAt,
    progress: { done, total: stages.length },
    stages,
    roles,
    cost,
  };
}

/** 取某社媒角色的 agent（一般一个角色一个 agent；多个时取最近活跃的） */
export function socialAgentByRole(
  view: SocialMissionView,
  role: string
): SocialAgentState | undefined {
  const matched = view.agents.filter((a) => a.role === role);
  if (matched.length === 0) return undefined;
  return matched.reduce((best, a) =>
    (a.endedAt ?? a.startedAt ?? 0) > (best.endedAt ?? best.startedAt ?? 0)
      ? a
      : best
  );
}

/** 取某 agent 最近一条思考文本（供卡片「最近思考」展示） */
export function latestThought(
  agent: SocialAgentState | undefined
): string | undefined {
  if (!agent) return undefined;
  for (let i = agent.trace.length - 1; i >= 0; i--) {
    const t = agent.trace[i];
    if (t.kind === 'thought' && t.text) return t.text;
  }
  return undefined;
}

/** social 角色 → 中文标签（兼容 Pascal id 与后端 kebab role，如 composer/Composer 均可） */
export function socialRoleLabel(role: string): string {
  const pascal = normalizeRole(role);
  return ROLE_LABEL[pascal] ?? pascal;
}

/** 取某 agent 用过的工具清单（去重，供卡片「工具」chips） */
export function agentTools(agent: SocialAgentState | undefined): string[] {
  if (!agent) return [];
  const seen = new Set<string>();
  for (const t of agent.trace) {
    if (t.kind === 'action' && t.toolId) seen.add(t.toolId);
  }
  return [...seen];
}
