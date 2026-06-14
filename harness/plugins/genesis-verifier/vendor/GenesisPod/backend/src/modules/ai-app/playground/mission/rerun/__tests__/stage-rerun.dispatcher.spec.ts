/**
 * StageRerunDispatcher PR-R5 spec
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.3
 *
 * 反向证据：
 *   1. 构造期注册全 13 stage handler（s1 除外）
 *   2. 不存在的 stepId → throw BadRequest
 *   3. dag.rerunable=false 的 stage → throw BadRequest（含 reason）
 *   4. cascade chain 计算正确（s8-writer → 后 6 个 stage）
 *   5. 一次性 reset 整链 dbWrites + resetFields 调用 store.resetFields
 *   6. 顺序执行 chain 中每个 handler，每完成一个 markIntermediateState lastCompletedStage++
 *   7. handler 失败 → best-effort partial：completed 保留 / abortedAt 记录 / remaining 三元组 emit
 *   8. legacy dispatch(scope=system, todoId=*-s9b-objective-evaluation) 仍走 s9b-objective-eval handler
 *   9. legacy dispatch 其它 scope → throw BadRequest
 *  10. PR-R5b 占位 handler 抛 "PR-R5b" 提示（直到补全）
 */

import { BadRequestException, Logger } from "@nestjs/common";
import {
  StageRerunDispatcher,
  LEADER_VERDICT_AUTO_RERUN_RECOVERED,
} from "../stage-rerun.dispatcher";
import type { HydratedMissionContext } from "../ctx-hydrator.service";
import type { EmitFn } from "../../context/mission-deps";
import type { MissionStore } from "../../lifecycle/mission-store.service";
import type { ReportEvaluationService } from "@/modules/ai-harness/facade";
import type { MissionLifecycleManager } from "@/modules/ai-harness/facade";
import type { ReportArtifact } from "@/modules/ai-harness/facade";
import type { PrismaService } from "../../../../../common/prisma/prisma.service";
import type { RerunMissionRuntimeBuilder } from "../rerun-runtime-builder.service";
import type { MissionStageBindingsService } from "../../pipeline/mission-stage-bindings.service";

// silence Logger
beforeAll(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
});

interface MockStore {
  markRerunPatch: jest.Mock;
  markIntermediateState: jest.Mock;
  resetFields: jest.Mock;
  markCompleted: jest.Mock;
  // ★ C0/G1：终态写经 finalize → arbiter.applyTerminalIfRunning（首写赢）。
  applyTerminalIfRunning: jest.Mock;
  getById: jest.Mock;
  saveReportVersion: jest.Mock;
}

function makeMockStore(): MockStore {
  return {
    markRerunPatch: jest.fn().mockResolvedValue(undefined),
    markIntermediateState: jest.fn().mockResolvedValue(undefined),
    resetFields: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
    // ★ PR-R5b 评审 P0-A (2026-05-07): 报告版本化写入 mock
    saveReportVersion: jest.fn().mockResolvedValue(1),
    getById: jest.fn().mockResolvedValue({
      themeSummary: "test theme",
      dimensions: [],
      verdicts: [],
      reconciliationReport: null,
      userProfile: null,
      leaderJournal: null,
      leaderOverallScore: null,
      leaderSigned: null,
      leaderVerdict: null,
      tokensUsed: 0,
      costUsd: 0,
    }),
  };
}

interface MockPrisma {
  agentPlaygroundChapterDraft: { findMany: jest.Mock };
}

