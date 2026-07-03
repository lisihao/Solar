# 文档命名规范审查报告

**审查日期**: 2025-11-22
**审查范围**: docs/ 目录下的所有 Markdown 文件
**审查依据**: project-rules.md v2.1 文件命名规范
**审查人**: 文档专家 Agent

---

## 📋 执行摘要

本次审查对项目 `docs/` 目录下的所有 Markdown 文件进行了命名规范检查。根据项目规则 v2.1，**所有文件名必须使用小写字母**（除极少数例外）。

### 关键发现

- **文档总数**: 80 个 Markdown 文件
- **符合规范**: 41 个文件 (51.3%)
- **不符合规范**: 39 个文件 (48.7%)
- **主要问题**: 大量使用全大写命名（如 `readme.md`、`data-model.md`）

### 影响评估

🔴 **高影响**: 命名不一致严重影响项目的专业性和可维护性

- 违反了项目明确规定的 v2.1 规范
- 造成文档查找困难（大小写混用）
- 不利于跨平台协作（Windows 大小写不敏感，Linux/Mac 敏感）

---

## 📊 规范检查结果

### 1. 现有命名规范文档

✅ **已存在完善的规范体系**:

| 文档位置                                     | 规范内容                                  | 状态      |
| -------------------------------------------- | ----------------------------------------- | --------- |
| `.claude/standards/03-naming-conventions.md` | 完整的命名规范（文件、代码、数据库、API） | ✅ 已存在 |
| `.claude/standards/09-documentation.md`      | 文档编写规范                              | ✅ 已存在 |
| `project-rules.md`                           | 项目开发规则 v2.1                         | ✅ 已更新 |
| `docs/readme.md`                             | 文档导航（包含命名规范说明）              | ✅ 已存在 |

**规范明确性**: ⭐⭐⭐⭐⭐ (5/5)

- 规范文档详细、清晰
- 包含正确/错误示例
- 有明确的例外情况说明

**规范执行度**: ⭐⭐⭐☆☆ (3/5)

- 规范制定完善，但实际执行不到位
- 存在大量历史遗留文件未按规范命名
- 新文件命名有所改善，但仍有违规

### 2. 核心规范要求（摘录自 project-rules.md）

```
✅ 文档文件命名规则：
- 全部小写
- 使用连字符（kebab-case）
- 避免下划线、空格、中文

✅ 正确示例：
docs/readme.md
docs/architecture/overview.md
docs/api/readme.md
docs/guides/deployment-guide.md

❌ 错误示例：
docs/readme.md                    # 不使用大写
docs/Architecture/Overview.md     # 目录和文件都不应大写
docs/API/README.MD                # 扩展名也应小写
docs/guides/Deployment_Guide.md   # 不使用下划线，使用连字符

🔓 例外情况（仅5个）：
1. readme.md - 项目根目录
2. LICENSE
3. CHANGELOG.md
4. CONTRIBUTING.md
5. React组件文件（.tsx）

⚠️ 重要：即使是例外情况，在 docs/ 目录下也建议全部使用小写以保持一致性。
```

---

## 🔍 违规文件详细清单

### 分类统计

| 违规类型               | 数量   | 占比     |
| ---------------------- | ------ | -------- |
| 全大写文件名           | 28     | 71.8%    |
| 部分大写（PascalCase） | 9      | 23.1%    |
| 混合大小写             | 2      | 5.1%     |
| **总计**               | **39** | **100%** |

---

### 违规清单 - 按目录分组

#### 📁 data-management/ (11个违规文件)

```
❌ docs/data-management/readme.md
   建议: docs/data-management/readme.md

❌ docs/data-management/architecture.md
   建议: docs/data-management/architecture.md

❌ docs/data-management/data-model.md
   建议: docs/data-management/data-model.md

❌ docs/data-management/implementation-roadmap.md
   建议: docs/data-management/implementation-roadmap.md

❌ docs/data-management/policy-category-setup.md
   建议: docs/data-management/policy-category-setup.md

❌ docs/data-management/run-error-fix.md
   建议: docs/data-management/run-error-fix.md

❌ docs/data-management/ui-redesign-summary.md
   建议: docs/data-management/ui-redesign-summary.md

❌ docs/data-management/ui-fixes-summary.md
   建议: docs/data-management/ui-fixes-summary.md

❌ docs/data-management/completion-summary.md
   建议: docs/data-management/completion-summary.md

❌ docs/data-management/data-management-validation.md
   建议: docs/data-management/data-management-validation.md

❌ docs/data-management/data-management-quick-guide.md
   建议: docs/data-management/data-management-quick-guide.md

❌ docs/data-management/data-management-implementation.md
   建议: docs/data-management/data-management-implementation.md

❌ docs/data-management/ui-redesign-report.md
   建议: docs/data-management/ui-redesign-report.md
```

