/**
 * Unit tests for SkillAnalyticsService
 *
 * Coverage target: 90%+
 * All public methods and the private helpers exercised through them.
 */

import { SkillAnalyticsService } from "../skill-analytics.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

function makeMockPrisma() {
  return {
    aIUsageLog: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    skillConfig: {
      findMany: jest.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

function makeAggregateResult(
  overrides: {
    count?: number;
    avgDuration?: number | null;
    sumTokens?: number | null;
  } = {},
) {
  return {
    _count: overrides.count ?? 0,
    _avg: { duration: overrides.avgDuration ?? null },
    _sum: { tokensUsed: overrides.sumTokens ?? null },
  };
}

function makeSuccessAggregateResult(count: number) {
  return { _count: count };
}

function makeLogRow(
  overrides: {
    success?: boolean;
    duration?: number | null;
    tokensUsed?: number | null;
    errorCode?: string | null;
    createdAt?: Date;
  } = {},
) {
  return {
    success: "success" in overrides ? overrides.success : true,
    duration: "duration" in overrides ? overrides.duration : 100,
    tokensUsed: "tokensUsed" in overrides ? overrides.tokensUsed : 50,
    errorCode: "errorCode" in overrides ? overrides.errorCode : null,
    createdAt: overrides.createdAt ?? new Date("2026-03-01T10:00:00Z"),
  };
}

function makeSkillConfig(
  overrides: {
    skillId?: string;
    displayName?: string | null;
    lastUsedAt?: Date | null;
    usageCount?: number;
    enabled?: boolean;
  } = {},
) {
  return {
    skillId: overrides.skillId ?? "skill-1",
    displayName:
      "displayName" in overrides ? overrides.displayName : "Skill One",
    lastUsedAt: "lastUsedAt" in overrides ? overrides.lastUsedAt : null,
    usageCount: overrides.usageCount ?? 0,
    enabled: overrides.enabled ?? true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillAnalyticsService", () => {
  let service: SkillAnalyticsService;
  let prisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makeMockPrisma();
    service = new SkillAnalyticsService(prisma as unknown as PrismaService);
  });

  // =========================================================================
  // getDashboardMetrics
  // =========================================================================

  describe("getDashboardMetrics", () => {
    describe("with data present", () => {
      beforeEach(() => {
        prisma.aIUsageLog.aggregate
          .mockResolvedValueOnce(
            makeAggregateResult({
              count: 200,
              avgDuration: 1500,
              sumTokens: 10000,
            }),
          )
          .mockResolvedValueOnce(makeSuccessAggregateResult(160));

        prisma.aIUsageLog.findMany.mockResolvedValue([
          makeLogRow({
            success: true,
            createdAt: new Date("2026-02-28T08:00:00Z"),
          }),
          makeLogRow({
            success: false,
            createdAt: new Date("2026-02-28T09:00:00Z"),
          }),
          makeLogRow({
            success: true,
            createdAt: new Date("2026-03-01T10:00:00Z"),
          }),
          makeLogRow({
            success: true,
            createdAt: new Date("2026-03-01T11:00:00Z"),
          }),
        ]);
      });

      it("returns correct totalExecutions", async () => {
        const result = await service.getDashboardMetrics("7d");
        expect(result.totalExecutions).toBe(200);
      });

      it("calculates successRate as successCount / totalExecutions", async () => {
        const result = await service.getDashboardMetrics("7d");
        expect(result.successRate).toBeCloseTo(160 / 200);
      });

      it("returns avgDuration from aggregate", async () => {
        const result = await service.getDashboardMetrics("7d");
        expect(result.avgDuration).toBe(1500);
      });

      it("returns totalTokens from aggregate sum", async () => {
        const result = await service.getDashboardMetrics("7d");
        expect(result.totalTokens).toBe(10000);
      });

      it("groups timeline by date key", async () => {
        const result = await service.getDashboardMetrics("7d");
        const dates = result.timeline.map((t) => t.date);
        expect(dates).toContain("2026-02-28");
        expect(dates).toContain("2026-03-01");
      });

      it("calculates per-date successRate correctly", async () => {
        const result = await service.getDashboardMetrics("7d");
        const feb28 = result.timeline.find((t) => t.date === "2026-02-28");
        // 1 success out of 2 => 0.5
        expect(feb28?.successRate).toBeCloseTo(0.5);
        const mar01 = result.timeline.find((t) => t.date === "2026-03-01");
        // 2 success out of 2 => 1
        expect(mar01?.successRate).toBeCloseTo(1);
      });

      it("sorts timeline ascending by date", async () => {
        const result = await service.getDashboardMetrics("7d");
        const dates = result.timeline.map((t) => t.date);
        expect(dates[0]).toBe("2026-02-28");
        expect(dates[1]).toBe("2026-03-01");
      });

      it("sets correct count per timeline date", async () => {
        const result = await service.getDashboardMetrics("7d");
        const feb28 = result.timeline.find((t) => t.date === "2026-02-28");
        expect(feb28?.count).toBe(2);
        const mar01 = result.timeline.find((t) => t.date === "2026-03-01");
        expect(mar01?.count).toBe(2);
      });
    });

    describe("empty data", () => {
      beforeEach(() => {
        prisma.aIUsageLog.aggregate
          .mockResolvedValueOnce(makeAggregateResult({ count: 0 }))
          .mockResolvedValueOnce(makeSuccessAggregateResult(0));

        prisma.aIUsageLog.findMany.mockResolvedValue([]);
      });

      it("returns zero totalExecutions", async () => {
        const result = await service.getDashboardMetrics("24h");
        expect(result.totalExecutions).toBe(0);
      });

      it("returns zero successRate when no executions", async () => {
        const result = await service.getDashboardMetrics("24h");
        expect(result.successRate).toBe(0);
      });

      it("returns zero avgDuration when aggregate returns null", async () => {
        const result = await service.getDashboardMetrics("24h");
        expect(result.avgDuration).toBe(0);
      });

      it("returns zero totalTokens when aggregate returns null", async () => {
        const result = await service.getDashboardMetrics("24h");
        expect(result.totalTokens).toBe(0);
      });

      it("returns empty timeline array", async () => {
        const result = await service.getDashboardMetrics("24h");
        expect(result.timeline).toHaveLength(0);
      });
    });

    describe("range parameter propagation", () => {
      beforeEach(() => {
        prisma.aIUsageLog.aggregate.mockResolvedValue(
          makeAggregateResult({ count: 1, avgDuration: 500, sumTokens: 100 }),
        );
        prisma.aIUsageLog.findMany.mockResolvedValue([]);
      });

      it.each(["24h", "7d", "30d"] as const)(
        "calls aggregate with capabilityType=skill for range %s",
        async (range) => {
          await service.getDashboardMetrics(range);
          const firstCallArgs = prisma.aIUsageLog.aggregate.mock.calls[0][0];
          expect(firstCallArgs.where.capabilityType).toBe("skill");
        },
      );

      it("uses a createdAt gte filter close to 24 hours ago for '24h'", async () => {
        const before = Date.now();
        await service.getDashboardMetrics("24h");
        const after = Date.now();
        const firstCallArgs = prisma.aIUsageLog.aggregate.mock.calls[0][0];
        const gte: Date = firstCallArgs.where.createdAt.gte;
        const expectedMs = 24 * 60 * 60 * 1000;
        expect(before - gte.getTime()).toBeGreaterThanOrEqual(expectedMs - 100);
        expect(after - gte.getTime()).toBeLessThanOrEqual(expectedMs + 100);
      });

      it("uses a createdAt gte filter close to 7 days ago for '7d'", async () => {
        const before = Date.now();
        await service.getDashboardMetrics("7d");
        const after = Date.now();
        const firstCallArgs = prisma.aIUsageLog.aggregate.mock.calls[0][0];
        const gte: Date = firstCallArgs.where.createdAt.gte;
        const expectedMs = 7 * 24 * 60 * 60 * 1000;
        expect(before - gte.getTime()).toBeGreaterThanOrEqual(expectedMs - 100);
        expect(after - gte.getTime()).toBeLessThanOrEqual(expectedMs + 100);
      });

      it("uses a createdAt gte filter close to 30 days ago for '30d'", async () => {
        const before = Date.now();
        await service.getDashboardMetrics("30d");
        const after = Date.now();
        const firstCallArgs = prisma.aIUsageLog.aggregate.mock.calls[0][0];
        const gte: Date = firstCallArgs.where.createdAt.gte;
        const expectedMs = 30 * 24 * 60 * 60 * 1000;
        expect(before - gte.getTime()).toBeGreaterThanOrEqual(expectedMs - 100);
        expect(after - gte.getTime()).toBeLessThanOrEqual(expectedMs + 100);
      });
    });
  });

  // =========================================================================
  // getSkillMetrics
  // =========================================================================

  describe("getSkillMetrics", () => {
    describe("with data present", () => {
      const logs = [
        makeLogRow({
          success: true,
          duration: 200,
          tokensUsed: 100,
          errorCode: null,
        }),
        makeLogRow({
          success: true,
          duration: 400,
          tokensUsed: 200,
          errorCode: null,
        }),
        makeLogRow({
          success: false,
          duration: 600,
          tokensUsed: 50,
          errorCode: "TIMEOUT",
        }),
        makeLogRow({
          success: false,
          duration: 800,
          tokensUsed: 50,
          errorCode: "TIMEOUT",
        }),
        makeLogRow({
          success: false,
          duration: 300,
          tokensUsed: 25,
          errorCode: "AUTH_ERROR",
        }),
      ];

      beforeEach(() => {
        prisma.aIUsageLog.findMany.mockResolvedValue(logs);
      });

      it("returns correct totalCalls", async () => {
        const result = await service.getSkillMetrics("skill-abc", "7d");
        expect(result.totalCalls).toBe(5);
      });

      it("calculates successRate correctly", async () => {
        const result = await service.getSkillMetrics("skill-abc", "7d");
        expect(result.successRate).toBeCloseTo(2 / 5);
      });

      it("calculates avgDuration as mean of all durations", async () => {
        const result = await service.getSkillMetrics("skill-abc", "7d");
        // (200+400+600+800+300)/5 = 460
        expect(result.avgDuration).toBeCloseTo(460);
      });

      it("sums totalTokens correctly", async () => {
        const result = await service.getSkillMetrics("skill-abc", "7d");
        expect(result.totalTokens).toBe(100 + 200 + 50 + 50 + 25);
      });

      it("builds error distribution grouped by errorCode", async () => {
        const result = await service.getSkillMetrics("skill-abc", "7d");
        expect(result.errorDistribution["TIMEOUT"]).toBe(2);
        expect(result.errorDistribution["AUTH_ERROR"]).toBe(1);
      });

      it("does not include success logs in error distribution", async () => {
        const result = await service.getSkillMetrics("skill-abc", "7d");
        expect(Object.keys(result.errorDistribution)).toHaveLength(2);
      });

      it("computes latency percentiles correctly", async () => {
        // sorted durations: [200, 300, 400, 600, 800]
        const result = await service.getSkillMetrics("skill-abc", "7d");
        const { p50, p95, p99 } = result.latencyPercentiles;
        // p50 index = ceil(0.5 * 5) - 1 = 2 => sorted[2] = 400
        expect(p50).toBe(400);
        // p95 index = ceil(0.95 * 5) - 1 = 4 => sorted[4] = 800
        expect(p95).toBe(800);
        // p99 index = ceil(0.99 * 5) - 1 = 4 => sorted[4] = 800
        expect(p99).toBe(800);
      });

      it("queries with correct skillId and capabilityType", async () => {
        await service.getSkillMetrics("my-skill-id", "24h");
        const callArgs = prisma.aIUsageLog.findMany.mock.calls[0][0];
        expect(callArgs.where.capabilityId).toBe("my-skill-id");
        expect(callArgs.where.capabilityType).toBe("skill");
      });
    });

    describe("empty data", () => {
      beforeEach(() => {
        prisma.aIUsageLog.findMany.mockResolvedValue([]);
      });

      it("returns totalCalls 0", async () => {
        const result = await service.getSkillMetrics("skill-x", "30d");
        expect(result.totalCalls).toBe(0);
      });

      it("returns successRate 0 when no calls", async () => {
        const result = await service.getSkillMetrics("skill-x", "30d");
        expect(result.successRate).toBe(0);
      });

      it("returns avgDuration 0 when no calls", async () => {
        const result = await service.getSkillMetrics("skill-x", "30d");
        expect(result.avgDuration).toBe(0);
      });

      it("returns totalTokens 0 when no calls", async () => {
        const result = await service.getSkillMetrics("skill-x", "30d");
        expect(result.totalTokens).toBe(0);
      });

      it("returns empty errorDistribution", async () => {
        const result = await service.getSkillMetrics("skill-x", "30d");
        expect(result.errorDistribution).toEqual({});
      });

      it("returns zero latency percentiles when no durations", async () => {
        const result = await service.getSkillMetrics("skill-x", "30d");
        expect(result.latencyPercentiles).toEqual({ p50: 0, p95: 0, p99: 0 });
      });
    });

    describe("null durations are excluded from percentile calculation", () => {
      it("filters out null/zero durations before computing percentiles", async () => {
        prisma.aIUsageLog.findMany.mockResolvedValue([
          makeLogRow({ success: true, duration: null }),
          makeLogRow({ success: true, duration: 0 }),
          makeLogRow({ success: true, duration: 500 }),
        ]);

        const result = await service.getSkillMetrics("skill-y", "7d");
        // Only duration=500 is valid
        expect(result.latencyPercentiles.p50).toBe(500);
      });
    });

    describe("null tokensUsed treated as 0", () => {
      it("sums null tokensUsed as 0", async () => {
        prisma.aIUsageLog.findMany.mockResolvedValue([
          makeLogRow({ success: true, tokensUsed: null }),
          makeLogRow({ success: true, tokensUsed: 200 }),
        ]);

        const result = await service.getSkillMetrics("skill-z", "7d");
        expect(result.totalTokens).toBe(200);
      });
    });

    describe("failed logs without errorCode are ignored in error distribution", () => {
      it("skips null errorCode even when success=false", async () => {
        prisma.aIUsageLog.findMany.mockResolvedValue([
          makeLogRow({ success: false, errorCode: null }),
        ]);

        const result = await service.getSkillMetrics("skill-w", "7d");
        expect(result.errorDistribution).toEqual({});
      });
    });
  });

  // =========================================================================
  // getHealthScores
  // =========================================================================

  describe("getHealthScores", () => {
    function setupHealthMocks(opts: {
      configs?: ReturnType<typeof makeSkillConfig>[];
      recentGroups?: {
        capabilityId: string;
        _count: number;
        _avg: { duration: number | null };
      }[];
      successGroups?: { capabilityId: string; _count: number }[];
    }) {
      prisma.skillConfig.findMany.mockResolvedValue(opts.configs ?? []);
      prisma.aIUsageLog.groupBy
        .mockResolvedValueOnce(opts.recentGroups ?? [])
        .mockResolvedValueOnce(opts.successGroups ?? []);
    }

    it("returns empty array when no skill configs exist", async () => {
      setupHealthMocks({});
      const result = await service.getHealthScores();
      expect(result).toHaveLength(0);
    });

    describe("healthy skill", () => {
      it("assigns status=healthy for high success rate, low latency, sufficient activity", async () => {
        setupHealthMocks({
          configs: [
            makeSkillConfig({
              skillId: "healthy-skill",
              displayName: "Healthy",
            }),
          ],
          recentGroups: [
            {
              capabilityId: "healthy-skill",
              _count: 20,
              _avg: { duration: 1000 },
            },
          ],
          successGroups: [{ capabilityId: "healthy-skill", _count: 20 }],
        });

        const result = await service.getHealthScores();
        expect(result[0].status).toBe("healthy");
      });

      it("computes score >= 80 for healthy skill", async () => {
        setupHealthMocks({
          configs: [makeSkillConfig({ skillId: "healthy-skill" })],
          recentGroups: [
            {
              capabilityId: "healthy-skill",
              _count: 10,
              _avg: { duration: 1000 },
            },
          ],
          successGroups: [{ capabilityId: "healthy-skill", _count: 10 }],
        });

        const result = await service.getHealthScores();
        // successScore=100*0.6=60, latencyScore=100*0.2=20, activityScore=100*0.2=20 => 100
        expect(result[0].score).toBe(100);
        expect(result[0].status).toBe("healthy");
      });
    });

    describe("degraded skill", () => {
      it("assigns status=degraded for score between 50 and 79", async () => {
        setupHealthMocks({
          configs: [makeSkillConfig({ skillId: "degraded-skill" })],
          recentGroups: [
            // 50% success rate, low latency, low activity (2 calls => activityScore=20)
            {
              capabilityId: "degraded-skill",
              _count: 2,
              _avg: { duration: 1000 },
            },
          ],
          successGroups: [{ capabilityId: "degraded-skill", _count: 1 }],
        });

        const result = await service.getHealthScores();
        // successScore=50*0.6=30, latencyScore=100*0.2=20, activityScore=20*0.2=4 => 54
        expect(result[0].status).toBe("degraded");
        expect(result[0].score).toBeGreaterThanOrEqual(50);
        expect(result[0].score).toBeLessThan(80);
      });
    });

    describe("critical skill", () => {
      it("assigns status=critical for score below 50", async () => {
        setupHealthMocks({
          configs: [makeSkillConfig({ skillId: "critical-skill" })],
          recentGroups: [
            // 0% success, high latency (>10000ms)
            {
              capabilityId: "critical-skill",
              _count: 5,
              _avg: { duration: 15000 },
            },
          ],
          successGroups: [],
        });

        const result = await service.getHealthScores();
        // successScore=0*0.6=0, latencyScore=0*0.2=0, activityScore=50*0.2=10 => 10
        expect(result[0].status).toBe("critical");
        expect(result[0].score).toBeLessThan(50);
      });
    });

    describe("unused skill", () => {
      it("assigns status=unused and score=0 when no recent calls and lastUsedAt is null", async () => {
        setupHealthMocks({
          configs: [
            makeSkillConfig({ skillId: "unused-skill", lastUsedAt: null }),
          ],
          recentGroups: [],
          successGroups: [],
        });

        const result = await service.getHealthScores();
        expect(result[0].status).toBe("unused");
        expect(result[0].score).toBe(0);
      });

      it("assigns status=unused when lastUsedAt is older than 30 days", async () => {
        const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        setupHealthMocks({
          configs: [
            makeSkillConfig({ skillId: "old-skill", lastUsedAt: oldDate }),
          ],
          recentGroups: [],
          successGroups: [],
        });

        const result = await service.getHealthScores();
        expect(result[0].status).toBe("unused");
        expect(result[0].score).toBe(0);
      });

      it("assigns status=degraded with score=50 when no recent calls but lastUsedAt is within 30 days", async () => {
        const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
        setupHealthMocks({
          configs: [
            makeSkillConfig({
              skillId: "recent-but-idle-skill",
              lastUsedAt: recentDate,
            }),
          ],
          recentGroups: [],
          successGroups: [],
        });

        const result = await service.getHealthScores();
        expect(result[0].status).toBe("degraded");
        expect(result[0].score).toBe(50);
      });
    });

    describe("score formula details", () => {
      it("latency 5000-9999ms gives latencyScore=50 (medium band)", async () => {
        setupHealthMocks({
          configs: [makeSkillConfig({ skillId: "medium-latency-skill" })],
          recentGroups: [
            {
              capabilityId: "medium-latency-skill",
              _count: 10,
              _avg: { duration: 7000 },
            },
          ],
          successGroups: [{ capabilityId: "medium-latency-skill", _count: 10 }],
        });

        const result = await service.getHealthScores();
        // successScore=100*0.6=60, latencyScore=50*0.2=10, activityScore=100*0.2=20 => 90
        expect(result[0].score).toBe(90);
        expect(result[0].status).toBe("healthy");
      });

      it("activityScore is capped at 100 (when totalCalls >= 10)", async () => {
        setupHealthMocks({
          configs: [makeSkillConfig({ skillId: "active-skill" })],
          recentGroups: [
            {
              capabilityId: "active-skill",
              _count: 100,
              _avg: { duration: 1000 },
            },
          ],
          successGroups: [{ capabilityId: "active-skill", _count: 100 }],
        });

        const result = await service.getHealthScores();
        // activityScore = min(100/10, 1)*100 = 100
        expect(result[0].score).toBe(100);
      });

      it("uses displayName as name, falls back to skillId when displayName is null", async () => {
        setupHealthMocks({
          configs: [
            makeSkillConfig({
              skillId: "fallback-id",
              displayName: null,
              lastUsedAt: null,
            }),
          ],
          recentGroups: [],
          successGroups: [],
        });

        const result = await service.getHealthScores();
        expect(result[0].name).toBe("fallback-id");
      });

      it("uses displayName when present", async () => {
        setupHealthMocks({
          configs: [
            makeSkillConfig({ skillId: "id-1", displayName: "My Skill" }),
          ],
          recentGroups: [
            { capabilityId: "id-1", _count: 5, _avg: { duration: 1000 } },
          ],
          successGroups: [{ capabilityId: "id-1", _count: 5 }],
        });

        const result = await service.getHealthScores();
        expect(result[0].name).toBe("My Skill");
      });

      it("returns lastUsedAt from config", async () => {
        const lastUsed = new Date("2026-02-15T00:00:00Z");
        setupHealthMocks({
          configs: [
            makeSkillConfig({ skillId: "dated-skill", lastUsedAt: lastUsed }),
          ],
          recentGroups: [
            {
              capabilityId: "dated-skill",
              _count: 5,
              _avg: { duration: 1000 },
            },
          ],
          successGroups: [{ capabilityId: "dated-skill", _count: 5 }],
        });

        const result = await service.getHealthScores();
        expect(result[0].lastUsedAt).toEqual(lastUsed);
      });

      it("handles null avgDuration from groupBy by defaulting to 0", async () => {
        setupHealthMocks({
          configs: [makeSkillConfig({ skillId: "null-dur-skill" })],
          recentGroups: [
            {
              capabilityId: "null-dur-skill",
              _count: 5,
              _avg: { duration: null },
            },
          ],
          successGroups: [{ capabilityId: "null-dur-skill", _count: 5 }],
        });

        const result = await service.getHealthScores();
        // avgDuration=0 => latencyScore=100
        expect(result[0].avgDuration).toBe(0);
      });

      it("score is rounded to integer", async () => {
        setupHealthMocks({
          configs: [makeSkillConfig({ skillId: "round-skill" })],
          recentGroups: [
            {
              capabilityId: "round-skill",
              _count: 3,
              _avg: { duration: 1000 },
            },
          ],
          successGroups: [{ capabilityId: "round-skill", _count: 2 }],
        });

        const result = await service.getHealthScores();
        expect(Number.isInteger(result[0].score)).toBe(true);
      });
    });

    describe("multiple skills returned", () => {
      it("returns one entry per config", async () => {
        setupHealthMocks({
          configs: [
            makeSkillConfig({ skillId: "skill-a", lastUsedAt: null }),
            makeSkillConfig({ skillId: "skill-b", lastUsedAt: null }),
            makeSkillConfig({ skillId: "skill-c", lastUsedAt: null }),
          ],
          recentGroups: [],
          successGroups: [],
        });

        const result = await service.getHealthScores();
        expect(result).toHaveLength(3);
      });

      it("correctly maps data for each skill independently", async () => {
        setupHealthMocks({
          configs: [
            makeSkillConfig({ skillId: "skill-a" }),
            makeSkillConfig({ skillId: "skill-b" }),
          ],
          recentGroups: [
            { capabilityId: "skill-a", _count: 10, _avg: { duration: 500 } },
            { capabilityId: "skill-b", _count: 5, _avg: { duration: 500 } },
          ],
          successGroups: [
            { capabilityId: "skill-a", _count: 10 },
            { capabilityId: "skill-b", _count: 2 },
          ],
        });

        const result = await service.getHealthScores();
        const skillA = result.find((r) => r.skillId === "skill-a");
        const skillB = result.find((r) => r.skillId === "skill-b");
        expect(skillA?.successRate).toBe(1);
        expect(skillB?.successRate).toBeCloseTo(2 / 5);
      });
    });
  });

  // =========================================================================
  // getUnusedSkills
  // =========================================================================

  describe("getUnusedSkills", () => {
    it("queries only enabled skills with lastUsedAt null or older than cutoff", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([]);
      await service.getUnusedSkills(30);

      const callArgs = prisma.skillConfig.findMany.mock.calls[0][0];
      expect(callArgs.where.enabled).toBe(true);
      expect(callArgs.where.OR).toBeDefined();
      expect(callArgs.where.OR[0]).toEqual({ lastUsedAt: null });
      expect(callArgs.where.OR[1].lastUsedAt).toHaveProperty("lt");
    });

    it("returns skills with lastUsedAt=null", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        makeSkillConfig({
          skillId: "never-used",
          displayName: "Never Used",
          lastUsedAt: null,
          usageCount: 0,
        }),
      ]);

      const result = await service.getUnusedSkills(30);
      expect(result).toHaveLength(1);
      expect(result[0].skillId).toBe("never-used");
      expect(result[0].lastUsedAt).toBeNull();
    });

    it("returns skills with lastUsedAt older than cutoff", async () => {
      const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      prisma.skillConfig.findMany.mockResolvedValue([
        makeSkillConfig({
          skillId: "stale-skill",
          displayName: "Stale",
          lastUsedAt: oldDate,
          usageCount: 5,
        }),
      ]);

      const result = await service.getUnusedSkills(30);
      expect(result[0].skillId).toBe("stale-skill");
      expect(result[0].usageCount).toBe(5);
    });

    it("uses default of 30 days when days param is omitted", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([]);
      const before = Date.now();
      await service.getUnusedSkills();
      const callArgs = prisma.skillConfig.findMany.mock.calls[0][0];
      const cutoffTime = callArgs.where.OR[1].lastUsedAt.lt.getTime();
      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      // Allow 2 hours tolerance for DST transitions across the 30-day window
      expect(before - cutoffTime).toBeGreaterThanOrEqual(
        expectedMs - 2 * 60 * 60 * 1000,
      );
    });

    it("respects custom days parameter", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([]);
      const before = Date.now();
      await service.getUnusedSkills(60);
      const callArgs = prisma.skillConfig.findMany.mock.calls[0][0];
      const cutoffTime = callArgs.where.OR[1].lastUsedAt.lt.getTime();
      const expectedMs = 60 * 24 * 60 * 60 * 1000;
      // Allow 2 hours tolerance for DST transitions across the 60-day window
      expect(before - cutoffTime).toBeGreaterThanOrEqual(
        expectedMs - 2 * 60 * 60 * 1000,
      );
    });

    it("maps displayName to name field, falls back to skillId", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        makeSkillConfig({
          skillId: "sk-1",
          displayName: "Skill One",
          lastUsedAt: null,
        }),
        makeSkillConfig({
          skillId: "sk-2",
          displayName: null,
          lastUsedAt: null,
        }),
      ]);

      const result = await service.getUnusedSkills(30);
      expect(result.find((r) => r.skillId === "sk-1")?.name).toBe("Skill One");
      expect(result.find((r) => r.skillId === "sk-2")?.name).toBe("sk-2");
    });

    it("returns empty array when no unused skills found", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([]);
      const result = await service.getUnusedSkills(30);
      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // getTopSkills
  // =========================================================================

  describe("getTopSkills", () => {
    function makeGroupByResult(skillId: string, count: number) {
      return { capabilityId: skillId, _count: count };
    }

    beforeEach(() => {
      // Default: skillConfig.findMany returns name mappings
      prisma.skillConfig.findMany.mockResolvedValue([
        { skillId: "skill-a", displayName: "Alpha Skill" },
        { skillId: "skill-b", displayName: "Beta Skill" },
        { skillId: "skill-c", displayName: null },
      ]);
    });

    describe("metric=usage (default)", () => {
      beforeEach(() => {
        prisma.aIUsageLog.groupBy.mockResolvedValue([
          makeGroupByResult("skill-a", 50),
          makeGroupByResult("skill-b", 30),
        ]);
      });

      it("returns skills ordered by usage count", async () => {
        const result = await service.getTopSkills("usage");
        expect(result[0].skillId).toBe("skill-a");
        expect(result[0].value).toBe(50);
      });

      it("enriches results with skill names", async () => {
        const result = await service.getTopSkills("usage");
        expect(result[0].name).toBe("Alpha Skill");
        expect(result[1].name).toBe("Beta Skill");
      });

      it("queries without success filter for usage metric", async () => {
        await service.getTopSkills("usage");
        const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
        expect(callArgs.where.success).toBeUndefined();
      });

      it("defaults to metric=usage and limit=10", async () => {
        await service.getTopSkills();
        const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
        expect(callArgs.take).toBe(10);
      });
    });

    describe("metric=success", () => {
      beforeEach(() => {
        prisma.aIUsageLog.groupBy.mockResolvedValue([
          makeGroupByResult("skill-a", 45),
          makeGroupByResult("skill-b", 20),
        ]);
      });

      it("queries with success=true filter", async () => {
        await service.getTopSkills("success");
        const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
        expect(callArgs.where.success).toBe(true);
      });

      it("returns enriched entries by success count", async () => {
        const result = await service.getTopSkills("success");
        expect(result[0].value).toBe(45);
      });
    });

    describe("metric=failure", () => {
      beforeEach(() => {
        prisma.aIUsageLog.groupBy.mockResolvedValue([
          makeGroupByResult("skill-b", 10),
        ]);
      });

      it("queries with success=false filter", async () => {
        await service.getTopSkills("failure");
        const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
        expect(callArgs.where.success).toBe(false);
      });

      it("returns enriched entries by failure count", async () => {
        const result = await service.getTopSkills("failure");
        expect(result[0].value).toBe(10);
      });
    });

    describe("custom limit", () => {
      it("passes custom limit to groupBy", async () => {
        prisma.aIUsageLog.groupBy.mockResolvedValue([]);
        await service.getTopSkills("usage", 5);
        const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
        expect(callArgs.take).toBe(5);
      });
    });

    describe("empty results", () => {
      it("returns empty array when no usage logs exist", async () => {
        prisma.aIUsageLog.groupBy.mockResolvedValue([]);
        const result = await service.getTopSkills("usage");
        expect(result).toHaveLength(0);
        // enrichSkillEntries short-circuits for empty input without querying skillConfig
        expect(prisma.skillConfig.findMany).not.toHaveBeenCalled();
      });
    });

    describe("name fallback in enrichment", () => {
      it("falls back to skillId when displayName is null", async () => {
        prisma.aIUsageLog.groupBy.mockResolvedValue([
          makeGroupByResult("skill-c", 5),
        ]);
        const result = await service.getTopSkills("usage");
        expect(result[0].name).toBe("skill-c");
      });

      it("falls back to skillId when skillConfig entry is missing", async () => {
        prisma.aIUsageLog.groupBy.mockResolvedValue([
          makeGroupByResult("unknown-skill", 3),
        ]);
        prisma.skillConfig.findMany.mockResolvedValue([]);
        const result = await service.getTopSkills("usage");
        expect(result[0].name).toBe("unknown-skill");
      });
    });
  });

  // =========================================================================
  // getDomainBreakdown
  // =========================================================================

  describe("getDomainBreakdown", () => {
    it("returns empty array when no domain data exists", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([]);
      const result = await service.getDomainBreakdown("7d");
      expect(result).toHaveLength(0);
    });

    it("groups results by domain with correct count", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        { domain: "writing", _count: 80 },
        { domain: "research", _count: 20 },
      ]);

      const result = await service.getDomainBreakdown("7d");
      const writing = result.find((r) => r.domain === "writing");
      expect(writing?.count).toBe(80);
    });

    it("calculates percentage relative to total", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        { domain: "writing", _count: 80 },
        { domain: "research", _count: 20 },
      ]);

      const result = await service.getDomainBreakdown("7d");
      const writing = result.find((r) => r.domain === "writing");
      expect(writing?.percentage).toBeCloseTo(80 / 100);
      const research = result.find((r) => r.domain === "research");
      expect(research?.percentage).toBeCloseTo(20 / 100);
    });

    it("percentages sum to 1 for multiple domains", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        { domain: "writing", _count: 50 },
        { domain: "research", _count: 30 },
        { domain: "coding", _count: 20 },
      ]);

      const result = await service.getDomainBreakdown("7d");
      const total = result.reduce((sum, r) => sum + r.percentage, 0);
      expect(total).toBeCloseTo(1);
    });

    it("uses 'unknown' for null domain values", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        { domain: null, _count: 10 },
      ]);

      const result = await service.getDomainBreakdown("7d");
      expect(result[0].domain).toBe("unknown");
    });

    it("passes domain not null filter in query", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([]);
      await service.getDomainBreakdown("30d");
      const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
      expect(callArgs.where.domain).toEqual({ not: null });
    });

    it("passes capabilityType=skill in query", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([]);
      await service.getDomainBreakdown("24h");
      const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
      expect(callArgs.where.capabilityType).toBe("skill");
    });

    it("single domain has percentage=1", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        { domain: "writing", _count: 100 },
      ]);

      const result = await service.getDomainBreakdown("7d");
      expect(result[0].percentage).toBe(1);
    });
  });

  // =========================================================================
  // getCostAnalysis
  // =========================================================================

  describe("getCostAnalysis", () => {
    it("returns empty array when no usage logs exist", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([]);
      const result = await service.getCostAnalysis("7d");
      expect(result).toHaveLength(0);
    });

    it("groups by skill and sums tokensUsed", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        { skillId: "skill-a", displayName: "Alpha" },
      ]);
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        {
          capabilityId: "skill-a",
          _sum: { tokensUsed: 5000, inputTokens: 3000, outputTokens: 2000 },
          _count: 10,
        },
      ]);

      const result = await service.getCostAnalysis("7d");
      expect(result[0].skillId).toBe("skill-a");
      expect(result[0].value).toBe(5000);
    });

    it("enriches results with skill names", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        { skillId: "skill-a", displayName: "Alpha Skill" },
      ]);
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        {
          capabilityId: "skill-a",
          _sum: { tokensUsed: 1000, inputTokens: 600, outputTokens: 400 },
          _count: 5,
        },
      ]);

      const result = await service.getCostAnalysis("7d");
      expect(result[0].name).toBe("Alpha Skill");
    });

    it("treats null tokensUsed sum as 0", async () => {
      prisma.skillConfig.findMany.mockResolvedValue([
        { skillId: "skill-b", displayName: "Beta" },
      ]);
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        {
          capabilityId: "skill-b",
          _sum: { tokensUsed: null, inputTokens: null, outputTokens: null },
          _count: 1,
        },
      ]);

      const result = await service.getCostAnalysis("7d");
      expect(result[0].value).toBe(0);
    });

    it("queries with capabilityType=skill", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([]);
      await service.getCostAnalysis("30d");
      const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
      expect(callArgs.where.capabilityType).toBe("skill");
    });

    it("limits results to top 20 by tokensUsed", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([]);
      await service.getCostAnalysis("7d");
      const callArgs = prisma.aIUsageLog.groupBy.mock.calls[0][0];
      expect(callArgs.take).toBe(20);
    });

    it("returns results for all ranges", async () => {
      for (const range of ["24h", "7d", "30d"] as const) {
        jest.clearAllMocks();
        prisma.aIUsageLog.groupBy.mockResolvedValue([]);
        const result = await service.getCostAnalysis(range);
        expect(Array.isArray(result)).toBe(true);
      }
    });
  });

  // =========================================================================
  // Private helper: percentile (exercised via getSkillMetrics)
  // =========================================================================

  describe("percentile helper (via getSkillMetrics)", () => {
    it("returns correct p50 for even-length array", async () => {
      // sorted durations: [100, 200, 300, 400]
      prisma.aIUsageLog.findMany.mockResolvedValue([
        makeLogRow({ duration: 300 }),
        makeLogRow({ duration: 100 }),
        makeLogRow({ duration: 400 }),
        makeLogRow({ duration: 200 }),
      ]);

      const result = await service.getSkillMetrics("s", "7d");
      // p50 index = ceil(0.5*4)-1 = 2-1=1 => sorted[1]=200
      expect(result.latencyPercentiles.p50).toBe(200);
    });

    it("returns the single element for single-element array", async () => {
      prisma.aIUsageLog.findMany.mockResolvedValue([
        makeLogRow({ duration: 750 }),
      ]);

      const result = await service.getSkillMetrics("s", "7d");
      expect(result.latencyPercentiles.p50).toBe(750);
      expect(result.latencyPercentiles.p95).toBe(750);
      expect(result.latencyPercentiles.p99).toBe(750);
    });
  });

  // =========================================================================
  // Private helper: enrichSkillEntries (exercised via getTopSkills)
  // =========================================================================

  describe("enrichSkillEntries helper (via getTopSkills)", () => {
    it("returns empty array without querying DB when input is empty", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([]);
      await service.getTopSkills("usage");
      expect(prisma.skillConfig.findMany).not.toHaveBeenCalled();
    });

    it("queries skillConfig with correct skillId in-filter", async () => {
      prisma.aIUsageLog.groupBy.mockResolvedValue([
        { capabilityId: "skill-x", _count: 5 },
        { capabilityId: "skill-y", _count: 3 },
      ]);
      prisma.skillConfig.findMany.mockResolvedValue([]);

      await service.getTopSkills("usage");

      const callArgs = prisma.skillConfig.findMany.mock.calls[0][0];
      expect(callArgs.where.skillId).toEqual({ in: ["skill-x", "skill-y"] });
    });
  });
});
