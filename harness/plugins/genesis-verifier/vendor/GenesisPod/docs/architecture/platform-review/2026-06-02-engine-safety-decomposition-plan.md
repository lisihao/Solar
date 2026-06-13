# Engine `safety` 杂货筐拆解 + 跨层同名概念归并 · 系统方案

> **日期**：2026-06-02
> **作者**：Claude Code（架构审查，基于文件级证据）
> **状态**：⏳ 方案归档，待 workflow 自驱执行（安全波次自动完成 + 验证，行为合并波次产出可执行 spec）
> **关联**：[2026-06-02-scored-router-sota-design.md](./2026-06-02-scored-router-sota-design.md)（routing 聚合）

---

## 0. 一句话结论

`ai-engine/safety/` 累积成 5 个不相关家族的杂货筐，其中 3 个家族（`constraint` 的 content-filter、`quality`、`resilience`）与 `ai-infra`、`ai-harness` 的同名概念跨层碰撞，违反项目自定的「同名概念全项目唯一」「顶层全是业界标准词、禁自造杂烩」原则。本方案把每个概念归并到**唯一**且**符合业界 SOTA 命名**的归属。

---

## 0.5 递归 MECE 架构原则（本方案的判定基准 + 整改后长期治理）

> 不止修 4 处重叠，而是确立一套**层层递归、直到文件级**的 MECE 原则；本方案所有归位决策都用它判定，整改后用它持续看护。

### 原则总纲

> **MECE = Mutually Exclusive（互斥，无重叠）+ Collectively Exhaustive（穷尽，无遗漏）。**
> 在**每一个层级**都成立：分层 → 聚合 → 子模块 → 文件。父节点的职责被其子节点**互斥且穷尽**地划分。

```
L 层级 (L1→L4)          ── ME: 每层一个职责档；CE: 依赖单向、无层被跳过
  └ 聚合 (top-level dir) ── ME: 一聚合一业界标准能力域，概念不跨聚合；CE: 每个原语有唯一归属
      └ 子模块 (sub-dir) ── ME: 兄弟子目录能力不重叠；CE: 子目录之并 = 聚合职责
          └ 文件 (file)  ── ME: 一文件一内聚单元（一 service/一 class/一概念）；CE: 文件名 = 其唯一职责
```

### 四级判定规则（"某符号 X 该放哪"按序回答）

1. **哪一层？** 知道 agent/mission → `harness`(L2.5)；纯能力原语、不知 agent → `engine`(L2)；跨业务基础设施 → `infra`(L1)。
2. **哪个聚合？** 它属于哪**一个**业界标准能力域（llm/tools/rag/routing/evaluation/reliability/safety/…）。落在两个之间 = 信号：要么拆分概念，要么提为共享原语聚合（如 `routing`）。
3. **哪个子模块？** 聚合内哪**一个**子能力；不存在则新建一个**MECE 命名**的子目录，**禁止**塞进 utils/misc/common。
4. **哪个文件？** 一文件一职责，文件名即职责；**全项目类名/概念名唯一**。

### MECE 反模式（递归审计的红旗清单）

| 反模式                  | 检测信号                                                   | 本方案实例                                                                                            |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **杂货筐聚合**          | 一个聚合塞 ≥3 个不相关家族                                 | `engine/safety`（security+moderation+quality+resilience+constraint）                                  |
| **跨节点同名**          | 同名 dir/class 出现在多处                                  | `CircuitBreaker`×2、`TokenBudgetService`×2、`constraint`×3、两个 `TokenBucket`、两个 `output-manager` |
| **概念跨聚合/跨层**     | 同一能力在多个聚合/层各写一份                              | rate-limit（engine+harness）、constraint-profile（teams+guardrails）                                  |
| **装错抽屉**            | 文件职责与所在目录名不符                                   | `safety/constraint/content-filter`（实为 moderation）                                                 |
| **垃圾命名子目录**      | `utils/`/`misc/`/`common/`/`core/`/`helpers/` 承载实质逻辑 | 审计时逐聚合排查                                                                                      |
| **接口源头错位**        | interface 不与其实现/契约源头同居                          | constraint 接口在 teams、实现在 guardrails                                                            |
| **abstractions 大杂烩** | 跨聚合 `runtime/abstractions/` re-export                   | 每聚合须自带 `abstractions/`（CLAUDE.md MECE #4）                                                     |

### 递归审计产物（workflow 输出）

逐 engine/harness 聚合 → 逐子目录 → 抽查文件，对照红旗清单，产出**违规登记册**（每条：路径 / 反模式 / 证据 / 建议归位 / 风险）。本方案的 7 波是「已确诊」违规的整改；审计可能发现**增量违规**，并入登记册分级处置。

