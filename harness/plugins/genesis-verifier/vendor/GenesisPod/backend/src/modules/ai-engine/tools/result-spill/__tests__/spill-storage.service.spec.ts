/**
 * Unit tests for ToolOutputSpillStorageService
 */

import { ToolOutputSpillStorageService } from "../spill-storage.service";
import type { ObjectStorageService } from "@/modules/platform/storage/object-store/object-storage.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorageService(
  overrides: Partial<{
    isEnabled: boolean;
    uploadText: jest.Mock;
    downloadText: jest.Mock;
  }> = {},
): jest.Mocked<
  Pick<ObjectStorageService, "isEnabled" | "uploadText" | "downloadText">
> {
  return {
    isEnabled: jest.fn().mockReturnValue(overrides.isEnabled ?? true),
    uploadText:
      overrides.uploadText ??
      jest.fn().mockResolvedValue({
        success: true,
        key: "tool-output-spill/id-123.txt",
      }),
    downloadText:
      overrides.downloadText ?? jest.fn().mockResolvedValue("full content"),
  } as jest.Mocked<
    Pick<ObjectStorageService, "isEnabled" | "uploadText" | "downloadText">
  >;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolOutputSpillStorageService", () => {
  // -------------------------------------------------------------------------
  // spill()
  // -------------------------------------------------------------------------
  describe("spill()", () => {
    it("uploads content and returns success=true when storage is available", async () => {
      const storage = makeStorageService();
      const svc = new ToolOutputSpillStorageService(
        storage as unknown as ObjectStorageService,
      );

      const result = await svc.spill({
        toolUseId: "use-abc",
        content: "hello world",
      });

      expect(storage.uploadText).toHaveBeenCalledTimes(1);
      const [content, key] = (storage.uploadText as jest.Mock).mock
        .calls[0] as [string, string];
      expect(content).toBe("hello world");
      expect(key).toMatch(/^tool-output-spill\/use-abc-\d+\.txt$/);
      expect(result.success).toBe(true);
      expect(result.spillPath).toMatch(/^tool-output-spill\/use-abc-\d+\.txt$/);
    });

    it("returns success=false when storage is disabled", async () => {
      const storage = makeStorageService({ isEnabled: false });
      const svc = new ToolOutputSpillStorageService(
        storage as unknown as ObjectStorageService,
      );

      const result = await svc.spill({ toolUseId: "use-def", content: "data" });

      expect(storage.uploadText).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    it("returns success=false when uploadText returns success=false", async () => {
      const storage = makeStorageService({
        uploadText: jest
          .fn()
          .mockResolvedValue({ success: false, error: "quota exceeded" }),
      });
      const svc = new ToolOutputSpillStorageService(
        storage as unknown as ObjectStorageService,
      );

      const result = await svc.spill({
        toolUseId: "use-ghi",
        content: "large output",
      });

      expect(result.success).toBe(false);
      expect(result.spillPath).toMatch(/^tool-output-spill\/use-ghi-\d+\.txt$/);
    });

    it("returns success=false and does not throw when uploadText throws", async () => {
      const storage = makeStorageService({
        uploadText: jest.fn().mockRejectedValue(new Error("network error")),
      });
      const svc = new ToolOutputSpillStorageService(
        storage as unknown as ObjectStorageService,
      );

      await expect(
        svc.spill({ toolUseId: "use-err", content: "data" }),
      ).resolves.toMatchObject({ success: false });
    });

    it("works without injected storage service (no @Optional injection)", async () => {
      const svc = new ToolOutputSpillStorageService(undefined);

      const result = await svc.spill({
        toolUseId: "use-none",
        content: "data",
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // retrieve()
  // -------------------------------------------------------------------------
  describe("retrieve()", () => {
    it("downloads and returns content string when storage is available", async () => {
      const storage = makeStorageService({
        downloadText: jest.fn().mockResolvedValue("full original content"),
      });
      const svc = new ToolOutputSpillStorageService(
        storage as unknown as ObjectStorageService,
      );

      const content = await svc.retrieve("tool-output-spill/use-abc-1234.txt");

      expect(storage.downloadText).toHaveBeenCalledWith(
        "tool-output-spill/use-abc-1234.txt",
      );
      expect(content).toBe("full original content");
    });

    it("returns null when storage is disabled", async () => {
      const storage = makeStorageService({ isEnabled: false });
      const svc = new ToolOutputSpillStorageService(
        storage as unknown as ObjectStorageService,
      );

      const content = await svc.retrieve("tool-output-spill/any.txt");

      expect(content).toBeNull();
    });

    it("returns null and does not throw when downloadText throws", async () => {
      const storage = makeStorageService({
        downloadText: jest.fn().mockRejectedValue(new Error("not found")),
      });
      const svc = new ToolOutputSpillStorageService(
        storage as unknown as ObjectStorageService,
      );

      await expect(
        svc.retrieve("tool-output-spill/missing.txt"),
      ).resolves.toBeNull();
    });

    it("returns null when no storage service injected", async () => {
      const svc = new ToolOutputSpillStorageService(undefined);

      await expect(svc.retrieve("any-path")).resolves.toBeNull();
    });
  });
});
