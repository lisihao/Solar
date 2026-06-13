# Topic Insights · Pipeline Orchestrator 设计（14 Stages）

> 版本：v1（Gate 2）

---

## 一、Pipeline 执行引擎

### 1.1 顶层入口

```typescript
// pipeline/topic-insights.pipeline.ts

@Injectable()
export class TopicInsightsPipeline {
  constructor(
    @Inject("PIPELINE_STAGES")
    private readonly stages: Array<Stage<any, any>>, // DI-ordered, DAG-aware
    private readonly checkpointStore: CheckpointStore,
    private readonly eventEmitter: ResearchEventEmitterService,
    private readonly budgetService: PipelineBudgetService,
    private readonly logger: Logger,
  ) {}

  async execute(
    input: PipelineInput,
    signal?: AbortSignal,
  ): Promise<PipelineOutput> {
    const identity = await this.buildIdentity(input, signal);
    const results = new StageResults();

    // Resume: load prior stage outputs from DB
    if (input.resumeFromCheckpoint) {
      await results.rebuild(identity.missionId);
    }

    const sortedStages = this.topologicalSort(this.stages);

    for (const stage of sortedStages) {
      if (identity.abortController.signal.aborted) {
        throw new AbortError(`Aborted before ${stage.id}`);
      }

      if (
        await this.checkpointStore.isCompleted(identity.missionId, stage.id)
      ) {
        this.logger.log(`[Pipeline] Skip ${stage.id} (checkpoint exists)`);
        continue;
      }

      if (!stage.runsWhen(identity, results)) {
        this.logger.log(`[Pipeline] Skip ${stage.id} (condition)`);
        continue;
      }

      // Budget degradation
      if (identity.budget.shouldDegrade() && this.isOptional(stage)) {
        this.logger.warn(`[Pipeline] Degrade: skip optional ${stage.id}`);
        continue;
      }

      const stageStart = Date.now();
      try {
        const input = await stage.prepare(identity, results);
        const output = await this.runWithSLO(stage, identity, input);
        await stage.persist(identity, output);
        results.set(stage.id, output);
        await this.checkpointStore.markCompleted(identity.missionId, stage.id);

        this.emitStageEvent(stage, "completed", Date.now() - stageStart);
      } catch (err) {
        if (stage.cleanup) await stage.cleanup(identity);
        this.emitStageEvent(stage, "failed", Date.now() - stageStart, err);
        throw new StageFailedError(stage.id, err);
      }
    }

    return this.finalizeOutput(identity, results);
  }

  private async runWithSLO<I, O>(
    stage: Stage<I, O>,
    identity: PipelineIdentityContext,
    input: I,
  ): Promise<O> {
    const timeout = stage.slo.p99LatencyMs;
    return Promise.race([
      stage.execute(identity, input, identity.abortController.signal),
      new Promise<O>((_, reject) =>
        setTimeout(
          () => reject(new StageTimeoutError(stage.id, timeout)),
          timeout,
        ),
      ),
    ]);
  }
}
```

### 1.2 Topological Sort 要点

Stage DAG 的 `dependsOn` 决定执行顺序；无依赖的 stage 理论上可并行（但 ST-02 内部已经是 per-dimension 并行，stage 间暂不并行）。

---

## 二、14 个 Stage 详细伪代码

### ST-00-INIT · 初始化

> **v2.1 架构补丁（2026-04-23）**：ST-00-INIT 的 `执行` 不再自己拉 `availableModels`。
> `CapabilitySnapshot`（包含 availableModels / availableAgents / availableTools / dbSchema /
> externalDeps / recommendedDepth）由 `runWithHarness` 在 pipeline 入口前通过
> `CapabilityDiscoveryService.snapshot()` 生成，并通过 `PipelineIdentityContext.capabilities` 注入。
> ST-00-INIT 只做 topic metadata / draft report / cachePrefix / dim-lock 这些 pipeline 内部准备。
> 详见 [11-capability-discovery.md](./11-capability-discovery.md)。

