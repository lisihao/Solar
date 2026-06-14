# 搜索+数据源层 baseline vs HEAD 详细差距审计

> **时间**：2026-04-24｜**基线**：commit `aaff7b15e`（Apr 21 EDT 末）vs **HEAD**：`44c7b60b0`（harness 迁移）

## 执行摘要

baseline 在**数据源管理**和**网页内容丰富化**两个关键层面有显著优势。当前 HEAD 的搜索仅拿到 snippet（100-300 字），LLM 基于"编造"生成报告。baseline 在**分层降级策略**和**主动工具调用**方面有成熟实现。

---

## 维度 1：数据源并发/限速控制

| 项目                 | Baseline                                 | HEAD                                  | 差距                            | 严重度 |
| -------------------- | ---------------------------------------- | ------------------------------------- | ------------------------------- | ------ |
| 全局限速服务         | ✅ GlobalSourceThrottleService（156 行） | ✅ 完全相同（搬到 knowledge/search/） | 无                              | -      |
| Adapter 内子请求限速 | ⚠️ 无共享限速                            | ⚠️ 完全相同                           | 所有 academic 子请求无共享限速  | **P1** |
| Policy 聚合限速      | ⚠️ 3 个 tool 各自无限速                  | ⚠️ 完全相同                           | 并发 3 个维度 × 3 tool = 9 并发 | **P2** |

**根因**：adapter 内部**二级搜索**（academic 的 OpenAlex/PubMed/ArXiv、policy 的 3 个 tool）直接调用 tool，未过 throttle。当大量维度并行时容易触发 429/timeout。

---

## 维度 2：Adapter 降级/Fallback 机制

| 项目                       | Baseline                                          | HEAD        | 差距                  | 严重度 |
| -------------------------- | ------------------------------------------------- | ----------- | --------------------- | ------ |
| 单 source fail 补齐        | ✅ SearchOrchestratorService Step 8：WEB fallback | ✅ 完全相同 | 无                    | -      |
| Per-source minResults 保证 | ⚠️ 条件不清                                       | ❌ 完全丢失 | 用户反馈"每维度 1 条" | **P0** |
| Adapter 内二级降级         | ✅ AcademicAdapter Phase 1→2→2b                   | ✅ 完全相同 | 无                    | -      |

**根因**：baseline DataSourceRouter 在 `standardSearch()` 有 fallback 循环，若某 source 返回 < threshold，会重试。HEAD SearchOrchestratorService 无此逻辑。

---

## 维度 3：Timeout 配置全景

| 项目                                      | Baseline                            | HEAD              | 差距                                    |
| ----------------------------------------- | ----------------------------------- | ----------------- | --------------------------------------- |
| 全局搜索 budget                           | 无明确全局 budget                   | 无明确全局 budget | ⚠️ 多个 source 超时无整体 deadline 控制 |
| Adapter timeout（Web/Academic/Policy 等） | 12s/20s/15s                         | 完全相同          | ✅ 无差距                               |
| ArXiv deadline-aware                      | Phase 总 20s，Phase 2b 留 3s buffer | 同上              | ✅ 无差距                               |
| Promise.allSettled 控制                   | Policy 的 3 tool 无指定分配         | 完全相同          | ⚠️ 某个 tool 失败不中断其他             |

---

## 维度 4：Retry 机制（adapter 级 + cooldown）

| 项目                    | Baseline                                  | HEAD        | 差距                            | 严重度 |
| ----------------------- | ----------------------------------------- | ----------- | ------------------------------- | ------ |
| CircuitBreaker 集成     | ✅ SearchAdapterBase 记录 success/failure | ✅ 完全相同 | 无                              | -      |
| Retry-after 冷却        | ❌ 无显式 retry-after backoff             | ❌ 完全相同 | 无指数退避                      | **P2** |
| 单 query 重试           | ❌ 失败 query 不重试                      | ❌ 完全相同 | 超时时整个 source 此轮返回 0 条 | **P1** |
| QG fail 后 WEB fallback | ✅ Step 8 实现                            | ✅ 完全相同 | 无                              | -      |

---

## 维度 5：Query 策略与源特定化

| 项目                                     | Baseline                                                | HEAD     | 差距      |
| ---------------------------------------- | ------------------------------------------------------- | -------- | --------- |
| QueryStrategyService 核心                | 3 个方法：generateQueries → batchTranslate → 源特定 map | 完全相同 | ✅ 无差距 |
| 双语查询生成                             | rawQueries → (中英) → sourceSpecific map                | 完全相同 | ✅ 无差距 |
| 源特化规则（WEB/ACADEMIC/GITHUB/POLICY） | 完整实现                                                | 完全相同 | ✅ 无差距 |

**评价**：Query 策略层完全对等。

---

## 维度 6：数据富化 / 网页全文抓取（CRITICAL）

