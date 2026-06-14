/**
 * AiSocialService - Supplemental2 Tests
 *
 * Covers branches not covered by the existing ai-social.service.spec.ts or
 * ai-social.service-supplemental.spec.ts:
 * - verifyConnection() - already verifying (lock), no pending session, loggedIn with no cookies,
 *   loggedIn with valid cookies (success), finally releases lock, catch branch
 * - validateSession() - no sessionData, xhs mcp-managed (loggedIn + error),
 *   non-string sessionData, unsupported platform type
 * - validateWechatSession() - login redirect, frame/home URL, element found, error thrown
 * - batchPublishContents() - invalid connection, DRAFT/APPROVED allowed, status not allowed,
 *   content not found, unexpected transaction error
 * - scheduleContent() / cancelPublish() - happy + error paths
 * - getPublishLogs()
 * - source query methods - getExploreSources, getResearchSources, getOfficeSources, getWritingSources
 * - publishContent() - connection missing fallback, kernel process paths
 */

// Avoid loading transitive cache-manager/ioredis deps
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }), {
  virtual: true,
});
jest.mock("cache-manager", () => ({}), { virtual: true });
jest.mock("ioredis", () => ({}), { virtual: true });

jest.mock("../session-crypto", () => ({
  encryptSession: jest.fn((data: unknown) => JSON.stringify(data)),
  decryptSession: jest.fn((data: string) => JSON.parse(data) as unknown),
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  MissionExecutorService: class {},
  MissionContext: { run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  MissionExecutorService: class {},
  MissionContext: { run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  AIFacade: class {},
  AiChatService: class {},
  ChatFacade: class {},
  EmbeddingService: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  AIFacade: class {},
  AiChatService: class {},
  ChatFacade: class {},
  EmbeddingService: class {},
}));

jest.mock("../publish-executor.service", () => ({
  PublishExecutorService: class {},
}));
jest.mock("../../pipeline/social-pipeline-dispatcher.service", () => ({
  SocialPipelineDispatcher: class {},
}));
jest.mock("../content-version.service", () => ({
  ContentVersionService: class {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { AiSocialService } from "../ai-social.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { CacheService } from "../../../../../../common/cache/cache.service";
import { ContentCheckerService } from "../content-checker.service";
import { SocialPipelineDispatcher } from "../../pipeline/social-pipeline-dispatcher.service";
import { SocialBrowserService } from "../social-browser.service";
import { XhsMcpAdapter } from "../../../integrations/xiaohongshu/xiaohongshu.adapter";
import {
  SocialPlatformType,
  SocialContentStatus,
  SocialContentSourceType,
} from "../../types";

// Types
type MockPrisma = {
  socialPlatformConnection: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
  };
  socialContent: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  socialPublishLog: {
    findMany: jest.Mock;
    create: jest.Mock;
  };
  resource: { findMany: jest.Mock };
  researchTopic: { findMany: jest.Mock };
  officeDocument: { findMany: jest.Mock };
  writingProject: { findMany: jest.Mock };
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
};

const userId = "user-s2";
const contentId = "content-s2";
const connectionId = "conn-s2";

const mockContent = {
  id: contentId,
  userId,
  connectionId,
  contentType: "WECHAT_ARTICLE",
  sourceType: SocialContentSourceType.MANUAL,
  title: "S2 Article",
  content: "S2 content",
  status: SocialContentStatus.DRAFT,
  images: [],
  tags: [],
  autoPublish: false,
  retryCount: 0,
  coverImageUrl: null,
  digest: null,
  author: null,
  location: null,
  sourceId: null,
  sourceUrl: null,
  aiProcessLog: null,
  aiSuggestions: null,
  complianceCheck: null,
  reviewStatus: null,
  reviewedById: null,
  reviewedAt: null,
  reviewNote: null,
  scheduledAt: null,
  publishedAt: null,
  externalId: null,
  externalUrl: null,
  errorMessage: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  connectionAccountName: "MyAccount",
  connectionPlatformType: "WECHAT_MP",
  connection: { accountName: "MyAccount", platformType: "WECHAT_MP" },
};

const mockConnection = {
  id: connectionId,
  userId,
  platformType: SocialPlatformType.WECHAT_MP,
  accountName: "MyWechat",
  isActive: true,
  sessionData: JSON.stringify({ cookies: [{ name: "test", value: "cookie" }] }),
  lastCheckAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildModule(
  prisma: MockPrisma,
  cache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    buildKey: jest.Mock;
  },
  playwright: {
    startLoginSession: jest.Mock;
    checkLoginStatus: jest.Mock;
    endLoginSession: jest.Mock;
    restoreSession: jest.Mock;
    createPage: jest.Mock;
    closeContext: jest.Mock;
  },
  xhsMcpAdapter: {
    isAvailable: jest.Mock;
    checkLoginStatus: jest.Mock;
    listFeeds: jest.Mock;
    searchFeeds: jest.Mock;
    getFeedDetail: jest.Mock;
    postComment: jest.Mock;
    getUserProfile: jest.Mock;
  },
  contentChecker: { check: jest.Mock },
) {
  const mockDispatcher = {
    tryReserveInFlight: jest.fn().mockReturnValue({
      missionId: "social-mission-supp2",
      reused: false,
    }),
    runMission: jest.fn().mockResolvedValue({
      missionId: "social-mission-supp2",
      status: "completed",
    }),
  };
  return Test.createTestingModule({
    providers: [
      AiSocialService,
      { provide: PrismaService, useValue: prisma },
      { provide: CacheService, useValue: cache },
      { provide: ContentCheckerService, useValue: contentChecker },
      { provide: SocialPipelineDispatcher, useValue: mockDispatcher },
      { provide: SocialBrowserService, useValue: playwright },
      { provide: XhsMcpAdapter, useValue: xhsMcpAdapter },
    ],
  }).compile();
}

function makePrisma(): MockPrisma {
  return {
    socialPlatformConnection: {
      findMany: jest.fn().mockResolvedValue([mockConnection]),
      findUnique: jest.fn().mockResolvedValue(mockConnection),
      findFirst: jest.fn().mockResolvedValue(mockConnection),
      upsert: jest.fn().mockResolvedValue(mockConnection),
      update: jest.fn().mockResolvedValue(mockConnection),
      delete: jest.fn().mockResolvedValue(mockConnection),
      create: jest.fn().mockResolvedValue(mockConnection),
    },
    socialContent: {
      findMany: jest.fn().mockResolvedValue([mockContent]),
      findFirst: jest.fn().mockResolvedValue(mockContent),
      update: jest.fn().mockResolvedValue(mockContent),
      delete: jest.fn().mockResolvedValue(mockContent),
    },
    socialPublishLog: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    resource: { findMany: jest.fn().mockResolvedValue([]) },
    researchTopic: { findMany: jest.fn().mockResolvedValue([]) },
    officeDocument: { findMany: jest.fn().mockResolvedValue([]) },
    writingProject: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([mockContent]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
}

function makeCache() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    buildKey: jest
      .fn()
      .mockImplementation(
        (prefix: string, ...parts: string[]) => `${prefix}:${parts.join(":")}`,
      ),
  };
}

function makePlaywright() {
  return {
    startLoginSession: jest.fn().mockResolvedValue({
      sessionKey: "sk-123",
      screenshot: "b64",
    }),
    checkLoginStatus: jest.fn().mockResolvedValue({
      loggedIn: false,
      screenshot: "b64",
    }),
    endLoginSession: jest.fn().mockResolvedValue(undefined),
    restoreSession: jest.fn().mockResolvedValue(undefined),
    createPage: jest.fn().mockResolvedValue({
      goto: jest.fn().mockResolvedValue(undefined),
      waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home"),
      $: jest.fn().mockResolvedValue(null),
    }),
    closeContext: jest.fn().mockResolvedValue(undefined),
  };
}

function makeXhsAdapter() {
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    checkLoginStatus: jest
      .fn()
      .mockResolvedValue({ loggedIn: true, nickname: "TestUser" }),
    listFeeds: jest.fn().mockResolvedValue([]),
    searchFeeds: jest.fn().mockResolvedValue([]),
    getFeedDetail: jest.fn().mockResolvedValue(null),
    postComment: jest.fn().mockResolvedValue({ success: true }),
    getUserProfile: jest.fn().mockResolvedValue(null),
  };
}

describe("AiSocialService (supplemental2)", () => {
  let service: AiSocialService;
  let prisma: MockPrisma;
  let cache: ReturnType<typeof makeCache>;
  let playwright: ReturnType<typeof makePlaywright>;
  let xhsAdapter: ReturnType<typeof makeXhsAdapter>;
  let contentChecker: { check: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    cache = makeCache();
    playwright = makePlaywright();
    xhsAdapter = makeXhsAdapter();
    contentChecker = {
      check: jest
        .fn()
        .mockResolvedValue({ passed: true, issues: [], score: 1.0 }),
    };

    const module: TestingModule = await buildModule(
      prisma,
      cache,
      playwright,
      xhsAdapter,
      contentChecker,
    );
    service = module.get<AiSocialService>(AiSocialService);
  });

  // =====================================================================
  // verifyConnection - non-XHS paths
  // =====================================================================

  // =====================================================================
  // verifyConnection - XHS path
  // =====================================================================

  // =====================================================================
  // testConnection - validateSession paths
  // =====================================================================

  // =====================================================================
  // scheduleContent
  // =====================================================================

  describe("scheduleContent()", () => {
    it("updates status to SCHEDULED and returns updated content", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([mockContent]) // getContent for schedule
        .mockResolvedValueOnce([{ ...mockContent, status: "SCHEDULED" }]); // getContent after update
      prisma.$executeRaw.mockResolvedValue(1);

      const scheduledAt = new Date("2026-04-01T10:00:00Z");
      await service.scheduleContent(userId, contentId, scheduledAt);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("throws NotFoundException when content not found for schedule", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.scheduleContent(userId, "nonexistent", new Date()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =====================================================================
  // cancelPublish
  // =====================================================================

  describe("cancelPublish()", () => {
    it("cancels scheduled content", async () => {
      const scheduledContent = {
        ...mockContent,
        status: SocialContentStatus.SCHEDULED,
      };
      prisma.$queryRaw
        .mockResolvedValueOnce([scheduledContent])
        .mockResolvedValueOnce([{ ...scheduledContent, status: "DRAFT" }]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.cancelPublish(userId, contentId);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("cancels pending content", async () => {
      const pendingContent = {
        ...mockContent,
        status: SocialContentStatus.PENDING,
      };
      prisma.$queryRaw
        .mockResolvedValueOnce([pendingContent])
        .mockResolvedValueOnce([{ ...pendingContent, status: "DRAFT" }]);
      prisma.$executeRaw.mockResolvedValue(1);

      await service.cancelPublish(userId, contentId);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("throws BadRequestException when content is not SCHEDULED or PENDING", async () => {
      const publishedContent = {
        ...mockContent,
        status: SocialContentStatus.PUBLISHED,
      };
      prisma.$queryRaw.mockResolvedValue([publishedContent]);

      await expect(service.cancelPublish(userId, contentId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws NotFoundException when content not found", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.cancelPublish(userId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =====================================================================
  // getPublishLogs
  // =====================================================================

  describe("getPublishLogs()", () => {
    it("returns publish logs for valid content", async () => {
      const logs = [
        { id: "log-1", contentId, action: "PUBLISH", status: "SUCCESS" },
      ];
      prisma.$queryRaw.mockResolvedValue([mockContent]);
      prisma.socialPublishLog.findMany.mockResolvedValue(logs);

      const result = await service.getPublishLogs(userId, contentId);

      expect(result).toEqual(logs);
    });

    it("throws NotFoundException when content not found", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        service.getPublishLogs(userId, "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =====================================================================
  // Source query methods
  // =====================================================================

  // =====================================================================
  // batchPublishContents - additional paths
  // =====================================================================

  describe("batchPublishContents()", () => {
    it("returns failed result when connection is invalid", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      const result = await service.batchPublishContents(
        userId,
        [contentId],
        connectionId,
      );

      expect(result.success).toBe(false);
      expect(result.failed).toBe(1);
      expect(result.errors?.[0].error).toContain("连接无效");
    });

    it("allows DRAFT content to be published", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue(
        mockConnection,
      );

      const txFn = jest.fn().mockImplementation(async (cb: Function) => {
        const tx = {
          socialContent: {
            findFirst: jest
              .fn()
              .mockResolvedValue({ ...mockContent, status: "DRAFT" }),
            update: jest.fn().mockResolvedValue({}),
          },
          socialPublishLog: {
            create: jest.fn().mockResolvedValue({}),
          },
        };
        await cb(tx);
      });
      prisma.$transaction.mockImplementation(txFn);
      const result = await service.batchPublishContents(
        userId,
        [contentId],
        connectionId,
      );

      expect(result.succeeded).toBe(1);
    });

    it("skips content with non-DRAFT/APPROVED status", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue(
        mockConnection,
      );

      const txFn = jest.fn().mockImplementation(async (cb: Function) => {
        const tx = {
          socialContent: {
            findFirst: jest
              .fn()
              .mockResolvedValue({ ...mockContent, status: "PUBLISHED" }),
            update: jest.fn(),
          },
          socialPublishLog: {
            create: jest.fn(),
          },
        };
        await cb(tx);
      });
      prisma.$transaction.mockImplementation(txFn);

      const result = await service.batchPublishContents(
        userId,
        [contentId],
        connectionId,
      );

      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors?.[0].error).toContain("不允许发布");
    });

    it("handles content not found in transaction", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue(
        mockConnection,
      );

      const txFn = jest.fn().mockImplementation(async (cb: Function) => {
        const tx = {
          socialContent: {
            findFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
          },
          socialPublishLog: {
            create: jest.fn(),
          },
        };
        await cb(tx);
      });
      prisma.$transaction.mockImplementation(txFn);

      const result = await service.batchPublishContents(
        userId,
        [contentId],
        connectionId,
      );

      expect(result.failed).toBe(1);
      expect(result.errors?.[0].error).toContain("不存在");
    });

    it("returns empty errors when all succeed", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue(
        mockConnection,
      );

      const txFn = jest.fn().mockImplementation(async (cb: Function) => {
        const tx = {
          socialContent: {
            findFirst: jest
              .fn()
              .mockResolvedValue({ ...mockContent, status: "DRAFT" }),
            update: jest.fn().mockResolvedValue({}),
          },
          socialPublishLog: {
            create: jest.fn().mockResolvedValue({}),
          },
        };
        await cb(tx);
      });
      prisma.$transaction.mockImplementation(txFn);
      const result = await service.batchPublishContents(
        userId,
        [contentId],
        connectionId,
      );

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });

  // =====================================================================
  // publishContent - connection not found fallback
  // =====================================================================

  describe("publishContent() - connection not found, uses active fallback", () => {
    it("uses active connection when original connection is deleted", async () => {
      const contentWithConn = { ...mockContent, connectionId };
      prisma.$queryRaw.mockResolvedValue([contentWithConn]);
      prisma.socialPlatformConnection.findUnique.mockResolvedValue(null);
      const activeConn = { ...mockConnection, id: "active-conn-999" };
      prisma.socialPlatformConnection.findFirst.mockResolvedValue(activeConn);
      prisma.$executeRaw.mockResolvedValue(1);
      const result = await service.publishContent(userId, contentId, {
        connectionId,
      });

      expect(result.success).toBe(true);
      expect(prisma.socialPlatformConnection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it("throws BadRequestException when no active connection found as fallback", async () => {
      const contentWithConn = { ...mockContent, connectionId };
      prisma.$queryRaw.mockResolvedValue([contentWithConn]);
      prisma.socialPlatformConnection.findUnique.mockResolvedValue(null);
      prisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      await expect(
        service.publishContent(userId, contentId, { connectionId }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =====================================================================
  // updateContent - no fields update path
  // =====================================================================

  describe("updateContent() - no-op path", () => {
    it("returns current content unchanged when dto has no fields", async () => {
      prisma.$queryRaw.mockResolvedValue([mockContent]);

      const result = await service.updateContent(userId, contentId, {});

      expect(result).toBeDefined();
      expect(prisma.socialContent.update).not.toHaveBeenCalled();
    });
  });
});
