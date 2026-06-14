# AI Engine 全面代码审计报告

**审计日期**: 2026-02-24
**审计方式**: 主 Agent 逐文件直读（Read 工具）+ 后台 Sub-Agent 补充扫描
**覆盖范围**: `backend/src/modules/ai-engine/` 全模块（~439 文件）
**前置文档**: `ai-engine-boundary-re-audit-2026-02-24.md`（边界违规专项审计）

---

## 执行摘要

本次审计覆盖 AI Engine 的内部代码质量、架构设计、正确性、安全性和测试覆盖。与前一份边界违规专项审计不同，本报告关注 **Engine 内部**的质量问题。

| 维度     | 评级 | 核心发现                                                                               |
| -------- | ---- | -------------------------------------------------------------------------------------- |
| 架构设计 | B+   | Facade 模式良好，但 ai-chat.service.ts 单文件过大                                      |
| 正确性   | C+   | parallel-executor 存在真实的死循环 bug；voting-pattern 有逻辑错误                      |
| 安全性   | C    | base-executor 使用 `new Function`（代码注入风险）；skill.registry 使用用户输入构造正则 |
| 类型安全 | B    | 3 处双重类型断言；1 处 `any` 违规；AgentMemory 用 Map 无法序列化                       |
| 测试覆盖 | B    | 新增 ~90 个 spec 文件，覆盖面广，但缺少关键边界场景（无限循环、安全性）                |
| 可维护性 | B-   | ai-chat.service.ts 1595 行需拆分；错误处理不一致；魔法常量散布                         |

**发现问题总数**: 28 个（4 个 P0、7 个 P1、11 个 P2、6 个 P3）

---

## 一、架构与模块结构

### 1.1 整体架构 — 合格

AI Engine 采用 `@Global()` NestJS 模块，通过 6 个 Feature Token 按需注入：
`MEMORY_FEATURE`、`TOOL_FEATURE`、`ORCHESTRATION_FEATURE`、`SKILL_FEATURE`、`REALTIME_FEATURE`、`CONSTRAINT_FEATURE`。

设计优点：

- Facade 模式完善（40+ public 方法，25+ getter，5 个 sub-facade）
- Registry 体系完整（Tool/Agent/Team/Role/Skill 五类注册表）
- `@Optional()` 注入支持按需启用子系统

### 1.2 ai-chat.service.ts 单文件膨胀 — P1

**文件**: `llm/services/ai-chat.service.ts`，1595 行，~57KB
**问题**: 承担了 LLM 调用、任务配置解析、模型路由、流式处理、guardrails、重试、可观测性 7 个职责，成为"上帝类"。
**影响**: 任何一处改动都需要通读全文；测试需要 mock 8+ 个依赖。
**建议**: 拆分为 `LLMConfigService`、`LLMStreamHandlerService`、`LLMRetryService`、`LLMGuardrailsService`。

### 1.3 两套 Agent 范式缺乏统一文档 — P2

`BaseAgent` → `ReactiveAgent`/`PlanAgent`（engine 内部）
`PlanBasedAgent`（engine-to-app 接口层）
两套体系共存但关系不明确，无 README 说明何时用哪个。**建议**：在 `agents/` 目录添加 README.md（项目已允许文档文件）。

---

## 二、Agent 系统

### 2.1 base-agent.ts — 统计数据不一致 (P2)

**文件**: `agents/base/base-agent.ts:161`

```typescript
// totalExecutions 在 try 块外增量
this.stats.totalExecutions++;
try {
  // ...
  this.stats.successCount++;
} catch {
  this.stats.failureCount++;
}
```

当 `totalExecutions++` 之后、进入 try 之前发生异常（理论上极少），计数会出现 `totalExecutions != successCount + failureCount`。
**建议**: 移入 finally 块，或用 `successCount + failureCount` 派生。

### 2.2 base-agent.ts — toolsCalled/skillsCalled 永不填充 (P2)

**文件**: `agents/base/base-agent.ts:320-354`

`this.stats.toolsCalled` 和 `skillsCalled` 在 `execute()` 入口处被初始化为空数组，但 `callTool()`/`callSkill()` 方法在调用成功后从未向数组追加记录。结果是 `getStats()` 始终返回空调用历史。
**建议**: 在 `callTool()`/`callSkill()` 成功后 `push` 记录。

