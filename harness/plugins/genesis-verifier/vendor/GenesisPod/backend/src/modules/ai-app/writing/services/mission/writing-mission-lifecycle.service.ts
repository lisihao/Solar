/**
 * Writing Mission Lifecycle Service
 *
 * Manages the lifecycle of writing missions:
 * - Creating mission records
 * - State transitions (FSM)
 * - Access control
 * - Cancellation and cleanup
 * - AI Kernel process management
 *
 * Extracted from WritingMissionService (god service).
 * Follows Topic Insights' MissionLifecycleService pattern.
 */

import {
  Injectable,
  Logger,
  Optional,
  ConflictException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  USER_EVENT_NAME,
  MODULE,
  ACTION,
  type UserEventPayload,
} from "@/common/observability/user-event.types";
import { v4 as uuidv4 } from "uuid";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade, TeamFacade } from "@/modules/ai-harness/facade";
import {
  MissionExecutorService,
  MissionContext,
} from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { BillingContext } from "../../../../platform/facade";
import { LruMap } from "@/common/utils/lru-map";

import type {
  WritingMissionInput,
  WritingMissionResult,
} from "./writing-mission.types";
import type { RoleModelAssignment } from "./writing-model-manager.service";
import { MISSION_TYPE_DB_MAP, WRITING_DEFAULTS } from "../config";

// Forward reference to avoid circular dependency
import type { WritingMissionExecutionService } from "./writing-mission-execution.service";

/**
 * AI model configuration
 */
interface ModelConfig {
  modelId: string;
  displayName: string;
  provider: string;
  apiKey?: string;
  apiEndpoint?: string;
  isReasoning: boolean;
}

@Injectable()
export class WritingMissionLifecycleService {
  private readonly logger = new Logger(WritingMissionLifecycleService.name);
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  // Model configuration cache
  private cachedModels: ModelConfig[] | null = null;
  private modelCacheTime = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
    private readonly teamFacade: TeamFacade,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {
    // Writing roles + team config 由 WritingAgentCoordinator 统一注册（它先于本
    // 服务 init、按角色逐个注册）。本服务不再重复注册，因此也无需注入
    // Role/TeamRegistry 与 5 个 writing agent（原 registerWritingRoles /
    // registerWritingTeamConfig 已随之删除）。
  }

  // Injected after construction to break circular dependency
  private executionService: WritingMissionExecutionService | null = null;

  setExecutionService(service: WritingMissionExecutionService): void {
    this.executionService = service;
  }

  // ─── Public API ───

