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
import {
  RESEARCH_OS_ASSET_TYPES,
  RESEARCH_OS_SCHEMA_VERSION,
  buildLegacyPlanFromTechnologyInsightPlan,
  evaluateInsightRubric,
  evaluateResearchCoverage,
  mergeResearchAssetLedgers,
  normalizeReportPackage,
  normalizeResearchAssetLedger,
  normalizeTechnologyInsightPlan,
  normalizeThesisGraph,
  reportPackageToWriterReport,
  type CoverageReport,
  type ResearchOsAssetType,
  type ResearchAssetLedger,
  type TechnologyInsightPlan,
  type ThesisGraph,
} from "../../research-os";

const SOLAR_PIPELINE_ID = "deep-insight-solar";
const PROMPT_VERSION = "deep-insight-solar.research-os.v1";
const OUTPUT_SCHEMA_VERSION = RESEARCH_OS_SCHEMA_VERSION;
const DEFAULT_SOLAR_OUTLINE_TIMEOUT_MS = 180_000;
const MIN_RESEARCH_OS_WORKSTREAMS = 6;
const DEFAULT_FLOW_CONTROL_RETRY_ATTEMPTS = 3;
const DEFAULT_FLOW_CONTROL_MAX_WAIT_MS = 15 * 60_000;
const DEFAULT_FLOW_CONTROL_FALLBACK_WAIT_MS = 5 * 60_000;
const DEFAULT_S3_RESEARCHER_ATTEMPTS = 2;
const DEFAULT_ANALYST_PACKET_TARGET_CHARS = 9_000;
const DEFAULT_ANALYST_PACKET_HARD_CAP_CHARS = 12_000;
const RESEARCH_OS_ASSET_TYPE_SET = new Set<string>(RESEARCH_OS_ASSET_TYPES);

type AnalystInputPacket = Record<string, unknown> & {
  budget: {
    originalPayloadChars: number;
    packetChars: number;
    targetChars: number;
    hardCapChars: number;
    compressed: boolean;
    overHardCap: boolean;
    assetCount: number;
    includedAssetCount: number;
    researcherResultCount: number;
    profile: string;
    droppedFields: string[];
  };
};

function isResearchOsAssetType(value: string | undefined): value is ResearchOsAssetType {
  return !!value && RESEARCH_OS_ASSET_TYPE_SET.has(value);
}

