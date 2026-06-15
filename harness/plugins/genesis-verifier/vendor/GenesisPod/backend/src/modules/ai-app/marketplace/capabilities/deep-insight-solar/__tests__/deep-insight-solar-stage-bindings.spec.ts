import { CrossStageState, type StageRunArgs } from "@/modules/ai-harness/facade";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CS_KEY } from "../../deep-insight/pipeline/ports";
import { DEEP_INSIGHT_PIPELINE } from "../../deep-insight/recipe/deep-insight.recipe";
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
          themeSummary: "Solar contract",
          dimensions: [
            { id: "d1", name: "Architecture", rationale: "core path" },
          ],
        },
        metrics: { modelId: "mock-strong-model", tokensUsed: 10, costCents: 1 },
      });
    }
    if (request.operatorId === "BrowserAnalyst") {
      return Promise.resolve({
        status: "succeeded",
        structured: {
          thesis: "Solar insight kernel",
          coreInsights: [{ title: "Agent infra shifts", summary: "compute moves up-stack" }],
          diagramBriefs: [{ id: "fig-1", caption: "Agent system stack" }],
        },
        evidence: [{ id: "ev-1" }],
      });
    }
    if (request.operatorId === "BrowserLongformWriter") {
      return Promise.resolve({
        status: "succeeded",
        structured: {
          title: "Solar report",
          summary: "summary",
          sections: [{ heading: "Section A", body: "Body with evidence." }],
          conclusion: "done",
          citations: ["source-a"],
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
  });

  it("maps S2/S6/S8/S9 Solar operator output into compatible CrossStageState", async () => {
    const state = new CrossStageState();
    state.set(CS_KEY.startedAt, Date.now());
    state.set(CS_KEY.researcherResults, [
      {
        dimension: "Architecture",
        findings: [{ claim: "claim", evidence: "evidence", source: "source-a" }],
        summary: "research summary",
      },
    ]);
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
      themeSummary: "Solar contract",
    });
    expect(state.get(SOLAR_CS_KEY.researchContract)).toBeTruthy();

    const s6 = bindings.buildHooksForStep("s6-analyst") as {
      synthesize(args: { ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    await s6.synthesize({ ctx: stageCtx });
    expect(state.get(CS_KEY.analystOutput)).toMatchObject({
      themeSummary: "Solar insight kernel",
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
    expect(state.get(CS_KEY.report)).toMatchObject({ title: "Solar report" });
    expect(state.get(CS_KEY.reportArtifact)).toMatchObject({
      content: { fullMarkdown: expect.stringContaining("Agent system architecture") },
    });

    const s9 = bindings.buildHooksForStep("s9-critic") as {
      review(args: { artifact: unknown; ctx: StageRunArgs["ctx"] }): Promise<unknown>;
    };
    await s9.review({ artifact: state.get(CS_KEY.reportArtifact), ctx: stageCtx });
    expect(state.get(SOLAR_CS_KEY.redTeamMemo)).toMatchObject({
      recommendations: ["tighten citations"],
    });
    expect(state.get(CS_KEY.reviewVerdict)).toMatchObject({ verdict: "approve" });
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
      "s6-analyst",
      "s8-writer",
      "s9-critic",
    ]);
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
        dimensions: [{ id: "dry-d1" }],
      });
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
