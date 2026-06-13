# 对标 Anthropic Managed Agent — 全量差距审计总报告

**审计日期**: 2026-04-30
**对标对象**: Anthropic Managed Agent / Claude Agent SDK 官方形态
**审计方式**: 4 路并行 arch-auditor（只读，每条结论附文件路径 + 行号）
**子报告**:

- [Loop + Skill](./anthropic-managed-agent-loop-skill-gap-2026-04-30.md)
- [Memory + Checkpoint](./anthropic-managed-agent-memory-gap-2026-04-30.md)
- [Hook + Permission + MCP](./anthropic-managed-agent-hook-gap-2026-04-30.md)
- [产品 UI + 配置形态](./anthropic-managed-agent-ui-gap-2026-04-30.md)

---

## 一、整体对齐度评估

| 维度                 | 对齐度  | 说明                                                                                                             |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| Agent Loop           | **85%** | ReActLoop / parallel_tool / circuit breaker / context compactor 已有；缺 stop_when 一等公民 + mid-loop interrupt |
| Skill 体系           | **40%** | SKILL.md 格式完整，但 progressive disclosure 未实现 + playground 18 份 duty.md 完全绕过 Registry                 |
| Subagent / Tool      | **70%** | hook 拦截链完整，allow/deny 有；缺 ask 级、缺 LLM 主动 spawn、worktree 非真实 git                                |
| Memory               | **50%** | 三套并行存储栈无统一抽象；S12 写 embedding=[] 是退化；HierarchicalMemory 进程重启全丢                            |
| Session / Checkpoint | **55%** | Agent 级快照完整 + fork 可用；Mission 级正常路径未写 checkpoint，进程重启从头跑                                  |
| Context Engineering  | **65%** | ContextCompactor + PriorityPruner + CacheControlPlanner 都有，但 cache planner **未接 LLM 调用链**               |
| Hook 体系            | **75%** | PreToolUse/PostToolUse/PreSubagentSpawn 完整连接；SessionStart/Stop/UserPromptSubmit **类型定义但零 dispatch**   |
| Permission           | **50%** | allow/deny 二级有，**ask 级（实时审批）完全缺失**                                                                |
| MCP Protocol         | **85%** | Client 三种 transport 完整；Server 仅 Streamable HTTP，无 stdio                                                  |
| A2A Protocol         | **70%** | Google A2A v0.3 类型完整，但客户端用轮询非 SSE                                                                   |
| 产品 UI              | **45%** | Trace/Cost 维度独有领先；plan 审批 / Agent 配置 / Memory 浏览全部缺失                                            |

**综合对齐度：约 60%**。

底层架构与 Claude Agent SDK 高度同构（HookRegistry / SkillRegistry / SubagentSpawner / CheckpointService / MCP relay 都有），整体形态正确。**主要差距是"对齐细节 + 接通断点 + 产品形态"，不是重写架构**。

---

## 二、统一 P0/P1/P2 优先级清单

### P0 — 必须立即修复（共 4 项，约 1 周工作量）

这些都是**已有架构已落但接通断了**的退化问题，修复成本极低、收益极高。

| ID       | 问题                                                                                                                            | 文件                                                                                                                 | 工作量       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------ |
| **P0-1** | **postmortem 写入 `embedding: []`** — 语义召回退化为 tag filter，S12 → S2 教训注入虽闭环但召回质量空洞                          | `mission-store.service.ts:504` 改为调用 `MemoryAutoIndexer` 写真实 embedding                                         | **1-2 天**   |
| **P0-2** | **Mission 中途宕机从头重跑** — `TeamMission.runMission()` 正常 stage 完成后**未调** `missionCheckpoint.save()`，只有 retry 才写 | `team.mission.ts` 各 stage 完成钩子加 save                                                                           | **2-3 天**   |
| **P0-3** | **Hook 三个标准事件零 dispatch** — `SessionStart` / `Stop` / `UserPromptSubmit` 类型定义完整但全库无触发点                      | `harnessed-agent.ts:293` 终止前 dispatch Stop；mission lifecycle 加 SessionStart；user input 边界加 UserPromptSubmit | **1-2 天**   |
| **P0-4** | **CacheControlPlanner 未接 LLM 调用链** — Anthropic prompt cache 优化形同虚设                                                   | 验证并在 LlmExecutor / ContextManager 中接通 SharedCachePrefix 输出到 AiChatService.chat()                           | **0.5-1 天** |

**P0 共计约 1 周**。这 4 项不修，"对标 Anthropic"在关键路径上是字面对齐、实质退化。

### P1 — 高优先级（共 8 项，约 4-6 周）

