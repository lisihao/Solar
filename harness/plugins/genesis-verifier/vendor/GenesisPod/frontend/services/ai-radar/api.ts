/**
 * AI Radar API client
 *
 * 后端走全局 ResponseTransformInterceptor → { success, data, metadata }，
 * 通过 unwrapStandard 取 .data。
 */

import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import type {
  CancelRunResponse,
  CreateRadarSourceInput,
  CreateRadarTopicInput,
  RadarInsight,
  RadarItem,
  RadarRun,
  RadarSource,
  RadarSourceType,
  RadarTopic,
  RadarTopicStatus,
  RadarTopicWithCounts,
  RecommendedSource,
  TriggerRefreshResponse,
  UpdateRadarTopicInput,
} from './types';

const API_BASE = `${config.apiBaseUrl}/api/v1/radar`;

function unwrapStandard<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const wrapper = raw as { success?: boolean; data?: unknown };
    if (wrapper.data !== undefined) {
      return wrapper.data as T;
    }
  }
  return raw as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = text.length > 300 ? `${text.slice(0, 300)}…` : text;
    } catch {
      // ignore
    }
    throw new Error(`Radar API ${res.status}: ${detail || res.statusText}`);
  }
  const raw = (await res.json()) as unknown;
  return unwrapStandard<T>(raw);
}

// ── B7-3: canonical mission detail view ──────────────────
//
// thinning plan §B7-2 / §B7-3 / §B2-3 sibling-route semantics。
// 与 playground 的 MissionDetailView mirror，radar 后端 RadarDomainView 暴露。

export type RadarViewStatus =
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'quality-failed';

export type RadarViewStageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export type RadarViewAgentPhase =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export type RadarViewRefreshFamily =
  | 'mission'
  | 'stages'
  | 'agents'
  | 'artifact'
  | 'todo'
  | 'cost'
  | 'memory';

export interface RadarViewRefreshHint {
  family: RadarViewRefreshFamily;
  mode: 'refetch' | 'patch';
  id?: string;
}

export interface RadarRunDetailView {
  mission: {
    id: string;
    title?: string;
    status: RadarViewStatus;
    startedAt?: string;
    finishedAt?: string;
    finalScore?: number;
    failureMessage?: string;
    resumable: boolean;
    canCancel: boolean;
    rerunnableStages: { id: string; allowed: boolean; reason?: string }[];
    topicId?: string;
    trigger?: 'MANUAL' | 'SCHEDULED' | 'BOOTSTRAP';
    durationMs?: number | null;
    wallTimeCapMs?: number | null;
    maxCredits?: number;
    failureCode?: string | null;
    terminalOutcome?: string | null;
    metricsSummary?: {
      fetched?: number;
      accepted?: number;
      llmCost?: number;
    };
  };
  stages: {
    id: string;
    label: string;
    status: RadarViewStageStatus;
    startedAt?: string;
    endedAt?: string;
    detail?: string;
    attempts?: number;
  }[];
  agents: {
    id: string;
    role: string;
    phase: RadarViewAgentPhase;
    modelId?: string;
    retryCount?: number;
    failureMessage?: string;
  }[];
  /** RadarBriefingRef | EmptyArtifactSentinel — type guard via `kind` or `date` field. */
  reportArtifact?: unknown;
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
  refreshHints?: RadarViewRefreshHint[];
}

/**
 * GET /radar/runs/:runId/view — canonical detail view（thinning plan §B7-2 / §B7-3）。
 *
 * 与 getRun sibling 兼容并存：getRun 仍返回 RadarRun row；view endpoint 返回
 * single-track truth envelope。
 */
