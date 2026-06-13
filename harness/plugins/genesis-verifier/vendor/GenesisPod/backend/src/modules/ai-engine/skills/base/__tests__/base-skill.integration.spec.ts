/**
 * BaseSkill - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - checkPreconditions returning { satisfied: false } → SkillError.preconditionFailed (line 183)
 *  - fallback.execute() itself throws (line 219 catch block)
 *  - callTool: missing toolRegistry, tool not found, tool failure (lines 299-329)
 *  - callLLM: llmAdapter.chat() throws (line 355)
 *  - validateSchema: null/undefined schema (line 368), string mismatch (line 381), number mismatch (line 387)
 */

import { BaseSkill, ILLMAdapter } from "../base-skill";
import { SkillContext, SkillLayer } from "../../abstractions/skill.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class SimpleSkill extends BaseSkill<string, string> {
  readonly id = "test-skill";
  readonly name = "Test Skill";
  readonly description = "A test skill";
  readonly layer: SkillLayer = "content";
  readonly domain = "test";

  async doExecute(input: string): Promise<string> {
    return `processed: ${input}`;
  }
}

class FailingSkill extends BaseSkill<string, string> {
  readonly id = "failing-skill";
  readonly name = "Failing Skill";
  readonly description = "A skill that always fails";
  readonly layer: SkillLayer = "content";
  readonly domain = "test";

  async doExecute(): Promise<string> {
    throw new Error("Intentional failure");
  }
}

function buildContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    executionId: "exec-ext",
    skillId: "test-skill",
    createdAt: new Date(),
    ...overrides,
  };
}

// Expose protected methods for testing
class TestableSkill extends SimpleSkill {
  callToolPublic<T>(
    toolId: string,
    input: unknown,
    ctx: SkillContext,
  ): Promise<T> {
    return this.callTool<T>(toolId, input, ctx);
  }

  callLLMPublic(sys: string, usr: string): Promise<string> {
    return this.callLLM(sys, usr);
  }