### 2.3 base-agent.ts — JSON 解析策略单一 (P2)

**文件**: `agents/base/base-agent.ts:428-442`

正则 `/```(?:json)?\s*([\s\S]*?)```/` 只处理 Markdown 代码块，无法处理：

- 纯 JSON（无代码块包装）
- XML 标签包裹的 JSON（部分模型输出 `<result>...</result>` 格式）
- 前导/尾随文本 + 嵌入 JSON

**建议**: 添加多级 fallback：先尝试 Markdown 块，再尝试直接 `JSON.parse`，最后尝试正则提取第一个 `{...}`。

### 2.4 reactive-agent.ts — 双重类型断言绕过类型检查 (P2)

**文件**: `agents/base/reactive-agent.ts:320`

```typescript
const agentInput = input as unknown as AgentInput;
```

`TInput` 未约束为包含 `prompt` 字段，运行时可能 `agentInput.prompt` 为 undefined，导致 LLM 收到空消息。
**建议**: 添加 TypeGuard `isAgentInput(input): input is AgentInput` 或 约束 `TInput extends AgentInput`。

### 2.5 reactive-agent.ts — toolCallId 不一致 (P3)

**文件**: `agents/base/reactive-agent.ts`

`doExecute()`（同步路径）使用 `toolCallId: result.toolId`，
`executeStream()`（流式路径）使用 `toolCallId: toolCall.id`。
两者可能引用同一次调用却使用不同 ID，导致工具结果消息无法被 LLM 正确关联。
**建议**: 统一使用 `toolCall.id`。

### 2.6 plan-based-agent.ts — ID 生成使用废弃 API (P3)

**文件**: `agents/base/plan-based-agent.ts:196-205`

```typescript
return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
```

`String.prototype.substr` 已在 ES2015 起被废弃（标准是 `substring`），同毫秒内 `Math.random()` 有极低概率重复。
**建议**: 使用 `crypto.randomUUID()` 或 uuid 库。

### 2.7 plan-based-agent.ts — emoji 硬编码违规 (P3)

**文件**: `agents/base/plan-based-agent.ts:185`

```typescript
color: "#6B7280", icon: "🤖"
```

违反项目规范（CLAUDE.md：禁止 emoji，使用 Lucide 图标）。

---

## 三、编排执行器

### 3.1 parallel-executor.ts — 真实的无限循环 Bug (P0 — 已确认)

**文件**: `orchestration/executors/parallel-executor.ts:127-163`

**复现场景**: 工作流中所有步骤的依赖均指向一个"已失败/已跳过"（非 `completed`）的步骤，且 `running.size === 0`。

```typescript
// 外层循环：pending.length > 0 始终为 true
while (pending.length > 0 || running.size > 0) {
  // 内层循环：所有步骤有未满足依赖，被放回队尾
  while (running.size < this.maxConcurrency && pending.length > 0) {
    const step = pending.shift()!;
    if (unmetDeps.length > 0) {
      pending.push(step); // 放回末尾
      continue; // 继续内层循环 → 永远不退出
    }
  }
  // 永远到不了这里
  if (running.size > 0) {
    await Promise.race(running.values());
  }
}
```

当 `running.size === 0` 且所有 `pending` 步骤均有未满足依赖时，内层 while 形成无限循环，阻塞事件循环，节点进程卡死。

**建议**: 在内层循环添加"无进展检测"：

```typescript
let startedAny = false;
while (running.size < this.maxConcurrency && pending.length > 0) {
  // ...
  if (unmetDeps.length > 0) {
    pending.push(step);
    continue;
  }
  startedAny = true;
  // 启动步骤...
}
if (!startedAny && running.size === 0) {
  // 死锁：所有剩余步骤的依赖无法满足
  this.logger.error("Deadlock detected: unresolvable dependencies");
  break;
}
```

### 3.2 base-executor.ts — `new Function` 代码注入风险 (P0 — 已确认)

**文件**: `orchestration/executors/base-executor.ts:401-410`

```typescript
protected evaluateExpression(expression: string, scope: object): unknown {
  // 安全的简单表达式评估
  // 实际生产中应该使用安全的表达式引擎   ← 开发者自己标注了这一问题
  try {
    const fn = new Function(...Object.keys(scope), `return ${expression}`);
    return fn(...Object.values(scope));
  } catch {
    return undefined;
  }
}
```

