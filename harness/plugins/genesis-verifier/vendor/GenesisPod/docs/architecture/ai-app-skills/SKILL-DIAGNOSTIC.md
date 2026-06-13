# Skill Diagnostic Report

> AI App 模块 × 10 Architectural Pattern Skills 匹配度诊断
> 生成日期: 2026-03-12 | 更新日期: 2026-03-12 (v2.0 — PK 审计修订)

## 0. 重要概念澄清

### 本文档中的 "Skill" 含义

**本文档中的 10 个 Skill 是架构模式文档（.skill.md），描述的是 NestJS Service 层的设计范式**，而非 `PromptSkillAdapter` 执行的 LLM prompt 定义。

| 概念                             | 含义                                        | 示例                                             |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| **Architectural Pattern Skill**  | 本文档讨论的 10 个范式                      | leader-agent-pattern, mission-driven-workflow    |
| **LLM Prompt Skill (.skill.md)** | 通过 PromptSkillAdapter 执行的单次 LLM 调用 | TI 的 35 个 prompt skill (analysis/9, quality/8) |
| **NestJS Service (.service.ts)** | 包含循环、DB、事件、状态机的业务逻辑        | TI 的 61 个 service 文件                         |

### Skill vs Service 边界（PK 审计教训）

**PromptSkillAdapter 只能做单次 LLM 调用**。以下场景绝不适合 Skill 化：

- 0 LLM 调用的纯代码逻辑（如 DefectScanner 的 12 个 regex counter）
- 有循环/迭代的多轮 LLM 调用（如 CritiqueRefine 的 critique→refine×N）
- 需要 Prisma DB 读写的逻辑
- 需要事件发射、状态机转换的逻辑

**TI 的 35 个 .skill.md + 61 个 .service.ts = 正确的架构分离**，0 个 Service 可被 Skill 替代。

---

## 1. 匹配度矩阵

| 模块               | ai-app-scaffolding | checkpoint-recovery | connector-registry | facade-decomposition | interactive-workflow | leader-agent-pattern | mission-driven-workflow | multi-source-data-pipeline | quality-gate-chain | realtime-event-bridge |
| ------------------ | ------------------ | ------------------- | ------------------ | -------------------- | -------------------- | -------------------- | ----------------------- | -------------------------- | ------------------ | --------------------- |
| **Topic Insights** | REF                | REF                 | REF                | REF                  | REF                  | REF                  | REF                     | REF                        | REF                | REF                   |
| **Research**       | HIGH               | LOW                 | LOW                | MED                  | MED                  | HIGH                 | MED                     | LOW                        | MED                | MED                   |
| **Teams**          | HIGH               | MED                 | N/A                | MED                  | MED                  | HIGH                 | HIGH                    | N/A                        | LOW                | HIGH                  |
| **Writing**        | HIGH               | HIGH                | N/A                | HIGH                 | MED                  | HIGH                 | HIGH                    | N/A                        | HIGH               | HIGH                  |
| **Office**         | HIGH               | HIGH                | N/A                | MED                  | MED                  | MED                  | MED                     | N/A                        | LOW                | LOW                   |
| **Ask**            | MED                | N/A                 | N/A                | N/A                  | N/A                  | N/A                  | N/A                     | N/A                        | N/A                | N/A                   |
| **Image**          | MED                | N/A                 | N/A                | LOW                  | N/A                  | MED                  | N/A                     | N/A                        | LOW                | N/A                   |
| **Social**         | MED                | N/A                 | LOW                | LOW                  | N/A                  | N/A                  | N/A                     | MED                        | LOW                | LOW                   |
| **Simulation**     | MED                | N/A                 | N/A                | N/A                  | N/A                  | MED                  | N/A                     | N/A                        | N/A                | N/A                   |
| **Planning**       | MED                | N/A                 | N/A                | N/A                  | MED                  | MED                  | LOW                     | N/A                        | N/A                | N/A                   |
| **Explore**        | MED                | N/A                 | LOW                | N/A                  | N/A                  | N/A                  | N/A                     | MED                        | N/A                | N/A                   |
| **Library**        | HIGH               | N/A                 | MED                | MED                  | N/A                  | N/A                  | N/A                     | MED                        | N/A                | N/A                   |

