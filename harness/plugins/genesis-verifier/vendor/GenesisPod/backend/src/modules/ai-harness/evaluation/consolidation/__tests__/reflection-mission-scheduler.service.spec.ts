/**
 * ReflectionMissionScheduler spec — PR-I.2~I.4 真实现 2026-05-15
 *
 * 覆盖：
 *   - shouldInjectRules 静态判定
 *   - config 读写 + 持久化到 cache
 *   - runOnce: 抽样不足跳过 / LLM 反思 / Rule 写入 / 跨 pod 锁
 *   - getRulesForMission: top-K 注入 + effective confidence 排序
 *   - recordRuleApplication / disable / enable / delete
 *   - listRules / listRuns / getOverview
 */

import { Test } from "@nestjs/testing";
import { SchedulerRegistry } from "@nestjs/schedule";
import { ReflectionMissionScheduler } from "../reflection-mission-scheduler.service";
import { DEFAULT_CONSOLIDATION_CONFIG } from "../consolidation.types";
import { PrismaService } from "@/common/prisma/prisma.service";
import { CacheService } from "@/common/cache/cache.service";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";

class FakeCache {
  private store = new Map<string, unknown>();
  get<T>(k: string): Promise<T | undefined> {
    return Promise.resolve(this.store.get(k) as T | undefined);
  }
  set<T>(k: string, v: T): Promise<void> {
    this.store.set(k, v);
    return Promise.resolve();
  }
  del(k: string): Promise<void> {
    this.store.delete(k);
    return Promise.resolve();
  }
}

function makePrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    agentPlaygroundMission: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    dreamingRun: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "run-1", ...args.data }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { tokensUsed: 0 } }),
    },
    dreamingRule: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: "rule-" + Math.random().toString(36).slice(2, 8),
          applicationCount: 0,
          successCount: 0,
          disabled: false,
          createdAt: new Date(),
          ...args.data,
        }),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { applicationCount: 0, successCount: 0 } }),
    },
    ...overrides,
  };
}

function makeChatMock(content: string, totalTokens = 100) {
  return {
    chat: jest.fn().mockResolvedValue({
      content,
      model: "test-model",
      usage: { totalTokens },
    }),
  };
}

class FakeSchedulerRegistry {
  private jobs = new Map<string, { start: jest.Mock; stop: jest.Mock }>();
  doesExist(_type: string, name: string): boolean {
    return this.jobs.has(name);
  }
  deleteCronJob(name: string): void {
    this.jobs.delete(name);
  }
  addCronJob(name: string, job: { start: jest.Mock; stop: jest.Mock }): void {
    this.jobs.set(name, job);
  }
}

async function makeService(
  opts: {
    prisma?: ReturnType<typeof makePrismaMock>;
    chat?: ReturnType<typeof makeChatMock>;
    cache?: FakeCache;
  } = {},
) {
  const prisma = opts.prisma ?? makePrismaMock();
  const chat = opts.chat ?? makeChatMock(`{"candidates":[]}`);
  const cache = opts.cache ?? new FakeCache();
  const mod = await Test.createTestingModule({
    providers: [
      ReflectionMissionScheduler,
      { provide: PrismaService, useValue: prisma },
      { provide: AiChatService, useValue: chat },
      { provide: CacheService, useValue: cache },
      { provide: SchedulerRegistry, useValue: new FakeSchedulerRegistry() },
    ],
  }).compile();
  const svc = mod.get(ReflectionMissionScheduler);
  await svc.onModuleInit();
  return { svc, prisma, chat, cache };
}

