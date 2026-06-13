/**
 * CacheService 单元测试
 *
 * 测试缓存服务的核心功能：
 * - get() / set() / del() 基本操作
 * - getOrSet() 缓存穿透模式
 * - delByPrefix() 按前缀批量删除
 * - invalidateAIModelCache() AI 模型缓存失效
 * - invalidateUserCache() 用户缓存失效
 * - buildKey() 键构建
 * - 错误容错（缓存失败不影响主流程）
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { CacheService, CachePrefix, CacheTTL } from "../cache.service";

describe("CacheService", () => {
  let service: CacheService;
  let mockCacheManager: any;

  beforeEach(async () => {
    mockCacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // get
  // =========================================================================

  describe("get", () => {
    it("should return cached value", async () => {
      mockCacheManager.get.mockResolvedValue({ name: "test" });

      const result = await service.get<{ name: string }>("key");

      expect(result).toEqual({ name: "test" });
      expect(mockCacheManager.get).toHaveBeenCalledWith("key");
    });

    it("should return undefined when key not found", async () => {
      mockCacheManager.get.mockResolvedValue(null);

      const result = await service.get("missing-key");
      expect(result).toBeUndefined();
    });

    it("should return undefined on error (fault tolerant)", async () => {
      mockCacheManager.get.mockRejectedValue(new Error("Redis down"));

      const result = await service.get("key");
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // set
  // =========================================================================

  describe("set", () => {
    it("should set value with default TTL", async () => {
      await service.set("key", "value");

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        "key",
        "value",
        CacheTTL.DEFAULT * 1000, // converted to ms
      );
    });

    it("should set value with custom TTL", async () => {
      await service.set("key", "value", 60);

      expect(mockCacheManager.set).toHaveBeenCalledWith("key", "value", 60000);
    });

    it("should not throw on error (fault tolerant)", async () => {
      mockCacheManager.set.mockRejectedValue(new Error("Redis down"));

      await expect(service.set("key", "value")).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // del
  // =========================================================================

  describe("del", () => {
    it("should delete cached key", async () => {
      await service.del("key");

      expect(mockCacheManager.del).toHaveBeenCalledWith("key");
    });

    it("should not throw on error (fault tolerant)", async () => {
      mockCacheManager.del.mockRejectedValue(new Error("Redis down"));

      await expect(service.del("key")).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // getOrSet
  // =========================================================================

  describe("getOrSet", () => {
    it("should return cached value when available", async () => {
      mockCacheManager.get.mockResolvedValue("cached-data");

      const factory = jest.fn().mockResolvedValue("fresh-data");
      const result = await service.getOrSet("key", factory);

      expect(result).toBe("cached-data");
      expect(factory).not.toHaveBeenCalled();
    });

    it("should call factory and cache result when not cached", async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      const factory = jest.fn().mockResolvedValue("fresh-data");
      const result = await service.getOrSet("key", factory);

      expect(result).toBe("fresh-data");
      expect(factory).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        "key",
        "fresh-data",
        CacheTTL.DEFAULT * 1000,
      );
    });

    it("should use custom TTL", async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      const factory = jest.fn().mockResolvedValue("data");
      await service.getOrSet("key", factory, CacheTTL.LONG);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        "key",
        "data",
        CacheTTL.LONG * 1000,
      );
    });
  });

  // =========================================================================
  // delByPrefix
  // =========================================================================

  describe("delByPrefix", () => {
    it("should delete keys by prefix when store supports keys()", async () => {
      const mockStore = {
        keys: jest.fn().mockResolvedValue(["prefix:1", "prefix:2"]),
      };
      mockCacheManager.store = mockStore;

      await service.delByPrefix("prefix:");

      expect(mockStore.keys).toHaveBeenCalledWith("prefix:*");
      expect(mockCacheManager.del).toHaveBeenCalledTimes(2);
    });

    it("should handle store without keys() method", async () => {
      // No store property - should not throw
      await expect(service.delByPrefix("prefix:")).resolves.toBeUndefined();
    });

    it("should handle empty key list", async () => {
      const mockStore = {
        keys: jest.fn().mockResolvedValue([]),
      };
      mockCacheManager.store = mockStore;

      await service.delByPrefix("prefix:");

      expect(mockCacheManager.del).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // invalidateAIModelCache
  // =========================================================================

  describe("invalidateAIModelCache", () => {
    it("should invalidate both AI_MODEL and AI_MODEL_LIST prefixes", async () => {
      const spy = jest.spyOn(service, "delByPrefix");

      await service.invalidateAIModelCache();

      expect(spy).toHaveBeenCalledWith(CachePrefix.AI_MODEL);
      expect(spy).toHaveBeenCalledWith(CachePrefix.AI_MODEL_LIST);
    });
  });

  // =========================================================================
  // invalidateUserCache
  // =========================================================================

  describe("invalidateUserCache", () => {
    it("should invalidate user and API key caches", async () => {
      const delSpy = jest.spyOn(service, "del");
      const prefixSpy = jest.spyOn(service, "delByPrefix");

      await service.invalidateUserCache("user-123");

      expect(delSpy).toHaveBeenCalledWith(`${CachePrefix.USER}user-123`);
      expect(prefixSpy).toHaveBeenCalledWith(
        `${CachePrefix.USER_API_KEY}user-123`,
      );
    });
  });

  // =========================================================================
  // buildKey
  // =========================================================================

  describe("buildKey", () => {
    it("should build key with prefix and parts", () => {
      const key = service.buildKey(CachePrefix.AI_MODEL, "gpt-4o", "config");

      expect(key).toBe("ai:model:gpt-4o:config");
    });

    it("should build key with prefix only", () => {
      const key = service.buildKey(CachePrefix.SESSION, "abc-123");

      expect(key).toBe("session:abc-123");
    });
  });

  // =========================================================================
  // CachePrefix & CacheTTL enums
  // =========================================================================

  describe("enums", () => {
    it("CacheTTL values should be correct", () => {
      expect(CacheTTL.SHORT).toBe(60);
      expect(CacheTTL.DEFAULT).toBe(300);
      expect(CacheTTL.LONG).toBe(3600);
      expect(CacheTTL.DAY).toBe(86400);
    });

    it("CachePrefix values should end with colon", () => {
      expect(CachePrefix.AI_MODEL).toMatch(/:$/);
      expect(CachePrefix.USER).toMatch(/:$/);
      expect(CachePrefix.SESSION).toMatch(/:$/);
    });
  });
});