**图例**:

- `REF` — 参考实现源（Topic Insights，所有 pattern 的验证基准）
- `HIGH` — 已有完整实现，与 pattern 高度匹配
- `MED` — 部分实现，有改进空间
- `LOW` — 有需求但未采用标准 pattern
- `N/A` — 不适用（模块复杂度不足或业务场景不需要）

**quality-gate-chain 特别说明**：TI 的 DefectScanner（12 regex counter，0 LLM）和 ReportQualityGate（代码检测+auto-fix，0 LLM）属于"代码分析门控"(Stage 1b)，与"LLM 评分门控"(Stage 2) 和"LLM 迭代门控"(Stage 3/CritiqueRefine) 是不同类型。详见 quality-gate-chain.skill.md v2.0 的"两类质量门控"章节。

---

## 2. 各模块诊断详情

### Research (59 files, 28 services, 4 controllers)

**已采用的 Skills**

| Skill                   | 匹配度 | 说明                                                                                                         |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| ai-app-scaffolding      | HIGH   | 模块结构规范，controller/service/dto 分层清晰，ResearcherAgent 已注册到 AgentRegistry                        |
| leader-agent-pattern    | HIGH   | ResearcherAgent 完整实现，Leader 决策 + Agent 执行分离                                                       |
| interactive-workflow    | MED    | iterative-research 有退出条件判断，但无显式的暂停/恢复/审批 hook                                             |
| facade-decomposition    | MED    | 有 discussion-orchestrator 但未完全按子服务拆分，部分 God Service 风险                                       |
| mission-driven-workflow | MED    | 有 discussion-orchestrator 和 iterative-research，但未采用标准 FSM（PLANNING→EXECUTING→REVIEWING→COMPLETED） |
| quality-gate-chain      | MED    | research-quality-gate.service 存在，但缺少多层级验证链（单层 gate）                                          |
| realtime-event-bridge   | MED    | 使用 SSE 推送进度，满足实时需求，但未使用 WebSocket gateway 标准模式                                         |

**推荐采用但未采用的 Skills**

| Skill                      | 理由                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| checkpoint-recovery        | research 任务可能耗时数分钟，网络中断或服务重启会导致全量重跑；保存 iterative-research 的轮次状态可大幅提升可靠性 |
| connector-registry         | research 已隐式依赖多数据源（搜索引擎、学术库等），统一注册 + 健康检查 + 故障隔离可提升稳定性                     |
| multi-source-data-pipeline | 当前搜索结果聚合逻辑分散，引入 Strategy-Execute-Fuse-Gate 标准管线可提升可扩展性                                  |

**优先级排序的改进建议**

1. **P1**: 为 iterative-research 引入 checkpoint-recovery，防止长任务因网络抖动丢失进度
2. **P2**: 将 discussion-orchestrator 按 mission-driven-workflow 标准 FSM 重构，与 Teams/Writing 模式对齐
3. **P2**: 将搜索逻辑提取为 multi-source-data-pipeline，便于后续扩展数据源
4. **P3**: 引入 connector-registry 统一管理搜索数据源的健康状态

---

### Teams (85 files, 34 services, 5 controllers)

**已采用的 Skills**

| Skill                   | 匹配度 | 说明                                                                                           |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| ai-app-scaffolding      | HIGH   | 13 个 mission-\* 服务分层清晰，TeamCollaborationAgent/TeamMemberAgent 已注册                   |
| leader-agent-pattern    | HIGH   | Leader-Agent 角色分离明确，leader-model.service 独立管理 Leader 模型选择                       |
| mission-driven-workflow | HIGH   | team-mission/mission-runner/mission-lifecycle/mission-query 完整实现了 FSM                     |
| realtime-event-bridge   | HIGH   | ai-teams.gateway.ts 提供 WebSocket，topic-event-emitter.service 事件双发                       |
| checkpoint-recovery     | MED    | 通过 mission 的 resultJson 保存状态，但未达到标准 checkpoint-recovery 的增量模式和故障自动恢复 |
| interactive-workflow    | MED    | 有 mission retry 和 health-check，但缺少显式的用户审批/暂停节点                                |
| facade-decomposition    | MED    | 有 coordinator 层，但 debate.service 可能承担过多职责                                          |

