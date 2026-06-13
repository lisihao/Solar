# Secret Manager 独立服务方案

## 一、现有系统分析

### 1.1 密钥存储现状

| 组件                | 存储位置                       | 加密        | 问题                 |
| ------------------- | ------------------------------ | ----------- | -------------------- |
| AI Model API Keys   | AIModel.apiKey                 | 明文        | 直接存储在数据库     |
| MCP Server API Keys | MCPServerConfig.apiKey         | 明文        | 直接存储在数据库     |
| SMTP 密码           | SystemSetting (smtp_pass)      | AES-256-CBC | 使用 SettingsService |
| Resend API Key      | SystemSetting (resend_api_key) | AES-256-CBC | 使用 SettingsService |
| R2/B2 凭证          | 环境变量                       | 外部        | 依赖部署环境         |

### 1.2 关键文件清单

#### 数据库模型

- backend/prisma/schema/models.prisma
  - SystemSetting (行 2341-2355) - 支持 encrypted 标志
  - AIModel (行 2377-2435) - apiKey 明文存储
  - MCPServerConfig (行 6632-6664) - apiKey 明文存储

#### 后端服务

- backend/src/modules/platform/settings/settings.service.ts - AES-256-CBC 加密逻辑
- backend/src/modules/platform/admin/admin.service.ts - maskApiKey, createAIModel, getAIModelApiKey
- backend/src/modules/platform/admin/admin.controller.ts - API 端点定义
- backend/src/modules/platform/admin/admin.module.ts - 引用了不存在的 SecretsModule (行 13)
- backend/src/modules/platform/credentials/secrets/ - 目录不存在（导致编译错误）

#### 前端组件

- frontend/components/admin/AIModelSettings.tsx - AI 模型配置（处理明文 API Key）
- frontend/components/admin/AICapabilitiesSettings.tsx - MCP 服务器配置
- frontend/components/admin/EmailSettings.tsx - 邮件配置（使用 hasPassword 标志）

### 1.3 API Key 处理流程

#### AI 模型 API Key 流程

1. 前端输入 API Key (明文)
2. POST /api/v1/admin/ai-models (body: { apiKey: "sk-xxx" })
3. AdminService.createAIModel()
   - 检查是否掩码格式 (\*\*\*\*) -> 保留原值
   - 非掩码 -> 直接存储到 AIModel.apiKey (明文)
4. AiChatService.refreshModelConfigCache() -> 缓存到内存 (明文)
5. 调用 LLM API 时使用

#### 返回给前端时

- GET /api/v1/admin/ai-models
- AdminService.getAllAIModels() -> maskApiKey(): "sk-proj-xxx" -> "sk-p\*\*\*\*xxx"
- 返回: { apiKey: "sk-p\*\*\*\*xxx", hasApiKey: true }

#### 编辑时获取完整 Key

- GET /api/v1/admin/ai-models/:id?edit=true
- 返回完整 API Key（用于表单回显）

### 1.4 SettingsService 加密实现

文件: backend/src/modules/platform/settings/settings.service.ts

加密密钥来源 (行 85-88):

- 从 SETTINGS_ENCRYPTION_KEY 环境变量获取
- 默认值: "genesis-default-encryption-key!" (硬编码风险)
- 密钥长度: 32 字节

加密格式: IV:密文 (AES-256-CBC)

### 1.5 现有问题总结

1. SecretsModule 不存在: admin.module.ts 引用但目录不存在 -> 编译错误
2. API Key 明文存储: AIModel、MCPServerConfig 直接存储明文
3. 加密逻辑分散: SettingsService 加密逻辑未被 AI 模型复用
4. 无版本管理: 密钥更新后无法回滚
5. 无审计日志: 无法追踪密钥访问和修改历史
6. 默认加密密钥: 生产环境风险

---

## 二、设计方案

### 2.1 设计原则

1. 独立服务 - 与 SystemSetting 解耦，专注密钥管理
2. 统一加密 - 所有敏感数据使用相同加密逻辑
3. 向后兼容 - 支持现有 apiKey 字段，渐进迁移
4. 版本管理 - 每次更新创建新版本
5. 审计追踪 - 记录所有访问和修改

### 2.2 数据库模型

#### Secret 表（核心）

- id: UUID
- key: 唯一标识 (ai/openai-api-key)
- name: 显示名称
- description: 描述
- encryptedValue: 加密后的值
- category: 分类
- labels: 标签数组
- currentVersion: 当前版本号
- expiresAt: 过期时间
- isActive: 是否启用
- createdBy/updatedBy: 创建/更新者
- createdAt/updatedAt: 时间戳

