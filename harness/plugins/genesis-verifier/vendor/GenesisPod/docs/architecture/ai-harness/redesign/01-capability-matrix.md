# Topic Insights · 完整能力对照表 v2

> 版本：v2（应用 10-review-and-gaps.md 修正：补 8 项遗漏 + 修正 3 处分类错误 + 全文档唯一 ID + 拆分 Iron-wall）
>
> 审计范围：25 个 legacy service 文件，约 22,000 行
> 能力总数：**68 项**（原 60 + 新增 8）

---

## 一、ID 方案与分类标记

### 1.1 全文档唯一 ID

| 类型                     | 前缀  | 例                                  |
| ------------------------ | ----- | ----------------------------------- |
| Stage（Pipeline 阶段）   | `ST-` | `ST-03-WRITE`（Stage 3 写作）       |
| Agent（Harness agent）   | `AG-` | `AG-06-QR`（QualityReviewer）       |
| Tool（Harness tool）     | `TL-` | `TL-02-EVSAVE`（evidence-save）     |
| Skill（Canonical skill） | `SK-` | `SK-11-FC`（fact-check）            |
| Utility（纯函数）        | `UT-` | `UT-QG-RULES`（quality gate rules） |
| Capability（本文档）     | `CP-` | `CP-1.1`（Leader plan 生成）        |

### 1.2 分类标记

| 标记  | 含义                     | 迁移去向                                  |
| ----- | ------------------------ | ----------------------------------------- |
| **A** | LLM 编排决策             | Harness Agent + Skill（Layer 4+2）        |
| **B** | 后处理算法（纯函数）     | Utility library（Layer 1）                |
| **C** | 工作流编排               | Pipeline Stage（Layer 5）                 |
| **D** | 基础设施 / 持久化 / 事件 | 保留现有 service 或内联 Prisma（Layer 0） |
| **E** | 废弃                     | 不迁移（必须给理由）                      |

**风险等级**：🔴 高 · 🟡 中 · 🟢 低

---

## 二、核心执行流能力（Pipeline 主干）

### 2.1 Stage 1 · Leader 规划

| CP-ID  | 能力                                                                                           | 旧位置                                                                     | 类别 | 新归属                                                        | 风险 |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---- | ------------------------------------------------------------- | ---- |
| CP-1.1 | **LeaderPlan 生成**：taskUnderstanding / dimensions[] / agentAssignments[] / executionStrategy | `LeaderPlanningService.planResearch:182`                                   | A    | AG-01-LD + SK-01-PLAN                                         | 🔴   |
| CP-1.2 | **获取推理模型**：从 ModelPool 拉 Leader 专用模型                                              | `LeaderPlanningService.getReasoningModel:145`                              | D    | 保留为 `ReasoningModelLookup` 工具；ST-00-INIT 调用           | 🟢   |
| CP-1.3 | **availableModels 动态注入**：让 Leader 为每个 agent 分配 modelId                              | `LeaderPlanningService.planResearch` prompt `{availableModels}`            | A    | AG-01-LD 的 `buildTask.input.availableModels`（ST-00 预加载） | 🔴   |
| CP-1.4 | **TopicType 条件 prompt**：MACRO/TECH/COMPANY/EVENT 四套策略                                   | `LeaderPlanningService` prompt                                             | A    | SK-01-PLAN 分 4 subsection；运行时 `topicType` 激活对应段     | 🔴   |
| CP-1.5 | **anchorArticleContent 注入**：EVENT 类型必传锚定文章                                          | `LeaderPlanningService.planResearch` 参数                                  | A    | AG-01-LD `buildTask.input.anchorArticleContent`               | 🔴   |
| CP-1.6 | **existingDimensions 保留**：增量模式保留已有 dim                                              | `LeaderPlanningService.planResearch`                                       | A    | AG-01-LD `ctx.existingDimensions`                             | 🟡   |
| CP-1.7 | **跨维度 outline 去重**：Leader 带 `allDimensions` 上下文出 outline                            | `LeaderPlanningService.planDimensionOutline:557` + `planGlobalOutline:960` | A    | AG-02-DP（DimensionPlanner）+ SK-02-OUTLINE                   | 🔴   |