**推荐采用但未采用的 Skills**

| Skill              | 理由                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| quality-gate-chain | Teams 的辩论输出质量直接影响用户体验，引入多层质量验证（事实一致性、论点完整性、结论合理性）可减少低质量输出 |
| connector-registry | 若 Teams 需要外部数据增强辩论，统一连接器注册更安全                                                          |

**优先级排序的改进建议**

1. **P1**: 将 resultJson checkpoint 升级为标准 checkpoint-recovery（增量保存 + 自动恢复），减少重试时全量重跑
2. **P2**: 在辩论输出后引入 quality-gate-chain，对 debate conclusion 做事实性和逻辑性验证
3. **P2**: 为 debate.service 做 facade-decomposition，拆分出 debate-round、debate-evaluation、debate-synthesis 子服务
4. **P3**: 为 Teams 模块引入显式的 interactive-workflow（用户可在关键辩论轮次介入）

---

### Writing (117 files, 71 services, 1 controller)

**已采用的 Skills**

| Skill                   | 匹配度 | 说明                                                                                     |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------- |
| ai-app-scaffolding      | HIGH   | 多 Agent 注册规范，StoryArchitectAgent/BibleKeeperAgent/WriterAgent 等分工明确           |
| leader-agent-pattern    | HIGH   | StoryArchitectAgent 作为 Leader，4 个专职 Agent 执行，角色分离清晰                       |
| mission-driven-workflow | HIGH   | writing-mission.service 实现完整 FSM                                                     |
| quality-gate-chain      | HIGH   | 18 个质量服务覆盖 character-consistency/narrative-pacing/semantic-consistency 等多层验证 |
| realtime-event-bridge   | HIGH   | ai-writing.gateway.ts + 事件推送                                                         |
| checkpoint-recovery     | HIGH   | story-bible 持久化，支持断点续写                                                         |
| facade-decomposition    | HIGH   | writing-coordinator 作为 facade，屏蔽内部 71 个服务的复杂度                              |
| interactive-workflow    | MED    | 有 story-bible review 环节，但缺少标准化的暂停/恢复/审批接口                             |

**推荐采用但未采用的 Skills**

| Skill                      | 理由                                                           |
| -------------------------- | -------------------------------------------------------------- |
| connector-registry         | 若未来支持外部素材库（图片、参考文献），统一连接器注册是必须的 |
| multi-source-data-pipeline | 当前无外部数据需求，但若引入背景资料检索，需要此管线           |

**优先级排序的改进建议**

1. **P2**: 将 interactive-workflow 标准化——为 story-bible 审批、章节 review 点提供统一的 pause/resume/approve 接口
2. **P3**: 当引入外部素材时，使用 connector-registry 统一管理数据源

**总体评价**: Writing 是除 Topic Insights 之外 Skill 覆盖最全面的模块，整体架构成熟。

---

### Office (102 files, 16 services, 3 controllers)

**已采用的 Skills**

| Skill                   | 匹配度 | 说明                                                                |
| ----------------------- | ------ | ------------------------------------------------------------------- |
| ai-app-scaffolding      | HIGH   | 模块结构规范，slides-team-orchestrator 分层明确                     |
| checkpoint-recovery     | HIGH   | checkpoint.service 独立实现，slides-mission-health.service 健康检查 |
| leader-agent-pattern    | MED    | slides-leader 存在，但 Agent 角色分工不如 Writing 清晰              |
| mission-driven-workflow | MED    | 有 orchestrator + health，但 FSM 状态不完整（缺少 REVIEWING 阶段）  |
| interactive-workflow    | MED    | ai-edit.service 支持交互式编辑，但缺少标准的暂停/恢复节点           |
| facade-decomposition    | MED    | orchestrator 层存在，但内部服务边界不清晰                           |

