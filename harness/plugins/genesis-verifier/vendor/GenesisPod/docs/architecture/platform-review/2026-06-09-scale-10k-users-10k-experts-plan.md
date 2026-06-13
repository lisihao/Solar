# 规模化四项落地方案（数万用户 × 数万专家）

> **日期**：2026-06-09（经 5 路集中审视 + 重读最新代码后**整体重写**，取代初稿——初稿基于 W2 重构前的过时读取）
> **状态**：Proposed
> **基线**：W2「能力即产品」已落地——deep-insight 现以 `MissionPipelineOrchestrator + recipe(14 阶段) + DeepInsightStageBindings + 三端口` 运行（权威设计见 [capability-execution-architecture.md](../capability-execution-architecture.md)）。本文**不重设计执行架构**，只补它未覆盖的四项落地。
> **正交**：与 [multi-tenancy-org-model-adr.md](./multi-tenancy-org-model-adr.md)（不引入 Organization）正交。

---

## 0. 现状基线（重读最新代码确认）

| 事实                                            | 证据                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 能力内核**已自带 crash-resume**                 | `deep-insight.runner.ts:220` `persistence.loadCheckpoint` 续跑、`:240` orchestrator.run 透传 `signal`/`resumeFromStepId`、`:283/:297` `applyTerminal` 落终态                                                                                                     |
| 但 company **没注入持久化端口** → 退回 InMemory | runner `:165` `ctx.persistence ?? new InMemoryPersistencePort()`；company `runViaCapability:581` 调 `runner.run` 只传 userId/missionId/onEvent/signal，**不传 persistence** → company mission **无 checkpoint/resume**，仅 run 结束后 `updateMission` 落最终结果 |
| company **已读 14 阶段锚点**                    | `bridgeCapabilityEvent:744`，`:763/:887` 读 `event.telemetry.systemStageId`，映射 company 三桶（planning/execution/review），`:107` 保留 6 阶段兜底                                                                                                              |
| company mission **裸 fire-and-forget**          | `:203` `void this.runMission`、`:243` `void this.runHeroMission`，无队列/重投/背压                                                                                                                                                                               |
| 运行态全进程内 Map                              | abortControllers `:131`、collabBuffers `:136`、liveTaskState `:144`                                                                                                                                                                                              |
| 验收 gate **已实装在运行路径**                  | `:647-686` rubric passThreshold/maxAttempts + 不达标递归 `runViaCapability(attempt+1)`                                                                                                                                                                           |
| recipe **已是声明式配置但是代码常量**           | `deep-insight.recipe.ts:94` `PLAYGROUND_PIPELINE: MissionPipelineConfig`（roles[] + steps[]{primitive,roleId,mode,dag}）；`:33` `buildSkillSpecFromMd` 从磁盘 SKILL.md 读；`MissionPipelineRegistry`/`CapabilityRegistry` 进程内 onModuleInit 注册               |
| 新建专家 = 代码                                 | recipe 常量 + 8× SKILL.md + `DeepInsightStageBindings`（wiring）+ runner + onModuleInit register + manifest                                                                                                                                                      |

> **核心洞察（决定排序）**：**item 1 的 crash-resume 与 item 4 的 W4 是同一个交付物**——给 company 实现 `MissionPersistencePort` 适配器，同时拿到「崩溃可恢复」+「company 真持久化」。内核已具备能力，company 只是没接上。

---

## 1. 数万用户 / 可靠性（轴 B）

> 价值最高、现在就存在、权威文档未覆盖。**单 pod 也是 bug**（进程重启丢 mission）。

### 1.1 company-mission 入 BullMQ（复用 agents-task 范式）

