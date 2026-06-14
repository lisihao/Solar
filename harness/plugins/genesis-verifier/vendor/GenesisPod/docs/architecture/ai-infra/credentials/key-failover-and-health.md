# Key Failover & Health 系统设计

> 统一所有 Key 类型（PERSONAL / ASSIGNED / SYSTEM / 工具 Key）的失效检测、健康追踪、自动切换、粘性优先调度。
>
> **2026-05-05** 立项 · 替代 `resilience/circuit-breaker.ts` 的 provider-级熔断（错误粒度）。

---

## 1. 问题定义

当前 BYOK / Key 使用链路存在 4 个粒度错误：

| 问题     | 现状                                                                     | 后果                                                           |
| -------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 熔断粒度 | provider 级（`auth-circuit-breaker`）                                    | key A 401 → 整个 provider 锁 5 分钟 → key B 也被冷却           |
| 选择策略 | `findFirst` 返回 1 个 key                                                | 同一 user/provider 的多 key 永远只用同一把                     |
| 失效切换 | 无                                                                       | key 401/429 直接抛错给业务，前端只看到失败                     |
| 粘性记忆 | 无                                                                       | 每次都从 `label="default"` 起步选；高 latency 用户每次都被命中 |
| 工具 key | 散落在 embedding/rerank/openalex/semantic-scholar 各自的 circuit-breaker | 无统一健康面板，admin 无法一眼看哪些 key 死了                  |

**目标**：以 **key 为最小粒度** 的健康追踪 + 自动 failover，覆盖 chat / embedding / rerank / 各工具 key 全部使用场景。

---

## 2. 总体架构（4 层）

```
┌─ Layer 4: KeyExecutor (统一调用入口) ──────────────────┐
│   execute<T>(userId, provider, callFn): Promise<T>    │
│   for key in chain: try callFn(key)                   │
│     on err → classify → markFailure → next            │
│     on success → markSuccess → setLastGood → return   │
└────────────────────────────────────────────────────────┘
                       │ uses
                       v
┌─ Layer 3: KeyChain (有序 iterator) ───────────────────┐
│   next(): ResolvedKey | null                          │
│   reportFailure(key, classified)                      │
│   reportSuccess(key)                                  │
└────────────────────────────────────────────────────────┘
                       │ produced by
                       v
┌─ Layer 2: KeyResolver.resolveKeyChain ────────────────┐
│   1. PERSONAL[] = userApiKeys.listPersonalKeys()      │
│   2. ASSIGNED[] = keyAssignments.listActive()         │
│   3. healthStore.filterUsable(allKeyIds)              │
│   4. LastGood 提到队首                                │
│   → KeyChain                                          │
└────────────────────────────────────────────────────────┘
                       │ uses
                       v
┌─ Layer 1: KeyHealthStore (Redis-backed) ──────────────┐
│   keyId → { state, cooldownUntil, failureCount, ... } │
│   + LastGood 索引: (userId, provider) → keyId         │
└────────────────────────────────────────────────────────┘
                       │ classified by
                       v
┌─ Layer 0: KeyErrorClassifier ─────────────────────────┐
│   classify(err): {                                    │
│     action: NEXT_KEY | STOP_CHAIN | RETHROW           │
│     cooldownMs: number                                │
│     markDead: boolean                                 │
│     reason: AUTH_FAILED | RATE_LIMIT | QUOTA | ...    │
│   }                                                   │
└────────────────────────────────────────────────────────┘
```

---

## 3. KeyId 统一标识

所有 key 类型映射成同一种字符串标识，KeyHealthStore 单 namespace 管理：

```typescript
type KeyId =
  | `personal:${userId}:${provider}:${label}` // UserApiKey
  | `assigned:${assignmentId}` // KeyAssignment（绑定 DistributableKey）
  | `system:${secretName}`; // ai-model-config secrets（cron / health check）
```

工具 Key（embedding/rerank/voyage/cohere）目前走同一张 `UserApiKey`，由 `provider` 字段区分（voyage / cohere）。**因此自然纳入同一统一管理**——无需新表。

---

## 4. 错误分类表

