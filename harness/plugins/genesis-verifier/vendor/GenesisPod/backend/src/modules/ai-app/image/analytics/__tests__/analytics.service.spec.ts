import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AiImageAnalyticsService } from "../analytics.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("AiImageAnalyticsService", () => {
  let service: AiImageAnalyticsService;
  let mockPrisma: any;
  let mockFacade: jest.Mocked<Partial<ChatFacade>>;

  beforeEach(async () => {
    mockPrisma = {
      generatedImage: {
        findMany: jest.fn(),
      },
    };

    mockFacade = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageAnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<AiImageAnalyticsService>(AiImageAnalyticsService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== autoTagImages ====================

  describe("autoTagImages", () => {
    it("should return taggedCount=0 when no images found", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      const result = await service.autoTagImages("user-1");

      expect(result).toEqual({
        taggedCount: 0,
        message: "No images found to tag",
      });
      expect(mockFacade.chat).not.toHaveBeenCalled();
    });

    it("should auto-tag images and return tag results", async () => {
      const images = [
        {
          id: "img-1",
          prompt: "sunset over ocean",
          enhancedPrompt: null,
          imageUrl: "url1",
        },
        {
          id: "img-2",
          prompt: null,
          enhancedPrompt: "forest in winter",
          imageUrl: "url2",
        },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      const tagsResponse = {
        tags: [
          { imageId: "img-1", tags: ["nature", "sunset", "ocean"] },
          { imageId: "img-2", tags: ["nature", "winter", "forest"] },
        ],
      };
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(tagsResponse),
      });

      const result = await service.autoTagImages("user-1");

      expect(result.taggedCount).toBe(2);
      expect(result.tags).toHaveLength(2);
    });

    it("should use prompt or enhancedPrompt for image description", async () => {
      const images = [
        {
          id: "img-1",
          prompt: "mountain peak",
          enhancedPrompt: "enhanced mountain",
          imageUrl: null,
        },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      let capturedContent = "";
      (mockFacade.chat as jest.Mock).mockImplementation(({ messages }) => {
        capturedContent = messages[1].content;
        return Promise.resolve({ content: JSON.stringify({ tags: [] }) });
      });

      await service.autoTagImages("user-1");

      expect(capturedContent).toContain("[ID:img-1]");
      expect(capturedContent).toContain("mountain peak");
    });

    it("should fall back to No prompt when both prompt and enhancedPrompt are null", async () => {
      const images = [
        { id: "img-1", prompt: null, enhancedPrompt: null, imageUrl: "url1" },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      let capturedContent = "";
      (mockFacade.chat as jest.Mock).mockImplementation(({ messages }) => {
        capturedContent = messages[1].content;
        return Promise.resolve({ content: JSON.stringify({ tags: [] }) });
      });

      await service.autoTagImages("user-1");

      expect(capturedContent).toContain("No prompt");
    });

    it("should return rawResponse when LLM returns non-parseable JSON", async () => {
      const images = [
        { id: "img-1", prompt: "test", enhancedPrompt: null, imageUrl: "url1" },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "I cannot parse this as JSON",
      });

      const result = await service.autoTagImages("user-1");

      expect(result.taggedCount).toBe(0);
      expect(result.rawResponse).toBeDefined();
    });

    it("should query only bookmarked images (take 20)", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      await service.autoTagImages("user-1");

      expect(mockPrisma.generatedImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", isBookmarked: true },
          take: 20,
        }),
      );
    });

    it("should throw error when LLM call fails", async () => {
      const images = [
        { id: "img-1", prompt: "test", enhancedPrompt: null, imageUrl: "url1" },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("LLM API error"),
      );

      await expect(service.autoTagImages("user-1")).rejects.toThrow(
        "LLM API error",
      );
    });
  });

  // ==================== analyzeStyles ====================

  describe("analyzeStyles", () => {
    it("should return empty styles when no images found", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      const result = await service.analyzeStyles("user-1");

      expect(result).toEqual({
        styles: [],
        message: "No images found to analyze",
      });
    });

    it("should analyze styles and return structured result", async () => {
      const images = [
        { id: "img-1", prompt: "watercolor painting", enhancedPrompt: null },
        { id: "img-2", prompt: "oil painting landscape", enhancedPrompt: null },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      const styleResponse = {
        styles: [
          {
            name: "Watercolor",
            description: "Soft watercolor effect",
            count: 1,
            imageIds: ["img-1"],
          },
        ],
        colorPalettes: [
          { name: "Warm", colors: ["#ff6b6b"], imageIds: ["img-2"] },
        ],
      };
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(styleResponse),
      });

      const result = await service.analyzeStyles("user-1");

      expect(result.styles).toHaveLength(1);
      expect(result.colorPalettes).toHaveLength(1);
    });

    it("should return rawAnalysis when LLM returns invalid JSON", async () => {
      const images = [{ id: "img-1", prompt: "test", enhancedPrompt: null }];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "Not valid JSON response from AI",
      });

      const result = await service.analyzeStyles("user-1");

      expect(result.styles).toEqual([]);
      expect(result.rawAnalysis).toBeDefined();
    });

    it("should query up to 30 bookmarked images", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      await service.analyzeStyles("user-1");

      expect(mockPrisma.generatedImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 30,
          where: { userId: "user-1", isBookmarked: true },
        }),
      );
    });

    it("should throw when LLM call fails", async () => {
      const images = [{ id: "img-1", prompt: "test", enhancedPrompt: null }];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Style analysis error"),
      );

      await expect(service.analyzeStyles("user-1")).rejects.toThrow(
        "Style analysis error",
      );
    });
  });

  // ==================== clusterVisualThemes ====================

  describe("clusterVisualThemes", () => {
    it("should return empty clusters when fewer than 2 images", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "single image", enhancedPrompt: null },
      ]);

      const result = await service.clusterVisualThemes("user-1");

      expect(result).toEqual({
        clusters: [],
        message: "Need at least 2 images to create clusters",
      });
    });

    it("should return empty clusters when no images at all", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      const result = await service.clusterVisualThemes("user-1");

      expect(result.clusters).toEqual([]);
    });

    it("should cluster visual themes for multiple images", async () => {
      const images = [
        { id: "img-1", prompt: "beach sunset", enhancedPrompt: null },
        { id: "img-2", prompt: "mountain sunrise", enhancedPrompt: null },
        { id: "img-3", prompt: "ocean waves", enhancedPrompt: null },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      const clusterResponse = {
        clusters: [
          {
            name: "Nature",
            description: "Outdoor landscapes",
            imageIds: ["img-1", "img-2", "img-3"],
            count: 3,
          },
        ],
      };
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: JSON.stringify(clusterResponse),
      });

      const result = await service.clusterVisualThemes("user-1");

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].name).toBe("Nature");
    });

    it("should return rawAnalysis when LLM returns invalid JSON", async () => {
      const images = [
        { id: "img-1", prompt: "beach", enhancedPrompt: null },
        { id: "img-2", prompt: "mountain", enhancedPrompt: null },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "Cannot parse this",
      });

      const result = await service.clusterVisualThemes("user-1");

      expect(result.clusters).toEqual([]);
      expect(result.rawAnalysis).toBeDefined();
    });

    it("should throw when LLM call fails", async () => {
      const images = [
        { id: "img-1", prompt: "test", enhancedPrompt: null },
        { id: "img-2", prompt: "test2", enhancedPrompt: null },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);
      (mockFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Cluster error"),
      );

      await expect(service.clusterVisualThemes("user-1")).rejects.toThrow(
        "Cluster error",
      );
    });

    it("should query up to 30 bookmarked images for clustering", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      await service.clusterVisualThemes("user-1");

      expect(mockPrisma.generatedImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 30,
          where: { userId: "user-1", isBookmarked: true },
        }),
      );
    });
  });
});
