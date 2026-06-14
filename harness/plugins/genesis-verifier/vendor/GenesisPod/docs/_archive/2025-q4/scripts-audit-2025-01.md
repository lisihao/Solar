# Scripts 目录审计报告

**日期**: 2025-01-19
**审计范围**: `scripts/`, `.github/`, `.husky/`, `backend/scripts/`

---

## 问题总结

### 1. 规范缺失

**现有规范覆盖范围**：

- ✅ 源代码命名 (TypeScript, Python, React)
- ✅ 目录结构 (src/, components/, modules/)
- ✅ Git 提交信息
- ❌ **脚本文件命名和生命周期管理**
- ❌ **临时脚本归档策略**
- ❌ **脚本目录组织规范**

**根因**：`.claude/standards/` 只定义了源代码规范，没有定义脚本管理规范。

### 2. 命名问题

| 问题类型         | 文件示例                            | 问题描述      |
| ---------------- | ----------------------------------- | ------------- |
| 含"fix"临时脚本  | `fix-railway-database.sh`           | 应归档或删除  |
| 含"fix"临时脚本  | `fix-export-tables.js`              | 应归档或删除  |
| 含"fix"临时脚本  | `fix-invalid-models.ts`             | 应归档或删除  |
| 已完成迁移脚本   | `railway-migrate-ai-writing-v2.sql` | 应归档        |
| 诊断脚本位置不当 | `diagnose-encryption.js`            | 应移到 utils/ |
| 根目录散落       | `verify-before-push.sh`             | 应移到 utils/ |

### 3. 生命周期问题

很多脚本是"一次性"用途，完成后应该归档，但一直留在 scripts/ 目录：

- 数据库修复脚本
- 一次性迁移脚本
- 部署问题修复脚本

---

## 文件清单

### scripts/ 目录

| 文件                                    | 状态        | 建议                          |
| --------------------------------------- | ----------- | ----------------------------- |
| `deployment/fix-railway-deployment.bat` | ⚠️ 临时     | 归档到 `_archive/`            |
| `deployment/fix-railway-deployment.sh`  | ⚠️ 临时     | 归档到 `_archive/`            |
| `diagnose-encryption.js`                | ⚠️ 位置不当 | 移到 `utils/diagnostics/`     |
| `fix-railway-database.sh`               | ⚠️ 临时     | 归档到 `_archive/`            |
| `railway-migrate-ai-writing-v2.sql`     | ⚠️ 已完成   | 归档到 `_archive/migrations/` |
| `run-migration.js`                      | ⚠️ 已完成   | 归档到 `_archive/migrations/` |
| `verify-before-push.sh`                 | ⚠️ 位置不当 | 移到 `utils/`                 |
| `setup-git-hooks.sh`                    | ⚠️ 位置不当 | 移到 `utils/`                 |
| `verify-changed.js`                     | ⚠️ 位置不当 | 移到 `utils/`                 |
| `docs-specialist/*`                     | ✅ 有效     | 保留                          |
| `local-server/*`                        | ✅ 有效     | 保留                          |
| `merge-to-main/*`                       | ✅ 有效     | 保留                          |
| `monitoring/*`                          | ✅ 有效     | 保留                          |
| `release-notification/*`                | ✅ 有效     | 保留                          |
| `utils/*`                               | ✅ 有效     | 保留                          |
| `README.md`                             | ⚠️ 需更新   | 更新目录结构说明              |

### backend/scripts/ 目录

| 文件                           | 状态        | 建议                    |
| ------------------------------ | ----------- | ----------------------- |
| `fix-export-tables.js`         | ⚠️ 临时     | 归档或删除              |
| `fix-invalid-models.ts`        | ⚠️ 临时     | 归档或删除              |
| `create-export-tables.sql`     | ⚠️ 位置不当 | 移到 prisma/migrations/ |
| `seed-*.ts`                    | ✅ 有效     | 保留（种子数据脚本）    |
| `generate-*.ts`                | ✅ 有效     | 保留（生成脚本）        |
| `validate-*.ts`                | ✅ 有效     | 保留（验证脚本）        |
| `send-release-notification.ts` | ✅ 有效     | 保留                    |
| `docker-entrypoint.sh`         | ✅ 有效     | 保留                    |
| `studio-railway.*`             | ✅ 有效     | 保留                    |
| `browser-verification.ts`      | ⚠️ 测试相关 | 考虑移到 test/          |
| `standalone-browser-test.ts`   | ⚠️ 测试相关 | 考虑移到 test/          |
| `test-reader-mode-e2e.ts`      | ⚠️ 测试相关 | 考虑移到 test/          |

### .github/ 目录

| 文件                                 | 状态        | 建议             |
| ------------------------------------ | ----------- | ---------------- |
| `workflows/ci.yml`                   | ✅ 有效     | 已优化           |
| `workflows/deploy-protection.yml`    | ✅ 有效     | 已优化           |
| `workflows/smoke-tests.yml`          | ✅ 有效     | 保留             |
| `workflows/auto-fix.yml`             | ⚠️ 可能过期 | 检查是否仍在使用 |
| `workflows/release-notification.yml` | ✅ 有效     | 刚创建           |

