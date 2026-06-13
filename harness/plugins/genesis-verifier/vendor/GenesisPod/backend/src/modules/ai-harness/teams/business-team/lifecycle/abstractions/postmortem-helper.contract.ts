/**
 * BusinessAgentTeam — Mission Postmortem Helper contract (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-postmortem.helper.ts
 *
 * 抽出 postmortem 通用记录 / 召回机制：
 *   - embedding fail-soft（缺 service 或 embed 失败 → 空向量，降级 tag-only）
 *   - vector memory store create
 *   - S12 race: 最近 mission（<5min completedAt）若 postmortem 还没落库 → 等 3s 轮询
 */

/** 业务方 record 时输入（generic — research / social 字段不同）。 */
export interface PostmortemRecordBase {
  readonly missionId: string;
  readonly userId: string;
  readonly topic: string;
  readonly summary: string;
  readonly leaderSigned: boolean | null;
}

/** Framework 返回的 list item base（业务方扩展自己字段）。 */
export interface PostmortemListBase {
  readonly missionId: string;
  readonly topic: string;
  readonly summary: string;
  readonly leaderSigned: boolean | null;
  readonly createdAt: Date;
}

/** Embedding port —— framework 通过 Optional 注入。 */
export interface PostmortemEmbeddingPort {
  generateEmbedding(text: string): Promise<{ embedding: number[] } | null>;
}

/**
 * 业务方提供的 postmortem helper hooks。
 *
 * 机制：embedding fail-soft / vector memory create / S12 catch-up race。
 * 业务字段：vector memory namespace / source / tags / metadata 决策。
 */
export interface PostmortemHelperHooks<
  TRecordInput extends PostmortemRecordBase,
  TListItem extends PostmortemListBase,
> {
  /** Embedding service（可缺，缺失则 tag-only 召回）。 */
  readonly embeddingPort?: PostmortemEmbeddingPort;
  /** Vector memory store create（业务方决定 namespace / source / tags / metadata）。 */
  readonly createVectorMemory: (args: {
    readonly input: TRecordInput;
    readonly embedding: number[];
  }) => Promise<void>;
  /** 查询最近 (<5min) mission 是否存在 + 拿 missionId（S12 race check）。 */
  readonly findRecentMissionId: (userId: string) => Promise<string | null>;
  /**
   * List recent N 条 postmortem 行。
   *
   * @param queryEmbedding 可选。若提供则按 cosine 相似度召回（语义 recall）；
   *                        缺省则按 createdAt 倒序（recency 召回）。
   */
  readonly listVectorMemories: (
    userId: string,
    limit: number,
    queryEmbedding?: readonly number[],
  ) => Promise<readonly TListItem[]>;
  /** Logger namespace。 */
  readonly loggerNamespace: string;
}
