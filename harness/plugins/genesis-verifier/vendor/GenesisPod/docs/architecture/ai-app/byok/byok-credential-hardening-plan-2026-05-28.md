# BYOK 凭据加固方案（对标业界最佳实践）

> **版本**: v0.3（+ 退役捐赠池；H1 维持 Sep-A，可进入实施）
> **创建时间**: 2026-05-28
> **延伸自**: [byok-tool-coverage-extension-2026-05-27.md](./byok-tool-coverage-extension-2026-05-27.md)（已合并主干 `ef3ef60a7`）
> **状态**: 仅方案，不动代码；待 Owner 终审后交 Coder 执行
> **作者**: Claude Code
> **关联**: 商业化设计 [../../monetization/subscription-byok-credit-system-design.md](../../monetization/subscription-byok-credit-system-design.md)（billing hook 接缝见 §11）

---

## 0. TL;DR

BYOK 工具/技能扩展已合并主干，功能可用，但凭据存储**低于业界最佳实践**：AES-CBC（非 AEAD）、master key 在环境变量直推（无 KMS/信封加密）、无密钥轮换、**用户工具 BYOK 混在系统 `secrets` 表**、admin 路径实际只有 16 字节熵冒充 AES-256。

本方案把凭据层加固到 BP：**退役已废弃的捐赠池 + 结构性分离（工具 BYOK 移出 admin secrets）+ AES-GCM + 信封加密（DEK/KEK，KEK provider 可插拔 env/KMS）+ 密钥轮换接口**。

**为什么现在做**：存储层改动，代价随已存用户 key 数量指数增长；当前刚合并、生产 key ≈ 0，是最便宜窗口。且卖企业本地部署，CBC / env 主密钥 / 混表三项几乎必被企业安全评审挡。

---

## 1. 锁定的决策（按专业建议，2026-05-28）

| ID     | 决策                                                                                                                                                             | 取舍理由                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1** | **Sep-A（终态）**：工具/其它类 BYOK 移出 `secrets` → 新 `user_credentials` 表；**LLM 留 `user_api_keys`**（退役捐赠池后为纯个人 LLM 表）；`secrets` 回归系统专用 | 真正违反"BYOK/admin 分离"的只有工具混 admin 表；LLM 本就独立表、已与 admin 分离。**退役捐赠池后曾考虑 Sep-B（并 LLM 入 user_credentials），仍否决**：唯一收益是"少一张表"，代价是重写能用的 LLM 解析器（多 key/label 优先级 + 模型钉选 + KeyExecutor 健康熔断），违反 YAGNI；且 LLM key（富语义）与工具 key（简单 name→key）本就异质，分两张用户表合理。 |
| **H6** | **退役捐赠池**（Owner 确认 2026-05-28，**无存量 DONATED 数据、无前端入口**）                                                                                     | 消费侧已死（`getDonatedKey` 无生产调用方，测试注释明示"已废弃"）；strict BYOK + `AuthorizationGrant` 已取代；subscription-first 下"捐 key 赚 credit"失去意义；且共享 key 服务他人是计费归属 liability。                                                                                                                                                  |
| **H2** | **双读 + backfill**（`encVersion` 版本分流）                                                                                                                     | 不赌"零 key"；该机制做 KEK 轮换本来就需要，是可复用的正确模式。当前量小，backfill 分钟级。                                                                                                                                                                                                                                                               |
| **H3** | **纳入**遗留 `ai_models.api_key`，顺手消 `decryptLegacy`                                                                                                         | 一次性清掉历史长尾，避免长期维护两套解密。                                                                                                                                                                                                                                                                                                               |
| **H4** | **KEK provider 可插拔**：on-prem `EnvKekProvider`（文件/env，客户自管），cloud 首发 `AwsKmsKekProvider`                                                          | 选型 deploy 期配置，不锁死；KEK 抽象同时是 cloud/onprem edition 开关的一部分。                                                                                                                                                                                                                                                                           |
| **H5** | 先落 `kekVersion` 接口 + 版本列，**轮换作业（cron）P6 后置**                                                                                                     | 接口先到位，轮换运营能力可后补，不阻塞加固主体。                                                                                                                                                                                                                                                                                                         |

