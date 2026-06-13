# open-api 递归 MECE 重组方案 —— 单轴：调用方信任边界

> 状态：**设计稿，未执行**。执行需等并发的 arch-mece 会话（wave1/wave2a）落地后协调，避免同工作区冲突。
> 决策日期：2026-06-03 · 顶层主轴：**调用方信任边界（Axis A）**

## 1. 问题诊断（实测，非推断）

当前 `open-api/` 顶层同时混用三个划分轴 → 必然不 Mutually Exclusive：

| 轴        | 占用的顶层目录                 |
| --------- | ------------------------------ |
| 协议/传输 | `a2a` `mcp` `webhooks`         |
| 受众/角色 | `admin` `public` `system`      |
| 业务资源  | `agents` `ai` `skills` `teams` |

### 1.1 ME 被打穿的实锤（同名概念散落多处）

| 概念          | 出现位置                                                                        |
| ------------- | ------------------------------------------------------------------------------- |
| notifications | `system/notifications` + `public/notifications` + `admin/notifications`（3 处） |
| credits       | `system/credits` + `admin/credits`                                              |
| teams         | `teams/` + `admin/teams`                                                        |
| mcp           | `mcp/` + `admin/mcp`（external-servers + server）                               |
| ai            | `ai/` + `admin/ai`                                                              |

### 1.2 dir↔route 错位

- `teams/` 目录 → 路由前缀实际是 `ai/teams`
- `public/notifications/unsubscribe` → 路由 `notifications/unsubscribe`，与 `system/notifications` 撞名

### 1.3 admin/ 自身是反 MECE 重灾区

36 controllers / ~27 resource 子目录，在 admin 内部又复刻了一份顶层资源树（`admin/ai`/`admin/teams`/`admin/mcp`/`admin/credits`/`admin/notifications`），与顶层资源目录互相穿插。

## 2. 目标结构（Axis A：顶层只按"谁在调 + 怎么鉴权"）

> **实测修正（2026-06-03）**：`system/credits`、`system/notifications` 仅挂 `JwtAuthGuard`、无 `AdminGuard` →
> 是**已登录终端用户管自己**的端点。信任边界轴因此有 **4 个值**，不是 3 个：匿名第三方 ≠ 登录用户。

```
open-api/
  public/        # 匿名 / 第三方，api-key 鉴权，版本化对外契约（破坏即破坏别人集成）
    ask/ research/ teams/ skills/ agents/ ai/ ...
  user/          # 已登录终端用户（自家前端），JWT，只管自己的资源
    credits/ notifications/ ...
  admin/         # admin role，内部受信，可随前端 churn 重构
    billing/ providers/ kernel/ knowledge/ monitoring/ credits/ notifications/ ...
  system/        # 平台基建，零业务：auth handshake / health / metrics
    auth/ metrics/
  _transports/   # 正交轴：协议适配器，只做协议转换、零业务逻辑
    mcp/ a2a/ webhooks/
```

> **边界存疑（与"open-api vs ai-app 为何不归一"同源）**：`user/` 桶里的 credits/notifications 是纯第一方
> 用户 API，和 ai-app 的归属是糊的。若判定它们本就属 app 的用户域，可整体移出 open-api → ai-app；
> open-api 只保留真·对外（public）+ 对外管理（admin）+ 协议（\_transports）+ 平台握手（system）。**待定**。

### 关键判定

1. **资源单例其实都是 public**：`agents`/`ai`/`skills`/`teams` 路由全是对外第三方 API，从来不是 admin/system 的同级 → collapse 进 `public/`。它们之所以看着像独立轴，是因为顶层轴没定。
2. **协议族不是受众的同级**：`a2a`/`mcp`/`webhooks` 是传输方式（正交轴），降为 `_transports/` 子层，**只转换协议、不放业务**。
3. **同名不再是重复**：`system/credits`(用户自查) vs `admin/credits`(管理员调额) 在受众轴纪律下是两个本就不同的端点；保留，但**类名/路由必须显式带受众**消歧。
4. **`_transports/mcp` ≠ `admin/mcp`**：前者是 MCP 协议端点，后者是管理员对 MCP server 配置的 CRUD → 不同概念，admin 侧重命名为 `admin/mcp-servers/` 消歧。

## 3. 迁移映射表（顶层）

| 当前                           | 目标                                          | 动作                                                                       |
| ------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| `a2a/`                         | `_transports/a2a/`                            | git mv                                                                     |
| `mcp/`                         | `_transports/mcp/`                            | git mv                                                                     |
| `webhooks/`                    | `_transports/webhooks/`                       | git mv                                                                     |
| `agents/`                      | `public/agents/`                              | git mv                                                                     |
| `ai/`                          | `public/ai/`                                  | git mv                                                                     |
| `skills/`                      | `public/skills/`                              | git mv                                                                     |
| `teams/`                       | `public/teams/`                               | git mv + 修路由 `ai/teams`→`teams`（破坏性，需确认是否保留旧路由别名）     |
| `public/`                      | `public/`（保留）                             | 内部归并 notifications                                                     |
| `system/credits`               | `user/credits/`（JWT 用户自查，已核实）       | git mv；或整体移出 → ai-app（见 §2 边界存疑）                              |
| `system/notifications`         | `user/notifications/`（JWT 用户自管，已核实） | git mv；与 admin/public 两侧靠桶名天然消歧                                 |
| `system/auth` `system/metrics` | `system/`（保留）                             | 纯基建，不动                                                               |
| `admin/*`                      | `admin/*`（保留顶层桶）                       | 顶层 ai/teams/mcp 移走后，admin/\* 成为唯一 admin 版本，跨顶层撞名自动消除 |
| `admin/mcp`                    | `admin/mcp-servers/`                          | 重命名消歧（vs `_transports/mcp`）                                         |

## 4. 执行前必须确认/核实

1. **路由破坏性**：`teams` 路由从 `ai/teams` 改为 `teams` 会破坏已对接的外部调用方 → 是否需保留旧路由 6 个月别名？
2. **credits / notifications 的真实语义**：`system/credits`、`system/notifications` 到底面向终端用户还是平台 —— 必须 Read controller 确认后再定归 public 还是 admin。
3. **并发会话**：主工作区当前有另一会话正在跑 arch-mece（wave1/wave2a，正在删 `-admin` controller、重组 open-api）。本方案与其高度重叠，**执行必须等其落地后基于最新 main 重做映射**，否则同工作区互相破坏。
4. **arch-spec 看护**：新增一条 spec 钉死"open-api 顶层目录 ∈ {public, admin, system, \_transports}"，防止未来再混轴。

## 5. 不做什么

- 不在本稿中改任何代码。
- 不碰 `_transports` 适配器内的业务（它们本就该零业务，若发现业务先走 thin-gateway 下沉，与 std24 一致）。
- 不为"未来可能的协议"预留空目录（YAGNI）。
