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

    const invocation: AgentInvocation = {
      userId,
      ...(input.preferredModelId ? { preferredModelId: input.preferredModelId } : {}),
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
        const researcherResults =
          crossStageState.get<unknown[]>(CS_KEY.researcherResults) ?? [];
        if (researcherResults.length === 0) {
          const errorMessage =
            "调研阶段未产出有效结果：Solar 实验线保留 S3 researcher，因此不能在无证据时伪装成功。";
          await this.applyTerminal(persistence, missionId, "failed", {
            errorMessage,
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
    const reportArtifact = state.get(CS_KEY.reportArtifact);
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
