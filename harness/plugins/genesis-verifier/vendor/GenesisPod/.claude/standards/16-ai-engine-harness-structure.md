# AI Engine + AI Harness 目录结构规范

**版本：** 1.0
**强制级别：** MUST
**生效日期：** 2026-05-02
**维护者：** Claude Code

> 本规范定义 `ai-engine` / `ai-harness` 的 MECE 结构边界。  
> 扩展契约、定制代码归位、memory/plugin 治理，必须同时遵守
> [17-extension-governance.md](17-extension-governance.md)。

---

## 一、定位与边界（架构唯一判别标准）

| 层                  | 定位                                | 判别口诀                                               |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| **L2 ai-engine**    | LLM 原子能力（无 agent 状态）       | **不需要知道 agent / mission 是谁就能做的事** → engine |
| **L2.5 ai-harness** | Agent 运行时脚手架（含 agent 状态） | **必须知道 agent / mission 才有意义的事** → harness    |

依赖方向严格单向：`L3 ai-app → L2.5 ai-harness → L2 ai-engine → L1 platform`（L4 open-api 在最外层；L1 platform 旧称 ai-infra，真实目录 `modules/platform/`），反向禁止。

---

## 一·补、Agent OS 心智模型（为什么边界在这里）

> 一句话记住这套分层：**harness 是 Agent OS（操作系统），engine 是它驱动的机器（计算引擎——CPU / 存储 / IO 一应俱全）。**
> OS 不"变成"CPU——它**调度**CPU；同理 harness 不实现 LLM 能力，它**编排**engine 的能力。
>
> **关于 "engine" 这个名字**：`engine` 在此是**复数语义**——engine 层是**一族专用引擎**（compute / storage / network / safety），不是单个马达。`storage engine`（如 InnoDB）、`compute engine`（GCE）、`inference engine` 都是业界标准词，正因如此 `engine` 比 `hardware` / `machine` / `compute` 更适合做这一层的名字，保留不改。

### 映射：engine = 一族引擎，每个聚合各自是一台 Engine

关键认识：engine 不是单一"马达"，而是**一族各司其职的引擎**——`ai-engine` 这个名字 = "引擎家族"。**现有 12 个扁平聚合，每一个本身就是一台 Engine**（`tool engine` / `skill engine` / `retrieval engine` / `inference engine` 全是业界标准词）。harness（OS）调度并驱动它们：

| engine 聚合     | 作为引擎             | OS-硬件类比         | 职责                                            |
| --------------- | -------------------- | ------------------- | ----------------------------------------------- |
| **llm**         | 推理引擎 Inference   | CPU / 计算核心      | prompt/completion；selection 选核、pricing 预算 |
| **rag**         | 检索引擎 Retrieval   | 磁盘 / 索引         | embedding / vector / retriever / reranker       |
| **knowledge**   | 知识引擎 Knowledge   | 文件系统语义        | fact / entity / relation 抽取                   |
| **tools**       | 工具引擎 Tool        | IO 设备 + 驱动      | function/mcp/openapi 执行（项目唯一 tools）     |
| **skills**      | 技能引擎 Skill       | 指令集 / ISA        | SkillRegistry（项目唯一）                       |
| **routing**     | 路由引擎 Routing     | 指令译码 / 调度提示 | 无状态语义打分选 model/skill/tool               |
| **planning**    | 规划引擎 Planning    | 微码 / 指令展开     | 任务分解（不含 agent loop）                     |
| **content**     | 内容引擎 Content     | IO 控制器           | fetch / cleaner / markdown                      |
| **safety**      | 安全引擎 Safety      | MMU / 保护环        | pii / moderation / injection / tripwire         |
| **reliability** | 韧性引擎 Reliability | 温控 / 健康监测     | rate-limit / entity-health                      |
| **evaluation**  | 评估引擎 Evaluation  | ECC / 奇偶校验      | 无状态启发式质检（无 LLM、无 agent 状态）       |
| **facade**      | （ABI / 引脚）       | 对外门面            | 仅 re-export，**本身不是引擎**                  |

> **可选的子系统透镜**（仅叙事，非目录层）：这些引擎可松散归为 计算{llm,routing,planning,evaluation}、存储{rag,knowledge}、IO{tools,content}、能力{skills}、安全{safety,reliability} 四五个子系统——就像硬件分计算复合体/存储子系统/网络子系统/安全协处理器。但**每台引擎独立成立**，不强制按子系统建目录。
>
> 对照 **harness/memory = RAM**（OS 管理的工作态）：**检索/存储引擎（engine/rag）= 持久磁盘**。一静一动，正是"无状态基元 vs 有状态运行时"的硬件版。
>
> **结论：无需重构**。"engine = 一族引擎"恰好印证当前 12 个扁平聚合就是对的——每个聚合即一台引擎，名字与结构都不用动；4 桶子系统仅作助记，不落地为 `engine/{compute,storage,...}/` 目录层。

### 映射：harness = 操作系统

