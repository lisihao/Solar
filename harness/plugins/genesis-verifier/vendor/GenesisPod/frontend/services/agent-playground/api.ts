/**
 * Agent Playground API client
 *
 * 后端走全局 ResponseTransformInterceptor，响应被包成
 *   { success: true, data: {...原始返回...}, metadata: {...} }
 * 所有调用必须 unwrapStandard() 取出 .data
 */

import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import type { MissionGraphArtifact, NodeEnrichment } from './graph-types';

const API_BASE = `${config.apiBaseUrl}/api/v1/playground`;

export type BudgetProfile = 'low' | 'medium' | 'high' | 'unlimited';
export type StyleProfile =
  | 'academic'
  | 'executive'
  | 'journalistic'
  | 'technical';
export type LengthProfile =
  | 'brief'
  | 'standard'
  | 'deep'
  | 'extended'
  | 'epic'
  | 'mega';
export type AudienceProfile = 'executive' | 'domain-expert' | 'general-public';
export type AuditLayers = 'minimal' | 'default' | 'thorough' | 'thorough+';
export type ViewMode = 'continuous' | 'chapter' | 'quick';
export type SearchTimeRange = '30d' | '90d' | '180d' | '365d' | '730d' | 'all';

export interface RunMissionInput {
  topic: string;
  /** 选填长文本描述：背景 / 关注角度 / 约束 / 排除项，传给 Leader 全 4 phase prompt */
  description?: string;
  depth: 'quick' | 'standard' | 'deep';
  language: 'zh-CN' | 'en-US';
  /** 推荐使用 budgetProfile（4 档），maxCredits 为 deprecated 兼容字段 */
  budgetProfile?: BudgetProfile;
  /** 文风（默认 executive） */
  styleProfile?: StyleProfile;
  /** 长度（默认 standard ≈ 8K 字） */
  lengthProfile?: LengthProfile;
  /** 受众（默认 domain-expert） */
  audienceProfile?: AudienceProfile;
  /** 图文并茂（默认 true） */
  withFigures?: boolean;
  /** 审核层级（默认 default = L0+L3） */
  auditLayers?: AuditLayers;
  /** Researcher 并行度（默认 3） */
  concurrency?: number;
  /** 默认进入哪个视图 */
  viewMode?: ViewMode;
  /** 搜索资料时的时间范围约束 */
  searchTimeRange?: SearchTimeRange;
  /**
   * ★ 2026-05-22 单一数据源：mission 级 credits 上限改为**可选覆盖**。
   * 缺省时后端按 depth（调研规模档位）解析（DEPTH_BUDGET_TIERS）；仅「高级·自定义预算」时传。
   * 1 credit ≈ 1k tokens。
   */
  maxCredits?: number;
  /** ★ 2026-05-22 单一源：agent budget 倍率可选覆盖，缺省按 depth 档位解析。 */
  budgetMultiplierOverride?: number;
  /** 用户自定义 mission 总时长 cap（毫秒）覆盖。不传则按 depth 档位解析。范围 60s ~ 3h。 */
  wallTimeCapMs?: number;
  /**
   * 本地知识库 ID 列表（最多 10 个）。
   * researcher 调 rag-search 时会限定在这些 KB 内做语义召回。
   * 不传 / 空数组 → researcher 跳过 rag-search 走纯 web-search。
   */
  knowledgeBaseIds?: string[];
}

export interface RunMissionResponse {
  missionId: string;
  streamNamespace: string;
}

export interface ReplayEvent {
  type: string;
  payload: unknown;
  agentId?: string;
  traceId?: string;
  timestamp: number;
}

export interface ReplayResponse {
  events: ReplayEvent[];
  serverNow: number;
}

/**
 * 兼容拆包：标准 { success, data, metadata } 优先取 data；
 * 没有 wrapping 时直接用原始对象。
 */
function unwrapStandard<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const wrapper = raw as { success?: boolean; data?: unknown };
    if (wrapper.data && typeof wrapper.data === 'object') {
      return wrapper.data as T;
    }
  }
  return raw as T;
}

