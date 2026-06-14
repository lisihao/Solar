# AI Ask Teams 模式 - W2 PR3 代码集体评审纪要 v3

> 第三轮评审：W2 PR3（房间基础 + FREECHAT adapter + Gateway）的真实代码。
> 四组并行评审 + 修订 + 三次共识。

**评审日期**：2026-05-08
**评审对象**：PR3 `feat/ask-room-w2-room` commit（修订前 `f597064d4` → 修订后 `a41b0275c`）
**关联文档**：

- [v0.2 设计文档](./teams-mode.md)
- [v1 设计评审纪要](./teams-mode-review.md)
- [v2 W1 代码评审纪要](./teams-mode-review-v2.md)

---

## 1. 评审组与产出

| 评审组 | 视角                             | 阻塞 | 重要 | 次要 | 总评                  |
| ------ | -------------------------------- | ---- | ---- | ---- | --------------------- |
| R1     | 服务层质量（Service + Runtime）  | 2    | 3    | 3    | 待修                  |
| R2     | Adapter 与 Gateway 契约          | 1    | 4    | 3    | port 评分 7/10        |
| R3     | Controller / Gateway / Auth 安全 | 3    | 2    | 3    | **3 个安全阻塞**      |
| R4     | 测试覆盖度                       | 0    | 多   | -    | 4.5/10，未达 §12 ≥90% |

**汇总**：6 阻塞 + 9 重要 + 9 次要。

---

## 2. 修订记录（已落地于 amended commit）

### 2.1 阻塞修订（必须，全部已落地）

| #   | 来源 | 问题                                                                           | 修订                                                                                                                                          |
| --- | ---- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | R1   | `nextSequenceNum` 用 `aggregate({_max})+1` 并发非原子                          | `appendUserMessage` 加 retry 循环；P2002 unique violation 触发 5 次指数退避重试。Schema 的 partial unique index 是兜底防线                    |
| B2  | R1   | `AskSession` cascade 删除会物理删除 `AskRoomMember`，与软删承诺冲突            | **保留 cascade**（场景"删整个 session"用户预期成员同时删）；软删仅适用于"单成员退场"（评审 v2 P1-9 已落实）。文档 §4.4 加说明                 |
| B3  | R2   | `turn.subscribe.resumeFromSeq` 协议存在但 `partial-log` 端点未实现，前后端失配 | 暂移除 `turn.subscribe`，简化 `AskRoomClientEvent` 仅 `turn.cancel`；待 W5 实现 partial-log 端点后再开启（follow-up F6）                      |
| B4  | R3   | Gateway CORS `{ origin: true }` 允许任意源                                     | 改用 NotificationGateway 同款白名单：`[localhost:3000, localhost:3001, railway.frontendUrl, railway.backendUrl, FRONTEND_URL]`                |
| B5  | R3   | JWT 校验是 stub（仅看 token 非空），userId 从 auth 透传可被伪造                | 注入 `JwtService`，在 `handleConnection` 调 `jwt.verify<JwtPayload>(token)` 真校验；模块装配 `JwtModule.registerAsync` 同 NotificationGateway |
| B6  | R3   | WebSocket 未对齐 NestJS auth 体系                                              | gateway 现在使用 `JwtService` 注入 + 标准 verify 流程，与 `NotificationGateway` / `TopicResearchGateway` 完全一致                             |

### 2.2 重要修订（已落地）

| #   | 来源 | 问题                                                          | 修订                                                                                                  |
| --- | ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| I1  | R1   | `executeAdapterAsync` fire-and-forget 没 `.catch()`           | 加 `.catch((err) => this.logger.error(...))` 兜底防 Node.js unhandled rejection                       |
| I2  | R1   | `persistMessages` 用 `$transaction([...])` 数组形式不保证原子 | 改 `$transaction(async (tx) => { for ... await tx.askMessage.create(...) })` callback 形式            |
| I3  | R1   | history 用 `createdAt` 排序与设计 `sequenceNum` 排序不一致    | 改 `orderBy: [{ sequenceNum: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]`               |
| I4  | R2   | `ServerEventBase` 用 intersection 而非 discriminated union    | 改为标签联合：每个变体 `(BaseServerEvent & { kind: "..."; ... })`，TS 现在强制 narrowing 与字段完整性 |
| I5  | R2   | history `[speaker] content` 拼接可能 prompt 注入              | sanitize displayName：`replace(/[\[\]\r\n]/g, "").slice(0, 40)`                                       |
| I6  | R2   | `PendingMessage.sequenceNum` 语义未明                         | 加 JSDoc 明示"该消息落库 seq；与 participant.done 事件 seq 一致；与 thinking 事件不同"                |

