# 文档清理执行检查清单

> **使用说明**: 按顺序勾选完成的任务，确保不遗漏关键步骤

---

## 📅 执行时间规划

- **阶段1**: 2026-01-15 ~ 2026-01-19 (本周)
- **阶段2**: 2026-01-22 ~ 2026-01-26 (下周)
- **阶段3**: 2026-01-29 ~ 2026-02-12 (两周)
- **验收**: 2026-02-13 ~ 2026-02-14

---

## ⚙️ 准备工作

### 环境准备

- [ ] 确认 Git 工作区干净（无未提交更改）

  ```bash
  git status
  # 应显示: working tree clean
  ```

- [ ] 创建备份分支

  ```bash
  git checkout -b docs-cleanup-backup
  git push origin docs-cleanup-backup
  ```

- [ ] 创建工作分支

  ```bash
  git checkout main
  git checkout -b docs-cleanup-phase1
  ```

- [ ] 安装必要工具
  ```bash
  npm install -g markdown-link-check  # 链接检查工具
  ```

### 团队通知

- [ ] 在团队频道发布清理通知

  ```
  标题: [重要] 文档目录清理计划 - 本周执行
  内容:
    - 清理时间: 本周五下午
    - 影响范围: docs/ 目录
    - 预计时长: 2-3小时
    - 注意事项: 清理期间避免修改 docs/ 文件
    - 详细方案: docs/_cleanup_executive_summary.md
  ```

- [ ] 确认无人正在编辑 docs/ 文件

---

## 🚀 阶段1: 紧急清理（本周完成）

### 任务 1.1: 归档过期文档（预计2小时）

#### 归档 2024年文档

- [ ] 归档 `data-management/data-management-quick-guide.md` (2024-11-19)

  ```bash
  mkdir -p docs/archive/data-management-legacy
  git mv docs/data-management/data-management-quick-guide.md \
         docs/archive/data-management-legacy/
  ```

- [ ] 归档 `design/ai-reports-optimization/readme.md` (2024-12-28)

  ```bash
  git mv docs/design/ai-reports-optimization/readme.md \
         docs/archive/2025-q1/deprecated/ai-reports-optimization-readme.md
  ```

- [ ] 归档 `decisions/ai-summary-restructuring.md` (2024-11-17)
  ```bash
  git mv docs/decisions/ai-summary-restructuring.md \
         docs/archive/2025-q1/deprecated/
  ```

#### 归档项目报告

- [ ] 创建目录并移动文件
  ```bash
  mkdir -p docs/archive/2025-q1/reports
  git mv docs/project-reports/product-improvement-plan-2025-12.md \
         docs/archive/2025-q1/reports/
  git mv docs/project-reports/project-comprehensive-evaluation-2025-12.md \
         docs/archive/2025-q1/reports/
  git mv docs/project-reports/test-supplementation-plan-2025-12.md \
         docs/archive/2025-q1/reports/
  rmdir docs/project-reports
  ```

#### 归档实施记录

- [ ] 创建目录并移动文件
  ```bash
  mkdir -p docs/archive/2025-q1/implementations
  git mv docs/implementation/google-drive-frontend-integration.md \
         docs/archive/2025-q1/implementations/
  git mv docs/implementation/google-drive-hooks-examples.md \
         docs/archive/2025-q1/implementations/
  git mv docs/implementation/google-drive-implementation-plan.md \
         docs/archive/2025-q1/implementations/
  git mv docs/implementation/ai-simulation-improvements-2025-12-06.md \
         docs/archive/2025-q1/implementations/
  git mv docs/implementation/ai-simulation-improvements-2025-12-06-phase2.md \
         docs/archive/2025-q1/implementations/
  git mv docs/implementation/auto-fix-github-integration.md \
         docs/archive/2025-q1/implementations/
  rmdir docs/implementation
  ```

#### 删除无价值文档