export async function getRadarRunDetailView(
  runId: string,
  opts?: { signal?: AbortSignal }
): Promise<RadarRunDetailView> {
  const res = await fetch(
    `${API_BASE}/runs/${encodeURIComponent(runId)}/view`,
    {
      headers: { ...getAuthHeader() },
      signal: opts?.signal,
    }
  );
  if (!res.ok) {
    throw new Error(`Radar API ${res.status}: ${res.statusText}`);
  }
  const raw = (await res.json()) as unknown;
  const data = unwrapStandard<{ view?: RadarRunDetailView }>(raw);
  if (!data.view) throw new Error('Radar run view not found');
  return data.view;
}

// ── Run 实时事件流回放（对齐 playground /replay）──────────

export interface RadarStreamEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface RadarReplayResponse {
  events: RadarStreamEvent[];
  serverNow: number;
}

/**
 * GET /radar/replay/:runId?since=ts —— 从后端 RadarMissionEventBuffer 读累积事件。
 * 前端 useRadarStream：进页面 hydrate + WS 失败 polling 兜底。
 */
export async function replayRadarRun(
  runId: string,
  sinceTs?: number
): Promise<RadarReplayResponse> {
  const qs =
    sinceTs != null ? `?since=${encodeURIComponent(String(sinceTs))}` : '';
  return request<RadarReplayResponse>(
    `/replay/${encodeURIComponent(runId)}${qs}`
  );
}

// ── Topic ─────────────────────────────────────────────

export async function listTopics(
  opts: {
    status?: RadarTopicStatus;
    limit?: number;
    cursor?: string;
    q?: string;
  } = {}
): Promise<{ items: RadarTopicWithCounts[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set('status', opts.status);
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.q && opts.q.trim()) qs.set('q', opts.q.trim());
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<{ items: RadarTopicWithCounts[]; nextCursor: string | null }>(
    `/topics${suffix}`
  );
}

export async function getTopic(id: string): Promise<RadarTopicWithCounts> {
  return request<RadarTopicWithCounts>(`/topics/${id}`);
}

