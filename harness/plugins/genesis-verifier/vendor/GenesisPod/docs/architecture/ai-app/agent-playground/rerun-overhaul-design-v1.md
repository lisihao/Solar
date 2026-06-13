# Agent-Playground Rerun Overhaul — Design v1.1

> **状态**：v1.1（R1 4 路 CHANGES-REQUIRED → P0/重要 P1 全修，待 R2）
> **作者**：2026-05-07
> **触发事件**：mission `c195035f` 用户点"持久化重跑"被拒，错误 `is in-flight (heartbeat 1s ago, event 1s ago) — cannot rerun while live`，但 DB status=`failed`。3 次重跑全失败、3 处独立 in-flight 判定、3 个 endpoint 散乱。
> **目标读者**：architect / security / reviewer / tester（4 路集体审视）
> **版本日志**：见 §11

---

## 1. 真因（事实链已 verify）

**截图错误真因 = 因果倒置**：

```
local-rerun.service.ts:269  emit "mission:rerun-started"  ← 用户行为，写 DB events
                       :274  maybeReopen
                              └─ markReopened: failed→running + emit "mission:reopened"  ← 又写 DB events
                       :282  hydrator.hydrate
                              └─ ctx-hydrator:99-115
                                  status="running"（刚被 reopened 改的）
                                  heartbeat 4min ago（zombie pod setInterval 还在跑）
                                  latest event 1s ago（自己刚 emit 的 rerun-started + reopened）
                              → 双信号 fresh → 误判 in-flight → 拒
```

**用户视角**：我点重跑 → 自己 emit 的副作用事件 → 被自己后续步骤当 mission 活迹 → 拒绝我自己的行为。

**DB 验证**（2026-05-07）：

| mission                                | status       | heartbeat 距 NOW                   | latest event 类型                                                              | latest event 距 NOW           |
| -------------------------------------- | ------------ | ---------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| `c195035f-d6fd-4dae-a9a0-d5176048e4e6` | **`failed`** | **234s ago**（zombie，pod 还在跑） | `mission:failed` → `rerun-failed` → `reopened` → `rerun-started` 4 件套 × 3 轮 | 257s ago / 311s / 313s / 314s |

mission 真状态 = failed，heartbeat = zombie，但 ctx-hydrator 因看到 reopened 事件 1s 前误判活。

---

## 2. 现状混乱清单（事实底座）

### 2.1 三个 rerun endpoint（散乱）

| Endpoint                                       | controller line | service                                            | scope                                              |
| ---------------------------------------------- | --------------- | -------------------------------------------------- | -------------------------------------------------- |
| `POST /missions/:id/rerun`                     | controller:395  | `MissionRerunOrchestratorService.rerunFullMission` | 整个 mission 重跑（创建新 mission 或 incremental） |
| `POST /missions/:id/todos/:todoId/rerun`       | controller:430  | `MissionRerunOrchestratorService.rerunFromTodo`    | 任务级 — **创建新 mission**                        |
| `POST /missions/:id/todos/:todoId/local-rerun` | controller:474  | `LocalRerunService.run`                            | 任务级 — **原 mission in-place 重跑**              |

前端 `frontend/services/agent-playground/api.ts` 285/315/367 三个函数对应。**用户截图点的是第 3 个**。

### 2.2 八处独立判定（in-flight + 其他）

| #   | 位置                                            | 触发条件                                                  | 文案                                     | userId 隔离                |
| --- | ----------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- | -------------------------- |
| 1   | `local-rerun.service.ts:206`                    | `running + heartbeat<60s`                                 | "原 mission 还在跑..."                   | YES                        |
| 2   | `ctx-hydrator.service.ts:111`                   | `running + hb<60s + event<5min`（双信号）                 | "is in-flight (heartbeat... event...)"   | NO（依赖上游）             |
| 3   | `mission-rerun-orchestrator.service.ts:64`      | status NOT IN [completed/failed/quality-failed/cancelled] | "Source mission cannot be rerun..."      | YES                        |
| 4   | `mission-store.service.ts:1070`（markReopened） | from NOT IN [failed/quality-failed]（5×5 矩阵）           | "cannot reopen mission in status=..."    | YES（乐观锁 affectedRows） |
| 5   | `local-rerun.service.ts:234`（lockRegistry）    | (missionId,todoId) 已 acquire                             | "该任务正在重跑..."                      | NO（lock 不带 user）       |
| 6   | `local-rerun.service.ts:383`（频次）            | 24h 内 ≥ N 次                                             | "...在 24h 内已重跑..."                  | YES                        |
| 7   | `local-rerun.service.ts:216`（cost）            | costUsd ≥ maxCredits                                      | "mission 累积 cost...已达 maxCredits..." | YES                        |
| 8   | `stage-rerun.dispatcher.ts:209`（scope）        | scope 不在 handler 名单                                   | "局部重跑暂未实现该 scope..."            | NO                         |

**问题**：

- `1` `2` `4` 三处都判 "running" 状态，阈值/信号/文案不一致
- `2` 是 zombie 判定双信号，但事件类型不分类（lifecycle 与 business 混读）
- `5` lockRegistry 不带 userId（非业务约束）
- `1` 已经判 running+hb<60s 拒，`2` 在 hydrate 阶段又判一次（冗余）

### 2.3 五条 rerun chain 事件（混在一张 events 表里）

| 事件 type                               | 来源                       | 性质               |
| --------------------------------------- | -------------------------- | ------------------ |
| `mission:rerun-started`                 | local-rerun:269            | **用户行为标记**   |
| `mission:reopened`                      | mission-store:1106         | **状态机转换**     |
| `mission:rerun-completed`               | local-rerun:337            | 业务完成           |
| `mission:rerun-failed`                  | local-rerun:359            | 业务失败           |
| `mission:manual-rerun-from-todo`        | orchestrator:214           | **用户行为标记**   |
| `mission:failed`                        | mission-store / dispatcher | 业务失败           |
| `mission:completed`                     | dispatcher 路径            | 业务完成           |
| `dimension:*` / `chapter:*` / `stage:*` | per-dim-pipeline 等 30+ 类 | **业务进展真活迹** |

