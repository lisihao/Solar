# CI/CD 维护指南

## 概述

本指南描述如何维护 GenesisPod 的 CI/CD 流程，确保代码质量的同时优化资源使用。

## 本地验证（推荐）

### 验证命令

```bash
# 快速验证（推送前必做）
npm run verify:quick        # 类型检查 + 快速测试

# 完整验证（重要变更时）
npm run verify:full         # Lint + 类型 + 测试 + 构建

# 模拟 CI 环境
npm run verify:ci-local     # 与 CI 完全相同的检查

# 仅验证变更的文件
npm run verify:changed
```

### Git Hooks（自动执行）

项目已配置 Husky hooks，会在关键操作前自动运行验证：

| Hook         | 触发时机   | 检查内容                   |
| ------------ | ---------- | -------------------------- |
| `pre-commit` | git commit | lint-staged 检查暂存文件   |
| `pre-push`   | git push   | 类型检查 + 构建 + 快速测试 |

**跳过检查**（紧急情况）：

```bash
git push --no-verify  # 不推荐，仅紧急时使用
```

## CI Workflows

### 1. CI (`ci.yml`)

**触发条件**：push/PR 到 main/develop（排除文档变更）

**检查内容**：

- Code Quality Check: 格式、Lint、类型检查
- Backend Tests: 单元测试 + 覆盖率
- Frontend Tests: 单元测试 + 覆盖率
- Build Check: 前后端构建

**优化配置**：

- `paths-ignore`: 文档变更不触发
- `concurrency`: 同分支取消旧任务
- 依赖缓存: npm cache

### 2. Deploy Protection (`deploy-protection.yml`)

**触发条件**：push 到 main

**检查内容**：

- Secrets 检查：防止敏感信息提交
- 环境变量验证
- Breaking changes 检测
- 构建验证

### 3. Smoke Tests (`smoke-tests.yml`)

**触发条件**：手动 / 每小时定时

**检查内容**：

- API 健康检查
- 前端可访问性
- 数据库连接
- 性能检查

### 4. Release Notification (`release-notification.yml`)

**触发条件**：GitHub Release 发布 / 手动

**功能**：

- 收集 Git 变更
- AI 生成发布说明
- 批量推送用户通知

## 常见问题

### CI 失败排查

```bash
# 1. 本地复现
npm run verify:ci-local

# 2. 单独检查各项
npm run type-check          # 类型错误
npm run lint                # Lint 错误
npm run build               # 构建错误
npm run test:quick          # 测试失败
```

### GitHub Actions 额度不足

**症状**：`spending limit needs to be increased`

**解决方案**：

1. 检查 GitHub Settings > Billing > Actions
2. 增加 spending limit
3. 或等待月初额度重置

**预防措施**：

- 本地验证后再推送
- 避免频繁小提交
- 合并多个 fix 到一个 commit

### 优化 CI 用量

1. **合并 commits**：多个小修复合并推送
2. **本地验证**：`npm run verify:quick` 通过后再推
3. **文档跳过**：文档变更不触发 CI
4. **缓存利用**：依赖缓存减少安装时间

## 监控和告警

### 每日检查

- [ ] 查看 [Actions](https://github.com/genesis-agents/GenesisPod/actions) 页面
- [ ] 检查失败的 workflow
- [ ] 检查 Smoke Tests 结果

### 每周检查

- [ ] 检查 GitHub Actions 用量
- [ ] 清理旧的 workflow runs
- [ ] 检查依赖更新

### 告警配置

1. **GitHub 通知**：Settings > Notifications > Actions
2. **邮件告警**：失败时自动发送
3. **Slack 集成**（可选）：添加 Slack webhook

## 最佳实践

### 推送前检查清单

```bash
# 1. 确保在正确的分支
git branch

# 2. 运行验证
npm run verify:quick

# 3. 检查变更
git status
git diff --stat

# 4. 提交并推送
git add .
git commit -m "feat(module): description"
git push
```

### Commit 规范

遵循 Conventional Commits：

```
feat(module): 新功能
fix(module): Bug 修复
refactor(module): 重构
docs(module): 文档更新
style(module): 格式调整
test(module): 测试更新
chore(module): 杂项更新
```

## 紧急情况处理

### CI 全部失败

1. 检查是否是账户/额度问题
2. 本地运行 `npm run verify:ci-local`
3. 修复问题后重新推送

### 需要紧急部署

```bash
# 本地完整验证
npm run verify:full

# 确认无误后强制推送（谨慎使用）
git push --no-verify
```

---

**最后更新**：2024-01
**维护者**：Genesis Team
