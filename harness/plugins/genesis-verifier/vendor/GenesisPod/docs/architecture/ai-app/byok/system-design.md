# GenesisPod BYOK（Bring Your Own Key）系统设计文档

> **版本**: v1.0
> **创建时间**: 2026-04-20
> **状态**: 已评审，待实施
> **负责人**: Claude Code + 项目 Owner
> **实施指导对象**: Coder Agent / Tester Agent / Reviewer Agent

---

## 目录

- [1. 文档目标与使用方式](#1-文档目标与使用方式)
- [2. 术语表](#2-术语表)
- [3. 业务目标与核心原则](#3-业务目标与核心原则)
- [4. 用户角色与旅程全景](#4-用户角色与旅程全景)
- [5. 用户旅程详细分析（10 条）](#5-用户旅程详细分析10-条)
- [6. 系统架构设计](#6-系统架构设计)
- [7. 数据模型（Prisma Schema Diff）](#7-数据模型prisma-schema-diff)
- [8. 后端服务设计](#8-后端服务设计)
- [9. API 端点清单](#9-api-端点清单)
- [10. 前端架构设计](#10-前端架构设计)
- [11. 实施阶段规划](#11-实施阶段规划)
- [12. 验收标准与测试用例](#12-验收标准与测试用例)
- [13. 风险登记册](#13-风险登记册)
- [14. 开放问题清单](#14-开放问题清单)
- [15. 附录](#15-附录)

---

## 1. 文档目标与使用方式

### 1.1 本文档的目标

把 GenesisPod 现有「所有用户共享系统 Key」的模式，改造为：

- **普通用户**：必须使用自己的 API Key（BYOK 模式）或管理员分配的 Key
- **管理员**：继续使用系统 Secret Manager 中的 Key
- **无 Key 用户**：走「申请工单」流程，由管理员从独立的「可分发 Key 池」分配

### 1.2 如何使用本文档

本文档**按用户旅程驱动**，每个旅程完整描述：

1. **场景**：什么用户、什么情境、什么目标
2. **UI 流程**：用户实际能看到和操作的每一步
3. **后端数据流**：每一步对应哪些 Service 调用、数据库操作
4. **边界场景**：失败路径、并发场景、异常处理
5. **验收标准**：怎样才算这个旅程做对了

**Agent 实施时请按「旅程 → 阶段任务 → 文件级改动」的顺序推进**，不要跳过旅程直接写代码。每完成一个 Phase，必须对照 [§12 验收标准](#12-验收标准与测试用例) 自检。

### 1.3 本文档不涵盖

- **游客（未登录）访问**：当前版本**不支持游客使用 AI**，如需支持后续单独设计 `/public/chat` 限流端点
- **超细粒度权限**（如 `KEY_ADMIN` vs `SUPER_ADMIN`）：一期只区分 `USER` 和 `ADMIN`
- **多租户/组织架构**：一期按「单租户 + 用户池」设计，组织级功能留给 Phase 2+

---

## 2. 术语表

| 术语                              | 定义                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| **BYOK**                          | Bring Your Own Key，用户使用自己的 Provider API Key                     |
| **Provider**                      | 大模型服务商，如 OpenAI / Anthropic / Google / xAI 等                   |
| **Personal Key**                  | 用户自己配置的 API Key，存在 `user_api_keys` 表                         |
| **Distributable Key（分发 Key）** | 管理员专门采购用于分配的 Key，存在新表 `distributable_keys`             |
| **System Key**                    | 系统默认 Key，存在 `Secret` 表，**仅管理员用户可使用**                  |
| **Assignment（分配）**            | 管理员把某个 Distributable Key 分配给某用户，存在新表 `key_assignments` |
| **Key Request（Key 申请）**       | 用户无 Key 时的申请工单，存在新表 `key_requests`                        |
| **Resolved Key**                  | `KeyResolverService` 解析出的最终使用的 Key（包含来源标记）             |
| **Quota（配额）**                 | Key 或分配的用量上限（以美分 `cents` 为单位）                           |
| **Key Source**                    | `PERSONAL` / `ASSIGNED` / `SYSTEM` 三种来源                             |

---

## 3. 业务目标与核心原则

### 3.1 业务目标

1. **成本可控**：普通用户的 LLM 调用费用由用户自己的 Key 承担，平台不再为每个用户兜底
2. **边界清晰**：系统 Key / 用户 Key / 分发 Key 物理隔离，账目分明
3. **体验可接受**：新用户首次登录有明确引导，不至于因为「没 Key」卡在登录页
4. **管理员可管控**：可以给特定用户临时分配 Key（带配额和有效期），也能随时撤销

### 3.2 核心原则

1. **管理员与普通用户的 Key 策略严格分离**
   - 管理员永远走系统 Key（从 `Secret` 表读），与普通用户逻辑无交集
   - 避免「管理员分配自己的系统 Key 给用户」导致账单混乱

2. **统一解析入口**
   - 所有 LLM 调用必须经过 `KeyResolverService.resolveKey(userId, provider)`
   - 禁止任何 Service 直接读 `userApiKeysService.getPersonalKey()` 或 `secretsService.getValue()` 做 LLM 调用

3. **优先级明确，不做智能 fallback**
   - 普通用户：`PERSONAL` → `ASSIGNED` → 报错并引导申请
   - 不自动 fallback 到 `SYSTEM`，避免「用户以为在用自己的 Key，实际用了系统的」的账单错觉

4. **Provider 不可用时「主动过滤」而非「失败兜底」**
   - 用户只配了 OpenAI Key → 模型路由只从 OpenAI 模型池里选，**不路由到 Claude 再报错**
   - 这需要 `IntelligentModelRouter` 支持 `availableProviders` 参数

5. **加密工具必须独立**
   - 现有 `encrypt/decrypt` 逻辑在 `UserApiKeysService` 和 `SecretsService` 各有一份副本，新表复用时必须提取为独立 `EncryptionService`（避免三份副本）

6. **异步任务必须显式传递 userId**
   - BullMQ Worker 中 `RequestContext` 默认为空，必须在 `job.data.userId` 传入并用 `RequestContext.run()` 恢复

---

## 4. 用户角色与旅程全景

### 4.1 角色定义

| 角色         | `User.role` | 可用 Key 来源               | 典型操作                                    |
| ------------ | ----------- | --------------------------- | ------------------------------------------- |
| **普通用户** | `USER`      | Personal Key + Assigned Key | 配置个人 Key、申请分配、使用 AI             |
| **管理员**   | `ADMIN`     | System Key（Secret 表）     | 管理分发池、审批申请、使用 AI（走系统 Key） |

### 4.2 旅程全景图

```
【普通用户旅程】                           【管理员旅程】
─────────────────                          ─────────────────

首次登录                                    查看申请队列
  ↓                                          ↓
进入引导页                                  审批/拒绝申请
  ↓                                          ↓
选项 A: 配置个人 Key                        维护分发池
  │  ├─ 选 Provider                        ├─ 新增分发 Key
  │  ├─ 输入 Key + 测试                    ├─ 调整配额
  │  └─ 标记引导完成 ──┐                  └─ 撤销分配
  │                    │                       ↓
选项 B: 申请分配        │                   日常使用 AI（走系统 Key）
  │                    │
  ├─ 填写申请表        │
  └─ 等待审批 ──────→ 审批通过 → 自动分配 Key
                       │
                       ▼
日常使用 AI (Ask AI / Research / Teams...)
  ↓
KeyResolver 解析 Key
  ├─ 有 Personal Key → 用 Personal
  ├─ 有 Assignment → 用 Assignment（扣配额）
  └─ 都没有 → 提示「前往申请 Key」
  ↓
调用 Provider API
  ├─ 成功 → 记录成本归属
  └─ 失败
     ├─ Key 失效 → 提示用户更新 Key
     ├─ 配额耗尽 → 提示申请扩额
     └─ Provider 宕机 → 按 availableProviders 换模型重试
```

---

## 5. 用户旅程详细分析（10 条）

### 旅程 J1：新用户首次登录与引导

#### 场景

Alice 通过 Google OAuth 注册了 GenesisPod，登录后第一次进入主界面。她从未配置过 Key。

#### UI 流程

```
[Google OAuth 回调] /auth/callback
   ↓ 成功后 AuthContext.login(user, tokens)
   ↓ 检查 user.byokOnboardedAt === null
   ↓
[强制重定向] /settings/api-keys/onboarding
   ↓ 页面内容：
   │  ┌─────────────────────────────────────┐
   │  │ 欢迎来到 GenesisPod                 │
   │  │ 为了使用 AI 功能，请配置你的 API Key │
   │  │                                      │
   │  │ [选项 1] 我有 API Key → 配置 Key    │
   │  │ [选项 2] 我没有 Key → 申请分配       │
   │  │                                      │
   │  │ 支持的 Provider: OpenAI / Claude / … │
   │  └─────────────────────────────────────┘
   ↓
[选项 1 分支] 进入 ProviderKeyConfigStep
   ├─ 用户选 Provider (OpenAI)
   ├─ 粘贴 Key sk-...
   ├─ 点「测试连接」→ 调后端 /user/api-keys/openai/test
   ├─ 测试成功 → 点「保存」
   ├─ 后端保存后自动设置 user.byokOnboardedAt
   └─ 前端跳转 / 首页，显示 toast「API Key 已配置」

[选项 2 分支] 跳转 /settings/api-keys/request
   ├─ 填写申请表（Provider、理由、预计用量）
   ├─ 提交 → 创建 KeyRequest (status=PENDING)
   ├─ 同时设置 user.byokOnboardedAt（允许进入系统）
   └─ 跳转首页，显示 toast「申请已提交，管理员审批后会通知你」
```

#### 后端数据流

```
1. AuthController.googleCallback
   → 创建/更新 User
   → 返回 JWT（payload 含 role, byokOnboardedAt）

2. 前端 middleware 或 AppShell 检查
   → user.byokOnboardedAt === null → 重定向 onboarding

3. 选项 1：POST /user/api-keys/:provider
   → UserApiKeysService.saveKey(userId, provider, apiKey)
   → 同事务里 Update User SET byok_onboarded_at = NOW()
   → 清缓存 invalidateUserKeyCache(userId)

4. 选项 2：POST /user/key-requests
   → KeyRequestsService.create(userId, {provider, reason})
   → 同事务 Update User SET byok_onboarded_at = NOW()
   → 发通知给管理员（可选，一期用页面轮询替代）
```

#### 边界场景

| 场景                            | 处理                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| Key 测试超时（15s）             | 前端提示「测试超时，仍可保存」，后端 `testStatus = 'timeout'` |
| Key 已在别处注册过（冲突）      | 前端提示，允许覆盖（`saveKey` 内部已支持 upsert）             |
| 用户配置到一半关闭浏览器        | `byokOnboardedAt` 仍为 null，下次登录重新引导                 |
| 用户通过直接访问 `/` 想绕过引导 | middleware 强制重定向到 onboarding                            |
| 管理员第一次登录                | `user.role === 'ADMIN'` 时跳过引导，直接进入首页              |

#### 验收标准

- [ ] 新用户登录后 100% 被重定向到 `/settings/api-keys/onboarding`
- [ ] 配置成功后 `User.byokOnboardedAt` 被更新
- [ ] 管理员登录**不触发**引导
- [ ] 引导页支持「跳过并申请」路径，完成后也能进入主界面
- [ ] 浏览器刷新引导页不丢失已输入的 Key（使用 Form state，不用 localStorage 存密文）

---

### 旅程 J2：老用户日常使用 AI（首页 Ask AI）

#### 场景

Bob 已经配置了 OpenAI Key，在首页输入「解释一下量子纠缠」，期望 AI 回答。

#### UI 流程

```
[首页] /
   ↓ 用户在 Ask AI 输入框输入问题
   ↓ 前端调 /api/v1/ai/ask (POST)
   ↓
[加载中] 显示 streaming 指示器
   ↓
[正常响应] 流式显示答案
   ↓ 消息顶部显示标签 "[Using Your OpenAI Key]"（小字，可关闭）
   ↓
[如果 Key 失效] 显示错误卡片：
   ┌────────────────────────────────────┐
   │ ⚠ 你的 OpenAI Key 似乎已失效        │
   │ [前往更新 Key]  [申请分配 Key]     │
   └────────────────────────────────────┘
```

#### 后端数据流

```
1. POST /api/v1/ai/ask
   Controller 从 req.user.id 拿到 userId
   → RequestContext.run({userId}, () => AskAppService.handle(...))

2. AskAppService 调 AiChatService.chat({
     taskProfile: { creativity: 'medium', outputLength: 'medium' },
     modelType: 'CHAT',
     messages: [...],
     userId,  // ← 显式传递
   })

3. AiChatService.chat 新逻辑：
   a. const availableProviders = await keyResolver.getAvailableProviders(userId)
      → ['openai']  (Bob 只配了 OpenAI)
   b. const modelConfig = await modelResolver.selectModel({
        modelType: 'CHAT',
        availableProviders,  // ← 过滤出 OpenAI 的模型
      })
      → 选中 gpt-4o
   c. const resolved = await keyResolver.resolveKey(userId, 'openai')
      → { source: 'PERSONAL', apiKey: 'sk-...', endpoint: null }
   d. const result = await apiCallerService.callWithKey(modelConfig, resolved, messages)
   e. 记录成本：costAttribution.recordCost({
        userId, moduleType: 'ai-ask', model: 'gpt-4o',
        inputTokens, outputTokens, apiKeySource: 'PERSONAL',
      })
   f. 返回 { content, model: 'gpt-4o', apiKeySource: 'PERSONAL' }

4. 前端展示 apiKeySource = 'PERSONAL' → 标签「Using Your Key」
```

#### 边界场景

| 场景                                     | 处理                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Bob 只配了 OpenAI，但模型路由想用 Claude | `modelResolver` 按 `availableProviders=['openai']` 过滤，只从 OpenAI 模型池选                                     |
| OpenAI 调用 401（Key 失效）              | `AiChatService` 捕获 → 标记 `UserApiKey.testStatus='failed'` → 抛 `InvalidApiKeyError` → 前端显示「Key 失效」卡片 |
| OpenAI 配额耗尽 429                      | 同上，但错误消息区分「quota」vs「invalid」                                                                        |
| 用户同时有 Personal 和 Assignment        | `resolveKey` 返回 `PERSONAL`（优先级高），Assignment 不扣                                                         |
| 首页游客访问                             | 一期**不支持**，AuthGuard 强制登录                                                                                |

#### 验收标准

- [ ] 流式响应正常，首包 < 2s
- [ ] 响应末尾包含 `apiKeySource` 字段
- [ ] 用户只配 OpenAI 时，不会路由到 Claude 再报错
- [ ] Key 失效时 UI 给出明确 CTA（前往更新）
- [ ] 成本记录中 `apiKeySource` 字段正确

---

### 旅程 J3：用户配置/更新自己的 Key（设置页）

#### 场景

Bob 想新增 Anthropic Key，或更新已有的 OpenAI Key。

#### UI 流程

```
[侧边栏] → [设置] → [API Keys]
   ↓ 路径 /settings/api-keys
   ↓
[Tab 1: 我的 Key] （默认激活）
   ┌──────────────────────────────────────────┐
   │ 已配置 3 个 Provider                      │
   │                                           │
   │ ┌────────────────────────────────────┐   │
   │ │ [OpenAI]      ●已激活  sk-...a3f8 │   │
   │ │ 首选模型: gpt-4o                   │   │
   │ │ [编辑] [测试] [删除]                │   │
   │ └────────────────────────────────────┘   │
   │                                           │
   │ ┌────────────────────────────────────┐   │
   │ │ [Anthropic]   未配置                │   │
   │ │ [+ 添加 Key]                         │   │
   │ └────────────────────────────────────┘   │
   └──────────────────────────────────────────┘

[Tab 2: 管理员分配] （只读）
   ┌──────────────────────────────────────────┐
   │ Google (Gemini)                           │
   │ 剩余额度: $8.50 / $10.00                  │
   │ 到期时间: 2026-06-30                      │
   │ [查看用量明细]                             │
   └──────────────────────────────────────────┘

[Tab 3: 我的申请]
   ┌──────────────────────────────────────────┐
   │ #1  申请 Claude Key     [PENDING]  待审批  │
   │ #2  申请 xAI Key        [APPROVED] 已获批  │
   │ #3  申请 OpenAI 扩额    [REJECTED] 已拒绝  │
   │ [+ 新建申请]                               │
   └──────────────────────────────────────────┘
```

#### 后端数据流

- **列表**: `GET /user/api-keys` → `UserApiKeysService.listUserApiKeys(userId)` → 返回脱敏的 `keyHint`
- **新增/编辑**: `PUT /user/api-keys/:provider` → `saveKey()` → 清缓存
- **测试**: `POST /user/api-keys/:provider/test` → 调用一次 provider 的 `models.list` 端点，15s 超时
- **删除**: `DELETE /user/api-keys/:provider` → 物理删除 + 清缓存

#### 边界场景

- 用户同一 Provider 重复配置：走 upsert，不报错
- Key 格式校验：前端 regex（`sk-...`），后端不强校验（避免 provider 未来改格式）
- 测试失败但用户坚持保存：允许保存，但 `testStatus='failed'` 标记红色警告

#### 验收标准

- [ ] 列表默认脱敏（只显示 `sk-...a3f8`）
- [ ] 测试按钮独立于保存，可单独验证
- [ ] 删除有二次确认弹窗
- [ ] 保存后 AI 调用立即生效（缓存已清）

---

### 旅程 J4：用户无 Key 申请管理员分配

#### 场景

Carol 新注册，自己买不到 OpenAI Key（比如地区限制），走申请流程。

#### UI 流程

```
[入口 1] 引导页点「我没有 Key」
[入口 2] 设置页「我的申请」Tab 点「+ 新建申请」
[入口 3] AI 调用失败时错误卡片的「申请 Key」按钮
   ↓
[申请表] /settings/api-keys/request
   ┌──────────────────────────────────────────┐
   │ 申请 API Key                              │
   │                                           │
   │ Provider *       [OpenAI ▼]               │
   │ 使用目的 *       [____________________]   │
   │ 预计用量         [ ] 轻度 < $5/月        │
   │                  [x] 中度 $5-20/月       │
   │                  [ ] 重度 > $20/月       │
   │ 备注             [____________________]   │
   │                                           │
   │ [提交申请]                                 │
   └──────────────────────────────────────────┘
   ↓ 提交后显示
[等待页]
   ┌──────────────────────────────────────────┐
   │ ✓ 申请已提交                              │
   │                                           │
   │ 申请编号: #12                             │
   │ 状态: PENDING                             │
   │ 管理员通常在 24 小时内处理                 │
   │                                           │
   │ [返回主页]  [查看所有申请]                 │
   └──────────────────────────────────────────┘
```

#### 后端数据流

```
POST /user/key-requests
Body: { provider, reason, estimatedUsage, note? }
  ↓
KeyRequestsService.create(userId, body)
  ↓
1. 校验：同 provider 是否已有 PENDING 申请（防重复）
2. INSERT key_requests (userId, provider, reason, ..., status='PENDING')
3. 通知管理员（一期：仅写入 adminNotifications 表，管理员主动查看）
4. 返回 requestId
```

#### 边界场景

- 重复申请同一 Provider：返回 409，提示「已有待审批申请」
- 申请被拒绝后重新申请：允许（查询时 status !== 'PENDING' 的不计）
- 用户已有 Personal Key 还要申请：允许（比如用户想要分配 Key 作为备份）

#### 验收标准

- [ ] 同 Provider 最多 1 个 PENDING 申请
- [ ] 申请提交立即可在 Tab 3 看到
- [ ] 管理员审批后，Tab 3 状态自动更新（需前端轮询或 WS）
- [ ] 拒绝申请时用户收到拒绝理由

---

### 旅程 J5：管理员维护分发池与处理申请

#### 场景

Admin Dan 需要：① 录入新采购的分发 Key，② 审批 Carol 的申请并分配 Key。

#### UI 流程（管理员后台）

```
[管理员侧边栏] → [访问控制]
   ├─ Secrets (已有)            系统 Secret 管理
   ├─ Distributable Keys (新增) 分发 Key 池
   ├─ Key Assignments (新增)    已分配清单
   └─ Key Requests (新增)       申请工单
```

##### 5.1 管理分发 Key 池 `/admin/access/distributable-keys`

```
┌──────────────────────────────────────────────────────┐
│ 分发 Key 池                       [+ 新增分发 Key]   │
├──────────────────────────────────────────────────────┤
│                                                       │
│ ┌──────────────────────────────────────────────────┐ │
│ │ [OpenAI] 采购-2026Q2                             │ │
│ │ Key: sk-...b3c9  |  激活  |  6/10 已分配         │ │
│ │ 月配额: $500  已用: $127.50                      │ │
│ │ 过期: 2027-01-01                                  │ │
│ │ [查看分配] [编辑] [停用]                          │ │
│ └──────────────────────────────────────────────────┘ │
│                                                       │
│ ┌──────────────────────────────────────────────────┐ │
│ │ [Anthropic] 采购-2026Q2                          │ │
│ │ Key: sk-ant-...  |  激活  |  2/5 已分配          │ │
│ │ 月配额: $300  已用: $45.00                       │ │
│ │ [查看分配] [编辑] [停用]                          │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

**新增/编辑弹窗字段**：

- Provider（下拉）
- Label（显示名，如「采购-2026Q2」）
- API Key（密码输入，支持显示/隐藏）
- API Endpoint（可选，默认官方）
- 月配额（美分，整数，可空＝无限）
- 过期时间（可空）
- 激活状态（toggle）

##### 5.2 分配 Key 弹窗

```
[点击某 Distributable Key] → [点击「+ 分配给用户」]
   ↓
┌──────────────────────────────────────────┐
│ 分配 OpenAI 采购-2026Q2                  │
├──────────────────────────────────────────┤
│ 用户          [搜索用户...]              │
│ 用户配额      [$  20.00 ] (可空=无限)    │
│ 有效期        [2026-06-30]               │
│ 备注          [_________________]        │
│                                           │
│ [取消]                      [确认分配]    │
└──────────────────────────────────────────┘
```

##### 5.3 申请工单 `/admin/access/key-requests`

```
┌──────────────────────────────────────────────────────┐
│ Key 申请工单                     [筛选: 待处理 ▼]   │
├──────────────────────────────────────────────────────┤
│                                                       │
│ #12  carol@example.com  OpenAI  [PENDING]            │
│      使用目的: 研究用，需要调 gpt-4o                  │
│      预计用量: 中度 $5-20/月                          │
│      申请时间: 2026-04-20 10:23                      │
│      [拒绝]  [批准并分配]                             │
│                                                       │
│ #11  bob@example.com  Claude   [APPROVED]            │
│      由 dan@admin 于 2026-04-19 处理                 │
│                                                       │
└──────────────────────────────────────────────────────┘
```

##### 5.4 批准弹窗

```
[点击「批准并分配」]
   ↓
┌──────────────────────────────────────────┐
│ 批准申请 #12                              │
├──────────────────────────────────────────┤
│ 选择 Key      [OpenAI 采购-2026Q2 ▼]    │
│ 用户配额      [$ 10.00 ]                 │
│ 有效期        [2026-06-30]               │
│ 管理员备注    [_________________]        │
│                                           │
│ [取消]        [确认批准并分配]            │
└──────────────────────────────────────────┘
```

#### 后端数据流

```
① 新增分发 Key
POST /admin/distributable-keys
  → DistributableKeysService.create({provider, label, apiKey, quota...})
  → EncryptionService.encrypt(apiKey)
  → INSERT distributable_keys

② 分配给用户
POST /admin/distributable-keys/:id/assign
Body: { userId, userQuotaCents?, expiresAt? }
  → KeyAssignmentsService.assign({keyId, userId, quota, expiresAt})
  → INSERT key_assignments (status='ACTIVE')
  → 清缓存 invalidateUserKeyCache(userId)
  → 发通知给用户

③ 批准申请 + 分配（组合操作）
POST /admin/key-requests/:id/approve
Body: { keyId, userQuotaCents, expiresAt }
  → 事务：
     a. SELECT key_requests WHERE id=:id AND status='PENDING' FOR UPDATE
     b. KeyAssignmentsService.assign(...)
     c. UPDATE key_requests SET status='APPROVED', handledBy, handledAt
  → 发通知给用户
```

#### 边界场景

- 用户已有同 Provider 的 Assignment：返回 409，提示「已有分配，请先撤销」
- 分发 Key 配额已满：`SELECT distributable_keys WHERE current_spend < monthly_quota`，过滤掉
- 批准申请时 Key 已停用：返回 400
- 并发两个管理员同时批准同一申请：`FOR UPDATE` 锁行保证一致性

#### 验收标准

- [ ] 分发 Key 录入成功后加密存储，解密可得原文
- [ ] 同用户同 Provider 的分配唯一（`@@unique([userId, provider])`）
- [ ] 批准操作事务原子性：要么 assignment 创建成功且 request 标记 APPROVED，要么都回滚
- [ ] 管理员页面支持按 status 筛选、按时间排序

---

### 旅程 J6：管理员自己使用 AI

#### 场景

Admin Dan 也要使用 AI 功能（比如做 Research）。

#### UI 流程

与普通用户完全一致（J2），只是 `apiKeySource='SYSTEM'` 标签。

#### 后端数据流

```
AiChatService.chat → keyResolver.resolveKey(userId=dan, provider='openai')
  ↓
检查 user.role === 'ADMIN'  ← 关键分支
  ↓ yes
从 Secret 表读 system-openai-api-key
  ↓
返回 { source: 'SYSTEM', apiKey, endpoint }
```

#### 边界场景

- 管理员的 `user_api_keys` 表里也配了 Key → **忽略**，管理员永远走系统 Key（避免混淆）
- 管理员收到 Assignment → 同样忽略

> **决策理由**：管理员不应该「偶尔用自己 Key，偶尔用系统 Key」，账单归属会乱。如果 Admin 想体验普通用户 Key 路径，应该用测试账号。

#### 验收标准

- [ ] Admin 调 AI 必走 System Key
- [ ] `apiKeySource='SYSTEM'`
- [ ] Admin 配置的 Personal Key 不影响行为（但允许存在，作为兼容）

---

### 旅程 J7：Key 失效 / 配额耗尽的异常处理

#### 场景

- **J7a**：Bob 的 OpenAI Key 被他在 Dashboard 上撤销，调用返回 401
- **J7b**：Carol 的 Assignment 配额（$10）用完
- **J7c**：OpenAI 服务宕机（500/503）
- **J7d**：用户的 Key 临近过期

#### 处理策略

##### J7a：Personal Key 401

```
AiApiCallerService.call(... Key=Bob-OpenAI)
  ↓ 401
抛 InvalidApiKeyError(provider='openai', source='PERSONAL')
  ↓
AiChatService 捕获：
  a. UPDATE user_api_keys SET is_active=false, test_status='failed', last_tested_at=NOW()
     WHERE user_id=Bob AND provider='openai'
  b. invalidateUserKeyCache(Bob)
  c. 检查是否有 Assignment 可退路
     - 有 → 自动切换到 Assignment，提示「Personal Key 失效，已临时使用分配的 Key」
     - 无 → 抛 NoAvailableKeyError，前端显示更新 Key 卡片
```

##### J7b：Assignment 配额耗尽

```
KeyResolver.resolveKey → 检查 assignment.userSpendCents < assignment.userQuotaCents
  ↓ false
过滤掉该 assignment，继续往下找
  ↓ 没有其他 Key
抛 QuotaExceededError(provider, source='ASSIGNED')
  ↓
前端显示：
┌────────────────────────────────────┐
│ 你的 OpenAI 配额已用完              │
│ 已用: $10.00 / $10.00              │
│ [申请扩额]  [配置自己的 Key]        │
└────────────────────────────────────┘
```

##### J7c：Provider 宕机

```
AiApiCallerService.call → 5xx / timeout
  ↓
不标记 Key 失效（Key 是好的）
  ↓
利用现有 Circuit Breaker 机制（已存在）
  ↓
fallback 到同 provider 的其他模型 或 抛 ProviderUnavailableError
  ↓
前端提示「OpenAI 服务暂时不可用，请稍后重试」
```

##### J7d：过期预警

```
定时任务 EveryDayAt('09:00')
  ↓
SELECT * FROM key_assignments WHERE expires_at < NOW() + INTERVAL '7 days'
   AND status='ACTIVE' AND notified_expiring_at IS NULL
  ↓
发通知给用户 + UPDATE notified_expiring_at
```

#### 验收标准

- [ ] Personal Key 401 后自动标记为 inactive，不会继续消耗用户请求
- [ ] Assignment 配额耗尽时，前端有清晰提示和 CTA
- [ ] Provider 宕机时**不误标**用户 Key 失效
- [ ] 过期前 7 天发预警（可选一期不做，但字段要预留）

---

### 旅程 J8：用户查看用量

#### 场景

Bob 想知道这个月花了多少 AI 费用，尤其是管理员给他分配的 Key 用了多少。

#### UI 流程

```
[设置] → [API Keys] → [用量] Tab
   ↓
┌──────────────────────────────────────────────────┐
│ 本月用量 (2026-04)                               │
│                                                   │
│ 总支出: $12.45                                   │
│ ├─ Personal OpenAI: $5.30  (85 次调用)          │
│ ├─ Personal Anthropic: $2.15  (28 次)            │
│ └─ 管理员分配 Google: $5.00  (剩余 $5.00)       │
│                                                   │
│ [查看历史 30 天]  [导出 CSV]                     │
└──────────────────────────────────────────────────┘
```

#### 后端数据流

```
GET /user/usage?period=month
  ↓
CostAttributionService.getReport({
  userId,
  period: { start: startOfMonth, end: now },
  groupBy: ['apiKeySource', 'provider'],
})
  ↓
返回聚合结果
```

> **依赖**：现有 `CostAttributionService` 需扩展支持 `apiKeySource` 维度。

#### 验收标准

- [ ] 按 Key Source 分组展示
- [ ] Assignment 剩余配额实时准确
- [ ] 数据与 `credit_transactions` 表可对账

---

### 旅程 J9：后台异步任务使用 Key

#### 场景

Bob 发起了一个 Research 任务，后台 Worker 跑 20 分钟。Worker 需要知道用 Bob 的 Key 调 LLM。

#### 数据流

```
1. Bob 点击「开始 Research」
   POST /research/start → ResearchController
   ↓
   ResearchController 内：
   const userId = req.user.id
   await researchQueue.add('run-research', {
     researchId,
     userId,  // ← 必须显式传入
     taskId,
   })
   ↓
   返回 { jobId }

2. Worker 收到 job
   @Processor('research')
   class ResearchProcessor {
     @Process('run-research')
     async handle(job: Job) {
       const { userId, researchId } = job.data

       // ★ 关键：在 RequestContext 中恢复 userId
       return RequestContext.run({ userId, requestId: job.id }, async () => {
         await this.researchService.execute(researchId)
         // 内部调 AiChatService，会自动拿到 userId 解析 Key
       })
     }
   }
```

#### 规范与保护

新增规范文档 `docs/development/async-task-userId-guide.md`（或加到 CLAUDE.md）：

> **所有 BullMQ Job payload 必须包含 `userId`，所有 @Processor 方法必须用 `RequestContext.run({userId})` 包裹。违者 PR 会被 Reviewer Agent 阻断。**

**ESLint 规则（可选）**：写一个简单 rule 检测 `@Processor` 类内是否调用了 `RequestContext.run`，没有就报错。

#### 验收标准

- [ ] Research / Topic Insights / 所有长流程任务都改造
- [ ] Worker 内调用 LLM 能正确解析到对应用户的 Key
- [ ] Job 失败重试时 userId 不丢失
- [ ] 缺失 userId 的 Job 被拒绝入队（Service 层校验）

---

### 旅程 J10：用户切换 Provider / 模型

#### 场景

Bob 配了 OpenAI 和 Anthropic 两个 Key，在 Ask AI 页面手动切换到 Claude 提问。

#### UI 流程

```
[Ask AI 输入框右上角] [模型选择器 ▼]
   ↓ 点击展开
┌────────────────────────────────────┐
│ 📍 可用模型（基于你的 Key）        │
│                                     │
│ [OpenAI]                            │
│   ● gpt-4o           (默认)         │
│   ○ gpt-4o-mini                     │
│                                     │
│ [Anthropic]                         │
│   ○ claude-3-5-sonnet               │
│   ○ claude-3-5-haiku                │
│                                     │
│ [管理员分配]                        │
│   ○ gemini-2.0-flash (剩余 $5)     │
│                                     │
│ ─────────────────                   │
│ [自动选择]                           │
└────────────────────────────────────┘
```

#### 后端支撑

```
GET /user/available-models
  ↓
UserApiKeysService.getAvailableProviders(userId) → ['openai', 'anthropic']
KeyAssignmentsService.getAvailableProviders(userId) → ['google']
合并 = ['openai', 'anthropic', 'google']
  ↓
ModelResolver.listEnabledModels({
  availableProviders: merged,
  modelType: 'CHAT',
})
  ↓
返回按 provider 分组的模型列表
```

#### 验收标准

- [ ] 列表只显示用户**真的能用**的模型
- [ ] 「自动选择」使用 IntelligentModelRouter
- [ ] 选中模型在当前会话持久化，刷新不丢
- [ ] Admin 看到**所有启用的模型**（不过滤）

---

## 6. 系统架构设计

### 6.1 模块依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                     AI App Modules                          │
│  research / teams / writing / ask / office / ...            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              AI Engine (facade entry only)                  │
│  AiChatService.chat()  ← 唯一 LLM 调用入口                  │
│       │                                                      │
│       ├─→ KeyResolverService.resolveKey()  ← 新增           │
│       │       ├─→ UserApiKeysService (Personal)             │
│       │       ├─→ KeyAssignmentsService (Assigned) ← 新增   │
│       │       └─→ SecretsService (System, Admin only)       │
│       │                                                      │
│       ├─→ ModelResolver.selectModel({availableProviders})   │
│       │                                                      │
│       └─→ AiApiCallerService.callWithKey(resolved, model)   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               Platform / L1 基础设施                        │
│  ├─ credentials/user-api-keys/  (个人 Key)                  │
│  ├─ credentials/distributable-keys/  ← 新增（分发 Key 池）  │
│  ├─ credentials/key-assignments/     ← 新增（分配关系）      │
│  ├─ credentials/key-requests/        ← 新增（申请工单）      │
│  ├─ credentials/key-resolver/        ← 新增（统一解析）      │
│  ├─ credentials/encryption/          ← 新增（独立加密工具）  │
│  ├─ credentials/secrets/             (系统 Key)             │
│  └─ credits/                         (成本记录)             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 新增模块清单

| 模块                 | 路径                                                           | 职责                                                       |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `encryption`         | `backend/src/modules/platform/credentials/encryption/`         | 统一 AES-256-CBC 加密服务（提取自 UserApiKeys 和 Secrets） |
| `key-resolver`       | `backend/src/modules/platform/credentials/key-resolver/`       | 统一 Key 解析：Personal → Assigned → System（按角色）      |
| `distributable-keys` | `backend/src/modules/platform/credentials/distributable-keys/` | 管理员维护的可分发 Key 池                                  |
| `key-assignments`    | `backend/src/modules/platform/credentials/key-assignments/`    | 分发 Key 与用户的分配关系 + 配额管理                       |
| `key-requests`       | `backend/src/modules/platform/credentials/key-requests/`       | 用户申请工单                                               |

### 6.3 改造模块清单

| 模块                                                                         | 改造内容                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `ai-engine/llm/ai-chat.service.ts`                                           | 移除 Path A/B 分支，统一走 KeyResolver              |
| `ai-engine/llm/ai-model-config.service.ts`                                   | `resolveApiKey` 废弃，替换为 KeyResolver            |
| `ai-engine/facade/model-resolver.service.ts`                                 | 新增 `availableProviders` 过滤参数                  |
| `ai-engine/routing/intelligent-model-router.service.ts`                      | strategy 增加 `availableProviders`                  |
| `platform/credentials/user-api-keys/user-api-keys.service.ts`                | 停写 donation 字段 + 新增 `getAvailableProviders()` |
| `platform/credentials/user-api-keys/user-api-keys.controller.ts`             | 删除 donate/withdraw 端点 + 新增 test 端点          |
| `ai-harness/tracing/cost-attribution.service.ts`（或 ai-engine/llm/billing） | `CostEvent` 增加 `apiKeySource` 字段                |

---

## 7. 数据模型（Prisma Schema Diff）

### 7.1 新增表

#### `distributable_keys`

```prisma
/// 管理员采购的可分发 API Key 池
/// 与系统自用 Secret 物理隔离，便于账单清晰
model DistributableKey {
  id                String   @id @default(cuid())
  provider          String   @db.VarChar(50)      // openai / anthropic / google / xai / ...
  label             String   @db.VarChar(200)     // "OpenAI 采购-2026Q2"
  encryptedValue    String   @map("encrypted_value") @db.Text
  iv                String   @db.VarChar(32)
  keyHint           String?  @map("key_hint") @db.VarChar(20)
  keyVersion        Int      @default(1) @map("key_version")
  apiEndpoint       String?  @map("api_endpoint") @db.Text

  // 池级配额：整个 Key 的月度上限，所有 Assignment 共享扣减
  monthlyQuotaCents Int?     @map("monthly_quota_cents")     // null = 无限
  currentSpendCents Int      @default(0) @map("current_spend_cents")
  quotaResetAt      DateTime @default(now()) @map("quota_reset_at")  // 下次重置时间

  // 状态
  isActive          Boolean   @default(true) @map("is_active")
  expiresAt         DateTime? @map("expires_at")

  // 审计
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")
  createdBy         String?   @map("created_by") @db.VarChar(100)
  updatedBy         String?   @map("updated_by") @db.VarChar(100)

  assignments       KeyAssignment[]

  @@index([provider, isActive])
  @@index([expiresAt])
  @@map("distributable_keys")
}
```

#### `key_assignments`

```prisma
/// 管理员把 DistributableKey 分配给某用户的关系
model KeyAssignment {
  id               String   @id @default(cuid())
  keyId            String   @map("key_id")
  userId           String   @map("user_id")
  provider         String   @db.VarChar(50)   // 冗余字段，用于快速查询和唯一约束

  // 用户级配额：该用户在这个 Key 上的上限
  userQuotaCents   Int?     @map("user_quota_cents")     // null = 使用池级配额
  userSpendCents   Int      @default(0) @map("user_spend_cents")

  // 状态
  status           KeyAssignmentStatus @default(ACTIVE)
  assignedAt       DateTime @default(now()) @map("assigned_at")
  assignedBy       String?  @map("assigned_by") @db.VarChar(100)
  expiresAt        DateTime? @map("expires_at")
  revokedAt        DateTime? @map("revoked_at")
  revokedBy        String?  @map("revoked_by") @db.VarChar(100)
  revokedReason    String?  @map("revoked_reason") @db.Text
  note             String?  @db.Text

  // 过期通知追踪（避免重复提醒）
  notifiedExpiringAt DateTime? @map("notified_expiring_at")

  key  DistributableKey @relation(fields: [keyId], references: [id], onDelete: Cascade)
  user User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, provider])   // 每用户每 provider 只有一个活跃分配
  @@index([userId, status])
  @@index([keyId, status])
  @@index([expiresAt, status])
  @@map("key_assignments")
}

enum KeyAssignmentStatus {
  ACTIVE
  SUSPENDED
  EXPIRED
  REVOKED
}
```

#### `key_requests`

```prisma
/// 用户申请 Key 的工单
model KeyRequest {
  id              String   @id @default(cuid())
  userId          String   @map("user_id")
  provider        String   @db.VarChar(50)
  reason          String?  @db.Text
  estimatedUsage  String?  @map("estimated_usage") @db.VarChar(20) // 'LIGHT' / 'MEDIUM' / 'HEAVY'
  note            String?  @db.Text

  status          KeyRequestStatus @default(PENDING)
  handledBy       String?  @map("handled_by") @db.VarChar(100)
  handledAt       DateTime? @map("handled_at")
  rejectionReason String?  @map("rejection_reason") @db.Text
  resultingAssignmentId String? @map("resulting_assignment_id")  // 批准后关联的 Assignment

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([status, createdAt])
  @@map("key_requests")
}

enum KeyRequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}
```

### 7.2 User 表扩展

```prisma
model User {
  // ...已有字段保留
  byokOnboardedAt DateTime? @map("byok_onboarded_at")  // 引导流程完成时间

  // 新增反向关系
  keyAssignments  KeyAssignment[]
  keyRequests     KeyRequest[]
}
```

### 7.3 废弃字段（不删除，停止写入）

```prisma
model UserApiKey {
  // 以下字段标记废弃，代码停止读写，等 Phase 后期大版本再 DROP COLUMN
  mode               UserApiKeyMode @default(PERSONAL)  // @deprecated 永远为 PERSONAL
  donatedSecretId    String?  // @deprecated
  usageCount         Int @default(0)  // @deprecated
  donationRewardedAt DateTime?  // @deprecated
}
```

### 7.4 手写迁移 SQL

**按项目规范使用手写 SQL，不用 `prisma migrate dev`**

文件：`backend/prisma/migrations/20260421_byok_v2/migration.sql`

```sql
-- ============================================
-- Phase 1: BYOK v2 数据模型
-- ============================================

-- 1. 新增 User.byok_onboarded_at 字段
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "byok_onboarded_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "users_byok_onboarded_at_idx" ON "users"("byok_onboarded_at");

-- 2. KeyAssignmentStatus 枚举
DO $$ BEGIN
  CREATE TYPE "KeyAssignmentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. KeyRequestStatus 枚举
DO $$ BEGIN
  CREATE TYPE "KeyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4. distributable_keys 表
CREATE TABLE IF NOT EXISTS "distributable_keys" (
  "id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "encrypted_value" TEXT NOT NULL,
  "iv" VARCHAR(32) NOT NULL,
  "key_hint" VARCHAR(20),
  "key_version" INTEGER NOT NULL DEFAULT 1,
  "api_endpoint" TEXT,
  "monthly_quota_cents" INTEGER,
  "current_spend_cents" INTEGER NOT NULL DEFAULT 0,
  "quota_reset_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" VARCHAR(100),
  "updated_by" VARCHAR(100),
  CONSTRAINT "distributable_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "distributable_keys_provider_is_active_idx"
  ON "distributable_keys"("provider", "is_active");
CREATE INDEX IF NOT EXISTS "distributable_keys_expires_at_idx"
  ON "distributable_keys"("expires_at");

-- 5. key_assignments 表
CREATE TABLE IF NOT EXISTS "key_assignments" (
  "id" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "user_quota_cents" INTEGER,
  "user_spend_cents" INTEGER NOT NULL DEFAULT 0,
  "status" "KeyAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_by" VARCHAR(100),
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_by" VARCHAR(100),
  "revoked_reason" TEXT,
  "note" TEXT,
  "notified_expiring_at" TIMESTAMP(3),
  CONSTRAINT "key_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "key_assignments_key_id_fkey"
    FOREIGN KEY ("key_id") REFERENCES "distributable_keys"("id") ON DELETE CASCADE,
  CONSTRAINT "key_assignments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "key_assignments_user_id_provider_key"
  ON "key_assignments"("user_id", "provider");
CREATE INDEX IF NOT EXISTS "key_assignments_user_id_status_idx"
  ON "key_assignments"("user_id", "status");
CREATE INDEX IF NOT EXISTS "key_assignments_key_id_status_idx"
  ON "key_assignments"("key_id", "status");
CREATE INDEX IF NOT EXISTS "key_assignments_expires_at_status_idx"
  ON "key_assignments"("expires_at", "status");

-- 6. key_requests 表
CREATE TABLE IF NOT EXISTS "key_requests" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" VARCHAR(50) NOT NULL,
  "reason" TEXT,
  "estimated_usage" VARCHAR(20),
  "note" TEXT,
  "status" "KeyRequestStatus" NOT NULL DEFAULT 'PENDING',
  "handled_by" VARCHAR(100),
  "handled_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "resulting_assignment_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "key_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "key_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "key_requests_user_id_status_idx"
  ON "key_requests"("user_id", "status");
CREATE INDEX IF NOT EXISTS "key_requests_status_created_at_idx"
  ON "key_requests"("status", "created_at");

-- 7. 数据迁移：已存在用户设为已引导（避免老用户被强制走新引导）
UPDATE "users" SET "byok_onboarded_at" = "created_at" WHERE "byok_onboarded_at" IS NULL;
```

---

## 8. 后端服务设计

### 8.1 `EncryptionService`（新增）

**路径**: `backend/src/modules/platform/credentials/encryption/encryption.service.ts`

```typescript
@Injectable()
export class EncryptionService {
  private readonly encryptionKey: Buffer;

  constructor(private configService: ConfigService) {
    const key = this.configService.get<string>("SETTINGS_ENCRYPTION_KEY");
    // ...复用现有 UserApiKeysService 的 key 派生逻辑（PBKDF2, 100k 迭代）
  }

  encrypt(plaintext: string): { encryptedValue: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    return { encryptedValue: encrypted, iv: iv.toString("hex") };
  }

  decrypt(encryptedValue: string, ivHex: string): string | null {
    try {
      const iv = Buffer.from(ivHex, "hex");
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        this.encryptionKey,
        iv,
      );
      let decrypted = decipher.update(encryptedValue, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch {
      return null;
    }
  }

  /**
   * 生成 Key 的脱敏提示（例："sk-...a3f8"）
   */
  createKeyHint(plaintext: string): string {
    if (plaintext.length < 10) return "***";
    return `${plaintext.slice(0, 3)}...${plaintext.slice(-4)}`;
  }
}
```

**改造点**：

- `UserApiKeysService.encrypt/decrypt` 方法删除，替换为注入 `EncryptionService`
- `SecretsService.encrypt/decrypt` 方法删除，同上
- 全局模块导出，供新表 `DistributableKey` 等复用

### 8.2 `KeyResolverService`（新增，核心）

**路径**: `backend/src/modules/platform/credentials/key-resolver/key-resolver.service.ts`

```typescript
export type KeySource = "PERSONAL" | "ASSIGNED" | "SYSTEM";

export interface ResolvedKey {
  source: KeySource;
  apiKey: string;
  apiEndpoint: string | null;
  provider: string;
  userId: string;
  // 用于调用后扣配额
  assignmentId?: string;
  // 系统 Key 时返回 secretId，便于审计
  secretId?: string;
}

@Injectable()
export class KeyResolverService {
  constructor(
    private prisma: PrismaService,
    private userApiKeysService: UserApiKeysService,
    private keyAssignmentsService: KeyAssignmentsService,
    private secretsService: SecretsService,
    private logger: Logger,
  ) {}

  /**
   * 统一 Key 解析入口
   * @throws NoAvailableKeyError 当没有可用 Key 时（前端应引导到 /settings/api-keys）
   * @throws QuotaExceededError 当 Assignment 配额耗尽
   */
  async resolveKey(userId: string, provider: string): Promise<ResolvedKey> {
    const normalizedProvider = provider.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    // 管理员：仅使用系统 Key
    if (user.role === UserRole.ADMIN) {
      return this.resolveSystemKey(userId, normalizedProvider);
    }

    // 普通用户：Personal → Assigned → 报错
    const personal = await this.userApiKeysService.getPersonalKey(
      userId,
      normalizedProvider,
    );
    if (personal) {
      return {
        source: "PERSONAL",
        apiKey: personal.apiKey,
        apiEndpoint: personal.apiEndpoint ?? null,
        provider: normalizedProvider,
        userId,
      };
    }

    const assigned = await this.keyAssignmentsService.resolveActive(
      userId,
      normalizedProvider,
    );
    if (assigned) {
      return {
        source: "ASSIGNED",
        apiKey: assigned.apiKey,
        apiEndpoint: assigned.apiEndpoint,
        provider: normalizedProvider,
        userId,
        assignmentId: assigned.assignmentId,
      };
    }

    throw new NoAvailableKeyError(normalizedProvider, {
      canRequest: true,
      requestUrl: "/settings/api-keys/request",
    });
  }

  /**
   * 返回用户可用的所有 Provider（用于模型路由过滤）
   * - 普通用户: Personal ∪ Assigned 的 provider 集合
   * - 管理员: 所有有系统 Secret 的 provider
   */
  async getAvailableProviders(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) return [];

    if (user.role === UserRole.ADMIN) {
      return this.secretsService.listAvailableProviders(); // 新增方法
    }

    const [personal, assigned] = await Promise.all([
      this.userApiKeysService.getAvailableProviders(userId), // 新增方法
      this.keyAssignmentsService.getAvailableProviders(userId),
    ]);
    return Array.from(new Set([...personal, ...assigned]));
  }

  private async resolveSystemKey(
    userId: string,
    provider: string,
  ): Promise<ResolvedKey> {
    const secretName = `${provider}-api-key`; // 约定：secret name = `${provider}-api-key`
    const apiKey = await this.secretsService.getValueInternal(secretName);
    if (!apiKey) {
      throw new NoSystemKeyError(provider);
    }
    const endpoint = await this.secretsService.getValueInternal(
      `${provider}-api-endpoint`,
    );
    return {
      source: "SYSTEM",
      apiKey,
      apiEndpoint: endpoint,
      provider,
      userId,
    };
  }

  /**
   * 调用完成后扣 Assignment 配额（仅 ASSIGNED 来源才调用）
   */
  async recordSpend(resolved: ResolvedKey, costCents: number): Promise<void> {
    if (resolved.source !== "ASSIGNED" || !resolved.assignmentId) return;
    await this.keyAssignmentsService.incrementSpend(
      resolved.assignmentId,
      costCents,
    );
  }
}
```

### 8.3 `DistributableKeysService`

**路径**: `backend/src/modules/platform/credentials/distributable-keys/distributable-keys.service.ts`

```typescript
@Injectable()
export class DistributableKeysService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  // 管理员新增
  async create(input: {
    provider: string;
    label: string;
    apiKey: string;
    apiEndpoint?: string;
    monthlyQuotaCents?: number;
    expiresAt?: Date;
    createdBy: string;
  }): Promise<DistributableKey> {
    const { encryptedValue, iv } = this.encryption.encrypt(input.apiKey);
    const keyHint = this.encryption.createKeyHint(input.apiKey);
    return this.prisma.distributableKey.create({
      data: {
        provider: input.provider.toLowerCase(),
        label: input.label,
        encryptedValue,
        iv,
        keyHint,
        apiEndpoint: input.apiEndpoint,
        monthlyQuotaCents: input.monthlyQuotaCents,
        expiresAt: input.expiresAt,
        createdBy: input.createdBy,
      },
    });
  }

  // 解密值（仅内部调用，走 KeyAssignment 解析）
  async getDecryptedValue(
    keyId: string,
  ): Promise<{ apiKey: string; apiEndpoint: string | null } | null> {
    const key = await this.prisma.distributableKey.findUnique({
      where: { id: keyId },
    });
    if (!key || !key.isActive) return null;
    if (key.expiresAt && key.expiresAt < new Date()) return null;

    const apiKey = this.encryption.decrypt(key.encryptedValue, key.iv);
    if (!apiKey) return null;
    return { apiKey, apiEndpoint: key.apiEndpoint };
  }

  async list(filters?: {
    provider?: string;
    isActive?: boolean;
  }): Promise<DistributableKeyView[]> {
    // 返回脱敏列表
  }

  async update(id: string, input: UpdateDistributableKeyInput): Promise<void> {}

  async deactivate(id: string, by: string): Promise<void> {}

  // 月度配额重置（定时任务调用）
  async resetMonthlyQuotas(): Promise<void> {
    await this.prisma.distributableKey.updateMany({
      where: { quotaResetAt: { lte: new Date() } },
      data: { currentSpendCents: 0, quotaResetAt: this.nextMonthStart() },
    });
  }
}
```

### 8.4 `KeyAssignmentsService`

**路径**: `backend/src/modules/platform/credentials/key-assignments/key-assignments.service.ts`

```typescript
@Injectable()
export class KeyAssignmentsService {
  constructor(
    private prisma: PrismaService,
    private distributableKeysService: DistributableKeysService,
    @Optional() private cacheService?: CacheService,
  ) {}

  // 管理员分配
  async assign(input: {
    keyId: string;
    userId: string;
    userQuotaCents?: number;
    expiresAt?: Date;
    assignedBy: string;
    note?: string;
  }): Promise<KeyAssignment> {
    // 校验：同用户同 provider 是否已有 ACTIVE 分配
    const key = await this.prisma.distributableKey.findUnique({
      where: { id: input.keyId },
    });
    if (!key) throw new NotFoundException("Key not found");

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.keyAssignment.findUnique({
        where: {
          userId_provider: { userId: input.userId, provider: key.provider },
        },
      });
      if (existing && existing.status === "ACTIVE") {
        throw new ConflictException(
          "User already has an active assignment for this provider",
        );
      }

      return tx.keyAssignment.create({
        data: {
          keyId: input.keyId,
          userId: input.userId,
          provider: key.provider,
          userQuotaCents: input.userQuotaCents,
          expiresAt: input.expiresAt,
          assignedBy: input.assignedBy,
          note: input.note,
        },
      });
    });
  }

  // 核心：解析用户当前可用的 Assignment
  async resolveActive(
    userId: string,
    provider: string,
  ): Promise<{
    apiKey: string;
    apiEndpoint: string | null;
    assignmentId: string;
  } | null> {
    const assignment = await this.prisma.keyAssignment.findFirst({
      where: {
        userId,
        provider,
        status: "ACTIVE",
      },
      include: { key: true },
    });
    if (!assignment) return null;

    // 校验有效期
    if (assignment.expiresAt && assignment.expiresAt < new Date()) {
      await this.markExpired(assignment.id);
      return null;
    }

    // 校验配额
    if (!this.withinQuota(assignment)) {
      throw new QuotaExceededError(provider, "ASSIGNED");
    }

    // 校验池级 Key 可用
    const decrypted = await this.distributableKeysService.getDecryptedValue(
      assignment.keyId,
    );
    if (!decrypted) return null; // Key 已停用或过期

    return {
      apiKey: decrypted.apiKey,
      apiEndpoint: decrypted.apiEndpoint,
      assignmentId: assignment.id,
    };
  }

  async incrementSpend(assignmentId: string, costCents: number): Promise<void> {
    // 双层扣减：Assignment + DistributableKey
    await this.prisma.$transaction([
      this.prisma.keyAssignment.update({
        where: { id: assignmentId },
        data: { userSpendCents: { increment: costCents } },
      }),
      // 池级累计
      this.prisma.distributableKey.update({
        where: {
          id: (await this.prisma.keyAssignment.findUnique({
            where: { id: assignmentId },
            select: { keyId: true },
          }))!.keyId,
        },
        data: { currentSpendCents: { increment: costCents } },
      }),
    ]);
  }

  async getAvailableProviders(userId: string): Promise<string[]> {
    const rows = await this.prisma.keyAssignment.findMany({
      where: { userId, status: "ACTIVE" },
      select: { provider: true },
      distinct: ["provider"],
    });
    return rows.map((r) => r.provider);
  }

  private withinQuota(assignment: KeyAssignment): boolean {
    if (assignment.userQuotaCents === null) return true; // 无限
    return assignment.userSpendCents < assignment.userQuotaCents;
  }

  async revoke(id: string, by: string, reason?: string): Promise<void> {}

  async listByUser(userId: string): Promise<UserAssignmentView[]> {}

  async listAll(
    filters?: AdminAssignmentFilters,
  ): Promise<AssignmentAdminView[]> {}
}
```

### 8.5 `KeyRequestsService`

**路径**: `backend/src/modules/platform/credentials/key-requests/key-requests.service.ts`

```typescript
@Injectable()
export class KeyRequestsService {
  async create(
    userId: string,
    input: CreateKeyRequestInput,
  ): Promise<KeyRequest> {
    // 校验：同 provider 是否已有 PENDING
    const existing = await this.prisma.keyRequest.findFirst({
      where: { userId, provider: input.provider, status: "PENDING" },
    });
    if (existing) {
      throw new ConflictException(
        "Pending request already exists for this provider",
      );
    }
    return this.prisma.keyRequest.create({ data: { userId, ...input } });
  }

  async approve(
    requestId: string,
    input: {
      keyId: string;
      userQuotaCents?: number;
      expiresAt?: Date;
      approvedBy: string;
    },
  ): Promise<{ request: KeyRequest; assignment: KeyAssignment }> {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.keyRequest.findUnique({
        where: { id: requestId },
      });
      if (!request) throw new NotFoundException();
      if (request.status !== "PENDING")
        throw new ConflictException("Request already handled");

      const assignment = await this.keyAssignmentsService.assign({
        keyId: input.keyId,
        userId: request.userId,
        userQuotaCents: input.userQuotaCents,
        expiresAt: input.expiresAt,
        assignedBy: input.approvedBy,
        note: `Approved from request #${requestId}`,
      });

      const updated = await tx.keyRequest.update({
        where: { id: requestId },
        data: {
          status: "APPROVED",
          handledBy: input.approvedBy,
          handledAt: new Date(),
          resultingAssignmentId: assignment.id,
        },
      });

      return { request: updated, assignment };
    });
  }

  async reject(
    requestId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<KeyRequest> {}

  async listMine(userId: string): Promise<KeyRequest[]> {}

  async listPending(): Promise<KeyRequest[]> {}
}
```

### 8.6 `UserApiKeysService` 改造点

```typescript
// 新增方法
async getAvailableProviders(userId: string): Promise<string[]> {
  const rows = await this.prisma.userApiKey.findMany({
    where: { userId, isActive: true },
    select: { provider: true },
    distinct: ['provider'],
  });
  return rows.map(r => r.provider.toLowerCase());
}

// 改造：saveKey 内触发 onboarded
async saveKey(...): Promise<{success: true}> {
  // ...existing logic
  await this.prisma.$transaction([
    // upsert userApiKey
    this.prisma.userApiKey.upsert({...}),
    // 同事务设置 onboarded
    this.prisma.user.update({
      where: { id: userId, byokOnboardedAt: null },
      data: { byokOnboardedAt: new Date() },
    }),
  ]);
}

// 废弃
// async withdrawDonation(...)  ← 保留方法签名，内部直接 throw NotImplementedError
// async getDonatedKey(...)     ← 同上
```

### 8.7 `AiChatService` 改造

```typescript
async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const userId = options.userId ?? RequestContext.getUserId();
  if (!userId) {
    throw new UnauthorizedException('userId required for AI chat');
  }

  // 1. 解析用户可用 providers
  const availableProviders = await this.keyResolver.getAvailableProviders(userId);
  if (availableProviders.length === 0) {
    throw new NoAvailableKeyError('any', { canRequest: true });
  }

  // 2. 选模型（过滤 providers）
  const modelConfig = await this.modelResolver.selectModel({
    modelType: options.modelType,
    modelId: options.model,
    availableProviders,  // ← 核心改造
  });

  // 3. 解析 Key
  const resolved = await this.keyResolver.resolveKey(userId, modelConfig.provider);

  // 4. Guardrails 输入
  const inputCheck = await this.runInputGuardrails(options.messages, { userId });
  if (!inputCheck.passed) return { content: 'Blocked', isError: true };

  // 5. 调用（一条路径，不再分 Path A/B）
  const result = await this.apiCallerService.callWithResolvedKey({
    modelConfig,
    resolvedKey: resolved,
    messages: options.messages,
    systemPrompt: options.systemPrompt,
    taskProfile: options.taskProfile,
  });

  // 6. Guardrails 输出
  const outputCheck = await this.runOutputGuardrails(result.content, { userId });
  if (!outputCheck.passed) return { content: 'Filtered', isError: true };

  // 7. 扣 Assignment 配额（如果来自 ASSIGNED）
  if (!result.isError) {
    const costCents = this.estimateCostCents(modelConfig, result.usage);
    await this.keyResolver.recordSpend(resolved, costCents);

    this.costAttribution?.recordCost({
      userId,
      moduleType: options.moduleType ?? 'ai-engine',
      model: modelConfig.modelId,
      provider: modelConfig.provider,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCost: costCents / 100,
      apiKeySource: resolved.source,  // ← 新字段
    });
  }

  return {
    ...result,
    apiKeySource: resolved.source,
  };
}
```

---

## 9. API 端点清单

### 9.1 普通用户端点（`/user` 前缀，`@UseGuards(JwtAuthGuard)`）

| Method | Path                            | 说明                                     |
| ------ | ------------------------------- | ---------------------------------------- |
| GET    | `/user/api-keys`                | 列出我的 Personal Key                    |
| PUT    | `/user/api-keys/:provider`      | 新增/更新 Personal Key（触发 onboarded） |
| DELETE | `/user/api-keys/:provider`      | 删除 Personal Key                        |
| POST   | `/user/api-keys/:provider/test` | 拨测 Key                                 |
| GET    | `/user/key-assignments`         | 我被分配的 Key 清单（含剩余额度）        |
| GET    | `/user/key-requests`            | 我的申请工单                             |
| POST   | `/user/key-requests`            | 提交申请                                 |
| DELETE | `/user/key-requests/:id`        | 撤销我的 PENDING 申请                    |
| GET    | `/user/available-models`        | 基于我可用 providers 的模型列表          |
| GET    | `/user/usage?period=month`      | 我的用量报告（按 apiKeySource 分组）     |
| PATCH  | `/user/onboarding/complete`     | 手动标记完成引导（申请后进入系统）       |

### 9.2 管理员端点（`/admin` 前缀，`@UseGuards(JwtAuthGuard, AdminGuard)`）

| Method | Path                                   | 说明                                                         |
| ------ | -------------------------------------- | ------------------------------------------------------------ |
| GET    | `/admin/distributable-keys`            | 列出分发池                                                   |
| POST   | `/admin/distributable-keys`            | 新增分发 Key                                                 |
| GET    | `/admin/distributable-keys/:id`        | Key 详情（含分配列表）                                       |
| PATCH  | `/admin/distributable-keys/:id`        | 更新 Key                                                     |
| DELETE | `/admin/distributable-keys/:id`        | 停用 Key                                                     |
| POST   | `/admin/distributable-keys/:id/assign` | 分配给用户                                                   |
| GET    | `/admin/key-assignments`               | 所有分配概览                                                 |
| PATCH  | `/admin/key-assignments/:id`           | 调整配额 / 暂停                                              |
| DELETE | `/admin/key-assignments/:id`           | 撤销分配                                                     |
| GET    | `/admin/key-requests?status=PENDING`   | 申请列表                                                     |
| POST   | `/admin/key-requests/:id/approve`      | 批准并分配（事务）                                           |
| POST   | `/admin/key-requests/:id/reject`       | 拒绝（需 reason）                                            |
| GET    | `/admin/byok-dashboard`                | 统计：总分发 Key 数、活跃 Assignment、待处理申请、本月总消耗 |

### 9.3 请求限流

| 端点                             | 限制               |
| -------------------------------- | ------------------ |
| `PUT /user/api-keys/*`           | 10 req/min         |
| `POST /user/api-keys/*/test`     | 5 req/min          |
| `POST /user/key-requests`        | 3 req/hour（防刷） |
| `POST /admin/distributable-keys` | 50 req/hour        |

### 9.4 错误码约定

```typescript
enum BYOKErrorCode {
  NO_AVAILABLE_KEY = "NO_AVAILABLE_KEY", // 用户没配任何 Key 也没分配
  INVALID_API_KEY = "INVALID_API_KEY", // Key 测试/调用时返回 401
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED", // Assignment 配额耗尽
  KEY_EXPIRED = "KEY_EXPIRED", // Key 或 Assignment 过期
  DUPLICATE_REQUEST = "DUPLICATE_REQUEST", // 同 provider 已有 PENDING 申请
  ASSIGNMENT_EXISTS = "ASSIGNMENT_EXISTS", // 用户已有 ACTIVE 分配
  NO_SYSTEM_KEY = "NO_SYSTEM_KEY", // 管理员调用但系统 Secret 缺失
}
```

前端错误处理（apiClient）按 `error.code` 分发到对应 UI：

```typescript
// frontend/lib/api/byok-error-handler.ts
export function handleBYOKError(error: ApiError): void {
  switch (error.code) {
    case "NO_AVAILABLE_KEY":
      showNoKeyCard(error.meta.provider); // 显示「前往配置/申请」卡片
      break;
    case "QUOTA_EXCEEDED":
      showQuotaExceededCard(error.meta.provider);
      break;
    case "INVALID_API_KEY":
      showKeyInvalidCard(error.meta.provider);
      break;
    // ...
  }
}
```

---

## 10. 前端架构设计

### 10.1 新增路由

```
frontend/app/
├── settings/
│   ├── layout.tsx                           # 新增：settings 公共布局（侧边 Tab）
│   └── api-keys/
│       ├── page.tsx                         # 主页（3 Tab: 我的 / 分配 / 申请）
│       ├── onboarding/page.tsx              # 首次登录引导
│       ├── request/page.tsx                 # 申请表单
│       └── usage/page.tsx                   # 用量明细
└── admin/access/
    ├── distributable-keys/
    │   ├── page.tsx                         # 分发池列表
    │   └── [id]/page.tsx                    # Key 详情 + 分配管理
    ├── key-assignments/page.tsx             # 所有分配概览
    └── key-requests/page.tsx                # 申请工单处理
```

### 10.2 新增组件清单

**路径**: `frontend/components/byok/`

| 组件                            | 职责                                               |
| ------------------------------- | -------------------------------------------------- |
| `ProviderKeyCard.tsx`           | Provider 卡片（已配/未配状态、编辑/测试/删除按钮） |
| `AssignmentCard.tsx`            | 分配 Key 卡片（剩余额度进度条、到期时间）          |
| `KeyEditorModal.tsx`            | Key 新增/编辑弹窗（带测试按钮、显示/隐藏切换）     |
| `KeyRequestForm.tsx`            | 申请表单（Provider 选择、用量估算、理由）          |
| `OnboardingStepper.tsx`         | 引导页步骤：欢迎 → 选项 → 配置/申请 → 完成         |
| `NoKeyErrorCard.tsx`            | AI 调用失败时的错误卡片（带 CTA）                  |
| `UsageChart.tsx`                | 用量图表（按 apiKeySource 分组）                   |
| `AdminKeyPoolTable.tsx`         | 管理员分发池表格                                   |
| `AdminAssignModal.tsx`          | 管理员分配弹窗                                     |
| `AdminRequestApprovalModal.tsx` | 批准申请弹窗                                       |

### 10.3 新增 Hooks

**路径**: `frontend/hooks/features/`

| Hook                           | 职责                                 | 基于                   |
| ------------------------------ | ------------------------------------ | ---------------------- |
| `useUserApiKeys.ts`            | **已存在**，简化掉 donation 相关逻辑 | -                      |
| `useKeyAssignments.ts`         | 新增，GET /user/key-assignments      | useApiGet              |
| `useKeyRequests.ts`            | 新增，GET/POST /user/key-requests    | useApiGet + useApiPost |
| `useAvailableModels.ts`        | 新增，GET /user/available-models     | useApiGet（缓存 5min） |
| `useAdminDistributableKeys.ts` | 新增，管理员 CRUD                    | useApiGet + useApiPost |
| `useAdminKeyRequests.ts`       | 新增，审批工单                       | useApiGet + useApiPost |

### 10.4 全局拦截（首次登录强制引导）

**由于前端无 `middleware.ts`，采用 AppShell + AuthContext 组合拦截**。

**文件**: `frontend/components/layout/AppShell.tsx`

```tsx
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push("/login");
      return;
    }
    // BYOK 引导拦截
    if (
      user.role === "USER" &&
      !user.byokOnboardedAt &&
      !pathname.startsWith("/settings/api-keys") // 允许访问 onboarding 自身
    ) {
      router.push("/settings/api-keys/onboarding");
    }
  }, [user, isLoading, pathname]);

  // 渲染 ...
}
```

### 10.5 AI 调用错误处理

**文件**: `frontend/lib/api/client.ts` 改造

```typescript
// 在 ApiClient.request 的 catch 中新增
catch (error) {
  if (error.code === 'NO_AVAILABLE_KEY' || error.code === 'QUOTA_EXCEEDED' || error.code === 'INVALID_API_KEY') {
    // 发布全局事件，由 GlobalErrorHandler 消费
    globalErrorBus.emit('byok-error', { code: error.code, meta: error.meta });
  }
  throw error;
}
```

**文件**: `frontend/components/byok/GlobalBYOKErrorHandler.tsx`（新增）

```tsx
// 在 Providers 里引入，监听 byok-error 事件
// 弹出 Modal 显示 NoKeyErrorCard
```

### 10.6 国际化 Key 新增

需给 `frontend/lib/i18n/locales/en.json` 和 `zh.json` 新增 `byok.*` 命名空间，覆盖所有新页面文案。具体清单见 [附录 A](#附录-a-i18n-key-清单)。

---

## 11. 实施阶段规划

### Phase 0：基础重构（2 天）

**目标**: 提取加密工具，为新表做准备。

**任务**：

1. 创建 `backend/src/modules/platform/credentials/encryption/` 模块
2. 提取 `UserApiKeysService.encrypt/decrypt` 到 `EncryptionService`
3. 提取 `SecretsService.encrypt/decrypt` 到 `EncryptionService`
4. 两个 Service 改为注入 `EncryptionService`
5. 跑现有测试验证加密解密兼容（新旧数据都能解密）

**文件改动清单**：

- 新增: `backend/src/modules/platform/credentials/encryption/encryption.service.ts`
- 新增: `backend/src/modules/platform/credentials/encryption/encryption.module.ts`
- 改: `backend/src/modules/platform/credentials/user-api-keys/user-api-keys.service.ts`（替换加密调用）
- 改: `backend/src/modules/platform/credentials/secrets/secrets.service.ts`（替换加密调用）
- 改: `backend/src/modules/platform/platform.module.ts`（导出 EncryptionModule）

**验收**: 现有 UserApiKey 和 Secret 操作不受影响，测试全绿。

---

### Phase 1：数据模型（1 天）

**目标**: 建表。

**任务**：

1. 修改 `backend/prisma/schema/models.prisma`：新增 3 张表 + User 字段
2. 手写 `backend/prisma/migrations/20260421_byok_v2/migration.sql`
3. 运行 `npx prisma generate`
4. 在 Railway 预发环境跑 `npx prisma migrate deploy` 验证 SQL
5. 数据迁移：老用户 `byokOnboardedAt = createdAt`

**验收**: Prisma Client 类型可用，表结构在数据库可见。

---

### Phase 2：后端核心服务（4 天）

**目标**: 实现 KeyResolver + 新增 Service。

**任务**：

1. 创建 `DistributableKeysService` + DTO
2. 创建 `KeyAssignmentsService` + DTO
3. 创建 `KeyRequestsService` + DTO
4. 创建 `KeyResolverService`（核心）
5. 改造 `UserApiKeysService`：新增 `getAvailableProviders()`，`saveKey()` 内触发 `byokOnboardedAt`
6. 改造 `AiChatService.chat()`：统一走 KeyResolver，传 `availableProviders` 到 `modelResolver`
7. 改造 `ModelResolver.selectModel()`：接受 `availableProviders` 参数
8. 改造 `AiApiCallerService`：合并 `directKey` 和 `apiCaller` 为 `callWithResolvedKey()`
9. 扩展 `CostAttributionService.CostEvent`：新增 `apiKeySource` 字段
10. 单元测试：KeyResolver 三种路径 + 管理员路径

**文件改动清单**（关键）：

- 新增: `platform/credentials/distributable-keys/`（service, controller, module, dto）
- 新增: `platform/credentials/key-assignments/`（同上）
- 新增: `platform/credentials/key-requests/`（同上）
- 新增: `platform/credentials/key-resolver/key-resolver.service.ts`
- 改: `ai-engine/llm/services/ai-chat.service.ts`
- 改: `ai-engine/facade/model-resolver.service.ts`
- 改: `ai-engine/llm/services/ai-api-caller.service.ts`
- 改: `ai-engine/routing/services/intelligent-model-router.service.ts`（routing 子模块，非 orchestration）
- 改: `platform/credentials/user-api-keys/user-api-keys.service.ts`
- 改: `ai-harness/tracing/cost-attribution.service.ts`（或 ai-engine/llm/billing；原 ai-kernel 已移除）

**验收**: 单元测试覆盖 KeyResolver 全部分支，集成测试 AiChatService 能正确解析 Key。

---

### Phase 3：后端 API 层（2 天）

**目标**: 暴露 HTTP 端点。

**任务**：

1. 创建普通用户 Controller（`/user/key-assignments`, `/user/key-requests`, `/user/available-models`, `/user/usage`）
2. 创建管理员 Controller（`/admin/distributable-keys`, `/admin/key-assignments`, `/admin/key-requests`, `/admin/byok-dashboard`）
3. 完善 DTO 的 class-validator 校验规则
4. 添加 Throttle 限流
5. Swagger 文档注解

**验收**: Postman/Swagger 手测每个端点正常工作。

---

### Phase 4：异步任务上下文（1 天）

**目标**: 所有 Worker 正确恢复 `userId`。

**任务**：

1. 审计所有 `@Processor` 类：research / insight / social-publish / 其他（后端模块目录名）
2. 每个 Worker 入口包裹 `RequestContext.run({ userId: job.data.userId })`
3. 每个 Queue 入队处校验 `userId` 必填（Service 层 throw）
4. 新增 `docs/development/async-task-userId-guide.md`
5. 加到 `CLAUDE.md` 的规则中

**验收**: 通过 Research 长流程任务 E2E 测试，确认 Worker 内能拿到 userId 调 LLM。

---

### Phase 5：管理员前端（3 天）

**目标**: 管理员后台三个页面。

**任务**：

1. `/admin/access/distributable-keys/page.tsx` - 列表 + 新增弹窗 + 详情跳转
2. `/admin/access/distributable-keys/[id]/page.tsx` - Key 详情 + 分配弹窗
3. `/admin/access/key-assignments/page.tsx` - 所有分配概览 + 调整/撤销
4. `/admin/access/key-requests/page.tsx` - 申请工单列表 + 审批弹窗
5. 侧边栏菜单添加新路由
6. 所有 Admin Hook 实现
7. 复用 `AdminPageLayout` + `Modal` + `SecretForm` 的 UI 模式

**验收**: 管理员可以完整走「录入 Key → 分配 → 用户可见」流程。

---

### Phase 6：用户前端（3 天）

**目标**: 用户设置页 + 引导页 + 错误处理。

**任务**：

1. `/settings/layout.tsx` - 公共布局（侧边 Tab）
2. `/settings/api-keys/page.tsx` - 3 Tab 主页（我的 / 分配 / 申请）
3. `/settings/api-keys/onboarding/page.tsx` - 引导页
4. `/settings/api-keys/request/page.tsx` - 申请表单
5. `/settings/api-keys/usage/page.tsx` - 用量明细
6. `AppShell` 新增引导拦截
7. 全局 BYOK 错误处理器（`NoKeyErrorCard` 等）
8. `ModelSelector` 组件改造：按 `availableProviders` 分组显示
9. i18n 文案补全

**验收**: 新用户完整 E2E：登录 → 引导 → 配置 → 使用 AI → 看到 apiKeySource 标签。

---

### Phase 7：清理与上线（2 天）

**任务**：

1. `UserApiKeysService` 废弃方法：`withdrawDonation` / `getDonatedKey` 改为 throw NotImplementedError
2. 前端 `useUserApiKeys` 简化：删除 `mode` 相关 UI
3. 国际化文案审查
4. 生产环境迁移 SQL 执行
5. 运行 `npm run verify:full`
6. 远程环境 E2E 验证（按 [§12 测试用例](#12-验收标准与测试用例)）
7. 编写运维文档：如何在 Secret 表中配置 System Key（for admins）

**验收**: 所有测试通过，远程环境走完 10 条用户旅程。

---

### 总工期估算

| Phase         | 工作量（人日） |
| ------------- | -------------- |
| 0. 基础重构   | 2              |
| 1. 数据模型   | 1              |
| 2. 后端核心   | 4              |
| 3. API 层     | 2              |
| 4. 异步任务   | 1              |
| 5. 管理员前端 | 3              |
| 6. 用户前端   | 3              |
| 7. 清理上线   | 2              |
| **合计**      | **18 人日**    |

---

## 12. 验收标准与测试用例

### 12.1 E2E 测试脚本（tester Agent 执行）

#### T1：新用户引导（对应 J1）

```
场景: 新用户首次登录
前置: 新建 User（byokOnboardedAt=null, role=USER）
步骤:
  1. 登录
  2. 访问 /
预期:
  - 302 重定向到 /settings/api-keys/onboarding
  - 页面显示两个选项
  - 配置 OpenAI Key 并保存
  - User.byokOnboardedAt 已更新
  - 跳转回 /
  - 再次刷新 / 不再重定向
```

#### T2：Personal Key 调用（对应 J2）

```
前置: Bob 已配置 OpenAI Key
步骤:
  1. 访问首页 Ask AI
  2. 发送消息 "Hello"
预期:
  - 200 响应
  - response.apiKeySource === 'PERSONAL'
  - cost_attribution 表记录 apiKeySource='PERSONAL'
```

#### T3：Provider 过滤（对应 J2 边界）

```
前置: Bob 只配了 OpenAI Key，modelType=CHAT 的默认模型是 claude
步骤:
  1. 发送消息
预期:
  - 模型路由选中 gpt-4o（OpenAI 模型），不尝试 Claude
  - 不抛错
```

#### T4：无 Key 用户（对应 J4）

```
前置: Carol 没有 Key 也没有 Assignment
步骤:
  1. 发送消息
预期:
  - 403 + code=NO_AVAILABLE_KEY
  - 前端显示 NoKeyErrorCard，CTA 到 /settings/api-keys/request
```

#### T5：申请批准流（对应 J5）

```
前置: Carol 提交申请，Dan 有可用分发 Key
步骤:
  1. Carol: POST /user/key-requests { provider: 'openai' }
  2. Dan: GET /admin/key-requests
  3. Dan: POST /admin/key-requests/:id/approve { keyId, userQuotaCents: 1000 }
  4. Carol: GET /user/key-assignments
  5. Carol: 发送 AI 消息
预期:
  - 步骤 3 后 key_requests.status='APPROVED'，key_assignments 创建
  - 步骤 4 返回 Assignment
  - 步骤 5 apiKeySource='ASSIGNED'
  - key_assignments.user_spend_cents 已扣减
  - distributable_keys.current_spend_cents 已扣减
```

#### T6：管理员使用 AI（对应 J6）

```
前置: Admin Dan，也配了 Personal Key（测试场景）
步骤:
  1. Dan 发送 AI 消息
预期:
  - apiKeySource === 'SYSTEM'（Personal Key 被忽略）
  - 使用 Secret 表的 openai-api-key
```

#### T7：配额耗尽（对应 J7b）

```
前置: Carol 的 Assignment user_quota_cents=500, user_spend_cents=499
步骤:
  1. 发送一个消耗 > 1 cent 的请求
预期:
  - 第一次调用成功
  - user_spend_cents >= user_quota_cents
  - 下一次调用返回 403 code=QUOTA_EXCEEDED
```

#### T8：Key 失效（对应 J7a）

```
前置: Bob 的 OpenAI Key 已在 OpenAI 端被撤销
步骤:
  1. 发送 AI 消息
预期:
  - 调用返回 401（provider 侧）
  - user_api_keys.is_active=false
  - user_api_keys.test_status='failed'
  - 前端显示 KeyInvalidCard
```

#### T9：并发批准（对应 J5 边界）

```
前置: 同一个 KeyRequest
步骤:
  1. Admin A 和 Admin B 同时 POST /admin/key-requests/:id/approve
预期:
  - 一个成功
  - 另一个收到 409 ConflictException
  - 不会创建两个 Assignment
```

#### T10：后台任务（对应 J9）

```
前置: Bob 启动一个 Research 任务
步骤:
  1. POST /research/start
  2. 等待 Worker 执行
预期:
  - Research 内部 LLM 调用都使用 Bob 的 Key
  - cost_attribution.user_id = Bob
  - 不使用 System Key
```

### 12.2 单元测试清单

| 测试类                     | 路径                                 | 关键 case                                                                                                 |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `KeyResolverService`       | `key-resolver.service.spec.ts`       | 管理员走 System / 用户走 Personal / 用户走 Assigned / 无 Key 抛 NoAvailableKey / 配额耗尽抛 QuotaExceeded |
| `KeyAssignmentsService`    | `key-assignments.service.spec.ts`    | assign 冲突检测 / withinQuota 边界 / incrementSpend 双扣                                                  |
| `KeyRequestsService`       | `key-requests.service.spec.ts`       | 重复 PENDING 拒绝 / approve 事务原子性                                                                    |
| `DistributableKeysService` | `distributable-keys.service.spec.ts` | 加密解密 / 月度重置                                                                                       |
| `AiChatService` (改造)     | `ai-chat.service.spec.ts`            | availableProviders 过滤 / apiKeySource 记录                                                               |

### 12.3 非功能验证

- [ ] 所有 Key 相关操作在 `.env` 的 `SETTINGS_ENCRYPTION_KEY` 变更后能解密（Key Version 字段预留）
- [ ] 10 并发用户同时调 AI，KeyResolver 延迟 P95 < 50ms（有缓存）
- [ ] 日志中无明文 Key 泄漏（grep `sk-` 无匹配）
- [ ] 前端无硬编码 Provider 列表（从 API 动态获取）
- [ ] 所有新端点有 Swagger 注解

---

## 13. 风险登记册

| #   | 风险                                            | 概率 | 影响 | 缓解                                                                 |
| --- | ----------------------------------------------- | ---- | ---- | -------------------------------------------------------------------- |
| R1  | 数据迁移时老用户被迫走新引导                    | 中   | 高   | Phase 1 迁移 SQL 直接 `byok_onboarded_at = created_at`               |
| R2  | `SETTINGS_ENCRYPTION_KEY` 生产环境遗失          | 低   | 致命 | Key 存 1Password + 多人知悉，Key Version 字段预留轮转能力            |
| R3  | 并发扣配额导致透支                              | 中   | 低   | Phase 2 用 `UPDATE ... WHERE spend < quota` 的乐观锁模式，超额时抛错 |
| R4  | Provider API 改变返回格式导致解析失败           | 中   | 中   | Provider 抽象层已存在，新增 Provider 不影响既有                      |
| R5  | 用户大量刷 KeyRequest 骚扰管理员                | 中   | 低   | 限流 3/hour + 同 provider 单 PENDING 约束                            |
| R6  | Admin 忘记分配 Key，新用户无法使用              | 高   | 中   | 提供「邀请码式」简化分配：Admin 预生成「一键领取链接」               |
| R7  | 管理员误配系统 Secret，所有 Admin 无法用 AI     | 中   | 高   | 启动时健康检查，缺少核心 Secret 时告警                               |
| R8  | Provider 过滤逻辑与 IntelligentModelRouter 冲突 | 中   | 中   | Phase 2 单元测试覆盖全部组合                                         |
| R9  | 前端无 `middleware.ts` 拦截时机不准             | 中   | 中   | AppShell 内 useEffect，未引导完先渲染 loading skeleton               |
| R10 | 异步 Worker 漏改 RequestContext 导致 Key 拿不到 | 高   | 高   | 新增 ESLint 规则 + Reviewer Agent 审查 + 运行时强校验 userId 必填    |

---

## 14. 开放问题清单（需 Owner 确认）

| #   | 问题                                      | 建议方案                                       | 备选                             |
| --- | ----------------------------------------- | ---------------------------------------------- | -------------------------------- |
| Q1  | 配额单位用 cents 还是 tokens？            | **cents**（最直观，基于 AIModel 价格计算）     | tokens（跨 provider 不可比）     |
| Q2  | 配额按月自然重置还是分配日滚动？          | **按月自然重置**（UTC 1 日 00:00）             | 滚动（实现复杂）                 |
| Q3  | Admin Personal Key 如何处理？             | **忽略，永远走 System**（账单清晰）            | 允许 Admin 自选模式              |
| Q4  | KeyRequest 通知管理员走什么通道？         | **一期仅页面显示**（Admin 自己查看）           | 邮件 / Slack / WebHook           |
| Q5  | Key 失效是否自动 fallback 到 Assignment？ | **是**（体验好），但显示切换提示               | 否（严格 BYOK）                  |
| Q6  | 前端拦截能否用 Next.js middleware.ts？    | **用 AppShell useEffect**（当前无 middleware） | 新增 middleware.ts（需额外测试） |
| Q7  | 分发 Key 审计日志是否记录每次解析？       | **只记录分配和撤销**（每次解析量太大）         | 全量记录（需单独索引表）         |
| Q8  | 老用户迁移 donation 数据？                | **不迁移**，donation 字段停写，保留数据        | 清空历史 donation 数据           |

---

## 15. 附录

### 附录 A：i18n Key 清单

**文件**: `frontend/lib/i18n/locales/en.json`（zh.json 同步）

```json
{
  "byok": {
    "onboarding": {
      "title": "Welcome to GenesisPod",
      "subtitle": "To use AI features, please configure an API key",
      "optionHaveKey": "I have my own API Key",
      "optionNeedKey": "I need a Key assigned",
      "optionHaveKeyDesc": "Use your own OpenAI / Claude / Google Key",
      "optionNeedKeyDesc": "Request a Key from admin (may take up to 24h)",
      "skip": "Skip for now",
      "configureProvider": "Configure {{provider}}",
      "selectProvider": "Select a provider"
    },
    "settings": {
      "title": "API Keys",
      "tabs": {
        "mine": "My Keys",
        "assigned": "Assigned Keys",
        "requests": "My Requests",
        "usage": "Usage"
      },
      "personal": {
        "empty": "No API keys configured yet",
        "addKey": "Add {{provider}} Key",
        "editKey": "Edit",
        "testKey": "Test Connection",
        "deleteKey": "Delete",
        "keyHint": "Current key: {{hint}}",
        "preferredModel": "Preferred model",
        "customEndpoint": "Custom API endpoint",
        "saveSuccess": "API Key saved",
        "testSuccess": "Key is valid",
        "testFailed": "Key validation failed: {{error}}",
        "deleteConfirm": "Delete {{provider}} Key?",
        "deleteConfirmDesc": "AI calls using this provider will fail until you add a new Key"
      },
      "assigned": {
        "empty": "No keys assigned yet",
        "emptyAction": "Request a Key",
        "quotaLabel": "Quota",
        "quotaRemaining": "{{used}} / {{total}} used",
        "quotaUnlimited": "Unlimited",
        "expiresAt": "Expires {{date}}",
        "expiresIn": "Expires in {{days}} days",
        "viewUsage": "View usage details"
      },
      "requests": {
        "empty": "No requests yet",
        "newRequest": "New Request",
        "form": {
          "provider": "Provider",
          "reason": "Reason for request",
          "reasonPlaceholder": "e.g., Research project requires gpt-4o",
          "estimatedUsage": "Estimated monthly usage",
          "usageLight": "Light (< $5/month)",
          "usageMedium": "Medium ($5-20/month)",
          "usageHeavy": "Heavy (> $20/month)",
          "note": "Additional notes (optional)",
          "submit": "Submit Request"
        },
        "status": {
          "PENDING": "Pending",
          "APPROVED": "Approved",
          "REJECTED": "Rejected",
          "CANCELLED": "Cancelled"
        },
        "submitSuccess": "Request submitted. Admin will process within 24h",
        "rejectedReason": "Reason: {{reason}}"
      }
    },
    "errors": {
      "noAvailableKey": {
        "title": "No API Key available for {{provider}}",
        "description": "Configure your own key or request one from admin",
        "actionConfigure": "Configure Key",
        "actionRequest": "Request Key"
      },
      "quotaExceeded": {
        "title": "{{provider}} quota exceeded",
        "description": "Used {{used}} / {{total}}",
        "actionExtend": "Request More Quota",
        "actionConfigureOwn": "Use Your Own Key"
      },
      "invalidKey": {
        "title": "Your {{provider}} key is invalid",
        "description": "The key may have been revoked or expired",
        "actionUpdate": "Update Key"
      }
    },
    "modelSelector": {
      "yourKeys": "Your Keys",
      "assignedKeys": "Assigned by Admin",
      "autoSelect": "Auto (recommended)",
      "balanceLabel": "Balance: {{balance}}"
    },
    "admin": {
      "distributableKeys": {
        "title": "Distributable Key Pool",
        "subtitle": "API keys purchased for assignment to users",
        "addKey": "Add Key",
        "form": {
          "label": "Label",
          "labelPlaceholder": "e.g., OpenAI Q2-2026 Purchase",
          "provider": "Provider",
          "apiKey": "API Key",
          "apiEndpoint": "API Endpoint (optional)",
          "monthlyQuota": "Monthly Quota (USD)",
          "monthlyQuotaPlaceholder": "e.g., 500 (leave empty for unlimited)",
          "expiresAt": "Expires At (optional)"
        },
        "stats": {
          "assigned": "{{count}} assigned",
          "spendThisMonth": "${{amount}} this month",
          "utilization": "{{percent}}% utilized"
        }
      },
      "assignModal": {
        "title": "Assign {{label}} to User",
        "userSearch": "Search user by email or username",
        "userQuota": "User Quota (USD)",
        "userQuotaDesc": "Maximum this user can spend on this key",
        "expiresAt": "Assignment Expires At",
        "note": "Internal note (optional)",
        "confirm": "Assign"
      },
      "requests": {
        "title": "Key Requests",
        "tabs": { "pending": "Pending", "handled": "Handled" },
        "approveModal": {
          "title": "Approve Request",
          "selectKey": "Assign from Key",
          "userQuota": "User Quota",
          "expiresAt": "Expires At",
          "confirm": "Approve & Assign"
        },
        "rejectModal": {
          "title": "Reject Request",
          "reason": "Reason (shown to user)",
          "confirm": "Reject"
        }
      },
      "dashboard": {
        "title": "BYOK Dashboard",
        "metrics": {
          "totalKeys": "Total Keys in Pool",
          "activeAssignments": "Active Assignments",
          "pendingRequests": "Pending Requests",
          "monthlySpend": "This Month's Spend"
        }
      }
    }
  }
}
```

### 附录 B：命名约定

| 对象         | 规范                      | 示例                        |
| ------------ | ------------------------- | --------------------------- |
| Prisma model | PascalCase                | `DistributableKey`          |
| 表名         | snake_case                | `distributable_keys`        |
| Service 文件 | kebab-case                | `key-resolver.service.ts`   |
| 类           | PascalCase + Service 后缀 | `KeyResolverService`        |
| DTO          | PascalCase + Dto 后缀     | `CreateDistributableKeyDto` |
| 错误类       | PascalCase + Error 后缀   | `NoAvailableKeyError`       |
| i18n key     | camelCase 路径            | `byok.onboarding.title`     |
| API 路径     | kebab-case                | `/admin/key-assignments`    |
| React 组件   | PascalCase                | `ProviderKeyCard.tsx`       |

### 附录 C：参考代码位置

| 主题            | 参考文件                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| 加密一致性      | `backend/src/modules/platform/credentials/secrets/secrets.service.ts:608-636`             |
| 缓存模式        | `backend/src/modules/platform/credentials/user-api-keys/user-api-keys.service.ts:440-486` |
| AdminGuard 用法 | `backend/src/modules/platform/credentials/secrets/secrets.controller.ts:1-30`             |
| RequestContext  | `backend/src/common/context/request-context.ts`                                           |
| Provider 抽象   | `backend/src/common/ai-orchestration/providers/`                                          |
| 审计日志模式    | `backend/src/modules/platform/credentials/secrets/secrets.service.ts` (logAccess)         |
| 手写迁移示例    | `backend/prisma/migrations/*/migration.sql`                                               |
| AdminPageLayout | `frontend/components/admin/layout/AdminPageLayout.tsx`                                    |
| SecretForm 参考 | `frontend/components/admin/secrets/SecretForm.tsx`                                        |
| Modal 组件      | `frontend/components/ui/dialogs/Modal.tsx`                                                |
| useApiGet/Post  | `frontend/hooks/core/useApi.ts`                                                           |
| Toast           | `frontend/stores/core/toastStore.ts`                                                      |
| i18n            | `frontend/lib/i18n/i18n-context.tsx`                                                      |

### 附录 D：Agent 实施指引

**当 Coder Agent 接到 Phase X 任务时，必须：**

1. **先读本文档对应 Phase 章节**
2. **检查依赖的 Phase 是否已完成**（Phase 2 依赖 Phase 0、1；Phase 5-6 依赖 Phase 2-3）
3. **严格遵守 CLAUDE.md 规则**：
   - 不得修改本 Phase 任务范围外的文件
   - 新增 Module 必须走 onModuleInit 注册模式
   - 所有 LLM 调用必须走 `AIEngineFacade` 和 `AiChatService`
   - 禁止硬编码模型名，空字符串 fallback
4. **按文件改动清单操作**，不做"顺手优化"
5. **完成后必须对照 [§12 验收标准](#12-验收标准与测试用例)** 自测
6. **提交前运行 `npm run verify:full`**

**当 Tester Agent 接到测试任务时，必须：**

1. **按 [§12.1 E2E 测试脚本](#121-e2e-测试脚本tester-agent-执行)** 逐项执行
2. **每个用户旅程至少覆盖 1 条正向 + 1 条异常**
3. **测试数据构造**：使用独立 test DB schema，不污染 dev
4. **失败立即报告并给出 diff**（代码行级定位）

**当 Reviewer Agent 审查 PR 时，必须：**

1. **对照本文档 [§11 实施阶段规划](#11-实施阶段规划)** 确认任务范围匹配
2. **重点检查**：
   - 是否存在 LLM 调用绕过 KeyResolver
   - 是否存在明文 Key 写入日志
   - Worker 是否包裹 RequestContext.run
   - Admin Controller 是否有 AdminGuard
3. **检查 i18n**：新增 UI 文案必须同时添加 zh + en
4. **检查测试覆盖**：新服务必须有单元测试

---

**文档结束。更新记录：**

| 版本 | 日期       | 修改内容                                   |
| ---- | ---------- | ------------------------------------------ |
| v1.0 | 2026-04-20 | 初始版本，10 条用户旅程 + 7 Phase 实施规划 |
