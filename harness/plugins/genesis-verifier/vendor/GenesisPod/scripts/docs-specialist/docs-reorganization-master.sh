#!/bin/bash
# docs/ 目录重组主脚本
#
# 用途：系统性重组项目文档目录结构
# 作者：Documentation Agent
# 日期：2025-11-22
# 版本：v1.0

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印函数
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "📍 $1"
}

# 检查前置条件
check_prerequisites() {
    print_header "检查前置条件"

    # 检查是否在项目根目录
    if [ ! -d "docs" ]; then
        print_error "未找到 docs/ 目录，请在项目根目录执行此脚本"
        exit 1
    fi

    # 检查是否是 git 仓库
    if [ ! -d ".git" ]; then
        print_error "当前目录不是 Git 仓库"
        exit 1
    fi

    # 检查是否有未提交的更改
    if ! git diff-index --quiet HEAD --; then
        print_warning "检测到未提交的更改"
        echo "建议先提交或暂存当前更改，继续吗？ (y/n)"
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            print_info "操作已取消"
            exit 0
        fi
    fi

    print_success "前置条件检查通过"
}

# 备份当前文档结构
create_backup() {
    print_header "创建备份"

    BACKUP_BRANCH="backup-docs-$(date +%Y%m%d-%H%M%S)"

    git checkout -b "$BACKUP_BRANCH"
    print_success "备份分支已创建: $BACKUP_BRANCH"

    git checkout -
    print_info "已返回原分支"
}