### 2.2 Stage 2 · 维度研究

| CP-ID    | 能力                                                                                  | 旧位置                                                                                            | 类别                                             | 新归属                                                                                                                                                                                   | 风险 |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| CP-2.1   | **V5 文献基线扫描**：search 前扫学术文献产 baseline                                   | `DataSourceRouterService.scanLiteratureBaseline:487` + `DimensionMissionService` 调用             | **C**（编排）+ **D**（底层 search adapter 保留） | ST-02A-LITBASE（Pipeline Stage 2a）；底层复用现有 `DataSourceRouterService` 方法                                                                                                         | 🔴   |
| CP-2.2   | **9 路 Search 并行**                                                                  | `DimensionMissionService.executeSearchPhase:410` + `SearchOrchestrator`                           | **D**                                            | 保留 `SearchOrchestratorService`；ST-02B-SEARCH 调用                                                                                                                                     | 🔴   |
| CP-2.3   | **结果融合 + 质量门 + 去重**                                                          | `SearchOrchestratorService`                                                                       | D                                                | 保留                                                                                                                                                                                     | 🟡   |
| CP-2.4   | **EvidenceSummary 构建**：search 结果聚合为 agent 可消费的 summary                    | `DimensionMissionService.executeSearchPhase` 末尾                                                 | B                                                | UT-RS-EVSUM（`buildEvidenceSummary`）                                                                                                                                                    | 🟡   |
| CP-2.5   | **FiguresSummary 构建 + figure 验证升级**                                             | `DimensionMissionService.executeSearchPhase` + `FigureExtractorService`                           | **B+D**                                          | ST-02C-FIG 调用保留的 `FigureExtractorService.extractFiguresFromUrl` + `validateAndUpgradeFigures` + UT-FIG-INSERT                                                                       | 🔴   |
| CP-2.6a  | **Evidence 批量落库 + citationIndex 分配**（纯 DB）                                   | `DimensionWritingService.saveEvidence:1225`                                                       | D                                                | 新增 `EvidencePersistenceService`（或保留 existing + 改造）                                                                                                                              | 🔴   |
| CP-2.6b  | **Evidence credibility 打分**                                                         | 同上 `saveEvidence` 内 assessCredibility 段                                                       | B                                                | UT-CRED-ASSESS（`assessCredibility`，纯函数）                                                                                                                                            | 🔴   |
| CP-2.6c  | **evidenceUsed 真实计数**：必须从 DB count 取，不是 agent 自报                        | 旧代码：`saveEvidence` 返回 savedIds.length                                                       | B+D                                              | UT-CRED-COUNT（`countDimensionEvidence`） + ST-02D 强制使用                                                                                                                              | 🔴   |
| CP-2.7   | **Dimension Outline 驱动写作**（Leader 给的 sections[] 指导分章节）                   | `LeaderPlanningService.planDimensionOutline` → `DimensionWritingService.executeWritingPhase:110`  | A+C                                              | ST-03-WRITE + AG-02-DP（outline） + AG-03-SW（section writer）                                                                                                                           | 🔴   |
| CP-2.8   | **Section-level 并行/依赖写作**                                                       | `DimensionWritingService.executeWritingPhase` + `SectionWriterService.writeSectionsParallel:1001` | C                                                | ST-03B 的 DAG 调度器（读 outline 的 dependsOn）                                                                                                                                          | 🔴   |
| CP-2.9   | **Section 后处理**：numberSubHeadings / OPENING_CONCLUSION_RE / sanitizeSectionOutput | `SectionWriterService` 内部 + `sanitize-section-output.utils.ts`                                  | B                                                | UT-CF-NUMBERING / UT-CF-OPENING / UT-CF-SANITIZE（迁移现有 utils）                                                                                                                       | 🟡   |
| CP-2.10  | **Section-level 审核 + 修订 loop**（rounds by depth）                                 | `LeaderReviewService.reviewSection` + `DimensionWritingService` revision loop                     | A+C                                              | ST-04-REVIEW：<br>• AG-04-SR（SectionReviewer）<br>• Pipeline while loop 读 `depthConfig.maxRevisionRounds` + 早停（score ≥ 80 跳过剩余 rounds）                                         | 🔴   |
| CP-2.11  | **Claims 提取**（V5）                                                                 | `LeaderReviewService.extractClaims:142`                                                           | A                                                | AG-04-SR 附带输出 claims[]（同一次 LLM 调用，免增成本）                                                                                                                                  | 🟡   |
| CP-2.12  | **Hypothesis 验证**（V5）                                                             | `LeaderReviewService.verifyHypotheses:231`                                                        | A                                                | AG-09-HV（HypothesisVerifier，thorough+ 启用）                                                                                                                                           | 🟡   |
| CP-2.13a | **Dimension 章节合并**（铁墙清理 + 合章）                                             | `ResearchLeaderService.integrateDimensionResults:269` 内的合章逻辑                                | B                                                | UT-ASM-INTEGRATE（`integrateDimensionSections`）                                                                                                                                         | 🟡   |
| CP-2.13b | **Dimension meta 提取**（summary + keyFindings）                                      | 同上方法中的 LLM 调用段                                                                           | A                                                | AG-05-ME（DimensionMetaExtractor） + SK-13-META                                                                                                                                          | 🟡   |
| CP-2.14  | **Dimension 级质量审核**（AI mode，5 轴独立评分）                                     | `ResearchReviewerService.reviewDimension:82`                                                      | A                                                | AG-06-QR 的 "dimension" scope + SK-06-QR-DIM<br>**硬约束**：Zod schema 强制 5 个 required number fields（breadth/depth/evidence/coherence/currency），parser validateOutput 拒绝 fan-out | 🔴   |
| CP-2.15  | **Dimension 级质量审核**（deterministic mode，启发式）                                | `ReviewDimensionExecutor.computeHeuristicReview`                                                  | B                                                | UT-QUAL-HEURISTIC                                                                                                                                                                        | 🟢   |

