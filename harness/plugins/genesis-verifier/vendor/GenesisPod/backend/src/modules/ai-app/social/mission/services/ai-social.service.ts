import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ContentCheckerService } from "./content-checker.service";
import { SocialPipelineDispatcher } from "../pipeline/social-pipeline-dispatcher.service";
import { CreateContentDto } from "../../api/dto/create-content.dto";
import { UpdateContentDto } from "../../api/dto/update-content.dto";
import { PublishContentDto } from "../../api/dto/publish-content.dto";
import { SocialContentStatus, SocialContentSourceType } from "../types";
import {
  MissionExecutorService,
  MissionContext,
} from "@/modules/ai-harness/facade";
import { LruMap } from "@/common/utils/lru-map";

@Injectable()
export class AiSocialService {
  private readonly logger = new Logger(AiSocialService.name);
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentChecker: ContentCheckerService,
    private readonly dispatcher: SocialPipelineDispatcher,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
  ) {}

  // ==================== 平台连接 / XHS MCP ====================
  // 移到 SocialConnectionsService (connections/init/verify/delete/test/refresh +
  //   session 校验 + XHS MCP 连接) 和 XhsMcpFacadeService (6 feature 方法)
  //   ——god class 减重 phase 2.A.1 / A.2 (2026-05-27)

  // ==================== 内容管理 ====================

  /**
   * 内容查询结果类型
   */
  private readonly CONTENT_SELECT_FIELDS = Prisma.sql`
    sc.id,
    sc.user_id AS "userId",
    sc.connection_id AS "connectionId",
    sc.content_type AS "contentType",
    sc.source_type AS "sourceType",
    sc.source_id AS "sourceId",
    sc.source_url AS "sourceUrl",
    sc.title,
    sc.content,
    sc.author,
    sc.digest,
    sc.cover_image_url AS "coverImageUrl",
    sc.images,
    sc.tags,
    sc.location,
    sc.status,
    sc.ai_process_log AS "aiProcessLog",
    sc.ai_suggestions AS "aiSuggestions",
    sc.compliance_check AS "complianceCheck",
    sc.review_status AS "reviewStatus",
    sc.reviewed_by_id AS "reviewedById",
    sc.reviewed_at AS "reviewedAt",
    sc.review_note AS "reviewNote",
    sc.scheduled_at AS "scheduledAt",
    sc.published_at AS "publishedAt",
    sc.auto_publish AS "autoPublish",
    sc.external_id AS "externalId",
    sc.external_url AS "externalUrl",
    sc.error_message AS "errorMessage",
    sc.retry_count AS "retryCount",
    sc.created_at AS "createdAt",
    sc.updated_at AS "updatedAt",
    spc.account_name AS "connectionAccountName",
    spc.platform_type AS "connectionPlatformType"
  `;

  /**
   * 构建内容查询的 WHERE 条件
   */
  private buildContentWhereClause(
    userId: string,
    statusFilter?: string,
    contentTypeFilter?: string,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`sc.user_id = ${userId}`];

    if (statusFilter) {
      conditions.push(
        Prisma.sql`sc.status = ${statusFilter}::"SocialContentStatus"`,
      );
    }

    if (contentTypeFilter) {
      conditions.push(
        Prisma.sql`sc.content_type = ${contentTypeFilter}::"SocialContentType"`,
      );
    }

    return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  }

  async getContents(
    userId: string,
    options: {
      status?: string;
      contentType?: string;
      page: number;
      limit: number;
    },
  ) {
    // Use $queryRaw because images and tags columns are text[] in database
    // but Prisma schema declares them as Json - causes type mismatch with ORM
    const offset = (options.page - 1) * options.limit;

    // Validate and sanitize enum values to prevent SQL injection
    const validStatuses = [
      "DRAFT",
      "PENDING",
      "SCHEDULED",
      "PUBLISHING",
      "PUBLISHED",
      "FAILED",
    ];
    const validContentTypes = ["WECHAT_ARTICLE", "XIAOHONGSHU_NOTE"];

    const statusFilter = options.status?.toUpperCase();
    const contentTypeFilter = options.contentType?.toUpperCase();

    // Validate enum values - reject invalid inputs
    if (statusFilter && !validStatuses.includes(statusFilter)) {
      throw new BadRequestException(`Invalid status: ${options.status}`);
    }
    if (contentTypeFilter && !validContentTypes.includes(contentTypeFilter)) {
      throw new BadRequestException(
        `Invalid content type: ${options.contentType}`,
      );
    }

    // Define result type
    interface ContentRow {
      id: string;
      userId: string;
      connectionId: string | null;
      contentType: string;
      sourceType: string;
      sourceId: string | null;
      sourceUrl: string | null;
      title: string;
      content: string;
      author: string | null;
      digest: string | null;
      coverImageUrl: string | null;
      images: string[];
      tags: string[];
      location: string | null;
      status: string;
      aiProcessLog: unknown;
      aiSuggestions: unknown;
      complianceCheck: unknown;
      reviewStatus: string | null;
      reviewedById: string | null;
      reviewedAt: Date | null;
      reviewNote: string | null;
      scheduledAt: Date | null;
      publishedAt: Date | null;
      autoPublish: boolean;
      externalId: string | null;
      externalUrl: string | null;
      errorMessage: string | null;
      retryCount: number;
      createdAt: Date;
      updatedAt: Date;
      connectionAccountName: string | null;
      connectionPlatformType: string | null;
    }

    // Build dynamic WHERE clause
    const whereClause = this.buildContentWhereClause(
      userId,
      statusFilter,
      contentTypeFilter,
    );

    // Execute queries using shared SQL fragments
    const contents = await this.prisma.$queryRaw<ContentRow[]>`
      SELECT ${this.CONTENT_SELECT_FIELDS}
      FROM social_contents sc
      LEFT JOIN social_platform_connections spc ON sc.connection_id = spc.id
      ${whereClause}
      ORDER BY sc.created_at DESC
      LIMIT ${options.limit} OFFSET ${offset}
    `;

    const countResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM social_contents sc
      ${whereClause}
    `;

    const total = Number(countResult[0]?.count || 0);

    // Transform to expected format
    const transformedContents = contents.map((c: ContentRow) => ({
      ...c,
      connection: c.connectionId
        ? {
            accountName: c.connectionAccountName,
            platformType: c.connectionPlatformType,
          }
        : null,
    }));

    return {
      contents: transformedContents,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  async createContent(userId: string, dto: CreateContentDto) {
    // Use $queryRaw because images and tags columns are text[] in database
    const sourceType = dto.sourceType || SocialContentSourceType.MANUAL;
    const images = JSON.stringify(dto.images || []);
    const tags = JSON.stringify(dto.tags || []);

    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        content_type: string;
        source_type: string;
        title: string;
        content: string;
        status: string;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      INSERT INTO "social_contents" (
        "id", "user_id", "content_type", "source_type", "source_id",
        "title", "content", "author", "digest", "source_url", "cover_image_url",
        "images", "tags", "location", "status", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(),
        ${userId},
        ${dto.contentType}::"SocialContentType",
        ${sourceType}::"SocialContentSourceType",
        ${dto.sourceId || null},
        ${dto.title},
        ${dto.content},
        ${dto.author || null},
        ${dto.digest || null},
        ${dto.sourceUrl || null},
        ${dto.coverImageUrl || null},
        ARRAY(SELECT jsonb_array_elements_text(${images}::jsonb)),
        ARRAY(SELECT jsonb_array_elements_text(${tags}::jsonb)),
        ${dto.location || null},
        'DRAFT'::"SocialContentStatus",
        NOW(),
        NOW()
      )
      RETURNING id, user_id, content_type, source_type, title, content, status, created_at, updated_at
    `;

    return results[0];
  }

  async getContent(userId: string, id: string) {
    // Use $queryRaw because images and tags columns are text[] in database
    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        userId: string;
        connectionId: string | null;
        contentType: string;
        sourceType: string;
        sourceId: string | null;
        sourceUrl: string | null;
        title: string;
        content: string;
        author: string | null;
        digest: string | null;
        coverImageUrl: string | null;
        images: string[];
        tags: string[];
        location: string | null;
        status: string;
        complianceCheck: unknown;
        reviewStatus: string | null;
        scheduledAt: Date | null;
        publishedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        connectionAccountName: string | null;
        connectionPlatformType: string | null;
      }>
    >`
      SELECT
        sc.id,
        sc.user_id AS "userId",
        sc.connection_id AS "connectionId",
        sc.content_type AS "contentType",
        sc.source_type AS "sourceType",
        sc.source_id AS "sourceId",
        sc.source_url AS "sourceUrl",
        sc.title,
        sc.content,
        sc.author,
        sc.digest,
        sc.cover_image_url AS "coverImageUrl",
        sc.images,
        sc.tags,
        sc.location,
        sc.status,
        sc.compliance_check AS "complianceCheck",
        sc.review_status AS "reviewStatus",
        sc.scheduled_at AS "scheduledAt",
        sc.published_at AS "publishedAt",
        sc.created_at AS "createdAt",
        sc.updated_at AS "updatedAt",
        spc.account_name AS "connectionAccountName",
        spc.platform_type AS "connectionPlatformType"
      FROM social_contents sc
      LEFT JOIN social_platform_connections spc ON sc.connection_id = spc.id
      WHERE sc.id = ${id} AND sc.user_id = ${userId}
    `;

    if (!results[0]) {
      throw new NotFoundException("内容不存在");
    }

    const c = results[0];
    return {
      ...c,
      connection: c.connectionId
        ? {
            accountName: c.connectionAccountName,
            platformType: c.connectionPlatformType,
          }
        : null,
    };
  }

  async updateContent(userId: string, id: string, dto: UpdateContentDto) {
    // First verify the content exists and belongs to user
    await this.getContent(userId, id);

    // Build safe update data object - only include defined fields
    const updateData: Record<string, unknown> = {};

    if (dto.title !== undefined) {
      updateData.title = dto.title;
    }
    if (dto.content !== undefined) {
      updateData.content = dto.content;
    }
    if (dto.author !== undefined) {
      updateData.author = dto.author;
    }
    if (dto.digest !== undefined) {
      updateData.digest = dto.digest;
    }
    if (dto.coverImageUrl !== undefined) {
      updateData.coverImageUrl = dto.coverImageUrl;
    }
    if (dto.images !== undefined) {
      updateData.images = dto.images;
    }
    if (dto.tags !== undefined) {
      updateData.tags = dto.tags;
    }
    if (dto.location !== undefined) {
      updateData.location = dto.location;
    }
    if (dto.connectionId !== undefined) {
      updateData.connectionId = dto.connectionId;
    }

    // If no fields to update, just return current content
    if (Object.keys(updateData).length === 0) {
      return this.getContent(userId, id);
    }

    // Use Prisma ORM for safe parameterized update
    await this.prisma.socialContent.update({
      where: {
        id,
        userId, // Ensures user owns the content
      },
      data: {
        ...updateData,
        updatedAt: new Date(),
      },
    });

    return this.getContent(userId, id);
  }

  async deleteContent(userId: string, id: string) {
    // First verify the content exists and belongs to user
    await this.getContent(userId, id);

    await this.prisma.$executeRaw`
      DELETE FROM social_contents
      WHERE id = ${id} AND user_id = ${userId}
    `;

    return { success: true };
  }

  // ==================== 内容检测 ====================

  async checkContent(userId: string, id: string) {
    const content = await this.getContent(userId, id);
    const result = await this.contentChecker.check(content.content);

    // Add checkedAt timestamp for frontend compatibility
    const resultWithTimestamp = {
      ...result,
      checkedAt: new Date().toISOString(),
    };

    // Use $executeRaw to avoid Prisma ORM issues with text[] columns
    await this.prisma.$executeRaw`
      UPDATE social_contents
      SET compliance_check = ${JSON.stringify(resultWithTimestamp)}::jsonb, updated_at = NOW()
      WHERE id = ${content.id}
    `;

    return resultWithTimestamp;
  }

  // ==================== 发布管理 ====================

  async publishContent(userId: string, id: string, dto: PublishContentDto) {
    const content = await this.getContent(userId, id);

    // Guard: only DRAFT or FAILED (retry) content can be published
    if (
      content.status !== SocialContentStatus.DRAFT &&
      content.status !== SocialContentStatus.FAILED
    ) {
      throw new BadRequestException(
        `当前状态(${content.status})不允许发布，只有草稿或失败状态可以发布`,
      );
    }

    // Guard: compliance check must pass before publishing (if check was run)
    const compliance = content.complianceCheck as {
      passed?: boolean;
      score?: number;
    } | null;
    if (compliance && compliance.passed === false) {
      throw new BadRequestException(
        "内容合规检测未通过，请修改后再发布。可在内容详情查看具体问题",
      );
    }

    if (!content.connectionId && !dto.connectionId) {
      throw new BadRequestException("请选择发布账号");
    }

    // After the guard above, at least one of dto.connectionId or content.connectionId is set
    let connectionId = (dto.connectionId || content.connectionId) as string;

    // 验证连接是否存在
    let connection = await this.prisma.socialPlatformConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      // 连接已被删除，尝试找用户的活跃连接
      const platformType =
        content.contentType === "WECHAT_ARTICLE" ? "WECHAT_MP" : "XIAOHONGSHU";

      const activeConnection =
        await this.prisma.socialPlatformConnection.findFirst({
          where: {
            userId,
            platformType,
            isActive: true,
          },
        });

      if (!activeConnection) {
        throw new BadRequestException(
          "发布账号已断开连接，请在连接管理中重新连接后再发布",
        );
      }

      connectionId = activeConnection.id;
      connection = activeConnection;
      this.logger.log(
        `Original connection not found, using active connection: ${connectionId}`,
      );
    }

    // Use $executeRaw to avoid Prisma ORM issues with text[] columns
    await this.prisma.$executeRaw`
      UPDATE social_contents
      SET status = 'PENDING'::"SocialContentStatus",
          connection_id = ${connectionId},
          updated_at = NOW()
      WHERE id = ${content.id}
    `;

    // ★ AI Kernel: 创建进程记录
    if (this.missionExecutor) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId,
          agentId: "social-agent",
          teamSessionId: content.id,
          input: { contentType: content.contentType, title: content.title },
        });
        this.kernelProcessIds.set(content.id, kernelResult.processId);
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // PR-3 单轨化: 委托 SocialPipelineDispatcher.runMission（按 dto.depth 派 pipeline）
    // 缺省 depth=quick 走 fast pipeline（s1+s8+s9+s11），保留旧 publishExecutor 同步链式快发的体验
    const platformType =
      connection?.platformType ??
      (content.contentType === "WECHAT_ARTICLE" ? "WECHAT_MP" : "XIAOHONGSHU");
    const depth = dto.depth ?? "quick";
    const { missionId } = this.dispatcher.tryReserveInFlight(
      content.userId ?? userId,
      content.id,
      [platformType],
    );

    const contentProcessId = this.kernelProcessIds.get(content.id);
    const executeGeneration = async () => {
      try {
        const missionResult = await this.dispatcher.runMission(
          missionId,
          {
            contentId: content.id,
            platforms: [platformType],
            connectionIds: { [platformType]: connectionId },
            depth,
            budgetProfile: depth === "quick" ? "lean" : "standard",
            language: "zh-CN",
          },
          content.userId ?? userId,
        );
        this.completeKernelProcess(content.id, { contentId: content.id });
        // PR-3 向后兼容形状：旧 publishExecutor.execute 返回 { success: boolean, ... }
        // 前端 useSocialPublish hook 与既有 spec 都消费 result.success
        return {
          success: missionResult.status === "completed",
          missionId: missionResult.missionId,
          status: missionResult.status,
        };
      } catch (err) {
        this.failKernelProcess(
          content.id,
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }
    };
    return contentProcessId
      ? MissionContext.run(
          { agentProcessId: contentProcessId, userId: content.userId || "" },
          executeGeneration,
        )
      : executeGeneration();
  }

  async scheduleContent(userId: string, id: string, scheduledAt: Date) {
    const content = await this.getContent(userId, id);

    // Use $executeRaw to avoid Prisma ORM issues with text[] columns
    await this.prisma.$executeRaw`
      UPDATE social_contents
      SET status = 'SCHEDULED'::"SocialContentStatus",
          scheduled_at = ${scheduledAt},
          updated_at = NOW()
      WHERE id = ${content.id}
    `;

    return this.getContent(userId, id);
  }

  async cancelPublish(userId: string, id: string) {
    const content = await this.getContent(userId, id);

    if (
      content.status !== SocialContentStatus.SCHEDULED &&
      content.status !== SocialContentStatus.PENDING
    ) {
      throw new BadRequestException("只能取消排期或待发布状态的内容");
    }

    // Use $executeRaw to avoid Prisma ORM issues with text[] columns
    await this.prisma.$executeRaw`
      UPDATE social_contents
      SET status = 'DRAFT'::"SocialContentStatus",
          scheduled_at = NULL,
          updated_at = NOW()
      WHERE id = ${content.id}
    `;

    return this.getContent(userId, id);
  }

  async getPublishLogs(userId: string, contentId: string) {
    // 验证内容归属
    await this.getContent(userId, contentId);

    return this.prisma.socialPublishLog.findMany({
      where: { contentId },
      orderBy: { createdAt: "desc" },
    });
  }

  // ==================== 导入来源 ====================
  // 移到 SocialImportSourcesService —— god class 减重 phase 2.A.5 (2026-05-27)

  async getSeriesContents(userId: string, seriesId: string) {
    const results = await this.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        content: string;
        digest: string | null;
        series_id: string;
        series_order: number;
        status: string;
        cover_image_url: string | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, title, content, digest, series_id, series_order, status,
             cover_image_url, created_at, updated_at
      FROM social_contents
      WHERE user_id = ${userId}::uuid AND series_id = ${seriesId}
        AND series_order IS NOT NULL
      ORDER BY series_order ASC
    `;

    return results.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      digest: row.digest,
      seriesId: row.series_id,
      seriesOrder: row.series_order,
      status: row.status,
      coverImageUrl: row.cover_image_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ==================== 批量操作 ====================

  /**
   * 批量删除内容（使用数据库事务）
   */
  async batchDeleteContents(
    userId: string,
    ids: string[],
  ): Promise<{
    success: boolean;
    total: number;
    succeeded: number;
    failed: number;
    errors?: Array<{ id: string; error: string }>;
  }> {
    const errors: Array<{ id: string; error: string }> = [];
    let succeeded = 0;

    // 使用事务确保原子性
    await this.prisma.$transaction(async (tx) => {
      for (const id of ids) {
        try {
          // 验证内容存在且属于用户
          const content = await tx.socialContent.findFirst({
            where: { id, userId },
          });

          if (!content) {
            errors.push({ id, error: "内容不存在或无权限" });
            continue;
          }

          // 不允许删除已发布的内容
          if (content.status === "PUBLISHED") {
            errors.push({ id, error: "已发布内容无法删除" });
            continue;
          }

          await tx.socialContent.delete({ where: { id } });
          succeeded++;
        } catch (error) {
          const message = error instanceof Error ? error.message : "删除失败";
          errors.push({ id, error: message });
        }
      }
    });

    return {
      success: errors.length === 0,
      total: ids.length,
      succeeded,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * 批量发布内容（使用数据库事务）
   */
  async batchPublishContents(
    userId: string,
    ids: string[],
    connectionId: string,
  ): Promise<{
    success: boolean;
    total: number;
    succeeded: number;
    failed: number;
    errors?: Array<{ id: string; error: string }>;
  }> {
    const errors: Array<{ id: string; error: string }> = [];
    let succeeded = 0;
    const succeededIds: string[] = [];

    // 验证连接有效性
    const connection = await this.prisma.socialPlatformConnection.findFirst({
      where: { id: connectionId, userId, isActive: true },
    });

    if (!connection) {
      return {
        success: false,
        total: ids.length,
        succeeded: 0,
        failed: ids.length,
        errors: [{ id: "connection", error: "平台连接无效或已断开" }],
      };
    }

    // 使用事务处理批量发布（只做状态更新和记录创建，不触发外部调用）
    await this.prisma.$transaction(async (tx) => {
      for (const id of ids) {
        try {
          const content = await tx.socialContent.findFirst({
            where: { id, userId },
          });

          if (!content) {
            errors.push({ id, error: "内容不存在或无权限" });
            continue;
          }

          // 只允许发布草稿或失败(重试)状态的内容
          if (!["DRAFT", "FAILED"].includes(content.status)) {
            errors.push({
              id,
              error: `当前状态(${content.status})不允许发布`,
            });
            continue;
          }

          // 更新状态为待发布
          await tx.socialContent.update({
            where: { id },
            data: {
              status: "PENDING",
              updatedAt: new Date(),
            },
          });

          // 创建发布记录
          await tx.socialPublishLog.create({
            data: {
              contentId: id,
              action: "PUBLISH",
              status: "PENDING",
              details: { connectionId },
              createdAt: new Date(),
            },
          });

          succeededIds.push(id);
          succeeded++;
        } catch (error) {
          const message = error instanceof Error ? error.message : "发布失败";
          errors.push({ id, error: message });
        }
      }
    });

    // 事务结束后触发实际发布执行（fire-and-forget；PR-3 单轨化走 dispatcher.runMission depth=quick）
    const platformType = connection.platformType;
    for (const contentId of succeededIds) {
      const { missionId } = this.dispatcher.tryReserveInFlight(
        userId,
        contentId,
        [platformType],
      );
      this.dispatcher
        .runMission(
          missionId,
          {
            contentId,
            platforms: [platformType],
            connectionIds: { [platformType]: connectionId },
            depth: "quick",
            budgetProfile: "lean",
            language: "zh-CN",
          },
          userId,
        )
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Failed to trigger publish mission for content ${contentId} (missionId=${missionId}): ${message}`,
          );
        });
    }

    return {
      success: errors.length === 0,
      total: ids.length,
      succeeded,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ─── AI Kernel Helpers ───

  private completeKernelProcess(
    contentId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(contentId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .complete(processId, output)
      .catch((err: unknown) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.kernelProcessIds.delete(contentId);
  }

  private failKernelProcess(contentId: string, error: string): void {
    const processId = this.kernelProcessIds.get(contentId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .fail(processId, error)
      .catch((err: unknown) =>
        this.logger.warn(
          `[Kernel] Failed to mark process as failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.kernelProcessIds.delete(contentId);
  }
}
