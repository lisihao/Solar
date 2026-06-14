/**
 * Tests for BaseSkill and createSkill factory
 */

import { BaseSkill, createSkill, ILLMAdapter } from "../base-skill";
import {
  SkillContext,
  SkillLayer,
  ISkill,
} from "../../abstractions/skill.interface";
import { ToolPipeline } from "../../../tools/middleware/tool-pipeline";
import { SkillError } from "@/modules/ai-engine/skills/abstractions/skill.error";

// Concrete implementation for testing
class SimpleSkill extends BaseSkill<string, string> {
  readonly id = "test-skill";
  readonly name = "Test Skill";
  readonly description = "A test skill";
  readonly layer: SkillLayer = "content";
  readonly domain = "test";

  async doExecute(input: string, _context: SkillContext): Promise<string> {
    return `processed: ${input}`;
  }
}

class FailingSkill extends BaseSkill<string, string> {
  readonly id = "failing-skill";
  readonly name = "Failing Skill";
  readonly description = "A skill that always fails";
  readonly layer: SkillLayer = "content";
  readonly domain = "test";

  async doExecute(_input: string, _context: SkillContext): Promise<string> {
    throw new Error("Intentional failure");
  }
}

class SkillWithDeps extends BaseSkill<string, string> {
  readonly id = "deps-skill";
  readonly name = "Deps Skill";
  readonly description = "Skill with dependencies";
  readonly layer: SkillLayer = "content";
  readonly domain = "test";
  readonly requiredTools = ["tool-x", "tool-y"];
  readonly requiredSkills = ["skill-a"];

  async doExecute(input: string, _context: SkillContext): Promise<string> {
    return input;
  }
}

function buildContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    executionId: "exec-123",
    skillId: "test-skill",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("BaseSkill", () => {
  let skill: SimpleSkill;

  beforeEach(() => {
    skill = new SimpleSkill();
  });

  // --- basic properties ---

  it("has correct id, name, description", () => {
    expect(skill.id).toBe("test-skill");
    expect(skill.name).toBe("Test Skill");
    expect(skill.description).toBe("A test skill");
  });

  it("has default version 1.0.0", () => {
    expect(skill.version).toBe("1.0.0");
  });

  it("has no required tools or skills by default", () => {
    expect(skill.requiredTools).toBeUndefined();
    expect(skill.requiredSkills).toBeUndefined();
  });

  // --- execute success ---

  it("returns success result with data on successful execution", async () => {
    const context = buildContext();
    const result = await skill.execute("hello", context);

    expect(result.success).toBe(true);
    expect(result.data).toBe("processed: hello");
    expect(result.error).toBeUndefined();
  });

  it("includes execution metadata in result", async () => {
    const context = buildContext({ executionId: "my-exec-id" });
    const result = await skill.execute("test", context);

    expect(result.metadata).toBeDefined();
    expect(result.metadata.executionId).toBe("my-exec-id");
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    expect(result.metadata.startTime).toBeInstanceOf(Date);
    expect(result.metadata.endTime).toBeInstanceOf(Date);
  });

  it("generates executionId when not provided in context", async () => {
    const context = buildContext({ executionId: undefined as any });
    const result = await skill.execute("test", context);
    expect(result.metadata.executionId).toBeDefined();
    expect(typeof result.metadata.executionId).toBe("string");
  });

  // --- execute failure ---

  it("returns error result when doExecute throws", async () => {
    const failSkill = new FailingSkill();
    const result = await failSkill.execute("test", buildContext());

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe("Intentional failure");
    expect(result.data).toBeUndefined();
  });

  it("includes metadata even on failure", async () => {
    const failSkill = new FailingSkill();
    const result = await failSkill.execute("test", buildContext());
    expect(result.metadata).toBeDefined();
  });

  // --- cancellation ---

  it("returns cancelled error when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const context = buildContext({ signal: controller.signal });

    const result = await skill.execute("test", context);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBeDefined();
  });

  // --- fallback ---

  it("uses fallback skill when primary fails and fallback is defined", async () => {
    class FallbackEnabledSkill extends FailingSkill {
      private readonly _fallback = new SimpleSkill();

      getFallback(): ISkill<string, string> {
        return this._fallback;
      }
    }

    const skillWithFallback = new FallbackEnabledSkill();
    const result = await skillWithFallback.execute("test", buildContext());

    expect(result.success).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.data).toBe("processed: test");
  });

  it("returns error when both primary and fallback fail", async () => {
    class DoubleFailSkill extends FailingSkill {
      getFallback(): ISkill<string, string> {
        return new FailingSkill();
      }
    }

    const skill = new DoubleFailSkill();
    const result = await skill.execute("test", buildContext());

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // --- stats ---

  it("tracks success and failure counts", async () => {
    const failSkill = new FailingSkill();
    await skill.execute("test", buildContext());
    await skill.execute("test", buildContext());
    await failSkill.execute("test", buildContext());

    expect(skill.getStats().successCount).toBe(2);
    expect(skill.getStats().totalExecutions).toBe(2);
    expect(failSkill.getStats().failureCount).toBe(1);
  });

  // --- setToolRegistry / setLLMAdapter ---

  it("setToolRegistry sets the registry", () => {
    const mockRegistry = {} as any;
    skill.setToolRegistry(mockRegistry);
    expect((skill as any).toolRegistry).toBe(mockRegistry);
  });

  it("setLLMAdapter sets the adapter", () => {
    const mockAdapter: ILLMAdapter = {
      chat: jest.fn().mockResolvedValue({ content: "response" }),
    };
    skill.setLLMAdapter(mockAdapter);
    expect((skill as any).llmAdapter).toBe(mockAdapter);
  });

  // --- callLLM ---

  it("callLLM calls llmAdapter.chat and returns content", async () => {
    class LLMSkill extends SimpleSkill {
      async callLLMPublic(sys: string, usr: string): Promise<string> {
        return this.callLLM(sys, usr);
      }
    }
    const s = new LLMSkill();
    const mockAdapter: ILLMAdapter = {
      chat: jest.fn().mockResolvedValue({ content: "llm-response" }),
    };
    s.setLLMAdapter(mockAdapter);

    const result = await s.callLLMPublic("system prompt", "user prompt");
    expect(result).toBe("llm-response");
    expect(mockAdapter.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "user prompt" },
        ],
      }),
    );
  });

  it("callLLM throws SkillError when no adapter set", async () => {
    class LLMSkill extends SimpleSkill {
      async callLLMPublic(): Promise<string> {
        return this.callLLM("sys", "usr");
      }
    }
    const s = new LLMSkill();
    await expect(s.callLLMPublic()).rejects.toThrow();
  });

  // --- validateSchema ---

  it("validateSchema returns valid for matching object type", () => {
    class ValidateSkill extends SimpleSkill {
      validate(data: unknown, schema: any) {
        return this.validateSchema(data, schema);
      }
    }
    const s = new ValidateSkill();
    const result = s.validate({ name: "test" }, { type: "object" });
    expect(result.valid).toBe(true);
  });

  it("validateSchema returns invalid when type does not match", () => {
    class ValidateSkill extends SimpleSkill {
      validate(data: unknown, schema: any) {
        return this.validateSchema(data, schema);
      }
    }
    const s = new ValidateSkill();
    const result = s.validate("not an object", { type: "object" });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("validateSchema reports missing required fields", () => {
    class ValidateSkill extends SimpleSkill {
      validate(data: unknown, schema: any) {
        return this.validateSchema(data, schema);
      }
    }
    const s = new ValidateSkill();
    const result = s.validate(
      {},
      { type: "object", required: ["name", "age"] },
    );
    expect(result.valid).toBe(false);
    expect(result.errors!.length).toBe(2);
  });

  it("validateSchema returns valid for arrays", () => {
    class ValidateSkill extends SimpleSkill {
      validate(data: unknown, schema: any) {
        return this.validateSchema(data, schema);
      }
    }
    const s = new ValidateSkill();
    expect(s.validate([], { type: "array" }).valid).toBe(true);
  });

  it("validateSchema returns invalid for non-array when array expected", () => {
    class ValidateSkill extends SimpleSkill {
      validate(data: unknown, schema: any) {
        return this.validateSchema(data, schema);
      }
    }
    const s = new ValidateSkill();
    expect(s.validate({}, { type: "array" }).valid).toBe(false);
  });

  // --- parseJsonResponse ---

  it("parseJsonResponse parses plain JSON string", () => {
    class ParseSkill extends SimpleSkill {
      parse<T>(content: string, fallback?: T): T {
        return this.parseJsonResponse<T>(content, fallback);
      }
    }
    const s = new ParseSkill();
    const result = s.parse<{ name: string }>('{"name":"Alice"}');
    expect(result.name).toBe("Alice");
  });

  it("parseJsonResponse extracts JSON from code block", () => {
    class ParseSkill extends SimpleSkill {
      parse<T>(content: string, fallback?: T): T {
        return this.parseJsonResponse<T>(content, fallback);
      }
    }
    const s = new ParseSkill();
    const content = '```json\n{"value":42}\n```';
    const result = s.parse<{ value: number }>(content);
    expect(result.value).toBe(42);
  });

  it("parseJsonResponse returns fallback when JSON is invalid", () => {
    class ParseSkill extends SimpleSkill {
      parse<T>(content: string, fallback?: T): T {
        return this.parseJsonResponse<T>(content, fallback);
      }
    }
    const s = new ParseSkill();
    const result = s.parse<string[]>("not json", []);
    expect(result).toEqual([]);
  });

  it("parseJsonResponse throws when JSON is invalid and no fallback", () => {
    class ParseSkill extends SimpleSkill {
      parse<T>(content: string): T {
        return this.parseJsonResponse<T>(content);
      }
    }
    const s = new ParseSkill();
    expect(() => s.parse("not valid json")).toThrow(
      "Failed to parse JSON response",
    );
  });
});

