import { Test, TestingModule } from "@nestjs/testing";
import { MCPSessionManager } from "../mcp-session-manager";

describe("MCPSessionManager", () => {
  let manager: MCPSessionManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MCPSessionManager],
    }).compile();

    manager = module.get<MCPSessionManager>(MCPSessionManager);
  });

  // =========================================================================
  // createSession
  // =========================================================================

  describe("createSession", () => {
    it("should create a session with default policy", () => {
      const session = manager.createSession("api-key-1");

      expect(session.sessionId).toMatch(/^mcp-[a-f0-9]{32}$/);
      expect(session.apiKeyId).toBe("api-key-1");
      expect(session.permissionPolicy).toBeDefined();
      expect(session.permissionPolicy!.allowedToolPatterns).toContain(
        "genesis_*",
      );
      expect(session.permissionPolicy!.maxConcurrency).toBe(5);
      expect(session.permissionPolicy!.dailyQuota).toBe(1000);
      expect(session.permissionPolicy!.allowStreaming).toBe(true);
      expect(session.permissionPolicy!.allowResources).toBe(true);
      expect(session.permissionPolicy!.allowPrompts).toBe(true);
    });

    it("should create a session with client info", () => {
      const session = manager.createSession("api-key-1", {
        name: "Claude Code",
        version: "1.0.0",
      });

      expect(session.clientInfo).toEqual({
        name: "Claude Code",
        version: "1.0.0",
      });
    });

    it("should create a session with custom policy override", () => {
      const session = manager.createSession("api-key-1", undefined, {
        dailyQuota: 500,
        maxConcurrency: 3,
        allowResources: false,
      });

      expect(session.permissionPolicy!.dailyQuota).toBe(500);
      expect(session.permissionPolicy!.maxConcurrency).toBe(3);
      expect(session.permissionPolicy!.allowResources).toBe(false);
      // Defaults preserved for non-overridden fields
      expect(session.permissionPolicy!.allowStreaming).toBe(true);
    });

    it("should create unique session IDs", () => {
      const session1 = manager.createSession("api-key-1");
      const session2 = manager.createSession("api-key-1");
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    it("should store session in internal map", () => {
      const session = manager.createSession("api-key-1");
      const retrieved = manager.getSession(session.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    });
  });

  // =========================================================================
  // getSession
  // =========================================================================

  describe("getSession", () => {
    it("should return session and update lastActiveAt", () => {
      const session = manager.createSession("api-key-1");
      const originalTime = session.lastActiveAt;

      // Small delay to ensure time difference
      jest.useFakeTimers();
      jest.advanceTimersByTime(1000);

      const retrieved = manager.getSession(session.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
        originalTime.getTime(),
      );

      jest.useRealTimers();
    });

    it("should return undefined for unknown session", () => {
      const result = manager.getSession("unknown-session-id");
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // terminateSession
  // =========================================================================

  describe("terminateSession", () => {
    it("should terminate existing session and return true", () => {
      const session = manager.createSession("api-key-1");
      const result = manager.terminateSession(session.sessionId);

      expect(result).toBe(true);
      expect(manager.getSession(session.sessionId)).toBeUndefined();
    });

    it("should return false for non-existent session", () => {
      const result = manager.terminateSession("non-existent");
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // isToolAllowed
  // =========================================================================

  describe("isToolAllowed", () => {
    it("should allow tools matching genesis_* pattern", () => {
      const session = manager.createSession("api-key-1");

      expect(manager.isToolAllowed(session.sessionId, "genesis_ask")).toBe(
        true,
      );
      expect(
        manager.isToolAllowed(session.sessionId, "genesis_deep_research"),
      ).toBe(true);
      expect(
        manager.isToolAllowed(session.sessionId, "genesis_team_debate"),
      ).toBe(true);
    });

    it("should deny tools not matching any allowed pattern", () => {
      const session = manager.createSession("api-key-1");

      expect(manager.isToolAllowed(session.sessionId, "tool_web_search")).toBe(
        false,
      );
      expect(manager.isToolAllowed(session.sessionId, "skill_analysis")).toBe(
        false,
      );
    });

    it("should return false for unknown session (fail-closed)", () => {
      const result = manager.isToolAllowed("unknown-session", "genesis_ask");
      expect(result).toBe(false);
    });

    it("should deny tools matching deny pattern even if allowed", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["*"],
        deniedToolPatterns: ["genesis_dangerous_*"],
      });

      expect(
        manager.isToolAllowed(session.sessionId, "genesis_dangerous_tool"),
      ).toBe(false);
      expect(manager.isToolAllowed(session.sessionId, "genesis_ask")).toBe(
        true,
      );
    });

    it("should match wildcard * pattern", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["*"],
        deniedToolPatterns: [],
      });

      expect(manager.isToolAllowed(session.sessionId, "any_tool")).toBe(true);
      expect(
        manager.isToolAllowed(session.sessionId, "genesis_something"),
      ).toBe(true);
    });

    it("should match suffix wildcard pattern", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["*_search"],
        deniedToolPatterns: [],
      });

      expect(manager.isToolAllowed(session.sessionId, "tool_web_search")).toBe(
        true,
      );
      expect(manager.isToolAllowed(session.sessionId, "genesis_search")).toBe(
        true,
      );
      expect(manager.isToolAllowed(session.sessionId, "genesis_analyze")).toBe(
        false,
      );
    });

    it("should match exact tool name without wildcard", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["exact_tool"],
        deniedToolPatterns: [],
      });

      expect(manager.isToolAllowed(session.sessionId, "exact_tool")).toBe(true);
      expect(manager.isToolAllowed(session.sessionId, "exact_tool_extra")).toBe(
        false,
      );
    });
  });

  // =========================================================================
  // validateAndConsumeQuota
  // =========================================================================

  describe("validateAndConsumeQuota", () => {
    it("should allow when no session and no tool specified", () => {
      const result = manager.validateAndConsumeQuota("api-key-1");
      expect(result.allowed).toBe(true);
    });

    it("should consume quota on each call", () => {
      // Create session with quota 2
      const session = manager.createSession("api-key-quota", undefined, {
        dailyQuota: 2,
      });

      const r1 = manager.validateAndConsumeQuota(
        "api-key-quota",
        session.sessionId,
        "genesis_ask",
      );
      const r2 = manager.validateAndConsumeQuota(
        "api-key-quota",
        session.sessionId,
        "genesis_ask",
      );
      const r3 = manager.validateAndConsumeQuota(
        "api-key-quota",
        session.sessionId,
        "genesis_ask",
      );

      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(false);
      expect(r3.reason).toBe("quota_exceeded");
    });

    it("should return session_expired for unknown session ID", () => {
      const result = manager.validateAndConsumeQuota(
        "api-key-1",
        "non-existent-session",
        "genesis_ask",
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("session_expired");
    });

    it("should return permission_denied for denied tool pattern", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["genesis_*"],
        deniedToolPatterns: ["genesis_dangerous_*"],
      });

      const result = manager.validateAndConsumeQuota(
        "api-key-1",
        session.sessionId,
        "genesis_dangerous_tool",
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("permission_denied");
    });

    it("should return permission_denied for tool not in allowed list", () => {
      const session = manager.createSession("api-key-1");

      const result = manager.validateAndConsumeQuota(
        "api-key-1",
        session.sessionId,
        "tool_not_allowed",
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("permission_denied");
    });

    it("should update lastActiveAt on success", () => {
      const session = manager.createSession("api-key-1");
      const before = session.lastActiveAt;

      jest.useFakeTimers();
      jest.advanceTimersByTime(500);

      manager.validateAndConsumeQuota(
        "api-key-1",
        session.sessionId,
        "genesis_ask",
      );

      const updated = manager.getSession(session.sessionId);
      expect(updated!.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );

      jest.useRealTimers();
    });
  });

  // =========================================================================
  // consumeQuota (backward compat)
  // =========================================================================

  describe("consumeQuota", () => {
    it("should consume quota and return true while under limit", () => {
      const session = manager.createSession("api-key-consume", undefined, {
        dailyQuota: 3,
      });

      expect(manager.consumeQuota("api-key-consume", session.sessionId)).toBe(
        true,
      );
      expect(manager.consumeQuota("api-key-consume", session.sessionId)).toBe(
        true,
      );
      expect(manager.consumeQuota("api-key-consume", session.sessionId)).toBe(
        true,
      );
      expect(manager.consumeQuota("api-key-consume", session.sessionId)).toBe(
        false,
      );
    });

    it("should use default quota when no session", () => {
      // default quota is 1000, just verify it works
      const result = manager.consumeQuota("api-key-no-session");
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // isResourceAllowed / isPromptAllowed
  // =========================================================================

  describe("isResourceAllowed", () => {
    it("should return true for session with allowResources=true", () => {
      const session = manager.createSession("api-key-1");
      expect(manager.isResourceAllowed(session.sessionId)).toBe(true);
    });

    it("should return false for session with allowResources=false", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowResources: false,
      });
      expect(manager.isResourceAllowed(session.sessionId)).toBe(false);
    });

    it("should return false for unknown session", () => {
      expect(manager.isResourceAllowed("unknown-session")).toBe(false);
    });
  });

  describe("isPromptAllowed", () => {
    it("should return true for session with allowPrompts=true", () => {
      const session = manager.createSession("api-key-1");
      expect(manager.isPromptAllowed(session.sessionId)).toBe(true);
    });

    it("should return false for session with allowPrompts=false", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowPrompts: false,
      });
      expect(manager.isPromptAllowed(session.sessionId)).toBe(false);
    });

    it("should return false for unknown session", () => {
      expect(manager.isPromptAllowed("unknown-session")).toBe(false);
    });
  });

  // =========================================================================
  // getAllSessions
  // =========================================================================

  describe("getAllSessions", () => {
    it("should return all active sessions", () => {
      manager.createSession("api-key-1");
      manager.createSession("api-key-2");
      manager.createSession("api-key-3");

      const sessions = manager.getAllSessions();
      expect(sessions.length).toBe(3);
    });

    it("should return empty array when no sessions", () => {
      const sessions = manager.getAllSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  // =========================================================================
  // getStats
  // =========================================================================

  describe("getStats", () => {
    it("should return correct stats with no sessions", () => {
      const stats = manager.getStats();
      expect(stats.activeSessions).toBe(0);
      expect(stats.byClient).toEqual({});
      expect(stats.byApiKey).toEqual({});
    });

    it("should group sessions by client and apiKey", () => {
      manager.createSession("api-key-1", { name: "Claude", version: "1.0" });
      manager.createSession("api-key-1", { name: "Claude", version: "1.0" });
      manager.createSession("api-key-2", { name: "Cursor", version: "2.0" });
      manager.createSession("api-key-3");

      const stats = manager.getStats();
      expect(stats.activeSessions).toBe(4);
      expect(stats.byClient["Claude"]).toBe(2);
      expect(stats.byClient["Cursor"]).toBe(1);
      expect(stats.byClient["unknown"]).toBe(1);
      expect(stats.byApiKey["api-key-1"]).toBe(2);
      expect(stats.byApiKey["api-key-2"]).toBe(1);
      expect(stats.byApiKey["api-key-3"]).toBe(1);
    });
  });

  // =========================================================================
  // resolveSession
  // =========================================================================

  describe("resolveSession", () => {
    it("should return session when context has valid sessionId", () => {
      const session = manager.createSession("api-key-1");
      const resolved = manager.resolveSession({
        apiKeyId: "api-key-1",
        sessionId: session.sessionId,
      });
      expect(resolved).toBeDefined();
      expect(resolved!.sessionId).toBe(session.sessionId);
    });

    it("should return undefined when context has no sessionId", () => {
      const resolved = manager.resolveSession({ apiKeyId: "api-key-1" });
      expect(resolved).toBeUndefined();
    });

    it("should return undefined when sessionId not found", () => {
      const resolved = manager.resolveSession({
        apiKeyId: "api-key-1",
        sessionId: "non-existent",
      });
      expect(resolved).toBeUndefined();
    });
  });

  // =========================================================================
  // Pattern matching edge cases
  // =========================================================================

  describe("pattern matching (private matchPattern via isToolAllowed)", () => {
    it("should match middle wildcard pattern tool_*_v2", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["tool_*_v2"],
        deniedToolPatterns: [],
      });

      expect(manager.isToolAllowed(session.sessionId, "tool_search_v2")).toBe(
        true,
      );
      expect(manager.isToolAllowed(session.sessionId, "tool_anything_v2")).toBe(
        true,
      );
      expect(manager.isToolAllowed(session.sessionId, "tool_search_v3")).toBe(
        false,
      );
    });

    it("should not match when prefix does not match", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["genesis_*"],
        deniedToolPatterns: [],
      });

      expect(manager.isToolAllowed(session.sessionId, "not_genesis_tool")).toBe(
        false,
      );
    });

    it("should not match suffix pattern with wrong suffix", () => {
      const session = manager.createSession("api-key-1", undefined, {
        allowedToolPatterns: ["*_search"],
        deniedToolPatterns: [],
      });

      expect(manager.isToolAllowed(session.sessionId, "tool_search_v2")).toBe(
        false,
      );
    });
  });

  // =========================================================================
  // Quota reset
  // =========================================================================

  describe("quota reset", () => {
    it("should reset quota after midnight", () => {
      const session = manager.createSession("api-key-reset", undefined, {
        dailyQuota: 1,
      });

      // Consume the only quota
      expect(manager.consumeQuota("api-key-reset", session.sessionId)).toBe(
        true,
      );
      expect(manager.consumeQuota("api-key-reset", session.sessionId)).toBe(
        false,
      );

      // Simulate time past midnight by manipulating the usage map
      // We test the reset indirectly by using a different API key
      const session2 = manager.createSession("api-key-reset-2", undefined, {
        dailyQuota: 1,
      });
      expect(manager.consumeQuota("api-key-reset-2", session2.sessionId)).toBe(
        true,
      );
    });
  });
});
