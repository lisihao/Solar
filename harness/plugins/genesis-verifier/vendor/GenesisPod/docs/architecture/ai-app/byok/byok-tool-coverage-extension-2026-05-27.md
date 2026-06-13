# BYOK 全量化扩展方案（工具类 + 模型 Key 选择）

> **版本**: v0.1（评审中）
> **创建时间**: 2026-05-27
> **延伸自**: [byok/system-design.md](./system-design.md) v1.0（已落地 LLM BYOK）
> **状态**: 等用户评审 5 个关键决策点 → 进入实施
> **负责人**: Claude Code

---

## 0. TL;DR

把现有 BYOK 的范围从 **LLM 模型 Key** 扩展到 **全部 API 服务工具 Key**（网页检索、学术、抓取、TTS、Finance、Weather、ImageSearch、DevTools、MCP、Donated、Other 等 14 类），让终端用户在 `/me/api-keys` + 新增的 `/me/tools` 里像 admin 一样自助配置工具凭证，运行时**用户 Key 优先，admin 系统 Key 兜底**。

---

## 1. 用户诉求复述（2026-05-27 沟通）

| #   | 原话                                                        | 解读                                                         |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | "API KEY 也要考虑支持工具类的"                              | /me/api-keys 不仅管 LLM，还要管工具（SEARCH/EXTRACTION/...） |
| 2   | "本质上是需要把现在系统的模型能力、工具能力都要搬迁到 BYOK" | admin 配的所有 Secret 都要能被普通用户在 BYOK 模式覆盖       |
| 3   | "我的 API KEY 支持的是各类的 API KEY"                       | UserApiKey 不再仅限 LLM，要按 category 全覆盖                |
| 4   | "我的模型可以配置 Endpoint 和选择对应的 KEY"                | /me/models 新增「关联哪个用户 Key」字段，runtime 用这个 Key  |
| 5   | "在用户→设置→我的模型下面，增加一个我的工具菜单"            | Sidebar 新菜单 `/me/tools`                                   |
| 6   | "和 BYOK 的模型一样"                                        | /me/tools 体验 ≈ /me/models（用户视角的工具目录 + 配置入口） |
| 7   | "并且要优先使用 BYOK 的工具"                                | runtime 优先级：用户 Key > admin 系统 Key > 错误兜底         |

---

## 2. 现状盘点（基于 explorer 调研，2026-05-27）

| 维度                  | 现状                                                                                             | 文件                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Secret 表             | 单租户，无 userId 字段；14 个 category；多 key fallback（SecretKey 子表）                        | `backend/prisma/schema/models.prisma:8208-8263`                     |
| user_api_keys 表      | LLM-only，无 category 字段，按 provider 维度组织                                                 | `models.prisma:8134-8173`                                           |
| user_model_configs 表 | 用户 LLM 模型自定义；**无 keyId 引用**                                                           | `models.prisma:9530-9595`                                           |
| Admin 工具目录        | hardcoded TS 数组 `EXTERNAL_TOOL_DEFINITIONS`（20+ 工具）+ DB `ToolConfig` 表                    | `backend/src/modules/open-api/admin/ai/ai-admin.service.ts:48-229`  |
| 工具→Secret 映射      | hardcoded `EXTERNAL_TOOL_SECRET_MAPPING` (toolId → secretName)                                   | `backend/src/modules/ai-infra/secrets/secret-name.catalog.ts:19-70` |
| 运行时 key 解析       | `SecretsService.getValueInternal(name)` —— **无 userId 参数**，只查 admin Secret                 | `backend/src/modules/ai-infra/secrets/secrets.service.ts:298-1427`  |
| Admin 工具页          | `/admin/ai/tools` 四 Tab（内置 / API 服务 / MCP / 第三方信源），每行有「密钥」状态 + 配置 + 测试 | `frontend/components/admin/tools/APIServicesTable.tsx`              |
| 用户工具页            | **不存在**                                                                                       | —                                                                   |

---

## 3. 5 个关键决策点（待用户评审）

### D1: 存储模型 — 用户工具 Key 放哪？

| 方案                              | 描述                                                                                                         | 优                                                          | 劣                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| **A. secrets.userId 可空** ⭐推荐 | 现有 `secrets` 表加 `userId TEXT NULL`，unique 改为 `(name, userId)`；user=null → admin，user=uid → 用户私有 | 单表单 resolver；admin/用户语义同质；audit/encrypt 复用全套 | 表混租；ROW level filter 必加；migration 改 unique 索引                    |
| B. user_api_keys 扩 category      | 给 `user_api_keys` 加 `category` enum，复用 LLM BYOK 表                                                      | 不动 secrets 表，最小风险                                   | 两套 schema 长期分裂；admin/用户表不对称；MCP / SecretKey 子表机制无法复用 |
| C. 新建 user_secrets 表           | 完全独立的镜像表                                                                                             | 隔离干净                                                    | 最多重复代码；两套 resolver；migration 重                                  |

**推荐 A**，理由：与 admin 工具目录复用同一密钥模型；resolve 链一处实现；future-proof 团队/组织维度的 Key（再加 orgId 即可）。

### D2: UI 信息架构 — 用户侧菜单 ↔ admin 一一对应

**核心约束**：用户侧 4 个菜单**完全镜像** admin 已有页面，参数化只在 "data scope"（user-owned vs system-owned）和 "权限"（自管理 vs 全局管理）上区分；UI 布局、列定义、操作按钮**直接复用** admin 组件。

| 用户菜单     | 路径                     | 镜像 admin 页面             | admin 路径                           | 数据范围                                                    |
| ------------ | ------------------------ | --------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| 我的 API Key | `/me/api-keys`           | 密钥管理                    | `/admin/access/secrets`              | 仅当前用户的 Secret（含 LLM + 工具 + 其他 14 类）           |
| 我的模型     | `/me/models`             | 模型管理                    | `/admin/ai/models`                   | 仅当前用户的 UserModelConfig（含 endpoint + apiKeyId 选择） |
| 我的工具     | `/me/tools` ★ 新增       | 工具管理 → API 服务工具 Tab | `/admin/ai/tools`                    | 工具目录 + 当前用户的 Key 配置状态                          |
| 我的技能     | `/me/skills` ★ 新增-完整 | 本地技能                    | `/admin/ai/skills`（本地技能聚合页） | 完整实现（用户原话：完整实现，先做本地技能）                |

```
用户 > 设置
  ├─ 我的 API Key（/me/api-keys）        ← 单表格 = admin 密钥管理同款（参 Screenshot_98）
  │                                          含 category 列、搜索、All Categories 下拉、+ 添加密钥
  │
  ├─ 我的模型 （/me/models）              ← 模型卡片/表 = admin 模型管理同款
  │                                          每行加「使用 Key」下拉 + Endpoint 输入
  │
  ├─ 我的工具 （/me/tools）  ★ 新增      ← 镜像 admin /admin/ai/tools "API 服务工具" Tab
  │                                          工具目录 + 「我的 Key 状态」列 + 配置按钮
  │
  └─ 我的技能 （/me/skills） ★ 新增-占位  ← 镜像 admin 本地技能页（结构对齐）
                                              本期仅落 Sidebar + 空页骨架（待评审是否保留，见架构师 #6 反对）
```

**/me/api-keys** 改成**单一表格**（与 admin `/admin/access/secrets` 完全同款，参 `debug/Screenshot_98.png`，**不分 Tab、不分组**）：