// --- callTool with ToolPipeline ---

describe("BaseSkill.callTool with ToolPipeline", () => {
  class CallToolSkill extends BaseSkill<string, string> {
    readonly id = "call-tool-skill";
    readonly name = "Call Tool Skill";
    readonly description = "Skill that calls a tool";
    readonly layer: SkillLayer = "content";
    readonly domain = "test";

    async doExecute(input: string, _context: SkillContext): Promise<string> {
      return input;
    }

    // Expose callTool for testing
    public async callToolPublic<T>(
      toolId: string,
      input: unknown,
      context: SkillContext,
    ): Promise<T> {
      return this.callTool<T>(toolId, input, context);
    }
  }

  function buildToolContext(): SkillContext {
    return {
      executionId: "exec-pipeline-test",
      skillId: "call-tool-skill",
      createdAt: new Date(),
    };
  }

  it("routes callTool through pipeline.execute when pipeline is set", async () => {
    const skill = new CallToolSkill();

    const toolResult = {
      success: true as const,
      data: { answer: 42 },
      metadata: {
        executionId: "e",
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
      },
    };
    const mockTool = { execute: jest.fn().mockResolvedValue(toolResult) };
    const mockRegistry = { tryGet: jest.fn().mockReturnValue(mockTool) } as any;
    skill.setToolRegistry(mockRegistry);

    const mockPipeline = {
      execute: jest.fn().mockResolvedValue(toolResult),
    } as unknown as ToolPipeline;
    skill.setToolPipeline(mockPipeline);

    await skill.callToolPublic("my-tool", { q: "test" }, buildToolContext());

    expect(mockPipeline.execute).toHaveBeenCalledTimes(1);
    expect(mockTool.execute).not.toHaveBeenCalled();
  });

  it("falls back to tool.execute when no pipeline is set", async () => {
    const skill = new CallToolSkill();

    const toolResult = {
      success: true as const,
      data: "direct",
      metadata: {
        executionId: "e",
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
      },
    };
    const mockTool = { execute: jest.fn().mockResolvedValue(toolResult) };
    const mockRegistry = { tryGet: jest.fn().mockReturnValue(mockTool) } as any;
    skill.setToolRegistry(mockRegistry);
    // do NOT call setToolPipeline

    await skill.callToolPublic("my-tool", {}, buildToolContext());

    expect(mockTool.execute).toHaveBeenCalledTimes(1);
  });

  it("throws SkillError when pipeline returns a failure result", async () => {
    const skill = new CallToolSkill();

    const failResult = {
      success: false as const,
      error: { code: "TOOL_ERR", message: "pipeline error" },
      metadata: {
        executionId: "e",
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
      },
    };
    const mockTool = { execute: jest.fn() };
    const mockRegistry = { tryGet: jest.fn().mockReturnValue(mockTool) } as any;
    skill.setToolRegistry(mockRegistry);

    const mockPipeline = {
      execute: jest.fn().mockResolvedValue(failResult),
    } as unknown as ToolPipeline;
    skill.setToolPipeline(mockPipeline);

    await expect(
      skill.callToolPublic("my-tool", {}, buildToolContext()),
    ).rejects.toThrow(SkillError);
  });
});