```typescript
@Injectable()
class Stage00Initialize implements Stage<St00Input, St00Output> {
  id = "ST-00-INIT" as const;
  name = "Pipeline 初始化";
  dependsOn = [];
  runsWhen = () => true;
  slo = {
    p95LatencyMs: 500,
    p99LatencyMs: 2000,
    maxTokens: 0,
    minSuccessRate: 0.99,
  };
  emitsEvents = ["pipeline.initialized"];

  async prepare(identity, _): Promise<St00Input> {
    return { missionId: identity.missionId, topicId: identity.topicId };
  }

  async execute(identity, input): Promise<St00Output> {
    // ★ v2.1: capabilities 已由 runWithHarness 注入，直接读
    const caps = identity.capabilities;
    const availableModels = caps.availableModels;
    const reachable = [
      ...caps.availableModels.CHAT,
      ...caps.availableModels.REASONING,
    ].filter((m) => m.healthy);

    // CP-1.4: topic metadata + topicType
    const topic = await this.prisma.researchTopic.findUniqueOrThrow({
      where: { id: identity.topicId },
      include: { dimensions: true },
    });

    // CP-1.5: EVENT 类型抽 anchor article
    let anchorContent;
    if (topic.type === "EVENT" && topic.anchorArticleId) {
      anchorContent = await this.evidenceRepo.getArticleContent(
        topic.anchorArticleId,
      );
    }

    // CP-3.7: 创建 draft report
    const latestVersion = await this.prisma.topicReport.findFirst({
      where: { topicId: identity.topicId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const draftReport = await this.prisma.topicReport.create({
      data: {
        topicId: identity.topicId,
        version: (latestVersion?.version ?? 0) + 1,
        executiveSummary: "",
        fullReport: "",
      },
    });

    // CP-C.1: PromptCache prefix
    const cachePrefix = this.promptCache.createPrefix(identity.missionId, {
      topicName: topic.name,
      topicType: topic.type,
      depth: identity.depthConfig.name,
    });

    // CP-M.8: Dimension 重入锁
    for (const dim of topic.dimensions) {
      await this.redis.set(
        `dim:${dim.id}:lock`,
        identity.missionId,
        "NX",
        "EX",
        600,
      );
    }

    return {
      leaderModelId: leaderModel.modelId,
      availableModels: reachable,
      topicMeta: {
        id: topic.id,
        name: topic.name,
        type: topic.type,
        language: topic.language,
        description: topic.description,
        anchorArticleContent: anchorContent,
      },
      existingDimensions: topic.dimensions,
      draftReportId: draftReport.id,
      cachePrefix,
      budget: identity.budget,
    };
  }

  async persist(identity, output): Promise<void> {
    // Already persisted during execute (draftReport created, cachePrefix in coordinator)
    // Update identity's mutable fields
    (identity as any).reportId = output.draftReportId;
  }

  async cleanup(identity): Promise<void> {
    // Release dim locks (called only on pipeline-level failure)
  }
}
```

### ST-01-PLAN · Leader 全局规划

```typescript
class Stage01LeaderPlan implements Stage<St01Input, LeaderPlan> {
  id = "ST-01-PLAN";
  dependsOn = ["ST-00-INIT"];
  slo = {
    p95LatencyMs: 60_000,
    p99LatencyMs: 120_000,
    maxTokens: 30_000,
    minSuccessRate: 0.9,
  };
  emitsEvents = [
    "leader.thinking:understanding",
    "leader.thinking:analyzing",
    "leader.thinking:planning",
    "leader.thinking:completed",
  ];

  constructor(
    private readonly leaderRunner: AG_01_LeaderRunner,
    private readonly emitter: ResearchEventEmitterService,
  ) {}

  async prepare(identity, results): Promise<St01Input> {
    const init = results.get<St00Output>("ST-00-INIT");
    return {
      missionId: identity.missionId,
      topicMeta: init.topicMeta,
      availableModels: init.availableModels,
      existingDimensions: init.existingDimensions,
      userPrompt: identity.userPrompt,
      depthConfig: identity.depthConfig,
    };
  }

  async execute(identity, input, signal): Promise<LeaderPlan> {
    // CP-C.6: 四段事件
    await this.emitter.emitLeaderThinking(identity.topicId, {
      phase: "understanding",
      missionId: identity.missionId,
    });
    await this.emitter.emitLeaderThinking(identity.topicId, {
      phase: "analyzing",
      missionId: identity.missionId,
    });

    const result = await this.leaderRunner.run(
      {
        missionId: identity.missionId,
        ...input,
      },
      signal,
    );

    if (!result.ok || !result.output) {
      throw new Error(`Leader plan failed: ${result.errorMessage}`);
    }

    await this.emitter.emitLeaderThinking(identity.topicId, {
      phase: "planning",
      missionId: identity.missionId,
      content: `规划了 ${result.output.dimensions.length} 个维度`,
    });
    await this.emitter.emitLeaderThinking(identity.topicId, {
      phase: "completed",
      missionId: identity.missionId,
    });

    identity.budget.tokensUsed += result.tokensUsed;
    identity.budget.costUsd += result.costUsd;

    return result.output;
  }

  async persist(identity, output): Promise<void> {
    await this.prisma.researchMission.update({
      where: { id: identity.missionId },
      data: { leaderPlan: output as any },
    });
    // CP-C.10: LeaderDecision audit
    await this.prisma.leaderDecision.create({
      data: {
        missionId: identity.missionId,
        type: "PLAN",
        decision: output as any,
        reasoning: `${output.dimensions.length} dims, ${output.agentAssignments.length} agents`,
      },
    });
    // CP-M.2: progress
    await this.prisma.researchMission.update({
      where: { id: identity.missionId },
      data: { progressPercent: 15 },
    });
  }
}
```

