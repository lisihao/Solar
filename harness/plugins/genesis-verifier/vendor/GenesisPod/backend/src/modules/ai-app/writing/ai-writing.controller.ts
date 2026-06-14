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
  Request,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { Public } from "../../../common/decorators/public.decorator";
import { WritingCoordinatorService } from "./writing-coordinator.service";
import {
  CreateProjectDto,
  UpdateProjectDto,
  CreateCharacterDto,
  UpdateCharacterDto,
  CreateVolumeDto,
  CreateChapterDto,
  UpdateChapterDto,
  StartWritingDto,
} from "./dto";
import type {
  ParseImportDto,
  ConfirmImportDto,
} from "./dto/chapter-import.dto";
import { getAllStylePresets, recommendStyleByGenre } from "./constants";
import type { RequestWithUser } from "../../../common/types/express-request.types";

@ApiTags("AI Writing")
@Controller("ai-writing")
@UseGuards(JwtAuthGuard)
export class AiWritingController {
  private readonly logger = new Logger(AiWritingController.name);

  constructor(private readonly coordinator: WritingCoordinatorService) {}

  // ==================== Writing Style Presets ====================

  /**
   * 获取所有写作风格预设（公开接口）
   */
  @Public()
  @Get("style-presets")
  getStylePresets() {
    return {
      presets: getAllStylePresets(),
    };
  }

  /**
   * 根据类型推荐写作风格
   */
  @Public()
  @Get("style-presets/recommend")
  getRecommendedStyles(@Query("genre") genre: string) {
    const recommendedIds = recommendStyleByGenre(genre || "");
    const allPresets = getAllStylePresets();
    const recommended = allPresets.filter((p) => recommendedIds.includes(p.id));
    return {
      genre,
      recommended,
      all: allPresets,
    };
  }

  // ==================== Project CRUD ====================

  @Post("projects")
  async createProject(
    @Request() req: RequestWithUser,
    @Body() dto: CreateProjectDto,
  ) {
    this.logger.log(`Creating writing project for user ${req.user.id}`);
    return this.coordinator.createProject(req.user.id, dto);
  }