> **信封加密的一个连带结论**：每条凭据有独立随机 DEK（per-row），其爆炸半径比现有 per-user HKDF 更小 → **`user_credentials` 用信封即可，不再需要 HKDF**。HKDF 是过渡方案，被信封取代。

---

## 2. 现状（已读码核对，2026-05-28）

### 2.1 加密实现 `ai-infra/encryption/encryption.service.ts`

| 项         | 现状                                                            | 行       |
| ---------- | --------------------------------------------------------------- | -------- |
| 算法       | **AES-256-CBC**（非 AEAD，无完整性）                            | :87,:120 |
| master key | PBKDF2(env `SETTINGS_ENCRYPTION_KEY`, 静态 salt, 100k) → 32B    | :59-67   |
| admin key  | `material.toString("hex").substring(0,32)` = **实际 16 字节熵** | :67      |
| 用户 BYOK  | HKDF per-user 子密钥（静态 salt）—— 将被信封取代                | :76-113  |
| 轮换       | `currentKeyVersion=1` 钉死，无轮换路径                          | :33,:61  |

### 2.2 凭据密文分布（改造迁移范围）

| 表 / 字段                         | 存什么                                             | 当前加密        | 本方案动作                  |
| --------------------------------- | -------------------------------------------------- | --------------- | --------------------------- |
| `secrets.encryptedValue/iv`       | 系统 admin secret + **用户工具 BYOK(userId 非空)** | master / HKDF   | 用户行**迁出**；系统行升 v2 |
| `user_api_keys.encryptedValue/iv` | 用户 LLM BYOK（捐赠池退役后**纯个人**）            | master          | **原地**升 v2（不迁表）     |
| `secret_keys.encryptedValue`      | 单 secret 多 key（fallback/熔断池）                | master          | 原地升 v2                   |
| `secret_versions.encryptedValue`  | secret 历史版本                                    | master          | 原地升 v2                   |
| `ai_models.api_key`（遗留）       | 旧式直存                                           | `decryptLegacy` | 纳入 v2（H3）               |

调 `EncryptionService` 的生产服务：`secrets` / `secret-keys` / `user-api-keys` / `user-secrets` / `settings`。

### 2.3 分离现状

- 用户 **LLM** BYOK → `user_api_keys`（独立表，**已与 admin 分离**）
- 用户 **工具/其它** BYOK → `secrets`（**混入 admin**，靠 `userId` + partial unique index 区分）← **唯一违反点**

---

## 3. 与业界最佳实践的差距

| #   | BP                       | 现状                             | 严重度 | 企业评审必挂 |
| --- | ------------------------ | -------------------------------- | ------ | ------------ |
| G1  | AEAD（AES-GCM）防篡改    | AES-CBC                          | 高     | 是           |
| G2  | KMS/Vault KEK + 信封加密 | env 主密钥直推                   | 高     | 是           |
| G3  | 密钥轮换 + 版本化        | 无                               | 中高   | 是           |
| G4  | 系统/租户凭据信任层分离  | 工具 BYOK 混 admin 表            | 中高   | 是           |
| G5  | 全熵密钥                 | admin 16 字节熵                  | 中     | 可能         |
| G6  | per-tenant 爆炸半径      | ✅ HKDF（将升级为 per-row 信封） | —      | —            |
| G7  | 脱敏/不回明文/审计       | ✅                               | —      | —            |

---

## 4. 目标架构

### 4.1 结构性分离（Sep-A，G4）

