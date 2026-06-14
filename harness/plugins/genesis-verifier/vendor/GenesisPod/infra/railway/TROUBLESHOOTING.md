# Railway 部署故障排查指南

## 问题：无法连接到 `postgres.railway.internal:5432`

### 症状

```
❌ Connection failed!
Error: Can't reach database server at `postgres.railway.internal:5432`
```

### 根本原因

新部署的容器无法访问 Railway 的私有网络（Private Networking）。

---

## 解决方案

### 🔍 步骤 1：检查 DATABASE_URL 配置

1. 打开 **Railway Dashboard**
2. 进入 **Backend 服务** → **Variables**
3. 检查 `DATABASE_URL` 的值

#### ✅ 正确配置（使用变量引用）：

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

#### ❌ 错误配置（硬编码私有网络地址）：

```bash
DATABASE_URL=postgresql://postgres:password@postgres.railway.internal:5432/railway
```

**如果是硬编码的，请改为变量引用格式。**

---

### 🔍 步骤 2：确认服务在同一项目中

1. 在 Railway Dashboard 中，确认：
   - Backend 服务
   - Postgres 服务

   **都在同一个 Project 中**

2. 如果不在同一项目，需要：
   - 创建新的 Postgres 服务在 backend 项目中
   - 或者将 backend 服务移动到 Postgres 所在项目

---

### 🔍 步骤 3：重新链接数据库服务

1. 在 Backend 服务的 **Variables** 中：
   - 删除现有的 `DATABASE_URL`

2. 点击 **New Variable** → **Add Reference**
   - 选择 `Postgres` 服务
   - 选择 `DATABASE_URL` 变量

3. 保存并重新部署

---

### 🔄 方案 A：使用公网连接（临时方案）

如果私有网络持续有问题，可以临时使用公网连接：

1. 进入 **Postgres 服务** → **Connect**
2. 找到 **Public URL** 或 **External Connection String**
3. 复制完整的连接字符串（类似）：
   ```
   postgresql://postgres:password@monorail.proxy.rlwy.net:12345/railway
   ```
4. 在 Backend 服务的 Variables 中，将 `DATABASE_URL` 设置为这个公网地址

⚠️ **注意**：公网连接会消耗更多带宽，且延迟较高，仅用于紧急修复。

---

### 🔄 方案 B：使用 Railway CLI 检查网络

安装 Railway CLI：

```bash
npm install -g @railway/cli
railway login
railway status
```

检查服务状态：

```bash
railway service
railway variables
```

---

### 🔄 方案 C：检查 Prisma 二进制目标

在 `backend/prisma/schema.prisma` 中：

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl", "linux-musl-openssl-3.0.x"]
}
```

确保包含 `linux-musl` 和 `linux-musl-openssl-3.0.x`，这是 Railway 使用的 Alpine Linux 所需的。

---

## 诊断命令

在本地测试数据库连接：

```bash
cd backend
npm run diagnose
```

查看详细的连接信息和错误。

---

## 常见问题

### Q: 为什么旧容器能连接，新容器不能？

A: 可能是：

- Railway 的私有网络配置在旧容器创建后发生了变化
- 环境变量配置在某次部署中被修改
- Railway 平台的网络策略更新

### Q: 为什么使用 `${{Postgres.DATABASE_URL}}`？

A: 这是 Railway 的变量引用语法，Railway 会自动：

- 注入正确的连接字符串（私有网络或公网）
- 在服务重启或迁移时自动更新地址
- 处理服务发现和网络路由

### Q: 如何确认私有网络是否正常？

A: 在部署日志中查找：

```
DATABASE_URL (parsed):
  - Host: postgres.railway.internal  ← 私有网络
  或
  - Host: monorail.proxy.rlwy.net   ← 公网
```

如果显示 `postgres.railway.internal` 但连接失败，说明私有网络有问题。

---

## 联系支持

如果以上方案都无效，需要联系 Railway 支持：

- 在 Railway Dashboard 中提交 Support Ticket
- 提供部署日志和错误信息
- 说明问题：Private Networking 无法在新容器中工作
