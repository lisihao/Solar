#!/bin/bash
# 文档验证脚本
#
# 用途：验证文档目录结构和命名规范
# 作者：Documentation Agent
# 日期：2025-11-22

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_info() { echo -e "${BLUE}🔍 $1${NC}"; }

ERRORS=0

# 检查1: 根目录文件检查
check_root_files() {
    print_info "检查根目录文件..."

    root_md_files=$(find docs -maxdepth 1 -name "*.md" -type f)
    root_md_count=$(echo "$root_md_files" | grep -v "^$" | wc -l)

    if [ "$root_md_count" -eq 1 ]; then
        # 检查是否是 readme.md
        if echo "$root_md_files" | grep -q "readme.md"; then
            print_success "根目录只有 readme.md"
        else
            print_error "根目录应该只有 readme.md"
            echo "$root_md_files"
            ((ERRORS++))
        fi
    elif [ "$root_md_count" -eq 0 ]; then
        print_error "根目录缺少 readme.md"
        ((ERRORS++))
    else
        print_error "根目录有多余文件（应该只有 readme.md）："
        echo "$root_md_files" | grep -v "readme.md"
        ((ERRORS++))
    fi
}

# 检查2: 文件命名规范
check_naming_convention() {
    print_info "检查文件命名规范（应为小写+连字符）..."

    # 查找大写字母（排除特殊例外）
    uppercase_files=$(find docs -name "*.md" -type f | grep -E "[A-Z]" | grep -v "readme.md" | grep -v "CHANGELOG.md" || true)

    if [ -z "$uppercase_files" ]; then
        print_success "所有文件命名符合规范"
    else
        print_error "以下文件使用了大写字母："
        echo "$uppercase_files"
        ((ERRORS++))
    fi

    # 检查下划线（应使用连字符）
    underscore_files=$(find docs -name "*.md" -type f | grep "_" || true)

    if [ -z "$underscore_files" ]; then
        print_success "没有使用下划线的文件名"
    else
        print_warning "以下文件使用了下划线（建议使用连字符）："
        echo "$underscore_files"
    fi
}

# 检查3: 必需目录存在性
check_required_directories() {
    print_info "检查必需目录..."

    required_dirs=(
        "docs/api"
        "docs/architecture"
        "docs/guides"
        "docs/features"
        "docs/prd"
        "docs/decisions"
        "docs/archive"
    )

    missing_dirs=()

    for dir in "${required_dirs[@]}"; do
        if [ ! -d "$dir" ]; then
            missing_dirs+=("$dir")
        fi
    done

    if [ ${#missing_dirs[@]} -eq 0 ]; then
        print_success "所有必需目录都存在"
    else
        print_error "缺少以下必需目录："
        printf '%s\n' "${missing_dirs[@]}"
        ((ERRORS++))
    fi
}

# 检查4: readme.md 存在性
check_readme_files() {
    print_info "检查各目录的 readme.md..."

    important_dirs=(
        "docs"
        "docs/api"
        "docs/prd"
        "docs/archive"
    )

    missing_readmes=()

    for dir in "${important_dirs[@]}"; do
        if [ ! -f "$dir/readme.md" ]; then
            missing_readmes+=("$dir/readme.md")
        fi
    done

    if [ ${#missing_readmes[@]} -eq 0 ]; then
        print_success "重要目录都有 readme.md"
    else
        print_warning "以下目录缺少 readme.md（建议添加）："
        printf '%s\n' "${missing_readmes[@]}"
    fi
}

# 检查5: 空目录检查
check_empty_directories() {
    print_info "检查空目录..."

    empty_dirs=$(find docs -type d -empty)

    if [ -z "$empty_dirs" ]; then
        print_success "没有空目录"
    else
        print_warning "发现空目录（可能需要清理）："
        echo "$empty_dirs"
    fi
}

# 检查6: 文档数量统计
count_documents() {
    print_info "统计文档数量..."

    echo ""
    echo "📊 文档统计"
    echo "=========="

    total_md=$(find docs -name "*.md" -type f | wc -l)
    echo "总文档数: $total_md"

    active_md=$(find docs -name "*.md" -type f -not -path "*/archive/*" | wc -l)
    echo "活跃文档: $active_md"

    archived_md=$(find docs/archive -name "*.md" -type f 2>/dev/null | wc -l || echo "0")
    echo "归档文档: $archived_md"

    echo ""
    echo "按目录统计:"

    for dir in api architecture guides features prd decisions analysis design archive; do
        if [ -d "docs/$dir" ]; then
            count=$(find "docs/$dir" -name "*.md" -type f 2>/dev/null | wc -l)
            printf "  %-20s %3d 个文件\n" "$dir/" "$count"
        fi
    done

    echo ""
}

# 检查7: 文件大小检查
check_file_sizes() {
    print_info "检查超大文件（>500KB）..."

    large_files=$(find docs -name "*.md" -type f -size +500k || true)

    if [ -z "$large_files" ]; then
        print_success "没有超大文件"
    else
        print_warning "以下文件较大（建议拆分）："
        echo "$large_files"
        find docs -name "*.md" -type f -size +500k -exec ls -lh {} \; | awk '{print $5, $9}'
    fi
}

# 检查8: 中文文件名检查
check_chinese_filenames() {
    print_info "检查中文文件名..."

    chinese_files=$(find docs -name "*.md" -type f | grep -P "[\p{Han}]" || true)

    if [ -z "$chinese_files" ]; then
        print_success "没有中文文件名"
    else
        print_error "以下文件使用了中文文件名（应使用英文）："
        echo "$chinese_files"
        ((ERRORS++))
    fi
}

# 主函数
main() {
    echo "================================================"
    echo "📋 文档结构验证"
    echo "================================================"
    echo ""

    # 检查是否在项目根目录
    if [ ! -d "docs" ]; then
        print_error "未找到 docs/ 目录，请在项目根目录执行此脚本"
        exit 1
    fi

    # 执行所有检查
    check_root_files
    check_naming_convention
    check_required_directories
    check_readme_files
    check_empty_directories
    check_file_sizes
    check_chinese_filenames
    count_documents

    # 总结
    echo ""
    echo "================================================"
    if [ $ERRORS -eq 0 ]; then
        print_success "所有检查通过！"
        echo "================================================"
        exit 0
    else
        print_error "发现 $ERRORS 个错误"
        echo "================================================"
        exit 1
    fi
}

main "$@"
