import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
  UnauthorizedException,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
} from "@nestjs/swagger";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ResearchProjectService } from "./research-project.service";
import { ResearchProjectSourceService } from "./research-project-source.service";
import { ResearchProjectChatService } from "./research-project-chat.service";
import { ResearchProjectOutputService } from "./research-project-output.service";
import { ResearchProjectTTSService } from "./research-project-tts.service";
import {
  CreateStudioProjectDto,
  UpdateProjectDto,
  AddSourceDto,
  AddSourcesDto,
  SendChatMessageDto,
  CreateNoteDto,
  UpdateNoteDto,
  GenerateOutputDto,
  SearchSourcesDto,
  SedimentToInsightsDto,
} from "./dto";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { parsePagination } from "../../../../common/utils/pagination.utils";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { BillingContextInterceptor } from "../interceptors/billing-context.interceptor";

@ApiTags("ai-studio")
@ApiBearerAuth("access-token")
@Controller("ai-studio")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class ResearchProjectController {
  constructor(
    private readonly studioService: ResearchProjectService,
    private readonly sourceService: ResearchProjectSourceService,
    private readonly chatService: ResearchProjectChatService,
    private readonly outputService: ResearchProjectOutputService,
    private readonly ttsService: ResearchProjectTTSService,
  ) {}

  // ==================== Projects ====================

  /**
   * Create a new research project
   */
  @Post("projects")
  @ApiOperation({
    summary: "创建研究项目",
    description: "创建一个新的专题研究项目",
  })
  @ApiResponse({ status: 201, description: "项目创建成功" })
  @ApiResponse({ status: 401, description: "未认证" })
  async createProject(
    @Request() req: RequestWithUser,
    @Body() dto: CreateStudioProjectDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.studioService.createProject(userId, dto);
  }

  /**
   * Get all projects for the current user
   */
  @Get("projects")
  @ApiOperation({
    summary: "获取项目列表",
    description: "获取当前用户的所有研究项目",
  })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["ACTIVE", "ARCHIVED"],
    description: "项目状态",
  })
  @ApiQuery({
    name: "researchType",
    required: false,
    enum: ["FAST", "DEEP"],
    description: "研究类型",
  })
  @ApiQuery({ name: "search", required: false, description: "搜索关键词" })
  @ApiQuery({ name: "take", required: false, description: "每页数量" })
  @ApiQuery({ name: "skip", required: false, description: "跳过数量" })
  @ApiResponse({ status: 200, description: "返回项目列表" })
  async getProjects(
    @Request() req: RequestWithUser,
    @Query("status") status?: "ACTIVE" | "ARCHIVED",
    @Query("researchType") researchType?: "FAST" | "DEEP",
    @Query("search") search?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const pagination = parsePagination(skip, take);
    return this.studioService.getProjects(userId, {
      status,
      researchType,
      search,
      ...pagination,
    });
  }

  /**
   * Get a single project by ID
   */
  @Get("projects/:id")
  async getProject(@Request() req: RequestWithUser, @Param("id") id: string) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.studioService.getProject(userId, id);
  }

  /**
   * Update a project
   */
  @Patch("projects/:id")
  async updateProject(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.studioService.updateProject(userId, id, dto);
  }

  /**
   * Delete a project
   */
  @Delete("projects/:id")
  async deleteProject(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.studioService.deleteProject(userId, id);
  }

  /**
   * Archive a project
   */
  @Post("projects/:id/archive")
  async archiveProject(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.studioService.archiveProject(userId, id);
  }

  /**
   * Restore an archived project
   */
  @Post("projects/:id/restore")
  async restoreProject(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.studioService.restoreProject(userId, id);
  }

  // ==================== Sources ====================

  /**
   * Add a source to a project
   */
  @Post("projects/:projectId/sources")
  async addSource(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: AddSourceDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.sourceService.addSource(userId, projectId, dto);
  }

  /**
   * Add multiple sources to a project
   */
  @Post("projects/:projectId/sources/batch")
  async addSources(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: AddSourcesDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.sourceService.addSources(userId, projectId, dto.sources);
  }

  /**
   * Upload files as sources
   */
  @Post("projects/:projectId/sources/upload")
  @ApiOperation({
    summary: "上传文件作为资料",
    description: "上传 PDF、Word、TXT、Markdown 文件到项目中",
  })
  @ApiConsumes("multipart/form-data")
  @ApiResponse({ status: 201, description: "文件上传成功" })
  @ApiResponse({ status: 400, description: "不支持的文件类型或文件过大" })
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
      fileFilter: (_req, file, callback) => {
        const allowedTypes = [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/msword",
          "text/plain",
          "text/markdown",
        ];
        if (allowedTypes.includes(file.mimetype)) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException(`Unsupported file type: ${file.mimetype}`),
            false,
          );
        }
      },
    }),
  )
  async uploadSources(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.sourceService.uploadFiles(userId, projectId, files);
  }

  /**
   * Get all sources for a project
   */
  @Get("projects/:projectId/sources")
  async getSources(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.sourceService.getSources(userId, projectId);
  }

  /**
   * Get a single source
   */
  @Get("projects/:projectId/sources/:sourceId")
  async getSource(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.sourceService.getSource(userId, projectId, sourceId);
  }

  /**
   * Remove a source from a project
   */
  @Delete("projects/:projectId/sources/:sourceId")
  async removeSource(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.sourceService.removeSource(userId, projectId, sourceId);
  }

  /**
   * Search for sources
   */
  @Post("search")
  async searchSources(
    @Request() req: RequestWithUser,
    @Body() dto: SearchSourcesDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.sourceService.searchSources(userId, dto);
  }

  // ==================== Chat ====================

  /**
   * Get current chat session for a project
   */
  @Get("projects/:projectId/chat")
  async getCurrentChat(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.getCurrentChat(userId, projectId);
  }

  /**
   * Send a chat message
   */
  @Post("projects/:projectId/chat/messages")
  async sendChatMessage(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: SendChatMessageDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.sendMessage(userId, projectId, dto);
  }

  /**
   * Get chat history for a project
   */
  @Get("projects/:projectId/chat/history")
  async getChatHistory(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.getChatHistory(userId, projectId);
  }

  /**
   * Start a new chat session
   */
  @Post("projects/:projectId/chat/new")
  async startNewChat(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.startNewChat(userId, projectId);
  }

  // ==================== Notes ====================

  /**
   * Create a note in a project
   */
  @Post("projects/:projectId/notes")
  async createNote(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateNoteDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.createNote(userId, projectId, dto);
  }

  /**
   * Get all notes for a project
   */
  @Get("projects/:projectId/notes")
  async getNotes(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.getNotes(userId, projectId);
  }

  /**
   * Update a note
   */
  @Patch("projects/:projectId/notes/:noteId")
  async updateNote(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
    @Body() dto: UpdateNoteDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.updateNote(userId, projectId, noteId, dto);
  }

  /**
   * Delete a note
   */
  @Delete("projects/:projectId/notes/:noteId")
  async deleteNote(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("noteId") noteId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.chatService.deleteNote(userId, projectId, noteId);
  }

  // ==================== Outputs ====================

  /**
   * Get available output types
   */
  @Get("output-types")
  async getOutputTypes() {
    return this.outputService.getOutputTypes();
  }

  /**
   * Generate an output
   */
  @Post("projects/:projectId/outputs")
  async generateOutput(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: GenerateOutputDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.outputService.generateOutput(userId, projectId, dto);
  }

  /**
   * Get all outputs for a project
   */
  @Get("projects/:projectId/outputs")
  async getOutputs(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.outputService.getOutputs(userId, projectId);
  }

  /**
   * Get a single output
   */
  @Get("projects/:projectId/outputs/:outputId")
  async getOutput(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("outputId") outputId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.outputService.getOutput(userId, projectId, outputId);
  }

  /**
   * Delete an output
   */
  @Delete("projects/:projectId/outputs/:outputId")
  async deleteOutput(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("outputId") outputId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.outputService.deleteOutput(userId, projectId, outputId);
  }

  /**
   * Update an output (e.g., rename)
   */
  @Patch("projects/:projectId/outputs/:outputId")
  async updateOutput(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("outputId") outputId: string,
    @Body() body: { title?: string },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.outputService.updateOutputProperties(
      userId,
      projectId,
      outputId,
      body,
    );
  }

  /**
   * Regenerate an output
   */
  @Post("projects/:projectId/outputs/:outputId/regenerate")
  async regenerateOutput(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("outputId") outputId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.outputService.regenerateOutput(userId, projectId, outputId);
  }

  /**
   * Generate audio for an AUDIO_OVERVIEW output
   */
  @Post("projects/:projectId/outputs/:outputId/audio")
  @ApiOperation({ summary: "Generate audio for an Audio Overview output" })
  @ApiResponse({ status: 200, description: "Audio generated successfully" })
  async generateAudio(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("outputId") outputId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    // Get the output
    const output = await this.outputService.getOutput(
      userId,
      projectId,
      outputId,
    );

    if (output.type !== "AUDIO_OVERVIEW") {
      throw new BadRequestException("Output is not an Audio Overview");
    }

    if (output.status !== "COMPLETED" || !output.content) {
      throw new BadRequestException("Output is not ready for audio generation");
    }

    // Check if TTS is available
    if (!this.ttsService.isAvailable()) {
      return {
        available: false,
        provider: "none",
        message:
          "No TTS provider configured. Set ELEVENLABS_API_KEY or GOOGLE_TTS_API_KEY.",
        // Return script for client-side TTS fallback
        script: this.ttsService.parseScript(output.content),
      };
    }

    // Parse script and generate audio
    const script = this.ttsService.parseScript(output.content);
    if (!script) {
      throw new BadRequestException("Failed to parse audio script");
    }

    const audio = await this.ttsService.generateAudio(script);
    if (!audio) {
      throw new BadRequestException("Failed to generate audio");
    }

    return {
      available: true,
      provider: this.ttsService.getProvider(),
      audioUrl: audio.audioUrl,
      duration: audio.duration,
      script,
    };
  }

  /**
   * Check TTS availability
   */
  @Get("tts/status")
  @ApiOperation({ summary: "Check TTS service availability" })
  async getTTSStatus() {
    return {
      available: this.ttsService.isAvailable(),
      provider: this.ttsService.getProvider(),
    };
  }

  // ==================== Sediment ====================

  /**
   * Sediment research output to AI Insights
   */
  @Post("projects/:projectId/sediment")
  @ApiOperation({ summary: "沉淀研究成果到 AI 洞察" })
  @ApiResponse({ status: 201, description: "沉淀成功" })
  async sedimentToInsights(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: SedimentToInsightsDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    const authHeader = req.headers?.authorization ?? "";
    const token = authHeader.replace("Bearer ", "");
    return this.studioService.sedimentToInsights(userId, projectId, dto, token);
  }
}