### 2.3 Stage 3 · 跨维度综合与报告生成

| CP-ID    | 能力                                                                                                          | 旧位置                                                                | 类别          | 新归属                                                                                | 风险 |
| -------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------- | ---- |
| CP-3.1   | **跨维度事实提取**（extractedFacts，mission 级共享）                                                          | `DimensionMissionService` 末尾 `contextEvolution.extractFacts`        | A             | AG-10-FX（FactExtractor，mission 末轮跑一次）                                         | 🟡   |
| CP-3.2   | **Overall Review**：LLM 跨维度综合评审                                                                        | `ResearchReviewerService.reviewOverall:253`                           | A             | AG-06-QR 的 "overall" scope + SK-07-QR-OVR                                            | 🔴   |
| CP-3.3   | **Fact-check Report**（thorough 模式）                                                                        | `ResearchReviewerService.factCheckReport:499`                         | A             | AG-07-FC（FactChecker）+ SK-08-FC                                                     | 🔴   |
| CP-3.4   | **ValidateClaims**（V5 认知循环第 1 步）                                                                      | `ResearchReviewerService.validateClaims:316`                          | A             | 并入 AG-07-FC 的职责（一次 LLM 调用做 fact-check + claim validation）                 | 🟡   |
| CP-3.5   | **GenerateGapSearchQueries**（V5 认知循环第 3 步）                                                            | `ResearchReviewerService.generateGapSearchQueries:418`                | A             | AG-08-GS（GapSearcher）+ SK-10-GAPQ；与 ST-06 认知循环配合                            | 🟡   |
| CP-3.6   | **Report 合成**：executiveSummary + fullReport + highlights + crossDimAnalysis + riskMatrix + recommendations | `ReportSynthesisService.synthesizeReport:367`                         | A+C           | ST-07-SYNTH：AG-11-SY（Synthesizer）+ SK-12-SYN；Pipeline 后处理 utility              | 🔴   |
| CP-3.7   | **Draft report 创建**（占位用于 evidence 关联）                                                               | `ReportSynthesisService.createDraftReport:130`                        | D             | 保留 `ReportDataService.createDraftReport`                                            | 🟢   |
| CP-3.8a  | **DimensionAnalysis 内容预处理**：numberSubHeadings                                                           | `ReportSynthesisService.saveDimensionAnalysis:189` 内的 preprocess 段 | B             | UT-CF-NUMBERING（与 CP-2.9 复用同一 utility）                                         | 🔴   |
| CP-3.8b  | **DimensionAnalysis chart 占位嵌入**：`<!-- chart:XXX -->` 插入                                               | 同上 `saveDimensionAnalysis` 的 insertions 段                         | B             | UT-FIG-INSERT                                                                         | 🔴   |
| CP-3.8c  | **DimensionAnalysis DB 写入**                                                                                 | 同上 `prisma.dimensionAnalysis.create`                                | D             | 新增或扩展 `DimensionAnalysisRepository`                                              | 🟢   |
| CP-3.9   | **Evidence 关联到 report/analysis**                                                                           | `ReportSynthesisService.linkEvidenceToReport:294`                     | D             | 保留 `evidenceRepo.link` 或内联到 ST-07                                               | 🟢   |
| CP-3.10  | **ReprocessExistingReport**：轻量后处理重跑（无 LLM）                                                         | `ReportSynthesisService.reprocessExistingReport:321`                  | B             | UT-ASM-REPROCESS；独立 endpoint 入口                                                  | 🟡   |
| CP-3.11a | **Report 质量硬门 6 条规则**（heading_hierarchy / citation_coverage / min_content_length 等）                 | `ReportQualityGateService` (963 行)                                   | B             | UT-QG-RULES（规则集合）+ UT-QG-EVAL（评估引擎，纯函数）                               | 🔴   |
| CP-3.11b | **Report 质量门不过关时 LLM 修复**                                                                            | `SectionRemediationService` + `ReportQualityGateService` 协作段       | A             | AG-12-SREM（SectionRemediator）+ SK-14-REM；ST-08 循环调用（最多 N 次）               | 🔴   |
| CP-3.12  | **Section 写中自评 + 补救**                                                                                   | `SectionSelfEvalService` + `SectionRemediationService`                | A+B           | 合并策略：AG-03-SW 最后一轮 self-eval（并入同次 LLM 调用）+ AG-12-SREM 负责补救       | 🟡   |
| CP-3.13  | **Critique-Refine loop**                                                                                      | `CritiqueRefineService.runCritiqueRefineLoop:125`                     | **E（废弃）** | 采用 ST-04 的 review-revise 策略；critique-refine 作为 2026 Q3 备选，本次**确定废弃** | 🟡   |
| CP-3.14  | **Report 10 维评审**                                                                                          | `ReportEvaluationService` (504 行)                                    | A             | AG-13-RE（ReportEvaluator）+ SK-15-10DIM（thorough+ 启用）                            | 🟡   |

