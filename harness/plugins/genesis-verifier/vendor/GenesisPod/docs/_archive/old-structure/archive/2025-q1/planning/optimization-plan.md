# GenesisPod 防护网体系优化方案

> **紧急程度**: 🔴 HIGH - 当前生产环境存在严重缺陷，需立即修复
> **制定时间**: 2025-11-21
> **负责人**: 工程团队
> **评审人**: 产品经理 + CTO

---

## 📋 执行摘要

当前系统存在**自动部署到生产环境**的流程，但缺乏充分的质量保障措施。本方案提出**三层防护网体系**，确保代码质量、系统稳定性和业务连续性。

### 当前问题评估

#### 🔴 严重问题（立即修复）

1. **生产环境数据完整性错误** - Foreign key constraint violation
2. **认证系统未启用** - Auth guards被注释，使用硬编码userId
3. **缺少staging环境** - 直接部署到生产
4. **测试不稳定** - Vitest超时导致pre-push hook失败

#### 🟡 中等问题（本周内修复）

5. **缺少回滚机制**
6. **监控和告警不完善**
7. **错误处理不充分**
8. **缺少smoke tests**

#### 🟢 优化建议（2周内完成）

9. **提升测试覆盖率**
10. **完善文档**
11. **性能监控**

---

## 🎯 优化目标

### 短期目标（1周内）

- ✅ 修复生产环境critical bugs
- ✅ 建立staging环境
- ✅ 完善CI/CD流程
- ✅ 启用认证系统

### 中期目标（2-4周）

- ✅ 建立完整的监控告警体系
- ✅ 实现自动化回滚
- ✅ 提升测试覆盖率到80%+
- ✅ 完善错误处理

### 长期目标（1-3个月）

- ✅ 实现灰度发布
- ✅ 建立性能基线和SLO
- ✅ 完善文档体系
- ✅ 实现零停机部署

---

## 🛡️ 三层防护网体系

```
┌─────────────────────────────────────────────────────────┐
│                   第一层：开发时防护                      │
│  - Pre-commit hooks (lint, format, type-check)          │
│  - IDE集成 (ESLint, Prettier, TypeScript)               │
│  - Code review checklist                                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   第二层：提交前防护                      │
│  - Pre-push hooks (tests, build)                        │
│  - GitHub Actions CI (quality, tests, build)            │
│  - Branch protection rules                              │
│  - Required reviews                                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                   第三层：部署时防护                      │
│  - Staging环境验证                                       │
│  - Smoke tests                                          │
│  - Health checks                                        │
│  - 金丝雀/蓝绿部署                                       │
│  - 自动回滚                                              │
│  - 实时监控和告警                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 🚨 紧急修复任务（立即执行）

### 1. 修复生产环境critical bug

#### 问题分析

```typescript
// backend/src/modules/collections/collections.controller.ts:37
const userId = req.user?.id || "557be1bd-62cb-4125-a028-5ba740b66aca";
```

**根本原因**：

- 认证guard被禁用（L24注释）
- 硬编码的userId在数据库中不存在
- 导致foreign key constraint violation

#### 修复方案

**方案A：立即修复（推荐）**

```typescript
// 1. 启用认证guard
@Controller("collections")
@UseGuards(JwtAuthGuard)
export class CollectionsController {
  @Post()
  async createCollection(
    @Request() req: any,
    @Body() dto: CreateCollectionDto,
  ) {
    // 移除fallback，强制要求认证
    if (!req.user?.id) {
      throw new UnauthorizedException("User not authenticated");
    }
    const userId = req.user.id;
    return this.collectionsService.createCollection(userId, dto);
  }
}
```

**方案B：临时缓解（如果认证系统未就绪）**

```typescript
// 1. 创建一个默认用户并seed到数据库
// 2. 使用该用户ID作为fallback
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";