- 新 `CompanyMissionQueueService`（照 `agents-task-queue.service.ts`）：`QUEUE_NAME="company-mission"`、`enqueue(missionId, payload, {jobId:missionId, attempts, backoff, removeOnComplete/Fail})`、`onModuleInit` boot recovery 扫 `status in (queued,running)` 重投（jobId 幂等）。
- 新 `CompanyMissionProcessor`（照 `agents-task.processor.ts`）：`@Processor("company-mission",{concurrency})` + `WorkerHost.process()` 调现有 `runHeroMission`/`runMission`（执行体不动）。
- `company.module.ts` 加 `BullModule.registerQueue({name:"company-mission"})`（root 已由 RadarModule 全局注册）。
- `createHeroMission/createMission` 的 `void this.runX()`（:203/:243）→ `await queue.enqueue()`。
- **多 pod 防双执行/双计费**：processor 开头 Redis `SETNX company:mission:{id}:lock`（boot recovery 仅在 lock 空时重投）；processor 显式注入 `billing.userId`（否则下游抛 `Refused: no userId`）。
- **验收重跑 processor 化**：现 `runViaCapability(attempt+1)` 是 app 层递归（:675）；迁队列后 attempt 由 processor 维护（避免同 job 多轮 collab/live 缓冲混淆）。
- **verify**：单测 enqueue 幂等 + 杀进程 boot-recovery 重投；行为与旧 fire-and-forget 等价（回归）。

### 1.2 实现 company `MissionPersistencePort`（= item 4 W4，一鱼两吃）

- 新 `company-mission-persistence.adapter.ts implements MissionPersistencePort`：`saveCheckpoint`→写 company mission 行 JSON 列、`loadCheckpoint`→读回、`applyTerminalIfRunning`→`UPDATE company_missions … WHERE status='running'`（首写赢）、`markStageProgress`/`clearCheckpoint`。
- `runViaCapability:581` 的 ctx 加 `persistence: <adapter>`。
- **效果**：内核既有 crash-resume 对 company **真正生效**（崩溃/重投后从 checkpoint 续跑，不从头）。
- **verify**：杀 worker 后重投，mission 从 `last checkpoint` 续跑而非重跑；终态条件写不双写。

### 1.3 运行态搬 Redis

- `collabBuffers`/`liveTaskState`（:136/:144）→ Redis Hash/List + TTL；`persistLiveProgress`（:906 一带）写 Redis，落库逻辑不变。
- **分布式 abort**：`abortControllers`（:131）→ Redis cancel 频道。`cancelMission` `SET/PUBLISH company:cancel:{missionId}`；起跑 worker 订阅 → 调本地 `AbortController.abort()`。内核 `run()` 已透传 `ctx.signal` 给 orchestrator（:245），orchestrator 尊重 signal → 取消真生效。
- **verify**：B pod 发取消，A pod 上运行的 mission 真中止；collab/live 跨 pod 可读。

### 1.4（仅多 pod 触发）分布式限流 + WS 跨 pod

- per-provider Redis token bucket（`ioredis` + Lua，按 token 成本算 TPM/RPM；不用 `@nestjs/throttler`，那是 HTTP 请求级抽象错位）。
- 装 `@socket.io/redis-adapter`（当前未装），WS 房间 fanout 跨 pod。
- **触发**：实际部署 ≥2 pod 那天；单 pod 不做。

> **轴 B 排序**：1.1+1.2+1.3 = P0 可靠性包（单 pod 正确性，先做）；1.4 待多 pod。基建已备：`bullmq`/`ioredis`/`cache-manager`/`@nestjs/throttler` 已在 deps。

---

## 2. 专家数据化（recipe → DB）— 解锁数万专家

> **触发条件**：路线图确有 ≥3–5 个不同专家类型在排队（rule of three）。当前仅 1 个能力，**暂缓**——现在做是为不存在的用例抽象。

**现状已对一半**：recipe 已是声明式 `MissionPipelineConfig`，`MissionPipelineOrchestrator` 已能执行**任意** config。缺的只是「config 从代码常量 + 磁盘 SKILL.md → DB 数据」。

- **2.1** 新表 `capability_manifests`（id/version/kind/title/rubric/missionType/status）+ `capability_recipes`（recipe = 序列化的 `MissionPipelineConfig`，去掉 code hooks，留 `bindingsKey` 指向代码 bindings）；SKILL.md 正文 → DB/对象存储（替代 `buildSkillSpecFromMd` 的 fs 读）。手写 SQL 迁移。
- **2.2** `CapabilityRegistry.resolve` → DB-backed + cache-manager 缓存；`MissionPipelineRegistry` resolve 时按 DB 行注册 config（绑 `bindingsKey` 的代码 bindings）。
- **2.3** marketplace 目录分页/搜索 + cache（去 `getCatalog()` O(n) 全量重算）。
- **硬边界（诚实）**：数据化覆盖 **config + skill 正文**；`StageBindings`（每 stage 的编排代码 hooks）**仍是代码**。→ 同拓扑新专家 = 纯数据（换 recipe + SKILL.md，复用 bindings）；**新拓扑 = 新 bindings 代码**（见 item 3）。
- **verify**：注入数万 manifest，目录 P95<200ms；新增 manifest 任意 pod 立即 resolve 并跑通。

