# Tools & Skills 机制层审计报告

**日期**: 2026-04-30
**审计范围**: `backend/src/modules/ai-engine/tools/` + `backend/src/modules/ai-engine/skills/` + `backend/src/modules/ai-harness/kernel/skills/` + `backend/src/modules/ai-harness/kernel/base/`
**审计深度**: 机制层（接口契约 / 中间件链 / 执行路径 / 注册体系），不包括覆盖率、命名、分类完整性等表层维度
**审计方法**: 双 sub-agent 并行（architect 设计方案 + arch-auditor 锁影响面），辅以代码级 grep 验证
**结论**: **机制层有 12 个明确缺陷，其中 4 个 P0 结构性问题；本轮先治理 P0 中的前 2 个，工作量 1.3 天**

---

## 0. TL;DR

```
盘点结果：
  Tools = 58 个内置（ai-engine/tools/categories）+ 2 个 runtime（ai-harness/memory/tools，ShortTermMemoryTool / LongTermMemoryTool）
  Skills = 23 个 code-based（ai-app/office/slides/skills/*.skill.ts）
         + 94 个 prompt-based（ai-app/{research,writing,topic-insights,contracts}/skills/*.skill.md）
         + 4 个 ai-harness/kernel/skills 内置（独立 Registry）

测试体量：
  Tools categories  → 1725 cases / 67 suites / lines 94.12% / branches 80.92%
  Skills (engine)   → 628 cases  / 15 suites / lines 96.6%  / branches 87.9%
  Skills (harness)  → 52 cases   / 6 suites  / lines 98.0%  / branches 78.4%
  Skills (office)   → 769 cases  / 26 suites / lines 91.8%  / branches 76.4%

12 个机制缺陷分布：
  P0 (4) — 结构性 / 安全 / 正确性级别
  P1 (8) — 可观测性 / 治理 / SOTA 对齐

本轮治理：
  PR1 = 修复 P0-#1（Pipeline 接通）+ P0-#2（Output Schema 严格化，feature flag 软切）
  PR2 = 修复 P0-#5（ToolACL entitlement 搬到 PermissionMiddleware）
  PR3 (原计划)  → 取消（审计发现 BaseSkill 零生产调用，cache 无收益）
  PR4 (Function Calling) → 单独评估，不在本批次

工作量：1.3 天，2 个 PR，独立可回滚
```

---

## 1. 体系盘点

### 1.1 Tools 层（58 个内置 + 2 个 harness 注册）

| 类别                         | 数量            | 路径                                        | 注册方式                                                                                   |
| ---------------------------- | --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Information                  | 21              | `ai-engine/tools/categories/information/`   | `tools.provider.ts` 静态注册                                                               |
| Generation                   | 6               | `ai-engine/tools/categories/generation/`    | 同上                                                                                       |
| Processing                   | 7               | `ai-engine/tools/categories/processing/`    | 同上                                                                                       |
| Execution                    | 3               | `ai-engine/tools/categories/execution/`     | 同上（Python/JS/Shell 因 RCE 风险显式禁用）                                                |
| Integration                  | 6               | `ai-engine/tools/categories/integration/`   | 同上                                                                                       |
| Memory（engine 部分）        | 3               | `ai-engine/tools/categories/memory/`        | 同上                                                                                       |
| Memory（harness 运行时部分） | 2               | `ai-harness/memory/tools/`                  | `RuntimeMemoryModule.onModuleInit` 反向注册到 engine `ToolRegistry`                        |
| Export                       | 4               | `ai-engine/tools/categories/export/`        | `tools.provider.ts`                                                                        |
| Collaboration                | 6               | `ai-engine/tools/categories/collaboration/` | 同上                                                                                       |
| **总计**                     | **58 + 2 = 60** | —                                           | 启动时 `AiEngineModule.onModuleInit` 比对 `toolRegistry.size()` 与 `TOTAL_TOOL_COUNT` 自检 |

### 1.2 Skills 层