```
┌───────────────────────────────────────────────────────────────────────┐
│ 密钥管理   所有 API 密钥的集中管理 - 加密存储 + 访问审计 + 轮换追踪    [+ 添加密钥] │
├───────────────────────────────────────────────────────────────────────┤
│ [🔍 搜索 name / 显示名...]                  [All Categories ▾]  [🔄]   │
├───────────────────────────────────────────────────────────────────────┤
│ 名称              | 类别                | 值        | 状态 | 调用  | 过期 | 操作 │
│ ─────────────────────────────────────────────────────────────────────│
│ 🔑 Claude API Key | [AI_MODEL] Claude   | •••f71•• | 已配 | 4    | --   | ⊕ ✎ 🗑 │
│ 🔑 Tavily Key     | [SEARCH] Tavily     | •••a83•• | 已配 | 12   | --   | ⊕ ✎ 🗑 │
│ 🔑 Firecrawl Key  | [EXTRACTION] Fire.. | •••2b1•• | 已配 | 5    | --   | ⊕ ✎ 🗑 │
│ ...                                                                    │
└───────────────────────────────────────────────────────────────────────┘
```

- **列**: 名称(name) / 类别(category chip + provider 子标) / 值(masked) / 状态(isActive) / 调用次数 / 过期 / 操作(测试 / 编辑 / 删除)
- **顶部**: 搜索框 + Category 下拉(全部 / AI_MODEL / SEARCH / EXTRACTION / TTS / FINANCE / WEATHER / IMAGE_SEARCH / DEV_TOOLS / MCP / OTHER) + 刷新 + **添加密钥** 主按钮
- **添加密钥 Modal**(参 admin SecretForm 同款): name / displayName / category / provider / value / description / isActive
- **数据源**: `GET /me/secrets` 一次返回该用户所有 category 的私有 Secret
- LLM Provider Key 与工具 Key **同表**，category chip 区分

> 注：原 `user_api_keys` 表里的 LLM Key 数据**统一迁移到 `secrets` 表**（带 userId + category=AI_MODEL），保留 `user_api_keys` 作为视图层兜底。**或者**仍保留 `user_api_keys`，由 `/me/secrets` 端点把两张表 UNION ALL 给前端 —— 见 D1。

**/me/tools** 镜像 admin 但简化：

- Tab：API 服务工具 / MCP 工具（**砍掉**内置工具 + 第三方信源，那些不需要 BYOK）
- 列：名称 / TOOLID / 我的 Key 状态（已配 / 未配，未配则用系统默认） / 配置 / 测试 / 启用

**/me/models** 加字段：

- 「使用 Key」: 下拉，候选 = 当前 user 在对应 provider 下的 UserApiKey（label 列）

### D3: 优先级链 — runtime 怎么选 Key？

```
工具调用 (e.g. tavily) — runtime 上下文带 ctx.userId
  ↓
SecretsService.getValueInternal('tavily-search-api-key', { userId: ctx.userId })
  ↓
1. 查 Secret WHERE name='tavily-search-api-key' AND userId=ctx.userId AND isActive=true  → 命中：用用户 Key
  ↓ 未命中
2. 查 Secret WHERE name='tavily-search-api-key' AND userId IS NULL AND isActive=true     → 命中：用 admin Key
  ↓ 未命中
3. 抛 "未配置" 错误（前端引导去 /me/tools 配置）
```

LLM 部分类似但走 `UserApiKeysService.resolveActiveKey(userId, provider)`，不变。

### D4: 迁移策略 — 不破坏现有 admin Secret

1. `ALTER TABLE secrets ADD COLUMN userId TEXT NULL`
2. `DROP CONSTRAINT secrets_name_key`（现 unique on name）
3. `CREATE UNIQUE INDEX secrets_name_userId_key ON secrets (name, COALESCE(userId, ''))` —— Postgres 不支持 NULL=NULL，要用 COALESCE
4. 现有数据 userId 全部 NULL（admin owned），不动
5. `secret_keys` 子表不动（一个 Secret N 把 Key 的能力 admin/user 都受益）

### D5.5: 授权申请流（每页一个按钮）★ 用户新增

> **用户原话**：每一页都保留一个按钮，和模型一样，支持工具、技能向系统申请授权 / 系统可以授予对应的工具、技能的服务。

**机制（沿用 v1.0 BYOK §J5 "工单流程"，扩展到 Tool / Skill）**：

| 菜单         | 按钮               | 申请类型         | 说明                                                                                      |
| ------------ | ------------------ | ---------------- | ----------------------------------------------------------------------------------------- |
| /me/api-keys | 「向系统申请 Key」 | `KEY_ASSIGNMENT` | 申请一把 admin 池里的 LLM/工具 Key 配额（沿用 v1.0 distributable_keys + key_assignments） |
| /me/models   | 「申请系统模型」   | `MODEL_GRANT`    | 申请使用系统侧某模型（admin 配的）                                                        |
| /me/tools    | 「申请工具授权」   | `TOOL_GRANT`     | 申请使用系统侧某工具（如 tavily），授权后无需配自己 Key                                   |
| /me/skills   | 「申请技能授权」   | `SKILL_GRANT`    | 申请使用系统某本地技能（本期不实现）                                                      |

**数据 model（新 / 复用 v1.0）**：

```prisma
model AuthorizationRequest {
  id          String   @id @default(cuid())
  userId      String
  type        AuthRequestType  // KEY_ASSIGNMENT | MODEL_GRANT | TOOL_GRANT | SKILL_GRANT
  targetId    String           // secretName / modelId / toolId / skillId
  reason      String?          // 用户填的申请理由
  status      AuthRequestStatus // PENDING / APPROVED / REJECTED / REVOKED
  approverId  String?          // admin who acted
  approverNote String?
  expiresAt   DateTime?        // 授权期限（admin 可设）
  createdAt   DateTime @default(now())
  decidedAt   DateTime?
  @@index([userId, status])
  @@index([type, status])
}

model AuthorizationGrant {
  id          String   @id @default(cuid())
  userId      String
  type        AuthRequestType
  targetId    String
  requestId   String?  @unique  // 来源工单（手动赋权可空）
  grantedBy   String   // admin id
  expiresAt   DateTime?
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
  @@index([userId, type])
}
```

**Runtime 优先级链扩展**：

```
工具调用 → ToolKeyResolver:
1. 用户私有 Secret (userId=ctx.userId)                            → 用之
2. AuthorizationGrant (userId=ctx.userId, type=TOOL_GRANT, 未过期) → 走 admin Secret 但记账给用户
3. 严格模式 ⇒ 抛 NoToolAccessError；fallback 模式 ⇒ 走 admin Secret
```

**Admin 审批入口**：`/admin/access/authorization-requests` 已规划在 v1.0 §J5；本方案延用同一控制器但 type 扩展。

### D5: 范围边界 — 哪些不做（YAGNI）

| 项                      | 决策                                                           |
| ----------------------- | -------------------------------------------------------------- |
| 用户共享 Key 给团队     | **不做**（无团队概念）                                         |
| 用户 Key 配额 / billing | **不做**（admin pool 已经有 USER_DONATED 机制）                |
| 用户测试工具按钮        | **做**（mirror admin /test 端点，但只测自己的 Key）            |
| 用户禁用某工具          | **不做**（admin 已经控制全局开关；用户只是缺 Key 就 fallback） |
| 内置工具的 BYOK         | **不做**（内置工具如 web-fetch 不需 Key）                      |
| 第三方信源（RSS 等）    | **不做**（不在 Secret 范畴）                                   |

---

## 4. 总体架构图（目标态）

