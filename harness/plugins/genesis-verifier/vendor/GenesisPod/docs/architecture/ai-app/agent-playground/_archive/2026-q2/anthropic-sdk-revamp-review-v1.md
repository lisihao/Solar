# 评审结论：方案 v1 ⚠️ 不可直接实施 / 🔄 修订后可实施

**评审日期：** 2026-05-04
**评审者：** architect agent (内部)
**被评审：** [`anthropic-sdk-revamp-plan-v1.md`](./anthropic-sdk-revamp-plan-v1.md)

整体结论：方向正确（playground 业务装配过厚 + 沉淀通用能力到 harness/teams），但 v1 在**架构合规、工作量估算、关键技术前提**三方面有系统性偏差，必须修订后才能实施。

---

## 一、致命问题（必修，阻断实施）

### 1. 「mission-pipeline 子聚合」违反 16 §三（teams 子目录已 MECE 闭合）

方案 §3.1 / §3.5 提议 `harness/teams/mission-pipeline/`，下放 `MissionPipelineRunner / StagePrimitiveRegistry / MissionTopicGateway / DynamicMissionController / DynamicGateway / MissionStoreService / MissionEventStore / MissionLeaderChatService / MissionExportService / MissionRerunOrchestratorService`。

**与规范的冲突**：

- 16 §三定义 `teams/` 子目录是：`abstractions / base / profile / factory / registry / orchestrator / services / collaboration`，**全是业界标准词，已 MECE 闭合**。再加 `mission-pipeline` 兄弟目录触犯 16 §五"互斥性强制原则——兄弟目录不可有功能重叠"。`mission-pipeline` 与现有 `orchestrator` / `services` 在职责上**直接重叠**。
- 16 §四已把 mission-lifecycle 治理类（mission-health.monitor / orphan-detector / runtime-state / abort）归入 `lifecycle/mission-lifecycle/`，把 task 调度归入 `runner/scheduler/`。方案把这些**搬回 `teams/mission-pipeline/`**，等于撤销 16 已经做的归位。

**「Runner」一词更冲突**：16 §三明确 `runner/` 顶层聚合就是 "HOW they run"。方案放 `MissionPipelineRunner` 到 `teams/mission-pipeline/`，等于**第二个 runner 概念**，违反 16 §五#5"同名概念全项目唯一"。

**修订建议**：

- `MissionPipelineRunner` → 不新建子聚合，归位到既有 `teams/orchestrator/`，类名 `MissionPipelineOrchestrator`
- 7 个 stage primitive → `teams/services/stages/` 或 `engine/planning/stage-primitives/`
- generic store / event-store / leader-chat / export / rerun → 不在 teams 范畴：
  - `MissionStoreService / MissionEventStore` → `harness/lifecycle/mission-lifecycle/`
  - `MissionRerunOrchestratorService` → `lifecycle/mission-lifecycle/`
  - `MissionExportService` → 不是 harness 关注，留 ai-app 层

### 2. 「DynamicMissionController」放在 harness 层违反 4 层架构

16 §三的 11 个 harness 顶层聚合**没有任何一个含 controller 概念**。Controller 是 ai-app/open-api 层的事。

**根本问题**：把"动态生成 controller"放在 `harness/teams/mission-pipeline/`，等于让 harness 直接对外暴露 HTTP endpoint，违反 4 层架构 `L4 → L3 → L2.5 → L2 → L1` 的依赖方向（harness 不该承担 L4 责任）。

**修订建议**：控制器仍在 ai-app 层，用**「薄壳 controller」模式**：每个 ai-app 自己写 ~30 行 controller 类（标准 NestJS @Controller），inside 委托给 `MissionPipelineOrchestrator.run(teamId, dto)`。文件数对比："写 30 行 controller" vs "用 forFeature 动态生成" 体感差异极小，合规度差异巨大。

### 3. 「prismaTable 通用化 + 业务字段塞 metadata」违反 17 §3.6 + 大概率撞 PostgreSQL 性能墙

方案 §3.4 把所有业务字段塞 `metadata JSONB`。

**实际数据规模**（基于现有 `AgentPlaygroundMission` 表观察）：

- `reportFull`（ResearchReport v1 + ReportArtifact v2）单字段 50-200KB
- `verdicts` 数组 5-30KB
- `reconciliationReport` 10-50KB
- `dimensions` 数组带 toolHint 2-10KB

**问题**：

