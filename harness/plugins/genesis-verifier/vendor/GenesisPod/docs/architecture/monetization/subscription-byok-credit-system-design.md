# GenesisPod 商业化系统设计：订阅制 + Free-tier BYOK + 统一 Credit 计量

> **版本**: v1.1
> **创建时间**: 2026-05-28
> **状态**: ⏸ **暂挂——待 BYOK 凭据加固后刷新**。BYOK 工具/技能全量化重构已合并主干（`ef3ef60a7`，2026-05-28）：用户模型/工具/技能改用自己的资源。**刷新结论已明确**：credit 计费判定从"能力类型"翻转为"key 归属"——`source=user`（自带 key）免费，`granted`/`admin-fallback`/`system`（平台掏钱）才扣 credit。D3/§6/§8/O1 待据此改写。**当前优先级**：先做 [BYOK 凭据加固](../ai-app/byok/byok-credential-hardening-plan-2026-05-28.md)（趁 key≈0），加固落地后再刷新本设计并接 MeteringService。
> **作者**: Claude Code + 项目 Owner
> **实施指导对象**: Coder Agent / Reviewer Agent / Tester Agent
>
> **与现有文档关系**：
>
> - 本文档**架在**现有 BYOK 之上，不替代它：[ai-app/byok/system-design.md](../ai-app/byok/system-design.md)（Key 解析、加密、分发池、申请工单）
> - 本文档**重构** Credit 的语义（从"虚拟钱包"→"订阅配额阀门"）：现状见 [credits-system-diagnostic](../ai-app/management/features-admin/credits-system-diagnostic.md)
> - 本文档**补齐**一个现存缺口：tools/skills 完全未计量（`logCapabilityUsage()` 已存在但全项目无人调用）

---

## 目录

