# Agent Playground 分支覆盖矩阵（Happy Path + 异常全集）

**日期：** 2026-05-24
**目标：** 把 5 路端到端分析的所有判定分支汇成一张可核对的矩阵，作为"100% 分支覆盖"的索引 + 后续回归测试 backlog
**用法：** 每行一个分支，标 [覆盖状态] + [检测者 file:line] + [最终态] + [是否有 spec 守护]。"无 spec" 行即回归测试 backlog。

**覆盖状态图例：** ✅ 代码已实现且行为正确 / ⚠️ 实现但有缺口 / ❌ 未实现（漏洞）

---

## 1. Happy Path 分支（主链路每个决策点）

| #   | 决策点          | 分支                      | 走向                   | 检测者 (file:line)     | 状态    | spec |
| --- | --------------- | ------------------------- | ---------------------- | ---------------------- | ------- | ---- |
| H1  | JWT 校验        | valid token               | 注入 userId，继续      | JwtAuthGuard           | ✅      | ✅   |
| H2  | RateLimit       | 未超额                    | 继续                   | RateLimitGuard         | ✅      | ✅   |
| H3  | DTO 校验        | Zod safeParse 成功        | 继续                   | controller `team/run`  | ✅      | ✅   |
| H4  | 并发 mission 数 | < 3 running               | 创建                   | `countRunningByUser`   | ⚠️ race | ❌   |
| H5  | openSession     | DB insert 成功            | 返回 missionId         | RuntimeShell           | ✅      | ✅   |
| H6  | pipeline 选择   | depth=deep/report         | 选 PLAYGROUND_PIPELINE | playground.config      | ✅      | ✅   |
| H7  | DAG 调度        | S4‖S5 并行 / 其余顺序     | 按 depends_on          | DAGExecutor            | ✅      | ✅   |
| H8  | stage handler   | primitive 匹配            | 调对应 hook            | bindings               | ✅      | ✅   |
| H9  | agent 调用      | SKILL.md 加载成功         | materialize AgentSpec  | SkillLoader            | ✅      | ✅   |
| H10 | TaskProfile     | creativity/outputLength   | 映射 temp/maxTokens    | ai-chat                | ✅      | ✅   |
| H11 | model 选择      | BYOK vs 平台 tier         | 选 model               | react-loop:721-733     | ✅      | ✅   |
| H12 | ReAct loop      | LLM 返回 tool_use         | 执行 tool              | react-loop:553-557     | ✅      | ✅   |
| H13 | tool 并发       | 多 tool_use block         | Promise.all            | ToolInvoker            | ✅      | ✅   |
| H14 | loop 终止判定   | content 无未执行 tool_use | finalize               | react-loop             | ✅      | ✅   |
| H15 | 事件 emit       | schema 已注册             | broadcast 到房间       | DomainEventBus         | ✅      | ✅   |
| H16 | heartbeat       | 每 stage 间               | 更新 heartbeatAt       | orchestrator           | ✅      | ✅   |
| H17 | 终态 finalize   | status='running'          | 条件写 → completed     | applyTerminalIfRunning | ✅      | ✅   |
| H18 | 报告生成        | ReportArtifact            | 返回前端               | report-helper          | ✅      | ✅   |

**Happy path 结论**：18 个决策点全部走通，仅 H4 有并发 race 缺口。

---

## 2. 异常分支矩阵（27 场景 + 入口层异常）

### 2.1 入口层异常（路 1）

| #   | 场景                      | 走向                      | 检测者 (file:line)   | 状态 | spec | 备注                          |
| --- | ------------------------- | ------------------------- | -------------------- | ---- | ---- | ----------------------------- |
| E1  | 未登录访问                | 401                       | JwtAuthGuard         | ✅   | ✅   |                               |
| E2  | 越权访问他人 mission      | 403                       | controller ownership | ✅   | ✅   |                               |
| E3  | DTO 校验失败              | 400 + Zod error           | controller safeParse | ✅   | ✅   |                               |
| E4  | rate-limit 触发           | 429                       | RateLimitGuard       | ⚠️   | ❌   | 单 pod in-memory，多 pod 失效 |
| E5  | WS 断开                   | 房间清理                  | gateway disconnect   | ✅   | -    |                               |
| E6  | WS 用被禁用户旧 token     | 仍能 join                 | gateway verify       | ❌   | ❌   | **P0-#6 不查 blocklist**      |
| E7  | 事件 schema 未注册        | drop + warn               | DomainEventBus       | ✅   | ✅   |                               |
| E8  | onModuleInit 未完成收请求 | NestJS 保证 init < listen | module               | ✅   | -    |                               |
| E9  | 重复 mission 创建（并发） | 都通过 3-检查             | `countRunningByUser` | ⚠️   | ❌   | **P1-#9 无锁/无唯一约束**     |

