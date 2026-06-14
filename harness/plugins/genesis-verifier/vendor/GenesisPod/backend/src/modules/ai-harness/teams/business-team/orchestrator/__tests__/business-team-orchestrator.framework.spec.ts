/**
 * BusinessTeamOrchestratorFramework spec —— FakeMarsTeam dummy mock 子类验证：
 *
 *   - bindSessionLookup 之前调 buildHooksForStep().<hook>(args) 抛 "sessionLookup not bound"
 *   - resolveStageRunner 返回 null（未注册的 stepId）→ buildHooksForStep 抛 "no stage runner"
 *   - primitive → hook key 默认映射（plan→runRole / persist→persist / draft→draftOnce）
 *   - primaryHookOverrides 注入覆盖映射
 *   - hook 在 ctx.signal.aborted=true 时立即抛 StageAbortError(stepId)（不调 runner）
 *   - hook 调 runner 时传入正确的 entry + runnerArgs（stepId/primitive 透传）
 *   - getStageNumber(stepId) 返回 config 中映射；未配置返回 undefined
 *   - 多 hook 场景：业务方 override adaptRunnerToHooks 返回 2-key hooks
 */

import {
  BusinessTeamOrchestratorFramework,
  type ResolvedStageHooks,
  type StageRunArgs,
  type StageRunner,
} from "../business-team-orchestrator.framework";
import { StageAbortError } from "../../../services/stages/abstractions";
import type { StageRunnerArgs } from "../abstractions/business-team-orchestrator.contract";

// ────────────────────────────────────────────────────────────────────────
// FakeMarsTeam — dummy mock business team for framework testing
// 代表一个"火星探测团队"：3 个 stage：s1-探测 / s2-分析 / s3-上报
// SessionEntry 是最简形态（仅 missionId + collectedSamples），让 spec 关注
// framework 行为，不被业务复杂度淹没。
// ────────────────────────────────────────────────────────────────────────

interface MarsSession {
  readonly missionId: string;
  collectedSamples: string[];
  analysisResult?: string;
  reported?: boolean;
}

class FakeMarsTeamOrchestrator extends BusinessTeamOrchestratorFramework<MarsSession> {
  public runnerCalls: Array<{
    stepId: string;
    args: StageRunnerArgs;
    entry: MarsSession;
  }> = [];

  constructor(opts?: { primaryHookOverrides?: Record<string, string> }) {
    super(
      {
        namespace: "mars",
        stageNumber: {
          "s1-probe": 1,
          "s2-analyze": 2,
          "s3-report": 3,
        },
      },
      opts,
    );
  }

  protected resolveStageRunner(
    stepId: string,
  ): StageRunner<MarsSession> | null {
    switch (stepId) {
      case "s1-probe":
        return async (entry, args) => {
          this.runnerCalls.push({ stepId: args.stepId, args, entry });
          entry.collectedSamples.push("sample-A");
          return { sampleCount: entry.collectedSamples.length };
        };
      case "s2-analyze":
        return async (entry, args) => {
          this.runnerCalls.push({ stepId: args.stepId, args, entry });
          entry.analysisResult = `analyzed ${entry.collectedSamples.length}`;
          return entry.analysisResult;
        };
      case "s3-report":
        return async (entry, args) => {
          this.runnerCalls.push({ stepId: args.stepId, args, entry });
          entry.reported = true;
          return undefined;
        };
      default:
        return null;
    }
  }
}

