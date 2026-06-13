# Topic Insights Harness 重新设计 · 文档深度审视

> 自审 `00-overview.md`、`01-capability-matrix.md`、`02-target-architecture.md` 三份文档的缺陷、矛盾、埋雷。
> 审视原则：**不替自己辩护**。每一处不够严密的地方直接标出。

---

## 一、审视方法

按 5 个维度扫描：

1. **完整性**：能力覆盖是否真的完整？
2. **一致性**：三份文档互相矛盾吗？
3. **可执行性**：设计是否真能落地？有没有未定义项？
4. **可度量性**：承诺是否可自动验证？
5. **成本/性能**：有没有隐藏的爆炸项？

标记：🔴 critical（必改）· 🟠 ambiguity（必澄清）· 🟡 improvement（应加强）· ❓ open-question（需决策）

---

## 二、发现汇总

| 维度                     | 🔴 Critical | 🟠 Ambiguity | 🟡 Improvement | ❓ Open |
| ------------------------ | ----------- | ------------ | -------------- | ------- |
| 完整性（能力盘点遗漏）   | 8           | 3            | 2              | 1       |
| 一致性（跨文档矛盾）     | 3           | 2            | 0              | 0       |
| 可执行性（设计未定义）   | 6           | 7            | 3              | 2       |
| 可度量性（承诺不可验证） | 4           | 2            | 2              | 1       |
| 成本/性能（埋雷）        | 5           | 2            | 1              | 3       |
| **合计**                 | **26**      | **16**       | **8**          | **7**   |

**结论：文档当前状态不足以进入实施**。26 条 critical 必须先解决。

---

## 三、完整性审视（能力盘点遗漏）

### 🔴 遗漏的 8 项能力（应补入 01-capability-matrix.md）

| 序号 | 遗漏能力                                                                                                                | 现实风险                                            | 建议归属                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| M.1  | **TopicDimension 状态机**（PENDING → RESEARCHING → COMPLETED / FAILED / SKIPPED）                                       | 前端进度条依赖此字段；写错顺序会卡死 UI             | D（基础设施）；Pipeline Stage 2/3 写入                                |
| M.2  | **Mission.progressPercent 计算**（旧 MissionExecutionService 每个 task 完成后累加）                                     | 前端进度条驱动；不算会卡在 0                        | C（Pipeline）；每个 Stage 结束后算                                    |
| M.3  | **Per-mission 工具调用预算**（旧系统 maxToolCalls per mission）                                                         | agent 失控时 cost 爆炸保护                          | D（infra）+ C（Pipeline 初始化时设预算）                              |
| M.4  | **AgentActivity 完整字段集**（thinkingPhase / thinkingContent / reviewResult / dimensionId / progress / modelId / ...） | 前端「Leader 思考动画」依赖完整字段；缺字段 UI 会崩 | D；每个 agent 完成时发 activity                                       |
| M.5  | **changesFromPrev 持久化**（增量模式下报告 diff 摘要）                                                                  | 增量刷新功能 break                                  | B（utility: computeReportDiff）+ D                                    |
| M.6  | **Credit 扣费时机**（CreditsService.deduct）                                                                            | 不扣费 = 产品收入漏                                 | D；每个 LLM 调用结束后扣；Pipeline 提供中央扣费 hook                  |
| M.7  | **AbortSignal 传播契约**（用户 cancelMission → 正在跑的 agent 必须立刻中断）                                            | 不能中断 = cancel 无效；agent 继续烧 token          | C（Pipeline）+ A（Agent Runner 透传 signal 到 HarnessFacade.execute） |
| M.8  | **Dimension research 重入保护锁**（同一 dimensionId 正在 research 时，不允许第二次启动）                                | 重复执行 = evidence 重复 / cost 翻倍                | D（Redis 锁）                                                         |

### 🟠 能力描述模糊的 3 项

