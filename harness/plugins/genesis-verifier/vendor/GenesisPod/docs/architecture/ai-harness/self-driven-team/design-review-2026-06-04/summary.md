# 全自驱 Agent Team 设计稿 —— 四视角综合评审总结

**创建日期**: 2026-06-04
**状态**: approve-with-changes（批准方向，须修正后进入 P0 实现）
**评审对象**: `../self-driven-agent-team-design-2026-06-04.md`（v1.0-draft）
**评审视角**: architecture · mece-boundary · feasibility-gaps · safety-cost-dx
**综合方法**: 4 路独立视角评审 → 逐条对抗式复核（adversarial verify，holdsUp=false 剔除/降级）→ 综合

---

## 1. 总体结论：GO（有条件）

**四个视角一致 approve-with-changes，无一视角给 no-go。** 经对抗式复核，**原始的 4 条 blocker 全部被下调**（无一站得住 blocker 定性），其余 major 多数降为 minor。设计的**核心优点是复用清单可信度极高**——逐一核实 ScoredRouterService / TeamFactory / MissionBudgetPool / dag-executor / thresholds / dynamic-planning / report-artifact-assembler 均真实存在且定性准确，分层 MECE 切分（engine 无 agent 状态 / harness 知 mission）与项目红线一致。

**结论：批准设计方向，作者完成下方 5 条"必改项"并答复 §13 后，可进入 P0 骨架。** 这些必改项均为**文档/归位/工作量估算修正**，不推翻架构，不阻塞总体推进。

---

## 2. 必须修改清单（blocker/major 且 holdsUp=true，共 5 条）

> 复核后**无任何条目保持 blocker**；以下 5 条是复核后仍 holds 为 **major** 的项，按优先级排序。

| #   | ID             | 视角         | 问题                                                                                                                                                              | 修正动作                                                                                                                     |
| --- | -------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | feasibility-01 | feasibility  | MissionPlanner **不是** dynamic-planning 薄包装：`tryDynamicDecomposition()` 输入已有 ITeam、输出仅 ExecutionStep[]，产不出 team/loopKind/rubric/estimate 四字段  | §5.1 改"复用并替换"为"新建 MissionPlanner，旧函数仅作分解原语参考"；P1 验收列出 MissionPlan 完整 schema 生成路径             |
| 2   | feasibility-04 | feasibility  | token 流式透传是 **ReActLoop 架构改造**，非"补 AsyncGenerator"——runner 层无任何流式路径，改造撞 stop_reason/tool-call 解析（反向洞察 #1/#2）                      | P3 单独立项 + spec（前端逐字 token 且 stop_reason 判断正确）；不要当简单 wiring                                              |
| 3   | arch-04        | architecture | engine 新分解原语 vs 既有 `Leader.decomposeTask`（role-aware LLM 分解）去重决策缺失，触 MECE「同名唯一」；engine/planning 曾有分解服务因 0 注入于 2026-04-30 被删 | §4/§5.1 补关系决策：engine 抽无状态核心 + decomposeTask 改薄封装；论证为何不重蹈 0 注入死代码                                |
| 4   | arch-03        | architecture | DeliverableComposer 归 harness/evaluation **名实不符**（evaluation=质量评判），"泛化 report-assembler"实为重抽象（assembler 深耦合 report 专有字段）              | 移出 evaluation，收口到 orchestrator/`IDeliveryGenerator`；据实拆解工作量为"抽 type-agnostic 接口 + report 降级为 projector" |
| 5   | arch-05        | architecture | app/ask"薄入口"与现状张力（room runtime + 6 adapter）；HITL controlChannel 跨 pod 阻塞设施被低估为 P4 一阶段                                                      | 量化"薄"标准；明确走不走 ask adapter 抽象；HITL 单列子设计，reject 回退复用 business-team rerun                              |

> **与 #5 强相关的高价值 minor**（建议一并处理）：feasibility-03 指出 HITL 可**复用既有 `human-approval.tool.ts` DB-poll 阻塞原语**作 P4a，再加 Redis pub/sub 做 P4b 跨 pod——可显著降低 #5 的 HITL 工作量与风险。

---

## 3. 跨视角共性主题

四视角虽切入点不同，却在以下几处**独立撞车**，说明是设计稿的真实系统性缺口：

1. **MissionPlanner / engine 分解原语的"复用 vs 新建"被乐观表述**（arch-04 + feasibility-01/02 + mece-01）——四个视角都发现"复用 dynamic-planning / engine 分解原语"的措辞会让人低估这是从零新建的 LLM 规划器；且与既有 `decomposeTask` 存在同名概念双轨风险。**这是最需要作者澄清的主题。**

2. **DeliverableComposer 归 evaluation 名实不符**（arch-03 + mece-03 + feasibility-09）——三视角一致认为"按 type 组装交付件"是输出装配/delivery concern，应收口到 orchestrator 的 `IDeliveryGenerator`，而非塞进质量评判聚合；且下沉前需先修 assembler 的 4 处 facade 穿透。