#### SecretVersion 表（版本历史）

- id: UUID
- secretId: 关联 Secret
- version: 版本号
- encryptedValue: 加密后的值
- checksum: SHA-256 校验
- createdBy: 创建者
- createdAt: 创建时间

#### SecretAccessLog 表（审计日志）

- id: UUID
- secretId: 关联 Secret
- action: CREATE/READ/UPDATE/DELETE/ROLLBACK
- accessedBy: 访问者
- accessType: USER/API/SYSTEM
- ipAddress: IP 地址
- userAgent: 用户代理
- success: 是否成功
- errorMsg: 错误信息
- createdAt: 创建时间

#### 关联模型更新

- User 添加 Secret 相关关系
- AIModel 添加 secretKey 字段
- MCPServerConfig 添加 secretKey 字段

### 2.3 后端实现

#### 文件结构

backend/src/modules/platform/credentials/secrets/

- dto/
  - create-secret.dto.ts
  - update-secret.dto.ts
  - update-secret-value.dto.ts
  - query-secrets.dto.ts
- secrets.service.ts
- secrets.controller.ts
- secrets.module.ts

#### SecretsService 核心方法

- CRUD: create, findAll, findByKey, update, delete
- 值操作: getValue, getValueOrEnv, getValueOrThrow, updateValue
- 版本管理: getVersions, rollback
- 审计日志: getAccessLogs, logAccess
- 加密: encrypt, decrypt, calculateChecksum

#### API 端点

| Method | Path                                         | 描述       |
| ------ | -------------------------------------------- | ---------- |
| POST   | /api/v1/admin/secrets                        | 创建密钥   |
| GET    | /api/v1/admin/secrets                        | 列表查询   |
| GET    | /api/v1/admin/secrets/:key                   | 获取详情   |
| GET    | /api/v1/admin/secrets/:key/value             | 获取解密值 |
| PUT    | /api/v1/admin/secrets/:key                   | 更新元数据 |
| PUT    | /api/v1/admin/secrets/:key/value             | 更新值     |
| DELETE | /api/v1/admin/secrets/:key                   | 删除       |
| GET    | /api/v1/admin/secrets/:key/versions          | 版本历史   |
| POST   | /api/v1/admin/secrets/:key/rollback/:version | 回滚       |
| GET    | /api/v1/admin/secrets/:key/logs              | 审计日志   |

### 2.4 前端实现

#### 文件结构

- frontend/app/admin/access/secrets/page.tsx
- frontend/components/admin/secrets/SecretsManager.tsx
- frontend/components/admin/secrets/SecretForm.tsx
- frontend/components/admin/secrets/SecretVersions.tsx
- frontend/components/admin/secrets/SecretAccessLogs.tsx
- frontend/hooks/domain/useAdminSecrets.ts

#### AI 模型配置改造

API Key 配置支持两种模式:

1. 直接输入 (旧方式) - 兼容现有数据
2. 引用 Secret Manager (推荐) - secretKey 下拉选择

### 2.5 服务集成

#### AiChatService 改造

优先从 Secret Manager 获取 API Key，兼容旧数据:

- 如果 model.secretKey 存在，从 SecretsService 获取
- 否则使用 model.apiKey

#### MCPService 改造

同上逻辑

---

## 三、密钥命名规范

格式: {category}/{provider}-{type}

- AI 模型: ai/openai-api-key, ai/anthropic-api-key
- MCP 工具: mcp/tavily-api-key, mcp/firecrawl-api-key
- 存储: storage/b2-app-key, storage/r2-secret-key
- 集成: integrations/google-client-secret
- 邮件: email/smtp-password, email/resend-api-key

---

## 四、迁移策略

### Phase 1: 数据库 (修复编译错误)

1. 创建 Secret, SecretVersion, SecretAccessLog 表
2. 给 User 添加关系字段
3. 给 AIModel, MCPServerConfig 添加 secretKey 字段
4. 运行 npx prisma migrate dev

### Phase 2: 后端模块

1. 创建 backend/src/modules/platform/credentials/secrets/ 目录
2. 实现 SecretsModule, SecretsService, SecretsController
3. 创建 DTOs
4. 确保 AdminModule 正确导入

### Phase 3: 前端