- [1. 业务模型决策（已定 + 待拍板）](#1-业务模型决策已定--待拍板)
- [2. 现状盘点：三套互不打通的账](#2-现状盘点三套互不打通的账)
- [3. 核心架构原则](#3-核心架构原则)
- [4. 目标架构：统一计量 chokepoint](#4-目标架构统一计量-chokepoint)
- [5. 订阅 Tier 模型](#5-订阅-tier-模型)
- [6. 三种 LLM 接入模式与计费矩阵](#6-三种-llm-接入模式与计费矩阵)
- [7. Credit 机制改造](#7-credit-机制改造)
- [8. Tools / Skills 计量接线](#8-tools--skills-计量接线)
- [9. 模型维度](#9-模型维度)
- [10. 数据模型（Prisma Schema Diff）](#10-数据模型prisma-schema-diff)
- [11. 后端服务设计](#11-后端服务设计)
- [12. 前端改造](#12-前端改造)
- [13. 分阶段实施 Roadmap](#13-分阶段实施-roadmap)
- [14. 验收标准](#14-验收标准)
- [15. 风险登记册](#15-风险登记册)
- [16. 开放问题清单（待 Owner 拍板）](#16-开放问题清单待-owner-拍板)
- [17. 部署模式区分：Cloud SaaS vs On-Prem](#17-部署模式区分cloud-saas-vs-on-prem)

---

## 1. 业务模型决策（已定 + 待拍板）

### 1.1 已定原则

| #   | 决策                      | 说明                                                                                     |
| --- | ------------------------- | ---------------------------------------------------------------------------------------- |
| D1  | **订阅制为主**            | 主要收入是按月/年订阅费，credit 是订阅内的用量阀门，不是主要收钱手段                     |
| D2  | **Free tier 开放 BYOK**   | 免费用户也能绑定自己的 Provider Key                                                      |
| D3  | **BYOK 只换 token 成本**  | 绑自己的 key → LLM token 不扣 credit；但平台资源（搜索/绘图/编排）照计费、照受 tier 限制 |
| D4  | **BYOK 不抵扣订阅价**     | 卖的是产品（agents/teams/编排/UI/存储），不是转售 token                                  |
| D5  | **Credit 锚定真实 USD**   | credit 成本由 `model-pricing.registry` 的真实成本 × 毛利率推导，不再用随意 multiplier    |
| D6  | **Credit 为统一计量单位** | LLM / tools / skills 全部计入同一种 credit，从订阅月度配额里走                           |

> **D3 是整个设计的支点**：现状 tools/skills 对所有人都不计量（漏损），BYOK 只是把这个洞放大。先把计量补上，BYOK 的"token 免费、平台收费"才有抓手。

### 1.2 关键模型反转（需 Owner 确认，详见 §16）

现有 BYOK 设计是**强制 BYOK、无 SYSTEM fallback**（2026-05-05 锁定）——平台不替任何普通用户垫 token 钱。

订阅制要做"试用即用 / 开箱即用"，**需要反转这一条**：

> **订阅（含 Free tier）授予"平台 Key LLM 访问权"，按 credit 计量（从月度配额扣）；BYOK 是 opt-in，用来绕过 LLM credit 消耗。**

这相当于**重新启用一条"计量版 SYSTEM key 路径"**。它与 2026-05-05 的 strict-BYOK 不冲突，因为：strict-BYOK 是"平台不免费垫钱"，而订阅制下平台**收了订阅费**，提供平台 Key 并按 credit 计量正是变现本身。**此反转必须 Owner 明确批准**（O1）。

### 1.3 部署模式前提（重要）

**§1.1 的 D1–D6 与 §5–§9 默认描述的是 Cloud（SaaS）形态。** GenesisPod 同时有 On-Prem（本地/私有部署）形态，两者变现逻辑根本不同，**不能用同一套结算**。完整区分见 [§17](#17-部署模式区分cloud-saas-vs-on-prem)。一句话：**计量共享、结算分流**——统一计量 chokepoint 两端都开，但 Cloud 结算到真实钱（订阅+credit+支付），On-Prem 收 License（合同制）、credit 仅作可选内部成本管控。

---

## 2. 现状盘点：三套互不打通的账

> 全部来自实际读码（路径、字段已核对），不是推测。

| 账本                                              | 位置                                                                                    | 记什么                  | 谁在喂                                            | 状态           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------- | -------------- |
| **CreditTransaction**（计费账本）                 | `ai-infra/credits/`                                                                     | 扣多少 credit           | 仅 LLM chat 路径 `chat.facade.ts handleBilling()` | 生产可用       |
| **AIEngineMetric + cost-attribution**（成本观测） | `ai-harness/tracing/observability/cost-attribution.service.ts`                          | 真实 USD/用户/模型/模块 | 仅 LLM 路径                                       | 生产可用       |
| **AIUsageLog**（能力日志）                        | `ai-harness/runner/capabilities/ai-capability-resolver.service.ts#logCapabilityUsage()` | tool/skill 用量         | **schema 就绪，但方法全项目无人调用**             | 死代码，需接线 |

各维度成熟度：

- **模型**：最成熟。`ai-engine/llm/pricing/model-pricing.registry.ts` 已 DB 驱动（`AIModel` 表存 USD/百万 token + costTier），`estimateCost()` 能算真实成本。
- **Credit**：消费侧成熟（幂等、token 感知、可冻结），但**充值/套餐/支付/月度重置全缺**。`User.subscriptionTier`（默认 `"free"`）、`subscriptionExpiresAt` 只是占位。赚 credit 只有签到 + 管理员发放。
- **BYOK**：成熟。`KeyResolverService` 优先级 `PERSONAL → ASSIGNED → 报错`，AES-256-CBC 加密。**`apiKeySource==="personal"` 直接 `return` 跳过扣费**。
- **Tools / Skills**：几乎零计量。`ToolInvoker` 只记延迟；web-search / image-generation 这类真花钱的工具，成本既不计也不记。

### 2.1 真实字段（schema diff 的基线）

```prisma
// User（line 25-26）
subscriptionTier      String    @default("free") @map("subscription_tier")
subscriptionExpiresAt DateTime? @map("subscription_expires_at")

// CreditAccount（line 4608）：balance / totalEarned / totalSpent / giftBalance / giftExpiresAt
//                              / isFrozen / todaySpent / todayDate
// CreditTransaction（line 4632）：type / amount / balanceAfter / moduleType / operationType
//                              / tokenCount / inputTokens / outputTokens / cacheCreationTokens
//                              / cacheReadTokens / modelName / idempotencyKey(unique)
// CreditRule（line 4660）：moduleType / operationType / baseCredits / tokenMultiplier
//                              / modelMultipliers(Json) / @@unique([moduleType, operationType])
// AIUsageLog（line 6754）：capabilityType / capabilityId / userId / success / duration
//                              / tokensUsed / modelUsed / inputTokens / outputTokens
// AIEngineMetric（line 6833）：metricType / modelId / providerId / userId / inputTokens
//                              / outputTokens / totalTokens / estimatedCost(Decimal 10,6)
```

---

## 3. 核心架构原则

1. **一个计量 chokepoint**：任何可计费动作（LLM 调用 / tool 调用 / skill 运行）发出**同一个 `UsageEvent`** → 由 `MeteringService` 同时驱动 (a) credit 扣减 + (b) 成本归因 + (c) AIUsageLog。三条路收敛成一条。
2. **entitlement 与 metering 分离**：
   - **entitlement（前置）**：这个 tier 能不能用这个功能 / 还有没有配额 / 并发是否超限 → 拦在执行前。
   - **metering（后置）**：执行完按真实用量扣 credit、记成本 → 在执行后。
3. **credit 锚定真实 USD × 毛利率**：定价可审计、毛利可控。`credit = ceil(realCostUSD / CREDIT_USD_RATE)`，`CREDIT_USD_RATE` 为可配置成本基准。
4. **分层合规**：计量编排放 `ai-harness/guardrails/billing`（已有 `billing-adapter.ts`，已桥接 `CreditsService`）。`ai-engine` **不反向依赖** `ai-harness`——沿用现有模式：engine 返回 token usage，harness facade 做计费。
5. **BYOK 只豁免 LLM token，不豁免平台资源**：`apiKeySource==="personal"` 仅跳过 LLM credit，tool/skill 计量无视 apiKeySource。
6. **不破坏 prompt cache / 现有 BYOK 流程**：计费改在 finally / 后置，不动 LLM 调用主路径。

---

## 4. 目标架构：统一计量 chokepoint

```
┌──────────────────────────────────────────────────────────────┐
│  执行点（三处，各自发 UsageEvent）                              │
│                                                                │
│  ① LLM 调用     ai-engine/llm 返回 token usage                 │
│        └→ ai-harness/facade chat.facade handleBilling()        │
│  ② Tool 调用    ai-harness/runner/tool-invoker（执行后）        │
│  ③ Skill 运行   ai-harness skill-runtime（执行后）              │
└───────────────────────────┬────────────────────────────────────┘
                            │  UsageEvent { userId, kind, capabilityId,
                            │    model?, inputTokens?, outputTokens?,
                            │    apiKeySource, realCostUsd?, refId }
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  ai-harness/guardrails/billing/MeteringService（新增/收敛）     │
│                                                                │
│  1. 计算 credit 成本（CreditRule + 锚定 USD）                   │
│     ├─ kind=llm & apiKeySource=personal → LLM credit = 0       │
│     └─ kind=tool/skill → 无视 apiKeySource，照算                 │
│  2. CreditsService.consumeCredits()（幂等，idempotencyKey）     │
│  3. CostAttributionService.recordCost()（真实 USD 归因）         │
│  4. logCapabilityUsage() → AIUsageLog（接通死代码）             │
└───────────────────────────┬────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  ai-infra/credits（钱包/账本）  +  ai-infra/credentials（BYOK）  │
└──────────────────────────────────────────────────────────────┘

前置闸门（执行前）：
┌──────────────────────────────────────────────────────────────┐
│  EntitlementService（新增，guardrails/）                        │
│  - tier feature flag 检查（功能是否在该 tier 开放）              │
│  - 月度配额预检（余额是否够本次预估）                            │
│  - 并发 / 每日 mission 上限（BYOK 用户的主限流杠杆）             │
└──────────────────────────────────────────────────────────────┘
```

**为什么 chokepoint 在 harness 不在 engine**：engine 禁止 import harness（架构红线）。现有模式已经是"engine 算 token、harness 计费"，本设计只是把 tool/skill 两条路也并入同一个 harness 层 MeteringService。

---

## 5. 订阅 Tier 模型

> 价格、配额数字均为**占位**，待 Owner 拍板（O2）。结构先定。

| Tier           | 月费(占位) | 月度 credit(占位) | BYOK                | 平台资源(搜索/绘图) | 并发 / 每日 mission | 超额策略         |
| -------------- | ---------- | ----------------- | ------------------- | ------------------- | ------------------- | ---------------- |
| **Free**       | $0         | 少（如 2,000）    | ✅ 开放             | 砍狠，硬上限        | 低（如 1 / 5）      | 引导升级         |
| **Pro**        | $20        | 多（如 100,000）  | ✅ 开放             | 宽松                | 高（如 5 / 100）    | 可 pay-as-you-go |
| **Team**       | $按 seat   | 池化共享          | ASSIGNED 共享 key   | 最宽                | 最高                | 企业结算         |
| **Enterprise** | 定制       | 定制              | ASSIGNED + 私有部署 | 定制                | 定制                | 合同结算         |

**关键设计**：

- credit allowance **按月重置**，不滚存（或仅限滚存一个周期，O3）。
- **Free tier 的 BYOK 价值**：绑自己 key → LLM token 不吃那 2,000 credit，credit 只用于平台资源 → 免费用户能用更久。这就是获客钩子。
- **BYOK 用户的限流杠杆不是 credit 而是 entitlement**：因为他 LLM 不扣 credit，必须靠并发 / 每日 mission 上限 / 平台资源 credit 来约束（否则 Free + BYOK = 白嫖编排算力）。
- **Team/Enterprise 复用现有 ASSIGNED 机制**：组织管理员配共享 key、`key_assignments` 按 seat 计量配额——现成资产，不重造。

---

## 6. 三种 LLM 接入模式与计费矩阵

| 接入模式             | `apiKeySource` | Key 来源                                 | LLM token 计费        | 平台资源(tool/skill)计费 | 适用 tier          |
| -------------------- | -------------- | ---------------------------------------- | --------------------- | ------------------------ | ------------------ |
| **平台 Key（转售）** | `SYSTEM`       | 平台 Secret（计量版，**需 O1 启用**）    | 扣 credit（订阅配额） | 扣 credit                | 全 tier 默认       |
| **BYOK（自带）**     | `PERSONAL`     | `user_api_keys`                          | **0（免费）**         | 扣 credit                | 全 tier（含 Free） |
| **分配（组织）**     | `ASSIGNED`     | `distributable_keys` + `key_assignments` | 扣组织配额(cents)     | 扣 credit                | Team / Enterprise  |

> **唯一改动点（代码层面）**：现状 `apiKeySource==="personal"` → 跳过**所有**计费。新逻辑：personal 只跳过 **LLM token** credit，tool/skill 照走 MeteringService。

---

## 7. Credit 机制改造

### 7.1 语义重构：钱包 → 订阅配额

复用现有 `CreditAccount` + `CreditTransaction`，**不另起炉灶**。新增：

- 月度重置 job：周期边界到达时
  1. 过期上期未用完的订阅 credit → 写 `EXPIRATION` 交易（复用 `giftExpiresAt` 同类机制）
  2. 按 tier 授予本期 allowance → 写 `SUBSCRIPTION_GRANT` 交易（幂等 key = `sub-grant:{userId}:{periodStart}`）
- 充值（pay-as-you-go）走 `balance`，与订阅 credit 分账（见 §10 新增字段 `subscriptionBalance`）。

### 7.2 锚定真实 USD

```
realCostUsd = modelPricingRegistry.estimateCost(modelId, inputTokens, outputTokens, cacheRead, cacheWrite)
credits     = ceil(realCostUsd / CREDIT_USD_RATE)        // LLM
credits     = creditRule.baseCredits                     // tool/skill 固定项
```

**worked example**（占位参数 `CREDIT_USD_RATE = $0.0001`，即 1 credit = 0.01 美分）：

- gpt-4o 一次调用：input 2k + output 1k，真实成本 ≈ $0.015 → `ceil(0.015 / 0.0001) = 150 credits`
- web search 一次：固定 30 credits（对应平台采购单次成本 × 毛利）

> 现有 `CreditRule.tokenMultiplier / modelMultipliers` 的"拍脑袋倍率"逐步被"锚定 USD"取代；过渡期两者并存，LLM 走锚定、固定项走 baseCredits。

### 7.3 entitlement 预检

执行前 `EntitlementService.check(userId, action)`：

- 功能是否在该 tier 开放（feature flag）
- 预估 credit 是否 ≤ 可用余额（`subscriptionBalance + balance`）
- 并发 / 每日 mission 上限（Redis 计数）

不足 → 抛 `InsufficientEntitlementError`，前端展示升级/充值 CTA（复用现有 `useInsufficientCreditsModal`）。

---

## 8. Tools / Skills 计量接线

**这是补漏损的核心动作。**

1. **接通死代码**：`MeteringService` 调用现有 `logCapabilityUsage()`（`ai-capability-resolver.service.ts`），写 `AIUsageLog`。
2. **每个付费工具配 credit 规则**：复用 `CreditRule`，键 `(moduleType='tool', operationType=toolId)`；skill 同理 `(moduleType='skill', operationType=skillId)`。无需新表。
   ```
   { moduleType: 'tool',  operationType: 'web-search',       baseCredits: 30 }
   { moduleType: 'tool',  operationType: 'image-generation', baseCredits: 60 }
   { moduleType: 'skill', operationType: 'deep-research',    baseCredits: 200 }
   ```
3. **接线点**：`ai-harness/runner/tool-invoker/tool-invoker.ts` 的 `invoke()` 在 `tool.execute()` 之后（成功路径）发 `UsageEvent`。skill-runtime 同理。
4. **无 rule 的工具**：默认 0 credit（不阻断），但 `MeteringService` 打 WARN 日志（对齐 `budget-accountant` 的 "uncostled" 告警），便于补登记。

---

## 9. 模型维度

基本不用动，做两件收口：

1. **保证 `AIModel` 表 pricing 全且准**：缺价的模型 `estimateCost()` 返回 `null` → MeteringService 视为 uncostled 并告警（不静默当 0）。
2. **credit 锚定**：见 §7.2，把 LLM credit 从倍率改为锚定真实 USD。模型路由（`model-election.service.ts`）选中的 modelId 已能拿到，随 `UsageEvent` 一起带上，写入 `CreditTransaction.modelName` / `AIEngineMetric.modelId`。

---

## 10. 数据模型（Prisma Schema Diff）

> 按项目规范：手写 SQL 迁移，**不用 `prisma migrate dev`**；`ALTER TYPE ADD VALUE` 直接用 `IF NOT EXISTS`，**禁止** `DO $$ ... EXCEPTION` 包装（会建子事务，`migrate deploy` 必失败）。

### 10.1 新增表 `subscription_plans`

```prisma
/// 订阅套餐定义（tier 的"产品目录"）
model SubscriptionPlan {
  id                  String   @id @default(cuid())
  code                String   @unique @db.VarChar(50)   // free / pro / team / enterprise
  name                String   @db.VarChar(100)
  priceCents          Int      @default(0) @map("price_cents")
  billingPeriod       String   @default("monthly") @map("billing_period") // monthly / yearly
  monthlyCredits      Int      @default(0) @map("monthly_credits")          // 月度授予 credit
  concurrencyLimit    Int      @default(1) @map("concurrency_limit")
  dailyMissionLimit   Int      @default(5) @map("daily_mission_limit")
  byokAllowed         Boolean  @default(true) @map("byok_allowed")
  featureFlags        Json     @default("{}") @map("feature_flags")         // { "ai-research": true, ... }
  isActive            Boolean  @default(true) @map("is_active")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  subscriptions UserSubscription[]
  @@map("subscription_plans")
}
```

### 10.2 新增表 `user_subscriptions`

```prisma
/// 用户当前订阅状态
model UserSubscription {
  id                 String   @id @default(cuid())
  userId             String   @map("user_id")
  planCode           String   @map("plan_code")
  status             SubscriptionStatus @default(ACTIVE)
  currentPeriodStart DateTime @map("current_period_start")
  currentPeriodEnd   DateTime @map("current_period_end")
  cancelAtPeriodEnd  Boolean  @default(false) @map("cancel_at_period_end")
  externalRef        String?  @map("external_ref") @db.VarChar(200)  // 支付平台 sub id
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  user User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan SubscriptionPlan @relation(fields: [planCode], references: [code])

  @@unique([userId])             // 一期：一个用户一个活跃订阅
  @@index([status, currentPeriodEnd])
  @@map("user_subscriptions")
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
}
```

### 10.3 扩展 `CreditAccount`

```prisma
model CreditAccount {
  // ...已有字段保留
  subscriptionBalance Int       @default(0) @map("subscription_balance")  // 订阅授予、按周期重置
  allowanceResetAt    DateTime? @map("allowance_reset_at")                // 下次重置时间
  // 说明：balance = 充值/签到/补偿（不过期）；subscriptionBalance = 订阅配额（按期重置）
  // 扣费顺序：先扣 subscriptionBalance，后扣 balance
}
```

### 10.4 扩展 `CreditTransactionType` 枚举

```prisma
enum CreditTransactionType {
  // ...已有保留
  SUBSCRIPTION_GRANT  // 订阅周期授予
  TOOL_USAGE          // 工具调用消耗
  SKILL_USAGE         // 技能运行消耗
  TOPUP_PURCHASE      // 充值购买（pay-as-you-go）
}
```

### 10.5 手写迁移 SQL（骨架）

`backend/prisma/migrations/20260528_monetization_v1/migration.sql`

```sql
-- 1. SubscriptionStatus 枚举（CREATE TYPE 用 DO/EXCEPTION 合法——规则只禁 ALTER TYPE ADD VALUE）
DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING','ACTIVE','PAST_DUE','CANCELED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. CreditTransactionType 追加值（★ 直接 IF NOT EXISTS，禁止 DO/EXCEPTION 包装）
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_GRANT';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'TOOL_USAGE';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'SKILL_USAGE';
ALTER TYPE "CreditTransactionType" ADD VALUE IF NOT EXISTS 'TOPUP_PURCHASE';

-- 3. subscription_plans / user_subscriptions 表（CREATE TABLE IF NOT EXISTS + 索引，略）

-- 4. credit_accounts 扩展
ALTER TABLE "credit_accounts" ADD COLUMN IF NOT EXISTS "subscription_balance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "credit_accounts" ADD COLUMN IF NOT EXISTS "allowance_reset_at" TIMESTAMP(3);

-- 5. 数据回填：老用户挂 free 套餐
INSERT INTO "user_subscriptions" ("id","user_id","plan_code","status","current_period_start","current_period_end","created_at","updated_at")
SELECT gen_random_uuid()::text, u."id", 'free', 'ACTIVE', NOW(), NOW() + INTERVAL '1 month', NOW(), NOW()
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "user_subscriptions" s WHERE s."user_id" = u."id");
```

> `ALTER TYPE ADD VALUE` 不能在事务块内与使用该值的语句同批执行——迁移里它需单独提交（拆分 migration 或确保后续无同事务引用）。

---

## 11. 后端服务设计

### 11.1 `MeteringService`（新增，核心 chokepoint）

**路径**: `backend/src/modules/ai-harness/guardrails/billing/metering.service.ts`

```typescript
export type UsageKind = "llm" | "tool" | "skill";

export interface UsageEvent {
  userId: string;
  kind: UsageKind;
  capabilityId: string; // modelId | toolId | skillId
  apiKeySource: "PERSONAL" | "ASSIGNED" | "SYSTEM";
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  moduleType: string; // ai-ask / ai-teams / ...
  operationType: string;
  refId?: string; // 业务关联 id（幂等）
}

@Injectable()
export class MeteringService {
  async meter(e: UsageEvent): Promise<void> {
    // 1. 真实成本
    const realCostUsd =
      e.kind === "llm"
        ? this.pricing.estimateCost(
            e.capabilityId,
            e.inputTokens,
            e.outputTokens,
            e.cacheReadTokens,
            e.cacheWriteTokens,
          )
        : null;

    // 2. credit 成本（BYOK 仅豁免 LLM token）
    const credits = this.computeCredits(e, realCostUsd); // personal+llm → 0

    // 3. 扣 credit（幂等）
    if (credits > 0) {
      await this.credits.consumeCredits({
        userId: e.userId,
        amount: credits,
        type: this.txnType(e.kind),
        moduleType: e.moduleType,
        operationType: e.operationType,
        tokenCount: (e.inputTokens ?? 0) + (e.outputTokens ?? 0),
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        modelName: e.kind === "llm" ? e.capabilityId : undefined,
        idempotencyKey: e.refId ? `${e.kind}:${e.refId}` : undefined,
      });
    }

    // 4. 成本归因（无视 credit，记真实 USD）
    await this.costAttribution.recordCost({ ...e, estimatedCost: realCostUsd });

    // 5. 接通死代码：AIUsageLog
    if (e.kind !== "llm") {
      await this.capabilityResolver.logCapabilityUsage({
        capabilityType: e.kind,
        capabilityId: e.capabilityId,
        userId: e.userId,
        success: true,
        tokensUsed: e.inputTokens,
        modelUsed: e.capabilityId,
      });
    }
  }
}
```

### 11.2 `EntitlementService`（新增，前置闸门）

**路径**: `backend/src/modules/ai-harness/guardrails/billing/entitlement.service.ts`

```typescript
@Injectable()
export class EntitlementService {
  async check(
    userId: string,
    action: { feature: string; estimatedCredits?: number; isMission?: boolean },
  ): Promise<void> {
    const sub = await this.subscriptions.getActive(userId); // 缺省 free
    const plan = await this.plans.getByCode(sub.planCode);
    if (!plan.featureFlags[action.feature])
      throw new FeatureNotInPlanError(action.feature, plan.code);
    if (action.isMission)
      await this.concurrency.assertWithinLimit(userId, plan); // Redis 计数
    if (action.estimatedCredits)
      await this.credits.assertEnough(userId, action.estimatedCredits);
  }
}
```

### 11.3 改造点

| 文件                                                  | 改造                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ai-harness/facade` chat.facade `handleBilling()`     | 改为构造 `UsageEvent` → `MeteringService.meter()`，删除分散的扣费逻辑                  |
| `ai-harness/runner/tool-invoker/tool-invoker.ts`      | `invoke()` 成功后发 `UsageEvent`（kind=tool）                                          |
| `ai-harness` skill-runtime                            | skill 执行后发 `UsageEvent`（kind=skill）                                              |
| `ai-infra/credentials/key-resolver`                   | 重新启用计量版 SYSTEM 路径（**需 O1**）：普通用户无 personal/assigned → SYSTEM（计量） |
| `ai-infra/credits/credits.service.ts`                 | `consumeCredits` 扣费顺序：先 `subscriptionBalance` 后 `balance`                       |
| 新增 `SubscriptionService` + 月度重置 cron（`@Cron`） | 周期边界：过期上期 + 授予本期（幂等）                                                  |

---

## 12. 前端改造

- **用量展示语义**：从"credit 余额"改为"本月用量 X% / 含 N credits"，进度条。复用现有 `creditsStore`（`isLow`/`isCritical`），不拆。
- **不足时**：`useInsufficientCreditsModal` 区分两种 CTA——配额耗尽→升级；功能不在套餐→升级；可充值→pay-as-you-go。
- **BYOK 标签**：沿用 `apiKeySource` 展示（`Using Your Key` → 本次 LLM 不计费，但平台资源仍计）。在 BYOK 配置页加一句说明，避免"我以为全免费"的预期错位。
- **定价/套餐页**（新增）：`/pricing`、`/settings/subscription`。

---

## 13. 分阶段实施 Roadmap

| Wave   | 内容                                                                   | verify                                                                |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **W1** | 数据模型：plans/subscriptions 表 + CreditAccount/枚举扩展 + 回填迁移   | `npx prisma generate` 通过；迁移在影子库 `migrate deploy` 成功        |
| **W2** | `MeteringService` + `EntitlementService` 骨架 + 单测                   | 单测覆盖 personal/system/assigned × llm/tool/skill 计费矩阵全绿       |
| **W3** | LLM 路径收敛：`handleBilling` → `MeteringService`                      | 现有 LLM 计费回归测试全绿；BYOK personal 仍跳过 LLM credit            |
| **W4** | **Tools/Skills 接线**（接通 `logCapabilityUsage` + CreditRule）        | web-search/image-gen 调用后 `AIUsageLog` + `CreditTransaction` 各一条 |
| **W5** | SYSTEM 计量路径重启（**需 O1 批准后**）+ 扣费顺序                      | 无 key 的 free 用户能用平台 key 且正确扣 subscriptionBalance          |
| **W6** | 月度重置 cron + 套餐 entitlement（feature flag / 并发 / 每日 mission） | 跨周期：上期过期 + 本期授予幂等；超并发被拦                           |
| **W7** | 前端：套餐页 / 用量语义 / 升级 CTA                                     | 浏览器实测三种 tier 的用量展示与拦截                                  |
| **W8** | 支付网关接入（**O4 选型后**）                                          | 沙箱支付 → webhook → `user_subscriptions` 状态流转                    |

> W1–W4 不依赖任何开放问题，可立即开工；W5 起需 O1/O2/O4 拍板。

---

## 14. 验收标准

- [ ] **计费矩阵正确**：`apiKeySource` × `kind`（3×3）全部按 §6 矩阵计费，单测覆盖
- [ ] **BYOK 半免费**：personal key LLM token 不扣 credit，但同一会话里的 web-search 扣 credit
- [ ] **死代码接通**：tool/skill 执行后 `AIUsageLog` 必有一条（之前是 0 条）
- [ ] **三账可对账**：`CreditTransaction` 扣减 ↔ `AIEngineMetric.estimatedCost` ↔ `AIUsageLog` 三者按 refId 可关联
- [ ] **月度重置幂等**：cron 重复触发同周期不重复授予（idempotencyKey）
- [ ] **entitlement 拦截**：Free 用户超并发/越权功能被拦，CTA 正确
- [ ] **不回归**：现有 LLM 计费、BYOK key 解析、prompt cache 命中率不受影响
- [ ] **uncostled 告警**：无 pricing 的模型 / 无 rule 的工具不静默当 0，打 WARN

---

## 15. 风险登记册

| 风险                                    | 影响         | 缓解                                                   |
| --------------------------------------- | ------------ | ------------------------------------------------------ |
| 重启 SYSTEM 路径与 strict-BYOK 决策冲突 | 方向性返工   | **O1 必须先拍板**；计量版 SYSTEM ≠ 免费 SYSTEM         |
| Free + BYOK 白嫖编排算力                | 成本失控     | entitlement 并发/每日 mission 硬上限 + 平台资源 credit |
| credit 锚定切换破坏现有计费             | 计费错乱     | 过渡期 LLM 锚定、固定项 baseCredits 并存；灰度         |
| 三条计量路收敛引入回归                  | LLM 计费中断 | W3 先只迁 LLM 并跑全量回归，再接 tool/skill            |
| `ALTER TYPE ADD VALUE` 在事务内失败     | 迁移挂       | 枚举追加单独提交，不与引用语句同事务（项目已知坑）     |
| 支付/退款/发票合规                      | 法务风险     | 支付网关选型（O4）连带评估合规，本设计不含此范围       |

---

## 16. 开放问题清单（待 Owner 拍板）

| #      | 问题                                                                  | 我的建议                                                                                                                           |
| ------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| O1     | **是否重启"计量版 SYSTEM key"路径**（让无 BYOK 用户也能用平台 key）？ | **建议启用**——否则 Free tier 不绑 key 就完全用不了，违背"开箱即用"。这是订阅制的核心变现路径，与 strict-BYOK（不免费垫钱）不冲突。 |
| O2     | 四个 tier 的**具体价格 / 月度 credit / 并发 / 每日 mission** 数字     | 建议先按占位上线，灰度后用 `AIEngineMetric` 真实成本数据回算                                                                       |
| O3     | 月度 credit **是否滚存**？                                            | 建议不滚存（或仅滚存一个周期），简单且促活                                                                                         |
| O4     | **支付网关**选型（Stripe / 其他 / 自建）                              | 建议 Stripe（订阅+webhook 成熟），但需评估地区/合规                                                                                |
| O5     | UI 是否对用户**暴露 USD**，还是只显示抽象 credit / 用量百分比         | 建议只显示用量百分比 + credit，内部锚定 USD 不外露                                                                                 |
| O6     | Free tier 平台资源（搜索/绘图）**硬上限**具体值                       | 建议先给极小额度试用，重度引导升级                                                                                                 |
| ~~O7~~ | **On-Prem 变现/授权模型**                                             | ✅ **已定（2026-05-28）：per-instance 固定年费**。按部署实例收固定年费，**不限席位**，feature flag 分版本，与 cloud tier 解耦      |
| ~~O8~~ | **On-Prem 是否保留 credit**                                           | ✅ **已定（2026-05-28）：保留但默认关闭**。credit 账本/计量在，默认不扣；org admin 可开，做部门预算/内部 chargeback                |
| O9     | **License 机制**：签名离线文件 / 在线激活 / 离线宽限期？              | 建议签名离线文件（JWT，厂商私钥签、公钥内置 build）+ 实例绑定 + 到期宽限期                                                         |

---

## 17. 部署模式区分：Cloud SaaS vs On-Prem

### 17.1 为什么必须区分

| 维度              | Cloud（SaaS）                   | On-Prem（本地/私有部署）             |
| ----------------- | ------------------------------- | ------------------------------------ |
| 租户              | 多租户（厂商托管）              | 单租户（客户自持整套栈）             |
| infra + Key 归属  | 厂商（GenesisPod）              | 客户自己                             |
| 谁付 LLM 账单     | 厂商垫付，向终端用户收          | 客户直付 Provider                    |
| **厂商收什么钱**  | 订阅 + credit（按量）           | **License（合同制），不按量**        |
| credit 当真实货币 | ✅ 是变现本身                   | ❌ **无意义**（厂商不按 token 结算） |
| `SYSTEM` key 含义 | 厂商平台 key（转售、计量）      | 客户自己配置的 org key（自付）       |
| BYOK              | opt-in 省钱选项                 | 基本是常态                           |
| entitlement 来源  | SaaS 套餐（`SubscriptionPlan`） | **License 文件**                     |
| 支付网关          | ON（Stripe 等）                 | OFF                                  |

> **现状**：backend 代码与 `app.config.ts` **没有任何 edition / 部署模式开关**（已 grep 确认，app.config 只管品牌与 URL）。本设计需新引入。已有 On-Prem 发布栈见 memory `project_onprem_ghcr_org_namespace_2026_05_13`（ghcr/genesis-release + 一键 upgrade + SeedSyncService 首装数据）。

### 17.2 核心洞察：计量共享，结算分流

统一计量 chokepoint（§4）**两种 edition 都开**——成本可观测性对 On-Prem 客户同样有价值（看自己花费、内部部门 chargeback）。差异只在**结算层**：

- **Cloud**：结算到真实钱（订阅 + credit 计费 + 支付网关）
- **On-Prem**：只记录 + 可选内部预算管控，**不与厂商发生金钱结算**

所以**不分叉两套系统**，而是一个开关切换"结算能力"的开/关。

### 17.3 EDITION 单一开关 + MonetizationProfile

```typescript
// app.config.ts 新增
edition: ((process.env.GENESIS_EDITION ?? "cloud") as "cloud" | "onprem",
  // 新增 EditionService（ai-infra 或 common/config）
  @Injectable()
  export class EditionService {
    isCloud(): boolean {
      return APP_CONFIG.edition === "cloud";
    }
    isOnPrem(): boolean {
      return APP_CONFIG.edition === "onprem";
    }
    get profile(): MonetizationProfile {
      return PROFILES[APP_CONFIG.edition];
    }
  });

// MonetizationProfile：一个配置对象，不是插件框架（遵守反过度抽象红线）
interface MonetizationProfile {
  paymentEnabled: boolean; // 支付网关
  subscriptionEnabled: boolean; // 订阅 tier
  creditBillingMode: "money" | "internal" | "off"; // credit 语义
  entitlementSource: "subscription" | "license";
  systemKeyMeaning: "vendor-platform" | "customer-org";
  byokRole: "opt-in" | "default";
}
```

### 17.4 能力矩阵（按 edition）

| 能力                                   | Cloud      | On-Prem                                     |
| -------------------------------------- | ---------- | ------------------------------------------- |
| 统一计量 chokepoint（MeteringService） | ON         | ON                                          |
| cost-attribution / AIUsageLog          | ON         | ON（客户自己看花费）                        |
| credit 账本（CreditTransaction）       | ON（真钱） | 可选（内部 chargeback）                     |
| credit 扣减强制                        | 强制       | 默认关闭，org 可开                          |
| 订阅 + 月度配额重置                    | ON         | OFF                                         |
| 支付网关（Stripe）                     | ON         | OFF                                         |
| License 校验                           | OFF        | ON                                          |
| entitlement（feature/并发）            | 套餐驱动   | License 驱动（per-instance，**不卡 seat**） |
| credit 内部 chargeback                 | N/A        | 保留但**默认关闭**，org admin 可开          |
| BYOK 跳过 LLM credit                   | ON         | N/A（本来就不计真钱）                       |

### 17.5 On-Prem 的 entitlement：License 取代 Subscription（per-instance）

**已定 per-instance 固定年费**：license 按部署实例授权，**不限席位**，只卡版本（feature flag）和到期。

```typescript
// 新增 LicenseService（仅 onprem 装载）
@Injectable()
export class LicenseService {
  // 验证签名 license 文件：厂商私钥签发，公钥内置于 build
  // payload: { edition, customerId, instanceId, edition级别(featureFlags), issuedAt, expiresAt }
  // 注意：per-instance 模型 → 无 seatLimit；可选 instanceId 绑定防一证多部署
  verify(): LicensePayload;
  getEntitlements(): {
    features: Record<string, boolean>;
    expiresAt: Date;
    instanceId?: string;
  };
}
```

`EntitlementService`（§11.2）的来源**可插拔**：`isCloud → SubscriptionPlan`；`isOnPrem → LicenseService`。检查逻辑两端复用，但 **On-Prem 不做 seat 上限校验**（per-instance），只校验 feature flag、到期、可选实例绑定。

> **credit 内部 chargeback（O8 已定：默认关闭）**：On-Prem 的 `MonetizationProfile.creditBillingMode = "off"` 为默认；org admin 可切到 `"internal"` 开启部门预算/chargeback。切到 `"internal"` 时，credit 由 org admin 手动分配（无厂商月度授予），扣减只用于内部成本可视化与限额，**永不与厂商结算**。

### 17.6 模块装载（按 edition 条件加载）

```typescript
// app.module.ts / monetization.module.ts
imports: [
  MeteringModule, // 两端共用
  ...(edition === "cloud" ? [SubscriptionModule, PaymentModule] : []),
  ...(edition === "onprem" ? [LicenseModule] : []),
];
```

### 17.7 对 §10 schema / §13 roadmap 的影响

- `subscription_plans` / `user_subscriptions`：**Cloud 专用**，On-Prem 不建表/不用（或建而不启用）。
- 新增 `licenses` 表（On-Prem，per-instance）：customerId / instanceId / featureFlags / issuedAt / expiresAt / signature（**无 seatLimit**）。
- `CreditAccount.subscriptionBalance` 等：Cloud 走订阅重置；On-Prem 若开内部预算，则由 org admin 手动设额度（无月度厂商授予）。
- **Roadmap 调整**：W1–W4（计量基建：MeteringService / 接线 tools-skills / cost-attribution）**edition 无关，两端都要**，优先做。W6 entitlement 在此分叉（cloud=subscription / onprem=license）。W8 支付**仅 Cloud**；新增 **W9 License 机制（仅 On-Prem）**。

### 17.8 设计准则

1. **edition 判断收敛在 `EditionService`/`MonetizationProfile`**，业务代码读 profile 字段，不到处散 `if (env.EDITION)`。
2. **计量逻辑零分叉**：MeteringService 永远记录；是否扣真钱由 `creditBillingMode` 决定。
3. **On-Prem 不得回连厂商**做计费/校验（除非客户显式开启 license 在线激活）——隐私与合规底线。

---

**最后更新**: 2026-05-28
**维护者**: Claude Code
**版本**: v1.1（待评审；v1.1 增补部署模式区分 §17）
