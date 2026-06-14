# Open-API 递归 MECE 归属图（权威蓝图）

> **日期**: 2026-06-03
> **作者**: Chief Architecture Synthesizer（综合两个独立 MECE 校验视角 + 原始裁决）
> **范围**: `backend/src/modules/open-api/**`，134 个非 spec `.ts` 文件（208 含 spec）
> **状态**: 锁定。两个独立校验视角对 133 条 finalMap **完全一致**（同 gap、同 contested 解决、同 sameName 决定），仅 `admin/admin.module.ts` 为漏裁补回。

---

## 1. 最终顶层结构（锁定）

```
modules/open-api/
├── external/        非第一方 · API-key / 协议 / 签名鉴权
│   ├── a2a/         A2A v0.1 + v0.3 协议端点（agent-to-agent）
│   ├── mcp/         MCP Streamable HTTP 协议网关（Claude Code / Cursor 外部工具）
│   ├── rest/        原 public/ — 外部 REST facade（OpenClaw / web / mobile）
│   └── webhooks/    出站 webhook 派发 + 签名
│
├── admin/           第一方运营 · AdminGuard · 仅【跨域 / 平台级】治理
│   （providers / models / byok / secrets / billing / credits(admin) /
│     quota / permissions / settings / monitoring / observability / logs /
│     cache / db-ops / storage / approvals / notifications(admin) / eval /
│     consolidation / kernel / harness / agent(harness AgentConfig) /
│     ai(tools/skills/MCP governance) / recommendations / dashboard / mcp(监控)）
│   ※ 单域治理（research / knowledge / teams 模板）已从此处剥离 → T3 下沉 ai-app
│
├── system/          平台基建 / 握手 · 零业务
│   ├── auth/        登录 / token / 握手
│   └── metrics/     平台指标
│
└── user/            JWT 第一方登录用户 · 跨域通用能力
    ├── credits/         自助余额 / 签到（第一方）
    ├── notifications/   用户自助通知
    ├── agents/          通用 agent 执行 API（用户态）
    ├── skills/          SkillRegistry 浏览 / override（跨域只读暴露）
    ├── teams/           ⚠ 见注：HTTP mission 入口本应下沉 ai-app/teams（T3）
    └── ai/              通用第一方 AI 能力（chat / translate / model list）
```

> **关于 `user/teams`**：原始裁决把 `teams/teams.controller.ts`（mission HTTP，`class TeamsController`）判为 **sink-to-domain → ai-app/teams**（产品域明确）。任务给定的顶层模板把 teams 列在 `user/` 下作为"通用能力"占位，但 MECE 规则第 1 步优先：teams 是恰好一个产品域 → 应下沉。本图遵循 MECE 第 1 步，将 open-api 顶层 `teams/` 列为 **T3 跨层下沉**，`user/` 下不保留常驻 teams 区。若产品决定保留薄 mission 入口于 user 区，需单独评审（不在本轮）。

### 顶层区映射（旧 → 新）

| 旧顶层目录                                            | 新归属                                            | 性质                          |
| ----------------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| `a2a/`                                                | `external/a2a/`                                   | T1 移区                       |
| `mcp/`                                                | `external/mcp/`                                   | T1 移区                       |
| `public/`                                             | `external/rest/`（+ unsubscribe 拆出仍 external） | T1 移区 + split               |
| `webhooks/`                                           | `external/webhooks/`                              | T1 移区                       |
| `agents/`                                             | `user/agents/`                                    | T1 移区                       |
| `skills/`                                             | `user/skills/`                                    | T1 移区                       |
| `ai/`                                                 | `user/ai/`                                        | T1 移区（原地仅加 user 前缀） |
| `system/auth`,`system/metrics`,`system/system.module` | `system/*`                                        | 原地保留                      |
| `system/credits`,`system/notifications`               | `user/credits`,`user/notifications`               | T1 移区                       |
| `teams/`                                              | `ai-app/teams/`                                   | **T3 跨层下沉**               |
| `admin/`                                              | `admin/`（保留）+ 4 项单域下沉                    | T2 内部重组 + T3 下沉         |

---

## 2. 逐文件 / 逐目录迁移表（from → to + action + reason）

`from` 相对 `modules/open-api/`。`action` ∈ {move-zone(T1), split(T1), stay, sink-to-domain(T3)}。

### 2.1 external/a2a/（A2A 协议，API-key，非第一方）

