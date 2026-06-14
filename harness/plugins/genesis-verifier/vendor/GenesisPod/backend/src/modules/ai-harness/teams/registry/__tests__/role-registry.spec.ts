/**
 * RoleRegistry Tests
 *
 * Covers:
 * 1. onModuleInit – builtin roles registered
 * 2. register – new role, duplicate skip
 * 3. registerFromConfig – creates and registers role
 * 4. get – found and not found
 * 5. tryGet – optional lookup
 * 6. has
 * 7. getAll / getLeaderRoles / getMemberRoles
 * 8. unregister
 * 9. size
 * 10. clear
 */

import { RoleRegistry } from "../role-registry";
import { RoleConfig, BUILTIN_ROLES } from "../../abstractions/role.interface";

function makeRoleConfig(
  id: string,
  type: "leader" | "member" = "member",
): RoleConfig {
  return {
    id,
    name: `${id} role`,
    description: `Description for ${id}`,
    type,
    coreSkills: [],
    coreTools: [],
    responsibilities: ["Do stuff"],
    systemPromptTemplate: "You are {{role_name}}.",
  };
}

describe("RoleRegistry", () => {
  let registry: RoleRegistry;

  beforeEach(() => {
    registry = new RoleRegistry();
    // onModuleInit is called automatically during testing by the NestJS module.
    // Since we instantiate directly, we call it manually.
    registry.onModuleInit();
  });

  // ============================================================
  // Builtin roles
  // ============================================================

  describe("onModuleInit (builtin roles)", () => {
    it("should register all builtin roles on init", () => {
      const builtinCount = Object.keys(BUILTIN_ROLES).length;
      expect(registry.size()).toBe(builtinCount);
    });

    it("should include MODERATOR as a leader role", () => {
      const role = registry.get(BUILTIN_ROLES.MODERATOR);
      expect(role.type).toBe("leader");
    });

    it("should include RESEARCHER as a member role", () => {
      const role = registry.get(BUILTIN_ROLES.RESEARCHER);
      expect(role.type).toBe("member");
    });

    it("should include ADVOCATE", () => {
      expect(registry.has(BUILTIN_ROLES.ADVOCATE)).toBe(true);
    });

    it("base layer leader pool only contains generic SDK leaders (no business *_LEAD)", () => {
      // v3 R0-A1-d: business leaders (research-lead/content-lead/slides-lead) live in ai-app
      const leaders = registry.getLeaderRoles();
      const leaderIds = leaders.map((r) => r.id);
      expect(leaderIds).toContain(BUILTIN_ROLES.MODERATOR);
      expect(leaderIds).not.toContain("research-lead");
      expect(leaderIds).not.toContain("content-lead");
      expect(leaderIds).not.toContain("tech-lead");
      expect(leaderIds).not.toContain("slides-lead");
    });
  });

  // ============================================================
  // register
  // ============================================================

  describe("register", () => {
    it("should register a new role", () => {
      const sizeBefore = registry.size();
      registry.registerFromConfig(makeRoleConfig("custom-role"));
      expect(registry.size()).toBe(sizeBefore + 1);
    });

    it("should skip duplicate registration silently (no error)", () => {
      const config = makeRoleConfig("custom-role");
      registry.registerFromConfig(config);
      const sizeBefore = registry.size();
      registry.registerFromConfig(config); // duplicate
      expect(registry.size()).toBe(sizeBefore);
    });
  });

  // ============================================================
  // registerFromConfig
  // ============================================================

  describe("registerFromConfig", () => {
    it("should return the created role", () => {
      const config = makeRoleConfig("my-role", "leader");
      const role = registry.registerFromConfig(config);
      expect(role.id).toBe("my-role");
      expect(role.type).toBe("leader");
    });

    it("should make the role retrievable after registration", () => {
      registry.registerFromConfig(makeRoleConfig("my-role"));
      expect(registry.has("my-role")).toBe(true);
    });
  });

  // ============================================================
  // get
  // ============================================================

  describe("get", () => {
    it("should return the registered role", () => {
      const role = registry.get(BUILTIN_ROLES.RESEARCHER);
      expect(role.id).toBe(BUILTIN_ROLES.RESEARCHER);
    });

    it("should throw for nonexistent role id", () => {
      expect(() => registry.get("nonexistent")).toThrow("not found");
    });
  });

  // ============================================================
  // tryGet
  // ============================================================

  describe("tryGet", () => {
    it("should return role if registered", () => {
      const role = registry.tryGet(BUILTIN_ROLES.ANALYST);
      expect(role).toBeDefined();
      expect(role?.id).toBe(BUILTIN_ROLES.ANALYST);
    });

    it("should return undefined for missing role", () => {
      expect(registry.tryGet("missing-role")).toBeUndefined();
    });
  });

  // ============================================================
  // has
  // ============================================================

  describe("has", () => {
    it("should return true for registered builtin role", () => {
      expect(registry.has(BUILTIN_ROLES.WRITER)).toBe(true);
    });

    it("should return false for unregistered role", () => {
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  // ============================================================
  // getAll / getLeaderRoles / getMemberRoles
  // ============================================================

  describe("getAll", () => {
    it("should return all registered roles", () => {
      const builtinCount = Object.keys(BUILTIN_ROLES).length;
      expect(registry.getAll().length).toBe(builtinCount);
    });
  });

  describe("getLeaderRoles", () => {
    it("should return only roles with type leader", () => {
      const leaders = registry.getLeaderRoles();
      expect(leaders.every((r) => r.type === "leader")).toBe(true);
      expect(leaders.length).toBeGreaterThan(0);
    });

    it("should include custom leader role after registration", () => {
      registry.registerFromConfig(makeRoleConfig("my-leader", "leader"));
      const leaders = registry.getLeaderRoles();
      const ids = leaders.map((r) => r.id);
      expect(ids).toContain("my-leader");
    });
  });

  describe("getMemberRoles", () => {
    it("should return only roles with type member", () => {
      const members = registry.getMemberRoles();
      expect(members.every((r) => r.type === "member")).toBe(true);
      expect(members.length).toBeGreaterThan(0);
    });

    it("should include REVIEWER and DESIGNER", () => {
      const members = registry.getMemberRoles();
      const ids = members.map((r) => r.id);
      expect(ids).toContain(BUILTIN_ROLES.REVIEWER);
      expect(ids).toContain(BUILTIN_ROLES.DESIGNER);
    });
  });

  // ============================================================
  // unregister
  // ============================================================

  describe("unregister", () => {
    it("should remove a custom role and return true", () => {
      registry.registerFromConfig(makeRoleConfig("to-remove"));
      const result = registry.unregister("to-remove");
      expect(result).toBe(true);
      expect(registry.has("to-remove")).toBe(false);
    });

    it("should return false for nonexistent role id", () => {
      expect(registry.unregister("ghost")).toBe(false);
    });

    it("should allow unregistering a builtin role", () => {
      const result = registry.unregister(BUILTIN_ROLES.REVIEWER);
      expect(result).toBe(true);
      expect(registry.has(BUILTIN_ROLES.REVIEWER)).toBe(false);
    });
  });

  // ============================================================
  // size
  // ============================================================

  describe("size", () => {
    it("should reflect current count of registered roles", () => {
      const before = registry.size();
      registry.registerFromConfig(makeRoleConfig("extra-role"));
      expect(registry.size()).toBe(before + 1);
    });
  });

  // ============================================================
  // clear
  // ============================================================

  describe("clear", () => {
    it("should remove all roles", () => {
      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.getAll()).toHaveLength(0);
    });

    it("should allow re-registration after clear", () => {
      registry.clear();
      registry.registerFromConfig(makeRoleConfig("fresh-role"));
      expect(registry.size()).toBe(1);
    });
  });

  // ============================================================
  // Role content validation
  // ============================================================

  describe("role content", () => {
    it("each builtin role should have a non-empty name", () => {
      for (const role of registry.getAll()) {
        expect(role.name.length).toBeGreaterThan(0);
      }
    });

    it("each builtin role should have at least one responsibility", () => {
      for (const role of registry.getAll()) {
        expect(role.responsibilities.length).toBeGreaterThan(0);
      }
    });

    it("each builtin role should have a systemPromptTemplate", () => {
      for (const role of registry.getAll()) {
        expect(role.systemPromptTemplate.length).toBeGreaterThan(0);
      }
    });
  });
});
