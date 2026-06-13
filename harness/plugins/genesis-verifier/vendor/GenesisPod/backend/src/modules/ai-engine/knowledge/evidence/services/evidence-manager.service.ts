/**
 * Evidence Manager Service
 * 证据管理服务 - 存储、检索和管理证据
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { Prisma, Evidence as PrismaEvidence } from "@prisma/client";
import {
  IEvidenceManager,
  Evidence,
  EvidenceType,
  SaveEvidenceRequest,
  RetrieveEvidenceRequest,
  EvidenceStats,
  CitationStyle,
} from "../abstractions/evidence.interface";
import { CitationFormatterService } from "./citation-formatter.service";

/**
 * 证据管理服务
 */
@Injectable()
export class EvidenceManagerService implements IEvidenceManager {
  private readonly logger = new Logger(EvidenceManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citationFormatter: CitationFormatterService,
  ) {}

  /**
   * 保存证据
   */
  async save(request: SaveEvidenceRequest): Promise<Evidence> {
    this.logger.debug(
      `Saving evidence of type ${request.type} for ${request.associations.entityType}:${request.associations.entityId}`,
    );

    const evidence = await this.prisma.evidence.create({
      data: {
        type: request.type,
        sourceUrl: request.source.url,
        sourceTitle: request.source.title,
        sourceAuthor: request.source.author,
        sourcePublishedAt: request.source.publishedAt,
        sourceDomain: request.source.domain,
        sourcePublisher: request.source.publisher,
        contentOriginal: request.content.original,
        contentSnippet: request.content.snippet,
        contentUsedPortion: request.content.usedPortion,
        entityType: request.associations.entityType,
        entityId: request.associations.entityId,
        location: request.associations.location,
        context: request.associations.context,
        relevanceScore: request.relevanceScore ?? 0.5,
        credibilityScore: request.credibilityScore,
        citationCount: 0,
        createdBy: request.createdBy,
      },
    });

    return this.mapToEvidence(evidence);
  }

  /**
   * 批量保存
   * 分批处理以避免事务超时，每批最多 100 条
   */
  async saveBatch(requests: SaveEvidenceRequest[]): Promise<Evidence[]> {
    this.logger.debug(`Batch saving ${requests.length} evidence records`);

    const BATCH_SIZE = 100;
    const results: Evidence[] = [];

    // ★ 分批处理大批量操作
    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      const batch = requests.slice(i, i + BATCH_SIZE);

      try {
        // ★ 使用回调函数形式的事务以支持 timeout 选项
        const evidences = await this.prisma.$transaction(
          async (tx: Prisma.TransactionClient) => {
            const createPromises = batch.map((request) =>
              tx.evidence.create({
                data: {
                  type: request.type,
                  sourceUrl: request.source.url,
                  sourceTitle: request.source.title,
                  sourceAuthor: request.source.author,
                  sourcePublishedAt: request.source.publishedAt,
                  sourceDomain: request.source.domain,
                  sourcePublisher: request.source.publisher,
                  contentOriginal: request.content.original,
                  contentSnippet: request.content.snippet,
                  contentUsedPortion: request.content.usedPortion,
                  entityType: request.associations.entityType,
                  entityId: request.associations.entityId,
                  location: request.associations.location,
                  context: request.associations.context,
                  relevanceScore: request.relevanceScore ?? 0.5,
                  credibilityScore: request.credibilityScore,
                  citationCount: 0,
                  createdBy: request.createdBy,
                },
              }),
            );
            return Promise.all(createPromises);
          },
          { timeout: 30000 },
        ); // ★ 30 秒超时

        results.push(
          ...evidences.map((e: PrismaEvidence) => this.mapToEvidence(e)),
        );
      } catch (error) {
        this.logger.error(`Batch ${i}-${i + batch.length} failed: ${error}`);
        throw error;
      }
    }