**推荐采用但未采用的 Skills**

| Skill                 | 理由                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| quality-gate-chain    | PPT/文档生成质量参差不齐（布局冲突、内容截断），引入多层 gate 可显著减少低质量输出 |
| realtime-event-bridge | 当前为批操作模式，但用户期望实时看到幻灯片生成进度；引入 WebSocket 可大幅提升 UX   |

**优先级排序的改进建议**

1. **P1**: 引入 realtime-event-bridge（WebSocket gateway），让用户实时看到幻灯片生成进度，而非等待批量完成
2. **P2**: 完善 mission-driven-workflow，补充 REVIEWING 阶段（让用户在最终输出前审核布局）
3. **P2**: 引入 quality-gate-chain，增加布局有效性和内容完整性验证
4. **P3**: 按 leader-agent-pattern 标准进一步明确 slides-leader 的决策边界

---

### Ask (11 files, 1 service, 1 controller)

**已采用的 Skills**

| Skill              | 匹配度 | 说明                                                  |
| ------------------ | ------ | ----------------------------------------------------- |
| ai-app-scaffolding | MED    | 结构基本规范，但服务数量极少，未体现 skill 的完整价值 |

**推荐采用但未采用的 Skills**

无——Ask 模块是设计上的极简模块，直接调用 ChatFacade 是合理的架构选择。所有其他 skill 对当前规模均不适用。

**优先级排序的改进建议**

1. **P3**: 如果 Ask 演进为支持多轮对话历史、上下文管理，可引入 mission-driven-workflow 的轻量版本
2. **P3**: 如果 Ask 支持 RAG 增强，可引入 connector-registry 管理知识库数据源

**总体评价**: 极简设计符合当前需求，无需引入复杂 pattern。

---

### Image (40 files, 14 services, 3 controllers)

**已采用的 Skills**

| Skill                | 匹配度 | 说明                                                                                           |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| ai-app-scaffolding   | MED    | ImageDesignerAgent 注册到 AgentRegistry，但 DI token + forwardRef 模式略显复杂                 |
| leader-agent-pattern | MED    | ImageDesignerAgent 承担 leader 角色，但缺少下级执行 Agent，更像单 Agent 而非 Leader-Agent 体系 |

**推荐采用但未采用的 Skills**

| Skill                | 理由                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| quality-gate-chain   | 图像生成结果差异较大（风格偏离、内容不符），引入 prompt 质量验证 + 结果一致性 gate 可减少重试率 |
| facade-decomposition | prompt-enhancement 和 brand-kit 职责可进一步分离，当前服务边界不够清晰                          |

**优先级排序的改进建议**

1. **P2**: 引入 quality-gate-chain，在图像生成前验证 prompt 质量，生成后验证结果符合 brand-kit 要求
2. **P2**: 对 prompt-enhancement.service 做 facade-decomposition，拆分 style-transfer、brand-alignment、content-safety 子职责
3. **P3**: 如果 Image 支持多步骤生成流程（草图→细化→最终），引入轻量版 mission-driven-workflow

---

### Social (42 files, 15 services)

**已采用的 Skills**

| Skill                      | 匹配度 | 说明                                                                                                |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| ai-app-scaffolding         | MED    | 模块结构基本规范，但独立 MCP Client 未统一到 MCPManager 是架构债                                    |
| multi-source-data-pipeline | MED    | fetcher→transformer→checker→version 管线存在，但缺少 Strategy 层（平台选择策略）和 Fuse（多源融合） |

**推荐采用但未采用的 Skills**

