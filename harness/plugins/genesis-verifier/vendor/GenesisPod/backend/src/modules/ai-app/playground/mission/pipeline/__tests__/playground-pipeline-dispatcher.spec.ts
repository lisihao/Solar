/**
 * PlaygroundPipelineDispatcher spec（v5.1 R2-A.1 smoke）
 *
 * 验证 dispatcher skeleton 装得起来：
 *   1. onModuleInit 注册 PLAYGROUND_PIPELINE 到 registry
 *   2. runMission 在 R2-A.1 阶段会快速 fail（hook 抛 NotYetWiredError）—— 但
 *      orchestrator 路径走通（s1 触发 stage:failed event 而不是 framework
 *      level error）
 *   3. session 在失败后被 cleanup（abort registry / sessions Map 清空）
 *
 * R2-A.2~A.13 实装 14 个 stage hook 后再扩 e2e success-path spec。
 */
// R2-A.5: stub runResearcherDispatchStage —— 实际函数依赖 invoker / writer /
// reviewer 等真服务，单测用 stub mutator 模拟"成功跑 + 写 ctx.researcherResults"
jest.mock("../stages/s3-researcher-collect-findings.stage", () => ({
  runResearcherDispatchStage: jest.fn(async (ctx: Record<string, unknown>) => {
    ctx.researcherResults = [
      {
        dimension: "dim-1",
        findings: [{ claim: "c", evidence: "e", source: "https://x" }],
        summary: "s",
      },
    ];
  }),
}));
// R2-A.6: stub runLeaderAssessResearchStage —— 默认 happy path（leader 不 abort）
jest.mock("../stages/s4-leader-assess-research.stage", () => ({
  runLeaderAssessResearchStage: jest.fn(
    async (_ctx: Record<string, unknown>) => {
      // legacy 内部 mutates ctx；mock 不动，让 hook 把已有 entry.lastResearcherResults 透传
    },
  ),
}));
// R2-A.7: stub runReconcilerStage
jest.mock("../stages/s5-reconciler-cross-dim-fact-check.stage", () => ({
  runReconcilerStage: jest.fn(async (ctx: Record<string, unknown>) => {
    ctx.reconciliationReport = {
      factTable: [],
      conflicts: [],
      overlaps: [],
      gaps: [],
      figureCandidates: [],
      reconciliationReport: "test reconciliation",
    };
  }),
}));
// R2-A.8: stub runAnalystStage
jest.mock("../stages/s6-analyst-synthesize-insights.stage", () => ({
  runAnalystStage: jest.fn(async (ctx: Record<string, unknown>) => {
    ctx.analystOutput = {
      themeSummary: "test theme",
      insights: [
        {
          headline: "i1",
          narrative: "...",
          supportingDimensions: ["d1", "d2"],
        },
      ],
    };
  }),
}));
// R2-A.9: stub runWriterOutlineStage
jest.mock("../stages/s7-writer-plan-outline.stage", () => ({
  runWriterOutlineStage: jest.fn(async (_ctx: Record<string, unknown>) => {
    // quick depth → no-op，outline 留 undefined（合法情况）
  }),
}));
// R2-A.10: stub runWriterStage
jest.mock("../stages/s8-writer-draft-report.stage", () => ({
  runWriterStage: jest.fn(async (ctx: Record<string, unknown>) => {
    ctx.report = {
      title: "Test Report",
      sections: [{ heading: "intro", body: "..." }],
      citations: ["https://x"],
    };
    ctx.reportArtifact = {
      sections: [{ id: "s1", title: "intro" }],
      content: { fullMarkdown: "# Test\n..." },
      metadata: { topic: "test" },
      quality: { warnings: [], overall: 80 },
    };
    ctx.reviewScore = 80;
    ctx.verifierVerdicts = [];
  }),
}));
// R2-A.11: stub 三个 review stage
jest.mock("../stages/s8b-section-quality-enhancement.stage", () => ({
  runSectionQualityEnhancementStage: jest.fn(async (_ctx: unknown) => {}),
}));
jest.mock("../stages/s9-reviewer-critic-l4.stage", () => ({
  runCriticStage: jest.fn(async (_ctx: unknown) => {}),
}));
jest.mock("../stages/s9b-report-objective-evaluation.stage", () => ({
  runReportObjectiveEvaluationStage: jest.fn(async (_ctx: unknown) => {}),
}));
// R2-A.12: stub s10
jest.mock("../stages/s10-leader-foreword-and-signoff.stage", () => ({
  runLeaderForewordAndSignoffStage: jest.fn(
    async (ctx: Record<string, unknown>) => {
      ctx.leaderForeword = {
        whatWeAnswered: [{ criterion: "x", addressed: "yes", evidence: "..." }],
        whatRemainsUnclear: [],
        howToRead: "...",
        recommendedFollowUp: [],
        generatedAt: new Date().toISOString(),
      };
      ctx.leaderSignOff = {
        leaderOverallScore: 85,
        leaderVerdict: "good",
        accountabilityNote: "我在 M1 决定 accept-all",
        signed: true,
      };
    },
  ),
}));
// R2-A.13: stub s11/s12
jest.mock("../stages/s11-mission-persist.stage", () => ({
  runPersistStage: jest.fn(async (_args: unknown, _deps: unknown) => {}),
}));
jest.mock("../stages/s12-self-evolution.stage", () => ({
  runSelfEvolutionStage: jest.fn(async (_args: unknown, _deps: unknown) => {}),
}));
import {
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
} from "@/modules/ai-harness/facade";
import { PlaygroundPipelineDispatcher } from "../playground.pipeline";
// ★ Stage 1 / S1-1 (2026-05-09): dispatcher 拆分后,业务编排在独立 service。
//   spec 实例化 real PlaygroundBusinessOrchestrator(用 stub deps),保持外部行为
//   完全等价(idempotent refactor):同样的 stage hooks, 同样的事件流, 同样的 DB 写。
import { PlaygroundBusinessOrchestrator } from "../playground-business-orchestrator.service";
import { PLAYGROUND_PIPELINE } from "../../../runtime/playground.config";
import type { MissionRuntimeShellService } from "../mission-runtime-shell.service";
import type { MissionRuntimeSession } from "../mission-runtime-shell.service";
import type { MissionStageBindingsService } from "../mission-stage-bindings.service";
import type { AgentInvoker, LeaderService } from "../../roles";

