# Agent Loop + Skill 体系 vs Anthropic Managed Agent 差距审计

**审计日期**: 2026-04-30
**审计范围**: ai-harness/execution、ai-harness/kernel、ai-harness/process、ai-engine/skills、ai-engine/tools、ai-app/agent-playground

---

## Section 1: Agent Loop 维度

### 已对齐能力

- **ReActLoop** (`execution/loop/react-loop.ts:136-1469`)：parallel_tool_call、iteration_progress 事件、AbortSignal 取消、`maxIterations` + `maxIterationsHardCap` 双重限制（researcher.agent.ts:114 设 hardCap=10）
- **`maxWallTimeMs`** 超时（默认 300s，spec 级覆盖）
- **`outputSchemaValidator` + `validateBusinessRules`** 内容驱动退出闸（`react-loop.ts:168-171`，finalize 时不达标注入 critique 继续）
- **BudgetAccountant**：70% 触发降级，100% abort，runtimeEnv fallback hint（`react-loop.ts:285-343`）
- **ToolCircuitBreaker**：同 toolId 连续 3 次失败熔断（`react-loop.ts:209`）
- **ContextCompactor**：token > 8000 触发 LLM 摘要压缩
- **多 loop 类型**：ReflexionLoop（passThreshold=60，maxRevisions=2）、PlanActLoop、LeaderWorkerLoop

### 关键差距

**差距 1：没有 `stop_when` 语义回调**

Anthropic 的 `stop_when: (result) => bool` 让业务方用纯函数描述"产物足够好了"。我们的等价物 `outputSchemaValidator` + `validateBusinessRules` 只在 LLM 主动 `finalize` 时触发，无法在 loop 中途任意轮次检查中间状态，且不是 spec class 一等公民。

证据：`kernel/abstractions/agent-loop.interface.ts:32-38`，`ILoopTerminationCriteria` 无 `stopWhen` 字段。

**差距 2：没有 mid-loop interrupt（human-in-the-loop 暂停点）**

- `HumanInLoopPause` 异常（`mission-orchestrator.ts:142`）只是业务异常，不是 ReActLoop 一等公民
- `CheckpointService.pause/resume` 存在（`checkpoint-store.interface.ts:19`），但未接通 ReActLoop 内部
- `PreToolUse` hook 可 `block`，近似工具级拦截，但不是"运行中暂停等批准后继续"

证据：`react-loop.ts:218-866` 的 while 循环无任何 `human_input_required` pause point。

**差距 3：context compaction 是被动触发**

- 触发阈值固定 8000 token，不感知模型 context window
- 压缩本身又消耗 LLM 调用
- 无 sliding-window / token-aware 精确控制

**差距 4：tool error retry 是 loop 级全局**

- 熔断阈值 `TOOL_CIRCUIT_THRESHOLD=3` 不可按工具配置
- 无指数退避

---

## Section 2: Skill 体系维度

### 已对齐能力

- **SKILL.md 格式**：`skill-parser.ts:36-44` YAML frontmatter + Markdown body 完整解析，支持 `name/description/version/tags/allowedTools/activateFor`
- **SkillLoader**：`onModuleInit` 扫描 `built-in/` 自动注册
- **SkillActivator**：注入 high-priority reminder（`skill-activator.ts:69-74`）
- **SkillRegistry**：按名索引，`listForRole()` / `listByTag()` / `describeForLLM()`
- **2 个内置 SKILL.md**：`web-research`、`critical-review`

### 关键差距

**差距 1：未实现 progressive disclosure（最严重）**

Anthropic SKILL.md 核心是 progressive disclosure：LLM 先看 description，发现需要时再读 body。我们的 `SkillActivator.activate()` 全量注入完整 instructions：

