/**
 * Figure Relevance Service
 *
 * ★ v17.0 彻底替换 Vision LLM → Embedding 方案
 *
 * 问题根因（Vision 方案）：
 * - 每张图 8s fetch + 30s Vision LLM = 最坏 38s；80 张图约 50 分钟
 * - CDN 封锁（中国 CDN / 签名 CDN）导致 Vision 无法访问图片 URL
 * - Rate limit / 超时连锁（8 维度并发 × 多 batch × 3 次重试）
 * - Vision 过保守（v9）或过宽（v10）：难以调优
 *
 * 新方案（Embedding）：
 * ① type = chart/table/diagram → 直接保留（0 次 API 调用）
 * ② type = photo, caption.trim().length < 10 → 直接拒绝（无有效描述）
 * ③ type = photo, caption 有效 → cosine(embed(caption), embed(topicTitle)) >= 0.35 → 保留
 * ④ Embedding 失败 → type-based fallback（chart 保留，photo caption >= 10 字符保留）
 *
 * 性能提升：80 张图 ~50 分钟 → ~1 分钟（embedding 批量并发，无图片下载）
 * 多语言支持：text-embedding-3-small 跨语言语义对齐（中英文 caption vs 英文 topicTitle）
 */

import { Injectable, Logger } from "@nestjs/common";
import { AIFacade } from "@/modules/ai-harness/facade";
import type { ExtractedFigure } from "../../types/research.types";

/** 信息性图片类型：chart/table/diagram 直接保留，无需 Embedding 判断 */
const INFORMATIONAL_FIGURE_TYPES = new Set(["chart", "table", "diagram"]);

/** Stage 2 全局相关性阈值：photo caption 与研究主题的 cosine 相似度下限 */
const STAGE2_COSINE_THRESHOLD = 0.35;

/** photo 有效 caption 最小长度（< 10 字符视为无描述，直接拒绝） */
const MIN_CAPTION_LENGTH = 10;

/** Cosine 相似度计算 */
function cosine(a: number[], b: number[]): number {
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA === 0 || magB === 0
    ? 0
    : dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

@Injectable()
export class FigureRelevanceService {
  private readonly logger = new Logger(FigureRelevanceService.name);

  constructor(private readonly engineFacade: AIFacade) {}

  /**
   * 对候选图片列表进行 Embedding 相关性过滤（替代原 Vision LLM 方案）
   *
   * @param figures - 经过 validateAndUpgradeFigures 后的候选图片
   * @param topicTitle - 研究主题标题（用于语义相似度对比）
   * @returns 通过审查的图片子集
   */
  async filterRelevantFigures(
    figures: ExtractedFigure[],
    topicTitle: string,
  ): Promise<ExtractedFigure[]> {
    if (figures.length === 0) return [];

    // ★ 2026-05-05 batch 化优化：从 N 次 embeddingGenerate(单 caption) 改为
    //   1 次 embeddingGenerateBatch([topicTitle, ...captions])。
    //   原 80 张图 → 80+1 次 HTTP；现 80 张图 → 1 次 HTTP（底层自动分批 100/req）。
    //   benefit: roundtrip × 80 减少；401 时只触发 1 次 ERROR + auth-circuit-break；
    //   并发压力大幅降低；prompt cache 友好。
    //
    //   收集 photo + 有效 caption（其它类型不需 embedding）：
    type EvalEntry = {
      fig: ExtractedFigure;
      caption: string | null; // null = 不需要 embedding（直接 informational/empty）
    };
    const entries: EvalEntry[] = figures.map((fig) => {
      if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) return { fig, caption: null };
      const caption = (fig.caption ?? fig.alt ?? "").trim();
      if (caption.length < MIN_CAPTION_LENGTH) return { fig, caption: null };
      return { fig, caption: caption.substring(0, 300) };
    });
    const captionsToEmbed = entries
      .filter((e): e is EvalEntry & { caption: string } => e.caption !== null)
      .map((e) => e.caption);

    let topicEmb: number[] | null = null;
    const captionEmbMap = new Map<string, number[]>();
    // ★ 优化：没有 photo 需要 embed 时（全 informational / 全无 caption）
    //   不调 batch API（topic embedding 无 caption 对比就无意义）
    if (captionsToEmbed.length > 0) {
      const batchInput = [topicTitle, ...captionsToEmbed];
      try {
        const batchResult =
          await this.engineFacade.embeddingGenerateBatch(batchInput);
        if (
          batchResult &&
          batchResult.embeddings.length === batchInput.length
        ) {
          topicEmb = batchResult.embeddings[0] ?? null;
          for (let i = 0; i < captionsToEmbed.length; i++) {
            const emb = batchResult.embeddings[i + 1];
            if (emb) captionEmbMap.set(captionsToEmbed[i], emb);
          }
        }
      } catch (error) {
        // 整 batch 失败（401 / 网络 / circuit-open）—— 全 fallback type-based
        this.logger.warn(
          `[filterRelevantFigures] batch embedding failed for ${figures.length} figures, ` +
            `falling back to type-based: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const evalResults = entries.map(({ fig, caption }) => {
      // ① 信息性类型直接保留
      if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) {
        return { fig, accepted: true };
      }
      // ② photo 无有效 caption → 直接拒绝
      if (caption === null) {
        return { fig, accepted: false };
      }
      // ③ 有效 caption + topic+caption embedding 都拿到（且非空 vector）→ cosine 判断
      const captionEmb = captionEmbMap.get(caption);
      if (topicEmb && topicEmb.length > 0 && captionEmb && captionEmb.length > 0) {
        const sim = cosine(topicEmb, captionEmb);
        const accepted = sim >= STAGE2_COSINE_THRESHOLD;
        if (!accepted) {
          this.logger.debug(
            `[filterRelevantFigures] Rejected (cosine=${sim.toFixed(3)} < ${STAGE2_COSINE_THRESHOLD}): caption="${caption.substring(0, 60)}"`,
          );
        }
        return { fig, accepted };
      }
      // ④ embedding 不可用 → fail-open（caption 已 >= 10 chars 是有效描述）
      return { fig, accepted: this.typeBasedFallback(fig) };
    });

    const allAccepted = evalResults.filter((r) => r.accepted).map((r) => r.fig);
    const rejected = evalResults.filter((r) => !r.accepted);

    if (rejected.length > 0) {
      this.logger.log(
        `[filterRelevantFigures] Rejected ${rejected.length}/${figures.length} figures for "${topicTitle}":\n` +
          rejected
            .map(
              (r) =>
                `  ${r.fig.type} | caption="${(r.fig.caption ?? "").substring(0, 60)}" | ${r.fig.imageUrl.substring(0, 60)}...`,
            )
            .join("\n"),
      );
    }

    this.logger.log(
      `[filterRelevantFigures] Accepted ${allAccepted.length}/${figures.length} figures for "${topicTitle}" (embedding v17)`,
    );

    return allAccepted;
  }

  /**
   * Embedding 失败时的 type-based fallback（B2 修复：photo 需要 caption >= 10 chars）
   *
   * ★ 2026-05-05: 老的 evaluateSingleByEmbedding 已删 — 改为 batch 模式
   *   (filterRelevantFigures 内 1 次 embeddingGenerateBatch + 本地 cosine 计算)。
   */
  private typeBasedFallback(fig: ExtractedFigure): boolean {
    if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) return true;
    if (fig.type === "photo") {
      const caption = (fig.caption ?? fig.alt ?? "").trim();
      return caption.length >= MIN_CAPTION_LENGTH;
    }
    return false;
  }
}