### ST-02-RESEARCH · 维度研究（per-dimension parallel）

```typescript
class Stage02Research implements Stage<St02Input, St02Output> {
  id = "ST-02-RESEARCH";
  dependsOn = ["ST-01-PLAN"];
  slo = {
    p95LatencyMs: 300_000 /* per dim */,
    p99LatencyMs: 600_000,
    maxTokens: 50_000 /* per dim */,
    minSuccessRate: 0.85,
  };

  async execute(identity, input, signal): Promise<St02Output> {
    const { dimensions } = input.leaderPlan;
    const parallelism = Math.min(
      input.leaderPlan.executionStrategy.parallelism,
      3,
    );

    const results = await pMap(
      dimensions,
      async (dim) => {
        // Update dimension status PENDING → RESEARCHING (CP-M.1)
        await this.prisma.topicDimension.update({
          where: { id: dim.id },
          data: { status: "RESEARCHING" },
        });

        try {
          // Sub-steps 2a / 2b / 2c / 2d
          const result = await this.researchOneDimension(
            identity,
            dim,
            input,
            signal,
          );

          await this.prisma.topicDimension.update({
            where: { id: dim.id },
            data: { status: "COMPLETED" },
          });
          return result;
        } catch (err) {
          await this.prisma.topicDimension.update({
            where: { id: dim.id },
            data: { status: "FAILED" },
          });
          return {
            dimensionId: dim.id,
            status: "failed",
            errorMessage: String(err),
            ...zeroStats,
          } as DimensionResearchResult;
        }
      },
      { concurrency: parallelism, signal },
    );

    return results;
  }

  private async researchOneDimension(
    identity,
    dim,
    input,
    signal,
  ): Promise<DimensionResearchResult> {
    // === ST-02A-LITBASE (thorough+) ===
    let litBaseline = [];
    if (identity.depthConfig.literatureBaselineEnabled) {
      litBaseline = await this.dataSourceRouter.scanLiteratureBaseline(
        input.topicMeta,
        dim,
      );
    }

    // === ST-02B-SEARCH ===
    const searchResult = await this.searchOrchestrator.executeForDimension({
      topic: input.topicMeta,
      dimension: dim,
      dataSources: dim.dataSources,
      queries: dim.searchQueries,
      signal,
    });

    // === ST-02C-FIGURE ===
    const figures = await this.figureExtractor.extractFromSearchResults(
      searchResult.items,
    );
    const upgradedFigures =
      await this.figureExtractor.validateAndUpgradeFigures(figures);

    // === ST-02D-EVIDENCE ===
    const evidenceInput = buildEvidenceForPersistence(
      searchResult.items,
      upgradedFigures,
    );
    const savedEvidences = await this.evidencePersistence.saveBatch({
      reportId: identity.reportId,
      dimensionId: dim.id,
      items: evidenceInput,
      credibilityAssessor: assessCredibility, // UT-CRED-ASSESS
    });

    // CP-2.6c: evidenceUsed from DB count
    const evidenceUsed = await this.prisma.topicEvidence.count({
      where: { reportId: identity.reportId, dimensionId: dim.id },
    });

    return {
      dimensionId: dim.id,
      status: "completed",
      evidenceSavedCount: savedEvidences.length,
      figuresSavedCount: upgradedFigures.length,
      literatureBaselineFound: litBaseline.length,
      searchStats: searchResult.stats,
    };
  }

  async persist(identity, output): Promise<void> {
    // Evidence & figures already persisted during execute.
    // Update mission progress
    await this.prisma.researchMission.update({
      where: { id: identity.missionId },
      data: { progressPercent: 35 },
    });
  }
}
```