    return results;
  }

  /**
   * 检索证据
   */
  async retrieve(request: RetrieveEvidenceRequest): Promise<Evidence[]> {
    const where: Record<string, unknown> = {};

    if (request.entityType) {
      where.entityType = request.entityType;
    }
    if (request.entityId) {
      where.entityId = request.entityId;
    }
    if (request.types?.length) {
      where.type = { in: request.types };
    }
    if (request.minRelevanceScore !== undefined) {
      where.relevanceScore = { gte: request.minRelevanceScore };
    }
    if (request.minCredibilityScore !== undefined) {
      where.credibilityScore = { gte: request.minCredibilityScore };
    }

    const orderBy: Record<string, string> = {};
    if (request.sortBy) {
      orderBy[
        request.sortBy === "relevance"
          ? "relevanceScore"
          : request.sortBy === "credibility"
            ? "credibilityScore"
            : "createdAt"
      ] = request.sortOrder ?? "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const evidences = await this.prisma.evidence.findMany({
      where,
      orderBy,
      take: request.limit ?? 50,
      skip: request.offset ?? 0,
    });

    return evidences.map((e: PrismaEvidence) => this.mapToEvidence(e));
  }

  /**
   * 获取单条证据
   */
  async getById(id: string): Promise<Evidence | null> {
    const evidence = await this.prisma.evidence.findUnique({
      where: { id },
    });

    return evidence ? this.mapToEvidence(evidence) : null;
  }

  /**
   * 更新证据
   */
  async update(id: string, updates: Partial<Evidence>): Promise<Evidence> {
    const data: Record<string, unknown> = {};

    if (updates.source) {
      if (updates.source.url !== undefined) data.sourceUrl = updates.source.url;
      if (updates.source.title !== undefined)
        data.sourceTitle = updates.source.title;
      if (updates.source.author !== undefined)
        data.sourceAuthor = updates.source.author;
    }
    if (updates.content) {
      if (updates.content.snippet !== undefined)
        data.contentSnippet = updates.content.snippet;
      if (updates.content.usedPortion !== undefined)
        data.contentUsedPortion = updates.content.usedPortion;
    }
    if (updates.metadata?.relevanceScore !== undefined) {
      data.relevanceScore = updates.metadata.relevanceScore;
    }
    if (updates.metadata?.credibilityScore !== undefined) {
      data.credibilityScore = updates.metadata.credibilityScore;
    }

    const evidence = await this.prisma.evidence.update({
      where: { id },
      data,
    });

    return this.mapToEvidence(evidence);
  }

  /**
   * 删除证据
   */
  async delete(id: string): Promise<void> {
    await this.prisma.evidence.delete({
      where: { id },
    });
    this.logger.debug(`Deleted evidence ${id}`);
  }

  /**
   * 增加引用计数
   */
  async incrementCitationCount(id: string): Promise<void> {
    await this.prisma.evidence.update({
      where: { id },
      data: {
        citationCount: { increment: 1 },
      },
    });
  }

  /**
   * 获取实体的证据统计
   */
  async getStats(entityType: string, entityId: string): Promise<EvidenceStats> {
    const evidences = await this.prisma.evidence.findMany({
      where: { entityType, entityId },
      select: {
        type: true,
        relevanceScore: true,
        credibilityScore: true,
      },
    });

    const byType: Record<EvidenceType, number> = {
      CITATION: 0,
      REFERENCE: 0,
      INSPIRATION: 0,
      FACT: 0,
      QUOTE: 0,
    };

    let totalRelevance = 0;
    let totalCredibility = 0;
    let credibilityCount = 0;

    for (const e of evidences) {
      byType[e.type as EvidenceType] =
        (byType[e.type as EvidenceType] || 0) + 1;
      totalRelevance += e.relevanceScore || 0;
      if (e.credibilityScore !== null) {
        totalCredibility += e.credibilityScore;
        credibilityCount++;
      }
    }

    return {
      totalCount: evidences.length,
      byType,
      avgRelevanceScore:
        evidences.length > 0 ? totalRelevance / evidences.length : 0,
      avgCredibilityScore:
        credibilityCount > 0 ? totalCredibility / credibilityCount : 0,
    };
  }

  /**
   * 生成引用格式
   */
  formatCitation(evidence: Evidence, style: CitationStyle): string {
    return this.citationFormatter.format(evidence, style);
  }

  /**
   * 批量生成引用
   */
  async generateBibliography(
    entityType: string,
    entityId: string,
    style: CitationStyle,
  ): Promise<string> {
    const evidences = await this.retrieve({
      entityType,
      entityId,
      types: ["CITATION", "REFERENCE"],
      sortBy: "createdAt",
      sortOrder: "asc",
    });

    if (evidences.length === 0) {
      return "";
    }

    const citations = evidences.map((e) => this.formatCitation(e, style));
    return this.citationFormatter.formatBibliography(citations, style);
  }

  /**
   * 映射数据库记录到 Evidence 类型
   */
  private mapToEvidence(record: PrismaEvidence): Evidence {
    return {
      id: record.id,
      type: record.type as EvidenceType,
      source: {
        url: record.sourceUrl ?? undefined,
        title: record.sourceTitle,
        author: record.sourceAuthor ?? undefined,
        publishedAt: record.sourcePublishedAt ?? undefined,
        domain: record.sourceDomain ?? undefined,
        publisher: record.sourcePublisher ?? undefined,
      },
      content: {
        original: record.contentOriginal,
        snippet: record.contentSnippet ?? undefined,
        usedPortion: record.contentUsedPortion ?? undefined,
      },
      associations: {
        entityType: record.entityType,
        entityId: record.entityId,
        location: record.location ?? undefined,
        context: record.context ?? undefined,
      },
      metadata: {
        relevanceScore: record.relevanceScore,
        credibilityScore: record.credibilityScore ?? undefined,
        citationCount: record.citationCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        createdBy: record.createdBy ?? undefined,
      },
    };
  }
}