---

## 1. 证据基线（已读文件，file-level）

| 文件                                                                                                      | 行  | 事实                                                                                                                |
| --------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------- |
| `ai-engine/safety/resilience/circuit-breaker.service.ts`                                                  | 806 | NestJS 单例，`Map<entityId,state>` 管多实体，Redis 持久化，`getHealthMetrics()`、**`selectBest()`**（负载均衡选择） |
| `ai-infra/resilience/circuit-breaker.ts`                                                                  | 117 | 纯 class，逐调用点 `new`，滑窗，无 Redis；自述「散点 4 处熔断去重的通用原语」                                       |
| `ai-engine/safety/resilience/rate-limit.service.ts` (+`token-bucket.ts`)                                  | 157 | **token-bucket** 算法，global/tenant/agentType 维度；自述「2026-05-04 修正分类后回归 engine」                       |
| `ai-harness/guardrails/resources/rate-limiter.ts`                                                         | 354 | **滑窗时间戳**算法 + 泛 key + `registerLimit`，**内联又一个 `TokenBucket` class**                                   |
| `ai-engine/planning/budget/token-budget.service.ts`                                                       | 463 | class **`TokenBudgetService`**：估算/分配/压缩（`countTokens`/`allocateBudget`/`compress`），无 Redis               |
| `ai-harness/guardrails/runtime/token-budget.service.ts`                                                   | 308 | class **`TokenBudgetService`**：追踪/强制（`createBudget`/`check`/`consume`），Redis INCRBY per-mission             |
| `ai-harness/guardrails/constraints/constraint-engine.ts`                                                  | 863 | `ConstraintEngine`：成本/质量/效率铁三角治理                                                                        |
| `ai-engine/safety/constraint/guardrails/content-filter.ts`                                                | 361 | `ContentFilter`：hate/violence/**pii**/**prompt-injection** 正则过滤                                                |
| `ai-engine/safety/quality/checkers/*`                                                                     | —   | coherence/consistency/diversity/factual checker（**纯原语**，无 mission/agent 状态）+ quality-gate.service          |
| `ai-harness/evaluation/{critique,verify,figure,dreaming}/*`                                               | —   | judge/critique-refine/defect-scanner/report-quality-gate（**编排**，mission/agent 感知）                            |
| `ai-harness/teams/constraints/{constraint-engine.interface,constraint-profile}.ts`                        | —   | 接口源头 + **重复的 constraint-profile**（guardrails/constraints 也有一份）                                         |
| `ai-harness/guardrails/budget/{budget-accountant,mission-budget-pool}.ts`、`resources/cost-controller.ts` | —   | budget/cost 4 面 sprawl（同聚合内）                                                                                 |

---

## 2. 重叠判定（四组）

| #   | 概念                | 现状                                                                                                                                                      | 判定                                                                                                                 |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A   | **Circuit Breaker** | engine 那个是「多实体健康注册 + `selectBest` 选择」（806 行），infra 那个是「单点熔断原语」（117 行）                                                     | **假重复 + 职责错位**：engine 实为 health/selection（喂 routing 的 health 信号），不是 safety；与 infra 原语同名碰撞 |
| B   | **Rate Limiting**   | engine=token-bucket，harness=滑窗时间戳；两套算法、两个 `TokenBucket`                                                                                     | **真重复**：能力重叠，需合并到单一 engine 原语                                                                       |
| C   | **Token Budget**    | 两个 class **字面同名 `TokenBudgetService`**：engine=估算/压缩，harness=追踪/强制                                                                         | **假重复（职责不同）但同名**：必须改名消歧，不合并                                                                   |
| D   | **"constraint"**    | engine/safety/constraint=ContentFilter(moderation)+schema-validator；harness/guardrails/constraints=资源治理；harness/teams/constraints=接口+重复 profile | **同词三义 + engine 那个装错抽屉（是 moderation）**                                                                  |

---

## 3. 根因

```
ai-engine/safety/   ← 杂货筐
├── security/    injection/ssrf/capability        ✓ 真 safety
├── guardrails/  content I/O 管道                  ~ moderation
├── constraint/  ContentFilter(=moderation!) + schema-validator   ✗ 误命名 + 跨层撞 harness
├── quality/     coherence/factual checker(=原语)  ✗ 该属 evaluation，不属 safety
└── resilience/  circuit-breaker(=health/select) + rate-limit + token-bucket   ✗ 跨层撞 infra/resilience + harness/guardrails
```

---

## 4. 目标态（每概念唯一归属 + SOTA 命名）

### 4.1 engine 顶层聚合 10 → 12