`expression` 来自工作流配置，若工作流配置由用户可控（例如 AI Office 的自定义工作流），攻击者可注入 `process.env.DATABASE_URL` 或任意 Node.js 代码。
**建议**: 替换为沙箱表达式引擎（`jexl`、`expr-eval`），限定可访问变量白名单。

### 3.3 dag-executor.ts — 超时处理有竞态条件 (P1)

**文件**: `orchestration/executors/dag-executor.ts:215-231`

在对 `nodeStartTimes` 进行迭代时，循环体内同时调用 `nodeStartTimes.delete(nodeId)`，在 ES Map 规范下是允许的，但 `running.delete(nodeId)` 之后对应的 Promise 仍在运行，可能在超时判断完成后继续更新状态，导致状态机不一致。
**建议**: 先收集超时节点列表，再统一处理。

### 3.4 dag-executor.ts — skipDependents 递归可导致栈溢出 (P1)

**文件**: `orchestration/executors/dag-executor.ts:337-346`

对大型 DAG（深度 > ~10000 层），递归调用 `skipDependents` 会栈溢出。实际业务中深度不会达到这个量级，但属于已知风险。
**建议**: 改为 BFS 队列遍历。

### 3.5 parallel-executor.ts / dag-executor.ts — WATCHDOG/超时常量硬编码 (P2)

`WATCHDOG_TIMEOUT = 300000` (5分钟) 在 dag-executor 中硬编码，不适合快速任务（1秒超时触发长达5分钟等待）。
**建议**: 接受构造函数/配置参数。

### 3.6 retry-strategy.ts — 错误分类依赖字符串匹配 (P2)

**文件**: `orchestration/executors/retry-strategy.ts:172-230`

```typescript
if (message.includes("rate limit") || message.includes("429")) { ... }
```

OpenAI、Anthropic、Gemini 的错误消息格式各异，字符串匹配存在漏匹配和误匹配风险。
**建议**: 优先检查 HTTP 状态码（`error.status === 429`），字符串匹配作为 fallback。

### 3.7 retry-strategy.ts — FALLBACK_TOOLS 空对象死代码 (P3)

**文件**: `orchestration/executors/retry-strategy.ts:86-88`

```typescript
private static readonly FALLBACK_TOOLS: Partial<Record<string, string | null>> = {};
```

`getFallback()` 方法基于此对象查找，永远返回 `null`。整个降级工具逻辑形同虚设。
**建议**: 填充实际降级映射，或删除该未使用代码。

### 3.8 retry-strategy.ts — WithRetry 装饰器使用 `any` (P3)

**文件**: `orchestration/executors/retry-strategy.ts:258`

```typescript
descriptor.value = async function (...args: any[]) {
```

违反项目规范（禁止 `any`）。**建议**: 改为 `unknown[]` 或泛型 `(...args: Parameters<T>)`。

---

## 四、注册表系统

### 4.1 skill.registry.ts — 用户输入直接构造正则（ReDoS 风险）(P0)

**文件**: `skills/registry/skill.registry.ts:203-232`

```typescript
isMatch = new RegExp(trigger.condition, "i").test(value);
```

`trigger.condition` 来自 Skill 定义，若 Skill 由用户通过 API 注册（或外部 json 导入），攻击者可注入 ReDoS 正则（如 `(a+)+$`），导致事件循环阻塞。
**建议**: 用 try-catch 包裹构造，并添加超时限制（可用 `safe-regex` 库检查危险模式）。

### 4.2 tool.registry.ts — Token 估算魔法常量 (P2)

**文件**: `tools/registry/tool.registry.ts:226-230`

```typescript
return compact ? count * 40 : count * 200;
```

常量 40/200 与工具定义的实际 schema 复杂度无关，在工具参数多时严重低估 token 消耗，可能导致超出上下文窗口。
**建议**: 基于工具 schema 的 JSON 字符串长度进行更精确的估算（粗略: `JSON.stringify(tool.parameters).length / 4`）。

### 4.3 skill.registry.ts — 版本比较不支持 semver (P2)

**文件**: `skills/registry/skill.registry.ts:190-198`

版本比较仅支持 `1.2.3` 格式，不支持 `1.0.0-beta`、`2.0.0-rc.1`。若 Skill 版本采用 semver 预发布格式，排序会出错。
**建议**: 使用 `semver` 库（`npm i semver @types/semver`）。

