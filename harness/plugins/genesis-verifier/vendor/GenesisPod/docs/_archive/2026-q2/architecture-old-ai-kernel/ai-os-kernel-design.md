# AI OS Kernel 架构设计

> 基于 Genesis AI Engine 现状的演进路径，将 AI Engine 从 "能力库" 升级为 "AI 操作系统内核"

## 1. 核心概念澄清

### 1.1 Kernel 管理的不是 Agent，是 Process

| 概念                       | 传统 OS            | AI OS                      | 当前系统对应                        |
| -------------------------- | ------------------ | -------------------------- | ----------------------------------- |
| **程序 (Program)**         | 磁盘上的二进制文件 | Agent Definition（模板）   | `BaseAgent` / `PlanBasedAgent` 子类 |
| **进程 (Process)**         | 运行中的程序实例   | Agent Process（执行实例）  | `MissionExecutionState`（内存 Map） |
| **线程 (Thread)**          | 进程内的执行单元   | Step Execution（步骤执行） | `ExecutionStep`                     |
| **进程组 (Process Group)** | 协作的多个进程     | Team Session（团队会话）   | `Team` + `MissionOrchestrator`      |
| **作业 (Job)**             | 批处理任务         | Mission（用户任务）        | `MissionInput` → `MissionResult`    |
| **守护进程 (Daemon)**      | 后台长驻服务       | Long-running Agent         | 不存在 ← **缺失**                   |
| **Init 进程 (PID 1)**      | 系统启动器         | Kernel Bootstrap           | `AiEngineModule.onModuleInit()`     |

**关键洞察**：当前系统的 `Agent`（如 `SlidesAgent`, `DocsAgent`）是**无状态的类定义**——相当于 `/usr/bin/python`。它们本身不需要被"管理"。Kernel 需要管理的是**每次用户请求产生的执行实例**，即 Process。

### 1.2 当前系统的进程模型（隐式的）

当前系统其实已经有一个隐式的"进程"概念，只是散落在不同地方：

```
用户请求 "帮我做一个深度研究"
    │
    ▼
MissionOrchestrator.execute()  ← 这就是"创建进程"
    │
    ├── states.set(missionId, state)     ← 进程表（内存 Map）
    ├── originalInputs.set(missionId)    ← 进程参数
    ├── missionTraces.set(missionId)     ← 进程审计日志
    │
    ├── Phase: Parse   → 意图解析       ← 进程执行阶段
    ├── Phase: Plan    → 生成计划
    ├── Phase: Execute → 执行步骤
    │   ├── Step 1: Member A 执行       ← 线程 1
    │   ├── Step 2: Member B 执行       ← 线程 2
    │   └── Step 3: Leader 整合         ← 线程 3
    ├── Phase: Review  → 审核
    └── Phase: Deliver → 交付
    │
    ▼
MissionResult  ← 进程退出码 + 输出
```

**问题**：这个"进程"全在内存里。`states` 是 `Map<string, MissionExecutionState>`，进程死了就没了。

### 1.3 AI OS Kernel 的分层定位

```
┌──────────────────────────────────────────────────────────┐
│  AI Apps (Research, Writing, Office, Teams, Social...)   │  ← 用户态应用
├──────────────────────────────────────────────────────────┤
│  AI OS Kernel                                            │  ← 新增层
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Process  │ │ Memory   │ │ Security │ │ Scheduler  │  │
│  │ Manager  │ │ Manager  │ │ Manager  │ │            │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ IPC      │ │ Resource │ │ Event    │ │ Durable    │  │
│  │ (A2A)    │ │ Quotas   │ │ Journal  │ │ Execution  │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
├──────────────────────────────────────────────────────────┤
│  AI Engine (Capabilities)                                │  ← 现有层（不变）
│  LLM · Tools · Skills · RAG · Teams · MCP               │
├──────────────────────────────────────────────────────────┤
│  Infrastructure                                          │  ← 基础设施
│  PostgreSQL · Redis · LiteLLM · External APIs            │
└──────────────────────────────────────────────────────────┘
```

**关键决策**：Kernel 不替代 AI Engine，而是在其之上提供运行时管理。AI Engine 仍然是"能力提供者"，Kernel 是"能力编排和生命周期管理者"。

---

## 2. Kernel 子系统设计

### 2.1 Process Manager（进程管理器）

#### 2.1.1 Process 数据模型

```prisma
// ==================== AI OS Kernel Models ====================

/// Agent Process — Kernel 管理的核心实体
/// 对应传统 OS 的 "进程"
model AgentProcess {
  id            String         @id @default(uuid())

  // ── 身份 ──
  /// 使用的 Agent 定义（如 "research-agent", "slides-agent"）
  agentDefId    String
  /// 所属用户
  userId        String
  /// 所属租户（多租户隔离）
  tenantId      String
  /// 父进程 ID（Team Session 中 Leader 创建子进程）
  parentId      String?
  /// 会话 ID（同一用户对话可能产生多个进程）
  sessionId     String?

  // ── 生命周期 ──
  /// 进程状态
  state         ProcessState   @default(CREATED)
  /// 进程优先级（0=最低, 10=最高, 默认5）
  priority      Int            @default(5)
  /// 退出码（正常=0, 错误=非0）
  exitCode      Int?
  /// 退出消息
  exitMessage   String?

  // ── 资源配额 ──
  /// 最大 Token 预算
  tokenBudget   Int            @default(100000)
  /// 最大执行时间（毫秒）
  timeoutMs     Int            @default(600000)
  /// 最大成本（积分）
  costBudget    Float          @default(100)
  /// 已消耗 Token
  tokensUsed    Int            @default(0)
  /// 已消耗成本
  costUsed      Float          @default(0)

  // ── 能力清单 ──
  /// 授权的工具 ID 列表（空=全部可用）
  grantedTools  String[]       @default([])
  /// 授权的技能 ID 列表
  grantedSkills String[]       @default([])
  /// 授权的数据范围（如只能访问某些 knowledgeBase）
  dataScope     Json?

  // ── 检查点 ──
  /// 最新检查点数据（序列化的执行状态）
  checkpoint    Json?
  /// 检查点版本号（用于乐观锁）
  checkpointVer Int            @default(0)

  // ── 输入输出 ──
  /// 进程输入（MissionInput 序列化）
  input         Json
  /// 进程输出（MissionResult 序列化）
  output        Json?

  // ── 时间戳 ──
  createdAt     DateTime       @default(now())
  startedAt     DateTime?
  pausedAt      DateTime?
  completedAt   DateTime?

  // ── 关系 ──
  parent        AgentProcess?  @relation("ProcessTree", fields: [parentId], references: [id])
  children      AgentProcess[] @relation("ProcessTree")
  events        ProcessEvent[]
  memorySlots   ProcessMemory[]

  @@index([userId, state])
  @@index([tenantId, state])
  @@index([parentId])
  @@index([state, priority])
  @@map("agent_processes")
}

/// 进程状态枚举
enum ProcessState {
  CREATED      // 已创建，等待调度
  READY        // 就绪，可以执行
  RUNNING      // 正在执行
  PAUSED       // 已暂停（用户主动或资源不足）
  WAITING      // 等待（等待子进程、等待人工审批、等待外部回调）
  COMPLETED    // 正常完成
  FAILED       // 执行失败
  CANCELLED    // 用户取消
  ZOMBIE       // 僵死（超时未响应，等待清理）
}

/// 进程事件日志 — Durable Execution 的核心
/// 记录进程生命周期中的每一个状态变化
model ProcessEvent {
  id          String       @id @default(uuid())
  processId   String
  /// 单调递增序号（用于重放）
  sequence    Int
  /// 事件类型
  eventType   String
  /// 事件数据
  payload     Json
  /// 时间戳
  timestamp   DateTime     @default(now())

  process     AgentProcess @relation(fields: [processId], references: [id], onDelete: Cascade)

  @@unique([processId, sequence])
  @@index([processId, sequence])
  @@map("process_events")
}

/// 进程记忆槽 — 每个进程独立的记忆空间
model ProcessMemory {
  id          String       @id @default(uuid())
  processId   String
  /// 记忆层级
  layer       MemoryLayer
  /// 键
  key         String
  /// 值
  value       Json
  /// 过期时间（工作记忆会过期，长期记忆不会）
  expiresAt   DateTime?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  process     AgentProcess @relation(fields: [processId], references: [id], onDelete: Cascade)

  @@unique([processId, layer, key])
  @@index([processId, layer])
  @@map("process_memory")
}

enum MemoryLayer {
  WORKING      // 工作记忆（当前任务上下文，进程结束后可清理）
  SESSION      // 会话记忆（跨步骤共享，进程结束后保留一段时间）
  SHARED       // 共享记忆（Team 内多个进程共享的黑板）
  PERSISTENT   // 持久记忆（跨进程、跨会话的长期知识）
}
```

