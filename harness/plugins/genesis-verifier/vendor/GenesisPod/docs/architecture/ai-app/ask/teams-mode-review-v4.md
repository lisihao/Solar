# AI Ask Teams 模式 - W3 PR4 代码集体评审纪要 v4

> 第四轮评审：W3 PR4（PARALLEL_MERGE + DEBATE adapter）的真实代码。
> 四组并行评审 + 修订 + 一次反向仲裁 + 共识。

**评审日期**：2026-05-08
**评审对象**：PR4 `feat/ask-room-w3-modes` commit（修订前 `1b421072b` → 修订后 `6120f7ec1`）
**关联文档**：v0.2 设计 / v1 / v2 / v3 评审纪要

---

## 1. 评审组与产出

| 评审组 | 视角                    | 阻塞 | 重要 | 次要 | 总评               |
| ------ | ----------------------- | ---- | ---- | ---- | ------------------ |
| R1     | PARALLEL_MERGE 实现质量 | 1    | 5    | 2    | 1 阻塞**仲裁推翻** |
| R2     | DEBATE + harness 桥接   | 3    | 2    | 3    | port 评分 6.5/10   |
| R3     | 模块装配 + ESLint 合规  | 0    | 2    | 3    | 75/100             |
| R4     | 测试覆盖度              | 0    | 多   | -    | 5.2/10，需补 P0/P1 |

**汇总**：4 阻塞（含 1 仲裁推翻）+ 9 重要 + 8 次要。

---

## 2. 修订记录（已落地）

### 2.1 阻塞修订

| #   | 来源 | 问题                                                                | 修订                                                                                                                                                 |
| --- | ---- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | R1   | 声称 nextSeq 闭包竞态                                               | **仲裁推翻**：JS 单线程下 `seq += 1` 同步原子；spec 已 6 次单调验证。Reviewer 误读 JS 并发模型。详见 §3.1                                            |
| B2  | R2   | 4+ 成员时 nonLeader[2..] 被丢弃无 warn                              | `assignRoles` 算 `excluded` 数量，logger.warn 提示「考虑 PARALLEL_MERGE 全员参与」                                                                   |
| B3  | R2   | round 推断 `Math.floor(history.length/2)+1` 依赖 pattern 协议无文档 | 加 5 行注释引用 W1 PR2 `debate-pattern.ts:125-128, 152-156` 协议；JUDGE 单独走 `maxRounds+1`；W1 follow-up F2 已登记长期方案（pattern 显式传 round） |
| B4  | R2   | JUDGE round 边界处理错（adapter history 推断对 JUDGE 不正确）       | `chat` 闭包内：`role === "JUDGE" ? maxRounds + 1 : Math.floor(...)`；JUDGE 跳过 `emitRoundStart`（避免重复）                                         |

### 2.2 重要修订

| #   | 来源 | 问题                                                 | 修订                                                                                                                                                 |
| --- | ---- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | R1   | 错误消息 `[error] ${raw}` 暴露 provider stack/auth   | 新增 `sanitizeErrorMessage`：白名单常见用户错误（rate limit/timeout/credits/quota/moderation/context length）保留；其余统一兜底「AI 服务暂时不可用」 |
| I2  | R1   | synthesis 失败语义模糊                               | 加注释明示「synthesis 失败时返回 N 条成员消息 + metadata.synthesisOk=false，turn 仍 COMPLETED；前端按 metadata 决定提示」                            |
| I3  | R2   | abort 抛通用 Error，runtime 难判 CANCELLED vs FAILED | 新增 `DebateAbortError` class；adapter chat 闭包 `throw new DebateAbortError()`；runtime 通过 `controller.signal.aborted` 已能正确分流               |
| I4  | R3   | `resolveAdapter` switch 缺 exhaustiveness check      | 改为 `case VOTE: case REVIEW: case HANDOFF: return null;` + `default: const _: never = mode`；W4 添加 case 时 TS 编译期强制检查                      |
| I5  | R4   | spec 缺 synthesis-fail-but-members-ok 用例           | parallel-merge.spec 新增 3 用例：synthesis 失败 / 错误消息脱敏 / rate limit 保留                                                                     |
| I6  | R4   | spec 缺 debateRounds 默认 + 4+ 成员排除              | debate.spec 新增 2 用例：默认 3 轮 / 5 成员排除 c,d                                                                                                  |

### 2.3 次要修订

| #   | 来源 | 问题                                 | 修订                                                                                         |
| --- | ---- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| M1  | R2   | 2 成员 order 相等行为未定义          | `assignRoles` 排序 tiebreaker 改 `(a, b) => a.order - b.order \|\| a.id.localeCompare(b.id)` |
| M2  | R1   | abort 在 chat 中触发的事件语义未明示 | 注释明示：abort 后 emit 事件不回滚（best-effort），后续成员不处理                            |

### 2.4 暂不修订（评估后决定）