### 2.2 Abort / Cancel（路 5 §8.1-8.2）

| #   | 场景                               | 走向                               | 检测者 (file:line)             | 状态 | spec |
| --- | ---------------------------------- | ---------------------------------- | ------------------------------ | ---- | ---- | --------------- |
| E10 | 用户主动 cancel（任意阶段）        | abort signal → finalize(cancelled) | controller:244 + AbortRegistry | ✅   | ✅   |
| E11 | abort 穿透 ReAct loop              | 每轮顶 check aborted               | react-loop:519                 | ✅   | ✅   |
| E12 | abort 穿透 LlmExecutor             | schema retry 顶 check              | llm-executor:453               | ✅   | ✅   |
| E13 | abort 穿透 fetch                   | provider 连接立即断                | ai-chat (engine)               | ✅   | ✅   |
| E14 | abort 穿透 Prisma                  | **不能中断** in-flight query       | Prisma                         | ❌   | ❌   | **P1-#13 漏洞** |
| E15 | 用户关浏览器（WS 断 mission 续跑） | 后台跑完                           | gateway                        | ✅   | -    |

### 2.3 进程 / 部署级（路 5 §8.3-8.4）

| #   | 场景               | 走向                               | 检测者 (file:line)               | 状态 | spec |
| --- | ------------------ | ---------------------------------- | -------------------------------- | ---- | ---- | --------- |
| E16 | Pod OOM kill / 崩  | heartbeat 停 → liveness 回收       | liveness-guard:364               | ✅   | ✅   |
| E17 | Pod rolling deploy | **无 graceful，靠 liveness ≥5min** | `orchestrator_shutdown` 0 调用者 | ❌   | ❌   | **P0-#3** |

### 2.4 LLM 调用异常（路 3 §9 + 路 5 §8.5-8.8）

| #   | 场景                            | 走向                                            | 检测者 (file:line)    | 状态 | spec |
| --- | ------------------------------- | ----------------------------------------------- | --------------------- | ---- | ---- |
| E18 | LLM 4xx parameter invalid       | abort 不可恢复                                  | error-signal classify | ✅   | ✅   |
| E19 | LLM 4xx context too long        | abort（truncated 时 retry 调高 maxTokens 1 次） | classifyError         | ✅   | ✅   |
| E20 | LLM 4xx content filtered        | abort                                           | classify              | ✅   | ✅   |
| E21 | LLM 5xx provider down           | retry → model-failover (max 4)                  | model-failover.util   | ✅   | ✅   |
| E22 | LLM 429 rate limit              | retry retryAfterMs                              | RetryStrategy         | ✅   | ✅   |
| E23 | LLM streaming drop mid-response | retry                                           | react-loop            | ✅   | ✅   |
| E24 | LLM response 非合法 JSON        | Reflexion critique-revise retry                 | LlmExecutor           | ✅   | ✅   |
| E25 | LLM 16min 卡死                  | Promise.race 硬超时                             | chatRaceWrapped       | ✅   | ✅   |
| E26 | thinking signature mismatch     | strip on fallback                               | react-loop:925-929    | ✅   | ✅   |
| E27 | agent loop 超 MAX_TURNS         | finalize partial                                | react-loop            | ✅   | ✅   |

### 2.5 Tool 异常（路 3 + 路 5 §8.9-8.10）

| #   | 场景                               | 走向                    | 检测者 (file:line)           | 状态 | spec |
| --- | ---------------------------------- | ----------------------- | ---------------------------- | ---- | ---- |
| E28 | tool exception (network/parse/biz) | classifyError → retry   | RetryStrategy                | ✅   | ✅   |
| E29 | tool 不存在 (registry miss)        | error → loop 决定换工具 | ToolRegistry                 | ✅   | ✅   |
| E30 | tool argument schema mismatch      | retry                   | tool-invoker                 | ✅   | ✅   |
| E31 | 单 tool 连续 3 次失败              | circuit breaker OPEN    | CircuitBreaker (threshold=3) | ✅   | ✅   |

### 2.6 基础设施异常（路 5 §8.11-8.13）

