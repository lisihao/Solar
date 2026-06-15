import { createHash } from "node:crypto";
import type {
  ResolvedStageHooks,
  StageRunArgs,
} from "../../../../../../ai-harness/facade";
import {
  CrossStageState,
  defineStageHooks,
  type AgentRunner,
} from "../../../../../../ai-harness/facade";
import { DeepInsightStageBindings } from "../../../deep-insight/pipeline/bindings";
import type { RichServices } from "../../../deep-insight/pipeline/bindings/deep-insight-stage-bindings";
import { emitDomain } from "../../../deep-insight/pipeline/bindings/agent-invoke.helper";
import {
  asArtifact,
  buildAssembleInput,
  buildCriticArtifactSummary,
  type AnalystShape,
  type PlanShape,
  type ReconciliationShape,
  type ResearcherShape,
  type WriterReportShape,
} from "../../../deep-insight/pipeline/bindings/report-assembler.helper";
import {
  CS_KEY,
  readPipelineInput,
  type DeepInsightPipelineInput,
} from "../../../deep-insight/pipeline/ports";
import type {
  SolarHarnessOperatorPort,
  SolarOperatorRequest,
  SolarOperatorResult,
} from "../../ports/solar-harness-operator.port";

const SOLAR_PIPELINE_ID = "deep-insight-solar";
const PROMPT_VERSION = "deep-insight-solar.v0.1";
const OUTPUT_SCHEMA_VERSION = "solar-operator-result.v1";

export const SOLAR_CS_KEY = {
  researchContract: "deep-insight-solar.researchContract",
  evidenceLedger: "deep-insight-solar.evidenceLedger",
  claimLedger: "deep-insight-solar.claimLedger",
  insightKernel: "deep-insight-solar.insightKernel",
  diagramBriefs: "deep-insight-solar.diagramBriefs",
  sectionDrafts: "deep-insight-solar.sectionDrafts",
  redTeamMemo: "deep-insight-solar.redTeamMemo",
  artifactManifest: "deep-insight-solar.artifactManifest",
  degradedReasons: "deep-insight-solar.degradedReasons",
} as const;

const SOLAR_STATE_BY_MISSION = new Map<string, CrossStageState>();

export function attachSolarState(missionId: string, state: CrossStageState): void {
  SOLAR_STATE_BY_MISSION.set(missionId, state);
}

export function detachSolarState(missionId: string): void {
  SOLAR_STATE_BY_MISSION.delete(missionId);
}

export class DeepInsightSolarStageBindings {
  private readonly baseline: DeepInsightStageBindings;

  constructor(
    runner: AgentRunner,
    private readonly rich: RichServices,
    private readonly operatorPort: SolarHarnessOperatorPort,
  ) {
    this.baseline = new DeepInsightStageBindings(runner, rich);
  }

  buildHooksForStep(stepId: string): ResolvedStageHooks {
    switch (stepId) {
      case "s2-leader-plan":
        return this.buildSolarLeaderPlannerHooks();
      case "s6-analyst":
        return this.buildSolarAnalystHooks();
      case "s8-writer":
        return this.buildSolarWriterHooks();
      case "s9-critic":
        return this.buildSolarCriticHooks();
      default:
        return this.baseline.buildHooksForStep(stepId);
    }
  }

  private fullArgs(ctx: StageRunArgs["ctx"]): {
    missionId: string;
    input: DeepInsightPipelineInput;
    crossStageState: CrossStageState;
  } {
    const missionId = ctx.missionId;
    const crossStageState = SOLAR_STATE_BY_MISSION.get(missionId);
    if (!crossStageState) {
      throw new Error(
        `[deep-insight-solar] missing CrossStageState binding for mission ${missionId}`,
      );
    }
    return { missionId, input: readPipelineInput(ctx), crossStageState };
  }

