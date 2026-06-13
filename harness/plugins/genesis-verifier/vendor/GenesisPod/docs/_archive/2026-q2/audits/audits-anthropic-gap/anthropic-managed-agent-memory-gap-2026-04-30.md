# Memory + Session + Checkpoint vs Anthropic Managed Agent 差距审计

**审计日期**: 2026-04-30
**审计范围**: ai-harness/memory/、ai-harness/execution/context/、ai-harness/process/checkpoint/、ai-app/agent-playground/

---

## Section 1: Memory 维度

### 1.1 存储层架构

项目实现了三个独立的 memory 存储栈，无统一抽象：

| 存储栈                    | 实现                                            | 后端                       | 适用场景                       |
| ------------------------- | ----------------------------------------------- | -------------------------- | ------------------------------ |
| VectorStore               | PrismaVectorStore / InMemoryVectorStore         | `harness_vector_memory` 表 | 语义召回，mission postmortem   |
| CheckpointStore           | PrismaCheckpointStore / InMemoryCheckpointStore | `harness_checkpoints` 表   | agent 执行快照                 |
| ProcessMemoryManager      | ProcessMemoryManagerService                     | `process_memories` 表      | 进程级 KV，按 MemoryLayer 分层 |
| HierarchicalMemoryCascade | HierarchicalMemoryCascadeService                | **纯内存 Map**             | org/team/project/session 4 级  |
| MemoryBridge              | 委托 MemoryCoordinatorService                   | —                          | 召回后注入 envelope            |

### 1.2 与 Anthropic 类型分类对比

Anthropic：4 种 type（user/feedback/project/reference）+ MEMORY.md 索引始终注入 + 子文件按需 Read。

我们：用 `tags[]` 分类而非 type 字段：

- `['agent-playground', 'mission-postmortem', 'signed']` 对应 feedback / project
- `MemoryBridge.StoreOptions.type`: `'conversation'|'working'|'preference'|'knowledge'|'summary'` 仅作委托参数，不持久化

**差距**：无独立 `user` 偏好型 memory；无 `reference` 只读知识库；postmortem 与 user pref 未隔离。

### 1.3 S12 → Leader plan 闭环（与既往 memory 状态有变化）

**已修复（2026-04-29）**：

- S12 写入 `harness_vector_memory`：`s12-self-evolution.stage.ts:249-265` → `mission-store.service.ts:498-520`
- S2 读取 postmortem：`s2-leader-plan-mission.stage.ts:52-65` 调 `listRecentPostmortems(userId, 3)`
- `plan.md` duty 模板 `{{#if priorPostmortems.length}}` 渲染历史教训

**仍存在的 3 个关键缺口**：

#### 缺口 A：postmortem 写入时 `embedding: []`（最严重）

`mission-store.service.ts:504`:

```ts
embedding: [],
```

embedding 恒空数组，`listRecentPostmortems` 靠 `namespace + tags` 过滤（`mission-store.service.ts:562-570`），**而非语义向量召回**。同 userId 不同 topic 的 postmortem 平等返回，无法按相关性优先召回"最相似 topic 的历史教训"。`MemoryAutoIndexer` 的 embed 能力（`memory-auto-indexer.ts:72`）完全未被 S12 调用。

#### 缺口 B：两套 CheckpointService 不互通

- `ai-harness/process/checkpoint/checkpoint.service.ts` (MissionCheckpointService，stage 级)
- `ai-harness/memory/checkpoint/checkpoint.service.ts` (CheckpointService，agent 级 envelope 快照)

**完全独立两个类，不共享底层 store，不互相感知**。`TeamMission` 注入前者（`team.mission.ts:163`），`HarnessedAgent` 自动触发后者（`harnessed-agent.ts:273-289`）。Mission 层不知 agent 层在哪 checkpoint，agent 层不知 mission 哪个 stage。

#### 缺口 C：HierarchicalMemoryCascade 纯内存

`hierarchical-memory-cascade.service.ts:49-53`：

```ts
private readonly store = new Map<string, Map<...>>()
```

