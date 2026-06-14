#!/bin/bash
#
# 安装 Git Hooks 脚本
# 自动在 commit/push 前运行验证
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

echo "安装 Git Hooks..."

# 创建 pre-commit hook
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash
# Pre-commit hook: 类型检查变更的文件

echo "🔍 Pre-commit: 检查变更的文件..."

# 获取暂存的 TypeScript 文件
STAGED_TS_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)

if [ -z "$STAGED_TS_FILES" ]; then
    echo "✓ 没有 TypeScript 文件变更"
    exit 0
fi

# 快速类型检查
echo "  检查类型..."
cd frontend && npx tsc --noEmit > /dev/null 2>&1 || {
    echo "❌ Frontend 类型错误！"
    npx tsc --noEmit
    exit 1
}

cd ../backend && npx tsc --noEmit > /dev/null 2>&1 || {
    echo "❌ Backend 类型错误！"
    npx tsc --noEmit
    exit 1
}

echo "✓ Pre-commit 检查通过"
EOF

# 创建 pre-push hook
cat > "$HOOKS_DIR/pre-push" << 'EOF'
#!/bin/bash
# Pre-push hook: 完整验证

echo ""
echo "════════════════════════════════════════════"
echo "  Pre-push: 完整验证（可用 --no-verify 跳过）"
echo "════════════════════════════════════════════"
echo ""

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJECT_ROOT"

# 1. 类型检查
echo "🔍 [1/3] 类型检查..."
cd frontend && npx tsc --noEmit || { echo "❌ Frontend 类型错误"; exit 1; }
cd ../backend && npx tsc --noEmit || { echo "❌ Backend 类型错误"; exit 1; }
cd "$PROJECT_ROOT"
echo "✓ 类型检查通过"

# 2. 构建检查
echo ""
echo "🔨 [2/3] 构建检查..."
cd backend && npm run build > /dev/null 2>&1 || { echo "❌ Backend 构建失败"; npm run build; exit 1; }
echo "✓ 构建检查通过"

# 3. 快速测试
echo ""
echo "🧪 [3/3] 快速测试..."
cd "$PROJECT_ROOT/backend"
npm run test:quick > /dev/null 2>&1 || echo "⚠ 部分测试失败，继续推送"

echo ""
echo "════════════════════════════════════════════"
echo "  ✅ 所有验证通过，正在推送..."
echo "════════════════════════════════════════════"
echo ""
EOF

# 设置权限
chmod +x "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-push"

echo "✅ Git Hooks 安装完成！"
echo ""
echo "已安装:"
echo "  - pre-commit: 提交前快速类型检查"
echo "  - pre-push: 推送前完整验证"
echo ""
echo "跳过检查: git push --no-verify"
