import { Module } from "@nestjs/common";
import { AiEnginePlanningModule } from "@/modules/ai-engine/planning/planning.module";
import { SelfDrivenMissionRunner } from "./self-driven-mission-runner.service";
import { SelfDrivenMissionPlannerService } from "./self-driven-mission-planner.service";
import { SelfDrivenReportComposer } from "./self-driven-report-composer";
import { SelfDrivenHitlGateService } from "./self-driven-hitl-gate";
import { SelfDrivenEventRelay } from "./self-driven-event-relay";
import { RoleInventory } from "../../role-inventory/role-inventory";
import { ROLE_INVENTORY } from "../../abstractions/role-inventory.interface";
import { DynamicTeamBuilder } from "../../dynamic-team/dynamic-team-builder";
// AgentFactory is injected into SelfDrivenMissionRunner via @Global HarnessModule.
// It is not listed in this module's providers because HarnessModule's @Global()
// declaration makes it available to all modules without explicit re-registration.

/**
 * Self-Driven Agent Team (harness capability cluster).
 *
 * Exposes {@link SelfDrivenMissionRunner},
 * {@link SelfDrivenMissionPlannerService}, {@link RoleInventory}, and
 * {@link DynamicTeamBuilder} to app-side thin dispatch.
 * Consumed via direct module import (same pattern as ask -> CollaborationModule),
 * not a deep service-path import, preserving the facade boundary.
 *
 * Dependencies:
 *   - AiEnginePlanningModule → StepDecompositionService (role-agnostic decomposition)
 *   - RubricGeneratorService, AiChatService, AgentFactory → available from @Global HarnessModule
 *   - TeamFactory → available from @Global HarnessApiModule (via TeamsModule export)
 */
@Module({
  imports: [AiEnginePlanningModule],
  providers: [
    SelfDrivenMissionRunner,
    SelfDrivenMissionPlannerService,
    // Thin deliver-phase assembler (zero-LLM, pure Markdown composition).
    SelfDrivenReportComposer,
    // P4a HITL gate — DB-poll approval primitive + sanitize for append injection.
    SelfDrivenHitlGateService,
    // Stage 1: relays generator events onto the global EventBus as self-driven.*
    // (EventBus is @Global, no module import needed).
    SelfDrivenEventRelay,
    // RoleInventory singleton bound to IRoleInventory DI token
    {
      provide: ROLE_INVENTORY,
      useClass: RoleInventory,
    },
    // DynamicTeamBuilder injects IRoleInventory via ROLE_INVENTORY token
    DynamicTeamBuilder,
  ],
  exports: [
    SelfDrivenMissionRunner,
    SelfDrivenMissionPlannerService,
    SelfDrivenReportComposer,
    SelfDrivenHitlGateService,
    SelfDrivenEventRelay,
    DynamicTeamBuilder,
    // Export the token so consumers can inject IRoleInventory directly
    ROLE_INVENTORY,
  ],
})
export class SelfDrivenTeamModule {}
