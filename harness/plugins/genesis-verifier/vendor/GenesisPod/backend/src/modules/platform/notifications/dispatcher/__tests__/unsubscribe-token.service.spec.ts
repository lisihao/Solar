import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { UnauthorizedException } from "@nestjs/common";
import { UnsubscribeTokenService } from "../preferences/unsubscribe-token.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("UnsubscribeTokenService (PR-DR1b / B17)", () => {
  let service: UnsubscribeTokenService;
  let jwt: JwtService;
  let prisma: {
    notificationPreference: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    radarTopicSubscription: {
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    // capture 最近一次 issue() 写入 DB 的 token，供 findUnique mock 返回
    // R2 安全：verifyAndApply DB 比对防重放，必须 mock token 持久化
    const tokenStore: { current: string | null } = { current: null };
    prisma = {
      notificationPreference: {
        upsert: jest
          .fn()
          .mockImplementation(
            (args: {
              create?: { unsubscribeToken?: string | null };
              update?: { unsubscribeToken?: string | null };
            }) => {
              const next =
                args.create?.unsubscribeToken ??
                args.update?.unsubscribeToken ??
                null;
              tokenStore.current = next;
              return Promise.resolve({});
            },
          ),
        findUnique: jest
          .fn()
          .mockImplementation(() => ({ unsubscribeToken: tokenStore.current })),
        update: jest.fn().mockImplementation(() => {
          tokenStore.current = null; // verifyAndApply 消费后置 null
          return Promise.resolve({});
        }),
      },
      radarTopicSubscription: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: "test-secret",
          signOptions: { expiresIn: "7d" },
        }),
      ],
      providers: [
        UnsubscribeTokenService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(UnsubscribeTokenService);
    jwt = module.get(JwtService);
  });

  describe("issue + verifyAndApply 闭环", () => {
    it("global scope → 签发 → 验证 → 关全部 channel", async () => {
      const token = await service.issue("user-1", "global");
      const result = await service.verifyAndApply(token);
      expect(result.scope).toBe("global");
      expect(result.userId).toBe("user-1");
      const args = prisma.notificationPreference.upsert.mock.calls.at(-1)?.[0];
      // global 应同时关 emailEnabled + pushEnabled + 全 RADAR channels
      expect(args.update.emailEnabled).toBe(false);
      expect(args.update.pushEnabled).toBe(false);
      expect(args.update.channelSubscriptions.RADAR_DAILY).toEqual({
        email: false,
        site: false,
        wechat: false,
        webpush: false,
      });
    });

    it("radar_all scope → 关所有 RADAR_* 但保留 emailEnabled", async () => {
      const token = await service.issue("user-1", "radar_all");
      await service.verifyAndApply(token);
      const args = prisma.notificationPreference.upsert.mock.calls.at(-1)?.[0];
      expect(args.update.emailEnabled).toBeUndefined();
      expect(args.update.channelSubscriptions.RADAR_DAILY).toEqual({
        email: false,
        site: false,
        wechat: false,
      });
      expect(args.update.channelSubscriptions.RADAR_WEEKLY).toEqual({
        email: false,
        site: false,
        wechat: false,
      });
    });

    it("weekly scope → 只关 RADAR_WEEKLY", async () => {
      const token = await service.issue("user-1", "weekly");
      await service.verifyAndApply(token);
      const args = prisma.notificationPreference.upsert.mock.calls.at(-1)?.[0];
      expect(args.update.channelSubscriptions.RADAR_WEEKLY).toEqual({
        email: false,
        site: false,
        wechat: false,
      });
      expect(args.update.channelSubscriptions.RADAR_DAILY).toBeUndefined();
    });

    it("topic scope → 需 topicId（payload 写入）", async () => {
      const token = await service.issue("user-1", "topic", {
        topicId: "tpc-1",
      });
      const result = await service.verifyAndApply(token);
      expect(result.ext?.topicId).toBe("tpc-1");
    });

    it("topic scope → upsert RadarTopicSubscription status=unsubscribed (per-topic, not broadcast)", async () => {
      const token = await service.issue("user-1", "topic", {
        topicId: "tpc-2",
      });
      await service.verifyAndApply(token);

      // 不应再调用 notificationPreference.upsert（第二次是 issue 写 token，第一次也是 issue）
      // 核心断言：radarTopicSubscription.upsert 被调用，且 status=unsubscribed
      const upsertCall =
        prisma.radarTopicSubscription.upsert.mock.calls.at(-1)?.[0];
      expect(upsertCall).toBeDefined();
      expect(upsertCall.where.userId_topicId).toEqual({
        userId: "user-1",
        topicId: "tpc-2",
      });
      expect(upsertCall.create.status).toBe("unsubscribed");
      expect(upsertCall.create.unsubscribedAt).toBeInstanceOf(Date);
      expect(upsertCall.update.status).toBe("unsubscribed");
      // 不应改动 channelSubscriptions（广播退订已删除）
      const npUpsertCalls = prisma.notificationPreference.upsert.mock.calls;
      const applyCalls = npUpsertCalls.filter(
        (call: unknown[]) =>
          (call[0] as { update?: { channelSubscriptions?: unknown } }).update
            ?.channelSubscriptions !== undefined,
      );
      expect(applyCalls).toHaveLength(0);
    });
  });

  describe("verifyAndApply 安全异常", () => {
    it("空 token → UnauthorizedException", async () => {
      await expect(service.verifyAndApply("")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("篡改 token → UnauthorizedException", async () => {
      await expect(service.verifyAndApply("not-a-real-jwt")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("过期 token → UnauthorizedException", async () => {
      const expired = await jwt.signAsync(
        { sub: "u1", scope: "global" },
        { expiresIn: "-1s" },
      );
      await expect(service.verifyAndApply(expired)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("缺 sub → UnauthorizedException", async () => {
      const bad = await jwt.signAsync({ scope: "global" });
      await expect(service.verifyAndApply(bad)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("topic scope 缺 topicId → UnauthorizedException", async () => {
      // 直接构造 payload 跳过 issue 验证
      const bad = await jwt.signAsync({ sub: "u1", scope: "topic" });
      await expect(service.verifyAndApply(bad)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("issue 持久化", () => {
    it("签发后写入 NotificationPreference.unsubscribeToken", async () => {
      const token = await service.issue("user-1", "weekly");
      const args = prisma.notificationPreference.upsert.mock.calls.at(-1)?.[0];
      expect(args.where.userId).toBe("user-1");
      expect(args.create.unsubscribeToken).toBe(token);
    });
  });
});
