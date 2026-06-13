#!/bin/bash

# Validate Monitoring Configurations
# 用法: ./validate-config.sh [type]
# type: prometheus | alerts | grafana | all (default: all)

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
TYPE=${1:-all}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_DIR="$PROJECT_ROOT/monitoring/config"

# 打印函数
print_step() {
  echo -e "${BLUE}[VALIDATING]${NC} $1"
}

print_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

print_error() {
  echo -e "${RED}[✗]${NC} $1"
}

# 验证Prometheus配置
validate_prometheus() {
  print_step "Prometheus configuration..."

  local config_files=("$CONFIG_DIR/prometheus-staging.yml" "$CONFIG_DIR/prometheus-production.yml")

  for config_file in "${config_files[@]}"; do
    if [ ! -f "$config_file" ]; then
      print_error "Config file not found: $config_file"
      return 1
    fi

    # YAML语法检查
    if ! python3 -c "import yaml; yaml.safe_load(open('$config_file'))" 2>/dev/null; then
      print_error "Invalid YAML: $config_file"
      return 1
    fi

    # 使用promtool（如果可用）
    if command -v promtool &> /dev/null; then
      if promtool check config "$config_file" > /dev/null 2>&1; then
        print_success "$(basename $config_file): Valid"
      else
        print_error "$(basename $config_file): Invalid"
        promtool check config "$config_file"
        return 1
      fi
    else
      print_success "$(basename $config_file): YAML syntax OK"
    fi
  done

  return 0
}

# 验证告警规则
validate_alerts() {
  print_step "Alert rules..."

  local alert_files=("$CONFIG_DIR/alerts/"*.yml)

  for alert_file in "${alert_files[@]}"; do
    if [ ! -f "$alert_file" ]; then
      continue
    fi

    # YAML语法检查
    if ! python3 -c "import yaml; yaml.safe_load(open('$alert_file'))" 2>/dev/null; then
      print_error "Invalid YAML: $alert_file"
      return 1
    fi

    # 使用promtool
    if command -v promtool &> /dev/null; then
      if promtool check rules "$alert_file" > /dev/null 2>&1; then
        local rule_count=$(grep -c "alert:" "$alert_file" || echo 0)
        print_success "$(basename $alert_file): Valid ($rule_count rules)"
      else
        print_error "$(basename $alert_file): Invalid"
        promtool check rules "$alert_file"
        return 1
      fi
    else
      print_success "$(basename $alert_file): YAML syntax OK"
    fi
  done

  return 0
}

# 验证Grafana配置
validate_grafana() {
  print_step "Grafana configuration..."

  local grafana_files=(
    "$CONFIG_DIR/grafana/datasources.yml"
    "$CONFIG_DIR/grafana/dashboards.yml"
  )

  for grafana_file in "${grafana_files[@]}"; do
    if [ ! -f "$grafana_file" ]; then
      print_error "Config file not found: $grafana_file"
      return 1
    fi

    if ! python3 -c "import yaml; yaml.safe_load(open('$grafana_file'))" 2>/dev/null; then
      print_error "Invalid YAML: $grafana_file"
      return 1
    fi

    print_success "$(basename $grafana_file): Valid"
  done

  # 检查dashboard JSON文件
  local dashboard_dir="$CONFIG_DIR/grafana/dashboards"
  if [ -d "$dashboard_dir" ]; then
    local dashboard_count=$(find "$dashboard_dir" -name "*.json" | wc -l)
    if [ $dashboard_count -gt 0 ]; then
      print_success "Found $dashboard_count dashboard(s)"
    fi
  fi

  return 0
}

# 主函数
main() {
  echo "=========================================="
  echo "  Configuration Validation"
  echo "  Type: $TYPE"
  echo "=========================================="
  echo ""

  local failed=0

  case $TYPE in
    prometheus)
      validate_prometheus || ((failed++))
      ;;
    alerts)
      validate_alerts || ((failed++))
      ;;
    grafana)
      validate_grafana || ((failed++))
      ;;
    all)
      validate_prometheus || ((failed++))
      validate_alerts || ((failed++))
      validate_grafana || ((failed++))
      ;;
    *)
      echo "Unknown type: $TYPE"
      echo "Usage: $0 [prometheus|alerts|grafana|all]"
      exit 1
      ;;
  esac

  echo ""
  echo "=========================================="
  if [ $failed -eq 0 ]; then
    echo -e "${GREEN}✅ All configurations valid!${NC}"
  else
    echo -e "${RED}❌ Validation failed${NC}"
  fi
  echo "=========================================="

  return $failed
}

main