| 来源                           | 类型                          | 数量                       | 注册路径                                                                                             |
| ------------------------------ | ----------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ai-engine/skills/registry`    | 主线 SkillRegistry（生产）    | —                          | code-skill 直接 `register(skill)`；prompt-skill 通过 `PromptSkillBridge.registerDomain(domain)` 桥接 |
| `ai-harness/kernel/skills`     | ReAct loop 内置 SkillRegistry | 4 .ts + 2 SKILL.md         | 独立体系，与 ai-engine 注册表**不互通**                                                              |
| `ai-app/office/slides/skills`  | code-based skill              | 23 .skill.ts + 22 SKILL.md | bridge → `registerDomain("office")`                                                                  |
| `ai-app/research/skills`       | prompt-only skill             | 22 .skill.md               | bridge → `registerDomain("research")`                                                                |
| `ai-app/topic-insights/skills` | prompt-only skill             | 47 .skill.md               | bridge → `registerDomain("insights")`                                                                |
| `ai-app/writing/skills`        | prompt-only skill             | 15 .skill.md               | bridge → `registerDomain("writing")`                                                                 |
| `ai-app/contracts/skills`      | meta/规范文档                 | 10 .skill.md               | 不注册，仅开发参考                                                                                   |

---

## 2. 机制层 12 个缺陷

### P0 — 结构性 / 安全 / 正确性级别（4 项）

#### P0-#1: BaseSkill / BaseAgent 的 callTool 完全绕过 ToolPipeline 🚨

**证据**:

`backend/src/modules/ai-engine/skills/base/base-skill.ts:319`

```ts
const result = await tool.execute(input, toolContext); // 直接调，绕过 4 个中间件
```

`backend/src/modules/ai-harness/kernel/base/base-agent.ts:328`

```ts
const result = await (tool.execute(toolInput, toolContext) as Promise<
  ToolResult<T>
>); // 同样绕过
```

**实际影响（审计验证）**:

| 调用源             | 文件                | 是否生产路径                                                                                                                                                                                                                                    |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BaseSkill.callTool | `base-skill.ts:294` | ❌ **生产 0 调用** —— ai-app 下无任何 .skill.ts 子类                                                                                                                                                                                            |
| BaseAgent.callTool | `base-agent.ts:303` | ✅ **被 reactive-agent.ts:367 + plan-agent.ts:369 实际路由调用**，~10 个 Agent 类继承（researcher / topic-insights / writer / image-designer / story-architect / editor / consistency-checker / bible-keeper / simulator / team-collaboration） |

**后果**:

- ❌ ValidationMiddleware 不跑 → 输入 Schema 不校验
- ❌ PermissionMiddleware 不跑 → 不扣 credit、不记 permission_denied
- ❌ TimeoutMiddleware 不跑 → 默认 timeout 不生效
- ❌ ProgressMiddleware 不跑 → 进度事件丢失

**严重度**: P0。**当前生产路径上，所有 Agent 调用工具都绕过中间件链**——所有的"安全/可观测性/超时"承诺只在 LLM Function Calling 直接发起时兑现，而那条路径在仓库里几乎不存在。

---

#### P0-#2: Output Schema 校验 warn-only，不 reject

**证据**:

`backend/src/modules/ai-engine/tools/middleware/validation.middleware.ts:127-145`

```ts
async after(result, _context, tool) {
  if (!this.config.validateOutput || !result.success) return result;
  const schemaResult = this.validateAgainstSchema(result.data, tool.outputSchema);
  if (!schemaResult.valid) {
    Logger.warn(`Output validation warning for tool '${tool.id}': ...`);
    // ⚠️ 只 warn，照常返回脏数据
  }
  return result;
}
```

且 `validateOutput` 默认值为 `false`（line 64），所以多数环境**连 warn 都不会触发**。

**OpenAI / Anthropic 都是 reject 语义**——LLM 拿到不符合 schema 的 result，幻觉风险会直接抬高。

**抽样 10 工具的 outputSchema 实际合规度**:

| 工具                 | schema vs 实际返回                                   | 切 reject 后是否立即挂    |
| -------------------- | ---------------------------------------------------- | ------------------------- |
| web-search           | 严格对齐                                             | ✅ 不挂                   |
| rag-search           | 严格对齐                                             | ✅ 不挂                   |
| export-pdf           | 严格对齐                                             | ✅ 不挂                   |
| congress-gov         | 严格对齐                                             | ✅ 不挂                   |
| template-render      | 严格对齐                                             | ✅ 不挂                   |
| github-integration   | 严格对齐                                             | ✅ 不挂                   |
| entity-memory        | union 结构松散，但实际符合                           | ✅ 不挂                   |
| data-analysis        | LLM 生成内容，无法静态验证                           | ⚠️ 可能挂                 |
| **image-generation** | 失败路径缺 `width/height/model`                      | ❌ **会挂**（特定路径）   |
| **agent-handoff**    | async 路径多出 `metadata.handoffAt`（schema 未声明） | ❌ **会挂**（async 路径） |

**估算**：约 **55/58 工具不会立即挂**，但 image-generation 失败路径 + agent-handoff async 路径会触发 reject。**必须用 feature flag 软切（先 staging 2 周再生产）**。

---

#### P0-#5: ToolACL（entitlement）只在召回阶段单点检查

**证据**:

`backend/src/modules/ai-harness/kernel/dx/agent-runner.service.ts:1023-1052` Step 4 是**全库唯一**的 entitlement 检查点：

```ts
// Step 4. ToolACL（D13）—— 用户 entitlements 过滤
if (opts.environment && pool.length > 0) {
  const ents = await opts.environment.getUserEntitlements();
  // ... 检查 tool.requiredEntitlements 是否被 ents.keys 满足
}
```

**审计验证**:

- `requiredEntitlements` 全库**仅 1 个工具声明**（`image-generation.tool.ts:108`，`["image.generation"]`）
- `getUserEntitlements()` 全库**仅 1 处调用**（agent-runner.service.ts:1030）
- `permission.middleware.ts` 已存在 Injectable provider，但**当前完全不查 entitlement**
- 任何路径绕过 agent-runner 召回（如直接 `toolRegistry.tryGet().execute()` 或 `BaseAgent.callTool` 走 P0-#1 那条裸路径）→ entitlement 校验**全部失效**

**严重度**: P0（安全控制只在一处 = 任何旁路 = 整体被绕过）。

---

#### P0-#9: 双 SkillRegistry 共存且不互通

**证据**:

`backend/src/modules/ai-engine/skills/registry/skill.registry.ts:4-23`（自承认的注释）：

```ts
/**
 * ⚠️ NAME COLLISION WARNING — there are TWO classes called `SkillRegistry`
 *
 * 1. THIS class — `ai-engine/skills/registry/skill.registry.ts`
 *    - CRUD-style registry of `ISkill` instances
 *    - Backed by DB via SkillContentService
 *
 * 2. The other one — `ai-harness/kernel/skills/skill.registry.ts`
 *    - In-memory registry of SKILL.md files
 *    - Used by ReActLoop / SkillActivator
 *
 * Renaming one of them is tracked by audit P1-3 but deferred — touches ~65 files.
 */
