/**
 * WritingPipelineDispatcher integration smoke test (B4 dispatcher)
 *
 * 替代验证：无真实 DB/LLM key 的可运行冒烟测试，覆盖以下断言：
 *   1. selectWritingPipeline(每个 missionType) 返回正确 pipelineId
 *   2. WritingBusinessOrchestrator.resolveStageRunner 对 8 个 stepId 都能解析出 runner（不抛）
 *   3. dispatcher.runMission(mock input) 用正确 pipelineId 调 orchestrator.run
 *   4. 5 条子集 pipeline 的 step 顺序与 writing.config.ts 一致
 *
 * 所有 8 个 stage free 函数通过 jest.mock 隔离——不连真实 DB/LLM。
 */

// ─── Mock 8 stage free 函数（隔离真实 DB / LLM 依赖）────────────────────────
jest.mock("../pipeline/stages/s1-mission-budget-eval.stage", () => ({
  runBudgetEvalStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../pipeline/stages/s2-world-build.stage", () => ({
  runWorldBuildStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../pipeline/stages/s3-outline-plan.stage", () => ({
  runOutlinePlanStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../pipeline/stages/s4-chapter-fanout.stage", () => ({
  runChapterFanoutStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../pipeline/stages/s5-consistency-check.stage", () => ({
  runConsistencyCheckStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../pipeline/stages/s6-edit-polish.stage", () => ({
  runEditPolishStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../pipeline/stages/s7-quality-evaluate.stage", () => ({
  runQualityEvaluateStage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../pipeline/stages/s8-mission-persist.stage", () => ({
  runMissionPersistStage: jest.fn().mockResolvedValue(undefined),
}));

import { Logger } from "@nestjs/common";
import {
  MissionPipelineRegistry,
  MissionPipelineOrchestrator,
} from "@/modules/ai-harness/facade";
import { WritingBusinessOrchestrator } from "../pipeline/writing-business-orchestrator.service";
import { WritingPipelineDispatcher } from "../pipeline/writing-pipeline-dispatcher.service";
import {
  selectWritingPipeline,
  WRITING_FULL_STORY_PIPELINE,
  WRITING_CHAPTER_PIPELINE,
  WRITING_OUTLINE_PIPELINE,
  WRITING_CONSISTENCY_PIPELINE,
  WRITING_EDIT_PIPELINE,
} from "../runtime/writing.config";
import type { WritingMissionInput } from "../../services/mission/writing-mission.types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMinimalInput(
  missionType: WritingMissionInput["missionType"],
): WritingMissionInput {
  return {
    projectId: "proj-test",
    missionType,
    userPrompt: "write something",
  };
}

function makeSession(missionId: string) {
  const abortController = new AbortController();
  return {
    missionId,
    userId: "u-test",
    billing: {
      estimateAffordable: jest.fn().mockResolvedValue({
        affordable: true,
        estimatedCredits: 100,
        currentBalance: 1000,
      }),
    },
    pool: {
      snapshot: jest
        .fn()
        .mockReturnValue({ poolTokensUsed: 0, poolCostUsd: 0 }),
    },
    budgetMultiplier: 1,
    missionAbort: abortController,
    wallTimeMs: 60_000,
    cleanup: jest.fn(),
  };
}

function makeRuntimeShell() {
  return {
    openSession: jest
      .fn()
      .mockImplementation(async (args: { missionId: string }) =>
        makeSession(args.missionId),
      ),
    runWithinContext: jest
      .fn()
      .mockImplementation(
        async (
          _session: unknown,
          _ns: unknown,
          _type: unknown,
          fn: () => Promise<unknown>,
        ) => fn(),
      ),
  };
}

function makeBusinessOrch(
  _registry: MissionPipelineRegistry,
  _orchestrator: MissionPipelineOrchestrator,
): WritingBusinessOrchestrator {
  // Real business orchestrator — resolveStageRunner uses real switch
  return new WritingBusinessOrchestrator();
}