/** 多 hook override 子类 —— 演示业务方覆盖 adaptRunnerToHooks */
class FakeMarsMultiHookOrchestrator extends BusinessTeamOrchestratorFramework<MarsSession> {
  constructor() {
    super({ namespace: "mars-multi" });
  }
  protected resolveStageRunner(): StageRunner<MarsSession> | null {
    return async () => "ok";
  }
  protected adaptRunnerToHooks(
    _runner: StageRunner<MarsSession>,
    stepId: string,
    _primitive: string,
  ): ResolvedStageHooks {
    return {
      runRole: async () => "runRole-output",
      extractPlanFields: () => ({ dimensions: [], stepId }),
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────

function makeStageArgs(
  missionId: string,
  opts?: { aborted?: boolean },
): {
  ctx: StageRunArgs["ctx"];
  previousOutputs: object;
  crossStageState: object;
} {
  const signal = opts?.aborted
    ? ({ aborted: true } as AbortSignal)
    : ({ aborted: false } as AbortSignal);
  return {
    ctx: {
      missionId,
      userId: "u1",
      signal,
    } as unknown as StageRunArgs["ctx"],
    previousOutputs: {},
    crossStageState: {},
  };
}

// ────────────────────────────────────────────────────────────────────────

describe("BusinessTeamOrchestratorFramework (FakeMarsTeam)", () => {
  let orch: FakeMarsTeamOrchestrator;
  let session: MarsSession;

  beforeEach(() => {
    orch = new FakeMarsTeamOrchestrator();
    session = { missionId: "m1", collectedSamples: [] };
  });

  describe("sessionLookup binding", () => {
    it("throws when hook invoked before bindSessionLookup", async () => {
      const hooks = orch.buildHooksForStep("s1-probe", "persist");
      const persist = hooks.persist!;
      await expect(persist(makeStageArgs("m1"))).rejects.toThrow(
        /sessionLookup not bound/,
      );
    });

    it("uses lookup to fetch entry after bindSessionLookup", async () => {
      orch.bindSessionLookup((id) => {
        if (id === "m1") return session;
        throw new Error(`unknown mission ${id}`);
      });
      const hooks = orch.buildHooksForStep("s1-probe", "persist");
      const result = await hooks.persist!(makeStageArgs("m1"));
      expect(result).toEqual({ sampleCount: 1 });
      expect(session.collectedSamples).toEqual(["sample-A"]);
      expect(orch.runnerCalls).toHaveLength(1);
      expect(orch.runnerCalls[0].entry).toBe(session);
    });
  });

  describe("resolveStageRunner contract", () => {
    it("throws when no runner registered for stepId", () => {
      expect(() => orch.buildHooksForStep("s99-unknown", "persist")).toThrow(
        /no stage runner for "s99-unknown"/,
      );
    });

    it("dispatches s1-probe / s2-analyze / s3-report to correct runners", async () => {
      orch.bindSessionLookup(() => session);
      await orch.buildHooksForStep("s1-probe", "persist").persist!(
        makeStageArgs("m1"),
      );
      await orch.buildHooksForStep("s2-analyze", "synthesize").synthesize!(
        makeStageArgs("m1"),
      );
      await orch.buildHooksForStep("s3-report", "persist").persist!(
        makeStageArgs("m1"),
      );
      expect(session.collectedSamples).toEqual(["sample-A"]);
      expect(session.analysisResult).toBe("analyzed 1");
      expect(session.reported).toBe(true);
      expect(orch.runnerCalls.map((c) => c.stepId)).toEqual([
        "s1-probe",
        "s2-analyze",
        "s3-report",
      ]);
    });
  });

  describe("primitive → hook key default mapping", () => {
    it.each([
      ["plan", "runRole"],
      ["research", "perItemPipeline"],
      ["assess", "runRole"],
      ["synthesize", "synthesize"],
      ["draft", "draftOnce"],
      ["review", "review"],
      ["signoff", "runRole"],
      ["persist", "persist"],
      ["learn", "postmortemClassifier"],
    ])("primitive=%s → hook key=%s", (primitive, expectedKey) => {
      const hooks = orch.buildHooksForStep("s1-probe", primitive);
      expect(hooks[expectedKey]).toBeDefined();
    });

    it("unknown primitive falls back to persist hook key", () => {
      const hooks = orch.buildHooksForStep("s1-probe", "unknown-primitive");
      expect(hooks.persist).toBeDefined();
    });
  });

  describe("primaryHookOverrides", () => {
    it("override map wins over default mapping", () => {
      const custom = new FakeMarsTeamOrchestrator({
        primaryHookOverrides: { persist: "customPersistHook" },
      });
      const hooks = custom.buildHooksForStep("s1-probe", "persist");
      expect(hooks.customPersistHook).toBeDefined();
      expect(hooks.persist).toBeUndefined();
    });
  });

  describe("abort signal protection", () => {
    it("throws StageAbortError without calling runner when signal already aborted", async () => {
      orch.bindSessionLookup(() => session);
      const hooks = orch.buildHooksForStep("s1-probe", "persist");
      await expect(
        hooks.persist!(makeStageArgs("m1", { aborted: true })),
      ).rejects.toBeInstanceOf(StageAbortError);
      expect(orch.runnerCalls).toHaveLength(0);
      expect(session.collectedSamples).toEqual([]);
    });

    it("StageAbortError carries stepId and reason", async () => {
      orch.bindSessionLookup(() => session);
      const hooks = orch.buildHooksForStep("s2-analyze", "synthesize");
      try {
        await hooks.synthesize!(makeStageArgs("m1", { aborted: true }));
        fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(StageAbortError);
        const ae = err as StageAbortError;
        expect(ae.stage).toBe("s2-analyze");
        expect(ae.reason).toMatch(/cancelled/);
      }
    });
  });

  describe("runnerArgs passthrough", () => {
    it("stepId + primitive transparently passed to runner", async () => {
      orch.bindSessionLookup(() => session);
      await orch.buildHooksForStep("s1-probe", "persist").persist!(
        makeStageArgs("m1"),
      );
      expect(orch.runnerCalls[0].args.stepId).toBe("s1-probe");
      expect(orch.runnerCalls[0].args.primitive).toBe("persist");
      expect(orch.runnerCalls[0].args.ctx.missionId).toBe("m1");
    });
  });

  describe("getStageNumber", () => {
    it("returns stageNumber from config", () => {
      expect(orch.getStageNumber("s1-probe")).toBe(1);
      expect(orch.getStageNumber("s3-report")).toBe(3);
    });
    it("returns undefined for unmapped stepId", () => {
      expect(orch.getStageNumber("s99-unknown")).toBeUndefined();
    });
    it("returns undefined when config has no stageNumber map", () => {
      const noNumOrch =
        new (class extends BusinessTeamOrchestratorFramework<MarsSession> {
          constructor() {
            super({ namespace: "no-num" });
          }
          protected resolveStageRunner(): StageRunner<MarsSession> | null {
            return null;
          }
        })();
      expect(noNumOrch.getStageNumber("s1")).toBeUndefined();
    });
  });

  describe("adaptRunnerToHooks override (multi-hook mode)", () => {
    it("subclass can return multi-key hooks", () => {
      const multi = new FakeMarsMultiHookOrchestrator();
      const hooks = multi.buildHooksForStep("s2-plan", "plan");
      expect(hooks.runRole).toBeDefined();
      expect(hooks.extractPlanFields).toBeDefined();
    });
  });
});