```
┌─────────────────── Frontend ───────────────────┐
│                                                 │
│  /me/api-keys   /me/models    /me/tools  ★      │
│   ├ LLM Tab      ├ Model List   ├ API 服务 Tab  │
│   └ Tool Tab ★   └ Key 选择 ★   └ MCP Tab       │
│                                                 │
└────────────────────┬────────────────────────────┘
                     │  HTTP
┌────────────────────▼────────────────────────────┐
│                   Backend                        │
│                                                  │
│  /me/secrets          /me/tools (catalog)        │
│   GET/POST/PUT/DEL     GET (mirror admin + 用户状态) │
│                                                  │
│  Tool execution ──→ SecretsService              │
│   ctx.userId ─────→  .getValueInternal(name, {userId}) │
│                       └─ priority chain:        │
│                          user → admin           │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  PostgreSQL                                      │
│                                                  │
│  secrets (userId NULL = admin, NOT NULL = user) │
│  user_api_keys (LLM, unchanged)                 │
│  user_model_configs (+ apiKeyId 引用)            │
└──────────────────────────────────────────────────┘
```

---

## 5. 数据模型 Diff（Prisma）

```diff
 model Secret {
   id              String   @id @default(cuid())
   name            String
+  userId          String?  // null = admin/system Secret; not null = user BYOK
   displayName     String?
   category        SecretCategory
   encryptedValue  String
   iv              String
   provider        String?
   isActive        Boolean  @default(true)
-  @@unique([name])
+  @@unique([name, userId])
+  @@index([userId, category])
   ...
 }

 model UserModelConfig {
   id           String   @id @default(cuid())
   userId       String
   provider     String
   modelId      String
+  apiKeyId     String?  // 引用 UserApiKey.id；null = 用 provider 默认/admin
+  apiKey       UserApiKey? @relation(fields: [apiKeyId], references: [id], onDelete: SetNull)
   ...
 }
```

`user_api_keys` 不动（仅 LLM）；不引入 `user_api_keys.category` —— 工具类全部落 `secrets` 表。

---

## 6. 后端服务 Diff

### 6.1 SecretsService（核心改造）

```ts
// 现状
async getValueInternal(name: string): Promise<string | null> { ... }

// 目标
async getValueInternal(
  name: string,
  opts?: { userId?: string }
): Promise<string | null> {
  // 1. 用户私有 Key 优先
  if (opts?.userId) {
    const userSecret = await this.findActiveSecret(name, opts.userId);
    if (userSecret) return decrypt(userSecret);
  }
  // 2. 系统 Key 兜底（现有逻辑）
  const adminSecret = await this.findActiveSecret(name, null);
  if (adminSecret) return decrypt(adminSecret);
  return null;
}
```

### 6.2 新端点

| 端点                        | 谁用 | 作用                                                 |
| --------------------------- | ---- | ---------------------------------------------------- |
| `GET /me/secrets`           | 用户 | 列所有用户私有 Secret（按 category 分组）            |
| `POST /me/secrets`          | 用户 | 创建 / 更新用户私有 Secret（按 name + userId 唯一）  |
| `PUT /me/secrets/:id`       | 用户 | 改值或 toggle isActive                               |
| `DELETE /me/secrets/:id`    | 用户 | 删除用户私有 Secret（不影响 admin Key）              |
| `POST /me/secrets/:id/test` | 用户 | 用用户 Key 测试工具连通性                            |
| `GET /me/tools`             | 用户 | 返回 admin EXTERNAL_TOOL_DEFINITIONS + 用户 Key 状态 |

### 6.3 工具执行链改造（Phase E）

所有 tool handler（grep `secretsService.getValueInternal`）追加 `{ userId: ctx.userId }`：

- `tools/handlers/tavily-handler.ts`
- `tools/handlers/firecrawl-handler.ts`
- `tools/handlers/jina-handler.ts`
- ... 共 ~20 处

ToolInvoker 已经持有 ctx.userId（agent runner 透传），改动相对收敛。

---

## 7. 前端 Diff

### 7.1 Sidebar

`frontend/components/layout/Sidebar.tsx` 在「我的模型」之后插两项：

- 「我的工具」`/me/tools`，icon = Wrench
- 「我的技能」`/me/skills`，icon = Sparkles —— **空页面占位**：`<EmptyState title="我的技能" description="敬请期待" />`，不写后端、不动数据。

### 7.2 /me/api-keys 改双 Tab

```tsx
<Tabs>
  <TabPanel value="llm">UserApiKeysTab</TabPanel> {/* 现状不动 */}
  <TabPanel value="tools">UserToolSecretsTab ★ 新增</TabPanel>
</Tabs>
```

### 7.2.5 UI 总原则（用户原话）

> "原则上应该和 Admin 完全保持一致（当然页面宽度不一样，BYOK 多了一个左侧导航，可以优化列的呈现）"

- **数据模型 / 列定义 / 操作按钮**：与 admin **100% 对齐**（直接复用 admin 组件，传 `dataHook` / `endpoint` prop 切换数据源）
- **响应式列裁剪**：BYOK 页面宽度 ≈ admin × 0.78（去掉左 sidebar），列展示优化策略：
  - 次要列（如调用次数 / 过期时间）在窄屏自动收进「⋯」展开
  - 长字符串列（如 endpoint）改 truncate + tooltip
  - 操作列 icon-only（不带文字）
- **不允许 fork 整页文件**——复用 admin 组件 + props 切换；如 admin 组件没暴露 props，先重构 admin（提到 `components/common/secrets/` 等共享区），再让 /me 调用

---

### 7.3 /me/api-keys 详细 UI（参 Screenshot_98 admin 同款）

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🟧  密钥管理   所有 API 密钥的集中管理 - 加密存储 + 访问审计           │
│ ←                                                    [+ 添加密钥]    │
├─────────────────────────────────────────────────────────────────────┤
│ [🔍 Search by name, 显示名...]      [All Categories ▾]    [🔄]      │
│                                                  ★[向系统申请 Key]  │
├──────────────────────────────────────────────────────────────────────┤
│ 名称              | 类别                | 值        | 状态 |调用|过期|操作│
│ ─────────────────────────────────────────────────────────────────────│
│ 🔑 Claude API Key | [AI_MODEL] Claude   | •••f71•• | 已配 |  4 | -- |⊕✎🗑│
│ 🔑 OpenAI Key     | [AI_MODEL] OpenAI   | •••6df•• | 已配 | 85K| -- |⊕✎🗑│
│ 🔑 Tavily Key     | [SEARCH] Tavily     | •••a83•• | 已配 | 12 | -- |⊕✎🗑│
│ 🔑 Firecrawl Key  | [EXTRACTION] Fire.. | •••2b1•• | 失败 |  5 | -- |⊕✎🗑│
│ ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

**添加密钥 Modal**（admin SecretForm 同款）：name / displayName / category / provider / value / description / isActive
**[向系统申请 Key] 按钮** → 弹出申请 Modal：选 category → 选具体 secret name → 写理由 → 提交，admin 在 `/admin/access/authorization-requests` 审批。

---

### 7.4 /me/models 详细 UI（admin /admin/ai/models 同款）

```
┌──────────────────────────────────────────────────────────────────┐
│ 🤖  我的模型管理   配置和管理你接入的 LLM 模型                       │
│ ←                                              [+ 添加模型]       │
├──────────────────────────────────────────────────────────────────┤
│ [🔍 Search...]   [Provider ▾]   [Type ▾]      ★[申请系统模型]    │
├──────────────────────────────────────────────────────────────────┤
│ 名称        |Provider | ModelID    | Endpoint     | 使用 Key   | 启用│
│ ────────────────────────────────────────────────────────────────────│
│ GPT-4o     | openai  | gpt-4o     | api.openai.. | OpenAI Key | 🔘  │
│ Claude 3.5 | anthropic| claude-3-5| api.anthrop. | Claude Key | 🔘  │
│ vLLM 本地  | vllm    | qwen2.5-7B | 10.0.0.5:..  | (无)       | 🔘  │
└──────────────────────────────────────────────────────────────────┘
```

