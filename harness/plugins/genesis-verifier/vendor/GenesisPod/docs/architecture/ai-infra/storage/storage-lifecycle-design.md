# 统一存储生命周期管理架构设计 v1.4

> GenesisPod 平台所有持久化数据的统一生命周期管理（HOT / WARM / COLD 三态 + DELETED 终态），沉淀到 `platform/storage` 基础层（L1）；业务模块只消费门面，不关心介质和迁移（WARM 起；HOT→WARM 由业务事件触发）。

**状态**: Draft v1.4（v1.3 第 3 轮 4 路评审 3/4 NEEDS-CHANGES + 1/4 APPROVED-WITH-COMMENTS 后穿透修订；本轮重点修复 v1.3 引入的事实错误与 tombstone tier 自洽 bug）  
**作者**: Claude Code  
**日期**: 2026-05-11  
**对应代码**: `backend/src/modules/platform/storage/`（待 PR-S 系列实施）  
**当前现状**:

- R2 field-offload **12 个 target**（`storage-offload.registry.ts:40`），**R2 prefix 实际 8 个**（`mission-records/` 共享 5 个 mission target）
- **11 个 target 用 `$executeRawUnsafe`**（v1.4 实测；唯一例外 `topic_reports.full_report` 用 Prisma 模型 API）—— 同构 SQL 可抽 helper 一次性改造
- `agent_playground_mission_events` 99 MB / 90,689 行 行级数据未纳入治理
- `common/audit/audit.service.ts` 纯内存版（`auditLogs:147` + `maxLogs=1000`）；`AuditAction` enum **24 个**值；类内 convenience methods **9 个**；**外部 caller 仅 3 个 service**（admin / ai-teams / ai-response）共 **8 处生产调用点**
- `AUDIT_KEY` 装饰器 metadata 当前**无任何 interceptor 读取**（`@Audit` 装饰器贴标签但无消费者）—— PR-A0a 必须**新建** interceptor
- `storage_objects` / `storage_lifecycle_policies` 表在 Prisma schema **完全不存在**（整表新建，无 alter enum 风险）
- secrets 模块实际文件：`secrets.service.ts` + `secret-keys.service.ts` + `secret-name.catalog.ts`（**无 `secret-resolver.service.ts`**；v1.3 引用错误）

**v1.4 vs v1.3 摘要**: 修复 v1.3 引入的 P0 自洽 bug（tombstone tier 在 cron 路径 TypeError）+ 文档 5 项事实错误（caller 数 / raw SQL 数 / enum 数 / secret-resolver / interceptor）+ IStorageFacade 契约缺口（setLegalHold 等）+ DeleteResult tombstone 分支 + 8 项 Security P1 + 3 项 Architect P1 + 4 项 Reviewer P0/P1（详见 §13）。工期 v1.3 28-30d → **v1.4 23-27d**（caller 数下修主导；新增 interceptor + 契约方法补偿）。

---

## 1. 问题陈述

### 1.1 现状盘点（2026-05-10 prod）

| 数据类型                                                                                                           | 体量              | 当前归属           | 治理状态                                         |
| ------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------ | ------------------------------------------------ |
| `agent_playground_mission_events`                                                                                  | 99 MB / 90,689 行 | DB 单表            | ❌ **未治理**（行级归档模式现注册表装不下）      |
| `topic_reports.full_report`                                                                                        | 几十 MB           | DB JSONB           | ✅ field offload (R2 `topic-reports/`)           |
| `dimension_analyses.data_points`                                                                                   | 几 MB             | DB JSONB           | ✅ field offload                                 |
| `research_tasks.result`                                                                                            | 5,344 行待迁      | DB JSONB           | ✅ field offload                                 |
| `knowledge_base_documents.raw_content`                                                                             | 20 docs           | DB Text            | ✅ field offload                                 |
| `wiki_page_revisions.body`                                                                                         | append-only 极冷  | DB Text            | ✅ field offload                                 |
| `wiki_diffs.items`                                                                                                 | 30d 后归档        | DB JSONB           | ✅ field offload                                 |
| `agent_playground_missions.{report_full / reconciliation_report / leader_journal / analyst_output / outline_plan}` | 5 字段            | DB JSONB           | ✅ field offload（5 个 target，不是 1 个）       |
| `mission_report_versions.report_full`                                                                              | 0 行              | DB JSONB           | ✅ field offload                                 |
| `agent_playground_research_results` / `agent_playground_chapter_drafts` / `notifications`                          | 3 表共 ~5MB       | DB                 | ⚠ v2 候选                                        |
| Redis cache                                                                                                        | 散点缓存          | Redis              | ⚠ **不在本设计范围**（独立 `cache-governance/`） |
| 用户头像 / library 资源                                                                                            | R2 直存           | R2（无 lifecycle） | ⚠ v2 候选                                        |

OFFLOAD_TARGETS 实际 **12 个**（v1.0 写 13 个为口径错误）。**R2 prefix 实际 8 个**（v1.3 修订）：`topic-reports/`、`dimension-analyses/`、`research-tasks/`、`kb-documents/`、`wiki-revisions/`、`wiki-diffs/`、`mission-records/`（5 个 mission target 共享）、`report-versions/`。该数字直接影响 §6.3 orphan scanner 的成本模型与 list-by-prefix 反查逻辑（同 prefix 多 target 需按 `{id}/{filename}` 路径区分，不是单纯 startsWith）。

### 1.2 三个根本问题

A. **模式碎片化**：现 OFFLOAD_TARGETS 只支持字段级，行级归档（mission_events 90K 小行 → 1 个 R2 对象）装不下。

B. **生命周期单向**：DB → R2 后无回流、无 cold 转换、无合规删除。

C. **抽象层缺失**：业务直接 import R2/Prisma；换底要全仓改。

---

## 2. 设计目标与边界

### 2.1 接管 / 不接管（v1.4 修订 / Architect P1）

✅ **接管（WARM 起的搬迁与读路径）**：

- WARM/COLD 介质间搬迁与读路径透明化
- 字段级冷数据搬迁（FieldOffload）— 12 个现有 target 改造
- 行级冷数据归档（RowArchive）— 解决 mission_events 99 MB
- 透明读路径 + DB+R2 mixed merge 查询
- 合规删除（GDPR）路径在 R2 standard / IA 范围内同步保证
- 应用层敏感字段加密（v1.2 新增 — 下文 §4.7）
- **HOT 滞留监测**（v1.4 §7.5）—— 仅读业务表 PK + created_at，不读 PII 内容字段

❌ **不接管**：

- **HOT→WARM 归档触发**（v1.4 修订）：HOT 态业务自治（Prisma + Redis），归档时机由业务侧在终态事件中显式调 `archive()`（如 mission.completed / wiki.diff.applied）；facade 不扫业务表内容、不主动决定归档时机
- GLACIER 态 v1 不实施
- EDGE_HOT 完全删除
- Redis cache 治理（拆独立 `platform/cache-governance/`）
- 跨区复制 / 多活灾备
- 多 vendor 抽象（v1 仅 Cloudflare R2）

> **v1.4 修订（Architect P1）—— 抽象承诺与责任反转**：v1.3 顶部文案"业务模块只消费门面，不关心介质和迁移"易被读成 facade 包揽 HOT→WARM 触发。实际 v1.3 P0-1 把触发责任交给业务（"facade 接管 WARM 起的搬迁与读路径"）。v1.4 顶部 + §2.1 同步措辞：facade 接管 WARM 起的搬迁；HOT→WARM 由业务事件驱动。

### 2.2 用户故事

```
作为 admin：看冷数据分布、手动促归档、查任意对象迁移轨迹、关键失败有告警
作为业务开发者：调 storage.put / get / scan 不关心介质，schema 有版本演进
作为合规审计员：查任意数据当前位置 / 历史；GDPR 删除一键删 R2 std + IA + DB
作为合规官（legal-admin）：可独立设置 / 解除 legal_hold；普通 admin 不能改
```

---

## 3. 三态生命周期模型

### 3.1 状态机

```
┌─────────────────┐
│ HOT (业务自治)  │  ← Prisma + Redis；facade 不接管
└────────┬────────┘
         │ archive() 业务终态唯一触发（v1.3 修订：cron 不再扫 HOT）
         ↓
┌─────────────────┐
│  WARM (R2 std)  │ ← facade 接管起点
└────────┬────────┘
         │ cron 按 policy.coolAfter
         ↓
┌─────────────────┐
│  COLD (R2 IA)   │
└────────┬────────┘
         │ policy.deleteAfter（合规期满 + 非 legal_hold）
         ↓
      DELETED

召回：COLD → WARM → HOT (业务侧 prisma.create + storage.delete)
```

> **v1.3 修订（P0-1）**：v1.2 在状态机图和 §3.2 同时写了 "archive() 业务终态触发 或 cron 按 policy.archiveAfter"，但 §6.1 的 `runOnce()` 只扫 `storage_objects` 表（已 WARM/COLD 对象）——根本没有"扫业务 HOT 表 + 比对 archiveAfter"的代码。两条路径并存，实施一定分叉。v1.3 起 HOT→WARM 100% 由业务侧 `archive()` 事件触发（如 mission.completed、wiki.diff.applied），cron 不再承担 HOT 扫描职责。`policy.archiveAfter` 字段从 LifecyclePolicy 移除（见 §4.4 v1.3 修订）。

| 态      | 介质             | 延迟    | 谁管     |
| ------- | ---------------- | ------- | -------- |
| HOT     | Postgres + Redis | < 10 ms | 业务自治 |
| WARM    | R2 standard      | ~50 ms  | facade   |
| COLD    | R2 IA            | ~200 ms | facade   |
| DELETED | —                | —       | facade   |

> **v1.4 修订（Architect P2 / Reviewer P2）—— tombstone 不是公开 tier**：`storage_objects.current_tier` 列 `CHECK` 枚举值包含 `'deleted-pending-cleanup'`，但该值是 **facade 内部 tombstone**（仅 cron / facade 内部代码可见），不对业务暴露，不在三态生命周期模型对外呈现。`PublicTier` 类型 = `'warm' | 'cold'`；`InternalTier` 类型 = `PublicTier | 'deleted-pending-cleanup'`。详见 §5.2 v1.4 修订。

### 3.2 状态转换原则（v1.3 收口）

- **HOT → WARM**：业务侧 `storage.archive(id, archiver, payload, policy, ownerContext)` 唯一触发。**cron 不扫 HOT**（v1.3 P0-1 修订；详见状态机图下方说明）。业务方在终态事件（mission.completed / wiki.diff.applied / topic.report.finalized 等）显式调 archive()。
- **WARM → COLD**：Cron 每 24h 扫 `storage_objects` 表 `next_transition_at < now() AND current_tier = 'warm' AND legal_hold = false`。
- **COLD → DELETED（合规过期）**：Cron 扫 `delete_after < now() AND legal_hold = false`。
- **任意 → DELETED（GDPR / 用户请求）**：`storage.delete()` 同步路径，不走 cron。
- **召回 COLD → WARM**：Admin 触发 `storage.requestHydrate(id, ownerContext) → ticket`。
- 不可跳级（不允许 HOT 直接到 COLD，必须经 WARM）。
- **读路径不写状态机**。

---

## 4. 抽象层

### 4.1 顶层目录

```
platform/storage/
  facade/
    storage.facade.ts                  ← 业务唯一入口
    storage.module.ts
    abstractions/
      storage.contract.ts              ← IStorageFacade
      lifecycle-policy.ts              ← LifecyclePolicy / Tier
      owner-context.ts                 ← OwnerContext
      versioned-schema.ts              ← VersionedSchema<T>（v1.2 新增，详见 §4.2）

  lifecycle/
    lifecycle-manager.service.ts
    abstractions/lifecycle-target.ts   ← LifecycleTarget（仅 Field/Row 两种）
    targets/field-offload.target.ts    ← 12 个改造
    targets/row-archive.target.ts      ← mission_events

  archiver/
    abstractions/archiver.contract.ts  ← IArchiver
    archiver-registry.ts
    helpers/sanitize-key-segment.ts    ← path traversal 防护

  adapters/
    r2-warm.adapter.ts                 ← R2 standard
    r2-cold.adapter.ts                 ← R2 IA
    abstractions/tier-adapter.ts

  encryption/                          ← v1.2 新增（§4.7）
    application-layer-encryptor.ts
    abstractions/encryptor.contract.ts

  governance/                          ← 已存在改造
    storage-inventory.service.ts       ← 数据源切到 storage_objects
    storage-offload.registry.ts        ← 改造为 LifecycleTarget 注册器
    storage-offload.service.ts         ← 改名 lifecycle-manager 兼容 export

  ❌ monitoring/   ← 不建，用 common/observability/MetricsService
  ❌ audit/        ← 不建，用 common/audit/（v1.2 见 §4.5）
```

### 4.2 业务侧 API（IStorageFacade）— v1.2 修复 ACL

````typescript
/**
 * v1.2 新增：版本化 schema 包装（解决 Reviewer P1-A）
 * z.ZodType<T> 标准接口无 _currentSchemaVersion，需显式包装
 *
 * v1.3 修订（P1-1）：明确 migrate 调用语义——
 *   facade.get() 路径优先调 archiver.deserialize(raw, fromVersion, toVersion) 做版本迁移；
 *   仅当 deserialize 抛 SchemaVersionMismatchError 时，facade 才 fallback 调
 *   VersionedSchema.migrate（业务侧定义的 schema-level 兜底，例如临时支持过渡版本）。
 *   migrate 不是首选迁移路径，仅作为 archiver 暂未实装某版本迁移时的逃生通道。
 */
export interface VersionedSchema<T> {
  schema: z.ZodType<T>;
  schemaVersion: number; // 与 archiver schemaVersion 对齐
  /**
   * 旧版本数据迁移到当前版本（v1.3 修订：facade fallback 调用，非首选路径）
   * 当 archiver.deserialize 抛 SchemaVersionMismatchError 时被 facade 调用。
   * 调用顺序：archiver.deserialize 失败 → migrate(legacyPayload, fromVersion) → schema.parse
   */
  migrate?: (legacyPayload: unknown, fromVersion: number) => unknown;
}