# Phase 1: 清理根目录
phase1_cleanup_root() {
    print_header "Phase 1: 清理 docs/ 根目录"

    # 创建必要的目录
    print_info "创建目录结构..."
    mkdir -p docs/guides/authentication
    mkdir -p docs/guides/deployment
    mkdir -p docs/features/blog-collection
    mkdir -p docs/archive/2025-q1/{planning,execution-logs,summaries,issues,audits}

    # 移动指南类文档
    if [ -f "docs/google-oauth-setup.md" ]; then
        print_info "移动: google-oauth-setup.md -> guides/authentication/"
        git mv docs/google-oauth-setup.md docs/guides/authentication/google-oauth-setup.md
    fi

    if [ -f "docs/railway-env-config.md" ]; then
        print_info "移动: railway-env-config.md -> guides/deployment/railway-config.md"
        git mv docs/railway-env-config.md docs/guides/deployment/railway-config.md
    fi

    if [ -f "docs/deployment-guide.md" ]; then
        print_info "移动: deployment-guide.md -> guides/"
        git mv docs/deployment-guide.md docs/guides/deployment-guide.md
    fi

    # 移动博客采集文档
    if [ -f "docs/blog-collection-system.md" ]; then
        print_info "移动: blog-collection-system.md -> features/blog-collection/system-design.md"
        git mv docs/blog-collection-system.md docs/features/blog-collection/system-design.md
    fi

    # 移动归档文档 - 规划类
    if [ -f "docs/optimization-plan.md" ]; then
        print_info "归档: optimization-plan.md"
        git mv docs/optimization-plan.md docs/archive/2025-q1/planning/optimization-plan.md
    fi

    if [ -f "docs/ui-optimization-plan.md" ]; then
        print_info "归档: ui-optimization-plan.md"
        git mv docs/ui-optimization-plan.md docs/archive/2025-q1/planning/ui-optimization.md
    fi

    # 移动归档文档 - 执行日志
    if [ -f "docs/hardening-execution.md" ]; then
        print_info "归档: hardening-execution.md"
        git mv docs/hardening-execution.md docs/archive/2025-q1/execution-logs/hardening-execution.md
    fi

    # 移动归档文档 - 总结报告
    if [ -f "docs/hardening-summary.md" ]; then
        print_info "归档: hardening-summary.md"
        git mv docs/hardening-summary.md docs/archive/2025-q1/summaries/hardening-summary.md
    fi

    # 移动归档文档 - 问题记录
    if [ -f "docs/backend-test-issues.md" ]; then
        print_info "归档: backend-test-issues.md"
        git mv docs/backend-test-issues.md docs/archive/2025-q1/issues/backend-test-issues.md
    fi

    if [ -f "docs/testing-issues.md" ]; then
        print_info "归档: testing-issues.md"
        git mv docs/testing-issues.md docs/archive/2025-q1/issues/testing-issues.md
    fi

    # 移动归档文档 - 审计报告
    if [ -f "docs/FILE_NAMING_AUDIT_REPORT.md" ]; then
        print_info "归档: FILE_NAMING_AUDIT_REPORT.md"
        git mv docs/FILE_NAMING_AUDIT_REPORT.md docs/archive/2025-q1/audits/file-naming-audit.md
    fi

    if [ -f "docs/FILE_NAMING_FIX_GUIDE.md" ]; then
        print_info "归档: FILE_NAMING_FIX_GUIDE.md"
        git mv docs/FILE_NAMING_FIX_GUIDE.md docs/archive/2025-q1/audits/file-naming-fix-guide.md
    fi

    if [ -f "docs/ux-usability-audit.md" ]; then
        print_info "归档: ux-usability-audit.md"
        git mv docs/ux-usability-audit.md docs/archive/2025-q1/audits/ux-usability-audit.md
    fi

    print_success "Phase 1 完成：根目录已清理"

    # 验证
    root_files=$(ls docs/*.md 2>/dev/null | grep -v "readme.md" | wc -l)
    if [ "$root_files" -eq 0 ]; then
        print_success "验证通过：根目录只保留 readme.md"
    else
        print_warning "根目录仍有其他文件："
        ls docs/*.md | grep -v "readme.md"
    fi
}

# Phase 2: 重组 data-management 目录
phase2_reorganize_data_management() {
    print_header "Phase 2: 重组 data-management 目录"

    # 检查目录是否存在
    if [ ! -d "docs/data-management" ]; then
        print_warning "data-management 目录不存在，跳过此阶段"
        return
    fi

    # 创建目标目录
    mkdir -p docs/features/data-collection
    mkdir -p docs/archive/data-management-legacy

    # 移动核心文档到 features/data-collection/
    print_info "移动核心文档到 features/data-collection/"

    if [ -f "docs/data-management/architecture.md" ]; then
        git mv docs/data-management/architecture.md docs/features/data-collection/architecture.md
    fi

    if [ -f "docs/data-management/data-model.md" ]; then
        git mv docs/data-management/data-model.md docs/features/data-collection/data-model.md
    fi

    if [ -f "docs/data-management/data-management-quick-guide.md" ]; then
        git mv docs/data-management/data-management-quick-guide.md docs/features/data-collection/quick-guide.md
    fi

    if [ -f "docs/data-management/data-management-validation.md" ]; then
        git mv docs/data-management/data-management-validation.md docs/features/data-collection/validation.md
    fi

    # 合并实施文档
    print_info "合并实施文档..."
    if [ -f "docs/data-management/data-management-implementation.md" ] && [ -f "docs/data-management/implementation-roadmap.md" ]; then
        cat docs/data-management/data-management-implementation.md > docs/features/data-collection/implementation.md
        echo -e "\n---\n## 附录：实施路线图\n" >> docs/features/data-collection/implementation.md
        cat docs/data-management/implementation-roadmap.md >> docs/features/data-collection/implementation.md
        git add docs/features/data-collection/implementation.md
        git rm docs/data-management/data-management-implementation.md
        git rm docs/data-management/implementation-roadmap.md
    elif [ -f "docs/data-management/data-management-implementation.md" ]; then
        git mv docs/data-management/data-management-implementation.md docs/features/data-collection/implementation.md
    fi

    # 移动总结文档到归档
    print_info "移动总结文档到归档..."

    if [ -f "docs/data-management/completion-summary.md" ]; then
        git mv docs/data-management/completion-summary.md docs/archive/2025-q1/summaries/completion-summary.md
    fi

    if [ -f "docs/data-management/ui-redesign-summary.md" ]; then
        git mv docs/data-management/ui-redesign-summary.md docs/archive/2025-q1/summaries/ui-redesign-summary.md
    fi

    if [ -f "docs/data-management/ui-fixes-summary.md" ]; then
        git mv docs/data-management/ui-fixes-summary.md docs/archive/2025-q1/summaries/ui-fixes-summary.md
    fi

    # 移动问题修复文档
    if [ -f "docs/data-management/run-error-fix.md" ]; then
        git mv docs/data-management/run-error-fix.md docs/archive/2025-q1/issues/run-error-fix.md
    fi

    # 移动遗留文档
    print_info "移动遗留文档到专门归档目录..."

    if [ -f "docs/data-management/policy-category-setup.md" ]; then
        git mv docs/data-management/policy-category-setup.md docs/archive/data-management-legacy/
    fi

    if [ -f "docs/data-management/ui-redesign-report.md" ]; then
        git mv docs/data-management/ui-redesign-report.md docs/archive/data-management-legacy/
    fi

    # 移动 readme.md
    if [ -f "docs/data-management/readme.md" ]; then
        git mv docs/data-management/readme.md docs/features/data-collection/readme.md
    fi

    # 检查并删除空目录
    if [ -d "docs/data-management" ]; then
        remaining=$(ls -A docs/data-management 2>/dev/null | wc -l)
        if [ "$remaining" -eq 0 ]; then
            rmdir docs/data-management
            print_success "已删除空目录: data-management"
        else
            print_warning "data-management 目录不为空，请手动检查"
            ls -la docs/data-management/
        fi
    fi

    print_success "Phase 2 完成：data-management 已重组"
}

# Phase 3: 优化 PRD 目录
phase3_optimize_prd() {
    print_header "Phase 3: 优化 PRD 目录"

    # 创建子目录
    mkdir -p docs/prd/current
    mkdir -p docs/prd/archive

    # 移动当前版本 PRD
    print_info "移动当前版本 PRD..."

    if [ -f "docs/prd/prd-v2.0.md" ]; then
        git mv docs/prd/prd-v2.0.md docs/prd/current/prd-v2.0.md
    fi

    if [ -f "docs/prd/data-collection-system-v3.0.md" ]; then
        git mv docs/prd/data-collection-system-v3.0.md docs/prd/current/data-collection-v3.0.md
    fi

    if [ -f "docs/prd/batch-collection-monitor-design.md" ]; then
        git mv docs/prd/batch-collection-monitor-design.md docs/prd/current/batch-collection-monitor.md
    fi

    if [ -f "docs/prd/data-collection-system-redesign.md" ]; then
        git mv docs/prd/data-collection-system-redesign.md docs/prd/current/data-collection-redesign.md
    fi

    # 归档历史版本
    print_info "归档历史版本 PRD..."

    if [ -f "docs/prd/prd.md" ]; then
        git mv docs/prd/prd.md docs/prd/archive/prd-v1.0.md
    fi

    if [ -f "docs/prd/prd-data-collection-zh.md" ]; then
        git mv docs/prd/prd-data-collection-zh.md docs/prd/archive/prd-data-collection-zh.md
    fi

    if [ -f "docs/prd/youtube-subtitle-export-prd.md" ]; then
        git mv docs/prd/youtube-subtitle-export-prd.md docs/prd/archive/youtube-subtitle-export.md
    fi

    # 创建 PRD 索引
    print_info "创建 PRD 索引文件..."
    cat > docs/prd/readme.md << 'EOF'
# 产品需求文档索引

**最后更新**: 2025-11-22

---

## 📋 当前版本

这些是项目当前使用的PRD，保持活跃更新：

- [PRD v2.0](current/prd-v2.0.md) - 项目整体产品需求
- [数据采集系统 v3.0](current/data-collection-v3.0.md) - 数据采集系统重构PRD
- [批量采集监控设计](current/batch-collection-monitor.md) - 批量采集监控功能
- [数据采集系统重新设计](current/data-collection-redesign.md) - 数据采集重新设计方案

---

## 📦 历史版本

这些是已归档的历史PRD版本，仅供参考：

- [PRD v1.0](archive/prd-v1.0.md) - 项目初始版本PRD
- [数据采集 PRD（中文）](archive/prd-data-collection-zh.md) - 数据采集早期PRD
- [YouTube字幕导出](archive/youtube-subtitle-export.md) - YouTube功能PRD（已下线）

更多历史版本请查看 [archive/](archive/) 目录。

---

## 🔗 相关文档

- [技术架构](../architecture/overview.md)
- [功能文档](../features/)
- [API文档](../api/)
EOF

    git add docs/prd/readme.md

    print_success "Phase 3 完成：PRD 目录已优化"
}

# Phase 4: 整理 archive 目录
phase4_organize_archive() {
    print_header "Phase 4: 整理 archive 目录"

    # 创建季度目录
    mkdir -p docs/archive/2024-q4/weekly-reports
    mkdir -p docs/archive/2025-q1/deprecated

    # 移动周报到 2024-Q4
    if [ -d "docs/archive/weekly-reports" ]; then
        print_info "移动周报到 2024-Q4..."
        if ls docs/archive/weekly-reports/*.md 1> /dev/null 2>&1; then
            git mv docs/archive/weekly-reports/*.md docs/archive/2024-q4/weekly-reports/ || true
        fi
        rmdir docs/archive/weekly-reports 2>/dev/null || print_warning "weekly-reports 目录不为空"
    fi

    # 移动废弃文档
    print_info "移动废弃文档..."

    deprecated_files=(
        "ai-office-multi-model.md"
        "ai-office-task-version-fix-verification.md"
        "fixes.md"
        "implementation-status.md"
        "implementation-summary.md"
        "quick-start-structured-summary.md"
        "todo.md"
        "verification.md"
    )

    for file in "${deprecated_files[@]}"; do
        if [ -f "docs/archive/$file" ]; then
            git mv "docs/archive/$file" docs/archive/2025-q1/deprecated/
        fi
    done

    # 删除空目录
    rmdir docs/archive/planning 2>/dev/null || print_warning "planning 目录不为空或不存在"

    # 创建归档说明文件
    print_info "创建归档说明文件..."
    cat > docs/archive/readme.md << 'EOF'
# 文档归档说明

本目录包含项目历史文档，按季度和类型组织。

**重要**: 归档文档可能已过时，优先参考主文档。

---

## 📁 目录结构

### 2024-Q4（2024年10月-12月）
- `weekly-reports/` - 每周开发进度报告

### 2025-Q1（2025年1月-3月）
- `planning/` - 规划文档（优化方案、执行计划等）
- `execution-logs/` - 执行日志（加固执行、实施过程等）
- `summaries/` - 总结报告（各阶段总结、完成报告等）
- `issues/` - 问题记录（测试问题、错误修复等）
- `audits/` - 审计报告（代码审计、文档审计等）
- `deprecated/` - 废弃文档（已不再使用的历史文档）

### 特定模块遗留文档
- `data-management-legacy/` - 数据管理模块的历史文档

---

## 🔍 如何查找文档

1. **按时间查找**: 进入对应季度目录
2. **按类型查找**: 进入对应类型子目录
3. **搜索工具**:
   ```bash
   # 在归档中搜索关键词
   grep -r "关键词" docs/archive/

   # 按文件名搜索
   find docs/archive -name "*关键词*.md"
   ```

---

## ⚠️ 使用注意事项

- ✅ 可以参考历史决策和实施过程
- ✅ 了解项目演进历史
- ❌ 不要基于归档文档进行开发
- ❌ 不要引用归档文档作为主要参考

当前活跃文档请查看：
- [文档主页](../readme.md)
- [功能文档](../features/)
- [产品需求](../prd/)

---

**归档负责人**: 文档专家团队
**最后整理**: 2025-11-22
EOF

    git add docs/archive/readme.md

    print_success "Phase 4 完成：archive 目录已整理"
}

# 创建新文档索引
create_new_readme_files() {
    print_header "创建新的文档索引"

    # 创建 features/blog-collection/readme.md（如果不存在）
    if [ ! -f "docs/features/blog-collection/readme.md" ]; then
        print_info "创建 features/blog-collection/readme.md..."
        cat > docs/features/blog-collection/readme.md << 'EOF'
# 博客采集系统

## 文档列表

- [系统设计](system-design.md) - 博客采集系统的完整设计文档

## 功能概述

GenesisPod 的博客采集系统可以自动从全球知名企业和分析机构的博客中采集、解析、存储和展示最新内容。

## 相关资源

- [数据采集API](../../api/data-collection-api.md)
- [数据采集架构](../data-collection/architecture.md)
EOF
        git add docs/features/blog-collection/readme.md
    fi

    # 创建 guides/authentication/readme.md
    if [ ! -f "docs/guides/authentication/readme.md" ]; then
        print_info "创建 guides/authentication/readme.md..."
        cat > docs/guides/authentication/readme.md << 'EOF'
# 认证配置指南

## 文档列表

- [Google OAuth 配置](google-oauth-setup.md) - Google OAuth 2.0 认证配置指南

## 概述

本目录包含各种认证方式的配置和使用指南。
EOF
        git add docs/guides/authentication/readme.md
    fi

    # 创建 guides/deployment/readme.md
    if [ ! -f "docs/guides/deployment/readme.md" ]; then
        print_info "创建 guides/deployment/readme.md..."
        cat > docs/guides/deployment/readme.md << 'EOF'
# 部署配置指南

## 文档列表

- [Railway 配置](railway-config.md) - Railway 平台环境变量配置
- [部署指南](../deployment-guide.md) - 生产环境部署流程

## 概述

本目录包含各种部署平台的配置和操作指南。
EOF
        git add docs/guides/deployment/readme.md
    fi

    print_success "新文档索引已创建"
}

# 生成变更摘要
generate_summary() {
    print_header "生成变更摘要"

    echo ""
    echo "📊 重组统计"
    echo "==========="
    echo ""

    echo "根目录文件："
    root_count=$(ls docs/*.md 2>/dev/null | wc -l)
    echo "  当前: $root_count 个（应该是1个 readme.md）"

    echo ""
    echo "新建目录："
    echo "  ✓ docs/guides/authentication/"
    echo "  ✓ docs/guides/deployment/"
    echo "  ✓ docs/features/blog-collection/"
    echo "  ✓ docs/features/data-collection/"
    echo "  ✓ docs/prd/current/"
    echo "  ✓ docs/prd/archive/"
    echo "  ✓ docs/archive/2024-q4/"
    echo "  ✓ docs/archive/2025-q1/{planning,execution-logs,summaries,issues,audits,deprecated}/"
    echo "  ✓ docs/archive/data-management-legacy/"

    echo ""
    echo "移动的文件数量："
    moved_count=$(git status --short | grep "^R" | wc -l)
    echo "  $moved_count 个文件"

    echo ""
    echo "详细变更："
    git status --short
}

# 主执行函数
main() {
    print_header "docs/ 目录重组脚本"
    echo "版本: v1.0"
    echo "日期: 2025-11-22"
    echo ""

    # 模拟运行模式
    if [[ "$1" == "--dry-run" ]]; then
        print_warning "模拟运行模式（不会实际修改文件）"
        print_info "实际执行请运行: $0"
        exit 0
    fi

    # 确认执行
    echo "此脚本将重组 docs/ 目录结构。"
    echo "建议先阅读 docs/DOCS-REORGANIZATION-PLAN.md"
    echo ""
    read -p "确认继续？(yes/no): " confirm

    if [[ "$confirm" != "yes" ]]; then
        print_info "操作已取消"
        exit 0
    fi

    # 执行各阶段
    check_prerequisites
    create_backup

    phase1_cleanup_root
    phase2_reorganize_data_management
    phase3_optimize_prd
    phase4_organize_archive

    create_new_readme_files
    generate_summary

    # 完成提示
    print_header "重组完成！"
    echo ""
    print_success "所有阶段执行成功"
    echo ""
    print_info "下一步操作："
    echo "  1. 检查变更: git status"
    echo "  2. 查看差异: git diff"
    echo "  3. 提交变更: git commit -m 'refactor(docs): reorganize documentation structure'"
    echo "  4. 运行验证: scripts/docs-validation.sh"
    echo ""
    print_warning "如需回滚，切换到备份分支: git checkout $BACKUP_BRANCH"
}

# 执行主函数
main "$@"
