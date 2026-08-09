# Solar Harness 物理算子冷却与可用性控制面分析

日期: 2026-06-18
作者: Codex
接力对象: Claude Code / Solar Harness 维护者

## 0. 一句话结论

当前物理算子冷却问题不是单一 quota bug, 而是控制面分裂:

- `quota_refresh` 已经把 Claude Code 订阅算子判为可用。
- `physical-operators.json` 仍持久化旧的 `quota_guard_state=cooldown`。
- `operator_health_watchdog` 的 prune 阶段继续把这些旧 block 当成未过期证据保留。
- `operator-status/*.json` 又被写回 `runtime_state=cooldown`。
- 同时 graph dispatch 已经能把任务派给 Claude evaluator, 说明至少一条派发链路又把 Claude 当作可用。

结果是: 同一个 Claude 物理算子在不同控制面里同时是 `idle`、`cooldown`、以及实际已派发。这会造成误报、空转、重复唤醒、错误降并发和吞吐抖动。

## 1. 当前事实证据

### 1.1 runtime status 视角

证据路径:

- `/Users/lisihao/.solar/harness/run/operator-status/*.json`

抽样结果:

```text
operator                                runtime   expires_at
mini-claude-opus-evaluator              cooldown  2026-06-18T23:59:59Z
mini-claude-opus-planner                cooldown  2026-06-18T23:59:59Z
mini-claude-sonnet-builder              cooldown  2026-06-18T23:59:59Z
mini-claude-sonnet-builder-print        cooldown  2026-06-18T23:59:59Z
mini-codex-gpt55-medium-builder-1       idle      N/A
mini-codex-gpt55-medium-builder-2       idle      N/A
mini-reasonix-deepseek-v4-builder       idle      N/A
mini-thunderomlx-qwen36-builder         deprecated 2027-06-17T23:23:11.411729Z
mini-thunderomlx-qwen36-knowledge       cooldown  2026-06-18T03:11:12.227937Z
```

问题点:

- Claude status 文件里只有 `runtime_state=cooldown` 和 `expires_at`, 没有真实 quota 证据路径、失败日志路径、writer、reason。
- 这不是一个可审计的冷却记录, 只是一个被投影出来的状态。

### 1.2 quota snapshot 视角

证据路径:

- `/Users/lisihao/.solar/harness/run/quota-snapshots/latest.json`

关键事实:

```text
operators_total        34
operators_usable       25
operators_hard_blocked 9
claude-opus            usable=6, hard_blocked=0, states={"idle": 6}
claude-sonnet          usable=4, hard_blocked=0, states={"idle": 4}
codex-gpt-5.5          usable=6, hard_blocked=0
codex-gpt-5.3-spark    usable=0, hard_blocked=6
glm-5.1                usable=0, hard_blocked=3
```

`quota_refresh.py` 当前对 Claude Code 的 probe 是:

```text
provider=claude-code
status=estimated
metric=subscription
note=claude-code-subscription-uses-live-failure-evidence
```

这说明 quota refresh 层已经接受了正确原则: Claude Code 订阅类算子不能用 Anthropic Admin API 判断额度, 只能信真实运行失败证据。

### 1.3 watchdog 视角

证据路径:

- `/Users/lisihao/.solar/harness/run/operator-health-watchdog/latest.json`
- `/Users/lisihao/.solar/harness/run/operator-health-watchdog/history.jsonl`

关键事实:

```text
phase=prune_expired_blocks
kept includes:
  mini-claude-opus-planner
  runtime_state=cooldown
  expires_at=2026-06-19T00:00:00Z
  source=preserved_by_flow_control

phase=quota_refresh
capacity says:
  claude-opus usable=6
  claude-sonnet usable=4
```

问题点:

- 同一次 watchdog run 内部就出现了冲突:
  - prune 阶段保留 Claude cooldown。
  - quota_refresh 阶段判 Claude 可用。
- watchdog 没有把这种冲突标为 `error` 或 drift, 反而继续 `ok=true`。

### 1.4 physical registry 视角

证据路径:

- `/Users/lisihao/.solar/harness/config/physical-operators.json`

当前存在的关键脏状态:

```text
operator                         provider    quota_guard_state  state.runtime_state  cooldown_until
mini-claude-opus-planner          anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-opus-planner-2        anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-opus-planner-3        anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-sonnet-builder        anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-opus-evaluator        anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-opus-planner-print    anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-sonnet-builder-print  anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-opus-evaluator-print  anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-sonnet-builder-2      anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-claude-sonnet-builder-3      anthropic   cooldown           cooldown             2026-06-19T00:00:00Z
mini-glm51-builder-1              glm         cooldown           cooldown             2026-06-19T00:00:00Z
mini-glm51-builder-2              glm         cooldown           cooldown             2026-06-19T00:00:00Z
mini-glm51-builder-3              glm         cooldown           cooldown             2026-06-19T00:00:00Z
```

结论:

- 旧冷却被写进了静态/半静态 registry。
- 这让 runtime 修复无法持久生效, 因为 watchdog 会从 registry 重新复活旧 block。

### 1.5 LaunchAgent / daemon 视角

证据:

```text
launchctl print gui/501/com.solar.harness.operator-health-watchdog
state = running
program = /opt/homebrew/bin/bash
arguments = /Users/lisihao/.solar/harness/scripts/operator-health-watchdog-daemon.sh run-once
run interval = 120 seconds
```

当前 watchdog 每 120 秒自动运行一次。只要 registry 中仍有 future cooldown, 它就可能继续把旧状态投影回 runtime。

### 1.6 dispatch 视角

进程表中出现:

```text
pm_dispatch.py submit --role evaluator ...
Selected Physical Operator: mini-claude-opus-evaluator
Original assigned pane fallback: operator-pool:evaluator.mini-claude-sonnet-builder
```

说明至少某条 graph dispatch / PM dispatch 链路已经认为 Claude 可用, 并开始派发任务。但 runtime status 同时显示 Claude cooldown。这是控制面冲突的直接证据。

## 2. 根因拆解

### 2.1 根因 A: 把动态冷却写进静态 registry

`physical-operators.json` 应该描述物理算子的身份、provider、模型、能力、可用开关等相对稳定字段。

但现在它同时保存:

- `quota_guard_state`
- `state.runtime_state`
- `state.cooldown_until`
- `last_block_expires_at`

这相当于把 transient runtime state 写进配置。后果:

- 旧状态可以跨进程、跨重启、跨修复永久复活。
- 状态来源不再可审计。
- 清理 runtime status 不够, registry 还会继续污染。

### 2.2 根因 B: watchdog prune 与 quota_refresh 顺序/职责错误

当前 watchdog 逻辑大致是:

```text
prune_expired_blocks
  -> 保留 future cooldown
refresh_capacity_snapshot
  -> quota_refresh 判定真实可用性
```

这会导致:

- 旧 block 先被保留。
- 后面 quota_refresh 即使说 Claude 可用, 也没有反向清理 prune 已保留的旧 block。
- 结果 report 内部自相矛盾但仍 `ok=true`。

更合理的顺序:

```text
collect live evidence
refresh quota/capacity
resolve availability from evidence lattice
prune stale/contradicted blocks
project runtime status
emit drift/errors
```

### 2.3 根因 C: Claude Code 订阅算子的 quota 语义特殊, 但只修了一半

正确原则:

- Claude Code 订阅不应通过 Anthropic Admin API probe 判 quota。
- `no-admin-key` 不能等价为 quota exhausted。
- 只有真实任务失败日志中有当前限流证据, 才能冷却 Claude Code 算子。

当前 `quota_refresh.py` 已经部分修正:

- Claude Code probe 标为 `subscription` + `estimated`。
- Claude Code 的 `cooldown/quota_exhausted` runtime state 不直接作为 block。

但 `operator_flow_control.prune_expired_operator_config_blocks()` 仍把 registry 中的 Claude cooldown 当成普通 block 保留。所以修复只覆盖了 snapshot 层, 没覆盖 watchdog/prune/registry 层。

### 2.4 根因 D: 字段语义分裂

同类含义现在有多套字段:

- `expires_at`
- `cooldown_until`
- `quota_refresh_at`
- `last_block_expires_at`
- `runtime_state`
- `state.runtime_state`
- `quota_guard_state`

不同模块读取不同字段:

- runtime status 多用 `expires_at`。
- flow control 多用 `state.cooldown_until` / `quota_refresh_at`。
- availability control plane 兼容两者。
- UI / status / watchdog 又有自己的投影。

这导致一个算子可能在 A 模块过期、B 模块未过期、C 模块没有 reason。

### 2.5 根因 E: block scope 模型不足

当前 `recent_operator_quota_block()` 会尝试从 operator result log 推断 block, 但 group 层处理仍有风险:

- Spark 一个 operator 的 quota block 可能污染整个 `codex-gpt-5.3-spark` group。
- Claude/GLM 的 provider-level 与 operator-level block 没有明确区分。
- block 缺少 `scope=operator|model|provider|account|host`。

正确模型必须显式带 scope, 不能靠 model_key 推断。

## 3. 当前实现的具体问题点

### 3.1 `quota_refresh.py`

路径:

- `/Users/lisihao/.solar/harness/tools/quota_refresh.py`

已经修对的部分:

- `_is_claude_code_operator()` 识别 Claude Code 订阅算子。
- `_provider_probe()` 对 Claude 返回 estimated subscription。
- `_runtime_state()` 对 Claude Code 的 `cooldown/quota_exhausted` 做了跳过处理。

仍有风险:

- `shared_model_blocks` 仍按 `_model_key` 聚合, 如果 `recent_operator_quota_block()` 返回某个 operator 的 block, 可能整组冷却。
- `refresh_snapshot()` 写出的 snapshot 不能反向清理 registry 中已矛盾的 block。

### 3.2 `operator_flow_control.py`

路径:

- `/Users/lisihao/.solar/harness/lib/operator_flow_control.py`

关键问题:

- `prune_expired_operator_config_blocks()` 仍读取 `physical-operators.json` 中的 `quota_guard_state` 和 `state.cooldown_until`。
- 只要 `cooldown_until` 是未来, 就 kept。
- 没有对 Claude Code 订阅算子的特殊规则。
- 没有检查这个 block 是否仍有近期真实失败证据。
- 没有把 `quota_refresh says idle` 作为反证。

需要改:

- 对 Claude Code 订阅算子, registry 中的 cooldown 不能单独作为 block 证据。
- 只有 `recent_operator_quota_block()` 或明确 block ledger 中有当前证据时才能 kept。

### 3.3 `operator_health_watchdog_operator_adapters.py`

路径:

- `/Users/lisihao/.solar/harness/lib/operator_health_watchdog_operator_adapters.py`

关键问题:

- `prune_expired_operator_config_blocks()` adapter 会把 flow-control kept 统一标为 `preserved_by_flow_control`。
- 它没有识别 `quota_refresh` 后的反证。
- 它没有把同一 run 中 `prune says blocked`、`quota_refresh says idle` 的冲突标成 drift/error。

需要改:

- watchdog summary 必须增加 availability drift:
  - `registry_block_but_quota_idle`
  - `runtime_cooldown_but_capacity_usable`
  - `dispatch_running_but_runtime_cooldown`
- 存在 drift 时不能 `ok=true` 无声通过, 至少 `warn`, P0 情况应 `error`。

### 3.4 `physical-operators.json`

路径:

- `/Users/lisihao/.solar/harness/config/physical-operators.json`

关键问题:

- 该文件现在同时承担 registry、runtime status、quota block ledger 三种职责。
- 这是架构层错误。

短期:

- 清掉 Claude Code 算子的 `quota_guard_state=cooldown` 和 `state.runtime_state=cooldown`。
- 保留 `last_block_*` 可作为历史审计, 但不能作为 active block。

长期:

- active block 应迁移到独立 ledger, 例如:
  - `/Users/lisihao/.solar/harness/run/operator-availability/blocks.jsonl`
  - 或 SQLite `operator_availability_blocks`

## 4. 推荐设计

### 4.1 状态源分层

```text
┌──────────────────────────────┐
│ config/physical-operators.json│
│ 静态身份: provider/model/caps │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ run/operator-status/*.json    │
│ 瞬时状态: idle/running/lease   │
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ operator availability blocks  │
│ active block ledger + evidence│
└───────────────┬──────────────┘
                │
                ▼
┌──────────────────────────────┐
│ availability resolver         │
│ 唯一决策: dispatchable? why?   │
└──────────────────────────────┘
```

核心原则:

- 配置不保存 active cooldown。
- runtime status 不保存 quota 真相, 只保存投影和 writer。
- block ledger 保存冷却原因、证据、scope、到期时间。
- resolver 是唯一 dispatchability 裁判。

### 4.2 active block schema

建议 schema:

```json
{
  "schema_version": "operator_availability_block.v1",
  "block_id": "sha256(...)",
  "operator_id": "mini-claude-opus-planner",
  "scope": "operator",
  "provider": "anthropic",
  "model_key": "claude-opus",
  "runtime_state": "cooldown",
  "reason": "rate_limit",
  "source": "operator_result_log",
  "evidence": {
    "path": "/Users/lisihao/.solar/harness/run/operator-results/.../output.log",
    "mtime": "2026-06-18T00:10:00Z",
    "excerpt_hash": "sha256:..."
  },
  "created_at": "2026-06-18T00:10:00Z",
  "expires_at": "2026-06-18T02:10:00Z",
  "writer": "operator_flow_control.record_operator_outcome",
  "confidence": "high"
}
```

必填字段:

- `scope`
- `source`
- `evidence`
- `expires_at`
- `writer`

没有这些字段的 block 不得进入 active dispatch blocking。

### 4.3 Claude Code 特例规则

Claude Code 算子:

- `provider in {anthropic, claude, claude-code}` 或 model 为 `opus/sonnet/haiku` 或 operator_id 含 `claude`。

规则:

1. 不用 Anthropic Admin API 判断可用性。
2. `no-admin-key` 不是 block。
3. registry 中旧 `quota_guard_state=cooldown` 不是 active block。
4. 只接受以下 active block:
   - 最近 `max_age_seconds` 内真实 operator result log 有限流证据。
   - 连续失败熔断记录, 且 evidence 指向真实失败结果。
   - 手动维护 block, 但必须 `source=manual` 且有 reason/writer/expires_at。
5. 到期后必须自动解冻。
6. quota_refresh 与 runtime-status 冲突时, 以 live evidence resolver 为准, 并记录 drift。

### 4.4 watchdog 新顺序

建议改成:

```text
1. collect_runtime_status
2. collect_recent_failure_evidence
3. refresh_quota_snapshot
4. resolve_active_blocks
5. prune_or_demote_contradicted_blocks
6. project_runtime_status
7. emit_drift_report
```

其中:

- `prune_or_demote_contradicted_blocks` 应在 quota/evidence 之后。
- 如果 quota says usable, 但 registry says cooldown, 且没有 live evidence, 应清理或降级旧 block。
- 如果 runtime says cooldown, 但 resolver says dispatchable, 应重写 runtime status 为 idle 并记录 repair。

## 5. P0 修复方案

### P0-1: Claude Code 不再从 registry cooldown 复活

修改点:

- `/Users/lisihao/.solar/harness/lib/operator_flow_control.py`

建议:

在 `prune_expired_operator_config_blocks()` 里识别 Claude Code 算子。如果 active block 仅来自:

- `op.quota_guard_state`
- `op.state.runtime_state`
- `op.state.cooldown_until`

且 `recent_operator_quota_block(op_id)` 返回 None, 则不要 kept, 应返回 pruned/demoted。

伪代码:

```python
if is_claude_code_operator(operator_id, op):
    recent = recent_operator_quota_block(operator_id, model_hint=model)
    if not recent and block_source_is_registry_only:
        clear_operator_quota_block(op)
        pruned.append({
            "operator_id": operator_id,
            "runtime_state": runtime_state,
            "expires_at": expires_raw,
            "source": "claude_registry_block_without_live_evidence_demoted",
        })
        continue
```

### P0-2: 清理当前 Claude 持久 cooldown

目标:

清理 `physical-operators.json` 中 Claude Code 算子的 active block 字段:

- `quota_guard_state` -> `ok`
- `state.runtime_state` -> `idle`
- `state.cooldown_until` -> `null`
- `quota_refresh_at` -> `null` 或删除

保留审计字段时必须确保不会被 active resolver 当作 block:

- `last_block_*` 只能作为 history。

注意:

- 这一步应配合 P0-1, 否则下一次错误写入仍会复发。

### P0-3: watchdog drift 检测

修改点:

- `/Users/lisihao/.solar/harness/lib/operator_health_watchdog_operator_adapters.py`
- `/Users/lisihao/.solar/harness/lib/operator_health_watchdog.py`

新增 drift:

```text
registry_block_but_quota_refresh_usable
runtime_status_cooldown_but_quota_refresh_usable
dispatch_running_but_runtime_cooldown
```

规则:

- 只要 Claude Code 出现上述 drift, watchdog summary 不能 `ok=true` 静默通过。
- 应输出 `status=warn` 或 `status=error`, 并列出 operator ids。

### P0-4: runtime status 投影必须带 writer/source

写 `run/operator-status/*.json` 时增加:

```json
{
  "runtime_state": "cooldown",
  "expires_at": "...",
  "source": "operator_availability_resolver",
  "writer": "operator_health_watchdog",
  "evidence_ref": "block_id or N/A",
  "updated_at": "..."
}
```

如果没有 `evidence_ref`, 只能投影 `warn`, 不应投影 active cooldown。

## 6. P1 架构收口

### P1-1: active cooldown ledger 独立化

新增:

- `run/operator-availability/blocks.jsonl`
- 或 `state.db` / `events.db` 中的 `operator_availability_blocks`

删除/停止使用:

- `physical-operators.json` 中 active cooldown 字段。

### P1-2: resolver 成为唯一裁判

所有派发链路必须调用同一个 resolver:

- graph dispatcher
- pm dispatch
- actor runtime
- multi_task_runner
- status server
- quota refresh
- watchdog

不允许各自读取 `operator-status` 或 registry 后自行判断。

### P1-3: block scope 显式化

scope 必须是:

- `operator`
- `model`
- `provider`
- `account`
- `host`

默认只能 operator-level。只有证据明确说明账号级/模型级限流时, 才允许 model/provider/account-level block。

### P1-4: 字段统一

统一使用:

- `expires_at` 作为 active block 到期时间。
- `runtime_state` 作为投影状态。
- `cooldown_until` 只作为兼容读取, 新写入禁止。

迁移策略:

- 读兼容旧字段。
- 写只写新字段。
- watchdog 每轮清理旧字段到 history。

## 7. 验收标准

### 7.1 Claude 解冻验收

命令:

```bash
python3 /Users/lisihao/.solar/harness/tools/quota_refresh.py --apply --json
python3 /Users/lisihao/.solar/harness/tools/operator_health_watchdog.py run --once --apply --json
```

预期:

```text
claude-opus usable > 0
claude-sonnet usable > 0
operator-status/mini-claude-*.json runtime_state != cooldown
physical-operators.json Claude quota_guard_state != cooldown
watchdog kept_blocks 不包含 Claude registry-only cooldown
```

### 7.2 drift 验收

构造:

- 手动在测试 fixture 中放一个 Claude registry cooldown。
- 不提供 recent result log quota evidence。
- 跑 watchdog。

预期:

- registry block 被 demote/prune。
- report 出现 repair action。
- 不出现 `preserved_by_flow_control`。

### 7.3 真实 block 验收

构造:

- 放一个 2 小时内的 Claude operator result log。
- log 内含明确限流和 reset 时间。

预期:

- resolver 判 Claude cooldown。
- block ledger 有 source/evidence/expires_at/writer。
- 到期后 watchdog 自动 prune。

### 7.4 Spark scope 验收

构造:

- 只给 `mini-codex-gpt53-spark-builder-1` 一个 operator-level block。

预期:

- 不应把全部 6 个 Spark builder 都 block。
- 除非 evidence 明确 `scope=model` 或 `scope=account`。

## 8. 建议给 Claude 的执行边界

Claude 接手时不要继续手动改 runtime status 当临时止血。那只是擦表面。

建议顺序:

1. 修 `operator_flow_control.prune_expired_operator_config_blocks()`:
   - Claude Code registry-only cooldown 不得 kept。
2. 加单测:
   - Claude registry cooldown without live evidence -> pruned/demoted。
   - Claude recent log quota evidence -> kept。
3. 修 watchdog drift:
   - quota usable vs registry cooldown -> warn/error + repair action。
4. 清理当前 `physical-operators.json` 中 Claude active cooldown。
5. 跑 quota_refresh + watchdog + status 聚合验证。
6. 再观察 2 个 watchdog interval, 确认不会写回 cooldown。

## 9. 风险

- 当前主工作树很脏, 不建议直接从 `/Users/lisihao/Solar` 做大范围 commit。
- live harness 路径 `/Users/lisihao/.solar/harness` 与 repo `harness/` 可能存在不同步, 修复时必须确认实际 daemon import 的路径。
- LaunchAgent 每 120 秒运行, 修复后需要 reload 或确保 daemon 读取新代码。
- `physical-operators.json` 里有大量历史字段, 清理时必须只动 Claude active cooldown 字段, 不要误删 operator 定义。

## 10. 最小判断

如果只能修一个点, 修这里:

```text
operator_flow_control.prune_expired_operator_config_blocks()
```

让 Claude Code 订阅算子的 registry-only cooldown 不再被 kept。否则 `quota_refresh` 修得再对, watchdog 也会把旧 block 复活。
