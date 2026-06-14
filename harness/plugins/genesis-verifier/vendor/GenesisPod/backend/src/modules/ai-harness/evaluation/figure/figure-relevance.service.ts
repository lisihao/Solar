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

// Sediment from {app} (2026-04-29) — ai-harness/governance/figure/
// 来源: ai-app/{app}/services/report/figure-relevance.service.ts
// TI 仍在使用原 service；本副本由 {app} 等新业务通过 ai-harness/facade 调用。
import { Injectable, Logger } from "@nestjs/common";
// ★ ExtractedFigure 类型从 ai-engine/content/figure 沉淀版本拿（同源 schema，避免双份）
import type { ExtractedFigure } from "@/modules/ai-engine/facade";
// AIFacade 在 ai-harness 同层
import { AIFacade } from "../../facade";

/** 信息性图片类型：chart/table/diagram 直接保留，无需 Embedding 判断 */
const INFORMATIONAL_FIGURE_TYPES = new Set(["chart", "table", "diagram"]);

/**
 * Stage 2 全局相关性阈值：photo caption 与研究主题的 cosine 相似度下限。
 *
 * ★ R-LIVE-3 (2026-04-30): 实证 0.35 对中文政策/法规类 dim 过严（10 张抽样 0
 *   命中），跨语言（中文 caption vs 英文 topicTitle）downstream cosine 普遍
 *   0.25-0.32 区间。降到 0.28 作为"safety net"，让边缘相关图通过；后续可走
 *   分维度阈值（policy/regulation 类放宽到 0.25, tech/product 类保持 0.35）。
 */
const STAGE2_COSINE_THRESHOLD = 0.28;

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

/**
 * 英文 stop words —— embedding 失败时 lexical fallback 用，过滤 caption 实词。
 * 提到模块级常量避免每次 fallback 重新分配。
 */
