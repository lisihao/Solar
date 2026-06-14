# BYOK + 共享捐赠 API Key 系统方案

> **版本**: v1.0
> **日期**: 2026-02-03
> **状态**: 设计中
> **模块**: infra/core

---

## 一、背景与目标

### 问题

当前系统所有 AI 调用使用管理员配置的系统 API Key，成本完全由平台承担。用户自身拥有各提供商的 API Key 却无法使用。

### 目标

1. 用户可以配置自己的 API Key，直接使用自己的 AI 额度
2. 用户可以将 Key 捐赠到共享池，供所有用户使用，获得积分奖励
3. 与现有积分系统联动：自用 Key 免积分消耗，使用共享/系统 Key 消耗积分
4. 捐赠的 Key 自动进入 Secret Manager，管理员可在密钥管理中查看和管理

### 三种模式

| 模式              | 说明                                                            | Key 来源                   |
| ----------------- | --------------------------------------------------------------- | -------------------------- |
| **自用模式**      | 用户配置自己的 Key，AI 调用消耗自己的 provider 额度，不消耗积分 | 用户个人                   |
| **捐赠/共享模式** | 用户自愿将 Key 捐赠到系统共享池，供所有用户使用                 | 用户捐赠 -> Secret Manager |
| **系统模式**      | 管理员在后台配置的系统 Key（现有模式）                          | 管理员配置                 |

**Key 使用优先级**：`用户自用 Key` > `共享池 Key` > `系统 Key`

---

## 二、用户旅程

### 旅程 A：用户首次配置自用 Key

1. 用户进入 **个人资料 > API Keys** Tab
2. 看到提供商列表卡片（OpenAI, DeepSeek, Google 等）
3. 点击 DeepSeek 的 **[配置]**
4. 输入 API Key -> 点击 **[测试连接]** -> 成功
5. 选择使用模式：
   - **自用** -- Key 仅自己使用，AI 调用消耗自己的 provider 额度，不消耗积分
   - **捐赠到共享池** -- Key 贡献给系统所有用户使用，捐赠者获得积分奖励
6. 选择 **自用** -> 保存
7. 之后所有 AI 功能中，该 provider 的模型会标记"我的 Key"

### 旅程 B：用户捐赠 Key 到共享池

1. 同旅程 A 步骤 1-4
2. 选择 **捐赠到共享池**
3. 系统提示：

   > 感谢你的贡献! 你的 Key 将加入共享池供所有用户使用。
   > 作为回报，你将获得 **5000 积分奖励**，并且每次其他用户通过你的 Key 发起调用时，你额外获得 **2 积分**。
   > 你可以随时撤回捐赠。

4. 点击 **[确认捐赠]**
5. Key 自动加入 Secret Manager（共享密钥），在管理后台的密钥管理中可见
6. 用户的 API Keys 页面显示：`DeepSeek -- 已捐赠到共享池 | [撤回]`

### 旅程 C：免费用户无 Key 时

1. 免费用户进入 AI 问答
2. 系统检查：用户无自用 Key -> 检查共享池是否有可用 Key -> 检查系统 Key
3. **如果有共享池/系统 Key**：正常使用，消耗用户积分（每次对话扣 10 积分）
4. **如果积分不足**：显示引导页面，提示三种方式继续使用：
   - 配置自己的 API Key（免积分消耗）-- 推荐
   - 每日签到获取积分（+50 积分）
   - 捐赠 Key 获取大量积分（+5000 积分）

### 旅程 D：管理员查看共享 Key

1. 管理员进入 **管理后台 > 密钥管理**
2. 在密钥列表中看到一个新分类：**用户捐赠**
3. 每个捐赠 Key 显示：
   - 捐赠者用户名（脱敏）
   - Provider
   - 状态（活跃/失效）
   - 调用次数统计
4. 管理员可以：启用/禁用/移除捐赠 Key
5. 共享 Key 可以在模型配置中被引用（和普通 Secret 一样）

---

## 三、UI 界面设计

### 3.1 Profile 页面 -- "API Keys" Tab

位置：`frontend/app/profile/page.tsx`，在现有 4 个 Tab（个人资料、设置、统计、集成）之间插入