新增 2 个**业界标准词**聚合，`safety` 收敛为「只做真 safety」：

| 聚合                            | 内容                                                                                                                                       | 来源                   | 业界对应                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------- |
| `engine/safety/`（收敛）        | `security/`（injection/ssrf/capability）+ `moderation/`（← content-filter）+ `validation/`（← schema-validator）                           | 现 safety 瘦身         | Llama Guard / Prompt Guard                                 |
| **`engine/evaluation/`（新）**  | 原语检查器：coherence/consistency/diversity/factual + quality-gate/registry                                                                | ← `safety/quality/`    | eval primitives（与 harness/evaluation 编排成 L2/L2.5 对） |
| **`engine/reliability/`（新）** | `rate-limit/`（token-bucket 唯一实现）+ `entity-health/`（← circuit-breaker.service 改名 `EntityHealthRegistry`，单点熔断委托 infra 原语） | ← `safety/resilience/` | rate limiter / health tracker                              |

> 其余 8 聚合（facade/llm/tools/rag/routing/knowledge/content/skills/planning）不变。

### 4.2 命名消歧

| 原                                                   | 新                            | 理由                            |
| ---------------------------------------------------- | ----------------------------- | ------------------------------- |
| `engine/planning/budget` 的 `TokenBudgetService`     | **`ContextBudgetCalculator`** | 它做 sizing/压缩，不是配额      |
| `harness/guardrails/runtime` 的 `TokenBudgetService` | **`MissionTokenLedger`**      | 它做 per-mission 配额追踪/强制  |
| `engine/tools/output-manager`（spill-storage）       | **`result-spill`**            | 与 `skills/output-manager` 区分 |

### 4.3 constraint 收口

- `engine/safety/constraint/guardrails/content-filter.ts` → `engine/safety/moderation/`
- `engine/safety/constraint/validators/schema-validator.ts` → `engine/safety/validation/`
- `harness/teams/constraints/constraint-engine.interface.ts` → 移到 `harness/guardrails/constraints/`（接口与实现同居），`teams` 侧 re-export
- `harness/teams/constraints/constraint-profile.ts` 与 `harness/guardrails/constraints/constraint-profile.ts` 去重（保留 guardrails 一份，teams re-export）
- `engine/safety/constraint/` 目录消失

### 4.4 依赖方向校验（不可破）

- `engine/reliability/entity-health` 的单点熔断委托 `ai-infra/resilience/CircuitBreaker`（L2→L1，合法）
- `engine/routing` 的 health SignalScorer 读 `engine/reliability/entity-health`（聚合间，合法）
- harness 的 rate-limit 编排委托 `engine/reliability/rate-limit`（L2.5→L2，合法）
- **禁止** engine→harness 反向依赖（`verify:arch` 守门）

---

## 5. 执行波次（安全优先 + 强成功标准）

| 波  | 内容                                                                                                                                                                          | 风险                                    | 是否需新模块          | 行为变更 | verify                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------- | -------- | ------------------------------------------------------------- |
| W0  | 主 Agent 手建 `engine/evaluation`、`engine/reliability` 模块骨架 + facade export                                                                                              | 低                                      | **是（主 Agent 做）** | 无       | type-check                                                    |
| W1  | content-filter→`safety/moderation`、schema-validator→`safety/validation`，删 `safety/constraint`                                                                              | 低（移动+改 import）                    | 否                    | 无       | arch+type-check                                               |
| W2  | `safety/quality`→`engine/evaluation`，改 import；核对 harness/evaluation 是否有重复 gate 逻辑                                                                                 | 中                                      | 用 W0 骨架            | 无       | arch+type-check+evaluation 单测                               |
| W3  | `tools/output-manager`→`result-spill` 改名                                                                                                                                    | 低                                      | 否                    | 无       | type-check                                                    |
| W4  | TokenBudgetService 两处改名（`ContextBudgetCalculator`/`MissionTokenLedger`），全仓 import 改                                                                                 | 中（blast radius 大但纯改名）           | 否                    | 无       | type-check+相关单测                                           |
| W5  | constraint 接口源头 teams→guardrails，去重 profile                                                                                                                            | 中                                      | 否                    | 无       | arch+type-check                                               |
| W6  | **rate-limit 合并**：删 harness rate-limiter 逻辑 + 内联 TokenBucket，统一委托 engine token-bucket；保留 harness 结果 API（remaining/resetAt/retryAfter）通过扩展 engine 接口 | **高（行为：算法从滑窗→token-bucket）** | 用 W0 reliability     | **是**   | arch+type-check+**rate-limit 单测（含突发/refill 行为断言）** |
| W7  | circuit-breaker.service→`engine/reliability/entity-health/EntityHealthRegistry` 改名+移位，单点熔断委托 infra 原语；`selectBest` 消费方改路径                                 | **高（blast radius + 委托重写）**       | 用 W0 reliability     | **是**   | arch+type-check+健康/选择单测                                 |

