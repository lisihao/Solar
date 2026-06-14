# Baseline vs HEAD 能力缺失审计

> 2026-04-24 ｜ 基线 commit `aaff7b15e`（Apr 21 EDT 末尾）vs HEAD。
> 目的：把 harness 迁移中丢失的业务能力列清楚，为后续补齐排期。

## TL;DR

Harness 迁移（bb5fb8b9a + 前置 R1-R8 + 8 批 sota 重构）删掉了 **94 个文件**。
多数是架构换形（plan-based 老 agent / task-executor / god-service → spec-agent +
pipeline stage），属于**有意迁移**。但扫到 4 类**真实能力空白**需要补：

| 类别                                         | 严重度 | 影响                                                              |
| -------------------------------------------- | ------ | ----------------------------------------------------------------- |
| 4 种专业化 Agent 角色丢失                    | **高** | 报告单视角化，失去"挑战"/"趋势"/"领域"/"数据"专业视角             |
| DataEnrichment 网页抓取能力丢失（90%+ 代码） | **高** | LLM 只看 snippet，被迫"编造"（baseline 注释明确标注此为核心问题） |
| ResearchReflection 证据充足度评估丢失        | 中     | 无法主动判断"当前是否够"，只能被动识别"缺什么"                    |
| Leader Tool（主动工具调用）丢失              | 中     | Leader 不能在规划前主动搜索最新数据                               |

## 1. 详细清单 · 4 种专业化 Agent 丢失（P0）

Baseline `config/agent-roles.config.ts`（632 行，9 种 `SpecializedAgentType`）：

| 角色                 | 用途                  | Harness 对应            |
| -------------------- | --------------------- | ----------------------- |
| DIMENSION_RESEARCHER | 维度深度研究          | ✅ AG-02-DP / AG-03-SW  |
| QUALITY_REVIEWER     | 质量审核              | ✅ AG-04-SR / AG-06-QR  |
| REPORT_WRITER        | 报告写作              | ✅ AG-03-SW / AG-15-RED |
| FACT_CHECKER         | 事实核验              | ✅ AG-07-FC             |
| SYNTHESIZER          | 跨维度整合            | ✅ AG-11-SY             |
| **DEVIL_ADVOCATE**   | **反方辩手 / 质疑者** | ❌ **无**               |
| **TREND_ANALYST**    | **趋势分析师**        | ❌ **无**               |
| **DOMAIN_EXPERT**    | **垂直领域专家**      | ❌ **无**               |
| **DATA_ANALYST**     | **数据分析师**        | ❌ **无**               |

**影响**：baseline 设计里这 4 种角色并行或对抗式工作可以让报告**多视角更丰富**；
harness 现在只有单一"研究员"视角。baseline 报告和 harness 报告 SOTA 质量差距
主要来自这里。

**补齐方案**：新增 4 个 spec：`AG-20-DA`（DevilAdvocate）/ `AG-21-TA`
（TrendAnalyst）/ `AG-22-DE`（DomainExpert）/ `AG-23-DN`（DataAnalyst）。
baseline `agent-roles.config.ts` 里每个角色已有完整 systemPrompt，可直接
抽出作为这 4 个 spec 的 baseline prompt。Pipeline 里加一个 ST-06.5 "多视角评审"
stage 驱动这 4 个 spec 产出补充观点，合并进 ST-11-ASM。

## 2. 详细清单 · DataEnrichmentService 丢失（P0）

Baseline `services/data/data-enrichment.service.ts`（**903 行**）的核心能力：

| 能力                                                    | baseline 方法                        | HEAD 状态                                                                            |
| ------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| 抓取完整网页内容（snippet → 3000 字 full content）      | `enrichSearchResults()`              | ❌ **完全丢失**                                                                      |
| 跨维度 URL 去重缓存（`LruMap<url, CachedFetchResult>`） | `fetchCache`                         | ❌ 丢失                                                                              |
| URL 有效性验证（status + 内容检测）                     | `validateUrls()`                     | ⚠️ 迁到 `url-validation.service.ts` 但仅做 URL 格式校验，不做 HTTP status + 内容检测 |
| 图片提取（DOM scrape + relevance 检查）                 | `extractFigures` + `figureRelevance` | ✅ 迁到 `figure-extractor.service.ts` + `figure-relevance.service.ts`                |
| 图片搜索补充（<3 张时用搜图补）                         | `supplementFiguresBySearch`          | ❌ 丢失                                                                              |
| 证据可信度评分                                          | `assessCredibility`                  | ⚠️ 逻辑迁到 `evidence-evaluation.service.ts` 但 Rule set 可能缩水                    |

替代品 `content-enrichment.service.ts`（**57 行**，仅做 title/domain 补全默认值，
**不抓取网页内容**）。文件注释自认："Conservative: only fills _missing_ fields"。

**影响**（baseline 原话）：

> 原本 LLM 只能看到 snippet，被迫使用训练数据"编造"内容。增强后 LLM 可以基于
> 实际网页内容生成报告。

**现状**：harness 的 LLM 写 section 时，拿到的是各 search adapter 返回的原始
snippet（100-300 字）+ title + url。没有 3000 字 full content。LLM 只能
"凭 snippet 和训练数据发挥"，导致内容脱离证据。

**补齐方案**：

1. 从 `aaff7b15e` 拉回 `data-enrichment.service.ts` 核心抓取逻辑
2. 重构为 `knowledge/search/fusion/content-fetcher.service.ts`：
   - 保留 `enrichSearchResults(results, options)` — Top N 抓取 + 超时 + 并行
   - 保留 `fetchCache` LRU 去重
   - 保留 `validateUrls` + `filterValidResults` 的 HTTP status/内容检测
