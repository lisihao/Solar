/**
 * PermissionMiddleware - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Lines 47-51: permission denied path (isAllowed returns permitted=false)
 */

import { PermissionMiddleware } from "../permission.middleware";
import {
  ITool,
  ToolCategory,
  ToolContext,
  ToolResult,
} from "../../abstractions/tool.interface";

function makeTool(id = "test-tool"): ITool {
  return {
    id,
    name: `Tool ${id}`,
    description: "Test tool",
    category: "information" as ToolCategory,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    enabled: true,
    cancellable: false,
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

function makeContext(userId?: string): ToolContext {
  return {
    executionId: "ext-exec",
    toolId: "test-tool",
    userId,
    createdAt: new Date(),
  };
}

describe("PermissionMiddleware (extended coverage)", () => {
  // =========================================================================
  // Lines 47-51: permission denied path
  // =========================================================================

  describe("before() permission denied path (lines 47-51)", () => {
    it("throws when isAllowed returns permitted=false with a reason", async () => {
      class DenyingMiddleware extends PermissionMiddleware {
        protected override isAllowed() {
          return Promise.resolve({
            permitted: false,
            reason: "Insufficient credits",
          });
        }
      }

      const middleware = new DenyingMiddleware();
      const tool = makeTool();
      const context = makeContext("user-123");

      await expect(middleware.before({}, context, tool)).rejects.toThrow(
        "Insufficient credits",
      );
    });

    it("throws with default 'Permission denied' when no reason provided", async () => {
      class DenyingMiddleware extends PermissionMiddleware {
        protected override isAllowed() {
          return Promise.resolve({ permitted: false });
        }
      }

      const middleware = new DenyingMiddleware();
      const tool = makeTool("restricted-tool");
      const context = makeContext("user-456");

      await expect(middleware.before({}, context, tool)).rejects.toThrow(
        "Permission denied",
      );
    });

    it("throws with PermissionMiddleware prefix in error message", async () => {
      class DenyingMiddleware extends PermissionMiddleware {
        protected override isAllowed() {
          return Promise.resolve({ permitted: false, reason: "Not allowed" });
        }
      }

      const middleware = new DenyingMiddleware();
      const tool = makeTool();
      const context = makeContext();

      await expect(middleware.before({}, context, tool)).rejects.toThrow(
        "[PermissionMiddleware]",
      );
    });
  });
});
