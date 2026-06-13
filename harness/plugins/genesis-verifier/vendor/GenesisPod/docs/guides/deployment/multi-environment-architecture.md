# GenesisPod - 多环境部署架构

> 企业级三环境部署体系，确保商用版本稳定性和开发效率。

## 概述

本文档描述 GenesisPod 的多环境部署架构，包括 Production（生产）、Staging（预发布）、Development（开发）三套独立环境。

| 属性         | 值                  |
| ------------ | ------------------- |
| **文档状态** | 📋 规划中 (Planned) |
| **实施状态** | ⏳ 待实施           |
| **创建日期** | 2026-01-19          |
| **维护者**   | DevOps Team         |

---

## 实施进度

| 阶段    | 内容                      | 状态      |
| ------- | ------------------------- | --------- |
| Phase 1 | 文档编写 (架构/配置/流程) | ✅ 完成   |
| Phase 2 | Railway 环境创建          | ⏳ 待实施 |
| Phase 3 | CI/CD 工作流配置          | ⏳ 待实施 |
| Phase 4 | 域名和 DNS 配置           | ⏳ 待实施 |
| Phase 5 | 环境变量配置              | ⏳ 待实施 |
| Phase 6 | 验证和上线                | ⏳ 待实施 |

---

## 1. 架构总览

### 1.1 环境架构图

```
                                 GitHub Repository
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                 main              develop               feature/*
                    │                   │                   │
                    ▼                   ▼                   ▼
          ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
          │   Production     │  │    Staging       │  │   Development    │
          │   Environment    │  │    Environment   │  │   Environment    │
          ├──────────────────┤  ├──────────────────┤  ├──────────────────┤
          │                  │  │                  │  │                  │
          │ • Frontend       │  │ • Frontend       │  │ • Frontend       │
          │ • Backend        │  │ • Backend        │  │ • Backend        │
          │ • AI Service     │  │ • AI Service     │  │ • AI Service     │
          │ • PostgreSQL     │  │ • PostgreSQL     │  │ • PostgreSQL     │
          │ • Redis          │  │ • Redis (共享)   │  │ • Redis (共享)   │
          └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
                   │                     │                     │
                   ▼                     ▼                     ▼
          api.gens.team    staging-api.gens.team   dev-api.gens.team
          gens.team        staging.gens.team       dev.gens.team
```

### 1.2 Railway 项目结构

采用 **单 Project 多 Environment** 模式：

```
genesis-ai (Railway Project)
│
├── production (Environment)
│   ├── frontend          # Next.js 前端
│   ├── backend           # NestJS 后端
│   ├── ai-service        # Python AI 服务
│   ├── postgres          # PostgreSQL 数据库
│   └── redis             # Redis 缓存
│
├── staging (Environment)
│   ├── frontend
│   ├── backend
│   ├── ai-service
│   ├── postgres
│   └── redis (可与 dev 共享)
│
└── development (Environment)
    ├── frontend
    ├── backend
    ├── ai-service
    ├── postgres
    └── redis (可与 staging 共享)
```

---

## 2. 环境规格

### 2.1 环境对比表

| 属性         | Production                 | Staging         | Development       |
| ------------ | -------------------------- | --------------- | ----------------- |
| **触发分支** | `main`                     | `develop`       | 手动 / PR Preview |
| **自动部署** | ✅ 是                      | ✅ 是           | ❌ 手动           |
| **数据库**   | 独立 PostgreSQL            | 独立 PostgreSQL | 独立 PostgreSQL   |
| **Redis**    | 独立                       | 与 Dev 共享     | 与 Staging 共享   |
| **实例数**   | 2+ replicas                | 1 replica       | 1 replica         |
| **资源配置** | 高                         | 中              | 低                |
| **监控级别** | 完整 (Sentry + Prometheus) | Sentry 仅错误   | 最小化            |
| **日志级别** | `warn`                     | `info`          | `debug`           |
| **告警通知** | 全量                       | 仅严重          | 无                |

### 2.2 域名规划

| 环境        | 前端域名            | 后端 API 域名           |
| ----------- | ------------------- | ----------------------- |
| Production  | `gens.team`         | `api.gens.team`         |
| Staging     | `staging.gens.team` | `staging-api.gens.team` |
| Development | `dev.gens.team`     | `dev-api.gens.team`     |