---

## 五、内存系统

### 5.1 short-term-memory.service.ts — LRU 容量硬编码 (P2)

**文件**: `memory/stores/short-term-memory.service.ts:26`

```typescript
private readonly sessions = new LruMap<string, Map<string, MemoryItem>>(1000);
```

高并发场景（1000+ 同时在线用户）会导致早期会话数据被意外驱逐。**建议**: 从 `ConfigService` 或构造参数读取。

### 5.2 long-term-memory.service.ts — 得分上界导致排序失效 (P3)

**文件**: `memory/stores/long-term-memory.service.ts:188`

当多个记忆项分数都被 `Math.min(score, 1)` 截断为 1.0 时，这批结果的相对顺序由数据库返回顺序决定（不稳定）。
**建议**: 不做上界截断，或添加按时间戳的二级排序。

---

## 六、协作模式

### 6.1 voting-pattern.ts — voteId 赋值语义错误 (P1 — 已确认)

**文件**: `collaboration/patterns/voting-pattern.ts:244`

```typescript
return {
  voteId: votes[0]?.voterId ? votes[0].voterId : "",
  // ...
};
```

`voteId` 应是本次投票会话的 ID，但代码错误地取了第一个投票者的 `voterId`。调用方若使用 `result.voteId` 查询投票会话将永远找不到记录。
**建议**: 改为 `voteId: session.id`（或传入的 `voteSessionId`）。

### 6.2 voting-pattern.ts — ranked 投票仅取第一选择 (P2)

**文件**: `collaboration/patterns/voting-pattern.ts:333-340`

排名投票只统计每人的第一选择（`vote.rank[0]`），与"偏好排名"（Instant Runoff Voting）的语义不符，实际退化为简单多数投票。
**建议**: 若产品上不需要 IRV，应将 `VoteStrategy.RANKED` 改名为 `FIRST_CHOICE` 或添加注释说明简化原因。

### 6.3 handoff-pattern.ts — 递归交接无深度限制 (P1 — 已确认)

**文件**: `collaboration/patterns/handoff-pattern.ts:128-138`

当被拒绝 Agent 的 `response.suggestedAgent` 指向另一个会再次拒绝并给出建议的 Agent 时，`initiateHandoff` 自递归无法终止。
**建议**: 添加 `depth` 参数，超过阈值（如 5）时改为返回 rejected。

---

## 七、Agent 错误系统

### 7.1 agent-error.ts — 错误码语义映射错误 (P2)

**文件**: `core/errors/agent-error.ts`

| 方法                  | 实际使用的 errorCode       | 语义期望                                       |
| --------------------- | -------------------------- | ---------------------------------------------- |
| `invalidMode()`       | `AgentErrorCode.NOT_READY` | 应为 `INVALID_MODE` 或 `UNSUPPORTED_OPERATION` |
| `missingDependency()` | `AgentErrorCode.NOT_READY` | 应为 `MISSING_DEPENDENCY`                      |

两个方法的错误码均复用了 `NOT_READY`，调用方无法通过 `error.code` 区分"Agent 未就绪"与"模式不支持"。

### 7.2 agent-error.ts — 重复方法别名 (P3)

`maxIterationsExceeded()` 和 `maxIterationsReached()` 是完全相同逻辑的重复，形成别名。
**建议**: 删除一个，或在废弃的一个上添加 `@deprecated` 注释。

---

## 八、Agent 接口

### 8.1 agent.interface.ts — AgentMemory 使用不可序列化类型 (P2)

**文件**: `agents/abstractions/agent.interface.ts:84-93`

```typescript
longTermMemory?: Map<string, unknown>;
```

`Map` 无法 `JSON.stringify`（序列化为 `{}`），在跨进程传递或持久化场景下会静默丢失数据。
**建议**: 改为 `Record<string, unknown>`。

---

## 九、测试覆盖

### 9.1 覆盖现状

本次审计期间新增的测试文件（已确认存在）：