### 2.4 Stage 4 · 报告后处理与持久化

| CP-ID   | 能力                                                                    | 旧位置                                                 | 类别             | 新归属                                                                             | 风险 |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------- | ---- |
| CP-4.1  | **Figure validate + upgrade**（URL 验证 + 高清升级）                    | `FigureExtractorService.validateAndUpgradeFigures:728` | **D**（含 HTTP） | 保留 `FigureExtractorService`；ST-02C / ST-11-ASM 调用                             | 🔴   |
| CP-4.2  | **Figure 相关度打分**                                                   | `FigureRelevanceService`                               | D                | 保留                                                                               | 🟡   |
| CP-4.3  | **FigureRegistry 回填 + 占位替换**                                      | `ReportAssemblerService` 内                            | B                | UT-FIG-REGISTRY + UT-FIG-INSERT（与 CP-3.8b 共用）                                 | 🔴   |
| CP-4.4  | **Citation 格式化**                                                     | `CitationFormatterService`                             | B                | UT-CIT-FORMAT                                                                      | 🟢   |
| CP-4.5a | **LaTeX 语法检测**                                                      | `LatexRepairService.validateLatexDelimiters`           | B                | UT-LTX-VALIDATE                                                                    | 🟡   |
| CP-4.5b | **LaTeX LLM 修复**                                                      | `LatexRepairService.refineContent`                     | A                | AG-14-LX（LatexRepair）+ SK-16-LTX（ST-12 条件启用：UT-LTX-VALIDATE 有 issues 时） | 🟡   |
| CP-4.6  | **Report assembler**：组装 markdown（TOC / 章节编号 / figure 占位替换） | `ReportAssemblerService` (1059 行)                     | B                | UT-ASM-FULL / UT-ASM-TOC / UT-ASM-INTEGRATE                                        | 🔴   |
| CP-4.7  | **Report validator**：最终合法性检查                                    | `ReportValidationService`                              | B                | UT-RV-CHECK                                                                        | 🟡   |
| CP-4.8  | **Report editor**（用户编辑段落 LLM 辅助）                              | `ReportEditorService`                                  | A                | AG-15-RED（ReportEditor）+ SK-17-EDIT（独立 endpoint，Advanced Tier）              | 🟡   |
| CP-4.9  | **Quality trace 持久化**（质量检查链路审计）                            | `ReportQualityTraceService`                            | D                | 保留                                                                               | 🟢   |