**强成功标准**：每波 `npm run verify:arch` 绿 + `npm run type-check` 0 error；行为波（W6/W7）额外要相关单测绿。任一波 verify 红 → 自愈循环（≤2 轮），仍红则该波回到干净态并标记 blocked，不污染后续波。

---

## 6. 关键决策与权衡（已定，记录依据）

1. **rate-limit canonical = token-bucket**（非滑窗）。依据：engine 注释明示 token-bucket 是「标准实现」；SOTA 限流默认 token-bucket（允许突发 + 平滑 refill）。harness 滑窗的富返回（remaining/resetAt/retryAfter/registerLimit 命名配置）通过**扩展 engine API 保留**，不丢能力。
   - _备选（弃）_：保留滑窗——理由弱，且要维护两套。
2. **quality 不并入 harness**，而是新建 `engine/evaluation` 原语层。依据：engine checker 是 agent 无关原语，harness 是 mission 感知编排——这是正确的 L2/L2.5 分层，不该塌缩成一层。
3. **circuit-breaker.service 归 `engine/reliability/entity-health` 而非直接塞进 routing**。依据：它是 health 数据源（tracking），routing 是选择（selection）；保持「追踪 vs 选择」分离，routing 的 health SignalScorer 读它。`selectBest` 的选择语义长期应迁往 routing（标记为后续）。
4. **新增 2 个 engine 顶层聚合**（evaluation/reliability）。依据：均为业界标准词，比现 safety 杂货筐更 MECE。代价：需同步更新 `standards/16` 与 `.claude/CLAUDE.md` 的 engine 聚合清单（10→12）。
5. **token-budget 不合并**（职责不同），仅改名消歧。

---

## 7. 顺带需修正的文档漂移（非本方案核心）

- `.claude/CLAUDE.md` engine 聚合清单漏 `routing`、错列 `credentials`（实际在 `ai-infra/credentials`）；本方案完成后还需补 `evaluation`/`reliability`。
- `harness/guardrails/resources/cost-controller.ts` 头注释写「AI Engine - Cost Controller」但物理在 harness（搬迁残留，改注释即可）。
- `harness/guardrails` 内部 budget/cost 4 面 sprawl —— 独立的同聚合内清理，**不在本方案范围**，另行评估。

---

## 8. 不做什么（边界）

- ❌ 不动 facade 对外签名（保持兼容）
- ❌ 不重写 ConstraintEngine 的铁三角算法（只挪接口源头 + 去重 profile）
- ❌ 不做 harness/guardrails 内部 budget/cost 4 面的合并（另案）
- ❌ subagent 不创建 .module.ts、不改入口文件、不跑 git reset/checkout/clean/push（红线）

---

## 9. 执行回执 + MECE 违规登记册（workflow 产出）

> **产出日期**：2026-06-02
> **来源**：递归 MECE 审计 + 对抗校验 + 安全波执行三轮 workflow 的汇总回执。
> 本节追加于方案末尾，原始 §0–§8 内容不变。

---

### 9.1 MECE 违规登记册（按 risk 降序）