1. PostgreSQL TOAST 单字段 detoast 性能在 1MB+ 后明显劣化。单行实际负载 100-300KB 是日常态，detoast cost + 网络传输 cost 都翻倍
2. **业务索引消失**：现有表上 `topic` (varchar) 可加 trigram 索引；`finalScore` 可加 B-tree 索引。塞进 metadata 后必须用表达式索引，运维更复杂
3. 17 §3.6 明确"禁止把 memory state 与 memory tool 混成一个职责"。把生命周期状态 / 报告产物 / 审计 verdicts 三种语义不同的数据塞同一字段，未来想拆比拆现在的表难得多

**修订建议**：不做 generic 表统一。改为**「按需建表」契约**：每个 ai-app 自己维护自己的 mission 表（`writing_team_missions / playground_missions / ...`），harness 只提供 mission 抽象 API + 持久化端口接口（`IMissionStore` 在 `harness/lifecycle/mission-lifecycle/abstractions/`）。

### 4. SpecAgentRegistry.fromSkill(skillId) 不存在，需要新写适配层（方案严重低估）

方案 §3.1 写 `SpecAgentRegistry.fromSkill(skillId)`。**实际代码** (`harness/agents/core/spec-agent-registry.ts`) 只有 `register / has / get / getAllIds / clear / size`。

**真实工作量**：

- SkillActivator 现有：能解析 frontmatter、能拿 instructions（已在 `engine/skills/`）
- 缺：从 `{ allowedTools, allowedModels, outputSchemaRef, instructions }` → `IAgentSpec` 的 builder
- 缺：`outputSchemaRef`（zod schema 注册项）的注册中心，**当前根本不存在**。playground 现在每个 agent class 自己 export `outputSchema = z.object(...)`，没有"按 ID 查 schema"机制
- 缺：tools 白名单 → ToolRegistry filter view 的注入点

**修订建议**：在 R1-A 之前**先做 R1-A0**：

- 新建 `engine/skills/skill-spec-builder.ts`：SKILL.md → IAgentSpec
- 新建 `engine/skills/output-schema-registry.ts`：按 ID 注册/查 zod schema
- 新建 `harness/agents/core/spec-agent-from-skill.ts`：bridge
- 工作量：3-5 天独立 PR

### 5. 方案声称参考 office/slides 的 forFeature 模式 —— 该模式不存在

方案 §六风险表说 "动态 module + NestJS DI 边界 → 参考 office/slides 已有的 forFeature 模式（已审计过，可工作）"。

**实证**：在 `backend/src/modules/ai-app/office/` 全树 grep `forFeature` **0 命中**；`ai-harness` 全树 grep `forFeature` **0 命中**。

**实际后果**：方案核心机制 `HarnessTeamsModule.forFeature(config)` 没有任何项目内先例，**等于完全新写 NestJS dynamic module**。

**修订建议**：撤回 forFeature 路径，改"每个 ai-app 自己写 5-10 行普通 module + 普通 controller"。如确实要 forFeature，必须：

- 先做 spike (1 天) 验证 `@Controller(prefix)` in dynamic module
- 解决多个 ai-app 注入相同 service token 的 scope 冲突
- 解决 controller class 运行时元数据生成（NestJS 依赖编译期 emit）
- 工作量保守 5-7 天而非 "3-5 天"

---

## 二、严重问题（必修，影响 quality）

### 6. 7 stage primitive < 200 行 / runner < 400 行 严重低估

**事实**：

- 现有 13 stage 总 4793 行（已是简化后）
- s3 (researcher) = 796 行，s4 (leader assess) = 714 行，s8 (writer + judge + memory + assemble) = 701 行
- s4 单 stage 含：accept/retry/replace/abort 4 路 action 处理 + DAGExecutor 重派 + S4PatchRound 全局上限 + s4PatchFailures 跨 stage state 上报

`assess` primitive 200 行装不下 s4。除非：

- 把 4 路 action 抽成 hook（但"业务专属逻辑"重新放回 ai-app，方案的"playground < 500 行"必崩盘）
- 或允许 primitive 写 500-700 行（与方案 KPI 矛盾）

**修订建议**：撤回"primitive < 200 行 / playground < 500 行"目标。诚实数字：

- primitive 含核心 happy-path < 250 行 + 业务 hook 注入
- playground < 1500-2500 行（vs 现状 ~5000 行），减半就很好

### 7. MissionTeamConfig extends TeamConfig 语义冲突

playground 真实拓扑是「同一 leader 多 stage 出场（plan/assess/signoff），researcher×N 是 fan-out 不是 member」，跟 `leaderRoleId + memberRoles` 模型不对齐。强行 extends 会让 ITeam 接口实现混乱。

**修订建议**：不 extends。新增独立 `MissionPipelineConfig`，与 `TeamConfig` 是兄弟，新增独立 `MissionPipelineRegistry`。

### 8. LeaderService.SupervisedMission 跨 stage 历史决策无法装到声明式范式