```

接口形状不同（`ISkill` vs parsed-md），**ReAct Loop 用 #2，ai-app 用 #1**，互相不可见。

**严重度**: P0 结构债，但治理成本高（~65 文件改名 + 迁移），**本轮不动**，标记为 PR5 候选。

---

### P1 — 可观测性 / 治理 / SOTA 对齐（8 项）

| #      | 缺陷                                                                                                                                                                                         | 关键证据                                                                             | 改在哪                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| P1-#3  | JSON Schema 验证器是手写简化版，不支持 oneOf/anyOf/allOf/$ref/format/pattern；项目已有 `zod ^3.25.76` 但未使用                                                                               | `validation.middleware.ts:155-250` 注释 "生产环境建议使用 ajv 等专业库"              | engine                              |
| P1-#4  | `ITool.sideEffect: 'none'\|'idempotent'\|'destructive'` 字段定义但全仓只有 1 处声明（`image-generation.tool.ts:107`），**0 处消费**——注释里承诺的 "L2 stage 重跑时跳过 destructive" 从未实现 | `tool.interface.ts:451`                                                              | engine（补声明）+ harness（补消费） |
| P1-#6  | 无 streaming：`ToolResult` 只有同步返回，progress middleware 只发 start/end 事件                                                                                                             | 无 stream 字段                                                                       | engine（接口）+ harness（事件）     |
| P1-#7  | 无 retry / circuit breaker：`ToolResult.error.retryable` 已声明但**无任何代码读取**；外部 API 工具一次失败就 propagate                                                                       | `concurrency/tool-concurrency.service.ts` 只做并发限流                               | harness（新中间件）                 |
| P1-#8  | 无 parallel tool calls：LLM 现代 API 都支持一次响应多 tool_use，项目串行                                                                                                                     | `ToolPipeline.execute` 单 tool                                                       | harness                             |
| P1-#10 | PromptSkillAdapter 没接 LLM Function Calling：SKILL.md `allowed-tools` 字段被解析但**下游零消费**，prompt skill 想用 tool 只能在 system prompt 里写"请输出 JSON"由 caller 解析               | `prompt-skill-adapter.ts:130` `facade.chat({ messages, taskProfile })` 无 tools 字段 | engine                              |
| P1-#11 | `requiredTools` 仅做存在性检查，无 DI 绑定：runtime `callTool(toolId)` 还是字符串查表，类型不安全                                                                                            | `base-skill.ts:253-265`                                                              | engine                              |
| P1-#12 | SKILL.md 无三段式：Anthropic Agent Skills 标准是 `SKILL.md + references/ + scripts/ + assets/`，项目所有 .skill.md 都是单文件                                                                | 94/94 都是裸 .md                                                                     | engine（Loader 改造）               |

### 工程治理类（不属于 engine/harness 任一层）

| #      | 缺陷                                                                            | 改在哪                   |
| ------ | ------------------------------------------------------------------------------- | ------------------------ |
| P1-#14 | office .skill.ts ↔ .md 不一一对应（7 个孤立 .ts + 6 个孤立 .md），无 CI 校验    | 仓库治理（守护脚本）     |
| 配置类 | jest 未排除 `.claude/worktrees/` → 导致 13 个 office spec 因 stale 文件污染失败 | `backend/jest.config.js` |

---

## 3. 跨层割裂矩阵

| 应有的双向链路                                                   | 当前状态                                                                                | 后果            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------- |
| Skill 调 Tool 走 Pipeline                                        | ❌ 直调 `tool.execute`，绕过中间件                                                      | P0-#1，本轮治理 |
| Agent 调 Tool 走 Pipeline                                        | ❌ 同上                                                                                 | P0-#1，本轮治理 |
| Skill `requiredTools` ↔ runtime ToolACL                          | ❌ 不联动，各管各                                                                       | P1-#11          |
| Skill `allowedTools`（frontmatter） → LLM Function Calling tools | ❌ 未传给 LLM                                                                           | P1-#10          |
| Tool sideEffect → 重跑策略                                       | ❌ 字段只声明 1 个，未消费                                                              | P1-#4           |
| Tool/Skill 统一 capability discovery                             | ❌ Skill 有 `getSkillsForTask(query)`，Tool 无对等                                      | P1（未编号）    |
| Tool/Skill 共享 entitlement 模型                                 | ⚠️ 各自独立类型（Tool: `requiredEntitlements`；Skill: `permissions: SkillPermissions`） | P1（未编号）    |

---

## 4. 修复决策矩阵

### 4.1 修复归位（按 engine vs harness 分层规则）

```
分层规则（CLAUDE.md L2/L2.5 推导）:
  ai-engine    = 能力的"原子"和"契约"
  ai-harness   = Agent 运行时脚手架（编排/执行/治理/会话）
  依赖方向     = harness → engine 单向
