/**
 * AI Harness — DynamicTeamBuilder
 *
 * Converts planner-produced RoleAssignments into a live ITeam by:
 *   1. Validating every roleId against RoleInventory (safety-10).
 *   2. Assembling a minimal TeamConfig with role-declared coreTools (safety-05).
 *   3. Delegating instantiation to TeamFactory.createFromConfig().
 *
 * Design: docs/architecture/ai-harness/self-driven-team/
 *   self-driven-agent-team-design-2026-06-04.md §5.3 / §9
 *
 * MECE: one DynamicTeamBuilder per project
 *   (capability-singleton.spec.ts, modules/ai-harness/teams/dynamic-team/).
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  IRoleInventory,
  ROLE_INVENTORY,
} from "../abstractions/role-inventory.interface";
import { ROLE_INVENTORY_IDS } from "../role-inventory/role-inventory";
import type {
  ITeam,
  TeamConfig,
  MemberRoleConfig,
} from "../abstractions/team.interface";
import type { RoleAssignment } from "../orchestrator/orchestrator.interface";
import { TeamFactory } from "../factory/team-factory";
import { RoleRegistry } from "../registry/role-registry";
import { getDefaultConstraintProfile } from "../profile/mission-execution-profile";
import type { WorkflowConfig } from "../abstractions/workflow.interface";

// ==================== Error ====================

/**
 * Thrown when a roleId in a RoleAssignment is not present in RoleInventory.
 * Enforces safety-10: LLM-generated free-form role ids are not permitted.
 */
export class AgentAccessDeniedError extends Error {
  constructor(roleId: string) {
    super(
      `AgentAccessDeniedError: roleId "${roleId}" is not registered in ` +
        `RoleInventory. LLM-generated free-form role ids are not permitted ` +
        `(safety-10). Add the role to RoleInventory or correct the planner output.`,
    );
    this.name = "AgentAccessDeniedError";
  }
}

// ==================== DynamicTeamBuilder ====================

/**
 * DynamicTeamBuilder — assembles a live ITeam from planner-produced
 * RoleAssignments.
 *
 * Injection:
 *   - IRoleInventory via ROLE_INVENTORY token (provided by SelfDrivenTeamModule).
 *   - TeamFactory — globally available via @Global HarnessApiModule → TeamsModule.
 */
@Injectable()
export class DynamicTeamBuilder {
  private readonly logger = new Logger(DynamicTeamBuilder.name);

  constructor(
    @Inject(ROLE_INVENTORY) private readonly roleInventory: IRoleInventory,
    private readonly teamFactory: TeamFactory,
    private readonly roleRegistry: RoleRegistry,
  ) {}

