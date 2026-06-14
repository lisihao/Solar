/**
 * deep-insight S12 自进化 postlude spec
 *
 * 验证：
 *   1. completed mission 后 postlude 被 fire：classifier.classify 被调、recordPostmortem 被调。
 *   2. fire-and-forget：run() 先返回 CapabilityRunResult，postlude 异步跑（不阻塞）。
 *   3. postlude 内部抛错不破坏 mission 终态（run() 仍返回 completed）。
 *   4. persistence 未实现 recordPostmortem → postlude 跳写入，仍不报错。
 *   5. R1 隔离：本 spec 零 ai-app/playground / ai-app/company import。
 *
 * 不依赖 NestJS DI：手动构造 runner + mock。
 */
import { MissionPipelineRegistry } from "@/modules/ai-harness/facade";
import { MissionPipelineOrchestrator } from "@/modules/ai-harness/facade";
import { CapabilityRegistry } from "../../../capability/capability-registry";
import { DeepInsightDefaultRunner } from "../deep-insight.runner";
import type {
  CapabilityRunContext,
  MissionPersistencePort,
} from "../runner-deps";

// ── helpers ──────────────────────────────────────────────────────────────────

function makePostmortemClassifier() {
  return {
    classify: jest.fn(() => ({
      mode: "success" as const,
      signals: [],
      confidence: 1,
    })),
  };
}

function makeAgentRunner() {
  const run = jest.fn(async (Spec: { name?: string }, input: unknown) => {
    const agentId = (Spec?.name ?? "unknown").toLowerCase();
    return {
      output: routeOutput(agentId, input),
      state: "completed" as const,
      tokensUsed: { prompt: 1, completion: 1, total: 2 },
      costCents: 1,
    };
  });
  return { run };
}

function routeOutput(agentId: string, input: unknown): unknown {
  const phase = (input as { phase?: string }).phase;
  if (agentId.includes("leader") || phase) {
    if (phase === "plan")
      return {
        phase: "plan",
        themeSummary: "theme",
        dimensions: [
          {
            id: "d1",
            name: "维度一",
            rationale: "r1",
            toolHint: { categories: ["general"] },
          },
        ],
        goals: {
          successCriteria: [],
          qualityBar: { minSources: 0, minCoverage: 0, hardConstraints: [] },
          deliverables: [],
        },
        initialRisks: [],
      };
    if (phase === "assess-research")
      return {
        decision: "accept-all",
        rationale: "ok",
        perDimension: [],
        newDimensions: [],
      };
    if (phase === "foreword")
      return {
        phase: "foreword",
        whatWeAnswered: [
          { criterion: "c", addressed: "yes" as const, evidence: "e" },
        ],
        whatRemainsUnclear: [],
        howToRead: "read top-down",
        recommendedFollowUp: [],
      };
    if (phase === "signoff")
      return {
        phase: "signoff",
        leaderOverallScore: 80,
        leaderVerdict: "good" as const,
        accountabilityNote: "all done",
        signed: true,
      };
    return {};
  }
  if (agentId.includes("researcher")) {
    const dim = (input as { dimension?: string }).dimension ?? "d";
    return {
      dimension: dim,
      findings: [
        {
          claim: "c",
          evidence: "e",
          source: `https://${dim}.com`,
          sourceTitle: dim,
        },
      ],
      summary: `s ${dim}`,
    };
  }
  if (agentId.includes("reconciler"))
    return { reconciliationReport: "rec", factTable: [] };
  if (agentId.includes("analyst"))
    return {
      insights: [
        {
          headline: "i",
          narrative: "n",
          supportingDimensions: [],
          confidence: 0.8,
        },
      ],
      themeSummary: "t",
    };
  if (agentId.includes("outline"))
    return { chapterOutlines: [], targetWordsPerChapter: {} };
  if (agentId.includes("critic"))
    return { overallVerdict: "pass", rationale: "ok" };
  if (agentId.includes("reviewer"))
    return { score: 80, verdict: "approve", notes: [] };
  return { title: "报告", sections: [{ heading: "H1", body: "B1" }] };
}

