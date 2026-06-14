# Google OAuth 配置指南

本文档说明如何配置 Google OAuth 认证，让用户可以通过 Google 账户登录 GenesisPod。

---

## 一、Google Cloud Console 配置

### 1. 创建 Google Cloud 项目

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 点击项目下拉菜单，选择"新建项目"
3. 输入项目名称（例如：GenesisPod）
4. 点击"创建"

### 2. 启用 Google+ API

1. 在左侧菜单中，选择"API 和服务" > "库"
2. 搜索"Google+ API"
3. 点击"启用"

### 3. 创建 OAuth 2.0 凭据

1. 在左侧菜单中，选择"API 和服务" > "凭据"
2. 点击顶部的"+ 创建凭据"按钮
3. 选择"OAuth 客户端 ID"

4. 如果首次创建，需要先配置同意屏幕：
   - 点击"配置同意屏幕"
   - 选择"外部"（如果要让任何Google用户登录）
   - 填写应用信息：
     - 应用名称：GenesisPod
     - 用户支持电子邮件：你的邮箱
     - 开发者联系信息：你的邮箱
   - 点击"保存并继续"
   - 作用域：无需添加，点击"保存并继续"
   - 测试用户：添加测试用户的邮箱（开发阶段）
   - 点击"保存并继续"

5. 返回凭据创建：
   - 应用类型：选择"Web 应用"
   - 名称：GenesisPod OAuth Client
   - 已授权的重定向 URI：
     - 开发环境：`http://localhost:8080/api/v1/auth/google/callback`
     - 生产环境：`https://your-domain.com/api/v1/auth/google/callback`
   - 点击"创建"

6. 复制生成的：
   - 客户端 ID (Client ID)
   - 客户端密钥 (Client Secret)

---

## 二、后端环境变量配置

### 1. 本地开发环境

编辑 `backend/.env` 文件，添加以下环境变量：

```bash
# Google OAuth 配置
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:8080/api/v1/auth/google/callback

# 前端URL（用于OAuth回调重定向）
FRONTEND_URL=http://localhost:3000
```

### 2. 生产环境

在生产环境（如 Railway）的环境变量中设置：

```bash
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=https://your-backend-domain.com/api/v1/auth/google/callback
FRONTEND_URL=https://your-frontend-domain.com
```

---

## 三、数据库 Schema 更新

确保 User 表包含以下字段：

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  username     String
  passwordHash String?   // Google OAuth用户可以为null
  googleId     String?   @unique // Google用户ID
  avatarUrl    String?   // 用户头像URL
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  // 其他字段...
}
```

如果需要更新schema，运行：

```bash
cd backend
npx prisma migrate dev --name add_google_oauth
```

---

## 四、前端配置

### 1. 创建登录按钮

前端需要创建一个按钮，点击后重定向到Google OAuth页面：

```typescript
const handleGoogleLogin = () => {
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  window.location.href = `${backendUrl}/api/v1/auth/google`;
};

<button onClick={handleGoogleLogin}>
  使用 Google 账户登录
</button>
```

### 2. 处理OAuth回调

创建 `/auth/callback` 页面来处理Google OAuth回调：

```typescript
// frontend/app/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams?.get('token');
    const refreshToken = searchParams?.get('refreshToken');

    if (token && refreshToken) {
      // 保存token到localStorage或cookie
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', refreshToken);

      // 重定向到主页
      router.push('/');
    } else {
      // 登录失败，重定向到登录页
      router.push('/login');
    }
  }, [searchParams, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p>正在登录...</p>
      </div>
    </div>
  );
}
```

---

## 五、测试流程

### 1. 启动后端服务

```bash
cd backend
npm run dev
```

### 2. 启动前端服务

```bash
cd frontend
npm run dev
```

### 3. 测试登录流程

1. 访问前端页面
2. 点击"使用 Google 账户登录"按钮
3. 跳转到 Google 登录页面
4. 选择 Google 账户并授权
5. 自动重定向回前端页面，完成登录

### 4. 验证登录状态

检查：

- localStorage 中是否存储了 accessToken 和 refreshToken
- 调用 `/api/v1/auth/me` 接口查看当前用户信息
- Bookmark 功能是否可用

---

## 六、常见问题

### Q1: "redirect_uri_mismatch" 错误

**原因**：回调URL不匹配

**解决**：

1. 检查 Google Cloud Console 中配置的回调URL
2. 确保 `GOOGLE_CALLBACK_URL` 环境变量与Google Console配置完全一致
3. 注意 http vs https、端口号、路径等

### Q2: "Access blocked: This app's request is invalid"

**原因**：OAuth consent screen 未配置或配置不完整

**解决**：

1. 返回 Google Cloud Console
2. 完成"OAuth 同意屏幕"配置
3. 确保添加了测试用户（开发阶段）

### Q3: 用户登录后Bookmark still报错

**可能原因**：

1. Token没有正确存储
2. 前端API请求未携带token

**解决**：

1. 检查 localStorage 中的token
2. 确保API请求头包含：`Authorization: Bearer <token>`
3. 检查后端日志，确认token验证成功

### Q4: "idpiframe_initialization_failed" 错误

**原因**：浏览器阻止了第三方cookie

**解决**：

1. 在开发环境中，允许第三方cookie
2. 或使用无痕模式测试
3. 生产环境需要使用https

---

## 七、安全建议

### 1. 保护敏感信息

- ❌ **永远不要** 将 `GOOGLE_CLIENT_SECRET` 提交到git仓库
- ✅ 使用环境变量管理敏感配置
- ✅ `.env` 文件应该在 `.gitignore` 中

### 2. 生产环境配置

- ✅ 使用 HTTPS
- ✅ 限制回调URL白名单
- ✅ 定期轮换密钥
- ✅ 启用CORS仅允许可信域名

### 3. Token管理

- ✅ 使用 httpOnly cookie 存储token（更安全）
- ✅ 设置合理的token过期时间
- ✅ 实现refresh token机制

---

## 八、后续优化

### 1. 支持多种OAuth提供商

可以类似地添加：

- GitHub OAuth
- Facebook Login
- Microsoft Account

### 2. 用户资料管理

允许用户：

- 查看和编辑个人资料
- 绑定/解绑多个OAuth账户
- 设置密码（如果通过OAuth注册）

### 3. 安全增强

- 实现2FA（双因素认证）
- 添加登录日志和异常检测
- 实现设备管理

---

## 九、参考资源

- [Google OAuth 2.0 文档](https://developers.google.com/identity/protocols/oauth2)
- [Passport Google OAuth20 策略](https://www.passportjs.org/packages/passport-google-oauth20/)
- [NestJS Passport 集成](https://docs.nestjs.com/security/authentication)

---

**文档版本**: 1.0.0
**最后更新**: 2025-11-21
