# AI Kernel (L3) 架构质量审计报告

**审计日期**: 2026-03-02
**审计版本**: df90c16f (HEAD)
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-kernel/` 全量代码

## 代码库概况

| 指标             | 数值                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 生产 TS 文件数   | 54                                                                                                         |
| 测试 Spec 文件数 | 34                                                                                                         |
| 测试/生产比      | 63.0%                                                                                                      |
| 总行数 (非测试)  | ~11,450 行                                                                                                 |
| 子模块数量       | 11 (process, memory, ipc, resource, journal, scheduler, supervisor, observability, security, mission, api) |

---

## 执行摘要

| #   | 维度         | 满分   | 得分   | 状态                                                      |
| --- | ------------ | ------ | ------ | --------------------------------------------------------- |
| 1   | 模块内聚性   | 10     | 8      | 良好，存在轻微边界模糊                                    |
| 2   | 接口设计     | 10     | 7      | Controller/Service 良好，两处 SQL 安全问题                |
| 3   | 安全性       | 10     | 7      | A2A safeCompare 正确，存在两处 SQL 注入风险               |
| 4   | 错误处理     | 10     | 7      | 大体健壮，Service 层大量裸 `throw new Error`              |
| 5   | 测试覆盖     | 10     | 8      | 63% 比率优秀，两个 Controller spec 在 `__tests__/` 中存在 |
| 6   | 代码质量     | 10     | 10     | 零 `any`、零 `console.log`、零 `@ts-ignore`、单一超大文件 |
| 7   | 依赖合理性   | 10     | 9      | 严格单向，abstractions 层设计优秀，极少数边界             |
| 8   | 运行时稳定性 | 10     | 8      | 调度器、Supervisor 健壮，wait() 轮询存在优化空间          |
|     | **总计**     | **80** | **64** |                                                           |

**总分: 64/80 (80%)**

---

## D1: 模块内聚性 [8/10]

### 正面评估

- **process/**：单一职责，完整的 OS 进程抽象（spawn/fork/transition/kill/wait/checkpoint），优秀
- **memory/**：三层内存模型（WorkingMemory=内存+LRU、ProcessMemory=DB+TTL、PersistentMemory=DB+用户隔离）分层清晰
- **ipc/**：EventBus（WebSocket+EventEmitter）、MessageBus（进程间）、ProgressTracker 三件套职责明确
- **resource/**：circuit-breaker、rate-limiter、cost-controller、constraint-engine、token-budget 子组件内聚性强
- **scheduler/**：`FOR UPDATE SKIP LOCKED` 分布式安全调度，职责单一
- **supervisor/**：进程监控（Zombie检测、超时处理、崩溃恢复）与进程执行状态（StateCategory）两合一，清晰
- **security/**：capability-guard 访问控制单一职责
- **journal/**：事件溯源 + 检查点管理，职责内聚
- **mission/**：MissionExecutorService 作为 process lifecycle 的业务门面，层次清晰

### 问题

**P2 - `mission/` 与 `process/` 职责重叠**

`MissionExecutorService.execute()` 实际上只是顺序调用了 `ProcessManagerService.spawn() → transition(READY) → transition(RUNNING)`，再加两条 journal 记录。这三个 transition 步骤在逻辑上本应归入 ProcessManagerService 的"start"便捷方法，当前作为独立子模块略显过重。现有设计在当前规模尚可，但若 Mission 语义继续扩展（如 Mission 包含多个 Process），需要重新评估边界。

**P3 - `KernelApiService` 是纯聚合层，价值有限**

`kernel-api.service.ts` 包含 13 个依赖注入，每个方法只是简单转发，无任何额外逻辑。这类"统一入口"在依赖很多时反而形成依赖膨胀点。建议外部消费者直接通过 `facade/index.ts` 选择所需服务，不强制走 KernelApiService。

---

## D2: 接口设计 [7/10]

### 正面评估

- `ObservabilityController`：RESTful (`GET /api/v1/admin/traces`, `/stats`, `/:id`)，有 `@ApiTags`、`@UseGuards(JwtAuthGuard, AdminGuard)`，端点顺序注释到位（`stats` 置于 `:id` 前防路由冲突）
- `A2AController`：有 `@ApiTags`、`@ApiOperation`、`@ApiResponse`、`@ApiBearerAuth`、`@Throttle` 限流，Swagger 覆盖完整
- Prisma 模型设计合理：AgentProcess 含 version 字段（乐观锁）、ProcessMemory 含 @@unique 和 @@index、ProcessEvent 含 @@unique([processId, sequence])

### 问题

**P1 - `$queryRawUnsafe` 字符串插值导致潜在 SQL 注入 (2 处)**

```typescript
// process-supervisor.service.ts:171
`SELECT EXISTS(...table_name = '${tableName}') AS "exists"`
// kernel-scheduler.service.ts:70
`SELECT EXISTS(...table_name = 'agent_processes') AS "exists"`;
```

`process-supervisor.service.ts` 中 `tableName` 参数来自内部调用（`"agent_processes"` 和 `"process_memories"`），虽然当前不是外部输入，但使用 `$queryRawUnsafe` 加字符串插值是危险模式。`kernel-scheduler.service.ts` 中虽然是硬编码字符串，但风格不一致。两处均应改用 `Prisma.sql` tagged template：

```typescript
// 安全写法
Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables
  WHERE table_schema='public' AND table_name=${tableName}) AS "exists"`;
```

