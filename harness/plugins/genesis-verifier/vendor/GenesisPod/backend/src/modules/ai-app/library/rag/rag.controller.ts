/**
 * RAG Controller
 * Exposes REST API for knowledge base management and RAG queries
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { KnowledgeBaseService } from "./services/knowledge-base.service";
import { RAGPipelineService } from "@/modules/ai-harness/facade";
import { GoogleDriveRAGService } from "./services/google-drive-rag.service";
import { RAGFacade } from "@/modules/ai-harness/facade";
import {
  CreateKnowledgeBaseDto,
  UpdateKnowledgeBaseDto,
  AddDocumentDto,
  RAGQueryDto,
  SimpleQueryDto,
  AddResourcesDto,
  FetchUrlDto,
  ImportUrlsDto,
  ImportBookmarksDto,
  ImportNotesDto,
  ImportOcrDto,
} from "./dto";
import { UpdateVisibilityDto } from "../../../../common/visibility";
import { UrlFetchService } from "./services/url-fetch.service";
import { PlatformImportService } from "./services/platform-import.service";
import { PlaygroundReportImportService } from "./services/playground-report-import.service";
import { TopicReportImportService } from "./services/topic-report-import.service";
import type { RequestWithUser } from "../../../../common/types/express-request.types";

@ApiTags("RAG")
@Controller("rag")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RAGController {
  private readonly logger = new Logger(RAGController.name);

  constructor(
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly ragPipelineService: RAGPipelineService,
    private readonly googleDriveRAGService: GoogleDriveRAGService,
    private readonly ragFacade: RAGFacade,
    private readonly urlFetchService: UrlFetchService,
    private readonly platformImportService: PlatformImportService,
    private readonly playgroundReportImport: PlaygroundReportImportService,
    private readonly topicReportImport: TopicReportImportService,
  ) {}

  // ==================== Embedding Configuration ====================

  @Get("embedding-config")
  @ApiOperation({ summary: "Get current embedding model configuration" })
  @ApiResponse({ status: 200, description: "Embedding configuration" })
  async getEmbeddingConfig() {
    return this.ragFacade.embedding?.getConfigInfo();
  }

  // ==================== Knowledge Base CRUD ====================

  @Post("knowledge-bases")
  @ApiOperation({ summary: "Create a new knowledge base" })
  @ApiResponse({ status: 201, description: "Knowledge base created" })
  async createKnowledgeBase(
    @Req() req: RequestWithUser,
    @Body() dto: CreateKnowledgeBaseDto,
  ) {
    const kb = await this.knowledgeBaseService.create(req.user.id, dto);

    // Auto-sync if Google Drive files are selected
    const hasGoogleDriveFiles =
      dto.googleDriveFileIds && dto.googleDriveFileIds.length > 0;
    const hasGoogleDriveFolders =
      dto.googleDriveFolderIds && dto.googleDriveFolderIds.length > 0;

    if (hasGoogleDriveFiles || hasGoogleDriveFolders) {
      // Await sync to complete so frontend sees documents immediately
      try {
        const syncResult = await this.googleDriveRAGService.syncKnowledgeBase(
          kb.id,
        );
        this.logger.log(
          `Auto-sync completed for KB ${kb.id}: added=${syncResult.added}, updated=${syncResult.updated}`,
        );
      } catch (err) {
        this.logger.error(`Auto-sync failed for KB ${kb.id}`, err);
        // Don't throw - KB was created successfully, sync can be retried later
      }
    }

    // Return the updated KB with document count
    return this.knowledgeBaseService.findById(kb.id, req.user.id);
  }

  @Get("knowledge-bases")
  @ApiOperation({ summary: "List all knowledge bases for current user" })
  @ApiResponse({ status: 200, description: "List of knowledge bases" })
  async listKnowledgeBases(@Req() req: RequestWithUser) {
    return this.knowledgeBaseService.findByUser(req.user.id);
  }

  @Get("knowledge-bases/:id")
  @ApiOperation({ summary: "Get knowledge base by ID" })
  @ApiResponse({ status: 200, description: "Knowledge base details" })
  async getKnowledgeBase(@Req() req: RequestWithUser, @Param("id") id: string) {
    return this.knowledgeBaseService.findById(id, req.user.id);
  }

  @Get("knowledge-bases/:id/stats")
  @ApiOperation({ summary: "Get knowledge base statistics" })
  @ApiResponse({ status: 200, description: "Knowledge base statistics" })
  async getKnowledgeBaseStats(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.knowledgeBaseService.getStats(id);
  }

  @Get("knowledge-bases/:id/documents")
  @ApiOperation({ summary: "List documents in a knowledge base" })
  @ApiResponse({
    status: 200,
    description: "List of documents with vectorization status",
  })
  async listDocuments(@Req() req: RequestWithUser, @Param("id") id: string) {
    this.logger.debug(`Listing documents for KB ${id}`);
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    const documents = await this.knowledgeBaseService.listDocuments(id);
    this.logger.debug(`Found ${documents.length} documents for KB ${id}`);
    return documents;
  }

  @Patch("knowledge-bases/:id")
  @ApiOperation({ summary: "Update a knowledge base" })
  @ApiResponse({ status: 200, description: "Knowledge base updated" })
  async updateKnowledgeBase(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledgeBaseService.update(id, req.user.id, dto);
  }

  @Patch("knowledge-bases/:id/visibility")
  @ApiOperation({ summary: "Update knowledge base visibility" })
  @ApiResponse({ status: 200, description: "Visibility updated" })
  async updateKnowledgeBaseVisibility(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    return this.knowledgeBaseService.updateVisibility(
      req.user.id,
      id,
      dto.visibility,
    );
  }

  @Delete("knowledge-bases/:id")
  @ApiOperation({ summary: "Delete a knowledge base" })
  @ApiResponse({ status: 200, description: "Knowledge base deleted" })
  async deleteKnowledgeBase(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    await this.knowledgeBaseService.delete(id, req.user.id);
    return { message: "Knowledge base deleted successfully" };
  }

  // ==================== Document Management ====================

  @Post("knowledge-bases/:id/documents")
  @ApiOperation({ summary: "Add a document to knowledge base" })
  @ApiResponse({ status: 201, description: "Document added" })
  async addDocument(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: AddDocumentDto,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.knowledgeBaseService.addDocument(id, {
      title: dto.title,
      content: dto.content,
      sourceType: dto.sourceType || "manual",
      sourceUrl: dto.sourceUrl,
      mimeType: dto.mimeType,
    });
  }

  @Delete("documents/:id")
  @ApiOperation({ summary: "Delete a document" })
  @ApiResponse({ status: 200, description: "Document deleted" })
  async deleteDocument(@Req() req: RequestWithUser, @Param("id") id: string) {
    await this.knowledgeBaseService.deleteDocument(id, req.user.id);
    return { message: "Document deleted successfully" };
  }

  @Post("knowledge-bases/:id/process")
  @ApiOperation({ summary: "Process all pending documents in knowledge base" })
  @ApiResponse({ status: 200, description: "Processing started" })
  async processDocuments(@Req() req: RequestWithUser, @Param("id") id: string) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.knowledgeBaseService.processAllDocuments(id);
  }

  @Get("knowledge-bases/:id/progress")
  @ApiOperation({ summary: "Get knowledge base vectorization progress" })
  @ApiResponse({ status: 200, description: "Current progress (or null)" })
  async getProgress(@Req() req: RequestWithUser, @Param("id") id: string) {
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.knowledgeBaseService.getProgress(id);
  }

  @Post("knowledge-bases/:id/add-resources")
  @ApiOperation({
    summary:
      "Add external resources to knowledge base (Google Drive, Notion, etc.)",
  })
  @ApiResponse({ status: 201, description: "Resources added successfully" })
  async addResources(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: AddResourcesDto,
  ) {
    // Verify ownership
    const kb = await this.knowledgeBaseService.findById(id, req.user.id);

    // Check if resources are from Google Drive
    const hasGoogleDrive = dto.resources.some(
      (r) => r.sourceType === "google_drive",
    );

    if (hasGoogleDrive) {
      // For Google Drive files, update the KB's fileIds and trigger sync
      const googleDriveFileIds = dto.resources
        .filter((r) => r.sourceType === "google_drive")
        .map((r) => r.sourceId);

      // Merge with existing file IDs
      const existingFileIds = (kb.googleDriveFileIds as string[]) || [];
      const allFileIds = [
        ...new Set([...existingFileIds, ...googleDriveFileIds]),
      ];

      // Type-safe handling of sourceTypes (JSON field)
      const currentSourceTypes = Array.isArray(kb.sourceTypes)
        ? (kb.sourceTypes as string[])
        : [];
      const hasGoogleDriveSource = currentSourceTypes.includes("GOOGLE_DRIVE");

      // Update KB with new file IDs (this also auto-connects Google Drive if needed)
      await this.knowledgeBaseService.update(id, req.user.id, {
        sourceTypes: hasGoogleDriveSource
          ? currentSourceTypes
          : [...currentSourceTypes, "GOOGLE_DRIVE"],
        googleDriveFileIds: allFileIds,
      });

      // Trigger sync to actually fetch the file content
      const syncResult = await this.googleDriveRAGService.syncKnowledgeBase(id);

      return {
        count: googleDriveFileIds.length,
        syncResult,
      };
    }

    // Handle platform_resource type - fetch actual content from Resource table
    const hasPlatformResource = dto.resources.some(
      (r) => r.sourceType === "platform_resource",
    );

    if (hasPlatformResource) {
      const platformResourceIds = dto.resources
        .filter((r) => r.sourceType === "platform_resource")
        .map((r) => r.sourceId);

      // Fetch the actual Resource records to get their content
      const platformResources =
        await this.knowledgeBaseService.getResourcesByIds(platformResourceIds);
      const resourceMap = new Map(platformResources.map((r) => [r.id, r]));

      const results = [];
      for (const resource of dto.resources) {
        if (resource.sourceType === "platform_resource") {
          const actualResource = resourceMap.get(resource.sourceId);

          // Build content from available fields (priority: content > abstract > aiSummary)
          let content = "";
          if (actualResource) {
            content =
              actualResource.content ||
              actualResource.abstract ||
              actualResource.aiSummary ||
              "";

            // If content is empty OR too short (< 500 chars), try to fetch full content from URL
            // This ensures we get the complete article for proper vectorization,
            // not just a short summary or abstract
            const MIN_CONTENT_LENGTH = 500;
            if (
              (!content || content.length < MIN_CONTENT_LENGTH) &&
              actualResource.sourceUrl
            ) {
              try {
                this.logger.debug(
                  `Content too short (${content.length} chars), fetching from URL: ${actualResource.sourceUrl}`,
                );
                const fetched = await this.urlFetchService.fetchUrl(
                  actualResource.sourceUrl,
                );
                if (
                  fetched.content &&
                  fetched.content.length > content.length
                ) {
                  content = fetched.content;
                  this.logger.debug(`Fetched ${content.length} chars from URL`);
                }
              } catch (err) {
                this.logger.warn(
                  `Failed to fetch URL content: ${err instanceof Error ? err.message : err}`,
                );
                // Keep the existing short content as fallback
              }
            }
          }

          // If still no content, use a minimal placeholder
          if (!content) {
            content = `Resource: ${resource.title}`;
          }

          const doc = await this.knowledgeBaseService.addDocument(id, {
            title: resource.title,
            content,
            sourceType: resource.sourceType,
            sourceId: resource.sourceId,
            sourceUrl: resource.sourceUrl || actualResource?.sourceUrl,
            mimeType: resource.mimeType,
            metadata: {
              originalResourceId: resource.sourceId,
              resourceType: actualResource?.type,
            },
          });
          results.push(doc);
        } else {
          // Other source types still use placeholder behavior
          const doc = await this.knowledgeBaseService.addDocument(id, {
            title: resource.title,
            content: `[Pending content fetch from ${resource.sourceType}]`,
            sourceType: resource.sourceType,
            sourceId: resource.sourceId,
            sourceUrl: resource.sourceUrl,
            mimeType: resource.mimeType,
            metadata: {
              pendingFetch: true,
              externalSource: resource.sourceType,
            },
          });
          results.push(doc);
        }
      }

      return {
        count: results.length,
        documents: results,
      };
    }

    // For other source types, create placeholder documents (legacy behavior)
    const results = [];
    for (const resource of dto.resources) {
      const doc = await this.knowledgeBaseService.addDocument(id, {
        title: resource.title,
        content: `[Pending content fetch from ${resource.sourceType}]`,
        sourceType: resource.sourceType,
        sourceId: resource.sourceId,
        sourceUrl: resource.sourceUrl,
        mimeType: resource.mimeType,
        metadata: {
          pendingFetch: true,
          externalSource: resource.sourceType,
        },
      });
      results.push(doc);
    }

    return {
      count: results.length,
      documents: results,
    };
  }

  // ==================== Google Drive Integration ====================

  @Post("knowledge-bases/:id/sync")
  @ApiOperation({ summary: "Sync knowledge base with Google Drive" })
  @ApiResponse({ status: 200, description: "Sync completed" })
  async syncKnowledgeBase(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.googleDriveRAGService.syncKnowledgeBase(id);
  }

  @Get("google-drive/folders")
  @ApiOperation({ summary: "List Google Drive folders for selection" })
  @ApiResponse({ status: 200, description: "List of folders" })
  async listGoogleDriveFolders(
    @Req() req: RequestWithUser,
    @Query("parentId") parentId?: string,
  ) {
    return this.googleDriveRAGService.listFolders(req.user.id, parentId);
  }

  // ==================== URL Import ====================

  @Post("knowledge-bases/:id/fetch-url")
  @ApiOperation({ summary: "Preview URL content before importing" })
  @ApiResponse({ status: 200, description: "URL content preview" })
  async fetchUrl(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: FetchUrlDto,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.urlFetchService.fetchUrl(dto.url);
  }

  @Post("knowledge-bases/:id/import-urls")
  @ApiOperation({ summary: "Batch import URLs to knowledge base" })
  @ApiResponse({ status: 201, description: "URLs imported" })
  async importUrls(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ImportUrlsDto,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.urlFetchService.importUrls(id, dto.urls);
  }

  // ==================== Platform Bookmark Import ====================

  @Get("knowledge-bases/:id/available-bookmarks")
  @ApiOperation({ summary: "Get available bookmarks for import" })
  @ApiResponse({ status: 200, description: "List of available bookmarks" })
  async getAvailableBookmarks(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.platformImportService.getAvailableBookmarks(req.user.id, {
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post("knowledge-bases/:id/import-bookmarks")
  @ApiOperation({ summary: "Import platform bookmarks to knowledge base" })
  @ApiResponse({ status: 201, description: "Bookmarks imported" })
  async importBookmarks(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ImportBookmarksDto,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.platformImportService.importBookmarks(
      id,
      req.user.id,
      dto.bookmarkIds,
    );
  }

  // ==================== Platform Note Import ====================

  @Get("knowledge-bases/:id/available-notes")
  @ApiOperation({ summary: "Get available notes for import" })
  @ApiResponse({ status: 200, description: "List of available notes" })
  async getAvailableNotes(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.platformImportService.getAvailableNotes(req.user.id, {
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post("knowledge-bases/:id/import-notes")
  @ApiOperation({ summary: "Import platform notes to knowledge base" })
  @ApiResponse({ status: 201, description: "Notes imported" })
  async importNotes(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ImportNotesDto,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);
    return this.platformImportService.importNotes(
      id,
      req.user.id,
      dto.noteIds,
      dto.autoSync,
    );
  }

  // ==================== Image OCR Import ====================

  @Post("knowledge-bases/:id/import-ocr")
  @ApiOperation({ summary: "Import OCR results to knowledge base" })
  @ApiResponse({ status: 201, description: "OCR results imported" })
  async importOcr(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: ImportOcrDto,
  ) {
    // Verify ownership
    await this.knowledgeBaseService.findById(id, req.user.id);

    const results = [];
    for (const doc of dto.documents) {
      const kbDoc = await this.knowledgeBaseService.addDocument(id, {
        title: doc.title,
        content: doc.content,
        sourceType: "IMAGE",
        sourceUrl: doc.imageUrl,
        mimeType: "image/*",
        metadata: {
          ocrProcessed: true,
        },
      });
      results.push(kbDoc.id);
    }

    return {
      count: results.length,
      documentIds: results,
    };
  }

  // ==================== Member Management (Team Knowledge Base) ====================

  @Get("knowledge-bases/:id/members")
  @ApiOperation({ summary: "Get knowledge base members" })
  @ApiResponse({ status: 200, description: "List of members" })
  async getMembers(@Req() req: RequestWithUser, @Param("id") id: string) {
    return this.knowledgeBaseService.getMembers(id, req.user.id);
  }

  @Post("knowledge-bases/:id/members")
  @ApiOperation({ summary: "Add a member to knowledge base" })
  @ApiResponse({ status: 201, description: "Member added" })
  async addMember(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: { email: string; role?: "ADMIN" | "EDITOR" | "VIEWER" },
  ) {
    return this.knowledgeBaseService.addMember(
      id,
      req.user.id,
      dto.email,
      dto.role,
    );
  }

  @Patch("knowledge-bases/:id/members/:memberId")
  @ApiOperation({ summary: "Update member role" })
  @ApiResponse({ status: 200, description: "Member role updated" })
  async updateMemberRole(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Param("memberId") memberId: string,
    @Body() dto: { role: "ADMIN" | "EDITOR" | "VIEWER" },
  ) {
    return this.knowledgeBaseService.updateMemberRole(
      id,
      req.user.id,
      memberId,
      dto.role,
    );
  }

  @Delete("knowledge-bases/:id/members/:memberId")
  @ApiOperation({ summary: "Remove a member from knowledge base" })
  @ApiResponse({ status: 200, description: "Member removed" })
  async removeMember(
    @Req() req: RequestWithUser,
    @Param("id") id: string,
    @Param("memberId") memberId: string,
  ) {
    await this.knowledgeBaseService.removeMember(id, req.user.id, memberId);
    return { message: "Member removed successfully" };
  }

  // ==================== Query Endpoints ====================

  @Post("query")
  @ApiOperation({ summary: "Execute full RAG pipeline query" })
  @ApiResponse({ status: 200, description: "Query results with context" })
  async query(@Req() req: RequestWithUser, @Body() dto: RAGQueryDto) {
    // Verify ownership of all knowledge bases
    for (const kbId of dto.knowledgeBaseIds) {
      await this.knowledgeBaseService.findById(kbId, req.user.id);
    }

    return this.ragPipelineService.query({
      query: dto.query,
      knowledgeBaseIds: dto.knowledgeBaseIds,
      options: {
        topK: dto.topK,
        useHyde: dto.useHyde,
        useRerank: dto.useRerank,
        hybridAlpha: dto.hybridAlpha,
        minScore: dto.minScore,
      },
    });
  }

  @Post("simple-query")
  @ApiOperation({ summary: "Execute simple vector search query" })
  @ApiResponse({ status: 200, description: "Search results" })
  async simpleQuery(@Req() req: RequestWithUser, @Body() dto: SimpleQueryDto) {
    // Verify ownership of all knowledge bases
    for (const kbId of dto.knowledgeBaseIds) {
      await this.knowledgeBaseService.findById(kbId, req.user.id);
    }

    const results = await this.ragPipelineService.simpleQuery(
      dto.query,
      dto.knowledgeBaseIds,
      dto.topK,
    );

    // Enhance results with document titles
    const enhancedResults = await Promise.all(
      results.map(async (result) => {
        // Get document title from the document
        const document = await this.knowledgeBaseService.getDocumentById(
          result.documentId,
        );
        return {
          id: result.childChunkId,
          content: result.content,
          score: result.score,
          documentId: result.documentId,
          documentTitle: document?.title || "Unknown Document",
          metadata: result.metadata,
        };
      }),
    );

    return { results: enhancedResults };
  }

  // ==================== Internal Report Import =====================
  // 2026-05-19: KB 作为 import sink，拉取 ai-app 模块产生的报告
  //   - PlaygroundReport: playground mission 报告（含 rerun versions）
  //   - TopicReport: topic-insights 话题报告（含 incremental refresh versions）
  // 设计：library 直接读 source 表（PrismaService），不反向 import source module。
  //
  // UX 流程（用户在 KB 详情页操作）：
  //   1. 选 KB 详情页 → 「添加文档」面板 → 「从 Playground 导入」
  //   2. GET /rag/importable-playground-missions 列我的所有 mission
  //   3. 多选 mission（默认导入最新版本）→ 可选展开版本列表
  //      GET .../knowledge-bases/:id/importable-playground-missions/:missionId/versions
  //   4. 提交 → 逐条 POST .../knowledge-bases/:id/import-playground-mission

  @Get("importable-playground-missions")
  @ApiOperation({
    summary: "List user's Playground missions available for KB import",
  })
  async listImportableMissions(
    @Req() req: RequestWithUser,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("status") status?: string,
  ) {
    return {
      missions: await this.playgroundReportImport.listImportableMissions(
        req.user.id,
        {
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
          status,
        },
      ),
    };
  }

  @Get("importable-topic-reports")
  @ApiOperation({
    summary: "List user's Topic Insight topics available for KB import",
  })
  async listImportableTopics(
    @Req() req: RequestWithUser,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return {
      topics: await this.topicReportImport.listImportableTopics(req.user.id, {
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      }),
    };
  }

  @Get("knowledge-bases/:id/importable-playground-missions/:missionId/versions")
  @ApiOperation({
    summary: "List importable versions of a Playground mission",
  })
  async listPlaygroundVersions(
    @Req() req: RequestWithUser,
    @Param("id") kbId: string,
    @Param("missionId") missionId: string,
  ) {
    // KB ownership check (defense in depth — list endpoint not write, 但仍要 owner)
    await this.knowledgeBaseService.findById(kbId, req.user.id);
    return {
      versions: await this.playgroundReportImport.listVersions(
        missionId,
        req.user.id,
      ),
    };
  }

  @Post("knowledge-bases/:id/import-playground-mission")
  @ApiOperation({
    summary: "Import a Playground mission report into knowledge base",
  })
  @ApiResponse({ status: 201, description: "Imported as KB document" })
  async importPlaygroundMission(
    @Req() req: RequestWithUser,
    @Param("id") kbId: string,
    @Body() body: { missionId: string; version?: number },
  ) {
    return this.playgroundReportImport.importMissionReport(
      body.missionId,
      req.user.id,
      kbId,
      body.version,
    );
  }

  @Get("knowledge-bases/:id/importable-topic-reports/:topicId/versions")
  @ApiOperation({ summary: "List importable versions of a Topic Insight" })
  async listTopicReportVersions(
    @Req() req: RequestWithUser,
    @Param("id") kbId: string,
    @Param("topicId") topicId: string,
  ) {
    await this.knowledgeBaseService.findById(kbId, req.user.id);
    return {
      versions: await this.topicReportImport.listVersions(topicId, req.user.id),
    };
  }

  @Post("knowledge-bases/:id/import-topic-report")
  @ApiOperation({
    summary: "Import a Topic Insight report into knowledge base",
  })
  @ApiResponse({ status: 201, description: "Imported as KB document" })
  async importTopicReport(
    @Req() req: RequestWithUser,
    @Param("id") kbId: string,
    @Body() body: { topicId: string; version?: number },
  ) {
    return this.topicReportImport.importTopicReport(
      body.topicId,
      req.user.id,
      kbId,
      body.version,
    );
  }
}
