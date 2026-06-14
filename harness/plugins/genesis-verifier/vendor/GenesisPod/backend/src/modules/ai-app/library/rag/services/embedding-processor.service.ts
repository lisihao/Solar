/**
 * Embedding Processor Service
 * Business-level service for generating and storing embeddings
 *
 * Uses AI Engine's EmbeddingService for generation and VectorService for storage.
 *
 * 2026-05-12: 实时进度 + 429 熔断自动恢复 + 失败上抛
 * - 每个 batch 完成后写 KnowledgeBase.progressJson，前端 2s 轮询可见 X/N + cooldown
 * - circuit-open 错误（embedding 服务 60s 冷却）→ 等到 cooldown 过期重试同一 batch 一次
 * - 历史问题：catch 静默吞错 + 后续 batch 都被熔断 → generatedCount=0 → KB 假 READY
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RAGFacade } from "@/modules/ai-harness/facade";
import { MissionExecutorService } from "@/modules/ai-harness/facade";
import { AiModelConfigService } from "@/modules/ai-engine/facade";
import { LruMap } from "@/common/utils/lru-map";

const BATCH_SIZE = 50;
/**
 * 单 batch token 数硬上限（独立于 BATCH_SIZE 行数）。
 *
 * 2026-05-12 真因：早先 BATCH_SIZE=50 只按 chunk 行数切批，但大文档（如刚导入的
 * Playground 报告 ~230K 字 / 7 万 token）chunker 切出来每段 ~1500 token，50 行一批
 * 直接装 75K token —— 远超 Gemini embedding 单 request 容量、也超 admin TPM
 * 限额（20K），第一批就 429。
 *
 * 修法：每批按 token 数累积切，达到 cap 就提前断批；不动 BATCH_SIZE 上限。
 *   - 15K = Gemini free TPM(30K)的 50% headroom，留余地避免 TPM 滚动窗撞顶
 *   - 也低于 Gemini text-embedding/embedding-001 单 request 容量
 *   - 单个 chunk 自身 >15K（罕见）时仍单独发一批，让 google 报错而非卡死
 */
const BATCH_TOKEN_CAP = 15_000;
const COOLDOWN_RETRY_BUFFER_MS = 500; // 醒来再多等 500ms 让熔断器闭合
const COOLDOWN_MAX_WAIT_MS = 90_000; // 最长等 90s, 超过认为上游问题不重试

/**
 * Provider 启发式 RPM 默认（仅当用户 UserModelConfig.rpmLimit 未配时用）
 * 数值按各 provider 公开的 free / starter tier 真实上限。
 *
 * 2026-05-12 修正：早先 google: 5 是错的（混淆了 gemini-2.5-flash RPM
 * 与 gemini-embedding-001 RPM），实际 gemini-embedding-001 free tier
 * 是 100 RPM；真实瓶颈是 TPM 30K——见 PROVIDER_TPM_HEURISTIC。
 */
const PROVIDER_RPM_HEURISTIC: Record<string, number> = {
  google: 100, // gemini-embedding-001 free tier
  gemini: 100,
  openai: 1500, // text-embedding-3-small tier 1 paid，保守取一半
  voyage: 300,
  cohere: 100,
  anthropic: 1000,
};
const FALLBACK_RPM = 60;

/**
 * Provider 启发式 TPM (Tokens Per Minute) 默认。
 * Gemini free tier embedding 真实卡点：30K TPM——155 chunks × 500 tokens =
 * 77K tokens 全发就直接 429，RPM 反而是宽松的。
 */
const PROVIDER_TPM_HEURISTIC: Record<string, number> = {
  google: 30_000, // gemini-embedding-001 free tier
  gemini: 30_000,
  openai: 1_000_000, // text-embedding-3-small tier 1
  voyage: 1_000_000,
  cohere: 100_000,
  anthropic: 1_000_000,
};
const FALLBACK_TPM = 100_000;