// 3. 在service中添加用户验证
async createCollection(userId: string, dto: CreateCollectionDto) {
  // 验证用户存在
  const user = await this.prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new NotFoundException(`User ${userId} not found`);
  }

  // ... rest of the code
}
```

**执行计划**：

1. [ ] 立即部署修复到生产环境
2. [ ] 验证错误是否消除
3. [ ] 更新错误监控

---

### 2. 修复测试稳定性

#### 问题

```bash
Error: [vitest-pool]: Timeout starting forks runner.
```

#### 修复方案

**A. 修复frontend/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    // 增加超时时间
    testTimeout: 30000,
    hookTimeout: 30000,
    // 优化pool配置
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        timeout: 30000,
      },
    },
    // 改进Vite服务器配置
    server: {
      deps: {
        inline: ["next"],
      },
    },
  },
});
```

**B. 更新pre-push hook**

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# 使用更宽松的超时
CI=true npm run test -- --run --reporter=verbose
```

**C. 添加测试重试机制**

```json
// package.json
{
  "scripts": {
    "test": "npm run test:frontend && npm run test:backend",
    "test:frontend": "cd frontend && npm test -- --retry=2",
    "test:backend": "cd backend && npm test -- --retry=2"
  }
}
```

---

### 3. 建立Staging环境

#### 架构设计

```
┌──────────────────┐
│   Development    │
│   (localhost)    │
└────────┬─────────┘
         │
         ↓ push to develop
┌──────────────────┐
│     Staging      │
│   (Railway)      │  ← 新增环境
│ staging.app.com  │
└────────┬─────────┘
         │
         ↓ merge to main
┌──────────────────┐
│   Production     │
│   (Railway)      │
│   app.com        │
└──────────────────┘
```

#### 实施步骤

**1. 创建Railway Staging环境**

```bash
# 在Railway中创建新的project: deepdive-staging
# 部署配置与production相同，使用独立数据库
```

**2. 更新分支策略**

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging

on:
  push:
    branches: [develop]

jobs:
  deploy:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: npm run test

      - name: Deploy to Railway Staging
        run: |
          railway link ${{ secrets.RAILWAY_STAGING_PROJECT }}
          railway up --service backend
          railway up --service frontend
          railway up --service ai-service

      - name: Run smoke tests
        run: npm run smoke-test -- --env=staging
```

**3. 添加smoke tests**

```typescript
// tests/smoke/smoke.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Smoke Tests - Staging", () => {
  const baseUrl = process.env.STAGING_URL || "https://staging.deepdive.app";

  test("health check", async ({ request }) => {
    const response = await request.get(`${baseUrl}/api/v1/health`);
    expect(response.ok()).toBeTruthy();
  });

  test("frontend loads", async ({ page }) => {
    await page.goto(baseUrl);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("API responds", async ({ request }) => {
    const response = await request.get(`${baseUrl}/api/v1/resources`);
    expect(response.ok()).toBeTruthy();
  });
});
```

**4. 更新部署流程**

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  # 1. 运行所有测试
  test:
    name: Run All Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test
      - run: npm run test:e2e

  # 2. 部署到staging进行最后验证
  deploy-staging:
    name: Verify on Staging
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to staging
        run: railway up --service all --env staging
      - name: Run smoke tests
        run: npm run smoke-test -- --env=staging
      - name: Wait for manual approval
        uses: trstringer/manual-approval@v1
        with:
          secret: ${{ github.TOKEN }}
          approvers: team-leads
          minimum-approvals: 1

  # 3. 部署到production
  deploy-production:
    name: Deploy to Production
    needs: [deploy-staging]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to production
        run: railway up --service all --env production
      - name: Run smoke tests
        run: npm run smoke-test -- --env=production
      - name: Health check
        run: |
          sleep 30
          curl -f https://api.deepdive.app/health || exit 1