| 序号 | 能力                                    | 问题                                                                      | 建议                                                                                                                                |
| ---- | --------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A.1  | 1.1 LeaderPlan 生成——输出结构未定义     | "produce LeaderPlan" 但 LeaderPlan 的 Zod schema 不存在                   | 9 号文档 `data-contracts.md` 必须先写                                                                                               |
| A.2  | 2.14 Dimension 5 轴评分——执行机制未定义 | 写了"必须真的产出 5 轴独立分，不是 fan-out" 但没说**怎么强制**            | 需要 Zod schema 定义 5 个 required number fields；skill markdown 也要反复强调；agent runner 的 validateOutput 必须拒绝 fan-out 模式 |
| A.3  | 2.6 evidenceUsed 来源——真实性未定义     | 旧代码：`evidenceUsed = DB 实际落库数`。新设计里可能还是读 agent 输出字段 | 规则：evidenceUsed **必须来自 DB count**，不是 agent 输出；utility `countDimensionEvidence` 负责这件事                              |

### 🟡 应补充的 2 处

1. "铁墙清理" 具体语义未定义——是正则 / LLM / 禁词列表？
2. "OPENING_CONCLUSION_RE" 具体匹配什么？

### ❓ 1 个开放问题

**Q.A.1**: `DimensionStatus` 的状态机里，SKIPPED / FAILED / RESEARCHING 之间能否转换？旧代码行为需要审计一次。

---

## 四、一致性审视（跨文档矛盾）

### 🔴 矛盾 C.1 —— "不废弃任何能力" 但 02 说"CritiqueRefineService 可选"

- `00-overview.md` 第三节：原则 1「每个旧能力要么保留，要么用更强的机制替代」
- `01-capability-matrix.md` 第六节：**E（废弃）数量：0**
- `02-target-architecture.md` 第四节：「`services/quality/critique-refine.service.ts` (639 — **可选**)」

**问题**：如果不采用 critique-refine 策略，是废弃；如果采用，是迁移。02 用"可选"含糊其辞。

**修正**：明确选一种——

- 方案 A：CritiqueRefine 作为 Stage 4 的可选替代策略（feature flag 切换 review-revise / critique-refine）
- 方案 B：CritiqueRefine 废弃，Section-level review-revise 就够了

### 🔴 矛盾 C.2 —— "下一步"不一致

- `00-overview.md` 第五节：审批 00+01+02 后按 07 里程碑实施
- `01-capability-matrix.md` 第七节：下一步是 02-target-architecture
- `02-target-architecture.md` 第六节：下一步是 03+04+05

**问题**：哪个是对的流程？用户审批 3 份？5 份？全 9 份？

**修正**：统一成**阶段 Gate**：

- Gate 1：审批 00+01+02（本阶段交付）——确认方向
- Gate 2：审批 03+04+05+09——确认细节
- Gate 3：审批 06+07+08——确认实施
- 通过 Gate 3 才开工写代码

### 🔴 矛盾 C.3 —— 删除边界与"保留所有能力"

- `00-overview.md` 原则 4：「类别 B 纯函数必须保留，不许丢」
- `02-target-architecture.md` 第四节：列出要删除的 18,200 行 legacy 代码
- 但 Category B 的 20 项能力都在这些 legacy 文件里。**迁移先、删除后**的顺序在 02 里没写。

**修正**：02 的"删除列表"必须加前置条件——「**只有 utility 迁移完成 + 测试通过 + Pipeline Stage 切换完成**，才允许物理删除对应 legacy 文件」。**任何反过来的顺序都拒绝合并**。

### 🟠 ambiguity 2 项

- C.4：`Leader` agent vs `LeaderDispatcher` 边界模糊（03 号文档必须画清楚）
- C.5：`researchLeader.integrateDimensionResults` 被我标为"迁移到 Stage-5 + MetaExtractor agent"（01 第 2.13），但 02 的 agent 列表里只有 `DimensionMetaExtractor`，没提 integrator utility 归类。

---

## 五、可执行性审视（设计未定义项）

