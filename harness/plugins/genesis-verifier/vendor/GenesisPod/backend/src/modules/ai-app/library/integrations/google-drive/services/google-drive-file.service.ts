import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { drive, drive_v3 } from "@googleapis/drive";
import { GoogleDriveAuthService } from "./google-drive-auth.service";
import { ListFilesDto } from "../dto/google-drive.dto";

export interface DriveFile {
  id: string;
  driveFileId: string; // Google Drive 原始 ID
  name: string;
  mimeType: string;
  size: number;
  iconUrl: string | null;
  thumbnailUrl: string | null;
  webViewLink: string;
  webContentLink: string | null;
  parentId: string | null;
  isFolder: boolean;
  description: string | null;
  driveCreatedAt: string;
  driveModifiedAt: string;
  syncStatus: "PENDING" | "SYNCING" | "SUCCESS" | "FAILED";
  lastSyncedAt: string | null;
  linkedResourceId: string | null;
}

export interface FolderPathItem {
  id: string;
  name: string;
  driveFileId: string;
}

export interface ListFilesResult {
  files: DriveFile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  folderPath?: FolderPathItem[];
  nextPageToken?: string;
}

@Injectable()
export class GoogleDriveFileService {
  private readonly logger = new Logger(GoogleDriveFileService.name);

  constructor(private readonly authService: GoogleDriveAuthService) {}

  /**
   * 列出文件
   */
  async listFiles(
    userId: string,
    options: ListFilesDto = {},
  ): Promise<ListFilesResult> {
    const client = await this.authService.getAuthenticatedClient(userId);
    const driveClient = drive({ version: "v3", auth: client });

    try {
      // 规范化参数（处理前端兼容性别名）
      const folderId = options.folderId || options.parentId;
      const pageSize = options.pageSize || options.limit || 20;
      const searchQuery = options.query || options.search;

      // 构建排序字段
      let orderBy = options.orderBy;
      if (!orderBy && options.sortBy) {
        const sortDirection = options.sortOrder === "asc" ? "" : " desc";
        orderBy = `${options.sortBy}${sortDirection}`;
      }
      orderBy = orderBy || "modifiedTime desc";

      // 构建查询条件
      const queryParts: string[] = ["trashed = false"];

      if (folderId) {
        queryParts.push(`'${folderId}' in parents`);
      } else if (!searchQuery) {
        // 如果没有提供 folderId 和自定义 query，则列出 root 目录
        queryParts.push("'root' in parents");
      }

      if (searchQuery) {
        // 如果是简单搜索关键字，转换为 name contains 查询
        if (!searchQuery.includes(" contains ") && !searchQuery.includes("=")) {
          queryParts.push(`name contains '${searchQuery}'`);
        } else {
          queryParts.push(searchQuery);
        }
      }

      const q = queryParts.join(" and ");

      this.logger.debug(`Google Drive query: ${q}, orderBy: ${orderBy}`);

      const response = await driveClient.files.list({
        q,
        pageSize,
        pageToken: options.pageToken,
        orderBy,
        fields:
          "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, iconLink, thumbnailLink, webViewLink, webContentLink, parents, starred, trashed)",
      });

      const files: DriveFile[] = (response.data.files || []).map((file) => ({
        id: file.id!,
        driveFileId: file.id!, // 前端用这个字段导航
        name: file.name!,
        mimeType: file.mimeType!,
        size: file.size ? parseInt(file.size, 10) : 0,
        iconUrl: file.iconLink || null,
        thumbnailUrl: file.thumbnailLink || null,
        webViewLink: file.webViewLink || "",
        webContentLink: file.webContentLink || null,
        parentId: file.parents?.[0] || null,
        isFolder: file.mimeType === "application/vnd.google-apps.folder",
        description: null, // Google API 需要额外请求
        driveCreatedAt: file.createdTime!,
        driveModifiedAt: file.modifiedTime!,
        syncStatus: "SUCCESS" as const,
        lastSyncedAt: new Date().toISOString(),
        linkedResourceId: null,
      }));

      // 构建文件夹路径
      let folderPath: FolderPathItem[] | undefined;
      if (folderId && folderId !== "root") {
        folderPath = await this.buildFolderPath(userId, folderId);
      }

      return {
        files,
        pagination: {
          page: 1, // Google Drive API 使用 pageToken，不是 page number
          limit: pageSize,
          total: files.length, // Google API 不直接返回总数
          totalPages: response.data.nextPageToken ? 2 : 1, // 估算
        },
        folderPath,
        nextPageToken: response.data.nextPageToken || undefined,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; stack?: string };
      this.logger.error(
        `Failed to list files: ${err?.message || error}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Failed to list files from Google Drive: ${err?.message || "Unknown error"}`,
      );
    }
  }