```

| #      | 缺陷                        | 改在哪                                    | 理由                                        |
| ------ | --------------------------- | ----------------------------------------- | ------------------------------------------- |
| P0-#1  | callTool 绕过 Pipeline      | engine（BaseSkill）+ harness（BaseAgent） | 两个基类各管一边                            |
| P0-#2  | Output schema warn-only     | engine（validation.middleware.ts）        | 中间件契约执行                              |
| P0-#5  | ToolACL 单点检查            | engine（PermissionMiddleware）            | 契约执行从单点搬到中间件链                  |
| P0-#9  | 双 SkillRegistry            | harness（合并/重命名）                    | 删 harness 那个，统一到 engine 是长期正确路 |
| P1-#3  | 手写 schema validator → zod | engine                                    | 实现选型                                    |
| P1-#4  | sideEffect 消费             | engine（补声明）+ harness（重跑策略）     | 双层协作                                    |
| P1-#6  | streaming                   | engine（接口）+ harness（事件总线）       | 双层协作                                    |
| P1-#7  | retry / circuit breaker     | harness（新中间件）                       | 运行时策略                                  |
| P1-#8  | parallel tool calls         | harness（ToolInvoker.invokeBatch）        | 运行时编排                                  |
| P1-#10 | Function Calling            | engine（facade.chat 加 tools 字段）       | LLM 是 engine 的能力                        |
| P1-#11 | requiredTools DI            | engine                                    | 类型安全契约                                |
| P1-#12 | SKILL.md 三段式             | engine（Loader）                          | Loader/Parser 都在 engine                   |
| P1-#14 | office .ts ↔ .md 校验       | 仓库治理                                  | 不属于 engine/harness 任一层                |

### 4.2 PR 计划（本轮 + 后续）

#### ✅ 本轮治理（PR1 + PR2，1.3 天）

| PR      | 范围                                                                       | 工作量 | 风险等级                    |
| ------- | -------------------------------------------------------------------------- | ------ | --------------------------- |
| **PR1** | P0-#1（callTool 走 Pipeline）+ P0-#2（Output reject 用 feature flag 软切） | 0.8 天 | 低（feature flag 默认 off） |
| **PR2** | P0-#5（ToolACL 搬到 PermissionMiddleware，召回过滤保留做双重防御）         | 0.5 天 | 低                          |

#### ⏸️ 取消的 PR

| 原 PR                                        | 取消理由                                                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR3 原计划 BaseSkill requiredTools cache** | 审计发现 BaseSkill **生产 0 调用**，cache 无收益。`requiredTools` 实际声明在 ~10 个 Agent 类，不是 Skill。若要做应改为 BaseAgent cache，但纯性能优化（一个 Map 查询），优先级低，留给下个迭代 |

#### 📅 后续迭代

| PR  | 范围                                                                                              | 估算工作量 |
| --- | ------------------------------------------------------------------------------------------------- | ---------- |
| PR4 | P1-#10（Function Calling 落地：facade.chat 加 tools 字段，PromptSkillAdapter 实现 tool_use 回路） | 1 周       |
| PR5 | P0-#9（双 SkillRegistry 收敛——删 harness 那个，方案 B）                                           | 2 周       |
| PR6 | P1-#3（zod 替换手写 schema validator）+ P1-#4（sideEffect 全量声明 + 重跑策略消费）               | 1 周       |
| PR7 | P1-#7（retry/circuit breaker 中间件）+ P1-#8（parallel tool calls）                               | 2 周       |
| PR8 | P1-#12（SKILL.md 三段式）+ P1-#11（requiredTools DI 绑定）+ P1-#14（office .ts↔.md 校验）         | 1.5 周     |

---

## 5. PR1 详细方案

### 5.1 改动文件清单

| 文件                                                                  | 行号        | 改动                                                                                                                                                      |
| --------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-engine/skills/base/base-skill.ts`                                 | 294-330     | callTool 改走 ToolPipeline；新增 `setToolPipeline` setter；保留无 pipeline 时的 fallback                                                                  |
| `ai-harness/kernel/base/base-agent.ts`                                | 303-335     | 同上（关键改动，生产路径）                                                                                                                                |
| `ai-engine/tools/middleware/validation.middleware.ts`                 | 64, 127-145 | `validateOutput` 默认值改为 `process.env.STRICT_OUTPUT_VALIDATION === "1"`；schema 不通过时 throw `ValidationError`（仅当 flag 开启）；否则保留 warn 行为 |
| `ai-harness/facade/ai.facade.ts`                                      | 1618-1645   | wiring 加 `setToolPipeline` 注入（duck-typed `"in" check`）                                                                                               |
| `ai-harness/facade/domain/team.facade.ts`                             | 139-148     | 同上                                                                                                                                                      |
| `ai-harness/runtime/teams/orchestrator/teams-mission-orchestrator.ts` | 1404-1408   | 同上                                                                                                                                                      |
| Agent 注册侧（具体路径待 PR1 实施时确认）                             | —           | 同上，对 BaseAgent 子类注入 ToolPipeline                                                                                                                  |

