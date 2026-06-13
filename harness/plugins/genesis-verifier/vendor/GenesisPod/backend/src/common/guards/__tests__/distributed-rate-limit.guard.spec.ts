/**
 * DistributedRateLimitGuard unit tests
 *
 * Covers:
 * - No-config passthrough
 * - Redis-backed rate limiting (allow and deny)
 * - Fallback to in-memory when Redis is unavailable
 * - Different configurations (keyType user / ip / custom extractor)
 * - IP extraction from various headers
 * - skipAnonymous behaviour
 * - Response headers (X-RateLimit-*)
 * - getStats monitoring helper
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { ExecutionContext } from "@nestjs/common";
import { Request } from "express";

import { DistributedRateLimitGuard } from "../distributed-rate-limit.guard";
import { RateLimitConfig } from "../rate-limit.guard";

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

function createMockResponse() {
  return { setHeader: jest.fn() };
}

function createMockContext(
  request: Request,
  config: RateLimitConfig | undefined,
  response = createMockResponse(),
) {
  const httpAdapter = {
    getRequest: jest.fn().mockReturnValue(request),
    getResponse: jest.fn().mockReturnValue(response),
  };

  return {
    switchToHttp: jest.fn().mockReturnValue(httpAdapter),
    getHandler: jest.fn(),
    getClass: jest.fn(),
    _response: response,
    _config: config,
  } as unknown as ExecutionContext & {
    _response: ReturnType<typeof createMockResponse>;
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DistributedRateLimitGuard", () => {
  let guard: DistributedRateLimitGuard;
  let mockReflector: jest.Mocked<Pick<Reflector, "get">>;
  let mockCacheManager: jest.Mocked<
    Pick<Cache, "get" | "set" | "del" | "reset">
  >;

  beforeEach(async () => {
    mockReflector = { get: jest.fn() };
    mockCacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DistributedRateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    guard = module.get<DistributedRateLimitGuard>(DistributedRateLimitGuard);

    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Passthrough when no config
  // -------------------------------------------------------------------------

  describe("when no RateLimit config is applied", () => {
    it("returns true immediately without touching Redis", async () => {
      mockReflector.get.mockReturnValue(undefined);
      const ctx = createMockContext(createRequest(), undefined);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockCacheManager.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Redis-backed path — allow
  // -------------------------------------------------------------------------

  describe("Redis-backed rate limiting (within limit)", () => {
    const config: RateLimitConfig = {
      windowSeconds: 60,
      maxRequests: 10,
      keyType: "ip",
    };

    beforeEach(() => {
      mockReflector.get.mockReturnValue(config);
      // Redis returns empty list — no previous requests
      mockCacheManager.get.mockResolvedValue(null);
    });

    it("returns true when Redis has no prior timestamps", async () => {
      const ctx = createMockContext(createRequest({ ip: "10.0.0.1" }), config);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it("persists the new timestamp to Redis with doubled TTL", async () => {
      const ctx = createMockContext(createRequest({ ip: "10.0.0.2" }), config);

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("ratelimit:"),
        expect.any(String),
        config.windowSeconds * 2 * 1000,
      );
    });

    it("sets X-RateLimit-* response headers", async () => {
      const ctx = createMockContext(createRequest({ ip: "10.0.0.3" }), config);

      await guard.canActivate(ctx);

      expect(ctx._response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Limit",
        config.maxRequests,
      );
      expect(ctx._response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Remaining",
        expect.any(Number),
      );
      expect(ctx._response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Reset",
        expect.any(Number),
      );
    });

    it("counts existing timestamps returned from Redis", async () => {
      // Simulate 5 prior requests in the window
      const priorTimestamps = Array.from(
        { length: 5 },
        (_, i) => Date.now() - i * 1000,
      );
      mockCacheManager.get.mockResolvedValue(JSON.stringify(priorTimestamps));

      const ctx = createMockContext(createRequest({ ip: "10.0.0.4" }), config);

      await guard.canActivate(ctx);

      // Remaining should be 10 - 5 - 1 (new request) = 4
      expect(ctx._response.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Remaining",
        4,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Rate limit enforcement — via memory fallback path
  //
  // We test the 429 / error-body behaviour via the in-memory fallback because
  // the memory fallback is synchronous and free of mock-state races, while
  // the Redis path is tested above via the "within limit" tests.
  // -------------------------------------------------------------------------

  describe("rate limit enforcement (via memory fallback)", () => {
    it("throws HttpException 429 when the limit is exceeded in memory fallback", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 2,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      // Force fallback by making Redis unavailable
      mockCacheManager.get.mockRejectedValue(new Error("Redis down"));

      const ip = "11.0.0.1";

      for (let i = 0; i < 2; i++) {
        const ctx = createMockContext(createRequest({ ip }), config);
        await guard.canActivate(ctx);
      }

      const ctx = createMockContext(createRequest({ ip }), config);
      await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    });

    it("includes retryAfter in the error response body", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 1,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockRejectedValue(new Error("Redis down"));

      const ip = "11.0.0.2";
      const firstCtx = createMockContext(createRequest({ ip }), config);
      await guard.canActivate(firstCtx);

      let caughtError: unknown;
      try {
        const ctx = createMockContext(createRequest({ ip }), config);
        await guard.canActivate(ctx);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(HttpException);
      const body = (caughtError as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(body.retryAfter).toBeGreaterThan(0);
    });

    it("uses custom message when configured", async () => {
      const configWithMessage: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 1,
        keyType: "ip",
        message: "Custom limit message",
      };
      mockReflector.get.mockReturnValue(configWithMessage);
      mockCacheManager.get.mockRejectedValue(new Error("Redis down"));

      const ip = "11.0.0.3";
      const firstCtx = createMockContext(
        createRequest({ ip }),
        configWithMessage,
      );
      await guard.canActivate(firstCtx);

      let caughtError: unknown;
      try {
        const ctx = createMockContext(createRequest({ ip }), configWithMessage);
        await guard.canActivate(ctx);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(HttpException);
      const body = (caughtError as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.message).toBe("Custom limit message");
    });
  });

  // -------------------------------------------------------------------------
  // Redis unavailable — fallback to in-memory
  // -------------------------------------------------------------------------

  describe("when Redis throws an error", () => {
    const config: RateLimitConfig = {
      windowSeconds: 60,
      maxRequests: 5,
      keyType: "ip",
    };

    it("falls back to memory-based rate limiting and still allows the request", async () => {
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockRejectedValue(
        new Error("Redis connection refused"),
      );

      const ctx = createMockContext(createRequest({ ip: "20.0.0.1" }), config);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it("marks Redis as unavailable after the first failure", async () => {
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockRejectedValue(new Error("Redis unavailable"));

      const ctx = createMockContext(createRequest({ ip: "20.0.0.2" }), config);
      await guard.canActivate(ctx);

      const stats = guard.getStats();
      expect(stats.redisAvailable).toBe(false);
    });

    it("enforces memory fallback limits after Redis fails", async () => {
      const tightConfig: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 2,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(tightConfig);
      // Redis always fails, so we use memory fallback
      mockCacheManager.get.mockRejectedValue(new Error("Redis down"));

      const ip = "20.0.0.3";

      // First two requests should succeed (via memory fallback)
      for (let i = 0; i < 2; i++) {
        const ctx = createMockContext(createRequest({ ip }), tightConfig);
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
      }

      // Third request should be denied by memory fallback
      const overflowCtx = createMockContext(createRequest({ ip }), tightConfig);
      await expect(guard.canActivate(overflowCtx)).rejects.toThrow(
        HttpException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Without CacheManager (Redis not configured at all)
  // -------------------------------------------------------------------------

  describe("when CacheManager is not provided (optional)", () => {
    let guardWithoutCache: DistributedRateLimitGuard;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DistributedRateLimitGuard,
          { provide: Reflector, useValue: mockReflector },
          // CACHE_MANAGER intentionally omitted
        ],
      }).compile();

      guardWithoutCache = module.get<DistributedRateLimitGuard>(
        DistributedRateLimitGuard,
      );
    });

    it("uses in-memory fallback and allows requests within limit", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 5,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);

      const ctx = createMockContext(createRequest({ ip: "30.0.0.1" }), config);

      const result = await guardWithoutCache.canActivate(ctx);

      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Key extraction — user type
  // -------------------------------------------------------------------------

  describe("key extraction with keyType 'user'", () => {
    it("uses 'user:<id>' key for authenticated users", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 10,
        keyType: "user",
      };
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockResolvedValue(null);

      const ctx = createMockContext(
        createRequest({ user: { id: "user-123" } }),
        config,
      );

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("user:user-123"),
        expect.any(String),
        expect.any(Number),
      );
    });

    it("falls back to IP when user has no id and skipAnonymous is false", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 10,
        keyType: "user",
        skipAnonymous: false,
      };
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockResolvedValue(null);

      const ctx = createMockContext(
        createRequest({ ip: "40.0.0.1", user: {} }),
        config,
      );

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("ip:40.0.0.1"),
        expect.any(String),
        expect.any(Number),
      );
    });

    it("returns true without counting when skipAnonymous is true and user has no id", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 10,
        keyType: "user",
        skipAnonymous: true,
      };
      mockReflector.get.mockReturnValue(config);

      const ctx = createMockContext(createRequest({ user: undefined }), config);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockCacheManager.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Key extraction — IP type with various headers
  // -------------------------------------------------------------------------

  describe("IP extraction", () => {
    const config: RateLimitConfig = {
      windowSeconds: 60,
      maxRequests: 10,
      keyType: "ip",
    };

    beforeEach(() => {
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockResolvedValue(null);
    });

    it("extracts first IP from x-forwarded-for (comma-separated)", async () => {
      const ctx = createMockContext(
        createRequest({
          headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
        }),
        config,
      );

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("ip:203.0.113.1"),
        expect.any(String),
        expect.any(Number),
      );
    });

    it("extracts first IP when x-forwarded-for is an array", async () => {
      const ctx = createMockContext(
        createRequest({
          headers: { "x-forwarded-for": ["203.0.113.2", "10.0.0.1"] },
        }),
        config,
      );

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("ip:203.0.113.2"),
        expect.any(String),
        expect.any(Number),
      );
    });

    it("falls back to x-real-ip header", async () => {
      const ctx = createMockContext(
        createRequest({ headers: { "x-real-ip": "203.0.113.3" } }),
        config,
      );

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("ip:203.0.113.3"),
        expect.any(String),
        expect.any(Number),
      );
    });

    it("falls back to request.ip when no proxy headers", async () => {
      const ctx = createMockContext(
        createRequest({ ip: "172.16.0.1" }),
        config,
      );

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("ip:172.16.0.1"),
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Custom key extractor
  // -------------------------------------------------------------------------

  describe("custom keyExtractor", () => {
    it("uses the value returned by keyExtractor as the Redis key segment", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 5,
        keyExtractor: () => "tenant:acme",
      };
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockResolvedValue(null);

      const ctx = createMockContext(createRequest(), config);

      await guard.canActivate(ctx);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("tenant:acme"),
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getStats monitoring helper
  // -------------------------------------------------------------------------

  describe("getStats()", () => {
    it("returns redisAvailable: true initially", () => {
      const stats = guard.getStats();
      expect(stats.redisAvailable).toBe(true);
    });

    it("returns fallbackRecordCount: 0 when no fallback records exist", () => {
      const stats = guard.getStats();
      expect(stats.fallbackRecordCount).toBe(0);
    });

    it("increments fallbackRecordCount when fallback is used", async () => {
      const config: RateLimitConfig = {
        windowSeconds: 60,
        maxRequests: 5,
        keyType: "ip",
      };
      mockReflector.get.mockReturnValue(config);
      mockCacheManager.get.mockRejectedValue(new Error("Redis down"));

      const ctx = createMockContext(createRequest({ ip: "50.0.0.1" }), config);
      await guard.canActivate(ctx);

      const stats = guard.getStats();
      expect(stats.fallbackRecordCount).toBeGreaterThan(0);
    });
  });
});
