import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { AiTeamsService } from "../../teams/ai-teams.service";
import { AiResponseService } from "../../teams/services/ai/ai-response.service";
import { PlanningTemplateService } from "./planning-template.service";
import { CreatePlanDto, PlanningDepth } from "../dto/create-plan.dto";
import { UpdatePlanDto } from "../dto/update-plan.dto";
import { Prisma, TopicType, AIModelType } from "@prisma/client";
import { ChatFacade, TeamFacade, RAGFacade } from "@/modules/ai-harness/facade";
import { ProgressTrackerService } from "@/modules/ai-harness/facade";
import {
  MissionExecutorService,
  MissionContext,
  EventJournalService,
  ResourceManagerService,
  EventBusService,
} from "@/modules/ai-harness/facade";
import { WorkingMemoryManagerService } from "@/modules/ai-harness/facade";
import type { ChatMessage, TaskProfile } from "@/modules/ai-harness/facade";
import { BillingContext } from "../../../platform/facade";
import { LruMap } from "@/common/utils/lru-map";

export interface PlanPhaseStatus {
  status: "pending" | "active" | "completed" | "skipped" | "failed";
  missionId?: string;
  debateSessionId?: string;
  summary?: string;
  completedAt?: string;
  error?: string;
}

export interface PlanReference {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedDate?: string;
  score?: number;
  credibilityScore?: number;
  sourceType?: string;
  sourcePhase: number;
}

export interface VerifiedDataPoint {
  claim: string;
  sourceRef: string;
  confidence: "high" | "medium" | "low";
}

export interface PlanningTopicMetadata {
  planningMode: true;
  templateId: string;
  currentPhase: number;
  phaseStatus: Record<number, PlanPhaseStatus>;
  planConfig: {
    goal: string;
    depth: PlanningDepth;
    autoAdvance: boolean;
  };
  references?: PlanReference[];
  verifiedDataPoints?: VerifiedDataPoint[];
}

export interface PlanSummary {
  id: string;
  name: string;
  goal: string;
  templateId: string;
  currentPhase: number;
  totalPhases: number;
  phaseStatus: Record<number, PlanPhaseStatus>;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  visibility: "PRIVATE" | "SHARED" | "PUBLIC";
}

export interface PlanDetail extends PlanSummary {
  description: string | null;
  depth: PlanningDepth;
  autoAdvance: boolean;
  members: Array<{ id: string; displayName: string; aiModel: string }>;
  references: PlanReference[];
}

const PHASE_NAMES = [
  "",
  "goal-analysis",
  "research",
  "brainstorm",
  "debate",
  "synthesis",
  "delivery",
];

const PHASE_LABELS = [
  "",
  "目标分析",
  "调研洞察",
  "头脑风暴",
  "辩论推演",
  "方案综合",
  "输出交付",
];

/** Maps phase number → indices into the AI members array */
const PHASE_AGENT_INDICES: Record<number, number[]> = {
  1: [0, 2], // leader + analyst
  2: [1, 2], // researcher + analyst
  3: [0, 1, 3], // leader + researcher + copywriter
  4: [4, 5], // debaters (comprehensive) — falls back to [0, 2] if missing
  5: [0, 2, 3], // leader + analyst + copywriter
  6: [0, 3], // leader + copywriter
};

/** Role name → model category: "reasoning" or "chat" */
const ROLE_MODEL_TYPE: Record<string, "reasoning" | "chat"> = {
  策划总监: "reasoning",
  分析师: "reasoning",
  研究员: "chat",
  文案专家: "chat",
  正方辩手: "chat",
  反方辩手: "chat",
};

const TOTAL_PHASES = 6;

/** Delay before auto-advancing to next phase, allowing UI to catch up */
const AUTO_ADVANCE_DELAY_MS = 3000;

/** Maximum length for phase summary to prevent token overflow */
const MAX_PHASE_SUMMARY_LENGTH = 24000;

@Injectable()
export class PlanningOrchestratorService {
  private readonly logger = new Logger(PlanningOrchestratorService.name);
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiTeamsService: AiTeamsService,
    private readonly aiResponseService: AiResponseService,
    private readonly templateService: PlanningTemplateService,
    private readonly chatFacade: ChatFacade,
    private readonly teamFacade: TeamFacade,
    private readonly ragFacade: RAGFacade,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
    @Optional() private readonly progressTracker?: ProgressTrackerService,
    @Optional() private readonly kernelJournal?: EventJournalService,
    @Optional() private readonly kernelMemory?: WorkingMemoryManagerService,
    @Optional() private readonly resourceManager?: ResourceManagerService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {
    // Forward-declared kernel service injections (used by future integrations):
    // progressTracker, kernelMemory, resourceManager are wired for upcoming
    // per-phase progress events, intermediate state storage, and token budget enforcement.
    void (this.progressTracker, this.kernelMemory, this.resourceManager);
  }

  // ==================== Plan CRUD ====================

  async createPlan(
    userId: string,
    dto: CreatePlanDto,
  ): Promise<{ planId: string }> {
    const template = dto.templateId
      ? this.templateService.getTemplate(dto.templateId)
      : this.templateService.getDefaultTemplate();

    if (!template) {
      throw new NotFoundException(`Template ${dto.templateId} not found`);
    }

    const depth = dto.depth || PlanningDepth.STANDARD;

    const phaseStatus: Record<number, PlanPhaseStatus> = {};
    for (let i = 1; i <= TOTAL_PHASES; i++) {
      phaseStatus[i] = { status: "pending" };
    }

    const metadata: PlanningTopicMetadata = {
      planningMode: true,
      templateId: template.id,
      currentPhase: 0,
      phaseStatus,
      planConfig: { goal: dto.goal, depth, autoAdvance: true },
    };

    // Fix 1: Dynamic model allocation via AIFacade
    const aiMembers = await this.buildAIMembers(depth);

    const topic = await this.aiTeamsService.createTopic(userId, {
      name: dto.name,
      description: dto.goal,
      type: TopicType.PRIVATE,
      aiMembers,
    });

    await this.prisma.topic.update({
      where: { id: topic.id },
      data: { metadata: metadata as unknown as Prisma.InputJsonValue },
    });

    this.logger.log(`Planning created: ${topic.id}, template: ${template.id}`);
    return { planId: topic.id };
  }

  async getPlans(userId: string, search?: string): Promise<PlanSummary[]> {
    const topics = await this.prisma.topic.findMany({
      where: {
        members: { some: { userId } },
        metadata: { path: ["planningMode"], equals: true },
        archivedAt: null,
        ...(search
          ? { name: { contains: search, mode: "insensitive" as const } }
          : {}),
      },
      include: { _count: { select: { aiMembers: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return topics.map((topic) => {
      const meta =
        (topic.metadata as unknown as PlanningTopicMetadata) ||
        ({} as PlanningTopicMetadata);
      return {
        id: topic.id,
        name: topic.name,
        goal: meta.planConfig?.goal || topic.description || "",
        templateId: meta.templateId || "general",
        currentPhase: meta.currentPhase || 0,
        totalPhases: TOTAL_PHASES,
        phaseStatus: meta.phaseStatus || {},
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt,
        memberCount: topic._count.aiMembers,
        visibility:
          (topic.visibility as "PRIVATE" | "SHARED" | "PUBLIC") || "PRIVATE",
      };
    });
  }

  async getPlanDetail(planId: string, userId: string): Promise<PlanDetail> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        members: { some: { userId } },
        metadata: { path: ["planningMode"], equals: true },
      },
      include: {
        aiMembers: {
          select: { id: true, displayName: true, aiModel: true },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { aiMembers: true } },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    const meta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);

    return {
      id: topic.id,
      name: topic.name,
      description: topic.description,
      goal: meta.planConfig?.goal || topic.description || "",
      templateId: meta.templateId || "general",
      currentPhase: meta.currentPhase || 0,
      totalPhases: TOTAL_PHASES,
      phaseStatus: meta.phaseStatus || {},
      depth: meta.planConfig?.depth || PlanningDepth.STANDARD,
      autoAdvance: meta.planConfig?.autoAdvance ?? true,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
      memberCount: topic._count.aiMembers,
      members: topic.aiMembers,
      references: meta.references || [],
      visibility:
        (topic.visibility as "PRIVATE" | "SHARED" | "PUBLIC") || "PRIVATE",
    };
  }

  async updatePlan(
    planId: string,
    userId: string,
    dto: UpdatePlanDto,
  ): Promise<PlanDetail> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        members: { some: { userId } },
        metadata: { path: ["planningMode"], equals: true },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    const meta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);

    // Only allow updates when not currently running
    const isRunning = Object.values(meta.phaseStatus || {}).some(
      (s) => s.status === "active",
    );
    if (isRunning) {
      throw new NotFoundException("Cannot update plan while a phase is active");
    }

    const updatedConfig = { ...meta.planConfig };
    if (dto.goal !== undefined) updatedConfig.goal = dto.goal;
    if (dto.depth !== undefined) updatedConfig.depth = dto.depth;

    const updatedMetadata: PlanningTopicMetadata = {
      ...meta,
      planConfig: updatedConfig,
    };

    const updateData: Prisma.TopicUpdateInput = {
      metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
    };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.goal !== undefined) updateData.description = dto.goal;

    await this.prisma.topic.update({
      where: { id: planId },
      data: updateData,
    });

    return this.getPlanDetail(planId, userId);
  }

