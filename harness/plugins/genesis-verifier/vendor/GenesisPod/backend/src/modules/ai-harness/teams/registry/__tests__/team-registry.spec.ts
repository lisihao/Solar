/**
 * TeamRegistry Tests
 *
 * Covers:
 * 1. registerConfig – new config, duplicate skip
 * 2. register – team instance, duplicate skip
 * 3. get / getConfig – found and not found
 * 4. tryGet / tryGetConfig – undefined for missing
 * 5. has – combines both maps
 * 6. getAll / getAllConfigs
 * 7. getByType / getPredefinedTeams / getCustomTeams
 * 8. unregister
 * 9. size / instanceCount
 * 10. clear
 * 11. search – by name and type
 * 12. getSummary
 */

import { TeamRegistry } from "../team-registry";
import { TeamConfig, ITeam } from "../../abstractions/team.interface";
import { getDefaultConstraintProfile } from "../../profile/mission-execution-profile";

function makeConfig(
  id: string,
  name: string,
  type: "predefined" | "custom" = "predefined",
): TeamConfig {
  return {
    id,
    name,
    description: `${name} description`,
    type,
    leaderRoleId: "research-lead",
    memberRoles: [],
    workflow: { type: "sequential", steps: [] } as any,
    availableSkills: [],
    availableTools: [],
    constraintProfile: getDefaultConstraintProfile(),
    deliverableTypes: ["report"],
  };
}

function makeTeam(
  id: string,
  name: string,
  type: "predefined" | "custom" = "predefined",
): ITeam {
  const config = makeConfig(id, name, type);
  return {
    id,
    name,
    description: config.description,
    type,
    config,
    leader: {} as any,
    members: [],
    workflow: {} as any,
    constraintProfile: getDefaultConstraintProfile(),
    getAllMembers: () => [],
    getMembersByRole: () => [],
    getMemberById: () => undefined,
    hasRole: () => false,
    getAvailableSkills: () => [],
    getAvailableTools: () => [],
  };
}

