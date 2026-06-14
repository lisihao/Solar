/**
 * CtxHydratorService spec —— PR-R2
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.2 §8.1
 *
 * 反向证据：
 *   - happy: completed mission 全字段重建（含 outline_plan / analyst_output / researcherResults）
 *   - retry_label: 同 dim 多 retry_label 取 latest
 *   - zod 校验：reportFull 损坏 / 字段缺失 → throw BadRequest
 *   - size guard: reportFull > 2MB → throw
 *   - heartbeat 时间窗：< 60s 拒（in-flight），≥ 60s 允许（reopen 等待）
 *   - 不存在 mission → NotFound
 */

import { NotFoundException } from "@nestjs/common";
import { CtxHydratorService } from "../ctx-hydrator.service";
import type {
  MissionStore,
  MissionDetail,
} from "../../lifecycle/mission-store.service";

function buildValidArtifact() {
  return {
    content: { fullMarkdown: "## Report", fullReportSize: 10 },
    sections: [
      {
        id: "sec-1",
        type: "executive_summary",
        level: 2,
        title: "执行摘要",
        anchor: "exec",
        startOffset: 0,
        endOffset: 10,
        wordCount: 5,
        readingTimeMinutes: 1,
        citations: [],
        figureIds: [],
        factIds: [],
      },
    ],
    citations: [],
    figures: [],
    factTable: [],
    quickView: {
      executiveSummary: { markdown: "x", wordCount: 1 },
      estimatedReadingTime: 1,
      topHighlights: [],
      topTrends: [],
      keyRisks: [],
      topRecommendations: [],
      keyCitations: [],
      keyFigures: [],
      whatYouWillLearn: [],
    },
    metadata: {
      topic: "T",
      generatedAt: new Date().toISOString(),
      generationTimeMs: 1000,
      version: 1,
      isIncremental: false,
      dimensionCount: 1,
      sourceCount: 0,
      factCount: 0,
      figureCount: 0,
      wordCount: 5,
      readingTimeMinutes: 1,
      styleProfile: "analytical",
      lengthProfile: "standard",
      audienceProfile: "professional",
      language: "zh-CN",
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
      modelTrail: [],
    },
    quality: {
      overall: 80,
      dimensions: { traceability: 80 },
      hardGateViolations: [],
      warnings: [],
      qualityTrace: [],
      finalVerdict: "good",
    },
  };
}

function buildDetail(overrides: Partial<MissionDetail> = {}): MissionDetail {
  const base = {
    id: "m1",
    topic: "T",
    depth: "deep",
    language: "zh-CN",
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
    wallTimeMs: 1000,
    finalScore: 80,
    tokensUsed: 100,
    costUsd: 0.01,
    reportTitle: "X",
    reportSummary: "Y",
    errorMessage: null,
    maxCredits: 300,
    themeSummary: "ts",
    dimensions: [{ id: "d1", name: "维度一", rationale: "r" }],
    reportFull: buildValidArtifact(),
    verdicts: null,
    trajectoryStored: 0,
    reportArtifactVersion: 2,
    userProfile: { depth: "deep", language: "zh-CN" },
    reconciliationReport: null,
    leaderJournal: null,
    leaderOverallScore: null,
    leaderSigned: null,
    leaderVerdict: null,
    lastCompletedStage: 10,
    outlinePlan: null,
    analystOutput: null,
    heartbeatAt: null,
    ...overrides,
  } as MissionDetail;
  // ★ C5/G7:rerun 现读 configSnapshot;给 mock 配一个由 base 派生的 snapshot(可被 overrides 覆盖,
  //   含传 configSnapshot:null 测 legacy 拒绝)。
  if (!("configSnapshot" in overrides)) {
    base.configSnapshot = {
      schemaVersion: 1,
      snapshotRevision: 0,
      snapshotId: `snap-${base.id}`,
      mutationReason: "fresh",
      resolvedAt: new Date().toISOString(),
      topic: base.topic,
      language: base.language,
      businessInput: {
        depth: base.depth,
        budgetProfile: "medium",
        styleProfile: "executive",
        lengthProfile: "standard",
        audienceProfile: "domain-expert",
        withFigures: true,
        auditLayers: "default",
        concurrency: 3,
        viewMode: "continuous",
        searchTimeRange: "365d",
      },
      budget: {
        maxCredits: base.maxCredits,
        maxTokens: base.maxCredits * 1000,
        creditBudgetProxyUsd: base.maxCredits * 0.002,
        budgetMultiplier: 4,
        source: "default",
        resolvedAt: new Date().toISOString(),
      },
      runtimeLimits: { wallTimeCapMs: 3_600_000 },
    };
  }
  return base;
}