| Skill                 | 理由                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| connector-registry    | wechat/xiaohongshu 是 2 个已有 adapter，未来扩展到 10+ 平台时必须统一注册 + 健康检查，当前 switch/case 模式不可扩展 |
| quality-gate-chain    | 社交内容发布前需要多层验证（平台规范、内容安全、品牌一致性），当前 checker 服务是单层，不足够                       |
| realtime-event-bridge | 发布任务是异步的，用户需要实时知道发布状态；当前缺少 WebSocket 推送                                                 |
| facade-decomposition  | publish-executor 的 switch/case 是 facade-decomposition 的典型反模式，应替换为 PlatformAdapterRegistry              |

**优先级排序的改进建议**

1. **P1**: 将 publish-executor 的 switch/case 重构为 PlatformAdapterRegistry（connector-registry pattern），这是 MEMORY.md 中已记录的 P1 技术债
2. **P1**: 统一 Social 独立 MCP Client 到 MCPManager（MEMORY.md 已记录的 P1 技术债）
3. **P2**: 引入 quality-gate-chain，完善内容发布前的多层验证
4. **P2**: 引入 realtime-event-bridge，推送发布状态给前端
5. **P3**: 完善 multi-source-data-pipeline，补充 Strategy 层支持平台智能选择

---

### Simulation (8 files, 3 services, 1 controller)

**已采用的 Skills**

| Skill                | 匹配度 | 说明                                                                                    |
| -------------------- | ------ | --------------------------------------------------------------------------------------- |
| ai-app-scaffolding   | MED    | SimulatorAgent 注册，但模块极小（8 files），未体现 scaffolding 的完整价值               |
| leader-agent-pattern | MED    | SimulatorAgent 存在，但多角色模拟需要更清晰的 Leader（仲裁者）+ Agent（角色扮演者）分工 |

**推荐采用但未采用的 Skills**

| Skill                   | 理由                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| mission-driven-workflow | 模拟辩论是典型的多阶段任务（场景设定→角色分配→辩论执行→总结），标准 FSM 可提升状态可观测性 |
| realtime-event-bridge   | 多角色模拟辩论的每轮发言是天然的实时事件流，WebSocket 推送是必须的                         |

**优先级排序的改进建议**

1. **P2**: 当 Simulation 功能增长时，引入 mission-driven-workflow 管理模拟会话的完整生命周期
2. **P2**: 引入 realtime-event-bridge，让用户实时看到多角色辩论的发言流
3. **P3**: 明确 leader-agent-pattern 中 SimulatorAgent 的 Leader 角色（仲裁者职责），增加专职角色 Agent

---

### Planning (12 files, 2 services)

**已采用的 Skills**

| Skill                   | 匹配度 | 说明                                                                  |
| ----------------------- | ------ | --------------------------------------------------------------------- |
| ai-app-scaffolding      | MED    | PLANNING_TEAM_CONFIG 注册到 TeamRegistry，但模块规模极小（12 files）  |
| leader-agent-pattern    | MED    | 依赖 Teams 的 Leader-Agent 基础设施，自身未独立实现                   |
| interactive-workflow    | MED    | 规划场景天然需要用户干预点，但当前依赖 Teams 的通用机制而非专属实现   |
| mission-driven-workflow | LOW    | 有规划任务的需求，但完全依赖 Teams 基础设施，缺少 Planning 专属的 FSM |

**推荐采用但未采用的 Skills**

| Skill                | 理由                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| facade-decomposition | 当前对 Teams 模块的跨 App 直接依赖是已知技术债（P3），用 facade 隔离可减少耦合 |

**优先级排序的改进建议**

1. **P3**: 通过 AI Engine 中转解耦 Planning 对 Teams 的直接依赖（MEMORY.md 中已记录的 P3 技术债）
2. **P3**: 当 Planning 功能成熟后，引入独立的 mission-driven-workflow，而非完全依赖 Teams 基础设施

**总体评价**: Planning 是轻量寄生模块，当前规模不需要引入更多 pattern。

---

### Explore (36 files, 11 services)

**已采用的 Skills**

