# Writing Pipeline 迁移施工规格（mission-pipeline 化）

> 目标：把 AI Writing 的编排层从 `IWritingTaskExecutor` + executorMap 形态，迁移到
> ai-harness `MissionPipelineOrchestrator` + `BusinessTeam*Framework` 形态，对齐
> social / radar / agent-playground 的金标准。**领域能力层（quality / bible /
> consistency / content-engine / parallel）原样保留**，只降为 `MissionDeps` 注入项，
> 由 stage 调用。
>
> 锁定决策（不可推翻）：
>
> 1. 大爆炸重写编排层，"保留老路 → 新路全建 → B5 单点切换 → B6 删旧"。
> 2. `full_story` 为超集 pipeline，其余 task type 走 step 子集。
> 3. 领域 service 原样保留，降为 deps 注入。
> 4. s7 质量保持 post-gen（只从 executor 搬到 stage，不改质量逻辑）。
> 5. 产物：单个 `WritingArtifact` 含 `sections[]`（逐章）+ `metadata` + `quality`，配 projector 多视图。
> 6. 目标目录：`writing/mission/{pipeline,context,roles,agents,projectors,runtime}/`，对齐 social/radar。
>
> **模板归属总结**：编排骨架照 **social**（空 ctor business-orchestrator、framework 标准 bridge、极简 config）；
> stage 内部四件套（lifecycle / narrate / tickCost / markIntermediateState）照 **agent-playground**；
> s4 逐章 fan-out 照 **radar 的 DISCOVERY 分轮 + 复用现有 ParallelOrchestrator/ChapterDependency**。

---

## 0. 现状与目标态对照

| 维度     | 现状（老路，保留至 B6）                                                                     | 目标态（新路，B0-B4 建）                                                                     |
| -------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 编排入口 | `WritingMissionExecutionService.executeWithExecutorMap()` → `executorMap.get(missionType)`  | `WritingPipelineDispatcher.runMission()` → `MissionPipelineOrchestrator.run({ pipelineId })` |
| 执行单元 | `IWritingTaskExecutor.execute(ctx)`（full-story / single-chapter / …）                      | `runXxxStage(ctx, deps)` free 函数（playground 形态）                                        |
| LLM 调用 | executor 内直接 `chatFacade.chat(...)` 拼 prompt（Agent 类只被静态成员间接复用）            | stage → role service → `AgentInvoker.invoke(Spec, input, ctx)`，Spec 为 `@DefineAgent`       |
| 上下文   | `WritingTaskContext`（扁平 interface）                                                      | `MissionContext = MissionInvariants & ...PhaseCtx`（mutable 状态包，按 phase 拆）            |
| 产物     | `WritingTaskResult{ content, shouldPersist }`，executor 自己逐章落库                        | `WritingArtifact{ sections[], metadata, quality }` + projector 投影多视图                    |
| 入口路由 | controller `POST projects/:id/missions` → coordinator → lifecycle → execution → executorMap | 同入口，但 execution 改调 dispatcher（B5 单点切换）                                          |

**关键不变量（迁移不得破坏）**：

- controller 58 个 REST 路由 + gateway 2 个 `@SubscribeMessage` 中，**只有执行链路被改**：
  `POST projects/:projectId/missions`（start）/ `GET missions/:missionId`（status）/
  `POST missions/:missionId/cancel`（cancel）三条 + 它们背后的 coordinator/lifecycle/execution。
  其余 55 条（project / character / volume / chapter / bible / annotation / import CRUD）**零改动**。
- `WritingMission` Prisma model 不改 schema（除非中间状态存不下，见风险 §4.2）。

---

## 1. WRITING_PIPELINE step 设计（以 full_story 为超集锚点）

### 1.1 primitive 取值约束

框架 `StagePrimitiveId` 仅 9 个合法值：
`"plan" | "research" | "assess" | "synthesize" | "draft" | "review" | "signoff" | "persist" | "learn"`。

social 全程用 `"persist"`（理由：每个 stage 都是「读写 ctx + side-effect」，与 `hooks.persist(...)` 单 hook 形态天然契合，且 `roles:[]` 时 persist 不需要 `ResolvedRole`）。
**writing 同样全程用 `"persist"`**——所有 LLM 调用都发生在 stage adapter 内部（stage → role service → invoker），config 只声明顺序 + 元数据，不需要框架按 primitive 语义分流。这样 `roles:[]`、business-orchestrator 空 ctor、直接吃 framework 默认 `adaptRunnerToHooks`（primitive=persist → 写 `hooks.persist`，单 hook）。

> 备选（不采用）：若未来要让 s2/s5 走框架 `draft`/`review` 语义以接 framework 自带评分/重试，再改 primitive 并补 `roles[]`。当前锁定决策 4「s7 质量逻辑不改」意味着 review 仍在 stage 内手写，故无需 `review` primitive。

### 1.2 WRITING_PIPELINE 超集 step 列表（full_story）

