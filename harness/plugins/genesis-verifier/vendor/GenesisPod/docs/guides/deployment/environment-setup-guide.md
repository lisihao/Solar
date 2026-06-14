# GenesisPod - 环境配置指南

> Railway 多环境创建与配置的详细操作指南。

| 属性         | 值                                                                       |
| ------------ | ------------------------------------------------------------------------ |
| **文档状态** | 📋 规划中 (Planned)                                                      |
| **实施状态** | ⏳ 待实施                                                                |
| **创建日期** | 2026-01-19                                                               |
| **前置文档** | [multi-environment-architecture.md](./multi-environment-architecture.md) |

---

## 实施清单

| 步骤 | 内容                          | 状态      | 负责人 |
| ---- | ----------------------------- | --------- | ------ |
| 1    | 创建 Railway Staging 环境     | ⏳ 待实施 | -      |
| 2    | 创建 Railway Development 环境 | ⏳ 待实施 | -      |
| 3    | 配置分支触发器                | ⏳ 待实施 | -      |
| 4    | 配置环境变量                  | ⏳ 待实施 | -      |
| 5    | 配置自定义域名                | ⏳ 待实施 | -      |
| 6    | 验证部署流程                  | ⏳ 待实施 | -      |

---

## 1. Railway 环境创建

### 1.1 创建 Staging 环境

**操作步骤**:

1. 打开 [Railway Dashboard](https://railway.app/dashboard)
2. 进入 `genesis-ai` 项目
3. 点击顶部的 "Environments" 下拉菜单
4. 点击 "New Environment"
5. 命名为 `staging`
6. 选择 "Copy from production"（复制生产环境配置）
7. 确认创建

**预期结果**:

- 新建 staging 环境
- 自动创建独立的 PostgreSQL 实例
- 复制所有服务配置（需更新环境变量）

### 1.2 创建 Development 环境

重复上述步骤，命名为 `development`。

**注意**: Development 环境可以选择共享 staging 的 Redis 以节省成本。

---

## 2. 配置分支触发器

### 2.1 Production 环境

1. 进入 production 环境
2. 点击任意服务 (如 backend)
3. 进入 "Settings" → "Deploy" 选项卡
4. 设置 "Source" 为 GitHub Repository
5. 设置 "Branch" 为 `main`
6. 启用 "Auto Deploy"

### 2.2 Staging 环境

1. 进入 staging 环境
2. 设置所有服务的 "Branch" 为 `develop`
3. 启用 "Auto Deploy"

### 2.3 Development 环境

1. 进入 development 环境
2. **禁用** "Auto Deploy"（手动触发）
3. 或配置为 PR Preview 模式

---

## 3. 环境变量配置

### 3.1 Backend 服务变量

#### Production

```bash
# 应用配置
NODE_ENV=production
PORT=4000

# 数据库 (Railway 自动注入)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Redis (Railway 自动注入)
REDIS_URL=${{Redis.REDIS_URL}}

# URLs
FRONTEND_URL=https://gens.team
CORS_ORIGIN=https://gens.team

# AI 服务内网地址
AI_SERVICE_URL=http://${{ai-service.RAILWAY_PRIVATE_DOMAIN}}:8000

# 认证 (手动设置)
JWT_SECRET=<production-jwt-secret-随机生成>
JWT_EXPIRES_IN=7d

# Google OAuth
GOOGLE_CLIENT_ID=<production-google-client-id>
GOOGLE_CLIENT_SECRET=<production-google-client-secret>
GOOGLE_CALLBACK_URL=https://api.gens.team/api/v1/auth/google/callback

# AI API Keys (可跨环境共用)
OPENAI_API_KEY=<openai-api-key>
ANTHROPIC_API_KEY=<anthropic-api-key>
XAI_API_KEY=<xai-api-key>
LITELLM_API_KEY=<litellm-api-key>
LITELLM_API_URL=<litellm-api-url>

# 监控
SENTRY_DSN=<production-sentry-dsn>
LOG_LEVEL=warn
```

#### Staging

```bash
# 应用配置
NODE_ENV=staging
PORT=4000

# 数据库 (Railway 自动注入)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Redis
REDIS_URL=${{Redis.REDIS_URL}}

# URLs
FRONTEND_URL=https://staging.gens.team
CORS_ORIGIN=https://staging.gens.team

# AI 服务
AI_SERVICE_URL=http://${{ai-service.RAILWAY_PRIVATE_DOMAIN}}:8000

# 认证 (与生产不同的 secret)
JWT_SECRET=<staging-jwt-secret-随机生成>
JWT_EXPIRES_IN=7d

# Google OAuth (可使用测试应用)
GOOGLE_CLIENT_ID=<staging-google-client-id>
GOOGLE_CLIENT_SECRET=<staging-google-client-secret>
GOOGLE_CALLBACK_URL=https://staging-api.gens.team/api/v1/auth/google/callback

# AI API Keys (共用生产 keys)
OPENAI_API_KEY=<openai-api-key>
ANTHROPIC_API_KEY=<anthropic-api-key>
XAI_API_KEY=<xai-api-key>
LITELLM_API_KEY=<litellm-api-key>
LITELLM_API_URL=<litellm-api-url>

# 监控 (降级)
SENTRY_DSN=<staging-sentry-dsn>
LOG_LEVEL=info
```

#### Development

```bash
# 应用配置
NODE_ENV=development
PORT=4000

# 数据库
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Redis (可共享 staging)
REDIS_URL=${{Redis.REDIS_URL}}

# URLs
FRONTEND_URL=https://dev.gens.team
CORS_ORIGIN=https://dev.gens.team

# AI 服务
AI_SERVICE_URL=http://${{ai-service.RAILWAY_PRIVATE_DOMAIN}}:8000

# 认证
JWT_SECRET=<dev-jwt-secret-随机生成>
JWT_EXPIRES_IN=7d

# Google OAuth (测试应用)
GOOGLE_CLIENT_ID=<dev-google-client-id>
GOOGLE_CLIENT_SECRET=<dev-google-client-secret>
GOOGLE_CALLBACK_URL=https://dev-api.gens.team/api/v1/auth/google/callback

# AI API Keys
OPENAI_API_KEY=<openai-api-key>
ANTHROPIC_API_KEY=<anthropic-api-key>

# 日志
LOG_LEVEL=debug
```

### 3.2 Frontend 服务变量

#### Production

```bash
# API URLs (构建时注入)
NEXT_PUBLIC_API_URL=https://api.gens.team
NEXT_PUBLIC_AI_URL=https://ai.gens.team

# 分析
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
NEXT_PUBLIC_SENTRY_DSN=<production-frontend-sentry-dsn>
```

#### Staging

```bash
NEXT_PUBLIC_API_URL=https://staging-api.gens.team
NEXT_PUBLIC_AI_URL=https://staging-ai.gens.team
NEXT_PUBLIC_SENTRY_DSN=<staging-frontend-sentry-dsn>
```

#### Development

```bash
NEXT_PUBLIC_API_URL=https://dev-api.gens.team
NEXT_PUBLIC_AI_URL=https://dev-ai.gens.team
```

### 3.3 AI Service 变量

所有环境基本相同，主要是 API Keys：

```bash
# AI API Keys
OPENAI_API_KEY=<openai-api-key>
XAI_API_KEY=<xai-api-key>

# Server
PORT=8000
HOST=0.0.0.0
```

---

## 4. 自定义域名配置

### 4.1 DNS 配置

在 DNS 服务商（如 Cloudflare）添加以下记录：

| 类型  | 名称              | 目标                               | 环境        |
| ----- | ----------------- | ---------------------------------- | ----------- |
| CNAME | `@` / `gens.team` | Railway Frontend Production Domain | Production  |
| CNAME | `api`             | Railway Backend Production Domain  | Production  |
| CNAME | `staging`         | Railway Frontend Staging Domain    | Staging     |
| CNAME | `staging-api`     | Railway Backend Staging Domain     | Staging     |
| CNAME | `dev`             | Railway Frontend Dev Domain        | Development |
| CNAME | `dev-api`         | Railway Backend Dev Domain         | Development |

### 4.2 Railway 域名配置

1. 进入对应环境的服务
2. 点击 "Settings" → "Networking"
3. 在 "Custom Domains" 中添加域名
4. Railway 会自动生成 SSL 证书

**Frontend (Production)**:

- `gens.team`
- `www.gens.team`

**Backend (Production)**:

- `api.gens.team`

---

## 5. 数据库初始化

### 5.1 运行迁移

每个环境的数据库都需要运行迁移：

```bash
# 在 Railway CLI 或 GitHub Actions 中执行
DATABASE_URL=$STAGING_DATABASE_URL npx prisma migrate deploy
```

### 5.2 Seed 测试数据

Staging/Development 环境可以运行 seed 脚本：

```bash
DATABASE_URL=$STAGING_DATABASE_URL npx prisma db seed
```

**注意**: 生产环境**禁止**运行 seed 脚本。

---

## 6. 验证清单

### 6.1 Staging 环境验证

- [ ] 访问 `https://staging.gens.team` 页面正常加载
- [ ] 访问 `https://staging-api.gens.team/api/v1/health` 返回健康状态
- [ ] Google OAuth 登录流程正常
- [ ] AI 功能可用（调用 LiteLLM）
- [ ] 数据库连接正常
- [ ] 从 `develop` 分支推送后自动部署

### 6.2 Development 环境验证

- [ ] 访问 `https://dev.gens.team` 页面正常加载
- [ ] 访问 `https://dev-api.gens.team/api/v1/health` 返回健康状态
- [ ] 手动触发部署正常工作

### 6.3 Production 环境验证

- [ ] 现有生产环境未受影响
- [ ] 从 `main` 分支推送后自动部署
- [ ] 发布通知正常发送

---

## 7. 常见问题

### Q1: 环境变量未生效

**原因**: Railway 变量更新后需要重新部署

**解决**: 在 Railway Dashboard 点击 "Redeploy" 或推送一个空提交

### Q2: 数据库连接失败

**原因**: DATABASE_URL 格式错误或网络问题

**解决**:

1. 检查 `${{Postgres.DATABASE_URL}}` 是否正确引用
2. 确认 PostgreSQL 服务正在运行

### Q3: 跨环境服务通信失败

**原因**: 使用了公网域名而非内网地址

**解决**: 使用 `${{service.RAILWAY_PRIVATE_DOMAIN}}` 进行内网通信

### Q4: 自动部署未触发

**原因**: 分支配置错误或 Auto Deploy 未启用

**解决**:

1. 检查 "Settings" → "Deploy" → "Branch" 设置
2. 确认 "Auto Deploy" 已启用

---

## 8. 相关文档

| 文档                                                                     | 描述                  |
| ------------------------------------------------------------------------ | --------------------- |
| [multi-environment-architecture.md](./multi-environment-architecture.md) | 多环境架构总览        |
| [release-workflow.md](./release-workflow.md)                             | 发布流程详解          |
| [railway-env-config.md](./railway-env-config.md)                         | 现有 Railway 配置参考 |

---

**最后更新**: 2026-01-19
**版本**: 1.0