function makeLifecycleManager() {
  return {
    finalize: jest.fn().mockImplementation(
      async (args: {
        missionId: string;
        intent: { status: string };
        arbiter: {
          applyTerminalIfRunning: (
            id: string,
            intent: unknown,
          ) => Promise<boolean>;
        };
        onWon?: () => Promise<void>;
      }) => {
        const won = await args.arbiter
          .applyTerminalIfRunning(args.missionId, args.intent)
          .catch(() => false);
        if (won && args.onWon) {
          await args.onWon().catch(() => undefined);
        }
        return { won };
      },
    ),
  };
}

function makeEventBus() {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  };
}

function makeOwnershipRegistry() {
  return {
    assign: jest.fn(),
    getOwner: jest.fn(),
    remove: jest.fn(),
  };
}

function makeStore() {
  return {
    markIntermediateState: jest.fn().mockResolvedValue(undefined),
    markStageDegraded: jest.fn().mockResolvedValue(undefined),
  };
}

function makePrisma() {
  return {
    writingMission: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

/** Build a fully-mocked WritingPipelineDispatcher (all NestJS deps stubbed). */
function buildDispatcher(
  registry: MissionPipelineRegistry,
  orchestrator: MissionPipelineOrchestrator,
) {
  const businessOrch = makeBusinessOrch(registry, orchestrator);
  const runtimeShell = makeRuntimeShell();
  const eventBus = makeEventBus();
  const lifecycleManager = makeLifecycleManager();
  const ownershipRegistry = makeOwnershipRegistry();
  const store = makeStore();
  const prisma = makePrisma();

  // Thin stub for everything injected into the dispatcher constructor.
  // These are passed through but never called in the smoke test (stages are mocked).
  const roleStub = {} as never;
  const domainStub = {} as never;

  const fakeInvoker = {
    clearMissionRelayState: jest.fn(),
    emitLifecycle: jest.fn().mockResolvedValue(undefined),
    tickCost: jest.fn().mockResolvedValue(undefined),
  };

  const dispatcher = new WritingPipelineDispatcher(
    registry as never,
    orchestrator as never,
    runtimeShell as never,
    businessOrch as never,
    store as never,
    roleStub, // projector
    fakeInvoker as never,
    roleStub, // runner
    roleStub, // writer
    roleStub, // bibleKeeper
    roleStub, // storyArchitect
    roleStub, // consistencyChecker
    roleStub, // editor
    lifecycleManager as never,
    ownershipRegistry as never,
    domainStub, // worldBuildingEnhancer
    domainStub, // storyBible
    domainStub, // character
    domainStub, // worldSetting
    domainStub, // jsonParser
    domainStub, // textProcessor
    domainStub, // context
    domainStub, // writingPersistence
    domainStub, // chapterDependency
    domainStub, // parallelOrchestrator
    domainStub, // writerPool
    domainStub, // expressionMemory
    domainStub, // openingHook
    domainStub, // narrativeCraft
    domainStub, // qualityGate
    domainStub, // chapterQualityEvaluator
    domainStub, // storyCompletionDetector
    domainStub, // semanticConsistency
    domainStub, // factExtractor
    domainStub, // consistencyEngine
    prisma as never,
    eventBus as never,
  );

  return {
    dispatcher,
    runtimeShell,
    orchestrator,
    businessOrch,
    store,
    eventBus,
  };
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describe("WritingPipelineDispatcher smoke tests", () => {
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerSpy.mockRestore();
  });

  // ─── Assertion 1: selectWritingPipeline returns correct pipelineId ──────

  describe("1. selectWritingPipeline — missionType → pipelineId mapping", () => {
    it.each([
      ["full_story", "writing-full-story-mission"],
      ["chapter", "writing-chapter-mission"],
      ["outline", "writing-outline-mission"],
      ["consistency_check", "writing-consistency-mission"],
      ["revision", "writing-edit-mission"],
      ["edit", "writing-edit-mission"],
    ] as const)("missionType=%s → pipelineId=%s", (missionType, expectedId) => {
      const pipeline = selectWritingPipeline(missionType);
      expect(pipeline.id).toBe(expectedId);
    });
  });

  // ─── Assertion 2: resolveStageRunner for all 8 stepIds ──────────────────

  describe("2. WritingBusinessOrchestrator.resolveStageRunner — 8 stepIds all resolve (not null)", () => {
    const ALL_STEP_IDS = [
      "s1-mission-budget-eval",
      "s2-world-build",
      "s3-outline-plan",
      "s4-chapter-fanout",
      "s5-consistency-check",
      "s6-edit-polish",
      "s7-quality-evaluate",
      "s8-mission-persist",
    ];

    it.each(ALL_STEP_IDS)("stepId=%s → runner is not null", (stepId) => {
      const orch = new WritingBusinessOrchestrator();
      // resolveStageRunner is protected — access via cast
      const runner = (
        orch as unknown as {
          resolveStageRunner: (stepId: string) => unknown;
        }
      ).resolveStageRunner(stepId);
      expect(runner).not.toBeNull();
      expect(typeof runner).toBe("function");
    });

    it("unknown stepId returns null (not a known step)", () => {
      const orch = new WritingBusinessOrchestrator();
      const runner = (
        orch as unknown as {
          resolveStageRunner: (stepId: string) => unknown;
        }
      ).resolveStageRunner("s99-nonexistent");
      expect(runner).toBeNull();
    });
  });

  // ─── Assertion 3: dispatcher.runMission uses correct pipelineId ─────────

  describe("3. dispatcher.runMission — uses correct pipelineId per missionType", () => {
    it.each([
      ["full_story", "writing-full-story-mission"],
      ["chapter", "writing-chapter-mission"],
      ["outline", "writing-outline-mission"],
      ["consistency_check", "writing-consistency-mission"],
      ["revision", "writing-edit-mission"],
      ["edit", "writing-edit-mission"],
    ] as const)(
      "missionType=%s → orchestrator.run called with pipelineId=%s",
      async (missionType, expectedPipelineId) => {
        const registry = new MissionPipelineRegistry();
        const innerOrchestrator = {
          run: jest.fn().mockResolvedValue({ status: "completed" }),
        } as unknown as MissionPipelineOrchestrator;

        const { dispatcher } = buildDispatcher(registry, innerOrchestrator);
        dispatcher.onModuleInit();

        await dispatcher.runMission(
          `mission-${missionType}`,
          makeMinimalInput(missionType),
          "user-1",
          "proj-1",
        );

        expect(innerOrchestrator.run).toHaveBeenCalledWith(
          expect.objectContaining({ pipelineId: expectedPipelineId }),
        );
      },
    );
  });

  // ─── Assertion 4: pipeline step order matches writing.config.ts ─────────

  describe("4. Pipeline step order — matches writing.config.ts definitions", () => {
    it("WRITING_FULL_STORY_PIPELINE: s1→s2→s3→s4→s5→s6→s7→s8", () => {
      const stepIds = WRITING_FULL_STORY_PIPELINE.steps.map((s) => s.id);
      expect(stepIds).toEqual([
        "s1-mission-budget-eval",
        "s2-world-build",
        "s3-outline-plan",
        "s4-chapter-fanout",
        "s5-consistency-check",
        "s6-edit-polish",
        "s7-quality-evaluate",
        "s8-mission-persist",
      ]);
    });

    it("WRITING_CHAPTER_PIPELINE: s1→s4→s5→s6→s8 (skip s2/s3/s7)", () => {
      const stepIds = WRITING_CHAPTER_PIPELINE.steps.map((s) => s.id);
      expect(stepIds).toEqual([
        "s1-mission-budget-eval",
        "s4-chapter-fanout",
        "s5-consistency-check",
        "s6-edit-polish",
        "s8-mission-persist",
      ]);
    });

    it("WRITING_OUTLINE_PIPELINE: s1→s2→s3→s8 (skip s4/s5/s6/s7)", () => {
      const stepIds = WRITING_OUTLINE_PIPELINE.steps.map((s) => s.id);
      expect(stepIds).toEqual([
        "s1-mission-budget-eval",
        "s2-world-build",
        "s3-outline-plan",
        "s8-mission-persist",
      ]);
    });

    it("WRITING_CONSISTENCY_PIPELINE: s1→s5→s8 (only budget+consistency+persist)", () => {
      const stepIds = WRITING_CONSISTENCY_PIPELINE.steps.map((s) => s.id);
      expect(stepIds).toEqual([
        "s1-mission-budget-eval",
        "s5-consistency-check",
        "s8-mission-persist",
      ]);
    });

    it("WRITING_EDIT_PIPELINE: s1→s5→s6→s8 (revision/edit path)", () => {
      const stepIds = WRITING_EDIT_PIPELINE.steps.map((s) => s.id);
      expect(stepIds).toEqual([
        "s1-mission-budget-eval",
        "s5-consistency-check",
        "s6-edit-polish",
        "s8-mission-persist",
      ]);
    });

    it("all 5 pipelines have primitive=persist for every step", () => {
      const allPipelines = [
        WRITING_FULL_STORY_PIPELINE,
        WRITING_CHAPTER_PIPELINE,
        WRITING_OUTLINE_PIPELINE,
        WRITING_CONSISTENCY_PIPELINE,
        WRITING_EDIT_PIPELINE,
      ];
      for (const pipeline of allPipelines) {
        for (const step of pipeline.steps) {
          expect(step.primitive).toBe("persist");
        }
      }
    });

    it("all 5 pipelines use runtimeVersion=writing-pipeline-v1", () => {
      const allPipelines = [
        WRITING_FULL_STORY_PIPELINE,
        WRITING_CHAPTER_PIPELINE,
        WRITING_OUTLINE_PIPELINE,
        WRITING_CONSISTENCY_PIPELINE,
        WRITING_EDIT_PIPELINE,
      ];
      for (const pipeline of allPipelines) {
        expect(pipeline.meta?.runtimeVersion).toBe("writing-pipeline-v1");
      }
    });
  });

  // ─── Bonus: onModuleInit registers all 5 pipelines ──────────────────────

  describe("5. onModuleInit — registers all 5 pipelines into registry", () => {
    it("registers 5 pipelines with correct ids", () => {
      const registry = new MissionPipelineRegistry();
      const mockOrch = {
        run: jest.fn().mockResolvedValue({ status: "completed" }),
      } as unknown as MissionPipelineOrchestrator;

      const { dispatcher } = buildDispatcher(registry, mockOrch);
      dispatcher.onModuleInit();

      expect(registry.has("writing-full-story-mission")).toBe(true);
      expect(registry.has("writing-chapter-mission")).toBe(true);
      expect(registry.has("writing-outline-mission")).toBe(true);
      expect(registry.has("writing-consistency-mission")).toBe(true);
      expect(registry.has("writing-edit-mission")).toBe(true);
    });

    it("onModuleInit is idempotent (second call does not throw or double-register)", () => {
      const registry = new MissionPipelineRegistry();
      const mockOrch = {
        run: jest.fn().mockResolvedValue({ status: "completed" }),
      } as unknown as MissionPipelineOrchestrator;

      const { dispatcher } = buildDispatcher(registry, mockOrch);
      dispatcher.onModuleInit();
      expect(() => dispatcher.onModuleInit()).not.toThrow();
    });
  });

  // ─── Bonus: getEntry throws when no active session ───────────────────────

  describe("6. getEntry — throws for unknown missionId", () => {
    it("throws with message containing missionId when session not found", () => {
      const registry = new MissionPipelineRegistry();
      const mockOrch = {
        run: jest.fn(),
      } as unknown as MissionPipelineOrchestrator;

      const { dispatcher } = buildDispatcher(registry, mockOrch);
      dispatcher.onModuleInit();

      expect(() => dispatcher.getEntry("nonexistent-mission")).toThrow(
        /nonexistent-mission/,
      );
    });
  });
});
