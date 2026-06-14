/**
 * AiImageAnalyticsService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AiImageAnalyticsService } from "../analytics/analytics.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("AiImageAnalyticsService", () => {
  let service: AiImageAnalyticsService;

  const mockFacade = {
    chat: jest.fn(),
  };

  const mockPrisma = {
    generatedImage: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiImageAnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<AiImageAnalyticsService>(AiImageAnalyticsService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============ autoTagImages ============

  describe("autoTagImages", () => {
    it("should return no-images message when no bookmarked images found", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      const result = await service.autoTagImages("user-001");

      expect(result.taggedCount).toBe(0);
      expect(result.message).toContain("No images found");
    });

    it("should tag images using AI and parse JSON response", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        {
          id: "img-1",
          prompt: "A mountain at sunset",
          enhancedPrompt: null,
          imageUrl: "https://example.com/1.png",
        },
        {
          id: "img-2",
          prompt: "Ocean waves",
          enhancedPrompt: null,
          imageUrl: "https://example.com/2.png",
        },
      ]);

      const aiResponse = JSON.stringify({
        tags: [
          { imageId: "img-1", tags: ["landscape", "mountain", "nature"] },
          { imageId: "img-2", tags: ["ocean", "water", "waves"] },
        ],
      });
      mockFacade.chat.mockResolvedValue({
        content: aiResponse,
        tokensUsed: 120,
      });

      const result = await service.autoTagImages("user-001");

      expect(result.taggedCount).toBe(2);
      expect(result.tags).toHaveLength(2);
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("should use enhancedPrompt when prompt is null", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        {
          id: "img-1",
          prompt: null,
          enhancedPrompt: "Enhanced ocean description",
          imageUrl: "https://example.com/1.png",
        },
      ]);

      mockFacade.chat.mockResolvedValue({
        content: '{"tags": [{"imageId": "img-1", "tags": ["ocean"]}]}',
        tokensUsed: 50,
      });

      const result = await service.autoTagImages("user-001");

      expect(result.taggedCount).toBe(1);
      // Verify the content sent to AI contains the enhanced prompt
      const chatCall = mockFacade.chat.mock.calls[0][0];
      const userMessage = chatCall.messages.find(
        (m: { role: string }) => m.role === "user",
      );
      expect(userMessage.content).toContain("Enhanced ocean description");
    });

    it("should return rawResponse when AI returns non-JSON", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "test", enhancedPrompt: null, imageUrl: "" },
      ]);

      mockFacade.chat.mockResolvedValue({
        content: "not json at all",
        tokensUsed: 10,
      });

      const result = await service.autoTagImages("user-001");

      expect(result.taggedCount).toBe(0);
      expect(result.rawResponse).toBe("not json at all");
    });

    it("should throw errors from AI service", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "test", enhancedPrompt: null, imageUrl: "" },
      ]);

      mockFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

      await expect(service.autoTagImages("user-001")).rejects.toThrow(
        "AI service unavailable",
      );
    });
  });

  // ============ analyzeStyles ============

  describe("analyzeStyles", () => {
    it("should return no-images message when no bookmarked images found", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      const result = await service.analyzeStyles("user-001");

      expect(result.styles).toEqual([]);
      expect(result.message).toContain("No images found");
    });

    it("should analyze styles using AI and parse JSON response", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        {
          id: "img-1",
          prompt: "watercolor painting of mountains",
          enhancedPrompt: null,
        },
        {
          id: "img-2",
          prompt: "photo realistic city",
          enhancedPrompt: null,
        },
      ]);

      const aiResponse = JSON.stringify({
        styles: [
          {
            name: "Watercolor",
            description: "Soft, flowing colors",
            count: 1,
            imageIds: ["img-1"],
          },
          {
            name: "Photorealistic",
            description: "High detail",
            count: 1,
            imageIds: ["img-2"],
          },
        ],
        colorPalettes: [],
      });
      mockFacade.chat.mockResolvedValue({
        content: aiResponse,
        tokensUsed: 150,
      });

      const result = await service.analyzeStyles("user-001");

      expect(result.styles).toHaveLength(2);
      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("should return rawAnalysis when AI returns non-JSON", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "test", enhancedPrompt: null },
      ]);

      mockFacade.chat.mockResolvedValue({
        content: "analysis in plain text form",
        tokensUsed: 40,
      });

      const result = await service.analyzeStyles("user-001");

      expect(result.styles).toEqual([]);
      expect(result.rawAnalysis).toBe("analysis in plain text form");
    });

    it("should throw errors from AI service", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "test", enhancedPrompt: null },
      ]);

      mockFacade.chat.mockRejectedValue(new Error("Connection timeout"));

      await expect(service.analyzeStyles("user-001")).rejects.toThrow(
        "Connection timeout",
      );
    });
  });

  // ============ clusterVisualThemes ============

  describe("clusterVisualThemes", () => {
    it("should return message when fewer than 2 images", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "single image", enhancedPrompt: null },
      ]);

      const result = await service.clusterVisualThemes("user-001");

      expect(result.clusters).toEqual([]);
      expect(result.message).toContain("at least 2 images");
    });

    it("should return message when no images", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([]);

      const result = await service.clusterVisualThemes("user-001");

      expect(result.clusters).toEqual([]);
      expect(result.message).toContain("at least 2 images");
    });

    it("should cluster themes using AI when 2+ images available", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "mountain landscape", enhancedPrompt: null },
        { id: "img-2", prompt: "ocean seascape", enhancedPrompt: null },
        { id: "img-3", prompt: "forest trees", enhancedPrompt: null },
      ]);

      const aiResponse = JSON.stringify({
        clusters: [
          {
            name: "Nature",
            description: "Outdoor natural scenes",
            imageIds: ["img-1", "img-2", "img-3"],
            count: 3,
          },
        ],
      });
      mockFacade.chat.mockResolvedValue({
        content: aiResponse,
        tokensUsed: 100,
      });

      const result = await service.clusterVisualThemes("user-001");

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0].name).toBe("Nature");
    });

    it("should return rawAnalysis when AI returns non-JSON", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "test 1", enhancedPrompt: null },
        { id: "img-2", prompt: "test 2", enhancedPrompt: null },
      ]);

      mockFacade.chat.mockResolvedValue({
        content: "plain text cluster analysis",
        tokensUsed: 30,
      });

      const result = await service.clusterVisualThemes("user-001");

      expect(result.clusters).toEqual([]);
      expect(result.rawAnalysis).toBe("plain text cluster analysis");
    });

    it("should throw errors from AI service", async () => {
      mockPrisma.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "test 1", enhancedPrompt: null },
        { id: "img-2", prompt: "test 2", enhancedPrompt: null },
      ]);

      mockFacade.chat.mockRejectedValue(new Error("Rate limit exceeded"));

      await expect(service.clusterVisualThemes("user-001")).rejects.toThrow(
        "Rate limit exceeded",
      );
    });
  });
});