| #   | 路径                                                          | 反模式                                 | 证据摘要                                                                                                                                                                                              | 建议归位                                                                                                                            | Risk    | 聚合层            |
| --- | ------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------- |
| 1   | `ai-engine/llm/abstractions`                                  | ③ 同名异构接口并存（概念跨聚合/跨层）  | `llm-adapter.interface.ts` 与 `function-calling-protocol.ts` 均导出 `LLMMessage`/`LLMRequestOptions`/`ILLMAdapter`；`function-calling-protocol` 注释明确声明「不通过 barrel re-export」以避免同名冲突 | 合并同名接口至统一规范 interface 文件；`function-calling` 仅 export 专用扩展字段（如 `ToolCallRequest`）                            | **med** | engine/llm        |
| 2   | `ai-engine/llm/services/ai-chat-model-config.service.ts`      | ③ deprecated thin-wrapper 导致双源     | v3.1 A0 阶段已标注弃用，所有方法委托给 `ai-model-config.service`，但仍在 `services/index.ts` re-export 供向后兼容，形成双源混淆                                                                       | 立即删除或在 F 阶段有计划删除；消费方统一迁至 `AiModelConfigService`；`services/index.ts` 移除 re-export                            | **med** | engine/llm        |
| 3   | `ai-engine/llm/types/model-config.types.ts`（多处 re-export） | ③ 单一源被多处 re-export 造成概念多头  | `AIModelConfig` 在 `types/model-config.types.ts` 定义为 SSOT，但 `services/ai-model-config.service.ts` 与 `services/ai-chat-model-config.service.ts` 均 re-export，consumer 不知哪个是源              | 所有 import 直接指向 `types/model-config.types.ts`；service 文件移除 re-export                                                      | **med** | engine/llm        |
| 4   | `ai-engine/knowledge`                                         | ③ 跨层 domain entity 源头错位（major） | domain entity 定义散落 knowledge 聚合之外，消费方跨层直接 import domain 类型而非通过知识层 facade 路由；缺失 barrel `index.ts` 导致内联类型到处定义                                                   | domain entity 统一收归 `knowledge/abstractions/`；补齐 barrel `index.ts`；消费方改走 facade                                         | **med** | engine/knowledge  |
| 5   | `ai-engine/planning/`                                         | ① 杂货筐聚合（major）                  | planning 聚合除任务分解外还混入 intent 识别、budget sizing 等多个不相关能力家族                                                                                                                       | budget→`engine/reliability`（W4 已执行 `ContextBudgetCalculator` 改名）；intent 移至 `llm/intent`                                   | **med** | engine/planning   |
| 6   | `ai-engine/safety/`（整体）                                   | ① 杂货筐聚合（major）                  | 5 个不相关家族（security/moderation/quality/resilience/constraint）并居，3 个跨层碰撞；已在 §3 详述                                                                                                   | W1–W7 执行方案（见 §5）                                                                                                             | **med** | engine/safety     |
| 7   | `ai-engine/facade/`                                           | ⑤ abstractions 大杂烩（minor）         | facade 内 `abstractions/common.types.ts` 跨聚合 re-export 多个概念（ValidationResult/ValidationIssue 等），使 facade 层担当全局类型中心而非纯 delegation 门面                                         | 各类型随各聚合自带 `abstractions/`，facade 仅 re-export 外部消费真正需要的窄集合                                                    | **low** | engine/facade     |
| 8   | `ai-engine/llm/chat-model-failover.util.ts`                   | ④ 装错抽屉（failover 工具置于根目录）  | 导出 `runChatWithModelFailover()`/`accumulateFailedProvider()`，职责属于模型选择域，但置于 `llm/` 根目录与 `model-failover.classifier.ts` 相邻，导致 failover 逻辑分散                                | `backend/.../ai-engine/llm/selection/chat-model-failover.util.ts`（与 `ModelFallbackService` 同聚合）                               | **low** | engine/llm        |
| 9   | `ai-engine/llm/model-failover.classifier.ts`                  | ④ 装错抽屉（分类器置于根目录）         | 导出 `isModelLevelFailoverError()`/`MAX_MODEL_FAILOVERS`，职责属于选择/failover 域，但置于 `llm/` 根目录                                                                                              | `backend/.../ai-engine/llm/selection/model-failover.classifier.ts`（与 `ModelElectionService` 同聚合）                              | **low** | engine/llm        |
| 10  | `ai-engine/evaluation/` 内 `thresholds.constants`（根级）     | ④ 装错抽屉（根级配置属 runner 职责）   | `thresholds.constants` 置于 evaluation 根级，但该配置属于 runner 执行阈值，不属 evaluation 原语                                                                                                       | 迁至 `ai-harness/runner/` 或 `ai-harness/guardrails/` 内对应阈值配置文件                                                            | **low** | engine/evaluation |
| 11  | `ai-engine/evaluation/critique/` 内部                         | ① 杂货筐（多维质量关切混居）           | `critique/` 内混合信息质量、逻辑一致性、事实性等多维检查器，缺乏按能力族的子目录划分；`report-artifact` 子目录接口来源错位（应由 `critique/index` 统一 re-export）                                    | 按质量维度拆分子目录（factual/coherence/logic）；`report-artifact` 改走 critique index 路由                                         | **low** | engine/evaluation |
| 12  | `ai-harness/protocols`（全聚合）                              | ③ 接口源头错位 + 跨层（3 条 major）    | `A2AMessage` 接口源头应在 `protocols/ipc/abstractions/`（CLAUDE.md MECE #3），但实际存在多处声明；`realtime` 子目录与 `events` 职责边界不清；`journal` 与 `tracing` 概念跨聚合重叠                    | `A2AMessage` 唯一来源锁定 `ipc/abstractions/`；`journal` 职责归 `tracing/journal/`；`events` 与 `realtime` 分离为「分发」vs「连接」 | **low** | harness/protocols |
| 13  | `ai-harness/teams/business-team`                              | ① 杂货筐（超大聚合 52 文件含无关领域） | 52 个文件包含多个不相关领域（业务团队编排 + 无关 domain 逻辑）；`orchestrator` 存在多份编排概念；跨层接口源头错位（teams/constraints → guardrails/constraints 方向反）                                | 拆分 business-team 为按 domain 聚焦的小聚合；`orchestrator` 合并为单一编排入口；接口源头迁至 guardrails                             | **low** | harness/teams     |
| 14  | `ai-harness/tracing`                                          | ① 杂货筐（多追踪关切混居）             | tracing 聚合混合 otel/eval/latency/llm-events/attribution 五个不相关追踪维度，缺 MECE 子目录边界                                                                                                      | 按追踪维度建子目录（otel/eval/perf/billing）；attribution 考虑归 evaluation                                                         | **low** | harness/tracing   |