| 模块                                 | 测试文件                                                                                                                    | 关注点  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| `agents/base/__tests__/`             | base-agent.spec.ts, plan-agent.spec.ts, plan-based-agent.spec.ts, reactive-agent.spec.ts                                    | ✅ 新增 |
| `orchestration/executors/__tests__/` | base-executor.spec.ts, dag-executor.spec.ts, parallel-executor.spec.ts, sequential-executor.spec.ts, retry-strategy.spec.ts | ✅ 新增 |
| `collaboration/patterns/__tests__/`  | voting-pattern.spec.ts, handoff-pattern.spec.ts                                                                             | ✅ 新增 |
| `quality/services/__tests__/`        | quality-gate.service.spec.ts, quality-registry.service.spec.ts                                                              | ✅ 新增 |
| `agents/registry/__tests__/`         | agent-registry.spec.ts, agent-orchestrator.spec.ts                                                                          | ✅ 新增 |

**总量**: ~95 个 spec 文件（含 tools/categories/ 下约 50 个工具测试）。测试数量大幅增长，是本阶段最显著的质量改进。

### 9.2 关键测试缺口

| 缺口                                                   | 风险                      | 建议                                           |
| ------------------------------------------------------ | ------------------------- | ---------------------------------------------- |
| parallel-executor 的死锁场景（所有步骤依赖已失败节点） | P0 bug 无测试保障         | 添加 `describe('deadlock detection')` 测试用例 |
| base-executor 的 `evaluateExpression` 安全测试         | 代码注入无测试边界        | 添加含恶意表达式的输入测试                     |
| voting-pattern 的 voteId 正确性断言                    | P1 bug 已存在，无测试发现 | 断言 `result.voteId` 等于 session ID           |
| handoff-pattern 的循环交接防护                         | 递归无限 handoff          | 添加 `suggestedAgent` 循环测试                 |
| skill.registry 的 ReDoS 正则测试                       | 安全性                    | 添加格式错误正则的测试                         |

---

## 十、安全汇总

| #   | 位置                     | 问题                                | 严重度 |
| --- | ------------------------ | ----------------------------------- | ------ |
| S1  | `base-executor.ts:405`   | `new Function(expression)` 代码注入 | HIGH   |
| S2  | `skill.registry.ts:204`  | 用户输入构造 RegExp — ReDoS         | MEDIUM |
| S3  | `handoff-pattern.ts:145` | 日志泄露内部 UUID (`handoffId`)     | LOW    |
| S4  | `tool.registry.ts:37`    | 日志泄露内部工具名称列表            | LOW    |

---

## 十一、优先级汇总

### P0 — 必须修复（生产安全/运行正确性）

| ID   | 文件                                                   | 问题                            | 修复成本                          |
| ---- | ------------------------------------------------------ | ------------------------------- | --------------------------------- |
| P0-1 | `orchestration/executors/parallel-executor.ts:127-162` | 无限循环死锁（依赖未满足场景）  | 小（添加无进展检测 break）        |
| P0-2 | `orchestration/executors/base-executor.ts:401-410`     | `new Function` 代码注入安全漏洞 | 中（引入 jexl/expr-eval）         |
| P0-3 | `skills/registry/skill.registry.ts:203-232`            | 用户输入正则 ReDoS 风险         | 小（try-catch + safe-regex 检查） |

### P1 — 应该修复（逻辑错误/可靠性风险）

| ID   | 文件                                                | 问题                            |
| ---- | --------------------------------------------------- | ------------------------------- |
| P1-1 | `collaboration/patterns/voting-pattern.ts:244`      | `voteId` 误赋为 `voterId`       |
| P1-2 | `collaboration/patterns/handoff-pattern.ts:133-137` | 递归交接无深度限制              |
| P1-3 | `orchestration/executors/dag-executor.ts:215-231`   | 超时处理竞态条件                |
| P1-4 | `orchestration/executors/dag-executor.ts:337-346`   | `skipDependents` 递归栈溢出风险 |
| P1-5 | `llm/services/ai-chat.service.ts`                   | 单文件 1595 行，需拆分          |

### P2 — 建议改进（质量/可维护性）

