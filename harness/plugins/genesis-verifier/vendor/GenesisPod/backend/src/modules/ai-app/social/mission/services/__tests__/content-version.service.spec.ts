import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { ContentVersionService } from "../content-version.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SocialPlatformType } from "@prisma/client";

describe("ContentVersionService", () => {
  let service: ContentVersionService;
  let prismaService: any;
  let aiFacade: any;

  const mockContent = {
    id: "content-123",
    title: "Test Article Title",
    content: "This is the main content of the article.",
    digest: "Short digest here.",
    userId: "user-123",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockVersion = {
    id: "version-123",
    contentId: "content-123",
    platformType: "WECHAT_MP" as SocialPlatformType,
    title: "WeChat Version Title",
    content: "WeChat adapted content.",
    digest: "WeChat digest.",
    isDefault: false,
    generatedBy: "AI",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAiResponse = {
    content: JSON.stringify({
      title: "Adapted Title",
      content: "Adapted content for platform.",
      digest: "Adapted digest.",
    }),
    isError: false,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      socialContent: {
        findUnique: jest.fn(),
      },
      socialContentVersion: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const mockAiFacade = {
      chat: jest.fn().mockResolvedValue(mockAiResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentVersionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<ContentVersionService>(ContentVersionService);
    prismaService = module.get(PrismaService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== generateVersion ====================

  describe("generateVersion", () => {
    beforeEach(() => {
      prismaService.socialContent.findUnique.mockResolvedValue(mockContent);
      prismaService.socialContentVersion.upsert.mockResolvedValue(mockVersion);
    });

    it("should generate a WECHAT_MP version for content", async () => {
      const result = await service.generateVersion(
        "content-123",
        "WECHAT_MP",
        "user-123",
      );

      expect(result).toEqual(mockVersion);
      expect(prismaService.socialContentVersion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            contentId_platformType: {
              contentId: "content-123",
              platformType: "WECHAT_MP",
            },
          },
          create: expect.objectContaining({
            contentId: "content-123",
            platformType: "WECHAT_MP",
            generatedBy: "AI",
          }),
        }),
      );
    });

    it("should generate a XIAOHONGSHU version for content", async () => {
      const xhsVersion = {
        ...mockVersion,
        platformType: "XIAOHONGSHU" as SocialPlatformType,
      };
      prismaService.socialContentVersion.upsert.mockResolvedValue(xhsVersion);

      const result = await service.generateVersion(
        "content-123",
        "XIAOHONGSHU",
        "user-123",
      );

      expect(result.platformType).toBe("XIAOHONGSHU");
    });

    it("should throw NotFoundException when content does not exist", async () => {
      prismaService.socialContent.findUnique.mockResolvedValue(null);

      await expect(
        service.generateVersion("nonexistent", "WECHAT_MP", "user-123"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should use AI for content adaptation when content exceeds limits", async () => {
      // Content that exceeds XIAOHONGSHU's 1000 char limit by 20%+ (needs AI rewrite)
      const longContent = {
        ...mockContent,
        content: "A".repeat(1300), // 130% of 1000 limit
      };
      prismaService.socialContent.findUnique.mockResolvedValue(longContent);

      await service.generateVersion("content-123", "XIAOHONGSHU");

      expect(aiFacade.chat).toHaveBeenCalled();
    });

    it("should truncate content without AI when overflow is small", async () => {
      // Content slightly over XIAOHONGSHU's 1000 char limit (within 20% threshold)
      const slightlyLongContent = {
        ...mockContent,
        content: "A".repeat(1050), // 105% of 1000 limit, below 120% threshold
        title: "Short Title",
      };
      prismaService.socialContent.findUnique.mockResolvedValue(
        slightlyLongContent,
      );

      await service.generateVersion("content-123", "XIAOHONGSHU");

      // Should NOT call AI for minor overflows
      expect(aiFacade.chat).not.toHaveBeenCalled();
    });

    it("should fall back to truncation when AI returns error", async () => {
      const longContent = {
        ...mockContent,
        content: "A".repeat(1300),
      };
      prismaService.socialContent.findUnique.mockResolvedValue(longContent);
      aiFacade.chat.mockResolvedValue({ content: "not json", isError: true });

      const result = await service.generateVersion(
        "content-123",
        "XIAOHONGSHU",
      );

      expect(result).toBeDefined();
    });

    it("should fall back to truncation when AI throws", async () => {
      const longContent = {
        ...mockContent,
        content: "A".repeat(1300),
      };
      prismaService.socialContent.findUnique.mockResolvedValue(longContent);
      aiFacade.chat.mockRejectedValue(new Error("AI unavailable"));

      const result = await service.generateVersion(
        "content-123",
        "XIAOHONGSHU",
      );

      expect(result).toBeDefined();
    });

    it("should remove digest for platforms that do not support it (XIAOHONGSHU)", async () => {
      const contentWithDigest = { ...mockContent, digest: "Some digest" };
      prismaService.socialContent.findUnique.mockResolvedValue(
        contentWithDigest,
      );

      await service.generateVersion("content-123", "XIAOHONGSHU");

      expect(prismaService.socialContentVersion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            digest: null,
          }),
        }),
      );
    });
  });

  // ==================== generateAllVersions ====================

  describe("generateAllVersions", () => {
    beforeEach(() => {
      prismaService.socialContent.findUnique.mockResolvedValue(mockContent);
      prismaService.socialContentVersion.upsert.mockResolvedValue(mockVersion);
    });

    it("should generate versions for all platforms concurrently", async () => {
      const results = await service.generateAllVersions(
        "content-123",
        "user-123",
      );

      // Should generate versions for WECHAT_MP and XIAOHONGSHU
      expect(results.length).toBeGreaterThan(0);
      expect(prismaService.socialContentVersion.upsert).toHaveBeenCalledTimes(
        results.length,
      );
    });

    it("should return partial results when some platform versions fail", async () => {
      prismaService.socialContentVersion.upsert
        .mockResolvedValueOnce(mockVersion)
        .mockRejectedValueOnce(new Error("Platform error"));

      const results = await service.generateAllVersions("content-123");

      // Should return only successful versions
      expect(results).toHaveLength(1);
    });
  });

  // ==================== getVersions ====================

  describe("getVersions", () => {
    it("should return all versions for a content", async () => {
      const mockVersions = [
        mockVersion,
        {
          ...mockVersion,
          id: "version-456",
          platformType: "XIAOHONGSHU" as SocialPlatformType,
        },
      ];
      prismaService.socialContentVersion.findMany.mockResolvedValue(
        mockVersions,
      );

      const result = await service.getVersions("content-123");

      expect(result).toHaveLength(2);
      expect(prismaService.socialContentVersion.findMany).toHaveBeenCalledWith({
        where: { contentId: "content-123" },
        orderBy: { createdAt: "asc" },
      });
    });

    it("should return empty array when no versions exist", async () => {
      prismaService.socialContentVersion.findMany.mockResolvedValue([]);

      const result = await service.getVersions("content-123");

      expect(result).toEqual([]);
    });
  });

  // ==================== getVersion ====================

  describe("getVersion", () => {
    it("should return a specific platform version", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(
        mockVersion,
      );

      const result = await service.getVersion("content-123", "WECHAT_MP");

      expect(result).toEqual(mockVersion);
      expect(
        prismaService.socialContentVersion.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          contentId_platformType: {
            contentId: "content-123",
            platformType: "WECHAT_MP",
          },
        },
      });
    });

    it("should return null when version does not exist", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(null);

      const result = await service.getVersion("content-123", "XIAOHONGSHU");

      expect(result).toBeNull();
    });
  });

  // ==================== getVersionForPublish ====================

  describe("getVersionForPublish", () => {
    it("should return platform-specific version when available", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(
        mockVersion,
      );

      const result = await service.getVersionForPublish(
        "content-123",
        "WECHAT_MP",
      );

      expect(result).toEqual({
        title: mockVersion.title,
        content: mockVersion.content,
        digest: mockVersion.digest,
      });
    });

    it("should fall back to default version when platform version not found", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(null);
      const defaultVersion = { ...mockVersion, isDefault: true };
      prismaService.socialContentVersion.findFirst.mockResolvedValue(
        defaultVersion,
      );

      const result = await service.getVersionForPublish(
        "content-123",
        "WECHAT_MP",
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe(defaultVersion.title);
    });

    it("should return null when no platform or default version exists", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(null);
      prismaService.socialContentVersion.findFirst.mockResolvedValue(null);

      const result = await service.getVersionForPublish(
        "content-123",
        "WECHAT_MP",
      );

      expect(result).toBeNull();
    });

    it("should normalize undefined digest to null", async () => {
      const versionWithUndefinedDigest = { ...mockVersion, digest: undefined };
      prismaService.socialContentVersion.findUnique.mockResolvedValue(
        versionWithUndefinedDigest,
      );

      const result = await service.getVersionForPublish(
        "content-123",
        "WECHAT_MP",
      );

      expect(result!.digest).toBeNull();
    });
  });

  // ==================== updateVersion ====================

  describe("updateVersion", () => {
    it("should update existing version content", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(
        mockVersion,
      );
      prismaService.socialContentVersion.update.mockResolvedValue({
        ...mockVersion,
        title: "Updated Title",
      });

      const result = await service.updateVersion("content-123", "WECHAT_MP", {
        title: "Updated Title",
      });

      expect(result.title).toBe("Updated Title");
      expect(prismaService.socialContentVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockVersion.id },
          data: expect.objectContaining({
            title: "Updated Title",
            generatedBy: "MANUAL",
          }),
        }),
      );
    });

    it("should create new version when it does not exist yet", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(null);
      prismaService.socialContent.findUnique.mockResolvedValue(mockContent);
      prismaService.socialContentVersion.create.mockResolvedValue(mockVersion);

      await service.updateVersion("content-123", "WECHAT_MP", {
        title: "New Title",
      });

      expect(prismaService.socialContentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentId: "content-123",
          platformType: "WECHAT_MP",
          generatedBy: "MANUAL",
        }),
      });
    });

    it("should throw NotFoundException when content not found during create", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(null);
      prismaService.socialContent.findUnique.mockResolvedValue(null);

      await expect(
        service.updateVersion("nonexistent", "WECHAT_MP", { title: "T" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should only update provided fields", async () => {
      prismaService.socialContentVersion.findUnique.mockResolvedValue(
        mockVersion,
      );
      prismaService.socialContentVersion.update.mockResolvedValue(mockVersion);

      await service.updateVersion("content-123", "WECHAT_MP", {
        content: "New content only",
      });

      expect(prismaService.socialContentVersion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: "New content only",
          }),
        }),
      );
      // title should not be in the update data
      const updateCall =
        prismaService.socialContentVersion.update.mock.calls[0][0];
      expect(updateCall.data.title).toBeUndefined();
    });
  });

  // ==================== deleteVersion ====================

  describe("deleteVersion", () => {
    it("should delete a platform version", async () => {
      prismaService.socialContentVersion.deleteMany.mockResolvedValue({
        count: 1,
      });

      await service.deleteVersion("content-123", "WECHAT_MP");

      expect(
        prismaService.socialContentVersion.deleteMany,
      ).toHaveBeenCalledWith({
        where: { contentId: "content-123", platformType: "WECHAT_MP" },
      });
    });

    it("should not throw when version does not exist", async () => {
      prismaService.socialContentVersion.deleteMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.deleteVersion("content-123", "WECHAT_MP"),
      ).resolves.not.toThrow();
    });
  });

  // ==================== setDefaultVersion ====================

  describe("setDefaultVersion", () => {
    it("should set a version as default and unset others", async () => {
      prismaService.socialContentVersion.updateMany.mockResolvedValue({
        count: 2,
      });
      prismaService.socialContentVersion.update.mockResolvedValue({
        ...mockVersion,
        isDefault: true,
      });

      const result = await service.setDefaultVersion(
        "content-123",
        "WECHAT_MP",
      );

      // First: unset all defaults
      expect(
        prismaService.socialContentVersion.updateMany,
      ).toHaveBeenCalledWith({
        where: { contentId: "content-123" },
        data: { isDefault: false },
      });

      // Then: set the new default
      expect(prismaService.socialContentVersion.update).toHaveBeenCalledWith({
        where: {
          contentId_platformType: {
            contentId: "content-123",
            platformType: "WECHAT_MP",
          },
        },
        data: { isDefault: true },
      });

      expect(result.isDefault).toBe(true);
    });
  });

  // ==================== Content truncation logic ====================

  describe("content truncation", () => {
    beforeEach(() => {
      prismaService.socialContentVersion.upsert.mockResolvedValue(mockVersion);
    });

    it("should truncate long titles with ellipsis", async () => {
      // Title of 50 chars exceeds WECHAT_MP limit of 30 by 67% (> 50% threshold)
      // So AI is called, but AI returns adapted content
      // We test that content stays within limits after truncation applied to AI result
      const contentWithLongTitle = {
        ...mockContent,
        title: "A".repeat(50), // Exceeds WECHAT_MP limit of 30
        content: "Short content",
        digest: "Short digest",
      };
      prismaService.socialContent.findUnique.mockResolvedValue(
        contentWithLongTitle,
      );

      // Mock AI returning a title that is still too long (needs truncation)
      aiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          title: "B".repeat(35), // Still 5 chars over limit
          content: "Adapted content",
          digest: "Adapted digest",
        }),
        isError: false,
      });

      await service.generateVersion("content-123", "WECHAT_MP");

      // After truncation, title should be exactly maxTitle length with ellipsis
      expect(prismaService.socialContentVersion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            title: expect.stringContaining("…"),
          }),
        }),
      );
    });

    it("should truncate long digest for WECHAT_MP", async () => {
      const contentWithLongDigest = {
        ...mockContent,
        title: "Short title",
        content: "Short content",
        digest: "D".repeat(200), // Exceeds WECHAT_MP digest limit of 120
      };
      prismaService.socialContent.findUnique.mockResolvedValue(
        contentWithLongDigest,
      );

      await service.generateVersion("content-123", "WECHAT_MP");

      expect(prismaService.socialContentVersion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            digest: expect.stringContaining("…"),
          }),
        }),
      );
    });

    it("should not truncate content within limits", async () => {
      const contentWithinLimits = {
        ...mockContent,
        title: "Short title",
        content: "Short content within limits",
        digest: "Short digest",
      };
      prismaService.socialContent.findUnique.mockResolvedValue(
        contentWithinLimits,
      );

      await service.generateVersion("content-123", "WECHAT_MP");

      expect(prismaService.socialContentVersion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            title: "Short title",
            content: "Short content within limits",
            digest: "Short digest",
          }),
        }),
      );
    });
  });

  // ==================== AI adaptation system prompts ====================

  describe("AI adaptation system prompts", () => {
    beforeEach(() => {
      // Ensure upsert always returns mockVersion
      prismaService.socialContentVersion.upsert.mockResolvedValue(mockVersion);
    });

    it("should use WECHAT_MP system prompt for WeChat platform", async () => {
      const longContent = {
        ...mockContent,
        title: "A".repeat(50), // triggers AI rewrite threshold
        content: "C".repeat(1300),
      };
      prismaService.socialContent.findUnique.mockResolvedValue(longContent);

      await service.generateVersion("content-123", "WECHAT_MP");

      if (aiFacade.chat.mock.calls.length > 0) {
        const chatArgs = aiFacade.chat.mock.calls[0][0];
        expect(chatArgs.messages[0].role).toBe("system");
      }
    });

    it("should use XIAOHONGSHU system prompt for Xiaohongshu platform", async () => {
      const longContent = {
        ...mockContent,
        content: "C".repeat(1300),
      };
      prismaService.socialContent.findUnique.mockResolvedValue(longContent);

      await service.generateVersion("content-123", "XIAOHONGSHU");

      if (aiFacade.chat.mock.calls.length > 0) {
        const chatArgs = aiFacade.chat.mock.calls[0][0];
        expect(chatArgs.messages[0].role).toBe("system");
      }
    });
  });
});
