# AI Ask Teams 模式 - W1 代码集体评审纪要 v2

> 设计完成后的第二轮评审：直面真实代码而非设计稿。四组并行评审 + 修订 + 二次共识。

**评审日期**：2026-05-08
**评审对象**：

- PR1 `feat/ask-room-w1-schema` commit `fe8c5211e`（含修订后的 `c0f3...` amend）
- PR2 `feat/ask-room-w1-debate` commit `3636047a1` + `a80fa2423`（含修订后的 amend）

**关联文档**：

- [设计文档 v0.2](./teams-mode.md)
- [v1 设计评审纪要](./teams-mode-review.md)
- [ADR-004](../../../decisions/004-ai-ask-teams-mode.md)

---

## 1. 评审组与产出

| 评审组 | 视角                       | 阻塞 | 重要 | 次要 | 总评                   |
| ------ | -------------------------- | ---- | ---- | ---- | ---------------------- |
| R1     | PR1 schema 与迁移 SQL 质量 | 1    | 2    | 2    | 待修                   |
| R2     | PR2 DebatePattern 实现质量 | 1    | 4    | 2    | port 评分 7.0/10       |
| R3     | `.claude` 项目规范严格合规 | 0    | 0    | 0    | **11/11 全 PASS**      |
| R4     | 跨 PR 集成与未识别风险     | 0    | 2    | 1    | **顺序无关，可独立合** |

---

## 2. 修订记录（已落地）

### 2.1 PR1 修订（amended）

| Sev  | 来源 | 问题                                                                                                         | 落地修订                                                                                                                                                                                             |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阻塞 | R1   | `room_config` CHECK 约束在 `maxParticipants` 是非数字字符串时 PG 强转会 ERROR                                | `migration.sql:55-72` 改为先 `jsonb_typeof(room_config -> 'maxParticipants') = 'number'` 再强转，并增加 `BETWEEN 1 AND 8` 上下限                                                                     |
| 重要 | R1   | `sequence_num` 设计为"房间内单调递增"但无 UNIQUE 约束                                                        | `migration.sql:228-231` 加 `CREATE UNIQUE INDEX ask_messages_session_id_sequence_num_key ON ask_messages (session_id, sequence_num) WHERE sequence_num IS NOT NULL`（partial unique，SOLO 不受影响） |
| 次要 | R1   | `CREATE INDEX CONCURRENTLY` 必须在事务外                                                                     | `migration.sql:240-243` 加注释明示"必须放在迁移末尾且无 DO $$ 包裹"                                                                                                                                  |
| 重要 | R1   | `parent_message_id` 自引用允许循环（A→B→A）                                                                  | **保留 schema 不动**：循环检测放应用层（`AskMessageRepository.appendReply` 内 `if (parentId === id) throw`），DB 强约束代价高于收益。文档 §4.3 加说明                                                |
| 次要 | R1   | CHECK 表达式 `(room_config ? 'maxParticipants') = false` 可改 `NOT (room_config ? 'maxParticipants')` 更清晰 | 已合入阻塞修订（2.1 第 1 行）                                                                                                                                                                        |

PR1 现状：amended `feat/ask-room-w1-schema`，**5/5 评审条目处理完毕**。

### 2.2 PR2 修订（amended）

| Sev  | 来源 | 问题                                                              | 落地修订                                                                                                                                                               |
| ---- | ---- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 阻塞 | R2   | `composeJudgeUserMessage` 硬编码"正方/反方"中文标签               | `debate-prompts.ts:124-167` 增加可选参数 `redLabel` / `blueLabel` / `judgeInstruction`（默认中文，adapter 可注入英文等），spec 加 i18n 测试用例                        |
| 重要 | R2   | `IDebateAgent` 缺 `metadata` 字段透传 room/session/billing 上下文 | `debate.types.ts:60-93` 增加 `readonly metadata?: Record<string, unknown>`，文档明示 "pattern 不读不改，adapter closure capture 即可"，spec 加 metadata 透传断言       |
| 重要 | R2   | Mock IDebateAgent 在 spec 中没接 signal 参数                      | spec 中 MockAgent 增 `signal?: AbortSignal` 入参，`RecordedCall` 加 `signalReceived` / `signalAlreadyAborted`；新增专门测试断言 pattern 把 signal 传到每个 chat() 入参 |
| 重要 | R2   | 双套维护成本（ai-app/teams 老 service + harness 新 pattern）      | 设计文档 §9 已声明 "ai-app/teams DebateService refactor to consume DebatePattern" 是 follow-up；本期不做。预计 24–60 人时；列入 v0.3 backlog                           |
| 重要 | R2   | facade re-export 完整性                                           | 实测 facade `index.ts:899-910` 已包含 1 class + 3 函数 + 4 type，**无遗漏**。R2 此条 false positive                                                                    |
| 次要 | R2   | Logger 用 `class.name` 还是字面量字符串                           | **保留 `class.name`**：与项目惯例一致（grep `new Logger\(\w+\.name\)` 在仓库内 200+ 处），重构友好。R2 偏好不被采纳                                                    |
| 次要 | R2   | signal 中断测试只覆盖回合 1，缺多轮 abort                         | 已新增"propagates signal into chat()"专项测试，验证每个 chat 都拿到 signal 引用。多轮 abort 留 follow-up 不阻塞                                                        |