### ST-03-WRITE · 章节写作（per-section parallel）

```typescript
class Stage03Write implements Stage<St03Input, St03Output> {
  id = "ST-03-WRITE";
  dependsOn = ["ST-02-RESEARCH"];

  async prepare(identity, results): Promise<St03Input> {
    const leaderPlan = results.get<LeaderPlan>("ST-01-PLAN");
    const researchResults = results.get<St02Output>("ST-02-RESEARCH");

    // === ST-03A: DimensionPlanner 为每个 dim 出 outline (Enhancement Tier) ===
    const outlines = new Map<string, DimensionOutline>();
    for (const dim of leaderPlan.dimensions) {
      if (
        this.dimensionPlannerRunner &&
        identity.depthConfig.planDimensionOutline !== false
      ) {
        const result = await this.dimensionPlannerRunner.run({
          missionId: identity.missionId,
          dimensionId: dim.id,
          dimensionName: dim.name,
          dimensionDescription: dim.description,
          allDimensions: leaderPlan.dimensions,
          researchDepth: identity.depthConfig.name,
        });
        if (result.ok && result.output) {
          outlines.set(dim.id, result.output);
        }
      }
      // Fallback: single-section outline if Enhancement Tier not deployed
      if (!outlines.has(dim.id)) {
        outlines.set(dim.id, fallbackOutline(dim));
      }
    }

    return { leaderPlan, researchResults, outlines };
  }

  async execute(identity, input, signal): Promise<St03Output> {
    const dimensionSections = new Map<string, SectionResult[]>();

    for (const dim of input.leaderPlan.dimensions) {
      const outline = input.outlines.get(dim.id)!;

      // Build dependency graph of sections
      const dag = buildSectionDAG(outline.sections);

      const sections: SectionResult[] = [];
      for (const batch of dag) {
        // Parallel within batch (sections with no cross-dep)
        const batchResults = await pMap(
          batch,
          async (sectionPlan) => {
            const result = await this.sectionWriterRunner.run(
              {
                missionId: identity.missionId,
                topic: input.topic,
                dimension: dim,
                sectionPlan,
                evidenceSummary: await this.buildEvidenceSummary(
                  dim.id,
                  identity.reportId,
                ),
                figureSummary: await this.buildFigureSummary(
                  dim.id,
                  identity.reportId,
                ),
                upstreamSectionSummaries: sections
                  .filter((s) => sectionPlan.dependsOn?.includes(s.sectionId))
                  .map((s) => ({
                    id: s.sectionId,
                    title: s.title,
                    summary: s.content.slice(0, 300),
                  })),
              },
              signal,
            );

            if (!result.ok || !result.output)
              throw new Error(
                `Section ${sectionPlan.id} failed: ${result.errorMessage}`,
              );

            // ST-03C: post-process (CP-2.9 utilities)
            let content = result.output.content;
            content = numberSubHeadings(content, dim.sortOrder);
            content = sanitizeSectionOutput(content);
            content = applyOpeningConclusionRules(content);

            return { ...result.output, content };
          },
          { concurrency: identity.depthConfig.sectionParallelism ?? 2, signal },
        );
        sections.push(...batchResults);
      }

      dimensionSections.set(dim.id, sections);
    }

    return { dimensionSections: Object.fromEntries(dimensionSections) };
  }

  async persist(identity, output): Promise<void> {
    for (const [dimId, sections] of Object.entries(output.dimensionSections)) {
      await this.prisma.dimensionAnalysis.upsert({
        where: {
          dimensionId_reportId: {
            dimensionId: dimId,
            reportId: identity.reportId,
          },
        },
        create: {
          dimensionId: dimId,
          reportId: identity.reportId,
          summary: "",
          keyFindings: [],
          dataPoints: { sections } as any,
          sourcesUsed: 0,
        },
        update: { dataPoints: { sections } as any },
      });
    }
    await this.prisma.researchMission.update({
      where: { id: identity.missionId },
      data: { progressPercent: 55 },
    });
  }
}
```