ProcessManagerService 中的同类查询已正确使用 `Prisma.sql`，应保持一致。

**P2 - `CapabilityGuardService.getCapabilities()` 返回 `any`-like 结构**

```typescript
async getCapabilities(processId: ProcessId) { // 缺少显式返回类型
```

返回类型未声明，依赖推断。应补充显式返回类型 `Promise<ProcessCapabilities | null>`。

**P3 - ProcessMessage 模型在实际代码中未使用**

`ProcessMessage` Prisma 模型已在 schema 中定义，`AgentProcess` 有 `sentMessages`/`receivedMessages` 关联，但 MessageBusService 使用纯内存 Map（不写 DB），ProcessMessage 表实际是空的。这是一个 schema 与实现的错位。

---

## D3: 安全性 [7/10]

### 正面评估

- `A2AApiKeyGuard` 正确使用 `safeCompare()` from `common/utils/crypto.utils`，防止 timing attack
- `CapabilityGuardService` 实现了进程级工具/技能/数据访问控制，设计正确
- 所有管理端点受 `JwtAuthGuard + AdminGuard` 双重保护
- A2A 端点有 `@Throttle` 限流（在 `a2a.controller.ts` 中）
- 内存 LRU 上限（10000 订阅、MAX_HISTORY 200、WorkingMemory LRU 1000 sessions）防止 OOM

### 问题

**P1 - $queryRawUnsafe 字符串插值 (安全维度)**

见 D2 中同一问题。`process-supervisor.service.ts:171` 的 `${tableName}` 插值如果 tableName 来源在未来被更改为外部输入，会产生 SQL 注入。应立即修复为参数化 SQL。

**P2 - `CapabilityGuardService.checkToolAccess()` 进程不存在时的安全策略存在歧义**

```typescript
if (!process) {
  // Process not found in DB (may have been cleaned up) — treat as unrestricted
  return { allowed: true }; // 工具访问：允许
}
```

对比：

```typescript
// checkSkillAccess 中：
if (!process) {
  return { allowed: false, reason: "Process not found" }; // 技能访问：拒绝
}
```

两个方法对"进程不存在"的响应策略**不一致**：`checkToolAccess` 允许，`checkSkillAccess` 拒绝。这是一个安全逻辑不一致问题，应统一为"进程不存在时拒绝访问"（fail-secure 原则），或至少有明确的文档说明为什么两者不同。

**P3 - CircuitBreaker 的 Redis 索引并发更新存在竞态**

