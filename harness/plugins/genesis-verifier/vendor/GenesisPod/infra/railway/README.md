# Railway Operations

This is the **single ops-side entry point** for everything Railway-related.
Container-side files (Dockerfile, railway.toml, scripts that run _inside_
the image) stay under `backend/`, `frontend/`, `ai-service/`. Operator-side
files (env templates, runbooks, deploy/monitor scripts) all live here.

## Layout

```
infra/railway/
├── README.md                   ← you are here
├── DEPLOY.md                   ← first-time setup walkthrough
├── TROUBLESHOOTING.md          ← common build/runtime errors
├── envs/
│   ├── backend.env.example
│   ├── frontend.env.example
│   └── backend.env.railway.example
├── scripts/                    ← run by engineer / CI, NOT in image
│   ├── deploy.sh               ← initial project setup
│   ├── monitor.sh              ← prod snapshot (per-service status + healthchecks)
│   ├── logs.sh [service]       ← tail logs (--build for build phase)
│   ├── studio.sh               ← prisma studio against prod DB via public proxy
│   ├── db-shell.sh             ← psql against prod DB via public proxy
│   ├── studio-railway.{ps1,bat}← Windows wrappers for studio.sh
│   └── release-notify.ts       ← AI-generated release notes broadcast
└── runbooks/
    ├── rollback.md             ← bad commit / bad migration recovery
    ├── db-migration.md         ← how to add migrations safely
    └── incident-response.md    ← prod is on fire — read this first
```

Container-side files (DO NOT touch from this directory):

```
backend/
├── Dockerfile                  ← Railway build (platform convention)
├── railway.toml                ← per-service Railway config
└── scripts/
    └── entrypoint.sh           ← single source of truth for container boot
                                  (sets NODE_ENV, runs `npm run deploy`,
                                  exec node dist/main; PR-X43)
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Railway Project                   │
├──────────┬──────────┬──────────┬──────────┬─────────┤
│ Frontend │ Backend  │  Redis   │ Postgres │ ai-svc  │
│ Next.js  │  NestJS  │  cache   │ Prisma   │ FastAPI │
│  :3000   │  :4000   │  :6379   │  :5432   │  :PORT  │
└──────────┴──────────┴──────────┴──────────┴─────────┘
```

## 快速部署步骤

### 1. 安装 Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### 2. 创建项目

```bash
railway init
# 选择 "Empty Project"
```

### 3. 添加数据库服务

```bash
# 在 Railway Dashboard 中:
# 1. 点击 "New" -> "Database" -> "PostgreSQL"
# 2. 点击 "New" -> "Database" -> "Redis"
```

### 4. 部署 Backend

```bash
cd backend
railway link  # 选择你的项目
railway up
```

### 5. 部署 Frontend

```bash
cd frontend
railway link
railway up
```

### 6. 配置环境变量

在 Railway Dashboard 中为每个服务配置环境变量。

## 环境变量配置

### Backend Service

```env
# Database (Railway 自动注入)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Redis (Railway 自动注入)
REDIS_URL=${{Redis.REDIS_URL}}

# App Config
NODE_ENV=production
PORT=4000

# JWT
JWT_SECRET=your-super-secret-jwt-key

# External APIs
OPENAI_API_KEY=your-openai-key
```

### Frontend Service

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=${{Backend.RAILWAY_PUBLIC_DOMAIN}}/api
```

## 费用估算

| 服务       | 预估费用/月 |
| ---------- | ----------- |
| Frontend   | ~$2-5       |
| Backend    | ~$3-8       |
| PostgreSQL | ~$5         |
| Redis      | ~$3         |
| **总计**   | **~$13-21** |

免费额度: $5/月 (Hobby plan trial)

## 自动部署

Railway 会自动监听 GitHub 仓库的 push 事件并部署。

配置分支:

- `main` -> Production
- `develop` -> Staging (可选)

## Daily commands

```bash
# Snapshot all services (status + commit + healthcheck body)
./infra/railway/scripts/monitor.sh

# Tail logs
./infra/railway/scripts/logs.sh backend
./infra/railway/scripts/logs.sh ai-service --build

# Browse prod data (Prisma Studio against public proxy)
./infra/railway/scripts/studio.sh

# Run ad-hoc SQL
./infra/railway/scripts/db-shell.sh -- -c "SELECT count(*) FROM users;"
```

## When something breaks

Read `runbooks/incident-response.md` first — that file walks you through
classification, mitigation, and post-mortem. The other two runbooks are
deeper dives:

- `runbooks/rollback.md` — bad commit or bad migration recovery
- `runbooks/db-migration.md` — how to add migrations safely

Also see the older `TROUBLESHOOTING.md` for build-error patterns we've
hit historically.