| Skill                      | 匹配度 | 说明                                                                                          |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| ai-app-scaffolding         | MED    | 模块结构规范，但为无状态工具型模块，scaffolding 价值有限                                      |
| multi-source-data-pipeline | MED    | youtube/pdf-generator/resources 多源存在，但缺少 Strategy 层（智能数据源选择）和 Quality Gate |

**推荐采用但未采用的 Skills**

| Skill              | 理由                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| connector-registry | youtube/pdf/resources 是 3 个已有数据源，统一注册 + 健康检查可避免单源故障影响全局                    |
| quality-gate-chain | ai-enrichment 的输出质量差异较大，引入 content quality gate（相关性、完整性验证）可减少低质量内容入库 |

**优先级排序的改进建议**

1. **P2**: 将多数据源抽象为 connector-registry pattern，每个数据源独立注册并支持健康检查
2. **P2**: 在 ai-enrichment 后引入轻量版 quality-gate-chain，验证富化内容的质量
3. **P3**: 完善 multi-source-data-pipeline 的 Strategy 层，支持根据内容类型智能选择数据源

---

### Library (69 files, submodules only)

**已采用的 Skills**

| Skill                      | 匹配度 | 说明                                                                                             |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| ai-app-scaffolding         | HIGH   | 多子模块结构规范（collections/notes/knowledge-graph/rag/integrations/recommendations），分层清晰 |
| connector-registry         | MED    | feishu/notion/google-drive 是 3 个集成适配器，但缺少统一的注册机制和健康检查                     |
| facade-decomposition       | MED    | 子模块独立但顶层 Library 模块缺少统一 Facade 屏蔽内部复杂度                                      |
| multi-source-data-pipeline | MED    | RAG ingestion 有 fetch→chunk→embed 管线，但多集成源（飞书/Notion/云盘）的 fuse 层缺失            |

**推荐采用但未采用的 Skills**

| Skill              | 理由                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| quality-gate-chain | RAG 知识入库质量直接影响检索准确性，引入 chunk 质量验证（重复检测、相关性过滤）可提升 RAG 效果 |

**优先级排序的改进建议**

1. **P1**: 为 feishu/notion/google-drive 引入 connector-registry（统一注册 + 健康检查 + OAuth 状态管理），避免单集成故障影响所有 Library 功能
2. **P2**: 引入 quality-gate-chain 验证 RAG 入库质量（文本完整性、去重、相关性阈值）
3. **P2**: 为 Library 顶层模块创建统一 Facade，屏蔽 6 个子模块的内部 API
4. **P3**: 完善 multi-source-data-pipeline，支持多集成源内容的去重融合

---

## 3. Skill 采纳率统计

| Skill                          | REF | HIGH | MED | LOW | 合计 (REF+HIGH+MED) | 最应引入的模块                        |
| ------------------------------ | --- | ---- | --- | --- | ------------------- | ------------------------------------- |
| **ai-app-scaffolding**         | 1   | 5    | 6   | 0   | 12                  | — (全覆盖)                            |
| **leader-agent-pattern**       | 1   | 3    | 4   | 0   | 8                   | Office, Simulation                    |
| **mission-driven-workflow**    | 1   | 2    | 2   | 1   | 6                   | Research, Office, Simulation          |
| **realtime-event-bridge**      | 1   | 2    | 1   | 1   | 5                   | Office, Social, Simulation            |
| **checkpoint-recovery**        | 1   | 2    | 1   | 1   | 5                   | Research                              |
| **facade-decomposition**       | 1   | 1    | 4   | 1   | 7                   | Social (publish-executor), Image      |
| **quality-gate-chain**         | 1   | 1    | 1   | 1   | 4                   | Teams, Office, Social, Image, Library |
| **interactive-workflow**       | 1   | 0    | 4   | 0   | 5                   | Writing, Office                       |
| **multi-source-data-pipeline** | 1   | 0    | 3   | 0   | 4                   | Research, Explore                     |
| **connector-registry**         | 1   | 0    | 1   | 1   | 3                   | Social, Library, Explore              |

