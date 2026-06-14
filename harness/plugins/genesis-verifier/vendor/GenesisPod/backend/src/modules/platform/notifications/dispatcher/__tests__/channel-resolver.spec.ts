import { NotificationPreference, NotificationType } from "@prisma/client";
import { ChannelResolver } from "../preferences/channel-resolver";
import {
  ChannelCapabilities,
  INotificationChannel,
  NotificationChannel,
} from "../abstractions/notification-channel";

const stubChannel = (
  type: NotificationChannel,
  available = true,
): INotificationChannel => ({
  type,
  async send() {},
  async isAvailable() {
    return available;
  },
  getCapabilities(): ChannelCapabilities {
    return {
      requiresUserBinding: false,
      requiresGlobalConfig: false,
      dailyQuotaPerUser: 100,
    };
  },
});

const mkPref = (
  channelSubs: Record<string, unknown>,
): NotificationPreference => ({
  id: "p1",
  userId: "u1",
  emailEnabled: true,
  pushEnabled: true,
  soundEnabled: true,
  typeSettings: {},
  channelSubscriptions:
    channelSubs as unknown as NotificationPreference["channelSubscriptions"],
  quietHoursStart: null,
  quietHoursEnd: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("ChannelResolver", () => {
  let resolver: ChannelResolver;
  let channels: Map<NotificationChannel, INotificationChannel>;

  beforeEach(() => {
    resolver = new ChannelResolver();
    channels = new Map();
    channels.set("site", stubChannel("site"));
    channels.set("email", stubChannel("email"));
    channels.set("wechat", stubChannel("wechat"));
  });

  describe("默认策略 defaultForType", () => {
    it.each([
      ["RADAR_DAILY", ["email", "site"]],
      ["RADAR_WEEKLY", ["email", "site"]],
      ["RADAR_TIER3_INSTANT", ["site", "wechat"]],
      ["RADAR_SOURCE_AUTO_DISABLED", ["email", "site"]],
      ["RADAR_MISSION_COMPLETE", ["site"]],
      ["MISSION_COMPLETED", ["site"]],
      // e2e P0-#5: 失败必须 email（用户关了 UI 也要知道），区别于完成的 site-only
      ["MISSION_FAILED", ["email", "site"]],
      ["FEEDBACK_REPLIED", ["email", "site"]],
      ["KEY_REQUEST_SUBMITTED", ["email", "site"]],
      ["SYSTEM", ["site"]],
    ])("type=%s → %j", (type, expected) => {
      expect(ChannelResolver.defaultForType(type as NotificationType)).toEqual(
        expected,
      );
    });
  });

  describe("resolve() 矩阵 + 默认 + isAvailable", () => {
    it("无偏好 + RADAR_DAILY → email+site（默认策略 + 全部 available）", async () => {
      const out = await resolver.resolve(
        "u1",
        "RADAR_DAILY" as NotificationType,
        channels,
        null,
      );
      expect(out.sort()).toEqual(["email", "site"].sort());
    });

    it("用户矩阵明示 RADAR_DAILY.email=true site=false → 只走 email", async () => {
      const pref = mkPref({
        RADAR_DAILY: { email: true, site: false },
      });
      const out = await resolver.resolve(
        "u1",
        "RADAR_DAILY" as NotificationType,
        channels,
        pref,
      );
      expect(out).toEqual(["email"]);
    });

    it("用户矩阵明示空对象 → 无显式 channel → 0 个 target", async () => {
      const pref = mkPref({
        RADAR_DAILY: {},
      });
      const out = await resolver.resolve(
        "u1",
        "RADAR_DAILY" as NotificationType,
        channels,
        pref,
      );
      expect(out).toEqual([]);
    });

    it("forceChannels 优先，绕用户矩阵", async () => {
      const pref = mkPref({
        RADAR_DAILY: { email: false, site: false, wechat: false },
      });
      const out = await resolver.resolve(
        "u1",
        "RADAR_DAILY" as NotificationType,
        channels,
        pref,
        { forceChannels: ["wechat"] },
      );
      expect(out).toEqual(["wechat"]);
    });

    it("forceChannels 仍受 isAvailable 约束", async () => {
      channels.set("wechat", stubChannel("wechat", false)); // 未绑定
      const out = await resolver.resolve(
        "u1",
        "RADAR_DAILY" as NotificationType,
        channels,
        null,
        { forceChannels: ["wechat"] },
      );
      expect(out).toEqual([]);
    });

    it("excludeChannels 反向屏蔽", async () => {
      const out = await resolver.resolve(
        "u1",
        "RADAR_DAILY" as NotificationType,
        channels,
        null,
        { excludeChannels: ["email"] },
      );
      expect(out).toEqual(["site"]);
    });

    it("excludeChannels 与 forceChannels 同时存在 → exclude 优先", async () => {
      const out = await resolver.resolve(
        "u1",
        "RADAR_TIER3_INSTANT" as NotificationType,
        channels,
        null,
        { forceChannels: ["email", "site"], excludeChannels: ["email"] },
      );
      expect(out).toEqual(["site"]);
    });

    it("未注册 channel（PR-DR1a wechat 不存在）静默跳", async () => {
      const partial = new Map<NotificationChannel, INotificationChannel>();
      partial.set("site", stubChannel("site"));
      const out = await resolver.resolve(
        "u1",
        "RADAR_TIER3_INSTANT" as NotificationType, // 默认 site+wechat
        partial,
        null,
      );
      expect(out).toEqual(["site"]);
    });

    it("isAvailable throw → 当作 unavailable + log warn 不传播", async () => {
      const throwing: INotificationChannel = {
        type: "wechat",
        async send() {},
        async isAvailable() {
          throw new Error("simulated isAvailable crash");
        },
        getCapabilities() {
          return {
            requiresUserBinding: true,
            requiresGlobalConfig: false,
            dailyQuotaPerUser: 5,
          };
        },
      };
      const partial = new Map<NotificationChannel, INotificationChannel>();
      partial.set("site", stubChannel("site"));
      partial.set("wechat", throwing);
      const out = await resolver.resolve(
        "u1",
        "RADAR_TIER3_INSTANT" as NotificationType,
        partial,
        null,
      );
      expect(out).toEqual(["site"]);
    });
  });

  describe("resolveMatrix() 直读", () => {
    it("typeSubs 不是 object → fallback 默认策略", () => {
      const pref = mkPref({ RADAR_DAILY: "garbage" }); // 数据脏
      const out = resolver.resolveMatrix(
        "RADAR_DAILY" as NotificationType,
        pref,
      );
      // 脏数据走默认（email + site）
      expect(out.sort()).toEqual(["email", "site"].sort());
    });

    it("preference 为 null → 走默认", () => {
      const out = resolver.resolveMatrix(
        "RADAR_DAILY" as NotificationType,
        null,
      );
      expect(out.sort()).toEqual(["email", "site"].sort());
    });
  });
});
