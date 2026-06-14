# Mailbox Migration Runbook

## 1. 目标与边界

本 runbook 落地 `sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s02-architecture.design.md` §11「兼容策略与迁移」。

目标是把 Solar 主任务派发协议从 `tmux send-keys` 任务正文收口到 mailbox runtime：

```text
coordinator / graph dispatcher
        |
        | task envelope submit
        v
actor mailbox inbox -> operatord consumer -> result/outbox -> status update
```

边界：

- `tmux send-keys` 只保留为 bootstrap/wakeup 或 legacy fallback，不再作为主任务协议。
- `feature flag` 名称固定为 `SOLAR_MAILBOX_ENABLED`。
- Phase 1 默认 `SOLAR_MAILBOX_ENABLED=0`，Phase 2 起默认反转为 `SOLAR_MAILBOX_ENABLED=1`。
- 回滚优先通过关闭 `SOLAR_MAILBOX_ENABLED` 完成，不删除 mailbox 数据面产物。

## 2. 统一操作前检查

每次推进 Phase 前执行：

```bash
test -n "${SOLAR_MAILBOX_ENABLED:-}" && echo "SOLAR_MAILBOX_ENABLED=${SOLAR_MAILBOX_ENABLED}" || echo "SOLAR_MAILBOX_ENABLED=N/A"
```

检查项：

| 项目 | 要求 | 失败处理 |
|------|------|----------|
| 设计来源 | 已读 design.md §11 | 停止推进，补齐迁移依据 |
| 当前 Phase | 与 sprint 节点一致 | 不跨 Phase 变更 |
| feature flag | `SOLAR_MAILBOX_ENABLED` 默认值符合当前 Phase | 先修正配置再派发 |
| legacy fallback | Phase 1/2 仍可退回 send-keys | 缺 fallback 时不得切主链 |
| evidence | 保留命令、日志、task_id | 缺证据不得进入下一 Phase |

## 3. Phase 0 (s02 finalized) — 设计冻结

### 入口条件

- 架构设计进入 finalized/reviewing 链路。
- `task_envelope.v1`、mailbox API、operatord consumer 边界已经在设计中定稿。

### 执行动作

1. 冻结 schema/API 命名，避免 Phase 1 实现期间反复改契约。
2. 落地本 runbook、mailbox protocol、runtime 边界文档。
3. 明确 `SOLAR_MAILBOX_ENABLED` 是唯一主切换 feature flag。
4. 标注旧 `tmux send-keys` 主任务正文为待降级路径。

### 验收

```bash
rg -n 'Phase 0|SOLAR_MAILBOX_ENABLED|回滚|feature flag' docs/mailbox-migration-runbook.md
```

通过标准：

- Phase 0 文档存在。
- `feature flag` 与 `SOLAR_MAILBOX_ENABLED` 明确出现。
- 回滚策略已在本文定义。

### 失败处理

- 若设计仍未冻结，不进入 Phase 1。
- 若 `SOLAR_MAILBOX_ENABLED` 未在文档和后续实现中统一命名，回到 Phase 0 修正。

## 4. Phase 1 (s03 core-runtime) — 新通道并存

### 入口条件

- Phase 0 验收通过。
- mailbox 数据面实现计划已绑定到真实调用链。

### 执行动作

1. 实现 `pane_mailbox.py` 或等价 mailbox package，提供 submit/collect/poll/report 能力。
2. 升级 `operatord` 支持 mailbox consumer 模式，能消费 actor inbox。
3. 旧 `physical-operators` 启动路径保留 `--legacy`。
4. dispatcher 按 `SOLAR_MAILBOX_ENABLED` 选择路径：

```bash
export SOLAR_MAILBOX_ENABLED=0  # Phase 1 默认：legacy send-keys 主链
export SOLAR_MAILBOX_ENABLED=1  # Phase 1 试运行：mailbox 主链，legacy fallback 保留
```

### 验收

```bash
SOLAR_MAILBOX_ENABLED=1 solar-harness dispatch smoke --path mailbox
SOLAR_MAILBOX_ENABLED=0 solar-harness dispatch smoke --path legacy
```

通过标准：

- mailbox submit 能生成 task envelope 并进入 actor inbox。
- operatord 能读取 inbox 并写出 result/outbox。
- `SOLAR_MAILBOX_ENABLED=0` 仍能退回 send-keys legacy 路径。
- 日志至少包含 `mailbox_enabled`、`actor_id`、`task_id`、`dispatch_path`。

### 失败处理

- Phase 1 出现卡死且 1 小时内无法恢复，立即执行回滚开关。
- mailbox consumer 不稳定时保留数据面日志，但主派发回到 `SOLAR_MAILBOX_ENABLED=0`。

## 5. Phase 2 (s04 orchestration) — 主链切换

### 入口条件

- Phase 1 双通道验证通过。
- mailbox 路径在至少一个真实任务中形成 submit -> operatord -> result 链路。

### 执行动作