**问题**：`ctx-hydrator.getLatestEventTs` 不区分类型，`SELECT ... ORDER BY ts DESC LIMIT 1` 拿到的可能是用户行为标记 / 状态机标记，**而非真业务进展**。这是因果倒置的结构性根源。

### 2.4 zombie heartbeat 来源（无 stoppoint）

`mission-runtime-shell.service.ts:151-153`：

```typescript
heartbeatTimer = setInterval(() => {
  void this.store.refreshHeartbeat(missionId, podId);
}, 30_000);
```

**问题**：mission lifecycle 转 final（completed/failed/cancelled）时**没有显式 clearInterval**。pod 还在跑（其他 mission 共用 pod），setInterval 持续 fire，heartbeat_at 持续刷到 NOW —— **mission 早死，heartbeat 永远新**。

---

## 3. 目标态架构

### 3.1 单一 RerunGuard service（唯一 in-flight 判定单元）

新建 `backend/src/modules/ai-app/agent-playground/services/mission/rerun/rerun-guard.service.ts`：

```typescript
@Injectable()
export class RerunGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MissionStore,
  ) {}

  /**
   * 唯一 in-flight 判定（**纯读，无副作用** —— RV-6 不变量）。
   *
   * 所有 rerun 入口（full / task / local）通过 ensureRerunable() 间接调此处；
   * 直接调 checkInFlight 的调用方只能用于观测 / 决策，不能假设它会修复任何状态。
   */
  async checkInFlight(
    missionId: string,
    userId: string,
  ): Promise<RerunGuardResult> { ... }

  /**
   * 入站强校验。in-flight 抛 BadRequest；zombie 主动 cleanup 后放行。
   * 唯一调用入口：local-rerun.run / orchestrator.rerunFullMission /
   * orchestrator.rerunFromTodo（针对 source mission 的判定）。
   */
  async ensureRerunable(missionId: string, userId: string): Promise<void> { ... }
}

export interface RerunGuardResult {
  /** R1 reviewer P1-1 修：删原 canRerun（与 inFlight 重复），调用方一律基于 inFlight + zombieDetected 推导 */
  /** mission 当前是否真在跑（语义：拒重跑） */
  inFlight: boolean;
  /** 检测到 zombie（heartbeat 新但 BUSINESS 事件 STALE） */
  zombieDetected: boolean;
  /** mission 当前 status */
  status: MissionStatus;
  /** heartbeat 距今 ms（null = 无 heartbeat） */
  heartbeatAgeMs: number | null;
  /** 最近 BUSINESS 事件距今 ms（null = 无业务事件，刚创建/刚 reopen） */
  latestBusinessEventAgeMs: number | null;
  /** 给前端展示的 reason（仅 inFlight=true 时填） */
  reason?: string;
}
```

#### 3.1.1 判定矩阵（heartbeat 三态 × event 三态 × status）

```
status ∈ {completed, failed, quality-failed, cancelled} → inFlight=false（直放过，与 heartbeat/event 无关）
status = "running":
  heartbeat 三态 × business-event 三态 → 9 cell 决策矩阵：

                      | event fresh (<5min)    | event stale (≥5min)        | event null (0 业务事件)
  --------------------|------------------------|----------------------------|---------------------------
  heartbeat fresh     | inFlight=true          | zombieDetected=true        | zombieDetected=true
  (<60s)              | （真在跑）              | （zombie pod）              | （zombie + 刚启）
  --------------------|------------------------|----------------------------|---------------------------
  heartbeat stale     | inFlight=false         | inFlight=false             | inFlight=false
  (≥60s)              | （hb 漏 / 长间隔）      | （真死 / LivenessGuard 漏） | （真死/初始化失败）
  --------------------|------------------------|----------------------------|---------------------------
  heartbeat null      | inFlight=false         | inFlight=false             | inFlight=false
  (reopen 后未刷)      | （reopen 后等 shell）   | （reopen 失败）             | （reopen 后等 shell）
```

**关键不变量**：`heartbeat null` 永不 `inFlight=true`（解决 R1 P0-3 markReopened race，详见 §3.7）。

**降级行为**（R1 architect P1-3 修）：DB 错误 / SQL 超时 → fail-closed（抛 BadRequest "rerun guard 服务异常，请稍后重试"）。**不能** fail-open，因为放行可能让用户在真正 in-flight mission 上叠加 rerun 引起业务串数据。

### 3.2 用户行为优先（active zombie cleanup）

RerunGuard 检出 zombie 时**主动修复**，不让用户等：

```typescript
async ensureRerunable(missionId: string, userId: string): Promise<void> {
  const guard = await this.checkInFlight(missionId, userId);
  if (guard.inFlight) {
    throw new BadRequestException(
      `mission ${missionId} is in-flight (${guard.reason})`,
    );
  }
  if (guard.zombieDetected) {
    await this.zombieCleanup(missionId, userId);
  }
  // 调用方继续走 reopen / hydrate
}

private async zombieCleanup(missionId: string, userId: string): Promise<void> {
  // R1 reviewer P0-2 修：不能裸 UPDATE。必须委托 MissionStore 已有写路径，
  // 走唯一写源（feedback_no_dual_sources）。
  // R1 security P0 修：MissionStore.markFailed 内部 WHERE 三元 (id + user_id + status='running')，
  // 跨用户 missionId 触发 affectedRows=0 不动他人数据。
  await this.store.markFailed(
    missionId,
    {
      // R1 security P1-3 修：errorMessage 标识，与 cascade-aborted 区分
      errorMessage: "zombie-heartbeat-cleanup",
    },
    userId,  // 必传 userId，触发 markFailed 内部 WHERE 包含 user_id（mission-store.service.ts:540 已支持）
  );
  await this.store.clearHeartbeat(missionId, userId);  // 新增方法（PR-2）
  await this.prisma.agentPlaygroundMissionEvent.create({
    data: {
      missionId,
      type: "agent-playground.mission:zombie-cleanup",
      payload: {
        triggeredBy: userId,
        ts: Date.now(),
        reason: "heartbeat fresh but no BUSINESS event ≥ 5min",
      },
      ts: BigInt(Date.now()),
    },
  });
  this.log.warn(
    `[rerun-guard ${missionId}] zombie cleanup performed (user ${userId})`,
  );
}
```