`KeyErrorClassifier.classify(err)` 根据 HTTP status / message / error-name 做分类决策：

| Error 类型                             | action   | cooldownMs           | markDead                        | shouldStopChain        | 备注                               |
| -------------------------------------- | -------- | -------------------- | ------------------------------- | ---------------------- | ---------------------------------- |
| **401 Unauthorized**                   | NEXT_KEY | ∞ (永久 DEAD)        | ✅ `isActive=false`             | ❌                     | key 失效，标 dead 等用户 re-test   |
| **403 Forbidden / Permission**         | NEXT_KEY | ∞                    | ✅                              | ❌                     | 同 401                             |
| **429 RateLimit (key-specific)**       | NEXT_KEY | 60 s                 | ❌                              | ❌                     | key 限流，临时 cooldown            |
| **429 RateLimit (account-wide)**       | NEXT_KEY | 5 min                | ❌                              | ✅（>=2 key 同时 429） | provider 整体限流，链路终止        |
| **402 Payment / Insufficient Quota**   | NEXT_KEY | ∞                    | ❌（不 dead，账单恢复后还能用） | ❌                     | 切下一把                           |
| **5xx Server Error**                   | RETHROW  | 5 min（provider 级） | ❌                              | ✅                     | provider 故障，所有 key 都没意义   |
| **Connection refused / ECONNRESET**    | RETHROW  | 5 min                | ❌                              | ✅                     | 网络故障                           |
| **ETIMEDOUT / Timeout**                | NEXT_KEY | 30 s                 | ❌                              | ❌                     | 可能 region 问题，下一把试         |
| **QuotaExceededError (ASSIGNED 池级)** | NEXT_KEY | ∞ until reset        | ❌                              | ❌                     | 用户级配额耗尽                     |
| **Unknown / 其他**                     | RETHROW  | 0                    | ❌                              | ✅                     | 不熟悉的错误不试错，避免 cascading |

**Account-wide 429 启发式**：连续 2 个不同 key 在 30 s 内都返 429 → 升级为 provider-级 cooldown 5 min（写入 Redis `keyhealth:provider:cooldown:{provider}`），KeyExecutor 一开始就检查这个 flag。

---

## 5. KeyHealthStore（Redis schema）

```
# 单 key 健康
keyhealth:{keyId}                      → JSON {state, cooldownUntil, failureCount, lastFailureAt, lastReason}
  TTL: 永久（DEAD 由用户 re-test 清；COOLDOWN 用 cooldownUntil 自然过期不删 key 本身）

# LastGood 粘性
keyhealth:lastgood:{userId}:{provider} → keyId（string）
  TTL: 7 days

# Provider-级 cooldown（account-wide 429 / 5xx / ECONNRESET）
keyhealth:provider:cooldown:{provider} → "1"
  TTL: 5 min
```

### State 机

```
HEALTHY
  │ markFailure(401/403)         → DEAD     [永久]
  │ markFailure(429-key)          → COOLDOWN [60s]
  │ markFailure(timeout)          → COOLDOWN [30s]
  │ markFailure(quota-personal)   → COOLDOWN [∞ until reset]
  │ markSuccess                   → HEALTHY  [reset failureCount]
  v

DEAD ── 仅由 user 在 BYOK UI 点 "Test Connection" 成功后 → markSuccess → HEALTHY

COOLDOWN ── cooldownUntil < now() 自动 → HEALTHY（filterUsable 时判定）
```

### filterUsable 算法

```typescript
async filterUsable(keyIds: string[]): Promise<string[]> {
  const now = Date.now();
  const records = await redis.mget(keyIds.map(id => `keyhealth:${id}`));
  return keyIds.filter((id, i) => {
    const rec = records[i];
    if (!rec) return true;                                 // 没记录 = HEALTHY
    const { state, cooldownUntil } = JSON.parse(rec);
    if (state === "DEAD") return false;
    if (state === "COOLDOWN" && cooldownUntil > now) return false;
    return true;
  });
}
```

---

## 6. LastGood 粘性

**写入触发**：`markSuccess(keyId)` 自动解析 keyId → `setLastGood(userId, provider, keyId)`。

**读取**：`resolveKeyChain` 排序时把 LastGood 移到队首：

