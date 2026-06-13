# Deployment Guide - Content Enhancement Features

## 概述

本文档提供内容增强功能的完整部署指南，包括环境配置、数据库迁移、服务部署和监控设置。

---

## 🆕 多环境部署 (规划中)

> 商用发布前的多环境体系建设，确保开发不影响生产。

| 文档                                                                     | 描述                 | 状态      |
| ------------------------------------------------------------------------ | -------------------- | --------- |
| [multi-environment-architecture.md](./multi-environment-architecture.md) | 三环境架构总览       | ⏳ 待实施 |
| [environment-setup-guide.md](./environment-setup-guide.md)               | Railway 环境配置指南 | ⏳ 待实施 |
| [release-workflow.md](./release-workflow.md)                             | 发布流程与 CI/CD     | ⏳ 待实施 |

---

## 部署架构

```
                           ┌─────────────────┐
                           │   Load Balancer  │
                           └────────┬─────────┘
                                    │
                ┌──────────────────┴─────────────────┐
                │                                     │
        ┌───────▼────────┐                  ┌────────▼───────┐
        │  Frontend       │                  │   Backend      │
        │  (Next.js)      │◄─────────────────│   (NestJS)     │
        │  Port: 3000     │                  │   Port: 4000   │
        └─────────────────┘                  └────────┬───────┘
                                                      │
                                ┌─────────────────────┼────────────────┐
                                │                     │                │
                        ┌───────▼────────┐  ┌────────▼───────┐ ┌─────▼──────┐
                        │  PostgreSQL     │  │   Redis        │ │ FlareSolverr│
                        │  Port: 5432     │  │   Port: 6379   │ │ Port: 8191 │
                        └─────────────────┘  └────────────────┘ └────────────┘
```

**架构说明**:

- **数据库**: 统一使用 PostgreSQL (已移除 MongoDB、Neo4j、Qdrant)
- **缓存**: Redis (可选，用于会话和缓存)
- **反爬虫**: FlareSolverr (绕过 Cloudflare 保护)

---

## 环境要求

### 系统要求

- **操作系统:** Linux (Ubuntu 20.04+) / macOS / Windows Server
- **Node.js:** v18.x 或更高
- **PostgreSQL:** v14.x 或更高
- **Redis:** v7.x（可选，用于缓存）
- **Nginx:** v1.18+（推荐）

### 硬件要求

**最低配置:**

- CPU: 2核
- RAM: 4GB
- 磁盘: 20GB SSD

**推荐配置:**

- CPU: 4核+
- RAM: 8GB+
- 磁盘: 50GB+ SSD

---

## 环境变量配置

### 后端环境变量

**backend/.env.production:**

```bash
# 应用配置
NODE_ENV=production
PORT=4000
API_PREFIX=api/v1

# 数据库
DATABASE_URL="postgresql://user:password@db-host:5432/genesis_prod"
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# JWT 认证
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# AI API Keys
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
XAI_API_KEY="xai-..."

# FlareSolverr (反爬虫服务)
FLARESOLVERR_URL="http://flaresolverr:8191"

# Redis（缓存）
REDIS_HOST="redis-host"
REDIS_PORT=6379
REDIS_PASSWORD="your-redis-password"

# 文件存储
STORAGE_TYPE=s3  # 或 local, gcs
AWS_REGION=us-west-2
AWS_S3_BUCKET=genesis-files
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# CORS
CORS_ORIGIN=https://gens.team
CORS_CREDENTIALS=true

# 日志
LOG_LEVEL=info
LOG_FORMAT=json

# 监控
SENTRY_DSN=https://your-sentry-dsn
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
```

### 前端环境变量

**frontend/.env.production:**

```bash
# API配置
NEXT_PUBLIC_API_BASE_URL=https://api.gens.team

# 认证
NEXT_PUBLIC_AUTH_DOMAIN=auth.gens.team

# 分析
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
NEXT_PUBLIC_HOTJAR_ID=123456

# 功能开关
NEXT_PUBLIC_ENABLE_AI=true
NEXT_PUBLIC_ENABLE_GRAPH=true
NEXT_PUBLIC_ENABLE_COMMENTS=true

# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://your-sentry-dsn
```

---

