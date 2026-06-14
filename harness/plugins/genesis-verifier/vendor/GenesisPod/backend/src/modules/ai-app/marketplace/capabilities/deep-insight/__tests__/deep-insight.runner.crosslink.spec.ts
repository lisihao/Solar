/**
 * DeepInsightDefaultRunner 跨 agent 断链接通测试（轨道 C）。
 *
 * 验证两条第一波自报的断链已接通：
 *  1. concurrency 用户档位透传：runner 构造的 pipelineInput.invocation 携带
 *     input.concurrency（接通 research.primitive 的 ctx.input.invocation.concurrency
 *     读取链路）；未传时 invocation 不带该键（走默认兜底，行为不变）。
 *  2. reconciliationReport 接线：applyTerminal 的 completed / failed(拒签) /
 *     failed(orchestrator 失败) 三条终态路径，details 均携带 reconciliationReport
 *     （state 有数据时非 null，消费方 adapter 据此落 ReconciliationPanel 数据源列）。
 *
 * 手法：mock MissionPipelineOrchestrator.run（不跑真 14 步），用 checkpoint seed 把
 * 业务产物注入 runner 内部 crossStageState（loadCheckpoint → CrossStageState.fromJSON）；
 * 捕获 orchestrator.run 入参里的 invocation + persistence.applyTerminalIfRunning 入参。
 */
import { DeepInsightDefaultRunner } from "../deep-insight.runner";
import { CS_KEY } from "../pipeline/ports";
import type {
  CapabilityRunInput,
  CapabilityRunContext,
  MissionPersistencePort,
  MissionTerminalDetails,
} from "../runner-deps";

/** 收集 applyTerminalIfRunning 的 outcome + details 调用。 */
interface TerminalCall {
  outcome: "completed" | "failed" | "cancelled";
  details: MissionTerminalDetails;
}

function buildPersistence(seedCrossState: Record<string, unknown>): {
  port: MissionPersistencePort;
  terminalCalls: TerminalCall[];
} {
  const terminalCalls: TerminalCall[] = [];
  const port: MissionPersistencePort = {
    markStageProgress: jest.fn().mockResolvedValue(undefined),
    saveCheckpoint: jest.fn().mockResolvedValue(true),
    // checkpoint seed：把业务产物喂进 runner 内部 crossStageState。
    loadCheckpoint: jest.fn().mockResolvedValue({
      lastStepId: "s5-reconciler",
      topic: "AMD 竞争力",
      crossState: seedCrossState,
    }),
    clearCheckpoint: jest.fn().mockResolvedValue(undefined),
    applyTerminalIfRunning: jest
      .fn()
      .mockImplementation(
        (
          _missionId: string,
          outcome: "completed" | "failed" | "cancelled",
          details: MissionTerminalDetails,
        ) => {
          terminalCalls.push({ outcome, details });
          return Promise.resolve(true);
        },
      ),
    recallPostmortems: jest.fn().mockResolvedValue([]),
  };
  return { port, terminalCalls };
}

/**
 * 构造一个 orchestrator.run 被 mock 的 runner。
 * onRunArgs 回调捕获 orchestrator.run 收到的入参（含 pipelineInput.invocation）。
 * status 决定 orchestrator 返回的终态。
 */
function buildRunner(opts: {
  status: "completed" | "failed" | "aborted";
  onRunArgs?: (args: { input: unknown }) => void;
}): DeepInsightDefaultRunner {
  const orchestrator = {
    run: jest.fn().mockImplementation((args: { input: unknown }) => {
      opts.onRunArgs?.(args);
      return Promise.resolve({
        missionId: "m1",
        status: opts.status,
        stageOutputs: {},
        crossStageState: {},
        ...(opts.status !== "completed"
          ? { error: new Error("pipeline boom") }
          : {}),
      });
    }),
  };
  const pipelineRegistry = {
    has: jest.fn().mockReturnValue(true),
    register: jest.fn(),
  };
  const capabilityRegistry = { register: jest.fn() };
  // bindings 在构造器内被 new（用 agentRunner + assembler 服务），但 orchestrator.run
  //   被 mock 后 bindings 不会被执行——给最小占位即可。
  const noop = {} as never;
  const classifier = {
    classify: jest
      .fn()
      .mockReturnValue({ mode: "unknown", signals: [], confidence: 0 }),
  };
  const runner = new DeepInsightDefaultRunner(
    noop, // agentRunner
    noop, // chatFacade
    capabilityRegistry as never,
    pipelineRegistry as never,
    orchestrator as never,
    noop, // reportArtifactAssembler
    noop, // sectionSelfEval
    noop, // sectionRemediation
    noop, // reportEvaluation
    noop, // qualityTrace
    noop, // figureRelevance
    classifier as never,
  );
  return runner;
}