**安全要点**（R1 security P0 修）：

- `MissionStore.markFailed(id, payload, userId)` 内部 SQL：`UPDATE ... WHERE id = $1 AND user_id = $2 AND status = 'running'`（mission-store.service.ts:540 已是这个模式）
- 跨用户 missionId（理论 UUID 碰撞 / admin 越权）触发 affectedRows=0，不影响他人数据
- `clearHeartbeat` 同样要求 userId 参数

**反向证据 spec**（R1 tester RV-5/RV-6 修）：

- RV-1：emit `mission:rerun-started` 后 checkInFlight → `inFlight=false`
- RV-2：heartbeat=1s + business event=6min → `zombieDetected=true`
- RV-3：clearHeartbeat 抛错不影响 markCompleted 主流程
- RV-4：zombieCleanup 后业务字段（dimensions / outline_plan / report_full）保留 —— **断言 UPDATE 列只含 status / heartbeat_at / error_message / completed_at**
- **RV-5（新）**：`mission:rerun-started` / `mission:reopened` / `mission:zombie-cleanup` 调 `isBusinessEventType` 必须返回 false（事件分类不变量）
- **RV-6（新）**：连续调 `checkInFlight` 100 次后断言 `prisma.agentPlaygroundMission.update` / `agentPlaygroundMissionEvent.create` 0 调用（纯读不变量）

### 3.3 事件分类（强类型化）

新建 `backend/src/modules/ai-app/agent-playground/services/mission/lifecycle/event-categories.ts`：

```typescript
/**
 * mission_events 表 type 字符串前缀分类。
 *
 * R1 reviewer P0-1 + architect P0-1 修：
 *   - BUSINESS 必须用全限定前缀（含命名空间），匹配 startsWith（不是 includes）
 *   - LIFECYCLE 必须列全字符串集合（精确匹配）
 *   - 未命中两边时（UNKNOWN）= fail-open 当 BUSINESS（宁可误算活迹放行用户，也不误判 zombie 把跑着的 mission 杀掉），并 Logger.warn
 *
 * R1 architect P1-1 follow-up：所有新 emit 点 PR review 必须 grep 此文件确认归类。
 */
export const EVENT_CATEGORY = {
  /** 业务进展真活迹（命名空间全限定前缀，startsWith 匹配） */
  BUSINESS_PREFIXES: [
    "agent-playground.dimension:",
    "agent-playground.chapter:",
    "agent-playground.stage:",
    "agent-playground.agent:narrative",
    "agent-playground.tool:",
  ],
  /** 状态机 / 用户行为 / 失败 / 完成标记 / cleanup（精确字符串匹配） */
  LIFECYCLE_TYPES: new Set<string>([
    "agent-playground.mission:rerun-started",
    "agent-playground.mission:rerun-completed",
    "agent-playground.mission:rerun-failed",
    "agent-playground.mission:reopened",
    "agent-playground.mission:failed",
    "agent-playground.mission:completed",
    "agent-playground.mission:cancelled",
    "agent-playground.mission:rejected",
    "agent-playground.mission:warning",
    "agent-playground.mission:budget-warning-hard",
    "agent-playground.mission:manual-rerun-from-todo",
    "agent-playground.mission:zombie-cleanup",
  ]),
} as const;

export type EventCategory = "BUSINESS" | "LIFECYCLE" | "UNKNOWN";

export function categorizeEvent(eventType: string): EventCategory {
  if (EVENT_CATEGORY.LIFECYCLE_TYPES.has(eventType)) return "LIFECYCLE";
  if (EVENT_CATEGORY.BUSINESS_PREFIXES.some((p) => eventType.startsWith(p)))
    return "BUSINESS";
  return "UNKNOWN";
}

export function isBusinessEventType(eventType: string): boolean {
  // R1 architect P0-1 修：UNKNOWN = fail-open 当 BUSINESS（宁可误算活迹）
  // 调用方有 Logger.warn 责任记 UNKNOWN 类型，便于观测后续补分类
  const cat = categorizeEvent(eventType);
  return cat === "BUSINESS" || cat === "UNKNOWN";
}

export function isLifecycleEventType(eventType: string): boolean {
  return categorizeEvent(eventType) === "LIFECYCLE";
}
```

**不动 DB schema**（events 表加 category 列改动太大）；用 type 字符串前缀约定 + helper 函数判定。

`RerunGuard.getLatestBusinessEventTs` 内部 SQL（R1 security P1-2 修：用全限定前缀确保索引可用）：

```sql
SELECT ts FROM agent_playground_mission_events
WHERE mission_id = $1
  AND (type LIKE 'agent-playground.dimension:%'
       OR type LIKE 'agent-playground.chapter:%'
       OR type LIKE 'agent-playground.stage:%'
       OR type LIKE 'agent-playground.agent:narrative%'
       OR type LIKE 'agent-playground.tool:%')
ORDER BY ts DESC LIMIT 1
```

**索引保证**（R1 security P1-2 修）：PR-1 实施前必须确认 `agent_playground_mission_events(mission_id, type, ts)` 复合索引存在；不存在补 migration（Prisma schema + manual SQL）。