  validateSchemaPublic(data: unknown, schema: unknown) {
    return this.validateSchema(
      data,
      schema as Parameters<typeof this.validateSchema>[1],
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BaseSkill (extended coverage)", () => {
  // =========================================================================
  // checkPreconditions returning { satisfied: false }
  // =========================================================================

  describe("checkPreconditions", () => {
    it("returns skill error when precondition not satisfied (with reason)", async () => {
      class PreconditionSkill extends SimpleSkill {
        async checkPreconditions() {
          return { satisfied: false, reason: "Missing data" };
        }
      }

      const skill = new PreconditionSkill();
      const result = await skill.execute("test", buildContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Missing data");
    });

    it("returns skill error when precondition not satisfied (without reason)", async () => {
      class PreconditionSkill extends SimpleSkill {
        async checkPreconditions() {
          return { satisfied: false };
        }
      }

      const skill = new PreconditionSkill();
      const result = await skill.execute("test", buildContext());

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // =========================================================================
  // Fallback execute() actually throws (line 218-222)
  // =========================================================================

  describe("fallback execute() itself throws", () => {
    it("falls through to primary error when fallback.execute() throws", async () => {
      class ThrowingFallback extends BaseSkill<string, string> {
        readonly id = "throwing-fallback";
        readonly name = "Throwing Fallback";
        readonly description = "";
        readonly layer: SkillLayer = "content";
        readonly domain = "test";

        async doExecute(): Promise<string> {
          return "ok";
        }

        // Override execute to actually throw (simulating catastrophic failure)
        async execute(): Promise<{
          success: boolean;
          error?: unknown;
          data?: string;
          metadata: unknown;
          usedFallback?: boolean;
        }> {
          throw new Error("Fallback execute crashed");
        }
      }

      class PrimaryWithCrashingFallback extends FailingSkill {
        private readonly _fb = new ThrowingFallback();
        getFallback() {
          return this._fb;
        }
      }

      const skill = new PrimaryWithCrashingFallback();
      const result = await skill.execute("test", buildContext());

      // Should return the primary error (fallback crash is logged, not propagated)
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe("Intentional failure");
    });
  });

  // =========================================================================
  // callTool paths (lines 299-329)
  // =========================================================================

  describe("callTool", () => {
    it("throws SkillError when toolRegistry is not set", async () => {
      const skill = new TestableSkill();
      // toolRegistry is not set

      await expect(
        skill.callToolPublic("some-tool", {}, buildContext()),
      ).rejects.toThrow();
    });

    it("throws SkillError when tool is not found in registry", async () => {
      const skill = new TestableSkill();
      const mockRegistry = {
        tryGet: jest.fn().mockReturnValue(null),
      };
      skill.setToolRegistry(
        mockRegistry as unknown as Parameters<typeof skill.setToolRegistry>[0],
      );

      await expect(
        skill.callToolPublic("missing-tool", {}, buildContext()),
      ).rejects.toThrow();
    });

    it("throws SkillError when tool execution fails", async () => {
      const skill = new TestableSkill();
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: { message: "Tool failed: division by zero" },
        }),
      };
      const mockRegistry = {
        tryGet: jest.fn().mockReturnValue(mockTool),
      };
      skill.setToolRegistry(
        mockRegistry as unknown as Parameters<typeof skill.setToolRegistry>[0],
      );

      await expect(
        skill.callToolPublic("my-tool", {}, buildContext()),
      ).rejects.toThrow();
    });

    it("returns tool data when tool execution succeeds", async () => {
      const skill = new TestableSkill();
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { answer: 42 },
        }),
      };
      const mockRegistry = {
        tryGet: jest.fn().mockReturnValue(mockTool),
      };
      skill.setToolRegistry(
        mockRegistry as unknown as Parameters<typeof skill.setToolRegistry>[0],
      );

      const result = await skill.callToolPublic<{ answer: number }>(
        "my-tool",
        { query: "test" },
        buildContext(),
      );

      expect(result.answer).toBe(42);
    });
  });

  // =========================================================================
  // callLLM: adapter throws (line 355)
  // =========================================================================

  describe("callLLM", () => {
    it("throws SkillError when llmAdapter.chat() throws", async () => {
      const skill = new TestableSkill();
      const mockAdapter: ILLMAdapter = {
        chat: jest.fn().mockRejectedValue(new Error("LLM error")),
      };
      skill.setLLMAdapter(mockAdapter);

      await expect(skill.callLLMPublic("sys", "usr")).rejects.toThrow();
    });
  });

  // =========================================================================
  // validateSchema: null/undefined schema, string/number mismatch
  // =========================================================================

  describe("validateSchema", () => {
    let skill: TestableSkill;

    beforeEach(() => {
      skill = new TestableSkill();
    });

    it("returns valid when schema is null/undefined", () => {
      const result = skill.validateSchemaPublic({ name: "test" }, null);
      expect(result.valid).toBe(true);
    });

    it("returns valid when data is null/undefined", () => {
      const result = skill.validateSchemaPublic(null, { type: "object" });
      expect(result.valid).toBe(true);
    });

    it("returns invalid when string type expected but got object", () => {
      const result = skill.validateSchemaPublic(
        { key: "val" },
        { type: "string" },
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toContain("Expected string");
    });

    it("returns valid when string type matches", () => {
      const result = skill.validateSchemaPublic("hello", { type: "string" });
      expect(result.valid).toBe(true);
    });

    it("returns invalid when number type expected but got string", () => {
      const result = skill.validateSchemaPublic("42", { type: "number" });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toContain("Expected number");
    });

    it("returns valid when number type matches", () => {
      const result = skill.validateSchemaPublic(42, { type: "number" });
      expect(result.valid).toBe(true);
    });
  });
});