  /**
   * Build a live ITeam from planner-produced role assignments.
   *
   * @param missionId   Caller-generated mission id for team namespacing.
   * @param assignments Role+model pairs produced by SelfDrivenMissionPlanner.
   *
   * @throws AgentAccessDeniedError if any roleId is absent from RoleInventory.
   * @throws Error if assignments is empty.
   */
  build(missionId: string, assignments: RoleAssignment[]): ITeam {
    if (assignments.length === 0) {
      throw new Error(
        `DynamicTeamBuilder: assignments must not be empty (mission="${missionId}").`,
      );
    }

    // safety-10: validate ALL roleIds against inventory before any instantiation.
    for (const { roleId } of assignments) {
      if (!this.roleInventory.has(roleId)) {
        throw new AgentAccessDeniedError(roleId);
      }
    }

    // Bridge: TeamFactory resolves role definitions from the generic RoleRegistry,
    // but self-driven roles live in the curated RoleInventory. Register any
    // RoleInventory prototype the registry is missing (e.g. "integrator") so
    // createFromConfig can find it — without this the build throws "Role X not
    // found" for inventory roles absent from the registry's builtins.
    this.ensureRolesRegistered(assignments);

    // The team leader is the dedicated LEADER role (type:"leader"); the elected
    // roles are all members. An elected member role cannot double as the leader
    // (TeamFactory's createLeader rejects non-leader-type roles).
    const leaderRoleId = ROLE_INVENTORY_IDS.LEADER;

    // Member role configs — one slot per assignment (leader role included;
    // TeamFactory creates the leader member separately from leaderRoleId).
    const memberRoles: MemberRoleConfig[] = assignments.map(({ roleId }) => ({
      roleId,
      minCount: 1,
      maxCount: 1,
      required: true,
    }));

    // Build a minimal sequential WorkflowConfig (TeamFactory requires >= 1 step).
    const workflow = this.buildWorkflow(missionId, assignments);

    // Collect the union of coreTools declared by each assigned role (safety-05).
    const availableTools = this.collectCoreTools(assignments);

    const teamId = `dynamic-team-${missionId}`;

    const config: TeamConfig = {
      id: teamId,
      name: `Self-Driven Team (${missionId})`,
      description: `Dynamically assembled team for mission ${missionId}.`,
      type: "custom",
      leaderRoleId,
      memberRoles,
      workflow,
      availableSkills: [],
      availableTools,
      constraintProfile: getDefaultConstraintProfile(),
      deliverableTypes: ["report"],
    };

    this.logger.log(
      `[DynamicTeamBuilder] mission=${missionId} leaderRole=${leaderRoleId} ` +
        `members=${assignments.length} tools=[${availableTools.join(", ")}]`,
    );

    try {
      return this.teamFactory.createFromConfig(config, {
        defaultModel: this.pickDefaultModel(assignments),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[DynamicTeamBuilder] TeamFactory failed for mission=${missionId}: ${message}`,
      );
      throw err;
    }
  }

  // ── private helpers ────────────────────────────────────────────────────────

  /**
   * Register each assigned RoleInventory prototype into the RoleRegistry that
   * TeamFactory resolves from — but only those the registry does not already
   * have, so builtin roles are never clobbered. Maps RolePrototype → RoleConfig.
   */
  private ensureRolesRegistered(assignments: RoleAssignment[]): void {
    // Members = the elected roles; plus the dedicated LEADER role, which acts as
    // the team leader (TeamFactory requires the leader to be a type:"leader"
    // role — an elected member role cannot double as leader).
    const roleIds = new Set<string>(assignments.map((a) => a.roleId));
    roleIds.add(ROLE_INVENTORY_IDS.LEADER);
    for (const roleId of roleIds) {
      if (this.roleRegistry.tryGet(roleId)) continue;
      const proto = this.roleInventory.getRole(roleId);
      if (!proto) continue;
      this.roleRegistry.registerFromConfig({
        id: proto.roleId,
        name: proto.title,
        description: proto.systemPromptHint,
        type: proto.roleId === ROLE_INVENTORY_IDS.LEADER ? "leader" : "member",
        coreSkills: [],
        coreTools: [...proto.coreTools],
        responsibilities: [proto.title],
        systemPromptTemplate: proto.systemPromptHint,
        metadata: {
          maxIterations: proto.maxIterations,
          source: "self-driven-role-inventory",
        },
      });
    }
  }

  /**
   * Collect the union of coreTools for all assigned roles (safety-05).
   * De-duplicated; order is stable (first-occurrence insertion order).
   */
  private collectCoreTools(assignments: RoleAssignment[]): string[] {
    const seen = new Set<string>();
    const tools: string[] = [];
    for (const { roleId } of assignments) {
      const proto = this.roleInventory.getRole(roleId);
      if (!proto) continue;
      for (const tool of proto.coreTools) {
        if (!seen.has(tool)) {
          seen.add(tool);
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  /**
   * Pick a default model: use the leader assignment's modelId if non-empty,
   * otherwise fall back to "" (LLMFactory default, no hardcoding — red-line).
   */
  private pickDefaultModel(assignments: RoleAssignment[]): string {
    const leader = assignments.find(
      (a) => a.roleId === ROLE_INVENTORY_IDS.LEADER,
    );
    return leader?.modelId ?? assignments[0]?.modelId ?? "";
  }

  /**
   * Build a minimal sequential WorkflowConfig from the assignments.
   * Each assignment becomes one task step; later steps depend on the prior.
   * TeamFactory validates that at least one step is present.
   */
  private buildWorkflow(
    missionId: string,
    assignments: RoleAssignment[],
  ): WorkflowConfig {
    const steps = assignments.map(({ roleId }, index) => ({
      id: `step-${index + 1}`,
      name: `Step ${index + 1} — ${roleId}`,
      description: `Execution step for role "${roleId}" in mission "${missionId}".`,
      type: "task" as const,
      executorRoles: [roleId],
      parallel: false,
      dependsOn: index > 0 ? [`step-${index}`] : ([] as string[]),
    }));

    return {
      id: `workflow-${missionId}`,
      name: `Self-Driven Workflow for ${missionId}`,
      type: "sequential",
      steps,
      entryStepId: "step-1",
    };
  }
}