### 5.2 关键代码片段

#### BaseSkill.callTool 改造

```ts
// new field
protected toolPipeline?: ToolPipeline;

// new setter
setToolPipeline(pipeline: ToolPipeline): void {
  this.toolPipeline = pipeline;
}

// rewrite callTool
protected async callTool<T>(toolId: string, input: unknown, context: SkillContext): Promise<T> {
  if (!this.toolRegistry) throw SkillError.missingTool(this.id, toolId);
  const tool = this.toolRegistry.tryGet(toolId);
  if (!tool) throw SkillError.missingTool(this.id, toolId);

  const toolContext: ToolContext = {
    executionId: context.executionId, toolId,
    userId: context.userId, sessionId: context.sessionId,
    callerId: this.id, callerType: "skill",
    signal: context.signal, createdAt: new Date(),
  };

  // Pipeline 优先；无 pipeline 时降级到 direct execute（保留单测兼容）
  const result = this.toolPipeline
    ? await this.toolPipeline.execute(tool, input, toolContext)
    : await tool.execute(input, toolContext);

  if (!result.success) {
    throw SkillError.toolCallFailed(this.id, toolId,
      new Error(result.error?.message ?? "Tool execution failed"));
  }
  return result.data as T;
}
```

BaseAgent.callTool 同构改造（callerType 改为 `"agent"`，错误改为 AgentError）。

