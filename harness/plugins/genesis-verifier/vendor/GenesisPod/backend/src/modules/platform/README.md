# platform

> 平台基础设施层（`L1` ai-infra）。负责认证、凭证与配置资产、额度账本、存储底座、数据库运维、监控、通知、邮件、发布与韧性底座等系统运维能力。

## 定位

`platform/` 是 `L1` 基础设施层（ai-infra）。

判断口径只有一条：

- 不需要知道 `agent` / `mission` / 具体 AI 业务语义，也能独立成立的底座能力，归 `ai-infra`

依赖方向严格单向：

- `ai-app -> ai-harness -> ai-engine -> platform (ai-infra)`
- `platform` 不得反向依赖上层模块

## 当前顶层

```text
platform/
├── abstractions/        # 共享 DI token 与基础抽象（ai-services.interface 等）
├── auth/                # 认证与用户身份（controller / guards / strategies）
├── credentials/         # 凭证基础设施：BYOK、密钥解析、加解密、用户模型配置、分发/申请/调度、secrets（详见子 README）
├── credits/             # 通用额度账本与额度规则（policy / rewards）
├── db-ops/              # 数据库运维：表清单、诊断、保留策略与治理操作（catalogs / policies）
├── email/               # 邮件发送底座（template / templates / presets）
├── facade/              # 对外稳定入口（仅 re-export 受控符号）
├── monitoring/          # 监控：指标、健康检查、错误跟踪、审计、tracing
├── notifications/       # 站内通知基础能力（dispatcher / presets / gateway）
├── release/             # 版本发布与公告发布底座
├── resilience/          # 韧性原语：circuit-breaker / token-bucket / abortable-scope
├── settings/            # 系统设置
└── storage/             # 对象存储与存储治理（runtime / governance）
```

> secrets / 加解密原语现归在 `credentials/` 子域（`credentials/secrets`、`credentials/encryption`），不再作为 platform 顶层目录。

## 明确边界

- `credentials/` 只允许存在于 `platform`
  - `ai-engine` 不再保留顶层 `credentials/`
  - engine 侧仅允许保留 `llm/user-config` 这类 LLM 配套能力
  - secrets / encryption / key-health 现作为 `credentials/` 子域

- `db-ops/` 保留在 `platform`
  - 它表达的是数据库运维治理，不是业务域“表管理”
  - `data-retention.service.ts` 归属数据库保留策略，不再挂在 `monitoring/`
  - 允许提供管理员诊断/清理能力，但不承载 app 领域策略

- `storage/` 保留在 `platform`
  - 对象存储、R2/B2 适配、存储盘点、离线清理属于基础设施
  - `governance/` 是当前治理聚合入口，`runtime/` 是对象存储运行时
  - 围绕单一业务对象的包装器不应长期留在 infra core

- `credits/` 保留在 `platform`
  - `credits.service.ts` 负责 ledger/quota core
  - `policy/` 放计费规则
  - `rewards/` 放通用奖励策略
  - 不允许把 app 级产品编排逻辑直接堆到 core 账本层

- `backend/prisma/` 不属于 `platform`
  - 它是 workspace 级 schema / migrations / seed / SQL 资产层

- `src/common/prisma/` 也不属于 `platform` 顶层目录
  - 它是全仓共享的运行时持久化底座

## 后续收敛重点

- `credits/` 继续拆清“通用账本”与“产品线计费策略”
- `storage/` 继续拆清“对象存储 runtime”与“存储治理任务”
- `notifications/`、`settings/`、`release/` 继续复核是否存在 app 领域语义渗入
