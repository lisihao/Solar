/**
 * Tests for platforms.config.ts
 */

import {
  PLATFORM_CONFIGS,
  RATE_LIMIT_CONFIGS,
  WECHAT_REQUIRED_COOKIES,
  TIMEOUT_CONFIG,
  RETRY_CONFIG,
} from "../platforms.config";
import { SocialPlatformType } from "../../mission/types";

describe("platforms.config", () => {
  describe("PLATFORM_CONFIGS", () => {
    it("should define WECHAT_MP config", () => {
      const config = PLATFORM_CONFIGS[SocialPlatformType.WECHAT_MP];
      expect(config).toBeDefined();
      expect(config.type).toBe(SocialPlatformType.WECHAT_MP);
      expect(config.name).toBe("微信公众号");
      expect(config.supportsMcp).toBe(false);
      expect(config.loginUrl).toContain("weixin.qq.com");
    });

    it("should define XIAOHONGSHU config", () => {
      const config = PLATFORM_CONFIGS[SocialPlatformType.XIAOHONGSHU];
      expect(config).toBeDefined();
      expect(config.type).toBe(SocialPlatformType.XIAOHONGSHU);
      expect(config.name).toBe("小红书");
      expect(config.supportsMcp).toBe(true);
      expect(config.mcpServerId).toBe("xiaohongshu-mcp");
    });

    it("should have login success indicators for WECHAT_MP", () => {
      const config = PLATFORM_CONFIGS[SocialPlatformType.WECHAT_MP];
      expect(config.loginSuccessIndicators).toBeInstanceOf(Array);
      expect(config.loginSuccessIndicators.length).toBeGreaterThan(0);
    });

    it("should have login success indicators for XIAOHONGSHU", () => {
      const config = PLATFORM_CONFIGS[SocialPlatformType.XIAOHONGSHU];
      expect(config.loginSuccessIndicators).toBeInstanceOf(Array);
      expect(config.loginSuccessIndicators.length).toBeGreaterThan(0);
    });

    it("WECHAT_MP should not need click login", () => {
      expect(
        PLATFORM_CONFIGS[SocialPlatformType.WECHAT_MP].needClickLogin,
      ).toBe(false);
    });

    it("XIAOHONGSHU should need click login", () => {
      expect(
        PLATFORM_CONFIGS[SocialPlatformType.XIAOHONGSHU].needClickLogin,
      ).toBe(true);
    });
  });

  describe("RATE_LIMIT_CONFIGS", () => {
    it("should define WECHAT_MP rate limits", () => {
      const config = RATE_LIMIT_CONFIGS[SocialPlatformType.WECHAT_MP];
      expect(config).toBeDefined();
      expect(config.maxPerDay).toBe(1);
      expect(config.maxPerHour).toBe(1);
      expect(config.minIntervalMinutes).toBe(0);
      expect(config.cooldownAfterFailure).toBe(30);
    });

    it("should define XIAOHONGSHU rate limits", () => {
      const config = RATE_LIMIT_CONFIGS[SocialPlatformType.XIAOHONGSHU];
      expect(config).toBeDefined();
      expect(config.maxPerDay).toBe(3);
      expect(config.maxPerHour).toBe(1);
      expect(config.minIntervalMinutes).toBe(240);
      expect(config.cooldownAfterFailure).toBe(60);
    });
  });

  describe("WECHAT_REQUIRED_COOKIES", () => {
    it("should contain required cookie names", () => {
      expect(WECHAT_REQUIRED_COOKIES).toContain("slave_user");
      expect(WECHAT_REQUIRED_COOKIES).toContain("slave_sid");
      expect(WECHAT_REQUIRED_COOKIES).toContain("bizuin");
      expect(WECHAT_REQUIRED_COOKIES).toContain("data_bizuin");
      expect(WECHAT_REQUIRED_COOKIES).toContain("data_ticket");
    });
  });

  describe("TIMEOUT_CONFIG", () => {
    it("should define timeout values", () => {
      expect(TIMEOUT_CONFIG.loginWait).toBe(300000);
      expect(TIMEOUT_CONFIG.pageLoad).toBe(30000);
      expect(TIMEOUT_CONFIG.elementWait).toBe(10000);
      expect(TIMEOUT_CONFIG.apiResponse).toBe(15000);
      expect(TIMEOUT_CONFIG.publishComplete).toBe(60000);
    });
  });

  describe("RETRY_CONFIG", () => {
    it("should define retry configuration", () => {
      expect(RETRY_CONFIG.maxAttempts).toBe(3);
      expect(RETRY_CONFIG.initialDelay).toBe(5000);
      expect(RETRY_CONFIG.maxDelay).toBe(60000);
      expect(RETRY_CONFIG.backoffMultiplier).toBe(2);
    });
  });
});
