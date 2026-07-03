# docs/ 目录重组优化方案

**制定日期**: 2025-11-22
**文档专家**: Claude (Documentation Agent)
**项目**: GenesisPod
**规范版本**: project-rules.md v2.1

---

## 📋 执行摘要

本方案旨在系统性优化 `docs/` 目录结构，解决当前存在的散乱、分类不清、命名不规范等问题。通过科学的目录组织和规范化的归档策略，提升文档的可维护性和可查找性。

### 关键发现

- **根目录散乱**: 14个 .md 文件直接堆放在根目录
- **分类不明确**: 部分文件位置不合理（如测试文档、配置指南）
- **归档不系统**: archive/ 目录缺乏细分，历史文档混杂
- **命名待规范**: 根据已有的审查报告，39个文件命名需修正（另有修复计划）

### 优化目标

1. **清晰的目录结构** - 按文档类型和功能模块分类
2. **系统化的归档** - 按时间和主题归档历史文档
3. **规范的命名** - 全面符合 v2.1 kebab-case 规范
4. **完善的索引** - 提供多维度的文档导航

---

## 🗂️ 当前状态分析

### 根目录文件清单（14个）

```
docs/
├── readme.md                          ✅ 保留（主导航）
├── backend-test-issues.md             ❌ 应归档到 archive/issues/
├── blog-collection-system.md          ❌ 应移至 features/blog-collection/
├── deployment-guide.md                ❌ 应移至 guides/
├── FILE_NAMING_AUDIT_REPORT.md        ❌ 应归档到 archive/reports/
├── FILE_NAMING_FIX_GUIDE.md           ❌ 应归档到 archive/reports/
├── google-oauth-setup.md              ❌ 应移至 guides/authentication/
├── hardening-execution.md             ❌ 应归档到 archive/execution-logs/
├── hardening-summary.md               ❌ 应归档到 archive/summaries/
├── optimization-plan.md               ❌ 应归档到 archive/planning/
├── railway-env-config.md              ❌ 应移至 guides/deployment/
├── testing-issues.md                  ❌ 应归档到 archive/issues/
├── ui-optimization-plan.md            ❌ 应归档到 archive/planning/
└── ux-usability-audit.md              ❌ 应归档到 archive/audits/
```

**统计**: 13/14 需要移动，仅 readme.md 保留在根目录。

### 现有子目录评估