`updateRedisIndex()` 先 get 再 set，在高并发下多个实例可能同时读取旧索引覆盖彼此的写入（read-modify-write 竞态）。当前为单实例部署风险低，水平扩展后可能丢失索引条目。

---

## D4: 错误处理 [7/10]

### 正面评估

- MissionExecutorService.fail() 内部有 try-catch 防止已终止进程的重复 FAILED 转换
- ProcessSupervisorService.healthCheck() 有完整 try-catch 防止定期任务崩溃
- CircuitBreakerService.onModuleInit() 中 Redis 加载失败被捕获并记录警告
- A2AController 使用 NestJS 标准异常（NotFoundException、BadRequestException、HttpException）
- KernelMetricsService.\_doFlush() 失败时正确将事件放回队列头部，防止数据丢失

### 问题

**P1 - ProcessManagerService 中大量 `throw new Error()` 裸错误**

```typescript
// process-manager.service.ts (15处)
throw new Error("agent_processes table not available");
throw new Error(`Invalid state transition: ${current.state} -> ${newState}...`);
throw new Error(`Optimistic lock conflict for process ${processId}...`);
throw new Error(`Process ${processId} did not reach terminal state...`);
```

ProcessManagerService 是纯 Service 层，`throw new Error` 是正确的（非 HTTP 层，不应抛 HttpException）。但调用方（A2AController、MissionExecutorService 等）在调用这些方法时，应当捕获并转换为 HttpException 后再响应。问题在于：**A2AController 对 TeamsService.executeMission() 的调用有 try-catch，但直接调用 process/memory/journal 方法的地方未必都有防护**。需确认所有 Controller 层调用都有适当的错误映射。

**P2 - `EventJournalService.recordStep()` 在 table not ready 时直接执行步骤，无错误记录**

```typescript
async recordStep<T>(processId: ProcessId, step: StepResult<T>): Promise<T> {
  if (!this.tableReady) return step.execute(); // 静默降级，无日志
```

当 table 不可用时直接执行但不记录日志，破坏了事件溯源的完整性。至少应该 log.warn 一次。

**P3 - PersistentMemoryStore.deleteWithUser() 吞掉 Prisma P2025 错误**

```typescript
} catch {
  return false; // 删除时记录不存在：静默返回 false
}
```

这种模式本身可以接受（删除不存在的记录），但 catch 块完全无日志，调试时无法区分"记录不存在"与"数据库连接失败"。

**P4 - `wait()` 方法使用 setTimeout 轮询，无取消机制**

```typescript
async wait(processId: ProcessId, timeoutMs = 300_000): Promise<ProcessSnapshot> {
  while (Date.now() < deadline) {
    // ... db query every 1s
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
```

5分钟内每秒查一次数据库，无法提前中断。若调用方取消请求，轮询仍会持续至超时。建议加入 AbortSignal 支持，或改用事件驱动通知（EventBus）。

---

## D5: 测试覆盖 [8/10]

### 正面评估

- **63% 测试比率**（34 spec / 54 production）显著高于大多数项目
- 核心子模块均有对应 spec：
  - `process/` - process-manager.service.spec, process.types.spec
  - `memory/` - kernel-memory-manager.service.spec, working-memory.store.spec, persistent-memory.store.spec, in-memory-store.spec
  - `ipc/` - event-bus.service.spec, message-bus.service.spec, progress-tracker.service.spec
  - `resource/` - resource-manager.service.spec, circuit-breaker.service.spec, constraint-engine.spec, rate-limiter.spec, cost-controller.spec, constraint-profile.spec, constraint-enforcement.service.spec
  - `scheduler/` - kernel-scheduler.service.spec
  - `supervisor/` - process-supervisor.service.spec
  - `security/` - capability-guard.service.spec
  - `observability/` - kernel-metrics.service.spec, cost-attribution.service.spec, process-event-log.service.spec
  - `journal/` - event-journal.service.spec, checkpoint-manager.spec
  - `ipc/a2a/` - a2a.controller.spec, a2a-api-key.guard.spec, a2a-client.service.spec, a2a-team-member-adapter.spec, agent-card-registry.spec
  - `observability/` - observability.controller.spec
  - `context/` - kernel-context.spec