### 🔴 6 个必须定义才能写代码的项目

#### E.1 — PipelineContext 膨胀为"god object"

02 文档的 `PipelineContext` 接口塞了 20+ 个字段。每个 stage 需要读几乎所有字段。**类型依赖混乱**，改一个 stage 会触及所有其他 stage。

**修正**：分段式 Context。每个 Stage 有明确的输入/输出类型：

```typescript
interface Stage<In, Out> {
  execute(input: In): Promise<Out>;
}
// Stage 1 input: { missionId, topicId, userPrompt, topicMeta, availableModels }
//          output: LeaderPlan
// Stage 2 input: { missionId, topicId, leaderPlan, depthConfig }
//          output: Map<dimensionId, DimensionResearchResult>
// ...
```

顶层的 `PipelineContext` 只承载 identity（missionId / topicId / userId / cachePrefix）+ 一个 `results: StageResults` 存所有 stage output。

#### E.2 — Stage checkpoint resume 与 in-memory state 的冲突

02 说"stage-level checkpoint 可以 resume"，但 `dimensionResults: Map<string, DimensionResult>` 是 in-memory。

- 场景：Mission 在 Stage 3 崩溃，重启后从 Stage 4 resume——但 Stage 4 需要读 Stage 2/3 的 in-memory 结果，没了。

**修正**：所有 Stage 输出**必须持久化**才能 mark completed。Stage 2 写 `TopicEvidence` + `DimensionAnalysis.dataPoints`，Stage 3 写 `DimensionAnalysis.sections`（新增 JSON 字段），等等。Resume 时 rebuild context 从 DB 读。

需要 schema 变更评估（Stage 输出 DB mapping，待 Phase 6 前不能真动 schema，所以先用 JSON 字段临时存）。

#### E.3 — AbortSignal 传播链

`AbortController` → `Pipeline.execute` → `Stage.execute` → `AgentRunner.run` → `HarnessFacade.execute` → `AiChatService.chat` → 底层 fetch signal？

**现状**：harness facade 没有暴露 signal 参数；AiChatService 可能不传 signal 到 OpenAI SDK。

**修正**：

1. Pipeline 顶层创建 `AbortController`
2. `Stage.execute(input, signal)` 强制参数
3. `AgentRunner.run(ctx, signal)` 强制参数
4. `HarnessFacade.execute(spec, task, options: { signal })` —— **需要 harness 内核改造**
5. `AiChatService.chat({..., signal })` —— 需要 LLM 层改造

**注意**：这是**跨 AI Engine 内核**的改动，需要与 ai-engine 团队确认是否在本次 scope。如果不在 scope，cancelMission 功能只能做"标记"不能做"真实中断"——需要降级承诺。

#### E.4 — Iron wall 具体规则未定义

"detectIronWallViolations" 被列为 utility，但没定义"铁墙"是什么。

**真相**：旧代码里"铁墙"包括：

- 禁用 emoji
- 禁用占位符（"XX%" / "XX 亿"）
- 禁用模板化开头（"随着..." / "在当前..."）
- 禁用模糊量词（"大量" / "显著" 无数据支撑）
- 禁用内部角色名（"Leader" / "Agent"）
- 禁用 LaTeX 数学（某些场景）
- 禁用 HTML tags

这是一组**正则 + 启发式词典**的混合，不是单一规则。utility 名 `detectIronWallViolations` 必须拆：

- `detectEmojiViolations`
- `detectPlaceholderViolations`
- `detectTemplateOpening`
- `detectFuzzyQuantifiers`
- `detectInternalRoleNames`
- `detectHtmlTags`

每个输出 `ViolationReport`（line-level），Stage 3c 消费。

#### E.5 — Agent/Tool 访问矩阵未定义

02 列了 17 agent + 13 tool（7 新 + 6 existing 复用），但**没说哪个 agent 能用哪个 tool**。