**添加模型 Modal**：name / provider(自由输入) / modelId / **endpoint** / **使用 Key** 下拉 / type / contextWindow / pricing / isActive
**[申请系统模型] 按钮** → 选 admin 已配的模型 → 申请使用授权。

---

### 7.5 /me/tools 详细 UI（admin /admin/ai/tools 同款，仅 API 服务工具 Tab）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🛠  我的工具   配置外部 API 工具的访问密钥                                │
│ ←                                                  ★[申请工具授权]      │
├─────────────────────────────────────────────────────────────────────────┤
│ [🔍 Search toolId/name...]   [全部用途 ▾]   [全部状态 ▾]   [🔄] 44/44   │
├─────────────────────────────────────────────────────────────────────────┤
│ 📁 网页检索  (5 个)                                                      │
│   名称        | TOOLID    | 原始分类  | 我的 Key       | 状态  | 启用|测试│
│ ────────────────────────────────────────────────────────────────────────│
│   duckduckgo  | duckduckgo| external  | (使用系统)     | 正常  | 🔘  |▶ │
│   Tavily      | tavily    | external  | [已配 - 编辑]  | 正常  | 🔘  |▶ │
│   serper      | serper    | external  | [未配 - 配置]  | 未配  | 🔘  |▶ │
│ 📁 学术检索  (4 个)                                                      │
│   ArXiv ...                                                              │
│ 📁 内容抓取  (4 个)                                                      │
│   ...                                                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

**「我的 Key」列状态**：

- `[已配 - 编辑]`：用户配过私有 Key → 点击打开 Secret 编辑 Modal
- `[未配 - 配置]`：未配 → 点击打开 admin SecretForm（POST `/me/secrets`）
- `(使用系统)`：admin 已给该用户授权（AuthorizationGrant），无需自配
- `(未授权)`：admin 没授权且用户未配 → 工具不可用，引导申请

**[申请工具授权] 按钮** → 选要申请的 tool → 写理由 → admin 审批。

---

### 7.6 /me/skills 详细 UI（admin 本地技能同款，完整实现）

```
┌─────────────────────────────────────────────────────────────────────┐
│ ✨  我的技能   配置和管理本地技能（skills）                            │
│ ←                                              [+ 添加技能]         │
├─────────────────────────────────────────────────────────────────────┤
│ [🔍 Search...]   [Category ▾]                ★[申请技能授权]        │
├─────────────────────────────────────────────────────────────────────┤
│ 内置技能 (来自系统授权)                                                │
│ ─────────────────────────────────────────────────────────────────────│
│ 📦 web-research      | 网页深度研究        | 已授权 | 🔘 启用         │
│ 📦 academic-search   | 学术文献检索        | 已授权 | 🔘 启用         │
│                                                                       │
│ 我的私有技能                                                          │
│ ─────────────────────────────────────────────────────────────────────│
│ ✨ my-custom-flow    | (用户自定义)        | --     | 🔘 启用| ✎🗑   │
└─────────────────────────────────────────────────────────────────────┘
```

**[申请技能授权] 按钮** → 选 admin 已注册的内置技能 → 申请使用授权。
**[+ 添加技能] 按钮** → 添加用户自定义技能（与 admin SkillForm 同款；技能 manifest YAML / JSON）。

---

### 7.7 /me/tools 新页（已合并到 7.5）

`frontend/app/me/tools/page.tsx` + `frontend/components/me/tools/UserToolsCatalog.tsx`：

- 复用 admin `APIServicesTable.tsx` 的列布局
- 数据源 `GET /me/tools` 返回 `{toolId, name, category, secretName, configured: boolean, userKeyId?: string}`
- 点「配置」打开 SecretFormModal（admin 同款，但 POST → `/me/secrets`）

### 7.4 /me/models 加 Key 选择

`frontend/components/me/models/UserModelConfigModal.tsx` 增字段：

```tsx
<Field label="使用 Key">
  <select value={apiKeyId} onChange={...}>
    <option value="">默认（admin/provider 默认）</option>
    {userKeys.filter(k => k.provider === provider).map(k =>
      <option key={k.id} value={k.id}>{k.label} ({k.keyHint})</option>
    )}
  </select>
</Field>
```

---

## 8. 实施阶段（自驱顺序）

```
B. DB schema (Phase B) ─┬─→ C. 后端 resolver + 端点 (Phase C) ─┐
                        │                                       │
                        └─→ D. 前端 3 页改造 (Phase D)          │
                                                                ├─→ 验收
                                                                │
                              E. 工具执行链 ctx.userId 透传 (Phase E) ─┘
```

每阶段独立 verify：

- B: `prisma migrate deploy` + `verify:arch` + 老数据查询不破
- C: jest 单测 `SecretsService.getValueInternal({userId})` 优先级链；`/me/secrets` CRUD
- D: 三个页面 Cypress / 手测（先本地 docker 验证）
- E: 端到端 — 用户配 tavily Key → 触发 research → 后端 log 看走的是用户 Key

---

## 9. 验收基线

| #   | 场景                                                 | 期望                                                              |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | 用户在 /me/api-keys 工具 Tab 配 tavily Key           | DB `secrets` 表新增 (name='tavily-search-api-key', userId=uid) 行 |
| 2   | 同用户跑一个 research，看 log                        | 命中用户 Key（不命中 admin）                                      |
| 3   | 删掉用户 Key 重跑                                    | 自动 fallback 到 admin Key                                        |
| 4   | 配错的用户 Key → 测试按钮                            | 显示「失败：401 from tavily」，不影响 admin Key                   |
| 5   | 切到无 Key 的工具（如 weather）                      | 提示「未配置」，引导跳 /me/tools                                  |
| 6   | 用户在 /me/models 选了 keyId=xxx                     | runtime LLM 调用用这把 Key（log 可观察）                          |
| 7   | admin 在 /admin/access/secrets 看不到用户私有 Secret | 列表 WHERE userId IS NULL                                         |
| 8   | 用户 A 看不到用户 B 的 Secret                        | 列表 WHERE userId = ctx.userId                                    |

---

## 10. 风险登记册

| 风险                                       | 概率 | 影响 | 缓解                                                                            |
| ------------------------------------------ | ---- | ---- | ------------------------------------------------------------------------------- |
| Secret unique 索引迁移失败（旧数据有重名） | 低   | 高   | 迁移前 SELECT count(_) FROM secrets GROUP BY name HAVING count(_) > 1，预先合并 |
| 工具执行没传 userId 导致一直走 admin Key   | 中   | 中   | grep 全量 tool handler，加 lint rule "getValueInternal 必须带 opts.userId"      |
| 用户 Key 泄露横向影响 admin                | 极低 | 高   | 加密机制完全复用现有 SETTINGS_ENCRYPTION_KEY；不引入新攻击面                    |
| 用户配错 Key 大量失败拖垮工具              | 中   | 低   | 复用 SecretKeysService 5min 熔断机制                                            |
| /me/tools 与 /admin/ai/tools 数据源漂移    | 中   | 低   | 共享 `EXTERNAL_TOOL_DEFINITIONS` 数组（不复制定义）                             |

---

## 11. 开放问题（评审时一并确认）

