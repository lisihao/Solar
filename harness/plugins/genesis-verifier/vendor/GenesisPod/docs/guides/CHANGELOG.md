# 开发指南更新日志

## 2026-01-15 - 大规模刷新

### 🎯 更新目标

以实际代码配置为基准，更新所有过期或不准确的开发指南文档。

### ✅ 已更新文档

#### 1. **开发指南** (`development/overview.md`)

**关键更新**:

- ✅ 更新环境要求（移除 MongoDB、Python，添加 Docker）
- ✅ 修正数据库启动命令（使用 `docker-compose` 替代 `npm run db:setup`）
- ✅ 更新服务启动命令（移除不存在的 `dev:ai`）
- ✅ 添加环境变量配置说明（项目暂无 `.env.example` 文件）
- ✅ 修正常见问题解答（Q5-Q6）
- ✅ 更新数据库相关 FAQ

**变更内容**:

```diff
- MongoDB: >= 7.0
- Python: >= 3.11 (AI服务)
+ PostgreSQL: >= 16.0 (主数据库)
+ Redis: >= 7.0 (缓存，可选)
+ Docker: >= 20.10 (推荐，用于本地数据库)

- npm run db:setup
- npm run db:migrate
+ docker-compose up -d
+ cd backend && npx prisma migrate dev

- npm run dev:ai         # ❌ 不存在
+ npm run dev:crawler    # ✅ 存在
```

#### 2. **测试指南** (`testing/overview.md`)

**关键更新**:

- ✅ 更新测试依赖说明（已配置，无需额外安装）
- ✅ 添加测试框架说明（后端 Jest，前端 Vitest）
- ✅ 更新测试命令（添加 `test:quick`）
- ✅ 明确覆盖率阈值（当前 50%）

**变更内容**:

```diff
+ 本项目已配置测试环境，无需额外安装依赖。
+
+ 后端测试栈: Jest, @nestjs/testing, ts-jest, supertest
+ 前端测试栈: Vitest, @testing-library/react, jsdom
+ 覆盖率: 当前阈值 50%

+ # 快速测试（跳过慢速测试）
+ npm run test:quick
```

#### 3. **部署指南** (`deployment/overview.md`)

**关键更新**:

- ✅ 更新架构图（移除 Neo4j、MongoDB、AI Service）
- ✅ 添加架构说明（统一 PostgreSQL，添加 FlareSolverr）
- ✅ 更新环境变量配置（移除 Neo4j，添加 AI API Keys）
- ✅ 修正服务端口和依赖

**变更内容**:

```diff
- Neo4j (Port: 7474)
- AI Service (Port: 5000)
+ Redis (Port: 6379)
+ FlareSolverr (Port: 8191)

+ 架构说明:
+ - 数据库: 统一使用 PostgreSQL (已移除 MongoDB、Neo4j、Qdrant)
+ - 缓存: Redis (可选，用于会话和缓存)
+ - 反爬虫: FlareSolverr (绕过 Cloudflare 保护)

- NEO4J_URL="bolt://neo4j-host:7687"
- AI_SERVICE_URL="http://ai-service:5000"
+ OPENAI_API_KEY="sk-..."
+ ANTHROPIC_API_KEY="sk-ant-..."
+ XAI_API_KEY="xai-..."
+ FLARESOLVERR_URL="http://flaresolverr:8191"
```

#### 4. **新增文档**

##### A. 快速参考指南 (`development/quick-reference.md`) 🆕

**内容**:

- 📦 环境要求表格
- 🚀 完整启动流程（首次 + 日常）
- 🛠️ 开发命令速查表
- 🗄️ 数据库命令（Docker Compose + Prisma）
- 🧪 测试命令详解（后端 + 前端）
- 🔧 运维命令（PM2 + DEAR）
- 🌐 服务访问地址表格
- 📝 环境变量模板
- 🐛 常见问题速查

**目标用户**: 新开发者、快速查找命令时

##### B. 环境变量配置指南 (`development/environment-variables.md`) 🆕

**内容**:

- 📋 快速配置（复制粘贴模板）
- 📖 详细说明（每个变量的用途、格式、示例）
- 🔒 安全最佳实践
- 环境隔离建议
- 密钥生成方法
- 云服务商密钥管理

**目标用户**: 新开发者、部署运维人员

---

### 🔍 发现的问题

#### 1. 缺失的文件

- ❌ **backend/.env.example** - 不存在
- ❌ **frontend/.env.local.example** - 不存在

**解决方案**: 创建了 `docs/guides/development/environment-variables.md` 文档说明

#### 2. 架构变化

**数据库架构重大变更**:

- ✅ 已迁移到统一 PostgreSQL 架构
- ❌ 移除了 Neo4j（知识图谱）
- ❌ 移除了 MongoDB（原始数据）
- ❌ 移除了 Qdrant（向量数据库）

**当前架构**:

- PostgreSQL: 主数据库（关系数据 + JSONB 存储 + 递归 CTE 图谱）
- Redis: 缓存（可选）
- FlareSolverr: 反爬虫代理服务

#### 3. AI 服务变化

**旧架构**:

- 独立的 Python AI Service (Port 5000)
- `npm run dev:ai` 启动

**新架构**:

- 直接调用 AI Provider API（OpenAI, Anthropic, xAI）
- 通过 backend 统一调度
- 移除独立 AI Service

#### 4. package.json 中的命令

**已验证的命令**:

```bash
✅ npm run dev                # 启动 frontend + backend
✅ npm run dev:frontend       # 启动前端
✅ npm run dev:backend        # 启动后端
✅ npm run dev:crawler        # 启动爬虫服务
✅ npm run test:quick         # 快速测试
✅ npm run verify:quick       # 快速验证
✅ npm run verify:full        # 完整验证
✅ npm run verify:changed     # 智能变更验证
✅ npm run team:start         # PM2 启动 Leader Agent
✅ npm run team:stop          # PM2 停止
✅ npm run team:logs          # PM2 日志
✅ npm run task / npm run dear # 任务编排
```

**不存在的命令** (已从文档中移除):

```bash
❌ npm run dev:ai             # AI 服务已移除
❌ npm run db:setup           # 应使用 docker-compose up -d
❌ npm run db:migrate         # 应使用 cd backend && npx prisma migrate dev
```

---

### 📊 测试配置验证

#### 后端测试 (Jest)

**配置文件**: `backend/jest.config.js`

```javascript
覆盖率阈值: 50% (Phase 1)
测试环境: node
转译工具: ts-jest (isolatedModules: true)
覆盖率报告: text, text-summary, lcov, html
```

#### 前端测试 (Vitest)

**配置文件**: `frontend/vitest.config.ts`

```typescript
覆盖率阈值: 50% (Phase 1)
测试环境: jsdom
覆盖率工具: v8
超时配置: 30000ms
```

---

### 🎨 Docker Compose 配置

**当前服务** (docker-compose.yml):

```yaml
services:
  - flaresolverr (Port 8191) - Cloudflare 绕过
  - postgres (Port 5432) - 主数据库
  - redis (Port 6379) - 缓存
```

**已移除**:

- ❌ neo4j
- ❌ mongodb
- ❌ qdrant
- ❌ ai-service

---

### 📝 文档命名规范验证

**已验证**: 所有新建文档遵循 kebab-case 规范

```
✅ quick-reference.md
✅ environment-variables.md
✅ overview.md
✅ automated-development-loop.md
```

---

### 🔄 后续建议

#### 短期（1-2 周）

1. **创建 .env.example 文件**

   ```bash
   backend/.env.example
   frontend/.env.local.example
   ```

2. **更新根目录 README.md**
   - 添加快速启动指南链接
   - 更新架构说明（移除 MongoDB/Neo4j）

3. **验证所有命令**
   - 在新环境中测试文档中的所有命令
   - 确保 Windows/macOS/Linux 兼容性

#### 中期（1-2 月）

1. **架构文档更新**
   - 更新 `docs/architecture/` 中的架构决策记录
   - 说明数据库迁移到统一 PostgreSQL 的原因

2. **API 文档同步**
   - 验证 `docs/api/` 中的端点是否与实际 Swagger 一致
   - 更新数据模型文档

3. **部署指南补充**
   - 添加 Railway 部署最佳实践
   - 补充 Docker 生产部署配置

#### 长期（持续）

1. **自动化文档验证**
   - 编写脚本验证文档中的命令
   - CI 中检查文档链接有效性

2. **文档版本管理**
   - 随代码变更同步更新文档
   - 添加文档更新日期和版本号

3. **开发者体验优化**
   - 收集新开发者反馈
   - 持续改进快速上手流程

---

### 📚 文档清单

#### 已更新

- ✅ `docs/guides/development/overview.md`
- ✅ `docs/guides/testing/overview.md`
- ✅ `docs/guides/deployment/overview.md`

#### 新增

- 🆕 `docs/guides/development/quick-reference.md`
- 🆕 `docs/guides/development/environment-variables.md`
- 🆕 `docs/guides/CHANGELOG.md` (本文件)

#### 待更新（建议）

- ⏳ `docs/readme.md` - 总导航
- ⏳ `docs/architecture/` - 架构设计文档
- ⏳ `docs/api/` - API 接口文档
- ⏳ 根目录 `README.md` - 项目主文档

---

### ✨ 改进亮点

1. **准确性提升**
   - 所有命令基于实际 package.json 验证
   - 环境配置基于实际 docker-compose.yml
   - 移除不存在的服务和命令

2. **易用性增强**
   - 新增快速参考指南（命令速查）
   - 详细的环境变量说明文档
   - 清晰的首次启动流程

3. **安全性强化**
   - 环境变量安全最佳实践
   - 密钥管理建议
   - 环境隔离指南

4. **开发体验优化**
   - 表格化命令清单（易扫描）
   - 分类清晰（全栈/前端/后端）
   - 常见问题速查

---

## 维护记录

| 日期       | 维护者       | 操作       |
| ---------- | ------------ | ---------- |
| 2026-01-15 | Claude Agent | 大规模刷新 |

---

**下次更新建议**: 2026-02-15 或代码重大变更时
