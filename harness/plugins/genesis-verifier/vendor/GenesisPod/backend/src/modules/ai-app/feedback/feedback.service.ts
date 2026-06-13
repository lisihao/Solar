import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma } from "@prisma/client";
import { createReadStream } from "fs";
import { unlink } from "fs/promises";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AdminAuthService } from "../../../common/services";
import { mapWithConcurrencySettled } from "../../../common/utils/concurrency.utils";
import { CreateFeedbackDto, FeedbackTypeDto } from "./dto/create-feedback.dto";
import {
  EmailNotificationPresetsService,
  FeedbackStatusUpdatePreset,
  NotificationPresetsService,
  ObjectStorageService,
} from "../../platform/facade";
import {
  FeedbackEvent,
  FeedbackCreatedPayload,
} from "./events/feedback-events";

// Type mapping for feedback types
type FeedbackTypeEnum =
  | "BUG"
  | "FEATURE"
  | "IMPROVEMENT"
  | "OTHER"
  | "ANNOTATION";
type FeedbackStatusEnum =
  | "PENDING"
  | "REVIEWED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED";

interface StoredAttachment {
  filename: string;
  url: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private prisma: PrismaService,
    // 仅用于 admin 通知（feedback 到 admin inbox），不受用户偏好控制
    private emailNotificationPresetsService: EmailNotificationPresetsService,
    // PR-DR1b F3 整改：用户面通知走 dispatcher（用户可在 settings 关 FEEDBACK_STATUS_CHANGED）
    private feedbackStatusUpdatePreset: FeedbackStatusUpdatePreset,
    // 新反馈到达时给所有 admin 发站内信（与 admin 邮件并存）；admin 告警同样不受用户偏好控制
    private notificationPresets: NotificationPresetsService,
    // 解析 admin 收件人：role=ADMIN 或邮箱在 ADMIN_EMAILS 白名单（与 AdminGuard 判定一致）
    private adminAuth: AdminAuthService,
    private r2Storage: ObjectStorageService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * 查询所有管理员 userId，用于新反馈站内信 fan-out。
   * 管理员判定与 AdminGuard 一致：role=ADMIN 或邮箱在 ADMIN_EMAILS 白名单
   * （只查 role 会漏掉只配了邮箱白名单的 admin）。
   * 任何错误一律返回空数组（通知失败不影响反馈提交）。
   */
  private async listAdminUserIds(): Promise<string[]> {
    try {
      const adminEmails = this.adminAuth.getAdminEmails(); // 已小写
      const admins = await this.prisma.user.findMany({
        where: {
          OR: [
            { role: "ADMIN" },
            ...(adminEmails.length > 0
              ? [{ email: { in: adminEmails, mode: "insensitive" as const } }]
              : []),
          ],
        },
        select: { id: true },
      });
      return admins.map((a) => a.id);
    } catch (error) {
      this.logger.warn(
        `listAdminUserIds failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Convert DTO type to Prisma enum
   */
  private mapFeedbackType(type: FeedbackTypeDto): FeedbackTypeEnum {
    const mapping: Record<FeedbackTypeDto, FeedbackTypeEnum> = {
      [FeedbackTypeDto.BUG]: "BUG",
      [FeedbackTypeDto.FEATURE]: "FEATURE",
      [FeedbackTypeDto.IMPROVEMENT]: "IMPROVEMENT",
      [FeedbackTypeDto.OTHER]: "OTHER",
      [FeedbackTypeDto.ANNOTATION]: "ANNOTATION",
    };
    return mapping[type];
  }

  // 单请求内多文件上传的并发上限。diskStorage 下每个文件用 fs.createReadStream
  // 流式上传（不进 Buffer），但仍限并发以削平 5 文件同时读流的峰值。
  private static readonly ATTACHMENT_UPLOAD_CONCURRENCY = 2;

  /**
   * Upload attachments to R2 storage（去内存化）。
   *
   * 文件已由 multer diskStorage 落在 file.path 临时文件，这里用 fs.createReadStream
   * 流式上传到 R2（uploadStream），全程不在进程内驻留完整 Buffer。
   * 无论成功/失败，finally 中 fs.unlink 删临时文件，防磁盘泄漏。
   * 单文件失败仅记日志、跳过，不影响其他文件与整体请求。
   */
  private async uploadAttachments(
    files: Express.Multer.File[],
    feedbackId: string,
  ): Promise<StoredAttachment[]> {
    const results = await mapWithConcurrencySettled(
      files,
      (file) => this.uploadSingleAttachment(file, feedbackId),
      FeedbackService.ATTACHMENT_UPLOAD_CONCURRENCY,
    );

    const attachments: StoredAttachment[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        attachments.push(r.value);
      }
    }
    return attachments;
  }

  /**
   * 上传单个临时文件到 R2 并清理临时文件。成功返回 StoredAttachment，失败返回 null。
   */
  private async uploadSingleAttachment(
    file: Express.Multer.File,
    feedbackId: string,
  ): Promise<StoredAttachment | null> {
    try {
      const stream = createReadStream(file.path);
      const result = await this.r2Storage.uploadStream(
        stream,
        file.size,
        `feedback/${feedbackId}`,
        file.originalname,
        file.mimetype,
      );

      if (result.success && result.url) {
        this.logger.log(`Uploaded attachment: ${file.originalname}`);
        return {
          filename: file.originalname,
          url: result.url,
          mimeType: file.mimetype,
          size: file.size,
        };
      }
      this.logger.warn(
        `Failed to upload attachment: ${file.originalname} - ${result.error}`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to upload attachment: ${file.originalname}`,
        error,
      );
      return null;
    } finally {
      // best-effort 清理临时文件（成功/失败都删），防磁盘泄漏。
      try {
        await unlink(file.path);
      } catch (cleanupError) {
        this.logger.warn(
          `Failed to remove temp file ${file.path}: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          }`,
        );
      }
    }
  }