  private buildSolarLeaderPlannerHooks(): ResolvedStageHooks {
    return defineStageHooks({
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const { missionId, input, crossStageState } = this.fullArgs(args.ctx);
        emitDomain(input.invocation.onEvent, "agent:narrative", {
          stage: "s2-leader-plan",
          role: "solar-browser-leader-planner",
          tag: "planning",
          text: "Solar BrowserLeaderPlanner 正在制定 ResearchContract",
        });
        const result = await this.invokeOperator({
          input,
          crossStageState,
          stepId: "s2-leader-plan",
          operatorId: "BrowserLeaderPlanner",
          missionId,
          payload: {
            topic: input.topic,
            description: input.invocation.description,
            depth: input.invocation.depth ?? "standard",
            language: input.language,
            priorPostmortems: input.invocation.priorPostmortems ?? [],
          },
        });
        const plan = this.normalizeResearchContract(
          result.structured,
          result.markdown,
          input,
        );
        crossStageState.set(SOLAR_CS_KEY.researchContract, result.structured ?? plan);
        crossStageState.set(CS_KEY.plan, plan);
        crossStageState.set(CS_KEY.goals, {
          coreQuestion: input.topic,
          qualityBar: { minCoverage: 0.75, minSourceDiversity: 3 },
          constraints: ["Solar strong-model plan", "evidence-ledger required"],
        });
        crossStageState.set(CS_KEY.leaderJournal, [
          {
            phase: "s2-solar-plan",
            decision: "research-contract-created",
            at: new Date().toISOString(),
            dimensions: plan.dimensions.map((d) => d.name),
          },
        ]);
        emitDomain(input.invocation.onEvent, "leader:goals-set", {
          source: "solar-browser-agent",
          dimensions: plan.dimensions,
          goals: crossStageState.get(CS_KEY.goals),
        });
        return plan;
      },
    });
  }

  private buildSolarAnalystHooks(): ResolvedStageHooks {
    return defineStageHooks({
      synthesize: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const { missionId, input, crossStageState } = this.fullArgs(args.ctx);
        const plan = crossStageState.get<PlanShape>(CS_KEY.plan);
        const researcherResults =
          crossStageState.get<ResearcherShape[]>(CS_KEY.researcherResults) ?? [];
        const reconciliation = crossStageState.get(CS_KEY.reconciliationReport);
        const result = await this.invokeOperator({
          input,
          crossStageState,
          stepId: "s6-analyst",
          operatorId: "BrowserAnalyst",
          missionId,
          payload: {
            topic: input.topic,
            plan,
            researcherResults,
            reconciliation,
            requiredOutput:
              "InsightKernel + EvidenceLedger + ClaimLedger + DiagramBrief[]",
          },
        });
        const analyst = this.normalizeInsightKernel(result.structured, result.markdown, input);
        const diagramBriefs = this.extractArrayField(
          result.structured,
          "diagramBriefs",
        );
        crossStageState.set(SOLAR_CS_KEY.insightKernel, result.structured ?? analyst);
        crossStageState.set(SOLAR_CS_KEY.diagramBriefs, diagramBriefs);
        crossStageState.set(SOLAR_CS_KEY.evidenceLedger, result.evidence ?? []);
        crossStageState.set(CS_KEY.analystOutput, analyst);
        emitDomain(input.invocation.onEvent, "stage:metrics", {
          stepId: "s6-analyst",
          source: "solar-browser-agent",
          insightCount: analyst.insights?.length ?? 0,
          diagramBriefCount: diagramBriefs.length,
        });
        return analyst;
      },
    });
  }

  private buildSolarWriterHooks(): ResolvedStageHooks {
    return defineStageHooks({
      draftOnce: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const { missionId, input, crossStageState } = this.fullArgs(args.ctx);
        const plan = crossStageState.get<PlanShape>(CS_KEY.plan);
        const analyst = crossStageState.get<AnalystShape>(CS_KEY.analystOutput);
        const outlinePlan = crossStageState.get(CS_KEY.outlinePlan);
        const diagramBriefs = crossStageState.get(SOLAR_CS_KEY.diagramBriefs) ?? [];
        const result = await this.invokeOperator({
          input,
          crossStageState,
          stepId: "s8-writer",
          operatorId: "BrowserLongformWriter",
          missionId,
          payload: {
            topic: input.topic,
            plan,
            analyst,
            outlinePlan,
            diagramBriefs,
            instruction:
              "Write section-by-section; preserve claim/evidence anchors and diagram placeholders.",
          },
        });
        const report = this.normalizeSectionDrafts(result.structured, result.markdown, input);
        crossStageState.set(SOLAR_CS_KEY.sectionDrafts, result.structured ?? report);
        crossStageState.set(CS_KEY.report, report);
        this.emitChapterEvents(input, crossStageState, report);
        return report;
      },
      reportArtifactAssembler: (args: {
        artifact: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const { input, crossStageState } = this.fullArgs(args.ctx);
        const plan = crossStageState.get<PlanShape>(CS_KEY.plan);
        const researcherResults =
          crossStageState.get<ResearcherShape[]>(CS_KEY.researcherResults) ?? [];
        const analyst = crossStageState.get<AnalystShape>(CS_KEY.analystOutput);
        const reconciliation = crossStageState.get<ReconciliationShape>(
          CS_KEY.reconciliationReport,
        );
        const startedAt = crossStageState.get<number>(CS_KEY.startedAt) ?? Date.now();
        try {
          const artifact = this.rich.reportArtifactAssembler.assemble(
            buildAssembleInput({
              profile: {
                topic: input.topic,
                language: input.language,
                ...(input.invocation.depth ? { depth: input.invocation.depth } : {}),
                ...(input.invocation.styleProfile
                  ? { styleProfile: input.invocation.styleProfile }
                  : {}),
                ...(input.invocation.lengthProfile
                  ? { lengthProfile: input.invocation.lengthProfile }
                  : {}),
                ...(input.invocation.audienceProfile
                  ? { audienceProfile: input.invocation.audienceProfile }
                  : {}),
                ...(input.invocation.searchTimeRange
                  ? { searchTimeRange: input.invocation.searchTimeRange }
                  : {}),
              },
              plan,
              researcherResults,
              analyst,
              writerReport: args.artifact as WriterReportShape | undefined,
              reconciliation,
              usage: {
                totalTokens: crossStageState.get<number>(CS_KEY.tokensUsed) ?? 0,
                totalCostCents: crossStageState.get<number>(CS_KEY.costCents) ?? 0,
                generationTimeMs: Math.max(0, Date.now() - startedAt),
              },
              modelTrail: crossStageState.get<string[]>(CS_KEY.modelTrail) ?? [],
            }),
          );
          crossStageState.set(CS_KEY.reportArtifact, artifact);
          crossStageState.set(SOLAR_CS_KEY.artifactManifest, {
            diagramBriefs: crossStageState.get(SOLAR_CS_KEY.diagramBriefs) ?? [],
            artifacts: [],
            assembledAt: new Date().toISOString(),
          });
          return Promise.resolve(artifact);
        } catch {
          crossStageState.set(CS_KEY.reportArtifact, args.artifact);
          return Promise.resolve(args.artifact);
        }
      },
    });
  }

  private buildSolarCriticHooks(): ResolvedStageHooks {
    return defineStageHooks({
      review: async (args: {
        artifact: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const { missionId, input, crossStageState } = this.fullArgs(args.ctx);
        const artifact =
          asArtifact(crossStageState.get(CS_KEY.reportArtifact)) ??
          asArtifact(args.artifact);
        const result = await this.invokeOperator({
          input,
          crossStageState,
          stepId: "s9-critic",
          operatorId: "BrowserCritic",
          missionId,
          payload: {
            topic: input.topic,
            artifactSummary: buildCriticArtifactSummary(artifact, input.topic),
            instruction:
              "Independent red-team review. Do not reuse writer context; identify claim gaps, citation gaps, and diagram risks.",
          },
        });
        const memo = this.normalizeRedTeamMemo(result.structured, result.markdown);
        crossStageState.set(SOLAR_CS_KEY.redTeamMemo, memo);
        const verdict = {
          verdict: memo.criticalIssues.length > 0 ? "revise" : "approve",
          score: memo.criticalIssues.length > 0 ? 68 : 86,
          notes: [...memo.criticalIssues, ...memo.recommendations],
          reviewer: "Solar BrowserCritic",
        };
        crossStageState.set(CS_KEY.reviewVerdict, verdict);
        return { verdict };
      },
    });
  }

  private async invokeOperator(args: {
    input: DeepInsightPipelineInput;
    crossStageState: CrossStageState;
    stepId: SolarOperatorRequest["stepId"];
    operatorId: SolarOperatorRequest["operatorId"];
    missionId: string;
    payload: unknown;
  }): Promise<SolarOperatorResult> {
    const depth = args.input.invocation.depth ?? "standard";
    const inputStateHash = stableHash(args.payload);
    const idempotencyKey = stableHash({
      missionId: args.input.invocation.userId,
      actualMissionId: args.missionId,
      stepId: args.stepId,
      recipeVersion: PROMPT_VERSION,
      inputStateHash,
    });
    emitDomain(args.input.invocation.onEvent, "agent:lifecycle", {
      agentId: args.operatorId,
      role: "solar-browser-agent",
      phase: "started",
      stepId: args.stepId,
      idempotencyKey,
    });
    const result = await this.operatorPort.runOperator({
      missionId: args.missionId,
      capabilityId: SOLAR_PIPELINE_ID,
      pipelineId: SOLAR_PIPELINE_ID,
      stepId: args.stepId,
      operatorId: args.operatorId,
      idempotencyKey,
      inputStateHash,
      topic: args.input.topic,
      depth,
      language: args.input.language,
      promptVersion: PROMPT_VERSION,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      constraints: {
        failClosed: true,
        noRawMarkdownIntoState: true,
        requireStructuredGate: true,
      },
      payload: args.payload,
    });
    this.recordOperatorMetrics(args.crossStageState, result);
    if (result.status === "failed" || result.status === "timed_out") {
      emitDomain(args.input.invocation.onEvent, "agent:lifecycle", {
        agentId: args.operatorId,
        role: "solar-browser-agent",
        phase: "failed",
        stepId: args.stepId,
        error: result.error?.message ?? result.status,
      });
      throw new Error(
        `[deep-insight-solar] ${args.operatorId} ${result.status}: ${
          result.error?.message ?? "unknown error"
        }`,
      );
    }
    if (result.status === "degraded") {
      const existing =
        args.crossStageState.get<Array<Record<string, unknown>>>(
          SOLAR_CS_KEY.degradedReasons,
        ) ?? [];
      args.crossStageState.set(SOLAR_CS_KEY.degradedReasons, [
        ...existing,
        {
          stepId: args.stepId,
          operatorId: args.operatorId,
          error: result.error ?? null,
          at: new Date().toISOString(),
        },
      ]);
    }
    emitDomain(args.input.invocation.onEvent, "agent:lifecycle", {
      agentId: args.operatorId,
      role: "solar-browser-agent",
      phase: result.status === "degraded" ? "degraded" : "completed",
      stepId: args.stepId,
      metrics: result.metrics ?? {},
    });
    return result;
  }

  private recordOperatorMetrics(
    state: CrossStageState,
    result: SolarOperatorResult,
  ): void {
    const metrics = result.metrics ?? {};
    const tokens = asNumber(metrics.tokensUsed);
    const cost = asNumber(metrics.costCents);
    if (tokens !== undefined) {
      state.set(CS_KEY.tokensUsed, (state.get<number>(CS_KEY.tokensUsed) ?? 0) + tokens);
    }
    if (cost !== undefined) {
      state.set(CS_KEY.costCents, (state.get<number>(CS_KEY.costCents) ?? 0) + cost);
    }
    const modelId = typeof metrics.modelId === "string" ? metrics.modelId : undefined;
    if (modelId) {
      const trail = state.get<string[]>(CS_KEY.modelTrail) ?? [];
      state.set(CS_KEY.modelTrail, trail.includes(modelId) ? trail : [...trail, modelId]);
    }
  }

  private normalizeResearchContract(
    structured: unknown,
    markdown: string | undefined,
    input: DeepInsightPipelineInput,
  ): PlanShape {
    const obj = asRecord(structured);
    const dims = arrayFromUnknown(obj?.dimensions).map((raw, idx) => {
      const dim = asRecord(raw);
      return {
        id: asString(dim?.id) ?? `solar-dim-${idx + 1}`,
        name: asString(dim?.name) ?? asString(dim?.title) ?? `维度 ${idx + 1}`,
        rationale: asString(dim?.rationale) ?? asString(dim?.description) ?? "",
      };
    });
    return {
      themeSummary:
        asString(obj?.themeSummary) ??
        asString(obj?.summary) ??
        markdown?.split("\n").find((line) => line.trim().length > 0) ??
        input.topic,
      dimensions:
        dims.length > 0
          ? dims
          : [
              {
                id: "solar-dim-1",
                name: "核心问题拆解",
                rationale: "Solar operator did not return explicit dimensions.",
              },
            ],
    };
  }

  private normalizeInsightKernel(
    structured: unknown,
    markdown: string | undefined,
    input: DeepInsightPipelineInput,
  ): AnalystShape {
    const obj = asRecord(structured);
    const insights = arrayFromUnknown(obj?.insights ?? obj?.coreInsights).map(
      (raw, idx) => {
        const item = asRecord(raw);
        return {
          headline:
            asString(item?.headline) ?? asString(item?.title) ?? `核心洞察 ${idx + 1}`,
          oneLine: asString(item?.oneLine) ?? asString(item?.summary),
          narrative: asString(item?.narrative) ?? asString(item?.body),
        };
      },
    );
    return {
      themeSummary:
        asString(obj?.themeSummary) ??
        asString(obj?.thesis) ??
        markdown?.split("\n").find((line) => line.trim().length > 0) ??
        input.topic,
      insights:
        insights.length > 0
          ? insights
          : [{ headline: "Solar 分析结果", narrative: markdown ?? input.topic }],
      contradictions: arrayFromUnknown(obj?.contradictions ?? obj?.tensions),
      gaps: arrayFromUnknown(obj?.gaps ?? obj?.blindSpots),
      strategicRecommendations:
        asString(obj?.strategicRecommendations) ??
        arrayFromUnknown(obj?.recommendations).map(String).join("\n"),
      crossDimAnalysis: asString(obj?.crossDimAnalysis),
      riskAssessment: asString(obj?.riskAssessment),
      preface: asString(obj?.preface),
    };
  }

  private normalizeSectionDrafts(
    structured: unknown,
    markdown: string | undefined,
    input: DeepInsightPipelineInput,
  ): WriterReportShape {
    const obj = asRecord(structured);
    const sections = arrayFromUnknown(obj?.sections ?? obj?.sectionDrafts).map(
      (raw, idx) => {
        const item = asRecord(raw);
        return {
          heading:
            asString(item?.heading) ?? asString(item?.title) ?? `章节 ${idx + 1}`,
          body: asString(item?.body) ?? asString(item?.content) ?? "",
          sources: arrayFromUnknown(item?.sources).map(String),
        };
      },
    );
    return {
      title: asString(obj?.title) ?? input.topic,
      summary:
        asString(obj?.summary) ??
        markdown?.split("\n").find((line) => line.trim().length > 0) ??
        input.topic,
      sections:
        sections.length > 0
          ? sections
          : [{ heading: "Solar 强模型草稿", body: markdown ?? "" }],
      conclusion: asString(obj?.conclusion) ?? "",
      citations: arrayFromUnknown(obj?.citations).map(String),
    };
  }

  private normalizeRedTeamMemo(
    structured: unknown,
    markdown: string | undefined,
  ): {
    criticalIssues: string[];
    recommendations: string[];
    markdown?: string;
  } {
    const obj = asRecord(structured);
    return {
      criticalIssues: arrayFromUnknown(
        obj?.criticalIssues ?? obj?.claimGaps ?? obj?.citationGaps,
      ).map(String),
      recommendations: arrayFromUnknown(obj?.recommendations).map(String),
      ...(markdown ? { markdown } : {}),
    };
  }

  private extractArrayField(structured: unknown, key: string): unknown[] {
    const obj = asRecord(structured);
    return arrayFromUnknown(obj?.[key]);
  }

  private emitChapterEvents(
    input: DeepInsightPipelineInput,
    state: CrossStageState,
    report: WriterReportShape,
  ): void {
    const planDims = state.get<PlanShape>(CS_KEY.plan)?.dimensions ?? [];
    const sections = report.sections ?? [];
    sections.forEach((section, idx) => {
      const dim = planDims[idx];
      const dimension = dim?.name ?? input.topic;
      const heading = section.heading ?? section.title ?? `章节 ${idx + 1}`;
      emitDomain(input.invocation.onEvent, "chapter:writing:started", {
        dimension,
        heading,
        chapterIndex: idx,
        ...(dim?.id ? { dimensionId: dim.id } : {}),
      });
      emitDomain(input.invocation.onEvent, "chapter:writing:completed", {
        dimension,
        heading,
        chapterIndex: idx,
        ...(dim?.id ? { dimensionId: dim.id } : {}),
        wordCount:
          typeof section.body === "string"
            ? Math.round(section.body.length / 2)
            : 0,
      });
    });
  }
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(value))
    .digest("hex")
    .slice(0, 24);
}

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