3. **HITL stage-gate 工作量被低估**（arch-05 + feasibility-03 + safety-08）——三视角都指出跨 pod 阻塞控制是非平凡新建，但复核也一致校准：**既有 HITL 审批原语（human-approval.tool / human-approval-admin）可复用**，应拆 P4a（单 pod 复用既有）/P4b（跨 pod Redis pub/sub）。

4. **"用 LLM → harness"是设计稿自造的伪判据**（mece-01 + mece-02）——CLAUDE.md 从无此规则（engine/llm 本就是 LLM 聚合），engine 多聚合合法调 LLM；§4 判据措辞须改为"以 agent/mission 状态为唯一分层依据"。

5. **护栏多为"文字声明"未机制化**（safety-02/03/04 + arch-07 + mece-02/07）——rubric passLine 上界、反向洞察 #3/#7、新组件唯一性等护栏在设计稿是文字承诺，应落为 thresholds 常量 + clamp + arch spec 断言。均为 minor 但应在对应阶段补齐。

---

## 4. 设计亮点

- **复用清单经得起逐行核实**：四视角各自 Grep/Read 验证，ScoredRouterService / MissionBudgetPool（父子池 isExhausted >= 比较有 spec）/ dag-executor / thresholds 硬地板 / CrossStageState / BusinessAgentTeam framework 全部真实存在且定性准确——远高于同类设计稿水平。
- **分层判据扎实**：engine/evaluation 确为无 LLM 启发式 vs harness/evaluation 确用 LLM（judge.service.ts），切分成立。
- **护栏文化对齐项目红线**：rubric 通过线锚定 thresholds 硬地板、iteration 硬 cap、MissionBudgetPool 耗尽即停，直接对应已记录的 P1 react-runaway 与 mission 死锁事故教训。
- **反向洞察意识到位**：ReActLoop 已落地 #1/#4/#5，设计稿主动纳入三层看护（ESLint / verify:arch / pre-push）。
- **dynamic-planning 定性准确**：半成品、env-gated off 的判断与实际代码吻合，"替换半成品"方向正确且风险受控。

---

## 5. 对 §13 三个开放问题默认决策的评审意见

| #   | 问题             | 设计稿默认                                                         | 评审意见                                                                                                                                                                                                                                                                                                                             | 结论                                              |
| --- | ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 1   | HITL 粒度        | **阶段边界**（token 级 → v1.5）                                    | **认可**。token 级中断须动 ReActLoop 内层循环、撞反向洞察 #1/#2、回归风险高（feasibility-04 佐证），推迟 v1.5 是正确权衡。**补充条件**：须为阶段边界 gate 定义**超时降级策略**（默认 10min → auto-reject 或挂 PAUSED，feasibility-10）。                                                                                             | 认可（须补超时策略）                              |
| 2   | 方案卡可编辑深度 | **轻**：增删角色 + 调 rubric 数值                                  | **认可方向，但须加护栏**。用户调 rubric 数值若无上下界，passLine→0 会使质量验收门变空门（safety-04）。**补充条件**：前端 slider 限 [REVIEW_PASS_THRESHOLD, RUBRIC_PASS_LINE_CAP] + 后端二次 clamp。同时遵循 YAGNI：v1 不预留多 projector / 全字段 schema 抽象（arch-06）。                                                           | 认可（须加 clamp 护栏）                           |
| 3   | ADR 立 2 条      | ①MissionPlanner 归 harness/teams/orchestrator；②HITL 用 stage-gate | **ADR① 部分修正**：归 orchestrator 成立，但须同条交代与既有 `decomposeTask` 去重决策（arch-04）及 `MissionExecutionPlan` 命名合并（mece-04）。**ADR② 认可**，须补"复用既有 human-approval 审批原语 + 跨 pod Redis pub/sub"选型与超时策略。**建议加 ADR③**：DeliverableComposer 归 orchestrator/IDeliveryGenerator（非 evaluation）。 | 认可但须扩充（ADR① 补去重、ADR② 补选型、加 ADR③） |

---

## 6. 复核校准摘要（透明记录）

| 视角           | 原 blocker  | 原 major | 复核后维持 major  | 推翻/降级                                 |
| -------------- | ----------- | -------- | ----------------- | ----------------------------------------- |
| architecture   | 1 (arch-01) | 4        | 3 (arch-03/04/05) | arch-01→minor, arch-02→minor              |
| mece-boundary  | 0           | 3        | 0                 | mece-01→nit, mece-02→minor, mece-03→minor |
| feasibility    | 0           | 5        | 2 (feas-01/04)    | feas-02→nit, feas-03→minor, feas-05→minor |
| safety-cost-dx | 2 (01/02)   | 6        | 0                 | 全部降 minor，#07 推翻                    |

**最终必改（holds 为 major）：5 条**，集中在 architecture(3) + feasibility(2)，主题为"复用 vs 新建的诚实表述"与"归位收口"，均为可在设计稿修订内闭合的缺口。