> id 命名对齐 social（`sN-<动词短语>`）；role 列描述该 stage 主导的领域角色（非框架 ResolvedRole，仅文档语义）；
> ctx 字段对应 `context/mission-context.ts` 的 Phase ctx（§3 定义）。
> checkpoint = 该 stage 完成后必须 `markIntermediateState` 持久化中间产物，使 cascade-rerun 能从 DB 回灌。

| step id                  | primitive | role（语义）         | 复用领域 dep                                                                                                                                                                                      | ctxReads                                        | ctxWrites                                          | checkpoint              |
| ------------------------ | --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- | ----------------------- |
| `s1-mission-budget-eval` | persist   | guardrail            | `MissionBudgetPool`（facade）, `invoker.tickCost`                                                                                                                                                 | invariants(missionId,userId,input,pool)         | `budgetEval`                                       | 是                      |
| `s2-world-build`         | persist   | bible-keeper         | `WorldBuildingEnhancerService`, `WritingJsonParserService`, `StoryBibleService`/`CharacterService`/`WorldSettingService`（落库）                                                                  | input, budgetEval                               | `worldSettings`, `bibleSnapshot`                   | 是                      |
| `s3-outline-plan`        | persist   | story-architect      | `WritingJsonParserService`, `WritingTextProcessorService`, prisma(writingVolume/Chapter upsert)                                                                                                   | worldSettings, bibleSnapshot                    | `outlinePlan`, `chapterPlan[]`                     | 是                      |
| `s4-chapter-fanout`      | persist   | writer（并行）       | `ChapterDependencyService.analyze`, `ParallelOrchestratorService`(分轮), `WriterPoolService`, **WriterAgent 链路** + 逐章 quality 串（expressionMemory/openingHook/narrativeCraft/textProcessor） | outlinePlan, chapterPlan, bibleSnapshot         | `chapterDrafts[]`（逐章追加）, `chapterFailures[]` | 是（**逐章**，见 §1.4） |
| `s5-consistency-check`   | persist   | consistency-checker  | `ConsistencyCheckerAgent` 链路 + `SemanticConsistencyService`, `FactExtractorService`, `ConsistencyEngineService`                                                                                 | chapterDrafts                                   | `consistencyIssues[]`, `extractedFacts[]`          | 是                      |
| `s6-edit-polish`         | persist   | editor               | `EditorAgent` 链路 + `QualityGateService`, `ChapterQualityEvaluatorService`                                                                                                                       | chapterDrafts, consistencyIssues                | `revisedChapters[]`, `editStats`                   | 是                      |
| `s7-quality-evaluate`    | persist   | reviewer（post-gen） | `QualityGateService`, `ChapterQualityEvaluatorService`, `NarrativeCraftService`, `StoryCompletionDetectorService`                                                                                 | revisedChapters                                 | `qualityMetrics`, `qualityVerdict`                 | 是                      |
| `s8-mission-persist`     | persist   | persist              | `WritingPersistence.saveGeneratedContent`, prisma(writingChapter FINAL / project wordCount), `projector` 投影 WritingArtifact                                                                     | revisedChapters, qualityMetrics, extractedFacts | `writingArtifact`, `trajectoryStored`              | 是                      |

`defaultStepTimeoutMs: 10 * 60_000`；逐 step `timeoutMs` 参考 social（world/outline ~120s，逐章 fanout 是大头需 `30 * 60_000`，consistency/edit ~300s，persist ~60s）。
`meta: { description: "AI Writing Full-Story Mission", eventPrefix: "writing", runtimeVersion: "writing-pipeline-v1" }`。

> s2「世界观落库」对应 FullStoryExecutor Phase 1（`worldBuildingEnhancer` → `jsonParser.parseWorldSettings` → `saveWorldToDatabase` 事务）。
> s3 对应 Phase 2（`generateOutline` → `jsonParser.parseOutlineJSON` → `createOutlineStructure`）。
> s4 对应 Phase 3 逐章循环（这是唯一 fan-out 的 stage，承载 FullStory 最重的逐章质量串）。
> s5/s6/s7 把现状「写完即逐章质量校验」拆成显式 stage（post-gen，逻辑不动，只搬位置）。
> s8 把现状「executor 自己逐章落库 + shouldPersist=false」收敛成显式 persist stage + WritingArtifact 投影。

### 1.3 其它 task type 走子集（不新增 pipeline，用 `resumeFromStepId` / 单独 pipeline id）

`full_story` 是超集。其它 type 用**独立 pipeline id 但复用同一批 stage runner**（resolveStageRunner 按 stepId 路由，stepId 全局唯一即可跨 pipeline 复用）：

