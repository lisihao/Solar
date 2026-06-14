import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { NotificationDispatcher } from "../notification-dispatcher.service";
import { DispatcherQuotaService } from "../dispatcher-quota.service";
import { SiteChannel } from "../channels/site-channel.adapter";
import { ChannelResolver } from "../preferences/channel-resolver";
import { NotificationPreferenceService } from "../preferences/notification-preference.service";
import { NotificationService } from "../../notification.service";

// PR-DR2 P0-10 — dispatcher 现需 PrismaService 查 per-topic 退订
const prismaMock = {
  radarTopicSubscription: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
} as unknown as PrismaService;
import {
  ChannelCapabilities,
  DispatchPayload,
  INotificationChannel,
  NotificationChannel,
} from "../abstractions/notification-channel";

/**
 * PR-DR1a NotificationDispatcher 主路径单测
 *
 * 覆盖：
 * - fan-out 到多 channel + Promise.allSettled 不阻塞
 * - 单 channel send 抛错 → failed 但其他 channel 继续
 * - channelSubscriptions[type] 用户矩阵显式关掉 site → site skipped
 * - forceChannels 绕用户矩阵（不绕 isAvailable）
 * - excludeChannels 反向屏蔽
 * - 偏好查询失败（service.get 返回 null）→ 走默认策略
 * - dispatchMany 批量 fan-out
 */

const buildMockChannel = (
  type: NotificationChannel,
  opts: {
    available?: boolean;
    throwsOnSend?: boolean;
    capabilities?: Partial<ChannelCapabilities>;
  } = {},
): INotificationChannel & { sendCalls: number } => {
  const channel = {
    type,
    sendCalls: 0,
    async send(_userId: string, _payload: DispatchPayload) {
      this.sendCalls += 1;
      if (opts.throwsOnSend) throw new Error(`mock ${type} send fail`);
    },
    async isAvailable(_userId: string) {
      return opts.available ?? true;
    },
    getCapabilities(): ChannelCapabilities {
      return {
        requiresUserBinding: false,
        requiresGlobalConfig: false,
        dailyQuotaPerUser: 100,
        ...opts.capabilities,
      };
    },
  };
  return channel;
};

