#!/bin/bash
# 文档文件批量重命名脚本
# 用途：将不符合命名规范的文档文件重命名为小写
# 依据：project-rules.md v2.1 文件命名规范
# 使用：./scripts/rename-docs-lowercase.sh [--dry-run]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 参数解析
DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo -e "${YELLOW}🔍 运行模式：模拟运行（不会实际修改文件）${NC}"
else
  echo -e "${YELLOW}⚠️  运行模式：真实执行（将修改文件名）${NC}"
  echo -e "${YELLOW}   如需模拟运行，请使用: $0 --dry-run${NC}"
  echo ""
  read -p "确认继续？(y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 0
  fi
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  文档文件命名规范修复脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 计数器
TOTAL_FILES=0
RENAMED_FILES=0
SKIPPED_FILES=0

# 重命名函数
rename_file() {
  local old_path="$1"
  local new_path="$2"

  TOTAL_FILES=$((TOTAL_FILES + 1))

  if [[ "$old_path" == "$new_path" ]]; then
    echo -e "${GREEN}✓${NC} 已符合规范: $old_path"
    SKIPPED_FILES=$((SKIPPED_FILES + 1))
    return
  fi

  echo -e "${YELLOW}📝 重命名:${NC}"
  echo -e "   From: ${RED}$old_path${NC}"
  echo -e "   To:   ${GREEN}$new_path${NC}"

  if [[ "$DRY_RUN" == false ]]; then
    # 确保目标目录存在
    mkdir -p "$(dirname "$new_path")"

    # 使用 git mv 保留历史（如果在git仓库中）
    if git rev-parse --git-dir > /dev/null 2>&1; then
      git mv "$old_path" "$new_path" 2>/dev/null || mv "$old_path" "$new_path"
    else
      mv "$old_path" "$new_path"
    fi

    RENAMED_FILES=$((RENAMED_FILES + 1))
  else
    RENAMED_FILES=$((RENAMED_FILES + 1))
  fi
}

echo -e "${BLUE}阶段1: data-management/ 目录${NC}"
echo "----------------------------"

# data-management 目录
rename_file "docs/data-management/README.md" "docs/data-management/readme.md"
rename_file "docs/data-management/ARCHITECTURE.md" "docs/data-management/architecture.md"
rename_file "docs/data-management/DATA-MODEL.md" "docs/data-management/data-model.md"
rename_file "docs/data-management/IMPLEMENTATION-ROADMAP.md" "docs/data-management/implementation-roadmap.md"
rename_file "docs/data-management/POLICY-CATEGORY-SETUP.md" "docs/data-management/policy-category-setup.md"
rename_file "docs/data-management/RUN-ERROR-FIX.md" "docs/data-management/run-error-fix.md"
rename_file "docs/data-management/UI-REDESIGN-SUMMARY.md" "docs/data-management/ui-redesign-summary.md"
rename_file "docs/data-management/UI-FIXES-SUMMARY.md" "docs/data-management/ui-fixes-summary.md"
rename_file "docs/data-management/COMPLETION-SUMMARY.md" "docs/data-management/completion-summary.md"
rename_file "docs/data-management/DATA-MANAGEMENT-VALIDATION.md" "docs/data-management/data-management-validation.md"
rename_file "docs/data-management/DATA-MANAGEMENT-QUICK-GUIDE.md" "docs/data-management/data-management-quick-guide.md"
rename_file "docs/data-management/DATA-MANAGEMENT-IMPLEMENTATION.md" "docs/data-management/data-management-implementation.md"
rename_file "docs/data-management/UI-REDESIGN-REPORT.md" "docs/data-management/ui-redesign-report.md"

echo ""
echo -e "${BLUE}阶段2: features/ai-office/ 目录${NC}"
echo "----------------------------"

# ai-office 目录
rename_file "docs/features/ai-office/README_OPTIMIZATION.md" "docs/features/ai-office/readme-optimization.md"
rename_file "docs/features/ai-office/SERVICE_STATUS.md" "docs/features/ai-office/service-status.md"
rename_file "docs/features/ai-office/OPTIMIZATION_REPORT.md" "docs/features/ai-office/optimization-report.md"
rename_file "docs/features/ai-office/IMPLEMENTATION_GUIDE.md" "docs/features/ai-office/implementation-guide.md"
rename_file "docs/features/ai-office/GENSPARK_QUICK_START.md" "docs/features/ai-office/genspark-quick-start.md"
rename_file "docs/features/ai-office/GENSPARK_ANALYSIS.md" "docs/features/ai-office/genspark-analysis.md"
rename_file "docs/features/ai-office/EXECUTIVE_SUMMARY.md" "docs/features/ai-office/executive-summary.md"

echo ""
echo -e "${BLUE}阶段3: api/ 目录${NC}"
echo "----------------------------"

# API 目录
rename_file "docs/api/DATA-COLLECTION-API.md" "docs/api/data-collection-api.md"

echo ""
echo -e "${BLUE}阶段4: docs/ 根目录${NC}"
echo "----------------------------"

# docs 根目录
rename_file "docs/BLOG_COLLECTION_SYSTEM.md" "docs/blog-collection-system.md"
rename_file "docs/RAILWAY_ENV_CONFIG.md" "docs/railway-env-config.md"
rename_file "docs/GOOGLE_OAUTH_SETUP.md" "docs/google-oauth-setup.md"
rename_file "docs/UX_USABILITY_AUDIT.md" "docs/ux-usability-audit.md"
rename_file "docs/UI_OPTIMIZATION_PLAN.md" "docs/ui-optimization-plan.md"
rename_file "docs/BACKEND_TEST_ISSUES.md" "docs/backend-test-issues.md"
rename_file "docs/TESTING_ISSUES.md" "docs/testing-issues.md"
rename_file "docs/HARDENING_SUMMARY.md" "docs/hardening-summary.md"
rename_file "docs/OPTIMIZATION_PLAN.md" "docs/optimization-plan.md"
rename_file "docs/HARDENING_EXECUTION.md" "docs/hardening-execution.md"
rename_file "docs/DEPLOYMENT_GUIDE.md" "docs/deployment-guide.md"

echo ""
echo -e "${BLUE}阶段5: prd/ 目录${NC}"
echo "----------------------------"

# PRD 目录（处理中文文件名）
if [[ -f "docs/prd/prd-数据采集.md" ]]; then
  rename_file "docs/prd/prd-数据采集.md" "docs/prd/prd-data-collection-zh.md"
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ 重命名完成！${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "统计信息："
echo "  总文件数: $TOTAL_FILES"
echo "  已重命名: $RENAMED_FILES"
echo "  已符合规范: $SKIPPED_FILES"
echo ""

if [[ "$DRY_RUN" == false ]]; then
  echo -e "${YELLOW}⚠️  下一步操作：${NC}"
  echo "1. 检查重命名结果是否正确"
  echo "2. 运行以下命令更新文档中的引用链接："
  echo ""
  echo -e "   ${BLUE}./scripts/update-doc-links.sh${NC}"
  echo ""
  echo "3. 提交更改："
  echo ""
  echo -e "   ${BLUE}git add -A${NC}"
  echo -e "   ${BLUE}git commit -m \"refactor(docs): rename files to lowercase per v2.1 standard\"${NC}"
  echo ""
else
  echo -e "${YELLOW}这是模拟运行，没有实际修改文件${NC}"
  echo "如需真实执行，运行: $0"
fi