| Q                                                   | 选项                                | 默认                                             |
| --------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| 用户能否上传自己的 MCP server URL                   | 是 / 否                             | 是（MCP Tab 支持自定义 URL）                     |
| 用户 Donated Key 给系统池                           | 沿用现有 PERSONAL/DONATED 机制 / 砍 | **沿用**（不破坏）                               |
| 用户配的 Secret 是否计费                            | 是 / 否                             | **否**（成本由用户自己承担）                     |
| /me/models 没选 keyId 时走 admin 还是 provider 默认 | admin Key / provider 默认           | **provider 默认**（避免用户的请求消耗 admin 池） |

---

**结论**：方案 v0.1 完成。等用户在 **D1-D5 + 开放问题** 上拍板后进入 Phase B 编码。

---

## 12. 多路评审基线（v0.2, 2026-05-27）

> **本节是 v0.1 → v0.2 的差异**。4 路专家并行评审（架构 / 安全 / 代码审 / PM）回馈合并，形成**正式基线**。冲突的地方一律以基线为准（推翻 v0.1 推荐方案）。

### 12.1 评审产物存档

| 评审人 | 总评                                                                       | 必改项数 | 输出位置（agent transcript） |
| ------ | -------------------------------------------------------------------------- | -------- | ---------------------------- |
| 架构师 | "方案大方向正确，但 D1 推荐与 v1.0 严格隔离原则相冲突；不可直接进入实施"   | 6        | agent aae14aab               |
| 安全审 | 2 关键 + 3 高 + 3 中                                                       | 7        | agent ad7a068b               |
| 代码审 | 实施可行但破坏性 unique 索引改造 + 46 处 getValueInternal 调用点是最大风险 | 5        | agent a78f1043               |
| PM     | "PRD 完整性 6 项缺失，新用户开箱有断点"                                    | 8        | agent a44c609d               |

### 12.2 关键决策 v0.2（基线）

| ID      | 项                      | v0.1 推荐                                    | v0.2 基线（4 路评审后）                                                                                                                                                  | 推翻理由                                                  |
| ------- | ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **D1**  | 存储模型                | A. secrets.userId nullable + COALESCE unique | **A-改**：secrets 加 userId nullable，**但** unique 用 PG **partial index**（不用 COALESCE），LLM Key 仍走 user_api_keys（不混入）                                       | 安全审 + 架构师指出 COALESCE 是反模式 + LLM/Tool 语义异质 |
| **D3**  | 优先级链                | user → admin 自动 fallback                   | **STRICT 默认 + byokMode 用户可切换**：用户档案加 `byokMode: 'strict' \| 'fallback'`，默认 STRICT（与 v1.0 §3 一致，不烧 admin 池）                                      | 架构师 + 安全审 + v1.0 原文                               |
| **D4**  | 迁移策略                | COALESCE unique 索引                         | **PG partial unique index**：`CREATE UNIQUE INDEX ON secrets(name) WHERE userId IS NULL` + `CREATE UNIQUE INDEX ON secrets(name, userId) WHERE userId IS NOT NULL`       | 安全审 + 代码审：原生 PG 语义                             |
| **D6**  | userId 透传             | 显式参数 ctx.userId                          | **强制显式 + getValueInternal undefined throws**：`opts.userId === undefined` 抛错；`null` 才表示"显式 admin 查询"；ESLint rule 设为 **error**                           | 安全审高-2：漏传 = 静默走 admin 池                        |
| **D7**  | 加密                    | 单 SETTINGS_ENCRYPTION_KEY                   | **HKDF per-user 子密钥派生**：用户 Key 用 `HKDF(masterKey, userId)` 子密钥，master key 泄露不等于全用户 Key 泄露                                                         | 安全审 关键-1                                             |
| **D8**  | /me/skills              | 占位空页                                     | **完整实现**（用户改主意：完整实现，先做本地技能）                                                                                                                       | 用户后续指令                                              |
| **D9**  | UI 复用率               | "复用 admin 组件"                            | **明确边界**：admin SecretsManager 提 `components/common/secrets/` 共享；Controller 不抽 BaseSecretsService（new UserSecretsController），共享 EncryptionService         | 代码审：admin/user 语义不同                               |
| **D10** | 删除策略                | 物理删除                                     | **软删除 + 90 天保留**：用户 Key 软删除，SecretAccessLog 冗余 userId                                                                                                     | 安全审中-2 + 代码审                                       |
| **D11** | 测试按钮                | 做                                           | **加严格速率限制**：`@Throttle(5, 3600)` + audit log，响应不透传外部 API 错误体                                                                                          | 安全审高-1                                                |
| **D12** | onboarding              | 没提                                         | **加首次配 Key 向导**：注册后 dashboard banner，预填表单                                                                                                                 | PM #1                                                     |
| **D13** | 计费                    | 不做                                         | **/me/billing 最小版**：仅展示用量统计（不做配额）                                                                                                                       | PM #2                                                     |
| **D14** | 错误 UX                 | 一笔带过                                     | **明文设计**：Key 401 → toast + 跳 /me/api-keys 高亮该行；Key 缺失 → 功能入口阻断                                                                                        | PM #6                                                     |
| **D15** | 删 Key 副作用           | 没说                                         | **阻止删除被引用的 Key**，前端 Modal 提示影响范围 + 提供「先解绑再删」入口                                                                                               | PM #8                                                     |
| **D16** | PR 拆分                 | 没说                                         | **4 个 PR 严格顺序**：PR-1 DB only / PR-2 后端 admin 路径修复 + UserSecretsService / PR-3 前端 3 页 / PR-4 ctx.userId 工具链透传                                         | 代码审                                                    |
| **D17** | Phase B/C 部署          | 没说                                         | **必须同一发布窗口**，禁止分批（unique 索引变更 + service 改造耦合）                                                                                                     | 代码审 #1 + 安全审                                        |
| **D18** | findUnique 改 findFirst | 没说                                         | **强制改造**：所有 `findUnique({where:{name}})` 改 `findFirst({where:{name, userId: x ?? null}})`（Prisma `@@unique([name, userId])` 在 NULL 语义下不能直接 findUnique） | 代码审 #3                                                 |
| **D19** | admin 查询过滤          | 没说                                         | **admin findAll 强制 `WHERE userId IS NULL`** + 加单元测试守护                                                                                                           | 安全审 关键-2                                             |
| **D20** | Skill 占位              | 占位                                         | 推翻 D8（用户指令）；按完整实现走                                                                                                                                        | 用户                                                      |

### 12.3 基线后必加章节（PM 评审反馈）

| 章节 | 内容                                                | 状态 |
| ---- | --------------------------------------------------- | ---- |
| §13  | 结构化用户故事（As-a / I-want / So-that）           | 待补 |
| §14  | 度量指标（BYOK 渗透率 / Key 命中率 / 失败率 / TTV） | 待补 |
| §15  | 错误 UX 明文设计（401 / 429 / 缺失 / 删除冲突）     | 待补 |
| §16  | onboarding wizard 流程（首次进入引导）              | 待补 |

### 12.4 v0.2 实施前置（必须全绿才进 Phase B）

- [x] D1-D20 决策落定（本节）
- [ ] §13-§16 PM 反馈章节落地
- [ ] 用户最终确认（**不再是用户独自评审，是上述 4 路评审 + 我汇总后的最后拍板**）
- [ ] Phase B PR-1 DB-only 模板就绪（schema diff + 手写迁移 SQL）

---

**v0.2 结论**：方案经 4 路专家评审，**20 项决策已闭环**。

---

## 13. 结构化用户故事（PM 反馈补充）

