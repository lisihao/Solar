import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType } from "@prisma/client";
import { SiteChannel } from "../channels/site-channel.adapter";
import { NotificationService } from "../../notification.service";

describe("SiteChannel adapter (PR-DR1a)", () => {
  let channel: SiteChannel;
  let notificationService: jest.Mocked<NotificationService>;

  beforeEach(async () => {
    notificationService = {
      createNotification: jest.fn().mockResolvedValue({ id: "notif-1" }),
    } as unknown as jest.Mocked<NotificationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiteChannel,
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    channel = module.get(SiteChannel);
  });

  describe("type / capabilities", () => {
    it("type === 'site'", () => {
      expect(channel.type).toBe("site");
    });

    it("capabilities：无绑定 / 无全局配置 / 上限 200", () => {
      const cap = channel.getCapabilities();
      expect(cap).toEqual({
        requiresUserBinding: false,
        requiresGlobalConfig: false,
        dailyQuotaPerUser: 200,
      });
    });
  });

  describe("isAvailable", () => {
    it("总是返回 true（站内不需要绑定）", async () => {
      expect(await channel.isAvailable("any-uid")).toBe(true);
    });
  });

  describe("send", () => {
    it("调用既有 NotificationService.createNotification 落 DB", async () => {
      await channel.send("uid-1", {
        type: "RADAR_DAILY" as NotificationType,
        title: "今日 TOP 3",
        message: "...",
        link: "/ai-radar/topic/abc",
        metadata: { topicId: "abc" },
      });

      expect(notificationService.createNotification).toHaveBeenCalledWith({
        userId: "uid-1",
        type: "RADAR_DAILY",
        title: "今日 TOP 3",
        message: "...",
        actionUrl: "/ai-radar/topic/abc",
        metadata: { topicId: "abc" },
      });
    });

    it("payload 无 metadata → 传空对象给既有 service", async () => {
      await channel.send("uid-1", {
        type: "RADAR_DAILY" as NotificationType,
        title: "x",
        message: "y",
      });
      expect(notificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: {} }),
      );
    });

    it("既有 service throw → 透传给 dispatcher（不在 channel 内 swallow）", async () => {
      notificationService.createNotification.mockRejectedValueOnce(
        new Error("DB down"),
      );
      await expect(
        channel.send("uid-1", {
          type: "RADAR_DAILY" as NotificationType,
          title: "x",
          message: "y",
        }),
      ).rejects.toThrow("DB down");
    });
  });
});