---

## 三、跨阶段基础设施能力

### 3.1 原有 23 项

| CP-ID   | 能力                                                                                                                         | 旧位置                                                               | 类别 | 新归属                                                                                                                                                                                                  | 风险 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| CP-C.1  | **PromptCacheCoordinator per-mission 前缀**                                                                                  | `DimensionMissionService.createPrefix` + `section-writer.service.ts` | D+C  | ST-00-INIT 调 `createPrefix`；AgentRunner 基类注入 `promptCachePrefix` 到 IAgentSpec；ST-14-CLEAN 释放。<br>**严格区分 stable prefix（skill/role/constraints）vs dynamic suffix（topic/dim/evidence）** | 🔴   |
| CP-C.2  | **depthConfig 透传**（maxRevisionRounds / maxCognitiveLoops / literatureBaselineEnabled / factCheckEnabled / maxIterations） | 分散                                                                 | C    | PipelineContext 强制字段（non-optional）；每 Stage 从 ctx 读                                                                                                                                            | 🔴   |
| CP-C.3  | BillingContext 传播                                                                                                          | `BillingContext.run`                                                 | D    | 保留 async_hooks                                                                                                                                                                                        | 🟢   |
| CP-C.4  | KernelContext 传播（session scope）                                                                                          | harness facade 内部                                                  | D    | 保留                                                                                                                                                                                                    | 🟢   |
| CP-C.5  | SessionLatencyTracker 传播                                                                                                   | Optional inject                                                      | D    | 保留                                                                                                                                                                                                    | 🟢   |
| CP-C.6  | **emitLeaderThinking 四阶段**（understanding / analyzing / planning / completed）                                            | 多处 emit                                                            | C    | ST-01-PLAN 发 4 个事件                                                                                                                                                                                  | 🟡   |
| CP-C.7  | emitDimensionResearchStarted/Progress/Completed                                                                              | 旧 executor                                                          | C    | ST-02 保留                                                                                                                                                                                              | 🟢   |
| CP-C.8  | emitAgentWorking（Agent 状态事件）                                                                                           | 旧 executor + writing                                                | C    | ST-03/04 保留                                                                                                                                                                                           | 🟢   |
| CP-C.9  | emitResumeMissionExecution                                                                                                   | `ResearchEventEmitterService`                                        | D    | 保留                                                                                                                                                                                                    | 🟢   |
| CP-C.10 | LeaderDecision 持久化                                                                                                        | `MissionLifecycleService.createMission`                              | D    | ST-01 完成后 persist                                                                                                                                                                                    | 🟢   |
| CP-C.11 | AgentActivity 记录                                                                                                           | `AgentActivityService`                                               | D    | 保留                                                                                                                                                                                                    | 🟢   |
| CP-C.12 | Mission 状态机                                                                                                               | `MissionLifecycleService` `StateTransitionValidator`                 | D    | 保留                                                                                                                                                                                                    | 🟢   |
| CP-C.13 | checkpoint 存储（断点续跑）                                                                                                  | `ResearchCheckpointService`                                          | D    | 保留；Pipeline 每 Stage 结束存储                                                                                                                                                                        | 🟢   |
| CP-C.14 | Redis 分布式锁（mission 级）                                                                                                 | `DimensionMissionService.withRedisLock:312`                          | D    | Pipeline 顶层加锁                                                                                                                                                                                       | 🟡   |
| CP-C.15 | Timeout 控制（planning 10 min）                                                                                              | `withTimeout`                                                        | D    | 保留，Pipeline 顶层包裹 + Stage 级超时                                                                                                                                                                  | 🟢   |
| CP-C.16 | CompletedTask 继承（incremental）                                                                                            | `MissionLifecycleService.createMission`                              | D    | 保留                                                                                                                                                                                                    | 🟢   |
| CP-C.17 | Leader 用户消息处理（adjust）                                                                                                | `LeaderIntentService.handleUserMessage:77`                           | A    | AG-16-MA（MissionAdjuster）+ SK-18-ADJ（Advanced Tier）                                                                                                                                                 | 🟡   |
| CP-C.18 | Leader 解码用户输入（Claude CLI 风格）                                                                                       | `LeaderIntentService.decodeUserInput:576`                            | A    | AG-17-LDP（LeaderDispatcher）+ SK-19-IDEC（Advanced Tier）                                                                                                                                              | 🟡   |
| CP-C.19 | Agent 分配（单 TODO 选 agent）                                                                                               | `LeaderAgentSelectionService.selectAgentForTask:39`                  | A    | 并入 AG-17-LDP（同一次 LLM 调用）                                                                                                                                                                       | 🟡   |
| CP-C.20 | Project context 构建                                                                                                         | `LeaderIntentService.buildProjectContext:857`                        | B+D  | ST-01 前组装（纯 DB 读 + 结构化）作为 agent input                                                                                                                                                       | 🟡   |
| CP-C.21 | AutoDream 通知                                                                                                               | 旧 executor 末尾                                                     | D    | ST-14-CLEAN 触发                                                                                                                                                                                        | 🟢   |
| CP-C.22 | Memory 存储（Mission 级短期）                                                                                                | `ResearchMemoryService`                                              | D    | 保留                                                                                                                                                                                                    | 🟢   |
| CP-C.23 | 维度自动创建（free-form task）                                                                                               | `DimensionResearchExecutor.resolveDimension`                         | D    | ST-00-INIT 的 dimension 预检查 step                                                                                                                                                                     | 🟢   |