  /**
   * Start a writing mission asynchronously (returns missionId, task runs in background)
   */
  async startMissionAsync(
    input: WritingMissionInput,
    userId: string,
  ): Promise<{ missionId: string }> {
    const missionId = uuidv4();

    return BillingContext.run(
      {
        userId,
        moduleType: "ai-writing",
        operationType: `mission-${input.missionType}`,
        referenceId: missionId,
      },
      async () => {
        this.logger.log(
          `Starting async writing mission ${missionId} for project ${input.projectId}, type: ${input.missionType}, userPrompt: "${input.userPrompt?.slice(0, 100) || "(empty)"}"`,
        );

        // Verify project access
        await this.verifyProjectAccess(input.projectId, userId);

        // Check for concurrent missions
        const runningMission = await this.prisma.writingMission.findFirst({
          where: {
            projectId: input.projectId,
            status: "IN_PROGRESS",
          },
        });

        if (runningMission) {
          this.logger.warn(
            `Project ${input.projectId} already has a running mission ${runningMission.id}, rejecting new mission`,
          );
          throw new ConflictException(
            "当前项目已有正在执行的任务，请等待完成或取消后再试。",
          );
        }

        // Assign models to roles
        const modelAssignments = await this.assignModelsToRoles();
        const activeRoles = modelAssignments.filter((a) => a.isActive);

        if (activeRoles.length === 0) {
          throw new Error(
            "没有可用的 AI 模型。请先在系统设置中配置并启用至少一个 AI 模型。",
          );
        }

        // Create DB record
        await this.createMissionRecord(missionId, input, userId);

        // AI Kernel: spawn process
        if (this.missionExecutor) {
          try {
            const kernelResult = await this.missionExecutor.execute({
              userId,
              agentId: "story-architect",
              teamSessionId: missionId,
              input: {
                projectId: input.projectId,
                missionType: input.missionType,
                targetWordCount: input.targetWordCount,
              },
            });
            this.kernelProcessIds.set(missionId, kernelResult.processId);
            this.logger.log(
              `[Kernel] Process ${kernelResult.processId} spawned for writing mission ${missionId}`,
            );
          } catch (err) {
            this.logger.warn(
              `[Kernel] Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Fire-and-forget: run in background
        if (!this.executionService) {
          throw new Error(
            "WritingMissionExecutionService not wired. Module initialization may have failed.",
          );
        }
        const wrappedRun = () =>
          this.executionService!.runMissionInBackground(
            missionId,
            input,
            userId,
            modelAssignments,
          );
        const missionProcessId = this.kernelProcessIds.get(missionId);
        void (missionProcessId
          ? MissionContext.run(
              { agentProcessId: missionProcessId, userId },
              wrappedRun,
            )
          : wrappedRun());

        return { missionId };
      },
    );
  }

  /**
   * Cancel an in-progress mission
   */
  async cancelMission(missionId: string, userId: string) {
    const mission = await this.prisma.writingMission.findUnique({
      where: { id: missionId },
      include: {
        project: { select: { id: true, ownerId: true, currentWords: true } },
      },
    });

    if (!mission) {
      this.logger.warn(
        `Mission ${missionId} not found, but treating as successful cancellation`,
      );
      try {
        await this.teamFacade.missionOrchestrator?.cancel(missionId);
      } catch {
        // ignore
      }
      return {
        success: true,
        message: "Mission not found but cleanup attempted",
      };
    }

    if (mission.project.ownerId !== userId) {
      throw new Error("Access denied");
    }

    const projectId = mission.project.id;

    // Force update all IN_PROGRESS missions for this project
    const updateResult = await this.prisma.writingMission.updateMany({
      where: {
        projectId,
        status: "IN_PROGRESS",
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        result: {
          success: false,
          error: "Cancelled by user",
        },
      },
    });

    this.logger.log(
      `Force cancelled ${updateResult.count} missions for project ${projectId}`,
    );

    // Update project status
    const newStatus =
      mission.project.currentWords > 0 ? "REVISING" : "PLANNING";
    await this.prisma.writingProject.update({
      where: { id: projectId },
      data: { status: newStatus },
    });

    // Cancel orchestrator
    try {
      await this.teamFacade.missionOrchestrator?.cancel(missionId);
    } catch (err) {
      this.logger.warn(
        `Failed to cancel orchestrator for mission ${missionId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    this.logger.log(`Mission ${missionId} cancelled by user ${userId}`);
    return {
      success: true,
      message: "Mission cancelled",
      cleanedCount: updateResult.count,
    };
  }

  /**
   * Force cleanup stuck (IN_PROGRESS) missions for a project
   */
  async forceCleanupStuckMissions(projectId: string, userId: string) {
    const stuckMissions = await this.prisma.writingMission.findMany({
      where: {
        projectId,
        status: "IN_PROGRESS",
      },
    });

    if (stuckMissions.length === 0) {
      return {
        success: true,
        message: "没有发现卡住的任务",
        cleanedCount: 0,
      };
    }

    const result = await this.prisma.writingMission.updateMany({
      where: {
        projectId,
        status: "IN_PROGRESS",
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        result: {
          success: false,
          error: "Force cleaned - stuck task",
        },
      },
    });

    // Update project status
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      select: { currentWords: true },
    });

    if (project) {
      const newStatus = project.currentWords > 0 ? "REVISING" : "PLANNING";
      await this.prisma.writingProject.update({
        where: { id: projectId },
        data: { status: newStatus },
      });
    }

    // Cancel all orchestrators
    for (const mission of stuckMissions) {
      try {
        await this.teamFacade.missionOrchestrator?.cancel(mission.id);
      } catch {
        // ignore
      }
    }

    this.logger.log(
      `Force cleaned ${result.count} stuck missions for project ${projectId} by user ${userId}`,
    );

    return {
      success: true,
      message: `已清理 ${result.count} 个卡住的任务`,
      cleanedCount: result.count,
      missionIds: stuckMissions.map((m) => m.id),
    };
  }

  /**
   * Re-extract and update chapter titles for a project
   */
  async reExtractChapterTitles(
    projectId: string,
    userId: string,
    textProcessor: {
      extractChapterTitle: (content: string, num: number) => string;
    },
  ): Promise<{
    updated: number;
    chapters: Array<{
      id: string;
      number: number;
      oldTitle: string;
      newTitle: string;
    }>;
  }> {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    if (!project || project.ownerId !== userId) {
      throw new Error("Access denied");
    }

    const chapters = await this.prisma.writingChapter.findMany({
      where: { volume: { projectId } },
      select: {
        id: true,
        chapterNumber: true,
        title: true,
        content: true,
        outline: true,
      },
      orderBy: { chapterNumber: "asc" },
    });

    const results: Array<{
      id: string;
      number: number;
      oldTitle: string;
      newTitle: string;
    }> = [];

    for (const chapter of chapters) {
      const updateData: { title?: string; outline?: string } = {};
      let needsUpdate = false;

      // Process title
      const isPlaceholder =
        !chapter.title ||
        chapter.title.match(/^第[一二三四五六七八九十百千\d]+[章回]$/) ||
        chapter.title.match(/^章节\s*\d+$/) ||
        chapter.title === "待续写" ||
        chapter.title === "待创作";

      if (isPlaceholder && chapter.content) {
        const newTitle = textProcessor.extractChapterTitle(
          chapter.content,
          chapter.chapterNumber,
        );

        let cleanNewTitle = newTitle
          .replace(/^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i, "")
          .replace(/^#{1,6}\s*/, "")
          .trim();

        if (
          !cleanNewTitle ||
          cleanNewTitle.match(/^第[一二三四五六七八九十百千\d]+[章回]$/) ||
          cleanNewTitle.match(/^章节\s*\d+$/)
        ) {
          cleanNewTitle = "";
        }

        updateData.title = cleanNewTitle;
        needsUpdate = true;
      }

      // Process outline
      if (chapter.outline) {
        const outlineNeedsCleaning =
          chapter.outline.match(/^第[一二三四五六七八九十百千\d]+[章回]/) ||
          chapter.outline.match(/^#{1,6}\s*第/) ||
          chapter.outline === "待创作";

        if (outlineNeedsCleaning) {
          if (chapter.outline === "待创作") {
            updateData.outline = "";
            needsUpdate = true;
          } else {
            let cleanOutline = chapter.outline
              .replace(/^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i, "")
              .replace(/^#{1,6}\s*/, "")
              .trim();
            cleanOutline = cleanOutline
              .replace(/^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i, "")
              .trim();
            updateData.outline = cleanOutline;
            needsUpdate = true;
          }
        }
      }

      if (needsUpdate) {
        await this.prisma.writingChapter.update({
          where: { id: chapter.id },
          data: updateData,
        });

        results.push({
          id: chapter.id,
          number: chapter.chapterNumber,
          oldTitle: chapter.title || "",
          newTitle: updateData.title ?? chapter.title ?? "",
        });

        this.logger.log(
          `Updated chapter ${chapter.chapterNumber}: title="${updateData.title ?? "(unchanged)"}", outline cleaned=${!!updateData.outline}`,
        );
      }
    }

    return {
      updated: results.length,
      chapters: results,
    };
  }

  // ─── DB Operations ───

  /**
   * Create mission DB record
   */
  async createMissionRecord(
    missionId: string,
    input: WritingMissionInput,
    _userId: string,
  ) {
    const missionType =
      MISSION_TYPE_DB_MAP[input.missionType.toLowerCase()] || "CHAPTER";

    const created = await this.prisma.writingMission.create({
      data: {
        id: missionId,
        projectId: input.projectId,
        missionType: missionType as
          | "OUTLINE"
          | "CHAPTER"
          | "REVISION"
          | "CONSISTENCY",
        targetId: input.chapterId || input.volumeId || input.projectId,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        contextPackage: {
          userPrompt: input.userPrompt,
          targetWordCount: input.targetWordCount,
          additionalInstructions: input.additionalInstructions,
        },
      },
    });

    if (this.eventEmitter) {
      this.eventEmitter.emit(USER_EVENT_NAME, {
        userId: _userId,
        module: MODULE.AI_WRITING,
        action: ACTION.STARTED,
        resourceType: "WritingMission",
        resourceId: missionId,
      } satisfies UserEventPayload);
    }

    return created;
  }

  /**
   * Update mission DB record with result
   */
  async updateMissionRecord(missionId: string, result: WritingMissionResult) {
    const mission = await this.prisma.writingMission.update({
      where: { id: missionId },
      data: {
        status: result.success ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        result: {
          success: result.success,
          content: result.content,
          wordCount: result.wordCount,
          tokensUsed: result.tokensUsed,
          costUsed: result.costUsed,
          duration: result.duration,
          error: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                retryable: result.error.retryable,
              }
            : null,
        },
      },
    });

    // Update project status
    const project = await this.prisma.writingProject.findUnique({
      where: { id: mission.projectId },
      select: { currentWords: true, ownerId: true },
    });

    if (project) {
      const newStatus = result.success
        ? "REVISING"
        : project.currentWords > 0
          ? "REVISING"
          : "PLANNING";

      await this.prisma.writingProject.update({
        where: { id: mission.projectId },
        data: { status: newStatus },
      });

      this.logger.log(
        `Updated project ${mission.projectId} status to ${newStatus}`,
      );

      if (this.eventEmitter) {
        this.eventEmitter.emit(USER_EVENT_NAME, {
          userId: project.ownerId,
          module: MODULE.AI_WRITING,
          action: result.success ? ACTION.COMPLETED : ACTION.FAILED,
          resourceType: "WritingMission",
          resourceId: missionId,
        } satisfies UserEventPayload);
      }
    }

    return mission;
  }

  /**
   * Update mission progress
   */
  async updateMissionProgress(
    missionId: string,
    progress: number,
    currentStep: string,
  ): Promise<void> {
    try {
      await this.prisma.writingMission.update({
        where: { id: missionId },
        data: {
          result: { progress, currentStep },
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to update progress: ${(e as Error).message}`);
    }
  }

  /**
   * Verify project access for a user
   */
  async verifyProjectAccess(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId) {
      throw new Error("Access denied");
    }
  }

  /**
   * Apply Bible updates from mission result
   */
  async applyBibleUpdates(
    projectId: string,
    updates: WritingMissionResult["bibleUpdates"],
  ): Promise<void> {
    if (!updates) return;

    for (const update of updates) {
      try {
        switch (update.type) {
          case "character_state":
            this.logger.debug(
              `[${projectId ?? "unknown"}] character_state update deferred (not yet implemented)`,
            );
            break;
          case "timeline_event":
            this.logger.debug(
              `[${projectId ?? "unknown"}] timeline_event update deferred (not yet implemented)`,
            );
            break;
          case "new_fact":
            this.logger.debug(
              `[${projectId ?? "unknown"}] new_fact update deferred (not yet implemented)`,
            );
            break;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to apply Bible update: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Save mission event log
   */
  async saveMissionLog(
    missionId: string,
    eventType: string,
    content: string,
    options?: {
      agentId?: string;
      agentName?: string;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.prisma.writingMissionLog.create({
        data: {
          missionId,
          eventType,
          content,
          agentId: options?.agentId,
          agentName: options?.agentName,
          detail: options?.detail as object | undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to save mission log: ${(error as Error).message}`,
      );
    }
  }

  // ─── Model Management ───

  /**
   * Get available AI models (cached)
   */
  async getAvailableModels(): Promise<ModelConfig[]> {
    const now = Date.now();

    if (
      this.cachedModels &&
      now - this.modelCacheTime < WRITING_DEFAULTS.MODEL_CACHE_TTL
    ) {
      return this.cachedModels;
    }

    try {
      const models = await this.chatFacade.getAvailableModelsExtended(
        AIModelType.CHAT,
      );

      this.cachedModels = models
        .filter((m) => m.provider !== "xAI")
        .map((m) => ({
          modelId: m.id,
          displayName: m.name,
          provider: m.provider,
          isReasoning: m.isReasoning || false,
        }));

      this.modelCacheTime = now;

      this.logger.log(
        `Loaded ${this.cachedModels.length} AI models, ` +
          `${this.cachedModels.filter((m) => m.isReasoning).length} with reasoning capability`,
      );

      return this.cachedModels;
    } catch (error) {
      this.logger.error(
        `Failed to load AI models: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Assign AI models to writing roles (diversified strategy)
   */
  async assignModelsToRoles(): Promise<RoleModelAssignment[]> {
    const models = await this.getAvailableModels();

    if (models.length === 0) {
      this.logger.warn("No AI models available, all roles will be inactive");
      return [
        { roleId: "story-architect", modelId: "", isActive: false },
        { roleId: "bible-keeper", modelId: "", isActive: false },
        { roleId: "writer", modelId: "", isActive: false },
        { roleId: "consistency-checker", modelId: "", isActive: false },
        { roleId: "editor", modelId: "", isActive: false },
      ];
    }

    const reasoningModels = models.filter((m) => m.isReasoning);
    const chatModelCount = models.filter((m) => !m.isReasoning).length;
    this.logger.debug(
      `Available models: ${reasoningModels.length} reasoning, ${chatModelCount} chat`,
    );

    const roleModelMap: Record<string, ModelConfig> = {};

    // Leader: prefer reasoning model
    roleModelMap["story-architect"] =
      reasoningModels.length > 0 ? reasoningModels[0] : models[0];

    // Other roles: rotate through remaining models
    const memberRoles = [
      "bible-keeper",
      "writer",
      "consistency-checker",
      "editor",
    ];
    const availableForMembers = models.filter(
      (m) => m.modelId !== roleModelMap["story-architect"].modelId,
    );
    const poolForMembers =
      availableForMembers.length > 0 ? availableForMembers : models;

    // Group by provider for diversification
    const byProvider = new Map<string, ModelConfig[]>();
    for (const m of poolForMembers) {
      if (!byProvider.has(m.provider)) {
        byProvider.set(m.provider, []);
      }
      byProvider.get(m.provider)!.push(m);
    }

    const providers = Array.from(byProvider.keys());
    let providerIndex = 0;
    let modelIndexInProvider = 0;

    for (const roleId of memberRoles) {
      if (providers.length === 0) {
        roleModelMap[roleId] = poolForMembers[0] || models[0];
      } else if (providers.length === 1) {
        const providerModels = byProvider.get(providers[0])!;
        roleModelMap[roleId] =
          providerModels[modelIndexInProvider % providerModels.length];
        modelIndexInProvider++;
      } else {
        const currentProvider = providers[providerIndex % providers.length];
        const providerModels = byProvider.get(currentProvider)!;
        roleModelMap[roleId] = providerModels[0];
        providerIndex++;
      }
    }

    this.logger.log("Model assignment (diversified):");
    for (const [roleId, model] of Object.entries(roleModelMap)) {
      this.logger.log(
        `  - ${roleId}: ${model.displayName} (${model.provider}, reasoning=${model.isReasoning})`,
      );
    }

    const uniqueModels = new Set(
      Object.values(roleModelMap).map((m) => m.modelId),
    );
    this.logger.log(
      `Using ${uniqueModels.size} different models for ${Object.keys(roleModelMap).length} roles`,
    );

    return Object.entries(roleModelMap).map(([roleId, model]) => ({
      roleId,
      modelId: model.modelId,
      isActive: true,
    }));
  }

  /**
   * Get model for a specific role
   */
  async getModelForRole(roleId: string): Promise<string | null> {
    const assignments = await this.assignModelsToRoles();
    const assignment = assignments.find((a) => a.roleId === roleId);
    return assignment?.isActive ? assignment.modelId : null;
  }

  /**
   * Get active roles
   */
  async getActiveRoles(): Promise<string[]> {
    const assignments = await this.assignModelsToRoles();
    return assignments.filter((a) => a.isActive).map((a) => a.roleId);
  }

  // ─── Kernel Helpers ───

  getKernelProcessId(missionId: string): string | undefined {
    return this.kernelProcessIds.get(missionId);
  }

  completeKernelProcess(
    missionId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(missionId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .complete(processId, output)
      .catch((err: unknown) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.kernelProcessIds.delete(missionId);
  }

  failKernelProcess(missionId: string, error: string): void {
    const processId = this.kernelProcessIds.get(missionId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .fail(processId, error)
      .catch((err: unknown) =>
        this.logger.warn(
          `[Kernel] Failed to mark process as failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.kernelProcessIds.delete(missionId);
  }
}
