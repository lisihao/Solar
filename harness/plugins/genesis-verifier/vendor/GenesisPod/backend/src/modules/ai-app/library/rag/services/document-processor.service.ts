/**
 * Document Processor Service
 * Implements Parent-Child chunking strategy for RAG
 *
 * Strategy:
 * - Parent chunks: ~2000 tokens for rich context in final response
 * - Child chunks: ~400 tokens for precise vector search
 * - Each child chunk maintains reference to its parent
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseStatus, Prisma } from "@prisma/client";
import {
  ProcessedDocument,
  ParentChunkData,
} from "@/modules/ai-harness/facade";
import type { ChunkingConfig } from "@/modules/ai-harness/facade";
import { DEFAULT_CHUNKING_CONFIG } from "@/modules/ai-harness/facade";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { v4: uuidv4 } = require("uuid") as { v4: () => string };

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process a document into parent-child chunks
   */
  async processDocument(
    documentId: string,
    content: string,
    title: string,
    config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
  ): Promise<ProcessedDocument> {
    this.logger.log(`Processing document: ${title} (${documentId})`);

    // Split into parent chunks with section detection
    const parentChunks = this.splitIntoParentChunks(content, config);

    // Track approximate page position
    let currentPage = 1;
    let tokensInCurrentPage = 0;
    const TOKENS_PER_PAGE = 500; // ~500 tokens per page approximation

    // Split each parent into child chunks
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

        // Extract section title from first line if it looks like a heading
        const sectionTitle = this.extractSectionTitle(parentContent);

        const childChunks = this.splitIntoChildChunks(
          parentContent,
          parentIndex,
          config,
        );

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
            documentId,
          })),
        };
      },
    );

    const result: ProcessedDocument = {
      documentId,
      title,
      parentChunks: processedParents,
      metadata: {
        sourceType: "document",
        processedAt: new Date(),
      },
    };

    this.logger.log(
      `Processed ${title}: ${processedParents.length} parent chunks, ` +
        `${processedParents.reduce((sum: number, p: ParentChunkData) => sum + p.childChunks.length, 0)} child chunks`,
    );

    return result;
  }

  /**
   * Extract section title from content if first line looks like a heading
   */
  private extractSectionTitle(content: string): string | undefined {
    const firstLine = content.split("\n")[0]?.trim();
    if (!firstLine) return undefined;

    // Check if first line looks like a heading (short, starts with #, number, or Chinese number)
    if (
      firstLine.length < 100 &&
      (/^#{1,6}\s+/.test(firstLine) || // Markdown heading
        /^[0-9一二三四五六七八九十]+[.、]/.test(firstLine) || // Numbered heading
        /^第[一二三四五六七八九十\d]+[章节部分]/.test(firstLine)) // Chinese chapter/section
    ) {
      return firstLine.replace(/^#+\s*/, "").trim();
    }

    return undefined;
  }

  /**
   * Save processed document to database
   */
  async saveProcessedDocument(
    _knowledgeBaseId: string,
    documentId: string,
    processed: ProcessedDocument,
  ): Promise<void> {
    this.logger.log(`Saving processed document: ${processed.title}`);

    // Delete existing chunks for this document
    await this.prisma.parentChunk.deleteMany({
      where: { documentId },
    });

    // Create parent chunks with child chunks
    for (const parent of processed.parentChunks) {
      await this.prisma.parentChunk.create({
        data: {
          id: parent.id,
          documentId,
          content: parent.content,
          tokenCount: parent.tokenCount,
          position: parent.position,
          pageStart: parent.pageStart,
          pageEnd: parent.pageEnd,
          sectionTitle: parent.sectionTitle,
          metadata: (parent.metadata || {}) as Prisma.InputJsonValue,
          childChunks: {
            create: parent.childChunks.map(
              (child: ParentChunkData["childChunks"][number]) => ({
              id: child.id,
              content: child.content,
              tokenCount: child.tokenCount,
              position: child.position,
              documentId: child.documentId || documentId,
              }),
            ),
          },
        },
      });
    }

    // Update document status
    await this.prisma.knowledgeBaseDocument.update({
      where: { id: documentId },
      data: {
        status: KnowledgeBaseStatus.READY,
        processedAt: new Date(),
        chunkCount: processed.parentChunks.reduce(
          (sum: number, p: ParentChunkData) => sum + p.childChunks.length,
          0,
        ),
      },
    });

    const totalTokens = processed.parentChunks.reduce(
      (sum: number, p: ParentChunkData) => sum + p.tokenCount,
      0,
    );
    this.logger.log(
      `Saved ${processed.parentChunks.length} parent chunks with ${totalTokens} total tokens`,
    );
  }

  /**
   * Split content into parent chunks with overlap
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

      // If adding this sentence exceeds the limit, save current chunk
      if (
        currentTokens + sentenceTokens > config.parentChunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push(currentChunk.join(" "));

        // Keep overlap sentences
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

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "));
    }

    return chunks;
  }

  /**
   * Split parent chunk into child chunks with overlap
   */
  private splitIntoChildChunks(
    parentContent: string,
    _parentIndex: number,
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

        // Keep overlap sentences
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

    // If parent is too short, just return it as a single child
    if (chunks.length === 0 && parentContent.trim().length > 0) {
      chunks.push(parentContent.trim());
    }

    return chunks;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Split on common sentence boundaries
    // Handles: periods, question marks, exclamation marks, and newlines
    const sentences = text
      .split(/(?<=[.!?])\s+|(?<=\n)\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Merge very short sentences
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
   * Estimate token count for text
   * Uses approximation: ~4 characters per token for English
   * Adjusts for Chinese: ~1.5 characters per token
   */
  estimateTokens(text: string): number {
    if (!text) return 0;

    // Count Chinese characters
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;

    // Chinese: ~1.5 chars per token, English: ~4 chars per token
    const chineseTokens = chineseChars / 1.5;
    const otherTokens = otherChars / 4;

    return Math.ceil(chineseTokens + otherTokens);
  }

  /**
   * Process all pending documents in a knowledge base
   */
  async processAllPendingDocuments(knowledgeBaseId: string): Promise<number> {
    const pendingDocs = await this.prisma.knowledgeBaseDocument.findMany({
      where: {
        knowledgeBaseId,
        status: KnowledgeBaseStatus.PENDING,
      },
    });

    this.logger.log(
      `Processing ${pendingDocs.length} pending documents for KB ${knowledgeBaseId}`,
    );

    let processed = 0;

    for (const doc of pendingDocs) {
      try {
        const result = await this.processDocument(
          doc.id,
          doc.rawContent,
          doc.title,
        );

        await this.saveProcessedDocument(knowledgeBaseId, doc.id, result);
        processed++;
      } catch (error) {
        this.logger.error(
          `Failed to process document ${doc.id}: ${error instanceof Error ? error.message : error}`,
        );

        await this.prisma.knowledgeBaseDocument.update({
          where: { id: doc.id },
          data: {
            status: KnowledgeBaseStatus.ERROR,
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return processed;
  }
}