- [ ] 删除 `improvement/ai-writing-improvement-plan.md`

  ```bash
  git rm docs/improvement/ai-writing-improvement-plan.md
  rmdir docs/improvement
  ```

- [ ] 删除 `product-reviews/knowledge-graph-design-review.md`

  ```bash
  git rm docs/product-reviews/knowledge-graph-design-review.md
  rmdir docs/product-reviews
  ```

- [ ] 删除 `operations/feature-announcement-workflow.md`

  ```bash
  git rm docs/operations/feature-announcement-workflow.md
  rmdir docs/operations
  ```

- [ ] 删除 `tasks/P2-C02-character-personality-completion-summary.md`
  ```bash
  git rm docs/tasks/P2-C02-character-personality-completion-summary.md
  rmdir docs/tasks
  ```

#### 验证结果

- [ ] 检查文件数量

  ```bash
  find docs -name "*.md" ! -path "docs/archive/*" | wc -l
  # 期望: ~222 个（267 - 45）
  ```

- [ ] 检查空目录是否删除

  ```bash
  ls docs/ | grep -E "improvement|product-reviews|operations|tasks"
  # 期望: 无输出
  ```

- [ ] 提交更改

  ```bash
  git add docs/
  git commit -m "docs: archive outdated files and remove valueless docs

  - Archive 2024 documents (3 files)
  - Archive project reports (3 files)
  - Archive implementation records (6 files)
  - Delete valueless documents (4 files)
  - Remove empty directories (4 dirs)

  Total: 16 files archived/deleted, 45 files cleaned"
  ```

### 任务 1.2: 修正命名违规（预计3小时）

**注意**: 此任务涉及大量文件重命名，建议分批执行并频繁提交

#### 批次1: prd/ 目录（约20个文件）

- [ ] 修正 `prd/ai-studio/noble-sleeping-flurry.md`

  ```bash
  git mv docs/prd/ai-studio/noble-sleeping-flurry.md \
         docs/prd/ai-studio/collaboration-timeline-redesign-alternative.md
  ```

- [ ] 提交批次1
  ```bash
  git add docs/prd/
  git commit -m "docs: fix naming in prd/ai-studio (batch 1)"
  ```

#### 批次2: design/ 目录（约15个文件）

- [ ] 逐个重命名 design/ 目录下的违规文件
- [ ] 提交批次2
  ```bash
  git add docs/design/
  git commit -m "docs: fix naming in design/ (batch 2)"
  ```

#### 批次3: 其他目录（约96个文件）

- [ ] 重命名 architecture/ 违规文件
- [ ] 重命名 features/ 违规文件
- [ ] 重命名其他违规文件
- [ ] 提交批次3
  ```bash
  git add docs/
  git commit -m "docs: fix naming in remaining directories (batch 3)"
  ```

#### 验证结果

- [ ] 运行命名验证脚本

  ```bash
  # 查找不符合规范的文件
  find docs -name "*.md" \
    ! -path "docs/archive/*" \
    ! -name "readme.md" \
    | grep -E "[A-Z_]|[ ]"
  # 期望: 无输出
  ```

- [ ] 最终提交

  ```bash
  git add docs/
  git commit -m "docs: complete naming convention fixes

  - Fixed 131 naming violations
  - All docs now use kebab-case
  - Compliance rate: 100%"
  ```

### 任务 1.3: 更新核心文档（预计2小时）

#### 更新 docs/readme.md

- [ ] 打开文件

  ```bash
  code docs/readme.md
  ```

- [ ] 更新"最后更新"日期为今天
- [ ] 更新"文档版本"为 v3.0
- [ ] 更新目录结构说明（反映清理后的结构）
- [ ] 验证所有内部链接有效
- [ ] 添加新增目录说明：
  - `prd/current/` - 当前版本 PRD
  - `prd/archive/` - 历史版本 PRD
  - `archive/2025-q1/reports/` - 项目报告归档
  - `archive/2025-q1/implementations/` - 实施记录归档

