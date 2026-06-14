/**
 * dynamic-team-builder.integration.spec.ts
 *
 * Exercises the REAL DynamicTeamBuilder + TeamFactory + RoleRegistry + RoleInventory
 * (no mocks) so team-build failures surface LOCALLY instead of one-per-deploy.
 * This would have caught both the "Role integrator not found" (inventory role not
 * in RoleRegistry) and "Role analyst is not a leader role" (member used as leader)
 * regressions without a Railway round-trip.
 */
import { DynamicTeamBuilder } from "../dynamic-team-builder";
import { RoleInventory } from "../../role-inventory/role-inventory";
import { RoleRegistry } from "../../registry/role-registry";
import { TeamRegistry } from "../../registry/team-registry";
import { TeamFactory } from "../../factory/team-factory";

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeBuilder(): {
  builder: DynamicTeamBuilder;
  roleRegistry: RoleRegistry;
} {
  const roleRegistry = new RoleRegistry();
  const teamRegistry = new TeamRegistry();
  const teamFactory = new TeamFactory(roleRegistry, teamRegistry);
  const roleInventory = new RoleInventory();
  // Build the prototype map if RoleInventory does so in onModuleInit.
  (roleInventory as any).onModuleInit?.();
  const builder = new DynamicTeamBuilder(
    roleInventory,
    teamFactory,
    roleRegistry,
  );
  return { builder, roleRegistry };
}

describe("DynamicTeamBuilder — real TeamFactory/RoleRegistry integration", () => {
  it("builds a team from elected member roles with a dedicated leader", () => {
    const { builder } = makeBuilder();
    const assignments = [
      { roleId: "analyst", modelId: "m1" },
      { roleId: "researcher", modelId: "m1" },
      { roleId: "integrator", modelId: "m2" },
      { roleId: "reviewer", modelId: "m1" },
      { roleId: "writer", modelId: "m3" },
    ];

    // Must NOT throw "Role integrator not found" or "Role analyst is not a leader role".
    const team = builder.build("mission-int-1", assignments as any);

    expect(team).toBeDefined();
    expect(team.leader).toBeDefined();
    expect(team.leader.role.type).toBe("leader");
    expect(team.members.length).toBeGreaterThanOrEqual(assignments.length);
  });

  it("registers inventory-only roles (integrator) + the LEADER into RoleRegistry", () => {
    const { builder, roleRegistry } = makeBuilder();
    builder.build("mission-int-2", [
      { roleId: "integrator", modelId: "m1" },
    ] as any);
    expect(roleRegistry.tryGet("integrator")).toBeDefined();
    const leader = roleRegistry.tryGet("leader");
    expect(leader).toBeDefined();
    expect(leader?.type).toBe("leader");
  });
});