export const SOLAR_CS_KEY = {
  technologyInsightPlan: "deep-insight-solar.technologyInsightPlan",
  researchContract: "deep-insight-solar.researchContract",
  researchAssetLedger: "deep-insight-solar.researchAssetLedger",
  coverageReport: "deep-insight-solar.coverageReport",
  repairPackets: "deep-insight-solar.repairPackets",
  thesisGraph: "deep-insight-solar.thesisGraph",
  writerBrief: "deep-insight-solar.writerBrief",
  reportPackage: "deep-insight-solar.reportPackage",
  insightRubricResult: "deep-insight-solar.insightRubricResult",
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
const DEFAULT_SOLAR_NATIVE_MODEL_ID = "deepseek-v4-pro";

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
      case "s3-researcher-collect":
        return this.buildSolarResearcherHooks();
      case "s4-leader-assess":
        return this.buildSolarCoverageGateHooks();
      case "s6-analyst":
        return this.buildSolarAnalystHooks();
      case "s7-writer-outline":
        return this.buildSolarOutlineHooks();
      case "s8-writer":
        return this.buildSolarWriterHooks();
      case "s9-critic":
        return this.buildSolarCriticHooks();
      case "s9b-objective-eval":
        return this.buildSolarObjectiveEvalHooks();
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

  private withSolarNativeModel(ctx: StageRunArgs["ctx"]): StageRunArgs["ctx"] {
    const input = readPipelineInput(ctx);
    const explicit = input.invocation.preferredModelId?.trim();
    if (explicit && /deepseek/i.test(explicit) && !/flash/i.test(explicit)) {
      return ctx;
    }
    const configured =
      process.env.DEEP_INSIGHT_SOLAR_NATIVE_MODEL_ID?.trim() ||
      DEFAULT_SOLAR_NATIVE_MODEL_ID;
    return {
      ...ctx,
      input: {
        ...input,
        invocation: {
          ...input.invocation,
          preferredModelId: configured,
        },
      },
    };
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
            requiredOutput:
              "TechnologyInsightPlan { centralQuestion, userIntentAnalysis { originalAsk, decisionNeed, audienceUse, successCriteria[] }, initialTheses, researchQuestions, workstreams, mandatoryArtifacts, sourcePolicy, coverageRequirements, falsificationQuestions }",
          },
        });
        const technologyInsightPlan = normalizeTechnologyInsightPlan(
          result.structured,
          { topic: input.topic, ...(result.markdown ? { markdown: result.markdown } : {}) },
        );
        if (technologyInsightPlan.workstreams.length < MIN_RESEARCH_OS_WORKSTREAMS) {
          throw new Error(
            `[deep-insight-solar] BrowserLeaderPlanner returned ${technologyInsightPlan.workstreams.length} workstreams; minimum is ${MIN_RESEARCH_OS_WORKSTREAMS}.`,
          );
        }
        const plan = buildLegacyPlanFromTechnologyInsightPlan(technologyInsightPlan);
        const compatibilityPlan =
          plan.dimensions.length > 0
            ? plan
            : this.normalizeResearchContract(result.structured, result.markdown, input);
        crossStageState.set(SOLAR_CS_KEY.technologyInsightPlan, technologyInsightPlan);
        crossStageState.set(SOLAR_CS_KEY.researchContract, result.structured ?? plan);
        crossStageState.set(CS_KEY.plan, compatibilityPlan);
        crossStageState.set(CS_KEY.goals, {
          coreQuestion: input.topic,
          qualityBar: { minCoverage: 0.75, minSourceDiversity: 3 },
          constraints: [
            "TechnologyInsightPlan required",
            "ResearchAssetLedger required",
            "ThesisGraph required",
            "evidence-backed report required",
          ],
        });
        crossStageState.set(CS_KEY.leaderJournal, [
          {
            phase: "s2-solar-plan",
            decision: "technology-insight-plan-created",
            at: new Date().toISOString(),
            dimensions: compatibilityPlan.dimensions.map((d) => d.name),
            mandatoryArtifacts: technologyInsightPlan.mandatoryArtifacts,
          },
        ]);
        emitDomain(input.invocation.onEvent, "leader:goals-set", {
          source: "solar-browser-agent",
          dimensions: compatibilityPlan.dimensions,
          technologyInsightPlan,
          modelStrategy: this.modelStrategy(input),
          goals: crossStageState.get(CS_KEY.goals),
        });
        return compatibilityPlan;
      },
    });
  }

  private buildSolarResearcherHooks(): ResolvedStageHooks {
    return defineStageHooks({
      fanOut: (args: { ctx: StageRunArgs["ctx"] }): ReadonlyArray<unknown> => {
        const { input, crossStageState } = this.fullArgs(args.ctx);
        const technologyInsightPlan = crossStageState.get<TechnologyInsightPlan>(
          SOLAR_CS_KEY.technologyInsightPlan,
        );
        const plan = crossStageState.get<PlanShape>(CS_KEY.plan);
        if (!plan && !technologyInsightPlan) {
          throw new Error("[s3-researcher-collect] 无 plan（s2 未产出）");
        }
        const researchItems =
          technologyInsightPlan?.workstreams.map((workstream) => ({
            id: workstream.id,
            name: workstream.name,
            rationale: workstream.objective,
            assetTypes: workstream.assetTypes,
            researchOsWorkstream: true,
          })) ??
          (plan?.dimensions ?? []);
        emitDomain(input.invocation.onEvent, "agent:narrative", {
          stage: "s3-researcher-collect",
          role: "solar-browser-researcher",
          tag: "info",
          text: `Solar BrowserResearcher 将串行调研 ${researchItems.length} 个 Research OS workstream，避免同一 ChatGPT 账号并发触发流控`,
        });
        return [researchItems];
      },
      perItemPipeline: async (args: {
        item: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const { missionId, input, crossStageState } = this.fullArgs(args.ctx);
        const rawDimensions = Array.isArray(args.item) ? args.item : [args.item];
        const researchers: ResearcherShape[] = [];
        for (const rawDimension of rawDimensions) {
          const dim = asRecord(rawDimension);
          const dimension = {
            id: asString(dim?.id) ?? asString(dim?.name) ?? "solar-dim",
            name: asString(dim?.name) ?? asString(dim?.title) ?? "Solar 研究维度",
            rationale: asString(dim?.rationale) ?? asString(dim?.description) ?? "",
          };
          const inherited = crossStageState.get<ResearcherShape[]>(
            CS_KEY.inheritedResearch,
          );
          const reused = inherited?.find((result) => result.dimension === dimension.name);
          if (reused) {
            crossStageState.append<ResearcherShape>(CS_KEY.researcherResults, reused);
            this.emitResearchCompleted(input, dimension.name, reused, true);
            researchers.push(reused);
            continue;
          }

          emitDomain(input.invocation.onEvent, "dimension:research:started", {
            dimension: dimension.name,
            stepId: "s3-researcher-collect",
          });
          let researcher: ResearcherShape | undefined;
          let lastResearcherError: unknown;
          const maxResearcherAttempts = this.s3ResearcherAttempts();
          for (let attempt = 1; attempt <= maxResearcherAttempts; attempt += 1) {
            try {
              const result = await this.invokeOperator({
                input,
                crossStageState,
                stepId: "s3-researcher-collect",
                operatorId: "BrowserResearcher",
                missionId,
                payload: {
                  topic: input.topic,
                  dimension,
                  workstream: dimension,
                  description: input.invocation.description,
                  language: input.language,
                  searchTimeRange: input.invocation.searchTimeRange,
                  knowledgeBaseIds: input.invocation.knowledgeBaseIds ?? [],
                  requiredOutput:
                    "ResearchAssetLedger with evidenceCard, evolutionEvent, stackNode, interfaceEdge, actorCard, sotaFinding, bottleneckCard, contradiction, weakSignal, opportunityHypothesis; also include legacy findings[{claim,evidence,source}] for compatibility.",
                },
              });
              const workstreamLedger = normalizeResearchAssetLedger(
                result.structured,
                {
                  workstreamId: dimension.id,
                  workstreamName: dimension.name,
                  assetTypes: arrayFromUnknown(asRecord(dimension)?.assetTypes)
                    .map((item) => asString(item))
                    .filter((item): item is ResearchOsAssetType =>
                      isResearchOsAssetType(item),
                    ),
                  ...(result.markdown ? { markdown: result.markdown } : {}),
                },
              );
              const existingLedger = crossStageState.get<ResearchAssetLedger>(
                SOLAR_CS_KEY.researchAssetLedger,
              );
              const mergedLedger = mergeResearchAssetLedgers([
                existingLedger,
                workstreamLedger,
              ]);
              crossStageState.set(SOLAR_CS_KEY.researchAssetLedger, mergedLedger);
              crossStageState.set(
                SOLAR_CS_KEY.evidenceLedger,
                mergedLedger.evidenceCards,
              );
              researcher = this.normalizeResearcherResult(
                result.structured,
                result.markdown,
                dimension.name,
                input,
              );
              lastResearcherError = undefined;
              break;
            } catch (err) {
              lastResearcherError = err;
              if (
                attempt >= maxResearcherAttempts ||
                this.isNonRetryableResearcherError(err)
              ) {
                break;
              }
              emitDomain(input.invocation.onEvent, "agent:narrative", {
                stage: "s3-researcher-collect",
                role: "solar-browser-researcher",
                tag: "warning",
                dimension: dimension.name,
                text: `维度"${dimension.name}"调研第 ${attempt} 次失败，将自动重试：${formatErrorMessage(err)}`,
              });
            }
          }
          if (!researcher) {
            const errorMessage = formatErrorMessage(lastResearcherError);
            emitDomain(input.invocation.onEvent, "dimension:graded", {
              dimension: dimension.name,
              overall: 0,
              grade: "F",
              summary: `Solar BrowserResearcher failed: ${errorMessage}`,
              state: "failed",
              action: "failed",
            });
            emitDomain(input.invocation.onEvent, "agent:narrative", {
              stage: "s3-researcher-collect",
              role: "solar-browser-researcher",
              tag: "error",
              dimension: dimension.name,
              text: `维度"${dimension.name}"调研失败，已停止流水线，等待断点续跑：${errorMessage}`,
            });
            throw new Error(
              `[deep-insight-solar] BrowserResearcher failed for ${dimension.name}: ${errorMessage}`,
            );
          }
          if (countUsableResearchFindings(researcher.findings) <= 0) {
            emitDomain(input.invocation.onEvent, "dimension:graded", {
              dimension: dimension.name,
              overall: 0,
              grade: "F",
              summary: "Solar BrowserResearcher 未产出 claim/evidence/source findings",
              state: "failed",
              action: "failed",
            });
            emitDomain(input.invocation.onEvent, "agent:narrative", {
              stage: "s3-researcher-collect",
              role: "solar-browser-researcher",
              tag: "error",
              dimension: dimension.name,
              text: `维度"${dimension.name}"采集失败（Solar BrowserResearcher 未产出可用 findings）`,
            });
            crossStageState.append<ResearcherShape>(
              CS_KEY.researcherResults,
              researcher,
            );
            researchers.push(researcher);
            continue;
          }
          crossStageState.append<ResearcherShape>(
            CS_KEY.researcherResults,
            researcher,
          );
          this.emitResearchCompleted(input, dimension.name, researcher, false);
          researchers.push(researcher);
        }
        return Array.isArray(args.item) ? researchers : researchers[0];
      },
      onPatchFailure: (_args: { item: unknown; error: unknown }): void => {
        // Provider/operator 失败停在 S3，避免坏资产流继续写出伪完成报告。
      },
    });
  }

  private buildSolarCoverageGateHooks(): ResolvedStageHooks {
    const baselineHooks = this.baseline.buildHooksForStep("s4-leader-assess");
    return defineStageHooks({
      ...baselineHooks,
      runRole: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const baselineRunRole = (baselineHooks as {
          runRole?: (args: { ctx: StageRunArgs["ctx"] }) => Promise<unknown> | unknown;
        }).runRole;
        const baselineOutput = baselineRunRole
          ? await baselineRunRole(args)
          : { decision: "accept-all" };
        const { input, crossStageState } = this.fullArgs(args.ctx);
        const coverageReport = this.refreshResearchCoverage(crossStageState);
        emitDomain(input.invocation.onEvent, "agent:narrative", {
          stage: "s4-leader-assess",
          role: "solar-research-os-coverage-gate",
          tag: coverageReport.ok ? "success" : "warning",
          text: coverageReport.ok
            ? "Research OS 资产覆盖检查通过"
            : `Research OS 资产覆盖检查发现 ${coverageReport.blockers.length} 个 blocker，已生成 ${coverageReport.repairPackets.length} 个 repair packet`,
        });
        return {
          ...(isPlainRecord(baselineOutput) ? baselineOutput : { output: baselineOutput }),
          researchOsCoverage: coverageReport,
        };
      },
    });
  }

  private refreshResearchCoverage(
    crossStageState: CrossStageState,
  ): CoverageReport {
    const technologyInsightPlan = crossStageState.get<TechnologyInsightPlan>(
      SOLAR_CS_KEY.technologyInsightPlan,
    );
    const researchAssetLedger = crossStageState.get<ResearchAssetLedger>(
      SOLAR_CS_KEY.researchAssetLedger,
    );
    const coverageReport = evaluateResearchCoverage(
      technologyInsightPlan,
      researchAssetLedger,
    );
    crossStageState.set(SOLAR_CS_KEY.coverageReport, coverageReport);
    crossStageState.set(SOLAR_CS_KEY.repairPackets, coverageReport.repairPackets);
    return coverageReport;
  }

  private buildSolarAnalystHooks(): ResolvedStageHooks {
    return defineStageHooks({
      synthesize: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const { missionId, input, crossStageState } = this.fullArgs(args.ctx);
        const plan = crossStageState.get<PlanShape>(CS_KEY.plan);
        const technologyInsightPlan = crossStageState.get<TechnologyInsightPlan>(
          SOLAR_CS_KEY.technologyInsightPlan,
        );
        const researchAssetLedger = crossStageState.get<ResearchAssetLedger>(
          SOLAR_CS_KEY.researchAssetLedger,
        );
        const coverageReport = this.refreshResearchCoverage(crossStageState);
        const researcherResults =
          crossStageState.get<ResearcherShape[]>(CS_KEY.researcherResults) ?? [];
        const reconciliation = crossStageState.get(CS_KEY.reconciliationReport);
        const analystInputPacket = buildAnalystInputPacket({
          topic: input.topic,
          technologyInsightPlan,
          researchAssetLedger,
          coverageReport,
          plan,
          researcherResults,
          reconciliation,
        });
        emitDomain(input.invocation.onEvent, "stage:metrics", {
          stepId: "s6-analyst",
          source: "deep-insight-solar.analyst-input-packet",
          originalPayloadChars: analystInputPacket.budget.originalPayloadChars,
          packetChars: analystInputPacket.budget.packetChars,
          targetChars: analystInputPacket.budget.targetChars,
          hardCapChars: analystInputPacket.budget.hardCapChars,
          compressed: analystInputPacket.budget.compressed,
          assetCount: analystInputPacket.budget.assetCount,
          includedAssetCount: analystInputPacket.budget.includedAssetCount,
          researcherResultCount: analystInputPacket.budget.researcherResultCount,
        });
        let result: SolarOperatorResult | undefined;
        let analystDegradedReason: string | undefined;
        try {
          result = await this.invokeOperator({
            input,
            crossStageState,
            stepId: "s6-analyst",
            operatorId: "BrowserAnalyst",
            missionId,
            payload: {
              topic: input.topic,
              analystInputPacket,
              requiredOutput:
                "ThesisGraph { theses[], claimEdges[], evidenceBindings[], counterEvidence[], openQuestions[], reportOutline[] } plus optional diagramBriefs.",
            },
          });
        } catch (err) {
          if (!isBrowserAnalystGeneratingWithoutOutputError(err)) {
            throw err;
          }
          analystDegradedReason = formatErrorMessage(err);
          result = {
            status: "degraded",
            structured: buildFallbackThesisGraphFromLedger(
              input.topic,
              technologyInsightPlan,
              researchAssetLedger,
            ),
            markdown: "",
            evidence: researchAssetLedger?.evidenceCards ?? [],
            metrics: {
              provider: "local_fallback",
              reason: "browser_analyst_generating_without_output",
            },
          };
          const existing =
            crossStageState.get<Array<Record<string, unknown>>>(
              SOLAR_CS_KEY.degradedReasons,
            ) ?? [];
          crossStageState.set(SOLAR_CS_KEY.degradedReasons, [
            ...existing,
            {
              stepId: "s6-analyst",
              operatorId: "BrowserAnalyst",
              reason: "browser_analyst_generating_without_output",
              error: analystDegradedReason,
              at: new Date().toISOString(),
            },
          ]);
          emitDomain(input.invocation.onEvent, "agent:narrative", {
            stage: "s6-analyst",
            role: "solar-browser-analyst",
            tag: "warn",
            text: "S6 BrowserAnalyst 长时间无输出，已使用 ResearchAssetLedger 生成降级 ThesisGraph 继续流水线。",
          });
        }
        const thesisGraph = normalizeThesisGraph(result.structured, {
          topic: input.topic,
          ...(researchAssetLedger ? { ledger: researchAssetLedger } : {}),
        });
        const writerBrief = buildWriterBriefForPublicWriter(
          result.structured,
          input.topic,
          technologyInsightPlan,
          thesisGraph,
          researchAssetLedger,
        );
        crossStageState.set(SOLAR_CS_KEY.thesisGraph, thesisGraph);
        crossStageState.set(SOLAR_CS_KEY.writerBrief, writerBrief);
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

  private buildSolarOutlineHooks(): ResolvedStageHooks {
    const baselineHooks = this.baseline.buildHooksForStep("s7-writer-outline");
    const baselineDraftOnce = baselineHooks.draftOnce;
    return defineStageHooks({
      draftOnce: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const { input, crossStageState } = this.fullArgs(args.ctx);
        if (typeof baselineDraftOnce !== "function") {
          crossStageState.set(CS_KEY.outlinePlan, null);
          emitDomain(input.invocation.onEvent, "agent:narrative", {
            stage: "s7-writer-outline",
            role: "writer",
            tag: "warn",
            text: "Solar outline wrapper 未找到原生 S7 hook，降级为由 S8 直接规划章节。",
          });
          return null;
        }

        const timeoutMs = resolveSolarOutlineTimeoutMs();
        try {
          return await withTimeout(
            Promise.resolve(
              baselineDraftOnce(args as unknown as never) as Promise<unknown>,
            ),
            timeoutMs,
          );
        } catch (err) {
          if (!isSolarOutlineTimeout(err)) throw err;
          crossStageState.set(CS_KEY.outlinePlan, null);
          emitDomain(input.invocation.onEvent, "agent:narrative", {
            stage: "s7-writer-outline",
            role: "writer",
            tag: "warn",
            text: `Solar S7 原生大纲规划超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已降级为由 S8 强模型写作阶段直接规划章节。`,
          });
          return null;
        }
      },
    });
  }

  private buildSolarWriterHooks(): ResolvedStageHooks {
    return defineStageHooks({
      draftOnce: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const { missionId, input, crossStageState } = this.fullArgs(args.ctx);
        const researchAssetLedger = crossStageState.get<ResearchAssetLedger>(
          SOLAR_CS_KEY.researchAssetLedger,
        );
        const thesisGraph = crossStageState.get<ThesisGraph>(SOLAR_CS_KEY.thesisGraph);
        const writerBrief =
          crossStageState.get<Record<string, unknown>>(SOLAR_CS_KEY.writerBrief) ??
          buildWriterBriefForPublicWriter(
            undefined,
            input.topic,
            crossStageState.get<TechnologyInsightPlan>(SOLAR_CS_KEY.technologyInsightPlan),
            thesisGraph,
            researchAssetLedger,
          );
        const researcherResults =
          crossStageState.get<ResearcherShape[]>(CS_KEY.researcherResults) ?? [];
        const diagramBriefs = normalizeDiagramBriefs(
          crossStageState.get(SOLAR_CS_KEY.diagramBriefs),
          thesisGraph,
          input.topic,
        );
        const sourceFigureCandidates = collectSourceFigureCandidates(
          researcherResults,
          researchAssetLedger,
        );
        crossStageState.set(SOLAR_CS_KEY.diagramBriefs, diagramBriefs);
        const result = await this.invokeOperator({
          input,
          crossStageState,
          stepId: "s8-writer",
          operatorId: "BrowserLongformWriter",
          missionId,
          payload: {
            topic: input.topic,
            writerBrief: {
              ...writerBrief,
              diagramBriefs,
              sourceFigureCandidates,
            },
            diagramBriefs,
            sourceFigureCandidates,
            instruction:
              [
                "Write the finished reader-facing report from writerBrief only.",
                "Mandatory structure: start with '## 需求理解：本次分析要回答什么', then '## 内容规划：如何展开这份洞察', then a multi-section '## 分步骤洞察' body, and end with '## 综合判断与行动建议'.",
                "In the demand-understanding section, explain the user's decision need, expected external audience use, and what the reader should gain after reading. Do not apologize or describe internal workflow.",
                "In the content-plan section, tell the reader why the report is organized by these lenses and how each lens contributes to the final judgment.",
                "In the content-plan or stepwise-insight sections, explicitly plan where figures belong. Use sourceFigureCandidates for source figures when available and diagramBriefs for generated technical diagrams.",
                "When a figure is useful, insert a reader-facing figure slot near the relevant section using Markdown image syntax and a caption. Do not leave figures only in metadata.",
                "In the stepwise-insight body, every step must have a clear claim, mechanism, evidence or example, implication, and what it changes in the final answer.",
                "The final synthesis must leave the reader with memorable takeaways, investment-hotspot taxonomy, and next actions; it must not end as a caveat dump.",
                "Open with the strongest substantive conclusion, then develop the argument through concrete mechanisms, source material, limiting conditions, and implications.",
                "Length target: produce at least 6 substantive reader-facing sections and at least 6500 Chinese characters in the main standard report; expand thin sections instead of returning an executive memo.",
                "Entity boundary rule: if the topic is ambiguous or category-like, normalize the research object naturally and do not invent facts for a single legal entity. For Neo Labs / neo-labs topics, treat it as the US research-first AI lab ecosystem unless writerBrief proves a specific company.",
                "Make the report intellectually useful: include a concrete investment-hotspot map, company/actor comparisons, technical control points, non-obvious disagreements, and what would change the thesis.",
                "Use domain-specific headings that name the technology object, market structure, system mechanism, or strategic tension being analyzed.",
                "Audience: external executives, customers, investors, or conference listeners. Write as a polished briefing document, not as an analyst scratchpad.",
                "Do not add planning notes, review notes, process notes, placeholders, apologies, or explanations of how the report was made.",
                "Never write self-referential framing such as 'this report will', 'we first need to', 'should not be written as', 'do not call it', 'needs gating', 'entity gate', 'the text should', or 'the report should'. Convert those into direct reader-facing judgments.",
                "Uncertainty must sound like an external research report: use concrete limiting language such as 'public evidence is still thin', 'this remains an adoption risk', or 'the investment case depends on...', not internal instructions like 'needs verification' or 'should be checked'.",
                "Do not expose internal ids such as asset-*, evidence-*, claim-* or field names such as gate, ledger, workstream, sourceNotes, writerBrief, or ThesisGraph in reader-facing prose.",
                "If a claim in the brief is weakly supported, narrow it in prose or omit it.",
                "End references as a source-confidence table, not as a bare numbered list. Columns should include source/material, confidence, supported judgment, and URL when available.",
              ].join(" "),
          },
        });
        const baseReportPackage = normalizeReportPackage(
          result.structured,
          result.markdown,
          {
            topic: input.topic,
            ...(researchAssetLedger ? { ledger: researchAssetLedger } : {}),
            ...(thesisGraph ? { thesisGraph } : {}),
          },
        );
        const diagramArtifacts = await this.generateTechnologyDiagramArtifacts({
          input,
          crossStageState,
          missionId,
          diagramBriefs,
          sourceFigureCandidates,
          reportMarkdown: baseReportPackage.standardReportMarkdown,
        });
        const reportPackage = {
          ...baseReportPackage,
          standardReportMarkdown: ensureReportFigureSlots(
            baseReportPackage.standardReportMarkdown,
            diagramBriefs,
            sourceFigureCandidates,
            diagramArtifacts,
          ),
        };
        const report = reportPackageToWriterReport(reportPackage, {
          topic: input.topic,
        });
        crossStageState.set(SOLAR_CS_KEY.reportPackage, reportPackage);
        crossStageState.set(SOLAR_CS_KEY.sectionDrafts, result.structured ?? reportPackage);
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
        const writerReport = args.artifact as WriterReportShape | undefined;
        const existingManifest = asRecord(
          crossStageState.get(SOLAR_CS_KEY.artifactManifest),
        );
        const diagramBriefs = normalizeDiagramBriefs(
          crossStageState.get(SOLAR_CS_KEY.diagramBriefs),
          crossStageState.get<ThesisGraph>(SOLAR_CS_KEY.thesisGraph),
          input.topic,
        );
        const manifestSourceFigureCandidates = recordArrayFromUnknown(
          existingManifest?.sourceFigureCandidates,
        );
        const sourceFigureCandidates =
          manifestSourceFigureCandidates.length > 0
            ? manifestSourceFigureCandidates
            : collectSourceFigureCandidates(
                researcherResults,
                crossStageState.get<ResearchAssetLedger>(
                  SOLAR_CS_KEY.researchAssetLedger,
                ),
              );
        const diagramArtifacts = recordArrayFromUnknown(existingManifest?.artifacts);
        try {
          const assembledArtifact = this.rich.reportArtifactAssembler.assemble(
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
              writerReport,
              reconciliation,
              usage: {
                totalTokens: crossStageState.get<number>(CS_KEY.tokensUsed) ?? 0,
                totalCostCents: crossStageState.get<number>(CS_KEY.costCents) ?? 0,
                generationTimeMs: Math.max(0, Date.now() - startedAt),
              },
              modelTrail: crossStageState.get<string[]>(CS_KEY.modelTrail) ?? [],
            }),
          );
          const artifact = attachResearchOsMetadata(
            recoverSolarWriterBody(assembledArtifact, writerReport),
            {
              technologyInsightPlan: crossStageState.get(
                SOLAR_CS_KEY.technologyInsightPlan,
              ),
              researchAssetLedger: crossStageState.get(
                SOLAR_CS_KEY.researchAssetLedger,
              ),
              coverageReport: crossStageState.get(SOLAR_CS_KEY.coverageReport),
              thesisGraph: crossStageState.get(SOLAR_CS_KEY.thesisGraph),
              reportPackage: crossStageState.get(SOLAR_CS_KEY.reportPackage),
              artifactManifest: crossStageState.get(SOLAR_CS_KEY.artifactManifest),
            },
          );
          const artifactWithFigures = ensureReportArtifactFigureSlots(artifact, {
            diagramBriefs,
            sourceFigureCandidates,
            diagramArtifacts,
          });
          crossStageState.set(CS_KEY.reportArtifact, artifactWithFigures);
          crossStageState.set(SOLAR_CS_KEY.artifactManifest, {
            diagramBriefs,
            artifacts: diagramArtifacts,
            sourceFigureCandidates,
            assembledAt: new Date().toISOString(),
          });
          return Promise.resolve(artifactWithFigures);
        } catch {
          const artifact = attachResearchOsMetadata(
            recoverSolarWriterBody(args.artifact, writerReport),
            {
              technologyInsightPlan: crossStageState.get(
                SOLAR_CS_KEY.technologyInsightPlan,
              ),
              researchAssetLedger: crossStageState.get(
                SOLAR_CS_KEY.researchAssetLedger,
              ),
              coverageReport: crossStageState.get(SOLAR_CS_KEY.coverageReport),
              thesisGraph: crossStageState.get(SOLAR_CS_KEY.thesisGraph),
              reportPackage: crossStageState.get(SOLAR_CS_KEY.reportPackage),
              artifactManifest: crossStageState.get(SOLAR_CS_KEY.artifactManifest),
            },
          );
          const artifactWithFigures = ensureReportArtifactFigureSlots(artifact, {
            diagramBriefs,
            sourceFigureCandidates,
            diagramArtifacts,
          });
          crossStageState.set(CS_KEY.reportArtifact, artifactWithFigures);
          return Promise.resolve(artifactWithFigures);
        }
      },
    });
  }

  private buildSolarObjectiveEvalHooks(): ResolvedStageHooks {
    const baselineHooks = this.baseline.buildHooksForStep("s9b-objective-eval");
    return defineStageHooks({
      review: async (args: { ctx: StageRunArgs["ctx"] }): Promise<unknown> => {
        const review = baselineHooks.review;
        if (typeof review !== "function") return undefined;
        return review({
          ...args,
          ctx: this.withSolarNativeModel(args.ctx),
        } as never);
      },
      objectiveEvalInjection: async (args: {
        verdict: unknown;
        ctx: StageRunArgs["ctx"];
      }): Promise<unknown> => {
        const inject = baselineHooks.objectiveEvalInjection;
        if (typeof inject !== "function") return args.verdict;
        return inject({
          ...args,
          ctx: this.withSolarNativeModel(args.ctx),
        } as never);
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
        let memo: {
          criticalIssues: string[];
          recommendations: string[];
          publishDecision?: string;
          markdown?: string;
        };
        try {
          const result = await this.invokeOperator({
            input,
            crossStageState,
            stepId: "s9-critic",
            operatorId: "BrowserCritic",
            missionId,
            payload: {
              topic: input.topic,
              artifactSummary: buildCriticArtifactSummary(artifact, input.topic),
              reportPackage: publicReportPackageForCritic(
                crossStageState.get(SOLAR_CS_KEY.reportPackage),
              ),
              instruction:
                "Review only the reader-facing report. Identify shallow, mechanical, unsupported, self-referential, or backstage-process language and recommend concrete edits.",
            },
          });
          memo = this.normalizeRedTeamMemo(result.structured, result.markdown);
        } catch (err) {
          if (!isBrowserCriticNoOutputError(err)) {
            throw err;
          }
          const existingReasons = arrayFromUnknown(
            crossStageState.get(SOLAR_CS_KEY.degradedReasons),
          );
          crossStageState.set(SOLAR_CS_KEY.degradedReasons, [
            ...existingReasons,
            {
              stepId: "s9-critic",
              operatorId: "BrowserCritic",
              reason: "browser_critic_no_output",
              error: formatErrorMessage(err),
              degradedAt: new Date().toISOString(),
            },
          ]);
          memo = {
            criticalIssues: [],
            recommendations: [
              "BrowserCritic 未返回可用审稿结果；已改用 deterministic insight rubric 作为交付质量闸。",
            ],
            publishDecision: "approve",
          };
          emitDomain(input.invocation.onEvent, "agent:narrative", {
            stage: "s9-critic",
            role: "solar-browser-critic",
            tag: "warn",
            text: "S9 BrowserCritic 未返回可用审稿结果，已降级为 deterministic insight rubric，不阻断报告持久化。",
          });
        }
        crossStageState.set(SOLAR_CS_KEY.redTeamMemo, memo);
        const rubric = evaluateInsightRubric({
          plan: crossStageState.get(SOLAR_CS_KEY.technologyInsightPlan),
          ledger: crossStageState.get(SOLAR_CS_KEY.researchAssetLedger),
          coverage: crossStageState.get(SOLAR_CS_KEY.coverageReport),
          thesisGraph: crossStageState.get(SOLAR_CS_KEY.thesisGraph),
          reportPackage: crossStageState.get(SOLAR_CS_KEY.reportPackage),
        });
        crossStageState.set(SOLAR_CS_KEY.insightRubricResult, rubric);
        const currentArtifact = asRecord(crossStageState.get(CS_KEY.reportArtifact));
        if (currentArtifact) {
          crossStageState.set(
            CS_KEY.reportArtifact,
            attachResearchOsMetadata(currentArtifact, { insightRubricResult: rubric }),
          );
        }
        const verdict = {
          verdict:
            memo.publishDecision === "revise" ||
            memo.publishDecision === "reject" ||
            memo.criticalIssues.length > 0 ||
            rubric.blockers.length > 0
              ? "revise"
              : "approve",
          score:
            memo.publishDecision === "revise" ||
            memo.publishDecision === "reject" ||
            memo.criticalIssues.length > 0 ||
            rubric.blockers.length > 0
              ? 62
              : 86,
          notes: [
            ...memo.criticalIssues,
            ...rubric.blockers,
            ...rubric.warnings,
            ...memo.recommendations,
          ],
          reviewer: "Solar BrowserCritic",
        };
        crossStageState.set(CS_KEY.reviewVerdict, verdict);
        return { verdict };
      },
    });
  }

  private async generateTechnologyDiagramArtifacts(args: {
    input: DeepInsightPipelineInput;
    crossStageState: CrossStageState;
    missionId: string;
    diagramBriefs: Array<Record<string, unknown>>;
    sourceFigureCandidates: Array<Record<string, unknown>>;
    reportMarkdown: string;
  }): Promise<Array<Record<string, unknown>>> {
    if (args.diagramBriefs.length === 0 && args.sourceFigureCandidates.length === 0) {
      return [];
    }
    try {
      const result = await this.invokeOperator({
        input: args.input,
        crossStageState: args.crossStageState,
        stepId: "s8-technology-diagram-painter",
        operatorId: "TechnologyDiagramPainter",
        missionId: args.missionId,
        payload: {
          topic: args.input.topic,
          diagramBriefs: args.diagramBriefs.slice(0, 3),
          sourceFigureCandidates: args.sourceFigureCandidates.slice(0, 8),
          reportExcerpt: limitText(args.reportMarkdown, 4_000),
          instruction:
            "Create one polished reader-facing technical figure for the report. Prefer the strongest architecture/system/economics map from diagramBriefs. Do not expose internal ids.",
        },
      });
      const artifacts = normalizeTechnologyDiagramArtifacts(result);
      args.crossStageState.set(SOLAR_CS_KEY.artifactManifest, {
        diagramBriefs: args.diagramBriefs,
        sourceFigureCandidates: args.sourceFigureCandidates,
        artifacts,
        assembledAt: new Date().toISOString(),
      });
      return artifacts;
    } catch (err) {
      const existing =
        args.crossStageState.get<Array<Record<string, unknown>>>(
          SOLAR_CS_KEY.degradedReasons,
        ) ?? [];
      args.crossStageState.set(SOLAR_CS_KEY.degradedReasons, [
        ...existing,
        {
          stepId: "s8-technology-diagram-painter",
          operatorId: "TechnologyDiagramPainter",
          reason: "diagram_generation_failed_non_blocking",
          error: formatErrorMessage(err),
          at: new Date().toISOString(),
        },
      ]);
      args.crossStageState.set(SOLAR_CS_KEY.artifactManifest, {
        diagramBriefs: args.diagramBriefs,
        sourceFigureCandidates: args.sourceFigureCandidates,
        artifacts: [],
        diagramGenerationError: formatErrorMessage(err),
        assembledAt: new Date().toISOString(),
      });
      emitDomain(args.input.invocation.onEvent, "agent:narrative", {
        stage: "s8-technology-diagram-painter",
        role: "technology-diagram-painter",
        tag: "warn",
        text: "TechnologyDiagramPainter 未能返回图片，报告保留图表规划和来源图候选，不阻断正文生成。",
      });
      return [];
    }
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
    const request: SolarOperatorRequest = {
      missionId: args.missionId,
      userId: args.input.invocation.userId,
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
        modelStrategy: this.modelStrategy(args.input),
      },
      payload: args.payload,
    };
    const maxAttempts = Math.max(2, this.flowControlRetryAttempts());
    let attempt = 0;
    let normalizedResult: SolarOperatorResult | null = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      const result = await this.operatorPort.runOperator(request);
      normalizedResult = this.normalizeOperatorResult(result);
      const cooldown = this.resolveFlowControlCooldown(normalizedResult);
      if (
        !cooldown ||
        (normalizedResult.status !== "failed" &&
          normalizedResult.status !== "timed_out") ||
        attempt >= maxAttempts
      ) {
        break;
      }
      emitDomain(args.input.invocation.onEvent, "agent:lifecycle", {
        agentId: args.operatorId,
        role: "solar-browser-agent",
        phase: "waiting",
        stepId: args.stepId,
        retryAttempt: attempt,
        retryAfterMs: cooldown.waitMs,
        retryAt: cooldown.retryAt ?? null,
        error: normalizedResult.error?.message ?? normalizedResult.status,
      });
      await this.sleep(cooldown.waitMs);
    }
    if (!normalizedResult) {
      throw new Error(`[deep-insight-solar] ${args.operatorId} did not return a result`);
    }
    this.recordOperatorMetrics(args.crossStageState, normalizedResult);
    if (
      normalizedResult.status === "failed" ||
      normalizedResult.status === "timed_out"
    ) {
      emitDomain(args.input.invocation.onEvent, "agent:lifecycle", {
        agentId: args.operatorId,
        role: "solar-browser-agent",
        phase: "failed",
        stepId: args.stepId,
        error: normalizedResult.error?.message ?? normalizedResult.status,
      });
      throw new Error(
        `[deep-insight-solar] ${args.operatorId} ${normalizedResult.status}: ${
          normalizedResult.error?.message ?? "unknown error"
        }`,
      );
    }
    if (normalizedResult.status === "degraded") {
      const existing =
        args.crossStageState.get<Array<Record<string, unknown>>>(
          SOLAR_CS_KEY.degradedReasons,
        ) ?? [];
      args.crossStageState.set(SOLAR_CS_KEY.degradedReasons, [
        ...existing,
        {
          stepId: args.stepId,
          operatorId: args.operatorId,
          error: normalizedResult.error ?? null,
          at: new Date().toISOString(),
        },
      ]);
    }
    emitDomain(args.input.invocation.onEvent, "agent:lifecycle", {
      agentId: args.operatorId,
      role: "solar-browser-agent",
      phase: normalizedResult.status === "degraded" ? "degraded" : "completed",
      stepId: args.stepId,
      metrics: normalizedResult.metrics ?? {},
    });
    return normalizedResult;
  }

  private resolveFlowControlCooldown(
    result: SolarOperatorResult,
  ): { waitMs: number; retryAt?: string } | null {
    const code = result.error?.code ?? "";
    const message = result.error?.message ?? "";
    const text = `${code}\n${message}`;
    if (
      !/FLOW_CONTROL_COOLDOWN|FlowControlBlocked|blocked by flow control|state=cooldown/i.test(
        text,
      )
    ) {
      return null;
    }
    const maxWaitMs = positiveIntEnv(
      "GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_MAX_WAIT_MS",
      DEFAULT_FLOW_CONTROL_MAX_WAIT_MS,
    );
    const fallbackWaitMs = positiveIntEnv(
      "GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_FALLBACK_WAIT_MS",
      DEFAULT_FLOW_CONTROL_FALLBACK_WAIT_MS,
    );
    const untilMatch = message.match(
      /(?:cooldown\s+)?until\s+([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z?)/i,
    );
    const retryAt = untilMatch?.[1];
    const parsedRetryAt = retryAt ? Date.parse(retryAt) : Number.NaN;
    const waitMs = Number.isFinite(parsedRetryAt)
      ? Math.max(1_000, parsedRetryAt - Date.now() + 1_000)
      : fallbackWaitMs;
    return {
      waitMs: Math.min(maxWaitMs, waitMs),
      ...(retryAt ? { retryAt } : {}),
    };
  }

  private flowControlRetryAttempts(): number {
    return positiveIntEnv(
      "GENESISPOD_SOLAR_OPERATOR_FLOW_CONTROL_RETRIES",
      DEFAULT_FLOW_CONTROL_RETRY_ATTEMPTS,
    );
  }

  private s3ResearcherAttempts(): number {
    return Math.min(
      5,
      positiveIntEnv(
        "DEEP_INSIGHT_SOLAR_S3_RESEARCHER_ATTEMPTS",
        DEFAULT_S3_RESEARCHER_ATTEMPTS,
      ),
    );
  }

  private isNonRetryableResearcherError(err: unknown): boolean {
    return /AUTH_REPAIR_REQUIRED|login_wall|challenge_wall|auth_repair_required/i.test(
      formatErrorMessage(err),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  private normalizeOperatorResult(result: SolarOperatorResult): SolarOperatorResult {
    const raw = asRecord(result);
    const markdown = result.markdown ?? asString(raw?.text);
    const structuredRawText = asString(asRecord(result.structured)?.rawText);
    const structured =
      parseJsonLike(structuredRawText) ??
      result.structured ??
      parseJsonLike(markdown) ??
      parseJsonLike(asString(raw?.text));
    return {
      ...result,
      ...(structured !== undefined ? { structured } : {}),
      ...(markdown !== undefined ? { markdown } : {}),
    };
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

  private modelStrategy(input: DeepInsightPipelineInput): Record<string, unknown> {
    return {
      nativeFastModelId: input.invocation.preferredModelId ?? null,
      nativeFastRole:
        "DeepSeek/GenesisPod native stages handle cheap structure, coverage, outline and deterministic gates.",
      browserStrongRole:
        "Solar BrowserAgent stages handle source-grounded planning, research, synthesis, longform writing and critic review.",
      fusionPolicy:
        "Failed browser workstreams or revise/reject critic verdicts must remain visible to the final gate.",
    };
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

  private normalizeResearcherResult(
    structured: unknown,
    markdown: string | undefined,
    fallbackDimension: string,
    input: DeepInsightPipelineInput,
  ): ResearcherShape {
    const obj = asRecord(parseJsonLike(asString(asRecord(structured)?.rawText)) ?? structured);
    const citations = arrayFromUnknown(obj?.citations ?? obj?.sources)
      .map((raw) => asString(raw) ?? asString(asRecord(raw)?.url) ?? asString(asRecord(raw)?.source))
      .filter((item): item is string => !!item);
    const fullMarkdown =
      asString(obj?.fullMarkdown) ??
      asString(obj?.markdown) ??
      markdown ??
      asString(obj?.rawText);
    const findings = [
      ...arrayFromUnknown(obj?.findings ?? obj?.rawFindings),
      ...arrayFromUnknown(obj?.evidenceLedger),
      ...arrayFromUnknown(obj?.evidenceCards),
      ...arrayFromUnknown(obj?.researchAssets),
      ...arrayFromUnknown(obj?.assets),
      ...arrayFromUnknown(obj?.claims),
    ]
      .map((raw, idx) => {
        const item = asRecord(raw);
        const source =
          asString(item?.source) ??
          asString(item?.sourceUrl) ??
          asString(item?.url) ??
          arrayFromUnknown(item?.sourceUrls).map(asString).find(Boolean) ??
          citations[idx] ??
          citations[0];
        return {
          claim:
            asString(item?.claim) ??
            asString(item?.title) ??
            asString(item?.headline),
          evidence:
            asString(item?.evidence) ??
            asString(item?.quote) ??
            asString(item?.sourceSnippet) ??
            asString(item?.snippet) ??
            asString(item?.summary),
          source,
          ...(asString(item?.sourceTitle) ?? asString(item?.title)
            ? { sourceTitle: asString(item?.sourceTitle) ?? asString(item?.title) }
            : {}),
          ...(asString(item?.sourceSnippet) ?? asString(item?.snippet)
            ? {
                sourceSnippet:
                  asString(item?.sourceSnippet) ?? asString(item?.snippet),
              }
            : {}),
          ...(asString(item?.sourcePublishedAt)
            ? { sourcePublishedAt: asString(item?.sourcePublishedAt) }
            : {}),
        };
      })
      .filter(
        (finding) =>
          !!finding.claim && !!finding.evidence && !!finding.source,
      );
    const fallbackFindings =
      findings.length > 0
        ? findings
        : extractFindingsFromMarkdown(fullMarkdown, citations, fallbackDimension);
    return {
      dimension:
        asString(obj?.dimension) ??
        asString(obj?.dimensionName) ??
        fallbackDimension,
      summary:
        asString(obj?.summary) ??
        asString(obj?.themeSummary) ??
        firstNonEmptyLine(fullMarkdown) ??
        `Solar BrowserResearcher completed ${fallbackDimension} for ${input.topic}`,
      findings: fallbackFindings,
      ...(fullMarkdown ? { fullMarkdown } : {}),
      chapters: arrayFromUnknown(obj?.chapters).map((raw, idx) => {
        const item = asRecord(raw);
        const body = asString(item?.body) ?? asString(item?.content) ?? "";
        return {
          index: asNumber(item?.index) ?? idx + 1,
          heading:
            asString(item?.heading) ?? asString(item?.title) ?? `章节 ${idx + 1}`,
          body,
          wordCount: asNumber(item?.wordCount) ?? Math.round(body.length / 2),
        };
      }),
      figureCandidates: arrayFromUnknown(obj?.figureCandidates).map((raw) => {
        const item = asRecord(raw);
        return {
          sourceUrl: asString(item?.sourceUrl) ?? asString(item?.source) ?? "",
          ...(asString(item?.imageUrl) ? { imageUrl: asString(item?.imageUrl) } : {}),
          caption: asString(item?.caption) ?? "",
          ...(asString(item?.sourcePageOrSection)
            ? { sourcePageOrSection: asString(item?.sourcePageOrSection) }
            : {}),
          ...(asFigureRelevance(item?.relevanceHint)
            ? { relevanceHint: asFigureRelevance(item?.relevanceHint) }
            : {}),
        };
      }),
    };
  }

  private normalizeRedTeamMemo(
    structured: unknown,
    markdown: string | undefined,
  ): {
    criticalIssues: string[];
    recommendations: string[];
    publishDecision?: string;
    markdown?: string;
  } {
    const obj = asRecord(structured);
    const blockingIssues = arrayFromUnknown(obj?.blockingIssues).map(formatCriticIssue);
    const unsupportedClaims = arrayFromUnknown(obj?.unsupportedClaims).map(formatCriticIssue);
    const styleLeaks = arrayFromUnknown(obj?.styleLeaks).map(formatCriticIssue);
    const lowValuePassages = arrayFromUnknown(obj?.lowValuePassages).map(formatCriticIssue);
    const publishDecision = asString(obj?.publishDecision)?.toLowerCase();
    return {
      criticalIssues: arrayFromUnknown(
        obj?.criticalIssues ?? obj?.claimGaps ?? obj?.citationGaps,
      )
        .map(String)
        .concat(blockingIssues, unsupportedClaims, styleLeaks, lowValuePassages)
        .filter(Boolean),
      recommendations: arrayFromUnknown(
        obj?.recommendations ?? obj?.recommendedEdits,
      ).map(String),
      ...(publishDecision ? { publishDecision } : {}),
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

  private emitResearchCompleted(
    input: DeepInsightPipelineInput,
    dimension: string,
    result: ResearcherShape,
    reused: boolean,
  ): void {
    const summary = (result.summary ?? "").slice(0, 200);
    emitDomain(input.invocation.onEvent, "dimension:research:completed", {
      dimension,
      findingsCount: result.findings?.length ?? 0,
      summary,
      summaryPreview: summary,
      reused,
      source: "solar-browser-agent",
    });
    emitDomain(input.invocation.onEvent, "researcher:completed", {
      dimension,
      state: "completed",
      findingsCount: result.findings?.length ?? 0,
      summary,
      source: "solar-browser-agent",
    });
  }
}

function buildAnalystInputPacket(args: {
  topic: string;
  technologyInsightPlan: TechnologyInsightPlan | undefined;
  researchAssetLedger: ResearchAssetLedger | undefined;
  coverageReport: CoverageReport;
  plan: PlanShape | undefined;
  researcherResults: ResearcherShape[];
  reconciliation: unknown;
}): AnalystInputPacket {
  const targetChars = positiveIntEnv(
    "DEEP_INSIGHT_SOLAR_S6_ANALYST_PACKET_TARGET_CHARS",
    DEFAULT_ANALYST_PACKET_TARGET_CHARS,
  );
  const hardCapChars = positiveIntEnv(
    "DEEP_INSIGHT_SOLAR_S6_ANALYST_PACKET_HARD_CAP_CHARS",
    DEFAULT_ANALYST_PACKET_HARD_CAP_CHARS,
  );
  const originalPayloadChars = jsonCharLength({
    technologyInsightPlan: args.technologyInsightPlan,
    researchAssetLedger: args.researchAssetLedger,
    coverageReport: args.coverageReport,
    plan: args.plan,
    researcherResults: args.researcherResults,
    reconciliation: args.reconciliation,
  });

  const profiles = [
    {
      name: "balanced",
      assetLimits: {
        evidenceCard: 80,
        evolutionEvent: 24,
        stackNode: 30,
        interfaceEdge: 18,
        actorCard: 32,
        sotaFinding: 28,
        bottleneckCard: 28,
        contradiction: 28,
        weakSignal: 28,
        opportunityHypothesis: 32,
        canonicalEntityCard: 12,
        sourceFigureCandidate: 16,
        sourceTableCandidate: 12,
        diagramBriefSeed: 12,
        benchmarkClaim: 16,
        primarySourceClaim: 40,
      } satisfies Record<ResearchOsAssetType, number>,
      findingsPerDimension: 6,
      assetSummaryChars: 720,
      findingEvidenceChars: 520,
    },
    {
      name: "compact",
      assetLimits: {
        evidenceCard: 48,
        evolutionEvent: 16,
        stackNode: 18,
        interfaceEdge: 12,
        actorCard: 18,
        sotaFinding: 16,
        bottleneckCard: 16,
        contradiction: 18,
        weakSignal: 18,
        opportunityHypothesis: 20,
        canonicalEntityCard: 8,
        sourceFigureCandidate: 10,
        sourceTableCandidate: 8,
        diagramBriefSeed: 8,
        benchmarkClaim: 10,
        primarySourceClaim: 24,
      } satisfies Record<ResearchOsAssetType, number>,
      findingsPerDimension: 4,
      assetSummaryChars: 520,
      findingEvidenceChars: 360,
    },
    {
      name: "minimal",
      assetLimits: {
        evidenceCard: 30,
        evolutionEvent: 10,
        stackNode: 12,
        interfaceEdge: 8,
        actorCard: 12,
        sotaFinding: 10,
        bottleneckCard: 12,
        contradiction: 12,
        weakSignal: 12,
        opportunityHypothesis: 14,
        canonicalEntityCard: 5,
        sourceFigureCandidate: 6,
        sourceTableCandidate: 5,
        diagramBriefSeed: 5,
        benchmarkClaim: 6,
        primarySourceClaim: 14,
      } satisfies Record<ResearchOsAssetType, number>,
      findingsPerDimension: 3,
      assetSummaryChars: 360,
      findingEvidenceChars: 260,
    },
    {
      name: "ultra-minimal",
      assetLimits: {
        evidenceCard: 12,
        evolutionEvent: 5,
        stackNode: 6,
        interfaceEdge: 4,
        actorCard: 6,
        sotaFinding: 5,
        bottleneckCard: 6,
        contradiction: 6,
        weakSignal: 6,
        opportunityHypothesis: 6,
        canonicalEntityCard: 3,
        sourceFigureCandidate: 3,
        sourceTableCandidate: 3,
        diagramBriefSeed: 3,
        benchmarkClaim: 3,
        primarySourceClaim: 6,
      } satisfies Record<ResearchOsAssetType, number>,
      findingsPerDimension: 2,
      assetSummaryChars: 180,
      findingEvidenceChars: 160,
    },
  ];

  let selected = buildAnalystInputPacketWithProfile(args, profiles[0]);
  for (const profile of profiles) {
    const candidate = buildAnalystInputPacketWithProfile(args, profile);
    selected = candidate;
    const length = jsonCharLength(candidate);
    if (length <= targetChars || length <= hardCapChars) break;
  }

  const packetChars = jsonCharLength(selected);
  const assetCount = args.researchAssetLedger?.assets.length ?? 0;
  const includedAssetCount =
    arrayFromUnknown(asRecord(selected.researchAssetLedgerDigest)?.assets).length +
    arrayFromUnknown(asRecord(selected.researchAssetLedgerDigest)?.evidenceCards).length;
  return {
    ...selected,
    budget: {
      originalPayloadChars,
      packetChars,
      targetChars,
      hardCapChars,
      compressed: packetChars < originalPayloadChars,
      overHardCap: packetChars > hardCapChars,
      assetCount,
      includedAssetCount,
      researcherResultCount: args.researcherResults.length,
      profile: asString(selected.compressionProfile) ?? "balanced",
      droppedFields: [
        "researcherResults.fullMarkdown",
        "researchAssetLedger.assets[].payload",
        "markdown",
        "rawText",
      ],
    },
  };
}

function isBrowserAnalystGeneratingWithoutOutputError(err: unknown): boolean {
  const message = formatErrorMessage(err);
  return (
    /BrowserAnalyst/.test(message) &&
    /timed_out|timeout|generating_without_output|unknown error/i.test(message)
  );
}

function isBrowserCriticNoOutputError(err: unknown): boolean {
  const message = formatErrorMessage(err);
  if (
    /BrowserCritic/.test(message) &&
    /SOLAR_CHATGPT_NO_OUTPUT|produced no usable ChatGPT generation|signal_reason=submitted_without_generation/i.test(
      message,
    )
  ) {
    return true;
  }
  if (/login_wall|challenge_wall|auth_repair|AUTH_REPAIR_REQUIRED/i.test(message)) {
    return false;
  }
  return (
    /BrowserCritic/.test(message) &&
    /SOLAR_CHATGPT_NO_OUTPUT|timed_out|timeout|generating_without_output|assistant_response_too_short|no output|unknown error|submitted_without_generation|blocked_signal|failed:\s*$/i.test(
      message,
    )
  );
}

function buildFallbackThesisGraphFromLedger(
  topic: string,
  technologyInsightPlan: TechnologyInsightPlan | undefined,
  researchAssetLedger: ResearchAssetLedger | undefined,
): ThesisGraph {
  const evidenceCards = researchAssetLedger?.evidenceCards ?? [];
  const assets = researchAssetLedger?.assets ?? [];
  const evidenceIds = evidenceCards.map((asset) => asset.id).filter(Boolean);
  const byWorkstream = new Map<string, typeof assets>();
  for (const asset of assets) {
    const key = asset.workstreamId ?? "general";
    const existing = byWorkstream.get(key) ?? [];
    existing.push(asset);
    byWorkstream.set(key, existing);
  }
  const seedStatements =
    technologyInsightPlan?.initialTheses.filter(Boolean).slice(0, 4) ?? [];
  const workstreamStatements =
    technologyInsightPlan?.workstreams.slice(0, 4).map((workstream) => {
      const workstreamAssets = byWorkstream.get(workstream.id) ?? [];
      const strongestAsset =
        workstreamAssets.find((asset) => asset.type === "sotaFinding") ??
        workstreamAssets.find((asset) => asset.type === "opportunityHypothesis") ??
        workstreamAssets[0];
      return strongestAsset?.summary
        ? `${workstream.name} 的关键判断是：${strongestAsset.summary}`
        : workstream.objective;
    }) ?? [];
  const statements = [...seedStatements, ...workstreamStatements, topic]
    .map((item) => limitText(item, 420))
    .filter(Boolean)
    .slice(0, 4);
  const theses = statements.map((statement, index) => {
    const sliceStart = index * 3;
    const boundEvidence = evidenceIds.slice(sliceStart, sliceStart + 4);
    return {
      id: `thesis-${index + 1}`,
      statement,
      mechanism:
        technologyInsightPlan?.workstreams[index]?.objective ??
        "由已完成研究资产中的证据卡、技术对象、瓶颈和机会假设共同支撑。",
      evidenceIds: boundEvidence.length > 0 ? boundEvidence : evidenceIds.slice(0, 4),
      counterEvidenceIds: assets
        .filter((asset) => asset.type === "contradiction")
        .slice(index, index + 2)
        .map((asset) => asset.id),
      limitations: assets
        .filter((asset) => asset.confidence === "gap" || asset.type === "contradiction")
        .slice(index, index + 2)
        .map((asset) => limitText(asset.summary, 220)),
      architectureImplications: assets
        .filter((asset) => asset.type === "stackNode" || asset.type === "interfaceEdge")
        .slice(index, index + 2)
        .map((asset) => limitText(asset.summary, 220)),
      opportunityImplications: assets
        .filter((asset) => asset.type === "opportunityHypothesis" || asset.type === "weakSignal")
        .slice(index, index + 2)
        .map((asset) => limitText(asset.summary, 220)),
    };
  });
  const safeTheses =
    theses.length > 0
      ? theses
      : [
          {
            id: "thesis-1",
            statement: topic,
            mechanism: "由已完成研究资产支撑。",
            evidenceIds: evidenceIds.slice(0, 4),
            counterEvidenceIds: [],
            limitations: [],
            architectureImplications: [],
            opportunityImplications: [],
          },
        ];
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    theses: safeTheses,
    claimEdges: [],
    evidenceBindings: safeTheses.flatMap((thesis) =>
      thesis.evidenceIds.map((evidenceId) => ({
        thesisId: thesis.id,
        evidenceId,
      })),
    ),
    counterEvidence: assets
      .filter((asset) => asset.type === "contradiction")
      .slice(0, 8)
      .map((asset) => ({ id: asset.id, summary: asset.summary })),
    openQuestions:
      technologyInsightPlan?.falsificationQuestions.slice(0, 8) ??
      assets
        .filter((asset) => asset.confidence === "gap")
        .slice(0, 8)
        .map((asset) => asset.summary),
    reportOutline: safeTheses.map((thesis, index) => ({
      id: `section-${index + 1}`,
      title:
        technologyInsightPlan?.workstreams[index]?.name ??
        `关键判断 ${index + 1}`,
      thesisIds: [thesis.id],
    })),
  };
}

function buildAnalystInputPacketWithProfile(
  args: {
    topic: string;
    technologyInsightPlan: TechnologyInsightPlan | undefined;
    researchAssetLedger: ResearchAssetLedger | undefined;
    coverageReport: CoverageReport;
    plan: PlanShape | undefined;
    researcherResults: ResearcherShape[];
    reconciliation: unknown;
  },
  profile: {
    name: string;
    assetLimits: Record<ResearchOsAssetType, number>;
    findingsPerDimension: number;
    assetSummaryChars: number;
    findingEvidenceChars: number;
  },
): Record<string, unknown> {
  return {
    schemaVersion: RESEARCH_OS_SCHEMA_VERSION,
    compressionProfile: profile.name,
    purpose:
      "BrowserAnalyst should build a ThesisGraph from this compressed evidence packet. Full ledgers remain in mission artifacts; do not ask for raw markdown.",
    topic: args.topic,
    technologyInsightPlanDigest: digestTechnologyInsightPlan(args.technologyInsightPlan),
    coverageReport: compactCoverageReport(args.coverageReport),
    legacyPlanShell: digestPlan(args.plan),
    researchAssetLedgerDigest: digestResearchAssetLedger(
      args.researchAssetLedger,
      profile.assetLimits,
      profile.assetSummaryChars,
    ),
    researcherDigests: args.researcherResults.map((result) =>
      digestResearcherResult(
        result,
        profile.findingsPerDimension,
        profile.findingEvidenceChars,
      ),
    ),
    reconciliationDigest: digestReconciliation(args.reconciliation),
    instructions: [
      "Build a global ThesisGraph; do not summarize each workstream mechanically.",
      "Every core thesis must bind mechanism, supporting evidence, counter-evidence or limitation, architecture implication, and opportunity implication.",
      "Prefer non-obvious synthesis across workstreams over listing assets.",
      "Do not emit reader-facing report prose here; only return strict JSON for ThesisGraph and optional diagramBriefs.",
    ],
  };
}

function digestTechnologyInsightPlan(
  plan: TechnologyInsightPlan | undefined,
): Record<string, unknown> | undefined {
  if (!plan) return undefined;
  return {
    schemaVersion: plan.schemaVersion,
    centralQuestion: limitText(plan.centralQuestion, 600),
    userIntentAnalysis: {
      originalAsk: limitText(plan.userIntentAnalysis.originalAsk, 600),
      decisionNeed: limitText(plan.userIntentAnalysis.decisionNeed, 600),
      audienceUse: limitText(plan.userIntentAnalysis.audienceUse, 500),
      successCriteria: plan.userIntentAnalysis.successCriteria
        .slice(0, 8)
        .map((item) => limitText(item, 240)),
    },
    initialTheses: plan.initialTheses.slice(0, 8).map((item) => limitText(item, 500)),
    researchQuestions: plan.researchQuestions
      .slice(0, 12)
      .map((item) => limitText(item, 420)),
    workstreams: plan.workstreams.map((workstream) => ({
      id: workstream.id,
      name: workstream.name,
      objective: limitText(workstream.objective, 500),
      assetTypes: workstream.assetTypes,
    })),
    mandatoryArtifacts: plan.mandatoryArtifacts,
    falsificationQuestions: plan.falsificationQuestions
      .slice(0, 10)
      .map((item) => limitText(item, 420)),
  };
}

function compactCoverageReport(report: CoverageReport): Record<string, unknown> {
  return {
    schemaVersion: report.schemaVersion,
    ok: report.ok,
    missingAssetTypes: report.missingAssetTypes,
    blockers: report.blockers.slice(0, 12).map((item) => limitText(item, 420)),
    warnings: report.warnings.slice(0, 12).map((item) => limitText(item, 420)),
    repairPackets: report.repairPackets.slice(0, 8).map((packet) => ({
      id: packet.id,
      reason: limitText(packet.reason, 420),
      targetAssetTypes: packet.targetAssetTypes,
    })),
  };
}

function digestPlan(plan: PlanShape | undefined): Record<string, unknown> | undefined {
  if (!plan) return undefined;
  return {
    themeSummary: limitText(plan.themeSummary, 700),
    dimensions: (plan.dimensions ?? []).map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      rationale: limitText(dimension.rationale, 360),
    })),
  };
}

function digestResearchAssetLedger(
  ledger: ResearchAssetLedger | undefined,
  assetLimits: Record<ResearchOsAssetType, number>,
  summaryChars: number,
): Record<string, unknown> | undefined {
  if (!ledger) return undefined;
  const assetsByType = new Map<ResearchOsAssetType, typeof ledger.assets>();
  for (const asset of ledger.assets) {
    const bucket = assetsByType.get(asset.type) ?? [];
    bucket.push(asset);
    assetsByType.set(asset.type, bucket);
  }
  const assets = RESEARCH_OS_ASSET_TYPES.flatMap((type) =>
    (assetsByType.get(type) ?? [])
      .slice(0, assetLimits[type])
      .map((asset) => digestResearchAsset(asset, summaryChars)),
  );
  const evidenceCards = ledger.evidenceCards
    .slice(0, assetLimits.evidenceCard)
    .map((asset) => digestResearchAsset(asset, summaryChars));
  return {
    schemaVersion: ledger.schemaVersion,
    sourceCount: ledger.sourceCount,
    assetTypeCounts: ledger.assetTypeCounts,
    totalAssetCount: ledger.assets.length,
    includedAssetCount: assets.length,
    evidenceCards,
    assets,
  };
}

function digestResearchAsset(
  asset: ResearchAssetLedger["assets"][number],
  summaryChars: number,
): Record<string, unknown> {
  return {
    id: asset.id,
    type: asset.type,
    title: limitText(asset.title, 220),
    summary: limitText(asset.summary, summaryChars),
    evidenceIds: asset.evidenceIds.slice(0, 8),
    sourceUrls: asset.sourceUrls.slice(0, 4),
    ...(asset.workstreamId ? { workstreamId: asset.workstreamId } : {}),
    ...(asset.confidence ? { confidence: asset.confidence } : {}),
  };
}

function digestResearcherResult(
  result: ResearcherShape,
  findingsPerDimension: number,
  evidenceChars: number,
): Record<string, unknown> {
  return {
    dimension: result.dimension,
    summary: limitText(result.summary, 900),
    findingCount: result.findings?.length ?? 0,
    topFindings: (result.findings ?? []).slice(0, findingsPerDimension).map((finding) => ({
      claim: limitText(finding.claim, 260),
      evidence: limitText(finding.evidence, evidenceChars),
      source: finding.source,
      ...(finding.sourceTitle ? { sourceTitle: limitText(finding.sourceTitle, 220) } : {}),
      ...(finding.sourceSnippet
        ? { sourceSnippet: limitText(finding.sourceSnippet, 360) }
        : {}),
    })),
  };
}

function digestReconciliation(value: unknown): unknown {
  const obj = asRecord(value);
  if (!obj) return undefined;
  return compactUnknown(obj, 2, 40);
}

function compactUnknown(value: unknown, depth: number, arrayLimit: number): unknown {
  if (depth < 0) return undefined;
  if (typeof value === "string") return limitText(value, 500);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, arrayLimit).map((item) => compactUnknown(item, depth - 1, 12));
  }
  const obj = asRecord(value);
  if (!obj) return undefined;
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([key]) => !/fullMarkdown|markdown|rawText|payload/i.test(key))
      .slice(0, 40)
      .map(([key, item]) => [key, compactUnknown(item, depth - 1, 12)]),
  );
}

