/**
 * Knowledge Base Service
 * Manages knowledge bases and their documents
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  ContentVisibility,
  KnowledgeBaseStatus,
  KnowledgeBaseSourceType,
} from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { DocumentProcessorService } from "./document-processor.service";
import { EmbeddingProcessorService } from "./embedding-processor.service";
import { KnowledgeBaseStats } from "@/modules/ai-harness/facade";
import { PreparseService } from "../../document/preparse";

export interface CreateKnowledgeBaseInput {
  name: string;
  description?: string;
  sourceType: KnowledgeBaseSourceType;
  sourceTypes?: string[]; // 多数据源类型
  googleDriveConnectionId?: string;
  googleDriveFolderIds?: string[];
  googleDriveFileIds?: string[]; // 单独选择的文件 IDs
  type?: "PERSONAL" | "TEAM"; // 知识库类型
  teamId?: string; // 团队ID（团队知识库时必需）
}

export interface AddDocumentInput {
  title: string;
  sourceType: string;
  sourceId?: string;
  sourceUrl?: string;
  mimeType?: string;
  content: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- document metadata shape varies by ingestion source
  metadata?: Record<string, any>;
}

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly embeddingProcessor: EmbeddingProcessorService,
    // W1 v2.0 rebuild：addDocument 后 fire-and-forget 预解析 URL/YT → 富语料 +
    //   图片 URL + 章节结构 + 源语种，落 metadata.preparse 给 W2 wiki ingest 消费。
    //   @Optional 注入保 spec 兼容（旧 spec 未 mock 时不挂）。
    @Optional() private readonly preparseService?: PreparseService,
  ) {}

  /**
   * Sanitize string by removing NULL bytes and other invalid characters
   * PostgreSQL doesn't allow NULL bytes (0x00) in text fields
   */
  private sanitizeString(input: string | undefined | null): string {
    if (!input) return "";
    // Remove NULL bytes and other control characters except newlines and tabs
    return input
      .replace(/\x00/g, "")
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }

  /**
   * Create a new knowledge base
   */
  async create(userId: string, input: CreateKnowledgeBaseInput) {
    this.logger.log(
      `Creating knowledge base: ${input.name} for user ${userId}`,
    );

    // Auto-detect Google Drive connection if GOOGLE_DRIVE is in sourceTypes
    let googleDriveConnectionId = input.googleDriveConnectionId;
    const hasGoogleDrive =
      input.sourceType === KnowledgeBaseSourceType.GOOGLE_DRIVE ||
      input.sourceTypes?.includes("GOOGLE_DRIVE");

    if (hasGoogleDrive && !googleDriveConnectionId) {
      const connection = await this.prisma.googleDriveConnection.findUnique({
        where: { userId },
      });
      if (connection) {
        googleDriveConnectionId = connection.id;
        this.logger.log(
          `Auto-detected Google Drive connection: ${connection.id} for user ${userId}`,
        );
      } else {
        throw new Error(
          "No Google Drive connection found. Please connect Google Drive first.",
        );
      }
    }

    // 如果没有提供 sourceTypes，则使用 sourceType 作为默认值
    const sourceTypes = input.sourceTypes?.length
      ? input.sourceTypes
      : [input.sourceType];

    const kb = await this.prisma.knowledgeBase.create({
      data: {
        name: input.name,
        description: input.description,
        sourceType: input.sourceType,
        sourceTypes, // 多数据源类型数组
        status: KnowledgeBaseStatus.PENDING,
        userId,
        type: input.type || "PERSONAL", // 默认为个人知识库
        teamId: input.teamId,
        googleDriveConnectionId,
        googleDriveFolderIds: input.googleDriveFolderIds || [],
        googleDriveFileIds: input.googleDriveFileIds || [], // 单独选择的文件
      },
    });

    this.logger.log(
      `Knowledge base created: ${kb.id}, type: ${kb.type}, teamId: ${kb.teamId}`,
    );

    return kb;
  }

  /**
   * Get knowledge base by ID
   * Uses Prisma ORM to automatically handle type conversions
   * Supports both owner access and team member access
   */
  async findById(id: string, userId?: string) {
    // Build where clause: if userId provided, check ownership OR team membership
    const whereClause = userId
      ? {
          id,
          OR: [
            { userId }, // User is owner
            {
              type: "TEAM" as const,
              members: {
                some: { userId }, // User is team member
              },
            },
          ],
        }
      : { id };

    const kb = await this.prisma.knowledgeBase.findFirst({
      where: whereClause,
      include: {
        documents: {
          select: {
            id: true,
            title: true,
            sourceType: true,
            status: true,
            chunkCount: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
        googleDriveConnection: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    return kb;
  }

  /**
   * Get Resources by IDs for platform_resource import
   * Fetches content fields needed for KB document creation
   * For YouTube videos, also fetches transcript from cache
   */
  async getResourcesByIds(resourceIds: string[]) {
    if (!resourceIds.length) return [];

    const resources = await this.prisma.resource.findMany({
      where: {
        id: { in: resourceIds },
      },
      select: {
        id: true,
        title: true,
        content: true,
        abstract: true,
        aiSummary: true,
        sourceUrl: true,
        type: true,
      },
    });

    // For YouTube videos, try to get transcript content
    const youtubeResources = resources.filter(
      (r) => r.type === "YOUTUBE_VIDEO",
    );
    if (youtubeResources.length > 0) {
      const videoIds = youtubeResources
        .map((r) => this.extractYoutubeVideoId(r.sourceUrl))
        .filter(Boolean) as string[];

      if (videoIds.length > 0) {
        const transcripts = await this.prisma.youTubeTranscriptCache.findMany({
          where: { videoId: { in: videoIds } },
          select: { videoId: true, transcript: true },
        });

        const transcriptMap = new Map(
          transcripts.map((t: { videoId: string; transcript: unknown }) => [
            t.videoId,
            t.transcript,
          ]),
        );

        // Merge transcript content into resources
        for (const resource of resources) {
          if (resource.type === "YOUTUBE_VIDEO" && !resource.content) {
            const videoId = this.extractYoutubeVideoId(resource.sourceUrl);
            if (videoId && transcriptMap.has(videoId)) {
              const transcript = transcriptMap.get(videoId);
              if (Array.isArray(transcript)) {
                // Convert transcript segments to text
                resource.content = transcript
                  .map(
                    (seg: Record<string, unknown>) =>
                      (seg["text"] as string) || "",
                  )
                  .join(" ");
              }
            }
          }
        }
      }
    }

    return resources;
  }

  /**
   * Extract YouTube video ID from URL
   */
  private extractYoutubeVideoId(url: string | null): string | null {
    if (!url) return null;
    const match = url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    );
    return match ? match[1] : null;
  }

  /**
   * List knowledge bases for user (includes both owned and member-of)
   * Split OR into two parallel queries for better index utilization
   */
  async findByUser(userId: string) {
    this.logger.debug(
      `[findByUser] Fetching knowledge bases for user: ${userId}`,
    );

    const includeClause = {
      _count: { select: { documents: true } },
      members: { select: { id: true } },
    };

    // Parallel queries: each uses its own index efficiently
    // Query 1: @@index([userId]) on knowledge_bases
    // Query 2: @@index([userId]) on knowledge_base_members + @@index([type]) on knowledge_bases
    const [owned, teamMember] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where: { userId },
        include: includeClause,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.knowledgeBase.findMany({
        where: {
          type: "TEAM",
          members: { some: { userId } },
        },
        include: includeClause,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Merge and deduplicate (user may own a TEAM kb and also be a member)
    const seen = new Set(owned.map((kb) => kb.id));
    const merged = [...owned, ...teamMember.filter((kb) => !seen.has(kb.id))];
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    this.logger.debug(
      `[findByUser] Found ${merged.length} knowledge bases: ${merged.map((kb) => `${kb.name}(${kb.status})`).join(", ")}`,
    );

    return merged;
  }

  /**
   * Update knowledge base
   */
  async update(
    id: string,
    userId: string,
    data: {
      name?: string;
      description?: string;
      sourceTypes?: string[];
      googleDriveFolderIds?: string[];
      googleDriveFileIds?: string[];
    },
  ) {
    // Get existing KB and verify ownership
    const existingKb = await this.findById(id, userId);

    // Build update data
    const updateData: {
      name?: string;
      description?: string;
      sourceTypes?: string[];
      googleDriveFolderIds?: string[];
      googleDriveFileIds?: string[];
      googleDriveConnectionId?: string;
    } = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.sourceTypes !== undefined)
      updateData.sourceTypes = data.sourceTypes;
    if (data.googleDriveFolderIds !== undefined)
      updateData.googleDriveFolderIds = data.googleDriveFolderIds;
    if (data.googleDriveFileIds !== undefined)
      updateData.googleDriveFileIds = data.googleDriveFileIds;

    // Auto-connect Google Drive if it's being added as a source type
    const hasGoogleDrive = data.sourceTypes?.includes("GOOGLE_DRIVE");
    const needsConnection =
      hasGoogleDrive && !existingKb.googleDriveConnectionId;

    if (needsConnection) {
      const connection = await this.prisma.googleDriveConnection.findUnique({
        where: { userId },
      });
      if (connection) {
        updateData.googleDriveConnectionId = connection.id;
        this.logger.log(
          `Auto-connected Google Drive: ${connection.id} for KB ${id}`,
        );
      } else {
        throw new Error(
          "No Google Drive connection found. Please connect Google Drive first.",
        );
      }
    }

    return this.prisma.knowledgeBase.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * 多租户可见性切换（仅所有者，owner check via userId field）。
   */
  async updateVisibility(
    userId: string,
    kbId: string,
    visibility: ContentVisibility,
  ) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      select: { userId: true },
    });
    if (!kb) throw new NotFoundException("Knowledge base not found");
    if (kb.userId !== userId) throw new ForbiddenException("Not owner");
    return this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: { visibility },
    });
  }

  /**
   * Delete knowledge base and all associated data
   */
  async delete(id: string, userId: string) {
    // Verify ownership (throws if not found)
    await this.findById(id, userId);

    // Delete in correct order due to foreign keys
    // Child embeddings -> Child chunks -> Parent chunks -> Documents -> KB
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        DELETE FROM child_embeddings
        WHERE child_chunk_id IN (
          SELECT cc.id FROM child_chunks cc
          JOIN parent_chunks pc ON cc.parent_chunk_id = pc.id
          JOIN knowledge_base_documents d ON pc.document_id = d.id
          WHERE d.knowledge_base_id = ${id}::text
        )
      `,
      this.prisma.childChunk.deleteMany({
        where: {
          parentChunk: {
            document: {
              knowledgeBaseId: id,
            },
          },
        },
      }),
      this.prisma.parentChunk.deleteMany({
        where: {
          document: {
            knowledgeBaseId: id,
          },
        },
      }),
      this.prisma.knowledgeBaseDocument.deleteMany({
        where: { knowledgeBaseId: id },
      }),
      this.prisma.knowledgeBase.delete({
        where: { id },
      }),
    ]);

    this.logger.log(`Deleted knowledge base ${id}`);
  }

  /**
   * Add document to knowledge base
   */
  async addDocument(knowledgeBaseId: string, input: AddDocumentInput) {
    this.logger.log(`Adding document to KB ${knowledgeBaseId}: ${input.title}`);

    // Sanitize string fields to remove NULL bytes that PostgreSQL doesn't accept
    const sanitizedTitle = this.sanitizeString(input.title);
    const sanitizedContent = this.sanitizeString(input.content);
    const sanitizedSourceUrl = this.sanitizeString(input.sourceUrl);

    const doc = await this.prisma.knowledgeBaseDocument.create({
      data: {
        knowledgeBaseId,
        title: sanitizedTitle || "Untitled",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceUrl: sanitizedSourceUrl || undefined,
        mimeType: input.mimeType,
        rawContent: sanitizedContent,
        status: KnowledgeBaseStatus.PENDING,
        metadata: input.metadata || {},
      },
    });

    // W1 v2.0 rebuild：fire-and-forget 触发预解析（URL/YT 抓富语料 + 图片 +
    //   章节 + 源语种）。preparse 异常完全 swallow + log，不阻断 doc 写入返回。
    //   不传 await：用户体验是"加 doc 立即返回，预解析后台跑"。
    if (this.preparseService) {
      void this.preparseService.preparseDocument(doc.id);
    }

    return doc;
  }

  /**
   * Process all pending documents and generate embeddings
   *
   * 2026-05-12 失败要红：generatedCount=0 但 totalNeeded>0 → ERROR；部分失败也 ERROR
   * 携带 lastError，前端可见后点重试。原行为是无论 0/X 一律 READY + lastSyncedAt 撒谎。
   */
  async processAllDocuments(knowledgeBaseId: string) {
    this.logger.log(`Processing all documents for KB ${knowledgeBaseId}`);

    // Update KB status
    await this.prisma.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: {
        status: KnowledgeBaseStatus.PROCESSING,
        lastError: null,
      },
    });

    try {
      // Process documents (chunking)
      const processedCount =
        await this.documentProcessor.processAllPendingDocuments(
          knowledgeBaseId,
        );

      // Generate embeddings
      const embedResult =
        await this.embeddingProcessor.generateEmbeddingsForKnowledgeBase(
          knowledgeBaseId,
        );

      // 全失败：0/N → 红
      if (embedResult.totalNeeded > 0 && embedResult.generatedCount === 0) {
        const errMsg = this.buildEmbedErrorMessage(embedResult);
        await this.prisma.knowledgeBase.update({
          where: { id: knowledgeBaseId },
          data: {
            status: KnowledgeBaseStatus.ERROR,
            lastError: errMsg,
          },
        });
        this.logger.error(
          `KB ${knowledgeBaseId}: vectorization failed entirely. ${errMsg}`,
        );
        return {
          processedCount,
          embeddingCount: 0,
          totalNeeded: embedResult.totalNeeded,
          failedBatches: embedResult.failedBatches,
          error: errMsg,
        };
      }

      // 部分失败：X/N → 也算红，但保留已成功的向量
      if (embedResult.generatedCount < embedResult.totalNeeded) {
        const errMsg = this.buildEmbedErrorMessage(embedResult);
        await this.prisma.knowledgeBase.update({
          where: { id: knowledgeBaseId },
          data: {
            status: KnowledgeBaseStatus.ERROR,
            lastError: errMsg,
          },
        });
        this.logger.warn(
          `KB ${knowledgeBaseId}: partial vectorization ${embedResult.generatedCount}/${embedResult.totalNeeded}. ${errMsg}`,
        );
        return {
          processedCount,
          embeddingCount: embedResult.generatedCount,
          totalNeeded: embedResult.totalNeeded,
          failedBatches: embedResult.failedBatches,
          error: errMsg,
        };
      }

      // 全部成功
      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: {
          status: KnowledgeBaseStatus.READY,
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });

      this.logger.log(
        `KB ${knowledgeBaseId}: processed ${processedCount} docs, ${embedResult.generatedCount} embeddings`,
      );

      return {
        processedCount,
        embeddingCount: embedResult.generatedCount,
        totalNeeded: embedResult.totalNeeded,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: {
          status: KnowledgeBaseStatus.ERROR,
          lastError: msg,
        },
      });
      throw error;
    }
  }

  private buildEmbedErrorMessage(result: {
    generatedCount: number;
    totalNeeded: number;
    failedBatches: number;
    lastError?: string;
  }): string {
    const head =
      result.generatedCount === 0
        ? `向量化失败：${result.totalNeeded} 个分块全部失败`
        : `向量化部分失败：完成 ${result.generatedCount}/${result.totalNeeded}`;
    const tail = result.lastError
      ? `（${this.summarizeError(result.lastError)}）`
      : "";
    return `${head}${tail}`;
  }

  private summarizeError(raw: string): string {
    if (/429|rate.?limit|too many requests/i.test(raw))
      return "上游限流 429，请稍后重试";
    if (/circuit-open/i.test(raw))
      return "Embedding 服务熔断冷却中，请稍后重试";
    if (/401|unauthorized|invalid.*api.?key/i.test(raw))
      return "Embedding 模型 API Key 无效或失效，请检查 Admin > AI Models";
    return raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
  }

  /**
   * 取 KB 当前向量化进度（用于前端轮询）
   */
  async getProgress(knowledgeBaseId: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { status: true, progressJson: true, lastError: true },
    });
    if (!kb) return null;
    return {
      status: kb.status,
      progress: kb.progressJson,
      lastError: kb.lastError,
    };
  }

  /**
   * Get knowledge base statistics
   */
  async getStats(id: string): Promise<KnowledgeBaseStats> {
    const [docCount, chunkCounts, kb] = await Promise.all([
      this.prisma.knowledgeBaseDocument.count({
        where: { knowledgeBaseId: id },
      }),
      this.prisma.$queryRaw<
        Array<{
          parent_count: bigint;
          child_count: bigint;
          embedding_count: bigint;
          total_tokens: bigint;
        }>
      >`
        SELECT
          COUNT(DISTINCT pc.id) as parent_count,
          COUNT(DISTINCT cc.id) as child_count,
          COUNT(DISTINCT ce.id) as embedding_count,
          COALESCE(SUM(pc.token_count), 0) as total_tokens
        FROM parent_chunks pc
        LEFT JOIN child_chunks cc ON cc.parent_chunk_id = pc.id
        LEFT JOIN child_embeddings ce ON ce.child_chunk_id = cc.id
        JOIN knowledge_base_documents d ON pc.document_id = d.id
        WHERE d.knowledge_base_id = ${id}::text
      `,
      this.prisma.knowledgeBase.findUnique({
        where: { id },
        select: { lastSyncedAt: true },
      }),
    ]);

    const counts = chunkCounts[0] || {
      parent_count: BigInt(0),
      child_count: BigInt(0),
      embedding_count: BigInt(0),
      total_tokens: BigInt(0),
    };

    this.logger.debug(
      `Stats for KB ${id}: docs=${docCount}, parents=${counts.parent_count}, children=${counts.child_count}, embeddings=${counts.embedding_count}, tokens=${counts.total_tokens}`,
    );

    return {
      documentCount: docCount,
      parentChunkCount: Number(counts.parent_count),
      childChunkCount: Number(counts.child_count),
      embeddingCount: Number(counts.embedding_count),
      totalTokens: Number(counts.total_tokens),
      lastSyncedAt: kb?.lastSyncedAt || undefined,
    };
  }

  /**
   * List documents in a knowledge base with vectorization status
   */
  async listDocuments(knowledgeBaseId: string) {
    const documents = await this.prisma.knowledgeBaseDocument.findMany({
      where: { knowledgeBaseId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        sourceType: true,
        sourceUrl: true,
        mimeType: true,
        status: true,
        processedAt: true,
        chunkCount: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        // W1 v2.0 rebuild：暴露 metadata.preparse 让前端 DocumentListDialog 渲染解析徽章
        metadata: true,
      },
    });

    // Get embedding counts for each document
    const embeddingCounts = await this.prisma.$queryRaw<
      Array<{ document_id: string; embedding_count: bigint }>
    >`
      SELECT
        d.id as document_id,
        COUNT(DISTINCT ce.id) as embedding_count
      FROM knowledge_base_documents d
      LEFT JOIN parent_chunks pc ON pc.document_id = d.id
      LEFT JOIN child_chunks cc ON cc.parent_chunk_id = pc.id
      LEFT JOIN child_embeddings ce ON ce.child_chunk_id = cc.id
      WHERE d.knowledge_base_id = ${knowledgeBaseId}::text
      GROUP BY d.id
    `;

    const embeddingMap = new Map(
      embeddingCounts.map((e) => [e.document_id, Number(e.embedding_count)]),
    );

    return documents.map((doc) => ({
      ...doc,
      embeddingCount: embeddingMap.get(doc.id) || 0,
      isVectorized:
        doc.status === "READY" && (embeddingMap.get(doc.id) || 0) > 0,
    }));
  }

  /**
   * Delete a document from knowledge base
   */
  async deleteDocument(documentId: string, userId: string) {
    const doc = await this.prisma.knowledgeBaseDocument.findFirst({
      where: { id: documentId },
      include: {
        knowledgeBase: {
          select: { userId: true },
        },
      },
    });

    if (!doc || doc.knowledgeBase.userId !== userId) {
      throw new NotFoundException("Document not found");
    }

    // Delete embeddings, child chunks, parent chunks, then document
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        DELETE FROM child_embeddings
        WHERE child_chunk_id IN (
          SELECT cc.id FROM child_chunks cc
          JOIN parent_chunks pc ON cc.parent_chunk_id = pc.id
          WHERE pc.document_id = ${documentId}::text
        )
      `,
      this.prisma.childChunk.deleteMany({
        where: {
          parentChunk: { documentId },
        },
      }),
      this.prisma.parentChunk.deleteMany({
        where: { documentId },
      }),
      this.prisma.knowledgeBaseDocument.delete({
        where: { id: documentId },
      }),
    ]);

    this.logger.log(`Deleted document ${documentId}`);
  }

  // ============ 成员管理 (团队知识库) ============

  /**
   * 获取知识库成员列表
   */
  async getMembers(knowledgeBaseId: string, requesterId: string) {
    // 验证请求者有权限查看
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId },
      select: { userId: true, type: true },
    });

    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    // 只有所有者或成员可以查看成员列表
    const isOwner = kb.userId === requesterId;
    const isMember = await this.prisma.knowledgeBaseMember.findFirst({
      where: { knowledgeBaseId, userId: requesterId },
    });

    if (!isOwner && !isMember) {
      throw new NotFoundException("Knowledge base not found");
    }

    return this.prisma.knowledgeBaseMember.findMany({
      where: { knowledgeBaseId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
  }

  /**
   * 添加成员到知识库
   */
  async addMember(
    knowledgeBaseId: string,
    requesterId: string,
    memberEmail: string,
    role: "ADMIN" | "EDITOR" | "VIEWER" = "VIEWER",
  ) {
    // 验证请求者是所有者或管理员
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId },
      select: { userId: true, type: true },
    });

    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    const isOwner = kb.userId === requesterId;
    const requesterMembership = await this.prisma.knowledgeBaseMember.findFirst(
      {
        where: { knowledgeBaseId, userId: requesterId, role: "ADMIN" },
      },
    );

    if (!isOwner && !requesterMembership) {
      throw new Error("You do not have permission to add members");
    }

    // 查找用户
    const user = await this.prisma.user.findFirst({
      where: { email: memberEmail },
    });

    if (!user) {
      throw new NotFoundException(`User with email ${memberEmail} not found`);
    }

    // 检查是否已是成员
    const existingMember = await this.prisma.knowledgeBaseMember.findFirst({
      where: { knowledgeBaseId, userId: user.id },
    });

    if (existingMember) {
      throw new Error("User is already a member");
    }

    // 如果是所有者，不需要添加为成员
    if (kb.userId === user.id) {
      throw new Error("Owner cannot be added as a member");
    }

    const member = await this.prisma.knowledgeBaseMember.create({
      data: {
        knowledgeBaseId,
        userId: user.id,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    this.logger.log(
      `Added member ${user.email} to KB ${knowledgeBaseId} with role ${role}`,
    );

    return member;
  }

  /**
   * 更新成员角色
   */
  async updateMemberRole(
    knowledgeBaseId: string,
    requesterId: string,
    memberId: string,
    role: "ADMIN" | "EDITOR" | "VIEWER",
  ) {
    // 验证请求者是所有者或管理员
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId },
      select: { userId: true },
    });

    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    const isOwner = kb.userId === requesterId;
    const requesterMembership = await this.prisma.knowledgeBaseMember.findFirst(
      {
        where: { knowledgeBaseId, userId: requesterId, role: "ADMIN" },
      },
    );

    if (!isOwner && !requesterMembership) {
      throw new Error("You do not have permission to update member roles");
    }

    // 查找成员
    const member = await this.prisma.knowledgeBaseMember.findFirst({
      where: { id: memberId, knowledgeBaseId },
    });

    if (!member) {
      throw new NotFoundException("Member not found");
    }

    const updated = await this.prisma.knowledgeBaseMember.update({
      where: { id: memberId },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    this.logger.log(
      `Updated member ${memberId} role to ${role} in KB ${knowledgeBaseId}`,
    );

    return updated;
  }

  /**
   * 移除成员
   */
  async removeMember(
    knowledgeBaseId: string,
    requesterId: string,
    memberId: string,
  ) {
    // 验证请求者是所有者或管理员
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId },
      select: { userId: true },
    });

    if (!kb) {
      throw new NotFoundException("Knowledge base not found");
    }

    const isOwner = kb.userId === requesterId;
    const requesterMembership = await this.prisma.knowledgeBaseMember.findFirst(
      {
        where: { knowledgeBaseId, userId: requesterId, role: "ADMIN" },
      },
    );

    if (!isOwner && !requesterMembership) {
      throw new Error("You do not have permission to remove members");
    }

    // 查找成员
    const member = await this.prisma.knowledgeBaseMember.findFirst({
      where: { id: memberId, knowledgeBaseId },
    });

    if (!member) {
      throw new NotFoundException("Member not found");
    }

    await this.prisma.knowledgeBaseMember.delete({
      where: { id: memberId },
    });

    this.logger.log(`Removed member ${memberId} from KB ${knowledgeBaseId}`);
  }

  /**
   * Get document by ID (for search result enhancement)
   */
  async getDocumentById(documentId: string) {
    return this.prisma.knowledgeBaseDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        sourceType: true,
        sourceUrl: true,
        mimeType: true,
      },
    });
  }

  /**
   * 检查用户是否有知识库访问权限
   */
  async hasAccess(
    knowledgeBaseId: string,
    userId: string,
    minRole?: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER",
  ): Promise<boolean> {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId },
      select: { userId: true, type: true },
    });

    if (!kb) return false;

    // 所有者总是有访问权限
    if (kb.userId === userId) return true;

    // 团队知识库检查成员资格
    if (kb.type !== "PERSONAL") {
      const member = await this.prisma.knowledgeBaseMember.findFirst({
        where: { knowledgeBaseId, userId },
      });
      if (member) {
        if (!minRole || minRole === "VIEWER") return true;
        const roleHierarchy = { OWNER: 0, ADMIN: 1, EDITOR: 2, VIEWER: 3 };
        if (roleHierarchy[member.role] <= roleHierarchy[minRole]) return true;
      }
    }

    // Platform admin bypass: User.role === 'ADMIN' grants full access to any KB
    // (per product decision 2026-05-09: platform admins manage all KBs).
    // Checked last so owner / KbMember short-circuit before this extra query.
    // findFirst (not findUnique) keeps spec mocks portable since both existing
    // KB service specs only stub user.findFirst.
    const platformUser = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { role: true },
    });
    return platformUser?.role === "ADMIN";
  }
}
