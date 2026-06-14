/**
 * TeamFacade — Domain Facade for Team Missions, A2A, Voting, Evidence, and Skills
 *
 * Responsibilities:
 * - Team mission lifecycle (start, stream, cancel, status)
 * - Skill execution and input binding
 * - A2A message bus operations
 * - Reflection and context compression
 * - Evidence and voting management
 * - Report sanitization
 *
 * @Injectable — registered as a NestJS provider in facade.providers.ts
 */

import { Injectable, Logger, Optional, Inject } from "@nestjs/common";
import { TeamSubFacade } from "../sub-facades/team.sub-facade";
import type {
  TeamsFeature,
  CollaborationFeature,
  SkillFeature,
  IntelligenceFeature,
  RegistryFeature,
} from "../facade.providers";
import {
  TEAMS_FEATURE,
  COLLABORATION_FEATURE,
  SKILL_FEATURE,
  INTELLIGENCE_FEATURE,
  REGISTRY_FEATURE,
} from "../facade.providers";
import type {
  MissionInput,
  MissionResult,
  ProgressCallback,
  TeamType,
  TeamConfig,
} from "../types";
import type {
  CreateMissionDto,
  MissionStatus,
} from "../../teams/services/teams.service";
import type { MissionEvent } from "../../agents/abstractions/mission.types";
import type {
  ISkill,
  SkillContext,
  SkillResult,
} from "../../../ai-engine/skills/abstractions/skill.interface";
import type { BindingContext } from "../../../ai-engine/skills/integration/binding/skill-input-binding-resolver.service";
import type { PromptSkillAdapter } from "../../../ai-engine/skills/integration/adapters/prompt-skill.adapter";
import type { ToolPipeline } from "../../../ai-engine/tools/middleware/tool-pipeline";
import { AiChatLLMAdapter } from "../../../ai-engine/llm/adapters/ai-chat-llm.adapter";
import type {
  A2AMessageType,
  A2APriority,
  A2AMessage,
} from "../../protocols/ipc/abstractions/a2a-message.types";
import type {
  ReflectionInput,
  ReflectionResult,
  ReflectionConfig,
} from "../../../ai-engine/planning/reflection/reflection.service";
import type {
  CompressionOptions,
  CompressionResult,
} from "../../../ai-harness/runner/executor/executor.types";
import type { SaveEvidenceRequest } from "../../../ai-engine/knowledge/evidence/abstractions/evidence.interface";
import type { VotingSession } from "../../teams/collaboration/patterns/voting-pattern";
import type {
  VoteRequest,
  VoteResult,
} from "../../teams/collaboration/abstractions/collaborator.interface";
import type { SkillMdDefinition } from "../../../ai-engine/skills/types/skill-md.types";
import { TeamsService } from "../../teams/services/teams.service";
import { TeamFactory } from "../../teams/factory/team-factory";
import { ContextInitializationService } from "../../../ai-engine/knowledge/world-building/context-initialization.service";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../../teams/orchestrator/teams-mission-orchestrator";
import { TeamRegistry } from "../../teams/registry/team-registry";
import { RoleRegistry } from "../../teams/registry/role-registry";
import { SkillRegistry } from "../../../ai-engine/skills/registry/skill.registry";

@Injectable()
export class TeamFacade {
  private readonly logger = new Logger(TeamFacade.name);

  private readonly teamSub: TeamSubFacade;

  constructor(
    @Optional()
    @Inject(TEAMS_FEATURE)
    private readonly teamsFeature?: TeamsFeature,
    @Optional()
    @Inject(COLLABORATION_FEATURE)
    private readonly collaboration?: CollaborationFeature,
    @Optional()
    @Inject(SKILL_FEATURE)
    private readonly skills?: SkillFeature,
    @Optional()
    @Inject(INTELLIGENCE_FEATURE)
    private readonly intelligence?: IntelligenceFeature,
    @Optional()
    @Inject(REGISTRY_FEATURE)
    private readonly registry?: RegistryFeature,
  ) {
    this.teamSub = new TeamSubFacade(teamsFeature?.teamsService);
  }

  // ==================== Team Mission ====================

  async startTeamMission(request: {
    teamType: TeamType | string;
    teamConfig?: TeamConfig;
    missionInput: MissionInput;
    progressCallback?: ProgressCallback;
  }): Promise<MissionResult> {
    return this.teamSub.startTeamMission(request);
  }

  async *executeMissionStream(
    dto: CreateMissionDto,
  ): AsyncGenerator<MissionEvent> {
    yield* this.teamSub.executeMissionStream(dto);
  }

  cancelMission(missionId: string): boolean {
    return this.teamSub.cancelMission(missionId);
  }

  getMissionStatus(missionId: string): MissionStatus | null {
    return this.teamSub.getMissionStatus(missionId);
  }

  // ==================== Skill Execution ====================