- [ ] 提交更改

  ```bash
  git add docs/readme.md
  git commit -m "docs: update main readme to v3.0

  - Update directory structure
  - Add new directories explanation
  - Fix internal links
  - Update last modified date"
  ```

#### 更新 docs/prd/readme.md

- [ ] 打开文件

  ```bash
  code docs/prd/readme.md
  ```

- [ ] 更新"最后更新"日期
- [ ] 更新目录结构说明（添加 current/ 和 archive/）
- [ ] 更新模块状态总览表（截止到2026-01-15）
- [ ] 添加版本管理规则说明

- [ ] 提交更改

  ```bash
  git add docs/prd/readme.md
  git commit -m "docs: update prd readme with version management

  - Add current/ and archive/ structure
  - Update module status (2026-01-15)
  - Add version management rules"
  ```

#### 更新 docs/api/readme.md

- [ ] 打开文件

  ```bash
  code docs/api/readme.md
  ```

- [ ] 验证所有 API 端点是否与代码一致

  ```bash
  # 检查后端路由
  grep -r "@Controller" backend/src/modules --include="*.ts" | grep "api"
  ```

- [ ] 补充2025-11-15后新增的 API
- [ ] 更新示例代码
- [ ] 添加"最后验证日期: 2026-01-15"

- [ ] 提交更改

  ```bash
  git add docs/api/readme.md
  git commit -m "docs: verify and update API documentation

  - Verify API endpoints against codebase
  - Add new APIs since 2025-11-15
  - Update code examples
  - Add last verification date"
  ```

#### 阶段1总验收

- [ ] 检查所有更改

  ```bash
  git log --oneline | head -10
  ```

- [ ] 运行链接检查

  ```bash
  find docs -name "*.md" ! -path "docs/archive/*" \
    -exec markdown-link-check {} \;
  ```

- [ ] 推送到远程

  ```bash
  git push origin docs-cleanup-phase1
  ```

- [ ] 创建 PR
  - 标题: `docs: Phase 1 cleanup - Archive, naming fixes, and core updates`
  - 描述: 链接到 `_cleanup_executive_summary.md`
  - 请求审查: @team

---

## 🔧 阶段2: 结构优化（下周完成）

### 任务 2.1: 重组 data-management（预计1小时）

#### 移动核心文档到 features/data-collection/

- [ ] 创建目录

  ```bash
  mkdir -p docs/features/data-collection
  ```

- [ ] 移动文档

  ```bash
  git mv docs/data-management/architecture.md \
         docs/features/data-collection/architecture.md
  git mv docs/data-management/data-model.md \
         docs/features/data-collection/data-model.md
  git mv docs/data-management/readme.md \
         docs/features/data-collection/readme.md
  git mv docs/data-management/data-management-validation.md \
         docs/features/data-collection/validation.md
  ```

- [ ] 更新 `features/data-collection/readme.md` 内容
  - 移除对 data-management 的引用
  - 添加新文件列表
  - 链接到 prd/current/data-collection/

#### 归档其余文档

- [ ] 移动到归档目录

  ```bash
  mkdir -p docs/archive/data-management-legacy
  git mv docs/data-management/policy-category-setup.md \
         docs/archive/data-management-legacy/
  git mv docs/data-management/ui-redesign-report.md \
         docs/archive/data-management-legacy/
  git mv docs/data-management/ui-redesign-summary.md \
         docs/archive/data-management-legacy/
  git mv docs/data-management/ui-fixes-summary.md \
         docs/archive/data-management-legacy/
  git mv docs/data-management/completion-summary.md \
         docs/archive/data-management-legacy/
  git mv docs/data-management/run-error-fix.md \
         docs/archive/data-management-legacy/
  git mv docs/data-management/implementation-roadmap.md \
         docs/archive/data-management-legacy/
  ```

