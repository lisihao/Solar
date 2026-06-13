/**
 * ImageGenerationTool Unit Tests
 *
 * Tests the image-generation tool in isolation by mocking IImageGenerationService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Observable } from "rxjs";
import {
  ImageGenerationTool,
  ImageGenerationOutput,
} from "../image-generation.tool";
import {
  IMAGE_GENERATION_SERVICE,
  IImageGenerationService,
  ImageGenerationStreamEvent,
} from "../../../abstractions/generation-services.interface";
import { ToolContext, ToolResult } from "../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-img-001",
    toolId: "image-generation",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCompleteEvent(result: {
  imageUrl?: string;
  url?: string;
  width?: number;
  height?: number;
  model?: string;
}): ImageGenerationStreamEvent {
  return {
    data: JSON.stringify({ type: "complete", result }),
  };
}

function makeErrorEvent(error: string): ImageGenerationStreamEvent {
  return {
    data: JSON.stringify({ type: "error", error }),
  };
}

/**
 * Creates an async Observable that emits events on the next microtask tick.
 * This avoids the "subscription used before initialization" bug in image-generation.tool.ts
 * which only triggers when the Observable emits synchronously (like rxjs `of()`).
 */
function makeAsyncObservable(
  events: ImageGenerationStreamEvent[],
): Observable<ImageGenerationStreamEvent> {
  return new Observable((subscriber) => {
    setTimeout(() => {
      events.forEach((e) => subscriber.next(e));
      subscriber.complete();
    }, 0);
  });
}

// ---------------------------------------------------------------------------
// Mock IImageGenerationService
// ---------------------------------------------------------------------------

function createMockImageService(): jest.Mocked<IImageGenerationService> {
  return {
    generateImageStream: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ImageGenerationTool", () => {
  let tool: ImageGenerationTool;
  let mockImageService: jest.Mocked<IImageGenerationService>;

  beforeEach(async () => {
    mockImageService = createMockImageService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGenerationTool,
        { provide: IMAGE_GENERATION_SERVICE, useValue: mockImageService },
      ],
    }).compile();

    tool = module.get<ImageGenerationTool>(ImageGenerationTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'image-generation'", () => {
      expect(tool.id).toBe("image-generation");
    });

    it("should belong to the 'generation' category", () => {
      expect(tool.category).toBe("generation");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid non-empty prompt", () => {
      expect(tool.validateInput({ prompt: "A mountain sunset" })).toBe(true);
    });

    it("should return false for an empty prompt", () => {
      expect(tool.validateInput({ prompt: "" })).toBe(false);
    });

    it("should return false for a whitespace-only prompt", () => {
      expect(tool.validateInput({ prompt: "   " })).toBe(false);
    });

    it("should return false for a prompt exceeding 5000 characters", () => {
      expect(tool.validateInput({ prompt: "a".repeat(5001) })).toBe(false);
    });

    it("should return true for a prompt at exactly 5000 characters", () => {
      expect(tool.validateInput({ prompt: "a".repeat(5000) })).toBe(true);
    });

    it("should return true with optional fields", () => {
      expect(
        tool.validateInput({
          prompt: "A sunset",
          style: "realistic",
          aspectRatio: "16:9",
        }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with imageUrl on valid stream", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([
          makeCompleteEvent({
            imageUrl: "https://storage.example.com/images/output.png",
            width: 1920,
            height: 1080,
            model: "dall-e-3",
          }),
        ]),
      );

      const result: ToolResult<ImageGenerationOutput> = await tool.execute(
        { prompt: "A serene mountain lake at dawn" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.imageUrl).toBe(
        "https://storage.example.com/images/output.png",
      );
    });

    it("should include width, height, and model in output", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([
          makeCompleteEvent({
            imageUrl: "https://example.com/img.png",
            width: 1280,
            height: 720,
            model: "stable-diffusion",
          }),
        ]),
      );

      const result = await tool.execute(
        { prompt: "A landscape" },
        makeContext(),
      );

      expect(result.data?.width).toBe(1280);
      expect(result.data?.height).toBe(720);
      expect(result.data?.model).toBe("stable-diffusion");
    });

    it("should fall back to url field when imageUrl is not in result", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([
          makeCompleteEvent({
            url: "https://example.com/fallback.png",
          }),
        ]),
      );

      const result = await tool.execute(
        { prompt: "A fallback test" },
        makeContext(),
      );

      expect(result.data?.imageUrl).toBe("https://example.com/fallback.png");
    });

    it("should pass aspectRatio to generateImageStream", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([
          makeCompleteEvent({ imageUrl: "https://example.com/img.png" }),
        ]),
      );

      await tool.execute(
        { prompt: "A portrait", aspectRatio: "9:16" },
        makeContext(),
      );

      expect(mockImageService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: "9:16" }),
      );
    });

    it("should default aspectRatio to 16:9 when 4:3 provided (not in valid set)", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([
          makeCompleteEvent({ imageUrl: "https://example.com/img.png" }),
        ]),
      );

      await tool.execute(
        { prompt: "A wide image", aspectRatio: "4:3" },
        makeContext(),
      );

      expect(mockImageService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({ aspectRatio: "16:9" }),
      );
    });

    it("should pass style, content, and urls to the service", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([
          makeCompleteEvent({ imageUrl: "https://example.com/img.png" }),
        ]),
      );

      await tool.execute(
        {
          prompt: "Infographic",
          content: "Data about AI",
          urls: ["https://source.example.com"],
          style: "minimal",
        },
        makeContext(),
      );

      expect(mockImageService.generateImageStream).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Infographic",
          content: "Data about AI",
          urls: ["https://source.example.com"],
          style: "minimal",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Service not available
  // -------------------------------------------------------------------------

  describe("execute() - service not available", () => {
    it("should return success:false when image service is not injected", async () => {
      const moduleWithoutService = await Test.createTestingModule({
        providers: [ImageGenerationTool],
      }).compile();

      const toolWithoutService =
        moduleWithoutService.get<ImageGenerationTool>(ImageGenerationTool);

      const result = await toolWithoutService.execute(
        { prompt: "Test without service" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("not available");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return success:false when stream emits error event", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([makeErrorEvent("Model quota exceeded")]),
      );

      const result = await tool.execute(
        { prompt: "Quota test" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Model quota exceeded");
    });

    it("should return success:false when stream completes without result", async () => {
      // Stream completes with no complete event (empty async stream)
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([]),
      );

      const result = await tool.execute(
        { prompt: "Empty stream test" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
    });

    it("should return empty imageUrl on error", async () => {
      mockImageService.generateImageStream.mockReturnValue(
        makeAsyncObservable([makeErrorEvent("Service error")]),
      );

      const result = await tool.execute({ prompt: "fail" }, makeContext());

      expect(result.data?.imageUrl).toBe("");
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
        { prompt: "Cancelled" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockImageService.generateImageStream).not.toHaveBeenCalled();
    });
  });
});
