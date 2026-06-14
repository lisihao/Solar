# GenesisPod - 部署指南

> **版本**: 1.0.0
> **更新时间**: 2025-11-21

---

## 📋 目录

1. [部署前准备](#部署前准备)
2. [环境配置](#环境配置)
3. [部署流程](#部署流程)
4. [健康检查](#健康检查)
5. [回滚流程](#回滚流程)
6. [监控告警](#监控告警)
7. [故障排查](#故障排查)

---

## 🚀 部署前准备

### 检查清单

在部署前，请确认以下检查项：

- [ ] 所有测试通过（`npm run test`）
- [ ] 代码已通过review
- [ ] 数据库迁移已准备
- [ ] 环境变量已配置
- [ ] 依赖已更新
- [ ] Changelog已更新
- [ ] 团队已通知

### 必需工具

```bash
# Node.js v20+
node --version

# npm v9+
npm --version

# Git
git --version

# Railway CLI (可选)
railway --version
```

---

## ⚙️ 环境配置

### 环境变量

#### Backend (.env)

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/genesis
MONGODB_URI=mongodb://host:27017/genesis

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGINS=https://yourdomain.com

# AI Service
AI_SERVICE_URL=http://ai-service:5000

# Node Environment
NODE_ENV=production
PORT=4000
```

#### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

#### AI Service (.env)

```env
OPENAI_API_KEY=your-openai-key
GROK_API_KEY=your-grok-key
PORT=5000
```

---

## 🚢 部署流程

### 1. 标准部署流程

```bash
# 1. 确保在main分支
git checkout main
git pull origin main

# 2. 运行完整测试
npm run test

# 3. 构建项目
npm run build

# 4. 推送到远程（会触发CI/CD）
git push origin main
```

### 2. 手动部署（紧急情况）

```bash
# 1. 跳过pre-push hook
git push origin main --no-verify

# 2. 监控部署状态
# 查看Railway/GitHub Actions日志

# 3. 部署完成后立即运行smoke tests
npm run smoke-test -- --env=production
```

### 3. 数据库迁移

```bash
# 生成迁移文件
cd backend
npx prisma migrate dev --name migration_name

# 在生产环境应用迁移
npx prisma migrate deploy

# 查看迁移状态
npx prisma migrate status
```

---

## 🏥 健康检查

### API健康检查

```bash
# 完整健康检查
curl https://api.yourdomain.com/api/v1/health

# 存活性检查
curl https://api.yourdomain.com/api/v1/health/live

# 就绪性检查
curl https://api.yourdomain.com/api/v1/health/ready
```

### 预期响应

```json
{
  "status": "ok",
  "info": {
    "database": {
      "status": "up",
      "message": "Database connection is healthy"
    },
    "memory_heap": {
      "status": "up"
    },
    "storage": {
      "status": "up"
    }
  },
  "error": {},
  "details": {}
}
```

---

## 🔄 回滚流程

### 快速回滚

```bash
# 使用rollback脚本
./scripts/rollback.sh backend production

# 或回滚所有服务
./scripts/rollback.sh all production
```

### 手动回滚

```bash
# 1. 找到上一个稳定版本的commit
git log --oneline -10

# 2. 回滚到指定commit
git revert <commit-hash>

# 3. 推送
git push origin main
```

### 回滚后验证

```bash
# 1. 运行smoke tests
npm run smoke-test -- --env=production

# 2. 检查错误日志
# 查看Railway/CloudWatch日志

# 3. 监控关键指标
# 查看Grafana/监控面板
```

---

## 📊 监控告警

### 关键指标

监控以下指标：

1. **可用性**
   - Uptime > 99.9%
   - Health check成功率 > 99%

2. **性能**
   - API响应时间 < 500ms (P95)
   - 数据库查询时间 < 100ms (P95)

3. **错误率**
   - 5xx错误率 < 0.1%
   - 4xx错误率 < 1%

4. **资源使用**
   - CPU < 80%
   - 内存 < 80%
   - 磁盘 < 85%

### 告警规则

| 指标     | 阈值        | 级别     | 响应时间 |
| -------- | ----------- | -------- | -------- |
| API Down | > 1分钟     | Critical | 立即     |
| 高错误率 | > 5%        | Warning  | 15分钟   |
| 慢响应   | > 2秒 (P95) | Warning  | 30分钟   |
| 资源不足 | > 90%       | Warning  | 30分钟   |

---

## 🔍 故障排查

### 常见问题

#### 1. 部署失败

**症状**: CI/CD pipeline失败

**排查步骤**:

```bash
# 检查测试
npm run test

# 检查构建
npm run build

# 检查环境变量
cat .env.example
```

#### 2. 数据库连接失败

**症状**: P2003 Foreign key constraint violation

**排查步骤**:

```bash
# 检查数据库连接
npx prisma db pull

# 运行迁移
npx prisma migrate deploy

# 检查数据完整性
npx prisma studio
```

#### 3. 认证失败

**症状**: 401 Unauthorized

**排查步骤**:

```bash
# 检查JWT配置
echo $JWT_SECRET

# 验证token
curl -H "Authorization: Bearer <token>" \
  https://api.yourdomain.com/api/v1/health
```

---

## 📞 紧急联系

| 角色       | 联系方式 | 响应时间 |
| ---------- | -------- | -------- |
| 值班工程师 | -        | 立即     |
| 技术负责人 | -        | 15分钟   |
| 运维负责人 | -        | 30分钟   |

---

## 📝 变更日志

| 日期       | 版本  | 变更内容 |
| ---------- | ----- | -------- |
| 2025-11-21 | 1.0.0 | 初始版本 |

---

## 🔗 相关文档

- [架构设计](./architecture.md)
- [优化方案](./optimization-plan.md)
- [故障排查](./TROUBLESHOOTING.md)
- [API文档](./API.md)