  async updatePlanVisibility(
    planId: string,
    userId: string,
    visibility: "PRIVATE" | "SHARED" | "PUBLIC",
  ): Promise<{ success: boolean; visibility: string }> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        createdById: userId,
        metadata: { path: ["planningMode"], equals: true },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    await this.prisma.topic.update({
      where: { id: planId },
      data: { visibility },
    });

    this.logger.log(`Plan ${planId} visibility updated to ${visibility}`);
    return { success: true, visibility };
  }

  // ==================== Phase State Machine (Fix 2) ====================

  async advancePhase(
    planId: string,
    userId: string,
  ): Promise<{ currentPhase: number }> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        members: { some: { userId } },
        metadata: { path: ["planningMode"], equals: true },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    const meta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);
    const currentPhase = meta.currentPhase || 0;
    const currentStatus = meta.phaseStatus?.[currentPhase];

    // State machine logic
    if (currentPhase === 0) {
      // Not started → start phase 1
      return this.activatePhase(planId, userId, meta, 1);
    }

    if (currentStatus?.status === "active") {
      // Already running → ignore (don't skip)
      this.logger.warn(
        `Plan ${planId} phase ${currentPhase} already active, ignoring advance`,
      );
      return { currentPhase };
    }

    if (currentStatus?.status === "pending") {
      // Was cancelled → re-activate current phase
      return this.activatePhase(planId, userId, meta, currentPhase);
    }

    if (currentStatus?.status === "completed") {
      // Completed → advance to next phase
      const nextPhase = currentPhase + 1;
      if (nextPhase > TOTAL_PHASES) {
        return { currentPhase }; // All done
      }
      return this.activatePhase(planId, userId, meta, nextPhase);
    }

    if (currentStatus?.status === "failed") {
      // Failed → re-activate current phase (retry on user click)
      return this.activatePhase(planId, userId, meta, currentPhase);
    }

    return { currentPhase };
  }

  private async activatePhase(
    planId: string,
    userId: string,
    _meta: PlanningTopicMetadata,
    targetPhase: number,
  ): Promise<{ currentPhase: number }> {
    // Read fresh metadata to prevent stale overwrites (Bug 1 fix)
    const topic = await this.prisma.topic.findFirst({
      where: { id: planId },
    });
    if (!topic) throw new NotFoundException("Plan not found");

    const freshMeta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);

    const updatedPhaseStatus = { ...freshMeta.phaseStatus };
    updatedPhaseStatus[targetPhase] = {
      ...updatedPhaseStatus[targetPhase],
      status: "active",
    };

    const updatedMetadata: PlanningTopicMetadata = {
      ...freshMeta,
      currentPhase: targetPhase,
      phaseStatus: updatedPhaseStatus,
    };

    await this.prisma.topic.update({
      where: { id: planId },
      data: {
        metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Plan ${planId} activated phase ${targetPhase}: ${PHASE_NAMES[targetPhase]}`,
    );

    // Fix 3: Trigger async AI execution
    this.executePhaseAsync(planId, userId, targetPhase).catch((err) => {
      this.logger.error(
        `Phase ${targetPhase} execution failed for plan ${planId}: ${err.message}`,
        err.stack,
      );
    });

    return { currentPhase: targetPhase };
  }

  async retryPhase(
    planId: string,
    phase: number,
    userId: string,
  ): Promise<void> {
    if (phase < 1 || phase > TOTAL_PHASES) {
      throw new NotFoundException("Invalid phase number");
    }

    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        members: { some: { userId } },
        metadata: { path: ["planningMode"], equals: true },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    const meta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);
    const updatedPhaseStatus = { ...meta.phaseStatus };
    updatedPhaseStatus[phase] = { status: "active" };

    const updatedMetadata: PlanningTopicMetadata = {
      ...meta,
      currentPhase: phase,
      phaseStatus: updatedPhaseStatus,
    };

    await this.prisma.topic.update({
      where: { id: planId },
      data: {
        metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Plan ${planId} retrying phase ${phase}: ${PHASE_NAMES[phase]}`,
    );

    // Trigger async execution for retry
    this.executePhaseAsync(planId, userId, phase).catch((err) => {
      this.logger.error(
        `Phase ${phase} retry failed for plan ${planId}: ${err.message}`,
        err.stack,
      );
    });
  }

  async replanFromPhase(
    planId: string,
    startPhase: number,
    userId: string,
  ): Promise<{ currentPhase: number }> {
    if (startPhase < 1 || startPhase > TOTAL_PHASES) {
      throw new BadRequestException(
        `startPhase must be between 1 and ${TOTAL_PHASES}`,
      );
    }

    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        members: { some: { userId } },
        metadata: { path: ["planningMode"], equals: true },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    const meta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);

    // Check if any phase is currently active
    const hasActivePhase = Object.values(meta.phaseStatus || {}).some(
      (s) => s.status === "active",
    );

    if (hasActivePhase) {
      throw new BadRequestException(
        "A phase is currently running. Please cancel it before replanning.",
      );
    }

    // Reset phases from startPhase to TOTAL_PHASES
    const updatedPhaseStatus = { ...meta.phaseStatus };
    for (let i = startPhase; i <= TOTAL_PHASES; i++) {
      updatedPhaseStatus[i] = { status: "pending" };
    }

    // If replan from phase 1 or 2, clear references to force re-search
    const shouldClearReferences = startPhase <= 2;
    const updatedMetadata: PlanningTopicMetadata = {
      ...meta,
      currentPhase: startPhase,
      phaseStatus: updatedPhaseStatus,
      ...(shouldClearReferences ? { references: [] } : {}),
    };

    await this.prisma.topic.update({
      where: { id: planId },
      data: {
        metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Plan ${planId} replanning from phase ${startPhase}: ${PHASE_NAMES[startPhase]}`,
    );

    // Trigger async execution from startPhase
    this.executePhaseAsync(planId, userId, startPhase).catch((err) => {
      this.logger.error(
        `Replan from phase ${startPhase} failed for plan ${planId}: ${err.message}`,
        err.stack,
      );
    });

    return { currentPhase: startPhase };
  }

  async cancelPhase(planId: string, userId: string): Promise<void> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        members: { some: { userId } },
        metadata: { path: ["planningMode"], equals: true },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    const meta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);

    const currentPhase = meta.currentPhase || 0;
    if (currentPhase === 0) {
      return;
    }

    const currentStatus = meta.phaseStatus?.[currentPhase];
    if (currentStatus?.status !== "active") {
      return;
    }

    const updatedPhaseStatus = { ...meta.phaseStatus };
    updatedPhaseStatus[currentPhase] = { status: "pending" };

    const updatedMetadata: PlanningTopicMetadata = {
      ...meta,
      phaseStatus: updatedPhaseStatus,
    };

    await this.prisma.topic.update({
      where: { id: planId },
      data: {
        metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `Plan ${planId} cancelled phase ${currentPhase}: ${PHASE_NAMES[currentPhase]}`,
    );
  }

  // ==================== AI Execution Engine (Fix 3) ====================

  private async executePhaseAsync(
    planId: string,
    userId: string,
    phase: number,
  ): Promise<void> {
    return BillingContext.run(
      {
        userId,
        moduleType: "ai-planning",
        operationType: "utility",
        referenceId: planId,
      },
      () => {
        const processId = this.kernelProcessIds.get(planId);
        const inner = () => this.executePhaseAsyncInner(planId, userId, phase);
        return processId
          ? MissionContext.run({ agentProcessId: processId, userId }, inner)
          : inner();
      },
    );
  }

  private async executePhaseAsyncInner(
    planId: string,
    userId: string,
    phase: number,
  ): Promise<void> {
    this.logger.log(`Executing phase ${phase} for plan ${planId}`);

    // Spawn AI Kernel process at the start of phase 1 (plan execution begins)
    if (phase === 1 && this.missionExecutor) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId,
          agentId: "planning-orchestrator",
          teamSessionId: planId,
          input: { planId, totalPhases: TOTAL_PHASES },
          tokenBudget: 150000,
        });
        this.kernelProcessIds.set(planId, kernelResult.processId);
        this.recordKernelEvent(planId, "planning:started", {});
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${(err as Error).message}`,
        );
      }
    }

    try {
      // 1. Load topic + AI members + metadata
      const topic = await this.prisma.topic.findFirst({
        where: { id: planId },
        include: {
          aiMembers: {
            select: {
              id: true,
              displayName: true,
              aiModel: true,
              systemPrompt: true,
              roleDescription: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!topic) {
        throw new Error("Plan topic not found");
      }

      const meta =
        (topic.metadata as unknown as PlanningTopicMetadata) ||
        ({} as PlanningTopicMetadata);

      // Check if phase was cancelled while loading
      if (meta.phaseStatus?.[phase]?.status !== "active") {
        this.logger.log(
          `Phase ${phase} no longer active for plan ${planId}, skipping execution`,
        );
        return;
      }

      // 2. Web search for Research phase (Phase 2) — collect real-time references
      let searchContext = "";
      if (phase === 2) {
        const searchResults = await this.searchForResearchPhase(
          meta.planConfig.goal,
          topic.name,
          planId,
          phase,
        );
        if (searchResults.context) {
          searchContext = searchResults.context;
        }
      }

      // 3. Build context from previous phases
      const previousContext = await this.buildPreviousPhaseContext(meta, phase);

      // 4. Get AI members for this phase
      const agentIndices = PHASE_AGENT_INDICES[phase] || [0];
      const agents = agentIndices
        .map((idx) => topic.aiMembers[idx])
        .filter(Boolean);

      // Fallback if debate phase but no debaters (non-comprehensive)
      if (agents.length === 0 && phase === 4) {
        const fallbackAgents = [topic.aiMembers[0], topic.aiMembers[2]].filter(
          Boolean,
        );
        agents.push(...fallbackAgents);
      }

      if (agents.length === 0) {
        throw new Error(`No agents available for phase ${phase}`);
      }

      // 5. Execute each agent with chain collaboration
      // - Phase 6 (Delivery): iterative refinement via buildDeliveryRefinementPrompt
      // - Phase 5 (Synthesis): iterative refinement via buildSynthesisRefinementPrompt
      // - Phase 1-4: later agents see ALL earlier agents' accumulated output
      // Each completed result is stored as { agentName, output } to keep agent
      // identity bound to its output even when earlier agents fail (skip via continue).
      const completedResults: Array<{ agentName: string; output: string }> = [];

      for (const agent of agents) {
        let phasePrompt: string;

        if (phase === 6 && completedResults.length > 0) {
          // Phase 6: subsequent agents refine into delivery document
          phasePrompt = this.buildDeliveryRefinementPrompt(
            meta,
            agent.displayName,
            agent.roleDescription || "",
            topic.name,
            completedResults[completedResults.length - 1].output,
          );
        } else if (phase === 5 && completedResults.length > 0) {
          // Phase 5: subsequent agents deepen the synthesis (not delivery formatting)
          phasePrompt = this.buildSynthesisRefinementPrompt(
            meta,
            agent.displayName,
            agent.roleDescription || "",
            topic.name,
            completedResults[completedResults.length - 1].output,
            previousContext,
          );
        } else {
          phasePrompt = this.buildPhasePrompt(
            meta,
            phase,
            agent.displayName,
            agent.roleDescription || "",
            previousContext,
            topic.name,
            searchContext,
          );

          // Phase 1-4: append ALL previous agents' outputs for chain collaboration
          if (completedResults.length > 0 && phase <= 4) {
            const allPrevious = completedResults
              .map((r) => `### ${r.agentName}\n\n${r.output}`)
              .join("\n\n---\n\n");
            phasePrompt += `\n\n---\n\n## 本阶段其他成员的分析\n\n${allPrevious}\n\n---\n\n请在上述分析的基础上，补充、质疑或深化你的分析，避免重复已有内容。`;
          }
        }

        const messages: ChatMessage[] = [
          {
            role: "system",
            content: agent.systemPrompt || `你是${agent.displayName}。`,
          },
          { role: "user", content: phasePrompt },
        ];

        const taskProfile = this.getTaskProfileForPhase(
          phase,
          meta.planConfig.depth,
        );

        const response = await this.chatFacade.chat({
          messages,
          modelType: AIModelType.CHAT,
          taskProfile,
          model: agent.aiModel !== "default" ? agent.aiModel : undefined,
          billing: {
            userId,
            moduleType: "ai-planning",
            operationType: "execute-phase",
            referenceId: planId,
          },
        });

        if (response.isError) {
          this.logger.error(
            `Agent ${agent.displayName} failed for phase ${phase} of plan ${planId}: ${response.content}`,
          );
          continue;
        }

        // Save AI response as topic message
        await this.aiResponseService.createAIMessage(
          planId,
          agent.id,
          response.content,
          response.model,
          response.tokensUsed,
        );

        completedResults.push({
          agentName: agent.displayName,
          output: response.content,
        });
      }

      // 6. Handle no-output case as failure (Bug 2 fix)
      if (completedResults.length === 0) {
        this.logger.warn(
          `Phase ${phase} produced no output for plan ${planId}`,
        );
        await this.updatePhaseStatus(planId, phase, {
          status: "failed",
          error: "All agents failed to produce output for this phase.",
        });
        return; // Don't auto-advance
      }

      // 7. Build phase summary and mark completed
      // - Phase 5, 6 (refinement): only the final agent's polished output
      // - Phase 1-4 (chain collaboration / debate): concatenate all with agent name headers
      let summary =
        phase >= 5
          ? completedResults[completedResults.length - 1].output
          : completedResults
              .map((r) => `### ${r.agentName}\n\n${r.output}`)
              .join("\n\n---\n\n");

      // 7a. Phase 2 post-processing: extract verified data points
      if (phase === 2) {
        await this.extractVerifiedDataPoints(planId, summary);
      }

      // 7b. Quality gate (STANDARD and COMPREHENSIVE only)
      if (meta.planConfig.depth !== PlanningDepth.QUICK) {
        const qualityDimensions = this.getQualityDimensions(phase);
        const reflection = await this.teamFacade.reflect(
          {
            objective: `Phase ${phase} (${PHASE_LABELS[phase]}): ${meta.planConfig.goal}`,
            progressSummary: summary.substring(0, 8000),
            currentRound: 1,
            maxRounds: 2,
            evaluationDimensions: qualityDimensions,
          },
          { modelType: AIModelType.CHAT_FAST, completionThreshold: 60 },
        );

        if (!reflection) {
          this.logger.warn(
            `[planning] ReflectionService unavailable, skipping quality gate for phase ${phase}`,
          );
        } else {
          this.logger.log(
            `Quality gate for phase ${phase}: score=${reflection.qualityScore}, gaps=${reflection.gaps.length}`,
          );

          if (reflection.qualityScore < 50 && reflection.gaps.length > 0) {
            // Retry with the last agent using quality feedback
            const lastAgent = agents[agents.length - 1];
            const retryPrompt = `质量评审反馈（评分：${reflection.qualityScore}/100）：\n${reflection.gaps.map((g) => `- ${g}`).join("\n")}\n\n请针对以上问题修正你的输出。保持原有结构，重点修正评审指出的问题。\n\n---\n\n你之前的输出：\n\n${completedResults[completedResults.length - 1].output}`;

            const retryMessages: ChatMessage[] = [
              {
                role: "system",
                content:
                  lastAgent.systemPrompt || `你是${lastAgent.displayName}。`,
              },
              { role: "user", content: retryPrompt },
            ];

            const retryResponse = await this.chatFacade.chat({
              messages: retryMessages,
              modelType: AIModelType.CHAT,
              taskProfile: this.getTaskProfileForPhase(
                phase,
                meta.planConfig.depth,
              ),
              model:
                lastAgent.aiModel !== "default" ? lastAgent.aiModel : undefined,
              billing: {
                userId,
                moduleType: "ai-planning",
                operationType: "execute-phase",
                referenceId: planId,
              },
            });

            if (!retryResponse.isError) {
              // Save retry response as message
              await this.aiResponseService.createAIMessage(
                planId,
                lastAgent.id,
                retryResponse.content,
                retryResponse.model,
                retryResponse.tokensUsed,
              );

              // Replace summary with improved output
              if (phase >= 5) {
                summary = retryResponse.content;
              } else {
                // Replace the last agent's output
                completedResults[completedResults.length - 1].output =
                  retryResponse.content;
                summary = completedResults
                  .map((r) => `### ${r.agentName}\n\n${r.output}`)
                  .join("\n\n---\n\n");
              }

              this.logger.log(
                `Quality gate retry completed for phase ${phase}, plan ${planId}`,
              );
            }
          }
        } // end else (reflection available)
      }

      await this.updatePhaseStatus(planId, phase, {
        status: "completed",
        summary,
        completedAt: new Date().toISOString(),
      });

      this.logger.log(`Phase ${phase} completed for plan ${planId}`);

      // Complete AI Kernel process when the final phase finishes
      if (phase === TOTAL_PHASES) {
        this.recordKernelEvent(planId, "planning:complete", {});
        this.completeKernelProcess(planId, { completedPhases: TOTAL_PHASES });
      }

      // 8. Auto-advance if enabled (with delay so frontend can catch up)
      if (meta.planConfig.autoAdvance && phase < TOTAL_PHASES) {
        // Wait before auto-advancing so the UI can show phase completion
        await new Promise((resolve) =>
          setTimeout(resolve, AUTO_ADVANCE_DELAY_MS),
        );

        // Re-read metadata to check if cancelled during the delay
        const freshTopic = await this.prisma.topic.findFirst({
          where: { id: planId },
        });
        const freshMeta =
          (freshTopic?.metadata as unknown as PlanningTopicMetadata) || meta;

        if (freshMeta.phaseStatus?.[phase]?.status === "completed") {
          this.advancePhase(planId, userId).catch((err) => {
            this.logger.error(
              `Auto-advance failed after phase ${phase}: ${err.message}`,
              err.stack,
            );
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(
        `Phase ${phase} execution failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.updatePhaseStatus(planId, phase, {
        status: "failed",
        error: errorMessage,
      });

      // Fail AI Kernel process on any phase failure
      this.recordKernelEvent(planId, "planning:failed", {
        error: errorMessage,
      });
      this.failKernelProcess(planId, `Phase ${phase} failed: ${errorMessage}`);
    }
  }

  private recordKernelEvent(
    entityId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(entityId);
    if (!processId || !this.kernelJournal) return;
    void this.kernelJournal
      .record(processId, type, payload)
      .catch((err: unknown) =>
        this.logger.warn(
          `[Kernel] Event ${type} failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  private emitKernelLifecycle(
    entityId: string,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(entityId);
    if (!processId || !this.eventBus) return;
    this.eventBus.emit({
      type: event,
      payload: { processId, module: "planning", ...data },
      metadata: { timestamp: new Date(), source: "planning" },
    });
  }

  private completeKernelProcess(
    planId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(planId);
    if (!processId || !this.missionExecutor) return;
    this.emitKernelLifecycle(planId, "kernel:mission.complete", output);
    void this.missionExecutor
      .complete(processId, output)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(planId);
  }

  private failKernelProcess(planId: string, error: string): void {
    const processId = this.kernelProcessIds.get(planId);
    if (!processId || !this.missionExecutor) return;
    this.emitKernelLifecycle(planId, "kernel:mission.failed", { error });
    void this.missionExecutor
      .fail(processId, error)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to fail process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(planId);
  }

  private async updatePhaseStatus(
    planId: string,
    phase: number,
    update: Partial<PlanPhaseStatus>,
  ): Promise<void> {
    const topic = await this.prisma.topic.findFirst({
      where: { id: planId },
    });

    if (!topic) return;

    const meta =
      (topic.metadata as unknown as PlanningTopicMetadata) ||
      ({} as PlanningTopicMetadata);

    const updatedPhaseStatus = { ...meta.phaseStatus };
    updatedPhaseStatus[phase] = {
      ...updatedPhaseStatus[phase],
      ...update,
    };

    const updatedMetadata: PlanningTopicMetadata = {
      ...meta,
      phaseStatus: updatedPhaseStatus,
    };

    await this.prisma.topic.update({
      where: { id: planId },
      data: {
        metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Build previous phase context for the current phase prompt.
   *
   * For phase 6 (Delivery): include phase 2 (research data) + phase 4
   * (debate conclusions) + phase 5 (synthesis) — the three most valuable
   * upstream phases, each with a 20000-char limit.
   *
   * For other phases: include all previous phases, each capped at
   * MAX_PHASE_SUMMARY_LENGTH to prevent token overflow.
   */
  private async buildPreviousPhaseContext(
    meta: PlanningTopicMetadata,
    currentPhase: number,
  ): Promise<string> {
    const contextParts: string[] = [];

    // Phase 6 (Delivery): see Phase 2 (research data) + Phase 4 (debate conclusions)
    // + Phase 5 (synthesis) — the three most valuable upstream phases
    // Other phases: see all previous phases as before
    const phases =
      currentPhase === 6
        ? [2, 4, 5]
        : Array.from({ length: currentPhase - 1 }, (_, i) => i + 1);

    // Phase 6 gets a higher per-phase limit since it only reads 3 phases
    const perPhaseLimit = currentPhase === 6 ? 20000 : MAX_PHASE_SUMMARY_LENGTH;

    for (const i of phases) {
      const phaseStatus = meta.phaseStatus?.[i];
      if (phaseStatus?.status === "completed" && phaseStatus.summary) {
        let summary = phaseStatus.summary;
        if (summary.length > perPhaseLimit) {
          try {
            const result = await this.teamFacade.aiCompressContext(summary, {
              targetSize: perPhaseLimit,
              summaryStyle: i === 2 ? "analytical" : "detailed",
            });
            if (result) {
              summary = result.compressedContext;
            }
          } catch (err) {
            this.logger.warn(
              `Context compression failed for phase ${i}, falling back to truncation: ${err instanceof Error ? err.message : err}`,
            );
            summary =
              summary.slice(0, perPhaseLimit) +
              "\n\n...(内容过长，已截断，请基于以上内容完成本阶段任务)";
          }
        }
        contextParts.push(
          `## 阶段 ${i} — ${PHASE_LABELS[i]} (已完成)\n\n${summary}`,
        );
      }
    }

    return contextParts.length > 0
      ? `以下是前序阶段的成果摘要：\n\n${contextParts.join("\n\n---\n\n")}`
      : "";
  }

  private buildPhasePrompt(
    meta: PlanningTopicMetadata,
    phase: number,
    agentName: string,
    agentRole: string,
    previousContext: string,
    planName: string,
    searchContext?: string,
  ): string {
    const goal = meta.planConfig.goal;
    const depth = meta.planConfig.depth;
    const phaseName = PHASE_LABELS[phase];
    const currentDate = new Date().toISOString().split("T")[0];

    const depthInstruction =
      depth === PlanningDepth.QUICK
        ? "请简洁扼要地完成任务，重点突出关键信息。"
        : depth === PlanningDepth.COMPREHENSIVE
          ? "请进行深入全面的分析，不遗漏任何细节，提供详尽的论证和数据支持。"
          : "请按照标准深度进行分析，兼顾全面性和简洁性。";

    const phaseInstructions: Record<number, string> = {
      1: `你的任务是**解题**——深度理解用户到底在问什么、需要什么，而不是急于给方案。

这是整个策划流程的起点。你的核心价值是"问对问题"，如果这一步理解偏了，后面所有阶段都是在错误方向上努力。

请按以下顺序完成分析：

### 1. 用户诉求解析（最重要）
- **用户真正想要的是什么？**不是复述目标，而是挖掘背后的动机和期望
- **用户说了什么 vs 没说什么？**哪些关键信息是缺失的？
- **目标中的隐含假设**：用户可能默认了什么条件？这些假设成立吗？
- **如果用一句话重新定义这个问题**，应该怎么说？

### 2. 问题拆解（MECE原则）
- 将目标拆解为3-5个需要分别回答的子问题
- 每个子问题说明：
  - 为什么这个问题重要（不回答会怎样？）
  - 回答这个问题需要什么信息或数据？
  - 子问题之间的依赖关系是什么？（哪个要先回答？）

### 3. 难点识别
- 这个策划中最难的部分是什么？（数据获取难？方向选择多？资源约束紧？）
- 什么情况下这个策划可能失败？

### 4. 调研方向建议
- 列出第二阶段（调研）需要重点关注的领域
- 每个领域说明：需要找什么类型的数据？为什么？

⚠️ **本阶段禁止事项**：
- 禁止输出时间表、预算、KPI、行动计划
- 禁止给出具体的执行建议或推荐方案
- 禁止编造数据或统计数字
- 禁止用"建议采用XX策略"来回答——本阶段只分析问题，不给答案
- 禁止输出空泛的分析框架名称（如"建议用SWOT分析"）而不解释为什么适用`,
      2: searchContext
        ? `你的任务是**基于实时搜索资料进行调研分析**，梳理事实和洞察。

请使用下方提供的搜索结果，按以下结构组织调研发现：

### 1. 按维度整理的调研发现
针对第一阶段提出的每个分析维度/子问题，整理相关的事实、数据和案例。
- 使用 [编号] 格式引用来源（如 [1]、[2]）
- 区分"硬数据"（有出处的统计数字）和"软信息"（趋势判断、专家观点）

### 2. 关键洞察
- 提炼5-8条最重要的发现，每条用1-2句话概括
- 标注每条洞察的可信度（高/中/低）和数据来源

### 3. 行业对标与趋势
- 相关行业的基准数据和最佳实践
- 值得关注的趋势和变化信号

### 4. 信息缺口
- 哪些问题仍然缺乏可靠数据？
- 如果搜索资料中没有某方面的信息，明确说明"该方面暂无实时数据"

⚠️ **本阶段禁止事项**：
- 严禁编造或虚构任何引用来源、报告名称或数据
- 禁止给出推荐方案或行动建议——本阶段只呈现事实和洞察
- 禁止输出时间表、预算、KPI`
        : `你的任务是**围绕策划目标进行调研分析**，梳理已知信息和洞察。

注意：你没有实时搜索能力，请基于已有知识进行分析。

请按以下结构组织调研发现：

### 1. 按维度整理的调研发现
针对第一阶段提出的每个分析维度/子问题，整理相关的事实、数据和案例。
- 区分"确定性较高的信息"和"需要验证的推断"

### 2. 关键洞察
- 提炼5-8条最重要的发现，每条用1-2句话概括

### 3. 行业对标与趋势
- 相关行业的通用规律和最佳实践
- 值得关注的趋势和变化方向

### 4. 信息缺口
- 哪些问题需要进一步调研或实地验证？

⚠️ **本阶段禁止事项**：
- 不要编造具体的报告名称、机构引用或统计数据
- 禁止给出推荐方案或行动建议——本阶段只呈现事实和洞察
- 禁止输出时间表、预算、KPI`,
      3: `你的任务是**发散性思考**，提出多种截然不同的战略方向，而非输出一个确定的执行方案。

请完成以下工作：

### 战略方向探索
基于前期分析和调研成果，提出 **3-5个差异化的战略方向**。每个方向需包括：

**方向 N：[方向名称]**
- **核心思路**：用2-3句话描述这个方向的核心逻辑
- **优势**：这个方向的主要优点（2-3条）
- **劣势/风险**：这个方向的主要挑战（2-3条）
- **适用条件**：在什么情况下这个方向最优
- **创新点**：这个方向有什么独特或非常规之处

### 方向对比总览
用简表对比各方向在关键维度上的差异（如资源需求、见效速度、风险水平、创新程度等）。

### 组合可能性
是否有方向可以组合？哪些方向是互斥的？

⚠️ **本阶段禁止事项**：
- 禁止只给出一个"推荐方案"——必须呈现多个可选方向
- 禁止输出详细的执行计划、时间表、预算
- 禁止过早收敛——本阶段的价值在于充分探索可能性
- 鼓励包含至少一个"非常规/大胆"的方向`,
      4: `你的任务是**对第三阶段提出的战略方向进行辩论式推演**，通过正反对抗发现最优路径。

请按以下辩论格式输出：

### 辩论推演

对每个主要战略方向，进行正反方辩论：

**方向 N：[方向名称]**

🟢 **正方论点**（支持该方向的理由）：
- 论点1：[具体论据和推理]
- 论点2：[具体论据和推理]
- 支撑案例或数据

🔴 **反方质疑**（反对该方向的理由）：
- 质疑1：[具体的挑战和风险]
- 质疑2：[假设可能不成立的地方]
- 最坏情况推演

🔄 **正方回应**：
- 对反方核心质疑的回应和缓解方案

### 压力测试
对各方向进行"如果...会怎样"的情景推演：
- 如果市场环境突变？
- 如果资源不足预期？
- 如果竞争对手先行一步？

### 辩论结论
- 哪些方向经受住了考验？哪些暴露了致命弱点？
- 各方向的韧性排序

⚠️ **本阶段禁止事项**：
- 禁止输出为正式报告格式——必须保持辩论/对抗的结构
- 禁止跳过反方质疑，不允许"一边倒"地支持某方案
- 禁止输出详细的执行计划、预算、KPI`,
      5: `请综合前述所有阶段的成果，整合出最优方案。要求使用"结论先行"结构，按以下框架输出：

## 执行摘要
（核心结论和推荐方案，2-3段即可）

## 关键发现
（从调研和分析中提炼的最重要洞察，列出5-8条，每条必须引用调研来源 [编号]）

## 推荐方案
（详细描述推荐的行动方案，包括具体策略和实施路径）

## 风险评估
（主要风险及缓解措施，基于辩论阶段暴露的实际问题）

## 本方案的关键假设
（列出方案成立所依赖的假设条件）

## 需要进一步验证的问题
（列出当前数据不足、需要实地验证或深入调研的问题）

### 综合核心要求

**证据追溯（最高优先级）**：
- 每个"关键发现"必须引用调研阶段的具体来源 [编号]
- 每个"推荐方案"必须说明它来自哪个阶段的哪个结论
- 如果推荐无法追溯到前序证据，标注为"假设性建议，需验证"

**诚实性要求**：
- 数据不足的维度明确写："调研数据有限，以下为初步判断"
- 不要把辩论中被否定的方向当推荐方案
- 不要把低可信度信息当确定事实
- 不要编造调研阶段没有的数据`,
      6: `请将综合方案转化为可提交决策层的策划文档。

## 文档质量标准（严格按优先级排序）

### 第一优先：内容真实性
- 来自调研的数据：使用并标注 [编号]
- 可从调研数据推算的数据：使用并标注"推算，基于 [编号]"
- 无数据支撑的指标：标注 [需补充实际数据]
- 绝对禁止凭空编造具体数值

### 第二优先：逻辑链完整
- 每个推荐行动必须可追溯到调研发现或辩论结论
- 无法追溯的建议标注为"假设性建议"
- 风险评估基于辩论阶段暴露的实际问题

### 第三优先：可操作性
- 行动计划颗粒度到"第一步做什么"
- 时间表标注为"建议时间，需根据实际资源调整"
- 预算标注为"量级估算"
- 所有责任人使用角色职位名称（如"市场部负责人"、"技术总监"）

### 第四优先：文档结构
按需使用以下章节（只写有实质内容的，不强制所有章节都出现）：

## 执行摘要
- 项目背景（1-2句话）
- 核心策略（推荐方案一句话概括）
- 预期成果（基于调研数据的合理预期，标注数据来源）
- 推荐的前3项优先行动

## 背景与现状分析
- 引用调研数据 [编号] 描述市场环境和行业趋势
- 竞争格局概述（如有调研数据支撑）

## 战略方案
| 策略方向 | 具体措施 | 目标成果 | 负责方 | 优先级 | 数据依据 |
|---------|---------|---------|--------|--------|---------|

## 详细行动计划
| 序号 | 行动项 | 负责人/团队 | 建议时间 | 交付物 |
|-----|--------|-----------|---------|--------|

## 风险管理
基于辩论阶段暴露的实际问题：
| 风险描述 | 概率 | 影响程度 | 缓解措施 | 来源 |
|---------|------|---------|---------|------|

（有数据支撑时可添加：KPI框架、资源预算、治理机制。各章节篇幅与可用证据成正比——证据充分详写，不足简写并标注）

## 数据可信度声明
文档末尾必须包含：
- **已验证数据**：列出引用编号和来源
- **推算数据**：列出推算依据
- **待补充数据**：列出具体缺口

## 参考文献
仅列出正文中实际引用的参考来源，格式：[编号] 标题 — URL

⚠️ **禁止事项**：
- 禁止占位符 [Your Name]、TBD、待定
- 禁止"基于行业常识推算"出精确数字——没有来源的数字标注 [需补充实际数据]
- 禁止编造参考文献
- 禁止出现模板提示语（如"具体填写"、"请在此填入"）`,
    };

    let prompt = `# 策划任务: ${planName}\n\n`;
    prompt += `**当前日期**: ${currentDate}\n\n`;
    prompt += `**策划目标**: ${goal}\n\n`;
    prompt += `**当前阶段**: 第 ${phase} 阶段 — ${phaseName}\n\n`;
    prompt += `**你的角色**: ${agentName} — ${agentRole}\n\n`;
    prompt += `**深度要求**: ${depthInstruction}\n\n`;
    prompt += `**任务指令**: ${phaseInstructions[phase] || "请完成本阶段的工作。"}\n\n`;

    // Inject web search results for Research phase
    if (phase === 2 && searchContext) {
      prompt += `---\n\n## 实时搜索资料\n\n${searchContext}\n\n---\n\n`;
    }

    // Inject numbered reference list for Phase 5 (Synthesis) and Phase 6 (Delivery)
    if ((phase === 5 || phase === 6) && meta.references?.length) {
      const refList = meta.references
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title} — ${r.url}${r.sourceType ? ` (${r.sourceType})` : ""}`,
        )
        .join("\n");
      prompt += `---\n\n## 可引用的参考资料\n\n以下是调研阶段收集的参考资料，请在正文中使用 [编号] 格式引用（如 [1]、[2]）：\n\n${refList}\n\n---\n\n`;
    }

    // Inject verified data points for Phase 5/6
    if (phase >= 5 && meta.verifiedDataPoints?.length) {
      const dataPointsList = meta.verifiedDataPoints
        .map(
          (dp, i) =>
            `${i + 1}. ${dp.claim} — 来源: ${dp.sourceRef}, 可信度: ${dp.confidence}`,
        )
        .join("\n");
      prompt += `---\n\n## 已验证数据点（调研阶段确认）\n\n以下数据经调研验证，可在文档中直接使用：\n${dataPointsList}\n\n⚠️ 文档中使用的数据必须来自上述清单，或明确标注为"推算/估算"。\n\n---\n\n`;
    }

    if (previousContext) {
      prompt += `---\n\n${previousContext}\n\n---\n\n`;
    }

    // Universal anti-fabrication constraint for all phases
    prompt += `\n⚠️ **通用准则**：不要编造具体数据、统计数字或引用来源。如果没有实际数据支撑，请使用定性分析（如"较高/中等/较低"），并明确标注为推断而非事实。\n\n`;

    prompt += `请以 Markdown 格式输出你的分析和成果。`;

    return prompt;
  }

  /**
   * Build a refinement prompt for Phase 5 (Synthesis) subsequent agents.
   * The agent deepens the synthesis — adding analytical depth, data references,
   * and expression quality — while preserving access to previous phase context.
   */
  private buildSynthesisRefinementPrompt(
    meta: PlanningTopicMetadata,
    agentName: string,
    agentRole: string,
    planName: string,
    previousDraft: string,
    previousContext: string,
  ): string {
    const goal = meta.planConfig.goal;
    const currentDate = new Date().toISOString().split("T")[0];

    let prompt = `# 策划任务: ${planName}\n\n`;
    prompt += `**当前日期**: ${currentDate}\n\n`;
    prompt += `**策划目标**: ${goal}\n\n`;
    prompt += `**你的角色**: ${agentName} — ${agentRole}\n\n`;
    prompt += `**任务指令**: 以下是本阶段前一位成员撰写的综合方案初稿。请基于你的专业视角（${agentRole}）对方案进行深化和完善。\n\n`;
    prompt += `**你的具体任务**：\n`;
    prompt += `- 检查方案的分析深度是否足够，补充遗漏的关键维度\n`;
    prompt += `- 验证推荐方案是否有充分的调研数据支撑，补充 [编号] 引用\n`;
    prompt += `- 检查风险评估是否全面，补充遗漏的风险点\n`;
    prompt += `- 确保关键发现和推荐方案之间有清晰的逻辑链条\n`;
    prompt += `- 优化语言表达的专业性和清晰度\n\n`;
    prompt += `**注意**：保持综合方案的结构框架（执行摘要、关键发现、推荐方案、风险评估），在此基础上深化内容，不要改变为交付文档的10章节格式。\n\n`;

    // Inject reference list so the agent can add citations
    if (meta.references?.length) {
      const refList = meta.references
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title} — ${r.url}${r.sourceType ? ` (${r.sourceType})` : ""}`,
        )
        .join("\n");
      prompt += `---\n\n## 可引用的参考资料\n\n以下是调研阶段收集的参考资料，请在正文中使用 [编号] 格式引用：\n\n${refList}\n\n`;
    }

    // Inject verified data points
    if (meta.verifiedDataPoints?.length) {
      const dataPointsList = meta.verifiedDataPoints
        .map(
          (dp, i) =>
            `${i + 1}. ${dp.claim} — 来源: ${dp.sourceRef}, 可信度: ${dp.confidence}`,
        )
        .join("\n");
      prompt += `---\n\n## 已验证数据点\n\n以下数据经调研验证，可直接使用：\n${dataPointsList}\n\n`;
    }

    // Inject previous phase context so the agent can reference research data and debate conclusions
    if (previousContext) {
      prompt += `---\n\n${previousContext}\n\n`;
    }

    prompt += `---\n\n## 待深化的综合方案\n\n${previousDraft}\n\n---\n\n`;
    prompt += `请输出完整的深化后方案（Markdown 格式），直接输出最终版本，不要输出修改说明。`;

    return prompt;
  }

  /**
   * Build a refinement prompt for Phase 6 (Delivery) subsequent agents.
   * The agent polishes the previous draft into a single cohesive formal document
   * suitable for C-level review.
   */
  private buildDeliveryRefinementPrompt(
    meta: PlanningTopicMetadata,
    agentName: string,
    agentRole: string,
    planName: string,
    previousDraft: string,
  ): string {
    const goal = meta.planConfig.goal;
    const currentDate = new Date().toISOString().split("T")[0];

    let prompt = `# 策划任务: ${planName}\n\n`;
    prompt += `**当前日期**: ${currentDate}\n\n`;
    prompt += `**策划目标**: ${goal}\n\n`;
    prompt += `**你的角色**: ${agentName} — ${agentRole}\n\n`;
    prompt += `**任务指令**: 以下是策划总监撰写的策划文档初稿。你的审查任务（严格按优先级）：\n\n`;
    prompt += `**一、数据真实性审查（最高优先级）**：\n`;
    prompt += `- 逐个检查每个数字——有来源标注 [编号]？没有则标注 [需补充来源]\n`;
    prompt += `- 检查推荐行动——能追溯到调研发现？不能则标注 [需补充依据]\n`;
    prompt += `- 检查逻辑链——发现→洞察→策略→行动 是否连贯？\n\n`;
    prompt += `**二、占位符消除**：\n`;
    prompt += `- [Your Name]、[公司名]、TBD、待定 → 替换为具体角色名称\n`;
    prompt += `- 空白表格单元格 → 必须填入具体内容\n`;
    prompt += `- 模糊表述如"显著提升"→ 若有数据支撑则替换为具体数值并标注来源，否则保留定性描述\n\n`;
    prompt += `**三、语言与格式优化**：\n`;
    prompt += `- 优化语言表达，使其专业、严谨、简洁\n`;
    prompt += `- 确保数据引用 [编号] 准确保留\n`;
    prompt += `- 确保"数据可信度声明"章节完整\n\n`;
    prompt += `**严禁行为**：\n`;
    prompt += `- 禁止把 [需补充] 标记替换为编造的数字\n`;
    prompt += `- 禁止把定性描述替换为没来源的定量描述\n`;
    prompt += `- 禁止删除"数据缺失"或"待确认"等诚实标注\n`;
    prompt += `- 禁止添加原始分析中不存在的新数据\n\n`;

    // Inject reference list so the agent can verify citations
    if (meta.references?.length) {
      const refList = meta.references
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title} — ${r.url}${r.sourceType ? ` (${r.sourceType})` : ""}`,
        )
        .join("\n");
      prompt += `---\n\n## 可引用的参考资料\n\n${refList}\n\n`;
    }

    // Inject verified data points for quality checking
    if (meta.verifiedDataPoints?.length) {
      const dataPointsList = meta.verifiedDataPoints
        .map(
          (dp, i) =>
            `${i + 1}. ${dp.claim} — 来源: ${dp.sourceRef}, 可信度: ${dp.confidence}`,
        )
        .join("\n");
      prompt += `---\n\n## 已验证数据点\n\n文档中使用的数据必须来自以下清单或标注为推算/估算：\n${dataPointsList}\n\n`;
    }

    prompt += `---\n\n## 待审查的初稿\n\n${previousDraft}\n\n---\n\n`;
    prompt += `请输出完整的审查优化后文档（Markdown 格式），不要输出修改说明或对比，直接输出最终版本。`;

    return prompt;
  }

  private getTaskProfileForPhase(
    phase: number,
    depth: PlanningDepth,
  ): TaskProfile {
    const outputLength =
      depth === PlanningDepth.QUICK
        ? ("medium" as const)
        : depth === PlanningDepth.COMPREHENSIVE
          ? ("extended" as const)
          : ("long" as const);

    // Phase 3: brainstorm needs creativity; Phase 6: formal document needs structure
    const creativity =
      phase === 3
        ? ("high" as const) // brainstorm
        : phase === 6
          ? ("low" as const) // formal delivery document
          : phase === 4
            ? ("medium" as const) // debate
            : ("medium" as const); // analysis, synthesis

    return { creativity, outputLength };
  }

  // ==================== Export & Delete ====================

  async exportPlan(
    planId: string,
    userId: string,
    mode: "report" | "full" = "report",
  ): Promise<string> {
    const plan = await this.getPlanDetail(planId, userId);
    const phases = plan.phaseStatus;

    if (mode === "report") {
      // 仅导出 Phase 6 交付报告
      const phase6 = phases[TOTAL_PHASES];
      if (phase6?.status === "completed" && phase6.summary) {
        return `# ${plan.name}\n\n> ${plan.goal}\n\n---\n\n${phase6.summary}`;
      }
      return `# ${plan.name}\n\n> ${plan.goal}\n\n_Report not yet available._`;
    }

    // full 模式：所有已完成阶段 + Agent 信息 + 参考文献
    let markdown = `# ${plan.name}\n\n`;
    markdown += `> **策划目标**: ${plan.goal}\n`;
    markdown += `> **深度**: ${plan.depth || "STANDARD"}\n`;
    markdown += `> **导出时间**: ${new Date().toISOString().split("T")[0]}\n\n`;
    markdown += `---\n\n`;

    for (let i = 1; i <= TOTAL_PHASES; i++) {
      const status = phases[i];
      if (status?.status !== "completed" || !status.summary) continue;

      const agentIndices = PHASE_AGENT_INDICES[i] || [];
      const agentNames = agentIndices
        .map((idx) => plan.members?.[idx]?.displayName)
        .filter(Boolean);

      markdown += `## 阶段 ${i}: ${PHASE_LABELS[i]}\n\n`;
      markdown += `**状态**: 已完成`;
      if (status.completedAt) {
        markdown += ` | **完成时间**: ${status.completedAt}`;
      }
      markdown += "\n";
      if (agentNames.length > 0) {
        markdown += `**参与 Agent**: ${agentNames.join(", ")}\n`;
      }
      markdown += "\n";
      markdown += `${status.summary}\n\n---\n\n`;
    }

    // 参考文献
    const refs = plan.references;
    if (refs && refs.length > 0) {
      markdown += `## 参考文献\n\n`;
      refs.forEach(
        (
          ref: {
            title?: string;
            url?: string;
            domain?: string;
            sourceType?: string;
            credibilityScore?: number;
          },
          idx: number,
        ) => {
          markdown += `[${idx + 1}] ${ref.title || "Untitled"}`;
          if (ref.domain) markdown += ` — ${ref.domain}`;
          if (ref.sourceType) markdown += ` (${ref.sourceType})`;
          if (ref.url) markdown += ` ${ref.url}`;
          markdown += "\n";
        },
      );
    }

    return markdown;
  }

  async deletePlan(planId: string, userId: string): Promise<void> {
    const topic = await this.prisma.topic.findFirst({
      where: {
        id: planId,
        createdById: userId,
        metadata: { path: ["planningMode"], equals: true },
      },
    });

    if (!topic) {
      throw new NotFoundException("Plan not found");
    }

    await this.prisma.topic.update({
      where: { id: planId },
      data: { archivedAt: new Date() },
    });

    this.logger.log(`Plan ${planId} archived`);
  }

  // ==================== Web Search for Research Phase ====================

  /**
   * Search the web for real-time data related to the planning goal.
   * Generates multiple search queries, executes them via AIFacade,
   * and stores results as references in the plan metadata.
   */
  private async searchForResearchPhase(
    goal: string,
    planName: string,
    planId: string,
    phase: number,
  ): Promise<{ context: string }> {
    try {
      // Generate diverse search queries from the goal (LLM-powered with fallback)
      const queries = await this.generateSearchQueries(goal, planName);
      this.logger.log(
        `Research phase: searching ${queries.length} queries for plan ${planId}`,
      );

      const allResults: PlanReference[] = [];
      const seenUrls = new Set<string>();

      for (const query of queries) {
        try {
          const searchResponse = await this.ragFacade.search({
            query,
            maxResults: 8,
          });

          if (searchResponse.success && searchResponse.results?.length > 0) {
            for (const result of searchResponse.results) {
              if (seenUrls.has(result.url)) continue;
              seenUrls.add(result.url);

              const domain = result.domain || new URL(result.url).hostname;
              const sourceType = this.classifySourceType(domain);
              const credibilityScore = this.calculateCredibilityScore({
                domain,
                snippet: result.content,
                publishedDate: result.publishedDate,
                sourceType,
              });

              allResults.push({
                id: `ref-${allResults.length + 1}`,
                title: result.title,
                url: result.url,
                domain,
                snippet: result.content,
                publishedDate: result.publishedDate,
                score: result.score,
                credibilityScore,
                sourceType,
                sourcePhase: phase,
              });
            }
          }
        } catch (err) {
          this.logger.warn(
            `Search query failed: "${query}" — ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      if (allResults.length === 0) {
        this.logger.warn(`No search results for plan ${planId}`);
        return { context: "" };
      }

      // Store references in metadata
      const topic = await this.prisma.topic.findFirst({
        where: { id: planId },
      });
      if (topic) {
        const meta =
          (topic.metadata as unknown as PlanningTopicMetadata) ||
          ({} as PlanningTopicMetadata);

        const updatedMetadata: PlanningTopicMetadata = {
          ...meta,
          references: allResults,
        };

        await this.prisma.topic.update({
          where: { id: planId },
          data: {
            metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
          },
        });
      }

      this.logger.log(
        `Research phase: collected ${allResults.length} references for plan ${planId}`,
      );

      // Format for prompt context
      const context = allResults
        .map(
          (r, i) =>
            `[${i + 1}] **${r.title}**\n${r.snippet}\n来源: ${r.url}${r.publishedDate ? ` (${r.publishedDate})` : ""}`,
        )
        .join("\n\n");

      return { context };
    } catch (error) {
      this.logger.error(
        `Research phase search failed: ${error instanceof Error ? error.message : error}`,
      );
      return { context: "" };
    }
  }

  /**
   * Generate diverse search queries using LLM for better coverage.
   * Falls back to deterministic approach on failure.
   */
  private async generateSearchQueries(
    goal: string,
    planName: string,
  ): Promise<string[]> {
    try {
      const currentYear = new Date().getFullYear();
      const prompt = `You are a search query generator. Given a planning goal, generate exactly 6 targeted web search queries that cover different angles of the topic. Each query should be specific and actionable.

Planning topic: ${planName}
Planning goal: ${goal}
Current year: ${currentYear}

Requirements:
- Query 1: Current trends and market dynamics
- Query 2: Key data, statistics, or research reports
- Query 3: Real-world case studies or best practices
- Query 4: Challenges, risks, or competitive landscape
- Query 5: Quantitative data — market size, growth rate, statistics
- Query 6: Expert analysis, industry outlook, and emerging challenges

Return ONLY a JSON array of 6 strings, no other text. Example:
["query 1", "query 2", "query 3", "query 4", "query 5", "query 6"]`;

      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "low" as const,
          outputLength: "minimal" as const,
        },
      });

      if (!response.isError && response.content) {
        const jsonMatch = response.content.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const queries = JSON.parse(jsonMatch[0]) as string[];
          if (
            Array.isArray(queries) &&
            queries.length >= 2 &&
            queries.every((q) => typeof q === "string")
          ) {
            this.logger.log(
              `LLM generated ${queries.length} search queries for plan`,
            );
            return queries.slice(0, 6);
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `LLM query generation failed, falling back to deterministic: ${err instanceof Error ? err.message : err}`,
      );
    }

    return this.generateSearchQueriesFallback(goal, planName);
  }

  /**
   * Deterministic fallback for search query generation.
   */
  private generateSearchQueriesFallback(
    goal: string,
    planName: string,
  ): string[] {
    const queries: string[] = [];
    const currentYear = new Date().getFullYear();

    queries.push(`${planName} ${currentYear}`);

    const goalKeywords = goal
      .replace(/[，。、；：！？\s]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 1)
      .slice(0, 6);

    if (goalKeywords.length >= 2) {
      queries.push(
        `${goalKeywords.slice(0, 3).join(" ")} 行业趋势 ${currentYear}`,
      );
      queries.push(`${goalKeywords.slice(0, 3).join(" ")} 数据报告 最新`);
    }

    if (goal.length <= 80) {
      queries.push(goal);
    } else {
      queries.push(goal.slice(0, 80));
    }

    // Additional quantitative and expert queries
    if (goalKeywords.length >= 2) {
      queries.push(
        `${goalKeywords.slice(0, 3).join(" ")} 市场规模 数据 统计 报告`,
      );
      queries.push(`${goalKeywords.slice(0, 3).join(" ")} 专家分析 挑战 趋势`);
    }

    return queries.slice(0, 6);
  }

  // ==================== Credibility Scoring ====================

  /**
   * Classify source type based on domain patterns.
   * Mirrors the algorithm from evidence-management.service.ts.
   */
  private classifySourceType(domain: string): string {
    const d = domain.toLowerCase();

    // Academic
    if (
      d.includes("arxiv.org") ||
      d.includes("scholar.google") ||
      d.includes("pubmed") ||
      d.includes("doi.org") ||
      d.includes("researchgate") ||
      d.includes("springer.com") ||
      d.includes("nature.com") ||
      d.includes("sciencedirect") ||
      d.includes("ieee.org") ||
      d.includes("acm.org") ||
      d.includes(".edu")
    ) {
      return "academic";
    }

    // Official / Government (specific domains only — broad .org would misclassify wikipedia, mozilla, etc.)
    if (
      d.includes(".gov") ||
      d.includes("who.int") ||
      d.includes("worldbank.org") ||
      d.includes("un.org") ||
      d.includes("europa.eu") ||
      d.includes("imf.org") ||
      d.includes("oecd.org") ||
      d.includes("wto.org")
    ) {
      return "official";
    }

    // News
    if (
      d.includes("reuters.com") ||
      d.includes("bloomberg.com") ||
      d.includes("bbc.com") ||
      d.includes("nytimes.com") ||
      d.includes("wsj.com") ||
      d.includes("ft.com") ||
      d.includes("economist.com") ||
      d.includes("cnbc.com") ||
      d.includes("theguardian.com") ||
      d.includes("apnews.com") ||
      d.includes("xinhua") ||
      d.includes("chinadaily")
    ) {
      return "news";
    }

    // Reports / Consulting
    if (
      d.includes("mckinsey.com") ||
      d.includes("bcg.com") ||
      d.includes("bain.com") ||
      d.includes("deloitte.com") ||
      d.includes("pwc.com") ||
      d.includes("kpmg.com") ||
      d.includes("ey.com") ||
      d.includes("gartner.com") ||
      d.includes("forrester.com") ||
      d.includes("idc.com") ||
      d.includes("statista.com")
    ) {
      return "report";
    }

    return "web";
  }

  /**
   * Calculate credibility score (20-100) using 4-factor algorithm.
   * Mirrors the algorithm from evidence-management.service.ts.
   */
  private calculateCredibilityScore(ref: {
    domain: string;
    snippet: string;
    publishedDate?: string;
    sourceType: string;
  }): number {
    const d = ref.domain.toLowerCase();

    // Factor 1: Domain authority (0-40)
    let domainAuthority = 15;
    if (
      d.includes(".gov") ||
      d.includes(".edu") ||
      d.includes("arxiv.org") ||
      d.includes("pubmed") ||
      d.includes("nature.com") ||
      d.includes("sciencedirect")
    ) {
      domainAuthority = 40;
    } else if (
      d.includes("reuters.com") ||
      d.includes("bloomberg.com") ||
      d.includes("mckinsey.com") ||
      d.includes("bcg.com") ||
      d.includes("gartner.com") ||
      d.includes("who.int") ||
      d.includes("worldbank.org")
    ) {
      domainAuthority = 30;
    } else if (
      d.includes("techcrunch.com") ||
      d.includes("forbes.com") ||
      d.includes("wired.com") ||
      d.includes("bbc.com") ||
      d.includes("nytimes.com") ||
      d.includes("wsj.com") ||
      d.includes("economist.com") ||
      d.includes("ft.com") ||
      d.includes("cnbc.com") ||
      d.includes("statista.com")
    ) {
      domainAuthority = 22;
    }

    // Factor 2: Source type (0-30)
    const sourceTypeScores: Record<string, number> = {
      academic: 30,
      official: 28,
      news: 22,
      report: 20,
      web: 15,
    };
    const sourceTypeScore = sourceTypeScores[ref.sourceType] || 15;

    // Factor 3: Content depth (0-15)
    const contentLength = ref.snippet?.length || 0;
    let contentDepth = 0;
    if (contentLength > 500) contentDepth = 15;
    else if (contentLength > 200) contentDepth = 10;
    else if (contentLength > 50) contentDepth = 5;

    // Factor 4: Freshness (0-15)
    let freshness = 5;
    if (ref.publishedDate) {
      try {
        const pubDate = new Date(ref.publishedDate);
        const now = new Date();
        const daysDiff =
          (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24);

        if (daysDiff <= 30) freshness = 15;
        else if (daysDiff <= 180) freshness = 12;
        else if (daysDiff <= 365) freshness = 8;
        else if (daysDiff <= 730) freshness = 5;
        else freshness = 3;
      } catch {
        freshness = 5;
      }
    }

    const total = domainAuthority + sourceTypeScore + contentDepth + freshness;
    return Math.max(20, Math.min(100, total));
  }

  // ==================== Quality Gate Helpers ====================

  /**
   * Extract verified data points from Phase 2 research output using CHAT_FAST.
   * Stores them in metadata for use in Phase 5/6 prompts.
   */
  private async extractVerifiedDataPoints(
    planId: string,
    researchOutput: string,
  ): Promise<void> {
    try {
      const extractPrompt = `从以下调研报告中提取所有有来源引用的数据点。

调研报告：
${researchOutput.substring(0, 12000)}

请以 JSON 数组格式输出，每个数据点包含：
- claim: 数据声明（如"中国AI市场2025年规模达XXX亿"）
- sourceRef: 来源引用编号（如"[3]"）
- confidence: 可信度（"high"=权威来源+有数据支撑, "medium"=可信来源+定性判断, "low"=单一来源+推测性）

只提取有明确 [编号] 引用的数据点，没有引用的不要提取。
返回 JSON 数组，无其他文字。示例：
[{"claim": "某数据", "sourceRef": "[1]", "confidence": "high"}]`;

      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: extractPrompt }],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: {
          creativity: "deterministic" as const,
          outputLength: "medium" as const,
        },
      });

      if (!response.isError && response.content) {
        const jsonMatch = response.content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const dataPoints = JSON.parse(jsonMatch[0]) as VerifiedDataPoint[];
          if (Array.isArray(dataPoints) && dataPoints.length > 0) {
            // Store in metadata
            const topic = await this.prisma.topic.findFirst({
              where: { id: planId },
            });
            if (topic) {
              const meta =
                (topic.metadata as unknown as PlanningTopicMetadata) ||
                ({} as PlanningTopicMetadata);
              const updatedMetadata: PlanningTopicMetadata = {
                ...meta,
                verifiedDataPoints: dataPoints.slice(0, 30),
              };
              await this.prisma.topic.update({
                where: { id: planId },
                data: {
                  metadata: updatedMetadata as unknown as Prisma.InputJsonValue,
                },
              });
              this.logger.log(
                `Extracted ${dataPoints.length} verified data points for plan ${planId}`,
              );
            }
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to extract verified data points: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Get quality evaluation dimensions for each phase.
   */
  private getQualityDimensions(phase: number): string[] {
    const dimensionMap: Record<number, string[]> = {
      1: [
        "子问题是否具体可回答？而非空泛的大问题",
        "是否识别了信息缺口？明确标注了需要调研的领域",
        "分析维度是否符合MECE原则？",
      ],
      2: [
        "是否有 [编号] 来源引用？每个关键论点需有出处",
        "是否区分了事实和推断？标注了可信度",
        "信息缺口是否诚实标注？而非用模糊语言绕过",
      ],
      3: [
        "战略方向之间是否有实质差异？不是换个说法的同一方案",
        "每个方向的优劣势分析是否基于调研数据？",
        "是否包含至少一个非常规方向？",
      ],
      4: [
        "反方是否提出了实质性质疑？而非泛泛的'可能有风险'",
        "正方是否用调研数据回应质疑？而非空洞的保证",
        "辩论结论是否基于论据强弱，而非偏向性总结？",
      ],
      5: [
        "推荐方案是否可追溯到调研数据？每个推荐有 [编号] 引用",
        "是否有新编造的内容？综合阶段不应出现调研中没有的数据",
        "是否包含'关键假设'和'待验证问题'章节？",
      ],
      6: [
        "所有数字是否可追溯？有 [编号] 引用或标注为推算/估算",
        "是否存在未标注来源的编造数据？如凭空出现的百分比或金额",
        "文档末尾是否有数据可信度声明？",
      ],
    };
    return dimensionMap[phase] || [];
  }

  // ==================== Model Allocation (Fix 1) ====================

  private async buildAIMembers(depth: PlanningDepth) {
    // Get reasoning model for leader/analyst
    const reasoningModel = await this.chatFacade.getReasoningModel();

    // Get available chat models
    const chatModels = await this.chatFacade.getAvailableModelsExtended(
      AIModelType.CHAT,
    );
    const availableChatModels = chatModels.filter(
      (m) => m.isAvailable !== false,
    );

    const leaderModelId =
      reasoningModel?.id || availableChatModels[0]?.id || "";
    const chatModelId = availableChatModels[0]?.id || "";

    this.logger.log(
      `Model allocation: reasoning=${leaderModelId}, chat=${chatModelId}`,
    );

    const resolveModel = (displayName: string): string => {
      const modelType = ROLE_MODEL_TYPE[displayName] || "chat";
      return modelType === "reasoning" ? leaderModelId : chatModelId;
    };

    const base = [
      {
        aiModel: resolveModel("策划总监"),
        displayName: "策划总监",
        roleDescription: "结构化思考，拆解问题，整合方案",
        systemPrompt: `你是策划总监。你的独占职责是结构化思考：
- 拆解问题时必须用 MECE 原则，给出明确的分析维度
- 每个分析结论必须说明"依据是什么"——来自调研数据[编号]还是逻辑推理
- 当信息不足时，你必须明确标注"此处需要更多数据"，而不是用模糊语言绕过
- 根据不同阶段的要求调整输出——前期重分析和洞察，后期重方案和执行

你的禁区：
- 禁止编造任何数据或统计数字
- 禁止做文档润色工作（那是文案专家的事）
- 禁止代替研究员做调研分析
- 不要在分析阶段就输出执行方案`,
      },
      {
        aiModel: resolveModel("研究员"),
        displayName: "研究员",
        roleDescription: "处理外部数据，整理调研发现",
        systemPrompt: `你是研究员。你的唯一职责是处理外部数据：
- 你的每一个论点都必须附带 [编号] 来源引用
- 对于每条发现，标注可信度：高（权威来源+有数据支撑）/ 中（可信来源+定性判断）/ 低（单一来源+推测性）
- 当搜索结果中没有某方面的数据时，你必须写"该方面暂无可靠数据"

你的禁区：
- 严禁提出战略建议或行动方案——你只呈现事实
- 严禁编造引用来源、报告名称或数据
- 严禁在没有来源的情况下给出任何具体数字`,
      },
      {
        aiModel: resolveModel("分析师"),
        displayName: "分析师",
        roleDescription: "定量分析，用数字说话",
        systemPrompt: `你是定量分析师。你的独占职责是用数字说话：
- 对其他成员的每个定性判断，追问"数字是多少？"
- 做竞争对比、成本效益、敏感性分析
- 当没有定量数据时，明确写"无定量数据，以下为定性评估"

你的禁区：
- 禁止做纯文字性的定性分析（那是总监的事）
- 禁止编造数字——没有数据就写"数据缺失"
- 禁止做文档格式优化`,
      },
      {
        aiModel: resolveModel("文案专家"),
        displayName: "文案专家",
        roleDescription: "文档质检，发现问题而非掩盖问题",
        systemPrompt: `你是文档质检专家。你的职责不是"让文档更好看"，而是：
- 找出文档中每个没有来源标注的数字，标注为 [需补充来源]
- 找出推荐行动与调研发现之间的逻辑断裂
- 找出前后矛盾的内容
- 最后才做语言优化

你的禁区：
- 严禁把 [需补充] 标记替换为编造的数字
- 严禁添加原始分析中不存在的新数据
- 严禁删除"数据缺失"或"待确认"等诚实标注`,
      },
    ];

    if (depth === PlanningDepth.COMPREHENSIVE) {
      base.push(
        {
          aiModel: resolveModel("正方辩手"),
          displayName: "正方辩手",
          roleDescription: "用数据和案例支持方案",
          systemPrompt: `你是正方辩手。你的职责是为策划方案辩护：
- 必须引用调研阶段的数据 [编号] 支持你的论点，不能只用"一般来说"
- 每个论点必须有具体案例或数据支撑
- 如果某个方向缺乏数据支持，诚实承认"该方向数据支持较弱"

你的禁区：
- 禁止编造支持案例或数据
- 禁止用模糊的"行业普遍认为"替代具体引用`,
        },
        {
          aiModel: resolveModel("反方辩手"),
          displayName: "反方辩手",
          roleDescription: "质疑方案，找出数据缺口和逻辑漏洞",
          systemPrompt: `你是反方辩手。你的职责是找出方案的致命弱点：
- 必须指出具体的数据缺口和逻辑漏洞，不能只说"可能有风险"
- 对每个推荐方案，追问：数据够不够？假设成立吗？最坏情况是什么？
- 如果正方的论点没有数据支撑，明确指出"此论点缺乏数据"

你的禁区：
- 禁止泛泛而谈的质疑——每个反对意见必须具体
- 禁止编造反面数据来否定方案`,
        },
      );
    }

    return base;
  }
}