  async executeSkill(
    skill: ISkill,
    input: unknown,
    context: SkillContext,
  ): Promise<SkillResult> {
    const hasSetLLMAdapter =
      "setLLMAdapter" in skill &&
      typeof (skill as { setLLMAdapter: unknown }).setLLMAdapter === "function";

    if (hasSetLLMAdapter) {
      if (this.skills?.llmAdapter) {
        (
          skill as { setLLMAdapter: (a: AiChatLLMAdapter) => void }
        ).setLLMAdapter(this.skills.llmAdapter);
      } else {
        this.logger.warn(
          `[executeSkill] Skill "${context.skillId}" expects LLM adapter but llmAdapter is not available — execution may fail`,
        );
      }
    }
    // 2026-05-01 (PR-X-R): inject ToolPipeline if skill supports it
    const hasSetToolPipeline =
      "setToolPipeline" in skill &&
      typeof (skill as { setToolPipeline: unknown }).setToolPipeline ===
        "function";
    if (hasSetToolPipeline && this.skills?.toolPipeline) {
      (skill as { setToolPipeline: (p: ToolPipeline) => void }).setToolPipeline(
        this.skills.toolPipeline,
      );
    }
    return skill.execute(input, context);
  }

  resolveSkillInputBindings(
    skill: ISkill,
    bindingContext: BindingContext,
  ): Record<string, unknown> | null {
    const adapter = skill as PromptSkillAdapter;
    if (!adapter.isPromptSkillAdapter) {
      return null;
    }
    const bindings = adapter.getInputBindings();
    if (!bindings || !this.skills?.inputBindingResolver) {
      return null;
    }
    return this.skills.inputBindingResolver.resolve(bindings, bindingContext);
  }

  /** P1 (2026-05-05): 同 ai.facade — 服务缺失时显式 warn。 */
  skillLoaderGetAll(): SkillMdDefinition[] {
    if (!this.skills?.loader) {
      this.logger.warn(
        "[skillLoaderGetAll] SkillLoaderService unavailable (DI not wired). Returning empty list.",
      );
      return [];
    }
    return this.skills.loader.getAllLoadedSkills() ?? [];
  }

  // ==================== A2A ====================

  a2aPublish<TPayload = unknown>(params: {
    sessionId: string;
    fromAgentId: string;
    toAgentId?: string;
    type: A2AMessageType;
    payload: TPayload;
    priority?: A2APriority;
    replyToId?: string;
    correlationId?: string;
    ttlMs?: number;
  }): Promise<A2AMessage<TPayload>> | undefined {
    return this.collaboration?.a2aBus?.publish(params);
  }

  a2aClearSession(sessionId: string): void {
    this.collaboration?.a2aBus?.clearSession(sessionId);
  }

  // ==================== Reflection & Compression ====================

  reflect(
    input: ReflectionInput,
    config?: ReflectionConfig,
  ): Promise<ReflectionResult> | undefined {
    return this.intelligence?.reflection?.reflect(input, config);
  }

  aiCompressContext(
    content: string,
    options?: CompressionOptions,
  ): Promise<CompressionResult> | undefined {
    return this.intelligence?.contextCompression?.compress(content, options);
  }

  sanitizeReport(text: string): string {
    return this.intelligence?.synthesisEngine?.sanitizeReport(text) ?? text;
  }

  // ==================== Evidence ====================

  evidenceSave(request: SaveEvidenceRequest): Promise<void> | undefined {
    return this.collaboration?.evidenceManager
      ?.save(request)
      .then(() => undefined);
  }

  // ==================== Voting ====================

  votingCreate(request: VoteRequest): VotingSession | undefined {
    return this.collaboration?.votingManager?.createVote(request);
  }

  votingCastVote(sessionId: string, voterId: string, optionId: string): void {
    this.collaboration?.votingManager?.castVote(sessionId, voterId, optionId);
  }

  votingClose(
    sessionId: string,
    totalVoters: number,
  ): VoteResult | null | undefined {
    return this.collaboration?.votingManager?.closeVote(sessionId, totalVoters);
  }

  // ==================== Service Getters ====================

  get teams(): TeamsService | undefined {
    return this.teamsFeature?.teamsService;
  }

  get contextInit(): ContextInitializationService | undefined {
    return this.teamsFeature?.contextInit;
  }

  get teamFactory(): TeamFactory | undefined {
    return this.teamsFeature?.teamFactory;
  }

  get missionOrchestrator(): MissionOrchestrator | undefined {
    return this.teamsFeature?.missionOrchestrator;
  }

  // ==================== Registry Getters ====================

  get teamRegistry(): TeamRegistry | undefined {
    return this.registry?.team;
  }

  get roleRegistry(): RoleRegistry | undefined {
    return this.registry?.role;
  }

  get skillRegistry(): SkillRegistry | undefined {
    return this.registry?.skill;
  }
}