### 问题

**P2 - KernelApiService 无 spec 文件**

`/d/projects/codes/deepdive-engine/backend/src/modules/ai-kernel/api/kernel-api.service.ts` 无对应 spec。虽然它是聚合层，但作为 Facade 对外的统一入口，应至少有集成测试确认依赖注入正确、各委托方法正确路由。

**P2 - MissionExecutorService 的 spec 覆盖完整性待确认**

`mission/__tests__/mission-executor.service.spec.ts` 存在，但 MissionExecutorService 的 `fail()` 路径（catch 块中的进程已终止状态）和 `complete()` 路径（带/不带 output）是否均有测试用例需确认。

**P3 - TokenBudgetService 无 spec**

`/d/projects/codes/deepdive-engine/backend/src/modules/ai-kernel/resource/token-budget.service.ts` 无对应 spec，但 module.ts 中有注册。

---

## D6: 代码质量 [10/10]

这是 ai-kernel 层最突出的优势。

| 检查项                            | 结果                                                    |
| --------------------------------- | ------------------------------------------------------- |
| `any` 类型                        | 0 处                                                    |
| `console.log/warn/error`          | 0 处                                                    |
| `@ts-ignore` / `@ts-expect-error` | 0 处                                                    |
| 硬编码品牌名                      | 0 处                                                    |
| 硬编码 LLM 模型名                 | 0 处（COST_PER_1K_TOKENS 中的模型名用于价格映射，合理） |

**文件体积**：

- `constraint-engine.ts` 803 行 - 超出 500 行阈值，但内容为状态机逻辑和常量表，密度合理
- `circuit-breaker.service.ts` 729 行 - 超出阈值，Redis 持久化 + 状态机 + 清理全在一文件，可考虑拆分 Redis 适配层
- `cost-attribution.service.ts` 718 行 / `kernel-metrics.service.ts` 707 行 - 接近阈值

其他代码风格均符合项目规范：

- 全部 Service 使用 `private readonly logger = new Logger(ClassName.name)`
- 全部使用 `ConfigService` 读取配置（无裸 `process.env`）
- 使用 `LruMap` 防止无界 Map 增长
- fire-and-forget 均正确使用 `void xxx()`

---

## D7: 依赖合理性 [9/10]

### 正面评估

**abstractions 层设计是该模块最亮眼的架构决策**：

`/backend/src/modules/ai-kernel/abstractions/index.ts` 作为 ai-kernel 访问 ai-engine 的唯一通道，完全隔离了 L3 对 L2 内部路径的直接依赖。该文件注释明确：

```
This is the ONLY file in ai-kernel that is permitted to import from ai-engine.
```

验证结果：

- ai-kernel 内部文件 import ai-engine 的路径：**0 处**（全部通过 `../abstractions`）
- ai-kernel 反向依赖 ai-app（L4）：**0 处**
- ai-kernel 反向依赖 open-api（L5）：**0 处**
- ai-kernel 反向依赖 agent-os（L6）：**0 处**

外部模块访问 ai-kernel 均通过 `facade/index.ts`，app.module.ts 中直接 import `AiKernelModule` 类（正确，模块注册不算 facade 违规）。

### 问题

**P3 - AiKernelModule 声明为 `@Global()` 的适当性**

```typescript
@Global()
@Module({ ... })
export class AiKernelModule {}
```

`@Global()` 使 ai-kernel 的所有 provider 全局可注入，无需在消费模块中 import。这是便利性与封装性的权衡——在 ai-kernel 作为基础设施层时是合理的，但会使依赖关系不那么显式。若 agent-os（L6）或 open-api（L5）只需要少数 kernel 服务，建议评估是否改为显式 import 以提升可见性。

---

## D8: 运行时稳定性 [8/10]

### 正面评估