### ST-04-REVIEW · 审核 + 修订（while loop + 早停）

```typescript
class Stage04Review implements Stage<St04Input, St04Output> {
  id = 'ST-04-REVIEW';
  dependsOn = ['ST-03-WRITE'];

  async execute(identity, input, signal): Promise<St04Output> {
    const maxRounds = identity.depthConfig.maxRevisionRounds; // CP-2.10
    const earlyStopThreshold = 80; // CP-2.10: 早停
    const reviewsPerDim = new Map<string, SectionReview[]>();
    let totalRevisions = 0;
    const earlyStopped: string[] = [];

    for (const [dimId, sections] of Object.entries(input.dimensionSections)) {
      const dimReviews: SectionReview[] = [];

      for (const section of sections) {
        let currentSection = section;
        let review: SectionReview | undefined;

        for (let round = 1; round <= maxRounds; round++) {
          const reviewResult = await this.sectionReviewerRunner.run({
            missionId: identity.missionId,
            sectionResult: currentSection,
            sectionPlan: /* from outline */,
            dimensionContext: { name: input.dimNameMap[dimId], description: '' },
            revisionRound: round,
            priorReview: review,
          }, signal);

          if (!reviewResult.ok || !reviewResult.output) break;
          review = reviewResult.output;

          // CP-2.10 早停
          if (review.overallScore >= earlyStopThreshold) {
            earlyStopped.push(`${dimId}.${section.sectionId}`);
            break;
          }

          if (round < maxRounds && review.needsRevision) {
            // Revise
            const revised = await this.sectionWriterRunner.run({
              /* same input but with revisionInstructions */
            }, signal);
            if (revised.ok && revised.output) {
              currentSection = revised.output;
              totalRevisions++;
            }
          }
        }

        if (review) dimReviews.push(review);
      }

      reviewsPerDim.set(dimId, dimReviews);
    }

    return {
      dimensionReviews: Object.fromEntries(reviewsPerDim),
      revisionsApplied: totalRevisions,
      earlyStoppedDimensions: earlyStopped,
    };
  }

  async persist(identity, output): Promise<void> {
    for (const [dimId, reviews] of Object.entries(output.dimensionReviews)) {
      await this.prisma.dimensionAnalysis.update({
        where: { dimensionId_reportId: { dimensionId: dimId, reportId: identity.reportId } },
        data: { dataPoints: { ...existing, sectionReviews: reviews } as any },
      });
    }
    await this.prisma.researchMission.update({
      where: { id: identity.missionId }, data: { progressPercent: 70 },
    });
  }
}
```

### ST-05-INTEGRATE · 维度合并 + Meta 提取

```typescript
class Stage05Integrate {
  async execute(
    identity,
    input,
    signal,
  ): Promise<Record<string, DimensionMeta>> {
    const metas: Record<string, DimensionMeta> = {};
    for (const [dimId, sections] of Object.entries(input.dimensionSections)) {
      // CP-2.13a: UT-ASM-INTEGRATE (pure util)
      const integrated = integrateDimensionSections(sections);
      // CP-2.13b: AG-05-ME
      const metaResult = await this.metaExtractorRunner.run(
        {
          missionId: identity.missionId,
          dimensionId: dimId,
          integratedSections: integrated,
          evidenceCount: await countDimensionEvidence(dimId, identity.reportId),
        },
        signal,
      );
      if (metaResult.ok && metaResult.output) metas[dimId] = metaResult.output;
    }
    return metas;
  }
  async persist(identity, output): Promise<void> {
    for (const [dimId, meta] of Object.entries(output)) {
      await this.prisma.dimensionAnalysis.update({
        where: {
          dimensionId_reportId: {
            dimensionId: dimId,
            reportId: identity.reportId,
          },
        },
        data: { summary: meta.summary, keyFindings: meta.keyFindings as any },
      });
    }
    await this.prisma.researchMission.update({
      where: { id: identity.missionId },
      data: { progressPercent: 80 },
    });
  }
}
```