export async function runTeam(
  input: RunMissionInput
): Promise<RunMissionResponse> {
  const res = await fetch(`${API_BASE}/team/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = text.length > 200 ? text.slice(0, 200) + '…' : text;
    throw new Error(`Failed to start mission: ${res.status} ${detail}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error('Failed to start mission: invalid JSON response');
  }
  const data = unwrapStandard<{ missionId?: unknown }>(raw);
  const missionId = data.missionId;
  if (typeof missionId !== 'string' || missionId.length === 0) {
    throw new Error('Failed to start mission: missionId missing in response');
  }
  return data as RunMissionResponse;
}

export interface MissionListItem {
  id: string;
  topic: string;
  /** quick / standard / deep（后端可能扩展，故用 string） */
  depth: string;
  language: string;
  /** running / completed / failed / rejected（后端可能扩展，故用 string） */
  status: string;
  startedAt: string;
  completedAt: string | null;
  // ★ C4/G5：实测耗时(原 wallTimeMs,与配置上限二义→改名,对齐后端 MissionListItem)。
  elapsedWallTimeMs: number | null;
  finalScore: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  reportTitle: string | null;
  reportSummary: string | null;
  errorMessage: string | null;
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC';
}

export interface MissionDetail extends MissionListItem {
  // 2026-05-13: backend GET 返回的预算 row 字段（mission-store.service.ts:1447），
  // 前端 Mission 设置弹窗读真值（不再退回 userProfile JSON fallback）。
  maxCredits: number | null;
  themeSummary: string | null;
  dimensions: { id: string; name: string; rationale: string }[] | null;
  reportFull: {
    title?: string;
    summary?: string;
    sections?: { heading: string; body: string; sources?: string[] }[];
    conclusion?: string;
    citations?: string[];
  } | null;
  verdicts:
    | {
        verifierId: string;
        score: number;
        critique?: string;
        attempt?: number;
      }[]
    | null;
  trajectoryStored: number | null;
  /** ★ Phase Lead-1+: Leader-Replanner-Lite 字段 */
  leaderJournal?: {
    plan?: {
      themeSummary?: string;
      dimensionsCount?: number;
      goals?: {
        successCriteria: string[];
        qualityBar: {
          minSources: number;
          minCoverage: number;
          hardConstraints: string[];
        };
        deliverables: string[];
      };
      initialRisks?: {
        type: string;
        severity: 'low' | 'medium' | 'high';
        mitigation: string;
      }[];
    };
    foreword?: {
      whatWeAnswered: {
        criterion: string;
        addressed: 'yes' | 'partial' | 'no';
        evidence: string;
      }[];
      whatRemainsUnclear: string[];
      howToRead: string;
      recommendedFollowUp: string[];
      generatedAt?: string;
    };
    /** Leader 跨 milestone 决策记录（M0/M1/M6 累积） */
    decisions?: {
      phase: 'plan' | 'assess-research' | 'foreword';
      at: string;
      decision: string;
      rationale: string;
    }[];
  } | null;
  leaderOverallScore?: number | null;
  leaderSigned?: boolean | null;
  // ★ R2 共识 P0-NEW (architect, 2026-05-07): leaderVerdict union 必须包含
  //   后端写入的 'auto-rerun-recovered' / 'signed-pass' / 'signed-fail'，
  //   否则 R5b s11-persist rerun 入库的 mission 在前端 union 外失配。
  //   单一源在 lib/types/leader-verdict.ts（镜像 backend types）。
  leaderVerdict?: import('@/lib/types/leader-verdict').LeaderVerdict | null;
}

export async function listMissions(): Promise<MissionListItem[]> {
  const res = await fetch(`${API_BASE}/missions`, {
    headers: { ...getAuthHeader() },
  });
  if (!res.ok) throw new Error(`Failed to list missions: ${res.status}`);
  const raw = await res.json();
  const data = unwrapStandard<{ items?: MissionListItem[] }>(raw);
  return data.items ?? [];
}

// ★ 2026-05-22 ③J/K 契约单一源：调研规模档位 + 预算字段上下限的唯一真源在后端
//   DEPTH_BUDGET_TIERS / BUDGET_FIELD_LIMITS。前端不再手写 SCALE_TIERS 镜像,改 fetch。
export interface BudgetTier {
  depth: 'quick' | 'standard' | 'deep';
  label: string;
  desc: string;
  dimensionsHint: string;
  maxCredits: number;
  budgetMultiplier: number;
  wallTimeMinutes: number;
  capUsd: number;
}
export interface BudgetTiersResponse {
  tiers: BudgetTier[];
  limits: {
    maxCredits: { min: number; max: number };
    budgetMultiplier: { min: number; max: number };
    wallTimeMinutes: { min: number; max: number };
  };
}
export async function fetchBudgetTiers(): Promise<BudgetTiersResponse> {
  const res = await fetch(`${API_BASE}/budget-tiers`, {
    headers: { ...getAuthHeader() },
  });
  if (!res.ok) throw new Error(`Failed to fetch budget tiers: ${res.status}`);
  const raw: unknown = await res.json();
  return unwrapStandard<BudgetTiersResponse>(raw);
}