  /**
   * 获取单个文件信息
   */
  async getFile(userId: string, fileId: string): Promise<DriveFile> {
    const client = await this.authService.getAuthenticatedClient(userId);
    const driveClient = drive({ version: "v3", auth: client });

    try {
      const response = await driveClient.files.get({
        fileId,
        fields:
          "id, name, mimeType, size, createdTime, modifiedTime, iconLink, thumbnailLink, webViewLink, webContentLink, parents, starred, trashed",
      });

      const file = response.data;
      return {
        id: file.id!,
        driveFileId: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        size: file.size ? parseInt(file.size, 10) : 0,
        iconUrl: file.iconLink || null,
        thumbnailUrl: file.thumbnailLink || null,
        webViewLink: file.webViewLink || "",
        webContentLink: file.webContentLink || null,
        parentId: file.parents?.[0] || null,
        isFolder: file.mimeType === "application/vnd.google-apps.folder",
        description: null,
        driveCreatedAt: file.createdTime!,
        driveModifiedAt: file.modifiedTime!,
        syncStatus: "SUCCESS" as const,
        lastSyncedAt: new Date().toISOString(),
        linkedResourceId: null,
      };
    } catch (error) {
      this.logger.error(`Failed to get file ${fileId}: ${error}`);
      throw new BadRequestException("Failed to get file from Google Drive");
    }
  }

  /**
   * 构建文件夹路径（面包屑导航）
   */
  private async buildFolderPath(
    userId: string,
    folderId: string,
  ): Promise<FolderPathItem[]> {
    const path: FolderPathItem[] = [];
    let currentId = folderId;

    try {
      const client = await this.authService.getAuthenticatedClient(userId);
      const driveClient = drive({ version: "v3", auth: client });

      // 最多追溯 10 层，防止无限循环
      for (let i = 0; i < 10 && currentId && currentId !== "root"; i++) {
        const response = await driveClient.files.get({
          fileId: currentId,
          fields: "id, name, parents",
        });

        const folder = response.data;
        path.unshift({
          id: folder.id!,
          name: folder.name!,
          driveFileId: folder.id!,
        });

        currentId = folder.parents?.[0] || "";
      }
    } catch (error) {
      this.logger.warn(`Failed to build folder path: ${error}`);
    }

    return path;
  }

  /**
   * 下载文件内容
   */
  async downloadFile(userId: string, fileId: string): Promise<Buffer> {
    const client = await this.authService.getAuthenticatedClient(userId);
    const driveClient = drive({ version: "v3", auth: client });

    try {
      // 首先获取文件元数据以确定 mimeType
      const metadata = await this.getFile(userId, fileId);

      // Google Workspace 文件需要导出
      const isGoogleWorkspaceFile = metadata.mimeType.startsWith(
        "application/vnd.google-apps.",
      );

      if (isGoogleWorkspaceFile) {
        return await this.exportGoogleWorkspaceFile(
          driveClient,
          fileId,
          metadata.mimeType,
        );
      }

      // 普通文件直接下载
      const response = await driveClient.files.get(
        {
          fileId,
          alt: "media",
        },
        { responseType: "arraybuffer" },
      );

      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      this.logger.error(`Failed to download file ${fileId}: ${error}`);
      throw new BadRequestException(
        "Failed to download file from Google Drive",
      );
    }
  }

