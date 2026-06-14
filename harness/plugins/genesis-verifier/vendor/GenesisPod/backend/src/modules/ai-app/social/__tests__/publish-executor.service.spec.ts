/**
 * PublishExecutorService 单元测试
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PublishExecutorService } from "../mission/services/publish-executor.service";
import { SocialBrowserService } from "../mission/services/social-browser.service";
import { ContentVersionService } from "../mission/services/content-version.service";
import { WechatAdapter } from "../integrations/wechat/wechat.adapter";
import { XhsMcpAdapter } from "../integrations/xiaohongshu/xiaohongshu.adapter";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SocialContentStatus, SocialPlatformType } from "../mission/types";

// ==================== Mocks ====================

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

const mockPlaywright = {};
const mockContentVersionService = {
  getVersionForPublish: jest.fn(),
};
const mockWechatAdapter = {
  publish: jest.fn(),
};
const mockXhsMcpAdapter = {
  publishContent: jest.fn(),
};

// ==================== Test Data ====================

const baseContent = {
  id: "content-001",
  userId: "user-001",
  title: "测试标题",
  content: "测试内容文本",
  contentType: "WECHAT_ARTICLE",
  digest: "摘要",
  images: [],
  connectionId: "conn-001",
  status: SocialContentStatus.DRAFT,
  connection: null as unknown,
};

const baseConnection = {
  id: "conn-001",
  userId: "user-001",
  platformType: SocialPlatformType.WECHAT_MP,
  isActive: true,
  sessionData: "mcp-managed",
  lastCheckAt: new Date(),
};

// ==================== Tests ====================

describe("PublishExecutorService", () => {
  let service: PublishExecutorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mock return values
    mockPrisma.socialContent.update.mockResolvedValue({});
    mockPrisma.socialPublishLog.create.mockResolvedValue({});
    mockContentVersionService.getVersionForPublish.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublishExecutorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SocialBrowserService, useValue: mockPlaywright },
        { provide: ContentVersionService, useValue: mockContentVersionService },
        { provide: WechatAdapter, useValue: mockWechatAdapter },
        { provide: XhsMcpAdapter, useValue: mockXhsMcpAdapter },
      ],
    }).compile();

    service = module.get<PublishExecutorService>(PublishExecutorService);
  });

  // ==================== getPlaywright ====================

  describe("getPlaywright", () => {
    it("should return the playwright service", () => {
      expect(service.getPlaywright()).toBe(mockPlaywright);
    });
  });

  // ==================== execute - content not found ====================

  describe("execute - content not found", () => {
    it("should return failure when content does not exist", async () => {
      mockPrisma.socialContent.findUnique.mockResolvedValue(null);

      const result = await service.execute("non-existent-id");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("内容不存在");
    });
  });

  // ==================== execute - WECHAT_MP ====================

  describe("execute - WECHAT_MP with valid mcp-managed session", () => {
    it("should publish successfully via WechatAdapter", async () => {
      const content = {
        ...baseContent,
        connection: baseConnection,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockWechatAdapter.publish.mockResolvedValue({
        success: true,
        externalUrl: "https://mp.weixin.qq.com/s/test",
        externalId: "ext-001",
      });

      const result = await service.execute("content-001");

      expect(result.success).toBe(true);
      expect(result.externalUrl).toBe("https://mp.weixin.qq.com/s/test");
      expect(mockWechatAdapter.publish).toHaveBeenCalled();
      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SocialContentStatus.PUBLISHED,
          }),
        }),
      );
      expect(mockPrisma.socialPublishLog.create).toHaveBeenCalled();
    });

    it("should use version content when available", async () => {
      const content = {
        ...baseContent,
        connection: baseConnection,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockContentVersionService.getVersionForPublish.mockResolvedValue({
        title: "版本标题",
        content: "版本内容",
        digest: "版本摘要",
      });
      mockWechatAdapter.publish.mockResolvedValue({ success: true });

      await service.execute("content-001");

      const publishCall = mockWechatAdapter.publish.mock.calls[0][0];
      expect(publishCall.title).toBe("版本标题");
      expect(publishCall.content).toBe("版本内容");
    });

    it("should mark content as FAILED and log on publish failure", async () => {
      const content = {
        ...baseContent,
        connection: baseConnection,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockWechatAdapter.publish.mockResolvedValue({
        success: false,
        errorMessage: "微信接口错误",
      });

      const result = await service.execute("content-001");

      expect(result.success).toBe(false);
      expect(mockPrisma.socialContent.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SocialContentStatus.FAILED,
          }),
        }),
      );
    });
  });

  // ==================== execute - XIAOHONGSHU ====================

  describe("execute - XIAOHONGSHU", () => {
    it("should publish successfully via XhsMcpAdapter", async () => {
      const xhsConnection = {
        ...baseConnection,
        platformType: SocialPlatformType.XIAOHONGSHU,
      };
      const content = {
        ...baseContent,
        contentType: "XIAOHONGSHU_NOTE",
        connection: xhsConnection,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockXhsMcpAdapter.publishContent.mockResolvedValue({
        success: true,
        noteId: "xhs-note-001",
      });

      const result = await service.execute("content-001");

      expect(result.success).toBe(true);
      expect(result.externalId).toBe("xhs-note-001");
      expect(mockXhsMcpAdapter.publishContent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: baseContent.title,
          content: baseContent.content,
        }),
      );
    });

    it("should return failure when XHS adapter fails", async () => {
      const xhsConnection = {
        ...baseConnection,
        platformType: SocialPlatformType.XIAOHONGSHU,
      };
      const content = {
        ...baseContent,
        contentType: "XIAOHONGSHU_NOTE",
        connection: xhsConnection,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockXhsMcpAdapter.publishContent.mockResolvedValue({
        success: false,
        error: "小红书发布失败",
      });

      const result = await service.execute("content-001");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("小红书发布失败");
    });
  });

  // ==================== execute - unsupported platform ====================

  describe("execute - unsupported platform", () => {
    it("should return failure for unknown platform type", async () => {
      const unknownConnection = {
        ...baseConnection,
        platformType: "UNKNOWN_PLATFORM" as SocialPlatformType,
      };
      const content = {
        ...baseContent,
        connection: unknownConnection,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);

      const result = await service.execute("content-001");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("不支持的平台类型");
    });
  });

  // ==================== execute - fallback connection ====================

  describe("execute - fallback connection logic", () => {
    it("should return failure when no connection and no active connection found", async () => {
      const content = { ...baseContent, connection: null, connectionId: null };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      const result = await service.execute("content-001");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("未关联发布账号");
    });

    it("should return error when connection exists but session is invalid and no fallback", async () => {
      const invalidConn = {
        ...baseConnection,
        sessionData: null,
      };
      const content = { ...baseContent, connection: invalidConn };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(null);

      const result = await service.execute("content-001");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("会话已失效");
    });

    it("should use active fallback connection when content connection is invalid", async () => {
      const invalidConn = { ...baseConnection, sessionData: null };
      const content = {
        ...baseContent,
        connection: invalidConn,
        connectionId: "conn-001",
      };
      const activeConn = { ...baseConnection, id: "conn-002" };

      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockPrisma.socialPlatformConnection.findFirst.mockResolvedValue(
        activeConn,
      );
      mockWechatAdapter.publish.mockResolvedValue({ success: true });

      const result = await service.execute("content-001");
      expect(result.success).toBe(true);
      // Should have updated content's connectionId to the active connection
      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ connectionId: "conn-002" }),
        }),
      );
    });
  });

  // ==================== execute - exception handling ====================

  describe("execute - exception handling", () => {
    it("should catch exception, mark FAILED, log error, and return failure", async () => {
      const content = {
        ...baseContent,
        connection: baseConnection,
      };
      mockPrisma.socialContent.findUnique.mockResolvedValue(content);
      mockWechatAdapter.publish.mockRejectedValue(new Error("网络异常"));

      const result = await service.execute("content-001");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("网络异常");

      // Should have set status to FAILED
      expect(mockPrisma.socialContent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SocialContentStatus.FAILED,
            errorMessage: "网络异常",
          }),
        }),
      );
      // Should have created error log
      expect(mockPrisma.socialPublishLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        }),
      );
    });
  });
});
