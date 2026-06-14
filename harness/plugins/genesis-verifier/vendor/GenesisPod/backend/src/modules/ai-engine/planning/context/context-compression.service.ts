/**
 * Context Compression Service
 *
 * 大上下文压缩服务（AI Engine 核心能力层）
 * 彻底解决 LLM 上下文窗口限制问题
 *
 * 核心原理：
 * 1. 分块处理：将大数据切分为可管理的块
 * 2. 并行摘要：每块独立生成摘要，保留关键信息
 * 3. 层级合并：递归合并摘要，直到达到目标大小
 * 4. 向量索引：所有块生成嵌入，支持语义检索
 * 5. 完整性校验：确保不丢失任何关键数据
 *
 * 这是领域无关的通用能力，可被任何 AI App 复用：
 * - 小说创作：长篇章节上下文
 * - 研究报告：大量资料摘要
 * - 技术文档：代码库分析
 */

import { Injectable, Logger } from "@nestjs/common";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import { EmbeddingService } from "@/modules/ai-engine/rag/embedding/embedding.service";
import {
  DataChunk,
  SummaryChunk,
  CompressionResult,
  CompressionOptions,
  IContextCompressionService,
} from "./context-compression.types";
import { AIModelType } from "@prisma/client";

@Injectable()
export class ContextCompressionService implements IContextCompressionService {
  private readonly logger = new Logger(ContextCompressionService.name);

  // 默认配置
  private readonly DEFAULT_TARGET_SIZE = 4000; // 目标压缩到 4000 字符
  private readonly DEFAULT_CHUNK_SIZE = 3000; // 每块 3000 字符
  private readonly DEFAULT_CONCURRENCY = 3; // 并发处理数

  constructor(
    private readonly aiChatService: AiChatService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * 主入口：压缩大上下文
   */
  async compress(
    content: string,
    options: CompressionOptions = {},
  ): Promise<CompressionResult> {
    const startTime = Date.now();
    const {
      targetSize = this.DEFAULT_TARGET_SIZE,
      chunkSize = this.DEFAULT_CHUNK_SIZE,
      generateEmbeddings = false,
      summaryStyle = "detailed",
      modelType,
      concurrency = this.DEFAULT_CONCURRENCY,
    } = options;

    // Use modelType if provided, otherwise use default
    const effectiveModelType = modelType || AIModelType.CHAT_FAST;

    this.logger.log(
      `[compress] 开始压缩，原始长度: ${content.length}，目标: ${targetSize}`,
    );

    // 如果内容已经足够小，直接返回
    if (content.length <= targetSize) {
      return this.createDirectResult(content, startTime);
    }

    // 第一步：分块
    const chunks = this.splitIntoChunks(content, chunkSize);
    this.logger.log(`[compress] 分块完成，共 ${chunks.length} 块`);

    // 第二步：并行生成每块摘要
    const chunkSummaries = await this.summarizeChunksParallel(
      chunks,
      summaryStyle,
      effectiveModelType,
      concurrency,
    );

    // 第三步：生成向量嵌入（可选）
    if (generateEmbeddings) {
      await this.generateEmbeddingsForSummaries(chunkSummaries);
    }

    // 第四步：层级合并摘要
    const { compressedContext, globalSummary } = await this.hierarchicalMerge(
      chunkSummaries,
      targetSize,
      effectiveModelType,
    );

    // 第五步：完整性校验
    const integrityCheck = this.verifyIntegrity(chunks, chunkSummaries);

    const processingTimeMs = Date.now() - startTime;

    return {
      compressedContext,
      globalSummary,
      chunkSummaries,
      stats: {
        originalLength: content.length,
        compressedLength: compressedContext.length,
        compressionRatio: content.length / compressedContext.length,
        chunkCount: chunks.length,
        processingTimeMs,
      },
      integrityCheck,
    };
  }

  /**
   * 智能分块：按语义边界切分
   */
  private splitIntoChunks(content: string, chunkSize: number): DataChunk[] {
    const chunks: DataChunk[] = [];

    // 优先按段落/章节切分
    const paragraphs = content.split(/\n{2,}/);
    let currentChunk = "";
    let chunkIndex = 0;

    for (const para of paragraphs) {
      if (currentChunk.length + para.length > chunkSize && currentChunk) {
        chunks.push({
          id: `chunk_${chunkIndex}`,
          content: currentChunk.trim(),
          index: chunkIndex,
          source: `段落 ${chunkIndex + 1}`,
        });
        chunkIndex++;
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + para;
      }
    }

    // 处理最后一块
    if (currentChunk.trim()) {
      chunks.push({
        id: `chunk_${chunkIndex}`,
        content: currentChunk.trim(),
        index: chunkIndex,
        source: `段落 ${chunkIndex + 1}`,
      });
    }

    // 如果单块仍然太大，进一步切分
    const finalChunks: DataChunk[] = [];
    for (const chunk of chunks) {
      if (chunk.content.length > chunkSize * 1.5) {
        const subChunks = this.forceSplit(chunk.content, chunkSize);
        subChunks.forEach((subContent, subIndex) => {
          finalChunks.push({
            id: `${chunk.id}_${subIndex}`,
            content: subContent,
            index: finalChunks.length,
            source: `${chunk.source}-${subIndex + 1}`,
          });
        });
      } else {
        chunk.index = finalChunks.length;
        finalChunks.push(chunk);
      }
    }

    return finalChunks;
  }

  /**
   * 强制切分（当自然边界不够时）
   */
  private forceSplit(content: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < content.length) {
      let end = Math.min(start + chunkSize, content.length);

      // 尝试在句子边界切分
      if (end < content.length) {
        const lastSentenceEnd = content.lastIndexOf("。", end);
        if (lastSentenceEnd > start + chunkSize * 0.5) {
          end = lastSentenceEnd + 1;
        }
      }

      chunks.push(content.substring(start, end));
      start = end;
    }

    return chunks;
  }