---

## 3. 降低新建专家成本

> 与 item 2 同触发（频繁加专家才回本）。降的是**新建成本**（item 2 降的是**规模存储**）。

**现状**：加一个专家 = recipe 常量 + 8× SKILL.md + bindings + runner + register + manifest。其中 bindings 头注释明示「只是 wiring，不重写 prompt」，agent/skill 共享。

- **3.1 脚手架**：一个生成器（脚本/模板）一键 stamp 新能力骨架（recipe 模板 + SKILL.md stub + runner 注册 + manifest），消灭样板。
- **3.2 复用 bindings**：把通用 wiring（plan/research/synthesize/draft/review/signoff/persist 七原语的标准接线）抽成可复用基类；同拓扑专家直接复用，只有差异 stage 写自定义 hook。**按 rule of three——第 2/3 个专家出现时再抽**。
- **3.3 文档化**：把「加一个专家」的步骤从口口相传写成 SOP（接 [capability-execution-architecture.md](../capability-execution-architecture.md) §8 文件索引）。
- **verify**：用脚手架新建一个 demo 专家，从 0 到能 adopt+run 的步骤数/文件数较现状下降且可量化。

---

## 4. company 拿到真 14 阶段（W4/W5，对齐权威文档）

> 大部分已就绪，**不重设计**，按 [capability-execution-architecture.md](../capability-execution-architecture.md) W4/W5 补接线。

**现状（重读确认）**：runner 已跑 14 阶段；company `bridgeCapabilityEvent` 已读 `systemStageId`（:763）。**唯一实质缺口 = company 未注入 `MissionPersistencePort`** → 见 **item 1.2**（同一交付物）。

- **4.1** = **item 1.2**（company 持久化适配器 + 注入 ctx）。做完即 W4：company 拿到内核真持久化 + crash-resume。
- **4.2（W5）** 前端 14-chip：`bridgeCapabilityEvent` 已把 systemStageId 落 company.\* 事件；前端消费 hook 读 `systemStageId` → 点亮**已存在**的 14-chip + 任务列表 14 步（复用既有组件，遵守前端 UI 复用红线，缺口 chip 停下问用户）。
- **verify**：company hero mission 14 chip 按 systemStageId 实时点亮；report/usage 落 company 库；杀 worker 续跑（4.1 兼得）。

---

## 5. 排序与依赖（一张图）

```
P0（收尾后立即，单 pod 正确性 + company 补齐）
  1.1 BullMQ 队列 + boot recovery + 防双执行/双计费
  1.2 = 4.1  company MissionPersistencePort（crash-resume + W4 一鱼两吃）★最高 ROI
  1.3 运行态搬 Redis（collab/live + 分布式 abort）
  4.2 前端 14-chip 接线（W5，低风险）

P1（实际多 pod 那天）
  1.4 分布式限流（ioredis token bucket）+ @socket.io/redis-adapter

DEFERRED（≥3–5 专家类型在排队才触发，否则 YAGNI）
  2.x 专家数据化（recipe/manifest → DB + 注册表从库读 + 目录分页）
  3.x 新建成本（脚手架 + 复用 bindings + SOP）
```

**依赖**：1.2 是枢纽（同时给可靠性 crash-resume 和 W4）；2.x 依赖 1.x 的运行态外置稳定后再叠加；3.2 依赖第 2/3 个真实专家出现（rule of three）。

---

## 6. 不在本文范围（避免重复造轮子）

- 执行架构（orchestrator/recipe/bindings/三端口）—— [capability-execution-architecture.md](../capability-execution-architecture.md) 权威，已 W2 落地。
- 第三方/沙箱/远程 capability 实现、权限枚举 —— manifest 注释已指向 plugin isolated-vm，未来议题。
- 租户/Organization 模型 —— [multi-tenancy ADR](./multi-tenancy-org-model-adr.md) 已决定不做。

---

**维护者**：Claude Code · **关联**：[[project_capability_datafication_deferred_2026_06_09]]（memory）· [capability-execution-architecture.md](../capability-execution-architecture.md)