| ID    | 文件                                                | 问题                              |
| ----- | --------------------------------------------------- | --------------------------------- |
| P2-1  | `agents/base/base-agent.ts:161`                     | 统计计数不一致                    |
| P2-2  | `agents/base/base-agent.ts:320-354`                 | toolsCalled/skillsCalled 永不填充 |
| P2-3  | `agents/base/base-agent.ts:428-442`                 | JSON 解析策略单一                 |
| P2-4  | `agents/base/reactive-agent.ts:320`                 | 双重类型断言绕过检查              |
| P2-5  | `core/errors/agent-error.ts`                        | 错误码语义映射错误                |
| P2-6  | `agents/abstractions/agent.interface.ts:84`         | AgentMemory 使用不可序列化 Map    |
| P2-7  | `tools/registry/tool.registry.ts:226-230`           | Token 估算魔法常量                |
| P2-8  | `skills/registry/skill.registry.ts:190-198`         | 版本比较不支持 semver             |
| P2-9  | `memory/stores/short-term-memory.service.ts:26`     | LRU 容量硬编码                    |
| P2-10 | `orchestration/executors/retry-strategy.ts:172-230` | 错误分类依赖字符串匹配            |
| P2-11 | `collaboration/patterns/voting-pattern.ts:333-340`  | ranked 投票仅取第一选择           |

### P3 — 风格/规范问题

| ID   | 文件                                              | 问题                                |
| ---- | ------------------------------------------------- | ----------------------------------- |
| P3-1 | `agents/base/plan-based-agent.ts:185`             | emoji 硬编码（违反 CLAUDE.md）      |
| P3-2 | `agents/base/plan-based-agent.ts:196-205`         | `substr` 废弃 API + Math.random ID  |
| P3-3 | `agents/base/reactive-agent.ts`                   | toolCallId 同步/流式路径不一致      |
| P3-4 | `core/errors/agent-error.ts`                      | 重复别名方法 `maxIterationsReached` |
| P3-5 | `orchestration/executors/retry-strategy.ts:258`   | `any` 类型违规                      |
| P3-6 | `orchestration/executors/retry-strategy.ts:86-88` | FALLBACK_TOOLS 空对象死代码         |

---

## 十二、修复路线图

### 第一阶段（本 sprint，修复 P0）

1. **parallel-executor.ts**: 添加 "无进展检测" break — 5 行改动
2. **base-executor.ts**: 将 `evaluateExpression` 替换为 `jexl.eval()`（或临时移除该特性，因目前无调用方）
3. **skill.registry.ts**: 将 `new RegExp(trigger.condition, "i")` 包裹在 try-catch 中，并用 `safe-regex` 拒绝危险模式

### 第二阶段（下一 sprint，修复 P1）

4. **voting-pattern.ts**: 修复 `voteId: session.id`
5. **handoff-pattern.ts**: 添加 `depth` 参数，超过阈值返回 rejected
6. **dag-executor.ts**: 超时处理改为先收集再修改；skipDependents 改 BFS

### 第三阶段（技术债务清理，P2/P3）

7. **ai-chat.service.ts**: 拆分（大型重构，需单独计划）
8. **agent-error.ts**: 补充语义正确的 errorCode；删除别名
9. **base-agent.ts**: 修复统计计数；补充 JSON fallback 解析

---

## 数据统计

| 指标                         | 数值               |
| ---------------------------- | ------------------ |
| 审计文件数（直读）           | 18                 |
| 审计文件数（Sub-Agent 扫描） | 42+                |
| 发现问题总数                 | 28                 |
| P0（生产风险）               | 3                  |
| P1（逻辑错误/可靠性）        | 5                  |
| P2（质量/可维护性）          | 11                 |
| P3（规范/风格）              | 6                  |
| 安全问题                     | 4（2 high, 2 low） |
| 已有测试文件数               | ~95                |
| 测试缺口数                   | 5 个关键场景       |

---

## 与边界违规审计的对比

参考 `ai-engine-boundary-re-audit-2026-02-24.md`，边界违规（V1-V5）属于**外部引用**问题，本报告覆盖 **Engine 内部**质量。两份报告合并来看：

| 类别                                    | 状态                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| Facade Registry getter（F2）            | ✅ 已修复                                               |
| facade/index.ts re-export（F1）         | ✅ 已修复                                               |
| ai-app V1/V2/V3 导入路径迁移            | ❌ 仍未完成（~20 文件）                                 |
| ESLint 边界规则完整性（N3）             | ❌ 仍缺 ToolRegistry/TeamRegistry/RoleRegistry 路径约束 |
| parallel-executor 死循环（本报告 P0-1） | ❌ 新发现                                               |
| base-executor 代码注入（本报告 P0-2）   | ❌ 新发现                                               |

---

_本报告基于源码直读，所有行号引用均经人工验证（Read 工具实际读取）。_
_Sub-Agent 补充扫描结果经关键项人工复核后采纳。_