| #   | 场景                         | 走向                                 | 检测者 (file:line) | 状态 | spec |
| --- | ---------------------------- | ------------------------------------ | ------------------ | ---- | ---- | ------------------------------ |
| E32 | DB connection lost mid-tx    | Prisma throw → mission fail          | mission-store      | ⚠️   | ❌   | markRunning 失败可能卡 pending |
| E33 | DB row missing (P2003/P2025) | emergencyAbort → AbortRegistry       | mission-store:172  | ✅   | ✅   |
| E34 | Redis lost (BullMQ/cache)    | RateLimit fail-open，cache miss 降级 | rate-limit         | ⚠️   | ❌   | **P1-#16 fail-open 无告警**    |
| E35 | WS gateway crash             | 重连恢复                             | gateway            | ✅   | -    |

### 2.7 预算异常（路 5 §8.14-8.15）

| #   | 场景                 | 走向                                         | 检测者 (file:line)         | 状态 | spec |
| --- | -------------------- | -------------------------------------------- | -------------------------- | ---- | ---- | --------- |
| E36 | budget 70%           | tier downgrade (strong→standard→basic)       | budget-accountant:30-43    | ✅   | ✅   |
| E37 | budget 80% soft warn | **仅 logger.warn 不 emit 事件**              | token-budget               | ❌   | ❌   | **P0-#7** |
| E38 | budget 90%           | logger.warn                                  | token-budget:237-241       | ✅   | -    |
| E39 | budget 100% hard     | yield terminated{budget_exhausted} + partial | BudgetAccountant.exhausted | ✅   | ✅   |

### 2.8 超时异常（路 2 + 路 5 §8.16-8.17）

| #   | 场景                                 | 走向                                              | 检测者 (file:line)    | 状态 | spec |
| --- | ------------------------------------ | ------------------------------------------------- | --------------------- | ---- | ---- | --------- |
| E40 | mission wall-time 4h                 | liveness → finalize(wall_time_exceeded)           | liveness-guard:335    | ✅   | ✅   |
| E41 | stage 单步超时                       | **无独立 timer，靠 mission liveness 5min 双信号** | -                     | ❌   | ❌   | **P0-#1** |
| E42 | stage stalled (1.5×timeoutMs)        | emit stage:stalled 警告（不杀）                   | orchestrator          | ✅   | ✅   |
| E43 | liveness markFailed 后 in-flight LLM | **继续烧钱直到 loop 顶 check**                    | liveness 不主动 abort | ❌   | ❌   | **P0-#2** |

### 2.9 DAG / 质量 / 安全（路 5 §8.18-8.21）

| #   | 场景                      | 走向                           | 检测者 (file:line)       | 状态 | spec |
| --- | ------------------------- | ------------------------------ | ------------------------ | ---- | ---- | ------------------------ |
| E44 | DAG sibling fail          | 是否拖死全 mission             | DAGExecutor              | ⚠️   | ❌   | 需确认 fail-fast vs 隔离 |
| E45 | prompt injection 检测     | safety pipeline                | engine/safety            | ⚠️   | ❌   | injection 检测部分实现   |
| E46 | PII 在 LLM output         | **未过滤**                     | engine/safety/pii 未实现 | ❌   | ❌   | **P0-#4**                |
| E47 | Writer output schema fail | Reflexion retry / quality gate | LlmExecutor              | ✅   | ✅   |

### 2.10 Rerun（路 5 §8.22-8.23）

| #   | 场景                     | 走向                       | 检测者 (file:line)  | 状态 | spec |
| --- | ------------------------ | -------------------------- | ------------------- | ---- | ---- | -------------- |
| E48 | rerun 从 checkpoint 恢复 | hydrate ctx 跳已完成 stage | ctx-hydrator        | ✅   | ✅   |
| E49 | rerun checkpoint 损坏    | hydrate fail → 报错        | ctx-hydrator        | ⚠️   | ❌   | 损坏处理待确认 |
| E50 | rerun 频次闸             | ≥50 次/24h 拒              | local-rerun:494     | ✅   | ✅   |
| E51 | rerun cost 闸            | ≥creditBudgetProxyUsd 拒   | local-rerun:222-237 | ✅   | ✅   |
| E52 | rerun stage 黑名单       | s1-budget 不可重跑         | rerun-guard         | ✅   | ✅   |

### 2.11 并发 / 配置 / 学习（路 5 §8.24-8.27）