function makeFakeSession(missionId: string, userId: string) {
  const abortController = new AbortController();
  const cleanup = jest.fn();
  // billing.estimateAffordable: 默认通过（affordable=true），避免 s1 抛错；
  //   单测可 mock 出 affordable=false / suggestion=abort 来覆盖失败路径
  const billing = {
    estimateAffordable: jest.fn().mockResolvedValue({
      affordable: true,
      estimatedCredits: 100,
      currentBalance: 1000,
    }),
  };
  return {
    missionId,
    userId,
    workspaceId: undefined,
    billing,
    pool: { snapshot: () => ({ poolTokensUsed: 0, poolCostUsd: 0 }) } as never,
    budgetMultiplier: 1,
    missionAbort: abortController,
    wallTimeMs: 60_000,
    cleanup,
  } as unknown as MissionRuntimeSession;
}

function makeFakeShell() {
  const sessions = new Map<string, MissionRuntimeSession>();
  return {
    sessions,
    async openSession(args: {
      missionId: string;
      userId: string;
      input: unknown;
      workspaceId?: string;
    }) {
      const s = makeFakeSession(args.missionId, args.userId);
      sessions.set(args.missionId, s);
      return s;
    },
    async runWithinContext<T>(
      _session: MissionRuntimeSession,
      fn: () => Promise<T>,
    ) {
      return fn();
    },
  } as unknown as MissionRuntimeShellService & {
    sessions: Map<string, MissionRuntimeSession>;
  };
}

/**
 * StageBindings stub —— buildDeps 返回最小 deps（s1 只用 emit + log）。
 */
function makeFakeStageBindings() {
  const emittedEvents: Array<{ type: string; missionId: string }> = [];
  const buildDeps = jest.fn().mockReturnValue({
    invoker: {} as never,
    // ★ 2026-05-07 R2 共识 P0 (architect): s2/s5/s10 加 markIntermediateState
    //   主动持久化 — buildDeps 必须 mock 防 stage 调 deps.store.* 时报 undefined.fn。
    //   用 Proxy 兜底任何未列出的方法返 () => Promise.resolve(undefined)
    store: new Proxy(
      {
        markIntermediateState: jest.fn().mockResolvedValue(undefined),
        listRecentPostmortems: jest.fn().mockResolvedValue([]),
        loadQualifiedChapterDrafts: jest.fn().mockResolvedValue([]),
        loadBaselineResearchResults: jest.fn().mockResolvedValue([]),
        saveResearchResult: jest.fn().mockResolvedValue(undefined),
        saveChapterDraft: jest.fn().mockResolvedValue(undefined),
        saveReportVersion: jest.fn().mockResolvedValue(1),
        markStageComplete: jest.fn().mockResolvedValue(undefined),
        // ★ C0/G1：applyTerminalIfRunning 替代 markFailed / markCompleted
        applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
      } as Record<string, jest.Mock>,
      {
        get(target, prop: string) {
          if (!(prop in target))
            target[prop] = jest.fn().mockResolvedValue(undefined);
          return target[prop];
        },
      },
    ) as never,
    missionState: {} as never,
    abortRegistry: {} as never,
    runner: {} as never,
    eventBus: {} as never,
    credits: {} as never,
    runtimeEnv: {} as never,
    log: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    emit: jest.fn(async (e: { type: string; missionId: string }) => {
      emittedEvents.push({ type: e.type, missionId: e.missionId });
    }),
    lifecycle: jest.fn(),
    leader: {} as never,
    reconciler: {} as never,
    analyst: {} as never,
    writer: {} as never,
    reviewer: {} as never,
    verifier: {} as never,
    steward: {} as never,
    judge: {} as never,
    indexer: {} as never,
    failureLearner: {} as never,
    reportAssembler: {} as never,
    figureExtractor: {} as never,
    figureRelevance: {} as never,
    sectionSelfEval: {} as never,
    sectionRemediation: {} as never,
    reportEvaluation: {} as never,
    qualityTraceCompute: {} as never,
    postmortemClassifier: {} as never,
  });
  /**
   * buildCtx：把入参原样组装成 MissionContext（与真实 stageBindings 行为一致）
   */
  const buildCtx = jest.fn((args: Record<string, unknown>) => ({
    ...args,
    s4PatchFailures: undefined,
  }));
  return {
    buildDeps,
    buildCtx,
    emittedEvents,
  } as unknown as MissionStageBindingsService & {
    buildDeps: jest.Mock;
    buildCtx: jest.Mock;
    emittedEvents: typeof emittedEvents;
  };
}