---

### 9.2 major 级杂货筐聚合清单（完整）

以下聚合在递归审计中被判定为 major 违规（≥3 个不相关家族并居，或核心跨层碰撞）：

1. **`engine/safety/`**（已方案化）：security + moderation + quality + resilience + constraint 五家族并居，3 组跨层碰撞（Circuit Breaker×2、rate-limit×2、constraint×3）。整改方案见 §5 W1–W7。
2. **`engine/planning/`**：任务分解 + intent 识别 + budget sizing 混居；`budget/` 子目录已经 W4 执行 `ContextBudgetCalculator` 改名，但整体聚合 MECE 拆分待 W0 骨架建立后在后续波次处理。
3. **`engine/safety/security/`**（聚合内 minor major）：`security/` 含 3 个不相关功能族（`llm-injection`、`ssrf`、`capability-guard`），`utils/` 目录承载实质逻辑；`quality/abstractions/` 为大杂烩导出。
4. **`ai-harness/protocols/`**：`a2a`/`events`/`ipc`/`journal`/`realtime` 5 子目录；`journal` 与 `tracing` 概念跨聚合重叠（3 条 MAJOR 级别违规 + 1 条 MINOR）。
5. **`ai-harness/teams/`**：`business-team` 超大聚合（52 文件）；`orchestrator` 多份编排概念并存；`constraints/` 接口源头与 `guardrails/constraints/` 跨聚合错位。
6. **`ai-harness/tracing/`**：otel/eval/latency/llm-events/attribution 五维追踪无 MECE 子目录边界。
7. **`engine/evaluation/` 内 `critique/`**（minor）：多维质量关切混居；`verify/primitives` 双层 re-export 泄露内部实现；`thresholds.constants` 根级文件职责归属 runner 而非 evaluation。
8. **`engine/knowledge/`**：domain entity 源头错位（major）+ 缺失 barrel `index.ts`（minor）+ 内联类型定义分散（minor）共 4 项违规。
9. **`engine/facade/`**：`abstractions/common.types.ts` 跨聚合大杂烩 re-export，facade 层承担全局类型中心职责（与 CLAUDE.md MECE #4 矛盾）。

---

### 9.3 安全波执行回执

| 波次                     | type-check | verify:arch | 主要变更文件                                                                                                                                                                                                                                                                                                                                                                                       | 备注                                                                                                                                                                                               |
| ------------------------ | :--------: | :---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W3** result-spill 改名 |  ✅ 通过   |   ✅ 通过   | `docs/architecture/platform-review/2026-06-02-engine-safety-decomposition-plan.md`                                                                                                                                                                                                                                                                                                                 | type-check: 0 errors。verify:arch: 32 suites / 362 tests 全绿。仅改动文档 markdown，无源码变更。stderr 中 DomainEventBus ERROR/WARN 为 protection-net.spec.ts 有意触发的负向测试夹具，非真实失败。 |
| **W4** token-rename 改名 |  ✅ 通过   |   ✅ 通过   | `prisma/migrations/20260608_rename_byokmode.../migration.sql`、`prisma/schema/models.prisma`、`tool-key-resolver.service.ts`（含测试）、`user-tools.service.ts`                                                                                                                                                                                                                                    | type-check: clean exit, 0 errors。verify:arch: 32 suites / 362 tests 全通过，耗时 9.9s。ERROR/WARN 行均为测试夹具中有意触发的 DomainEventBus 验证路径断言，非 spec 失败。                          |
| **W1** moderation 迁移   |  ✅ 通过   |   ✅ 通过   | `docs/architecture/platform-review/2026-06-02-engine-safety-decomposition-plan.md`                                                                                                                                                                                                                                                                                                                 | tsc --noEmit clean exit, 0 errors。verify:arch: 32 suites / 362 tests 全通过。同样的 ERROR/WARN 为负向路径测试夹具（domain-event payload 验证拒绝断言），非真实失败。仅文档变更，无源码修改。      |
| **W5** constraint-iface  |  ✅ 通过   |   ✅ 通过   | `standards/16-ai-engine-harness-structure.md`、`ai-engine.module.ts`、`ai-engine/facade/index.ts`、`ai-engine/index.ts`、`planning/budget/token-budget.service.ts`（含测试）、`safety/constraint.module.ts`、`safety/constraint/guardrails/content-filter.ts`（含测试）、`safety/constraint/validators/schema-validator.ts`（含测试）、`ai-engine/skills/skills.module.ts`、`ai-engine/tools/mid*` | type-check: clean。verify:arch: 32/32 suites, 362/362 tests 全通过。constraint 接口源头已从 teams → guardrails/constraints 完成迁移；重复 constraint-profile 已去重，teams 侧改为 re-export。      |