**后果**：如果给 `Synthesizer` agent 开 `topic.evidence.save` 权限，它可能在 synthesis 阶段"创造"假证据。

**修正**：必须定义 access matrix。例：

| Agent            | Tools allowed                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| Leader           | short/long-term-memory, topic.model.lookup, rag-search (read-only)            |
| DimensionPlanner | topic.dimension.memory, rag-search                                            |
| SectionWriter    | web-search, rag-search, arxiv, ..., topic.evidence.save, topic.figure.extract |
| SectionReviewer  | rag-search, knowledge-graph (read-only)；**禁止** topic.evidence.save         |
| Synthesizer      | rag-search (read-only)；**禁止** topic.evidence.save                          |
| ...              |                                                                               |

在 agent-spec 里硬编码 `tools: [...]`，harness 内核校验 agent 调用的 tool 是否在 whitelist。

#### E.6 — "分层 ESLint 规则" 只是承诺

02 文档写了 4 条 ESLint rule，但没设计具体实现。`eslint-plugin-topic-insights` 需要自定义 AST 分析。工作量很大。

**修正**：要么实打实写 plugin，要么降级为"目录结构约束 + PR reviewer 检查清单"。降级方案需要在 00 里明确。

### 🟠 7 处需澄清

- E.7：`promptCachePrefix` 字段需要加到 `IAgentSpec`；harness 内核怎么消费？
- E.8：Stage conditions 的 DAG 表达——14 个 stage 不是严格线性，比如 Stage 11 assembly 依赖 Stage 7+8+9+10。需要显式 DAG，不是 stages[] 数组
- E.9：Failed stage 的 retry 策略——重试多少次？指数 backoff？哪些错误可重试？
- E.10：Stage 内部的并发度（Stage 2 并行几个 dimension、Stage 3 并行几个 section）
- E.11：Agent runner 的重试 vs Stage 级重试——两层重试会不会指数爆炸？
- E.12：Stage 持久化格式——是 JSON 字段还是独立表？Phase 6 前不改 schema 的话，JSON 字段会膨胀
- E.13：LLM judge 打分标准（Golden 样本测试）——谁来判定"等于 baseline"？

### 🟡 3 处可改进

- E.14：17 agent 太多——建议分 Tier，Core 6 / Enhancement 6 / Advanced 5，分阶段上
- E.15：14 stage 太多——建议 Core 8 / Advanced 6
- E.16：Stage/Agent/Tool/Skill 编号方案——建议全文档唯一 ID（如 `ST-03-WRITE`、`AG-06-QR`、`TL-02-EVSAVE`、`SK-11-FC`）

### ❓ 2 个开放问题

- Q.E.1：Pipeline 该在 `topic-insights` 模块内还是下沉到 `ai-engine`？
- Q.E.2：Stage 设计是否应该复用 `ai-engine/harness` 的 Workflow 机制？还是独立实现？

---

## 六、可度量性审视（承诺是否可自动验证）

### 🔴 4 条不可度量的承诺

| 承诺                                      | 问题             | 可度量替代                                                                                                                                                                         |
| ----------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00 原则 1 "能力 ≥ Baseline"               | "≥" 没有客观定义 | 定义 3 个度量：<br>• **质量分**：LLM judge 对 golden 样本的 0-100 打分，必须 ≥ baseline 的 95%<br>• **成本**：per-mission USD ≤ baseline × 1.3<br>• **延迟**：P95 ≤ baseline × 1.2 |
| 00 原则 5 "Golden 样本定性对比"           | "定性" 不可重复  | LLM judge（GPT-5 或 Claude Opus-4.7）+ 固定 rubric（10 个维度，每个 0-10 分），两次独立跑均值                                                                                      |
| 02 beyond-baseline "Cache hit rate > 98%" | 没说怎么量       | Stage 14 的 cleanup 里 assert `sumTokensFromCache / totalTokens > 0.5`（旧系统实际是 40-60%，98% 是我之前的幻觉）                                                                  |
| 00 原则 2 "分层 ESLint 阻断"              | 没说具体实现     | 要么写 plugin，要么降级为 PR checklist                                                                                                                                             |