#### ValidationMiddleware Output reject 软切

```ts
// constructor
constructor(private readonly config: ValidationMiddlewareConfig = {}) {
  this.config = {
    validateInput: true,
    validateOutput: process.env.STRICT_OUTPUT_VALIDATION === "1",
    allowAdditionalProperties: true,
    ...config,
  };
}

// after()
async after(result, _context, tool): Promise<ToolResult> {
  if (!this.config.validateOutput || !result.success) return result;

  const schemaResult = this.validateAgainstSchema(result.data, tool.outputSchema);
  if (!schemaResult.valid) {
    if (process.env.STRICT_OUTPUT_VALIDATION === "1") {
      throw new ValidationError(schemaResult.errors ?? [],
        `Output validation failed for tool '${tool.id}'`);
    }
    Logger.warn(`Output validation warning for tool '${tool.id}': ...`, "ValidationMiddleware");
  }
  return result;
}
```

### 5.3 风险与回滚

| 风险                                                                                        | 缓解                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| BaseAgent.callTool 改造后 ValidationMiddleware 抛 ValidationError → 现有 Agent 失败链路改变 | `tool-pipeline.ts:90-122` 已自动 catch ValidationError 并转换为 `result.success=false`，与现有 `!result.success` 处理路径一致 |
| Output reject 切上后 image-generation / agent-handoff 特定路径会立即挂                      | feature flag 默认 off，staging 灰度 2 周，**先修两个工具的 schema 定义再开 prod**                                             |
| 部分 wiring 站点漏接 setToolPipeline                                                        | callTool 内有 `this.toolPipeline ? pipeline : direct execute` 降级，零中断                                                    |
| 单测使用 mock ToolRegistry 但不传 ToolPipeline                                              | 同上，自动降级到 direct execute，单测不挂                                                                                     |

**回滚**: revert PR1 单 commit；feature flag 关闭即恢复原行为。

---

## 6. PR2 详细方案

### 6.1 改动文件清单