/**
 * Token 估算：CJK-aware（2026-05-12 二弹修正）。
 *
 * 历史问题：单一 /3 估算对纯中文 KB 偏低 ~50%（cl100k 中文 ~1.7 char/token），
 * Gemini 30K TPM 实际 ~15K tokens 就到顶，但节流以为还没用满 → 仍 429。
 *
 * 改：分别统计 CJK 与 non-CJK 字符，按各自的 char/token 系数算。
 *   - CJK Unified Ideographs (U+3400-9FFF) + 兼容汉字 + 假名：~1.5 char/token
 *   - 拉丁字母 / 数字 / 标点：~4 char/token
 * 取保守值（CJK 1.5, latin 3.5）防 underestimate。
 */
const CJK_REGEX = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;
function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(CJK_REGEX);
  const cjkLen = cjkMatches ? cjkMatches.length : 0;
  const otherLen = text.length - cjkLen;
  return Math.ceil(cjkLen / 1.5 + otherLen / 3.5);
}

/**
 * KB 向量化进度形状（写入 KnowledgeBase.progressJson）
 * stage:
 *   - 'embedding': 正常进度中
 *   - 'cooling':   碰到 circuit-open, 正等 cooldown 然后重试 batch
 */
export interface KbVectorizeProgress {
  stage: "embedding" | "cooling" | "throttling";
  processed: number; // 已成功向量化的 chunk 数
  total: number; // 本次需要向量化的 chunk 数
  startedAt: string; // ISO
  cooldownUntil?: string; // ISO, 仅 stage='cooling' 时存在
  nextBatchAt?: string; // ISO, 仅 stage='throttling' 时存在（按 RPM 节流等待）
  rpmLimit?: number; // 当前生效的 RPM 限制（用于前端展示"按 X RPM 节流"）
  tpmLimit?: number; // 当前生效的 TPM 限制
  throttleReason?: "rpm" | "tpm"; // 当前节流是因 RPM 还是 TPM
  lastError?: string;
}

export interface EmbedKbResult {
  generatedCount: number;
  totalNeeded: number;
  failedBatches: number;
  lastError?: string;
}

