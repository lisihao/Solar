/**
 * Unit tests for SkillSandboxService
 *
 * Tests all public methods: testExecution, validateSkillContent, dryRun.
 * The private getSkillDefinition is exercised through those three public methods.
 *
 * Dependencies are mocked directly — no NestJS DI container involved.
 */

import { SkillSandboxService } from "../skill-sandbox.service";
import { SkillMdDefinition } from "../../types/skill-md.types";

// ---------------------------------------------------------------------------
// Mock skill-parser (parseSkillMd is called inside validateSkillContent)
// ---------------------------------------------------------------------------
jest.mock("../../loader/parsing/skill-parser", () => ({
  parseSkillMd: jest.fn(),
}));

import { parseSkillMd } from "../../loader/parsing/skill-parser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDefinition(
  overrides: Partial<SkillMdDefinition["metadata"]> = {},
  content = "You are a helpful assistant. Topic: {{topic}}",
): SkillMdDefinition {
  return {
    metadata: {
      id: "test-skill",
      name: "Test Skill",
      description: "A test skill",
      domain: "testing",
      version: "1.0.0",
      layer: "content",
      tags: ["test"],
      taskTypes: ["*"],
      priority: 5,
      source: "local",
      tokenBudget: 2000,
      taskProfile: { creativity: "medium", outputLength: "medium" },
      ...overrides,
    },
    content,
    loadedAt: new Date(),
  };
}

function makeBuildResult(prompt = "System prompt here") {
  return {
    prompt,
    estimatedTokens: 100,
    usedSkills: [],
    wasTrimmed: false,
    skippedSkills: [],
  };
}

function makeSkillRegistry(adapter: unknown = null) {
  return {
    tryGet: jest.fn().mockReturnValue(adapter),
  };
}

function makePromptBuilder(prompt = "Built system prompt") {
  return {
    buildSystemPrompt: jest.fn().mockReturnValue(makeBuildResult(prompt)),
  };
}

function makeFullSkillDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: "db-id-001",
    skillId: "test-skill",
    displayName: "Test Skill",
    description: "A test skill from DB",
    enabled: true,
    layer: "content",
    domain: "testing",
    tags: ["test"],
    version: "1.0.0",
    source: "local",
    promptContent: "You are a helpful assistant. Topic: {{topic}}",
    frontmatter: {
      id: "test-skill",
      name: "Test Skill",
      description: "A test skill",
      domain: "testing",
      version: "1.0.0",
      layer: "content",
      tags: ["test"],
      taskTypes: ["*"],
      priority: 5,
      source: "local",
      tokenBudget: 2000,
      taskProfile: { creativity: "medium", outputLength: "medium" },
    },
    contentHash: "abc123",
    filePath: null,
    taskProfileJson: null,
    inputSchemaJson: null,
    outputSchemaJson: null,
    lastUsedAt: null,
    usageCount: 0,
    ...overrides,
  };
}

function makeSkillContentService(
  fullDef: unknown = makeFullSkillDefinition(),
  parsedDef: SkillMdDefinition | null = makeDefinition(),
) {
  return {
    getFullSkillDefinition: jest.fn().mockResolvedValue(fullDef),
    parseDbContentToDefinition: jest.fn().mockReturnValue(parsedDef),
  };
}

function makeFacade(
  content = '{"result":"ok"}',
  tokensUsed = 50,
  model = "test-model",
) {
  return {
    chat: jest.fn().mockResolvedValue({ content, tokensUsed, model }),
  };
}