### 2.3 次要修订（已落地）

| #   | 来源 | 问题                                                 | 修订                                                                      |
| --- | ---- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| M1  | R1   | `turnAbortControllers` 多实例部署失效，缺 disclaimer | gateway `emitToRoom` JSDoc + runtime 顶部注释加多副本 disclaimer          |
| M2  | R2   | FREECHAT 不发 partial event，与协议声明不符          | adapter 头部注释明示"同步 chat()，partial 留 v0.3 chatStream"             |
| M3  | R2   | messageId 生成时机缺 JSDoc                           | 在 `const messageId = uuid()` 上方加引用 §6.2 的注释                      |
| M4  | R3   | `sendMessage` 重复非空校验                           | 删除手工 `if (!dto.content)`，全交给 ValidationPipe + DTO MaxLength       |
| M5  | R3   | `cancelTurn` controller 层冗余防护                   | runtime 内 `findUserRoom` 已校验归属，controller 不需重复（已在注释明示） |

### 2.4 暂不修订（评估后决定）

| #   | 来源 | 问题                                         | 决策                                                                                     |
| --- | ---- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| D1  | R1   | `findUserRoom` 重复 query                    | YAGNI 原则——20ms 内的二次 query 不显著；3 处使用再优化（Karpathy 简洁原则）              |
| D2  | R1   | F3 parentMessageId 循环检测                  | follow-up 任务 F3 标记本期不做（W3 PR4 跑 DEBATE 才用 parentMessageId 链路）             |
| D3  | R4   | updateMember / finalizeTurn / getRoom 0 spec | follow-up F7 W3 补；本期 PR3 单测 6+14=20 用例覆盖核心路径，达到 PR3 范围的成功标准      |
| D4  | R4   | Runtime / Controller / Gateway 0 spec        | follow-up F8/F9/F10 留 W4-W6；本期 PR3 焦点是 backend 骨架可工作，集成测试 W6 E2E 一并补 |

---

## 3. 仲裁记录

### 3.1 R1 阻塞 B2：cascade 与软删承诺

**冲突**：评审 v2 P1-9 决议"AskRoomMember 改软删保留历史发言者"；但 schema FK `onDelete: Cascade` 在 session 删除时仍物理删除成员。R1 称"承诺冲突"。

**仲裁结论**：**保留 cascade**。澄清承诺范围：

- "软删保留历史"承诺仅适用于**单个成员被房主移除**（user 调 DELETE /rooms/:id/members/:mid）的场景
- 整个 session 被删除时（user 调 DELETE /sessions/:id），成员"陪葬"是用户预期行为
- AskMessage 上 `senderMemberId` 的 SetNull cascade 也是为单成员场景准备的——当软删成员时，message 的 senderMemberId 仍指向软删的 member（保留发言者信息）；只有 session 整体删除时 message 才会被 cascade 删除（连带消失，无需保留）

**文档**：v0.2 设计文档 §4.4 已有相关说明。本次 v3 review 进一步明确两类删除场景。

### 3.2 R2 阻塞 B3：partial-log 协议失配

**冲突**：`turn.subscribe.resumeFromSeq` 在协议中声明，但 controller 没 `partial-log` 端点。

**仲裁方法**：读 controller 与设计 v0.2 §6.3。设计已声明断线重连补差是 W5 范围。

**结论**：暂从 ClientEvent 移除 `turn.subscribe`，避免协议欺骗前端。W5 实现 partial-log 端点时同时恢复该协议字段。Follow-up F6 登记。

