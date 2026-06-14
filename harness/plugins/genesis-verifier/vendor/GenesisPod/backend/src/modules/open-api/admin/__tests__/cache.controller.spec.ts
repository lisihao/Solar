// Mock transitive cache dependencies before any imports to prevent resolution failures
jest.mock("cache-manager-ioredis-yet", () => ({ redisStore: jest.fn() }), {
  virtual: true,
});
jest.mock(
  "@nestjs/cache-manager",
  () => ({
    CacheModule: {
      registerAsync: jest.fn().mockReturnValue({ module: class {} }),
    },
    CACHE_MANAGER: "CACHE_MANAGER",
    Cache: jest.fn(),
  }),
  { virtual: true },
);

import { Test, TestingModule } from "@nestjs/testing";
import { CacheController } from "../cache/cache.controller";
import { CacheService, CachePrefix } from "../../../../common/cache";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

describe("CacheController", () => {
  let controller: CacheController;
  let cacheService: jest.Mocked<CacheService>;

  const mockCacheService = {
    invalidateAIModelCache: jest.fn(),
    invalidateUserCache: jest.fn(),
    delByPrefix: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CacheController],
      providers: [{ provide: CacheService, useValue: mockCacheService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CacheController);
    cacheService = module.get(CacheService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getCacheStatus", () => {
    it("should return cache status object with timestamp", async () => {
      const result = await controller.getCacheStatus();

      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("cacheType");
      expect(result).toHaveProperty("prefixes");
      expect(result).toHaveProperty("note");
      expect(Array.isArray(result.prefixes)).toBe(true);
    });

    it('should return "memory" cacheType when REDIS_URL is not set', async () => {
      const originalRedisUrl = process.env.REDIS_URL;
      delete process.env.REDIS_URL;

      const result = await controller.getCacheStatus();

      expect(result.cacheType).toBe("memory");

      if (originalRedisUrl !== undefined) {
        process.env.REDIS_URL = originalRedisUrl;
      }
    });

    it('should return "redis" cacheType when REDIS_URL is set', async () => {
      const originalRedisUrl = process.env.REDIS_URL;
      process.env.REDIS_URL = "redis://localhost:6379";

      const result = await controller.getCacheStatus();

      expect(result.cacheType).toBe("redis");

      if (originalRedisUrl !== undefined) {
        process.env.REDIS_URL = originalRedisUrl;
      } else {
        delete process.env.REDIS_URL;
      }
    });

    it("should include a valid ISO timestamp", async () => {
      const result = await controller.getCacheStatus();
      const parsed = new Date(result.timestamp);
      expect(isNaN(parsed.getTime())).toBe(false);
    });

    it("should include all CachePrefix values in prefixes array", async () => {
      const result = await controller.getCacheStatus();
      const expectedPrefixes = Object.values(CachePrefix);
      expect(result.prefixes).toEqual(expectedPrefixes);
    });

    it("should include a note about DELETE endpoints", async () => {
      const result = await controller.getCacheStatus();
      expect(result.note).toContain("DELETE");
    });
  });

  describe("clearAIModelCache", () => {
    it("should call invalidateAIModelCache and return success", async () => {
      mockCacheService.invalidateAIModelCache.mockResolvedValue(undefined);

      const result = await controller.clearAIModelCache();

      expect(cacheService.invalidateAIModelCache).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: true,
        message: "AI model cache cleared",
      });
    });

    it("should propagate errors from service", async () => {
      mockCacheService.invalidateAIModelCache.mockRejectedValue(
        new Error("Redis down"),
      );

      await expect(controller.clearAIModelCache()).rejects.toThrow(
        "Redis down",
      );
    });
  });

  describe("clearUserCache", () => {
    it("should call invalidateUserCache with userId and return success", async () => {
      mockCacheService.invalidateUserCache.mockResolvedValue(undefined);

      const result = await controller.clearUserCache("user-abc");

      expect(cacheService.invalidateUserCache).toHaveBeenCalledWith("user-abc");
      expect(result).toEqual({
        success: true,
        message: "User user-abc cache cleared",
      });
    });

    it("should include userId in success message", async () => {
      mockCacheService.invalidateUserCache.mockResolvedValue(undefined);

      const result = await controller.clearUserCache("user-xyz");

      expect(result.message).toContain("user-xyz");
    });

    it("should propagate errors from service", async () => {
      mockCacheService.invalidateUserCache.mockRejectedValue(
        new Error("Cache error"),
      );

      await expect(controller.clearUserCache("user-1")).rejects.toThrow(
        "Cache error",
      );
    });
  });

  describe("clearCacheByPrefix", () => {
    it("should call delByPrefix with given prefix and return success", async () => {
      mockCacheService.delByPrefix.mockResolvedValue(undefined);

      const result = await controller.clearCacheByPrefix("user:");

      expect(cacheService.delByPrefix).toHaveBeenCalledWith("user:");
      expect(result).toEqual({
        success: true,
        message: "Cache with prefix user: cleared",
      });
    });

    it("should include prefix in success message", async () => {
      mockCacheService.delByPrefix.mockResolvedValue(undefined);

      const result = await controller.clearCacheByPrefix("session:");

      expect(result.message).toContain("session:");
    });

    it("should propagate errors from service", async () => {
      mockCacheService.delByPrefix.mockRejectedValue(new Error("Prefix error"));

      await expect(controller.clearCacheByPrefix("ai:")).rejects.toThrow(
        "Prefix error",
      );
    });
  });

  describe("warmupCache", () => {
    it("should return warmup success response", async () => {
      const result = await controller.warmupCache();

      expect(result).toEqual({
        success: true,
        message: "Cache warmup completed",
        note: "Warmup logic not yet implemented",
      });
    });

    it("should not call any cache service methods (warmup is a no-op)", async () => {
      await controller.warmupCache();

      expect(cacheService.invalidateAIModelCache).not.toHaveBeenCalled();
      expect(cacheService.invalidateUserCache).not.toHaveBeenCalled();
      expect(cacheService.delByPrefix).not.toHaveBeenCalled();
    });
  });
});
