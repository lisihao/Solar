/**
 * deep-insight 14 阶段执行内核 spec（W2）。
 *
 * 验证：
 *   1. runner.run 经 MissionPipelineOrchestrator + recipe 跑真 13 step（s1-budget …
 *      s11-persist），stage:started/completed 序列覆盖全部 recipe stepId。
 *   2. crossStageState 逐级传递（plan → researcherResults → analyst → report …），
 *      终态产出 completed + 报告 + 引用 + 算力。
 *   3. 缺 ctx.persistence → 用内存端口纯跑，0 真实 DB 写（持久化端口探针计数为内存）。
 *   4. telemetry.systemStageId 填 stepId（前端 14-chip 锚点）。
 *   5. reviewVerdict 合成（company 验收 gate 不退化）。
 *
 * 不依赖 NestJS DI：手动构造 MissionPipelineRegistry + MissionPipelineOrchestrator
 * + mock AgentRunner（按 spec id 路由产出）。
 */
import { MissionPipelineRegistry } from "@/modules/ai-harness/facade";
import { MissionPipelineOrchestrator } from "@/modules/ai-harness/facade";
import { readDefineAgentMeta } from "@/modules/ai-harness/facade";
import { CapabilityRegistry } from "../../../capability/capability-registry";
import { DeepInsightDefaultRunner } from "../deep-insight.runner";
import { DEEP_INSIGHT_PIPELINE } from "../recipe/deep-insight.recipe";
import type {
  CapabilityRunContext,
  MissionPersistencePort,
} from "../runner-deps";

/** 据 @DefineAgent id 路由 mock 产出（agentRunner.run(new Spec(), input, opts)）。 */
function makeAgentRunner() {
  const calls: Array<{ agentId: string; input: unknown }> = [];
  const run = jest.fn(async (Spec: { name?: string }, input: unknown) => {
    // runner 传 @DefineAgent 类（非实例）；mock 用类名（小写）路由。
    const agentId = (Spec?.name ?? "unknown").toLowerCase();
    calls.push({ agentId, input });
    const out = routeOutput(agentId, input);
    return {
      output: out,
      state: "completed" as const,
      tokensUsed: { prompt: 1, completion: 1, total: 2 },
      costCents: 1,
    };
  });
  return { run, calls };
}

/**
 * 契约校验 runner：每次 agentRunner.run 时把 bindings 构建的 input 用**真 agent
 * inputSchema**（@DefineAgent metadata）safeParse，收集违规。
 *
 * 防的是 depth:"Required" 这类回归——bindings 漏传 agent 必填字段，普通 mock runner
 * 不校验 input 会静默放过，但真 LLM 下 agentRunner 校验必失败（mission 直接挂）。
 */
function makeContractValidatingRunner() {
  const violations: Array<{ agentId: string; errors: string }> = [];
  const run = jest.fn(async (Spec: { name?: string }, input: unknown) => {
    const meta = readDefineAgentMeta(Spec as object);
    const schema = meta?.inputSchema;
    if (schema) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        violations.push({
          agentId: meta?.id ?? Spec?.name ?? "unknown",
          errors: parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        });
      }
    }
    const agentId = (Spec?.name ?? "unknown").toLowerCase();
    return {
      output: routeOutput(agentId, input),
      state: "completed" as const,
      tokensUsed: { prompt: 1, completion: 1, total: 2 },
      costCents: 1,
    };
  });
  return { run, violations };
}

function routeOutput(agentId: string, input: unknown): unknown {
  const phase = (input as { phase?: string }).phase;
  if (agentId.includes("leader") || phase) {
    if (phase === "plan") {
      return {
        phase: "plan",
        themeSummary: "theme summary for the research topic",
        dimensions: [
          {
            id: "d1",
            name: "维度一",
            rationale: "r1",
            toolHint: { categories: ["general"] },
          },
          {
            id: "d2",
            name: "维度二",
            rationale: "r2",
            toolHint: { categories: ["general"] },
          },
        ],
        goals: {
          successCriteria: [
            "完成深度研究报告，覆盖所有关键维度",
            "每个维度至少包含3个高质量来源",
          ],
          qualityBar: { minSources: 0, minCoverage: 0, hardConstraints: [] },
          deliverables: ["研究报告", "关键洞察摘要"],
        },
        initialRisks: [],
      };
    }
    if (phase === "assess-research")
      return {
        decision: "accept-all",
        rationale: "all dimensions have sufficient coverage",
        perDimension: [],
        newDimensions: [],
      };
    if (phase === "foreword") {
      return {
        phase: "foreword",
        whatWeAnswered: [
          {
            criterion: "研究目标完成度",
            addressed: "yes" as const,
            evidence: "所有维度均已完成深度研究和分析",
          },
        ],
        whatRemainsUnclear: [],
        howToRead: "本报告按维度组织，建议先阅读执行摘要再深入各章节",
        recommendedFollowUp: [],
      };
    }
    if (phase === "signoff") {
      return {
        phase: "signoff",
        leaderOverallScore: 82,
        leaderVerdict: "good" as const,
        accountabilityNote:
          "我在M0阶段制定了明确的研究计划，所有维度均按计划完成。本次研究覆盖了预设的所有成功标准，质量符合要求。",
        signed: true,
      };
    }
    return {};
  }
  if (agentId.includes("researcher")) {
    const dim = (input as { dimension?: string }).dimension ?? "维度";
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
      summary: `summary ${dim}`,
    };
  }
  if (agentId.includes("reconciler"))
    return { reconciliationReport: "rec", factTable: [] };
  if (agentId.includes("analyst"))
    return {
      insights: [
        {
          headline: "i1",
          narrative: "n1",
          supportingDimensions: ["维度一"],
          confidence: 0.8,
        },
      ],
      themeSummary: "theme",
    };
  if (agentId.includes("outline"))
    // MissionOutlinePlannerAgent
    return { chapterOutlines: [], targetWordsPerChapter: {} };
  if (agentId.includes("critic"))
    // MissionCriticAgent
    return { overallVerdict: "pass", rationale: "ok rationale here" };
  if (agentId.includes("reviewer"))
    // MissionReviewerAgent
    return { score: 80, verdict: "approve", notes: ["good"] };
  // SingleShotWriterAgent
  return { title: "报告", sections: [{ heading: "H1", body: "B1" }] };
}

