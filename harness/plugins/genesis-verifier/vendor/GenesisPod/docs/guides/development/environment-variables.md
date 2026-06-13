# 环境变量配置指南

> 本文档列出所有环境变量及其用途，供开发和部署时参考

---

## 📋 快速配置

### 后端环境变量 (`backend/.env`)

将以下内容复制到 `backend/.env` 文件中并填入实际值：

```bash
# ===================================
# 数据库配置
# ===================================

# PostgreSQL 主数据库
DATABASE_URL="postgresql://genesis:genesis_dev_password@localhost:5432/genesis"

# ===================================
# Redis 缓存（可选）
# ===================================

REDIS_URL="redis://localhost:6379"

# ===================================
# AI 服务配置
# ===================================

# OpenAI API
OPENAI_API_KEY="sk-..."

# Anthropic Claude API
ANTHROPIC_API_KEY="sk-ant-..."

# xAI Grok API
XAI_API_KEY="xai-..."

# ===================================
# JWT 认证
# ===================================

JWT_SECRET="your-secret-key-change-in-production"
JWT_EXPIRES_IN="7d"
JWT_REFRESH_EXPIRES_IN="30d"

# ===================================
# 应用配置
# ===================================

NODE_ENV="development"
PORT=4000
API_PREFIX="api/v1"

# 前端 URL（用于 CORS 和重定向）
FRONTEND_URL="http://localhost:3000"

# ===================================
# FlareSolverr（反爬虫服务）
# ===================================

FLARESOLVERR_URL="http://localhost:8191"
```

### 前端环境变量 (`frontend/.env.local`)

```bash
# 后端 API 地址
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

---

## 📖 详细说明

### 数据库配置

#### DATABASE_URL

**格式**: `postgresql://[用户名]:[密码]@[主机]:[端口]/[数据库名]`

**示例**:

```bash
# 本地开发（Docker）
DATABASE_URL="postgresql://genesis:genesis_dev_password@localhost:5432/genesis"

# 生产环境（Railway）
DATABASE_URL="postgresql://postgres:xxx@containers-us-west-xxx.railway.app:6543/railway"

# 连接池配置
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=20"
```

**必需**: ✅ 是
**环境**: 所有

#### REDIS_URL

**格式**: `redis://[主机]:[端口]` 或 `redis://:[密码]@[主机]:[端口]`

**示例**:

```bash
# 本地开发
REDIS_URL="redis://localhost:6379"

# 生产环境（带密码）
REDIS_URL="redis://:your-password@redis-host:6379"
```

**必需**: ❌ 可选（但推荐）
**用途**: 会话缓存、API 响应缓存

---

### AI 服务配置

#### OPENAI_API_KEY

**格式**: `sk-...`

**获取方式**: https://platform.openai.com/api-keys

**必需**: ✅ 是（如使用 OpenAI 模型）
**用途**: GPT-4, GPT-4o, O1, O3 等模型调用

#### ANTHROPIC_API_KEY

**格式**: `sk-ant-...`

**获取方式**: https://console.anthropic.com/

**必需**: ✅ 是（如使用 Claude 模型）
**用途**: Claude 3.5 Sonnet, Claude Opus 等模型调用

#### XAI_API_KEY

**格式**: `xai-...`

**获取方式**: https://x.ai/api

**必需**: ❌ 可选
**用途**: Grok 模型调用

---

### JWT 认证

#### JWT_SECRET

**格式**: 任意长字符串（建议 32+ 字符）

**生成方式**:

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# OpenSSL
openssl rand -hex 32
```

**示例**:

```bash
JWT_SECRET="a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6"
```

**必需**: ✅ 是
**安全提示**: 生产环境必须使用强随机字符串，切勿硬编码或提交到 Git

#### JWT_EXPIRES_IN

**格式**: 时间字符串

**示例**:

```bash
JWT_EXPIRES_IN="7d"   # 7天
JWT_EXPIRES_IN="24h"  # 24小时
JWT_EXPIRES_IN="30m"  # 30分钟
```

**必需**: ❌ 默认值：7d

#### JWT_REFRESH_EXPIRES_IN

**格式**: 时间字符串

**示例**:

```bash
JWT_REFRESH_EXPIRES_IN="30d"  # 30天
```

**必需**: ❌ 默认值：30d

---

### Google OAuth（可选）

#### GOOGLE_CLIENT_ID

**格式**: `xxx.apps.googleusercontent.com`

**获取方式**: Google Cloud Console → Credentials

**必需**: ❌ 可选（如启用 Google 登录）
**文档**: [Google OAuth 设置指南](../authentication/google-oauth-setup.md)

#### GOOGLE_CLIENT_SECRET

**格式**: `GOCSPX-...`

**获取方式**: Google Cloud Console → Credentials

**必需**: ❌ 可选（与 GOOGLE_CLIENT_ID 配对使用）

#### GOOGLE_CALLBACK_URL

**格式**: `http(s)://[域名]/api/v1/auth/google/callback`

**示例**:

```bash
# 本地开发
GOOGLE_CALLBACK_URL="http://localhost:4000/api/v1/auth/google/callback"

# 生产环境
GOOGLE_CALLBACK_URL="https://api.genesis.com/api/v1/auth/google/callback"
```

**必需**: ❌ 可选

---

### 应用配置

#### NODE_ENV

