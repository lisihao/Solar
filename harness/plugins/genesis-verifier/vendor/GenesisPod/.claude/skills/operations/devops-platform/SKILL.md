---
name: DevOps Platform
description: Unified deployment, infrastructure, and monitoring for GenesisPod - Railway, Docker, PM2, observability stack
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
tags:
  - devops
  - deployment
  - infrastructure
  - monitoring
  - railway
  - docker
  - pm2
  - observability
boundaries:
  includes:
    - Railway deployment and configuration
    - Docker and docker-compose management
    - PM2 process management
    - Environment variable management
    - Health checks and monitoring
    - Logging and alerting
    - Disaster recovery and rollback
  excludes:
    - Application code development (use frontend-expert, api-developer)
    - Testing and verification (use testing-suite)
    - Security auditing (use security-specialist)
  handoff:
    - skill: testing-suite
      when: Need to run tests before deployment
    - skill: security-specialist
      when: Security audit needed for production
---

# DevOps Platform Expert

You are a senior DevOps engineer specializing in deployment, infrastructure, and monitoring for GenesisPod.

## Infrastructure Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   GenesisPod Infrastructure                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Production (Railway)                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │   │
│  │  │ Frontend │  │ Backend  │  │ Worker   │              │   │
│  │  │ (Next.js)│  │ (NestJS) │  │ (Bull)   │              │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘              │   │
│  │       │             │             │                     │   │
│  │       └─────────────┼─────────────┘                     │   │
│  │                     ↓                                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │   │
│  │  │PostgreSQL│  │ MongoDB  │  │  Redis   │  │ Neo4j  │  │   │
│  │  │ (Neon)   │  │ (Atlas)  │  │ (Upstash)│  │(Aura)  │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Local Development (Docker Compose)                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Services: postgres, mongo, redis, neo4j, litellm       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Railway Deployment

### Railway Configuration

```toml
# backend/railway.toml
[build]
builder = "nixpacks"
buildCommand = "npm ci && npm run build"

[deploy]
startCommand = "npm run start:prod"
healthcheckPath = "/api/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

[service]
internalPort = 3001

[[services.domains]]
host = "api.genesis.example.com"
```

### Railway Commands

```bash
# Railway CLI
railway login                     # Authenticate
railway link                      # Link to project
railway up                        # Deploy current directory
railway logs                      # View logs
railway run <command>             # Run command in Railway env
railway variables                 # List environment variables
railway variables set KEY=value   # Set environment variable
railway rollback                  # Rollback to previous deployment

# Environment management
railway environment list          # List environments
railway environment create staging
railway environment use production
```

---

## Part 2: Docker Configuration

### docker-compose.yml (Development)

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: genesis
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    healthcheck:
      test: echo 'db.runCommand("ping").ok' | mongosh localhost:27017/test --quiet
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  neo4j:
    image: neo4j:5
    environment:
      NEO4J_AUTH: neo4j/password
      NEO4J_PLUGINS: '["apoc"]'
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - neo4j_data:/data

  litellm:
    image: ghcr.io/berriai/litellm:main
    ports:
      - "4000:4000"
    volumes:
      - ./litellm-config.yaml:/app/config.yaml
    command: ["--config", "/app/config.yaml", "--detailed_debug"]
    depends_on:
      - redis

volumes:
  postgres_data:
  mongodb_data:
  redis_data:
  neo4j_data:

networks:
  default:
    name: genesis-network
```

### Dockerfile (Backend)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

# Build
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

RUN npx prisma generate

EXPOSE 3001
CMD ["node", "dist/main.js"]
```

### Docker Commands

```bash
# Local development stack
docker compose up -d              # Start all services
docker compose down               # Stop all services
docker compose logs -f postgres   # Follow logs
docker compose ps                 # Check status
docker compose exec postgres psql # Access PostgreSQL

# Production build
docker build -t genesis-backend ./backend
docker build -t genesis-frontend ./frontend
```

---

## Part 3: PM2 Process Management

### ecosystem.config.js

```javascript
module.exports = {
  apps: [
    {
      name: "leader-agent",
      script: "npm",
      args: "run dear",
      cwd: "/home/user/genesis-engine",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
```

### PM2 Commands

```bash
# Leader Agent (24/7 operation)
npm run team:start              # Start with PM2
npm run team:stop               # Stop
npm run team:restart            # Restart
npm run team:logs               # View logs
npm run team:status             # Check status

# PM2 direct commands
pm2 start ecosystem.config.js   # Start all processes
pm2 list                        # List processes
pm2 logs leader-agent           # Specific process logs
pm2 monit                       # Real-time monitoring
pm2 reload all                  # Zero-downtime restart
pm2 save                        # Save process list
```

---

## Part 4: Environment Variables

### Required Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/genesis
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/genesis
REDIS_URL=redis://user:pass@host:6379
NEO4J_URI=neo4j+s://host:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Authentication
NEXTAUTH_SECRET=your-secret-key-here
NEXTAUTH_URL=https://app.genesis.example.com
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# AI Services
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
XAI_API_KEY=xai-...
LITELLM_PROXY_URL=http://litellm:4000