- [ ] 创建归档说明

  ```bash
  cat > docs/archive/data-management-legacy/readme.md << 'EOF'
  # Data Management 遗留文档

  > **归档日期**: 2026-01-22
  > **原因**: 功能已迁移到 features/data-collection/

  这些文档是数据管理模块的历史实施记录，仅供参考。

  当前文档位置: [features/data-collection/](../../features/data-collection/)

  EOF
  ```

- [ ] 删除空目录

  ```bash
  rmdir docs/data-management
  ```

- [ ] 提交更改

  ```bash
  git add docs/
  git commit -m "docs: reorganize data-management to features/data-collection

  - Move core docs to features/data-collection/
  - Archive legacy docs (7 files)
  - Remove data-management/ directory"
  ```

### 任务 2.2: 合并重复文档（预计3小时）

#### 合并组1: AI Office 重构计划

- [ ] 创建合并文档 `features/ai-office/refactor-plan-v3.0.md`
- [ ] 合并内容：
  - `architecture/ai-office-refactor-prd.md`
  - `architecture/ai-office-agent-refactor-plan.md`
  - `features/ai-office/ai-office-3.0-refactor-plan.md`
- [ ] 归档原文件到 `archive/2025-q1/deprecated/`
- [ ] 提交
  ```bash
  git commit -m "docs: merge AI Office refactor plans into v3.0"
  ```

#### 合并组2: Topic Research 设计

- [ ] 保留 `design/topic-research-redesign-v7.md`
- [ ] 归档其他版本：
  - `design/topic-research-ui-redesign.md`
  - `design/topic-research-optimization-plan.md`
  - `design/topic-research-refactor.md`
- [ ] 提交
  ```bash
  git commit -m "docs: archive old Topic Research design docs, keep v7"
  ```

#### 合并组3-15（按完整报告执行）

- [ ] 合并组3: AI Slides 优化
- [ ] 合并组4: AI Engine 迁移
- [ ] 合并组5: Google Drive 实施
- [ ] 合并组6-15...（见完整报告 3.4 节）

- [ ] 最终提交

  ```bash
  git add docs/
  git commit -m "docs: complete document merging (15 groups)

  - Merged 30 duplicate files
  - Archived old versions
  - Kept latest versions only"
  ```

### 任务 2.3: 优化 PRD 目录（预计2小时）

#### 创建 current/ 和 archive/ 结构

- [ ] 创建目录
  ```bash
  mkdir -p docs/prd/current/{core,ai-studio,ai-office,ai-writing,ai-slides,ai-group,ai-coding,ai-ask,topic-research,knowledge-base,library,integrations,data-collection}
  mkdir -p docs/prd/archive
  ```

#### 移动当前版本到 current/

- [ ] 移动核心 PRD

  ```bash
  git mv docs/prd/core/deepdive-engine-prd-v2.0.md \
         docs/prd/current/core/
  git mv docs/prd/core/credits-system-prd-v1.0.md \
         docs/prd/current/core/
  # ... 其他核心文档
  ```

- [ ] 移动模块 PRD
  ```bash
  git mv docs/prd/ai-studio/ai-studio-prd-v4.0.md \
         docs/prd/current/ai-studio/
  git mv docs/prd/ai-office/ai-office-prd-v2.0.md \
         docs/prd/current/ai-office/
  # ... 其他模块文档
  ```

#### 归档旧版本

- [ ] 移动到 archive/

  ```bash
  git mv docs/prd/ai-writing-v2.md \
         docs/prd/archive/ai-writing-prd-v2.0-archived.md
  git mv docs/prd/ai-writing-redesign.md \
         docs/prd/archive/ai-writing-redesign-archived.md
  # ... 其他旧版本
  ```

- [ ] 在归档文件头部添加标记

  ```markdown
  > **⚠️ 已归档**
  > 此文档已被 [v3.0](../current/ai-writing/ai-writing-v3-user-first.md) 替代
  > 归档日期: 2026-01-22
  ```

