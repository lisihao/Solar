#!/bin/bash
# 文档链接批量更新脚本
# 用途：更新所有文档中指向已重命名文件的链接
# 配合 rename-docs-lowercase.sh 使用

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  文档链接批量更新脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 检查操作系统
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  SED_INPLACE="sed -i ''"
else
  # Linux / Windows Git Bash
  SED_INPLACE="sed -i"
fi

echo -e "${YELLOW}🔍 搜索并替换文档中的链接...${NC}"
echo ""

UPDATED_FILES=0

# 定义替换规则
declare -A replacements=(
  # data-management
  ["README.md"]="readme.md"
  ["ARCHITECTURE.md"]="architecture.md"
  ["DATA-MODEL.md"]="data-model.md"
  ["IMPLEMENTATION-ROADMAP.md"]="implementation-roadmap.md"
  ["POLICY-CATEGORY-SETUP.md"]="policy-category-setup.md"
  ["RUN-ERROR-FIX.md"]="run-error-fix.md"
  ["UI-REDESIGN-SUMMARY.md"]="ui-redesign-summary.md"
  ["UI-FIXES-SUMMARY.md"]="ui-fixes-summary.md"
  ["COMPLETION-SUMMARY.md"]="completion-summary.md"
  ["DATA-MANAGEMENT-VALIDATION.md"]="data-management-validation.md"
  ["DATA-MANAGEMENT-QUICK-GUIDE.md"]="data-management-quick-guide.md"
  ["DATA-MANAGEMENT-IMPLEMENTATION.md"]="data-management-implementation.md"
  ["UI-REDESIGN-REPORT.md"]="ui-redesign-report.md"

  # ai-office
  ["README_OPTIMIZATION.md"]="readme-optimization.md"
  ["SERVICE_STATUS.md"]="service-status.md"
  ["OPTIMIZATION_REPORT.md"]="optimization-report.md"
  ["IMPLEMENTATION_GUIDE.md"]="implementation-guide.md"
  ["GENSPARK_QUICK_START.md"]="genspark-quick-start.md"
  ["GENSPARK_ANALYSIS.md"]="genspark-analysis.md"
  ["EXECUTIVE_SUMMARY.md"]="executive-summary.md"

  # api
  ["DATA-COLLECTION-API.md"]="data-collection-api.md"

  # docs root
  ["BLOG_COLLECTION_SYSTEM.md"]="blog-collection-system.md"
  ["RAILWAY_ENV_CONFIG.md"]="railway-env-config.md"
  ["GOOGLE_OAUTH_SETUP.md"]="google-oauth-setup.md"
  ["UX_USABILITY_AUDIT.md"]="ux-usability-audit.md"
  ["UI_OPTIMIZATION_PLAN.md"]="ui-optimization-plan.md"
  ["BACKEND_TEST_ISSUES.md"]="backend-test-issues.md"
  ["TESTING_ISSUES.md"]="testing-issues.md"
  ["HARDENING_SUMMARY.md"]="hardening-summary.md"
  ["OPTIMIZATION_PLAN.md"]="optimization-plan.md"
  ["HARDENING_EXECUTION.md"]="hardening-execution.md"
  ["DEPLOYMENT_GUIDE.md"]="deployment-guide.md"
)

# 查找所有 .md 文件（排除 node_modules）
md_files=$(find . -type f -name "*.md" ! -path "*/node_modules/*" ! -path "*/.git/*")

echo "找到 $(echo "$md_files" | wc -l) 个 Markdown 文件"
echo ""

for file in $md_files; do
  file_modified=false

  for old_name in "${!replacements[@]}"; do
    new_name="${replacements[$old_name]}"

    # 检查文件是否包含旧链接
    if grep -q "$old_name" "$file" 2>/dev/null; then
      echo -e "${YELLOW}更新:${NC} $file"
      echo -e "  ${RED}$old_name${NC} → ${GREEN}$new_name${NC}"

      # 执行替换
      if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|$old_name|$new_name|g" "$file"
      else
        # Linux / Windows Git Bash
        sed -i "s|$old_name|$new_name|g" "$file"
      fi

      file_modified=true
    fi
  done

  if [[ "$file_modified" == true ]]; then
    UPDATED_FILES=$((UPDATED_FILES + 1))
  fi
done

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ 链接更新完成！${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "统计信息："
echo "  已更新文件数: $UPDATED_FILES"
echo ""

echo -e "${YELLOW}⚠️  建议操作：${NC}"
echo "1. 检查修改结果："
echo -e "   ${BLUE}git diff${NC}"
echo ""
echo "2. 验证链接是否正确（随机抽查几个文件）"
echo ""
echo "3. 如确认无误，提交更改："
echo -e "   ${BLUE}git add -A${NC}"
echo -e "   ${BLUE}git commit -m \"docs: update file links after renaming to lowercase\"${NC}"
echo ""
