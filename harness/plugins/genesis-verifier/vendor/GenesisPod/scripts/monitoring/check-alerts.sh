#!/bin/bash

# Check Active Alerts
# 用法: ./check-alerts.sh [--severity <level>] [--service <name>]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 配置
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
SEVERITY_FILTER=""
SERVICE_FILTER=""

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --severity)
      SEVERITY_FILTER="$2"
      shift 2
      ;;
    --service)
      SERVICE_FILTER="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--severity <critical|warning>] [--service <name>]"
      exit 1
      ;;
  esac
done

# 打印函数
print_alert() {
  local severity=$1
  local name=$2
  local emoji=""
  local color=""

  case $severity in
    "critical")
      emoji="🚨"
      color=$RED
      ;;
    "warning")
      emoji="⚠️"
      color=$YELLOW
      ;;
    *)
      emoji="📊"
      color=$BLUE
      ;;
  esac

  echo -e "${color}${emoji} ${severity^^}${NC} - $name"
}

# 获取活跃告警
get_alerts() {
  curl -s "$PROMETHEUS_URL/api/v1/alerts" | jq -r '
    .data.alerts[] |
    select(.state == "firing") |
    {
      name: .labels.alertname,
      severity: .labels.severity,
      service: .labels.service,
      state: .state,
      value: .value,
      started: .activeAt,
      summary: .annotations.summary,
      description: .annotations.description
    }
  '
}

# 格式化时间
format_duration() {
  local started=$1
  local now=$(date -u +%s)
  local started_epoch=$(date -d "$started" +%s 2>/dev/null || echo 0)

  if [ $started_epoch -gt 0 ]; then
    local duration=$((now - started_epoch))
    local minutes=$((duration / 60))
    local hours=$((minutes / 60))
    local days=$((hours / 24))

    if [ $days -gt 0 ]; then
      echo "${days}d ${hours%24}h"
    elif [ $hours -gt 0 ]; then
      echo "${hours}h ${minutes%60}m"
    else
      echo "${minutes}m"
    fi
  else
    echo "N/A"
  fi
}

# 主函数
main() {
  echo "=========================================="
  echo "  Active Alerts Dashboard"
  if [ -n "$SEVERITY_FILTER" ]; then
    echo "  Filter: Severity = $SEVERITY_FILTER"
  fi
  if [ -n "$SERVICE_FILTER" ]; then
    echo "  Filter: Service = $SERVICE_FILTER"
  fi
  echo "=========================================="
  echo ""

  # 获取告警
  local alerts=$(get_alerts)

  if [ -z "$alerts" ]; then
    echo -e "${GREEN}✅ No active alerts!${NC}"
    exit 0
  fi

  # 按严重程度分组
  local critical_alerts=()
  local warning_alerts=()

  while IFS= read -r alert; do
    local severity=$(echo "$alert" | jq -r '.severity')
    local service=$(echo "$alert" | jq -r '.service')

    # 应用过滤器
    if [ -n "$SEVERITY_FILTER" ] && [ "$severity" != "$SEVERITY_FILTER" ]; then
      continue
    fi

    if [ -n "$SERVICE_FILTER" ] && [ "$service" != "$SERVICE_FILTER" ]; then
      continue
    fi

    if [ "$severity" = "critical" ]; then
      critical_alerts+=("$alert")
    else
      warning_alerts+=("$alert")
    fi
  done <<< "$(echo "$alerts" | jq -c '.')"

  # 显示Critical告警
  if [ ${#critical_alerts[@]} -gt 0 ]; then
    echo -e "${RED}🚨 Critical Alerts (${#critical_alerts[@]})${NC}"
    echo "---"

    local index=1
    for alert in "${critical_alerts[@]}"; do
      local name=$(echo "$alert" | jq -r '.name')
      local service=$(echo "$alert" | jq -r '.service')
      local started=$(echo "$alert" | jq -r '.started')
      local summary=$(echo "$alert" | jq -r '.summary')
      local description=$(echo "$alert" | jq -r '.description')

      echo ""
      echo -e "${RED}[$index] $name${NC}"
      echo "    Service: $service"
      echo "    Started: $started"
      echo "    Duration: $(format_duration "$started")"
      echo "    Summary: $summary"
      if [ -n "$description" ] && [ "$description" != "null" ]; then
        echo "    Description: $description"
      fi

      index=$((index + 1))
    done

    echo ""
  fi

  # 显示Warning告警
  if [ ${#warning_alerts[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Warning Alerts (${#warning_alerts[@]})${NC}"
    echo "---"

    local index=1
    for alert in "${warning_alerts[@]}"; do
      local name=$(echo "$alert" | jq -r '.name')
      local service=$(echo "$alert" | jq -r '.service')
      local started=$(echo "$alert" | jq -r '.started')
      local summary=$(echo "$alert" | jq -r '.summary')

      echo ""
      echo -e "${YELLOW}[$index] $name${NC}"
      echo "    Service: $service"
      echo "    Duration: $(format_duration "$started")"
      echo "    Summary: $summary"

      index=$((index + 1))
    done

    echo ""
  fi

  # 总结
  echo "=========================================="
  echo "Total Active Alerts: $((${#critical_alerts[@]} + ${#warning_alerts[@]}))"
  echo "  Critical: ${#critical_alerts[@]}"
  echo "  Warning: ${#warning_alerts[@]}"
  echo "=========================================="
}

# 执行主函数
main