| from                           | to              | action    | reason                                                                                             |
| ------------------------------ | --------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `a2a/a2a-server.controller.ts` | `external/a2a/` | move-zone | A2AApiKeyGuard + @Public，agent card 发现 + task；薄委托 ai-harness TeamsService/AgentCardRegistry |
| `a2a/a2a-rpc.controller.ts`    | `external/a2a/` | move-zone | A2A v0.3 JSON-RPC，纯委托 A2ARpcService（ai-harness/protocols/a2a）                                |
| `a2a/a2a.module.ts`            | `external/a2a/` | move-zone | L4 HTTP 暴露模块（A2AApiModule），服务基建留 ai-harness                                            |

### 2.2 external/mcp/（MCP 协议网关，API-key，非第一方）

| from                                         | to                           | action    | reason                                                       |
| -------------------------------------------- | ---------------------------- | --------- | ------------------------------------------------------------ |
| `mcp/mcp-server.controller.ts`               | `external/mcp/`              | move-zone | MCPApiKeyGuard + @Public，Streamable HTTP transport          |
| `mcp/mcp-server.service.ts`                  | `external/mcp/`              | move-zone | MCP JSON-RPC dispatch（thick，协议+metrics）                 |
| `mcp/mcp-server.module.ts`                   | `external/mcp/`              | move-zone | MCP server 模块，注册 5 curated handler                      |
| `mcp/guards/mcp-api-key.guard.ts`            | `external/mcp/guards/`       | move-zone | API-key guard，与 rest 共用 key pool                         |
| `mcp/abstractions/mcp-server.interface.ts`   | `external/mcp/abstractions/` | move-zone | 协议契约类型，聚合自带 abstractions                          |
| `mcp/filters/mcp-exception.filter.ts`        | `external/mcp/filters/`      | move-zone | JSON-RPC error envelope                                      |
| `mcp/gateway/mcp-session-manager.ts`         | `external/mcp/gateway/`      | move-zone | session 生命周期 + per-key 配额（thick，MCP-session-local）  |
| `mcp/streaming/mcp-streaming-bridge.ts`      | `external/mcp/streaming/`    | move-zone | SSE 连接桥                                                   |
| `mcp/bridge/mcp-tool-bridge.service.ts`      | `external/mcp/bridge/`       | move-zone | Registry→MCP tool 适配，经 facade 执行                       |
| `mcp/bridge/mcp-resource-provider.ts`        | `external/mcp/bridge/`       | move-zone | MCP resources/\* provider                                    |
| `mcp/bridge/mcp-prompt-provider.ts`          | `external/mcp/bridge/`       | move-zone | MCP prompts/\* provider                                      |
| `mcp/tools/research-tool-handler.ts`         | `external/mcp/tools/`        | move-zone | **协议 wrapper（IMCPToolHandler），非 research 域** — 不下沉 |
| `mcp/tools/ask-tool-handler.ts`              | `external/mcp/tools/`        | move-zone | 协议 wrapper，非 ask 域                                      |
| `mcp/tools/teams-tool-handler.ts`            | `external/mcp/tools/`        | move-zone | 协议 wrapper，非 teams 域                                    |
| `mcp/tools/content-analysis-tool-handler.ts` | `external/mcp/tools/`        | move-zone | 协议 wrapper                                                 |
| `mcp/tools/writing-assist-tool-handler.ts`   | `external/mcp/tools/`        | move-zone | 协议 wrapper，非 writing 域                                  |
| `mcp/tools/tool-timeout.ts`                  | `external/mcp/tools/`        | move-zone | MCP 执行 helper                                              |
| `mcp/index.ts`                               | `external/mcp/`              | move-zone | 桶导出                                                       |

> **MECE 锚点**：MCP 协议端点在 open-api/external；engine 的 `tools/mcp` 是 tool-source adapter（与 OpenAPI/function 同层），二者不同概念，互不迁移。

### 2.3 external/rest/（原 public，外部 REST，API-key）

