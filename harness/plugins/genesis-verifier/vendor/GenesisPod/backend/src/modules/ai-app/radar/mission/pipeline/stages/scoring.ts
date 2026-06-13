/**
 * S9 daily-top-n Stage A — 单条独立打分（B1 任务）
 *
 * 来源：docs/architecture/ai-app/radar/daily-briefing-redesign-2026-05-18.md
 *   §7B.1 算法概览 / §7B.2 评分公式 v1
 *
 * 2026-05-18 v1 weights — 改权重必须写 ADR + reviewer 共识（决策 H6）
 *
 * 5 个分量权重：
 *   0.35 * relevance   (S4 LLM 输出，归一到 0-1)
 *   0.25 * quality     (S5 LLM 输出，归一到 0-1)
 *   0.15 * authority   (source.authorityWeight 1-5 → 0.2-1.0)
 *   0.15 * freshness   (半衰期 24h)
 *   0.10 * engagement  (log scale)
 *
 * filter score > 0.55 → top 20 candidate pool 进入 Stage B（LLM 编辑）
 */

import type { RadarSource } from "@prisma/client";

/** 权重表（修改必须写 ADR） */
export const STAGE_A_WEIGHTS = {
  relevance: 0.35,
  quality: 0.25,
  authority: 0.15,
  freshness: 0.15,
  engagement: 0.1,
} as const;

/** Stage A 过滤阈值 + candidate pool 上限（决策 H7） */
export const STAGE_A_SCORE_THRESHOLD = 0.55;
export const STAGE_A_CANDIDATE_POOL_MAX = 20;

/** Stage A 输入：item + 它所属 source + LLM 已算分 */
export interface StageAInput {
  item: { id: string; publishedAt: Date; metrics: unknown };
  source: Pick<RadarSource, "id" | "authorityWeight">;
  /** S4 LLM 输出 relevance（0-100）；未跑 → undefined → 0 */
  relevanceScore?: number;
  /** S5 LLM 输出 quality（0-100）；未跑 → undefined → 0 */
  qualityScore?: number;
}

/** Stage A 输出：归一化综合分 + 各分量（observability + ADR 调权重时复盘） */
export interface StageAResult {
  itemId: string;
  sourceId: string;
  score: number;
  components: {
    relevance: number;
    quality: number;
    authority: number;
    freshness: number;
    engagement: number;
  };
}

/**
 * 综合分公式（B1 核心）
 *
 * S4/S5 LLM 输出范围 0-100 → 归一到 0-1（除 100）
 * 其余分量直接 0-1
 */
export function computeStageAScore(input: StageAInput): StageAResult {
  const relevance = clamp01((input.relevanceScore ?? 0) / 100);
  const quality = clamp01((input.qualityScore ?? 0) / 100);
  const authority = computeAuthority(input.source.authorityWeight);
  const freshness = computeFreshness(input.item.publishedAt);
  const engagement = computeEngagement(input.item.metrics);

  const score =
    STAGE_A_WEIGHTS.relevance * relevance +
    STAGE_A_WEIGHTS.quality * quality +
    STAGE_A_WEIGHTS.authority * authority +
    STAGE_A_WEIGHTS.freshness * freshness +
    STAGE_A_WEIGHTS.engagement * engagement;

  return {
    itemId: input.item.id,
    sourceId: input.source.id,
    score: clamp01(score),
    components: { relevance, quality, authority, freshness, engagement },
  };
}

/** 1-5 星 → 0.2-1.0 线性映射，越界保守 0.2 */
export function computeAuthority(weight: number | null | undefined): number {
  const w =
    typeof weight === "number" && weight >= 1 && weight <= 5 ? weight : 1;
  return clamp01(w / 5);
}

/** 时效半衰期 24h：当下 1.0；24h 后 0.5；48h 后 0.25；7 天 → ~0.008 */
export function computeFreshness(publishedAt: Date | string): number {
  const t = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(t.getTime())) return 0;
  const ageHours = (Date.now() - t.getTime()) / 3_600_000;
  if (ageHours < 0) return 1; // 未来时间 = 最新（容错防 NTP 抖动）
  return clamp01(Math.pow(0.5, ageHours / 24));
}

/**
 * Engagement log scale
 *
 * views 0 → 0
 * 100 views → ~0.1
 * 1k → ~0.3
 * 10k → ~0.5
 * 100k → ~0.7
 * 1M+ → 1.0
 *
 * metrics 是 JSONB，可能含 views / likes / shares 等。当前只用 views（简化）。
 */
export function computeEngagement(metrics: unknown): number {
  if (!metrics || typeof metrics !== "object") return 0;
  const m = metrics as Record<string, unknown>;
  const views = toFiniteNumber(m.views);
  if (views <= 0) return 0;
  return clamp01(Math.log10(views + 10) / 6);
}

/**
 * 从混合 item 集合产出 Stage A 全分；filter > threshold 后取 top N
 *
 * 调用方：S9 stage 拿到 24h 内 item + sources → 调本函数 → 进 Stage B LLM
 */
export function selectCandidatePool(
  inputs: StageAInput[],
  options?: { threshold?: number; max?: number },
): StageAResult[] {
  const threshold = options?.threshold ?? STAGE_A_SCORE_THRESHOLD;
  const max = options?.max ?? STAGE_A_CANDIDATE_POOL_MAX;
  return inputs
    .map(computeStageAScore)
    .filter((r) => r.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function toFiniteNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
