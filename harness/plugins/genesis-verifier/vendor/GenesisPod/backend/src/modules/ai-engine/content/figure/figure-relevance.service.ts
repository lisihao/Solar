/**
 * Figure Relevance Service（ai-engine/content/figure —— figure pipeline Stage 3）
 *
 * ★ v17.0 方案：Embedding 语义相关性过滤（替代早期 Vision LLM 方案）
 *
 * 问题根因（Vision 方案）：
 * - 每张图 8s fetch + 30s Vision LLM = 最坏 38s；80 张图约 50 分钟
 * - CDN 封锁（中国 CDN / 签名 CDN）导致 Vision 无法访问图片 URL
 * - Rate limit / 超时连锁（多维度并发 × 多 batch × 重试）
 *
 * Embedding 方案：
 * ① type = chart/table/diagram → 直接保留（0 次 API 调用）
 * ② type = photo, caption.trim().length < minCaptionLength → 直接拒绝（无有效描述）
 * ③ type = photo, caption 有效 → cosine(embed(caption), embed(topicTitle)) >= 阈值 → 保留
 * ④ Embedding 失败 → type-based fallback（chart 保留，photo caption 达标保留）
 *
 * 性能：80 张图 ~50 分钟 → ~1 分钟（embedding 批量并发，无图片下载）
 * 多语言：text-embedding-3-small 跨语言语义对齐（中英文 caption vs 英文 topicTitle）
 *
 * 归位说明（figure re-home, 2026-06-09）：
 *   从 ai-app/insight/services/report 与 ai-harness/evaluation/figure 迁入 engine。
 *   engine 层零 agent/mission 状态、零 app/harness 依赖——仅依赖同层 EmbeddingService
 *   （ai-engine/rag/embedding），符合「embedding 相关性判断属 content 通用能力」定位。
 *   阈值/参数化经构造函数注入（FigureRelevanceConfig），不同消费方可按场景调参。
 */
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { EmbeddingService } from "@/modules/ai-engine/rag/embedding";
import type { ExtractedFigure } from "./figure-extractor.service";
import {
  FIGURE_RELEVANCE_CONFIG,
  resolveFigureRelevanceConfig,
  type FigureRelevanceConfig,
  type ResolvedFigureRelevanceConfig,
} from "./figure-relevance.config";

/** 信息性图片类型：chart/table/diagram 直接保留，无需 Embedding 判断 */
const INFORMATIONAL_FIGURE_TYPES = new Set(["chart", "table", "diagram"]);

/** caption embedding 截断长度（控制单条 token 成本，超出部分对语义贡献有限） */
const CAPTION_EMBED_MAX_CHARS = 300;

/** Cosine 相似度计算（本地纯函数，无外部依赖） */
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
  /** 解析后的阈值/参数（构造期一次性 resolve，运行期只读）。 */
  private readonly config: ResolvedFigureRelevanceConfig;

  constructor(
    private readonly embeddingService: EmbeddingService,
    // 可选注入：消费方按场景覆盖阈值（policy 类放宽 / tech 类收紧）。
    // 不注入时走 resolveFigureRelevanceConfig 默认值（与原 insight/harness 实证值一致）。
    @Optional()
    @Inject(FIGURE_RELEVANCE_CONFIG)
    config?: FigureRelevanceConfig,
  ) {
    this.config = resolveFigureRelevanceConfig(config);
  }

  /**
   * 对候选图片列表进行 Embedding 相关性过滤（figure pipeline Stage 3）。
   *
   * @param figures - 经过验证/升级后的候选图片（ExtractedFigure[]）
   * @param topicTitle - 研究主题/维度标题（用于语义相似度对比）
   * @returns 通过相关性审查的图片子集（顺序保持）
   */
  async filterRelevantFigures(
    figures: ExtractedFigure[],
    topicTitle: string,
  ): Promise<ExtractedFigure[]> {
    if (figures.length === 0) return [];

    const { cosineThreshold, minCaptionLength } = this.config;

    // batch 化：从 N 次单 caption embedding 改为 1 次 batch（topic + 所有有效 caption）。
    //   原 80 张图 → 80+1 次 HTTP；现 80 张图 → 1 次 HTTP（底层自动分批）。
    //   失败时只触发 1 次 ERROR；并发压力大幅降低。
    type EvalEntry = {
      fig: ExtractedFigure;
      // null = 不需要 embedding（informational / 无有效 caption）。
      caption: string | null;
    };
    const entries: EvalEntry[] = figures.map((fig) => {
      if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) {
        return { fig, caption: null };
      }
      const caption = (fig.caption ?? fig.alt ?? "").trim();
      if (caption.length < minCaptionLength) return { fig, caption: null };
      return { fig, caption: caption.substring(0, CAPTION_EMBED_MAX_CHARS) };
    });
    const captionsToEmbed = entries
      .filter((e): e is EvalEntry & { caption: string } => e.caption !== null)
      .map((e) => e.caption);

    let topicEmb: number[] | null = null;
    const captionEmbMap = new Map<string, number[]>();
    // 没有 photo 需要 embed 时（全 informational / 全无 caption）不调 batch API
    // （topic embedding 无 caption 对比就无意义）。
    if (captionsToEmbed.length > 0) {
      const batchInput = [topicTitle, ...captionsToEmbed];
      try {
        const batchResult = await this.embeddingService.generateEmbeddings(
          batchInput,
          {
            taskType: "similarity",
          },
        );
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
        // 整 batch 失败（401 / 网络 / circuit-open）—— 全走 type-based fallback。
        this.logger.warn(
          `[filterRelevantFigures] batch embedding failed for ${figures.length} figures, ` +
            `falling back to type-based: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }
    }

    const evalResults = entries.map(({ fig, caption }) => {
      // ① 信息性类型直接保留。
      if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) {
        return { fig, accepted: true };
      }
      // ② photo 无有效 caption → 直接拒绝。
      if (caption === null) {
        return { fig, accepted: false };
      }
      // ③ 有效 caption + topic/caption embedding 都拿到（且非空向量）→ cosine 判断。
      const captionEmb = captionEmbMap.get(caption);
      if (
        topicEmb &&
        topicEmb.length > 0 &&
        captionEmb &&
        captionEmb.length > 0
      ) {
        const sim = cosine(topicEmb, captionEmb);
        const accepted = sim >= cosineThreshold;
        if (!accepted) {
          this.logger.debug(
            `[filterRelevantFigures] Rejected (cosine=${sim.toFixed(3)} < ${cosineThreshold}): caption="${caption.substring(0, 60)}"`,
          );
        }
        return { fig, accepted };
      }
      // ④ embedding 不可用 → type-based fallback（caption 已 >= minCaptionLength 是有效描述）。
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
   * Embedding 失败时的 type-based fallback（photo 需 caption >= minCaptionLength）。
   */
  private typeBasedFallback(fig: ExtractedFigure): boolean {
    if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) return true;
    if (fig.type === "photo") {
      const caption = (fig.caption ?? fig.alt ?? "").trim();
      return caption.length >= this.config.minCaptionLength;
    }
    return false;
  }
}