| ID  | As-a     | I-want                                                                | So-that                   | 优先级 |
| --- | -------- | --------------------------------------------------------------------- | ------------------------- | ------ |
| US1 | 终端用户 | 在「我的 API Key」用表格集中管理我所有类型的 Key（LLM + 工具 + 其他） | 不用每个功能单独配        | P0     |
| US2 | 终端用户 | 在「我的模型」给模型配 endpoint + 选用哪把 Key                        | 接自部署/本地模型         | P0     |
| US3 | 终端用户 | 在「我的工具」看到工具目录 + 配自己的工具 Key                         | 研究/抓取用自己的额度     | P0     |
| US4 | 终端用户 | 运行时优先用我的 Key，没有再按我的设置决定是否兜底                    | 账单可控不被系统偷偷计费  | P0     |
| US5 | 终端用户 | 在每个页面「向系统申请授权」获得系统的 Key/工具/技能                  | 没自己的 Key 也能先用起来 | P1     |
| US6 | 终端用户 | 在「我的技能」配置/申请本地技能                                       | 扩展 agent 能力           | P1     |
| US7 | 新用户   | 注册后有引导告诉我先配哪几把 Key                                      | 快速跑通第一个任务        | P1     |
| US8 | 终端用户 | 看到我每把 Key 今日/本月用量                                          | 监控成本                  | P2     |
| US9 | admin    | 审批用户的授权申请、给用户分配系统 Key/工具/技能                      | 管控资源分发              | P1     |

## 14. 度量指标（成功标准）

| 指标                | 定义                               | 目标             |
| ------------------- | ---------------------------------- | ---------------- |
| BYOK 渗透率         | 配过 ≥1 把 Key 的用户 / 总活跃用户 | 上线 30 天 > 40% |
| 用户 Key 命中率     | 走用户 Key 的工具调用 / 总工具调用 | > 60%            |
| 配 Key 失败率       | 测试按钮 fail / 总测试             | < 15%            |
| TTV（首次价值时间） | 注册 → 首次成功（用自己 Key）调用  | 中位数 < 10 分钟 |
| 授权申请闭环时长    | 申请提交 → admin 审批              | 中位数 < 24h     |

## 15. 错误 UX 明文设计

| 场景                      | 触发                                   | 前端表现                                                                 | 跳转                                                          |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Key 鉴权失败 401          | 工具/LLM 调用返回 401                  | toast「{provider} Key 鉴权失败，请检查」                                 | 跳 /me/api-keys 高亮该行（query param `?highlight=secretId`） |
| 限流 429                  | provider 返回 429                      | toast「{provider} 触发限流，稍后重试或换 Key」                           | 不跳转                                                        |
| Key 缺失（STRICT 模式）   | resolver 抛 NoToolKeyError             | **功能入口阻断**：研究启动按钮 disabled + tooltip「需先配置 {tool} Key」 | 点 tooltip 跳 /me/tools                                       |
| Key 缺失（fallback 模式） | 走 admin Key                           | 静默成功，但 /me/billing 标注「本次用系统 Key」                          | —                                                             |
| 删被引用的 Key            | DELETE /me/secrets/:id 且被 model 引用 | Modal「该 Key 被 N 个模型使用，先解绑」+ 列出引用                        | 提供「批量解绑」按钮                                          |
| 测试超频                  | 测试按钮 > 5次/h                       | toast「测试过于频繁，请 1 小时后再试」                                   | —                                                             |

## 16. Onboarding Wizard（首次配 Key 引导）

```
注册成功 → Dashboard 顶部 Banner:
  "🚀 配置 1 把 LLM Key + 1 把搜索 Key 即可开始研究"  [立即配置]
        ↓ 点击
  /me/api-keys?wizard=1 打开向导 Modal:
    Step 1: 选 LLM Provider (OpenAI / Anthropic / DeepSeek...) → 填 Key → 测试
    Step 2: 选搜索工具 (Tavily 推荐) → 填 Key → 测试
    Step 3: 完成 → "去跑第一个研究" [跳转 /research]
```

向导仅推荐**最小可用套餐**（1 LLM + 1 搜索），不暴露 14 个 category 全清单（避免认知过载）。已配过 Key 的用户不再弹 Banner（localStorage + 后端 user.onboardedByok 标记）。

---

## 17. 细化实施步骤（自驱执行清单）

> 严格按 4 PR 顺序，每个 PR 内步骤带 verify。PR-1 与 PR-2 同窗口部署（D17）。

### PR-1: DB Schema（Phase B）

| 步  | 动作                                                                                             | 文件                                                                  | verify                |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------- |
| B1  | Secret 加 `userId String?` + `@@index([userId, category])`；unique 改 `@@unique([name, userId])` | `backend/prisma/schema/models.prisma`                                 | `npx prisma validate` |
| B2  | UserModelConfig 加 `apiKeyId String?` + relation                                                 | 同上                                                                  | 同上                  |
| B3  | User 加 `byokMode` enum + `onboardedByok Boolean`                                                | 同上                                                                  | 同上                  |
| B4  | 新 model `AuthorizationRequest` + `AuthorizationGrant` + enums                                   | 同上                                                                  | 同上                  |
| B5  | SecretAccessLog 冗余 `userId String?`（审计断链修复，D10）                                       | 同上                                                                  | 同上                  |
| B6  | 手写迁移 SQL：ADD COLUMN + DROP old unique + 2 个 partial index                                  | `backend/prisma/migrations/20260527_byok_tool_coverage/migration.sql` | 见下                  |
| B7  | `npx prisma generate`                                                                            | —                                                                     | 类型无报错            |
| B8  | 迁移前置检查：`SELECT name, count(*) FROM secrets GROUP BY name HAVING count(*)>1`（确认无重名） | —                                                                     | 0 行                  |

迁移 SQL 核心：

```sql
ALTER TABLE secrets ADD COLUMN "userId" TEXT;
ALTER TABLE secret_access_logs ADD COLUMN "userId" TEXT;
ALTER TABLE user_model_configs ADD COLUMN "apiKeyId" TEXT;
ALTER TABLE users ADD COLUMN "byokMode" TEXT NOT NULL DEFAULT 'STRICT';
ALTER TABLE users ADD COLUMN "onboardedByok" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX IF EXISTS "secrets_name_key";
CREATE UNIQUE INDEX "secrets_name_admin_key" ON secrets(name) WHERE "userId" IS NULL;
CREATE UNIQUE INDEX "secrets_name_user_key" ON secrets(name, "userId") WHERE "userId" IS NOT NULL;
CREATE INDEX "secrets_userId_category_idx" ON secrets("userId", category);
-- AuthorizationRequest / AuthorizationGrant CREATE TABLE...
```

### PR-2: 后端（Phase C）—— 与 PR-1 同窗口

| 步  | 动作                                                                                                                | 文件                                                 | verify                         |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| C1  | extract `EncryptionService`（从 SecretsService private encrypt/decrypt 提出）+ HKDF per-user 派生（D7）             | `ai-infra/secrets/encryption.service.ts`             | 单测 encrypt/decrypt roundtrip |
| C2  | SecretsService 所有 `findUnique({where:{name}})` → `findFirst({where:{name, userId: x ?? null}})`（46 处梳理，D18） | `secrets.service.ts`                                 | 现有测试全绿                   |
| C3  | `getValueInternal/WithKeyId/AllKeys` 三方法加 `opts?:{userId?}`；`userId===undefined` 抛错（D6）                    | 同上                                                 | 8 单测（见 §12 测试矩阵）      |
| C4  | admin `findAll` 强制 `WHERE userId IS NULL`（D19）                                                                  | 同上                                                 | 隔离单测                       |
| C5  | 新 `UserSecretsController` + `UserSecretsService`（CRUD + owner Guard + IDOR 防护）                                 | `modules/me/byok/user-secrets.*`                     | CRUD 集成测试                  |
| C6  | `ToolKeyResolverService`（user→grant→strict/fallback 优先级链，D3）放 ai-engine 层                                  | `ai-engine/credentials/tool-key-resolver.service.ts` | 优先级链单测                   |
| C7  | `/me/tools` 端点（mirror EXTERNAL_TOOL_DEFINITIONS + 用户 Key 状态，仅 systemConfigured bool 不漏 hint，D安全高-3） | `user-tools.controller.ts`                           | 响应不含 admin hint            |
| C8  | `/me/secrets/:id/test` + `@Throttle(5,3600)` + audit（D11）                                                         | 同上                                                 | 限流测试                       |
| C9  | AuthorizationRequest/Grant CRUD + admin 审批端点                                                                    | `modules/me/byok/authorization.*` + admin 侧         | 审批流测试                     |
| C10 | EXTERNAL_TOOL_DEFINITIONS 加 `userConfigurable: boolean`（架构师 #4）                                               | `ai-admin.service.ts` / 共享常量                     | —                              |
| C11 | `verify:arch` 确认分层无违规                                                                                        | —                                                    | 绿                             |