| from                                             | to                                                           | action    | reason                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------ | --------- | -------------------------------------------------------------------------- |
| `public/public.controller.ts`                    | `external/rest/`                                             | move-zone | MCPApiKeyGuard + @Public，REST facade，委托 AIFacade/ChatFacade/ToolFacade |
| `public/public.module.ts`                        | `external/rest/`（**split**）                                | split     | PublicController→rest 模块；UnsubscribeController 拆出独立 external wiring |
| `public/notifications/unsubscribe.controller.ts` | `external/rest/notifications/` 或 `external/`（独立 wiring） | move-zone | 匿名 7d-JWT token 退订，非第一方 → external                                |
| `public/dto/research.dto.ts`                     | `external/rest/dto/`                                         | move-zone | REST 入参 DTO                                                              |
| `public/dto/ask.dto.ts`                          | `external/rest/dto/`                                         | move-zone | REST 入参 DTO                                                              |
| `public/dto/chat.dto.ts`                         | `external/rest/dto/`                                         | move-zone | REST 入参 DTO                                                              |
| `public/dto/debate.dto.ts`                       | `external/rest/dto/`                                         | move-zone | REST 入参 DTO                                                              |
| `public/dto/writing.dto.ts`                      | `external/rest/dto/`                                         | move-zone | REST 入参 DTO                                                              |
| `public/dto/analyze-content.dto.ts`              | `external/rest/dto/`                                         | move-zone | REST 入参 DTO                                                              |

> **split 说明**：`public.module.ts` 同时挂 PublicController（外部 REST）与 UnsubscribeController（token-only 退订）。拆为：rest 模块 + 退订独立 wiring（仍落 external）。路由 URL 本轮不变。

### 2.4 external/webhooks/（出站 webhook，签名）

| from                                     | to                       | action    | reason                            |
| ---------------------------------------- | ------------------------ | --------- | --------------------------------- |
| `webhooks/webhooks.controller.ts`        | `external/webhooks/`     | move-zone | webhook 管理/派发，非第一方回调面 |
| `webhooks/webhooks.service.ts`           | `external/webhooks/`     | move-zone | webhook 业务                      |
| `webhooks/webhook-dispatcher.service.ts` | `external/webhooks/`     | move-zone | 派发器                            |
| `webhooks/webhooks.module.ts`            | `external/webhooks/`     | move-zone | 模块                              |
| `webhooks/dto/index.ts`                  | `external/webhooks/dto/` | move-zone | DTO 桶                            |
| `webhooks/index.ts`                      | `external/webhooks/`     | move-zone | 桶导出                            |

### 2.5 user/agents/（通用 agent 执行 API，JWT）

| from                                  | to                 | action    | reason                                                   |
| ------------------------------------- | ------------------ | --------- | -------------------------------------------------------- |
| `agents/agents.controller.ts`         | `user/agents/`     | move-zone | JWT 第一方，通用 agent 执行（用户态 agents-API），跨域   |
| `agents/agents.service.ts`            | `user/agents/`     | move-zone |                                                          |
| `agents/agents.module.ts`             | `user/agents/`     | move-zone |                                                          |
| `agents/agents-task-queue.service.ts` | `user/agents/`     | move-zone | 任务队列                                                 |
| `agents/agents-task.processor.ts`     | `user/agents/`     | move-zone | 任务处理器                                               |
| `agents/dto/index.ts`                 | `user/agents/dto/` | move-zone |                                                          |
| `agents/dto/agent-config.dto.ts`      | `user/agents/dto/` | move-zone | ⚠ 与 admin/agent harness AgentConfig 同名异概念（见 §3） |
| `agents/dto/execute-request.dto.ts`   | `user/agents/dto/` | move-zone |                                                          |
| `agents/dto/execute-response.dto.ts`  | `user/agents/dto/` | move-zone |                                                          |
| `agents/dto/task-response.dto.ts`     | `user/agents/dto/` | move-zone |                                                          |
| `agents/dto/status-response.dto.ts`   | `user/agents/dto/` | move-zone |                                                          |
| `agents/dto/cancel-response.dto.ts`   | `user/agents/dto/` | move-zone |                                                          |
| `agents/index.ts`                     | `user/agents/`     | move-zone |                                                          |

### 2.6 user/skills/（SkillRegistry 浏览/override，JWT）

| from                                    | to                 | action    | reason                                                                                 |
| --------------------------------------- | ------------------ | --------- | -------------------------------------------------------------------------------------- |
| `skills/skills.controller.ts`           | `user/skills/`     | move-zone | engine SkillRegistry 浏览/override 跨域暴露；SkillRegistry 源仍唯一在 ai-engine/skills |
| `skills/skills.service.ts`              | `user/skills/`     | move-zone |                                                                                        |
| `skills/skills.module.ts`               | `user/skills/`     | move-zone |                                                                                        |
| `skills/dto/set-domain-override.dto.ts` | `user/skills/dto/` | move-zone |                                                                                        |
| `skills/index.ts`                       | `user/skills/`     | move-zone |                                                                                        |

