import { Injectable, Logger } from "@nestjs/common";
import { BillingContext } from "../../platform/facade";
import { ProjectService } from "./services/writing/project.service";
import { StoryBibleService } from "./services/bible/story-bible.service";
import { CharacterService } from "./services/bible/character.service";
import { ChapterWritingService } from "./services/writing/chapter-writing.service";
import { ChapterRevisionService } from "./services/writing/chapter-revision.service";
import { ChapterAnnotationService } from "./services/writing/chapter-annotation.service";
import { ChapterImportService } from "./services/writing/chapter-import.service";
import { ConsistencyEngineService } from "./services/consistency/consistency-engine.service";
import { ParallelOrchestratorService } from "./services/parallel/parallel-orchestrator.service";
import { WritingMissionLifecycleService } from "./services/mission/writing-mission-lifecycle.service";
import { WritingMissionQueryService } from "./services/mission/writing-mission-query.service";
import { WritingTextProcessorService } from "./services/mission/writing-text-processor.service";
import { StoryCompletionDetectorService } from "./services/quality/story-completion-detector.service";
import { TemporalConflictAnalyzerService } from "./services/consistency/temporal-conflict-analyzer.service";
import { HierarchicalSummaryService } from "./services/writing/hierarchical-summary.service";
import {
  SharedScratchpadService,
  type ScratchpadEntryType,
  type ScratchpadEntry,
} from "./services/mission/shared-scratchpad.service";
import type {
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

/**
 * Writing Coordinator Service
 *
 * 协调 Writing 模块的所有服务调用，解决 Controller 直接依赖过多服务的问题。
 * 遵循迪米特法则：Controller 只与 Coordinator 交互，Coordinator 负责协调底层服务。
 */
@Injectable()
export class WritingCoordinatorService {
  private readonly logger = new Logger(WritingCoordinatorService.name);

  constructor(
    // 项目管理
    private readonly projectService: ProjectService,
    // 故事圣经
    private readonly storyBibleService: StoryBibleService,
    private readonly characterService: CharacterService,
    // 章节操作
    private readonly chapterWritingService: ChapterWritingService,
    private readonly chapterRevisionService: ChapterRevisionService,
    private readonly chapterAnnotationService: ChapterAnnotationService,
    private readonly chapterImportService: ChapterImportService,
    // 并行写作
    private readonly parallelOrchestrator: ParallelOrchestratorService,
    // 一致性
    private readonly consistencyEngine: ConsistencyEngineService,
    // 任务协调（新拆分的服务）
    private readonly missionLifecycle: WritingMissionLifecycleService,
    private readonly missionQuery: WritingMissionQueryService,
    private readonly textProcessor: WritingTextProcessorService,
    // 质量分析
    private readonly storyCompletionDetector: StoryCompletionDetectorService,
    private readonly temporalConflictAnalyzer: TemporalConflictAnalyzerService,
    // 上下文增强
    private readonly hierarchicalSummaryService: HierarchicalSummaryService,
    private readonly sharedScratchpadService: SharedScratchpadService,
  ) {}

  // ==================== Project Management ====================

  async createProject(userId: string, dto: CreateProjectDto) {
    return this.projectService.create(userId, dto);
  }

  async getProjects(
    userId: string,
    options: {
      status?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    return this.projectService.findAll(userId, options);
  }

  async getProject(projectId: string, userId: string) {
    return this.projectService.findOne(projectId, userId);
  }

  async getPublicProject(projectId: string) {
    return this.projectService.findPublic(projectId);
  }

  async updateProject(
    projectId: string,
    userId: string,
    dto: UpdateProjectDto,
  ) {
    return this.projectService.update(projectId, userId, dto);
  }

  async deleteProject(projectId: string, userId: string) {
    return this.projectService.delete(projectId, userId);
  }

  async resetChaptersByNumbers(
    projectId: string,
    userId: string,
    chapterNumbers: number[],
  ) {
    // Verify ownership
    await this.projectService.findOne(projectId, userId);
    return this.projectService.resetChaptersByNumbers(
      projectId,
      chapterNumbers,
    );
  }

  // ==================== Story Bible ====================

  async getStoryBible(projectId: string, userId: string) {
    return this.storyBibleService.getByProject(projectId, userId);
  }

  async updateStoryBible(
    projectId: string,
    userId: string,
    dto: {
      premise?: string;
      theme?: string;
      tone?: string;
      worldType?: string;
    },
  ) {
    return this.storyBibleService.update(projectId, userId, dto);
  }

  // ==================== Characters ====================

  async createCharacter(
    projectId: string,
    userId: string,
    dto: CreateCharacterDto,
  ) {
    return this.characterService.create(projectId, userId, dto);
  }

  async getCharacters(projectId: string, userId: string) {
    return this.characterService.findAll(projectId, userId);
  }

  async getCharacter(characterId: string, projectId: string, userId: string) {
    return this.characterService.findOne(characterId, projectId, userId);
  }

  async updateCharacter(
    characterId: string,
    projectId: string,
    userId: string,
    dto: UpdateCharacterDto,
  ) {
    return this.characterService.update(characterId, projectId, userId, dto);
  }

  async deleteCharacter(
    characterId: string,
    projectId: string,
    userId: string,
  ) {
    return this.characterService.delete(characterId, projectId, userId);
  }

  async getRelationshipGraph(projectId: string, userId: string) {
    return this.characterService.getRelationshipGraph(projectId, userId);
  }

  async addRelationship(
    characterId: string,
    projectId: string,
    userId: string,
    dto: {
      targetCharacterId: string;
      relationshipType: string;
      description?: string;
    },
  ) {
    return this.characterService.addRelationship(
      characterId,
      projectId,
      userId,
      dto,
    );
  }

  async deleteRelationship(
    relationshipId: string,
    projectId: string,
    userId: string,
  ) {
    return this.characterService.deleteRelationship(
      relationshipId,
      projectId,
      userId,
    );
  }

  // ==================== Volumes ====================

  async createVolume(projectId: string, userId: string, dto: CreateVolumeDto) {
    return this.projectService.createVolume(projectId, userId, dto);
  }

  async getVolumes(projectId: string, userId: string) {
    return this.projectService.getVolumes(projectId, userId);
  }

  // ==================== Chapters ====================

  async createChapter(volumeId: string, userId: string, dto: CreateChapterDto) {
    return this.chapterWritingService.createChapter(volumeId, userId, dto);
  }

  async getChapters(volumeId: string, userId: string) {
    return this.chapterWritingService.getChapters(volumeId, userId);
  }

  async getChapter(chapterId: string, userId: string) {
    return this.chapterWritingService.getChapter(chapterId, userId);
  }

  async updateChapter(
    chapterId: string,
    userId: string,
    dto: UpdateChapterDto,
  ) {
    return this.chapterWritingService.updateChapter(chapterId, userId, dto);
  }

  // ==================== Writing Actions ====================

  async startWriting(chapterId: string, userId: string, dto: StartWritingDto) {
    return this.chapterWritingService.startWriting(chapterId, userId, dto);
  }

  async startParallelWriting(
    volumeId: string,
    userId: string,
    dto: { maxParallel?: number },
  ) {
    return this.parallelOrchestrator.orchestrateParallelWriting(
      volumeId,
      userId,
      dto,
    );
  }

  // ==================== Consistency ====================

  async checkConsistency(chapterId: string, userId: string) {
    return this.consistencyEngine.validateChapter(chapterId, userId);
  }

  async getConsistencyReport(projectId: string, userId: string) {
    return this.consistencyEngine.getProjectReport(projectId, userId);
  }

  // ==================== Writing Missions ====================

  async startMission(
    projectId: string,
    userId: string,
    dto: {
      prompt: string;
      missionType?:
        | "outline"
        | "chapter"
        | "full_story"
        | "edit"
        | "consistency_check";
      targetWordCount?: number;
      additionalInstructions?: string;
      targetAgent?: string;
      chapterNumber?: number;
      conversationHistory?: Array<{
        role: "user" | "assistant";
        content: string;
        timestamp?: string;
      }>;
    },
  ) {
    // If chapter number is specified, find the chapter ID
    let chapterId: string | undefined;
    if (dto.chapterNumber) {
      const chapter = await this.projectService.findChapterByNumber(
        projectId,
        dto.chapterNumber,
      );
      if (chapter) {
        chapterId = chapter.id;
      }
    }

    const missionInfo = await this.missionLifecycle.startMissionAsync(
      {
        projectId,
        missionType: dto.missionType ?? "full_story",
        userPrompt: dto.prompt,
        targetWordCount: dto.targetWordCount,
        additionalInstructions: dto.additionalInstructions,
        chapterId,
        targetAgent: dto.targetAgent,
        conversationHistory: dto.conversationHistory,
      },
      userId,
    );

    return {
      success: true,
      message: "AI writing mission started",
      projectId,
      missionId: missionInfo.missionId,
      missionType: dto.missionType ?? "full_story",
    };
  }

  async getMissionStatus(missionId: string, userId: string) {
    return this.missionQuery.getMissionStatus(missionId, userId);
  }

  async cancelMission(missionId: string, userId: string) {
    return this.missionLifecycle.cancelMission(missionId, userId);
  }

  async forceCleanupStuckMissions(projectId: string, userId: string) {
    // Verify project ownership
    await this.projectService.findOne(projectId, userId);
    return this.missionLifecycle.forceCleanupStuckMissions(projectId, userId);
  }

  async getProjectMissions(projectId: string, userId: string, status?: string) {
    // Verify project ownership
    await this.projectService.findOne(projectId, userId);
    return this.missionQuery.getProjectMissions(projectId, status);
  }

  async getMissionLogs(
    missionId: string,
    userId: string,
    limit?: number,
    offset?: number,
  ) {
    return this.missionQuery.getMissionLogs(missionId, userId, limit, offset);
  }

  async reExtractChapterTitles(projectId: string, userId: string) {
    return this.missionLifecycle.reExtractChapterTitles(
      projectId,
      userId,
      this.textProcessor,
    );
  }

  // ==================== Chapter Revision ====================

  async getChapterRevisions(chapterId: string, userId: string) {
    return this.chapterRevisionService.getRevisions(chapterId, userId);
  }

  async updateChapterContent(
    chapterId: string,
    userId: string,
    dto: { content: string; changeSummary?: string },
  ) {
    return this.chapterRevisionService.updateContent(chapterId, userId, dto);
  }

  async aiEditChapter(
    chapterId: string,
    userId: string,
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
    return BillingContext.run(
      {
        userId,
        moduleType: "ai-writing",
        operationType: "ai-edit-chapter",
        referenceId: chapterId,
      },
      () => this.chapterRevisionService.aiEdit(chapterId, userId, dto),
    );
  }

  async compareRevisions(
    chapterId: string,
    revisionId1: string,
    revisionId2: string,
    userId: string,
  ) {
    return this.chapterRevisionService.compareRevisions(
      chapterId,
      revisionId1,
      revisionId2,
      userId,
    );
  }

  async rollbackRevision(
    chapterId: string,
    revisionId: string,
    userId: string,
    reason?: string,
  ) {
    return this.chapterRevisionService.rollback(
      chapterId,
      revisionId,
      userId,
      reason,
    );
  }

  // ==================== Chapter Annotations ====================

  async getChapterAnnotations(
    chapterId: string,
    userId: string,
    status?: "OPEN" | "RESOLVED" | "DISMISSED",
  ) {
    return this.chapterAnnotationService.getAnnotations(
      chapterId,
      userId,
      status,
    );
  }

  async createAnnotation(
    chapterId: string,
    userId: string,
    dto: {
      startOffset: number;
      endOffset: number;
      content: string;
      type?: "COMMENT" | "SUGGESTION" | "ISSUE" | "REFERENCE";
      selectedText?: string;
    },
  ) {
    return this.chapterAnnotationService.createAnnotation(
      chapterId,
      userId,
      dto,
    );
  }

  async updateAnnotation(
    annotationId: string,
    userId: string,
    dto: { content?: string; status?: "OPEN" | "RESOLVED" | "DISMISSED" },
  ) {
    return this.chapterAnnotationService.updateAnnotation(
      annotationId,
      userId,
      dto,
    );
  }

  async deleteAnnotation(annotationId: string, userId: string) {
    return this.chapterAnnotationService.deleteAnnotation(annotationId, userId);
  }

  async resolveAnnotations(
    chapterId: string,
    userId: string,
    annotationIds: string[],
  ) {
    return this.chapterAnnotationService.resolveAnnotations(
      chapterId,
      userId,
      annotationIds,
    );
  }

  // ==================== Chapter Import ====================

  async parseImport(projectId: string, userId: string, dto: ParseImportDto) {
    return this.chapterImportService.parseImport(projectId, userId, dto);
  }

  async confirmImport(
    projectId: string,
    importId: string,
    userId: string,
    dto: ConfirmImportDto,
  ) {
    return this.chapterImportService.confirmImport(
      projectId,
      importId,
      userId,
      dto,
    );
  }

  async getImportStatus(projectId: string, importId: string, userId: string) {
    return this.chapterImportService.getImportStatus(
      projectId,
      importId,
      userId,
    );
  }

  async getImportHistory(projectId: string, userId: string) {
    return this.chapterImportService.getImportHistory(projectId, userId);
  }

  async cancelImport(projectId: string, importId: string, userId: string) {
    return this.chapterImportService.cancelImport(projectId, importId, userId);
  }

  // ==================== Quality Analysis ====================

  async getCompletionAnalysis(projectId: string, userId: string) {
    // Verify project ownership
    await this.projectService.findOne(projectId, userId);
    return BillingContext.run(
      {
        userId,
        moduleType: "ai-writing",
        operationType: "completion-analysis",
        referenceId: projectId,
      },
      () => this.storyCompletionDetector.analyzeCompletion(projectId),
    );
  }

  async getTimelineConflicts(projectId: string, userId: string) {
    // Verify project ownership
    await this.projectService.findOne(projectId, userId);
    return BillingContext.run(
      {
        userId,
        moduleType: "ai-writing",
        operationType: "timeline-conflicts",
        referenceId: projectId,
      },
      () => this.temporalConflictAnalyzer.analyzeProject(projectId),
    );
  }

  async getChapterTimelineConflicts(chapterId: string, userId: string) {
    // Get chapter info (includes ownership verification)
    const chapter = (await this.chapterWritingService.getChapter(
      chapterId,
      userId,
    )) as {
      id: string;
      content: string | null;
      chapterNumber: number;
      volumeId: string;
      volume: { project: { id: string } };
    };

    if (!chapter.content) {
      return { conflicts: [] };
    }

    const projectId = chapter.volume.project.id;
    return BillingContext.run(
      {
        userId,
        moduleType: "ai-writing",
        operationType: "chapter-timeline-conflicts",
        referenceId: chapterId,
      },
      () =>
        this.temporalConflictAnalyzer.analyzeChapter(
          projectId,
          chapter.chapterNumber,
          chapter.content as string,
        ),
    );
  }

  // ==================== Hierarchical Summaries ====================

  async getHierarchicalSummaries(
    projectId: string,
    userId: string,
    options: {
      currentChapter?: number;
      targetTokens?: number;
    },
  ) {
    // Verify project ownership
    await this.projectService.findOne(projectId, userId);

    const context =
      await this.hierarchicalSummaryService.getHierarchicalContext(projectId, {
        currentChapter: options.currentChapter ?? 999,
        targetTokens: options.targetTokens ?? 4000,
      });

    return {
      context,
      formattedContext:
        this.hierarchicalSummaryService.formatContextForPrompt(context),
    };
  }

  async generateSummaries(projectId: string, userId: string) {
    // Verify project ownership
    await this.projectService.findOne(projectId, userId);
    return BillingContext.run(
      {
        userId,
        moduleType: "ai-writing",
        operationType: "generate-summaries",
        referenceId: projectId,
      },
      () => this.hierarchicalSummaryService.batchUpdateSummaries(projectId),
    );
  }

  // ==================== Shared Scratchpad ====================

  async getScratchpad(
    projectId: string,
    userId: string,
    options: {
      type?: string;
      limit?: number;
    },
  ) {
    // Verify project ownership
    await this.projectService.findOne(projectId, userId);

    try {
      // Find the most recent active mission
      const recentMission = await this.missionQuery.getLatestMission(projectId);

      if (!recentMission) {
        return {
          entries: [],
          totalEntries: 0,
        };
      }

      const entries = await this.sharedScratchpadService.getEntries(
        recentMission.id,
        {
          type: options.type as ScratchpadEntryType | undefined,
          limit: options.limit ?? 50,
        },
      );

      return {
        entries,
        totalEntries: entries.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to get scratchpad: ${errorMessage}`);
      return {
        entries: [],
        totalEntries: 0,
      };
    }
  }

  // ==================== Analysis Dashboard ====================

  /**
   * Get comprehensive analysis dashboard data
   * Combines completion analysis, timeline conflicts, and agent activity
   */
  async getAnalysisDashboard(projectId: string, userId: string) {
    // Dashboard endpoint must be lightweight — no LLM calls.
    // Completion and conflict analysis involve multiple LLM calls that
    // exceed Railway's 30s request timeout. Use the dedicated
    // /completion-analysis and /timeline-conflicts endpoints instead.
    const result: {
      project: { id: string; name: string };
      agentActivity: { recentEntries: ScratchpadEntry[]; totalEntries: number };
      analyzedAt: string;
    } = {
      project: { id: projectId, name: "Unknown" },
      agentActivity: { recentEntries: [], totalEntries: 0 },
      analyzedAt: new Date().toISOString(),
    };

    // 1. Verify project ownership
    try {
      const project = await this.projectService.findOne(projectId, userId);
      result.project = { id: project.id, name: project.name };
    } catch (err) {
      this.logger.error(
        `[AnalysisDashboard] Project lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return result;
    }

    // 2. Get scratchpad entries (DB only, no LLM)
    try {
      const recentMission = await this.missionQuery.getLatestMission(projectId);
      if (recentMission) {
        const entries = await this.sharedScratchpadService.getEntries(
          recentMission.id,
          { limit: 10 },
        );
        result.agentActivity = {
          recentEntries: entries,
          totalEntries: entries.length,
        };
      }
    } catch (err) {
      this.logger.warn(
        `[AnalysisDashboard] Scratchpad failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return result;
  }
}
