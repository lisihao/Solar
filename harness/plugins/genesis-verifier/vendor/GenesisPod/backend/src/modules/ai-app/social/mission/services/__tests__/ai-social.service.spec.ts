/**
 * AiSocialService 单元测试
 *
 * 测试 AI Social 核心功能：
 * - initConnection() 初始化平台连接
 * - verifyConnection() 验证平台连接
 * - getConnections() 获取连接列表
 * - createContent() 创建内容
 * - getContents() 获取内容列表
 * - publishContent() 发布内容
 * - checkContent() 内容审核
 * - batchDeleteContents() 批量删除
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { AiSocialService } from "../ai-social.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ContentCheckerService } from "../content-checker.service";
import { SocialPipelineDispatcher } from "../../pipeline/social-pipeline-dispatcher.service";
import {
  SocialPlatformType,
  SocialContentStatus,
  SocialContentSourceType,
} from "../../types";

// Connection / XHS / Sources tests 已搬到 social-connections.service.spec.ts /
//   xhs-mcp-facade.service.spec.ts / social-import-sources.service.spec.ts
//   (god class 拆分 phase 2.A.1/A.2/A.5)。
//   本 spec 现只测 AiSocialService 剩余职责：内容 CRUD / 发布 / 批量。

describe("AiSocialService", () => {
  let service: AiSocialService;
  let mockPrisma: any;
  let mockContentChecker: any;

  const userId = "user-123";
  const connectionId = "conn-456";
  const contentId = "content-789";

  const mockConnection = {
    id: connectionId,
    userId,
    platformType: SocialPlatformType.WECHAT_MP,
    accountName: "MyWechatMP",
    isActive: true,
    sessionData: "encrypted-session-data",
    lastCheckAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockContent = {
    id: contentId,
    userId,
    connectionId,
    contentType: "WECHAT_ARTICLE",
    sourceType: SocialContentSourceType.MANUAL,
    title: "Test Article",
    content: "Article content",
    status: SocialContentStatus.DRAFT,
    images: ["https://example.com/image.jpg"],
    tags: ["test", "article"],
    autoPublish: false,
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    // Mock PrismaService
    mockPrisma = {
      socialPlatformConnection: {
        findMany: jest.fn().mockResolvedValue([mockConnection]),
        findUnique: jest.fn().mockResolvedValue(mockConnection),
        findFirst: jest.fn().mockResolvedValue(mockConnection),
        upsert: jest.fn().mockResolvedValue(mockConnection),
        update: jest.fn().mockResolvedValue(mockConnection),
        delete: jest.fn().mockResolvedValue(mockConnection),
      },
      socialContent: {
        findMany: jest.fn().mockResolvedValue([mockContent]),
        findFirst: jest.fn().mockResolvedValue(mockContent),
        update: jest.fn().mockResolvedValue(mockContent),
        delete: jest.fn().mockResolvedValue(mockContent),
      },
      socialPublishLog: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      researchTopic: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      officeDocument: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      writingProject: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      $transaction: jest.fn(),
    };

    // Mock ContentCheckerService
    mockContentChecker = {
      check: jest.fn().mockResolvedValue({
        passed: true,
        issues: [],
        score: 1.0,
      }),
    };

    const mockDispatcher = {
      tryReserveInFlight: jest.fn().mockReturnValue({
        missionId: "social-mission-mock",
        reused: false,
      }),
      runMission: jest.fn().mockResolvedValue({
        missionId: "social-mission-mock",
        status: "completed",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiSocialService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ContentCheckerService, useValue: mockContentChecker },
        { provide: SocialPipelineDispatcher, useValue: mockDispatcher },
      ],
    }).compile();

    service = module.get<AiSocialService>(AiSocialService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Platform Connections
  // =========================================================================

  // =========================================================================
  // Content Management
  // =========================================================================

  describe("getContents", () => {
    it("should return paginated contents", async () => {
      const mockContentRow = {
        id: contentId,
        userId,
        connectionId,
        contentType: "WECHAT_ARTICLE",
        sourceType: "MANUAL",
        sourceId: null,
        sourceUrl: null,
        title: "Test",
        content: "Content",
        author: null,
        digest: null,
        coverImageUrl: null,
        images: [],
        tags: [],
        location: null,
        status: "DRAFT",
        aiProcessLog: null,
        aiSuggestions: null,
        complianceCheck: null,
        reviewStatus: null,
        reviewedById: null,
        reviewedAt: null,
        reviewNote: null,
        scheduledAt: null,
        publishedAt: null,
        autoPublish: false,
        externalId: null,
        externalUrl: null,
        errorMessage: null,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        connectionAccountName: "MyAccount",
        connectionPlatformType: "WECHAT_MP",
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([mockContentRow]) // Contents query
        .mockResolvedValueOnce([{ count: BigInt(1) }]); // Count query

      const options = { page: 1, limit: 10 };

      const result = await service.getContents(userId, options);

      expect(result.contents).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
    });

    it("should filter by status", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      await service.getContents(userId, {
        status: "PUBLISHED",
        page: 1,
        limit: 10,
      });

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it("should throw BadRequestException for invalid status", async () => {
      await expect(
        service.getContents(userId, {
          status: "INVALID_STATUS",
          page: 1,
          limit: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for invalid content type", async () => {
      await expect(
        service.getContents(userId, {
          contentType: "INVALID_TYPE",
          page: 1,
          limit: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("createContent", () => {
    it("should create new content", async () => {
      const dto = {
        contentType: "WECHAT_ARTICLE",
        title: "New Article",
        content: "Article content",
        author: "John Doe",
        images: ["https://example.com/image.jpg"],
        tags: ["test"],
      };

      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: "new-content-id",
          user_id: userId,
          content_type: "WECHAT_ARTICLE",
          source_type: "MANUAL",
          title: "New Article",
          content: "Article content",
          status: "DRAFT",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const result = await service.createContent(userId, dto as any);

      expect(result).toHaveProperty("id");
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe("getContent", () => {
    it("should return single content", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          connectionId,
          contentType: "WECHAT_ARTICLE",
          sourceType: "MANUAL",
          sourceId: null,
          sourceUrl: null,
          title: "Test",
          content: "Content",
          author: null,
          digest: null,
          coverImageUrl: null,
          images: [],
          tags: [],
          location: null,
          status: "DRAFT",
          complianceCheck: null,
          reviewStatus: null,
          scheduledAt: null,
          publishedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          connectionAccountName: "MyAccount",
          connectionPlatformType: "WECHAT_MP",
        },
      ]);

      const result = await service.getContent(userId, contentId);

      expect(result.id).toBe(contentId);
      expect(result.connection).toBeDefined();
    });

    it("should throw NotFoundException if content not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getContent(userId, contentId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("updateContent", () => {
    it("should update content fields", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          title: "Test",
          content: "Content",
          status: "DRAFT",
        },
      ]);

      const dto = { title: "Updated Title" };

      await service.updateContent(userId, contentId, dto);

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith({
        where: { id: contentId, userId },
        data: expect.objectContaining({
          title: "Updated Title",
        }),
      });
    });
  });

  describe("deleteContent", () => {
    it("should verify ownership and delete content", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: contentId, userId, title: "Test" },
      ]);

      const result = await service.deleteContent(userId, contentId);

      expect(result.success).toBe(true);
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Content Checking
  // =========================================================================

  describe("checkContent", () => {
    it("should check content compliance", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          content: "Test content",
          status: "DRAFT",
        },
      ]);

      const result = await service.checkContent(userId, contentId);

      expect(result.passed).toBe(true);
      expect(result).toHaveProperty("checkedAt");
      expect(mockContentChecker.check).toHaveBeenCalledWith("Test content");
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Publishing
  // =========================================================================

  describe("publishContent", () => {
    it("should throw error if no connection provided", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          connectionId: null,
          contentType: "WECHAT_ARTICLE",
        },
      ]);

      await expect(
        service.publishContent(userId, contentId, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it("should publish content with valid connection (PR-3 委托 dispatcher.runMission)", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          connectionId,
          contentType: "WECHAT_ARTICLE",
          status: "DRAFT",
        },
      ]);
      mockPrisma.socialPlatformConnection.findUnique.mockResolvedValue({
        id: connectionId,
        userId,
        platformType: "WECHAT_MP",
        isActive: true,
      });

      await service.publishContent(userId, contentId, {
        connectionId,
      });

      expect(mockPrisma.socialPlatformConnection.findUnique).toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      // PR-3: publishContent 不再调 publishExecutor.execute，改委托 dispatcher.runMission
      const dispatcher = (
        service as unknown as {
          dispatcher: { runMission: jest.Mock };
        }
      ).dispatcher;
      expect(dispatcher.runMission).toHaveBeenCalled();
      expect(dispatcher.runMission.mock.calls[0][1]).toMatchObject({
        contentId,
        platforms: ["WECHAT_MP"],
        connectionIds: { WECHAT_MP: connectionId },
        depth: "quick",
      });
    });

    it("should find active connection if original connection not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          connectionId: "old-connection-id",
          contentType: "WECHAT_ARTICLE",
          status: "DRAFT",
        },
      ]);

      mockPrisma.socialPlatformConnection.findUnique.mockResolvedValue(null);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: "new-connection-id",
        userId,
        platformType: "WECHAT_MP",
        isActive: true,
      });

      await service.publishContent(userId, contentId, {});

      expect(mockPrisma.socialPlatformConnection.findFirst).toHaveBeenCalled();
    });

    it("should throw error if no active connection available", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          connectionId: "old-connection-id",
          contentType: "WECHAT_ARTICLE",
          status: "DRAFT",
        },
      ]);

      mockPrisma.socialPlatformConnection.findUnique.mockResolvedValue(null);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.publishContent(userId, contentId, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("scheduleContent", () => {
    it("should schedule content for future publishing", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          status: "DRAFT",
        },
      ]);

      const scheduledAt = new Date("2025-12-31");

      await service.scheduleContent(userId, contentId, scheduledAt);

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe("cancelPublish", () => {
    it("should cancel scheduled content", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          status: SocialContentStatus.SCHEDULED,
        },
      ]);

      await service.cancelPublish(userId, contentId);

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should throw error if content is not scheduled or pending", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: contentId,
          userId,
          status: SocialContentStatus.PUBLISHED,
        },
      ]);

      await expect(service.cancelPublish(userId, contentId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // Batch Operations
  // =========================================================================

  describe("batchDeleteContents", () => {
    it("should delete multiple contents", async () => {
      const ids = ["content-1", "content-2"];

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockImplementation((query: any) => {
              const id = query.where.id;
              return Promise.resolve({
                id,
                userId,
                status: "DRAFT",
              });
            }),
            delete: jest.fn().mockResolvedValue(undefined),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchDeleteContents(userId, ids);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.success).toBe(true);
    });

    it("should not delete published content", async () => {
      const ids = ["content-1"];

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue({
              id: "content-1",
              userId,
              status: "PUBLISHED",
            }),
            delete: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchDeleteContents(userId, ids);

      expect(result.succeeded).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].error).toContain("已发布内容无法删除");
    });
  });

  describe("batchPublishContents", () => {
    it("should validate connection before batch publish", async () => {
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      const result = await service.batchPublishContents(
        userId,
        ["content-1"],
        "invalid-connection",
      );

      expect(result.success).toBe(false);
      expect(result.errors![0].error).toContain("平台连接无效");
    });

    it("should publish multiple contents", async () => {
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: connectionId,
        userId,
        isActive: true,
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue({
              id: "content-1",
              userId,
              status: "DRAFT",
            }),
            update: jest.fn().mockResolvedValue(undefined),
          },
          socialPublishLog: {
            create: jest.fn().mockResolvedValue(undefined),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchPublishContents(
        userId,
        ["content-1"],
        connectionId,
      );

      expect(result.total).toBe(1);
    });

    it("should report error when content not found in transaction", async () => {
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: connectionId,
        userId,
        isActive: true,
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
          socialPublishLog: {
            create: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchPublishContents(
        userId,
        ["nonexistent-content"],
        connectionId,
      );

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors![0].error).toContain("不存在");
    });

    it("should report error when content status is not publishable", async () => {
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: connectionId,
        userId,
        isActive: true,
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue({
              id: "content-1",
              userId,
              status: "PUBLISHED",
            }),
            update: jest.fn(),
          },
          socialPublishLog: {
            create: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchPublishContents(
        userId,
        ["content-1"],
        connectionId,
      );

      expect(result.succeeded).toBe(0);
      expect(result.errors![0].error).toContain("不允许发布");
    });

    it("should handle exception inside batch publish transaction", async () => {
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: connectionId,
        userId,
        isActive: true,
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue({
              id: "content-1",
              userId,
              status: "DRAFT",
            }),
            update: jest.fn().mockRejectedValue(new Error("DB error")),
          },
          socialPublishLog: {
            create: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchPublishContents(
        userId,
        ["content-1"],
        connectionId,
      );

      expect(result.failed).toBe(1);
      expect(result.errors![0].error).toBe("DB error");
    });

    it("should fire-and-forget publish executor for succeeded contents", async () => {
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: connectionId,
        userId,
        isActive: true,
      });

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue({
              id: "content-1",
              userId,
              status: "DRAFT",
            }),
            update: jest.fn().mockResolvedValue(undefined),
          },
          socialPublishLog: {
            create: jest.fn().mockResolvedValue(undefined),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchPublishContents(
        userId,
        ["content-1"],
        connectionId,
      );

      // Despite executor failure, the batch result reflects transaction success
      expect(result.succeeded).toBe(1);
    });
  });

  // =========================================================================
  // XHS MCP connection flows
  // =========================================================================

  // =========================================================================
  // testConnection - session validation paths
  // =========================================================================

  // =========================================================================
  // refreshConnection
  // =========================================================================

  // =========================================================================
  // XHS pass-through methods
  // =========================================================================

  // =========================================================================
  // Source listing methods
  // =========================================================================

  describe("getPublishLogs", () => {
    it("should return publish logs for content", async () => {
      const mockLogs = [
        { id: "log-1", contentId, action: "PUBLISH", status: "DONE" },
      ];
      mockPrisma.socialPublishLog.findMany.mockResolvedValue(mockLogs);

      // Mock getContent
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: contentId, userId, title: "Test", content: "Test" },
      ]);

      const result = await service.getPublishLogs(userId, contentId);

      expect(result).toEqual(mockLogs);
      expect(mockPrisma.socialPublishLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { contentId } }),
      );
    });
  });

  // =========================================================================
  // updateContent - no-op path
  // =========================================================================

  describe("updateContent - edge cases", () => {
    it("should return current content when no fields to update", async () => {
      const contentRow = {
        id: contentId,
        userId,
        connectionId: null,
        contentType: "WECHAT_ARTICLE",
        title: "Test",
        content: "Content",
        status: "DRAFT",
        connectionAccountName: null,
        connectionPlatformType: null,
      };
      mockPrisma.$queryRaw.mockResolvedValue([contentRow]);

      // Pass empty DTO - no fields to update
      const result = await service.updateContent(userId, contentId, {});

      expect(result).toBeDefined();
      // No update call should be made
      expect(mockPrisma.socialContent.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // batchDeleteContents - error paths
  // =========================================================================

  describe("batchDeleteContents - error paths", () => {
    it("should report error when content not found in transaction", async () => {
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue(null),
            delete: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchDeleteContents(userId, ["missing-id"]);

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors![0].error).toContain("不存在");
    });

    it("should handle exception during deletion", async () => {
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue({
              id: "content-1",
              userId,
              status: "DRAFT",
            }),
            delete: jest.fn().mockRejectedValue(new Error("FK constraint")),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchDeleteContents(userId, ["content-1"]);

      expect(result.failed).toBe(1);
      expect(result.errors![0].error).toBe("FK constraint");
    });

    it("should return success=false and include errors array when any fail", async () => {
      const ids = ["content-good", "content-missing"];

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const mockTx = {
          socialContent: {
            findFirst: jest.fn().mockImplementation((query: any) => {
              if (query.where.id === "content-good") {
                return Promise.resolve({
                  id: "content-good",
                  userId,
                  status: "DRAFT",
                });
              }
              return Promise.resolve(null);
            }),
            delete: jest.fn().mockResolvedValue(undefined),
          },
        };
        return callback(mockTx);
      });

      const result = await service.batchDeleteContents(userId, ids);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  // =========================================================================
  // getContents - with contentType filter
  // =========================================================================

  describe("getContents - contentType filter", () => {
    it("should filter by both status and contentType", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      await service.getContents(userId, {
        status: "DRAFT",
        contentType: "WECHAT_ARTICLE",
        page: 1,
        limit: 10,
      });

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("should transform content with null connectionId to null connection", async () => {
      const contentRow = {
        id: contentId,
        userId,
        connectionId: null,
        contentType: "WECHAT_ARTICLE",
        sourceType: "MANUAL",
        sourceId: null,
        sourceUrl: null,
        title: "Test",
        content: "Content",
        author: null,
        digest: null,
        coverImageUrl: null,
        images: [],
        tags: [],
        location: null,
        status: "DRAFT",
        aiProcessLog: null,
        aiSuggestions: null,
        complianceCheck: null,
        reviewStatus: null,
        reviewedById: null,
        reviewedAt: null,
        reviewNote: null,
        scheduledAt: null,
        publishedAt: null,
        autoPublish: false,
        externalId: null,
        externalUrl: null,
        errorMessage: null,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        connectionAccountName: null,
        connectionPlatformType: null,
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([contentRow])
        .mockResolvedValueOnce([{ count: BigInt(1) }]);

      const result = await service.getContents(userId, { page: 1, limit: 10 });

      expect(result.contents[0].connection).toBeNull();
    });
  });
});
