import { CrossStageState, type StageRunArgs } from "@/modules/ai-harness/facade";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CS_KEY } from "../../deep-insight/pipeline/ports";
import { DEEP_INSIGHT_PIPELINE } from "../../deep-insight/recipe/deep-insight.recipe";
import {
  attachState,
  detachState,
} from "../../deep-insight/pipeline/bindings";
import type { RichServices } from "../../deep-insight/pipeline/bindings/deep-insight-stage-bindings";
import { DEEP_INSIGHT_SOLAR_PIPELINE } from "../recipe/deep-insight-solar.recipe";
import {
  attachSolarState,
  DeepInsightSolarStageBindings,
  detachSolarState,
  SOLAR_CS_KEY,
} from "../pipeline/bindings/deep-insight-solar-stage-bindings";
import {
  SubprocessSolarHarnessOperatorPort,
  type SolarHarnessOperatorPort,
  type SolarOperatorRequest,
  type SolarOperatorResult,
} from "../ports/solar-harness-operator.port";
import {
  evaluateDeepInsightSolarDeliverable,
  resolveDeepInsightSolarNativeModelId,
} from "../deep-insight-solar.runner";
import {
  evaluateInsightRubric,
  evaluateResearchCoverage,
  normalizeResearchAssetLedger,
  normalizeTechnologyInsightPlan,
  normalizeThesisGraph,
} from "../research-os";

function richServices(): RichServices {
  return {
    reportArtifactAssembler: {
      assemble: (input: { topic: string }) => ({
        title: input.topic,
        content: { fullMarkdown: `# ${input.topic}\n\nassembled` },
        sections: [],
        citations: [],
        figures: [],
        quality: { overall: 88 },
        metadata: { source: "test" },
      }),
    },
    sectionSelfEval: {},
    sectionRemediation: {},
    reportEvaluation: {},
    qualityTrace: {},
    figureRelevance: {},
  } as unknown as RichServices;
}