#### 2.1.2 进程生命周期状态机

```
                    ┌─────────────┐
         create()   │   CREATED   │
         ─────────► │             │
                    └──────┬──────┘
                           │ schedule()
                    ┌──────▼──────┐
                    │    READY    │◄──────────── resume()
                    │             │              (from PAUSED)
                    └──────┬──────┘
                           │ dispatch()
                    ┌──────▼──────┐
              ┌────►│   RUNNING   │◄──── retry()
              │     │             │
              │     └──┬───┬──┬───┘
              │        │   │  │
              │ resume()│   │  │ pause() / wait()
              │        │   │  │
              │  ┌─────▼┐ │ ┌▼────────┐
              │  │PAUSED │ │ │ WAITING │
              │  └───────┘ │ └─────────┘
              │            │
              │     ┌──────┴──────────────────┐
              │     │                         │
        ┌─────▼─────▼─┐  ┌──────────┐  ┌─────▼─────┐
        │  COMPLETED   │  │  FAILED  │  │ CANCELLED │
        │  (exit=0)    │  │ (exit>0) │  │ (exit=-1) │
        └──────────────┘  └────┬─────┘  └───────────┘
                               │
                          timeout?
                          ┌────▼─────┐
                          │  ZOMBIE  │ → Supervisor 清理
                          └──────────┘
```

#### 2.1.3 ProcessManager 服务接口

```typescript
/**
 * AI OS Kernel - Process Manager
 *
 * 管理 Agent Process 的完整生命周期。
 * 对标传统 OS 的 fork/exec/wait/kill。
 */
@Injectable()
export class ProcessManager {
  // ── 进程创建 ──

  /**
   * 创建新进程（类似 fork + exec）
   *
   * @param def - Agent 定义 ID（从 AgentRegistry 获取模板）
   * @param input - 进程输入（MissionInput）
   * @param options - 资源配额、优先级、能力授权等
   * @returns 进程 ID
   */
  async spawn(
    def: AgentDefId,
    input: MissionInput,
    options: SpawnOptions,
  ): Promise<ProcessId>;

  /**
   * 创建子进程（Team Leader 创建 Member 执行子任务）
   * 子进程继承父进程的部分资源配额和数据范围
   */
  async fork(
    parentId: ProcessId,
    def: AgentDefId,
    input: MissionInput,
    options?: Partial<SpawnOptions>,
  ): Promise<ProcessId>;

  // ── 生命周期控制 ──

  /**
   * 暂停进程（保存当前检查点，释放资源）
   * 用途：用户离开页面、资源紧张时主动降级
   */
  async pause(processId: ProcessId): Promise<void>;

  /**
   * 恢复进程（从最新检查点恢复执行）
   * 这是 Durable Execution 的核心：崩溃后也能从这里恢复
   */
  async resume(processId: ProcessId): Promise<void>;

  /**
   * 取消进程（发送取消信号，优雅终止）
   */
  async cancel(processId: ProcessId, reason?: string): Promise<void>;

  /**
   * 强制终止进程（不等待清理，立即回收资源）
   */
  async kill(processId: ProcessId): Promise<void>;

  /**
   * 等待进程完成（阻塞直到进程结束）
   */
  async wait(processId: ProcessId, timeoutMs?: number): Promise<ProcessResult>;

  // ── 状态查询 ──

  /**
   * 获取进程状态
   */
  async getState(processId: ProcessId): Promise<ProcessSnapshot>;

  /**
   * 列出用户的所有活跃进程
   */
  async listByUser(
    userId: string,
    filter?: ProcessFilter,
  ): Promise<ProcessSummary[]>;

  /**
   * 获取进程树（父进程 + 所有子进程）
   */
  async getProcessTree(processId: ProcessId): Promise<ProcessTree>;
}

interface SpawnOptions {
  /** 用户 ID */
  userId: string;
  /** 租户 ID */
  tenantId: string;
  /** 优先级 (0-10) */
  priority?: number;
  /** Token 预算 */
  tokenBudget?: number;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 成本预算（积分） */
  costBudget?: number;
  /** 授权的工具列表（空=继承 Agent 定义的默认工具） */
  grantedTools?: ToolId[];
  /** 授权的技能列表 */
  grantedSkills?: SkillId[];
  /** 数据访问范围 */
  dataScope?: DataScope;
  /** 父进程 ID（自动设置，fork 时使用） */
  parentId?: ProcessId;
  /** 会话 ID */
  sessionId?: string;
}
```

### 2.2 Scheduler（调度器）

#### 2.2.1 调度策略

```typescript
/**
 * AI OS Kernel - Scheduler
 *
 * 从 READY 队列中选择下一个要执行的进程。
 * 考虑优先级、公平性、资源可用性。
 */
@Injectable()
export class KernelScheduler {
  /**
   * 调度循环（由定时器或事件触发）
   *
   * 策略：Priority + Fair-Share
   * 1. 按优先级排序 READY 进程
   * 2. 同优先级内，按租户公平分配（防止单租户饥饿）
   * 3. 检查资源可用性（并发 LLM 调用数、总 token 预算）
   * 4. 将选中的进程状态改为 RUNNING，分发给 Worker
   */
  async scheduleNext(): Promise<DispatchResult[]>;

  /**
   * 抢占：高优先级进程可以暂停低优先级进程
   * 场景：用户主动操作（优先级10）抢占后台批处理（优先级2）
   */
  async preempt(processId: ProcessId, reason: string): Promise<void>;
}

/**
 * 调度配置（可通过环境变量调整）
 */
interface SchedulerConfig {
  /** 最大并发运行进程数 */
  maxConcurrentProcesses: number; // default: 50
  /** 单租户最大并发数 */
  maxPerTenant: number; // default: 10
  /** 调度间隔（毫秒） */
  scheduleIntervalMs: number; // default: 1000
  /** 是否启用抢占式调度 */
  enablePreemption: boolean; // default: false (Phase 2)
}
```

