import { SessionHealthCheckScheduler } from "../session-health-check.scheduler";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../../../../../../common/prisma/prisma.service";
import type { NotificationService } from "../../../../platform/notifications/notification.service";
import type { SocialBrowserService } from "../social-browser.service";
import type { XhsMcpAdapter } from "../../../integrations/xiaohongshu/xiaohongshu.adapter";
import { SocialPlatformType } from "../../types";

// Mock session-crypto to avoid encryption issues in tests
jest.mock("../session-crypto", () => ({
  decryptSession: jest.fn().mockReturnValue({
    cookies: [],
    localStorage: {},
  }),
}));

function createMockConfigService(enabled = true) {
  return {
    get: jest.fn().mockReturnValue(enabled),
  } as unknown as jest.Mocked<ConfigService>;
}

function createMockPrisma() {
  return {
    socialPlatformConnection: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function createMockNotificationService() {
  return {
    createNotification: jest.fn().mockResolvedValue({}),
  } as unknown as jest.Mocked<NotificationService>;
}

function createMockPlaywright() {
  return {
    restoreSession: jest.fn().mockResolvedValue(undefined),
    createPage: jest.fn().mockResolvedValue({
      goto: jest.fn().mockResolvedValue(undefined),
      waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
      url: jest.fn().mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home"),
      $: jest.fn().mockResolvedValue(null),
    }),
    closeContext: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SocialBrowserService>;
}

function createMockXhsAdapter() {
  return {
    checkLoginStatus: jest.fn().mockResolvedValue({ loggedIn: true }),
  } as unknown as jest.Mocked<XhsMcpAdapter>;
}

function createScheduler(
  mockConfig: jest.Mocked<ConfigService>,
  mockPrisma: jest.Mocked<PrismaService>,
  mockNotification: jest.Mocked<NotificationService>,
  mockPlaywright: jest.Mocked<SocialBrowserService>,
  mockXhsAdapter: jest.Mocked<XhsMcpAdapter>,
) {
  return new SessionHealthCheckScheduler(
    mockConfig,
    mockPrisma as unknown as PrismaService,
    mockNotification as unknown as NotificationService,
    mockPlaywright as unknown as SocialBrowserService,
    mockXhsAdapter as unknown as XhsMcpAdapter,
  );
}

describe("SessionHealthCheckScheduler", () => {
  let mockConfig: jest.Mocked<ConfigService>;
  let mockPrisma: jest.Mocked<PrismaService>;
  let mockNotification: jest.Mocked<NotificationService>;
  let mockPlaywright: jest.Mocked<SocialBrowserService>;
  let mockXhsAdapter: jest.Mocked<XhsMcpAdapter>;

  beforeEach(() => {
    mockConfig = createMockConfigService(false); // disabled by default
    mockPrisma = createMockPrisma();
    mockNotification = createMockNotificationService();
    mockPlaywright = createMockPlaywright();
    mockXhsAdapter = createMockXhsAdapter();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("onModuleInit", () => {
    it("should not start scheduler when disabled", () => {
      jest.useFakeTimers();
      mockConfig.get.mockReturnValue(false);
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );

      scheduler.onModuleInit();

      // No interval should be set
      expect(
        mockPrisma.socialPlatformConnection.findMany,
      ).not.toHaveBeenCalled();
    });

    it("should start scheduler when enabled", () => {
      jest.useFakeTimers();
      mockConfig.get.mockReturnValue(true);
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );

      scheduler.onModuleInit();

      // After init, config should have been queried for the enabled flag
      expect(mockConfig.get).toHaveBeenCalledWith(
        "SESSION_HEALTH_CHECK_ENABLED",
        false, // default is now false (opt-in)
      );
    });

    it("default is OFF — scheduler does not start when SESSION_HEALTH_CHECK_ENABLED is not set", () => {
      jest.useFakeTimers();
      // Simulate ConfigService returning the default value (false)
      mockConfig.get.mockImplementation((key: string, def: unknown) => def);
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );

      const setIntSpy = jest.spyOn(global, "setInterval");

      scheduler.onModuleInit();

      // No interval should be armed when the default (false) is used
      expect(setIntSpy).not.toHaveBeenCalled();
      setIntSpy.mockRestore();
    });
  });

  describe("onModuleDestroy", () => {
    it("should clear interval on module destroy", () => {
      jest.useFakeTimers();
      mockConfig.get.mockReturnValue(true);
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      scheduler.onModuleInit();

      // Should not throw
      expect(() => scheduler.onModuleDestroy()).not.toThrow();
    });

    it("should be safe to call destroy without start", () => {
      jest.useFakeTimers();
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      expect(() => scheduler.onModuleDestroy()).not.toThrow();
    });
  });

  describe("checkAllSessions", () => {
    // Override sleep to resolve immediately by using fake timers and running them
    // checkAllSessions calls sleep(2000) between each connection check.
    // We use jest.useFakeTimers() and jest.runAllTimersAsync() to skip the delay.

    beforeEach(() => {
      jest.useFakeTimers();
    });

    // Helper to run checkAllSessions while advancing fake timers
    async function runCheckAllSessions(
      scheduler: SessionHealthCheckScheduler,
    ): Promise<void> {
      const checkPromise = scheduler.checkAllSessions();
      // Advance timers repeatedly to resolve all sleep() calls
      await jest.runAllTimersAsync();
      await checkPromise;
    }

    it("should do nothing if already running (concurrency guard)", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );

      // No connections so sleep is never called
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue([]);

      const firstCall = scheduler.checkAllSessions();
      const secondCall = scheduler.checkAllSessions();

      await jest.runAllTimersAsync();
      await Promise.all([firstCall, secondCall]);

      // findMany should only be called once (from first invocation)
      expect(
        mockPrisma.socialPlatformConnection.findMany,
      ).toHaveBeenCalledTimes(1);
    });

    it("should check all active connections", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue([]);

      await runCheckAllSessions(scheduler);

      expect(mockPrisma.socialPlatformConnection.findMany).toHaveBeenCalledWith(
        {
          where: { isActive: true },
          select: expect.objectContaining({
            id: true,
            userId: true,
            platformType: true,
          }),
        },
      );
    });

    it("should mark expired wechat sessions as inactive", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-1",
          userId: "user-1",
          platformType: SocialPlatformType.WECHAT_MP,
          accountName: "Test Account",
          sessionData: JSON.stringify({ cookies: [] }),
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );

      // Mock page that indicates login page (expired)
      const expiredPage = {
        goto: jest.fn().mockResolvedValue(undefined),
        waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
        url: jest
          .fn()
          .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/bizlogin"),
        $: jest.fn().mockResolvedValue(null),
      };
      mockPlaywright.createPage.mockResolvedValue(expiredPage as never);

      await runCheckAllSessions(scheduler);

      expect(mockPrisma.socialPlatformConnection.update).toHaveBeenCalledWith({
        where: { id: "conn-1" },
        data: expect.objectContaining({ isActive: false }),
      });
    });

    it("should send notification when session expires", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-2",
          userId: "user-2",
          platformType: SocialPlatformType.WECHAT_MP,
          accountName: "My MP Account",
          sessionData: JSON.stringify({ cookies: [] }),
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );

      const expiredPage = {
        goto: jest.fn().mockResolvedValue(undefined),
        waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
        url: jest
          .fn()
          .mockReturnValue(
            "https://mp.weixin.qq.com/cgi-bin/bizlogin?action=login",
          ),
        $: jest.fn().mockResolvedValue(null),
      };
      mockPlaywright.createPage.mockResolvedValue(expiredPage as never);

      await runCheckAllSessions(scheduler);

      expect(mockNotification.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-2",
          title: "平台连接已过期",
        }),
      );
    });

    it("should update lastCheckAt for valid connections", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-3",
          userId: "user-3",
          platformType: SocialPlatformType.WECHAT_MP,
          accountName: "Valid Account",
          sessionData: JSON.stringify({ cookies: [] }),
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );

      // Valid page (logged in)
      const validPage = {
        goto: jest.fn().mockResolvedValue(undefined),
        waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home"),
        $: jest.fn().mockResolvedValue(null),
      };
      mockPlaywright.createPage.mockResolvedValue(validPage as never);

      await runCheckAllSessions(scheduler);

      expect(mockPrisma.socialPlatformConnection.update).toHaveBeenCalledWith({
        where: { id: "conn-3" },
        data: { lastCheckAt: expect.any(Date) },
      });
    });

    it("should validate XHS MCP-managed connection via xhsMcpAdapter", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-xhs",
          userId: "user-xhs",
          platformType: SocialPlatformType.XIAOHONGSHU,
          accountName: "XHS Account",
          sessionData: "mcp-managed",
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );
      mockXhsAdapter.checkLoginStatus.mockResolvedValue({ loggedIn: true });

      await runCheckAllSessions(scheduler);

      expect(mockXhsAdapter.checkLoginStatus).toHaveBeenCalled();
      expect(mockPrisma.socialPlatformConnection.update).toHaveBeenCalledWith({
        where: { id: "conn-xhs" },
        data: { lastCheckAt: expect.any(Date) },
      });
    });

    it("should mark XHS connection as expired when MCP reports not logged in", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-xhs-expired",
          userId: "user-xhs",
          platformType: SocialPlatformType.XIAOHONGSHU,
          accountName: "XHS Account",
          sessionData: "mcp-managed",
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );
      mockXhsAdapter.checkLoginStatus.mockResolvedValue({ loggedIn: false });

      await runCheckAllSessions(scheduler);

      expect(mockPrisma.socialPlatformConnection.update).toHaveBeenCalledWith({
        where: { id: "conn-xhs-expired" },
        data: expect.objectContaining({ isActive: false }),
      });
    });

    it("should return false for connection with no session data", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-null",
          userId: "user-null",
          platformType: SocialPlatformType.WECHAT_MP,
          accountName: "Null Session",
          sessionData: null,
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );

      await runCheckAllSessions(scheduler);

      // Should mark as inactive due to null session
      expect(mockPrisma.socialPlatformConnection.update).toHaveBeenCalledWith({
        where: { id: "conn-null" },
        data: expect.objectContaining({ isActive: false }),
      });
    });

    it("should continue checking other connections when one fails", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-fail",
          userId: "user-fail",
          platformType: SocialPlatformType.WECHAT_MP,
          accountName: "Fail Account",
          sessionData: JSON.stringify({ cookies: [] }),
          lastCheckAt: new Date(),
        },
        {
          id: "conn-success",
          userId: "user-success",
          platformType: SocialPlatformType.WECHAT_MP,
          accountName: "Success Account",
          sessionData: JSON.stringify({ cookies: [] }),
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );

      mockPlaywright.createPage
        .mockRejectedValueOnce(new Error("Playwright crashed"))
        .mockResolvedValueOnce({
          goto: jest.fn().mockResolvedValue(undefined),
          waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
          url: jest
            .fn()
            .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/home"),
          $: jest.fn().mockResolvedValue(null),
        } as never);

      await runCheckAllSessions(scheduler);

      // Second connection should still be checked
      expect(mockPlaywright.createPage).toHaveBeenCalledTimes(2);
    });

    it("should handle database error in findMany gracefully", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      mockPrisma.socialPlatformConnection.findMany.mockRejectedValue(
        new Error("DB error"),
      );

      const checkPromise = scheduler.checkAllSessions();
      await jest.runAllTimersAsync();
      // Should not throw
      await expect(checkPromise).resolves.toBeUndefined();
    });

    it("should use platformType in notification when accountName is null", async () => {
      const scheduler = createScheduler(
        mockConfig,
        mockPrisma,
        mockNotification,
        mockPlaywright,
        mockXhsAdapter,
      );
      const connections = [
        {
          id: "conn-no-name",
          userId: "user-no-name",
          platformType: SocialPlatformType.WECHAT_MP,
          accountName: null,
          sessionData: JSON.stringify({ cookies: [] }),
          lastCheckAt: new Date(),
        },
      ];
      mockPrisma.socialPlatformConnection.findMany.mockResolvedValue(
        connections as never,
      );

      const expiredPage = {
        goto: jest.fn().mockResolvedValue(undefined),
        waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
        url: jest
          .fn()
          .mockReturnValue("https://mp.weixin.qq.com/cgi-bin/bizlogin"),
        $: jest.fn().mockResolvedValue(null),
      };
      mockPlaywright.createPage.mockResolvedValue(expiredPage as never);

      await runCheckAllSessions(scheduler);

      expect(mockNotification.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-no-name",
        }),
      );
    });
  });
});