### 🟠 2 处模糊

- "新增/增强 10 项" 里的每一项都需要量化验收标准
- "contract 测试" 具体框架（Zod? io-ts?）没定

### 🟡 2 处应加强

- 每个 Stage 必须附 SLO：P95 latency、成功率、Token 上限
- 每个 Agent 必须附 SLO：单次调用平均 Token、Timeout

### ❓ 1 个开放问题

- Q.M.1：Golden 样本数据从哪来？生产数据脱敏？合成数据？专家手工写？

---

## 七、成本 / 性能审视（埋雷）

### 🔴 5 个埋雷

#### Z.1 — Agent 数量 × 调用次数 = 成本指数爆炸

旧系统一个 standard 维度大约 N 次 LLM 调用：

- Leader plan: 1 次
- Dimension outline: 1 次
- Section write × 3-6 sections: 3-6 次
- Section review × 3-6 sections: 3-6 次（standard = 1 round）
- Dimension meta extract: 1 次
- Report synthesis: 1 次
  合计：≈ 10-16 次 / mission

新设计（17 agent × 14 stage）最坏情况：

- Leader plan: 1
- Dimension outline × 6 dim: 6
- Section write × 6 dim × 5 sec: 30
- Section review × 6 dim × 5 sec × (rounds=1): 30
- **重写轮次**（约 20% 需要修订，×2 调用）：12
- Dimension meta × 6: 6
- Quality review dim × 6: 6
- Overall review: 1
- Hypothesis verify (thorough): 5
- Fact check: 3
- Gap search: 3
- Fact extractor: 1
- Synthesizer: 1
- Quality gate remediate × 可能 3: 3
- Report evaluate: 1
- LaTeX repair: 1
  合计：**≈ 110-130 次 / mission**

**成本估算**：

- 旧系统：10 × $0.03 = $0.30 / mission
- 新系统：120 × $0.03 = **$3.60 / mission**（12×）

**必须**：

- 设 per-mission token budget（Stage 0 预算 + Stage 13 审计）
- 哪些 agent 可合并（MetaExtractor 并入 最后一个 SectionWriter？Facts 并入 Synthesizer？）
- 哪些 stage 能跳过（Gate Rule 6 没触发则 skip remediate）
- Cache 必须真实起作用（不能是幻觉）

#### Z.2 — Section-level review loop 的组合爆炸

thorough 模式 rounds=2，每 section 可能需要 2 次修订：

- 8 dim × 5 sec × 2 rounds × 2 (write + review) = **160 次 LLM 调用 / mission**

再加 Stage 6 CognitiveLoop 的 maxCognitiveLoops=3：每次要跑 claim validate + gap query gen + supplementary search + re-validate。

必须引入**早停策略**：如果 review 分 ≥ 阈值（e.g. 80），跳过剩余 rounds。

#### Z.3 — Agent 之间数据传递靠 system prompt 膨胀

例：SectionWriter 写第 5 个 section，需要知道前 4 个 section 的内容（否则重复或冲突）。如果把 4 个 section 全贴进 system prompt：

- 4 section × 4000 字 × 1.5 token/字 = **24,000 input token / 次**
- 8 dim × 5 sec × 24k = **960k input token / mission**（≈ $2.40 just for context）

**修正**：

- Memory tool（short-term-memory）放 section 摘要（500 字/section），不贴全文
- 或用 PromptCache 让 cross-section context 共享前缀

#### Z.4 — PromptCache 生效的必要条件

Cache hit 需要 **prefix 字节级相同**。17 agent 各自 buildSpec 生成的 prompt 差异就废掉 cache：

- role.description 里 `${ctx.dimension.name}` 差异 → miss
- goal.summary 里动态拼接 → miss
- skills[] 顺序差异 → miss

