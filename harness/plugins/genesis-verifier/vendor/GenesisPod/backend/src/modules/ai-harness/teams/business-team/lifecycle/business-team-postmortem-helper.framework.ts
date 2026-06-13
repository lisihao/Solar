/**
 * BusinessAgentTeam — Mission Postmortem Helper Framework (P6 Wave 1, 2026-05-24)
 *
 * @migrated-from ai-app/playground/services/mission/lifecycle/mission-postmortem.helper.ts
 *
 * 抽出 postmortem 通用机制：
 *   - embedding fail-soft (缺 service 或 embed 失败 → 空向量，降级 tag-only)
 *   - S12 catch-up race (最近 mission <5min, postmortem 未落库 → 等 3s 轮询)
 *
 * 业务方注入：
 *   - vector memory namespace / source / tags / metadata 决策
 *   - 业务专属 list item shape (含业务字段)
 */

import { Logger } from "@nestjs/common";
import type {
  PostmortemHelperHooks,
  PostmortemListBase,
  PostmortemRecordBase,
} from "./abstractions/postmortem-helper.contract";

const RECENT_MISSION_WINDOW_MS = 5 * 60_000;
const S12_RACE_TIMEOUT_MS = 3000;
const S12_RACE_POLL_INTERVAL_MS = 300;

export abstract class BusinessTeamPostmortemHelperFramework<
  TRecordInput extends PostmortemRecordBase,
  TListItem extends PostmortemListBase,
> {
  protected readonly log: Logger;

  constructor(
    protected readonly postmortemHooks: PostmortemHelperHooks<
      TRecordInput,
      TListItem
    >,
  ) {
    this.log = new Logger(postmortemHooks.loggerNamespace);
  }

  /**
   * 记录 postmortem 到 vector memory。Embedding fail-soft（失败降级 tag-only）。
   */
  async recordMissionPostmortem(input: TRecordInput): Promise<void> {
    let embedding: number[] = [];
    if (this.postmortemHooks.embeddingPort) {
      try {
        const text = `${input.topic}\n\n${input.summary}`.slice(0, 2000);
        const result =
          await this.postmortemHooks.embeddingPort.generateEmbedding(text);
        if (Array.isArray(result?.embedding)) {
          embedding = result.embedding;
        }
      } catch (err: unknown) {
        this.log.warn(
          `[recordMissionPostmortem userId=${input.userId}] embedding failed (degrade to tag-only recall): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    try {
      await this.postmortemHooks.createVectorMemory({ input, embedding });
    } catch (err: unknown) {
      this.log.warn(
        `recordMissionPostmortem failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * List 最近 N 条 postmortem，带 S12 race catch-up：
   *   若最近 <5min mission 的 postmortem 还没落库 → 等 3s 轮询。
   *
   * @param queryText 可选。提供时尝试生成 embedding → 语义相似度召回（cosine）；
   *                  缺省或 embedder 不可用或 embedding 失败 → 回退 recency 倒序。
   *                  既有消费方不传 queryText 则行为不变（向后兼容）。
   */
  async listRecentPostmortems(
    userId: string,
    limit = 3,
    queryText?: string,
  ): Promise<readonly TListItem[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 10);

    // ── 语义 embedding（可选，fail-soft 降级 recency）────────────────────────
    let queryEmbedding: readonly number[] | undefined;
    if (queryText && this.postmortemHooks.embeddingPort) {
      try {
        const result =
          await this.postmortemHooks.embeddingPort.generateEmbedding(
            queryText.slice(0, 2000),
          );
        if (Array.isArray(result?.embedding) && result.embedding.length > 0) {
          queryEmbedding = result.embedding;
        }
      } catch (err: unknown) {
        this.log.warn(
          `[listRecentPostmortems userId=${userId}] embedding failed (degrade to recency): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const recentMissionId = await this.postmortemHooks
      .findRecentMissionId(userId)
      .catch((err: unknown) => {
        this.log.warn(
          `[listRecentPostmortems userId=${userId}] findRecentMissionId failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      });

    let rows = await this.fetchPostmortems(userId, safeLimit, queryEmbedding);

    if (recentMissionId) {
      const containsRecent = (list: readonly TListItem[]): boolean =>
        list.some((r) => r.missionId === recentMissionId);
      if (!containsRecent(rows)) {
        const deadline = Date.now() + S12_RACE_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await new Promise<void>((r) =>
            setTimeout(r, S12_RACE_POLL_INTERVAL_MS),
          );
          rows = await this.fetchPostmortems(userId, safeLimit, queryEmbedding);
          if (containsRecent(rows)) {
            this.log.debug(
              `[listRecentPostmortems ${userId}] S12 caught up for mission ${recentMissionId}`,
            );
            break;
          }
        }
      }
    }
    return rows;
  }

  private async fetchPostmortems(
    userId: string,
    limit: number,
    queryEmbedding?: readonly number[],
  ): Promise<readonly TListItem[]> {
    return this.postmortemHooks
      .listVectorMemories(userId, limit, queryEmbedding)
      .catch((err: unknown) => {
        this.log.warn(
          `[listRecentPostmortems userId=${userId}] listVectorMemories failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return [] as readonly TListItem[];
      });
  }

  /** Re-export window constants（业务子类可读）。 */
  protected static readonly RECENT_MISSION_WINDOW_MS = RECENT_MISSION_WINDOW_MS;
}