```
+--------------------------------------------------------------+
|  个人资料  |  设置  |  API Keys *新  |  统计  |  集成         |
+--------------------------------------------------------------+
|                                                              |
|  +- 说明横幅 --------------------------------------------+   |
|  | 配置你自己的 API Key 直接使用你的额度（0 积分消耗），  |   |
|  | 或捐赠 Key 到共享池获取积分奖励。                      |   |
|  +-------------------------------------------------------+   |
|                                                              |
|  +- 我的积分: 8,500  |  已捐赠: 1 个 Key  |  节省: $12.3 -+ |
|  +-------------------------------------------------------+   |
|                                                              |
|  --- Provider 列表 ------------------------------------------  |
|                                                              |
|  +--------------------------------------------------------+  |
|  | [OpenAI]  OpenAI               O 未配置        [配置]   |  |
|  +--------------------------------------------------------+  |
|  | [DeepSeek]  DeepSeek           * 自用中        [管理]   |  |
|  |  - Key: sk-...3f8a  | 模型: deepseek-r1 | 测试: ok     |  |
|  +--------------------------------------------------------+  |
|  | [Google]  Google Gemini        <3 已捐赠       [管理]   |  |
|  |  - 已贡献 342 次调用 | 获得 684 积分                    |  |
|  +--------------------------------------------------------+  |
|  | [Anthropic]  Anthropic         O 未配置        [配置]   |  |
|  +--------------------------------------------------------+  |
|  | [Qwen]  通义千问               O 未配置        [配置]   |  |
|  +--------------------------------------------------------+  |
|  | [XAI]  XAI (Grok)             O 未配置        [配置]   |  |
|  +--------------------------------------------------------+  |
|  | [Cohere]  Cohere               O 未配置        [配置]   |  |
|  +--------------------------------------------------------+  |
+--------------------------------------------------------------+
```

**状态标识**:

- `O 未配置` -- 灰色，未配置任何 Key
- `* 自用中` -- 绿色，Key 仅自己使用
- `<3 已捐赠` -- 紫色/粉色，Key 已捐赠到共享池

### 3.2 配置/管理展开面板

用户点击 [配置] 后展开（参考 Integrations Tab 中 Notion 的展开模式）：

```
+- 配置 DeepSeek API Key -----------------------------------------+
|                                                                   |
|  API Key *                                                        |
|  +---------------------------------------------------+  [eye]    |
|  | sk-xxxxxxxxxxxxxxxxxxxxxxxxxx                      |           |
|  +---------------------------------------------------+           |
|                                                                   |
|  使用模式                                                         |
|  +---------------------+  +-----------------------------+         |
|  |  [lock] 自用        |  |  [heart] 捐赠到共享池        |        |
|  |  仅自己使用         |  |  贡献给所有用户               |        |
|  |  0 积分消耗         |  |  获 5000 积分 + 持续奖励      |        |
|  |  * 已选择           |  |                              |        |
|  +---------------------+  +-----------------------------+         |
|                                                                   |
|  首选模型（可选）                                                  |
|  +---------------------------------------------------+           |
|  | deepseek-chat                                  v   |           |
|  +---------------------------------------------------+           |
|  留空将使用系统默认模型                                            |
|                                                                   |
|  > 高级设置                                                       |
|    自定义 API Endpoint                                            |
|    +-----------------------------------------------+              |
|    | https://api.deepseek.com                      |              |
|    +-----------------------------------------------+              |
|                                                                   |
|  [测试连接]  [保存]                                                |
|                                                                   |
|  [ok] 连接成功! 可用模型: 15 个                                    |
+-------------------------------------------------------------------+
```

### 3.3 积分不足引导页

当用户无自用 Key 且积分不足时，在 AI 功能页面显示：

```
+-----------------------------------------------------------+
|                                                           |
|      积分不足，无法使用 AI 功能                            |
|                                                           |
|  你有以下几种方式继续使用：                                 |
|                                                           |
|  +- 推荐 -------------------------------------------+    |
|  |  [key] 配置自己的 API Key（免积分消耗）            |    |
|  |  [前往配置]                                       |    |
|  +---------------------------------------------------+   |
|                                                           |
|  +---------------------------------------------------+   |
|  |  [calendar] 每日签到（+50 积分）    [立即签到]     |   |
|  +---------------------------------------------------+   |
|                                                           |
|  +---------------------------------------------------+   |
|  |  [heart] 捐赠 API Key 到共享池（+5000 积分）       |   |
|  |  [了解更多]                                        |   |
|  +---------------------------------------------------+   |
|                                                           |
+-----------------------------------------------------------+
```

### 3.4 AI 功能中的模型选择器增强

现有模型选择器（`AIModelSelector.tsx`）增加分组和标识：