```

---

## 🔧 中期优化任务（本周内完成）

### 4. 完善错误处理

#### A. 统一错误处理中间件

```typescript
// backend/src/common/filters/all-exceptions.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let code = "INTERNAL_ERROR";

    // Prisma错误处理
    if (exception instanceof PrismaClientKnownRequestError) {
      switch (exception.code) {
        case "P2002":
          status = HttpStatus.CONFLICT;
          message = "Resource already exists";
          code = "DUPLICATE_ERROR";
          break;
        case "P2003":
          status = HttpStatus.BAD_REQUEST;
          message = "Invalid reference: related record not found";
          code = "FOREIGN_KEY_VIOLATION";
          break;
        case "P2025":
          status = HttpStatus.NOT_FOUND;
          message = "Resource not found";
          code = "NOT_FOUND";
          break;
        default:
          this.logger.error(
            `Unhandled Prisma error: ${exception.code}`,
            exception.message,
          );
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      message =
        typeof errorResponse === "string"
          ? errorResponse
          : (errorResponse as any).message;
      code = (errorResponse as any).error || "HTTP_ERROR";
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error("Uncaught exception", exception.stack);
    }

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      code,
      // 仅在开发环境返回stack trace
      ...(process.env.NODE_ENV === "development" && {
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
    };

    // 记录错误
    this.logger.error(
      `${request.method} ${request.url}`,
      JSON.stringify(errorResponse),
    );

    // 发送到错误监控服务（Sentry等）
    if (status >= 500) {
      this.reportToMonitoring(errorResponse, exception);
    }

    response.status(status).json(errorResponse);
  }

  private reportToMonitoring(error: any, exception: unknown) {
    // TODO: 集成Sentry或其他监控服务
    // Sentry.captureException(exception);
  }
}
```

#### B. 业务错误类

```typescript
// backend/src/common/errors/business.errors.ts
export class BusinessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "BusinessError";
  }
}

export class UserNotFoundError extends BusinessError {
  constructor(userId: string) {
    super("USER_NOT_FOUND", `User ${userId} not found`, 404);
  }
}

export class InvalidUserError extends BusinessError {
  constructor(reason: string) {
    super("INVALID_USER", `Invalid user: ${reason}`, 400);
  }
}
```

---

### 5. 建立监控和告警体系

#### A. 健康检查增强

```typescript
// backend/src/health/health.controller.ts
import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  MongooseHealthIndicator,
} from "@nestjs/terminus";
import { PrismaService } from "../common/prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaHealthIndicator,
    private mongoose: MongooseHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prisma.pingCheck("database"),
      () => this.mongoose.pingCheck("mongodb"),
      // 自定义检查
      async () => ({
        redis: {
          status: await this.checkRedis(),
        },
      }),
    ]);
  }

  @Get("ready")
  @HealthCheck()
  ready() {
    // Kubernetes readiness probe
    return this.health.check([() => this.prisma.pingCheck("database")]);
  }

  @Get("live")
  live() {
    // Kubernetes liveness probe
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  private async checkRedis(): Promise<"up" | "down"> {
    // TODO: 实现Redis健康检查
    return "up";
  }
}
```

#### B. Prometheus metrics

```typescript
// backend/src/metrics/metrics.service.ts
import { Injectable } from "@nestjs/common";
import { Counter, Histogram, Gauge, register } from "prom-client";

@Injectable()
export class MetricsService {
  private httpRequestTotal: Counter;
  private httpRequestDuration: Histogram;
  private activeConnections: Gauge;