/**
 * v1.2 强化：所有读 / 召回 / 删除接口必传 OwnerContext，DB 也持久化（§5.2）
 */
export interface OwnerContext {
  userId: string; // 调用者 user id（JWT 注入）
  workspaceId?: string; // 调用者所在 workspace（可选，多租户场景）
  roles?: string[]; // 角色列表（如 ['admin', 'legal-admin']）
}

interface IStorageFacade {
  /**
   * 归档：HOT → WARM 唯一入口；ownerContext 持久化到 storage_objects
   */
  archive(
    id: string,
    archiverName: string,
    payload: unknown,
    policy: string,
    ownerContext: OwnerContext, // 持久化为 storage_objects.owner_id / workspace_id
  ): Promise<{ tier: "warm" }>;

  /**
   * 透明读 — 强制 VersionedSchema + ownerContext + allowTiers
   */
  get<T>(
    id: string,
    schema: VersionedSchema<T>, // 不再裸 z.ZodType
    ownerContext: OwnerContext,
    options?: { allowTiers?: ("warm" | "cold")[] },
  ): Promise<T>;

  /**
   * 集合查询 — DB+R2 mixed merge
   */
  scan<T>(
    scope: { groupBy: string; value: string },
    archiverName: string,
    schema: VersionedSchema<T[]>,
    ownerContext: OwnerContext,
  ): Promise<T[]>;

  /**
   * 召回 ticket — v1.2 强化：getHydrateStatus 也要 ownerContext（解决 Security P1-1）
   * v1.4 修订（Security P2）：getHydrateStatus 对 "ticketId 不存在" 与 "存在但非 owner"
   *   必须返回**完全相同**的 ForbiddenError 响应体 + 恒定 timing（常量 sleep 或恒定 DB 查询），
   *   防止 attacker 通过响应差异区分 ticketId 是否存在（timing/response oracle）
   */
  requestHydrate(
    id: string,
    ownerContext: OwnerContext,
  ): Promise<{ ticketId: string; eta: Date }>;

  getHydrateStatus(
    ticketId: string,
    ownerContext: OwnerContext, // v1.2 新增 — 防 ticketId 枚举泄露
  ): Promise<HydrateStatus>;

  /**
   * 删除 — v1.2 修复：legal_hold + GDPR 不再自动覆盖（解决 Security P1-3）
   */
  delete(
    id: string,
    ownerContext: OwnerContext,
    reason: "gdpr" | "user-request" | "admin-purge" | "lifecycle-expired",
  ): Promise<DeleteResult>; // 可能返回 'pending-legal-review'

  statusOf(
    id: string,
    ownerContext: OwnerContext,
  ): Promise<StorageObjectStatus>;

  // v1.4 修订（Reviewer P0-R1）：legal-hold 三方法补齐 facade 契约（避免业务方/admin UI 直调 audit service 破坏 §10.1 层级）
  setLegalHold(
    id: string,
    reason: string,
    ownerContext: OwnerContext, // 必须含 roles: ['legal-admin']
  ): Promise<{ status: "set"; auditEventId: string }>;

  unsetLegalHold(
    id: string,
    ownerContext: OwnerContext, // 必须是该 hold 的 setter 本人
  ): Promise<{ status: "unset"; auditEventId: string }>;

  overrideLegalHold(
    id: string,
    coSignerToken: string, // 由其他 legal-admin 签发的一次性 token（详见 §7.2 v1.4）
    ownerContext: OwnerContext, // 发起者；不能与 token 签发者相同
  ): Promise<{ status: "overridden"; auditEventId: string }>;
}

// v1.4 修订（Reviewer P0-R2）：DeleteResult 增 partial-tombstoned 分支，caller 可区分"真删"和"R2 已删但需 cron 兜底"
export type DeleteResult =
  | { status: "deleted" }
  | { status: "pending-legal-review"; reason: string; auditEventId: string }
  | { status: "partial-tombstoned"; reason: string; auditEventId: string }; // R2 已删 + DB 已置 tombstone，cron 下一轮收敛

**v1.2 关键修复**：

- `VersionedSchema<T>` 替代裸 `z.ZodType<T>` — Reviewer P1-A
- `getHydrateStatus(ticketId, ownerContext)` — Security P1-1（防信息泄露）
- `delete()` 返回类型可能为 `pending-legal-review`，不再自动覆盖 legal_hold（Security P1-3）

### 4.3 Archiver 责任反转（v1.2 强化）

```typescript
interface IArchiver<TScope = Record<string, string>, TPayload = unknown> {
  name: string;
  schemaVersion: number;

  /** 业务自取数据（storage 不知 prisma 表名）*/
  listForArchive(scope: TScope): Promise<TPayload>;

  /** v1.2 新增：业务声明 ID 模板，scan/delete 时按此反查（解决 Architect P1-N2）*/
  idTemplate(scope: TScope): string; // 如 'mission-events:{missionId}'

  /** 业务定义 R2 key（含 sanitize）*/
  keyFor(scope: TScope, schemaVersion: number): string;

  /**
   * 业务自实现 mixed merge（DB HOT + R2 archived）
   * v1.4 修订（Reviewer P1）：hydrate 改用 OneShotHydrate 品牌类型，IDE / 类型系统层面提示"一次性"语义，
   * 配合 runtime once-flag（HydrateReuseError）+ ESLint `storage/no-hydrate-capture` 三道防线
   */
  scanMixed(scope: TScope, hydrate: OneShotHydrate<TPayload>): Promise<TPayload>;

  serialize(payload: TPayload, schemaVersion: number): string;
  deserialize(raw: string, fromVersion: number, toVersion: number): TPayload;

  /** v1.2 新增：声明本 archiver 写入数据是否含敏感内容 */
  encryption?: {
    enabled: true;
    keyId: string; // 引用 secrets resolver
  };
}
````

> **v1.2 Architect P1-N3 落点**：`scanMixed` 中的 `hydrate` 闭包**不可跨调用缓存**，必须在 facade 内单次创建并由 archiver 立即消费。
>
> **v1.3 修订（P1-3）—— 强约束改写**：v1.2 写"文档约束 + spec test 验证"两手都偏软——spec 测不出"业务方有没有把 hydrate 存到 instance var 跨 mission 复用"，纯文档约束在 code review 也容易漏。v1.3 加双重防线：
>
> 1. **Runtime once-flag**：facade 创建的 hydrate 闭包内带 `_consumed = false` 状态；第二次调用 hydrate 抛 `HydrateReuseError(archiverName, scope)`；abuse 在测试 / 灰度环境第一时间暴露（spec 覆盖见 §11 v1.3）。
> 2. **ESLint custom rule** `storage/no-hydrate-capture`：禁止 archiver 类内 `this.hydrate = ...` / 模块级 `let hydrate = ...` 写法（hydrate 必须作为函数参数局部使用、不可逃逸 scanMixed scope）。规则放在 `tools/eslint-rules/`，PR-S5 与 sample archiver 同步落地。

```typescript
// v1.4 修订：OneShotHydrate 品牌类型 + buildHydrate 工厂；ESLint storage/no-hydrate-capture 禁止 archiver 持引用
declare const __oneShotBrand: unique symbol;
export type OneShotHydrate<T> = (() => Promise<T>) & {
  [__oneShotBrand]: "one-shot";
};

export function buildHydrate<T>(loader: () => Promise<T>): OneShotHydrate<T> {
  let consumed = false;
  const fn = (async () => {
    if (consumed) {
      throw new HydrateReuseError(
        "hydrate closure consumed; archiver must not cache or reuse it",
      );
    }
    consumed = true;
    return loader();
  }) as OneShotHydrate<T>;
  return fn;
}
```

> **v1.4 修订（Architect P1）—— hydrate 抽象暗示**：v1.4 的 once-flag + ESLint rule + 品牌类型 是 v1 取舍，v2 应改 `scanMixed(scope, source: AsyncIterable<T>)`——让"一次性消费"由类型系统结构性表达（AsyncIterator 自然一次消费完即结束），届时 once-flag 探针 + ESLint rule 可退役。该 v2 改造列入 §12 候选。

### 4.4 Lifecycle Policy

```typescript
storage.registerPolicy({
  name: "agent-playground-events",
  ownerModule: "agent-playground",
  archiverName: "agent-playground:mission-events",
  // v1.3 P0-1 / v1.4 修订（Reviewer P2）：archiveTrigger 是唯一触发源；v1 仅 'business-event' kind
  // 保留 discriminated union 形式为 v2 扩展（如 'cron-time' kind 用于 GLACIER）预留；§12 候选项
  archiveTrigger: { kind: "business-event", eventName: "mission.completed" },
  coolAfter: "90d",
  deleteAfter: null, // 默认不自动删
  r2Prefix: "mission-events/",
  currentSchemaVersion: 1,
  audit: true,
});
```

> **v1.3 P0-1 修订**：`archiveAfter` 字段从 LifecyclePolicy 配置中**移除**。v1.2 同时存在 `archiveTrigger`（业务事件）和 `archiveAfter`（cron 时间），导致 cron 实现路径不确定。v1.3 起 HOT→WARM 100% 业务事件驱动，`archiveTrigger.kind` 仅支持 `business-event`（v1）。如果某业务方需要"超时未完成 mission 也归档"，应由业务方在 mission watchdog 上自行发出 `mission.timeout` 事件并调 `storage.archive()`，而不是由 storage 层 cron 扫描业务表。

### 4.5 审计接入（v1.3 强化 — common/audit）

> **v1.2 Arch-Auditor P1-1/P1-3 修复**：现 `backend/src/common/audit/audit.service.ts` 是**纯内存实现**（line 147 `auditLogs: StoredAuditLog[] = []`，最多 1000 条，无 DB 持久化、无 RULE、无 legal-hold）。命名冲突 + 实现缺口必须正面解决。
>
> **v1.4 修订（v1.3 P0-2 论据立柱倒，重写）—— AuditService 实测数据**：v1.3 误把"类内 convenience methods 数量"当作"外部 caller 数量"（30+ → 实测 9 个类内方法 / 3 个外部 service / 8 处生产调用），导致 PR-A0.5 3-5d 工期估错。实际改造范围：
>
> 1. **类内 convenience methods 实测 9 个**（`logTopicCreate / logMemberAdd / logMessageSend / logAIResponseGenerate / logAIResponseError / logVoteCreate / logVoteCast / logMissionCreate / logMissionComplete`，audit.service.ts:213-351）。这些方法每个底层调 `this.log()`，重构时只需让 `this.log()` 委托给 `PersistentAuditService.write()` + 走 `AuditAction → { entityType, action }` 映射表，**类对外签名保持不变**，9 个方法不需要逐一改写。
> 2. **外部生产 caller 实测 3 个 service / 8 处调用点**：
>    - `modules/open-api/admin/admin.service.ts` 行 110/844/3136/3259（4 处 `auditService.log({...})`，泛型签名）
>    - `modules/ai-app/teams/ai-teams.service.ts` 行 130/507/744（3 处 convenience method 调用）
>    - `modules/ai-app/teams/services/ai/ai-response.service.ts` 行 1338（1 处 `logAIResponseGenerate`）
>      重构期间这 8 处**无需修改**——`AuditService` 类对外签名不动，只是底层从内存数组改为 DB 表 + RULE。
> 3. **`@Audit(AuditAction.XXX)` 装饰器**（`audit.service.ts:128`，`SetMetadata(AUDIT_KEY)`）—— v1.4 修订（Arch-Auditor 拍到）：`AUDIT_KEY` 在 prod 代码 **0 个 interceptor / guard / aspect 读取**（grep 全 src 仅 audit.service.ts 自身与 spec 命中），即 `@Audit` 装饰器目前是**贴标签但无消费者**。PR-A0a 必须**新建** `AuditMetadataInterceptor`（读 reflector.get(AUDIT_KEY)，调 `PersistentAuditService.write()`），不是"切到新 service"。spec 必须覆盖装饰器 → 落表的端到端路径。
> 4. **`AuditAction` enum 实测 24 个值**（USER 3 + TOPIC 3 + MEMBER 3 + MESSAGE 2 + AI 2 + MISSION 3 + VOTE 3 + DEBATE 2 + SYSTEM 2 + CUSTOM 1，audit.service.ts:25-69）。`AuditAction → { entityType, action }` 静态映射表 24 条，由 PR-A0a 一次性落地；spec 加 **映射表完整性断言**（`Object.keys(AuditAction).length === Object.keys(AUDIT_ACTION_MAP).length`），保证未来新加 enum 值时编译/测试拦下漏映射。
> 5. **映射表 miss 时 fallback 行为**（Security P1-S5 修订）：映射 miss 必须抛 `UnmappedAuditActionError`（不能 fallback `entityType='unknown'`，否则 RBAC 命中不到导致 admin 都看不到 → 静默审计黑洞）；启动时（boot）扫所有 enum 值确认映射齐全。
>
> **工期重估**：PR-A0.5 v1.3 3-5d → **v1.4 1-1.5d**（AuditService 类对外签名不动 + 装饰器 interceptor 新建 0.5d + 映射表 + spec 0.5d + 装饰器接入 caller 端到端 spec 0.5d）。PR-A0a 因新建 interceptor 上调 0.5d → 1d。

```
common/audit/
  audit.decorator.ts                        ← v1.4 修订：从 audit.service.ts 拆出 @Audit + AuditAction enum + AUDIT_KEY；保留原 import 路径 re-export（避免 8 处 caller 改动）
  audit.service.ts                          ← 现存内存版，**重命名** → in-memory-audit.service.ts（保留 `export { Audit, AuditAction } from './audit.decorator'` 让现有 caller 不破）
  persistent-audit.service.ts               ← v1.2 新增：DB 持久化 + RULE INSERT-only + legal-hold
  audit-action-mapper.ts                    ← v1.4 修订（含 24 enum → entityType/action 映射表 + miss-throw 兜底 + 启动完整性校验）
  audit-metadata.interceptor.ts             ← v1.4 新增（Arch-Auditor 拍到）：reflector 读 AUDIT_KEY → 调 PersistentAuditService.write
  abstractions/
    audit-event.ts
  audit-log.module.ts
