# V5 认知研究团队架构 -- 设计与实现

> **文档版本**: v5.1
> **最后更新**: 2026-02-01
> **状态**: 已实施（统一入口，Mission 路径完整接入 V5 深度门控）

---

## 目录

- [1. 愿景与定位](#1-愿景与定位)
- [2. 架构总览](#2-架构总览)
  - [2.1 五层架构](#21-五层架构)
  - [2.2 研究深度体系](#22-研究深度体系)
  - [2.3 执行流程](#23-执行流程)
- [3. Layer 1: 研究设计层](#3-layer-1-研究设计层)
- [4. Layer 2: 知识构建层](#4-layer-2-知识构建层)
- [5. Layer 3: 分析推理层](#5-layer-3-分析推理层)
- [6. Layer 4: 写作合成层](#6-layer-4-写作合成层)
- [7. Layer 5: 编辑审校层](#7-layer-5-编辑审校层)
- [8. 基础设施](#8-基础设施)
  - [8.1 检查点系统](#81-检查点系统)
  - [8.2 类型体系](#82-类型体系)
  - [8.3 提示词体系](#83-提示词体系)
- [9. 统一执行路径](#9-统一执行路径)
  - [9.1 双路径问题 (v5.0 遗留)](#91-双路径问题-v50-遗留)
  - [9.2 统一方案 (v5.1)](#92-统一方案-v51)
  - [9.3 前端接入](#93-前端接入)
- [10. 缺陷根因分析](#10-缺陷根因分析)
- [11. 实现状态与路线图](#11-实现状态与路线图)
- [12. 文件清单](#12-文件清单)
- [13. 测试覆盖](#13-测试覆盖)

---

## 1. 愿景与定位

**目标**: 构建能替代 5-8 人专业研究团队的 AI 研究系统。

**核心范式转变**:

```
V3（流水线）: 搜索 -> 写作 -> 审查 -> 完成
V5（认知循环）: 设计 -> 搜索 -> 分析验证 -> 写作 -> 事实核查
```

**对标角色映射**:

| 研究团队角色 | V5 对应机制             | 实现服务                                                          |
| ------------ | ----------------------- | ----------------------------------------------------------------- |
| 研究总监     | Leader + ResearchDesign | `ResearchLeaderService`                                           |
| 文献研究员   | 文献基线扫描            | `DataSourceRouterService.scanLiteratureBaseline`                  |
| 数据研究员   | 假设驱动搜索            | `DataSourceRouterService.searchForHypothesis`                     |
| 事实核查员   | Claim 交叉验证          | `ResearchReviewerService.validateClaims`                          |
| 高级研究员   | 假设检验                | `ResearchLeaderService.verifyHypotheses`                          |
| 撰稿人       | 章节写作                | `SectionWriterService`                                            |
| 编辑         | 事实核查 + 去重         | `ResearchReviewerService.factCheckReport` + `ReportEditorService` |

---

## 2. 架构总览

### 2.1 五层架构

```
+----------------------------------------------------------------+
|                   TopicTeamOrchestratorService                   |
|                                                                  |
|  +-------------+  +-------------+  +--------------------------+ |
|  | Layer 1     |  | Layer 2     |  | Layer 3                  | |
|  | 研究设计    |->| 知识构建    |->| 分析推理                 | |
|  | (Leader)    |  | (Router)    |  | (认知循环)               | |
|  +-------------+  +-------------+  +----------+---------------+ |
|                                                |                 |
|  +-------------+  +----------------------------v--------------+  |
|  | Layer 5     |<-| Layer 4                                   |  |
|  | 编辑审校    |  | 写作合成                                  |  |
|  +------+------+  +------------------------------------------+  |
|         |                                                        |
|  +------v-----------------------------------------------------+  |
|  |           ResearchCheckpointService (V5 检查点)              |  |
|  |  L2_knowledge | L3_analysis | L4_writing | depthConfig       |  |
|  +-------------------------------------------------------------+  |
+----------------------------------------------------------------+
```

### 2.2 研究深度体系

V5 使用 `ResearchDepth` 三级体系替代 V3 的 `standard/deep` 二分法，通过 `resolveResearchDepthConfig()` 函数将深度映射为精确的配置参数。

**参数对照表** (实际实现值):

| 参数                        | `quick` | `standard` | `thorough` |
| --------------------------- | ------- | ---------- | ---------- |
| `knowledgeIterations`       | 1       | 2          | 3          |
| `maxCognitiveLoops`         | 0       | 1          | 2          |
| `maxRevisionRounds`         | 0       | 1          | 2          |
| `crossValidationEnabled`    | false   | true       | true       |
| `hypothesisTestingEnabled`  | false   | true       | true       |
| `factCheckEnabled`          | false   | false      | true       |
| `literatureBaselineEnabled` | false   | true       | true       |

**深度门控矩阵** (orchestrator 中的实际 if 分支):

| 特性           | 门控条件                                        | quick | standard | thorough |
| -------------- | ----------------------------------------------- | ----- | -------- | -------- |
| 文献基线扫描   | `knowledgeIterations >= 2`                      | -     | O        | O        |
| 假设驱动查询   | `hypothesisTestingEnabled && hypotheses.length` | -     | O        | O        |
| 认知循环       | `maxCognitiveLoops > 0`                         | -     | O        | O        |
| Claim 交叉验证 | 认知循环内部                                    | -     | O        | O        |
| 假设检验       | `hypothesisTestingEnabled`                      | -     | O        | O        |
| 事实核查       | `factCheckEnabled`                              | -     | -        | O        |

### 2.3 执行流程

```
executeRefresh(topic, { researchDepth })
  |
  |-- resolveResearchDepthConfig(depth)
  |
  |-- [L2] 文献基线扫描 (standard/thorough)
  |     DataSourceRouterService.scanLiteratureBaseline()
  |
  |-- Phase 1: 并行搜索所有维度
  |     DimensionMissionService.executeSearchPhase()
  |     -> saveCheckpoint(L2_knowledge)
  |
  |-- Phase 2: 全局大纲规划
  |     ResearchLeaderService.planGlobalOutline()
  |     -> 提取 researchDesign (框架 + 假设)
  |     -> saveCheckpoint(L2_knowledge + researchDesign)
  |
  |-- [L2] 假设驱动查询 (standard/thorough)
  |     DataSourceRouterService.searchForHypothesis()
  |
  |-- Phase 3: 并行写作所有维度
  |     DimensionMissionService.executeWritingPhase(maxRevisionRounds)
  |     -> saveCheckpoint(L4_writing) per dimension
  |
  |-- [L3] 认知循环 (standard/thorough)
  |     |-- 收集所有 extractedClaims
  |     |-- ResearchReviewerService.validateClaims()
  |     |-- ResearchLeaderService.verifyHypotheses()
  |     |-- buildValidationContextForWriting()
  |     -> saveCheckpoint(L3_analysis)
  |
  |-- Phase 4: 质量审核
  |     ResearchReviewerService.reviewDimension() + reviewOverall()
  |
  |-- Phase 5: 报告合成
  |     ReportSynthesisService.synthesizeReport()
  |
  |-- [L5] 事实核查 (thorough)
  |     ResearchReviewerService.factCheckReport()
  |
  |-- 更新状态，输出最终报告
```

---

## 3. Layer 1: 研究设计层

**职责**: 在搜索之前确定分析框架、研究假设和交付标准。

**实现位置**: `ResearchLeaderService.planGlobalOutline()` 的 prompt 中通过 `RESEARCH_DESIGN_EXTENSION` 指令扩展。

**ResearchDesign 类型定义** (`v5-research.types.ts`):

```typescript
interface ResearchDesign {
  analyticalFramework: string; // PESTEL, Porter, SWOT 等
  frameworkRationale: string; // 框架选择理由
  hypotheses: ResearchHypothesis[]; // 3-5 个可验证假设
  deliverables: DeliverableSpec[]; // 交付标准
}

interface ResearchHypothesis {
  id: string;
  statement: string;
  type: "causal" | "correlational" | "descriptive" | "predictive";
  evidenceNeeded: string;
  counterQuery?: string; // 反方向搜索查询
}
```

**数据流**: Leader 在 `planGlobalOutline` 阶段生成 `researchDesign`，orchestrator 提取后用于:

1. 驱动假设搜索查询 (L2)
2. 提供假设验证的输入 (L3)
3. 注入写作上下文 (L4)

---

## 4. Layer 2: 知识构建层

### 4.1 文献基线扫描

**服务**: `DataSourceRouterService.scanLiteratureBaseline(topic, dimension)`

**行为**:

1. 生成 3 条学术导向查询:
   - `site:mckinsey.com OR site:bcg.com OR site:hbr.org` (咨询报告)
   - `site:gartner.com OR site:forrester.com OR site:deloitte.com` (分析白皮书)
   - `academic paper` (学术论文)
2. 通过 `executeSearch(WEB, query, 5)` 执行搜索
3. 按 URL 去重
4. 单条查询失败不阻塞其余

**触发条件**: `depthConfig.knowledgeIterations >= 2` (standard/thorough)

**限制**: 仅扫描前 3 个维度，避免 API 过载。

### 4.2 假设驱动搜索

**服务**: `DataSourceRouterService.searchForHypothesis(hypothesisStatement)`

**行为**:

1. 从假设语句提取关键词 (前 6 个 >2 字符的词)
2. 生成正方查询: `${keywords} evidence support`, `${keywords} research findings`
3. 生成反方查询: `${keywords} criticism challenges limitations`, `${keywords} counter evidence against`
4. 正反方向并行执行 (`Promise.all`)
5. 返回 `{ supportResults, counterResults }`

**触发条件**: `depthConfig.hypothesisTestingEnabled && researchDesign.hypotheses.length > 0`

**限制**: 仅处理前 3 个假设。

### 4.3 主搜索流程

保留 V3 的三阶段并行搜索:

- **Phase 1**: `DimensionMissionService.executeSearchPhase()` 并行搜索所有维度
- **Phase 2**: `ResearchLeaderService.planGlobalOutline()` 全局大纲协调
- **Phase 3**: `DimensionMissionService.executeWritingPhase()` 并行写作

---

## 5. Layer 3: 分析推理层

### 5.1 Claim 提取

**服务**: `ResearchLeaderService.extractClaims(sectionId, sectionContent)`

**行为**:

- 使用 `CLAIM_EXTRACTION_PROMPT` 从章节内容提取可验证的事实断言
- 模型: `AIModelType.CHAT_FAST`
- 返回 `ExtractedClaim[]`，每个包含: `id`, `statement`, `sectionId`, `sourceEvidenceIndices`, `importance`
- AI 返回无效 JSON 或异常时返回空数组

### 5.2 Claim 交叉验证

**服务**: `ResearchReviewerService.validateClaims(claims, evidenceSummary)`

**行为**:

1. 按批次处理，每批 5 个 claims (`BATCH_SIZE = 5`)
2. 使用 `CLAIM_VALIDATION_PROMPT` 让 AI 语义匹配 claims 与证据
3. 每个 claim 标记为: `verified` / `unverified` / `disputed`
4. 批次失败时该批 claims 标记为 `unverified`
5. 返回 `ClaimValidationBatchResult` 含 `results[]` 和 `stats`

**统计输出示例**:

```
[V5] Claim validation: 8 verified, 3 unverified, 1 disputed
```

### 5.3 假设检验

**服务**: `ResearchLeaderService.verifyHypotheses(hypotheses, evidenceSummary)`

**行为**:

- 使用 `HYPOTHESIS_VERIFICATION_PROMPT` 验证每个假设
- 模型: `AIModelType.CHAT_FAST`
- 返回 `HypothesisVerificationResult[]`，每个包含:
  - `status`: `"supported"` / `"refuted"` / `"partially_supported"` / `"inconclusive"`
  - `confidence`: 0-100
  - `supportingEvidence` / `contradictingEvidence`
  - `refinedStatement` (部分否定时的修正建议)
- 空假设列表直接返回空数组，不调 AI

### 5.4 认知循环

**位置**: `TopicTeamOrchestratorService.executeRefresh()` 内

**流程**:

```
if (maxCognitiveLoops > 0) {
  收集 allClaims from analysisResults
  if (allClaims.length > 0) {
    claimValidation = validateClaims(allClaims, evidenceSummary)
    if (hypothesisTestingEnabled && hypotheses.length) {
      hypothesisResults = verifyHypotheses(hypotheses, evidenceSummary)
      validationContext = buildValidationContextForWriting(
        claimValidation.results, hypothesisResults
      )
    }
  }
  saveCheckpoint(L3_analysis)
}
```

### 5.5 验证上下文生成

**函数**: `buildValidationContextForWriting(claimResults, hypothesisResults)`

**输出内容**:

- **争议断言**: 列出 `disputed` claims，提示写作时需标注不同观点
- **未验证断言**: 列出 `unverified` claims，提示使用谨慎措辞
- **被否定假设**: 列出 `refuted` hypotheses，提示不作为结论
- **需修正假设**: 列出 `partially_supported` hypotheses 及其修正建议
- 无问题时返回空字符串

---

## 6. Layer 4: 写作合成层

### 6.1 章节写作

**服务**: `DimensionMissionService.executeWritingPhase()`

**V5 扩展参数**:

- `validationContext?: string` -- 来自 L3 的验证上下文，注入写作 prompt
- `maxRevisionRounds?: number` -- 来自 `depthConfig.maxRevisionRounds`

**调用方式** (orchestrator):

```typescript
await dimensionMissionService.executeWritingPhase(
  topic,
  dimension,
  searchResult,
  outline,
  reportId,
  missionId,
  modelId,
  taskId,
  tools,
  skills,
  validationContext, // V5
  depthConfig.maxRevisionRounds, // V5
);
```

### 6.2 写作结果

`DimensionMissionResult` 包含:

- `analysisResult: DimensionAnalysisResult` -- 维度分析结果
- `evidenceIds: string[]` -- 使用的证据 ID
- `extractedClaims?: ExtractedClaim[]` -- V5: 从写作内容中提取的 claims

---

## 7. Layer 5: 编辑审校层

### 7.1 事实核查

**服务**: `ResearchReviewerService.factCheckReport(reportContent, evidenceData)`

**行为**:

1. 使用正则 `/([^.]*?\[(\d+)\][^.]*\.)/g` 提取报告中的 `[n]` 引用及上下文
2. 最多处理 30 个引用
3. 无引用时直接返回 `{ citations: [], accuracyScore: 100, issues: [] }`
4. 使用 `FACT_CHECK_PROMPT` 让 AI 核对引用与原始证据是否一致
5. AI 失败时返回 `{ citations: [], accuracyScore: 0, issues: ["事实核查过程出错"] }`

**触发条件**: `depthConfig.factCheckEnabled` (仅 thorough 模式)

**证据来源**: 从数据库查询 `topicEvidence` 表:

```typescript
const evidenceForFactCheck = await prisma.topicEvidence.findMany({
  where: { reportId: report.id },
  select: { id: true, title: true, snippet: true },
  take: 50,
});
```

### 7.2 质量审核

保留 V3 的质量审核体系:

- `reviewDimension()` -- 单维度审核 (广度/深度/证据/连贯/时效)
- `reviewOverall()` -- 整体审核 + 跨维度问题检测

### 7.3 报告去重

保留 V3 的 `ReportEditorService.editDimensionInputs()` 跨维度去重功能。

V5 新增类型定义 (待集成):

- `terminologyIssues` -- 术语一致性检查
- `dataConsistencyIssues` -- 数据一致性检查

---

## 8. 基础设施

### 8.1 检查点系统

**服务**: `ResearchCheckpointService.saveCheckpoint(missionId, context)`

**V5 检查点位置**:

| 触发时机         | phase 标记     | context 内容                            |
| ---------------- | -------------- | --------------------------------------- |
| Phase 1 搜索完成 | `L2_knowledge` | `searchedDimensions`, `totalDimensions` |
| Phase 2 大纲完成 | `L2_knowledge` | `researchDesign`, `depthConfig`         |
| 每维度写作完成   | `L4_writing`   | `completedDimension`, `completedCount`  |
| 认知循环完成     | `L3_analysis`  | `claimsCount`, `validationContext`      |

**容错**: 所有 `saveCheckpoint` 调用包裹在 `try/catch` 中，失败不阻塞主流程。

### 8.2 类型体系

**文件**: `types/v5-research.types.ts`

```
ResearchDepth = "quick" | "standard" | "thorough"
ResearchDepthConfig
  +-- knowledgeIterations
  +-- maxCognitiveLoops
  +-- maxRevisionRounds
  +-- crossValidationEnabled
  +-- hypothesisTestingEnabled
  +-- factCheckEnabled
  +-- literatureBaselineEnabled

ResearchDesign
  +-- analyticalFramework
  +-- frameworkRationale
  +-- hypotheses: ResearchHypothesis[]
  +-- deliverables: DeliverableSpec[]

ExtractedClaim
  +-- id, statement, sectionId
  +-- sourceEvidenceIndices
  +-- importance

ClaimValidationResult / ClaimValidationBatchResult
HypothesisVerificationResult
FactCheckResult / FactCheckCitation
V5CheckpointContext
```

### 8.3 提示词体系

**文件**: `prompts/v5-research.prompt.ts`

| 导出名                               | 用途                        | 使用者                     |
| ------------------------------------ | --------------------------- | -------------------------- |
| `RESEARCH_DESIGN_EXTENSION`          | L1: 框架选择 + 假设生成指令 | `planGlobalOutline` prompt |
| `CLAIM_EXTRACTION_PROMPT`            | L3: 从章节提取事实断言      | `extractClaims`            |
| `CLAIM_VALIDATION_PROMPT`            | L3: 语义匹配验证 claims     | `validateClaims`           |
| `HYPOTHESIS_VERIFICATION_PROMPT`     | L3: 验证研究假设            | `verifyHypotheses`         |
| `FACT_CHECK_PROMPT`                  | L5: 引用核查                | `factCheckReport`          |
| `ENHANCED_DEDUP_EXTENSION`           | L5: 术语/数据一致性检查     | 待集成                     |
| `buildValidationContextForWriting()` | L3->L4: 生成写作验证上下文  | orchestrator               |

---

## 9. 统一执行路径

### 9.1 双路径问题 (v5.0 遗留)

v5.0 存在一个严重的架构缺陷：**系统中有两条完全独立的执行路径，且只有一条实现了 V5 深度门控**。

```
路径 A（Orchestrator）: triggerRefresh() -> orchestrator.executeRefresh()
  - V5 深度门控: 完整实现
  - 认知循环/事实核查: 完整
  - 前端从未调用此路径

路径 B（Mission）: startLeaderPlan() -> missionService.createMission()
  - V5 深度门控: 不存在
  - 认知循环/事实核查: 不存在
  - 前端唯一入口
```

**后果**: 用户在前端选择 `thorough` 深度 -> 参数通过 DTO 传到后端 -> `createMission()` 接收但丢弃 -> 所有研究走无深度区分的 Mission 流水线 -> V5 特性从未激活。

**具体断裂点**:

| 断裂位置                           | 描述                                           |
| ---------------------------------- | ---------------------------------------------- |
| `createMission()` line 183         | 解构 input 时未提取 `researchDepth`            |
| `executePlanningAsync()`           | 参数列表无 `researchDepth`                     |
| `startExecution()`                 | 无 depthConfig 概念                            |
| `finalizeMission()`                | 任务全部完成后直接标记 COMPLETED，无 V5 后处理 |
| `executeTask()` dimension_research | 调用 `executeDimensionMission()` 时不传 depth  |
| Prisma `ResearchMission` 模型      | 无 `researchDepth` 字段，无法持久化            |

### 9.2 统一方案 (v5.1)

**核心思路**: Mission 路径是前端唯一入口，在其中按深度注入 V5 阶段，而非要求前端切换路径。

```
用户选择深度 -> startLeaderPlan(depth) -> createMission(depth)
  |
  |-- 持久化 researchDepth 到 Mission 记录
  |-- executePlanningAsync() 传递 researchDepth
  |-- startExecution() 读取 mission.researchDepth
  |
  |-- Phase A: 并行执行 dimension_research 任务 (已有)
  |     -> 每个任务通过 executeDimensionMission()
  |
  |-- Phase B: quality_review 任务 (已有)
  |
  |-- Phase C: V5 后处理 (新增，在 report_synthesis 之前)
  |     |
  |     |-- [standard+] 认知循环:
  |     |     收集所有维度结果中的 claims
  |     |     -> validateClaims()
  |     |     -> verifyHypotheses()
  |     |     -> buildValidationContextForWriting()
  |     |     -> 发送进度事件: "V5: 认知循环分析中..."
  |     |
  |     |-- [thorough] 事实核查:
  |     |     -> factCheckReport()
  |     |     -> 发送进度事件: "V5: 事实核查中..."
  |     |
  |     |-- 持久化 V5 结果到 mission 元数据
  |
  |-- Phase D: report_synthesis 任务 (已有，注入 validationContext)
  |
  |-- finalizeMission()
```

**关键修改点**:

| 修改           | 文件                          | 内容                                              |
| -------------- | ----------------------------- | ------------------------------------------------- |
| 持久化 depth   | `models.prisma`               | `ResearchMission` 新增 `researchDepth String?`    |
| 存储 depth     | `research-mission.service.ts` | `createMission()` 写入 `researchDepth`            |
| V5 后处理      | `research-mission.service.ts` | `report_synthesis` case 中注入认知循环 + 事实核查 |
| 进度事件       | `research-mission.service.ts` | 发送 V5 阶段特有的 WebSocket 事件                 |
| 前端显示       | `TopicTeamPanel.tsx`          | 在任务进度中展示当前 V5 阶段                      |
| API 返回 depth | mission 查询                  | 返回 `researchDepth` 字段                         |

**为什么不让 Mission 路径调用 Orchestrator？**

Orchestrator 的 `executeRefresh()` 是一个端到端的同步流程（搜索->写作->审核->合成），而 Mission 路径使用 **异步任务调度** 模型（Leader规划 -> 创建Tasks -> 动态调度执行）。两者的执行模型完全不同：

- Orchestrator: 单线程流水线，自己控制并行度
- Mission: 任务队列 + 动态调度器，每个任务独立执行

强行让 Mission 调用 Orchestrator 会破坏任务调度模型。正确做法是 **将 V5 的具体能力（认知循环、事实核查）作为独立阶段注入 Mission 流程中**，而非合并两条路径。

### 9.3 前端接入

**深度选择器**: 已在 `TopicTeamPanel.tsx` 实现，位于操作按钮上方。

```
+-----------------------------------------+
| 研究深度                                 |
| [快速]     [标准(默认)]     [深度]       |
| 基础搜索   文献+认知循环    全部V5功能   |
+-----------------------------------------+
| [▶ 开始]  [🔄 更新]  [■ 取消]          |
+-----------------------------------------+
```

**进度展示**: Mission 状态中包含 `researchDepth` 字段，前端可根据深度显示预期阶段。

**Phase 映射** (统一后):

| 内部阶段    | 前端 phase     | progress | 深度要求  |
| ----------- | -------------- | -------- | --------- |
| Leader 规划 | `planning`     | 0-10     | all       |
| 维度研究    | `researching`  | 10-60    | all       |
| 质量审核    | `reviewing`    | 60-70    | all       |
| 认知循环    | `reviewing`    | 70-80    | standard+ |
| 事实核查    | `reviewing`    | 80-85    | thorough  |
| 报告合成    | `synthesizing` | 85-95    | all       |
| 完成        | `completed`    | 100      | all       |

---

## 10. 缺陷根因分析

### 10.1 为什么 v5.0 方案遗漏了双路径问题？

**根本原因: V5 的设计视角是"能力层"而非"业务流"。**

V5 的设计文档（本文件的 v5.0 版）从头到尾围绕 Orchestrator 的五层架构展开，但从未分析过 **前端用户实际触发研究的入口和调用链**。具体表现为：

1. **只关注了"引擎"，忽略了"驾驶舱"**: V5 架构图展示的是 `TopicTeamOrchestratorService` 内部的分层，但系统中实际有两个"引擎"（Orchestrator 和 Mission），只给其中一个装了 V5 功能。

2. **"前端兼容性"章节的假设错误**: 原文写"后端所有 V5 改进通过现有接口输出，前端零改动"。这个假设隐含了"前端调用的是 Orchestrator 路径"，但实际前端从 v7.0 起就切换到了 Leader/Mission 路径。**文档没有追踪前端的实际调用链。**

3. **测试覆盖了能力，没覆盖集成**: 29 个测试全部针对 V5 的独立能力（extractClaims、validateClaims 等）和 Orchestrator 的门控逻辑，但没有一个测试验证"用户从前端发起研究 -> V5 功能是否生效"这一端到端场景。

4. **两套系统的演进没有同步**: Orchestrator（V3 时代的主路径）和 Mission（V7 新增的 Leader-Agent 协作路径）是两个独立演进的系统。V5 只改了 Orchestrator，V7 只改了 Mission，从未有人检查两者是否对齐。

### 10.2 同类遗漏检查

基于上述根因，检查是否有其他类似的断裂：

| 检查项                                 | 状态     | 说明                                                                      |
| -------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Mission 路径是否调用了 V3 质量审核？   | 已有     | `quality_review` 任务类型中调用了 `reviewDimension()` + `reviewOverall()` |
| Mission 路径是否调用了报告合成？       | 已有     | `report_synthesis` 任务类型中调用了 `synthesizeReport()`                  |
| `validationContext` 是否注入了写作？   | **缺失** | Orchestrator 路径已构建但从未传入；Mission 路径完全没有此概念             |
| `extractClaims` 是否在写作后调用？     | **缺失** | 方法已实现但从未在任何路径调用                                            |
| `maxRevisionRounds` 是否真正执行多轮？ | **缺失** | 参数已传递但写作层并未实际执行多轮修订                                    |
| Checkpoint 数据是否可读？              | **缺失** | 只有写入 API，无读取 API                                                  |
| 定时刷新是否受深度影响？               | 否       | `TopicRefreshScheduler` 硬编码 `incremental: true`，不传 depth            |

### 10.3 v5.1 解决范围

本次实现 (v5.1) 聚焦解决 **P0 级缺陷** -- Mission 路径接入深度门控：

- **修复**: Mission 路径存储和使用 `researchDepth`
- **修复**: `report_synthesis` 任务执行前插入认知循环 + 事实核查
- **修复**: 前端深度选择器真正生效
- **修复**: 进度事件包含 V5 阶段信息

以下 P1/P2 问题记录在路线图中，不在本次范围：

- `extractClaims` 集成到写作阶段
- `validationContext` 注入写作 prompt
- 多轮修订实际执行
- Checkpoint 读取 API

---

## 11. 实现状态与路线图

### 已完成 (v5.1)

| 特性                         | 层       | 服务                               | 状态 |
| ---------------------------- | -------- | ---------------------------------- | ---- |
| 研究深度配置                 | L1       | `resolveResearchDepthConfig`       | 完整 |
| 深度门控 (Orchestrator)      | 全局     | `TopicTeamOrchestratorService`     | 完整 |
| 深度门控 (Mission)           | 全局     | `ResearchMissionService`           | 完整 |
| 文献基线扫描                 | L2       | `DataSourceRouterService`          | 完整 |
| 假设驱动查询                 | L2       | `DataSourceRouterService`          | 完整 |
| Claim 交叉验证               | L3       | `ResearchReviewerService`          | 完整 |
| 假设检验                     | L3       | `ResearchLeaderService`            | 完整 |
| 验证上下文生成               | L3/L4    | `buildValidationContextForWriting` | 完整 |
| 事实核查                     | L5       | `ResearchReviewerService`          | 完整 |
| 检查点系统                   | 基础设施 | `ResearchCheckpointService`        | 完整 |
| `maxRevisionRounds` 传递     | L4       | orchestrator -> writing            | 完整 |
| Mission researchDepth 持久化 | DB       | Prisma schema                      | 完整 |
| 前端深度选择器               | 前端     | `TopicTeamPanel.tsx`               | 完整 |
| Mission V5 后处理            | 全局     | `ResearchMissionService`           | 完整 |

### 待连接 (方法已实现，集成点待补)

| 特性                | 缺失连接                                           | 优先级 |
| ------------------- | -------------------------------------------------- | ------ |
| Claim 提取集成      | `extractClaims` 未在写作阶段调用                   | P1     |
| 验证上下文注入      | `validationContext` 已构建但未传入写作 prompt      | P1     |
| 术语/数据一致性检查 | `ENHANCED_DEDUP_EXTENSION` 已定义但未集成到 editor | P2     |
| 认知循环闭环        | 验证结果未驱动回 L2 补充搜索                       | P2     |
| 修订轮次执行        | `maxRevisionRounds` 已传递但写作层未实际执行多轮   | P2     |
| Checkpoint 读取 API | 只有写入，无前端查询入口                           | P2     |
| 定时刷新深度        | `TopicRefreshScheduler` 不传 depth                 | P3     |

---

## 12. 文件清单

| 文件                                          | 层       | V5 改动                                                        |
| --------------------------------------------- | -------- | -------------------------------------------------------------- |
| `types/v5-research.types.ts`                  | 基础设施 | **新增**: 所有 V5 类型定义                                     |
| `prompts/v5-research.prompt.ts`               | 基础设施 | **新增**: 所有 V5 提示词                                       |
| `services/topic-team-orchestrator.service.ts` | 全局     | **修改**: 深度门控 + 认知循环 + 检查点                         |
| `services/research-mission.service.ts`        | 全局     | **修改**: V5 后处理阶段（认知循环 + 事实核查）                 |
| `services/research-leader.service.ts`         | L1/L3    | **修改**: 新增 `extractClaims`, `verifyHypotheses`             |
| `services/research-reviewer.service.ts`       | L3/L5    | **修改**: 新增 `validateClaims`, `factCheckReport`             |
| `services/data-source-router.service.ts`      | L2       | **修改**: 新增 `scanLiteratureBaseline`, `searchForHypothesis` |
| `services/research-checkpoint.service.ts`     | 基础设施 | **修改**: V5 检查点上下文扩展                                  |
| `services/dimension-mission.service.ts`       | L4       | **修改**: 新增 `validationContext`, `maxRevisionRounds` 参数   |
| `services/section-writer.service.ts`          | L4       | **修改**: V5 验证上下文支持                                    |
| `services/report-editor.service.ts`           | L5       | **修改**: V5 术语/数据一致性类型                               |
| `dto/leader.dto.ts`                           | DTO      | **修改**: 新增 `researchDepth` 字段                            |
| `dto/refresh.dto.ts`                          | DTO      | **修改**: 新增 `researchDepth` 字段                            |
| `prisma/schema/models.prisma`                 | DB       | **修改**: `ResearchMission` 新增 `researchDepth`               |

---

## 13. 测试覆盖

**测试文件位置**: `__tests__/unit/`

| 测试文件                        | 测试数 | 覆盖范围                                                                      |
| ------------------------------- | ------ | ----------------------------------------------------------------------------- |
| `v5-research-types.spec.ts`     | 5      | `resolveResearchDepthConfig` 三档配置 + `buildValidationContextForWriting`    |
| `v5-research-leader.spec.ts`    | 5      | `extractClaims` (成功/无效JSON/异常) + `verifyHypotheses` (成功/空输入)       |
| `v5-research-reviewer.spec.ts`  | 7      | `validateClaims` (批量/失败/空/统计) + `factCheckReport` (成功/无引用/失败)   |
| `v5-data-source-router.spec.ts` | 5      | `scanLiteratureBaseline` (查询/去重/容错) + `searchForHypothesis` (正反/容错) |
| `v5-orchestrator.spec.ts`       | 7      | 深度门控 (quick/standard/thorough) + 检查点 + 修订轮次 + 事实核查             |

**运行命令**:

```bash
cd backend && npx jest --testPathPattern="v5-" --verbose
```

**结果**: 29 tests, 5 suites, all passing.

---

**架构演进路径**:

- V3: 流水线（搜索 -> 写作 -> 审查）
- V5.0: 认知循环（假设驱动 + 交叉验证 + 事实核查）-- 仅 Orchestrator 路径
- **V5.1: 统一入口**（Mission 路径完整接入 V5 深度门控）<- 当前版本
- V6 (规划中): 认知循环闭环 + 多轮修订 + 多模型专家系统