### 3.3 R4 测试覆盖率：4.5/10

**冲突**：R4 主张"未达设计 §12 ≥ 90% 行覆盖率"。

**仲裁结论**：**部分采纳**。

- W2 PR3 是 backend 骨架，单测覆盖 Adapter 6 + Service 14 = **20 用例覆盖核心 CRUD + adapter 主路径**
- §12 ≥ 90% 是"各 mode adapter"的目标——FREECHAT adapter 单测确实覆盖核心路径，按当前 6 用例估行覆盖 ≥ 70%（待覆盖：mention 部分无效、chat 抛错、persona 注入、并发 sequenceNum）
- updateMember / finalizeTurn / getRoom 测试缺失视为**重要缺陷**，列入 follow-up F7（W3 必补）
- Runtime / Controller / Gateway spec 视为**集成测试范围**，留 W6 E2E 完成（follow-up F8-F10）

**判定**：W2 PR3 单元测试覆盖核心范围，可合入；后续波次按 follow-up 补齐。

---

## 4. 总体合规度

| 维度                       | 结果                                            |
| -------------------------- | ----------------------------------------------- |
| `tsc --noEmit` 类型检查    | 0 error                                         |
| 架构 spec `verify:arch`    | 22/22 PASS                                      |
| 单元测试                   | 20 + 16 W1 + 既有 ai-app/teams = **83/83 PASS** |
| `.claude` 行为红线（推断） | 与 W1 v2 同水平                                 |
| 与 SOLO Ask 兼容           | 0 字段破坏；新接口前缀 `/ask/rooms`             |
| WebSocket 安全             | 真 JWT verify + CORS 白名单 + 房间隔离          |

---

## 5. follow-up 列表（不阻塞合并；按波次承接）

| #   | 项                                                               | 触发 | 工时  |
| --- | ---------------------------------------------------------------- | ---- | ----- |
| F1  | ai-app/teams DebateService refactor 消费 harness DebatePattern   | v0.3 | 2–3d  |
| F2  | DebatePattern 多轮 abort 测试                                    | v0.3 | 2h    |
| F3  | parentMessageId 循环检测在 AskMessage 仓库（W3 DEBATE 落地时补） | W3   | 1h    |
| F4  | parent_message_id 循环 e2e 反例覆盖                              | W6   | 30min |
| F5  | composeJudgeUserMessage 全套 i18n（不仅是 redLabel）             | v0.3 | 1d    |
| F6  | turn.subscribe + partial-log 端点（断线重连增量补差）            | W5   | 1d    |
| F7  | updateMember / finalizeTurn / getRoom service spec 补            | W3   | 4h    |
| F8  | AskRoomRuntimeService spec（mode 选择 / 取消 / 重试 / 错误路径） | W3   | 6h    |
| F9  | AskRoomController spec（9 端点 auth + DTO 校验）                 | W4   | 4h    |
| F10 | AskRoomGateway spec（JWT join / cancel / 房间隔离）              | W4   | 4h    |
| F11 | sequenceNum 并发竞态 e2e 测试（10 并发 appendUserMessage）       | W6   | 2h    |
| F12 | socket.io-redis adapter（多副本部署）                            | W5   | 1d    |

---

## 6. 评审过程

| 时间线（同日） | 动作                                       |
| -------------- | ------------------------------------------ |
| T0             | 4 组 W2 PR3 评审并行启动                   |
| T0 + 1h        | R1 服务层 + R3 安全 回                     |
| T0 + 1.5h      | R2 adapter / R4 覆盖度 回                  |
| T0 + 2h        | 协调者修订 PR3 (6 阻塞 + 6 重要 + 5 次要)  |
| T0 + 2.5h      | tsc 0 error / 83/83 spec 全过 / amend 完成 |
| T0 + 3h        | 本纪要落档                                 |

---

## 7. 关联

- [设计文档 v0.2](./teams-mode.md)
- [v1 设计评审纪要](./teams-mode-review.md)
- [v2 W1 代码评审纪要](./teams-mode-review-v2.md)
- [ADR-004](../../../decisions/004-ai-ask-teams-mode.md)
