/**
 * Unit tests for PromptSkillRegistrationService
 *
 * Uses manual instantiation to bypass forwardRef DI token issues.
 */

import { PromptSkillRegistrationService } from "../registration/prompt-skill-registration.service";
import { SkillRegistry } from "../../registry/skill.registry";
import { SkillLoaderService } from "../../loader/loading/skill-loader.service";
import { SkillPromptBuilder } from "../../builder/skill-prompt-builder.service";
import { SkillContentService } from "../../content/skill-content.service";
import { PromptSkillAdapter } from "../adapters/prompt-skill.adapter";
import { SkillMdDefinition } from "../../types/skill-md.types";
import { ISkill, SkillContext } from "../../abstractions/skill.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefinition(
  id: string,
  overrides: Partial<SkillMdDefinition["metadata"]> = {},
): SkillMdDefinition {
  return {
    metadata: {
      id,
      name: id,
      description: `Skill ${id}`,
      domain: "testing",
      version: "1.0.0",
      layer: "content",
      tags: [],
      taskTypes: ["*"] as unknown as string[],
      priority: 5,
      source: "local",
      ...overrides,
    } as SkillMdDefinition["metadata"],
    body: "You are a test assistant.",
    content: "You are a test assistant.",
    loadedAt: new Date(),
  };
}

function makeContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    executionId: "exec-001",
    skillId: "test-skill",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCodeSkill(id: string): ISkill {
  return {
    id,
    name: id,
    description: `Code skill ${id}`,
    layer: "content",
    domain: "testing",
    execute: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PromptSkillRegistrationService", () => {
  let bridge: PromptSkillRegistrationService;
  let mockRegistry: jest.Mocked<Pick<SkillRegistry, "register" | "tryGet">>;
  let mockLoader: jest.Mocked<Pick<SkillLoaderService, "loadLocalSkills">>;
  let mockBuilder: jest.Mocked<Pick<SkillPromptBuilder, "buildSystemPrompt">>;
  let mockPrisma: { aIUsageLog: { create: jest.Mock } };
  let mockContentService: { recordUsage: jest.Mock };
  const mockFacade = {
    chat: jest.fn().mockResolvedValue({ content: "{}", tokensUsed: 10 }),
  };

  beforeEach(() => {
    mockRegistry = {
      register: jest.fn(),
      tryGet: jest.fn().mockReturnValue(undefined),
    };

    mockLoader = {
      loadLocalSkills: jest.fn().mockResolvedValue([]),
    };

    mockBuilder = {
      buildSystemPrompt: jest
        .fn()
        .mockReturnValue({ prompt: "System prompt", tokensUsed: 50 }),
    };

    mockPrisma = {
      aIUsageLog: { create: jest.fn().mockResolvedValue({}) },
    };

    mockContentService = {
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };

    // Use manual instantiation to bypass forwardRef DI complexity
    bridge = new PromptSkillRegistrationService(
      mockRegistry as unknown as SkillRegistry,
      mockLoader as unknown as SkillLoaderService,
      mockBuilder as unknown as SkillPromptBuilder,
      mockPrisma as any,
      mockContentService as unknown as SkillContentService,
      mockFacade as any,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // registerDefinitions() — happy path
  // -------------------------------------------------------------------------

  describe("registerDefinitions() — normal registration", () => {
    it("registers a single prompt-mode skill definition", () => {
      mockRegistry.tryGet.mockReturnValue(undefined);

      const result = bridge.registerDefinitions([makeDefinition("skill-a")]);

      expect(result.registered).toContain("skill-a");
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(mockRegistry.register).toHaveBeenCalledTimes(1);
    });

    it("registers multiple definitions at once", () => {
      mockRegistry.tryGet.mockReturnValue(undefined);

      const result = bridge.registerDefinitions([
        makeDefinition("skill-a"),
        makeDefinition("skill-b"),
        makeDefinition("skill-c"),
      ]);

      expect(result.registered).toHaveLength(3);
      expect(mockRegistry.register).toHaveBeenCalledTimes(3);
    });

    it("creates a PromptSkillAdapter for each registered definition", () => {
      mockRegistry.tryGet.mockReturnValue(undefined);

      bridge.registerDefinitions([makeDefinition("test-skill")]);

      const registerCall = (mockRegistry.register as jest.Mock).mock
        .calls[0][0];
      expect(registerCall).toBeInstanceOf(PromptSkillAdapter);
      expect(registerCall.isPromptSkillAdapter).toBe(true);
    });

    it("returns empty arrays when given empty definitions list", () => {
      const result = bridge.registerDefinitions([]);
      expect(result.registered).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // registerDefinitions() — skipping
  // -------------------------------------------------------------------------

  describe("registerDefinitions() — skipping", () => {
    it('skips skills with executionMode "provider"', () => {
      const result = bridge.registerDefinitions([
        makeDefinition("provider-skill", { executionMode: "provider" }),
      ]);

      expect(result.skipped).toContain("provider-skill");
      expect(result.registered).toHaveLength(0);
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });

    it("skips when a code-based skill with the same ID already exists", () => {
      const codeSkill = makeCodeSkill("code-skill");
      // code-based skill does NOT have isPromptSkillAdapter
      mockRegistry.tryGet.mockReturnValue(codeSkill);

      const result = bridge.registerDefinitions([makeDefinition("code-skill")]);

      expect(result.skipped).toContain("code-skill");
      expect(result.registered).toHaveLength(0);
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });

    it("skips when a PromptSkillAdapter with the same ID already exists", () => {
      const existingAdapter = new PromptSkillAdapter(
        makeDefinition("dup-skill"),
        mockFacade as any,
        mockBuilder as unknown as SkillPromptBuilder,
      );
      mockRegistry.tryGet.mockReturnValue(existingAdapter);

      const result = bridge.registerDefinitions([makeDefinition("dup-skill")]);

      expect(result.skipped).toContain("dup-skill");
      expect(result.registered).toHaveLength(0);
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });

    it("mixes registered and skipped when some are new and some already exist", () => {
      mockRegistry.tryGet.mockImplementation((id: string) => {
        if (id === "existing-code") return makeCodeSkill("existing-code");
        return undefined;
      });

      const result = bridge.registerDefinitions([
        makeDefinition("new-skill"),
        makeDefinition("existing-code"),
      ]);

      expect(result.registered).toContain("new-skill");
      expect(result.skipped).toContain("existing-code");
    });
  });

  // -------------------------------------------------------------------------
  // registerDefinitions() — error handling
  // -------------------------------------------------------------------------

  describe("registerDefinitions() — error handling", () => {
    it("records errors when registry.register throws", () => {
      mockRegistry.tryGet.mockReturnValue(undefined);
      (mockRegistry.register as jest.Mock).mockImplementation(() => {
        throw new Error("Registry failure");
      });

      const result = bridge.registerDefinitions([makeDefinition("bad-skill")]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].id).toBe("bad-skill");
      expect(result.errors[0].error).toContain("Registry failure");
      expect(result.registered).toHaveLength(0);
    });

    it("continues processing remaining definitions after a single error", () => {
      mockRegistry.tryGet.mockReturnValue(undefined);

      let callCount = 0;
      (mockRegistry.register as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("First fails");
        // second succeeds
      });

      const result = bridge.registerDefinitions([
        makeDefinition("fail-skill"),
        makeDefinition("ok-skill"),
      ]);

      expect(result.errors).toHaveLength(1);
      expect(result.registered).toContain("ok-skill");
    });
  });

  // -------------------------------------------------------------------------
  // registerDomain()
  // -------------------------------------------------------------------------

  describe("registerDomain()", () => {
    it("loads skills for the specified domain and registers them", async () => {
      (mockLoader.loadLocalSkills as jest.Mock).mockResolvedValue([
        makeDefinition("domain-skill-1"),
        makeDefinition("domain-skill-2"),
      ]);
      mockRegistry.tryGet.mockReturnValue(undefined);

      const result = await bridge.registerDomain("writing");

      expect(mockLoader.loadLocalSkills).toHaveBeenCalledWith("writing");
      expect(result.registered).toHaveLength(2);
    });

    it("returns empty result when no skills found for domain", async () => {
      (mockLoader.loadLocalSkills as jest.Mock).mockResolvedValue([]);

      const result = await bridge.registerDomain("unknown-domain");

      expect(result.registered).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("propagates loadLocalSkills errors", async () => {
      (mockLoader.loadLocalSkills as jest.Mock).mockRejectedValue(
        new Error("Domain load failed"),
      );

      await expect(bridge.registerDomain("bad-domain")).rejects.toThrow(
        "Domain load failed",
      );
    });
  });

  // -------------------------------------------------------------------------
  // BridgeRegistrationResult structure
  // -------------------------------------------------------------------------

  describe("BridgeRegistrationResult structure", () => {
    it("always returns an object with registered, skipped, and errors arrays", () => {
      const result = bridge.registerDefinitions([]);
      expect(Array.isArray(result.registered)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Execution callback
  // -------------------------------------------------------------------------

  describe("execution callback", () => {
    it("passes executionCallback to PromptSkillAdapter during registration", () => {
      mockRegistry.tryGet.mockReturnValue(undefined);

      bridge.registerDefinitions([makeDefinition("callback-skill")]);

      const registerCall = (mockRegistry.register as jest.Mock).mock
        .calls[0][0] as PromptSkillAdapter;
      expect(registerCall).toBeInstanceOf(PromptSkillAdapter);
      // The adapter should have the callback wired — verify by executing
      // (indirect test: the adapter is created with 4 args including callback)
    });

    it("logs to AIUsageLog when adapter executes", async () => {
      mockRegistry.tryGet.mockReturnValue(undefined);

      bridge.registerDefinitions([makeDefinition("log-skill")]);

      const adapter = (mockRegistry.register as jest.Mock).mock
        .calls[0][0] as PromptSkillAdapter;

      // Execute the adapter to trigger the callback
      await adapter.execute(
        { topic: "test" },
        makeContext({ skillId: "log-skill" }),
      );

      // Wait for fire-and-forget to settle
      await new Promise((r) => setTimeout(r, 50));

      expect(mockPrisma.aIUsageLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          capabilityType: "skill",
          capabilityId: "log-skill",
          success: true,
        }),
      });
    });

    it("calls recordUsage when adapter executes", async () => {
      mockRegistry.tryGet.mockReturnValue(undefined);

      bridge.registerDefinitions([makeDefinition("usage-skill")]);

      const adapter = (mockRegistry.register as jest.Mock).mock
        .calls[0][0] as PromptSkillAdapter;
      await adapter.execute(
        { topic: "test" },
        makeContext({ skillId: "usage-skill" }),
      );

      // Wait for fire-and-forget
      await new Promise((r) => setTimeout(r, 50));

      expect(mockContentService.recordUsage).toHaveBeenCalledWith(
        "usage-skill",
      );
    });

    it("does not crash when AIUsageLog create fails", async () => {
      mockPrisma.aIUsageLog.create.mockRejectedValue(
        new Error("DB write failed"),
      );
      mockRegistry.tryGet.mockReturnValue(undefined);

      bridge.registerDefinitions([makeDefinition("fail-log-skill")]);

      const adapter = (mockRegistry.register as jest.Mock).mock
        .calls[0][0] as PromptSkillAdapter;
      // Should not throw
      const result = await adapter.execute(
        { topic: "test" },
        makeContext({ skillId: "fail-log-skill" }),
      );
      expect(result.success).toBe(true);
    });
  });
});