class MockSolarOperatorPort implements SolarHarnessOperatorPort {
  runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
    if (request.operatorId === "BrowserLeaderPlanner") {
      return Promise.resolve({
        status: "succeeded",
        structured: {
          centralQuestion: "Agent system architecture control point migration",
          initialTheses: ["Control moves from model call to runtime/state/verifier."],
          researchQuestions: ["Which bottleneck forces the migration?"],
          workstreams: [
            {
              id: "evolution",
              name: "Evolution Ledger",
              objective: "Rebuild architecture generations",
              assetTypes: ["evolutionEvent", "evidenceCard"],
            },
            {
              id: "architecture",
              name: "Architecture Stack Map",
              objective: "Map runtime/state/scheduler layers",
              assetTypes: ["stackNode", "interfaceEdge", "bottleneckCard"],
            },
            {
              id: "ecosystem",
              name: "Actor and weak signal graph",
              objective: "Map labs, companies, contradictions, weak signals, and opportunities",
              assetTypes: [
                "actorCard",
                "sotaFinding",
                "contradiction",
                "weakSignal",
                "opportunityHypothesis",
              ],
            },
          ],
          mandatoryArtifacts: [
            "evidenceCard",
            "evolutionEvent",
            "stackNode",
            "actorCard",
            "sotaFinding",
            "bottleneckCard",
            "contradiction",
            "weakSignal",
            "opportunityHypothesis",
          ],
        },
        metrics: { modelId: "mock-strong-model", tokensUsed: 10, costCents: 1 },
      });
    }
    if (request.operatorId === "BrowserAnalyst") {
      return Promise.resolve({
        status: "succeeded",
        structured: {
          theses: [
            {
              id: "thesis-1",
              statement: "Agent infra control point shifts to runtime, state, and verifier.",
              mechanism: "Tool loops and retry DAGs increase state movement and scheduling pressure.",
              evidenceIds: ["ev-runtime"],
              counterEvidenceIds: ["ev-counter"],
              limitations: ["Evidence is early."],
              architectureImplications: ["Runtime control plane becomes strategic."],
              opportunityImplications: ["Verifier-native runtime wedge."],
            },
          ],
          reportOutline: [
            {
              id: "section-1",
              title: "控制点迁移",
              thesisIds: ["thesis-1"],
            },
          ],
          diagramBriefs: [{ id: "fig-1", caption: "Agent system stack" }],
        },
        evidence: [{ id: "ev-1" }],
      });
    }
    if (request.operatorId === "BrowserResearcher") {
      const payload = request.payload as {
        dimension?: { name?: string };
      };
      return Promise.resolve({
        status: "succeeded",
        structured: {
          dimension: payload.dimension?.name ?? "Architecture",
          summary: "Solar researcher summary",
          assets: [
            {
              id: "ev-runtime",
              type: "evidenceCard",
              title: "Runtime source",
              summary: "A system paper connects agent workloads with scheduling and state pressure.",
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "evo-1",
              type: "evolutionEvent",
              title: "Prompt chains to runtime DAGs",
              summary: "Tool loops created pressure that old prompt-chain orchestration could not absorb.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "stack-1",
              type: "stackNode",
              title: "Runtime control plane",
              summary: "The runtime layer coordinates tools, state, scheduling, and verification.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "actor-1",
              type: "actorCard",
              title: "Runtime startup",
              summary: "A startup owns the runtime/state bottleneck wedge.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "sota-1",
              type: "sotaFinding",
              title: "SOTA runtime benchmark",
              summary: "Benchmarks increasingly include multi-step tool and state pressure.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "bottleneck-1",
              type: "bottleneckCard",
              title: "State movement bottleneck",
              summary: "Retry DAGs and long-running tool loops shift cost into state movement.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "contradiction-1",
              type: "contradiction",
              title: "Benchmark vs production contradiction",
              summary: "Static benchmarks hide production state and scheduler pressure.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "weak-1",
              type: "weakSignal",
              title: "Runtime interface convergence",
              summary: "Open-source projects converge on stateful runtime interfaces.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
            {
              id: "opp-1",
              type: "opportunityHypothesis",
              title: "Verifier-native runtime",
              summary: "A product wedge emerges where verification is part of the runtime contract.",
              evidenceIds: ["ev-runtime"],
              sourceUrls: ["https://example.com/agent-runtime"],
            },
          ],
          findings: [
            {
              claim: "Agent infrastructure is moving toward runtime control.",
              evidence: "System papers emphasize scheduling, serving, and benchmark control planes.",
              source: "https://example.com/agent-runtime",
              sourceTitle: "Agent runtime source",
            },
          ],
          fullMarkdown: "Solar researcher produced grounded markdown.",
        },
        metrics: { modelId: "mock-strong-model" },
      });
    }
    if (request.operatorId === "BrowserLongformWriter") {
      return Promise.resolve({
        status: "succeeded",
        structured: {
          executiveBriefMarkdown:
            "Agent infrastructure is shifting from model-only competition to runtime, state, and verifier control points.",
          standardReportMarkdown:
            "## 研究资产到论点映射\n\n| thesis | evidence |\n|---|---|\n| thesis-1 | ev-runtime |\n\n## 控制点迁移\n\n" +
            "Agent system 的计算架构正在从单次模型调用，变成围绕状态、工具、检索、调度和验证闭环组织起来的运行时系统。".repeat(
              80,
            ),
          evidenceBook: { sourceCount: 1 },
        },
      });
    }
    return Promise.resolve({
      status: "succeeded",
      structured: {
        recommendations: ["tighten citations"],
      },
    });
  }
}

function ctx(state: CrossStageState): StageRunArgs["ctx"] {
  void state;
  return {
    missionId: "mission-solar-test",
    input: {
      topic: "Agent system architecture",
      language: "zh-CN",
      invocation: {
        userId: "user-1",
        depth: "standard",
      },
    },
  } as StageRunArgs["ctx"];
}