- [ ] 提交更改

  ```bash
  git add docs/prd/
  git commit -m "docs: optimize prd directory with version management

  - Create current/ and archive/ structure
  - Move current versions to current/
  - Archive old versions with metadata
  - Update readme with new structure"
  ```

#### 阶段2总验收

- [ ] 检查目录结构

  ```bash
  tree docs/prd -L 2
  ```

- [ ] 验证重复文档已清除

  ```bash
  # 应该找不到重复组
  ```

- [ ] 推送并创建 PR
  ```bash
  git push origin docs-cleanup-phase2
  ```

---

## 🎨 阶段3: 完善补充（两周内）

### 任务 3.1: 创建索引文档（预计2小时）

#### 创建 design/readme.md

- [ ] 创建文件

  ```bash
  cat > docs/design/readme.md << 'EOF'
  # 设计文档索引

  > **最后更新**: 2026-01-29

  ## 目录结构

  - topic-research/ - Topic Research 技术设计
  - ai-reports-optimization/ - AI 报告优化设计

  ## 根目录设计文档

  - [AI Engine 目标架构](ai-engine-target-architecture.md)
  - [AI Agent 能力管理设计](ai-agent-capabilities-management-design.md)
  - [AI Coding 增强设计](ai-coding-enhancement-design.md)
  - [AI Writing 质量改进方案](ai-writing-quality-improvement-plan.md)

  EOF
  ```

#### 创建 archive/readme.md

- [ ] 创建归档说明

  ```bash
  cat > docs/archive/readme.md << 'EOF'
  # 文档归档说明

  ## 归档规则

  - 按季度组织: YYYY-qN/
  - 按类型分类: planning/, reports/, implementations/, etc.

  ## 查找文档

  优先查阅主文档，归档文档仅供参考。

  EOF
  ```

#### 为 features/ 子目录创建 readme.md

- [ ] 创建/更新以下文件：
  - [ ] `features/ai-coding/readme.md`
  - [ ] `features/ai-agents/readme.md`
  - [ ] `features/ai-studio/readme.md`
  - [ ] `features/ai-teams/readme.md`
  - [ ] `features/image-generator/readme.md`
  - [ ] `features/workspace-reporting/readme.md`

- [ ] 统一格式：

  ```markdown
  # [模块名称] 功能文档

  > **模块状态**: 开发中 | 已完成 | 规划中
  > **最后更新**: YYYY-MM-DD

  ## 核心文档

  - [文档1](file1.md)
  - [文档2](file2.md)

  ## 相关 PRD

  - [PRD链接](../../prd/current/[module]/)

  ## 相关设计

  - [设计链接](../../design/[module]/)
  ```

- [ ] 提交
  ```bash
  git add docs/
  git commit -m "docs: add index files for all directories"
  ```

### 任务 3.2: 验证代码一致性（预计4小时）

#### 检查 AI Writing 模块

- [ ] 打开文档 `features/ai-writing/architecture.md`
- [ ] 检查代码 `backend/src/modules/ai-app/writing/`
- [ ] 验证以下一致性：
  - [ ] API 端点是否匹配
  - [ ] 服务架构是否一致
  - [ ] 数据模型是否同步
- [ ] 如有不一致，更新文档
- [ ] 标注验证日期: `> **最后验证**: 2026-01-30`

#### 检查 Topic Research 模块

- [ ] 打开文档 `prd/current/topic-research/topic-research-prd-v1.0.md`
- [ ] 检查代码 `backend/src/modules/ai-app/research/topic-research/`
- [ ] 验证功能实现与 PRD 一致性
- [ ] 更新文档中的实现状态

#### 检查其他核心模块（共10个）

- [ ] AI Office
- [ ] AI Coding
- [ ] AI Simulation
- [ ] Data Collection (ingestion)
- [ ] Resources Management
- [ ] AI Ask
- [ ] AI Teams
- [ ] AI Agents
- [ ] Knowledge Base
- [ ] Integrations