```
+- 模型选择 ----------------------------------------+
|  -- 我的 Key --                                    |
|  DeepSeek R1 (DeepSeek)  [key]  免积分             |
|                                                    |
|  -- 系统可用 --                                     |
|  Grok 3 (xAI)                   10 积分/次         |
|  GPT-4o (OpenAI)                10 积分/次         |
|  Gemini 2.5 (Google)            10 积分/次         |
+----------------------------------------------------+
```

### 3.5 管理后台 -- 密钥管理增强

在现有密钥管理页面中增加 **"用户捐赠"** 分类筛选：

```
+- 密钥管理 --------------------------------------------------------+
|                                                                    |
|  分类: [全部] [AI 模型] [搜索] [用户捐赠 *新]                      |
|                                                                    |
|  +---------------------------------------------------------+      |
|  |  donated-deepseek-user-a3f8                              |      |
|  |  Provider: DeepSeek  |  捐赠者: J***n                    |      |
|  |  状态: * 活跃  |  调用: 342 次  |  创建: 2026-02-01      |      |
|  |  [禁用] [移除]                                           |      |
|  +---------------------------------------------------------+      |
|  |  donated-google-user-b7e2                                |      |
|  |  Provider: Google  |  捐赠者: L***i                      |      |
|  |  状态: * 活跃  |  调用: 128 次  |  创建: 2026-02-02      |      |
|  |  [禁用] [移除]                                           |      |
|  +---------------------------------------------------------+      |
+--------------------------------------------------------------------+
```

---

## 四、用户操作 -> 前后端交互全链路

```
用户操作                          前端                              后端
------                           ----                              ----

【配置 Key】
1. 打开 API Keys Tab             GET /user/api-keys                查询 UserApiKey 表
                                 <- providers 列表+状态             返回已配置 providers（不含明文）

2. 输入 Key，测试                POST /user/api-keys/:provider     调用 provider API 验证
                                 /test { apiKey }
                                 <- success / error                 返回测试结果

3. 选择"自用"，保存              PUT /user/api-keys/:provider      加密存 UserApiKey
                                 { apiKey, mode:"personal",        mode=personal
                                   preferredModelId? }

【捐赠 Key】
4. 选择"捐赠"，确认              PUT /user/api-keys/:provider      加密存 UserApiKey (mode=donated)
                                 { apiKey, mode:"donated" }        + 创建 Secret (category=USER_DONATED)
                                                                   + 授予用户 5000 积分

【AI 调用】
5. 发送消息                      POST /chat (正常流程)             getApiKeyForModel(model, userId):
                                                                     1. 查 UserApiKey(personal) -> 找到则用
                                                                     2. 查 共享池 Secret(donated) -> 轮询选一个
                                                                     3. 用系统 Key (现有逻辑)
                                                                   如果用的是共享/系统 Key -> 扣积分
                                                                   如果用的是用户自用 Key -> 不扣积分

【撤回捐赠】
6. 点击"撤回捐赠"               DELETE /user/api-keys/:provider   删除 UserApiKey
                                 /donate                           + 删除对应 Secret
                                                                   + 不追回已发积分
```

---

## 五、后端实现

### 5.1 数据库变更

#### 新增 `UserApiKey` 表

文件: `backend/prisma/schema/models.prisma`

```prisma
model UserApiKey {
  id               String    @id @default(cuid())
  userId           String    @map("user_id")
  provider         String    @db.VarChar(50)    // "openai","anthropic","google","deepseek","xai","cohere","qwen"
  encryptedValue   String    @map("encrypted_value") @db.Text
  iv               String    @db.VarChar(32)
  keyVersion       Int       @default(1) @map("key_version")
  mode             String    @default("personal") @db.VarChar(20) // "personal" | "donated"
  apiEndpoint      String?   @map("api_endpoint")
  preferredModelId String?   @map("preferred_model_id")
  donatedSecretId  String?   @map("donated_secret_id")  // 关联 Secret Manager 的 ID
  isActive         Boolean   @default(true) @map("is_active")
  lastTestedAt     DateTime? @map("last_tested_at")
  testStatus       String?   @map("test_status") @db.VarChar(20) // "success" | "failed"
  usageCount       Int       @default(0) @map("usage_count")      // 被调用次数（捐赠模式统计）
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider])
  @@index([provider, mode, isActive])
  @@map("user_api_keys")
}
```

#### SecretCategory 枚举扩展

在 `SecretCategory` 枚举中新增:

```prisma
enum SecretCategory {
  AI_MODEL
  SEARCH
  EXTRACTION
  YOUTUBE
  TTS
  SKILLSMP
  POLICY
  DEV_TOOLS
  MCP
  USER_DONATED    // <- 新增：用户捐赠的共享 Key
  OTHER
}
```