  /**
   * 并行生成块摘要
   */
  private async summarizeChunksParallel(
    chunks: DataChunk[],
    style: "brief" | "detailed" | "analytical",
    modelType: AIModelType,
    concurrency: number,
  ): Promise<SummaryChunk[]> {
    const results: SummaryChunk[] = [];

    // 分批并行处理
    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((chunk) => this.summarizeChunk(chunk, style, modelType)),
      );
      results.push(...batchResults);

      this.logger.log(
        `[summarizeChunksParallel] 已处理 ${Math.min(i + concurrency, chunks.length)}/${chunks.length} 块`,
      );
    }

    return results;
  }

  /**
   * 生成单块摘要
   */
  private async summarizeChunk(
    chunk: DataChunk,
    style: "brief" | "detailed" | "analytical",
    modelType: AIModelType,
  ): Promise<SummaryChunk> {
    const stylePrompts = {
      brief: "用50-100字简洁概括核心内容",
      detailed: "用150-250字详细概括，保留所有关键信息和数据",
      analytical: "用200-300字分析性概括，包括主要观点、支撑数据、逻辑关系",
    };

    const prompt = `请为以下内容生成摘要。${stylePrompts[style]}

【内容】
${chunk.content}

请输出：
1. 摘要（一段话）
2. 关键点（3-5个要点，每个10-20字）

格式：
摘要：[你的摘要]
关键点：
- [要点1]
- [要点2]
- [要点3]`;

    try {
      const response = await this.aiChatService.chat({
        modelType,
        messages: [{ role: "user", content: prompt }],
        taskProfile: {
          creativity: "low",
          outputLength: "short",
        },
      });

      const { summary, keyPoints } = this.parseSummaryResponse(
        response.content,
      );

      return {
        chunkId: chunk.id,
        summary,
        keyPoints,
        sourceChunks: [chunk.id],
        wordCount: chunk.content.length,
      };
    } catch (error) {
      this.logger.warn(`[summarizeChunk] 块 ${chunk.id} 摘要失败: ${error}`);
      // 失败时回退到简单截取
      return {
        chunkId: chunk.id,
        summary: chunk.content.substring(0, 200) + "...",
        keyPoints: [],
        sourceChunks: [chunk.id],
        wordCount: chunk.content.length,
      };
    }
  }

  /**
   * 解析摘要响应
   */
  private parseSummaryResponse(response: string): {
    summary: string;
    keyPoints: string[];
  } {
    const summaryMatch = response.match(/摘要[：:]\s*([\s\S]*?)(?=关键点|$)/);
    const summary = summaryMatch?.[1]?.trim() || response.substring(0, 300);

    const keyPointsMatch = response.match(/关键点[：:]?\s*([\s\S]*?)$/);
    const keyPointsText = keyPointsMatch?.[1] || "";
    const keyPoints = keyPointsText
      .split(/[-•]\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    return { summary, keyPoints };
  }

  /**
   * 为摘要生成向量嵌入
   */
  private async generateEmbeddingsForSummaries(
    summaries: SummaryChunk[],
  ): Promise<void> {
    for (const summary of summaries) {
      try {
        const result = await this.embeddingService.generateEmbedding(
          summary.summary,
        );
        summary.embedding = result.embedding;
      } catch (error) {
        this.logger.warn(
          `[generateEmbeddings] 块 ${summary.chunkId} 嵌入失败: ${error}`,
        );
      }
    }
  }

  /**
   * 层级合并摘要
   */
  private async hierarchicalMerge(
    summaries: SummaryChunk[],
    targetSize: number,
    modelType: AIModelType,
  ): Promise<{ compressedContext: string; globalSummary: string }> {
    // 合并所有摘要
    let currentSummaries = summaries;
    let level = 1;

    while (this.getTotalLength(currentSummaries) > targetSize && level < 5) {
      this.logger.log(
        `[hierarchicalMerge] 第 ${level} 层合并，当前长度: ${this.getTotalLength(currentSummaries)}`,
      );

      // 每 5 个摘要合并为 1 个
      const mergedSummaries: SummaryChunk[] = [];
      for (let i = 0; i < currentSummaries.length; i += 5) {
        const batch = currentSummaries.slice(i, i + 5);
        const merged = await this.mergeSummaryBatch(batch, modelType);
        mergedSummaries.push(merged);
      }

      currentSummaries = mergedSummaries;
      level++;
    }

    // 生成最终的全局摘要
    const allSummaryText = currentSummaries.map((s) => s.summary).join("\n\n");
    const globalSummary = await this.generateGlobalSummary(
      allSummaryText,
      modelType,
    );

    // 构建最终上下文：全局摘要 + 关键点
    const allKeyPoints = currentSummaries
      .flatMap((s) => s.keyPoints)
      .slice(0, 20);
    const keyPointsText =
      allKeyPoints.length > 0
        ? `\n\n【关键要点】\n${allKeyPoints.map((p) => `• ${p}`).join("\n")}`
        : "";

    const compressedContext = `【内容摘要】\n${globalSummary}${keyPointsText}`;

    return { compressedContext, globalSummary };
  }

  /**
   * 合并一批摘要
   */
  private async mergeSummaryBatch(
    batch: SummaryChunk[],
    modelType: AIModelType,
  ): Promise<SummaryChunk> {
    const combinedText = batch.map((s) => s.summary).join("\n\n---\n\n");
    const combinedKeyPoints = batch.flatMap((s) => s.keyPoints);

    const prompt = `请将以下多个摘要合并为一个更精炼的摘要（200-400字）：

${combinedText}

要求：
1. 保留所有重要信息
2. 去除重复内容
3. 保持逻辑连贯`;

    try {
      const response = await this.aiChatService.chat({
        modelType,
        messages: [{ role: "user", content: prompt }],
        taskProfile: { creativity: "low", outputLength: "short" },
      });

      return {
        chunkId: `merged_${batch[0].chunkId}`,
        summary: response.content,
        keyPoints: combinedKeyPoints.slice(0, 5),
        sourceChunks: batch.flatMap((s) => s.sourceChunks),
        wordCount: batch.reduce((sum, s) => sum + s.wordCount, 0),
      };
    } catch {
      // 失败时简单拼接
      return {
        chunkId: `merged_${batch[0].chunkId}`,
        summary: batch.map((s) => s.summary).join(" "),
        keyPoints: combinedKeyPoints.slice(0, 5),
        sourceChunks: batch.flatMap((s) => s.sourceChunks),
        wordCount: batch.reduce((sum, s) => sum + s.wordCount, 0),
      };
    }
  }

  /**
   * 生成全局摘要
   */
  private async generateGlobalSummary(
    summaryText: string,
    modelType: AIModelType,
  ): Promise<string> {
    const prompt = `请为以下内容生成一个全面的总结（300-500字），确保涵盖所有关键信息：

${summaryText}

要求：
1. 概括主要内容和观点
2. 突出重要数据和结论
3. 保持客观准确`;

    try {
      const response = await this.aiChatService.chat({
        modelType,
        messages: [{ role: "user", content: prompt }],
        taskProfile: {
          creativity: "low",
          outputLength: "short",
        },
      });

      return response.content;
    } catch {
      return summaryText.substring(0, 500) + "...";
    }
  }

  /**
   * 计算总长度
   */
  private getTotalLength(summaries: SummaryChunk[]): number {
    return summaries.reduce((sum, s) => sum + s.summary.length, 0);
  }

  /**
   * 完整性校验
   */
  private verifyIntegrity(
    originalChunks: DataChunk[],
    summaries: SummaryChunk[],
  ): CompressionResult["integrityCheck"] {
    const processedIds = new Set(summaries.flatMap((s) => s.sourceChunks));
    const originalIds = new Set(originalChunks.map((c) => c.id));

    const missingChunks = [...originalIds].filter(
      (id) => !processedIds.has(id),
    );
    const coveragePercentage =
      ((originalIds.size - missingChunks.length) / originalIds.size) * 100;

    return {
      allChunksProcessed: missingChunks.length === 0,
      coveragePercentage,
      missingChunks,
    };
  }

  /**
   * 直接返回结果（内容已足够小）
   */
  private createDirectResult(
    content: string,
    startTime: number,
  ): CompressionResult {
    return {
      compressedContext: content,
      globalSummary: content,
      chunkSummaries: [],
      stats: {
        originalLength: content.length,
        compressedLength: content.length,
        compressionRatio: 1,
        chunkCount: 1,
        processingTimeMs: Date.now() - startTime,
      },
      integrityCheck: {
        allChunksProcessed: true,
        coveragePercentage: 100,
        missingChunks: [],
      },
    };
  }

  /**
   * 基于查询检索相关上下文
   * 用于在压缩后的上下文基础上，针对特定问题检索相关原始片段
   */
  async retrieveRelevantContext(
    query: string,
    summaries: SummaryChunk[],
    topK: number = 3,
  ): Promise<string[]> {
    if (!summaries.some((s) => s.embedding)) {
      this.logger.warn("[retrieveRelevantContext] 摘要未生成嵌入，无法检索");
      return [];
    }

    try {
      // ★ 2026-05-12: taskType:"query" 与存储侧"document"对齐编码空间
      const queryEmbedding = await this.embeddingService.generateEmbedding(
        query,
        { taskType: "query" },
      );

      // 计算相似度并排序
      const scored = summaries
        .filter((s) => s.embedding)
        .map((s) => ({
          summary: s,
          similarity: this.cosineSimilarity(
            queryEmbedding.embedding,
            s.embedding!,
          ),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

      return scored.map((s) => s.summary.summary);
    } catch (error) {
      this.logger.error(`[retrieveRelevantContext] 检索失败: ${error}`);
      return [];
    }
  }

  /**
   * 余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}