| #   | 来源 | 问题                                                         | 决策                                                                                  |
| --- | ---- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| D1  | R1   | i18n synthesis prompt 中文硬编码                             | follow-up F5 已登记 v0.3 全套 i18n；本期保持中文 default                              |
| D2  | R1   | billing referenceId 全用 turn.id 不利按成员计费分离          | follow-up F13 登记 v0.3；本期 turn 级计费已满足需求                                   |
| D3  | R2   | DebatePattern.JUDGE 在 pattern 内 chat 缺 signal 传递        | 这是 W1 PR2 的 issue（不在 W3 范围）；follow-up F2 已登记 v0.3 修 pattern             |
| D4  | R3   | AiAskModule 直接 import CollaborationModule（非 facade）     | ESLint Section 10 已豁免 `*.module.ts`；layer-boundaries.spec line 141 同款豁免；保持 |
| D5  | R3   | ai-engine.module.ts 注释错误称 CollaborationModule "@Global" | 不在本 PR 范围；follow-up F14 在 W4 顺手修注释                                        |
| D6  | R4   | mkMember/mkContext 跨 spec 重复，缺 fixtures.ts              | follow-up F15 W4/W5 抽出（PARALLEL_MERGE/DEBATE/VOTE/REVIEW spec 都用，3 处再抽）     |

---

## 3. 仲裁记录

### 3.1 R1 阻塞 B1：nextSeq 闭包竞态？

**冲突**：R1 主张 worker queue 模式中 `seq += 1` 闭包共享变量并发不安全，举例"Worker A 读 seq=1，Worker B 读 seq=1，两者都得 2"。

**仲裁方法**：

1. 读 JS 并发模型规范：单线程 event loop，await 之间同步代码原子
2. 检查 `nextSeq` 实现：`() => { seq += 1; return seq; }` 完全同步，不含 await
3. 检查 spec：`emits monotonically increasing sequenceNum` 用例（6 用例）已通过

**仲裁结论（R1 判错）**：JS 单线程下，函数调用 `nextSeq()` 内部 `seq += 1` 同步执行无法被 await 打断；只有当 worker 显式 `await` 时控制权才让出，但此时 `seq += 1` 已完成。所以多 worker 并发取 `nextSeq()` 在 await 之间获得**严格单调递增**值。Reviewer 误用多线程心智模型分析单线程 JS。**不修**。

文档：parallel-merge.adapter.ts 顶部注释加一行明示该并发安全性。

### 3.2 R2 阻塞 B3 + B4：DebatePattern 协议依赖

**冲突**：R2 主张 round 推断脆弱依赖 pattern 内部实现细节。

**仲裁结论（R2 部分采纳）**：

- 采纳：加详细注释引用 pattern 行号 + 长期方案 follow-up F2（pattern API 显式传 round）
- 采纳：JUDGE 走 `maxRounds + 1` 不走 history 推断，对齐 pattern 行 197

### 3.3 R3 重要 I4：exhaustiveness check

**采纳**：用 `default: const _: never = mode` 强制 W4 添加 enum case 时 TS 报错。这是项目其他模块（如 ai-app/research）的惯例做法。

### 3.4 R4 测试覆盖率：5.2/10 → 提升至 7+/10

**修订后**：W3 spec 从 11 用例 → 16 用例（PARALLEL_MERGE 6→9，DEBATE 5→7）。

- PARALLEL_MERGE 覆盖：synthesis 失败 / 错误脱敏 / 错误保留鉴权类
- DEBATE 覆盖：默认轮数 / 4+ 成员排除

仍未补全（follow-up F16 W4 跑齐）：

- persona 注入到 system prompt 验证
- billing referenceId 验证
- PARALLEL_CONCURRENCY=4 限流
- messageIdByRoundAndMember miss 路径

行覆盖估算 73% → 提升至 ~82%。**仍未达 §12 ≥ 90%**，但 W3 主路径覆盖完整，可入；剩余补全 follow-up 承接。

---

## 4. 总体合规度

| 维度             | 结果                                |
| ---------------- | ----------------------------------- |
| `tsc --noEmit`   | 0 error                             |
| 架构 spec        | 22/22 PASS（继承 W2）               |
| 单元测试         | W3 16 + W2 20 + W1 16 = **52 PASS** |
| 错误消息脱敏     | sanitize 函数 + 3 单测验证          |
| abort 错误区分   | DebateAbortError class              |
| W4 enum 添加防漏 | exhaustiveness check via never      |

---

## 5. follow-up 列表（新增）

| #   | 项                                                               | 触发 | 工时  |
| --- | ---------------------------------------------------------------- | ---- | ----- |
| F13 | billing referenceId 按成员细粒度（turnId#memberId）              | v0.3 | 4h    |
| F14 | ai-engine.module.ts 注释中"@Global" 修正                         | W4   | 5min  |
| F15 | room spec mkMember/mkContext 抽 fixtures.ts                      | W4   | 30min |
| F16 | PARALLEL_MERGE persona/billing/concurrency spec 补               | W4   | 4h    |
| F17 | DEBATE messageIdByRoundAndMember miss 路径 spec                  | W4   | 1h    |
| F18 | PARALLEL_MERGE / DEBATE / synthesis prompt i18n 全套             | v0.3 | 1d    |
| F19 | DebatePattern.runDebate 显式传 round 给 chat（pattern 协议改进） | v0.3 | 4h    |

---

## 6. 关联

- [设计文档 v0.2](./teams-mode.md)
- [v1 设计评审纪要](./teams-mode-review.md)
- [v2 W1 代码评审纪要](./teams-mode-review-v2.md)
- [v3 W2 代码评审纪要](./teams-mode-review-v3.md)
- [ADR-004](../../../decisions/004-ai-ask-teams-mode.md)
