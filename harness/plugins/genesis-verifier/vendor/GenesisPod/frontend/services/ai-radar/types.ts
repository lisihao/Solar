/**
 * AI Radar 前端类型（mirror 后端 Prisma model + DTO）。
 *
 * 后端枚举 / Prisma model 字段保持 camelCase 对齐，避免前后端转换。
 */

export type RadarTopicStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/**
 * 读侧 union — 含 X 是兼容存量数据 + admin 历史手动加的 X source，
 * UI 仍要能渲染 / 暂停 / 删除。**新建路径走 CreatableRadarSourceType**。
 */
export type RadarSourceType = 'X' | 'YOUTUBE' | 'RSS' | 'CUSTOM';

/**
 * 写侧 union（AddSourceForm / accept AI 推荐 / 后端 DTO）— **禁 X**。
 *
 * 2026-05-17 业务策略：Nitter 全死 + 业界（Feedly/Inoreader）已淡化 X
 * 集成，AI 推荐 + admin 手动加都禁 X。旧 X 源仍可读 / 暂停 / 删除。
 * 后端契约同步：`CreatableRadarSourceTypeDto` enum（dto/create-radar-source.dto.ts）。
 */
export type CreatableRadarSourceType = 'YOUTUBE' | 'RSS' | 'CUSTOM';
export type RadarSourceHealth = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'FAILING';
/**
 * RadarRun.status —— mission lifecycle 标准 5 态（小写）。
 *
 * 后端 Prisma schema (radar_runs.status) 在 2026-05-16 重构后改为 VarChar(20)
 * 走 mission lifecycle 标准值域 'running' | 'completed' | 'failed' | 'cancelled'
 * | 'rejected'，与 agent_playground_missions.status 对齐。前端类型同步小写。
 */
export type RadarRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected';
export type RadarRunTrigger = 'SCHEDULED' | 'MANUAL' | 'FIRST_RUN';

/** 主题对象类型（create topic dto 用） */
export type RadarEntityType =
  | 'person'
  | 'company'
  | 'product'
  | 'event'
  | 'topic';

/**
 * 关键词匹配模式（mirror 后端 RadarTopic.matchMode）：
 * - semantic：仅 LLM 语义评分（默认，历史行为）
 * - literal：标题+正文必须含「任一」关键词（子串、大小写不敏感），否则淘汰
 * - hybrid：字面命中则在 LLM 分上加分，但不淘汰未命中项
 */
export type RadarMatchMode = 'semantic' | 'literal' | 'hybrid';

/** AI 实体抽取出的 entity 类型（backend ExtractedEntity；与 RadarEntityType 不同集合） */
export type RadarItemEntityKind =
  | 'person'
  | 'company'
  | 'product'
  | 'event'
  | 'location'
  | 'other';