### ST-06-COGLOOP · V5 认知循环（thorough+）

```typescript
class Stage06CogLoop {
  runsWhen = (ctx) => ctx.depthConfig.maxCognitiveLoops > 0;

  async execute(identity, input, signal): Promise<St06Output> {
    const maxLoops = identity.depthConfig.maxCognitiveLoops;
    let evidenceSummary = /* collect from existing */;
    const allClaims = /* collect from section reviews */;
    let verified = 0, disputed = 0, unverified = 0;
    let gapsFound = 0, supplemented = 0;

    for (let loop = 0; loop < maxLoops; loop++) {
      // 6a: HypothesisVerifier
      const hv = await this.hypothesisVerifierRunner.run({
        missionId: identity.missionId,
        claims: allClaims, evidenceSummary,
      }, signal);
      if (!hv.ok) break;
      verified = hv.output.stats.verified;
      disputed = hv.output.stats.disputed;
      unverified = hv.output.stats.unverified;

      const unverifiedList = hv.output.verifications.filter(v => v.status !== 'verified');
      if (unverifiedList.length === 0) break; // 全验证通过

      // 6b: GapSearcher
      const gs = await this.gapSearcherRunner.run({
        missionId: identity.missionId,
        unverifiedClaims: unverifiedList, existingEvidenceSummary: evidenceSummary,
      }, signal);
      if (!gs.ok || !gs.output.queries.length) break;
      gapsFound += gs.output.queries.length;

      // 6c: 补充搜索（直接调 SearchOrchestrator）
      const newEvidence = [];
      for (const q of gs.output.queries) {
        const r = await this.searchOrchestrator.executeQuery(q.query, q.searchType, { limit: 3 });
        newEvidence.push(...r);
      }
      if (newEvidence.length === 0) break;
      supplemented += newEvidence.length;

      // Save new evidence
      await this.evidencePersistence.saveBatch({
        reportId: identity.reportId, items: newEvidence,
      });

      evidenceSummary = rebuildSummary(evidenceSummary, newEvidence);
      // Loop 回 6a
    }

    return { loopsRun: loop, claimsValidated: allClaims.length,
             gapsFound, supplementaryEvidenceAdded: supplemented,
             finalValidationStats: { verified, disputed, unverified } };
  }
}
```

### ST-07-SYNTH · 报告合成

```typescript
class Stage07Synth {
  async prepare(identity, results): Promise<St07Input> {
    const metas = results.get<Record<string, DimensionMeta>>('ST-05-INTEGRATE');
    const cogOutput = results.has('ST-06-COGLOOP') ? results.get('ST-06-COGLOOP') : undefined;

    // Optional: run AG-06-QR overall scope first (informs synthesis)
    let overallReview;
    if (identity.depthConfig.runOverallReviewBeforeSynth) {
      const qr = await this.qualityReviewerRunner.run({
        missionId: identity.missionId, scope: 'overall',
        dimensionMetas: Object.values(metas),
      });
      if (qr.ok) overallReview = qr.output;
    }

    // Optional: run AG-10-FX (Enhancement)
    let crossFacts;
    if (this.factExtractorRunner) {
      const fx = await this.factExtractorRunner.run({
        missionId: identity.missionId, dimensionMetas: Object.values(metas),
      });
      if (fx.ok) crossFacts = fx.output;
    }

    return { metas, overallReview, crossFacts, topic: /* from ctx */ };
  }

  async execute(identity, input, signal): Promise<SynthesisResult> {
    const result = await this.synthesizerRunner.run({
      missionId: identity.missionId,
      topic: input.topic,
      dimensionMetas: Object.values(input.metas),
      integratedSectionsPerDim: buildIntegratedMap(input.metas),
      crossDimensionFacts: input.crossFacts?.facts,
      overallReview: input.overallReview,
    }, signal);
    if (!result.ok || !result.output) throw new Error(`Synth failed: ${result.errorMessage}`);
    return result.output;
  }

  async persist(identity, output): Promise<void> {
    await this.prisma.topicReport.update({
      where: { id: identity.reportId },
      data: {
        executiveSummary: output.executiveSummary,
        fullReport: output.fullMarkdown,
        highlights: output.highlights as any,
      },
    });
    await this.prisma.researchMission.update({
      where: { id: identity.missionId }, data: { progressPercent: 88 },
    });
  }
}
```

