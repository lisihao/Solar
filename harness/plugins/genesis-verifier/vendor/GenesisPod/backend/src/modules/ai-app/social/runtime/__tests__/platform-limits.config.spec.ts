/**
 * Tests for platform-limits.config.ts
 */

import {
  PLATFORM_LIMITS,
  getPlatformLimits,
  checkContentLimits,
} from "../platform-limits.config";
import { SocialPlatformType } from "../../mission/types";

describe("platform-limits.config", () => {
  describe("PLATFORM_LIMITS", () => {
    it("should define limits for WECHAT_MP", () => {
      expect(PLATFORM_LIMITS[SocialPlatformType.WECHAT_MP]).toBeDefined();
      expect(PLATFORM_LIMITS[SocialPlatformType.WECHAT_MP].maxTitle).toBe(30);
      expect(PLATFORM_LIMITS[SocialPlatformType.WECHAT_MP].maxDigest).toBe(120);
      expect(PLATFORM_LIMITS[SocialPlatformType.WECHAT_MP].maxContent).toBe(0);
    });

    it("should define limits for XIAOHONGSHU", () => {
      expect(PLATFORM_LIMITS[SocialPlatformType.XIAOHONGSHU]).toBeDefined();
      expect(PLATFORM_LIMITS[SocialPlatformType.XIAOHONGSHU].maxTitle).toBe(20);
      expect(PLATFORM_LIMITS[SocialPlatformType.XIAOHONGSHU].maxDigest).toBe(0);
      expect(PLATFORM_LIMITS[SocialPlatformType.XIAOHONGSHU].maxContent).toBe(
        1000,
      );
    });
  });

  describe("getPlatformLimits", () => {
    it("should return WECHAT_MP limits", () => {
      const limits = getPlatformLimits(SocialPlatformType.WECHAT_MP);
      expect(limits.maxTitle).toBe(30);
      expect(limits.maxDigest).toBe(120);
      expect(limits.maxContent).toBe(0);
    });

    it("should return XIAOHONGSHU limits", () => {
      const limits = getPlatformLimits(SocialPlatformType.XIAOHONGSHU);
      expect(limits.maxTitle).toBe(20);
      expect(limits.maxDigest).toBe(0);
      expect(limits.maxContent).toBe(1000);
    });
  });

  describe("checkContentLimits", () => {
    it("should return valid for content within limits", () => {
      const result = checkContentLimits(SocialPlatformType.WECHAT_MP, {
        title: "Short Title",
        digest: "Short Digest",
        content: "Short Content",
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return error for title exceeding WECHAT_MP limit", () => {
      const longTitle = "A".repeat(31);
      const result = checkContentLimits(SocialPlatformType.WECHAT_MP, {
        title: longTitle,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("标题超出限制");
    });

    it("should return error for digest exceeding WECHAT_MP limit", () => {
      const longDigest = "A".repeat(121);
      const result = checkContentLimits(SocialPlatformType.WECHAT_MP, {
        digest: longDigest,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("摘要超出限制");
    });

    it("should not check digest for XIAOHONGSHU (not supported)", () => {
      const result = checkContentLimits(SocialPlatformType.XIAOHONGSHU, {
        digest: "A".repeat(200),
      });
      // XIAOHONGSHU maxDigest is 0, so digest check is skipped
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should return error for content exceeding XIAOHONGSHU limit", () => {
      const longContent = "A".repeat(1001);
      const result = checkContentLimits(SocialPlatformType.XIAOHONGSHU, {
        content: longContent,
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("正文超出限制");
    });

    it("should not check content for WECHAT_MP (unlimited)", () => {
      const longContent = "A".repeat(100000);
      const result = checkContentLimits(SocialPlatformType.WECHAT_MP, {
        content: longContent,
      });
      // WECHAT_MP maxContent is 0 (unlimited), so no error
      expect(result.valid).toBe(true);
    });

    it("should return multiple errors when multiple fields exceed limits", () => {
      const result = checkContentLimits(SocialPlatformType.XIAOHONGSHU, {
        title: "A".repeat(21),
        content: "A".repeat(1001),
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it("should handle empty content object", () => {
      const result = checkContentLimits(SocialPlatformType.WECHAT_MP, {});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should handle exactly at limit boundary", () => {
      const exactTitle = "A".repeat(30); // exactly at WECHAT_MP limit
      const result = checkContentLimits(SocialPlatformType.WECHAT_MP, {
        title: exactTitle,
      });
      expect(result.valid).toBe(true);
    });
  });
});
