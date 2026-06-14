/**
 * Google Drive RAG Integration Service
 * Syncs Google Drive files to RAG knowledge bases
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeBaseStatus } from "@prisma/client";
import { OAuth2Client } from "google-auth-library";
import { drive, drive_v3 } from "@googleapis/drive";
import { SyncResult, GoogleDriveFile } from "@/modules/ai-harness/facade";
import * as mammoth from "mammoth";

// Supported MIME types for document processing
const SUPPORTED_MIME_TYPES: Record<string, string> = {
  // Google Workspace 原生格式
  "application/vnd.google-apps.document": "google_doc",
  "application/vnd.google-apps.spreadsheet": "google_sheet",
  "application/vnd.google-apps.presentation": "google_slides",
  "application/vnd.google-apps.drawing": "google_drawing",

  // PDF
  "application/pdf": "pdf",

  // Microsoft Office 格式
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",

  // 文本格式
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
  "text/csv": "csv",
  "text/xml": "xml",
  "application/xml": "xml",
  "application/json": "json",
  "application/rtf": "rtf",
  "text/rtf": "rtf",

  // 电子书格式
  "application/epub+zip": "epub",
};

// Export MIME type mappings for Google Workspace files
const GOOGLE_EXPORT_MIME_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/png", // 导出为 PNG 图片
};

@Injectable()
export class GoogleDriveRAGService {
  private readonly logger = new Logger(GoogleDriveRAGService.name);
  private readonly googleClientId: string;
  private readonly googleClientSecret: string;
  private readonly googleDriveRedirectUri: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly configService: ConfigService,
  ) {
    this.googleClientId = this.configService.get<string>(
      "GOOGLE_CLIENT_ID",
      "",
    );
    this.googleClientSecret = this.configService.get<string>(
      "GOOGLE_CLIENT_SECRET",
      "",
    );
    this.googleDriveRedirectUri = this.configService.get<string>(
      "GOOGLE_DRIVE_REDIRECT_URI",
      "",
    );
  }

  /**
   * Sync a knowledge base with Google Drive
   */
  async syncKnowledgeBase(knowledgeBaseId: string): Promise<SyncResult> {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      deleted: 0,
      errors: [],
    };

    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      include: {
        googleDriveConnection: true,
        documents: {
          select: {
            id: true,
            sourceId: true,
          },
        },
      },
    });

    if (!kb) {
      throw new Error("Knowledge base not found");
    }

    if (!kb.googleDriveConnection) {
      throw new Error("Knowledge base is not connected to Google Drive");
    }

    const folderIds = (kb.googleDriveFolderIds as string[]) || [];
    const fileIds = (kb.googleDriveFileIds as string[]) || [];

    // 需要至少选择一个文件夹或文件
    if (folderIds.length === 0 && fileIds.length === 0) {
      throw new Error("No Google Drive folders or files selected");
    }

    try {
      // Update status
      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: { status: KnowledgeBaseStatus.UPDATING },
      });

      // Get OAuth2 client
      const oauth2Client = await this.getOAuthClient(kb.googleDriveConnection);
      const driveClient = drive({ version: "v3", auth: oauth2Client });

      // Get all files from selected folders
      const allFiles: GoogleDriveFile[] = [];
      for (const folderId of folderIds) {
        const files = await this.listFilesInFolder(driveClient, folderId);
        allFiles.push(...files);
      }

      // Get individual files by ID
      for (const fileId of fileIds) {
        try {
          this.logger.debug(`[getFileById] Fetching file: ${fileId}`);
          const fileMetadata = await this.getFileById(driveClient, fileId);
          if (!fileMetadata) {
            this.logger.warn(
              `[getFileById] File ${fileId} not found or inaccessible`,
            );
            continue;
          }
          if (!this.isSupportedMimeType(fileMetadata.mimeType)) {
            this.logger.warn(
              `[getFileById] File ${fileId} (${fileMetadata.name}) has unsupported MIME type: ${fileMetadata.mimeType}`,
            );
            continue;
          }
          this.logger.debug(
            `[getFileById] Successfully retrieved: ${fileMetadata.name} (${fileMetadata.mimeType})`,
          );
          allFiles.push(fileMetadata);
        } catch (error) {
          this.logger.error(
            `[getFileById] Error fetching file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.log(
        `Found ${allFiles.length} files in Google Drive for KB ${knowledgeBaseId} (${folderIds.length} folders, ${fileIds.length} individual files)`,
      );

      // Track existing document IDs
      const existingDocIds = new Map(
        kb.documents.map((d) => [d.sourceId, d.id]),
      );
      const processedSourceIds = new Set<string>();

      // Process each file
      for (const file of allFiles) {
        processedSourceIds.add(file.id);

        try {
          const existingDocId = existingDocIds.get(file.id);

          if (existingDocId) {
            // Check if file was modified
            const doc = await this.prisma.knowledgeBaseDocument.findUnique({
              where: { id: existingDocId },
            });

            if (doc) {
              const fileModified = file.modifiedTime
                ? new Date(file.modifiedTime)
                : new Date();
              const docProcessed = doc.processedAt || doc.createdAt;

              if (fileModified > docProcessed) {
                // File was modified, update it
                await this.updateDocumentFromFile(
                  existingDocId,
                  file,
                  driveClient,
                );
                result.updated++;
              }
            }
          } else {
            // New file, add it
            await this.addDocumentFromFile(
              knowledgeBaseId,
              kb.googleDriveConnection.id,
              file,
              driveClient,
            );
            result.added++;
          }
        } catch (error) {
          const errorMsg = `Failed to process file ${file.name}: ${error instanceof Error ? error.message : String(error)}`;
          this.logger.error(errorMsg);
          result.errors.push(errorMsg);
        }
      }

      // SAFETY CHECK: Only remove documents if we successfully retrieved files from Google Drive
      // If we got 0 files but have configured fileIds/folderIds, it's likely an API error
      // Do NOT delete existing documents in this case to prevent data loss
      const hasConfiguredSources = folderIds.length > 0 || fileIds.length > 0;
      const retrievedNoFiles = allFiles.length === 0;

      if (hasConfiguredSources && retrievedNoFiles) {
        this.logger.warn(
          `[SAFETY] Skipping document deletion: configured ${folderIds.length} folders and ${fileIds.length} files but retrieved 0 files from Google Drive. This may indicate an API error.`,
        );
      } else if (allFiles.length > 0) {
        // Only delete documents for files that were explicitly removed from Google Drive
        // (i.e., we successfully retrieved files but some existing docs are no longer present)
        for (const [sourceId, docId] of existingDocIds) {
          if (!processedSourceIds.has(sourceId!)) {
            await this.prisma.knowledgeBaseDocument.delete({
              where: { id: docId },
            });
            result.deleted++;
          }
        }
      }

      // Process all pending documents
      if (result.added > 0 || result.updated > 0) {
        await this.knowledgeBaseService.processAllDocuments(knowledgeBaseId);
      }

      // Update knowledge base status
      // Only set to ERROR if ALL files failed (no files added or updated)
      // Partial success (some files processed) should still be READY with error log
      const hasAnySuccess = result.added > 0 || result.updated > 0;
      const allFailed = !hasAnySuccess && result.errors.length > 0;

      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: {
          status: allFailed
            ? KnowledgeBaseStatus.ERROR
            : KnowledgeBaseStatus.READY,
          lastSyncedAt: new Date(),
          // Still log errors even on partial success, but don't fail the KB
          lastError: result.errors.length > 0 ? result.errors.join("\n") : null,
        },
      });

      this.logger.log(
        `Sync completed for KB ${knowledgeBaseId}: +${result.added}, ~${result.updated}, -${result.deleted}`,
      );

      return result;
    } catch (error) {
      await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: {
          status: KnowledgeBaseStatus.ERROR,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  }

  /**
   * List all files in a Google Drive folder (recursively)
   */
  private async listFilesInFolder(
    driveClient: drive_v3.Drive,
    folderId: string,
    maxDepth: number = 3,
    currentDepth: number = 0,
  ): Promise<GoogleDriveFile[]> {
    const files: GoogleDriveFile[] = [];

    if (currentDepth >= maxDepth) {
      return files;
    }

    try {
      let pageToken: string | undefined;

      do {
        const response = await driveClient.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields:
            "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)",
          pageSize: 100,
          pageToken,
        });

        const items = response.data.files || [];

        for (const item of items) {
          // Check if it's a folder
          if (item.mimeType === "application/vnd.google-apps.folder") {
            // Recursively get files from subfolder
            const subFiles = await this.listFilesInFolder(
              driveClient,
              item.id!,
              maxDepth,
              currentDepth + 1,
            );
            files.push(...subFiles);
          } else if (this.isSupportedMimeType(item.mimeType!)) {
            files.push({
              id: item.id!,
              name: item.name!,
              mimeType: item.mimeType!,
              size: item.size ? parseInt(item.size) : undefined,
              modifiedTime: item.modifiedTime || undefined,
              webViewLink: item.webViewLink || undefined,
            });
          }
        }

        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);
    } catch (error) {
      this.logger.error(`Failed to list files in folder ${folderId}:`, error);
    }

    return files;
  }

  /**
   * Add a new document from Google Drive file
   */
  private async addDocumentFromFile(
    knowledgeBaseId: string,
    connectionId: string,
    file: GoogleDriveFile,
    driveClient: drive_v3.Drive,
  ): Promise<void> {
    // Extract content from file
    const content = await this.extractFileContent(driveClient, file);

    if (!content || content.trim().length === 0) {
      throw new Error(`No content extracted from file: ${file.name}`);
    }

    // Add document to knowledge base
    await this.knowledgeBaseService.addDocument(knowledgeBaseId, {
      title: file.name,
      sourceType: "google_drive",
      sourceId: file.id,
      sourceUrl: file.webViewLink,
      mimeType: file.mimeType,
      content,
      metadata: {
        googleDriveFileId: file.id,
        connectionId,
        fileSize: file.size,
        modifiedTime: file.modifiedTime,
      },
    });

    this.logger.log(`Added document from Google Drive: ${file.name}`);
  }

  /**
   * Update an existing document from Google Drive file
   */
  private async updateDocumentFromFile(
    documentId: string,
    file: GoogleDriveFile,
    driveClient: drive_v3.Drive,
  ): Promise<void> {
    // Extract new content
    const content = await this.extractFileContent(driveClient, file);

    if (!content || content.trim().length === 0) {
      throw new Error(`No content extracted from file: ${file.name}`);
    }

    // Update document
    await this.prisma.knowledgeBaseDocument.update({
      where: { id: documentId },
      data: {
        title: file.name,
        rawContent: content,
        status: KnowledgeBaseStatus.PENDING,
        lastError: null,
        metadata: {
          googleDriveFileId: file.id,
          fileSize: file.size,
          modifiedTime: file.modifiedTime,
        },
      },
    });

    // Delete existing chunks
    await this.prisma.parentChunk.deleteMany({
      where: { documentId },
    });

    this.logger.log(`Updated document from Google Drive: ${file.name}`);
  }

  /**
   * Extract content from a Google Drive file
   */
  private async extractFileContent(
    driveClient: drive_v3.Drive,
    file: GoogleDriveFile,
  ): Promise<string> {
    // Handle Google Workspace documents (Docs, Sheets, etc.)
    if (file.mimeType.startsWith("application/vnd.google-apps.")) {
      return this.exportGoogleDoc(driveClient, file);
    }

    // Handle regular files
    return this.downloadFileContent(driveClient, file);
  }

  /**
   * Export Google Docs/Sheets to text
   */
  private async exportGoogleDoc(
    driveClient: drive_v3.Drive,
    file: GoogleDriveFile,
  ): Promise<string> {
    const exportMimeType = GOOGLE_EXPORT_MIME_TYPES[file.mimeType];

    if (!exportMimeType) {
      throw new Error(`Unsupported Google Workspace type: ${file.mimeType}`);
    }

    const response = await driveClient.files.export({
      fileId: file.id,
      mimeType: exportMimeType,
    });

    return response.data as string;
  }

  /**
   * Download and extract content from regular files
   */
  private async downloadFileContent(
    driveClient: drive_v3.Drive,
    file: GoogleDriveFile,
  ): Promise<string> {
    const response = await driveClient.files.get(
      {
        fileId: file.id,
        alt: "media",
      },
      { responseType: "stream" },
    );

    // Collect stream data into buffer
    const chunks: Buffer[] = [];
    const stream = response.data as NodeJS.ReadableStream;

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });

    const buffer = Buffer.concat(chunks);

    this.logger.debug(
      `Downloaded file ${file.name}: ${buffer.length} bytes, first 4 bytes: ${buffer.slice(0, 4).toString("hex")}`,
    );

    // Handle different file types
    if (
      file.mimeType === "text/plain" ||
      file.mimeType === "text/markdown" ||
      file.mimeType === "text/html"
    ) {
      return buffer.toString("utf-8");
    }

    if (file.mimeType === "application/pdf") {
      return this.extractPdfContent(buffer);
    }

    if (
      file.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.mimeType === "application/msword"
    ) {
      return this.extractDocxContent(buffer);
    }

    // Default: try to read as text
    return buffer.toString("utf-8");
  }

  /**
   * Extract text from PDF
   */
  private async extractPdfContent(buffer: Buffer): Promise<string> {
    // Use pdf-parse library if available
    try {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error) {
      this.logger.warn("pdf-parse not available, returning empty string");
      return "";
    }
  }

  /**
   * Extract text from DOCX
   */
  private async extractDocxContent(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      this.logger.warn(`Failed to extract DOCX content: ${error}`);
      return "";
    }
  }

  /**
   * Check if MIME type is supported
   */
  private isSupportedMimeType(mimeType: string): boolean {
    return mimeType in SUPPORTED_MIME_TYPES;
  }

  /**
   * Get a single file by ID from Google Drive
   */
  private async getFileById(
    driveClient: drive_v3.Drive,
    fileId: string,
  ): Promise<GoogleDriveFile | null> {
    try {
      const response = await driveClient.files.get({
        fileId,
        fields: "id, name, mimeType, size, modifiedTime, webViewLink",
      });

      const file = response.data;
      if (!file?.id || !file.name || !file.mimeType) {
        return null;
      }

      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? parseInt(file.size) : undefined,
        modifiedTime: file.modifiedTime || undefined,
        webViewLink: file.webViewLink || undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to get file by ID ${fileId}:`, error);
      return null;
    }
  }

  /**
   * Get OAuth2 client for Google Drive API
   */
  private async getOAuthClient(connection: {
    id: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: string | Date;
  }): Promise<OAuth2Client> {
    const oauth2Client = new OAuth2Client(
      this.googleClientId,
      this.googleClientSecret,
      this.googleDriveRedirectUri,
    );

    oauth2Client.setCredentials({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
    });

    // Check if token needs refresh
    if (new Date() > new Date(connection.tokenExpiry)) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();

        // Update stored tokens
        await this.prisma.googleDriveConnection.update({
          where: { id: connection.id },
          data: {
            accessToken: credentials.access_token!,
            tokenExpiry: new Date(credentials.expiry_date!),
          },
        });

        oauth2Client.setCredentials(credentials);
      } catch (error) {
        this.logger.error("Failed to refresh access token:", error);
        throw new Error("Google Drive authentication expired");
      }
    }

    return oauth2Client;
  }

  /**
   * List folders and files from Google Drive for folder selection UI
   * Returns both folders (for navigation) and files (for display)
   */
  async listFolders(
    userId: string,
    parentFolderId?: string,
  ): Promise<{
    folders: Array<{ id: string; name: string; fileCount: number }>;
    files: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: number;
    }>;
  }> {
    const connection = await this.prisma.googleDriveConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      throw new Error("Google Drive not connected");
    }

    const oauth2Client = await this.getOAuthClient(connection);
    const driveApi = drive({ version: "v3", auth: oauth2Client });

    const parentCondition = parentFolderId
      ? `'${parentFolderId}' in parents`
      : `'root' in parents`;

    // Get folders
    const folderQuery = `${parentCondition} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const folderResponse = await driveApi.files.list({
      q: folderQuery,
      fields: "files(id, name)",
      pageSize: 100,
      orderBy: "name",
    });

    const folders = folderResponse.data.files || [];

    // Count files in each folder
    const foldersWithMeta = await Promise.all(
      folders.map(async (folder) => {
        const childResponse = await driveApi.files.list({
          q: `'${folder.id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
          fields: "files(id)",
          pageSize: 100,
        });

        return {
          id: folder.id!,
          name: folder.name!,
          fileCount: childResponse.data.files?.length || 0,
        };
      }),
    );

    // Get files (non-folders) in current directory
    const fileQuery = `${parentCondition} and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
    const fileResponse = await driveApi.files.list({
      q: fileQuery,
      fields: "files(id, name, mimeType, size)",
      pageSize: 100,
      orderBy: "name",
    });

    const files = (fileResponse.data.files || []).map((file) => ({
      id: file.id!,
      name: file.name!,
      mimeType: file.mimeType || "application/octet-stream",
      size: file.size ? parseInt(file.size, 10) : undefined,
    }));

    return {
      folders: foldersWithMeta,
      files,
    };
  }
}