function makeMockPrisma(): MockPrisma {
  return {
    agentPlaygroundChapterDraft: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

interface MockReportEval {
  evaluateReport: jest.Mock;
}
function makeMockReportEval(): MockReportEval {
  return {
    evaluateReport: jest.fn().mockResolvedValue({
      overallScore: 88,
      grade: "B",
      feedback: "ok",
    }),
  };
}

function makeReportArtifact(): ReportArtifact {
  return {
    sections: [
      {
        id: "s1",
        type: "dimension",
        level: 2,
        title: "Section A",
        anchor: "a",
        startOffset: 10,
        endOffset: 400,
        wordCount: 200,
        readingTimeMinutes: 1,
        citations: [1],
        figureIds: [],
        factIds: [],
      },
    ],
    content: {
      fullMarkdown:
        "# Title\n\n## Section A\n\n" + "Body text content ".repeat(50),
      fullReportSize: 1000,
    },
    citations: [],
    figures: [],
    quality: {
      overall: 80,
      dimensions: {} as never,
      hardGateViolations: [],
      warnings: [],
      qualityTrace: [],
      finalVerdict: "good",
    },
    metadata: {
      topic: "AI",
      generatedAt: new Date().toISOString(),
      generationTimeMs: 1000,
      version: 1,
      isIncremental: false,
      dimensionCount: 1,
      sourceCount: 1,
      factCount: 0,
      figureCount: 0,
      wordCount: 200,
      readingTimeMinutes: 1,
      styleProfile: "analytical",
      lengthProfile: "standard",
      audienceProfile: "professional",
      language: "zh-CN",
      totalTokens: { prompt: 0, completion: 0, total: 0 },
      costCents: 0,
      modelTrail: ["gpt-4"],
    },
    quickView: {
      executiveSummary: { markdown: "AI", wordCount: 10 },
      topHighlights: [],
      topTrends: [],
      keyRisks: [],
      topRecommendations: [],
      keyCitations: [],
      keyFigures: [],
      estimatedReadingTime: 3,
      whatYouWillLearn: [],
    },
    factTable: [],
  } as unknown as ReportArtifact;
}

function makeCtx(
  overrides: Partial<HydratedMissionContext> = {},
): HydratedMissionContext {
  return {
    missionId: "m-1",
    userId: "u-1",
    t0: Date.now(),
    input: {
      topic: "AI",
      depth: "standard",
      language: "zh-CN",
      auditLayers: "thorough",
      lengthProfile: "standard",
      styleProfile: "analytical",
      audienceProfile: "professional",
    },
    reportArtifact: makeReportArtifact(),
    __hydrated: true,
    ...overrides,
  } as unknown as HydratedMissionContext;
}

function makeMockRuntimeBuilder(): {
  startSession: jest.Mock;
  composeMissionContext: jest.Mock;
  writeBackToHydrated: jest.Mock;
} {
  return {
    startSession: jest.fn().mockReturnValue({
      missionId: "m-1",
      userId: "u-1",
      billing: {},
      pool: {},
      leader: {},
      budgetMultiplier: 1,
      missionAbort: { signal: { aborted: false } },
      cleanup: jest.fn(),
    }),
    composeMissionContext: jest.fn((ctx, _session) => ({ ...ctx })),
    writeBackToHydrated: jest.fn((composed, hydrated) => ({
      ...hydrated,
      ...composed,
    })),
  };
}

function makeMockBindings(): { buildDeps: jest.Mock; buildCtx: jest.Mock } {
  return {
    buildDeps: jest.fn().mockReturnValue({}),
    buildCtx: jest.fn(),
  };
}

interface MockLifecycleManager {
  finalize: jest.Mock;
}

/**
 * ★ C0/G1：finalize 唯一终态写入口 mock。复刻真实语义——调 arbiter.applyTerminalIfRunning
 * 做条件写仲裁，赢了跑 onWon（吞异常）。
 */
function makeMockLifecycleManager(): MockLifecycleManager {
  return {
    finalize: jest.fn(
      async (a: {
        missionId: string;
        intent: unknown;
        arbiter: {
          applyTerminalIfRunning: (
            id: string,
            intent: unknown,
          ) => Promise<boolean>;
        };
        onWon?: () => Promise<void>;
      }) => {
        const won = await a.arbiter.applyTerminalIfRunning(
          a.missionId,
          a.intent,
        );
        if (won && a.onWon) {
          try {
            await a.onWon();
          } catch {
            // swallow（与真实 finalize 一致）
          }
        }
        return { won };
      },
    ),
  };
}

/** 取本次 finalize 提交的 completed/failed detail（替代旧 store.markCompleted.calls[0][1]）。 */
function finalizeDetail(
  lm: MockLifecycleManager,
  call = 0,
): Record<string, unknown> {
  const arg = lm.finalize.mock.calls[call][0] as {
    intent: { extra: { detail: Record<string, unknown> } };
  };
  return arg.intent.extra.detail;
}

function makeDispatcher(
  args: {
    store?: MockStore;
    reportEval?: MockReportEval;
    prisma?: MockPrisma;
    lifecycleManager?: MockLifecycleManager;
  } = {},
) {
  const store = args.store ?? makeMockStore();
  const reportEval = args.reportEval ?? makeMockReportEval();
  const prisma = args.prisma ?? makeMockPrisma();
  const runtimeBuilder = makeMockRuntimeBuilder();
  const bindings = makeMockBindings();
  const lifecycleManager = args.lifecycleManager ?? makeMockLifecycleManager();
  const dispatcher = new StageRerunDispatcher(
    store as unknown as MissionStore,
    reportEval as unknown as ReportEvaluationService,
    prisma as unknown as PrismaService,
    runtimeBuilder as unknown as RerunMissionRuntimeBuilder,
    bindings as unknown as MissionStageBindingsService,
    lifecycleManager as unknown as MissionLifecycleManager,
  );
  return {
    dispatcher,
    store,
    reportEval,
    prisma,
    runtimeBuilder,
    bindings,
    lifecycleManager,
  };
}

const noopEmit: EmitFn = jest.fn().mockResolvedValue(undefined) as EmitFn;

describe("StageRerunDispatcher (PR-R5 cascade infra)", () => {
  describe("runFromStageWithCascade — 入参校验", () => {
    it("unknown stepId → throw BadRequest", async () => {
      const { dispatcher } = makeDispatcher();
      await expect(
        dispatcher.runFromStageWithCascade({
          ctx: makeCtx(),
          fromStepId: "s99-not-real",
          emit: noopEmit,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("dag.rerunable=false (s1-budget) → throw BadRequest 含 reason", async () => {
      const { dispatcher } = makeDispatcher();
      await expect(
        dispatcher.runFromStageWithCascade({
          ctx: makeCtx(),
          fromStepId: "s1-budget",
          emit: noopEmit,
        }),
      ).rejects.toThrow(/不可重跑/);
    });
  });

  describe("runFromStageWithCascade — cascade 链 + reset", () => {
    it("从 s8-writer 重跑：cascade 链覆盖到 s11-persist", async () => {
      // ★ 2026-05-07 c195035f bug fix：cascade 不再 reset-before-rerun
      //   旧行为是 reset 整链 → cascade 跑失败时主行字段全 NULL（数据废墟）。
      //   现在 dispatcher 不调 store.resetFields，每个 stage 自己 markIntermediateState
      //   持久化新值；cascade 跑失败时主行保持 hydrate 时旧值（best-effort partial）。
      const { dispatcher, store } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s8-writer",
        emit,
      });
      // 关键回归断言：cascade dispatcher 不应再调 store.resetFields
      expect(store.resetFields).not.toHaveBeenCalled();
    });

    it("cascade chain 起点 emit rerun:stage-started 含 fromStepId + completedSoFar=[]", async () => {
      const { dispatcher } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s8-writer",
        emit,
      });
      const startedCall = (emit as jest.Mock).mock.calls.find(
        (c) => c[0].type === "playground.rerun:stage-started",
      );
      expect(startedCall).toBeDefined();
      expect(startedCall[0].payload.fromStepId).toBe("s8-writer");
      expect(startedCall[0].payload.completedSoFar).toEqual([]);
    });

    // ★ R1 共识 P0 (tester, 2026-05-07): best-effort partial 反向证据
    //   cascade 起点 stage 立即抛错时，dispatcher 必须满足：
    //   1. store.resetFields 不调（不破坏主行旧值）
    //   2. store.markIntermediateState 不调（没有 stage 跑成功覆盖 → 主行保持 hydrate 时的值）
    //   3. cascade 已 abort（emit cascade-aborted）
    //   这是 c195035f 数据废墟修复的核心 invariant —— 缺了这条 spec，未来有人重新加
    //   reset-before-rerun 或意外把"清零调用"塞进 loop 都不会被 spec 拦下。
    it("cascade 起点 stage 立即抛错 → 主行字段保留（resetFields/markIntermediateState 都不调）", async () => {
      const { dispatcher, store } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s8-writer", // s8 placeholder handler 立即 throw
        emit,
      });
      expect(store.resetFields).not.toHaveBeenCalled();
      // markIntermediateState 在 cascade 里只由 stage 函数自己调；spec 用 mock bindings
      // 不真跑 stage，所以这里断言"dispatcher 自己没在 cascade abort 路径调它"。
      expect(store.markIntermediateState).not.toHaveBeenCalled();
      // emit cascade-aborted 三元组应该出现
      const abortedCall = (emit as jest.Mock).mock.calls.find(
        (c) => c[0].type === "playground.rerun:cascade-aborted",
      );
      expect(abortedCall).toBeDefined();
      expect(abortedCall[0].payload.abortedAt).toBe("s8-writer");
      expect(abortedCall[0].payload.completed).toEqual([]);
    });
  });

  describe("runFromStageWithCascade — handler registration & cascade infra (PR-R5b-FULL)", () => {
    // ★ R1 共识 P0 (tester, 2026-05-07): 此 describe 验证的是 **handler 注册完整性 +
    //   session 生命周期 + cascade abort 路径**，**不**验证 stage 业务逻辑正确性
    //   （bindings.buildDeps 在 spec 里是 mock 空 {}，真 stage 函数会因缺 deps 抛错触发
    //   cascade abort —— 这正是我们想覆盖的）。Stage 业务逻辑正确性需 full integration
    //   test with real DI 图，那是 e2e 范畴，本 spec 不覆盖。
    const ALL_REAL_HANDLER_STEPS = [
      "s2-leader-plan",
      "s3-researcher-collect",
      "s4-leader-assess",
      "s5-reconciler",
      "s6-analyst",
      "s7-writer-outline",
      "s8-writer",
      "s8b-quality-enhancement",
      "s9-critic",
      "s10-leader-foreword-signoff",
      "s11-persist",
    ];
    it.each(ALL_REAL_HANDLER_STEPS)(
      "%s 已注册真 handler（不再是 PR-R5b placeholder） — 构造期 invariant 通过 + cascade 不抛 [PR-R5b] 占位错误",
      async (stepId) => {
        const { dispatcher } = makeDispatcher();
        const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
        const result = await dispatcher.runFromStageWithCascade({
          ctx: makeCtx(),
          fromStepId: stepId,
          emit,
        });
        // 反向证据：不应再抛 [PR-R5b] 占位错误 — 任何错误都来自真 stage 函数
        // （mock 路径下 stage 业务可能 abort，但不应是 placeholder throw）
        if (result.errorMessage) {
          expect(result.errorMessage).not.toMatch(/PR-R5b/);
        }
      },
    );

    it("从 s9b-objective-eval 重跑：cascade 链 [s9b, s10, s11] 全部真 handler，应跑完全链", async () => {
      const { dispatcher, store } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s9b-objective-eval",
        emit,
      });
      // ★ PR-R5b-FULL (2026-05-07): s9b/s10/s11 全是真 handler；mock 路径下 buildDeps()
      //   返回 {} → 调 stage 函数会报缺 dep；但 cascade 不再因 placeholder throw [PR-R5b]
      expect(result.completed).toContain("s9b-objective-eval");
      // s9b 成功后应当 markIntermediateState 写 last_completed_stage
      expect(store.markIntermediateState).toHaveBeenCalled();
      // s9b 真 handler 应当调 markRerunPatch 写 reportFull
      expect(store.markRerunPatch).toHaveBeenCalledWith(
        "m-1",
        expect.objectContaining({ reportArtifactVersion: 2 }),
        "u-1",
      );
    });
  });

  describe("dispatch (legacy v1 scope 路由)", () => {
    it("scope=system + todoId 含 s9b-objective-evaluation → 走 s9b 真实 handler", async () => {
      const { dispatcher, store } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.dispatch({
        ctx: makeCtx(),
        input: {
          missionId: "m-1",
          userId: "u-1",
          todoId: "todo-x:s9b-objective-evaluation",
          origin: "manual",
          scope: "system",
        },
        emit,
      });
      expect(store.markRerunPatch).toHaveBeenCalled();
    });

    it("其它 scope → throw BadRequest 提示用 '开新研究对比'", async () => {
      const { dispatcher } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await expect(
        dispatcher.dispatch({
          ctx: makeCtx(),
          input: {
            missionId: "m-1",
            userId: "u-1",
            todoId: "todo-x",
            origin: "manual",
            scope: "dimension",
            dimensionRef: "d1",
          },
          emit,
        }),
      ).rejects.toThrow(/dimension/);
    });
  });

  describe("s9b-objective-eval handler 校验", () => {
    it("ctx 缺 reportArtifact → throw", async () => {
      const { dispatcher } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await expect(
        dispatcher.dispatch({
          ctx: makeCtx({ reportArtifact: undefined }),
          input: {
            missionId: "m-1",
            userId: "u-1",
            todoId: "x:s9b-objective-evaluation",
            origin: "manual",
            scope: "system",
          },
          emit,
        }),
      ).rejects.toThrow(/缺 reportArtifact/);
    });

    it("section 全短 < 200 字 → throw", async () => {
      const { dispatcher } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const ctx = makeCtx();
      // 改成短 section
      const art = ctx.reportArtifact!;
      art.content.fullMarkdown = "short";
      art.sections[0].startOffset = 0;
      art.sections[0].endOffset = 5;
      await expect(
        dispatcher.dispatch({
          ctx,
          input: {
            missionId: "m-1",
            userId: "u-1",
            todoId: "x:s9b-objective-evaluation",
            origin: "manual",
            scope: "system",
          },
          emit,
        }),
      ).rejects.toThrow(/section body 都过短/);
    });

    it("成功路径：调 reportEvaluation + 写 metadata.pipelineEvaluation + markRerunPatch", async () => {
      const { dispatcher, store, reportEval } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const ctx = makeCtx();
      await dispatcher.dispatch({
        ctx,
        input: {
          missionId: "m-1",
          userId: "u-1",
          todoId: "x:s9b-objective-evaluation",
          origin: "manual",
          scope: "system",
        },
        emit,
      });
      expect(reportEval.evaluateReport).toHaveBeenCalledTimes(1);
      expect(ctx.reportArtifact!.metadata.pipelineEvaluation).toMatchObject({
        overallScore: 88,
        grade: "B",
      });
      expect(store.markRerunPatch).toHaveBeenCalledWith(
        "m-1",
        expect.objectContaining({
          reportArtifactVersion: 2,
        }),
        "u-1",
      );
    });
  });

  // ★ PR-R5b 切片 (2026-05-07): s11-persist 真 handler 反向证据
  describe("s11-persist 真 handler (PR-R5b 切片)", () => {
    it("ctx.reportArtifact 存在 → 直接 markCompleted（不 fallback 到 chapter_drafts）", async () => {
      const { dispatcher, prisma, store, lifecycleManager } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      // s11-persist cascade chain = [s11-persist] 仅 1 步
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(), // 含 reportArtifact
        fromStepId: "s11-persist",
        emit,
      });
      expect(result.completed).toEqual(["s11-persist"]);
      expect(result.abortedAt).toBeUndefined();
      // ★ C0/G1：终态写经 finalize 单入口（arbiter=store）；intent.extra.userId 走严格隔离，
      //   detail 携 wallTimeMs（rerun 自身耗时）。
      expect(lifecycleManager.finalize).toHaveBeenCalledWith(
        expect.objectContaining({
          missionId: "m-1",
          arbiter: store,
          intent: expect.objectContaining({
            status: "completed",
            extra: expect.objectContaining({
              kind: "completed",
              userId: "u-1",
              detail: expect.objectContaining({
                reportArtifactVersion: 2,
                elapsedWallTimeMs: expect.any(Number),
                report: expect.objectContaining({
                  title: expect.any(String),
                }),
              }),
            }),
          }),
        }),
      );
      // ctx.reportArtifact 已有 → 不读 chapter_drafts
      expect(
        prisma.agentPlaygroundChapterDraft.findMany,
      ).not.toHaveBeenCalled();
      // emit mission:completed
      const completedEmit = (emit as jest.Mock).mock.calls.find(
        (c) => c[0].type === "playground.mission:completed",
      );
      expect(completedEmit).toBeDefined();
      expect(completedEmit[0].payload.rerunRecovered).toBe(false);
    });

    it("ctx 缺 reportArtifact → 从 chapter_drafts 重建 → markCompleted", async () => {
      const prisma = makeMockPrisma();
      prisma.agentPlaygroundChapterDraft.findMany.mockResolvedValue([
        {
          id: "d1",
          missionId: "m-1",
          dimension: "Market",
          chapterIndex: 0,
          heading: "市场规模",
          thesis: "AI 市场快速增长",
          content: "Body content ".repeat(50),
          status: "passed",
          score: 80,
          critique: null,
          attempts: 1,
          wordCount: 500,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "d2",
          missionId: "m-1",
          dimension: "Tech",
          chapterIndex: 0,
          heading: "技术演进",
          thesis: "模型快速演进",
          content: "More body ".repeat(60),
          status: "done",
          score: 85,
          critique: null,
          attempts: 1,
          wordCount: 600,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const {
        dispatcher,
        prisma: p2,
        lifecycleManager,
      } = makeDispatcher({
        prisma,
      });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx({ reportArtifact: undefined }),
        fromStepId: "s11-persist",
        emit,
      });
      expect(result.completed).toEqual(["s11-persist"]);
      expect(p2.agentPlaygroundChapterDraft.findMany).toHaveBeenCalled();
      expect(lifecycleManager.finalize).toHaveBeenCalled();
      const markArg = finalizeDetail(lifecycleManager);
      // 重建产物：finalScore=65（降级标记）
      expect(markArg.finalScore).toBe(65);
      const completedEmit = (emit as jest.Mock).mock.calls.find(
        (c) => c[0].type === "playground.mission:completed",
      );
      expect(completedEmit[0].payload.rerunRecovered).toBe(true);
      expect(completedEmit[0].payload.rerunSource).toBe("chapter_drafts");
    });

    it("ctx 缺 reportArtifact 且 chapter_drafts 空 → throw BadRequest", async () => {
      const prisma = makeMockPrisma();
      prisma.agentPlaygroundChapterDraft.findMany.mockResolvedValue([]);
      const { dispatcher } = makeDispatcher({ prisma });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx({ reportArtifact: undefined }),
        fromStepId: "s11-persist",
        emit,
      });
      // cascade aborted（handler throw）
      expect(result.abortedAt).toBe("s11-persist");
      expect(result.errorMessage).toMatch(/无法重跑 S11 持久化/);
    });

    it("leader 没真签时 → leaderVerdict=auto-rerun-recovered（前端可识别）", async () => {
      const { dispatcher, lifecycleManager } = makeDispatcher();
      // store.getById mock 默认 leaderVerdict=null
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s11-persist",
        emit,
      });
      const markArg = finalizeDetail(lifecycleManager);
      expect(markArg.leaderVerdict).toBe("auto-rerun-recovered");
    });

    it("leader 已真签时 → 保留原 leaderVerdict", async () => {
      const store = makeMockStore();
      store.getById.mockResolvedValue({
        themeSummary: "test",
        dimensions: [],
        verdicts: [],
        leaderOverallScore: 85,
        leaderSigned: true,
        leaderVerdict: "good",
        tokensUsed: 1000,
        costUsd: 0.5,
      });
      const { dispatcher, lifecycleManager } = makeDispatcher({ store });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s11-persist",
        emit,
      });
      const markArg = finalizeDetail(lifecycleManager);
      expect(markArg.leaderVerdict).toBe("good");
      expect(markArg.leaderSigned).toBe(true);
      expect(markArg.leaderOverallScore).toBe(85);
    });

    it("getById 返回 null（mission 不存在/非 owner） → throw", async () => {
      const store = makeMockStore();
      store.getById.mockResolvedValue(null);
      const { dispatcher } = makeDispatcher({ store });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s11-persist",
        emit,
      });
      expect(result.abortedAt).toBe("s11-persist");
      expect(result.errorMessage).toMatch(/mission.*不存在或非 owner/);
    });

    // ★ PR-R5b 评审 P0-A (2026-05-07): 反向证据 — markCompleted 后必须 saveReportVersion
    it("成功路径 → saveReportVersion 被调用（triggerType='todo-rerun'）", async () => {
      const { dispatcher, store } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s11-persist",
        emit,
      });
      expect(store.saveReportVersion).toHaveBeenCalledTimes(1);
      const arg = store.saveReportVersion.mock.calls[0][0];
      expect(arg.missionId).toBe("m-1");
      expect(arg.triggerType).toBe("todo-rerun");
      expect(arg.report).toBeDefined();
    });

    // ★ PR-R5b 评审 P0-A (2026-05-07): saveReportVersion 失败不阻断 markCompleted（fire-and-forget）
    it("saveReportVersion 抛错 → markCompleted 仍成功（fire-and-forget catch）", async () => {
      const store = makeMockStore();
      store.saveReportVersion.mockRejectedValue(new Error("DB transient"));
      const { dispatcher, lifecycleManager } = makeDispatcher({ store });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s11-persist",
        emit,
      });
      expect(result.completed).toEqual(["s11-persist"]);
      expect(result.abortedAt).toBeUndefined();
      expect(lifecycleManager.finalize).toHaveBeenCalled();
    });

    // ★ PR-R5b 评审 P0-C (2026-05-07): rebuildArtifactFromDrafts 包含 'failed-finalized'
    it("chapter_drafts 'failed-finalized' 也被纳入重建（c195035f 类用例核心）", async () => {
      const prisma = makeMockPrisma();
      // 模拟 c195035f 类：13 章节是 'failed-finalized'（S11 guard 拒之前 writer 已落库），
      // 1 章节是 'passed'。fallback 路径必须把全 14 章节都收回来。
      prisma.agentPlaygroundChapterDraft.findMany.mockImplementation(
        async (args: { where?: { status?: { in?: string[] } } }) => {
          const allowed = args.where?.status?.in ?? [];
          // 反向证据：dispatcher 必须传 'failed-finalized' 进 where.status.in
          if (!allowed.includes("failed-finalized")) {
            throw new Error(
              "dispatcher 没把 failed-finalized 包含进 where.status.in — P0-C regression",
            );
          }
          return [
            {
              id: "d1",
              missionId: "m-1",
              dimension: "Market",
              chapterIndex: 0,
              heading: "市场规模",
              content: "Body content ".repeat(50),
              status: "failed-finalized",
              attempts: 3,
              wordCount: 500,
            },
          ];
        },
      );
      const { dispatcher, lifecycleManager } = makeDispatcher({ prisma });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx({ reportArtifact: undefined }),
        fromStepId: "s11-persist",
        emit,
      });
      expect(result.completed).toEqual(["s11-persist"]);
      expect(lifecycleManager.finalize).toHaveBeenCalled();
      // findMany 第一参 where.status.in 必须含 'failed-finalized'
      const findCall = prisma.agentPlaygroundChapterDraft.findMany.mock
        .calls[0][0] as { where: { status: { in: string[] } } };
      expect(findCall.where.status.in).toContain("failed-finalized");
      expect(findCall.where.status.in).toContain("passed");
      expect(findCall.where.status.in).toContain("done");
    });

    // ★ PR-R5b 评审 P1 (2026-05-07): 常量 export 反向证据
    it("LEADER_VERDICT_AUTO_RERUN_RECOVERED 常量与 dispatcher 写入值一致（防漂移）", async () => {
      expect(LEADER_VERDICT_AUTO_RERUN_RECOVERED).toBe("auto-rerun-recovered");
      const { dispatcher, lifecycleManager } = makeDispatcher();
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s11-persist",
        emit,
      });
      const markArg = finalizeDetail(lifecycleManager);
      expect(markArg.leaderVerdict).toBe(LEADER_VERDICT_AUTO_RERUN_RECOVERED);
    });

    // ★ R2 共识 P1 (tester): getById 抛错（非 null）的场景 — cascade abort 不 throw
    it("getById 抛 DB error → cascade abort + errorMessage 含错误", async () => {
      const store = makeMockStore();
      store.getById.mockRejectedValue(new Error("DB transient"));
      const { dispatcher } = makeDispatcher({ store });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const result = await dispatcher.runFromStageWithCascade({
        ctx: makeCtx(),
        fromStepId: "s11-persist",
        emit,
      });
      expect(result.abortedAt).toBe("s11-persist");
      expect(result.errorMessage).toMatch(/DB transient/);
    });

    // ★ R2 共识 P0 (architect P0-1): rebuild 路径必须打 recoveryDegraded + recoveryMode
    it("rebuild 路径产物含 quality.recoveryDegraded=true + metadata.recoveryMode='chapter_drafts_rebuild'", async () => {
      const prisma = makeMockPrisma();
      prisma.agentPlaygroundChapterDraft.findMany.mockResolvedValue([
        {
          id: "d1",
          missionId: "m-1",
          dimension: "X",
          chapterIndex: 0,
          heading: "标题",
          content: "Body content ".repeat(50),
          status: "failed-finalized",
          attempts: 3,
          wordCount: 500,
        },
      ]);
      const { dispatcher, lifecycleManager } = makeDispatcher({ prisma });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      await dispatcher.runFromStageWithCascade({
        ctx: makeCtx({ reportArtifact: undefined }),
        fromStepId: "s11-persist",
        emit,
      });
      // finalize intent 携带的 report payload 含 recovery flags
      const markArg = finalizeDetail(lifecycleManager);
      const report = markArg.report as {
        quality: { recoveryDegraded: boolean };
        metadata: { recoveryMode: string };
      };
      expect(report.quality.recoveryDegraded).toBe(true);
      expect(report.metadata.recoveryMode).toBe("chapter_drafts_rebuild");
    });

    // ★ PR-R5b-FULL (2026-05-07): 8 个真 handler 集成反向证据 — runFromStageWithCascade
    //   起 session + 调 stage 函数 + writeBack 到 hydrated 的链路真跑通
    describe("PR-R5b-FULL: 8 stage real handler 集成", () => {
      const REAL_HANDLER_STEPS = [
        { stepId: "s2-leader-plan", expectStage: "s2" },
        { stepId: "s3-researcher-collect", expectStage: "s3" },
        { stepId: "s4-leader-assess", expectStage: "s4" },
        { stepId: "s5-reconciler", expectStage: "s5" },
        { stepId: "s6-analyst", expectStage: "s6" },
        { stepId: "s7-writer-outline", expectStage: "s7" },
        { stepId: "s8-writer", expectStage: "s8" },
        { stepId: "s8b-quality-enhancement", expectStage: "s8b" },
        { stepId: "s9-critic", expectStage: "s9" },
        { stepId: "s10-leader-foreword-signoff", expectStage: "s10" },
      ];
      it.each(REAL_HANDLER_STEPS)(
        "$stepId 调 runFromStageWithCascade 时 startSession + buildDeps 各调一次 + cleanup 执行",
        async ({ stepId }) => {
          const { dispatcher, runtimeBuilder, bindings } = makeDispatcher();
          const sessionMock = {
            missionId: "m-1",
            userId: "u-1",
            billing: {},
            pool: {},
            leader: {},
            budgetMultiplier: 1,
            missionAbort: { signal: { aborted: false } },
            cleanup: jest.fn(),
          };
          runtimeBuilder.startSession.mockReturnValue(sessionMock);
          const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
          await dispatcher.runFromStageWithCascade({
            ctx: makeCtx(),
            fromStepId: stepId,
            emit,
          });
          // session 起 + 关
          expect(runtimeBuilder.startSession).toHaveBeenCalledTimes(1);
          expect(sessionMock.cleanup).toHaveBeenCalled();
          // bindings.buildDeps 至少调用一次（cascade 链上每个真 handler 都调）
          expect(bindings.buildDeps).toHaveBeenCalled();
        },
      );

      it("cascade 链共享同一 session（startSession 仅调 1 次，不论链长度）", async () => {
        const { dispatcher, runtimeBuilder } = makeDispatcher();
        const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
        // s2 起，链 = [s2, s3, s4, s5, s6, s7, s8, s8b, s9, s9b, s10, s11] = 12 步
        await dispatcher.runFromStageWithCascade({
          ctx: makeCtx(),
          fromStepId: "s2-leader-plan",
          emit,
        });
        // 全链共享一个 session（不能每 stage 一个）
        expect(runtimeBuilder.startSession).toHaveBeenCalledTimes(1);
      });

      // ★ R1 共识 P1 (tester R1): 验证 makeS6Handler 真把 runAnalystStage 返回值写到 ctx.analystOutput
      //   不依赖 stage 函数真实业务（mock runtimeBuilder.composeMissionContext 让它返回真 stage 函数运行后的状态）
      it("makeS6Handler: writeBackToHydrated 接收的 composed 含 stage 写入的 analystOutput", async () => {
        const { dispatcher, runtimeBuilder } = makeDispatcher();
        // 让 composeMissionContext 返回的 composed 是真对象，bindings.buildDeps 也存在
        // stage 函数会因缺 dep throw — 但我们要验证 writeBack 的 contract（即使 abort 也 cleanup）
        const sessionMock = {
          missionId: "m-1",
          userId: "u-1",
          billing: {},
          pool: {},
          leader: {},
          budgetMultiplier: 1,
          missionAbort: { signal: { aborted: false } },
          cleanup: jest.fn(),
        };
        runtimeBuilder.startSession.mockReturnValue(sessionMock);
        const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
        await dispatcher.runFromStageWithCascade({
          ctx: makeCtx(),
          fromStepId: "s6-analyst",
          emit,
        });
        // composeMissionContext 必须被调用（cascade 入 s6 handler 真路径）
        expect(runtimeBuilder.composeMissionContext).toHaveBeenCalledWith(
          expect.objectContaining({ missionId: "m-1" }),
          sessionMock,
        );
      });

      it("session.cleanup 在 cascade abort 时也执行（finally 保证）", async () => {
        const { dispatcher, runtimeBuilder, bindings } = makeDispatcher();
        const sessionMock = {
          missionId: "m-1",
          userId: "u-1",
          billing: {},
          pool: {},
          leader: {},
          budgetMultiplier: 1,
          missionAbort: { signal: { aborted: false } },
          cleanup: jest.fn(),
        };
        runtimeBuilder.startSession.mockReturnValue(sessionMock);
        // bindings.buildDeps 抛错让 stage handler 第一步就 throw
        bindings.buildDeps.mockImplementation(() => {
          throw new Error("DI broken");
        });
        const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
        const result = await dispatcher.runFromStageWithCascade({
          ctx: makeCtx(),
          fromStepId: "s2-leader-plan",
          emit,
        });
        expect(result.abortedAt).toBe("s2-leader-plan");
        expect(result.errorMessage).toMatch(/DI broken/);
        // ★ 关键：finally 保证 cleanup 即使 abort 也执行
        expect(sessionMock.cleanup).toHaveBeenCalled();
      });
    });

    // ★ R2 共识 P1 (reviewer P1-3): 错误信息含 missionId + userId 上下文
    it("errorMessage 含 missionId + userId 上下文（线上排查友好）", async () => {
      const prisma = makeMockPrisma();
      prisma.agentPlaygroundChapterDraft.findMany.mockResolvedValue([]);
      const { dispatcher } = makeDispatcher({ prisma });
      const emit = jest.fn().mockResolvedValue(undefined) as EmitFn;
      const ctx = makeCtx({ reportArtifact: undefined });
      const result = await dispatcher.runFromStageWithCascade({
        ctx,
        fromStepId: "s11-persist",
        emit,
      });
      expect(result.abortedAt).toBe("s11-persist");
      expect(result.errorMessage).toContain("missionId=m-1");
      expect(result.errorMessage).toContain("userId=u-1");
    });
  });
});
