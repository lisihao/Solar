# AI Ask Teams 模式 - W4 PR5 代码集体评审纪要 v5

> 第五轮评审：W4 PR5（VOTE / REVIEW / HANDOFF 三 adapter）+ 6 mode 全覆盖。
> 综合评审 + 修订 + 共识。

**评审日期**：2026-05-08
**评审对象**：PR5 `feat/ask-room-w4-modes2` commit（修订前 `726645bac` → 修订后 `0fbb97b63`）
**关联文档**：v0.2 设计 / v1-v4 评审纪要

---

## 1. 评审产出

| 视角                   | 阻塞 | 重要 | 次要 | 总评                  |
| ---------------------- | ---- | ---- | ---- | --------------------- |
| 综合评审（4 视角合并） | 1    | 5    | 6    | **7.5/10 有条件可合** |

---

## 2. 修订记录（已落地）

### 2.1 阻塞修订

| #   | 问题                                                            | 修订                                                                                                                                           |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | VOTE: VotingManager 单例 sessions Map 异常路径不清理 → 内存泄漏 | `execute()` 外层 try/catch；异常路径调用 `cancelVote(sessionId)` 释放 session。正常路径 closeVote 把 session.status=closed（pattern 内已实现） |

### 2.2 重要修订

| #   | 问题                                                     | 修订                                                                                                                                                         |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | HANDOFF: matchesShortRef 同名 displayName 歧义           | 新建 `resolveHandoffTarget()`：优先级 (1) 精确 id (2) id 前缀唯一 (3) displayName 完全匹配且唯一；否则 reject（避免错误路由）                                |
| I2  | HANDOFF: cycle 间接（A→B→C→B）spec 未覆盖                | 新增 spec "prevents indirect cycle A→B→C→B"，验证 visited Set 已正确防护                                                                                     |
| I3  | HANDOFF: 同名歧义路径无 spec                             | 新增 spec "rejects ambiguous displayName when two members share name"，验证 resolveHandoffTarget 拒绝路由                                                    |
| I4  | REVIEW: allReviewersFailed 时无说明，UI 不知为何跳过修订 | 补一条 `senderType=SYSTEM` 消息："所有评审者暂不可用，已跳过修订阶段。可重试 turn 或切换 mode。"；spec 同步加 `expect(systemMsg).toBeDefined()`              |
| I5  | nextSeq 闭包共享于 Promise.all（REVIEW reviewers 并行）  | **不修**（与 W3 v4 仲裁推翻同源）：JS 单线程下 `seq += 1` 同步原子，await 之间不被打断。spec 已多次验证单调性（W3 PARALLEL_MERGE 同模式）。仲裁结论登记 §3.1 |

### 2.3 次要修订

| #   | 问题                                         | 修订                                                                                               |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| M1  | HANDOFF: startMemberId 未校验 enabled 状态   | `pickStart()` 内 `enabled.find(...)` 已隐式过滤（enabled 列表已剔除 disabled/deleted）；加注释明示 |
| M2  | runtime resolver 注释过时（"待 W3/W4 实现"） | 改为"W2-W4，6 mode 全部覆盖：FREECHAT / PARALLEL_MERGE / DEBATE / VOTE / REVIEW / HANDOFF"         |

### 2.4 暂不修订（follow-up）

| #   | 问题                                        | 决策                                                                                          |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| D1  | 3 adapter 全部硬编码中文                    | follow-up F5/F18 已登记 v0.3 全套 i18n                                                        |
| D2  | REVIEW 不调用 ReviewWorkflowService         | 设计决策（v3 仲裁）：Prisma `Review` 表延后；adapter 自管。follow-up F20: v0.3 表建后整合     |
| D3  | HANDOFF 标记驱动而非 ToolCall               | 简化版交付；v0.3 升级为 `ToolFacade.chatWithToolsStream` + 显式 handoff_tool（follow-up F21） |
| D4  | VOTE 注释"末轮 leader 不投票"与实现轻微偏差 | 实现是"leader 不投票，仅出结论"，注释已对齐；本轮无需改                                       |

