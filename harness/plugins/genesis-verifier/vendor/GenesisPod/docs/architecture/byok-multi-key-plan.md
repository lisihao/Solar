# BYOK 同名多 Key 建设方案 —— 复用 admin 系统，呈现完全一致

> **核心决策（用户拍板 2026-05-29）**：BYOK **直接复用 admin 的 `secrets` + `secret_keys`
> 表、`SecretsService`/`SecretKeysService` 服务、`SecretKeysDrawer`/`MultiKeyTable` UI**，
> 仅以 `userId` 作用域区分（admin: `userId=NULL`；BYOK: `userId=当前用户`）。
> 不再维护 BYOK 独立的多 Key 逻辑/UI——**一套系统，呈现与 admin 完全一致**。
>
> 状态：**待确认 1 个数据迁移岔路**（见 §5），其余按"复用 admin"直接落地。创建 2026-05-29。

---

## 0. 为什么能直接复用（已核实）

- `secrets` 表**已有 `userId` 列** + 按作用域唯一（admin 行 userId=NULL；用户行 userId=非空）。当前用户行=0、系统行=46（来自重设计记录核实）。
- `secret_keys` 子表按 `secretId` 外键挂父 `secrets` 行——**天然同时服务 admin secret 和 user secret 的多 Key**，无需任何 schema 改动。
- 多 Key 全部能力已在 admin 侧实现且经过验证：
  - `SecretKeysService`：`listKeys / addKey / updateKeyMeta / replaceKeyValue / deleteKey / testKey` + `pickActiveKey`（priority asc + createdAt asc，`testStatus=failed && now-lastUsedAt<5min` 跳过，全熔断兜底第一个）+ `markSuccess / markFailure`
  - 前端 `MultiKeyTable`（LABEL/VALUE/PRIORITY/STATUS/HITS/LAST USED/ACTIONS + Add Key/Replace/Edit/Test/Delete）+ `SecretKeysDrawer`
- envelope v2 加密同一套（`EnvKekProvider`）。

**结论**：BYOK 多 Key = 把 admin 这套**按 userId 作用域开放给用户**，而非新建任何并行结构。

---

## 1. 目标架构：一套 secrets/secret_keys，userId 作用域

```
admin 密钥管理  →  secrets(userId=NULL)      + secret_keys   →  SecretsService/SecretKeysService  →  SecretKeysDrawer/MultiKeyTable
BYOK 用户密钥   →  secrets(userId=:userId)   + secret_keys   →  同上服务(加 owner 过滤)            →  同上 UI（呈现一致）
```

### 后端

1. **服务层加 userId 作用域**：`SecretsService` / `SecretKeysService` 的查询/写入支持按 `userId` 过滤（admin 调用传 `userId=null`；用户调用传 `req.user.id`）。所有按 `secretId` 操作子 Key 前，先校验该 `secret.userId === req.user.id`（owner 隔离，防 IDOR）。
2. **新增用户作用域 controller**（镜像 admin 的 `SecretsController` + `SecretKeysController`，但 Guard 换成普通 JwtAuthGuard + owner 过滤，去掉 AdminGuard）：
   ```
   GET    /user/secrets                          列当前用户的 secrets（userId=req.user.id）
   POST   /user/secrets                          建 user secret（自动建 primary secret_key）
   PATCH  /user/secrets/:id                      改元信息
   DELETE /user/secrets/:id                      软删 + 级联禁用子 key
   GET    /user/secrets/:id/keys                 列子 Key
   POST   /user/secrets/:id/keys                 Add Key { label, value, priority?, isActive? }
   PATCH  /user/secrets/:id/keys/:keyId          改 label/priority/isActive
   PUT    /user/secrets/:id/keys/:keyId/value    Replace value
   DELETE /user/secrets/:id/keys/:keyId          删 key
   POST   /user/secrets/:id/keys/:keyId/test     后端代测（不回传明文）
   ```
   全程 `where: { id, userId: req.user.id }` 兜底，杜绝越权。
3. **运行时取 Key 收敛到 secrets**：BYOK 解析改为读 user 作用域的 `secrets/secret_keys`，复用 admin 的 `pickActiveKey` failover（priority + 5min 熔断），失败回灌 `markFailure`。`ToolKeyResolverService` / LLM KeyResolver 的 user 分支统一走这套，`search.service.applyByokToolKeys` 简化为消费 resolver 的健康 Key。

### 前端