```
                  ┌─────────────────────────────────────────────┐
用户 BYOK（个人）  │ user_api_keys      LLM 个人 key（保持，升 v2）  │
                  │ user_credentials ★ 工具/其它类 key（新表，v2） │
                  └─────────────────────────────────────────────┘
系统/租户共享      ┌─────────────────────────────────────────────┐
                  │ secrets            纯系统 admin（userId 恒 null）│
                  │ （捐赠池已退役 —— 见 H6/PR-0）                 │
                  └─────────────────────────────────────────────┘
```

- `secrets` 迁走用户行后 **userId 恒为 null**（系统专用）；隔离从"过滤依赖"回到"结构性"。
- 跨界（用户走系统 key）只在 `AuthorizationGrant` / `byokMode=FALLBACK` 那一刻发生，由 `ToolKeyResolver` 控制。
- `user_credentials` 字段预留 `apiEndpoint`/`preferredModelId`，为将来若要并入 LLM 留口（**本期不并**）。

### 4.2 认证加密（G1）

`AES-256-CBC → AES-256-GCM`。存 `iv(12B)` + `ciphertext` + `authTag(16B)`，解密校验 tag，篡改即失败。

### 4.3 信封加密 + KEK provider（G2 + cloud/onprem）

```
明文 ─AES-256-GCM(DEK)→ 密文        DEK = 每条凭据随机 32B
DEK  ─wrap(KEK)───────→ wrappedDek  KEK 由 provider 托管

interface IKekProvider {
  wrap(dek: Buffer): Promise<{ wrapped: string; kekVersion: number }>;
  unwrap(wrapped: string, kekVersion: number): Promise<Buffer>;
  readonly currentVersion: number;
}
```

| Provider            | edition       | KEK 来源                               |
| ------------------- | ------------- | -------------------------------------- |
| `EnvKekProvider`    | on-prem / dev | 挂载文件 / env（客户自管，不回连厂商） |
| `AwsKmsKekProvider` | cloud         | AWS KMS（`GenerateDataKey`/`Decrypt`） |

> 红利：轮换 KEK 只 re-wrap DEK，不碰明文密文（G3 几乎免费）；KEK 泄露半径可控；on-prem 客户用自己 KMS/HSM，企业评审友好。

### 4.4 轮换与版本（G3）

- 行级 `encVersion`：`1`=legacy(CBC/master/HKDF)，`2`=GCM/envelope。
- `kekVersion`：KEK 轮换计数，解密按版本取 KEK unwrap。
- 轮换作业（P6）：批量 re-wrap（KEK 轮换）+ 懒迁移（访问时 v1→v2）+ backfill 扫尾。

---

## 5. 数据模型 Diff（Prisma）

### 5.1 新表 `user_credentials`（承载工具/其它类 BYOK）

```prisma
model UserCredential {
  id          String         @id @default(cuid())
  userId      String         @map("user_id")
  category    SecretCategory                          // 不含 AI_MODEL（LLM 留 user_api_keys）
  name        String         @db.VarChar(100)         // (userId,name) 作用域唯一
  displayName String         @map("display_name") @db.VarChar(200)
  provider    String?        @db.VarChar(50)
  description String?        @db.Text
  apiEndpoint String?        @map("api_endpoint") @db.Text   // 预留（自部署工具）

  // 信封加密 (AES-256-GCM + KEK-wrapped DEK)
  encryptedValue String @map("encrypted_value") @db.Text
  iv             String @db.VarChar(32)
  authTag        String @map("auth_tag") @db.VarChar(32)
  wrappedDek     String @map("wrapped_dek") @db.Text
  encVersion     Int    @default(2) @map("enc_version")
  kekVersion     Int    @default(1) @map("kek_version")
  keyHint        String? @map("key_hint") @db.VarChar(40)

  isActive    Boolean   @default(true) @map("is_active")
  expiresAt   DateTime? @map("expires_at")
  testStatus  String?   @map("test_status") @db.VarChar(20)
  accessCount Int       @default(0) @map("access_count")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")
  deletedBy String?   @map("deleted_by") @db.VarChar(100)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, name])
  @@index([userId, category])
  @@map("user_credentials")
}
```