/**
 * Phase 5 checkpoint：列出"上次中断、可从 checkpoint 增量续跑"的 mission。
 * 数据源：mission row 持久化的 leaderJournal.__checkpoint JSONB key。
 *
 * W1 cutover (2026-05-26) 后 mission detail page 走 canonical view 的
 * mission.resumable；本项目当前仅 mission 列表页可能展示批量"可继续"徽章用此函数。
 */
export interface ResumableMissionItem {
  missionId: string;
  savedAt: string;
  completedKeys: string[];
}

/**
 * @deprecated W1 cutover — mission detail page 已改吃 useMissionDetailView.mission.resumable。
 *             仅保留供 mission 列表批量"可继续"徽章使用；新代码不应再调。
 */
export async function listResumableMissions(): Promise<ResumableMissionItem[]> {
  const res = await fetch(`${API_BASE}/missions/resumable`, {
    headers: { ...getAuthHeader() },
  });
  if (!res.ok) {
    throw new Error(`Failed to list resumable missions: ${res.status}`);
  }
  const raw: unknown = await res.json();
  const data = unwrapStandard<{ items?: ResumableMissionItem[] }>(raw);
  return Array.isArray(data.items) ? data.items : [];
}

/**
 * @deprecated W1 cutover — mission detail page 已改吃 getMissionDetailView (canonical view)。
 *             仅作 sibling 兼容路由（plan §6.9 disposition table）；新代码不应再调。
 */
export async function getMissionDetail(id: string): Promise<MissionDetail> {
  const res = await fetch(`${API_BASE}/missions/${encodeURIComponent(id)}`, {
    headers: { ...getAuthHeader() },
  });
  if (!res.ok) throw new Error(`Failed to fetch mission: ${res.status}`);
  const raw = await res.json();
  const data = unwrapStandard<{ mission?: MissionDetail }>(raw);
  if (!data.mission) throw new Error('Mission not found');
  return data.mission;
}

// ============================================================================
// B4-1: canonical mission detail view
// ============================================================================
//
// thinning plan §B2-3 / §B4-1。view endpoint 是 single-track mission truth 来源；
// 上面的 getMissionDetail 仍为 sibling 兼容路由（plan §6.9 disposition table），
// 不重新定义 view 已暴露字段（plan §3.1 scope clarification）。
//
// 注意：响应 envelope 形状是 { view }（与 { mission } 区分以避免 sibling-route 字段冲突）。

/**
 * MissionDetailView —— mirror backend canonical PlaygroundDomainView 形状（轻量化镜像）。
 *
 * 此处显式 mirror 而非从 backend types 反向 import：mirror 是 thinning 方向，
 * 后端是 canonical source；前端独立的 type 在 B4-3/B4-4 完成后才可视作 type-level
 * 单一源（届时 derive.ts 中的 type 别名应改为 import 自此模块或 backend contract）。
 *
 * §6.7 RefreshHint shape 必须与 backend contract 严格一致。
 */
export type MissionViewStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'quality-failed';
export type ViewStageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';
export type ViewAgentPhase = 'pending' | 'running' | 'completed' | 'failed';
export type ViewRefreshFamily =
  | 'mission'
  | 'stages'
  | 'agents'
  | 'artifact'
  | 'todo'
  | 'cost'
  | 'memory';
export interface ViewRefreshHint {
  family: ViewRefreshFamily;
  mode: 'refetch' | 'patch';
  id?: string;
}