3. 在 ST-02-RESEARCH stage 调用：对每个 dim 的搜索结果 `content.enrich(results, { topN: 10, maxContentLength: 3000 })`
4. 下游 section-writer 传 `evidenceSummary` 时用 `enriched.fullContent` 而不是 `snippet`

## 3. 详细清单 · ResearchReflection 证据充足度评估丢失（P1）

Baseline `services/collaboration/research-reflection.service.ts`（核心方法）：

| 能力                               | baseline                                         | HEAD 状态                                            |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| 整体证据充足度判断（"当前够不够"） | `evaluateEvidence(context)` → `ReflectionResult` | ❌ 丢失                                              |
| 识别信息缺口（"哪些方面不够"）     | `evaluateEvidence` 的 `gaps` 子字段              | ✅ 迁到 AG-08-GS（但只识别 gap，不做整体充足度判断） |
| 生成补充搜索建议                   | `evaluateEvidence` 的 `suggestedQueries`         | ✅ AG-08-GS `suggestedQueries`                       |
| 快速启发式检查（无 LLM）           | `quickCheck(evidence)`                           | ❌ 丢失                                              |

**语义差**：

- baseline `evaluateEvidence` = "整体看 **这些证据够不够支撑研究结论**？若不够，空白是什么"
- harness AG-08-GS = "这个维度还有**什么问题没被回答**"（pure gap identification）

少了"充足度"判断，pipeline 没法主动决定是否需要第二轮搜索——现在是固定跑一次 ST-02 就进 ST-03，跑不够也不知道。

**补齐方案**：

- 新增 spec `AG-20-RR`（ResearchReflector）
- 复用 baseline `research-reflection.service.ts` 的 prompt（现已不存在，需从 git 捞回）
- Pipeline 加循环判断：ST-02 → AG-20-RR → if not sufficient → 补搜 → 重跑 AG-20-RR（最多 N 轮）

## 4. 详细清单 · Leader Tool（主动工具调用）丢失（P1）

Baseline `services/data/leader-tool.service.ts` 核心方法：

| 方法                                                                                                       | 用途                         | HEAD 状态                                               |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `leaderAgenticSearch(params)`                                                                              | Leader 迭代式主动搜索        | ⚠️ 部分迁到 AG-19-LAS 但 **不暴露给 AG-01-LD 规划时用** |
| `searchLatestData(params)`                                                                                 | Leader 规划前主动查最新数据  | ❌ 丢失                                                 |
| `generateEnhancedPlanningContext`                                                                          | 把搜到的数据整合为规划上下文 | ❌ 丢失                                                 |
| `createDimension` / `deleteDimension` / `updateDimension` / `mergeDimensions` / `createMultipleDimensions` | Leader 主动改维度            | ❌ 丢失（只有 MissionAmendmentService 被动改）          |
| `cancelTask`                                                                                               | Leader 主动取消任务          | ⚠️ 对应 MissionCancellationService 但是被动由用户触发   |

**影响**：baseline 的 Leader 是**主动规划员**——规划前先查最新数据、中途可以动态增删维度；
harness 的 AG-01-LD 是**一次性规划员**——只基于 input 做一次规划，之后固定按 pipeline 走。
这是交互式研究与"批处理报告"的差别。

**补齐方案**（设计先行，非当前 sprint）：

- AG-01-LD 在规划前可先 invoke AG-19-LAS 预搜一轮（两个 spec 串起来）
- MissionAmendmentService 补充 Leader-initiated 动态维度增删接口

## 5. 其他已迁移但需核对的能力

| 能力                                                             | baseline                                    | HEAD                                                  | 状态                   |
| ---------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| dimension-templates.config.ts                                    | 10+ 模板                                    | `artifacts/topic/templates/config.ts`                 | ✅ 迁到但内容需 diff   |
| framework-skills.config.ts                                       | 框架技能配置                                | `skills/frameworks/policy.config.ts` + 12 个 SKILL.md | ✅ 迁到                |
| model-tier.types.config.ts                                       | ModelTier + classifyModelTier               | `ai-engine/llm/types/model-tier.types.ts`             | ✅ 提到 ai-engine 共享 |
| prompt-adaptation.config.ts（TIER_ADAPTATIONS）                  | tier × promptSuffix/evidenceCap/taskProfile | `mission/pipeline/config/tier-adaptations.config.ts`  | ✅ 2026-04-24 本次恢复 |
| topic-team-orchestrator.service.ts                               | God orchestrator                            | pipeline/stages + orchestrator                        | ✅ 有意重构            |
| task-executors/\*                                                | 4 个 executor                               | 15 个 pipeline stages                                 | ✅ 有意重构            |
| DimensionMission/Progress/Search/Writing/Section-writer services | 维度级 god stack                            | AG-02-DP / AG-03-SW + stages                          | ✅ 有意重构            |

## 优先级建议

| 项                                                             | 优先级     | 工作量                                   | 收益                     |
| -------------------------------------------------------------- | ---------- | ---------------------------------------- | ------------------------ |
| **#1** 补 DataEnrichment 抓取                                  | P0（立即） | 中（拉 baseline 代码 + pipeline wiring） | 高（直接影响报告事实性） |
| **#2** 新增 4 个专业化 spec（DevilAdvocate/Trend/Domain/Data） | P0         | 中（4 个 spec + 1 个 stage）             | 高（恢复多视角 SOTA）    |
| **#3** 补 ResearchReflection 充足度评估                        | P1         | 小（1 个 spec + pipeline 循环）          | 中（减少浅报告）         |
| **#4** Leader Tool 主动调用                                    | P1         | 大（需求设计 + spec chain）              | 中                       |
| **#5** 核对 dimension-templates 内容是否齐                     | P2         | 小                                       | 小（用户能看出）         |