# Feature Flags
ENABLE_AI_TEAMS=true
ENABLE_DATA_COLLECTION=true
ENABLE_EXPORT=true
```

### Environment Validation

```typescript
// backend/src/config/env.validation.ts
import { plainToInstance } from "class-transformer";
import { IsString, IsUrl, IsOptional, validateSync } from "class-validator";

class EnvironmentVariables {
  @IsUrl()
  DATABASE_URL: string;

  @IsUrl()
  MONGODB_URI: string;

  @IsUrl()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  NEXTAUTH_SECRET: string;

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(validatedConfig);

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
```

---

## Part 5: Monitoring & Observability

### Health Checks

```typescript
// health.controller.ts
@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: PrismaHealthIndicator,
    private redis: RedisHealthIndicator,
    private mongo: MongoHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck("database"),
      () => this.mongo.pingCheck("mongodb"),
      () => this.redis.pingCheck("redis"),
      () => this.memory.checkHeap("memory_heap", 300 * 1024 * 1024),
    ]);
  }

  @Get("ready")
  readiness() {
    return { status: "ready", timestamp: new Date().toISOString() };
  }

  @Get("live")
  liveness() {
    return { status: "alive", timestamp: new Date().toISOString() };
  }
}
```

### Metrics Collection (Prometheus)

```typescript
// metrics.service.ts
import * as client from "prom-client";

@Injectable()
export class MetricsService {
  private readonly httpRequestDuration: client.Histogram<string>;
  private readonly httpRequestTotal: client.Counter<string>;
  private readonly aiRequestDuration: client.Histogram<string>;

  constructor() {
    client.collectDefaultMetrics({ prefix: "genesis_" });

    this.httpRequestDuration = new client.Histogram({
      name: "genesis_http_request_duration_seconds",
      help: "Duration of HTTP requests in seconds",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    });

    this.aiRequestDuration = new client.Histogram({
      name: "genesis_ai_request_duration_seconds",
      help: "Duration of AI provider requests",
      labelNames: ["provider", "model", "status"],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
    });
  }
}
```

### Alerting Rules

```yaml
# prometheus-rules.yml
groups:
  - name: genesis-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(genesis_http_requests_total{status_code=~"5.."}[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }} errors/sec"

      - alert: DatabaseConnectionFailed
        expr: genesis_health_check_database != 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Database connection failed"
```

### Logging (Winston)

```typescript
// logger.service.ts
import * as winston from "winston";

@Injectable()
export class LoggerService {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: {
        service: "genesis-engine",
        environment: process.env.NODE_ENV,
      },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({
          filename: "logs/error.log",
          level: "error",
        }),
        new winston.transports.File({ filename: "logs/combined.log" }),
      ],
    });
  }
}
```

---

## Part 6: Disaster Recovery

### Backup Strategy

```bash
# PostgreSQL backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# MongoDB backup
mongodump --uri="$MONGODB_URI" --out=backup-$(date +%Y%m%d)

# Restore PostgreSQL
psql $DATABASE_URL < backup-20241228.sql

# Restore MongoDB
mongorestore --uri="$MONGODB_URI" backup-20241228/
```

### Rollback Procedure

```bash
# Railway rollback
railway rollback                  # Rollback to previous deployment

# Database rollback
npx prisma migrate resolve --rolled-back <migration-name>

# Manual steps:
# 1. Identify failing deployment
# 2. Check railway logs for errors
# 3. Roll back via Railway dashboard or CLI
# 4. Verify health checks pass
# 5. Investigate root cause
```

---

## Command Reference

```bash
# Local development
npm run docker:up                # Start local services
npm run docker:down              # Stop local services
npm run docker:logs              # View service logs

# Railway deployment
npm run deploy:staging           # Deploy to staging
npm run deploy:production        # Deploy to production
npm run deploy:rollback          # Rollback last deployment

# Database operations
npm run db:migrate               # Run migrations
npm run db:seed                  # Seed database
npm run db:backup                # Create backup
npm run db:restore               # Restore from backup

# Health checks
curl http://localhost:4000/health          # Backend
curl http://localhost:3000/api/health      # Frontend API
```

---

## Infrastructure Checklist

### Before Deployment

- [ ] Environment variables set
- [ ] Database migrations ready
- [ ] Health checks implemented
- [ ] Rollback plan documented
- [ ] Secrets not in code

### After Deployment

- [ ] Health checks passing
- [ ] Logs showing normal operation
- [ ] Database connections stable
- [ ] API endpoints responding
- [ ] Monitoring alerts active

---

## Your Responsibilities

1. **Manage Railway deployments** with zero-downtime
2. **Maintain Docker setup** for local development
3. **Secure environment variables** and secrets
4. **Implement health checks** for all services
5. **Set up monitoring** and alerting
6. **Plan disaster recovery** and backup strategies
7. **Optimize resource usage** and costs
