# Anthropic Managed Agent 对标审计报告

**审计日期**: 2026-04-30
**审计版本**: 229776ff1
**审计范围**: Hook / Permission / Protocol 三维度对标
**参照基准**: Anthropic Managed Agent（Claude Agent SDK 形态）

---

## 总体结论

| 维度            | 对标完成度 | 关键差距                                                   |
| --------------- | ---------- | ---------------------------------------------------------- |
| Hook 体系       | 75%        | 触发点缺 SessionStart/Stop；无 shell command 执行器        |
| Permission 体系 | 50%        | 只有二级 allow/deny，无 ask 交互流；无用户级覆盖文件       |
| MCP 协议        | 85%        | Client 三种 transport 完整；Server 端缺 stdio transport    |
| A2A 协议        | 70%        | 类型层 Google A2A v0.3；无流式 task 更新；无 JSON-RPC 封装 |

---

## S1 — Hook 维度

### 1.1 事件命名对齐

Anthropic 标准定义六类事件：
`PreToolUse / PostToolUse / UserPromptSubmit / Stop / SessionStart / Notification`

项目定义（`backend/src/modules/ai-harness/kernel/abstractions/hook.interface.ts`，L12-18）：

```
HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PreSubagentSpawn"   ← 项目扩展，无 Anthropic 对应
  | "Stop"
```

**对齐情况**：

