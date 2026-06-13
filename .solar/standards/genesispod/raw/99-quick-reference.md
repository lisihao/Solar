# 快速参考指南

**版本：** 1.0
**更新日期：** 2025-11-08

---

## 一分钟开始

```bash
# 1. 克隆并设置项目
git clone https://github.com/genesis-agents/GenesisPod.git
cd genesis-ai

# 2. 安装依赖
npm install              # 根目录
cd frontend && npm install
cd ../backend && npm install
cd ../ai-service && pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入实际配置

# 4. 启动数据库
docker-compose up -d

# 5. 启动服务
cd frontend && npm run dev       # Terminal 1: http://localhost:3000
cd backend && npm run dev        # Terminal 2: http://localhost:4000
cd ai-service && python main.py  # Terminal 3: http://localhost:5000
```

---

## 常用命令

### 开发

```bash
# 启动开发服务器
cd frontend && npm run dev
cd backend && npm run dev
cd ai-service && python main.py

# 构建生产版本
cd frontend && npm run build
cd backend && npm run build

# 运行测试
cd frontend && npm test
cd backend && npm run test
cd ai-service && pytest
```

### 代码检查

```bash
# Lint检查
cd frontend && npm run lint
cd backend && npm run lint
cd ai-service && pylint services/

# 类型检查
cd frontend && npm run type-check
cd backend && npm run type-check

# 格式化代码
cd frontend && npm run format
cd backend && npm run format
cd ai-service && black services/ tests/
```

### 数据库

```bash
# Prisma迁移
cd backend && npx prisma migrate dev
cd backend && npx prisma migrate deploy

# 查看数据库
cd backend && npx prisma studio

# 种子数据
cd backend && npx prisma db seed
```

### Git工作流

```bash
# 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/001-your-feature

# 提交代码
git add .
git commit -m "feat(module): add your feature"

# 推送并创建PR
git push origin feature/001-your-feature
```

---

## 提交信息速查

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

```
feat:      新功能
fix:       bug修复
refactor:  代码重构
test:      测试
docs:      文档
chore:     杂务
perf:      性能优化
ci:        CI/CD
style:     格式化
revert:    撤销
```

### Scopes

```
frontend, backend, ai-service, crawler
proxy, resource, feed, api, database, auth, config
```

### 示例

```
feat(proxy): add PDF proxy for arXiv papers
fix(frontend): resolve PDF iframe blocking
refactor(ai-service): optimize retry logic
docs(readme): update setup instructions
test(backend): add resource controller tests
```

---

## 命名规范速查

### 文件命名

```
✅ TypeScript:  kebab-case.ts      (proxy-controller.ts)
✅ Python:      snake_case.py      (grok_client.py)
✅ React组件:   PascalCase.tsx     (FeedCard.tsx)
✅ 测试文件:    *.spec.ts, *.test.tsx, test_*.py
✅ 文档:        kebab-case.md      (quick-reference.md)
```

### 代码命名

```
✅ 类名:        PascalCase         (ProxyController)
✅ 函数/方法:   camelCase (TS)     (getResource)
               snake_case (Py)    (get_resource)
✅ 变量:        camelCase (TS)     (userId)
               snake_case (Py)    (user_id)
✅ 常量:        UPPER_SNAKE        (MAX_RETRY_COUNT)
✅ 接口:        PascalCase+I       (IResourceService)
```

### 数据库命名

```
✅ 表名:        snake_case 复数    (resources, users)
✅ 列名:        snake_case         (created_at, user_id)
✅ 索引:        idx_table_column   (idx_resources_type)
✅ 外键:        fk_table_ref       (fk_resources_user)
```

### API路由命名

```
✅ 路径:        kebab-case         (/api/v1/data-sources)
✅ 资源:        复数名词           (/api/v1/resources)
✅ ID参数:      {id}               (/api/v1/resources/{id})
```

---

## 目录结构速查

### Frontend (Next.js)

