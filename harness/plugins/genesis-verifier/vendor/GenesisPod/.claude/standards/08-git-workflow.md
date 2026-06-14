# Git 工作流规范

**版本：** 1.0
**强制级别：** 🔴 MUST
**更新日期：** 2025-11-08

---

## 核心原则

```
✅ 清晰的分支策略
✅ 原子化的提交
✅ 自解释的提交信息（Conventional Commits）
✅ Code Review 必须
✅ 线性的历史记录
```

---

## 分支策略

### 🔴 MUST - 严格遵守

1. **主分支**

   ```
   main          - 生产环境代码，每个提交都是一个发布版本
   develop       - 开发环境代码，所有功能都在这里集成

   ✅ main 和 develop 始终保持稳定
   ❌ 不允许直接推送到 main/develop
   ```

2. **功能分支命名**

   ```
   feature/001-add-rss-parser
   feature/002-implement-ai-scoring
   feature/003-add-wechat-publishing

   格式: feature/{ticket-number}-{description}

   ✅ 命名清晰，包含ticket号
   ❌ feature/new-stuff
   ❌ feature/wip
   ```

3. **Bug修复分支**

   ```
   bugfix/fix-timeout-error
   bugfix/001-fix-simhash-collision

   格式: bugfix/{description} 或 bugfix/{ticket-number}-{description}
   ```

4. **紧急修复分支**

   ```
   hotfix/fix-critical-security-issue
   hotfix/001-critical-database-bug

   格式: hotfix/{ticket-number}-{description}

   ✅ 从 main 创建，修复后合并回 main 和 develop
   ```

---

## Conventional Commits 提交规范

### 🔴 MUST - 严格遵守

**基本格式：**

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type（类型）

```
feat:      新功能
fix:       bug修复
refactor:  代码重构（不改变功能）
test:      添加或修改测试
docs:      文档更新
chore:     杂务（依赖更新、构建脚本等）
perf:      性能优化
ci:        CI/CD配置更改
style:     代码格式化（不改变功能）
revert:    撤销之前的提交
```

### Scope（作用域）

```
frontend   - 前端相关
backend    - 后端相关
ai-service - AI服务相关
crawler    - 爬虫相关
proxy      - 代理服务
resource   - 资源管理
feed       - Feed流
api        - API端点
database   - 数据库
auth       - 认证
config     - 配置
```

### Subject（主题）规则

- 使用祈使语：add, fix, refactor（不是 added, fixed, refactored）
- 首字母小写
- 不以句号结尾
- 不超过50个字符

### 完整示例

```
feat(proxy): add PDF proxy support for arXiv papers

Implement PDF proxy to bypass X-Frame-Options restrictions.
The backend now proxies PDF requests and removes restrictive headers.

Changes:
- Add ProxyController with /api/v1/proxy/pdf endpoint
- Set proper Content-Type and CORS headers
- Add domain whitelist for security

Closes #123
```

```
fix(frontend): resolve PDF iframe blocking in Microsoft Edge

Switch from iframe to object tag for PDF display to avoid browser
security restrictions that block iframe-embedded PDFs.

Fixes #456
```

```
refactor(ai-service): optimize Grok API retry logic

- Add exponential backoff retry (max 3 attempts)
- Improve error logging
- Performance improvement: ~30% faster on timeout scenarios

Related-To #789
```

---

## Pull Request 流程

### 🔴 MUST - 严格遵守

1. **创建 PR 前**

   ```bash
   # 1. 更新本地develop
   git checkout develop
   git pull origin develop

   # 2. 从develop创建feature分支
   git checkout -b feature/001-add-feature

   # 3. 实现功能，编写测试
   # ... 开发代码 ...

   # 4. 提交代码
   git commit -m "feat(module): add feature"

   # 5. 推送到远程
   git push origin feature/001-add-feature
   ```

2. **PR 标题清晰**

   ```
   ✅ [FEATURE] Add PDF proxy support for research papers
   ✅ [BUGFIX] Fix timeout error in AI processing
   ✅ [REFACTOR] Optimize database queries

   ❌ Update stuff
   ❌ Fix things
   ❌ WIP
   ```

3. **PR 描述模板**

   ```markdown
   ## Description

   清晰的功能/修复描述

   ## Related Issues

   Closes #123
   Related-To #456

   ## Changes

   - 改动1
   - 改动2
   - 改动3

   ## How to Test

   1. 步骤1
   2. 步骤2
   3. 验证结果

   ## Screenshots (if applicable)

   [截图]

   ## Checklist

   - [ ] 代码遵循编码规范
   - [ ] 所有新代码都有测试
   - [ ] 测试覆盖率 > 85%
   - [ ] 所有测试通过
   - [ ] 文档已更新
   - [ ] 提交信息遵循 Conventional Commits
   ```

4. **Code Review 要求**
   ```
   ✅ 至少1个reviewer审核
   ✅ 所有评论都已解决
   ✅ 所有自动检查通过
   ✅ 无冲突且可以合并
   ```

---

## 日常开发工作流

### 🔴 MUST - 严格遵守

```bash
# 1. 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/001-add-feature

# 2. 开发和提交
# ... 编写代码 ...
git add src/module.ts
git commit -m "feat(module): add feature"

# 3. 编写测试
# ... 编写测试 ...
git add tests/module.spec.ts
git commit -m "test(module): add tests"

# 4. 推送
git push origin feature/001-add-feature

# 5. 创建 PR（通过 GitHub UI）
```

### 提交前检查

```bash
# Frontend
cd frontend && npm run lint && npm run type-check && npm test

# Backend
cd backend && npm run lint && npm run test

# AI Service
cd ai-service && pylint services/ && pytest --cov=services
```

---

## 冲突处理

### 🔴 MUST - 严格遵守

```bash
# 1. 更新本地分支
git pull origin develop

# 2. 如果有冲突，编辑冲突文件
# 删除冲突标记 <<<<<<<, =======, >>>>>>>

# 3. 标记冲突为已解决
git add <conflicted-file>

# 4. 提交合并提交
git commit -m "merge: resolve conflicts with develop"

# 5. 推送
git push origin feature/001-add-feature
```

**不允许的操作：**

```
❌ git push --force (强制推送，会丢失历史)
❌ git rebase develop (变基，改写历史)
```

---

## Git 配置

### 🔴 MUST - 严格遵守

```bash
# 配置用户信息
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# 配置默认编辑器
git config --global core.editor "code --wait"  # VS Code

# 配置自动换行处理
git config --global core.safecrlf true
```

---

## 常用 Git 命令

```bash
# 查看分支
git branch                    # 本地分支
git branch -a                 # 所有分支

# 创建和切换分支
git checkout -b feature/001   # 创建并切换

# 查看日志
git log --oneline             # 单行显示
git log --graph --all         # 可视化分支

# 查看改动
git status                    # 工作树状态
git diff                      # 未暂存的改动
git diff --staged             # 已暂存的改动

# 提交
git add .                     # 暂存所有改动
git commit -m "message"       # 提交

# 推送和拉取
git push origin branch-name   # 推送分支
git pull origin develop       # 拉取并合并

# 撤销操作
git reset HEAD~1              # 撤销最后一次提交
git checkout -- file.ts       # 丢弃文件改动
```

---

**记住：** Git历史是项目的叙事。好的提交信息和清晰的分支策略让整个项目易于理解和维护！
