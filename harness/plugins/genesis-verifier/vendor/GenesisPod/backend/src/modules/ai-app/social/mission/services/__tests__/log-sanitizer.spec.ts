/**
 * Tests for log-sanitizer.ts
 */

import {
  sanitizeForLog,
  safeStringify,
  sanitizeResponseBody,
  redactToken,
  redactUrl,
} from "../log-sanitizer";

describe("log-sanitizer", () => {
  describe("sanitizeForLog", () => {
    it("should return null as-is", () => {
      expect(sanitizeForLog(null)).toBeNull();
    });

    it("should return undefined as-is", () => {
      expect(sanitizeForLog(undefined)).toBeUndefined();
    });

    it("should return numbers as-is", () => {
      expect(sanitizeForLog(42)).toBe(42);
    });

    it("should return booleans as-is", () => {
      expect(sanitizeForLog(true)).toBe(true);
    });

    it("should redact Bearer tokens in strings", () => {
      const result = sanitizeForLog("Authorization: Bearer abc123xyz");
      expect(result).toContain("[REDACTED]");
      expect(result).not.toContain("abc123xyz");
    });

    it("should redact JWT tokens in strings", () => {
      const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4";
      const result = sanitizeForLog(`token: ${jwt}`);
      expect(result).toContain("[REDACTED]");
    });

    it("should redact long hex strings", () => {
      const hexToken = "a".repeat(32); // 32+ hex chars
      const result = sanitizeForLog(`hash: ${hexToken}`);
      expect(result).toContain("[REDACTED]");
    });

    it("should redact sensitive fields in objects", () => {
      const obj = {
        username: "testuser",
        password: "secret123",
        token: "my-token",
        email: "test@example.com",
      };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      expect(result.username).toBe("testuser");
      expect(result.email).toBe("test@example.com");
      expect(result.password).toBe("[REDACTED]");
      expect(result.token).toBe("[REDACTED]");
    });

    it("should redact api_key field", () => {
      const obj = { api_key: "my-secret-key", data: "visible" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      expect(result.api_key).toBe("[REDACTED]");
      expect(result.data).toBe("visible");
    });

    it("should redact cookie field", () => {
      const obj = { cookie: "session=abc123", name: "test" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      expect(result.cookie).toBe("[REDACTED]");
      expect(result.name).toBe("test");
    });

    it("should handle nested objects", () => {
      const obj = {
        user: { name: "John", password: "secret" },
        publicData: "visible",
      };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      const user = result.user as Record<string, unknown>;
      expect(user.name).toBe("John");
      expect(user.password).toBe("[REDACTED]");
      expect(result.publicData).toBe("visible");
    });

    it("should handle arrays", () => {
      const arr = ["visible", "data"];
      const result = sanitizeForLog(arr);
      expect(result).toEqual(["visible", "data"]);
    });

    it("should handle arrays with sensitive objects", () => {
      const arr = [{ token: "secret" }, { name: "safe" }];
      const result = sanitizeForLog(arr) as Array<Record<string, unknown>>;
      expect(result[0].token).toBe("[REDACTED]");
      expect(result[1].name).toBe("safe");
    });

    it("should stop at max depth to prevent stack overflow", () => {
      // Create deeply nested object
      let obj: Record<string, unknown> = { value: "deep" };
      for (let i = 0; i < 12; i++) {
        obj = { nested: obj };
      }
      const result = sanitizeForLog(obj);
      expect(result).toBeDefined();
      // Should not throw
    });

    it("should handle case-insensitive field name matching", () => {
      const obj = { TOKEN: "secret", Password: "secret2" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      expect(result.TOKEN).toBe("[REDACTED]");
      expect(result.Password).toBe("[REDACTED]");
    });

    it("should redact data_ticket field", () => {
      const obj = { data_ticket: "ticket-value", status: "ok" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      expect(result.data_ticket).toBe("[REDACTED]");
    });

    it("should not redact non-sensitive non-string values", () => {
      const obj = { token: 12345, count: 10 }; // token is number, not string
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      // The check is "isSensitive && typeof value === 'string'", so numbers are not redacted
      expect(result.token).toBe(12345);
    });
  });

  describe("safeStringify", () => {
    it("should stringify and sanitize object", () => {
      const obj = { name: "John", password: "secret" };
      const result = safeStringify(obj);
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("John");
      expect(parsed.password).toBe("[REDACTED]");
    });

    it("should handle objects without throwing (sanitizeForLog handles depth)", () => {
      // sanitizeForLog stops at depth 10 and returns [MAX_DEPTH], so no circular ref error
      const obj: Record<string, unknown> = {};
      obj.self = obj; // circular reference - but sanitizeForLog breaks it at max depth
      const result = safeStringify(obj);
      // Either resolves with MAX_DEPTH markers or returns UNABLE_TO_STRINGIFY
      expect(typeof result).toBe("string");
    });

    it("should support space parameter for pretty printing", () => {
      const obj = { name: "John" };
      const result = safeStringify(obj, 2);
      expect(result).toContain("\n");
    });

    it("should handle null", () => {
      const result = safeStringify(null);
      expect(result).toBe("null");
    });
  });

  describe("sanitizeResponseBody", () => {
    it("should return string representation for non-objects", () => {
      expect(sanitizeResponseBody("some string")).toBe("some string");
      expect(sanitizeResponseBody(404)).toBe("404");
    });

    it("should extract only safe fields from response object", () => {
      const body = {
        ret: 0,
        errcode: 0,
        errmsg: "ok",
        token: "secret-token",
        password: "secret",
        status: "success",
        code: 200,
      };
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.ret).toBe(0);
      expect(parsed.errcode).toBe(0);
      expect(parsed.errmsg).toBe("ok");
      expect(parsed.status).toBe("success");
      expect(parsed.code).toBe(200);
      expect(parsed.token).toBeUndefined();
      expect(parsed.password).toBeUndefined();
    });

    it("should handle null body", () => {
      const result = sanitizeResponseBody(null);
      expect(result).toBe("null");
    });

    it("should extract fields from nested base_resp", () => {
      const body = {
        base_resp: {
          errcode: 0,
          errmsg: "ok",
        },
        token: "secret",
      };
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);
      expect(parsed["base_resp.errcode"]).toBe(0);
      expect(parsed["base_resp.errmsg"]).toBe("ok");
      expect(parsed.token).toBeUndefined();
    });

    it("should handle body with no safe fields", () => {
      const body = { sensitive_field: "value", another: "data" };
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);
      expect(Object.keys(parsed)).toHaveLength(0);
    });
  });

  describe("redactToken", () => {
    it("returns (empty) for null/undefined/empty", () => {
      expect(redactToken(null)).toBe("(empty)");
      expect(redactToken(undefined)).toBe("(empty)");
      expect(redactToken("")).toBe("(empty)");
    });

    it("never leaks any plaintext prefix of the token", () => {
      const out = redactToken("1234567890");
      expect(out.startsWith("***")).toBe(true);
      expect(out).not.toContain("1234");
      expect(out).not.toContain("123");
      expect(out).not.toContain("12");
    });

    it("same token always produces same redacted output (for log correlation)", () => {
      expect(redactToken("abc123")).toBe(redactToken("abc123"));
    });

    it("different tokens produce different redacted output", () => {
      expect(redactToken("token-a")).not.toBe(redactToken("token-b"));
    });

    it("output format is ***<8-hex>", () => {
      const out = redactToken("any-token");
      expect(out).toMatch(/^\*\*\*[0-9a-f]{8}$/);
    });
  });

  describe("redactUrl", () => {
    it("redacts token= query param", () => {
      expect(
        redactUrl("https://example.com/path?token=secret123&lang=zh"),
      ).toBe("https://example.com/path?token=[REDACTED]&lang=zh");
    });

    it("redacts access_token query param", () => {
      expect(redactUrl("https://api.x.com?access_token=abc&foo=bar")).toContain(
        "access_token=[REDACTED]",
      );
    });

    it("redacts ticket / data_ticket params", () => {
      expect(redactUrl("https://x.com?ticket=t&data_ticket=d")).toBe(
        "https://x.com?ticket=[REDACTED]&data_ticket=[REDACTED]",
      );
    });

    it("preserves non-sensitive params", () => {
      const out = redactUrl("https://x.com?lang=zh&token=secret&type=10");
      expect(out).toContain("lang=zh");
      expect(out).toContain("type=10");
      expect(out).toContain("token=[REDACTED]");
      expect(out).not.toContain("secret");
    });

    it("leaves URL without sensitive params unchanged", () => {
      expect(redactUrl("https://x.com?foo=bar")).toBe("https://x.com?foo=bar");
    });
  });
});