export interface MissionDetailView {
  mission: {
    id: string;
    title?: string;
    topic?: string;
    depth?: string;
    language?: string;
    maxCredits?: number;
    wallTimeMs?: number;
    themeSummary?: string;
    dimensions?: { id: string; name: string; rationale?: string }[];
    leaderJournal?: unknown;
    leaderOverallScore?: number | null;
    leaderSigned?: boolean | null;
    leaderVerdict?: string | null;
    terminalOutcome?: string | null;
    failureCode?: string | null;
    reportArtifactVersion?: number | null;
    /** W1 cutover：取代 page.tsx 的旧 persisted.userProfile 兜底。 */
    userProfile?: unknown;
    /** W1 cutover：取代 page.tsx 的旧 persisted.reconciliationReport 兜底。 */
    reconciliationReport?: unknown;
    status: MissionViewStatus;
    startedAt?: string;
    finishedAt?: string;
    finalScore?: number;
    failureMessage?: string;
    resumable: boolean;
    canCancel: boolean;
    rerunnableStages: { id: string; allowed: boolean; reason?: string }[];
  };
  stages: {
    id: string;
    label: string;
    status: ViewStageStatus;
    startedAt?: string;
    endedAt?: string;
    detail?: string;
    attempts?: number;
    /** T75: backend-derived per-stage process surface（optional；legacy / no-LLM
     *  stages omit it）. */
    processTrace?: {
      inputs?: { label: string; value: string | number }[];
      llmCalls?: {
        modelId?: string;
        tokensIn?: number;
        tokensOut?: number;
        durationMs?: number;
        costUsd?: number;
      }[];
      outputPeek?: Record<string, number | string>;
      reactTrace?: {
        kind: 'thought' | 'action' | 'observation' | 'reflection' | 'error';
        ts: number;
        text?: string;
        toolId?: string;
        output?: string;
        latencyMs?: number;
        tokensUsed?: number;
        error?: string;
      }[];
      totalTokens?: number;
      totalDurationMs?: number;
      stepCount?: number;
    };
  }[];
  agents: {
    id: string;
    role: string;
    phase: ViewAgentPhase;
    modelId?: string;
    retryCount?: number;
    failureMessage?: string;
  }[];
  /** ReportArtifactV2 形状 | EmptyArtifactSentinel；前端 type guard 用 'kind' 字段。 */
  reportArtifact?: unknown;
  /** TodoBoardSentinel；前端识别 kind 决定渲染。 */
  todoBoard?: unknown;
  cost?: {
    tokensUsed?: string | null;
    costUsd?: number | null;
    elapsedWallTimeMs?: number | null;
    trajectoryStored?: number | null;
    currency: 'USD';
  };
  memory?: { kind: 'empty-memory' | 'memory'; payload?: unknown };
  timelineVersion: number;
  snapshotVersion: number;
  refreshHints?: ViewRefreshHint[];
  /** P0-A: verifier verdicts (取代 shim 内 events 派生)。 */
  verdicts?: {
    verifierId: string;
    score: number;
    critique?: string;
    criteria?: Record<string, number>;
    modelId?: string;
    attempt?: number;
  }[];
  /** P0-A: memory index 状态。 */
  memoryIndex?: { chunks: number; namespace?: string; tags?: string[] } | null;
  /** P0-A: dimension pipeline 状态（chapter / grade 等）。 */
  dimensionPipelines?: Record<string, unknown>;
  references: unknown[];
  reportVersions: {
    version: number;
    versionLabel: string | null;
    reportTitle: string | null;
    reportSummary: string | null;
    finalScore: number | null;
    leaderSigned: boolean | null;
    triggerType: string;
    generatedAt: string;
  }[];
}

/**
 * GET /missions/:id/view — canonical detail view。thinning plan §B2-3 / §B4-1。
 */
export async function getMissionDetailView(
  id: string,
  opts?: { signal?: AbortSignal }
): Promise<MissionDetailView> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(id)}/view`,
    {
      headers: { ...getAuthHeader() },
      signal: opts?.signal,
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch mission view: ${res.status}`);
  }
  const raw = await res.json();
  const data = unwrapStandard<{ view?: MissionDetailView }>(raw);
  if (!data.view) throw new Error('Mission view not found');
  return data.view;
}

export type LeaderDecisionType =
  | 'DIRECT_ANSWER'
  | 'CREATE_TODO'
  | 'CLARIFY'
  | 'ACKNOWLEDGE';

export interface LeaderDecision {
  type: LeaderDecisionType;
  understanding?: string;
  todo?: { name: string; rationale: string }[];
  clarifyOptions?: string[];
}

export interface LeaderChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tokensUsed: number | null;
  createdAt: string;
  decision?: LeaderDecision | null;
}

