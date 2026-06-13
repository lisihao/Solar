/**
 * AI Image Service 测试
 * 测试图片生成、标签、风格分析和主题聚类功能
 */

// Mock content-processing module to avoid pdfjs-dist ESM import issues
jest.mock("../../../../common/content-processing", () => ({
  ContentExtractorService: jest.fn().mockImplementation(() => ({
    extract: jest.fn(),
  })),
  DataFetchingService: jest.fn().mockImplementation(() => ({
    fetch: jest.fn(),
  })),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { AiImageService } from "../generation/generation.service";
import { InfographicTemplateService } from "../infographic/infographic.service";
import { PromptEnhancementService } from "../generation/prompt-enhancement.service";
import { ImageGenerationService } from "../generation/image-generation.service";
import { ImageStorageService } from "../storage/storage.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
// 直接从具体文件导入，避免通过 barrel export 引发循环依赖
import { ContentExtractorService } from "../../../../common/content-processing/content-extractor.service";
import { DataFetchingService } from "../../../../common/content-processing/data-fetching.service";
import { Imagen4PromptService } from "../generation/imagen4-prompt.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("AiImageService", () => {
  let service: AiImageService;

  const mockPrisma = {
    generatedImage: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    aIModel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockContentExtractor = {
    extract: jest.fn(),
  };

  const mockDataFetching = {
    fetch: jest.fn(),
  };

  const mockInfographicTemplate = {
    getTemplates: jest.fn(),
    getTemplate: jest.fn(),
    generateInfographic: jest.fn(),
  };

  const mockPromptEnhancement = {
    enhancePrompt: jest.fn(),
    generateStylePrompt: jest.fn(),
  };

  const mockImageGeneration = {
    generateImage: jest.fn(),
    generateImageVariation: jest.fn(),
  };

  const mockImageStorage = {
    saveImage: jest.fn(),
    getImage: jest.fn().mockResolvedValue(null),
    deleteImage: jest
      .fn()
      .mockResolvedValue({ success: true, message: "Deleted" }),
    getHistory: jest.fn().mockResolvedValue([]),
    getBookmarkedImages: jest.fn().mockResolvedValue([]),
    addBookmark: jest
      .fn()
      .mockResolvedValue({ success: true, message: "Bookmarked" }),
    removeBookmark: jest
      .fn()
      .mockResolvedValue({ success: true, message: "Removed" }),
    cleanupOldImages: jest.fn().mockResolvedValue(0),
    getImageStats: jest
      .fn()
      .mockResolvedValue({ totalImages: 0, totalBookmarks: 0 }),
  };

  const mockImagen4Prompt = {
    enhancePrompt: jest.fn(),
    generateCollaborativePrompt: jest.fn(),
  };

  const mockAIFacade = {
    chat: jest.fn(),
    getAvailableModels: jest.fn().mockResolvedValue([]),
    getModelConfig: jest.fn(),
  };

  beforeEach(async () => {
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getAvailableModels", () => {
    it("should return available image models", async () => {
      mockPrisma.aIModel.findMany.mockResolvedValue([
        {
          id: "1",
          displayName: "DALL-E 3",
          modelId: "dall-e-3",
          type: "IMAGE",
          enabled: true,
        },
      ]);

      const result = await service.getAvailableModels();

      expect(result).toBeDefined();
      expect(result.imageModels).toBeDefined();
    });

    it("should return empty array when no models available", async () => {
      mockPrisma.aIModel.findMany.mockResolvedValue([]);

      const result = await service.getAvailableModels();

      expect(result).toBeDefined();
      expect(result.imageModels).toEqual([]);
    });
  });

  describe("getHistory", () => {
    it("should return user image history", async () => {
      const mockImages = [
        {
          id: "img-1",
          imageUrl: "https://example.com/1.png",
          prompt: "prompt 1",
          createdAt: new Date(),
        },
        {
          id: "img-2",
          imageUrl: "https://example.com/2.png",
          prompt: "prompt 2",
          createdAt: new Date(),
        },
      ];
      mockImageStorage.getHistory.mockResolvedValue(mockImages);

      const result = await service.getHistory("user-123");

      expect(mockImageStorage.getHistory).toHaveBeenCalledWith("user-123");
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it("should return empty array for user with no images", async () => {
      mockImageStorage.getHistory.mockResolvedValue([]);

      const result = await service.getHistory("user-no-images");

      expect(result).toEqual([]);
    });
  });

  describe("getImage", () => {
    it("should return image by id", async () => {
      const mockImage = {
        id: "img-123",
        imageUrl: "https://example.com/image.png",
        prompt: "test prompt",
        createdAt: new Date(),
      };
      mockImageStorage.getImage.mockResolvedValue(mockImage);

      const result = await service.getImage("img-123");

      expect(mockImageStorage.getImage).toHaveBeenCalledWith("img-123");
      expect(result).toBeDefined();
      expect(result?.id).toBe("img-123");
    });

    it("should return null for non-existent image", async () => {
      mockImageStorage.getImage.mockResolvedValue(null);

      const result = await service.getImage("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("deleteImage", () => {
    it("should delete image owned by user", async () => {
      mockImageStorage.deleteImage.mockResolvedValue({
        success: true,
        message: "Deleted successfully",
      });

      const result = await service.deleteImage("img-123", "user-123");

      expect(mockImageStorage.deleteImage).toHaveBeenCalledWith(
        "img-123",
        "user-123",
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it("should not delete image owned by another user", async () => {
      mockImageStorage.deleteImage.mockResolvedValue({
        success: false,
        message: "Not authorized to delete this image",
      });

      const result = await service.deleteImage("img-123", "different-user");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not authorized");
    });
  });

  describe("getBookmarkedImages", () => {
    it("should return bookmarked images for user", async () => {
      const mockImages = [
        {
          id: "img-1",
          imageUrl: "https://example.com/1.png",
          isBookmarked: true,
        },
      ];
      mockImageStorage.getBookmarkedImages.mockResolvedValue(mockImages);

      const result = await service.getBookmarkedImages("user-123");

      expect(mockImageStorage.getBookmarkedImages).toHaveBeenCalledWith(
        "user-123",
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("addBookmark", () => {
    it("should add bookmark to image", async () => {
      mockImageStorage.addBookmark.mockResolvedValue({
        success: true,
        message: "Bookmarked successfully",
      });

      const result = await service.addBookmark("img-123", "user-123");

      expect(mockImageStorage.addBookmark).toHaveBeenCalledWith(
        "img-123",
        "user-123",
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe("removeBookmark", () => {
    it("should remove bookmark from image", async () => {
      mockImageStorage.removeBookmark.mockResolvedValue({
        success: true,
        message: "Bookmark removed successfully",
      });

      const result = await service.removeBookmark("img-123", "user-123");

      expect(mockImageStorage.removeBookmark).toHaveBeenCalledWith(
        "img-123",
        "user-123",
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe("cleanupOldImages", () => {
    it("should cleanup old unbookmarked images", async () => {
      mockImageStorage.cleanupOldImages.mockResolvedValue(2);

      const result = await service.cleanupOldImages("user-123");

      expect(mockImageStorage.cleanupOldImages).toHaveBeenCalledWith(
        "user-123",
      );
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getImageStats", () => {
    it("should return image statistics", async () => {
      const mockStats = {
        total: 100,
        bookmarked: 25,
        users: 10,
      };
      mockImageStorage.getImageStats.mockResolvedValue(mockStats);

      const result = await service.getImageStats();

      expect(mockImageStorage.getImageStats).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.total).toBe(100);
    });
  });
});