/** 内存持久化探针：记录调用次数，断言无"真实 DB"语义（这里全内存）。 */
class ProbePersistence implements MissionPersistencePort {
  saveCheckpointCount = 0;
  applyTerminalCount = 0;
  lastTerminal: { outcome: string } | null = null;
  lastFinalScore: number | undefined;
  private cp = new Map<string, unknown>();

  async markStageProgress(): Promise<void> {}
  async saveCheckpoint(missionId: string, snapshot: unknown): Promise<boolean> {
    this.saveCheckpointCount++;
    this.cp.set(missionId, snapshot);
    return true;
  }
  async loadCheckpoint(): Promise<null> {
    return null;
  }
  async clearCheckpoint(missionId: string): Promise<void> {
    this.cp.delete(missionId);
  }
  async applyTerminalIfRunning(
    _missionId: string,
    outcome: "completed" | "failed" | "cancelled",
    details?: { finalScore?: number },
  ): Promise<boolean> {
    this.applyTerminalCount++;
    this.lastTerminal = { outcome };
    if (outcome === "completed") this.lastFinalScore = details?.finalScore;
    return true;
  }
}

/**
 * 富评判 / 富组装 stub（W2.5）。
 *   - assembler：把 writer report → reportArtifact（content.fullMarkdown / sections /
 *     quality.overall），与真服务同形状但纯映射（无 LLM / 无 ReportQualityGate 依赖）。
 *   - selfEval：默认 overallOk=true（不触发补救，保证 s8b 纯通过路径）。
 *   - remediation：skipped。
 *   - reportEvaluation：10 维 overallScore（s9b 客观评分 → finalScore）。
 *   - qualityTrace：createTrace + record* 全 no-op（纯计算探针，单测不验内部）。
 */
function makeRichStubs() {
  const reportArtifactAssembler = {
    assemble: jest.fn(
      (input: {
        writerReport: {
          title?: string;
          sections?: Array<{ heading?: string; body?: string }>;
        };
      }) => {
        const wr = input.writerReport;
        const parts: string[] = [];
        if (wr.title) parts.push(`# ${wr.title}`);
        for (const s of wr.sections ?? []) {
          if (s.heading) parts.push(`## ${s.heading}`);
          if (s.body) parts.push(s.body);
        }
        const fullMarkdown = parts.join("\n\n");
        return {
          title: wr.title ?? "报告",
          content: {
            fullMarkdown,
            fullReportSize: Buffer.byteLength(fullMarkdown, "utf8"),
          },
          sections: (wr.sections ?? []).map((s, i) => ({
            id: `chapter-${i + 1}`,
            // ★ 同时提供 title（s10 writerSections map 用）+ content（s8b remediaton 用）
            title: s.heading ?? `Section ${i + 1}`,
            content: s.body ?? "内容",
            citationIds: [],
            figureIds: [],
          })),
          citations: [],
          figures: [],
          quickView: {
            executiveSummary: {
              markdown:
                "本报告综合了多维度的深度研究，提供了全面的分析与洞察。",
            },
            conclusion: {
              markdown:
                "综合以上研究，本报告提供了深入的分析与见解，建议进一步关注相关领域的发展动态。",
            },
          },
          factTable: [],
          // ★ metadata 补 wordCount（s10 finalQuality.wordCount）
          metadata: { wordCount: 2000 },
          // ★ quality 补 finalVerdict（s10 qualitySnapshot.finalVerdict）
          quality: {
            overall: 75,
            dimensions: { coverage: 70, lengthAccuracy: 80 },
            finalVerdict: "acceptable",
            warnings: [],
          },
        };
      },
    ),
  };
  const sectionSelfEval = {
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
  };
  const sectionRemediation = {
    remediate: jest.fn(async (i: { content: string }) => ({
      content: i.content,
      actionsApplied: [],
      skipped: true,
      skipReason: "no_actions_needed",
    })),
  };
  const reportEvaluation = {
    evaluateReport: jest.fn(async () => ({
      chapters: [],
      overallScore: 88,
      grade: "B",
      feedback: "ok",
      modelComparison: [],
      evaluatorModel: "",
      evaluatedAt: new Date().toISOString(),
    })),
  };
  const qualityTrace = {
    createTrace: jest.fn(() => ({ reportId: "x", dimensionOutputs: [] })),
    recordDimensionRemediationLoop: jest.fn(),
  };
  // ★ figure re-home（2026-06-09）：FigureRelevance 精排 stub。
  //   默认 identity（返回全部入参），保证不削弱既有路径；个别用例覆盖断言精排被调。
  const figureRelevance = {
    filterRelevantFigures: jest.fn(
      async (figures: Array<{ imageUrl: string }>) => figures,
    ),
  };
  return {
    reportArtifactAssembler,
    sectionSelfEval,
    sectionRemediation,
    reportEvaluation,
    qualityTrace,
    figureRelevance,
  };
}