| 文件                                                  | 行号      | 改动                                                                                                                                  |
| ----------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-engine/tools/abstractions/tool.interface.ts`      | ~75       | `ToolContext` 加可选 `environment?: { getUserEntitlements?: () => Promise<{ keys: string[] }> }`（结构类型，避免反向依赖 ai-harness） |
| `ai-engine/tools/middleware/permission.middleware.ts` | 39-73     | `before()` 加 entitlement 检查（参照 agent-runner.service.ts:1023-1052 现有逻辑），fail-closed 语义保留                               |
| `ai-harness/kernel/dx/agent-runner.service.ts`        | 1023-1052 | **保留 Step 4 召回过滤不变**（双重防御 + 让 LLM 看不到无权工具，避免幻觉调用），加注释指向 PermissionMiddleware 是运行时执行点        |
| 各 ToolPipeline 调用站点                              | —         | 构造 ToolContext 时把 `opts.environment` 传入                                                                                         |

### 6.2 关键代码片段

#### PermissionMiddleware.before() 改造

```ts
async before(_input: unknown, context: ToolContext, tool: ITool): Promise<void> {
  // 1. entitlement check (fail-closed)
  const required = tool.requiredEntitlements ?? [];
  if (required.length > 0) {
    let keys: string[];
    try {
      const ents = await context.environment?.getUserEntitlements?.();
      keys = ents?.keys ?? [];
    } catch (err) {
      this.logger.warn(`[entitlement_query_failed] tool=${tool.id} userId=${context.userId ?? "anonymous"} err=${(err as Error).message}`);
      throw new Error(`[PermissionMiddleware] Entitlement check failed for tool '${tool.id}' (fail-closed)`);
    }
    const missing = required.filter(r => !keys.includes(r));
    if (missing.length > 0) {
      this.logger.warn(`[entitlement_denied] tool=${tool.id} userId=${context.userId ?? "anonymous"} missing=${missing.join(",")}`);
      throw new Error(`[PermissionMiddleware] Missing entitlements for tool '${tool.id}': ${missing.join(", ")}`);
    }
  }
  // 2. extension hook (RBAC, rate limit, etc.)
  const allowed = await this.isAllowed(context, tool);
  if (!allowed.permitted) {
    throw new Error(`[PermissionMiddleware] ${allowed.reason ?? "Permission denied"}`);
  }
}
```

### 6.3 风险与回滚

| 风险                                         | 缓解                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 召回过滤 + middleware 双重检查导致性能开销   | 召回是 list 阶段一次过滤；middleware 是 single tool 级；entitlement 数据已在 environment 缓存，重复调用零 IO |
| 无 environment 的 ToolContext 走中间件时崩溃 | `requiredEntitlements?? []` 早返回，无 environment 也不会触发 entitlement 路径                               |
| 现有 test 不传 environment                   | 同上，无 entitlement 工具完全跳过此路径                                                                      |

**回滚**: revert PR2 单 commit；召回阶段过滤逻辑保留不变，回滚后保护级别等同改动前。

---

## 7. 可验证目标（PR1 / PR2 完成判定）

### PR1 完成判定（强成功标准）

```bash
# 1. 全量测试不退化
cd backend && npx jest "src/modules/ai-engine/tools" --modulePathIgnorePatterns='.claude/worktrees'
# 期望: 1725+ tests passed, 0 failed

cd backend && npx jest "src/modules/ai-engine/skills" --modulePathIgnorePatterns='.claude/worktrees'
# 期望: 628+ tests passed, 0 failed

cd backend && npx jest "src/modules/ai-harness/kernel/base"
# 期望: 全绿

# 2. 类型检查
cd backend && npm run type-check
# 期望: 0 error

# 3. 新增单测覆盖 BaseAgent.callTool 走 Pipeline
# 期望: 新增至少 3 个 case 验证 ValidationMiddleware / PermissionMiddleware / TimeoutMiddleware 都被触发

# 4. STRICT_OUTPUT_VALIDATION flag 行为单测
# 期望: flag=1 时 output schema 失败 reject；flag=0 时仅 warn
```

### PR2 完成判定

```bash
# 1. 单测：PermissionMiddleware 加 entitlement 路径
cd backend && npx jest "src/modules/ai-engine/tools/middleware/permission"
# 期望: 至少 4 个新 case：满足 / 不满足 / 查询失败 fail-closed / 无 environment 跳过

# 2. agent-runner Step 4 行为不变
cd backend && npx jest "src/modules/ai-harness/kernel/dx"
# 期望: 现有 ToolACL spec 全绿（保留召回过滤）