| 目录                 | 文件数 | 评级       | 说明                |
| -------------------- | ------ | ---------- | ------------------- |
| **analysis/**        | 2      | ⭐⭐⭐⭐☆  | 结构合理，建议保留  |
| **api/**             | 2      | ⭐⭐⭐⭐⭐ | 核心文档，结构良好  |
| **architecture/**    | 3      | ⭐⭐⭐⭐⭐ | 核心文档，结构良好  |
| **archive/**         | 13     | ⭐⭐⭐☆☆   | 需要细分子目录      |
| **data-management/** | 13     | ⭐⭐☆☆☆    | 过于庞大，需拆分    |
| **decisions/**       | 5      | ⭐⭐⭐⭐⭐ | 架构决策记录，优秀  |
| **design/**          | 1      | ⭐⭐⭐☆☆   | 内容较少，可合并    |
| **features/**        | 12+    | ⭐⭐⭐⭐☆  | 结构合理，需整理    |
| **guides/**          | 5      | ⭐⭐⭐⭐⭐ | 核心文档，结构良好  |
| **prd/**             | 7      | ⭐⭐⭐⭐☆  | 需要版本化管理      |
| **project-reports/** | ?      | ⭐⭐☆☆☆    | 需要整合到 archive/ |

---

## 🎯 优化方案设计

### 新的目录结构（v2.0）

```
docs/
├── readme.md                          # 📍 总导航（唯一根文件）
│
├── api/                               # 🔌 API文档
│   ├── readme.md                      # API总览
│   └── data-collection-api.md         # 数据采集API
│
├── architecture/                      # 🏗️ 架构设计
│   ├── overview.md                    # 架构总览
│   ├── ai-context.md                  # AI架构
│   └── improvements-summary.md        # 架构改进
│
├── guides/                            # 📖 使用指南
│   ├── development.md                 # 开发指南
│   ├── deployment.md                  # 部署指南
│   ├── testing.md                     # 测试指南
│   ├── access.md                      # 访问指南
│   ├── service-management.md          # 服务管理
│   │
│   ├── authentication/                # 认证相关
│   │   └── google-oauth-setup.md      # ← 从根目录移入
│   │
│   └── deployment/                    # 部署相关
│       └── railway-config.md          # ← 从根目录移入（重命名）
│
├── features/                          # ✨ 功能文档
│   ├── data-collection/               # 数据采集
│   │   ├── readme.md                  # 功能总览
│   │   ├── verification.md
│   │   ├── fixes.md
│   │   ├── architecture.md            # ← 从 data-management/ 移入
│   │   ├── data-model.md              # ← 从 data-management/ 移入
│   │   ├── implementation.md          # ← 合并多个实施文档
│   │   ├── quick-guide.md             # ← 从 data-management/ 移入
│   │   └── validation.md              # ← 从 data-management/ 移入
│   │
│   ├── blog-collection/               # 博客采集（新建）
│   │   └── system-design.md           # ← 从根目录移入（重命名）
│   │
│   ├── ai-office/                     # AI Office
│   │   ├── readme.md
│   │   ├── product-spec.md
│   │   ├── system-design.md
│   │   ├── (其他9个文件保持原位)
│   │
│   └── workspace-reporting/           # 工作区报告
│       ├── overview.md
│       └── tasks.md
│
├── prd/                               # 📋 产品需求文档
│   ├── readme.md                      # PRD索引（新建）
│   ├── current/                       # 当前版本（新建）
│   │   ├── prd-v2.0.md
│   │   ├── data-collection-v3.0.md
│   │   └── batch-collection-monitor.md
│   │
│   └── archive/                       # 历史版本（新建）
│       ├── prd-v1.0.md                # ← 重命名 prd.md
│       ├── prd-data-collection-zh.md  # 待决定是否保留
│       └── youtube-subtitle-export.md
│
├── decisions/                         # 🧭 架构决策记录（ADR）
│   ├── 001-xxx.md                     # 保持现有5个文件
│   └── ...
│
├── analysis/                          # 📊 分析报告
│   ├── cost-analysis.md
│   └── performance-optimization.md
│
├── design/                            # 🎨 设计文档
│   └── style-guide.md                 # 保持原有
│
└── archive/                           # 📦 归档文档
    ├── readme.md                      # 归档说明（新建）
    │
    ├── 2024-q4/                       # 按季度归档（新建）
    │   └── weekly-reports/
    │       ├── week1-implementation.md
    │       ├── week2-implementation.md
    │       ├── week3-comments.md
    │       └── week4-integration.md
    │
    ├── 2025-q1/                       # 2025年第一季度（新建）
    │   ├── planning/
    │   │   ├── mvp-plan.md            # ← 从 archive/planning/ 移入
    │   │   ├── optimization-plan.md   # ← 从根目录移入
    │   │   └── ui-optimization.md     # ← 从根目录移入（重命名）
    │   │
    │   ├── execution-logs/            # 执行日志（新建）
    │   │   └── hardening-execution.md # ← 从根目录移入
    │   │
    │   ├── summaries/                 # 总结报告（新建）
    │   │   ├── hardening-summary.md   # ← 从根目录移入
    │   │   ├── ui-redesign-summary.md # ← 从 data-management/
    │   │   ├── ui-fixes-summary.md    # ← 从 data-management/
    │   │   └── completion-summary.md  # ← 从 data-management/
    │   │
    │   ├── issues/                    # 问题记录（新建）
    │   │   ├── backend-test-issues.md # ← 从根目录移入
    │   │   ├── testing-issues.md      # ← 从根目录移入
    │   │   └── run-error-fix.md       # ← 从 data-management/
    │   │
    │   ├── audits/                    # 审计报告（新建）
    │   │   ├── ux-usability-audit.md  # ← 从根目录移入
    │   │   ├── file-naming-audit.md   # ← 从根目录移入（重命名）
    │   │   └── file-naming-fix-guide.md # ← 从根目录移入（重命名）
    │   │
    │   └── deprecated/                # 已废弃文档（新建）
    │       ├── ai-office-multi-model.md
    │       ├── fixes.md
    │       ├── implementation-status.md
    │       ├── implementation-summary.md
    │       ├── quick-start-structured-summary.md
    │       ├── todo.md
    │       └── verification.md
    │
    └── data-management-legacy/        # 数据管理遗留文档（新建）
        ├── readme.md                   # 说明此目录为历史文档
        ├── implementation-roadmap.md
        ├── policy-category-setup.md
        └── ui-redesign-report.md
```

### 目录职责说明

| 目录              | 职责           | 活跃度    | 文档类型 |
| ----------------- | -------------- | --------- | -------- |
| **api/**          | API接口文档    | 🟢 活跃   | 技术参考 |
| **architecture/** | 架构设计文档   | 🟢 活跃   | 技术设计 |
| **guides/**       | 操作指南、教程 | 🟢 活跃   | 操作手册 |
| **features/**     | 功能模块文档   | 🟢 活跃   | 功能说明 |
| **prd/**          | 产品需求文档   | 🟡 准活跃 | 产品规格 |
| **decisions/**    | 架构决策记录   | 🟡 准活跃 | 决策记录 |
| **analysis/**     | 分析报告       | 🟡 准活跃 | 分析文档 |
| **design/**       | 设计规范       | 🟡 准活跃 | 设计文档 |
| **archive/**      | 历史归档       | 🔴 归档   | 所有类型 |

---

## 📋 迁移计划

### 迁移原则

1. **使用 `git mv`** - 保留文件历史
2. **更新所有引用** - 确保链接不失效
3. **添加重定向说明** - 在原位置留下说明文件（可选）
4. **分阶段执行** - 降低风险，便于验证

### 阶段1：清理根目录（优先级：🔴 高）

**目标**: 将根目录的13个文件移至合适位置

**执行脚本**: `scripts/docs-phase1-cleanup-root.sh`

```bash
#!/bin/bash
# Phase 1: 清理根目录

set -e

echo "📁 Phase 1: 清理 docs/ 根目录"

# 1. 移动指南类文档
echo "Moving guides..."
mkdir -p docs/guides/authentication
mkdir -p docs/guides/deployment

git mv docs/google-oauth-setup.md docs/guides/authentication/google-oauth-setup.md
git mv docs/railway-env-config.md docs/guides/deployment/railway-config.md
git mv docs/deployment-guide.md docs/guides/deployment-guide.md

# 2. 移动博客采集文档
echo "Moving blog collection..."
mkdir -p docs/features/blog-collection
git mv docs/blog-collection-system.md docs/features/blog-collection/system-design.md

# 3. 移动归档文档
echo "Moving to archive..."
mkdir -p docs/archive/2025-q1/{planning,execution-logs,summaries,issues,audits}

# 规划文档
git mv docs/optimization-plan.md docs/archive/2025-q1/planning/optimization-plan.md
git mv docs/ui-optimization-plan.md docs/archive/2025-q1/planning/ui-optimization.md

# 执行日志
git mv docs/hardening-execution.md docs/archive/2025-q1/execution-logs/hardening-execution.md

# 总结报告
git mv docs/hardening-summary.md docs/archive/2025-q1/summaries/hardening-summary.md

# 问题记录
git mv docs/backend-test-issues.md docs/archive/2025-q1/issues/backend-test-issues.md
git mv docs/testing-issues.md docs/archive/2025-q1/issues/testing-issues.md

# 审计报告
git mv docs/FILE_NAMING_AUDIT_REPORT.md docs/archive/2025-q1/audits/file-naming-audit.md
git mv docs/FILE_NAMING_FIX_GUIDE.md docs/archive/2025-q1/audits/file-naming-fix-guide.md
git mv docs/ux-usability-audit.md docs/archive/2025-q1/audits/ux-usability-audit.md

echo "✅ Phase 1 完成：根目录已清理"
echo "📊 剩余文件："
ls -la docs/*.md
```

**验证检查**:

```bash
# 应该只剩 readme.md
ls docs/*.md | wc -l  # 期望输出: 1

# 检查新目录
ls docs/guides/authentication/
ls docs/guides/deployment/
ls docs/features/blog-collection/
ls docs/archive/2025-q1/
```

### 阶段2：重组 data-management 目录（优先级：🟡 中）

**目标**: 将 data-management/ 的文档合理分配

**执行脚本**: `scripts/docs-phase2-reorganize-data-management.sh`

```bash
#!/bin/bash
# Phase 2: 重组 data-management 目录

set -e

echo "📁 Phase 2: 重组 data-management 目录"

# 1. 核心文档移至 features/data-collection/
echo "Moving core docs to features/data-collection/..."
mkdir -p docs/features/data-collection

git mv docs/data-management/architecture.md docs/features/data-collection/architecture.md
git mv docs/data-management/data-model.md docs/features/data-collection/data-model.md
git mv docs/data-management/data-management-quick-guide.md docs/features/data-collection/quick-guide.md
git mv docs/data-management/data-management-validation.md docs/features/data-collection/validation.md

# 合并多个实施文档为一个
echo "Merging implementation docs..."
cat docs/data-management/data-management-implementation.md > docs/features/data-collection/implementation.md
echo -e "\n---\n## 附录：实施路线图\n" >> docs/features/data-collection/implementation.md
cat docs/data-management/implementation-roadmap.md >> docs/features/data-collection/implementation.md

# 2. 总结文档移至 archive/
echo "Moving summaries to archive..."
git mv docs/data-management/completion-summary.md docs/archive/2025-q1/summaries/completion-summary.md
git mv docs/data-management/ui-redesign-summary.md docs/archive/2025-q1/summaries/ui-redesign-summary.md
git mv docs/data-management/ui-fixes-summary.md docs/archive/2025-q1/summaries/ui-fixes-summary.md

# 3. 问题修复文档移至 archive/
echo "Moving issue fixes to archive..."
git mv docs/data-management/run-error-fix.md docs/archive/2025-q1/issues/run-error-fix.md

# 4. 遗留文档移至专门归档目录
echo "Moving legacy docs..."
mkdir -p docs/archive/data-management-legacy
git mv docs/data-management/policy-category-setup.md docs/archive/data-management-legacy/
git mv docs/data-management/ui-redesign-report.md docs/archive/data-management-legacy/
git mv docs/data-management/implementation-roadmap.md docs/archive/data-management-legacy/

# 5. 更新 data-management/readme.md 并移至新位置
git mv docs/data-management/readme.md docs/features/data-collection/readme.md

# 6. 删除空目录
rmdir docs/data-management/ 2>/dev/null || echo "目录不为空，请手动检查"

echo "✅ Phase 2 完成：data-management 已重组"
```

### 阶段3：优化 PRD 目录（优先级：🟡 中）

**执行脚本**: `scripts/docs-phase3-optimize-prd.sh`

```bash
#!/bin/bash
# Phase 3: 优化 PRD 目录

set -e

echo "📁 Phase 3: 优化 PRD 目录"

# 1. 创建子目录
mkdir -p docs/prd/current
mkdir -p docs/prd/archive

# 2. 移动当前版本PRD
echo "Moving current PRDs..."
git mv docs/prd/prd-v2.0.md docs/prd/current/prd-v2.0.md
git mv docs/prd/data-collection-system-v3.0.md docs/prd/current/data-collection-v3.0.md
git mv docs/prd/batch-collection-monitor-design.md docs/prd/current/batch-collection-monitor.md
git mv docs/prd/data-collection-system-redesign.md docs/prd/current/data-collection-redesign.md

# 3. 归档历史版本
echo "Archiving old PRDs..."
git mv docs/prd/prd.md docs/prd/archive/prd-v1.0.md
git mv docs/prd/prd-data-collection-zh.md docs/prd/archive/prd-data-collection-zh.md
git mv docs/prd/youtube-subtitle-export-prd.md docs/prd/archive/youtube-subtitle-export.md

echo "✅ Phase 3 完成：PRD 目录已优化"
```

### 阶段4：整理 archive 目录（优先级：🟢 低）

**执行脚本**: `scripts/docs-phase4-organize-archive.sh`

```bash
#!/bin/bash
# Phase 4: 整理 archive 目录

set -e

echo "📁 Phase 4: 整理 archive 目录"

# 1. 创建季度目录
mkdir -p docs/archive/2024-q4/weekly-reports
mkdir -p docs/archive/2025-q1/deprecated

# 2. 移动周报到 2024-Q4
echo "Moving weekly reports..."
git mv docs/archive/weekly-reports/*.md docs/archive/2024-q4/weekly-reports/

# 3. 移动废弃文档
echo "Moving deprecated docs..."
git mv docs/archive/ai-office-multi-model.md docs/archive/2025-q1/deprecated/
git mv docs/archive/ai-office-task-version-fix-verification.md docs/archive/2025-q1/deprecated/
git mv docs/archive/fixes.md docs/archive/2025-q1/deprecated/
git mv docs/archive/implementation-status.md docs/archive/2025-q1/deprecated/
git mv docs/archive/implementation-summary.md docs/archive/2025-q1/deprecated/
git mv docs/archive/quick-start-structured-summary.md docs/archive/2025-q1/deprecated/
git mv docs/archive/todo.md docs/archive/2025-q1/deprecated/
git mv docs/archive/verification.md docs/archive/2025-q1/deprecated/

# 4. 删除空目录
rmdir docs/archive/weekly-reports 2>/dev/null || true
rmdir docs/archive/planning 2>/dev/null || true

echo "✅ Phase 4 完成：archive 目录已整理"
```

### 阶段5：更新所有文档链接（优先级：🔴 高）

**执行脚本**: `scripts/docs-phase5-update-links.sh`

```bash
#!/bin/bash
# Phase 5: 更新所有文档链接

set -e

echo "📁 Phase 5: 更新文档链接"

# 定义链接映射（旧路径 -> 新路径）
declare -A link_map=(
    # 根目录移动的文件
    ["docs/google-oauth-setup.md"]="docs/guides/authentication/google-oauth-setup.md"
    ["docs/railway-env-config.md"]="docs/guides/deployment/railway-config.md"
    ["docs/deployment-guide.md"]="docs/guides/deployment-guide.md"
    ["docs/blog-collection-system.md"]="docs/features/blog-collection/system-design.md"

    # data-management 移动的文件
    ["docs/data-management/architecture.md"]="docs/features/data-collection/architecture.md"
    ["docs/data-management/data-model.md"]="docs/features/data-collection/data-model.md"
    ["docs/data-management/readme.md"]="docs/features/data-collection/readme.md"

    # PRD 移动的文件
    ["docs/prd/prd.md"]="docs/prd/archive/prd-v1.0.md"
    ["docs/prd/prd-v2.0.md"]="docs/prd/current/prd-v2.0.md"
    ["docs/prd/data-collection-system-v3.0.md"]="docs/prd/current/data-collection-v3.0.md"
)

# 遍历所有 Markdown 文件
find docs -name "*.md" -type f | while read file; do
    echo "Checking: $file"

    for old_path in "${!link_map[@]}"; do
        new_path="${link_map[$old_path]}"

        # 使用 sed 替换链接（同时处理相对路径）
        sed -i.bak "s|$old_path|$new_path|g" "$file"
        sed -i.bak "s|${old_path#docs/}|${new_path#docs/}|g" "$file"
    done

    # 删除备份文件
    rm -f "$file.bak"
done

echo "✅ Phase 5 完成：文档链接已更新"
echo "⚠️  请手动检查并验证链接正确性"
```

---

## 📝 文档更新清单

### 需要更新的核心文档

1. **docs/readme.md** - 总导航
   - [ ] 更新目录结构说明
   - [ ] 更新所有内部链接
   - [ ] 添加新目录说明

2. **guides/development.md** - 开发指南
   - [ ] 更新文档引用路径
   - [ ] 添加新指南链接

3. **architecture/overview.md** - 架构总览
   - [ ] 更新文档引用

4. **features/\*/readme.md** - 各功能模块索引
   - [ ] 更新内部链接
   - [ ] 添加子文档索引