**现状**：buildDimensionResearcherSpec 里大量动态拼接。Cache 实际 hit rate 大概率低于 20%。

**修正**：

- 严格区分 "stable prefix"（skill content、role template、constraints）和 "dynamic suffix"（topic/dim name、evidence summary）
- PromptCacheCoordinator 只缓存 stable prefix 部分
- 测试覆盖 cache hit 场景

#### Z.5 — 新增 17 agent × 18 skill × 13 tool 的开发工作量

保守估算：

- 每个 agent：agent-spec.ts (100 行) + runner.ts (60 行) + output.parser.ts + Zod schema + **tests** (200 行) ≈ 500 行，2-3 人天
- 每个 skill：skill.md 模板 + output schema + 测试 ≈ 200 行，1-2 人天
- 每个 tool：实现 + 测试 ≈ 300 行，1-2 人天
- Pipeline + 14 stage：每个 stage 200-500 行 + 集成 ≈ 5000 行，10-15 人天
- 25 utility：平均 100 行 + 测试 ≈ 3000 行，5 人天
- ESLint plugin：若做，2-3 人天
- Golden 样本测试：5 样本 × LLM judge 框架 ≈ 5 人天

**合计：50-70 人天**。单人跑完 10-14 周（含 bug fix + review）。

**对比**：前三轮加起来大约 2-3 人天。这次的**设计规模已经从 refactoring 升级为 rewrite**，心理预期必须调整。

### 🟠 2 处模糊

- Z.6：没有 per-stage timeout 规范
- Z.7：没有 Total mission timeout（旧系统 10min planning + 未定义 execution）

### 🟡 1 处改进

- 新增 "Cost Observability" utility：每个 Stage 结束时记录 tokensUsed/cost，Stage 13 汇总、Stage 14 告警

### ❓ 3 个开放问题

- Q.Z.1：Section-level 并行度上限？（太高会触发 rate limit）
- Q.Z.2：Agent 之间是否采用 handoff + summary 传递数据（不是 full text）？
- Q.Z.3：Cache hit rate 的测量机制？LLM provider 是否在响应里返回 `cache_hit` 元数据？

---

## 八、跨文档系统性问题

### 🔴 P.1 — 设计为"理想状态"，缺"MVP 优先级"

17 agent、14 stage、25 utility 全上，工作量 50-70 人天。

**修正**：在 07 实施计划里分 Tier——

| Tier        | Agent                                                                                               | Stage                       | Utility | 工作量   | 能否独立发布                |
| ----------- | --------------------------------------------------------------------------------------------------- | --------------------------- | ------- | -------- | --------------------------- |
| Core        | 6（Leader、SectionWriter、SectionReviewer、Synthesizer、QualityReviewer、DimensionMetaExtractor）   | 8（Stage 0/1/2/3/4/5/7/13） | 15      | 25-30 天 | ✅ 能替代 baseline 核心流程 |
| Enhancement | +5（FactChecker、GapSearcher、HypothesisVerifier、ReportEvaluator、SectionRemediator）              | +4（Stage 6/8/9/10）        | +7      | +15 天   | ✅ 补齐 thorough/deep       |
| Advanced    | +6（FactExtractor、LatexRepair、ReportEditor、MissionAdjuster、LeaderDispatcher、DimensionPlanner） | +2（Stage 11/12/14）        | +3      | +12 天   | ✅ 长尾功能                 |

**Tier Core 优先上**，验证方向对了再补后面。

### 🔴 P.2 — 没有"回退逃生窗口"

如果 Tier Core 上线后质量不如 baseline（很可能），如何回退？

**修正**：

- 保留所有 legacy 代码直到 Tier Core 稳定 2 周
- Feature flag 顶层：`TOPIC_INSIGHTS_PIPELINE_ENABLED`（默认关），灰度启用
- Traffic split：10% → 50% → 100%
- Automatic rollback 触发条件（SLO 恶化 10%）

### 🔴 P.3 — 没有 "Phase 0 基线捕获" Stage

