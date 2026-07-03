# 文档命名规范修复指南

**创建日期**: 2025-11-22
**适用人员**: 项目维护者、开发者
**前置阅读**: [文档命名审查报告](FILE_NAMING_AUDIT_REPORT.md)

---

## 🎯 目标

将项目中 **39 个不符合命名规范的文档文件** 重命名为小写形式，符合 project-rules.md v2.1 标准。

---

## 📋 快速开始

### 方式一：自动化脚本（推荐）

**适用于**: Linux / macOS / Windows Git Bash

```bash
# 1. 模拟运行（安全，不会修改文件）
./scripts/rename-docs-lowercase.sh --dry-run

# 2. 检查模拟结果，确认无误后执行
./scripts/rename-docs-lowercase.sh

# 3. 更新文档中的链接引用
./scripts/update-doc-links.sh

# 4. 检查修改
git status
git diff

# 5. 提交更改
git add -A
git commit -m "refactor(docs): rename files to lowercase per v2.1 standard"
```

**Windows 用户**:

```cmd
REM 1. 模拟运行
scripts\rename-docs-lowercase.bat --dry-run

REM 2. 真实执行
scripts\rename-docs-lowercase.bat

REM 3. 手动更新链接（或使用 Git Bash 运行 update-doc-links.sh）
REM 4. 提交更改
git add -A
git commit -m "refactor(docs): rename files to lowercase per v2.1 standard"
```

---

### 方式二：命名检查工具

**检查当前命名情况**:

```bash
# 运行检查工具
node scripts/check-file-naming.js

# 输出示例：
# ❌ 发现 39 个命名违规：
# 📄 FILE: docs/data-management/readme.md
#    Reason: Contains uppercase letters
#    Suggest: docs/data-management/readme.md
# ...
```

**生成自动修复脚本**:

```bash
# 生成修复脚本（不立即执行）
node scripts/check-file-naming.js --generate-script

# 输出: scripts/auto-rename.sh

# 检查脚本内容
cat scripts/auto-rename.sh

# 确认无误后执行
./scripts/auto-rename.sh
```

---

### 方式三：手动逐个重命名

**适用于**: 谨慎修复，逐步验证

参考 [文档命名审查报告](FILE_NAMING_AUDIT_REPORT.md) 中的违规清单，手动重命名。

**示例**:

```bash
# 1. 重命名文件（使用 git mv 保留历史）
git mv docs/data-management/readme.md docs/data-management/readme.md

# 2. 查找并替换所有引用
grep -r "data-management/readme.md" docs/
# 手动编辑引用该文件的文档

# 3. 验证修改
git diff

# 4. 提交单个修改
git add -A
git commit -m "refactor(docs): rename data-management/readme.md to lowercase"
```

---

## 📊 修复范围

### 按目录统计（共39个文件）