| ID       | 问题                                                                                                                   | 工作量 |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| **P1-1** | **playground 18 份 duty.md → SKILL.md 标准化** — 加 YAML frontmatter，注册到 SkillRegistry，agent 声明 `skills: []`    | 1-2 周 |
| **P1-2** | **Skill progressive disclosure** — `SkillActivator` 改先注入 description，按需注入 body                                | 2-3 天 |
| **P1-3** | **mid-loop human interrupt** — `ILoopTerminationCriteria` 加 `pauseSignal`，loop 每轮检查 yield `human_input_required` | 3-5 天 |
| **P1-4** | **Plan 预生成 + 用户审批 UI** — 新增 S0-plan 阶段 + 前端审批面板，复用 Leader Chat 的 CREATE_TODO 能力支持 plan 编辑   | 2-3 周 |
| **P1-5** | **HarnessFacade.resume() 后 ContextEnvelope 类方法重建**                                                               | 1 天   |
| **P1-6** | **HierarchicalMemoryCascade 持久化** — 接 ProcessMemoryManagerService（已有 Prisma 后端）                              | 1-2 天 |
| **P1-7** | **Auto-compact 改为自动触发** — ReActLoop reason 前自动 ensureBudget                                                   | 1 天   |
| **P1-8** | **MemoryBridge.postExecute() 在 mission 完成后调用** — 长期 memory 写入链路接通                                        | 1 天   |

### P2 — 中优先级（共 9 项，约 6-8 周）

| ID   | 问题                                                                                   | 工作量 |
| ---- | -------------------------------------------------------------------------------------- | ------ |
| P2-1 | `stop_when` 一等公民（`ILoopTerminationCriteria.stopWhen`）                            | 小     |
| P2-2 | Tool 权限 `ask` 级 — Hook 返回值加 ask 语义 + 前端 approval 弹窗                       | 5-8 天 |
| P2-3 | Subagent skill 继承（spawner 透传父 envelope.activeSkills）                            | 小     |
| P2-4 | LLM 主动 spawn subagent — 解除 `subagent_spawn` action 系统 prompt 屏蔽 + LLM 接口描述 | 中     |
| P2-5 | Memory 4 种 type 枚举（user/feedback/project/reference）                               | 2-3 天 |
| P2-6 | MEMORY.md 索引注入 + agent 主动 query 接口                                             | 3-5 天 |
| P2-7 | Frontend 接通 `/missions/resumable` 入口                                               | XS     |
| P2-8 | RawEventLog tab 挂回 + TodoDetailDrawer 显示完整 thought/action/obs                    | XS     |
| P2-9 | LLM call prompt/response + Tool call input/output 在 UI 可见                           | 中     |

### P3 — 低优先级（架构演进/产品打磨，共 7 项）

- 真实 git worktree isolation（需 Sandbox 集成）
- `subagent_type` 预置模板枚举
- Session 级自动 resume（`--continue` 等价）
- Session fork 前端 UI
- Agent 可视化配置（instructions/tools/model 编辑）
- Skill 上传（.zip / SKILL.md）
- Tool 启用/禁用 per-agent + Memory chunks 增删改 UI

---

## 三、关键发现

### ✅ 已闭环（领先 / 对齐 / 独有优势）

1. **ReActLoop 完整**：parallel_tool_call、circuit breaker、budget governance、4 种 loop 类型（ReAct/PlanAct/Reflexion/LeaderWorker）
2. **MCP Client 三 transport 完整**：stdio / SSE legacy / Streamable HTTP 2025-11
3. **Hook 核心链路**：PreToolUse / PostToolUse / PreSubagentSpawn 在 react-loop 和 spawner 都完整 dispatch + block 决策
4. **HarnessFacade.fork()** session 分叉完整
5. **ContextCompactor + CacheControlPlanner + PriorityPruner** 三件套都已实现
6. **12-stage stepper / Cost 多维分层 / 返工浪费分析** — UI 独有优势，超越 Claude Agent 默认形态
7. **S12 → S2 教训注入闭环**（链路打通，但被 P0-1 embedding=[] 拖累质量）

### ⚠️ 系统性问题（需要架构级动作）

