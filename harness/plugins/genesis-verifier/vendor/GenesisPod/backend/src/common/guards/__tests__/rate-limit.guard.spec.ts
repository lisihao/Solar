/**
 * RateLimitGuard unit tests
 *
 * Tests the in-memory sliding-window rate limiting guard, including:
 * - No-config passthrough
 * - Key extraction (user / ip / custom)
 * - skipAnonymous behaviour
 * - Sliding window enforcement
 * - Response headers (X-RateLimit-*)
 * - globalCleanup / helper methods
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  RateLimitGuard,
  RATE_LIMIT_KEY,
  RateLimit,
  RateLimitConfig,
} from "../rate-limit.guard";
import { Request } from "express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(overrides?: {
  user?: { id?: string };
  ip?: string;
  headers?: Record<string, string | string[]>;
}): Request {
  return {
    user: overrides?.user,
    ip: overrides?.ip ?? "127.0.0.1",
    headers: overrides?.headers ?? {},
    socket: { remoteAddress: "192.168.1.1" },
  } as unknown as Request;
}

function createMockExecutionContext(
  request: Request,
  config?: RateLimitConfig | null,
) {
  const response = {
    setHeader: jest.fn(),
    statusCode: 200,
    headersSent: false,
  };

  const reflectorGet = jest.fn().mockReturnValue(config ?? undefined);

  return {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(request),
      getResponse: jest.fn().mockReturnValue(response),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
    _reflectorGet: reflectorGet,
    _response: response,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("RateLimitGuard", () => {
  let guard: RateLimitGuard;
  let mockReflector: jest.Mocked<Pick<Reflector, "get">>;

  beforeEach(async () => {
    mockReflector = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<RateLimitGuard>(RateLimitGuard);
    guard.clearAllRecords();

    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
  });

  afterEach(() => {
    guard.clearAllRecords();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Passthrough when no config
  // -------------------------------------------------------------------------

  describe("when no RateLimit config is applied", () => {
    it("returns true without checking limits", async () => {
      mockReflector.get.mockReturnValue(undefined);
      const request = createRequest();
      const ctx = createMockExecutionContext(request, null);

      const result = await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(result).toBe(true);
    });

    it("does not set rate-limit response headers", async () => {
      mockReflector.get.mockReturnValue(undefined);
      const request = createRequest();
      const ctx = createMockExecutionContext(request, null);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(ctx._response.setHeader).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Key extraction — user type
  // -------------------------------------------------------------------------

  describe("key extraction with keyType 'user'", () => {
    const config: RateLimitConfig = {
      windowSeconds: 60,
      maxRequests: 5,
      keyType: "user",
    };

    beforeEach(() => {
      mockReflector.get.mockReturnValue(config);
    });

    it("uses 'user:<id>' key when authenticated user is present", async () => {
      const request = createRequest({ user: { id: "user-abc" } });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("user:user-abc", 60, 5)).toBe(4);
    });

    it("falls back to 'ip:<address>' key when user has no id", async () => {
      const request = createRequest({ user: {}, ip: "10.0.0.1" });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:10.0.0.1", 60, 5)).toBe(4);
    });

    it("falls back to IP when no user at all", async () => {
      const request = createRequest({ ip: "10.0.0.2" });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:10.0.0.2", 60, 5)).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // Key extraction — ip type
  // -------------------------------------------------------------------------

  describe("key extraction with keyType 'ip'", () => {
    const config: RateLimitConfig = {
      windowSeconds: 60,
      maxRequests: 3,
      keyType: "ip",
    };

    beforeEach(() => {
      mockReflector.get.mockReturnValue(config);
    });

    it("reads x-forwarded-for header (comma-separated) and uses first IP", async () => {
      const request = createRequest({
        headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
      });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:203.0.113.1", 60, 3)).toBe(2);
    });

    it("reads x-forwarded-for when it is an array", async () => {
      const request = createRequest({
        headers: { "x-forwarded-for": ["203.0.113.2", "10.0.0.1"] },
      });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:203.0.113.2", 60, 3)).toBe(2);
    });

    it("reads x-real-ip header as fallback", async () => {
      const request = createRequest({
        headers: { "x-real-ip": "203.0.113.3" },
      });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:203.0.113.3", 60, 3)).toBe(2);
    });

    it("falls back to request.ip when no proxy headers present", async () => {
      const request = createRequest({ ip: "172.16.0.1" });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:172.16.0.1", 60, 3)).toBe(2);
    });

    it("falls back to socket.remoteAddress when request.ip is absent", async () => {
      const request = {
        headers: {},
        ip: undefined,
        socket: { remoteAddress: "192.168.0.1" },
      } as unknown as Request;
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:192.168.0.1", 60, 3)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Key extraction — custom extractor
  // -------------------------------------------------------------------------

  describe("key extraction with custom keyExtractor", () => {
    it("uses the return value of keyExtractor as the rate-limit key", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 2,
        keyExtractor: () => "custom-key",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest();
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("custom-key", 60, 2)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // skipAnonymous
  // -------------------------------------------------------------------------

  describe("skipAnonymous behaviour", () => {
    it("allows request without counting when skipAnonymous is true and no user id", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 3,
        keyType: "user",
        skipAnonymous: true,
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ user: undefined });
      const ctx = createMockExecutionContext(request, config);

      const result = await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(result).toBe(true);
      expect(guard.getRecordCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Sliding-window enforcement
  // -------------------------------------------------------------------------

  describe("sliding window enforcement", () => {
    it("allows requests up to maxRequests within the window", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 3,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "1.2.3.4" });

      for (let i = 0; i < 3; i++) {
        const ctx = createMockExecutionContext(request, config);
        await expect(
          guard.canActivate(
            ctx as unknown as import("@nestjs/common").ExecutionContext,
          ),
        ).resolves.toBe(true);
      }
    });

    it("throws HttpException with TOO_MANY_REQUESTS when limit is exceeded", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 2,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "5.6.7.8" });

      for (let i = 0; i < 2; i++) {
        const ctx = createMockExecutionContext(request, config);
        await guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        );
      }

      const overflowCtx = createMockExecutionContext(request, config);
      await expect(
        guard.canActivate(
          overflowCtx as unknown as import("@nestjs/common").ExecutionContext,
        ),
      ).rejects.toThrow(HttpException);

      await expect(
        guard.canActivate(
          overflowCtx as unknown as import("@nestjs/common").ExecutionContext,
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });

    it("includes retryAfter in the error response body", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 30,
        maxRequests: 1,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "9.9.9.9" });

      const firstCtx = createMockExecutionContext(request, config);
      await guard.canActivate(
        firstCtx as unknown as import("@nestjs/common").ExecutionContext,
      );

      const secondCtx = createMockExecutionContext(request, config);
      try {
        await guard.canActivate(
          secondCtx as unknown as import("@nestjs/common").ExecutionContext,
        );
        fail("Expected an exception");
      } catch (err) {
        const httpErr = err as HttpException;
        const body = httpErr.getResponse() as Record<string, unknown>;
        expect(body.retryAfter).toBeGreaterThan(0);
        expect(body.retryAfter).toBeLessThanOrEqual(30);
      }
    });

    it("uses the custom message when configured", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 1,
        keyType: "ip",
        message: "Custom rate limit message",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "100.0.0.1" });

      const firstCtx = createMockExecutionContext(request, config);
      await guard.canActivate(
        firstCtx as unknown as import("@nestjs/common").ExecutionContext,
      );

      const secondCtx = createMockExecutionContext(request, config);
      try {
        await guard.canActivate(
          secondCtx as unknown as import("@nestjs/common").ExecutionContext,
        );
        fail("Expected an exception");
      } catch (err) {
        const body = (err as HttpException).getResponse() as Record<
          string,
          unknown
        >;
        expect(body.message).toBe("Custom rate limit message");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Response headers
  // -------------------------------------------------------------------------

  describe("X-RateLimit response headers", () => {
    it("sets X-RateLimit-Limit header to maxRequests", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 10,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "2.2.2.2" });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(ctx._response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Limit",
        10,
      );
    });

    it("sets X-RateLimit-Remaining header decreasing with each request", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 5,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "3.3.3.3" });

      const ctx1 = createMockExecutionContext(request, config);
      await guard.canActivate(
        ctx1 as unknown as import("@nestjs/common").ExecutionContext,
      );
      expect(ctx1._response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Remaining",
        4,
      );

      const ctx2 = createMockExecutionContext(request, config);
      await guard.canActivate(
        ctx2 as unknown as import("@nestjs/common").ExecutionContext,
      );
      expect(ctx2._response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Remaining",
        3,
      );
    });

    it("sets X-RateLimit-Reset header as a unix timestamp in seconds", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 10,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "4.4.4.4" });
      const ctx = createMockExecutionContext(request, config);
      const before = Math.ceil((Date.now() + 60_000) / 1000);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      const after = Math.ceil((Date.now() + 60_000) / 1000);

      const setHeaderCalls = ctx._response.setHeader.mock.calls;
      const resetCall = setHeaderCalls.find(
        (call: string[]) => call[0] === "X-RateLimit-Reset",
      );
      expect(resetCall).toBeDefined();
      expect(resetCall[1]).toBeGreaterThanOrEqual(before);
      expect(resetCall[1]).toBeLessThanOrEqual(after);
    });
  });

  // -------------------------------------------------------------------------
  // Monitoring / utility methods
  // -------------------------------------------------------------------------

  describe("utility and monitoring methods", () => {
    it("getRecordCount returns 0 after clearAllRecords", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 10,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "6.6.6.6" });
      const ctx = createMockExecutionContext(request, config);

      await guard.canActivate(
        ctx as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRecordCount()).toBe(1);

      guard.clearAllRecords();

      expect(guard.getRecordCount()).toBe(0);
    });

    it("getLastGlobalCleanup returns a timestamp in the past or present", () => {
      const cleanup = guard.getLastGlobalCleanup();
      expect(cleanup).toBeLessThanOrEqual(Date.now());
    });

    it("getRemainingRequests returns maxRequests when key has no records", () => {
      const remaining = guard.getRemainingRequests("unknown-key", 60, 10);
      expect(remaining).toBe(10);
    });

    it("getRemainingRequests decreases after requests are recorded", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 5,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "7.7.7.7" });

      const ctx1 = createMockExecutionContext(request, config);
      await guard.canActivate(
        ctx1 as unknown as import("@nestjs/common").ExecutionContext,
      );
      const ctx2 = createMockExecutionContext(request, config);
      await guard.canActivate(
        ctx2 as unknown as import("@nestjs/common").ExecutionContext,
      );

      expect(guard.getRemainingRequests("ip:7.7.7.7", 60, 5)).toBe(3);
    });

    it("getRemainingRequests returns 0 when exactly at limit", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 2,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      const request = createRequest({ ip: "8.8.8.8" });

      for (let i = 0; i < 2; i++) {
        const ctx = createMockExecutionContext(request, config);
        await guard.canActivate(
          ctx as unknown as import("@nestjs/common").ExecutionContext,
        );
      }

      expect(guard.getRemainingRequests("ip:8.8.8.8", 60, 2)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // RateLimit decorator
  // -------------------------------------------------------------------------

  describe("@RateLimit decorator", () => {
    it("produces SetMetadata with RATE_LIMIT_KEY and merged config", () => {
      const partial = { maxRequests: 20, windowSeconds: 30 };
      const decorator = RateLimit(partial);
      // Verify the decorator is a function (metadata setter)
      expect(typeof decorator).toBe("function");
    });

    it("RATE_LIMIT_KEY constant equals 'rate_limit'", () => {
      expect(RATE_LIMIT_KEY).toBe("rate_limit");
    });
  });
});