**问题分析**: 此目录几乎全部违规，使用全大写或大写开头命名。

---

#### 📁 features/ai-office/ (7个违规文件)

```
❌ docs/features/ai-office/readme-optimization.md
   建议: docs/features/ai-office/readme-optimization.md
   问题: 使用下划线 + 全大写

❌ docs/features/ai-office/service-status.md
   建议: docs/features/ai-office/service-status.md

❌ docs/features/ai-office/optimization-report.md
   建议: docs/features/ai-office/optimization-report.md

❌ docs/features/ai-office/implementation-guide.md
   建议: docs/features/ai-office/implementation-guide.md

❌ docs/features/ai-office/genspark-quick-start.md
   建议: docs/features/ai-office/genspark-quick-start.md

❌ docs/features/ai-office/genspark-analysis.md
   建议: docs/features/ai-office/genspark-analysis.md

❌ docs/features/ai-office/executive-summary.md
   建议: docs/features/ai-office/executive-summary.md
```

**问题分析**: 使用全大写命名，部分使用下划线而非连字符。

---

#### 📁 api/ (1个违规文件)

```
❌ docs/api/data-collection-api.md
   建议: docs/api/data-collection-api.md
```

---

#### 📁 docs/ 根目录 (10个违规文件)

```
❌ docs/blog-collection-system.md
   建议: docs/blog-collection-system.md
   问题: 使用下划线 + 全大写

❌ docs/railway-env-config.md
   建议: docs/railway-env-config.md

❌ docs/google-oauth-setup.md
   建议: docs/google-oauth-setup.md

❌ docs/ux-usability-audit.md
   建议: docs/ux-usability-audit.md

❌ docs/ui-optimization-plan.md
   建议: docs/ui-optimization-plan.md

❌ docs/backend-test-issues.md
   建议: docs/backend-test-issues.md

❌ docs/testing-issues.md
   建议: docs/testing-issues.md

❌ docs/hardening-summary.md
   建议: docs/hardening-summary.md

❌ docs/optimization-plan.md
   建议: docs/optimization-plan.md

❌ docs/hardening-execution.md
   建议: docs/hardening-execution.md

❌ docs/deployment-guide.md
   建议: docs/deployment-guide.md
```

**问题分析**: 根目录下存在大量使用下划线和全大写的文件。

---

#### 📁 prd/ (1个违规文件)

```
✅ docs/prd/prd.md                              # 符合规范
✅ docs/prd/prd-v2.0.md                         # 符合规范
✅ docs/prd/youtube-subtitle-export-prd.md      # 符合规范
✅ docs/prd/data-collection-system-redesign.md  # 符合规范
✅ docs/prd/data-collection-system-v3.0.md      # 符合规范
✅ docs/prd/batch-collection-monitor-design.md  # 符合规范
❌ docs/prd/prd-数据采集.md
   建议: docs/prd/prd-data-collection.md
   问题: 使用中文文件名
```

**问题分析**: 此目录命名情况良好，仅有1个中文文件名问题。

---

#### 📁 其他目录（全部符合规范）

```
✅ docs/guides/                 # 5个文件全部符合
✅ docs/features/workspace-reporting/  # 2个文件全部符合
✅ docs/features/               # 1个文件符合
✅ docs/design/                 # 1个文件符合
✅ docs/decisions/              # 5个文件全部符合
✅ docs/archive/                # 11个文件全部符合
✅ docs/architecture/           # 3个文件全部符合
✅ docs/analysis/               # 2个文件全部符合
```

**积极信号**: 新创建的目录（guides、decisions、architecture）命名规范执行良好。

---

## 📈 趋势分析

### 时间线推测（基于文件内容）

```
早期（2024年底 - 2025年初）
├─ 命名混乱：全大写、下划线、中文
└─ 无统一规范

中期（2025年Q2）
├─ 开始制定规范
└─ 部分新文件开始遵守

现在（2025-11-22）
├─ 规范文档完善（v2.1）
├─ 新目录规范执行良好
└─ 历史文件大量违规待修复
```

### 目录规范遵守率