const FIGURE_LEXICAL_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "by",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "from",
  "into",
  "than",
  "then",
]);

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

    // ★ C1 fix (2026-05-05): 优先 LLM batch judgment，单次 LLM 调用判全部 figure。
    //   原 embedding 路径每张图 1-3 次 OpenAI 调用 → 30 张图 90+ 次请求易触
    //   429 风暴 + circuit-breaker "打 4 + 冷 24s" 循环。LLM batch 1 次即可完成
    //   语义判断，且现有 BYOK chat fallback chain 已有 cross-provider 健康路由。
    //   LLM 失败时再 fall back 到 embedding 路径。
    try {
      const llmResult = await this.filterByLLMBatch(figures, topicTitle);
      if (llmResult) return llmResult;
    } catch (err) {
      this.logger.warn(
        `[filterRelevantFigures] LLM batch failed, falling back to embedding: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // ── Fallback: embedding 路径（原 v17 实现）────────────────────────
    // topicTitle embedding：懒计算 Promise 缓存，整个调用只算一次
    let topicEmbeddingPromise: Promise<number[] | null> | null = null;
    const getTopicEmbedding = (): Promise<number[] | null> => {
      if (topicEmbeddingPromise === null) {
        topicEmbeddingPromise = this.engineFacade
          .embeddingGenerate(topicTitle)
          .then((r) => r?.embedding ?? null)
          .catch(() => null);
      }
      return topicEmbeddingPromise;
    };

    const evalResults = await Promise.all(
      figures.map(async (fig, idx) => {
        try {
          const accepted = await this.evaluateSingleByEmbedding(
            fig,
            getTopicEmbedding,
          );
          return { fig, accepted };
        } catch (error) {
          // Embedding 失败 → type-based fallback
          const accepted = this.typeBasedFallback(fig);
          this.logger.warn(
            `[filterRelevantFigures] [${idx}] ${fig.imageUrl.substring(0, 60)}... ` +
              `embedding failed, fallback=${accepted}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          return { fig, accepted };
        }
      }),
    );

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
   * 单张图片 Embedding 评估
   *
   * ① chart/table/diagram → 直接保留
   * ② photo, caption < 10 chars → 直接拒绝
   * ③ photo, valid caption → cosine(caption, topicTitle) >= 0.35 → 保留
   * ④ Embedding 失败 → typeBasedFallback（抛出错误由上层处理）
   */
  private async evaluateSingleByEmbedding(
    fig: ExtractedFigure,
    getTopicEmbedding: () => Promise<number[] | null>,
  ): Promise<boolean> {
    // ① 信息性图表类型：直接保留，无需语义判断
    if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) {
      return true;
    }

    // ② photo：无有效 caption → 直接拒绝
    const caption = (fig.caption ?? fig.alt ?? "").trim();
    if (caption.length < MIN_CAPTION_LENGTH) {
      this.logger.debug(
        `[evaluateSingleByEmbedding] Rejected (no caption): ${fig.imageUrl.substring(0, 80)}`,
      );
      return false;
    }

    // ③ photo：有效 caption → Embedding 语义相似度判断
    const [topicEmb, captionResult] = await Promise.all([
      getTopicEmbedding(),
      this.engineFacade.embeddingGenerate(caption.substring(0, 300)),
    ]);

    const captionEmb = captionResult?.embedding;
    if (!topicEmb?.length || !captionEmb?.length) {
      // 2026-05-13 P3-#25: 原版 fail-open 全接受 → 嵌入端点 400 风暴时图相关
      //   性把关失效，垃圾图蜂拥进 report。改成"廉价 lexical fallback"：
      //   caption 至少含 2 个去 stop-word 后的实词 → 接受；否则拒绝。
      //   getTopicEmbedding 闭包不暴露 topicTitle 字符串，无法做 topic-caption
      //   重叠匹配，所以只看 caption 自身有无信息量（>= 10 char 已通过上面 ②
      //   闸，但 "I love this" 这种 stop-word 主导仍会让 fig 进 report）。
      //
      // 字符类：[Unicode 字母（含中日韩）+ 数字 + 空白] 以外的字符
      //   （标点 / 符号 / emoji）一律替换成空格当分词符。
      const captionWords = caption
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !FIGURE_LEXICAL_STOP_WORDS.has(w));
      const accept = captionWords.length >= 2;
      this.logger.warn(
        `[evaluateSingleByEmbedding] Embedding unavailable, lexical fallback (accept=${accept}, meaningfulWords=${captionWords.length}): ${fig.imageUrl.substring(0, 80)}`,
      );
      return accept;
    }

    const similarity = cosine(topicEmb, captionEmb);
    const accepted = similarity >= STAGE2_COSINE_THRESHOLD;

    if (!accepted) {
      this.logger.debug(
        `[evaluateSingleByEmbedding] Rejected (cosine=${similarity.toFixed(3)} < ${STAGE2_COSINE_THRESHOLD}): ` +
          `caption="${caption.substring(0, 60)}" | ${fig.imageUrl.substring(0, 60)}`,
      );
    }

    return accepted;
  }

  /**
   * Embedding 失败时的 type-based fallback（B2 修复：photo 需要 caption >= 10 chars）
   */
  private typeBasedFallback(fig: ExtractedFigure): boolean {
    if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) return true;
    if (fig.type === "photo") {
      const caption = (fig.caption ?? fig.alt ?? "").trim();
      return caption.length >= MIN_CAPTION_LENGTH;
    }
    return false;
  }

  /**
   * C1 (2026-05-05): LLM 批量判断 — 单次调用判全部 photo 是否相关。
   *
   * ① chart/table/diagram → 直接保留（不消耗 LLM）
   * ② photo, caption < 10 chars → 直接拒绝
   * ③ 剩余 photo 列出 caption，让 LLM 一次性返回 acceptedIndices: number[]
   *
   * 失败时返回 null，调用方走 embedding 路径兜底。
   */
  private async filterByLLMBatch(
    figures: ExtractedFigure[],
    topicTitle: string,
  ): Promise<ExtractedFigure[] | null> {
    const accepted: ExtractedFigure[] = [];
    const photoCandidates: { idx: number; fig: ExtractedFigure }[] = [];

    figures.forEach((fig, idx) => {
      if (INFORMATIONAL_FIGURE_TYPES.has(fig.type)) {
        accepted.push(fig);
        return;
      }
      if (fig.type === "photo") {
        const caption = (fig.caption ?? fig.alt ?? "").trim();
        if (caption.length < MIN_CAPTION_LENGTH) return; // 拒
        photoCandidates.push({ idx, fig });
      }
    });

    if (photoCandidates.length === 0) return accepted;

    const captionsList = photoCandidates
      .map(
        (c, i) =>
          `${i}. ${(c.fig.caption ?? c.fig.alt ?? "").trim().substring(0, 200)}`,
      )
      .join("\n");

    const userPrompt = [
      `研究主题：${topicTitle}`,
      "",
      "下列是候选图片的 caption 列表（编号 0 起）。请判断哪些图片与研究主题相关、值得保留：",
      "",
      captionsList,
      "",
      '返回 JSON：{ acceptedIndices: <number[]> }，仅列出"应保留"图片的编号；',
      "标准：caption 内容直接或间接支撑主题论证。装饰图、广告图、无关 stock 图都拒绝。",
    ].join("\n");

    try {
      const result = await this.engineFacade.chatStructured<{
        acceptedIndices: number[];
      }>({
        systemPrompt:
          "你是图文相关性审查助手，按主题相关度过滤图片，输出严格 JSON。",
        messages: [{ role: "user", content: userPrompt }],
        schema: {
          type: "object",
          properties: {
            acceptedIndices: { type: "array", items: { type: "number" } },
          },
          required: ["acceptedIndices"],
        },
        taskProfile: { creativity: "deterministic", outputLength: "short" },
        throwOnParseError: false,
        maxRetries: 1,
        // ★ 2026-06-11 护栏误杀修复：caption 是网页抓取的研究语料（如 HBM/先进封装
        //   技术图说），易被 llm-moderation 误判 harmful/injection 而整批拦掉（实测
        //   35 张图→0 张）。trustedInternal=true：正则护栏+PII 照跑，但可疑结果不升级
        //   LLM 审核、不 block。内部 agent-to-agent 调用，非用户输入攻击面。
        trustedInternal: true,
      });

      // ★ 2026-05-13: LLM 幻觉可能返回越界 index（如 candidates 仅 3 项但
      //   返回 [0,1,99]）；photoCandidates[99] 是 undefined，访问 .fig 会 crash。
      //   过滤必须叠加 0 <= n < length 边界检查（feedback_no_lying_assertion）。
      const candidatesLen = photoCandidates.length;
      const indices = new Set<number>(
        Array.isArray(result.data?.acceptedIndices)
          ? result.data.acceptedIndices.filter(
              (n: unknown): n is number =>
                typeof n === "number" &&
                Number.isInteger(n) &&
                n >= 0 &&
                n < candidatesLen,
            )
          : [],
      );

      photoCandidates.forEach((c, i) => {
        if (indices.has(i)) accepted.push(c.fig);
      });

      this.logger.log(
        `[filterByLLMBatch] LLM accepted ${indices.size}/${photoCandidates.length} photos for "${topicTitle}" (single batch call)`,
      );
      return accepted;
    } catch (err) {
      this.logger.warn(
        `[filterByLLMBatch] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null; // 让调用方 fallback
    }
  }
}