`SupervisedMission` 跨 milestone 持有 `decisions[]`，最后 `accountabilityNote` 引用历史决策做问责。但 SKILL.md 是无状态的（每次激活重 prompt）。方案 §五 stage 映射表对此**完全没提**。

**修订建议**：引入"stateful agent runtime"：

- SKILL.md 描述能力 + instructions
- stateful state 由 stage primitive 通过 ctx 传递
- 同一 leader skill 在 s2/s4/s10 三处激活，每次从 ctx 读累计 decisions 注入 prompt

### 9. mission_runs.team_id 隔离 + 业务索引缺失

generic 表后所有查询必须强制 `where: { teamId }`。**泄漏风险**：

- 任何遗漏的查询会跨 ai-app 拿到对方数据
- ESLint 无法捕获（动态字符串 where）
- 测试很难穷举

**修订建议**：generic store 必须用**「不可绕过的 teamId 注入」**：`MissionStore.forTeam('writing-team')` 返回带预绑 teamId 的实例。jest spec `mission-store-isolation.spec.ts` 强制断言。

---

## 三、改进建议（nice-to-have）

### 10. R3-A writing-team demo 应该真正先做

强烈赞同方案 §九决策点 4。路线图调整：R1 → R3-A demo → R2 playground。理由：

- writing-team 简单，能暴露框架 80% 缺陷
- playground 是最复杂 ai-app（13 stage / 多 leader 决策 / 跨 stage state / quality 闭环），第一迁移对象等于"第一次开车上高速"

### 11. 「双轨上线 1 周」需要前端区分机制

mission_runs.metadata 加 `runtime_version: 'legacy' | 'pipeline-v1'`。前端 mission 详情页加 debug badge。双轨期路由由 feature flag 控制。

### 12. 方案 KPI 重新校准

诚实数字：playground < 2500 行（vs 现状 ~5000 行），减半就很好，不要喊 < 500。

---

## 四、被遗漏的边界情况

### 13. 前端 / WebSocket 事件兼容性具体落地缺失

§六风险表只一句"endpointPrefix=agent-playground"。但：

- 前端订阅 `agent-playground.mission:failed` / `agent-playground.leader:rejected-revision-recommended` 是 hardcoded
- 现有 `payload` 字段结构（如 mission failed 的 `failureCode` 取值集合 ORCH_CREDIT_INSUFFICIENT 等）必须 byte-equal 保留
- 这些**业务专属语义**抽到 generic 框架会被稀释

**修订**：方案必须新加 §"前端事件兼容性契约"。

### 14. R2-A 双轨期数据库写入不一致风险

R2-A 起新 mission 走新表，R2-C 删除前期间产生的 mission，对历史界面是空白。"cherry-pick 旧文件"不能让旧 controller 找到新表数据。

**修订**：明确说明 R2-C 真实回滚路径是"保留新代码 + 修 bug"，或写一次性 SQL 把 `mission_runs where team_id='agent-playground'` 数据回写到 `agent_playground_missions`（双向迁移成本 1-2 天）。

### 15. 9 路 e2e "byte-equal" 不可达

LLM 输出每次都不同。只能做"行为等价"：mission 完成 / 失败码相同 / report 长度 ±20% / dimensions 数量相同 / reviewScore ±10。远程 Railway 跑 9 路 × 5-30 分钟 = 1-5 小时 wall time。

**修订**：明确等价性是「定性等价」+ 给出 9 路 mission 用例 spec（topic / depth / lengthProfile 矩阵）。

### 16. W21 / W22 协调成本未估

R1-C 要么等 W21 落地（阻塞）要么用临时契约（埋债）。这个协调点方案没给时间。

### 17. 18 个 duty.md 与 SKILL.md 关系未清

playground 当前是 `agents/<role>/soul.md` + `agents/<role>/duties/*.md` 二级结构（共 18 个），不是 frontmatter SKILL.md 格式。把 18 个 soul/duty 重组成 ~8 个标准 SKILL.md 是 R2-A 的前置工作，方案没单独列。

---

## 五、修订路径（按优先级）

