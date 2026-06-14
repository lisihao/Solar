# Mailbox Protocol v1

> 本规范源自 `design.md §5`，定义 operatord 主链的 FS 数据面行为。
> 与 `config/task-envelope.schema.json`（数据契约）和 `pane_mailbox.py`（API 库）共同构成 s02-architecture 产出。

## 1. 背景与目标

把任务协议主链从 tmux send-keys 切换到 mailbox runtime 后，所有任务派发/认领/结果回收都通过 actor mailbox 文件系统完成。本文档定义该 FS 数据面的完整规范，覆盖：

- 任务入站与出站目录（`inbox/` / `outbox/`）
- 执行期间的任务状态承载目录（`processing/`）
- 死信目录（`dead-letter/`）
- 运行与结果日志（`logs/`）
- 生命周期快照（`state.json`）
- 心跳持久化（`heartbeat.json`）
- 写入互斥锁（`inbox.lock`）

## 2. 目录结构

按 actor 维度组织的 mailbox 根目录如下：

```
~/.solar/harness/actors/<actor_id>/
├── inbox/
│   ├── <task_id>.envelope.json        # 调度侧写入，等待 operatord 认领
│   └── <task_id>.envelope.json.tmp    # 原子写中间文件
├── inbox.lock                         # 单 writer 锁（flock，可选）
├── processing/
│   └── <task_id>.envelope.json        # operatord 已认领，执行中
├── outbox/
│   ├── <task_id>.result.json          # 执行完成后写入
│   └── <task_id>.result.json.tmp      # 原子写中间文件
├── dead-letter/
│   └── <task_id>.envelope.json        # TTL 超时未消费的任务（watchdog 移入）
├── logs/
│   ├── <task_id>.log                  # 单任务执行日志（stdout/stderr）
│   └── operatord.log                 # 守护进程运行日志
├── .lock                              # actor 启动锁文件（flock），防止旧路径与新路径同时启动
├── state.json                         # 当前状态快照
├── state.json.tmp                     # 原子写中间文件
└── heartbeat.json                     # 心跳（进程活性与当前任务）
```

## 3. 文件语义与职责

- `inbox/`：仅由 scheduler/协调端写入，operatord 通过轮询/事件发现
- `inbox.lock`：单 writer 锁（`flock`），多 dispatcher 并发写同一 actor inbox 时协调
- `processing/`：operatord 认领后移动到此目录，表示已开始执行
- `outbox/`：operatord 写结果；协同方（coordinator/status/panel）只读
- `dead-letter/`：超过 `ttl_sec` 仍在 `inbox/` 未被消费的任务，由 watchdog 移入；触发告警
- `logs/`：记录任务执行与运行日志，便于回放
- `.lock`：actor 启动锁（`flock`），防止旧 physical-operators 与新 mailbox 路径同时启动同一 actor
- `state.json`：记录 operatord 当前状态机
- `heartbeat.json`：记录最近一次心跳时间、pid、当前 task_id 等

## 4. 原子写规则（必须）

所有涉及 `inbox/`, `outbox/`, `state.json`, `heartbeat.json` 的持久化必须满足原子写规则：

1. 先写 `<name>.tmp`
2. 调 `fsync` 刷盘
3. 通过 `rename` 替换正式名（`tmp -> final`）

示例：

- 写 envelope：`<task_id>.envelope.json.tmp` → `fsync` → `rename` 到 `<task_id>.envelope.json`
- 写 result：`<task_id>.result.json.tmp` → `fsync` → `rename` 到 `<task_id>.result.json`
- 写状态：`state.json.tmp` → `fsync` → `rename` 到 `state.json`
- 写 heartbeat：`heartbeat.json.tmp` → `fsync` → `rename` 到 `heartbeat.json`

operatord 的任务认领使用 `rename inbox/<task_id>.envelope.json -> processing/<task_id>.envelope.json`，通过 rename 原子性避免双领。

## 5. 生命周期状态（Lifecycle）

状态机建议至少包括以下状态：`STARTING -> IDLE -> DISPATCHING -> EXECUTING -> REPORTING -> ABORTING`，并将变更持久化为 `state.json`。

### 典型流程

1. `STARTING`：启动扫描 `processing/`、重建未完成任务、初始化 `heartbeat.json`
2. `IDLE`：无待执行任务，持续触发心跳写 `heartbeat.json`
3. `DISPATCHING`：发现 `inbox/` task，原子认领为 `processing/`
4. `EXECUTING`：在 `processing/` 执行任务，输出写入 `logs/<task_id>.log`
5. `REPORTING`：写 `outbox/<task_id>.result.json`，并更新 `state.json`
6. `ABORTING`：异常超时或外部 abort 触发终止后，写入失败结果并回收资源

## 6. 一致性与可靠性保证

- at-most-once 派发：`task_id` 在 scheduler 侧幂等生成与防重（提交前检查 `inbox/`, `processing/`, `outbox/` 中无同 id）
- at-least-once 执行：`processing/` 残留任务在 operatord 崩溃恢复后可重放执行
- 结果可重放性：重启后按 `processing/` 与 `state.json` 回收状态，避免“丢任务”
- 状态可恢复性：`state.json` 与 `heartbeat.json` 的读取失败不阻断查询，仅降级为 `state=UNKNOWN` + 新一轮状态修复

## 7. 通知机制

### 7.1 默认机制（推荐）
- `pane_mailbox.poll(interval=1.0)` 定时轮询 `inbox/`，发现新任务后认领执行

### 7.2 扩展机制（可选）
- `fswatch` / inotify 监听 `inbox/` 变更，配合短轮询 fallback 降低延迟
- 即使使用事件通知，也要求出现异常时回退到轮询（防止 watch 丢失）

## 8. 目录操作规约（边界）

- `inbox/` 写入必须来自调度层，不允许 pane 直接写
- `outbox/` 与 `state.json` 只允许 `operatord` 写
- `processing/` 只允许 operatord 的 `poll/claim` 与 `collect/cleanup` 操作
- `heartbeat.json` 写入频率应受上限控制（如默认 5s）
- 若 `state.json` 或 `heartbeat.json` 损坏，优先通过备份/重建并继续执行

## 9. 质量与恢复

- `task_id` 或 `actor_id` 校验失败：写 `logs/`，不进入 `processing/`，并返回错误
- `.tmp` 残留超时：scheduler/operatord 启动时清理超过 5 分钟的 `.tmp` 文件（断电/崩溃留下的部分写入）
- `heartbeat.json` 过期：触发看护动作；若同一 actor 连续 stale，执行重启 `operatord`
- `dead-letter/` 处理：watchdog 扫描 `inbox/` 中文件 mtime 超过 `ttl_sec` 的 envelope，移到 `dead-letter/` 并触发告警；v1 不自动重试，由人工裁定

## 10. 约束与同盘要求

- **同盘约束**：mailbox 目录必须位于同一文件系统（`~/.solar/harness/actors/`），`rename()` 原子性仅在同一卷内保证。不得跨卷软链 mailbox 子目录。
- **幂等要求**：`at-least-once` 执行语义要求 actor 端实现幂等，或 operatord 重启后先检查 `outbox/` 已有结果再决定是否重执行。
- **发送端限流**：scheduler 不得在同一 actor inbox 中堆积超过合理数量（建议 ≤ 10）的 envelope，防止 FS 压力。