**关键发现**:

- `ai-app-scaffolding` 全模块覆盖，是项目已形成的基础共识
- `connector-registry` 采纳率最低（3/12），但 Social/Library/Explore 都有明确需求，是投入产出比最高的待推广 skill
- `quality-gate-chain` 仅 4 个模块采纳，但 Teams/Office/Social/Image/Library 均有明确需求，推广价值高
- `realtime-event-bridge` 和 `checkpoint-recovery` 主要集中在重型模块，轻量模块不需要

---

## 4. 优先行动项

### P1 — 立即可采纳，有显著收益

| #    | 模块     | Skill                 | 具体行动                                                                                             | 收益                                                        |
| ---- | -------- | --------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| P1-1 | Social   | connector-registry    | 将 publish-executor 的 switch/case 替换为 PlatformAdapterRegistry（已在 MEMORY.md 记录为 P1 技术债） | 解除 switch/case 反模式，平台扩展从"改代码"变为"注册适配器" |
| P1-2 | Social   | connector-registry    | 统一 Social MCP Client 到 MCPManager（已在 MEMORY.md 记录为 P1 技术债）                              | 消除架构孤岛，统一 MCP 连接管理                             |
| P1-3 | Research | checkpoint-recovery   | 为 iterative-research 添加轮次级 checkpoint，保存每轮的中间结果                                      | 防止长任务因网络抖动丢失全部进度                            |
| P1-4 | Office   | realtime-event-bridge | 为幻灯片生成添加 WebSocket gateway，推送生成进度                                                     | 解决用户等待黑盒问题，UX 显著提升                           |
| P1-5 | Library  | connector-registry    | 为 feishu/notion/google-drive 引入统一注册 + 健康检查机制                                            | 单集成故障隔离，不影响其他数据源                            |

### P2 — 中期规划，需要一定重构

| #     | 模块       | Skill                   | 具体行动                                                                  | 收益                                             |
| ----- | ---------- | ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| P2-1  | Teams      | checkpoint-recovery     | 将 resultJson checkpoint 升级为增量保存 + 自动恢复                        | 减少 mission 失败时的全量重跑                    |
| P2-2  | Teams      | quality-gate-chain      | 在 debate conclusion 输出后引入多层质量验证（事实性、逻辑性、立场一致性） | 减少低质量辩论输出，提升用户信任                 |
| P2-3  | Research   | mission-driven-workflow | 将 discussion-orchestrator 按标准 FSM 重构                                | 与 Teams/Writing 模式对齐，降低维护成本          |
| P2-4  | Office     | quality-gate-chain      | 引入布局有效性 + 内容完整性 gate                                          | 减少生成后用户手动修复的工作量                   |
| P2-5  | Image      | quality-gate-chain      | 在图像生成前验证 prompt，生成后验证 brand-kit 符合度                      | 降低因 prompt 质量差导致的重试率                 |
| P2-6  | Social     | quality-gate-chain      | 完善发布前多层验证（平台规范、内容安全、品牌一致性）                      | 减少发布失败和内容违规风险                       |
| P2-7  | Writing    | interactive-workflow    | 为 story-bible 审批和章节 review 提供标准化 pause/resume/approve 接口     | 对齐 Topic Insights 的 interactive-workflow 标准 |
| P2-8  | Explore    | connector-registry      | 将多数据源抽象为统一注册模式                                              | 支持健康检查，避免单源故障影响全局               |
| P2-9  | Library    | quality-gate-chain      | 引入 RAG 入库质量验证（去重、完整性、相关性阈值）                         | 提升 RAG 检索准确性                              |
| P2-10 | Simulation | realtime-event-bridge   | 引入 WebSocket 推送多角色辩论发言流                                       | 提供实时体验，而非批量加载                       |

### P3 — 长期演进，当模块复杂度增长时再引入