/** 最小 PostmortemClassifierService stub（classify 返回 success for completed）。 */
function makePostmortemClassifier() {
  return {
    classify: jest.fn(() => ({
      mode: "success" as const,
      signals: [],
      confidence: 1,
    })),
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
  return {
    runner,
    agentRunner,
    pipelineRegistry,
    capabilityRegistry,
    rich,
    postmortemClassifier,
  };
}

function makeRunner() {
  return makeRunnerWith(
    makeAgentRunner(),
    makeRichStubs(),
    makePostmortemClassifier(),
  );
}

describe("deep-insight 14 阶段执行内核（W2）", () => {
  it("runner 派生 id=deep-insight 注册 13 step（与 playground 私有 id 区分）", () => {
    const { pipelineRegistry } = makeRunner();
    expect(pipelineRegistry.has("deep-insight")).toBe(true);
    expect(DEEP_INSIGHT_PIPELINE.steps).toHaveLength(13);
  });

  it("onModuleInit 注册进 CapabilityRegistry，按 manifest.id 解析", () => {
    const { runner, capabilityRegistry } = makeRunner();
    expect(capabilityRegistry.resolve("deep-insight")).toBe(runner);
    expect(runner.manifest.kind).toBe("workflow");
  });

  it("跑通真 13 step：stage 序列覆盖全部 recipe stepId + telemetry.systemStageId", async () => {
    const { runner } = makeRunner();
    const stageStarted: string[] = [];
    const stageCompleted: string[] = [];
    const systemStageIds = new Set<string>();
    let started = false;
    let completed = false;

    const ctx: CapabilityRunContext = {
      userId: "u1",
      missionId: "m-1",
      onEvent: (e) => {
        if (e.type === "started") started = true;
        if (e.type === "completed") completed = true;
        if (e.type === "stage:started" && e.stepId) stageStarted.push(e.stepId);
        if (e.type === "stage:completed" && e.stepId)
          stageCompleted.push(e.stepId);
        if (e.telemetry?.systemStageId)
          systemStageIds.add(e.telemetry.systemStageId);
      },
    };

    const res = await runner.run(
      { topic: "AI 2026", depth: "standard", language: "zh-CN" },
      ctx,
    );

    expect(started).toBe(true);
    expect(completed).toBe(true);
    expect(res.status).toBe("completed");

    const recipeStepIds = DEEP_INSIGHT_PIPELINE.steps.map((s) => s.id);
    for (const id of recipeStepIds) {
      expect(stageStarted).toContain(id);
      expect(stageCompleted).toContain(id);
      expect(systemStageIds.has(id)).toBe(true);
    }
  });

  it("契约守护：每个 stage 给 agent 的 input 通过真 inputSchema 校验（防 depth:Required 类回归）", async () => {
    const validating = makeContractValidatingRunner();
    const { runner } = makeRunnerWith(validating as never, makeRichStubs());
    const res = await runner.run(
      { topic: "AI 2026", depth: "standard", language: "zh-CN" },
      { userId: "u", missionId: "m-contract" },
    );
    expect(res.status).toBe("completed");
    // 任何 binding 漏传 agent 必填字段 → safeParse 失败 → 这里红，带 agentId + 字段名。
    expect(validating.violations).toEqual([]);
  });

  it("crossState 逐级传递 → 终态报告 + 引用 + 算力 + reviewVerdict", async () => {
    const { runner } = makeRunner();
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-2" },
    );
    expect(res.status).toBe("completed");
    expect(res.report).toContain("# 报告");
    expect(res.report).toContain("## H1");
    // 2 维 researcher → 2 个去重 source
    expect(res.references?.length).toBe(2);
    expect(res.usage?.totalTokens).toBeGreaterThan(0);
    // reviewVerdict 合成（company gate 不退化）
    expect(res.reviewVerdict?.score).toBe(80);
    expect(res.reviewVerdict?.verdict).toBe("approve");
  });

  it("缺 ctx.persistence → 内存纯跑（不抛错、completed）", async () => {
    const { runner } = makeRunner();
    const res = await runner.run(
      { topic: "T", language: "en-US" },
      { userId: "u", missionId: "m-3" },
    );
    expect(res.status).toBe("completed");
  });

  it("注入 persistence 端口 → checkpoint + 终态仲裁经端口（0 app DB，全内存探针）", async () => {
    const { runner } = makeRunner();
    const probe = new ProbePersistence();
    const res = await runner.run(
      { topic: "T", language: "zh-CN" },
      { userId: "u", missionId: "m-4", persistence: probe },
    );
    expect(res.status).toBe("completed");
    // 每 stage 完成存一次 checkpoint（13 step）
    expect(probe.saveCheckpointCount).toBeGreaterThanOrEqual(13);
    expect(probe.applyTerminalCount).toBe(1);
    expect(probe.lastTerminal?.outcome).toBe("completed");
  });

  it("全 researcher 失败 → failed（不伪装成功）", async () => {
    const agentRunner = makeAgentRunner();
    // researcher 全返回 null output（ReActLoop 未 finalize 的真实形态）
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        if (id.includes("researcher")) {
          return {
            output: null,
            state: "completed" as const,
            tokensUsed: { prompt: 0, completion: 0, total: 0 },
            costCents: 0,
          };
        }
        return {
          output: routeOutput(id, input),
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    const res = await runner.run(
      { topic: "T", language: "zh-CN" },
      { userId: "u", missionId: "m-5" },
    );
    expect(res.status).toBe("failed");
  });

  // ── W2.5 富增强断言（不削弱以上 7 个断言；新增 parity 证据）──────────────────────

  it("s8 富组装：reportArtifactAssembler.assemble 被调，终稿用 artifact.content.fullMarkdown", async () => {
    const rich = makeRichStubs();
    const { runner } = makeRunnerWith(makeAgentRunner(), rich);
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-6" },
    );
    expect(res.status).toBe("completed");
    // s8 经 ReportArtifactAssembler 组装（playground 等价的富组装路径）。
    expect(rich.reportArtifactAssembler.assemble).toHaveBeenCalledTimes(1);
    // 终稿来自 artifact.content.fullMarkdown（含 writer sections）。
    expect(res.report).toContain("# 报告");
    expect(res.report).toContain("## H1");
  });

  it("s8b 富补救：长 section 跑 SectionSelfEval；overallOk 时不触发 remediation", async () => {
    const longBody = "x".repeat(400);
    const agentRunner = makeAgentRunner();
    // SingleShotWriterAgent（id 含 "writer"）产出 1 个长 body section（> 200 字触发自评）；
    // 其余角色沿用默认 routeOutput。
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        const out =
          id.includes("writer") && !id.includes("outline")
            ? { title: "报告", sections: [{ heading: "H1", body: longBody }] }
            : routeOutput(id, input);
        return {
          output: out,
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const rich = makeRichStubs();
    const { runner } = makeRunnerWith(agentRunner, rich);
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-7" },
    );
    expect(res.status).toBe("completed");
    // 长 section → 跑 SectionSelfEval（4 维写后自评）。
    expect(rich.sectionSelfEval.evaluateSection).toHaveBeenCalled();
    // overallOk=true（stub）→ 不触发定向补救（fail-open，不退化）。
    expect(rich.sectionRemediation.remediate).not.toHaveBeenCalled();
  });

  it("s9b 富评估：ReportEvaluation.evaluateReport 被调，finalScore 取客观 overallScore", async () => {
    const rich = makeRichStubs();
    const { runner } = makeRunnerWith(makeAgentRunner(), rich);
    const probe = new ProbePersistence();
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-8", persistence: probe },
    );
    expect(res.status).toBe("completed");
    expect(rich.reportEvaluation.evaluateReport).toHaveBeenCalledTimes(1);
    // finalScore = 客观 10 维 overallScore（88），而非 reviewVerdict.score（80）。
    expect(probe.lastFinalScore).toBe(88);
  });

  // ── figure re-home 断言（s8 组装前 figureCandidates embedding 相关性精排）──────────

  it("s8 figure 精排：有 figureCandidates 时按维度调 FigureRelevance.filterRelevantFigures", async () => {
    // researcher 产出带 figureCandidates（2 张 photo）；assembler 捕获精排后入参。
    const agentRunner = makeAgentRunner();
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        let out: unknown;
        if (id.includes("researcher")) {
          const dim = (input as { dimension?: string }).dimension ?? "维度";
          out = {
            dimension: dim,
            findings: [
              { claim: "c", evidence: "e", source: `https://${dim}.com` },
            ],
            summary: `summary ${dim}`,
            figureCandidates: [
              {
                sourceUrl: `https://${dim}.com/p`,
                imageUrl: `https://cdn/${dim}-1.png`,
                caption: "相关图：与主题强相关的图表说明文本",
              },
              {
                sourceUrl: `https://${dim}.com/p`,
                imageUrl: `https://cdn/${dim}-2.png`,
                caption: "无关广告 banner 图，应被精排剔除",
              },
            ],
          };
        } else {
          out = routeOutput(id, input);
        }
        return {
          output: out,
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const rich = makeRichStubs();
    // 精排：只保留 imageUrl 以 "-1" 结尾的（模拟相关图通过、广告图被拒）。
    rich.figureRelevance.filterRelevantFigures.mockImplementation(
      async (figures: Array<{ imageUrl: string }>) =>
        figures.filter((f) => f.imageUrl.endsWith("-1.png")),
    );
    // assembler 捕获 figure 精排后透传的 researcherResults.figureCandidates。
    let assembledFigureUrls: string[] = [];
    rich.reportArtifactAssembler.assemble.mockImplementation(
      (input: {
        writerReport: {
          title?: string;
          sections?: Array<{ heading?: string; body?: string }>;
        };
        researcherResults?: Array<{
          figureCandidates?: Array<{ imageUrl?: string }>;
        }>;
      }) => {
        assembledFigureUrls = (input.researcherResults ?? []).flatMap((r) =>
          (r.figureCandidates ?? [])
            .map((c) => c.imageUrl)
            .filter((u): u is string => typeof u === "string"),
        );
        return {
          title: input.writerReport.title,
          content: { fullMarkdown: "# 报告\n\n## H1\n\nB1", fullReportSize: 1 },
          sections: [],
          citations: [],
          figures: [],
          quickView: {},
          factTable: [],
          metadata: {},
          quality: { overall: 75, dimensions: {}, warnings: [] },
        };
      },
    );
    const { runner } = makeRunnerWith(agentRunner, rich);
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-fig-1" },
    );
    expect(res.status).toBe("completed");
    // 2 维 researcher × 各 2 候选 → 精排被调（每维一次）。
    expect(rich.figureRelevance.filterRelevantFigures).toHaveBeenCalled();
    // 精排后只剩 "-1" 候选（广告图被剔除）；组装入参不含 "-2"。
    expect(assembledFigureUrls.length).toBeGreaterThan(0);
    expect(assembledFigureUrls.every((u) => u.endsWith("-1.png"))).toBe(true);
    expect(assembledFigureUrls.some((u) => u.endsWith("-2.png"))).toBe(false);
  });

  // ── #16a 增量复用断言（inheritedBaseline 命中跳过 S2/S3；缺省不退化首次运行）──────────

  it("#16a 增量复用：inheritedBaseline 命中 → 跳过 S2 plan LLM + S3 researcher 检索，仍 completed", async () => {
    const agentRunner = makeAgentRunner();
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    const inheritedBaseline = {
      plan: {
        themeSummary: "继承主题",
        dimensions: [
          { id: "d1", name: "维度一", rationale: "r1" },
          { id: "d2", name: "维度二", rationale: "r2" },
        ],
      },
      researcherResults: [
        {
          dimension: "维度一",
          findings: [
            {
              claim: "c1",
              evidence: "e1",
              source: "https://reuse-1.com",
              sourceTitle: "t1",
            },
          ],
          summary: "复用 summary 1",
        },
        {
          dimension: "维度二",
          findings: [
            {
              claim: "c2",
              evidence: "e2",
              source: "https://reuse-2.com",
              sourceTitle: "t2",
            },
          ],
          summary: "复用 summary 2",
        },
      ],
    };
    const res = await runner.run(
      { topic: "AI", language: "zh-CN", inheritedBaseline },
      { userId: "u", missionId: "m-inherit-1" },
    );
    expect(res.status).toBe("completed");
    // S2 plan LLM 跳过（无 phase=plan 调用）——直接复用 inherited plan。
    const planCalls = agentRunner.calls.filter(
      (c) => (c.input as { phase?: string }).phase === "plan",
    );
    expect(planCalls).toHaveLength(0);
    // S3 researcher 全跳过（2 维都命中复用，无 web 检索）。
    const researcherCalls = agentRunner.calls.filter((c) =>
      c.agentId.includes("researcher"),
    );
    expect(researcherCalls).toHaveLength(0);
    // 复用的 research 正常进入终态引用（2 个去重 source）——下游 stage 无感。
    expect(res.references?.length).toBe(2);
  });

  it("#16a 缺省 inheritedBaseline → S2/S3 正常跑（不退化首次运行）", async () => {
    const agentRunner = makeAgentRunner();
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-fresh-1" },
    );
    expect(res.status).toBe("completed");
    // 首次运行：plan LLM 真跑一次。
    expect(
      agentRunner.calls.filter(
        (c) => (c.input as { phase?: string }).phase === "plan",
      ),
    ).toHaveLength(1);
    // researcher 按维真跑（≥2 维）。
    expect(
      agentRunner.calls.filter((c) => c.agentId.includes("researcher")).length,
    ).toBeGreaterThanOrEqual(2);
  });

  // ── #16b domain 事件面断言（能力轨恢复完整实时事件）────────────────────────────────

  it("#16b domain 事件：完整跑后 ctx.onEvent 收到 agent:lifecycle domain 事件（含 tokensUsed）", async () => {
    const { runner } = makeRunner();
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-domain-1",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const res = await runner.run({ topic: "AI 2026", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // P0：每次 invokeAgent 调用后必须有 agent:lifecycle domain 事件。
    const lifecycleEvents = domainEvents.filter(
      (e) => e.event === "agent:lifecycle",
    );
    expect(lifecycleEvents.length).toBeGreaterThan(0);
    // 双发语义（审计 #11/#27）：每次 invokeAgent 前发 phase=started（无终态字段），
    // 完成后发 completed/failed（含 tokensUsed）。
    expect(lifecycleEvents.some((ev) => ev.data.phase === "started")).toBe(
      true,
    );
    const terminalEvents = lifecycleEvents.filter(
      (ev) => ev.data.phase !== "started",
    );
    expect(terminalEvents.length).toBeGreaterThan(0);
    for (const ev of terminalEvents) {
      expect(typeof ev.data.tokensUsed).toBe("number");
    }
  });

  it("#16b domain 事件：S3 每个维度 dimension:research:started + dimension:research:completed", async () => {
    const { runner } = makeRunner();
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-domain-2",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const res = await runner.run({ topic: "AI 2026", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // S3 每个维度应有 started + completed 事件（2 维 → 各 2 个）。
    const started = domainEvents.filter(
      (e) => e.event === "dimension:research:started",
    );
    const completed = domainEvents.filter(
      (e) => e.event === "dimension:research:completed",
    );
    expect(started.length).toBeGreaterThanOrEqual(2);
    expect(completed.length).toBeGreaterThanOrEqual(2);
    // 每个 started 事件包含 dimension 字段。
    for (const ev of started) {
      expect(typeof ev.data.dimension).toBe("string");
    }
  });

  it("#16b domain 事件：S2 产出 leader:goals-set（含 goals/dimensions）", async () => {
    const { runner } = makeRunner();
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-domain-3",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const res = await runner.run({ topic: "AI 2026", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // P1：S2 plan 后必须有 leader:goals-set domain 事件。
    const goalsSet = domainEvents.find((e) => e.event === "leader:goals-set");
    expect(goalsSet).toBeDefined();
    expect(Array.isArray(goalsSet?.data.dimensions)).toBe(true);
  });

  it("#16b domain 事件：存在 agent:narrative 叙事事件（P0 编排叙事）", async () => {
    const { runner } = makeRunner();
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-domain-4",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const res = await runner.run({ topic: "AI 2026", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // P0：编排叙事事件存在（多个 stage 都会发）。
    const narratives = domainEvents.filter(
      (e) => e.event === "agent:narrative",
    );
    expect(narratives.length).toBeGreaterThan(0);
    // 每个 narrative 事件含 text + tag 字段。
    for (const ev of narratives) {
      expect(typeof ev.data.text).toBe("string");
      expect(typeof ev.data.tag).toBe("string");
    }
  });

  it("#16b domain 事件 best-effort：onEvent 抛错不阻断 mission 执行（仍 completed）", async () => {
    const { runner } = makeRunner();
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-domain-5",
      onEvent: () => {
        throw new Error("consumer bridge 故意抛错");
      },
    };
    // emitDomain 吞错，mission 不受影响。
    const res = await runner.run({ topic: "AI 2026", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
  });

  // ── C8 auditLayers 门控断言（minimal 跳过 critic；thorough 保持当前行为）────────────

  it("C8 auditLayers=minimal：s9 critic 跳过（不调 playground.critic agent）", async () => {
    const agentRunner = makeAgentRunner();
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    const res = await runner.run(
      {
        topic: "AI",
        language: "zh-CN",
        // auditLayers 以 string[] 形式传入（消费方包装语义）
        invocation: { auditLayers: ["minimal"] },
      } as never,
      { userId: "u", missionId: "m-audit-minimal" },
    );
    expect(res.status).toBe("completed");
    // minimal 时 critic agent 不应被调用。
    const criticCalls = agentRunner.calls.filter((c) =>
      c.agentId.includes("critic"),
    );
    expect(criticCalls).toHaveLength(0);
  });

  it("C8 auditLayers=default（空数组）：critic 跳过，outline 跳过（未配置深度 audit）", async () => {
    const agentRunner = makeAgentRunner();
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-audit-default" },
    );
    expect(res.status).toBe("completed");
    // 无 auditLayers → s9 critic 跳过（等价 minimal 路径）。
    const criticCalls = agentRunner.calls.filter((c) =>
      c.agentId.includes("critic"),
    );
    expect(criticCalls).toHaveLength(0);
    // 无 auditLayers → s7 outline 跳过。
    const outlineCalls = agentRunner.calls.filter((c) =>
      c.agentId.includes("outline"),
    );
    expect(outlineCalls).toHaveLength(0);
  });

  it("s8 figure 精排 fail-open：精排抛错不阻断报告（仍 completed，保留原候选）", async () => {
    const agentRunner = makeAgentRunner();
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        let out: unknown;
        if (id.includes("researcher")) {
          const dim = (input as { dimension?: string }).dimension ?? "维度";
          out = {
            dimension: dim,
            findings: [
              { claim: "c", evidence: "e", source: `https://${dim}.com` },
            ],
            summary: `s ${dim}`,
            figureCandidates: [
              {
                sourceUrl: `https://${dim}.com`,
                imageUrl: `https://cdn/${dim}.png`,
                caption: "图说明文本够长用于精排判定",
              },
            ],
          };
        } else {
          out = routeOutput(id, input);
        }
        return {
          output: out,
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const rich = makeRichStubs();
    rich.figureRelevance.filterRelevantFigures.mockRejectedValue(
      new Error("embedding endpoint 503"),
    );
    const { runner } = makeRunnerWith(agentRunner, rich);
    const res = await runner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-fig-2" },
    );
    // 精排失败 fail-open：报告仍组装成功（不阻断终态）。
    expect(res.status).toBe("completed");
    expect(rich.figureRelevance.filterRelevantFigures).toHaveBeenCalled();
  });

  // ── 富事件恢复断言（Task 7 emissions restored）────────────────────────────────

  it("S5 reconciliation:completed 事件恢复：完整跑后收到 reconciliation:completed（含 factCount/gapCount）", async () => {
    // reconciler mock 返回带 factTable/conflicts/gaps 的产物。
    const agentRunner = makeAgentRunner();
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        let out: unknown;
        if (id.includes("reconciler")) {
          out = {
            reconciliationReport: "rec",
            factTable: [{ fact: "f1" }, { fact: "f2" }],
            conflicts: [{ conflict: "c1" }],
            gaps: [{ gap: "g1" }, { gap: "g2" }],
            overlaps: [],
            figureCandidates: [],
            alternativeHypotheses: [],
          };
        } else {
          out = routeOutput(id, input);
        }
        return {
          output: out,
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-s5-reconcile",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    const res = await runner.run({ topic: "AI", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    const recEv = domainEvents.find(
      (e) => e.event === "reconciliation:completed",
    );
    expect(recEv).toBeDefined();
    expect(recEv?.data.factCount).toBe(2);
    expect(recEv?.data.conflictCount).toBe(1);
    expect(recEv?.data.gapCount).toBe(2);
  });

  it("S10 leader:foreword + leader:signed 事件恢复：完整跑后收到两个事件", async () => {
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-s10-signoff",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunner();
    const res = await runner.run({ topic: "AI", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // leader:foreword 事件
    const forewordEv = domainEvents.find((e) => e.event === "leader:foreword");
    expect(forewordEv).toBeDefined();
    // leader:signed 事件（mock signoff 返回 signed=true）
    const signedEv = domainEvents.find((e) => e.event === "leader:signed");
    expect(signedEv).toBeDefined();
    expect(signedEv?.data.signed).toBe(true);
  });

  it("S9 critic:verdict 事件恢复：auditLayers=thorough 时 critic 运行并发出 critic:verdict", async () => {
    const agentRunner = makeAgentRunner();
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-s9-critic-verdict",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    // auditLayers 放顶层，runner 从 input.auditLayers 透传进 invocation。
    const res = await runner.run(
      { topic: "AI", language: "zh-CN", auditLayers: ["thorough"] } as never,
      ctx,
    );
    expect(res.status).toBe("completed");
    const criticEv = domainEvents.find((e) => e.event === "critic:verdict");
    expect(criticEv).toBeDefined();
    expect(typeof criticEv?.data.verdict).toBe("string");
    expect(typeof criticEv?.data.blindspotCount).toBe("number");
    expect(Array.isArray(criticEv?.data.warnings)).toBe(true);
  });

  it("S9b verifier:verdict 事件恢复：客观评估成功后发出 verifier:verdict（含 score）", async () => {
    const rich = makeRichStubs();
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-s9b-verifier",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunnerWith(
      makeAgentRunner(),
      rich,
      makePostmortemClassifier(),
    );
    const res = await runner.run({ topic: "AI", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // S9b 默认路径：evaluateReport 被调（stub 返回 overallScore=88）
    expect(rich.reportEvaluation.evaluateReport).toHaveBeenCalledTimes(1);
    const verifierEv = domainEvents.find((e) => e.event === "verifier:verdict");
    expect(verifierEv).toBeDefined();
    expect(verifierEv?.data.score).toBe(88);
    expect(verifierEv?.data.verifierId).toBe("critic-eval");
  });

  it("S3 维度失败终态信号：researcher null-output 路径发 dimension:graded{overall:0} + agent:narrative{error}", async () => {
    const agentRunner = makeAgentRunner();
    // 只让第一个维度（维度一）返回 null output；维度二正常。
    let researcherCallIdx = 0;
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        if (id.includes("researcher")) {
          researcherCallIdx++;
          if (researcherCallIdx === 1) {
            // 第一个维度 null output（ReAct 未 finalize）
            return {
              output: null,
              state: "completed" as const,
              tokensUsed: { prompt: 0, completion: 0, total: 0 },
              costCents: 0,
            };
          }
        }
        return {
          output: routeOutput(id, input),
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-s3-dim-fail",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    // 1 维失败不阻断（另一维正常），mission 仍 completed。
    const res = await runner.run({ topic: "AI", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // 失败维度收到 dimension:graded 信号（overall=0）。
    const gradedEv = domainEvents.find(
      (e) => e.event === "dimension:graded" && e.data.overall === 0,
    );
    expect(gradedEv).toBeDefined();
    expect(gradedEv?.data.state).toBe("failed");
    // 同时收到 agent:narrative{tag:"error"} 叙事。
    const errorNarrative = domainEvents.find(
      (e) =>
        e.event === "agent:narrative" &&
        e.data.tag === "error" &&
        typeof e.data.dimension === "string",
    );
    expect(errorNarrative).toBeDefined();
  });

  it("S7 gated-skip narrative：无 auditLayers 时 s7 发 info narrative（跳过大纲规划）", async () => {
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-s7-skip",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunner();
    const res = await runner.run({ topic: "AI", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // s7 skip → info narrative 含"跳过大纲规划"。
    const s7Skip = domainEvents.find(
      (e) =>
        e.event === "agent:narrative" &&
        e.data.stage === "s7-writer-outline" &&
        e.data.tag === "info" &&
        typeof e.data.text === "string" &&
        e.data.text.includes("跳过"),
    );
    expect(s7Skip).toBeDefined();
  });

  it("S9 gated-skip narrative：无 auditLayers 时 s9 发 info narrative（跳过独立评审）", async () => {
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-s9-skip",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunner();
    const res = await runner.run({ topic: "AI", language: "zh-CN" }, ctx);
    expect(res.status).toBe("completed");
    // s9 skip → info narrative 含"跳过"。
    const s9Skip = domainEvents.find(
      (e) =>
        e.event === "agent:narrative" &&
        e.data.stage === "s9-critic" &&
        e.data.tag === "info" &&
        typeof e.data.text === "string" &&
        e.data.text.includes("跳过"),
    );
    expect(s9Skip).toBeDefined();
  });

  // ── P1-3 / P1-4 / P1-5 / P2-a / P2-b / P2-c 新增断言 ────────────────────────

  it("P1-3 S4 catch：leader assess 失败时发 warning narrative + 每维 dimension:graded（降级不卡死）", async () => {
    // leader assess-research 抛错（phase=assess-research 时返回 reject），其余正常。
    const agentRunner = makeAgentRunner();
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        const phase = (input as { phase?: string }).phase;
        if ((id.includes("leader") || phase) && phase === "assess-research") {
          throw new Error("LLM assess 故意失败");
        }
        return {
          output: routeOutput(id, input),
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-p1-3",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner } = makeRunnerWith(agentRunner, makeRichStubs());
    const res = await runner.run({ topic: "AI", language: "zh-CN" }, ctx);
    // 降级：视为 accept-all，下游照常成稿。
    expect(res.status).toBe("completed");
    // (a) 发出 warning narrative（标注 leader 评审失败）。
    const warnNarrative = domainEvents.find(
      (e) =>
        e.event === "agent:narrative" &&
        e.data.stage === "s4-leader-assess" &&
        e.data.tag === "warning",
    );
    expect(warnNarrative).toBeDefined();
    // (b) 每个维度都发出 dimension:graded（2 维 mock plan → 至少 2 条）。
    const gradedEvents = domainEvents.filter(
      (e) => e.event === "dimension:graded",
    );
    expect(gradedEvents.length).toBeGreaterThanOrEqual(2);
    for (const ev of gradedEvents) {
      expect(typeof ev.data.dimension).toBe("string");
      expect(typeof ev.data.overall).toBe("number");
    }
  });

  it("P1-5 leader 拒签 → applyTerminal failed + LEADER_REFUSED_SIGN + stageOutputs 保留报告", async () => {
    // leader signoff 返回 signed=false（拒签）。
    const agentRunner = makeAgentRunner();
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        const phase = (input as { phase?: string }).phase;
        if ((id.includes("leader") || phase) && phase === "signoff") {
          return {
            output: {
              phase: "signoff",
              signed: false,
              refusalReason: "报告质量不达标，需要补充更多证据",
              leaderOverallScore: 40,
              leaderVerdict: "poor",
              accountabilityNote: "研究覆盖面不足",
            },
            state: "completed" as const,
            tokensUsed: { prompt: 1, completion: 1, total: 2 },
            costCents: 1,
          };
        }
        return {
          output: routeOutput(id, input),
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const probe = new ProbePersistence();
    const { runner: refuseRunner } = makeRunnerWith(
      agentRunner,
      makeRichStubs(),
    );
    const res = await refuseRunner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-p1-5", persistence: probe },
    );
    // 拒签 → quality-failed 路径（status="failed"）。
    expect(res.status).toBe("failed");
    expect(res.error).toContain("quality-failed");
    // applyTerminal 传入 outcome="failed"。
    expect(probe.lastTerminal?.outcome).toBe("failed");
    // stageOutputs 仍有内容（拒签路径仍保留已组装的报告片段）。
    expect(res.stageOutputs).toBeDefined();
  });

  it("P1-5 leader 拒签 → failureCode=LEADER_REFUSED_SIGN 写入 persistence（通过 probe 拦截）", async () => {
    // 用可以捕获 details 的 probe 验证 failureCode。
    class DetailedProbePersistence extends ProbePersistence {
      lastDetails: { failureCode?: string; [k: string]: unknown } | null = null;
      override async applyTerminalIfRunning(
        _missionId: string,
        outcome: "completed" | "failed" | "cancelled",
        details?: {
          finalScore?: number;
          failureCode?: string;
          [k: string]: unknown;
        },
      ): Promise<boolean> {
        this.applyTerminalCount++;
        this.lastTerminal = { outcome };
        this.lastDetails = details ?? null;
        if (outcome === "completed") this.lastFinalScore = details?.finalScore;
        return true;
      }
    }
    const agentRunner = makeAgentRunner();
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        const phase = (input as { phase?: string }).phase;
        if ((id.includes("leader") || phase) && phase === "signoff") {
          return {
            output: { signed: false, refusalReason: "证据不足" },
            state: "completed" as const,
            tokensUsed: { prompt: 1, completion: 1, total: 2 },
            costCents: 1,
          };
        }
        return {
          output: routeOutput(id, input),
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const probe = new DetailedProbePersistence();
    const { runner: failRunner } = makeRunnerWith(agentRunner, makeRichStubs());
    const res = await failRunner.run(
      { topic: "AI", language: "zh-CN" },
      { userId: "u", missionId: "m-p1-5b", persistence: probe },
    );
    expect(res.status).toBe("failed");
    expect(probe.lastTerminal?.outcome).toBe("failed");
    expect(probe.lastDetails?.failureCode).toBe("LEADER_REFUSED_SIGN");
  });

  it("P2-b S2 seededPlan 复用 → 发 info narrative（复用 N 个维度）", async () => {
    // inheritedBaseline 注入 plan seed，触发 S2 seededPlan 路径。
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-p2-b",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner: seedRunner } = makeRunnerWith(
      makeAgentRunner(),
      makeRichStubs(),
    );
    const inheritedBaseline = {
      plan: {
        themeSummary: "继承主题",
        dimensions: [
          {
            id: "d1",
            name: "维度一",
            rationale: "r1",
            toolHint: { categories: ["general"] },
          },
          {
            id: "d2",
            name: "维度二",
            rationale: "r2",
            toolHint: { categories: ["general"] },
          },
        ],
      },
      researcherResults: [
        {
          dimension: "维度一",
          findings: [{ claim: "c1", source: "https://r1.com" }],
          summary: "s1",
        },
        {
          dimension: "维度二",
          findings: [{ claim: "c2", source: "https://r2.com" }],
          summary: "s2",
        },
      ],
    };
    const res = await seedRunner.run(
      { topic: "AI", language: "zh-CN", inheritedBaseline },
      ctx,
    );
    expect(res.status).toBe("completed");
    // P2-b：seededPlan 路径必须发出 info narrative 含"复用"。
    const seedNarrative = domainEvents.find(
      (e) =>
        e.event === "agent:narrative" &&
        e.data.stage === "s2-leader-plan" &&
        e.data.tag === "info" &&
        typeof e.data.text === "string" &&
        e.data.text.includes("复用"),
    );
    expect(seedNarrative).toBeDefined();
  });

  it("P2-c S5 单维度短路：单维 researcherResults → 跳过对账，发 info narrative + reconciliationReport=null", async () => {
    // 只配置 1 个维度，使 reconciler 触发 singleDimensionShortCircuit。
    const agentRunner = makeAgentRunner();
    agentRunner.run.mockImplementation(
      async (Spec: { name?: string }, input: unknown) => {
        const id = (Spec?.name ?? "").toLowerCase();
        const phase = (input as { phase?: string }).phase;
        if ((id.includes("leader") || phase) && phase === "plan") {
          return {
            output: {
              phase: "plan",
              themeSummary: "单维主题",
              dimensions: [
                {
                  id: "d1",
                  name: "唯一维度",
                  rationale: "r1",
                  toolHint: { categories: ["general"] },
                },
              ],
              goals: {
                successCriteria: ["完成研究"],
                qualityBar: {
                  minSources: 0,
                  minCoverage: 0,
                  hardConstraints: [],
                },
                deliverables: ["报告"],
              },
            },
            state: "completed" as const,
            tokensUsed: { prompt: 1, completion: 1, total: 2 },
            costCents: 1,
          };
        }
        return {
          output: routeOutput(id, input),
          state: "completed" as const,
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          costCents: 1,
        };
      },
    );
    const domainEvents: Array<{
      event: string;
      data: Record<string, unknown>;
    }> = [];
    const ctx: CapabilityRunContext = {
      userId: "u",
      missionId: "m-p2-c",
      onEvent: (e) => {
        if (e.type === "domain") {
          const p = e.payload as
            | { event?: string; data?: Record<string, unknown> }
            | undefined;
          if (p?.event)
            domainEvents.push({ event: p.event, data: p.data ?? {} });
        }
      },
    };
    const { runner: singleDimRunner } = makeRunnerWith(
      agentRunner,
      makeRichStubs(),
    );
    const res = await singleDimRunner.run(
      { topic: "AI 单维", language: "zh-CN" },
      ctx,
    );
    expect(res.status).toBe("completed");
    // reconciler agent 不应被调用（短路跳过）。
    const reconcilerCalls = agentRunner.calls.filter((c) =>
      c.agentId.includes("reconciler"),
    );
    expect(reconcilerCalls).toHaveLength(0);
    // 发出 info narrative 包含"单维度"。
    const singleDimNarrative = domainEvents.find(
      (e) =>
        e.event === "agent:narrative" &&
        e.data.stage === "s5-reconciler" &&
        e.data.tag === "info" &&
        typeof e.data.text === "string" &&
        e.data.text.includes("单维度"),
    );
    expect(singleDimNarrative).toBeDefined();
  });
});
