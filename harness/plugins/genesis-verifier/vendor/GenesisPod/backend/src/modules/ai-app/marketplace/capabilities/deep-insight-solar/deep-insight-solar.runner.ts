import { Injectable, Logger, Optional, type OnModuleInit } from "@nestjs/common";
import type { IAgentEvent } from "@/modules/ai-harness/facade";
import {
  AgentRunner,
  CapabilityRegistry,
  ChatFacade,
  CrossStageState,
  FigureRelevanceService,
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
  PostmortemClassifierService,
  QualityTraceComputeService,
  ReportArtifactAssembler,
  ReportEvaluationService,
  SectionRemediationService,
  SectionSelfEvalService,
  type CapabilityManifest,
  type CapabilityRunContext,
  type CapabilityRunInput,
  type CapabilityRunResult,
  type ICapabilityRunner,
  type MissionPersistencePort,
  type MissionTerminalDetails,
  type PipelineMissionEvent,
} from "../deep-insight/runner-deps";
import {
  fireSelfEvolutionPostlude,
  type SelfEvolutionPostludeDeps,
} from "../deep-insight/postlude/self-evolution.postlude";
import {
  attachState,
  detachState,
} from "../deep-insight/pipeline/bindings";
import {
  CS_KEY,
  type AgentInvocation,
  type DeepInsightPipelineInput,
} from "../deep-insight/pipeline/ports";
import { DEEP_INSIGHT_SOLAR_PIPELINE } from "./recipe/deep-insight-solar.recipe";
import {
  attachSolarState,
  DeepInsightSolarStageBindings,
  detachSolarState,
  SOLAR_CS_KEY,
} from "./pipeline/bindings/deep-insight-solar-stage-bindings";
import {
  SubprocessSolarHarnessOperatorPort,
  type SolarHarnessOperatorPort,
} from "./ports/solar-harness-operator.port";

const DEEP_INSIGHT_SOLAR_PIPELINE_ID = "deep-insight-solar";
const EVENT_BUFFER_MAX = 500;
const MISSION_START_CHECKPOINT_ID = "__mission_start__";
const DEFAULT_DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID = "Qwen3.6-35b-a3b";

export interface DeepInsightSolarDeliverableSnapshot {
  readonly topic: string;
  readonly description?: string;
  readonly depth?: string;
  readonly lengthProfile?: string;
  readonly plan?: {
    readonly dimensions?: ReadonlyArray<{ readonly name?: string }>;
  };
  readonly researcherResults?: ReadonlyArray<{
    readonly dimension?: string;
    readonly findings?: ReadonlyArray<{
      readonly claim?: string;
      readonly evidence?: string;
      readonly source?: string;
    }>;
    readonly summary?: string;
  }>;
  readonly report?: unknown;
  readonly reportArtifact?: unknown;
}

export interface DeepInsightSolarDeliverableGateResult {
  readonly ok: boolean;
  readonly reasons: string[];
  readonly metrics: {
    readonly dimensionCount: number;
    readonly successfulResearchDimensions: number;
    readonly rawFindingCount: number;
    readonly sectionCount: number;
    readonly validSectionCount: number;
    readonly missingSectionCount: number;
    readonly fullMarkdownChars: number;
    readonly citationCount: number;
    readonly factCount: number;
    readonly longFormRequested: boolean;
  };
}