### 2.7 user/ai/（通用第一方 AI 能力，JWT/optional）

| from                  | to         | action                 | reason                                                           |
| --------------------- | ---------- | ---------------------- | ---------------------------------------------------------------- |
| `ai/ai.controller.ts` | `user/ai/` | stay（原地→user 前缀） | 通用 chat/translate/model list，`class AiController`，第一方跨域 |
| `ai/ai.service.ts`    | `user/ai/` | stay                   |                                                                  |
| `ai/ai.module.ts`     | `user/ai/` | stay                   |                                                                  |
| `ai/index.ts`         | `user/ai/` | stay                   |                                                                  |

> stay 含义：归属区已对（user），物理目录从 `open-api/ai` 收进 `open-api/user/ai`。

### 2.8 system/（平台基建，零业务）

| from                                              | to                    | action    | reason                                                              |
| ------------------------------------------------- | --------------------- | --------- | ------------------------------------------------------------------- |
| `system/system.module.ts`                         | `system/`             | stay      | 系统模块容器                                                        |
| `system/auth/auth.controller.ts`                  | `system/auth/`        | stay      | 登录/token 握手，零业务                                             |
| `system/metrics/metrics.controller.ts`            | `system/metrics/`     | stay      | 平台指标                                                            |
| `system/credits/credits.controller.ts`            | `user/credits/`       | move-zone | JWT 第一方自助余额/签到，跨域平台资源 → user（非 admin、非 system） |
| `system/notifications/notification.controller.ts` | `user/notifications/` | move-zone | 用户自助通知 → user                                                 |

### 2.9 admin/ — T3 单域下沉（4 项）

| from                                       | to                                                                                               | action         | reason                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------- |
| `admin/research/research.controller.ts`    | `ai-app/research`（admin 控制器）                                                                | sink-to-domain | 恰好 research 单域治理 → 下沉                                                 |
| `admin/knowledge/knowledge.controller.ts`  | `ai-app/library`（admin 控制器）                                                                 | sink-to-domain | knowledge 属 library 单域                                                     |
| `admin/teams/ai-teams.controller.ts`       | `ai-app/teams`（**落地重命名** `ai-teams-admin.controller.ts` / `class AITeamsAdminController`） | sink-to-domain | teams 单域；目标 `ai-app/teams` 已有 `AiTeamsController`，须改名消歧（见 §3） |
| `admin/teams/ai-teams-admin.service.ts`    | `ai-app/teams`                                                                                   | sink-to-domain | 随控制器下沉，委托对象                                                        |
| `admin/dto/ai-team.dto.ts`                 | `ai-app/teams`                                                                                   | sink-to-domain | teams admin DTO，随其控制器                                                   |
| `admin/dto/research-template-admin.dto.ts` | `ai-app/research`                                                                                | sink-to-domain | research 模板 DTO，随其控制器                                                 |

> 内嵌于 `admin/teams/ai-teams.controller.ts` 的 `AITeamsTemplatesController`（route `ai-teams/templates`，JWT-only 公共模板读）同文件下沉 teams；**T3 可再分区到 user**（用户面模板读），本轮不拆。

### 2.10 admin/ — 留守 open-api/admin（跨域/平台级治理，stay）

> 以下全部 AdminGuard 且治理【跨域/平台级/engine级/harness级】资源 → 留 admin。物理上 `open-api/admin/<region>/`，action=stay。

