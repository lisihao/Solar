/**
 * AI Engine - Document Chunker
 * 通用文档分块服务
 *
 * 实现 Parent-Child 分块策略:
 * - Parent chunks: ~2000 tokens，用于最终响应的丰富上下文
 * - Child chunks: ~400 tokens，用于精确的向量搜索
 * - 每个子块保持对父块的引用
 */

import { Injectable, Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";

/**
 * 分块配置
 */
export interface ChunkingConfig {
  /** 父块大小（token 数） */
  parentChunkSize: number;
  /** 父块重叠（token 数） */
  parentChunkOverlap: number;
  /** 子块大小（token 数） */
  childChunkSize: number;
  /** 子块重叠（token 数） */
  childChunkOverlap: number;
}

/**
 * 默认分块配置
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  parentChunkSize: 2000,
  parentChunkOverlap: 200,
  childChunkSize: 400,
  childChunkOverlap: 50,
};

/**
 * 子块数据
 */
export interface ChildChunkData {
  id: string;
  content: string;
  tokenCount: number;
  position: number;
  parentPosition: number;
  documentId?: string;
}

/**
 * 父块数据
 */
export interface ParentChunkData {
  id: string;
  content: string;
  tokenCount: number;
  position: number;
  pageStart?: number;
  pageEnd?: number;
  sectionTitle?: string;
  metadata?: Record<string, unknown>;
  childChunks: ChildChunkData[];
}

/**
 * 处理后的文档
 */
export interface ChunkedDocument {
  documentId: string;
  title: string;
  parentChunks: ParentChunkData[];
  totalTokens: number;
  totalChildChunks: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class DocumentChunker {
  private readonly logger = new Logger(DocumentChunker.name);

  /**
   * 将文档内容分块为 Parent-Child 结构
   *
   * @param documentId 文档 ID
   * @param content 文档内容
   * @param title 文档标题
   * @param config 分块配置
   * @returns 分块后的文档
   */
  chunkDocument(
    documentId: string,
    content: string,
    title: string,
    config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
  ): ChunkedDocument {
    this.logger.log(`Chunking document: ${title} (${documentId})`);

    // Split into parent chunks
    const parentChunks = this.splitIntoParentChunks(content, config);

    // Track page position
    let currentPage = 1;
    let tokensInCurrentPage = 0;
    const TOKENS_PER_PAGE = 500;

    // Process each parent chunk
    const processedParents: ParentChunkData[] = parentChunks.map(
      (parentContent, parentIndex) => {
        const parentId = uuidv4();
        const tokenCount = this.estimateTokens(parentContent);

        // Calculate page range
        const pageStart = currentPage;
        tokensInCurrentPage += tokenCount;
        while (tokensInCurrentPage > TOKENS_PER_PAGE) {
          currentPage++;
          tokensInCurrentPage -= TOKENS_PER_PAGE;
        }
        const pageEnd = currentPage;

        // Extract section title
        const sectionTitle = this.extractSectionTitle(parentContent);

        // Split into child chunks
        const childChunks = this.splitIntoChildChunks(parentContent, config);

        return {
          id: parentId,
          content: parentContent,
          tokenCount,
          position: parentIndex,
          pageStart,
          pageEnd,
          sectionTitle,
          metadata: {},
          childChunks: childChunks.map((childContent, childIndex) => ({
            id: uuidv4(),
            content: childContent,
            tokenCount: this.estimateTokens(childContent),
            position: childIndex,
            parentPosition: parentIndex,
          })),
        };
      },
    );

    const totalChildChunks = processedParents.reduce(
      (sum, p) => sum + p.childChunks.length,
      0,
    );
    const totalTokens = processedParents.reduce(
      (sum, p) => sum + p.tokenCount,
      0,
    );

    this.logger.log(
      `Chunked ${title}: ${processedParents.length} parent chunks, ${totalChildChunks} child chunks, ${totalTokens} tokens`,
    );

    return {
      documentId,
      title,
      parentChunks: processedParents,
      totalTokens,
      totalChildChunks,
      metadata: {
        processedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * 分割为父块
   */
  private splitIntoParentChunks(
    content: string,
    config: ChunkingConfig,
  ): string[] {
    const chunks: string[] = [];
    const sentences = this.splitIntoSentences(content);

    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);

      if (
        currentTokens + sentenceTokens > config.parentChunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push(currentChunk.join(" "));

        // Keep overlap
        const overlapTokens = config.parentChunkOverlap;
        let keptTokens = 0;
        const overlapSentences: string[] = [];

        for (
          let i = currentChunk.length - 1;
          i >= 0 && keptTokens < overlapTokens;
          i--
        ) {
          overlapSentences.unshift(currentChunk[i]);
          keptTokens += this.estimateTokens(currentChunk[i]);
        }

        currentChunk = overlapSentences;
        currentTokens = keptTokens;
      }

      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
    }

    return chunks;
  }

  /**
   * 分割为子块
   */
  private splitIntoChildChunks(
    parentContent: string,
    config: ChunkingConfig,
  ): string[] {
    const chunks: string[] = [];
    const sentences = this.splitIntoSentences(parentContent);

    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);

      if (
        currentTokens + sentenceTokens > config.childChunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push(currentChunk.join(" "));

        // Keep overlap
        const overlapTokens = config.childChunkOverlap;
        let keptTokens = 0;
        const overlapSentences: string[] = [];

        for (
          let i = currentChunk.length - 1;
          i >= 0 && keptTokens < overlapTokens;
          i--
        ) {
          overlapSentences.unshift(currentChunk[i]);
          keptTokens += this.estimateTokens(currentChunk[i]);
        }

        currentChunk = overlapSentences;
        currentTokens = keptTokens;
      }

      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
    }

    // If parent is too short, return as single child
    if (chunks.length === 0 && parentContent.trim().length > 0) {
      chunks.push(parentContent.trim());
    }

    return chunks;
  }

  /**
   * 分割为句子
   */
  private splitIntoSentences(text: string): string[] {
    const sentences = text
      .split(/(?<=[.!?])\s+|(?<=\n)\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Merge short sentences
    const merged: string[] = [];
    let current = "";

    for (const sentence of sentences) {
      if (current.length > 0 && this.estimateTokens(current) < 20) {
        current += " " + sentence;
      } else {
        if (current.length > 0) {
          merged.push(current);
        }
        current = sentence;
      }
    }

    if (current.length > 0) {
      merged.push(current);
    }

    return merged;
  }

  /**
   * 提取章节标题
   */
  private extractSectionTitle(content: string): string | undefined {
    const firstLine = content.split("\n")[0]?.trim();
    if (!firstLine) return undefined;

    if (
      firstLine.length < 100 &&
      (/^#{1,6}\s+/.test(firstLine) ||
        /^[0-9一二三四五六七八九十]+[.、]/.test(firstLine) ||
        /^第[一二三四五六七八九十\d]+[章节部分]/.test(firstLine))
    ) {
      return firstLine.replace(/^#+\s*/, "").trim();
    }

    return undefined;
  }

  /**
   * 估算 Token 数量
   *
   * 中文: ~1.5 字符/token
   * 英文: ~4 字符/token
   */
  estimateTokens(text: string): number {
    if (!text) return 0;

    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;

    const chineseTokens = chineseChars / 1.5;
    const otherTokens = otherChars / 4;

    return Math.ceil(chineseTokens + otherTokens);
  }
}
