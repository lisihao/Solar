/**
 * AiImageController Unit Tests
 *
 * Coverage targets:
 * - getAvailableModels()
 * - generateImage() — with and without referenceImageUrl
 * - generateImageStream() GET — aspectRatio/templateLayout validation, URL parsing
 * - generateImageStreamPost() POST — SSE header setup, event writing, close cleanup
 * - generateImageWithFiles() — file processing, urls as array or string
 * - getHistory(), getBookmarkedImages()
 * - getPublicImage() — throws NotFoundException when null
 * - getImageStats() — forbidden without key
 * - adminDeleteAllImages() — forbidden without key
 * - getImage(), deleteImage()
 * - addBookmark(), removeBookmark()
 * - updateVisibility()
 * - cleanupOldImages(), adminCleanupAllImages()
 * - autoTagImages(), analyzeStyles(), clusterVisualThemes() — unauthorized without user
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { of, Subject } from "rxjs";
import { AiImageController } from "../generation.controller";
import { AiImageService } from "../generation.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthReq(userId?: string) {
  return { user: userId ? { id: userId, email: "user@test.com" } : undefined };
}

function makeMockRes() {
  const socket = { setNoDelay: jest.fn() };
  const res: Record<string, jest.Mock | typeof socket | jest.Mock[]> = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    socket,
  };
  return res as unknown as import("express").Response & {
    socket: typeof socket;
    setHeader: jest.Mock;
    flushHeaders: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
  };
}

const ADMIN_KEY = "test-admin-key";

// ---------------------------------------------------------------------------
// Mock AiImageService
// ---------------------------------------------------------------------------

const makeMockService = () => ({
  getAvailableModels: jest
    .fn()
    .mockResolvedValue({ textModels: [], imageModels: [] }),
  generateImage: jest
    .fn()
    .mockResolvedValue({ id: "img-1", imageUrl: "http://example.com/img.png" }),
  generateImageStream: jest
    .fn()
    .mockReturnValue(
      of({ data: JSON.stringify({ type: "complete", result: {} }) }),
    ),
  getHistory: jest.fn().mockResolvedValue([]),
  getBookmarkedImages: jest.fn().mockResolvedValue([]),
  getPublicImage: jest
    .fn()
    .mockResolvedValue({ id: "img-1", imageUrl: "http://example.com/img.png" }),
  getImageStats: jest.fn().mockResolvedValue({ total: 10 }),
  deleteAllImages: jest.fn().mockResolvedValue(10),
  getImage: jest.fn().mockResolvedValue({ id: "img-1" }),
  deleteImage: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Deleted" }),
  addBookmark: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Bookmarked" }),
  removeBookmark: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Removed" }),
  updateVisibility: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Updated" }),
  cleanupOldImages: jest.fn().mockResolvedValue(3),
  cleanupAllUsersImages: jest
    .fn()
    .mockResolvedValue({ totalDeleted: 5, usersCleaned: 2, orphanDeleted: 1 }),
  autoTagImages: jest.fn().mockResolvedValue({ tagged: 3 }),
  analyzeStyles: jest.fn().mockResolvedValue({ styles: [] }),
  clusterVisualThemes: jest.fn().mockResolvedValue({ clusters: [] }),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AiImageController", () => {
  let controller: AiImageController;
  let mockService: ReturnType<typeof makeMockService>;

  beforeEach(async () => {
    mockService = makeMockService();

    const { ConfigService } = await import("@nestjs/config");
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiImageController],
      providers: [
        { provide: AiImageService, useValue: mockService },
        // S3 audit fix：admin endpoints 用 ConfigService 读 IMAGE_ADMIN_CLEANUP_KEY
        { provide: ConfigService, useValue: { get: () => "test-admin-key" } },
      ],
    }).compile();

    controller = module.get<AiImageController>(AiImageController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // getAvailableModels
  // -------------------------------------------------------------------------

  describe("getAvailableModels()", () => {
    it("returns models from service", async () => {
      const result = await controller.getAvailableModels();
      expect(result).toEqual({ textModels: [], imageModels: [] });
      expect(mockService.getAvailableModels).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // generateImage
  // -------------------------------------------------------------------------

  describe("generateImage()", () => {
    it("calls service.generateImage with userId from request", async () => {
      const dto = { prompt: "Test prompt" };
      const req = makeAuthReq("user-1");

      const result = await controller.generateImage(dto as never, req);

      expect(result).toEqual({
        id: "img-1",
        imageUrl: "http://example.com/img.png",
      });
      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "Test prompt", userId: "user-1" }),
      );
    });

    it("passes dto.imageBase64 directly to service", async () => {
      const dto = { prompt: "Test", imageBase64: "base64data" };
      const req = makeAuthReq("user-1");

      await controller.generateImage(dto as never, req);

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ imageBase64: "base64data" }),
      );
    });

    it("fetches referenceImageUrl and converts to base64 when imageBase64 is absent", async () => {
      const fakeBuffer = Buffer.from("fake image bytes");
      const fakeArrayBuffer = fakeBuffer.buffer.slice(
        fakeBuffer.byteOffset,
        fakeBuffer.byteOffset + fakeBuffer.byteLength,
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(fakeArrayBuffer),
      });

      const dto = {
        prompt: "Test",
        referenceImageUrl: "https://example.com/ref.png",
      };
      const req = makeAuthReq("user-1");

      await controller.generateImage(dto as never, req);

      expect(global.fetch).toHaveBeenCalledWith("https://example.com/ref.png");
      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          imageBase64: Buffer.from(fakeArrayBuffer).toString("base64"),
        }),
      );
    });

    it("continues without imageBase64 when referenceImageUrl fetch fails", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

      const dto = {
        prompt: "Test",
        referenceImageUrl: "https://example.com/fail.png",
      };
      const req = makeAuthReq("user-1");

      await controller.generateImage(dto as never, req);

      // imageBase64 should be undefined since fetch failed
      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ imageBase64: undefined }),
      );
    });

    it("continues without imageBase64 when fetch response is not ok", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

      const dto = {
        referenceImageUrl: "https://example.com/notfound.png",
        prompt: "Test",
      };
      const req = makeAuthReq("user-1");

      await controller.generateImage(dto as never, req);

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ imageBase64: undefined }),
      );
    });

    it("passes all dto fields to service", async () => {
      const dto = {
        prompt: "Test",
        urls: ["https://example.com"],
        content: "Some text",
        textModelId: "gpt-4o",
        imageModelId: "dall-e-3",
        style: "realistic",
        aspectRatio: "16:9" as const,
        negativePrompt: "blurry",
        skipEnhancement: true,
      };
      const req = makeAuthReq("user-1");

      await controller.generateImage(dto as never, req);

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          urls: ["https://example.com"],
          content: "Some text",
          textModelId: "gpt-4o",
          imageModelId: "dall-e-3",
          style: "realistic",
          aspectRatio: "16:9",
          negativePrompt: "blurry",
          skipEnhancement: true,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream (GET)
  // -------------------------------------------------------------------------

  describe("generateImageStream() GET", () => {
    it("parses comma-separated URLs into array", () => {
      const req = makeAuthReq("user-1");
      controller.generateImageStream(
        "Test prompt",
        "https://a.com,https://b.com",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        req,
      );

      expect(mockService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ urls: ["https://a.com", "https://b.com"] }),
      );
    });

    it("passes undefined for urls when urls query param is empty", () => {
      const req = makeAuthReq("user-1");
      controller.generateImageStream(
        "Test",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        req,
      );

      expect(mockService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ urls: undefined }),
      );
    });

    it("accepts valid aspectRatio values", () => {
      const validRatios = ["1:1", "16:9", "9:16", "4:3"];
      for (const ratio of validRatios) {
        mockService.generateImageStream.mockClear();
        const req = makeAuthReq("user-1");
        controller.generateImageStream(
          "Test",
          "",
          "",
          "",
          "",
          "",
          ratio,
          "",
          "",
          "",
          req,
        );
        expect(mockService.generateImageStream).toHaveBeenCalledWith(
          expect.objectContaining({ aspectRatio: ratio }),
        );
      }
    });

    it("passes undefined for invalid aspectRatio", () => {
      const req = makeAuthReq("user-1");
      controller.generateImageStream(
        "Test",
        "",
        "",
        "",
        "",
        "",
        "bad-ratio",
        "",
        "",
        "",
        req,
      );

      expect(mockService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: undefined }),
      );
    });

    it("accepts valid templateLayout values", () => {
      const validLayouts = [
        "cards",
        "center_visual",
        "timeline",
        "comparison",
        "pyramid",
        "radial",
      ];
      for (const layout of validLayouts) {
        mockService.generateImageStream.mockClear();
        const req = makeAuthReq("user-1");
        controller.generateImageStream(
          "Test",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          layout,
          req,
        );
        expect(mockService.generateImageStream).toHaveBeenCalledWith(
          expect.objectContaining({ templateLayout: layout }),
        );
      }
    });

    it("passes undefined for invalid templateLayout", () => {
      const req = makeAuthReq("user-1");
      controller.generateImageStream(
        "Test",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "invalid-layout",
        req,
      );

      expect(mockService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ templateLayout: undefined }),
      );
    });

    it('converts skipEnhancement string "true" to boolean true', () => {
      const req = makeAuthReq("user-1");
      controller.generateImageStream(
        "Test",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "true",
        "",
        req,
      );

      expect(mockService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ skipEnhancement: true }),
      );
    });

    it('converts skipEnhancement string other than "true" to boolean false', () => {
      const req = makeAuthReq("user-1");
      controller.generateImageStream(
        "Test",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "false",
        "",
        req,
      );

      expect(mockService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ skipEnhancement: false }),
      );
    });

    it("returns Observable from service", () => {
      const req = makeAuthReq("user-1");
      const observable = controller.generateImageStream(
        "Test",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        req,
      );

      expect(observable).toBeDefined();
      expect(typeof observable.subscribe).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStreamPost (POST)
  // -------------------------------------------------------------------------

  describe("generateImageStreamPost() POST", () => {
    it("sets SSE response headers", () => {
      const req = makeAuthReq("user-1");
      const res = makeMockRes();
      const subject = new Subject<{ data: string }>();
      mockService.generateImageStream.mockReturnValueOnce(
        subject.asObservable(),
      );

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "no-cache, no-transform",
      );
      expect(res.setHeader).toHaveBeenCalledWith("Connection", "keep-alive");
      expect(res.setHeader).toHaveBeenCalledWith("X-Accel-Buffering", "no");
      expect(res.flushHeaders).toHaveBeenCalled();
    });

    it("calls setNoDelay on socket", () => {
      const req = makeAuthReq("user-1");
      const res = makeMockRes();
      const subject = new Subject<{ data: string }>();
      mockService.generateImageStream.mockReturnValueOnce(
        subject.asObservable(),
      );

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);

      expect(res.socket.setNoDelay).toHaveBeenCalledWith(true);
    });

    it("writes SSE data: events for each next emission", () => {
      const req = makeAuthReq("user-1");
      const res = makeMockRes();
      const subject = new Subject<{ data: string }>();
      mockService.generateImageStream.mockReturnValueOnce(
        subject.asObservable(),
      );

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);

      subject.next({ data: '{"type":"step"}' });
      subject.next({ data: '{"type":"complete","result":{}}' });

      expect(res.write).toHaveBeenCalledWith('data: {"type":"step"}\n\n');
      expect(res.write).toHaveBeenCalledWith(
        'data: {"type":"complete","result":{}}\n\n',
      );
    });

    it("calls res.end() when stream completes", () => {
      const req = makeAuthReq("user-1");
      const res = makeMockRes();
      const subject = new Subject<{ data: string }>();
      mockService.generateImageStream.mockReturnValueOnce(
        subject.asObservable(),
      );

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);
      subject.complete();

      expect(res.end).toHaveBeenCalled();
    });

    it("writes error event and ends when stream errors", () => {
      const req = makeAuthReq("user-1");
      const res = makeMockRes();
      const subject = new Subject<{ data: string }>();
      mockService.generateImageStream.mockReturnValueOnce(
        subject.asObservable(),
      );

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);
      subject.error(new Error("Stream error"));

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"'),
      );
      expect(res.end).toHaveBeenCalled();
    });

    it("unsubscribes on res close event", () => {
      const req = makeAuthReq("user-1");
      const res = makeMockRes();
      const subject = new Subject<{ data: string }>();
      mockService.generateImageStream.mockReturnValueOnce(
        subject.asObservable(),
      );

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);

      // Simulate the close event listener being registered
      expect(res.on).toHaveBeenCalledWith("close", expect.any(Function));

      // Trigger the close callback
      const closeCallback = (res.on as jest.Mock).mock
        .calls[0][1] as () => void;
      closeCallback();

      // After close, subsequent next events should not reach write
      const writeCalls = (res.write as jest.Mock).mock.calls.length;
      subject.next({ data: '{"type":"step"}' });
      expect((res.write as jest.Mock).mock.calls.length).toBe(writeCalls);
    });

    it("calls flush when available on response", () => {
      const req = makeAuthReq("user-1");
      const res = makeMockRes();
      const flush = jest.fn();
      (res as never as { flush: jest.Mock }).flush = flush;
      const subject = new Subject<{ data: string }>();
      mockService.generateImageStream.mockReturnValueOnce(
        subject.asObservable(),
      );

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);
      subject.next({ data: '{"type":"step"}' });

      expect(flush).toHaveBeenCalled();
    });

    it("passes userId from request to generateImageStream", () => {
      const req = makeAuthReq("user-99");
      const res = makeMockRes();
      mockService.generateImageStream.mockReturnValueOnce(of());

      controller.generateImageStreamPost({ prompt: "Test" }, req, res as never);

      expect(mockService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-99" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // generateImageWithFiles
  // -------------------------------------------------------------------------

  describe("generateImageWithFiles()", () => {
    it("processes multer files into fileContents array", async () => {
      const files: Express.Multer.File[] = [
        {
          buffer: Buffer.from("file1"),
          mimetype: "application/pdf",
          originalname: "doc.pdf",
        } as Express.Multer.File,
      ];
      const dto = { prompt: "Test" };
      const req = makeAuthReq("user-1");

      await controller.generateImageWithFiles(files, dto as never, req);

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [
            {
              buffer: files[0].buffer,
              mimeType: "application/pdf",
              filename: "doc.pdf",
            },
          ],
        }),
      );
    });

    it("passes empty files array when no files uploaded", async () => {
      const req = makeAuthReq("user-1");
      await controller.generateImageWithFiles(
        [],
        { prompt: "Test" } as never,
        req,
      );

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ files: [] }),
      );
    });

    it("handles dto.urls as array", async () => {
      const req = makeAuthReq("user-1");
      const dto = { prompt: "Test", urls: ["https://a.com", "https://b.com"] };

      await controller.generateImageWithFiles([], dto as never, req);

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ urls: ["https://a.com", "https://b.com"] }),
      );
    });

    it("wraps dto.urls single string in array", async () => {
      const req = makeAuthReq("user-1");
      const dto = { prompt: "Test", urls: "https://a.com" };

      await controller.generateImageWithFiles([], dto as never, req);

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ urls: ["https://a.com"] }),
      );
    });

    it("passes undefined for urls when dto.urls is absent", async () => {
      const req = makeAuthReq("user-1");
      const dto = { prompt: "Test" };

      await controller.generateImageWithFiles([], dto as never, req);

      expect(mockService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ urls: undefined }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getHistory
  // -------------------------------------------------------------------------

  describe("getHistory()", () => {
    it("calls service.getHistory with user id from request", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.getHistory(req);
      expect(mockService.getHistory).toHaveBeenCalledWith("user-1");
      expect(result).toEqual([]);
    });

    it("calls service.getHistory with undefined when no user", async () => {
      const req = makeAuthReq();
      await controller.getHistory(req);
      expect(mockService.getHistory).toHaveBeenCalledWith(undefined);
    });
  });

  // -------------------------------------------------------------------------
  // getBookmarkedImages
  // -------------------------------------------------------------------------

  describe("getBookmarkedImages()", () => {
    it("calls service.getBookmarkedImages with user id from request", async () => {
      const req = makeAuthReq("user-1");
      await controller.getBookmarkedImages(req);
      expect(mockService.getBookmarkedImages).toHaveBeenCalledWith("user-1");
    });
  });

  // -------------------------------------------------------------------------
  // getPublicImage
  // -------------------------------------------------------------------------

  describe("getPublicImage()", () => {
    it("returns image when service returns a result", async () => {
      const result = await controller.getPublicImage("img-1");
      expect(result).toEqual({
        id: "img-1",
        imageUrl: "http://example.com/img.png",
      });
      expect(mockService.getPublicImage).toHaveBeenCalledWith("img-1");
    });

    it("throws NotFoundException when service returns null", async () => {
      mockService.getPublicImage.mockResolvedValueOnce(null);

      await expect(controller.getPublicImage("missing-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getImageStats
  // -------------------------------------------------------------------------

  describe("getImageStats()", () => {
    it("returns stats when correct admin key is provided", async () => {
      const result = await controller.getImageStats(ADMIN_KEY);
      expect(result).toEqual({ total: 10 });
      expect(mockService.getImageStats).toHaveBeenCalled();
    });

    it("throws ForbiddenException when key is wrong", async () => {
      await expect(controller.getImageStats("wrong-key")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws ForbiddenException when key is empty", async () => {
      await expect(controller.getImageStats("")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // adminDeleteAllImages
  // -------------------------------------------------------------------------

  describe("adminDeleteAllImages()", () => {
    it("deletes all images and returns count with correct key", async () => {
      const result = await controller.adminDeleteAllImages(ADMIN_KEY);
      expect(result).toEqual({
        deletedCount: 10,
        message: "Deleted 10 images",
      });
      expect(mockService.deleteAllImages).toHaveBeenCalled();
    });

    it("throws ForbiddenException when key is wrong", async () => {
      await expect(controller.adminDeleteAllImages("bad-key")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws ForbiddenException when key is missing", async () => {
      await expect(controller.adminDeleteAllImages("")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // getImage
  // -------------------------------------------------------------------------

  describe("getImage()", () => {
    it("returns image from service", async () => {
      const result = await controller.getImage("img-1");
      expect(result).toEqual({ id: "img-1" });
      expect(mockService.getImage).toHaveBeenCalledWith("img-1");
    });
  });

  // -------------------------------------------------------------------------
  // deleteImage
  // -------------------------------------------------------------------------

  describe("deleteImage()", () => {
    it("calls service.deleteImage with id and userId", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.deleteImage("img-1", req);
      expect(mockService.deleteImage).toHaveBeenCalledWith("img-1", "user-1");
      expect(result).toEqual({ success: true, message: "Deleted" });
    });
  });

  // -------------------------------------------------------------------------
  // addBookmark / removeBookmark
  // -------------------------------------------------------------------------

  describe("addBookmark()", () => {
    it("calls service.addBookmark with id and userId", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.addBookmark("img-1", req);
      expect(mockService.addBookmark).toHaveBeenCalledWith("img-1", "user-1");
      expect(result).toEqual({ success: true, message: "Bookmarked" });
    });
  });

  describe("removeBookmark()", () => {
    it("calls service.removeBookmark with id and userId", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.removeBookmark("img-1", req);
      expect(mockService.removeBookmark).toHaveBeenCalledWith(
        "img-1",
        "user-1",
      );
      expect(result).toEqual({ success: true, message: "Removed" });
    });
  });

  // -------------------------------------------------------------------------
  // updateVisibility
  // -------------------------------------------------------------------------

  describe("updateVisibility()", () => {
    it("calls service.updateVisibility with id, visibility and userId", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.updateVisibility("img-1", "PUBLIC", req);
      expect(mockService.updateVisibility).toHaveBeenCalledWith(
        "img-1",
        "PUBLIC",
        "user-1",
      );
      expect(result).toEqual({ success: true, message: "Updated" });
    });

    it("works with PRIVATE visibility", async () => {
      const req = makeAuthReq("user-1");
      await controller.updateVisibility("img-1", "PRIVATE", req);
      expect(mockService.updateVisibility).toHaveBeenCalledWith(
        "img-1",
        "PRIVATE",
        "user-1",
      );
    });
  });

  // -------------------------------------------------------------------------
  // cleanupOldImages
  // -------------------------------------------------------------------------

  describe("cleanupOldImages()", () => {
    it("calls service.cleanupOldImages with user id", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.cleanupOldImages(req);
      expect(mockService.cleanupOldImages).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({
        deletedCount: 3,
        message: "Cleaned up 3 old images",
      });
    });

    it("passes null when no user in request", async () => {
      const req = makeAuthReq();
      await controller.cleanupOldImages(req);
      expect(mockService.cleanupOldImages).toHaveBeenCalledWith(null);
    });
  });

  // -------------------------------------------------------------------------
  // adminCleanupAllImages
  // -------------------------------------------------------------------------

  describe("adminCleanupAllImages()", () => {
    it("cleans all images and returns summary with correct key", async () => {
      const result = await controller.adminCleanupAllImages(ADMIN_KEY);
      expect(result).toMatchObject({
        totalDeleted: 5,
        usersCleaned: 2,
        orphanDeleted: 1,
        message: "Cleaned up 5 images from 2 users",
      });
    });

    it("throws ForbiddenException with wrong key", async () => {
      await expect(controller.adminCleanupAllImages("wrong")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // autoTagImages
  // -------------------------------------------------------------------------

  describe("autoTagImages()", () => {
    it("calls service.autoTagImages with user id", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.autoTagImages(req);
      expect(mockService.autoTagImages).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ tagged: 3 });
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      const req = makeAuthReq();
      await expect(controller.autoTagImages(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // analyzeStyles
  // -------------------------------------------------------------------------

  describe("analyzeStyles()", () => {
    it("calls service.analyzeStyles with user id", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.analyzeStyles(req);
      expect(mockService.analyzeStyles).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ styles: [] });
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      const req = makeAuthReq();
      await expect(controller.analyzeStyles(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // clusterVisualThemes
  // -------------------------------------------------------------------------

  describe("clusterVisualThemes()", () => {
    it("calls service.clusterVisualThemes with user id", async () => {
      const req = makeAuthReq("user-1");
      const result = await controller.clusterVisualThemes(req);
      expect(mockService.clusterVisualThemes).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ clusters: [] });
    });

    it("throws UnauthorizedException when user is not authenticated", async () => {
      const req = makeAuthReq();
      await expect(controller.clusterVisualThemes(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
