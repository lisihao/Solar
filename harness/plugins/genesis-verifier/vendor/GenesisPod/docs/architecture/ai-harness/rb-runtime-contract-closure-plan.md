# RB 运行时合约单一真源 — 缺口闭合计划（诊断，不改码）

> **来源**：外部审计指出 C0/G1/T16「mission runtime-contract / single-source-of-truth」epic 仍有 7 处缺口；本文是逐项**重新核验后**的闭合计划（每项 fix 方案 + 工作量 + 回归风险 + 验证标准 + 排期）。**仅诊断，未改任何代码。**
> 关键修正：重新核验发现**好几个"缺口"比外审措辞要轻**——是有意设计需补文档/类型，而非 bug。
> **日期**：2026-05-23 · 与 [r3-orchestration-remaining-spec](../ai-app/agent-playground/r3-orchestration-remaining-spec.md)（Playground 编排）是**两个独立 epic**，勿混。

---

## 7 项逐条结论

| #     | 缺口                                                                                            | 重核结论                                                                                                                                                            | Fix 要点                                                                                                                                                                                 | 工作量          | 风险                                                                    |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------- |
| **7** | legacy `cancel()` 未退场（mission-lifecycle-manager.ts:165 `@deprecated`）                      | **确认零生产调用方**（三 app 全走 `finalize()`，T16 切换已完成）——纯死代码                                                                                          | 删 `cancel()`(164-204)+`MissionLifecycleStore`(78-85)+`MissionLifecycleBroadcaster`(88-97,先确认无他用)+ index/facade 对应 export                                                        | **S**           | 极低（tsc 立刻暴露漏网调用）                                            |
| **1** | RB5 `configSnapshot: unknown` 穿透落库（social-store:35 / radar-store:55 / playground:90）      | **schema 层已闭合**（`buildXxxConfigSnapshot()`+zod parse 是单一校验面）；**store 边界类型未收口**                                                                  | 把 3 个 store create-input 的 `configSnapshot?: unknown` 改成 `SocialConfigSnapshot`/`RadarConfigSnapshot`/`PlaygroundConfigSnapshot`（类型已存在，import 收紧即可）                     | **S**           | 低（合法调用方都走 builder，仍编译；裸对象绕过者会编译失败=正是要抓的） |
| **2** | RB2 预估链残留 `FALLBACK_TIER_COSTS`（constraint-engine.ts:60/105-122）                         | **fallback 是有意的**（admin 零模型 edge case），与记账链(resolved-budget-caps，正确)是两条独立链；真缺口=未在接口层声明 + 调用方不知拿到的是 live 还是 fallback 价 | 重命名 `EMERGENCY_TIER_COSTS_NO_MODELS`+JSDoc；`getCostPerKTokens` 返回带 `isFallback`；`CostEstimate` 加 `pricingSource:'registry'\|'fallback'`。**不删** fallback（真 edge case 需要） | **S/M**         | 低（纯附加，无逻辑变更）                                                |
| **6** | Social 原子性 TODO（social-leader.service.ts:651 partial inserts）                              | **真实数据一致性风险**（loop 中途失败 → 孤儿 DRAFT）                                                                                                                | section INSERT 循环包进 `prisma.$transaction`（用 `tx.$queryRaw`）；**把 AI 合规 check 移到事务外**预算好再开事务（避免长 I/O 占连接）                                                   | **S/M**         | 中（$transaction + $queryRaw 需谨慎；回滚=正确行为）                    |
| **5** | 底层 event payload 弱类型（mission-store.interface.ts:112 `payload: unknown`）                  | **`IAgentEvent.payload` 本就是良类型判别联合**；`MissionEventRecord.payload:unknown` 是**有意**（通用 store）。真缺口=emit→persist 边界无类型化适配                 | Option A（便宜）：加 `toMissionEventRecord(event: IAgentEvent): MissionEventRecord` 在转换边界强制 `AgentEventPayload`；patch N 个 `append()` 调用点（需先 grep 计数，估 5-15 处）       | **M**           | 低（Option A 纯附加）                                                   |
| **3** | RB6 Social S8 半发布无成对边界测试                                                              | **机制正确**（S8 内不查 signal、gate-before-stage）；**缺成对集成测试**                                                                                             | 写 4 个用例：cancel BEFORE S8(S8 不被调) / cancel DURING S8(S8 跑完、下个 gate 才 abort) / 无半发布回归 / abort after S8 before S9                                                       | **M**（纯测试） | 零（仅测试）                                                            |
| **4** | RB4 两套运行期状态机制并存（runtime-state-store Redis 心跳 + teams-orchestrator + DB liveness） | **两者目的不同**（Redis=跨 pod 归属探针；DB heartbeatAt=回收权威）且 contract test 已禁止混用。可能 Redis 心跳**无活消费方**（vestigial）                           | 先 grep 确认 `getHeartbeat()` 是否有跨 pod 路由消费方：无→从 `startHeartbeat()` 删 Redis 心跳(~10行)；有→仅补文档。**确认前别动**                                                        | **M**（先调查） | 中（若未来跨 pod 路由依赖它，删了会断）                                 |

---

## 优先级路线图

**Tier 1 — 便宜高值（一个 PR 可合，全是类型/死代码，无运行时风险）**

1. **Gap 7** 删 legacy cancel()（零调用方，S，零风险）—— 先做。
2. **Gap 1** configSnapshot 类型收口（S，纯收紧）。
3. **Gap 2** FALLBACK 重命名+文档+isFallback 信号（S/M，纯附加）。

**Tier 2 — 中等工作量、真实正确性（独立 PR）** 4. **Gap 6** Social `$transaction` 原子性（M，单文件单方法重构；AI 调用挪出事务）—— 单独 PR。5. **Gap 5** event payload 类型化边界 helper（M，Option A；先 grep emit 点计数）。

**Tier 3 — 调查/测试（可与 Tier 1 并行）** 6. **Gap 3** S8 成对边界测试（M，纯测试，可并行）。7. **Gap 4** runtime 心跳合并：**先 grep `getHeartbeat` 消费方**；确认 vestigial 才删，否则仅补文档。

**每 PR 验证**：`type-check` 0 + `test:quick` 绿 + `verify:arch` 0 违规；Gap 6 另加事务回滚集成测试（section 3/3 失败时 0 行残留）。

---

**最终判断（外审口径）**：方向对、主干已深度落地；但按"完整 single-source runtime contract"标准仍未闭环。最核心未闭环点 = Gap 1(业务输入 snapshot 平台级类型治理)、Gap 2(预估链 fallback 显式化)、Gap 6(Social 原子性)、Gap 5(低层 event 类型边界)。Gap 7 是纯收尾。Gap 3/4 是测试/调查。