| harness 聚合   | OS 子系统                  | 含义                                                                 |
| -------------- | -------------------------- | -------------------------------------------------------------------- |
| **runner**     | 调度器 / 取指-译码-执行环  | observe→reason→act 就是 OS 主循环                                    |
| **agents**     | 进程表（PCB）              | 每个 agent/mission = 一个进程                                        |
| **memory**     | 内存管理                   | working=RAM、checkpoint=swap/快照、event-store=WAL、consolidation=GC |
| **guardrails** | 资源限额（cgroups/ulimit） | budget/quota/rate-limit/concurrency = 进程资源配额                   |
| **protocols**  | IPC + 系统调用             | a2a/ipc/events/realtime/journal = 管道 / 信号 / socket               |
| **handoffs**   | 上下文切换                 | agent→agent = 进程上下文切换                                         |
| **teams**      | 多进程编排 / 进程组        | collaboration（voting/debate/review）= 进程组共识                    |
| **lifecycle**  | init / supervisor          | hooks/manager/supervisor/mission-lifecycle = systemd + 故障恢复      |
| **tracing**    | 可观测（dtrace/perf）      | otel/latency/llm-events = 系统级追踪                                 |
| **evaluation** | 带进程上下文的运行时 QA    | critique/verify 知道"哪个 mission 在跑"                              |
| **facade**     | 系统调用接口 / ABI         | 上层 app 链接的公共入口                                              |

### 上下游

- **L1 platform / ai-infra** = 固件 / BIOS / 物理基座（db、secrets、encryption、key-health = TPM / 存储控制器）——机器之下。
- **L3 ai-app** = 用户态应用程序；**L4 open-api** = shell / 对外公共 ABI。

### 为什么这个比喻能"证明"我们的铁律

| 现有铁律                                | OS 版表述（更直觉）                                                     |
| --------------------------------------- | ----------------------------------------------------------------------- |
| engine 无 agent/mission 状态            | **硬件不知道是哪个进程在用它**——CPU 不记得调用方是谁                    |
| 依赖方向 harness → engine，反向禁止     | **OS 驱动硬件，硬件从不回调 OS**                                        |
| 无状态基元 vs 有状态运行时              | **持久硬件（engine/rag=磁盘）vs OS 管理的工作态（harness/memory=RAM）** |
| 同名概念全项目唯一（tools 只在 engine） | **一台机器只有一套硬件**；OS 不自带第二块 CPU                           |

### 边界声明：这是叙事，不是改名令

OS 心智模型用来**解释和记忆**边界，**不**改变它，也**不**触发重命名。顶层目录仍用 agent 框架的**业界标准词**（runner/agents/memory/...），**禁止**按 OS 词汇自造 `kernel/process/syscall/governance/runtime`（见 §五 互斥性原则；历史：`ai-kernel/`、`ai-engine/runtime/` 曾用此类命名，已删除并整合进 harness）。判别仍以**第一节"有没有 agent/mission 状态"**为唯一标准；OS 类比只是它的助记层。

### §一·补·二、App vs System（什么进 ai-app、什么算系统）

判别口诀——与 engine 黄金法则同构的**"复用 / 重建"测试**：

> **"每个产品都得自己重新建它吗？"**
>
> - **不需要**（人人复用的底座：auth/身份、billing/credits、notifications、settings、secrets、storage）→ **System**
> - **需要**（它是该产品独有的领域功能："深度研究"的流程、"探索"的信息流）→ **App（L3 ai-app）**

等价问法："这是用户打开的一个*产品*，还是*所有产品都依赖的一项能力*？" 产品 → app；人人都要的能力 → system。

> 例：**auth 是 system**——没有哪个产品会"自己重建一套登录"，它是所有产品复用的底座。故 auth 的 HTTP 进 open-api（系统面）、service 留 platform，**不进 ai-app**。用户可见 ≠ 产品。

System 按"职责 vs 暴露"落两层：

- **System 逻辑** → **L1 platform**（基础设施服务的 service 本体）
- **System HTTP** → **L4 open-api**（系统 API 网关：admin + 对外协议 + 一方系统服务端点）
- engine（硬件）/ harness（内核）**永不开 HTTP**。

可操作信号：

| 信号                                                             | 判定       |
| ---------------------------------------------------------------- | ---------- |
| 被多数 app 跨层复用（credits 被 5 app、secrets 被 6 处）         | **system** |
| 账户 / 身份 / 计费 / 通知 / 设置 / 密钥 / 存储 / 运维 / 对外协议 | **system** |
| 绑定单一产品域、带领域语义（"研究 / 问答 / 探索"）               | **app**    |
| 领域内容的生产 / 浏览 / 编辑                                     | **app**    |

---

## 二、ai-engine 顶层（12 个聚合，业界标准词）

```
agents 域之外的"原子能力"，全部放 engine（每个聚合即一台「引擎」，见 §一·补）：
llm · tools · rag · knowledge · skills · planning · safety · content · routing · reliability · evaluation · facade
```