### .husky/ 目录

| 文件         | 状态        | 建议   |
| ------------ | ----------- | ------ |
| `pre-commit` | ✅ 有效     | 保留   |
| `pre-push`   | ✅ 有效     | 已更新 |
| `commit-msg` | ✅ 有效     | 保留   |
| `_/*`        | ✅ 系统文件 | 保留   |

---

## 建议目录结构

```
scripts/
├── _archive/                    # 已完成/过期脚本归档
│   ├── migrations/              # 已完成的迁移脚本
│   │   ├── railway-migrate-ai-writing-v2.sql
│   │   └── run-migration.js
│   └── fixes/                   # 已完成的修复脚本
│       ├── fix-railway-database.sh
│       └── fix-railway-deployment.sh
│
├── deployment/                  # 部署相关（保留有效脚本）
│
├── docs-specialist/             # 文档管理（现有）
│
├── local-server/                # 本地开发（现有）
│
├── merge-to-main/               # 合并工作流（现有）
│
├── monitoring/                  # 监控配置（现有）
│
├── release-notification/        # 发布通知（现有）
│
├── utils/                       # 通用工具
│   ├── verify-before-push.sh
│   ├── setup-git-hooks.sh
│   ├── verify-changed.js
│   └── diagnostics/
│       └── diagnose-encryption.js
│
└── README.md                    # 目录说明（需更新）
```

---

## 规范补充建议

### 新增: 脚本管理规范

```markdown
## 脚本命名规范

### 命名格式

- 使用 kebab-case
- 动词开头描述功能
- 禁止以 "fix-" 开头的永久脚本

### 脚本分类

| 类型       | 前缀/命名                          | 生命周期                     |
| ---------- | ---------------------------------- | ---------------------------- |
| 种子数据   | `seed-{name}`                      | 永久                         |
| 生成脚本   | `generate-{name}`                  | 永久                         |
| 验证脚本   | `verify-{name}`, `validate-{name}` | 永久                         |
| 诊断脚本   | `diagnose-{name}`                  | 永久 (放 utils/diagnostics/) |
| 一次性修复 | `fix-{name}`                       | 使用后立即归档               |
| 一次性迁移 | `migrate-{name}`                   | 使用后立即归档               |

### 归档规则

1. 修复类脚本完成后移到 `_archive/fixes/`
2. 迁移类脚本完成后移到 `_archive/migrations/`
3. 归档文件名加日期前缀: `2025-01-fix-xxx.sh`
```

---

## 执行计划

### Phase 1: 立即清理 (今天)

```bash
# 1. 创建归档目录
mkdir -p scripts/_archive/{migrations,fixes}

# 2. 归档已完成脚本
mv scripts/railway-migrate-ai-writing-v2.sql scripts/_archive/migrations/2025-01-railway-migrate-ai-writing-v2.sql
mv scripts/run-migration.js scripts/_archive/migrations/2025-01-run-migration.js
mv scripts/fix-railway-database.sh scripts/_archive/fixes/2025-01-fix-railway-database.sh
mv scripts/deployment/fix-railway-deployment.* scripts/_archive/fixes/

# 3. 整理工具脚本
mkdir -p scripts/utils/diagnostics
mv scripts/diagnose-encryption.js scripts/utils/diagnostics/
mv scripts/verify-before-push.sh scripts/utils/
mv scripts/setup-git-hooks.sh scripts/utils/
```

### Phase 2: 更新规范 (本周)

1. 在 `.claude/standards/` 新增 `12-scripts-management.md`
2. 更新 `scripts/README.md` 反映新结构
3. 更新 CLAUDE.md 添加脚本规范链接

### Phase 3: 后端脚本清理 (下周)

1. 归档 `backend/scripts/fix-*.js`
2. 将测试脚本移到 `backend/test/`
3. 将 SQL 文件移到 `backend/prisma/`

---

## Release 流程检视

### 当前状态

已实现的组件：

- ✅ `backend/src/modules/ai-infra/release/` - Release 模块
- ✅ `backend/scripts/send-release-notification.ts` - CLI 脚本
- ✅ `scripts/release-notification/` - Shell 脚本和文档
- ✅ `.github/workflows/release-notification.yml` - CI 自动触发

### 问题

1. **未测试**: 模块代码未运行测试
2. **依赖 AI**: 如果 AI API 不可用会失败（已有降级逻辑）
3. **用户查询**: `getAllActiveUserIds()` 使用 30 天活跃判断，可能需要调整

### 建议

1. 添加 Release 模块单元测试
2. 在正式使用前先用 `--dry-run` 测试
3. 确认 GitHub Actions secrets 已配置

---

**审计完成**

下一步: 执行 Phase 1 清理
