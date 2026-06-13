/**
 * Unit tests for PermissionMiddleware
 */

import { Logger } from "@nestjs/common";
import { PermissionMiddleware } from "../permission.middleware";
import {
  ITool,
  ToolCategory,
  ToolContext,
  ToolResult,
} from "../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(id = "test-tool", requiredEntitlements?: string[]): ITool {
  return {
    id,
    name: `Tool ${id}`,
    description: "Test tool",
    category: "information" as ToolCategory,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    enabled: true,
    cancellable: false,
    requiredEntitlements,
    execute(_input: unknown, _context: ToolContext): Promise<ToolResult> {
      return Promise.resolve({
        success: true,
        data: {},
        metadata: {
          executionId: "e",
          startTime: new Date(),
          endTime: new Date(),
          duration: 0,
        },
      });
    },
    toFunctionDefinition: () => ({
      name: id,
      description: "Test",
      parameters: {},
    }),
    toCompactSummary: () => ({
      id,
      name: `Tool ${id}`,
      brief: "Test",
      category: "information" as ToolCategory,
    }),
  };
}

function makeContext(
  userId?: string,
  environment?: ToolContext["environment"],
): ToolContext {
  return {
    executionId: "exec-1",
    toolId: "test-tool",
    userId,
    createdAt: new Date(),
    environment,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PermissionMiddleware", () => {
  let middleware: PermissionMiddleware;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    middleware = new PermissionMiddleware();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  it('has name "permission"', () => {
    expect(middleware.name).toBe("permission");
  });

  it("has priority 5", () => {
    expect(middleware.priority).toBe(5);
  });

  // -------------------------------------------------------------------------
  // before() — default isAllowed (permits all)
  // -------------------------------------------------------------------------

  it("before() resolves without throwing when default isAllowed returns permitted=true", async () => {
    const tool = makeTool();
    const context = makeContext("user-42");

    await expect(
      middleware.before(undefined, context, tool),
    ).resolves.toBeUndefined();
  });

  it("before() resolves for anonymous callers (no userId)", async () => {
    const tool = makeTool();
    const context = makeContext(); // no userId

    await expect(
      middleware.before(undefined, context, tool),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // entitlement check
  // -------------------------------------------------------------------------

  describe("entitlement check", () => {
    it("case 1: tool has no requiredEntitlements — before() passes without querying environment", async () => {
      const getUserEntitlements = jest.fn();
      const tool = makeTool("free-tool"); // no requiredEntitlements
      const context = makeContext("user-1", { getUserEntitlements });

      await expect(
        middleware.before(undefined, context, tool),
      ).resolves.toBeUndefined();

      expect(getUserEntitlements).not.toHaveBeenCalled();
    });

    it("case 2: tool requires ['image.generation'] and user has it — passes", async () => {
      const getUserEntitlements = jest
        .fn()
        .mockResolvedValue({ keys: ["image.generation"] });
      const tool = makeTool("image-tool", ["image.generation"]);
      const context = makeContext("user-2", { getUserEntitlements });

      await expect(
        middleware.before(undefined, context, tool),
      ).resolves.toBeUndefined();
    });

    it("case 3: tool requires ['image.generation'] but user only has ['other.thing'] — throws Missing entitlements", async () => {
      const getUserEntitlements = jest
        .fn()
        .mockResolvedValue({ keys: ["other.thing"] });
      const tool = makeTool("image-tool", ["image.generation"]);
      const context = makeContext("user-3", { getUserEntitlements });

      await expect(middleware.before(undefined, context, tool)).rejects.toThrow(
        "Missing entitlements",
      );

      expect(jest.spyOn(Logger.prototype, "warn")).toHaveBeenCalled();
    });

    it("case 4: tool requires ['foo'] but context.environment is undefined — throws fail-closed", async () => {
      const tool = makeTool("gated-tool", ["foo"]);
      const context = makeContext("user-4"); // no environment

      await expect(middleware.before(undefined, context, tool)).rejects.toThrow(
        "Missing entitlements",
      );
    });

    it("case 5: getUserEntitlements throws — throws fail-closed and logs entitlement_query_failed", async () => {
      const getUserEntitlements = jest
        .fn()
        .mockRejectedValue(new Error("DB timeout"));
      const tool = makeTool("gated-tool", ["foo"]);
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      const context = makeContext("user-5", { getUserEntitlements });

      await expect(middleware.before(undefined, context, tool)).rejects.toThrow(
        "Entitlement check failed",
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("entitlement_query_failed"),
      );
    });

    it("case 6: tool requires multiple entitlements, user satisfies only some — throws with missing list", async () => {
      const getUserEntitlements = jest
        .fn()
        .mockResolvedValue({ keys: ["plan.pro"] });
      const tool = makeTool("multi-ent-tool", ["plan.pro", "feature.export"]);
      const context = makeContext("user-6", { getUserEntitlements });

      await expect(middleware.before(undefined, context, tool)).rejects.toThrow(
        "feature.export",
      );
    });
  });
});
