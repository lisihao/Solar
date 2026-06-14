/**
 * HierarchicalMemoryCascadeService Unit Tests
 *
 * Tests 4-level memory hierarchy: org → team → project → session
 * - write()      - store a value in a specific scope with optional TTL
 * - resolve()    - cascade resolution (session > project > team > org)
 * - resolveAll() - batch key resolution
 * - promote()    - copy session keys to project scope
 * - listKeys()   - enumerate non-expired keys in a scope
 * - clearScope() - remove all entries in a scope
 * - delete()     - remove a single key from a scope
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  HierarchicalMemoryCascadeService,
  SCOPE_PRIORITY,
} from "../hierarchical-memory-cascade.service";
import type {
  MemoryScope,
  MemoryCascadeResult,
} from "../hierarchical-memory-cascade.service";

describe("HierarchicalMemoryCascadeService", () => {
  let service: HierarchicalMemoryCascadeService;

  // Fixed IDs used across tests
  const orgId = "org-001";
  const teamId = "team-001";
  const projectId = "proj-001";
  const sessionId = "sess-001";

  const baseQuery = { orgId, teamId, projectId, sessionId };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HierarchicalMemoryCascadeService],
    }).compile();

    service = module.get<HierarchicalMemoryCascadeService>(
      HierarchicalMemoryCascadeService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── write() + resolve() ──────────────────────────────────────────────────

  describe("write() + resolve()", () => {
    it("should store a value and resolve it with the correct scope", () => {
      // Arrange
      service.write("session", sessionId, "model", "gpt-4o-mini");

      // Act
      const result = service.resolve({ ...baseQuery, key: "model" });

      // Assert
      expect(result).not.toBeNull();
      expect((result as MemoryCascadeResult).value).toBe("gpt-4o-mini");
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("session");
    });

    it("should resolve from org scope when only org has the key", () => {
      service.write("org", orgId, "industry", "finance");

      const result = service.resolve({ ...baseQuery, key: "industry" });

      expect(result).not.toBeNull();
      expect((result as MemoryCascadeResult).value).toBe("finance");
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("org");
    });
  });

  // ─── cascade priority ─────────────────────────────────────────────────────

  describe("resolve() — cascade priority", () => {
    it("should prefer session over project over team over org for the same key", () => {
      const key = "tone";

      service.write("org", orgId, key, "formal");
      service.write("team", teamId, key, "analytical");
      service.write("project", projectId, key, "concise");
      service.write("session", sessionId, key, "urgent");

      const result = service.resolve({ ...baseQuery, key });

      expect(result).not.toBeNull();
      expect((result as MemoryCascadeResult).value).toBe("urgent");
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("session");
    });

    it("should fall back to project when session does not have the key", () => {
      const key = "context";

      service.write("org", orgId, key, "org-ctx");
      service.write("team", teamId, key, "team-ctx");
      service.write("project", projectId, key, "project-ctx");
      // session intentionally omitted

      const result = service.resolve({ ...baseQuery, key });

      expect((result as MemoryCascadeResult).value).toBe("project-ctx");
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("project");
    });

    it("should fall back to team when session and project do not have the key", () => {
      const key = "methodology";

      service.write("org", orgId, key, "org-method");
      service.write("team", teamId, key, "team-method");
      // project and session intentionally omitted

      const result = service.resolve({ ...baseQuery, key });

      expect((result as MemoryCascadeResult).value).toBe("team-method");
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("team");
    });

    it("should fall back to org when no higher-priority scope has the key", () => {
      const key = "glossary";

      service.write("org", orgId, key, ["AI", "LLM"]);

      const result = service.resolve({ ...baseQuery, key });

      expect((result as MemoryCascadeResult).value).toEqual(["AI", "LLM"]);
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("org");
    });
  });

  // ─── resolve() — not found ────────────────────────────────────────────────

  describe("resolve() — key not found", () => {
    it("should return null when the key does not exist in any scope", () => {
      const result = service.resolve({ ...baseQuery, key: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  // ─── resolve() — undefined scope IDs ─────────────────────────────────────

  describe("resolve() — skipping undefined scope IDs", () => {
    it("should skip scopes whose ID is not provided in the query", () => {
      // Only org has the key; query omits teamId and projectId
      service.write("org", orgId, "fallback", true);

      const result = service.resolve({
        orgId,
        sessionId,
        // teamId and projectId are intentionally absent
        key: "fallback",
      });

      expect(result).not.toBeNull();
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("org");
    });

    it("should still resolve from session when only sessionId is provided", () => {
      service.write("session", sessionId, "ephemeral", 42);

      const result = service.resolve({ sessionId, key: "ephemeral" });

      expect((result as MemoryCascadeResult).value).toBe(42);
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("session");
    });
  });

  // ─── resolve() — TTL ──────────────────────────────────────────────────────

  describe("resolve() — TTL expiry", () => {
    it("should skip expired entries and return null if no valid entry remains", () => {
      jest.useFakeTimers();

      service.write("session", sessionId, "temp", "hot", { ttlMs: 1_000 });

      // Advance time past the TTL
      jest.advanceTimersByTime(2_000);

      const result = service.resolve({ ...baseQuery, key: "temp" });

      expect(result).toBeNull();
    });

    it("should resolve an entry that has not yet expired", () => {
      jest.useFakeTimers();

      service.write("session", sessionId, "fresh", "still-valid", {
        ttlMs: 60_000,
      });

      jest.advanceTimersByTime(30_000); // Only half the TTL elapsed

      const result = service.resolve({ ...baseQuery, key: "fresh" });

      expect(result).not.toBeNull();
      expect((result as MemoryCascadeResult).value).toBe("still-valid");
    });

    it("should fall back to a lower-priority scope when the higher-priority entry is expired", () => {
      jest.useFakeTimers();

      service.write("session", sessionId, "metric", "session-value", {
        ttlMs: 1_000,
      });
      service.write("org", orgId, "metric", "org-value");

      jest.advanceTimersByTime(2_000);

      const result = service.resolve({ ...baseQuery, key: "metric" });

      expect(result).not.toBeNull();
      expect((result as MemoryCascadeResult).value).toBe("org-value");
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("org");
    });
  });

  // ─── resolveAll() ─────────────────────────────────────────────────────────

  describe("resolveAll()", () => {
    it("should return a map of resolved values for multiple keys", () => {
      service.write("session", sessionId, "k1", "v1");
      service.write("project", projectId, "k2", "v2");
      service.write("org", orgId, "k3", "v3");

      const results = service.resolveAll(baseQuery, ["k1", "k2", "k3"]);

      expect(results.size).toBe(3);
      expect(results.get("k1")?.value).toBe("v1");
      expect(results.get("k2")?.value).toBe("v2");
      expect(results.get("k3")?.value).toBe("v3");
    });

    it("should omit keys that are not found in any scope", () => {
      service.write("session", sessionId, "present", "yes");

      const results = service.resolveAll(baseQuery, ["present", "missing"]);

      expect(results.size).toBe(1);
      expect(results.has("present")).toBe(true);
      expect(results.has("missing")).toBe(false);
    });
  });

  // ─── promote() ────────────────────────────────────────────────────────────

  describe("promote()", () => {
    it("should copy session values to project scope and return promoted count", () => {
      service.write("session", sessionId, "finding-a", "result-a");
      service.write("session", sessionId, "finding-b", "result-b");

      const count = service.promote(sessionId, projectId, [
        "finding-a",
        "finding-b",
      ]);

      expect(count).toBe(2);

      // Verify values landed in project scope by querying without sessionId
      // (session is still intact but project scope must also carry the values)
      const projectKeys = service.listKeys("project", projectId);
      expect(projectKeys).toEqual(
        expect.arrayContaining(["finding-a", "finding-b"]),
      );

      // Resolve scoped only to project confirms the value is there
      const ra = service.resolve({
        projectId,
        sessionId: "no-session",
        key: "finding-a",
      });
      expect(ra?.resolvedFrom).toBe("project");
      expect(ra?.value).toBe("result-a");

      const rb = service.resolve({
        projectId,
        sessionId: "no-session",
        key: "finding-b",
      });
      expect(rb?.resolvedFrom).toBe("project");
      expect(rb?.value).toBe("result-b");
    });

    it("should not delete the original session entries after promotion", () => {
      service.write("session", sessionId, "keep", "me");

      service.promote(sessionId, projectId, ["keep"]);

      const sessionResult = service.resolve({ sessionId, key: "keep" });
      expect(sessionResult?.resolvedFrom).toBe("session");
    });

    it("should skip session entries that have expired", () => {
      jest.useFakeTimers();

      service.write("session", sessionId, "stale", "expired-value", {
        ttlMs: 1_000,
      });
      service.write("session", sessionId, "fresh", "valid-value", {
        ttlMs: 60_000,
      });

      jest.advanceTimersByTime(2_000);

      const count = service.promote(sessionId, projectId, ["stale", "fresh"]);

      expect(count).toBe(1);
      // Only "fresh" should land in project
      const staleInProject = service.resolve({
        projectId,
        sessionId,
        key: "stale",
      });
      expect(staleInProject).toBeNull();
    });

    it("should return 0 when the session scope is empty", () => {
      const count = service.promote("nonexistent-session", projectId, [
        "some-key",
      ]);

      expect(count).toBe(0);
    });
  });

  // ─── listKeys() ───────────────────────────────────────────────────────────

  describe("listKeys()", () => {
    it("should return all non-expired keys in a scope", () => {
      service.write("project", projectId, "alpha", 1);
      service.write("project", projectId, "beta", 2);
      service.write("project", projectId, "gamma", 3);

      const keys = service.listKeys("project", projectId);

      expect(keys).toHaveLength(3);
      expect(keys).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
    });

    it("should exclude expired entries and clean them from the store", () => {
      jest.useFakeTimers();

      service.write("project", projectId, "live", "ok", { ttlMs: 60_000 });
      service.write("project", projectId, "dead", "gone", { ttlMs: 1_000 });

      jest.advanceTimersByTime(2_000);

      const keys = service.listKeys("project", projectId);

      expect(keys).toEqual(["live"]);

      // Verify the expired entry was purged: direct resolve should return null
      const result = service.resolve({ sessionId, projectId, key: "dead" });
      expect(result).toBeNull();
    });

    it("should return an empty array for an unknown scope ID", () => {
      const keys = service.listKeys("team", "unknown-team");
      expect(keys).toEqual([]);
    });
  });

  // ─── clearScope() ─────────────────────────────────────────────────────────

  describe("clearScope()", () => {
    it("should remove all entries in a scope and return the count", () => {
      service.write("team", teamId, "key1", "v1");
      service.write("team", teamId, "key2", "v2");

      const count = service.clearScope("team", teamId);

      expect(count).toBe(2);
      expect(service.listKeys("team", teamId)).toEqual([]);
    });

    it("should return 0 when clearing a scope that does not exist", () => {
      const count = service.clearScope("org", "nonexistent-org");
      expect(count).toBe(0);
    });

    it("should not affect other scopes when clearing one scope", () => {
      service.write("team", teamId, "shared-key", "team-value");
      service.write("org", orgId, "shared-key", "org-value");

      service.clearScope("team", teamId);

      const result = service.resolve({ orgId, sessionId, key: "shared-key" });
      expect(result).not.toBeNull();
      expect((result as MemoryCascadeResult).resolvedFrom).toBe("org");
    });
  });

  // ─── delete() ─────────────────────────────────────────────────────────────

  describe("delete()", () => {
    it("should remove a specific key and return true", () => {
      service.write("session", sessionId, "remove-me", "bye");

      const deleted = service.delete("session", sessionId, "remove-me");

      expect(deleted).toBe(true);
      expect(service.resolve({ sessionId, key: "remove-me" })).toBeNull();
    });

    it("should return false when deleting a key that does not exist", () => {
      const deleted = service.delete("session", sessionId, "ghost");
      expect(deleted).toBe(false);
    });

    it("should return false when the scope itself does not exist", () => {
      const deleted = service.delete("team", "ghost-team", "any-key");
      expect(deleted).toBe(false);
    });
  });

  // ─── write() — TTL boundary ───────────────────────────────────────────────

  describe("write() — TTL boundary behaviour", () => {
    it("should resolve successfully before TTL expires and return null after", () => {
      jest.useFakeTimers();

      service.write("session", sessionId, "window", "value", { ttlMs: 5_000 });

      // Before expiry
      jest.advanceTimersByTime(4_999);
      const before = service.resolve({ ...baseQuery, key: "window" });
      expect(before).not.toBeNull();
      expect((before as MemoryCascadeResult).value).toBe("value");

      // After expiry
      jest.advanceTimersByTime(2); // now at 5001ms
      const after = service.resolve({ ...baseQuery, key: "window" });
      expect(after).toBeNull();
    });
  });

  // ─── SCOPE_PRIORITY export ────────────────────────────────────────────────

  describe("SCOPE_PRIORITY", () => {
    it("should expose the correct priority order from highest to lowest", () => {
      expect(SCOPE_PRIORITY).toEqual(["session", "project", "team", "org"]);
    });

    it("should contain exactly the four defined scopes", () => {
      const expected: MemoryScope[] = ["session", "project", "team", "org"];
      expect(SCOPE_PRIORITY).toHaveLength(expected.length);
      expect(new Set(SCOPE_PRIORITY)).toEqual(new Set(expected));
    });
  });
});