### 3.2 **🆕 补充 8 项**（审视新增）

| CP-ID  | 能力                                                                                                                 | 旧位置                                  | 类别 | 新归属                                                                                                                                                                                      | 风险 |
| ------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| CP-M.1 | **TopicDimension 状态机**：PENDING → RESEARCHING → COMPLETED/FAILED/SKIPPED                                          | `DimensionMissionService` 状态更新点    | D    | ST-02 前后显式 `prisma.topicDimension.update({ status: ... })`；Pipeline 负责状态流转                                                                                                       | 🔴   |
| CP-M.2 | **Mission.progressPercent 计算**                                                                                     | `MissionExecutionService` task 完成累加 | C    | 每个 Stage 完成后 `progress += stageWeight`；总和 = 100                                                                                                                                     | 🔴   |
| CP-M.3 | **Per-mission 工具调用预算**（maxToolCalls）                                                                         | 旧 system 隐式                          | D+C  | `PipelineBudget` 对象：Stage 0 根据 depthConfig 设置 `{maxTokens, maxToolCalls, maxCost, maxWallTimeMs}`；每个 agent run 消耗计入                                                           | 🔴   |
| CP-M.4 | **AgentActivity 完整字段**：thinkingPhase / thinkingContent / reviewResult / dimensionId / progress / modelId + 其他 | 散落在 multiple services                | D    | 每个 agent 完成时 emit activity 带全字段；创建 `AgentActivityBuilder` helper                                                                                                                | 🔴   |
| CP-M.5 | **changesFromPrev 持久化**（增量模式差异摘要）                                                                       | `ReportSynthesisService` 中             | B    | UT-ASM-DIFF（`computeReportDiff`）；ST-07 写入 TopicReport.changesFromPrev                                                                                                                  | 🟡   |
| CP-M.6 | **Credit 扣费时机**                                                                                                  | `CreditsService.deduct` 散调用          | D    | Pipeline 中心化扣费 hook：每个 agent run 完成后读 tokensUsed → 扣费；Stage 13 审计                                                                                                          | 🔴   |
| CP-M.7 | **AbortSignal 传播契约**                                                                                             | 旧无                                    | D+C  | `Pipeline.execute(input, signal)` → `Stage.execute(..., signal)` → `AgentRunner.run(ctx, signal)` → `HarnessFacade.execute(spec, task, { signal })`；**需 harness 内核改动（Gate 1 决策）** | 🔴   |
| CP-M.8 | **Dimension research 重入保护锁**                                                                                    | 旧系统未实现                            | D    | 新增：每个 dimension 开始 research 时 `redis.set(dim:${id}:lock, missionId, NX, EX=600)`                                                                                                    | 🟡   |