export interface LeaderChatSendResponse {
  user: LeaderChatMessage;
  assistant: LeaderChatMessage;
  appendedDimensionIds?: string[];
}

export interface RerunTodoInput {
  origin: string;
  scope: 'dimension' | 'chapter' | 'review' | 'system' | 'mission';
  dimensionRef?: string;
  chapterIndex?: number;
  todoTitle?: string;
  reasonText?: string;
  /**
   * v1.2 PR-R7：后端 stepId（PLAYGROUND_PIPELINE.steps[i].id）。
   * 优先级 > scope/todoId — 后端按 stepId 直接路由 + cascade 链。
   * 前端从 todo.systemStageId 经 FRONTEND_STAGE_TO_STEP_ID 映射得到。
   */
  stepId?: string;
}

/**
 * 单 todo 重跑 v1 —— 后端创建新 mission，沿用原 input + 注入 focusHint。
 * 前端跳转到新 missionId 即可。
 */
export async function rerunTodo(
  missionId: string,
  todoId: string,
  body: RerunTodoInput
): Promise<{ missionId: string; streamNamespace: string }> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/todos/${encodeURIComponent(todoId)}/rerun`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Rerun todo failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{ missionId: string; streamNamespace: string }>(raw);
}

/**
 * 单 todo 局部重跑 v1（B 路线）—— 复用原 missionId，单 stage 重跑 + patch 回原 mission。
 *
 * v1 仅支持 system:s9b（10 维客观评审重跑）。
 * 后端会根据 todo 信息判断 scope，不支持的 scope 抛 BadRequest。
 *
 * 与 rerunTodo 区别：
 *   rerunTodo     → 创建新 mission（前端跳转新 missionId）
 *   localRerunTodo → 不创建新 mission，原 missionId 保留，stage 产物 patch 进 DB
 *
 * 前端调用后应 listen mission:rerun-completed 事件 → re-fetch 原 missionDetail
 */
export async function localRerunTodo(
  missionId: string,
  todoId: string,
  body: RerunTodoInput
): Promise<{
  ok: true;
  missionId: string;
  scope: string;
  durationMs: number;
  /** v1.2 PR-R7：cascade 路径下报告完成情况（无 stepId 时不返） */
  cascade?: {
    completed: string[];
    abortedAt?: string;
    remaining?: string[];
  };
}> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/todos/${encodeURIComponent(todoId)}/local-rerun`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Local rerun failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{
    ok: true;
    missionId: string;
    scope: string;
    durationMs: number;
    cascade?: {
      completed: string[];
      abortedAt?: string;
      remaining?: string[];
    };
  }>(raw);
}

/**
 * 重跑 mission。
 * mode='fresh'       清 checkpoint，全新从头跑（"开始"按钮）
 * mode='incremental' clone checkpoint，跳过已完成 stage（"更新"按钮，
 *                    对齐 Topic Insight handleContinueResearch 模式）
 * 不传 mode 时后端默认 incremental（向后兼容）。
 */
export async function rerunMission(
  missionId: string,
  mode?: 'fresh' | 'incremental'
): Promise<{ missionId: string; streamNamespace: string }> {
  const url = mode
    ? `${API_BASE}/missions/${encodeURIComponent(missionId)}/rerun?mode=${mode}`
    : `${API_BASE}/missions/${encodeURIComponent(missionId)}/rerun`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...getAuthHeader() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Rerun failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{ missionId: string; streamNamespace: string }>(raw);
}