## 数据库部署

### 1. PostgreSQL 设置

**创建生产数据库:**

```sql
-- 创建数据库
CREATE DATABASE genesis_prod;

-- 创建专用用户
CREATE USER genesis_user WITH ENCRYPTED PASSWORD 'your-secure-password';

-- 授予权限
GRANT ALL PRIVILEGES ON DATABASE genesis_prod TO genesis_user;

-- 连接到数据库
\c genesis_prod

-- 授予 schema 权限
GRANT ALL ON SCHEMA public TO genesis_user;
```

**优化配置 (postgresql.conf):**

```conf
# 连接
max_connections = 100
shared_buffers = 256MB

# 性能
effective_cache_size = 1GB
work_mem = 16MB
maintenance_work_mem = 64MB

# WAL
wal_level = replica
max_wal_size = 1GB
min_wal_size = 80MB

# 查询优化
random_page_cost = 1.1  # SSD
effective_io_concurrency = 200

# 日志
logging_collector = on
log_directory = 'pg_log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '
log_min_duration_statement = 1000  # 记录超过1秒的查询
```

### 2. 运行数据库迁移

```bash
cd backend

# 生产环境迁移
DATABASE_URL="postgresql://user:password@host:5432/genesis_prod" \
  npx prisma migrate deploy

# 生成 Prisma Client
npx prisma generate

# 验证迁移
npx prisma migrate status
```

### 3. 创建数据库索引（优化）

```sql
-- Comments 表索引
CREATE INDEX idx_comments_resource_id ON comments(resource_id);
CREATE INDEX idx_comments_parent_id ON comments(parent_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
CREATE INDEX idx_comments_created_at ON comments(created_at DESC);

-- Notes 表索引
CREATE INDEX idx_notes_user_id ON notes(user_id);
CREATE INDEX idx_notes_resource_id ON notes(resource_id);
CREATE INDEX idx_notes_updated_at ON notes(updated_at DESC);

-- 全文搜索索引
CREATE INDEX idx_notes_content_search ON notes USING GIN(to_tsvector('english', content));
```

### 4. 数据库备份策略

```bash
# 每日备份脚本
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/postgres"
DB_NAME="genesis_prod"

# 创建备份
pg_dump -h localhost -U genesis_user -d $DB_NAME \
  -F c -b -v -f "$BACKUP_DIR/backup_$DATE.dump"

# 保留最近30天的备份
find $BACKUP_DIR -name "backup_*.dump" -mtime +30 -delete

# 上传到 S3
aws s3 cp "$BACKUP_DIR/backup_$DATE.dump" \
  s3://genesis-backups/postgres/
```

**Cron 任务:**

```cron
# 每天凌晨2点备份
0 2 * * * /scripts/backup-postgres.sh
```

---

## 后端部署

### 1. 构建应用

```bash
cd backend

# 安装生产依赖
npm ci --only=production

# 构建 TypeScript
npm run build

# 生成 Prisma Client
npx prisma generate
```

### 2. PM2 进程管理

**安装 PM2:**

```bash
npm install -g pm2
```

**PM2 配置 (ecosystem.config.js):**

```javascript
module.exports = {
  apps: [
    {
      name: "genesis-backend",
      script: "./dist/main.js",
      instances: 4, // 4个实例
      exec_mode: "cluster",
      env_production: {
        NODE_ENV: "production",
        PORT: 4000,
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      max_memory_restart: "1G",
      autorestart: true,
      watch: false,
    },
  ],
};
```

**启动服务:**

```bash
# 启动
pm2 start ecosystem.config.js --env production

# 查看状态
pm2 status

# 查看日志
pm2 logs genesis-backend

# 重启
pm2 restart genesis-backend

# 设置开机自启
pm2 startup
pm2 save
```

### 3. Docker 部署（推荐）

**backend/Dockerfile:**

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
COPY prisma ./prisma/

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 构建应用
RUN npm run build

# 生产镜像
FROM node:18-alpine

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# 暴露端口
EXPOSE 4000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# 启动命令
CMD ["node", "dist/main.js"]
```

**docker-compose.yml:**

```yaml
version: "3.8"