| from                                                                                                                                                  | reason（留守）                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `admin/admin.controller.ts` / `admin.service.ts` / `admin.module.ts`                                                                                  | admin 区根容器/根控制器，管控整个 admin region（漏裁补回；模块容器跟随其 region，永不下沉）                                             |
| `admin/recommendations/model-recommendations.controller.ts`                                                                                           | 平台模型推荐，跨域                                                                                                                      |
| `admin/eval/eval.controller.ts`                                                                                                                       | 平台级评测治理                                                                                                                          |
| `admin/consolidation/consolidation.controller.ts` + `dto/update-consolidation-config.dto.ts`                                                          | memory consolidation 平台配置                                                                                                           |
| `admin/ai/ai.controller.ts`（`class AiAdminController`）                                                                                              | tools/skills/MCP 治理，跨域平台                                                                                                         |
| `admin/ai/ai-admin.service.ts` / `tool-secret-health.helper.ts` / `tool-test-result.helper.ts`                                                        | 同上                                                                                                                                    |
| `admin/providers/ai-providers.controller.ts` / `provider-discovery.controller.ts` / `api-formats.controller.ts` / `model-types.controller.ts`         | 平台 LLM provider 目录/发现，跨域（非 byok 用户态、非 engine adapter）                                                                  |
| `admin/agent/agent.controller.ts`                                                                                                                     | 委托 ai-harness AgentConfigService（harness 级、跨域 runtime agent 定义）→ 留守（**非 custom-agents 产品域**，见 §3）                   |
| `admin/harness/harness-inspector.controller.ts`                                                                                                       | harness 级巡检                                                                                                                          |
| `admin/kernel/kernel.controller.ts`                                                                                                                   | 平台 kernel 治理                                                                                                                        |
| `admin/mcp/external-servers.controller.ts` / `server.controller.ts` / `external-servers.dto.ts`                                                       | engine MCPClientRegistry 连接 CRUD + 网关监控（运营治理，非协议面）                                                                     |
| `admin/byok/admin-byok-dashboard.controller.ts` / `admin-key-assignments.controller.ts` / `admin-key-requests.controller.ts` / `byok-admin.module.ts` | BYOK 平台运营                                                                                                                           |
| `admin/secrets/secrets.controller.ts` / `secret-keys.controller.ts`                                                                                   | 平台密钥治理                                                                                                                            |
| `admin/billing/billing.controller.ts`                                                                                                                 | 平台计费                                                                                                                                |
| `admin/credits/admin-credits.controller.ts`（`class AdminCreditsController`）                                                                         | 平台积分授予/冻结治理（区别于 user/credits 自助，见 §3）                                                                                |
| `admin/permissions/permissions.controller.ts`                                                                                                         | 平台权限                                                                                                                                |
| `admin/quota/*`（controller/service/module/types + providers/\*：base/anthropic/openai/unavailable）                                                  | 平台配额治理                                                                                                                            |
| `admin/monitoring/monitoring.controller.ts`                                                                                                           | 平台监控                                                                                                                                |
| `admin/observability/observability.controller.ts`                                                                                                     | 平台可观测                                                                                                                              |
| `admin/logs/logs.controller.ts`                                                                                                                       | 平台日志                                                                                                                                |
| `admin/cache/cache.controller.ts`                                                                                                                     | 平台缓存                                                                                                                                |
| `admin/db-ops/db-ops.controller.ts`                                                                                                                   | 平台 DB 运维                                                                                                                            |
| `admin/notifications/notifications.controller.ts`（`class NotificationsAdminController`）                                                             | 广播/运营通知（区别于 user 自助、external 退订，见 §3）                                                                                 |
| `admin/approvals/approvals.controller.ts`                                                                                                             | 平台审批流                                                                                                                              |
| `admin/settings/settings.controller.ts`                                                                                                               | 平台设置                                                                                                                                |
| `admin/dashboard/ops-dashboard.controller.ts` / `ops-dashboard.service.ts` / `dto/ops-dashboard.dto.ts`                                               | 运营总览                                                                                                                                |
| `admin/services/*`（index + user-management / resource-management / statistics / logs / permissions / billing / notifications-admin）                 | admin 根服务集，跨域运营                                                                                                                |
| `admin/dto/create-user.dto.ts`                                                                                                                        | 用户管理 DTO                                                                                                                            |
| `admin/dto/agent-config-admin.dto.ts`                                                                                                                 | **覆盖原裁决**：仅被 `admin/agent/agent.controller.ts` 消费，治理 harness AgentConfig（跨域）→ 留守，不下沉 custom-agents（见 §3 + §4） |
| `admin/utils/mask-sensitive-setting.utils.ts`                                                                                                         | 敏感设置脱敏工具                                                                                                                        |

### 2.11 teams/ — T3 跨层下沉

| from                        | to                                                      | action         | reason                                |
| --------------------------- | ------------------------------------------------------- | -------------- | ------------------------------------- |
| `teams/teams.controller.ts` | `ai-app/teams`（`class TeamsController`，mission HTTP） | sink-to-domain | teams 恰好单一产品域；HTTP 在 L3 合法 |
| `teams/teams.module.ts`     | `ai-app/teams`（**须与现有 ai-teams.module 去重合并**） | sink-to-domain | 避免重复模块名                        |
| `teams/index.ts`            | `ai-app/teams`                                          | sink-to-domain | 桶导出                                |