#### 2.2.2 Worker 分发

```
Phase 1（单进程，当前架构）:
  Scheduler → 直接调用 MissionOrchestrator.execute()
  简单但够用，不需要消息队列

Phase 2（多 Worker，未来）:
  Scheduler → BullMQ Job Queue → Worker Pool
  每个 Worker 是一个独立的 NestJS 进程
  通过 Redis 共享任务队列

  ┌──────────┐     ┌───────────┐     ┌──────────┐
  │Scheduler │────►│  BullMQ   │────►│ Worker 1 │
  │          │     │  (Redis)  │────►│ Worker 2 │
  │          │     │           │────►│ Worker 3 │
  └──────────┘     └───────────┘     └──────────┘
```

**Phase 1 可以不引入 BullMQ**，只需要把 `MissionOrchestrator` 的内存 Map 换成数据库。调度器就是一个定时查询 `WHERE state = 'READY' ORDER BY priority DESC` 的服务。

### 2.3 Event Journal（事件日志 — Durable Execution 的核心）

这是从 "内存态" 升级为 "AI OS" 的**最关键**一步。

#### 2.3.1 核心思想

```
传统方式（当前）：
  execute() {
    state.phase = "parsing";            // 内存修改
    const intent = await this.parse();  // 如果这里崩溃，state 丢失
    state.phase = "planning";           // 内存修改
    const plan = await this.plan();     // 如果这里崩溃，plan 丢失
  }

Durable Execution 方式（目标）：
  execute() {
    await journal.record("PHASE_CHANGE", { phase: "parsing" });
    const intent = await journal.recordStep("parse", () => this.parse());
    // ↑ 先执行 parse()，成功后将结果写入 journal
    // 如果崩溃：resume 时从 journal 重放，发现 parse 已完成，跳过

    await journal.record("PHASE_CHANGE", { phase: "planning" });
    const plan = await journal.recordStep("plan", () => this.plan(intent));
    // 同理：崩溃后从 journal 重放，跳过已完成的步骤
  }
```

#### 2.3.2 EventJournal 服务

```typescript
/**
 * AI OS Kernel - Event Journal
 *
 * 为每个 Process 维护一个有序的事件日志。
 * 这是 Durable Execution 的基础设施。
 *
 * 对标：Temporal 的 Event History, Azure Durable Functions 的 Orchestration History
 */
@Injectable()
export class EventJournal {
  /**
   * 记录事件
   * 所有进程状态变化必须先写 journal，再改内存/数据库
   */
  async record(processId: ProcessId, event: JournalEntry): Promise<number>;

  /**
   * 记录步骤执行（核心 API）
   *
   * 语义：
   * 1. 检查 journal 中是否已有此 stepId 的完成记录
   * 2. 如果有 → 直接返回记录的结果（重放模式）
   * 3. 如果没有 → 执行 fn()，将结果写入 journal，返回结果
   *
   * 这保证了：同一个 step 无论执行几次，只会产生一次实际调用
   */
  async recordStep<T>(
    processId: ProcessId,
    stepId: string,
    fn: () => Promise<T>,
  ): Promise<T>;

  /**
   * 重放：从 journal 恢复进程状态
   * 用于进程 resume 时重建内存状态
   */
  async replay(processId: ProcessId): Promise<ReplayResult>;

  /**
   * 获取进程的完整事件历史
   */
  async getHistory(processId: ProcessId): Promise<JournalEntry[]>;
}

interface JournalEntry {
  eventType: string;
  stepId?: string;
  payload: unknown;
  /** 步骤执行结果（仅 step_completed 类型） */
  result?: unknown;
}
```

#### 2.3.3 改造 MissionOrchestrator → MissionExecutorService

```typescript
// === 改造前（当前） ===
async *execute(input: MissionInput, team: ITeam) {
  const missionId = uuidv4();
  const state = this.initializeState(missionId);
  this.states.set(missionId, state);        // ← 内存，进程死就没了

  const intent = await this.parse(input);   // ← 崩溃后无法恢复
  const plan = await this.plan(intent);     // ← 崩溃后无法恢复
  // ...
}

// === 改造后（Durable） ===
async *execute(processId: ProcessId, input: MissionInput, team: ITeam) {
  // 状态从数据库加载，不再依赖内存 Map
  await this.processManager.transition(processId, 'RUNNING');

  // 每个步骤通过 journal 记录，支持重放
  const intent = await this.journal.recordStep(
    processId, 'parse',
    () => this.parse(input),
  );
  await this.processManager.checkpoint(processId, { intent });

  const plan = await this.journal.recordStep(
    processId, 'plan',
    () => this.plan(intent, team),
  );
  await this.processManager.checkpoint(processId, { intent, plan });

  // 步骤执行...
  for (const step of plan.steps) {
    const result = await this.journal.recordStep(
      processId, `step:${step.id}`,
      () => this.executeStep(step, team),
    );
    // 如果在这里崩溃，resume 时会从 journal 发现
    // step:1 已完成 → 跳过
    // step:2 未完成 → 从这里继续
  }
}
```

### 2.4 Memory Manager（记忆管理器）

#### 2.4.1 四层记忆架构

当前的 `MemoryCoordinatorService` 已经有 4 层概念，但全在内存/Redis。Kernel 需要：

```
Layer 1: Working Memory（工作记忆）
  ├── 归属：单个 Process 独占
  ├── 生命周期：Process 结束后清理
  ├── 存储：ProcessMemory 表（layer = WORKING）
  ├── 用途：当前步骤的上下文、中间结果
  └── 当前对应：ShortTermMemoryService（内存）

Layer 2: Session Memory（会话记忆）
  ├── 归属：同一 sessionId 的多个 Process 共享
  ├── 生命周期：会话结束后保留 24h
  ├── 存储：ProcessMemory 表（layer = SESSION）
  ├── 用途：对话历史、用户在本次会话中的偏好
  └── 当前对应：ShortTermMemoryService（内存，键前缀 work:）

Layer 3: Shared Memory（共享记忆 / Team 黑板）
  ├── 归属：同一 parentId 下的所有子进程共享
  ├── 生命周期：父进程结束后归档
  ├── 存储：ProcessMemory 表（layer = SHARED）
  ├── 用途：Team 成员间的中间产出物、共识结论
  ├── 并发控制：乐观锁（version 字段）
  └── 当前对应：MissionExecutionState.intermediateOutputs（内存 Map）

Layer 4: Persistent Memory（持久记忆）
  ├── 归属：用户级或全局
  ├── 生命周期：永久
  ├── 存储：LongTermMemory 表 / 向量数据库
  ├── 用途：用户偏好、领域知识、历史研究结论
  └── 当前对应：LongTermMemoryService + ResearchMemory 模型
```