```

> **v1.4 修订（Security P1）—— @Audit 装饰器 logArgs PII/secret 防护**：装饰器选项 `{ logArgs: true }`（audit.service.ts:130）会把方法参数序列化到 `common_audit_log.payload` JSONB；7 年保留且 INSERT-only。`AuditMetadataInterceptor` 必须实施 **deny-by-default 的参数 redact 策略**：
>
> - 默认 **不**序列化方法参数到 payload
> - 装饰器扩展为 `@Audit(action, { logArgs: { fields: ['topicId', 'memberId'] } })`，必须显式 allowlist 字段
> - allowlist 字段经 `redactor.ts` 二次过滤（命中 `/password|token|secret|apiKey|plaintext/i` 的 key 强行 redact）
> - spec 覆盖：任何 caller 误填 sensitive key 入 allowlist 时仍被 redactor 拦下

**Schema**：

```sql
CREATE TABLE common_audit_log (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_type     TEXT NOT NULL,                  -- 'storage' | 'story-bible' | 'feature-flag' | 'key-request'
  entity_id       TEXT NOT NULL,
  action          TEXT NOT NULL,
  actor_kind      TEXT NOT NULL,                  -- 'cron' | 'user' | 'system' | 'legal-admin'
  actor_id        TEXT,
  payload         JSONB NOT NULL,
  legal_hold      BOOLEAN NOT NULL DEFAULT false, -- 该审计行本身是否锁定（不被自身 lifecycle 删）
  occurred_at     TIMESTAMP NOT NULL DEFAULT NOW()
)
PARTITION BY RANGE (occurred_at);

-- v1.2 必备：schema 级 INSERT only
CREATE RULE common_audit_log_no_update ON common_audit_log AS ON UPDATE DO INSTEAD NOTHING;
CREATE RULE common_audit_log_no_delete ON common_audit_log AS ON DELETE DO INSTEAD NOTHING;

-- 月分区预建 12 个月
CREATE INDEX common_audit_entity_idx ON common_audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX common_audit_action_idx ON common_audit_log (action, occurred_at DESC) WHERE action LIKE '%failed%';
```

**审计读取 RBAC（v1.2 修复 Security 跨域泄露）**：

```typescript
class PersistentAuditService {
  async listByEntityType(
    entityType: string,
    requesterRoles: string[],
  ): Promise<AuditEvent[]> {
    // entityType 级 RBAC
    const allowedRoles = AUDIT_ROLE_MAP[entityType];     // 如 'storage' → ['admin', 'legal-admin']
    if (!requesterRoles.some(r => allowedRoles.includes(r))) {
      throw new ForbiddenError(`role missing for ${entityType} audit`);
    }
    return this.prisma.commonAuditLog.findMany({ where: { entityType }, ... });
  }

  async export(entityType: string, requesterRoles: string[]): Promise<NDJSON> {
    // export 必须 admin role + 自身写一条 audit-of-audit
    if (!requesterRoles.includes('admin')) throw new ForbiddenError();
    await this.write({ entityType: 'audit-export', action: 'exported', ... });
    return this.streamNDJSON({ entityType });
  }

