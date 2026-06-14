# OPERATORD MAILBOX DISPATCH PROTOCOL

## 目标

本文件定义主调度层（PM/调用端）与 `operatord-mailbox-runtime` 的任务提交与回写机制，目标是：主任务链路不再依赖 `tmux send-keys` 推送任务，而是将任务作为 `TaskEnvelope` 写入运行时邮箱，Runtime 仅执行本地启动与生命周期协调。

## 术语

- `Dispatcher`: 任务调度执行者，负责按任务图和路由规则提交执行任务。
- `Mailboxes`: 以 `config/actor-mailboxes.json`（或等效运行时配置）定义的 actor inbox 目录集合。
- `TaskEnvelope`: 任务信封结构体，定义见 `config/task-envelope.schema.json`。
- `TaskResultEnvelope`: 任务执行结果信封，定义见 `TaskEnvelope` 的 `result` 对应结构。
- `Runtime`: `operatord-mailbox-runtime`，负责从 inbox -> processing -> state/logs 等目录推进执行状态。

## 真实调用链（不得依赖 `tmux send-keys`）

1. Dispatcher 读取任务定义与目标 actor 信息。
2. Dispatcher 校验运行时参数并读取 `config/task-envelope.schema.json`：
   1. 写入 `submitted_at`、`ttl_sec`、`priority`、`payload`。
   2. 校验 `schema_version` 与 `task_id` 唯一性。
3. Dispatcher 创建 `TaskEnvelope` 文件并原子写入目标 actor 的 `inbox/` 目录：
   - 原子写入策略：写临时文件 + `os.replace()` 覆盖目标名。
4. Dispatcher 将该 `TaskEnvelope` 的元信息写入 operator 运行时可见日志（审计用）。
5. Runtime（该 actor 进程）在主循环扫描 inbox：
   - 发现新文件后将任务移动到 processing 并写入 state。
   - 执行任务，产生日志（stdout/stderr）和 `TaskResultEnvelope` 到结果位置。
6. Runtime 回写：
   - 结果落地至 `result` 字段并写 state terminal 状态。
   - 失败场景写 failure reason 到统一字段；按任务 TTL/幂等策略处理可重试。
7. Dispatcher/监控端消费结果：仅依赖结果文件与 state 文件，不依赖终端输入事件。

## `TaskEnvelope` 关键字段映射

- `task_id`: 全局唯一，建议保持幂等重试键。
- `sprint_id`: 任务归属。
- `node_id`: DAG 节点/运行时最小调度单元。
- `actor_id`: 目标执行 actor，需在 `config/agent-actors.json`/actor 配置中存在。
- `payload`: 具体调用参数，需兼容目标 actor schema。
- `submitted_at`/`ttl_sec`/`priority`: 用于超时重试与顺序策略，不允许留空或硬编码魔法值。

## 状态与重试策略

- Runtime 对任务执行状态要求至少具备以下语义:
  - `received`、`processing`、`succeeded`、`failed`、`timed_out`、`rejected`。
- 调度层应将同一 `task_id` 的重复提交视为幂等请求，避免重复执行副作用。
- 重试策略仅允许在非终态失败场景触发，并记录 `retry_count`。

## 错误和安全控制

1. 禁止硬编码路径/token。所有环境依赖（邮箱路径、日志路径、超时）从配置读取。
2. 对 `payload` 做 schema 校验，校验失败立即拒绝并返回 `rejected`。
3. 对超时任务写入 `timed_out`，由上层策略决定是否重试。
4. 使用最小权限目录与文件 ACL，避免将敏感信息明文持久化在运行时日志。

## 与历史行为的收口

- `tmux send-keys` 仅作为 runtime bootstrap/启动约定动作，不再承载主任务提交协议。
- 任务派发主链路全部走 mailbox 目录与 `TaskEnvelope`，并以文件状态文件/结果文件为事实来源。
- 任何“派发成功”定义以 envelope 已成功写入 inbox 为准，非终端事件确认。

## 监控与验收

1. 每个调度动作记录：`task_id`, `actor_id`, `submitted_at`, `inbox_path`, `schema_version`。
2. 每个完成动作记录：`task_id`, `result_path`, `status`, `duration_ms`, `error`.
3. 建议在关键路径做 `jq`/`python` schema 检查与路径清单对账，确保真实调用链全链路可追踪。

## 回归边界

- 任务 envelope 变更需同步更新 `config/task-envelope.schema.json` 与 runtime parser；不允许单边变更导致隐性不兼容。
- 保持 `docs/mailbox-protocol.md`、`docs/operatord-runtime.md`、`docs/mailbox-migration-runbook.md` 的行为一致性，优先以这三者为判据。

## 示例（最小提交示意）

```text
dispatcher -> build envelope -> validate envelope -> atomic write to <actor>/inbox/<task_id>.json
runtime -> move to processing/<task_id>.json -> execute -> write result/{task_id}.json -> state terminal
monitor -> read result/state -> report -> close loop
```