```typescript
const lastGoodId = await healthStore.getLastGood(userId, provider);
if (lastGoodId) {
  const idx = candidates.findIndex((k) => k.keyId === lastGoodId);
  if (idx > 0) {
    const [hit] = candidates.splice(idx, 1);
    candidates.unshift(hit);
  }
}
```

**清除触发**（避免引用已删 key）：

| 事件                                            | 动作                                          |
| ----------------------------------------------- | --------------------------------------------- |
| `userApiKeys.deleteKey()`                       | `clearLastGood(userId, provider)`             |
| `userApiKeys.saveKey()`（rotate / endpoint 改） | `clearLastGood(userId, provider)`（强制重算） |
| `keyAssignments.revoke()`                       | `clearLastGood(userId, provider)`             |
| `markFailure → DEAD` 时该 key 是 LastGood       | `clearLastGood`                               |

---

## 7. KeyExecutor（统一调用入口）

```typescript
@Injectable()
export class KeyExecutor {
  constructor(
    private readonly resolver: KeyResolverService,
    private readonly classifier: KeyErrorClassifier,
    private readonly healthStore: KeyHealthStore,
  ) {}

  async execute<T>(
    userId: string,
    provider: string,
    callFn: (key: ResolvedKey) => Promise<T>,
  ): Promise<T> {
    // Provider-level cooldown short-circuit
    if (await this.healthStore.isProviderCooldown(provider)) {
      throw new ProviderCooldownError(provider);
    }

    const chain = await this.resolver.resolveKeyChain(userId, provider);
    let lastError: ClassifiedError | null = null;
    let triedCount = 0;

    while (true) {
      const key = await chain.next();
      if (!key) break;
      triedCount++;

      try {
        const result = await callFn(key);
        await chain.reportSuccess(key);
        return result;
      } catch (err) {
        const classified = this.classifier.classify(err);
        await chain.reportFailure(key, classified);
        lastError = classified;

        if (classified.shouldStopChain) {
          await this.healthStore.setProviderCooldown(
            provider,
            classified.cooldownMs,
          );
          break;
        }
      }
    }

    if (triedCount === 0) throw new NoAvailableKeyError(provider);
    throw new AllKeysFailedError(provider, lastError);
  }
}
```

---

## 8. 接入点（W2 PR）

`grep` 全 `keyResolver.resolveKey(`：

| 文件                                                   | 类型            | 改造                            |
| ------------------------------------------------------ | --------------- | ------------------------------- |
| `ai-engine/llm/services/ai-chat.service.ts`            | chat            | wrap with `keyExecutor.execute` |
| `ai-engine/rag/services/embedding.service.ts`          | embed           | 同上                            |
| `ai-engine/rag/services/rerank.service.ts`             | rerank          | 同上                            |
| `ai-engine/llm/services/ai-model-discovery.service.ts` | model list 探测 | 同上                            |
| 各 provider client factory（如有直调）                 | mixed           | 同上                            |

模板：

```typescript
// before
const key = await this.keyResolver.resolveKey(userId, provider);
return await client(key).chat(req);

// after
return await this.keyExecutor.execute(userId, provider, (key) =>
  client(key).chat(req),
);
```

---

## 9. PR 分波

| PR               | 内容                                                                                           | 风险                                | 依赖      |
| ---------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- | --------- |
| **PR-1**（本次） | KeyErrorClassifier + KeyHealthStore + LastGood + 单测                                          | 0（纯新增）                         | -         |
| **PR-2**（本次） | KeyResolver.resolveKeyChain + listPersonalKeys + listActive                                    | 低（保留旧 resolveKey 兼容）        | PR-1      |
| **PR-3**（本次） | KeyExecutor + AllKeysFailedError + ProviderCooldownError                                       | 低（纯新增 service）                | PR-2      |
| PR-4             | ai-chat.service 接入（feature flag `BYOK_FAILOVER_ENABLED`）                                   | **高**（14-stage mission 全压在上） | PR-3      |
| PR-5             | embedding / rerank / model-discovery 接入                                                      | 中                                  | PR-4      |
| PR-6             | Schema 加 `healthState` 列 + admin/user UI                                                     | 低（手写 migration）                | PR-5      |
| PR-7             | 删旧 `auth-circuit-breaker` 散点（embedding/SemanticScholar/OpenAlex/Policy）                  | 低（区分 key 相关 vs host 相关）    | PR-5      |
| PR-8             | KeyAssignment 多 key 支持（去掉 `@@unique([userId, provider])` → `(userId, provider, label)`） | 中（schema 改 + admin UI）          | PR-3 独立 |
| PR-9             | Tool key（embedding/rerank）UI 端 BYOK 入口（voyage / cohere 单独配）                          | 中                                  | PR-6      |

