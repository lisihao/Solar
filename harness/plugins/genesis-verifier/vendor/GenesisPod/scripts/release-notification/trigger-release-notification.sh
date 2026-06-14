#!/bin/bash
#
# 发布通知触发脚本
#
# 使用方式：
#   ./scripts/release-notification/trigger-release-notification.sh v1.0.0 v1.1.0
#   ./scripts/release-notification/trigger-release-notification.sh v1.0.0 v1.1.0 --dry-run
#
# 参数：
#   $1: 起始版本 tag（必填）
#   $2: 目标版本 tag（必填）
#   $3: --dry-run（可选，预览模式）
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示帮助
show_help() {
    cat << EOF
发布通知触发脚本

使用方式：
  ./scripts/release-notification/trigger-release-notification.sh <from-tag> <to-tag> [options]

参数：
  <from-tag>    起始版本 tag（必填）
  <to-tag>      目标版本 tag（必填）
  --dry-run     预览模式，只生成发布说明，不发送通知
  --help, -h    显示帮助信息

示例：
  # 预览发布说明
  ./scripts/release-notification/trigger-release-notification.sh v1.0.0 v1.1.0 --dry-run

  # 发送发布通知
  ./scripts/release-notification/trigger-release-notification.sh v1.0.0 v1.1.0

环境要求：
  - Node.js 18+
  - 已配置 .env 文件（数据库连接、AI API Key 等）
EOF
}

# 检查参数
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    show_help
    exit 0
fi

if [ -z "$1" ] || [ -z "$2" ]; then
    log_error "缺少必要参数"
    echo ""
    show_help
    exit 1
fi

FROM_TAG="$1"
TO_TAG="$2"
DRY_RUN=""

if [ "$3" == "--dry-run" ]; then
    DRY_RUN="--dry-run"
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

log_info "=============================================="
log_info "发布通知触发器"
log_info "=============================================="
log_info "项目目录: $PROJECT_ROOT"
log_info "后端目录: $BACKEND_DIR"
log_info "从版本: $FROM_TAG"
log_info "到版本: $TO_TAG"
log_info "模式: ${DRY_RUN:-正式发送}"
log_info "=============================================="

# 检查目录是否存在
if [ ! -d "$BACKEND_DIR" ]; then
    log_error "后端目录不存在: $BACKEND_DIR"
    exit 1
fi

# 切换到后端目录
cd "$BACKEND_DIR"

# 检查 .env 文件
if [ ! -f ".env" ]; then
    log_error ".env 文件不存在，请先配置环境变量"
    exit 1
fi

# 检查 Git tags 是否存在
log_info "验证 Git tags..."

if ! git rev-parse "$FROM_TAG" >/dev/null 2>&1; then
    log_error "起始 tag 不存在: $FROM_TAG"
    exit 1
fi

if ! git rev-parse "$TO_TAG" >/dev/null 2>&1; then
    log_error "目标 tag 不存在: $TO_TAG"
    exit 1
fi

log_success "Git tags 验证通过"

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    log_warn "node_modules 不存在，正在安装依赖..."
    npm install
fi

# 执行发布通知脚本
log_info "执行发布通知脚本..."
echo ""

npx ts-node scripts/send-release-notification.ts --from "$FROM_TAG" --to "$TO_TAG" $DRY_RUN

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    log_success "发布通知处理完成"
else
    log_error "发布通知处理失败 (exit code: $EXIT_CODE)"
fi

exit $EXIT_CODE