在任何代码变更**之前**，必须先跑 10 个真实 topic 并**完整录制** baseline 行为：

- 每个 mission 的所有 LLM 调用（input + output）
- 所有 event emission
- 所有 DB 写入
- Cost / latency / cache rate
- 最终 report 的 markdown + highlight + keyFindings

存成 JSON snapshot 作为 Golden 样本。**缺这一步就没有客观对比基准**。

Phase 0 工作量：1-2 周。

---

## 九、修正后的路线图

### Stage Gate 1（当前）：方向审批

用户审批 00 + 01 + 02，**同时**审批本文档（10）的修正项：

- [ ] 接受 26 条 critical 的修正
- [ ] 接受分 Tier 实施（Core → Enhancement → Advanced）
- [ ] 接受 Phase 0 基线捕获
- [ ] 接受 50-70 人天工作量预期
- [ ] 接受 10-14 周交付周期（单人）

如果任一项不接受，返工设计。

### Stage Gate 2：细节审批

提交 03（agent 细节）+ 04（pipeline 细节）+ 05（utility 清单）+ 09（data-contracts）。
核心：确认每个 agent 的 Zod schema、每个 stage 的输入输出类型。

### Stage Gate 3：实施审批

提交 06（beyond-baseline）+ 07（实施计划）+ 08（测试策略）。
核心：确认 Tier Core 的 PR 分解、Golden 样本方案、回退策略。

### Implementation（通过 Gate 3 后）

按 PR 粒度推进，每个 PR 覆盖：

- 一个 Stage or 一个 Agent
- 对应 skill + tool + utility
- 单元测试 + 契约测试
- Golden 样本回归测试
- 不通过 SLO 不合并

---

## 十、审视结论

**三份文档的设计方向正确，但密度不足以进入实施**。

### 必须改的（阻断合并）

1. 补 8 项遗漏能力到 01
2. 解决 3 条跨文档矛盾
3. 修正 PipelineContext 膨胀问题（分段式 Context）
4. 修正 Stage checkpoint 与 in-memory state 冲突（持久化契约）
5. 定义 AbortSignal 传播链（或明确降级）
6. 定义 Agent/Tool 访问矩阵
7. 定义 Iron wall 具体规则
8. 量化"能力 ≥ Baseline"
9. 定义 Golden 样本数据来源 + LLM judge rubric
10. 承认成本会翻 5-10 倍，设 budget + 早停策略
11. 承认工作量 50-70 人天，不是 2-3 天
12. 引入分 Tier 实施 + 回退逃生窗口
13. 引入 Phase 0 基线捕获

### 应该改的（提高质量）

14. 全文档唯一 ID 方案（Stage/Agent/Tool/Skill）
15. 每个 Stage/Agent 的 SLO（latency / token / success rate）
16. Stage 的 DAG 表达（不是 stages[] 数组）
17. Section-level 并发度 + 早停策略
18. Cache prefix 严格区分 stable / dynamic
19. Cost observability utility
20. 明确 Pipeline 归属（topic-insights 内 or 下沉 ai-engine）

### 可以改的

21-34. 其他 🟡/❓ 项

---

## 十一、给自己的诚实总结

我写 3 份文档的时候，倾向是**"画一个完美架构图"**而不是**"一个能交付的方案"**。

具体表现：

- 17 agent：好看、职责单一，但没算成本
- 14 stage：线性好讲，但 DAG 依赖没画
- 5 层：分层清楚，但"分层 ESLint"是我空头承诺
- 60 项能力：盘得全，但 8 项真正重要的遗漏了（progressPercent、AbortSignal、Credit 扣费等非功能性需求）

**教训**：架构设计时应该先问 "这个设计会怎么失败" 再问 "这个设计有什么优点"。

这份 10 号文档就是在回答"怎么失败"。请把它和 00/01/02 一起看——**没有 10 号文档的 00/01/02 是误导性的乐观设计**。