  constructor() {
    this.httpRequestTotal = new Counter({
      name: "http_requests_total",
      help: "Total number of HTTP requests",
      labelNames: ["method", "route", "status"],
    });

    this.httpRequestDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "Duration of HTTP requests in seconds",
      labelNames: ["method", "route", "status"],
      buckets: [0.1, 0.5, 1, 2, 5],
    });

    this.activeConnections = new Gauge({
      name: "active_connections",
      help: "Number of active connections",
    });
  }

  recordRequest(
    method: string,
    route: string,
    status: number,
    duration: number,
  ) {
    this.httpRequestTotal.inc({ method, route, status });
    this.httpRequestDuration.observe({ method, route, status }, duration);
  }

  incrementActiveConnections() {
    this.activeConnections.inc();
  }

  decrementActiveConnections() {
    this.activeConnections.dec();
  }

  getMetrics() {
    return register.metrics();
  }
}
```

#### C. 告警规则

```yaml
# monitoring/alerts-production.yml
groups:
  - name: deepdive_alerts
    interval: 30s
    rules:
      # API可用性
      - alert: APIDown
        expr: up{job="deepdive-api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "API is down"
          description: "DeepDive API has been down for more than 1 minute"

      # 错误率
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          /
          sum(rate(http_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is above 5% for the last 5 minutes"

      # 响应时间
      - alert: SlowResponseTime
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket[5m])
          ) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow API response time"
          description: "95th percentile response time is above 2 seconds"

      # 数据库连接
      - alert: DatabaseConnectionPool
        expr: |
          prisma_pool_connections_active
          /
          prisma_pool_connections_max > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database connection pool near limit"

      # 磁盘空间
      - alert: DiskSpaceLow
        expr: |
          (node_filesystem_avail_bytes{mountpoint="/"}
          /
          node_filesystem_size_bytes{mountpoint="/"}) < 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Disk space below 10%"
```

---

### 6. 实现回滚机制

#### A. Railway回滚脚本

```bash
#!/bin/bash
# scripts/rollback.sh

set -e

SERVICE=$1
ENVIRONMENT=${2:-production}

if [ -z "$SERVICE" ]; then
  echo "Usage: ./scripts/rollback.sh <service> [environment]"
  echo "Services: frontend, backend, ai-service"
  exit 1
fi

echo "🔄 Rolling back $SERVICE in $ENVIRONMENT..."

# 获取最后一次成功部署的版本
LAST_GOOD_DEPLOYMENT=$(railway deployments --service $SERVICE --status SUCCESS --limit 2 --json | jq -r '.[1].id')

if [ -z "$LAST_GOOD_DEPLOYMENT" ]; then
  echo "❌ No previous successful deployment found"
  exit 1
fi

echo "📦 Last good deployment: $LAST_GOOD_DEPLOYMENT"
echo "⚠️  This will rollback to the previous version. Continue? (y/N)"
read -r CONFIRM

if [ "$CONFIRM" != "y" ]; then
  echo "❌ Rollback cancelled"
  exit 0
fi

# 执行回滚
railway rollback $LAST_GOOD_DEPLOYMENT --service $SERVICE

echo "✅ Rollback completed"
echo "🔍 Running health checks..."

# 等待部署完成
sleep 30

# 健康检查
HEALTH_URL="https://api.deepdive.app/health"
if [ "$ENVIRONMENT" = "staging" ]; then
  HEALTH_URL="https://staging-api.deepdive.app/health"
fi

HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ "$HEALTH_STATUS" = "200" ]; then
  echo "✅ Health check passed"
else
  echo "❌ Health check failed with status $HEALTH_STATUS"
  exit 1
fi
```

#### B. 自动回滚GitHub Action

```yaml
# .github/workflows/auto-rollback.yml
name: Auto Rollback on Failure

on: deployment_status

jobs:
  check-and-rollback:
    if: github.event.deployment_status.state == 'failure'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Notify team
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -H 'Content-Type: application/json' \
            -d '{
              "text": "🚨 Deployment failed! Initiating auto-rollback...",
              "attachments": [{
                "color": "danger",
                "fields": [{
                  "title": "Service",
                  "value": "${{ github.event.deployment.environment }}",
                  "short": true
                }]
              }]
            }'

      - name: Rollback
        run: |
          ./scripts/rollback.sh ${{ github.event.deployment.environment }}

      - name: Verify rollback
        run: |
          npm run smoke-test -- --env=production

      - name: Notify success
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -H 'Content-Type: application/json' \
            -d '{"text": "✅ Auto-rollback completed successfully"}'