export function evaluateDeepInsightSolarDeliverable(
  snapshot: DeepInsightSolarDeliverableSnapshot,
): DeepInsightSolarDeliverableGateResult {
  const reasons: string[] = [];
  const planDimensions = snapshot.plan?.dimensions ?? [];
  const researcherResults = snapshot.researcherResults ?? [];
  const successfulResearchDimensions = researcherResults.filter((result) =>
    hasUsableFindings(result.findings),
  ).length;
  const rawFindingCount = researcherResults.reduce(
    (sum, result) => sum + countUsableFindings(result.findings),
    0,
  );
  const artifact = asRecord(snapshot.reportArtifact);
  const artifactSections = Array.isArray(artifact?.sections)
    ? (artifact.sections as unknown[])
    : [];
  const reportSections = Array.isArray(asRecord(snapshot.report)?.sections)
    ? (asRecord(snapshot.report)?.sections as unknown[])
    : [];
  const sections = chooseBestSections(artifactSections, reportSections);
  const sectionMetrics = sections.map((section) => {
    const item = asRecord(section);
    const title = asTrimmedString(item?.title) ?? asTrimmedString(item?.heading) ?? "";
    const body = asTrimmedString(item?.content) ?? asTrimmedString(item?.body) ?? "";
    const wordCount =
      typeof item?.wordCount === "number" ? item.wordCount : Math.round(body.length / 2);
    return { title, body, wordCount };
  });
  const missingSectionCount = sectionMetrics.filter((section) =>
    /本维度内容缺失|内容缺失|缺失章节|missing content/i.test(
      `${section.title}\n${section.body}`,
    ),
  ).length;
  const validSectionCount = sectionMetrics.filter(
    (section) => section.body.length >= 120 || section.wordCount >= 80,
  ).length;
  const artifactMarkdown = asTrimmedString(asRecord(artifact?.content)?.fullMarkdown) ?? "";
  const reportMarkdown = reportToMarkdown(snapshot.report);
  const fullMarkdown =
    reportMarkdown.length > artifactMarkdown.length ? reportMarkdown : artifactMarkdown;
  const citationCount = Array.isArray(artifact?.citations)
    ? artifact.citations.length
    : 0;
  const factCount = Array.isArray(artifact?.factTable)
    ? artifact.factTable.length
    : 0;
  const executiveSummary = asTrimmedString(
    asRecord(asRecord(artifact?.quickView)?.executiveSummary)?.markdown,
  );
  const longFormRequested = needsLongForm(snapshot);
  const minMarkdownChars = longFormRequested ? 6000 : 1200;
  const minValidSections = longFormRequested
    ? Math.max(4, Math.min(6, planDimensions.length || 4))
    : 1;
  const minSuccessfulDimensions =
    planDimensions.length > 0 ? Math.max(1, Math.ceil(planDimensions.length * 0.5)) : 1;

  if (planDimensions.length > 0 && successfulResearchDimensions < minSuccessfulDimensions) {
    reasons.push(
      `S3 有效调研维度不足：${successfulResearchDimensions}/${planDimensions.length}`,
    );
  }
  if (rawFindingCount <= 0) {
    reasons.push("S3 未产出可用 findings");
  }
  if (!artifact) {
    reasons.push("S8 未产出 reportArtifact");
  }
  if (fullMarkdown.length < minMarkdownChars) {
    reasons.push(
      `报告正文过短：${fullMarkdown.length}/${minMarkdownChars} chars`,
    );
  }
  if (sections.length === 0) {
    reasons.push("报告章节为空");
  } else if (validSectionCount < minValidSections) {
    reasons.push(`有效章节不足：${validSectionCount}/${minValidSections}`);
  }
  if (missingSectionCount > 0) {
    reasons.push(`存在缺失章节占位：${missingSectionCount}`);
  }
  if (citationCount === 0 && rawFindingCount > 0) {
    reasons.push("报告未保留引用/证据锚点");
  }
  if (artifact && executiveSummary !== undefined && executiveSummary.length < 40) {
    reasons.push("执行摘要为空或过短");
  }
  const insightRubric = asRecord(asRecord(artifact?.metadata)?.insightRubricResult);
  const rubricBlockers = Array.isArray(insightRubric?.blockers)
    ? insightRubric.blockers.map(String).filter(Boolean)
    : [];
  if (rubricBlockers.length > 0) {
    reasons.push(`Insight Rubric blocker：${rubricBlockers.join("；")}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      dimensionCount: planDimensions.length,
      successfulResearchDimensions,
      rawFindingCount,
      sectionCount: sections.length,
      validSectionCount,
      missingSectionCount,
      fullMarkdownChars: fullMarkdown.length,
      citationCount,
      factCount,
      longFormRequested,
    },
  };
}

export function resolveDeepInsightSolarNativeModelId(
  preferredModelId?: string,
): string | undefined {
  const explicit = preferredModelId?.trim();
  if (explicit) return explicit;

  const configured = process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID?.trim();
  return configured || DEFAULT_DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID;
}

const MANIFEST: CapabilityManifest = {
  id: "deep-insight-solar",
  version: "0.1.0",
  kind: "workflow",
  title: "Solar 强模型深度洞察研究",
  description:
    "13-step + 1 background postlude：复用 deep-insight mission kernel，在 S2/S6/S8/S9 接入 Solar browser-agent 强模型算子。",
  roles: [
    "leader",
    "researcher",
    "reconciler",
    "analyst",
    "writer",
    "reviewer",
    "verifier",
    "steward",
  ],
  stages: [
    "预算闸",
    "Solar Leader 规划",
    "并行调研",
    "Leader 评估",
    "跨维对账",
    "Solar 综合分析",
    "大纲规划",
    "Solar 分段成稿",
    "质量增强与图文验证",
    "Solar 独立红队",
    "客观评估",
    "Leader 序言签发",
    "最终持久化",
  ],
  missionType: "deep-insight-solar",
  permissions: ["web-search", "browser-agent"],
  rubric: { passThreshold: 60, maxAttempts: 2 },
};

const STEP_LABEL: Record<string, string> = {
  "s1-budget": "预算闸",
  "s2-leader-plan": "Solar Leader 规划",
  "s3-researcher-collect": "并行调研",
  "s4-leader-assess": "Leader 评估",
  "s5-reconciler": "跨维对账",
  "s6-analyst": "Solar 综合分析",
  "s7-writer-outline": "大纲规划",
  "s8-writer": "Solar 分段成稿",
  "s8b-quality-enhancement": "质量增强与图文验证",
  "s9-critic": "Solar 独立红队",
  "s9b-objective-eval": "客观评估",
  "s10-leader-foreword-signoff": "Leader 序言签发",
  "s11-persist": "最终持久化",
};

@Injectable()
export class DeepInsightSolarRunner implements ICapabilityRunner, OnModuleInit {
  readonly manifest = MANIFEST;
  private readonly log = new Logger(DeepInsightSolarRunner.name);
  private readonly bindings: DeepInsightSolarStageBindings;
  private pipelineRegistered = false;

  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly chatFacade: ChatFacade,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly pipelineRegistry: MissionPipelineRegistry,
    private readonly orchestrator: MissionPipelineOrchestrator,
    private readonly reportArtifactAssembler: ReportArtifactAssembler,
    private readonly sectionSelfEval: SectionSelfEvalService,
    private readonly sectionRemediation: SectionRemediationService,
    private readonly reportEvaluation: ReportEvaluationService,
    private readonly qualityTrace: QualityTraceComputeService,
    private readonly figureRelevance: FigureRelevanceService,
    private readonly postmortemClassifier: PostmortemClassifierService,
    @Optional()
    private readonly subprocessSolarOperatorPort?: SubprocessSolarHarnessOperatorPort,
  ) {
    void this.chatFacade;
    const operatorPort: SolarHarnessOperatorPort =
      this.subprocessSolarOperatorPort ?? new SubprocessSolarHarnessOperatorPort();
    this.bindings = new DeepInsightSolarStageBindings(
      this.agentRunner,
      {
        reportArtifactAssembler: this.reportArtifactAssembler,
        sectionSelfEval: this.sectionSelfEval,
        sectionRemediation: this.sectionRemediation,
        reportEvaluation: this.reportEvaluation,
        qualityTrace: this.qualityTrace,
        figureRelevance: this.figureRelevance,
      },
      operatorPort,
    );
  }

  onModuleInit(): void {
    this.capabilityRegistry.register(this);
    this.registerPipeline();
  }

  private registerPipeline(): void {
    if (
      this.pipelineRegistered ||
      this.pipelineRegistry.has(DEEP_INSIGHT_SOLAR_PIPELINE_ID)
    ) {
      this.pipelineRegistered = true;
      return;
    }
    this.pipelineRegistry.register({
      ...DEEP_INSIGHT_SOLAR_PIPELINE,
      id: DEEP_INSIGHT_SOLAR_PIPELINE_ID,
      steps: DEEP_INSIGHT_SOLAR_PIPELINE.steps.map((step) => ({
        ...step,
        hooks: this.bindings.buildHooksForStep(step.id),
      })),
    });
    this.pipelineRegistered = true;
  }

  async run(
    input: CapabilityRunInput,
    ctx: CapabilityRunContext,
  ): Promise<CapabilityRunResult> {
    const topic = input.topic;
    const language = input.language ?? "zh-CN";
    const { userId, missionId } = ctx;
    const persistence: MissionPersistencePort =
      ctx.persistence ?? new InMemoryPersistencePort();
    const runStartedAt = Date.now();
    const bufferedEvents: Array<{ type: string; ts: number }> = [];
    const pushBuffered = (type: string): void => {
      if (bufferedEvents.length >= EVENT_BUFFER_MAX) bufferedEvents.shift();
      bufferedEvents.push({ type, ts: Date.now() });
    };

    let priorPostmortems: AgentInvocation["priorPostmortems"] = [];
    let checkpointResult: Awaited<ReturnType<MissionPersistencePort["loadCheckpoint"]>> =
      null;
    const [recallOutcome, checkpointOutcome] = await Promise.allSettled([
      persistence.recallPostmortems?.({ userId, topic, limit: 3 }),
      persistence.loadCheckpoint(missionId),
    ]);
    if (recallOutcome.status === "fulfilled") {
      priorPostmortems = recallOutcome.value ?? [];
    } else {
      this.log.warn(
        `[deep-insight-solar ${missionId}] recallPostmortems failed: ${this.errMsg(recallOutcome.reason)}`,
      );
    }
    if (checkpointOutcome.status === "fulfilled") {
      checkpointResult = checkpointOutcome.value;
    } else {
      this.log.warn(
        `[deep-insight-solar ${missionId}] loadCheckpoint failed: ${this.errMsg(checkpointOutcome.reason)}`,
      );
    }

    const nativePreferredModelId = resolveDeepInsightSolarNativeModelId(
      input.preferredModelId,
    );
    const invocation: AgentInvocation = {
      userId,
      ...(nativePreferredModelId
        ? { preferredModelId: nativePreferredModelId }
        : {}),
      ...(input.withFigures !== undefined ? { withFigures: input.withFigures } : {}),
      ...(input.knowledgeBaseIds?.length
        ? { knowledgeBaseIds: [...input.knowledgeBaseIds] }
        : {}),
      ...(input.searchTimeRange ? { searchTimeRange: input.searchTimeRange } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.depth ? { depth: input.depth } : {}),
      ...(typeof input.concurrency === "number"
        ? { concurrency: input.concurrency }
        : {}),
      ...(input.audienceProfile ? { audienceProfile: input.audienceProfile } : {}),
      ...(input.styleProfile ? { styleProfile: input.styleProfile } : {}),
      ...(input.lengthProfile ? { lengthProfile: input.lengthProfile } : {}),
      ...(input.auditLayers?.length ? { auditLayers: [...input.auditLayers] } : {}),
      ...(priorPostmortems?.length ? { priorPostmortems } : {}),
      onAgentEvent: (stepId, role, dimension, ev) => {
        try {
          pushBuffered(ev.type);
          this.relayAgentEvent(ctx, stepId, role, dimension, ev);
        } catch {
          // Relay must not break mission execution.
        }
      },
      onEvent: ctx.onEvent,
    };

    const pipelineInput: DeepInsightPipelineInput = {
      topic,
      language,
      invocation,
    };

    let crossStageState = new CrossStageState();
    let resumeFromStepId: string | undefined;
    if (checkpointResult) {
      crossStageState = CrossStageState.fromJSON({
        ...checkpointResult.crossState,
      });
      resumeFromStepId =
        checkpointResult.lastStepId === MISSION_START_CHECKPOINT_ID
          ? undefined
          : checkpointResult.lastStepId;
    }
    if (crossStageState.get<number>(CS_KEY.startedAt) === undefined) {
      crossStageState.set(CS_KEY.startedAt, Date.now());
    }
    if (input.inheritedBaseline && !resumeFromStepId) {
      if (input.inheritedBaseline.plan) {
        crossStageState.set(CS_KEY.plan, input.inheritedBaseline.plan);
      }
      if (input.inheritedBaseline.researcherResults?.length) {
        crossStageState.set(
          CS_KEY.inheritedResearch,
          [...input.inheritedBaseline.researcherResults],
        );
      }
    }

    attachState(missionId, crossStageState);
    attachSolarState(missionId, crossStageState);
    const checkpointCursor: { lastCompletedStepId?: string } = {
      lastCompletedStepId: resumeFromStepId,
    };
    try {
      const result = await this.orchestrator.run<DeepInsightPipelineInput>({
        missionId,
        pipelineId: DEEP_INSIGHT_SOLAR_PIPELINE_ID,
        input: pipelineInput,
        userId,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        ...(resumeFromStepId ? { resumeFromStepId } : {}),
        initialCrossStageState: crossStageState.toJSON(),
        onEvent: (ev) =>
          this.bridgeMissionEvent(
            ctx,
            persistence,
            crossStageState,
            ev,
            topic,
            input,
            pushBuffered,
            checkpointCursor,
          ),
      });

      if (result.status === "completed") {
        const deliverableGate = this.evaluateDeliverableGate(
          topic,
          input,
          crossStageState,
        );
        if (!deliverableGate.ok) {
          const errorMessage = `deliverable-gate-failed：${deliverableGate.reasons.join("；")}；metrics=${JSON.stringify(deliverableGate.metrics)}`;
          await this.applyTerminal(persistence, missionId, "failed", {
            errorMessage,
            report: crossStageState.get(CS_KEY.report),
            reportArtifact: crossStageState.get(CS_KEY.reportArtifact),
            themeSummary: crossStageState.get<{ themeSummary?: string }>(
              CS_KEY.plan,
            )?.themeSummary,
            dimensions: crossStageState.get<{ dimensions?: unknown[] }>(
              CS_KEY.plan,
            )?.dimensions,
            leaderSignOff: crossStageState.get(CS_KEY.leaderSignOff),
            reconciliationReport: crossStageState.get(CS_KEY.reconciliationReport),
            failureCode: "DEEP_INSIGHT_SOLAR_DELIVERABLE_GATE_FAILED",
            tokensUsed: this.usage(crossStageState).totalTokens,
            costCents: this.usage(crossStageState).totalCostCents,
          });
          this.firePostlude({
            missionId,
            userId,
            topic,
            state: crossStageState,
            persistence,
            runStartedAt,
            bufferedEvents,
            onEvent: ctx.onEvent,
            failed: true,
          });
          return {
            status: "failed",
            stageOutputs: this.collectStageOutputs(crossStageState),
            usage: this.usage(crossStageState),
            error: errorMessage,
          };
        }
        return await this.assembleCompleted(
          missionId,
          userId,
          topic,
          crossStageState,
          persistence,
          runStartedAt,
          bufferedEvents,
          ctx.onEvent,
        );
      }

      const errorMessage = this.errMsg(result.error) || "deep-insight-solar pipeline 未完成";
      await this.applyTerminal(
        persistence,
        missionId,
        result.status === "aborted" ? "cancelled" : "failed",
        {
          errorMessage,
          reconciliationReport: crossStageState.get(CS_KEY.reconciliationReport),
          tokensUsed: this.usage(crossStageState).totalTokens,
          costCents: this.usage(crossStageState).totalCostCents,
        },
      );
      this.firePostlude({
        missionId,
        userId,
        topic,
        state: crossStageState,
        persistence,
        runStartedAt,
        bufferedEvents,
        onEvent: ctx.onEvent,
        failed: true,
      });
      return {
        status: "failed",
        stageOutputs: this.collectStageOutputs(crossStageState),
        usage: this.usage(crossStageState),
        error: errorMessage,
      };
    } catch (err) {
      const errorMessage = this.errMsg(err);
      this.log.error(`[deep-insight-solar ${missionId}] run failed: ${errorMessage}`);
      await this.applyTerminal(persistence, missionId, "failed", { errorMessage });
      this.firePostlude({
        missionId,
        userId,
        topic,
        state: crossStageState,
        persistence,
        runStartedAt,
        bufferedEvents,
        onEvent: ctx.onEvent,
        failed: true,
      });
      return {
        status: "failed",
        stageOutputs: this.collectStageOutputs(crossStageState),
        usage: this.usage(crossStageState),
        error: errorMessage,
      };
    } finally {
      detachSolarState(missionId);
      detachState(missionId);
    }
  }

  private async assembleCompleted(
    missionId: string,
    userId: string,
    topic: string,
    state: CrossStageState,
    persistence: MissionPersistencePort,
    runStartedAt: number,
    bufferedEvents: ReadonlyArray<{ type: string; ts: number }>,
    onEvent?: CapabilityRunContext["onEvent"],
  ): Promise<CapabilityRunResult> {
    const report = state.get(CS_KEY.report);
    const reportArtifact = preferReportBodyArtifact(
      state.get(CS_KEY.reportArtifact),
      report,
    );
    state.set(CS_KEY.reportArtifact, reportArtifact);
    const plan = state.get<{
      themeSummary?: string;
      dimensions?: unknown[];
    }>(CS_KEY.plan);
    const leaderSignOff = state.get<{ signed?: boolean; refusalReason?: string }>(
      CS_KEY.leaderSignOff,
    );
    const usage = this.usage(state);
    const finalScore =
      state.get<number>(CS_KEY.finalScore) ??
      state.get<{ score?: number }>(CS_KEY.reviewVerdict)?.score;
    if (leaderSignOff?.signed === false) {
      const errorMessage = `quality-failed：${
        leaderSignOff.refusalReason ?? "Leader 拒绝签字"
      }`;
      await this.applyTerminal(persistence, missionId, "failed", {
        report,
        reportArtifact,
        themeSummary: plan?.themeSummary,
        dimensions: plan?.dimensions,
        leaderSignOff,
        reconciliationReport: state.get(CS_KEY.reconciliationReport),
        ...(finalScore !== undefined ? { finalScore } : {}),
        tokensUsed: usage.totalTokens,
        costCents: usage.totalCostCents,
        errorMessage,
        failureCode: "LEADER_REFUSED_SIGN",
      });
      await persistence.clearCheckpoint(missionId).catch((err) => {
        this.log.warn(
          `[deep-insight-solar ${missionId}] clearCheckpoint failed: ${this.errMsg(err)}`,
        );
      });
      this.firePostlude({
        missionId,
        userId,
        topic,
        state,
        persistence,
        runStartedAt,
        bufferedEvents,
        onEvent,
        failed: true,
      });
      return {
        status: "failed",
        stageOutputs: this.collectStageOutputs(state),
        usage,
        error: errorMessage,
      };
    }

    await this.applyTerminal(persistence, missionId, "completed", {
      report,
      reportArtifact,
      themeSummary: plan?.themeSummary,
      dimensions: plan?.dimensions,
      leaderSignOff,
      verdicts: state.get(CS_KEY.verifierVerdicts),
      reconciliationReport: state.get(CS_KEY.reconciliationReport),
      ...(finalScore !== undefined ? { finalScore } : {}),
      tokensUsed: usage.totalTokens,
      costCents: usage.totalCostCents,
    });
    await persistence.clearCheckpoint(missionId).catch((err) => {
      this.log.warn(
        `[deep-insight-solar ${missionId}] clearCheckpoint failed: ${this.errMsg(err)}`,
      );
    });
    this.firePostlude({
      missionId,
      userId,
      topic,
      state,
      persistence,
      runStartedAt,
      bufferedEvents,
      onEvent,
      failed: false,
    });
      return {
        status: "completed",
        report: this.assembleReport(reportArtifact ?? report),
      references: this.extractReferences(
        state.get<unknown[]>(CS_KEY.researcherResults) ?? [],
      ),
      stageOutputs: this.collectStageOutputs(state),
      usage,
      ...(state.get(CS_KEY.verifierVerdicts)
        ? { verdicts: state.get(CS_KEY.verifierVerdicts) }
        : {}),
      ...(state.get(CS_KEY.reviewVerdict)
        ? { reviewVerdict: state.get(CS_KEY.reviewVerdict) }
        : {}),
    };
  }

  private bridgeMissionEvent(
    ctx: CapabilityRunContext,
    persistence: MissionPersistencePort,
    crossStageState: CrossStageState,
    ev: PipelineMissionEvent,
    topic: string,
    input: CapabilityRunInput,
    pushBuffered: (type: string) => void,
    checkpointCursor: { lastCompletedStepId?: string },
  ): Promise<void> {
    pushBuffered(ev.type);
    const stepId = ev.stepId;
    const label = stepId ? STEP_LABEL[stepId] : undefined;
    const telemetry = stepId ? { systemStageId: stepId } : undefined;
    if (ev.type === "mission:started") {
      return Promise.resolve(ctx.onEvent?.({
        type: "started",
        timestamp: ev.timestamp,
        payload: {
          topic,
          capabilityId: "deep-insight-solar",
          ...(input.depth ? { depth: input.depth } : {}),
          ...(input.language ? { language: input.language } : {}),
        },
      })).then(() => undefined);
    }
    if (ev.type === "stage:started" && stepId) {
      return persistence
        .saveCheckpoint(ctx.missionId, {
          lastStepId:
            checkpointCursor.lastCompletedStepId ?? MISSION_START_CHECKPOINT_ID,
          inFlightStepId: stepId,
          topic,
          crossState: crossStageState.toJSON(),
        })
        .catch((err) => {
          this.log.warn(
            `[deep-insight-solar ${ctx.missionId}] saveCheckpoint(started:${stepId}) failed: ${this.errMsg(err)}`,
          );
          return false;
        })
        .then(() =>
          ctx.onEvent?.({
            type: "stage:started",
            stepId,
            label,
            timestamp: ev.timestamp,
            telemetry,
          }),
        )
        .then(() => undefined);
    }
    if (ev.type === "stage:completed" && stepId) {
      checkpointCursor.lastCompletedStepId = stepId;
      return persistence
        .markStageProgress(ctx.missionId, stepId)
        .catch((err) => {
          this.log.warn(
            `[deep-insight-solar ${ctx.missionId}] markStageProgress(${stepId}) failed: ${this.errMsg(err)}`,
          );
        })
        .then(() =>
          persistence.saveCheckpoint(ctx.missionId, {
            lastStepId: stepId,
            inFlightStepId: null,
            topic,
            crossState: crossStageState.toJSON(),
          }),
        )
        .catch((err) => {
          this.log.warn(
            `[deep-insight-solar ${ctx.missionId}] saveCheckpoint(${stepId}) failed: ${this.errMsg(err)}`,
          );
          return false;
        })
        .then(() =>
          ctx.onEvent?.({
            type: "stage:completed",
            stepId,
            label,
            timestamp: ev.timestamp,
            telemetry,
          }),
        )
        .then(() => undefined);
    }
    if (ev.type === "stage:failed" && stepId) {
      return Promise.resolve(ctx.onEvent?.({
        type: "stage:failed",
        stepId,
        label,
        timestamp: ev.timestamp,
        payload: { error: this.errMsg(ev.error) },
        telemetry,
      })).then(() => undefined);
    }
    if (ev.type === "mission:completed") {
      return Promise.resolve(
        ctx.onEvent?.({ type: "completed", timestamp: ev.timestamp }),
      ).then(() => undefined);
    }
    if (ev.type === "mission:failed") {
      return Promise.resolve(ctx.onEvent?.({
        type: "failed",
        timestamp: ev.timestamp,
        payload: { error: this.errMsg(ev.error) },
      })).then(() => undefined);
    }
    return Promise.resolve();
  }

  private relayAgentEvent(
    ctx: CapabilityRunContext,
    stepId: string,
    role: string,
    dimension: string | undefined,
    ev: IAgentEvent,
  ): void {
    void ctx.onEvent?.({
      type: "agent-trace",
      stepId,
      timestamp: Date.now(),
      payload: {
        kind: ev.type,
        role,
        ...(dimension ? { dimension } : {}),
      },
    });
  }

  private firePostlude(args: {
    missionId: string;
    userId: string;
    topic: string;
    state: CrossStageState;
    persistence: MissionPersistencePort;
    runStartedAt: number;
    bufferedEvents: ReadonlyArray<{ type: string; ts: number }>;
    onEvent?: CapabilityRunContext["onEvent"];
    failed: boolean;
  }): void {
    const deps: SelfEvolutionPostludeDeps = {
      postmortemClassifier: this.postmortemClassifier,
      log: this.log,
    };
    fireSelfEvolutionPostlude(
      {
        missionId: args.missionId,
        userId: args.userId,
        topic: args.topic,
        leaderSignOff: args.failed
          ? args.state.get<{ signed?: boolean }>(CS_KEY.leaderSignOff) ?? null
          : args.state.get<{ signed?: boolean }>(CS_KEY.leaderSignOff) ?? null,
        reportArtifact: args.failed ? null : args.state.get(CS_KEY.reportArtifact) ?? null,
        plan: args.state.get(CS_KEY.plan) ?? null,
        finalScore: args.state.get<number>(CS_KEY.finalScore),
        tokensUsed: this.usage(args.state).totalTokens,
        costCents: this.usage(args.state).totalCostCents,
        startedAt: args.runStartedAt,
        persistence: args.persistence,
        bufferedEvents: args.bufferedEvents,
        onEvent: args.onEvent,
      },
      deps,
    );
  }

  private async applyTerminal(
    persistence: MissionPersistencePort,
    missionId: string,
    outcome: "completed" | "failed" | "cancelled",
    details: MissionTerminalDetails,
  ): Promise<void> {
    await persistence.applyTerminalIfRunning(missionId, outcome, details).catch((err) => {
      this.log.warn(
        `[deep-insight-solar ${missionId}] applyTerminal(${outcome}) failed: ${this.errMsg(err)}`,
      );
      return false;
    });
  }

  private collectStageOutputs(state: CrossStageState): Record<string, unknown> {
    return {
      plan: state.get(CS_KEY.plan),
      researcherResults: state.get(CS_KEY.researcherResults),
      reconciliationReport: state.get(CS_KEY.reconciliationReport),
      analystOutput: state.get(CS_KEY.analystOutput),
      report: state.get(CS_KEY.report),
      reportArtifact: state.get(CS_KEY.reportArtifact),
      reviewVerdict: state.get(CS_KEY.reviewVerdict),
      verifierVerdicts: state.get(CS_KEY.verifierVerdicts),
      leaderSignOff: state.get(CS_KEY.leaderSignOff),
      solar: {
        researchContract: state.get(SOLAR_CS_KEY.researchContract),
        insightKernel: state.get(SOLAR_CS_KEY.insightKernel),
        diagramBriefs: state.get(SOLAR_CS_KEY.diagramBriefs),
        sectionDrafts: state.get(SOLAR_CS_KEY.sectionDrafts),
        redTeamMemo: state.get(SOLAR_CS_KEY.redTeamMemo),
        degradedReasons: state.get(SOLAR_CS_KEY.degradedReasons),
      },
    };
  }

  private evaluateDeliverableGate(
    topic: string,
    input: CapabilityRunInput,
    state: CrossStageState,
  ): DeepInsightSolarDeliverableGateResult {
    return evaluateDeepInsightSolarDeliverable({
      topic,
      ...(input.description ? { description: input.description } : {}),
      ...(input.depth ? { depth: input.depth } : {}),
      ...(input.lengthProfile ? { lengthProfile: input.lengthProfile } : {}),
      plan: state.get(CS_KEY.plan),
      researcherResults: state.get(CS_KEY.researcherResults),
      report: state.get(CS_KEY.report),
      reportArtifact: state.get(CS_KEY.reportArtifact),
    });
  }

  private usage(state: CrossStageState): {
    totalTokens: number;
    totalCostCents: number;
  } {
    return {
      totalTokens: state.get<number>(CS_KEY.tokensUsed) ?? 0,
      totalCostCents: state.get<number>(CS_KEY.costCents) ?? 0,
    };
  }

  private assembleReport(raw: unknown): string | undefined {
    if (raw && typeof raw === "object") {
      const obj = raw as { content?: { fullMarkdown?: string }; fullMarkdown?: string };
      return obj.content?.fullMarkdown ?? obj.fullMarkdown ?? JSON.stringify(raw);
    }
    return typeof raw === "string" ? raw : undefined;
  }

  private extractReferences(
    researcherResults: unknown[],
  ): Array<{ source: string; title?: string; snippet?: string }> {
    const refs = new Map<string, { source: string; title?: string; snippet?: string }>();
    for (const raw of researcherResults) {
      const item = raw as {
        findings?: Array<{
          source?: string;
          sourceTitle?: string;
          sourceSnippet?: string;
        }>;
      };
      for (const finding of item.findings ?? []) {
        if (finding.source && !refs.has(finding.source)) {
          refs.set(finding.source, {
            source: finding.source,
            ...(finding.sourceTitle ? { title: finding.sourceTitle } : {}),
            ...(finding.sourceSnippet ? { snippet: finding.sourceSnippet } : {}),
          });
        }
      }
    }
    return [...refs.values()];
  }

  private errMsg(err: unknown): string {
    if (!err) return "";
    if (err instanceof Error) return err.message;
    return typeof err === "string" ? err : JSON.stringify(err);
  }
}

function hasUsableFindings(findings: unknown): boolean {
  return countUsableFindings(findings) > 0;
}

function countUsableFindings(findings: unknown): number {
  if (!Array.isArray(findings)) return 0;
  return findings.filter((finding) => {
    const item = asRecord(finding);
    return (
      !!asTrimmedString(item?.claim) &&
      !!asTrimmedString(item?.evidence) &&
      !!asTrimmedString(item?.source)
    );
  }).length;
}

function needsLongForm(snapshot: DeepInsightSolarDeliverableSnapshot): boolean {
  const lengthProfile = snapshot.lengthProfile ?? "";
  if (["extended", "epic", "mega", "deep"].includes(lengthProfile)) return true;
  const text = `${snapshot.topic}\n${snapshot.description ?? ""}`;
  return /(?:12\s*,?\s*000|12000|1\.2\s*万|一万二|研讨会|webinar|seminar)/i.test(
    text,
  );
}

function reportToMarkdown(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  const obj = asRecord(raw);
  const direct =
    asTrimmedString(asRecord(obj?.content)?.fullMarkdown) ??
    asTrimmedString(obj?.fullMarkdown);
  if (direct) return direct;
  const parts: string[] = [];
  const title = asTrimmedString(obj?.title);
  const summary = asTrimmedString(obj?.summary);
  const sections = Array.isArray(obj?.sections) ? obj.sections : [];
  if (title) parts.push(`# ${title}`);
  if (summary) parts.push(`## 摘要\n\n${summary}`);
  for (const rawSection of sections) {
    const section = asRecord(rawSection);
    const heading =
      asTrimmedString(section?.heading) ??
      asTrimmedString(section?.title) ??
      "未命名章节";
    const body =
      asTrimmedString(section?.body) ??
      asTrimmedString(section?.content) ??
      "";
    if (body) parts.push(`## ${heading}\n\n${body}`);
  }
  const conclusion = asTrimmedString(obj?.conclusion);
  if (conclusion) parts.push(`## 结论\n\n${conclusion}`);
  return parts.join("\n\n").trim();
}

function scoreSections(sections: unknown[]): number {
  return sections.reduce<number>((sum, raw) => {
    const section = asRecord(raw);
    const title =
      asTrimmedString(section?.title) ??
      asTrimmedString(section?.heading) ??
      "";
    const body =
      asTrimmedString(section?.content) ??
      asTrimmedString(section?.body) ??
      "";
    const missing = /本维度内容缺失|内容缺失|缺失章节|missing content/i.test(
      `${title}\n${body}`,
    );
    const wordCount =
      typeof section?.wordCount === "number"
        ? section.wordCount
        : Math.round(body.length / 2);
    if (missing) return sum - 200;
    if (body.length >= 120 || wordCount >= 80) return sum + 100 + body.length;
    return sum + body.length;
  }, 0);
}

function chooseBestSections(primary: unknown[], candidate: unknown[]): unknown[] {
  if (candidate.length === 0) return primary;
  if (primary.length === 0) return candidate;
  return scoreSections(candidate) > scoreSections(primary) ? candidate : primary;
}

function preferReportBodyArtifact(artifact: unknown, report: unknown): unknown {
  const reportMarkdown = reportToMarkdown(report);
  if (!reportMarkdown) return artifact;
  const artifactObj = asRecord(artifact);
  const content = asRecord(artifactObj?.content);
  const artifactMarkdown = asTrimmedString(content?.fullMarkdown) ?? "";
  if (artifactMarkdown.length >= reportMarkdown.length) return artifact;
  const reportObj = asRecord(report);
  const reportSections = Array.isArray(reportObj?.sections) ? reportObj.sections : [];
  const artifactSections = Array.isArray(artifactObj?.sections) ? artifactObj.sections : [];
  return {
    ...(artifactObj ?? {}),
    title:
      asTrimmedString(artifactObj?.title) ??
      asTrimmedString(reportObj?.title) ??
      "Solar 强模型深度洞察报告",
    content: {
      ...(content ?? {}),
      fullMarkdown: reportMarkdown,
      fullReportSize: Buffer.byteLength(reportMarkdown, "utf8"),
    },
    sections: chooseBestSections(artifactSections, reportSections),
    metadata: {
      ...(asRecord(artifactObj?.metadata) ?? {}),
      solarReportBodyRecovered: true,
      solarReportBodyRecoveredAt: new Date().toISOString(),
      previousFullMarkdownChars: artifactMarkdown.length,
      recoveredFullMarkdownChars: reportMarkdown.length,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

class InMemoryPersistencePort implements MissionPersistencePort {
  private checkpoint: {
    lastStepId: string;
    inFlightStepId?: string | null;
    topic: string;
    crossState: Readonly<Record<string, unknown>>;
  } | null = null;

  markStageProgress(): Promise<void> {
    return Promise.resolve();
  }

  saveCheckpoint(
    _missionId: string,
    snapshot: {
      lastStepId: string;
      inFlightStepId?: string | null;
      topic: string;
      crossState: Readonly<Record<string, unknown>>;
    },
  ): Promise<boolean> {
    this.checkpoint = snapshot;
    return Promise.resolve(true);
  }

  loadCheckpoint(): Promise<{
    lastStepId: string;
    inFlightStepId?: string | null;
    topic: string;
    crossState: Readonly<Record<string, unknown>>;
  } | null> {
    return Promise.resolve(this.checkpoint);
  }

  clearCheckpoint(): Promise<void> {
    this.checkpoint = null;
    return Promise.resolve();
  }

  applyTerminalIfRunning(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