#### 2.4.2 KernelMemoryManager

```typescript
/**
 * AI OS Kernel - Memory Manager
 *
 * 管理进程级别的记忆隔离和共享。
 * 每个进程有独立的记忆空间，通过 Shared Memory 实现进程间通信。
 */
@Injectable()
export class KernelMemoryManager {
  /**
   * 读取记忆（进程只能读取自己有权限的层）
   */
  async read(
    processId: ProcessId,
    layer: MemoryLayer,
    key: string,
  ): Promise<unknown | null>;

  /**
   * 写入记忆
   * Working/Session: 进程自己写
   * Shared: 需要乐观锁（防止并发写冲突）
   * Persistent: 通过 Kernel 审批（防止垃圾数据污染长期记忆）
   */
  async write(
    processId: ProcessId,
    layer: MemoryLayer,
    key: string,
    value: unknown,
    options?: MemoryWriteOptions,
  ): Promise<void>;

  /**
   * 查询记忆（跨层搜索，按相关性排序）
   * 继承自 MemoryCoordinatorService.recall() 的语义
   */
  async query(
    processId: ProcessId,
    query: string,
    layers?: MemoryLayer[],
  ): Promise<MemoryFragment[]>;

  /**
   * 清理进程记忆（进程结束时调用）
   * Working → 删除
   * Session → 设置 TTL
   * Shared → 归档到 Persistent（如果有价值）
   * Persistent → 保留
   */
  async cleanup(processId: ProcessId): Promise<void>;
}
```

### 2.5 Security Manager（安全管理器 — Capability-Based）

#### 2.5.1 能力模型

```typescript
/**
 * 进程能力声明（类似 Linux capabilities）
 *
 * Agent Definition 声明它需要的能力；
 * Kernel 在 spawn 时授予（可能是全部，也可能裁剪）；
 * Runtime 在每次工具/技能调用时校验。
 */
interface ProcessCapabilities {
  // ── 工具能力 ──
  tools: {
    /** 允许使用的工具 ID 列表（'*' = 全部） */
    allowed: ToolId[] | "*";
    /** 明确禁止的工具 ID 列表 */
    denied: ToolId[];
  };

  // ── 技能能力 ──
  skills: {
    allowed: SkillId[] | "*";
    denied: SkillId[];
  };

  // ── 数据能力 ──
  data: {
    /** 可读取的 knowledgeBase ID 列表 */
    readableKBs: string[] | "*";
    /** 可写入的 knowledgeBase ID 列表 */
    writableKBs: string[];
    /** 是否可访问用户个人数据 */
    personalDataAccess: boolean;
  };

  // ── 模型能力 ──
  models: {
    /** 允许使用的模型类型 */
    allowedTypes: AIModelType[];
    /** 允许使用的具体模型 ID（空=由 TaskProfile 决定） */
    allowedModels: string[];
  };

  // ── 网络能力 ──
  network: {
    /** 是否允许外部 HTTP 调用 */
    externalHttp: boolean;
    /** 允许的域名白名单 */
    allowedDomains: string[];
    /** 是否允许 MCP 调用 */
    mcpAccess: boolean;
  };

  // ── 子进程能力 ──
  process: {
    /** 是否允许创建子进程 */
    canFork: boolean;
    /** 最大子进程数 */
    maxChildren: number;
  };
}
```

#### 2.5.2 运行时校验

```typescript
/**
 * 能力守卫 — 在工具/技能调用前校验
 *
 * 嵌入到 ToolPipeline 和 SkillRuntime 的 middleware 中
 */
@Injectable()
export class CapabilityGuard {
  /**
   * 校验进程是否有权调用某工具
   * 在 ToolPipeline.execute() 之前调用
   */
  async checkToolAccess(
    processId: ProcessId,
    toolId: ToolId,
  ): Promise<{ allowed: boolean; reason?: string }>;

  /**
   * 校验进程是否有权访问某数据
   */
  async checkDataAccess(
    processId: ProcessId,
    resourceType: string,
    resourceId: string,
    operation: "read" | "write",
  ): Promise<{ allowed: boolean; reason?: string }>;
}
```

### 2.6 IPC — Inter-Process Communication（进程间通信）

#### 2.6.1 三种通信模式

```
模式 1: Message Passing（消息传递）
  ├── 场景：Leader → Member 分配任务，Member → Leader 汇报结果
  ├── 实现：ProcessMessage 表 + 轮询/WebSocket 通知
  ├── 当前对应：A2AMessageBusService（内存）
  └── 特点：异步、有序、持久化

模式 2: Shared Blackboard（共享黑板）
  ├── 场景：Team 成员间共享中间结论
  ├── 实现：ProcessMemory (layer = SHARED)
  ├── 当前对应：MissionExecutionState.intermediateOutputs（内存 Map）
  └── 特点：读多写少、乐观锁并发控制

模式 3: Event Bus（事件总线）
  ├── 场景：进程状态变化通知（如 step_completed → 触发下游步骤）
  ├── 实现：ProcessEvent + EventEmitter / Redis Pub-Sub
  ├── 当前对应：AsyncGenerator<MissionEvent> yield
  └── 特点：发布-订阅、非阻塞
```

#### 2.6.2 MessageBusService（← A2AMessageBusService 改造）

```typescript
// === 当前：A2AMessageBusService（内存） ===
export class A2AMessageBusService {
  private messages: A2AMessage[] = [];  // ← 内存数组
  publish(msg: A2AMessage) { this.messages.push(msg); }
}

// === Kernel：MessageBusService（持久化） ===
// ProcessMessage 表
model ProcessMessage {
  id          String   @id @default(uuid())
  fromProcess String
  toProcess   String
  channel     String   // "task_assignment", "result", "feedback"
  payload     Json
  read        Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([toProcess, read, createdAt])
}
```

### 2.7 Resource Manager（资源管理器）

```typescript
/**
 * AI OS Kernel - Resource Manager
 *
 * 实时追踪和强制执行资源配额。
 * 当前的 ConstraintEngine + CostController 是其前身。
 */
@Injectable()
export class ResourceManager {
  /**
   * 消费资源（每次 LLM 调用后记录）
   * 如果超出配额，返回 exceeded: true
   */
  async consume(
    processId: ProcessId,
    usage: ResourceUsage,
  ): Promise<{ exceeded: boolean; remaining: ResourceBudget }>;

  /**
   * 检查是否可以继续执行
   * 合并了当前的 ConstraintEngine.canContinue()
   */
  async canContinue(processId: ProcessId): Promise<{
    allowed: boolean;
    reason?: string;
    /** 建议操作：continue / pause / degrade（降级用更便宜的模型） / abort */
    suggestion: "continue" | "pause" | "degrade" | "abort";
  }>;

  /**
   * 资源降级：当预算不足时自动切换到更便宜的模型
   */
  async requestDegradation(processId: ProcessId): Promise<DegradationPlan>;
}
```