- [ ] 提交更改

  ```bash
  git add docs/
  git commit -m "docs: verify code consistency and update docs

  - Verified 10 core modules
  - Updated implementation status
  - Added verification dates"
  ```

### 任务 3.3: 建立自动化检查（预计3小时）

#### 创建 GitHub Actions Workflow

- [ ] 创建文件 `.github/workflows/docs-validation.yml`

  ```yaml
  name: Docs Validation

  on:
    pull_request:
      paths:
        - "docs/**"
    push:
      branches:
        - main
      paths:
        - "docs/**"

  jobs:
    validate:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v3

        - name: Check naming conventions
          run: |
            chmod +x ./scripts/validate-docs-naming.sh
            ./scripts/validate-docs-naming.sh

        - name: Check broken links
          uses: gaurav-nelson/github-action-markdown-link-check@v1
          with:
            folder-path: "docs/"
            config-file: ".github/markdown-link-check-config.json"

        - name: Check metadata
          run: |
            chmod +x ./scripts/validate-docs-metadata.sh
            ./scripts/validate-docs-metadata.sh
  ```

#### 创建验证脚本

- [ ] 创建 `scripts/validate-docs-naming.sh`

  ```bash
  #!/bin/bash
  echo "检查文档命名规范..."
  find docs -name "*.md" \
    ! -path "docs/archive/*" \
    ! -name "readme.md" \
    | grep -E "[A-Z_]|[ ]" > /tmp/violations.txt

  if [ -s /tmp/violations.txt ]; then
    echo "❌ 发现命名违规:"
    cat /tmp/violations.txt
    exit 1
  else
    echo "✅ 所有文档命名符合规范"
    exit 0
  fi
  ```

- [ ] 创建 `scripts/validate-docs-metadata.sh`

  ```bash
  #!/bin/bash
  echo "检查文档元数据..."
  find docs -name "*.md" ! -path "docs/archive/*" | while read file; do
    if ! grep -q "最后更新" "$file" && ! grep -q "Last Updated" "$file"; then
      echo "⚠️  缺少更新日期: $file"
    fi
  done
  ```

- [ ] 创建 `scripts/check-outdated-docs.sh`

  ```bash
  #!/bin/bash
  # 检查超过6个月未更新的文档
  CUTOFF_DATE=$(date -d '6 months ago' +%Y-%m-%d)
  echo "检查过期文档（截止日期: $CUTOFF_DATE）..."

  find docs -name "*.md" ! -path "docs/archive/*" -type f \
    -printf '%T+ %p\n' | while read date file; do
      if [[ "${date:0:10}" < "$CUTOFF_DATE" ]]; then
        echo "⚠️  $file (${date:0:10})"
      fi
    done
  ```

- [ ] 设置可执行权限
  ```bash
  chmod +x scripts/validate-docs-naming.sh
  chmod +x scripts/validate-docs-metadata.sh
  chmod +x scripts/check-outdated-docs.sh
  ```

#### 配置 Link Check

- [ ] 创建 `.github/markdown-link-check-config.json`

  ```json
  {
    "ignorePatterns": [
      {
        "pattern": "^https://api.example.com"
      }
    ],
    "replacementPatterns": [],
    "httpHeaders": [],
    "timeout": "20s",
    "retryOn429": true,
    "retryCount": 3,
    "fallbackRetryDelay": "30s"
  }
  ```

- [ ] 提交所有自动化文件

  ```bash
  git add .github/ scripts/
  git commit -m "docs: add automated validation pipeline

  - GitHub Actions workflow for docs validation
  - Naming convention checker
  - Metadata validator
  - Outdated docs detector
  - Link check configuration"
  ```

#### 阶段3总验收

- [ ] 测试所有脚本

  ```bash
  ./scripts/validate-docs-naming.sh
  ./scripts/validate-docs-metadata.sh
  ./scripts/check-outdated-docs.sh
  ```

- [ ] 推送并创建 PR
  ```bash
  git push origin docs-cleanup-phase3
  ```

---

## ✅ 最终验收