**可选值**: `development`, `production`, `test`

**用途**:

- 控制日志级别
- 启用/禁用调试功能
- 性能优化开关

**必需**: ✅ 是
**默认值**: development

#### PORT

**格式**: 数字

**示例**:

```bash
PORT=4000
```

**必需**: ❌ 默认值：4000

#### API_PREFIX

**格式**: 字符串（无前导/后缀 `/`）

**示例**:

```bash
API_PREFIX="api/v1"
```

**必需**: ❌ 默认值：api/v1
**结果**: API 路径为 `http://host:port/api/v1/*`

#### FRONTEND_URL

**格式**: 完整 URL

**示例**:

```bash
# 本地开发
FRONTEND_URL="http://localhost:3000"

# 生产环境
FRONTEND_URL="https://genesis.com"
```

**必需**: ✅ 是
**用途**: CORS 配置、OAuth 重定向

---

### FlareSolverr（反爬虫）

#### FLARESOLVERR_URL

**格式**: `http://[主机]:[端口]`

**示例**:

```bash
# Docker Compose
FLARESOLVERR_URL="http://localhost:8191"

# 生产环境
FLARESOLVERR_URL="http://flaresolverr:8191"
```

**必需**: ❌ 可选（如使用数据采集功能）
**用途**: 绕过 Cloudflare 等反爬虫保护

---

### 文件存储（可选）

#### STORAGE_TYPE

**可选值**: `local`, `s3`, `gcs`

**默认值**: `local`

#### 本地存储

```bash
STORAGE_TYPE="local"
UPLOAD_DIR="./uploads"
```

#### AWS S3 存储

```bash
STORAGE_TYPE="s3"
AWS_REGION="us-west-2"
AWS_S3_BUCKET="genesis-files"
AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"
AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
```

---

### CORS 配置

#### CORS_ORIGIN

**格式**: URL 或 `*`

**示例**:

```bash
# 开发环境
CORS_ORIGIN="http://localhost:3000"

# 生产环境（单个域名）
CORS_ORIGIN="https://genesis.com"

# 生产环境（多个域名，逗号分隔）
CORS_ORIGIN="https://genesis.com,https://app.genesis.com"

# 允许所有（不推荐生产环境）
CORS_ORIGIN="*"
```

**必需**: ✅ 是

#### CORS_CREDENTIALS

**可选值**: `true`, `false`

**示例**:

```bash
CORS_CREDENTIALS="true"
```

**必需**: ❌ 默认值：true
**用途**: 允许发送 Cookie 和认证头

---

### 日志配置

#### LOG_LEVEL

**可选值**: `debug`, `info`, `warn`, `error`

**示例**:

```bash
# 开发环境
LOG_LEVEL="debug"

# 生产环境
LOG_LEVEL="info"
```

**必需**: ❌ 默认值：debug (dev) / info (prod)

#### LOG_FORMAT

**可选值**: `pretty`, `json`

**示例**:

```bash
# 开发环境（易读）
LOG_FORMAT="pretty"

# 生产环境（结构化）
LOG_FORMAT="json"
```

**必需**: ❌ 默认值：pretty (dev) / json (prod)

---

### 监控和错误追踪

#### SENTRY_DSN

**格式**: `https://[key]@[project].ingest.sentry.io/[id]`

**获取方式**: Sentry Dashboard → Project Settings → Client Keys

**示例**:

```bash
SENTRY_DSN="https://abc123@o123456.ingest.sentry.io/4567890"
```

**必需**: ❌ 可选（生产环境推荐）
**用途**: 错误追踪和性能监控

#### PROMETHEUS_ENABLED

**可选值**: `true`, `false`

**必需**: ❌ 可选
**用途**: 启用 Prometheus metrics 端点

#### PROMETHEUS_PORT

**格式**: 数字

**示例**:

```bash
PROMETHEUS_PORT=9090
```

**必需**: ❌ 默认值：9090

---

### 邮件服务（可选）

#### SMTP 配置

```bash
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE="false"  # true for 465, false for 587
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
```

**用途**: 发送通知邮件、密码重置等

---

## 🔒 安全最佳实践

### 1. 不要提交敏感信息到 Git

✅ **正确做法**:

```bash
# .gitignore 已包含
.env
.env.local
.env.*.local
```

❌ **错误做法**:

- 不要提交 `.env` 文件
- 不要在代码中硬编码 API 密钥
- 不要在公开仓库中暴露密钥

### 2. 使用强随机密钥

```bash
# 生成 JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. 生产环境使用密钥管理服务

- **Railway**: 使用环境变量管理
- **AWS**: AWS Secrets Manager
- **GCP**: Secret Manager
- **Azure**: Key Vault

### 4. 定期轮换密钥

- JWT_SECRET: 每 3-6 个月
- API Keys: 根据服务提供商建议
- 数据库密码: 每年一次

### 5. 环境隔离

```
开发环境 ← .env
测试环境 ← .env.test
生产环境 ← Railway/云服务商环境变量
```

---

## 📚 相关文档

- [开发指南](./overview.md)
- [部署指南](../deployment/overview.md)
- [Railway 环境配置](../deployment/railway-env-config.md)
- [Google OAuth 设置](../authentication/google-oauth-setup.md)

---

**最后更新**: 2026-01-15
**维护者**: GenesisPod Team