---

## 3. 同名消歧决定（全项目唯一性）

| 概念                           | 决定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **agent-config（DTO/控制器）** | `admin/agent/agent.controller.ts` + `admin/dto/agent-config-admin.dto.ts` 治理 ai-harness **AgentConfigService**（平台/harness 级 runtime agent 定义，`domain` 字段横跨 research/writing 等，跨域）→ 两者**同住 open-api/admin，均 stay**。与 custom-agents 产品域（`ai-app/custom-agents`，独立 CustomAgentsService，route `user/custom-agents`）、与 user agents-API（`user/agents`）三者**截然不同**。**DTO 不下沉**。                                                                        |
| **credits**                    | `user/credits`（first-party 自助余额/签到，保留名 credits）；`admin/credits/admin-credits.controller.ts`（`AdminCreditsController`，平台授予/冻结）。均跨域平台资源、非产品域；user vs admin 区消歧，本轮均保留 route URL。                                                                                                                                                                                                                                                                      |
| **notifications**              | 三个不同控制器三区：`user/notifications`（用户自助）/ `admin/notifications`（`NotificationsAdminController`，广播运营）/ `external`（`unsubscribe.controller`，token 签名匿名退订）。底层 NotificationService 留平台 L1；class 名已各异，无需改名。                                                                                                                                                                                                                                              |
| **teams**                      | engine/teams(框架 Registry) · harness/teams(mission 执行) · ai-app/teams(业务:辩论) 三层各留。open-api `teams/teams.controller.ts`（`TeamsController`，route `ai/teams`）+ `admin/teams/*` 均 **sink → ai-app/teams**（不同文件入同一域，非 overlap）。落地须：(a) `admin` 版改名 `ai-teams-admin.controller.ts`/`AITeamsAdminController`（现有 `AiTeamsController` 已占名）；(b) TeamsApiModule 与现有 `ai-teams.module` 合并去重。MCP `teams-tool-handler` 留 external（协议 wrapper，非域）。 |
| **mcp**                        | `external/mcp/*`（外部协议网关）· `admin/mcp/*`（网关监控 + engine MCPClientRegistry 连接 CRUD，跨域平台运营）· `ai-engine tools/mcp`（tool-source adapter）三者不同信任边界/不同层，全部分立。                                                                                                                                                                                                                                                                                                  |
| **ai**                         | `user/ai`（`AiController`，通用第一方 chat/translate/model list）· `admin/ai`（`AiAdminController`，tools/skills/MCP 治理）。audience-prefixed class 名已消歧，均原地（各自区）。`diagnose`/`list-google-models` 端点 T3 可议是否移 admin。                                                                                                                                                                                                                                                      |
| **providers**                  | `admin/providers/*`（ai-providers / api-formats / model-types / provider-discovery）治理平台 LLM provider 目录/模型 → 全留 admin。区别于 byok 用户态 provider keys（user/byok）与 ai-engine/llm provider 适配器。**不下沉任何产品域**。                                                                                                                                                                                                                                                          |
| **skills**                     | `user/skills`（engine SkillRegistry 浏览/override 跨域暴露）· admin/ai 内 skills 治理留 admin。SkillRegistry 源唯一在 `ai-engine/skills`，open-api 仅暴露。                                                                                                                                                                                                                                                                                                                                      |

---

## 4. 分级执行计划

### Tier 1 — 非破坏顶层区搬迁（move-zone / split，路由 URL 不变）

> 纯目录归位，全部在 open-api 内，import 路径相对调整。**42 文件**（external 36 含 a2a/mcp/rest/webhooks，user agents 13、skills 5、ai 4 收进 user，system→user 的 credits/notifications 2）。

| from                                                     | to                                         |
| -------------------------------------------------------- | ------------------------------------------ |
| `a2a/*`（3）                                             | `external/a2a/`                            |
| `mcp/**`（18）                                           | `external/mcp/`                            |
| `public/**`（9，含 split：unsubscribe 独立 wiring）      | `external/rest/`（+ external 退订 wiring） |
| `webhooks/**`（6）                                       | `external/webhooks/`                       |
| `agents/**`（13）                                        | `user/agents/`                             |
| `skills/**`（5）                                         | `user/skills/`                             |
| `ai/**`（4）                                             | `user/ai/`                                 |
| `system/credits/credits.controller.ts`                   | `user/credits/`                            |
| `system/notifications/notification.controller.ts`        | `user/notifications/`                      |
| `system/auth`,`system/metrics`,`system/system.module.ts` | `system/`（原地）                          |