#### User model 扩展

```prisma
model User {
  // ... 现有字段 ...
  apiKeys UserApiKey[]  // <- 新增关系
}
```

#### 迁移命令

```bash
npx prisma migrate dev --name add-user-api-keys
npx prisma generate
```

### 5.2 新模块: `user-api-keys`

路径: `backend/src/modules/ai-infra/user-api-keys/`

#### 文件结构

```
user-api-keys/
  user-api-keys.module.ts       # NestJS 模块注册
  user-api-keys.service.ts      # 加密/解密/CRUD/测试/捐赠逻辑
  user-api-keys.controller.ts   # REST 端点（需认证）
  dto/
    save-user-key.dto.ts        # PUT 请求 DTO
    test-user-key.dto.ts        # POST test 请求 DTO
```

#### API 端点

| 方法     | 路径                                     | 说明                   | 请求体                                              |
| -------- | ---------------------------------------- | ---------------------- | --------------------------------------------------- |
| `GET`    | `/api/v1/user/api-keys`                  | 列出已配置的 providers | -                                                   |
| `PUT`    | `/api/v1/user/api-keys/:provider`        | 设置/更新 Key          | `{ apiKey, mode, apiEndpoint?, preferredModelId? }` |
| `DELETE` | `/api/v1/user/api-keys/:provider`        | 删除 Key               | -                                                   |
| `POST`   | `/api/v1/user/api-keys/:provider/test`   | 测试 Key               | `{ apiKey }`                                        |
| `DELETE` | `/api/v1/user/api-keys/:provider/donate` | 撤回捐赠               | -                                                   |

#### GET 响应格式（不含明文 Key）

```json
{
  "success": true,
  "data": [
    {
      "provider": "deepseek",
      "mode": "personal",
      "isConfigured": true,
      "maskedKey": "sk-...3f8a",
      "preferredModelId": "deepseek-r1",
      "testStatus": "success",
      "lastTestedAt": "2026-02-03T12:00:00Z"
    },
    {
      "provider": "google",
      "mode": "donated",
      "isConfigured": true,
      "maskedKey": "AIza...eZ6Y",
      "usageCount": 342,
      "earnedCredits": 684,
      "testStatus": "success",
      "lastTestedAt": "2026-02-02T08:00:00Z"
    }
  ]
}
```

#### UserApiKeysService 核心方法

```typescript
class UserApiKeysService {
  // CRUD
  async listKeys(userId: string): Promise<UserApiKeyInfo[]>;
  async saveKey(
    userId: string,
    provider: string,
    dto: SaveUserKeyDto,
  ): Promise<void>;
  async deleteKey(userId: string, provider: string): Promise<void>;
  async testKey(
    provider: string,
    apiKey: string,
  ): Promise<{ success: boolean; error?: string }>;

  // Key 解析（供 AI 调用链使用）
  async getPersonalKey(
    userId: string,
    provider: string,
  ): Promise<string | null>;
  async getDonatedKey(provider: string): Promise<string | null>;

  // 捐赠管理
  async withdrawDonation(userId: string, provider: string): Promise<void>;

  // 内部：加密/解密（复用 SecretsService 的 AES-256-CBC 模式）
  private encrypt(text: string): { encryptedValue: string; iv: string };
  private decrypt(encryptedValue: string, iv: string): string | null;
}
```

**saveKey 逻辑**:

- `mode=personal`: 加密存储到 UserApiKey 表
- `mode=donated`:
  1. 加密存储到 UserApiKey 表
  2. 创建 Secret 记录（name: `donated-{provider}-{userId前8位}`, category: `USER_DONATED`, provider: provider）
  3. 调用 CreditsService 授予 5000 积分
  4. 记录 donatedSecretId 关联

**getDonatedKey 逻辑**:

- 查询 Secret 表 `WHERE category = 'USER_DONATED' AND provider = :provider AND isActive = true`
- 随机选择一个（简单负载均衡，避免单个 Key 过度使用）
- 解密返回

**withdrawDonation 逻辑**:

- 删除 UserApiKey 记录
- 删除关联的 Secret 记录
- 不追回已发放的积分

### 5.3 核心变更: Key 解析优先级

**文件**: `backend/src/modules/ai-engine/llm/services/ai-model-config.service.ts`

修改 `getApiKeyForModel()` 方法：