  @Get("projects")
  async getProjects(
    @Request() req: RequestWithUser,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.coordinator.getProjects(req.user.id, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get("projects/:id")
  async getProject(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.coordinator.getProject(id, req.user.id);
  }

  @Patch("projects/:id")
  async updateProject(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.coordinator.updateProject(id, req.user.id, dto);
  }

  @Delete("projects/:id")
  async deleteProject(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    return this.coordinator.deleteProject(id, req.user.id);
  }

  // ==================== Story Bible ====================

  @Get("projects/:projectId/bible")
  async getStoryBible(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    return this.coordinator.getStoryBible(projectId, req.user.id);
  }

  @Patch("projects/:projectId/bible")
  async updateStoryBible(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body()
    dto: {
      premise?: string;
      theme?: string;
      tone?: string;
      worldType?: string;
    },
  ) {
    return this.coordinator.updateStoryBible(projectId, req.user.id, dto);
  }

  // ==================== Characters ====================

  @Post("projects/:projectId/characters")
  async createCharacter(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateCharacterDto,
  ) {
    return this.coordinator.createCharacter(projectId, req.user.id, dto);
  }

  @Get("projects/:projectId/characters")
  async getCharacters(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    return this.coordinator.getCharacters(projectId, req.user.id);
  }

  @Get("projects/:projectId/characters/:id")
  async getCharacter(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    return this.coordinator.getCharacter(id, projectId, req.user.id);
  }

  @Patch("projects/:projectId/characters/:id")
  async updateCharacter(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
    @Body() dto: UpdateCharacterDto,
  ) {
    return this.coordinator.updateCharacter(id, projectId, req.user.id, dto);
  }

  @Delete("projects/:projectId/characters/:id")
  async deleteCharacter(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    return this.coordinator.deleteCharacter(id, projectId, req.user.id);
  }

  // ==================== Character Relationships ====================

  @Get("projects/:projectId/relationships/graph")
  async getRelationshipGraph(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    return this.coordinator.getRelationshipGraph(projectId, req.user.id);
  }

  @Post("projects/:projectId/characters/:characterId/relationships")
  async addRelationship(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("characterId") characterId: string,
    @Body()
    dto: {
      targetCharacterId: string;
      relationshipType: string;
      description?: string;
    },
  ) {
    return this.coordinator.addRelationship(
      characterId,
      projectId,
      req.user.id,
      dto,
    );
  }

  @Delete("projects/:projectId/relationships/:relationshipId")
  async deleteRelationship(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("relationshipId") relationshipId: string,
  ) {
    return this.coordinator.deleteRelationship(
      relationshipId,
      projectId,
      req.user.id,
    );
  }

  // ==================== Volumes ====================

  @Post("projects/:projectId/volumes")
  async createVolume(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: CreateVolumeDto,
  ) {
    return this.coordinator.createVolume(projectId, req.user.id, dto);
  }

  @Get("projects/:projectId/volumes")
  async getVolumes(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    return this.coordinator.getVolumes(projectId, req.user.id);
  }

  // ==================== Chapters ====================

  @Post("volumes/:volumeId/chapters")
  async createChapter(
    @Request() req: RequestWithUser,
    @Param("volumeId") volumeId: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.coordinator.createChapter(volumeId, req.user.id, dto);
  }

  @Get("volumes/:volumeId/chapters")
  async getChapters(
    @Request() req: RequestWithUser,
    @Param("volumeId") volumeId: string,
  ) {
    return this.coordinator.getChapters(volumeId, req.user.id);
  }

  @Get("chapters/:id")
  async getChapter(@Request() req: RequestWithUser, @Param("id") id: string) {
    return this.coordinator.getChapter(id, req.user.id);
  }

  @Patch("chapters/:id")
  async updateChapter(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateChapterDto,
  ) {
    return this.coordinator.updateChapter(id, req.user.id, dto);
  }

  // ==================== Writing Actions ====================

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("chapters/:id/write")
  async startWriting(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: StartWritingDto,
  ) {
    this.logger.log(`Starting writing for chapter ${id}`);
    return this.coordinator.startWriting(id, req.user.id, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("volumes/:volumeId/write-parallel")
  async startParallelWriting(
    @Request() req: RequestWithUser,
    @Param("volumeId") volumeId: string,
    @Body() dto: { maxParallel?: number },
  ) {
    this.logger.log(`Starting parallel writing for volume ${volumeId}`);
    return this.coordinator.startParallelWriting(volumeId, req.user.id, dto);
  }

  // ==================== Consistency ====================

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("chapters/:id/check-consistency")
  async checkConsistency(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
  ) {
    return this.coordinator.checkConsistency(id, req.user.id);
  }

  @Get("projects/:projectId/consistency-report")
  async getConsistencyReport(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    return this.coordinator.getConsistencyReport(projectId, req.user.id);
  }

  // ==================== AI Writing Missions ====================

  /**
   * 启动 AI 写作任务
   * 用户只需提供描述，AI 自动完成规划和写作
   */
  @Post("projects/:projectId/missions")
  async startMission(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body()
    dto: {
      /** 写作指令/描述（必填） */
      prompt: string;
      /** 任务类型：outline(大纲) | chapter(章节) | full_story(完整故事) | edit(编辑调整) | consistency_check(一致性检查) */
      missionType?:
        | "outline"
        | "chapter"
        | "full_story"
        | "edit"
        | "consistency_check";
      /** 目标字数 */
      targetWordCount?: number;
      /** 额外指令 */
      additionalInstructions?: string;
      /** 目标 Agent（@mention 指定） */
      targetAgent?: string;
      /** 目标章节号（编辑特定章节时使用） */
      chapterNumber?: number;
      /** 多轮对话历史 */
      conversationHistory?: Array<{
        role: "user" | "assistant";
        content: string;
        timestamp?: string;
      }>;
    },
  ) {
    this.logger.log(
      `Starting AI writing mission for project ${projectId}: ${dto.missionType ?? "full_story"}`,
    );
    return this.coordinator.startMission(projectId, req.user.id, dto);
  }

  /**
   * 获取任务状态
   */
  @Get("missions/:missionId")
  async getMissionStatus(
    @Request() req: RequestWithUser,
    @Param("missionId") missionId: string,
  ) {
    return this.coordinator.getMissionStatus(missionId, req.user.id);
  }

  /**
   * 取消任务
   */
  @Post("missions/:missionId/cancel")
  async cancelMission(
    @Request() req: RequestWithUser,
    @Param("missionId") missionId: string,
  ) {
    return this.coordinator.cancelMission(missionId, req.user.id);
  }

  /**
   * 强制清理项目的卡住任务
   * 当任务状态不一致（显示有任务在运行但实际已卡死）时使用
   */
  @Post("projects/:projectId/force-cleanup")
  async forceCleanupStuckMissions(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    return this.coordinator.forceCleanupStuckMissions(projectId, req.user.id);
  }

  /**
   * 获取项目的所有任务
   */
  @Get("projects/:projectId/missions")
  async getProjectMissions(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Query("status") status?: string,
  ) {
    return this.coordinator.getProjectMissions(projectId, req.user.id, status);
  }

  /**
   * 获取任务日志（交互区消息）
   * @param limit - 返回条数限制
   * @param offset - 跳过前 N 条（用于分页加载历史）
   */
  @Get("missions/:missionId/logs")
  async getMissionLogs(
    @Request() req: RequestWithUser,
    @Param("missionId") missionId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.coordinator.getMissionLogs(
      missionId,
      req.user.id,
      limit ? parseInt(limit, 10) : undefined,
      offset ? parseInt(offset, 10) : undefined,
    );
  }

  // ==================== Public API (无需登录) ====================

  /**
   * 公开阅读接口 - 获取项目内容（无需登录）
   * 只返回 visibility 为 PUBLIC 的项目
   */
  @Public()
  @Get("public/:projectId")
  async getPublicProject(@Param("projectId") projectId: string) {
    this.logger.log(`Public access to project ${projectId}`);

    const project = await this.coordinator.getPublicProject(projectId);

    if (!project) {
      throw new NotFoundException("Project not found or not public");
    }

    return project;
  }

  // ==================== Admin: Reset Chapter Content ====================

  /**
   * 重置指定章节的内容（用于修复数据损坏）
   * 将章节内容清空，使其变为"待写"状态，续写时会重新生成
   */
  @Post("projects/:projectId/reset-chapters")
  async resetChapterContent(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body()
    dto: {
      /** 要重置的章节号列表 */
      chapterNumbers: number[];
    },
  ) {
    this.logger.log(
      `Resetting chapters ${dto.chapterNumbers.join(", ")} for project ${projectId}`,
    );

    const result = await this.coordinator.resetChaptersByNumbers(
      projectId,
      req.user.id,
      dto.chapterNumbers,
    );

    this.logger.log(`Reset ${result.count} chapters`);

    return {
      success: true,
      resetCount: result.count,
      chapterNumbers: dto.chapterNumbers,
      message: `已重置 ${result.count} 个章节，使用"继续创作"可重新生成内容`,
    };
  }

  /**
   * 重新提取并更新项目所有章节的标题
   * 用于修复已有章节缺失标题的情况
   */
  @Post("projects/:projectId/fix-titles")
  async fixChapterTitles(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    this.logger.log(`Re-extracting chapter titles for project ${projectId}`);

    const result = await this.coordinator.reExtractChapterTitles(
      projectId,
      req.user.id,
    );

    return {
      success: true,
      updated: result.updated,
      chapters: result.chapters,
      message: `已更新 ${result.updated} 个章节的标题`,
    };
  }

  // ==================== Chapter Revision (Version History) ====================

  /**
   * 获取章节修订历史
   */
  @Get("chapters/:chapterId/revisions")
  async getChapterRevisions(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
  ) {
    return this.coordinator.getChapterRevisions(chapterId, req.user.id);
  }

  /**
   * 更新章节内容（人工编辑，自动创建版本）
   */
  @Patch("chapters/:chapterId/content")
  async updateChapterContent(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
    @Body() dto: { content: string; changeSummary?: string },
  ) {
    return this.coordinator.updateChapterContent(chapterId, req.user.id, dto);
  }

  /**
   * AI 辅助编辑章节
   */
  @Post("chapters/:chapterId/ai-edit")
  async aiEditChapter(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
    @Body()
    dto: {
      operation: "rewrite" | "polish" | "expand" | "condense" | "style_fix";
      selection?: {
        startOffset: number;
        endOffset: number;
        originalText: string;
      };
      userFeedback: string;
      polishLevel?: "light" | "moderate" | "heavy";
      targetStyle?: {
        tone?: string;
        vocabulary?: string;
        sentenceLength?: string;
      };
    },
  ) {
    return this.coordinator.aiEditChapter(chapterId, req.user.id, dto);
  }

  /**
   * 比较两个版本
   */
  @Get("chapters/:chapterId/revisions/diff")
  async compareRevisions(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
    @Query("v1") revisionId1: string,
    @Query("v2") revisionId2: string,
  ) {
    return this.coordinator.compareRevisions(
      chapterId,
      revisionId1,
      revisionId2,
      req.user.id,
    );
  }

  /**
   * 回退到指定版本
   */
  @Post("chapters/:chapterId/revisions/:revisionId/rollback")
  async rollbackRevision(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
    @Param("revisionId") revisionId: string,
    @Body() dto: { reason?: string },
  ) {
    return this.coordinator.rollbackRevision(
      chapterId,
      revisionId,
      req.user.id,
      dto.reason,
    );
  }

  // ==================== Chapter Annotations ====================

  /**
   * 获取章节批注
   */
  @Get("chapters/:chapterId/annotations")
  async getChapterAnnotations(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
    @Query("status") status?: "OPEN" | "RESOLVED" | "DISMISSED",
  ) {
    return this.coordinator.getChapterAnnotations(
      chapterId,
      req.user.id,
      status,
    );
  }

  /**
   * 创建批注
   */
  @Post("chapters/:chapterId/annotations")
  async createAnnotation(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
    @Body()
    dto: {
      startOffset: number;
      endOffset: number;
      content: string;
      type?: "COMMENT" | "SUGGESTION" | "ISSUE" | "REFERENCE";
      selectedText?: string;
    },
  ) {
    return this.coordinator.createAnnotation(chapterId, req.user.id, dto);
  }

  /**
   * 更新批注
   */
  @Patch("chapters/:chapterId/annotations/:annotationId")
  async updateAnnotation(
    @Request() req: RequestWithUser,
    @Param("annotationId") annotationId: string,
    @Body()
    dto: { content?: string; status?: "OPEN" | "RESOLVED" | "DISMISSED" },
  ) {
    return this.coordinator.updateAnnotation(annotationId, req.user.id, dto);
  }

  /**
   * 删除批注
   */
  @Delete("chapters/:chapterId/annotations/:annotationId")
  async deleteAnnotation(
    @Request() req: RequestWithUser,
    @Param("annotationId") annotationId: string,
  ) {
    await this.coordinator.deleteAnnotation(annotationId, req.user.id);
    return { message: "Annotation deleted successfully" };
  }

  /**
   * 批量解决批注
   */
  @Post("chapters/:chapterId/annotations/resolve")
  async resolveAnnotations(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
    @Body() dto: { annotationIds: string[] },
  ) {
    return this.coordinator.resolveAnnotations(
      chapterId,
      req.user.id,
      dto.annotationIds,
    );
  }

  // ==================== Chapter Import ====================

  /**
   * 解析导入内容
   */
  @Post("projects/:projectId/import/parse")
  async parseImport(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Body() dto: ParseImportDto,
  ) {
    return this.coordinator.parseImport(projectId, req.user.id, dto);
  }

  /**
   * 确认并执行导入
   */
  @Post("projects/:projectId/import/:importId/confirm")
  async confirmImport(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("importId") importId: string,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.coordinator.confirmImport(
      projectId,
      importId,
      req.user.id,
      dto,
    );
  }

  /**
   * 获取导入状态
   */
  @Get("projects/:projectId/import/:importId")
  async getImportStatus(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("importId") importId: string,
  ) {
    return this.coordinator.getImportStatus(projectId, importId, req.user.id);
  }

  /**
   * 获取导入历史
   */
  @Get("projects/:projectId/import/history")
  async getImportHistory(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    return this.coordinator.getImportHistory(projectId, req.user.id);
  }

  /**
   * 取消导入
   */
  @Delete("projects/:projectId/import/:importId")
  async cancelImport(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Param("importId") importId: string,
  ) {
    return this.coordinator.cancelImport(projectId, importId, req.user.id);
  }

  // ==================== DOME/SCORE Enhanced Features ====================

  /**
   * 获取故事完成度分析
   * 分析故事是否已经有自然结局
   */
  @Get("projects/:projectId/completion-analysis")
  async getCompletionAnalysis(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const analysis = await this.coordinator.getCompletionAnalysis(
      projectId,
      req.user.id,
    );

    return {
      projectId,
      analysis,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * 获取时间线冲突分析
   * 检测章节内容中的时间线矛盾
   */
  @Get("projects/:projectId/timeline-conflicts")
  async getTimelineConflicts(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const result = await this.coordinator.getTimelineConflicts(
      projectId,
      req.user.id,
    );

    // Transform conflicts to frontend format
    const conflicts = result.conflicts.map((c) => ({
      id: `${c.chapter1}-${c.chapter2}-${c.entity}`,
      type: c.type,
      severity: this.mapConflictSeverity(c.severity),
      description: c.description,
      sourceChapter: c.chapter1,
      targetChapter: c.chapter2,
      subject: c.entity,
      conflictingStatements: [c.expected, c.found],
      suggestedResolution: c.suggestion,
    }));

    return {
      projectId,
      conflicts,
      totalConflicts: conflicts.length,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * 获取章节的时间线冲突
   * 注意：需要提供项目ID和章节内容来分析
   */
  @Get("chapters/:chapterId/timeline-conflicts")
  async getChapterTimelineConflicts(
    @Request() req: RequestWithUser,
    @Param("chapterId") chapterId: string,
  ) {
    const result = await this.coordinator.getChapterTimelineConflicts(
      chapterId,
      req.user.id,
    );

    if (!result.conflicts || result.conflicts.length === 0) {
      return {
        chapterId,
        conflicts: [],
        totalConflicts: 0,
        analyzedAt: new Date().toISOString(),
      };
    }

    // Transform conflicts to frontend format
    const conflicts = result.conflicts.map((c) => ({
      id: `${c.chapter1}-${c.chapter2}-${c.entity}`,
      type: c.type,
      severity: this.mapConflictSeverity(c.severity),
      description: c.description,
      sourceChapter: c.chapter1,
      targetChapter: c.chapter2,
      subject: c.entity,
      conflictingStatements: [c.expected, c.found],
      suggestedResolution: c.suggestion,
    }));

    return {
      chapterId,
      conflicts,
      totalConflicts: conflicts.length,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Map internal severity to frontend severity
   */
  private mapConflictSeverity(severity: string): "HIGH" | "MEDIUM" | "LOW" {
    switch (severity) {
      case "CRITICAL":
        return "HIGH";
      case "WARNING":
        return "MEDIUM";
      case "INFO":
      default:
        return "LOW";
    }
  }

  /**
   * 获取层次摘要上下文
   * 用于展示故事的多层次摘要
   */
  @Get("projects/:projectId/hierarchical-summaries")
  async getHierarchicalSummaries(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Query("currentChapter") currentChapter?: string,
    @Query("targetTokens") targetTokens?: string,
  ) {
    const result = await this.coordinator.getHierarchicalSummaries(
      projectId,
      req.user.id,
      {
        currentChapter: currentChapter
          ? parseInt(currentChapter, 10)
          : undefined,
        targetTokens: targetTokens ? parseInt(targetTokens, 10) : undefined,
      },
    );

    return {
      projectId,
      context: result.context,
      formattedContext: result.formattedContext,
    };
  }

  /**
   * 批量生成章节摘要
   */
  @Post("projects/:projectId/generate-summaries")
  async generateSummaries(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const updatedCount = await this.coordinator.generateSummaries(
      projectId,
      req.user.id,
    );

    return {
      projectId,
      updatedCount,
      message: `成功生成 ${updatedCount} 个章节的摘要`,
    };
  }

  /**
   * 获取共享便签板内容
   * 展示 Agent 间的通信记录
   */
  @Get("projects/:projectId/scratchpad")
  async getScratchpad(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
    @Query("type") type?: string,
    @Query("limit") limit?: string,
  ) {
    const result = await this.coordinator.getScratchpad(
      projectId,
      req.user.id,
      {
        type,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
    );

    return {
      projectId,
      entries: result.entries,
      totalEntries: result.totalEntries,
    };
  }

  /**
   * 获取项目分析仪表板数据（轻量级，仅数据库查询）
   * 完成度分析和冲突检测通过独立端点按需触发
   */
  @Get("projects/:projectId/analysis-dashboard")
  async getAnalysisDashboard(
    @Request() req: RequestWithUser,
    @Param("projectId") projectId: string,
  ) {
    const dashboard = await this.coordinator.getAnalysisDashboard(
      projectId,
      req.user.id,
    );

    return {
      projectId,
      projectName: dashboard.project?.name || "Unknown",
      completion: null,
      conflicts: {
        total: 0,
        highSeverity: 0,
        mediumSeverity: 0,
        lowSeverity: 0,
        recentConflicts: [],
      },
      agentActivity: dashboard.agentActivity,
      analyzedAt: dashboard.analyzedAt,
    };
  }
}