describe("TeamRegistry", () => {
  let registry: TeamRegistry;

  beforeEach(() => {
    registry = new TeamRegistry();
  });

  // ============================================================
  // registerConfig
  // ============================================================

  describe("registerConfig", () => {
    it("should register a new team config", () => {
      registry.registerConfig(makeConfig("team-1", "Research Team"));
      expect(registry.size()).toBe(1);
    });

    it("should skip duplicate config registration silently", () => {
      const config = makeConfig("team-1", "Research Team");
      registry.registerConfig(config);
      registry.registerConfig(config); // duplicate
      expect(registry.size()).toBe(1);
    });

    it("should register multiple distinct configs", () => {
      registry.registerConfig(makeConfig("team-1", "Team A"));
      registry.registerConfig(makeConfig("team-2", "Team B"));
      registry.registerConfig(makeConfig("team-3", "Team C"));
      expect(registry.size()).toBe(3);
    });
  });

  // ============================================================
  // register (team instance)
  // ============================================================

  describe("register", () => {
    it("should register a team instance", () => {
      registry.register(makeTeam("team-1", "Research Team"));
      expect(registry.instanceCount()).toBe(1);
    });

    it("should skip duplicate team instance registration", () => {
      const team = makeTeam("team-1", "Research Team");
      registry.register(team);
      registry.register(team);
      expect(registry.instanceCount()).toBe(1);
    });

    it("should also update teamConfigs when registering an instance", () => {
      registry.register(makeTeam("team-1", "Research Team"));
      expect(registry.size()).toBe(1);
    });
  });

  // ============================================================
  // get / getConfig
  // ============================================================

  describe("get", () => {
    it("should return the registered team instance", () => {
      const team = makeTeam("team-1", "Research Team");
      registry.register(team);
      expect(registry.get("team-1")).toBe(team);
    });

    it("should throw for unregistered team id", () => {
      expect(() => registry.get("nonexistent")).toThrow("not found");
    });
  });

  describe("getConfig", () => {
    it("should return registered config", () => {
      const config = makeConfig("team-1", "Research Team");
      registry.registerConfig(config);
      expect(registry.getConfig("team-1")).toEqual(config);
    });

    it("should throw for unregistered config id", () => {
      expect(() => registry.getConfig("nonexistent")).toThrow("not found");
    });
  });

  // ============================================================
  // tryGet / tryGetConfig
  // ============================================================

  describe("tryGet", () => {
    it("should return team if registered", () => {
      const team = makeTeam("team-1", "T");
      registry.register(team);
      expect(registry.tryGet("team-1")).toBe(team);
    });

    it("should return undefined for missing team", () => {
      expect(registry.tryGet("missing")).toBeUndefined();
    });
  });

  describe("tryGetConfig", () => {
    it("should return config if registered", () => {
      registry.registerConfig(makeConfig("team-1", "T"));
      expect(registry.tryGetConfig("team-1")).toBeDefined();
    });

    it("should return undefined for missing config", () => {
      expect(registry.tryGetConfig("missing")).toBeUndefined();
    });
  });

  // ============================================================
  // has
  // ============================================================

  describe("has", () => {
    it("should return true when config is registered", () => {
      registry.registerConfig(makeConfig("team-1", "T"));
      expect(registry.has("team-1")).toBe(true);
    });

    it("should return true when team instance is registered", () => {
      registry.register(makeTeam("team-2", "T"));
      expect(registry.has("team-2")).toBe(true);
    });

    it("should return false for completely unknown id", () => {
      expect(registry.has("ghost")).toBe(false);
    });
  });

  // ============================================================
  // getAll / getAllConfigs
  // ============================================================

  describe("getAll", () => {
    it("should return all registered team instances", () => {
      registry.register(makeTeam("t1", "T1"));
      registry.register(makeTeam("t2", "T2"));
      expect(registry.getAll()).toHaveLength(2);
    });

    it("should return empty array when no instances registered", () => {
      registry.registerConfig(makeConfig("t1", "T1"));
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("getAllConfigs", () => {
    it("should return all registered configs", () => {
      registry.registerConfig(makeConfig("t1", "T1"));
      registry.registerConfig(makeConfig("t2", "T2"));
      expect(registry.getAllConfigs()).toHaveLength(2);
    });

    it("should include configs from registered instances", () => {
      registry.register(makeTeam("t1", "T1"));
      expect(registry.getAllConfigs()).toHaveLength(1);
    });
  });

  // ============================================================
  // getByType / getPredefinedTeams / getCustomTeams
  // ============================================================

  describe("getByType", () => {
    it("should filter teams by predefined type", () => {
      registry.register(makeTeam("t1", "Predefined", "predefined"));
      registry.register(makeTeam("t2", "Custom", "custom"));
      expect(registry.getByType("predefined")).toHaveLength(1);
      expect(registry.getByType("custom")).toHaveLength(1);
    });
  });

  describe("getPredefinedTeams", () => {
    it("should return only predefined teams", () => {
      registry.register(makeTeam("t1", "Predefined", "predefined"));
      registry.register(makeTeam("t2", "Custom", "custom"));
      const predefined = registry.getPredefinedTeams();
      expect(predefined.every((t) => t.type === "predefined")).toBe(true);
    });
  });

  describe("getCustomTeams", () => {
    it("should return only custom teams", () => {
      registry.register(makeTeam("t1", "Predefined", "predefined"));
      registry.register(makeTeam("t2", "Custom", "custom"));
      const custom = registry.getCustomTeams();
      expect(custom.every((t) => t.type === "custom")).toBe(true);
    });
  });

  // ============================================================
  // unregister
  // ============================================================

  describe("unregister", () => {
    it("should remove a registered config and return true", () => {
      registry.registerConfig(makeConfig("t1", "T1"));
      const result = registry.unregister("t1");
      expect(result).toBe(true);
      expect(registry.size()).toBe(0);
    });

    it("should remove a registered team instance and return true", () => {
      registry.register(makeTeam("t1", "T1"));
      const result = registry.unregister("t1");
      expect(result).toBe(true);
      expect(registry.instanceCount()).toBe(0);
    });

    it("should return false for nonexistent id", () => {
      const result = registry.unregister("ghost");
      expect(result).toBe(false);
    });
  });

  // ============================================================
  // size / instanceCount
  // ============================================================

  describe("size", () => {
    it("should return total config count", () => {
      registry.registerConfig(makeConfig("t1", "T1"));
      registry.registerConfig(makeConfig("t2", "T2"));
      expect(registry.size()).toBe(2);
    });
  });

  describe("instanceCount", () => {
    it("should return count of instantiated teams", () => {
      registry.registerConfig(makeConfig("t1", "T1"));
      registry.register(makeTeam("t2", "T2"));
      expect(registry.instanceCount()).toBe(1);
    });
  });

  // ============================================================
  // clear
  // ============================================================

  describe("clear", () => {
    it("should remove all registered configs and instances", () => {
      registry.registerConfig(makeConfig("t1", "T1"));
      registry.register(makeTeam("t2", "T2"));
      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.instanceCount()).toBe(0);
    });
  });

  // ============================================================
  // search
  // ============================================================

  describe("search", () => {
    beforeEach(() => {
      registry.registerConfig(
        makeConfig("research", "Research Team", "predefined"),
      );
      registry.registerConfig(
        makeConfig("debate", "Debate Team", "predefined"),
      );
      registry.registerConfig(
        makeConfig("custom-1", "Custom Analysis", "custom"),
      );
    });

    it("should find configs by name (case-insensitive)", () => {
      const results = registry.search({ name: "research" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("research");
    });

    it("should find configs by type", () => {
      const results = registry.search({ type: "custom" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("custom-1");
    });

    it("should return all configs when no filter specified", () => {
      const results = registry.search({});
      expect(results.length).toBe(3);
    });

    it("should return empty array when name not found", () => {
      const results = registry.search({ name: "nonexistent" });
      expect(results).toHaveLength(0);
    });

    it("should support partial name match", () => {
      const results = registry.search({ name: "team" });
      expect(results.length).toBe(2); // Research Team + Debate Team
    });

    it("should combine name and type filters", () => {
      const results = registry.search({ name: "Research", type: "predefined" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("research");
    });
  });

  // ============================================================
  // getSummary
  // ============================================================

  describe("getSummary", () => {
    it("should return correct totals", () => {
      registry.registerConfig(makeConfig("t1", "T1", "predefined"));
      registry.registerConfig(makeConfig("t2", "T2", "predefined"));
      registry.registerConfig(makeConfig("t3", "T3", "custom"));
      registry.register(makeTeam("t4", "T4", "predefined"));

      const summary = registry.getSummary();
      expect(summary.total).toBe(4);
      expect(summary.predefined).toBe(3); // t1, t2, t4
      expect(summary.custom).toBe(1); // t3
      expect(summary.instantiated).toBe(1); // only t4
    });

    it("should return zeros for empty registry", () => {
      const summary = registry.getSummary();
      expect(summary.total).toBe(0);
      expect(summary.predefined).toBe(0);
      expect(summary.custom).toBe(0);
      expect(summary.instantiated).toBe(0);
    });
  });
});
