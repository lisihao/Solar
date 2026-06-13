/**
 * Unit tests for InputBindingResolver
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  InputBindingResolver,
  BindingContext,
} from "../binding/skill-input-binding-resolver.service";
import { SkillInputBinding } from "../../types/skill-md.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function binding(from: string, required = false): SkillInputBinding {
  return { from, required };
}

function requiredBinding(from: string): SkillInputBinding {
  return { from, required: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InputBindingResolver", () => {
  let resolver: InputBindingResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InputBindingResolver],
    }).compile();

    resolver = module.get<InputBindingResolver>(InputBindingResolver);
  });

  // -------------------------------------------------------------------------
  // resolve() — outputManager source (no prefix)
  // -------------------------------------------------------------------------

  describe("resolve() — SkillOutputManager source (no prefix)", () => {
    it("resolves a value from outputManager by key", () => {
      const ctx: BindingContext = {
        outputManager: {
          get: jest.fn().mockImplementation((key: string) => {
            if (key === "task-decomposition") return { steps: ["a", "b"] };
            return undefined;
          }),
        },
      };

      const result = resolver.resolve(
        { steps: binding("task-decomposition") },
        ctx,
      );

      expect(result).toEqual({ steps: { steps: ["a", "b"] } });
    });

    it("returns empty object when outputManager returns undefined and binding is optional", () => {
      const ctx: BindingContext = {
        outputManager: { get: jest.fn().mockReturnValue(undefined) },
      };

      const result = resolver.resolve(
        { missing: binding("nonexistent", false) },
        ctx,
      );

      expect(result).toEqual({});
    });

    it("throws when outputManager returns undefined and binding is required", () => {
      const ctx: BindingContext = {
        outputManager: { get: jest.fn().mockReturnValue(undefined) },
      };

      expect(() =>
        resolver.resolve({ steps: requiredBinding("task-decomposition") }, ctx),
      ).toThrow(/Required input binding/);
    });

    it("falls back to previousOutputs when outputManager is absent", () => {
      const ctx: BindingContext = {
        previousOutputs: {
          "planning-result": { done: true },
          "slides-other": { x: 1 },
        },
      };

      const result = resolver.resolve(
        { plan: binding("planning-result") },
        ctx,
      );

      expect(result).toEqual({ plan: { done: true } });
    });

    it("falls back to slides-prefixed key in previousOutputs", () => {
      const ctx: BindingContext = {
        previousOutputs: {
          "slides-outline": { chapters: 5 },
        },
      };

      const result = resolver.resolve({ outline: binding("outline") }, ctx);

      expect(result).toEqual({ outline: { chapters: 5 } });
    });

    it("returns empty object when outputManager returns undefined and previousOutputs is also absent", () => {
      const ctx: BindingContext = {
        outputManager: { get: jest.fn().mockReturnValue(undefined) },
      };

      const result = resolver.resolve({ x: binding("no-data") }, ctx);
      expect(result).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // resolve() — context. prefix
  // -------------------------------------------------------------------------

  describe("resolve() — context. prefix", () => {
    it("resolves a top-level context field", () => {
      const ctx: BindingContext = {
        context: { sourceText: "hello world" },
      };

      const result = resolver.resolve(
        { text: binding("context.sourceText") },
        ctx,
      );

      expect(result).toEqual({ text: "hello world" });
    });

    it("resolves a nested context path using dot notation", () => {
      const ctx: BindingContext = {
        context: {
          project: {
            title: "My Novel",
            settings: { genre: "fantasy" },
          },
        },
      };

      const result = resolver.resolve(
        {
          title: binding("context.project.title"),
          genre: binding("context.project.settings.genre"),
        },
        ctx,
      );

      expect(result).toEqual({ title: "My Novel", genre: "fantasy" });
    });

    it("returns undefined for a missing nested context path", () => {
      const ctx: BindingContext = {
        context: { project: { title: "Book" } },
      };

      const result = resolver.resolve(
        { desc: binding("context.project.description") },
        ctx,
      );

      expect(result).toEqual({});
    });

    it("returns undefined when context itself is absent", () => {
      const ctx: BindingContext = {};

      const result = resolver.resolve(
        { text: binding("context.sourceText") },
        ctx,
      );

      expect(result).toEqual({});
    });

    it("throws when context path is required but missing", () => {
      const ctx: BindingContext = { context: {} };

      expect(() =>
        resolver.resolve(
          { text: requiredBinding("context.missingField") },
          ctx,
        ),
      ).toThrow(/Required input binding/);
    });
  });

  // -------------------------------------------------------------------------
  // resolve() — input. prefix
  // -------------------------------------------------------------------------

  describe("resolve() — input. prefix", () => {
    it("resolves a top-level input field", () => {
      const ctx: BindingContext = {
        input: { targetPages: [1, 2, 3] },
      };

      const result = resolver.resolve(
        { pages: binding("input.targetPages") },
        ctx,
      );

      expect(result).toEqual({ pages: [1, 2, 3] });
    });

    it("resolves a nested input path", () => {
      const ctx: BindingContext = {
        input: { options: { maxWords: 500 } },
      };

      const result = resolver.resolve(
        { max: binding("input.options.maxWords") },
        ctx,
      );

      expect(result).toEqual({ max: 500 });
    });

    it("returns empty when input field is missing and optional", () => {
      const ctx: BindingContext = { input: {} };

      const result = resolver.resolve(
        { pages: binding("input.targetPages") },
        ctx,
      );

      expect(result).toEqual({});
    });

    it("throws when input field is required but missing", () => {
      const ctx: BindingContext = { input: {} };

      expect(() =>
        resolver.resolve({ pages: requiredBinding("input.targetPages") }, ctx),
      ).toThrow(/Required input binding/);
    });

    it("returns empty when input itself is absent", () => {
      const ctx: BindingContext = {};

      const result = resolver.resolve(
        { pages: binding("input.targetPages") },
        ctx,
      );

      expect(result).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // resolve() — multiple bindings
  // -------------------------------------------------------------------------

  describe("resolve() — multiple bindings", () => {
    it("resolves multiple bindings from different sources", () => {
      const ctx: BindingContext = {
        outputManager: {
          get: jest
            .fn()
            .mockImplementation((key: string) =>
              key === "planning" ? { steps: 3 } : undefined,
            ),
        },
        context: { author: "Alice" },
        input: { format: "pdf" },
      };

      const result = resolver.resolve(
        {
          plan: binding("planning"),
          author: binding("context.author"),
          format: binding("input.format"),
        },
        ctx,
      );

      expect(result).toEqual({
        plan: { steps: 3 },
        author: "Alice",
        format: "pdf",
      });
    });

    it("returns empty object when no bindings provided", () => {
      const result = resolver.resolve({}, {});
      expect(result).toEqual({});
    });

    it("includes only bindings that resolved to a value", () => {
      const ctx: BindingContext = {
        context: { title: "Hello" },
      };

      const result = resolver.resolve(
        {
          title: binding("context.title"),
          missing: binding("context.nope"),
        },
        ctx,
      );

      expect(result).toEqual({ title: "Hello" });
      expect(result).not.toHaveProperty("missing");
    });
  });

  // -------------------------------------------------------------------------
  // resolve() — required bindings error message
  // -------------------------------------------------------------------------

  describe("resolve() — required binding error messages", () => {
    it("includes binding name and from path in the error", () => {
      const ctx: BindingContext = { context: {} };

      let errorMessage = "";
      try {
        resolver.resolve(
          { myParam: requiredBinding("context.missingData") },
          ctx,
        );
      } catch (e) {
        errorMessage = (e as Error).message;
      }

      expect(errorMessage).toContain("myParam");
      expect(errorMessage).toContain("context.missingData");
    });
  });

  // -------------------------------------------------------------------------
  // resolve() — edge cases
  // -------------------------------------------------------------------------

  describe("resolve() — edge cases", () => {
    it("resolves falsy value 0 as a valid resolved value", () => {
      const ctx: BindingContext = {
        context: { count: 0 },
      };

      const result = resolver.resolve({ count: binding("context.count") }, ctx);

      expect(result).toEqual({ count: 0 });
    });

    it("resolves false as a valid resolved value", () => {
      const ctx: BindingContext = {
        context: { enabled: false },
      };

      const result = resolver.resolve(
        { enabled: binding("context.enabled") },
        ctx,
      );

      expect(result).toEqual({ enabled: false });
    });

    it("resolves empty string as a valid resolved value", () => {
      const ctx: BindingContext = {
        context: { label: "" },
      };

      const result = resolver.resolve({ label: binding("context.label") }, ctx);

      expect(result).toEqual({ label: "" });
    });

    it("handles deeply nested paths with missing intermediate keys", () => {
      const ctx: BindingContext = {
        context: { a: { b: null } },
      };

      const result = resolver.resolve({ val: binding("context.a.b.c") }, ctx);

      // null.c is undefined → optional so result is empty
      expect(result).toEqual({});
    });
  });
});
