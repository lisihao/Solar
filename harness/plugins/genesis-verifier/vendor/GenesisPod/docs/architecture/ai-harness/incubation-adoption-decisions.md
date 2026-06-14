# AI Harness 孵化能力采用决策（R2，2026-05-23）

> 背景：R2 深度审计发现 harness 多个能力已孵化（实现 + 测试 + 注册）但
> `agent-playground` 无消费方。本文记录"是否采用"的明确决策，避免孵化代码无据
> 腐烂、也避免被盲目接线。决策来源：R2-#43（LeaderWorkerLoop）+ R2-#51（孵化采用建议）。

## 决策汇总

| 能力                                                  | 现状                                                     | R2 决策                  | 理由                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LeaderWorkerLoop**（动态编排）                      | 已实现 + 测试 + 注册，playground 0 消费                  | **暂不采用（保持孵化）** | leader 动态编排 = 额外 LLM 调用（+成本 +延迟），且改 S3/S4 编排核心回归面大；当前静态编排 + researcher 真并行已满足需求。务实优先，不为单一收益重写编排核心。 |
| **Memory: HierarchicalMemoryCascade + WorkingMemory** | 纯内存、零 Prisma                                        | **建议后续采用**         | 直接补 playground "跨轮/跨阶段研究状态" 缺口；WorkingMemory 接线仅一行 `new WorkingMemory()`。                                                                |
| **Memory: ProcessMemoryManager**                      | 依赖 `AgentMemory` Prisma 模型（Phase 4.2 gate，未落库） | **暂不采用**             | 模型未落库，接线 = 死重。                                                                                                                                     |
| **Collaboration: DebatePattern**                      | 纯无状态 prompt 组合函数                                 | **建议后续采用**         | 可直接调用，零 DI/DB，价值高、成本零；适合多 agent 结构化辩论阶段。                                                                                           |
| **Collaboration: VotingManager**                      | 纯函数                                                   | **暂不采用**             | playground 当前无投票场景。                                                                                                                                   |
| **Collaboration: ReviewWorkflow**                     | 依赖 `review` Prisma 模型（Phase 4.1 gate，未落库）      | **不采用**               | 每方法走 guard 返回空/NotFound，接线 = 死重。                                                                                                                 |
| **Handoffs: AgentRegistry + HandoffService**          | 纯内存                                                   | **建议后续采用**         | 直接建模多 agent 轮转；接线约 10 行，`DefaultHandoffPolicy`（拒自交接、其余放行）是安全默认。                                                                 |

## 一致性看护

孵化能力已由 **R2-#51** 补结构一致性测试（`ai-harness/{memory,handoffs,teams}/__tests__/` +
`incubated-facade-exports.spec.ts`），断言它们可实例化、facade 导出稳定，防止无消费代码静默
腐烂。采用决策落地前，这些测试保证孵化能力随时可用。

## 复审触发条件

出现以下场景时，复审上表"暂不/建议后续"项：

- playground 需要跨 mission / 跨轮记忆 → 采用 HierarchicalMemoryCascade + WorkingMemory。
- 需要多 agent 结构化辩论 / 评审阶段 → 采用 DebatePattern。
- 需要 agent 间显式控制权转移 → 采用 Handoffs（AgentRegistry + HandoffService）。
- `AgentMemory` / `review` Prisma 模型落库 → 复审 ProcessMemoryManager / ReviewWorkflow。

---

**最后更新**：2026-05-23 · **维护者**：Claude Code · **关联**：R2-#43 / R2-#51