services:
  backend:
    build: ./backend
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:password@postgres:5432/genesis_prod
      - AI_SERVICE_URL=http://ai-service:5000
    depends_on:
      - postgres
      - redis
    restart: unless-stopped
    networks:
      - genesis-network

  postgres:
    image: postgres:14-alpine
    environment:
      - POSTGRES_DB=genesis_prod
      - POSTGRES_USER=genesis_user
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - genesis-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    networks:
      - genesis-network
    restart: unless-stopped

  ai-service:
    image: genesis/ai-service:latest
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    networks:
      - genesis-network
    restart: unless-stopped

networks:
  genesis-network:
    driver: bridge

volumes:
  postgres-data:
  redis-data:
```

**部署命令:**

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f backend

# 停止服务
docker-compose down
```

---

## 前端部署

### 1. 构建应用

```bash
cd frontend

# 安装依赖
npm ci

# 构建生产版本
npm run build

# 导出静态文件（如果需要）
npm run export
```

### 2. Next.js Standalone 部署

**next.config.js:**

```javascript
module.exports = {
  output: "standalone",
  // ... 其他配置
};
```

**启动命令:**

```bash
cd .next/standalone
NODE_ENV=production node server.js
```

### 3. Docker 部署

**frontend/Dockerfile:**

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 生产镜像
FROM node:18-alpine

WORKDIR /app

# 复制构建产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]
```

### 4. Nginx 反向代理

**nginx.conf:**

```nginx
upstream backend {
    least_conn;
    server backend:4000;
}

upstream frontend {
    server frontend:3000;
}