---

## 3. 仲裁记录

### 3.1 nextSeq 闭包并发（reviewer 第二次提出）

**冲突**：reviewer 主张 REVIEW 的 `runReviews()` 用 `() => { seq += 1; return seq; }` 在 Promise.all 中不安全。

**仲裁结论（推翻）**：与 W3 PARALLEL_MERGE 完全同模式（已在 v4 §3.1 仲裁过）。

- JS 单线程：函数内部 `seq += 1` 同步原子
- await 之间才让出控制权；Worker A 拿到 seq=N 是已落定的值
- spec 反复验证单调性通过

**结论**：保留闭包模式，与 PARALLEL_MERGE 一致。文档加一条引用 v4 §3.1。

---

## 4. 总体合规度

| 维度                     | 结果                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `tsc --noEmit`           | 0 error                                                       |
| W3 sequence: spec 一致性 | nextSeq 闭包模式一致                                          |
| 单元测试                 | W1 16 + W2 20 + W3 16 + **W4 18** = 70；架构 22 = **92 PASS** |
| 6 mode 全覆盖            | FREECHAT / PARALLEL_MERGE / DEBATE / VOTE / REVIEW / HANDOFF  |
| Adapter exhaustiveness   | TS never check 生效，6 mode 完整路由                          |
| 错误消息脱敏             | 3 adapter 一致（中文兜底文案）                                |
| HANDOFF 路由消歧         | resolveHandoffTarget 三级优先级                               |

---

## 5. follow-up 列表（新增）

| #   | 项                                                                 | 触发 | 工时 |
| --- | ------------------------------------------------------------------ | ---- | ---- |
| F20 | REVIEW: ReviewWorkflowService 集成 + Prisma `Review` 表迁移        | v0.3 | 1d   |
| F21 | HANDOFF: 升级为 ToolCall-based（agent 显式调用 handoff_tool）      | v0.3 | 1d   |
| F22 | VotingManager session TTL 自动清理（防止 long-lived session 堆积） | W5   | 4h   |
| F23 | 3 adapter i18n 统一（VOTE/REVIEW/HANDOFF 中文文案抽出 i18n table） | v0.3 | 1d   |
| F24 | nextSeq 模式 ADR：JS 单线程并发安全性正式文档化（避免重复仲裁）    | v0.3 | 1h   |

---

## 6. 进度统计

| 波次   | 状态 | 主要交付                                         | commit          |
| ------ | ---- | ------------------------------------------------ | --------------- |
| W1 PR1 | ✅   | Prisma schema + 手写迁移                         | `fe8c5211e`     |
| W1 PR2 | ✅   | DebatePattern 抽象 + 16 单测                     | `a80fa2423`     |
| W2 PR3 | ✅   | room CRUD + FREECHAT + Gateway + 20 单测         | `a41b0275c`     |
| W3 PR4 | ✅   | PARALLEL_MERGE + DEBATE + 16 单测                | `6120f7ec1`     |
| W4 PR5 | ✅   | VOTE + REVIEW + HANDOFF + 18 单测；6 mode 全覆盖 | **`0fbb97b63`** |
| W5     | 待启 | mission 升格 + event-relay + 幂等性 + Billing    | —               |
| W6     | 待启 | 6 条 E2E + 性能基线 + 文档收尾                   | —               |

按 17.5d 工期已交付 ~12d backend 主链路。剩余 W5（3d）+ W6（2d）+ FE PR6/7（前端组件 + 模式 UI，未启动）。

---

## 7. 关联

- [设计文档 v0.2](./teams-mode.md)
- [v1 设计评审纪要](./teams-mode-review.md)
- [v2 W1 代码评审纪要](./teams-mode-review-v2.md)
- [v3 W2 代码评审纪要](./teams-mode-review-v3.md)
- [v4 W3 代码评审纪要](./teams-mode-review-v4.md)
- [ADR-004](../../../decisions/004-ai-ask-teams-mode.md)
