# 全自驱 Agent Team 设计稿 —— 架构视角评审

**评审日期**: 2026-06-04
**评审视角**: architecture（分层正确性 / 依赖方向 / 抽象质量 / 复用 vs 新建 / 与 Playground 解耦）
**评审对象**: `docs/architecture/ai-harness/self-driven-team/self-driven-agent-team-design-2026-06-04.md`
**评审状态**: approve-with-changes（批准但有须修正项）
**评审人**: Architect lens（Claude Code）

> 方法：先通读设计稿全文，再对每条'现有代码能力/文件'论断用 Grep/Read 核实，evidence 一律标注 file:line。未读到的不评分。
>
> **对抗式复核校准**：经第二轮对抗验证，arch-01（business-team 框架）与 arch-02（命名冲突）的 severity 由 blocker/major 双双下调为 **minor**——核心定性夸大（详见下方各条「复核结论」）；arch-03/04/05 维持 major。

---

## 1. 总体结论

设计的**分层判据是对的、复用清单的具体引用全部属实**（这点难得——逐一核实 ScoredRouterService / TeamFactory / MissionBudgetPool / dag-executor / thresholds / dynamic-planning / report-artifact-assembler 均真实存在且定性准确）。MECE 切分（engine 无 LLM 无 agent 状态 / harness 有 LLM 知 mission）与项目红线一致。

原始评审认定的"结构性盲点（blocker）"——设计无视 `BusinessTeamOrchestratorFramework`——经对抗复核**严重度高估**：设计稿实际选择了平行的 `teams/orchestrator/` + `dynamic-planning.ts` 路径，后者天生支持 LLM 动态步骤分解（无静态 stepId→runner 表），对"需动态生成 stage"的自驱场景反而更贴合；checkpoint/cross-stage/event-relay 等原语层也已由两条编排路径共同复用，未重复造轮。该条降为 **minor 选型论证缺口**：设计稿应补一节说明为何取动态编排路径、能否复用 business-team 的 cross-stage-state/rerun typed 视图。

据此：**批准方向，§4/§5 须补"与 business-team 框架的关系/选型理由"，并修正 arch-03/04/05 三项 major。**

---

## 2. 经代码核实的事实（成立项）

| 设计论断                                                                       | 核实结果                                | evidence                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| `dynamic-planning.ts` 是半成品、env-gated off、有 tryDynamicDecomposition      | 成立                                    | `teams/orchestrator/dynamic-planning.ts:41`、`:34`                                      |
| 复用 `ScoredRouterService` 做 election                                         | 成立                                    | `ai-engine/routing/scored-router.service.ts:1`                                          |
| `TeamFactory.createFromConfig` 接运行期 TeamConfig，可上动态装配层不改 factory | 成立                                    | `teams/factory/team-factory.ts:56`                                                      |
| 复用 `MissionBudgetPool` 父子预算池                                            | 成立                                    | `guardrails/budget/mission-budget-pool.ts`                                              |
| rubric 通过线锚定 `thresholds.constants.ts` 硬地板                             | 成立                                    | `evaluation/thresholds.constants.ts:31`                                                 |
| engine/evaluation 无 LLM heuristic、harness/evaluation 用 LLM                  | 成立                                    | `ai-engine/evaluation/checkers/*` vs `harness/evaluation/verify/judge.service.ts:21-22` |
| 复用 dag-executor 并行、react-loop parallel_tool_call、escalate_to_human       | 成立                                    | `runner/dag/`、`runner/loop/react-loop.ts`                                              |
| 泛化 `report-artifact-assembler`                                               | 文件存在但深度耦合 report（见 arch-03） | `evaluation/critique/report-artifact/report-artifact-assembler.service.ts:54`           |

复用清单的可信度高于多数同类设计稿——这是本方案的核心优点。

---

## 3. 须修正项（按对抗复核后严重度）

### arch-03（major，holdsUp ✅）DeliverableComposer 归位与'泛化'措辞

`report-artifact-assembler` 的 `AssembleInput` 全是 report 专有字段（sections/citations/figures/quickView），'泛化为 type 分发 composer'是重抽象。且'按交付件类型组装产出'语义更接近输出装配/projector，归 evaluation（质量评判聚合）名实不符——建议把 composer 移出 evaluation（倾向归 orchestrator 产出侧，与 `IDeliveryGenerator` 接口同聚合），evaluation 只留 rubric 验收判定。RubricGenerator 与 judge 同聚合内聚则成立，保留。证据：`report-artifact-assembler.service.ts:54-60`、`judge.service.ts:21-22`。

### arch-04（major，holdsUp ✅）engine 分解原语 vs 既有 decomposeTask

