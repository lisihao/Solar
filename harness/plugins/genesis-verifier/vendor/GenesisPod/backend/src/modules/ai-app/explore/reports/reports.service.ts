import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { GenerateReportDto } from "./dto/generate-report.dto";
import { ExportOrchestratorService } from "../../../../common/export";
import { ExportFormat } from "@prisma/client";
import axios from "axios";
import { Response } from "express";

interface ReportSection {
  title: string;
  content: string;
}

interface AIReportResponse {
  title: string;
  summary: string;
  sections: ReportSection[];
  metadata?: Record<string, unknown>;
}

interface ChatDto {
  stream?: boolean;
  [key: string]: unknown;
}

interface ExportDto {
  format: string;
  content: string;
  title: string;
}

interface ReportTemplate {
  id: string;
  name: string;
  category: string;
  promptConfig: unknown;
  version: number;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ExportOrchestratorService))
    private exportOrchestrator: ExportOrchestratorService,
  ) {}

  /**
   * 生成报告
   */
  async generateReport(dto: GenerateReportDto) {
    const templateId = dto.templateId ?? dto.template;

    if (!templateId) {
      throw new BadRequestException("templateId is required");
    }

    const template = await this.prisma.reportTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new BadRequestException("Invalid templateId");
    }

    if (dto.taskId) {
      return this.generateReportFromWorkspaceTask(dto, template);
    }

    if (
      !dto.resourceIds ||
      dto.resourceIds.length < 2 ||
      dto.resourceIds.length > 10
    ) {
      throw new BadRequestException("Please select 2-10 resources");
    }

    return this.generateReportFromResources(dto, template);
  }

  /**
   * 与资源对话
   */
  async chatWithResources(dto: ChatDto, res: Response) {
    try {
      const aiServiceUrl =
        process.env.AI_SERVICE_URL || "http://localhost:5000";

      const response = await axios.post(
        `${aiServiceUrl}/api/v1/ai/simple-chat`,
        dto,
        {
          timeout: 60000, // 1 minute timeout
          responseType: dto.stream ? "stream" : "json", // Support streaming
        },
      );

      // Handle streaming response
      if (dto.stream && response.data) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Pipe the stream from AI service to the client
        response.data.pipe(res);

        // Handle stream errors
        response.data.on("error", (error: Error) => {
          this.logger.error("Stream error", error);
          res.end();
        });

        return; // Don't return data, streaming is handled
      }

      // Handle non-streaming response
      return res.json(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new BadRequestException(
          `AI chat failed: ${error.response?.data?.detail || error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * 获取单个报告
   */
  async findOne(id: string, userId?: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException("Report not found");
    }

    // 如果提供了userId，验证权限
    if (userId && report.userId !== userId) {
      throw new NotFoundException("Report not found");
    }

    // 获取关联的资源
    const resources =
      Array.isArray(report.resourceIds) && report.resourceIds.length > 0
        ? await this.prisma.resource.findMany({
            where: {
              id: {
                in: report.resourceIds as string[],
              },
            },
            select: {
              id: true,
              type: true,
              title: true,
              abstract: true,
              authors: true,
              publishedAt: true,
              thumbnailUrl: true,
              sourceUrl: true,
              pdfUrl: true,
              tags: true,
            },
          })
        : [];

    return {
      ...report,
      resources,
    };
  }

  /**
   * 获取用户的所有报告
   */
  async findByUser(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          template: true,
          templateName: true,
          templateIcon: true,
          summary: true,
          resourceCount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.report.count({
        where: { userId },
      }),
    ]);

    return {
      reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 删除报告
   */
  async delete(id: string, userId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!report) {
      throw new NotFoundException("Report not found");
    }

    if (report.userId !== userId) {
      throw new BadRequestException("Unauthorized");
    }

    await this.prisma.report.delete({
      where: { id },
    });

    return { message: "Report deleted successfully" };
  }

  /**
   * 导出文档为各种格式
   * 使用统一导出模块
   */
  async exportDocument(dto: ExportDto, res: Response, userId: string) {
    try {
      const { format, content, title } = dto;

      // 验证必填字段
      if (!format || !content || !title) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: format, content, title",
        });
      }

      // 验证格式并映射到新的格式名称
      const formatMapping: Record<string, ExportFormat> = {
        word: ExportFormat.DOCX,
        ppt: ExportFormat.PPTX,
        pdf: ExportFormat.PDF,
        markdown: ExportFormat.MARKDOWN,
      };

      const validFormats = Object.keys(formatMapping);
      if (!validFormats.includes(format)) {
        return res.status(400).json({
          success: false,
          error: `Invalid format. Supported formats: ${validFormats.join(", ")}`,
        });
      }

      // 使用统一导出模块创建导出任务
      const exportFormat = formatMapping[format];
      const job = await this.exportOrchestrator.createExportJob(userId, {
        source: {
          type: "RAW",
          content,
          contentType: "markdown",
          title,
        },
        format: exportFormat,
      });

      // 等待导出完成
      let result = job;
      const maxWait = 60000;
      const startTime = Date.now();

      while (
        result.status !== "COMPLETED" &&
        result.status !== "FAILED" &&
        Date.now() - startTime < maxWait
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await this.exportOrchestrator.getJobStatus(job.jobId, userId);
      }

      if (result.status === "COMPLETED") {
        const file = await this.exportOrchestrator.getExportFile(
          job.jobId,
          userId,
        );
        // 设置响应头
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(file.fileName)}"`,
        );
        return res.send(file.buffer);
      } else {
        return res.status(500).json({
          success: false,
          error: result.error || "Export failed",
        });
      }
    } catch (error) {
      this.logger.error("Export error:", error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  private async generateReportFromResources(
    dto: GenerateReportDto,
    template: ReportTemplate,
  ) {
    const resources = await this.prisma.resource.findMany({
      where: {
        id: { in: dto.resourceIds as string[] },
      },
      select: {
        id: true,
        type: true,
        title: true,
        abstract: true,
        authors: true,
        publishedAt: true,
        tags: true,
        pdfUrl: true,
        sourceUrl: true,
      },
    });

    if (resources.length !== (dto.resourceIds as string[]).length) {
      throw new BadRequestException("Some resources not found");
    }

    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:5000";
    const model = dto.model ?? "";

    let aiReport: AIReportResponse;
    try {
      const response = await axios.post(
        `${aiServiceUrl}/api/v1/ai/generate-report`,
        {
          resources: resources.map((r) => ({
            id: r.id,
            title: r.title,
            abstract: r.abstract,
            authors: r.authors,
            published_date: r.publishedAt,
            tags: r.tags,
            type: r.type,
          })),
          template: template.category,
          model,
        },
        { timeout: 120000 },
      );

      aiReport = response.data;
    } catch (error) {
      this.logger.error("AI service error:", error);
      throw new BadRequestException(
        "Failed to generate report. Please try again.",
      );
    }

    return this.prisma.report.create({
      data: {
        userId: dto.userId,
        title: dto.title ?? aiReport.title,
        template: template.id,
        templateName: template.name,
        templateIcon: this.getTemplateIcon(template.category),
        summary: aiReport.summary,
        sections: aiReport.sections as unknown as Prisma.InputJsonValue,
        resourceIds: dto.resourceIds as unknown as Prisma.InputJsonValue,
        resourceCount: dto.resourceIds?.length ?? 0,
        metadata: {
          model,
          generatedAt: new Date().toISOString(),
          templateVersion: template.version,
          ...aiReport.metadata,
        } as Prisma.InputJsonValue,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  private async generateReportFromWorkspaceTask(
    dto: GenerateReportDto,
    template: ReportTemplate,
  ) {
    const task = await this.prisma.workspaceTask.findUnique({
      where: { id: dto.taskId as string },
      include: {
        workspace: {
          select: {
            id: true,
            userId: true,
            resources: {
              select: {
                resourceId: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException("Workspace task not found");
    }
    if (task.workspace.userId !== dto.userId) {
      throw new ForbiddenException("Unauthorized to access workspace task");
    }
    if (!task.result) {
      throw new BadRequestException("任务尚未完成或没有有效结果");
    }

    const resourceIds = task.workspace.resources.map((item) => item.resourceId);

    const sections = this.buildSectionsFromResult(task.result);
    const summary = this.extractSummary(task.result, dto.notes);

    return this.prisma.report.create({
      data: {
        userId: dto.userId,
        title: dto.title ?? template.name,
        template: template.id,
        templateName: template.name,
        templateIcon: this.getTemplateIcon(template.category),
        summary,
        sections,
        resourceIds: resourceIds as Prisma.InputJsonValue,
        resourceCount: resourceIds.length,
        metadata: {
          model: task.model,
          generatedAt: new Date().toISOString(),
          templateVersion: template.version,
          workspaceId: task.workspaceId,
          taskId: task.id,
          rawResult: task.result,
        } as Prisma.InputJsonValue,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  private buildSectionsFromResult(result: unknown): Prisma.InputJsonValue {
    if (
      result &&
      typeof result === "object" &&
      "sections" in result &&
      Array.isArray(result.sections)
    ) {
      const valid = result.sections.every(
        (section: unknown) =>
          typeof section === "object" &&
          section !== null &&
          "title" in section &&
          "content" in section &&
          typeof section.title === "string" &&
          typeof section.content === "string",
      );
      if (valid) {
        return result.sections as Prisma.InputJsonValue;
      }
    }

    return [
      {
        title: "AI Output",
        content: `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
      },
    ] as Prisma.InputJsonValue;
  }

  private extractSummary(result: unknown, fallback?: string): string {
    if (
      result &&
      typeof result === "object" &&
      "summary" in result &&
      typeof result.summary === "string"
    ) {
      return result.summary;
    }
    if (
      result &&
      typeof result === "object" &&
      "overview" in result &&
      typeof result.overview === "string"
    ) {
      return result.overview;
    }
    return fallback ?? "AI 自动生成的报告摘要";
  }

  private getTemplateIcon(category: string): string {
    switch (category) {
      case "comparison":
        return "📊";
      case "summary":
        return "📘";
      case "insights":
        return "💡";
      case "relationship":
        return "🔗";
      default:
        return "🧩";
    }
  }
}