### 5.2 现有凭据表加 v2 信封列（dual-read 用，原地升级）

对 `secrets` / `user_api_keys` / `secret_keys` / `secret_versions` 各加：

```prisma
authTag    String? @map("auth_tag") @db.VarChar(32)
wrappedDek String? @map("wrapped_dek") @db.Text
encVersion Int     @default(1) @map("enc_version")   // 现存行=1，新写=2
kekVersion Int     @default(1) @map("kek_version")
```

（`keyVersion` 旧列保留不动，避免破坏现有引用。）

### 5.3 `secrets` 回归系统专用

迁走用户行后：`DROP INDEX secrets_name_user_key`（用户 partial unique 不再需要）；保留 `secrets_name_admin_key`（= 系统 name 唯一）。`userId` 列保留但恒 null，标注 `@deprecated`，留待后续大版本 DROP。

---

## 6. 后端服务 Diff

### 6.1 `EncryptionService` 新增信封 API（保留旧方法供 dual-read）

```ts
// 新增（v2）
encryptEnvelope(plaintext: string): Promise<EnvelopeResult>
//   → { encryptedValue, iv, authTag, wrappedDek, kekVersion, encVersion: 2 }
decryptEnvelope(row: EnvelopeRow): Promise<string | null>
//   kekVersion → kek.unwrap(wrappedDek) → AES-256-GCM 解密 + 校验 authTag

// 统一解密分派（所有 caller 经此，按 encVersion 双读）
decryptAny(row): Promise<string | null>
//   encVersion===2 → decryptEnvelope；否则 → 旧 decrypt / decryptForUser / decryptLegacy

// 保留（legacy v1，backfill 完成后再删）：encrypt/decrypt/encryptForUser/decryptForUser/decryptLegacy
```

`IKekProvider` 注入；`EnvKekProvider`（P1）/ `AwsKmsKekProvider`（P6）按 `GENESIS_EDITION` 装载。

### 6.2 新 `UserCredentialsService`（工具/其它类 BYOK 的 CRUD + 运行时取值）

- `create/update/remove/list/testKey`：owner 强制 `userId` 过滤（防 IDOR），软删 + deletedBy。
- `getCredentialValue(name, userId)`：运行时取明文（供 `ToolKeyResolver`）；`userId` 缺失抛错（沿用 D6）。
- 全部走 `encryptEnvelope/decryptEnvelope`。

### 6.3 改造点（按 §2.3 分离 + 双读）