  /** v1.2 新增：legal-admin 角色专属（解决 Security P1-2）*/
  async setLegalHold(
    entityType: string,
    entityId: string,
    reason: string,
    requesterRoles: string[],
  ): Promise<void> {
    if (!requesterRoles.includes('legal-admin')) {
      throw new ForbiddenError('legal-admin role required to set legal hold');
    }
    // 写 hold 记录到 common_audit_log（不可篡改）+ 更新 storage_objects.legal_hold = true
    ...
  }
}
```

### 4.6 Metrics 接入（现有 common/observability）

```
storage_objects_total{policy, tier}
storage_size_bytes{policy, tier}
storage_transitions_total{from, to, status, reason}
storage_transition_duration_seconds_bucket{...}
storage_orphans_deleted_total
storage_legal_hold_active_total{entity_type}      ← v1.2 新增
```

### 4.7 应用层加密（v1.2 新增 / v1.3 措辞收紧）

> **背景**：v1.2 之前归档对象仅靠 Cloudflare R2 SSE 服务端加密，bucket 配置错误时 PII 全裸。Security 提出 v1 至少敏感字段应用层加密。

**适用范围（v1，强制加密）**：

- `topic_reports.full_report` — 含用户研究内容
- `agent_playground_mission_events` — 含用户提示词 / AI 对话
- `wiki_page_revisions.body` — 含用户编辑内容

**v1.3 修订（P1-5）—— 未覆盖字段的审计时间表**：

下列字段在 v1 不强制加密，但**必须**在 v1 上线后 30 天内由 Security + 业务方完成敏感性审计，审计结果作为 v1.x 加密扩展 P0 的输入：

- `dimension_analyses.data_points` — 需确认是否含原始用户文本（LLM 输出指标 vs 原文混合）
- `research_tasks.result` — 需确认是否含外部 API 返回的用户标识
- `wiki_diffs.items` — 需确认 diff 内容是否含敏感原文片段
- `mission_report_versions.report_full` — 当前 0 行，但需在首批数据写入前敲定加密策略
- `knowledge_base_documents.raw_content` — 已经在 OFFLOAD 列表，需确认 KB 文档来源是否含 PII

**审计责任人**：Security + 各业务方 owner（具体分配在 §12 v2 候选 + 单独工单）  
**审计截止**：v1 GA 后 30 个自然日  
**未完成处罚**：审计未交付前 v1.x 加密扩展 P0 阻塞

**实现**（archiver 声明触发）：

```typescript
// archiver 声明 encryption.enabled = true 的 payload 自动经 ApplicationLayerEncryptor 处理
class ApplicationLayerEncryptor {
  // v1.3 修订（P1-2）：v1 仅支持 system-tier keyId；archiver 注册时校验 keyId 属于 system-tier，
  // per-user / user-tenant key 抛 NotImplementedError，与 §12 v2 BYOK 同步落地
  async encrypt(plaintext: string, keyId: string): Promise<EncryptedPayload> {
    const keyInfo = await this.secrets.getKeyInfo(keyId);
    if (keyInfo.tier !== 'system') {
      throw new NotImplementedError(
        `v1 only supports system-tier keys; user-tenant keyId=${keyId} requires v2 BYOK (see §12)`,
      );
    }
    const key = await this.secrets.getKey(keyId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      _enc: 'aes-256-gcm',
      _keyId: keyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }
  async decrypt(payload: EncryptedPayload): Promise<string> { ... }
}
```

**密钥管理（v1.4 修订 —— Arch-Auditor 拍到 v1.3 引用错误）**：实际复用 `backend/src/modules/platform/credentials/secrets/secrets.service.ts` + `secret-keys.service.ts`（v1.3 误写为 `secret-resolver.service.ts`，该文件不存在）；secrets 模块本身**无 `keyTier` / `keyId.tier` 字段概念**，PR-S9.5 必须先在 `secret-keys.service.ts` 加 `tier: 'system' | 'user-tenant'` 列 + 索引（v1 全部为 `'system'`），再让 `ApplicationLayerEncryptor` 通过 `secretKeysService.getInfo(keyId)` 校验 tier。**v1 仅 system-tier 密钥**（archiver 注册时静态绑定 `keyId`），不支持 per-payload / per-user 切换。

**v1.4 修订（Security P2）—— keyId tier 不可降级**：secrets resolver 后续若把同一 keyId 从 system-tier 改回 user-tenant tier，**已加密的历史对象会突然无法读**（archiver 注册时校验通过 + ApplicationLayerEncryptor 读时 runtime 校验拒绝）。tier 修改必须走"key 轮换 + 重加密"流程（新 keyId + 后台 backfill + 验证完成后 retire 旧 keyId），不允许就地降级。`secret-keys.service.ts` `update` 路径加守卫：tier 从 `'system'` 改 `'user-tenant'` 直接抛 `IllegalKeyTierTransitionError`。

**v1.4 修订（Security P1）—— boot-test 解密样本合规面**：`ApplicationLayerEncryptor` 启动时做一次"加密+解密 round-trip"健康检查，**样本必须是固定专用测试 fixture**（如 `'__boot_test_payload__'` 字符串），不是 prod 真实数据；round-trip 结果只 boolean 上报到 metric `storage_encryption_boot_test_ok{keyId}`，**不写日志、不入 audit**。spec 覆盖：boot-test 失败时启动失败，不允许跳过。

**v1.3 修订（P1-2）—— keyId 模型措辞收紧**：v1.2 写"keyId 由 secrets resolver 提供（user-tenant or system-tier）"会误导 reviewer，因为 `archiver.encryption.keyId: string` 是 archiver 注册时静态绑定，不支持 per-payload 切换。v1 仅 system-tier；per-user / per-tenant key 与 §12 BYOK 一起作为 v2 立项，**当前不在实施范围**。

**当前限制（合规明示）**：v1 不提供"物理删除证明"。BYOK + per-user key 是 v2 单独立项，不在本设计范围（Architect P1-N5 / v1.3 P1-2 共同结论）。

---

## 5. 数据库 schema

### 5.1 `storage_lifecycle_policies`

```sql
CREATE TABLE storage_lifecycle_policies (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                    TEXT UNIQUE NOT NULL,
  owner_module            TEXT NOT NULL,
  archiver_name           TEXT NOT NULL,
  config                  JSONB NOT NULL,
  current_schema_version  INT NOT NULL DEFAULT 1,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.2 `storage_objects`（v1.4 修订：整表新建 + tombstone tier）

> **v1.4 修订（Arch-Auditor 拍到）**：`storage_objects` 表在 Prisma schema 完全不存在（`backend/prisma/schema/{base,models,wiki}.prisma` 全 0 命中），**整表新建**，不存在 alter enum / alter column 风险。v1.3 P0-3 措辞"新加 `'deleted-pending-cleanup'` 枚举值"是误导——`current_tier` 列从未存在，本设计是该列与枚举集合的**首次定义**。
>
> **v1.4 修订（Reviewer P2）—— `Tier` 联合类型同步**：`current_tier` SQL 层是 `TEXT NOT NULL`，但应用层 zod / TypeScript 必须用强类型 union：
>
> ```typescript
> // abstractions/lifecycle-policy.ts
> export type PublicTier = "warm" | "cold"; // facade 对业务暴露
> export type InternalTier = PublicTier | "deleted-pending-cleanup"; // 仅 facade 内部 / cron 可见
> ```
>
> `IStorageFacade.get` 的 `options.allowTiers?: PublicTier[]`（不含 tombstone）；`storage_objects.current_tier` 列在 Prisma model 用 `InternalTier`。zod schema 在 facade 入口对 caller 提供的 tier 字段强校验。
>
> **HOT 不入 storage_objects**：`current_tier` 不含 `'hot'`——HOT 由业务 Prisma 表自治，storage_objects 行的存在本身即表示对象至少已 WARM。

```sql
CREATE TABLE storage_objects (
  id                  TEXT PRIMARY KEY,
  policy_name         TEXT NOT NULL REFERENCES storage_lifecycle_policies(name),
  current_tier        TEXT NOT NULL
                      CHECK (current_tier IN ('warm', 'cold', 'deleted-pending-cleanup')),  -- v1.4 修订：DB 层强校验 InternalTier
  uri                 TEXT NOT NULL,
  size_bytes          BIGINT,
  schema_version      INT NOT NULL,

  -- v1.2 新增：ACL 列（解决 Security P0-1 / CWE-863）
  owner_user_id       TEXT,                       -- archiver 写入时持久化 ownerContext.userId
  owner_workspace_id  TEXT,                       -- ownerContext.workspaceId（多租户）

  -- v1.2 新增：加密元信息
  encrypted           BOOLEAN NOT NULL DEFAULT false,
  encryption_key_id   TEXT,                       -- 引用 secret-keys.service（v1.4 修订：原 v1.3 误写为 secret-resolver）

  next_transition_at  TIMESTAMP NOT NULL,
  delete_after        TIMESTAMP,
  legal_hold          BOOLEAN NOT NULL DEFAULT false,
  legal_hold_reason   TEXT,
  legal_hold_set_by   TEXT,                       -- legal-admin user id
  legal_hold_set_at   TIMESTAMP,

  -- v1.2 新增：backfill 续传游标
  backfill_cursor     JSONB,

  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
)
PARTITION BY RANGE (created_at);

-- v1.2 必备索引：ACL 校验路径（owner 列 + policy 联合）
CREATE INDEX storage_objects_owner_idx ON storage_objects (owner_user_id, policy_name);
CREATE INDEX storage_objects_workspace_idx ON storage_objects (owner_workspace_id, policy_name) WHERE owner_workspace_id IS NOT NULL;

-- 现有索引
CREATE INDEX storage_objects_pending_idx ON storage_objects (next_transition_at)
  WHERE current_tier = 'warm' AND legal_hold = false;
CREATE INDEX storage_objects_delete_idx ON storage_objects (delete_after)
  WHERE delete_after IS NOT NULL AND legal_hold = false;
CREATE INDEX storage_objects_policy_tier_idx ON storage_objects (policy_name, current_tier);
```

### 5.3 Migration 注意事项

- 全部 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
- 月分区预建 12 个月（手写 SQL）
- 避免 `CREATE INDEX CONCURRENTLY`（已知 prisma migrate deploy 静默回滚坑）
- `audit_log` PARTITION BY RANGE(occurred_at) 月分区在 PR-A0b 同步建立（不能等表大了再加）

---

## 6. 迁移引擎（Lifecycle Manager）

### 6.1 cron 主循环

```typescript
// v1.3 修订（P0-1）：cron 主循环只扫 storage_objects 表（WARM/COLD 对象）；
// HOT 表完全不扫，HOT→WARM 由业务事件 storage.archive() 触发
// v1.4 修订（Reviewer P1-R5 关键 bug）：findDueForDelete / findDueForCool SQL 必须排除
//   current_tier='deleted-pending-cleanup'，否则 cron 二次扫到 tombstone 行会调
//   adapters[tombstone].delete() = undefined.delete() → TypeError 终止 cron
async runOnce() {
  const policies = await this.prisma.storageLifecyclePolicy.findMany({ where: { enabled: true } });
  const locked = await acquireAdvisoryLock();
  if (!locked) return;

  try {
    for (const policy of policies) {
      // WARM → COLD 降温
      const due = await this.findDueForCool(policy);
      // SQL: storage_objects WHERE current_tier='warm' AND next_transition_at < now() AND legal_hold=false
      for (const obj of due) await this.transition(obj, 'cold');

      // COLD → DELETED 合规过期
      const expired = await this.findDueForDelete(policy);
      // v1.4 修订（Reviewer P1-R5）：SQL 必须 current_tier IN ('warm','cold')
      // SQL: WHERE delete_after < now() AND legal_hold=false AND current_tier IN ('warm', 'cold')
      for (const obj of expired) {
        await this.deleteInternal(obj, 'lifecycle-expired');
      }

      // v1.4 新增（Reviewer P0-3 / P1-R5）：tombstone 收敛——current_tier='deleted-pending-cleanup' 的孤行
      // R2 已删，DB 行只是 metadata 残留，直接 prisma.delete（不调 adapter）
      const tombstones = await this.prisma.storageObject.findMany({
        where: { current_tier: 'deleted-pending-cleanup' },
        take: 100,
      });
      for (const t of tombstones) {
        await this.prisma.storageObject.delete({ where: { id: t.id } });
        await this.audit.write({
          entityType: 'storage',
          entityId: t.id,
          action: 'tombstone.collected',
          payload: { collectedAt: new Date().toISOString() },
        });
      }
    }
    await this.orphanScanner.scan();
  } finally {
    await releaseAdvisoryLock();
  }
}
```

> **v1.4 修订（Reviewer P1-R5）—— tombstone tier 在 cron 路径上的处理**：v1.3 引入 `current_tier='deleted-pending-cleanup'` 但未在 `findDueForCool` / `findDueForDelete` SQL WHERE 排除，会被命中后调 `adapters['deleted-pending-cleanup']`（undefined）抛 TypeError 终止 cron。v1.4 修订三处：
>
> 1. `findDueForCool` SQL `WHERE current_tier='warm'` 已隐式排除 tombstone（保持不变）
> 2. `findDueForDelete` SQL 必须显式 `current_tier IN ('warm','cold')`
> 3. 新增独立 tombstone 收敛分支：找 `current_tier='deleted-pending-cleanup'` 的行直接 `prisma.delete`（R2 已删，无需调 adapter），写 `tombstone.collected` audit；每轮限 100 条避免长事务

> **§5.2 索引同步修订（v1.4）**：现有 `storage_objects_pending_idx` 和 `storage_objects_delete_idx` 部分索引必须配合新的 WHERE 条件——`storage_objects_delete_idx` 加 `AND current_tier IN ('warm','cold')`，并新增 `storage_objects_tombstone_idx ON (current_tier) WHERE current_tier='deleted-pending-cleanup'`

### 6.2 transition 序列（commit-then-delete + audit pending）

```typescript
async transition(obj: StorageObject, toTier: Tier) {
  const auditId = await this.audit.write({
    entityType: 'storage',
    entityId: obj.id,
    action: 'transition.pending',
    payload: { from: obj.current_tier, to: toTier },
  });

  try {
    const newUri = await this.adapters[toTier].copyIfNotExists(obj.uri); // v1.2: 显式幂等接口
    await this.prisma.storageObject.update({
      where: { id: obj.id },
      data: { current_tier: toTier, uri: newUri, updated_at: new Date() },
    });
    await this.adapters[obj.current_tier].delete(obj.uri);
    await this.audit.write({ entityType: 'storage', entityId: obj.id, action: 'transition.success', payload: { auditPendingId: auditId, ...} });
  } catch (e) {
    await this.audit.write({ entityType: 'storage', entityId: obj.id, action: 'transition.failed', payload: { auditPendingId: auditId, error: e.message } });
    // 不抛 — 单对象失败不阻塞其他
  }
}
```

> **Reviewer P1-D 落点**：`copyIfNotExists` 是显式 adapter 接口；R2 原生不支持 if-not-exists copy，adapter 内部用 `headObject` 检查 + `putObject`（两步幂等，竞争窗口由 advisory lock 收敛）。

### 6.3 Orphan Scanner（v1.3 prefix 共享成本说明）

继承 v1.1 设计，每次扫一批 R2 对象（1000）按 prefix 反查 storage_objects：

- DB 不存在 → 删
- DB 存在但 URI 与 R2 key 不匹配（旧 URI 残留）→ 删

> **v1.3 修订（P2-1）—— prefix 共享成本模型**：实际 R2 prefix 共 **8 个**（不是 12 个，见 §1.1）：`topic-reports/`、`dimension-analyses/`、`research-tasks/`、`kb-documents/`、`wiki-revisions/`、`wiki-diffs/`、`mission-records/`（5 个 mission target 共享）、`report-versions/`。
>
> 对 orphan scanner 的影响：
>
> 1. **`mission-records/` prefix 下有 5 个 target**（`report_full / reconciliation_report / leader_journal / analyst_output / outline_plan`），key 形如 `mission-records/{missionId}/{field}.json`。反查 DB 时不能仅 `startsWith('mission-records/')`，必须按 `{field}.json` 后缀区分映射到对应的 target 注册项。
> 2. **加 mission-events 后 9 个 prefix**（PR-S6a 增 `mission-events/`），单轮全扫成本 = 9 × ceil(N_per_prefix / 1000) × list-objects API 调用，按 R2 list-objects 限额 1000 req/s 评估单轮耗时（当前数据量 8K-9K objects → 约 10s 量级，可接受）。
> 3. orphan scanner 加 metric `storage_orphan_scan_duration_seconds_bucket{prefix}`，单 prefix 扫描超 30s 触发 warn。

### 6.4 透明读路径（v1.3 ACL 强化 + migrate fallback）

```typescript
async get<T>(id, schema, ownerContext, options) {
  const obj = await this.prisma.storageObject.findFirst({ where: { id } });
  if (!obj) throw new NotFoundError(id);

  // v1.3 P0-3：tombstone 行业务侧不可见
  if (obj.current_tier === 'deleted-pending-cleanup') {
    throw new NotFoundError(id);
  }

  // v1.2: 真实 ACL 检查（基于 storage_objects.owner_user_id / workspace_id）
  await this.acl.assertCanRead(obj, ownerContext);

  const allowTiers = options?.allowTiers ?? ['warm'];
  if (!allowTiers.includes(obj.current_tier)) {
    throw new NeedsHydrationError(id, obj.current_tier);
  }

  let raw = await this.adapters[obj.current_tier].read(obj.uri);

  // v1.2: 应用层解密（如果 archived 时启用）
  if (obj.encrypted) {
    raw = await this.encryptor.decrypt(JSON.parse(raw));
  }

  const archiver = this.archivers.get(obj.policy.archiverName);

  // v1.3 P1-1 / v1.4 修订（Reviewer P1）：版本迁移优先走 archiver.deserialize；
  // 仅当其抛 SchemaVersionMismatchError 且 schema.migrate 已定义时 fallback；
  // v1.4：fallback 路径独立 try/catch，二次失败抛 MigrateFallbackError（语义清晰，区别于首次失败）
  let data: unknown;
  try {
    data = archiver.deserialize(raw, obj.schema_version, schema.schemaVersion);
  } catch (e) {
    if (e instanceof SchemaVersionMismatchError && schema.migrate) {
      try {
        const legacy = archiver.deserialize(raw, obj.schema_version, obj.schema_version); // 原版本反序列化
        data = schema.migrate(legacy, obj.schema_version);
      } catch (migrateErr) {
        // v1.4 修订（Reviewer P1）：fallback 二次失败包成 MigrateFallbackError 而非冒泡裸 JSON parse error
        throw new MigrateFallbackError(id, obj.schema_version, schema.schemaVersion, migrateErr as Error);
      }
    } else {
      throw e;
    }
  }

  return schema.schema.parse(data);
}

// v1.2 ACL 实现核心
class StorageAclService {
  async assertCanRead(obj: StorageObject, ctx: OwnerContext): Promise<void> {
    // 1. 同 user 直读
    if (obj.owner_user_id === ctx.userId) return;
    // 2. 同 workspace 且 caller 是 workspace member（业务 RBAC 上层校验）
    if (obj.owner_workspace_id && obj.owner_workspace_id === ctx.workspaceId) return;
    // 3. admin role 可读所有（含 audit 审查）
    if (ctx.roles?.includes('admin')) return;
    throw new ForbiddenError(`user ${ctx.userId} cannot read storage object ${obj.id}`);
  }

  async assertCanDelete(obj: StorageObject, ctx: OwnerContext): Promise<void> {
    // GDPR / user-request 必须是 owner；admin-purge 必须是 admin role
    if (obj.owner_user_id === ctx.userId) return;
    if (ctx.roles?.includes('admin')) return;
    throw new ForbiddenError();
  }
}
```

### 6.5 Mixed-Source Scan（v1.4 修订：tombstone 旁路 + ACL null guard + hydrate 类型）

```typescript
async scan<T>(scope, archiverName, schema, ownerContext) {
  const archiver = this.archivers.get(archiverName);
  const expectedId = archiver.idTemplate(scope);  // v1.2: 业务侧明确模板，不靠 startsWith
  const obj = await this.prisma.storageObject.findFirst({ where: { id: expectedId } });

  // v1.4 修订（Security P1-1 / Reviewer P1）：tombstone 行业务侧不可见，等同未归档
  const effectiveObj = obj && obj.current_tier !== 'deleted-pending-cleanup' ? obj : null;

  // v1.2 修复 P1-C：effectiveObj 为 null 时跳过 storage 层 ACL，由业务方 archiver 在 scanMixed 内自行校验 scope 归属
  if (effectiveObj) {
    await this.acl.assertCanRead(effectiveObj, ownerContext);
  }

  // v1.4 修订（Reviewer P1 / Architect P1）：hydrate 用 OneShotHydrate 品牌类型 + once-flag runtime 探针
  const hydrate = buildHydrate<T[]>(async () => {
    if (!effectiveObj) return [] as T[];
    let raw = await this.adapters[effectiveObj.current_tier].read(effectiveObj.uri);
    if (effectiveObj.encrypted) raw = await this.encryptor.decrypt(JSON.parse(raw));
    return archiver.deserialize(raw, effectiveObj.schema_version, schema.schemaVersion);
  });

  const result = await archiver.scanMixed(scope, hydrate);

  // v1.4 修订（Reviewer P1）：scan 结果必须能通过 schema.parse；archiver.scanMixed 实现者
  // 须保证返回值严格匹配 VersionedSchema.schema 的形状（不插入 audit 标签等业务字段，
  // 或显式声明 schema 用 .passthrough()）。spec 加 scanMixed 输出 schema-parse 通过断言。
  return schema.schema.parse(result);
}
```

### 6.6 GDPR / 删除路径（v1.4 修订：tombstone return + 不静默吞 + URI hash + legal_hold）

```typescript
async delete(id, ownerContext, reason): Promise<DeleteResult> {
  const obj = await this.prisma.storageObject.findFirst({ where: { id } });
  if (!obj) return { status: 'deleted' };

  // v1.4 修订（Reviewer P1）：tombstone 行业务侧表现等同已删
  if (obj.current_tier === 'deleted-pending-cleanup') return { status: 'deleted' };

  await this.acl.assertCanDelete(obj, ownerContext);

  // v1.2 修复 Security P1-3：legal_hold 不再被 GDPR 自动覆盖
  if (obj.legal_hold) {
    const eventId = await this.audit.write({
      entityType: 'storage',
      entityId: id,
      action: 'delete.legal-hold-blocked',
      actorKind: 'user',
      actorId: ownerContext.userId,
      payload: { reason, legalHoldReason: obj.legal_hold_reason },
    });
    // 通知合规审批通道
    await this.notify.toLegalAdmin({
      kind: 'gdpr-vs-legal-hold-conflict',
      objectId: id,
      reason,
      auditEventId: eventId,
    });
    return { status: 'pending-legal-review', reason: 'legal-hold-active', auditEventId: eventId };
  }

  // v1.2 实装承诺：同时跑 orphan scan for 该 id 命中的所有 prefix（解决 Reviewer P1-B）
  await this.orphanScanner.scanForObject(obj);

  // v1.4 修订（Reviewer P0-R2/P0-R3 + Security P1 关键路径）：
  //   - R2 删成功 + DB 删失败 → 落 tombstone + return { status:'partial-tombstoned' } 而非 throw
  //   - tombstone update 也失败 → 必须独立 audit + critical metric + 抛 PartialDeleteError（绝不静默吞）
  //   - formerUri 在 audit payload 中 hash + 截短（Security P1：admin 可读 audit，URI 含 {userId}/... 二次泄露面收窄）
  let r2Deleted = false;
  try {
    await this.adapters[obj.current_tier].delete(obj.uri);
    r2Deleted = true;
    await this.prisma.storageObject.delete({ where: { id } });
    await this.audit.write({
      entityType: 'storage',
      entityId: id,
      action: 'deleted',
      payload: { reason, formerUriHash: hashUri(obj.uri) },  // v1.4：hash 不明文
    });
    return { status: 'deleted' };
  } catch (e) {
    if (r2Deleted) {
      // R2 删成功 + DB delete 失败 → 落 tombstone
      try {
        await this.prisma.storageObject.update({
          where: { id },
          data: {
            current_tier: 'deleted-pending-cleanup',
            uri: '__deleted__',
            delete_after: new Date(),
            updated_at: new Date(),
          },
        });
        const auditEventId = await this.audit.write({
          entityType: 'storage',
          entityId: id,
          action: 'delete.partial',
          payload: { reason, error: e.message, formerUriHash: hashUri(obj.uri), tombstoned: true },
        });
        this.metrics.inc('storage_delete_partial_tombstoned_total', { policy: obj.policy_name });
        // v1.4 修订：return partial-tombstoned，不再 throw（caller 可感知 + cron 兜底收敛）
        return { status: 'partial-tombstoned', reason: 'db-delete-failed-r2-already-deleted', auditEventId };
      } catch (tombstoneErr) {
        // 三重失败：R2 删成功 + DB delete 失败 + DB tombstone update 也失败
        // 不静默吞——独立 audit + critical metric + 抛特定错误类型（Reviewer P0-R3）
        await this.audit.write({
          entityType: 'storage',
          entityId: id,
          action: 'delete.tombstone-update-failed',
          payload: {
            reason,
            originalError: e.message,
            tombstoneError: (tombstoneErr as Error).message,
            formerUriHash: hashUri(obj.uri),
          },
        }).catch(() => {/* audit 也失败：依赖 metric 触发告警 */});
        this.metrics.inc('storage_delete_triple_failure_total', { policy: obj.policy_name });
        // PagerDuty critical alert 由 metrics 告警规则触发（§7.3 v1.4 新增）
        throw new PartialDeleteError(id, {
          r2Deleted: true,
          dbDeleted: false,
          tombstoned: false,
          originalError: e,
          tombstoneError: tombstoneErr as Error,
        });
      }
    } else {
      // R2 删都没成功，DB 行未动 —— 安全可重试
      await this.audit.write({
        entityType: 'storage',
        entityId: id,
        action: 'delete.failed',
        payload: { reason, error: e.message },
      });
      throw e;  // caller 可重试
    }
  }
}
```

> **v1.3 修订（P0-3） / v1.4 重写（Reviewer P0-R2/R3 + Security P1）**：
>
> 1. **R2 删成功 + DB 删失败 + tombstone 成功**：return `{ status: 'partial-tombstoned' }`，**不再 throw**——caller 拿到明确信号，cron 下一轮按 `current_tier='deleted-pending-cleanup'` 兜底收敛（§6.1 v1.4 修订）；
> 2. **三重失败（tombstone update 也失败）**：独立 audit `delete.tombstone-update-failed` + metric `storage_delete_triple_failure_total` + 抛 `PartialDeleteError`（区别于原始 e），触发 PagerDuty critical alert；**不再 `.catch(()=>{})` 静默吞**；
> 3. **formerUri hash + 截短**：audit payload 不写明文 URI，避免 admin 读 audit 时二次泄露 `{userId}/...` 路径结构（Security P1）；
> 4. **R2 删失败**：DB 未动，直接 throw 让 caller 重试。
>
> `storage_objects.current_tier` 的枚举值由 §5.2 CHECK 约束强制为 `('warm', 'cold', 'deleted-pending-cleanup')`；tombstone 仅 cron / facade 内部可见，业务读 get() / scan() / statusOf() 看到此 tier 一律返回 NotFoundError（详见 §6.4 / §6.5 / §11）。

---

## 7. 可视化 / 可管理 / 可监控 / 可审计

### 7.1 可视化（admin/storage UI — v1.2 修正 tab 数）

**最终 6 tab = 3 现有 + 3 新增**：

| 现有保留                       | 新增                                                                 |
| ------------------------------ | -------------------------------------------------------------------- |
| Pipeline（field offload 进度） | Lifecycle Overview（取代 DB Footprint，数据切到 storage_objects 表） |
| Catalog（R2 prefix 实际分布）  | Policies（policy 列表 + 启用 / 命中数 / last cron）                  |
| Trend（30d 体量走势）          | Objects（单对象 ID 搜索 + tier 时序 + audit 轨迹）                   |

**移除**：DB Footprint（被 Lifecycle Overview 取代，数据来源同源）

### 7.2 可管理（v1.3 RBAC 细分 + 双签 override）

| 操作                                    | 角色                                     |
| --------------------------------------- | ---------------------------------------- |
| 看面板 / 看 audit                       | `admin`                                  |
| 单对象推转 / 召回                       | `admin`                                  |
| policy 启用 / 禁用                      | `admin`                                  |
| policy 编辑（warmAfter / coolAfter）    | `admin`                                  |
| **强制 delete object**                  | `admin`                                  |
| **设置 legal_hold**                     | `legal-admin`（独立 role）               |
| **自己解除自己设的 legal_hold**         | `legal-admin`（setter 本人）             |
| **解除别人设的 legal_hold（override）** | **2 个 `legal-admin` 联签**（v1.3 P1-4） |
| **审计导出**                            | `admin` + 自身写一条 audit-of-audit      |

新建 destructive endpoints 必须 `JwtAuthGuard + @Roles(...)`，不再用现有 `StorageGovernanceController` 的 `@Public + x-admin-key` 模式（Round 1 Security P1）。

> **v1.3 修订（P1-4） / v1.4 落地细节（Security P1 + Reviewer P1）—— legal-admin 互锁逃生通道**：v1.2 写"legal-admin 能 set 但不能 unset 别人设的 hold"会在 setter 离职 / 失能时产生**永远无法解除的 hold**，本身就是合规风险。v1.3 引入双签 override；v1.4 把实现机制完整化：
>
> **正常路径**：legal-admin A 设的 hold，只有 A 自己可以 unset（`POST /storage/objects/:id/legal-hold/unset`）。
>
> **override 路径**（B 发起 + C 协签）：
>
> 1. C 调 `POST /audit/co-signer-tokens`（payload: `{ targetHoldId, expiresInSec: 900 }`）→ 服务端生成 `coSignerToken = crypto.randomBytes(32).toString('base64url')`（**不是 JWT**——JWT 一旦签发无法撤销；用 random opaque + Redis SETNX 存储，scope 严格绑定 `targetHoldId + cosigner.userId`）
> 2. Redis key `legal-hold:override:cosigner-token:{token}` value 含 `{ cosignerUserId, targetHoldId, expiresAt }`，TTL 15min
> 3. B 调 `POST /storage/objects/:id/legal-hold/override` body `{ coSignerToken }`,服务端原子 `GETDEL`（保证一次性消费）+ 校验：
>    - token 存在且未过期
>    - `cosignerUserId !== requesterUserId`（同一 legal-admin 不能两次签名，**仅限本次 override 请求范围**）
>    - `targetHoldId === :id`（防止 token 被复用到其他 hold）
>    - C 当前账号 `status='active'` 且 `last_login < 30d` 且 `roles` 当前实时含 `legal-admin`（**不用 JWT cached role**，必须查 DB 防止离职后 token 仍可用）
>    - B 自身 roles 含 `legal-admin`
> 4. 双签 override 在 `common_audit_log` 写 `action: 'legal-hold.override'`，payload 含两个 legal-admin 的 userId + 原 hold setter 的 userId + 原 reason + override reason，永久可追溯
> 5. **通知**:override 成功后,被 override 的 hold 原 setter（如仍在岗）必须收到通知（防 collusion 无察觉）
> 6. **并发幂等**：两个 B 同时持同一 token 时，`GETDEL` 的原子性保证只有一个成功；audit 不写双份
> 7. **失败行为**：上述任一校验失败抛 `LegalHoldOverrideError`，详细原因落 audit（不写 token 本身）
>
> spec 边界覆盖（§11 v1.4）：token 过期 / 同 admin 自签 / token 复用到其他 hold / cosigner 已离职 / cosigner 失去 legal-admin role / 并发 override 幂等 / 原 setter 通知到达 7 条。
>
> PR-S11a 后端实现（见 §8 v1.4 PR 表），PR-S11b 前端 B 发起 + C 确认 UI。

### 7.3 可监控（v1.4 新增告警）

接入现有 `common/observability/MetricsService`，告警规则在现有 alert 配置：

- 迁移失败率 1h > 5% → warn
- HOT 数据 > 5 GB → warn
- cron 36h 未跑 → critical
- legal_hold 数量月增 > 50 → 通知 legal-admin
- **`storage_delete_triple_failure_total` > 0**(v1.4)→ **PagerDuty critical**（R2 已删 + DB 删失败 + tombstone update 也失败的三重失败，需运维立即介入）
- **`storage_delete_partial_tombstoned_total` 1h > 0** (v1.4)→ warn（partial-tombstoned 由 cron 兜底，但持续增长说明 DB 不健康）
- **`storage_hot_archive_overdue_total{archiver}` > 0**(v1.4 / Security P1)→ warn（按 archiver 声明的 maxHotAge 检测 HOT 滞留；见 §7.5）
- **`storage_encryption_boot_test_ok{keyId}` = 0**(v1.4)→ critical（加密 key 不可用，启动失败）

### 7.4 可审计

- 所有 transition / hydrate / delete / orphan / legal-hold-set / **legal-hold-override**（v1.4）/ audit-export 写 `common_audit_log`
- schema-level RULE INSERT only + spec test 断言
- 保留期 7 年（明示依据：金融行业最严格 + GDPR 处理记录 Article 30）
- entityType 级 RBAC（admin 看 storage / story-bible 等不同业务域可独立配 role）
- legal-admin 解锁规则（v1.3 P1-4 / v1.4 落地）：setter 本人可 unset 自己设的 hold；他人设的 hold 必须 2 个 legal-admin 联签 override（详见 §7.2 v1.4）；spec 双向覆盖
- **audit 行 `legal_hold` 列的 setter 权限**（v1.4 / Security P2）：`common_audit_log.legal_hold` 列**仅**由 `setLegalHold` 内部在写入"audit-of-hold"新行时置 `true`；不允许任何 API 对**已存在的他人 audit 行**后设 legal_hold（schema 层无 UPDATE RULE 已保证；应用层进一步禁止 `setLegalHold(existingAuditEventId)` 入参形式）

### 7.5 HOT 滞留 watchdog（v1.4 新增 / Security P1）

> **背景**：v1.3 P0-1 删除 `policy.archiveAfter` 后，HOT→WARM 100% 业务事件驱动。业务方忘发 `archive()` 事件 → 数据永远留 HOT DB，storage 层 100% 无感知，GDPR 删除指令也只覆盖已归档对象。这本身是 PII 滞留风险。

**实施**：

- 每个 IArchiver 注册时声明 `maxHotAge: Duration`（如 mission-events `180d`、wiki-revisions `365d`）
- LifecycleManager 每日 cron 独立扫描业务表 **仅读 PK + created_at 列**（不触碰内容字段，storage 层仍不读 PII）：
  ```sql
  SELECT COUNT(*) FROM agent_playground_mission_events
  WHERE mission_id NOT IN (SELECT id FROM storage_objects WHERE policy_name='agent-playground-events')
  AND created_at < NOW() - INTERVAL '180 days'
  ```
- 命中行数写 metric `storage_hot_archive_overdue_total{archiver}`，> 0 触发 warn 通知业务 owner
- spec：超期未归档 mission 写入 → metric 增加 + 业务 owner 收到 alert

---

## 8. PR 实施序列（v1.4 重排）

> **v1.4 工期重估摘要**：v1.3 估 28-30d 基于错误前提（30+ caller / 6 raw SQL）；v1.4 重估为 **23-27d**。
>
> - PR-A0.5 caller 数实测下修：30+ → 3 service / 8 处调用（AuditService 类对外签名不动）→ 工期 3-5d → **1-1.5d**
> - PR-A0a 因新建 `AuditMetadataInterceptor`（v1.3 误以为现有）上调 0.5d
> - PR-S4 raw SQL 实测 6 → 11 个 target，但同构 SQL 抽 helper 可一次性覆盖 → 工期 0.75d × 4 → **0.5d × 4**
> - PR-S2 因 storage_objects 整表新建 + DB CHECK 约束 + Tier 联合类型同步 +0.5d
> - PR-S9.5 新增"secret-keys.service tier 列扩展" 前置 +0.5d
> - PR-S11 拆 a/b（后端 + 前端）保持总和不变

### Phase 0：项目级前置（v1.4 重估）

| PR          | 内容                                                                                                                                                                                                                                                                                                                                                                      | 工作量                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **PR-A0a**  | `common/audit/abstractions/`（IAuditLogService 契约 + AuditEvent 类型 + AuditAction → entityType/action 映射表骨架 + 完整性断言）+ `common/audit/audit.decorator.ts`（从 audit.service.ts 拆出 @Audit + AuditAction enum 24 个值；audit.service.ts re-export 保持向后兼容）+ **`AuditMetadataInterceptor` 新建**（v1.4 修订：现 prod 代码 0 个 interceptor 读 AUDIT_KEY） | **1 天**（v1.4 ↑0.5d）      |
| **PR-A0b**  | `PersistentAuditService` 实装（DB 表 + RULE + 月分区 + entityType RBAC + legal-hold + payload redactor）；现 `audit.service.ts` 内部委托 `PersistentAuditService.write()`；caller 端 8 处调用点**无需修改**                                                                                                                                                               | 2 天                        |
| **PR-A0.5** | 端到端 spec 覆盖：3 service / 8 处生产调用（admin × 4 + ai-teams × 3 + ai-response × 1）回归 + `@Audit` 装饰器触发的 audit 落 `common_audit_log` 表 + AuditAction 24 enum 完整性 spec + payload redactor allowlist spec                                                                                                                                                   | **1-1.5 天**（v1.4 大幅 ↓） |

**Phase 0 合计：4-4.5 天**（v1.3 估 5.5-7.5d 偏高；v1.4 caller 数实测下修主导）

### Phase 1：抽象骨架

| PR             | 内容                                                                                                                                                                                                              | 工作量                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **PR-S1**      | 目录 + abstractions（StorageFacade / OwnerContext / IArchiver / VersionedSchema / LifecycleTarget / IEncryptor / PublicTier / InternalTier）+ ArchiverRegistry 骨架                                               | 1 天                           |
| **PR-S2**      | DB migration（storage_lifecycle_policies / **storage_objects 整表新建（v1.4 Arch-Auditor 拍到，无 alter enum 风险）** + owner 列 + 月分区 + `current_tier CHECK ('warm','cold','deleted-pending-cleanup')` 约束） | **1.5 天**（v1.4 ↑0.5d）       |
| **PR-S3**      | LifecycleManagerService 骨架 + R2WarmAdapter / R2ColdAdapter（含 copyIfNotExists 幂等）                                                                                                                           | 1.5 天                         |
| **PR-S4-prep** | **v1.4 新增**：提取 `executeOffloadCommit(table, field, ...)` helper 覆盖 11 个 `$executeRawUnsafe` 同构 SQL；spec 覆盖 11 target 单元测试                                                                        | 1 天                           |
| **PR-S4a-S4d** | 12 个 OFFLOAD_TARGETS 拆 4 PR 改造（每 PR 3 target）；接入 PR-S4-prep helper 后改造量集中；**实测 11 个 target 用 `$executeRawUnsafe`**（v1.4 修订，v1.3 误写 6 个）                                              | **4 × 0.5 = 2 天**（v1.4 ↓1d） |
| **PR-S5**      | RowArchiveTarget + sample IArchiver                                                                                                                                                                               | 1 天                           |

**Phase 1 合计：8 天**（v1.3 7.5 天；v1.4 抽 helper 后 PR-S4 -1d、PR-S2 +0.5d、新增 PR-S4-prep +1d，净 +0.5d；但改造质量大幅提升）

### Phase 2：业务接入 + 加密 + 监控

| PR           | 内容                                                                                                                                                              | 工作量 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **PR-S6a**   | MissionEventsArchiver 实现（含 idTemplate / scanMixed / encryption.enabled）+ 注册                                                                                | 1.5 天 |
| **PR-S6b**   | MissionEventsService 改造：`findByMission` 调 `storage.scan`；活跃 mission 走原 in-memory + DB（互斥条件 + spec test）                                            | 2.5 天 |
| **PR-S7a**   | Backfill dry-run 脚本（独立 advisory lock key）                                                                                                                   | 0.5 天 |
| **PR-S7b**   | Backfill 正式（分批 + 续传游标 in storage_objects.backfill_cursor + 失败可恢复）                                                                                  | 1 天   |
| **PR-S8**    | Audit 接入：所有 transition / hydrate / delete / orphan / archive / legal-hold-set / audit-export 写 `PersistentAuditService`                                     | 1 天   |
| **PR-S9**    | Metrics 注册 + 健康检查 + 告警规则                                                                                                                                | 0.5 天 |
| **PR-S9.5a** | **v1.4 新增**：`secret-keys.service.ts` 加 `tier` 列扩展（system / user-tenant；v1 全 `'system'`）+ `getInfo(keyId)` 接口 + `IllegalKeyTierTransitionError` 守卫  | 0.5 天 |
| **PR-S9.5b** | ApplicationLayerEncryptor 实现（v1 仅 system-tier 校验 + boot-test round-trip 健康检查 + fixture 隔离）+ topic_reports / mission_events / wiki revisions 接入加密 | 1.5 天 |

**Phase 2 合计：9 天**（v1.3 8.5 天；v1.4 PR-S9.5 拆 a/b 拆出 secret-keys tier 列扩展 +0.5d）

### Phase 3：admin UI + RBAC

| PR          | 内容                                                                                                                                                                                                                | 工作量 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **PR-S10**  | admin UI 新增 3 tab（Lifecycle Overview / Policies / Objects）；移除 DB Footprint；6 tab 总                                                                                                                         | 4 天   |
| **PR-S11a** | **v1.4 拆出后端**：destructive endpoints + JwtAuthGuard + Roles（admin / legal-admin 二级 + 双签 override 接口 + coSignerToken 机制）+ IStorageFacade.setLegalHold / unsetLegalHold / overrideLegalHold + RBAC spec | 1.5 天 |
| **PR-S11b** | **v1.4 拆出前端**：legal-hold UI + 双签 override UI（B 发起 + C 确认 + token 有效期可视化）                                                                                                                         | 1 天   |

**Phase 3 合计：6.5 天**（与 v1.3 相同；v1.4 PR-S11 拆 a/b 不变总量；Arch-Auditor P1 拆分要求）

### **总工作量：v1.4 = 23-27 工作日**（v1.3 估 28-30d 基于错误前提；v1.4 实测下修 caller 数与 raw SQL 数主导 -3d~-5d；新增 interceptor / helper / IStorageFacade 方法 / secret-keys tier 列补偿；Phase 加总 4-4.5 + 8 + 9 + 6.5 = 27.5-28d，并行边界压缩到 23-27d 见 §10.1）

---

## 9. 风险与对策

| 风险                                              | 影响                        | 对策                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 透明 hydrate 失败 → 业务读 null                   | mission replay 假成功       | adapter 失败抛具体错（404 / timeout）；facade 不静默吞                                                                                                                                                    |
| transition 双写孤儿                               | DB+R2 不一致                | §6.2 commit-then-delete + audit pending + §6.3 orphan scanner                                                                                                                                             |
| GDPR delete + legal_hold 冲突                     | 合规进退两难                | §6.6 抛 `pending-legal-review` 通知合规人工决策，不自动                                                                                                                                                   |
| Cloudflare 内部副本                               | 物理删除不可证              | v1 文档明示限制；BYOK 物理删除证明列为 v2 单独立项（不在 backlog 含混留）                                                                                                                                 |
| Cron pod SIGKILL                                  | 半完成 transition           | audit pending + 下次 cron + orphan scanner                                                                                                                                                                |
| backfill 90K 一次跑挂                             | 状态混乱                    | dry-run + 分批续传 + 独立 lock                                                                                                                                                                            |
| policy 写错                                       | 数据立即降温                | zod 校验 + spec test                                                                                                                                                                                      |
| R2 配额超                                         | 上传失败                    | metric 告警 + adapter 抛 quota error                                                                                                                                                                      |
| R2 key path traversal                             | 跨租户                      | `sanitizeKeySegment` helper + spec test                                                                                                                                                                   |
| 跨租户 IDOR                                       | 数据泄露                    | `storage_objects.owner_user_id` + `assertCanRead` 真实比对 + spec test                                                                                                                                    |
| ticketId 枚举                                     | 信息泄露                    | `getHydrateStatus` 强制 `ownerContext` 校验                                                                                                                                                               |
| legal-admin 滥用                                  | 越权                        | 解锁他人设的 hold 必须双 legal-admin 联签 override（v1.3 P1-4 修订）；所有变更写 audit                                                                                                                    |
| 单 legal-admin 失能/离职导致 hold 永久无法解除    | 合规死锁                    | v1.3 P1-4 双签 override 路径：任意 2 个 legal-admin 联签可强解；override 写永久 audit                                                                                                                     |
| 应用层加密 key 丢失                               | 归档对象不可读              | secret-keys.service 多副本 + 启动 boot-test round-trip + alert（v1.4 修订：fixture 隔离）                                                                                                                 |
| 应用层加密 keyId tier 被降级                      | 历史加密对象不可读          | v1.4：`secret-keys.service.update` 守卫，system→user-tenant 直接抛 `IllegalKeyTierTransitionError`，必须走 key 轮换 + 重加密流程                                                                          |
| audit 表跨业务域看见                              | 合规违规                    | entityType 级 RBAC + admin 导出再写一条 audit-of-audit                                                                                                                                                    |
| audit 行 legal_hold 被滥用屏蔽证据                | 反合规                      | v1.4：`legal_hold` 仅 setLegalHold 内对**新写入**审计行置位，不允许后设他人 audit 行                                                                                                                      |
| @Audit logArgs 入 audit payload 泄露 PII / secret | 7 年保留期内合规漏洞        | v1.4：deny-by-default + 显式 allowlist + redactor 二次过滤（命中 sensitive key 强行 redact）                                                                                                              |
| AuditAction 映射表新增 enum 漏映射                | 静默审计黑洞                | v1.4：启动完整性断言 + map miss 抛 `UnmappedAuditActionError`                                                                                                                                             |
| 单 vendor R2 故障                                 | WARM/COLD 不可用            | SLA: 24h 内业务 fallback 走 DB（已归档对象返回 NeedsHydrationError，业务 surface）                                                                                                                        |
| `common/audit/AuditService` 命名冲突              | 现有 caller 断              | v1.4：`AuditService` 类对外签名保持不变（9 convenience methods 保留），底层委托 `PersistentAuditService.write`；3 service / 8 处 caller 零改动；`@Audit` 装饰器拆到 `audit.decorator.ts` 但保留 re-export |
| **HOT→WARM 业务忘发 archive() 事件**              | **PII 永久滞留 DB**         | **v1.4 / Security P1**：§7.5 HOT 滞留 watchdog 按 archiver `maxHotAge` 每日扫业务表 PK 列（不读内容）超期触发 alert                                                                                       |
| **delete partial 三重失败**                       | DB 行残留 + R2 已删，幽灵态 | **v1.4 / Reviewer P0**：`storage_delete_triple_failure_total` metric → PagerDuty critical；抛 `PartialDeleteError` 区别原 e                                                                               |
| **PR-A0.5 caller 数估错**                         | 工期排期失真                | v1.4 修订：实测 3 service / 8 处调用（非 30+），PR-A0.5 工期 3-5d → 1-1.5d，§9 列项防再误估                                                                                                               |
| **`AuditMetadataInterceptor` 不存在被误以为现有** | 装饰器路径设计空跑          | v1.4 / Arch-Auditor 拍到：PR-A0a 必须**新建** interceptor，含 reflector 读 `AUDIT_KEY` + 映射表 + redactor 三段路径                                                                                       |
| **double `archive()` 调用幂等**                   | 同 mission 被归档两次       | v1.4：archive() 内部 `prisma.storageObject.upsert` + `archiverName + scopeId` 唯一约束保证幂等                                                                                                            |

---

## 10. 与项目现有架构的关系

### 10.1 层级归属

```
L4 Open API / L3 AI Apps                              ← 调 storage facade + 实现 IArchiver
              ↓
L2.5 AI Harness / L2 AI Engine                        ← 不直接消费
              ↓
L1 platform/storage（facade + lifecycle + adapters + encryption）
       │
       ├ 依赖 [PR-A0 改造后的] L1 common/audit （v1.3 修订 P2-3：不是单纯消费，PR-A0a/b/0.5 深度改造）
       ├ 依赖 L1 common/observability/MetricsService
       └ 依赖 L1 common/secrets （key resolver）
```

> **v1.3 修订（P2-3） / v1.4 量化（Architect P1）**：v1.2 层级图把 `common/audit` 列为"依赖"会误导 reviewer——`common/audit` 在 PR-A0 阶段会经历"加 PersistentAuditService + 3 service / 8 处 caller 端到端 spec + AuditMetadataInterceptor 新建"的深度改造，并非 platform/storage 单向消费。
>
> **v1.4 PR 并行边界（Architect P1：避免被读为单线 27.5-28d）**：
>
> ```
> PR-A0a ─┐
> PR-A0b ─┼─→ PR-A0.5  ──┐
>          │              ├──→ PR-S6/S7/S8（audit 接入路径）
>          │              │
>          └──→ PR-S1 ─→ PR-S2 ─→ PR-S3 ─→ PR-S4-prep ─→ PR-S4a-d ─→ PR-S5
>                                                       └──────────→ PR-S9/S9.5/S10/S11
> ```
>
> - PR-S1（纯 abstractions）/ PR-S2（DB migration）/ PR-S3（adapter 骨架）**完全不依赖 audit**，可与 PR-A0a/b 并行
> - PR-S4-prep / PR-S4a-d / PR-S5（target 改造）只依赖 PR-S2/S3，不依赖 audit
> - 仅 PR-S6/S7/S8（audit 接入）必须等 PR-A0.5 完成
> - 双人并行可压缩到 **23-25d**；单人线性 27.5-28d
>
> 这条依赖链有两阶段：(1) PR-A0a/b/0.5 改造 `common/audit` 自身；(2) PR-S6+ 接入改造后的 `common/audit`。

### 10.2 端口模式（合法 adapter）

业务方实现 `IArchiver` 注册到 `ArchiverRegistry`。

> **v1.4 修订（Architect P2）—— 与 SkillRegistry / ToolRegistry 的关系澄清**：v1.3 写"一致"措辞模糊。实测 `SkillRegistry` / `ToolRegistry` 都继承通用 `BaseRegistry`（CRUD 注册模式）。`ArchiverRegistry` 同样继承 `BaseRegistry`，但**额外**带 `schemaVersion` 校验 + `idTemplate(scope)` 反查 + `encryption.keyId` 注册时 tier 校验等 storage 专属约束。与 SkillRegistry 是"同基类，超集行为"的关系，非完全等价。
>
> **ESLint `no-restricted-imports` 现状**（v1.4 / Arch-Auditor 拍到）：backend `.eslintrc.js:114-411` 限制 `axios` 和 `ai-engine` 内部 import，**没有 storage 层专属限制**。PR-S1 内需自加规则禁止业务方直接 import `r2-warm.adapter.ts` / `r2-cold.adapter.ts` 等 adapter，强制走 facade。

### 10.3 现有代码迁移路径

- 现 12 个 OFFLOAD_TARGETS → PR-S4a-S4d 拆 4 PR 改造
- 现 `StorageOffloadService.runOnce` → 改名 `LifecycleManagerService.runOnce`，alias export 兼容
- 现 `storage-inventory.service.ts` → 切到 `storage_objects` 表（双轨并跑 1 周校验）
- 现 `MissionEventBuffer` in-memory + DB → PR-S6b 显式区分双路径
- 现 `common/audit/audit.service.ts`（内存版）→ 重命名 + 新建 `PersistentAuditService`
- **v1.4 修订（v1.3 P0-2 论据重写 + Arch-Auditor 拍到 interceptor 不存在）—— `@Audit` 装饰器与 AuditService 迁移路径**：
  - **现状实测**：`AuditAction` enum **24 个值**（不是 25+）；类内 convenience method **9 个**（不是 30+）；外部 caller **3 个 service / 8 处生产调用**（admin × 4 + ai-teams × 3 + ai-response × 1）；`AUDIT_KEY` 装饰器 metadata **0 个 interceptor / guard 读取**
  - **重构核心方针**：`AuditService` **类对外签名保持不变**（9 个 convenience methods 全部保留），底层 `this.log()` 委托给 `PersistentAuditService.write()`；外部 8 处 caller **零改动**
  - `@Audit(AuditAction.XXX)` 装饰器 + `SetMetadata(AUDIT_KEY)` + `AuditAction` enum 从 `audit.service.ts` 拆到 `common/audit/audit.decorator.ts`；`audit.service.ts` 加 `export { Audit, AuditAction } from './audit.decorator'` 保持现有 7 个 caller 文件的 import 路径不破（Arch-Auditor P1 修复）
  - **新建 `AuditMetadataInterceptor`**（v1.4 修订；PR-A0a 内）：reflector 读 `AUDIT_KEY` → 通过 `AuditAction → { entityType, action }` 映射表语义转换 → 调 `PersistentAuditService.write()`；spec 覆盖装饰器 → 落表端到端路径
  - `AUDIT_ACTION_MAP` 静态 24 条映射（PR-A0a 内）；启动时完整性断言：`Object.keys(AuditAction).length === Object.keys(AUDIT_ACTION_MAP).length`；map miss 抛 `UnmappedAuditActionError`（防静默审计黑洞）

---

## 11. 验证标准（实施完毕后）

- [ ] `agent_playground_mission_events` 90d 前的行 < 1000 行
- [ ] DB 总量在 mission 翻倍时**不**线性增长
- [ ] `storage.scan(...)` 返回完整 events（DB+R2 merge），spec 覆盖 backfill 前后两侧
- [ ] `storage.get<T>(id, schema, ctx)` 拒绝 `as T` 调用，所有 caller 必传 VersionedSchema
- [ ] `storage.get(id, schema, wrongUserCtx)` 抛 `ForbiddenError`，spec 覆盖
- [ ] `storage.delete(id, ctx, 'gdpr')` 同步删 R2 std + IA + DB，spec 覆盖
- [ ] `delete()` 命中 legal_hold 返回 `pending-legal-review`，不自动覆盖，spec 覆盖
- [ ] `getHydrateStatus(ticketId, otherUserCtx)` 抛 `ForbiddenError`，spec 覆盖
- [ ] `common_audit_log` UPDATE / DELETE 0 行影响（RULE 强制），spec 断言
- [ ] `legal_hold = true` 对象不被 cron 删除，spec 覆盖
- [ ] R2 key 含 `..` / `/` 注入被拒，spec 覆盖
- [ ] orphan scanner 识别 transition 半完成产生的旧 URI 副本并清理，spec 覆盖
- [ ] 应用层加密：`encrypted = true` 对象 R2 read 后 plaintext 不出现在 audit log
- [ ] `setLegalHold` 仅 `legal-admin` role 可调用，spec 覆盖
- [ ] `audit export` 必须 admin role 且自身写 audit，spec 覆盖
- [ ] `entityType` 级 RBAC：caller role 不在 AUDIT_ROLE_MAP 抛 ForbiddenError，spec 覆盖
- [ ] Prom metrics 标签基数 < 100
- [ ] **v1.4 P0-2 改为**：`AuditService` 类对外签名保持不变；内部委托 `PersistentAuditService.write` 后，3 service / 8 处生产 caller 行为不变；端到端 spec 覆盖 8 处调用 + `@Audit` 装饰器路径
- [ ] **v1.3 P0-3 / v1.4 修订**：`delete()` R2 删成功 + DB 删失败时返回 `{ status: 'partial-tombstoned', auditEventId }` 而非 throw；DB 行 `current_tier = 'deleted-pending-cleanup'`、`uri = '__deleted__'`、`delete_after = now()`；下一轮 cron tombstone 收敛分支删除该行；spec 覆盖
- [ ] **v1.4 P0-3 三重失败**：R2 删 + DB delete + tombstone update 三步均失败时，独立 audit `delete.tombstone-update-failed` + metric `storage_delete_triple_failure_total` 增 1 + 抛 `PartialDeleteError`；不静默吞；spec 注入 DB / R2 failure 验证
- [ ] **v1.4 修订**：`current_tier='deleted-pending-cleanup'` 的对象在 `get()` / `scan()` / `statusOf()` / `delete()` 四条路径**一致**返回 `NotFoundError` 或等同已删行为；spec 四路覆盖（Security P1 / Reviewer P1）
- [ ] **v1.4 P0-2 / Arch-Auditor**：`@Audit(AuditAction.XXX)` 装饰器触发的 audit 经 `AuditMetadataInterceptor` 落 `common_audit_log`；`AUDIT_ACTION_MAP` 24 条映射完整性断言（`Object.keys(AuditAction).length === Object.keys(AUDIT_ACTION_MAP).length`）；map miss 时抛 `UnmappedAuditActionError`，spec 覆盖
- [ ] **v1.4 / Security P1**：`@Audit({ logArgs: { fields: [...] } })` 必须显式 allowlist；redactor 命中 `/password|token|secret|apiKey|plaintext/i` key 强行 redact；spec 覆盖 deny-by-default + 误填 sensitive key 被拦
- [ ] **v1.3 P0-1**：cron `runOnce()` 不扫业务 HOT 表；HOT→WARM 100% 业务事件 `storage.archive()` 触发；spec 验证 cron 在无 storage_objects 行时空跑
- [ ] **v1.4 P0-1 / 自洽 bug 修复**：`findDueForDelete` SQL 必须含 `AND current_tier IN ('warm','cold')`；spec 注入 tombstone 行验证不被命中且不抛 TypeError
- [ ] **v1.4 / Security P1**：HOT 滞留 watchdog 按 archiver `maxHotAge` 扫业务表 PK 列（不读内容）；超期 mission 触发 `storage_hot_archive_overdue_total{archiver}` metric + 业务 owner alert
- [ ] **v1.3 P1-1 / v1.4 修订**：`VersionedSchema.migrate` 在 `archiver.deserialize` 抛 `SchemaVersionMismatchError` 时被 facade fallback 调用；fallback 路径独立 try/catch，二次失败抛 `MigrateFallbackError`（区别首次失败）
- [ ] **v1.4 / Security P2**：archiver 注册 `encryption.keyId` 时校验 keyId 当前 tier 为 `'system'`；`secret-keys.service.update` 守卫，system→user-tenant tier 改动抛 `IllegalKeyTierTransitionError`；spec 双向覆盖
- [ ] **v1.4 / Security P1**：`ApplicationLayerEncryptor` 启动 boot-test 使用固定 fixture `'__boot_test_payload__'`（非 prod 数据）；round-trip 结果仅 boolean 上报 metric，不写日志、不入 audit；boot-test 失败启动失败
- [ ] **v1.3 P1-3 / v1.4 改写**：构造测试 archiver 故意在 `scanMixed` 内调用 `hydrate()` 两次，断言第二次抛 `HydrateReuseError`；ESLint `storage/no-hydrate-capture` 命中 `this.hydrate = ...` / 模块级 `let hydrate = ...` 报错；spec 双覆盖
- [ ] **v1.3 P1-4 / v1.4 双签 7 边界**：(a) coSignerToken 过期被拒；(b) 同 admin 自签被拒；(c) token 复用到其他 hold 被拒；(d) cosigner 已离职（`status != 'active'`）被拒；(e) cosigner 失去 legal-admin role（实时查 DB，非 JWT cached）被拒；(f) 并发 override 幂等（audit 不双写）；(g) 原 setter 收到通知；7 条 spec 全覆盖
- [ ] **v1.4 / Reviewer P0-R1**：`IStorageFacade.setLegalHold / unsetLegalHold / overrideLegalHold` 三接口契约存在并经 admin/legal-admin RBAC 校验；非 legal-admin 调用抛 `ForbiddenError`
- [ ] **v1.4 / Security P2**：`common_audit_log.legal_hold` 列仅由 `setLegalHold` 在写入 `audit-of-hold` 新行时置 true；对**已存在**他人 audit 行 setLegalHold 抛 `IllegalAuditMutationError`；spec 覆盖
- [ ] **v1.4 / Security P2**：`getHydrateStatus(ticketId, ctx)` 对 "ticketId 不存在" 与 "存在但非 owner" 返回**完全相同**的 response body + 恒定 timing；spec 用 timing oracle 测试断言 < 5ms 抖动
- [ ] **v1.4 / Security P1**：tombstone audit payload 中 URI 必须 `hashUri()` 处理（hash + 截短）；spec 验证 audit 行不含明文 URI
- [ ] **v1.4 / Reviewer P1**：`scanMixed` 返回值必须通过 `VersionedSchema.schema.parse` 严格校验；archiver 实现者插入额外字段被 zod 拒绝；spec 覆盖
- [ ] **v1.3 P1-5**：v1 加密未覆盖字段（`dimension_analyses.data_points` / `research_tasks.result` / `wiki_diffs.items` / `mission_report_versions.report_full` / `knowledge_base_documents.raw_content`）在 v1 上线后 30d 内完成敏感性审计；审计结果作为 v1.x 加密扩展 P0 的输入
- [ ] **v1.4 / Reviewer P2**：`PublicTier` / `InternalTier` 联合类型在 abstractions/lifecycle-policy.ts 落地；`options.allowTiers?: PublicTier[]` 不允许 caller 传 `'deleted-pending-cleanup'`；zod 校验 + tsc 编译期双重保证
- [ ] **v1.4 / Architect P1 + Arch-Auditor**：`@Audit` 装饰器与 `AuditAction` enum 拆到 `audit.decorator.ts`；`audit.service.ts` 通过 `export { Audit, AuditAction } from './audit.decorator'` re-export；现有 7 个 caller 文件 import 路径不破；spec 验证 ts-build 通过

---

## 12. 后续讨论点（v2 候选）

1. GLACIER tier（含同步删除能力）
2. EDGE_HOT
3. 多 vendor 适配（S3 / Azure）
4. 跨区灾备 (CDR)
5. Phase 4 接入：notifications / library 资源 / chapter_drafts / research_results
6. **BYOK + per-user 加密密钥**（独立立项）：解决"物理删除证明"——删除用户密钥即数据不可读，与 GDPR Article 17 "可证明删除"对接

---

## 13. 修订记录

### v1.4（2026-05-11）— v1.3 第 3 轮 4 路评审后穿透修订

> **触发**：v1.3 第 3 轮 4 路评审结果 Security APPROVED-WITH-COMMENTS / Architect NEEDS-CHANGES / Arch-Auditor NEEDS-CHANGES / Reviewer NEEDS-CHANGES。共拍出 1 个**自洽 bug**（tombstone tier 在 cron 路径 TypeError）+ 5 项**事实错误**（caller 数 / raw SQL 数 / enum 数 / secret-resolver / interceptor）+ 1 项**修订穿透漏洞**（§9 line 946 "1 周 alias"）+ 多项契约/spec/抽象问题。v1.4 在正文穿透修订（事实数据 / SQL / 模块名 inline 替换、状态行/§1.1/§4.5/§4.7 等已就地更新），本节 §13 提供修订映射表作为对照；不在被修订段落附加 `(v1.4 revised)` marker —— 避免 marker 在下一版迭代时再次成为残留。

**自洽 bug 修复（v1.3 引入）**：

| #   | 来源           | 修复                                                                                                                                       | 涉及章节    |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | Reviewer P1-R5 | §6.1 cron `findDueForDelete` SQL 必须含 `AND current_tier IN ('warm','cold')`；新增 tombstone 收敛分支（不调 adapter，直接 prisma.delete） | §5.2 / §6.1 |

**事实错误修复（v1.3 文档对现有代码的断言错）**：

| #   | 来源                     | 错误                                                                                                    | 修订                                                                                | 涉及章节                |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- |
| 2   | Architect + Arch-Auditor | "30+ caller 迁移" 实为类内 9 个 convenience method；外部 caller 仅 3 service / 8 处调用                 | §4.5 重写论据；PR-A0.5 工期 3-5d → 1-1.5d；AuditService 类对外签名保持不变          | §4.5 / §8 / §10.3 / §11 |
| 3   | Arch-Auditor             | "AuditAction enum 25+" 实为 24 个；"convenience methods 30+" 实为 9 个                                  | 全文穿透改 24 / 9                                                                   | §4.5 / §13              |
| 4   | Arch-Auditor             | "6 个 target 用 `$executeRawUnsafe`" 实为 **11 个**                                                     | 抽 `executeOffloadCommit` helper（PR-S4-prep 新增）；PR-S4a-d 工期 0.75 → 0.5d      | §1.1 / §8               |
| 5   | Arch-Auditor             | `secrets/secret-resolver.service.ts` **不存在**（实际 `secrets.service.ts` / `secret-keys.service.ts`） | §4.7 改名引用；PR-S9.5 拆出 a/b（a 前置 `tier` 列扩展）                             | §4.7 / §5.2 / §8        |
| 6   | Arch-Auditor             | `AUDIT_KEY` 装饰器 metadata **0 个 interceptor 读取**（v1.3 误以为"现有 interceptor 切到"）             | PR-A0a 必须**新建** `AuditMetadataInterceptor`；工期 +0.5d                          | §4.5 / §10.3 / §8       |
| 7   | Arch-Auditor             | `storage_objects` 表 + `current_tier` 在 prisma schema **完全不存在**                                   | §5.2 改"整表新建"措辞；`current_tier CHECK` 约束 + PublicTier/InternalTier 联合类型 | §5.2                    |

**修订穿透漏洞（v1.3 自身 grep 不彻底）**：

| #   | 来源           | 漏穿透                                                    | 修订                                                                                                          | 涉及章节 |
| --- | -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| 8   | Reviewer P2-R3 | §9 风险表 line 946 仍写"重命名 + 1 周 alias，spec 双覆盖" | 改为 "v1.4：类对外签名保持不变；3 service / 8 处 caller 零改动；装饰器拆 audit.decorator.ts 但保留 re-export" | §9       |

**契约缺口修复（Reviewer P0）**：

| #   | 来源           | 修复                                                                                                                | 涉及章节    |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------- |
| 9   | Reviewer P0-R1 | `IStorageFacade` 加 `setLegalHold` / `unsetLegalHold` / `overrideLegalHold` 三接口，避免业务方/admin UI 绕 facade   | §4.2        |
| 10  | Reviewer P0-R2 | `DeleteResult` 加 `{ status: 'partial-tombstoned', auditEventId }` 分支；§6.6 return 而非 throw                     | §4.2 / §6.6 |
| 11  | Reviewer P0-R3 | §6.6 catch 内不再 `.catch(()=>{})` 静默吞 DB update 失败；三重失败抛 `PartialDeleteError` + critical metric + audit | §6.6 / §7.3 |

**Architect 抽象漏洞修复**:

| #   | 来源         | 修复                                                                                                                | 涉及章节    |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------- | ----------- |
| 12  | Architect P1 | §2.1 抽象承诺措辞改为"facade 接管 WARM 起的搬迁；HOT→WARM 由业务事件驱动"，消除与 §3.2 矛盾                         | §2.1 / 顶部 |
| 13  | Architect P1 | §6.4 fallback migrate 路径独立 try/catch，二次失败抛 `MigrateFallbackError`；§4.2 注释"非首选路径"                  | §4.2 / §6.4 |
| 14  | Architect P1 | scanMixed hydrate 改 `OneShotHydrate<T>` 品牌类型；v1 once-flag + ESLint 三道防线；v2 改 AsyncIterator 退役所有补丁 | §4.3 / §6.5 |
| 15  | Architect P1 | legal-hold endpoint 归属：保留在 storage facade（与 storage_objects.legal_hold 列同域），不绕到 audit               | §4.2 / §7.2 |
| 16  | Architect P1 | §10.1 加 PR 并行边界 ASCII 图；双人并行 23-25d，单人线性 27.5-28d                                                   | §10.1       |

**Security 安全收紧**：

| #   | 来源        | 修复                                                                                                                                         | 涉及章节               |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 17  | Security P1 | tombstone 在 `scan()` / `statusOf()` / `delete()` 三路径一致返回 `NotFoundError`（v1.3 仅覆盖 get()）                                        | §6.4 / §6.5 / §6.6     |
| 18  | Security P1 | tombstone audit payload `formerUri` 改 `formerUriHash`（hash + 截短），不写明文                                                              | §6.6                   |
| 19  | Security P1 | 双签 `coSignerToken` 具体机制：random opaque（非 JWT）+ Redis SETNX scope=单条 hold + 15min TTL + GETDEL 原子消费 + cosigner 实时 DB 查 role | §7.2 / §11 7 边界 spec |
| 20  | Security P1 | `@Audit` `logArgs` 防 PII/secret 泄露：deny-by-default + 显式 allowlist + redactor 二次过滤                                                  | §4.5 / §11             |
| 21  | Security P1 | AuditAction 映射表 miss 抛 `UnmappedAuditActionError`（不 fallback 'unknown' 导致审计黑洞）                                                  | §4.5 / §11             |
| 22  | Security P1 | encryption boot-test 用固定 fixture（非 prod 数据），结果仅 boolean metric，不入日志/audit                                                   | §4.7 / §11             |
| 23  | Security P1 | HOT 滞留 watchdog（§7.5 新建）：archiver 声明 `maxHotAge`，每日扫业务表 PK 列检测超期未归档                                                  | §7.5 / §9              |
| 24  | Security P1 | §6.6 三重失败（R2 删 + DB delete + tombstone update 都失败）不静默吞，触发 PagerDuty critical                                                | §6.6 / §7.3            |
| 25  | Security P2 | keyId tier 不可降级：`secret-keys.service.update` 守卫，system→user-tenant 抛 `IllegalKeyTierTransitionError`                                | §4.7 / §9              |
| 26  | Security P2 | `common_audit_log.legal_hold` 列 setter 权限：仅 `setLegalHold` 内对**新写入**审计行置位                                                     | §7.4                   |
| 27  | Security P2 | 双签 cosigner 离职/失能校验：实时查 DB（`status='active'` + `last_login < 30d` + 实时 role）                                                 | §7.2                   |
| 28  | Security P2 | `getHydrateStatus` 响应/timing 一致性：不存在 vs 非 owner 返回相同 response body + 恒定 timing 防 oracle                                     | §4.2 / §11             |

**Reviewer 实现细节修复**：

| #   | 来源        | 修复                                                                                                                   | 涉及章节   |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- |
| 29  | Reviewer P1 | IArchiver.scanMixed `hydrate` 签名改 `OneShotHydrate<T>` 品牌类型                                                      | §4.3       |
| 30  | Reviewer P1 | §6.4 fallback 二次 deserialize 独立 try/catch，二次失败包成 `MigrateFallbackError`                                     | §6.4       |
| 31  | Reviewer P1 | §6.5 scanMixed 返回值必须通过 `VersionedSchema.schema.parse` 严格校验                                                  | §6.5 / §11 |
| 32  | Reviewer P1 | §11 HydrateReuseError spec 改写为"构造测试 archiver 故意复用 hydrate 两次"正向测试入口                                 | §11        |
| 33  | Reviewer P1 | §11 P0-3 spec 补 scan / statusOf / list / delete 4 路径对 tombstone 一致行为                                           | §11        |
| 34  | Reviewer P2 | `PublicTier` / `InternalTier` 联合类型在 abstractions/lifecycle-policy.ts 落地；`options.allowTiers` 类型限 PublicTier | §5.2 / §11 |
| 35  | Reviewer P2 | §9 风险表加 caller 迁移工期溢出、三重失败、HOT 滞留、AuditMetadataInterceptor 不存在、archive() 幂等等 6 条新风险      | §9         |
| 36  | Reviewer P2 | §4.4 `archiveTrigger.kind` 字面量保留 discriminated union 为 v2 扩展，注释明示                                         | §4.4       |

**Arch-Auditor 工程约束修复**：

| #   | 来源            | 修复                                                                                                           | 涉及章节     |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------- | ------------ |
| 37  | Arch-Auditor P1 | commitlint scope 白名单冲突说明：PR-S4a-d 等 commit scope 用 `backend` 而非自创 `storage`                      | §8 备注      |
| 38  | Arch-Auditor P1 | ESLint `no-restricted-imports` 现状澄清：无 storage 层专属限制，PR-S1 内自加规则禁止直 import adapter          | §10.2        |
| 39  | Arch-Auditor P1 | PR-S11 拆 a（后端 1.5d）+ b（前端 1d）                                                                         | §8           |
| 40  | Arch-Auditor P1 | `@Audit` decorator 拆到 `audit.decorator.ts` + audit.service.ts `re-export` 保现有 7 个 caller import 路径不破 | §4.5 / §10.3 |
| 41  | Arch-Auditor P2 | prisma migrate CONCURRENTLY ADR 补漏（v1.4 列入 §12 候选项）                                                   | §12          |
| 42  | Arch-Auditor P2 | 月分区零先例风险标注，pg_partman 或自管理决策（PR-S2 内敲定）                                                  | §5.3 / §8    |

**工期变化**：v1.3 28-30d → **v1.4 23-27d**（含并行）/ 27.5-28d（单人线性）；主因 caller 数下修 -3~-5d 主导。

### v1.3（2026-05-11）— v1.2 内部审视后穿透式修订

> **触发**：v1.2 收口前自检发现 3 P0 + 5 P1 + 3 P2 共 11 项；遵循 "doc 级追溯修订声明不可替代正文穿透替换"，全部就地修订并 inline 标注 `(v1.3 修订)`；本节仅做条目对照表。

**P0 收口（实施会分叉，必须先解决）**：

| #   | 编号 | 修复                                                                                                                   | 涉及章节                  |
| --- | ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | P0-1 | HOT→WARM cron 触发路径收口：删除 `policy.archiveAfter`，HOT→WARM 100% 业务事件 `storage.archive()` 触发，cron 不扫 HOT | §3.1 / §3.2 / §4.4 / §6.1 |
| 2   | P0-2 | AuditService 重命名工作量重估：30+ caller + `@Audit` 装饰器 + `AuditAction` 25+ enum 映射；PR-A0.5 工期 1.5d → 3-5d    | §4.5 / §8 / §10.3         |
| 3   | P0-3 | `delete()` R2 删成功 + DB 删失败的兜底：`current_tier = 'deleted-pending-cleanup'` tombstone，cron 下一轮自动收敛      | §6.6 / §11                |

**P1 修复**：

| #   | 编号 | 修复                                                                                                                | 涉及章节                       |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 4   | P1-1 | `VersionedSchema.migrate` 调用语义明确：facade 在 archiver.deserialize 抛 SchemaVersionMismatchError 时 fallback    | §4.2 / §6.4                    |
| 5   | P1-2 | 加密 keyId 模型措辞收紧：v1 仅 system-tier；per-user / per-tenant 与 §12 BYOK 一起作为 v2 立项；archiver 注册时校验 | §4.7                           |
| 6   | P1-3 | scanMixed hydrate 闭包强约束：runtime once-flag（`HydrateReuseError`）+ ESLint custom rule，取代纯文档约束          | §4.3 / §11                     |
| 7   | P1-4 | legal-admin 互锁逃生通道：2 个 legal-admin 联签可 override 别人设的 hold；独立 endpoint + 永久 audit                | §7.2 / §11 / §8 (PR-S11 ↑0.5d) |
| 8   | P1-5 | 加密"暂不"字段加 30d 审计时间表：v1 GA 后 30d 内由 Security + 业务方完成 5 个字段敏感性审计                         | §4.7 / §11                     |

**P2 修复**：

| #   | 编号 | 修复                                                                                                                                                | 涉及章节    |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 9   | P2-1 | R2 prefix 实际 8 个（不是 12 个）：`mission-records/` 共享 5 个 target；orphan scanner 反查需按文件名区分；加 `storage_orphan_scan_duration` metric | §1.1 / §6.3 |
| 10  | P2-2 | PR-S4a-d 工期 0.5d → 0.75d：6 个 target 用 `$executeRawUnsafe`，raw SQL 改造回归面较大                                                              | §8          |
| 11  | P2-3 | §10.1 层级图 `common/audit` 关系说明：PR-A0 阶段为深度改造（非单纯消费）                                                                            | §10.1       |

**核实结果（v1.3 前置）**：

- ✅ `audit.service.ts:147` `auditLogs: StoredAuditLog[] = []` + `maxLogs = 1000` 纯内存（v1.2 断言准确）
- ✅ `OFFLOAD_TARGETS` 实际 12 个（`storage-offload.registry.ts:40`）
- ✅ `StorageGovernanceController` 用 `@Public + x-admin-key`（`storage-governance.controller.ts:25`）

**总工期重估**：v1.2 25d → **v1.3 28-30 工作日**（P0-2 PR-A0.5 ↑1.5-3.5d / P2-2 PR-S4 ↑1d / P1-4 PR-S11 ↑0.5d）

### v1.2（2026-05-10）— Round 2 后修订

**Security P0（关键）**：

- ✅ `storage_objects` 加 `owner_user_id` / `owner_workspace_id` 列 + 索引（CWE-863）
- ✅ `assertCanRead` / `assertCanDelete` 实装真实 ACL，不再空实现

**多路 P1 全采纳**：

| #   | 来源              | 修复                                                                             |
| --- | ----------------- | -------------------------------------------------------------------------------- |
| 1   | Architect P1-N1   | tab 数自洽：3 现有 + 3 新增 = 6                                                  |
| 2   | Architect P1-N2   | archiver 加 `idTemplate(scope)` 显式声明，scan 不靠 startsWith                   |
| 3   | Architect P1-N3   | scanMixed hydrate 闭包不可跨调用缓存（文档约束 + spec）                          |
| 4   | Architect P1-N4   | Phase 0 拆 PR-A0a（接口契约）+ PR-A0b（实现）                                    |
| 5   | Architect P1-N5   | BYOK 物理删除证明从 backlog 移到 v2 单独立项                                     |
| 6   | Arch-Auditor P1-1 | Phase 0 工作量重估 1.5d → 4d（PR-A0=2d+1.5d / 现 audit.service 重命名）          |
| 7   | Arch-Auditor P1-2 | PR-S4 拆 PR-S4a~S4d 4 个（防 god-class guard）                                   |
| 8   | Arch-Auditor P1-3 | `common/audit/audit.service` 命名冲突明确解决：重命名 + alias                    |
| 9   | Reviewer P1-A     | 新增 `VersionedSchema<T>` 包装类型                                               |
| 10  | Reviewer P1-B     | §6.6 GDPR delete 实装 `orphanScanner.scanForObject(obj)`                         |
| 11  | Reviewer P1-C     | §6.5 obj=null 时 ACL guard，业务侧 archiver 自校验 scope                         |
| 12  | Reviewer P1-D     | adapter 显式 `copyIfNotExists` 接口；R2 内部 headObject + putObject 两步幂等     |
| 13  | Security P1-1     | `getHydrateStatus(ticketId, ownerContext)` 必传                                  |
| 14  | Security P1-2     | `legal_hold` 写权限独立 `legal-admin` role；setLegalHold 入 RBAC                 |
| 15  | Security P1-3     | GDPR delete 命中 legal_hold 不自动覆盖，返回 `pending-legal-review` 通知合规决策 |
| 16  | Security 加密     | 新增 §4.7 应用层加密；topic_reports / mission_events / wiki revisions 强制加密   |
| 17  | Security 跨域     | audit_log entityType 级 RBAC + export 必须 admin + 自审计                        |
| 18  | Security 部分删除 | `delete()` R2 删成功 + DB 删失败路径写 `delete.partial` audit                    |

**总工期重估**：v1.1 17.5d → **v1.2 25 工作日**（主因：Phase 0 audit 实际是重建 + 加密层 + RBAC 细分）

### v1.1（2026-05-10）

- 修复 v1.0 9 个 P0 + P1 共识采纳
- Round 2: Architect / Arch-Auditor / Reviewer APPROVED-WITH-COMMENTS；Security NEEDS-CHANGES（新发现 ACL 列缺失 P0）

### v1.0（2026-05-10）

- 初版设计；Round 1: 4 路 0/4 APPROVED，9 个 P0

---

**最后更新**: 2026-05-11  
**状态**: Draft v1.4，待第 4 轮 4 路评审（v1.4 修复 v1.3 引入的 1 个自洽 bug + 5 项事实错误 + 1 项穿透漏洞 + 多项契约/抽象/Security 收紧；详见 §13 v1.4 修订记录 42 条对照表）  
**审议人选**: Security / Architect / Arch-Auditor / Reviewer 四路 Round 4（v1.4 修订面 42 条仍属深度修订，建议四路同评）
