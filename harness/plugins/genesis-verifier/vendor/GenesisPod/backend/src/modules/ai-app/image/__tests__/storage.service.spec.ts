/**
 * ImageStorageService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ImageStorageService } from "../storage/storage.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";

// Mock the ObjectStorageService
const mockR2Storage = {
  isEnabled: jest.fn().mockReturnValue(false),
  uploadBase64Image: jest.fn(),
  refreshImageUrl: jest.fn(),
};

jest.mock(
  "../../../platform/storage/object-store/object-storage.service",
  () => ({
    ObjectStorageService: jest.fn().mockImplementation(() => mockR2Storage),
  }),
);

describe("ImageStorageService", () => {
  let service: ImageStorageService;

  const mockPrisma = {
    generatedImage: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const mockImageRecord = {
    id: "img-001",
    imageUrl: "https://example.com/image.png",
    prompt: "test prompt",
    enhancedPrompt: "enhanced test prompt",
    width: 1024,
    height: 1024,
    isBookmarked: false,
    visibility: "PRIVATE",
    userId: "user-001",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    textModelUsed: "gpt-4o",
    imageModelUsed: "dall-e-3",
    processingSteps: null,
    promptInsights: null,
    user: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const { ObjectStorageService } =
      await import("../../../platform/storage/object-store/object-storage.service");

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageStorageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ObjectStorageService, useValue: mockR2Storage },
      ],
    }).compile();

    service = module.get<ImageStorageService>(ImageStorageService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============ uploadImageToStorage ============

  describe("uploadImageToStorage", () => {
    it("should return URL as-is when not base64", async () => {
      const url = "https://external.cdn.com/image.png";
      const result = await service.uploadImageToStorage(url, "user-001");
      expect(result).toBe(url);
    });

    it("should return base64 as-is when R2 is not enabled", async () => {
      mockR2Storage.isEnabled.mockReturnValue(false);
      const base64 = "data:image/png;base64,abc123";
      const result = await service.uploadImageToStorage(base64, "user-001");
      expect(result).toBe(base64);
    });

    it("should upload to R2 when R2 is enabled and return R2 URL", async () => {
      mockR2Storage.isEnabled.mockReturnValue(true);
      mockR2Storage.uploadBase64Image.mockResolvedValue({
        success: true,
        url: "https://r2.example.com/uploaded.png",
      });

      const base64 = "data:image/png;base64,iVBORw0KGgo=";
      const result = await service.uploadImageToStorage(base64, "user-001");

      expect(result).toBe("https://r2.example.com/uploaded.png");
      expect(mockR2Storage.uploadBase64Image).toHaveBeenCalledWith(
        base64,
        "user/user-001",
      );
    });

    it("should fall back to base64 when R2 upload fails", async () => {
      mockR2Storage.isEnabled.mockReturnValue(true);
      mockR2Storage.uploadBase64Image.mockResolvedValue({
        success: false,
        error: "Upload failed",
      });

      const base64 = "data:image/png;base64,abc";
      const result = await service.uploadImageToStorage(base64, "user-001");
      expect(result).toBe(base64);
    });

    it("should use anonymous prefix for userId undefined", async () => {
      mockR2Storage.isEnabled.mockReturnValue(true);
      mockR2Storage.uploadBase64Image.mockResolvedValue({
        success: true,
        url: "https://r2.example.com/anon.png",
      });

      await service.uploadImageToStorage("data:image/png;base64,xyz");

      expect(mockR2Storage.uploadBase64Image).toHaveBeenCalledWith(
        expect.any(String),
        "anonymous",
      );
    });
  });

  // ============ getHistory ============

  describe("getHistory", () => {
    it("should return empty array when no userId", async () => {
      const result = await service.getHistory();
      expect(result).toEqual([]);
    });

    it("should return merged and sorted images for userId", async () => {
      const bookmarked = [
        {
          ...mockImageRecord,
          id: "img-b1",
          isBookmarked: true,
          createdAt: new Date("2026-01-02"),
        },
      ];
      const unbookmarked = [
        {
          ...mockImageRecord,
          id: "img-u1",
          isBookmarked: false,
          createdAt: new Date("2026-01-01"),
        },
      ];

      mockPrisma.generatedImage.findMany
        .mockResolvedValueOnce(bookmarked)
        .mockResolvedValueOnce(unbookmarked);

      mockR2Storage.isEnabled.mockReturnValue(false);

      const result = await service.getHistory("user-001");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("img-b1"); // more recent bookmarked first
      expect(result[1].id).toBe("img-u1");
    });

    it("should refresh expiring presigned URLs", async () => {
      // A URL that looks like an expiring B2 URL - but is already expired
      const expiringUrl =
        "https://f005.backblazeb2.com/file/bucket/img.png?X-Amz-Date=20200101T000000Z&X-Amz-Expires=604800";

      mockPrisma.generatedImage.findMany
        .mockResolvedValueOnce([
          {
            ...mockImageRecord,
            id: "img-exp",
            imageUrl: expiringUrl,
            isBookmarked: false,
          },
        ])
        .mockResolvedValueOnce([]);

      mockR2Storage.refreshImageUrl.mockResolvedValue(
        "https://f005.backblazeb2.com/file/bucket/img.png?refreshed=true",
      );
      // Mock the update to not actually run
      mockPrisma.generatedImage.update.mockResolvedValue({});

      const result = await service.getHistory("user-001");

      expect(result[0].imageUrl).toContain("refreshed=true");
    });
  });

  // ============ getImage ============

  describe("getImage", () => {
    it("should return image by id", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);

      const result = await service.getImage("img-001");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("img-001");
      expect(result!.prompt).toBe("test prompt");
    });

    it("should return null when image not found", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.getImage("not-found");

      expect(result).toBeNull();
    });
  });

  // ============ getPublicImage ============

  describe("getPublicImage", () => {
    it("should return public image with user info", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue({
        ...mockImageRecord,
        visibility: "PUBLIC",
        user: { username: "john_doe" },
      });

      const result = await service.getPublicImage("img-001");

      expect(result).not.toBeNull();
      expect(result!.userName).toBe("john_doe");
    });

    it("should return null for private image", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue({
        ...mockImageRecord,
        visibility: "PRIVATE",
      });

      const result = await service.getPublicImage("img-001");

      expect(result).toBeNull();
    });

    it("should return null when image not found", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.getPublicImage("not-found");

      expect(result).toBeNull();
    });
  });

  // ============ deleteImage ============

  describe("deleteImage", () => {
    it("should delete image owned by user", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);
      mockPrisma.generatedImage.delete.mockResolvedValue(mockImageRecord);

      const result = await service.deleteImage("img-001", "user-001");

      expect(result.success).toBe(true);
      expect(mockPrisma.generatedImage.delete).toHaveBeenCalledWith({
        where: { id: "img-001" },
      });
    });

    it("should reject deletion by different user", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);

      const result = await service.deleteImage("img-001", "different-user");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not authorized");
      expect(mockPrisma.generatedImage.delete).not.toHaveBeenCalled();
    });

    it("should return failure when image not found", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.deleteImage("not-found", "user-001");

      expect(result.success).toBe(false);
      expect(result.message).toBe("Image not found");
    });

    it("should handle errors gracefully", async () => {
      mockPrisma.generatedImage.findUnique.mockRejectedValue(
        new Error("DB Error"),
      );

      const result = await service.deleteImage("img-001", "user-001");

      expect(result.success).toBe(false);
    });

    it("should allow deletion without userId check when userId is undefined", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);
      mockPrisma.generatedImage.delete.mockResolvedValue(mockImageRecord);

      const result = await service.deleteImage("img-001");

      expect(result.success).toBe(true);
    });
  });

  // ============ getBookmarkedImages ============

  describe("getBookmarkedImages", () => {
    it("should return user bookmarked and legacy images", async () => {
      const bookmarked = [{ ...mockImageRecord, isBookmarked: true }];
      mockPrisma.generatedImage.findMany.mockResolvedValue(bookmarked);

      const result = await service.getBookmarkedImages("user-001");

      expect(result).toHaveLength(1);
      expect(result[0].isBookmarked).toBe(true);
    });

    it("should return only legacy bookmarks when no userId", async () => {
      const legacy = [{ ...mockImageRecord, userId: null, isBookmarked: true }];
      mockPrisma.generatedImage.findMany.mockResolvedValue(legacy);

      const _result = await service.getBookmarkedImages();

      expect(mockPrisma.generatedImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: null, isBookmarked: true },
        }),
      );
    });

    it("should return empty array on error", async () => {
      mockPrisma.generatedImage.findMany.mockRejectedValue(
        new Error("DB Error"),
      );

      const result = await service.getBookmarkedImages("user-001");

      expect(result).toEqual([]);
    });
  });

  // ============ addBookmark ============

  describe("addBookmark", () => {
    it("should add bookmark to owned image", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);
      mockPrisma.generatedImage.update.mockResolvedValue({
        ...mockImageRecord,
        isBookmarked: true,
      });

      const result = await service.addBookmark("img-001", "user-001");

      expect(result.success).toBe(true);
      expect(mockPrisma.generatedImage.update).toHaveBeenCalledWith({
        where: { id: "img-001" },
        data: { isBookmarked: true },
      });
    });

    it("should reject bookmarking image owned by another user", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);

      const result = await service.addBookmark("img-001", "other-user");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not authorized");
    });

    it("should return failure when image not found", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.addBookmark("not-found", "user-001");

      expect(result.success).toBe(false);
      expect(result.message).toBe("Image not found");
    });

    it("should handle errors gracefully", async () => {
      mockPrisma.generatedImage.findUnique.mockRejectedValue(
        new Error("DB Error"),
      );

      const result = await service.addBookmark("img-001", "user-001");

      expect(result.success).toBe(false);
    });
  });

  // ============ removeBookmark ============

  describe("removeBookmark", () => {
    it("should remove bookmark from owned image", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue({
        ...mockImageRecord,
        isBookmarked: true,
      });
      mockPrisma.generatedImage.update.mockResolvedValue({
        ...mockImageRecord,
        isBookmarked: false,
      });

      const result = await service.removeBookmark("img-001", "user-001");

      expect(result.success).toBe(true);
      expect(mockPrisma.generatedImage.update).toHaveBeenCalledWith({
        where: { id: "img-001" },
        data: { isBookmarked: false },
      });
    });

    it("should return failure when image not found", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.removeBookmark("not-found", "user-001");

      expect(result.success).toBe(false);
      expect(result.message).toBe("Image not found");
    });

    it("should reject removal by different user", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);

      const result = await service.removeBookmark("img-001", "different-user");

      expect(result.success).toBe(false);
    });

    it("should handle errors gracefully", async () => {
      mockPrisma.generatedImage.findUnique.mockRejectedValue(
        new Error("DB Error"),
      );

      const result = await service.removeBookmark("img-001", "user-001");

      expect(result.success).toBe(false);
    });
  });

  // ============ updateVisibility ============

  describe("updateVisibility", () => {
    it("should update image visibility to PUBLIC", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);
      mockPrisma.generatedImage.update.mockResolvedValue({
        ...mockImageRecord,
        visibility: "PUBLIC",
      });

      const result = await service.updateVisibility(
        "img-001",
        "PUBLIC",
        "user-001",
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.generatedImage.update).toHaveBeenCalledWith({
        where: { id: "img-001" },
        data: { visibility: "PUBLIC" },
      });
    });

    it("should reject update by non-owner", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(mockImageRecord);

      const result = await service.updateVisibility(
        "img-001",
        "PUBLIC",
        "other-user",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Not authorized");
    });

    it("should return failure when image not found", async () => {
      mockPrisma.generatedImage.findUnique.mockResolvedValue(null);

      const result = await service.updateVisibility(
        "not-found",
        "PUBLIC",
        "user-001",
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("Image not found");
    });

    it("should handle errors gracefully", async () => {
      mockPrisma.generatedImage.findUnique.mockRejectedValue(
        new Error("DB Error"),
      );

      const result = await service.updateVisibility(
        "img-001",
        "PUBLIC",
        "user-001",
      );

      expect(result.success).toBe(false);
    });
  });

  // ============ cleanupOldImages ============

  describe("cleanupOldImages", () => {
    it("should return 0 for null userId", async () => {
      const result = await service.cleanupOldImages(null);
      expect(result).toBe(0);
    });

    it("should delete images when count exceeds MAX_IMAGES_PER_USER", async () => {
      const manyImages = Array.from({ length: 25 }, (_, i) => ({
        id: `img-${i}`,
      }));

      mockPrisma.generatedImage.findMany.mockResolvedValue(manyImages);
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupOldImages("user-001");

      expect(result).toBe(5);
      expect(mockPrisma.generatedImage.deleteMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: manyImages.slice(20).map((img) => img.id),
          },
        },
      });
    });

    it("should not delete when count is within limit", async () => {
      const fewImages = Array.from({ length: 10 }, (_, i) => ({
        id: `img-${i}`,
      }));

      mockPrisma.generatedImage.findMany.mockResolvedValue(fewImages);

      const result = await service.cleanupOldImages("user-001");

      expect(result).toBe(0);
      expect(mockPrisma.generatedImage.deleteMany).not.toHaveBeenCalled();
    });

    it("should return 0 on error", async () => {
      mockPrisma.generatedImage.findMany.mockRejectedValue(
        new Error("DB Error"),
      );

      const result = await service.cleanupOldImages("user-001");

      expect(result).toBe(0);
    });
  });

  // ============ cleanupAllUsersImages ============

  describe("cleanupAllUsersImages", () => {
    it("should clean up images for all users and orphans", async () => {
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: "user-001" },
        { userId: "user-002" },
      ]);

      // User 001 has 25 images (over limit)
      const user001Images = Array.from({ length: 25 }, (_, i) => ({
        id: `u1-img-${i}`,
      }));
      // User 002 has 5 images (under limit)
      const user002Images = Array.from({ length: 5 }, (_, i) => ({
        id: `u2-img-${i}`,
      }));
      // Orphan images
      const orphanImages = Array.from({ length: 5 }, (_, i) => ({
        id: `orphan-${i}`,
      }));

      mockPrisma.generatedImage.findMany
        .mockResolvedValueOnce(user001Images) // user001 cleanup
        .mockResolvedValueOnce(user002Images) // user002 cleanup
        .mockResolvedValueOnce(orphanImages); // orphan cleanup

      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupAllUsersImages();

      expect(result.totalDeleted).toBe(5);
      expect(result.usersCleaned).toBe(1);
      expect(result.orphanDeleted).toBe(0); // 5 orphans < 20 limit
    });
  });

  // ============ getImageStats ============

  describe("getImageStats", () => {
    it("should return correct stats", async () => {
      mockPrisma.generatedImage.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(25); // bookmarked
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: "u1" },
        { userId: "u2" },
        { userId: "u3" },
      ]);

      const result = await service.getImageStats();

      expect(result.total).toBe(100);
      expect(result.bookmarked).toBe(25);
      expect(result.users).toBe(3);
    });
  });

  // ============ deleteAllImages ============

  describe("deleteAllImages", () => {
    it("should delete all images and return count", async () => {
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 42 });

      const result = await service.deleteAllImages();

      expect(result).toBe(42);
      expect(mockPrisma.generatedImage.deleteMany).toHaveBeenCalledWith({});
    });
  });

  // ============ autoTagImages / analyzeStyles / clusterVisualThemes ============

  describe("autoTagImages", () => {
    it("should return images for tagging", async () => {
      const images = [
        { id: "img-1", prompt: "mountain" },
        { id: "img-2", prompt: "ocean" },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      const result = await service.autoTagImages("user-001");

      expect(result).toHaveLength(2);
    });
  });

  describe("analyzeStyles", () => {
    it("should return images for style analysis", async () => {
      const images = [{ id: "img-1", enhancedPrompt: "watercolor style" }];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      const result = await service.analyzeStyles("user-001");

      expect(result).toHaveLength(1);
    });
  });

  describe("clusterVisualThemes", () => {
    it("should return images for theme clustering", async () => {
      const images = [
        { id: "img-1", imageUrl: "https://example.com/1.png" },
        { id: "img-2", imageUrl: "https://example.com/2.png" },
      ];
      mockPrisma.generatedImage.findMany.mockResolvedValue(images);

      const result = await service.clusterVisualThemes("user-001");

      expect(result).toHaveLength(2);
    });
  });
});
