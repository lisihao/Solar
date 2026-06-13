/**
 * 统一导出系统 - 导出编排器服务
 * 负责协调整个导出流程
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  ExportFormat,
  ExportJobStatus,
  ExportSourceType,
  Prisma,
} from "@prisma/client";
import { ContentTransformerService } from "./content-transformer.service";
import { TemplateManagerService } from "./template-manager.service";
import {
  ExportRequest,
  ExportJobResponse,
  ExportOptions,
} from "../types/export-options";
import { UnifiedContent } from "../types/unified-content";
import {
  ExportRenderer,
  RENDERER_TOKEN,
  FILE_EXTENSIONS,
  MIME_TYPES,
} from "../renderers/renderer.interface";
import { WysiwygRenderService } from "./wysiwyg-render.service";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";

@Injectable()
export class ExportOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(ExportOrchestratorService.name);
  private exportDir: string;
  private readonly urlExpireHours = 24; // 下载链接有效期

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentTransformer: ContentTransformerService,
    private readonly templateManager: TemplateManagerService,
    @Inject(RENDERER_TOKEN)
    private readonly renderers: Map<ExportFormat, ExportRenderer>,
    private readonly wysiwygRenderService: WysiwygRenderService,
  ) {
    // 设置导出目录
    this.exportDir =
      process.env.EXPORT_DIR || path.join(process.cwd(), "exports");
  }

  async onModuleInit(): Promise<void> {
    await this.ensureExportDir();
  }

  /**
   * 创建导出任务
   */
  async createExportJob(
    userId: string,
    request: ExportRequest,
  ): Promise<ExportJobResponse> {
    // 验证格式支持
    const renderer = this.renderers.get(request.format);
    if (!renderer) {
      throw new Error(`Unsupported export format: ${request.format}`);
    }

    if (request.templateId) {
      try {
        await this.templateManager.getTemplate(request.templateId, userId);
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw new BadRequestException(
            `Invalid export template: ${request.templateId}`,
          );
        }
        throw error;
      }
    }

    // 构建源数据
    let sourceData: Prisma.InputJsonValue | undefined;
    if (request.source.type === "RAW") {
      sourceData = {
        content: (request.source as { content: unknown }).content,
        contentType: (request.source as { contentType: string }).contentType,
        title: (request.source as { title?: string }).title,
      } as Prisma.InputJsonValue;
    } else if (request.source.type === "MISSION") {
      // MISSION 类型需要存储 topicId
      sourceData = {
        topicId: (request.source as { topicId?: string }).topicId,
      } as Prisma.InputJsonValue;
    } else if (request.source.type === "TOPIC_REPORT") {
      sourceData = {
        reportId: (request.source as { reportId?: string }).reportId,
      } as Prisma.InputJsonValue;
    }

    // 构建选项
    const options: Prisma.InputJsonValue = {
      ...(request.options as Record<string, unknown>),
      customTheme: request.customTheme,
      customLayout: request.customLayout,
    } as Prisma.InputJsonValue;

    // 创建导出任务
    const job = await this.prisma.exportJob.create({
      data: {
        userId,
        sourceType: request.source.type as ExportSourceType,
        sourceId: (
          [
            "documentId",
            "sessionId",
            "reportId",
            "missionId",
            "planId",
            "contentId",
            "topicId",
          ] as const
        ).reduce<string | null>(
          (found, key) =>
            found ||
            (key in request.source
              ? (request.source as unknown as Record<string, string>)[key]
              : null),
          null,
        ),
        sourceData,
        format: request.format,
        templateId: request.templateId,
        options,
        status: ExportJobStatus.QUEUED,
      },
    });

    this.logger.log(`Created export job: ${job.id}`);

    // 异步执行导出
    this.processExportJob(job.id).catch((error) => {
      this.logger.error(`Export job failed: ${job.id}`, error);
    });

    return {
      jobId: job.id,
      status: "QUEUED",
      progress: 0,
      estimatedTime: this.estimateTime(request.format),
    };
  }

  /**
   * 获取导出任务状态
   */
  async getJobStatus(
    jobId: string,
    userId: string,
  ): Promise<ExportJobResponse> {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Export job not found: ${jobId}`);
    }

    if (job.userId !== userId) {
      throw new NotFoundException(`Export job not found: ${jobId}`);
    }

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      downloadUrl: job.downloadUrl || undefined,
      expiresAt: job.expiresAt?.toISOString(),
      fileName: job.fileName || undefined,
      fileSize: job.fileSize || undefined,
      error: job.error || undefined,
    };
  }

  /**
   * 获取导出文件
   */
  async getExportFile(
    jobId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Export job not found: ${jobId}`);
    }

    if (job.userId !== userId) {
      throw new NotFoundException(`Export job not found: ${jobId}`);
    }

    if (job.status !== ExportJobStatus.COMPLETED) {
      throw new Error(`Export job not completed: ${jobId}`);
    }

    if (!job.filePath) {
      throw new Error(`Export file not found: ${jobId}`);
    }

    // 检查链接是否过期
    if (job.expiresAt && job.expiresAt < new Date()) {
      throw new Error("Download link has expired");
    }

    const buffer = await fs.readFile(job.filePath);
    const mimeType = MIME_TYPES[job.format];

    return {
      buffer,
      fileName: job.fileName || `export${FILE_EXTENSIONS[job.format]}`,
      mimeType,
    };
  }

  /**
   * 处理导出任务
   */
  private async processExportJob(
    jobId: string,
    retryWithSimplified = false,
  ): Promise<void> {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    try {
      // 更新状态为处理中
      await this.updateJobStatus(jobId, ExportJobStatus.PROCESSING, 10);

      // 1. 获取源内容
      const source = this.reconstructSource(job);
      const options = job.options as Record<string, unknown> | null;

      // 构建转换选项
      const transformOptions: {
        simplifiedMode?: boolean;
        exportScope?: string;
      } = {};

      // MISSION: 传递 simplifiedMode
      if (source.type === "MISSION") {
        transformOptions.simplifiedMode =
          retryWithSimplified ||
          (options?.simplifiedMode as boolean | undefined) ||
          false;
      }

      // PLANNING: 传递 exportScope（full = 全部阶段）
      if (options?.exportScope) {
        transformOptions.exportScope = options.exportScope as string;
      }
      const content = await this.contentTransformer.transform(
        source,
        transformOptions,
      );
      await this.updateJobStatus(jobId, ExportJobStatus.PROCESSING, 30);

      // 2. 获取模板配置
      const { theme, layout } = await this.templateManager.getThemeAndLayout(
        job.templateId || undefined,
        options?.customTheme as Partial<typeof theme> | undefined,
        options?.customLayout as Partial<typeof layout> | undefined,
      );
      await this.updateJobStatus(jobId, ExportJobStatus.PROCESSING, 40);

      // 3. 渲染文档
      const exportOptions = (options || {}) as ExportOptions;
      let buffer: Buffer;

      if (exportOptions.renderMode === "wysiwyg" && exportOptions.wysiwygHtml) {
        // WYSIWYG 模式
        const format = job.format;
        if (
          (format === "DOCX" || format === "PPTX") &&
          this.renderers.get(format)?.renderFromScreenshot
        ) {
          // DOCX/PPTX：先截图，再交给对应渲染器转换为目标格式
          const screenshotBuffer =
            await this.wysiwygRenderService.renderToScreenshots(
              exportOptions.wysiwygHtml,
              exportOptions.wysiwygCss || "",
              {
                pageSize: exportOptions.pageSize,
                orientation: exportOptions.orientation,
              },
            );
          const renderer = this.renderers.get(format)!;
          buffer = await renderer.renderFromScreenshot!(
            screenshotBuffer,
            content.metadata.title || "Export",
            exportOptions,
          );
        } else {
          // PDF/HTML：直接渲染
          buffer = await this.wysiwygRenderService.renderByFormat(
            format,
            exportOptions.wysiwygHtml,
            exportOptions.wysiwygCss,
            exportOptions,
          );
        }
      } else {
        // 编辑模式：使用传统渲染器
        const renderer = this.renderers.get(job.format);
        if (!renderer) {
          throw new Error(`No renderer for format: ${job.format}`);
        }
        buffer = await renderer.render(content, theme, layout, exportOptions);
      }
      await this.updateJobStatus(jobId, ExportJobStatus.PROCESSING, 80);

      // 4. 保存文件
      const fileName = this.generateFileName(
        content,
        job.format,
        (options || undefined) as ExportOptions | undefined,
      );
      const filePath = await this.saveFile(jobId, buffer, fileName);
      await this.updateJobStatus(jobId, ExportJobStatus.PROCESSING, 95);

      // 5. 生成下载链接
      const downloadUrl = this.generateDownloadUrl(jobId);
      const expiresAt = new Date(
        Date.now() + this.urlExpireHours * 60 * 60 * 1000,
      );

      // 5.5 清理大型数据，避免数据库膨胀
      // - WYSIWYG HTML/CSS 渲染完即可丢弃
      // - sourceData 原始内容已生成文件，不再需要存储在 DB
      let cleanOptions: Prisma.InputJsonValue | undefined;
      if (exportOptions.wysiwygHtml || exportOptions.wysiwygCss) {
        const opts = { ...(job.options as Record<string, unknown>) };
        delete opts.wysiwygHtml;
        delete opts.wysiwygCss;
        cleanOptions = opts as Prisma.InputJsonValue;
      }

      // 6. 完成 — 同时清理 sourceData 和 WYSIWYG 数据
      await this.prisma.exportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.COMPLETED,
          progress: 100,
          fileName: retryWithSimplified ? `${fileName} (简化版)` : fileName,
          fileSize: buffer.length,
          filePath,
          downloadUrl,
          expiresAt,
          completedAt: new Date(),
          sourceData: Prisma.DbNull, // 清理原始内容，文件已生成
          ...(cleanOptions ? { options: cleanOptions } : {}),
        },
      });

      this.logger.log(
        `Export job completed: ${jobId}${retryWithSimplified ? " (simplified mode)" : ""}`,
      );
    } catch (error) {
      this.logger.error(`Export job failed: ${jobId}`, error);

      // 对于 MISSION 类型，如果完整导出失败且未使用简化模式，自动重试简化导出
      const source = this.reconstructSource(job);
      if (source.type === "MISSION" && !retryWithSimplified) {
        this.logger.log(`Retrying export job ${jobId} with simplified mode...`);
        try {
          await this.processExportJob(jobId, true);
          return; // 简化模式成功，直接返回
        } catch (retryError) {
          this.logger.error(
            `Simplified export also failed: ${jobId}`,
            retryError,
          );
          // 简化模式也失败，继续使用原始错误
        }
      }

      await this.prisma.exportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * 重构导出源
   */
  private reconstructSource(job: {
    sourceType: string;
    sourceId: string | null;
    sourceData: Prisma.JsonValue | null;
  }): ExportRequest["source"] {
    switch (job.sourceType) {
      case "DOCUMENT":
        return { type: "DOCUMENT", documentId: job.sourceId || "" };
      case "RESEARCH":
        return { type: "RESEARCH", sessionId: job.sourceId || "" };
      case "REPORT":
        return { type: "REPORT", reportId: job.sourceId || "" };
      case "RAW": {
        const sourceData = job.sourceData as {
          content: string;
          contentType: string;
          title?: string;
        } | null;
        return {
          type: "RAW",
          content: sourceData?.content || "",
          contentType: (sourceData?.contentType || "text") as
            | "markdown"
            | "html"
            | "json",
          title: sourceData?.title,
        };
      }
      case "MISSION": {
        const sourceData = job.sourceData as { topicId?: string } | null;
        return {
          type: "MISSION",
          missionId: job.sourceId || "",
          topicId: sourceData?.topicId || "",
        };
      }
      case "PLANNING":
        return { type: "PLANNING", planId: job.sourceId || "" };
      case "WRITING":
        return { type: "WRITING", sessionId: job.sourceId || "" };
      case "SOCIAL":
        return { type: "SOCIAL", contentId: job.sourceId || "" };
      case "SLIDES":
        return { type: "SLIDES", sessionId: job.sourceId || "" };
      case "TOPIC_REPORT": {
        const sourceData = job.sourceData as { reportId?: string } | null;
        return {
          type: "TOPIC_REPORT",
          topicId: job.sourceId || "",
          reportId: sourceData?.reportId,
        };
      }
      default:
        throw new Error(`Unknown source type: ${job.sourceType}`);
    }
  }

  /**
   * 更新任务状态
   */
  private async updateJobStatus(
    jobId: string,
    status: ExportJobStatus,
    progress: number,
  ): Promise<void> {
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: { status, progress },
    });
  }

  /**
   * 生成文件名
   */
  private generateFileName(
    content: UnifiedContent,
    format: ExportFormat,
    options?: ExportOptions,
  ): string {
    if (options?.fileName) {
      const ext = FILE_EXTENSIONS[format];
      const baseName = path.basename(
        options.fileName,
        path.extname(options.fileName),
      );
      return `${baseName}${ext}`;
    }

    // 从标题生成文件名
    const title = content.metadata.title || "export";
    const safeTitle = title
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
      .slice(0, 50);
    const timestamp = new Date().toISOString().slice(0, 10);

    return `${safeTitle}_${timestamp}${FILE_EXTENSIONS[format]}`;
  }

  /**
   * 保存文件
   */
  private async saveFile(
    jobId: string,
    buffer: Buffer,
    fileName: string,
  ): Promise<string> {
    const safeFileName = path.basename(fileName);
    const filePath = path.join(this.exportDir, jobId, safeFileName);

    // 验证路径在导出目录范围内
    const resolvedPath = path.resolve(filePath);
    const resolvedExportDir = path.resolve(this.exportDir);
    if (!resolvedPath.startsWith(resolvedExportDir)) {
      throw new Error("Invalid file path detected");
    }

    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    return filePath;
  }

  /**
   * 生成下载链接
   */
  private generateDownloadUrl(jobId: string): string {
    const baseUrl = process.env.API_BASE_URL || "http://localhost:3001";
    return `${baseUrl}/api/export/${jobId}/download`;
  }

  /**
   * 估算导出时间（秒）
   */
  private estimateTime(format: ExportFormat): number {
    const estimates: Record<ExportFormat, number> = {
      PDF: 15,
      DOCX: 10,
      PPTX: 20,
      XLSX: 8,
      MARKDOWN: 2,
      HTML: 3,
      TARBALL: 30, // ★ v1.5.3 wiki tarball — streaming many files, larger estimate
    };
    return estimates[format] || 10;
  }

  /**
   * 确保导出目录存在，若主目录不可写则回退到 /tmp
   */
  private async ensureExportDir(): Promise<void> {
    try {
      await fs.mkdir(this.exportDir, { recursive: true });
    } catch (error) {
      this.logger.warn(
        `Failed to create export directory at ${this.exportDir}: ${error}`,
      );
      // Fallback to /tmp for restricted filesystems (e.g., Railway)
      const fallbackDir = path.join(os.tmpdir(), "exports");
      try {
        await fs.mkdir(fallbackDir, { recursive: true });
        this.exportDir = fallbackDir;
        this.logger.log(`Using fallback export directory: ${this.exportDir}`);
      } catch (fallbackError) {
        this.logger.error(
          `Failed to create fallback export directory: ${fallbackError}`,
        );
      }
    }
  }

  /**
   * 清理过期的导出文件
   */
  async cleanupExpiredExports(): Promise<number> {
    const expiredJobs = await this.prisma.exportJob.findMany({
      where: {
        status: ExportJobStatus.COMPLETED,
        expiresAt: { lt: new Date() },
        filePath: { not: null },
      },
    });

    let cleaned = 0;
    for (const job of expiredJobs) {
      try {
        if (job.filePath) {
          const dir = path.dirname(job.filePath);
          const resolvedDir = path.resolve(dir);
          const resolvedExportDir = path.resolve(this.exportDir);
          if (!resolvedDir.startsWith(resolvedExportDir)) {
            this.logger.warn(
              `Suspicious filePath for job ${job.id}: ${job.filePath}`,
            );
            continue;
          }
          await fs.rm(dir, { recursive: true, force: true });
        }

        await this.prisma.exportJob.update({
          where: { id: job.id },
          data: {
            filePath: null,
            downloadUrl: null,
          },
        });

        cleaned++;
      } catch (error) {
        this.logger.warn(`Failed to cleanup job ${job.id}: ${error}`);
      }
    }

    this.logger.log(`Cleaned up ${cleaned} expired export jobs`);
    return cleaned;
  }
}
