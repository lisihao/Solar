# GenesisPod - 发布流程

> 从开发到生产的完整发布工作流程。

| 属性         | 值                                                                       |
| ------------ | ------------------------------------------------------------------------ |
| **文档状态** | 📋 规划中 (Planned)                                                      |
| **实施状态** | ⏳ 待实施                                                                |
| **创建日期** | 2026-01-19                                                               |
| **前置文档** | [multi-environment-architecture.md](./multi-environment-architecture.md) |

---

## 实施清单

| 步骤 | 内容                       | 状态      |
| ---- | -------------------------- | --------- |
| 1    | 创建 deploy-staging.yml    | ⏳ 待实施 |
| 2    | 创建 deploy-production.yml | ⏳ 待实施 |
| 3    | 更新 smoke-tests.yml       | ⏳ 待实施 |
| 4    | 配置分支保护规则           | ⏳ 待实施 |
| 5    | 团队培训                   | ⏳ 待实施 |

---

## 1. 发布流程概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        标准发布流程                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 功能开发                                                         │
│     └── feature/* 分支                                              │
│     └── 本地 docker-compose 开发测试                                 │
│                        │                                            │
│                        ▼                                            │
│  2. 合并到 develop                                                   │
│     └── 创建 PR → develop                                           │
│     └── CI 检查通过                                                  │
│     └── 1 人 Code Review                                            │
│     └── 合并 PR                                                      │
│                        │                                            │
│                        ▼                                            │
│  3. 自动部署到 Staging                                               │
│     └── deploy-staging.yml 触发                                     │
│     └── 数据库迁移                                                   │
│     └── Railway Staging 部署                                        │
│     └── Smoke 测试                                                   │
│                        │                                            │
│                        ▼                                            │
│  4. QA 验证                                                          │
│     └── 在 staging.gens.team 测试                                │
│     └── 功能验收                                                     │
│     └── 回归测试                                                     │
│                        │                                            │
│                        ▼                                            │
│  5. 发布到生产                                                       │
│     └── 创建 PR: develop → main                                     │
│     └── 2 人 Code Review                                            │
│     └── deploy-protection 检查                                      │
│     └── 合并 PR                                                      │
│                        │                                            │
│                        ▼                                            │
│  6. 自动部署到 Production                                            │
│     └── deploy-production.yml 触发                                  │
│     └── Pre-deploy 检查                                             │
│     └── 数据库迁移                                                   │
│     └── Railway Production 部署                                     │
│     └── Smoke 测试                                                   │
│                        │                                            │
│                        ▼                                            │
│  7. 发布后任务                                                       │
│     └── 创建 Git Tag (v1.x.x)                                       │
│     └── 发送发布通知                                                 │
│     └── 监控错误率                                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 版本管理

### 2.1 版本号规范

采用 [Semantic Versioning](https://semver.org/) (SemVer):

```
MAJOR.MINOR.PATCH

示例：
v1.0.0 → v1.0.1  (Patch: Bug 修复，向后兼容)
v1.0.1 → v1.1.0  (Minor: 新功能，向后兼容)
v1.1.0 → v2.0.0  (Major: 破坏性变更，不向后兼容)
```

### 2.2 版本号位置

```
package.json (root)     → 项目整体版本
backend/package.json    → 后端版本
frontend/package.json   → 前端版本
```

### 2.3 Git Tag 创建

发布到生产后，创建版本 Tag：

```bash
# 创建带注释的 Tag
git tag -a v1.2.0 -m "Release v1.2.0: 新增多环境支持"

# 推送 Tag
git push origin v1.2.0
```

---

## 3. CI/CD 工作流配置

### 3.1 Staging 部署工作流

**文件**: `.github/workflows/deploy-staging.yml`

```yaml
name: Deploy to Staging

on:
  push:
    branches: [develop]
  workflow_dispatch:

jobs:
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    environment: staging

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run database migrations
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
        working-directory: ./backend
        run: npx prisma migrate deploy

      - name: Wait for Railway deployment
        run: |
          echo "Railway auto-deploys on push to develop"
          echo "Waiting for deployment to complete..."
          sleep 120

      - name: Run smoke tests
        run: |
          echo "Testing Staging API health..."
          curl -f https://staging-api.gens.team/api/v1/health || exit 1
          echo "Testing Staging Frontend..."
          curl -f https://staging.gens.team || exit 1
          echo "✅ Staging deployment verified!"

      - name: Notify on success
        if: success()
        run: |
          echo "## Staging Deployment Summary" >> $GITHUB_STEP_SUMMARY
          echo "- **Status**: ✅ Success" >> $GITHUB_STEP_SUMMARY
          echo "- **Commit**: ${{ github.sha }}" >> $GITHUB_STEP_SUMMARY
          echo "- **Branch**: develop" >> $GITHUB_STEP_SUMMARY
          echo "- **Time**: $(date -u)" >> $GITHUB_STEP_SUMMARY
          echo "- **URL**: https://staging.gens.team" >> $GITHUB_STEP_SUMMARY

      - name: Notify on failure
        if: failure()
        run: |
          echo "## ❌ Staging Deployment Failed" >> $GITHUB_STEP_SUMMARY
          echo "Please check the logs for details." >> $GITHUB_STEP_SUMMARY
```

### 3.2 Production 部署工作流

**文件**: `.github/workflows/deploy-production.yml`

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      skip_smoke_tests:
        description: "Skip smoke tests after deployment"
        required: false
        type: boolean
        default: false

jobs:
  pre-deploy-checks:
    name: Pre-deployment Checks
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Check for breaking changes
        run: |
          if git diff --name-only HEAD~1 HEAD | grep -q "prisma/schema"; then
            echo "::warning::⚠️ Database schema changed - migrations required"
          fi
          if git diff --name-only HEAD~1 HEAD | grep -q "backend/src/modules/.*/.*\.controller\.ts"; then
            echo "::warning::⚠️ API endpoints may have changed"
          fi

      - name: Verify staging is healthy
        run: |
          echo "Verifying Staging environment..."
          curl -f https://staging-api.gens.team/api/v1/health || {
            echo "::error::Staging is unhealthy! Aborting production deployment."
            exit 1
          }
          echo "✅ Staging is healthy"

  deploy-production:
    name: Deploy to Production
    needs: pre-deploy-checks
    runs-on: ubuntu-latest
    environment: production

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Log pre-deployment state
        run: |
          echo "📦 Starting production deployment..."
          echo "Commit: ${{ github.sha }}"
          echo "Triggered by: ${{ github.actor }}"

      - name: Run database migrations
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
        working-directory: ./backend
        run: npx prisma migrate deploy

      - name: Wait for Railway deployment
        run: |
          echo "Railway auto-deploys on push to main"
          echo "Waiting for deployment to complete..."
          sleep 180

      - name: Run production smoke tests
        if: ${{ github.event.inputs.skip_smoke_tests != 'true' }}
        run: |
          echo "Testing Production API health..."
          curl -f https://api.gens.team/api/v1/health || exit 1
          echo "Testing Production Frontend..."
          curl -f https://gens.team || exit 1
          echo "✅ Production deployment verified!"

      - name: Update deployment summary
        if: success()
        run: |
          echo "## 🚀 Production Deployment Summary" >> $GITHUB_STEP_SUMMARY
          echo "- **Status**: ✅ Success" >> $GITHUB_STEP_SUMMARY
          echo "- **Commit**: ${{ github.sha }}" >> $GITHUB_STEP_SUMMARY
          echo "- **Branch**: main" >> $GITHUB_STEP_SUMMARY
          echo "- **Time**: $(date -u)" >> $GITHUB_STEP_SUMMARY
          echo "- **URL**: https://gens.team" >> $GITHUB_STEP_SUMMARY

  post-deploy:
    name: Post-deployment Tasks
    needs: deploy-production
    runs-on: ubuntu-latest
    if: success()

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Send release notification (optional)
        run: |
          echo "Release notification can be triggered manually via release-notification.yml"
          # 或者自动触发: gh workflow run release-notification.yml
