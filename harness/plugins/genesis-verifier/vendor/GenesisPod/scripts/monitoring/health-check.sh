#!/bin/bash

# Monitoring Stack Health Check
# 用法: ./health-check.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查服务
check_service() {
  local name=$1
  local url=$2

  if curl -sf "$url" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ $name${NC}: Running ($url)"
    return 0
  else
    echo -e "${RED}❌ $name${NC}: Not responding ($url)"
    return 1
  fi
}

# 主函数
main() {
  echo "=========================================="
  echo "  Monitoring Stack Health Check"
  echo "=========================================="
  echo ""

  local failed=0

  # 核心服务
  check_service "Prometheus" "http://localhost:9090/-/healthy" || ((failed++))
  check_service "Grafana" "http://localhost:3000/api/health" || ((failed++))
  check_service "AlertManager" "http://localhost:9093/-/healthy" || ((failed++))

  echo ""
  echo "Exporters:"
  check_service "PostgreSQL Exporter" "http://localhost:9187/metrics" || ((failed++))
  check_service "Redis Exporter" "http://localhost:9121/metrics" || ((failed++))
  check_service "MongoDB Exporter" "http://localhost:9216/metrics" || ((failed++))
  check_service "Node Exporter" "http://localhost:9100/metrics" || ((failed++))
  check_service "cAdvisor" "http://localhost:8080/metrics" || ((failed++))

  echo ""
  echo "=========================================="
  if [ $failed -eq 0 ]; then
    echo -e "${GREEN}✅ All services healthy!${NC}"
  else
    echo -e "${RED}❌ $failed service(s) failed${NC}"
  fi
  echo "=========================================="

  return $failed
}

main