| 目录                    | 违规文件数 | 优先级 |
| ----------------------- | ---------- | ------ |
| **data-management/**    | 13         | 🔴 高  |
| **docs/ 根目录**        | 11         | 🔴 高  |
| **features/ai-office/** | 7          | 🟡 中  |
| **api/**                | 1          | 🟡 中  |
| **prd/**                | 1          | 🟢 低  |

### 典型违规模式

```
❌ 全大写 + 下划线
docs/blog-collection-system.md
docs/features/ai-office/readme-optimization.md

❌ 全大写 + 连字符
docs/data-management/data-model.md
docs/api/data-collection-api.md

❌ 大写开头
docs/data-management/readme.md

❌ 中文文件名
docs/prd/prd-数据采集.md
```

---

## ⚠️ 注意事项

### 1. 文件重命名影响

**影响范围**:

- ✅ 不影响文件内容
- ✅ 不影响 Git 历史（使用 `git mv`）
- ⚠️ 可能破坏现有文档链接（需要更新）
- ⚠️ 可能影响其他团队成员的本地分支

**建议**:

1. 在独立分支进行修复
2. 通知团队成员即将进行的重命名
3. 合并到主分支前充分测试

### 2. 链接更新

**需要更新的链接类型**:

```markdown
# Markdown 链接

[文档](data-management/readme.md) → [文档](data-management/readme.md)

# 相对路径

../docs/API.md → ../docs/api.md

# HTML 链接（如果有）

<a href="docs/readme.md">文档</a> → <a href="docs/readme.md">文档</a>
```

**自动化工具**: `scripts/update-doc-links.sh`

**手动检查**:

```bash
# 搜索可能遗漏的引用
grep -r "README\.md" docs/
grep -r "DATA-MODEL\.md" docs/
grep -r "ARCHITECTURE\.md" docs/
```

### 3. Git 操作最佳实践

```bash
# ✅ 使用 git mv（保留历史）
git mv old-name.md new-name.md

# ❌ 不要用普通 mv（丢失历史）
mv old-name.md new-name.md
```

---

## 🧪 测试验证

### 修复后检查清单

- [ ] **文件重命名正确**

  ```bash
  # 检查是否还有大写文件名
  find docs -name "*.md" | grep -E "[A-Z]"
  # 应该没有输出（除了特定例外）
  ```

- [ ] **链接引用正确**

  ```bash
  # 运行检查工具
  node scripts/check-file-naming.js
  # 应该显示: ✅ 所有文件命名都符合规范！
  ```

- [ ] **Git 状态正常**

  ```bash
  git status
  # 应该只显示重命名操作，没有删除/新增
  ```

- [ ] **文档可访问**
  - 随机抽查几个重命名的文件
  - 点击文档中的链接，确保可以正常跳转
  - 检查 docs/readme.md 的导航链接

- [ ] **编译/构建正常**（如果项目有文档构建流程）
  ```bash
  npm run docs:build  # 如适用
  ```

---

## 🔄 回滚方案

如果修复后发现问题，可以回滚：

### 方案1：Git revert

```bash
# 查看提交历史
git log --oneline -5

# 回滚最近的重命名提交
git revert <commit-hash>

# 或者硬重置（谨慎！）
git reset --hard HEAD~1
```

### 方案2：从备份恢复

```bash
# 假设你在修复前创建了分支
git checkout backup-branch -- docs/

# 或从远程恢复
git fetch origin
git checkout origin/main -- docs/
```

---

## 📝 提交规范

### Commit Message 格式

```bash
# 推荐格式（Conventional Commits）
refactor(docs): rename files to lowercase per v2.1 standard

# 详细说明（可选）
- Renamed 39 files in docs/ to comply with naming standard
- Updated all internal documentation links
- Fixed directories: data-management, ai-office, api, prd
- Resolves naming violations identified in audit report

# 参考
See: docs/FILE_NAMING_AUDIT_REPORT.md
```

### Pull Request 模板

````markdown
## 📋 变更内容

将文档文件重命名为小写，符合项目规范 v2.1

## 🎯 变更原因

- 当前 48.7% 的文档文件命名不符合规范
- 大小写混用导致跨平台兼容性问题
- 影响文档查找和可维护性

## 📊 变更范围

- **重命名文件**: 39 个
- **更新链接**: ~50 处
- **影响目录**: data-management, ai-office, api, prd, docs根目录

## ✅ 检查清单

- [x] 已运行 `rename-docs-lowercase.sh`
- [x] 已运行 `update-doc-links.sh`
- [x] 通过 `check-file-naming.js` 检查
- [x] 验证关键文档链接可访问
- [x] Git 历史保留完整

## 📖 相关文档

- [文档命名审查报告](docs/FILE_NAMING_AUDIT_REPORT.md)
- [修复指南](docs/FILE_NAMING_FIX_GUIDE.md)
- [项目规则 v2.1](project-rules.md#1-文件与目录命名规范-)

## 🧪 测试

```bash
# 命名检查
node scripts/check-file-naming.js
# 输出: ✅ 所有文件命名都符合规范！

# 查找遗漏的大写引用
grep -r "[A-Z].*\.md" docs/ | grep -v "node_modules"
# 应该只有合法的例外
```
````

```

---

## 🔗 相关资源

### 规范文档
- [项目规则 v2.1](../project-rules.md#1-文件与目录命名规范-)
- [命名规范标准](../.claude/standards/03-naming-conventions.md)
- [文档编写规范](../.claude/standards/09-documentation.md)

### 审查报告
- [文档命名审查报告](FILE_NAMING_AUDIT_REPORT.md)

### 工具脚本
- [重命名脚本 (Bash)](../scripts/rename-docs-lowercase.sh)
- [重命名脚本 (Windows)](../scripts/rename-docs-lowercase.bat)
- [链接更新脚本](../scripts/update-doc-links.sh)
- [命名检查工具](../scripts/check-file-naming.js)

---

## 💡 常见问题

### Q: 为什么必须使用小写？

**A**: 三个主要原因：

1. **跨平台兼容性**
   - Windows 大小写不敏感：`readme.md` 和 `readme.md` 被视为同一文件
   - Linux/Mac 大小写敏感：可能导致链接失效
   - 统一小写避免混淆

2. **URL 友好**
   - 小写 URL 更易读：`docs/architecture/overview.md` vs `docs/Architecture/Overview.md`
   - 符合 Web 标准

3. **可维护性**
   - 减少命名歧义
   - 简化搜索和自动化处理
   - 符合业界最佳实践

### Q: readme.md 可以保留大写吗？

**A**: 项目根目录的 `readme.md` 可以保留大写（GitHub 约定），但 **docs/ 目录下建议全部使用 `readme.md`** 以保持一致性。

### Q: React 组件文件呢？

**A**: React 组件文件（.tsx/.jsx）允许使用 PascalCase，这是例外情况：

```

✅ components/UserProfile.tsx # 允许
✅ components/ResourceCard.tsx # 允许
❌ docs/UserGuide.md # 不允许，应该用 user-guide.md

````

### Q: 脚本执行失败怎么办？

**A**: 常见问题排查：

```bash
# 1. 确保脚本有执行权限
chmod +x scripts/rename-docs-lowercase.sh
chmod +x scripts/update-doc-links.sh

# 2. 确保在项目根目录执行
pwd  # 应该显示 .../deepdive

# 3. 检查 Git 状态
git status  # 确保没有未提交的更改

# 4. 手动执行单个重命名测试
git mv docs/test/OLD.md docs/test/new.md
git status
````

### Q: 批量重命名会丢失 Git 历史吗？

**A**: 不会，脚本使用 `git mv` 命令，Git 会自动追踪重命名：

```bash
# 查看重命名历史
git log --follow docs/data-management/readme.md

# 即使文件名改变，历史依然完整
```

---

## 📅 执行计划建议

### 渐进式修复（推荐）

**Week 1: 高优先级**

- [ ] 修复 docs/ 根目录（11个文件）
- [ ] 修复 api/ 目录（1个文件）
- [ ] 更新对应链接
- [ ] 测试验证

**Week 2: 中优先级**

- [ ] 修复 data-management/（13个文件）
- [ ] 修复 features/ai-office/（7个文件）
- [ ] 更新对应链接
- [ ] 测试验证

**Week 3: 低优先级**

- [ ] 修复 prd/（1个中文文件名）
- [ ] 全面检查遗漏
- [ ] 最终验证

### 一次性修复

**Day 1-2: 执行修复**

- [ ] 运行自动化脚本
- [ ] 检查修复结果

**Day 3: 测试验证**

- [ ] 运行检查工具
- [ ] 手动验证关键文档
- [ ] 团队内部审查

**Day 4-5: 部署合并**

- [ ] 创建 PR
- [ ] Code Review
- [ ] 合并到主分支

---

## 📞 支持

如遇到问题，请：

1. 查阅本指南的"常见问题"部分
2. 运行 `node scripts/check-file-naming.js` 诊断
3. 查看详细的[审查报告](FILE_NAMING_AUDIT_REPORT.md)
4. 联系项目维护者

---

**文档版本**: v1.0
**维护者**: 文档专家 Agent
**最后更新**: 2025-11-22