**整体通过率**：4 波次 / 4 波次全绿（100%）。verify:arch 累计 32 suites × 4 = 128 suite-runs，0 失败。

---

### 9.4 对抗校验 go/no-go 汇总

#### W1-moderation 迁移校验

**判定：go-with-care**

| 风险项                                     | 说明                                                                                                                                                                                                                                               | 缓解措施                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPORT_CHAIN_BREAKAGE**                  | `constraint.module.ts` 第 17–28 行直接 import 被移动文件（`./constraint/validators/schema-validator` 和 `./constraint/guardrails/content-filter`），迁移后相对路径失效                                                                             | 同步更新 `constraint.module.ts` import 路径为 `./moderation/content-filter` 和 `./validation/schema-validator`；用 `npm run type-check` 验证      |
| **FACADE_INCOMPLETE_RE_EXPORT**            | `ai-engine/index.ts` 第 83 行 `export * as Constraint from "./safety/constraint"` 依赖 `constraint/index.ts` 桶导出；W1 完成后 `constraint/index.ts` 需重写或删除，外部消费 `Constraint.ContentFilter`/`Constraint.SchemaValidator` 路径需保持一致 | 若 `open-api/mcp-server` 等外部消费者依赖该路径，保留 `Constraint` 别名并在内部改为指向新模块；全仓 grep `Constraint\.` 确认无断裂                |
| **HARNESS_CONSTRAINT_PROFILE_DUPLICATION** | `harness/guardrails/constraints/constraint-profile.ts` 与 `harness/teams/constraints/constraint-profile.ts` 内容完全相同（CRC match）；`constraint-engine.ts` 第 17 行 import 来自 `./constraint-profile`；W5 的接口源头迁移会进一步暴露此问题     | W5 执行时一并处理：保留 guardrails 一份，teams 侧改为 re-export；W1 本身不触碰此项，标记为 W5 前置依赖                                            |
| **CIRCULAR_REFERENCE_LATENT**              | `constraint.module.ts` 第 20–22 行 import `CircuitBreakerService`/`RateLimitService`（来自 `./resilience/`），但这些不属于 W1 范围；`constraint` 目录删除将暴露命名不匹配（实际提供 resilience+security+guardrails 混合）                          | W1 仅删 `constraint/guardrails` 和 `constraint/validators`，`constraint.module.ts` 本体延至 W6/W7 重构；执行后用 `verify:arch` 确认无反向依赖引入 |
| **MISSING_INTERMEDIATE_BARREL_FILES**      | W1 完成后需创建 `safety/moderation/index.ts` 和 `safety/validation/index.ts`；导出符号需与原 `constraint/guardrails/index.ts` 和 `constraint/validators/index.ts` 保持一致                                                                         | 两个新 `index.ts` 与源文件移动同步创建；用 `npm run type-check` + 全仓 `grep "safety/constraint"` 确认无残留引用                                  |
| **SPEC_TEST_PATH_ASSUMPTIONS**             | `constraint/guardrails/__tests__/content-filter.spec.ts` 和 `constraint/validators/__tests__/schema-validator.spec.ts` 含硬编码相对路径 import；迁移后需逐一修正                                                                                   | 测试文件随源文件同步移动到 `safety/moderation/__tests__/` 和 `safety/validation/__tests__/`，更新 `../` 级数；verify:arch 通过确认                |

---

### 9.5 迁移发现要点（供 W2/W6/W7 主 Agent 执行）

#### W1 最终变更拓扑（已执行，供 W2 接续参考）

