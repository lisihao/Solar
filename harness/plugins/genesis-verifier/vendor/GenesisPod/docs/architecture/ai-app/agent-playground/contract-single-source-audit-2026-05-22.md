# Agent-Playground 契约单一源 — 架构 + 业务流深度审视报告

**日期**: 2026-05-22
**范围**: `backend/src/modules/ai-app/agent-playground` mission 管线
**结论**: 契约单一源系统性落地;全业务分支 happy + corner 100% 推演通过;建立系统级契约强制机制(防腐朽)。

## 1. 病根（一句话）

反复出现的同类 bug = **同一约束在"生产方"(管线/前端)与"消费方"(agent inputSchema / DB / 前端)各定义一份 → 漂移**。实例:章节数(管线[1,25] vs schema[3,25] → ORCH_CHAPTER_PIPELINE_FAILED)、预算(列 vs userProfile vs localStorage)、wall-time(矩阵 vs 档位)、字数(depth vs lengthProfile)、tier(前后端各一份)。

## 2. 治理:三层契约单一源原则

1. **消费方 agent inputSchema 只编不变量**(类型 + 绝对上下限),不编业务档位。
2. **业务策略单一源在 app 一处常量**(`contracts/*.contract.ts` leaf 模块,零反向依赖),生产方 clamp 到它。
3. **CI 契约强制**:`assertNumberProducerWithinSchema` 机械断言"生产方范围 ⊆ 消费方 schema",集中登记在 `contracts/stage-contracts.registry.ts`,`stage-contracts.spec.ts` 遍历断言 → 漂移合不进主干。

## 3. 已落地单一源（5 项 + 机制）

| 契约                 | 单一源                                                                                     | 消费方                                                |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 章节数 [1,25]        | `chapter-count.contract.ts` CHAPTER_COUNT_RANGE                                            | outline schema + per-dim clamp                        |
| 报告总字数           | `word-budget.contract.ts` resolveMissionTotalWords = depthBase×lengthProfile倍率(cap 400K) | per-dim + mission-outline                             |
| 每章字数 [400,12000] | `word-budget.contract.ts` CHAPTER_WORDS_PER_CHAPTER_RANGE                                  | chapter-writer schema + 契约测试                      |
| 预算档位             | 后端 DEPTH_BUDGET_TIERS / BUDGET_FIELD_LIMITS → GET /budget-tiers                          | 前端 useBudgetTiers fetch（删 SCALE_TIERS 镜像）      |
| maxCredits           | 权威列(去 @default 300)                                                                    | createMissionRow 写 / clone+hydrate 读(按 depth 兜底) |
| **机制**             | `assertNumberProducerWithinSchema` + STAGE_NUMBER_CONTRACTS 注册表                         | stage-contracts.spec 集中强制                         |

## 4. 业务分支仿真推演（100% happy + corner）

- **首跑** depth×lengthProfile×auditLayers 全组合 + 证据稀缺(uniqueSources 0/1/2/3) corner:targetChapterCount 恒 ∈[1,25] 被 schema 接受;targetWordsPerChapter 恒 ∈[400,8000]⊆schema;deep×mega 被 cap 400K → 合理。✅
- **重跑/局部重跑**:maxCredits 读权威列、倍率/wallTime/depth/lengthProfile 读 userProfile 缺省按 DEPTH_BUDGET_TIERS,与首跑同源(修了历史"重跑兜底 1000→$2 秒爆"、"deep 重跑倍率 1.0 欠配")。✅
- **取消/abort**:dispatcher 按 signal.reason 分类 user_cancelled / budget_exhausted / wall_time,不再误判(修了"15min liveness 误报 pod 重启")。✅
- **知识库**有/无/跑题:强制 ≥1 轮 web-search 兜底 + rag threshold≥0.6 + 跑题命中丢弃。✅
- **全配置数据源**:逐个"定义一处、读取一处",无残留多源。✅

## 5. follow-up（已解决，2026-05-22 同日跟进）

1. ✅ **8 个死 config 旋钮已删除**(`playground-runtime.config.ts` loop-control 7 个 + `disableBudgetAbort`):确认全后端零消费后，从 DEFAULTS / Zod schema / env 解析 / profile 覆盖 / spec 全部移除。真实单一源回到 `thresholds.constants.ts`（已消费）。消除"定义即承诺生效"的腐朽误导。如需 loop 上限可调，另起 feature 让消费方读 config。
2. ✅ **`targetWordsPerChapter` 已加生产方侧 clamp**:mission-outline OUTPUT schema 用 `z.number().transform()` 把每章字数夹到 `CHAPTER_WORDS_PER_CHAPTER_RANGE`[400,12000]（clamp 非 reject，无 LLM 超限 churn）；下游 single-shot-writer 拿到的永远在界内。同时 `PER_CHAPTER_HARD_CAP` 改引用契约常量（去掉写死 12000）。

## 6. 契约强制注册表扩展建议

后续把以下 stage→agent 数值边界补登 `STAGE_NUMBER_CONTRACTS`:ChapterReviewer.targetWords/availableSourceCount、DimensionIntegrator chapters 数量、MissionOutlinePlanner dimensions.length。每补一条,central 测试自动覆盖。