@Injectable()
export class EmbeddingProcessorService {
  private readonly logger = new Logger(EmbeddingProcessorService.name);
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiModelConfig: AiModelConfigService,
    @Optional() private readonly ragFacade?: RAGFacade,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
  ) {}

  /**
   * 计算 batch 间最小间隔 + TPM 限额（自适应限速）。
   * - userId 上下文：走 pickBYOKModelForUser 拿 rpmLimit / tpmLimit
   * - 字段为 null → 按 provider 启发式默认（基于真实 free / starter tier）
   * - rpmLimit/tpmLimit=0 或负 → 不限速（=Infinity 处理）
   */
  private async resolveThrottle(userId: string | undefined): Promise<{
    minIntervalMs: number;
    rpmLimit: number;
    tpmLimit: number;
    provider: string;
  }> {
    const picked = await this.aiModelConfig
      .pickBYOKModelForUser("EMBEDDING", userId)
      .catch(() => null);
    const provider = (picked?.provider ?? "openai").toLowerCase();
    const pickHeuristic = (
      map: Record<string, number>,
      fallback: number,
    ): number => map[provider] ?? map[provider.split(/[-_]/)[0]] ?? fallback;
    const userRpm = picked?.rpmLimit;
    const userTpm = picked?.tpmLimit;
    const rpmLimit =
      userRpm && userRpm > 0
        ? userRpm
        : pickHeuristic(PROVIDER_RPM_HEURISTIC, FALLBACK_RPM);
    const tpmLimit =
      userTpm && userTpm > 0
        ? userTpm
        : pickHeuristic(PROVIDER_TPM_HEURISTIC, FALLBACK_TPM);
    const minIntervalMs = Math.ceil(60_000 / rpmLimit);
    return { minIntervalMs, rpmLimit, tpmLimit, provider };
  }

  /**
   * Token 滑动窗口：维护过去 60s 内的发送记录，pre-flight 检查下一个 batch
   * 加入后是否超 TPM。超则 sleep 到最旧条目 > 60s 自动滚出，再重试。
   */
  private async waitForTpmBudget(
    window: Array<{ ts: number; tokens: number }>,
    estimatedTokens: number,
    tpmLimit: number,
    onWait?: (waitMs: number) => Promise<void>,
  ): Promise<void> {
    if (!tpmLimit || tpmLimit <= 0) return;
    // 单批就超 TPM → 没救，最多等 60s 让窗口完全滚空再发
    if (estimatedTokens > tpmLimit) {
      this.logger.warn(
        `[embedding] batch tokens ${estimatedTokens} > TPM limit ${tpmLimit}; one batch will eat full quota`,
      );
    }
    while (true) {
      const cutoff = Date.now() - 60_000;
      // 就地清理过期条目
      while (window.length > 0 && window[0].ts <= cutoff) window.shift();
      const used = window.reduce((sum, e) => sum + e.tokens, 0);
      if (used + estimatedTokens <= tpmLimit) return;
      // 否则等到最旧条目滚出窗口
      const oldest = window[0];
      if (!oldest) return; // 窗口空但单批还超？已 warn，放行
      const waitMs = 60_000 - (Date.now() - oldest.ts) + 100;
      if (waitMs <= 0) {
        window.shift();
        continue;
      }
      if (onWait) await onWait(waitMs);
      await this.sleep(waitMs);
    }
  }

  /**
   * Generate embeddings for all child chunks in a knowledge base that don't have embeddings yet.
   *
   * 返回结构化结果（不再是 number），调用方需依此判定 READY / ERROR / PARTIAL。
   */
  async generateEmbeddingsForKnowledgeBase(
    knowledgeBaseId: string,
    userId?: string,
  ): Promise<EmbedKbResult> {
    this.logger.log(
      `Generating embeddings for knowledge base: ${knowledgeBaseId}`,
    );

    // Spawn AI Kernel process for cost tracking
    if (this.missionExecutor && userId) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId,
          agentId: "rag-processor",
          teamSessionId: knowledgeBaseId,
          input: { knowledgeBaseId },
        });
        this.kernelProcessIds.set(knowledgeBaseId, kernelResult.processId);
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${(err as Error).message}`,
        );
      }
    }

    // Find all child chunks without embeddings for this KB
    const chunksWithoutEmbeddings = await this.prisma.childChunk.findMany({
      where: {
        parentChunk: {
          document: {
            knowledgeBaseId,
          },
        },
        embeddings: { none: {} },
      },
      select: {
        id: true,
        content: true,
      },
    });

    const totalNeeded = chunksWithoutEmbeddings.length;

    if (totalNeeded === 0) {
      this.logger.log(`No chunks need embeddings for KB ${knowledgeBaseId}`);
      await this.clearProgress(knowledgeBaseId);
      this.completeKernelProcess(knowledgeBaseId, { generatedCount: 0 });
      return { generatedCount: 0, totalNeeded: 0, failedBatches: 0 };
    }

    this.logger.log(`Found ${totalNeeded} chunks needing embeddings`);

    const startedAt = new Date().toISOString();
    let generatedCount = 0;
    let failedBatches = 0;
    let lastError: string | undefined;

    // 自适应限速：按 rpmLimit + tpmLimit 计算 batch 间隔与 token 预算
    const { minIntervalMs, rpmLimit, tpmLimit, provider } =
      await this.resolveThrottle(userId);
    this.logger.log(
      `[embedding] throttle: ${rpmLimit} RPM / ${tpmLimit} TPM (provider=${provider}, minInterval=${minIntervalMs}ms)`,
    );

    await this.writeProgress(knowledgeBaseId, {
      stage: "embedding",
      processed: 0,
      total: totalNeeded,
      startedAt,
      rpmLimit,
      tpmLimit,
    });

    const model = await this.ragFacade!.embedding!.getModel();
    let lastBatchAt = 0; // 上一次 batch 完成的时间戳
    const tokenWindow: Array<{ ts: number; tokens: number }> = [];

    // 2026-05-12 真因修：按 token 数动态切批（不只 chunk 行数）。
    //   大文档（如 230K 字 Playground 报告）chunker 切出 ~1500T/chunk，
    //   纯 BATCH_SIZE=50 → 75K T/batch 必爆 google 30K TPM。
    //   现在 row cap 仍 BATCH_SIZE，但 token 累积达到 BATCH_TOKEN_CAP 提前断批。
    type BatchEntry = (typeof chunksWithoutEmbeddings)[number];
    const tokenAwareBatches: Array<{ chunks: BatchEntry[]; tokens: number }> =
      [];
    {
      let cur: BatchEntry[] = [];
      let curTokens = 0;
      for (const c of chunksWithoutEmbeddings) {
        const t = estimateTokens(c.content);
        // 装不下且当前批非空 → flush；保证最小 1 chunk/batch（避免单 chunk
        // 自身 > cap 时永远塞不下）。
        if (cur.length > 0 && curTokens + t > BATCH_TOKEN_CAP) {
          tokenAwareBatches.push({ chunks: cur, tokens: curTokens });
          cur = [];
          curTokens = 0;
        }
        cur.push(c);
        curTokens += t;
        if (cur.length >= BATCH_SIZE) {
          tokenAwareBatches.push({ chunks: cur, tokens: curTokens });
          cur = [];
          curTokens = 0;
        }
      }
      if (cur.length > 0) {
        tokenAwareBatches.push({ chunks: cur, tokens: curTokens });
      }
    }

    this.logger.log(
      `[embedding] sliced ${totalNeeded} chunks into ${tokenAwareBatches.length} token-aware batches (cap=${BATCH_TOKEN_CAP}T, row-cap=${BATCH_SIZE})`,
    );

    for (let bi = 0; bi < tokenAwareBatches.length; bi++) {
      const { chunks: batch, tokens: batchTokens } = tokenAwareBatches[bi];
      const texts = batch.map((chunk) => chunk.content);
      const batchNum = bi + 1;

      // RPM 节流：本次 batch 距上次至少 minIntervalMs
      if (lastBatchAt > 0) {
        const elapsed = Date.now() - lastBatchAt;
        const waitMs = minIntervalMs - elapsed;
        if (waitMs > 0) {
          const nextBatchAt = new Date(Date.now() + waitMs).toISOString();
          this.logger.debug(
            `[embedding] RPM throttle batch ${batchNum}: wait ${waitMs}ms (RPM=${rpmLimit})`,
          );
          await this.writeProgress(knowledgeBaseId, {
            stage: "throttling",
            processed: generatedCount,
            total: totalNeeded,
            startedAt,
            nextBatchAt,
            rpmLimit,
            tpmLimit,
            throttleReason: "rpm",
            lastError,
          });
          await this.sleep(waitMs);
        }
      }

      // TPM 节流：本批 token 加入后是否超 30K/min 滑窗
      await this.waitForTpmBudget(
        tokenWindow,
        batchTokens,
        tpmLimit,
        async (waitMs) => {
          const nextBatchAt = new Date(Date.now() + waitMs).toISOString();
          this.logger.debug(
            `[embedding] TPM throttle batch ${batchNum}: wait ${waitMs}ms (batch=${batchTokens}T, limit=${tpmLimit}TPM)`,
          );
          await this.writeProgress(knowledgeBaseId, {
            stage: "throttling",
            processed: generatedCount,
            total: totalNeeded,
            startedAt,
            nextBatchAt,
            rpmLimit,
            tpmLimit,
            throttleReason: "tpm",
            lastError,
          });
        },
      );

      // 单 batch 最多两次：首次失败 → circuit-open 或 429 → 等 cooldown → 二次
      let retried = false;
      while (true) {
        // ★ 2026-05-12: lastBatchAt + tokenWindow 必须在调用前记录，否则失败
        //   batch 不算 RPM/TPM 消耗，下一个 batch 立即开火 → 上限直接打爆。
        lastBatchAt = Date.now();
        tokenWindow.push({ ts: lastBatchAt, tokens: batchTokens });
        try {
          // ★ 2026-05-12: maxRetries:1 关 EmbeddingService 内层 3-retry。
          //   外层已有 TPM-aware throttle + 60s 等-滚-quota-window 重试，
          //   内层 1s/2s 指数退避只会在 ~4s 内打 3 个 HTTP 把 Google 100 RPM
          //   peak burst 直接打爆 + 污染 quota window。
          const embeddingResult =
            await this.ragFacade!.embedding!.generateEmbeddings(texts, {
              maxRetries: 1,
            });

          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const embedding = embeddingResult.embeddings[j];
            if (embedding && embedding.length > 0) {
              await this.ragFacade!.vector!.storeEmbedding(
                chunk.id,
                embedding,
                model,
              );
              generatedCount++;
            }
          }

          await this.writeProgress(knowledgeBaseId, {
            stage: "embedding",
            processed: generatedCount,
            total: totalNeeded,
            startedAt,
            rpmLimit,
            tpmLimit,
            lastError,
          });
          this.logger.debug(
            `Batch ${batchNum}: ${batch.length} processed (${batchTokens}T), total ${generatedCount}/${totalNeeded}`,
          );
          break;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const cooldownIso = this.extractCircuitOpenCooldown(msg);
          const is429 = /429|rate.?limit|too many requests/i.test(msg);
          // ★ 2026-05-12 二弹: provider 返回 Retry-After header → ai-api-caller
          //   会写到 message 里 "[retry-after=Ns]"。用这个精确值代替粗估 60s。
          const retryAfterMatch = msg.match(/\[retry-after=(\d+)s\]/);
          const retryAfterSec = retryAfterMatch
            ? Number.parseInt(retryAfterMatch[1], 10)
            : null;

          // ★ 2026-05-12: 不只 circuit-open 重试，普通 429 也重试一次。
          //   gemini free tier 5 RPM 在 EmbeddingService 内 3 次重试就能把
          //   quota 打爆，但 circuit-open 阈值是 5 次 → 前 2 个 batch（共 5-6
          //   次 429）会被吞掉无重试。429 重试用 max(minInterval, 60s) 等
          //   quota window 滚一圈。
          if (!retried && (cooldownIso || is429)) {
            retried = true;
            let waitMs: number;
            let cooldownUntil: string;
            if (cooldownIso) {
              const cd = Math.max(
                0,
                new Date(cooldownIso).getTime() - Date.now(),
              );
              waitMs = Math.min(
                cd + COOLDOWN_RETRY_BUFFER_MS,
                COOLDOWN_MAX_WAIT_MS,
              );
              cooldownUntil = cooldownIso;
            } else if (retryAfterSec && retryAfterSec > 0) {
              // provider 给出精确 retry-after，按它等（+500ms buffer）
              waitMs = Math.min(
                retryAfterSec * 1000 + COOLDOWN_RETRY_BUFFER_MS,
                COOLDOWN_MAX_WAIT_MS,
              );
              cooldownUntil = new Date(Date.now() + waitMs).toISOString();
            } else {
              // 普通 429 无 retry-after: 等 60s 让 upstream rate-limit window 滚一圈
              waitMs = Math.min(60_000, COOLDOWN_MAX_WAIT_MS);
              cooldownUntil = new Date(Date.now() + waitMs).toISOString();
            }
            this.logger.warn(
              `[embedding] batch ${batchNum} ${cooldownIso ? "circuit-open" : "429"}, waiting ${waitMs}ms`,
            );
            await this.writeProgress(knowledgeBaseId, {
              stage: "cooling",
              processed: generatedCount,
              total: totalNeeded,
              startedAt,
              cooldownUntil,
              rpmLimit,
              tpmLimit,
              lastError: msg,
            });
            await this.sleep(waitMs);
            continue;
          }

          failedBatches++;
          lastError = msg;
          this.logger.error(
            `Failed to generate embeddings for batch ${batchNum}: ${msg}`,
          );
          await this.writeProgress(knowledgeBaseId, {
            stage: "embedding",
            processed: generatedCount,
            total: totalNeeded,
            startedAt,
            rpmLimit,
            tpmLimit,
            lastError,
          });
          break;
        }
      }
    }

    this.logger.log(
      `KB ${knowledgeBaseId}: generated ${generatedCount}/${totalNeeded} embeddings, failedBatches=${failedBatches}`,
    );

    await this.clearProgress(knowledgeBaseId);

    this.completeKernelProcess(knowledgeBaseId, {
      generatedCount,
      totalChunks: totalNeeded,
    });

    return { generatedCount, totalNeeded, failedBatches, lastError };
  }

  /**
   * Generate embeddings for a single document
   */
  async generateEmbeddingsForDocument(
    documentId: string,
    userId?: string,
  ): Promise<number> {
    this.logger.log(`Generating embeddings for document: ${documentId}`);

    // Spawn AI Kernel process for cost tracking
    if (this.missionExecutor && userId) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId,
          agentId: "rag-processor",
          teamSessionId: documentId,
          input: { documentId },
        });
        this.kernelProcessIds.set(documentId, kernelResult.processId);
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${(err as Error).message}`,
        );
      }
    }

    const chunksWithoutEmbeddings = await this.prisma.childChunk.findMany({
      where: {
        parentChunk: {
          documentId,
        },
        embeddings: { none: {} },
      },
      select: {
        id: true,
        content: true,
      },
    });

    if (chunksWithoutEmbeddings.length === 0) {
      this.logger.log(`No chunks need embeddings for document ${documentId}`);
      this.completeKernelProcess(documentId, { generatedCount: 0 });
      return 0;
    }

    const texts = chunksWithoutEmbeddings.map((chunk) => chunk.content);
    const model = await this.ragFacade!.embedding!.getModel();

    try {
      const embeddingResult =
        await this.ragFacade!.embedding!.generateEmbeddings(texts);

      let generatedCount = 0;
      for (let i = 0; i < chunksWithoutEmbeddings.length; i++) {
        const chunk = chunksWithoutEmbeddings[i];
        const embedding = embeddingResult.embeddings[i];

        if (embedding && embedding.length > 0) {
          await this.ragFacade!.vector!.storeEmbedding(
            chunk.id,
            embedding,
            model,
          );
          generatedCount++;
        }
      }

      // Complete AI Kernel process
      this.completeKernelProcess(documentId, {
        generatedCount,
        totalChunks: chunksWithoutEmbeddings.length,
      });

      return generatedCount;
    } catch (error) {
      this.logger.error(
        `Failed to generate embeddings for document ${documentId}: ${error}`,
      );
      // Fail AI Kernel process
      this.failKernelProcess(
        documentId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * 从 "circuit-open ... cooldown until <ISO>" 错误消息提取 ISO 时间戳
   * 例：Embedding circuit-open (0 recent 429s). Upstream rate-limit cooldown until 2026-05-11T21:28:45.615Z
   */
  private extractCircuitOpenCooldown(msg: string): string | undefined {
    const match = msg.match(
      /cooldown until (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/i,
    );
    return match?.[1];
  }

  private async writeProgress(
    knowledgeBaseId: string,
    progress: KbVectorizeProgress,
  ): Promise<void> {
    try {
      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: { progressJson: progress as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      // 进度写失败不应阻塞向量化主流程（哪怕 KB 在并发中被删了也只是日志）
      this.logger.warn(
        `Failed to write progress for KB ${knowledgeBaseId}: ${(err as Error).message}`,
      );
    }
  }

  private async clearProgress(knowledgeBaseId: string): Promise<void> {
    try {
      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: { progressJson: Prisma.JsonNull },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to clear progress for KB ${knowledgeBaseId}: ${(err as Error).message}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private completeKernelProcess(
    entityId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(entityId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .complete(processId, output)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(entityId);
  }

  private failKernelProcess(entityId: string, error: string): void {
    const processId = this.kernelProcessIds.get(entityId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .fail(processId, error)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to fail process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(entityId);
  }
}
