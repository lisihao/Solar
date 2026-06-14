import { Test, TestingModule } from "@nestjs/testing";
import { ImageStorageService } from "../storage.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ObjectStorageService } from "../../../../platform/storage/object-store/object-storage.service";

describe("ImageStorageService", () => {
  let service: ImageStorageService;
  let prismaService: any;
  let r2StorageService: any;

  const mockImage = {
    id: "img-123",
    imageUrl: "https://r2.cloudflarestorage.com/img/test.png",
    prompt: "A beautiful landscape",
    enhancedPrompt: "A beautiful mountain landscape with snow",
    width: 512,
    height: 512,
    isBookmarked: false,
    visibility: "PRIVATE",
    userId: "user-123",
    textModelUsed: "gpt-4o",
    imageModelUsed: "dall-e-3",
    processingSteps: null,
    promptInsights: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      generatedImage: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
    };

    const mockR2StorageService = {
      isEnabled: jest.fn().mockReturnValue(false),
      uploadBase64Image: jest.fn(),
      refreshImageUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageStorageService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ObjectStorageService, useValue: mockR2StorageService },
      ],
    }).compile();

    service = module.get<ImageStorageService>(ImageStorageService);
    prismaService = module.get(PrismaService);
    r2StorageService = module.get(ObjectStorageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== uploadImageToStorage ====================

  describe("uploadImageToStorage", () => {
    it("should return the URL directly if not base64 format", async () => {
      const url = "https://example.com/image.png";
      const result = await service.uploadImageToStorage(url);

      expect(result).toBe(url);
      expect(r2StorageService.uploadBase64Image).not.toHaveBeenCalled();
    });

    it("should return base64 as-is when R2 is not enabled", async () => {
      r2StorageService.isEnabled.mockReturnValue(false);
      const base64 = "data:image/png;base64,iVBORw0KGgo=";

      const result = await service.uploadImageToStorage(base64, "user-123");

      expect(result).toBe(base64);
    });

    it("should upload to R2 when R2 is enabled and upload succeeds", async () => {
      r2StorageService.isEnabled.mockReturnValue(true);
      r2StorageService.uploadBase64Image.mockResolvedValue({
        success: true,
        url: "https://r2.cloudflarestorage.com/user/user-123/img.png",
      });

      const base64 = "data:image/png;base64,iVBORw0KGgo=";
      const result = await service.uploadImageToStorage(base64, "user-123");

      expect(result).toBe(
        "https://r2.cloudflarestorage.com/user/user-123/img.png",
      );
      expect(r2StorageService.uploadBase64Image).toHaveBeenCalledWith(
        base64,
        "user/user-123",
      );
    });

    it("should fall back to base64 when R2 upload fails", async () => {
      r2StorageService.isEnabled.mockReturnValue(true);
      r2StorageService.uploadBase64Image.mockResolvedValue({
        success: false,
        error: "Upload failed",
      });

      const base64 = "data:image/png;base64,iVBORw0KGgo=";
      const result = await service.uploadImageToStorage(base64, "user-123");

      expect(result).toBe(base64);
    });

    it("should use 'anonymous' prefix when no userId provided", async () => {
      r2StorageService.isEnabled.mockReturnValue(true);
      r2StorageService.uploadBase64Image.mockResolvedValue({
        success: true,
        url: "https://r2.cloudflarestorage.com/anonymous/img.png",
      });

      const base64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgAB";
      await service.uploadImageToStorage(base64);

      expect(r2StorageService.uploadBase64Image).toHaveBeenCalledWith(
        base64,
        "anonymous",
      );
    });
  });

  // ==================== getHistory ====================

  describe("getHistory", () => {
    it("should return empty array when userId is not provided", async () => {
      const result = await service.getHistory();

      expect(result).toEqual([]);
      expect(prismaService.generatedImage.findMany).not.toHaveBeenCalled();
    });

    it("should return merged bookmarked and unbookmarked images for a user", async () => {
      const bookmarked = [
        { ...mockImage, id: "img-bookmarked", isBookmarked: true },
      ];
      const unbookmarked = [{ ...mockImage, id: "img-unbookmarked" }];

      prismaService.generatedImage.findMany
        .mockResolvedValueOnce(bookmarked)
        .mockResolvedValueOnce(unbookmarked);

      const result = await service.getHistory("user-123");

      expect(result).toHaveLength(2);
      expect(prismaService.generatedImage.findMany).toHaveBeenCalledTimes(2);
    });

    it("should sort combined images by createdAt descending", async () => {
      const olderImage = {
        ...mockImage,
        id: "img-old",
        isBookmarked: true,
        createdAt: new Date("2025-01-01"),
      };
      const newerImage = {
        ...mockImage,
        id: "img-new",
        isBookmarked: false,
        createdAt: new Date("2026-01-01"),
      };

      prismaService.generatedImage.findMany
        .mockResolvedValueOnce([olderImage])
        .mockResolvedValueOnce([newerImage]);

      const result = await service.getHistory("user-123");

      expect(result[0].id).toBe("img-new");
      expect(result[1].id).toBe("img-old");
    });

    it("should refresh presigned URLs that are expiring soon", async () => {
      // Presigned URL with past expiration
      const expiredUrl =
        "https://r2.cloudflarestorage.com/img.png?X-Amz-Date=20250101T000000Z&X-Amz-Expires=3600";
      const imageWithExpiredUrl = {
        ...mockImage,
        imageUrl: expiredUrl,
        isBookmarked: false,
      };

      prismaService.generatedImage.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([imageWithExpiredUrl]);

      r2StorageService.refreshImageUrl.mockResolvedValue(
        "https://r2.cloudflarestorage.com/img.png?X-Amz-Date=20260201T000000Z&X-Amz-Expires=86400",
      );
      prismaService.generatedImage.update.mockResolvedValue(
        imageWithExpiredUrl,
      );

      await service.getHistory("user-123");

      expect(r2StorageService.refreshImageUrl).toHaveBeenCalledWith(expiredUrl);
    });

    it("should limit unbookmarked images to 20", async () => {
      prismaService.generatedImage.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.getHistory("user-123");

      // Second call (unbookmarked) should have take: 20
      expect(prismaService.generatedImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it("should map image fields to GeneratedImageResult shape", async () => {
      const regularUrl = "https://example.com/image.png";
      const plainImage = { ...mockImage, imageUrl: regularUrl };
      prismaService.generatedImage.findMany
        .mockResolvedValueOnce([plainImage])
        .mockResolvedValueOnce([]);

      const result = await service.getHistory("user-123");

      expect(result[0]).toMatchObject({
        id: "img-123",
        imageUrl: regularUrl,
        prompt: "A beautiful landscape",
        width: 512,
        height: 512,
        isBookmarked: false,
      });
      expect(result[0].createdAt).toEqual(expect.any(String));
    });
  });

  // ==================== getImage ====================

  describe("getImage", () => {
    it("should return a single image by id", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(mockImage);

      const result = await service.getImage("img-123");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("img-123");
      expect(result!.prompt).toBe("A beautiful landscape");
    });

    it("should return null when image is not found", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.getImage("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ==================== getPublicImage ====================

  describe("getPublicImage", () => {
    it("should return public image with user info", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue({
        ...mockImage,
        visibility: "PUBLIC",
        user: { username: "testuser" },
      });

      const result = await service.getPublicImage("img-123");

      expect(result).not.toBeNull();
      expect(result!.userName).toBe("testuser");
    });

    it("should return null for private images", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue({
        ...mockImage,
        visibility: "PRIVATE",
        user: { username: "testuser" },
      });

      const result = await service.getPublicImage("img-123");

      expect(result).toBeNull();
    });

    it("should return null when image does not exist", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.getPublicImage("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ==================== deleteImage ====================

  describe("deleteImage", () => {
    it("should delete an image successfully", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(mockImage);
      prismaService.generatedImage.delete.mockResolvedValue(mockImage);

      const result = await service.deleteImage("img-123", "user-123");

      expect(result).toEqual({
        success: true,
        message: "Image deleted successfully",
      });
    });

    it("should return failure when image not found", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.deleteImage("nonexistent", "user-123");

      expect(result.success).toBe(false);
      expect(result.message).toBe("Image not found");
    });

    it("should return failure when user does not own the image", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue({
        ...mockImage,
        userId: "other-user",
      });

      const result = await service.deleteImage("img-123", "user-123");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not authorized");
    });

    it("should allow deletion without userId (admin)", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(mockImage);
      prismaService.generatedImage.delete.mockResolvedValue(mockImage);

      const result = await service.deleteImage("img-123");

      expect(result.success).toBe(true);
    });
  });

  // ==================== addBookmark / removeBookmark ====================

  describe("addBookmark", () => {
    it("should bookmark an image", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(mockImage);
      prismaService.generatedImage.update.mockResolvedValue({
        ...mockImage,
        isBookmarked: true,
      });

      const result = await service.addBookmark("img-123", "user-123");

      expect(result.success).toBe(true);
      expect(prismaService.generatedImage.update).toHaveBeenCalledWith({
        where: { id: "img-123" },
        data: { isBookmarked: true },
      });
    });

    it("should return failure when image not found", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.addBookmark("nonexistent", "user-123");

      expect(result.success).toBe(false);
    });

    it("should return failure when user does not own the image", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue({
        ...mockImage,
        userId: "other-user",
      });

      const result = await service.addBookmark("img-123", "user-123");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not authorized");
    });
  });

  describe("removeBookmark", () => {
    it("should remove bookmark from an image", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue({
        ...mockImage,
        isBookmarked: true,
      });
      prismaService.generatedImage.update.mockResolvedValue(mockImage);

      const result = await service.removeBookmark("img-123", "user-123");

      expect(result.success).toBe(true);
      expect(prismaService.generatedImage.update).toHaveBeenCalledWith({
        where: { id: "img-123" },
        data: { isBookmarked: false },
      });
    });

    it("should return failure when image not found", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.removeBookmark("nonexistent");

      expect(result.success).toBe(false);
    });
  });

  // ==================== updateVisibility ====================

  describe("updateVisibility", () => {
    it("should update image visibility to PUBLIC", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(mockImage);
      prismaService.generatedImage.update.mockResolvedValue({
        ...mockImage,
        visibility: "PUBLIC",
      });

      const result = await service.updateVisibility(
        "img-123",
        "PUBLIC",
        "user-123",
      );

      expect(result.success).toBe(true);
      expect(prismaService.generatedImage.update).toHaveBeenCalledWith({
        where: { id: "img-123" },
        data: { visibility: "PUBLIC" },
      });
    });

    it("should return failure when user is not the owner", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue({
        ...mockImage,
        userId: "other-user",
      });

      const result = await service.updateVisibility(
        "img-123",
        "PUBLIC",
        "user-123",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not authorized");
    });

    it("should return failure when image not found", async () => {
      prismaService.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.updateVisibility(
        "nonexistent",
        "PUBLIC",
        "user-123",
      );

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldImages ====================

  describe("cleanupOldImages", () => {
    it("should return 0 when userId is null", async () => {
      const result = await service.cleanupOldImages(null);

      expect(result).toBe(0);
      expect(prismaService.generatedImage.findMany).not.toHaveBeenCalled();
    });

    it("should delete images beyond the 20-image limit", async () => {
      const manyImages = Array.from({ length: 25 }, (_, i) => ({
        id: `img-${i}`,
      }));
      prismaService.generatedImage.findMany.mockResolvedValue(manyImages);
      prismaService.generatedImage.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupOldImages("user-123");

      expect(result).toBe(5);
      expect(prismaService.generatedImage.deleteMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: manyImages.slice(20).map((img) => img.id),
          },
        },
      });
    });

    it("should return 0 when images are within the limit", async () => {
      const fewImages = Array.from({ length: 10 }, (_, i) => ({
        id: `img-${i}`,
      }));
      prismaService.generatedImage.findMany.mockResolvedValue(fewImages);

      const result = await service.cleanupOldImages("user-123");

      expect(result).toBe(0);
      expect(prismaService.generatedImage.deleteMany).not.toHaveBeenCalled();
    });

    it("should return 0 and not throw on database error", async () => {
      prismaService.generatedImage.findMany.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupOldImages("user-123");

      expect(result).toBe(0);
    });
  });

  // ==================== cleanupAllUsersImages ====================

  describe("cleanupAllUsersImages", () => {
    it("should clean up images for all users and orphans", async () => {
      prismaService.generatedImage.groupBy.mockResolvedValue([
        { userId: "user-1" },
        { userId: "user-2" },
      ]);

      // cleanupOldImages for each user - they have 5 images each (within limit)
      prismaService.generatedImage.findMany
        .mockResolvedValueOnce(
          Array.from({ length: 5 }, (_, i) => ({ id: `u1-img-${i}` })),
        )
        .mockResolvedValueOnce(
          Array.from({ length: 5 }, (_, i) => ({ id: `u2-img-${i}` })),
        )
        .mockResolvedValueOnce([]); // orphan images

      const result = await service.cleanupAllUsersImages();

      expect(result).toEqual({
        totalDeleted: 0,
        usersCleaned: 0,
        orphanDeleted: 0,
      });
    });

    it("should report correct counts when images are deleted", async () => {
      prismaService.generatedImage.groupBy.mockResolvedValue([
        { userId: "user-1" },
      ]);

      // user-1 has 25 images (5 to delete)
      prismaService.generatedImage.findMany
        .mockResolvedValueOnce(
          Array.from({ length: 25 }, (_, i) => ({ id: `img-${i}` })),
        )
        .mockResolvedValueOnce([]); // no orphans

      prismaService.generatedImage.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupAllUsersImages();

      expect(result.totalDeleted).toBe(5);
      expect(result.usersCleaned).toBe(1);
    });
  });

  // ==================== getImageStats ====================

  describe("getImageStats", () => {
    it("should return image statistics", async () => {
      prismaService.generatedImage.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(25);
      prismaService.generatedImage.groupBy.mockResolvedValue([
        { userId: "user-1" },
        { userId: "user-2" },
        { userId: "user-3" },
      ]);

      const result = await service.getImageStats();

      expect(result).toEqual({
        total: 100,
        bookmarked: 25,
        users: 3,
      });
    });
  });

  // ==================== deleteAllImages ====================

  describe("deleteAllImages", () => {
    it("should delete all images and return count", async () => {
      prismaService.generatedImage.deleteMany.mockResolvedValue({ count: 42 });

      const result = await service.deleteAllImages();

      expect(result).toBe(42);
      expect(prismaService.generatedImage.deleteMany).toHaveBeenCalledWith({});
    });
  });

  // ==================== autoTagImages / analyzeStyles / clusterVisualThemes ====================

  describe("autoTagImages", () => {
    it("should return images for auto-tagging", async () => {
      prismaService.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", prompt: "a cat" },
      ]);

      const result = await service.autoTagImages("user-123");

      expect(result).toHaveLength(1);
      expect(prismaService.generatedImage.findMany).toHaveBeenCalledWith({
        where: { userId: "user-123" },
        select: { id: true, prompt: true },
        take: 100,
      });
    });
  });

  describe("analyzeStyles", () => {
    it("should return images for style analysis", async () => {
      prismaService.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", enhancedPrompt: "vivid, detailed" },
      ]);

      const result = await service.analyzeStyles("user-123");

      expect(result).toHaveLength(1);
      expect(prismaService.generatedImage.findMany).toHaveBeenCalledWith({
        where: { userId: "user-123" },
        select: { id: true, enhancedPrompt: true },
        take: 100,
      });
    });
  });

  describe("clusterVisualThemes", () => {
    it("should return images for theme clustering", async () => {
      prismaService.generatedImage.findMany.mockResolvedValue([
        { id: "img-1", imageUrl: "https://example.com/img.png" },
      ]);

      const result = await service.clusterVisualThemes("user-123");

      expect(result).toHaveLength(1);
      expect(prismaService.generatedImage.findMany).toHaveBeenCalledWith({
        where: { userId: "user-123" },
        select: { id: true, imageUrl: true },
        take: 100,
      });
    });
  });
});