```ts
// skill-activator.ts:71-73
current.withReminder(
  `## Skill: ${skill.frontmatter.name}\n${skill.instructions}`,
  "high",
);
```

`skill-loader.ts` 在 boot 时就把整个 `body.trim()` 存进 `ISkill.instructions`（`skill-parser.ts:42`），无 lazy-load 机制。**Token 浪费 + 注意力稀释**。

**差距 2：playground 18 份 duty.md 完全绕过 SkillRegistry**

- 所有 playground agent 的 `@DefineAgent.skills` 字段为空（leader/researcher/reconciler/writer 全部）
- 唯一例外：`analyst.agent.ts:93` 声明 `skills: ["critical-review"]`
- playground 自己手搓 `duty-loader.ts`：`loadDuty(agentDir, dutyName)` 直接从 `agents/<dir>/duties/<name>.md` 加载 vanilla Markdown
- 18 份 duty.md（leader 4 / writer 6 / researcher 1 / reconciler 1 / analyst 1 等）**没有 frontmatter、未注册、无版本管理、无 activateFor**

**结论**：duty.md 是平行体系，与 SkillRegistry 互不相知。

**差距 3：subagent 不继承父 agent 的 skills**

`SubagentSpawner.spawn()`（`subagent-spawner.ts:78-88`）子 agent system prompt 来自 `spec.identity.toSystemPrompt()`，未透传父 envelope 的 activeSkills。`WorktreeIsolation.derive()`（`worktree-isolation.ts:47`）只传 tools，无 skills。

---

## Section 3: Subagent / Tool 维度

### 已对齐能力

| Anthropic                   | 我们                                                                                      | 证据                          |
| --------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| `Task(description, prompt)` | `ISubagentSpec.name + prompt`                                                             | `subagent.interface.ts:17-32` |
| `isolation: "worktree"`     | `SubagentIsolation: "none"\|"context"\|"worktree"`                                        | `subagent.interface.ts:14`    |
| `PreSubagentSpawn` hook     | `subagent-spawner.ts:47-65`                                                               | ✓                             |
| ToolInvoker hook 拦截       | PreToolUse + PostToolUse 完整（`react-loop.ts:1246-1303`），parallel 路径每 call 独立触发 | ✓                             |
| `allow` / `deny`            | `allowedTools` / `forbiddenTools` 白/黑名单                                               | `tool-invoker.ts:132-172`     |

### 关键差距

**差距 1：worktree isolation 不含真实 git worktree**

`worktree-isolation.ts:4-8` 注释明确："Phase 4 实现：session/memory 级隔离（不真开 git worktree，那部分在未来与 Sandbox 集成时引入）"。仅 context 隔离，非文件系统隔离。

**差距 2：`subagent_spawn` action 被系统 prompt 禁用**

`react-loop.ts:129-132`：

```
// Only the 3 action kinds above are supported. Do NOT emit "skill_invoke",
// "subagent_spawn", or "llm_generate" — these are reserved internals.
```

LLM 无法主动 spawn subagent，仅框架可调。这与 Claude Agent SDK 中 LLM 主动调用 `Task()` tool 形态根本不同。

**差距 3：缺 `subagent_type` 预置模板**

Anthropic 的 `Task()` 有 `subagent_type`（coder/reviewer/custom）对应模板。我们 `ISubagentSpec` 只有 `name + identity + prompt + isolation + budget`，无类型枚举。

**差距 4：权限 `ask` 级别未实现**

`hook.interface.ts:34-41` 的 `HookPayloadMap` 中 `PreToolUse` 返回只有 `block/allow`，无 `ask`。`HumanApprovalTool` 存在，但是 LLM 主动调用的工具，不是权限层的 ask 级别。

---

## Section 4: 能力差距矩阵

| Anthropic 能力                    | 我们现状                            | 差距   | 优先级 | 工作量  |
| --------------------------------- | ----------------------------------- | ------ | ------ | ------- |
| ReAct loop 内置                   | ReActLoop 完整 + parallel_tool_call | 接近   | —      | —       |
| max_turns                         | maxIterations + hardCap 双重        | 接近   | —      | —       |
| stop_when 回调                    | 仅 finalize 时 validator            | 部分   | P2     | 小      |
| mid-loop human interrupt          | HumanInLoopPause 异常未接通 loop    | 部分   | P1     | 中 3-5d |
| auto context compaction           | 主动调用，固定 8000 阈值            | 部分   | P2     | 中      |
| tool error retry                  | loop 级全局，不可工具级配置         | 接近   | —      | —       |
| tool circuit breaker              | 阈值 3 全局不可配                   | 接近   | —      | —       |
| SKILL.md 文件型                   | 格式完整，2 个内置                  | 接近   | —      | —       |
| progressive disclosure            | **未实现，全量注入**                | **无** | **P1** | 小 2-3d |
| subagent skill 继承               | 未实现                              | 无     | P2     | 小      |
| **playground duty.md → SKILL.md** | **18 份绕过 Registry**              | **无** | **P1** | 大 1-2w |
| Task() LLM 主动 spawn             | action 被系统 prompt 禁用           | 部分   | P2     | 中      |
| 真实 git worktree isolation       | 仅 session 级                       | 部分   | P3     | 大      |
| tool 权限 allow/ask/deny          | allow/deny 有，ask 缺               | 部分   | P2     | 中      |
| subagent_type 预置模板            | 无                                  | 无     | P3     | 中      |

### 三个最该立即处理的 P1

1. **progressive disclosure**：`SkillActivator` 改为先注入 `frontmatter.description`，LLM thinking 提到 skill 名时再注入 body。**2-3 天，token 立省**
2. **playground duty.md 标准化**：18 份 duty.md 加 YAML frontmatter，注册到 SkillRegistry，agent `@DefineAgent.skills` 声明依赖。**1-2 周，统一架构**
3. **mid-loop interrupt**：`agent-loop.interface.ts` 加 `pauseSignal?: { paused: boolean }`，loop 每轮检查并 yield `human_input_required` 事件。**3-5 天，解锁 human-in-the-loop**