- `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `Stop` / `SessionStart` — 命名完全对齐
- `Notification` 事件 — **缺失**。Anthropic 的 Notification 用于向用户推送自定义消息，项目无对应 HookEvent
- `PreSubagentSpawn` — 项目自扩展，是合理增量，Anthropic 标准不含此项

**评分：5/6 事件对齐**

---

### 1.2 触发点覆盖

**PreToolUse / PostToolUse — 已实现，覆盖全面**

触发位置（`backend/src/modules/ai-harness/execution/loop/react-loop.ts`）：

- L1246-1258：单 tool_call 的 PreToolUse dispatch + block 短路
- L1265-1270：单 tool_call 的 PostToolUse dispatch
- L1277-1283：parallel_tool_call 每个子 call 分别触发 PreToolUse（逐个 block）
- L1296-1303：parallel_tool_call 子结果逐个触发 PostToolUse

**PreSubagentSpawn — 已实现**

触发位置（`backend/src/modules/ai-harness/process/subagent/subagent-spawner.ts`，L47-65）：
SubagentSpawner.spawn() 在子 agent 构造前 dispatch，返回 `block=true` 抛 SubagentSpawnBlockedError。

**SessionStart — 已定义，触发点缺失**

HookEvent 类型声明有 `SessionStart`，HookPayloadMap 也有 `{ sessionId: string; userId?: string }` 签名（hook.interface.ts，L35）。但全库扫描中无任何调用点调用 `hookRegistry.dispatch("SessionStart", ...)` 的代码。Session 创建逻辑分散在各 App Controller，未接入 hook 触发。

**Stop — 已定义，触发点缺失**

类似 SessionStart，`HookPayloadMap.Stop` 有 `{ reason: "completed" | "error" | "budget" | "cancelled" }` 签名（hook.interface.ts，L40），但 HarnessedAgent 的 terminated 事件（`harnessed-agent.ts`，L293-311）没有调用 hookRegistry.dispatch("Stop")。Loop 终止时 hook 未触发。

**UserPromptSubmit — 已定义，触发点待确认**

HookPayloadMap 有 UserPromptSubmit 签名，但扫描中未发现实际 dispatch 调用。

**小结**：
| Hook 事件 | 触发点 | block 支持 |
|-----------|-------|-----------|
| PreToolUse | react-loop.ts L1246 | 是 |
| PostToolUse | react-loop.ts L1265 | 不适用 |
| PreSubagentSpawn | subagent-spawner.ts L47 | 是 |
| SessionStart | 无 | — |
| Stop | 无 | — |
| UserPromptSubmit | 无 | — |
| Notification | 未定义 | — |

---

### 1.3 Block 决策机制

`hook.interface.ts` IHookResult 接口（L24-31）：

```typescript
interface IHookResult {
  block?: boolean;
  reason?: string;
  replacePayload?: unknown;
}
```

HookRegistry.dispatch（`hook-registry.ts`，L118-124）正确处理 `block=true`，立即停止链式派发并返回给 caller。

react-loop.ts L1251-1258 正确接收 `pre.block` 短路返回 error result。

**结论：block 决策机制完整，与 Anthropic 标准一致。**

---

### 1.4 Shell Command 执行器（Anthropic 特有）

Anthropic Managed Agent 的 hook 通过 `settings.json` 配置 shell command 触发器：

```json
{ "hooks": { "PreToolUse": [{ "command": "check-policy.sh $TOOL_NAME" }] } }
```

项目的 HookRegistry 采用 **纯 TypeScript 回调注册**（`IHookBinding.handler: HookCallback`，hook.interface.ts L43-47），**无 shell command 执行层**。外部进程无法通过 settings 文件注入 hook 行为。

**差距：无对应实现。**

---

## S2 — Permission 维度

### 2.1 allow/ask/deny 三级体系

Anthropic Managed Agent 支持 `allow / ask / deny` 三级，其中 `ask` 会暂停执行等待用户实时确认（human-in-the-loop）。

项目当前实现为**二级**：

**deny（黑名单）**：`IAgentIdentity.forbiddenTools`（`identity.interface.ts`，L65）。ToolInvoker 强校验，命中抛 `AgentAccessDeniedError`（`tool-invoker.ts`，L75-86，L133-150）。

**allow（白名单）**：`IAgentIdentity.tools`（`identity.interface.ts`，L59）。ToolInvoker 若 allowedTools 非空且不含 toolId 则拒绝（`tool-invoker.ts`，L151-171）。

**ask（交互确认）**：**不存在**。无等待用户审批的机制；PreToolUse hook 的 block 是同步自动决策，非交互式。

---

### 2.2 Permission 粒度

**工具级粒度（tool-level）** — 已实现。forbiddenTools / allowedTools 均为 toolId 字符串列表（`identity.interface.ts`，L59-65）。

**mode 覆盖（default / acceptEdits / plan / bypassPermissions）** — **不存在**。Anthropic 的 mode 概念允许用户在不同操作模式下变更权限策略，项目无对应 mode 枚举和 mode 驱动的权限分支。

---

### 2.3 用户级覆盖（settings.local.json）

Anthropic 允许用户通过 `settings.local.json` 覆盖团队级权限，不入代码库。

项目的 allowedTools / forbiddenTools 硬编码在 agent spec（`kernel/dx/agent-spec.base.ts`，L94），在代码库中版本化，**无运行时用户级覆盖机制**。

`constraint-enforcement.service.ts` 是内容约束（角色规则/时代设定文本检测，L37-120），不是 tool permission 体系，不能类比。

`constraint-profile.ts` 是预算/质量/效率约束配置，同样不是权限模型。

---

### 2.4 Permission 小结

| Anthropic 特性    | 项目现状                       | 差距         |
| ----------------- | ------------------------------ | ------------ |
| deny（黑名单）    | forbiddenTools，工具级，硬校验 | 已对齐       |
| allow（白名单）   | allowedTools，工具级，硬校验   | 已对齐       |
| ask（交互确认）   | 不存在                         | 高优先级差距 |
| mode 切换         | 不存在                         | 中优先级差距 |
| 用户级 local 覆盖 | 不存在                         | 低优先级差距 |
| bypassPermissions | 不存在                         | 低优先级差距 |

---

## S3 — Protocol 维度

### 3.1 MCP Client（ai-harness → 外部 MCP Server）

三种 transport 均已实现：

**stdio**：`StdioMCPClient`（`mcp-client.ts`，L332-416）。spawn child_process + stdin/stdout pipe + JSON-RPC 2.0 行协议，支持 stderr 日志。

**SSE（legacy）**：`SSEMCPClient`（`sse-mcp-client.ts`，L19-215）。POST 发 JSON-RPC，GET 建 SSE 流接收。通过 `endpoint` event 发现 message endpoint，兼容旧版 MCP Server。

**Streamable HTTP（2025-11 规范）**：`StreamableHttpMCPClient`（`streamable-http-mcp-client.ts`，L30-381）。POST 发 JSON-RPC，支持 SSE 响应和 JSON 响应，`Mcp-Session-Id` header 管理 session，指数退避重连，DELETE 终止 session。

`MCPClientFactory`（`mcp-client-factory.ts`）按 transport 类型路由到对应实现。`MCPRelay`（`protocol/mcp/mcp-relay.service.ts`，L57-end）把远端 MCP Server 的 tools 自动注册到 ToolRegistry，tool id 格式 `mcp:<id>/<toolName>`。

**结论：MCP Client 层对标完整，三种 transport 全部实现。**

---

### 3.2 MCP Server（项目作为 Server 向外暴露）

`MCPServerController`（`open-api/mcp-server/mcp-server.controller.ts`）暴露的 transport：

- **POST /mcp**：JSON-RPC 2.0 请求处理（L60-119）
- **GET /mcp**：SSE stream，server push（L145-208），session ID 管理，keepalive 心跳
- **DELETE /mcp**：终止 session（L213-226）

即项目作为 Server 只实现了 **Streamable HTTP**（POST+GET SSE+DELETE），**没有 stdio server 模式**。Anthropic Claude Code 自身以 stdio 模式启动 MCP Server，项目暂不需要此形态，但第三方 MCP Client（如 IDE 插件）可能需要。

`MCPSessionManager`（`gateway/mcp-session-manager.ts`）管理 session 状态，`MCPStreamingBridge`（`streaming/mcp-streaming-bridge.ts`）关联 SSE 连接与 session。

MCP Server 的 `guardrails` 集成（`mcp-server.service.ts`，L65-72）调用 `GuardrailsPipelineService`，但该 guardrail 是内容安全过滤，不是 Anthropic 标准 hook 机制的 Server 侧映射。

---

### 3.3 A2A 协议

**类型定义层**：实现了 Google A2A v0.3 核心类型（`protocol/a2a/a2a.types.ts`）：

- `A2AAgentCard`（能力描述，含 skills/capabilities/authentication）
- `A2ATaskRequest` / `A2ATaskResponse`（任务创建）
- `A2ATaskStatusResponse`（含 history 状态历史）
- `A2ATaskStatus` 枚举（PENDING / RUNNING / COMPLETED / FAILED / CANCELLED）

**暴露面**：`A2AController`（`open-api/a2a-server.controller.ts`）暴露：

- `GET /.well-known/agent.json`：Agent Card 发现（不在当前文件前 80 行，需验证路由）
- `POST /a2a/tasks`：创建任务
- `GET /a2a/tasks/:id`：查询状态

**A2AClientService**（`protocol/a2a/adapter/a2a-client.service.ts`）：HTTP polling 客户端，`pollTaskUntilComplete` 用轮询（2s \* 150次），**无流式 task 状态订阅**。

**差距**：

1. A2A 规范推荐流式 task 更新（SSE 或 webhook），项目用轮询（`a2a-client.service.ts`，L121-149）
2. 项目 A2A Server 不使用 JSON-RPC 2.0 封装（直接 REST），而 Google A2A v0.3 推荐 JSON-RPC 包装
3. 无 `streaming` capability 的 SSE 端点（A2AAgentCard.capabilities.streaming=true 但无对应 GET /a2a/tasks/:id/stream）
4. `A2AModule`（`protocol/a2a/a2a.module.ts`，L27-53）通过 DI token 接入 TeamsService，只支持 Team-based skill，不支持单 Agent skill

---

### 3.4 open-api 整体暴露面

```
/mcp          — MCP Server（Streamable HTTP）
/a2a          — A2A Agent 接口（REST over Google A2A v0.3）
/api/public   — Public REST API（research/teams/writing/etc）
/webhooks     — Webhook 接收/发送
/admin/**     — Admin 控制台（12+ controller）
/agents       — Agents API（cancel/status）
/teams        — Teams API
/skills       — Skills API
```

---

## S4 — 能力差距矩阵

| Anthropic 能力                                     | 我们现状                                            | 差距等级 | 修复优先级 | 工作量估计                             |
| -------------------------------------------------- | --------------------------------------------------- | -------- | ---------- | -------------------------------------- |
| PreToolUse hook + block                            | 完整实现（react-loop.ts L1246）                     | 无差距   | —          | —                                      |
| PostToolUse hook                                   | 完整实现（react-loop.ts L1265）                     | 无差距   | —          | —                                      |
| SessionStart hook 触发                             | 已定义未触发                                        | P1       | 高         | 0.5d（在 session 创建入口 dispatch）   |
| Stop hook 触发                                     | 已定义未触发（harnessed-agent.ts L293 缺 dispatch） | P1       | 高         | 0.5d（terminated 事件处连接 dispatch） |
| UserPromptSubmit hook 触发                         | 已定义未触发                                        | P1       | 高         | 0.5d                                   |
| Notification hook 事件                             | HookEvent 枚举缺 Notification                       | P2       | 中         | 1d（加枚举+触发点）                    |
| Hook shell command 执行器                          | 纯 TypeScript 回调，无 shell 层                     | P2       | 中         | 3-5d（需执行器沙盒）                   |
| ask（交互确认）权限级别                            | 不存在，只有 allow/deny                             | P1       | 高         | 5-8d（需 WS pause/resume 机制）        |
| mode（default/acceptEdits/plan/bypassPermissions） | 不存在                                              | P3       | 低         | 5d                                     |
| 用户级 settings.local 覆盖                         | 不存在                                              | P3       | 低         | 3d                                     |
| MCP Client stdio                                   | 完整实现（mcp-client.ts L332）                      | 无差距   | —          | —                                      |
| MCP Client SSE                                     | 完整实现（sse-mcp-client.ts）                       | 无差距   | —          | —                                      |
| MCP Client Streamable HTTP                         | 完整实现（streamable-http-mcp-client.ts）           | 无差距   | —          | —                                      |
| MCP Server stdio 模式                              | 不存在（只有 Streamable HTTP）                      | P3       | 低         | 5d                                     |
| MCP 工具自动注册                                   | 完整（MCPRelay）                                    | 无差距   | —          | —                                      |
| A2A Agent Card 发现                                | 完整（AgentCardRegistry）                           | 无差距   | —          | —                                      |
| A2A 流式 task 更新（SSE）                          | 轮询实现（a2a-client.service.ts L121）              | P2       | 中         | 3d（加 GET stream 端点）               |
| A2A JSON-RPC 2.0 封装                              | 直接 REST，非 JSON-RPC                              | P2       | 中         | 3d                                     |
| A2A 单 Agent skill                                 | 只支持 Team                                         | P2       | 中         | 2d                                     |

---

## 关键修复行动项

### P1 — 本迭代（触发点补齐）

- `SessionStart` dispatch：在 mission 创建入口（ResearchGateway 或 TeamsOrchestrator session 初始化处）调用 `hookRegistry.dispatch("SessionStart", { sessionId, userId })`
- `Stop` dispatch：在 `HarnessedAgent.execute()` 的 terminated 分支（`harnessed-agent.ts` L293）添加 `await hookRegistry?.dispatch("Stop", { reason })`
- `UserPromptSubmit` dispatch：在用户 prompt 入口（Gateway 的 @SubscribeMessage 处理器接收后）dispatch
- `ask` 权限级别：设计 `PermissionRequest` WS 消息 + 前端确认 UI + AgentLoop pause/resume 机制

### P2 — 下次迭代

- 添加 `Notification` HookEvent 枚举及 payload 类型
- A2A Server 增加 GET `/a2a/tasks/:id/stream` SSE 端点，消费 TeamsOrchestrator 事件流
- Hook shell command 执行器（沙盒 child_process，超时 5s，stdout→block/allow）

### P3 — 长期规划

- Permission mode 切换（acceptEdits 模式自动 approve 文件编辑类工具）
- MCP Server stdio 模式（给 IDE 插件集成用）
- 用户级 settings.local 动态 hook 覆盖

---

_审计工具: Arch Auditor Agent v2.0_
_对标参照: Anthropic Managed Agent (Claude Agent SDK)_
_下次建议审计: 2026-05-31_