```

### 3.3 更新 Smoke Tests

**修改**: `.github/workflows/smoke-tests.yml`

添加多环境支持：

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: "Environment to test"
        required: true
        default: "production"
        type: choice
        options:
          - production
          - staging
          - development
  schedule:
    - cron: "0 * * * *" # Production - 每小时
    - cron: "30 * * * *" # Staging - 每小时 (偏移30分钟)

jobs:
  smoke-test:
    name: Smoke Tests - ${{ github.event.inputs.environment || 'production' }}
    runs-on: ubuntu-latest

    steps:
      - name: Set environment URLs
        id: set-url
        run: |
          ENV="${{ github.event.inputs.environment || 'production' }}"
          case $ENV in
            production)
              echo "API_URL=https://api.gens.team" >> $GITHUB_OUTPUT
              echo "WEB_URL=https://gens.team" >> $GITHUB_OUTPUT
              ;;
            staging)
              echo "API_URL=https://staging-api.gens.team" >> $GITHUB_OUTPUT
              echo "WEB_URL=https://staging.gens.team" >> $GITHUB_OUTPUT
              ;;
            development)
              echo "API_URL=https://dev-api.gens.team" >> $GITHUB_OUTPUT
              echo "WEB_URL=https://dev.gens.team" >> $GITHUB_OUTPUT
              ;;
          esac

      - name: Health check
        run: |
          curl -f ${{ steps.set-url.outputs.API_URL }}/api/v1/health
          curl -f ${{ steps.set-url.outputs.WEB_URL }}
```