export async function deleteMission(missionId: string): Promise<{ ok: true }> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}`,
    {
      method: 'DELETE',
      headers: { ...getAuthHeader() },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Delete failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{ ok: true }>(raw);
}

/**
 * 一键清理当前用户"已结束失败类" mission（failed / quality-failed / cancelled）。
 * 状态白名单由服务端硬编码（不删 running / completed）。返回删除条数。
 */
export async function cleanupMissions(): Promise<{ deleted: number }> {
  const res = await fetch(`${API_BASE}/missions/cleanup`, {
    method: 'POST',
    headers: { ...getAuthHeader() },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cleanup failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{ deleted: number }>(raw);
}

export async function updateMission(
  missionId: string,
  // 2026-05-13: 扩展支持预算字段（非运行状态可改，下次重跑生效）
  data: {
    topic?: string;
    maxCredits?: number;
    budgetMultiplierOverride?: number;
    wallTimeCapMs?: number;
  }
): Promise<{ ok: true }> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Update failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{ ok: true }>(raw);
}

export async function setVisibility(
  missionId: string,
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
): Promise<{ id: string; visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC' }> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/visibility`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify({ visibility }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Set visibility failed: ${res.status} ${text.slice(0, 200)}`
    );
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{
    id: string;
    visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC';
  }>(raw);
}

export async function cancelMission(
  missionId: string
): Promise<{ ok: true; status: string }> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/cancel`,
    {
      method: 'POST',
      headers: { ...getAuthHeader() },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cancel failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const raw: unknown = await res.json();
  return unwrapStandard<{ ok: true; status: string }>(raw);
}

export async function listLeaderChat(
  missionId: string
): Promise<LeaderChatMessage[]> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/leader-chat`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) throw new Error(`Failed to load leader chat: ${res.status}`);
  const raw: unknown = await res.json();
  const data = unwrapStandard<{ messages?: LeaderChatMessage[] }>(raw);
  return data.messages ?? [];
}

export async function sendLeaderChat(
  missionId: string,
  content: string
): Promise<LeaderChatSendResponse> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/leader-chat`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to send to leader: ${res.status} ${text.slice(0, 200)}`
    );
  }
  const raw: unknown = await res.json();
  return unwrapStandard<LeaderChatSendResponse>(raw);
}

export async function replayMission(
  missionId: string,
  sinceTs?: number
): Promise<ReplayResponse> {
  // 字符串拼接，不要 new URL —— 本地开发 apiBaseUrl 是空字符串走 Next rewrites
  const qs =
    sinceTs != null ? `?since=${encodeURIComponent(String(sinceTs))}` : '';
  const res = await fetch(
    `${API_BASE}/replay/${encodeURIComponent(missionId)}${qs}`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) {
    throw new Error(`Failed to replay mission: ${res.status}`);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error('Failed to replay mission: invalid JSON response');
  }
  const data = unwrapStandard<{ events?: unknown; serverNow?: number }>(raw);
  if (!Array.isArray(data.events)) {
    throw new Error('Failed to replay mission: events array missing');
  }
  return data as ReplayResponse;
}

// ── ★ 报告版本化 (2026-05-06) ────────────────────────────────────────────

export interface ReportVersionListItem {
  version: number;
  versionLabel: string | null;
  reportTitle: string | null;
  reportSummary: string | null;
  finalScore: number | null;
  leaderSigned: boolean | null;
  triggerType: string;
  generatedAt: string;
}

export interface ReportVersionDetail {
  version: number;
  versionLabel: string | null;
  triggerType: string;
  generatedAt: string;
  reportFull: unknown;
  changesFromPrev: unknown;
}

/** 列出 mission 所有报告版本（不含 reportFull）。空数组表示首次跑还没 rerun。 */
export async function listReportVersions(
  missionId: string
): Promise<ReportVersionListItem[]> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/report-versions`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) {
    throw new Error(`Failed to list report versions: ${res.status}`);
  }
  const raw: unknown = await res.json();
  const data = unwrapStandard<{ items?: unknown }>(raw);
  return Array.isArray(data.items)
    ? (data.items as ReportVersionListItem[])
    : [];
}

/** 拉指定版本完整 reportFull（用于切换 ArtifactReader 的 artifact prop）。 */
export async function getReportVersion(
  missionId: string,
  version: number
): Promise<ReportVersionDetail> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/report-versions/${version}`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to load report version v${version}: ${res.status} ${text.slice(0, 200)}`
    );
  }
  const raw: unknown = await res.json();
  return unwrapStandard<ReportVersionDetail>(raw);
}

// ===== Mission DAG (2026-05-26 后端定义、前端呈现) =====

export type MissionDagNodeStatus =
  | 'idle'
  | 'running'
  | 'done'
  | 'failed'
  | 'degraded'
  | 'cancelled';

export type MissionDagNodeKind =
  | 'macro'
  | 'research-dim'
  | 'writer'
  | 'reviewer'
  | 'persist';

export type MissionDagLayoutHint = 'spine' | 'fan' | 'split';