1. 将 `coordinator.ts.dispatchToPane()` 主入口迁移到 `dispatchViaMailbox()`。
2. `graph_node_dispatcher.py` 主路径切到 mailbox。
3. 将 `feature flag` 默认值反转为 `SOLAR_MAILBOX_ENABLED=1`。
4. 老方法保留 fallback，并在日志中输出 warn。
5. 更新 `DISPATCH-PROTOCOL.md`，声明 mailbox 为主协议。

### 验收

```bash
SOLAR_MAILBOX_ENABLED=1 solar-harness graph-dispatch smoke --path mailbox
rg -n 'dispatchViaMailbox|dispatchToPane|SOLAR_MAILBOX_ENABLED|mailbox_enabled' .
```

通过标准：

- `SOLAR_MAILBOX_ENABLED=1` 下 graph node 派发默认进入 mailbox。
- `SOLAR_MAILBOX_ENABLED=0` 下仍可手动退回 legacy。
- 派发丢失率在观测窗口内不超过 1%。
- 旧 `dispatchToPane()` 只作为 fallback，且每次调用有 warn 证据。

### 失败处理

- Phase 2 出现派发丢失 > 1%，执行回滚开关并调查 inbox 写失败、rename 失败、actor lease 失败。
- 若 `feature flag` 切换期间存在 in-flight 任务，用 `task_id` 检查 inbox/processing/outbox 状态；已进入旧路径的任务让旧路径完成。

## 6. Phase 3 (s05 verification) — 旧路径降级

### 入口条件

- Phase 2 主链切换稳定。
- mailbox 指标、日志和 status 更新可追踪。

### 执行动作

1. 使用 mailbox 主链真实运行一个 sprint。
2. 验证完整链路：envelope -> operatord -> result -> status。
3. 扫描 send-keys 调用计数，确认只出现在 `bootstrap_*` / `wake_*` 函数。
4. 将旧 `dispatchToPane()` 标记 deprecated，下一 epic 再删除。

### 验收

```bash
SOLAR_MAILBOX_ENABLED=1 solar-harness sprint smoke --path mailbox
rg -n 'send-keys|send_keys|dispatchToPane|bootstrap_|wake_' .
```

通过标准：

- 至少一个真实 sprint 有完整 mailbox evidence。
- `send-keys` 不再承载主任务正文。
- `dispatchToPane()` deprecated 标记存在。
- Phase 3 验收测试通过后，才允许下一 epic 处理旧路径删除。

### 失败处理

- Phase 3 验收测试失败时，不进入下一 epic。
- 回到 Phase 2 修补 mailbox 主链；必要时临时设置 `SOLAR_MAILBOX_ENABLED=0`。

## 7. 回滚开关

### 回滚条件

| 触发 | 判定 | 动作 |
|------|------|------|
| Phase 1 卡死 | 1 小时内无法恢复 | `SOLAR_MAILBOX_ENABLED=0` 退回 send-keys |
| Phase 2 派发丢失 | 丢失率 > 1% | 关 feature flag，调查 inbox 写失败 |
| Phase 2 重复执行 | 同一 `task_id` 多次进入 executing | 关 feature flag，检查 lease/rename |
| Phase 3 验收 fail | sprint smoke 或 send-keys 审计未通过 | 不进入下一 epic，回到 Phase 2 |
| actor 无消费 | mailbox_enabled=true 但 heartbeat stale | 关 feature flag，重启 operatord |

### 回滚命令

仅切主路径：

```bash
export SOLAR_MAILBOX_ENABLED=0
solar-harness config set SOLAR_MAILBOX_ENABLED 0
```

回滚后重启 consumer：

```bash
export SOLAR_MAILBOX_ENABLED=0
solar-harness operatord restart --reason mailbox-rollback
```

保守验证 legacy 路径：

```bash
SOLAR_MAILBOX_ENABLED=0 solar-harness dispatch smoke --path legacy
```

修复后恢复 mailbox：

```bash
export SOLAR_MAILBOX_ENABLED=1
solar-harness config set SOLAR_MAILBOX_ENABLED 1
SOLAR_MAILBOX_ENABLED=1 solar-harness dispatch smoke --path mailbox
```

## 8. 观测与证据

每个 Phase 至少保留：

- 当前 `SOLAR_MAILBOX_ENABLED` 值。
- 一个真实 `task_id`。
- dispatcher 路径日志：`dispatch_path=mailbox|legacy`。
- operatord heartbeat/state。
- inbox/processing/outbox/result 状态变化。
- 回滚时的触发条件、命令和恢复验证结果。

## 9. 最小推进规则

```text
Phase 0 -> Phase 1 -> Phase 2 -> Phase 3
   |          |          |          |
   |          |          |          v
   |          |          |     old path deprecated
   |          |          v
   |          |     mailbox default
   |          v
   |     dual channel
   v
design freeze
```

- 不跨 Phase 推进。
- `feature flag` 切换必须先记录 evidence。
- 任何 `回滚` 都以 `SOLAR_MAILBOX_ENABLED=0` 为第一动作。
- Phase 3 之前不得删除 legacy send-keys fallback。