```
frontend/
├── app/                  ← App Router页面
├── components/
│   ├── ui/              ← 基础UI组件
│   ├── features/        ← 功能组件
│   └── layout/          ← 布局组件
├── lib/                 ← 工具函数
└── types/               ← 类型定义
```

### Backend (NestJS)

```
backend/
├── src/
│   ├── modules/         ← 功能模块
│   │   └── resource/
│   │       ├── resource.module.ts
│   │       ├── resource.controller.ts
│   │       ├── resource.service.ts
│   │       ├── dto/
│   │       └── entities/
│   ├── common/          ← 共享代码
│   └── config/          ← 配置
└── prisma/              ← 数据库Schema
```

### AI Service (FastAPI/Python)

```
ai-service/
├── main.py              ← 应用入口
├── routers/             ← API路由
├── services/            ← 业务逻辑
├── models/              ← 数据模型
├── utils/               ← 工具函数
└── tests/               ← 测试
```

---

## 代码审查清单

### 提交前检查

- [ ] 代码遵循命名规范
- [ ] 通过所有Lint检查
- [ ] 通过所有类型检查
- [ ] 测试覆盖率 > 85%
- [ ] 所有测试通过
- [ ] 没有新增 `supplemental` / `extra` / `legacy` 测试命名
- [ ] 新增能力已归类为 tool / skill / provider / protocol / memory 扩展点之一
- [ ] 没有新增第二个主线 registry / checkpoint contract
- [ ] 提交信息遵循Conventional Commits
- [ ] 没有硬编码密钥
- [ ] 没有console.log/print调试代码
- [ ] 代码有必要的注释
- [ ] 文档已更新

### PR检查

- [ ] PR标题清晰
- [ ] PR描述完整
- [ ] 关联相关Issue
- [ ] 通过CI检查
- [ ] 至少1个reviewer批准
- [ ] 没有merge冲突

---

## 环境变量

### Backend (.env)

```env
DATABASE_URL="postgresql://..."
NEO4J_URI="bolt://localhost:7687"
NEO4J_PASSWORD="..."
MONGODB_URI="mongodb://localhost:27017"
JWT_SECRET="..."
```

### AI Service (.env)

```env
GROK_API_KEY="..."
OPENAI_API_KEY="..."
USE_GCP_SECRET_MANAGER=false
GCP_PROJECT_ID="..."
```

---

## 故障排查

### 问题：端口被占用

```bash
# 查看端口占用
netstat -ano | findstr :3000
netstat -ano | findstr :4000

# 杀死进程 (Windows)
taskkill /PID <PID> /F

# 杀死进程 (Linux/Mac)
kill -9 <PID>
```

### 问题：数据库连接失败

```bash
# 检查Docker容器状态
docker-compose ps

# 重启数据库
docker-compose down
docker-compose up -d

# 查看日志
docker-compose logs postgres
```

### 问题：前端编译错误

```bash
# 清理缓存
cd frontend
rm -rf .next node_modules
npm install
npm run dev
```

### 问题：AI服务超时

```bash
# 检查AI服务日志
cd ai-service
python main.py

# 增加超时时间（在.env中）
AI_SERVICE_TIMEOUT=60
```

---

## 有用的链接

- **项目文档：** [readme.md](../../readme.md)
- **产品需求：** [prd.md](../../prd.md)
- **技术架构：** [architecture.md](../../architecture.md)
- **开发规范：** [project-rules.md](../../project-rules.md)
- **GitHub：** https://github.com/genesis-agents/GenesisPod
- **Issues：** https://github.com/genesis-agents/GenesisPod/issues

---

## 获取帮助

1. **查看文档：** 阅读 `.claude/standards/` 下的详细规范
2. **搜索Issues：** 查看是否已有类似问题
3. **提问：** 创建新Issue标签为 `question`
4. **团队讨论：** 在团队会议中提出

---

**记住：** 这是快速参考，详细内容请查看完整规范文档！