### 2.3 成本估算

| 环境        | 月成本估算  | 说明                          |
| ----------- | ----------- | ----------------------------- |
| Production  | $50-100     | 3 服务 + 独立 DB + 独立 Redis |
| Staging     | $25-50      | 3 服务 + 独立 DB              |
| Development | $15-30      | 3 服务 + 独立 DB，共享 Redis  |
| **总计**    | **$90-180** | 三环境完整部署                |

---

## 3. 分支策略

### 3.1 分支与环境映射

```
main (受保护)
  │
  ├── 生产部署 → Production 环境
  │   └── 自动部署，需要 2 人 Code Review
  │
develop (受保护)
  │
  ├── 预发布部署 → Staging 环境
  │   └── 自动部署，需要 1 人 Code Review
  │
feature/* / bugfix/*
  │
  └── 开发部署 → Development 环境 (手动)
      └── 可选 PR Preview

hotfix/*
  │
  └── 紧急修复 → 直接 PR 到 main
      └── 加急 Review (1 人)，然后 cherry-pick 到 develop
```

### 3.2 分支保护规则

**main 分支保护**:

```yaml
required_reviews: 2
required_status_checks:
  - CI / quality-check
  - CI / backend-test
  - CI / frontend-test
  - CI / build
  - Deploy Protection Check / pre-deploy-checks
dismiss_stale_reviews: true
require_code_owner_reviews: true
restrict_pushes: true
```

**develop 分支保护**:

```yaml
required_reviews: 1
required_status_checks:
  - CI / quality-check
  - CI / backend-test
  - CI / frontend-test
dismiss_stale_reviews: true
```

---

## 4. 数据库隔离

### 4.1 数据库命名规范

| 环境        | 数据库名          |
| ----------- | ----------------- |
| Production  | `genesis_prod`    |
| Staging     | `genesis_staging` |
| Development | `genesis_dev`     |

### 4.2 迁移策略

迁移流程严格按环境顺序执行：

```
Local Dev → Development → Staging → Production
```

**迁移命令**:

```bash
# 本地开发
cd backend && npx prisma migrate dev

# 部署迁移 (CI/CD 自动执行)
DATABASE_URL=$ENV_DATABASE_URL npx prisma migrate deploy
```

### 4.3 数据策略

| 环境        | 数据来源                      |
| ----------- | ----------------------------- |
| Production  | 真实用户数据                  |
| Staging     | 脱敏的生产数据快照 (月度更新) |
| Development | Seed 脚本生成的测试数据       |

**重要**: 生产数据**禁止**直接复制到非生产环境，必须经过脱敏处理。

---

## 5. CI/CD 流程

### 5.1 流程概览

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Actions                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Push/PR → CI Pipeline                                       │
│    ├── quality-check (lint, format, type-check)             │
│    ├── backend-test (Jest + PostgreSQL)                     │
│    ├── frontend-test (Vitest)                               │
│    └── build (构建验证)                                      │
│                                                              │
│  develop → deploy-staging.yml                               │
│    ├── 数据库迁移                                            │
│    ├── 触发 Railway Staging 部署                            │
│    └── Smoke 测试                                           │
│                                                              │
│  main → deploy-production.yml                               │
│    ├── Pre-deploy 检查                                       │
│    ├── 数据库迁移                                            │
│    ├── 触发 Railway Production 部署                         │
│    ├── Smoke 测试                                           │
│    └── 发布通知                                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 部署工作流

**Staging 部署** (`deploy-staging.yml`):

- 触发条件: `push` 到 `develop`
- 步骤: 安装依赖 → 数据库迁移 → Railway 部署 → Smoke 测试

**Production 部署** (`deploy-production.yml`):

- 触发条件: `push` 到 `main`
- 步骤: Pre-deploy 检查 → 数据库迁移 → Railway 部署 → Smoke 测试 → 发布通知

### 5.3 Smoke 测试

每次部署后自动运行健康检查：

```bash
# 检查 API 健康
curl -f https://${API_URL}/api/v1/health

# 检查前端可访问
curl -f https://${WEB_URL}/
```

