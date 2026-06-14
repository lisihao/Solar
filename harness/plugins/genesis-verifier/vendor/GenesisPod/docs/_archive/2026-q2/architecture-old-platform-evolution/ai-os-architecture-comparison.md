# AI OS 架构对比分析：传统 OS vs AIOS vs Karpathy LLM OS vs GenesisPod

**Date**: 2026-02-28
**Version**: v1.0
**Status**: Active
**Related Docs**:

- [AI OS Kernel 架构设计](../ai-os-kernel-design.md)
- [Genesis Agent OS 2026 路线图](./genesis-agent-os-roadmap-2026.md)

---

## 执行摘要

本文对四个系统架构进行系统性对比分析：

| 系统                        | 类型       | 成熟度         | 核心贡献                                          |
| --------------------------- | ---------- | -------------- | ------------------------------------------------- |
| **传统 OS** (Linux/Windows) | 工业标准   | 50+ 年工业验证 | 定义了 OS 核心概念：进程、内存、调度、IPC、安全   |
| **Karpathy LLM OS** (2023)  | 概念框架   | 思想实验       | 提出 "LLM 即 CPU" 隐喻，启发了 AI OS 方向         |
| **AIOS** (COLM 2025)        | 学术原型   | 开源实现       | 首个系统性的 LLM Agent OS 内核论文，有性能基准    |
| **GenesisPod** (6 层架构)   | 生产级系统 | 生产环境运行   | 完整 OS 概念映射 + 企业级容错 + 多租户 + 成本控制 |

**核心结论**：Karpathy 定义了愿景，AIOS 做了学术验证，GenesisPod 将 AI OS 概念落地为可运行的企业级系统。GenesisPod 在进程持久化、事件溯源、多租户隔离、成本归因等维度上超越了 AIOS 论文的实现。

---

## 一、参考来源