describe("PlaygroundPipelineDispatcher (v5.1 R2-A.1 smoke)", () => {
  let registry: MissionPipelineRegistry;
  let orchestrator: MissionPipelineOrchestrator;
  let shell: ReturnType<typeof makeFakeShell>;
  let dispatcher: PlaygroundPipelineDispatcher;

  let stageBindings: ReturnType<typeof makeFakeStageBindings>;

  /**
   * fake leader.plan() —— 默认成功，stub 1 个 dim；spec 可覆盖 mockResolvedValueOnce
   */
  let fakeLeaderPlan: jest.Mock;
  let fakeSupervisedMission: { plan: jest.Mock };
  // ★ 2026-05-06: dispatcher 切到 eventBus.emit 后 spec 注入 mock 验证
  let fakeEventBus: {
    emit: jest.Mock;
    registerAdapter: jest.Mock;
    unregisterAdapter: jest.Mock;
  };
  // ★ Round 4 (2026-05-11): dispatcher finally 必须调 electionTracker.clear，
  //   否则 mission_election_states 行残留；提升到 describe 顶层让 it 能断言
  let fakeElectionTracker: { clear: jest.Mock };

  beforeEach(() => {
    registry = new MissionPipelineRegistry();
    orchestrator = new MissionPipelineOrchestrator(registry);
    shell = makeFakeShell();
    stageBindings = makeFakeStageBindings();
    fakeLeaderPlan = jest.fn().mockResolvedValue({
      themeSummary: "test theme",
      dimensions: [{ id: "dim-1", name: "Dim 1", rationale: "..." }],
      goals: { successCriteria: ["..."] },
      initialRisks: [],
    });
    fakeSupervisedMission = { plan: fakeLeaderPlan };
    const fakeLeaderService = {
      create: jest.fn().mockReturnValue(fakeSupervisedMission as never),
    } as unknown as LeaderService;
    const fakeInvoker = {
      invoke: jest.fn().mockResolvedValue({
        state: "completed",
        output: {},
        events: [],
      }),
      // R2-A.13.1 失败兜底 emitEvent 调用
      emitEvent: jest.fn().mockResolvedValue(undefined),
      emitLifecycle: jest.fn().mockResolvedValue(undefined),
      // ★ 第3轮修 (2026-05-06): dispatcher finally 调 invoker.clearMissionRelayState
      //   清 exhaustedMissions Map 防短 mission leak
      clearMissionRelayState: jest.fn(),
    } as unknown as AgentInvoker;
    // store.listRecentPostmortems 是 s2 hook 内部调用 —— 默认空数组（无历史）
    const buildDepsMock = (stageBindings as unknown as { buildDeps: jest.Mock })
      .buildDeps;
    const previousImpl = buildDepsMock.getMockImplementation();
    const baseDeps = previousImpl ? previousImpl() : {};
    buildDepsMock.mockReturnValue({
      ...baseDeps,
      store: {
        listRecentPostmortems: jest.fn().mockResolvedValue([]),
      },
    });
    const fakeCheckpoint = {
      clear: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
      // R2-#37: crash-resume — default no prior checkpoint
      canResume: jest.fn().mockResolvedValue({
        canResume: false,
        reason: "no-checkpoint",
        snapshot: null,
        completedKeys: new Set(),
      }),
    };
    const fakeEventBuffer = {
      read: jest.fn().mockReturnValue([]),
      // ★ A-1/A-7/A-8: dispatcher onEvent 桥接 + fire-and-forget S12 + finally 兜底
      //   都通过 broadcast 发 playground.* 事件，spec 必须 mock
      broadcast: jest.fn().mockResolvedValue(undefined),
    };
    const fakeStore = {
      markStageComplete: jest.fn().mockResolvedValue(undefined),
      // ★ C0/G1：applyTerminalIfRunning 替代 markFailed（条件写，首写赢，返回 boolean）
      applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
      // ★ P0-D 完整版 (2026-05-06): trajectory 持久化 mock
      saveResearchResult: jest.fn().mockResolvedValue(undefined),
      saveChapterDraft: jest.fn().mockResolvedValue(undefined),
      loadBaselineResearchResults: jest.fn().mockResolvedValue([]),
      loadQualifiedChapterDrafts: jest.fn().mockResolvedValue([]),
      // ★ #85 (2026-05-06): 报告版本化 fire-and-forget mock
      saveReportVersion: jest.fn().mockResolvedValue(1),
      // ★ 2026-05-07 R2 共识 P0 (architect): s2/s5/s10 加 markIntermediateState
      //   主动持久化 — dispatcher spec 必须 mock 防 undefined 调用栈炸 stage
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
    };
    // ★ 2026-05-06 真治：dispatcher 现在直接走 eventBus.emit，需要注入。
    //   spec 只需要 emit() 是 thenable —— 真 broadcast 路径在 module wiring 上由
    //   buffer adapter 接收（EventBus 自身的 spec 已覆盖）。
    fakeEventBus = {
      emit: jest.fn().mockResolvedValue(true),
      registerAdapter: jest.fn(),
      unregisterAdapter: jest.fn(),
    };
    fakeElectionTracker = {
      clear: jest.fn(),
    };
    const fakeLeaderInvocationFactory = {
      build: jest.fn().mockReturnValue(jest.fn()),
    };
    // ★ Stage 1 / S1-1 (2026-05-09): real PlaygroundBusinessOrchestrator with stub deps
    //   — STAGE_NUMBER / CHECKPOINT_AT / 11 build*Hooks 完全等价 of pre-refactor 行为
    const businessOrch = new PlaygroundBusinessOrchestrator(
      stageBindings as unknown as MissionStageBindingsService,
      fakeCheckpoint as never,
      fakeStore as never,
    );
    // ★ C0/G1：lifecycleManager mock —— finalize 复刻真实语义：调 arbiter.applyTerminalIfRunning，
    //   won=true 时跑 onWon 且吞 onWon 异常。
    const fakeLifecycleManager = {
      finalize: jest.fn(
        async <TExtra>(args: {
          missionId: string;
          intent: { status: string; extra?: TExtra };
          arbiter: {
            applyTerminalIfRunning: (
              id: string,
              intent: unknown,
            ) => Promise<boolean>;
          };
          abort?: () => void;
          onWon?: () => Promise<void>;
        }) => {
          const won = await args.arbiter.applyTerminalIfRunning(
            args.missionId,
            args.intent,
          );
          if (won && args.onWon) {
            try {
              await args.onWon();
            } catch {
              // swallow
            }
          }
          return { won };
        },
      ),
    };
    const fakeMissionSpan = {
      startMissionSpan: jest.fn(),
      endMissionSpan: jest.fn(),
      startStageSpan: jest.fn(),
      endStageSpan: jest.fn(),
    };
    dispatcher = new PlaygroundPipelineDispatcher(
      registry,
      orchestrator,
      shell as unknown as MissionRuntimeShellService,
      stageBindings as unknown as MissionStageBindingsService,
      fakeLeaderService,
      fakeInvoker,
      fakeLeaderInvocationFactory as never,
      fakeCheckpoint as never,
      fakeEventBuffer as never,
      fakeStore as never,
      fakeElectionTracker as never,
      fakeEventBus as never,
      businessOrch,
      fakeLifecycleManager as never,
      fakeMissionSpan as never,
    );
    dispatcher.onModuleInit();
  });

  it("onModuleInit 注册 PLAYGROUND_PIPELINE 到 registry", () => {
    expect(registry.has(PLAYGROUND_PIPELINE.id)).toBe(true);
    const cfg = registry.get(PLAYGROUND_PIPELINE.id);
    // ★ A-7: S12 移出 pipeline.steps 走 fire-and-forget by dispatcher
    expect(cfg.steps).toHaveLength(13);
  });

  it("注册的 config 13 个 step 都已注入 hooks（NotYetWired 占位）", () => {
    const cfg = registry.get(PLAYGROUND_PIPELINE.id);
    for (const step of cfg.steps) {
      // 必填 hook 都被注入；learn 没有必填 hook 是合法情况
      expect(step.hooks).toBeDefined();
      if (step.primitive !== "learn") {
        expect(Object.keys(step.hooks ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  it("★ pipeline-v1 全部 13 stage wired → mission 完整跑通 status=completed (A-7 后 S12 走 postlude)", async () => {
    const result = await dispatcher.runMission(
      "m1",
      {
        topic: "test",
        depth: "quick",
        language: "zh-CN",
        budgetProfile: "low",
        styleProfile: "executive",
        lengthProfile: "brief",
        audienceProfile: "domain-expert",
        withFigures: false,
        auditLayers: "default",
        concurrency: 1,
        viewMode: "continuous",
        maxCredits: 50,
      } as never,
      "u1",
    );
    expect(result.missionId).toBe("m1");
    // ★ 全 14 stage wired，mission 应该 status=completed
    expect(result.status).toBe("completed");
    expect(result.error).toBeUndefined();
    // s1 - s12 都跑过
    expect(result.stageOutputs["s1-budget"]).toEqual({ persisted: true });
    expect(result.stageOutputs["s2-leader-plan"]).toMatchObject({
      dimensions: [{ id: "dim-1" }],
    });
    expect(result.stageOutputs["s3-researcher-collect"]).toMatchObject({
      results: [[{ dimension: "dim-1" }]],
      failureCount: 0,
    });
    expect(result.stageOutputs["s4-leader-assess"]).toMatchObject({
      decision: "continue",
    });
    // synthesize primitive 输出 { result } (mode=reconcile)
    expect(result.stageOutputs["s5-reconciler"]).toMatchObject({
      result: { reconciliationReport: "test reconciliation" },
    });
    // synthesize primitive 输出 { result } (mode=analyze)
    expect(result.stageOutputs["s6-analyst"]).toMatchObject({
      result: { themeSummary: "test theme" },
    });
    // draft primitive (mode=outline) 输出 { artifact: ... }；stub 让 outlinePlan=undefined 落到 null
    expect(result.stageOutputs["s7-writer-outline"]).toBeDefined();
    // draft primitive (mode=full) 输出 { artifact, ... }；s8 把 reportArtifact 当 artifact
    expect(result.stageOutputs["s8-writer"]).toMatchObject({
      artifact: { metadata: { topic: "test" } },
    });
    // 三个 review stages 输出 { verdict: { ... } }
    expect(result.stageOutputs["s8b-quality-enhancement"]).toBeDefined();
    expect(result.stageOutputs["s9-critic"]).toBeDefined();
    expect(result.stageOutputs["s9b-objective-eval"]).toBeDefined();
    // s10 signoff primitive { signoff }
    expect(result.stageOutputs["s10-leader-foreword-signoff"]).toMatchObject({
      signoff: { signoff: { signed: true } },
    });
    // s11 persist primitive { persisted: true }
    expect(result.stageOutputs["s11-persist"]).toEqual({ persisted: true });
    // ★ A-7: s12-self-evolution 已从 pipeline.steps 移出走 fire-and-forget，
    //   stageOutputs 不再包含；改由 mission:postlude:* 事件流跟踪
    expect(result.stageOutputs["s12-self-evolution"]).toBeUndefined();
    // ★ Round 4 (2026-05-11): finally 块必须清 election state
    expect(fakeElectionTracker.clear).toHaveBeenCalledWith("m1");
  });

  it("s2-leader-plan hook：调 leader.plan + emit leader:goals-set 事件", async () => {
    await dispatcher.runMission(
      "m-s2-trace",
      {
        topic: "leader plan test",
        depth: "quick",
        language: "zh-CN",
        budgetProfile: "low",
        styleProfile: "executive",
        lengthProfile: "brief",
        audienceProfile: "domain-expert",
        withFigures: false,
        auditLayers: "default",
        concurrency: 1,
        viewMode: "continuous",
        maxCredits: 50,
      } as never,
      "u1",
    );
    // leader.plan 被调一次
    expect(fakeLeaderPlan).toHaveBeenCalledTimes(1);
    // emit 出现 leader:goals-set 事件
    const eventTypes = stageBindings.emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain("playground.leader:goals-set");
  });

  it("s2 leader.plan 抛错 → mission stage:failed + 不影响 dispatcher 主流程", async () => {
    fakeLeaderPlan.mockRejectedValueOnce(new Error("LLM API failed"));
    const result = await dispatcher.runMission(
      "m-s2-fail",
      {
        topic: "fail test",
        depth: "quick",
        language: "zh-CN",
        budgetProfile: "low",
        styleProfile: "executive",
        lengthProfile: "brief",
        audienceProfile: "domain-expert",
        withFigures: false,
        auditLayers: "default",
        concurrency: 1,
        viewMode: "continuous",
        maxCredits: 50,
      } as never,
      "u1",
    );
    expect(result.status).toBe("failed");
    expect(String(result.error)).toMatch(/LLM API failed/i);
    // s1 跑过，s2 抛错：stageOutputs[s1] 有，stageOutputs[s2] 无
    expect(result.stageOutputs["s1-budget"]).toEqual({ persisted: true });
    expect(result.stageOutputs["s2-leader-plan"]).toBeUndefined();
    // ★ Round 4 (2026-05-11): 失败路径 finally 也必须清 election state
    expect(fakeElectionTracker.clear).toHaveBeenCalledWith("m-s2-fail");
  });

  it("s3-researcher-collect hook：调 runResearcherDispatchStage + 缓存 lastResearcherResults 给下游", async () => {
    await dispatcher.runMission(
      "m-s3-trace",
      {
        topic: "research test",
        depth: "quick",
        language: "zh-CN",
        budgetProfile: "low",
        styleProfile: "executive",
        lengthProfile: "brief",
        audienceProfile: "domain-expert",
        withFigures: false,
        auditLayers: "default",
        concurrency: 1,
        viewMode: "continuous",
        maxCredits: 50,
      } as never,
      "u1",
    );
    // mocked runResearcherDispatchStage 应该被调一次
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const stageMod = require("../stages/s3-researcher-collect-findings.stage");
    expect(stageMod.runResearcherDispatchStage).toHaveBeenCalled();
  });

  it("s2 leader.plan 返空 dimensions → fail-fast", async () => {
    fakeLeaderPlan.mockResolvedValueOnce({
      themeSummary: "x",
      dimensions: [], // 空数组应触发 fail-fast
      goals: { successCriteria: [] },
      initialRisks: [],
    });
    const result = await dispatcher.runMission(
      "m-s2-empty",
      {
        topic: "empty dims",
        depth: "quick",
        language: "zh-CN",
        budgetProfile: "low",
        styleProfile: "executive",
        lengthProfile: "brief",
        audienceProfile: "domain-expert",
        withFigures: false,
        auditLayers: "default",
        concurrency: 1,
        viewMode: "continuous",
        maxCredits: 50,
      } as never,
      "u1",
    );
    expect(result.status).toBe("failed");
    expect(String(result.error)).toMatch(/dimensions.*empty/i);
  });

  it("runMission s1-budget hook：billing.estimateAffordable 被调 + emit mission:started 事件", async () => {
    const result = await dispatcher.runMission(
      "m-s1-emit",
      {
        topic: "budget test",
        depth: "quick",
        language: "zh-CN",
        budgetProfile: "low",
        styleProfile: "executive",
        lengthProfile: "brief",
        audienceProfile: "domain-expert",
        withFigures: false,
        auditLayers: "default",
        concurrency: 1,
        viewMode: "continuous",
        maxCredits: 50,
      } as never,
      "u1",
    );
    // s1 跑成功（mission 仍 fail 在 s2，但 s1 阶段无错）
    expect(result.stageOutputs["s1-budget"]).toEqual({ persisted: true });
    // emitted events 含 mission:started + agent:narrative（s1 内部 narrate）
    const eventTypes = stageBindings.emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain("playground.mission:started");
  });

  it("runMission 失败后 session cleanup 被调用 + sessions map 清空", async () => {
    await dispatcher.runMission(
      "m2",
      {
        topic: "test",
        depth: "quick",
        language: "zh-CN",
        budgetProfile: "low",
        styleProfile: "executive",
        lengthProfile: "brief",
        audienceProfile: "domain-expert",
        withFigures: false,
        auditLayers: "default",
        concurrency: 1,
        viewMode: "continuous",
        maxCredits: 50,
      } as never,
      "u1",
    );
    expect(() => dispatcher.getSession("m2")).toThrow(/no active session/);
  });

  it("getSession 不存在 missionId 抛错", () => {
    expect(() => dispatcher.getSession("never-existed")).toThrow(
      /no active session/,
    );
  });

  it("registry 可重复 onModuleInit（has() 短路返回 + 不抛 duplicate）", () => {
    expect(() => dispatcher.onModuleInit()).not.toThrow();
  });

  // ★ 2026-05-08 PR-A3 review round 1 P1：buildBaseHooksForStep fallback throw
  //   覆盖（tester 路评审要求）。删 PlaygroundHookNotYetWiredError 后必须有 spec
  //   锁定新 throw 行为，防 silent regression（如 PLAYGROUND_PIPELINE.steps 加新
  //   step 但忘记加 hook builder 分支时立即拍下而非静默跑过）。
  it("buildBaseHooksForStep 未知 stepId 抛 Error 且消息含 stepId 名（fallback 守护）", () => {
    const fn = (
      dispatcher as unknown as {
        buildBaseHooksForStep: (stepId: string, primitive: string) => unknown;
      }
    ).buildBaseHooksForStep.bind(dispatcher);
    expect(() => fn("never-registered-step", "plan")).toThrow(
      /no hook builder for step "never-registered-step"/,
    );
    expect(() => fn("s99-future-stage", "synthesize")).toThrow(
      /must have an explicit branch above/,
    );
  });

  // ─── #48-failure: handleMissionFailure abort signal.reason 分类 ─────────────
  //
  // 2026-05-22 真治: abort 必须按 signal.reason 区分 user_cancelled / budget_exhausted /
  //   mission_wall_time_exceeded，不再让全部 abort 走 user-cancelled 静默路径。
  //
  // 测试策略：
  //   · fakeLeaderPlan 抛错 → orchestrator 包成 result.status="failed"
  //   · openSession mock 注入预 abort 的 AbortController（带对应 reason）
  //   · 断言 invoker.emitEvent 的入参 failureCode

  describe("#48-failure handleMissionFailure abort signal.reason classification", () => {
    /** Re-create dispatcher with a shell whose openSession returns a session
     *  with a pre-aborted AbortController of the given reason. */
    function makeDispatcherWithAbortedSession(abortReason: string) {
      // Build new registry / orchestrator so we don't share state
      const reg = new MissionPipelineRegistry();
      const orch = new MissionPipelineOrchestrator(reg);

      const ac = new AbortController();
      ac.abort(abortReason);

      const fakeSessionWithAbort = {
        missionId: "m-abort-test",
        userId: "u1",
        workspaceId: undefined,
        billing: {
          estimateAffordable: jest.fn().mockResolvedValue({
            affordable: true,
            estimatedCredits: 100,
            currentBalance: 1000,
          }),
        },
        pool: {
          snapshot: () => ({ poolTokensUsed: 500, poolCostUsd: 0.05 }),
        } as never,
        budgetMultiplier: 1,
        missionAbort: ac,
        wallTimeMs: 60_000,
        cleanup: jest.fn(),
      } as unknown as MissionRuntimeSession;

      const customShell = {
        sessions: new Map<string, MissionRuntimeSession>(),
        async openSession(args: {
          missionId: string;
          userId: string;
          input: unknown;
          workspaceId?: string;
        }) {
          customShell.sessions.set(args.missionId, fakeSessionWithAbort);
          return fakeSessionWithAbort;
        },
        async runWithinContext<T>(
          _session: MissionRuntimeSession,
          fn: () => Promise<T>,
        ) {
          return fn();
        },
      } as unknown as MissionRuntimeShellService;

      const localStageBindings = makeFakeStageBindings();

      // fakeLeaderPlan throws so mission fails and handleMissionFailure is called
      const throwingLeaderPlan = jest
        .fn()
        .mockRejectedValue(new Error("LLM fail"));
      const fakeLeaderSvc = {
        create: jest
          .fn()
          .mockReturnValue({ plan: throwingLeaderPlan } as never),
      } as unknown as LeaderService;

      const localInvoker = {
        invoke: jest
          .fn()
          .mockResolvedValue({ state: "completed", output: {}, events: [] }),
        emitEvent: jest.fn().mockResolvedValue(undefined),
        emitLifecycle: jest.fn().mockResolvedValue(undefined),
        clearMissionRelayState: jest.fn(),
      } as unknown as AgentInvoker;

      // Re-use the same misc deps pattern from beforeEach
      const fakeCheckpoint = {
        clear: jest.fn().mockResolvedValue(undefined),
        save: jest.fn().mockResolvedValue(undefined),
        // R2-#37: crash-resume — default no prior checkpoint
        canResume: jest.fn().mockResolvedValue({
          canResume: false,
          reason: "no-checkpoint",
          snapshot: null,
          completedKeys: new Set(),
        }),
      };
      const fakeEventBuffer = {
        read: jest.fn().mockReturnValue([]),
        broadcast: jest.fn().mockResolvedValue(undefined),
      };
      const fakeStore = {
        markStageComplete: jest.fn().mockResolvedValue(undefined),
        applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
        saveResearchResult: jest.fn().mockResolvedValue(undefined),
        saveChapterDraft: jest.fn().mockResolvedValue(undefined),
        loadBaselineResearchResults: jest.fn().mockResolvedValue([]),
        loadQualifiedChapterDrafts: jest.fn().mockResolvedValue([]),
        saveReportVersion: jest.fn().mockResolvedValue(1),
        markIntermediateState: jest.fn().mockResolvedValue(undefined),
        listRecentPostmortems: jest.fn().mockResolvedValue([]),
      };
      const localEventBus = {
        emit: jest.fn().mockResolvedValue(true),
        registerAdapter: jest.fn(),
        unregisterAdapter: jest.fn(),
      };
      const localElectionTracker = { clear: jest.fn() };
      const fakeLeaderInvocationFactory = {
        build: jest.fn().mockReturnValue(jest.fn()),
      };
      const businessOrch = new PlaygroundBusinessOrchestrator(
        localStageBindings as unknown as MissionStageBindingsService,
        fakeCheckpoint as never,
        fakeStore as never,
      );
      const fakeLifecycleManager = {
        finalize: jest.fn(
          async <TExtra>(args: {
            missionId: string;
            intent: { status: string; extra?: TExtra };
            arbiter: {
              applyTerminalIfRunning: (
                id: string,
                intent: unknown,
              ) => Promise<boolean>;
            };
            abort?: () => void;
            onWon?: () => Promise<void>;
          }) => {
            const won = await args.arbiter.applyTerminalIfRunning(
              args.missionId,
              args.intent,
            );
            if (won && args.onWon) {
              try {
                await args.onWon();
              } catch {
                /* swallow */
              }
            }
            return { won };
          },
        ),
      };

      (
        localStageBindings as unknown as { buildDeps: jest.Mock }
      ).buildDeps.mockReturnValue({
        invoker: {} as never,
        store: {
          markIntermediateState: jest.fn().mockResolvedValue(undefined),
          listRecentPostmortems: jest.fn().mockResolvedValue([]),
          loadQualifiedChapterDrafts: jest.fn().mockResolvedValue([]),
          loadBaselineResearchResults: jest.fn().mockResolvedValue([]),
          saveResearchResult: jest.fn().mockResolvedValue(undefined),
          saveChapterDraft: jest.fn().mockResolvedValue(undefined),
          saveReportVersion: jest.fn().mockResolvedValue(1),
          markStageComplete: jest.fn().mockResolvedValue(undefined),
          applyTerminalIfRunning: jest.fn().mockResolvedValue(true),
        },
        log: {
          log: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
        },
        emit: jest.fn().mockResolvedValue(undefined),
        lifecycle: jest.fn(),
      } as never);

      const noopMissionSpan = {
        startMissionSpan: jest.fn(),
        endMissionSpan: jest.fn(),
        startStageSpan: jest.fn(),
        endStageSpan: jest.fn(),
      };
      // ★ e2e P0-#5: mission 失败通知 preset（@Optional 第 16 参）
      const localFailedPreset = {
        notify: jest.fn().mockResolvedValue(undefined),
      };
      const d = new PlaygroundPipelineDispatcher(
        reg,
        orch,
        customShell as unknown as MissionRuntimeShellService,
        localStageBindings as unknown as MissionStageBindingsService,
        fakeLeaderSvc,
        localInvoker,
        fakeLeaderInvocationFactory as never,
        fakeCheckpoint as never,
        fakeEventBuffer as never,
        fakeStore as never,
        localElectionTracker as never,
        localEventBus as never,
        businessOrch,
        fakeLifecycleManager as never,
        noopMissionSpan as never,
        localFailedPreset as never,
      );
      d.onModuleInit();
      return {
        dispatcher: d,
        invoker: localInvoker,
        failedPreset: localFailedPreset,
      };
    }

    const RUN_INPUT = {
      topic: "abort test",
      depth: "quick",
      language: "zh-CN",
      budgetProfile: "low",
      styleProfile: "executive",
      lengthProfile: "brief",
      audienceProfile: "domain-expert",
      withFigures: false,
      auditLayers: "default",
      concurrency: 1,
      viewMode: "continuous",
      maxCredits: 50,
    } as never;

    it("abort reason=user_cancelled → handleMissionFailure returns early, mission:failed NOT emitted", async () => {
      // Arrange
      const {
        dispatcher: d,
        invoker: inv,
        failedPreset,
      } = makeDispatcherWithAbortedSession("user_cancelled");

      // Act
      const result = await d.runMission("m-abort-test", RUN_INPUT, "u1");

      // Assert — user_cancelled exits early (status may be "failed" or "aborted" depending on
      // how the orchestrator wraps the abort; what matters is no mission:failed emit).
      expect(["failed", "aborted"]).toContain(result.status);
      const emitCalls = (inv.emitEvent as jest.Mock).mock.calls;
      const failedEmit = emitCalls.find(
        (c) => (c[0] as { type: string }).type === "playground.mission:failed",
      );
      expect(failedEmit).toBeUndefined();
      // ★ e2e P0-#5: 用户主动取消不应发"失败"通知（他自己取消的）
      expect(failedPreset.notify).not.toHaveBeenCalled();
    });

    it("abort reason=budget_exhausted → failureCode===BUDGET_EXHAUSTED and mission:failed IS emitted", async () => {
      // Arrange
      const {
        dispatcher: d,
        invoker: inv,
        failedPreset,
      } = makeDispatcherWithAbortedSession("budget_exhausted");

      // Act
      await d.runMission("m-abort-test", RUN_INPUT, "u1");

      // Assert
      const emitCalls = (inv.emitEvent as jest.Mock).mock.calls;
      const failedEmit = emitCalls.find(
        (c) => (c[0] as { type: string }).type === "playground.mission:failed",
      );
      expect(failedEmit).toBeDefined();
      expect(
        (failedEmit![0] as { payload: { failureCode: string } }).payload
          .failureCode,
      ).toBe("BUDGET_EXHAUSTED");
      // ★ e2e P0-#5: 非用户取消的失败 → finalize onWon 发 MISSION_FAILED 通知（恰好一次）
      expect(failedPreset.notify).toHaveBeenCalledTimes(1);
      expect(failedPreset.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u1",
          missionId: "m-abort-test",
          failureCode: "BUDGET_EXHAUSTED",
        }),
      );
    });

    it("abort reason=mission_wall_time_exceeded → failureCode===RUNNER_WALL_TIME_EXCEEDED and mission:failed IS emitted", async () => {
      // Arrange
      const { dispatcher: d, invoker: inv } = makeDispatcherWithAbortedSession(
        "mission_wall_time_exceeded",
      );

      // Act
      await d.runMission("m-abort-test", RUN_INPUT, "u1");

      // Assert
      const emitCalls = (inv.emitEvent as jest.Mock).mock.calls;
      const failedEmit = emitCalls.find(
        (c) => (c[0] as { type: string }).type === "playground.mission:failed",
      );
      expect(failedEmit).toBeDefined();
      expect(
        (failedEmit![0] as { payload: { failureCode: string } }).payload
          .failureCode,
      ).toBe("RUNNER_WALL_TIME_EXCEEDED");
    });
  });
});