**注意 SQL 与 helper 一致性**（R1 reviewer P0-1 修）：SQL `LIKE 'agent-playground.dimension:%'` 与 `EVENT_CATEGORY.BUSINESS_PREFIXES[0]` 字面一致；二者必须用同一份常量源（PR-1 用 const 字符串引用，避免漂移）。

### 3.4 三处判定的去向

| 原判定 #                       | 处理                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `1` local-rerun:206            | **删** —— 改委托 RerunGuard.ensureRerunable                             |
| `2` ctx-hydrator:99-128        | **删** in-flight 检查（保 hydrate 业务逻辑），改委托上游已调 RerunGuard |
| `3` orchestrator:64            | 保留（status whitelist 是业务约束，与 in-flight 正交）                  |
| `4` mission-store.markReopened | 保留（5×5 状态机是 DB 层约束，独立）                                    |
| `5` lockRegistry               | 保留（并发锁是进程内防双击，独立）                                      |
| `6` 频次                       | 保留                                                                    |
| `7` cost                       | 保留                                                                    |
| `8` scope                      | 保留                                                                    |

**关键**：`ctx-hydrator` 不再做 in-flight；`local-rerun.run` 入口先调 `RerunGuard.ensureRerunable` 一次性判完，下游全信任。

### 3.5 heartbeat zombie 主动清理（lifecycle 侧）

`mission-runtime-shell.service.ts` mission lifecycle 转 final 时显式 stop heartbeat：

```typescript
// 任何 markCompleted / markFailed / markCancelled 后
if (heartbeatTimer) {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}
await this.store.clearHeartbeat(missionId, userId); // UPDATE heartbeat_at = NULL
```

`mission-store.clearHeartbeat(missionId, userId)` 新方法。markCompleted / markFailed / markCancelled 内部都 call。

#### 3.5.1 clearHeartbeat × LivenessGuard sequence（R1 architect P0-2 修）

```
T0: mission shell 检测 mission 业务结束
T1: 调 store.markCompleted/Failed/Cancelled    → status: running → final（同事务内审计事件）
T2: 调 store.clearHeartbeat                     → heartbeat_at = NULL（独立 UPDATE，best-effort）
T3: clearInterval(heartbeatTimer)               → 进程内 timer 停
T4: LivenessGuard 下次 30s 轮询：
      SQL: WHERE status = 'running'
      → 不返回这条 mission（status 已 final）→ 跳过 ✓
```

**LivenessGuard 安全验证**（grep 结果，文件路径与行号）：

- `mission-liveness-guard.service.ts:50` 注释："拉取所有 status='running' 的 mission"
- `mission-liveness-guard.service.ts:313-321` `heartbeatAgeMs == null` 视为 stale，但因 status 已 final 根本进不来这段
- `mission-liveness-guard.service.ts:323` 双 stale 才 markFailed —— 即使误进 loop（极小概率），也会被 status='running' 过滤拦下

**反向证据 spec**（R1 architect P0-2 修）：

- `liveness-guard.spec` 加 1 case：mission status=failed + heartbeat_at=NULL → adapter.markFailed 0 调用
- `clearHeartbeat 失败 spec`（已列 RV-3）：clearHeartbeat 抛错不影响 markCompleted 主流程（best-effort，记 warn）

#### 3.5.2 markReopened 不再写 heartbeat_at（R1 architect P0-3 修 —— design v1 自身的 race 漏洞）

**新一轮因果倒置真因**（R1 architect 发现）：

design v1 的 RerunGuard + zombieCleanup 还有一个未被覆盖的 race：

```
T0: 用户第 1 次点重跑
T1: ensureRerunable → checkInFlight: status=failed → 直放过
T2: maybeReopen → markReopened: status: failed→running + heartbeatAt=NEW DATE（mission-store.service.ts:1087）+ emit reopened 事件
T3: cascade 起 stage 立即 throw → markFailed: status=failed, errorMessage 写 cascade_aborted

T10: 用户立即第 2 次点重跑（10s 内）
T11: ensureRerunable → checkInFlight:
       status="failed" (T3 已写) → 直放过 ✓ （没问题）

但如果 T3 没写（cascade 还没起就失败 / 慢一拍）：
T11': ensureRerunable → checkInFlight:
        status="running" (T2 markReopened 写的)
        heartbeat 9s ago (T2 markReopened 写的 heartbeatAt=NOW)
        latest BUSINESS event = null（cascade 还没 emit business 事件）
        → 触发 zombieDetected=true
        → zombieCleanup 把 status: running→failed
        → 第 1 次的 reopen 状态被覆盖回 failed ❌ 新一轮因果倒置
```

**修法**：`mission-store.markReopened` 不写 heartbeat_at（删 line 1087 的 `heartbeatAt: new Date()`）。

**理由**：

1. `markReopened` 是状态机转换（failed→running），职责单一改 status
2. heartbeat 是 pod-level 信号，应由 mission shell `setInterval` 接管 mission 后第一时间刷（mission-runtime-shell.service.ts:150 已 `void this.store.refreshHeartbeat(missionId, podId)`）
3. reopen 后到 mission shell 接管之间的窗口（毫秒级），heartbeat_at 保持 reopen 之前的值（旧 / null）—— RerunGuard 看到 `heartbeat stale 或 null` → `inFlight=false`，不会误判 zombie（§3.1.1 矩阵已覆盖）
4. **RerunGuard.heartbeat null** 永远 `inFlight=false`（不变量）—— 保证连点重跑安全

**反向证据 spec**：

- 连点重跑 spec：emit reopened 后立即 checkInFlight（heartbeat=null OR stale）→ `inFlight=false, zombieDetected=false`
- markReopened SQL 不含 heartbeat_at 字段断言（PR-2 spec）

### 3.6 endpoint 不合并，但底层归一

3 个 controller endpoint URL 保持不变（前端不动），但底层都过 RerunGuard：

