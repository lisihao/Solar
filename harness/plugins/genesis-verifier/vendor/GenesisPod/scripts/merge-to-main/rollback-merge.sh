#!/bin/bash

# Rollback Merge Script
# 回滚已经合并到主干的代码
# 用法: ./rollback-merge.sh <merge_commit_sha> [branch]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 参数
MERGE_COMMIT=${1}
BRANCH=${2:-develop}

# 打印函数
print_error() {
  echo -e "${RED}[✗]${NC} $1"
}

print_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}[!]${NC} $1"
}

print_step() {
  echo -e "${BLUE}[STEP]${NC} $1"
}

# 检查参数
if [ -z "$MERGE_COMMIT" ]; then
  echo "Usage: $0 <merge_commit_sha> [branch]"
  echo ""
  echo "Example:"
  echo "  $0 abc123def456 develop"
  echo ""
  echo "To find merge commits:"
  echo "  git log --oneline --merges -10"
  exit 1
fi

# 确认提交存在
check_commit_exists() {
  print_step "Checking if commit exists..."

  if ! git rev-parse --verify "$MERGE_COMMIT^{commit}" &>/dev/null; then
    print_error "Commit $MERGE_COMMIT does not exist"
    exit 1
  fi

  print_success "Commit $MERGE_COMMIT exists"
}

# 验证是merge commit
verify_merge_commit() {
  print_step "Verifying merge commit..."

  local parent_count=$(git rev-list --parents -n 1 "$MERGE_COMMIT" | wc -w)

  # merge commit应该有2个或更多父提交
  if [ "$parent_count" -lt 3 ]; then
    print_error "$MERGE_COMMIT is not a merge commit"
    echo "Regular commits cannot be rolled back with this script"
    echo "Use 'git revert $MERGE_COMMIT' for regular commits"
    exit 1
  fi

  print_success "Confirmed as merge commit"
}

# 显示merge信息
show_merge_info() {
  print_step "Merge commit information:"
  echo ""

  git show --stat "$MERGE_COMMIT" | head -20

  echo ""
  echo "---"
  echo ""
}

# 确认回滚
confirm_rollback() {
  print_warning "You are about to rollback the following merge:"
  echo ""

  git log --oneline -1 "$MERGE_COMMIT"

  echo ""
  print_warning "This will create a new commit that undoes all changes from this merge"
  echo ""

  read -p "Continue with rollback? (yes/no): " -r
  echo ""

  if [ "$REPLY" != "yes" ]; then
    echo "Rollback cancelled"
    exit 0
  fi
}

# 执行回滚
perform_rollback() {
  print_step "Performing rollback..."

  # 切换到目标分支
  print_step "Switching to branch $BRANCH..."
  git checkout "$BRANCH"

  # 拉取最新更新
  print_step "Pulling latest changes..."
  git pull origin "$BRANCH"

  # 检查merge commit是否在当前分支
  if ! git branch --contains "$MERGE_COMMIT" | grep -q "^\* $BRANCH"; then
    print_error "Merge commit $MERGE_COMMIT is not in branch $BRANCH"
    exit 1
  fi

  # 执行revert（-m 1保留第一个父提交，即主干分支）
  print_step "Reverting merge commit..."

  if git revert -m 1 "$MERGE_COMMIT" --no-edit; then
    print_success "Revert successful"
  else
    print_error "Revert failed - there may be conflicts"
    echo ""
    echo "Please resolve conflicts manually:"
    echo "  1. Fix conflicted files"
    echo "  2. git add <files>"
    echo "  3. git revert --continue"
    exit 1
  fi

  # 获取revert commit
  local revert_commit=$(git rev-parse HEAD)

  # 自定义revert commit message
  local original_message=$(git log --format=%B -n 1 "$MERGE_COMMIT" | head -1)

  git commit --amend -m "revert: rollback merge - $original_message

Automatically rolled back merge commit: $MERGE_COMMIT

Reason: CI pipeline failure / Manual rollback
Branch: $BRANCH
Rollback time: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

This revert undoes all changes introduced by the merge.
"

  print_success "Revert commit created: $revert_commit"
}

# 推送到远程
push_rollback() {
  print_step "Pushing rollback to remote..."

  read -p "Push to origin/$BRANCH? (yes/no): " -r
  echo ""

  if [ "$REPLY" = "yes" ]; then
    git push origin "$BRANCH"
    print_success "Rollback pushed to remote"
  else
    print_warning "Rollback NOT pushed to remote"
    echo "To push manually later:"
    echo "  git push origin $BRANCH"
  fi
}

# 记录回滚日志
log_rollback() {
  print_step "Recording rollback in audit log..."

  local log_dir=".claude/logs"
  mkdir -p "$log_dir"

  local log_file="$log_dir/merge-rollbacks.jsonl"
  local revert_commit=$(git rev-parse HEAD)

  local log_entry=$(jq -n \
    --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg branch "$BRANCH" \
    --arg merge_commit "$MERGE_COMMIT" \
    --arg revert_commit "$revert_commit" \
    --arg reason "Manual rollback" \
    '{
      timestamp: $timestamp,
      branch: $branch,
      merge_commit: $merge_commit,
      revert_commit: $revert_commit,
      reason: $reason,
      rolled_back_by: "'"$(git config user.email)"'"
    }')

  echo "$log_entry" >> "$log_file"

  print_success "Rollback logged to $log_file"
}

# 显示下一步
show_next_steps() {
  echo ""
  echo "=========================================="
  print_success "Rollback completed successfully!"
  echo "=========================================="
  echo ""
  echo "Next steps:"
  echo ""
  echo "1. Verify the rollback:"
  echo "   git log --oneline -5"
  echo ""
  echo "2. Check the reverted changes:"
  echo "   git show HEAD"
  echo ""
  echo "3. Fix issues in the original feature branch"
  echo ""
  echo "4. When ready, create a new PR with fixes"
  echo ""
}

# 主函数
main() {
  echo "=========================================="
  echo "  Merge Rollback Tool"
  echo "  Target: $BRANCH"
  echo "=========================================="
  echo ""

  check_commit_exists
  verify_merge_commit
  show_merge_info
  confirm_rollback
  perform_rollback
  push_rollback
  log_rollback
  show_next_steps
}

# 执行主函数
main