| #    | 模块       | Skill                      | 具体行动                                                     | 触发条件                           |
| ---- | ---------- | -------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| P3-1 | Research   | connector-registry         | 统一管理搜索数据源（当前学术库、搜索引擎等）的注册和健康状态 | 数据源扩展到 5+ 个时               |
| P3-2 | Research   | multi-source-data-pipeline | 标准化搜索结果聚合管线                                       | 引入新搜索引擎或学术库时           |
| P3-3 | Image      | mission-driven-workflow    | 引入轻量版 FSM 支持多步骤图像生成                            | 引入草图→细化→最终的生成流程时     |
| P3-4 | Simulation | mission-driven-workflow    | 引入模拟会话完整生命周期管理                                 | Simulation 功能增长到 20+ files 时 |
| P3-5 | Planning   | facade-decomposition       | 通过 AI Engine 中转解耦 Planning 对 Teams 的直接依赖         | 跨 App 依赖引发维护问题时          |
| P3-6 | Ask        | mission-driven-workflow    | 引入轻量版多轮对话状态管理                                   | Ask 引入上下文管理或 RAG 增强时    |
| P3-7 | Library    | multi-source-data-pipeline | 支持多集成源内容的去重融合                                   | Library 集成源扩展到 6+ 个时       |
| P3-8 | Writing    | connector-registry         | 统一管理外部素材库                                           | 引入外部图片库或参考文献库时       |

---

## 附录 A: 诊断方法说明

**REF 定义**: Topic Insights 作为所有 10 个 pattern 的参考实现源，其每个 pattern 均有完整、经过验证的实现。

**HIGH 定义**: 模块已有与 pattern 描述高度一致的完整实现，可直接作为其他模块的学习参考。与 REF 的区别在于 REF 是最初提炼出 pattern 的源头模块。

**MED 定义**: 模块有该 pattern 所解决问题的需求，且有部分实现，但缺少标准化、自动化或完整的覆盖范围。

**LOW 定义**: 模块有该 pattern 所解决问题的明确需求，但当前实现方式与标准模式差距较大（如用 switch/case 替代注册表，用单层 gate 替代多层链）。

**N/A 定义**: 模块规模或业务场景不需要该 pattern，强行引入会增加不必要的复杂度。

---

## 附录 B: PK 审计修订记录（2026-03-12）

### 被纠正的判断

| 原始判断                         | 纠正后           | 原因                                                                            |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| DefectScanner → Skill 化可行     | **不可行，撤回** | 0 LLM 调用，纯 regex（12 counter + 7 detail extractors），转 Skill 反而增加成本 |
| ReportQualityGate → Skill 化可行 | **不可行，撤回** | 0 LLM 调用，纯代码检测 + auto-fix，不涉及 LLM                                   |
| CredibilityReport → Skill 化可行 | **不可行**       | 0 LLM 调用，4 表 join + 5 个评分算法，纯 DB + 计算                              |
| CitationFormatter → Skill 化可行 | **不可行**       | 0 LLM 调用，纯字符串格式化（APA/MLA/Chicago/IEEE）                              |
| CritiqueRefine → Skill 化可行    | **不可行**       | 有 `for` 循环 + convergence 检测，非单次调用                                    |
| QueryStrategy → Skill 化可行     | **不可行**       | 读 Prisma 表 + 7 分支语言路由，LLM 仅用于子步骤                                 |
| ResearchReflection → 部分可行    | **不推荐**       | 虽然是单次 LLM，但有失败降级逻辑（返回默认值），TI 已有对应 .skill.md           |

### 核心教训

1. **"Stateless" ≠ "Skill-suitable"** — CitationFormatter 是 stateless 的，但它 0 LLM，不需要 Skill
2. **"No LLM" = 绝对不是 Skill** — 文件名中有 "quality" 不代表它调 LLM
3. **必须读代码再判断** — 不能根据文件名、注释或猜测来评估 Skill 适用性
4. **TI 的 35 个 .skill.md 已覆盖所有合适提取** — 不存在遗漏的 Skill 化机会