```typescript
// MissionRerunOrchestratorService.rerunFullMission（端点 1）
async rerunFullMission(...) {
  await this.rerunGuard.ensureRerunable(missionId, userId);
  // ... 原逻辑
}

// MissionRerunOrchestratorService.rerunFromTodo（端点 2 —— R1 architect P1-2 修）
async rerunFromTodo(...) {
  // 端点 2 创建新 mission，但 source mission 的 in-flight 必须判：
  //   - 防止用户在源 mission 还在跑时同时创建衍生 mission（业务串数据）
  await this.rerunGuard.ensureRerunable(sourceMissionId, userId);
  // ... 原逻辑（创建新 mission）
}

// LocalRerunService.run（端点 3）
async run(...) {
  await this.rerunGuard.ensureRerunable(missionId, userId);
  // ... 原逻辑（删 line 206 in-flight 检查）
}
```

### 3.7 连点重跑安全性（综合 §3.5.2 + §3.1.1）

**用户连续点重跑的端到端正确性**：

| 时序 | 行为                                                           | RerunGuard 看到                                          | 判定                           |
| ---- | -------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------ |
| T0   | 用户第 1 次点重跑                                              | status=failed                                            | inFlight=false 直放过          |
| T1   | maybeReopen → status=running + heartbeat 不动（旧值或 null）   | —                                                        | —                              |
| T2   | dispatcher 起，emit `stage:s2-leader-plan:started`（BUSINESS） | —                                                        | —                              |
| T3   | mission shell setInterval 第 1 次刷 heartbeat                  | —                                                        | —                              |
| T10  | 用户第 2 次点重跑（恰好 cascade 失败但还没回 status=failed）   | status=running, heartbeat 7s ago, latest BUSINESS 8s ago | **inFlight=true 拒**（真在跑） |
| T20  | cascade 真完成失败 → markFailed                                | status=failed                                            | —                              |
| T21  | 用户第 3 次点重跑                                              | status=failed                                            | inFlight=false 直放过          |

**关键不变量**：

- markReopened 不写 heartbeat_at → reopen 后 RerunGuard heartbeat 状态保留 reopen 之前的真实值
- mission shell 接管后才刷 heartbeat（业务真在跑的真实信号）
- BUSINESS 事件出现 = 业务真在跑 = 拒重跑（这才是 inFlight 真语义）

---

## 4. 实施 PR 拆分（R1 tester P0-T2 + reviewer P1-3 修：硬门控 depends-on）

| PR       | 内容                                                                                                                                               | 文件数                        | 风险                       | depends-on                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| **PR-1** | RerunGuard service + event-categories.ts + 10 case spec + DB 索引 migration                                                                        | 3 新增 + 1 spec + 1 migration | 低（纯新增）               | —                                                                       |
| **PR-2** | `mission-store.clearHeartbeat` 新方法 + `mission-store.markReopened` 删 heartbeat_at 字段 + `markCompleted/Failed/Cancelled` stop heartbeat + spec | 1 改 + 1 spec                 | 中（lifecycle + 状态机改） | PR-1 merged                                                             |
| **PR-3** | local-rerun 委托 RerunGuard + 删 line 206 in-flight + 删 line 206 spec                                                                             | 1 改 + 1 spec 改              | 中（业务路径）             | **PR-1 merged**（CI 必须绿）                                            |
| **PR-4** | ctx-hydrator 删 in-flight 检查 + 删常量 EVENT_INFLIGHT_THRESHOLD_MS / HEARTBEAT_INFLIGHT_THRESHOLD_MS + spec 删/迁                                 | 1 改 + 1 spec 改              | 中（spec 迁移）            | **PR-1 merged**（CI 必须绿）+ **PR-3 merged**（避免临时双重保护态矛盾） |
| **PR-5** | rerun-integration.spec 补 zombie 真实场景 + active override 全链路 + 因果倒置反向 spec + 连点重跑 spec                                             | 1 spec 改                     | 低（纯增）                 | PR-1/2/3/4 全 merged                                                    |

**硬门控**（R1 tester P0-T2）：

- 每个 PR description 在 GitHub 上必须用 `Depends on #PR-1` / `Depends on #PR-3` 文本声明，blocked-by status check 检测
- PR-3/PR-4 不允许在 PR-1 前合并 —— GitHub branch protection rule 配 status check
- 如违反，CI fail（PR-1 RerunGuard service 没合 → import not found）

**死代码清理**（R1 reviewer P1-2）：PR-4 必须删 ctx-hydrator 的：

- `EVENT_INFLIGHT_THRESHOLD_MS` 常量（line 57）
- `HEARTBEAT_INFLIGHT_THRESHOLD_MS` 常量（line 42）
- `getLatestEventTs` 私有方法（line 245-255）—— 改用 RerunGuard 的 `getLatestBusinessEventTs`，但 hydrator 不直接调
- in-flight check block（line 96-128）

每 PR 独立 push、独立跑 4 路集体审视、独立 4/4 YES。

---

## 5. spec 改动矩阵（R1 reviewer P1-4 修：列出 case 名称让 PR-1 直接对号入座）

### 5.1 `rerun-guard.service.spec.ts`（新，PR-1）—— 16 case