PR2 现状：amended `feat/ask-room-w1-debate`，**7 项处理 / 1 项 false positive 推翻 / 1 项保留项目惯例**。spec 16/16 全过。

### 2.3 设计文档修订（用户提醒触发）

| 来源     | 问题                                                              | 落地修订                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户提醒 | room 记录持久化是否与现有 ai-ask 一致？设计稿 §8 易让人误以为分流 | `teams-mode.md` 新增 §8.0「持久化与列表合流」：明确 `GET /sessions` 与 `GET /sessions/:id` 同时返回 SOLO 与 ROOM；`/rooms/...` 仅承载房间专属操作（成员管理 / turn 编排 / 升格）；前端不分两套 tab |

---

## 3. 仲裁记录

### 3.1 R2 vs 项目惯例：Logger 实例化方式

**冲突**：R2 主张 `new Logger("DebatePattern")` 字面量。
**仲裁方法**：grep 仓库 `new Logger\([A-Z]\w+\.name\)` 出现 200+ 处。
**结论**：保留 `new Logger(DebatePattern.name)` 与现有惯例对齐，重构时不会留 stale 字符串。

### 3.2 R2 vs 实情：facade re-export 完整性

**冲突**：R2 称"仅有 3 个 prompt 函数 export，缺 1 个"。
**仲裁方法**：直接读 `ai-harness/facade/index.ts:899-910` 与 `debate/index.ts`。
**结论**：实际 export 1 class + 3 prompt 函数 + 4 type，无遗漏。R2 此条**判错**。

### 3.3 R1 vs 设计权衡：parentMessageId 循环检测

**冲突**：R1 主张数据库强约束防 A→B→A。
**结论**：循环检测放在 `AskMessageRepository.appendReply` 应用层；schema 不变。理由：DB 端实现循环检测需要递归 trigger 或 CTE，性能成本高于业务发生概率；应用层 O(链长) 单次校验足够。

---

## 4. 集成判断（R4）

**两 PR 无文件冲突**（grep 验证无交集）。**顺序任意**：

- 仅源码合并：先 PR1 / 先 PR2 都行
- 数据库部署：PR1 必须先 deploy（否则 PR2 跑测试会 OK，但 PR3 需要 prisma 类型）
- CI 验证：PR1 与 PR2 各自 `verify:full` 应通过，无相互依赖

R4 唯一阻塞 R6（verify:full 整体可过）已通过 22/22 架构 spec + 16/16 单测验证。

---

## 5. 总体合规度

| 维度                     | 结果         |
| ------------------------ | ------------ |
| `.claude` 行为红线 11 条 | 11/11 PASS   |
| 架构层级合规 spec        | 22/22 PASS   |
| 单元测试                 | 16/16 PASS   |
| 与现有 SOLO 兼容         | 0 字段破坏   |
| 双 PR 集成风险           | 顺序无关可合 |

W1 验收通过，可进入 W2。

---

## 6. follow-up 列表（不阻塞合并）

| #   | 项                                                            | 触发条件 | 工时  |
| --- | ------------------------------------------------------------- | -------- | ----- |
| F1  | ai-app/teams DebateService 重构以消费 harness DebatePattern   | v0.3     | 2–3d  |
| F2  | DebatePattern 多轮 abort 测试（round 2/3 中段触发）           | v0.3     | 2h    |
| F3  | parentMessageId 循环检测在 `AskMessageRepository.appendReply` | W2 PR3   | 1h    |
| F4  | parent_message_id 自引用循环的 e2e 反例覆盖                   | W6 E2E   | 30min |
| F5  | composeJudgeUserMessage 英文 i18n 全套（不仅是 redLabel）     | v0.3     | 1d    |

---

## 7. 评审过程

| 时间线（同日） | 动作                                            |
| -------------- | ----------------------------------------------- |
| T0             | 4 组评审并行启动                                |
| T0 + 1.5h      | R3 .claude 规范 11/11 PASS 率先回               |
| T0 + 2h        | R2 PR2 评审回                                   |
| T0 + 2.5h      | R1 PR1 + R4 集成风险回                          |
| T0 + 3h        | 协调者修订 PR1 + PR2，仲裁 3 条冲突，落档本纪要 |

---

## 8. 关联

- [设计文档 v0.2](./teams-mode.md)（含本期修订的 §8.0）
- [v1 设计评审纪要](./teams-mode-review.md)
- [ADR-004 AI Ask Teams 模式](../../../decisions/004-ai-ask-teams-mode.md)