  /**
   * Create new feedback with optional attachments and email notification
   */
  async createFeedback(
    dto: CreateFeedbackDto,
    userId?: string,
    files?: Express.Multer.File[],
  ) {
    this.logger.log(
      `Creating feedback: ${dto.type} - ${dto.title} (${files?.length || 0} files)`,
    );

    const feedbackType = this.mapFeedbackType(dto.type);

    // Generate feedback ID first for attachment paths
    const feedbackId = crypto.randomUUID();

    // Upload attachments if any
    let attachments: StoredAttachment[] = [];
    if (files && files.length > 0) {
      attachments = await this.uploadAttachments(files, feedbackId);
    }

    // Use raw SQL to insert feedback with attachments
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "feedbacks" (
        "id", "type", "status", "title", "description",
        "user_email", "user_agent", "page_url", "user_id",
        "attachments", "created_at", "updated_at"
      ) VALUES (
        ${feedbackId}::uuid,
        ${feedbackType}::"FeedbackType",
        'PENDING'::"FeedbackStatus",
        ${dto.title},
        ${dto.description},
        ${dto.userEmail || null},
        ${dto.userAgent || null},
        ${dto.url || null},
        ${userId || null},
        ${JSON.stringify(attachments)}::jsonb,
        NOW(),
        NOW()
      )
      RETURNING id
    `;

    const createdId = result[0]?.id;
    this.logger.log(`Feedback created: ${createdId}`);

    // Send email notification to admin
    try {
      // 去内存化：diskStorage 下 file.buffer 已不存在，且临时文件在 uploadAttachments
      // 后已被 unlink。文件本身已持久化到 R2（attachments[].url）并随 feedback 记录/事件
      // 保留，故 admin 邮件不再内联附件内容——避免为了发邮件再把文件读回内存（违背去内存化）。
      // 邮件正文不再显示附件数；如需附件预览，admin 可通过 feedback 记录的 R2 url 访问。
      await this.emailNotificationPresetsService.sendFeedbackNotification({
        id: createdId,
        type: feedbackType,
        title: dto.title,
        description: dto.description,
        userEmail: dto.userEmail,
        pageUrl: dto.url,
        userAgent: dto.userAgent,
      });
    } catch (error) {
      // Log error but don't fail the request
      this.logger.error("Failed to send email notification", error);
    }

    // 站内信 fan-out 给所有 admin（与上面的 admin 邮件并存）。
    // 失败仅记日志，不影响反馈提交，与 admin 邮件一致。
    try {
      const adminUserIds = await this.listAdminUserIds();
      await this.notificationPresets.notifyFeedbackReceived({
        adminUserIds,
        feedbackId: createdId,
        feedbackType,
        title: dto.title,
        requesterEmail: dto.userEmail,
      });
    } catch (error) {
      this.logger.error("Failed to send in-app notification to admins", error);
    }

    // Emit feedback created event for auto-triage
    try {
      const eventPayload: FeedbackCreatedPayload = {
        feedbackId: createdId,
        type: feedbackType,
        title: dto.title,
        description: dto.description,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          url: a.url,
          mimeType: a.mimeType,
          size: a.size,
        })),
        userId,
        userEmail: dto.userEmail,
        pageUrl: dto.url,
        userAgent: dto.userAgent,
        createdAt: new Date(),
      };

      this.eventEmitter.emit(FeedbackEvent.CREATED, eventPayload);
      this.logger.log(
        `Emitted ${FeedbackEvent.CREATED} event for ${createdId}`,
      );
    } catch (error) {
      // Log error but don't fail the request
      this.logger.error("Failed to emit feedback created event", error);
    }

    return {
      success: true,
      feedbackId: createdId,
      message: "Feedback submitted successfully",
      attachmentsCount: attachments.length,
    };
  }

  /**
   * Create feedback from a report annotation
   */
  async createFromAnnotation(userId: string, annotationId: string) {
    this.logger.log(
      `Creating feedback from annotation: ${annotationId} by user: ${userId}`,
    );

    // Fetch annotation with report context
    const annotations = await this.prisma.$queryRaw<
      {
        id: string;
        content: string;
        selected_text: string | null;
        report_id: string;
      }[]
    >`
      SELECT "id", "content", "selected_text", "report_id"
      FROM "report_annotations"
      WHERE "id" = ${annotationId}
    `;

    const annotation = annotations[0];
    if (!annotation) {
      throw new Error(`Annotation not found: ${annotationId}`);
    }

    const title = annotation.selected_text
      ? `Annotation: ${annotation.selected_text.substring(0, 100)}`
      : `Annotation feedback`;

    const description = [
      annotation.content,
      annotation.selected_text
        ? `\n\nSelected text: ${annotation.selected_text}`
        : "",
      `\n\nReport ID: ${annotation.report_id}`,
      `\nAnnotation ID: ${annotationId}`,
    ].join("");

    const feedbackId = crypto.randomUUID();

    await this.prisma.$queryRaw`
      INSERT INTO "feedbacks" (
        "id", "type", "status", "title", "description",
        "user_id", "page_url", "created_at", "updated_at"
      ) VALUES (
        ${feedbackId}::uuid,
        'ANNOTATION'::"FeedbackType",
        'PENDING'::"FeedbackStatus",
        ${title},
        ${description},
        ${userId},
        ${null},
        NOW(),
        NOW()
      )
      RETURNING id
    `;

    this.logger.log(`Feedback created from annotation: ${feedbackId}`);

    return {
      success: true,
      feedbackId,
      message: "Feedback created from annotation",
    };
  }

  /**
   * Get user's own feedback history
   */
  async getUserFeedback(
    userId: string,
    options?: { limit?: number; offset?: number },
  ) {
    const { limit = 50, offset = 0 } = options || {};

    const feedbacks = await this.prisma.$queryRaw<unknown[]>`
      SELECT * FROM "feedbacks"
      WHERE "user_id" = ${userId}
      ORDER BY "created_at" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "feedbacks" WHERE "user_id" = ${userId}
    `;

    return {
      feedbacks,
      total: Number(countResult[0]?.count || 0),
      limit,
      offset,
    };
  }

  private static readonly VALID_STATUSES: FeedbackStatusEnum[] = [
    "PENDING",
    "REVIEWED",
    "IN_PROGRESS",
    "RESOLVED",
    "CLOSED",
  ];

  private static readonly VALID_TYPES: FeedbackTypeEnum[] = [
    "BUG",
    "FEATURE",
    "IMPROVEMENT",
    "OTHER",
    "ANNOTATION",
  ];

  /**
   * Get all feedback (admin)
   */
  async getAllFeedback(options?: {
    status?: FeedbackStatusEnum;
    type?: FeedbackTypeEnum;
    priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
    limit?: number;
    offset?: number;
  }) {
    const { status, type, limit = 50, offset = 0 } = options || {};

    // Validate enum values against whitelist to prevent SQL injection
    if (status && !FeedbackService.VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid feedback status: ${status}`);
    }
    if (type && !FeedbackService.VALID_TYPES.includes(type)) {
      throw new Error(`Invalid feedback type: ${type}`);
    }

    // Build dynamic WHERE using parameterized Prisma.sql fragments
    const conditions: Prisma.Sql[] = [];
    if (status)
      conditions.push(Prisma.sql`"status" = ${status}::"FeedbackStatus"`);
    if (type) conditions.push(Prisma.sql`"type" = ${type}::"FeedbackType"`);

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;

    const feedbacks = await this.prisma.$queryRaw<unknown[]>`
      SELECT * FROM "feedbacks"
      ${whereClause}
      ORDER BY "created_at" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "feedbacks" ${whereClause}
    `;

    return {
      feedbacks,
      total: Number(countResult[0]?.count || 0),
      limit,
      offset,
    };
  }

  /**
   * Get feedback by ID
   */
  async getFeedbackById(id: string) {
    const result = await this.prisma.$queryRaw<unknown[]>`
      SELECT * FROM "feedbacks" WHERE "id" = ${id}::uuid
    `;
    return result[0] || null;
  }

  /**
   * Update feedback status (admin)
   */
  async updateFeedbackStatus(
    id: string,
    status: FeedbackStatusEnum,
    adminNotes?: string,
  ) {
    // Get current feedback first to compare status and get user email
    const currentFeedback = await this.getFeedbackById(id);
    if (!currentFeedback) {
      this.logger.warn(`Feedback not found: ${id}`);
      return null;
    }

    const oldStatus = (currentFeedback as { status: string }).status;
    const userEmail = (currentFeedback as { user_email: string | null })
      .user_email;
    const title = (currentFeedback as { title: string }).title;
    const feedbackType = (currentFeedback as { type: string }).type;

    const result = await this.prisma.$queryRaw<unknown[]>`
      UPDATE "feedbacks"
      SET "status" = ${status}::"FeedbackStatus",
          "admin_notes" = ${adminNotes || null},
          "updated_at" = NOW()
      WHERE "id" = ${id}::uuid
      RETURNING *
    `;

    const updatedFeedback = result[0];

    // Send status update to user via NotificationDispatcher
    // (PR-DR1b F3 整改：用户面通知走 dispatcher → 用户可在 settings 关掉)
    if (userEmail && oldStatus !== status) {
      try {
        await this.feedbackStatusUpdatePreset.notify({
          id,
          title,
          type: feedbackType,
          oldStatus,
          newStatus: status,
          userEmail,
          adminNotes,
        });
        this.logger.log(
          `Status update notification dispatched for feedback ${id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to dispatch status update notification for feedback ${id}`,
          error,
        );
      }
    }

    return updatedFeedback || null;
  }

  /**
   * Get feedback statistics
   */
  async getFeedbackStats() {
    const totalResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "feedbacks"
    `;

    const byTypeResult = await this.prisma.$queryRaw<
      { type: string; count: bigint }[]
    >`
      SELECT "type"::text, COUNT(*) as count
      FROM "feedbacks"
      GROUP BY "type"
    `;

    const byStatusResult = await this.prisma.$queryRaw<
      { status: string; count: bigint }[]
    >`
      SELECT "status"::text, COUNT(*) as count
      FROM "feedbacks"
      GROUP BY "status"
    `;

    return {
      total: Number(totalResult[0]?.count || 0),
      byType: byTypeResult.reduce(
        (acc: Record<string, number>, item) => {
          acc[item.type] = Number(item.count);
          return acc;
        },
        {} as Record<string, number>,
      ),
      byStatus: byStatusResult.reduce(
        (acc: Record<string, number>, item) => {
          acc[item.status] = Number(item.count);
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  // ==================== Feedback Reply Methods ====================

  /**
   * Add a reply to feedback
   */
  async addReply(
    feedbackId: string,
    params: {
      userId?: string;
      content: string;
      isAdmin: boolean;
      internalNote?: boolean;
      attachments?: StoredAttachment[];
    },
  ) {
    const {
      userId,
      content,
      isAdmin,
      internalNote = false,
      attachments = [],
    } = params;

    // Verify feedback exists
    const feedback = await this.getFeedbackById(feedbackId);
    if (!feedback) {
      throw new Error("Feedback not found");
    }

    // Create reply using raw SQL
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "feedback_replies" (
        "id", "feedback_id", "user_id", "content", "is_admin",
        "internal_note", "attachments", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(),
        ${feedbackId}::uuid,
        ${userId || null}::uuid,
        ${content},
        ${isAdmin},
        ${internalNote},
        ${JSON.stringify(attachments)}::jsonb,
        NOW(),
        NOW()
      )
      RETURNING id
    `;

    const replyId = result[0]?.id;
    this.logger.log(`Reply added to feedback ${feedbackId}: ${replyId}`);

    // Update reply count on feedback
    await this.prisma.$queryRaw`
      UPDATE "feedbacks"
      SET "reply_count" = "reply_count" + 1, "updated_at" = NOW()
      WHERE "id" = ${feedbackId}::uuid
    `;

    // Emit event for notification
    this.eventEmitter.emit("feedback.replied", {
      feedbackId,
      replyId,
      isAdmin,
      userId,
    });

    return { replyId };
  }

  /**
   * Get replies for a feedback
   */
  async getReplies(
    feedbackId: string,
    options?: {
      includeInternal?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    const { includeInternal = false, limit = 50, offset = 0 } = options || {};

    const internalCondition = includeInternal
      ? Prisma.empty
      : Prisma.sql`AND "internal_note" = false`;

    const replies = await this.prisma.$queryRaw<unknown[]>`
      SELECT
        r.*,
        u."username" as user_username,
        u."full_name" as user_full_name,
        u."avatar_url" as user_avatar_url
      FROM "feedback_replies" r
      LEFT JOIN "users" u ON r."user_id" = u."id"
      WHERE "feedback_id" = ${feedbackId}::uuid
      ${internalCondition}
      ORDER BY r."created_at" ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM "feedback_replies"
      WHERE "feedback_id" = ${feedbackId}::uuid
      ${internalCondition}
    `;

    return {
      replies,
      total: Number(countResult[0]?.count || 0),
      limit,
      offset,
    };
  }

  /**
   * Update feedback priority (admin)
   */
  async updateFeedbackPriority(
    id: string,
    priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
  ) {
    const result = await this.prisma.$queryRaw<unknown[]>`
      UPDATE "feedbacks"
      SET "priority" = ${priority}::"FeedbackPriority", "updated_at" = NOW()
      WHERE "id" = ${id}::uuid
      RETURNING *
    `;
    return result[0] || null;
  }

  /**
   * Assign feedback to admin (admin)
   */
  async assignFeedback(id: string, assignedTo: string | null) {
    const result = await this.prisma.$queryRaw<unknown[]>`
      UPDATE "feedbacks"
      SET
        "assigned_to" = ${assignedTo}::uuid,
        "assigned_at" = ${assignedTo ? "NOW()" : null}::timestamp,
        "updated_at" = NOW()
      WHERE "id" = ${id}::uuid
      RETURNING *
    `;
    return result[0] || null;
  }

  /**
   * Batch update feedback status (admin)
   */
  async batchUpdateStatus(ids: string[], status: FeedbackStatusEnum) {
    const result = await this.prisma.$queryRaw<{ count: bigint }[]>`
      WITH updated AS (
        UPDATE "feedbacks"
        SET "status" = ${status}::"FeedbackStatus", "updated_at" = NOW()
        WHERE "id" = ANY(${ids}::uuid[])
        RETURNING 1
      )
      SELECT COUNT(*) as count FROM updated
    `;
    return { count: Number(result[0]?.count || 0) };
  }
}
