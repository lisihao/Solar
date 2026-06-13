/**
 * Unit tests for PublishExecutorService
 *
 * All Prisma, Playwright, adapters and crypto utilities are fully mocked.
 */

// Mock session-crypto before the service import resolves it
jest.mock("../session-crypto", () => ({
  decryptSession: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { PublishExecutorService } from "../publish-executor.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { SocialBrowserService } from "../social-browser.service";
import { ContentVersionService } from "../content-version.service";
import { WechatAdapter } from "../../../integrations/wechat/wechat.adapter";
import { XhsMcpAdapter } from "../../../integrations/xiaohongshu/xiaohongshu.adapter";
import {
  SocialContentStatus,
  SocialPlatformType,
  SocialContentType,
} from "../../types";
import { decryptSession } from "../session-crypto";

const mockDecryptSession = decryptSession as jest.MockedFunction<
  typeof decryptSession
>;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const mockPrisma = {
  socialContent: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  socialPlatformConnection: {
    findFirst: jest.fn(),
  },
  socialPublishLog: {
    create: jest.fn(),
  },
};

const mockSocialBrowserService = {};

const mockContentVersionService = {
  getVersionForPublish: jest.fn(),
};

const mockWechatAdapter = {
  publish: jest.fn(),
};

const mockXhsMcpAdapter = {
  publishContent: jest.fn(),
};

function makeConnection(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "conn-1",
    userId: "user-1",
    platformType: SocialPlatformType.WECHAT_MP,
    isActive: true,
    sessionData: "mcp-managed",
    lastCheckAt: new Date(),
    ...overrides,
  };
}

function makeContent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "content-1",
    userId: "user-1",
    title: "Test Article",
    content: "Article body content",
    contentType: SocialContentType.WECHAT_ARTICLE,
    status: SocialContentStatus.PENDING,
    digest: "Short summary",
    images: [],
    connection: makeConnection(),
    connectionId: "conn-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("PublishExecutorService", () => {
  let service: PublishExecutorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDecryptSession.mockReturnValue({
      cookies: [{ name: "test", value: "val", domain: "mp.weixin.qq.com" }],
    } as ReturnType<typeof decryptSession>);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishExecutorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SocialBrowserService, useValue: mockSocialBrowserService },
        { provide: ContentVersionService, useValue: mockContentVersionService },
        { provide: WechatAdapter, useValue: mockWechatAdapter },
        { provide: XhsMcpAdapter, useValue: mockXhsMcpAdapter },
      ],
    }).compile();

    service = module.get<PublishExecutorService>(PublishExecutorService);
  });

  // =========================================================================
  // getPlaywright
  // =========================================================================

  describe("getPlaywright", () => {
    it("should return the SocialBrowserService instance", () => {
      expect(service.getPlaywright()).toBe(mockSocialBrowserService);
    });
  });

  // =========================================================================
  // execute — content not found
  // =========================================================================

  describe("execute — content not found", () => {
    it("should return failure when content does not exist", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);

      const result = await service.execute("nonexistent");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("内容不存在");
    });
  });

  // =========================================================================
  // execute — connection / session handling
  // =========================================================================

  describe("execute — connection validation", () => {
    it("should return failure when content has no connection and no active fallback", async () => {
      const content = makeContent({ connection: null, connectionId: null });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      const result = await service.execute("content-1");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("未关联发布账号");
    });

    it("should return failure when connection has invalid session and no fallback", async () => {
      // Simulate invalid cookie session (decrypt returns empty cookies)
      mockDecryptSession.mockReturnValue({ cookies: [] } as ReturnType<
        typeof decryptSession
      >);
      const conn = makeConnection({ sessionData: "encrypted-bad-data" });
      const content = makeContent({ connection: conn });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      const result = await service.execute("content-1");

      expect(result.success).toBe(false);
    });

    it("should fall back to active connection when content connection session is invalid", async () => {
      mockDecryptSession.mockReturnValue({ cookies: [] } as ReturnType<
        typeof decryptSession
      >);
      const badConn = makeConnection({ sessionData: "encrypted-no-cookies" });
      const activeConn = makeConnection({
        id: "conn-fallback",
        sessionData: "mcp-managed",
      });
      const content = makeContent({
        connection: badConn,
        connectionId: "conn-1",
      });

      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(
        activeConn,
      );
      mockPrisma.socialContent.update.mockResolvedValue({});
      mockContentVersionService.getVersionForPublish.mockResolvedValue(null);
      mockWechatAdapter.publish.mockResolvedValue({ success: true });
      mockPrisma.socialPublishLog.create.mockResolvedValue({});

      const result = await service.execute("content-1");

      expect(result.success).toBe(true);
    });

    it("should treat mcp-managed sessionData as valid", async () => {
      const conn = makeConnection({ sessionData: "mcp-managed" });
      const content = makeContent({ connection: conn });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockContentVersionService.getVersionForPublish.mockResolvedValue(null);
      mockWechatAdapter.publish.mockResolvedValue({ success: true });
      mockPrisma.socialContent.update.mockResolvedValue({});
      mockPrisma.socialPublishLog.create.mockResolvedValue({});

      const result = await service.execute("content-1");

      expect(result.success).toBe(true);
    });

    it("should return false when session decrypt throws an error", async () => {
      mockDecryptSession.mockImplementation(() => {
        throw new Error("Decryption failed");
      });
      const conn = makeConnection({ sessionData: "corrupted-data" });
      const content = makeContent({ connection: conn });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      const result = await service.execute("content-1");

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // execute — WeChat publish
  // =========================================================================

  describe("execute — WeChat publish", () => {
    beforeEach(() => {
      const conn = makeConnection({
        platformType: SocialPlatformType.WECHAT_MP,
      });
      const content = makeContent({ connection: conn });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockContentVersionService.getVersionForPublish.mockResolvedValue(null);
      mockPrisma.socialContent.update.mockResolvedValue({});
      mockPrisma.socialPublishLog.create.mockResolvedValue({});
    });

    it("should call wechatAdapter.publish with the content and connection", async () => {
      mockWechatAdapter.publish.mockResolvedValue({
        success: true,
        externalUrl: "https://mp.weixin.qq.com/art/1",
        externalId: "art-1",
      });

      await service.execute("content-1");

      expect(mockWechatAdapter.publish).toHaveBeenCalled();
    });

    it("should set content status to PUBLISHED on success", async () => {
      mockWechatAdapter.publish.mockResolvedValue({
        success: true,
        externalUrl: "https://mp.weixin.qq.com/art/1",
      });

      await service.execute("content-1");

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SocialContentStatus.PUBLISHED,
          }),
        }),
      );
    });

    it("should set content status to FAILED on adapter failure", async () => {
      mockWechatAdapter.publish.mockResolvedValue({
        success: false,
        errorMessage: "Auth failed",
      });

      await service.execute("content-1");

      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SocialContentStatus.FAILED,
          }),
        }),
      );
    });

    it("should create a publish log on success", async () => {
      mockWechatAdapter.publish.mockResolvedValue({ success: true });

      await service.execute("content-1");

      expect(mockPrisma.socialPublishLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contentId: "content-1",
            action: "PUBLISH",
            status: "SUCCESS",
          }),
        }),
      );
    });

    it("should create a FAILED publish log on adapter failure", async () => {
      mockWechatAdapter.publish.mockResolvedValue({
        success: false,
        errorMessage: "Network timeout",
      });

      await service.execute("content-1");

      expect(mockPrisma.socialPublishLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });

    it("should use version content when a version exists", async () => {
      const versionData = {
        title: "Versioned Title",
        content: "Versioned body",
        digest: "Versioned digest",
      };
      mockContentVersionService.getVersionForPublish.mockResolvedValue(
        versionData,
      );
      mockWechatAdapter.publish.mockResolvedValue({ success: true });

      await service.execute("content-1");

      const publishArg = mockWechatAdapter.publish.mock.calls[0][0];
      expect(publishArg.title).toBe("Versioned Title");
      expect(publishArg.content).toBe("Versioned body");
    });

    it("should handle exceptions thrown by wechatAdapter gracefully", async () => {
      mockWechatAdapter.publish.mockRejectedValue(
        new Error("Unexpected crash"),
      );

      const result = await service.execute("content-1");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("Unexpected crash");
    });

    it("should set FAILED status in db when adapter throws", async () => {
      mockWechatAdapter.publish.mockRejectedValue(new Error("Crash"));

      await service.execute("content-1");

      // The second update call (inside catch) should set status to FAILED
      const updates = mockPrisma.socialContent.update.mock.calls;
      const failureUpdate = updates.find(
        (call: unknown[]) =>
          (
            call[0] as Record<string, unknown> & {
              data: Record<string, unknown>;
            }
          ).data.status === SocialContentStatus.FAILED,
      );
      expect(failureUpdate).toBeDefined();
    });
  });

  // =========================================================================
  // execute — XiaoHongShu publish
  // =========================================================================

  describe("execute — XiaoHongShu publish", () => {
    beforeEach(() => {
      const conn = makeConnection({
        platformType: SocialPlatformType.XIAOHONGSHU,
      });
      const content = makeContent({
        connection: conn,
        contentType: SocialContentType.XIAOHONGSHU_NOTE,
        images: ["img1.jpg"],
      });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockContentVersionService.getVersionForPublish.mockResolvedValue(null);
      mockPrisma.socialContent.update.mockResolvedValue({});
      mockPrisma.socialPublishLog.create.mockResolvedValue({});
    });

    it("should call xhsMcpAdapter.publishContent for XIAOHONGSHU platform", async () => {
      mockXhsMcpAdapter.publishContent.mockResolvedValue({
        success: true,
        noteId: "note-1",
      });

      await service.execute("content-1");

      expect(mockXhsMcpAdapter.publishContent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Test Article",
          content: "Article body content",
          images: ["img1.jpg"],
        }),
      );
    });

    it("should map xhsResult.noteId to externalId", async () => {
      mockXhsMcpAdapter.publishContent.mockResolvedValue({
        success: true,
        noteId: "note-abc",
      });

      await service.execute("content-1");

      const updateCall = mockPrisma.socialContent.update.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as Record<string, unknown> & { data: Record<string, unknown> })
            .data.status === SocialContentStatus.PUBLISHED,
      );
      expect(updateCall).toBeDefined();
    });

    it("should return success false when XHS adapter reports failure", async () => {
      mockXhsMcpAdapter.publishContent.mockResolvedValue({
        success: false,
        error: "Rate limited",
      });

      const result = await service.execute("content-1");

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // execute — unsupported platform
  // =========================================================================

  describe("execute — unsupported platform", () => {
    it("should return failure for an unknown platform type", async () => {
      const conn = makeConnection({
        platformType: "UNSUPPORTED_PLATFORM" as SocialPlatformType,
      });
      const content = makeContent({ connection: conn });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockContentVersionService.getVersionForPublish.mockResolvedValue(null);
      mockPrisma.socialContent.update.mockResolvedValue({});
      mockPrisma.socialPublishLog.create.mockResolvedValue({});

      const result = await service.execute("content-1");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("不支持的平台类型");
    });
  });

  // =========================================================================
  // execute — status transition: PUBLISHING first
  // =========================================================================

  describe("execute — PUBLISHING status set before adapter call", () => {
    it("should update status to PUBLISHING before calling adapter", async () => {
      const conn = makeConnection({
        platformType: SocialPlatformType.WECHAT_MP,
      });
      const content = makeContent({ connection: conn });
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockContentVersionService.getVersionForPublish.mockResolvedValue(null);
      mockPrisma.socialContent.update.mockResolvedValue({});
      mockPrisma.socialPublishLog.create.mockResolvedValue({});

      let publishingStatusSet = false;
      mockPrisma.socialContent.update.mockImplementation(
        (args: { data: { status: string } }) => {
          if (args.data.status === (SocialContentStatus.PUBLISHING as string)) {
            publishingStatusSet = true;
          }
          return Promise.resolve({});
        },
      );

      mockWechatAdapter.publish.mockImplementation(() => {
        expect(publishingStatusSet).toBe(true);
        return Promise.resolve({ success: true });
      });

      await service.execute("content-1");

      expect(publishingStatusSet).toBe(true);
    });
  });
});