# 3. 类型检查 + 全量测试
cd backend && npm run verify:full
# 期望: 全绿
```

---

## 8. 决策点（需要 OWNER 确认）

| #   | 决策项                                           | 推荐                                         | 备选               |
| --- | ------------------------------------------------ | -------------------------------------------- | ------------------ |
| D1  | 是否在 PR1 中同时修 BaseSkill（虽然生产 0 调用） | ✅ 推荐：顺手改，5 行代码 0 风险，未来有价值 | 跳过               |
| D2  | PR2 召回过滤是否保留                             | ✅ 推荐：保留（双重防御 + LLM context 干净） | 删除（单一真相源） |
| D3  | STRICT_OUTPUT_VALIDATION 默认值                  | ✅ 推荐：默认 false，env=1 才开              | 默认 true          |
| D4  | 是否合并到本地 main 后再做 PR2                   | ✅ 推荐：先 merge PR1（24h soak），再 PR2    | PR1+PR2 一次合     |

---

## 9. 沉淀与跟踪

### 9.1 Memory 候选项

建议沉淀以下 project memory 供后续追踪：

```markdown
project: tools-skills-mechanism-audit-2026-04-30

- BaseAgent.callTool（base-agent.ts:328）= 真正的 P0 绕过路径，被 reactive-agent + plan-agent 路由调用
- BaseSkill.callTool（base-skill.ts:319）= 生产 0 调用，是历史遗留的"准备好但没用"
- requiredEntitlements 全库仅 image-generation 一个工具声明，但 ToolACL 单点检查的反模式已经存在
- 双 SkillRegistry（ai-engine + ai-harness/kernel）并存的根因是 ReAct loop 早期独立设计，PR5 收敛
- jest 必须加 modulePathIgnorePatterns: ['.claude/worktrees']，否则会污染 office 13 个 spec
```

### 9.2 后续审计

| 时点            | 检查项                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| PR1 合并后 1 周 | staging 看 STRICT_OUTPUT_VALIDATION=1 时 image-generation / agent-handoff 是否真挂；若挂则修 schema |
| PR1 合并后 2 周 | prod 灰度开启 STRICT_OUTPUT_VALIDATION=1                                                            |
| PR2 合并后 1 周 | 监控 PermissionMiddleware entitlement_denied 日志频次，观察是否有 false positive                    |
| 季度审计        | 重跑此 12 项缺陷清单，统计已闭环数量                                                                |

---

## 10. 附录：测试基线（2026-04-30 实测）

### 10.1 Tools 层

```
npx jest "src/modules/ai-engine/tools/categories" --coverage
→ 67 suites / 1725 tests passed
→ Statements 93.33% / Branches 80.92% / Functions 93.45% / Lines 94.12%
→ 16/58 工具达到 100% lines

最低覆盖工具（< 90% lines）:
  cloud-storage    85.1%  br=61.9%
  pubmed-search    86.0%  br=69.8%
  finance-api      86.3%  br=63.9%
  openalex-search  86.7%  br=72.9%
  message-push     86.8%  br=70.6%
  arxiv-search     87.4%  br=54.5%
  task-delegation  88.5%
  user-preferences 88.9%
  whitehouse-news  89.2%
  data-validation  89.2%
```

### 10.2 Skills 层

```
ai-engine/skills/**/*.ts:
  → 628 tests / 15 suites passed
  → lines 96.6% / branches 87.9% / functions 95.5% / LOC 1367

ai-harness/kernel/skills/*.ts:
  → 52 tests / 6 suites passed
  → lines 98.0% / branches 78.4% / functions 97.7% / LOC 151

ai-app/office/slides/skills/*.skill.ts (排除 worktree 后):
  → 769 tests / 26 suites passed
  → lines 91.8% / branches 76.4% / functions 95.3% / LOC 3730
  → 5 个 skill < 90%（slide-visual-validator 54.8% 是 P1 短板）

Frontmatter 合规度:
  → 94/94 SKILL.md 100% 有 YAML frontmatter
  → SkillLoader.parser 强解析，缺失即拒绝注册
```

---

**审计版本**: v1.0
**审计执行人**: Claude（双 sub-agent 并行 + 主 Agent 综合）
**下一次审计**: PR1 + PR2 合并后 1 周

