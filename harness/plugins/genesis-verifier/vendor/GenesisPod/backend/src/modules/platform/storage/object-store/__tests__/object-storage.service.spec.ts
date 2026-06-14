/**
 * ObjectStorageService spec（v5.1 R0.5-E W2-A 重构后 orchestrator 单测）
 *
 * 历史：service 内部直接持有 S3Client，spec 也 mock S3Client 测 S3 调用细节。
 * W2-A 重构：service 委托 IObjectStorageBackend，本 spec 改测 orchestrator
 * 行为（base64 解析 / 路径生成 / signed URL 协调），S3 SDK 级别测试在
 * plugins/storage/object-r2/__tests__/backend.spec.ts（独立文件，未来添加）。
 */
import { Test, TestingModule } from "@nestjs/testing";
import { ServiceUnavailableException } from "@nestjs/common";
import { ObjectStorageService } from "../object-storage.service";
import {
  OBJECT_STORAGE_BACKEND_TOKEN,
  type IObjectStorageBackend,
} from "@/plugins/core/abstractions";

jest.mock("@/common/utils/concurrency.utils", () => ({
  mapWithConcurrency: jest
    .fn()
    .mockImplementation(async (items: unknown[], fn: (x: unknown) => unknown) =>
      Promise.all(items.map(fn)),
    ),
  ConcurrencyLimits: { FILE: 3 },
}));

interface MockBackend extends IObjectStorageBackend {
  isAvailable: jest.Mock<boolean, []>;
  putObject: jest.Mock;
  getObject: jest.Mock;
  deleteObject: jest.Mock;
  getSignedUrl: jest.Mock;
  getBucketName: jest.Mock;
  listObjects: jest.Mock;
}

function makeBackend(available = true, id = "r2"): MockBackend {
  return {
    id,
    isAvailable: jest.fn(() => available),
    putObject: jest.fn(async () => undefined),
    getObject: jest.fn(async () => null),
    deleteObject: jest.fn(async () => true),
    getSignedUrl: jest.fn(async () => "https://signed.example/key"),
    getBucketName: jest.fn(() => "test-bucket"),
    listObjects: jest.fn(async () => ({ objects: [], isTruncated: false })),
  };
}

async function makeService(
  backend: MockBackend,
): Promise<ObjectStorageService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ObjectStorageService,
      { provide: OBJECT_STORAGE_BACKEND_TOKEN, useValue: backend },
    ],
  }).compile();
  return module.get(ObjectStorageService);
}

describe("ObjectStorageService (W2-A orchestrator)", () => {
  describe("isEnabled / getProvider", () => {
    it("returns true + provider id when backend available", async () => {
      const svc = await makeService(makeBackend(true, "r2"));
      expect(svc.isEnabled()).toBe(true);
      expect(svc.getProvider()).toBe("r2");
    });

    it("returns false + 'none' when backend unavailable", async () => {
      const svc = await makeService(makeBackend(false));
      expect(svc.isEnabled()).toBe(false);
      expect(svc.getProvider()).toBe("none");
    });
  });

  describe("uploadBase64Image", () => {
    it("rejects non-data-uri input", async () => {
      const svc = await makeService(makeBackend(true));
      const r = await svc.uploadBase64Image("not-base64");
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/Invalid base64/);
    });

    it("returns error when backend unavailable", async () => {
      const svc = await makeService(makeBackend(false));
      const r = await svc.uploadBase64Image("data:image/png;base64,aGVsbG8=");
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not configured/);
    });

    it("calls backend.putObject + getSignedUrl on valid input", async () => {
      const backend = makeBackend(true);
      const svc = await makeService(backend);
      const r = await svc.uploadBase64Image(
        "data:image/png;base64,aGVsbG8=",
        "test",
      );
      expect(r.success).toBe(true);
      expect(r.url).toBe("https://signed.example/key");
      expect(backend.putObject).toHaveBeenCalledTimes(1);
      expect(backend.getSignedUrl).toHaveBeenCalledTimes(1);
      const [key] = backend.putObject.mock.calls[0];
      expect(key).toMatch(/^test\/\d+-[a-f0-9]+\.png$/);
    });
  });

  describe("uploadBuffer", () => {
    it("uses filename ext + delegates to backend", async () => {
      const backend = makeBackend(true);
      const svc = await makeService(backend);
      const r = await svc.uploadBuffer(
        Buffer.from("hello"),
        "docs",
        "report.pdf",
        "application/pdf",
      );
      expect(r.success).toBe(true);
      const [key] = backend.putObject.mock.calls[0];
      expect(key).toMatch(/^docs\/\d+-[a-f0-9]+\.pdf$/);
    });
  });

  describe("uploadText / downloadText", () => {
    it("delegates putObject for upload", async () => {
      const backend = makeBackend(true);
      const svc = await makeService(backend);
      const r = await svc.uploadText("hello world", "reports/r1.md");
      expect(r.success).toBe(true);
      expect(r.key).toBe("reports/r1.md");
    });

    it("downloadText returns null on miss", async () => {
      const backend = makeBackend(true);
      backend.getObject.mockResolvedValueOnce(null);
      const svc = await makeService(backend);
      expect(await svc.downloadText("nope")).toBeNull();
    });

    it("downloadText returns string on hit", async () => {
      const backend = makeBackend(true);
      backend.getObject.mockResolvedValueOnce(Buffer.from("contents"));
      const svc = await makeService(backend);
      expect(await svc.downloadText("k")).toBe("contents");
    });
  });

  describe("getPresignedUrl", () => {
    it("throws ServiceUnavailable when backend unavailable", async () => {
      const svc = await makeService(makeBackend(false));
      await expect(svc.getPresignedUrl("k")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("returns signed URL when backend available", async () => {
      const svc = await makeService(makeBackend(true));
      expect(await svc.getPresignedUrl("k")).toBe("https://signed.example/key");
    });
  });

  describe("extractKeyFromUrl", () => {
    it("strips bucket prefix", async () => {
      const svc = await makeService(makeBackend(true));
      expect(
        svc.extractKeyFromUrl(
          "https://x.r2.cloudflarestorage.com/test-bucket/path/to/file.png",
        ),
      ).toBe("path/to/file.png");
    });

    it("returns null for invalid URL", async () => {
      const svc = await makeService(makeBackend(true));
      expect(svc.extractKeyFromUrl("not-a-url")).toBeNull();
    });
  });

  describe("listObjects", () => {
    it("returns empty when backend unavailable", async () => {
      const svc = await makeService(makeBackend(false));
      const r = await svc.listObjects();
      expect(r.objects).toEqual([]);
      expect(r.isTruncated).toBe(false);
    });

    it("delegates to backend.listObjects", async () => {
      const backend = makeBackend(true);
      backend.listObjects.mockResolvedValueOnce({
        objects: [{ key: "a", size: 100 }],
        isTruncated: false,
      });
      const svc = await makeService(backend);
      const r = await svc.listObjects();
      expect(r.objects).toEqual([{ key: "a", size: 100 }]);
    });
  });
});