| 来源                                                                                                 | 说明                                            |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [AIOS: LLM Agent Operating System](https://arxiv.org/abs/2403.16971)                                 | COLM 2025 正式论文，arXiv:2403.16971            |
| [AIOS GitHub](https://github.com/agiresearch/AIOS)                                                   | 开源实现                                        |
| [Karpathy LLM OS (X)](https://x.com/karpathy/status/1723140519554105733)                             | 原始概念帖 (2023-11)                            |
| [Illustrated LLM OS (HuggingFace)](https://huggingface.co/blog/shivance/illustrated-llm-os)          | 架构可视化解读                                  |
| [AI OS & Agentic OS (Fluid AI)](https://www.fluid.ai/blog/ai-operating-systems-agentic-os-explained) | 企业 AI OS 定义                                 |
| GenesisPod 源码                                                                                      | `backend/src/modules/ai-kernel/` + `ai-engine/` |

---

## 二、总体架构对比

### 2.1 分层架构

| 层级           | 传统 OS                      | AIOS                                | Karpathy LLM OS      | GenesisPod                                       |
| -------------- | ---------------------------- | ----------------------------------- | -------------------- | ------------------------------------------------ |
| **应用层**     | 用户程序                     | Agent SDK (Cerebrum) + 6 Agent 框架 | 未定义               | L6 Agent OS + L4 AI Apps                         |
| **接口层**     | System Call Interface        | LLM System Call Interface           | --                   | L5 Open API (MCP/REST/Webhooks)                  |
| **内核层**     | Kernel (进程/内存/文件/网络) | AIOS Kernel (6 模块)                | LLM 即内核           | L2 AI Kernel (16 个服务)                         |
| **能力层**     | --                           | LLM Core(s)                         | LLM + Tools + 多模态 | L3 AI Engine (LLM/Agents/Tools/Teams/Skills/RAG) |
| **基础设施层** | Hardware (CPU/RAM/Disk)      | Hardware Abstraction Layer          | 本地硬件             | L1 Infrastructure (Auth/Credits/Storage)         |
| **总层数**     | 3-4 层                       | 3 层                                | ~2 层 (概念)         | **6 层**                                         |

### 2.2 架构范式

| 维度         | 传统 OS                | AIOS                 | Karpathy LLM OS       | GenesisPod                  |
| ------------ | ---------------------- | -------------------- | --------------------- | --------------------------- |
| **核心理念** | 管理硬件资源           | 管理 LLM Agent 资源  | LLM 替代 CPU 成为中枢 | OS 隐喻的企业 AI 平台       |
| **设计哲学** | 确定性、可预测         | 学术研究导向         | 概念愿景、类比驱动    | 生产级、业务导向            |
| **实现形态** | C/Rust 内核 + 用户空间 | Python 库 + REST API | 无实现                | NestJS + PostgreSQL + Redis |
| **目标用户** | 所有计算任务           | AI 研究者            | 未来设备用户          | 企业 AI 平台用户            |

---

## 三、内核模块逐项对比

### 3.1 进程 / Agent 管理

| 维度         | 传统 OS                              | AIOS                    | Karpathy LLM OS | GenesisPod                                                             |
| ------------ | ------------------------------------ | ----------------------- | --------------- | ---------------------------------------------------------------------- |
| **调度单元** | Process / Thread                     | Agent Request           | --              | `AgentProcess` (完整状态机)                                            |
| **状态模型** | NEW-READY-RUNNING-WAITING-TERMINATED | 隐式 (队列/执行/完成)   | 未定义          | **8 态**: CREATED-READY-RUNNING-PAUSED-WAITING-COMPLETED-FAILED-ZOMBIE |
| **调度算法** | FIFO, RR, CFS, Priority              | FIFO, RR, Priority, SJF | --              | Priority DESC + FIFO, `FOR UPDATE SKIP LOCKED` (分布式安全)            |
| **并发控制** | 进程隔离 + 信号量                    | 20+ Agent 并发          | --              | 全局上限 50 + 租户上限 10                                              |
| **父子关系** | `fork()` 进程树                      | 无                      | --              | `spawn()` / `fork()` 进程树 + `getProcessTree()`                       |
| **持久化**   | 无 (内存中)                          | 无 (内存中)             | --              | **PostgreSQL** `agent_processes` 表                                    |
| **崩溃恢复** | 进程终止                             | 无                      | --              | 有 checkpoint -> READY 重试; 无 -> FAILED                              |

**GenesisPod 关键代码**:

```
ProcessManager.spawn()     → 创建进程 (类似 fork() 系统调用)
ProcessManager.fork()      → 从父进程创建子进程
ProcessManager.transition() → 状态转换 (带合法性校验)
ProcessManager.checkpoint() → 保存执行快照 (支持崩溃恢复)
ProcessManager.wait()       → 等待进程结束 (类似 waitpid())
```

**GenesisPod 优势**: 唯一实现了完整进程状态机 + 数据库持久化 + 父子进程层级 + 崩溃恢复。AIOS 和 Karpathy 均未涉及。

### 3.2 内存管理

| 维度         | 传统 OS                    | AIOS                                   | Karpathy LLM OS                    | GenesisPod                                |
| ------------ | -------------------------- | -------------------------------------- | ---------------------------------- | ----------------------------------------- |
| **层级模型** | 寄存器-Cache-RAM-Swap-Disk | Short-term + Long-term + Context Cache | RAM=Context Window, Disk=Vector DB | **3 层**: STACK-HEAP-PERSISTENT           |
| **短期**     | CPU 寄存器 + L1 Cache      | `short_term_memory` dict               | 128K token 上下文窗口              | `STACK` 层 (TTL 过期清理)                 |
| **中期**     | RAM                        | Context Cache (LRU, 100 entries)       | --                                 | `HEAP` 层 (进程存活期间)                  |
| **长期**     | 磁盘文件系统               | VectorStore                            | Ada002 Embedding 存储              | `PERSISTENT` 层 + `long_term_memories` 表 |
| **隔离**     | 进程地址空间               | Agent 间可共享                         | 未定义                             | 按 `processId` 隔离, 复合唯一键           |
| **清理**     | 进程退出释放               | --                                     | --                                 | `deleteAll(processId)` + TTL 自动过期     |
| **共享**     | 共享内存段 / mmap          | `share_memory()`                       | --                                 | `MessageBus` 跨 Agent IPC                 |

**GenesisPod 三层内存模型**:

```
STACK (栈)       → 函数级临时变量, 短 TTL, 自动过期
HEAP (堆)        → 进程级状态, 进程存活期间有效
PERSISTENT (持久) → 跨进程持久存储, 存入 PostgreSQL
```

**存储位置**: `process_memories` 表, 复合唯一键 `(processId, layer, key)`, JSONB 值存储。

### 3.3 上下文管理 / 检查点

| 维度           | 传统 OS                    | AIOS                                        | Karpathy LLM OS | GenesisPod                                            |
| -------------- | -------------------------- | ------------------------------------------- | --------------- | ----------------------------------------------------- |
| **上下文保存** | 保存/恢复 CPU 寄存器 + PCB | text-based (序列化) / logits-based (推理树) | --              | `EventJournal.recordStep()` 幂等执行 + `checkpoint()` |
| **切换开销**   | ~微秒级                    | 2.1s -> 0.1s (声称 95% 改进)                | --              | 基于数据库 I/O, ~毫秒级                               |
| **故障恢复**   | 无 (进程终止)              | 无                                          | --              | **有 checkpoint -> 回到 READY; 无 -> FAILED**         |
| **事件溯源**   | 无 (日志可选)              | 无                                          | --              | `process_events` 表, 按 sequence 有序, 确定性重放     |

**GenesisPod 幂等执行模式**:

```
EventJournal.recordStep(processId, step):
  1. 检查该 step 是否已执行 (通过 type 查找)
  2. 已执行 → 返回缓存结果 (幂等重放)
  3. 未执行 → 执行并持久化结果
```

**GenesisPod 优势**: 唯一实现事件溯源 + 幂等重放 + 检查点恢复，提供企业级容错能力。

### 3.4 进程间通信 (IPC)

| 维度         | 传统 OS                             | AIOS             | Karpathy LLM OS | GenesisPod                                                |
| ------------ | ----------------------------------- | ---------------- | --------------- | --------------------------------------------------------- |
| **机制**     | Pipe, Socket, SharedMem, Signal, MQ | Agent 间共享内存 | 其他 LLM (网络) | **双总线**: EventBus + MessageBus                         |
| **广播**     | 信号 / 多播 Socket                  | --               | --              | `EventBus.emit()` -> EventEmitter2 + Socket.IO            |
| **点对点**   | Pipe / Unix Socket                  | --               | --              | `MessageBus.publish()` 含 fromAgentId/toAgentId           |
| **消息类型** | 字节流                              | --               | --              | query / response / correction, 含优先级/TTL/correlationId |
| **隔离**     | 内核态/用户态                       | --               | --              | 按 sessionId 隔离, Team 执行独立命名空间                  |
| **实时推送** | --                                  | --               | --              | EventBus -> Socket.IO + ProgressTracker 实时进度          |
| **容量保护** | --                                  | --               | --              | 最大 10,000 订阅 + 1 小时自动清理                         |

### 3.5 资源管理

| 维度         | 传统 OS                 | AIOS                  | Karpathy LLM OS | GenesisPod                                          |
| ------------ | ----------------------- | --------------------- | --------------- | --------------------------------------------------- |
| **资源限制** | ulimit, cgroups, quotas | API Rate Limiting     | --              | **Token Budget + Cost Budget 双重约束**             |
| **熔断**     | --                      | --                    | --              | `CircuitBreakerService` (CLOSED-OPEN-HALF_OPEN)     |
| **限流**     | --                      | 智能批处理            | --              | `RateLimiter` Token Bucket 算法                     |
| **成本追踪** | --                      | API 成本跟踪 (粗粒度) | --              | `CostAttributionService` 按用户/团队/Agent 精细归因 |
| **预算执行** | 进程被 kill             | --                    | --              | `ResourceManager.checkBudget()` -> 超预算立即中止   |

### 3.6 安全 / 访问控制

| 维度             | 传统 OS          | AIOS                      | Karpathy LLM OS | GenesisPod                                          |
| ---------------- | ---------------- | ------------------------- | --------------- | --------------------------------------------------- |
| **模型**         | DAC / MAC / RBAC | Access Manager (隐私策略) | --              | **Capability-Based Access Control**                 |
| **粒度**         | 文件/进程级      | Agent 级                  | --              | 进程级: `grantedTools[]` + `grantedSkills[]` 白名单 |
| **安全管线**     | --               | --                        | --              | Guardrails Pipeline (输入/工具/输出三阶段)          |
| **内容安全**     | --               | --                        | --              | PII 检测, 注入防护, 越狱检测                        |
| **空白名单语义** | --               | --                        | --              | 空数组 = 不限制 (开放); 非空 = 仅白名单允许         |

### 3.7 工具 / 外设管理

| 维度         | 传统 OS              | AIOS                   | Karpathy LLM OS        | GenesisPod                                                                                  |
| ------------ | -------------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| **概念**     | 设备驱动 + /dev      | Tool Manager           | 计算器/Python/终端     | `ToolRegistry` + 48 内置工具                                                                |
| **分类**     | 块设备/字符设备/网络 | web_search, pdf_reader | 计算器/代码解释器/终端 | 8 大类: information/generation/processing/execution/integration/memory/export/collaboration |
| **外部扩展** | 驱动安装             | 外部 API               | 浏览器 + 其他 LLM      | **MCP 协议** (stdio/HTTP/SSE) + **A2A 协议**                                                |
| **权限**     | 驱动签名 + 用户组    | 安全访问控制           | --                     | `CapabilityGuard.checkToolAccess()` 按进程白名单                                            |
| **注册模式** | 设备树 / udev        | --                     | --                     | `onModuleInit()` 自注册到 Registry                                                          |
| **紧凑模式** | --                   | --                     | --                     | `CompactToolSummary` (200 bytes/tool, 节省 LLM token)                                       |

### 3.8 监督 / 健康检查

| 维度             | 传统 OS               | AIOS | Karpathy LLM OS | GenesisPod                                                 |
| ---------------- | --------------------- | ---- | --------------- | ---------------------------------------------------------- |
| **进程看护**     | init/systemd 自动重启 | --   | --              | `ProcessSupervisor` 每 30s 健康检查                        |
| **超时检测**     | --                    | --   | --              | 30min 无更新 -> FAILED, 2h -> ZOMBIE                       |
| **僵尸回收**     | wait() / SIGCHLD      | --   | --              | 自动标记 ZOMBIE 状态                                       |
| **启动恢复**     | --                    | --   | --              | 服务重启: RUNNING 进程有 checkpoint -> READY; 无 -> FAILED |
| **过期内存清理** | --                    | --   | --              | 定期清理 `expiresAt < now` 的内存条目                      |

---

## 四、OS 概念映射总览

| 传统 OS 概念       | AIOS 对应                              | Karpathy LLM OS            | GenesisPod 对应                            |
| ------------------ | -------------------------------------- | -------------------------- | ------------------------------------------ |
| CPU                | LLM Core(s)                            | LLM 推理引擎 (GPT-4 Turbo) | `AiChatService` + `TaskProfile`            |
| 进程 (Process)     | Agent Request                          | --                         | `AgentProcess` (8 态状态机)                |
| fork()             | --                                     | --                         | `ProcessManager.fork()`                    |
| waitpid()          | --                                     | --                         | `ProcessManager.wait()`                    |
| PCB                | --                                     | --                         | `agent_processes` 表行                     |
| 调度器             | Agent Scheduler (FIFO/RR/SJF/Priority) | --                         | `KernelScheduler` (Priority + SKIP LOCKED) |
| 栈 (Stack)         | --                                     | --                         | `MemoryLayer.STACK`                        |
| 堆 (Heap)          | short_term_memory                      | 128K Context Window        | `MemoryLayer.HEAP`                         |
| 虚拟内存/Swap      | Context Cache (LRU)                    | --                         | TTL 过期 + 自动清理                        |
| 文件系统           | Storage Manager (FS/S3)                | Ada002 Embedding           | `MemoryLayer.PERSISTENT` + PostgreSQL      |
| Pipe / IPC         | Agent 间共享内存                       | 其他 LLM (网络)            | `EventBus` + `MessageBus`                  |
| System Call        | LLM System Call Interface              | --                         | `KernelApiService` (统一入口)              |
| 设备驱动           | Tool Manager                           | 计算器/Python/终端         | `ToolRegistry` + MCP                       |
| 信号 / 中断        | --                                     | --                         | `EventBus.emit()` + Socket.IO              |
| ACL / 权限         | Access Manager                         | --                         | `CapabilityGuard` (能力白名单)             |
| ulimit / cgroups   | API Rate Limiting                      | --                         | Token/Cost Budget + RateLimiter            |
| watchdog / systemd | --                                     | --                         | `ProcessSupervisor` (30s 健康检查)         |
| syslog / journal   | --                                     | --                         | `EventJournal` (事件溯源)                  |
| top / htop         | --                                     | --                         | `KernelMetrics` + `CostAttribution`        |
| checkpoint/restart | Context Switch (text/logits)           | --                         | `checkpoint()` + 崩溃恢复                  |
| 僵尸进程回收       | --                                     | --                         | >2h 自动标记 ZOMBIE                        |
| Init (PID 1)       | --                                     | --                         | `AiKernelModule.onModuleInit()`            |

---

## 五、性能基准对比

### 5.1 AIOS 性能数据 (论文声称)

| 指标           | 传统方式 | AIOS       | 改进        |
| -------------- | -------- | ---------- | ----------- |
| 并发 Agent     | 3-5      | 20+        | 300%+       |
| Agent 内存占用 | 800MB    | 200MB      | 75% 降低    |
| 上下文切换     | 2.1s     | 0.1s       | 95% 更快    |
| API 限流瓶颈   | 频繁     | 智能批处理 | 90% 减少    |
| 错误恢复       | 手动     | 自动       | 100% 自动化 |
| 执行加速       | 基线     | 最高 2.1x  | --          |

### 5.2 GenesisPod 生产数据

| 指标             | 设计值                              |
| ---------------- | ----------------------------------- |
| 全局最大并发进程 | 50 (可配置 `KERNEL_MAX_CONCURRENT`) |
| 租户最大并发进程 | 10 (可配置 `KERNEL_MAX_PER_TENANT`) |
| 调度循环间隔     | 1s (`KERNEL_SCHEDULE_INTERVAL_MS`)  |
| 健康检查间隔     | 30s                                 |
| 进程超时阈值     | 30min (FAILED) / 2h (ZOMBIE)        |
| IPC 最大订阅数   | 10,000 (1h 自动清理)                |
| 默认 Token 预算  | 50,000 tokens/进程                  |
| 默认 Cost 预算   | $1.0/进程                           |

---

## 六、架构深度分析

### 6.1 AIOS 的学术贡献与局限

**贡献**:

- 首次系统性地将 OS 概念映射到 LLM Agent 管理
- 提出 LLM System Call Interface 概念
- 实现了多种调度算法的对比实验
- 论文发表于 COLM 2025，具有学术权威性

**局限**:

- 纯内存实现，无持久化，重启丢失所有状态
- 无多租户隔离，不适用于 SaaS 部署
- 无成本控制机制，无法约束 Agent 的资源消耗
- 无事件溯源，无法审计和重放执行历史
- 上下文切换的 logits-based 方案需要 GPU 直接访问，对闭源模型不适用

### 6.2 Karpathy LLM OS 的愿景价值

**贡献**:

- 定义了 "LLM 即 CPU" 的核心隐喻，影响了整个行业
- 提出了 Software 3.0 概念 (自然语言编程)
- 强调本地推理和隐私保护的重要性
- 多模态 I/O 作为外设的类比具有前瞻性

**局限**:

- 纯概念框架，无任何实现
- 未涉及多 Agent 协作、调度、资源管理等工程问题
- 本地推理假设在企业级场景中不够现实 (模型规模限制)
- 未考虑多租户、成本控制、合规审计等企业需求

### 6.3 GenesisPod 的工程创新

**创新点**:

1. **进程持久化 + 崩溃恢复**: 业界唯一将 Agent 进程状态完整持久化到数据库的系统，支持服务重启后自动恢复
2. **事件溯源**: 每个进程的每个步骤都记录到 `process_events` 表，支持确定性重放和审计
3. **双总线 IPC**: EventBus (广播) + MessageBus (P2P) 分离关注点，MessageBus 支持优先级、TTL、correlationId
4. **能力白名单安全模型**: 每个进程携带独立的 `grantedTools/grantedSkills`，实现最小权限原则
5. **双重预算约束**: Token Budget + Cost Budget 独立约束，防止 Agent 失控消耗资源
6. **Facade 架构边界**: AI App -> Facade -> Engine 单向依赖，严格的分层隔离
7. **行业标准协议**: MCP (工具互操作) + A2A (Agent 互操作) 双协议支持

**待改进**:

| 领域           | 现状                 | 改进方向                  |
| -------------- | -------------------- | ------------------------- |
| 本地推理       | 依赖云 API (LiteLLM) | Ollama/llama.cpp 本地后端 |
| 上下文切换效率 | 数据库 I/O (~毫秒级) | Redis 热路径缓存          |
| Agent 自主度   | 需用户选择模块       | 意图路由 (Agent OS L6 层) |
| 跨模块记忆     | 各模块独立           | 统一记忆层 (路线图 Q2)    |

---

## 七、GenesisPod 独有能力矩阵

以下能力为 GenesisPod 独有，AIOS 和 Karpathy LLM OS 均未涉及:

| 能力                | 实现模块                              | 说明                                  |
| ------------------- | ------------------------------------- | ------------------------------------- |
| 进程状态持久化      | `ProcessManagerService` + PostgreSQL  | 进程状态存数据库，服务重启可恢复      |
| 事件溯源 + 幂等重放 | `EventJournalService`                 | 按 sequence 有序记录，支持确定性重放  |
| 父子进程层级        | `ProcessManager.fork()`               | 支持进程树，团队会话为父进程          |
| 双总线 IPC          | `EventBus` + `MessageBus`             | 广播 + P2P 分离，含优先级/TTL         |
| 进程看护 + 僵尸回收 | `ProcessSupervisorService`            | 30s 健康检查，30min/2h 超时策略       |
| 能力白名单          | `CapabilityGuardService`              | 每进程独立 grantedTools/grantedSkills |
| 双重预算约束        | `ResourceManagerService`              | Token + Cost 独立约束                 |
| 精细成本归因        | `CostAttributionService`              | 按用户/团队/Agent 维度分析            |
| Facade 架构边界     | `AIEngineFacade`                      | AI App -> Facade -> Engine 单向依赖   |
| MCP + A2A 双协议    | `MCPManager` + `A2ATeamMemberAdapter` | 既消费外部工具，也对外暴露能力        |
| 安全管线            | `GuardrailsPipeline`                  | 输入/工具/输出三阶段校验              |
| 模型自动降级        | `ModelFallbackService`                | 主模型不可用时自动切换备选            |
| 紧凑工具描述        | `CompactToolSummary`                  | 200 bytes/tool, 大幅节省 LLM token    |

---

## 八、定位总结

```
                    概念抽象度
                    |
                    |
  Karpathy LLM OS  |  * 愿景级概念框架
  (2023 思想实验)   |     - 定义了 "LLM 即 CPU" 的隐喻
                    |     - 启发了整个 AI OS 研究方向
                    |     - 无实现, 无代码
                    |
                    |
  AIOS              |  * 学术原型
  (COLM 2025)       |     - 严谨的 OS 类比, 首篇系统性论文
                    |     - Python 实现 (GitHub 开源)
                    |     - 聚焦调度/上下文切换性能
                    |     - 无持久化/多租户/成本控制
                    |
                    |
  GenesisPod        |  * 生产级 AI 内核
  (6 层架构)        |     - 完整 OS 概念映射 (16 个内核服务)
                    |     - PostgreSQL 持久化 + 事件溯源
                    |     - 多租户 + 成本归因 + 安全管线
                    |     - 企业级容错 + 熔断 + 降级
                    |     - MCP + A2A 行业标准协议
                    |
                    +------------------------------> 生产就绪度
```

**一句话定位**: Karpathy 画了蓝图，AIOS 做了实验室验证，GenesisPod 将 AI OS 概念工程化为可上线的企业级系统。

---

## 九、对 GenesisPod 路线图的启示

基于本次对比分析，对 [Genesis Agent OS 2026 路线图](./genesis-agent-os-roadmap-2026.md) 的补充建议:

### 9.1 可借鉴 AIOS 的方向

| AIOS 特性               | Genesis 现状       | 建议                                         |
| ----------------------- | ------------------ | -------------------------------------------- |
| SJF 调度算法            | 仅 Priority + FIFO | 引入任务复杂度估算，实现 SJF 优化短任务响应  |
| Logits-based 上下文保存 | 数据库序列化       | 对本地模型场景，可探索 KV Cache 持久化       |
| 多 Agent 框架适配       | 自有 Agent 框架    | 通过 MCP/A2A 适配 AutoGen、CrewAI 等外部框架 |

### 9.2 可借鉴 Karpathy LLM OS 的方向

| LLM OS 概念     | Genesis 现状        | 建议                                              |
| --------------- | ------------------- | ------------------------------------------------- |
| 多模态 I/O 外设 | 文本为主 + 图片生成 | 统一多模态输入 (PDF/音频/视频) 为 "外设驱动" 抽象 |
| 本地推理 (Edge) | 纯云 API            | 引入 Ollama 本地推理后端，用于低延迟/隐私场景     |
| LLM 间网络      | A2A 协议 (初步)     | 深化 Agent-to-Agent 网络拓扑和路由能力            |

---

**最后更新**: 2026-02-28
**维护者**: Claude Code