export interface MissionDagNode {
  id: string;
  kind: MissionDagNodeKind;
  label: string;
  sub?: string;
  status: MissionDagNodeStatus;
  iter?: number;
  rerunable: boolean;
  rerunableReason?: string;
  score?: number;
  layout: MissionDagLayoutHint;
  dimensionRef?: string;
  parentStepId?: string;
}

export type MissionDagEdgeKind = 'flow' | 'fan' | 'rewrite-loop' | 'self-loop';

export interface MissionDagEdge {
  from: string;
  to: string;
  kind: MissionDagEdgeKind;
}

export interface MissionDagGraph {
  missionId: string;
  mission: { status: string; topic: string; finalScore: number | null };
  nodes: MissionDagNode[];
  edges: MissionDagEdge[];
}

export interface MissionDagCascadePreview {
  origin: string;
  willRerun: string[];
  kept: string[];
  rerunable: boolean;
  reason?: string;
}

export async function fetchMissionDag(
  missionId: string
): Promise<MissionDagGraph> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/dag`,
    {
      headers: { ...getAuthHeader() },
    }
  );
  if (!res.ok) throw new Error(`fetchMissionDag failed: ${res.status}`);
  const raw: unknown = await res.json();
  return unwrapStandard<MissionDagGraph>(raw);
}

export async function fetchMissionDagCascade(
  missionId: string,
  fromNodeId: string
): Promise<MissionDagCascadePreview> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/dag/cascade?from=${encodeURIComponent(fromNodeId)}`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) throw new Error(`fetchMissionDagCascade failed: ${res.status}`);
  const raw: unknown = await res.json();
  return unwrapStandard<MissionDagCascadePreview>(raw);
}

// ===== Mission Knowledge Graph (2026-06-07) =====

/**
 * GET /missions/:id/graph — 拉取已生成的图谱分析结果。
 * 若从未生成，返回 { status: 'NONE', graph: null, analyses: null, generatedAt: null }。
 */
export async function getMissionGraph(
  id: string
): Promise<MissionGraphArtifact> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(id)}/graph`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to fetch mission graph: ${res.status} ${text.slice(0, 200)}`
    );
  }
  const raw: unknown = await res.json();
  return unwrapStandard<MissionGraphArtifact>(raw);
}

/**
 * POST /missions/:id/graph — 触发图谱分析构建（同步，完成后返回 READY 结果）。
 */
export async function buildMissionGraph(
  id: string
): Promise<MissionGraphArtifact> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(id)}/graph`,
    {
      method: 'POST',
      headers: { ...getAuthHeader() },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to build mission graph: ${res.status} ${text.slice(0, 200)}`
    );
  }
  const raw: unknown = await res.json();
  return unwrapStandard<MissionGraphArtifact>(raw);
}

export async function enrichGraphNode(
  missionId: string,
  nodeId: string
): Promise<NodeEnrichment> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(
      missionId
    )}/graph/node/${encodeURIComponent(nodeId)}/enrich`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to enrich graph node: ${res.status} ${text.slice(0, 200)}`
    );
  }
  const raw: unknown = await res.json();
  return unwrapStandard<NodeEnrichment>(raw);
}

// ===== Phase 2: ReAct 内部循环快照 =====

export type MissionDagReactCurrentStep =
  | 'idle'
  | 'thinking'
  | 'tool'
  | 'observing'
  | 'finalizing'
  | 'completed'
  | 'failed';

export interface MissionDagReactSnapshot {
  nodeId: string;
  role: string;
  dimension?: string;
  agentId?: string;
  currentStep: MissionDagReactCurrentStep;
  iter?: number;
  maxIter?: number;
  lastThought?: string;
  lastAction?: { kind: string; toolName?: string };
  lastObservation?: { kind: string };
  finalizeAttempts: number;
  lastError?: string;
  phase: 'pending' | 'running' | 'completed' | 'failed';
  note?: string;
}

export async function fetchMissionDagReact(
  missionId: string,
  nodeId: string
): Promise<MissionDagReactSnapshot> {
  const res = await fetch(
    `${API_BASE}/missions/${encodeURIComponent(missionId)}/dag/react/${encodeURIComponent(nodeId)}`,
    { headers: { ...getAuthHeader() } }
  );
  if (!res.ok) throw new Error(`fetchMissionDagReact failed: ${res.status}`);
  const raw: unknown = await res.json();
  return unwrapStandard<MissionDagReactSnapshot>(raw);
}