- **KernelSchedulerService**：`FOR UPDATE SKIP LOCKED` 实现分布式安全调度，防止多实例重复调度；`onModuleDestroy` 正确清理定时器
- **ProcessSupervisorService**：
  - 启动时崩溃恢复（`recoverOnStartup`）：有检查点则重置为 READY，无则标记 FAILED
  - 定期健康检查（30 秒间隔）：超时进程标记 FAILED，Zombie 检测（2小时）
  - 定期清理 30 分钟无活动的内存状态
- **CircuitBreakerService**：三态状态机（CLOSED/OPEN/HALF_OPEN），1小时清理不活跃断路器，`onModuleDestroy` 清理定时器
- **KernelMetricsService**：环形缓冲区 + 5分钟 flush + 关闭时最终 flush + 并发 flush 防护
- 所有 setInterval 均调用 `.unref()`，不阻止 Node.js 进程退出

### 问题

**P2 - wait() 轮询无取消机制**（已在 D4 中详述）

**P2 - KernelSchedulerService 的 scheduleNext() 在分布式场景下有 TOCTOU 问题**

```typescript
// 1. 查询 RUNNING 数量
const runningCount = await this.prisma.agentProcess.count({ where: { state: "RUNNING" } });
// 2. 用 FOR UPDATE SKIP LOCKED 查询 READY 进程
// 3. 再查询各 tenant 的 RUNNING 数量
const tenantCounts = await this.prisma.agentProcess.groupBy(...)
```

步骤 1 和步骤 3 之间没有事务保护。多实例同时运行时，两个实例可能都读到相同的 runningCount < maxConcurrent，然后各自调度进程，导致实际 RUNNING 数量超出 maxConcurrent。`FOR UPDATE SKIP LOCKED` 只保证了不重复调度同一进程，不保证全局总数上限。建议将 count + groupBy + update 包在一个事务中，或接受轻微超调（当前上限 50 个，偶尔超调 1-2 个一般可接受）。

**P3 - ProcessSupervisorService 的 `tableName` 字符串插值问题**（已在 D3 中详述）

**P3 - EventJournalService.record() 的序号计算存在理论上的并发竞争**

```sql
COALESCE((SELECT MAX(sequence) FROM process_events WHERE process_id = ?), 0) + 1
```

在极高并发下（同一 processId 的多个事件同时插入），两个事务可能读取相同的 MAX(sequence)，导致 sequence 碰撞并违反 `@@unique([processId, sequence])`。当前有唯一约束保护（会抛 Prisma 异常），但没有重试逻辑。实际场景中一个 process 通常是顺序执行的，并发概率极低，但理论上应改为数据库 SEQUENCE 或添加乐观重试。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                                                          | 维度  | 影响范围                               | 修复成本                                  | 建议时机   |
| ------ | --------------------------------------------------------------------------------------------- | ----- | -------------------------------------- | ----------------------------------------- | ---------- |
| P1     | `$queryRawUnsafe` + 字符串插值 SQL 注入风险（supervisor + scheduler 的 checkTableExists）     | D2/D3 | 中（当前内部调用安全，但模式危险）     | 低（改用 `Prisma.sql` 或硬编码表名）      | 本迭代     |
| P1     | `CapabilityGuardService.checkToolAccess()` vs `checkSkillAccess()` 进程不存在时安全策略不一致 | D3    | 中（进程清理后的访问控制行为不可预测） | 低（统一为 fail-secure）                  | 本迭代     |
| P2     | `ProcessMessage` Prisma 模型与 `MessageBusService` 实现错位（DB 模型定义但未使用）            | D2    | 低（功能可用，只是 schema 冗余）       | 中（需决定是删除 DB 模型还是实现持久化）  | 下次迭代   |
| P2     | `wait()` 轮询无取消机制，可能导致 RUNNING 但客户端已断连的孤儿轮询                            | D4/D8 | 中（长时间运行 mission 的资源浪费）    | 中（引入 AbortSignal 或 EventBus 通知）   | 下次迭代   |
| P2     | `KernelSchedulerService.scheduleNext()` 分布式 TOCTOU：全局并发数上限在高并发下可能轻微超调   | D8    | 低（软限制，偶尔超 1-2 个可接受）      | 高（事务化 count+schedule）               | 评估后决定 |
| P2     | `KernelApiService` 纯聚合层缺少 spec，且 13 个依赖注入使其成为膨胀点                          | D5/D1 | 低                                     | 低（补 spec）/中（拆解 KernelApiService） | 长期       |
| P3     | 两个最大文件（constraint-engine.ts 803行、circuit-breaker.service.ts 729行）超出 500 行阈值   | D6    | 低（功能正确，只是文件偏大）           | 低（拆分为 Redis 适配子类）               | 长期       |
| P3     | `EventJournalService.record()` 序号计算存在理论并发竞争                                       | D8    | 低（顺序进程实际不触发）               | 中（改用 DB SEQUENCE 或乐观重试）         | 长期       |