---

## 4. 分支保护规则

### 4.1 main 分支

在 GitHub Repository Settings → Branches → Add rule:

```
Branch name pattern: main

✅ Require a pull request before merging
   - Required approving reviews: 2
   - Dismiss stale pull request approvals
   - Require review from Code Owners

✅ Require status checks to pass before merging
   - CI / quality-check
   - CI / backend-test
   - CI / frontend-test
   - CI / build
   - Deploy Protection Check / pre-deploy-checks

✅ Require conversation resolution before merging

✅ Do not allow bypassing the above settings
```

### 4.2 develop 分支

```
Branch name pattern: develop

✅ Require a pull request before merging
   - Required approving reviews: 1
   - Dismiss stale pull request approvals

✅ Require status checks to pass before merging
   - CI / quality-check
   - CI / backend-test
   - CI / frontend-test

✅ Require conversation resolution before merging
```

---

## 5. 发布检查清单

### 5.1 发布前 (Pre-release)

```markdown
## 发布检查清单 - v{VERSION}

### 代码准备

- [ ] 所有目标功能已合并到 develop
- [ ] develop 分支 CI 全部通过
- [ ] 无未解决的 Critical/High 优先级 Bug

### Staging 验证

- [ ] Staging 环境已部署最新 develop
- [ ] 核心功能回归测试通过
- [ ] AI 功能正常 (研究/写作/PPT)
- [ ] 用户认证流程正常
- [ ] 性能无明显下降

### 数据库

- [ ] 数据库迁移已在 Staging 验证
- [ ] 无破坏性数据变更（或已有数据备份计划）

### 文档

- [ ] CHANGELOG 已更新
- [ ] API 变更已文档化（如有）

### 通知

- [ ] 团队已知悉发布计划
- [ ] 发布窗口已确定（建议避开高峰期）
```

### 5.2 发布中 (During Release)

```markdown
### 发布执行

- [ ] 创建 PR: develop → main
- [ ] Code Review 完成 (2人)
- [ ] deploy-protection 检查通过
- [ ] 合并 PR
- [ ] 确认 Railway Production 部署开始
- [ ] 等待部署完成 (~3分钟)
- [ ] Smoke Tests 通过
```