| TS missionType      | pipeline                       | 走哪些 step                      | 说明                                                                                            |
| ------------------- | ------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `full_story`        | `WRITING_PIPELINE`             | s1→s8 全量                       | 超集                                                                                            |
| `chapter`（single） | `WRITING_CHAPTER_PIPELINE`     | s1 → s4(单章模式) → s5 → s6 → s8 | SingleChapterExecutor 现状仅 chat+落库；过渡期 s4 单章 = 不走 fan-out 的退化分支；s2/s3/s7 跳过 |
| `outline`           | `WRITING_OUTLINE_PIPELINE`     | s1 → s2 → s3 → s8                | 只到大纲，不写正文                                                                              |
| `consistency_check` | `WRITING_CONSISTENCY_PIPELINE` | s1 → s5 → s8                     | 对已有章做一致性检查                                                                            |
| `revision` / `edit` | `WRITING_EDIT_PIPELINE`        | s1 → s5 → s6 → s8                | 对已有章修订/润色（edit 是 TS-only 值，DB 映射回 CHAPTER，见 §4.2）                             |

> 子集实现选型（B2 决策）：优先**多个 `defineMissionPipeline`（各自挑 steps 子集）**，避免 `resumeFromStepId` 的隐式跳步语义（resumeFrom 设计用于 cascade-rerun 续跑，不宜借用为 type 路由）。每个 pipeline 在 dispatcher.onModuleInit 各 `registry.register(buildPipelineWithHooks(...))`。
> dispatcher 按 `input.missionType` 选 pipelineId（类比 social `selectSocialPipeline(depth)`）→ `selectWritingPipeline(missionType)`。

### 1.4 逐章 fan-out + checkpoint（s4 关键设计，照 radar DISCOVERY + 复用现有并行 service）

s4 是唯一 fan-out stage。设计：

1. `ChapterDependencyService.analyze(chapterPlan)` → 依赖图（已 public，复用）。
2. 分轮：复用 `ParallelOrchestratorService` 的分轮逻辑——但 `generateExecutionPlan` 当前是 **private**，B2 需将其**提为 public**（最小改动，仅可见性，见风险 §4.4），或在 s4 stage 内重写拓扑分轮（≤30 行）。决策：**提为 public**（避免逻辑重复）。
3. 每轮内 `Promise.all` 逐章：`writerPool.acquire()` → WriterAgent 链路（WriterService.write → invoker.invoke(WriterAgent)）→ 逐章 quality 串（s4 内联现状 FullStory Phase3 顺序：`contextService.generateQualityConstraints` → `expressionMemory.generateAvoidancePrompt` → write → `openingHook`(ch1) → `narrativeCraft.analyzeContent/rewriteEnding` → `textProcessor.countWords`）→ `writerPool.release()`。
4. **逐章 checkpoint**：每写完一章立即 `deps.store.markIntermediateState(missionId, { chapterDrafts: [...prev, draft] }, userId)`（append 语义），失败章入 `chapterFailures[]` 走 `markStageDegraded`（软失败不阻断后续章，对齐 playground「provider 层 fail-loud，LLM 内部空产物兜底」）。
5. abort：每章前查 `ctx.signal?.aborted`（framework `adaptRunnerToHooks` 在 stage 入口已查一次，长循环内需自查）→ throw `StageAbortError`。

> 与 social 差异：social 无 fan-out（每 stage 单产物）。writing s4 是「stage 内并行子任务」，这点更接近 radar DISCOVERY 的多目标，但 radar 也不做 stage 内并发——**writing s4 的逐章并发 + 逐章 checkpoint 是本迁移独有，需在 B2 spec 中显式测试**（见风险 §4.1）。

---

## 2. 5 个 Agent 迁到 `@DefineAgent` 的计划

现状 5 个 Agent 继承 `BaseAgent<TIn,TOut>`（核心 `doExecute(input, ctx)` + `callLLM`）。
目标：迁到 `AgentSpec<typeof Input, typeof Output>` + `@DefineAgent`（playground `quick-view-synthesizer.agent.ts` 形态），
唯一须实现 `buildSystemPrompt({ input })`；LLM 调用由 invoker/runner 接管（不再 stage/executor 内手拼 chat）。
zod schema 严格对齐现状 interface 字段（`.min(1)` 防空数组穿透，关键输出字段非 optional 以触发 self-heal）。

> 共享类型 `WritingContextPackage` / `ChapterWritingContext` / `WritingCharacterEntity` / `CharacterStateSnapshot` /
> `TimelineEventEntity`（`interfaces/writing-context.interface.ts`）是最大依赖面：zod 化时优先用
> `z.custom<WritingContextPackage>()` 包住既有 TS 类型（避免重写整棵 schema），仅对 Agent 真正读写的子字段展开校验。