| 文件                                                                                   | 改造                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credentials/user-secrets/user-secrets.service.ts`                                     | 非 AI_MODEL 写/读从 `secrets` 改到 `user_credentials`（铁律 1 的"其余 category"分支迁移）；UNION 读 = `user_api_keys`(LLM) + `user_credentials`(工具) |
| `credentials/tool-key-resolver/tool-key-resolver.service.ts`                           | `userSecrets.getUserSecretValue` → `userCredentials.getCredentialValue`（user 优先分支改读新表）；grant/fallback 仍读 `secrets`(系统)                 |
| `secrets/secrets.service.ts`                                                           | 所有查询去掉 user 维度（恒 `userId: null`）；`encrypt/decrypt` 调用换 `encryptEnvelope/decryptAny`                                                    |
| `secrets/secret-keys.service.ts`、`credentials/user-api-keys/user-api-keys.service.ts` | 加密读写换 `encryptEnvelope/decryptAny`（dual-read）                                                                                                  |
| `ai-model-config`（读 `ai_models.api_key`）                                            | 解密换 `decryptAny`（H3，含 legacy 分支）                                                                                                             |

> `ToolKeyResolver` 的 `source`（`user`/`granted`/`admin-fallback`）语义不变 —— 仍是 §11 计费判定依据。

---

## 7. 迁移策略（key≈0，按通用可重放设计）

1. **schema 先行**（P2）：建 `user_credentials` + 4 表加 v2 列。
2. **双读**（P3）：`decryptAny` 按 `encVersion` 分流，旧行(v1)走 legacy，零 caller 改动。
3. **新写一律 v2**：CRUD 走 `encryptEnvelope`。
4. **backfill 作业**（P4）：
   - a. `secrets` 中 `userId IS NOT NULL` 的工具行：`decryptForUser` → `encryptEnvelope` → 写入 `user_credentials` → 源行软删/标记。
   - b. `secrets`(系统) / `user_api_keys` / `secret_keys` / `secret_versions` 的 v1 行：解密 → `encryptEnvelope` 原地升 v2（admin 16 字节熵 G5 在此自然消除）。
   - c. `ai_models.api_key` legacy → v2（H3）。
   - 完成后全表 `encVersion=2`，可下线 legacy 解密分支。
5. **回滚点**：backfill 前快照；每步可单独回滚；源行验证通过前不物理删。

---

## 8. 分阶段实施（PR 顺序，file-level，每步带 verify）

### PR-0 退役捐赠池（H6，前置；无存量数据，纯删机制）

| 步  | 动作                                                                                   | 文件                                                 | verify            |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------- |
| 0.1 | 删 `getDonatedKey` + 共享池轮询逻辑                                                    | `credentials/user-api-keys/user-api-keys.service.ts` | 引用清零（grep）  |
| 0.2 | 删 donate/withdraw 端点 + DTO 里 `DONATED` 选项                                        | `ai-app/byok/user-api-keys.controller.ts` + dto      | 端点下线          |
| 0.3 | 删各处 `mode != DONATED` 排除过滤（退役后 user_api_keys 全 personal）                  | `user-secrets.service.ts` 等                         | 列表行为不变      |
| 0.4 | 停止产生 `DONATION_REWARD` / `DONATION_USAGE_REWARD` 交易（枚举值保留，历史交易可读）  | credits 相关                                         | 无新增该类交易    |
| 0.5 | `mode` 字段与 `donatedSecretId` / `donationRewardedAt` 标 `@deprecated`（DROP 留后续） | schema                                               | `prisma validate` |
| 0.6 | 无存量 DONATED 数据（已确认），无需数据迁移；加守护断言（生产 DONATED 计数=0）         | 一次性脚本/spec                                      | count=0           |

### PR-1 加密内核（无 schema、无行为变更）

| 步  | 动作                                                                | 文件                                        | verify                                               |
| --- | ------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| 1.1 | `IKekProvider` 接口 + `EnvKekProvider`（KEK 取自 env/文件，含版本） | `ai-infra/encryption/kek/*`                 | 单测 wrap/unwrap roundtrip                           |
| 1.2 | `EncryptionService.encryptEnvelope/decryptEnvelope`（AES-256-GCM）  | `encryption.service.ts`                     | GCM roundtrip / **authTag 篡改即失败** / iv 每次随机 |
| 1.3 | `decryptAny` 分派（encVersion 双读，含 legacy CBC/HKDF/legacy）     | 同上                                        | v1/v2 各路径单测                                     |
| 1.4 | `EncryptionModule` 按 `GENESIS_EDITION` 装载 provider               | `encryption.module.ts` + app.config edition | onprem→Env / cloud→(P6 KMS)                          |

### PR-2 Schema（与 PR-3 同窗口部署，D17 同类约束）

| 步  | 动作                                                              | 文件                                                                | verify                  |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------- |
| 2.1 | 新 `UserCredential` model                                         | `prisma/schema/models.prisma`                                       | `prisma validate`       |
| 2.2 | `secrets`/`user_api_keys`/`secret_keys`/`secret_versions` 加 4 列 | 同上                                                                | 同上                    |
| 2.3 | 手写迁移：建表 + 加列 + 索引（partial index 规则见 §9）           | `prisma/migrations/2026….._byok_credential_hardening/migration.sql` | 影子库 `migrate deploy` |
| 2.4 | `prisma generate`                                                 | —                                                                   | 类型 0 错               |

### PR-3 内核接入 + 新写 v2（dual-read 生效）

| 步  | 动作                                                      | 文件                             | verify                             |
| --- | --------------------------------------------------------- | -------------------------------- | ---------------------------------- |
| 3.1 | 5 服务加密读写换 `encryptEnvelope`/`decryptAny`           | §6.3 五处                        | 现有单测全绿（dual-read 兼容旧行） |
| 3.2 | 新 `UserCredentialsService` + module                      | `credentials/user-credentials/*` | CRUD + owner 隔离单测              |
| 3.3 | `user-secrets` 非 AI_MODEL 分支改写/读 `user_credentials` | `user-secrets.service.ts`        | UNION 读含两表；category 分流测试  |
| 3.4 | `verify:arch`                                             | —                                | 绿                                 |

### PR-4 分离迁移 + backfill

| 步  | 动作                                                                     | 文件 / 作业                            | verify                              |
| --- | ------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------- |
| 4.1 | backfill 命令：`secrets`(userId非空) → `user_credentials`(re-encrypt v2) | `scripts/backfill-user-credentials.ts` | 迁后 secrets 无用户行；抽样解密一致 |
| 4.2 | backfill：4 表 v1 行 → v2（含 admin 全熵 G5、ai_models legacy H3）       | 同一作业分步                           | 全表 `encVersion=2`                 |
| 4.3 | `ToolKeyResolver` user 分支改读 `user_credentials`                       | `tool-key-resolver.service.ts`         | §10 验收 1-8 + 优先级链单测         |
| 4.4 | `secrets` 查询去 user 维度（恒 null）；`DROP secrets_name_user_key`      | `secrets.service.ts` + 迁移            | admin 查询零用户行 + 隔离单测       |

### PR-5 清理 legacy（backfill 验证通过后）

| 步  | 动作                                                                                                | verify        |
| --- | --------------------------------------------------------------------------------------------------- | ------------- |
| 5.1 | 删 `decryptForUser`/HKDF、`decryptLegacy`、CBC `encrypt`（保留 `decrypt` 仅应急只读一版本周期后删） | 单测/全量回归 |
| 5.2 | `secrets.userId` 标 `@deprecated`（DROP 留后续大版本）                                              | —             |

### PR-6 Cloud KMS + 轮换（H4/H5，可后置）

| 步  | 动作                                  | verify               |
| --- | ------------------------------------- | -------------------- |
| 6.1 | `AwsKmsKekProvider`                   | 沙箱 KMS wrap/unwrap |
| 6.2 | KEK 轮换作业（re-wrap，kekVersion++） | 轮换后旧 v2 行仍可解 |

> **顺序铁律**：PR-1→2→3 把加密格式钉死并 dual-read 生效后，PR-4 才迁数据；不在迁移中途换加密格式。

---

## 9. 手写迁移 SQL 骨架（节选，遵项目规范）

```sql
-- user_credentials（信封原生 v2）
CREATE TABLE IF NOT EXISTS "user_credentials" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "category" "SecretCategory" NOT NULL DEFAULT 'OTHER',
  "name" VARCHAR(100) NOT NULL,
  "display_name" VARCHAR(200) NOT NULL,
  "provider" VARCHAR(50),
  "description" TEXT,
  "api_endpoint" TEXT,
  "encrypted_value" TEXT NOT NULL,
  "iv" VARCHAR(32) NOT NULL,
  "auth_tag" VARCHAR(32) NOT NULL,
  "wrapped_dek" TEXT NOT NULL,
  "enc_version" INTEGER NOT NULL DEFAULT 2,
  "kek_version" INTEGER NOT NULL DEFAULT 1,
  "key_hint" VARCHAR(40),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "test_status" VARCHAR(20),
  "access_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" VARCHAR(100),
  CONSTRAINT "user_credentials_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_user_id_name_key"
  ON "user_credentials"("user_id","name");
CREATE INDEX IF NOT EXISTS "user_credentials_user_id_category_idx"
  ON "user_credentials"("user_id","category");

-- 4 表加 v2 列（示例 secrets，其余同形）
ALTER TABLE "secrets"        ADD COLUMN IF NOT EXISTS "auth_tag" VARCHAR(32);
ALTER TABLE "secrets"        ADD COLUMN IF NOT EXISTS "wrapped_dek" TEXT;
ALTER TABLE "secrets"        ADD COLUMN IF NOT EXISTS "enc_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "secrets"        ADD COLUMN IF NOT EXISTS "kek_version" INTEGER NOT NULL DEFAULT 1;
-- user_api_keys / secret_keys / secret_versions 同上

-- PR-4 完成后：secrets 回系统专用
-- DROP INDEX IF EXISTS "secrets_name_user_key";   ← 用户行迁完再执行
```

---

## 10. 验收基线

| #   | 场景                                 | 期望                                                             |
| --- | ------------------------------------ | ---------------------------------------------------------------- |
| 1   | 新配工具 BYOK key                    | 写入 `user_credentials`，`enc_version=2`，`secrets` 无新增用户行 |
| 2   | 篡改 `auth_tag` 后解密               | 失败（GCM 完整性）                                               |
| 3   | 运行时跑 research（用户配了 tavily） | `ToolKeyResolver` 命中 `user_credentials`，source=user           |
| 4   | 删用户 key                           | 软删 + owner 校验；admin 不可见                                  |
| 5   | backfill 后全表                      | `enc_version=2`，抽样解密与原文一致                              |
| 6   | admin 在 `/admin/access/secrets`     | 仅 `userId IS NULL` 系统行，零用户行                             |
| 7   | KEK 轮换（P6）后读旧 v2 行           | 按 `kek_version` unwrap，仍可解                                  |
| 8   | on-prem（EnvKekProvider）            | 不回连厂商；KEK 来自客户挂载                                     |

---

## 11. 与商业化设计的接缝（不在本方案实现，仅标记）

加固后，`ToolKeyResolver.source`（`user`/`granted`/`admin-fallback`）+ LLM 侧 `apiKeySource` 是计费唯一依据：**`source=user` → 不计 credit（用户自付 provider）；`granted`/`admin-fallback`/`system` → 计 credit（平台掏钱）**。MeteringService 挂这两个分支即可。详见 [商业化设计 §6/§8](../../monetization/subscription-byok-credit-system-design.md)。

---

## 12. 风险

| 风险                        | 缓解                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| 双读漏判 → 旧密文解不开     | `encVersion` 显式列 + 默认走 legacy；backfill 前不下线旧分支      |
| GCM iv 复用 → 灾难          | 每次 `randomBytes(12)`；单测断言唯一                              |
| 分离迁移丢用户 key          | 迁前解密验证再写新表；源行验证通过前不物理删；分批 + 回滚点       |
| KEK 丢失 → 全部 unwrap 失败 | KEK 备份/逃生流程文档化；on-prem 客户须备份其 KEK（写入部署文档） |
| 退役捐赠池误删在用逻辑      | 已核实消费侧无生产调用方（仅测试）；PR-0 先 grep 引用清零再删     |
| 改加密触达 5 服务回归       | dual-read 保旧路径；按 PR 拆 + 每步全量单测 + `verify:arch`       |

---

## 13. 不在本方案范围

- feishu 独立 crypto（单独评估）
- 凭据计费/计量（见 §11，归商业化设计）
- LLM key 并入 `user_credentials`（Sep-B，**已评估否决**：见 H1；本期不做）

> 注：捐赠池**本期退役**（H6/PR-0），已从"不在范围"移入实施范围。

---

**最后更新**: 2026-05-28
**维护者**: Claude Code
**版本**: v0.3（退役捐赠池 + Sep-A 终态，待终审）