harness 已有 `Leader.decomposeTask`（`leader-llm-adapter.ts:83-153`，被 dynamic-planning 消费）做 **role-aware** LLM 分解。新建 engine 纯分解原语方向对，但与 decomposeTask 共存可能违反'同名概念全项目唯一'。加重证据：`planning.module.ts:26` 注释「TaskDecomposerService 已删 (2026-04-30) — 死代码链路 (0 注入)」——engine 层曾有分解服务因 0 注入被删，本次又要在 engine/planning 新建，须论证为何不会重蹈覆辙。建议：role-agnostic 拆解下沉 engine、decomposeTask 改薄封装注入 availableRoles，避免两份分解 prompt 漂移。

### arch-05（major，holdsUp ✅）'薄入口'与现状张力 + HITL 全新基础设施

app/ask 当前不薄（room runtime + 6 个 mode adapter）。HITL controlChannel（pause/resume/approve/reject/append + Redis pub/sub + DB 持久）全项目 grep 仅命中本设计稿，是从零新建的跨 pod 阻塞控制设施，被低估为 P4 一个阶段。须：量化'薄'的可验证标准；明确走不走 ask 既有 adapter 抽象；reject 回退复用 business-team 既有 checkpoint/rerun（已存在）。

### arch-01（降级 minor）business-team 框架选型论证缺口

设计稿 0 次提及 business-team。复核结论：设计已选 `teams/orchestrator` 动态路径（天然支持动态 stage），原语层（checkpoint/cross-stage/event-relay 在 memory/protocols/guardrails canonical 层）已复用，"大面积重复造轮 = blocker"定性不成立。剩余有效问题：**补一节选型理由**，说明为何不用 business-team 静态框架、能否复用其 cross-stage-state/rerun typed 视图。注：business-team 消费方实为 4 家（playground/social/radar/**writing**）。

### arch-02（降级 minor）'Agent Team'命名与既有概念

`agent-team-layout.spec.ts:33` 把 playground/social/radar 登记为 `AGENT_TEAM_APPS`。复核结论：两个 spec 都是**闭合硬编码白名单**（`it.each(AGENT_TEAM_APPS)`），不扫描整个 ai-app/ 自动识别，ask 薄壳不会被自动卡住——"触发既有 spec 断言"的 major 支撑不成立。剩余有效问题纯属术语层面：伪模型显示名 'Agent Team' 与既有保留概念撞名，建议改用 'Self-Driven Team' / 'Auto Team' 去歧义；并把'与 Playground 无关'修正为'与 business-team 同源、与 Playground 平级'。

### arch-06（minor）过度设计风险

v1 仅交付报告单一类型，却预留 PPT/doc/code 多 projector + 大而全 MissionPlan schema + RoleInventory 调色板抽象——违反 CLAUDE.md YAGNI / 3 处再抽象。建议 v1 收敛抽象面，扩展点写文档不写未用接口。

### arch-07（minor）新增 arch 断言需具体化

'engine/evaluation 不得出现 LLM 调用'应落为'不得 import AiChatService/LLMFactory'（可静态匹配，对齐 layer-boundaries 风格）；唯一性断言对齐既有 `capability-singleton.spec.ts`。

---

## 4. 给作者的最小修改清单（进入实现前）

1. **[minor→建议]** 新增 §4.0'与 business-team 框架选型分析'：说明为何取动态编排路径、能否复用其 cross-stage-state/rerun。
2. **[minor]** 伪模型改名（去 'Agent Team' 歧义）；澄清 ask 薄壳与 AGENT_TEAM_APPS 关系（非强制登记）。
3. **[major]** DeliverableComposer 重新定聚合（移出 evaluation，倾向 orchestrator/IDeliveryGenerator）；'泛化 report-assembler'据实拆为'抽 type-agnostic 接口 + report 降级为 projector'。
4. **[major]** 补 engine 分解原语与 decomposeTask 的去重/迁移决策，引用 2026-04-30 已删死代码教训。
5. **[major]** HITL controlChannel 单列子设计；量化 app/ask'薄'标准；reject 回退复用 business-team rerun。
6. **[minor]** v1 砍掉未用的多 projector/全字段 schema 抽象。

---

## 5. 评审依据文件清单（实际 Read/Grep）

- 设计稿全文
- `teams/orchestrator/dynamic-planning.ts`、`teams/factory/team-factory.ts:1-120`
- `teams/business-team/orchestrator/business-team-orchestrator.framework.ts:1-114`、`business-team/state/*`、`business-team/rerun/*`、`writing-business-orchestrator.service.ts`
- `evaluation/thresholds.constants.ts`、`evaluation/verify/judge.service.ts:1-50`、`evaluation/critique/report-artifact/report-artifact-assembler.service.ts:1-60`
- `ai-engine/evaluation/**`、`ai-engine/planning/**`（含 `planning.module.ts:26`）、`ai-engine/routing/scored-router.service.ts`
- `teams/base/leader-llm-adapter.ts`、`teams/abstractions/member.interface.ts`
- `ai-app/ask/**`（adapters + room runtime + gateway）
- `backend/src/__tests__/architecture/layer-3-authority/agent-team-layout.spec.ts:1-40`
- Grep：decomposeTask、controlChannel/stage-gate、business-team、dag-executor/parallel_tool_call/escalate_to_human