**本次（W21）落地：PR-1 + PR-2 + PR-3 + 单测，不接入业务调用层（feature flag 默认关）。**

---

## 9b. 全面覆盖矩阵

### Key 类型 × 失效切换 × LastGood

| Key 类型                                               | 多 key？                                                                 | failover 策略                             | LastGood 粘性                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------- |
| **PERSONAL** (UserApiKey)                              | ✅ `(userId, provider, label)` 多条                                      | 同 provider 内 label asc → LastGood 优先  | ✅ 写入 + 读取                                        |
| **ASSIGNED** (KeyAssignment)                           | ⚠️ 当前 `(userId, provider)` 唯一，PR-8 改成多 label                     | PR-8 前：单 key；PR-8 后：同 PERSONAL     | ✅ 写入 + 读取                                        |
| **SYSTEM** (Secret Manager)                            | ✅ 多 secretName 可注册（如 `OPENAI_API_KEY` + `OPENAI_API_KEY_BACKUP`） | secretName asc                            | ✅ Redis key: `keyhealth:lastgood:system:${provider}` |
| **DONATED** (UserApiKey mode=DONATED)                  | ✅ 同 PERSONAL（共表）                                                   | 不进入用户调用链路（只供他人用）          | N/A                                                   |
| **TOOL** (voyage/cohere/etc 走 UserApiKey by provider) | ✅ 同 PERSONAL                                                           | 同 PERSONAL，按 useCase=embed/rerank 路由 | ✅（按 provider；后续可加 useCase 维度）              |

### 消费方 × 接入

| 消费方                              | 文件                                                   | 当前 key 来源                          | 接入 PR           |
| ----------------------------------- | ------------------------------------------------------ | -------------------------------------- | ----------------- |
| **chat (LLM)**                      | `ai-engine/llm/services/ai-chat.service.ts`            | KeyResolver.resolveKey                 | PR-4              |
| **embedding**                       | `ai-engine/rag/services/embedding.service.ts`          | KeyResolver.resolveKey                 | PR-5              |
| **rerank**                          | `ai-engine/rag/services/rerank.service.ts`             | KeyResolver.resolveKey                 | PR-5              |
| **model discovery**                 | `ai-engine/llm/services/ai-model-discovery.service.ts` | KeyResolver.resolveKey + secrets fetch | PR-5              |
| **provider client factory**（直调） | `ai-engine/llm/clients/*`                              | 自取                                   | PR-5              |
| **OpenAlex search tool**            | `ai-engine/tools/.../openalex-search.tool.ts`          | secrets（host 级，不带 user）          | PR-7 保留 host CB |
| **SemanticScholar tool**            | `ai-engine/tools/.../semantic-scholar-search.tool.ts`  | 同上                                   | PR-7 保留 host CB |
| **PolicyData tool**                 | `ai-engine/tools/.../policy-data.service.ts`           | host 级                                | PR-7 保留 host CB |
| **YouTube transcript tool**         | `ai-engine/content/.../youtube-transcript.tool.ts`     | secrets                                | PR-7 收敛         |

### 生命周期事件 × 自动响应