```typescript
describe("RerunGuardService", () => {
  describe("checkInFlight — status 短路", () => {
    it("status=completed → inFlight=false, zombieDetected=false");
    it("status=failed → inFlight=false（不查 heartbeat / event）");
    it("status=quality-failed → inFlight=false");
    it("status=cancelled → inFlight=false");
  });

  describe("checkInFlight — status=running + heartbeat 三态（R1 tester P0-T1）", () => {
    it(
      "heartbeat=null + business event=null → inFlight=false（reopen 后未刷）",
    );
    it(
      "heartbeat=null + business event 5s ago → inFlight=false（heartbeat 不到位）",
    );
    it(
      "heartbeat=5s ago + business event=null → zombieDetected=true（R1 tester P0-T3 / 0 BUSINESS event）",
    );
    it("heartbeat=5s ago + business event=10s ago → inFlight=true（真活）");
    it(
      "heartbeat=5s ago + business event=10min ago → zombieDetected=true（zombie pod）",
    );
    it(
      "heartbeat=120s ago + business event=10s ago → inFlight=false（hb 漏 / 长间隔）",
    );
    it("heartbeat=120s ago + business event=null → inFlight=false（真死）");
  });

  describe("checkInFlight — userId 隔离（R1 security P0）", () => {
    it(
      "不同 userId 调相同 missionId → mission-not-found 抛 NotFoundException（不泄露 status）",
    );
  });

  describe("checkInFlight — 纯读不变量（R1 tester RV-6）", () => {
    it("连续调 100 次 → store.update / event.create 0 调用");
  });

  describe("ensureRerunable — zombieCleanup 行为", () => {
    it(
      "zombieDetected=true → markFailed(userId) + clearHeartbeat(userId) + emit zombie-cleanup 事件",
    );
    it(
      "zombieCleanup 走 store.markFailed（不裸 UPDATE）—— 验证调用 mock 而非 prisma.update",
    );
    it(
      "zombieCleanup 不动业务字段（dimensions/outline_plan/report_full）—— RV-4",
    );
  });

  describe("ensureRerunable — DB 异常 fail-closed（R1 architect P1-3）", () => {
    it("$queryRawUnsafe 抛错 → BadRequest(rerun guard 服务异常)，不放行");
  });
});
```

### 5.2 `event-categories.spec.ts`（新，PR-1）—— 12 case

```typescript
describe("event-categories", () => {
  describe("isBusinessEventType / isLifecycleEventType / categorizeEvent", () => {
    it("BUSINESS: agent-playground.dimension:web → BUSINESS");
    it("BUSINESS: agent-playground.chapter:writing-completed → BUSINESS");
    it("BUSINESS: agent-playground.stage:s7-review-started → BUSINESS");
    it("BUSINESS: agent-playground.tool:web-search:completed → BUSINESS");
    it("BUSINESS: agent-playground.agent:narrative → BUSINESS");
    it("LIFECYCLE: agent-playground.mission:rerun-started → LIFECYCLE（RV-5）");
    it("LIFECYCLE: agent-playground.mission:reopened → LIFECYCLE（RV-5）");
    it(
      "LIFECYCLE: agent-playground.mission:zombie-cleanup → LIFECYCLE（RV-5）",
    );
    it(
      "UNKNOWN: agent-playground.misc:foo → fail-open 当 BUSINESS + Logger.warn（R1 architect P0-1）",
    );
    it(
      "startsWith 不被绕过：mission:lifecycle-note-dimension:fake → LIFECYCLE 还是 UNKNOWN（test 防 includes 误匹配）",
    );
  });
  describe("regression: 全部现有 emit 点必须被分类", () => {
    it("枚举所有 mission_events.type 不变量 → categorizeEvent 不返回 UNKNOWN");
  });
  describe("UNKNOWN 路径稳定性", () => {
    it("isBusinessEventType('') / null / undefined 不抛错（type guard）");
  });
});
```

### 5.3 既有 spec 改动

| spec 文件                                | 改动                                                                                                                                                         | PR   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `ctx-hydrator.service.spec.ts`           | 删 5+ in-flight case（迁到 rerun-guard.spec）；保 zod 校验 / size guard / hydrate 业务场景；删 line 252-260 / line 333 等所有 `rejects.toThrow(/in-flight/)` | PR-4 |
| `local-rerun.service.spec.ts`            | 删"原 mission 还在跑"相关 case；保 lock / 频次 / cost / cascade；新增 ensureRerunable 调用断言                                                               | PR-3 |
| `rerun-integration.spec.ts`              | 补 case：zombie 真实场景 e2e（PR-5）；连点重跑 spec（R1 architect P0-3 反向证据，PR-5）；因果倒置反向（PR-5）                                                | PR-5 |
| `mission-store.markReopened.spec.ts`     | 改 1 case：reopen 后 mission.heartbeat_at 字段保留原值（不写 NEW DATE）—— R1 architect P0-3 锚定                                                             | PR-2 |
| `stage-rerun.dispatcher.spec.ts`         | 不动                                                                                                                                                         |
| `mission-liveness-guard.service.spec.ts` | 加 1 case：mission status=failed + heartbeat_at=NULL → adapter.markFailed 0 调用（R1 architect P0-2 反向证据）                                               | PR-2 |
| `mission-runtime-shell.service.spec.ts`  | 加 case：markCompleted/Failed/Cancelled 后 heartbeatTimer cleared + clearHeartbeat 被调（best-effort，抛错不影响主流程）                                     | PR-2 |

### 5.4 并发安全 spec（R1 tester P1-T1）

`rerun-guard-concurrency.spec.ts`（PR-5）：

- 两个并发 ensureRerunable 同 missionId → 第一个 zombieCleanup 后第二个 status=failed 直放过（不会重复 cleanup）
- lockRegistry 兜底：local-rerun.run 入口 acquire 失败 → BadRequest，不到达 ensureRerunable

### 5.5 PR 合并时序的总覆盖率保证（R1 tester P0-T2）

```
PR-1 合 → CI: rerun-guard.spec 16 case + event-categories 12 case 绿
       → 总覆盖率：原 ctx-hydrator/local-rerun in-flight case 仍存在（双重保护，不矛盾）
PR-2 合 → CI: 新 store/runtime/liveness spec 绿
       → 总覆盖率：markReopened 不写 heartbeat_at + clearHeartbeat 行为锚定
PR-3 合 → CI: local-rerun in-flight 旧 case 删（已迁到 rerun-guard）
       → 总覆盖率：local-rerun 委托 RerunGuard 完整路径 + 旧 spec 删
PR-4 合 → CI: ctx-hydrator in-flight 旧 case 删
       → 总覆盖率：ctx-hydrator 不再做 in-flight；上游单点判定信任建立
PR-5 合 → CI: integration spec 全场景验证
       → 总覆盖率：e2e 真实事故复现（c195035f 类）+ 连点重跑反向证据
```