1. 创建 useAdminSecrets Hook
2. 创建 /admin/access/secrets 页面
3. 创建 SecretsManager 组件

### Phase 4: 服务集成

1. 修改 AiChatService 支持 secretKey
2. 修改 MCP 服务支持 secretKey
3. 向后兼容（优先 secretKey，回退 apiKey）

---

## 五、关键文件清单

### 需要新建

| 文件                                                                   | 说明       |
| ---------------------------------------------------------------------- | ---------- |
| backend/src/modules/platform/credentials/secrets/secrets.module.ts     | 模块定义   |
| backend/src/modules/platform/credentials/secrets/secrets.service.ts    | 核心服务   |
| backend/src/modules/platform/credentials/secrets/secrets.controller.ts | API 控制器 |
| backend/src/modules/platform/credentials/secrets/dto/\*.ts             | DTOs       |
| frontend/app/admin/access/secrets/page.tsx                             | 管理页面   |
| frontend/components/admin/secrets/\*.tsx                               | 组件       |
| frontend/hooks/domain/useAdminSecrets.ts                               | Hook       |

### 需要修改

| 文件                                                          | 说明                |
| ------------------------------------------------------------- | ------------------- |
| backend/prisma/schema/models.prisma                           | 添加新模型          |
| backend/src/modules/platform/admin/admin.module.ts            | 修复导入            |
| backend/src/modules/ai-engine/llm/services/ai-chat.service.ts | 集成 SecretsService |
| frontend/components/admin/AIModelSettings.tsx                 | 支持 secretKey 选择 |

---

最后更新: 2025-01-19

---

## 六、前端详细设计

### 6.1 页面结构

路由: /admin/access/secrets

使用 AdminPageLayout 统一布局:

- domain: "access"
- icon: KeyRound (lucide-react)
- title: "密钥管理"
- description: "管理 API Keys、凭证和敏感配置"

### 6.2 组件设计

#### SecretsManager.tsx (主组件)

功能:

- 搜索框 (按 key/name 搜索)
- 分类筛选标签 (全部/AI模型/MCP工具/存储/邮件/集成)
- 密钥卡片列表
  - 显示: key, name, labels, version, status, expiresAt, updatedAt
  - 操作: 编辑, 删除, 查看版本, 查看日志

状态标识:

- 绿色: 活跃
- 黄色: 即将过期 (7天内)
- 红色: 已过期
- 灰色: 已禁用

#### SecretForm.tsx (创建/编辑模态框)

字段:

- key: 密钥标识 (格式: {分类}/{提供商}-{类型})
- name: 显示名称
- category: 分类下拉
- value: 密钥值 (密码输入框，可切换显示)
- labels: 标签 (可添加多个)
- description: 描述
- expiresAt: 过期时间 (日期选择器)

#### SecretVersions.tsx (版本历史抽屉)

显示:

- 版本号
- 创建者
- 创建时间
- 掩码值
- 回滚按钮

#### SecretAccessLogs.tsx (审计日志抽屉)

显示:

- 操作类型 (CREATE/READ/UPDATE/DELETE/ROLLBACK)
- 访问者 (用户/系统)
- 访问类型 (USER/API/SYSTEM)
- IP地址
- 时间
- 状态

### 6.3 Hook: useAdminSecrets.ts

接口:

- secrets: Secret[] - 密钥列表
- isLoading: boolean
- error: Error | null
- createSecret(data) - 创建
- updateSecret(key, data) - 更新元数据
- updateSecretValue(key, value) - 更新值(创建新版本)
- deleteSecret(key) - 删除
- getSecretValue(key) - 获取解密值
- getVersions(key) - 获取版本历史
- rollback(key, version) - 回滚
- getAccessLogs(key, page) - 获取审计日志
- refresh() - 刷新

### 6.4 AI 模型配置集成

修改 AIModelSettings.tsx:

API Key 配置支持两种模式:

1. 直接输入 - 兼容现有方式
2. 使用 Secret Manager (推荐) - secretKey 下拉选择

显示状态: 已配置(版本号) / 未配置
操作: 前往管理 / 刷新

### 6.5 分类定义

- ai: AI 模型 (紫色)
- mcp: MCP 工具 (蓝色)
- storage: 存储服务 (绿色)
- email: 邮件服务 (橙色)
- integrations: 集成服务 (粉色)
- auth: 认证安全 (红色)
- general: 通用 (灰色)

---

最后更新: 2025-01-19