// --- checkPreconditions ---

describe("BaseSkill.checkPreconditions", () => {
  it("returns satisfied when no required tools or skills", async () => {
    const skill = new SimpleSkill();
    const context = buildContext({ availableSkills: [] });
    const result = await skill.checkPreconditions(context);
    expect(result.satisfied).toBe(true);
  });

  it("returns unsatisfied when required tool is missing from registry", async () => {
    const skill = new SkillWithDeps();
    const mockRegistry = { has: jest.fn().mockReturnValue(false) } as any;
    skill.setToolRegistry(mockRegistry);

    const result = await skill.checkPreconditions(buildContext());
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("tool:tool-x");
  });

  it("returns unsatisfied when required skill is not available", async () => {
    const skill = new SkillWithDeps();
    const context = buildContext({ availableSkills: [] }); // skill-a missing

    const result = await skill.checkPreconditions(context);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toContain("skill:skill-a");
  });

  it("returns satisfied when all required tools are registered", async () => {
    const skill = new SkillWithDeps();
    const mockRegistry = { has: jest.fn().mockReturnValue(true) } as any;
    skill.setToolRegistry(mockRegistry);
    const context = buildContext({ availableSkills: ["skill-a"] });

    const result = await skill.checkPreconditions(context);
    expect(result.satisfied).toBe(true);
  });
});

// --- createSkill factory ---

describe("createSkill", () => {
  it("creates a skill with correct properties", () => {
    const skill = createSkill({
      id: "my-skill",
      name: "My Skill",
      description: "A created skill",
      layer: "content",
      domain: "test",
      execute: async (input: string) => `result: ${input}`,
    });

    expect(skill.id).toBe("my-skill");
    expect(skill.name).toBe("My Skill");
    expect(skill.domain).toBe("test");
  });

  it("execute returns success result", async () => {
    const skill = createSkill({
      id: "factory-skill",
      name: "Factory Skill",
      description: "desc",
      layer: "content",
      domain: "test",
      execute: async (input: number) => input * 2,
    });

    const result = await skill.execute(5, buildContext());
    expect(result.success).toBe(true);
    expect(result.data).toBe(10);
    expect(result.metadata.executionId).toBeDefined();
  });

  it("execute returns error result on failure", async () => {
    const skill = createSkill({
      id: "failing-factory",
      name: "Failing Factory",
      description: "desc",
      layer: "content",
      domain: "test",
      execute: async () => {
        throw new Error("factory error");
      },
    });

    const result = await skill.execute(null, buildContext());
    expect(result.success).toBe(false);
    expect(result.error!.message).toBe("factory error");
  });

  it("passes optional fields to skill", () => {
    const skill = createSkill({
      id: "tagged-skill",
      name: "Tagged",
      description: "desc",
      layer: "planning",
      domain: "research",
      execute: async () => "ok",
      tags: ["tag1", "tag2"],
      requiredTools: ["search-tool"],
    });

    expect(skill.tags).toEqual(["tag1", "tag2"]);
    expect(skill.requiredTools).toEqual(["search-tool"]);
  });
});

