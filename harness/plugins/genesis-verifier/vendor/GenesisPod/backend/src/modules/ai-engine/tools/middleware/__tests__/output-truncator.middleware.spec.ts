/**
 * Unit tests for ToolOutputTruncatorMiddleware
 */

import {
  ToolOutputTruncatorMiddleware,
  DEFAULT_SPILL_THRESHOLD,
} from "../output-truncator.middleware";
import type { ToolOutputSpillStorageService } from "../../result-spill/spill-storage.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpillStorage(
  overrides: Partial<{
    spill: jest.Mock;
    retrieve: jest.Mock;
  }> = {},
): jest.Mocked<ToolOutputSpillStorageService> {
  return {
    spill:
      overrides.spill ??
      jest.fn().mockResolvedValue({
        spillPath: "tool-output-spill/id-1234.txt",
        success: true,
      }),
    retrieve: overrides.retrieve ?? jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<ToolOutputSpillStorageService>;
}

const SHORT_OUTPUT = "hello world";
const THRESHOLD = 100;

function makeOutput(length: number): string {
  return "A".repeat(length);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolOutputTruncatorMiddleware", () => {
  describe("passthrough — output within threshold", () => {
    it("returns output unchanged when length equals threshold", async () => {
      const spill = makeSpillStorage();
      const mw = new ToolOutputTruncatorMiddleware(spill);

      const result = await mw.truncate({
        toolName: "web-search",
        toolUseId: "eid-1",
        output: makeOutput(THRESHOLD),
        maxResultSizeChars: THRESHOLD,
      });

      expect(result.spilled).toBe(false);
      expect(result.output).toBe(makeOutput(THRESHOLD));
      expect(result.originalLength).toBe(THRESHOLD);
      expect(spill.spill).not.toHaveBeenCalled();
    });

    it("returns output unchanged when length is less than threshold", async () => {
      const mw = new ToolOutputTruncatorMiddleware(undefined);

      const result = await mw.truncate({
        toolName: "rag-search",
        toolUseId: "eid-2",
        output: SHORT_OUTPUT,
        maxResultSizeChars: THRESHOLD,
      });

      expect(result.spilled).toBe(false);
      expect(result.output).toBe(SHORT_OUTPUT);
    });

    it("skips truncation when maxResultSizeChars is Infinity", async () => {
      const mw = new ToolOutputTruncatorMiddleware(undefined);
      const longOutput = makeOutput(500_000);

      const result = await mw.truncate({
        toolName: "data-fetch",
        toolUseId: "eid-3",
        output: longOutput,
        maxResultSizeChars: Infinity,
      });

      expect(result.spilled).toBe(false);
      expect(result.output).toBe(longOutput);
    });

    it("skips truncation when maxResultSizeChars is 0", async () => {
      const mw = new ToolOutputTruncatorMiddleware(undefined);
      const longOutput = makeOutput(200);

      const result = await mw.truncate({
        toolName: "any-tool",
        toolUseId: "eid-4",
        output: longOutput,
        maxResultSizeChars: 0,
      });

      expect(result.spilled).toBe(false);
      expect(result.output).toBe(longOutput);
    });
  });

  describe("spill — output exceeds threshold", () => {
    it("calls spill storage and returns spilled=true with spillPath in output", async () => {
      const spillStorage = makeSpillStorage({
        spill: jest.fn().mockResolvedValue({
          spillPath: "tool-output-spill/eid-5-1234.txt",
          success: true,
        }),
      });
      const mw = new ToolOutputTruncatorMiddleware(spillStorage);
      const longOutput = makeOutput(THRESHOLD + 50);

      const result = await mw.truncate({
        toolName: "web-scraper",
        toolUseId: "eid-5",
        output: longOutput,
        maxResultSizeChars: THRESHOLD,
      });

      expect(spillStorage.spill).toHaveBeenCalledTimes(1);
      expect(spillStorage.spill).toHaveBeenCalledWith({
        toolUseId: "eid-5",
        content: longOutput,
      });
      expect(result.spilled).toBe(true);
      expect(result.spillPath).toBe("tool-output-spill/eid-5-1234.txt");
      expect(result.originalLength).toBe(THRESHOLD + 50);
    });

    it("preview is 80% of maxResultSizeChars and output contains spillPath reference", async () => {
      const spillPath = "tool-output-spill/eid-6-9999.txt";
      const spillStorage = makeSpillStorage({
        spill: jest.fn().mockResolvedValue({ spillPath, success: true }),
      });
      const mw = new ToolOutputTruncatorMiddleware(spillStorage);
      const longOutput = makeOutput(200);

      const result = await mw.truncate({
        toolName: "web-scraper",
        toolUseId: "eid-6",
        output: longOutput,
        maxResultSizeChars: THRESHOLD,
      });

      // Preview must be exactly 80% of threshold
      const expectedPreviewLen = Math.floor(THRESHOLD * 0.8);
      expect(result.output.startsWith("A".repeat(expectedPreviewLen))).toBe(
        true,
      );
      // Must contain spillPath
      expect(result.output).toContain(spillPath);
      // Must NOT contain data beyond preview
      expect(result.output.slice(0, expectedPreviewLen + 1)).not.toBe(
        "A".repeat(expectedPreviewLen + 1),
      );
    });

    it("truncation notice contains original character count", async () => {
      const spillStorage = makeSpillStorage({
        spill: jest
          .fn()
          .mockResolvedValue({ spillPath: "p/x.txt", success: true }),
      });
      const mw = new ToolOutputTruncatorMiddleware(spillStorage);
      const longOutput = makeOutput(150);

      const result = await mw.truncate({
        toolName: "data-fetch",
        toolUseId: "eid-7",
        output: longOutput,
        maxResultSizeChars: THRESHOLD,
      });

      expect(result.output).toContain(String(THRESHOLD));
    });
  });

  describe("spill degradation — storage unavailable or failing", () => {
    it("falls back to plain truncation when no spillStorage injected", async () => {
      const mw = new ToolOutputTruncatorMiddleware(undefined);
      const longOutput = makeOutput(200);

      const result = await mw.truncate({
        toolName: "web-search",
        toolUseId: "eid-8",
        output: longOutput,
        maxResultSizeChars: THRESHOLD,
      });

      expect(result.spilled).toBe(false);
      expect(result.spillPath).toBeUndefined();
      // output must be shorter than original
      expect(result.output.length).toBeLessThan(longOutput.length);
      expect(result.originalLength).toBe(200);
    });

    it("falls back to plain truncation when spill returns success=false", async () => {
      const spillStorage = makeSpillStorage({
        spill: jest
          .fn()
          .mockResolvedValue({ spillPath: "p/x.txt", success: false }),
      });
      const mw = new ToolOutputTruncatorMiddleware(spillStorage);
      const longOutput = makeOutput(200);

      const result = await mw.truncate({
        toolName: "web-search",
        toolUseId: "eid-9",
        output: longOutput,
        maxResultSizeChars: THRESHOLD,
      });

      expect(result.spilled).toBe(false);
      expect(result.spillPath).toBeUndefined();
      expect(result.output.length).toBeLessThan(longOutput.length);
    });

    it("falls back gracefully when spill throws an exception", async () => {
      const spillStorage = makeSpillStorage({
        spill: jest.fn().mockRejectedValue(new Error("storage timeout")),
      });
      const mw = new ToolOutputTruncatorMiddleware(spillStorage);
      const longOutput = makeOutput(200);

      await expect(
        mw.truncate({
          toolName: "web-search",
          toolUseId: "eid-10",
          output: longOutput,
          maxResultSizeChars: THRESHOLD,
        }),
      ).resolves.toMatchObject({ spilled: false });
    });
  });

  describe("DEFAULT_SPILL_THRESHOLD export", () => {
    it("is 30_000 matching Anthropic Claude Code Bash threshold", () => {
      expect(DEFAULT_SPILL_THRESHOLD).toBe(30_000);
    });
  });
});
