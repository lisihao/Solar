/**
 * A2A Team Member Adapter
 * 将外部 A2A Agent 包装为 ITeamMember，使其能够加入 GenesisPod Teams
 */

import { Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  ITeamMember,
  TeamMemberId,
  MemberStatus,
} from "../../../teams/abstractions/member.interface";
import type {
  IRole,
  WorkStyle,
} from "../../../teams/abstractions/role.interface";
import type {
  SkillId,
  ToolId,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import { normalizeMarkdownSlug } from "@/modules/ai-engine/content/markdown/slug-normalize.util";
import { A2AAgentCard, A2ATaskStatus } from "../a2a.types";

/**
 * 外部 A2A Agent 角色（用于适配 IRole）
 */
class ExternalA2ARole implements IRole {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type = "member" as const; // A2A agents are always members
  readonly icon?: string;
  readonly coreSkills: SkillId[];
  readonly optionalSkills: SkillId[];
  readonly coreTools: ToolId[];
  readonly optionalTools: ToolId[];
  readonly responsibilities: string[];
  readonly limitations: string[];
  readonly defaultWorkStyle: WorkStyle;
  readonly systemPromptTemplate: string;
  readonly metadata?: Record<string, unknown>;

  constructor(agentCard: A2AAgentCard) {
    this.id = `a2a-${normalizeMarkdownSlug(agentCard.name)}`;
    this.name = agentCard.name;
    this.description = agentCard.description;
    this.icon = undefined;

    // Map A2A skills to SkillId[]
    this.coreSkills = agentCard.skills.map((skill) => skill.id);
    this.optionalSkills = [];

    // External agents manage their own tools
    this.coreTools = [];
    this.optionalTools = [];

    // Derive responsibilities from skills
    this.responsibilities = agentCard.skills.map((skill) => skill.description);

    // External agents cannot be leaders or access internal resources
    this.limitations = [
      "Cannot act as team leader",
      "Cannot access internal GenesisPod resources directly",
      "Communication via A2A protocol only",
    ];

    // Default work style for external agents
    this.defaultWorkStyle = {
      thinkingDepth: "standard",
      outputStyle: "balanced",
      collaborationStyle: "independent", // External agents work independently
      riskTolerance: "conservative",
    };

    this.systemPromptTemplate = agentCard.description;

    this.metadata = {
      provider: agentCard.provider,
      version: agentCard.version,
      url: agentCard.url,
      capabilities: agentCard.capabilities,
    };
  }
}

/**
 * A2A Team Member Adapter
 * 适配器将外部 A2A Agent 包装为 ITeamMember
 */
export class A2ATeamMemberAdapter implements ITeamMember {
  private readonly logger = new Logger(A2ATeamMemberAdapter.name);

  readonly id: TeamMemberId;
  readonly name: string;
  readonly role: IRole;
  readonly model: string;
  readonly skills: SkillId[];
  readonly tools: ToolId[]; // Always empty - external agents manage their own tools
  readonly persona: string;
  readonly workStyle: WorkStyle;
  status: MemberStatus;
  readonly metadata?: Record<string, unknown>;

  private readonly agentCard: A2AAgentCard;

  constructor(
    agentCard: A2AAgentCard,
    options?: {
      id?: TeamMemberId;
      status?: MemberStatus;
    },
  ) {
    this.agentCard = agentCard;

    // Generate or use provided ID
    this.id = options?.id ?? `a2a-member-${randomUUID()}`;

    // Basic properties from agent card
    this.name = agentCard.name;
    this.model = `external-a2a-${agentCard.version}`;

    // Create role from agent card
    this.role = new ExternalA2ARole(agentCard);

    // Map skills from agent card
    this.skills = agentCard.skills.map((skill) => skill.id);

    // External agents manage their own tools
    this.tools = [];

    // Use agent description as persona
    this.persona = agentCard.description;

    // Default work style for external agents
    this.workStyle = {
      thinkingDepth: "standard",
      outputStyle: "balanced",
      collaborationStyle: "independent",
      riskTolerance: "conservative",
    };

    // Initial status
    this.status = options?.status ?? "idle";

    // Store agent card metadata
    this.metadata = {
      type: "a2a-external",
      agentUrl: agentCard.url,
      provider: agentCard.provider,
      version: agentCard.version,
      capabilities: agentCard.capabilities,
      defaultInputModes: agentCard.defaultInputModes,
      defaultOutputModes: agentCard.defaultOutputModes,
    };

    this.logger.log(
      `A2A Team Member created: ${this.name} (${this.id}) with ${this.skills.length} skills`,
    );
  }

  /**
   * A2A agents are NEVER leaders (ADR-003 requirement)
   */
  isLeader(): boolean {
    return false;
  }

  /**
   * Check if the agent has a specific skill
   */
  hasSkill(skillId: SkillId): boolean {
    return this.skills.includes(skillId);
  }

  /**
   * Check if the agent has a specific tool
   * Always returns false - external agents manage their own tools
   */
  hasTool(_toolId: ToolId): boolean {
    return false;
  }

  /**
   * Get system prompt for this agent
   * Returns the agent card description
   */
  getSystemPrompt(): string {
    return this.agentCard.description;
  }

  /**
   * Update status based on A2A task status
   */
  updateStatusFromA2ATask(a2aStatus: A2ATaskStatus): void {
    const previousStatus = this.status;

    switch (a2aStatus) {
      case A2ATaskStatus.PENDING:
        this.status = "waiting";
        break;
      case A2ATaskStatus.RUNNING:
        this.status = "executing";
        break;
      case A2ATaskStatus.COMPLETED:
        this.status = "completed";
        break;
      case A2ATaskStatus.FAILED:
        this.status = "failed";
        break;
      case A2ATaskStatus.CANCELLED:
        this.status = "failed"; // Map cancelled to failed
        break;
      default:
        this.logger.warn(`Unknown A2A task status: ${String(a2aStatus)}`);
        this.status = "idle";
    }

    if (previousStatus !== this.status) {
      this.logger.debug(
        `Member ${this.name} status changed: ${previousStatus} -> ${this.status}`,
      );
    }
  }

  /**
   * Get the underlying A2A agent card
   */
  getAgentCard(): A2AAgentCard {
    return this.agentCard;
  }

  /**
   * Get the agent URL for task creation
   */
  getAgentUrl(): string {
    return this.agentCard.url;
  }
}