| 事件                                               | KeyHealthStore 响应                         | LastGood 响应                                   |
| -------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| user `saveKey()` 新 key                            | 无（HEALTHY 由首次成功调用 trigger）        | `clearLastGood(userId, provider)`（强制重新选） |
| user `deleteKey()`                                 | `del keyhealth:{keyId}`                     | `clearLastGood(userId, provider)`               |
| user `toggleActive(false)`                         | 状态保留（重新启用后回 HEALTHY）            | `clearLastGood`（如该 key 是 LastGood）         |
| user `testConnection()` 成功                       | `markSuccess` 把 DEAD → HEALTHY             | `setLastGood`                                   |
| user `testConnection()` 失败                       | `markFailure(401)` → DEAD                   | 如该 key 是 LastGood → `clearLastGood`          |
| admin `revokeAssignment()`                         | `del keyhealth:assigned:{id}`               | `clearLastGood`（如该 assignment 是 LastGood）  |
| admin `assign()` 新分配                            | 无                                          | `clearLastGood`（重选）                         |
| `byok-maintenance.scheduler` 检测到 expiresAt 临近 | 不动健康，仅通知                            | 不动                                            |
| `byok-maintenance.scheduler` 检测到已过期          | `markFailure(QUOTA_EXCEEDED)` 进 COOLDOWN ∞ | clearLastGood if 是 LastGood                    |

### Admin / User UI（PR-6）

**用户 BYOK 页**（每行 key 显示）：

- 健康徽章：`HEALTHY`（绿）/ `COOLDOWN until 14:32`（黄）/ `DEAD: auth_failed`（红）
- 末次失败原因：`401 Unauthorized` / `429 Rate Limit` / `Quota exceeded`
- 末次成功时间：`2 min ago`
- 操作：`Test Connection`（成功 → markSuccess + clear DEAD）、`Edit`、`Delete`

**Admin 后台 KeyAssignment 列表**（每行）：

- 同上健康徽章
- 用户列：哪个用户在用
- 池剩余配额
- 操作：`Force Mark Healthy`（admin override）、`Revoke`

**通知触发**：

- key 进入 DEAD（401）→ `in-app notification` 给 user：`"Your {provider} key '{label}' became invalid. Please update it in Settings → API Keys."`
- key 进入 COOLDOWN（429）→ 不通知（噪音太大）
- 全 key 都 DEAD（用户 + assigned 全失效）→ in-app + email：`"You have no working API keys for {provider}. Please configure one to resume AI features."`

### 监控告警（PR-6+）

```
metric                                                trigger
keyhealth.failover_triggered_count               > 50 / hour     # 切换太频繁，可能是 provider 故障
keyhealth.all_keys_failed_count{provider}        > 10 / hour     # 多用户全 key 死，可能是 provider 大事故
keyhealth.dead_count_diff{provider}              > +20 / day     # 一天 +20 个 DEAD，可能是 provider 主动 revoke
keyhealth.lastgood_hit_rate                      < 50%           # 命中率低，链路一直在切换
keyhealth.provider_cooldown_count{provider}      > 5 / hour      # provider 级 cooldown 频繁，疑似事故
```

---

## 10. 决策记录

| #   | 决策                             | 选择                                                     | 原因                                                                                   |
| --- | -------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Cross-provider failover？        | **NO**（仅 provider 内）                                 | model 不同、tokenizer 不同、cost 不同；跨 provider 切换违反用户预期                    |
| 2   | DEAD key 自动复活？              | **永久**，仅 user 手动 re-test 复活                      | 401 几乎都是 key 真失效，自动重试空耗 quota + 误导用户                                 |
| 3   | SYSTEM key 是否纳入？            | **YES**                                                  | strict BYOK 后 SYSTEM 仅 cron / health check 用，但同样会过期失效，统一 key 视图更一致 |
| 4   | PR-4 是否 feature flag？         | **YES**（默认关）                                        | ai-chat.service 是 14-stage mission 主路径，灰度 + 回滚保险                            |
| 5   | LastGood TTL？                   | 7 天                                                     | 短于 7 天容易丢失粘性；长于 7 天用户 key rotation 后会引用废 key                       |
| 6   | 持久层？                         | Redis-only（PR-1）+ 后续 schema 镜像（PR-6）             | LastGood / cooldown 是性能优化，Redis 丢了可重建；admin 看板需要 DB 镜像               |
| 7   | Account-wide vs Key-specific 429 | 启发式：30s 窗口内 ≥2 key 同 provider 429 → account-wide | provider 通常不告诉你哪种，只能观测                                                    |
| 8   | 错误分类的 provider-aware？      | **NO**（PR-1）/ 后续可加 provider-specific overrides     | 先做通用层，遇到 provider quirk 再加白名单                                             |