| agentId             | 源文件                                | DefineAgent.id                | loop / taskProfile                                      | zod input 字段（对齐现状）                                                                                                                                                                                                                                                            | zod output 字段（对齐现状）                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------- | ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| story-architect     | `agents/story-architect.agent.ts`     | `writing.story-architect`     | react / {creativity:medium, outputLength:extended}      | `taskType`(enum plan_story/plan_volume/decompose_chapters/review_chapter/resolve_conflict), `projectId`, `contextPackage`(custom), `payload`{userRequirements?, volumeInfo?{volumeNumber,synopsis?,targetChapters?}, reviewData?{chapterId,content,consistencyReport?}, conflicts?[]} | `taskType`, `success`, `result`{storyOutline?{premise,theme,structure[]}, chapterBreakdown?[{chapterNumber,title,outline,involvedCharacters[],keyEvents[],dependsOn[],canParallel}], reviewResult?{approved,feedback,requiredChanges?,newEstablishedFacts?[]}, conflictResolution?[]}, nextSteps?[] |
| bible-keeper        | `agents/bible-keeper.agent.ts`        | `writing.bible-keeper`        | react / {creativity:low, outputLength:medium}           | `operation`(enum 8: query\_\*/update_character_state/add_timeline_event/validate_change/get_snapshot), `projectId`, `contextPackage`, `params`{characterName?,characterId?,worldCategory?,timeRange?,term?,newState?,sourceChapterId?,newEvent?,proposedChange?}                      | `operation`, `success`, `result`{character?,characters?[],worldSettings?[],timelineEvents?[],terminology?{term,definition,variants?},snapshot?,validation?{valid,conflicts[],suggestions[]}}, warnings?[]                                                                                           |
| writer              | `agents/writer.agent.ts`              | `writing.writer`              | react / {creativity:high, outputLength:long}            | `chapterId`, `contextPackage`, `chapterContext`(custom ChapterWritingContext), `writerInstanceId?`                                                                                                                                                                                    | `chapterId`, `content`(string,必填), `wordCount`(number), `metadata`{involvedCharacters[],locations[],storyTime?,settingUpdates?[]}, `checkpoints`[{type,description,location}]                                                                                                                     |
| consistency-checker | `agents/consistency-checker.agent.ts` | `writing.consistency-checker` | react / {creativity:deterministic, outputLength:medium} | `chapterId`, `content`(string), `contextPackage`, `checkTypes?`(enum[] CHARACTER/TIMELINE/WORLD/TERMINOLOGY/PLOT), `checkerInstanceId?`                                                                                                                                               | `chapterId`, `status`(enum PASSED/ISSUES_FOUND), `issues`[{type,severity,location,description,expected?,found?,suggestion?,relatedEntities?}], `summary`{total,byType,bySeverity}, `suggestions[]`, extractedFacts?[{statement,category,relatedEntities[],importance}]                              |
| editor              | `agents/editor.agent.ts`              | `writing.editor`              | react / {creativity:medium, outputLength:long}          | `operation`(enum fix_issues/polish/unify_style/final_review), `chapterId`, `content`(string), `contextPackage`, `params`{issues?:ConsistencyIssue[],leaderFeedback?,targetStyle?{tone?,vocabulary?,sentenceLength?},polishLevel?}                                                     | `chapterId`, `operation`, `success`, `revisedContent`(string,必填), `changes`[{type,description,before?,after?}], `stats`{totalChanges,fixedIssues,wordCountBefore,wordCountAfter}, notes?[]                                                                                                        |

**迁移要点（每 agent 通用）**：

- 现状 `BaseAgent` 的构造依赖（如 WriterAgent 的 11 个 quality service、Architect 的 QualityGateService）**不再注入 Agent**——Agent 只负责 LLM 形态（systemPrompt + schema）。原依赖的「约束生成」逻辑搬到 **stage 内（调领域 dep）**，把生成好的约束文本作为 input 字段喂给 Agent。这与 playground「stage 调 role service，role service 薄包 invoker」一致。
- `parseJsonResponse` / 续写重试 / `chatWithSkills` 等 BaseAgent 能力，由 runner + outputSchema self-heal 替代；Writer 的「字数不足续写 ≤2 次」逻辑保留在 **s4 stage**（不是 Agent 内），因为它依赖 narrativeCraft 校验。
- `ConsistencyIssue` / `ConsistencyCheckType` / `IssueSeverity`（consistency-checker 导出，被 editor 复用）→ 抽到 `context/` 或保留在 agent 文件 export，zod enum 与之对齐。
- role service 层（薄包 invoker）新建于 `mission/roles/`：`WriterService` / `BibleKeeperService` / `StoryArchitectService` / `ConsistencyService` / `EditorService` + `AgentInvoker`（照 playground `analyst.service.ts` 薄 service + `agent-invoker.service.ts`）。

---

## 3. context / deps 形态（playground 模式）

`context/mission-context.ts`（mutable 状态包，按 phase 拆接口再合成）：

