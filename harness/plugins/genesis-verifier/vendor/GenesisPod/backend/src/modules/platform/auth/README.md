# auth

> 用户认证与身份基础设施。

## 定位

`auth/` 负责账号注册、登录、令牌、身份校验与基础用户画像装配。

## 明确边界

- 允许：
  - register / login / refresh token
  - JWT strategy 与基础身份守卫协作
  - 基础登录历史、账号状态更新

- 不允许：
  - agent、mission、team 等 AI 域语义
  - app 级活动规则或业务工作流

## 命名约束

- 主测试文件使用标准名 `auth.service.spec.ts`
- 附加分支测试使用语义名，如 `auth.service.edge-cases.spec.ts`
