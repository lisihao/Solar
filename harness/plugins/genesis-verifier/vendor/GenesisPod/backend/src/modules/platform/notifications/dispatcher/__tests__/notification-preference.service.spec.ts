import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType } from "@prisma/client";
import { NotificationPreferenceService } from "../preferences/notification-preference.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("NotificationPreferenceService (PR-DR1a)", () => {
  let service: NotificationPreferenceService;
  let prisma: { notificationPreference: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      notificationPreference: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferenceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(NotificationPreferenceService);
  });

  describe("get()", () => {
    it("命中 → 返回 preference", async () => {
      const fake = { id: "p1", userId: "u1", channelSubscriptions: {} };
      prisma.notificationPreference.findUnique.mockResolvedValue(fake);
      expect(await service.get("u1")).toEqual(fake);
    });

    it("找不到 → null", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      expect(await service.get("u1")).toBeNull();
    });

    it("DB 抛错 → swallow + 返回 null（feedback_fallback_must_be_self_consistent）", async () => {
      prisma.notificationPreference.findUnique.mockRejectedValue(
        new Error("conn refused"),
      );
      expect(await service.get("u1")).toBeNull();
    });
  });

  describe("getChannelSubscription()", () => {
    it("无 preference → null（让 resolver 走默认）", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      expect(
        await service.getChannelSubscription(
          "u1",
          "RADAR_DAILY" as NotificationType,
          "site",
        ),
      ).toBeNull();
    });

    it("显式 true", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelSubscriptions: { RADAR_DAILY: { site: true } },
      });
      expect(
        await service.getChannelSubscription(
          "u1",
          "RADAR_DAILY" as NotificationType,
          "site",
        ),
      ).toBe(true);
    });

    it("显式 false", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelSubscriptions: { RADAR_DAILY: { site: false } },
      });
      expect(
        await service.getChannelSubscription(
          "u1",
          "RADAR_DAILY" as NotificationType,
          "site",
        ),
      ).toBe(false);
    });

    it("type 不在矩阵 → null", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelSubscriptions: { OTHER_TYPE: { site: true } },
      });
      expect(
        await service.getChannelSubscription(
          "u1",
          "RADAR_DAILY" as NotificationType,
          "site",
        ),
      ).toBeNull();
    });

    it("typeSubs 是脏数据（非 object） → null", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelSubscriptions: { RADAR_DAILY: "garbage" },
      });
      expect(
        await service.getChannelSubscription(
          "u1",
          "RADAR_DAILY" as NotificationType,
          "site",
        ),
      ).toBeNull();
    });
  });

  describe("updateChannelSubscriptions() merge 语义", () => {
    it("空原始 + 写一条 → 只含该条", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      await service.updateChannelSubscriptions("u1", {
        RADAR_DAILY: { site: true, email: false },
      });
      const args = prisma.notificationPreference.upsert.mock.calls[0]?.[0];
      expect(args.create.channelSubscriptions).toEqual({
        RADAR_DAILY: { site: true, email: false },
      });
    });

    it("原始有 A type + 写 B type → 两个都保留", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelSubscriptions: { RADAR_DAILY: { email: true } },
      });
      await service.updateChannelSubscriptions("u1", {
        RADAR_WEEKLY: { email: true },
      });
      const args = prisma.notificationPreference.upsert.mock.calls[0]?.[0];
      expect(args.update.channelSubscriptions).toEqual({
        RADAR_DAILY: { email: true },
        RADAR_WEEKLY: { email: true },
      });
    });

    it("原 RADAR_DAILY.email=true + 写 RADAR_DAILY.site=false → 同 type merge 两 channel", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        channelSubscriptions: { RADAR_DAILY: { email: true } },
      });
      await service.updateChannelSubscriptions("u1", {
        RADAR_DAILY: { site: false },
      });
      const args = prisma.notificationPreference.upsert.mock.calls[0]?.[0];
      expect(args.update.channelSubscriptions).toEqual({
        RADAR_DAILY: { email: true, site: false },
      });
    });
  });

  describe("isInQuietHours / timeInWindow", () => {
    const mk = (h: number, m: number) =>
      new Date(Date.UTC(2026, 4, 18, h, m, 0));

    it("无 quietHours → false", async () => {
      prisma.notificationPreference.findUnique.mockResolvedValue({
        quietHoursStart: null,
        quietHoursEnd: null,
      });
      expect(await service.isInQuietHours("u1")).toBe(false);
    });

    it("08:00-12:00, 现在 10:00 → in window", () => {
      expect(
        NotificationPreferenceService.timeInWindow(mk(10, 0), "08:00", "12:00"),
      ).toBe(true);
    });

    it("08:00-12:00, 现在 13:00 → out window", () => {
      expect(
        NotificationPreferenceService.timeInWindow(mk(13, 0), "08:00", "12:00"),
      ).toBe(false);
    });

    it("跨午夜 22:00-06:00, 现在 23:00 → in", () => {
      expect(
        NotificationPreferenceService.timeInWindow(mk(23, 0), "22:00", "06:00"),
      ).toBe(true);
    });

    it("跨午夜 22:00-06:00, 现在 05:00 → in", () => {
      expect(
        NotificationPreferenceService.timeInWindow(mk(5, 0), "22:00", "06:00"),
      ).toBe(true);
    });

    it("跨午夜 22:00-06:00, 现在 12:00 → out", () => {
      expect(
        NotificationPreferenceService.timeInWindow(mk(12, 0), "22:00", "06:00"),
      ).toBe(false);
    });

    it("非法 HH:mm → false（不抛）", () => {
      expect(
        NotificationPreferenceService.timeInWindow(
          mk(10, 0),
          "garbage",
          "06:00",
        ),
      ).toBe(false);
    });

    it("start === end → 视为关闭", () => {
      expect(
        NotificationPreferenceService.timeInWindow(mk(10, 0), "10:00", "10:00"),
      ).toBe(false);
    });
  });
});
