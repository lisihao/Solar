# 一键部署到 Railway

## 方法1: 一键部署按钮（最简单）

点击下面的按钮直接部署：

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/genesis?referralCode=)

## 方法2: 手动部署步骤

### 1. 打开Railway项目

https://railway.com/project/2521515b-3ddd-4c1e-9fb2-7f2bbe744982

### 2. 添加数据库

1. 点击 **+ New** → **Database** → **PostgreSQL**
2. 点击 **+ New** → **Database** → **Redis**

### 3. 部署后端

1. 点击 **+ New** → **GitHub Repo**
2. 选择 `genesis-agents/GenesisPod`
3. 配置：
   - **Root Directory**: `backend`
   - **Branch**: `main`
4. 添加环境变量（在Variables标签页）：
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   NODE_ENV=production
   JWT_SECRET=your-secret-key-change-this
   ```

### 4. 部署前端

1. 点击 **+ New** → **GitHub Repo**
2. 选择 `genesis-agents/GenesisPod`
3. 配置：
   - **Root Directory**: `frontend`
   - **Branch**: `main`
4. 添加环境变量：
   ```
   NODE_ENV=production
   NEXT_PUBLIC_API_URL=https://<backend-domain>.railway.app
   ```

### 5. 生成域名

1. 点击每个服务 → **Settings** → **Networking**
2. 点击 **Generate Domain**

## 完成！

部署完成后你会得到：

- Frontend: `https://xxx.railway.app`
- Backend: `https://xxx.railway.app`
