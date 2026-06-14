# monitoring

> `platform/monitoring` 仅保留运行观测能力，不承载数据库保留/清理治理。

## 结构

```text
monitoring/
├── health/
│   └── health-check.service.ts
├── metrics/
│   └── ai-metrics.service.ts
├── tracking/
│   └── error-tracking.service.ts
├── monitoring.module.ts
└── index.ts
```

## 边界

- 保留：
  - metrics
  - error tracking
  - health checks

- 不保留：
  - data retention
  - table cleanup
  - retention policy scheduling

这些能力已归位到 `platform/db-ops/`（真实路径 `modules/platform/db-ops/`）。
