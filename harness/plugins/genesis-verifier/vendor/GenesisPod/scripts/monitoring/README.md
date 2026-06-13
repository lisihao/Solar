# Monitoring Configuration

生产环境监控系统配置目录。

## 目录结构

```
scripts/monitoring/
├── config/                      # 配置文件
│   ├── prometheus-staging.yml   # Prometheus配置（Staging）
│   ├── prometheus-production.yml # Prometheus配置（Production）
│   │
│   ├── alerts/                  # 告警规则
│   │   ├── alerts-staging.yml   # Staging环境告警
│   │   ├── backend.yml          # Backend服务告警
│   │   ├── database.yml         # 数据库告警
│   │   ├── cache.yml            # 缓存告警
│   │   └── infrastructure.yml   # 基础设施告警
│   │
│   ├── grafana/                 # Grafana配置
│   │   ├── datasources.yml      # 数据源配置
│   │   ├── dashboards.yml       # Dashboard配置
│   │   └── dashboards/          # Dashboard JSON文件
│   │       ├── overview.json
│   │       ├── backend-api.json
│   │       ├── database.json
│   │       └── business.json
│   │
│   └── alertmanager/            # AlertManager配置
│       └── alertmanager.yml
│
├── docker-compose.yml           # 监控栈部署配置（自动生成）
└── README.md                    # 本文件
```

## 快速开始

### 1. 部署监控系统

```bash
# 使用monitoring agent（推荐）
# 在Claude Code中：
"请帮我部署监控系统到staging环境"

# 或手动执行脚本
./scripts/monitoring/setup-prometheus.sh staging
```

### 2. 访问监控界面

部署完成后，访问：

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/admin)
- **AlertManager**: http://localhost:9093

### 3. 健康检查

```bash
./scripts/monitoring/health-check.sh
```

### 4. 查看告警

```bash
# 查看所有告警
./scripts/monitoring/check-alerts.sh

# 查看Critical告警
./scripts/monitoring/check-alerts.sh --severity critical

# 查看特定服务告警
./scripts/monitoring/check-alerts.sh --service backend
```

---

## 配置文件说明

### Prometheus配置

**staging环境** (`config/prometheus-staging.yml`):

- 采集间隔: 15秒
- 数据保留: 7天
- 告警阈值: 相对宽松

**production环境** (`config/prometheus-production.yml`):

- 采集间隔: 10秒
- 数据保留: 30天
- 告警阈值: 严格
- 高可用配置

### 告警规则

**Critical告警**（1分钟触发）:

- BackendDown - Backend服务宕机
- PostgresDown - 数据库不可用
- RedisDown - 缓存服务宕机

**Warning告警**（5分钟触发）:

- HighErrorRate - 错误率 > 5%
- HighLatency - P95延迟 > 1秒
- HighMemoryUsage - 内存使用 > 85%
- PostgresHighConnections - 数据库连接数 > 80

完整列表见: `config/alerts/alerts-staging.yml`

### Grafana Dashboards

1. **Overview Dashboard** - 系统总览
   - 服务健康状态
   - 关键指标卡片
   - 请求速率、错误率、延迟趋势

2. **Backend API Dashboard** - 后端监控
   - 接口性能分析
   - 错误分布
   - 慢接口排行

3. **Database Dashboard** - 数据库监控
   - 连接数趋势
   - 慢查询分析
   - 磁盘使用情况

4. **Business Metrics Dashboard** - 业务指标
   - 用户活跃度
   - 资源采集速率
   - AI处理队列

---

## 环境差异

| 配置项        | Staging | Production |
| ------------- | ------- | ---------- |
| 采集间隔      | 15s     | 10s        |
| 数据保留      | 7天     | 30天       |
| 错误率阈值    | 5%      | 1%         |
| 延迟阈值(P95) | 1s      | 500ms      |
| 内存告警阈值  | 90%     | 85%        |
| 高可用        | 单实例  | 多实例     |

---

## 告警集成

### Slack通知

编辑 `config/alertmanager/alertmanager.yml`:

```yaml
receivers:
  - name: "slack"
    slack_configs:
      - api_url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
        channel: "#alerts"
        title: "{{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.description }}{{ end }}"
```

### Email通知

```yaml
receivers:
  - name: "email"
    email_configs:
      - to: "team@example.com"
        from: "alertmanager@example.com"
        smarthost: "smtp.gmail.com:587"
        auth_username: "alertmanager@example.com"
        auth_password: "your-password"
```

---

## 自定义配置

### 添加新的监控目标

编辑 `config/prometheus-staging.yml`:

```yaml
scrape_configs:
  - job_name: "my-service"
    static_configs:
      - targets: ["my-service:9000"]
    scrape_interval: 15s
```

### 添加新的告警规则

在 `config/alerts/` 目录创建新文件或编辑现有文件:

```yaml
groups:
  - name: my_alerts
    rules:
      - alert: MyCustomAlert
        expr: my_metric > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Custom metric too high"
          description: "my_metric is {{ $value }}"
```

### 创建自定义Dashboard

1. 在Grafana UI中创建Dashboard
2. 导出JSON
3. 保存到 `config/grafana/dashboards/`
4. Grafana会自动加载

---

## 故障排查

### Prometheus无法启动

```bash
# 检查配置文件
./scripts/monitoring/validate-config.sh prometheus

# 查看日志
cd scripts/monitoring && docker-compose logs prometheus
```

### Exporter无法连接

```bash
# 检查网络
docker network inspect genesis-network

# 测试连接
docker exec genesis-prometheus curl -sf http://postgres-exporter:9187/metrics
```

### 告警未触发

```bash
# 检查规则加载
curl http://localhost:9090/api/v1/rules

# 测试查询
curl 'http://localhost:9090/api/v1/query?query=up{job="genesis-backend"}'
```

---

## 性能调优

### 减少采集开销

```yaml
# 增加采集间隔
global:
  scrape_interval: 30s # 从15s增加到30s

# 减少保留时间
command:
  - "--storage.tsdb.retention.time=15d" # 从30d减少到15d
```

### 优化查询性能

```promql
# 使用recording rules预计算
groups:
  - name: recording_rules
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: rate(http_requests_total[5m])
```

---

## 最佳实践

1. **定期审查告警**
   - 每周检查告警频率
   - 调整阈值避免告警疲劳
   - 移除无用告警

2. **Dashboard维护**
   - 保持Dashboard简洁
   - 关注关键指标
   - 定期更新和优化

3. **数据保留策略**
   - Staging: 7天
   - Production: 30天
   - 长期存储使用Thanos或Cortex

4. **安全性**
   - 启用Grafana认证
   - 使用HTTPS
   - 限制Prometheus API访问

---

## 相关文档

- [Monitoring Agent文档](../../.claude/agents/monitoring.md)
- [Scripts使用指南](../README.md)
- [Prometheus文档](https://prometheus.io/docs/)
- [Grafana文档](https://grafana.com/docs/)

---

**维护者**: DevOps Team
**最后更新**: 2025-11-23