```typescript
// 返回值变更：增加 source 字段
async getApiKeyForModel(
  model: AIModelConfig,
  userId?: string
): Promise<{ apiKey: string; source: 'personal' | 'donated' | 'system' } | null> {

  // Priority 1: 用户自用 Key
  if (userId) {
    const personalKey = await this.userApiKeysService.getPersonalKey(
      userId,
      model.provider
    );
    if (personalKey) {
      return { apiKey: personalKey, source: 'personal' };
    }
  }

  // Priority 2: 共享池（用户捐赠）
  const donatedKey = await this.userApiKeysService.getDonatedKey(model.provider);
  if (donatedKey) {
    return { apiKey: donatedKey, source: 'donated' };
  }

  // Priority 3: Secret Manager 系统 Key（现有逻辑）
  if (model.secretKey) {
    const secretValue = await this.secretsService.getValueInternal(model.secretKey);
    if (secretValue) {
      return { apiKey: secretValue.trim(), source: 'system' };
    }
    this.logger.warn(
      `Secret '${model.secretKey}' not found for model ${model.name}`
    );
  }

  // Priority 4: Legacy apiKey（现有逻辑）
  if (model.apiKey?.trim()) {
    return { apiKey: model.apiKey.trim(), source: 'system' };
  }

  return null;
}
```

### 5.4 积分联动

**文件**: `backend/src/modules/ai-engine/llm/services/ai-chat.service.ts`

在 `chat()` 方法中，根据 `source` 决定是否扣积分：

```typescript
const keyResult = await this.getApiKeyForModel(config, userId);
// ...执行 AI 调用...

// 积分扣除
if (keyResult.source === "personal") {
  // 用户自用 Key，不扣积分
} else {
  // 共享/系统 Key，正常扣积分
  await this.creditsService.consumeCredits(userId, "ai-ask", "chat", 10);
}

// 捐赠者持续奖励
if (keyResult.source === "donated") {
  // 给捐赠者 +2 积分（异步，不阻塞主流程）
  this.userApiKeysService.rewardDonator(model.provider, 2).catch(() => {});
}
```

### 5.5 传递 userId

在 `AiChatService.chat()` 的 options 接口中增加 `userId?: string`：

```typescript
interface ChatOptions {
  // ... 现有字段 ...
  userId?: string; // <- 新增
}
```

各 Controller 从 JWT 中提取 `req.user.id` 传入。后台任务（无用户上下文）不传 userId，自动使用系统 Key。

---

## 六、前端实现

### 6.1 新文件

| 文件                                                      | 职责                                  |
| --------------------------------------------------------- | ------------------------------------- |
| `frontend/hooks/features/useUserApiKeys.ts`               | CRUD Hook：list/save/delete/test Key  |
| `frontend/components/profile/UserApiKeysTab.tsx`          | Profile 页面的 API Keys 选项卡主组件  |
| `frontend/components/profile/ProviderKeyCard.tsx`         | 单个 Provider 的配置卡片（展开/折叠） |
| `frontend/components/profile/KeyConfigPanel.tsx`          | Key 输入/模式选择/测试/保存面板       |
| `frontend/components/shared/InsufficientCreditsGuide.tsx` | 积分不足时的引导组件                  |

### 6.2 修改现有文件

| 文件                                                         | 修改内容                                               |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `frontend/app/profile/page.tsx`                              | 增加 "API Keys" Tab                                    |
| `frontend/components/explore/components/AIModelSelector.tsx` | 模型列表分组：我的 Key / 系统可用；标记积分消耗        |
| `frontend/hooks/features/useAIModels.ts`                     | 合并用户已配置的 provider 信息，标记哪些模型有用户 Key |
| `frontend/components/admin/ai-config/AIModelSettings.tsx`    | 密钥管理页面增加"用户捐赠"分类筛选                     |

### 6.3 useUserApiKeys Hook 设计

```typescript
interface UserApiKeyInfo {
  provider: string;
  mode: "personal" | "donated";
  isConfigured: boolean;
  maskedKey: string | null;
  preferredModelId: string | null;
  testStatus: "success" | "failed" | null;
  lastTestedAt: string | null;
  usageCount: number;
  earnedCredits: number;
}

interface UseUserApiKeysReturn {
  providers: UserApiKeyInfo[];
  loading: boolean;
  error: string | null;
  saveKey: (
    provider: string,
    apiKey: string,
    mode: string,
    opts?: {
      apiEndpoint?: string;
      preferredModelId?: string;
    },
  ) => Promise<void>;
  deleteKey: (provider: string) => Promise<void>;
  testKey: (
    provider: string,
    apiKey: string,
  ) => Promise<{ success: boolean; error?: string }>;
  withdrawDonation: (provider: string) => Promise<void>;
  refresh: () => void;
}
```