verify: `npm run verify:arch` 全绿；`npm run type-check` 0 error；所有 @Controller 路由 URL 与迁移前 diff 为空。

### Tier 2 — admin 内部重归属（仍 open-api/admin，不改路由）

> admin 区内部按"跨域/平台级治理"收敛为单一 admin 区；留守清单见 §2.10。本层**不移层、不改 URL**，仅确认所有留守文件确为跨域/平台级（已逐一核验），并把 `admin/admin.module.ts`（漏裁补回）确认为 admin 区根容器 stay。

| 项                                    | 处理                                            | reason                                                                                                    |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `admin/admin.module.ts`               | 确认 stay（root container）                     | 漏裁补回（134 实际 vs 133 裁决）；模块容器跟随 region，永不下沉                                           |
| `admin/dto/agent-config-admin.dto.ts` | **覆盖→ stay admin**（原裁 sink custom-agents） | 仅 `admin/agent/agent.controller.ts` 消费，治理 harness AgentConfig（跨域），DTO 不能与唯一消费控制器异家 |
| 全部 §2.10 留守项                     | 维持 admin                                      | 均 AdminGuard + 跨域/平台级                                                                               |

verify: `git grep -l agent-config-admin` 仅 `admin/agent/*`；admin 区无单域治理残留（research/knowledge/teams 模板已列 T3）。

### Tier 3 — 破坏性：跨层下沉 ai-app + 路由 URL 变更（仅标注，不在本图执行）

> 跨 L4→L3 下沉，且部分伴随 route URL 改动。**本轮不执行**，仅锁定目标与风险。

| 项                                                                                      | 变更                                                                                      | 风险                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `teams/teams.controller.ts` (+module+index)                                             | 下沉 `ai-app/teams`；TeamsApiModule 与现有 `ai-teams.module` 去重合并                     | 模块名/路由聚合冲突；前端 `ai/teams` 调用方需回归           |
| `admin/teams/ai-teams.controller.ts` (+service+ai-team.dto)                             | 下沉 `ai-app/teams`，**落地改名** `ai-teams-admin.controller.ts`/`AITeamsAdminController` | 与现有 `AiTeamsController` 同名碰撞；改名后 import 全量更新 |
| `admin/teams` 内嵌 `AITeamsTemplatesController`（route `ai-teams/templates`，JWT-only） | 随文件下沉 teams；T3 可再分区到 **user**（用户面模板读）                                  | 分区后路由归属待定                                          |
| `admin/research/research.controller.ts` (+research-template-admin.dto)                  | 下沉 `ai-app/research` admin 控制器                                                       | 路由前缀可能由 `admin/research` 调整                        |
| `admin/knowledge/knowledge.controller.ts`                                               | 下沉 `ai-app/library` admin 控制器                                                        | knowledge↔library 边界确认                                  |
| route URL 标注                                                                          | `a2a/tasks`(legacy) vs v0.1 well-known、`public`→`rest`、admin 单域前缀                   | 所有 URL 改动一律 T3，本轮保持原 URL                        |

verify（T3 执行时）: 下沉后 `engine/harness/platform 零 controller`；改名后 `verify:arch` 同名唯一性断言通过；前端调用方路由回归全绿。

---

## 5. 建议的 `open-api-structure.spec` 顶层白名单

> 落到 `backend/src/__tests__/architecture/`，与现有 layer-\* 套件并列。断言 open-api 顶层只允许 4 区，区内 external/system/user 子目录受控，admin 仅跨域/平台级。

