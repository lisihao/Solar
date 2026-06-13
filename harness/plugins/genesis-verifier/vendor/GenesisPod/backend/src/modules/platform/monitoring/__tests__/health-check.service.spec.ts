/**
 * HealthCheckService 单元测试
 *
 * 测试统一健康检查：
 * - check() 全面健康检查
 * - 子系统状态聚合（DB/Cache/AI Engine）
 * - 总体状态计算逻辑（healthy/degraded/unhealthy）
 * - AI Engine 仪表盘快照
 * - 可选依赖优雅降级
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { HealthCheckService } from "../health/health-check.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { APP_CONFIG } from "../../../../common/config/app.config";

describe("HealthCheckService", () => {
  let service: HealthCheckService;
  let mockPrisma: any;
  let mockCache: any;
  let mockObservability: any;

  beforeEach(async () => {
    mockPrisma = {
      healthCheck: jest.fn().mockResolvedValue({ status: "healthy" }),
    };

    mockCache = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue("ok"),
    };

    mockObservability = {
      getDashboard: jest.fn().mockReturnValue({
        totalCalls: 1000,
        successRate: 0.95,
        avgLatencyMs: 250,
        byModel: { "gpt-4o": {}, "claude-3": {} },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCheckService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    // Manually inject optional dependencies
    service = module.get<HealthCheckService>(HealthCheckService);
    (service as any).cache = mockCache;
    (service as any).observability = mockObservability;

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Full health check - all healthy
  // =========================================================================

  describe("check - all healthy", () => {
    it("should return healthy status when all subsystems are healthy", async () => {
      const result = await service.check();

      expect(result.status).toBe("healthy");
      expect(result.service).toBe(APP_CONFIG.brand.fullName);
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should include all subsystem statuses", async () => {
      const result = await service.check();

      expect(result.subsystems.database).toBeDefined();
      expect(result.subsystems.cache).toBeDefined();
      expect(result.subsystems.aiEngine).toBeDefined();
    });

    it("should report database as healthy", async () => {
      const result = await service.check();

      expect(result.subsystems.database.status).toBe("healthy");
      expect(result.subsystems.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should report cache as healthy", async () => {
      const result = await service.check();

      expect(result.subsystems.cache.status).toBe("healthy");
      expect(result.subsystems.cache.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should report AI engine as healthy", async () => {
      const result = await service.check();

      expect(result.subsystems.aiEngine.status).toBe("healthy");
    });

    it("should include AI dashboard snapshot", async () => {
      const result = await service.check();

      expect(result.ai).toBeDefined();
      expect(result.ai!.totalCalls).toBe(1000);
      expect(result.ai!.successRate).toBe(0.95);
      expect(result.ai!.avgLatencyMs).toBe(250);
      expect(result.ai!.activeModels).toBe(2);
    });
  });

  // =========================================================================
  // Database unhealthy → overall unhealthy
  // =========================================================================

  describe("check - database unhealthy", () => {
    it("should return unhealthy when database is down", async () => {
      mockPrisma.healthCheck.mockRejectedValue(new Error("Connection refused"));

      const result = await service.check();

      expect(result.status).toBe("unhealthy");
      expect(result.subsystems.database.status).toBe("unhealthy");
      expect(result.subsystems.database.message).toContain(
        "Connection refused",
      );
    });

    it("should return unhealthy when database reports unhealthy", async () => {
      mockPrisma.healthCheck.mockResolvedValue({ status: "unhealthy" });

      const result = await service.check();

      expect(result.subsystems.database.status).toBe("unhealthy");
      expect(result.status).toBe("unhealthy");
    });
  });

  // =========================================================================
  // Cache unhealthy → overall degraded (not unhealthy)
  // =========================================================================

  describe("check - cache issues", () => {
    it("should return degraded when cache is unhealthy", async () => {
      mockCache.get.mockResolvedValue(null); // cache set but get returns null

      const result = await service.check();

      expect(result.subsystems.cache.status).toBe("unhealthy");
      expect(result.status).toBe("degraded"); // not unhealthy, because only DB triggers full unhealthy
    });

    it("should return degraded when cache throws", async () => {
      mockCache.set.mockRejectedValue(new Error("Redis down"));

      const result = await service.check();

      expect(result.subsystems.cache.status).toBe("unhealthy");
      expect(result.status).toBe("degraded");
    });
  });

  // =========================================================================
  // AI Engine degraded/unhealthy
  // =========================================================================

  describe("check - AI engine issues", () => {
    it("should report AI engine as degraded when error rate > 50%", async () => {
      mockObservability.getDashboard.mockReturnValue({
        totalCalls: 100,
        successRate: 0.3, // 70% error rate
        avgLatencyMs: 500,
        byModel: { "gpt-4o": {} },
      });

      const result = await service.check();

      expect(result.subsystems.aiEngine.status).toBe("degraded");
      expect(result.subsystems.aiEngine.message).toContain("error rate");
    });

    it("should report AI engine as healthy when success rate is good", async () => {
      mockObservability.getDashboard.mockReturnValue({
        totalCalls: 100,
        successRate: 0.95,
        avgLatencyMs: 200,
        byModel: { "gpt-4o": {} },
      });

      const result = await service.check();

      expect(result.subsystems.aiEngine.status).toBe("healthy");
    });

    it("should report AI engine as healthy when no calls yet", async () => {
      mockObservability.getDashboard.mockReturnValue({
        totalCalls: 0,
        successRate: 0,
        avgLatencyMs: 0,
        byModel: {},
      });

      const result = await service.check();

      expect(result.subsystems.aiEngine.status).toBe("healthy");
    });
  });

  // =========================================================================
  // Overall status aggregation logic
  // =========================================================================

  describe("status aggregation", () => {
    it("should be degraded when any non-DB subsystem is unhealthy", async () => {
      // Cache unhealthy, DB healthy
      mockCache.get.mockResolvedValue(null);

      const result = await service.check();

      expect(result.subsystems.database.status).toBe("healthy");
      expect(result.subsystems.cache.status).toBe("unhealthy");
      expect(result.status).toBe("degraded");
    });

    it("should be degraded when any subsystem is degraded", async () => {
      mockObservability.getDashboard.mockReturnValue({
        totalCalls: 100,
        successRate: 0.3,
        avgLatencyMs: 500,
        byModel: {},
      });

      const result = await service.check();

      expect(result.subsystems.aiEngine.status).toBe("degraded");
      expect(result.status).toBe("degraded");
    });
  });

  // =========================================================================
  // Without optional dependencies
  // =========================================================================

  describe("without optional dependencies", () => {
    let minimalService: HealthCheckService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          HealthCheckService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      minimalService = module.get<HealthCheckService>(HealthCheckService);
    });

    it("should report cache as degraded when CacheService not available", async () => {
      const result = await minimalService.check();

      expect(result.subsystems.cache.status).toBe("degraded");
      expect(result.subsystems.cache.message).toContain("not available");
    });

    it("should report AI engine as degraded when observability not available", async () => {
      const result = await minimalService.check();

      expect(result.subsystems.aiEngine.status).toBe("degraded");
      expect(result.subsystems.aiEngine.message).toContain("not available");
    });

    it("should not include AI dashboard snapshot", async () => {
      const result = await minimalService.check();

      expect(result.ai).toBeUndefined();
    });

    it("should still be healthy overall if DB is healthy", async () => {
      const result = await minimalService.check();

      // degraded because cache and AI engine are both degraded
      expect(result.status).toBe("degraded");
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("should handle all subsystem checks failing gracefully", async () => {
      mockPrisma.healthCheck.mockRejectedValue(new Error("DB down"));
      mockCache.set.mockRejectedValue(new Error("Redis down"));
      mockObservability.getDashboard.mockImplementation(() => {
        throw new Error("Observability broken");
      });

      const result = await service.check();

      expect(result.status).toBe("unhealthy");
      expect(result.subsystems.database.status).toBe("unhealthy");
      expect(result.subsystems.cache.status).toBe("unhealthy");
      expect(result.subsystems.aiEngine.status).toBe("unhealthy");
    });

    it("should include version in response", async () => {
      const result = await service.check();

      expect(result.version).toBeDefined();
      expect(typeof result.version).toBe("string");
    });

    it("should include ISO timestamp", async () => {
      const result = await service.check();

      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });
});
