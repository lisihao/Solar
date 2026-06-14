#!/bin/bash

# CI/CD Monitoring Script
# 监控GitHub Actions workflow的执行状态
# 用法: ./monitor-ci.sh [branch] [timeout_seconds]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 配置
BRANCH=${1:-develop}
TIMEOUT=${2:-900}  # 默认15分钟
POLL_INTERVAL=10   # 10秒轮询一次

# 检查依赖
check_dependencies() {
  if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) not found${NC}"
    echo "Install from: https://cli.github.com/"
    exit 1
  fi

  if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq not found${NC}"
    echo "Install: npm install -g jq  OR  brew install jq"
    exit 1
  fi
}

# 打印函数
print_header() {
  echo ""
  echo "=========================================="
  echo "  CI/CD Monitoring Dashboard"
  echo "  Branch: $BRANCH"
  echo "  Timeout: ${TIMEOUT}s"
  echo "=========================================="
  echo ""
}

print_status() {
  local status=$1
  local emoji=""
  local color=""

  case $status in
    "queued")
      emoji="⏳"
      color=$YELLOW
      ;;
    "in_progress")
      emoji="🔄"
      color=$CYAN
      ;;
    "completed")
      emoji="✅"
      color=$GREEN
      ;;
    "waiting")
      emoji="⏸️"
      color=$YELLOW
      ;;
    *)
      emoji="❓"
      color=$NC
      ;;
  esac

  echo -e "${color}${emoji} ${status}${NC}"
}

print_conclusion() {
  local conclusion=$1
  local emoji=""
  local color=""

  case $conclusion in
    "success")
      emoji="✅"
      color=$GREEN
      ;;
    "failure")
      emoji="❌"
      color=$RED
      ;;
    "cancelled")
      emoji="⏹️"
      color=$YELLOW
      ;;
    "skipped")
      emoji="⏭️"
      color=$YELLOW
      ;;
    "timed_out")
      emoji="⏱️"
      color=$RED
      ;;
    *)
      emoji="❓"
      color=$NC
      ;;
  esac

  echo -e "${color}${emoji} ${conclusion}${NC}"
}

# 格式化时间
format_duration() {
  local seconds=$1
  local minutes=$((seconds / 60))
  local remaining_seconds=$((seconds % 60))
  printf "%dm %02ds" $minutes $remaining_seconds
}

# 获取最新的workflow run
get_latest_run() {
  gh run list \
    --branch "$BRANCH" \
    --limit 1 \
    --json databaseId,status,conclusion,createdAt,updatedAt \
    --jq '.[0]'
}

# 获取workflow详细信息
get_run_details() {
  local run_id=$1

  gh run view "$run_id" \
    --json status,conclusion,jobs,startedAt,createdAt,updatedAt,url \
    --jq '.'
}