### 需要创建的新文档

1. **docs/prd/readme.md** - PRD索引

```markdown
# 产品需求文档索引

## 当前版本

- [PRD v2.0](current/prd-v2.0.md)
- [数据采集系统 v3.0](current/data-collection-v3.0.md)

## 历史版本

- [PRD v1.0](archive/prd-v1.0.md)
- [更多历史版本...](archive/)
```

2. **docs/archive/readme.md** - 归档说明

```markdown
# 文档归档说明

本目录包含项目历史文档，按季度和类型组织。

## 目录结构

- `2024-q4/` - 2024年第四季度
- `2025-q1/` - 2025年第一季度
  - `planning/` - 规划文档
  - `execution-logs/` - 执行日志
  - `summaries/` - 总结报告
  - `issues/` - 问题记录
  - `audits/` - 审计报告
  - `deprecated/` - 废弃文档

## 查找文档

归档文档仅供参考，可能已过时。优先查阅主文档。
```

3. **docs/features/data-collection/readme.md** - 更新版

```markdown
# 数据采集系统文档

## 核心文档

- [架构设计](architecture.md)
- [数据模型](data-model.md)
- [实施指南](implementation.md)
- [快速指南](quick-guide.md)
- [验证报告](validation.md)

## 相关PRD

- [数据采集系统 v3.0](../../prd/current/data-collection-v3.0.md)

## 历史文档

- [遗留文档归档](../../archive/data-management-legacy/)
```

