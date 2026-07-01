import { CrossStageState, type StageRunArgs } from "@/modules/ai-harness/facade";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
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
  preferReportBodyArtifact,
  prepareDeepInsightSolarResumeState,
  resolveDeepInsightSolarNativeModelId,
} from "../deep-insight-solar.runner";
import {
  enrichResearchAssetLedgerFromLegacyFindings,
  evaluateInsightRubric,
  evaluateResearchCoverage,
  normalizeResearchAssetLedger,
  normalizeTechnologyInsightPlan,
  normalizeThesisGraph,
  publicReportLanguageBlockers,
  sanitizePublicReportMarkdown,
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
  readonly requests: SolarOperatorRequest[] = [];

  runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
    this.requests.push(request);
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
            {
              id: "bottlenecks",
              name: "Bottleneck Ledger",
              objective: "Identify hard bottlenecks that make the architecture shift investable",
              assetTypes: ["bottleneckCard", "evidenceCard"],
            },
            {
              id: "counterevidence",
              name: "Contradiction Matrix",
              objective: "Capture counter-evidence that could weaken the central thesis",
              assetTypes: ["contradiction", "evidenceCard"],
            },
            {
              id: "opportunities",
              name: "Opportunity Map",
              objective: "Map investable control points and platform wedges",
              assetTypes: ["opportunityHypothesis", "weakSignal", "evidenceCard"],
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
            "## 需求理解：本次分析要回答什么\n\n用户需要判断 Agent system 的技术控制点迁移会如何改变架构、产品和投资热点。\n\n" +
            "## 内容规划：如何展开这份洞察\n\n报告先拆解运行时瓶颈，再分析系统机制、产业机会和投资含义。\n\n" +
            "## 分步骤洞察\n\n### 步骤一：控制点迁移\n\n这份报告正文只呈现读者可读的技术判断。\n\n" +
            "Agent system 的计算架构正在从单次模型调用，变成围绕状态、工具、检索、调度和验证闭环组织起来的运行时系统。".repeat(
              80,
            ) +
            "\n\n## 综合判断与行动建议\n\n核心结论是投资热点会从模型参数竞争转向运行时、状态管理和验证闭环。",
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

  it("rejects S2 planner output with fewer than six Research OS workstreams", async () => {
    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    attachSolarState("mission-solar-test", state);
    const shortPlannerPort: SolarHarnessOperatorPort = {
      runOperator: async () => ({
        status: "succeeded",
        structured: {
          centralQuestion: "Too narrow",
          workstreams: [
            { id: "entity", name: "Entity boundary", objective: "Disambiguate entity" },
            { id: "evidence", name: "Evidence boundary", objective: "Bound sources" },
          ],
          mandatoryArtifacts: ["evidenceCard"],
        },
      }),
    };
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      shortPlannerPort,
    );
    const s2 = bindings.buildHooksForStep("s2-leader-plan") as {
      runRole(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };

    await expect(s2.runRole({ ctx: ctx(state) })).rejects.toThrow(
      /minimum is 6/,
    );
  });

  it("waits and retries flow-control cooldown instead of failing the mission stage", async () => {
    const previousRetries = process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES;
    const previousMaxWait =
      process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS;
    process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES = "2";
    process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS = "1";
    try {
      const state = new CrossStageState();
      state.set(CS_KEY.startedAt, Date.now());
      attachSolarState("mission-solar-test", state);
      const fallback = new MockSolarOperatorPort();
      let calls = 0;
      const port: SolarHarnessOperatorPort = {
        runOperator: async (request) => {
          calls += 1;
          if (calls === 1) {
            return {
              status: "failed",
              error: {
                code: "FLOW_CONTROL_COOLDOWN",
                message:
                  "FlowControlBlocked: operator deep-insight-solar-leader-planner blocked by flow control: state=cooldown until 2099-01-01T00:00:00Z",
                retryable: true,
              },
            };
          }
          return fallback.runOperator(request);
        },
      };
      const bindings = new DeepInsightSolarStageBindings(
        {} as never,
        richServices(),
        port,
      );
      const s2 = bindings.buildHooksForStep("s2-leader-plan") as {
        runRole(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
      };

      await s2.runRole({ ctx: ctx(state) });

      expect(calls).toBe(2);
      expect(state.get(SOLAR_CS_KEY.technologyInsightPlan)).toMatchObject({
        centralQuestion: "Agent system architecture control point migration",
      });
    } finally {
      if (previousRetries === undefined) {
        delete process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES;
      } else {
        process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES =
          previousRetries;
      }
      if (previousMaxWait === undefined) {
        delete process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS;
      } else {
        process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS =
          previousMaxWait;
      }
    }
  });

  it("retries nonzero-exit FlowControlBlocked even when env retry is set to one", async () => {
    const previousRetries = process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES;
    const previousMaxWait =
      process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS;
    process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES = "1";
    process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS = "1";
    try {
      const state = new CrossStageState();
      state.set(CS_KEY.startedAt, Date.now());
      attachSolarState("mission-solar-test", state);
      const fallback = new MockSolarOperatorPort();
      let calls = 0;
      const port: SolarHarnessOperatorPort = {
        runOperator: async (request) => {
          calls += 1;
          if (calls === 1) {
            return {
              status: "failed",
              error: {
                code: "SOLAR_OPERATOR_NONZERO_EXIT",
                message:
                  "chatgpt_browser_agent_task_operator failed: FlowControlBlocked: operator deep-insight-solar-leader-planner blocked by flow control: state=cooldown until 2099-01-01T00:00:00Z",
                retryable: true,
              },
            };
          }
          return fallback.runOperator(request);
        },
      };
      const bindings = new DeepInsightSolarStageBindings(
        {} as never,
        richServices(),
        port,
      );
      const s2 = bindings.buildHooksForStep("s2-leader-plan") as {
        runRole(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
      };

      await s2.runRole({ ctx: ctx(state) });

      expect(calls).toBe(2);
      expect(state.get(SOLAR_CS_KEY.technologyInsightPlan)).toMatchObject({
        centralQuestion: "Agent system architecture control point migration",
      });
    } finally {
      if (previousRetries === undefined) {
        delete process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES;
      } else {
        process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES =
          previousRetries;
      }
      if (previousMaxWait === undefined) {
        delete process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS;
      } else {
        process.env.GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS =
          previousMaxWait;
      }
    }
  });

  it("falls back to a ledger-backed ThesisGraph when BrowserAnalyst generates no output", async () => {
    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    attachSolarState("mission-solar-test", state);
    state.set(SOLAR_CS_KEY.technologyInsightPlan, {
      schemaVersion: "deep-insight-solar.research-os.v1",
      centralQuestion: "Where do Neo Labs control investable AI system layers?",
      userIntentAnalysis: {
        originalAsk: "Analyze Neo Labs",
        decisionNeed: "Separate entity facts from investable AI lab patterns.",
        audienceUse: "External investment briefing",
        successCriteria: ["evidence-backed theses"],
      },
      initialTheses: [
        "Neo Labs should be understood through AI lab control points rather than a single entity label.",
      ],
      researchQuestions: [],
      workstreams: [
        {
          id: "r1",
          name: "Entity and control point map",
          objective: "Map legal entity ambiguity to AI lab investment control points.",
          assetTypes: ["evidenceCard", "sotaFinding", "contradiction"],
        },
      ],
      mandatoryArtifacts: ["evidenceCard", "sotaFinding", "contradiction"],
      sourcePolicy: {},
      coverageRequirements: {},
      falsificationQuestions: ["A proven US legal entity would narrow the framing."],
    });
    state.set(SOLAR_CS_KEY.researchAssetLedger, {
      schemaVersion: "deep-insight-solar.research-os.v1",
      sourceCount: 3,
      assetTypeCounts: {
        evidenceCard: 1,
        evolutionEvent: 0,
        stackNode: 0,
        interfaceEdge: 0,
        actorCard: 0,
        sotaFinding: 1,
        bottleneckCard: 0,
        contradiction: 1,
        weakSignal: 0,
        opportunityHypothesis: 0,
      },
      evidenceCards: [
        {
          id: "ev-1",
          type: "evidenceCard",
          title: "Company source",
          summary: "A representative AI lab publishes a system interface.",
          evidenceIds: [],
          sourceUrls: ["https://example.com/source"],
          workstreamId: "r1",
          confidence: "verified",
        },
      ],
      assets: [
        {
          id: "ev-1",
          type: "evidenceCard",
          title: "Company source",
          summary: "A representative AI lab publishes a system interface.",
          evidenceIds: [],
          sourceUrls: ["https://example.com/source"],
          workstreamId: "r1",
          confidence: "verified",
        },
        {
          id: "sota-1",
          type: "sotaFinding",
          title: "SOTA route",
          summary: "The control point is the repeatable system interface, not the entity label.",
          evidenceIds: ["ev-1"],
          sourceUrls: ["https://example.com/source"],
          workstreamId: "r1",
          confidence: "inferred",
        },
        {
          id: "counter-1",
          type: "contradiction",
          title: "Entity ambiguity",
          summary: "A single verified US legal entity has not been established.",
          evidenceIds: ["ev-1"],
          sourceUrls: ["https://example.com/source"],
          workstreamId: "r1",
          confidence: "gap",
        },
      ],
    });
    const fallback = new MockSolarOperatorPort();
    const port: SolarHarnessOperatorPort = {
      runOperator: async (request) => {
        if (request.operatorId === "BrowserAnalyst") {
          return {
            status: "timed_out",
            error: {
              code: "SOLAR_OPERATOR_TIMEOUT",
              message:
                "BrowserAnalyst timed_out: generating_without_output after 420s",
              retryable: true,
            },
          };
        }
        return fallback.runOperator(request);
      },
    };
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      port,
    );
    const s6 = bindings.buildHooksForStep("s6-analyst") as {
      synthesize(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };

    await expect(s6.synthesize({ ctx: ctx(state) })).resolves.toBeDefined();

    expect(state.get(SOLAR_CS_KEY.thesisGraph)).toMatchObject({
      theses: expect.arrayContaining([
        expect.objectContaining({
          evidenceIds: expect.arrayContaining(["ev-1"]),
        }),
      ]),
    });
    expect(state.get(SOLAR_CS_KEY.degradedReasons)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "s6-analyst",
          reason: "browser_analyst_generating_without_output",
        }),
      ]),
    );
  });

  it("falls back to deterministic rubric when BrowserCritic returns no output", async () => {
    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    attachSolarState("mission-solar-test", state);
    state.set(SOLAR_CS_KEY.technologyInsightPlan, {
      schemaVersion: "deep-insight-solar.research-os.v1",
      centralQuestion: "Which Neo Labs control points are investable?",
      userIntentAnalysis: {
        originalAsk: "Analyze US Neo Labs technical direction and investment hotspots.",
        decisionNeed: "Prepare an external briefing with demand analysis and thesis-backed findings.",
        audienceUse: "External executive and investment audience",
        successCriteria: ["public-facing report", "evidence-backed theses"],
      },
      initialTheses: ["Investable value sits in feedback loops and system interfaces."],
      researchQuestions: ["Which control points compound?"],
      workstreams: [
        {
          id: "r1",
          name: "Feedback control points",
          objective: "Map labs to feedback-loop control points.",
          assetTypes: ["evidenceCard", "actorCard", "opportunityHypothesis"],
        },
      ],
      mandatoryArtifacts: ["evidenceCard", "actorCard", "opportunityHypothesis"],
      sourcePolicy: {},
      coverageRequirements: {},
      falsificationQuestions: ["Revenue traction may not validate research depth."],
    });
    state.set(SOLAR_CS_KEY.researchAssetLedger, {
      schemaVersion: "deep-insight-solar.research-os.v1",
      sourceCount: 4,
      assetTypeCounts: {
        evidenceCard: 1,
        evolutionEvent: 1,
        stackNode: 1,
        interfaceEdge: 1,
        actorCard: 1,
        sotaFinding: 1,
        bottleneckCard: 1,
        contradiction: 1,
        weakSignal: 1,
        opportunityHypothesis: 1,
      },
      evidenceCards: [
        {
          id: "ev-1",
          type: "evidenceCard",
          title: "Source",
          summary: "A representative lab exposes a programmable training interface.",
          evidenceIds: [],
          sourceUrls: ["https://example.com/source"],
          workstreamId: "r1",
          confidence: "verified",
        },
      ],
      assets: [],
    });
    state.set(SOLAR_CS_KEY.coverageReport, { ok: true, blockers: [], warnings: [] });
    state.set(SOLAR_CS_KEY.thesisGraph, {
      theses: [
        {
          id: "thesis-1",
          statement: "The investable control point is the feedback-loop interface.",
          mechanism: "Interfaces compound because they collect usage data and shape workflows.",
          evidenceIds: ["ev-1"],
          counterEvidenceIds: [],
          limitations: ["Public data is incomplete."],
          architectureImplications: ["Training and evaluation become a control plane."],
          opportunityImplications: ["Own the interface layer."],
        },
      ],
      claimEdges: [],
      evidenceBindings: [{ thesisId: "thesis-1", evidenceId: "ev-1" }],
      counterEvidence: [],
      openQuestions: [],
      reportOutline: [{ id: "section-1", title: "Feedback interfaces", thesisIds: ["thesis-1"] }],
    });
    const reportMarkdown =
      "# Neo Labs investment control points\n\n" +
      "This report first clarifies the user demand, then maps technical routes, capital hotspots, actor positions, bottlenecks, and opportunity signals. ".repeat(
        80,
      );
    state.set(SOLAR_CS_KEY.reportPackage, {
      schemaVersion: "deep-insight-solar.research-os.v1",
      executiveBriefMarkdown: "Brief",
      standardReportMarkdown: reportMarkdown,
      evidenceBook: { evidenceCards: [{ id: "ev-1" }] },
    });
    state.set(CS_KEY.reportArtifact, {
      title: "Neo Labs",
      content: { fullMarkdown: reportMarkdown },
      sections: [],
      citations: [],
      figures: [],
      quality: { overall: 80 },
      metadata: {},
    });
    const port: SolarHarnessOperatorPort = {
      runOperator: async (request) => {
        if (request.operatorId === "BrowserCritic") {
          return {
            status: "failed",
            error: {
              code: "SOLAR_CHATGPT_NO_OUTPUT",
              message:
                "[deep-insight-solar] BrowserCritic failed: BrowserCritic produced no usable ChatGPT generation signal_reason=submitted_without_generation initial=N/A retry=chatgpt_browser_agent_task_operator failed: RuntimeError: ChatGPT browser-agent failed rc=1: browser_agent_chatgpt_wrapper failed: RuntimeError: chatgpt_login_wall_detected",
              retryable: true,
            },
          };
        }
        return new MockSolarOperatorPort().runOperator(request);
      },
    };
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      port,
    );
    const s9 = bindings.buildHooksForStep("s9-critic") as {
      review(args: { artifact: unknown; ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };

    await expect(
      s9.review({ artifact: state.get(CS_KEY.reportArtifact), ctx: ctx(state) }),
    ).resolves.toBeDefined();

    expect(state.get(SOLAR_CS_KEY.degradedReasons)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "s9-critic",
          reason: "browser_critic_no_output",
        }),
      ]),
    );
    expect(state.get(SOLAR_CS_KEY.redTeamMemo)).toMatchObject({
      publishDecision: "approve",
    });
    expect(state.get(CS_KEY.reviewVerdict)).toMatchObject({
      reviewer: "Solar BrowserCritic",
    });
  });

  it("maps S2/S6/S8/S9 Solar operator output into compatible CrossStageState", async () => {
    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    attachSolarState("mission-solar-test", state);

    const port = new MockSolarOperatorPort();
    const bindings = new DeepInsightSolarStageBindings(
      {} as never,
      richServices(),
      port,
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
    state.append<unknown>(CS_KEY.researcherResults, {
      dimension: "Oversized raw markdown should not enter S6",
      summary: "A synthetic raw body verifies analyst input compression.",
      findings: [
        {
          claim: "The analyst only needs compact findings.",
          evidence: "Raw markdown belongs in persisted artifacts, not the ChatGPT browser prompt.",
          source: "https://example.com/raw-markdown-boundary",
        },
      ],
      fullMarkdown: "raw markdown ".repeat(20_000),
    });

    const s6 = bindings.buildHooksForStep("s6-analyst") as {
      synthesize(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    await s6.synthesize({ ctx: stageCtx });
    const analystRequest = port.requests.find(
      (request) => request.operatorId === "BrowserAnalyst",
    );
    expect(analystRequest?.payload).toMatchObject({
      analystInputPacket: {
        budget: expect.objectContaining({
          compressed: true,
          originalPayloadChars: expect.any(Number),
          packetChars: expect.any(Number),
        }),
      },
    });
    const analystPayloadJson = JSON.stringify(analystRequest?.payload);
    const analystPacket = (analystRequest?.payload as {
      analystInputPacket?: { researcherDigests?: Array<Record<string, unknown>> };
    })?.analystInputPacket;
    expect(analystPayloadJson).not.toContain("raw markdown raw markdown");
    expect(
      analystPacket?.researcherDigests?.some((digest) =>
        Object.prototype.hasOwnProperty.call(digest, "fullMarkdown"),
      ),
    ).toBe(false);
    expect(
      analystPayloadJson.length,
    ).toBeLessThan(250_000);
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
      standardReportMarkdown: expect.stringContaining("控制点迁移"),
    });
    expect(state.get(CS_KEY.reportArtifact)).toMatchObject({
      content: { fullMarkdown: expect.stringContaining("Agent system architecture") },
      metadata: {
        researchOsSchemaVersion: "deep-insight-solar.research-os.v1",
      },
    });
    expect(state.get(CS_KEY.reportArtifact)).toMatchObject({
      content: {
        fullMarkdown: expect.stringContaining("## 图表与材料视图"),
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

  it("keeps Research OS ids out of public S8 report sections", async () => {
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

    expect(JSON.stringify(port.lastWriterPayload)).toContain("writerBrief");
    expect(JSON.stringify(port.lastWriterPayload)).not.toContain("thesisGraph");
    expect(report.sections?.[0]?.heading).toBe("Agent runtime synthetic chapter");
    expect(JSON.stringify(report.sections)).not.toContain("研究资产到论点映射");
    expect(JSON.stringify(report.sections)).not.toContain("thesis-1");
    expect(JSON.stringify(report.sections)).not.toContain("ev-runtime");
  });

  it("strips collapsed internal evidence mapping tables from public report markdown", () => {
    const markdown = [
      "## 投资判断",
      "",
      "Neo Labs 的技术方向需要从控制点迁移理解。",
      "",
      "## 核心判断与证据关系",
      "",
      "|---|---|---|---| | 相关材料：Neo Labs 应规范化为美国 AI neo-labs 谱系 | 相关材料、相关材料、相关材料、相关材料 | 同名实体排除、范畴归一、实体辨析 | counter-1、counter-2：精确同名实体不是美国 research-first AI lab |",
      "| thesis-1 | ev-1 | asset-25 | evidenceIds |",
      "",
      "## 技术路线",
      "",
      "公开正文应该保留这一段，而不是保留内部证据绑定表。",
    ].join("\n");

    const clean = sanitizePublicReportMarkdown(markdown);

    expect(clean).toContain("## 投资判断");
    expect(clean).toContain("## 技术路线");
    expect(clean).toContain("公开正文应该保留这一段");
    expect(clean).not.toContain("相关材料、相关材料");
    expect(clean).not.toContain("counter-1");
    expect(clean).not.toContain("thesis-1");
    expect(clean).not.toContain("asset-25");
    expect(clean).not.toContain("evidenceIds");
    expect(clean).not.toContain("核心判断与证据关系");
  });

  it("rewrites self-referential analyst-process wording into external briefing language", () => {
    const markdown = [
      "# 深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      "",
      "“美国 Neo Labs”目前不应被写成一个已核验的单一 AI 公司画像。更稳妥、也更有技术分析价值的读法，是把它视为美国研究优先型 AI Lab 生态的一种市场叙事入口。",
      "",
      "这个判断会改变全文的分析单位。若把 Neo Labs 当作一家公司来写，问题会变成它融资多少、发布了什么产品、拥有多少员工、是否与某些客户合作；但现有公开材料不足以支撑这些确定性陈述。",
      "",
      "若把它处理为研究优先型 AI Lab 生态的代称，真正需要比较的对象就变成：谁拥有数据权限，谁拥有任务环境，谁能生成可回放反馈。",
      "",
      "本报告将先做实体门控，然后再进入投资热点分析。",
      "",
      "## 技术控制点",
      "",
      "真正可防御的资产通常隐藏在系统接口层：代码执行沙箱、浏览器行动环境、训练反馈、实验自动化和推理调度。",
    ].join("\n");

    const clean = sanitizePublicReportMarkdown(markdown);

    expect(clean).toContain("## 技术控制点");
    expect(clean).toContain("真正可防御的资产通常隐藏在系统接口层");
    expect(clean).toContain("技术控制点、产业分工和资本定价逻辑");
    expect(clean).toContain("公开材料仍不足，相关结论需要保持审慎");
    expect(clean).not.toContain("不应被写成");
    expect(clean).not.toContain("若把 Neo Labs 当作一家公司来写");
    expect(clean).not.toContain("本报告将");
    expect(clean).not.toContain("实体门控");
    expect(clean).not.toContain("规范化为");
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
              centralQuestion: "How does the architecture shift create investable control points?",
              themeSummary: "Text-only contract",
              workstreams: [
                { id: "runtime", name: "Runtime", objective: "runtime shift" },
                { id: "evolution", name: "Evolution", objective: "technical lineage" },
                { id: "stack", name: "Stack map", objective: "architecture layers" },
                { id: "actors", name: "Actor graph", objective: "ecosystem actors" },
                { id: "bottlenecks", name: "Bottlenecks", objective: "hard constraints" },
                { id: "opportunities", name: "Opportunities", objective: "investment wedges" },
              ],
              mandatoryArtifacts: ["evidenceCard", "evolutionEvent", "stackNode"],
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
    const plan = state.get<{ dimensions: Array<{ name: string }> }>(CS_KEY.plan);
    expect(plan?.dimensions).toHaveLength(6);
    expect(plan?.dimensions[0]).toMatchObject({ name: "Runtime" });
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

  it("retries transient S3 researcher operator failures before recording the workstream", async () => {
    let calls = 0;
    class TransientResearcherPort implements SolarHarnessOperatorPort {
      runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
        if (request.operatorId !== "BrowserResearcher") {
          return Promise.resolve({ status: "failed" });
        }
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            status: "failed",
            error: {
              code: "SOLAR_API_PROVIDER_FAILED",
              message: "deepseek_api_empty_content",
              retryable: true,
            },
          });
        }
        return Promise.resolve({
          status: "succeeded",
          structured: {
            dimension: "Runtime",
            summary: "runtime grounded",
            findings: [
              {
                claim: "Runtime claim",
                evidence: "Runtime evidence",
                source: "https://example.com/runtime",
              },
            ],
          },
        });
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
      new TransientResearcherPort(),
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
    ).resolves.toHaveLength(1);

    expect(calls).toBe(2);
    expect(state.get(CS_KEY.researcherResults)).toMatchObject([
      {
        dimension: "Runtime",
        findings: [
          {
            claim: "Runtime claim",
            source: "https://example.com/runtime",
          },
        ],
      },
    ]);
  });

  it("fails S3 closed when researcher operator failures persist", async () => {
    class FailingResearcherPort implements SolarHarnessOperatorPort {
      runOperator(request: SolarOperatorRequest): Promise<SolarOperatorResult> {
        if (request.operatorId !== "BrowserResearcher") {
          return Promise.resolve({ status: "failed" });
        }
        return Promise.resolve({
          status: "failed",
          error: {
            code: "SOLAR_API_PROVIDER_FAILED",
            message: "deepseek_api_empty_content",
            retryable: true,
          },
        });
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
      new FailingResearcherPort(),
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
    ).rejects.toThrow("BrowserResearcher failed for Runtime");

    expect(state.get(CS_KEY.researcherResults)).toBeUndefined();
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

  it("normalizes Research OS asset type aliases emitted by browser/deepseek operators", () => {
    const ledger = normalizeResearchAssetLedger(
      {
        assets: [
          {
            type: "canonical_entity_card",
            title: "Sakana Fugu",
            summary: "Canonical entity: Sakana AI Fugu technical report and model family.",
            primarySourceUrl: "https://github.com/SakanaAI/Fugu-tech-report",
            confidence: "verified",
          },
          {
            type: "primary_source_claim",
            title: "Fugu technical report is the primary model source",
            summary: "The technical report is the primary source for Fugu model claims.",
            sourceUrl: "https://github.com/SakanaAI/Fugu-tech-report",
            confidence: "verified",
          },
          {
            type: "diagram_brief_seed",
            title: "Fugu x OpenRouter architecture map",
            summary: "Show the relation between model generation, routing layer, and application risk.",
            confidence: "inferred",
          },
        ],
      },
      { workstreamId: "entity", workstreamName: "Entity and source contract" },
    );

    expect(ledger.assetTypeCounts.canonicalEntityCard).toBe(1);
    expect(ledger.assetTypeCounts.primarySourceClaim).toBe(1);
    expect(ledger.assetTypeCounts.diagramBriefSeed).toBe(1);
    expect(ledger.sourceCount).toBe(1);
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

  it("blocks reader-facing reports that skip demand-plan-stepwise-synthesis structure", () => {
    const rubric = evaluateInsightRubric({
      reportPackage: {
        schemaVersion: "deep-insight-solar.research-os.v1",
        executiveBriefMarkdown: "这是一份摘要。",
        standardReportMarkdown:
          "## 技术方向\n\nNeo Labs 的技术方向包括推理基础设施、训练系统和智能体工具链。".repeat(
            80,
          ),
        evidenceBook: { evidenceCards: [], assets: [], sourceCount: 0 },
      },
    });

    expect(rubric.ok).toBe(false);
    expect(rubric.blockers).toContain(
      "报告缺少外部汇报结构：需求理解、内容规划、分步骤洞察、综合判断/行动建议必须同时可见",
    );
  });

  it("blocks self-referential process language even when the report has the required structure", () => {
    const processLikeMarkdown = [
      "## 需求理解：本次分析要回答什么",
      "本报告将先做实体门控，不能把 Neo Labs 写成已经核验的单一公司。",
      "",
      "## 内容规划：如何展开这份洞察",
      "下面需要验证每一类样本是否能进入分析范围，然后再输出投资热点。",
      "",
      "## 分步骤洞察",
      "### 第一步：实体处理",
      "这一步不应该说成公司画像，而是要先确认命名空间。",
      "",
      "## 综合判断与行动建议",
      "读者最终需要继续检查这些结论是否成立。",
    ].join("\n");

    const blockers = publicReportLanguageBlockers(processLikeMarkdown);
    const rubric = evaluateInsightRubric({
      reportPackage: {
        schemaVersion: "deep-insight-solar.research-os.v1",
        executiveBriefMarkdown: "这是一份摘要。",
        standardReportMarkdown: processLikeMarkdown.repeat(80),
        evidenceBook: { evidenceCards: [], assets: [], sourceCount: 0 },
      },
    });

    expect(blockers).toEqual(
      expect.arrayContaining([
        "自指式写作框架",
        "指令式否定表达",
        "内部验证口吻",
        "门控/闸门术语",
      ]),
    );
    expect(rubric.ok).toBe(false);
    expect(rubric.blockers.join("\n")).toContain("报告仍包含内部过程/自言自语表达");
  });

  it("allows polished external briefing language with uncertainty expressed as reader-facing risk", () => {
    const polishedMarkdown = [
      "## 需求理解：本次分析要回答什么",
      "用户真正关心的是美国研究优先型 AI lab 生态中，哪些技术方向正在形成可投资的控制点，以及这些方向如何转化为 6 到 18 个月内可观察的产业信号。",
      "",
      "## 内容规划：如何展开这份洞察",
      "分析从研究对象界定开始，随后进入技术路线、反馈闭环、资本定价、公司样本和投资热点五个镜头；每个镜头都回答一个问题：它改变了什么判断，以及投资人该观察什么。",
      "",
      "## 分步骤洞察",
      "### 第一步：研究对象从单点公司转向实验室谱系",
      "公开证据仍然有限，因此更稳妥的切入点是把 Neo Labs 放入美国 research-first AI lab 生态中比较。这个处理方式不是回避问题，而是避免把命名噪声误判为公司事实。",
      "### 第二步：投资热点来自反馈闭环控制点",
      "真正形成溢价的不是模型口号，而是数据回流、实验吞吐、评测迁移和客户任务闭环。谁能把这些环节做成可复用系统，谁就更接近可防御的商业位置。",
      "",
      "## 综合判断与行动建议",
      "结论是：优先跟踪能把研究优势沉淀为部署接口、专有数据和评测纪律的团队；对只停留在融资叙事或人才标签的样本保持折价。",
    ].join("\n");

    expect(publicReportLanguageBlockers(polishedMarkdown)).toEqual([]);
  });

  it("sanitizes repeated reviewer-style negation from generated public reports", () => {
    const rawMarkdown = [
      "## 需求理解：本次分析要回答什么",
      "Neo Labs 目前不宜被直接写成边界清晰、商业验证充分的美国 AI 平台公司。更稳妥的研究对象，是美国研究优先型 AI 实验室样本。",
      "读者应获得三个判断：区块链生态不能自动证明 AI 组织拥有同等分发能力；投资热点不应按模型、应用、基础设施三类粗分。",
      "",
      "## 内容规划：如何展开这份洞察",
      "不能把融资、团队、客户、生产部署和企业 SLA 写成已确认事实。组织和资本维度也重要，但不能越过公开可确认事实。如果没有稳定公开信息，更适合理解为强项。",
      "",
      "## 分步骤洞察",
      "### 第一步：主体边界",
      "推理方向要看 NeoInfer 是否给出同硬件、同负载、同延迟 SLO 下的 TCO 对比，这些信息仍需要验证。",
      "",
      "## 综合判断与行动建议",
      "技术团队不应把 Fugu 与 Fusion 作为互斥选项。",
      "不宜过早承诺生产部署，除非对方提供完整可复现实验。",
      "资本信息不能支撑完整融资故事。人才网络目前同样不宜写成优势，因为相关维度缺少可验证资料。",
      "具身智能必须接受更长验证周期，因为真实环境成功率、单位经济性和运维复杂度更难收敛。",
    ].join("\n");

    const clean = sanitizePublicReportMarkdown(rawMarkdown);

    expect(clean).not.toContain("不宜被直接写成");
    expect(clean).not.toContain("不能自动证明");
    expect(clean).not.toContain("不应按");
    expect(clean).not.toContain("不应把");
    expect(clean).not.toContain("不能把融资");
    expect(clean).not.toContain("不能越过公开可确认事实");
    expect(clean).not.toContain("更适合理解为强项");
    expect(clean).not.toContain("需要验证");
    expect(clean).not.toContain("不能支撑");
    expect(clean).not.toContain("不宜写成");
    expect(clean).not.toContain("必须接受更长验证周期");
    expect(publicReportLanguageBlockers(clean)).toEqual([]);
  });

  it("normalizes v3 observation/sourceNote researcher output into Research OS assets", () => {
    const ledger = normalizeResearchAssetLedger(
      {
        sourceNotes: [
          {
            key: "s1",
            sourceTitle: "Primary source",
            url: "https://example.com/source",
            relevantFact: "A documented technical route and limitation.",
          },
        ],
        observations: [
          {
            claim: "技术路线正在从单点模型转向运行时控制面和投资热点。",
            mechanism:
              "架构栈、算力、接口、公司生态和资本结构共同决定路线分化。",
            counterpointOrLimit:
              "公开证据仍缺少完整 benchmark，融资叙事不能替代技术验证。",
            supportingSourceKeys: ["s1"],
          },
        ],
      },
      {
        workstreamId: "route",
        workstreamName: "技术路线分簇与竞争谱系",
        assetTypes: [
          "evolutionEvent",
          "stackNode",
          "actorCard",
          "contradiction",
          "weakSignal",
          "opportunityHypothesis",
        ],
      },
    );

    expect(ledger.assetTypeCounts.evidenceCard).toBe(1);
    expect(ledger.assetTypeCounts.evolutionEvent).toBeGreaterThan(0);
    expect(ledger.assetTypeCounts.stackNode).toBeGreaterThan(0);
    expect(ledger.assetTypeCounts.actorCard).toBeGreaterThan(0);
    expect(ledger.assetTypeCounts.contradiction).toBeGreaterThan(0);
    expect(ledger.assetTypeCounts.weakSignal).toBeGreaterThan(0);
    expect(ledger.assetTypeCounts.opportunityHypothesis).toBeGreaterThan(0);
  });

  it("backfills Research OS gate assets from legacy researcher findings for old checkpoints", () => {
    const ledger = normalizeResearchAssetLedger(
      {
        sourceNotes: [
          {
            sourceTitle: "Primary source",
            url: "https://example.com/source",
            relevantFact: "A documented fact.",
          },
        ],
      },
      { workstreamName: "技术路线分簇" },
    );
    const enriched = enrichResearchAssetLedgerFromLegacyFindings(ledger, [
      {
        dimension: "技术路线分簇与竞争谱系",
        findings: [
          {
            claim: "路线和生态正在分化。",
            evidence: "Source-backed finding.",
            source: "https://example.com/source",
          },
        ],
      },
      {
        dimension: "反例、弱信号与失败模式",
        findings: [
          {
            claim: "融资叙事存在验证风险。",
            evidence: "Counter-evidence from source.",
            source: "https://example.com/risk",
          },
        ],
      },
      {
        dimension: "融资结构与投资主题",
        findings: [
          {
            claim: "资本热点围绕平台机会。",
            evidence: "Investment evidence.",
            source: "https://example.com/capital",
          },
        ],
      },
    ]);

    expect(enriched.assetTypeCounts.evolutionEvent).toBeGreaterThan(0);
    expect(enriched.assetTypeCounts.stackNode).toBeGreaterThan(0);
    expect(enriched.assetTypeCounts.actorCard).toBeGreaterThan(0);
    expect(enriched.assetTypeCounts.contradiction).toBeGreaterThan(0);
    expect(enriched.assetTypeCounts.weakSignal).toBeGreaterThan(0);
    expect(enriched.assetTypeCounts.opportunityHypothesis).toBeGreaterThan(0);
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
      expect(resolveDeepInsightSolarNativeModelId()).toBe("deepseek-v4-pro");
      expect(resolveDeepInsightSolarNativeModelId("Qwen3.6-35b-a3b")).toBe(
        "deepseek-v4-pro",
      );
      expect(resolveDeepInsightSolarNativeModelId("deepseek-v4-flash")).toBe(
        "deepseek-v4-pro",
      );
      expect(resolveDeepInsightSolarNativeModelId("deepseek-v4-pro")).toBe(
        "deepseek-v4-pro",
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

  it("allows Research OS assets to satisfy delivery when legacy dimension findings are sparse but all workstreams are covered", () => {
    const body =
      "美国 AI neo-labs 的投资判断必须从实体辨析、技术控制点、反馈闭环、商业牵引和反证压力测试同时展开。".repeat(
        80,
      );
    const dimensions = Array.from({ length: 7 }, (_, index) => ({
      name: `workstream-${index + 1}`,
    }));
    const assets = dimensions.map((dimension, index) => ({
      id: `asset-${index + 1}`,
      type: "evidenceCard",
      title: dimension.name,
      summary: "asset summary",
      evidenceIds: [`ev-${index + 1}`],
      sourceUrls: [`https://example.com/${index + 1}`],
      workstreamId: `ws-${index + 1}`,
    }));
    const verdict = evaluateDeepInsightSolarDeliverable({
      topic: "深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      lengthProfile: "standard",
      plan: { dimensions },
      researcherResults: [
        {
          dimension: "workstream-1",
          findings: [
            {
              claim: "claim",
              evidence: "evidence",
              source: "https://example.com/source-a",
            },
          ],
        },
      ],
      researchAssetLedger: {
        assets,
        evidenceCards: assets,
        assetTypeCounts: { evidenceCard: assets.length },
        sourceCount: assets.length,
      },
      coverageReport: { ok: true, blockers: [] },
      thesisGraph: {
        theses: [
          {
            id: "thesis-1",
            statement: "Neo-labs are organized around feedback-loop control points.",
            evidenceIds: ["ev-1"],
          },
        ],
      },
      reportPackage: {
        standardReportMarkdown: body,
      },
      reportArtifact: {
        title: "Solar report",
        content: { fullMarkdown: "# skeleton" },
        sections: [{ title: "主报告", content: body }],
        citations: [],
        factTable: [],
        quickView: {
          executiveSummary: {
            markdown:
              "这份摘要说明美国 AI neo-labs 的技术方向和投资热点谱系需要用资产账本和论点图共同判断。",
          },
        },
      },
    });

    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.metrics.successfulResearchDimensions).toBe(7);
    expect(verdict.metrics.fullMarkdownChars).toBeGreaterThan(1200);
    expect(verdict.metrics.citationCount).toBeGreaterThan(0);
  });

  it("recovers final report artifact from state reportPackage before S11 persistence", () => {
    const body =
      "美国 AI neo-labs 的最终报告正文必须优先使用 S8 ReportPackage 的标准长文，而不是 assembler 生成的标题空壳。".repeat(
        90,
      );
    const recovered = preferReportBodyArtifact(
      {
        title: "Solar report",
        content: {
          fullMarkdown:
            "## 前言\n\n## 目录\n\n证据锚点：本节可回溯来源 [1]。\n\n## 参考文献",
        },
        sections: [{ title: "前言", content: "证据锚点：本节可回溯来源 [1]。" }],
        metadata: { source: "assembler" },
      },
      {
        title: "Solar report",
        summary: "短摘要不应覆盖长正文。",
        sections: [],
      },
      {
        schemaVersion: "deep-insight-solar.research-os.v1",
        standardReportMarkdown: body,
      },
    ) as {
      content?: { fullMarkdown?: string };
      metadata?: {
        reportPackage?: { standardReportMarkdown?: string };
        solarReportBodyRecovered?: boolean;
        previousFullMarkdownChars?: number;
        recoveredFullMarkdownChars?: number;
      };
    };

    expect(recovered.content?.fullMarkdown).toBe(body);
    expect(recovered.metadata?.reportPackage?.standardReportMarkdown).toBe(body);
    expect(recovered.metadata?.solarReportBodyRecovered).toBe(true);
    expect(recovered.metadata?.previousFullMarkdownChars).toBeLessThan(200);
    expect(recovered.metadata?.recoveredFullMarkdownChars).toBe(body.length);
  });

  it("re-sanitizes stale checkpoint reportPackage before recovering final artifact", () => {
    const dirtyBody = [
      "## 需求理解：本次分析要回答什么",
      "Neo Labs 目前不宜被直接写成边界清晰、商业验证充分的美国 AI 平台公司。更稳妥的研究对象，是美国研究优先型 AI 实验室样本。",
      "",
      "## 内容规划：如何展开这份洞察",
      "不能把融资、团队、客户、生产部署和企业 SLA 写成已确认事实。组织和资本维度也重要，但不能越过公开可确认事实。如果没有稳定公开信息，更适合理解为强项。",
      "",
      "## 分步骤洞察",
      "推理方向要看 NeoInfer 是否给出同硬件、同负载、同延迟 SLO 下的 TCO 对比，这些信息仍需要验证。",
      "",
      "## 综合判断与行动建议",
      "不宜过早承诺生产部署，除非对方提供完整可复现实验。",
    ].join("\n");
    const dirtyArtifact = {
      title: "Solar report",
      content: { fullMarkdown: dirtyBody.repeat(4) },
      sections: [],
      metadata: {
        reportPackage: {
          schemaVersion: "deep-insight-solar.research-os.v1",
          executiveBriefMarkdown: "Neo Labs 目前不宜被直接写成成熟平台公司。",
          standardReportMarkdown: dirtyBody.repeat(4),
        },
      },
    };

    const recovered = preferReportBodyArtifact(dirtyArtifact, {}, dirtyArtifact.metadata.reportPackage) as {
      content?: { fullMarkdown?: string };
      metadata?: { reportPackage?: { standardReportMarkdown?: string } };
    };

    const recoveredMarkdown = recovered.content?.fullMarkdown ?? "";
    expect(recoveredMarkdown).not.toContain("不宜被直接写成");
    expect(recoveredMarkdown).not.toContain("不能把融资");
    expect(recoveredMarkdown).not.toContain("不能越过公开可确认事实");
    expect(recoveredMarkdown).not.toContain("更适合理解为强项");
    expect(recoveredMarkdown).not.toContain("需要验证");
    expect(publicReportLanguageBlockers(recoveredMarkdown)).toEqual([]);
    expect(publicReportLanguageBlockers(recovered.metadata?.reportPackage?.standardReportMarkdown ?? "")).toEqual([]);
  });

  it("counts recovered markdown headings when persisted sections are too coarse", () => {
    const dimensions = Array.from({ length: 8 }, (_, index) => ({
      name: `workstream-${index + 1}`,
    }));
    const assets = dimensions.map((dimension, index) => ({
      id: `asset-${index + 1}`,
      type: "evidenceCard",
      title: dimension.name,
      summary: "asset summary",
      evidenceIds: [`ev-${index + 1}`],
      sourceUrls: [`https://example.com/${index + 1}`],
      workstreamId: `ws-${index + 1}`,
    }));
    const sectionBody =
      "这一节给出面向外部汇报的分析正文，围绕用户需求、技术方向、投资热点、竞争格局、机会判断和风险约束展开。".repeat(
        18,
      );
    const markdown = [
      "# 深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      "",
      "## 摘要",
      "这是一份面向外部汇报的摘要，正文结构由 S8 长文生成。",
      ...Array.from({ length: 7 }, (_, index) => [
        "",
        `### ${index + 1}. 分析章节 ${index + 1}`,
        sectionBody,
      ]).flat(),
      "",
      "## 参考文献",
      "[1] https://example.com/source-a",
    ].join("\n");

    const verdict = evaluateDeepInsightSolarDeliverable({
      topic: "深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      lengthProfile: "deep",
      plan: { dimensions },
      researcherResults: dimensions.map((dimension, index) => ({
        dimension: dimension.name,
        findings: [
          {
            claim: `claim-${index + 1}`,
            evidence: "evidence",
            source: `https://example.com/${index + 1}`,
          },
        ],
        summary: "research summary",
      })),
      researchAssetLedger: {
        assets,
        evidenceCards: assets,
        assetTypeCounts: { evidenceCard: assets.length },
        sourceCount: assets.length,
      },
      coverageReport: { ok: true, blockers: [] },
      thesisGraph: {
        theses: assets.map((asset) => ({
          id: `thesis-${asset.id}`,
          statement: `thesis for ${asset.title}`,
          evidenceIds: [asset.id],
        })),
      },
      reportPackage: { standardReportMarkdown: markdown },
      reportArtifact: {
        title: "Solar report",
        content: { fullMarkdown: markdown },
        sections: dimensions.slice(0, 4).map((dimension) => ({
          title: dimension.name,
          content: sectionBody,
        })),
        citations: assets.map((asset) => ({ id: asset.id })),
        factTable: assets.map((asset) => ({ id: asset.id })),
        quickView: {
          executiveSummary: {
            markdown:
              "这份摘要说明美国 AI neo-labs 的技术方向与投资热点谱系需要按用户需求、内容规划、分步骤洞察和最终汇报来组织。",
          },
        },
      },
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.reasons.join("\n")).not.toContain("有效章节不足");
    expect(verdict.metrics.sectionCount).toBeGreaterThanOrEqual(6);
    expect(verdict.metrics.validSectionCount).toBeGreaterThanOrEqual(6);
    expect(verdict.metrics.fullMarkdownChars).toBeGreaterThanOrEqual(6000);
  });

  it("does not let a stale S9 hollow-artifact review reject the recovered long report", () => {
    const body =
      "美国 AI neo-labs 的投资热点要从反馈环境、训练控制面、世界模型、机器人策略和科学实验闭环这些控制点判断。".repeat(
        150,
      );
    const dimensions = Array.from({ length: 6 }, (_, index) => ({
      name: `workstream-${index + 1}`,
    }));
    const assets = dimensions.map((dimension, index) => ({
      id: `asset-${index + 1}`,
      type: "evidenceCard",
      title: dimension.name,
      summary: "asset summary",
      sourceUrls: [`https://example.com/${index + 1}`],
      workstreamId: `ws-${index + 1}`,
    }));
    const verdict = evaluateDeepInsightSolarDeliverable({
      topic: "深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      lengthProfile: "deep",
      plan: { dimensions },
      researcherResults: dimensions.map((dimension, index) => ({
        dimension: dimension.name,
        findings: [
          {
            claim: `claim-${index + 1}`,
            evidence: "evidence",
            source: `https://example.com/${index + 1}`,
          },
        ],
        summary: "research summary",
      })),
      researchAssetLedger: {
        assets,
        evidenceCards: assets,
        assetTypeCounts: { evidenceCard: assets.length },
        sourceCount: assets.length,
      },
      coverageReport: { ok: true, blockers: [] },
      thesisGraph: {
        theses: [
          {
            id: "thesis-1",
            statement: "Neo-labs are priced as control-point options.",
            evidenceIds: ["asset-1"],
          },
        ],
      },
      reportPackage: { standardReportMarkdown: body },
      reportArtifact: {
        title: "Solar report",
        content: { fullMarkdown: body },
        sections: dimensions.map((dimension) => ({
          title: dimension.name,
          content: body.slice(0, 900),
        })),
        citations: assets.map((asset) => ({ id: asset.id })),
        factTable: assets.map((asset) => ({ id: asset.id })),
        quickView: {
          executiveSummary: {
            markdown:
              "这份摘要说明美国 AI neo-labs 的技术路线和投资热点需要从研究资产与论证结构共同判断。",
          },
        },
        metadata: {
          solarReportBodyRecovered: true,
          previousFullMarkdownChars: 811,
          recoveredFullMarkdownChars: body.length,
        },
      },
      reviewVerdict: {
        verdict: "reject",
        notes: [
          "所有章节正文均为占位符“内容”，无任何实质性分析、数据或引用，证据密度为零。",
          "报告有效字数不足100字，长度严重不足，不符合深度分析要求。",
        ],
      },
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.reasons.join("\n")).not.toContain("S9 critic 要求拒稿");
    expect(verdict.metrics.fullMarkdownChars).toBeGreaterThanOrEqual(6000);
  });

  it("does not let a stale S9 review reject when reportPackage recovered a short artifact body", () => {
    const body =
      "美国 AI neo-labs 的技术路线需要从研究控制点、反馈环境、资本结构、商业接口和反证条件一起评估。".repeat(
        140,
      );
    const dimensions = Array.from({ length: 6 }, (_, index) => ({
      name: `workstream-${index + 1}`,
    }));
    const assets = dimensions.map((dimension, index) => ({
      id: `asset-${index + 1}`,
      type: "evidenceCard",
      title: dimension.name,
      summary: "asset summary",
      evidenceIds: [`ev-${index + 1}`],
      sourceUrls: [`https://example.com/${index + 1}`],
      workstreamId: `ws-${index + 1}`,
    }));
    const verdict = evaluateDeepInsightSolarDeliverable({
      topic: "深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      lengthProfile: "extended",
      plan: { dimensions },
      researcherResults: dimensions.map((dimension, index) => ({
        dimension: dimension.name,
        findings: [
          {
            claim: "claim",
            evidence: "evidence",
            source: `https://example.com/${index + 1}`,
          },
        ],
        summary: "research summary",
      })),
      researchAssetLedger: {
        assets,
        evidenceCards: assets,
      },
      coverageReport: { blockers: [] },
      thesisGraph: {
        theses: assets.map((asset) => ({
          id: `thesis-${asset.id}`,
          evidenceIds: [asset.id],
        })),
      },
      reportPackage: { standardReportMarkdown: body },
      reportArtifact: {
        title: "Solar report",
        content: { fullMarkdown: "内容".repeat(300) },
        sections: dimensions.map((dimension) => ({
          title: dimension.name,
          content: body.slice(0, 900),
        })),
        citations: assets.map((asset) => ({ id: asset.id })),
        factTable: assets.map((asset) => ({ id: asset.id })),
        quickView: {
          executiveSummary: {
            markdown:
              "这份摘要说明美国 AI neo-labs 的技术路线和投资热点需要从研究资产与论证结构共同判断。",
          },
        },
      },
      reviewVerdict: {
        verdict: "reject",
        details: {
          notes: [
            "所有章节正文均为占位符“内容”，无任何实质性分析、数据或引用，证据密度为零。",
          ],
        },
      },
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.reasons.join("\n")).not.toContain("S9 critic 要求拒稿");
    expect(verdict.metrics.fullMarkdownChars).toBeGreaterThanOrEqual(6000);
  });

  it("blocks Research OS delivery when any planned workstream lacks asset coverage", () => {
    const body =
      "美国 AI neo-labs 的投资判断必须从实体辨析、技术控制点、反馈闭环、商业牵引和反证压力测试同时展开。".repeat(
        80,
      );
    const dimensions = Array.from({ length: 7 }, (_, index) => ({
      name: `workstream-${index + 1}`,
    }));
    const assets = dimensions.slice(0, 4).map((dimension, index) => ({
      id: `asset-${index + 1}`,
      type: "evidenceCard",
      title: dimension.name,
      summary: "asset summary",
      evidenceIds: [`ev-${index + 1}`],
      sourceUrls: [`https://example.com/${index + 1}`],
      workstreamId: `ws-${index + 1}`,
    }));
    const verdict = evaluateDeepInsightSolarDeliverable({
      topic: "深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      lengthProfile: "standard",
      plan: { dimensions },
      researcherResults: dimensions.map((dimension, index) => ({
        dimension: dimension.name,
        findings:
          index < 4
            ? [
                {
                  claim: "claim",
                  evidence: "evidence",
                  source: `https://example.com/${index + 1}`,
                },
              ]
            : [],
        summary: index < 4 ? "research summary" : "Solar BrowserResearcher failed",
      })),
      researchAssetLedger: {
        assets,
        evidenceCards: assets,
        assetTypeCounts: { evidenceCard: assets.length },
        sourceCount: assets.length,
      },
      coverageReport: { ok: true, blockers: [] },
      thesisGraph: {
        theses: [
          {
            id: "thesis-1",
            statement: "Neo-labs are organized around feedback-loop control points.",
            evidenceIds: ["ev-1"],
          },
        ],
      },
      reportPackage: {
        standardReportMarkdown: body,
      },
      reportArtifact: {
        title: "Solar report",
        content: { fullMarkdown: body },
        sections: [{ title: "主报告", content: body }],
        citations: [{ id: "c1" }],
        factTable: [{ id: "f1" }],
        quickView: {
          executiveSummary: {
            markdown:
              "这份摘要说明美国 AI neo-labs 的技术方向和投资热点谱系需要用资产账本和论点图共同判断。",
          },
        },
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("Research OS workstream 资产覆盖不足");
    expect(verdict.reasons.join("\n")).toContain("S3 存在失败调研流");
  });

  it("blocks delivery when BrowserCritic asks for a rewrite", () => {
    const body =
      "美国 AI neo-labs 的投资判断必须从实体辨析、技术控制点、反馈闭环、商业牵引和反证压力测试同时展开。".repeat(
        80,
      );
    const verdict = evaluateDeepInsightSolarDeliverable({
      topic: "深入分析美国 Neo Labs 的主要技术方向与投资热点谱系",
      lengthProfile: "standard",
      plan: { dimensions: [{ name: "技术路线分簇" }] },
      researcherResults: [
        {
          dimension: "技术路线分簇",
          findings: [
            {
              claim: "claim",
              evidence: "evidence",
              source: "https://example.com/source-a",
            },
          ],
          summary: "research summary",
        },
      ],
      reportArtifact: {
        title: "Solar report",
        content: { fullMarkdown: body },
        sections: [{ title: "主报告", content: body }],
        citations: [{ id: "c1" }],
        factTable: [{ id: "f1" }],
        quickView: {
          executiveSummary: {
            markdown:
              "这份摘要说明美国 AI neo-labs 的技术方向和投资热点谱系需要用资产账本和论点图共同判断。",
          },
        },
      },
      reviewVerdict: {
        verdict: "revise",
        notes: ["实体边界不稳，关键事实缺引用。"],
      },
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join("\n")).toContain("S9 critic 要求重写");
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
      expect((result.structured as any).workstreams).toHaveLength(6);
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

  it("passes GenesisPod DeepSeek model config into the Solar bridge subprocess env", async () => {
    const previousCmd = process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
    const previousArgs = process.env.GENESISPOD_SOLAR_OPERATOR_ARGS;
    const script = resolve(
      mkdtempSync(`${tmpdir()}/deep-insight-solar-env-bridge-`),
      "bridge.js",
    );
    writeFileSync(
      script,
      [
        "#!/usr/bin/env node",
        "const structured = {",
        "  key: process.env.DEEP_INSIGHT_SOLAR_DEEPSEEK_API_KEY,",
        "  model: process.env.DEEP_INSIGHT_SOLAR_DEEPSEEK_MODEL,",
        "  baseUrl: process.env.DEEP_INSIGHT_SOLAR_DEEPSEEK_BASE_URL,",
        "};",
        "console.log(JSON.stringify({status:'succeeded', structured, metrics:{modelId: structured.model}}));",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    process.env.GENESISPOD_SOLAR_OPERATOR_CMD = process.execPath;
    process.env.GENESISPOD_SOLAR_OPERATOR_ARGS = JSON.stringify([script]);
    const aiFacade = {
      getFullModelConfig: jest.fn().mockResolvedValue({
        id: "model-row-1",
        modelId: "deepseek-chat",
        displayName: "DeepSeek Chat",
        name: "DeepSeek Chat",
        provider: "deepseek",
        apiKey: "sk-from-genesispod",
        apiEndpoint: "https://api.deepseek.com/v1",
        isEnabled: true,
        isDefault: false,
      }),
    };
    try {
      const result = await new SubprocessSolarHarnessOperatorPort(
        aiFacade as any,
      ).runOperator({
        missionId: "m1",
        userId: "user-1",
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
        constraints: {
          modelStrategy: { nativeFastModelId: "deepseek-config-id" },
        },
        payload: {},
      });
      expect(aiFacade.getFullModelConfig).toHaveBeenCalledWith(
        "deepseek-config-id",
        "user-1",
      );
      expect(result.status).toBe("succeeded");
      expect(result.structured).toEqual({
        key: "sk-from-genesispod",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
      });
      expect(result.metrics?.modelId).toBe("deepseek-chat");
    } finally {
      if (previousCmd) process.env.GENESISPOD_SOLAR_OPERATOR_CMD = previousCmd;
      else delete process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
      if (previousArgs) process.env.GENESISPOD_SOLAR_OPERATOR_ARGS = previousArgs;
      else delete process.env.GENESISPOD_SOLAR_OPERATOR_ARGS;
    }
  });

  it("preserves structured Solar failure JSON when subprocess exits non-zero", async () => {
    const previousCmd = process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
    const previousArgs = process.env.GENESISPOD_SOLAR_OPERATOR_ARGS;
    const script = resolve(
      mkdtempSync(`${tmpdir()}/deep-insight-solar-failing-bridge-`),
      "bridge.js",
    );
    writeFileSync(
      script,
      [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify({status:'failed',error:{code:'AUTH_REPAIR_REQUIRED',message:'login_wall=true',retryable:false}}));",
        "process.exit(1);",
      ].join("\n"),
    );
    chmodSync(script, 0o755);
    process.env.GENESISPOD_SOLAR_OPERATOR_CMD = process.execPath;
    process.env.GENESISPOD_SOLAR_OPERATOR_ARGS = JSON.stringify([script]);
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
      expect(result.error?.code).toBe("AUTH_REPAIR_REQUIRED");
      expect(result.error?.message).toContain("login_wall=true");
      expect(result.error?.retryable).toBe(false);
    } finally {
      if (previousCmd) process.env.GENESISPOD_SOLAR_OPERATOR_CMD = previousCmd;
      else delete process.env.GENESISPOD_SOLAR_OPERATOR_CMD;
      if (previousArgs) process.env.GENESISPOD_SOLAR_OPERATOR_ARGS = previousArgs;
      else delete process.env.GENESISPOD_SOLAR_OPERATOR_ARGS;
    }
  });

  it("rewinds stale S11 checkpoints when S3 contains failed researcher placeholders", () => {
    const rawCrossState = {
      [CS_KEY.plan]: {
        dimensions: [{ id: "r1", name: "实体边界与美国主体确认" }],
      },
      [SOLAR_CS_KEY.technologyInsightPlan]: {
        centralQuestion: "Neo Labs 技术方向是什么",
        workstreams: [{ id: "r1", name: "实体边界与美国主体确认" }],
      },
      [SOLAR_CS_KEY.researchContract]: { centralQuestion: "Neo Labs" },
      [CS_KEY.researcherResults]: [
        {
          dimension: "实体边界与美国主体确认",
          summary:
            "failed: SOLAR_API_PROVIDER_FAILED: BrowserResearcher returned no findings",
          findings: [],
        },
      ],
      [SOLAR_CS_KEY.researchAssetLedger]: { assets: [{ id: "asset-1" }] },
      [SOLAR_CS_KEY.reportPackage]: {
        standardReportMarkdown: "# stale report\n\nold body",
      },
      [CS_KEY.reportArtifact]: {
        content: { fullMarkdown: "# stale report\n\nold body" },
      },
    };

    const prepared = prepareDeepInsightSolarResumeState(
      "s11-persist",
      rawCrossState,
    );

    expect(prepared).toMatchObject({
      rewound: true,
      resumeFromStepId: "s2-leader-plan",
      reason: "failed_s3_researcher_checkpoint",
    });
    expect(prepared.crossState[CS_KEY.plan]).toEqual(rawCrossState[CS_KEY.plan]);
    expect(prepared.crossState[SOLAR_CS_KEY.technologyInsightPlan]).toEqual(
      rawCrossState[SOLAR_CS_KEY.technologyInsightPlan],
    );
    expect(prepared.crossState[SOLAR_CS_KEY.researchContract]).toEqual(
      rawCrossState[SOLAR_CS_KEY.researchContract],
    );
    expect(prepared.crossState[CS_KEY.researcherResults]).toBeUndefined();
    expect(prepared.crossState[SOLAR_CS_KEY.researchAssetLedger]).toBeUndefined();
    expect(prepared.crossState[SOLAR_CS_KEY.reportPackage]).toBeUndefined();
    expect(prepared.crossState[CS_KEY.reportArtifact]).toBeUndefined();
  });
});