---

## 四、查询与管理能力

| CP-ID  | 能力                                                       | 旧位置                                                     | 类别 | 新归属                                | 风险 |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------- | ---- | ------------------------------------- | ---- |
| CP-Q.1 | getReport / getLatestReport / listReports / compareReports | `ReportSynthesisService.*` + `ReportDataService.*`（重复） | D    | 统一到 `ReportDataService`            | 🟢   |
| CP-Q.2 | getMissionByTopicId / getMission                           | `MissionQueryService`                                      | D    | 保留                                  | 🟢   |
| CP-Q.3 | getRefreshStatus / cancelRefresh                           | `TopicTeamOrchestratorService` + `TopicInsightsService`    | D    | 基于 Mission 状态派生                 | 🟡   |
| CP-Q.4 | getDecisionHistory                                         | `ResearchLeaderService.getDecisionHistory`                 | D    | `prisma.leaderDecision.findMany` 直接 | 🟢   |
| CP-Q.5 | getSchedule / updateSchedule                               | `TopicRefreshScheduler`                                    | D    | 保留                                  | 🟢   |

---

## 五、集成点

| CP-ID  | 能力                       | 消费方              | 旧位置                            | 类别 | 新归属 | 风险 |
| ------ | -------------------------- | ------------------- | --------------------------------- | ---- | ------ | ---- |
| CP-I.1 | Topic data export          | office/slides       | `TopicInsightsDataExportService`  | D    | 保留   | 🟢   |
| CP-I.2 | Evidence sync compensation | 跨 topic 去重       | `EvidenceSyncCompensationService` | D    | 保留   | 🟢   |
| CP-I.3 | Knowledge graph 写入       | ai-engine/knowledge | `KnowledgeGraphService`           | D    | 保留   | 🟢   |
| CP-I.4 | Research template 加载     | topic 初始化        | `ResearchTemplateService`         | D    | 保留   | 🟢   |
| CP-I.5 | Multi-language research    | 语言检测 + i18n     | `MultiLanguageResearchService`    | D    | 保留   | 🟢   |

---

## 六、Iron Wall 规则拆分

原设计一个 `detectIronWallViolations` utility 模糊。实际铁墙是 6 条独立规则，必须单独实现：