  /**
   * 导出 Google Workspace 文件
   */
  private async exportGoogleWorkspaceFile(
    driveClient: drive_v3.Drive,
    fileId: string,
    mimeType: string,
  ): Promise<Buffer> {
    // 根据 Google Workspace 文件类型选择导出格式
    let exportMimeType: string;

    if (mimeType === "application/vnd.google-apps.document") {
      exportMimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; // DOCX
    } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
      exportMimeType =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; // XLSX
    } else if (mimeType === "application/vnd.google-apps.presentation") {
      exportMimeType =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"; // PPTX
    } else if (mimeType === "application/vnd.google-apps.drawing") {
      exportMimeType = "application/pdf";
    } else {
      // 默认导出为 PDF
      exportMimeType = "application/pdf";
    }

    const response = await driveClient.files.export(
      {
        fileId,
        mimeType: exportMimeType,
      },
      { responseType: "arraybuffer" },
    );

    return Buffer.from(response.data as ArrayBuffer);
  }

  /**
   * 上传文件
   */
  async uploadFile(
    userId: string,
    folderId: string | undefined,
    fileName: string,
    content: Buffer,
    mimeType: string,
  ): Promise<DriveFile> {
    const client = await this.authService.getAuthenticatedClient(userId);
    const driveClient = drive({ version: "v3", auth: client });

    try {
      const fileMetadata: drive_v3.Schema$File = {
        name: fileName,
        parents: folderId ? [folderId] : undefined,
      };

      const response = await driveClient.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType,
          body: content,
        },
        fields:
          "id, name, mimeType, size, createdTime, modifiedTime, webViewLink",
      });

      const file = response.data;
      return {
        id: file.id!,
        driveFileId: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        size: file.size ? parseInt(file.size, 10) : 0,
        iconUrl: null,
        thumbnailUrl: null,
        webViewLink: file.webViewLink || "",
        webContentLink: null,
        parentId: folderId || null,
        isFolder: file.mimeType === "application/vnd.google-apps.folder",
        description: null,
        driveCreatedAt: file.createdTime!,
        driveModifiedAt: file.modifiedTime!,
        syncStatus: "SUCCESS" as const,
        lastSyncedAt: new Date().toISOString(),
        linkedResourceId: null,
      };
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error}`);
      throw new BadRequestException("Failed to upload file to Google Drive");
    }
  }

  /**
   * 创建文件夹
   */
  async createFolder(
    userId: string,
    parentId: string | undefined,
    name: string,
  ): Promise<DriveFile> {
    const client = await this.authService.getAuthenticatedClient(userId);
    const driveClient = drive({ version: "v3", auth: client });

    try {
      const fileMetadata: drive_v3.Schema$File = {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
      };

      const response = await driveClient.files.create({
        requestBody: fileMetadata,
        fields: "id, name, mimeType, createdTime, modifiedTime, webViewLink",
      });

      const file = response.data;
      return {
        id: file.id!,
        driveFileId: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        size: 0,
        iconUrl: null,
        thumbnailUrl: null,
        webViewLink: file.webViewLink || "",
        webContentLink: null,
        parentId: parentId || null,
        isFolder: true,
        description: null,
        driveCreatedAt: file.createdTime!,
        driveModifiedAt: file.modifiedTime!,
        syncStatus: "SUCCESS" as const,
        lastSyncedAt: new Date().toISOString(),
        linkedResourceId: null,
      };
    } catch (error) {
      this.logger.error(`Failed to create folder: ${error}`);
      throw new BadRequestException("Failed to create folder in Google Drive");
    }
  }
}