```

---

## 🚀 长期优化建议（2-4周）

### 7. 提升测试覆盖率

#### 目标

- Backend: 80%+ coverage
- Frontend: 70%+ coverage
- Critical paths: 95%+ coverage

#### 实施

**A. 设置覆盖率阈值**

```json
// backend/jest.config.js
module.exports = {
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Critical modules
    './src/modules/collections/**/*.ts': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
```

**B. 集成测试示例**

```typescript
// backend/src/modules/collections/collections.service.spec.ts
describe("CollectionsService", () => {
  let service: CollectionsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CollectionsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get(CollectionsService);
    prisma = module.get(PrismaService);
  });

  describe("createCollection", () => {
    it("should create a collection when user exists", async () => {
      const userId = "valid-user-id";
      const dto = { name: "My Collection" };

      prisma.user.findUnique = jest.fn().resolvedValue({ id: userId });
      prisma.collection.create = jest.fn().resolvedValue({
        id: "collection-id",
        ...dto,
        userId,
      });

      const result = await service.createCollection(userId, dto);

      expect(result).toBeDefined();
      expect(result.name).toBe(dto.name);
    });

    it("should throw NotFoundException when user does not exist", async () => {
      const userId = "invalid-user-id";
      const dto = { name: "My Collection" };

      prisma.user.findUnique = jest.fn().resolvedValue(null);

      await expect(service.createCollection(userId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

**C. E2E测试**

```typescript
// tests/e2e/collections.e2e.spec.ts
describe("Collections E2E", () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // 获取认证token
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "test@example.com", password: "password" });
    authToken = response.body.accessToken;
  });

  it("should create a collection", async () => {
    const response = await request(app.getHttpServer())
      .post("/collections")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Test Collection" })
      .expect(201);

    expect(response.body).toHaveProperty("id");
    expect(response.body.name).toBe("Test Collection");
  });

  afterAll(async () => {
    await app.close();
  });
});
```

---

### 8. 完善CI/CD流程

#### GitHub分支保护规则

```yaml
# 在GitHub仓库设置中配置

main分支保护规则:
  - Require pull request reviews (2 approvals)
  - Require status checks to pass
    * quality-check
    * backend-test
    * frontend-test
    * build
  - Require branches to be up to date
  - Require conversation resolution
  - Require signed commits
  - Restrict who can push (仅admin)

develop分支保护规则:
  - Require pull request reviews (1 approval)
  - Require status checks to pass
  - Require branches to be up to date
```

#### PR模板

```markdown
<!-- .github/pull_request_template.md -->

## 📝 变更描述

<!-- 详细描述本次PR的变更内容 -->

## 🎯 变更类型

- [ ] 🐛 Bug修复
- [ ] ✨ 新功能
- [ ] 🔨 重构
- [ ] 📝 文档更新
- [ ] 🎨 样式调整
- [ ] ⚡️ 性能优化
- [ ] ✅ 测试相关

## 🔗 关联Issue

Closes #

## 🧪 测试

- [ ] 单元测试已通过
- [ ] 集成测试已通过
- [ ] 手动测试已完成
- [ ] 新增测试覆盖变更代码

### 测试步骤

1.
2.
3.

## 📸 截图（如适用）

## ✅ Checklist

- [ ] 代码遵循项目风格指南
- [ ] 已进行self-review
- [ ] 已添加必要的注释
- [ ] 已更新相关文档
- [ ] 无breaking changes，或已在描述中说明
- [ ] 已考虑性能影响
- [ ] 已考虑安全影响

## 🚀 部署说明

- [ ] 需要数据库迁移
- [ ] 需要环境变量更新
- [ ] 需要依赖更新
- [ ] 需要手动操作

<!-- 如有特殊部署说明，请详细描述 -->

## 📚 其他信息

<!-- 任何其他有助于review的信息 -->
```

---

### 9. 性能监控和优化

#### A. 添加性能监控

```typescript
// backend/src/common/interceptors/performance.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;

        // 记录慢查询
        if (duration > 1000) {
          this.logger.warn(`Slow request: ${method} ${url} took ${duration}ms`);
        }

        // 发送到metrics
        metricsService.recordRequest(
          method,
          url,
          context.switchToHttp().getResponse().statusCode,
          duration / 1000,
        );
      }),
    );
  }
}
```

#### B. 数据库查询优化监控

```typescript
// backend/src/common/prisma/prisma.service.ts
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();

    // 监控慢查询
    this.$use(async (params, next) => {
      const start = Date.now();
      const result = await next(params);
      const duration = Date.now() - start;

      // 记录慢查询
      if (duration > 500) {
        this.logger.warn(
          `Slow query detected: ${params.model}.${params.action} took ${duration}ms`,
          JSON.stringify(params.args),
        );
      }

      return result;
    });
  }
}
```

---

### 10. 完善文档体系

#### 文档结构

```
docs/
├── readme.md                     # 项目概览
├── architecture.md               # 架构设计
├── API.md                        # API文档
├── DEPLOYMENT.md                 # 部署指南
├── DEVELOPMENT.md                # 开发指南
├── TROUBLESHOOTING.md            # 故障排查
├── optimization-plan.md          # 本文档
├── CHANGELOG.md                  # 变更日志
└── guides/
    ├── authentication.md         # 认证指南
    ├── database-migrations.md    # 数据库迁移
    ├── testing.md                # 测试指南
    └── monitoring.md             # 监控指南
```

---

## 📊 实施时间表

### Week 1: 紧急修复

| 任务                     | 负责人        | 预计时间 | 状态      |
| ------------------------ | ------------- | -------- | --------- |
| 修复collections auth bug | Backend Team  | 2h       | ⏳ 待开始 |
| 修复vitest超时问题       | Frontend Team | 4h       | ⏳ 待开始 |
| 建立staging环境          | DevOps        | 1天      | ⏳ 待开始 |
| 添加smoke tests          | QA Team       | 1天      | ⏳ 待开始 |

### Week 2: 核心功能

| 任务          | 负责人       | 预计时间 | 状态      |
| ------------- | ------------ | -------- | --------- |
| 完善错误处理  | Backend Team | 2天      | ⏳ 待开始 |
| 建立监控体系  | DevOps       | 3天      | ⏳ 待开始 |
| 实现回滚机制  | DevOps       | 1天      | ⏳ 待开始 |
| 更新CI/CD流程 | DevOps       | 2天      | ⏳ 待开始 |

### Week 3-4: 优化提升

| 任务           | 负责人       | 预计时间 | 状态      |
| -------------- | ------------ | -------- | --------- |
| 提升测试覆盖率 | All Teams    | 1周      | ⏳ 待开始 |
| 性能监控优化   | Backend Team | 3天      | ⏳ 待开始 |
| 完善文档       | All Teams    | 持续     | ⏳ 待开始 |

---

## ✅ 验收标准

### 短期目标（Week 1-2）

- [ ] 生产环境无critical errors
- [ ] Staging环境正常运行
- [ ] CI/CD流程完整无阻塞
- [ ] 所有测试通过率100%
- [ ] 健康检查endpoint正常
- [ ] 监控dashboard可用

### 中期目标（Week 3-4）

- [ ] 测试覆盖率达到80%+
- [ ] 平均响应时间<500ms
- [ ] 错误率<0.1%
- [ ] 部署时间<10分钟
- [ ] 回滚时间<5分钟
- [ ] 文档完整度90%+

### 长期目标（Month 2-3）

- [ ] 零停机部署实现
- [ ] 灰度发布系统上线
- [ ] SLO达成率99%+
- [ ] 自动化程度95%+

---

## 📞 联系方式

| 角色       | 负责人 | 联系方式 |
| ---------- | ------ | -------- |
| 项目经理   | -      | -        |
| 技术负责人 | -      | -        |
| DevOps     | -      | -        |
| 质量保证   | -      | -        |

---

## 📝 变更记录

| 日期       | 版本 | 变更内容 | 修改人 |
| ---------- | ---- | -------- | ------ |
| 2025-11-21 | 1.0  | 初始版本 | Claude |

---

**注意事项**：

1. 所有修改必须经过code review
2. 关键变更需要在staging环境验证至少24小时
3. 生产环境变更需要提前通知相关方
4. 保持文档同步更新
5. 定期review和调整优化方案
