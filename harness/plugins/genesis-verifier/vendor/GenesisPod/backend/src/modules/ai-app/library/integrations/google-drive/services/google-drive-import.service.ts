import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ContentExtractorService } from "../../../../../../common/content-processing/content-extractor.service";
import { GoogleDriveFileService } from "./google-drive-file.service";
import { ImportFilesDto } from "../dto/google-drive.dto";

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

export interface ImportResult {
  totalFiles: number;
  imported: number;
  failed: number;
  resourceIds: string[];
  errors: Array<{ fileId: string; error: string }>;
}

@Injectable()
export class GoogleDriveImportService {
  private readonly logger = new Logger(GoogleDriveImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: GoogleDriveFileService,
    private readonly contentExtractor: ContentExtractorService,
  ) {}

  /**
   * 导入文件到 Library
   */
  async importFiles(
    userId: string,
    dto: ImportFilesDto,
  ): Promise<ImportResult> {
    const result: ImportResult = {
      totalFiles: dto.fileIds.length,
      imported: 0,
      failed: 0,
      resourceIds: [],
      errors: [],
    };

    // 获取用户的 Google Drive 连接
    const connection = await this.prisma.googleDriveConnection.findFirst({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException("Google Drive not connected");
    }

    try {
      for (const fileId of dto.fileIds) {
        // 为每个文件创建同步历史记录
        const syncHistory = await this.prisma.googleDriveSyncHistory.create({
          data: {
            connectionId: connection.id,
            action: GoogleDriveSyncAction.IMPORT,
            status: GoogleDriveSyncStatus.IN_PROGRESS,
            googleFileId: fileId,
            startedAt: new Date(),
          },
        });

        try {
          const { resourceId, fileName } = await this.importSingleFile(
            userId,
            fileId,
            dto,
          );
          result.resourceIds.push(resourceId);
          result.imported++;

          // 更新同步历史为成功
          await this.prisma.googleDriveSyncHistory.update({
            where: { id: syncHistory.id },
            data: {
              status: GoogleDriveSyncStatus.SUCCESS,
              resourceId,
              googleFileName: fileName,
              completedAt: new Date(),
            },
          });
        } catch (error) {
          this.logger.error(`Failed to import file ${fileId}: ${error}`);
          result.failed++;
          result.errors.push({
            fileId,
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
   * 导入单个文件
   */
  private async importSingleFile(
    userId: string,
    fileId: string,
    dto: ImportFilesDto,
  ): Promise<{ resourceId: string; fileName: string }> {
    // 获取文件信息
    const file = await this.fileService.getFile(userId, fileId);

    this.logger.log(`Importing file: ${file.name} (${file.mimeType})`);

    // 下载文件内容
    const content = await this.fileService.downloadFile(userId, fileId);

    // 提取文本内容（如果启用）
    let extractedContent: string | null = null;
    const summary: string | null = null;

    if (dto.extractContent) {
      try {
        extractedContent = await this.extractContent(
          file.name,
          file.mimeType,
          content,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to extract content from ${file.name}: ${error}`,
        );
      }
    }

    // TODO: 如果启用生成摘要，调用 AI 服务生成摘要
    if (dto.generateSummary && extractedContent) {
      // summary = await this.generateSummary(extractedContent);
      this.logger.warn("Summary generation not yet implemented");
    }

    // 创建资源记录
    const resource = await this.prisma.resource.create({
      data: {
        type: this.mapMimeTypeToResourceType(file.mimeType),
        title: file.name,
        sourceUrl:
          file.webViewLink ||
          file.webContentLink ||
          `https://drive.google.com/file/d/${fileId}`,
        abstract: summary,
        content: extractedContent,
        metadata: {
          source: "google_drive",
          fileId: file.driveFileId,
          mimeType: file.mimeType,
          size: file.size,
          createdTime: file.driveCreatedAt,
          modifiedTime: file.driveModifiedAt,
          iconLink: file.iconUrl,
          thumbnailLink: file.thumbnailUrl,
        },
        tags: dto.tags || [],
        // 通过 CollectionItem 关联到用户的收藏
        collectionItems: dto.collectionId
          ? {
              create: {
                collectionId: dto.collectionId,
                position: 0,
              },
            }
          : undefined,
      },
    });

    this.logger.log(
      `Successfully imported file ${file.name} as resource ${resource.id}`,
    );

    return { resourceId: resource.id, fileName: file.name };
  }

  /**
   * 提取文件内容
   */
  private async extractContent(
    fileName: string,
    mimeType: string,
    content: Buffer,
  ): Promise<string> {
    // 使用 ContentExtractorService 统一处理文件提取
    try {
      return await this.contentExtractor.extractFromFile(
        content,
        mimeType,
        fileName,
      );
    } catch (error) {
      this.logger.warn(`Failed to extract content from ${fileName}: ${error}`);
      return "";
    }
  }

  /**
   * 将 MIME 类型映射到资源类型
   * 根据 schema.prisma 中定义的 ResourceType 枚举
   */
  private mapMimeTypeToResourceType(
    mimeType: string,
  ):
    | "PAPER"
    | "BLOG"
    | "REPORT"
    | "YOUTUBE_VIDEO"
    | "NEWS"
    | "PROJECT"
    | "EVENT"
    | "RSS"
    | "POLICY" {
    // 优先映射为论文类型（PDF 文件）
    if (mimeType === "application/pdf") return "PAPER";

    // 文档类型映射为报告
    if (mimeType.includes("document") || mimeType.includes("word"))
      return "REPORT";
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
      return "REPORT";
    if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
      return "REPORT";

    // 视频类型
    if (mimeType.startsWith("video/")) return "YOUTUBE_VIDEO";

    // 文本文件映射为博客
    if (mimeType.startsWith("text/")) return "BLOG";
    if (mimeType === "application/json") return "BLOG";
    if (mimeType === "application/xml") return "BLOG";

    // 其他类型默认为报告
    return "REPORT";
  }
}
