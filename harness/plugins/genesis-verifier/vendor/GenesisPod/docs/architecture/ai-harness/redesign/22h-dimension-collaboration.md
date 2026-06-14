# Dimension + Collaboration 层行为契约

**基线 Commit**: 38347e2a71d96266ccf3c52069c03dd15bf16af5
**生成日期**: 2026-04-24
**源**: agent `a2086afbea2c4620d` 概要 + 本地 Read 补充核心方法

**总服务数**: 13 (dimension 8 + collaboration 5)
**总代码行数**: ~12,821
**总 public methods**: ~56

---

## Part A · Dimension 层（8 services）

### 5.1 · dimension-mission.service.ts（2818 行，9 个 public methods） ⭐ **执行主引擎**

#### method: executeDimensionMission（L930）· **核心编排入口**

- **调用者**: DimensionResearchExecutor
- **业务用途**: 对单个 dimension 完整走 Phase 1-3 研究生命周期（搜索 → 写作）
- **控制流**:
  - Phase 1: executeSearchPhase 拉 evidence（含 enrichment、figure 提取）
  - Phase 2: leader-planning.planDimensionOutline 产出 sections + allocatedFigures
  - Phase 3: executeWritingPhase 按 section 并行写作，质量门关卡后定稿
- **Prisma**: 交互式事务保证 evidence + citation 原子写入
- **业务不变量**:
  - 研究完成后必须把 dimensionSections 写回 DB
  - citationIndex 必须从 `aggregate(max) + 1` 起始
  - evidence 分配：top-3 所有 section 共享 + 剩余轮询唯一分配

#### method: executeSearchPhase（L410）

- **业务用途**: Phase 1 搜索 + enrichment + evidence 写 DB
- **控制流**:
  - 调 dimension-search.executeSearch → 获得 SearchResult
  - 调 dimension-search.enrichResults → 3000 字全文 + figures
  - 构造 citationIndex 从 `existingMax + 1`
  - 交互式事务：createMany evidence + createMany topicEvidenceSection mapping
  - 发出 `dimension:research_progress` 事件
- **业务不变量**:
  - evidence.citationIndex 连续（1, 2, 3..., 不允许跳号）
  - topicEvidenceSection 必须与 evidence 原子写入

#### method: executeWritingPhase（L1162）

- **业务用途**: Phase 2-3 按 section 并行写作 + QC + 自动修订
- **控制流**:
  - 按 section.dependsOn 构造 batch（无依赖的先跑）
  - 并行调 section-writer.writeSection（带 QC 流）
  - QC fail → section-remediation.remediate → re-QC
  - 所有 section 通过后 → 把 content 写回 dimension.analysisResult

#### 私有辅助方法

- `cleanSectionOutput(L2004)` — 剥离 `<think>` / `<reasoning>` / 代码围栏外 JSON 泄漏
- `distributeDiverseEvidence(L2064)` — top-3 共享 + round-robin + 域名多样性
- `scoreEvidenceForSection(L2137)` — 关键词相关性评分
- `filterEvidenceForSection(L2192)` — 按评分阈值过滤
- `extractKeyTermsFromResults(L2267)` / `extractKeywords(L2321)` — 关键词提取
- `getPreviousSections(L2461)` — 取前面完成的 section 避免重复
- `extractDomainFromUrl(L2487)` — 域名提取（用于多样性判断）
- `prepareEnrichedEvidenceData(L2501)` — 包装增强后证据
- `validateAllocatedFigures(L2529)` — 校验 figure 有效性
- `convertToAnalysisResult(L2780)` — 转换为 DimensionAnalysisResult

### 5.2 · dimension-progress.service.ts（112 行，1 method）

- `updateProgress(missionId, dimensionId, stage, percent)`
- 阶段-aware 进度计算（searching=30% / writing=70%）
- heartbeat 时间戳更新

### 5.3 · dimension-search.service.ts（480 行，2 methods）

- `executeSearch`: Phase 1 搜索，支持 RAG-Fusion 多查询
- `enrichResults`: enrichment (topN=15, maxContentLength=3000) + temporal 上下文提取

### 5.4 · dimension-writing.service.ts（1671 行，2 methods）

- Phase 2-3 写作主流程
- QC → auto-fix → reviseSection → QC → selfEval 循环
- `RemediationTrace` 审计记录（before/after scores + actions）

### 5.5 · section-writer.service.ts（2600+ 行，2 methods）

- 并行 batch 写作（按 dependsOn 分组）
- evidence 按关键词相关性过滤
- **citationIndex 从大到小排序**（防碰撞写回）

### 5.6 · content-analysis.utils.ts（209 行，6 funcs 纯函数）

- 趋势/挑战/机会提取（关键词匹配）
- 多策略 section 提取：headers → bold → sentences
- 安全日期校验（防 Invalid Date）

### 5.7 · credibility.utils.ts（160 行，1 func）

- **4 维评分**：
  - domain authority (max 40)
  - source type (max 30)
  - content depth / snippet length (max 15)
  - timeliness (max 15)
- **最低分 15**（所有 source 保底）

### 5.8 · evidence-summary.utils.ts（196 行，2 funcs）

- evidence 格式化 + figure 注册表
- **figure 3 层排序**：可信度 → 类型 → caption 质量
- **MAX_FIGURES_FOR_LEADER = 40**
- caption fallback 检测

---

## Part B · Collaboration 层（5 services）

