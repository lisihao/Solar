#!/bin/bash

# Setup Prometheus Monitoring Stack
# 用法: ./setup-prometheus.sh [environment]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
ENVIRONMENT=${1:-staging}
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MONITORING_DIR="$PROJECT_ROOT/monitoring"
CONFIG_DIR="$MONITORING_DIR/config"

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

# 检查依赖
check_dependencies() {
  print_step "Checking dependencies..."

  local missing_deps=()

  if ! command -v docker &> /dev/null; then
    missing_deps+=("docker")
  fi

  if ! command -v docker-compose &> /dev/null; then
    missing_deps+=("docker-compose")
  fi

  if [ ${#missing_deps[@]} -gt 0 ]; then
    print_error "Missing dependencies: ${missing_deps[*]}"
    echo "Please install missing dependencies:"
    echo "  Docker: https://docs.docker.com/get-docker/"
    echo "  Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
  fi

  print_success "All dependencies installed"
}

# 验证配置文件
validate_configs() {
  print_step "Validating configuration files..."

  local config_file="$CONFIG_DIR/prometheus-${ENVIRONMENT}.yml"

  if [ ! -f "$config_file" ]; then
    print_error "Config file not found: $config_file"
    exit 1
  fi

  # 使用promtool验证（如果安装了）
  if command -v promtool &> /dev/null; then
    if promtool check config "$config_file"; then
      print_success "Prometheus config valid"
    else
      print_error "Prometheus config invalid"
      exit 1
    fi
  else
    print_warning "promtool not installed, skipping validation"
  fi

  # 验证告警规则
  local alerts_file="$CONFIG_DIR/alerts/alerts-${ENVIRONMENT}.yml"
  if [ -f "$alerts_file" ]; then
    if command -v promtool &> /dev/null; then
      if promtool check rules "$alerts_file"; then
        print_success "Alert rules valid"
      else
        print_error "Alert rules invalid"
        exit 1
      fi
    fi
  fi
}

# 生成docker-compose配置
generate_docker_compose() {
  print_step "Generating docker-compose.yml..."

  cat > "$MONITORING_DIR/docker-compose.yml" <<EOF
version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    container_name: genesis-prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus-${ENVIRONMENT}.yml:/etc/prometheus/prometheus.yml:ro
      - ./config/alerts:/etc/prometheus/alerts:ro
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
      - '--web.enable-lifecycle'
    networks:
      - monitoring

  grafana:
    image: grafana/grafana:latest
    container_name: genesis-grafana
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - ./config/grafana/datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
      - ./config/grafana/dashboards.yml:/etc/grafana/provisioning/dashboards/dashboards.yml:ro
      - ./config/grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana-data:/var/lib/grafana
    depends_on:
      - prometheus
    networks:
      - monitoring

  alertmanager:
    image: prom/alertmanager:latest
    container_name: genesis-alertmanager
    restart: unless-stopped
    ports:
      - "9093:9093"
    volumes:
      - ./config/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - alertmanager-data:/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
    networks:
      - monitoring

  # Exporters
  postgres-exporter:
    image: quay.io/prometheuscommunity/postgres-exporter:latest
    container_name: genesis-postgres-exporter
    restart: unless-stopped
    ports:
      - "9187:9187"
    environment:
      DATA_SOURCE_NAME: "postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB}?sslmode=disable"
    networks:
      - monitoring
      - genesis-network

  redis-exporter:
    image: oliver006/redis_exporter:latest
    container_name: genesis-redis-exporter
    restart: unless-stopped
    ports:
      - "9121:9121"
    environment:
      REDIS_ADDR: "redis:6379"
    networks:
      - monitoring
      - genesis-network

  mongodb-exporter:
    image: percona/mongodb_exporter:latest
    container_name: genesis-mongodb-exporter
    restart: unless-stopped
    ports:
      - "9216:9216"
    environment:
      MONGODB_URI: "\${MONGODB_URI}"
    networks:
      - monitoring
      - genesis-network

  node-exporter:
    image: prom/node-exporter:latest
    container_name: genesis-node-exporter
    restart: unless-stopped
    ports:
      - "9100:9100"
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    networks:
      - monitoring

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: genesis-cadvisor
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:rw
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    privileged: true
    networks:
      - monitoring

volumes:
  prometheus-data:
  grafana-data:
  alertmanager-data:

networks:
  monitoring:
    driver: bridge
  genesis-network:
    external: true
EOF

  print_success "Docker Compose config generated"
}

# 启动监控栈
start_monitoring_stack() {
  print_step "Starting monitoring stack..."

  cd "$MONITORING_DIR"

  # 拉取镜像
  print_step "Pulling Docker images..."
  docker-compose pull

  # 启动服务
  print_step "Starting services..."
  docker-compose up -d

  # 等待服务启动
  print_step "Waiting for services to start..."
  sleep 10

  print_success "Monitoring stack started"
}

# 健康检查
health_check() {
  print_step "Performing health checks..."

  local all_healthy=true

  # 检查Prometheus
  if curl -sf http://localhost:9090/-/healthy > /dev/null; then
    print_success "Prometheus: Running (http://localhost:9090)"
  else
    print_error "Prometheus: Not responding"
    all_healthy=false
  fi

  # 检查Grafana
  if curl -sf http://localhost:3000/api/health > /dev/null; then
    print_success "Grafana: Running (http://localhost:3000)"
  else
    print_error "Grafana: Not responding"
    all_healthy=false
  fi

  # 检查AlertManager
  if curl -sf http://localhost:9093/-/healthy > /dev/null; then
    print_success "AlertManager: Running (http://localhost:9093)"
  else
    print_error "AlertManager: Not responding"
    all_healthy=false
  fi

  # 检查Exporters
  local exporters=(
    "postgres-exporter:9187"
    "redis-exporter:9121"
    "mongodb-exporter:9216"
    "node-exporter:9100"
    "cadvisor:8080"
  )

  for exporter in "${exporters[@]}"; do
    local name="${exporter%:*}"
    local port="${exporter#*:}"

    if curl -sf "http://localhost:$port/metrics" > /dev/null; then
      print_success "$name: Running ($port)"
    else
      print_warning "$name: Not responding ($port)"
    fi
  done

  if [ "$all_healthy" = true ]; then
    print_success "All core services are healthy"
  else
    print_warning "Some services are not responding"
  fi
}

# 显示访问信息
show_access_info() {
  echo ""
  echo "=========================================="
  echo "  Monitoring Stack Ready!"
  echo "=========================================="
  echo ""
  echo "Access URLs:"
  echo "  Prometheus:    http://localhost:9090"
  echo "  Grafana:       http://localhost:3000 (admin/admin)"
  echo "  AlertManager:  http://localhost:9093"
  echo ""
  echo "Exporters:"
  echo "  PostgreSQL:    http://localhost:9187/metrics"
  echo "  Redis:         http://localhost:9121/metrics"
  echo "  MongoDB:       http://localhost:9216/metrics"
  echo "  Node:          http://localhost:9100/metrics"
  echo "  cAdvisor:      http://localhost:8080"
  echo ""
  echo "Useful Commands:"
  echo "  View logs:     cd monitoring && docker-compose logs -f"
  echo "  Stop stack:    cd monitoring && docker-compose down"
  echo "  Restart:       cd monitoring && docker-compose restart"
  echo ""
}

# 主函数
main() {
  echo "=========================================="
  echo "  Prometheus Monitoring Setup"
  echo "  Environment: $ENVIRONMENT"
  echo "=========================================="
  echo ""

  check_dependencies
  validate_configs
  generate_docker_compose
  start_monitoring_stack
  health_check
  show_access_info
}

# 执行主函数
main
