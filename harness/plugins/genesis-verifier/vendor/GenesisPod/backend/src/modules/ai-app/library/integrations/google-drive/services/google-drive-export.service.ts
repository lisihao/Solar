import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { GoogleDriveFileService } from "./google-drive-file.service";
import { ExportResourcesDto, ExportFormat } from "../dto/google-drive.dto";
import { APP_CONFIG } from "../../../../../../common/config/app.config";

// Google Drive sync status and action
const GoogleDriveSyncAction = {
  IMPORT: "IMPORT",
  EXPORT: "EXPORT",
} as const;

const GoogleDriveSyncStatus = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
} as const;

export interface ExportResult {
  totalResources: number;
  exported: number;
  failed: number;
  fileIds: string[];
  errors: Array<{ resourceId: string; error: string }>;
}

@Injectable()
export class GoogleDriveExportService {
  private readonly logger = new Logger(GoogleDriveExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: GoogleDriveFileService,
  ) {}

  /**
   * 导出资源到 Google Drive
   */
  async exportResources(
    userId: string,
    dto: ExportResourcesDto,
  ): Promise<ExportResult> {
    const result: ExportResult = {
      totalResources: dto.resourceIds.length,
      exported: 0,
      failed: 0,
      fileIds: [],
      errors: [],
    };

    // 获取用户的 Google Drive 连接
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Google Drive not connected");
    }

    // 如果需要创建文件夹，先创建文件夹结构
    let targetFolderId = dto.folderId;
    if (dto.createFolders && !targetFolderId) {
      try {
        const folder = await this.fileService.createFolder(
          userId,
          undefined,
          `${APP_CONFIG.brand.name} Exports`,
        );
        targetFolderId = folder.id;
        this.logger.log(`Created export folder: ${folder.id}`);
      } catch (error) {
        this.logger.warn(`Failed to create export folder: ${error}`);
      }
    }