export async function createTopic(
  input: CreateRadarTopicInput
): Promise<RadarTopic> {
  return request<RadarTopic>('/topics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateTopic(
  id: string,
  input: UpdateRadarTopicInput
): Promise<RadarTopic> {
  return request<RadarTopic>(`/topics/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteTopic(id: string): Promise<void> {
  await request<{ deleted: true }>(`/topics/${id}`, { method: 'DELETE' });
}

export async function setVisibility(
  id: string,
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC'
): Promise<RadarTopic> {
  return request<RadarTopic>(`/topics/${id}/visibility`, {
    method: 'PATCH',
    body: JSON.stringify({ visibility }),
  });
}

/**
 * 自动刷新开关 —— 复用后端 status：
 *   ACTIVE  = 自动刷新开（进 scheduler 每分钟扫描范围）
 *   PAUSED  = 自动刷新关（不被 sweep；仍可手动「重新精选」）
 * 新建 topic 默认 PAUSED，用户在卡片上显式开启。
 */
export async function resumeTopic(id: string): Promise<RadarTopic> {
  return request<RadarTopic>(`/topics/${id}/resume`, { method: 'POST' });
}

export async function pauseTopic(id: string): Promise<RadarTopic> {
  return request<RadarTopic>(`/topics/${id}/pause`, { method: 'POST' });
}

// ── Source ────────────────────────────────────────────

export async function listSources(topicId: string): Promise<RadarSource[]> {
  return request<RadarSource[]>(`/topics/${topicId}/sources`);
}

export async function createSource(
  topicId: string,
  input: CreateRadarSourceInput
): Promise<RadarSource> {
  return request<RadarSource>(`/topics/${topicId}/sources`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Backend UpdateRadarSourceDto 只允许改 label / config / enabled；
 * type / identifier 改了会被 ValidationPipe whitelist strip。
 */
export interface UpdateRadarSourceInput {
  label?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export async function updateSource(
  sourceId: string,
  input: UpdateRadarSourceInput
): Promise<RadarSource> {
  return request<RadarSource>(`/sources/${sourceId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteSource(sourceId: string): Promise<void> {
  await request<{ deleted: true }>(`/sources/${sourceId}`, {
    method: 'DELETE',
  });
}

export interface RecommendSourcesResult {
  /** preflight 已验证可达的候选 */
  candidates: RecommendedSource[];
  /** R7 2026-05-19：preflight 阶段过滤掉的不可达源 + 原因 */
  skipped: Array<{ type: string; identifier: string; reason: string }>;
  /** LLM 原始召回总数 = candidates.length + skipped.length */
  totalGenerated: number;
}

export async function recommendSources(
  topicId: string,
  perTypeLimit?: number
): Promise<RecommendSourcesResult> {
  // R7 2026-05-19：backend 在推荐阶段就 preflight，前端不再"接受后才发现 5/6 失败"。
  // skipped + totalGenerated 用于 UI 展示"AI 推荐 N 个，已过滤 M 个不可达"。
  return request<RecommendSourcesResult>(
    `/topics/${topicId}/sources/recommend`,
    {
      method: 'POST',
      body: JSON.stringify(perTypeLimit ? { perTypeLimit } : {}),
    }
  );
}

export interface AcceptRecommendedSourcesResult {
  created: RadarSource[];
  /** preflight 后剔除的源（不可达 / 死链 / shape 错），前端可提示用户 */
  skipped: Array<{ type: string; identifier: string; reason: string }>;
}

export async function acceptRecommendedSources(
  topicId: string,
  candidates: RecommendedSource[]
): Promise<AcceptRecommendedSourcesResult> {
  // 2026-05-18：backend accept 路径加 preflight（CollectorRouter.fanOut 真发
  // 一次拉取），LLM hallucinate 的死链 / 解析失败的 @handle 不再入库，返回
  // { created, skipped } 让前端展示"接受 N，过滤 M 个不可达"。
  return request<AcceptRecommendedSourcesResult>(
    `/topics/${topicId}/sources/recommend/accept`,
    {
      method: 'POST',
      body: JSON.stringify({ candidates }),
    }
  );
}

// ── Feed ──────────────────────────────────────────────

export async function listFeed(
  topicId: string,
  opts: {
    type?: RadarSourceType;
    since?: string;
    minRelevance?: number;
    acceptedOnly?: boolean;
    limit?: number;
    cursor?: string;
  } = {}
): Promise<{ items: RadarItem[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (opts.type) qs.set('type', opts.type);
  if (opts.since) qs.set('since', opts.since);
  if (opts.minRelevance != null)
    qs.set('minRelevance', String(opts.minRelevance));
  if (opts.acceptedOnly) qs.set('acceptedOnly', 'true');
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.cursor) qs.set('cursor', opts.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<{ items: RadarItem[]; nextCursor: string | null }>(
    `/topics/${topicId}/feed${suffix}`
  );
}

// ── Insight ───────────────────────────────────────────

export async function listInsights(
  topicId: string,
  limit?: number
): Promise<RadarInsight[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return request<RadarInsight[]>(`/topics/${topicId}/insights${qs}`);
}

export async function getLatestInsight(
  topicId: string
): Promise<{ insight: RadarInsight | null }> {
  return request<{ insight: RadarInsight | null }>(
    `/topics/${topicId}/insights/latest`
  );
}

// ── Run ───────────────────────────────────────────────

export async function listRuns(
  topicId: string,
  limit?: number
): Promise<RadarRun[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return request<RadarRun[]>(`/topics/${topicId}/runs${qs}`);
}

/** 单 run 详情（mission 详情页用） */
export async function getRun(runId: string): Promise<RadarRun> {
  return request<RadarRun>(`/runs/${runId}`);
}

export async function triggerRefresh(
  topicId: string
): Promise<TriggerRefreshResponse> {
  return request<TriggerRefreshResponse>(`/topics/${topicId}/refresh`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function cancelRun(runId: string): Promise<CancelRunResponse> {
  return request<CancelRunResponse>(`/runs/${runId}/cancel`, {
    method: 'POST',
  });
}
