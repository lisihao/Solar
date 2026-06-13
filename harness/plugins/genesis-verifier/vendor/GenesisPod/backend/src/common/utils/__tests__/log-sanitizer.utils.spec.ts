/**
 * Log Sanitizer Utility Unit Tests
 *
 * Tests for sanitizeForLog, safeStringify, sanitizeResponseBody,
 * and sanitizeError — ensuring sensitive data is redacted before logging.
 */

import {
  sanitizeForLog,
  safeStringify,
  sanitizeResponseBody,
  sanitizeError,
} from "../log-sanitizer.utils";

describe("Log Sanitizer Utils", () => {
  // ========== sanitizeForLog ==========

  describe("sanitizeForLog", () => {
    // --- Primitives and null/undefined ---

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
      expect(sanitizeForLog(false)).toBe(false);
    });

    // --- Sensitive field redaction ---

    it("should redact 'token' field", () => {
      // Arrange
      const obj = { token: "my-secret-token" };

      // Act
      const result = sanitizeForLog(obj) as Record<string, unknown>;

      // Assert
      expect(result.token).toBe("[REDACTED]");
    });

    it("should redact 'password' field", () => {
      const result = sanitizeForLog({ password: "super-secret" }) as Record<
        string,
        unknown
      >;
      expect(result.password).toBe("[REDACTED]");
    });

    it("should redact 'authorization' field", () => {
      const result = sanitizeForLog({
        authorization: "Bearer abc123",
      }) as Record<string, unknown>;
      expect(result.authorization).toBe("[REDACTED]");
    });

    it("should redact 'api_key' field", () => {
      const result = sanitizeForLog({ api_key: "sk-xxx" }) as Record<
        string,
        unknown
      >;
      expect(result.api_key).toBe("[REDACTED]");
    });

    it("should redact 'secret' field", () => {
      const result = sanitizeForLog({ secret: "my-secret" }) as Record<
        string,
        unknown
      >;
      expect(result.secret).toBe("[REDACTED]");
    });

    it("should redact 'cookie' field", () => {
      const result = sanitizeForLog({ cookie: "session=abc" }) as Record<
        string,
        unknown
      >;
      expect(result.cookie).toBe("[REDACTED]");
    });

    it("should redact 'private_key' field", () => {
      const result = sanitizeForLog({
        private_key: "-----BEGIN RSA PRIVATE KEY-----",
      }) as Record<string, unknown>;
      expect(result.private_key).toBe("[REDACTED]");
    });

    it("should redact fields matching case-insensitively (uppercase key)", () => {
      // The field key comparison uses lowerKey.includes(field)
      const result = sanitizeForLog({ TOKEN: "abc" }) as Record<
        string,
        unknown
      >;
      expect(result.TOKEN).toBe("[REDACTED]");
    });

    it("should redact fields that contain sensitive substring (e.g. access_token)", () => {
      const result = sanitizeForLog({ access_token: "tok-abc" }) as Record<
        string,
        unknown
      >;
      expect(result.access_token).toBe("[REDACTED]");
    });

    it("should NOT redact non-sensitive string fields", () => {
      const result = sanitizeForLog({
        username: "john",
        email: "john@example.com",
        status: "active",
      }) as Record<string, unknown>;

      expect(result.username).toBe("john");
      expect(result.email).toBe("john@example.com");
      expect(result.status).toBe("active");
    });

    it("should NOT redact non-string sensitive field values", () => {
      // If the value is not a string, it is NOT redacted — it recursively sanitizes
      const result = sanitizeForLog({ token: 12345 }) as Record<
        string,
        unknown
      >;
      // 12345 is a number so it passes through recursively; numbers are returned as-is
      expect(result.token).toBe(12345);
    });

    // --- Nested objects ---

    it("should recursively sanitize nested objects", () => {
      const obj = {
        user: {
          name: "Alice",
          credentials: {
            password: "hunter2",
          },
        },
      };

      const result = sanitizeForLog(obj) as Record<string, unknown>;
      const user = result.user as Record<string, unknown>;
      const credentials = user.credentials as Record<string, unknown>;

      expect(user.name).toBe("Alice");
      expect(credentials.password).toBe("[REDACTED]");
    });

    // --- Arrays ---

    it("should recursively sanitize arrays", () => {
      const arr = [{ token: "abc" }, { name: "safe" }];
      const result = sanitizeForLog(arr) as Array<Record<string, unknown>>;

      expect(result[0].token).toBe("[REDACTED]");
      expect(result[1].name).toBe("safe");
    });

    it("should handle arrays of primitives", () => {
      const result = sanitizeForLog([1, 2, 3]);
      expect(result).toEqual([1, 2, 3]);
    });

    // --- Max depth guard ---

    it("should return [MAX_DEPTH] when depth exceeds 10", () => {
      // Arrange: build an object 12 levels deep (depth param >10 triggers the guard)
      // sanitizeForLog is called recursively with depth+1 each level
      // When depth > 10, returns "[MAX_DEPTH]"
      // So at call depth 11, the value returned is "[MAX_DEPTH]"
      // We need 11 nested wrappers so the innermost call receives depth=11
      let nested: Record<string, unknown> = { value: "leaf" };
      for (let i = 0; i < 11; i++) {
        nested = { child: nested };
      }

      // Act
      const result = sanitizeForLog(nested) as Record<string, unknown>;

      // Drill down 10 levels — the value at level 10's child should be [MAX_DEPTH]
      let current = result;
      for (let i = 0; i < 10; i++) {
        current = current.child as Record<string, unknown>;
      }
      expect(current.child).toBe("[MAX_DEPTH]");
    });

    // --- String pattern redaction ---

    it("should redact Bearer tokens in string values", () => {
      const result = sanitizeForLog("Authorization: Bearer my-token-123");
      expect(result).toBe("Authorization: [REDACTED]");
    });

    it("should redact JWT tokens in string values", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const result = sanitizeForLog(`token=${jwt}`);
      expect(result).toBe("token=[REDACTED]");
    });

    it("should redact PostgreSQL connection strings", () => {
      const result = sanitizeForLog("postgres://user:pass@localhost:5432/mydb");
      expect(result).toBe("[REDACTED]");
    });

    it("should redact Redis connection strings", () => {
      const result = sanitizeForLog("redis://default:password@redis.host:6379");
      expect(result).toBe("[REDACTED]");
    });

    it("should redact long hex strings (32+ chars)", () => {
      const hex = "a".repeat(32); // 32 hex chars
      const result = sanitizeForLog(hex);
      expect(result).toBe("[REDACTED]");
    });

    it("should NOT redact short hex strings (less than 32 chars)", () => {
      const hex = "abcdef1234567890"; // only 16 chars
      const result = sanitizeForLog(hex);
      // Short hex strings are not matched by the pattern (requires 32+)
      expect(result).toBe(hex);
    });
  });

  // ========== safeStringify ==========

  describe("safeStringify", () => {
    it("should stringify and sanitize an object", () => {
      // Arrange
      const obj = { username: "alice", password: "secret" };

      // Act
      const result = safeStringify(obj);
      const parsed = JSON.parse(result);

      // Assert
      expect(parsed.username).toBe("alice");
      expect(parsed.password).toBe("[REDACTED]");
    });

    it("should respect the space argument for pretty printing", () => {
      const obj = { name: "test" };
      const result = safeStringify(obj, 2);
      expect(result).toContain("\n");
      expect(result).toContain("  ");
    });

    it("should handle deeply circular references via the depth guard (returns stringified truncated output)", () => {
      // sanitizeForLog truncates at depth >10 with "[MAX_DEPTH]", so circular
      // references are broken before JSON.stringify is called — no throw occurs.
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // Act
      const result = safeStringify(circular);

      // Assert: depth guard kicks in, so the output is valid JSON (not [UNABLE_TO_STRINGIFY])
      expect(result).not.toBe("[UNABLE_TO_STRINGIFY]");
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should handle null input", () => {
      const result = safeStringify(null);
      expect(result).toBe("null");
    });

    it("should handle primitive values", () => {
      expect(safeStringify(42)).toBe("42");
      expect(safeStringify("hello")).toBe('"hello"');
      expect(safeStringify(true)).toBe("true");
    });

    it("should handle arrays", () => {
      const result = safeStringify([1, 2, 3]);
      expect(result).toBe("[1,2,3]");
    });
  });

  // ========== sanitizeResponseBody ==========

  describe("sanitizeResponseBody", () => {
    it("should extract only safe fields from response object", () => {
      // Arrange
      const body = {
        ret: 0,
        errcode: 0,
        errmsg: "ok",
        token: "should-not-appear",
        secret: "hidden",
        data: { sensitive: "info" },
      };

      // Act
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);

      // Assert
      expect(parsed.ret).toBe(0);
      expect(parsed.errcode).toBe(0);
      expect(parsed.errmsg).toBe("ok");
      expect(parsed.token).toBeUndefined();
      expect(parsed.secret).toBeUndefined();
      expect(parsed.data).toBeUndefined();
    });

    it("should extract 'status' and 'code' fields", () => {
      const body = { status: "success", code: 200, privateData: "hidden" };
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe("success");
      expect(parsed.code).toBe(200);
      expect(parsed.privateData).toBeUndefined();
    });

    it("should extract fields from nested base_resp", () => {
      // Arrange
      const body = {
        base_resp: {
          ret: 0,
          errmsg: "success",
          token: "hidden",
        },
        someField: "irrelevant",
      };

      // Act
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);

      // Assert
      expect(parsed["base_resp.ret"]).toBe(0);
      expect(parsed["base_resp.errmsg"]).toBe("success");
      expect(parsed["base_resp.token"]).toBeUndefined();
    });

    it("should convert non-object body to string", () => {
      expect(sanitizeResponseBody("plain text")).toBe("plain text");
      expect(sanitizeResponseBody(42)).toBe("42");
      expect(sanitizeResponseBody(null)).toBe("null");
    });

    it("should handle empty object", () => {
      const result = sanitizeResponseBody({});
      expect(result).toBe("{}");
    });

    it("should handle body with only non-safe fields", () => {
      const body = { token: "secret", password: "hidden" };
      const result = sanitizeResponseBody(body);
      expect(result).toBe("{}");
    });

    it("should handle missing base_resp gracefully", () => {
      const body = { ret: 1 };
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.ret).toBe(1);
    });

    it("should handle base_resp that is not an object", () => {
      const body = { base_resp: "not-an-object", ret: 0 };
      const result = sanitizeResponseBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.ret).toBe(0);
      // base_resp is not an object so the nested check is skipped
      expect(parsed["base_resp.ret"]).toBeUndefined();
    });
  });

  // ========== sanitizeError ==========

  describe("sanitizeError", () => {
    it("should sanitize Error object message", () => {
      const error = new Error(
        "Connection failed: postgres://user:pass@host/db",
      );
      const result = sanitizeError(error);
      expect(result).toContain("[REDACTED]");
      expect(result).not.toContain("postgres://user:pass@host/db");
    });

    it("should sanitize string error", () => {
      const result = sanitizeError("Bearer token-abc123 is invalid");
      expect(result).toContain("[REDACTED]");
    });

    it("should return [UNKNOWN_ERROR] for unknown error types", () => {
      expect(sanitizeError(42)).toBe("[UNKNOWN_ERROR]");
      expect(sanitizeError({})).toBe("[UNKNOWN_ERROR]");
      expect(sanitizeError(null)).toBe("[UNKNOWN_ERROR]");
      expect(sanitizeError(undefined)).toBe("[UNKNOWN_ERROR]");
    });

    it("should return clean message for safe error strings", () => {
      const error = new Error("Resource not found");
      const result = sanitizeError(error);
      expect(result).toBe("Resource not found");
    });

    it("should sanitize plain string with connection string", () => {
      const result = sanitizeError(
        "Failed to connect: redis://default:password@redis:6379",
      );
      expect(result).not.toContain("redis://");
      expect(result).toContain("[REDACTED]");
    });
  });
});
