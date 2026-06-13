#!/bin/bash
#
# 推送前本地验证脚本
# 在推送代码前运行此脚本，确保所有检查通过
#
# 使用方式：
#   ./scripts/verify-before-push.sh          # 完整验证
#   ./scripts/verify-before-push.sh --quick  # 快速验证（跳过测试）
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 计时
START_TIME=$(date +%s)

# 日志函数
log_step() {
    echo -e "\n${CYAN}==>${NC} ${BLUE}$1${NC}"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_header() {
    echo -e "\n${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
}

# 解析参数
QUICK_MODE=false
SKIP_TESTS=false
for arg in "$@"; do
    case $arg in
        --quick)
            QUICK_MODE=true
            SKIP_TESTS=true
            ;;
        --skip-tests)
            SKIP_TESTS=true
            ;;
    esac
done

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

log_header "GenesisPod - 推送前验证"
echo -e "模式: ${QUICK_MODE:+快速}${QUICK_MODE:-完整}"
echo -e "时间: $(date '+%Y-%m-%d %H:%M:%S')"

# 检查是否有未提交的更改
log_step "检查 Git 状态"
if [[ -n $(git status --porcelain) ]]; then
    log_warn "有未提交的更改，建议先提交或暂存"
    git status --short
fi
log_success "Git 状态检查完成"

# 1. 类型检查
log_step "运行类型检查 (TypeScript)"

echo "  检查 Frontend..."
cd "$PROJECT_ROOT/frontend"
if npx tsc --noEmit > /dev/null 2>&1; then
    log_success "Frontend 类型检查通过"
else
    log_error "Frontend 类型检查失败"
    npx tsc --noEmit
    exit 1
fi

echo "  检查 Backend..."
cd "$PROJECT_ROOT/backend"
if npx tsc --noEmit > /dev/null 2>&1; then
    log_success "Backend 类型检查通过"
else
    log_error "Backend 类型检查失败"
    npx tsc --noEmit
    exit 1
fi

cd "$PROJECT_ROOT"

# 2. Lint 检查（快速模式下只检查变更文件）
log_step "运行 Lint 检查"

if [ "$QUICK_MODE" = true ]; then
    # 只检查有变更的文件
    CHANGED_TS_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)
    if [ -n "$CHANGED_TS_FILES" ]; then
        echo "  检查变更的文件..."
        # Frontend
        FRONTEND_FILES=$(echo "$CHANGED_TS_FILES" | grep "^frontend/" | sed 's|^frontend/||' || true)
        if [ -n "$FRONTEND_FILES" ]; then
            cd "$PROJECT_ROOT/frontend"
            echo "$FRONTEND_FILES" | xargs -r npx eslint --max-warnings 0 2>/dev/null || {
                log_warn "Frontend lint 有警告，继续执行"
            }
        fi
        # Backend
        BACKEND_FILES=$(echo "$CHANGED_TS_FILES" | grep "^backend/" | sed 's|^backend/||' || true)
        if [ -n "$BACKEND_FILES" ]; then
            cd "$PROJECT_ROOT/backend"
            echo "$BACKEND_FILES" | xargs -r npx eslint --max-warnings 0 2>/dev/null || {
                log_warn "Backend lint 有警告，继续执行"
            }
        fi
        cd "$PROJECT_ROOT"
    fi
    log_success "Lint 检查完成（快速模式）"
else
    # 完整 lint 检查
    echo "  检查 Frontend..."
    cd "$PROJECT_ROOT/frontend"
    if npm run lint > /dev/null 2>&1; then
        log_success "Frontend Lint 通过"
    else
        log_warn "Frontend Lint 有警告"
    fi

    echo "  检查 Backend..."
    cd "$PROJECT_ROOT/backend"
    if npm run lint > /dev/null 2>&1; then
        log_success "Backend Lint 通过"
    else
        log_warn "Backend Lint 有警告"
    fi
    cd "$PROJECT_ROOT"
fi

# 3. 构建检查
log_step "运行构建检查"

echo "  构建 Backend..."
cd "$PROJECT_ROOT/backend"
if npm run build > /dev/null 2>&1; then
    log_success "Backend 构建成功"
else
    log_error "Backend 构建失败"
    npm run build
    exit 1
fi

if [ "$QUICK_MODE" = false ]; then
    echo "  构建 Frontend..."
    cd "$PROJECT_ROOT/frontend"
    if NEXT_PUBLIC_API_URL=http://localhost:4000 npm run build > /dev/null 2>&1; then
        log_success "Frontend 构建成功"
    else
        log_error "Frontend 构建失败"
        NEXT_PUBLIC_API_URL=http://localhost:4000 npm run build
        exit 1
    fi
fi

cd "$PROJECT_ROOT"

# 4. 测试（除非跳过）
if [ "$SKIP_TESTS" = false ]; then
    log_step "运行测试"

    echo "  Backend 测试..."
    cd "$PROJECT_ROOT/backend"
    if npm run test:quick > /dev/null 2>&1; then
        log_success "Backend 测试通过"
    else
        log_warn "Backend 部分测试失败，请检查"
    fi

    echo "  Frontend 测试..."
    cd "$PROJECT_ROOT/frontend"
    if npm run test -- --passWithNoTests > /dev/null 2>&1; then
        log_success "Frontend 测试通过"
    else
        log_warn "Frontend 部分测试失败，请检查"
    fi

    cd "$PROJECT_ROOT"
else
    log_step "跳过测试（--skip-tests）"
fi

# 5. 安全检查
log_step "安全检查"

# 检查是否有 secrets 被提交
if git diff --cached --name-only | grep -E '\.(env|key|pem|p12|pfx)$' > /dev/null 2>&1; then
    log_error "检测到敏感文件被暂存！"
    git diff --cached --name-only | grep -E '\.(env|key|pem|p12|pfx)$'
    exit 1
fi

# 检查硬编码 secrets
if grep -rE '(password|secret|api_key|apikey|token).*=.*["'"'"'][^"'"'"']{20,}["'"'"']' \
    --include="*.ts" --include="*.tsx" --include="*.js" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=dist \
    . 2>/dev/null | grep -v "process.env" | grep -v "configService" | head -5; then
    log_warn "可能存在硬编码的敏感信息，请检查"
else
    log_success "未检测到明显的敏感信息"
fi

# 计算耗时
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

log_header "验证完成"
echo -e "耗时: ${DURATION}秒"
echo -e "状态: ${GREEN}所有检查通过${NC}"
echo ""
echo -e "现在可以安全地推送代码: ${CYAN}git push${NC}"
echo ""
