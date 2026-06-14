/**
 * JWT Strategy 测试
 * 测试JWT认证策略的validate方法
 *
 * 设计：JWT validate 不查询数据库，直接返回 payload
 * - 性能优化：O(1) 操作，Redis 黑名单查询
 * - 安全：通过 Redis 黑名单机制处理被禁用用户
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "../strategies/jwt.strategy";
import { CacheService } from "../../../../common/cache/cache.service";

describe("JwtStrategy", () => {
  let strategy: JwtStrategy;
  let mockCacheService: Record<string, jest.Mock>;

  const mockConfigService = {
    get: jest.fn().mockReturnValue("test-jwt-secret-minimum-32-chars!!"),
  };

  beforeEach(async () => {
    mockCacheService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should be defined", () => {
      expect(strategy).toBeDefined();
    });

    it("should call configService.get for JWT_SECRET", () => {
      expect(mockConfigService.get).toHaveBeenCalledWith("JWT_SECRET");
    });

    it("should throw error if JWT_SECRET is not set", () => {
      const noSecretConfig = {
        get: jest.fn().mockReturnValue(undefined),
      };
      const noopCache = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

      expect(() => {
        new JwtStrategy(
          noSecretConfig as unknown as ConfigService,
          noopCache as unknown as CacheService,
        );
      }).toThrow("CRITICAL SECURITY ERROR");
    });
  });

  describe("validate", () => {
    const mockPayload = {
      sub: "user-123",
      email: "test@example.com",
      username: "testuser",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    it("should return user info from payload without database query", async () => {
      const result = await strategy.validate(mockPayload);

      expect(result).toEqual({
        id: "user-123",
        email: "test@example.com",
        username: "testuser",
      });
    });

    it("should throw UnauthorizedException when user is blocked", async () => {
      // Simulate user in Redis blocklist
      mockCacheService.get.mockResolvedValueOnce("true");

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should allow user after unblocking", async () => {
      // Block then unblock
      await strategy.blockUser("user-123");
      await strategy.unblockUser("user-123");

      // After unblock, cache returns undefined
      mockCacheService.get.mockResolvedValueOnce(undefined);

      const result = await strategy.validate(mockPayload);
      expect(result.id).toBe("user-123");
    });
  });

  describe("blockUser", () => {
    it("should store user in Redis blocklist", async () => {
      await strategy.blockUser("user-456");
      expect(mockCacheService.set).toHaveBeenCalledWith(
        "blocklist:user:user-456",
        "true",
        86400 * 30,
      );
    });
  });

  describe("unblockUser", () => {
    it("should remove user from Redis blocklist", async () => {
      await strategy.unblockUser("user-789");
      expect(mockCacheService.del).toHaveBeenCalledWith(
        "blocklist:user:user-789",
      );
    });
  });

  describe("isUserBlocked", () => {
    it("should return false for non-blocked user", async () => {
      mockCacheService.get.mockResolvedValueOnce(undefined);
      expect(await strategy.isUserBlocked("unknown-user")).toBe(false);
    });

    it("should return true for blocked user", async () => {
      mockCacheService.get.mockResolvedValueOnce("true");
      expect(await strategy.isUserBlocked("blocked-user")).toBe(true);
    });
  });
});