```ts
// open-api-structure.spec.ts —— 顶层白名单 + MECE 硬约束
const OPEN_API_TOP_LEVEL = ["external", "admin", "system", "user"] as const;

const EXTERNAL_CHILDREN = ["a2a", "mcp", "rest", "webhooks"] as const;
const SYSTEM_CHILDREN = ["auth", "metrics"] as const;
const USER_CHILDREN = [
  "credits",
  "notifications",
  "agents",
  "skills",
  "ai",
] as const;
//   ※ teams 不在 user 常驻白名单：mission HTTP 应下沉 ai-app/teams（T3）

describe("open-api structure (MECE top-level)", () => {
  it("open-api 顶层只含 4 区", () => {
    expect(listDirs("modules/open-api")).toEqual(
      expect.arrayContaining([...OPEN_API_TOP_LEVEL]),
    );
    expect(
      listDirs("modules/open-api").filter(
        (d) => !OPEN_API_TOP_LEVEL.includes(d as any),
      ),
    ).toEqual([]); // 禁止 a2a/mcp/public/teams/agents/skills/ai 残留在顶层
  });

  it("external 子目录受控", () => {
    expect(
      listDirs("modules/open-api/external").filter(
        (d) => !EXTERNAL_CHILDREN.includes(d as any),
      ),
    ).toEqual([]);
  });

  it("system 零业务（仅 auth/metrics）", () => {
    expect(
      listDirs("modules/open-api/system").filter(
        (d) => !SYSTEM_CHILDREN.includes(d as any),
      ),
    ).toEqual([]);
  });

  it("user 跨域通用能力子目录受控", () => {
    expect(
      listDirs("modules/open-api/user").filter(
        (d) => !USER_CHILDREN.includes(d as any),
      ),
    ).toEqual([]);
  });

  it("admin 仅跨域/平台级：禁止单域治理目录", () => {
    // 单域治理必须 sink-to-domain，不得出现在 admin
    const FORBIDDEN_IN_ADMIN = [
      "research",
      "knowledge",
      "teams",
      "writing",
      "ask",
      "image",
      "social",
      "simulation",
      "office",
      "explore",
      "topic-insights",
      "custom-agents",
    ];
    const present = listDirs("modules/open-api/admin");
    FORBIDDEN_IN_ADMIN.forEach((d) => expect(present).not.toContain(d)); // admin/research|knowledge|teams 应已 T3 下沉
  });

  it("HTTP 只在 L3/L4：engine/harness/platform 禁挂 controller", () => {
    expect(
      findControllers([
        "modules/ai-engine",
        "modules/ai-harness",
        "modules/ai-infra",
      ]),
    ).toEqual([]);
  });

  it("同名唯一性：SkillRegistry/ToolRegistry 源唯一，admin 不含 *teams* 与 ai-app/teams 同名 class", () => {
    expect(countClass("AiTeamsController")).toBeLessThanOrEqual(1); // admin 版须 AITeamsAdminController
    expect(countSource("class ToolRegistry")).toBe(1);
    expect(countSource("class SkillRegistry")).toBe(1);
  });
});
```

> **spec 规则口径**（specRule）：open-api 顶层目录 ⊆ {external, admin, system, user}；external⊆{a2a,mcp,rest,webhooks}；system⊆{auth,metrics}；user⊆{credits,notifications,agents,skills,ai}；admin 禁含任一产品域目录（单域治理必须 sink-to-domain）；engine/harness/platform 零 controller；同名 class 全项目唯一（AiTeamsController ≤1，ToolRegistry/SkillRegistry 源各 =1）。

---

## 6. 综合者裁决摘要（两视角一致性 + 覆盖）

- **覆盖**：133 裁决 + 1 漏裁补回（`admin/admin.module.ts`）= 134 实际文件，零幻影、零遗漏。
- **overlaps**：两视角均报 0。
- **contested 全部已决**：
  1. `agent-config-admin.dto.ts` → **覆盖为 stay open-api/admin**（仅被 harness-AgentConfig 控制器消费，跨域，DTO 不可异家于唯一消费者）。已 grep 核实：消费者仅 `admin/agent/agent.controller.ts`(+spec)，其 import `AgentConfigService` from `ai-harness/facade`。
  2. `admin/teams/ai-teams.controller.ts` → sink 正确，**落地改名 AITeamsAdminController**（现有 `ai-app/teams/controllers/ai-teams.controller.ts` 已定义 `class AiTeamsController`，已核实碰撞）。
  3. 内嵌 `AITeamsTemplatesController` → 随 teams 下沉，T3 可再分区 user。
- **本轮执行边界**：仅 T1（移区）+ T2（admin 内部确认/DTO 覆盖），不改任何 @Controller 路由 URL。T3 跨层下沉 + URL 变更仅标注。

---

**最后更新**: 2026-06-03
**维护者**: Chief Architecture Synthesizer