function makeMockStore(detail: MissionDetail | null) {
  return {
    getById: jest.fn().mockResolvedValue(detail),
  } as unknown as MissionStore;
}

function makeMockPrisma(
  opts: {
    rrRows?: Array<{
      dimension: string;
      findings: unknown;
      summary: string | null;
    }>;
    cdRows?: Array<{
      dimension: string;
      chapterIndex: number;
      heading: string;
      content: string;
      wordCount: number | null;
    }>;
    /** 2026-05-07 zombie heartbeat fix: ctx-hydrator 双信号判定需要 mock 最近事件 ts。
     *  缺省 fresh（5s 前）—— 让原 in-flight spec 保持原行为（heartbeat fresh + event fresh → 拒）。
     *  传 null 模拟无事件；传 number 直接用作 ts(ms)。 */
    latestEventTs?: number | null;
  } = {},
) {
  const eventTs = opts.latestEventTs;
  const eventRows: { ts: bigint }[] =
    eventTs === null
      ? []
      : eventTs === undefined
        ? [{ ts: BigInt(Date.now() - 5_000) }]
        : [{ ts: BigInt(eventTs) }];
  return {
    $queryRawUnsafe: jest.fn((sql: string) => {
      // 双信号判定 events 查询走 SELECT ts FROM agent_playground_mission_events
      if (sql.includes("agent_playground_mission_events")) {
        return Promise.resolve(eventRows);
      }
      return Promise.resolve(opts.rrRows ?? []);
    }),
    agentPlaygroundChapterDraft: {
      findMany: jest.fn().mockResolvedValue(opts.cdRows ?? []),
    },
  } as never;
}