- `MissionInvariants`（全 readonly）：`missionId, userId, input: WritingMissionInput, t0, pool: MissionBudgetPool, budgetMultiplier, billing`。
- Phase ctx（字段全 optional = 「尚未到达该 stage」）：
  - `BudgetPhaseCtx.budgetEval?`
  - `WorldPhaseCtx.worldSettings? / bibleSnapshot?`
  - `OutlinePhaseCtx.outlinePlan? / chapterPlan?`
  - `DraftPhaseCtx.chapterDrafts? / chapterFailures?`
  - `ConsistencyPhaseCtx.consistencyIssues? / extractedFacts?`
  - `EditPhaseCtx.revisedChapters? / editStats?`
  - `QualityPhaseCtx.qualityMetrics? / qualityVerdict?`
  - `PersistPhaseCtx.writingArtifact? / trajectoryStored?`
- 合成 `export type WritingMissionContext = MissionInvariants & BudgetPhaseCtx & ... & PersistPhaseCtx;`
- 跨层类型走 facade（`MissionBudgetPool` 等）；Agent 输出类型从 agent 文件 import。

`context/mission-deps.ts`（`CommonDeps` + 各 phase `extends CommonDeps`）：

- `CommonDeps`（全 readonly）：`invoker, store(markIntermediateState/markStageDegraded), lifecycle: LifecycleFn, emit: EmitFn, eventBus, log` + prisma。
- `WorldDeps`: + `worldBuildingEnhancer, jsonParser, storyBible, character, worldSetting, bibleKeeper`(role)
- `OutlineDeps`: + `storyArchitect`(role), `jsonParser, textProcessor`
- `DraftDeps`: + `writer`(role), `chapterDependency, parallelOrchestrator, writerPool, contextService, expressionMemory, openingHook, narrativeCraft, textProcessor`
- `ConsistencyDeps`: + `consistencyChecker`(role), `semanticConsistency, factExtractor, consistencyEngine`
- `EditDeps`: + `editor`(role), `qualityGate, chapterQualityEvaluator`
- `QualityDeps`: + `qualityGate, chapterQualityEvaluator, narrativeCraft, storyCompletionDetector`
- `PersistDeps`: + `writingPersistence, projector`
- 合成 `interface WritingMissionDeps extends CommonDeps, WorldDeps, ... , PersistDeps {}`

> **领域 dep 全部原样保留**（§现状测绘第 3 节清单），只是从「Agent/Executor 构造注入」改成「Deps 注入，stage 调用」。
> dep 装配位置取决于 SessionEntry 形态（见 §下 dispatcher）。

**stage 四件套（playground 金标准，本项目无 `runWithStageInstrumentation` 包装器）**：每个 `runXxxStage(ctx, deps)` 内手动：
`deps.lifecycle(...started)` → `narrate(deps.emit, ...)` → role 调用（invoker.invoke）→ `deps.invoker.tickCost(...)` → `deps.lifecycle(...completed/failed)` → 失败兜底（provider fail-loud / LLM 内部空产物）→ `ctx.xField = out` + `deps.store.markIntermediateState(missionId, { xField: out }, userId)`。

---

## 4. dispatcher + business-orchestrator 形态（照 social）

**`mission/pipeline/writing-business-orchestrator.service.ts`**（照 social `social-business-orchestrator.service.ts`，最简）：

```
const STAGE_NUMBER = { "s1-mission-budget-eval":1, ..., "s8-mission-persist":8 };
@Injectable()
export class WritingBusinessOrchestrator
  extends BusinessTeamOrchestratorFramework<WritingSessionEntry> {
  constructor() { super({ namespace: "writing", stageNumber: STAGE_NUMBER }); }  // 空 ctor
  protected resolveStageRunner(stepId): BusinessTeamStageRunner<WritingSessionEntry> | null {
    switch (stepId) {
      case "s1-mission-budget-eval": return async (e) => { await runMissionBudgetEvalStage(e.ctx, e.deps); };
      ... // 8 个 case
      default: return null;
    }
  }
}
```

直接吃 framework 默认 `adaptRunnerToHooks`（无 override，无 preloadSystemPrompts——writing 的 systemPrompt 走 `@DefineAgent.buildSystemPrompt`，不像 radar 从 SKILL.md 注）。
唯一实现的抽象方法是 `resolveStageRunner`（framework 唯一 abstract）。

**`mission/pipeline/writing-pipeline-dispatcher.service.ts`**（照 social `social-pipeline-dispatcher.service.ts`）：