describe("ReflectionMissionScheduler", () => {
  describe("static shouldInjectRules", () => {
    it("returns false for undefined / shallow / rerun", () => {
      expect(ReflectionMissionScheduler.shouldInjectRules(undefined)).toBe(
        false,
      );
      expect(
        ReflectionMissionScheduler.shouldInjectRules({ depth: "shallow" }),
      ).toBe(false);
      expect(
        ReflectionMissionScheduler.shouldInjectRules({
          depth: "deep",
          isRerun: true,
        }),
      ).toBe(false);
    });
    it("returns true for deep non-rerun", () => {
      expect(
        ReflectionMissionScheduler.shouldInjectRules({ depth: "deep" }),
      ).toBe(true);
    });
  });

  describe("config", () => {
    it("starts with DEFAULT_CONSOLIDATION_CONFIG", async () => {
      const { svc } = await makeService();
      expect(svc.getConfig()).toEqual(DEFAULT_CONSOLIDATION_CONFIG);
    });

    it("setConfig persists to cache and re-registers cron", async () => {
      const { svc, cache } = await makeService();
      await svc.setConfig({ sampleSize: 50, enabled: false });
      expect(svc.getConfig().sampleSize).toBe(50);
      expect(svc.getConfig().enabled).toBe(false);
      const persisted = await cache.get<{ sampleSize: number }>(
        "dreaming:config",
      );
      expect(persisted?.sampleSize).toBe(50);
    });
  });

  describe("runOnce", () => {
    it("skips with insufficient samples (< 3)", async () => {
      const prisma = makePrismaMock();
      prisma.agentPlaygroundMission.findMany.mockResolvedValueOnce([
        { id: "m1", topic: "T", errorMessage: "boom" },
      ]);
      const { svc } = await makeService({ prisma });
      const result = await svc.runOnce({
        kind: "manual",
        detail: "spec",
        triggeredAt: new Date(),
      });
      expect(result.newRules).toEqual([]);
      expect(prisma.dreamingRun.create).toHaveBeenCalled();
      const createArg = prisma.dreamingRun.create.mock.calls[0][0] as {
        data: { triggerDetail: string; status: string };
      };
      expect(createArg.data.triggerDetail).toContain("skip:insufficient");
      expect(createArg.data.status).toBe("success");
    });

    it("invokes LLM, validates candidates, writes new rules", async () => {
      const prisma = makePrismaMock();
      prisma.agentPlaygroundMission.findMany.mockResolvedValueOnce([
        { id: "m1", topic: "T1", errorMessage: "budget exhaust" },
        { id: "m2", topic: "T2", errorMessage: "budget exhaust" },
        { id: "m3", topic: "T3", errorMessage: "budget exhaust" },
      ]);
      const chat = makeChatMock(
        JSON.stringify({
          candidates: [
            {
              pattern:
                "Repeated budget exhaust on deep missions with 3+ dimensions",
              mitigation:
                "Reduce dimension count to 2 or raise maxCredits for depth=deep before launch",
              failureCodes: ["BUDGET_EXHAUST"],
              confidence: 0.8,
            },
            {
              pattern: "Low confidence noise",
              mitigation: "ignore",
              failureCodes: ["X"],
              confidence: 0.3,
            },
          ],
        }),
        500,
      );
      const { svc } = await makeService({ prisma, chat });
      const result = await svc.runOnce({
        kind: "manual",
        detail: "spec",
        triggeredAt: new Date(),
      });
      expect(result.newRules.length).toBe(1);
      expect(result.rejectedCandidates).toBe(1);
      expect(result.tokensUsed).toBe(500);
      expect(prisma.dreamingRule.create).toHaveBeenCalledTimes(1);
    });

    it("dedups against existing rule patterns", async () => {
      const prisma = makePrismaMock();
      prisma.agentPlaygroundMission.findMany.mockResolvedValueOnce([
        { id: "m1", topic: "T1", errorMessage: "x" },
        { id: "m2", topic: "T2", errorMessage: "x" },
        { id: "m3", topic: "T3", errorMessage: "x" },
      ]);
      prisma.dreamingRule.findMany.mockResolvedValueOnce([
        {
          id: "existing",
          pattern: "Repeated budget exhaust on deep missions",
        },
      ]);
      const chat = makeChatMock(
        JSON.stringify({
          candidates: [
            {
              pattern: "Repeated budget exhaust on deep missions",
              mitigation: "reduce dims more than 20 chars long here",
              failureCodes: ["BUDGET_EXHAUST"],
              confidence: 0.9,
            },
          ],
        }),
      );
      const { svc } = await makeService({ prisma, chat });
      const result = await svc.runOnce({
        kind: "manual",
        detail: "spec",
        triggeredAt: new Date(),
      });
      expect(prisma.dreamingRule.create).not.toHaveBeenCalled();
      expect(result.newRules).toEqual([]);
    });

    it("respects pod lock (second concurrent run skipped)", async () => {
      const cache = new FakeCache();
      await cache.set("dreaming:run-lock", Date.now());
      const { svc } = await makeService({ cache });
      const result = await svc.runOnce({
        kind: "cron",
        detail: "0 */6 * * *",
        triggeredAt: new Date(),
      });
      expect(result.newRules).toEqual([]);
      expect(result.tokensUsed).toBe(0);
    });

    it("persists failure run on LLM error", async () => {
      const prisma = makePrismaMock();
      prisma.agentPlaygroundMission.findMany.mockResolvedValueOnce([
        { id: "m1", topic: "T1", errorMessage: "x" },
        { id: "m2", topic: "T2", errorMessage: "x" },
        { id: "m3", topic: "T3", errorMessage: "x" },
      ]);
      const chat = {
        chat: jest.fn().mockRejectedValue(new Error("LLM down")),
      };
      const { svc } = await makeService({
        prisma,
        chat: chat as unknown as ReturnType<typeof makeChatMock>,
      });
      const result = await svc.runOnce({
        kind: "manual",
        detail: "spec",
        triggeredAt: new Date(),
      });
      expect(result.newRules).toEqual([]);
      const failureCall = prisma.dreamingRun.create.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { data: { status: string } }).data.status === "failed",
      );
      expect(failureCall).toBeDefined();
    });
  });

  describe("getRulesForMission", () => {
    it("returns empty when no failure codes", async () => {
      const { svc } = await makeService();
      const set = await svc.getRulesForMission([]);
      expect(set.rules).toEqual([]);
      expect(set.promptSnippet).toBe("");
    });

    it("returns top-5 by effective confidence with prompt snippet", async () => {
      const prisma = makePrismaMock();
      const baseRule = {
        failureCodes: ["BUDGET_EXHAUST"],
        derivedFromMissionIds: [],
        createdAt: new Date(),
        disabled: false,
      };
      prisma.dreamingRule.findMany.mockResolvedValueOnce([
        {
          id: "r-low",
          ...baseRule,
          pattern: "p-low",
          mitigation: "m-low",
          confidence: 0.5,
          applicationCount: 10,
          successCount: 1,
        },
        {
          id: "r-high",
          ...baseRule,
          pattern: "p-high",
          mitigation: "m-high",
          confidence: 0.9,
          applicationCount: 10,
          successCount: 9,
        },
      ]);
      const { svc } = await makeService({ prisma });
      const set = await svc.getRulesForMission(["BUDGET_EXHAUST"]);
      expect(set.rules.length).toBe(2);
      expect(set.rules[0].id).toBe("r-high");
      expect(set.promptSnippet).toContain("p-high");
    });
  });

  describe("rule admin ops", () => {
    it("disableRule / enableRule / deleteRule call prisma update / delete", async () => {
      const prisma = makePrismaMock();
      const { svc } = await makeService({ prisma });
      await svc.disableRule("r1");
      await svc.enableRule("r1");
      await svc.deleteRule("r1");
      expect(prisma.dreamingRule.update).toHaveBeenCalledTimes(2);
      expect(prisma.dreamingRule.delete).toHaveBeenCalledTimes(1);
    });

    it("recordRuleApplication increments counters", async () => {
      const prisma = makePrismaMock();
      const { svc } = await makeService({ prisma });
      await svc.recordRuleApplication("r1", true);
      expect(prisma.dreamingRule.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: {
          applicationCount: { increment: 1 },
          successCount: { increment: 1 },
        },
      });
    });
  });

  describe("admin queries", () => {
    it("getOverview aggregates rule + run stats", async () => {
      const prisma = makePrismaMock();
      prisma.dreamingRule.count.mockResolvedValueOnce(10);
      prisma.dreamingRule.count.mockResolvedValueOnce(8);
      prisma.dreamingRun.count.mockResolvedValueOnce(3);
      prisma.dreamingRule.aggregate.mockResolvedValueOnce({
        _sum: { applicationCount: 50, successCount: 30 },
      });
      prisma.dreamingRun.findFirst.mockResolvedValueOnce({
        triggeredAt: new Date("2026-05-15T00:00:00Z"),
        tokensUsed: 1000,
      });
      prisma.dreamingRun.aggregate.mockResolvedValueOnce({
        _sum: { tokensUsed: 12345 },
      });
      const { svc } = await makeService({ prisma });
      const overview = await svc.getOverview();
      expect(overview.totalRules).toBe(10);
      expect(overview.activeRules).toBe(8);
      expect(overview.recentRunsCount).toBe(3);
      expect(overview.totalTokensSpent).toBe(12345);
      expect(overview.averageSuccessRate).toBe(0.6);
      expect(overview.lastRunAt).toBe("2026-05-15T00:00:00.000Z");
    });

    it("listRuns clamps limit to [1, 100]", async () => {
      const prisma = makePrismaMock();
      const { svc } = await makeService({ prisma });
      await svc.listRuns(9999);
      expect(prisma.dreamingRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
      await svc.listRuns(0);
      expect(prisma.dreamingRun.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });
});