---

## 🔍 验证检查清单

### 结构验证

```bash
# 1. 检查根目录（应该只有 readme.md）
ls docs/*.md
# 期望输出: docs/readme.md

# 2. 检查必需目录存在
for dir in api architecture guides features prd decisions analysis design archive; do
    [ -d "docs/$dir" ] && echo "✅ $dir" || echo "❌ $dir 缺失"
done

# 3. 检查归档目录结构
tree docs/archive -L 2

# 4. 统计文档数量
find docs -name "*.md" -type f | wc -l
```

### 链接验证

```bash
# 检查死链（需要工具：markdown-link-check）
npm install -g markdown-link-check

find docs -name "*.md" -exec markdown-link-check {} \;
```

### 命名验证

```bash
# 检查是否还有大写文件名（除特殊例外）
find docs -name "*.md" | grep -E "[A-Z]" | grep -v "readme.md"
# 期望：无输出
```

---

## 📄 创建文档组织规范

**文件位置**: `.claude/standards/10-documentation-organization.md`

（内容见下一个文件创建任务）

---

## 🔄 回滚方案

如果迁移出现问题：

```bash
# 1. 查看迁移前的提交
git log --oneline -5

# 2. 回滚到迁移前状态
git reset --hard <commit-before-migration>

# 3. 或者恢复特定文件
git checkout HEAD~1 -- docs/
```