export interface RadarTopic {
  id: string;
  userId: string;
  visibility: 'PRIVATE' | 'SHARED' | 'PUBLIC';
  name: string;
  description: string | null;
  entityType: string | null;
  keywords: string[];
  matchMode: RadarMatchMode;
  refreshCron: string;
  status: RadarTopicStatus;
  nextDueAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RadarTopicWithCounts extends RadarTopic {
  counts: { sources: number; items: number; runs: number };
}

export interface RadarSource {
  id: string;
  topicId: string;
  type: RadarSourceType;
  identifier: string;
  label: string | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
  isAiRecommended: boolean;
  health: RadarSourceHealth;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  lastFetchAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RadarItemEntity {
  type: RadarItemEntityKind;
  name: string;
  normalizedName: string;
  confidence: number;
}

export interface RadarItem {
  id: string;
  topicId: string;
  sourceId: string;
  externalId: string;
  contentHash: string;
  title: string | null;
  content: string | null;
  author: string | null;
  authorAvatar: string | null;
  url: string | null;
  publishedAt: string;
  fetchedAt: string;
  relevanceScore: number | null;
  qualityScore: number | null;
  aiSummary: string | null;
  entities: RadarItemEntity[] | null;
  metrics: Record<string, number | string> | null;
  accepted: boolean;
  source?: {
    id: string;
    type: RadarSourceType;
    label: string | null;
    identifier: string;
  };
}

export interface RadarInsightHighlight {
  title: string;
  itemIds: string[];
  type: 'trend' | 'new-entity' | 'anomaly' | 'key-event';
}

export interface RadarInsightSignal {
  kind: string;
  magnitude: number;
  evidence: string;
}

export interface RadarInsightTopEntity {
  type: string;
  name: string;
  mentions: number;
  /** backend fallback 路径可能漏写，UI 读时 ?? 0 兜底 */
  delta?: number;
}

export interface RadarInsight {
  id: string;
  topicId: string;
  runId: string | null;
  periodFrom: string;
  periodTo: string;
  summary: string;
  highlights: RadarInsightHighlight[];
  signals: RadarInsightSignal[];
  topEntities: RadarInsightTopEntity[];
  createdAt: string;
}

/**
 * 单个被淘汰 item 的诊断详情（S8 persist 写入 RadarRun.metrics）。
 *
 * 2026-05-19 R10：用户反馈"数据 1 → 0 丢了但没有任何原因记录"，UI 现在
 * 在 stage drawer 中读这条结构展示"具体哪条 item 因为什么分数被淘汰"。
 */
export interface RadarDroppedItem {
  id: string;
  title: string;
  url: string | null;
  sourceLabel: string;
  relevanceScore: number | null;
  qualityScore: number | null;
  reason: string;
  stage: 'relevance' | 'quality' | 'unknown';
}

export interface RadarRun {
  id: string;
  topicId: string;
  status: RadarRunStatus;
  trigger: RadarRunTrigger;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  /** 最后完成的 stage 编号（1-8）—— mission resume / 进度展示用 */
  lastCompletedStage?: number | null;
  metrics: {
    /** 从 collector 拉到的原始 item 总数 */
    itemsFetched?: number;
    /**
     * S3 dedupe 移除的"历史重复"item 数（rawItems - newItems，
     * **不是**剩余数）。正确剩余 = itemsFetched - itemsDeduped。
     */
    itemsDeduped?: number;
    /**
     * S3 新插入到 RadarItem 表的 item 数（= 去重后剩余）。
     * 注意：插入 ≠ 最终入选。评分 / 质量门槛由 itemsAccepted 反映。
     */
    itemsInserted?: number;
    /** S8 最终通过相关性+质量门槛的 item 数（accepted=true） */
    itemsAccepted?: number;
    sourcesAttempted?: number;
    sourcesFailed?: number;
    sourceErrors?: Array<{ sourceId: string; error: string }>;
    /** R10：S8 写入的阈值快照 */
    thresholds?: {
      relevanceGate: number;
      relevanceMin: number;
      qualityMin: number;
    };
    /** R10：per-stage 流失计数 */
    droppedAtRelevance?: number;
    droppedAtQuality?: number;
    /** R10：被淘汰 item 详情清单（top 20 by relevance desc） */
    droppedItems?: RadarDroppedItem[];
  } | null;
  error: string | null;
  createdAt: string;
}

export interface RecommendedSource {
  type: CreatableRadarSourceType;
  identifier: string;
  label: string;
  rationale: string;
  confidence: number;
}

export interface CreateRadarTopicInput {
  name: string;
  description?: string;
  entityType?: RadarEntityType;
  keywords: string[];
  matchMode?: RadarMatchMode;
  refreshCron?: string;
}

export interface UpdateRadarTopicInput {
  name?: string;
  description?: string;
  entityType?: RadarEntityType;
  keywords?: string[];
  matchMode?: RadarMatchMode;
  refreshCron?: string;
}

export interface CreateRadarSourceInput {
  type: CreatableRadarSourceType;
  identifier: string;
  label?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

/**
 * triggerRefresh 后端响应。Mission pipeline 框架接入后简化：
 * 仅返回 { runId, status }。详细 metrics 由 ws / GET /runs/:topicId 提供。
 *
 * status 必须等同 RadarRunStatus 5 态值域（mission lifecycle 标准），
 * 不能私写 'aborted' 等非法值；后端实际会返回 cancelled / rejected。
 */
export interface TriggerRefreshResponse {
  runId: string;
  status: RadarRunStatus;
}

export interface CancelRunResponse {
  runId: string;
  cancelled: boolean;
}

// 2026-05-17 R3 评审：原 `RefreshRunSummary` 是 @deprecated 旧 sync-mode 类型
// 但全仓 0 consumer (grep import 命中 0)，按 YAGNI 直接删除以减少类型噪音。
// 新刷新链路统一用 TriggerRefreshResponse + ws 推进度。