### PR-3: 前端（Phase D）

| 步  | 动作                                                                  | 文件                            | verify          |
| --- | --------------------------------------------------------------------- | ------------------------------- | --------------- |
| D1  | 提 admin SecretsManager 列组件到 `components/common/secrets/`（D9）   | 重构 admin + 新建 common        | admin 页不回归  |
| D2  | `/me/api-keys` 单表格（复用 common/secrets，dataHook=useUserSecrets） | `app/me/api-keys` + 组件        | 手测            |
| D3  | `/me/models` 加 endpoint + 使用 Key 下拉（已部分完成 fa1f45e5f）      | `components/me/models/*`        | 手测            |
| D4  | `/me/tools` 新页（复用 admin APIServicesTable 列布局）                | `app/me/tools` + 组件           | 手测            |
| D5  | `/me/skills` 新页（镜像 admin 本地技能）                              | `app/me/skills` + 组件          | 手测            |
| D6  | `/me/billing` 最小版用量（D13）                                       | `app/me/billing`                | 手测            |
| D7  | Sidebar 加 4 菜单 + 各页「申请授权」按钮                              | `components/layout/Sidebar.tsx` | 导航通          |
| D8  | Onboarding wizard Banner + Modal（D12 §16）                           | dashboard + wizard 组件         | 首次弹/已配不弹 |
| D9  | 错误 UX（401 toast+高亮 / 缺失阻断，D14 §15）                         | 全局拦截器 + 功能入口           | 手测            |
| D10 | 响应式列裁剪（窄屏次要列收起，UI 总原则 §7.2.5）                      | common/secrets                  | 窄屏手测        |

### PR-4: 工具链透传 + 测试（Phase E）

| 步  | 动作                                                                    | 文件                                               | verify          |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------- | --------------- |
| E1  | grep 46 个 getValueInternal 调用点，标注哪些在 tool 执行路径            | 全仓                                               | 清单            |
| E2  | tool handler / ToolInvoker 透传 ctx.userId                              | `ai-engine/tools/handlers/*` `ai-harness/runner/*` | —               |
| E3  | BullMQ job payload 加 userId + RequestContext.run 恢复（D17 + v1.0 J9） | worker 入口                                        | —               |
| E4  | ESLint rule: getValueInternal 必带显式 opts（error 级，D6）             | `.eslintrc.js`                                     | lint 拦截       |
| E5  | E2E：用户配 tavily Key → 跑 research → log 确认走用户 Key               | 手测 + 集成                                        | §9 验收基线 1-8 |

### 跨 PR 验收门禁

- 每 PR：`npm run verify:changed` + `verify:arch` 绿
- PR-1+2 合并窗口后：admin /admin/access/secrets 回归测试（不破）
- PR-4 后：§9 验收基线 8 场景全过

---

**最终结论（v0.2 基线锁定）**：20 项决策 + 9 用户故事 + 5 度量 + 错误 UX + onboarding + 4-PR 细化步骤已全部成文。**按用户授权进入完全自驱实施，不再逐项确认；遇不决之事组织投票**。

---

## 18. 投票裁决（v0.3，2026-05-27）—— 真正共识

> 用户质疑「方案是否充分共识」。诚实结论：v0.2 中 2 个决策点是单方裁决（评审间有冲突）。按用户指令「不决之事组织投票」，对 V1/V2 组织 3 票独立投票（架构 / 安全 / 工程视角），结果如下。**投票验证了 v0.2 基线**（非推翻），现升级为真正共识 v0.3。

### V1: 用户 LLM Key 存哪张表？ → **B 胜（2:1）**

| 投票人 | 票    | 核心理由                                                                                                                              |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 架构师 | **B** | 捐赠池/多key fallback/熔断是 user_api_keys 活机制；捐赠 key 已落 secrets 表（两表已耦合）；迁 A = 重写 KeyResolver 核心，高风险无收益 |
| 工程   | **B** | A 约 5-8 天 + 高回归（v1.0 已上线，字段漏迁=解密失败）；B 约 1-2 天 + 零回归                                                          |
| 安全   | A     | 两套 owner 过滤路径易越权（被 D6/D19 强制过滤 + 测试化解）                                                                            |

**裁决 = B**：LLM Key 留 `user_api_keys`，工具/其他类 Key 进 `secrets`(userId)，`/me/secrets` 端点 UNION 两表给前端（UI 仍一个表）。

### V2: 缺 Key 兜底默认？ → **SWITCH-default-strict 胜（2:1）**

| 投票人 | 票            | 核心理由                                                                                        |
| ------ | ------------- | ----------------------------------------------------------------------------------------------- |
| 架构师 | **SWITCH**    | 默认 STRICT 守安全线，开关让用户显式知情同意才走 admin 池，留运营弹性                           |
| 工程   | **SWITCH**    | TIER-based 测试矩阵翻倍 + resolver 依赖 billing；SWITCH 仅一处 if + 2×2 矩阵                    |
| 安全   | STRICT-always | 红线「字段丢失也要 deny」→ 由 `byok_mode NOT NULL DEFAULT 'STRICT'` + undefined-userId 抛错满足 |

**裁决 = SWITCH-default-strict**：`user.byokMode` 默认 STRICT（NOT NULL），用户可显式切 FALLBACK。

### 18.1 投票产生的 3 条落地铁律（MUST，写进 PR-2/PR-3 验收）

1. **`/me/secrets` 写回按 category 分流**：`category=AI_MODEL` → 写 `user_api_keys`；其余 → 写 `secrets`(userId)。端点内显式分支 + 注释 + 测试守护，禁止语义裂开。
2. **UNION 读端点排除捐赠 key**：`secrets` 侧 `WHERE category != 'USER_DONATED'`；`user_api_keys` 侧 `WHERE mode != 'DONATED'`。否则用户会在自己表格看到自己捐出去的 key。
3. **不给 user_api_keys 加 category 列**：UI 需要的 category 在端点层映射（LLM 行映射 `category='AI_MODEL'`），不下沉 schema，避免又一次迁移。

### 18.2 共识达成度

- V1/V2 均 2:1 多数票，少数票（安全）红线已被现有 D6/D19 + NOT NULL 默认值化解，无悬而未决反对。
- 其余 18 项决策评审间无冲突，属一致同意。
- **结论：方案 v0.3 已达充分共识，进入实施。**

---

## 19. 实施进度（2026-05-27 实时）

### 后端 Phase B + C —— ✅ 完成（7 commits，全绿：tsc 0 + 单测 + verify:arch 250/250）