- `extends BusinessTeamMissionDispatcherFramework implements OnModuleInit`
- `super(eventBus, { namespace:"writing", stageLifecycleEvent, stageStalledEvent, stageDegradedEvent })`
- `SessionEntry = { session, t0, input, projectId, ctx, deps }`（social 形态——deps 装在 entry，因为 writing stage 是 free 函数需 deps 显式传）
- `onModuleInit`：`businessOrch.bindSessionLookup((mid) => this.getEntry(mid))` + 对 5 条 pipeline 各 `if(!registry.has(p.id)) registry.register(buildPipelineWithHooks(p))`
- `buildPipelineWithHooks(p)`：照 social——`steps.map(s => ({...s, hooks: businessOrch.buildHooksForStep(s.id, s.primitive)}))`
- `runMission`：`runtimeShell.openSession(...)` → 装 ctx+deps 存 sessions Map → `runtimeShell.runWithinContext(session, async () => orchestrator.run({ missionId, pipelineId: selectWritingPipeline(input.missionType).id, input, userId, tenantId: projectId, signal, onEvent: e => this.bridgeOrchestratorStageEvent(e, { missionId, userId }) }))` → 按 `result.status` 走 `lifecycleManager.finalize` / `handleMissionFailure` → `finally` cleanup。
- **剥掉的 social 专属包袱**：`inFlight` dedup、`SOCIAL_FAST_PIPELINE` 双轨（writing 改为 5 条 type pipeline，结构不同但同手法）、`fireSelfEvolutionPostlude`（s12）、`hydrateContentRaw/hydrateStewardInputs`。
- onEvent 用 framework `bridgeOrchestratorStageEvent`（标准三分 lifecycle/stalled/degraded），不自写 handler。

**framework 抽象方法可实现性确认**：

- `BusinessTeamOrchestratorFramework<TSession>` 唯一 abstract = `resolveStageRunner` ✅ 可实现（switch over stepId）。
- `BusinessTeamMissionDispatcherFramework` **无 abstract 方法**（`runMission`/`finalize` 都是 business 自加）✅。
- 故 framework 抽象契约 100% 可实现，无缺口（风险 §4.5 仅校验签名匹配）。

---

## 5. 产物与 projector

`projectors/writing-artifact.projector.ts`（新建，无直接 social/radar 单文件对应，参照 playground `artifacts/` + 锁定决策 5）：

- 输入：`ctx.revisedChapters[] + qualityMetrics + extractedFacts + outlinePlan`
- 输出：单个 `WritingArtifact { id, projectId, sections: [{chapterNumber, title, content, wordCount, quality}], metadata: {totalWords, chapterCount, worldSettings, characters}, quality: {overall, consistency, completeness} }`
- 配多视图 projector 方法：`toChapterList()` / `toFullText()` / `toQualityReport()`（多视图投影，对齐决策 5）。
- 落库：s8 stage 调 `WritingPersistence.saveGeneratedContent` 写 writingChapter（FINAL）+ project wordCount；WritingArtifact 存 `WritingMission.result`(Json)。

---

## 6. filePlan（B0-B6 建造顺序）

> 所有 `mission/` 下相对 `backend/src/modules/ai-app/writing/`。
> create 标注「参照」哪个金标准文件。

### B0 — 脚手架 + 老路保留（不碰旧编排）

- `mission/runtime/writing.config.ts` — create — 参照 `social/runtime/social.config.ts`（5 条 pipeline，全 persist，roles:[]）
- `mission/context/mission-context.ts` — create — 参照 `agent-playground/.../context/mission-context.ts`
- `mission/context/mission-deps.ts` — create — 参照 `agent-playground/.../context/mission-deps.ts`
- `mission/index.ts` — create — barrel（仅 export，便于 module wire）

### B1 — 5 Agent 迁 @DefineAgent

- `mission/agents/story-architect.agent.ts` — create — 参照 `agent-playground/.../agents/analyst/quick-view-synthesizer.agent.ts`
- `mission/agents/bible-keeper.agent.ts` — create — 同上
- `mission/agents/writer.agent.ts` — create — 同上
- `mission/agents/consistency-checker.agent.ts` — create — 同上
- `mission/agents/editor.agent.ts` — create — 同上
- `agents/*.agent.ts`（旧 5 个 BaseAgent） — keep-as-dep — 静态成员（`WriterAgent.CORE_WRITING_PRINCIPLES`）暂被引用，B6 删

### B2 — role service（薄包 invoker）+ 并行可见性

- `mission/roles/agent-invoker.service.ts` — create — 参照 `agent-playground/.../roles/agent-invoker.service.ts`
- `mission/roles/writer.service.ts` — create — 参照 `agent-playground/.../roles/analyst.service.ts`
- `mission/roles/bible-keeper.service.ts` — create — 同上
- `mission/roles/story-architect.service.ts` — create — 同上
- `mission/roles/consistency.service.ts` — create — 同上
- `mission/roles/editor.service.ts` — create — 同上
- `services/parallel/parallel-orchestrator.service.ts` — modify — `generateExecutionPlan` private→public（s4 复用分轮）

### B3 — 8 个 stage（free 函数）

- `mission/pipeline/stages/s1-mission-budget-eval.stage.ts` — create — 参照 `agent-playground/.../stages/s6-analyst-synthesize-insights.stage.ts`
- `mission/pipeline/stages/s2-world-build.stage.ts` — create — 同上
- `mission/pipeline/stages/s3-outline-plan.stage.ts` — create — 同上
- `mission/pipeline/stages/s4-chapter-fanout.stage.ts` — create — 同上（+ 逐章 fan-out / checkpoint，本迁移独有）
- `mission/pipeline/stages/s5-consistency-check.stage.ts` — create — 同上
- `mission/pipeline/stages/s6-edit-polish.stage.ts` — create — 同上
- `mission/pipeline/stages/s7-quality-evaluate.stage.ts` — create — 同上
- `mission/pipeline/stages/s8-mission-persist.stage.ts` — create — 同上
- `mission/artifacts/narrative.util.ts` — create — 参照 `agent-playground/.../artifacts/narrative.util.ts`

