import { Test } from "@nestjs/testing";
import { SocialPublishAdapter } from "../social-publish.adapter";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PublishExecutorService } from "../../mission/services/publish-executor.service";
import {
  SocialContentStatus,
  SocialContentType,
  SocialPlatformType,
} from "@prisma/client";

type PrismaMock = {
  socialContent: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  socialPlatformConnection: {
    findFirst: jest.Mock;
  };
};

function buildPrismaMock(): PrismaMock {
  return {
    socialContent: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    socialPlatformConnection: {
      findFirst: jest.fn(),
    },
  };
}

describe("SocialPublishAdapter", () => {
  let adapter: SocialPublishAdapter;
  let prisma: PrismaMock;
  let executor: { execute: jest.Mock };

  beforeEach(async () => {
    prisma = buildPrismaMock();
    executor = { execute: jest.fn().mockResolvedValue({ success: true }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SocialPublishAdapter,
        { provide: PrismaService, useValue: prisma },
        { provide: PublishExecutorService, useValue: executor },
      ],
    }).compile();

    adapter = moduleRef.get(SocialPublishAdapter);
  });

  describe("publishWechatMp", () => {
    it("creates SocialContent with PENDING status and fires executor", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: "conn-active",
      });
      // 故意让 prisma 返回与用户 input 不同的 id —— 证明 jobId 真的来自 DB
      prisma.socialContent.create.mockResolvedValue({
        id: "new-content-uuid",
      });

      const receipt = await adapter.publishWechatMp(
        {
          title: "T",
          content: "<p>b</p>",
          digest: "摘要",
          coverImageUrl: "https://x.com/cover.jpg",
          author: "Author",
        },
        { userId: "user-1", callerId: "agent-x" },
      );

      expect(receipt.jobId).toBe("new-content-uuid");
      expect(receipt.status).toBe("queued");
      expect(receipt.platform).toBe("wechat-mp");

      const createArgs = prisma.socialContent.create.mock.calls[0][0];
      expect(createArgs.data).toMatchObject({
        userId: "user-1",
        connectionId: "conn-active",
        contentType: SocialContentType.WECHAT_ARTICLE,
        status: SocialContentStatus.PENDING,
        title: "T",
        content: "<p>b</p>",
        digest: "摘要",
        coverImageUrl: "https://x.com/cover.jpg",
        author: "Author",
      });

      // fire-and-forget executor 必须被调用
      // 因为是 void，需要给 microtask 一次机会
      await Promise.resolve();
      expect(executor.execute).toHaveBeenCalledWith("new-content-uuid");
    });

    it("falls back to active connection when accountId not provided", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: "fallback-conn",
      });
      prisma.socialContent.create.mockResolvedValue({ id: "c1" });

      await adapter.publishWechatMp(
        { title: "T", content: "body" },
        { userId: "user-1" },
      );

      expect(prisma.socialPlatformConnection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-1",
            platformType: SocialPlatformType.WECHAT_MP,
            isActive: true,
          }),
        }),
      );
    });

    it("rejects accountId that does not belong to user (falls back to active)", async () => {
      // 第一次 findFirst（accountId 校验）返回 null
      // 第二次 findFirst（fallback）返回 active
      prisma.socialPlatformConnection.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "active-conn" });
      prisma.socialContent.create.mockResolvedValue({ id: "c1" });

      await adapter.publishWechatMp(
        { title: "T", content: "b", accountId: "spoofed-conn" },
        { userId: "user-1" },
      );

      const createArgs = prisma.socialContent.create.mock.calls[0][0];
      // 不是 spoofed-conn —— 校验生效
      expect(createArgs.data.connectionId).toBe("active-conn");
    });
  });

  describe("publishXhs", () => {
    it("persists images / tags / location and queues executor", async () => {
      prisma.socialPlatformConnection.findFirst.mockResolvedValue({
        id: "xhs-conn",
      });
      prisma.socialContent.create.mockResolvedValue({ id: "xhs-job-id" });

      const receipt = await adapter.publishXhs(
        {
          title: "AI 周记",
          content: "今天聊聊",
          images: ["https://x.com/1.jpg", "https://x.com/2.jpg"],
          tags: ["AI", "GenesisPod"],
          location: "杭州",
          atUsers: ["xiaoming"],
        },
        { userId: "user-2" },
      );

      expect(receipt.jobId).toBe("xhs-job-id");
      expect(receipt.platform).toBe("xhs");

      const createArgs = prisma.socialContent.create.mock.calls[0][0];
      expect(createArgs.data).toMatchObject({
        contentType: SocialContentType.XIAOHONGSHU_NOTE,
        title: "AI 周记",
        images: ["https://x.com/1.jpg", "https://x.com/2.jpg"],
        tags: ["AI", "GenesisPod"],
        location: "杭州",
      });
      // atUsers 在 aiProcessLog
      expect(createArgs.data.aiProcessLog).toMatchObject({
        atUsers: ["xiaoming"],
      });

      await Promise.resolve();
      expect(executor.execute).toHaveBeenCalledWith("xhs-job-id");
    });
  });

  describe("getPublishStatus", () => {
    it("returns null for missing job", async () => {
      prisma.socialContent.findFirst.mockResolvedValue(null);

      const snap = await adapter.getPublishStatus("missing", {
        userId: "u",
      });
      expect(snap).toBeNull();
      expect(prisma.socialContent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "missing", userId: "u" },
        }),
      );
    });

    it("maps PUBLISHED + WECHAT_ARTICLE → published + wechat-mp", async () => {
      const publishedAt = new Date("2026-05-15T10:00:00.000Z");
      prisma.socialContent.findFirst.mockResolvedValue({
        id: "j",
        contentType: SocialContentType.WECHAT_ARTICLE,
        status: SocialContentStatus.PUBLISHED,
        externalId: "wx-1",
        externalUrl: "https://mp.weixin.qq.com/s/x",
        errorMessage: null,
        publishedAt,
        updatedAt: publishedAt,
      });

      const snap = await adapter.getPublishStatus("j", { userId: "u" });

      expect(snap).toMatchObject({
        jobId: "j",
        status: "published",
        platform: "wechat-mp",
        externalUrl: "https://mp.weixin.qq.com/s/x",
        externalId: "wx-1",
        finishedAt: publishedAt,
      });
    });

    it("maps FAILED + XIAOHONGSHU_NOTE → failed + xhs", async () => {
      const updatedAt = new Date("2026-05-15T11:00:00.000Z");
      prisma.socialContent.findFirst.mockResolvedValue({
        id: "j2",
        contentType: SocialContentType.XIAOHONGSHU_NOTE,
        status: SocialContentStatus.FAILED,
        externalId: null,
        externalUrl: null,
        errorMessage: "登录已过期",
        publishedAt: null,
        updatedAt,
      });

      const snap = await adapter.getPublishStatus("j2", { userId: "u" });
      expect(snap).toMatchObject({
        status: "failed",
        platform: "xhs",
        errorMessage: "登录已过期",
        finishedAt: updatedAt,
      });
    });

    it("maps PUBLISHING → publishing (not finished yet)", async () => {
      prisma.socialContent.findFirst.mockResolvedValue({
        id: "j3",
        contentType: SocialContentType.WECHAT_ARTICLE,
        status: SocialContentStatus.PUBLISHING,
        externalId: null,
        externalUrl: null,
        errorMessage: null,
        publishedAt: null,
        updatedAt: new Date(),
      });
      const snap = await adapter.getPublishStatus("j3", { userId: "u" });
      expect(snap?.status).toBe("publishing");
      expect(snap?.finishedAt).toBeUndefined();
    });

    it("maps PENDING / DRAFT → queued", async () => {
      prisma.socialContent.findFirst.mockResolvedValue({
        id: "j4",
        contentType: SocialContentType.WECHAT_ARTICLE,
        status: SocialContentStatus.PENDING,
        externalId: null,
        externalUrl: null,
        errorMessage: null,
        publishedAt: null,
        updatedAt: new Date(),
      });
      const snap = await adapter.getPublishStatus("j4", { userId: "u" });
      expect(snap?.status).toBe("queued");
    });
  });
});