### 5.9 · research-reflection.service.ts（241 行，2 methods） ⭐ **证据充足度**

#### method: evaluateEvidence(context)

- **业务用途**: LLM 判断当前证据是否足够支撑研究结论
- **返回**: `{ decision: "sufficient"|"need_more"|"pivot", score, gaps[], reasoning }`
- **业务不变量**:
  - score ≥ 70 && gaps.empty() → sufficient
  - 异常 → **默认 sufficient (score 70)** 防止阻塞

#### method: quickCheck(evidence)

- **业务用途**: 启发式无-LLM 快速检查
- **规则**:
  - evidence.length < 3 → 需完整评估
  - valid ratio < 50% → 需完整评估
  - avg length < 200 chars → 需完整评估

### 5.10 · research-reviewer.service.ts（1026 行，4 methods）

- **5 维质量评分**: breadth / depth / evidence / coherence / currency
- **阈值**: 90+ excellent / 75-89 good / 60-74 acceptable / 40-59 needs_revision / <40 rejected
- Batch claim validation (max 5 per LLM call)
- Fact-checking 对比原始 evidence + citation matching

### 5.11 · research-todo.service.ts（1743 行，5 methods）

- TODO 序列生成 + 执行编排
- 操作类型检测（基于 title 模式）
- 优先级队列处理（dimension addition）
- 递归异步队列（fire-and-forget + BillingContext 传播）
- Agent 命名: `researcher_{sanitizedName}_{timestamp}`

### 5.12 · review-workflow.service.ts（373 行，4 methods）

- 按 section 生成 ReviewTask（Executive Summary + 各 dim）
- **发布门**: all tasks completed && approved > 0 && rejected = 0
- 审核统计跟踪

### 5.13 · topic-collaborator.service.ts（724 行，5 methods）

- 角色层级: `VIEWER < EDITOR < ADMIN`
- 权限矩阵（按 topic type）:
  - OWNER: full
  - PUBLIC: read-only
  - SHARED: role-based
  - PRIVATE: owner-only
- SHARED topic 申请自动批准；其他 pending review

---

## 关键技术模式

### 1. Citation 管理

- citationIndex 必须连续（1, 2, 3, ...）
- evidence mapping: promptIndex → actualCitationIndex
- 交互式事务防竞态

### 2. Evidence 分配

- top-3 所有 section 共享
- 剩余按 round-robin 唯一分配
- 每个 section 至少 1 条 evidence

### 3. Quality Gate 三级

- 代码规则（非破坏性修复）
- AI 批评-修订循环
- 最终定稿门

### 4. Fire-and-forget

- `void` 显式标记
- BillingContext 传播
- Socket emission 实时推进

### 5. Prisma 模式

- `aggregate(max)` 取 citationIndex 起始
- batch `createMany` 批量写 evidence
- `topicEvidenceSection` mapping 维护 section-evidence 关系
- 角色校验 via `findMany + filter`

---

## 业务不变量总表

1. **Citation 连续不变量** · 跨所有操作保持连续（1..N，不跳号）
2. **Evidence 不重复不变量** · 同一 evidence 不重复分配到同一 section（top-3 共享例外）
3. **Quality Gate 阻塞不变量** · QC 必须通过才能定稿
4. **USER_REQUEST 串行不变量** · 同时只能有 1 个 USER_REQUEST TODO 执行
5. **ReviewTask 全完成不变量** · 所有 ReviewTask 完成才能发布报告
6. **RBAC 严格不变量** · 按 topic type 严格执行角色权限
7. **reflection 默认放行不变量** · LLM 解析失败默认 `sufficient` 不阻塞
8. **citation 倒序写回不变量** · section-writer 按 citationIndex 从大到小排序 prevent collision
9. **evidence 4 维最低 15 分不变量** · credibility 评分下限 15
10. **figure 40 条硬上限不变量** · MAX_FIGURES_FOR_LEADER = 40

---

## Prompt 索引

| Prompt 常量                | 来源                       | 用途                                        |
| -------------------------- | -------------------------- | ------------------------------------------- |
| LEADER_REFLECTION_PROMPT   | prompts/research-depth     | evaluateEvidence                            |
| DIMENSION_OUTLINE_PROMPT   | prompts/research-leader    | dimension-writing.writeSection 前的 outline |
| SECTION_WRITING_PROMPT     | prompts/dimension-research | section-writer 写作                         |
| QC_VALIDATION_PROMPT       | prompts/research-depth     | quality gate                                |
| SECTION_REMEDIATION_PROMPT | prompts/research-depth     | 低分修订                                    |

---

## 统计

| Service                        | LOC         | public methods |
| ------------------------------ | ----------- | -------------- |
| dimension-mission.service.ts   | 2818        | 9              |
| dimension-progress.service.ts  | 112         | 1              |
| dimension-search.service.ts    | 480         | 2              |
| dimension-writing.service.ts   | 1671        | 2              |
| section-writer.service.ts      | 2600+       | 2              |
| content-analysis.utils.ts      | 209         | 6 funcs        |
| credibility.utils.ts           | 160         | 1 func         |
| evidence-summary.utils.ts      | 196         | 2 funcs        |
| research-reflection.service.ts | 241         | 2              |
| research-reviewer.service.ts   | 1026        | 4              |
| research-todo.service.ts       | 1743        | 5              |
| review-workflow.service.ts     | 373         | 4              |
| topic-collaborator.service.ts  | 724         | 5              |
| **总计**                       | **~12,821** | **56**         |