| #   | 场景                   | 走向                                   | 检测者 (file:line)       | 状态 | spec |
| --- | ---------------------- | -------------------------------------- | ------------------------ | ---- | ---- | ---------------------------- |
| E53 | 双 pod 同跑同 mission  | rerun 抢锁 protectStaleAbortController | rerun-runtime-builder:62 | ⚠️   | ❌   | in-process 锁跨 pod 不一致   |
| E54 | 中途变更 topic         | configSnapshot 冻结，不影响进行中      | RuntimeShell             | ✅   | ✅   |
| E55 | BYOK key 失效          | provider 4xx → failover / 通知         | error-signal             | ⚠️   | ❌   | failover 有，专门通知缺      |
| E56 | 单 stage 反复 fail ≥3  | circuit breaker                        | CircuitBreaker           | ✅   | ✅   |
| E57 | cross-mission 失败学习 | markModelDisabled 4h TTL               | FailureLearner           | ⚠️   | ❌   | **无硬 count 阈值 (P2-#18)** |

---

## 3. 终态 failureCode 决策覆盖

| failureCode               | 触发源                 | 检测者             | 覆盖 |
| ------------------------- | ---------------------- | ------------------ | ---- |
| `user_cancelled`          | 用户 cancel API        | controller:244     | ✅   |
| `budget_exhausted`        | loop 检测 100%         | BudgetAccountant   | ✅   |
| `wall_time_exceeded`      | liveness 4h            | liveness-guard:335 | ✅   |
| `runtime_crashed`         | liveness 双信号 stale  | liveness-guard:364 | ✅   |
| `mission_row_missing`     | Prisma P2003/P2025     | mission-store:172  | ✅   |
| `leader_signoff_rejected` | S11 leader refuse 3 次 | dispatcher         | ✅   |
| `provider_error`          | LLM 不可恢复 4xx       | error-signal       | ✅   |
| `unknown`                 | 兜底                   | finalize           | ✅   |

**结论**：8 个 canonical failureCode 全部有触发路径覆盖。

---

## 4. 覆盖统计

| 类别                    | 总分支 | ✅ 正确      | ⚠️ 有缺口    | ❌ 漏洞     |
| ----------------------- | ------ | ------------ | ------------ | ----------- |
| Happy path (H)          | 18     | 17           | 1            | 0           |
| 入口异常 (E1-9)         | 9      | 5            | 2            | 2           |
| Abort (E10-15)          | 6      | 5            | 0            | 1           |
| 进程/部署 (E16-17)      | 2      | 1            | 0            | 1           |
| LLM (E18-27)            | 10     | 10           | 0            | 0           |
| Tool (E28-31)           | 4      | 4            | 0            | 0           |
| 基础设施 (E32-35)       | 4      | 2            | 2            | 0           |
| 预算 (E36-39)           | 4      | 3            | 0            | 1           |
| 超时 (E40-43)           | 4      | 2            | 0            | 2           |
| DAG/质量/安全 (E44-47)  | 4      | 1            | 2            | 1           |
| Rerun (E48-52)          | 5      | 4            | 1            | 0           |
| 并发/配置/学习 (E53-57) | 5      | 2            | 3            | 0           |
| failureCode (8)         | 8      | 8            | 0            | 0           |
| **合计**                | **83** | **64 (77%)** | **11 (13%)** | **8 (10%)** |

---

## 5. 回归测试 backlog（无 spec 的分支）

按优先级，以下分支**无自动化 spec 守护**，建议补测试：

**P0（漏洞，必补）：**

- E6 WS blocklist 校验 — 加 spec 验证被禁用户 socket 被拒
- E17 graceful shutdown — 加 SIGTERM → in-flight mission 优雅终止 spec
- E37 budget 80% soft event — 加 80% 触发业务事件 spec
- E41 stage timeout — 加单 stage 超时兜底 spec
- E43 liveness 主动 abort — 加 markFailed → in-flight signal abort spec
- E46 PII filter — 需先实现再补 spec

**P1（缺口，应补）：**

- E4/E9 distributed rate-limit + mission 并发唯一约束
- E14 Prisma abort（架构限制，至少加注释 + 监控）
- E34 Redis fail-open 告警

**P2（边缘，可补）：**

- E44 DAG sibling fail 隔离策略
- E49 rerun checkpoint 损坏处理
- E53 跨 pod 锁
- E57 failure learning count 阈值

---

## 相关文档

- [总分报告 SUMMARY](./SUMMARY.md)
- [01 HTTP 入口](./01-http-entrypoint.md)
- [02 Pipeline 调度](./02-pipeline-orchestration.md)
- [03 Agent 调用](./03-agent-invocation.md)
- [04 Mission Lifecycle](./04-mission-lifecycle.md)
- [05 异常场景](./05-exception-scenarios.md)

---

**矩阵生成时间**: 2026-05-24
**总分支数**: 83（18 happy + 57 异常 + 8 failureCode）
**覆盖率**: 77% 正确 / 13% 有缺口 / 10% 漏洞
