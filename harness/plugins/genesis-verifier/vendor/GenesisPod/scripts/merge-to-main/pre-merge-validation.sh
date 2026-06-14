#!/bin/bash

# Pre-Merge Validation Script
# 在merge到主干前执行所有必要的验证
# 用法: ./pre-merge-validation.sh [target_branch]

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
TARGET_BRANCH=${1:-develop}
REQUIRED_COVERAGE=85

# 打印函数
print_step() {
  echo -e "${BLUE}[STEP]${NC} $1"
}

print_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
  echo -e "${RED}[✗]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}[!]${NC} $1"
}

# 检查Git状态
check_git_status() {
  print_step "Checking Git status..."

  # 检查当前分支
  CURRENT_BRANCH=$(git branch --show-current)
  print_success "Current branch: $CURRENT_BRANCH"

  # 确保不在main/develop分支
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "develop" ]; then
    print_error "Cannot run validation from main/develop branch"
    exit 1
  fi

  # 检查工作目录是否干净
  if ! git diff --quiet || ! git diff --cached --quiet; then
    print_error "Working directory not clean. Please commit or stash changes."
    git status --short
    exit 1
  fi

  print_success "Working directory clean"

  # 拉取最新的远程分支
  print_step "Fetching latest from remote..."
  git fetch origin

  # 检查是否与远程同步
  LOCAL=$(git rev-parse @)
  REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")

  if [ -n "$REMOTE" ]; then
    if [ "$LOCAL" != "$REMOTE" ]; then
      print_warning "Local branch is not in sync with remote"
      print_warning "Run 'git pull' or 'git push' to sync"
    else
      print_success "Branch in sync with remote"
    fi
  fi
}