### ST-08-QGATE · 质量硬门 + 修复 loop

```typescript
class Stage08QGate {
  async execute(identity, input, signal): Promise<QualityGateReport> {
    const maxRemediation = 2;
    let content = input.synthesisResult.fullMarkdown;

    for (let attempt = 0; attempt <= maxRemediation; attempt++) {
      const report = evaluateQualityGate(content, {  // UT-QG-EVAL
        rules: ALL_QUALITY_RULES,
        evidenceCount: input.evidenceCount,
        plan: input.leaderPlan,
      });

      if (report.passed || attempt === maxRemediation) {
        return { ...report, remediationsApplied: attempt };
      }

      // AG-12-SREM: fix violations
      const remediation = await this.sectionRemediatorRunner.run({
        missionId: identity.missionId,
        originalContent: content,
        violations: report.rulesChecked.flatMap(r => r.violations ?? []),
        availableEvidence: /* from DB */,
      }, signal);
      if (!remediation.ok) break;
      content = remediation.output!.fixedContent;
    }

    // Re-synth after remediation? No — just save fixed content
    await this.prisma.topicReport.update({
      where: { id: identity.reportId }, data: { fullReport: content },
    });
    return { ...lastReport, remediationsApplied: attempt };
  }
}
```

### ST-09, ST-10, ST-11, ST-12, ST-13, ST-14

（略写，patterns 相同：从 results 拿上游输出，调 agent runner 或 utility，结构化 persist）

**ST-11-ASM 关键点**：

- UT-ASM-FULL: `buildFullReportFromDimensions(metas, synthesis, assembler_config)`
- UT-ASM-TOC: `buildTableOfContents(content)`
- UT-FIG-INSERT: 替换 `<!-- chart:X -->` 占位为真实 figure URL
- UT-CIT-FORMAT: 统一引用格式

**ST-13-PERSIST**:

- 最终 TopicReport.update：totalSources, generationTimeMs
- CP-M.6: 扣费 (Credits.deduct based on `budget.costUsd`)
- CP-M.5: 写 changesFromPrev（如果 incremental mode）
- emitReportSynthesisCompleted
- `progressPercent: 100`, `status: COMPLETED`

**ST-14-CLEANUP**:

- release cache prefix
- release dim locks
- autoDream.notifySessionCompleted
- 记录 final budget usage

---

## 三、SLO 监控

每个 stage 执行完上报：

```typescript
metrics.record({
  stageId: stage.id,
  missionId,
  latencyMs,
  tokensUsed,
  success,
});
```

监控系统（Prometheus / DataDog）：

- `topic_insights_stage_latency_p95{stage_id}` 持续 > SLO 触发告警
- `topic_insights_stage_error_rate{stage_id}` > 1 - SLO 触发告警
- 连续 3 个 mission 触发自动回退 flag（CP-原则 8）

---

## 四、Pipeline Module DI 注册

```typescript
// pipeline/pipeline.module.ts

@Module({
  imports: [PrismaModule, AiEngineModule, /* ... */],
  providers: [
    TopicInsightsPipeline,
    CheckpointStore,
    PipelineBudgetService,
    // 14 stages
    Stage00Initialize, Stage01LeaderPlan, Stage02Research,
    Stage03Write, Stage04Review, Stage05Integrate,
    Stage06CogLoop, Stage07Synth, Stage08QGate,
    Stage09Eval, Stage10FactCheck, Stage11Assemble,
    Stage12LatexRepair, Stage13Persist, Stage14Cleanup,
    // Runners (17 agents) — DI
    { provide: 'PIPELINE_STAGES', useFactory: (...stages) => stages, inject: [
      Stage00Initialize, ...  // 顺序无关，execute 时做 topological sort
    ] },
  ],
  exports: [TopicInsightsPipeline],
})
export class PipelineModule {}
```
