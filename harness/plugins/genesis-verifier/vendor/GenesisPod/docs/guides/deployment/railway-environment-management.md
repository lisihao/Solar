# Railway 环境管理方案

> GenesisPod 的 Railway 多环境隔离、部署和管理完整指南。

| 属性         | 值                |
| ------------ | ----------------- |
| **文档状态** | Active            |
| **创建日期** | 2026-01-28        |
| **维护者**   | Architecture Team |
| **版本**     | 1.0               |

---

## 目录

1. [问题诊断](#1-问题诊断)
2. [环境架构设计](#2-环境架构设计)
3. [变量管理策略](#3-变量管理策略)
4. [数据库策略](#4-数据库策略)
5. [部署流程](#5-部署流程)
6. [版本化管理](#6-版本化管理) **[重点]**
7. [本地开发连接](#7-本地开发连接)
8. [同步策略](#8-同步策略)
9. [Railway CLI 使用指南](#9-railway-cli-使用指南)
10. [实施检查清单](#10-实施检查清单)
11. [新增环境操作指南](#11-新增环境操作指南)

---

## 1. 问题诊断

### 1.1 当前环境状态

| 环境        | 环境 ID                                | 状态   |
| ----------- | -------------------------------------- | ------ |
| Production  | `c23d3e3a-1d0b-46e2-88b4-3ec6f8ea6123` | 运行中 |
| Development | `210110d4-e76b-4cf8-8ace-3a99d9c596e6` | 运行中 |

### 1.2 发现的问题

#### 问题 1: 数据库共享 (严重)

```
生产环境 DATABASE_URL → postgres.railway.internal:5432
开发环境 DATABASE_URL → postgres.railway.internal:5432  [错误!]
```

**风险**: 开发环境的数据操作会直接影响生产数据，可能导致数据丢失或污染。

**解决方案**: 开发环境必须使用独立的 PostgreSQL 实例。

#### 问题 2: OAuth 回调地址错误 (严重)

```bash
# 开发环境当前配置 (错误)
GOOGLE_CALLBACK_URL=https://genesis-ai-backend.up.railway.app/...  # 指向生产!
GITHUB_CALLBACK_URL=https://genesis-ai-backend.up.railway.app/...  # 指向生产!

# 应该配置为
GOOGLE_CALLBACK_URL=https://backend-development-5f56.up.railway.app/...
GITHUB_CALLBACK_URL=https://backend-development-5f56.up.railway.app/...
```

**风险**: OAuth 登录后会被重定向到生产环境，导致认证失败或跨环境会话问题。

#### 问题 3: FRONTEND_URL 错误 (中等)

```bash
# 开发环境当前配置 (错误)
FRONTEND_URL=https://genesis-ai.up.railway.app  # 指向生产!

# 应该配置为
FRONTEND_URL=https://frontend-development-74d8.up.railway.app
```

**风险**: 后端生成的链接（如密码重置、邮件通知）会指向生产前端。

#### 问题 4: 内部服务可能共享

需要检查以下服务是否在环境间隔离:

- ~~Qdrant~~ (已移除，向量能力改用 PostgreSQL pgvector)
- ~~Neo4j~~ (已移除，改用 PostgreSQL)
- FlareSolverr (爬虫代理)
- Redis (缓存)

---

## 2. 环境架构设计

### 2.1 推荐架构

```
genesis-ai (Railway Project)
│
├── production (Environment) ─────────────────────────────────────────────┐
│   │                                                                      │
│   ├── frontend          → genesis-ai.up.railway.app                │
│   ├── backend           → genesis-ai-backend.up.railway.app        │
│   ├── ai-service        → genesis-ai-ai-service.up.railway.app     │
│   │                                                                      │
│   ├── postgres-prod     → [独立实例] postgres-prod.railway.internal     │
│   ├── redis-prod        → [独立实例] redis-prod.railway.internal        │
│   └── flaresolverr      → [可选共享] flaresolverr.railway.internal      │
│                                                                          │
├── development (Environment) ────────────────────────────────────────────┐
│   │                                                                      │
│   ├── frontend          → frontend-development-74d8.up.railway.app      │
│   ├── backend           → backend-development-5f56.up.railway.app       │
│   ├── ai-service        → ai-service-development-1cb6.up.railway.app    │
│   │                                                                      │
│   ├── postgres-dev      → [独立实例] postgres-dev.railway.internal      │
│   ├── redis-dev         → [可共享] redis-dev.railway.internal           │
│   └── flaresolverr      → [共享] flaresolverr.railway.internal          │
│                                                                          │
└── staging (Environment) [可选, 未来扩展] ───────────────────────────────┐
    │                                                                      │
    ├── frontend          → frontend-staging-xxxx.up.railway.app          │
    ├── backend           → backend-staging-xxxx.up.railway.app           │
    ├── ai-service        → ai-service-staging-xxxx.up.railway.app        │
    │                                                                      │
    ├── postgres-staging  → [独立实例]                                     │
    └── redis             → [可与 dev 共享]                                │
```

### 2.2 服务隔离原则

| 服务类型     | 隔离级别     | 说明                       |
| ------------ | ------------ | -------------------------- |
| PostgreSQL   | **必须隔离** | 核心数据存储，绝对不能共享 |
| Redis        | 推荐隔离     | 可共享但需要 key 前缀隔离  |
| FlareSolverr | 可共享       | 无状态服务，共享节省成本   |
| AI Service   | 必须隔离     | 需要独立配置和监控         |

### 2.3 域名规划

| 环境        | 前端域名                                   | 后端 API 域名                             |
| ----------- | ------------------------------------------ | ----------------------------------------- |
| Production  | `genesis-ai.up.railway.app`                | `genesis-ai-backend.up.railway.app`       |
| Development | `frontend-development-74d8.up.railway.app` | `backend-development-5f56.up.railway.app` |
| Staging     | `frontend-staging-xxxx.up.railway.app`     | `backend-staging-xxxx.up.railway.app`     |

**自定义域名 (可选)**:

| 环境        | 前端            | 后端 API            |
| ----------- | --------------- | ------------------- |
| Production  | `gens.team`     | `api.gens.team`     |
| Development | `dev.gens.team` | `dev-api.gens.team` |

---

## 3. 变量管理策略

### 3.1 变量分类矩阵

| 分类         | 说明                                                 | 环境隔离 | 示例                          |
| ------------ | ---------------------------------------------------- | -------- | ----------------------------- |
| 基础设施连接 | 数据库、缓存等服务地址                               | **是**   | `DATABASE_URL`, `REDIS_URL`   |
| 应用 URLs    | 前后端服务地址                                       | **是**   | `FRONTEND_URL`, `CORS_ORIGIN` |
| OAuth 配置   | 认证回调地址                                         | **是**   | `GOOGLE_CALLBACK_URL`         |
| 安全密钥     | JWT、加密密钥                                        | **是**   | `JWT_SECRET`                  |
| AI API Keys  | LLM 提供商密钥（存储在数据库密钥管理中，非环境变量） | N/A      | 由数据库统一管理              |
| 运行时配置   | 日志级别、超时等                                     | **是**   | `LOG_LEVEL`, `NODE_ENV`       |
| 功能开关     | 特性开关                                             | 可共享   | `ENABLE_FEATURE_X`            |

### 3.2 Backend 完整变量配置

#### Production 环境

```bash
# ============================================
# 应用基础配置
# ============================================
NODE_ENV=production
PORT=4000
LOG_LEVEL=warn

# ============================================
# 数据库 (Railway 服务引用)
# ============================================
DATABASE_URL=${{postgres-prod.DATABASE_URL}}

# ============================================
# Redis (Railway 服务引用)
# ============================================
REDIS_URL=${{redis-prod.REDIS_URL}}

# ============================================
# URLs - 生产环境
# ============================================
FRONTEND_URL=https://genesis-ai.up.railway.app
CORS_ORIGIN=https://genesis-ai.up.railway.app

# AI Service 内网通信
AI_SERVICE_URL=http://${{ai-service.RAILWAY_PRIVATE_DOMAIN}}:8000

# ============================================
# JWT 认证 - 生产专用
# ============================================
JWT_SECRET=<prod-unique-secret-64-chars>
JWT_EXPIRES_IN=7d

# ============================================
# OAuth 配置 - 生产回调
# ============================================
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://genesis-ai-backend.up.railway.app/api/v1/auth/google/callback

GITHUB_CLIENT_ID=<github-client-id>
GITHUB_CLIENT_SECRET=<github-client-secret>
GITHUB_CALLBACK_URL=https://genesis-ai-backend.up.railway.app/api/v1/auth/github/callback

# ============================================
# AI API Keys
# 注意: AI API Keys 由数据库密钥管理模块统一管理，
# 不再作为环境变量配置。新环境需通过数据库迁移或手动录入。
# ============================================

# ============================================
# 监控
# ============================================
SENTRY_DSN=<production-sentry-dsn>

# ============================================
# 外部服务
# ============================================
FLARESOLVERR_URL=http://${{flaresolverr.RAILWAY_PRIVATE_DOMAIN}}:8191
```

#### Development 环境

```bash
# ============================================
# 应用基础配置
# ============================================
NODE_ENV=development
PORT=4000
LOG_LEVEL=debug

# ============================================
# 数据库 (独立的开发数据库!)
# ============================================
DATABASE_URL=${{postgres-dev.DATABASE_URL}}

# ============================================
# Redis (开发专用或共享)
# ============================================
REDIS_URL=${{redis-dev.REDIS_URL}}

# ============================================
# URLs - 开发环境
# ============================================
FRONTEND_URL=https://frontend-development-74d8.up.railway.app
CORS_ORIGIN=https://frontend-development-74d8.up.railway.app

# AI Service 内网通信
AI_SERVICE_URL=http://${{ai-service.RAILWAY_PRIVATE_DOMAIN}}:8000

# ============================================
# JWT 认证 - 开发专用 (与生产不同!)
# ============================================
JWT_SECRET=<dev-unique-secret-64-chars>
JWT_EXPIRES_IN=7d

# ============================================
# OAuth 配置 - 开发回调
# ============================================
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_CALLBACK_URL=https://backend-development-5f56.up.railway.app/api/v1/auth/google/callback

GITHUB_CLIENT_ID=<github-client-id>
GITHUB_CLIENT_SECRET=<github-client-secret>
GITHUB_CALLBACK_URL=https://backend-development-5f56.up.railway.app/api/v1/auth/github/callback

# ============================================
# AI API Keys
# 注意: AI API Keys 由数据库密钥管理模块统一管理，
# 不再作为环境变量配置。新环境需通过数据库迁移或手动录入。
# ============================================

# ============================================
# 监控 (可选)
# ============================================
# SENTRY_DSN=<development-sentry-dsn>

# ============================================
# 外部服务 (可共享)
# ============================================
FLARESOLVERR_URL=http://${{flaresolverr.RAILWAY_PRIVATE_DOMAIN}}:8191
```

### 3.3 Frontend 完整变量配置

#### Production 环境

```bash
# 构建时环境变量 (NEXT_PUBLIC_ 前缀)
NEXT_PUBLIC_API_URL=https://genesis-ai-backend.up.railway.app
NEXT_PUBLIC_AI_URL=https://genesis-ai-ai-service.up.railway.app

# 可选: 分析
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
NEXT_PUBLIC_SENTRY_DSN=<frontend-sentry-dsn>
```

#### Development 环境

```bash
# 构建时环境变量
NEXT_PUBLIC_API_URL=https://backend-development-5f56.up.railway.app
NEXT_PUBLIC_AI_URL=https://ai-service-development-1cb6.up.railway.app

# 开发环境不启用分析
# NEXT_PUBLIC_GA_ID=
# NEXT_PUBLIC_SENTRY_DSN=
```

### 3.4 AI Service 变量配置

```bash
# 两个环境基本相同
PORT=8000
HOST=0.0.0.0

# AI API Keys
# 注意: AI API Keys 由数据库密钥管理模块统一管理，
# AI Service 通过内部 API 从 Backend 获取密钥。
```

### 3.5 密钥管理说明

> AI API Keys（OpenAI、Anthropic、xAI 等）由数据库密钥管理模块统一存储和分发，不再作为环境变量配置。

**架构**:

```
Backend 启动 → 从数据库读取 API Keys → 注入 AI 调用链路
                                      → 通过内部 API 提供给 AI Service
```

**新环境操作**:

1. 如果从已有环境迁移数据库（pg_dump/pg_restore），API Keys 会自动带入
2. 如果使用全新数据库，需通过管理后台手动录入 API Keys
3. 迁移后需验证密钥有效性和额度

---

## 4. 数据库策略

### 4.1 数据库隔离方案

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Railway Project                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Production Environment                Development Environment           │
│  ┌─────────────────────────┐          ┌─────────────────────────┐       │
│  │  PostgreSQL (postgres)  │          │  PostgreSQL (postgres)  │       │
│  │  ─────────────────────  │          │  ─────────────────────  │       │
│  │  DB: genesis_prod       │          │  DB: genesis_dev        │       │
│  │  真实用户数据            │          │  测试/开发数据           │       │
│  │                         │          │                         │       │
│  │  [完全隔离]             │          │  [完全隔离]             │       │
│  └─────────────────────────┘          └─────────────────────────┘       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 创建独立开发数据库

**方法 1: Railway Dashboard**

1. 进入 `development` 环境
2. 点击 "New" -> "Database" -> "PostgreSQL"
3. 等待数据库创建完成
4. 更新 backend 服务的 `DATABASE_URL` 引用

**方法 2: Railway CLI**

```bash
# 切换到开发环境
railway environment development

# 添加 PostgreSQL 服务
railway add --plugin postgresql

# 查看新数据库连接信息
railway variables
```

### 4.3 数据库迁移策略

```bash
# 开发环境迁移 (可以使用 dev 命令)
railway environment development
railway run npx prisma migrate dev --name <migration-name>

# 生产环境迁移 (只能使用 deploy 命令)
railway environment production
railway run npx prisma migrate deploy
```

### 4.4 数据策略

| 环境        | 数据来源                  | 刷新频率 |
| ----------- | ------------------------- | -------- |
| Production  | 真实用户数据              | N/A      |
| Development | Seed 脚本 + 手动测试数据  | 按需     |
| Staging     | 脱敏的生产数据快照 (可选) | 月度     |

**Seed 脚本位置**: `backend/prisma/seed.ts`

```bash
# 在开发环境运行 seed
railway environment development
railway run npx prisma db seed
```

### 4.5 数据库迁移到新环境

当新增 Railway 环境（如 staging）时，需要将数据库迁移到新实例。

#### 方式 1: pg_dump / pg_restore

```bash
# 1. 从源环境导出
railway environment development
railway connect postgres
# 在另一个终端执行:
pg_dump -h localhost -p <proxy-port> -U postgres -Fc railway > dev-backup.dump

# 2. 在新环境创建数据库后导入
railway environment staging
railway connect postgres
# 在另一个终端执行:
pg_restore -h localhost -p <proxy-port> -U postgres -d railway dev-backup.dump
```

#### 方式 2: Railway Dashboard 备份恢复

1. 进入源环境的 PostgreSQL 服务
2. 点击 "Backups" → "Create Backup"
3. 下载备份文件
4. 在新环境的 PostgreSQL 服务中恢复

#### 迁移后注意事项

| 检查项          | 说明                                        |
| --------------- | ------------------------------------------- |
| API Keys 有效性 | 迁移后的密钥可能需要验证额度和有效期        |
| 测试数据清理    | 从生产迁移时需脱敏处理用户数据              |
| OAuth 配置      | 数据库中的 OAuth 相关配置需更新为新环境地址 |
| Prisma 迁移状态 | 运行 `prisma migrate deploy` 确保迁移表一致 |

---

## 5. 部署流程

### 5.1 分支与环境映射

```
┌─────────────────────────────────────────────────────────────────┐
│                        Git Branches                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   main                    develop                feature/*       │
│     │                        │                       │           │
│     │ (auto deploy)          │ (manual/PR)           │ (local)   │
│     ▼                        ▼                       ▼           │
│                                                                  │
│ ┌──────────┐          ┌─────────────┐         ┌──────────────┐  │
│ │Production│          │ Development │         │ Local Docker │  │
│ └──────────┘          └─────────────┘         └──────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Railway 分支配置

#### Production 环境

1. 进入 Railway Dashboard -> Production 环境
2. 选择 Backend 服务 -> Settings -> Deploy
3. 配置:
   - Source: GitHub Repository
   - Branch: `main`
   - Auto Deploy: **Enabled**

#### Development 环境

1. 进入 Railway Dashboard -> Development 环境
2. 选择 Backend 服务 -> Settings -> Deploy
3. 配置:
   - Source: GitHub Repository
   - Branch: `develop` 或手动触发
   - Auto Deploy: **Disabled** (推荐手动控制)

### 5.3 部署命令

```bash
# 手动部署到开发环境
railway environment development
railway up --service backend

# 查看部署状态
railway status

# 查看部署日志
railway logs --service backend

# 重新部署 (触发新构建)
railway redeploy --service backend
```

### 5.4 发布流程

```
开发者本地
    │
    ▼ git push origin feature/xxx
    │
    ▼ Create PR to develop
    │
    ▼ Code Review (1人)
    │
    ▼ Merge to develop
    │
    ▼ 手动触发 Development 部署
    │
    ▼ 在 Development 环境验证
    │
    ▼ Create PR to main
    │
    ▼ Code Review (2人)
    │
    ▼ Merge to main
    │
    ▼ 自动触发 Production 部署
    │
    ▼ Smoke 测试验证
```

---

## 6. 版本化管理

> **核心问题**: 当前没有版本追踪，无法知道哪个版本在哪个环境运行，不知道部署是否生效。

### 6.1 自动构建版本号方案

**目标**: 每次构建自动生成唯一版本号，无需手动操作。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      自动版本号生成架构                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   版本号格式: {SEMVER}-{BUILD_NUMBER}.{GIT_SHORT_SHA}                        │
│                                                                              │
│   示例: 1.2.0-42.a1b2c3d                                                    │
│         │     │  │                                                           │
│         │     │  └── Git commit short hash (7位)                            │
│         │     └───── 自动递增构建号                                          │
│         └─────────── 语义化版本 (从 package.json 读取)                       │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                      自动化流程                                         │  │
│   │                                                                        │  │
│   │  Git Push → Railway 构建触发 → 读取 Git Info → 生成版本号 → 注入环境   │  │
│   │                                                                        │  │
│   │  查询版本: GET /api/v1/version → 返回完整版本信息                       │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Railway 自动注入的构建信息

Railway 在构建时自动提供以下环境变量:

| 变量                         | 说明                 | 示例值                       |
| ---------------------------- | -------------------- | ---------------------------- |
| `RAILWAY_GIT_COMMIT_SHA`     | 完整 Git commit hash | `a1b2c3d4e5f6...`            |
| `RAILWAY_GIT_BRANCH`         | 当前分支             | `main` / `develop`           |
| `RAILWAY_GIT_AUTHOR`         | 提交作者             | `Your Name`                  |
| `RAILWAY_GIT_COMMIT_MESSAGE` | 提交信息             | `feat: add new feature`      |
| `RAILWAY_DEPLOYMENT_ID`      | 部署 ID              | `778e36a9-a54d-4d23...`      |
| `RAILWAY_ENVIRONMENT`        | 环境名称             | `production` / `development` |
| `RAILWAY_SERVICE_NAME`       | 服务名称             | `backend` / `frontend`       |

### 6.3 实现自动版本号

#### 步骤 1: 创建版本生成脚本

创建 `backend/scripts/generate-version.ts`:

```typescript
/**
 * 自动生成构建版本号
 * 格式: {package.version}-{buildNumber}.{gitShortSha}
 *
 * 在 Railway 构建时自动运行
 */
import * as fs from "fs";
import * as path from "path";

interface VersionInfo {
  version: string; // 完整版本号
  semver: string; // 语义化版本 (from package.json)
  buildNumber: number; // 构建号
  gitSha: string; // Git commit SHA (short)
  gitShafull: string; // Git commit SHA (full)
  gitBranch: string; // Git 分支
  gitAuthor: string; // 提交作者
  gitMessage: string; // 提交信息
  environment: string; // 环境 (production/development)
  service: string; // 服务名
  deploymentId: string; // Railway 部署 ID
  buildTime: string; // 构建时间 (ISO)
}

function generateVersion(): VersionInfo {
  // 读取 package.json 版本
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8"),
  );
  const semver = packageJson.version || "0.0.0";

  // Railway 提供的环境变量
  const gitShaFull = process.env.RAILWAY_GIT_COMMIT_SHA || "unknown";
  const gitSha = gitShaFull.substring(0, 7);
  const gitBranch = process.env.RAILWAY_GIT_BRANCH || "unknown";
  const gitAuthor = process.env.RAILWAY_GIT_AUTHOR || "unknown";
  const gitMessage = process.env.RAILWAY_GIT_COMMIT_MESSAGE || "";
  const environment = process.env.RAILWAY_ENVIRONMENT || "local";
  const service = process.env.RAILWAY_SERVICE_NAME || "backend";
  const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID || "local";

  // 生成构建号: 基于时间戳的简化数字
  // 格式: YYMMDDHHMM 的后6位，保证递增且简短
  const now = new Date();
  const buildNumber = parseInt(
    `${now.getMonth() + 1}${now.getDate()}${now.getHours()}${now.getMinutes()}`
      .padStart(8, "0")
      .slice(-6),
  );

  // 组合版本号
  const version = `${semver}-${buildNumber}.${gitSha}`;

  const versionInfo: VersionInfo = {
    version,
    semver,
    buildNumber,
    gitSha,
    gitShafull: gitShaFull,
    gitBranch,
    gitAuthor,
    gitMessage: gitMessage.split("\n")[0].substring(0, 100), // 只取第一行
    environment,
    service,
    deploymentId,
    buildTime: now.toISOString(),
  };

  return versionInfo;
}

// 生成并写入文件
const versionInfo = generateVersion();
const outputPath = path.join(__dirname, "../src/version.json");

fs.writeFileSync(outputPath, JSON.stringify(versionInfo, null, 2));

console.log("=".repeat(60));
console.log("Build Version Generated:");
console.log("=".repeat(60));
console.log(`  Version:     ${versionInfo.version}`);
console.log(`  Environment: ${versionInfo.environment}`);
console.log(`  Branch:      ${versionInfo.gitBranch}`);
console.log(`  Commit:      ${versionInfo.gitSha}`);
console.log(`  Build Time:  ${versionInfo.buildTime}`);
console.log("=".repeat(60));
```

#### 步骤 2: 更新构建脚本

修改 `backend/package.json`:

```json
{
  "scripts": {
    "prebuild": "tsx scripts/generate-version.ts",
    "build": "prisma generate --schema=prisma/schema && nest build"
    // ... 其他脚本
  }
}
```

#### 步骤 3: 创建版本 API 端点

创建 `backend/src/modules/system/version.controller.ts`:

```typescript
import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import * as versionInfo from "../version.json";

@Controller("version")
@ApiTags("System")
export class VersionController {
  @Get()
  @ApiOperation({ summary: "获取当前部署版本信息" })
  getVersion() {
    return {
      ...versionInfo,
      serverTime: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get("short")
  @ApiOperation({ summary: "获取简短版本号" })
  getShortVersion() {
    return {
      version: versionInfo.version,
      environment: versionInfo.environment,
    };
  }
}
```

#### 步骤 4: 启动时打印版本

修改 `backend/src/main.ts`:

```typescript
import * as versionInfo from "./version.json";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ... 其他配置

  const port = process.env.PORT || 4000;
  await app.listen(port);

  // 启动时打印版本信息
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║          GenesisPod Backend Started                    ║");
  console.log("╠════════════════════════════════════════════════════════════╣");
  console.log(`║  Version:     ${versionInfo.version.padEnd(42)}║`);
  console.log(`║  Environment: ${versionInfo.environment.padEnd(42)}║`);
  console.log(`║  Branch:      ${versionInfo.gitBranch.padEnd(42)}║`);
  console.log(`║  Commit:      ${versionInfo.gitSha.padEnd(42)}║`);
  console.log(`║  Port:        ${String(port).padEnd(42)}║`);
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("");
}
```

### 6.4 前端版本号实现

创建 `frontend/scripts/generate-version.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8"),
);

const versionInfo = {
  version: packageJson.version,
  gitSha: (process.env.RAILWAY_GIT_COMMIT_SHA || "unknown").substring(0, 7),
  gitBranch: process.env.RAILWAY_GIT_BRANCH || "unknown",
  environment: process.env.RAILWAY_ENVIRONMENT || "local",
  buildTime: new Date().toISOString(),
};

// 写入 public 目录供前端访问
fs.writeFileSync(
  path.join(__dirname, "../public/version.json"),
  JSON.stringify(versionInfo, null, 2),
);

// 生成环境变量供 Next.js 使用
const envContent = `
NEXT_PUBLIC_APP_VERSION=${versionInfo.version}
NEXT_PUBLIC_GIT_SHA=${versionInfo.gitSha}
NEXT_PUBLIC_BUILD_TIME=${versionInfo.buildTime}
`;

fs.writeFileSync(path.join(__dirname, "../.env.build"), envContent.trim());

console.log(`Frontend version: ${versionInfo.version}-${versionInfo.gitSha}`);
```

修改 `frontend/package.json`:

```json
{
  "scripts": {
    "prebuild": "tsx scripts/generate-version.ts",
    "build": "next build"
  }
}
```

### 6.5 版本验证命令

```bash
# 验证生产环境版本
curl -s https://genesis-ai-backend.up.railway.app/api/v1/version | jq

# 输出示例:
# {
#   "version": "1.2.0-281428.a1b2c3d",
#   "semver": "1.2.0",
#   "buildNumber": 281428,
#   "gitSha": "a1b2c3d",
#   "gitBranch": "main",
#   "environment": "production",
#   "buildTime": "2026-01-28T14:28:00.000Z",
#   "serverTime": "2026-01-28T15:30:00.000Z"
# }

# 验证开发环境版本
curl -s https://backend-development-5f56.up.railway.app/api/v1/version | jq

# 对比两个环境
echo "=== Production ===" && curl -s https://genesis-ai-backend.up.railway.app/api/v1/version | jq '.version, .gitSha, .buildTime'
echo "=== Development ===" && curl -s https://backend-development-5f56.up.railway.app/api/v1/version | jq '.version, .gitSha, .buildTime'
```

### 6.6 环境同步追踪

#### 同步状态检查脚本

创建 `scripts/check-env-sync.sh`:

```bash
#!/bin/bash
# 检查开发和生产环境的版本同步状态

PROD_URL="https://genesis-ai-backend.up.railway.app/api/v1/version"
DEV_URL="https://backend-development-5f56.up.railway.app/api/v1/version"

echo "Fetching version info..."
echo ""

PROD_INFO=$(curl -s $PROD_URL)
DEV_INFO=$(curl -s $DEV_URL)

PROD_VERSION=$(echo $PROD_INFO | jq -r '.version')
PROD_SHA=$(echo $PROD_INFO | jq -r '.gitSha')
PROD_BRANCH=$(echo $PROD_INFO | jq -r '.gitBranch')
PROD_TIME=$(echo $PROD_INFO | jq -r '.buildTime')

DEV_VERSION=$(echo $DEV_INFO | jq -r '.version')
DEV_SHA=$(echo $DEV_INFO | jq -r '.gitSha')
DEV_BRANCH=$(echo $DEV_INFO | jq -r '.gitBranch')
DEV_TIME=$(echo $DEV_INFO | jq -r '.buildTime')

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Environment Sync Status                      ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                                 ║"
echo "║  Production                                                     ║"
echo "║    Version: $PROD_VERSION"
echo "║    Commit:  $PROD_SHA"
echo "║    Branch:  $PROD_BRANCH"
echo "║    Built:   $PROD_TIME"
echo "║                                                                 ║"
echo "║  Development                                                    ║"
echo "║    Version: $DEV_VERSION"
echo "║    Commit:  $DEV_SHA"
echo "║    Branch:  $DEV_BRANCH"
echo "║    Built:   $DEV_TIME"
echo "║                                                                 ║"
echo "╠═══════════════════════════════════════════════════════════════╣"

if [ "$PROD_SHA" = "$DEV_SHA" ]; then
  echo "║  ✅ Environments are IN SYNC                                   ║"
else
  echo "║  ⚠️  Environments are OUT OF SYNC                              ║"
  echo "║                                                                 ║"

  # 检查 dev 是否领先于 prod
  COMMITS_AHEAD=$(git log --oneline $PROD_SHA..$DEV_SHA 2>/dev/null | wc -l)
  if [ "$COMMITS_AHEAD" -gt 0 ]; then
    echo "║  Development is $COMMITS_AHEAD commit(s) ahead of Production"
  fi
fi

echo "╚═══════════════════════════════════════════════════════════════╝"
```

### 6.7 部署生效验证

```bash
# 部署后验证脚本
verify_deployment() {
  local URL=$1
  local EXPECTED_SHA=$2
  local MAX_RETRIES=10
  local RETRY_INTERVAL=30

  echo "Verifying deployment at $URL..."
  echo "Expected commit: $EXPECTED_SHA"

  for i in $(seq 1 $MAX_RETRIES); do
    CURRENT_SHA=$(curl -s "$URL/api/v1/version" | jq -r '.gitSha')

    if [ "$CURRENT_SHA" = "$EXPECTED_SHA" ]; then
      echo "✅ Deployment verified! Version: $CURRENT_SHA"
      return 0
    fi

    echo "Attempt $i/$MAX_RETRIES: Current=$CURRENT_SHA, Expected=$EXPECTED_SHA"
    sleep $RETRY_INTERVAL
  done

  echo "❌ Deployment verification failed after $MAX_RETRIES attempts"
  return 1
}

# 使用示例
# verify_deployment "https://genesis-ai-backend.up.railway.app" "a1b2c3d"
```

### 6.8 语义化版本号 (SemVer)

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

示例:
  v1.0.0        # 正式发布
  v1.1.0        # 新功能
  v1.1.1        # Bug 修复
  v2.0.0        # 重大变更 (Breaking Changes)
  v1.2.0-beta.1 # 预发布版本
  v1.2.0-rc.1   # Release Candidate
```

**版本递增规则**:

| 变更类型         | 递增       | 示例            |
| ---------------- | ---------- | --------------- |
| Breaking Changes | MAJOR      | v1.x.x → v2.0.0 |
| 新功能 (兼容)    | MINOR      | v1.1.x → v1.2.0 |
| Bug 修复         | PATCH      | v1.1.1 → v1.1.2 |
| 预发布           | PRERELEASE | v1.2.0-beta.1   |

### 6.9 Git Tag 管理

#### 创建版本标签

```bash
# 查看当前版本
git describe --tags --abbrev=0

# 查看所有标签
git tag -l "v*"

# 创建新版本标签 (推荐: 带注释的标签)
git tag -a v1.2.3 -m "Release v1.2.3: Add AI Teams feature"

# 推送标签到远程
git push origin v1.2.3

# 推送所有标签
git push origin --tags
```

#### 版本发布脚本

创建 `scripts/release.sh`:

```bash
#!/bin/bash
# 用法: ./scripts/release.sh <version>
# 示例: ./scripts/release.sh 1.2.3

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.2.3"
  exit 1
fi

# 验证版本格式
if ! [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: Invalid version format. Use MAJOR.MINOR.PATCH[-PRERELEASE]"
  exit 1
fi

TAG="v$VERSION"

# 检查 tag 是否已存在
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists"
  exit 1
fi

# 确保在 main 分支
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Warning: Not on main branch (current: $BRANCH)"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 确保工作区干净
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: Working directory is not clean. Commit or stash changes first."
  exit 1
fi

# 更新 package.json 版本号
echo "Updating package.json versions..."
cd backend && npm version $VERSION --no-git-tag-version && cd ..
cd frontend && npm version $VERSION --no-git-tag-version && cd ..

# 提交版本更新
git add backend/package.json frontend/package.json
git commit -m "chore(release): bump version to $VERSION"

# 创建标签
echo "Creating tag $TAG..."
git tag -a "$TAG" -m "Release $TAG"

# 推送
echo "Pushing to origin..."
git push origin $BRANCH
git push origin "$TAG"

echo ""
echo "✅ Release $TAG created successfully!"
echo ""
echo "Next steps:"
echo "  1. Railway will auto-deploy to production (if configured)"
echo "  2. Verify deployment: railway logs --service backend"
echo "  3. Create GitHub Release: https://github.com/YOUR_ORG/genesis-ai/releases/new?tag=$TAG"
```

### 6.10 环境变量版本追踪

在每个服务中添加版本追踪变量:

```bash
# 设置应用版本 (每次发布后更新)
railway environment production
railway service backend
railway variables set APP_VERSION=1.2.3

railway service frontend
railway variables set NEXT_PUBLIC_APP_VERSION=1.2.3

# 开发环境可设置为 dev 或分支名
railway environment development
railway variables set APP_VERSION=dev
```

**在代码中读取版本**:

```typescript
// backend/src/main.ts
const version = process.env.APP_VERSION || 'unknown';
console.log(`GenesisPod Backend v${version} starting...`);

// 暴露版本端点
@Get('version')
getVersion() {
  return {
    version: process.env.APP_VERSION || 'unknown',
    environment: process.env.RAILWAY_ENVIRONMENT || 'local',
    deployedAt: process.env.RAILWAY_DEPLOYMENT_ID || 'N/A',
  };
}
```

### 6.11 Railway 部署版本管理

#### 查看部署历史

```bash
# 查看部署状态
railway deployment --help

# 使用 Railway Dashboard 查看部署历史
railway open
# 进入 Service → Deployments 查看所有部署记录
```

#### 部署特定 Commit/Tag

```bash
# Railway 默认部署 HEAD
# 要部署特定版本，需要:

# 方法 1: 切换分支/标签后部署
git checkout v1.2.3
railway up

# 方法 2: 在 Railway Dashboard 中选择特定 commit
# Service → Settings → Deploy → 选择 commit
```

### 6.12 回滚策略

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           回滚决策流程                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   发现问题                                                                   │
│       │                                                                      │
│       ▼                                                                      │
│   评估严重性                                                                 │
│       │                                                                      │
│       ├─── 低 ───> 热修复 (Hotfix) ───> 部署新版本                          │
│       │                                                                      │
│       └─── 高 ───> 立即回滚                                                 │
│                       │                                                      │
│                       ├─── 代码问题 ───> Git 回滚 + 重新部署                 │
│                       │                                                      │
│                       ├─── 配置问题 ───> 恢复环境变量                        │
│                       │                                                      │
│                       └─── 数据问题 ───> 数据库回滚 (谨慎!)                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 代码回滚

```bash
# 方法 1: 回滚到上一个版本
git checkout v1.2.2
railway environment production
railway up --service backend

# 方法 2: 使用 Railway Dashboard 回滚
# 进入 Service → Deployments → 选择历史部署 → Redeploy

# 方法 3: Git revert (保留历史)
git revert HEAD
git push origin main
# Railway 自动部署 revert commit
```

#### 环境变量回滚

```bash
# 如果有备份
railway variables --json > backup-vars.json

# 回滚时恢复
cat backup-vars.json | jq -r 'to_entries | .[] | "\(.key)=\(.value)"' | while read line; do
  railway variables set "$line"
done
```

### 6.13 环境变量版本控制

#### 方案 1: Git 加密存储 (推荐)

使用 `git-crypt` 或 `sops` 加密敏感变量:

```bash
# 目录结构
infra/
├── railway/
│   ├── production.env.encrypted   # 生产环境 (加密)
│   ├── development.env.encrypted  # 开发环境 (加密)
│   └── README.md

# 使用 sops 加密
sops -e production.env > production.env.encrypted
git add production.env.encrypted
git commit -m "chore(infra): update production env vars"
```

#### 方案 2: 环境变量备份脚本

创建 `scripts/backup-env.sh`:

```bash
#!/bin/bash
# 备份环境变量到本地加密文件

BACKUP_DIR="infra/railway/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

for ENV in production development; do
  echo "Backing up $ENV..."
  railway environment $ENV
  railway variables --json > "$BACKUP_DIR/${ENV}_${TIMESTAMP}.json"
done

echo "Backups saved to $BACKUP_DIR"
```

#### 方案 3: 变更记录表

在项目中维护 `CHANGELOG-ENV.md`:

```markdown
# 环境变量变更记录

## 2026-01-28

### Production

- ADD: `NEW_FEATURE_FLAG=true` - 启用新特性
- UPDATE: `LOG_LEVEL=info` → `LOG_LEVEL=warn` - 减少日志量

### Development

- ADD: `DEBUG_MODE=true` - 启用调试模式
```

### 6.14 发布检查清单模板

创建 `docs/templates/release-checklist.md`:

```markdown
# Release Checklist - v{VERSION}

## 发布前

- [ ] 所有 PR 已合并到 main
- [ ] 本地测试通过: `npm run verify:full`
- [ ] 更新 CHANGELOG.md
- [ ] 更新 package.json 版本号

## 发布

- [ ] 创建 Git Tag: `git tag -a v{VERSION} -m "Release v{VERSION}"`
- [ ] 推送 Tag: `git push origin v{VERSION}`
- [ ] Railway 自动部署 (或手动触发)

## 发布后验证

- [ ] 检查部署状态: `railway logs --service backend`
- [ ] 验证版本端点: `curl https://api/version`
- [ ] Smoke 测试核心功能
- [ ] 监控错误率 (Sentry/日志)

## 回滚准备

- [ ] 记录上一个稳定版本: v{PREV_VERSION}
- [ ] 确认回滚命令可用

## 通知

- [ ] 团队通知 (Slack/企业微信)
- [ ] 更新发布文档
```

### 6.15 CI/CD 集成

在 GitHub Actions 中自动化版本管理:

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Extract version
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Build and test
        run: |
          npm ci
          npm run verify:full

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          generate_release_notes: true
          body: |
            ## What's Changed
            See [CHANGELOG.md](./CHANGELOG.md) for details.

            ## Deployment
            - Production: Auto-deployed via Railway
            - Version: v${{ steps.version.outputs.VERSION }}

      # Railway 通过 GitHub 集成自动部署
      # 或使用 Railway CLI 手动部署:
      # - name: Deploy to Railway
      #   run: |
      #     npm install -g @railway/cli
      #     railway up --service backend
```

### 6.16 版本查询命令

```bash
# 查看当前生产版本
curl -s https://genesis-ai-backend.up.railway.app/api/v1/version | jq

# 查看 Git 标签版本
git describe --tags --abbrev=0

# 查看所有版本
git tag -l "v*" --sort=-version:refname | head -10

# 比较两个版本的变更
git log v1.2.2..v1.2.3 --oneline
```

---

## 7. 本地开发连接

### 7.1 连接选项

| 方案           | 适用场景               | 复杂度 |
| -------------- | ---------------------- | ------ |
| 本地 Docker    | 完全离线开发，数据隔离 | 低     |
| Railway Dev DB | 需要真实开发数据       | 中     |
| Railway Proxy  | 需要调试 Railway 服务  | 高     |

### 7.2 方案 1: 本地 Docker (推荐)

```bash
# 启动本地数据库服务
docker-compose up -d postgres redis

# 配置本地环境变量 (backend/.env)
DATABASE_URL=postgresql://genesis:genesis_dev_password@localhost:5432/genesis
REDIS_URL=redis://localhost:6379

# 运行迁移
cd backend && npx prisma migrate dev

# 启动开发服务
npm run dev
```

### 7.3 方案 2: 连接 Railway 开发数据库

```bash
# 1. 获取开发环境数据库连接串
railway environment development
railway variables | grep DATABASE_URL

# 2. 设置本地环境变量
export DATABASE_URL="postgresql://postgres:xxx@xxx.railway.app:5432/railway"

# 3. 启动本地服务
npm run dev:backend
```

**注意**: 需要在 Railway 数据库设置中启用公网访问。

### 7.4 方案 3: Railway Proxy (高级)

```bash
# 建立到 Railway 服务的本地代理
railway environment development
railway connect postgres

# 另一个终端连接 Redis
railway connect redis
```

### 7.5 本地环境变量模板

创建 `backend/.env.local`:

```bash
# 数据库 (本地 Docker)
DATABASE_URL=postgresql://genesis:genesis_dev_password@localhost:5432/genesis

# Redis (本地 Docker)
REDIS_URL=redis://localhost:6379

# 应用配置
NODE_ENV=development
PORT=4000
LOG_LEVEL=debug

# JWT
JWT_SECRET=local-dev-secret-change-in-production

# URLs
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

# OAuth (本地回调)
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/callback

# AI API Keys
# 注意: AI API Keys 由数据库管理，本地开发时需确保数据库中已录入密钥
```

---

## 8. 同步策略

### 8.1 代码同步

```
┌─────────────────────────────────────────────────────────────────┐
│                     Code Sync Flow                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   feature/* ──PR──> develop ──PR──> main                        │
│                        │              │                          │
│                        ▼              ▼                          │
│                  Development     Production                      │
│                                                                  │
│   Hotfix:                                                        │
│   main <── hotfix/* ──> cherry-pick ──> develop                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 配置同步

环境变量通过 Railway Dashboard 或 CLI 管理，不纳入版本控制。

```bash
# 导出环境变量 (备份)
railway environment production
railway variables --json > prod-vars-backup.json

# 导入环境变量
railway variables set KEY1=value1 KEY2=value2
```

### 8.3 数据库 Schema 同步

```bash
# 开发环境创建迁移
railway environment development
railway run npx prisma migrate dev --name add_new_feature

# 提交迁移文件到 Git
git add backend/prisma/migrations
git commit -m "feat(db): add new feature migration"

# 合并到 main 后，生产环境自动应用
# (需要在 CI/CD 中配置 prisma migrate deploy)
```

### 8.4 数据同步 (仅限非敏感数据)

**从生产到开发 (脱敏)**:

```bash
# 1. 导出生产数据 (脱敏)
railway environment production
railway run node scripts/export-sanitized-data.js > data.json

# 2. 导入到开发环境
railway environment development
railway run node scripts/import-data.js < data.json
```

**禁止**: 直接复制生产数据库到开发环境!

---

## 9. Railway CLI 使用指南

### 9.1 安装和登录

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录 (浏览器认证)
railway login

# 验证登录状态
railway whoami
```

### 9.2 项目和环境操作

```bash
# 链接到项目
railway link

# 查看当前项目
railway status

# 列出所有环境
railway environment list

# 切换环境
railway environment production
railway environment development

# 打开 Railway Dashboard
railway open
```

### 9.3 服务管理

```bash
# 列出服务
railway service list

# 切换服务上下文
railway service backend

# 查看服务日志
railway logs
railway logs --service backend
railway logs --service frontend --lines 100

# 部署服务
railway up
railway up --service backend

# 重新部署
railway redeploy
railway redeploy --service backend
```

### 9.4 环境变量管理

```bash
# 查看所有变量
railway variables

# 查看特定变量
railway variables get DATABASE_URL

# 设置变量
railway variables set NODE_ENV=development

# 批量设置
railway variables set KEY1=value1 KEY2=value2

# 删除变量
railway variables delete OLD_KEY

# 导出为 JSON
railway variables --json > vars.json
```

### 9.5 数据库操作

```bash
# 连接到数据库 (开启本地代理)
railway connect postgres

# 运行数据库命令
railway run npx prisma migrate deploy
railway run npx prisma db seed
railway run npx prisma studio
```

### 9.6 常用命令速查表

| 命令                         | 描述               |
| ---------------------------- | ------------------ |
| `railway login`              | 登录 Railway       |
| `railway link`               | 链接本地目录到项目 |
| `railway environment <name>` | 切换环境           |
| `railway service <name>`     | 切换服务           |
| `railway up`                 | 部署当前目录       |
| `railway logs`               | 查看日志           |
| `railway variables`          | 查看环境变量       |
| `railway variables set K=V`  | 设置环境变量       |
| `railway run <cmd>`          | 在远程环境运行命令 |
| `railway connect <service>`  | 建立本地代理连接   |
| `railway redeploy`           | 触发重新部署       |
| `railway open`               | 打开 Dashboard     |

---

## 10. 实施检查清单

### 10.1 紧急修复 (立即执行)

- [ ] **创建开发环境独立数据库**

  ```bash
  railway environment development
  railway add --plugin postgresql
  ```

- [ ] **更新开发环境 DATABASE_URL**

  ```bash
  railway variables set DATABASE_URL='${{postgres.DATABASE_URL}}'
  ```

- [ ] **修复开发环境 OAuth 回调地址**

  ```bash
  railway variables set GOOGLE_CALLBACK_URL=https://backend-development-5f56.up.railway.app/api/v1/auth/google/callback
  railway variables set GITHUB_CALLBACK_URL=https://backend-development-5f56.up.railway.app/api/v1/auth/github/callback
  ```

- [ ] **修复开发环境 FRONTEND_URL**

  ```bash
  railway variables set FRONTEND_URL=https://frontend-development-74d8.up.railway.app
  railway variables set CORS_ORIGIN=https://frontend-development-74d8.up.railway.app
  ```

- [ ] **更新前端 API URL**
  ```bash
  railway service frontend
  railway variables set NEXT_PUBLIC_API_URL=https://backend-development-5f56.up.railway.app
  ```

### 10.2 数据库初始化

- [ ] **运行开发数据库迁移**

  ```bash
  railway environment development
  railway run npx prisma migrate deploy
  ```

- [ ] **运行 Seed 脚本 (可选)**
  ```bash
  railway run npx prisma db seed
  ```

### 10.3 验证清单

- [ ] **开发环境健康检查**

  ```bash
  curl https://backend-development-5f56.up.railway.app/api/v1/health
  ```

- [ ] **开发环境前端访问**

  ```bash
  curl -I https://frontend-development-74d8.up.railway.app
  ```

- [ ] **OAuth 登录测试**
  - 访问开发前端
  - 点击 Google 登录
  - 确认回调地址正确

- [ ] **数据库隔离验证**
  ```bash
  # 在开发环境创建测试数据
  # 确认生产环境没有该数据
  ```

### 10.4 版本化实施

- [ ] **创建版本生成脚本**

  ```bash
  # backend/scripts/generate-version.ts
  # frontend/scripts/generate-version.ts
  ```

- [ ] **更新构建脚本** (package.json 添加 prebuild)

- [ ] **创建版本 API 端点** (backend/src/modules/system/version.controller.ts)

- [ ] **更新启动日志** (main.ts 打印版本信息)

- [ ] **部署并验证**
  ```bash
  curl https://genesis-ai-backend.up.railway.app/api/v1/version | jq
  ```

### 10.5 文档更新

- [ ] 更新 `infra/railway/README.md` 添加多环境说明
- [ ] 更新 `infra/railway/*.env.example` 添加环境区分注释
- [ ] 在团队 Wiki 记录环境访问地址

---

## 11. 新增环境操作指南

> 完整的新环境创建流程，适用于新增 staging 或其他环境。

### 11.1 步骤 1: 创建 Railway Environment

1. 进入 Railway Dashboard → 项目设置
2. 点击 "New Environment"
3. 命名环境（如 `staging`）
4. 选择是否从现有环境复制服务结构

### 11.2 步骤 2: 添加独立 PostgreSQL

```bash
railway environment staging
railway add --plugin postgresql
```

或通过 Dashboard: New → Database → PostgreSQL

### 11.3 步骤 3: 数据库迁移

如果需要从现有环境复制数据（含 API Keys）：

```bash
# 从开发环境导出
pg_dump -Fc <source-database-url> > backup.dump

# 导入到新环境
pg_restore -d <target-database-url> backup.dump
```

> 通过数据库迁移，密钥管理模块中的 API Keys 会自动带入新环境。

### 11.4 步骤 4: 运行 Prisma 迁移

```bash
railway environment staging
railway run npx prisma migrate deploy
```

### 11.5 步骤 5: 配置环境变量

仅需配置 URL 类和基础设施变量，AI API Keys 已通过数据库迁移带入：

```bash
railway variables set \
  NODE_ENV=staging \
  PORT=4000 \
  DATABASE_URL='${{postgres.DATABASE_URL}}' \
  REDIS_URL='${{redis.REDIS_URL}}' \
  FRONTEND_URL=https://frontend-staging-xxxx.up.railway.app \
  CORS_ORIGIN=https://frontend-staging-xxxx.up.railway.app \
  JWT_SECRET=<staging-unique-secret-64-chars> \
  GOOGLE_CALLBACK_URL=https://backend-staging-xxxx.up.railway.app/api/v1/auth/google/callback \
  GITHUB_CALLBACK_URL=https://backend-staging-xxxx.up.railway.app/api/v1/auth/github/callback
```

### 11.6 步骤 6: OAuth 回调地址注册

在第三方平台注册新环境的回调地址：

| 平台   | 操作位置                                                                                      | 添加内容             |
| ------ | --------------------------------------------------------------------------------------------- | -------------------- |
| Google | [Google Cloud Console](https://console.cloud.google.com/) → APIs → Credentials → OAuth Client | 添加新环境的回调 URI |
| GitHub | GitHub Settings → Developer settings → OAuth Apps                                             | 添加新环境的回调 URL |

### 11.7 步骤 7: Git 分支映射

在 Railway Dashboard 中为新环境配置源分支：

1. 选择新环境中的 Backend 服务 → Settings → Deploy
2. 设置 Branch（如 `staging` 或 `release/*`）
3. 配置 Auto Deploy 策略

### 11.8 步骤 8: 验证清单

- [ ] 数据库连接正常: `railway run npx prisma db pull`
- [ ] API 健康检查: `curl https://backend-staging-xxxx.up.railway.app/api/v1/health`
- [ ] 前端可访问: `curl -I https://frontend-staging-xxxx.up.railway.app`
- [ ] OAuth 登录流程正常（Google / GitHub）
- [ ] AI 功能正常（API Keys 已从数据库加载）
- [ ] 版本端点返回正确环境信息: `curl .../api/v1/version`

---

## 附录 A: 故障排查

### A.1 部署失败

```bash
# 查看构建日志
railway logs --build

# 常见原因:
# 1. 环境变量缺失
# 2. 依赖安装失败
# 3. Prisma 迁移失败
```

### A.2 数据库连接失败

```bash
# 验证数据库服务状态
railway status

# 检查 DATABASE_URL 格式
railway variables get DATABASE_URL

# 测试连接
railway run npx prisma db pull
```

### A.3 OAuth 登录失败

1. 检查 `GOOGLE_CALLBACK_URL` 是否匹配当前环境
2. 检查 Google Cloud Console 中的授权重定向 URI
3. 检查 `FRONTEND_URL` 是否正确

### A.4 服务间通信失败

```bash
# 确认使用内网地址
AI_SERVICE_URL=http://${{ai-service.RAILWAY_PRIVATE_DOMAIN}}:8000

# 而不是公网地址
# AI_SERVICE_URL=https://ai-service-xxx.up.railway.app  # 错误
```

---

## 附录 B: 成本估算

| 环境        | 服务组成                          | 月成本估算 |
| ----------- | --------------------------------- | ---------- |
| Production  | 3 服务 + PostgreSQL + Redis       | $30-50     |
| Development | 3 服务 + PostgreSQL + Redis(共享) | $15-25     |
| **总计**    |                                   | **$45-75** |

_注: 实际成本取决于使用量，Railway 按执行时间计费。_

---

**最后更新**: 2026-01-28
**版本**: 1.1
