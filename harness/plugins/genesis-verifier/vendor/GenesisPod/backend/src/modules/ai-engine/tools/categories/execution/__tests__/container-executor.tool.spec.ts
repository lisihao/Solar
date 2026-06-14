import {
  ContainerExecutorTool,
  SupportedLanguage,
  DEFAULT_RUNTIMES,
} from "../container-executor.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "container-executor",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("ContainerExecutorTool", () => {
  let tool: ContainerExecutorTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new ContainerExecutorTool();
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id 'container-executor'", () => {
      expect(tool.id).toBe("container-executor");
    });

    it("should have category 'execution'", () => {
      expect(tool.category).toBe("execution");
    });

    it("should have a non-empty name", () => {
      expect(tool.name.length).toBeGreaterThan(0);
    });

    it("should have a non-empty description", () => {
      expect(tool.description.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // DEFAULT_RUNTIMES constant
  // --------------------------------------------------------------------------

  describe("DEFAULT_RUNTIMES", () => {
    it("should define a runtime for Python", () => {
      expect(DEFAULT_RUNTIMES[SupportedLanguage.PYTHON]).toBeDefined();
      expect(DEFAULT_RUNTIMES[SupportedLanguage.PYTHON].image).toContain(
        "python",
      );
    });

    it("should define a runtime for JavaScript", () => {
      expect(DEFAULT_RUNTIMES[SupportedLanguage.JAVASCRIPT]).toBeDefined();
      expect(DEFAULT_RUNTIMES[SupportedLanguage.JAVASCRIPT].image).toContain(
        "node",
      );
    });

    it("should define a runtime for all supported languages", () => {
      const supportedLanguages = Object.values(SupportedLanguage);
      supportedLanguages.forEach((lang) => {
        expect(DEFAULT_RUNTIMES[lang]).toBeDefined();
      });
    });

    it("should have file extension for each runtime", () => {
      Object.values(DEFAULT_RUNTIMES).forEach((runtime) => {
        expect(runtime.extension).toBeTruthy();
        expect(runtime.extension.startsWith(".")).toBe(true);
      });
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for valid Python code and language", () => {
      expect(
        tool.validateInput({
          code: "print('Hello World')",
          language: SupportedLanguage.PYTHON,
        }),
      ).toBe(true);
    });

    it("should return true for valid JavaScript code and language", () => {
      expect(
        tool.validateInput({
          code: "console.log('Hello')",
          language: SupportedLanguage.JAVASCRIPT,
        }),
      ).toBe(true);
    });

    it("should return false when code is empty string", () => {
      expect(
        tool.validateInput({ code: "", language: SupportedLanguage.PYTHON }),
      ).toBe(false);
    });

    it("should return false when code is null-like", () => {
      expect(
        tool.validateInput({
          code: null as unknown as string,
          language: SupportedLanguage.PYTHON,
        }),
      ).toBe(false);
    });

    it("should return false when language is empty string", () => {
      expect(tool.validateInput({ code: "print('hi')", language: "" })).toBe(
        false,
      );
    });

    it("should return false for unsupported language", () => {
      expect(tool.validateInput({ code: "code here", language: "cobol" })).toBe(
        false,
      );
    });

    it("should return false when memoryLimit is negative", () => {
      expect(
        tool.validateInput({
          code: "print('hi')",
          language: SupportedLanguage.PYTHON,
          options: { memoryLimit: -128 },
        }),
      ).toBe(false);
    });

    it("should return false when cpuLimit is negative", () => {
      expect(
        tool.validateInput({
          code: "print('hi')",
          language: SupportedLanguage.PYTHON,
          options: { cpuLimit: -1 },
        }),
      ).toBe(false);
    });

    it("should return true with valid options", () => {
      expect(
        tool.validateInput({
          code: "print('hi')",
          language: SupportedLanguage.PYTHON,
          options: {
            timeout: 10000,
            memoryLimit: 256,
            cpuLimit: 0.5,
            networkEnabled: false,
          },
        }),
      ).toBe(true);
    });

    it("should return true for all supported languages", () => {
      const supportedLanguages = Object.values(SupportedLanguage);
      supportedLanguages.forEach((lang) => {
        expect(tool.validateInput({ code: "code", language: lang })).toBe(true);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Execution — not implemented, should return success:false + error
  // --------------------------------------------------------------------------

  describe("execution - not implemented", () => {
    it("should return success:false for Python code (not implemented)", async () => {
      const result = await tool.execute(
        { code: "print('Hello World')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.success).toBe(true); // ToolResult.success (doExecute didn't throw)
      expect(result.data?.success).toBe(false);
    });

    it("should return exit code -1 when not implemented", async () => {
      const result = await tool.execute(
        { code: "console.log('test')", language: SupportedLanguage.JAVASCRIPT },
        createMockContext(),
      );

      expect(result.data?.exitCode).toBe(-1);
    });

    it("should return empty stdout when not implemented", async () => {
      const result = await tool.execute(
        { code: "print('Hello')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data?.stdout).toBe("");
    });

    it("should return non-empty stderr with error message when not implemented", async () => {
      const result = await tool.execute(
        { code: "print('Hello')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data?.stderr).toBeTruthy();
      expect(result.data?.stderr).toContain("not yet implemented");
    });

    it("should return executionTime of 0 when not implemented", async () => {
      const result = await tool.execute(
        { code: "print('test')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data?.executionTime).toBe(0);
    });

    it("should return language in output", async () => {
      const result = await tool.execute(
        { code: "println('hi')", language: SupportedLanguage.GO },
        createMockContext(),
      );

      expect(result.data?.language).toBe(SupportedLanguage.GO);
    });

    it("should return Docker image in output", async () => {
      const result = await tool.execute(
        { code: "print('hi')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data?.image).toBeTruthy();
      expect(typeof result.data?.image).toBe("string");
    });

    it("should use custom image when provided", async () => {
      const result = await tool.execute(
        {
          code: "print('hi')",
          language: SupportedLanguage.PYTHON,
          image: "custom-python:3.12",
        },
        createMockContext(),
      );

      expect(result.data?.image).toBe("custom-python:3.12");
    });

    it("should return resourceUsage with numeric cpuPercent", async () => {
      const result = await tool.execute(
        { code: "print('hi')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data?.resourceUsage).toBeDefined();
      expect(typeof result.data?.resourceUsage.cpuPercent).toBe("number");
    });

    it("should return resourceUsage with numeric memoryMB", async () => {
      const result = await tool.execute(
        { code: "print('hi')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(typeof result.data?.resourceUsage.memoryMB).toBe("number");
    });

    it("should return timeout: false when not implemented", async () => {
      const result = await tool.execute(
        { code: "print('hi')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data?.timeout).toBe(false);
    });

    it("should return oomKilled: false when not implemented", async () => {
      const result = await tool.execute(
        { code: "print('hi')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data?.oomKilled).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Output structure
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should always include all required output fields", async () => {
      const result = await tool.execute(
        { code: "print('hi')", language: SupportedLanguage.PYTHON },
        createMockContext(),
      );

      expect(result.data).toHaveProperty("success");
      expect(result.data).toHaveProperty("stdout");
      expect(result.data).toHaveProperty("stderr");
      expect(result.data).toHaveProperty("exitCode");
      expect(result.data).toHaveProperty("executionTime");
      expect(result.data).toHaveProperty("resourceUsage");
      expect(result.data).toHaveProperty("language");
      expect(result.data).toHaveProperty("image");
      expect(result.data).toHaveProperty("timeout");
      expect(result.data).toHaveProperty("oomKilled");
    });
  });
});