    try {
      for (const resourceId of dto.resourceIds) {
        // 为每个资源创建同步历史记录
        const syncHistory = await this.prisma.googleDriveSyncHistory.create({
          data: {
            connectionId: connection.id,
            action: GoogleDriveSyncAction.EXPORT,
            status: GoogleDriveSyncStatus.IN_PROGRESS,
            resourceId,
            exportFormat: dto.format || ExportFormat.ORIGINAL,
            targetFolderId: targetFolderId,
            startedAt: new Date(),
          },
        });

        try {
          const { fileId, fileName } = await this.exportSingleResource(
            userId,
            resourceId,
            dto,
            targetFolderId,
          );
          result.fileIds.push(fileId);
          result.exported++;

          // 更新同步历史为成功
          await this.prisma.googleDriveSyncHistory.update({
            where: { id: syncHistory.id },
            data: {
              status: GoogleDriveSyncStatus.SUCCESS,
              googleFileId: fileId,
              googleFileName: fileName,
              completedAt: new Date(),
            },
          });
        } catch (error) {
          this.logger.error(
            `Failed to export resource ${resourceId}: ${error}`,
          );
          result.failed++;
          result.errors.push({
            resourceId,
            error: error instanceof Error ? error.message : String(error),
          });

          // 更新同步历史为失败
          await this.prisma.googleDriveSyncHistory.update({
            where: { id: syncHistory.id },
            data: {
              status: GoogleDriveSyncStatus.FAILED,
              error: error instanceof Error ? error.message : String(error),
              completedAt: new Date(),
            },
          });
        }
      }

      // 更新连接的最后同步时间
      await this.prisma.googleDriveConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date() },
      });

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 导出单个资源
   */
  private async exportSingleResource(
    userId: string,
    resourceId: string,
    dto: ExportResourcesDto,
    targetFolderId?: string,
  ): Promise<{ fileId: string; fileName: string }> {
    // 获取资源信息并验证用户权限
    const resource = await this.prisma.resource.findFirst({
      where: {
        id: resourceId,
        collectionItems: {
          some: {
            collection: {
              userId: userId,
            },
          },
        },
      },
      select: {
        title: true,
        content: true,
        abstract: true,
        sourceUrl: true,
        tags: true,
      },
    });

    if (!resource) {
      throw new BadRequestException(
        `Resource ${resourceId} not found or access denied`,
      );
    }

    this.logger.log(`Exporting resource: ${resource.title}`);

    // 生成文件内容和元数据
    const { content, mimeType, fileName } = await this.generateExportFile(
      {
        title: resource.title,
        content: resource.content || undefined,
        description: resource.abstract || undefined,
        url: resource.sourceUrl || undefined,
        tags: (resource.tags as unknown as string[]) || undefined,
      },
      dto,
    );

    // 上传到 Google Drive
    const file = await this.fileService.uploadFile(
      userId,
      targetFolderId,
      fileName,
      content,
      mimeType,
    );

    this.logger.log(
      `Successfully exported resource ${resource.title} as ${file.name} (${file.id})`,
    );

    return { fileId: file.id, fileName: file.name };
  }

  /**
   * 生成导出文件
   */
  private async generateExportFile(
    resource: {
      title: string;
      content?: string;
      description?: string;
      url?: string;
      tags?: string[];
    },
    dto: ExportResourcesDto,
  ): Promise<{ content: Buffer; mimeType: string; fileName: string }> {
    const format = dto.format || ExportFormat.ORIGINAL;
    const prefix = dto.fileNamePrefix || "";
    const baseFileName = this.sanitizeFileName(`${prefix}${resource.title}`);

    // 根据格式生成内容
    switch (format) {
      case ExportFormat.ORIGINAL:
        return this.exportAsOriginal(resource, baseFileName);

      case ExportFormat.MARKDOWN:
        return this.exportAsMarkdown(resource, baseFileName);

      case ExportFormat.TXT:
        return this.exportAsTxt(resource, baseFileName);

      case ExportFormat.HTML:
        return this.exportAsHtml(resource, baseFileName);

      case ExportFormat.PDF:
        throw new BadRequestException("PDF export not yet implemented");

      case ExportFormat.DOCX:
        throw new BadRequestException("DOCX export not yet implemented");

      default:
        return this.exportAsOriginal(resource, baseFileName);
    }
  }

  /**
   * 导出为原始格式
   */
  private async exportAsOriginal(
    resource: { content?: string; description?: string },
    baseFileName: string,
  ): Promise<{ content: Buffer; mimeType: string; fileName: string }> {
    const content = resource.content || resource.description || "";
    return {
      content: Buffer.from(content, "utf-8"),
      mimeType: "text/plain",
      fileName: `${baseFileName}.txt`,
    };
  }

  /**
   * 导出为 Markdown
   */
  private async exportAsMarkdown(
    resource: {
      title: string;
      description?: string;
      url?: string;
      tags?: string[];
      content?: string;
    },
    baseFileName: string,
  ): Promise<{ content: Buffer; mimeType: string; fileName: string }> {
    let markdown = `# ${resource.title}\n\n`;

    if (resource.description) {
      markdown += `${resource.description}\n\n`;
    }

    if (resource.url) {
      markdown += `**Source:** ${resource.url}\n\n`;
    }

    if (resource.tags && resource.tags.length > 0) {
      markdown += `**Tags:** ${resource.tags.join(", ")}\n\n`;
    }

    markdown += `---\n\n`;

    if (resource.content) {
      markdown += resource.content;
    }

    return {
      content: Buffer.from(markdown, "utf-8"),
      mimeType: "text/markdown",
      fileName: `${baseFileName}.md`,
    };
  }

  /**
   * 导出为纯文本
   */
  private async exportAsTxt(
    resource: {
      title: string;
      description?: string;
      url?: string;
      tags?: string[];
      content?: string;
    },
    baseFileName: string,
  ): Promise<{ content: Buffer; mimeType: string; fileName: string }> {
    let text = `${resource.title}\n${"=".repeat(resource.title.length)}\n\n`;

    if (resource.description) {
      text += `${resource.description}\n\n`;
    }

    if (resource.url) {
      text += `Source: ${resource.url}\n\n`;
    }

    if (resource.tags && resource.tags.length > 0) {
      text += `Tags: ${resource.tags.join(", ")}\n\n`;
    }

    text += `${"-".repeat(50)}\n\n`;

    if (resource.content) {
      text += resource.content;
    }

    return {
      content: Buffer.from(text, "utf-8"),
      mimeType: "text/plain",
      fileName: `${baseFileName}.txt`,
    };
  }

  /**
   * 导出为 HTML
   */
  private async exportAsHtml(
    resource: {
      title: string;
      description?: string;
      url?: string;
      tags?: string[];
      content?: string;
    },
    baseFileName: string,
  ): Promise<{ content: Buffer; mimeType: string; fileName: string }> {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(resource.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    .meta { color: #666; font-size: 14px; margin: 20px 0; }
    .content { line-height: 1.6; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(resource.title)}</h1>
  <div class="meta">
    ${resource.description ? `<p><strong>Description:</strong> ${this.escapeHtml(resource.description)}</p>` : ""}
    ${resource.url ? `<p><strong>Source:</strong> <a href="${this.escapeHtml(resource.url)}">${this.escapeHtml(resource.url)}</a></p>` : ""}
    ${resource.tags && resource.tags.length > 0 ? `<p><strong>Tags:</strong> ${resource.tags.map((t: string) => this.escapeHtml(t)).join(", ")}</p>` : ""}
  </div>
  <hr>
  <div class="content">
    ${resource.content ? this.markdownToHtml(resource.content) : ""}
  </div>
</body>
</html>`;

    return {
      content: Buffer.from(html, "utf-8"),
      mimeType: "text/html",
      fileName: `${baseFileName}.html`,
    };
  }

  /**
   * 清理文件名
   */
  private sanitizeFileName(fileName: string): string {
    return fileName
      .replace(/[<>:"/\\|?*]/g, "-") // 替换非法字符
      .replace(/\s+/g, "_") // 替换空格
      .slice(0, 200); // 限制长度
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * 简单的 Markdown 到 HTML 转换
   */
  private markdownToHtml(markdown: string): string {
    // 这是一个非常简化的实现，生产环境应该使用 marked 或类似库
    return markdown
      .replace(/\n/g, "<br>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }
}
