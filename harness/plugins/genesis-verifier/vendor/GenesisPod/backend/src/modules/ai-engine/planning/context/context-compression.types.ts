/**
 * Context Compression Types — engine 自有
 *
 * 2026-05-01 (PR-X-M3): 从 ai-harness/runner/executor/interfaces.ts 搬到
 * engine。harness/runner/executor/interfaces.ts re-export 保兼容。
 */

import { AIModelType } from "@prisma/client";

/** 数据块 */
export interface DataChunk {
  id: string;
  content: string;
  index: number;
  source: string;
  metadata?: Record<string, unknown>;
}

/** 摘要块 */
export interface SummaryChunk {
  chunkId: string;
  summary: string;
  keyPoints: string[];
  sourceChunks: string[];
  embedding?: number[];
  wordCount: number;
}

/** 压缩结果 */
export interface CompressionResult {
  compressedContext: string;
  globalSummary: string;
  chunkSummaries: SummaryChunk[];
  stats: {
    originalLength: number;
    compressedLength: number;
    compressionRatio: number;
    chunkCount: number;
    processingTimeMs: number;
  };
  integrityCheck: {
    allChunksProcessed: boolean;
    coveragePercentage: number;
    missingChunks: string[];
  };
}

/** 压缩选项 */
export interface CompressionOptions {
  targetSize?: number;
  chunkSize?: number;
  generateEmbeddings?: boolean;
  summaryStyle?: "brief" | "detailed" | "analytical";
  model?: string;
  modelType?: AIModelType;
  concurrency?: number;
}

/** 上下文压缩服务接口 */
export interface IContextCompressionService {
  compress(
    content: string,
    options?: CompressionOptions,
  ): Promise<CompressionResult>;

  retrieveRelevantContext(
    query: string,
    summaries: SummaryChunk[],
    topK?: number,
  ): Promise<string[]>;
}