| UT-ID             | 规则                                       | 检测方式            | 消费 Stage             |
| ----------------- | ------------------------------------------ | ------------------- | ---------------------- |
| UT-IW-EMOJI       | 禁用 emoji                                 | Unicode 范围正则    | ST-03C / ST-07         |
| UT-IW-PLACEHOLDER | 禁用 "XX%" / "XX亿" 占位符                 | 正则 + 词典         | ST-03C / ST-07         |
| UT-IW-TEMPLATE    | 禁用模板化开头（"随着..." / "在当前..."）  | 句首正则            | ST-03C                 |
| UT-IW-FUZZY       | 禁用模糊量词（"大量" / "显著" 无数据支撑） | 词典 + 上下文启发式 | ST-03C / ST-07         |
| UT-IW-INTERNAL    | 禁用内部角色名（"Leader" / "Agent"）       | 词典                | ST-03C / ST-07         |
| UT-IW-HTML        | 禁用 HTML 标签                             | 正则 `</?[a-z]+>`   | ST-03C / ST-07 / ST-11 |

每个 utility 输出 `ViolationReport { line: number, col: number, rule: string, snippet: string, severity: 'error' | 'warn' }`。

---

## 七、审计汇总

### 能力总数：68 项（原 60 + 新增 8）

| 分类            | 数量 | 说明                                       |
| --------------- | ---- | ------------------------------------------ |
| A（LLM 编排）   | 18   | 17 个 agent                                |
| B（后处理算法） | 22   | ~25 个 utility                             |
| C（工作流）     | 13   | 14 个 Pipeline Stage                       |
| D（基础设施）   | 19   | 保留或轻度调整                             |
| E（废弃）       | 1    | **CP-3.13 CritiqueRefineService 明确废弃** |

### 🔴 高风险项 22 项（必须覆盖 + 有明确测试）

CP-1.1, 1.3, 1.4, 1.5, 1.7, 2.1, 2.2, 2.5, 2.6a, 2.6b, 2.6c, 2.7, 2.8, 2.10, 2.14, 3.2, 3.3, 3.6, 3.8a, 3.8b, 3.11a, 3.11b, 4.1, 4.3, 4.6, C.1, C.2, M.1, M.2, M.3, M.4, M.6, M.7（共 33 个 🔴 标记）

### 能力迁移总路径

```
Legacy (25 files, 22k LoC)
  │
  ├── A (18) ──→ 17 Harness Agents + 19 Skills
  ├── B (22) ──→ ~30 Utility files in utils/
  ├── C (13) ──→ Pipeline (14 Stages) in pipeline/
  ├── D (19) ──→ Keep or lightly refactor
  └── E (1)  ──→ CritiqueRefine 废弃（采用 review-revise 策略）
```

---

## 八、v2 相对 v1 的改动

| 条目           | v1           | v2                                                                  |
| -------------- | ------------ | ------------------------------------------------------------------- |
| 能力总数       | 60           | 68（补 8 项 🔴）                                                    |
| ID 方案        | 1.x/2.x 混乱 | 全文档唯一 CP-/ST-/AG-/TL-/SK-/UT-                                  |
| CP-2.1 分类    | B            | **C+D**（修正）                                                     |
| CP-2.13        | A+B 含糊     | **拆为 2.13a (B) + 2.13b (A)**                                      |
| CP-3.8         | B+D 含糊     | **拆为 3.8a (B) + 3.8b (B) + 3.8c (D)**                             |
| CP-2.6         | 单条         | **拆为 2.6a (D) + 2.6b (B) + 2.6c (B+D)** 强制 evidenceUsed 来自 DB |
| CP-4.5         | 单条         | 拆 4.5a (B) + 4.5b (A)                                              |
| CP-3.11        | 单条         | 拆 3.11a (B) + 3.11b (A)                                            |
| CritiqueRefine | "可选"       | **明确 E（废弃）**                                                  |
| Iron wall      | 1 个 utility | 拆为 6 个独立 utility（UT-IW-\*）                                   |
| 遗漏           | ——           | 补 M.1-M.8 8 项                                                     |

---

## 九、下一步

通过 Gate 1 后进入 `02-target-architecture.md` v2 的细节（已与本文档同步）。