4 级层叠记忆（org/team/project/session）纯内存，**Railway 容器重启后全部清零**。未接 ProcessMemoryManager 或 PrismaVectorStore 持久化。与 Anthropic 文件持久化形成根本差距。

### 1.4 MemoryAutoIndexer 链路状态

- **写入侧完整**：`indexAgentTrajectory()` 从 envelope.messages + events 抽取，embed 写入 PrismaVectorStore（`memory-auto-indexer.ts:56-119`）
- **消费侧断裂**：`MemoryBridge.preExecute()` 在 agent 执行前召回（`memory-bridge.service.ts:48-97`），但 playground `TeamMission.runMission()` 未直接调用。`MissionDeps` 无 `memoryBridge` 字段（`mission-deps.ts:63-100`）

---

## Section 2: Session / Checkpoint 维度

### 2.1 Layer 1：Agent 级快照（CheckpointService）

- **触发**：每 N 个 `action_executed` 自动（`harnessed-agent.ts:269-289`），terminated 前强制（`harnessed-agent.ts:293-310`）
- **内容**：完整 envelope + identity + eventsEmitted + taskSnapshot
- **存储**：JSONB，`@@index([agentId, takenAt(sort: Desc)])`
- **恢复**：`HarnessFacade.resume()` (`harness.facade.ts:98-121`)
- **Fork**：`HarnessFacade.fork()` 完整 (`harness.facade.ts:134-172`)

**局限**：默认用 `InMemoryCheckpointStore`，需显式注入 Prisma 版才持久化。**反序列化后 ContextEnvelope 是 plain object，类方法不重建**（`prisma-checkpoint-store.ts:9`），`HarnessFacade.resume()` 未补 ctor 重建步骤。

### 2.2 Layer 2：Mission 级断点（MissionCheckpointService）

- **粒度**：stage 完成后 `save(missionId, payload, completedKeys)`
- **恢复**：`canResume()` 检查 24h + status，`resumeFromCheckpoint()` 返回 completedKeys 让 stage 跳过
- **克隆**：`cloneCheckpoint(fromMissionId, toMissionId)` 用于 rerun

**严重局限**：playground `TeamMission.runMission()` **正常 stage 完成后未调 `missionCheckpoint.save()`**。只有 retry 场景调 `canResume()`。**Mission 中途宕机后无法从断点恢复，从头重跑**。

### 2.3 Session 自动 resume / fork 对比

| Anthropic                         | 我们                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `--continue` 自动 resume 上次对话 | 无 session 级 resume，只有 agent 级显式恢复                                       |
| auto-compact 长对话压缩           | ContextCompactor 已实现（`context-compactor.ts:69-163`），但是 pull 模式不是 push |
| Session fork                      | `HarnessFacade.fork()` 完整，但是 agent 级，前端无 UI                             |
| Long-running mission retry        | `cloneCheckpoint()` 存在，需用户手动重提交                                        |

---

## Section 3: Context Engineering 维度

### 3.1 System Prompt 多层组装

- `envelope.system` → 主 system prompt
- `envelope.reminders[]` → 动态 reminder（memory recall、budget warning）
- `envelope.messages[]` → 对话历史
- `envelope.tools[]` → 工具描述

`MemoryBridge.formatRecalled()` 把召回结果格式化为 `## Relevant memories recalled:` 块注入（`memory-bridge.service.ts:160-169`）。

agent-playground 的 leader/researcher/writer 用 `buildPromptFromDuty()` 从 `.md` Handlebars 渲染（`leader.agent.ts:295`），与 CLAUDE.md + SKILL.md 多层注入理念一致。

**差距**：无 MEMORY.md 索引文件自动注入机制。`listRecentPostmortems` 是硬编码 tag filter，不是 agent 主动决策召回哪类 memory。

### 3.2 Cache 命中策略

`CacheControlPlanner`（`cache-control-planner.ts`）：

- prefix >= 4096 chars 触发（Anthropic 最低 1024 token）
- system + high-priority non-transient reminders 打 5m TTL breakpoint
- 最多 3 个 breakpoints