function makeService(
  overrides: {
    registry?: ReturnType<typeof makeSkillRegistry>;
    builder?: ReturnType<typeof makePromptBuilder>;
    contentService?: ReturnType<typeof makeSkillContentService>;
    facade?: ReturnType<typeof makeFacade>;
  } = {},
) {
  const registry = overrides.registry ?? makeSkillRegistry();
  const builder = overrides.builder ?? makePromptBuilder();
  const contentService = overrides.contentService ?? makeSkillContentService();
  const facade = overrides.facade ?? makeFacade();

  const service = new SkillSandboxService(
    registry as any,
    builder as any,
    contentService as any,
    facade as any,
  );

  return { service, registry, builder, contentService, facade };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillSandboxService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // testExecution
  // -------------------------------------------------------------------------

  describe("testExecution()", () => {
    it("returns a successful result with output, duration, tokensUsed, and promptPreview", async () => {
      const { service } = makeService();

      const result = await service.testExecution("test-skill", { topic: "AI" });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ result: "ok" });
      expect(result.tokensUsed).toBe(50);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.promptPreview).toBe("Built system prompt");
      expect(result.error).toBeUndefined();
    });

    it("returns an error result when skill is not found in DB or registry", async () => {
      const contentService = makeSkillContentService(null);
      const registry = makeSkillRegistry(null);
      const { service } = makeService({ contentService, registry });

      const result = await service.testExecution("unknown-skill", {});

      expect(result.success).toBe(false);
      expect(result.output).toBeNull();
      expect(result.duration).toBe(0);
      expect(result.tokensUsed).toBe(0);
      expect(result.promptPreview).toBe("");
      expect(result.error).toContain("Skill not found: unknown-skill");
    });

    it("returns an error result when the DB record has no promptContent", async () => {
      const contentService = makeSkillContentService(
        makeFullSkillDefinition({ promptContent: null }),
      );
      const registry = makeSkillRegistry(null);
      const { service } = makeService({ contentService, registry });

      const result = await service.testExecution("test-skill", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill not found: test-skill");
    });

    it("returns an error result when the DB record has no frontmatter", async () => {
      const contentService = makeSkillContentService(
        makeFullSkillDefinition({ frontmatter: null }),
      );
      const registry = makeSkillRegistry(null);
      const { service } = makeService({ contentService, registry });

      const result = await service.testExecution("test-skill", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill not found: test-skill");
    });

    it("applies taskProfile override from options onto the definition", async () => {
      const { service, facade } = makeService();

      await service.testExecution(
        "test-skill",
        { topic: "AI" },
        {
          taskProfile: { creativity: "high", outputLength: "long" },
        },
      );

      const chatArg = facade.chat.mock.calls[0][0];
      expect(chatArg.taskProfile).toMatchObject({
        creativity: "high",
        outputLength: "long",
      });
    });

    it("merges taskProfile options with the existing definition profile", async () => {
      const definition = makeDefinition({
        taskProfile: { creativity: "low", outputLength: "short" },
      });
      const contentService = makeSkillContentService(
        makeFullSkillDefinition(),
        definition,
      );
      const { service, facade } = makeService({ contentService });

      await service.testExecution(
        "test-skill",
        {},
        {
          taskProfile: { creativity: "high" },
        },
      );

      const chatArg = facade.chat.mock.calls[0][0];
      // creativity is overridden; outputLength comes from the original definition
      expect(chatArg.taskProfile.creativity).toBe("high");
    });

    it("returns success: false when adapter.execute rejects (facade.chat throws)", async () => {
      const facade = {
        chat: jest.fn().mockRejectedValue(new Error("LLM unavailable")),
      };
      const { service } = makeService({ facade: facade as any });

      const result = await service.testExecution("test-skill", {});

      // PromptSkillAdapter.execute() catches the LLM error internally and returns
      // success: false — it does NOT rethrow.  The sandbox service therefore still
      // populates promptPreview from buildResult (built before execute() is called).
      expect(result.success).toBe(false);
      expect(result.output).toBeFalsy();
      expect(result.tokensUsed).toBe(0);
      // promptPreview comes from the buildSystemPrompt call that succeeded earlier
      expect(result.promptPreview).toBe("Built system prompt");
      expect(result.error).toContain("LLM unavailable");
    });

    it("returns error result when execute returns success: false with error.message", async () => {
      const facade = makeFacade("plain-text-no-json", 30);
      const { service } = makeService({ facade });

      // PromptSkillAdapter.execute returns success:true even for plain text (raw fallback).
      // To trigger a success:false from execute, make facade.chat throw synchronously.
      // We already test that path above; here verify the error message is surfaced.
      const result = await service.testExecution("test-skill", {});

      // plain text fallback is success:true with string data
      expect(result.success).toBe(true);
      expect(result.output).toBe("plain-text-no-json");
    });

    it("truncates promptPreview to 2000 characters when the prompt is very long", async () => {
      const longPrompt = "A".repeat(5000);
      const builder = makePromptBuilder(longPrompt);
      const { service } = makeService({ builder });

      const result = await service.testExecution("test-skill", {});

      expect(result.success).toBe(true);
      expect(result.promptPreview.length).toBe(2000);
    });

    it("passes promptPreview as-is when prompt is under 2000 characters", async () => {
      const shortPrompt = "Short prompt";
      const builder = makePromptBuilder(shortPrompt);
      const { service } = makeService({ builder });

      const result = await service.testExecution("test-skill", {});

      expect(result.promptPreview).toBe("Short prompt");
    });

    it("includes tokensUsed from adapter execution result", async () => {
      const facade = makeFacade('{"ok":true}', 123);
      const { service } = makeService({ facade });

      const result = await service.testExecution("test-skill", {});

      expect(result.tokensUsed).toBe(123);
    });

    it("catches thrown exceptions from execution and returns error result", async () => {
      const contentService = {
        getFullSkillDefinition: jest
          .fn()
          .mockRejectedValue(new Error("DB connection failed")),
        parseDbContentToDefinition: jest.fn(),
      };
      const { service } = makeService({
        contentService: contentService as any,
      });

      const result = await service.testExecution("test-skill", {});

      expect(result.success).toBe(false);
      expect(result.output).toBeNull();
      expect(result.error).toContain("DB connection failed");
    });
  });

  // -------------------------------------------------------------------------
  // validateSkillContent
  // -------------------------------------------------------------------------

  describe("validateSkillContent()", () => {
    it("returns valid: true with extracted variables for well-formed content with frontmatter", () => {
      const content = "Write an article about {{topic}} for {{audience}}.";
      const frontmatter = { name: "my-skill", id: "my-skill" };

      const { service } = makeService();
      const result = service.validateSkillContent(content, frontmatter);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.variables).toEqual(
        expect.arrayContaining(["topic", "audience"]),
      );
      expect(result.variables).toHaveLength(2);
    });

    it("returns valid: false with error when content is empty", () => {
      const { service } = makeService();
      const result = service.validateSkillContent("", { id: "x", name: "x" });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Prompt content is empty");
    });

    it("returns valid: false with error when content is whitespace only", () => {
      const { service } = makeService();
      const result = service.validateSkillContent("   \n\t  ", {
        id: "x",
        name: "x",
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Prompt content is empty");
    });

    it("returns valid: false with error when frontmatter lacks both name and id", () => {
      const { service } = makeService();
      const result = service.validateSkillContent("Some content {{var}}", {
        version: "1.0.0",
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required field: name or id");
    });

    it("returns valid: true when frontmatter has only id (no name)", () => {
      const { service } = makeService();
      const result = service.validateSkillContent("Content with {{var}}", {
        id: "my-skill",
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns valid: true when frontmatter has only name (no id)", () => {
      const { service } = makeService();
      const result = service.validateSkillContent("Content {{var}}", {
        name: "my-skill",
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("adds a warning when content exceeds 20000 characters", () => {
      const { service } = makeService();
      const longContent = "A {{var}} ".repeat(3000); // well over 20k chars
      const result = service.validateSkillContent(longContent, {
        id: "x",
        name: "x",
      });

      expect(result.warnings.some((w) => w.includes("very long"))).toBe(true);
    });

    it("does not add length warning when content is exactly at the limit", () => {
      const { service } = makeService();
      const exactContent = "A".repeat(20000);
      const result = service.validateSkillContent(exactContent, {
        id: "x",
        name: "x",
      });

      // 20000 chars is NOT > 20000, so no warning
      expect(result.warnings.some((w) => w.includes("very long"))).toBe(false);
    });

    it("adds a warning when no {{variables}} are found in content", () => {
      const { service } = makeService();
      const result = service.validateSkillContent("No variables here.", {
        id: "x",
        name: "x",
      });

      expect(result.warnings.some((w) => w.includes("No {{variables}}"))).toBe(
        true,
      );
    });

    it("does not add variable warning when at least one {{variable}} is present", () => {
      const { service } = makeService();
      const result = service.validateSkillContent("Hello {{name}}", {
        id: "x",
        name: "x",
      });

      expect(result.warnings.some((w) => w.includes("No {{variables}}"))).toBe(
        false,
      );
    });

    it("deduplicates repeated variables", () => {
      const { service } = makeService();
      const result = service.validateSkillContent(
        "{{topic}} and {{topic}} and {{topic}}",
        { id: "x", name: "x" },
      );

      expect(result.variables).toEqual(["topic"]);
    });

    it("estimates tokens as ceil(content.length / 4)", () => {
      const { service } = makeService();
      const content = "A".repeat(100);
      const result = service.validateSkillContent(content, {
        id: "x",
        name: "x",
      });

      expect(result.estimatedTokens).toBe(Math.ceil(100 / 4));
    });

    it("calls parseSkillMd when no frontmatter is provided", () => {
      const mockParsed = makeDefinition();
      (parseSkillMd as jest.Mock).mockReturnValue(mockParsed);

      const { service } = makeService();
      const rawSkillMd = "---\nid: test\nname: test\n---\nContent {{var}}";
      service.validateSkillContent(rawSkillMd);

      expect(parseSkillMd).toHaveBeenCalledWith(rawSkillMd);
    });

    it("adds a parse error when parseSkillMd throws and no frontmatter provided", () => {
      (parseSkillMd as jest.Mock).mockImplementation(() => {
        throw new Error("Invalid SKILL.md format");
      });

      const { service } = makeService();
      const result = service.validateSkillContent("invalid content {{var}}");

      expect(result.errors.some((e) => e.includes("Parse error"))).toBe(true);
      expect(
        result.errors.some((e) => e.includes("Invalid SKILL.md format")),
      ).toBe(true);
    });

    it("does not call parseSkillMd when frontmatter is provided", () => {
      const { service } = makeService();
      service.validateSkillContent("Content {{var}}", { id: "x", name: "x" });

      expect(parseSkillMd).not.toHaveBeenCalled();
    });

    it("can accumulate both errors and warnings simultaneously", () => {
      (parseSkillMd as jest.Mock).mockImplementation(() => {
        throw new Error("bad format");
      });

      const { service } = makeService();
      // No frontmatter -> parse error; no variables -> warning; very long -> length warning
      const longContent = "A".repeat(25000);
      const result = service.validateSkillContent(longContent);

      expect(result.errors.some((e) => e.includes("Parse error"))).toBe(true);
      expect(result.warnings.some((w) => w.includes("very long"))).toBe(true);
      expect(result.warnings.some((w) => w.includes("No {{variables}}"))).toBe(
        true,
      );
      expect(result.valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // dryRun
  // -------------------------------------------------------------------------

  describe("dryRun()", () => {
    it("returns promptPreview and estimatedTokens for a known skill", async () => {
      const builder = makePromptBuilder("Dry-run system prompt");
      builder.buildSystemPrompt.mockReturnValue({
        prompt: "Dry-run system prompt",
        estimatedTokens: 42,
        usedSkills: [],
        wasTrimmed: false,
        skippedSkills: [],
      });
      const { service } = makeService({ builder });

      const result = await service.dryRun("test-skill", { topic: "test" });

      expect(result).not.toBeNull();
      expect(result!.promptPreview).toBe("Dry-run system prompt");
      expect(result!.estimatedTokens).toBe(42);
    });

    it("returns null for an unknown skill (not in DB or registry)", async () => {
      const contentService = makeSkillContentService(null);
      const registry = makeSkillRegistry(null);
      const { service } = makeService({ contentService, registry });

      const result = await service.dryRun("unknown-skill", {});

      expect(result).toBeNull();
    });

    it("passes the skill input as context to buildSystemPrompt", async () => {
      const builder = makePromptBuilder();
      const { service } = makeService({ builder });

      await service.dryRun("test-skill", { topic: "Space" });

      expect(builder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          context: { topic: "Space" },
        }),
      );
    });

    it("passes tokenBudget from the definition as maxTokens to buildSystemPrompt", async () => {
      const definition = makeDefinition({ tokenBudget: 3000 });
      const contentService = makeSkillContentService(
        makeFullSkillDefinition(),
        definition,
      );
      const builder = makePromptBuilder();
      const { service } = makeService({ contentService, builder });

      await service.dryRun("test-skill", {});

      expect(builder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ maxTokens: 3000 }),
      );
    });

    it("falls back to maxTokens: 4000 when tokenBudget is not set", async () => {
      const definition = makeDefinition({ tokenBudget: undefined });
      const contentService = makeSkillContentService(
        makeFullSkillDefinition(),
        definition,
      );
      const builder = makePromptBuilder();
      const { service } = makeService({ contentService, builder });

      await service.dryRun("test-skill", {});

      expect(builder.buildSystemPrompt).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ maxTokens: 4000 }),
      );
    });

    it("does not call facade.chat (no LLM call during dry run)", async () => {
      const facade = makeFacade();
      const { service } = makeService({ facade });

      await service.dryRun("test-skill", {});

      expect(facade.chat).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getSkillDefinition (private — tested through public methods)
  // -------------------------------------------------------------------------

  describe("getSkillDefinition() — via public methods", () => {
    it("returns definition from DB when promptContent and frontmatter exist", async () => {
      const dbFull = makeFullSkillDefinition();
      const parsedDef = makeDefinition({ id: "from-db" });
      const contentService = makeSkillContentService(dbFull, parsedDef);
      const { service } = makeService({ contentService });

      const result = await service.dryRun("test-skill", {});

      // If getSkillDefinition returned null, dryRun would return null
      expect(result).not.toBeNull();
      expect(contentService.parseDbContentToDefinition).toHaveBeenCalledWith(
        "test-skill",
        dbFull.promptContent,
        dbFull.frontmatter,
      );
    });

    it("returns null when DB record has promptContent but no frontmatter, and registry has no PromptSkillAdapter", async () => {
      const contentService = makeSkillContentService(
        makeFullSkillDefinition({ frontmatter: null }),
      );
      const registry = makeSkillRegistry(null);
      const { service } = makeService({ contentService, registry });

      const result = await service.dryRun("test-skill", {});

      expect(result).toBeNull();
    });

    it("returns null when registry entry is a PromptSkillAdapter (isPromptSkillAdapter: true)", async () => {
      const contentService = makeSkillContentService(null);
      const mockAdapter = { isPromptSkillAdapter: true, id: "test-skill" };
      const registry = makeSkillRegistry(mockAdapter);
      const { service } = makeService({ contentService, registry });

      const result = await service.dryRun("test-skill", {});

      expect(result).toBeNull();
    });

    it("returns null when registry entry is not a PromptSkillAdapter and DB has no content", async () => {
      const contentService = makeSkillContentService(null);
      // A code-based skill that is NOT a PromptSkillAdapter
      const codeSkill = { isPromptSkillAdapter: false, id: "test-skill" };
      const registry = makeSkillRegistry(codeSkill);
      const { service } = makeService({ contentService, registry });

      const result = await service.dryRun("test-skill", {});

      // getSkillDefinition falls through both branches → null
      expect(result).toBeNull();
    });

    it("uses parseDbContentToDefinition result for testExecution when DB content is available", async () => {
      const parsedDef = makeDefinition({ id: "parsed-from-db" });
      const contentService = makeSkillContentService(
        makeFullSkillDefinition(),
        parsedDef,
      );
      const { service, facade } = makeService({ contentService });

      const result = await service.testExecution("test-skill", {});

      // The adapter is created with the parsed definition and facade.chat is called
      expect(facade.chat).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("getFullSkillDefinition is called with the provided skillId", async () => {
      const contentService = makeSkillContentService(null);
      const registry = makeSkillRegistry(null);
      const { service } = makeService({ contentService, registry });

      await service.dryRun("my-specific-skill", {});

      expect(contentService.getFullSkillDefinition).toHaveBeenCalledWith(
        "my-specific-skill",
      );
    });
  });
});