const baseCtx = (
  persistence: MissionPersistencePort,
): CapabilityRunContext => ({
  userId: "u1",
  missionId: "m1",
  persistence,
  onEvent: jest.fn(),
});

const RECON = {
  reconciliationReport: "对账全文：去重 5 条，统一术语 3 处",
  deduplicationStats: { duplicatesRemoved: 5, termVariantsUnified: 3 },
};

/** completed 路径需要非空 researcherResults，否则走零调研失败兜底分支。 */
const seedCompleted = (): Record<string, unknown> => ({
  [CS_KEY.researcherResults]: [{ dimension: "d1", findings: [], summary: "s" }],
  [CS_KEY.reconciliationReport]: RECON,
  [CS_KEY.report]: "# 报告",
});

describe("DeepInsightDefaultRunner 跨 agent 断链接通", () => {
  describe("task1: concurrency 用户档位透传", () => {
    it("input 带 concurrency 时，pipelineInput.invocation.concurrency 透传", async () => {
      const { port } = buildPersistence(seedCompleted());
      let captured: { invocation?: { concurrency?: number } } = {};
      const runner = buildRunner({
        status: "completed",
        onRunArgs: (args) => {
          captured = args.input as { invocation?: { concurrency?: number } };
        },
      });
      const input: CapabilityRunInput = { topic: "AMD 竞争力", concurrency: 8 };
      await runner.run(input, baseCtx(port));
      expect(captured.invocation?.concurrency).toBe(8);
    });

    it("input 不带 concurrency 时，invocation 不含该键（走默认兜底）", async () => {
      const { port } = buildPersistence(seedCompleted());
      let captured: { invocation?: Record<string, unknown> } = {};
      const runner = buildRunner({
        status: "completed",
        onRunArgs: (args) => {
          captured = args.input as { invocation?: Record<string, unknown> };
        },
      });
      const input: CapabilityRunInput = { topic: "AMD 竞争力" };
      await runner.run(input, baseCtx(port));
      expect(captured.invocation).toBeDefined();
      expect("concurrency" in (captured.invocation ?? {})).toBe(false);
    });
  });

  describe("task2: reconciliationReport 接线", () => {
    it("completed 终态 details 携带 reconciliationReport（state 非空）", async () => {
      const { port, terminalCalls } = buildPersistence(seedCompleted());
      const runner = buildRunner({ status: "completed" });
      await runner.run({ topic: "AMD 竞争力" }, baseCtx(port));
      const completed = terminalCalls.find((c) => c.outcome === "completed");
      expect(completed).toBeDefined();
      expect(completed?.details.reconciliationReport).toEqual(RECON);
    });

    it("leader 拒签 failed 终态 details 携带 reconciliationReport", async () => {
      const seed = {
        ...seedCompleted(),
        [CS_KEY.leaderSignOff]: { signed: false, refusalReason: "证据不足" },
      };
      const { port, terminalCalls } = buildPersistence(seed);
      const runner = buildRunner({ status: "completed" });
      await runner.run({ topic: "AMD 竞争力" }, baseCtx(port));
      const failed = terminalCalls.find((c) => c.outcome === "failed");
      expect(failed).toBeDefined();
      expect(failed?.details.failureCode).toBe("LEADER_REFUSED_SIGN");
      expect(failed?.details.reconciliationReport).toEqual(RECON);
    });

    it("orchestrator failed 终态 details 携带 reconciliationReport", async () => {
      // failed 路径读 finalState（= 同一 crossStageState），seed 的对账产物应透传。
      const seed = { [CS_KEY.reconciliationReport]: RECON };
      const { port, terminalCalls } = buildPersistence(seed);
      const runner = buildRunner({ status: "failed" });
      await runner.run({ topic: "AMD 竞争力" }, baseCtx(port));
      const failed = terminalCalls.find((c) => c.outcome === "failed");
      expect(failed).toBeDefined();
      expect(failed?.details.reconciliationReport).toEqual(RECON);
    });
  });
});