---

## 11. 测试清单（PR-1~PR-3）

### KeyErrorClassifier

- 401 → NEXT_KEY + markDead=true + cooldown=∞
- 403 → 同 401
- 429 with `Retry-After` header → cooldown=Retry-After
- 429 无 Retry-After → cooldown=60s
- 5xx → RETHROW + shouldStopChain=true + cooldown=300s
- ECONNRESET → 同 5xx
- ETIMEDOUT → NEXT_KEY + cooldown=30s
- QuotaExceededError → NEXT_KEY + cooldown=∞ + markDead=false
- Unknown error → RETHROW

### KeyHealthStore

- markFailure(401) → state=DEAD
- markFailure(429) → state=COOLDOWN cooldownUntil=now+60s
- markSuccess → state=HEALTHY + setLastGood
- filterUsable: DEAD 过滤、COOLDOWN 过期前过滤 / 过期后通过、HEALTHY 通过
- getLastGood / setLastGood / clearLastGood：TTL 7d
- isProviderCooldown / setProviderCooldown：TTL 5min
- Account-wide 429 启发式：>=2 key 30s 内 429 → setProviderCooldown 触发

### resolveKeyChain

- 单 PERSONAL key → chain 长度 1
- PERSONAL + ASSIGNED 都有 → 顺序 PERSONAL 先（按 label="default" 优先）
- LastGood 命中 → 排到 chain 队首
- LastGood 已 DEAD → filterUsable 过滤掉，按默认顺序
- 全部 key 都 DEAD → chain 空，next() 返 null
- 用户没任何 key → chain 空 → KeyExecutor 抛 NoAvailableKeyError

### KeyExecutor

- 单 key 成功 → callFn 调一次 + markSuccess
- 单 key 401 失败 → markDead + 无 next → AllKeysFailedError
- 双 key：第一 401，第二成功 → callFn 调两次 + LastGood 写第二把
- 双 key 都失败 → AllKeysFailedError，error.lastError = 第二把的 classified
- 5xx → 一把就 break + setProviderCooldown
- Provider cooldown 期内调用 → 直接抛 ProviderCooldownError，callFn 不调

---

## 12. 监控指标（后续 PR）

```
keyhealth.failure_count{provider, key_id, reason}
keyhealth.cooldown_count{provider, key_id}
keyhealth.dead_count{provider, key_id}
keyhealth.failover_triggered_count{provider}        # chain 被迫切下一把的次数
keyhealth.lastgood_hit_count{provider}              # LastGood 命中（首把就成）
keyhealth.lastgood_miss_count{provider}             # LastGood 失效或不存在
keyhealth.all_keys_failed_count{provider}           # 全部 key 都失败
keyhealth.provider_cooldown_count{provider}         # provider 级 cooldown 触发
```

---

## 13. 与现有 `resilience/circuit-breaker.ts` 的关系

- `resilience/circuit-breaker.ts` 是**通用**断路器抽象（per-instance, in-memory）。
- 本系统是**Key-specific** 健康追踪（per-key, Redis）。
- **职责切分**：
  - **provider-级故障**（5xx / connection refused）→ 用 KeyHealthStore 的 `keyhealth:provider:cooldown:` flag（替代旧 per-provider auth-circuit-breaker）
  - **key-级故障**（401/429/quota）→ KeyHealthStore 的 `keyhealth:{keyId}` 记录
  - **非 key 相关的工具**（如 SemanticScholarSearchTool 的 host 限流）→ 继续用 `resilience/circuit-breaker.ts` 不变

---

## 14. 历史与决策时间线

- 2026-05-05 立项；BYOK 严格模式删除 ADMIN SYSTEM fallback 后，多 key failover 需求显化。
- 旧 `auth-circuit-breaker` 4 处散点实现（embedding 401/429、SemanticScholar、OpenAlex、PolicyData）将在 PR-7 收敛或保留（区分 key-related vs host-related）。