---

## 七、安全设计

| 安全点     | 措施                                                        |
| ---------- | ----------------------------------------------------------- |
| Key 存储   | AES-256-CBC 加密，复用 SecretsService 的密钥派生机制        |
| 前端不泄露 | GET 端点只返回 `maskedKey`（后 4 位），永不返回明文         |
| 用户隔离   | 所有查询强制 `WHERE userId = :currentUserId`（从 JWT 提取） |
| 级联删除   | 用户删除时 `onDelete: Cascade` 自动清除所有 API Keys        |
| 测试限流   | 测试端点每用户每分钟最多 5 次                               |
| 捐赠审计   | 捐赠操作记录在 Secret 的 `createdBy` 字段，管理员可追溯     |

---

## 八、实施步骤

| 阶段                | 步骤 | 内容                                 | 涉及文件                                      |
| ------------------- | ---- | ------------------------------------ | --------------------------------------------- |
| **1. 数据库**       | 1.1  | Prisma schema: UserApiKey 表         | `backend/prisma/schema/models.prisma`         |
|                     | 1.2  | SecretCategory 枚举增加 USER_DONATED | 同上                                          |
|                     | 1.3  | User model 增加 apiKeys 关系         | 同上                                          |
|                     | 1.4  | 运行 prisma migrate                  | -                                             |
| **2. 后端 CRUD**    | 2.1  | 实现 UserApiKeysService              | `backend/src/modules/ai-infra/user-api-keys/` |
|                     | 2.2  | 实现 UserApiKeysController           | 同上                                          |
|                     | 2.3  | 注册 UserApiKeysModule               | 同上                                          |
| **3. 核心接入**     | 3.1  | 修改 getApiKeyForModel()             | `ai-model-config.service.ts`                  |
|                     | 3.2  | chat() options 增加 userId           | `ai-chat.service.ts`                          |
|                     | 3.3  | 各 Controller 传入 req.user.id       | 各业务 controller                             |
| **4. 积分联动**     | 4.1  | chat() 根据 source 决定扣积分        | `ai-chat.service.ts`                          |
|                     | 4.2  | 捐赠时授予积分                       | `user-api-keys.service.ts`                    |
|                     | 4.3  | 捐赠者持续奖励                       | 同上                                          |
| **5. 前端 Profile** | 5.1  | useUserApiKeys hook                  | `frontend/hooks/features/`                    |
|                     | 5.2  | UserApiKeysTab 组件                  | `frontend/components/profile/`                |
|                     | 5.3  | ProviderKeyCard 组件                 | 同上                                          |
|                     | 5.4  | KeyConfigPanel 组件                  | 同上                                          |
|                     | 5.5  | Profile 页面增加 Tab                 | `frontend/app/profile/page.tsx`               |
| **6. 前端 AI 功能** | 6.1  | 模型选择器增强                       | `AIModelSelector.tsx`                         |
|                     | 6.2  | 积分不足引导组件                     | `InsufficientCreditsGuide.tsx`                |
| **7. 后台管理**     | 7.1  | 密钥管理增加用户捐赠分类             | `AIModelSettings.tsx`                         |

---

## 九、验证方式

### 功能验证

1. 用户配置自用 DeepSeek Key -> 测试连接成功 -> 保存
2. 用户使用 AI 问答选择 DeepSeek 模型 -> 后端日志确认使用用户 Key，不扣积分
3. 删除用户 Key -> AI 调用自动回退系统 Key，正常扣积分
4. 用户捐赠 Google Key -> Secret Manager 出现新密钥（category=USER_DONATED），用户获 5000 积分
5. 其他用户 AI 调用 Google 模型 -> 使用共享池 Key，扣积分，捐赠者获 2 积分
6. 用户撤回捐赠 -> Secret Manager 密钥删除，共享池不再使用该 Key
7. 无 Key 用户积分不足 -> 显示引导页面
8. 管理员后台 -> 可见用户捐赠的 Key，可管理

### 安全验证

1. GET /user/api-keys 不返回明文 Key
2. 数据库中 UserApiKey.encryptedValue 为密文
3. 用户 A 无法通过 API 访问用户 B 的 Key
4. 测试端点限流生效

---

**最后更新**: 2026-02-03
**维护者**: Claude Code
**版本**: 1.0