| 提交        | 内容                                                                                                                                   | 测试        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `72cb2370e` | 方案 v0.3 文档                                                                                                                         | —           |
| `d2ede4c9b` | DB schema + 迁移（secrets.userId / byok_mode / 2 partial index / auth 表）+ per-user HKDF 加密 + SecretsService admin-only 隔离（D19） | 145 secrets |
| `ae303081b` | UserSecretsService 统一 CRUD（3 铁律：category 分流 / 排捐赠 / 不下沉 category）                                                       | 9           |
| `12d3fca0d` | ToolKeyResolverService（user→grant→strict/fallback，D6 强制 userId）                                                                   | 7           |
| `bbc06601d` | /me/tools 目录端点（systemConfigured bool-only 不漏 hint）+ 授权申请/审批 + 工具定义下沉共享层                                         | 4           |

后端新增端点（全部 `@UseGuards(JwtAuthGuard)`，admin 加 `AdminGuard`）：

- `GET/POST/PUT/DELETE /user/secrets` —— 统一 Key CRUD（按 source=llm/secret 分流）
- `GET /user/tools` —— 工具目录 + 用户 Key 状态
- `POST/GET/DELETE /user/authorization/requests` + `GET /user/authorization/grants`
- `GET /admin/authorization/requests/pending` + `POST .../:id/approve|reject` + `DELETE .../grants/:id`

**未做（后端剩余）**：C8 `/user/secrets/:id/test`（测试按钮 + @Throttle，nice-to-have，不阻塞前端）。

### 前端 Phase D —— ⏳ 待实施（精确 wiring 已就绪）

> 关键发现：`/me/*` 不需要新建 `page.tsx`。路由由 `app/me/[section]/page.tsx` 动态渲染，菜单 + 内容来自注册表 `frontend/components/me/settings-sections.tsx` 的 `SETTINGS_SECTIONS`。新增页 = 注册表加一项 + 写一个内容组件。

| 步        | 动作                                                                                                                                                                               | 文件                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| D-svc     | 前端 API service（`/user/secrets` `/user/tools` `/user/authorization` 封装）                                                                                                       | `frontend/services/...` 或 hooks/domain     |
| D-keys    | `UserApiKeysTab` 重构成统一表格（拉 `/user/secrets`，列 = admin SecretsManager 同款：名称/类别 chip/值/状态/操作 + 搜索 + All Categories + 添加密钥 Modal）+「向系统申请 Key」按钮 | `components/me/api-keys/UserApiKeysTab.tsx` |
| D-tools   | 新 `UserToolsTab`（拉 `/user/tools`，按 category 分组 + 「我的 Key」状态列 + 配置/测试 + 申请工具授权）                                                                            | `components/me/tools/UserToolsTab.tsx`      |
| D-skills  | 新 `UserSkillsTab`（镜像 admin 本地技能；**注：用户侧 skills 后端尚不存在**，需先评估是 BYOK 范围还是独立 feature）                                                                | `components/me/skills/UserSkillsTab.tsx`    |
| D-models  | `UserModelsManagement` 加 endpoint + 「使用 Key」下拉（部分已于 `fa1f45e5f` 完成）                                                                                                 | `components/me/models/*`                    |
| D-nav     | `settings-sections.tsx` 加 `tools` / `skills` 两 section（icon: Wrench / Sparkles，group: 'ai'）+ i18n key `me.nav.tools` / `me.nav.skills`                                        | `settings-sections.tsx` + i18n              |
| D-onboard | onboarding banner（复用既有 `getByokStatus` + `byokOnboardedAt`）                                                                                                                  | dashboard                                   |
| D-error   | 错误 UX（401 toast + 高亮 / STRICT 缺 Key 阻断）                                                                                                                                   | 全局拦截器                                  |

### 运行时 Phase E —— ⏳ 待实施

| 步    | 动作                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1-E2 | 工具 handler / ToolInvoker 调用点改用 `ToolKeyResolverService.resolveToolKey(toolId, ctx.userId)` 取代直接 `secretsService.getValueInternal`（grep 工具执行路径上的调用点） |
| E3    | BullMQ job payload 带 userId + RequestContext 恢复（v1.0 J9 模式）                                                                                                          |
| E4    | ESLint rule：工具路径禁直接 getValueInternal（error 级）                                                                                                                    |
| E5    | E2E：用户配 tavily Key → 跑 research → log 确认走用户 Key（§9 验收基线）                                                                                                    |

### 部署门禁（D17）

- Phase B 迁移（`20260601_byok_tool_coverage`）+ Phase C 后端必须**同窗口部署**（unique 索引变更 + findFirst 改造耦合）。迁移尚未 apply 到任何 DB。

---

## 20. 最终实施状态（2026-05-28 收口）

### ✅ 已完成并验证（12 commits，全绿）

| 区块                                                   | commit                | 验证              |
| ------------------------------------------------------ | --------------------- | ----------------- |
| 方案 v0.3（4 路评审 + V1/V2 投票共识）                 | 72cb2370e / 608ee93af | —                 |
| DB schema + 迁移 + per-user HKDF + admin-only 隔离     | d2ede4c9b             | 145 secrets 单测  |
| 统一 user-secrets CRUD（3 铁律）                       | ae303081b             | 9                 |
| 工具 Key resolver（user→grant→strict/fallback）        | 12d3fca0d             | 7                 |
| /me/tools 端点 + 授权申请/审批 + 工具定义下沉          | bbc06601d             | 4 + 305 cred/arch |
| 前端 /me：统一 api-keys + tools + skills + 导航 + i18n | 3d00939ea             | tsc 0             |
| 模型 apiKeyId 选择器（endpoint + 使用 Key）            | 47400ab83             | tsc 0             |
| 运行时 BYOK：search 工具（headline）                   | e1d331970             | 90 search 单测    |
| 运行时 BYOK：finance connector                         | 7392745c7             | 18                |

**用户 7 项核心诉求全部落地**：① 统一各类 Key 表格 ② 模型配 endpoint+选 Key ③ 我的工具菜单 ④ 我的技能菜单 ⑤ 运行时优先 BYOK 工具（search/finance 已接，pattern 已固化）⑥ 向系统申请授权 ⑦ 归一系统配置界面。

### ⏳ 剩余长尾（同一 proven pattern，按优先级）

| 项                                       | 说明                                                                                | 落地模板                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 其余工具运行时 BYOK                      | image-generation / extraction(jina/firecrawl) / youtube(supadata) / tts(elevenlabs) | 复制 `SearchService.applyByokToolKeys` 或 `FinanceApiConnector.getApiKey`：注入 `ToolKeyResolverService` + `RequestContext.getUserId()` + 模块加 `ToolKeyResolverModule` + 测试补 mock |
| LLM 模型 apiKeyId 运行时honoring         | UserModelConfig.apiKeyId 已存，KeyResolverService 选 key 时优先用它                 | KeyResolver 读 config.apiKeyId                                                                                                                                                         |
| C8 测试按钮端点                          | `POST /user/secrets/:source/:id/test` + `@Throttle(5,3600)` + audit                 | admin SecretsService.test 参照                                                                                                                                                         |
| Onboarding wizard（§16）/ 错误 UX（§15） | dashboard banner + 401 toast 高亮                                                   | getByokStatus 已就绪                                                                                                                                                                   |
| 迁移 apply + 部署                        | `20260601_byok_tool_coverage` 须与后端同窗口（D17）                                 | `prisma migrate deploy`                                                                                                                                                                |

> 状态诚实声明：BYOK 全量化的**架构核心 + 全部 UI + 存储 + 解析 + 鉴权 + headline 运行时**已完成可用；剩余为同模式的工具长尾接入 + 部署收尾。