describe("deep-insight-solar stage bindings", () => {
  afterEach(() => {
    detachSolarState("mission-solar-test");
    detachState("mission-solar-test");
  });

  it("maps S2/S6/S8/S9 Solar operator output into compatible CrossStageState", async () => {
    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    attachSolarState("mission-solar-test", state);

    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      new MockSolarOperatorPort(),
    );
    const stageCtx = ctx(state);

    const s2 = bindings.buildHooksForStep("s2-leader-plan") as {
      runRole(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    await s2.runRole({ ctx: stageCtx });
    expect(state.get(CS_KEY.plan)).toMatchObject({
      themeSummary: "Agent system architecture control point migration",
    });
    expect(state.get(SOLAR_CS_KEY.technologyInsightPlan)).toMatchObject({
      centralQuestion: "Agent system architecture control point migration",
      mandatoryArtifacts: expect.arrayContaining(["evidenceCard", "evolutionEvent"]),
    });

    const s3 = bindings.buildHooksForStep("s3-researcher-collect") as {
      fanOut(args: { ctx: StageRunArgs["ctx"] }): ReadonlyArray<unknown>;
      perItemPipeline(args: {
        item: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown>;
    };
    const [firstDimension] = s3.fanOut({ ctx: stageCtx });
    await s3.perItemPipeline({ item: firstDimension, ctx: stageCtx });
    expect(state.get(CS_KEY.researcherResults)).toEqual(
      expect.arrayContaining([
      expect.objectContaining({
        dimension: "Evolution Ledger",
        findings: expect.arrayContaining([
          expect.objectContaining({
            claim: "Agent infrastructure is moving toward runtime control.",
            source: "https://example.com/agent-runtime",
          }),
        ]),
      }),
    ]),
    );
    expect(state.get(SOLAR_CS_KEY.researchAssetLedger)).toMatchObject({
      assetTypeCounts: {
        evidenceCard: expect.any(Number),
        evolutionEvent: expect.any(Number),
      },
    });

    const s6 = bindings.buildHooksForStep("s6-analyst") as {
      synthesize(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    await s6.synthesize({ ctx: stageCtx });
    expect(state.get(SOLAR_CS_KEY.coverageReport)).toMatchObject({
      ok: true,
    });
    expect(state.get(SOLAR_CS_KEY.thesisGraph)).toMatchObject({
      theses: [{ id: "thesis-1" }],
    });
    expect(state.get(SOLAR_CS_KEY.diagramBriefs)).toHaveLength(1);

    const s8 = bindings.buildHooksForStep("s8-writer") as {
      draftOnce(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
      reportArtifactAssembler(args: {
        artifact: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown>;
    };
    const report = await s8.draftOnce({ ctx: stageCtx });
    await s8.reportArtifactAssembler({ artifact: report, ctx: stageCtx });
    expect(state.get(SOLAR_CS_KEY.reportPackage)).toMatchObject({
      schemaVersion: "deep-insight-solar.research-os.v1",
      standardReportMarkdown: expect.stringContaining("研究资产到论点映射"),
    });
    expect(state.get(CS_KEY.reportArtifact)).toMatchObject({
      content: { fullMarkdown: expect.stringContaining("Agent system architecture") },
      metadata: {
        researchOsSchemaVersion: "deep-insight-solar.research-os.v1",
      },
    });

    const s9 = bindings.buildHooksForStep("s9-critic") as {
      review(args: { artifact: unknown; ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    await s9.review({ artifact: state.get(CS_KEY.reportArtifact), ctx: stageCtx });
    expect(state.get(SOLAR_CS_KEY.redTeamMemo)).toMatchObject({
      recommendations: ["tighten citations"],
    });
    expect(state.get(SOLAR_CS_KEY.insightRubricResult)).toMatchObject({
      ok: true,
    });
    expect(state.get(CS_KEY.reviewVerdict)).toMatchObject({ verdict: "approve" });
  });

  it("adds a visible asset-to-thesis map when S8 synthesizes broader chapters", async () => {
    class RenamingWriterPort implements SolarHarnessOperatorPort {
      lastWriterPayload: unknown;

      runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
        if (request.operatorId === "BrowserLongformWriter") {
          this.lastWriterPayload = request.payload;
          return Promise.resolve({
            status: "succeeded",
            structured: {
              title: "Solar synthesized report",
              summary: "summary",
              sections: [
                {
                  heading: "Agent runtime synthetic chapter",
                  body: "本节把 Agentic runtime 的执行、调度、状态和异步 DAG 控制问题合并为一个综合章节。".repeat(
                    8,
                  ),
                },
                {
                  heading: "从论文到公司 synthetic chapter",
                  body: "本节讨论从论文到公司的平台型商业化路径，并保留业务化判断的结构入口。".repeat(
                    8,
                  ),
                },
              ],
              conclusion: "结论完整保留。",
              citations: ["https://example.com/source-a"],
            },
          });
        }
        return Promise.resolve({ status: "failed" });
      }
    }

    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    state.set(CS_KEY.plan, {
      themeSummary: "Solar contract",
      dimensions: [
        {
          id: "d1",
          name: "Agentic runtime 的核心瓶颈：从 GPU 利用率问题转为异步 DAG 调度问题",
          rationale: "runtime",
        },
        {
          id: "d2",
          name: "从论文到公司：识别哪些研究具有平台型商业化路径",
          rationale: "commercialization",
        },
      ],
    });
    state.set(SOLAR_CS_KEY.thesisGraph, {
      schemaVersion: "deep-insight-solar.research-os.v1",
      theses: [
        {
          id: "thesis-1",
          statement: "Agent runtime shifts the control point.",
          mechanism: "stateful DAG pressure",
          evidenceIds: ["ev-runtime"],
          counterEvidenceIds: [],
          limitations: [],
          architectureImplications: [],
          opportunityImplications: [],
        },
      ],
      claimEdges: [],
      evidenceBindings: [],
      counterEvidence: [],
      openQuestions: [],
      reportOutline: [{ id: "section-1", title: "Agent runtime", thesisIds: ["thesis-1"] }],
    });
    attachSolarState("mission-solar-test", state);
    const port = new RenamingWriterPort();
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      port,
    );
    const s8 = bindings.buildHooksForStep("s8-writer") as {
      draftOnce(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };

    const report = (await s8.draftOnce({ ctx: ctx(state) })) as {
      sections?: Array<{ heading?: string; body?: string }>;
    };

    expect(JSON.stringify(port.lastWriterPayload)).toContain("thesisGraph");
    expect(report.sections?.[0]?.heading).toBe("研究资产到论点映射");
    expect(report.sections?.[0]?.body).toContain("thesis-1");
    expect(report.sections?.[0]?.body).toContain("ev-runtime");
  });

  it("recovers long Solar writer sections when the artifact assembler drops them", async () => {
    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    attachSolarState("mission-solar-test", state);
    const droppedAssembler = {
      ...richServices(),
      reportArtifactAssembler: {
        assemble: () => ({
          title: "Short placeholder",
          content: {
            fullMarkdown:
              "# Short placeholder\n\n## Runtime\n\n证据锚点：本节可回溯来源 [1]。",
          },
          sections: [
            {
              title: "Runtime",
              content: "证据锚点：本节可回溯来源 [1]。",
              wordCount: 10,
            },
          ],
          citations: [{ id: "c1" }],
          figures: [],
          quality: { overall: 88 },
          metadata: { source: "test" },
        }),
      },
    } as unknown as RichServices;
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      droppedAssembler,
      new MockSolarOperatorPort(),
    );
    const s8 = bindings.buildHooksForStep("s8-writer") as {
      reportArtifactAssembler(args: {
        artifact: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown>;
    };
    const longBody =
      "Agent system 的计算架构正在从单次模型调用，变成围绕状态、工具、检索、调度、缓存和验证闭环组织起来的运行时系统。".repeat(
        120,
      );

    await s8.reportArtifactAssembler({
      artifact: {
        title: "Solar writer report",
        summary: "这是一份由 Solar BrowserLongformWriter 生成的长文草稿。",
        sections: [
          {
            heading: "Runtime control plane",
            body: longBody,
            sources: ["https://example.com/runtime"],
          },
        ],
        conclusion: "结论部分保留 writer 的长文语义，而不是短占位。",
        citations: ["https://example.com/runtime"],
      },
      ctx: ctx(state),
    });

    const artifact = state.get(CS_KEY.reportArtifact) as {
      content?: { fullMarkdown?: string };
      sections?: Array<{ content?: string; body?: string }>;
      metadata?: { solarWriterBodyRecovered?: boolean };
    };
    expect(artifact.content?.fullMarkdown).toContain("Runtime control plane");
    expect(artifact.content?.fullMarkdown?.length).toBeGreaterThan(6000);
    expect(artifact.sections?.[0]?.content).toContain("Agent system 的计算架构");
    expect(artifact.metadata?.solarWriterBodyRecovered).toBe(true);
  });

  it("normalizes text-only Solar operator results before mapping stages", async () => {
    class TextOnlyPort implements SolarHarnessOperatorPort {
      runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
        if (request.operatorId === "BrowserLeaderPlanner") {
          return Promise.resolve({
            status: "succeeded",
            text: JSON.stringify({
              themeSummary: "Text-only contract",
              dimensions: [{ id: "d1", name: "Runtime", rationale: "r" }],
            }),
          } as SolarOperatorResult);
        }
        return Promise.resolve({ status: "failed" });
      }
    }
    const state = new CrossStageState();
    attachSolarState("mission-solar-test", state);
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      new TextOnlyPort(),
    );
    const s2 = bindings.buildHooksForStep("s2-leader-plan") as {
      runRole(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    await s2.runRole({ ctx: ctx(state) });
    expect(state.get(CS_KEY.plan)).toMatchObject({
      themeSummary: "Text-only contract",
      dimensions: [{ name: "Runtime" }],
    });
  });

  it("recovers S3 findings from rawText JSON with unescaped newlines", async () => {
    class RawTextResearcherPort implements SolarHarnessOperatorPort {
      runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
        if (request.operatorId === "BrowserResearcher") {
          return Promise.resolve({
            status: "succeeded",
            structured: {
              rawText:
                '{"dimension":"Runtime","summary":"grounded","findings":[{"claim":"Foundry turns CUDA graph capture into reusable serving context.","evidence":"The source title contains a raw newline -> Foundry\n: Template-Based CUDA Graph Context Materialization.","source":"https://arxiv.org/abs/2604.06664","sourceTitle":"Foundry\n: Template-Based CUDA Graph Context Materialization"}]}',
            },
            markdown:
              '{"dimension":"Runtime","summary":"grounded","findings":[]}',
          });
        }
        return Promise.resolve({ status: "failed" });
      }
    }
    const state = new CrossStageState();
    state.set(CS_KEY.plan, {
      themeSummary: "Plan",
      dimensions: [{ id: "d1", name: "Runtime", rationale: "r" }],
    });
    attachSolarState("mission-solar-test", state);
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      new RawTextResearcherPort(),
    );
    const s3 = bindings.buildHooksForStep("s3-researcher-collect") as {
      fanOut(args: { ctx: StageRunArgs["ctx"] }): ReadonlyArray<unknown>;
      perItemPipeline(args: {
        item: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown>;
    };
    const [firstDimension] = s3.fanOut({ ctx: ctx(state) });

    await s3.perItemPipeline({ item: firstDimension, ctx: ctx(state) });

    expect(state.get(CS_KEY.researcherResults)).toMatchObject([
      {
        dimension: "Runtime",
        findings: [
          {
            claim: "Foundry turns CUDA graph capture into reusable serving context.",
            source: "https://arxiv.org/abs/2604.06664",
          },
        ],
      },
    ]);
  });

  it("keeps S3 serial research running after a single empty dimension result", async () => {
    const calls: string[] = [];
    class PartiallyEmptyResearcherPort implements SolarHarnessOperatorPort {
      runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
        if (request.operatorId === "BrowserResearcher") {
          const payload = request.payload as { dimension?: { name?: string } };
          const dimension = payload.dimension?.name ?? "unknown";
          calls.push(dimension);
          if (dimension === "Runtime B") {
            return Promise.resolve({
              status: "succeeded",
              structured: {
                dimension,
                summary: "empty response",
                findings: [],
              },
              markdown: "empty response",
            });
          }
          return Promise.resolve({
            status: "succeeded",
            structured: {
              dimension,
              summary: `${dimension} grounded`,
              findings: [
                {
                  claim: `${dimension} claim`,
                  evidence: `${dimension} evidence`,
                  source: "https://example.com/source",
                },
              ],
            },
          });
        }
        return Promise.resolve({ status: "failed" });
      }
    }
    const state = new CrossStageState();
    state.set(CS_KEY.plan, {
      themeSummary: "Plan",
      dimensions: [
        { id: "a", name: "Runtime A", rationale: "a" },
        { id: "b", name: "Runtime B", rationale: "b" },
        { id: "c", name: "Runtime C", rationale: "c" },
      ],
    });
    attachSolarState("mission-solar-test", state);
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      new PartiallyEmptyResearcherPort(),
    );
    const s3 = bindings.buildHooksForStep("s3-researcher-collect") as {
      fanOut(args: { ctx: StageRunArgs["ctx"] }): ReadonlyArray<unknown>;
      perItemPipeline(args: {
        item: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown>;
    };
    const [dimensionBatch] = s3.fanOut({ ctx: ctx(state) });

    await expect(
      s3.perItemPipeline({ item: dimensionBatch, ctx: ctx(state) }),
    ).resolves.toHaveLength(3);

    const results = state.get<Array<{ dimension: string; findings: unknown[] }>>(
      CS_KEY.researcherResults,
    );
    expect(calls).toEqual(["Runtime A", "Runtime B", "Runtime C"]);
    expect(results).toHaveLength(3);
    expect(results?.[1]).toMatchObject({
      dimension: "Runtime B",
      findings: [],
    });
    expect(results?.[2]?.findings).toHaveLength(1);
  });

  it("degrades S7 native outline when the retained native agent stalls", async () => {
    const previousTimeout = process.env.DEEP_INSIGHT_SOLAR_S7_OUTLINE_TIMEOUT_MS;
    process.env.DEEP_INSIGHT_SOLAR_S7_OUTLINE_TIMEOUT_MS = "20";
    const state = new CrossStageState();
    const events: unknown[] = [];
    state.set(CS_KEY.plan, {
      themeSummary: "Plan",
      dimensions: [{ id: "d1", name: "Runtime", rationale: "r" }],
    });
    attachSolarState("mission-solar-test", state);
    attachState("mission-solar-test", state);
    const neverReturningRunner = {
      run: () => new Promise(() => undefined),
    } as never;
    const bindings = new DeepInsightSolarStageBindings(
      neverReturningRunner,
      richServices(),
      new MockSolarOperatorPort(),
    );
    const s7 = bindings.buildHooksForStep("s7-writer-outline") as {
      draftOnce(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    const stageCtx = {
      ...ctx(state),
      input: {
        topic: "Agent system architecture",
        language: "zh-CN",
        invocation: {
          userId: "user-1",
          depth: "deep",
          auditLayers: ["thorough"],
          onEvent: (event: unknown) => {
            events.push(event);
          },
        },
      },
    } as StageRunArgs["ctx"];

    try {
      await expect(s7.draftOnce({ ctx: stageCtx })).resolves.toBeNull();
      expect(state.get(CS_KEY.outlinePlan)).toBeNull();
      expect(JSON.stringify(events)).toContain("降级为由 S8 强模型写作阶段直接规划章节");
    } finally {
      if (previousTimeout) {
        process.env.DEEP_INSIGHT_SOLAR_S7_OUTLINE_TIMEOUT_MS = previousTimeout;
      } else {
        delete process.env.DEEP_INSIGHT_SOLAR_S7_OUTLINE_TIMEOUT_MS;
      }
    }
  });
});

describe("deep-insight-solar Research OS primitives", () => {
  it("normalizes a TechnologyInsightPlan and blocks uncovered mandatory assets", () => {
    const plan = normalizeTechnologyInsightPlan(
      {
        centralQuestion: "Why now?",
        workstreams: [
          {
            id: "evolution",
            name: "Evolution",
            objective: "rebuild generations",
            assetTypes: ["evolutionEvent", "evidenceCard"],
          },
        ],
        mandatoryArtifacts: ["evidenceCard", "evolutionEvent", "actorCard"],
      },
      { topic: "Agent systems" },
    );
    const ledger = normalizeResearchAssetLedger(
      {
        evidenceCards: [
          {
            id: "ev-1",
            title: "paper",
            summary: "primary evidence",
            sourceUrls: ["https://example.com/paper"],
          },
        ],
        evolutionLedger: [
          {
            id: "evo-1",
            title: "old to new",
            summary: "pressure creates response",
            sourceUrls: ["https://example.com/paper"],
          },
        ],
      },
      { workstreamId: "evolution", workstreamName: "Evolution" },
    );
    const coverage = evaluateResearchCoverage(plan, ledger);

    expect(plan.schemaVersion).toBe("deep-insight-solar.research-os.v1");
    expect(ledger.assetTypeCounts.evidenceCard).toBe(1);
    expect(coverage.ok).toBe(false);
    expect(coverage.missingAssetTypes).toContain("actorCard");
    expect(coverage.repairPackets[0]?.prompt).toContain("补齐");
  });

  it("fails the insight rubric when a thesis has no evidence binding", () => {
    const ledger = normalizeResearchAssetLedger(
      {
        evidenceCards: [
          {
            id: "ev-1",
            title: "source",
            summary: "source summary",
            sourceUrls: ["https://example.com/source"],
          },
        ],
        evolutionLedger: [
          { title: "evo", summary: "evo", sourceUrls: ["https://example.com/source"] },
        ],
        architectureStackMap: [
          { title: "stack", summary: "stack", sourceUrls: ["https://example.com/source"] },
        ],
        actorGraph: [
          { title: "actor", summary: "actor", sourceUrls: ["https://example.com/source"] },
        ],
        contradictions: [
          { title: "counter", summary: "counter", sourceUrls: ["https://example.com/source"] },
        ],
      },
      { workstreamId: "core", workstreamName: "Core" },
    );
    const thesisGraph = normalizeThesisGraph(
      {
        theses: [{ id: "t1", statement: "Claim without evidence", mechanism: "N/A" }],
      },
      { topic: "Agent systems", ledger },
    );
    const rubric = evaluateInsightRubric({ ledger, thesisGraph });

    expect(rubric.ok).toBe(false);
    expect(rubric.blockers.join("\n")).toContain("无 evidence 绑定");
  });
});

describe("deep-insight-solar isolation contract", () => {
  it("keeps the native deep-insight pipeline identity untouched", () => {
    // Native recipe keeps its legacy internal id; the native runner derives and
    // registers the public capability pipeline as "deep-insight".
    expect(DEEP_INSIGHT_PIPELINE.id).toBe("playground");

    expect(DEEP_INSIGHT_SOLAR_PIPELINE.id).toBe("deep-insight-solar");
    expect(DEEP_INSIGHT_SOLAR_PIPELINE.meta?.missionType).toBe(
      "deep-insight-solar",
    );
    expect(DEEP_INSIGHT_SOLAR_PIPELINE.meta?.abBaselinePipelineId).toBe(
      "deep-insight",
    );
    expect(DEEP_INSIGHT_SOLAR_PIPELINE.meta?.solarStrongModelStages).toEqual([
      "s2-leader-plan",
      "s3-researcher-collect",
      "s6-analyst",
      "s8-writer",
      "s9-critic",
    ]);
  });

  it("does not leave retained native stages to empty auto-election", () => {
    const previous = process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID;
    delete process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID;
    try {
      expect(resolveDeepInsightSolarNativeModelId()).toBe("Qwen3.6-35b-a3b");
      expect(resolveDeepInsightSolarNativeModelId("chatgpt-native")).toBe(
        "chatgpt-native",
      );
    } finally {
      if (previous) process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID = previous;
      else delete process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID;
    }
  });

  it("allows overriding the retained native-stage model with an env guardrail", () => {
    const previous = process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID;
    process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID = "safe-native-model";
    try {
      expect(resolveDeepInsightSolarNativeModelId()).toBe("safe-native-model");
    } finally {
      if (previous) process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID = previous;
      else delete process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID;
    }
  });
});

describe("deep-insight-solar deliverable gate", () => {
  it("blocks hollow reports that only contain missing-section placeholders", () => {
    const verdict = evaluateDeepInsightSolarDeliverable({
      topic:
        "从MLSys 2026和CAIS 2026的议题看面向Agent system的计算架构演进趋势",
      description: "请产出适合在线研讨会的 12000 字深度报告。",
      lengthProfile: "deep",
      plan: {
        dimensions: [
          { name: "KV Cache 演进路线" },
          { name: "Agentic Workload 计算架构" },
        ],
      },
      researcherResults: [
        {
          dimension: "KV Cache 演进路线",
          findings: [],
          summary: "(failed: ReAct 未产出 findings)",
        },
      ],
      reportArtifact: {
        title: "空报告",
        content: { fullMarkdown: "# 空报告\n\n内容不足。" },
        sections: [
          {
            title: "KV Cache 演进路线（本维度内容缺失）",
            content: "",
          },
        ],
        citations: [],
        factTable: [],
        quickView: { executiveSummary: { markdown: "" } },
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("S3 未产出可用 findings");
    expect(verdict.reasons.join("\n")).toContain("存在缺失章节占位");
  });

  it("allows a grounded Solar report with enough findings, sections, and citations", () => {
    const longSection =
      "Agent system 的计算架构正在从单点推理扩展为面向长上下文、工具调用、检索、调度和状态管理的系统工程。".repeat(
        20,
      );
    const verdict = evaluateDeepInsightSolarDeliverable({
      topic: "Agent system architecture",
      lengthProfile: "standard",
      plan: {
        dimensions: [{ name: "Architecture" }, { name: "Runtime" }],
      },
      researcherResults: [
        {
          dimension: "Architecture",
          findings: [
            {
              claim: "Agent workloads require runtime coordination.",
              evidence: "Evidence from benchmark and system papers.",
              source: "https://example.com/source-a",
            },
          ],
          summary: "research summary",
        },
      ],
      reportArtifact: {
        title: "Solar report",
        content: { fullMarkdown: `${longSection}\n\n${longSection}` },
        sections: [
          {
            title: "Architecture",
            content: longSection,
            citationIds: ["c1"],
          },
        ],
        citations: [{ id: "c1" }],
        factTable: [{ id: "f1" }],
        quickView: {
          executiveSummary: {
            markdown:
              "这份摘要说明 Agent system 的架构演进正在进入运行时、状态和调度协同的新阶段。",
          },
        },
      },
    });

    expect(verdict).toMatchObject({ ok: true });
  });
});

describe("SubprocessSolarHarnessOperatorPort", () => {
  it("fails explicitly when the Solar bridge command is not configured", async () => {
    const previous = process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
    delete process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
    try {
      const result = await new SubprocessSolarHarnessOperatorPort().runOperator({
        missionId: "m1",
        capabilityId: "deep-insight-solar",
        pipelineId: "deep-insight-solar",
        stepId: "s2-leader-plan",
        operatorId: "BrowserLeaderPlanner",
        idempotencyKey: "k1",
        inputStateHash: "h1",
        topic: "topic",
        depth: "standard",
        language: "zh-CN",
        promptVersion: "test",
        outputSchemaVersion: "test",
        constraints: {},
        payload: {},
      });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("SOLAR_OPERATOR_CMD_MISSING");
    } finally {
      if (previous) process.env.GENESISPOD_SOLAR_OPERATOR_CMD = previous;
    }
  });

  it("can call the Solar bridge command in dry-run mode", async () => {
    const previousCmd = process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
    const previousArgs = process.env.GENESISPOD_SOLAR_OPERATOR_ARGS;
    const previousDryRun = process.env.DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN;
    const previousRunRoot = process.env.DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT;
    const bridge = resolve(
      process.cwd(),
      "../../../../../tools/deep_insight_solar_operator_bridge.py",
    );
    process.env.GENESISPOD_SOLAR_OPERATOR_CMD = "python3";
    process.env.GENESISPOD_SOLAR_OPERATOR_ARGS = JSON.stringify([bridge]);
    process.env.DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN = "1";
    process.env.DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT = mkdtempSync(
      `${tmpdir()}/deep-insight-solar-bridge-`,
    );
    try {
      const result = await new SubprocessSolarHarnessOperatorPort().runOperator({
        missionId: "m1",
        capabilityId: "deep-insight-solar",
        pipelineId: "deep-insight-solar",
        stepId: "s2-leader-plan",
        operatorId: "BrowserLeaderPlanner",
        idempotencyKey: "k1",
        inputStateHash: "h1",
        topic: "topic",
        depth: "standard",
        language: "zh-CN",
        promptVersion: "test",
        outputSchemaVersion: "test",
        constraints: {},
        payload: {},
      });
      expect(result.status).toBe("succeeded");
      expect(result.structured).toMatchObject({
        centralQuestion: expect.stringContaining("Dry-run central research question"),
        workstreams: expect.arrayContaining([
          expect.objectContaining({ id: "dry-ws-evolution" }),
        ]),
        dimensions: expect.arrayContaining([
          expect.objectContaining({ id: "dry-ws-evolution" }),
        ]),
      });
      expect((result.structured as any).workstreams).toHaveLength(4);
    } finally {
      if (previousCmd) process.env.GENESISPOD_SOLAR_OPERATOR_CMD = previousCmd;
      else delete process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
      if (previousArgs) process.env.GENESISPOD_SOLAR_OPERATOR_ARGS = previousArgs;
      else delete process.env.GENESISPOD_SOLAR_OPERATOR_ARGS;
      if (previousDryRun) process.env.DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN = previousDryRun;
      else delete process.env.DEEP_INSIGHT_SOLAR_BRIDGE_DRY_RUN;
      if (previousRunRoot) process.env.DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT = previousRunRoot;
      else delete process.env.DEEP_INSIGHT_SOLAR_BRIDGE_RUN_ROOT;
    }
  });
});