| 聚合            | 职责                                                                                                    | 关键边界                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **llm**         | LLM 调用 + 模型适配 + 路由 + 定价 + BYOK + 意图识别（内部分 chat/providers/byok/output/prompts/models） | 无 agent 状态；含 model pricing。注：通用 key-health 已迁 platform（PR#232）        |
| **tools**       | 工具目录 + 单次执行 + 来源适配（含 MCP）                                                                | **项目唯一的 tools/**；含 mcp/openapi/function adapter                              |
| **rag**         | 检索增强生成基元                                                                                        | embedding / vector / chunker / retriever / reranker                                 |
| **knowledge**   | 知识抽取                                                                                                | fact / entity / relation / context-evolution / world-building                       |
| **skills**      | Skill 定义 + 注册（SKILL.md 风格）                                                                      | **项目唯一的 SkillRegistry**                                                        |
| **planning**    | 任务分解（不含 agent loop）                                                                             | task-planner / decomposer                                                           |
| **safety**      | 输入输出安全                                                                                            | pii / moderation / injection                                                        |
| **content**     | 内容处理基元                                                                                            | fetch / cleaner / markdown / citation / figure                                      |
| **routing**     | 通用语义打分路由 core（LLM/Tools/Skills 共用）                                                          | scored-router / semantic-retrieval / signal-scorers；无 agent 状态；2026-06-02 新增 |
| **reliability** | 引擎级韧性（无 agent 状态）                                                                             | rate-limit / entity-health；2026-W7 扩出                                            |
| **evaluation**  | 无状态启发式质量检查（无 LLM、无 agent 状态）                                                           | 与 harness/evaluation（agent 感知评判）有意分层，**勿合**；2026-W2 扩出             |
| **facade**      | engine 对外门面                                                                                         | 仅 re-export，无业务逻辑                                                            |

---

## 三、ai-harness 顶层（11 个聚合，业界标准词）

```
agents · runner · teams · handoffs · memory · protocols · evaluation · guardrails · tracing · lifecycle · facade
```

| 聚合           | MECE 关注点                                      | 关键边界                                                                                         |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **agents**     | WHAT agents are                                  | core / base / registry / domain / **subagents** / dev-tools                                      |
| **runner**     | HOW they run                                     | loop / executor / tool-invoker / tool-routing / context / **scheduler**                          |
| **teams**      | GenesisPod 团队业务模式                          | abstractions / base / profile / factory / registry / orchestrator / services / **collaboration** |
| **handoffs**   | Agent 切换（OpenAI 标准词）                      | pattern + registry                                                                               |
| **memory**     | WHAT they remember                               | vector / working / checkpoint / event-store / stores / consolidation / indexing                  |
| **protocols**  | HOW they communicate（**仅 5 个 agent 层协议**） | a2a / ipc / events / realtime / journal（**MCP 不在此**）                                        |
| **evaluation** | WHO judges them                                  | critique / verify / figure                                                                       |
| **guardrails** | WHO constrains them                              | budget / billing / rate-limit / concurrency / constraint / runtime-env                           |
| **tracing**    | WHO observes them                                | otel / eval / latency / llm-events / attribution / observability                                 |
| **lifecycle**  | WHO recovers them                                | hooks / manager / supervisor / mission-lifecycle / learning                                      |
| **facade**     | WHO exposes them                                 | ai.facade / domain / sub-facades / api / providers                                               |

---

## 三·补、OS 视角目录再审计（2026-06-03，roadmap）

> 用 §一·补 的 Agent-OS 逻辑重审 engine + harness 目录。四个动作：**下沉**（→L1 platform/固件）、**上提**（→L3 ai-app/用户态）、**收口**（同名概念合一）、**补缺**（gap）。⚠️ 标"看似散落实为有意分层、勿动"。**结论：行为敏感的合并先核实边界再动，不盲目执行。**

### 收口（同名概念多处——优先级最高）

| 概念                | 散落位置                                                                                                       | 置信 | 性质                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| **checkpoint**      | `harness/memory/checkpoint` + `harness/memory/mission-checkpoint`（各有 checkpoint.service + in-memory-store） | 高   | 同聚合两套；违"checkpoint 不分两处"。**先核实 agent 级 vs mission 级作用域**再合并/重命名                                     |
| **prompt registry** | `engine/llm/prompts`（PromptRegistryService）+ `harness/runner/prompt`（PromptRegistry）；均做版本+A/B         | 高   | 两套 PromptRegistry、数据模型不同 → **设计级合并**（非移动）；engine 侧=无状态定义、harness 侧=按 userId 运行时路由，先定谁留 |
| **image/媒体引擎**  | `engine/llm/image` + `engine/content/image` + `engine/tools/.../image-search`                                  | 高   | GPU 引擎散三处                                                                                                                |
| **code 执行**       | `engine/skills/sandbox` + `engine/tools/.../execution`                                                         | 中   | 沙箱/解释器散两处                                                                                                             |
| **learning**        | `harness/agents/learning`（技能习得）+ `harness/lifecycle/learning`（失败复盘）                                | 中   | 两类不同 learning，归属待统一                                                                                                 |
| **memory tools**    | `harness/memory/tools/*.tool.ts`                                                                               | 中   | tools 出现在 engine 外；但属**有状态**记忆工具，不能沉 engine → 裁决"定义入 registry、实现留 harness"                         |

### 下沉 L1 platform

- billing 主体已在 `platform/credits`；`harness/guardrails/billing` 仅 1 个 adapter（端口），低优先。

### 上提 L3 ai-app

- **暂无**。最像的 `harness/agents/domain`、`harness/teams/business-team` 经核实均为**通用框架**（domain-adapter / `.framework.ts`），**留 harness**。

### 补缺（gap，产品 roadmap，非重构）

- **Audio/Speech 引擎**（声卡 ASR/TTS）：全树无。
- **权限/能力授权**（OS access-control：agent × tool 授权）：待确认 `guardrails/constraints` 是否覆盖。

### ⚠️ 勿动（有意分层，非散落）

- `engine/evaluation`（无状态启发式）/ `harness/evaluation`（agent 感知评判）/ `harness/tracing/evaluation`（评估追踪）：三者职责不同。
- `engine/skills`（定义）vs `harness/agents/skill-runtime`（运行）：def/runtime 分工，正确。

### HTTP 接口面（controller 归属）

> OS 类比：HTTP 入口属 **L4 open-api（公共 API 网关/daemon）** 与 **L3 ai-app（用户态应用各开各的 socket）**；**engine（硬件）/ harness（内核）/ platform（固件）不开 HTTP 口**。
>
> **绝对原则（2026-06-03 裁定）**：**任何外部可访问的 HTTP 端点都属 open-api 或 ai-app，无永久例外。** 连 Prometheus `/metrics` 抓取端点也算外部访问 → 同样上提 open-api（`system/monitoring`），不在 platform 永久保留。

**🔒 已 spec 看护**：`src/__tests__/architecture/layer-1-topology/no-http-in-lower-layers.spec.ts`（进 `verify:arch`）硬焊 **engine/harness = 0 `@Controller`**，platform 带**收缩 ALLOWLIST**（搬一个删一行，清空即焊 0）。新增越界 controller 即红。

实测（2026-06-03，持续上提中）：`@Controller` 数 = **engine 0** · **harness 0** · platform **2**（auth/metrics，余 ALLOWLIST；credits/notifications/admin-\* 已上提 open-api/system）。清零后 platform 与 engine/harness 同样硬焊 0。

- ✅ **engine / harness = 0 controller** —— 最关键的不变量已满足，无需动。
- ✅ **两个 HTTP 面有意区分，勿合并**：`ai-app` = 一方前端 feature API（ask/explore/byok）；`open-api` = 对外/协议/管理面（a2a / mcp-server / admin / public-api / agents-api·skills-api·teams-api / webhooks）。把 ai-app 的 91 个 feature controller 灌进 open-api 会搅混两个面、破坏内聚 → **不做**。
- 🎯 **platform 应 = 0 controller**（与 engine/harness 同理：L1 固件层不开 HTTP）。当前 9 个 controller 该上提；**但 service 留 platform**（实测 CreditsService/SecretsService/NotificationService/SettingsService 被多个 ai-app + ai-engine 跨层消费 = 真·共享 L1 基元）。只搬 HTTP 层（controller+DTO+guard），新家注入 platform service。映射：

  按 **App vs System 原则**（见 §一·补·二）：platform 的 controller **几乎全是 system 横切能力**（auth/credits/notifications/settings/secrets/storage 被多数 app 跨层复用），故 HTTP 一律进 **open-api（系统 API 网关）**，**不进 ai-app**（ai-app 只接纯产品域端点）：

  | platform controller                                     | 路由      | → 去向                         | 性质                      |
  | ------------------------------------------------------- | --------- | ------------------------------ | ------------------------- | -------------------------------- |
  | platform controller                                     | 路由      | → 去向                         | 性质                      | 状态                             |
  | ---                                                     | ---       | ---                            | ---                       | ---                              |
  | db-ops · secrets · secret-keys · settings（AdminGuard） | `admin/*` | **open-api/admin**             | 系统管理                  | ✅ 已合 **PR#238**               |
  | notifications/unsubscribe（RateLimit 无鉴权）           | 公开      | **open-api/public-api**        | 系统对外                  | ✅ 已挪走                        |
  | auth · credits · notification（jwt 一方用户）           | 一方      | **open-api（系统服务面）**     | 系统横切（用户可见≠产品） | ⏳ 批2（生产关键，独立 PR）      |
  | storage-governance（无 guard）                          | 待确认    | open-api（admin 或系统面）     | 系统                      | ⏳ 批3                           |
  | metrics（`/metrics` 抓取端点）                          | 机器      | **open-api/system/monitoring** | 监控                      | ⏳ 待搬（外部访问 = 无永久例外） |

  > **执行约束**：跨层 module 重接线 + 生产关键路由（auth/credits），route/guard **原样保留**，**只搬 controller+spec，service/DTO/pipe 留 platform**（service 自身 import DTO，搬 DTO 会造 L1→L4 反向依赖）；勿漏删 platform 各 `index.ts` barrel 的 controller export；靠**真 dist boot-smoke** + 测试验 DI。**独立 PR**，不与其它重构混。分批：✅ 批1 `admin/*`（PR#238）· ⏳ 批2 auth/credits/notification · ⏳ 批3 storage-governance/metrics。
  >
  > **推论（roadmap，本轮不动）**：`ai-app/byok`（用户密钥/provider 管理 10+ controller）按原则属**账户级 system**，非产品域 → 严格说该归 system（open-api），而非 ai-app。

### 执行优先级

1. **高置信纯结构**：image 收口、checkpoint 收口（先核实作用域）。
2. **设计级**：prompt registry 边界裁决后合并。
3. **中**：code-exec、learning、memory-tools 逐个核 import 面排期。
4. **gap**（语音/权限）：产品定，非重构。

---

## 四、关键归位规则（消除当前歧义）

### 跨层归位（engine ↔ harness）

| 项                       | 归位                         | 理由                                                                   |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------- |
| **MCP**                  | `engine/tools/adapters/mcp/` | tool source adapter，无 agent 状态。与 OpenAPI / function adapter 同层 |
| **ModelPricingRegistry** | `engine/llm/pricing/`        | 模型定价是 LLM 能力                                                    |
| **SkillRegistry**        | `engine/skills/registry/`    | 项目唯一，禁止 harness 再有第二个                                      |

### 跨聚合归位（harness 内部）

| 项                                                                             | 归位                                   | 理由                                               |
| ------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------- |
| `A2AMessage` 接口                                                              | `protocols/ipc/abstractions/`          | A2AMessage 是 IPC 协议接口源头，**禁止再放 teams** |
| `Mission` 核心类型                                                             | `agents/abstractions/mission.types.ts` | 通用 agent 任务抽象，跨 250+ 文件                  |
| `mission-health.monitor / orphan-detector / ownership / abort / runtime-state` | `lifecycle/mission-lifecycle/`         | 是生命周期治理不是编排                             |
| `subagent-spawner`                                                             | `agents/subagents/`                    | 匹配 Anthropic：subagent 是 agent 子能力           |
| `kernel-scheduler`                                                             | `runner/scheduler/`                    | task queue 调度是 run loop 子能力                  |
| `voting / debate / review`                                                     | `teams/collaboration/`                 | 团队内协作模式                                     |
| `failure-learner`                                                              | `lifecycle/learning/`                  | 失败学习是生命周期闭环                             |

### 命名替换（消除自造词）

| 旧名（自造）                           | 新名（业界标准）                                                          | 来源                            |
| -------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| `kernel/`                              | `agents/`                                                                 | OpenAI / Google / Anthropic SDK |
| `execution/`                           | `runner/`                                                                 | OpenAI Runner / Google Runner   |
| `process/`                             | 拆 `lifecycle/` + `agents/subagents/` + `runner/scheduler/` + `handoffs/` | `process` 不是 agent 域词       |
| `protocol/`                            | `protocols/`（复数）                                                      | 含多种协议；MCP 移出            |
| `governance/`                          | 拆 `evaluation/` + `guardrails/` + `tracing/` + `lifecycle/learning/`     | `governance` 不是 SDK 词        |
| `runtime/`                             | 解散到各正确归属                                                          | `runtime` 太 generic，僵尸目录  |
| `runtime/abstractions/` 大杂烩         | **删除**，每个聚合自己 abstractions/                                      | 反模式                          |
| `kernel-api`                           | `harness-api`                                                             | 与 kernel 目录冲突              |
| `runtime/mission/mission-orchestrator` | `runner/plan-execution/task-execution-orchestrator`                       | 与 teams orchestrator 解冲突    |
| `memory/dream/`                        | `memory/consolidation/`                                                   | 业界标准词 memory consolidation |
| `memory/auto-index/`                   | `memory/indexing/`                                                        | 简洁                            |
| `teams/constraints/constraint-profile` | `teams/profile/mission-execution-profile`                                 | 与 guardrails/constraint 解冲突 |

---

## 五、子目录 MECE 规则

### 0. 切分轴（正向原则，**先定轴再切目录**）

> **一句话原则**：一个聚合的子目录沿**单一内聚轴**切分，每个子目录 = **一件能独立命名的事**；**绝不按文件种类切**（`utils/` / `helpers/` / `services/` / `models/`-当领域用 = 纯分类壳）。

**轴的两种合法形态**（每聚合取其一，不在同一层混用）：

- **A · pipeline 阶段** —— 聚合本质是条数据流水线时，按阶段切。例：`rag/` = chunking → embedding → vector → pipeline。
- **B · 内聚子能力 / 关注点** —— 聚合是一族能力时，按"能独立命名的子能力"切。例：`content/` = fetch / web-search / markdown / citation / figure / …。

**唯二例外**（按文件种类、却合法的目录）：`abstractions/`（接口契约）、`types/`（纯类型）—— 规范钦定的通用模式，每聚合可有。

> **关键：内聚的判据随聚合而变，不要求全聚合统一。** "一件事"在 content 里是"对内容做的一个操作"，在 rag 里是"流水线一个阶段"，在 safety 里是"一类安全关注点"。因此**每个聚合必须声明自己的内聚轴**，兄弟目录互斥（见下 #1）按该聚合**声明的轴**检验。

| 聚合            | 内聚轴                      | 子目录的单元 =                                                                        |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| **llm**         | B 调用关注点/阶段           | provider 适配 / chat 编排 / output 处理 / model 择优 / byok / prompts                 |
| **rag**         | **A pipeline 阶段**         | 检索流水线一个阶段（chunk/embed/vector/pipeline）                                     |
| **knowledge**   | B 知识子能力                | 一类知识操作（extraction/consistency/synthesis/world-building/evidence/rerank）       |
| **content**     | B 内容子能力                | 对内容做的一件事（fetch/web-search/markdown/citation/figure/report-template/sources） |
| **tools**       | B 执行基建 + 工具领域分类法 | registry/middleware/cache/concurrency/adapters… + `categories/<domain>`               |
| **skills**      | B skill 生命周期 + 关注点   | registry/loader/builder/spec-builder/routing/sandbox/integration/marketplace…         |
| **planning**    | B 规划/调控原语             | 一类原语（budget/context/intent/reflection）                                          |
| **safety**      | B 安全关注点                | 一类防护（guardrails/moderation/security/validation）                                 |
| **reliability** | B 韧性机制                  | 一种机制（rate-limit/entity-health）                                                  |
| **evaluation**  | B 质检组件                  | checkers/services（+ abstractions/types 例外）                                        |
| **routing**     | B 打分路由组件              | 基本扁平（根）+ benchmark（离线评测）                                                 |
| **facade**      | ——                          | 仅 `abstractions/`，无领域子目录（门面只 re-export）                                  |

**判一个目录/文件该不该独立成子目录 —— 三问**（任一为否即不该）：

1. 它是不是该聚合**声明轴**上"一个能独立命名的单元"？（✓ `citation`/`chunking`；✗ `utils`/`text`）
2. 和兄弟目录在**同一轴**上互斥、不功能重叠？
3. 不是把杂项凑一起的**壳**？

> **轴外的跨领域纯原语**（如某个通用文本/解析 util，不绑任何子能力）：不强切成壳目录——**要么并入它真正所属的子能力，要么（确无归属时）留在聚合根，要么搬到更贴的聚合**。"为清空聚合根而造 `text/` 之类分类壳"本身就违反下 #2。

### 通用模式（每个聚合 SHOULD 有）

- `abstractions/` —— 接口契约 + 类型定义集合（**每个聚合自己拥有，禁止跨聚合 re-export 大杂烩**）
- `xxx.module.ts` —— NestJS 模块入口（每个聚合 1 个）

### 互斥性强制原则

1. **兄弟目录互斥**：同一父目录下子目录不可有功能重叠（按 §五.0 该聚合**声明的轴**检验）
2. **不创建空容器**：禁止 `patterns/`、`utilities/`、为清根而设的 `text/` 等**纯分类壳**
3. **不超过 2 层嵌套**：超过则需重新审视拆分粒度（注：`xxx/models/selection`、`tools/categories/<domain>` 等成熟 3 层为已接受例外）

---

## 五·补、ai-engine 递归子目录 MECE 看护（2026-06-04 全量审计后硬化）

> **背景**：2026-06-04 对 `ai-engine/` 12 聚合做了递归全量审计（每个聚合实读 index/module/代表 service）。顶层 12 聚合划分干净，但递归子目录层暴露出"agent 状态泄漏进 L2、同名概念重复、自造词目录、垃圾抽屉"等存量违规。本节把可机判的不变量固化为 **6 条律**，由 spec 看护：
>
> **🔒 已 spec 看护**：`src/__tests__/architecture/layer-4-vocabulary/ai-engine-structure.spec.ts`（进 `verify:arch`）。每条律带**收缩 ALLOWLIST**跟踪存量违规（搬一个删一行，清空即硬焊 0），新增违规即红。

### 每个聚合的目标子目录（reviewer 参照，spec 不逐一硬焊；偏离用律 1-6 兜底）

| 聚合            | 目标子目录（√=合规存量）                                                                                                                                                      | 已知偏离（待整改）                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **llm**         | abstractions / adapters / byok / chat / factory / image / models{capability,catalog,config,pricing,selection} / output{sanitization,structured} / prompts / providers / types | —                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **tools**       | abstractions / base / registry / middleware / concurrency / cache / result-spill / search-fusion / adapters{mcp} / categories{…taxonomy}                                      | `adapters/` 缺 openapi/function（spec 声称有）；`categories/collaboration/*` 含 agent 编排语义（R1 灰区）                                                                                                                                                                                                                                                                                                                |
| **rag**         | abstractions / chunking / embedding / vector / pipeline                                                                                                                       | pipeline 内联 Cohere rerank（与 knowledge/rerank 概念撞）                                                                                                                                                                                                                                                                                                                                                                |
| **knowledge**   | abstractions / extraction / consistency / synthesis / world-building / evidence / rerank                                                                                      | ✅W5 `search/`（web egress）已迁 content/web-search；✅W1 `rerank/` 去重为项目唯一权威                                                                                                                                                                                                                                                                                                                                   |
| **content**     | abstractions / fetch / web-search / sources / markdown / citation / figure / report-template / types                                                                          | 轴=内容子能力。✅W5 `web-search/` 从 knowledge 迁入（与 fetch 同族）+`SearchResult`→`WebSearchResult`；✅后缀统一 `.utils.ts`→`.util.ts`（§六）；`json-fence-parser.util` / `text-similarity.util` = **轴外跨领域纯原语留聚合根**（无内容子能力可归，§五.0 末段，**勿造 `text/` 分类壳**）；✅`image/` 壳已收（死代码清理后只剩 types 的单子目录残壳，违 §五.2 → image-matching.types 上提 `content/types/`，删 image/） |
| **routing**     | abstractions / （根）scored-router / signal-scorers / scoring-formulas / benchmark                                                                                            | ✅W6 `eval/`→`benchmark/`；✅`routing.types`→`abstractions/`（对齐其余 11 聚合通用模式）。**单能力聚合，刻意扁平**——再切 `scoring/`/`adapters/`/`utils/` 即造壳违 §五.2                                                                                                                                                                                                                                                  |
| **reliability** | rate-limit / entity-health                                                                                                                                                    | ✅W6 `entity-health` 头注释已澄清=circuit-breaker 模式（内部类型沿用 circuit-breaker 业界术语，对外名 entity-health，accepted）                                                                                                                                                                                                                                                                                          |
| **evaluation**  | abstractions / checkers / services / types                                                                                                                                    | 干净（无 LLM、无 agent 状态，已核实）                                                                                                                                                                                                                                                                                                                                                                                    |
| **skills**      | abstractions / base / registry / types / loader / builder / spec-builder / content / output-manager / routing / analytics / sandbox / marketplace / integration               | ✅W3 `runtime`→`integration`、`ecosystem`→`marketplace`；✅W2 `spec-builder` 的 `IAgentSpec`→`ISkillExecSpec`（去 R1 词汇泄漏 + 解与 harness `IAgentSpec` 撞名）                                                                                                                                                                                                                                                         |
| **planning**    | budget / context / intent / reflection                                                                                                                                        | `planning.module` 注册了 3 个 knowledge 聚合 service（physical 在 knowledge/，DI 在 planning/）——**accepted**：6-9 消费方经 @Global ai-engine.module 注入，挪 DI 注册有 boot-DI break 风险，收益仅 cosmetic（W6 评估后留）                                                                                                                                                                                               |
| **safety**      | guardrails / moderation / security / validation                                                                                                                               | ✅W3 `utils/` 已拆（reliability + content/figure）；✅W2 `security/capability-guard` 迁 harness/guardrails/capability（R1 律4，原 PR-X3 误置 engine）                                                                                                                                                                                                                                                                    |
| **facade**      | abstractions                                                                                                                                                                  | ✅W4 孤儿死分区 `exports/*` 已删；index.ts 深穿 L1 credential = **有意的 circular-load 规避**（facade/index.ts:779-784 文档化：走 platform barrel 会 `export *` 拉大加载图触发循环加载失败），accepted 不改                                                                                                                                                                                                              |

### 六条律（spec 硬焊）

| 律                       | 规则                                                                                                                                            | 当前 ALLOWLIST（存量违规，清空即焊）                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **律1 顶层 12 聚合**     | `ai-engine/` 顶层目录 ∈ {llm,tools,rag,knowledge,content,skills,planning,safety,routing,reliability,evaluation,facade}，多一个即红              | 空（已精确）                                                       |
| **律2 禁垃圾抽屉**       | 子树内禁出现 `utils`/`helpers`/`common`/`misc` 目录（无单一职责的杂物袋）                                                                       | 空（W3 已焊：safety/utils 拆 reliability + content/figure）        |
| **律3 禁自造词目录**     | 子树内禁结构性目录名 ∈ {runtime,kernel,execution,process,governance,ecosystem}（`tools/categories/*` 工具分类法除外）                           | 空（W3 已焊：runtime→integration、ecosystem→marketplace）          |
| **律4 R1 无 agent 状态** | engine 源码禁查 agent/mission 运行时表（`prisma.agentProcess` / `prisma.mission.` / `.agentProcess.find\|update\|...`）——engine 不知 agent 是谁 | 空（W2 已焊：capability-guard 迁回 harness/guardrails/capability） |
| **律5 同名概念唯一**     | 看护类名全项目唯一；`LlmRerankerAdapter` 以**引擎版**（`knowledge/rerank`）为权威，他处禁再声明                                                 | 空（W1 已焊：insight 本地副本已删）                                |
| **律6 引擎词汇纯净**     | engine 禁出现 `IAgentSpec` / `agent-spec` 命名（agent 概念不进 L2 词汇）                                                                        | 空（W2 已焊：engine IAgentSpec → ISkillExecSpec）                  |

> 律 1-3、5-6 看目录/类名/符号，律 4 看 DB 查询。**R2（engine 0 controller）已由 `no-http-in-lower-layers.spec.ts` 看护，本 spec 不重复。**

---

## 六、文件命名规范（强制）

### 框架文件（必须用 `.<框架后缀>.ts`）

```
.service.ts          NestJS 注入服务（@Injectable）
.module.ts           NestJS 模块（@Module）
.controller.ts       NestJS 控制器（@Controller）
.gateway.ts          WebSocket 网关
.guard.ts            Guard
.middleware.ts       NestJS Middleware
```

### 数据/契约文件

```
.interface.ts        TypeScript 接口（IXxx 类型）
.types.ts            类型定义集合（多个 type/enum）
.dto.ts              DTO（Zod schema / class-validator）
.constants.ts        常量集合
```

### 通用模式（kebab-case + 描述性后缀，**不**用点号）

```
xxx-registry.ts      注册中心
xxx-factory.ts       工厂
xxx-adapter.ts       适配器
xxx-store.ts         持久化存储
xxx-strategy.ts      策略
xxx-pipeline.ts      管道
xxx-runner.ts        运行器（loop 算法）
xxx-executor.ts      执行器
xxx-scheduler.ts     调度器
xxx-orchestrator.ts  编排器
xxx-monitor.ts       监视器
xxx-detector.ts      检测器
xxx-scanner.ts       扫描器
xxx-tracer.ts        追踪器
xxx-judge.ts         judge 实现
xxx-listener.ts      事件监听
xxx-spawner.ts       派生器
```

### 域实例文件（用 `xxx.<域>.ts`）

```
.tool.ts             Tool 实现类
.agent.ts            Agent 实现类
.skill.ts            Skill 实现类
.stage.ts            Pipeline 阶段（GenesisPod 特有）
```

### 工具/原语

```
.util.ts             纯函数工具
无后缀 kebab-case    简单类（如 consensus.ts、harnessed-agent.ts、token-chunker.ts）
```

### 反模式（禁止）

- ❌ `utils.ts` / `helpers.ts` / `common.ts`（杂物袋，无单一职责）
- ❌ `xxx.types.ts` 与 `xxx.type.ts` 混用（统一用复数 `.types.ts`）
- ❌ 单文件超过 500 行（拆 sub-module）
- ❌ 同名概念跨层重复实现（如两个 SkillRegistry / 两个 ToolRegistry）

---

## 七、Facade 边界守护（继承自 14-skills-development）

### 三条铁律

1. **ai-app 必须从 `ai-engine/facade` / `ai-harness/facade` 导入**，禁止穿透内部路径
2. **新增符号先在 facade index 补 export**，再在 app 层使用
3. **禁止动态 `import()` 绕过 facade**

### 跨层 import 白名单

- `ai-app/**` → `ai-harness/facade/**`、`ai-engine/facade/**`
- `ai-harness/**` → `ai-engine/facade/**` + 合法 adapter（如 engine-skill-provider）
- `ai-engine/**` → 不得 import `ai-harness/**`、`ai-app/**`
- `platform/**`（L1，旧称 ai-infra）→ 不得 import 上层

由 ESLint `no-restricted-imports` + jest 架构边界 spec + pre-push hook **三层看护**。

---

## 八、对外 SDK 标准词对照（参考）

| 概念          | Anthropic Claude Agent SDK | OpenAI Agents SDK | Google ADK      | Microsoft AutoGen | CrewAI |
| ------------- | -------------------------- | ----------------- | --------------- | ----------------- | ------ |
| Agent 定义    | agent                      | agents            | agents          | agents            | agent  |
| 运行循环      | query                      | runner            | runners         | core.runtime      | crew   |
| 工具          | tool                       | tool              | tools           | tools             | tools  |
| 多 agent 协同 | subagents                  | handoffs          | flows           | teams             | crew   |
| 记忆          | memory                     | memory/session    | memory/sessions | state             | memory |
| 追踪          | (none)                     | tracing           | (built-in)      | (built-in)        | (none) |
| 限额          | permissions                | guardrail         | (built-in)      | (built-in)        | (none) |
| 协议          | mcp                        | mcp               | (built-in)      | (built-in)        | (none) |
| 生命周期      | hooks                      | lifecycle         | callbacks       | (built-in)        | (none) |

GenesisPod 选词：取业界共识的最常见词，且每个名字单一概念，杜绝同名歧义。

---

## 九、整改执行规则（开工时遵守）

### 单 PR 范围

1. 一个 PR 仅做**一个聚合的迁移 / 一个跨聚合的归位**
2. 必须包含：源文件移动 + 所有 importer 路径更新 + 测试更新 + facade re-export 更新
3. 必须通过 `npm run verify:arch` + 相关 spec
4. commit message: `refactor(harness): #1 MECE-W<wave>X <动作摘要>`

### 路径迁移工具

- 跨子树移动用 `git mv` 保留历史
- 子树内部相对 import 改 `@/` 别名（避免深度漂移）
- 已有 ESLint `no-restricted-imports` 配置必须**先**更新，再移文件（否则规则会暂时漏跑）

### 不破坏对外 API

- `facade/index.ts` 中的所有 export 在迁移期间**必须保持**（路径可改，符号名不动）
- 标记 `@deprecated` 给一个 PR 的过渡期，再删除

---

## 十、参考文档

- [13-module-dependencies.md](13-module-dependencies.md) —— 模块依赖关系总览
- [17-extension-governance.md](17-extension-governance.md) —— 扩展治理、定制代码归位、memory/plugin 边界
- [14-skills-development.md](14-skills-development.md) —— Skill 开发规范
- [02-directory-structure.md](02-directory-structure.md) —— 项目级目录规范
- [skills/ai/ai-architecture-layering/SKILL.md](../skills/ai/ai-architecture-layering/SKILL.md) —— 详细分层文档
