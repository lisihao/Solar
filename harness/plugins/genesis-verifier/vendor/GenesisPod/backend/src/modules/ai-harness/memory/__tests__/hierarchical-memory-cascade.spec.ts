/**
 * HierarchicalMemoryCascadeService structural tests
 *
 * Goals:
 *   1. Service instantiates without throwing.
 *   2. write() / resolve() basic put-get cycle.
 *   3. Cascade priority: session > project > team > org.
 *   4. resolveAll() batches multiple key lookups.
 *   5. promote() copies session → project.
 *   6. listKeys() returns non-expired keys for a scope.
 *   7. clearScope() removes all entries in a scope.
 *   8. delete() removes a specific key from a scope.
 *   9. TTL expiry: expired entries are not returned.
 */

import { HierarchicalMemoryCascadeService } from "../working/hierarchical-memory-cascade.service";

// Disable NestJS Logger output in tests
jest.mock("@nestjs/common", () => {
  const actual = jest.requireActual("@nestjs/common");
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  };
});

// Export is also re-exported from the service file
import { SCOPE_PRIORITY } from "../working/hierarchical-memory-cascade.service";

describe("HierarchicalMemoryCascadeService", () => {
  let svc: HierarchicalMemoryCascadeService;

  beforeEach(() => {
    svc = new HierarchicalMemoryCascadeService();
  });

  // -------------------------------------------------------------------------
  // Instantiation
  // -------------------------------------------------------------------------

  it("instantiates without throwing", () => {
    expect(svc).toBeInstanceOf(HierarchicalMemoryCascadeService);
  });

  it("SCOPE_PRIORITY is exported and contains all four scopes", () => {
    expect(SCOPE_PRIORITY).toEqual(
      expect.arrayContaining(["session", "project", "team", "org"]),
    );
    expect(SCOPE_PRIORITY).toHaveLength(4);
  });

  // -------------------------------------------------------------------------
  // write() / resolve() basic cycle
  // -------------------------------------------------------------------------

  it("write() and resolve() basic round-trip", () => {
    svc.write("session", "s1", "myKey", "myValue");
    const result = svc.resolve({
      sessionId: "s1",
      key: "myKey",
    });
    expect(result).not.toBeNull();
    expect(result?.value).toBe("myValue");
    expect(result?.resolvedFrom).toBe("session");
  });

  it("resolve() returns null when key is not present in any scope", () => {
    const result = svc.resolve({ sessionId: "s-unknown", key: "ghost" });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Cascade priority
  // -------------------------------------------------------------------------

  it("session scope takes priority over all others for the same key", () => {
    svc.write("org", "org-1", "setting", "org-value");
    svc.write("team", "team-1", "setting", "team-value");
    svc.write("project", "proj-1", "setting", "proj-value");
    svc.write("session", "sess-1", "setting", "sess-value");

    const result = svc.resolve({
      orgId: "org-1",
      teamId: "team-1",
      projectId: "proj-1",
      sessionId: "sess-1",
      key: "setting",
    });
    expect(result?.value).toBe("sess-value");
    expect(result?.resolvedFrom).toBe("session");
  });

  it("falls back to project when session has no entry for the key", () => {
    svc.write("org", "org-1", "fallback", "org-value");
    svc.write("team", "team-1", "fallback", "team-value");
    svc.write("project", "proj-1", "fallback", "proj-value");

    const result = svc.resolve({
      orgId: "org-1",
      teamId: "team-1",
      projectId: "proj-1",
      sessionId: "sess-empty",
      key: "fallback",
    });
    expect(result?.value).toBe("proj-value");
    expect(result?.resolvedFrom).toBe("project");
  });

  it("falls back to team when project and session have no entry", () => {
    svc.write("org", "org-1", "key", "org-val");
    svc.write("team", "team-1", "key", "team-val");

    const result = svc.resolve({
      orgId: "org-1",
      teamId: "team-1",
      sessionId: "no-session",
      key: "key",
    });
    expect(result?.value).toBe("team-val");
    expect(result?.resolvedFrom).toBe("team");
  });

  it("falls back to org as last resort", () => {
    svc.write("org", "org-1", "root", "org-only");

    const result = svc.resolve({
      orgId: "org-1",
      sessionId: "no-session",
      key: "root",
    });
    expect(result?.value).toBe("org-only");
    expect(result?.resolvedFrom).toBe("org");
  });

  // -------------------------------------------------------------------------
  // resolveAll()
  // -------------------------------------------------------------------------

  it("resolveAll() returns a Map of found keys", () => {
    svc.write("session", "s1", "k1", "v1");
    svc.write("session", "s1", "k2", "v2");

    const map = svc.resolveAll({ sessionId: "s1" }, ["k1", "k2", "k3"]);
    expect(map.size).toBe(2);
    expect(map.get("k1")?.value).toBe("v1");
    expect(map.get("k2")?.value).toBe("v2");
    expect(map.has("k3")).toBe(false);
  });

  it("resolveAll() returns empty map when no keys match", () => {
    const map = svc.resolveAll({ sessionId: "s-empty" }, ["a", "b"]);
    expect(map.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // promote()
  // -------------------------------------------------------------------------

  it("promote() copies session keys to project scope", () => {
    svc.write("session", "s1", "finding", "important data");
    const promoted = svc.promote("s1", "p1", ["finding"]);
    expect(promoted).toBe(1);

    const projectResult = svc.resolve({
      projectId: "p1",
      sessionId: "different-session",
      key: "finding",
    });
    expect(projectResult?.value).toBe("important data");
    expect(projectResult?.resolvedFrom).toBe("project");
  });

  it("promote() returns 0 when session has no entries", () => {
    const promoted = svc.promote("empty-session", "p1", ["x"]);
    expect(promoted).toBe(0);
  });

  it("promote() skips keys not present in session", () => {
    svc.write("session", "s1", "present", "yes");
    const promoted = svc.promote("s1", "p1", ["present", "absent"]);
    expect(promoted).toBe(1);
  });

  // -------------------------------------------------------------------------
  // listKeys()
  // -------------------------------------------------------------------------

  it("listKeys() returns all non-expired keys in a scope", () => {
    svc.write("project", "p1", "k1", "v1");
    svc.write("project", "p1", "k2", "v2");
    const keys = svc.listKeys("project", "p1");
    expect(keys.sort()).toEqual(["k1", "k2"]);
  });

  it("listKeys() returns empty array for unknown scope", () => {
    expect(svc.listKeys("org", "nonexistent")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // clearScope()
  // -------------------------------------------------------------------------

  it("clearScope() removes all entries and returns the count", () => {
    svc.write("team", "t1", "a", 1);
    svc.write("team", "t1", "b", 2);
    const cleared = svc.clearScope("team", "t1");
    expect(cleared).toBe(2);
    expect(svc.listKeys("team", "t1")).toHaveLength(0);
  });

  it("clearScope() returns 0 for unknown scope", () => {
    expect(svc.clearScope("org", "ghost")).toBe(0);
  });

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------

  it("delete() removes a specific key", () => {
    svc.write("session", "s1", "toDelete", "bye");
    svc.write("session", "s1", "toKeep", "stay");
    const deleted = svc.delete("session", "s1", "toDelete");
    expect(deleted).toBe(true);
    expect(svc.resolve({ sessionId: "s1", key: "toDelete" })).toBeNull();
    expect(svc.resolve({ sessionId: "s1", key: "toKeep" })?.value).toBe("stay");
  });

  it("delete() returns false for unknown scope or key", () => {
    expect(svc.delete("org", "unknown", "key")).toBe(false);
    svc.write("org", "o1", "existing", "v");
    expect(svc.delete("org", "o1", "nonexistent")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // TTL expiry
  // -------------------------------------------------------------------------

  it("resolve() returns null for an expired entry", async () => {
    svc.write("session", "s1", "volatile", "data", { ttlMs: 1 });
    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = svc.resolve({ sessionId: "s1", key: "volatile" });
    expect(result).toBeNull();
  });

  it("write() with no ttlMs stores an entry that does not expire", async () => {
    svc.write("session", "s1", "permanent", "data");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = svc.resolve({ sessionId: "s1", key: "permanent" });
    expect(result).not.toBeNull();
  });
});