任何 PR 中间状态都跑得通完整 spec（不会有"PR-3 已删旧 spec 但 PR-1 还没合"的真空窗口，因为 depends-on 硬门控）。

---

## 6. 风险与缓解

| 风险                                                                        | 缓解                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**：业务事件类型 grep 漏（新增的 stage event 类型未加进 BUSINESS 列表） | event-categories.ts 写**白名单 prefix**（`stage:` 兜全部 stage 类）+ regression spec：枚举所有现有 mission event type，确保每个都被 isBusinessEventType / isLifecycleEventType 二分（不能两边 false） |
| **R2**：zombieCleanup 误清正常 mission（事件慢但 mission 真在跑）           | event 阈值 5min 已留缓冲（最长 stage 间空隙）；额外加观测 `mission:zombie-cleanup` 事件 + Logger.warn —— prod 可监控误清率，先观察 1 周再考虑收紧                                                     |
| **R3**：ctx-hydrator 删 in-flight 后并发 rerun 漏拒                         | 上游 local-rerun.run 入口 RerunGuard 已判 + lockRegistry 兜底；3 层防御去 1 层（hydrator）不影响并发安全                                                                                              |
| **R4**：clearHeartbeat 影响其他依赖 heartbeat_at 的逻辑                     | grep `heartbeat_at` / `heartbeatAt` 全引用点，确认只有 in-flight 判定 + LivenessGuard 用；LivenessGuard 已能处理 NULL（跳过）                                                                         |
| **R5**：5×5 状态机与 RerunGuard 重叠                                        | RerunGuard 输出 canRerun=true/false，markReopened 仍独立判 from→to 合法性；两层正交（一是"能不能现在 rerun"，一是"reopen 状态机能不能转"）                                                            |
| **R6**：spec 迁移过程中 in-flight case 临时失覆盖                           | 每 PR 严格按"先建 RerunGuard.spec → 再删/迁旧 spec"顺序，确保任何中间状态总覆盖率不掉                                                                                                                 |
| **R7**（R1 security 高危）：跨用户 missionId zombieCleanup                  | zombieCleanup 走 store.markFailed(userId) + clearHeartbeat(userId)，三元 WHERE `id + user_id + status='running'`；spec 锁不同 userId 调相同 missionId → mission-not-found 抛 NotFoundException        |
| **R8**（R1 architect P0-3）：连点重跑 race                                  | markReopened 不写 heartbeat_at；mission shell 接管时刷；RerunGuard heartbeat null/stale 永不 inFlight=true（§3.5.2 反向证据 spec）                                                                    |
| **R9**（R1 architect P0-1）：未分类事件 fail-open                           | UNKNOWN 当 BUSINESS（宁可误算活迹放行用户，也不误判 zombie 杀活 mission）+ Logger.warn 让 prod 观测                                                                                                   |
| **R10**（R1 architect P1-1）：新 emit 点漏分类                              | event-categories.ts 头部注释要求 PR review 必查；regression spec 穷举所有现有 emit 点二分；CI lint rule 后续可加（follow-up）                                                                         |
| **R11**（R1 architect P1-3）：RerunGuard DB 异常                            | fail-closed —— 抛 BadRequest("rerun guard 服务异常，请稍后重试")，不放行；spec 锁                                                                                                                     |
| **R12**（R1 reviewer P0-2）：双源 heartbeat 写入                            | zombieCleanup 走 store.markFailed + store.clearHeartbeat（已有写源），不裸 UPDATE；spec 验证 mock 调用走 store 而非 prisma.update                                                                     |

---

## 7. 反向证据 spec（必有，R1 tester 完善）

按 `feedback_destructive_op_must_have_rollback` + `feedback_fallback_must_be_self_consistent` 规则，destructive op + fallback 必有反向证据：

1. **RV-1（因果倒置反向）**：emit `mission:rerun-started` 后立即 RerunGuard.checkInFlight → `inFlight=false`（lifecycle 事件不算业务活迹）
2. **RV-2（zombie 真实反向）**：heartbeat = 1s ago + 最近 BUSINESS event = 6min ago → `zombieDetected=true`（不被 1s heartbeat 误判活）
3. **RV-3（clearHeartbeat 失败 spec）**：markCompleted 内部 clearHeartbeat 抛错时不影响 markCompleted 主流程（best-effort，记 warn）
4. **RV-4（业务字段保留）**（R1 tester P1 强化）：zombieCleanup 后业务字段（dimensions / outline_plan / report_full / theme_summary / leader_signed 等）**保留不动** —— spec 锁 store.markFailed mock 调用参数列**只含** status / errorMessage / completedAt 字段；prisma 真 UPDATE SQL 不出现业务字段名（grep 反向）
5. **RV-5（lifecycle 不被误判 BUSINESS）**：`mission:rerun-started` / `mission:reopened` / `mission:zombie-cleanup` / `mission:rerun-failed` / `mission:failed` / `mission:completed` 调 `isBusinessEventType` 必须返回 false；调 `categorizeEvent` 必须返回 `"LIFECYCLE"`
6. **RV-6（checkInFlight 纯读）**：连续调 `checkInFlight` 100 次，断言 `prisma.agentPlaygroundMission.update` / `agentPlaygroundMissionEvent.create` / `store.markFailed` / `store.clearHeartbeat` **0 调用**
7. **RV-7（连点重跑安全）**（R1 architect P0-3 修锚定）：emit `reopened` 后 100ms 内 checkInFlight（heartbeat=null OR stale）→ `inFlight=false, zombieDetected=false`；不会把刚 reopen 的 mission 当 zombie 杀
8. **RV-8（LivenessGuard 兼容）**（R1 architect P0-2）：mission status=failed + heartbeat_at=NULL → LivenessGuard 轮询 → adapter.markFailed 0 调用（status='running' WHERE 已挡）
9. **RV-9（事件分类 startsWith 不被绕过）**：`mission:lifecycle-note-dimension:fake` 这种 includes 子串攻击 → categorizeEvent 不返回 BUSINESS（防 R1 reviewer P0-1 / security P1 漏洞）

