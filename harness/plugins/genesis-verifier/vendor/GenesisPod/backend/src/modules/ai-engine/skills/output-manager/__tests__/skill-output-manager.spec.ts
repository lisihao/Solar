/**
 * Unit tests for SkillOutputManager and createSkillOutputManager
 */

import {
  SkillOutputManager,
  createSkillOutputManager,
} from "../skill-output-manager";

// ---------------------------------------------------------------------------
// SkillOutputManager
// ---------------------------------------------------------------------------

describe("SkillOutputManager", () => {
  let manager: SkillOutputManager;

  beforeEach(() => {
    manager = new SkillOutputManager();
  });

  // -------------------------------------------------------------------------
  // store / get basics
  // -------------------------------------------------------------------------

  describe("store() and get()", () => {
    it("stores and retrieves a value by its original ID", () => {
      manager.store("my-skill", { answer: 42 });
      expect(manager.get("my-skill")).toEqual({ answer: 42 });
    });

    it("returns undefined for an unknown key", () => {
      expect(manager.get("does-not-exist")).toBeUndefined();
    });

    it("stores strings as values", () => {
      manager.store("text-skill", "hello world");
      expect(manager.get("text-skill")).toBe("hello world");
    });

    it("stores arrays as values", () => {
      manager.store("list-skill", [1, 2, 3]);
      expect(manager.get("list-skill")).toEqual([1, 2, 3]);
    });

    it("stores null as a value", () => {
      manager.store("null-skill", null);
      expect(manager.get("null-skill")).toBeNull();
    });

    it("overwrites existing value when stored again", () => {
      manager.store("overwrite-skill", "first");
      manager.store("overwrite-skill", "second");
      expect(manager.get("overwrite-skill")).toBe("second");
    });

    it("stores optional metadata alongside the value", () => {
      manager.store("meta-skill", "data", { source: "llm", confidence: 0.9 });
      const entry = manager.getEntry("meta-skill");
      expect(entry?.metadata).toEqual({ source: "llm", confidence: 0.9 });
    });
  });

  // -------------------------------------------------------------------------
  // getEntry
  // -------------------------------------------------------------------------

  describe("getEntry()", () => {
    it("returns entry with correct key, originalSkillId, data, and createdAt", () => {
      manager.store("entry-skill", { val: 1 });
      const entry = manager.getEntry("entry-skill");

      expect(entry).toBeDefined();
      expect(entry!.data).toEqual({ val: 1 });
      expect(entry!.originalSkillId).toBe("entry-skill");
      expect(entry!.createdAt).toBeInstanceOf(Date);
    });

    it("returns undefined for unknown skill", () => {
      expect(manager.getEntry("unknown")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // normalizeKey — prefix stripping
  // -------------------------------------------------------------------------

  describe("normalizeKey()", () => {
    it('strips the "slides-" prefix', () => {
      expect(manager.normalizeKey("slides-outline-planning")).toBe(
        "outline-planning",
      );
    });

    it('strips the "teams-" prefix', () => {
      expect(manager.normalizeKey("teams-task-decomposition")).toBe(
        "task-decomposition",
      );
    });

    it('strips the "office-" prefix', () => {
      expect(manager.normalizeKey("office-doc-generation")).toBe(
        "doc-generation",
      );
    });

    it('strips the "studio-" prefix', () => {
      expect(manager.normalizeKey("studio-canvas")).toBe("canvas");
    });

    it("does not strip an unknown prefix", () => {
      expect(manager.normalizeKey("custom-my-skill")).toBe("custom-my-skill");
    });

    it("converts camelCase to kebab-case", () => {
      expect(manager.normalizeKey("outlinePlanning")).toBe("outline-planning");
    });

    it("converts snake_case to kebab-case", () => {
      expect(manager.normalizeKey("outline_planning")).toBe("outline-planning");
    });

    it("takes only the first segment when key contains a comma", () => {
      expect(manager.normalizeKey("skill-a,skill-b")).toBe("skill-a");
    });

    it("trims surrounding whitespace", () => {
      expect(manager.normalizeKey("  my-skill  ")).toBe("my-skill");
    });

    it("returns empty string for empty input", () => {
      expect(manager.normalizeKey("")).toBe("");
    });

    it("lowercases the resulting key", () => {
      expect(manager.normalizeKey("UPPER-CASE-SKILL")).toBe("upper-case-skill");
    });

    it("only strips one prefix (first match wins)", () => {
      // "slides-teams-" — strips "slides-" and leaves "teams-..."
      expect(manager.normalizeKey("slides-teams-abc")).toBe("teams-abc");
    });
  });

  // -------------------------------------------------------------------------
  // get() via normalized key lookup
  // -------------------------------------------------------------------------

  describe("get() — normalized lookup", () => {
    it("retrieves via prefixed ID when stored without prefix", () => {
      manager.store("outline-planning", { chapters: 5 });
      expect(manager.get("slides-outline-planning")).toEqual({ chapters: 5 });
    });

    it("retrieves via non-prefixed ID when stored with prefix", () => {
      manager.store("slides-outline-planning", { chapters: 3 });
      expect(manager.get("outline-planning")).toEqual({ chapters: 3 });
    });

    it("retrieves via original prefixed ID when stored with prefix", () => {
      manager.store("slides-outline-planning", { chapters: 3 });
      expect(manager.get("slides-outline-planning")).toEqual({ chapters: 3 });
    });
  });

  // -------------------------------------------------------------------------
  // has()
  // -------------------------------------------------------------------------

  describe("has()", () => {
    it("returns true for a stored skill", () => {
      manager.store("exists-skill", "value");
      expect(manager.has("exists-skill")).toBe(true);
    });

    it("returns false for an unknown skill", () => {
      expect(manager.has("unknown-skill")).toBe(false);
    });

    it("returns true when querying via prefixed alias", () => {
      manager.store("planning-result", { done: true });
      expect(manager.has("slides-planning-result")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------

  describe("delete()", () => {
    it("removes an existing entry and returns true", () => {
      manager.store("del-skill", "data");
      const removed = manager.delete("del-skill");
      expect(removed).toBe(true);
      expect(manager.has("del-skill")).toBe(false);
    });

    it("returns false when deleting a non-existent entry", () => {
      expect(manager.delete("nonexistent")).toBe(false);
    });

    it("also removes all alias mappings on delete", () => {
      manager.store("slides-del-test", "val");
      manager.delete("del-test");
      // Alias via prefixed lookup should also be gone
      expect(manager.has("slides-del-test")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------

  describe("clear()", () => {
    it("removes all entries", () => {
      manager.store("s1", 1);
      manager.store("s2", 2);
      manager.clear();
      expect(manager.keys()).toHaveLength(0);
    });

    it("clears alias mappings too", () => {
      manager.store("slides-abc", "x");
      manager.clear();
      expect(manager.has("abc")).toBe(false);
      expect(manager.has("slides-abc")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // keys()
  // -------------------------------------------------------------------------

  describe("keys()", () => {
    it("returns empty array on a fresh manager", () => {
      expect(manager.keys()).toEqual([]);
    });

    it("returns normalized keys for all stored entries", () => {
      manager.store("slides-outline", "a");
      manager.store("teams-review", "b");
      const keys = manager.keys();
      expect(keys).toContain("outline");
      expect(keys).toContain("review");
    });

    it("returns only one key per entry even with aliases", () => {
      manager.store("slides-outline", "a");
      manager.store("teams-review", "b");
      expect(manager.keys()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // getAll()
  // -------------------------------------------------------------------------

  describe("getAll()", () => {
    it("returns empty object when nothing stored", () => {
      expect(manager.getAll()).toEqual({});
    });

    it("returns a map of normalized key -> data", () => {
      manager.store("slides-outline", { outline: true });
      manager.store("my-skill", "text");
      const all = manager.getAll();
      expect(all["outline"]).toEqual({ outline: true });
      expect(all["my-skill"]).toBe("text");
    });
  });

  // -------------------------------------------------------------------------
  // importFrom()
  // -------------------------------------------------------------------------

  describe("importFrom()", () => {
    it("imports multiple entries from a plain object", () => {
      manager.importFrom({
        "slides-outline": { pages: 10 },
        summary: "brief text",
      });
      expect(manager.get("outline")).toEqual({ pages: 10 });
      expect(manager.get("summary")).toBe("brief text");
    });

    it("skips entries where value is undefined", () => {
      manager.importFrom({ "some-skill": undefined });
      expect(manager.has("some-skill")).toBe(false);
    });

    it("does not throw on an empty object", () => {
      expect(() => manager.importFrom({})).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // exportTo()
  // -------------------------------------------------------------------------

  describe("exportTo()", () => {
    it("returns empty object when nothing stored", () => {
      expect(manager.exportTo()).toEqual({});
    });

    it("includes normalized key in the export", () => {
      manager.store("slides-outline", { val: 1 });
      const exported = manager.exportTo();
      expect(exported["outline"]).toEqual({ val: 1 });
    });

    it("also includes original skill ID in the export for backward compat", () => {
      manager.store("slides-outline", { val: 1 });
      const exported = manager.exportTo();
      // Original ID is "slides-outline" (different from normalized "outline")
      expect(exported["slides-outline"]).toEqual({ val: 1 });
    });

    it("includes prefixed variants in the export", () => {
      manager.store("outline", { val: 2 });
      const exported = manager.exportTo();
      // Should contain prefixed variants e.g. "slides-outline"
      expect(exported["slides-outline"]).toEqual({ val: 2 });
    });
  });

  // -------------------------------------------------------------------------
  // getDebugInfo()
  // -------------------------------------------------------------------------

  describe("getDebugInfo()", () => {
    it("reports storeSize of 0 on empty manager", () => {
      const info = manager.getDebugInfo();
      expect(info.storeSize).toBe(0);
      expect(info.aliasCount).toBe(0);
      expect(info.entries).toHaveLength(0);
    });

    it("reports correct storeSize and entry info after storing", () => {
      manager.store("skill-a", "string-val");
      manager.store("skill-b", { obj: true });
      const info = manager.getDebugInfo();
      expect(info.storeSize).toBe(2);
      expect(info.entries).toHaveLength(2);
    });

    it("reports correct dataType for entries", () => {
      manager.store("text-skill", "hello");
      const info = manager.getDebugInfo();
      const entry = info.entries.find((e) => e.originalId === "text-skill");
      expect(entry?.dataType).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  // Custom config — knownPrefixes
  // -------------------------------------------------------------------------

  describe("custom config — knownPrefixes", () => {
    it("strips a custom prefix when configured", () => {
      const customManager = new SkillOutputManager({
        knownPrefixes: ["custom-"],
      });
      customManager.store("custom-result", "value");
      expect(customManager.get("result")).toBe("value");
    });

    it("does not strip default prefixes when custom knownPrefixes provided", () => {
      const customManager = new SkillOutputManager({
        knownPrefixes: ["custom-"],
      });
      customManager.store("slides-outline", "value");
      // "slides-" is not in knownPrefixes so the key stays as is
      expect(customManager.get("slides-outline")).toBe("value");
      // normalised key should not strip "slides-"
      expect(customManager.normalizeKey("slides-outline")).toBe(
        "slides-outline",
      );
    });
  });

  // -------------------------------------------------------------------------
  // createSkillOutputManager factory
  // -------------------------------------------------------------------------

  describe("createSkillOutputManager()", () => {
    it("returns a SkillOutputManager instance", () => {
      const m = createSkillOutputManager();
      expect(m).toBeDefined();
      expect(typeof m.store).toBe("function");
      expect(typeof m.get).toBe("function");
    });

    it("uses the default config when no options passed", () => {
      const m = createSkillOutputManager() as SkillOutputManager;
      // Default prefixes include "slides-"
      m.store("slides-abc", "val");
      expect(m.get("abc")).toBe("val");
    });

    it("respects custom config options", () => {
      const m = createSkillOutputManager({ knownPrefixes: ["proj-"] });
      m.store("proj-task", "val");
      expect(m.get("task")).toBe("val");
    });
  });
});
