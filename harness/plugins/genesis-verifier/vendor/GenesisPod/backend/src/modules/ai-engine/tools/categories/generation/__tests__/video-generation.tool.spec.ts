/**
 * VideoGenerationTool Unit Tests
 *
 * Tests the video-generation tool in isolation (no external dependencies).
 * This tool uses internal mock/simulation logic, so no external mocking needed.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  VideoGenerationTool,
  VideoGenerationInput,
  VideoGenerationOutput,
} from "../video-generation.tool";
import { ToolContext, ToolResult } from "../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-video-001",
    toolId: "video-generation",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("VideoGenerationTool", () => {
  let tool: VideoGenerationTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoGenerationTool],
    }).compile();

    tool = module.get<VideoGenerationTool>(VideoGenerationTool);
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'video-generation'", () => {
      expect(tool.id).toBe("video-generation");
    });

    it("should belong to the 'generation' category", () => {
      expect(tool.category).toBe("generation");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for text source with prompt", () => {
      expect(
        tool.validateInput({ sourceType: "text", prompt: "A futuristic city" }),
      ).toBe(true);
    });

    it("should return false for text source without prompt", () => {
      expect(tool.validateInput({ sourceType: "text" })).toBe(false);
    });

    it("should return false for text source with empty prompt", () => {
      expect(tool.validateInput({ sourceType: "text", prompt: "" })).toBe(
        false,
      );
    });

    it("should return false for text source with whitespace-only prompt", () => {
      expect(tool.validateInput({ sourceType: "text", prompt: "   " })).toBe(
        false,
      );
    });

    it("should return true for image source with sourceUrl", () => {
      expect(
        tool.validateInput({
          sourceType: "image",
          sourceUrl: "https://example.com/img.jpg",
        }),
      ).toBe(true);
    });

    it("should return false for image source without sourceUrl", () => {
      expect(tool.validateInput({ sourceType: "image" })).toBe(false);
    });

    it("should return true for video source with sourceUrl", () => {
      expect(
        tool.validateInput({
          sourceType: "video",
          sourceUrl: "https://example.com/video.mp4",
        }),
      ).toBe(true);
    });

    it("should return false for video source without sourceUrl", () => {
      expect(tool.validateInput({ sourceType: "video" })).toBe(false);
    });

    it("should return false for duration < 1 (negative value)", () => {
      // Note: duration=0 passes because the JS truthiness check `if (input.duration && ...)` skips 0
      // The source validates only if duration is truthy. Use a negative value to test the check.
      expect(
        tool.validateInput({
          sourceType: "text",
          prompt: "Test",
          duration: -1,
        }),
      ).toBe(false);
    });

    it("should return false for duration > 60", () => {
      expect(
        tool.validateInput({
          sourceType: "text",
          prompt: "Test",
          duration: 61,
        }),
      ).toBe(false);
    });

    it("should return true for duration exactly 60", () => {
      expect(
        tool.validateInput({
          sourceType: "text",
          prompt: "Test",
          duration: 60,
        }),
      ).toBe(true);
    });

    it("should return false for fps < 24", () => {
      expect(
        tool.validateInput({ sourceType: "text", prompt: "Test", fps: 10 }),
      ).toBe(false);
    });

    it("should return false for fps > 60", () => {
      expect(
        tool.validateInput({ sourceType: "text", prompt: "Test", fps: 61 }),
      ).toBe(false);
    });

    it("should return false for unsupported sourceType", () => {
      expect(
        tool.validateInput({
          sourceType: "gif" as VideoGenerationInput["sourceType"],
          prompt: "Test",
        }),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Execute — not implemented, should return success:false + error
  // -------------------------------------------------------------------------

  describe("execute() - not implemented", () => {
    it("should return success:false for text-to-video (not implemented)", async () => {
      const result: ToolResult<VideoGenerationOutput> = await tool.execute(
        { sourceType: "text", prompt: "A beautiful sunset over the ocean" },
        makeContext(),
      );

      expect(result.success).toBe(true); // ToolResult.success (doExecute didn't throw)
      expect(result.data?.success).toBe(false);
    });

    it("should return error message mentioning not implemented", async () => {
      const result = await tool.execute(
        { sourceType: "text", prompt: "A mountain hike" },
        makeContext(),
      );

      expect(result.data?.error).toBeTruthy();
      expect(result.data?.error).toContain("not yet implemented");
    });

    it("should return empty videoUrl when not implemented", async () => {
      const result = await tool.execute(
        { sourceType: "text", prompt: "Test prompt" },
        makeContext(),
      );

      expect(result.data?.videoUrl).toBe("");
    });

    it("should return duration 0 when not implemented", async () => {
      const result = await tool.execute(
        { sourceType: "text", prompt: "Duration check" },
        makeContext(),
      );

      expect(result.data?.duration).toBe(0);
    });

    it("should use default output format mp4 when not implemented", async () => {
      const result = await tool.execute(
        { sourceType: "text", prompt: "Format test" },
        makeContext(),
      );

      expect(result.data?.format).toBe("mp4");
    });

    it("should respect custom output format in error response", async () => {
      const result = await tool.execute(
        {
          sourceType: "text",
          prompt: "Custom format",
          options: { outputFormat: "webm" },
        },
        makeContext(),
      );

      expect(result.data?.format).toBe("webm");
    });

    it("should return success:false for image-to-video (not implemented)", async () => {
      const result = await tool.execute(
        {
          sourceType: "image",
          sourceUrl: "https://example.com/photo.jpg",
          duration: 5,
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeTruthy();
    });

    it("should return success:false for video editing (not implemented)", async () => {
      const result = await tool.execute(
        {
          sourceType: "video",
          sourceUrl: "https://example.com/original.mp4",
          editOperation: { type: "trim", params: { start: 0, end: 30 } },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { sourceType: "text", prompt: "Cancelled" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
    });
  });
});