### 5.3 发布后 (Post-release)

```markdown
### 发布验证

- [ ] 生产环境首页正常加载
- [ ] API 健康检查通过
- [ ] 关键用户流程抽检
- [ ] 错误监控无异常（Sentry）

### 收尾工作

- [ ] 创建 Git Tag: v{VERSION}
- [ ] 创建 GitHub Release（可选）
- [ ] 发送发布通知（可选）
- [ ] 更新项目看板状态
```

---

## 6. 紧急修复流程 (Hotfix)

当生产环境发现严重 Bug 需要紧急修复时：

```
┌─────────────────────────────────────────────────────────┐
│                    Hotfix 流程                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. 从 main 创建 hotfix 分支                            │
│     └── git checkout main                               │
│     └── git pull origin main                            │
│     └── git checkout -b hotfix/fix-critical-bug         │
│                        │                                │
│                        ▼                                │
│  2. 修复 Bug                                            │
│     └── 最小化变更                                       │
│     └── 本地测试                                         │
│                        │                                │
│                        ▼                                │
│  3. 创建 PR → main                                      │
│     └── 标记为 [HOTFIX]                                 │
│     └── 1 人加急 Review                                 │
│     └── 合并                                             │
│                        │                                │
│                        ▼                                │
│  4. 自动部署到 Production                               │
│     └── 验证修复                                         │
│                        │                                │
│                        ▼                                │
│  5. Cherry-pick 到 develop                              │
│     └── git checkout develop                            │
│     └── git cherry-pick <commit-hash>                   │
│     └── git push origin develop                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Hotfix 命名规范**:

- 分支: `hotfix/brief-description`
- PR 标题: `[HOTFIX] 修复问题描述`
- Commit: `fix(scope): 紧急修复xxx问题`

---

## 7. 回滚策略

### 7.1 应用回滚

**方式一: Railway Dashboard**

1. 进入 Production 环境
2. 选择对应服务
3. 点击 "Deployments"
4. 找到上一个成功的部署
5. 点击 "Redeploy"

**方式二: Git Revert**

```bash
# 回退最近一次提交
git revert HEAD
git push origin main
# Railway 会自动触发新部署
```

### 7.2 数据库回滚

**标记迁移为已回滚**:

```bash
npx prisma migrate resolve --rolled-back <migration-name>
```

**注意**: 数据库回滚可能导致数据丢失，应优先考虑前向修复。

### 7.3 紧急回滚决策

当出现以下情况时触发紧急回滚：

- ❌ 核心功能完全不可用
- ❌ 大规模用户无法登录
- ❌ 数据丢失或损坏
- ❌ 安全漏洞

回滚决策流程:

1. 确认问题严重性
2. 通知团队
3. 执行回滚
4. 验证恢复
5. 事后分析

---

## 8. 发布通知

### 8.1 自动发布通知

使用现有的 `release-notification.yml` 工作流：

```bash
# 预览发布说明
cd backend && npm run release:preview

# 发送发布通知
cd backend && npm run release:notify
```

### 8.2 发布通知内容

自动生成的发布通知包含：

- 版本号
- 一句话总结
- 主要更新亮点 (3-5 条)
- 详细变更列表

---

## 9. 相关文档

| 文档                                                                     | 描述                 |
| ------------------------------------------------------------------------ | -------------------- |
| [multi-environment-architecture.md](./multi-environment-architecture.md) | 多环境架构总览       |
| [environment-setup-guide.md](./environment-setup-guide.md)               | 环境配置指南         |
| [railway-env-config.md](./railway-env-config.md)                         | Railway 环境变量配置 |
| [../development/overview.md](../development/overview.md)                 | 开发指南             |

---

**最后更新**: 2026-01-19
**版本**: 1.0