# 显示jobs状态
display_jobs() {
  local run_id=$1
  local run_details=$(get_run_details "$run_id")

  local status=$(echo "$run_details" | jq -r '.status')
  local conclusion=$(echo "$run_details" | jq -r '.conclusion // "N/A"')
  local url=$(echo "$run_details" | jq -r '.url')

  echo -e "${BLUE}Run ID:${NC} $run_id"
  echo -e "${BLUE}URL:${NC} $url"
  echo -e "${BLUE}Status:${NC} $(print_status "$status")"
  if [ "$conclusion" != "N/A" ] && [ "$conclusion" != "null" ]; then
    echo -e "${BLUE}Conclusion:${NC} $(print_conclusion "$conclusion")"
  fi
  echo ""

  # 获取所有jobs
  local jobs=$(echo "$run_details" | jq -r '.jobs')
  local job_count=$(echo "$jobs" | jq 'length')

  echo "Jobs ($job_count):"
  echo "---"

  for i in $(seq 0 $((job_count - 1))); do
    local job=$(echo "$jobs" | jq ".[$i]")
    local name=$(echo "$job" | jq -r '.name')
    local job_status=$(echo "$job" | jq -r '.status')
    local job_conclusion=$(echo "$job" | jq -r '.conclusion // "N/A"')
    local started_at=$(echo "$job" | jq -r '.startedAt // "N/A"')
    local completed_at=$(echo "$job" | jq -r '.completedAt // "N/A"')

    # 计算duration
    local duration="N/A"
    if [ "$started_at" != "N/A" ] && [ "$completed_at" != "N/A" ]; then
      local start_epoch=$(date -d "$started_at" +%s 2>/dev/null || echo 0)
      local end_epoch=$(date -d "$completed_at" +%s 2>/dev/null || echo 0)
      if [ $start_epoch -gt 0 ] && [ $end_epoch -gt 0 ]; then
        duration=$(format_duration $((end_epoch - start_epoch)))
      fi
    elif [ "$started_at" != "N/A" ]; then
      local start_epoch=$(date -d "$started_at" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$started_at" +%s 2>/dev/null || echo 0)
      local now_epoch=$(date +%s)
      if [ $start_epoch -gt 0 ]; then
        duration=$(format_duration $((now_epoch - start_epoch)))
      fi
    fi

    printf "[%d/%d] %-25s " $((i + 1)) "$job_count" "$name"

    if [ "$job_status" = "completed" ]; then
      print_conclusion "$job_conclusion"
      echo -e " ${CYAN}($duration)${NC}"
    else
      print_status "$job_status"
      if [ "$duration" != "N/A" ]; then
        echo -e " ${CYAN}($duration)${NC}"
      else
        echo ""
      fi
    fi
  done

  echo ""
}

# 显示失败的job详情
display_failed_jobs() {
  local run_id=$1

  echo -e "${RED}Failed Jobs Details:${NC}"
  echo "---"

  # 获取失败的steps
  gh run view "$run_id" \
    --json jobs \
    --jq '.jobs[] | select(.conclusion == "failure") | {name: .name, steps: [.steps[] | select(.conclusion == "failure") | {name: .name, number: .number}]}' | \
  jq -r '. | "Job: \(.name)\nFailed Steps:\n  - \(.steps[].name)"'

  echo ""
  echo -e "${CYAN}View full logs:${NC}"
  echo "  gh run view $run_id --log-failed"
  echo ""
  echo -e "${CYAN}Or visit:${NC}"
  gh run view "$run_id" --json url --jq '.url'
  echo ""
}

# 监控workflow
monitor_workflow() {
  print_header

  # 获取最新的run
  echo "Fetching latest workflow run for branch '$BRANCH'..."
  local run_info=$(get_latest_run)

  if [ -z "$run_info" ] || [ "$run_info" = "null" ]; then
    echo -e "${YELLOW}No workflow runs found for branch '$BRANCH'${NC}"
    exit 0
  fi

  local run_id=$(echo "$run_info" | jq -r '.databaseId')
  local elapsed=0

  echo -e "${GREEN}Found workflow run: $run_id${NC}"
  echo ""

  # 监控循环
  while [ $elapsed -lt $TIMEOUT ]; do
    clear
    print_header

    echo -e "${CYAN}Elapsed: $(format_duration $elapsed) / $(format_duration $TIMEOUT)${NC}"
    echo ""

    display_jobs "$run_id"

    # 获取当前状态
    local run_details=$(get_run_details "$run_id")
    local status=$(echo "$run_details" | jq -r '.status')
    local conclusion=$(echo "$run_details" | jq -r '.conclusion // "null"')

    # 检查是否完成
    if [ "$status" = "completed" ]; then
      if [ "$conclusion" = "success" ]; then
        echo "=========================================="
        echo -e "${GREEN}✅ All CI Checks Passed!${NC}"
        echo "=========================================="
        echo ""

        # 记录成功日志
        log_ci_result "$run_id" "success" "$elapsed"

        exit 0
      else
        echo "=========================================="
        echo -e "${RED}❌ CI Pipeline Failed!${NC}"
        echo "=========================================="
        echo ""

        display_failed_jobs "$run_id"

        # 记录失败日志
        log_ci_result "$run_id" "failure" "$elapsed"

        exit 1
      fi
    fi

    # 等待下次轮询
    sleep $POLL_INTERVAL
    elapsed=$((elapsed + POLL_INTERVAL))
  done

  # 超时
  echo "=========================================="
  echo -e "${RED}⏱️  Timeout: Workflow did not complete in $(format_duration $TIMEOUT)${NC}"
  echo "=========================================="

  log_ci_result "$run_id" "timeout" "$elapsed"

  exit 1
}

# 记录CI结果
log_ci_result() {
  local run_id=$1
  local result=$2
  local duration=$3

  local log_dir=".claude/logs"
  mkdir -p "$log_dir"

  local log_file="$log_dir/ci-monitoring.jsonl"

  local log_entry=$(jq -n \
    --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg branch "$BRANCH" \
    --arg run_id "$run_id" \
    --arg result "$result" \
    --arg duration "$duration" \
    '{
      timestamp: $timestamp,
      branch: $branch,
      run_id: $run_id,
      result: $result,
      duration_seconds: ($duration | tonumber)
    }')

  echo "$log_entry" >> "$log_file"
}

# 显示最近的CI历史
show_history() {
  local limit=${1:-10}

  echo "=========================================="
  echo "  Recent CI Runs (last $limit)"
  echo "=========================================="
  echo ""

  gh run list \
    --branch "$BRANCH" \
    --limit "$limit" \
    --json databaseId,status,conclusion,createdAt,workflowName \
    --jq '.[] | "\(.databaseId)\t\(.status)\t\(.conclusion // "N/A")\t\(.createdAt)\t\(.workflowName)"' | \
  while IFS=$'\t' read -r id status conclusion created workflow; do
    local conclusion_display=$([ "$conclusion" = "N/A" ] && echo "$(print_status "$status")" || echo "$(print_conclusion "$conclusion")")
    printf "%-12s %-30s %s %s\n" "$id" "$workflow" "$conclusion_display" "$created"
  done

  echo ""
}

# 主函数
main() {
  check_dependencies

  # 解析参数
  case "${1:-monitor}" in
    "monitor")
      monitor_workflow
      ;;
    "history")
      show_history "${2:-10}"
      ;;
    "logs")
      local run_id=${2:-$(get_latest_run | jq -r '.databaseId')}
      gh run view "$run_id" --log-failed
      ;;
    "view")
      local run_id=${2:-$(get_latest_run | jq -r '.databaseId')}
      get_run_details "$run_id" | jq '.'
      ;;
    *)
      echo "Usage: $0 {monitor|history|logs|view} [options]"
      echo ""
      echo "Commands:"
      echo "  monitor [branch] [timeout]  - Monitor latest workflow run (default)"
      echo "  history [limit]             - Show recent CI runs"
      echo "  logs [run_id]               - Show failed logs for run"
      echo "  view [run_id]               - View run details (JSON)"
      exit 1
      ;;
  esac
}

# 执行主函数
main "$@"