**关键差距**：`CacheControlPlanner.plan()` 输出 `SharedCachePrefix` 对象，**未在 `ContextManager.ensureBudget()` 调用链中体现**（`context-manager.ts:44-84`）。需确认是否传给 `AiChatService.chat()`。**如未接，Anthropic prompt cache 优化形同虚设**。

### 3.3 压缩策略

`ContextCompactor`（`context-compactor.ts`）：

- 触发：estimateEnvelopeTokens > 8000
- 方式：LLM 摘要（`creativity:'low'`）
- 降级：LLM 失败保留原 envelope
- 元数据：`compactedAt` / `compactedCount`

**差距**：pull 模式（调用方手动调 `ensureBudget()`），不是 push 模式（接近上限自动）。**未在 ReActLoop 每轮 reason 前自动调用**。

### 3.4 Priority Pruner

reminders > 16 条按 priority + transient 裁剪保留最新 4 条。粒度粗（不裁 messages）。

---

## Section 4: 能力差距矩阵

| #      | Anthropic 能力                   | 我们现状                                | 差距   | 优先级 | 工作量            |
| ------ | -------------------------------- | --------------------------------------- | ------ | ------ | ----------------- |
| M1     | 4 种 type 文件型 memory          | tags 分类，无 type                      | 中     | P2     | 2-3d              |
| M2     | MEMORY.md 索引 + agent 自主 Read | S2 硬编码 listRecentPostmortems         | 高     | P1     | 3-5d              |
| **M3** | **postmortem 语义召回**          | **embedding=[] 退化为 tag filter**      | **高** | **P0** | **1-2d**          |
| M4     | Session 自动 resume              | 只有 agent 级显式恢复                   | 高     | P2     | 5-7d              |
| M5     | Auto-compact 透明压缩            | ContextCompactor 非自动                 | 中     | P1     | 1d                |
| M6     | Session fork                     | fork 已实现，无 UI                      | 低     | P3     | 2-3d              |
| C1     | 工具前自动 checkpoint            | auto-interval 已实现                    | 低     | P2     | 已有，确认生产 DI |
| **C2** | **任意 checkpoint 回滚**         | **resume 后 envelope plain object**     | **中** | **P1** | **1d**            |
| **C3** | **Mission 中途自动恢复**         | **TeamMission 正常路径未写 checkpoint** | **高** | **P0** | **2-3d**          |
| C4     | HierarchicalMemory 持久化        | 纯内存进程重启全丢                      | 高     | P1     | 2-3d              |
| **E1** | **Prompt cache 自动标记**        | **CacheControlPlanner 未接 LLM 调用链** | **中** | **P1** | **1d**            |
| E2     | Memory 自动分类提取              | postExecute playground 未调             | 中     | P1     | 1d                |
| S1     | S12 → S2 教训注入                | 已闭环（写入+召回+duty 渲染）           | ✅     | —      | (M3 是质量问题)   |

### 关键结论

**已闭环（相对既往进步）**：

- S12 → S2 链路打通（写入+召回+duty 模板）
- Agent 级 checkpoint 快照
- ContextCompactor 长对话压缩
- HarnessFacade.fork() 完整

**最高优先级 P0**：

1. **M3 postmortem embedding=[]**：1-2 天修复，改 S12 调 MemoryAutoIndexer 写真实 embedding
2. **C3 mission 进程重启从头重跑**：2-3 天，team.mission.ts 各 stage 完成后调 missionCheckpoint.save()

**P1 中优先级**：3. C2 resume 后类方法不可用：1 天补 ContextEnvelope ctor 重建 4. C4 HierarchicalMemory 持久化：1-2 天接 ProcessMemoryManagerService 5. E1 CacheControlPlanner 未接 LLM 调用链：1 天验证并接通 6. E2 MemoryBridge.postExecute 未在 mission 完成后调用

**根本差距**：7. M2 memory 召回是硬编码而非 agent 自主决策——Anthropic 中 agent 自己选择读哪个 memory，我们的 leader 被动接受注入 8. M4 无 session 级自动 resume