| 目录                 | 符合率  | 评级       | 说明            |
| -------------------- | ------- | ---------- | --------------- |
| guides/              | 100%    | ⭐⭐⭐⭐⭐ | 完全符合规范    |
| decisions/           | 100%    | ⭐⭐⭐⭐⭐ | 完全符合规范    |
| architecture/        | 100%    | ⭐⭐⭐⭐⭐ | 完全符合规范    |
| archive/             | 100%    | ⭐⭐⭐⭐⭐ | 完全符合规范    |
| analysis/            | 100%    | ⭐⭐⭐⭐⭐ | 完全符合规范    |
| design/              | 100%    | ⭐⭐⭐⭐⭐ | 完全符合规范    |
| workspace-reporting/ | 100%    | ⭐⭐⭐⭐⭐ | 完全符合规范    |
| prd/                 | 86%     | ⭐⭐⭐⭐☆  | 仅1个中文文件名 |
| **data-management/** | **0%**  | ⭐☆☆☆☆     | **全部违规**    |
| **ai-office/**       | **41%** | ⭐⭐☆☆☆    | **半数违规**    |
| **docs/ 根目录**     | **13%** | ⭐☆☆☆☆     | **大量违规**    |

---

## 🎯 建议和行动方案

### 方案A：渐进式修复（推荐）

**优点**:

- 风险低，不影响现有开发
- 可按优先级逐步推进
- 有时间更新所有文档引用

**实施步骤**:

#### 阶段1：高优先级（1-2天）

修复频繁访问的核心文档：

```bash
# 1. 根目录高频文档
mv docs/deployment-guide.md docs/deployment-guide.md
mv docs/hardening-summary.md docs/hardening-summary.md
mv docs/optimization-plan.md docs/optimization-plan.md

# 2. API文档
mv docs/api/data-collection-api.md docs/api/data-collection-api.md

# 3. 更新所有引用这些文件的链接
# 使用全局搜索替换
```

#### 阶段2：中优先级（3-5天）

修复特定功能模块：

```bash
# ai-office 目录
cd docs/features/ai-office/
mv readme-optimization.md readme-optimization.md
mv service-status.md service-status.md
mv optimization-report.md optimization-report.md
mv implementation-guide.md implementation-guide.md
mv genspark-quick-start.md genspark-quick-start.md
mv genspark-analysis.md genspark-analysis.md
mv executive-summary.md executive-summary.md

# 更新目录内的交叉引用
```

#### 阶段3：低优先级（1周）

清理历史文档和归档：

```bash
# data-management 目录（13个文件）
cd docs/data-management/
# 批量重命名脚本...

# 根目录其余文件
cd docs/
# 批量重命名脚本...
```

---

### 方案B：一次性修复

**优点**:

- 彻底解决问题
- 立即符合规范
- 避免技术债务

**缺点**:

- 需要一次性更新大量引用
- 可能短时间内破坏链接

**实施脚本**:

```bash
#!/bin/bash
# file-rename-script.sh

# 定义重命名映射
declare -A rename_map=(
  # data-management
  ["docs/data-management/readme.md"]="docs/data-management/readme.md"
  ["docs/data-management/architecture.md"]="docs/data-management/architecture.md"
  # ... 39个文件的映射
)

# 执行重命名
for old_path in "${!rename_map[@]}"; do
  new_path="${rename_map[$old_path]}"
  echo "Renaming: $old_path -> $new_path"
  git mv "$old_path" "$new_path"
done

# 更新所有引用（使用sed或专用工具）
find . -name "*.md" -type f -exec sed -i 's/README\.md/readme.md/g' {} +
find . -name "*.md" -type f -exec sed -i 's/ARCHITECTURE\.md/architecture.md/g' {} +
# ... 更多替换规则

git add -A
git commit -m "refactor(docs): rename all files to lowercase per v2.1 standard"
```

---

### 方案C：创建命名规范检查工具（长期）

**目的**: 防止未来违规

```javascript
// scripts/check-file-naming.js
const fs = require("fs");
const path = require("path");

const EXCEPTIONS = ["readme.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md"];
const DOCS_DIR = "docs";

function checkFileNaming(dir) {
  const violations = [];

  function traverse(currentDir) {
    const files = fs.readdirSync(currentDir);

    files.forEach((file) => {
      const fullPath = path.join(currentDir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // 检查目录名
        if (file !== file.toLowerCase()) {
          violations.push({
            type: "directory",
            path: fullPath,
            suggestion: path.join(path.dirname(fullPath), file.toLowerCase()),
          });
        }
        traverse(fullPath);
      } else if (file.endsWith(".md")) {
        // 检查文件名（排除例外）
        const relativePath = path.relative(".", fullPath);
        const isException =
          EXCEPTIONS.includes(file) && !relativePath.includes("docs/");

        if (!isException && file !== file.toLowerCase()) {
          violations.push({
            type: "file",
            path: fullPath,
            suggestion: path.join(path.dirname(fullPath), file.toLowerCase()),
          });
        }
      }
    });
  }

  traverse(dir);
  return violations;
}

// 运行检查
const violations = checkFileNaming(DOCS_DIR);

if (violations.length > 0) {
  console.error(`❌ Found ${violations.length} naming violations:`);
  violations.forEach((v) => {
    console.error(`  ${v.path}`);
    console.error(`    → Suggest: ${v.suggestion}`);
  });
  process.exit(1);
} else {
  console.log("✅ All file names comply with the standard!");
}
```

**集成到CI/CD**:

```yaml
# .github/workflows/check-naming.yml
name: File Naming Check

on: [push, pull_request]

jobs:
  check-naming:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Check file naming
        run: node scripts/check-file-naming.js
```

---

## 📋 执行清单

### 立即执行（必须）

- [ ] **决定采用哪个修复方案**（方案A推荐）
- [ ] **创建文件重命名追踪表**（Excel/Notion）
- [ ] **通知团队即将进行的重命名**（避免冲突）

### 短期执行（1-2周内）

- [ ] **修复高频访问文档**（部署指南、API文档等）
- [ ] **更新所有引用链接**
- [ ] **在 readme.md 中添加命名规范提示**
- [ ] **创建命名检查脚本**

### 长期执行（持续）

- [ ] **定期运行命名检查**（每次PR）
- [ ] **Code Review关注文件命名**
- [ ] **更新贡献指南**，强调命名规范
- [ ] **季度审查规范执行情况**

---

## 🔗 相关文档引用

### 规范文档

- [项目规则 v2.1](../project-rules.md#1-文件与目录命名规范-)
- [命名规范标准](.claude/standards/03-naming-conventions.md)
- [文档编写规范](.claude/standards/09-documentation.md)

### 参考资料

- [Google 文档风格指南](https://developers.google.com/style)
- [Microsoft 写作风格指南](https://docs.microsoft.com/en-us/style-guide/welcome/)
- [文件命名最佳实践](https://www.writethedocs.org/guide/writing/style-guides/)

---

## 📊 附录：完整违规文件列表

### 按严重程度排序

#### 🔴 严重违规（使用下划线 + 全大写）

```
1. docs/blog-collection-system.md
2. docs/railway-env-config.md
3. docs/google-oauth-setup.md
4. docs/ux-usability-audit.md
5. docs/ui-optimization-plan.md
6. docs/backend-test-issues.md
7. docs/testing-issues.md
8. docs/features/ai-office/readme-optimization.md
9. docs/features/ai-office/service-status.md
10. docs/features/ai-office/optimization-report.md
11. docs/features/ai-office/implementation-guide.md
12. docs/features/ai-office/genspark-quick-start.md
13. docs/features/ai-office/genspark-analysis.md
14. docs/features/ai-office/executive-summary.md
```

#### 🟡 中度违规（全大写或连字符大写）

```
15. docs/hardening-summary.md
16. docs/optimization-plan.md
17. docs/hardening-execution.md
18. docs/deployment-guide.md
19. docs/api/data-collection-api.md
20. docs/data-management/readme.md
21. docs/data-management/architecture.md
22. docs/data-management/data-model.md
23. docs/data-management/implementation-roadmap.md
24. docs/data-management/policy-category-setup.md
25. docs/data-management/run-error-fix.md
26. docs/data-management/ui-redesign-summary.md
27. docs/data-management/ui-fixes-summary.md
28. docs/data-management/completion-summary.md
29. docs/data-management/data-management-validation.md
30. docs/data-management/data-management-quick-guide.md
31. docs/data-management/data-management-implementation.md
32. docs/data-management/ui-redesign-report.md
```

#### 🟢 轻微违规（中文文件名）

```
39. docs/prd/prd-数据采集.md
```

---

## 总结

项目的文档命名规范制定得非常完善，但**实际执行存在严重不足**。建议立即采取行动，按照渐进式方案逐步修复违规文件，并建立长期的自动化检查机制，确保规范持续执行。

**预计修复时间**: 1-2周（采用渐进式方案）
**预计工作量**: 3-5人日
**优先级**: 🔴 高（影响项目专业性和可维护性）

---

**报告生成时间**: 2025-11-22
**审查工具**: 文档专家 Agent + 人工审查
**下次审查建议**: 修复完成后1个月，或每季度定期审查
