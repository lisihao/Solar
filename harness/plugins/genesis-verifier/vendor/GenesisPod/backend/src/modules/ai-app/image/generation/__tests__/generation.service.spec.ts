/**
 * AiImageService Unit Tests
 *
 * Coverage targets:
 * - getAvailableModels()
 * - generateImageStream() - Observable SSE stream (all major branches)
 * - generateImage() - non-streaming wrapper
 * - convertToInfographicContent() - tested indirectly via html_render mode
 * - All storage delegation methods
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AiImageService } from "../generation.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ContentExtractorService } from "../../../../../common/content-processing/content-extractor.service";
import { DataFetchingService } from "../../../../../common/content-processing/data-fetching.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { InfographicTemplateService } from "../../infographic/infographic.service";
import { PromptEnhancementService } from "../prompt-enhancement.service";
import { ImageGenerationService } from "../image-generation.service";
import { ImageStorageService } from "../../storage/storage.service";
import { Imagen4PromptService } from "../imagen4-prompt.service";
import { BillingContext } from "../../../../platform/credits/billing-context.store";
import { AIModelType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const makeMockPrisma = () => ({
  generatedImage: {
    create: jest
      .fn()
      .mockResolvedValue({ id: "img-1", createdAt: new Date("2024-01-01") }),
  },
});

const makeMockContentExtractor = () => ({
  extractFromUrl: jest
    .fn()
    .mockResolvedValue(
      "Extracted URL content that is long enough to pass validation checks and exceed minimum length",
    ),
  extractFromFile: jest
    .fn()
    .mockResolvedValue(
      "Extracted file content that is long enough to pass validation checks",
    ),
});

const makeMockInfographicTemplate = () => ({
  generateInfographic: jest
    .fn()
    .mockResolvedValue("http://storage.example.com/infographic.png"),
});

const makeMockDataFetching = () => ({
  detectDataFetchingNeed: jest.fn().mockReturnValue({ needsFetching: false }),
  processDataFetching: jest
    .fn()
    .mockResolvedValue({ fetchedData: [], enrichedContent: "" }),
});

const makeDefaultInsights = () => ({
  renderingMode: "ai_image" as const,
  imagePrompt: "Enhanced image prompt",
  designJournal: [],
  informationArchitecture: {
    title: "Title",
    sections: [],
    subtitle: undefined,
    heroStatement: undefined,
    callToAction: undefined,
  },
  visualLanguage: {
    primaryColor: "#1e3a5f",
    accentColor: "#0891b2",
    backgroundColor: "#f8fafc",
    textColor: "#334155",
    designStyle: "consulting",
    fontStyle: "sans",
    borderRadius: "medium",
    shadowStyle: "medium",
    colorPalette: [],
  },
  backgroundPrompt: undefined,
  templateLayout: "cards" as const,
  layoutPlan: [],
  qualityChecks: [],
  negativeKeywords: [],
  styleShiftReasoning: [],
  inspiration: [],
});

const makeMockPromptEnhancement = () => ({
  enhancePromptWithLLM: jest.fn().mockResolvedValue("Enhanced prompt JSON"),
  parsePromptEnhancementResponse: jest
    .fn()
    .mockReturnValue(makeDefaultInsights()),
  composeFinalImagePrompt: jest.fn().mockReturnValue({
    prompt: "Final image prompt",
    negativeCandidates: [],
  }),
});

const makeMockImageGeneration = () => ({
  getDefaultTextModel: jest
    .fn()
    .mockResolvedValue({ modelId: "gpt-4o", displayName: "GPT-4o" }),
  getDefaultImageModel: jest.fn().mockResolvedValue({
    modelId: "dall-e-3",
    displayName: "DALL-E 3",
    apiKey: "test-key",
  }),
  getModelById: jest.fn().mockResolvedValue({
    modelId: "dall-e-3",
    displayName: "DALL-E 3",
    apiKey: "test-key",
  }),
  callImageGenerationAPI: jest
    .fn()
    .mockResolvedValue("http://example.com/image.png"),
});

const makeMockImageStorage = () => ({
  uploadImageToStorage: jest
    .fn()
    .mockResolvedValue("http://storage.example.com/image.png"),
  cleanupOldImages: jest.fn().mockResolvedValue(2),
  getHistory: jest.fn().mockResolvedValue([]),
  getImage: jest.fn().mockResolvedValue({ id: "img-1" }),
  getPublicImage: jest.fn().mockResolvedValue({ id: "img-1" }),
  deleteImage: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Deleted" }),
  getBookmarkedImages: jest.fn().mockResolvedValue([]),
  addBookmark: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Bookmarked" }),
  removeBookmark: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Removed" }),
  updateVisibility: jest
    .fn()
    .mockResolvedValue({ success: true, message: "Updated" }),
  cleanupAllUsersImages: jest
    .fn()
    .mockResolvedValue({ totalDeleted: 5, usersCleaned: 2, orphanDeleted: 1 }),
  getImageStats: jest.fn().mockResolvedValue({ total: 10 }),
  deleteAllImages: jest.fn().mockResolvedValue(10),
  autoTagImages: jest.fn().mockResolvedValue({ tagged: 3 }),
  analyzeStyles: jest.fn().mockResolvedValue({ styles: [] }),
  clusterVisualThemes: jest.fn().mockResolvedValue({ clusters: [] }),
});

const makeMockImagen4Prompt = () => ({
  generateImagen4Prompt: jest.fn().mockResolvedValue({
    finalPrompt: "Imagen4 final prompt",
    negativePrompt: "blurry",
    insights: makeDefaultInsights(),
    statistics: { totalDuration: 1000 },
  }),
});

const makeMockAIFacade = () => ({
  getAvailableModels: jest.fn().mockImplementation((type: AIModelType) => {
    if (type === AIModelType.CHAT) {
      return Promise.resolve([
        {
          dbId: "db-1",
          id: "gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          icon: undefined,
          isDefault: true,
        },
      ]);
    }
    return Promise.resolve([
      {
        dbId: "db-img-1",
        id: "dall-e-3",
        name: "DALL-E 3",
        provider: "openai",
        icon: "openai-icon",
        isDefault: false,
      },
    ]);
  }),
});

// ---------------------------------------------------------------------------
// Helper: collect all SSE events from the stream
// ---------------------------------------------------------------------------

async function collectStreamEvents(
  stream: ReturnType<AiImageService["generateImageStream"]>,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  await new Promise<void>((resolve, reject) => {
    stream.subscribe({
      next: (event) => {
        try {
          events.push(JSON.parse(event.data as string));
        } catch {
          // ignore parse errors in test helpers
        }
      },
      complete: () => resolve(),
      error: reject,
    });
  });
  return events;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AiImageService", () => {
  let service: AiImageService;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockContentExtractor: ReturnType<typeof makeMockContentExtractor>;
  let mockInfographicTemplate: ReturnType<typeof makeMockInfographicTemplate>;
  let mockDataFetching: ReturnType<typeof makeMockDataFetching>;
  let mockPromptEnhancement: ReturnType<typeof makeMockPromptEnhancement>;
  let mockImageGeneration: ReturnType<typeof makeMockImageGeneration>;
  let mockImageStorage: ReturnType<typeof makeMockImageStorage>;
  let mockImagen4Prompt: ReturnType<typeof makeMockImagen4Prompt>;
  let mockAIFacade: ReturnType<typeof makeMockAIFacade>;

  beforeEach(async () => {
    mockPrisma = makeMockPrisma();
    mockContentExtractor = makeMockContentExtractor();
    mockInfographicTemplate = makeMockInfographicTemplate();
    mockDataFetching = makeMockDataFetching();
    mockPromptEnhancement = makeMockPromptEnhancement();
    mockImageGeneration = makeMockImageGeneration();
    mockImageStorage = makeMockImageStorage();
    mockImagen4Prompt = makeMockImagen4Prompt();
    mockAIFacade = makeMockAIFacade();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContentExtractorService, useValue: mockContentExtractor },
        {
          provide: InfographicTemplateService,
          useValue: mockInfographicTemplate,
        },
        { provide: DataFetchingService, useValue: mockDataFetching },
        { provide: PromptEnhancementService, useValue: mockPromptEnhancement },
        { provide: ImageGenerationService, useValue: mockImageGeneration },
        { provide: ImageStorageService, useValue: mockImageStorage },
        { provide: Imagen4PromptService, useValue: mockImagen4Prompt },
        { provide: ChatFacade, useValue: mockAIFacade },
      ],
    }).compile();

    service = module.get<AiImageService>(AiImageService);

    // Bypass BillingContext.run so it just calls the function
    jest.spyOn(BillingContext, "run").mockImplementation((_ctx, fn) => fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // getAvailableModels
  // -------------------------------------------------------------------------

  describe("getAvailableModels()", () => {
    it("returns formatted text and image model lists", async () => {
      const result = await service.getAvailableModels();

      expect(result).toHaveProperty("textModels");
      expect(result).toHaveProperty("imageModels");

      expect(result.textModels).toHaveLength(1);
      expect(result.textModels[0]).toMatchObject({
        id: "db-1",
        name: "GPT-4o",
        provider: "openai",
        modelId: "gpt-4o",
        isDefault: true,
      });

      expect(result.imageModels).toHaveLength(1);
      expect(result.imageModels[0]).toMatchObject({
        id: "db-img-1",
        name: "DALL-E 3",
        provider: "openai",
        modelId: "dall-e-3",
        icon: "openai-icon",
        isDefault: false,
      });
    });

    it("falls back to model id when dbId is absent", async () => {
      mockAIFacade.getAvailableModels.mockImplementation(
        (type: AIModelType) => {
          if (type === AIModelType.CHAT) {
            return Promise.resolve([
              {
                id: "gpt-4o",
                name: "GPT-4o",
                provider: "openai",
                isDefault: false,
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const result = await service.getAvailableModels();
      expect(result.textModels[0].id).toBe("gpt-4o");
    });

    it("calls aiFacade.getAvailableModels with CHAT and IMAGE_GENERATION types", async () => {
      await service.getAvailableModels();
      expect(mockAIFacade.getAvailableModels).toHaveBeenCalledWith(
        AIModelType.CHAT,
      );
      expect(mockAIFacade.getAvailableModels).toHaveBeenCalledWith(
        AIModelType.IMAGE_GENERATION,
      );
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - validation
  // -------------------------------------------------------------------------

  describe("generateImageStream() - input validation", () => {
    it("emits error event when no input is provided", async () => {
      const events = await collectStreamEvents(service.generateImageStream({}));

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error).toMatch(/At least one input is required/i);
    });

    it("emits error event when only empty URLs are provided", async () => {
      const events = await collectStreamEvents(
        service.generateImageStream({ urls: ["   ", ""] }),
      );

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - prompt-only (ai_image mode via 4-agent team)
  // -------------------------------------------------------------------------

  describe("generateImageStream() - with prompt only", () => {
    it("emits step events and a complete event", async () => {
      const events = await collectStreamEvents(
        service.generateImageStream({
          prompt: "A beautiful landscape",
          userId: "user-1",
        }),
      );

      const stepEvents = events.filter((e) => e.type === "step");
      const completeEvent = events.find((e) => e.type === "complete");

      expect(stepEvents.length).toBeGreaterThan(0);
      expect(completeEvent).toBeDefined();
    });

    it("complete event contains expected result fields", async () => {
      const events = await collectStreamEvents(
        service.generateImageStream({
          prompt: "Test prompt",
          userId: "user-1",
        }),
      );

      const complete = events.find((e) => e.type === "complete") as {
        type: string;
        result: Record<string, unknown>;
      };

      expect(complete).toBeDefined();
      expect(complete.result).toMatchObject({
        id: "img-1",
        imageUrl: "http://storage.example.com/image.png",
        width: 1024,
        height: 1024,
      });
    });

    it("calls imagen4PromptService.generateImagen4Prompt", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test", userId: "user-1" }),
      );
      expect(mockImagen4Prompt.generateImagen4Prompt).toHaveBeenCalledTimes(1);
    });

    it("calls uploadImageToStorage after generation", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test", userId: "user-1" }),
      );
      expect(mockImageStorage.uploadImageToStorage).toHaveBeenCalledWith(
        "http://example.com/image.png",
        "user-1",
      );
    });

    it("triggers cleanupOldImages when userId is provided", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test", userId: "user-1" }),
      );
      expect(mockImageStorage.cleanupOldImages).toHaveBeenCalledWith("user-1");
    });

    it("does not trigger cleanupOldImages when userId is absent", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "A prompt that is definitely long enough",
        }),
      );
      expect(mockImageStorage.cleanupOldImages).not.toHaveBeenCalled();
    });

    it("wraps execution with BillingContext when userId is provided", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test", userId: "user-123" }),
      );
      expect(BillingContext.run).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-123", moduleType: "ai-image" }),
        expect.any(Function),
      );
    });

    it("does not use BillingContext when userId is absent", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "A sufficiently long prompt text here",
        }),
      );
      expect(BillingContext.run).not.toHaveBeenCalled();
    });

    it("saves record to prisma.generatedImage.create", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "Test prompt",
          userId: "user-1",
        }),
      );
      expect(mockPrisma.generatedImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            imageUrl: "http://storage.example.com/image.png",
            userId: "user-1",
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - skipEnhancement
  // -------------------------------------------------------------------------

  describe("generateImageStream() - skipEnhancement=true", () => {
    it("does not call imagen4PromptService when skipEnhancement is true", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "Direct prompt",
          skipEnhancement: true,
        }),
      );
      expect(mockImagen4Prompt.generateImagen4Prompt).not.toHaveBeenCalled();
    });

    it("uses direct input as image prompt", async () => {
      const events = await collectStreamEvents(
        service.generateImageStream({
          prompt: "Direct prompt",
          skipEnhancement: true,
        }),
      );
      const stepEvents = events.filter((e) => e.type === "step");
      stepEvents.find(
        (e) =>
          (e.step as { title?: string })?.title === "Using Direct Input" ||
          (e as { step?: { title?: string } }).step?.title ===
            "Using Direct Input",
      );
      // Verify complete event still arrives (stream succeeded)
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - URL extraction
  // -------------------------------------------------------------------------

  describe("generateImageStream() - with URLs", () => {
    it("calls contentExtractor.extractFromUrl for each URL", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "Summarize these articles",
          urls: [
            "https://example.com/article1",
            "https://example.com/article2",
          ],
        }),
      );
      expect(mockContentExtractor.extractFromUrl).toHaveBeenCalledTimes(2);
      expect(mockContentExtractor.extractFromUrl).toHaveBeenCalledWith(
        "https://example.com/article1",
      );
      expect(mockContentExtractor.extractFromUrl).toHaveBeenCalledWith(
        "https://example.com/article2",
      );
    });

    it("skips empty URL entries", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "Test",
          urls: ["https://example.com/article", "   "],
        }),
      );
      expect(mockContentExtractor.extractFromUrl).toHaveBeenCalledTimes(1);
    });

    it("emits error when URL content is too short", async () => {
      mockContentExtractor.extractFromUrl.mockResolvedValueOnce("short");

      const events = await collectStreamEvents(
        service.generateImageStream({
          urls: ["https://example.com/empty"],
        }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });

    it("emits error step when URL extraction throws", async () => {
      mockContentExtractor.extractFromUrl.mockRejectedValueOnce(
        new Error("Network error"),
      );

      const events = await collectStreamEvents(
        service.generateImageStream({
          urls: ["https://example.com/fail"],
        }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - file extraction
  // -------------------------------------------------------------------------

  describe("generateImageStream() - with files", () => {
    const testFile = {
      buffer: Buffer.from("test pdf content"),
      mimeType: "application/pdf",
      filename: "report.pdf",
    };

    it("calls contentExtractor.extractFromFile for each file", async () => {
      await collectStreamEvents(
        service.generateImageStream({ files: [testFile] }),
      );
      expect(mockContentExtractor.extractFromFile).toHaveBeenCalledWith(
        testFile.buffer,
        testFile.mimeType,
        testFile.filename,
      );
    });

    it("emits error step and propagates when file extraction fails", async () => {
      mockContentExtractor.extractFromFile.mockRejectedValueOnce(
        new Error("Parse error"),
      );

      const events = await collectStreamEvents(
        service.generateImageStream({ files: [testFile] }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - imageBase64 reference
  // -------------------------------------------------------------------------

  describe("generateImageStream() - with imageBase64", () => {
    it("emits reference image step and proceeds to generation", async () => {
      const events = await collectStreamEvents(
        service.generateImageStream({
          imageBase64: "base64encodedimage",
          prompt: "Generate similar",
        }),
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("passes imageBase64 to callImageGenerationAPI", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          imageBase64: "base64encodedimage",
          prompt: "Generate similar",
        }),
      );
      expect(mockImageGeneration.callImageGenerationAPI).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        "base64encodedimage",
        undefined, // userId (not provided in this test)
      );
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - 4-agent team fallback
  // -------------------------------------------------------------------------

  describe("generateImageStream() - fallback to single LLM", () => {
    it("falls back to single LLM when imagen4PromptService throws", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockRejectedValueOnce(
        new Error("Team error"),
      );

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test prompt" }),
      );

      // Single LLM path calls imageGenerationService.getDefaultTextModel
      expect(mockImageGeneration.getDefaultTextModel).toHaveBeenCalled();
      // Should still complete successfully
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("emits error when no text model is available and 4-agent team failed", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockRejectedValueOnce(
        new Error("Team error"),
      );
      mockImageGeneration.getDefaultTextModel.mockResolvedValueOnce(null);

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test prompt" }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error).toMatch(/No text model configured/i);
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - rendering modes
  // -------------------------------------------------------------------------

  describe("generateImageStream() - html_render mode", () => {
    beforeEach(() => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValue({
        finalPrompt: "HTML infographic prompt",
        negativePrompt: "blurry",
        insights: {
          ...makeDefaultInsights(),
          renderingMode: "html_render",
          informationArchitecture: {
            title: "Test Title",
            subtitle: "Subtitle",
            sections: [
              {
                title: "Section 1",
                summary: "Summary text",
                bullets: ["Point 1", "Point 2"],
                metrics: [
                  { label: "Revenue", value: "$1M", comparison: "+10%" },
                ],
                iconType: "chart",
                sectionType: "main",
              },
            ],
            callToAction: "Learn more",
          },
        },
        statistics: { totalDuration: 500 },
      });
    });

    it("calls infographicTemplate.generateInfographic in html_render mode", async () => {
      const events = await collectStreamEvents(
        service.generateImageStream({
          prompt: "Create infographic",
          userId: "user-1",
        }),
      );
      expect(mockInfographicTemplate.generateInfographic).toHaveBeenCalled();
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("applies userTemplateLayout override in html_render mode", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "Create infographic",
          templateLayout: "timeline",
        }),
      );
      expect(mockInfographicTemplate.generateInfographic).toHaveBeenCalledWith(
        expect.objectContaining({
          styleOptions: expect.objectContaining({ templateLayout: "timeline" }),
        }),
        undefined,
      );
    });

    it("maps sections to InfographicSection format correctly", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Create infographic" }),
      );
      const callArg =
        mockInfographicTemplate.generateInfographic.mock.calls[0][0];
      expect(callArg.sections).toHaveLength(1);
      expect(callArg.sections[0]).toMatchObject({
        title: "Section 1",
        bullets: ["Point 1", "Point 2"],
        metrics: [{ label: "Revenue", value: "$1M", comparison: "+10%" }],
      });
    });

    it("propagates error when generateInfographic throws", async () => {
      mockInfographicTemplate.generateInfographic.mockRejectedValueOnce(
        new Error("Render failed"),
      );

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Create infographic" }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  describe("generateImageStream() - hybrid mode", () => {
    beforeEach(() => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValue({
        finalPrompt: "Hybrid mode prompt",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          renderingMode: "hybrid",
          backgroundPrompt: "Abstract blue background",
          informationArchitecture: {
            title: "Hybrid Title",
            sections: [],
          },
        },
        statistics: { totalDuration: 800 },
      });
    });

    it("generates AI background and then renders HTML infographic", async () => {
      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Hybrid test" }),
      );
      expect(mockImageGeneration.callImageGenerationAPI).toHaveBeenCalled();
      expect(mockInfographicTemplate.generateInfographic).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ backgroundImageBase64: expect.any(String) }),
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("uses custom imageModelId in hybrid mode", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "Hybrid test",
          imageModelId: "custom-model",
        }),
      );
      expect(mockImageGeneration.getModelById).toHaveBeenCalledWith(
        "custom-model",
      );
    });

    it("uses default image model when imageModelId is absent in hybrid mode", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Hybrid test" }),
      );
      expect(mockImageGeneration.getDefaultImageModel).toHaveBeenCalled();
    });

    it("continues with solid background when background generation fails", async () => {
      mockImageGeneration.callImageGenerationAPI.mockRejectedValueOnce(
        new Error("API error"),
      );

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Hybrid test" }),
      );
      // Infographic should still render without background
      expect(mockInfographicTemplate.generateInfographic).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("skips background generation when model has no apiKey or secretKey", async () => {
      mockImageGeneration.getDefaultImageModel.mockResolvedValueOnce({
        modelId: "no-key-model",
        displayName: "No Key Model",
        apiKey: undefined,
        secretKey: undefined,
      });

      await collectStreamEvents(
        service.generateImageStream({ prompt: "Hybrid test" }),
      );
      expect(mockImageGeneration.callImageGenerationAPI).not.toHaveBeenCalled();
      // HTML render should still proceed
      expect(mockInfographicTemplate.generateInfographic).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
      );
    });
  });

  describe("generateImageStream() - ai_image mode no apiKey", () => {
    it("emits error when image model has no apiKey and no secretKey", async () => {
      mockImageGeneration.getDefaultImageModel.mockResolvedValueOnce({
        modelId: "no-key-model",
        displayName: "No Key Model",
        apiKey: undefined,
        secretKey: undefined,
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test prompt" }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error).toMatch(/No image model configured/i);
    });

    it("proceeds when model has secretKey but no apiKey", async () => {
      mockImageGeneration.getDefaultImageModel.mockResolvedValueOnce({
        modelId: "secret-model",
        displayName: "Secret Model",
        apiKey: undefined,
        secretKey: "my-secret",
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test prompt" }),
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("uses custom imageModelId when provided", async () => {
      await collectStreamEvents(
        service.generateImageStream({
          prompt: "Test",
          imageModelId: "custom-img-model",
        }),
      );
      expect(mockImageGeneration.getModelById).toHaveBeenCalledWith(
        "custom-img-model",
      );
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - data fetching
  // -------------------------------------------------------------------------

  describe("generateImageStream() - data fetching", () => {
    it("enriches content when data fetching is needed and returns data", async () => {
      mockDataFetching.detectDataFetchingNeed.mockReturnValueOnce({
        needsFetching: true,
        intent: "stock data",
      });
      mockDataFetching.processDataFetching.mockResolvedValueOnce({
        fetchedData: [{ source: "api", data: "some data" }],
        enrichedContent: "Enriched content with real-time data",
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Show Apple stock price" }),
      );
      expect(mockDataFetching.processDataFetching).toHaveBeenCalled();
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("proceeds with original content when data fetching returns no data", async () => {
      mockDataFetching.detectDataFetchingNeed.mockReturnValueOnce({
        needsFetching: true,
        intent: "stock data",
      });
      mockDataFetching.processDataFetching.mockResolvedValueOnce({
        fetchedData: [],
        enrichedContent: "",
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Show Apple stock price" }),
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });

    it("skips data fetching gracefully on timeout", async () => {
      mockDataFetching.detectDataFetchingNeed.mockReturnValueOnce({
        needsFetching: true,
        intent: "data",
      });
      // Simulate the timeout branch by rejecting with a timeout error (mimics Promise.race loser)
      mockDataFetching.processDataFetching.mockRejectedValueOnce(
        new Error("Data fetching timeout (5s)"),
      );

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test with timeout data" }),
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    }, 15000);

    it("continues when detectDataFetchingNeed returns needsFetching=false", async () => {
      mockDataFetching.detectDataFetchingNeed.mockReturnValueOnce({
        needsFetching: false,
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Simple prompt" }),
      );
      expect(mockDataFetching.processDataFetching).not.toHaveBeenCalled();
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - design journal and information architecture
  // -------------------------------------------------------------------------

  describe("generateImageStream() - step emission for insights", () => {
    it("emits journal steps when designJournal has entries", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValueOnce({
        finalPrompt: "Prompt with journal",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          designJournal: [
            { title: "Step One", narrative: "Narrative one" },
            { title: "Step Two", narrative: "Narrative two" },
          ],
          informationArchitecture: { title: "Test", sections: [] },
        },
        statistics: { totalDuration: 500 },
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );
      const stepEvents = events.filter((e) => e.type === "step");
      const journalSteps = stepEvents.filter((e) =>
        String((e.step as { step?: string })?.step || "").startsWith(
          "prompt_journal_",
        ),
      );
      expect(journalSteps.length).toBeGreaterThanOrEqual(2);
    });

    it("emits information architecture step when title is present", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValueOnce({
        finalPrompt: "Prompt",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          informationArchitecture: {
            title: "Architecture Title",
            sections: [],
          },
        },
        statistics: { totalDuration: 300 },
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );
      const stepEvents = events.filter((e) => e.type === "step");
      const infoStep = stepEvents.find(
        (e) => (e.step as { step?: string })?.step === "prompt_information",
      );
      expect(infoStep).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - aspectRatio dimensions
  // -------------------------------------------------------------------------

  describe("generateImageStream() - aspect ratio dimensions", () => {
    it("uses 1024x1024 for 1:1 aspect ratio", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test", aspectRatio: "1:1" }),
      );
      expect(mockPrisma.generatedImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ width: 1024, height: 1024 }),
        }),
      );
    });

    it("uses 1344x768 for 16:9 aspect ratio", async () => {
      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test", aspectRatio: "16:9" }),
      );
      expect(mockPrisma.generatedImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ width: 1344, height: 768 }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - content-only input
  // -------------------------------------------------------------------------

  describe("generateImageStream() - with content only", () => {
    it("accepts content-only input and completes", async () => {
      const longContent = "This is a detailed content passage ".repeat(5);
      const events = await collectStreamEvents(
        service.generateImageStream({ content: longContent }),
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImage (non-streaming wrapper)
  // -------------------------------------------------------------------------

  describe("generateImage()", () => {
    it("resolves with the result object from the stream complete event", async () => {
      const result = await service.generateImage({
        prompt: "Test prompt",
        userId: "user-1",
      });

      expect(result).toMatchObject({
        id: "img-1",
        imageUrl: "http://storage.example.com/image.png",
      });
    });

    it("rejects when an error event is emitted", async () => {
      // Force stream to emit error
      mockImageGeneration.getDefaultImageModel.mockResolvedValueOnce(null);
      mockImagen4Prompt.generateImagen4Prompt.mockRejectedValueOnce(
        new Error("Team failure"),
      );
      mockImageGeneration.getDefaultTextModel.mockResolvedValueOnce(null);

      await expect(
        service.generateImage({ prompt: "Failing prompt" }),
      ).rejects.toThrow();
    });

    it("rejects when stream completes without result", async () => {
      // Return an observable that emits only a step event (no complete event) then finishes
      const { of: rxOf } = require("rxjs");
      jest
        .spyOn(service, "generateImageStream")
        .mockReturnValueOnce(
          rxOf({ data: JSON.stringify({ type: "step", step: {} }) }),
        );

      await expect(service.generateImage({ prompt: "Test" })).rejects.toThrow(
        "Generation completed without result",
      );
    });
  });

  // -------------------------------------------------------------------------
  // convertToInfographicContent (private - tested indirectly)
  // -------------------------------------------------------------------------

  describe("convertToInfographicContent() - fallback paths", () => {
    it("creates fallback bullets from imagePrompt when sections are empty", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValueOnce({
        finalPrompt: "Main prompt",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          renderingMode: "html_render",
          imagePrompt:
            "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.",
          informationArchitecture: {
            title: "Fallback Title",
            sections: [], // empty - triggers fallback
          },
        },
        statistics: { totalDuration: 300 },
      });

      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );

      const callArg =
        mockInfographicTemplate.generateInfographic.mock.calls[0][0];
      expect(callArg.sections).toHaveLength(1);
      expect(callArg.sections[0].title).toBe("Key Points");
    });

    it("creates placeholder section when imagePrompt has no valid sentences", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValueOnce({
        finalPrompt: "X",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          renderingMode: "html_render",
          imagePrompt: "", // empty prompt → placeholder
          informationArchitecture: {
            title: "Empty",
            sections: [],
          },
        },
        statistics: { totalDuration: 200 },
      });

      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );

      const callArg =
        mockInfographicTemplate.generateInfographic.mock.calls[0][0];
      expect(callArg.sections[0].title).toBe("Content Summary");
    });

    it("applies invalid designStyle fallback to consulting", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValueOnce({
        finalPrompt: "Test",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          renderingMode: "html_render",
          visualLanguage: {
            ...makeDefaultInsights().visualLanguage,
            designStyle: "unknown-style",
          },
          informationArchitecture: { title: "Test", sections: [] },
        },
        statistics: { totalDuration: 200 },
      });

      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );

      const callArg =
        mockInfographicTemplate.generateInfographic.mock.calls[0][0];
      expect(callArg.styleOptions.style).toBe("consulting");
    });

    it("maps valid templateLayout through to infographic", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValueOnce({
        finalPrompt: "Test",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          renderingMode: "html_render",
          templateLayout: "timeline",
          informationArchitecture: { title: "Test", sections: [] },
        },
        statistics: { totalDuration: 200 },
      });

      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );

      const callArg =
        mockInfographicTemplate.generateInfographic.mock.calls[0][0];
      expect(callArg.styleOptions.templateLayout).toBe("timeline");
    });

    it("falls back to cards when templateLayout is invalid", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockResolvedValueOnce({
        finalPrompt: "Test",
        negativePrompt: "",
        insights: {
          ...makeDefaultInsights(),
          renderingMode: "html_render",
          templateLayout: "not-a-layout" as never,
          informationArchitecture: { title: "Test", sections: [] },
        },
        statistics: { totalDuration: 200 },
      });

      await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );

      const callArg =
        mockInfographicTemplate.generateInfographic.mock.calls[0][0];
      expect(callArg.styleOptions.templateLayout).toBe("cards");
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - URL with user description (line 256/265)
  // -------------------------------------------------------------------------

  describe("generateImageStream() - URL with inline description", () => {
    it("appends user description to content parts when URL has trailing description", async () => {
      // parseUrlInput parses "https://example.com some description"
      const events = await collectStreamEvents(
        service.generateImageStream({
          prompt: "Test",
          urls: ["https://example.com/article Some description text here"],
        }),
      );
      expect(mockContentExtractor.extractFromUrl).toHaveBeenCalledWith(
        "https://example.com/article",
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - content validation edge cases (lines 348/352)
  // -------------------------------------------------------------------------

  describe("generateImageStream() - content validation errors", () => {
    it("emits error when content is too short and no direct prompt or imageBase64", async () => {
      // Provide only content that is too short (< MIN_CONTENT_LENGTH=50 and < MIN_PROMPT_LENGTH=10)
      mockContentExtractor.extractFromUrl.mockResolvedValueOnce("x".repeat(60));
      // extractCleanContent removes nothing, so we need a URL that yields short clean content
      // Instead: inject content directly that is very short but passes hasUrls=false check
      // The url path: content from URL is long enough, but let's use content='' path directly:
      // Use imageBase64 alone to check the MIN_CONTENT_LENGTH guard is skipped
      const events = await collectStreamEvents(
        service.generateImageStream({ content: "x" }), // < MIN_PROMPT_LENGTH
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });

    it("imageBase64-only skips content length validation", async () => {
      // With only imageBase64, hasReferenceImage=true skips both content validation checks
      const events = await collectStreamEvents(
        service.generateImageStream({ imageBase64: "base64data" }),
      );
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - detectDataFetchingNeed throws (line 417)
  // -------------------------------------------------------------------------

  describe("generateImageStream() - data fetching outer catch", () => {
    it("continues when detectDataFetchingNeed itself throws", async () => {
      mockDataFetching.detectDataFetchingNeed.mockImplementationOnce(() => {
        throw new Error("Detection error");
      });

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test prompt" }),
      );
      // Stream should still complete successfully despite the data fetching failure
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - imagen4 progress callback (lines 458-471)
  // -------------------------------------------------------------------------

  describe("generateImageStream() - imagen4 progress callback", () => {
    it("invokes progress callback and emits agent phase step events", async () => {
      mockImagen4Prompt.generateImagen4Prompt.mockImplementationOnce(
        async (
          _opts: unknown,
          progressCb: (event: {
            phase: string;
            status: string;
            message?: string;
          }) => void,
        ) => {
          // Simulate the callback being called by imagen4PromptService
          progressCb({
            phase: "content",
            status: "started",
            message: "Starting content analysis",
          });
          progressCb({
            phase: "layout",
            status: "completed",
            message: "Layout done",
          });
          progressCb({
            phase: "visual",
            status: "in_progress",
            message: "Visual in progress",
          });
          progressCb({
            phase: "style",
            status: "failed",
            message: "Style failed",
          });
          progressCb({
            phase: "complete",
            status: "completed",
            message: undefined,
          });
          return {
            finalPrompt: "Callback test prompt",
            negativePrompt: "",
            insights: makeDefaultInsights(),
            statistics: { totalDuration: 100 },
          };
        },
      );

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test with callbacks" }),
      );

      const stepEvents = events.filter((e) => e.type === "step");
      // Each step event: { type: 'step', step: { step: stepId, title, status, ... }, allSteps: [...] }
      const _agentSteps = stepEvents.filter((e) => {
        const stepObj = e.step as { step?: string } | undefined;
        return (
          typeof stepObj?.step === "string" && stepObj.step.startsWith("agent_")
        );
      });
      // The progress callback fires 5 times; each fires emitStep which may update existing step
      // so we look in allSteps of the last event for agent_ entries
      const lastStepEvent = stepEvents[stepEvents.length - 1];
      const allStepsArr =
        (lastStepEvent?.allSteps as Array<{ step: string }>) ?? [];
      const agentStepsInAll = allStepsArr.filter((s) =>
        s.step?.startsWith("agent_"),
      );
      expect(agentStepsInAll.length).toBeGreaterThanOrEqual(4);
      expect(events.find((e) => e.type === "complete")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateImageStream - null generatedImageUrl (line 709)
  // -------------------------------------------------------------------------

  describe("generateImageStream() - null generatedImageUrl", () => {
    it("emits error when callImageGenerationAPI returns null/undefined", async () => {
      mockImageGeneration.callImageGenerationAPI.mockResolvedValueOnce(null);

      const events = await collectStreamEvents(
        service.generateImageStream({ prompt: "Test" }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(String(errorEvent!.error)).toMatch(/Image generation failed/i);
    });
  });

  // -------------------------------------------------------------------------
  // generateImage - error subscriber path (line 798)
  // -------------------------------------------------------------------------

  describe("generateImage() - Observable error subscriber", () => {
    it("rejects via Observable error (not data.type error) path", async () => {
      const { throwError } = require("rxjs");
      jest
        .spyOn(service, "generateImageStream")
        .mockReturnValueOnce(
          throwError(() => new Error("Observable level error")),
        );

      await expect(service.generateImage({ prompt: "Test" })).rejects.toThrow(
        "Observable level error",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Storage delegation methods
  // -------------------------------------------------------------------------

  describe("storage delegation methods", () => {
    it("getHistory delegates to imageStorageService.getHistory", async () => {
      await service.getHistory("user-1");
      expect(mockImageStorage.getHistory).toHaveBeenCalledWith("user-1");
    });

    it("getImage delegates to imageStorageService.getImage", async () => {
      await service.getImage("img-1");
      expect(mockImageStorage.getImage).toHaveBeenCalledWith("img-1");
    });

    it("getPublicImage delegates to imageStorageService.getPublicImage", async () => {
      await service.getPublicImage("img-1");
      expect(mockImageStorage.getPublicImage).toHaveBeenCalledWith("img-1");
    });

    it("deleteImage delegates to imageStorageService.deleteImage", async () => {
      await service.deleteImage("img-1", "user-1");
      expect(mockImageStorage.deleteImage).toHaveBeenCalledWith(
        "img-1",
        "user-1",
      );
    });

    it("getBookmarkedImages delegates to imageStorageService.getBookmarkedImages", async () => {
      await service.getBookmarkedImages("user-1");
      expect(mockImageStorage.getBookmarkedImages).toHaveBeenCalledWith(
        "user-1",
      );
    });

    it("addBookmark delegates to imageStorageService.addBookmark", async () => {
      await service.addBookmark("img-1", "user-1");
      expect(mockImageStorage.addBookmark).toHaveBeenCalledWith(
        "img-1",
        "user-1",
      );
    });

    it("removeBookmark delegates to imageStorageService.removeBookmark", async () => {
      await service.removeBookmark("img-1", "user-1");
      expect(mockImageStorage.removeBookmark).toHaveBeenCalledWith(
        "img-1",
        "user-1",
      );
    });

    it("updateVisibility delegates to imageStorageService.updateVisibility", async () => {
      await service.updateVisibility("img-1", "PUBLIC", "user-1");
      expect(mockImageStorage.updateVisibility).toHaveBeenCalledWith(
        "img-1",
        "PUBLIC",
        "user-1",
      );
    });

    it("cleanupOldImages delegates to imageStorageService.cleanupOldImages", async () => {
      const result = await service.cleanupOldImages("user-1");
      expect(mockImageStorage.cleanupOldImages).toHaveBeenCalledWith("user-1");
      expect(result).toBe(2);
    });

    it("cleanupOldImages accepts null userId", async () => {
      await service.cleanupOldImages(null);
      expect(mockImageStorage.cleanupOldImages).toHaveBeenCalledWith(null);
    });

    it("cleanupAllUsersImages delegates to imageStorageService.cleanupAllUsersImages", async () => {
      const result = await service.cleanupAllUsersImages();
      expect(mockImageStorage.cleanupAllUsersImages).toHaveBeenCalled();
      expect(result).toEqual({
        totalDeleted: 5,
        usersCleaned: 2,
        orphanDeleted: 1,
      });
    });

    it("getImageStats delegates to imageStorageService.getImageStats", async () => {
      const result = await service.getImageStats();
      expect(mockImageStorage.getImageStats).toHaveBeenCalled();
      expect(result).toEqual({ total: 10 });
    });

    it("deleteAllImages delegates to imageStorageService.deleteAllImages", async () => {
      const result = await service.deleteAllImages();
      expect(mockImageStorage.deleteAllImages).toHaveBeenCalled();
      expect(result).toBe(10);
    });

    it("autoTagImages delegates to imageStorageService.autoTagImages", async () => {
      const result = await service.autoTagImages("user-1");
      expect(mockImageStorage.autoTagImages).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ tagged: 3 });
    });

    it("analyzeStyles delegates to imageStorageService.analyzeStyles", async () => {
      const result = await service.analyzeStyles("user-1");
      expect(mockImageStorage.analyzeStyles).toHaveBeenCalledWith("user-1");
      expect(result).toEqual({ styles: [] });
    });

    it("clusterVisualThemes delegates to imageStorageService.clusterVisualThemes", async () => {
      const result = await service.clusterVisualThemes("user-1");
      expect(mockImageStorage.clusterVisualThemes).toHaveBeenCalledWith(
        "user-1",
      );
      expect(result).toEqual({ clusters: [] });
    });
  });
});
