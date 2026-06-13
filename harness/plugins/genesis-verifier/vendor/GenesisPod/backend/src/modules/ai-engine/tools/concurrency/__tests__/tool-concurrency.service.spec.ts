/**
 * Unit tests for ToolConcurrencyService
 */

import { Logger } from "@nestjs/common";
import {
  ToolConcurrencyService,
  ConcurrencyMetadata,
  ToolCallDescriptor,
} from "../tool-concurrency.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(): ToolConcurrencyService {
  jest.spyOn(Logger.prototype, "debug").mockImplementation();
  return new ToolConcurrencyService();
}

function call(toolId: string, category?: string): ToolCallDescriptor {
  return { toolId, category };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolConcurrencyService", () => {
  let service: ToolConcurrencyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  // -------------------------------------------------------------------------
  // getMetadata — category defaults
  // -------------------------------------------------------------------------

  describe("getMetadata()", () => {
    it('returns isConcurrencySafe=true for "information" category', () => {
      const meta = service.getMetadata("my-tool", "information");
      expect(meta.isConcurrencySafe).toBe(true);
    });

    it('returns isConcurrencySafe=false for "execution" category', () => {
      const meta = service.getMetadata("my-tool", "execution");
      expect(meta.isConcurrencySafe).toBe(false);
    });

    it("returns isConcurrencySafe=false (conservative default) for unknown category", () => {
      const meta = service.getMetadata("my-tool", "unknown-category");
      expect(meta.isConcurrencySafe).toBe(false);
    });

    it("returns conservative default when no category is provided", () => {
      const meta = service.getMetadata("my-tool");
      expect(meta.isConcurrencySafe).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // registerOverride
  // -------------------------------------------------------------------------

  describe("registerOverride()", () => {
    it("subsequent getMetadata returns the registered override", () => {
      const override: ConcurrencyMetadata = {
        isConcurrencySafe: true,
        sideEffects: "read",
        resourcesAccessed: ["custom-resource"],
      };
      service.registerOverride("special-tool", override);

      const meta = service.getMetadata("special-tool", "execution");
      // Override wins over category default
      expect(meta.isConcurrencySafe).toBe(true);
      expect(meta.resourcesAccessed).toEqual(["custom-resource"]);
    });
  });

  // -------------------------------------------------------------------------
  // partition — all concurrent
  // -------------------------------------------------------------------------

  describe("partition()", () => {
    it("groups all concurrency-safe tools into a single parallel group", () => {
      const calls = [
        call("tool-a", "information"),
        call("tool-b", "generation"),
        call("tool-c", "processing"),
      ];

      const result = service.partition(calls);

      expect(result.sequential).toHaveLength(0);
      expect(result.parallelGroups).toHaveLength(1);
      expect(result.parallelGroups[0]).toEqual(["tool-a", "tool-b", "tool-c"]);
    });

    // -------------------------------------------------------------------------
    // partition — all sequential
    // -------------------------------------------------------------------------

    it("places all sequential tools in the sequential array", () => {
      const calls = [
        call("tool-a", "execution"),
        call("tool-b", "integration"),
        call("tool-c", "collaboration"),
      ];

      const result = service.partition(calls);

      expect(result.parallelGroups).toHaveLength(0);
      expect(result.sequential).toEqual(["tool-a", "tool-b", "tool-c"]);
    });

    // -------------------------------------------------------------------------
    // partition — mixed
    // -------------------------------------------------------------------------

    it("correctly separates concurrent and sequential tools in a mixed list", () => {
      // concurrent, sequential, concurrent
      const calls = [
        call("read-a", "information"),
        call("exec-b", "execution"),
        call("read-c", "generation"),
      ];

      const result = service.partition(calls);

      // 'read-a' forms a parallel group, 'exec-b' is sequential, 'read-c' forms another
      expect(result.sequential).toContain("exec-b");
      expect(result.parallelGroups.flat()).toContain("read-a");
      expect(result.parallelGroups.flat()).toContain("read-c");
    });

    // -------------------------------------------------------------------------
    // partition — resource conflict splits groups
    // -------------------------------------------------------------------------

    it("splits into a new parallel group when tools share a resource", () => {
      // Both tools are concurrent-safe but access the same resource "db"
      const resourceMeta: ConcurrencyMetadata = {
        isConcurrencySafe: true,
        sideEffects: "read",
        resourcesAccessed: ["db"],
      };
      service.registerOverride("tool-a", resourceMeta);
      service.registerOverride("tool-b", resourceMeta);

      const calls = [call("tool-a"), call("tool-b")];
      const result = service.partition(calls);

      // Conflict detected: two separate parallel groups
      expect(result.parallelGroups).toHaveLength(2);
      expect(result.sequential).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // partition — empty input
    // -------------------------------------------------------------------------

    it("returns empty groups and sequential array for empty input", () => {
      const result = service.partition([]);

      expect(result.parallelGroups).toHaveLength(0);
      expect(result.sequential).toHaveLength(0);
    });
  });
});