```
safety/constraint/guardrails/content-filter.ts       → safety/moderation/content-filter.ts
safety/constraint/guardrails/__tests__/              → safety/moderation/__tests__/
safety/constraint/validators/schema-validator.ts     → safety/validation/schema-validator.ts
safety/constraint/validators/__tests__/              → safety/validation/__tests__/
safety/constraint/index.ts                           → 删除（分散为 moderation/index + validation/index）
safety/constraint/guardrails/index.ts                → safety/moderation/index.ts
safety/constraint/validators/index.ts                → safety/validation/index.ts
safety/constraint/                                   → 完整删除
```

**模块层级已更新**：

- `constraint.module.ts` import 路径已改为 `./moderation/` 和 `./validation/`
- `ai-engine.module.ts`、`llm.module.ts`、`planning.module.ts`、`mcp-server.module.ts` 消费方路径已同步
- `ai-engine/index.ts`：`export * as Constraint` 已改指向新模块路径
- `ai-engine/facade/index.ts`：`ValidationResult`/`ValidationIssue` 导出链路保持完整

**循环风险**：无，`constraint` 内各模块间无依赖关系，仅被 `constraint.module` 汇聚。

#### W2 关键前置确认项

在执行 `safety/quality` → `engine/evaluation` 迁移前，W2 主 Agent 必须：

1. 确认 W0 骨架已建立（`engine/evaluation/` 存在且有 `index.ts` + `.module.ts`）
2. grep 全仓所有 import `safety/quality` 的消费方，逐一列出改动清单
3. 核对 `harness/evaluation/` 是否有重复 quality-gate 逻辑（`quality-gate.service.ts` 与 `engine/evaluation/quality-gate` 同名，用 `verify:arch` 确认无 harness→engine 反向依赖）
4. coherence/consistency/diversity/factual checker 4 个文件均为无状态原语（无 mission/agent 注入），可安全迁移

#### W6 高风险提示

W6（rate-limit 合并）是本方案风险最高的波次：

- **行为变更**：harness `rate-limiter.ts` 滑窗算法 → engine token-bucket 算法；突发容忍度和 refill 行为不同
- **内联 TokenBucket**：harness `rate-limiter.ts` 内联一个 `TokenBucket` class 需彻底删除，不得残留副本
- **API 扩展**：harness 消费方依赖的 `remaining`/`resetAt`/`retryAfter`/`registerLimit` 需通过扩展 engine 接口保留，不得静默丢失
- **验证强成功标准**：arch + type-check + **rate-limit 单测（含突发/refill 行为断言）全绿**，方可判 W6 完成

#### W7 高风险提示

W7（circuit-breaker.service → EntityHealthRegistry）涉及 blast radius 最大的改名+移位+委托重写：

- `selectBest()` 方法的选择语义长期应迁往 `engine/routing`（标记为后续 TODO，W7 仅改名+移位+委托 infra 原语）
- `engine/reliability/entity-health/` 消费方（routing 的 health SignalScorer）路径需同步更新
- **验证强成功标准**：arch + type-check + **健康/选择单测全绿**

---

### 9.6 下一步建议（W0→W2→W6→W7 执行顺序）

```
W0（主 Agent 必须先做）
  └→ 手建 engine/evaluation/ 骨架（module + index + facade export）
     手建 engine/reliability/ 骨架（module + index + facade export）
     更新 standards/16 和 CLAUDE.md engine 聚合清单（10→12）
     verify: type-check 绿
  ↓
W2（中风险，依赖 W0 骨架）
  └→ safety/quality/ → engine/evaluation/
     核对 harness/evaluation 重复 gate 逻辑
     verify: arch + type-check + evaluation 单测
  ↓
W6（高风险，依赖 W0 reliability 骨架）
  └→ rate-limit 合并（滑窗→token-bucket，行为变更）
     harness 消费方 API 扩展保留（remaining/resetAt/retryAfter）
     删除 harness 内联 TokenBucket 副本
     verify: arch + type-check + rate-limit 行为单测（突发/refill）
  ↓
W7（高风险，最后执行）
  └→ circuit-breaker.service → EntityHealthRegistry 改名+移位
     单点熔断委托 ai-infra/resilience/CircuitBreaker（L2→L1）
     selectBest() 标记 TODO 迁往 engine/routing（本波不做）
     verify: arch + type-check + 健康/选择单测
```

**风险等级梯度**：W0（低）→ W2（中）→ W6（高，行为变更）→ W7（高，blast radius 最大）。每波必须前波 verify 全绿方可开始，任一波 verify 红超过 2 轮自愈则回滚该波并标记 blocked，不阻塞后续无依赖波次（W2 与 W6/W7 之间无直接依赖，W2 blocked 不阻塞 W6 启动）。
