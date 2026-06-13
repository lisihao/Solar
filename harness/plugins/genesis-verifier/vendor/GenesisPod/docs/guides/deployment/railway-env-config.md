# Railway 生产环境变量配置

## 后端环境变量 (Backend Service)

在 Railway 后端服务的环境变量中设置：

```bash
# Google OAuth Configuration - PRODUCTION
GOOGLE_CLIENT_ID=<从Google Cloud Console获取的Client ID>
GOOGLE_CLIENT_SECRET=<从Google Cloud Console获取的Client Secret>
GOOGLE_CALLBACK_URL=https://backend-production-8638.up.railway.app/api/v1/auth/google/callback

# Frontend URL - PRODUCTION
FRONTEND_URL=https://frontend-production-af8e.up.railway.app
```

**注意**: 使用你在 Google Cloud Console 中创建的实际凭据替换占位符

## 前端环境变量 (Frontend Service)

在 Railway 前端服务的环境变量中设置：

```bash
# Backend API URL - PRODUCTION
NEXT_PUBLIC_API_URL=https://backend-production-8638.up.railway.app
```

## 配置步骤

### 1. 配置后端环境变量

1. 登录 [Railway Dashboard](https://railway.app/)
2. 选择 genesis-ai 项目
3. 选择 Backend 服务
4. 点击 "Variables" 标签
5. 点击 "New Variable"
6. 添加以下变量（使用你的实际凭据）：
   - `GOOGLE_CLIENT_ID`: 从Google Cloud Console复制的Client ID
   - `GOOGLE_CLIENT_SECRET`: 从Google Cloud Console复制的Client Secret
   - `GOOGLE_CALLBACK_URL`: `https://backend-production-8638.up.railway.app/api/v1/auth/google/callback`
   - `FRONTEND_URL`: `https://frontend-production-af8e.up.railway.app`

### 2. 配置前端环境变量

1. 在 Railway Dashboard 中
2. 选择 Frontend 服务
3. 点击 "Variables" 标签
4. 点击 "New Variable"
5. 添加：
   - `NEXT_PUBLIC_API_URL`: `https://backend-production-8638.up.railway.app`

### 3. 重新部署

配置完成后，Railway 会自动重新部署服务。

## 本地开发环境

本地开发使用 `backend/.env` 文件中的配置：

```bash
# Google OAuth Configuration - LOCAL
GOOGLE_CLIENT_ID=<你的Client ID>
GOOGLE_CLIENT_SECRET=<你的Client Secret>
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/callback

# Frontend URL - LOCAL
FRONTEND_URL=http://localhost:3000
```

**注意**: 将 `backend/.env` 文件中的占位符替换为你的实际 Google OAuth 凭据

## 验证配置

### 生产环境测试

1. 访问 https://frontend-production-af8e.up.railway.app
2. 点击右上角的 "Login" 按钮
3. 选择 Google 账户授权
4. 应该会自动跳转回生产环境并显示登录状态

### 本地环境测试

1. 访问 http://localhost:3000
2. 点击右上角的 "Login" 按钮
3. 选择 Google 账户授权
4. 应该会自动跳转回本地并显示登录状态

## 注意事项

1. **环境隔离**：生产和开发环境使用相同的 Google OAuth 客户端，但回调 URL 不同
2. **CORS 配置**：确保后端的 CORS 配置允许生产前端域名
3. **HTTPS**：生产环境必须使用 HTTPS
4. **测试用户**：在 Google OAuth 同意屏幕处于测试状态时，只有添加的测试用户可以登录

## 安全提醒

- ⚠️ 不要将 `GOOGLE_CLIENT_SECRET` 提交到 git 仓库
- ✅ 使用 Railway 的环境变量管理敏感信息
- ✅ 定期轮换密钥
- ✅ 监控异常登录活动