describe("NotificationDispatcher", () => {
  let dispatcher: NotificationDispatcher;
  let preferenceService: jest.Mocked<NotificationPreferenceService>;
  let resolver: ChannelResolver;
  let notificationServiceMock: jest.Mocked<NotificationService>;

  const userId = "user-uuid-1";
  const basePayload: DispatchPayload = {
    type: "RADAR_DAILY" as NotificationType,
    title: "今日 TOP 3",
    message: "NVIDIA Q1 财报超预期 / Jensen GTC keynote / ASIC 民主化",
    link: "/ai-radar/topic/abc?date=2026-05-18",
  };

  beforeEach(async () => {
    notificationServiceMock = {
      createNotification: jest.fn().mockResolvedValue({ id: "notif-1" }),
    } as unknown as jest.Mocked<NotificationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatcher,
        SiteChannel,
        ChannelResolver,
        {
          provide: NotificationPreferenceService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            getChannelSubscription: jest.fn().mockResolvedValue(null),
            isInQuietHours: jest.fn().mockResolvedValue(false),
          },
        },
        { provide: NotificationService, useValue: notificationServiceMock },
        // R2 安全：dailyQuotaPerUser enforce - mock 默认 always allowed
        {
          provide: DispatcherQuotaService,
          useValue: {
            check: jest.fn().mockImplementation(async (_u, _c, q: number) => ({
              allowed: true,
              remaining: q,
            })),
          },
        },
        // PR-DR2 P0-10 — per-topic 退订查询
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    dispatcher = module.get(NotificationDispatcher);
    preferenceService = module.get(NotificationPreferenceService);
    resolver = module.get(ChannelResolver);
    // siteChannel exposed for symmetry / future custom-injection scenarios
    void module.get(SiteChannel);
  });

  describe("register / getRegisteredChannels", () => {
    it("PR-DR1a 默认只注册 site", () => {
      expect(dispatcher.getRegisteredChannels()).toEqual(["site"]);
    });

    it("register() 允许后续 PR 注入 email/wechat", () => {
      dispatcher.register(buildMockChannel("email"));
      dispatcher.register(buildMockChannel("wechat"));
      expect(dispatcher.getRegisteredChannels().sort()).toEqual(
        ["email", "site", "wechat"].sort(),
      );
    });

    it("R1 pm P2 整改：重复 register 同 type 必须 warn（暴露静默覆盖问题）", () => {
      // 访问私有 log 实例做 spy
      const logger = (dispatcher as unknown as { log: { warn: jest.Mock } })
        .log;
      const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
      // 第一个 site 已在 beforeEach 注入；再次 register 触发 warn
      dispatcher.register(buildMockChannel("site"));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("register(site): overwriting existing channel"),
      );
      warnSpy.mockRestore();
    });
  });

  describe("dispatch() 主路径", () => {
    it("默认策略 RADAR_DAILY → email+site；PR-DR1a 未注册 email → 只走 site", async () => {
      const result = await dispatcher.dispatch(userId, basePayload);

      expect(result.delivered).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        channel: "site",
        status: "sent",
      });
      // 验真：复用既有 NotificationService.createNotification 被调
      expect(notificationServiceMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: "RADAR_DAILY",
          title: basePayload.title,
          message: basePayload.message,
          actionUrl: basePayload.link,
        }),
      );
    });

    it("用户 channelSubscriptions[type].site=false → site 不发", async () => {
      preferenceService.get.mockResolvedValueOnce({
        id: "pref-1",
        userId,
        emailEnabled: true,
        pushEnabled: true,
        soundEnabled: true,
        typeSettings: {},
        channelSubscriptions: {
          RADAR_DAILY: { site: false, email: true },
        },
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await dispatcher.dispatch(userId, basePayload);

      // 没注册 email，site 关 → 0 channel
      expect(result.results).toEqual([]);
      expect(result.delivered).toBe(false);
      expect(notificationServiceMock.createNotification).not.toHaveBeenCalled();
    });

    it("excludeChannels=['site'] 直接屏蔽 site", async () => {
      const result = await dispatcher.dispatch(userId, basePayload, {
        excludeChannels: ["site"],
      });
      expect(result.delivered).toBe(false);
      expect(notificationServiceMock.createNotification).not.toHaveBeenCalled();
    });

    it("forceChannels=['site'] 绕用户矩阵强发", async () => {
      preferenceService.get.mockResolvedValueOnce({
        id: "pref-1",
        userId,
        emailEnabled: false,
        pushEnabled: false,
        soundEnabled: false,
        typeSettings: {},
        channelSubscriptions: {
          RADAR_DAILY: { site: false }, // 用户明明关了
        },
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await dispatcher.dispatch(userId, basePayload, {
        forceChannels: ["site"],
      });

      expect(result.delivered).toBe(true);
      expect(notificationServiceMock.createNotification).toHaveBeenCalled();
    });

    it("single channel 抛错 → status=failed 但 delivered 看其他 channel", async () => {
      const failingSite = buildMockChannel("site", { throwsOnSend: true });
      const goodEmail = buildMockChannel("email");
      // 重建 dispatcher 自定义 channel 注入
      const tmpDispatcher = new NotificationDispatcher(
        failingSite as unknown as SiteChannel,
        preferenceService as unknown as NotificationPreferenceService,
        resolver,
        {
          check: jest.fn().mockResolvedValue({ allowed: true, remaining: 50 }),
        } as unknown as DispatcherQuotaService,
        prismaMock,
        goodEmail,
      );

      const result = await tmpDispatcher.dispatch(userId, basePayload);

      const failed = result.results.find((r) => r.channel === "site");
      const sent = result.results.find((r) => r.channel === "email");
      expect(failed?.status).toBe("failed");
      // R1 security P1：error 字段必须只是结构化标识，不能含原始 mock 错误消息
      expect(failed?.error).toBe("site-send-error");
      expect(failed?.error).not.toContain("mock site send fail");
      expect(sent?.status).toBe("sent");
      expect(result.delivered).toBe(true); // email 成功就算
    });

    it("R1 security 整改：sendSafe error 字段脱敏，不传播原始错误（防 SMTP/API 凭证泄漏）", async () => {
      const leakingSite = {
        type: "site" as const,
        async send() {
          throw new Error(
            "535 Authentication failed: user=admin@example.com password=hunter2",
          );
        },
        async isAvailable() {
          return true;
        },
        getCapabilities() {
          return {
            requiresUserBinding: false,
            requiresGlobalConfig: true,
            dailyQuotaPerUser: 50,
          };
        },
      };
      const tmpDispatcher = new NotificationDispatcher(
        leakingSite as unknown as SiteChannel,
        preferenceService as unknown as NotificationPreferenceService,
        resolver,
        {
          check: jest.fn().mockResolvedValue({ allowed: true, remaining: 50 }),
        } as unknown as DispatcherQuotaService,
        prismaMock,
      );
      const result = await tmpDispatcher.dispatch(userId, basePayload);
      const failed = result.results.find((r) => r.channel === "site");
      expect(failed?.status).toBe("failed");
      expect(failed?.error).toBe("site-send-error");
      expect(failed?.error).not.toMatch(/password|user=|hunter2/);
    });

    it("isAvailable 返回 false → 该 channel 直接跳，不调 send()", async () => {
      const unavailableSite = buildMockChannel("site", { available: false });
      const tmpDispatcher = new NotificationDispatcher(
        unavailableSite as unknown as SiteChannel,
        preferenceService as unknown as NotificationPreferenceService,
        resolver,
        {
          check: jest.fn().mockResolvedValue({ allowed: true, remaining: 200 }),
        } as unknown as DispatcherQuotaService,
        prismaMock,
      );

      const result = await tmpDispatcher.dispatch(userId, basePayload);
      expect(result.delivered).toBe(false);
      expect(unavailableSite.sendCalls).toBe(0);
    });

    it("preferenceService.get 失败返回 null → 走默认策略不抛", async () => {
      preferenceService.get.mockResolvedValueOnce(null);
      const result = await dispatcher.dispatch(userId, basePayload);
      expect(result.delivered).toBe(true); // 默认 RADAR_DAILY → site (email 未注册)
    });
  });

  describe("dispatchMany()", () => {
    it("批量 fan-out 同 payload 多 userId", async () => {
      const userIds = ["u1", "u2", "u3"];
      const results = await dispatcher.dispatchMany(userIds, basePayload);
      expect(results).toHaveLength(3);
      expect(notificationServiceMock.createNotification).toHaveBeenCalledTimes(
        3,
      );
    });
  });

  describe("RADAR_TIER3_INSTANT 默认策略（site + wechat，不走 email）", () => {
    it("PR-DR1a wechat 未注册 → 只走 site；email 默认就不走", async () => {
      const payload: DispatchPayload = {
        ...basePayload,
        type: "RADAR_TIER3_INSTANT" as NotificationType,
      };
      const result = await dispatcher.dispatch(userId, payload);
      expect(result.results).toEqual([
        expect.objectContaining({ channel: "site", status: "sent" }),
      ]);
    });

    it("excludeChannels=['email'] 即使 email 注册了也不走", async () => {
      const emailMock = buildMockChannel("email");
      dispatcher.register(emailMock);
      const payload: DispatchPayload = {
        ...basePayload,
        type: "RADAR_DAILY" as NotificationType,
      };
      const result = await dispatcher.dispatch(userId, payload, {
        excludeChannels: ["email"],
      });
      expect(emailMock.sendCalls).toBe(0);
      expect(
        result.results.some((r) => r.channel === "site" && r.status === "sent"),
      ).toBe(true);
    });
  });
});