server {
    listen 80;
    server_name gens.team www.gens.team;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name gens.team www.gens.team;

    # SSL 配置
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 日志
    access_log /var/log/nginx/genesis_access.log;
    error_log /var/log/nginx/genesis_error.log;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1000;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # API 代理
    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 前端代理
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 静态文件缓存
    location /_next/static {
        proxy_pass http://frontend;
        proxy_cache_valid 60m;
        add_header Cache-Control "public, max-age=3600, immutable";
    }

    # 健康检查
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
```

---

## Kubernetes 部署

### Backend Deployment

**k8s/backend-deployment.yaml:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: genesis-backend
  labels:
    app: genesis-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: genesis-backend
  template:
    metadata:
      labels:
        app: genesis-backend
    spec:
      containers:
        - name: backend
          image: genesis/backend:latest
          ports:
            - containerPort: 4000
          env:
            - name: NODE_ENV
              value: "production"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: genesis-secrets
                  key: database-url
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: genesis-secrets
                  key: jwt-secret
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
          livenessProbe:
            httpGet:
              path: /health
              port: 4000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 4000
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: genesis-backend-service
spec:
  selector:
    app: genesis-backend
  ports:
    - protocol: TCP
      port: 80
      targetPort: 4000
  type: LoadBalancer
```

### Frontend Deployment

**k8s/frontend-deployment.yaml:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: genesis-frontend
  labels:
    app: genesis-frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: genesis-frontend
  template:
    metadata:
      labels:
        app: genesis-frontend
    spec:
      containers:
        - name: frontend
          image: genesis/frontend:latest
          ports:
            - containerPort: 3000
          env:
            - name: NEXT_PUBLIC_API_BASE_URL
              value: "https://api.gens.team"
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: genesis-frontend-service
spec:
  selector:
    app: genesis-frontend
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
  type: LoadBalancer
```

**部署命令:**

```bash
# 创建 secrets
kubectl create secret generic genesis-secrets \
  --from-literal=database-url='postgresql://...' \
  --from-literal=jwt-secret='your-secret'

# 部署
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/frontend-deployment.yaml

# 查看状态
kubectl get pods
kubectl get services

# 查看日志
kubectl logs -f deployment/genesis-backend
```

---

## 监控和日志

### 1. Prometheus + Grafana

**prometheus.yml:**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "genesis-backend"
    static_configs:
      - targets: ["backend:9090"]
    metrics_path: "/metrics"
```

**后端集成:**

```bash
npm install prom-client
```

```typescript
// backend/src/metrics/metrics.service.ts
import { Registry, Counter, Histogram } from "prom-client";

const register = new Registry();

// 请求计数器
const httpRequestCounter = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

// 响应时间直方图
const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route"],
  registers: [register],
});

export { register, httpRequestCounter, httpRequestDuration };
```

### 2. Sentry 错误追踪

**后端配置:**

```typescript
// backend/src/main.ts
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

**前端配置:**

```typescript
// frontend/pages/_app.tsx
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

### 3. 日志聚合（ELK Stack）

**Logstash 配置:**

```conf
input {
  file {
    path => "/var/log/genesis/*.log"
    codec => json
  }
}

filter {
  json {
    source => "message"
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "genesis-%{+YYYY.MM.dd}"
  }
}
```

---

## 性能优化

### 1. 数据库连接池

```typescript
// backend/src/prisma/prisma.service.ts
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ["error", "warn"],
});

// 连接池配置（在 DATABASE_URL 中）
// ?connection_limit=10&pool_timeout=20
```

### 2. Redis 缓存

```typescript
// backend/src/cache/cache.service.ts
import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";

@Injectable()
export class CacheService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD,
    });
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async set(key: string, value: string, ttl: number = 3600): Promise<void> {
    await this.redis.setex(key, ttl, value);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
```

### 3. CDN 配置

**CloudFront 配置:**

```json
{
  "Origins": [
    {
      "DomainName": "gens.team",
      "Id": "genesis-origin",
      "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "https-only"
      }
    }
  ],
  "DefaultCacheBehavior": {
    "TargetOriginId": "genesis-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "managed-caching-optimized",
    "Compress": true
  }
}
```

---

## 安全配置

### 1. 防火墙规则

```bash
# 仅允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# SSH（限制IP）
sudo ufw allow from 192.168.1.0/24 to any port 22

# 启用防火墙
sudo ufw enable
```

### 2. SSL/TLS 证书（Let's Encrypt）

```bash
# 安装 Certbot
sudo apt-get install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d gens.team -d www.gens.team

# 自动续期
sudo certbot renew --dry-run
```

### 3. 环境变量管理

使用 Secret Manager (GCP) 或 AWS Secrets Manager:

```bash
# 存储密钥
gcloud secrets create database-url \
  --data-file=- <<< "postgresql://..."

# 访问密钥
gcloud secrets versions access latest \
  --secret="database-url"
```

---

## 部署检查清单

### 部署前

- [ ] 所有测试通过
- [ ] 代码审查完成
- [ ] 数据库备份已创建
- [ ] 环境变量已配置
- [ ] SSL 证书已安装
- [ ] 监控配置完成
- [ ] 日志系统就绪

### 部署中

- [ ] 运行数据库迁移
- [ ] 构建应用
- [ ] 部署到测试环境
- [ ] 冒烟测试通过
- [ ] 部署到生产环境
- [ ] 健康检查通过

### 部署后

- [ ] 验证所有端点
- [ ] 检查错误日志
- [ ] 监控性能指标
- [ ] 用户验收测试
- [ ] 更新文档
- [ ] 通知团队

---

## 回滚策略

### 快速回滚

```bash
# Docker
docker-compose down
docker-compose up -d --build --force-recreate

# Kubernetes
kubectl rollout undo deployment/genesis-backend
kubectl rollout status deployment/genesis-backend

# PM2
pm2 stop genesis-backend
git checkout <previous-commit>
npm run build
pm2 restart genesis-backend
```

### 数据库回滚

```bash
# 恢复备份
pg_restore -h localhost -U genesis_user \
  -d genesis_prod /backups/backup_20251109.dump

# 回滚迁移（Prisma）
npx prisma migrate resolve --rolled-back <migration-name>
```

---

## 总结

完整的部署流程包括：

✅ 环境配置
✅ 数据库设置和迁移
✅ 后端部署（PM2/Docker/K8s）
✅ 前端部署（Next.js/Docker）
✅ Nginx 反向代理
✅ 监控和日志（Prometheus/Sentry/ELK）
✅ 性能优化（缓存/CDN）
✅ 安全配置（SSL/防火墙）
✅ 备份和回滚策略

**推荐部署方案：**

- 开发/测试：Docker Compose
- 生产环境：Kubernetes + 云服务（AWS/GCP）
- CI/CD：GitHub Actions + ArgoCD