### 2.8 Process Supervisor（进程监管器）

```typescript
/**
 * AI OS Kernel - Process Supervisor
 *
 * 后台守护服务，定期检查进程健康状态。
 * 处理超时、僵死、资源泄漏等异常情况。
 *
 * 对标：Linux 的 init/systemd, Erlang 的 Supervisor
 */
@Injectable()
export class ProcessSupervisor implements OnModuleInit {
  /**
   * 健康检查循环（每 30s 执行一次）
   */
  @Cron("*/30 * * * * *")
  async healthCheck(): Promise<void> {
    // 1. 检测超时进程 → 标记为 ZOMBIE
    await this.detectTimeouts();

    // 2. 清理 ZOMBIE 进程 → 回收资源、通知用户
    await this.cleanupZombies();

    // 3. 检测孤儿进程（父进程已死但子进程还在跑）→ 重新挂载到 init
    await this.adoptOrphans();

    // 4. 检测资源泄漏（进程 COMPLETED 但记忆未清理）→ 强制清理
    await this.cleanupLeakedResources();
  }

  /**
   * 崩溃恢复：服务重启后，恢复所有 RUNNING 状态的进程
   */
  async recoverOnStartup(): Promise<void> {
    const interrupted = await this.prisma.agentProcess.findMany({
      where: { state: { in: ["RUNNING", "WAITING"] } },
    });

    for (const process of interrupted) {
      this.logger.warn(`Recovering interrupted process: ${process.id}`);
      // 从最新 checkpoint 恢复
      await this.processManager.resume(process.id);
    }
  }
}
```

---

## 3. 与现有系统的映射关系

### 3.1 划分原则

**一句话**：如果管的是"执行实例的生命周期和资源"→ Kernel；如果管的是"AI 怎么思考和生成"→ Engine。

| 判断问题                             | 回答类型    | 归属       |
| ------------------------------------ | ----------- | ---------- |
| "这个 Mission 跑到哪一步了？"        | 进程状态    | **Kernel** |
| "还剩多少 Token 预算？"              | 资源配额    | **Kernel** |
| "Agent A 给 Agent B 发消息"          | 进程间通信  | **Kernel** |
| "崩溃了，从哪里恢复？"               | 检查点/日志 | **Kernel** |
| "这个 Agent 能不能调用 web-search？" | 权限/能力   | **Kernel** |
| "这个任务应该分成几步？"             | AI 规划能力 | **Engine** |
| "这段输出有没有事实错误？"           | AI 质量评估 | **Engine** |
| "用 GPT-4o 还是 Claude？"            | AI 模型路由 | **Engine** |
| "这段 prompt 有没有注入攻击？"       | AI 安全检测 | **Engine** |

### 3.2 逐目录归属判定

#### 迁移到 Kernel 的组件（~25,000 行）

```
ai-engine/infra/a2a/ → kernel/ipc/a2a/
  ├── a2a-message.interface.ts       IPC 协议定义
  ├── a2a-message-bus.service.ts     消息总线 = IPC 管道
  ├── a2a-client.service.ts          外部 Agent 连接 = 网络 socket
  ├── a2a-team-member-adapter.ts     外部 Agent 适配 = 设备驱动桥接
  ├── a2a.controller.ts              入站端口 = 网络接口
  ├── a2a-api-key.guard.ts           连接认证 = 防火墙
  └── agent-card.registry.ts         Agent 身份注册 = DNS

ai-engine/infra/observability/ → kernel/observability/
  ├── trace-collector.service.ts     → ProcessEvent 表（进程审计日志）
  ├── cost-attribution.service.ts    → ResourceManager（成本归因）
  ├── ai-observability.service.ts    → KernelMetrics（指标聚合）
  └── observability.controller.ts    → Kernel API
  注意：eval-pipeline.service.ts 留在 Engine（AI 评估能力，非内核职责）

ai-engine/infra/realtime/ → kernel/ipc/events/
  ├── engine-event-emitter.service.ts  进程事件广播 = IPC event bus
  └── progress-tracker.service.ts      进程进度追踪 = /proc 文件系统

ai-engine/orchestration/checkpoints/ → kernel/journal/
  └── checkpoint-manager.ts            检查点 = 进程快照

ai-engine/orchestration/state-machine/ → kernel/process/
  └── execution-state.manager.ts       执行状态管理 = 进程表

ai-engine/orchestration/services/ (部分) → kernel/resource/
  ├── circuit-breaker.service.ts       熔断器 = 资源保护
  ├── constraint-enforcement.service.ts 约束执行 = 配额管理
  └── token-budget.service.ts          Token 预算 = 资源配额

ai-engine/teams/orchestrator/ → kernel/mission/
  ├── mission-orchestrator.ts          Mission 执行 = 进程主循环
  └── orchestrator.interface.ts        编排器接口

ai-engine/teams/constraints/ → kernel/resource/
  ├── constraint-engine.ts             约束引擎 = 资源配额管理
  └── constraint-profile.ts            约束配置 = 进程资源限制声明

ai-engine/teams/services/
  └── a2a-message-bus.service.ts     → kernel/ipc/（与 infra/a2a 合并）

ai-engine/teams/abstractions/ (部分) → kernel/process/types/
  ├── mission.interface.ts             Mission 定义 = Job/Process 定义
  ├── mission-context.interface.ts     Mission 上下文
  └── a2a-message.interface.ts         IPC 消息协议

ai-engine/knowledge/memory/ → kernel/memory/
  ├── memory-coordinator.service.ts    记忆协调 = 内存管理器
  ├── short-term-memory.service.ts     工作记忆 = 进程栈
  ├── long-term-memory.service.ts      持久记忆 = 文件系统
  └── in-memory-store.ts               内存存储 = RAM

ai-engine/safety/constraint/ → kernel/resource/
  ├── cost-controller.ts               成本控制 = 资源配额
  └── rate-limiter.ts                  速率限制 = 调度约束
```

#### 留在 Engine 的组件（~93,000 行）