# 验证提交信息
validate_commit_messages() {
  print_step "Validating commit messages (Conventional Commits)..."

  # 获取最近5次提交
  COMMITS=$(git log -5 --pretty=format:"%s")

  # Conventional Commits正则模式
  PATTERN='^(feat|fix|refactor|test|docs|chore|perf|ci|style|revert)(\([a-z-]+\))?:\s.+'

  INVALID_COMMITS=()

  while IFS= read -r commit; do
    if ! echo "$commit" | grep -qE "$PATTERN"; then
      INVALID_COMMITS+=("$commit")
    fi
  done <<< "$COMMITS"

  if [ ${#INVALID_COMMITS[@]} -gt 0 ]; then
    print_error "Found invalid commit messages:"
    for commit in "${INVALID_COMMITS[@]}"; do
      echo "  - $commit"
    done
    echo ""
    echo "Commit messages must follow Conventional Commits format:"
    echo "  <type>(<scope>): <subject>"
    echo ""
    echo "Types: feat, fix, refactor, test, docs, chore, perf, ci, style, revert"
    echo "Example: feat(backend): add RSS parser"
    exit 1
  fi

  print_success "All commit messages valid"
}

# 运行代码质量检查
run_quality_checks() {
  print_step "Running code quality checks..."

  # Frontend检查
  if [ -d "frontend" ]; then
    print_step "Frontend: Linting..."
    cd frontend
    npm run lint || {
      print_error "Frontend lint failed"
      exit 1
    }
    print_success "Frontend lint passed"

    print_step "Frontend: Type checking..."
    npm run type-check || {
      print_error "Frontend type check failed"
      exit 1
    }
    print_success "Frontend type check passed"

    cd ..
  fi

  # Backend检查
  if [ -d "backend" ]; then
    print_step "Backend: Linting..."
    cd backend
    npm run lint || {
      print_error "Backend lint failed"
      exit 1
    }
    print_success "Backend lint passed"

    print_step "Backend: Type checking..."
    npm run type-check || {
      print_error "Backend type check failed"
      exit 1
    }
    print_success "Backend type check passed"

    cd ..
  fi
}

# 运行测试
run_tests() {
  print_step "Running test suites..."

  # Frontend测试
  if [ -d "frontend" ]; then
    print_step "Frontend: Running tests..."
    cd frontend
    npm run test:coverage || {
      print_error "Frontend tests failed"
      exit 1
    }

    # 检查覆盖率
    if [ -f "coverage/coverage-summary.json" ]; then
      COVERAGE=$(node -p "JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json')).total.lines.pct")
      if (( $(echo "$COVERAGE < $REQUIRED_COVERAGE" | bc -l) )); then
        print_warning "Frontend coverage ($COVERAGE%) is below required ($REQUIRED_COVERAGE%)"
      else
        print_success "Frontend tests passed (coverage: $COVERAGE%)"
      fi
    else
      print_success "Frontend tests passed"
    fi

    cd ..
  fi

  # Backend测试
  if [ -d "backend" ]; then
    print_step "Backend: Running tests..."
    cd backend
    npm run test:coverage || {
      print_error "Backend tests failed"
      exit 1
    }

    # 检查覆盖率
    if [ -f "coverage/coverage-summary.json" ]; then
      COVERAGE=$(node -p "JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json')).total.lines.pct")
      if (( $(echo "$COVERAGE < $REQUIRED_COVERAGE" | bc -l) )); then
        print_warning "Backend coverage ($COVERAGE%) is below required ($REQUIRED_COVERAGE%)"
      else
        print_success "Backend tests passed (coverage: $COVERAGE%)"
      fi
    else
      print_success "Backend tests passed"
    fi

    cd ..
  fi
}

# 检查冲突
check_conflicts() {
  print_step "Checking for merge conflicts with $TARGET_BRANCH..."

  # 获取merge base
  MERGE_BASE=$(git merge-base HEAD origin/$TARGET_BRANCH)

  # 尝试merge但不提交
  git merge --no-commit --no-ff origin/$TARGET_BRANCH > /dev/null 2>&1 || {
    print_error "Merge conflicts detected with $TARGET_BRANCH"
    print_error "Please resolve conflicts before merging:"
    echo ""
    echo "  git pull origin $TARGET_BRANCH"
    echo "  # Resolve conflicts"
    echo "  git add ."
    echo "  git commit -m \"merge: resolve conflicts with $TARGET_BRANCH\""

    # 回滚merge尝试
    git merge --abort 2>/dev/null || true
    exit 1
  }

  # 回滚merge尝试
  git merge --abort 2>/dev/null || true

  print_success "No conflicts with $TARGET_BRANCH"
}

# 扫描敏感信息
scan_secrets() {
  print_step "Scanning for sensitive information..."

  # 定义敏感信息模式
  PATTERNS=(
    'password\s*=\s*["\'"'"'].*["\'"'"']'
    'api_key\s*=\s*["\'"'"'].*["\'"'"']'
    'secret\s*=\s*["\'"'"'].*["\'"'"']'
    'token\s*=\s*["\'"'"'].*["\'"'"']'
    'private_key'
  )

  # 检查diff
  DIFF=$(git diff origin/$TARGET_BRANCH...HEAD)

  for pattern in "${PATTERNS[@]}"; do
    if echo "$DIFF" | grep -qE "$pattern"; then
      print_error "Potential secret detected: $pattern"
      echo "$DIFF" | grep -E "$pattern" --color=always
      exit 1
    fi
  done

  # 检查禁止的文件
  FORBIDDEN_FILES=$(git diff origin/$TARGET_BRANCH...HEAD --name-only | grep -E '\.(env|pem|key)$|credentials\.json' || true)

  if [ -n "$FORBIDDEN_FILES" ]; then
    print_error "Forbidden files detected:"
    echo "$FORBIDDEN_FILES"
    exit 1
  fi

  print_success "No sensitive information detected"
}

# 生成验证报告
generate_report() {
  print_step "Generating validation report..."

  REPORT_FILE=".claude/logs/pre-merge-validation-$(date +%Y%m%d-%H%M%S).log"
  mkdir -p .claude/logs

  cat > "$REPORT_FILE" << EOF
Pre-Merge Validation Report
===========================

Date: $(date)
Current Branch: $(git branch --show-current)
Target Branch: $TARGET_BRANCH
Commit: $(git rev-parse HEAD)

Validation Results:
- Git status: PASSED
- Commit messages: PASSED
- Code quality: PASSED
- Tests: PASSED
- Conflicts: NONE
- Security scan: PASSED

Ready to merge: YES
EOF

  print_success "Report saved to $REPORT_FILE"
}

# 主函数
main() {
  echo "====================================="
  echo "  Pre-Merge Validation"
  echo "  Target: $TARGET_BRANCH"
  echo "====================================="
  echo ""

  check_git_status
  validate_commit_messages
  run_quality_checks
  run_tests
  check_conflicts
  scan_secrets
  generate_report

  echo ""
  echo "====================================="
  print_success "All validations passed!"
  echo "====================================="
  echo ""
  echo "Ready to merge to $TARGET_BRANCH"
  echo ""
}

# 执行主函数
main
