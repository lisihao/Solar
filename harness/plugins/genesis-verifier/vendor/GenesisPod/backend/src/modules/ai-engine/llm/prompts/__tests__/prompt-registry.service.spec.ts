/**
 * PromptRegistryService 单元测试
 *
 * 测试覆盖：
 * - register(): 注册、验证
 * - resolve(): 版本选择、变量插值、A/B 测试
 * - setActiveVersion(): 活跃版本管理
 * - getUsageStats(): 使用统计
 * - list() / get() / has(): 查询方法
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PromptRegistryService } from "../prompt-registry.service";

describe("PromptRegistryService", () => {
  let service: PromptRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PromptRegistryService],
    }).compile();

    service = module.get<PromptRegistryService>(PromptRegistryService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper: create a valid prompt definition
  function createPromptDef(overrides: any = {}) {
    return {
      id: "test-prompt",
      name: "Test Prompt",
      category: "testing",
      versions: [
        {
          version: "1.0",
          template: "Hello {{name}}, welcome to {{service}}!",
          variables: [
            { name: "name", required: true },
            { name: "service", required: false, defaultValue: "GenesisPod AI" },
          ],
        },
      ],
      ...overrides,
    };
  }

  // ============================================================================
  // register()
  // ============================================================================

  describe("register()", () => {
    it("should register a valid prompt definition", () => {
      service.register(createPromptDef());
      expect(service.has("test-prompt")).toBe(true);
    });

    it("should throw when id is missing", () => {
      expect(() => {
        service.register(createPromptDef({ id: "" }));
      }).toThrow("must have an id");
    });

    it("should throw when name is missing", () => {
      expect(() => {
        service.register(createPromptDef({ name: "" }));
      }).toThrow("must have a name");
    });

    it("should throw when category is missing", () => {
      expect(() => {
        service.register(createPromptDef({ category: "" }));
      }).toThrow("must have a category");
    });

    it("should throw when no versions provided", () => {
      expect(() => {
        service.register(createPromptDef({ versions: [] }));
      }).toThrow("must have at least one version");
    });

    it("should throw when version has no template", () => {
      expect(() => {
        service.register(
          createPromptDef({
            versions: [{ version: "1.0", template: "", variables: [] }],
          }),
        );
      }).toThrow("must have a template");
    });

    it("should throw when activeVersion does not exist", () => {
      expect(() => {
        service.register(createPromptDef({ activeVersion: "99.0" }));
      }).toThrow("not found in prompt");
    });
  });

  // ============================================================================
  // registerAll()
  // ============================================================================

  describe("registerAll()", () => {
    it("should register multiple prompts", () => {
      service.registerAll([
        createPromptDef({ id: "prompt-1" }),
        createPromptDef({ id: "prompt-2" }),
      ]);

      expect(service.has("prompt-1")).toBe(true);
      expect(service.has("prompt-2")).toBe(true);
    });
  });

  // ============================================================================
  // resolve()
  // ============================================================================

  describe("resolve()", () => {
    it("should resolve with variable interpolation", () => {
      service.register(createPromptDef());

      const result = service.resolve("test-prompt", { name: "Alice" });

      expect(result.content).toBe("Hello Alice, welcome to GenesisPod AI!");
      expect(result.version).toBe("1.0");
      expect(result.id).toBe("test-prompt");
    });

    it("should use provided values over defaults", () => {
      service.register(createPromptDef());

      const result = service.resolve("test-prompt", {
        name: "Bob",
        service: "OpenClaw",
      });

      expect(result.content).toBe("Hello Bob, welcome to OpenClaw!");
    });

    it("should throw for missing required variable without default", () => {
      service.register(createPromptDef());

      expect(() => {
        service.resolve("test-prompt", {}); // name is required, no default
      }).toThrow("Required variable missing: name");
    });

    it("should throw for non-existent prompt", () => {
      expect(() => {
        service.resolve("non-existent");
      }).toThrow("Prompt not found: non-existent");
    });

    it("should resolve specific version when requested", () => {
      service.register(
        createPromptDef({
          versions: [
            {
              version: "1.0",
              template: "Version 1: {{name}}",
              variables: [{ name: "name", required: true }],
            },
            {
              version: "2.0",
              template: "Version 2: {{name}}",
              variables: [{ name: "name", required: true }],
            },
          ],
        }),
      );

      const v1 = service.resolve("test-prompt", { name: "A" }, "1.0");
      const v2 = service.resolve("test-prompt", { name: "A" }, "2.0");

      expect(v1.content).toBe("Version 1: A");
      expect(v2.content).toBe("Version 2: A");
    });

    it("should use active version when set", () => {
      service.register(
        createPromptDef({
          activeVersion: "1.0",
          versions: [
            {
              version: "1.0",
              template: "Active: {{name}}",
              variables: [{ name: "name", required: true }],
            },
            {
              version: "2.0",
              template: "New: {{name}}",
              variables: [{ name: "name", required: true }],
            },
          ],
        }),
      );

      const result = service.resolve("test-prompt", { name: "A" });
      expect(result.content).toBe("Active: A");
    });

    it("should default to latest version when no active version", () => {
      service.register(
        createPromptDef({
          versions: [
            {
              version: "1.0",
              template: "Old: {{name}}",
              variables: [{ name: "name", required: true }],
            },
            {
              version: "2.0",
              template: "Latest: {{name}}",
              variables: [{ name: "name", required: true }],
            },
          ],
        }),
      );

      const result = service.resolve("test-prompt", { name: "A" });
      expect(result.content).toBe("Latest: A");
    });
  });

  // ============================================================================
  // A/B Testing
  // ============================================================================

  describe("A/B testing", () => {
    it("should select version based on weights", () => {
      service.register(
        createPromptDef({
          versions: [
            {
              version: "1.0",
              template: "A: {{name}}",
              variables: [{ name: "name", required: true }],
              metadata: { abWeight: 0.5 },
            },
            {
              version: "2.0",
              template: "B: {{name}}",
              variables: [{ name: "name", required: true }],
              metadata: { abWeight: 0.5 },
            },
          ],
        }),
      );

      const results = new Set<string>();
      // Run multiple times to test randomness
      for (let i = 0; i < 50; i++) {
        const result = service.resolve("test-prompt", { name: "A" });
        results.add(result.version);
      }

      // With 50 iterations and 50/50 weight, both versions should appear
      expect(results.size).toBe(2);
    });

    it("should include abGroup in metadata when using weighted versions", () => {
      service.register(
        createPromptDef({
          versions: [
            {
              version: "1.0",
              template: "Test: {{name}}",
              variables: [{ name: "name", required: true }],
              metadata: { abWeight: 1.0 },
            },
          ],
        }),
      );

      const result = service.resolve("test-prompt", { name: "A" });
      expect(result.metadata.abGroup).toBeDefined();
    });
  });

  // ============================================================================
  // setActiveVersion()
  // ============================================================================

  describe("setActiveVersion()", () => {
    it("should set active version", () => {
      service.register(
        createPromptDef({
          versions: [
            {
              version: "1.0",
              template: "V1: {{name}}",
              variables: [{ name: "name", required: true }],
            },
            {
              version: "2.0",
              template: "V2: {{name}}",
              variables: [{ name: "name", required: true }],
            },
          ],
        }),
      );

      service.setActiveVersion("test-prompt", "1.0");

      const result = service.resolve("test-prompt", { name: "A" });
      expect(result.content).toBe("V1: A");
    });

    it("should throw for non-existent prompt", () => {
      expect(() => {
        service.setActiveVersion("non-existent", "1.0");
      }).toThrow("Prompt not found");
    });

    it("should throw for non-existent version", () => {
      service.register(createPromptDef());

      expect(() => {
        service.setActiveVersion("test-prompt", "99.0");
      }).toThrow("Version 99.0 not found");
    });
  });

  // ============================================================================
  // getUsageStats()
  // ============================================================================

  describe("getUsageStats()", () => {
    it("should track usage after resolve", () => {
      service.register(createPromptDef());

      service.resolve("test-prompt", { name: "A" });
      service.resolve("test-prompt", { name: "B" });

      const stats = service.getUsageStats("test-prompt");

      expect(stats).toBeDefined();
      expect((stats as any).totalUses).toBe(2);
      expect((stats as any).byVersion["1.0"]).toBe(2);
    });

    it("should return all stats when no id specified", () => {
      service.register(createPromptDef({ id: "p1" }));
      service.register(createPromptDef({ id: "p2" }));

      service.resolve("p1", { name: "A" });

      const allStats = service.getUsageStats();
      expect(Array.isArray(allStats)).toBe(true);
      expect((allStats as any[]).length).toBe(2);
    });

    it("should throw for unknown prompt stats", () => {
      expect(() => {
        service.getUsageStats("non-existent");
      }).toThrow("Usage stats not found");
    });
  });

  // ============================================================================
  // list() / get() / has()
  // ============================================================================

  describe("query methods", () => {
    beforeEach(() => {
      service.register(createPromptDef({ id: "p1", category: "research" }));
      service.register(createPromptDef({ id: "p2", category: "teams" }));
      service.register(createPromptDef({ id: "p3", category: "research" }));
    });

    it("should list all prompts", () => {
      expect(service.list()).toHaveLength(3);
    });

    it("should filter by category", () => {
      const research = service.list("research");
      expect(research).toHaveLength(2);
    });

    it("should get by id", () => {
      const def = service.get("p1");
      expect(def).toBeDefined();
      expect(def?.name).toBe("Test Prompt");
    });

    it("should return undefined for unknown id", () => {
      expect(service.get("unknown")).toBeUndefined();
    });

    it("should check existence with has()", () => {
      expect(service.has("p1")).toBe(true);
      expect(service.has("unknown")).toBe(false);
    });
  });
});
