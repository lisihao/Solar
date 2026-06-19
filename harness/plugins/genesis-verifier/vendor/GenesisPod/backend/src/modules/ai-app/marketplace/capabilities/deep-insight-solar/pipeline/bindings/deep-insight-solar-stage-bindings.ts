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
  type ResearchAssetLedger,
  type TechnologyInsightPlan,
  type ThesisGraph,
} from "../../research-os";

const SOLAR_PIPELINE_ID = "deep-insight-solar";
const PROMPT_VERSION = "deep-insight-solar.research-os.v1";
const OUTPUT_SCHEMA_VERSION = RESEARCH_OS_SCHEMA_VERSION;
const DEFAULT_SOLAR_OUTLINE_TIMEOUT_MS = 180_000;

export const SOLAR_CS_KEY = {
  technologyInsightPlan: "deep-insight-solar.technologyInsightPlan",
  researchContract: "deep-insight-solar.researchContract",
  researchAssetLedger: "deep-insight-solar.researchAssetLedger",
  coverageReport: "deep-insight-solar.coverageReport",
  repairPackets: "deep-insight-solar.repairPackets",
  thesisGraph: "deep-insight-solar.thesisGraph",
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
            requiredOutput:
              "TechnologyInsightPlan { centralQuestion, initialTheses, researchQuestions, workstreams, mandatoryArtifacts, sourcePolicy, coverageRequirements, falsificationQuestions }",
          },
        });
        const technologyInsightPlan = normalizeTechnologyInsightPlan(
          result.structured,
          { topic: input.topic, ...(result.markdown ? { markdown: result.markdown } : {}) },
        );
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
          let researcher: ResearcherShape;
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
            crossStageState.set(SOLAR_CS_KEY.evidenceLedger, mergedLedger.evidenceCards);
            researcher = this.normalizeResearcherResult(
              result.structured,
              result.markdown,
              dimension.name,
              input,
            );
          } catch (err) {
            researcher = {
              dimension: dimension.name,
              findings: [],
              summary: `Solar BrowserResearcher failed for ${dimension.name}: ${formatErrorMessage(err)}`,
            };
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
        // 单维失败由 perItemPipeline 发出终态事件；mission 是否可交付交给 final gate。
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
        const result = await this.invokeOperator({
          input,
          crossStageState,
          stepId: "s6-analyst",
          operatorId: "BrowserAnalyst",
          missionId,
          payload: {
            topic: input.topic,
            technologyInsightPlan,
            researchAssetLedger,
            coverageReport,
            plan,
            researcherResults,
            reconciliation,
            requiredOutput:
              "ThesisGraph { theses[], claimEdges[], evidenceBindings[], counterEvidence[], openQuestions[], reportOutline[] } plus optional diagramBriefs.",
          },
        });
        const thesisGraph = normalizeThesisGraph(result.structured, {
          topic: input.topic,
          ...(researchAssetLedger ? { ledger: researchAssetLedger } : {}),
        });
        crossStageState.set(SOLAR_CS_KEY.thesisGraph, thesisGraph);
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
        const plan = crossStageState.get<PlanShape>(CS_KEY.plan);
        const analyst = crossStageState.get<AnalystShape>(CS_KEY.analystOutput);
        const outlinePlan = crossStageState.get(CS_KEY.outlinePlan);
        const diagramBriefs = crossStageState.get(SOLAR_CS_KEY.diagramBriefs) ?? [];
        const technologyInsightPlan = crossStageState.get<TechnologyInsightPlan>(
          SOLAR_CS_KEY.technologyInsightPlan,
        );
        const researchAssetLedger = crossStageState.get<ResearchAssetLedger>(
          SOLAR_CS_KEY.researchAssetLedger,
        );
        const coverageReport = crossStageState.get<CoverageReport>(
          SOLAR_CS_KEY.coverageReport,
        );
        const thesisGraph = crossStageState.get<ThesisGraph>(SOLAR_CS_KEY.thesisGraph);
        const requiredDimensionMap = this.buildRequiredDimensionMap(plan);
        const result = await this.invokeOperator({
          input,
          crossStageState,
          stepId: "s8-writer",
          operatorId: "BrowserLongformWriter",
          missionId,
          payload: {
            topic: input.topic,
            technologyInsightPlan,
            researchAssetLedger,
            coverageReport,
            thesisGraph,
            plan,
            analyst,
            outlinePlan,
            diagramBriefs,
            requiredDimensionMap,
            instruction:
              [
                "Write from ThesisGraph, not from the legacy dimension list.",
                "Return ReportPackage { executiveBriefMarkdown, standardReportMarkdown, evidenceBook }.",
                "Include a '研究资产到论点映射' section before the main body.",
                "Every core thesis must bind evidenceIds and counterEvidence/openQuestions where available.",
                "Do not create missing-section placeholders; surface gaps as evidence gaps.",
              ].join(" "),
          },
        });
        const reportPackage = normalizeReportPackage(
          result.structured,
          result.markdown,
          {
            topic: input.topic,
            ...(researchAssetLedger ? { ledger: researchAssetLedger } : {}),
            ...(thesisGraph ? { thesisGraph } : {}),
          },
        );
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
            },
          );
          crossStageState.set(CS_KEY.reportArtifact, artifact);
          crossStageState.set(SOLAR_CS_KEY.artifactManifest, {
            diagramBriefs: crossStageState.get(SOLAR_CS_KEY.diagramBriefs) ?? [],
            artifacts: [],
            assembledAt: new Date().toISOString(),
          });
          return Promise.resolve(artifact);
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
            },
          );
          crossStageState.set(CS_KEY.reportArtifact, artifact);
          return Promise.resolve(artifact);
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
            technologyInsightPlan: crossStageState.get(
              SOLAR_CS_KEY.technologyInsightPlan,
            ),
            researchAssetLedger: crossStageState.get(
              SOLAR_CS_KEY.researchAssetLedger,
            ),
            thesisGraph: crossStageState.get(SOLAR_CS_KEY.thesisGraph),
            reportPackage: crossStageState.get(SOLAR_CS_KEY.reportPackage),
            instruction:
              "Independent red-team review. Do not reuse writer context; identify weak theses, missing evidence, counter-evidence, citation gaps, and opportunity claims that are not bottleneck-backed.",
          },
        });
        const memo = this.normalizeRedTeamMemo(result.structured, result.markdown);
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
            memo.criticalIssues.length > 0 || rubric.blockers.length > 0
              ? "revise"
              : "approve",
          score:
            memo.criticalIssues.length > 0 || rubric.blockers.length > 0
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
    const normalizedResult = this.normalizeOperatorResult(result);
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

  private buildRequiredDimensionMap(
    plan: PlanShape | undefined,
  ): Array<{ index: number; id?: string; title: string; rationale?: string }> {
    return (plan?.dimensions ?? [])
      .map((dimension, idx) => ({
        index: idx + 1,
        ...(dimension.id ? { id: dimension.id } : {}),
        title: dimension.name,
        ...(dimension.rationale ? { rationale: dimension.rationale } : {}),
      }))
      .filter((dimension) => dimension.title.trim().length > 0);
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

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalStringify(value))
    .digest("hex")
    .slice(0, 24);
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
  return {
    ...obj,
    content: {
      ...(content ?? {}),
      ...(standardReportMarkdown && !asString(content?.fullMarkdown)
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

function asFigureRelevance(value: unknown): "high" | "medium" | "low" | undefined {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : undefined;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