| 优先级   | 修订项                                                                                                                            | 影响章节   | 工作量            | 改后是否可实施 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------- | -------------- |
| **P0-1** | 撤回 `teams/mission-pipeline/` 子聚合，归位到 `teams/orchestrator/` + `lifecycle/mission-lifecycle/` + `harness/services/stages/` | §3.1 §3.5  | 文档 1 天         | ✅             |
| **P0-2** | 撤回 DynamicMissionController，改"薄壳 controller in ai-app"                                                                      | §3.5 §R1-D | 文档 0.5 天       | ✅             |
| **P0-3** | 撤回 generic mission_runs 表，改"按 ai-app 自有表 + IMissionStore 端口"                                                           | §3.4 §R1-C | 文档 1 天         | ✅             |
| **P0-4** | 新增 R1-A0：SkillSpecBuilder + OutputSchemaRegistry + spec-from-skill                                                             | §四 R1     | 3-5 天 PR         | ✅             |
| **P0-5** | 撤回 office forFeature 声明，改先 spike 验证                                                                                      | §六风险    | 1 天 spike + 文档 | ✅             |
| P1-6     | 撤回"primitive < 200 行 / playground < 500 行" KPI，重设                                                                          | §1.2 §3.2  | 文档 0.5 天       | ✅             |
| P1-7     | MissionPipelineConfig 不 extends TeamConfig，独立类型 + registry                                                                  | §R1-B      | 文档 0.5 天       | ✅             |
| P1-8     | 新增 §3.3.5 stateful agent runtime（SupervisedMission decisions 透传机制）                                                        | §3.3       | 文档 1 天         | ✅             |
| P1-9     | "teamId 不可绕过隔离 + isolation spec" 约束                                                                                       | §3.4 §R2   | 文档 0.5 天       | ✅             |
| P2-10    | 路线图调整：R1 → R3-A demo → R2 playground                                                                                        | §十        | 文档 0.5 天       | ✅             |
| P2-11    | 双轨 runtime_version 标记 + 前端 debug badge                                                                                      | §R2-A      | 文档 + 1 天工程   | ✅             |
| P2-12    | 9 路等价性"定性等价"重定义 + mission 用例矩阵                                                                                     | §R2-B      | 文档 1 天         | ✅             |
| P2-13    | 加"前端事件兼容性契约"                                                                                                            | §六        | 文档 0.5 天       | ✅             |
| P2-14    | 加"R2-C 回滚的真实路径（含数据回写脚本）"                                                                                         | §七        | 文档 0.5 天       | ✅             |
| P2-15    | 加"W21 协调依赖"                                                                                                                  | §八        | 文档 0.5 天       | ✅             |
| P2-16    | 加"playground 18 个 soul/duty.md → 8 个 SKILL.md 重组前置"                                                                        | §R2-A      | 文档 0.5 天       | ✅             |
| P2-17    | 真实工作量重估（R1 阶段从 13 天 → 18-22 天，总从 6 周 → 8-10 周单人全职）                                                         | §十 §R1    | 文档 0.5 天       | ✅             |

---

## 六、最终判断

**v1 现状**：⚠️ **不可直接进入实施**。最严重的三条：

1. mission-pipeline 子聚合违反 16，会被 `verify:arch` 直接驳回
2. SpecAgentRegistry.fromSkill 不存在 + 方案声称的 office forFeature 先例不存在 —— 两条核心技术前提建立在事实错误上
3. generic mission_runs 表 + metadata JSONB + business 索引消失 —— 一上线就埋性能雷 + 17 §3.6 违规

**修订到什么程度可实施**：

- 完成 P0-1 ~ P0-5 五项致命问题修订 → **方案 v2**（约 1 周文档改 + 1 周 spike 验证）
- P1-6 ~ P1-9 严重问题改后 → **方案 v3**，可正式进入 R1 阶段
- 真实总工时：**8-10 周单人全职**（不是方案的 6 周），含 W21 阻塞 + e2e 远程验证 wall time

**强烈建议执行顺序**：

1. 用户先决策 P0-1/P0-2/P0-3 三个架构方向（mission-pipeline 是不是子聚合 / controller 在哪层 / 数据库要不要 generic）
2. 出方案 v2，按 P1 修订项再 polish
3. 先做 R1-A0（SkillSpecBuilder spike）+ R3-A writing-team demo 验证框架
4. 框架稳定再启动 R2 playground 迁移

---

**评审参考的实际代码**（已通读）：

- 三份 standards/16/17/18
- playground team.mission.ts (816), 13 stage 实测 4793 行
- mission-context.ts (跨 stage state 定义)
- s4-leader-assess (714 行) / s8-writer-draft (701 行)
- agent-invoker.service.ts (spec=typeof Class)
- harness/agents/core/spec-agent-registry.ts（**确认 fromSkill 不存在**）
- harness/teams/abstractions/team.interface.ts（leader+members 拓扑）
- harness/teams/orchestrator/teams-mission-orchestrator.ts (2665 行)
- prisma 9265-9385（AgentPlaygroundMission 系列表）
- agents/\*_/_.md (18 个 soul/duty.md)
- office/ 全树 + ai-harness 全树 grep `forFeature` **0 命中**