function makeRichStubs() {
  return {
    reportArtifactAssembler: {
      assemble: jest.fn(
        (i: {
          writerReport: {
            title?: string;
            sections?: Array<{ heading?: string; body?: string }>;
          };
        }) => ({
          title: i.writerReport.title ?? "报告",
          content: { fullMarkdown: "# 报告\n\n## H1\n\nB1", fullReportSize: 1 },
          sections: [],
          citations: [],
          figures: [],
          quickView: {},
          factTable: [],
          metadata: { wordCount: 100 },
          quality: { overall: 75, dimensions: {}, warnings: [] },
        }),
      ),
    },
    sectionSelfEval: {
      evaluateSection: jest.fn(async () => ({
        scores: {
          analytical_depth: 8,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
        weakAreas: [],
        overallOk: true,
      })),
      determineRemediationActions: jest.fn(() => []),
    },
    sectionRemediation: {
      remediate: jest.fn(async (i: { content: string }) => ({
        content: i.content,
        actionsApplied: [],
        skipped: true,
        skipReason: "no_actions_needed",
      })),
    },
    reportEvaluation: {
      evaluateReport: jest.fn(async () => ({
        chapters: [],
        overallScore: 88,
        grade: "B",
        feedback: "ok",
        modelComparison: [],
        evaluatorModel: "",
        evaluatedAt: new Date().toISOString(),
      })),
    },
    qualityTrace: {
      createTrace: jest.fn(() => ({ reportId: "x", dimensionOutputs: [] })),
      recordDimensionRemediationLoop: jest.fn(),
    },
    figureRelevance: {
      filterRelevantFigures: jest.fn(async (f: unknown[]) => f),
    },
  };
}

function makeRunnerWith(
  agentRunner: ReturnType<typeof makeAgentRunner>,
  rich: ReturnType<typeof makeRichStubs>,
  postmortemClassifier = makePostmortemClassifier(),
) {
  const pipelineRegistry = new MissionPipelineRegistry();
  const orchestrator = new MissionPipelineOrchestrator(pipelineRegistry);
  const capabilityRegistry = new CapabilityRegistry();
  const runner = new DeepInsightDefaultRunner(
    agentRunner as never,
    { chat: jest.fn() } as never,
    capabilityRegistry,
    pipelineRegistry,
    orchestrator,
    rich.reportArtifactAssembler as never,
    rich.sectionSelfEval as never,
    rich.sectionRemediation as never,
    rich.reportEvaluation as never,
    rich.qualityTrace as never,
    rich.figureRelevance as never,
    postmortemClassifier as never,
  );
  runner.onModuleInit();
  return { runner, postmortemClassifier };
}

/** 带 recordPostmortem 的内存探针持久化端口。 */
class PostmortemProbePersistence implements MissionPersistencePort {
  recordPostmortemArgs: unknown[] = [];
  applyTerminalCount = 0;

  markStageProgress(): Promise<void> {
    return Promise.resolve();
  }
  saveCheckpoint(_id: string, _s: unknown): Promise<boolean> {
    return Promise.resolve(true);
  }
  loadCheckpoint(): Promise<null> {
    return Promise.resolve(null);
  }
  clearCheckpoint(): Promise<void> {
    return Promise.resolve();
  }
  applyTerminalIfRunning(): Promise<boolean> {
    this.applyTerminalCount++;
    return Promise.resolve(true);
  }
  async recordPostmortem(args: unknown): Promise<void> {
    this.recordPostmortemArgs.push(args);
  }
}

/** 无 recordPostmortem 的内存持久化端口（验证 optional hook 缺失时不报错）。 */
class MinimalPersistence implements MissionPersistencePort {
  markStageProgress(): Promise<void> {
    return Promise.resolve();
  }
  saveCheckpoint(): Promise<boolean> {
    return Promise.resolve(true);
  }
  loadCheckpoint(): Promise<null> {
    return Promise.resolve(null);
  }
  clearCheckpoint(): Promise<void> {
    return Promise.resolve();
  }
  applyTerminalIfRunning(): Promise<boolean> {
    return Promise.resolve(true);
  }
  // recordPostmortem 故意不实现
}

/** 等待微任务队列（让 fire-and-forget Promise 跑完）。 */
async function flushAsync() {
  // 连续 flush 几轮，确保嵌套 Promise 全完成。
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

// ── test suite ────────────────────────────────────────────────────────────────

describe("deep-insight S12 自进化 postlude", () => {
  it("completed mission 后 postlude 被 fire：classifier.classify + recordPostmortem 均被调", async () => {
    const classifier = makePostmortemClassifier();
    const { runner } = makeRunnerWith(
      makeAgentRunner(),
      makeRichStubs(),
      classifier,
    );
    const probe = new PostmortemProbePersistence();

    const ctx: CapabilityRunContext = {
      userId: "u-postlude-1",
      missionId: "m-postlude-1",
      persistence: probe,
    };
    const res = await runner.run(
      { topic: "AI 自进化测试", language: "zh-CN" },
      ctx,
    );
    expect(res.status).toBe("completed");

    // fire-and-forget：run() 返回时 postlude 可能还没跑完；等微任务队列 flush。
    await flushAsync();

    // classifier.classify 被调（postlude 内部分类）。
    expect(classifier.classify).toHaveBeenCalled();
    // recordPostmortem 被调（探针端口收到写入）。
    expect(probe.recordPostmortemArgs.length).toBeGreaterThan(0);
  });

  it("fire-and-forget：run() 先返回，postlude 不阻塞终态", async () => {
    // 用一个延迟 recordPostmortem 证明 run() 不 await postlude。
    let postludeResolved = false;
    const classifier = makePostmortemClassifier();
    const { runner } = makeRunnerWith(
      makeAgentRunner(),
      makeRichStubs(),
      classifier,
    );

    class DelayedPersistence extends PostmortemProbePersistence {
      override async recordPostmortem(): Promise<void> {
        await new Promise<void>((r) => setTimeout(r, 50));
        postludeResolved = true;
      }
    }

    const ctx: CapabilityRunContext = {
      userId: "u-postlude-2",
      missionId: "m-postlude-2",
      persistence: new DelayedPersistence(),
    };

    const res = await runner.run(
      { topic: "非阻塞测试", language: "zh-CN" },
      ctx,
    );
    // run() 返回时 postlude 的 50ms 延迟还没结束 → postludeResolved 应为 false。
    expect(res.status).toBe("completed");
    expect(postludeResolved).toBe(false);

    // 等 postlude 结束。
    await new Promise<void>((r) => setTimeout(r, 80));
    expect(postludeResolved).toBe(true);
  });

  it("postlude 内 recordPostmortem 抛错不破坏 mission 终态（run() 仍 completed）", async () => {
    const classifier = makePostmortemClassifier();
    const { runner } = makeRunnerWith(
      makeAgentRunner(),
      makeRichStubs(),
      classifier,
    );

    class ErrorPersistence extends PostmortemProbePersistence {
      override async recordPostmortem(): Promise<void> {
        throw new Error("vector DB 写入超时");
      }
    }

    const ctx: CapabilityRunContext = {
      userId: "u-postlude-3",
      missionId: "m-postlude-3",
      persistence: new ErrorPersistence(),
    };

    const res = await runner.run(
      { topic: "异常容错测试", language: "zh-CN" },
      ctx,
    );
    // postlude 抛错不应影响 run() 返回值。
    expect(res.status).toBe("completed");

    // 等 postlude 运行（即便抛错）。
    await flushAsync();
    // run() 还是 completed（没被 postlude 错误污染）。
    expect(res.status).toBe("completed");
  });

  it("persistence 未实现 recordPostmortem（optional hook 缺失）→ postlude 跳写入，不报错", async () => {
    const classifier = makePostmortemClassifier();
    const { runner } = makeRunnerWith(
      makeAgentRunner(),
      makeRichStubs(),
      classifier,
    );
    const minimal = new MinimalPersistence();

    const ctx: CapabilityRunContext = {
      userId: "u-postlude-4",
      missionId: "m-postlude-4",
      persistence: minimal,
    };

    const res = await runner.run(
      { topic: "无 recordPostmortem 测试", language: "zh-CN" },
      ctx,
    );
    expect(res.status).toBe("completed");

    await flushAsync();
    // 未报错，无 unhandled rejection（test runner 会捕获到 unhandled rejection 导致失败）。
    expect(res.status).toBe("completed");
  });

  it("postlude 写入的 recordPostmortem args 含 source=deep-insight:mission + tags 含 deep-insight", async () => {
    const classifier = makePostmortemClassifier();
    const { runner } = makeRunnerWith(
      makeAgentRunner(),
      makeRichStubs(),
      classifier,
    );
    const probe = new PostmortemProbePersistence();

    const ctx: CapabilityRunContext = {
      userId: "u-postlude-5",
      missionId: "m-postlude-5",
      persistence: probe,
    };

    const res = await runner.run(
      { topic: "tags 校验测试", language: "zh-CN" },
      ctx,
    );
    expect(res.status).toBe("completed");
    await flushAsync();

    expect(probe.recordPostmortemArgs.length).toBe(1);
    const args = probe.recordPostmortemArgs[0] as {
      source: string;
      tags: string[];
      missionId: string;
      userId: string;
    };
    expect(args.source).toBe("deep-insight:mission");
    expect(args.tags).toContain("deep-insight");
    expect(args.tags).toContain("mission-postmortem");
    expect(args.missionId).toBe("m-postlude-5");
    expect(args.userId).toBe("u-postlude-5");
  });
});
