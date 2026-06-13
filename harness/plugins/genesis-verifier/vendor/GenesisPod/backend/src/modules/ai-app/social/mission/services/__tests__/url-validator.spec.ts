/**
 * Tests for url-validator.ts
 */

import { BadRequestException } from "@nestjs/common";
import {
  validateUrl,
  isAllowedDomain,
  validateUrlStrict,
  validateContentLength,
  truncateContent,
  CONTENT_LIMITS,
} from "../url-validator";

describe("url-validator", () => {
  describe("validateUrl", () => {
    it("should accept valid http URL", () => {
      const result = validateUrl("http://example.com/path");
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe("example.com");
    });

    it("should accept valid https URL", () => {
      const result = validateUrl("https://example.com/path?query=1");
      expect(result).toBeInstanceOf(URL);
    });

    it("should throw for empty URL", () => {
      expect(() => validateUrl("")).toThrow(BadRequestException);
    });

    it("should throw for URL exceeding max length", () => {
      const longUrl = "https://example.com/" + "a".repeat(2048);
      expect(() => validateUrl(longUrl)).toThrow(BadRequestException);
    });

    it("should throw for invalid URL format", () => {
      expect(() => validateUrl("not-a-url")).toThrow(BadRequestException);
    });

    it("should throw for unsupported protocols", () => {
      expect(() => validateUrl("ftp://example.com")).toThrow(
        BadRequestException,
      );
      expect(() => validateUrl("file:///etc/passwd")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for localhost", () => {
      expect(() => validateUrl("http://localhost/api")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for 127.0.0.1", () => {
      expect(() => validateUrl("http://127.0.0.1/api")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for private IP 10.x.x.x", () => {
      expect(() => validateUrl("http://10.0.0.1/api")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for private IP 192.168.x.x", () => {
      expect(() => validateUrl("http://192.168.1.1/api")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for private IP 172.16.x.x", () => {
      expect(() => validateUrl("http://172.16.0.1/api")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for link-local address 169.254.x.x", () => {
      expect(() =>
        validateUrl("http://169.254.169.254/latest/meta-data"),
      ).toThrow(BadRequestException);
    });

    it("should throw for GCP metadata endpoint", () => {
      expect(() => validateUrl("http://metadata.google.internal/")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for non-standard ports", () => {
      expect(() => validateUrl("http://example.com:8080/api")).toThrow(
        BadRequestException,
      );
    });

    it("should allow standard port 80", () => {
      const result = validateUrl("http://example.com:80/api");
      expect(result).toBeInstanceOf(URL);
    });

    it("should allow standard port 443", () => {
      const result = validateUrl("https://example.com:443/api");
      expect(result).toBeInstanceOf(URL);
    });

    it("should throw for IPv6 addresses", () => {
      expect(() => validateUrl("http://[::1]/api")).toThrow(
        BadRequestException,
      );
    });

    it("should throw for 0.x.x.x addresses", () => {
      expect(() => validateUrl("http://0.0.0.0/")).toThrow(BadRequestException);
    });
  });

  describe("isAllowedDomain", () => {
    it("should return true for allowed domains", () => {
      expect(isAllowedDomain("https://youtube.com/watch?v=abc")).toBe(true);
      expect(isAllowedDomain("https://www.youtube.com/watch?v=abc")).toBe(true);
      expect(isAllowedDomain("https://github.com/user/repo")).toBe(true);
      expect(isAllowedDomain("https://medium.com/article")).toBe(true);
      expect(isAllowedDomain("https://zhihu.com/question/123")).toBe(true);
      expect(isAllowedDomain("https://bilibili.com/video/123")).toBe(true);
    });

    it("should return false for unlisted domains", () => {
      expect(isAllowedDomain("https://unknown-domain.com/page")).toBe(false);
      expect(isAllowedDomain("https://evil.com/")).toBe(false);
    });

    it("should return false for blocked URLs", () => {
      expect(isAllowedDomain("http://localhost/")).toBe(false);
      expect(isAllowedDomain("http://192.168.1.1/")).toBe(false);
    });

    it("should return false for invalid URLs", () => {
      expect(isAllowedDomain("not-a-url")).toBe(false);
    });

    it("should allow subdomains of allowed domains", () => {
      expect(isAllowedDomain("https://en.wikipedia.org/wiki/AI")).toBe(true);
      expect(isAllowedDomain("https://zh.wikipedia.org/wiki/AI")).toBe(true);
    });
  });

  describe("validateUrlStrict", () => {
    it("should return parsed URL for whitelisted domain", () => {
      const result = validateUrlStrict("https://github.com/user/repo");
      expect(result).toBeInstanceOf(URL);
    });

    it("should throw for valid URL not in whitelist", () => {
      expect(() =>
        validateUrlStrict("https://unknown-domain.com/page"),
      ).toThrow(BadRequestException);
    });

    it("should throw for blocked IPs even if they would match whitelist", () => {
      expect(() => validateUrlStrict("http://192.168.1.1/")).toThrow(
        BadRequestException,
      );
    });
  });

  describe("CONTENT_LIMITS", () => {
    it("should define title max length", () => {
      expect(CONTENT_LIMITS.TITLE_MAX_LENGTH).toBe(200);
    });

    it("should define digest max length", () => {
      expect(CONTENT_LIMITS.DIGEST_MAX_LENGTH).toBe(500);
    });

    it("should define content max lengths by platform", () => {
      expect(CONTENT_LIMITS.CONTENT_MAX_LENGTH.XIAOHONGSHU).toBe(1000);
      expect(CONTENT_LIMITS.CONTENT_MAX_LENGTH.WECHAT).toBe(50000);
      expect(CONTENT_LIMITS.CONTENT_MAX_LENGTH.TWITTER).toBe(280);
    });

    it("should define platform-specific title limits", () => {
      expect(CONTENT_LIMITS.TITLE_MAX_LENGTH_BY_PLATFORM.WECHAT).toBe(30);
      expect(CONTENT_LIMITS.TITLE_MAX_LENGTH_BY_PLATFORM.XIAOHONGSHU).toBe(20);
    });

    it("should define max tags", () => {
      expect(CONTENT_LIMITS.MAX_TAGS).toBe(20);
    });

    it("should define max images", () => {
      expect(CONTENT_LIMITS.MAX_IMAGES).toBe(9);
    });
  });

  describe("validateContentLength", () => {
    it("should not throw for content within default limit", () => {
      const content = "A".repeat(100);
      expect(() => validateContentLength(content)).not.toThrow();
    });

    it("should throw for content exceeding default limit", () => {
      const content = "A".repeat(20001);
      expect(() => validateContentLength(content)).toThrow(BadRequestException);
    });

    it("should throw for XIAOHONGSHU content exceeding 1000 chars", () => {
      const content = "A".repeat(1001);
      expect(() => validateContentLength(content, "XIAOHONGSHU")).toThrow(
        BadRequestException,
      );
    });

    it("should not throw for XIAOHONGSHU content within 1000 chars", () => {
      const content = "A".repeat(999);
      expect(() => validateContentLength(content, "XIAOHONGSHU")).not.toThrow();
    });

    it("should not throw for TWITTER content within 280 chars", () => {
      const content = "A".repeat(280);
      expect(() => validateContentLength(content, "TWITTER")).not.toThrow();
    });

    it("should throw for TWITTER content exceeding 280 chars", () => {
      const content = "A".repeat(281);
      expect(() => validateContentLength(content, "TWITTER")).toThrow(
        BadRequestException,
      );
    });

    it("should not throw for empty content", () => {
      expect(() => validateContentLength("")).not.toThrow();
      expect(() => validateContentLength(undefined as any)).not.toThrow();
    });
  });

  describe("truncateContent", () => {
    it("should not modify content within limit", () => {
      const content = "Hello World";
      const result = truncateContent(content);
      expect(result).toBe(content);
    });

    it("should truncate content exceeding default limit and append ...", () => {
      const content = "A".repeat(20001);
      const result = truncateContent(content);
      expect(result.length).toBe(20000);
      expect(result.endsWith("...")).toBe(true);
    });

    it("should truncate based on platform limit", () => {
      const content = "A".repeat(1001);
      const result = truncateContent(content, "XIAOHONGSHU");
      expect(result.length).toBe(1000);
      expect(result.endsWith("...")).toBe(true);
    });

    it("should use DEFAULT limit for unknown platform", () => {
      const content = "A".repeat(100);
      const result = truncateContent(content, "UNKNOWN_PLATFORM");
      expect(result).toBe(content);
    });

    it("should return content as-is when empty", () => {
      expect(truncateContent("")).toBe("");
    });
  });
});
