# GenesisPod - 开发快速参考

> 本文档提供所有常用命令的快速查找，基于实际代码配置（2026-01-15 更新）

---

## 📦 环境要求

| 工具       | 版本要求  | 用途                 |
| ---------- | --------- | -------------------- |
| Node.js    | >= 20.0.0 | JavaScript 运行时    |
| npm        | >= 9.0.0  | 包管理器             |
| PostgreSQL | >= 16.0   | 主数据库             |
| Redis      | >= 7.0    | 缓存（可选）         |
| Docker     | >= 20.10  | 本地开发环境（推荐） |

---

## 🚀 项目启动

### 完整启动流程（首次）

```bash
# 1. 克隆项目
git clone <repo-url>
cd genesis-ai

# 2. 安装依赖
npm install

# 3. 启动数据库
docker-compose up -d

# 4. 配置环境变量（参考下方模板）
# backend/.env
# frontend/.env.local

# 5. 运行数据库迁移
cd backend
npx prisma migrate dev
npx prisma generate

# 6. 启动开发服务器
cd ..
npm run dev
```

### 日常开发启动

```bash
# 启动数据库
docker-compose up -d

# 启动开发服务器（同时启动 frontend 和 backend）
npm run dev
```

---

## 🛠️ 开发命令

### 全栈命令（根目录）

| 命令                     | 描述                             |
| ------------------------ | -------------------------------- |
| `npm run dev`            | 启动 frontend + backend          |
| `npm run dev:frontend`   | 仅启动前端（端口 3000）          |
| `npm run dev:backend`    | 仅启动后端（端口 4000）          |
| `npm run dev:crawler`    | 启动爬虫服务                     |
| `npm run build`          | 构建 frontend + backend          |
| `npm run build:frontend` | 仅构建前端                       |
| `npm run build:backend`  | 仅构建后端                       |
| `npm run lint`           | 运行 ESLint 检查（全栈）         |
| `npm run lint:fix`       | 自动修复 ESLint 错误             |
| `npm run format`         | 运行 Prettier 格式化             |
| `npm run format:check`   | 检查代码格式（不修改）           |
| `npm run type-check`     | 运行 TypeScript 类型检查（全栈） |

### 测试命令（根目录）

| 命令                    | 描述                     |
| ----------------------- | ------------------------ |
| `npm test`              | 运行所有测试             |
| `npm run test:quick`    | 快速测试（跳过慢速测试） |
| `npm run test:ci`       | CI 环境测试              |
| `npm run test:coverage` | 生成覆盖率报告           |
| `npm run test:frontend` | 仅运行前端测试           |
| `npm run test:backend`  | 仅运行后端测试           |

### 验证命令（推荐）

| 命令                      | 描述                                  |
| ------------------------- | ------------------------------------- |
| `npm run verify:quick`    | 快速验证（类型检查 + 快速测试）       |
| `npm run verify:full`     | 完整验证（Lint + 类型 + 测试 + 构建） |
| `npm run verify:frontend` | 验证前端（类型 + 测试）               |
| `npm run verify:backend`  | 验证后端（类型 + 快速测试）           |
| `npm run verify:changed`  | 智能检测变更并验证                    |

---

## 🗄️ 数据库命令

### Docker Compose

```bash
# 启动所有服务（PostgreSQL + Redis + FlareSolverr）
docker-compose up -d

# 查看运行状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止所有服务
docker-compose down

# 完全清理（包括数据卷）
docker-compose down -v
```

### Prisma 命令（backend 目录）

```bash
cd backend

# 生成 Prisma Client
npx prisma generate

# 运行迁移（开发环境）
npx prisma migrate dev

# 运行迁移（生产环境）
npx prisma migrate deploy

# 查看迁移状态
npx prisma migrate status

# 重置数据库（⚠️ 删除所有数据）
npx prisma migrate reset

# 打开数据库管理界面
npx prisma studio

# 验证 schema 语法
npx prisma validate

# 格式化 schema
npx prisma format
```

---

## 🧪 测试命令详解

### 后端测试（backend 目录）

```bash
cd backend

# 运行所有测试
npm test

# 运行特定测试文件
npm test -- path/to/test.spec.ts

# 快速测试（跳过慢速测试）
npm run test:quick

# 监听模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# E2E 测试
npm run test:e2e
```

### 前端测试（frontend 目录）

```bash
cd frontend

# 运行所有测试
npm test

# 监听模式（推荐开发时使用）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# CI 环境运行
npm run test:ci
```

---

## 🔧 运维命令

### PM2 进程管理

```bash
# 启动 Leader Agent（24 小时运行）
npm run team:start
# 或
pm2 start ecosystem.config.js --only leader-agent

# 查看状态
npm run team:status
# 或
pm2 status

# 查看日志
npm run team:logs
# 或
pm2 logs leader-agent

# 停止服务
npm run team:stop
# 或
pm2 stop leader-agent

# 重启服务
pm2 restart leader-agent

# 查看详细信息
pm2 show leader-agent

# 查看监控面板
pm2 monit
```

### 任务编排（DEAR System）

```bash
# 运行任务
npm run task

# 查看任务状态
npm run task:status

# 或使用别名
npm run dear
```

---

## 🌐 服务访问地址

### 本地开发

| 服务               | URL                                 |
| ------------------ | ----------------------------------- |
| Frontend           | http://localhost:3000               |
| Backend API        | http://localhost:4000/api/v1        |
| API 文档 (Swagger) | http://localhost:4000/api/docs      |
| 健康检查           | http://localhost:4000/api/v1/health |
| Prisma Studio      | http://localhost:5555               |
| PostgreSQL         | localhost:5432                      |
| Redis              | localhost:6379                      |
| FlareSolverr       | http://localhost:8191               |

---

## 📝 环境变量模板

### backend/.env

```bash
# 数据库
DATABASE_URL="postgresql://genesis:genesis_dev_password@localhost:5432/genesis"

# Redis（可选）
REDIS_URL="redis://localhost:6379"

# AI API Keys
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
XAI_API_KEY="xai-..."

# JWT
JWT_SECRET="your-secret-key-change-in-production"

# 应用配置
NODE_ENV="development"
PORT=4000

# FlareSolverr
FLARESOLVERR_URL="http://localhost:8191"
```

### frontend/.env.local

```bash
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

---

## 🐛 常见问题速查

### 端口被占用

```bash
# Windows - 查找并杀掉进程
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:3000 | xargs kill -9
```

### 数据库连接失败

```bash
# 检查 Docker 容器
docker-compose ps

# 重启容器
docker-compose restart postgres

# 测试连接
docker-compose exec postgres pg_isready
```

### Prisma Client 过期

```bash
cd backend
npx prisma generate
```

### 依赖安装失败

```bash
# 清理并重新安装
rm -rf node_modules package-lock.json
npm install

# 或使用 npm ci（更快）
npm ci
```

### Git commit 被拒绝

```bash
# 提交消息格式错误
# ❌ 错误: "fix bug"
# ✅ 正确: "fix(module): 描述问题"

# 提交类型:
# feat, fix, docs, style, refactor, perf, test, chore
```

---

## 📚 相关文档

- [开发指南完整版](./overview.md)
- [测试指南](../testing/overview.md)
- [部署指南](../deployment/overview.md)
- [自动化开发闭环](./automated-development-loop.md)
- [AI 调用规范](./ai-calling-standards.md)

---

**最后更新**: 2026-01-15
**维护者**: GenesisPod Team