1. **playground 与 harness 的 skill/duty 双轨** — 18 份 duty.md 是 playground 私有 prompt-as-file 体系，与 harness SkillRegistry 平行存在、互不相知。这是**最深的架构债**，P1-1 标准化是关键
2. **Memory 三套存储栈无统一抽象** — VectorStore / CheckpointStore / ProcessMemoryManager / HierarchicalMemoryCascade 各自为政，无 type 枚举、无统一 read-write 接口
3. **CheckpointService 双层不互通** — agent 级（envelope 快照）与 mission 级（stage 断点）是两个独立类不共享 store，mission 不知 agent 在哪个 checkpoint
4. **Permission 体系欠缺 ask 维度** — Anthropic 的"运行时实时审批"是 human-in-the-loop 核心，我们只有 allow/deny 静态白黑名单
5. **Plan 审批环节缺失** — 整个产品流程是"参数 → 盲跑"，与 Anthropic"plan → 审批 → 执行"的核心交互范式有根本差距

### 🚨 退化风险（看似闭环实则空洞）

1. **embedding=[] 让语义召回退化为字符串过滤**（P0-1）
2. **CacheControlPlanner 未接调用链让 cache 优化形同虚设**（P0-4）
3. **Hook 三个事件零 dispatch 让 SessionStart/Stop 完全无效**（P0-3）
4. **Mission 正常路径不写 checkpoint 让进程重启=从头重跑**（P0-2）

这 4 项**接通断了**的问题需要立即修复。

---

## 四、推荐执行节奏

### Sprint 1（1 周）：P0 全部修复

修完 P0-1/2/3/4，"已落架构 + 接通断点"的退化全部清掉，对齐度从 60% → 70%。

### Sprint 2（2-3 周）：P1 架构对齐

- P1-2 progressive disclosure（小成本大收益）
- P1-1 playground duty.md 标准化（最大架构债）
- P1-3 mid-loop interrupt
- P1-5/6/7/8 多个一日修复同步推进

完成后对齐度 70% → 82%。

### Sprint 3（2-3 周）：P1 产品形态

- P1-4 Plan 预生成 + 用户审批 UI（最大产品体验差距）

完成后对齐度 82% → 88%。

### Sprint 4+（持续）：P2 / P3

按业务需求优先级补齐。

---

## 五、对照表（速查）

| Anthropic Managed Agent                | 我们的等价                         | 状态                                 |
| -------------------------------------- | ---------------------------------- | ------------------------------------ |
| Agent loop（ReAct）                    | ReActLoop                          | ✅                                   |
| max_turns                              | maxIterations + hardCap            | ✅                                   |
| stop_when                              | outputSchemaValidator              | ⚠️ 部分                              |
| Tools                                  | ToolRegistry + ToolInvoker         | ✅                                   |
| PreToolUse / PostToolUse hooks         | HookRegistry                       | ✅                                   |
| SessionStart / Stop / UserPromptSubmit | 类型有，dispatch 无                | ❌                                   |
| allow / deny permission                | allowedTools / forbiddenTools      | ✅                                   |
| ask permission（实时审批）             | HumanApprovalTool（不等价）        | ❌                                   |
| Task() subagent                        | SubagentSpawner                    | ⚠️ 部分（LLM 不可主动 spawn）        |
| isolation: worktree                    | session 级（非真实 git）           | ⚠️ 部分                              |
| Skills（SKILL.md）                     | SkillRegistry + SKILL.md 解析      | ⚠️ 部分（无 progressive disclosure） |
| Memory 4 types                         | tags 分类                          | ⚠️ 部分                              |
| MEMORY.md 索引                         | 硬编码 listRecentPostmortems       | ❌                                   |
| Auto context compaction                | ContextCompactor（pull 模式）      | ⚠️ 部分                              |
| Prompt cache                           | CacheControlPlanner（未接调用链）  | ⚠️ 部分                              |
| Checkpoints                            | CheckpointService 双层             | ⚠️ 部分（不互通）                    |
| Session resume                         | HarnessFacade.resume()（agent 级） | ⚠️ 部分                              |
| Session fork                           | HarnessFacade.fork()               | ✅                                   |
| MCP Client                             | stdio + SSE + Streamable HTTP      | ✅                                   |
| MCP Server                             | 仅 Streamable HTTP                 | ⚠️ 部分                              |
| A2A protocol                           | Google A2A v0.3                    | ⚠️ 部分（无流式）                    |
| Plan-then-execute UI                   | 无                                 | ❌                                   |
| Agent 可视化配置                       | 无                                 | ❌                                   |
| Memory 浏览/编辑 UI                    | 仅数量                             | ❌                                   |
| Trace 实时可视化                       | 12-stage + cost 多维               | ✅ **领先**                          |

---

**结论**：项目底层架构与 Claude Agent SDK 高度同构，整体方向正确。当前 60% 对齐度的主要构成是"接通断点 + 细节对齐 + 产品形态"，**不需要重写**。按 P0 → P1 → P2 节奏推进，4-6 周可达 88% 对齐度。