### B4 — dispatcher + business-orchestrator + projector + module wire（仍不切换）

- `mission/pipeline/writing-business-orchestrator.service.ts` — create — 参照 `social/.../social-business-orchestrator.service.ts`
- `mission/pipeline/writing-pipeline-dispatcher.service.ts` — create — 参照 `social/.../social-pipeline-dispatcher.service.ts`
- `mission/projectors/writing-artifact.projector.ts` — create — 参照 playground `artifacts/` + 决策 5（无单文件直对应）
- `ai-writing.module.ts` — modify — providers 增 `MissionPipelineRegistry, MissionPipelineOrchestrator, WritingBusinessOrchestrator`(排 dispatcher 前)`, WritingPipelineDispatcher` + 6 role service + projector；新旧并存（dispatcher 不被调用）

### B5 — 单点切换（保留老路代码，仅改路由指向）

- `services/mission/writing-mission-execution.service.ts` — modify — `executeWithExecutorMap` / `runMissionInBackground` 改调 `WritingPipelineDispatcher.runMission(...)`（**唯一切换点**）；旧 executorMap 分支留作 feature-flag 回退
- `services/mission/writing-mission-lifecycle.service.ts` — modify — 若 finalize/状态写库由 dispatcher 接管，调整调用方（最小化）

### B6 — 删旧（切换稳定后）

- `services/task-executors/full-story.executor.ts` — delete-at-cutover
- `services/task-executors/single-chapter.executor.ts` — delete-at-cutover
- `services/task-executors/continue-story.executor.ts` — delete-at-cutover（FullStory 内部委托，逻辑迁入 s4 续写分支）
- `services/task-executors/*.executor.ts`（outline/leader/revision/consistency） — delete-at-cutover
- `services/task-executors/task-executor.interface.ts` — delete-at-cutover（`IWritingTaskExecutor` 等）
- `agents/*.agent.ts`（旧 5 BaseAgent） — delete-at-cutover（静态成员先迁到 mission/agents 或 constants）
- `ai-writing.module.ts` — modify — 删 executor providers + onModuleInit registerExecutor 段

---

## 7. 建造顺序与每步 verify 门（强成功标准，Karpathy 原则）

| 阶段 | 内容                               | verify 门（必须全绿才进下一步）                                                                                                                                                                                                        |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B0   | config + context + deps 脚手架     | `npm run type-check` 0 error；`npm run verify:arch`（facade 边界，新文件只从 facade 导入 harness 符号）                                                                                                                                |
| B1   | 5 Agent → @DefineAgent             | type-check 0 error；新 5 agent 各写 1 个 zod schema 单测（合法 input 通过 / 缺必填字段被拒）→ `npm run test:quick` 绿                                                                                                                  |
| B2   | role service + 并行 public         | type-check；`generateExecutionPlan` 提 public 后旧调用方编译通过；role service 薄包测试（mock invoker 返回，断言 normalizeRunnerState 透传）                                                                                           |
| B3   | 8 stage                            | type-check；每 stage 单测：mock deps，断言 lifecycle started/completed 调用 + markIntermediateState 写对 ctx 字段；**s4 专测逐章 checkpoint append + 单章失败 markStageDegraded 不阻断后续章 + abort 抛 StageAbortError**              |
| B4   | dispatcher + orchestrator + module | type-check + `npm run verify:arch`；`MissionPipelineRegistry.register` 5 条 pipeline 不抛重复 id / 未知 primitive；onModuleInit bindSessionLookup 后 getEntry 可用（集成测试：跑一个最小 full_story mission 到 stage:completed 事件）  |
| B5   | 单点切换                           | `npm run verify:full`（lint+type+test+build）；**远程环境（Railway URL）实跑一次 full_story 端到端**：start mission → 轮询 status COMPLETED → 校验 writingChapter 落库 + WritingArtifact.result；5 个 task type 各跑 1 次子集 pipeline |
| B6   | 删旧                               | `npm run verify:full` 全绿；grep 确认无残留 `IWritingTaskExecutor` / `executorMap` import；controller 58 路由 smoke 全过（CRUD 不回归）                                                                                                |

> 切换回退预案：B5 用 feature-flag（env `WRITING_PIPELINE_MODE=new|legacy`）包住 execution.service 的分支，新路出问题可即时切回 legacy executorMap，B6 删旧前 flag 保留 ≥1 个发布周期。

---

## 8. 风险清单

### 4.1 逐章 fan-out + checkpoint（最高风险）