- `/me/api-keys` 行操作"编辑"→ 改为 **"管理 Key"**，打开**与 admin 同款的 `SecretKeysDrawer + MultiKeyTable`**（呈现完全一致：Add Key / priority / status badge / hits / last used / Replace / Test / Delete）。
- 复用 `useSecretKeys` hook 思路，新增指向 `/user/secrets/:id/keys` 的用户版 hook（或给现有 hook 加 baseUrl 切换 admin/user）。
- 顶部"添加密钥"= 新建一个 user secret（含 primary key）；之后在抽屉里 Add 备份 Key。
- 收敛技术债：废弃 `useUserSecrets`(UNION 扁平) + 孤立的 `UserApiKeyDrawer`/`useUserApiKeys`/`/user/api-keys/:provider`，统一到 user-scoped secrets 一套。

---

## 2. AI_MODEL + 工具如何统一

两类都落进 `secrets`（用 `category` 区分 AI_MODEL / 各工具类）+ `secret_keys` 多 Key。运行时按 `category`/`provider` 解析，failover 语义对两类完全一致——一套代码覆盖两类，无分叉。

## 3. 验证标准

- `/me/api-keys` "管理 Key" 抽屉与 admin `/admin/access/secrets` 抽屉**像素级一致**（同组件）✓
- 同名 Add 第 2 个 Key → priority 排序 + 主 key 失败 5min 内自动 failover（集成测试）✓
- owner 隔离：A 无法读/改/删 B 的 secret 或 secret_key（IDOR spec）✓
- 工具多 Key failover：主 key 429 自动切备份而非掉 DDG ✓
- 现有 BYOK 数据迁移无丢失（见 §5）✓
- 前端 `audit:ui-discipline` 复用 MultiKeyTable 天然合规 ✓

## 4. 分阶段

1. 服务层 userId 作用域 + owner 校验（SecretsService/SecretKeysService）→ verify: 单测
2. 用户 controller `/user/secrets[/:id/keys]`（镜像 admin，owner Guard）→ verify: e2e + IDOR spec
3. 运行时解析收敛到 user-scoped secrets + failover → verify: 熔断/优先级单测 + search 集成
4. 前端"管理 Key"抽屉接 user 子资源 + 废弃重叠入口 → verify: 类型 + UI 审计 + 手测
5. 数据迁移（§5 确认后）

## 5b. 实施中关键修正（2026-05-29，用户确认走安全正解）

核实运行时后发现：**LLM key 不应迁进 secrets**。

- LLM（user_api_keys）的多 Key + failover 已由 `KeyResolverService` 的 `KeyChain` +
  `KeyHealthStore` 熔断 + 健康回写完整实现，且深度集成 `key_assignments`。迁进 secrets 会
  拆毁这套体系，blast radius 极大。
- 数据现状：user_api_keys=20（全 LLM，已多 Key）、user_credentials=0、secrets 用户行=0
  → **无任何数据需要迁**；PR-4 backfill 当前为 no-op，无需"改向打架"。
- 安全正解：LLM 保留 user_api_keys（P4 接已存在的 `UserApiKeyDrawer`，呈现即对齐 admin）；
  工具走 secrets 多 Key（P3-tools 已做 + P4 接 secrets 版抽屉）。P5 迁移作废。

## 5. ⚠ (历史) 现有 BYOK 数据 + 与 PR-4 的方向冲突 —— 见 §5b，已按安全正解处置

**冲突**：既有 BYOK 重设计（记录 `project_byok_tool_key_redesign_2026_05_28`）的 PR-4 backfill 正把数据往 **`user_credentials`** 迁（与"收敛到 secrets"**方向相反**）；生产现有 `user_api_keys=20`(personal)、`user_credentials=0`、`secrets 用户行=0`。

"用 admin 的"意味着 BYOK 收敛到 `secrets/secret_keys`，需要：

- 把现有 `user_api_keys`(20 条) 迁成 user-scoped `secrets` + primary `secret_keys`；
- **撤掉/改向** deploy-migrations 里 PR-4 的 `user_credentials` backfill（否则两个方向打架）。

**请确认走哪条**：

- **A（推荐，贯彻你的指令）**：收敛到 secrets，迁移 user_api_keys → user secrets，废弃 user_credentials 方向（改 deploy-migrations）。
- **B**：保留 user_credentials 为存储、但 UI/服务"看起来像 admin"（折中，违背"用 admin 的一套表"，不推荐）。

A 是"完全用 admin 的"的彻底实现；定了我就按 §1-§4 落地并处理迁移。