function limitText(value: string | undefined, maxChars: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function jsonCharLength(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(value))
    .digest("hex")
    .slice(0, 24);
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class SolarOutlineTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`[deep-insight-solar] S7 outline timed out after ${timeoutMs}ms`);
    this.name = "SolarOutlineTimeoutError";
  }
}

function isSolarOutlineTimeout(err: unknown): err is SolarOutlineTimeoutError {
  return err instanceof SolarOutlineTimeoutError;
}

function resolveSolarOutlineTimeoutMs(): number {
  const raw = process.env.DEEP_INSIGHT_SOLAR_S7_OUTLINE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_SOLAR_OUTLINE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SOLAR_OUTLINE_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new SolarOutlineTimeoutError(timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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

function formatCriticIssue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const obj = asRecord(value);
  if (!obj) return String(value ?? "").trim();
  return [
    asString(obj.location),
    asString(obj.issue) ??
      asString(obj.problem) ??
      asString(obj.claim) ??
      asString(obj.phrase) ??
      asString(obj.passageSummary),
    asString(obj.whyItHurtsReaderValue),
    asString(obj.fix) ??
      asString(obj.rewriteDirection) ??
      asString(obj.replacementDirection),
  ]
    .filter((part): part is string => !!part)
    .join(" / ");
}

function buildWriterBriefForPublicWriter(
  structured: unknown,
  topic: string,
  technologyInsightPlan: TechnologyInsightPlan | undefined,
  thesisGraph: ThesisGraph | undefined,
  ledger: ResearchAssetLedger | undefined,
): Record<string, unknown> {
  const direct = asRecord(asRecord(structured)?.writerBrief);
  if (direct) return direct;
  const references = (ledger?.evidenceCards ?? ledger?.assets ?? [])
    .flatMap((asset) =>
      (asset.sourceUrls ?? []).map((url) => ({
        title: asset.title,
        url,
        relevance: asset.summary,
      })),
    )
    .slice(0, 16);
  const sections = (thesisGraph?.theses ?? []).slice(0, 8).map((thesis, index) => {
    const evidence = (ledger?.evidenceCards ?? ledger?.assets ?? [])
      .filter((asset) =>
        thesis.evidenceIds.some((id) => asset.evidenceIds.includes(id) || asset.id === id),
      )
      .slice(0, 4)
      .flatMap((asset) =>
        (asset.sourceUrls.length > 0 ? asset.sourceUrls : [""]).map((url) => ({
          sourceTitle: asset.title,
          fact: asset.summary,
          url,
        })),
      );
    return {
      heading: thesis.statement.slice(0, 80) || `Section ${index + 1}`,
      coreClaim: thesis.statement,
      mechanism: thesis.mechanism,
      evidenceToUse: evidence,
      limitToPreserve: thesis.limitations.join("；"),
      implication: [
        ...thesis.architectureImplications,
        ...thesis.opportunityImplications,
      ].join("；"),
    };
  });
  const contentPlan = buildExternalContentPlan(
    technologyInsightPlan,
    thesisGraph,
    sections,
  );
  return {
    workingTitle: topic,
    userIntentAnalysis:
      technologyInsightPlan?.userIntentAnalysis ?? {
        originalAsk: topic,
        decisionNeed: `判断 ${topic} 背后的技术方向、产业机会和投资热点。`,
        audienceUse: "用于对外汇报、投资讨论或技术战略判断。",
        successCriteria: [
          "先解释用户真正要解决的判断问题",
          "给出内容规划",
          "逐步展开洞察",
          "形成可执行结论",
        ],
      },
    contentPlan,
    mandatoryPublicReportStructure: [
      "需求理解：本次分析要回答什么",
      "内容规划：如何展开这份洞察",
      "分步骤洞察：按规划逐步给出判断、机制、证据和影响",
      "综合判断与行动建议：给出可汇报结论、投资热点谱系和下一步",
    ],
    oneSentenceThesis: thesisGraph?.theses?.[0]?.statement ?? topic,
    leadAngle: thesisGraph?.theses?.[0]?.mechanism ?? "",
    readerTakeaways: (thesisGraph?.theses ?? []).slice(0, 5).map((thesis) => thesis.statement),
    sections,
    doNotOverstate: thesisGraph?.openQuestions ?? [],
    referenceCandidates: references,
  };
}

function buildExternalContentPlan(
  technologyInsightPlan: TechnologyInsightPlan | undefined,
  thesisGraph: ThesisGraph | undefined,
  sections: Array<Record<string, unknown>>,
): Array<{ step: string; purpose: string }> {
  const workstreamSteps =
    technologyInsightPlan?.workstreams.slice(0, 8).map((workstream, index) => ({
      step: `步骤${index + 1}：${workstream.name}`,
      purpose: limitText(workstream.objective, 260),
    })) ?? [];
  if (workstreamSteps.length > 0) return workstreamSteps;
  const outlineSteps =
    thesisGraph?.reportOutline.slice(0, 8).map((section, index) => ({
      step: `步骤${index + 1}：${section.title}`,
      purpose: "把关键论点展开为可汇报的技术、产业和机会判断。",
    })) ?? [];
  if (outlineSteps.length > 0) return outlineSteps;
  return sections.slice(0, 8).map((section, index) => ({
    step: `步骤${index + 1}：${String(section.heading ?? `分析主题 ${index + 1}`)}`,
    purpose: "把材料转化为读者可直接使用的洞察。",
  }));
}

function publicReportPackageForCritic(value: unknown): Record<string, unknown> {
  const reportPackage = asRecord(value);
  return {
    executiveBriefMarkdown: asString(reportPackage?.executiveBriefMarkdown) ?? "",
    standardReportMarkdown: asString(reportPackage?.standardReportMarkdown) ?? "",
  };
}

function firstNonEmptyLine(value: string | undefined): string | undefined {
  return value?.split("\n").find((line) => line.trim().length > 0)?.trim();
}

function parseJsonLike(value: string | undefined): unknown {
  if (!value) return undefined;
  const clean = stripJsonFence(value);
  if (!clean) return undefined;
  for (const candidate of [
    clean,
    escapeRawControlCharsInJsonStrings(clean),
    extractFirstJsonObject(clean),
  ]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next more forgiving candidate.
    }
  }
  return undefined;
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index++) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}

