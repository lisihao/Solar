# L1 AI Infrastructure

> 平台基础设施层（目录名 `platform`，旧称 `ai-infra`）。认证、密钥与配置资产、额度账本、存储底座、数据库运维、监控与系统运维能力。
> 单一信息源：[`backend/src/modules/platform/README.md`](../../../backend/src/modules/platform/README.md)

## 顶层模块

| 模块             | 代码路径                  | 职责                                  |
| ---------------- | ------------------------- | ------------------------------------- |
| `abstractions/`  | `platform/abstractions/`  | 共享 DI token 与基础抽象              |
| `auth/`          | `platform/auth/`          | 认证与用户身份                        |
| `credentials/`   | `platform/credentials/`   | BYOK、密钥解析、用户模型配置、secrets |
| `credits/`       | `platform/credits/`       | 通用额度账本、policy、rewards         |
| `db-ops/`        | `platform/db-ops/`        | 表统计、诊断、清理、retention         |
| `email/`         | `platform/email/`         | 邮件发送底座                          |
| `facade/`        | `platform/facade/`        | 对外稳定入口                          |
| `monitoring/`    | `platform/monitoring/`    | 指标、健康检查、错误跟踪              |
| `notifications/` | `platform/notifications/` | 站内通知基础能力                      |
| `release/`       | `platform/release/`       | 版本发布与公告                        |
| `resilience/`    | `platform/resilience/`    | 引擎级弹性与熔断基元                  |
| `settings/`      | `platform/settings/`      | 系统设置                              |
| `storage/`       | `platform/storage/`       | 对象存储（R2/B2）+ governance         |

> **路径说明**：真实后端目录为 `backend/src/modules/platform/`。旧路径 `backend/src/modules/ai-infra/` 已不存在；文档目录名（`docs/architecture/ai-infra/`）暂保留，避免链接改动。

## 边界规则

- 不需要知道 agent / mission / 具体 AI 业务语义
- **不得反向依赖上层模块**（L2 ai-engine、L2.5 ai-harness、L3 ai-app、L4 open-api 均不得被本层 import）
- `credentials/` 只允许存在于 `platform`，engine 侧仅保留 `llm/user-config` 与 `llm/key-health`
- `backend/prisma/`、`src/common/prisma/` 不属于 `platform`

## 顶层文档

- [`backend-nestjs.md`](backend-nestjs.md) — NestJS 框架使用规范
- [`backend-prisma-orm.md`](backend-prisma-orm.md) — Prisma 使用规范
- [`database-postgresql.md`](database-postgresql.md) — PostgreSQL 16 + JSONB 设计
- [`database-redis.md`](database-redis.md) — Redis 7 缓存与会话
- [`base-layer-directory-contracts.md`](base-layer-directory-contracts.md) — 基础层目录契约（W17/W20）
- [`CHANGELOG.md`](CHANGELOG.md) — 基础设施变更日志

## 收敛重点

- `credits/` 拆清"通用账本" vs "产品线计费策略"
- `storage/` 拆清"对象存储 runtime" vs "存储治理任务"
- `notifications/` / `settings/` / `release/` 复核 app 领域语义渗入
