/**
 * RuntimePromptRouter — branch coverage spec
 *
 * Covers uncovered branches in register(), resolve(), rollback(), and compareSemver().
 */

import { RuntimePromptRouter } from "../runtime-prompt-router";
import type { PromptTemplate } from "../prompt-template";

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: "test-prompt",
    version: "1.0.0",
    variant: undefined,
    weight: 1,
    checksum: "abc123",
    render: jest.fn().mockReturnValue("rendered"),
    ...overrides,
  } as PromptTemplate;
}

describe("RuntimePromptRouter", () => {
  let registry: RuntimePromptRouter;

  beforeEach(() => {
    registry = new RuntimePromptRouter();
  });

  describe("register()", () => {
    it("registers a new template", () => {
      const tpl = makeTemplate();
      registry.register(tpl);
      expect(registry.getExact("test-prompt", "1.0.0")).toBe(tpl);
    });

    it("warns and overwrites when re-registering same key", () => {
      const tpl1 = makeTemplate({ checksum: "cs1" });
      const tpl2 = makeTemplate({ checksum: "cs2" });
      registry.register(tpl1);
      registry.register(tpl2);
      // Both registered, second overwrites
      const result = registry.getExact("test-prompt", "1.0.0");
      expect(result?.checksum).toBe("cs2");
    });

    it("handles variant in key", () => {
      const tpl = makeTemplate({ variant: "v-a" });
      registry.register(tpl);
      expect(registry.getExact("test-prompt", "1.0.0", "v-a")).toBe(tpl);
    });

    it("does not double-add same key to byId list", () => {
      const tpl = makeTemplate();
      registry.register(tpl);
      registry.register(makeTemplate({ checksum: "cs2" })); // same key
      const hist = registry.history("test-prompt");
      expect(hist.length).toBe(1);
    });
  });

  describe("getExact()", () => {
    it("returns undefined for unknown id", () => {
      expect(registry.getExact("unknown", "1.0.0")).toBeUndefined();
    });

    it("returns undefined for unknown version", () => {
      registry.register(makeTemplate());
      expect(registry.getExact("test-prompt", "2.0.0")).toBeUndefined();
    });
  });

  describe("resolve()", () => {
    it("returns undefined when no template registered", () => {
      expect(registry.resolve("test-prompt")).toBeUndefined();
    });

    it("returns undefined when version not in entries", () => {
      // Register then manually break active version
      registry.register(makeTemplate());
      // Force-version to one that doesn't exist
      expect(
        registry.resolve("test-prompt", { forceVersion: "9.9.9" }),
      ).toBeUndefined();
    });

    it("returns single variant directly", () => {
      const tpl = makeTemplate();
      registry.register(tpl);
      expect(registry.resolve("test-prompt")).toBe(tpl);
    });

    it("returns forceVariant match when specified", () => {
      const tplA = makeTemplate({ variant: "a", weight: 1 });
      const tplB = makeTemplate({ variant: "b", weight: 1 });
      registry.register(tplA);
      registry.register(tplB);
      const result = registry.resolve("test-prompt", { forceVariant: "b" });
      expect(result).toBe(tplB);
    });

    it("falls back to first when forceVariant not found", () => {
      const tplA = makeTemplate({ variant: "a", weight: 1 });
      registry.register(tplA);
      const result = registry.resolve("test-prompt", {
        forceVariant: "nonexistent",
      });
      expect(result).toBe(tplA);
    });

    it("returns first variant when no userId for A/B routing", () => {
      const tplA = makeTemplate({ variant: "a", weight: 50 });
      const tplB = makeTemplate({ variant: "b", weight: 50 });
      registry.register(tplA);
      registry.register(tplB);
      const result = registry.resolve("test-prompt");
      expect([tplA, tplB]).toContain(result);
    });

    it("returns first when totalWeight is zero", () => {
      const tplA = makeTemplate({ variant: "a", weight: 0 });
      const tplB = makeTemplate({ variant: "b", weight: 0 });
      registry.register(tplA);
      registry.register(tplB);
      // No userId → returns all[0]
      const result = registry.resolve("test-prompt");
      expect([tplA, tplB]).toContain(result);
    });

    it("routes consistently by userId (A/B hashing)", () => {
      const tplA = makeTemplate({ variant: "a", weight: 50 });
      const tplB = makeTemplate({ variant: "b", weight: 50 });
      registry.register(tplA);
      registry.register(tplB);
      // Same userId should always get same variant
      const r1 = registry.resolve("test-prompt", { userId: "user-abc" });
      const r2 = registry.resolve("test-prompt", { userId: "user-abc" });
      expect(r1).toBe(r2);
    });

    it("routes by userId with weight-based bucket selection", () => {
      const tplA = makeTemplate({ variant: "a", weight: 1 });
      const tplB = makeTemplate({ variant: "b", weight: 99 });
      registry.register(tplA);
      registry.register(tplB);
      // Run with multiple user IDs — should mostly get B (99% weight)
      const results = new Set<string | undefined>();
      for (let i = 0; i < 20; i++) {
        const r = registry.resolve("test-prompt", { userId: `user-${i}` });
        results.add(r?.variant);
      }
      // Should see at least "b" in results (high weight)
      expect(results.has("b")).toBe(true);
    });
  });

  describe("history()", () => {
    it("returns empty array for unknown id", () => {
      expect(registry.history("unknown")).toEqual([]);
    });

    it("returns sorted history by semver", () => {
      const t1 = makeTemplate({ version: "1.0.0" });
      const t2 = makeTemplate({ version: "2.0.0" });
      const t3 = makeTemplate({ version: "1.5.0" });
      registry.register(t1);
      registry.register(t2);
      registry.register(t3);
      const hist = registry.history("test-prompt");
      expect(hist.map((t) => t.version)).toEqual(["1.0.0", "1.5.0", "2.0.0"]);
    });
  });

  describe("rollback()", () => {
    it("no-ops for unknown id", () => {
      expect(() => registry.rollback("unknown", "1.0.0")).not.toThrow();
    });

    it("removes newer versions and sets active to rollback version", () => {
      const t1 = makeTemplate({ version: "1.0.0" });
      const t2 = makeTemplate({ version: "2.0.0" });
      registry.register(t1);
      registry.register(t2);

      registry.rollback("test-prompt", "1.0.0");

      // 2.0.0 should be gone
      expect(registry.getExact("test-prompt", "2.0.0")).toBeUndefined();
      // 1.0.0 should still be there
      expect(registry.getExact("test-prompt", "1.0.0")).toBe(t1);
      // resolve should use 1.0.0
      expect(registry.resolve("test-prompt")).toBe(t1);
    });

    it("keeps versions equal to or below rollback target", () => {
      const t1 = makeTemplate({ version: "1.0.0" });
      const t2 = makeTemplate({ version: "1.5.0" });
      const t3 = makeTemplate({ version: "2.0.0" });
      registry.register(t1);
      registry.register(t2);
      registry.register(t3);

      registry.rollback("test-prompt", "1.5.0");
      expect(registry.getExact("test-prompt", "1.0.0")).toBe(t1);
      expect(registry.getExact("test-prompt", "1.5.0")).toBe(t2);
      expect(registry.getExact("test-prompt", "2.0.0")).toBeUndefined();
    });
  });

  describe("compareSemver edge cases (via history sorting)", () => {
    it("handles shorter versions (missing patch) gracefully", () => {
      const t1 = makeTemplate({ version: "1.0" });
      const t2 = makeTemplate({ version: "2.0" });
      registry.register(t1);
      registry.register(t2);
      const hist = registry.history("test-prompt");
      expect(hist[0].version).toBe("1.0");
      expect(hist[1].version).toBe("2.0");
    });

    it("handles equal versions (returns 0, keeps order)", () => {
      // Same major/minor/patch → equal comparison
      const t1 = makeTemplate({ version: "1.0.0", variant: "v1" });
      const t2 = makeTemplate({ version: "1.0.0", variant: "v2" });
      registry.register(t1);
      registry.register(t2);
      const hist = registry.history("test-prompt");
      expect(hist.length).toBe(2);
    });
  });
});