```
ai-engine/llm/                         LLM 适配器 = 设备驱动
  全部保留（AiChatService, adapters, factory, model-fallback...）

ai-engine/tools/                       工具系统 = 系统调用库
  全部保留（46 工具 + ToolRegistry + Pipeline + MCP adapter）
  新增：CapabilityGuard middleware（由 Kernel 注入）

ai-engine/skills/                      技能系统 = 动态库
  全部保留（SkillRegistry, loader, runtime, builder...）
  新增：CapabilityGuard middleware

ai-engine/agents/                      Agent 模板 = 程序定义
  全部保留（BaseAgent, PlanBasedAgent, AgentRegistry...）

ai-engine/teams/ (部分保留)            Team 模板 = 程序组模板
  ├── abstractions/ (team, member, role, workflow)    模板定义
  ├── base/ (team.ts, member.ts, role.ts, workflow.ts)  模板实现
  ├── registry/ (team-registry, role-registry)        模板注册表
  ├── factory/ (team-factory.ts)                      模板工厂
  ├── services/teams.service.ts                       Team CRUD
  └── controllers/teams.controller.ts                 Team API

ai-engine/orchestration/ (部分保留)    AI 编排能力
  ├── executors/                       执行器（ReAct, DAG, Sequential, Parallel）
  ├── services/agent-executor.service.ts    Agent 任务执行
  ├── services/task-decomposer.service.ts   任务分解（AI 能力）
  ├── services/task-planner.service.ts      任务规划（AI 能力）
  ├── services/intent-detection.service.ts  意图识别（AI 能力）
  ├── services/intent-router.service.ts     意图路由（AI 能力）
  ├── services/complexity-analyzer.service.ts  复杂度分析（AI 能力）
  ├── services/context-compression.service.ts  上下文压缩（AI 能力）
  ├── services/context-evolution.service.ts    上下文演化（AI 能力）
  ├── services/context-initialization.service.ts 上下文初始化
  ├── services/reflection.service.ts        自省反思（AI 能力）
  ├── services/output-reviewer.service.ts   输出审核（AI 能力）
  ├── services/intelligent-model-router.service.ts 模型路由（AI 能力）
  ├── services/iteration-manager.service.ts 迭代管理
  ├── capabilities/                    能力解析
  └── utils/error-detection.utils.ts   错误检测工具

ai-engine/knowledge/rag/               RAG Pipeline = 搜索引擎能力
ai-engine/knowledge/evidence/          证据管理 = AI 能力
ai-engine/knowledge/search/            搜索服务 = AI 能力

ai-engine/content/                     内容生成/分析 = AI 能力
  全部保留（image, long-form, synthesis, analysis, fetch）

ai-engine/mcp/                         MCP 协议 = 外设驱动
  全部保留（client, manager, registry, tools adapter）

ai-engine/safety/guardrails/           AI 内容安全 = 应用级安全
  全部保留（prompt injection, content safety, compliance）

ai-engine/safety/quality/              质量评估 = AI 能力
  全部保留（coherence, consistency, diversity, factual checkers）

ai-engine/core/                        公共类型/错误 = 共享头文件
  全部保留
```

#### 最终目录结构

```
backend/src/modules/
  ├── ai-kernel/                        ★ 新增 — AI OS 内核
  │   ├── ai-kernel.module.ts
  │   │
  │   ├── process/                      进程管理
  │   │   ├── process-manager.service.ts
  │   │   ├── process.types.ts            (← mission.interface.ts 中生命周期部分)
  │   │   └── index.ts
  │   │
  │   ├── scheduler/                    调度器
  │   │   ├── kernel-scheduler.service.ts
  │   │   └── index.ts
  │   │
  │   ├── journal/                      事件日志 / Durable Execution
  │   │   ├── event-journal.service.ts    (← CheckpointManager)
  │   │   └── index.ts
  │   │
  │   ├── mission/                      Mission 执行器
  │   │   ├── mission-executor.service.ts (← MissionOrchestrator)
  │   │   ├── mission-executor.interface.ts
  │   │   └── index.ts
  │   │
  │   ├── memory/                       记忆管理
  │   │   ├── kernel-memory-manager.service.ts  (← MemoryCoordinatorService)
  │   │   ├── stores/
  │   │   │   ├── working-memory.store.ts       (← ShortTermMemoryService)
  │   │   │   └── persistent-memory.store.ts    (← LongTermMemoryService)
  │   │   └── index.ts
  │   │
  │   ├── ipc/                          进程间通信
  │   │   ├── message-bus.service.ts      (← A2AMessageBusService)
  │   │   ├── event-bus.service.ts        (← EngineEventEmitterService)
  │   │   ├── shared-blackboard.service.ts
  │   │   ├── progress-tracker.service.ts (← ProgressTrackerService)
  │   │   ├── a2a/                        A2A 协议实现（文件名保留协议名）
  │   │   │   ├── a2a-client.service.ts
  │   │   │   ├── a2a-team-member-adapter.ts
  │   │   │   ├── a2a-api-key.guard.ts
  │   │   │   ├── a2a.controller.ts
  │   │   │   ├── agent-card-registry.ts
  │   │   │   └── a2a.types.ts
  │   │   └── index.ts
  │   │
  │   ├── resource/                     资源管理
  │   │   ├── resource-manager.service.ts (← ConstraintEngine + ConstraintEnforcementService)
  │   │   ├── circuit-breaker.service.ts
  │   │   ├── token-budget.service.ts
  │   │   ├── cost-controller.ts
  │   │   ├── rate-limiter.ts
  │   │   └── index.ts
  │   │
  │   ├── observability/                可观测性
  │   │   ├── process-event-log.service.ts  (← TraceCollectorService)
  │   │   ├── kernel-metrics.service.ts     (← AiObservabilityService)
  │   │   ├── cost-attribution.service.ts
  │   │   └── index.ts
  │   │
  │   ├── security/                     安全/权限
  │   │   ├── capability-guard.service.ts
  │   │   ├── capability.types.ts
  │   │   └── index.ts
  │   │
  │   ├── supervisor/                   进程监管
  │   │   ├── process-supervisor.service.ts  (← ExecutionStateManager)
  │   │   └── index.ts
  │   │
  │   └── api/                          Kernel 对外 API
  │       ├── kernel-api.service.ts       (← AIEngineFacade)
  │       └── index.ts
  │
  ├── ai-engine/                        ★ 瘦身后 — 纯 AI 能力层
  │   ├── ai-engine.module.ts
  │   ├── llm/                          LLM 适配（不变）
  │   ├── tools/                        工具系统（不变）
  │   ├── skills/                       技能系统（不变）
  │   ├── agents/                       Agent 定义模板（不变）
  │   ├── teams/                        Team 定义模板（瘦身：去掉 orchestrator/constraints）
  │   ├── orchestration/                编排能力（瘦身：去掉 checkpoints/state-machine）
  │   ├── knowledge/                    知识管理（瘦身：去掉 memory/，保留 rag/evidence/search）
  │   ├── content/                      内容能力（不变）
  │   ├── mcp/                          MCP 协议（不变）
  │   ├── safety/                       安全（瘦身：去掉 constraint/，保留 guardrails/quality）
  │   ├── core/                         公共类型（不变）
  │   └── facade/                       ★ 删除 — 被 kernel/api/ 完全替代
  │
  ├── ai-app/                           应用层（import 从 facade → kernel/api）
  └── ...
```

### 3.3 依赖方向

```
ai-app  ──→  ai-kernel  ──→  ai-engine
                │
                ├── 调用 Engine 的 AI 能力（LLM, Tools, Skills）
                ├── 不暴露 Engine 内部给 App
                └── App 只看到 KernelAPI
```

### 3.4 命名策略

**原则：一步到位，不留兼容别名。**

#### 规则一：协议标准名保留

A2A 是 Google 提出的行业标准协议，MCP 是 Anthropic 的标准。协议名是外部共识，改了反而让人困惑。

```
保留原名的文件（协议标准概念）：
  a2a-client.service.ts          A2A 是协议名
  a2a-team-member-adapter.ts     A2A 标准的适配器
  a2a-api-key.guard.ts           A2A 连接认证
  a2a.controller.ts              A2A 入站端口
  agent-card-registry.ts         Agent Card 也是 A2A 标准概念
```