---

## 6. 环境变量管理

### 6.1 变量分类

**1. 共享变量** (所有环境相同):

```bash
JWT_EXPIRES_IN=7d
MAX_FILE_SIZE=10485760
LOG_FORMAT=json
```

**2. 环境特定变量**:

```bash
# 按环境不同
NODE_ENV=production|staging|development
DATABASE_URL=postgresql://...
CORS_ORIGIN=https://...
FRONTEND_URL=https://...
```

**3. Secrets** (通过 Railway Variables 管理):

```bash
JWT_SECRET          # 每环境不同
OPENAI_API_KEY      # 可共用
ANTHROPIC_API_KEY   # 可共用
GOOGLE_CLIENT_SECRET # 每环境不同
```

### 6.2 变量配置位置

| 位置                          | 用途                |
| ----------------------------- | ------------------- |
| Railway Dashboard             | 生产/预发布环境变量 |
| `.env.local`                  | 本地开发            |
| `infra/railway/*.env.example` | 变量模板参考        |

---

## 7. 发布流程

### 7.1 标准发布流程

```
1. 功能开发
   └── feature/* 分支开发
   └── 本地 docker-compose 测试

2. 合并到 develop
   └── PR + 1 人 Review
   └── CI 通过
   └── 自动部署到 Staging

3. QA 验证
   └── 在 Staging 环境测试
   └── 验收通过

4. 发布到生产
   └── develop → main PR
   └── 2 人 Review
   └── deploy-protection 检查
   └── 合并后自动部署

5. 发布后验证
   └── Smoke 测试
   └── 监控错误率
   └── 发送发布通知
```

### 7.2 紧急修复流程 (Hotfix)

```
1. 从 main 创建 hotfix/* 分支
2. 修复问题
3. PR 到 main (加急 1 人 Review)
4. 合并并自动部署
5. Cherry-pick 到 develop
```

### 7.3 回滚策略

**应用回滚**:

```bash
# Railway UI
# Deployments → 选择上一个成功部署 → Redeploy

# 或 Railway CLI
railway deployment rollback <deployment-id>
```

**数据库回滚**:

```bash
# Prisma 回滚迁移
npx prisma migrate resolve --rolled-back <migration-name>
```

---

## 8. 监控与告警

### 8.1 各环境监控配置

| 组件     | Production    | Staging  | Development |
| -------- | ------------- | -------- | ----------- |
| Sentry   | 全量追踪      | 仅错误   | 禁用        |
| 日志级别 | `warn`        | `info`   | `debug`     |
| 告警     | Slack + Email | 仅 Slack | 无          |

### 8.2 健康检查端点

所有环境共享相同的健康检查端点：

| 端点                       | 用途         |
| -------------------------- | ------------ |
| `GET /api/v1/health`       | 完整健康状态 |
| `GET /api/v1/health/live`  | 存活探针     |
| `GET /api/v1/health/ready` | 就绪探针     |

---

## 9. 安全考虑

### 9.1 访问控制

| 环境        | 访问权限            |
| ----------- | ------------------- |
| Production  | 仅管理员 (双人规则) |
| Staging     | 全团队              |
| Development | 全团队              |

### 9.2 Secret 管理原则

1. **不同环境使用不同 JWT_SECRET**
2. **AI API Keys 可跨环境共用**（成本考虑）
3. **生产 Secrets 仅管理员可访问**
4. **定期轮换 Secrets**（建议每季度）

### 9.3 数据保护

- 生产数据**禁止**复制到非生产环境
- Staging/Development 使用脱敏数据或 Seed 数据
- 数据库访问按环境隔离

---

## 10. 相关文档

| 文档             | 路径                                                       |
| ---------------- | ---------------------------------------------------------- |
| 环境配置指南     | [environment-setup-guide.md](./environment-setup-guide.md) |
| 发布流程详解     | [release-workflow.md](./release-workflow.md)               |
| 部署概览         | [overview.md](./overview.md)                               |
| Railway 环境变量 | [railway-env-config.md](./railway-env-config.md)           |

---

**最后更新**: 2026-01-19
**版本**: 1.0