function escapeRawControlCharsInJsonStrings(value: string): string {
  let inString = false;
  let escaped = false;
  let out = "";
  for (const char of value) {
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        out += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        out += char;
        inString = false;
        continue;
      }
      if (char === "\n") {
        out += "\\n";
        continue;
      }
      if (char === "\r") {
        out += "\\r";
        continue;
      }
      if (char === "\t") {
        out += "\\t";
        continue;
      }
      out += char;
      continue;
    }
    out += char;
    if (char === "\"") inString = true;
  }
  return out;
}

function extractFindingsFromMarkdown(
  markdown: string | undefined,
  citations: string[],
  fallbackDimension: string,
): Array<{ claim: string; evidence: string; source: string; sourceTitle?: string }> {
  if (!markdown) return [];
  const urls = Array.from(
    new Set([
      ...citations,
      ...Array.from(markdown.matchAll(/https?:\/\/[^\s"'，。)）\]}]+/g)).map(
        (match) => match[0],
      ),
    ]),
  ).filter((url) => /^https?:\/\//.test(url));
  if (urls.length === 0) return [];
  const paragraphs = markdown
    .split(/\n{2,}|(?<=。)\s+/)
    .map((item) => item.replace(/^[-*#\d.\s]+/, "").trim())
    .filter((item) => item.length >= 24);
  const findings: Array<{
    claim: string;
    evidence: string;
    source: string;
    sourceTitle?: string;
  }> = [];
  for (const url of urls) {
    const paragraph =
      paragraphs.find((item) => item.includes(url)) ??
      paragraphs[findings.length % Math.max(1, paragraphs.length)] ??
      `${fallbackDimension} has source-backed evidence at ${url}`;
    const cleaned = paragraph.replace(url, "").trim();
    findings.push({
      claim: cleaned.slice(0, 180) || `${fallbackDimension} evidence item`,
      evidence: cleaned.slice(0, 420) || paragraph.slice(0, 420),
      source: url,
    });
    if (findings.length >= 12) break;
  }
  return findings;
}

function countUsableResearchFindings(findings: unknown): number {
  if (!Array.isArray(findings)) return 0;
  return findings.filter((finding) => {
    const item = asRecord(finding);
    return !!asString(item?.claim) && !!asString(item?.evidence) && !!asString(item?.source);
  }).length;
}

function recoverSolarWriterBody(
  artifact: unknown,
  writerReport: WriterReportShape | undefined,
): unknown {
  const writerMarkdown = buildWriterFullMarkdown(writerReport);
  if (!writerMarkdown || writerMarkdown.length < 1000) return artifact;

  const obj = asRecord(artifact);
  const content = asRecord(obj?.content);
  const currentMarkdown = asString(content?.fullMarkdown) ?? "";
  const currentLooksPlaceholder =
    /本维度内容缺失|内容缺失|缺失章节|missing content|证据锚点/i.test(
      currentMarkdown,
    );
  const shouldRecover =
    currentLooksPlaceholder ||
    currentMarkdown.length < 6000 ||
    currentMarkdown.length < Math.floor(writerMarkdown.length * 0.5);
  if (!shouldRecover) return artifact;

  const sections = buildWriterArtifactSections(writerReport, writerMarkdown);
  const metadata = asRecord(obj?.metadata);
  return {
    ...(obj ?? {}),
    title: asString(obj?.title) ?? writerReport?.title ?? "Solar 强模型深度洞察报告",
    content: {
      ...(content ?? {}),
      fullMarkdown: writerMarkdown,
      fullReportSize: Buffer.byteLength(writerMarkdown, "utf8"),
    },
    sections: sections.length > 0 ? sections : obj?.sections,
    metadata: {
      ...(metadata ?? {}),
      solarWriterBodyRecovered: true,
      solarWriterBodyRecoveredAt: new Date().toISOString(),
      solarWriterBodySource: "deep-insight-solar.s8-writer",
      previousFullMarkdownChars: currentMarkdown.length,
      recoveredFullMarkdownChars: writerMarkdown.length,
    },
  };
}

function attachResearchOsMetadata(
  artifact: unknown,
  metadataPatch: Record<string, unknown>,
): unknown {
  const obj = asRecord(artifact);
  if (!obj) return artifact;
  const metadata = asRecord(obj.metadata);
  const content = asRecord(obj.content);
  const reportPackage = asRecord(metadataPatch.reportPackage);
  const standardReportMarkdown = asString(reportPackage?.standardReportMarkdown);
  const currentMarkdown = asString(content?.fullMarkdown) ?? "";
  const shouldUseStandardReport =
    !!standardReportMarkdown &&
    standardReportMarkdown.length > Math.max(currentMarkdown.length, 0);
  return {
    ...obj,
    content: {
      ...(content ?? {}),
      ...(shouldUseStandardReport
        ? { fullMarkdown: standardReportMarkdown }
        : {}),
    },
    metadata: {
      ...(metadata ?? {}),
      researchOsSchemaVersion: RESEARCH_OS_SCHEMA_VERSION,
      ...metadataPatch,
    },
  };
}

function buildWriterFullMarkdown(
  writerReport: WriterReportShape | undefined,
): string | undefined {
  const sections = (writerReport?.sections ?? [])
    .map((section, idx) => {
      const title = section.heading ?? section.title ?? `章节 ${idx + 1}`;
      const body = section.body?.trim() ?? "";
      return { title, body };
    })
    .filter((section) => section.body.length >= 40);
  if (sections.length === 0) return undefined;

  const parts: string[] = [];
  const title = writerReport?.title?.trim();
  if (title) parts.push(`# ${title}`);
  const summary = writerReport?.summary?.trim();
  if (summary) parts.push(`## 执行摘要\n\n${summary}`);
  for (const section of sections) {
    parts.push(`## ${section.title}\n\n${section.body}`);
  }
  const conclusion = writerReport?.conclusion?.trim();
  if (conclusion) parts.push(`## 结论\n\n${conclusion}`);
  const citations = (writerReport?.citations ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (citations.length > 0) {
    parts.push(
      `## 参考来源\n\n${citations.map((item, idx) => `${idx + 1}. ${item}`).join("\n")}`,
    );
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildWriterArtifactSections(
  writerReport: WriterReportShape | undefined,
  fullMarkdown: string,
): Array<Record<string, unknown>> {
  let searchFrom = 0;
  const sections: Array<Record<string, unknown>> = [];
  (writerReport?.sections ?? []).forEach((section, idx) => {
    const title = section.heading ?? section.title ?? `章节 ${idx + 1}`;
    const body = section.body?.trim() ?? "";
    if (body.length < 40) return;
    const heading = `## ${title}`;
    const foundOffset = fullMarkdown.indexOf(heading, searchFrom);
    const startOffset = foundOffset >= 0 ? foundOffset : searchFrom;
    const endOffset = Math.min(
      fullMarkdown.length,
      startOffset + heading.length + 2 + body.length,
    );
    searchFrom = endOffset;
    const wordCount = Math.max(1, Math.round(body.length / 2));
    sections.push({
      id: `solar-writer-section-${idx + 1}`,
      type: "dimension",
      level: 2,
      title,
      anchor: `solar-writer-section-${idx + 1}`,
      startOffset,
      endOffset,
      wordCount,
      readingTimeMinutes: Math.max(1, Math.ceil(wordCount / 500)),
      citations: [],
      figureIds: [],
      factIds: [],
      content: body,
      body,
      sources: section.sources ?? [],
    });
  });
  return sections;
}

function ensureReportArtifactFigureSlots(
  artifact: unknown,
  args: {
    diagramBriefs: Array<Record<string, unknown>>;
    sourceFigureCandidates: Array<Record<string, unknown>>;
    diagramArtifacts: Array<Record<string, unknown>>;
  },
): unknown {
  const obj = asRecord(artifact);
  if (!obj) return artifact;
  const content = asRecord(obj.content);
  const currentMarkdown = asString(content?.fullMarkdown);
  if (!currentMarkdown) return artifact;
  const fullMarkdown = ensureReportFigureSlots(
    currentMarkdown,
    args.diagramBriefs,
    args.sourceFigureCandidates,
    args.diagramArtifacts,
  );
  if (fullMarkdown === currentMarkdown.trim()) return artifact;
  const metadata = asRecord(obj.metadata);
  return {
    ...obj,
    content: {
      ...(content ?? {}),
      fullMarkdown,
      fullReportSize: Buffer.byteLength(fullMarkdown, "utf8"),
    },
    metadata: {
      ...(metadata ?? {}),
      solarFigureSlotsEnsured: true,
      solarFigureSlotsEnsuredAt: new Date().toISOString(),
      diagramBriefCount: args.diagramBriefs.length,
      sourceFigureCandidateCount: args.sourceFigureCandidates.length,
      diagramArtifactCount: args.diagramArtifacts.length,
    },
  };
}

function ensureReportFigureSlots(
  markdown: string,
  diagramBriefs: Array<Record<string, unknown>>,
  sourceFigureCandidates: Array<Record<string, unknown>>,
  diagramArtifacts: Array<Record<string, unknown>>,
): string {
  if (/^##\s*图表与材料视图\s*$/m.test(markdown)) return markdown.trim();
  const hasImageMarkdown = /!\[[^\]]+\]\([^)]+\)/.test(markdown);
  if (hasImageMarkdown && diagramArtifacts.length === 0) return markdown.trim();
  const figureBlock = buildFigureMarkdown(
    diagramBriefs,
    sourceFigureCandidates,
    diagramArtifacts,
  );
  if (!figureBlock) return markdown.trim();
  const referenceHeading = "\n## 引用资料与置信度";
  const referenceIndex = markdown.indexOf(referenceHeading);
  if (referenceIndex >= 0) {
    return `${markdown.slice(0, referenceIndex).trim()}\n\n${figureBlock}\n${markdown.slice(referenceIndex)}`.trim();
  }
  return `${markdown.trim()}\n\n${figureBlock}`.trim();
}

function buildFigureMarkdown(
  diagramBriefs: Array<Record<string, unknown>>,
  sourceFigureCandidates: Array<Record<string, unknown>>,
  diagramArtifacts: Array<Record<string, unknown>>,
): string | undefined {
  const parts: string[] = [];
  const generated = diagramArtifacts
    .map((artifact, index) => {
      const title =
        asString(artifact.title) ??
        asString(artifact.caption) ??
        `技术图 ${index + 1}`;
      const imagePath =
        asString(artifact.image_path) ??
        asString(artifact.imagePath) ??
        asString(artifact.path);
      const url = asString(artifact.url);
      const src = imagePath ? `file://${imagePath}` : url;
      if (!src) return undefined;
      return `![${title}](${src})\n\n*${title}。*`;
    })
    .filter((item): item is string => !!item);
  parts.push(...generated);

  const sourceImages = sourceFigureCandidates
    .map((candidate) => {
      const imageUrl = asString(candidate.imageUrl);
      if (!imageUrl) return undefined;
      const caption =
        asString(candidate.caption) ??
        asString(candidate.title) ??
        "来源材料图";
      const sourceUrl = asString(candidate.sourceUrl);
      const sourceLine = sourceUrl ? `资料来源：[${caption}](${sourceUrl})` : "资料来源：公开引用材料";
      return `![来源图：${caption}](${imageUrl})\n\n*${sourceLine}。*`;
    })
    .filter((item): item is string => !!item)
    .slice(0, 3);
  parts.push(...sourceImages);

  if (parts.length === 0 && diagramBriefs.length > 0) {
    const rows = diagramBriefs
      .slice(0, 3)
      .map((brief, index) => {
        const title =
          asString(brief.title) ??
          asString(brief.caption) ??
          `图 ${index + 1}`;
        const purpose =
          asString(brief.purpose) ??
          asString(brief.caption) ??
          "解释关键技术结构和投资判断之间的关系";
        const placement =
          asString(brief.placementAfterHeading) ??
          asString(brief.section) ??
          "相关分析章节";
        return `| ${index + 1} | ${escapeTableCell(title)} | ${escapeTableCell(purpose)} | ${escapeTableCell(placement)} |`;
      })
      .join("\n");
    parts.push([
      "| # | 图表 | 用途 | 建议位置 |",
      "|---:|---|---|---|",
      rows,
    ].join("\n"));
  }

  if (parts.length === 0) return undefined;
  return ["## 图表与材料视图", "", ...parts].join("\n\n");
}

function normalizeTechnologyDiagramArtifacts(
  result: SolarOperatorResult,
): Array<Record<string, unknown>> {
  const candidates = [
    ...arrayFromUnknown(result.artifacts),
    result.structured,
  ];
  const seen = new Set<string>();
  return candidates
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item, index): Record<string, unknown> | undefined => {
      const imagePath =
        asString(item.image_path) ??
        asString(item.imagePath) ??
        asString(item.path);
      const url = asString(item.url);
      const key = imagePath ?? url ?? stableHash(item);
      if (seen.has(key)) return undefined;
      seen.add(key);
      return {
        id: asString(item.id) ?? `technology-diagram-${index + 1}`,
        title:
          asString(item.title) ??
          asString(item.caption) ??
          "技术结构图",
        ...item,
      };
    })
    .filter((item): item is Record<string, unknown> => !!item);
}

function normalizeDiagramBriefs(
  raw: unknown,
  thesisGraph: ThesisGraph | undefined,
  topic: string,
): Array<Record<string, unknown>> {
  const direct = arrayFromUnknown(raw)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => !!item)
    .filter((item) => asString(item.caption) || asString(item.title) || asString(item.purpose))
    .slice(0, 4);
  if (direct.length > 0) return direct;
  const firstSection = thesisGraph?.reportOutline?.[0]?.title ?? "分步骤洞察";
  const secondSection = thesisGraph?.reportOutline?.[1]?.title ?? "综合判断与行动建议";
  return [
    {
      id: "system-structure-map",
      title: "技术方向与系统结构图",
      caption: `${topic} 的关键技术层、反馈闭环和控制点关系。`,
      purpose: "帮助读者把技术路线、系统机制和战略含义放到同一张图里理解。",
      diagramType: "architecture_map",
      placementAfterHeading: firstSection,
    },
    {
      id: "investment-hotspot-map",
      title: "投资热点谱系图",
      caption: `${topic} 相关投资热点、参与者和风险信号的谱系。`,
      purpose: "把公司/项目样本、资本关注点、验证风险和机会窗口放到同一张图里。",
      diagramType: "ecosystem_map",
      placementAfterHeading: secondSection,
    },
  ];
}

function collectSourceFigureCandidates(
  researcherResults: ResearcherShape[],
  ledger: ResearchAssetLedger | undefined,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const candidates = [
    ...researcherResults.flatMap((result) =>
      arrayFromUnknown(asRecord(result)?.figureCandidates),
    ),
    ...((ledger?.assets ?? []).flatMap((asset) => [
      ...arrayFromUnknown(asset.payload?.figureCandidates),
      asset.payload,
    ])),
  ];
  return candidates
    .map(normalizeSourceFigureCandidate)
    .filter((item): item is Record<string, unknown> => !!item)
    .filter((item) => {
      const key = [
        asString(item.imageUrl),
        asString(item.sourceUrl),
        asString(item.caption),
      ]
        .filter(Boolean)
        .join("::");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function normalizeSourceFigureCandidate(raw: unknown): Record<string, unknown> | undefined {
  const item = asRecord(raw);
  if (!item) return undefined;
  const sourceUrl = asString(item.sourceUrl) ?? asString(item.source) ?? asString(item.url);
  const imageUrl =
    asString(item.imageUrl) ??
    asString(item.image_url) ??
    asString(item.figureUrl) ??
    asString(item.figure_url);
  const caption =
    asString(item.caption) ??
    asString(item.title) ??
    asString(item.sourceTitle);
  if (!sourceUrl && !imageUrl && !caption) return undefined;
  return {
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(caption ? { caption } : {}),
    ...(asString(item.sourcePageOrSection)
      ? { sourcePageOrSection: asString(item.sourcePageOrSection) }
      : {}),
    ...(asFigureRelevance(item.relevanceHint)
      ? { relevanceHint: asFigureRelevance(item.relevanceHint) }
      : {}),
  };
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function asFigureRelevance(value: unknown): "high" | "medium" | "low" | undefined {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : undefined;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordArrayFromUnknown(value: unknown): Array<Record<string, unknown>> {
  return arrayFromUnknown(value)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => !!item);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
