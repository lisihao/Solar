/**
 * Tests for ContentVersionService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ContentVersionService } from "../mission/services/content-version.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SocialPlatformType } from "@prisma/client";

jest.mock("@/modules/ai-harness/facade");
jest.mock("@/modules/ai-harness/facade");

describe("ContentVersionService", () => {
  let service: ContentVersionService;
  let mockPrisma: {
    socialContent: { findUnique: jest.Mock };
    socialContentVersion: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let mockAiFacade: { chat: jest.Mock };

  const contentId = "content-123";
  const userId = "user-456";

  const mockContent = {
    id: contentId,
    userId,
    title: "Test Title",
    content: "Test content with enough text here.",
    digest: "Test digest",
  };

  const mockVersion = {
    id: "version-789",
    contentId,
    platformType: SocialPlatformType.WECHAT_MP,
    title: "Adapted Title",
    content: "Adapted content",
    digest: "Adapted digest",
    isDefault: false,
    generatedBy: "AI",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      socialContent: {
        findUnique: jest.fn().mockResolvedValue(mockContent),
      },
      socialContentVersion: {
        upsert: jest.fn().mockResolvedValue(mockVersion),
        findMany: jest.fn().mockResolvedValue([mockVersion]),
        findUnique: jest.fn().mockResolvedValue(mockVersion),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockVersion),
        update: jest.fn().mockResolvedValue(mockVersion),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockAiFacade = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          title: "Adapted Title",
          content: "Adapted content for the platform",
          digest: "Adapted digest",
        }),
        isError: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentVersionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<ContentVersionService>(ContentVersionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateVersion", () => {
    it("should generate a version for WECHAT_MP", async () => {
      const result = await service.generateVersion(
        contentId,
        SocialPlatformType.WECHAT_MP,
        userId,
      );

      expect(result).toBeDefined();
      expect(result.contentId).toBe(contentId);
      expect(mockPrisma.socialContent.findUnique).toHaveBeenCalledWith({
        where: { id: contentId },
      });
      expect(mockPrisma.socialContentVersion.upsert).toHaveBeenCalled();
    });

    it("should throw NotFoundException when content not found", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);

      await expect(
        service.generateVersion(contentId, SocialPlatformType.WECHAT_MP),
      ).rejects.toThrow(NotFoundException);
    });

    it("should call AI when content needs adaptation (exceeds threshold)", async () => {
      // Create content that exceeds XIAOHONGSHU 1000 char limit by more than 20%
      const longContent = {
        ...mockContent,
        title: "Title",
        content: "A".repeat(1300), // 1300 > 1000 * 1.2 = 1200
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(longContent);

      await service.generateVersion(
        contentId,
        SocialPlatformType.XIAOHONGSHU,
        userId,
      );

      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("should truncate without AI when content is within threshold", async () => {
      // Content within XIAOHONGSHU limit (no adaptation needed)
      const shortContent = {
        ...mockContent,
        title: "Short Title",
        content: "A".repeat(900), // 900 < 1000, within limits
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(shortContent);

      await service.generateVersion(contentId, SocialPlatformType.XIAOHONGSHU);

      // No AI call needed - content fits within limits
      expect(mockAiFacade.chat).not.toHaveBeenCalled();
    });

    it("should fallback to truncation when AI fails", async () => {
      const longContent = {
        ...mockContent,
        content: "A".repeat(1300),
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(longContent);
      mockAiFacade.chat.mockResolvedValue({
        content: "short",
        isError: true,
      });

      const result = await service.generateVersion(
        contentId,
        SocialPlatformType.XIAOHONGSHU,
      );

      expect(result).toBeDefined();
    });

    it("should fallback to truncation when AI throws", async () => {
      const longContent = {
        ...mockContent,
        content: "A".repeat(1300),
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(longContent);
      mockAiFacade.chat.mockRejectedValue(new Error("AI service unavailable"));

      const result = await service.generateVersion(
        contentId,
        SocialPlatformType.XIAOHONGSHU,
      );

      expect(result).toBeDefined();
    });

    it("should include billing when userId is provided", async () => {
      const longContent = {
        ...mockContent,
        content: "A".repeat(1300),
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(longContent);

      await service.generateVersion(
        contentId,
        SocialPlatformType.XIAOHONGSHU,
        userId,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.billing).toBeDefined();
      expect(chatCall.billing.userId).toBe(userId);
    });
  });

  describe("generateAllVersions", () => {
    it("should generate versions for all platforms", async () => {
      const results = await service.generateAllVersions(contentId, userId);

      expect(results).toHaveLength(2); // WECHAT_MP and XIAOHONGSHU
    });

    it("should continue even if one platform fails", async () => {
      mockPrisma.socialContent.findUnique
        .mockResolvedValueOnce(mockContent) // First platform succeeds
        .mockResolvedValueOnce(null); // Second platform fails (content not found)

      const results = await service.generateAllVersions(contentId, userId);

      // At least one should succeed
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getVersions", () => {
    it("should return all versions for content", async () => {
      const result = await service.getVersions(contentId);

      expect(result).toHaveLength(1);
      expect(mockPrisma.socialContentVersion.findMany).toHaveBeenCalledWith({
        where: { contentId },
        orderBy: { createdAt: "asc" },
      });
    });

    it("should return empty array when no versions", async () => {
      mockPrisma.socialContentVersion.findMany.mockResolvedValue([]);

      const result = await service.getVersions(contentId);
      expect(result).toHaveLength(0);
    });
  });

  describe("getVersion", () => {
    it("should return version for specific platform", async () => {
      const result = await service.getVersion(
        contentId,
        SocialPlatformType.WECHAT_MP,
      );

      expect(result).toEqual(mockVersion);
      expect(mockPrisma.socialContentVersion.findUnique).toHaveBeenCalledWith({
        where: {
          contentId_platformType: {
            contentId,
            platformType: SocialPlatformType.WECHAT_MP,
          },
        },
      });
    });

    it("should return null when version not found", async () => {
      mockPrisma.socialContentVersion.findUnique.mockResolvedValue(null);

      const result = await service.getVersion(
        contentId,
        SocialPlatformType.WECHAT_MP,
      );
      expect(result).toBeNull();
    });
  });

  describe("getVersionForPublish", () => {
    it("should return platform-specific version when available", async () => {
      const result = await service.getVersionForPublish(
        contentId,
        SocialPlatformType.WECHAT_MP,
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe(mockVersion.title);
    });

    it("should fallback to default version when platform version not found", async () => {
      mockPrisma.socialContentVersion.findUnique.mockResolvedValue(null);
      mockPrisma.socialContentVersion.findFirst.mockResolvedValue({
        ...mockVersion,
        isDefault: true,
        title: "Default Version",
      });

      const result = await service.getVersionForPublish(
        contentId,
        SocialPlatformType.WECHAT_MP,
      );

      expect(result!.title).toBe("Default Version");
    });

    it("should return null when no version available at all", async () => {
      mockPrisma.socialContentVersion.findUnique.mockResolvedValue(null);
      mockPrisma.socialContentVersion.findFirst.mockResolvedValue(null);

      const result = await service.getVersionForPublish(
        contentId,
        SocialPlatformType.WECHAT_MP,
      );

      expect(result).toBeNull();
    });

    it("should normalize undefined digest to null", async () => {
      mockPrisma.socialContentVersion.findUnique.mockResolvedValue({
        ...mockVersion,
        digest: undefined,
      });

      const result = await service.getVersionForPublish(
        contentId,
        SocialPlatformType.WECHAT_MP,
      );

      expect(result!.digest).toBeNull();
    });
  });

  describe("updateVersion", () => {
    it("should update existing version", async () => {
      const updateData = { title: "Updated Title" };

      await service.updateVersion(
        contentId,
        SocialPlatformType.WECHAT_MP,
        updateData,
      );

      expect(mockPrisma.socialContentVersion.update).toHaveBeenCalledWith({
        where: { id: mockVersion.id },
        data: expect.objectContaining({
          title: "Updated Title",
          generatedBy: "MANUAL",
        }),
      });
    });

    it("should create version when it does not exist", async () => {
      mockPrisma.socialContentVersion.findUnique.mockResolvedValue(null);

      await service.updateVersion(contentId, SocialPlatformType.WECHAT_MP, {
        title: "New Title",
      });

      expect(mockPrisma.socialContentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentId,
          platformType: SocialPlatformType.WECHAT_MP,
          generatedBy: "MANUAL",
        }),
      });
    });

    it("should throw NotFoundException when creating and content not found", async () => {
      mockPrisma.socialContentVersion.findUnique.mockResolvedValue(null);
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);

      await expect(
        service.updateVersion(contentId, SocialPlatformType.WECHAT_MP, {
          title: "New",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should only update provided fields", async () => {
      await service.updateVersion(contentId, SocialPlatformType.WECHAT_MP, {
        content: "Only updating content",
      });

      const updateCall =
        mockPrisma.socialContentVersion.update.mock.calls[0][0];
      expect(updateCall.data.content).toBe("Only updating content");
      expect(updateCall.data.title).toBeUndefined();
    });
  });

  describe("deleteVersion", () => {
    it("should delete version for platform", async () => {
      await service.deleteVersion(contentId, SocialPlatformType.WECHAT_MP);

      expect(mockPrisma.socialContentVersion.deleteMany).toHaveBeenCalledWith({
        where: { contentId, platformType: SocialPlatformType.WECHAT_MP },
      });
    });
  });

  describe("setDefaultVersion", () => {
    it("should clear all defaults then set the new one", async () => {
      await service.setDefaultVersion(contentId, SocialPlatformType.WECHAT_MP);

      expect(mockPrisma.socialContentVersion.updateMany).toHaveBeenCalledWith({
        where: { contentId },
        data: { isDefault: false },
      });
      expect(mockPrisma.socialContentVersion.update).toHaveBeenCalledWith({
        where: {
          contentId_platformType: {
            contentId,
            platformType: SocialPlatformType.WECHAT_MP,
          },
        },
        data: { isDefault: true },
      });
    });
  });
});