describe("CtxHydratorService.hydrate", () => {
  describe("happy path", () => {
    it("completed mission 全字段重建", async () => {
      const store = makeMockStore(buildDetail());
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.__hydrated).toBe(true);
      expect(ctx.missionId).toBe("m1");
      expect(ctx.userId).toBe("u1");
      expect(ctx.input.depth).toBe("deep");
      expect(ctx.plan?.dimensions.length).toBe(1);
      expect(ctx.reportArtifact?.sections.length).toBe(1);
    });

    it("重建 outlinePlan / analystOutput 字段（PR-R0 新列）", async () => {
      const detail = buildDetail({
        outlinePlan: {
          chapterOutlines: [
            {
              sectionId: "s1",
              heading: "H",
              subheadings: [],
              thesis: "T",
              keyPointsToCover: [],
            },
          ],
        },
        analystOutput: { themeSummary: "AS", insights: [] },
      });
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.outlinePlan).toBeDefined();
      expect(ctx.analystOutput).toBeDefined();
    });
  });

  describe("zod 校验（v1.2 类别 E1）", () => {
    // ★ E49 (2026-05-25): 报告 zod 校验失败不再裸抛，降级为重生成（reportArtifact
    //   undefined）→ rerun 不被损坏 snapshot 整体折返。
    it("reportFull 缺 metadata.topic → 降级重生成（不抛，reportArtifact undefined）", async () => {
      const broken = buildValidArtifact();
      delete (broken.metadata as { topic?: string }).topic;
      const detail = buildDetail({ reportFull: broken });
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.reportArtifact).toBeUndefined();
      // 其余字段仍正常复用（input 来自 configSnapshot）
      expect(ctx.input).toBeDefined();
    });

    it("reportFull > 2MB → throw BadRequest（size guard）", async () => {
      const huge = buildValidArtifact();
      // 加超大 metadata 字段（key 数量 50+ 也会 fail，但我们要测 size guard 先于 zod 触发）
      (huge.metadata as Record<string, unknown>).hugeField = "x".repeat(
        4_000_000,
      );
      const detail = buildDetail({ reportFull: huge });
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      await expect(hydrator.hydrate("m1", "u1")).rejects.toThrow(
        /2.000.000|DoS/,
      );
    });

    it("reportFull=null + reportArtifactVersion=null → 无错（report 也为 undefined）", async () => {
      const detail = buildDetail({
        reportFull: null,
        reportArtifactVersion: null,
      });
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.reportArtifact).toBeUndefined();
      expect(ctx.report).toBeUndefined();
    });
  });

  // ★ 2026-05-07 rerun-overhaul v1.1 §4：in-flight 检查从 ctx-hydrator 删除（迁到
  //   RerunGuardService 单点判定）。原 7 个 in-flight 相关 case 全部删除（迁到
  //   rerun-guard.service.spec.ts 9-cell 矩阵）。这里只保 hydrate 业务路径 spec：
  describe("status 行为（in-flight 判定已迁到 RerunGuard）", () => {
    it("status=running 任何 heartbeat 状态都允许 hydrate（不再做 in-flight 判定）", async () => {
      const detail = buildDetail({
        status: "running",
        heartbeatAt: new Date(Date.now() - 1000),
      });
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.__hydrated).toBe(true);
    });

    it("status=failed → 允许（cascade rerun 正常路径）", async () => {
      const detail = buildDetail({ status: "failed" });
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.__hydrated).toBe(true);
    });
  });

  describe("mission 不存在", () => {
    it("getById 返回 null → NotFound", async () => {
      const store = makeMockStore(null);
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      await expect(hydrator.hydrate("m1", "u1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("researcherResults 重建（v1.2 类别 D1+D2）", () => {
    it("DISTINCT ON dimension：同 dim 多 retry_label 不重复 entry", async () => {
      // mock $queryRawUnsafe 已应用 DISTINCT ON 的结果（每 dim 一行）
      const rrRows = [
        {
          dimension: "维度一",
          findings: [{ claim: "c1", evidence: "e1", source: "s1" }],
          summary: "ok1",
        },
        {
          dimension: "维度二",
          findings: [{ claim: "c2", evidence: "e2", source: "s2" }],
          summary: "ok2",
        },
      ];
      const detail = buildDetail();
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma({ rrRows });
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.researcherResults?.length).toBe(2);
      expect(ctx.researcherResults?.[0].dimension).toBe("维度一");
    });

    it("dim 字符串作 chapter join key（不依赖数组 index）", async () => {
      const rrRows = [
        { dimension: "维度一", findings: [], summary: "" },
        { dimension: "维度二", findings: [], summary: "" },
      ];
      // chapter rows 顺序与 dim 不同，验证按 dim 字符串 join
      const cdRows = [
        {
          dimension: "维度二",
          chapterIndex: 1,
          heading: "h2-1",
          content: "body 维度二 ch1",
          wordCount: 5,
        },
        {
          dimension: "维度一",
          chapterIndex: 1,
          heading: "h1-1",
          content: "body 维度一 ch1",
          wordCount: 5,
        },
      ];
      const detail = buildDetail();
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma({ rrRows, cdRows });
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      const r1 = ctx.researcherResults?.find((r) => r.dimension === "维度一");
      const r2 = ctx.researcherResults?.find((r) => r.dimension === "维度二");
      expect(
        (r1 as { chapters?: Array<{ body: string }> })?.chapters?.[0].body,
      ).toContain("维度一");
      expect(
        (r2 as { chapters?: Array<{ body: string }> })?.chapters?.[0].body,
      ).toContain("维度二");
    });

    it("无 chapter_drafts 时不带 chapters 字段", async () => {
      const rrRows = [{ dimension: "维度一", findings: [], summary: "" }];
      const detail = buildDetail();
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma({ rrRows, cdRows: [] });
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.researcherResults?.length).toBe(1);
      expect(
        (ctx.researcherResults?.[0] as { fullMarkdown?: string }).fullMarkdown,
      ).toBeUndefined();
    });

    it("rrRows 为空 → researcherResults=undefined", async () => {
      const detail = buildDetail();
      const store = makeMockStore(detail);
      const prisma = makeMockPrisma({ rrRows: [] });
      const hydrator = new CtxHydratorService(store, prisma);
      const ctx = await hydrator.hydrate("m1", "u1");
      expect(ctx.researcherResults).toBeUndefined();
    });
  });

  describe("stateless / 并发", () => {
    it("Promise.all 并发 hydrate 两个 mission 互不污染", async () => {
      const store = {
        getById: jest
          .fn()
          .mockResolvedValueOnce(buildDetail({ id: "m1", topic: "T1" }))
          .mockResolvedValueOnce(buildDetail({ id: "m2", topic: "T2" })),
      } as unknown as MissionStore;
      const prisma = makeMockPrisma();
      const hydrator = new CtxHydratorService(store, prisma);
      const [c1, c2] = await Promise.all([
        hydrator.hydrate("m1", "u1"),
        hydrator.hydrate("m2", "u1"),
      ]);
      expect(c1.input.topic).toBe("T1");
      expect(c2.input.topic).toBe("T2");
    });
  });
});