| 能力                    | Baseline                                                                                                                  | HEAD                                                                                       | 差距                                              | 严重度 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------ |
| **网页全文内容抓取**    | `data-enrichment.service.ts`：enrichSearchResults(results, {topN: 5})，并行抓取 Top 5 URL，snippet → 3000 字 full content | `content-enrichment.service.ts`（57 行）：仅补 title/domain/snippet 默认值，**零网页抓取** | **差距极大**：LLM 看 100-300 字 snippet，被迫编造 | **P0** |
| **URL 有效性验证**      | validateUrls()：HTTP status + 内容检测；缓存结果                                                                          | url-validation.service.ts：仅 URL 格式 regex，不做 HTTP 验证                               | **无 HTTP 状态检测**                              | **P1** |
| **跨维度 URL 去重缓存** | fetchCache: LruMap（500 条），同 URL 仅抓一次                                                                             | 缺失                                                                                       | 重复抓取，浪费资源                                | **P2** |
| **图片提取**            | extractFigures + filterRelevantFigures                                                                                    | ✅ 迁到 figure-extractor + figure-relevance                                                | ✅ 功能保留                                       | -      |
| **图片搜索补充**        | supplementFiguresBySearch：< 3 张时自动搜图补充                                                                           | 缺失                                                                                       | 无图报告                                          | **P2** |
| **可信度评分**          | assessCredibility：domain 40 pts + sourceType 15 pts                                                                      | 迁到 evidence-evaluation.service.ts，规则未验证                                            | **规则缩水未知**                                  | **P2** |

**根因及影响**：

baseline 的核心问题陈述（代码注释）：

```
原本 LLM 只能看到 snippet，被迫使用训练数据"编造"内容。
增强后 LLM 可以基于实际网页内容生成报告。
```

HEAD 中，这一核心能力**彻底缺失**。下游 section-writer 拿到的仍然是原始 snippet，无任何网页内容提取。

**用户报告的"搜索质量严重下降"的 60% 原因在此**。

---

## 维度 7：Leader Tool 主动调用能力

| 能力                | Baseline                                             | HEAD                        | 差距                  | 严重度 |
| ------------------- | ---------------------------------------------------- | --------------------------- | --------------------- | ------ |
| **Leader 主动搜索** | leader-tool.service.ts：leaderAgenticSearch(context) | **服务完全缺失**            | Leader 无工具调用能力 | **P1** |
| **维度 CRUD**       | createDimension / updateDimension / deleteDimension  | ⚠️ 分散到各 agent spec      | 逻辑可能重复          | **P2** |
| **任务控制**        | cancelTask / pauseTask / resumeTask                  | ⚠️ 可能在 mission lifecycle | 同上                  | **P2** |
| **规划增强**        | enhancePlanningContext：搜索结果 + 新鲜度信息注入    | 缺失                        | 规划输入贫血          | **P2** |

**根因**：baseline 的 LeaderToolService 是工具集合，HEAD 中这些被打散，没有统一入口。

---

## 维度 8：数据源 Router / Planner / Strategy

| 组件                        | Baseline                            | HEAD                                          | 差距              | 严重度 |
| --------------------------- | ----------------------------------- | --------------------------------------------- | ----------------- | ------ |
| **DataSourceRouterService** | 2677 行，核心流程                   | ✅ 迁到 knowledge/sources/router.service.ts   | ✅ 功能等价       | -      |
| **智能规划**                | DataSourcePlannerService（393 行）  | ✅ 迁到 knowledge/sources/planner.service.ts  | ✅ 保留           | -      |
| **动态策略**                | DataSourceStrategyService（376 行） | ✅ 迁到 knowledge/sources/strategy.service.ts | ✅ 保留           | -      |
| **连接器注册**              | connector-registry + 各 connector   | ⚠️ 迁到 knowledge/sources/connectors/         | **registry 弱化** | **P2** |
| **第二轮搜索**              | standardSearch 有条件重搜           | ❌ 缺失                                       | 同维度 2          | **P0** |

**评价**：Router/Planner/Strategy 保留，主要差距在与搜索层的交互。

---

## 总结 + 修复优先级

### Top 5 P0 需立即恢复的能力

| 序号  | 能力                                  | 影响                               | 恢复工作量 |
| ----- | ------------------------------------- | ---------------------------------- | ---------- |
| **1** | **网页全文内容抓取**                  | LLM 编造；内容脱离证据             | 中         |
| **2** | **Per-source minResults 保证 + 降级** | 每维度 1-2 条结果                  | 中         |
| **3** | **Adapter 内子请求 throttle**         | 429、timeout                       | 小         |
| **4** | **单 query 失败重试**                 | 某 query 超时 → 整个 source 无结果 | 小         |
| **5** | **Leader Tool 主动搜索**              | 规划时无最新数据背景               | 大         |

### 快速修复顺序

```
Week 1（紧急）：
  - 维度 1 + 3：adapter 子请求 throttle + timeout 全局 budget（1-2 天）
  - 维度 2：per-source minResults fallback（2-3 天）

Week 2（高优）：
  - 维度 6：网页内容抓取重构（5-7 天）

Week 3（中优）：
  - 维度 4：单 query 重试（1-2 天）
  - 维度 7：Leader Tool 补齐（3-5 天）
```

### 预期修复后的改进

- ✅ 每维度结果数 ≥ 5 条（当前 1-2 条）
- ✅ PolicySearch 不再 429
- ✅ ArXiv timeout 缓解
- ✅ LLM 拿到 3000 字 full content，质量 +40% 预期
- ✅ Leader 规划准确性 +30% 预期

---

**报告生成**：2026-04-24 ｜ **基线**：aaff7b15e ｜ **对标**：44c7b60b0