- s4 stage 内并发逐章 + 逐章 `markIntermediateState` append 是本迁移**独有形态**（social/radar 均无 stage 内并发）。framework `adaptRunnerToHooks` 只在 stage 入口查一次 abort，长循环内需自查 `ctx.signal?.aborted`，否则 cancel 后仍会写完整卷。
- append checkpoint 的并发写：多 writer 并发回写同一 `ctx.chapterDrafts` 数组有竞态——需在 stage 内串行化 ctx 写（每轮 `Promise.all` 收集后统一写，而非每章各自写 ctx）。
- 缓解：B3 对 s4 强制专项测试（checkpoint append / 软失败不阻断 / abort）。

### 4.2 Prisma 字段够不够存中间状态

- `WritingMission` 现有 `contextPackage:Json?` + `result:Json?` 两个 JSON 字段。中间产物（worldSettings/outlinePlan/chapterDrafts/consistencyIssues/...）需要落库供 cascade-rerun 回灌——**`markIntermediateState` 写哪？** playground 走专门的 mission-state store。writing 当前**没有等价的 mission-state 表**，只有 `WritingMission.contextPackage`（设计语义是「输入上下文包」，非中间态）。
  - 选项 A：复用 `WritingMission.contextPackage` 存中间态（语义偏移，但零迁移）。
  - 选项 B：新增 `intermediateState:Json?` 字段（手写 SQL 迁移 `ALTER TABLE writing_missions ADD COLUMN intermediate_state JSONB`）。
  - **决策需用户确认**（架构决策红线）：推荐 B（语义清晰），代价 1 个手写迁移。
- `chapterDrafts[]` 逐章正文可能很大（数十万字）→ JSONB 单行可能撑大；s4 已逐章落 `writingChapter`（FINAL/草稿），中间态可只存「章 id + 状态 + 摘要」指针，正文从 writingChapter 读，避免 JSON 膨胀。

### 4.3 task type / enum 不一致

- DB `WritingMissionType` 5 值（OUTLINE/CHAPTER/REVISION/CONSISTENCY/FULL_STORY）vs TS 6 值（多 `edit`），靠 `MISSION_TYPE_DB_MAP` 映射。新 pipeline 按 TS 6 值选 pipelineId，但落库仍走 DB 5 值映射——`selectWritingPipeline` 必须吃 TS 值、`createMissionRecord` 仍 map 回 DB 值，两套不能混。`edit` 走 `WRITING_EDIT_PIPELINE` 但 DB 记 CHAPTER。

### 4.4 ParallelOrchestrator 可见性 / 复用

- `generateExecutionPlan` 当前 private，s4 复用需提 public（B2）。`ParallelOrchestratorService` 构造里 4 个 dep 当前被 `void` 掉（实际只用 prisma+chapterDependency）——提 public 时确认不引入未初始化 dep 调用。

### 4.5 live 端点切换面（实际比"35"小）

- writing controller 共 58 REST + 2 WS handler。但执行链路**只经 3 条 mission 路由**（start/status/cancel）→ coordinator → lifecycle → execution → executorMap。**切换点收敛到 `writing-mission-execution.service.ts` 单文件**（B5），其余 55 条 CRUD 路由零改动。风险面远小于"全端点"，但 start/status/cancel 的响应契约（mission status 枚举、result 结构）必须保持，否则前端解析断（前后端协议对齐红线）。
- gateway 2 个 WS handler 推送 mission 进度——事件桥从 executor 的 `WritingEventEmitterService` 改为 framework `bridgeOrchestratorStageEvent` 三分事件，**事件名/payload 须与前端现有监听对齐**，否则进度条断（需在 B4 校验事件 schema）。

### 4.6 framework 抽象方法可实现性

- 已确认：orchestrator 唯一 abstract `resolveStageRunner` 可实现；dispatcher 无 abstract。无缺口。风险仅在 `StageRunner<TSession>` 签名 = `(entry, args) => Promise<unknown>`，writing stage 是 `(ctx, deps) => Promise<T>`——runner 闭包需从 `entry` 取 `ctx/deps`（`async (e) => runXxxStage(e.ctx, e.deps)`），SessionEntry 必须同时挂 ctx+deps（social 形态），不能用 radar 的瘦 entry。

### 4.7 Agent 依赖外移的回归

- 现状 Agent（尤其 Writer 11 个 quality dep）的「约束生成」逻辑外移到 stage。若漏迁某条约束（如 dialogueConstraints / professionalVoice），生成质量静默下降且类型检查发现不了。缓解：B1 迁移时逐条对照 `writer.agent.ts` L457-740 的 12 类约束清单，stage 端建 checklist 逐条核对；B5 远程实跑对比新旧产物质量分（qualityGate overallScore 不低于 legacy 基线）。

### 4.8 content-engine / LongContentModule 依赖

- FullStoryExecutor 经 `LongContentModule`（imported，非直接 provider）。stage 化后 deps 注入需确认 `LongContentModule` 的 export 在 writing module scope 可见，否则 s4 长文续写能力丢失。
