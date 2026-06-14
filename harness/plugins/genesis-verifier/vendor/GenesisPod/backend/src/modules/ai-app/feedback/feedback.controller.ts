import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Logger,
  Request,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { diskStorage } from "multer";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { FeedbackService } from "./feedback.service";
import { CreateFeedbackDto } from "./dto/create-feedback.dto";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../common/guards/admin.guard";
import { OptionalJwtAuthGuard } from "../../../common/guards/optional-jwt-auth.guard";
import { Public } from "../../../common/decorators/public.decorator";
import { EmailService } from "../../platform/facade";

export const FEEDBACK_MAX_FILES = 5;

/**
 * 反馈附件上传的 multer 配置（去内存化）。
 *
 * 关键：用 diskStorage 把上传文件落到 os.tmpdir() 临时文件，**不再用 multer
 * 默认 memoryStorage**——默认下每个文件整个 Buffer 进内存，5×10MB 并发叠加会内存爆。
 * service 层用 fs.createReadStream(file.path) 流式上传到 R2，上传后删临时文件。
 *
 * 导出为常量以便单测直接断言（diskStorage 实例带 getDestination/getFilename，
 * memoryStorage 没有），无需在路由元数据里反射 multer 闭包。
 */
export const FEEDBACK_UPLOAD_MULTER_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: tmpdir(),
    filename: (_req, file, callback) => {
      // 随机文件名防碰撞；保留原扩展名（仅取最后一段，去掉路径分隔符）
      const ext = (file.originalname.split(".").pop() || "bin").replace(
        /[^a-zA-Z0-9]/g,
        "",
      );
      callback(null, `feedback-${randomUUID()}.${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
  fileFilter: (_req, file, callback) => {
    // Allow images, PDFs, and common document types
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "application/json",
      "text/html",
      "text/css",
      "text/javascript",
      "application/javascript",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(null, false); // Silently reject unsupported types
    }
  },
};

// Type definitions for feedback enums
type FeedbackStatusEnum =
  | "PENDING"
  | "REVIEWED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED";
type FeedbackTypeEnum =
  | "BUG"
  | "FEATURE"
  | "IMPROVEMENT"
  | "OTHER"
  | "ANNOTATION";
type FeedbackPriorityEnum = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

@ApiTags("Feedback")
@Controller("feedback")
export class FeedbackController {
  private readonly logger = new Logger(FeedbackController.name);

  constructor(
    private feedbackService: FeedbackService,
    private emailService: EmailService,
  ) {}

  /**
   * Submit feedback with optional file attachments
   * POST /api/v1/feedback
   */
  // @Public 让全局 JwtAuthGuard 放行——反馈对匿名用户也开放（设计本意）。
  // OptionalJwtAuthGuard 仍保留：带有效 token 时填充 req.user，把反馈归属到用户；
  // 缺这个装饰器时全局 guard 会先抛 "Please sign in to continue"（提交报错根因）。
  @Public()
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor(
      "files",
      FEEDBACK_MAX_FILES,
      FEEDBACK_UPLOAD_MULTER_OPTIONS,
    ),
  )
  async submitFeedback(
    @Body() dto: CreateFeedbackDto,
    @Request() req: { user?: { id: string } },
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    this.logger.log(
      `Feedback submitted: ${dto.type} - ${dto.title} (${files?.length || 0} files)`,
    );
    return this.feedbackService.createFeedback(dto, req.user?.id, files);
  }

  /**
   * Create feedback from a report annotation
   * POST /api/v1/feedback/from-annotation/:annotationId
   */
  @Post("from-annotation/:annotationId")
  @UseGuards(JwtAuthGuard)
  async createFromAnnotation(
    @Param("annotationId") annotationId: string,
    @Request() req: { user: { id: string } },
  ) {
    this.logger.log(`Creating feedback from annotation: ${annotationId}`);
    return this.feedbackService.createFromAnnotation(req.user.id, annotationId);
  }

  /**
   * Get user's own feedback history
   * GET /api/v1/feedback/my
   */
  @Get("my")
  @UseGuards(JwtAuthGuard)
  async getMyFeedback(
    @Request() req: { user: { id: string } },
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.feedbackService.getUserFeedback(req.user.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * Get all feedback (admin only)
   * GET /api/v1/feedback
   */
  @Get()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAllFeedback(
    @Query("status") status?: FeedbackStatusEnum,
    @Query("type") type?: FeedbackTypeEnum,
    @Query("priority") priority?: FeedbackPriorityEnum,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.feedbackService.getAllFeedback({
      status,
      type,
      priority,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * Get feedback statistics (admin only)
   * GET /api/v1/feedback/stats
   */
  @Get("stats")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getFeedbackStats() {
    return this.feedbackService.getFeedbackStats();
  }

  /**
   * Get feedback by ID (admin only)
   * GET /api/v1/feedback/:id
   */
  @Get(":id")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getFeedback(@Param("id") id: string) {
    return this.feedbackService.getFeedbackById(id);
  }

  /**
   * Update feedback status (admin only)
   * PATCH /api/v1/feedback/:id/status
   */
  @Patch(":id/status")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateFeedbackStatus(
    @Param("id") id: string,
    @Body("status") status: FeedbackStatusEnum,
    @Body("adminNotes") adminNotes?: string,
  ) {
    return this.feedbackService.updateFeedbackStatus(id, status, adminNotes);
  }

  /**
   * Update feedback priority (admin only)
   * PATCH /api/v1/feedback/:id/priority
   */
  @Patch(":id/priority")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateFeedbackPriority(
    @Param("id") id: string,
    @Body("priority") priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
  ) {
    this.logger.log(`Updating feedback ${id} priority to ${priority}`);
    return this.feedbackService.updateFeedbackPriority(id, priority);
  }

  /**
   * Assign feedback to admin (admin only)
   * PATCH /api/v1/feedback/:id/assign
   */
  @Patch(":id/assign")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async assignFeedback(
    @Param("id") id: string,
    @Body("assignedTo") assignedTo: string | null,
  ) {
    this.logger.log(
      `Assigning feedback ${id} to ${assignedTo || "unassigned"}`,
    );
    return this.feedbackService.assignFeedback(id, assignedTo);
  }

  /**
   * Batch update feedback status (admin only)
   * PATCH /api/v1/feedback/batch/status
   */
  @Patch("batch/status")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async batchUpdateStatus(
    @Body("ids") ids: string[],
    @Body("status") status: FeedbackStatusEnum,
  ) {
    this.logger.log(
      `Batch updating ${ids.length} feedbacks to status ${status}`,
    );
    return this.feedbackService.batchUpdateStatus(ids, status);
  }

  /**
   * Check email service status (admin only)
   * GET /api/v1/feedback/email/status
   */
  @Get("email/status")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getEmailStatus() {
    return {
      enabled: this.emailService.isEnabled(),
      message: this.emailService.isEnabled()
        ? "Email service is configured and ready"
        : "Email service is not configured. Check SMTP environment variables.",
    };
  }

  /**
   * Reinitialize email service (admin only)
   * POST /api/v1/feedback/email/reinitialize
   */
  @Post("email/reinitialize")
  @UseGuards(JwtAuthGuard, AdminGuard)
  async reinitializeEmail() {
    this.logger.log("Admin requested email service reinitialization");
    void this.emailService.reinitialize();
    return {
      enabled: this.emailService.isEnabled(),
      message: this.emailService.isEnabled()
        ? "Email service reinitialized successfully"
        : "Email service still not configured. Check SMTP environment variables.",
    };
  }
}