---

## 建议行动项

### 必须处理（本迭代）

- [ ] **修复 SQL 注入模式**：将 `process-supervisor.service.ts:171` 和 `kernel-scheduler.service.ts:70` 的 `$queryRawUnsafe` + 字符串插值改为 `Prisma.sql` tagged template（参考 `process-manager.service.ts` 中已有的正确写法）
- [ ] **统一 CapabilityGuardService 的安全策略**：`checkToolAccess()` 在进程不存在时的 `return { allowed: true }` 改为与 `checkSkillAccess()` 一致的 `return { allowed: false, reason: "Process not found" }`，或添加明确注释说明为何两者策略不同

### 计划处理（下次迭代）

- [ ] **ProcessMessage 模型决策**：要么实现 `MessageBusService` 的 DB 持久化逻辑使用 `ProcessMessage`，要么从 `AgentProcess` schema 中移除 `sentMessages`/`receivedMessages` 关联（如果 MessageBus 永远是纯内存的话）
- [ ] **wait() 添加取消支持**：为 `ProcessManagerService.wait()` 添加 `AbortSignal` 参数，或改为基于 `EventBusService` 订阅的响应式等待
- [ ] **补充 KernelApiService spec**：添加 `api/__tests__/kernel-api.service.spec.ts`，至少覆盖关键委托路径
- [ ] **补充 TokenBudgetService spec**：添加 `resource/__tests__/token-budget.service.spec.ts`

### 长期改进

- [ ] 评估 `constraint-engine.ts`（803行）是否拆分为：核心逻辑 + 成本计算辅助类
- [ ] 评估 `circuit-breaker.service.ts`（729行）是否提取 `CircuitBreakerRedisAdapter`
- [ ] 评估 `KernelApiService` 是否替换为直接从 `facade/index.ts` 按需导入，避免聚合层膨胀
- [ ] 考虑 `EventJournalService.record()` 的序号生成改为 Postgres SEQUENCE，消除理论并发竞争
- [ ] `KernelSchedulerService.scheduleNext()` 的全局并发上限添加事务保护（若需精确控制）

---

## 总体评价

AI Kernel (L3) 是一个**设计思路清晰、实现质量较高**的基础设施层。核心亮点：

1. **abstractions 层隔离**是优秀的架构决策，确保 L3 不直接依赖 L2 内部实现
2. **代码质量得分满分**：零 `any`、零 `console.log`、零 `@ts-ignore`，ConfigService 覆盖，LruMap 防 OOM
3. **63% 测试覆盖率**在全栈项目中属于优秀水平，核心服务均有对应 spec
4. **运行时稳定性设施完善**：崩溃恢复、Zombie 检测、CircuitBreaker、定时器 unref
5. **严格的 Facade 边界**：外部模块无法绕过 facade 访问 kernel 内部

主要改进方向集中在：两处 SQL 安全模式问题（可快速修复）、CapabilityGuard 安全策略一致性、以及 ProcessMessage schema 与实现的对齐。

---

_审计工具: Arch Auditor Agent v2.0_
_覆盖子模块: process, memory, ipc, resource, journal, scheduler, supervisor, observability, security, mission, api, facade, abstractions, context_
_下次建议审计: 2026-04-01_