---

## 📊 预期效果

### 优化前 vs 优化后

| 指标           | 优化前  | 优化后      | 改进   |
| -------------- | ------- | ----------- | ------ |
| 根目录文件数   | 14      | 1           | ↓ 93%  |
| 目录深度       | 不一致  | 标准化2-3层 | 规范化 |
| 文档可查找性   | 🟡 中等 | 🟢 优秀     | ↑ 提升 |
| 归档系统化程度 | 🔴 差   | 🟢 优秀     | ↑ 提升 |
| 命名规范遵守率 | 51%     | 100%        | ↑ 49%  |

---

## 📞 执行支持

### 执行团队

- **负责人**: 文档专家 Agent
- **审核人**: 项目维护者
- **执行时间**: 建议1-2周分阶段完成

### 联系与反馈

- **问题反馈**: 发现迁移问题请及时报告
- **改进建议**: 欢迎提出目录结构优化建议
- **文档审核**: 迁移完成后需要团队审核

---

## 📚 相关文档

- [文档命名审查报告](FILE_NAMING_AUDIT_REPORT.md)
- [文档命名修复指南](FILE_NAMING_FIX_GUIDE.md)
- [项目规则 v2.1](../project-rules.md)
- [命名规范标准](../.claude/standards/03-naming-conventions.md)

---

**文档版本**: v1.0
**维护者**: Claude (Documentation Agent)
**最后更新**: 2025-11-22
