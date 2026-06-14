# cmux 多标签四分屏 tmux 状态监控工作台

## 快速开始

```bash
# 1. 渲染默认监控配置（预览命令计划）
python3 scripts/cmux/render-cmux-workspace

# 2. 健康检查默认监控配置
python3 scripts/cmux/cmux-monitor-doctor

# 3. 启动默认工作台，并自动选中 Solar Status Cards
python3 scripts/cmux/cmux-monitor-up

# 4. 停止默认工作台
python3 scripts/cmux/cmux-monitor-down
# or:
python3 scripts/cmux/cmux-monitor-down --name solar-runtime
```

默认配置为 `config/cmux-workspace-sample.yaml`，当前会启动 5 个 CMUX workspace：首屏 `Solar Status Cards` 状态卡、三个单 pane focus，以及一个 2x2 四分屏 capture fallback。

## 脚本说明

| 脚本 | 职责 |
| --- | --- |
| `render-cmux-workspace` | 解析 workspace.yaml，校验 schema，输出 tab/pane 命令计划 |
| `cmux-monitor-up` | 调用 render，构建 cmux JSON layout，启动工作台 |
| `cmux-monitor-down` | 安全关闭工作台（不影响其他 cmux 会话） |
| `cmux-monitor-doctor` | 逐项检查 cmux/tmux/ssh/target/log，输出 machine-verifiable JSON |
| `tmux-status-card-view` | 默认人读视图，把 tmux panes 汇总成状态卡片，不镜像完整 TUI |
| `tmux-session-view` | 原生 tmux session view，默认 interactive，可滚动，启动前提示键盘会直通 |
| `tmux-pane-view` | capture-pane 轮询 fallback，显示 timestamp+host+target，fail-open |
| `tmux-pane-log-follow` | tail -F 模式，支持 local/remote，可校验 tmux target |

## Workspace Schema

```yaml
workspace_name: "my-workspace"

ssh_profiles:
  mini:
    host: "mini"
    user: "lisihao"
    control_master: true   # 开启 ControlMaster

tabs:
  - id: "tab-id"
    title: "Tab Title"
    layout: "quad"         # single | split | tri | quad
    panes:
      - title: "pane-name"
        source: "local"    # local | remote
        # ssh_profile: "mini"  # 仅 source=remote 时设置
        tmux_targets: ["session:0.0", "session:0.1"] # status-card 汇总视图
        tmux_session: "session"
        focus_target: "session:window.pane" # 可选；native view 默认 zoom 到单 pane，避免四分屏文字挤压
        # tmux_target: "session:window.pane" # capture fallback 时设置
        mode: "status-card" # status-card | interactive-view | capture | tail
        attach_mode: "interactive" # interactive | readonly
        # log_path: "~/.logs/foo.log"  # 仅 mode=tail 时设置
        lines: 60          # capture 模式显示行数（可选，默认 60）
        interval_sec: 1    # capture 刷新间隔（可选，默认 1）
```

### 推荐模式

| mode | 用途 | 鼠标滚动 | 风险 |
| --- | --- | --- | --- |
| `status-card` | 人看的主工作台，把多个 tmux pane 抽成卡片 | N/A | 只展示状态摘要，不是完整终端 |
| `interactive-view` | 原生 tmux session 诊断视图 | 可用 | 键盘输入会直通 tmux session |
| `capture` | 单 pane focus / 机器巡检 / 只读状态镜像 fallback | 可用 | 默认用 `capture-pane -J` 合并源 pane 硬换行，仍不是原生 TUI |
| `tail` | 日志流 | 可用 | 只适合日志，不适合 TUI |

当前默认 sample 使用 `status-card` 作为首屏。原因是 CMUX 镜像 tmux 文本会继承源 pane 宽度、ANSI/TUI 重绘和 scrollback 限制，观感接近“监控摄像头拍终端”；状态卡片只展示 operator/pane 的可读状态、尺寸、命令和尾部摘要，适合作为日常总览。完整终端内容保留在后续 capture/native fallback 标签中。

`attach_mode=readonly` 会使用 `tmux attach-session -r`，但 tmux readonly client 在很多终端里会拦截鼠标滚轮事件；需要滚动时应使用默认 `interactive`，并依赖启动警告避免误输入。

`focus_target` 会在 attach 前执行 `select-pane + resize-pane -Z`，把目标 pane 放大为全宽视图。tmux zoom 是 window-scoped，因此多个 focus 标签会共享同一 tmux window 的当前 zoom 状态；切换标签时以最后进入的 focus 为准。

### 布局枚举

| layout | panes | 布局示意 |
| --- | --- | --- |
| `single` | 1 | full screen |
| `split` | 2 | 左右平分 |
| `tri` | 3 | 上两格 / 下一格 |
| `quad` | 4 | 2x2 等分（默认四分屏） |

### 约束

- 每 tab 最多 4 panes
- `mode=status-card` 需要 `tmux_targets`
- `mode=interactive-view` 需要 `tmux_session` 或 `tmux_target`
- `mode=capture` 需要 `tmux_target`
- `mode=tail` 需要 `tmux_target` + `log_path`
- `source=remote` 需要 `ssh_profile`
- `source=local` 不允许 `ssh_profile`

## SSH 复用配置

在 `~/.ssh/config` 中添加：

```sshconfig
Host mini
  HostName your-mini.local
  User lisihao
  ControlMaster auto
  ControlPath ~/.ssh/cmux-%r@%h:%p
  ControlPersist 10m
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

## Doctor 输出格式

```json
{
  "ok": false,
  "workspace": "solar-runtime",
  "checks": [
    {"name": "cmux_exists", "ok": true},
    {"name": "ssh_mini_connect", "ok": true},
    {"name": "tmux_target_solar_0_0", "ok": false, "reason": "target_not_found"}
  ]
}
```

`ok=false` 时 exit code 为 1，便于 CI/healthcheck 集成。

## Non-Goals（第一阶段）

1. `capture` fallback 不做复杂 TUI 完美渲染
2. 不做可写交互控制面
3. 不重做 remote dispatch
4. 不把 cmux 工作台做成 remote tmux pane attach 协议层；默认首屏只做状态卡片