### 数据指标验证

- [ ] 文档总数检查

  ```bash
  find docs -name "*.md" | wc -l
  # 期望: 180-200
  ```

- [ ] 活跃文档数检查

  ```bash
  find docs -name "*.md" ! -path "docs/archive/*" | wc -l
  # 期望: 120-140
  ```

- [ ] 命名合规率检查

  ```bash
  ./scripts/validate-docs-naming.sh
  # 期望: ✅ 所有文档命名符合规范
  ```

- [ ] 链接有效性检查
  ```bash
  find docs -name "*.md" ! -path "docs/archive/*" \
    -exec markdown-link-check {} \; | grep "ERROR"
  # 期望: 无 ERROR
  ```

### 质量标准检查

- [ ] 所有核心目录有 readme.md 索引

  ```bash
  for dir in api architecture guides features prd design decisions; do
    [ -f "docs/$dir/readme.md" ] && echo "✅ $dir" || echo "❌ $dir"
  done
  ```

- [ ] PRD 版本管理清晰

  ```bash
  ls docs/prd/
  # 期望: current/ archive/ readme.md
  ```

- [ ] 归档目录结构合理
  ```bash
  tree docs/archive -L 2
  # 期望: 按季度和类型组织
  ```

### 团队反馈收集

- [ ] 邀请团队成员测试文档查找
- [ ] 收集查找时间反馈（目标 < 2分钟）
- [ ] 收集结构合理性反馈
- [ ] 记录改进建议

### 创建总结报告

- [ ] 创建 `docs/archive/2025-q1/reports/cleanup-completion-report.md`

  ```markdown
  # 文档清理完成报告

  ## 执行摘要

  - 清理时间: 2026-01-15 ~ 2026-02-14
  - 总工作量: XX 小时
  - 文档减少: 267 → XXX (XX%)

  ## 完成情况

  - 阶段1: ✅ 完成
  - 阶段2: ✅ 完成
  - 阶段3: ✅ 完成

  ## 改进效果

  - 命名合规率: 51% → 100%
  - 重复文档: 15组 → 0
  - 过期文档: ~50 → 0
  - 查找时间: 5-10分钟 → X分钟

  ## 团队反馈

  [收集的反馈]

  ## 后续维护

  - 每月审查: [日期]
  - 季度整理: [日期]
  ```

---

## 📊 进度追踪

### 整体进度

- [ ] 阶段1: 紧急清理（0/3 任务）
- [ ] 阶段2: 结构优化（0/3 任务）
- [ ] 阶段3: 完善补充（0/3 任务）
- [ ] 最终验收（0/4 检查）

### 时间记录

| 阶段     | 预计      | 实际      | 差异      |
| -------- | --------- | --------- | --------- |
| 准备工作 | 0.5h      | \_\_h     | \_\_h     |
| 阶段1    | 7h        | \_\_h     | \_\_h     |
| 阶段2    | 6h        | \_\_h     | \_\_h     |
| 阶段3    | 9h        | \_\_h     | \_\_h     |
| 验收     | 2h        | \_\_h     | \_\_h     |
| **总计** | **24.5h** | **\_\_h** | **\_\_h** |

---

## 📝 问题记录

遇到问题时在此记录，便于后续改进

| 日期 | 问题描述 | 解决方案 | 耗时 |
| ---- | -------- | -------- | ---- |
|      |          |          |      |
|      |          |          |      |

---

## 🎉 完成确认

- [ ] 所有检查清单项已勾选
- [ ] 数据指标达标
- [ ] 质量标准满足
- [ ] 团队反馈积极
- [ ] 自动化验证通过
- [ ] 总结报告已提交

**完成日期**: \***\*\_\_\_\_\*\***
**完成人**: \***\*\_\_\_\_\*\***
**审核人**: \***\*\_\_\_\_\*\***

---

**检查清单版本**: v1.0
**创建日期**: 2026-01-15
**最后更新**: 2026-01-15