#### 规则二：Kernel 内部抽象用 OS 语义重命名

进入 Kernel 后，组件的身份从 "AI 工具" 变为 "OS 子系统"，命名应反映 Kernel 的概念体系。

```
旧名                              新名                           理由
────────────────────────────────  ─────────────────────────────  ──────────────────────
A2AMessageBusService              MessageBusService              Kernel IPC 不只服务 A2A
A2AMessage (interface)            ProcessMessage                 Kernel 里消息是进程间的
TraceCollectorService             ProcessEventLogService         Kernel 里是进程事件日志
AiObservabilityService            KernelMetricsService           Kernel 自己的指标体系
EngineEventEmitterService         EventBusService                Kernel 的事件总线
CheckpointManager                 EventJournalService            不再是检查点，是事件溯源
MissionOrchestrator               MissionExecutorService         Kernel 负责执行
MemoryCoordinatorService          KernelMemoryManager            Kernel 的记忆管理器
ExecutionStateManager             ProcessSupervisorService       Kernel 的进程监管
ConstraintEngine                  ResourceManagerService         Kernel 的资源配额管理
CostAttributionService            CostAttributionService         名称已足够通用，保留
ProgressTrackerService            ProgressTrackerService         职责明确，保留
ShortTermMemoryService            WorkingMemoryStore             OS 语义：工作记忆
LongTermMemoryService             PersistentMemoryStore          OS 语义：持久记忆
AIEngineFacade                    KernelApiService               Kernel 对外统一入口
```

#### 规则三：类比 Linux——`socket()` vs `AF_INET`

```
kernel/ipc/
  ├── message-bus.service.ts     ← 通用 IPC 管道（= socket syscall）
  │                                 所有进程间消息走这里
  │
  └── a2a/                       ← A2A 协议实现（= AF_INET 协议族）
      ├── a2a-client.service.ts
      └── a2a-team-member-adapter.ts
```

`MessageBusService` 是 Kernel 的 syscall 层，`a2a/` 是具体协议实现。不把 syscall 叫 `a2a_bus()`，也不把协议改名叫 `kernel_net()`。

### 3.5 现有组件 → Kernel 组件映射表

| 现有组件                       | Kernel 新名                       | 新路径                | 改造方式                    |
| ------------------------------ | --------------------------------- | --------------------- | --------------------------- |
| `MissionOrchestrator`          | **`MissionExecutorService`**      | kernel/mission/       | 状态持久化 + Journal 集成   |
| `MissionExecutionState`        | **`AgentProcess`** (Prisma model) | kernel/process/       | 内存 Map → 数据库           |
| `ExecutionStateManager`        | **`ProcessSupervisorService`**    | kernel/supervisor/    | 合并 TTL + 进程监管         |
| `ConstraintEngine`             | **`ResourceManagerService`**      | kernel/resource/      | 扩展为进程级配额            |
| `ConstraintProfile`            | → `AgentProcess` 字段             | kernel/process/       | tokenBudget/costBudget 字段 |
| `CheckpointManager`            | **`EventJournalService`**         | kernel/journal/       | 内存 → 事件溯源             |
| `TraceCollectorService`        | **`ProcessEventLogService`**      | kernel/observability/ | 内存 → `ProcessEvent` 表    |
| `CostAttributionService`       | `CostAttributionService`          | kernel/observability/ | 迁移                        |
| `AiObservabilityService`       | **`KernelMetricsService`**        | kernel/observability/ | 迁移                        |
| `ShortTermMemoryService`       | **`WorkingMemoryStore`**          | kernel/memory/stores/ | 内存 → `ProcessMemory` 表   |
| `LongTermMemoryService`        | **`PersistentMemoryStore`**       | kernel/memory/stores/ | 加进程隔离                  |
| `MemoryCoordinatorService`     | **`KernelMemoryManager`**         | kernel/memory/        | 迁移                        |
| `A2AMessageBusService`         | **`MessageBusService`**           | kernel/ipc/           | 内存 → `ProcessMessage` 表  |
| `A2AClientService`             | `A2AClientService`                | kernel/ipc/a2a/       | 迁移（协议名保留）          |
| `A2ATeamMemberAdapter`         | `A2ATeamMemberAdapter`            | kernel/ipc/a2a/       | 迁移（协议名保留）          |
| `AgentCardRegistry`            | `AgentCardRegistry`               | kernel/ipc/a2a/       | 迁移（协议名保留）          |
| `EngineEventEmitterService`    | **`EventBusService`**             | kernel/ipc/           | 迁移                        |
| `ProgressTrackerService`       | `ProgressTrackerService`          | kernel/ipc/           | 迁移                        |
| `CircuitBreakerService`        | `CircuitBreakerService`           | kernel/resource/      | 迁移                        |
| `TokenBudgetService`           | `TokenBudgetService`              | kernel/resource/      | 迁移                        |
| `ConstraintEnforcementService` | → 合并入 `ResourceManagerService` | kernel/resource/      | 合并                        |
| `CostController`               | `CostController`                  | kernel/resource/      | 迁移                        |
| `RateLimiter`                  | `RateLimiter`                     | kernel/resource/      | 迁移                        |
| `ToolRegistry`                 | —                                 | **留在 Engine**       | 加 CapabilityGuard          |
| `SkillRegistry`                | —                                 | **留在 Engine**       | 加 CapabilityGuard          |
| `AgentRegistry`                | —                                 | **留在 Engine**       | 不变                        |
| `TeamRegistry`                 | —                                 | **留在 Engine**       | 不变                        |
| `GuardrailsPipeline`           | —                                 | **留在 Engine**       | 不变                        |
| `EvalPipelineService`          | —                                 | **留在 Engine**       | 不变                        |
| `AIEngineFacade`               | **`KernelApiService`**            | kernel/api/           | 废弃旧 Facade               |

### 3.6 Facade 拆分方案

Facade 的 37 个参数问题在 Kernel 引入后自然解决，因为 Kernel 提供了更高层的抽象：

```
当前：
  AIEngineFacade (God Object, 37 deps)
    ├── chat()
    ├── search()
    ├── executeMission()
    ├── executeTool()
    ├── executeAgent()
    ├── memory operations...
    ├── team operations...
    ├── trace operations...
    └── 30+ 其他方法

拆分后：
  KernelAPI (面向 AI App 的统一入口，只有 5 个核心依赖)
    ├── processManager    → spawn / pause / resume / cancel / wait
    ├── memoryManager     → read / write / query
    ├── resourceManager   → consume / canContinue
    └── chatService       → chat (直接 LLM 调用，不经过进程)

  AI Engine Services (面向 Kernel 内部，按域独立注入)
    ├── AiChatService           → LLM 调用
    ├── ToolRegistry            → 工具能力
    ├── SkillRegistry           → 技能能力
    ├── MissionExecutorService  → 进程执行逻辑
    └── ...其他                  → 保持独立
```

AI App 模块不再需要 import 37 个依赖的 Facade，而是只需要：

1. `KernelAPI.spawn()` — 提交一个任务
2. `KernelAPI.chat()` — 简单 LLM 调用
3. `KernelAPI.memory.query()` — 查询记忆