---

## 8. 不做的范围（Out of Scope）

- 3 endpoint URL 真正合并（前端要改，本轮只做后端归一）
- 跨 pod heartbeat（Redis/分布式锁，单进程足够）
- 事件表 schema 变更（不加 category 列，用前缀约定）
- LivenessGuard 删除（与 RerunGuard 互补，LivenessGuard 是被动扫描，RerunGuard 是入站判定）
- 频次 / cost / scope 检查（与 in-flight 正交，不动）

---

## 9. 落地约束（必须）

1. design v1 必须 4/4 集体审视 YES 才进 PR-1 实施
2. 每 PR 独立 4 路审视 + 4/4 YES 才 push
3. 实施完所有 PR 后再做一次端到端 4 路评审
4. mission `c195035f` 用户视角真实场景必须能跑通（点重跑 → 不被拒 → 入 cascade dispatcher）

---

## 10. 关联

- 触发 mission：`c195035f-d6fd-4dae-a9a0-d5176048e4e6`
- 关联 commit：`d5ea3f157`（双信号 partial 修）/ `608ed7f8e`（reset-before-cascade 删）/ `7db2b3e17`（layer 6 + reserved kind）
- 关联 memory：
  - `feedback_consensus_must_iterate_to_all_yes`
  - `feedback_destructive_op_must_have_rollback`
  - `feedback_fallback_must_be_self_consistent`
  - `feedback_no_dual_sources`
  - `project_c195035f_data_wipe_2026_05_07`
  - `project_per_task_rerun_R0_R8_complete_2026_05_07`

---

## 11. 版本日志

### v1.1 — 2026-05-07（响应 R1 4 路 CHANGES-REQUIRED）

R1 4 路评审全 CHANGES-REQUIRED，9 个 P0（去重 7 个独立）+ 17 P1。本版本解决全部 P0 + 重要 P1：

**P0 修法（全部嵌入设计）**：

| #    | 提出方               | 修在                    | 内容                                                                                                                                                                             |
| ---- | -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | architect + reviewer | §3.3 + §7 RV-9          | 事件分类 `startsWith` 不 `includes`；UNKNOWN = fail-open 当 BUSINESS + Logger.warn；新增 `categorizeEvent` 三态 + `isLifecycleEventType` 反向 helper                             |
| P0-2 | architect            | §3.5.1 + §7 RV-8        | clearHeartbeat × LivenessGuard sequence 画清；grep mission-liveness-guard.service.ts:50,313-321 验证 status='running' WHERE + null hb 视 stale 不冲突；spec 锁                   |
| P0-3 | architect            | §3.5.2 + §3.7 + §7 RV-7 | **design v1 自身的 race 漏洞** —— markReopened 不写 heartbeat_at（删 mission-store.service.ts:1087），mission shell 接管时刷；RerunGuard heartbeat null/stale 永不 inFlight=true |
| P0-4 | security             | §3.2 + §7 RV-4 + §6 R7  | zombieCleanup 通过 store.markFailed(userId) + store.clearHeartbeat(userId) 走唯一写源，三元 WHERE `id + user_id + status='running'`                                              |
| P0-5 | reviewer             | §3.2                    | 不双源：禁裸 UPDATE，必走 MissionStore 已有写路径                                                                                                                                |
| P0-6 | tester               | §5.1                    | rerun-guard.spec heartbeat 三态 × event 三态 9 case 显式                                                                                                                         |
| P0-7 | tester               | §4 + §5.5               | PR 硬门控 depends-on：PR-3/PR-4 不允许 PR-1 前合，CI status check                                                                                                                |
| P0-8 | tester               | §5.1                    | SQL LIKE 0 BUSINESS 事件场景 spec（latestBusinessEventAgeMs=null → canRerun=true）                                                                                               |

**重要 P1 修法**：

- architect P1-1：event-categories.ts 头部注释要求 PR review 必查；regression spec 穷举（§6 R10）
- architect P1-2：rerunFromTodo source mission 也走 RerunGuard（§3.6）
- architect P1-3：RerunGuard DB 异常 fail-closed（§3.1.1 + §6 R11）
- security P1-2：DB 索引 PR-1 前确认（§3.3）
- security P1-3：errorMessage 标识 "zombie-heartbeat-cleanup"（§3.2）
- reviewer P1-1：删 RerunGuardResult.canRerun 字段（与 inFlight 重复，§3.1）
- reviewer P1-2：旧常量 EVENT_INFLIGHT_THRESHOLD_MS / HEARTBEAT_INFLIGHT_THRESHOLD_MS 由 PR-4 显式删（§4 死代码清理）
- reviewer P1-4：spec case 标题列出（§5.1 + §5.2 总 28 case）
- tester P1-T1：并发 rerun spec（§5.4）
- tester P1-T2 / T3：zombieCleanup exactly-once + observability spec（§5.1）
- tester RV-5/RV-6：lifecycle 不被 BUSINESS 误判 + checkInFlight 纯读（§7）

**保留为 follow-up 的 P1**（不阻塞本设计）：

- architect P1-4：zombieCleanup 是否 emit socket 给前端（UX 增强，PR-5 后另开）
- security P1：lockRegistry 跨用户 missionId 边界文档化（§6 R7 已 cover 主要安全风险）
- tester P1-T4：未分类新事件提示式 spec（CI lint rule，可后续追加）

### v1 — 2026-05-07（initial draft）

初稿。3 endpoint + 8 处独立判定真因摸排；提出 RerunGuard 单点 + 用户行为优先 + 事件分类 + zombie 主动清理；5 PR 拆分。