进程内部的编排逻辑（工具调用、技能注入、团队协作）由 Kernel 内部处理，对 App 层透明。

**关键：MissionExecutorService 与 Engine 编排服务的关系**

`MissionExecutorService`（原 MissionOrchestrator）在 Kernel 中负责进程生命周期，但**AI 决策能力**仍由 Engine 的编排服务提供。调用关系：

```
kernel/mission/MissionExecutorService
  │
  │ 生命周期管理（Kernel 职责）：
  ├── processManager.transition(RUNNING)
  ├── journal.recordStep(...)
  ├── resourceManager.consume(...)
  │
  │ AI 决策（注入 Engine 服务）：
  ├── intentDetectionService.detect()        ← Engine: 意图识别
  ├── taskDecomposerService.decompose()      ← Engine: 任务拆解
  ├── taskPlannerService.plan()              ← Engine: 任务规划
  ├── agentExecutorService.execute()         ← Engine: Agent 执行
  ├── reflectionService.reflect()            ← Engine: 执行后反思
  ├── outputReviewerService.review()         ← Engine: 输出审核
  └── contextCompressionService.compress()   ← Engine: 上下文压缩
```

Engine 的 13+ 编排服务（详见 Section 3.2 "留在 Engine"）作为依赖注入到 MissionExecutorService。Kernel 包裹了生命周期，Engine 提供了 AI 大脑。

---

## 4. 实施路线图

### Phase 0: 基础设施准备（1-2 周）

```
目标：建立 Kernel 模块骨架，不改变现有行为

新增文件：
  backend/src/modules/ai-kernel/
    ├── ai-kernel.module.ts
    ├── process/
    │   ├── process-manager.service.ts    (接口定义，空实现)
    │   ├── process.types.ts
    │   └── index.ts
    ├── scheduler/
    │   ├── kernel-scheduler.service.ts   (接口定义)
    │   └── index.ts
    ├── journal/
    │   ├── event-journal.service.ts      (接口定义)
    │   └── index.ts
    ├── supervisor/
    │   ├── process-supervisor.service.ts (接口定义)
    │   └── index.ts
    └── api/
        ├── kernel-api.service.ts         (新的精简 API)
        └── index.ts

数据库：
  新增 Prisma models: AgentProcess, ProcessEvent, ProcessMemory, ProcessMessage
  手写迁移 SQL

关键约束：
  - ai-kernel 依赖 ai-engine（单向）
  - ai-app 同时依赖 ai-kernel（新）和 ai-engine（现有，逐步收敛到 kernel）
  - 现有 AIEngineFacade 不删除，新旧并行
```

### Phase 1: Durable Execution（2-3 周）

```
目标：进程状态持久化，支持崩溃恢复

1. ProcessManager.spawn() / getState() / cancel()
   - AgentProcess 表 CRUD
   - 内存 Map → 数据库

2. EventJournal.recordStep()
   - ProcessEvent 表写入
   - MissionOrchestrator 改造：每个步骤通过 journal 记录

3. ProcessManager.resume()
   - 从最新 checkpoint 恢复
   - EventJournal.replay() 重放 journal 跳过已完成步骤

4. ProcessSupervisor.recoverOnStartup()
   - 服务重启后自动恢复 RUNNING 进程

验证：
  - 在 Mission 执行中途 kill 进程，重启后能从断点继续
```

### Phase 2: Memory 持久化 + IPC（2 周）

```
目标：记忆和消息持久化

1. ProcessMemory 表替代 WorkingMemoryStore 的内存存储
2. ProcessMessage 表替代 MessageBusService 的内存数组
3. KernelMemoryManager 实现四层记忆读写
4. Team Shared Memory（乐观锁并发控制）
```

### Phase 3: Security + Scheduling（2 周）

```
目标：能力隔离和调度

1. ProcessCapabilities 模型
2. CapabilityGuard 嵌入 ToolPipeline
3. KernelScheduler 优先级队列
4. 多租户资源公平分配
```

### Phase 4: Facade 收敛 + App 迁移（2-3 周）

```
目标：AI App 迁移到 KernelAPI

1. 逐个 App 模块从 AIEngineFacade 迁移到 KernelAPI
2. Research → kernel.spawn('research-agent', input)
3. Writing → kernel.spawn('writing-agent', input)
4. 验证所有 App 正常工作后，废弃 AIEngineFacade
```

---

## 5. 设计决策记录

### D1: 为什么不用 Temporal.io？

Temporal 是 Durable Execution 的标准答案，但：

- 引入重量级依赖（Temporal Server + PostgreSQL + Elasticsearch）
- 需要用 Temporal 的 DSL 重写所有 Workflow
- 与 NestJS DI 体系不兼容

我们选择**自建轻量版**：用 PostgreSQL 表 + EventJournal 实现核心的 checkpoint + replay，够用且可控。如果未来需要跨服务编排再考虑 Temporal。

### D2: 为什么 Phase 1 不引入消息队列？

BullMQ/Redis Streams 是分布式调度的标准方案，但当前是单进程部署（Railway）。Phase 1 用数据库轮询足够：

```sql
-- Scheduler 每秒执行一次
SELECT id FROM agent_processes
WHERE state = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

`FOR UPDATE SKIP LOCKED` 保证多个 Worker（如果有）不会拿到同一个任务。

### D3: Kernel 放在哪个目录？

```
backend/src/modules/
  ├── ai-engine/     ← 能力层（不变）
  ├── ai-kernel/     ← 新增：Kernel 层
  ├── ai-app/        ← 应用层（逐步迁移到 KernelAPI）
  └── ...
```

`ai-kernel` 作为独立模块，依赖 `ai-engine`，被 `ai-app` 依赖。依赖方向：`ai-app → ai-kernel → ai-engine`。

### D4: AgentProcess 与现有 Mission 的关系？

一个 Mission 对应一个 AgentProcess（或一个进程树）：

- 简单任务（如 Ask）：1 个进程，无子进程
- 团队任务（如 Research）：1 个 Leader 进程 + N 个 Member 子进程
- `MissionInput` 存入 `AgentProcess.input`
- `MissionResult` 存入 `AgentProcess.output`
- `MissionStatus` 映射到 `ProcessState`

---

## 6. 风险和缓解

| 风险                                  | 严重性 | 缓解策略                                              |
| ------------------------------------- | ------ | ----------------------------------------------------- |
| 数据库成为瓶颈（频繁写 ProcessEvent） | 高     | 批量写入（accumulate 100ms flush）；热数据 Redis 缓存 |
| 改造 MissionOrchestrator 引入回归     | 高     | 新旧并行运行，A/B 切换；充分的集成测试                |
| Checkpoint 序列化兼容性               | 中     | Checkpoint 加 schema version，向前兼容                |
| 多租户公平调度的复杂性                | 中     | Phase 1 不做多租户，Phase 3 引入                      |
| ProcessMemory 表增长过快              | 中     | TTL + 定期归档到冷存储                                |

---

_文档版本: 1.0_
_创建日期: 2026-02-27_
_作者: Architecture Review_
